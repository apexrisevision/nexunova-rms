-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase F: SEND BACKBONE (SQL side)
-- 2026-05-28
-- The Edge Function calls these (with the service role key):
--   claim_pending_messages()  -> atomically claim due queued rows
--                                (status queued->sending, FOR UPDATE
--                                 SKIP LOCKED so parallel runs are safe),
--                                returns rows + the matched template's
--                                Meta fields for true API sends.
--   update_message_result()   -> write the send outcome back.
--   update_message_delivery()  -> webhook status (delivered/read/failed).
-- These are PRIVILEGED (cross-company) -> granted to service_role ONLY,
-- never anon/authenticated.
-- ================================================================

CREATE OR REPLACE FUNCTION public.claim_pending_messages(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  WITH claimed AS (
    UPDATE message_log ml
       SET status = 'sending', attempts = ml.attempts + 1
     WHERE ml.id IN (
       SELECT id FROM message_log
        WHERE status = 'queued'
          AND (scheduled_at IS NULL OR scheduled_at <= now())
        ORDER BY created_at
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
        FOR UPDATE SKIP LOCKED)
    RETURNING ml.id, ml.company_id, ml.channel, ml.to_address, ml.body_rendered,
              ml.template_id, ml.category, ml.merge_data)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cl.id, 'company_id', cl.company_id, 'channel', cl.channel,
           'to_address', cl.to_address, 'body_rendered', cl.body_rendered,
           'category', cl.category,
           'meta_template_name', t.meta_template_name,
           'meta_language', t.meta_language,
           'variable_map', t.variable_map,
           'merge_data', cl.merge_data)), '[]'::jsonb)
    INTO v_rows
  FROM claimed cl
  LEFT JOIN message_templates t ON t.id = cl.template_id;

  RETURN jsonb_build_object('success', true, 'messages', v_rows);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_messages(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_messages(int) TO service_role;

CREATE OR REPLACE FUNCTION public.update_message_result(
  p_id uuid, p_status text, p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('sent','failed','queued') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_status');
  END IF;
  UPDATE message_log
     SET status = p_status,
         provider = COALESCE(p_provider, provider),
         provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
         error = p_error,
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
   WHERE id = p_id;
  RETURN jsonb_build_object('success', FOUND);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.update_message_result(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_message_result(uuid, text, text, text, text) TO service_role;

-- webhook: correlate by provider_message_id, advance delivery state
CREATE OR REPLACE FUNCTION public.update_message_delivery(
  p_provider_message_id text, p_status text, p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('delivered','read','failed','sent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_status');
  END IF;
  UPDATE message_log
     SET status = p_status,
         error = COALESCE(p_error, error),
         delivered_at = CASE WHEN p_status IN ('delivered','read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
         read_at      = CASE WHEN p_status = 'read' THEN now() ELSE read_at END
   WHERE provider_message_id = p_provider_message_id;
  RETURN jsonb_build_object('success', FOUND);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.update_message_delivery(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_message_delivery(text, text, text) TO service_role;
