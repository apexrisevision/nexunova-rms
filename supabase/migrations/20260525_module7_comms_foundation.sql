-- ================================================================
-- NEXUNOVA RMS — MODULE 7 (FOUNDATION) AUTOMATED COMMUNICATIONS
-- 2026-05-25
-- APPLIED to live DB (project itqxljtfbrppntgyfush) via MCP apply_migration
-- on 2026-05-25. Verified transactionally (seed 6, idempotent re-seed 0,
-- list 6, custom upsert, log insert, opt-out toggle, get_message_log) and
-- rolled back (0 residue).
--
-- Gateway-AGNOSTIC data layer: template library, message log, client
-- opt-out. NO automated/bulk dispatch or delivery tracking here — that
-- needs a WhatsApp/SMS gateway (Twilio / WhatsApp Cloud API / local) +
-- a Supabase Edge Function + cron, and is DEFERRED pending the gateway
-- decision. Templates are channel-tagged so they work with any gateway.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  name        text NOT NULL,
  channel     text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','email')),
  category    text NOT NULL DEFAULT 'custom',
  subject     text,
  body        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mtpl_company ON public.message_templates(company_id, channel, category);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.message_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  client_id     uuid,
  channel       text NOT NULL DEFAULT 'whatsapp',
  template_id   uuid,
  category      text,
  to_address    text,
  body_rendered text,
  status        text NOT NULL DEFAULT 'manual'
                CHECK (status IN ('manual','queued','sent','delivered','read','failed')),
  sent_by       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mlog_company ON public.message_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mlog_client  ON public.message_log(client_id, created_at DESC);
ALTER TABLE public.message_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS comms_opt_out boolean NOT NULL DEFAULT false;

-- RPCs: list_message_templates, upsert_message_template, delete_message_template,
--       seed_default_templates, log_message_sent, set_client_comms_optout, get_message_log
-- (Full bodies as applied — see live DB pg_get_functiondef for canonical source.)

CREATE OR REPLACE FUNCTION public.list_message_templates(p_company_id uuid, p_channel text DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.channel, t.category, t.name), '[]'::jsonb)
  FROM (
    SELECT id, name, channel, category, subject, body, is_active, created_by, created_at, updated_at
    FROM message_templates
    WHERE company_id = p_company_id AND (p_channel IS NULL OR channel = p_channel)
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.list_message_templates(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_message_template(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF COALESCE(p_data->>'name','') = '' OR COALESCE(p_data->>'body','') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_and_body_required');
  END IF;
  v_id := NULLIF(p_data->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
    UPDATE message_templates SET
      name = COALESCE(NULLIF(p_data->>'name',''), name),
      channel = COALESCE(NULLIF(p_data->>'channel',''), channel),
      category = COALESCE(NULLIF(p_data->>'category',''), category),
      subject = p_data->>'subject',
      body = COALESCE(NULLIF(p_data->>'body',''), body),
      is_active = COALESCE((p_data->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'template_not_found'); END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'updated', true);
  ELSE
    INSERT INTO message_templates (company_id, name, channel, category, subject, body, is_active, created_by)
    VALUES (p_company_id, p_data->>'name', COALESCE(NULLIF(p_data->>'channel',''),'whatsapp'),
            COALESCE(NULLIF(p_data->>'category',''),'custom'), p_data->>'subject', p_data->>'body',
            COALESCE((p_data->>'is_active')::boolean, true), NULLIF(p_data->>'created_by',''))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'updated', false);
  END IF;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_message_template(uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_message_template(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM message_templates WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_message_template(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_default_templates(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_added int := 0;
  v_row   record;
  v_defaults CONSTANT jsonb := jsonb_build_array(
    jsonb_build_object('name','Installment Due Reminder','category','installment_due','body',
      'Assalam o Alaikum {{client_name}}, aap ki installment PKR {{amount}} ki due date {{due_date}} hai. Bara meherbani waqt par payment karein. Shukriya - {{company_name}}'),
    jsonb_build_object('name','Overdue Reminder','category','overdue','body',
      'Assalam o Alaikum {{client_name}}, aap ki payment PKR {{amount}} overdue ho chuki hai ({{days_overdue}} din). Please foran rabta karein. - {{company_name}}'),
    jsonb_build_object('name','Payment Received Thanks','category','payment_received','body',
      'Shukriya {{client_name}}! Aap ki payment PKR {{amount}} receive ho gayi hai. Receipt: {{receipt_no}}. - {{company_name}}'),
    jsonb_build_object('name','Promise Reminder (24h)','category','promise_reminder','body',
      'Assalam o Alaikum {{client_name}}, kal ({{promise_date}}) aap ne PKR {{amount}} payment ka wada kiya tha. Yaad dehani. Shukriya - {{company_name}}'),
    jsonb_build_object('name','PDC Deposit Reminder','category','pdc_reminder','body',
      'Assalam o Alaikum {{client_name}}, aap ka cheque number {{cheque_no}} (PKR {{amount}}) {{deposit_date}} ko deposit hoga. Please account mein balance rakhein. - {{company_name}}'),
    jsonb_build_object('name','Legal Notice','category','legal_notice','body',
      'NOTICE: {{client_name}}, aap ki outstanding PKR {{amount}} ke liye legal proceedings shuru ki ja sakti hain agar {{due_date}} tak payment na hui. - {{company_name}}')
  );
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_defaults) AS d(t)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM message_templates
      WHERE company_id = p_company_id AND channel = 'whatsapp' AND category = (v_row.t->>'category')
    ) THEN
      INSERT INTO message_templates (company_id, name, channel, category, body, created_by)
      VALUES (p_company_id, v_row.t->>'name', 'whatsapp', v_row.t->>'category', v_row.t->>'body', 'system');
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'added', v_added);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.seed_default_templates(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_message_sent(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  INSERT INTO message_log (company_id, client_id, channel, template_id, category, to_address, body_rendered, status, sent_by)
  VALUES (p_company_id, NULLIF(p_data->>'client_id','')::uuid, COALESCE(NULLIF(p_data->>'channel',''),'whatsapp'),
          NULLIF(p_data->>'template_id','')::uuid, p_data->>'category', p_data->>'to_address',
          p_data->>'body_rendered', COALESCE(NULLIF(p_data->>'status',''),'manual'), NULLIF(p_data->>'sent_by',''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_message_sent(uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_client_comms_optout(p_client_id uuid, p_company_id uuid, p_opt_out boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE clients SET comms_opt_out = COALESCE(p_opt_out, false)
  WHERE id = p_client_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'client_not_found'); END IF;
  RETURN jsonb_build_object('success', true, 'client_id', p_client_id, 'comms_opt_out', COALESCE(p_opt_out,false));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_client_comms_optout(uuid, uuid, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_message_log(p_company_id uuid, p_limit int DEFAULT 100)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT ml.id, ml.client_id, c.full_name AS client_name, ml.channel, ml.category,
           ml.to_address, ml.body_rendered, ml.status, ml.sent_by, ml.created_at
    FROM message_log ml
    LEFT JOIN clients c ON c.id = ml.client_id
    WHERE ml.company_id = p_company_id
    ORDER BY ml.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000))
  ) r;
$$;
GRANT EXECUTE ON FUNCTION public.get_message_log(uuid, int) TO anon, authenticated;
