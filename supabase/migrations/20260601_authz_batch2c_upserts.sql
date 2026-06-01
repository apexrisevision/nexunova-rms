-- Authz hardening — Batch 2c: gate company-scoped UPSERT/config/create RPCs. Source: RPC_AUTHZ_TRIAGE.md.
-- Same null-safe guard as prior batches (caller-resolve + id IS NULL + tenant IS DISTINCT FROM p_company_id,
-- super-admin bypass). Role line per group:
--   GROUP A (owner/admin)         — config / project-children / docs / templates / targets
--   GROUP B (owner/admin/finance) — money / commission / agent-finance / receivables
-- All 18 take a real p_company_id first param. None were pre-gated.
-- SIGNATURE NOTE: add_price_revision has NO `SET search_path` clause in the catalog — preserved as-is
-- (NOT adding one). All DEFAULT params, return types, SECURITY DEFINER, search_path, and EXCEPTION/NOT-FOUND
-- logic preserved byte-for-byte; only the guard block + v_me decl are added.

-- ════════════════════════════ GROUP A — owner/admin ════════════════════════════

-- A1. upsert_bank
CREATE OR REPLACE FUNCTION public.upsert_bank(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.banks (company_id, bank_name, account_title, account_number, iban, branch, is_active, sort_order, notes)
    VALUES (p_company_id, p_data->>'bank_name', p_data->>'account_title', p_data->>'account_number',
            NULLIF(p_data->>'iban',''), NULLIF(p_data->>'branch',''), COALESCE((p_data->>'is_active')::bool, true),
            COALESCE((p_data->>'sort_order')::int, 0), NULLIF(p_data->>'notes',''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.banks SET
      bank_name = COALESCE(p_data->>'bank_name', bank_name),
      account_title = COALESCE(p_data->>'account_title', account_title),
      account_number = COALESCE(p_data->>'account_number', account_number),
      iban = COALESCE(NULLIF(p_data->>'iban',''), iban),
      branch = COALESCE(NULLIF(p_data->>'branch',''), branch),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      notes = COALESCE(NULLIF(p_data->>'notes',''), notes)
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- A2. upsert_project_bank_account
CREATE OR REPLACE FUNCTION public.upsert_project_bank_account(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.project_bank_accounts (
      company_id, project_id, bank_name, account_title, account_no, iban, branch, is_primary, notes
    ) VALUES (
      p_company_id, (p_data->>'project_id')::uuid, p_data->>'bank_name', p_data->>'account_title',
      NULLIF(p_data->>'account_no',''), NULLIF(p_data->>'iban',''), NULLIF(p_data->>'branch',''),
      COALESCE((p_data->>'is_primary')::bool, false), NULLIF(p_data->>'notes','')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.project_bank_accounts SET
      bank_name = COALESCE(p_data->>'bank_name', bank_name),
      account_title = COALESCE(p_data->>'account_title', account_title),
      account_no = COALESCE(NULLIF(p_data->>'account_no',''), account_no),
      iban = COALESCE(NULLIF(p_data->>'iban',''), iban),
      branch = COALESCE(NULLIF(p_data->>'branch',''), branch),
      is_primary = COALESCE((p_data->>'is_primary')::bool, is_primary),
      notes = COALESCE(NULLIF(p_data->>'notes',''), notes)
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- A3. upsert_project_expense
CREATE OR REPLACE FUNCTION public.upsert_project_expense(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.project_expenses (company_id, project_id, expense_category, description, amount, expense_date, notes, created_by)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'expense_category', NULLIF(p_data->>'description',''),
            COALESCE((p_data->>'amount')::numeric, 0), NULLIF(p_data->>'expense_date','')::date,
            NULLIF(p_data->>'notes',''), NULLIF(p_data->>'created_by',''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.project_expenses SET
      expense_category = COALESCE(p_data->>'expense_category', expense_category),
      description = COALESCE(NULLIF(p_data->>'description',''), description),
      amount = COALESCE((p_data->>'amount')::numeric, amount),
      expense_date = COALESCE(NULLIF(p_data->>'expense_date','')::date, expense_date),
      notes = COALESCE(NULLIF(p_data->>'notes',''), notes)
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- A4. upsert_project_milestone
CREATE OR REPLACE FUNCTION public.upsert_project_milestone(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.project_milestones (
      company_id, project_id, phase_name, description, target_date, completion_date,
      progress_pct, status, sort_order
    ) VALUES (
      p_company_id, (p_data->>'project_id')::uuid, p_data->>'phase_name', NULLIF(p_data->>'description',''),
      NULLIF(p_data->>'target_date','')::date, NULLIF(p_data->>'completion_date','')::date,
      COALESCE((p_data->>'progress_pct')::int, 0), COALESCE(p_data->>'status','upcoming'),
      COALESCE((p_data->>'sort_order')::int, 0)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.project_milestones SET
      phase_name = COALESCE(p_data->>'phase_name', phase_name),
      description = COALESCE(NULLIF(p_data->>'description',''), description),
      target_date = COALESCE(NULLIF(p_data->>'target_date','')::date, target_date),
      completion_date = COALESCE(NULLIF(p_data->>'completion_date','')::date, completion_date),
      progress_pct = COALESCE((p_data->>'progress_pct')::int, progress_pct),
      status = COALESCE(p_data->>'status', status),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order)
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- A5. upsert_possession
CREATE OR REPLACE FUNCTION public.upsert_possession(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.possessions (
      company_id, unit_id, sale_id, status, possession_date, handover_by, received_by,
      client_name, client_phone, checklist, snagging_items, notes, created_by
    ) VALUES (
      p_company_id, (p_data->>'unit_id')::uuid, NULLIF(p_data->>'sale_id','')::uuid,
      COALESCE(p_data->>'status','pending'), NULLIF(p_data->>'possession_date','')::date,
      NULLIF(p_data->>'handover_by',''), NULLIF(p_data->>'received_by',''),
      NULLIF(p_data->>'client_name',''), NULLIF(p_data->>'client_phone',''),
      COALESCE(p_data->'checklist', '[]'::jsonb),
      COALESCE(p_data->'snagging_items', '[]'::jsonb),
      NULLIF(p_data->>'notes',''), NULLIF(p_data->>'created_by','')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.possessions SET
      status = COALESCE(p_data->>'status', status),
      possession_date = COALESCE(NULLIF(p_data->>'possession_date','')::date, possession_date),
      handover_by = COALESCE(NULLIF(p_data->>'handover_by',''), handover_by),
      received_by = COALESCE(NULLIF(p_data->>'received_by',''), received_by),
      client_name = COALESCE(NULLIF(p_data->>'client_name',''), client_name),
      client_phone = COALESCE(NULLIF(p_data->>'client_phone',''), client_phone),
      checklist = COALESCE(p_data->'checklist', checklist),
      snagging_items = COALESCE(p_data->'snagging_items', snagging_items),
      notes = COALESCE(NULLIF(p_data->>'notes',''), notes),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- A6. upsert_message_template
CREATE OR REPLACE FUNCTION public.upsert_message_template(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

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
      meta_template_name = p_data->>'meta_template_name',
      meta_language = COALESCE(NULLIF(p_data->>'meta_language',''), meta_language),
      variable_map = COALESCE(p_data->'variable_map', variable_map),
      updated_at = now()
    WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'template_not_found'); END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'updated', true);
  ELSE
    INSERT INTO message_templates (company_id, name, channel, category, subject, body, is_active, created_by,
                                   meta_template_name, meta_language, variable_map)
    VALUES (p_company_id, p_data->>'name', COALESCE(NULLIF(p_data->>'channel',''),'whatsapp'),
            COALESCE(NULLIF(p_data->>'category',''),'custom'), p_data->>'subject', p_data->>'body',
            COALESCE((p_data->>'is_active')::boolean, true), NULLIF(p_data->>'created_by',''),
            p_data->>'meta_template_name', COALESCE(NULLIF(p_data->>'meta_language',''),'en'),
            COALESCE(p_data->'variable_map','[]'::jsonb))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'updated', false);
  END IF;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A7. seed_default_templates
CREATE OR REPLACE FUNCTION public.seed_default_templates(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_added int := 0;
  v_row   record;
  v_me    public.app_users;
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
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_defaults) AS d(t)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM message_templates
      WHERE company_id = p_company_id
        AND channel = 'whatsapp'
        AND category = (v_row.t->>'category')
    ) THEN
      INSERT INTO message_templates (company_id, name, channel, category, body, created_by)
      VALUES (p_company_id, v_row.t->>'name', 'whatsapp', v_row.t->>'category', v_row.t->>'body', 'system');
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'added', v_added);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A8. add_ip_whitelist_entry
CREATE OR REPLACE FUNCTION public.add_ip_whitelist_entry(p_company_id uuid, p_ip_range text, p_label text, p_created_by text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF NULLIF(trim(p_ip_range), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'IP range required');
  END IF;
  IF EXISTS (
    SELECT 1 FROM company_ip_whitelists
    WHERE company_id = p_company_id AND ip_range = trim(p_ip_range)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'IP range already exists');
  END IF;
  INSERT INTO company_ip_whitelists (company_id, ip_range, label, created_by)
  VALUES (p_company_id, trim(p_ip_range), trim(COALESCE(p_label,'')), p_created_by)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A9. save_company_targets  (RETURNS void)
CREATE OR REPLACE FUNCTION public.save_company_targets(p_company_id uuid, p_monthly numeric, p_annual numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  INSERT INTO company_targets (company_id, monthly_target, annual_target)
  VALUES (p_company_id, p_monthly, p_annual)
  ON CONFLICT (company_id) DO UPDATE SET
    monthly_target = p_monthly,
    annual_target  = p_annual,
    updated_at     = now();
END;
$function$;

-- A10. add_price_revision  (NO `SET search_path` in catalog — preserved as-is)
CREATE OR REPLACE FUNCTION public.add_price_revision(p_company_id uuid, p_project_id uuid, p_unit_type_id uuid, p_new_price numeric, p_effective_date date, p_reason text, p_revised_by text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_old_price     NUMERIC;
  v_units_updated INTEGER := 0;
  v_row           project_price_revisions;
  v_avail_status  UUID;
  v_me            public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  -- Fetch current base_price from any unit of this type in this project
  SELECT base_price INTO v_old_price
  FROM units
  WHERE company_id   = p_company_id
    AND project_id   = p_project_id
    AND unit_type_id = p_unit_type_id
  LIMIT 1;

  IF v_old_price IS NULL THEN
    -- No units of that type found; use 0 as old price
    v_old_price := 0;
  END IF;

  -- Get the UUID of 'Available' status
  SELECT id INTO v_avail_status
  FROM category_unit_statuses
  WHERE company_id = p_company_id AND status_name = 'Available'
  LIMIT 1;

  -- Update base_price on Available units of this type in this project
  IF v_avail_status IS NOT NULL THEN
    UPDATE units
    SET base_price = p_new_price, updated_at = NOW()
    WHERE company_id   = p_company_id
      AND project_id   = p_project_id
      AND unit_type_id = p_unit_type_id
      AND status_id    = v_avail_status;
    GET DIAGNOSTICS v_units_updated = ROW_COUNT;
  END IF;

  -- Insert revision record
  INSERT INTO project_price_revisions
    (company_id, project_id, unit_type_id, old_price, new_price,
     effective_date, reason, revised_by, units_updated)
  VALUES
    (p_company_id, p_project_id, p_unit_type_id, v_old_price, p_new_price,
     p_effective_date, p_reason, p_revised_by, v_units_updated)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'success',       true,
    'id',            v_row.id,
    'old_price',     v_row.old_price,
    'new_price',     v_row.new_price,
    'change_amount', v_row.change_amount,
    'change_percent',v_row.change_percent,
    'units_updated', v_row.units_updated
  );
END;
$function$;

-- A11. add_sale_amendment
CREATE OR REPLACE FUNCTION public.add_sale_amendment(p_company_id uuid, p_sale_id uuid, p_amendment_type text, p_description text, p_reason text DEFAULT NULL::text, p_amended_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_company_id IS NULL OR p_sale_id IS NULL OR p_description IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;
  INSERT INTO sale_amendments(company_id, sale_id, amendment_type, description, reason, amended_by, amended_at)
  VALUES (p_company_id, p_sale_id, COALESCE(p_amendment_type,'other'), p_description, p_reason, p_amended_by, now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A12. upload_sale_document
CREATE OR REPLACE FUNCTION public.upload_sale_document(p_company_id uuid, p_sale_id uuid, p_document_type text, p_document_name text, p_document_url text, p_uploaded_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_company_id IS NULL OR p_sale_id IS NULL OR p_document_name IS NULL OR p_document_url IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;
  INSERT INTO sale_documents(company_id, sale_id, document_type, document_name, document_url, uploaded_by, uploaded_at)
  VALUES (p_company_id, p_sale_id, COALESCE(p_document_type,'other'), p_document_name, p_document_url, p_uploaded_by, now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ═══════════════════════ GROUP B — owner/admin/finance ═══════════════════════

-- B1. upsert_commission_structure
CREATE OR REPLACE FUNCTION public.upsert_commission_structure(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_project_id uuid := NULLIF(p_data->>'project_id','')::uuid;
  v_agent_id   uuid := NULLIF(p_data->>'agent_id','')::uuid;
  v_rate       numeric := COALESCE((p_data->>'rate_percent')::numeric, 0);
  v_book_pct   numeric := COALESCE((p_data->>'milestone_booking_pct')::numeric, 50);
  v_poss_pct   numeric := COALESCE((p_data->>'milestone_possession_pct')::numeric, 50);
  v_me         public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  v_id := NULLIF(p_data->>'id','')::uuid;

  IF v_book_pct + v_poss_pct > 100.01 THEN
    RETURN jsonb_build_object('success',false,'error','Booking + Possession milestones cannot exceed 100%');
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE commission_structures SET
      project_id            = v_project_id,
      agent_id              = v_agent_id,
      rate_percent          = v_rate,
      milestone_booking_pct = v_book_pct,
      milestone_possession_pct = v_poss_pct,
      notes                 = p_data->>'notes',
      is_active             = COALESCE((p_data->>'is_active')::boolean, true),
      updated_at            = now()
    WHERE id = v_id AND company_id = p_company_id;
  ELSE
    INSERT INTO commission_structures (
      company_id, project_id, agent_id,
      rate_percent, milestone_booking_pct, milestone_possession_pct,
      notes, is_active, created_by
    ) VALUES (
      p_company_id, v_project_id, v_agent_id,
      v_rate, v_book_pct, v_poss_pct,
      p_data->>'notes',
      COALESCE((p_data->>'is_active')::boolean, true),
      p_data->>'created_by'
    )
    ON CONFLICT (company_id, project_id, agent_id) DO UPDATE SET
      rate_percent          = EXCLUDED.rate_percent,
      milestone_booking_pct = EXCLUDED.milestone_booking_pct,
      milestone_possession_pct = EXCLUDED.milestone_possession_pct,
      notes                 = EXCLUDED.notes,
      is_active             = EXCLUDED.is_active,
      updated_at            = now()
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM commission_structures
      WHERE company_id=p_company_id
        AND (project_id IS NOT DISTINCT FROM v_project_id)
        AND (agent_id   IS NOT DISTINCT FROM v_agent_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- B2. upsert_payment_method
CREATE OR REPLACE FUNCTION public.upsert_payment_method(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.company_payment_methods (
      company_id, method_type, account_title, account_number, bank_name, branch_code,
      iban, swift_code, display_order, is_active, is_default, notes
    ) VALUES (
      p_company_id, p_data->>'method_type', p_data->>'account_title', p_data->>'account_number',
      NULLIF(p_data->>'bank_name',''), NULLIF(p_data->>'branch_code',''),
      NULLIF(p_data->>'iban',''), NULLIF(p_data->>'swift_code',''),
      COALESCE((p_data->>'display_order')::int, 0),
      COALESCE((p_data->>'is_active')::bool, true),
      COALESCE((p_data->>'is_default')::bool, false),
      NULLIF(p_data->>'notes','')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.company_payment_methods SET
      method_type = COALESCE(p_data->>'method_type', method_type),
      account_title = COALESCE(p_data->>'account_title', account_title),
      account_number = COALESCE(p_data->>'account_number', account_number),
      bank_name = COALESCE(NULLIF(p_data->>'bank_name',''), bank_name),
      branch_code = COALESCE(NULLIF(p_data->>'branch_code',''), branch_code),
      iban = COALESCE(NULLIF(p_data->>'iban',''), iban),
      swift_code = COALESCE(NULLIF(p_data->>'swift_code',''), swift_code),
      display_order = COALESCE((p_data->>'display_order')::int, display_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      is_default = COALESCE((p_data->>'is_default')::bool, is_default),
      notes = COALESCE(NULLIF(p_data->>'notes',''), notes),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- B3. create_additional_receivable
CREATE OR REPLACE FUNCTION public.create_additional_receivable(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  INSERT INTO public.additional_receivables (
    company_id, sale_id, unit_id, client_id, amount, description,
    due_date, status, notes, created_by
  ) VALUES (
    p_company_id, (p_data->>'sale_id')::uuid, NULLIF(p_data->>'unit_id','')::uuid,
    NULLIF(p_data->>'client_id','')::uuid, (p_data->>'amount')::numeric,
    p_data->>'description', NULLIF(p_data->>'due_date','')::date,
    COALESCE(p_data->>'status','pending'), NULLIF(p_data->>'notes',''),
    NULLIF(p_data->>'created_by','')::uuid
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- B4. create_agent_transaction
CREATE OR REPLACE FUNCTION public.create_agent_transaction(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_agent uuid := (p_data->>'agent_id')::uuid; v_proj uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT project_id INTO v_proj FROM public.agents WHERE id = v_agent AND company_id = p_company_id;
  INSERT INTO public.agent_transactions (
    company_id, project_id, agent_id, transaction_type, amount, related_sale_id,
    related_cancellation_id, related_transfer_id, payment_method, reference, notes, created_by
  ) VALUES (
    p_company_id, v_proj, v_agent, p_data->>'transaction_type',
    (p_data->>'amount')::numeric, NULLIF(p_data->>'related_sale_id','')::uuid,
    NULLIF(p_data->>'related_cancellation_id','')::uuid, NULLIF(p_data->>'related_transfer_id','')::uuid,
    NULLIF(p_data->>'payment_method',''), NULLIF(p_data->>'reference',''), NULLIF(p_data->>'notes',''),
    NULLIF(p_data->>'created_by','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- B5. create_agent_commission_payment_full
CREATE OR REPLACE FUNCTION public.create_agent_commission_payment_full(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_row jsonb; v_agent uuid := (p_data->>'agent_id')::uuid; v_proj uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT project_id INTO v_proj FROM public.agents WHERE id = v_agent AND company_id = p_company_id;
  INSERT INTO public.agent_commission_payments (company_id, project_id, agent_id, sale_id, amount, payment_date, payment_method, reference_no, notes, created_by)
  VALUES (p_company_id, v_proj, v_agent, NULLIF(p_data->>'sale_id','')::uuid,
          (p_data->>'amount')::numeric, COALESCE((p_data->>'payment_date')::date, CURRENT_DATE),
          COALESCE(p_data->>'payment_method','bank_transfer'), NULLIF(p_data->>'reference_no',''),
          NULLIF(p_data->>'notes',''), NULLIF(p_data->>'created_by',''))
  RETURNING id INTO v_id;
  SELECT to_jsonb(acp) INTO v_row FROM public.agent_commission_payments acp WHERE acp.id = v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'row', v_row);
END $function$;

-- B6. snapshot_installment_schedule
CREATE OR REPLACE FUNCTION public.snapshot_installment_schedule(p_company_id uuid, p_sale_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_snap jsonb;
  v_me   public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'installment_number', installment_number,
      'installment_type',   installment_type,
      'due_date',           due_date,
      'amount',             amount,
      'notes',              notes
    ) ORDER BY due_date NULLS LAST, installment_number
  ) INTO v_snap
  FROM public.installments
  WHERE company_id = p_company_id
    AND sale_id    = p_sale_id;

  INSERT INTO public.installment_snapshots (company_id, sale_id, snapshot, taken_at)
  VALUES (p_company_id, p_sale_id, COALESCE(v_snap, '[]'::jsonb), now())
  ON CONFLICT (company_id, sale_id)
  DO UPDATE SET
    snapshot = COALESCE(v_snap, '[]'::jsonb),
    taken_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'count',   jsonb_array_length(COALESCE(v_snap, '[]'::jsonb))
  );
END;
$function$;
