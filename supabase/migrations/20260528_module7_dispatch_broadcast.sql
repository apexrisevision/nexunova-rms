-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase E: BULK BROADCAST
-- 2026-05-28
-- broadcast_message() expands an audience into queued rows via
-- enqueue_message (so opt-out/DND + per-client merge are enforced
-- consistently). Audiences: 'selected' (explicit client_ids), 'all',
-- 'overdue'. Each broadcast gets a broadcast_id; per-client dedup
-- prevents an accidental double-send of the SAME broadcast.
-- Admin-gated at the UI layer (mirrors the existing comms RPC pattern).
-- ================================================================

CREATE OR REPLACE FUNCTION public.broadcast_message(p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel  text := COALESCE(NULLIF(p_data->>'channel',''), 'whatsapp');
  v_audience text := COALESCE(NULLIF(p_data->>'audience',''), 'selected');
  v_template uuid := NULLIF(p_data->>'template_id','')::uuid;
  v_body     text := NULLIF(p_data->>'body','');
  v_category text := COALESCE(NULLIF(p_data->>'category',''), 'broadcast');
  v_sched    text := NULLIF(p_data->>'scheduled_at','');
  v_sent_by  text := NULLIF(p_data->>'sent_by','');
  v_bid      text := gen_random_uuid()::text;
  v_company  text;
  v_q int := 0; v_s int := 0; v_f int := 0; v_total int := 0;
  rec record; v_res jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company');
  END IF;
  IF v_template IS NULL AND v_body IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'template_or_body_required');
  END IF;
  SELECT company_name INTO v_company FROM companies WHERE id = p_company_id;

  FOR rec IN
    SELECT c.id AS client_id, c.full_name
    FROM clients c
    WHERE c.company_id = p_company_id
      AND (
        (v_audience = 'selected'
           AND c.id = ANY (SELECT (jsonb_array_elements_text(COALESCE(p_data->'client_ids','[]'::jsonb)))::uuid))
        OR (v_audience = 'all')
        OR (v_audience = 'overdue' AND c.id IN (
              SELECT DISTINCT s.client_id
              FROM installments i JOIN sales s ON s.id = i.sale_id
              WHERE i.company_id = p_company_id
                AND i.status IN ('pending','partial','overdue')
                AND i.outstanding > 0 AND i.due_date < CURRENT_DATE))
      )
  LOOP
    v_total := v_total + 1;
    v_res := public.enqueue_message(p_company_id, jsonb_build_object(
      'client_id', rec.client_id, 'channel', v_channel, 'category', v_category,
      'template_id', v_template, 'body', v_body,
      'merge_data', jsonb_build_object('client_name', rec.full_name, 'company_name', v_company),
      'dedup_key', 'bcast:'||v_bid||':'||rec.client_id::text,
      'scheduled_at', v_sched, 'sent_by', v_sent_by));
    IF COALESCE((v_res->>'success')::boolean, false) THEN v_q := v_q + 1;
    ELSIF v_res ? 'skipped' THEN v_s := v_s + 1;
    ELSE v_f := v_f + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'broadcast_id', v_bid,
    'audience', v_audience, 'matched', v_total, 'queued', v_q, 'skipped', v_s, 'failed', v_f);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.broadcast_message(uuid, jsonb) TO anon, authenticated;
