-- ============================================================================
-- PLATFORM SUBSCRIPTION INVOICING (Commit 1 — DB layer)
-- ----------------------------------------------------------------------------
-- Extends the EXISTING billing stack (invoices, payment_proofs, subscription_
-- pay_links, the reminder/expiry crons, platform_settings/audit) — no new
-- invoice table. Adds: 25th-of-month due dates, received/balance + status
-- derivation, per-company billing contact + grace, reconciliation of manual
-- payment into the open cycle invoice, a render-data RPC for the PDF edge fn,
-- a private invoices bucket, and placeholder platform settings.
--
-- SAFE-BY-DEFAULT: does NOT change expiry TIMING for anyone (grace_days only
-- drives PDF wording + is available for future use). Auto-send of the PDF
-- invoice email is gated behind platform_settings→subscription_invoicing
-- .autosend_enabled = FALSE (flipped on by super-admin after approval).
-- Additive throughout.
-- ============================================================================

-- ── 1. Private invoices bucket ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
SELECT 'platform-invoices', 'platform-invoices', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'platform-invoices');

-- ── 1b. Widen invoice status vocabulary (adds draft/sent/partial) ────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY['draft','unpaid','sent','partial','paid','overdue','cancelled','refunded']::text[]));

-- ── 2. Platform settings (org = ADMIN company) ──────────────────────────────
-- Bank details (placeholder until real values supplied).
INSERT INTO public.platform_settings (organization_id, setting_key, setting_value, category)
SELECT 'f46bb375-2140-441f-ae31-78fb47a9621a', 'platform_bank_details',
       jsonb_build_object(
         'bank_name', '', 'account_title', '', 'account_no', '', 'iban', '',
         'note', 'Please reference your invoice number with the payment.',
         'placeholder', true),
       'billing'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings
                  WHERE organization_id='f46bb375-2140-441f-ae31-78fb47a9621a'
                    AND setting_key='platform_bank_details');

-- Auto-send master switch — OFF by default (no real tenant emailed until on).
INSERT INTO public.platform_settings (organization_id, setting_key, setting_value, category)
SELECT 'f46bb375-2140-441f-ae31-78fb47a9621a', 'subscription_invoicing',
       jsonb_build_object('autosend_enabled', false), 'billing'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings
                  WHERE organization_id='f46bb375-2140-441f-ae31-78fb47a9621a'
                    AND setting_key='subscription_invoicing');

-- Dispatch secret: the send-invoice edge fn's trusted server path (cron) presents
-- this as x-invoice-secret. Random per environment; generated once.
INSERT INTO public.platform_settings (organization_id, setting_key, setting_value, category)
SELECT 'f46bb375-2140-441f-ae31-78fb47a9621a', 'invoice_dispatch_secret',
       to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')), 'billing'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings
                  WHERE organization_id='f46bb375-2140-441f-ae31-78fb47a9621a'
                    AND setting_key='invoice_dispatch_secret');

-- ── 3. Helpers ──────────────────────────────────────────────────────────────
-- 25th of the month the anchor date falls in.
CREATE OR REPLACE FUNCTION public._platform_invoice_due_date(p_anchor date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('month', p_anchor)::date + 24);
$$;

-- Per-company grace days (default 15). Drives PDF policy wording; NOT expiry timing.
CREATE OR REPLACE FUNCTION public._company_grace_days(p_company_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT (setting_value #>> '{}')::int FROM public.platform_settings
      WHERE organization_id = p_company_id AND setting_key = 'billing_grace_days' LIMIT 1),
    15);
$$;

-- Billing recipient: business_email when set, else owner/admin app_user email.
CREATE OR REPLACE FUNCTION public._billing_email(p_company_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_email text;
BEGIN
  SELECT NULLIF(TRIM(business_email), '') INTO v_email FROM public.companies WHERE id = p_company_id;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;
  SELECT email INTO v_email FROM public.app_users
   WHERE company_id = p_company_id AND role IN ('owner','admin')
     AND email IS NOT NULL AND status = 'active'
   ORDER BY (role='owner') DESC, created_at ASC LIMIT 1;
  RETURN v_email;
END $$;

-- Approved amount received against an invoice.
CREATE OR REPLACE FUNCTION public._invoice_received(p_invoice_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(amount_paid), 0) FROM public.payment_proofs
   WHERE invoice_id = p_invoice_id AND status = 'approved';
$$;

-- Platform bank details = SINGLE SOURCE OF TRUTH = payment_methods (the same
-- active receiving accounts pay.html shows tenants). Note line from the setting.
CREATE OR REPLACE FUNCTION public._platform_bank_details()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'methods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'method_name', method_name, 'method_type', method_type,
        'account_title', account_title, 'account_number', account_number,
        'iban', iban, 'branch', branch_name) ORDER BY display_order, created_at)
      FROM public.payment_methods WHERE is_active), '[]'::jsonb),
    'note', COALESCE(
      (SELECT setting_value ->> 'note' FROM public.platform_settings
        WHERE setting_key = 'platform_bank_details' LIMIT 1),
      'Please reference your invoice number with the payment.'),
    'placeholder', false);
$$;

-- ── 4. Everything the PDF edge fn / super-admin UI need for one invoice ──────
-- Authorization: service_role (edge fn via service key) OR a super-admin caller.
-- VOLATILE: lazily mints the invoice's pay-link (idempotent) so the PDF can
-- surface the secure pay page instead of listing bank accounts.
CREATE OR REPLACE FUNCTION public.get_invoice_render_data(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv    public.invoices%ROWTYPE;
  v_co     public.companies%ROWTYPE;
  v_me     public.app_users;
  v_role   text;
  v_recv   numeric;
  v_grace  int;
  v_status text;
  v_pays   jsonb;
  v_token  text;
  v_pay_url text;
BEGIN
  v_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  v_me   := public._rms_caller();
  IF COALESCE(v_role,'') <> 'service_role' AND NOT COALESCE(v_me.is_super_admin, false) THEN
    RAISE EXCEPTION 'forbidden_not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_co FROM public.companies WHERE id = v_inv.company_id;

  v_recv  := public._invoice_received(p_invoice_id);
  v_grace := public._company_grace_days(v_inv.company_id);
  v_status := CASE
    WHEN v_inv.status = 'paid' OR v_recv >= v_inv.amount THEN 'paid'
    WHEN v_recv > 0 THEN 'partial'
    WHEN v_inv.due_date < CURRENT_DATE THEN 'overdue'
    WHEN v_inv.sent_at IS NOT NULL THEN 'sent'
    ELSE 'unpaid' END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', to_char(payment_date, 'DD Mon YYYY'),
           'reference', reference_number,
           'method', metadata ->> 'method',
           'amount', amount_paid) ORDER BY payment_date), '[]'::jsonb)
    INTO v_pays
    FROM public.payment_proofs
   WHERE invoice_id = p_invoice_id AND status = 'approved';

  v_token   := public._ensure_subscription_pay_link(p_invoice_id);
  v_pay_url := CASE WHEN v_token IS NOT NULL THEN 'https://rms.nexunova.com/pay.html?t=' || v_token ELSE NULL END;

  RETURN jsonb_build_object(
    'invoice_id',    v_inv.id,
    'invoice_number', v_inv.invoice_number,
    'issue_date',    to_char(v_inv.issue_date, 'DD Mon YYYY'),
    'due_date',      to_char(v_inv.due_date, 'DD Mon YYYY'),
    'period_start',  to_char(v_inv.period_start, 'DD Mon YYYY'),
    'period_end',    to_char(v_inv.period_end, 'DD Mon YYYY'),
    'billing_cycle', v_inv.billing_cycle,
    'plan_name',     v_inv.plan_name,
    'amount',        v_inv.amount,
    'currency',      v_inv.currency,
    'tax_amount',    COALESCE(v_inv.tax_amount, 0),
    'received',      v_recv,
    'balance',       GREATEST(v_inv.amount - v_recv, 0),
    'display_status', v_status,
    'overdue',       (v_status = 'overdue'),
    'grace_days',    v_grace,
    'company_id',    v_inv.company_id,
    'company',       jsonb_build_object(
                       'name', v_co.company_name, 'email', v_co.business_email,
                       'address', v_co.address, 'city', v_co.city, 'country', v_co.country),
    'payments',      v_pays,
    'note',          (public._platform_bank_details() ->> 'note'),
    'pay_url',       v_pay_url,
    'billing_email', public._billing_email(v_inv.company_id),
    'pdf_storage_path', v_inv.pdf_storage_path
  );
END $$;
REVOKE ALL ON FUNCTION public.get_invoice_render_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invoice_render_data(uuid) TO authenticated, service_role;

-- Marks an invoice sent (called by the edge fn after emailing) + platform audit.
CREATE OR REPLACE FUNCTION public.mark_invoice_sent(p_invoice_id uuid, p_pdf_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role text; v_me public.app_users; v_inv public.invoices%ROWTYPE;
BEGIN
  v_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  v_me   := public._rms_caller();
  IF COALESCE(v_role,'') <> 'service_role' AND NOT COALESCE(v_me.is_super_admin, false) THEN
    RAISE EXCEPTION 'forbidden_not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invoices
     SET pdf_storage_path = COALESCE(p_pdf_path, pdf_storage_path),
         sent_at = now(),
         status = CASE WHEN status = 'unpaid' THEN 'sent' ELSE status END,
         updated_at = now()
   WHERE id = p_invoice_id
   RETURNING * INTO v_inv;
  IF FOUND THEN
    INSERT INTO public.platform_audit_log (organization_id, user_id, user_name, user_role,
        entity_type, entity_id, action, after_data, module, reason, is_sensitive)
    VALUES (v_inv.company_id, v_me.id, COALESCE(v_me.full_name,'system'), COALESCE(v_me.role,'system'),
        'invoice', v_inv.id::text, 'invoice_sent',
        jsonb_build_object('invoice_number', v_inv.invoice_number, 'pdf_path', v_inv.pdf_storage_path, 'status', v_inv.status),
        'billing', 'Invoice PDF generated & sent', false);
  END IF;
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE ALL ON FUNCTION public.mark_invoice_sent(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_invoice_sent(uuid, text) TO authenticated, service_role;

-- ── 5. Invoice generation: due_date = 25th; dedupe on any OPEN (non-paid) inv ─
CREATE OR REPLACE FUNCTION public._ensure_renewal_invoice(p_sub_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sub  public.subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_inv  uuid;
  v_no   text;
  v_ps   date := CURRENT_DATE;
  v_pe   date;
  v_due  date;
  v_amt  numeric;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price,0) = 0 THEN
    RETURN NULL;
  END IF;

  -- reuse the open cycle invoice (any status except paid / voided)
  SELECT id INTO v_inv FROM public.invoices
   WHERE subscription_id = p_sub_id AND status <> 'paid' AND voided_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_inv IS NOT NULL THEN RETURN v_inv; END IF;

  v_pe  := CASE v_plan.billing_cycle
             WHEN 'yearly' THEN v_ps + INTERVAL '1 year'  - INTERVAL '1 day'
             ELSE               v_ps + INTERVAL '1 month' - INTERVAL '1 day' END;
  v_due := public._platform_invoice_due_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE));
  -- exact stored subscription amount (agreed package), fall back to list price
  v_amt := COALESCE(NULLIF(v_sub.amount, 0), v_plan.price);
  v_no  := public.generate_invoice_number(v_sub.company_id);

  INSERT INTO public.invoices (
    company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end,
    issue_date, due_date, status, notes
  ) VALUES (
    v_sub.company_id, p_sub_id, v_no, v_plan.id, v_plan.plan_name,
    v_plan.billing_cycle, v_amt, COALESCE(v_sub.currency, v_plan.currency),
    v_ps, v_pe, CURRENT_DATE, v_due, 'unpaid', 'Renewal invoice'
  ) RETURNING id INTO v_inv;
  RETURN v_inv;
END $$;

CREATE OR REPLACE FUNCTION public.create_invoice_for_subscription(p_subscription_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me      public.app_users;
  v_sub     public.subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_inv_no  TEXT;
  v_inv_id  UUID;
  v_ps DATE := CURRENT_DATE;
  v_pe DATE;
  v_due DATE;
  v_amt numeric;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'subscription_not_found'); END IF;

  v_me := public._rms_caller();
  IF v_me.id IS NOT NULL AND NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM v_sub.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'plan_not_found'); END IF;
  IF v_plan.plan_code = 'free_trial' OR v_plan.price = 0 THEN
    RETURN jsonb_build_object('success', true, 'invoice_id', NULL, 'skipped', true);
  END IF;

  -- dedupe: one open invoice per subscription
  SELECT id INTO v_inv_id FROM public.invoices
   WHERE subscription_id = p_subscription_id AND status <> 'paid' AND voided_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_inv_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'invoice_id', v_inv_id, 'existing', true);
  END IF;

  v_pe := CASE v_plan.billing_cycle
    WHEN 'yearly' THEN v_ps + INTERVAL '1 year' - INTERVAL '1 day'
    ELSE               v_ps + INTERVAL '1 month' - INTERVAL '1 day' END;
  v_due := public._platform_invoice_due_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE));
  v_amt := COALESCE(NULLIF(v_sub.amount, 0), v_plan.price);
  v_inv_no := public.generate_invoice_number(v_sub.company_id);

  INSERT INTO public.invoices (
    company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end,
    issue_date, due_date, status
  ) VALUES (
    v_sub.company_id, p_subscription_id, v_inv_no, v_plan.id, v_plan.plan_name,
    v_plan.billing_cycle, v_amt, COALESCE(v_sub.currency, v_plan.currency),
    v_ps, v_pe, CURRENT_DATE, v_due, 'unpaid'
  ) RETURNING id INTO v_inv_id;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_inv_id, 'invoice_number', v_inv_no);
END $$;

-- pay-link: allow for any OPEN (non-paid, non-void) invoice
CREATE OR REPLACE FUNCTION public._ensure_subscription_pay_link(p_invoice_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_inv   public.invoices%ROWTYPE;
  v_token text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id LIMIT 1;
  IF NOT FOUND OR v_inv.status = 'paid' OR v_inv.voided_at IS NOT NULL THEN RETURN NULL; END IF;

  SELECT token INTO v_token FROM public.subscription_pay_links
   WHERE invoice_id = p_invoice_id AND used_at IS NULL AND NOT revoked AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.subscription_pay_links (token, invoice_id, company_id, expires_at)
  VALUES (v_token, p_invoice_id, v_inv.company_id,
          GREATEST(now() + INTERVAL '30 days', v_inv.due_date::timestamptz + INTERVAL '30 days'));
  RETURN v_token;
END $$;

-- ── 6. Manual "Record Payment & Extend" — reconcile into the OPEN invoice ────
CREATE OR REPLACE FUNCTION public.admin_extend_subscription(
  p_company_id uuid, p_cycle text, p_amount numeric, p_method text,
  p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me public.app_users; v_sub public.subscriptions%ROWTYPE; v_plan public.subscription_plans%ROWTYPE;
  v_co public.companies%ROWTYPE; v_int interval; v_start timestamptz; v_end timestamptz;
  v_inv uuid; v_no text; v_amt numeric; v_inv_amt numeric; v_recv numeric; v_new_status text;
BEGIN
  PERFORM public._rms_require_super_admin();
  v_me := public._rms_caller();
  IF p_cycle NOT IN ('month','year') THEN RETURN jsonb_build_object('success',false,'error','invalid_cycle'); END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE company_id=p_company_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','no_subscription'); END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=v_sub.plan_id LIMIT 1;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  v_int   := CASE WHEN p_cycle='year' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END;
  v_start := CASE WHEN COALESCE(v_sub.current_period_end, now()) < now() THEN now() ELSE v_sub.current_period_start END;
  v_end   := GREATEST(COALESCE(v_sub.current_period_end, now()), now()) + v_int;
  v_amt   := COALESCE(p_amount, v_plan.price, 0);

  -- reconcile into the OPEN cycle invoice; create one only if none exists
  SELECT id INTO v_inv FROM public.invoices
   WHERE subscription_id = v_sub.id AND status <> 'paid' AND voided_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_inv IS NULL THEN
    v_no := public.generate_invoice_number(p_company_id);
    INSERT INTO public.invoices (company_id,subscription_id,invoice_number,plan_id,plan_name,billing_cycle,
        amount,currency,period_start,period_end,issue_date,due_date,status,notes,metadata)
    VALUES (p_company_id,v_sub.id,v_no,v_sub.plan_id,COALESCE(v_plan.plan_name,'Manual'),p_cycle||'ly',
        v_amt,COALESCE(v_plan.currency,'PKR'),
        GREATEST(COALESCE(v_sub.current_period_end,now()),now())::date, v_end::date,
        CURRENT_DATE, public._platform_invoice_due_date(COALESCE(v_sub.current_period_end::date, CURRENT_DATE)),
        'unpaid','Manual payment recorded by super-admin'||COALESCE(' · ref '||p_reference,''),
        jsonb_build_object('source','admin_manual','method',p_method,'reference',p_reference,'recorded_by',v_me.id,'note',p_note))
    RETURNING id INTO v_inv;
  END IF;

  -- record the approved payment against that invoice
  INSERT INTO public.payment_proofs (company_id,invoice_id,submitted_by,reference_number,amount_paid,currency,
      payment_date,payer_name,receipt_url,status,verified_by,verified_at,verification_notes,metadata)
  VALUES (p_company_id,v_inv,v_me.id,p_reference,v_amt,COALESCE(v_plan.currency,'PKR'),
      CURRENT_DATE,COALESCE(v_co.company_name,''),'admin:manual-recorded','approved',v_me.id,now(),
      'Recorded manually by super-admin'||COALESCE(' · '||p_note,''),
      jsonb_build_object('source','admin_manual','method',p_method));

  -- recompute invoice received/balance/status
  SELECT amount INTO v_inv_amt FROM public.invoices WHERE id = v_inv;
  v_recv := public._invoice_received(v_inv);
  v_new_status := CASE WHEN v_recv >= v_inv_amt THEN 'paid' WHEN v_recv > 0 THEN 'partial' ELSE 'unpaid' END;
  UPDATE public.invoices
     SET status = v_new_status,
         paid_date = CASE WHEN v_new_status='paid' THEN CURRENT_DATE ELSE paid_date END,
         updated_at = now()
   WHERE id = v_inv;

  -- extend the subscription
  UPDATE public.subscriptions SET status='active', current_period_start=v_start, current_period_end=v_end,
      payment_method=COALESCE(p_method,payment_method), cancelled_at=NULL, updated_at=now()
  WHERE id=v_sub.id;

  -- tenant audit (unchanged) + Nexunova platform audit trail
  INSERT INTO public.audit_logs (company_id,table_name,record_id,action,new_data,changed_by,changed_by_name,
      changed_by_role,module,reason,is_sensitive)
  VALUES (p_company_id,'subscriptions',v_sub.id::text,'UPDATE',
      jsonb_build_object('event','manual_payment_extend','cycle',p_cycle,'amount',p_amount,'method',p_method,
        'reference',p_reference,'new_period_end',v_end,'invoice',v_inv,'invoice_status',v_new_status),
      v_me.id,v_me.full_name,v_me.role,'billing','Super-admin recorded payment & extended subscription',true);

  INSERT INTO public.platform_audit_log (organization_id,user_id,user_name,user_role,entity_type,entity_id,
      action,after_data,module,reason,is_sensitive)
  VALUES (p_company_id,v_me.id,v_me.full_name,v_me.role,'invoice',v_inv::text,
      'payment_recorded',
      jsonb_build_object('amount',v_amt,'method',p_method,'reference',p_reference,'invoice_status',v_new_status,'received',v_recv),
      'billing','Super-admin recorded payment & extended subscription',true);

  RETURN jsonb_build_object('success',true,'company_id',p_company_id,'invoice_id',v_inv,
    'invoice_status',v_new_status,'received',v_recv,'balance',GREATEST(v_inv_amt-v_recv,0),
    'new_period_start',v_start,'new_period_end',v_end,'status','active','amount',v_amt,'cycle',p_cycle);
END $$;

-- ── 7. Fourteen Group specifics (confirmed with owner) ──────────────────────
-- Billing recipient → Jasim; hard cutoff this cycle → 25 Jul 2026; grace 0.
UPDATE public.companies
   SET business_email = 'jasiim.jasim@gmail.com', updated_at = now()
 WHERE id = '3249e3b5-c411-4f5f-ae48-0246304c9c87'
   AND COALESCE(NULLIF(TRIM(business_email),''), '') = '';

INSERT INTO public.platform_settings (organization_id, setting_key, setting_value, category)
SELECT '3249e3b5-c411-4f5f-ae48-0246304c9c87', 'billing_grace_days', to_jsonb(0), 'billing'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings
                  WHERE organization_id='3249e3b5-c411-4f5f-ae48-0246304c9c87'
                    AND setting_key='billing_grace_days');

UPDATE public.subscriptions
   SET current_period_end = '2026-07-25 18:59:59+00'::timestamptz, updated_at = now()
 WHERE id = 'c36481c3-e62c-41c5-894b-f9e3b067baa0'
   AND current_period_end = '2026-07-28 18:59:59+00'::timestamptz;  -- guarded: only if unchanged

-- ── 8. Reminder cron: day-5 auto-send the PDF invoice (gated OFF by default) ──
-- On the FIRST reminder (5 days out) email the branded PDF invoice via the
-- send-invoice edge fn — ONLY when subscription_invoicing.autosend_enabled=true
-- (default false → behaviour UNCHANGED). Other days keep the plain reminder.
-- Recipient is business_email-first. See send-invoice edge fn for the render/send.
CREATE OR REPLACE FUNCTION public.cron_subscription_reminders()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v RECORD; v_plan public.subscription_plans%ROWTYPE; v_owner RECORD; v_to text;
  v_days INT; v_expiry TEXT; v_inv uuid; v_token TEXT; v_url TEXT; v_sent INT := 0;
  v_autosend boolean; v_secret text;
BEGIN
  SELECT COALESCE((setting_value ->> 'autosend_enabled')::boolean, false)
    INTO v_autosend FROM public.platform_settings WHERE setting_key='subscription_invoicing' LIMIT 1;
  SELECT (setting_value #>> '{}') INTO v_secret FROM public.platform_settings WHERE setting_key='invoice_dispatch_secret' LIMIT 1;
  FOR v IN
    SELECT s.id AS sub_id, s.company_id, s.current_period_end, s.plan_id, c.company_name, c.company_code
    FROM public.subscriptions s JOIN public.companies c ON c.id = s.company_id
    WHERE s.status = 'active' AND s.current_period_end IS NOT NULL AND c.company_code <> 'ADMIN'
      AND (s.current_period_end::date - CURRENT_DATE) = ANY (ARRAY[5,4,3,2,1,0])
  LOOP
    v_days := (v.current_period_end::date - CURRENT_DATE);
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v.plan_id LIMIT 1;
    IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price, 0) = 0 THEN CONTINUE; END IF;
    SELECT id, full_name, email INTO v_owner FROM public.app_users
     WHERE company_id = v.company_id AND role IN ('owner','admin') AND email IS NOT NULL AND status = 'active'
     ORDER BY (role='owner') DESC, created_at ASC LIMIT 1;
    v_to := COALESCE(public._billing_email(v.company_id), v_owner.email);
    IF v_to IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.platform_email_log
      WHERE organization_id = v.company_id AND template_key = 'renewal_reminder'
        AND variables->>'period_end' = v.current_period_end::date::text
        AND variables->>'days_left'  = v_days::text) THEN CONTINUE; END IF;
    v_inv   := public._ensure_renewal_invoice(v.sub_id);
    v_token := public._ensure_subscription_pay_link(v_inv);
    v_url   := CASE WHEN v_token IS NOT NULL THEN 'https://rms.nexunova.com/pay.html?t=' || v_token
                    ELSE 'https://rms.nexunova.com/login.html' END;
    v_expiry := to_char(v.current_period_end, 'DD Mon YYYY');
    INSERT INTO public.platform_email_log(organization_id, to_email, to_user_id, from_email, template_key, subject, variables, status, provider, category)
    VALUES (v.company_id, v_to, v_owner.id, 'Nexunova RMS <noreply@nexunova.com>', 'renewal_reminder',
      'Your Nexunova subscription expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END,
      jsonb_build_object('days_left', v_days::text, 'period_end', v.current_period_end::date::text,
        'company_name', v.company_name, 'plan_name', v_plan.plan_name, 'amount', v_plan.price::text,
        'currency', v_plan.currency, 'full_name', v_owner.full_name, 'pay_url', v_url,
        'invoice_id', v_inv, 'autosend', (v_autosend AND v_days = 5)),
      'queued', 'resend', 'billing');
    INSERT INTO public.platform_notifications(organization_id, user_id, type, title, body, action_url, action_label, icon, priority, expires_at)
    VALUES (v.company_id, v_owner.id, 'billing',
      'Subscription expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END,
      'Your ' || v_plan.plan_name || ' plan expires on ' || v_expiry || '. Renew now to avoid interruption.',
      v_url, 'Renew now', 'alert-triangle', 'high', v.current_period_end);
    IF v_autosend AND v_days = 5 AND v_inv IS NOT NULL AND v_secret IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-invoice',
        headers := jsonb_build_object('Content-Type','application/json',
                     'apikey','sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG', 'x-invoice-secret', v_secret),
        body := jsonb_build_object('invoice_id', v_inv, 'mode', 'send'));
    ELSE
      PERFORM net.http_post(
        url := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('email', v_to, 'purpose', 'renewal_reminder', 'full_name', v_owner.full_name,
          'company_name', v.company_name, 'days_left', v_days::text, 'expiry_date', v_expiry,
          'amount', v_plan.price::text, 'currency', v_plan.currency, 'plan_name', v_plan.plan_name, 'login_url', v_url));
    END IF;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'reminders_sent', v_sent, 'autosend', v_autosend, 'ran_at', now());
END;
$function$;
