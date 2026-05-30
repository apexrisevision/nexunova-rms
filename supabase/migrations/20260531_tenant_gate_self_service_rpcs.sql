-- ════════════════════════════════════════════════════════════
-- TENANT-GATE on 9 self-service RPCs (P0 follow-up)
-- 2026-05-31. Same bug class as T1-T6 + super_admin_guard:
-- SECURITY DEFINER functions that accept a tenant-scope parameter
-- (p_company_id or equivalent) and trust it without verifying it
-- matches the caller's company.
-- ════════════════════════════════════════════════════════════
-- Empirically reproduced: CO1 owner (non-super-admin) called
--   save_company_branding(CO2_uuid, {'company_name':'HOSTILE NEXUNOVA REWRITE',...})
--   update_company_settings(CO2_uuid, {'brand_color':'#FF00FF','currency':'XXX'})
--   mark_onboarding_complete(CO2_uuid)
-- All three landed against CO2's row. ROLLBACK was the only thing
-- preventing real damage. Same severity class as suspend_company.
--
-- Fix: standard T1 prepend.
--   • Resolve caller via _rms_caller()
--   • If no session  → 'auth_required'
--   • If caller is super_admin → bypass (platform staff)
--   • If caller.company_id != p_company_id → 'wrong_tenant'
--   • Body otherwise verbatim
--
-- Variants:
--   • save_company_branding RETURNS void → RAISE EXCEPTION (42501) for
--     the wrong_tenant case rather than envelope return.
--   • create_sa_support_ticket gets company_id from p_data (no
--     dedicated param); gate on that + override submitted_by with
--     caller's id so attribution can't be forged.
--   • create_invoice_for_subscription has no p_company_id; derive it
--     from the subscription row and gate on that.
--   • submit_payment_proof: tenant gate + override p_submitted_by with
--     the caller's app_users.id so payment audit can't be forged.
--   • get_admin_audit_feed (sql → plpgsql so guard fits): wrong_tenant
--     returns empty envelope, auth_required mirrors.

-- ────────────────── 1. update_company ──────────────────

CREATE OR REPLACE FUNCTION public.update_company(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  UPDATE public.companies SET
    company_name = COALESCE(p_data->>'company_name', company_name),
    business_email = COALESCE(NULLIF(p_data->>'business_email',''), business_email),
    business_phone = COALESCE(NULLIF(p_data->>'business_phone',''), business_phone),
    business_address = COALESCE(NULLIF(p_data->>'business_address',''), business_address),
    tax_id = COALESCE(NULLIF(p_data->>'tax_id',''), tax_id),
    website = COALESCE(NULLIF(p_data->>'website',''), website),
    logo_url = COALESCE(NULLIF(p_data->>'logo_url',''), logo_url),
    industry = COALESCE(NULLIF(p_data->>'industry',''), industry),
    updated_at = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- ────────────────── 2. update_company_profile ──────────────────

CREATE OR REPLACE FUNCTION public.update_company_profile(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  UPDATE public.companies SET
    company_name   = COALESCE(p_data->>'company_name', company_name),
    company_type   = COALESCE(p_data->>'company_type', company_type),
    business_email = COALESCE(NULLIF(p_data->>'business_email',''), business_email),
    business_phone = COALESCE(NULLIF(p_data->>'business_phone',''), business_phone),
    city           = COALESCE(NULLIF(p_data->>'city',''), city),
    country        = COALESCE(p_data->>'country', country),
    address        = COALESCE(NULLIF(p_data->>'address',''), address),
    logo_url       = COALESCE(NULLIF(p_data->>'logo_url',''), logo_url),
    updated_at     = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('success', true);
END
$function$;

-- ────────────────── 3. update_company_settings ──────────────────

CREATE OR REPLACE FUNCTION public.update_company_settings(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  UPDATE companies SET
    brand_color = COALESCE(NULLIF(p_data->>'brand_color',''), brand_color),
    currency    = COALESCE(NULLIF(p_data->>'currency',''),    currency),
    timezone    = COALESCE(NULLIF(p_data->>'timezone',''),    timezone),
    updated_at  = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────── 4. save_company_branding (RETURNS void; RAISE on wrong_tenant) ──────────────────

CREATE OR REPLACE FUNCTION public.save_company_branding(p_company_id uuid, p_data jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'wrong_tenant' USING ERRCODE = '42501';
  END IF;

  UPDATE companies SET
    company_name          = COALESCE(NULLIF(p_data->>'company_name', ''), company_name),
    business_email        = NULLIF(p_data->>'business_email', ''),
    business_phone        = NULLIF(p_data->>'business_phone', ''),
    city                  = NULLIF(p_data->>'city', ''),
    country               = COALESCE(NULLIF(p_data->>'country', ''), 'Pakistan'),
    address               = NULLIF(p_data->>'address', ''),
    onboarding_complete   = COALESCE((p_data->>'onboarding_complete')::boolean, onboarding_complete),
    updated_at            = now()
  WHERE id = p_company_id;

  INSERT INTO company_branding (
    company_id, letterhead_subtitle, address_full, ntn_number,
    registration_number, doc_brand_color, accent_color,
    signature_name, signature_title, footer_text
  ) VALUES (
    p_company_id,
    COALESCE(NULLIF(p_data->>'letterhead_subtitle', ''), 'Recovery Management System'),
    NULLIF(p_data->>'address_full', ''),
    NULLIF(p_data->>'ntn_number', ''),
    NULLIF(p_data->>'registration_number', ''),
    COALESCE(NULLIF(p_data->>'doc_brand_color', ''), '#1E2D47'),
    COALESCE(NULLIF(p_data->>'accent_color', ''), '#C9A84C'),
    NULLIF(p_data->>'signature_name', ''),
    COALESCE(NULLIF(p_data->>'signature_title', ''), 'Authorized Signatory'),
    NULLIF(p_data->>'footer_text', '')
  )
  ON CONFLICT (company_id) DO UPDATE SET
    letterhead_subtitle = COALESCE(NULLIF(p_data->>'letterhead_subtitle', ''), 'Recovery Management System'),
    address_full        = NULLIF(p_data->>'address_full', ''),
    ntn_number          = NULLIF(p_data->>'ntn_number', ''),
    registration_number = NULLIF(p_data->>'registration_number', ''),
    doc_brand_color     = COALESCE(NULLIF(p_data->>'doc_brand_color', ''), company_branding.doc_brand_color),
    accent_color        = COALESCE(NULLIF(p_data->>'accent_color', ''), company_branding.accent_color),
    signature_name      = NULLIF(p_data->>'signature_name', ''),
    signature_title     = COALESCE(NULLIF(p_data->>'signature_title', ''), company_branding.signature_title),
    footer_text         = NULLIF(p_data->>'footer_text', ''),
    updated_at          = now();
END;
$function$;

-- ────────────────── 5. mark_onboarding_complete ──────────────────

CREATE OR REPLACE FUNCTION public.mark_onboarding_complete(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  UPDATE public.companies
  SET onboarding_complete = true
  WHERE id = p_company_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ────────────────── 6. get_admin_audit_feed (sql → plpgsql) ──────────────────

CREATE OR REPLACE FUNCTION public.get_admin_audit_feed(p_company_id uuid, p_limit integer DEFAULT 80)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users;
  v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('error', 'auth_required', 'transfers', '[]'::jsonb, 'reminders', '[]'::jsonb, 'possessions', '[]'::jsonb);
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('error', 'wrong_tenant', 'transfers', '[]'::jsonb, 'reminders', '[]'::jsonb, 'possessions', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'transfers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'from_owner', COALESCE(c_old.full_name, ''),
        'to_owner',   COALESCE(c_new.full_name, ''),
        'transfer_date', t.transfer_date,
        'created_by', t.created_by, 'created_at', t.created_at,
        'units', jsonb_build_object('unit_no', u.unit_no)
      ) ORDER BY t.created_at DESC)
      FROM public.unit_transfers t
      LEFT JOIN public.units u    ON u.id = t.unit_id
      LEFT JOIN public.clients c_old ON c_old.id = t.old_client_id
      LEFT JOIN public.clients c_new ON c_new.id = t.new_client_id
      WHERE t.company_id = p_company_id
      LIMIT 30
    ), '[]'::jsonb),
    'reminders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'client_name', r.client_name, 'reminder_type', r.reminder_type,
        'amount_due', r.amount_due, 'sent_by', r.sent_by, 'sent_at', r.sent_at
      ) ORDER BY r.sent_at DESC)
      FROM public.reminder_logs r WHERE r.company_id = p_company_id LIMIT 30
    ), '[]'::jsonb),
    'possessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'client_name', p.client_name, 'status', p.status,
        'possession_date', p.possession_date, 'created_by', p.created_by, 'updated_at', p.updated_at,
        'units', jsonb_build_object('unit_no', u.unit_no)
      ) ORDER BY p.updated_at DESC)
      FROM public.possessions p
      LEFT JOIN public.units u ON u.id = p.unit_id
      WHERE p.company_id = p_company_id
      LIMIT 20
    ), '[]'::jsonb)
  ) INTO v_rows;
  RETURN v_rows;
END;
$function$;

-- ────────────────── 7. create_sa_support_ticket (company_id from p_data + submitter override) ──────────────────

CREATE OR REPLACE FUNCTION public.create_sa_support_ticket(p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users;
  v_company_id uuid;
  v_id uuid := gen_random_uuid();
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;

  v_company_id := NULLIF(p_data->>'company_id','')::uuid;
  -- Super-admin may file on behalf of any tenant; everyone else must match their own company.
  IF NOT COALESCE(v_me.is_super_admin, false) THEN
    IF v_company_id IS NULL THEN
      v_company_id := v_me.company_id;
    ELSIF v_company_id IS DISTINCT FROM v_me.company_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
    END IF;
  END IF;

  INSERT INTO sa_support_tickets (id, company_id, company_name, submitted_by, subject, body, category, priority)
  VALUES (
    v_id,
    v_company_id,
    NULLIF(p_data->>'company_name',''),
    v_me.id::text,                                            -- override caller-supplied submitter
    p_data->>'subject',
    NULLIF(p_data->>'body',''),
    COALESCE(NULLIF(p_data->>'category',''), 'general'),
    COALESCE(NULLIF(p_data->>'priority',''), 'normal')
  );
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────── 8. create_invoice_for_subscription (gate on sub's company_id) ──────────────────

CREATE OR REPLACE FUNCTION public.create_invoice_for_subscription(p_subscription_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me      public.app_users;
  v_sub     public.subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_inv_no  TEXT;
  v_inv_id  UUID;
  v_period_start DATE := CURRENT_DATE;
  v_period_end   DATE;
  v_due_date     DATE := CURRENT_DATE + 7;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'subscription_not_found');
  END IF;

  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_sub.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;

  IF v_plan.plan_code = 'free_trial' OR v_plan.price = 0 THEN
    RETURN jsonb_build_object('success', true, 'invoice_id', NULL, 'skipped', true);
  END IF;

  v_period_end := CASE v_plan.billing_cycle
    WHEN 'yearly'  THEN v_period_start + INTERVAL '1 year' - INTERVAL '1 day'
    ELSE                v_period_start + INTERVAL '1 month' - INTERVAL '1 day'
  END;

  v_inv_no := public.generate_invoice_number(v_sub.company_id);

  INSERT INTO public.invoices (
    company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end,
    issue_date, due_date, status
  ) VALUES (
    v_sub.company_id, p_subscription_id, v_inv_no, v_plan.id, v_plan.plan_name,
    v_plan.billing_cycle, v_plan.price, v_plan.currency,
    v_period_start, v_period_end,
    CURRENT_DATE, v_due_date, 'unpaid'
  )
  RETURNING id INTO v_inv_id;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_inv_id, 'invoice_number', v_inv_no);
END;
$function$;

-- ────────────────── 9. submit_payment_proof (tenant gate + submitter override) ──────────────────

CREATE OR REPLACE FUNCTION public.submit_payment_proof(
  p_company_id uuid, p_invoice_id uuid, p_submitted_by uuid,
  p_payment_method_id uuid, p_payment_partner_id uuid,
  p_reference_number text, p_amount_paid numeric, p_currency text,
  p_payment_date date, p_receipt_url text,
  p_receipt_filename text DEFAULT NULL::text,
  p_receipt_size_kb integer DEFAULT NULL::integer,
  p_payer_name text DEFAULT NULL::text,
  p_payer_account text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me        public.app_users;
  v_submitter uuid;
  v_proof_id  UUID;
  v_sub_id    UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  -- Override caller-supplied p_submitted_by with the caller's actual app_users.id
  v_submitter := v_me.id;

  -- Validate company owns invoice
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = p_invoice_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invoice_not_found');
  END IF;

  INSERT INTO public.payment_proofs (
    company_id, invoice_id, submitted_by,
    payment_method_id, payment_partner_id,
    reference_number, amount_paid, currency,
    payment_date, payer_name, payer_account,
    receipt_url, receipt_filename, receipt_size_kb,
    notes_from_user, status
  ) VALUES (
    p_company_id, p_invoice_id, v_submitter,
    p_payment_method_id, p_payment_partner_id,
    TRIM(p_reference_number), p_amount_paid, COALESCE(p_currency, 'PKR'),
    p_payment_date,
    NULLIF(TRIM(COALESCE(p_payer_name,'')), ''),
    NULLIF(TRIM(COALESCE(p_payer_account,'')), ''),
    p_receipt_url,
    NULLIF(TRIM(COALESCE(p_receipt_filename,'')), ''),
    p_receipt_size_kb,
    NULLIF(TRIM(COALESCE(p_notes,'')), ''),
    'pending'
  )
  RETURNING id INTO v_proof_id;

  UPDATE public.subscriptions
  SET status = 'payment_under_review', updated_at = NOW()
  WHERE company_id = p_company_id
    AND status IN ('pending_payment', 'payment_under_review')
  RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object(
    'success',  true,
    'proof_id', v_proof_id,
    'sub_id',   v_sub_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
