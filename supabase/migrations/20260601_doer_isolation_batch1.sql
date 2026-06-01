-- Project-isolation gates — Batch 1 (the doer-RPCs that already derive v_project).
-- Non-admin callers must be assigned (user_project_assignments) to the row's project.
-- Admin/owner/super-admin and the no-session service path bypass (matches record_payment).
--
-- Surgical change per function (bodies otherwise byte-for-byte unchanged):
--   1. DECLARE: add  v_me public.app_users := public._rms_caller();
--   2. After v_project is fully derived and BEFORE the INSERT, insert the gate.
--      The checked project = the value actually inserted:
--        create_contact_log / create_payment_promise → COALESCE(p_data.project_id, v_project)
--        create_follow_up_reminder                   → v_project (already coalesced)
-- SECURITY DEFINER + search_path=public preserved.

-- ── 1. create_contact_log ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_contact_log(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row jsonb;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_project uuid; v_client uuid; v_sale uuid;
  v_enriched jsonb;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
    SELECT s.id, s.client_id INTO v_sale, v_client
      FROM public.sales s
      WHERE s.unit_id = v_unit AND s.company_id = p_company_id AND s.status <> 'cancelled'
      ORDER BY s.sale_date DESC NULLS LAST LIMIT 1;
  END IF;

  -- ── Project-isolation gate ──
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = v_me.id AND company_id = p_company_id
        AND project_id = COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project) AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project),
         'client_id',  COALESCE(NULLIF(p_data->>'client_id','')::uuid,  v_client),
         'sale_id',    COALESCE(NULLIF(p_data->>'sale_id','')::uuid,     v_sale)));

  -- jsonb_populate_record sets unspecified columns to NULL — it does NOT honor
  -- column DEFAULTs (gen_random_uuid() for id, now() for created_at). Backfill
  -- them here when the caller didn't supply them so the NOT NULL constraints
  -- on id + created_at are satisfied.
  IF NULLIF(v_enriched->>'id','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('id', gen_random_uuid());
  END IF;
  IF NULLIF(v_enriched->>'created_at','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('created_at', now());
  END IF;

  INSERT INTO public.contact_logs
  SELECT * FROM jsonb_populate_record(NULL::public.contact_logs, v_enriched)
  RETURNING id INTO v_id;

  SELECT to_jsonb(cl) INTO v_row FROM public.contact_logs cl WHERE cl.id = v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'row', v_row);
END $function$;

-- ── 2. create_follow_up_reminder ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_follow_up_reminder(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_project IS NULL AND v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
  END IF;
  IF v_project IS NULL AND v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  -- ── Project-isolation gate ──
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = v_me.id AND company_id = p_company_id
        AND project_id = v_project AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  INSERT INTO public.follow_up_reminders (
    company_id, contact_log_id, unit_id, client_id, sale_id, project_id,
    remind_at, channels, message, status, created_by
  ) VALUES (
    p_company_id,
    NULLIF(p_data->>'contact_log_id','')::uuid,
    v_unit,
    NULLIF(p_data->>'client_id','')::uuid,
    v_sale,
    v_project,
    (p_data->>'remind_at')::timestamptz,
    CASE WHEN p_data->'channels' IS NULL THEN '{}'::text[]
         ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'channels')) END,
    NULLIF(p_data->>'message',''),
    COALESCE(p_data->>'status', 'pending'),
    NULLIF(p_data->>'created_by','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── 3. create_payment_promise ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_promise(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid;
  v_enriched jsonb;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  -- ── Project-isolation gate ──
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = v_me.id AND company_id = p_company_id
        AND project_id = COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project) AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned',
        'message','You are not assigned to this project.');
    END IF;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project)));

  IF NULLIF(v_enriched->>'id','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('id', gen_random_uuid());
  END IF;
  IF NULLIF(v_enriched->>'promise_made_on','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('promise_made_on', CURRENT_DATE);
  END IF;
  IF NULLIF(v_enriched->>'logged_by','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('logged_by', '');
  END IF;
  IF NULLIF(v_enriched->>'status','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('status', 'pending');
  END IF;

  INSERT INTO public.payment_promises
  SELECT * FROM jsonb_populate_record(NULL::public.payment_promises, v_enriched)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;
