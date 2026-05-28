-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase B: TEMPLATE ENGINE + ENQUEUE
-- 2026-05-28
-- render_template(): {{var}} merge. enqueue_message(): resolves the
-- recipient, enforces opt-out / DND, renders the body, applies dedup,
-- and writes a 'queued' row to message_log. Provider-agnostic — the
-- send adapter (Phase F) drains the queue later.
-- ================================================================

-- ---- render_template: {{key}} substitution ---------------------------------
CREATE OR REPLACE FUNCTION public.render_template(p_template text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_out text := COALESCE(p_template, ''); k text;
BEGIN
  IF p_vars IS NULL THEN RETURN v_out; END IF;
  FOR k IN SELECT jsonb_object_keys(p_vars) LOOP
    v_out := replace(v_out, '{{' || k || '}}', COALESCE(p_vars->>k, ''));
  END LOOP;
  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.render_template(text, jsonb) TO anon, authenticated;

-- ---- enqueue_message: the single entry point onto the queue ----------------
-- p_data keys:
--   client_id, channel('whatsapp'|'sms'|'email'), category, template_id,
--   body (optional override), to_address (optional override), merge_data,
--   scheduled_at, dedup_key, sale_id, sent_by
-- Returns: {success, id, queued} | {success:false, skipped:'opt_out'|'duplicate'|'no_recipient'} | {success:false, error}
CREATE OR REPLACE FUNCTION public.enqueue_message(p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel    text := COALESCE(NULLIF(p_data->>'channel',''), 'whatsapp');
  v_category   text := NULLIF(p_data->>'category','');
  v_client_id  uuid := NULLIF(p_data->>'client_id','')::uuid;
  v_template_id uuid := NULLIF(p_data->>'template_id','')::uuid;
  v_dedup      text := NULLIF(p_data->>'dedup_key','');
  v_merge      jsonb := COALESCE(p_data->'merge_data', '{}'::jsonb);
  v_opt_out    boolean := false;
  v_dnd        boolean := false;
  v_to         text := NULLIF(p_data->>'to_address','');
  v_wa text; v_p1 text; v_p2 text; v_email text;
  v_body_tpl   text;
  v_rendered   text;
  v_id         uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company');
  END IF;

  -- 1) resolve recipient + consent from the client (if a client was given)
  IF v_client_id IS NOT NULL THEN
    SELECT whatsapp, phone_primary, phone_secondary, email, comms_opt_out, COALESCE(dnd_status,false)
      INTO v_wa, v_p1, v_p2, v_email, v_opt_out, v_dnd
      FROM clients WHERE id = v_client_id AND company_id = p_company_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'client_not_found');
    END IF;
    -- consent: comms opt-out blocks every channel; DND blocks phone channels
    IF v_opt_out OR (v_dnd AND v_channel IN ('whatsapp','sms')) THEN
      RETURN jsonb_build_object('success', false, 'skipped', 'opt_out');
    END IF;
    IF v_to IS NULL THEN
      v_to := CASE WHEN v_channel = 'email' THEN v_email
                   ELSE COALESCE(NULLIF(v_wa,''), NULLIF(v_p1,''), NULLIF(v_p2,'')) END;
    END IF;
  END IF;

  IF v_to IS NULL OR v_to = '' THEN
    RETURN jsonb_build_object('success', false, 'skipped', 'no_recipient');
  END IF;

  -- 2) resolve the template body (explicit override > template_id > active by category)
  v_body_tpl := NULLIF(p_data->>'body','');
  IF v_body_tpl IS NULL THEN
    IF v_template_id IS NOT NULL THEN
      SELECT body, category INTO v_body_tpl, v_category
        FROM message_templates WHERE id = v_template_id AND company_id = p_company_id;
    ELSIF v_category IS NOT NULL THEN
      SELECT id, body INTO v_template_id, v_body_tpl
        FROM message_templates
        WHERE company_id = p_company_id AND channel = v_channel AND category = v_category AND is_active
        ORDER BY updated_at DESC LIMIT 1;
    END IF;
  END IF;
  IF v_body_tpl IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_template');
  END IF;

  v_rendered := render_template(v_body_tpl, v_merge);

  -- 3) dedup pre-check (the partial unique index uq_mlog_dedup is the hard backstop)
  IF v_dedup IS NOT NULL AND EXISTS (
        SELECT 1 FROM message_log
        WHERE company_id = p_company_id AND dedup_key = v_dedup
          AND status NOT IN ('failed','cancelled')) THEN
    RETURN jsonb_build_object('success', false, 'skipped', 'duplicate');
  END IF;

  -- 4) enqueue
  INSERT INTO message_log (
    company_id, client_id, channel, template_id, category, to_address,
    body_rendered, status, scheduled_at, dedup_key, merge_data, sale_id, sent_by)
  VALUES (
    p_company_id, v_client_id, v_channel, v_template_id, v_category, v_to,
    v_rendered, 'queued',
    NULLIF(p_data->>'scheduled_at','')::timestamptz, v_dedup, v_merge,
    NULLIF(p_data->>'sale_id','')::uuid, NULLIF(p_data->>'sent_by',''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'queued', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'skipped', 'duplicate');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_message(uuid, jsonb) TO anon, authenticated;
