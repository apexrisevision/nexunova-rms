-- Follow-up reminder engine + "allow duplicate against won/lost client" tweak.
-- Applied live via MCP (crm_followup_reminder_engine_and_won_dup_tweak); filed here for the record.

-- ── TWEAK: only ACTIVE leads block a duplicate; a won/lost client may start a fresh inquiry ──
CREATE OR REPLACE FUNCTION public.create_lead(p_session_token text, p_payload jsonb, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_id uuid; v_name text; v_role text; v_cfg public.lead_role_config; v_src text;
        v_phone text; v_norm text; v_dup record; v_can_force boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF v_cfg.role IS NULL OR NOT v_cfg.can_have_leads THEN
    RETURN jsonb_build_object('success',false,'error','role_no_leads','message','Your role does not handle leads.'); END IF;
  IF v_cfg.create_sources IS NULL OR jsonb_array_length(v_cfg.create_sources)=0 THEN
    RETURN jsonb_build_object('success',false,'error','cannot_create','message','Your role receives leads from your manager — you can’t create them.'); END IF;
  v_name := NULLIF(TRIM(COALESCE(p_payload->>'name','')),'');
  IF v_name IS NULL THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Lead name is required.'); END IF;
  v_src := NULLIF(TRIM(COALESCE(p_payload->>'source','')),'');
  IF v_src IS NULL OR NOT (v_src IN (SELECT jsonb_array_elements_text(v_cfg.create_sources))) THEN
    v_src := COALESCE(v_cfg.create_sources->>0,'manual'); END IF;
  v_phone := NULLIF(TRIM(COALESCE(p_payload->>'phone','')),'');
  v_norm := public._norm_phone(v_phone);

  IF v_norm IS NOT NULL THEN
    SELECT l.id, l.status, ow.full_name AS owner_name,
           (l.owner_sales_user_id IN (
              WITH RECURSIVE sub AS (
                SELECT id FROM public.sales_users WHERE id=v_ses.sales_user_id
                UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
              ) SELECT id FROM sub)) AS visible
      INTO v_dup
    FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    WHERE l.company_id=v_ses.company_id AND l.status NOT IN ('won','lost')
      AND public._norm_phone(l.phone)=v_norm
    ORDER BY l.created_at ASC LIMIT 1;
    IF v_dup.id IS NOT NULL THEN
      IF v_dup.visible THEN
        RETURN jsonb_build_object('success',false,'error','duplicate_owned',
          'message','This client already exists in your pipeline.',
          'lead_id',v_dup.id,'owner_name',v_dup.owner_name,'status',v_dup.status);
      ELSE
        v_can_force := v_role IN ('marketing_manager','director');
        IF NOT (p_force AND v_can_force) THEN
          RETURN jsonb_build_object('success',false,'error','duplicate_elsewhere',
            'message','A lead with this phone already exists in the organization.','can_force', v_can_force);
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, created_by_sales_user_id, name, phone, email,
    source, interest, unit_type_id, unit_id, budget, status, notes)
  VALUES (v_ses.company_id, COALESCE(NULLIF(p_payload->>'project_id','')::uuid, v_ses.project_id),
    v_ses.sales_user_id, v_ses.sales_user_id, v_name, v_phone,
    NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), v_src,
    NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''),
    NULLIF(p_payload->>'unit_type_id','')::uuid, NULLIF(p_payload->>'unit_id','')::uuid,
    NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric,
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'status','')),''),'new'),
    NULLIF(TRIM(COALESCE(p_payload->>'notes','')),'')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END; $function$;

-- ── REMINDER ENGINE ──
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS followup_notified_for date;

-- channel-agnostic sender: IN_APP implemented; WHATSAPP/PUSH scaffolded no-ops (see TODO config blocks)
CREATE OR REPLACE FUNCTION public.send_followup_reminder(p_sales_user_id uuid, p_lead_id uuid, p_channel text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lead public.leads; v_overdue boolean; v_title text; v_body text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_overdue := v_lead.next_follow_up_at::date < current_date;
  v_title := CASE WHEN v_overdue THEN 'Overdue follow-up' ELSE 'Follow-up due today' END;
  v_body  := 'Follow up with '||COALESCE(v_lead.name,'your lead')
             ||CASE WHEN v_lead.phone IS NOT NULL THEN ' ('||v_lead.phone||')' ELSE '' END
             ||CASE WHEN v_overdue THEN ' — was due '||to_char(v_lead.next_follow_up_at,'DD Mon') ELSE ' — due today' END||'.';
  IF p_channel='in_app' THEN
    INSERT INTO public.sales_announcements (company_id, sales_user_id, title, body, is_important, is_active, attachments)
    VALUES (v_lead.company_id, p_sales_user_id, v_title, v_body, v_overdue, true, '[]'::jsonb);
    RETURN true;
  ELSIF p_channel='whatsapp' THEN
    -- TODO(config): WhatsApp staff reminders not wired. Provide Meta WA phone_number_id +
    -- permanent access_token + approved staff-reminder template in system_config, then
    -- net.http_post to graph.facebook.com/v19.0/<id>/messages here. No fake sends.
    RAISE NOTICE 'send_followup_reminder: whatsapp channel not configured (lead %)', p_lead_id;
    RETURN false;
  ELSIF p_channel='push' THEN
    -- TODO(config): Web/FCM push not wired. Needs FCM server key + device_tokens table + web-push registration.
    RAISE NOTICE 'send_followup_reminder: push channel not configured (lead %)', p_lead_id;
    RETURN false;
  END IF;
  RETURN false;
END; $function$;

CREATE OR REPLACE FUNCTION public.cron_followup_reminders()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE rec record; v_n int := 0;
BEGIN
  FOR rec IN
    SELECT id, owner_sales_user_id, next_follow_up_at FROM public.leads
    WHERE next_follow_up_at IS NOT NULL AND status NOT IN ('won','lost') AND owner_sales_user_id IS NOT NULL
      AND next_follow_up_at::date <= current_date
      AND (followup_notified_for IS NULL OR followup_notified_for <> next_follow_up_at::date)
  LOOP
    PERFORM public.send_followup_reminder(rec.owner_sales_user_id, rec.id, 'in_app');
    UPDATE public.leads SET followup_notified_for = rec.next_follow_up_at::date WHERE id=rec.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'notified',v_n,'ran_at',now());
END; $function$;

REVOKE EXECUTE ON FUNCTION public.send_followup_reminder(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cron_followup_reminders() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('sales-followup-reminders'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sales-followup-reminders','0 * * * *',$$SET search_path=public; SELECT public.cron_followup_reminders();$$);
