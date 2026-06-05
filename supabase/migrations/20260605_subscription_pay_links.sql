-- ============================================================================
-- One-click tokenized subscription pay-links (no login required)
-- ----------------------------------------------------------------------------
-- A renewal email's "Pay Now" button opens pay.html?t=<token> and the tenant
-- pays + uploads proof WITHOUT logging in. The token is a high-entropy bearer
-- capability scoped to ONE invoice, single-use, with an expiry.
--
-- Security surface (anon-callable, SECURITY DEFINER, exact-token lookup only):
--   get_subscription_pay_link(token)        -> invoice summary + payment accounts
--   submit_subscription_pay_proof(token,..) -> create proof + payment_under_review
--   paylink_token_valid(token)              -> bool, used by the storage policy
-- The token table itself is RLS-locked (no anon/auth policy) — only the
-- definer functions and the service role can read it. No enumeration is
-- possible: every path keys off the exact token.
--
-- Also: renewal invoices are now generated EARLY (at the first reminder) via
-- _ensure_renewal_invoice(), so the link works from 5 days out; and
-- verify_payment now extends the period from GREATEST(now, current_period_end)
-- so paying early never loses the remaining paid days (monthly + yearly).
-- ============================================================================

-- ── Token store ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_pay_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + INTERVAL '30 days',
  used_at     timestamptz,
  revoked     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sub_pay_links_invoice ON public.subscription_pay_links(invoice_id);
ALTER TABLE public.subscription_pay_links ENABLE ROW LEVEL SECURITY;
-- intentionally NO policies → locked to SECURITY DEFINER fns + service role only
REVOKE ALL ON public.subscription_pay_links FROM anon, authenticated;

-- ── Ensure an unpaid renewal invoice exists for a subscription ───────────────
CREATE OR REPLACE FUNCTION public._ensure_renewal_invoice(p_sub_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_sub  public.subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_inv  uuid;
  v_no   text;
  v_ps   date := CURRENT_DATE;
  v_pe   date;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id LIMIT 1;
  IF v_plan.id IS NULL OR v_plan.plan_code = 'free_trial' OR COALESCE(v_plan.price,0) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_inv FROM public.invoices
   WHERE subscription_id = p_sub_id AND status = 'unpaid'
   ORDER BY created_at DESC LIMIT 1;
  IF v_inv IS NOT NULL THEN RETURN v_inv; END IF;

  v_pe := CASE v_plan.billing_cycle
            WHEN 'yearly' THEN v_ps + INTERVAL '1 year'  - INTERVAL '1 day'
            ELSE               v_ps + INTERVAL '1 month' - INTERVAL '1 day' END;
  v_no := public.generate_invoice_number(v_sub.company_id);

  INSERT INTO public.invoices (
    company_id, subscription_id, invoice_number, plan_id, plan_name,
    billing_cycle, amount, currency, period_start, period_end,
    issue_date, due_date, status, notes
  ) VALUES (
    v_sub.company_id, p_sub_id, v_no, v_plan.id, v_plan.plan_name,
    v_plan.billing_cycle, v_plan.price, v_plan.currency,
    v_ps, v_pe, CURRENT_DATE, CURRENT_DATE + 7, 'unpaid',
    'Renewal invoice'
  ) RETURNING id INTO v_inv;
  RETURN v_inv;
END;
$function$;

-- ── Get-or-create a pay-link token for an unpaid invoice ─────────────────────
CREATE OR REPLACE FUNCTION public._ensure_subscription_pay_link(p_invoice_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_inv   public.invoices%ROWTYPE;
  v_token text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id LIMIT 1;
  IF NOT FOUND OR v_inv.status <> 'unpaid' THEN RETURN NULL; END IF;

  SELECT token INTO v_token FROM public.subscription_pay_links
   WHERE invoice_id = p_invoice_id AND used_at IS NULL AND NOT revoked AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.subscription_pay_links (token, invoice_id, company_id, expires_at)
  VALUES (v_token, p_invoice_id, v_inv.company_id,
          GREATEST(now() + INTERVAL '30 days', v_inv.due_date::timestamptz + INTERVAL '30 days'));
  RETURN v_token;
END;
$function$;

-- ── Validator used by the storage upload policy ──────────────────────────────
CREATE OR REPLACE FUNCTION public.paylink_token_valid(p_token text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.subscription_pay_links
    WHERE token = p_token AND used_at IS NULL AND NOT revoked AND expires_at > now()
  );
$function$;

-- ── Public: fetch invoice + accounts for a valid token ───────────────────────
CREATE OR REPLACE FUNCTION public.get_subscription_pay_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_link public.subscription_pay_links%ROWTYPE;
  v_inv  public.invoices%ROWTYPE;
  v_co   public.companies%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.subscription_pay_links
   WHERE token = p_token AND NOT revoked AND expires_at > now() LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired'); END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = v_link.invoice_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'invoice_not_found'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE id = v_link.company_id LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'already_paid', (v_inv.status = 'paid'),
    'used', (v_link.used_at IS NOT NULL),
    'invoice', jsonb_build_object(
      'invoice_number', v_inv.invoice_number, 'plan_name', v_inv.plan_name,
      'billing_cycle', v_inv.billing_cycle, 'amount', v_inv.amount, 'currency', v_inv.currency,
      'period_start', v_inv.period_start, 'period_end', v_inv.period_end,
      'due_date', v_inv.due_date, 'status', v_inv.status),
    'company', jsonb_build_object('name', v_co.company_name, 'code', v_co.company_code),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pm.id, 'method_type', pm.method_type, 'method_name', pm.method_name,
        'account_title', pm.account_title, 'account_number', pm.account_number,
        'iban', pm.iban, 'branch_name', pm.branch_name) ORDER BY pm.display_order)
      FROM public.payment_methods pm WHERE pm.is_active), '[]'::jsonb),
    'partner', (
      SELECT jsonb_build_object('name', pp.partner_name, 'whatsapp', pp.partner_whatsapp,
        'phone', pp.partner_phone, 'email', pp.partner_email)
      FROM public.payment_partners pp WHERE pp.is_active ORDER BY pp.display_order LIMIT 1)
  );
END;
$function$;

-- ── Public: submit a payment proof against a valid token ─────────────────────
CREATE OR REPLACE FUNCTION public.submit_subscription_pay_proof(
  p_token text,
  p_payment_method_id uuid,
  p_reference_number text,
  p_amount_paid numeric,
  p_currency text,
  p_payment_date date,
  p_receipt_url text,
  p_receipt_filename text DEFAULT NULL,
  p_receipt_size_kb integer DEFAULT NULL,
  p_payer_name text DEFAULT NULL,
  p_payer_account text DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_link    public.subscription_pay_links%ROWTYPE;
  v_inv     public.invoices%ROWTYPE;
  v_partner uuid;
  v_proof   uuid;
BEGIN
  SELECT * INTO v_link FROM public.subscription_pay_links
   WHERE token = p_token AND used_at IS NULL AND NOT revoked AND expires_at > now()
   FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired'); END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = v_link.invoice_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'invoice_not_found'); END IF;
  IF v_inv.status = 'paid' THEN RETURN jsonb_build_object('success', false, 'error', 'already_paid'); END IF;

  IF COALESCE(p_amount_paid, 0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_amount'); END IF;
  IF p_payment_date IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'date_required'); END IF;
  IF COALESCE(TRIM(p_reference_number), '') = '' THEN RETURN jsonb_build_object('success', false, 'error', 'reference_required'); END IF;

  -- resolve partner from the chosen (active) method, if any
  IF p_payment_method_id IS NOT NULL THEN
    SELECT partner_id INTO v_partner FROM public.payment_methods WHERE id = p_payment_method_id AND is_active LIMIT 1;
  END IF;

  INSERT INTO public.payment_proofs (
    company_id, invoice_id, submitted_by, payment_method_id, payment_partner_id,
    reference_number, amount_paid, currency, payment_date, payer_name, payer_account,
    receipt_url, receipt_filename, receipt_size_kb, notes_from_user, status, metadata
  ) VALUES (
    v_link.company_id, v_link.invoice_id, NULL, p_payment_method_id, v_partner,
    TRIM(p_reference_number), p_amount_paid, COALESCE(p_currency, 'PKR'), p_payment_date,
    NULLIF(TRIM(COALESCE(p_payer_name, '')), ''), NULLIF(TRIM(COALESCE(p_payer_account, '')), ''),
    p_receipt_url, NULLIF(TRIM(COALESCE(p_receipt_filename, '')), ''), p_receipt_size_kb,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'pending',
    jsonb_build_object('source', 'pay_link')
  ) RETURNING id INTO v_proof;

  -- if the tenant was already locked, move to under-review (active subs stay active)
  UPDATE public.subscriptions SET status = 'payment_under_review', updated_at = now()
   WHERE company_id = v_link.company_id AND status = 'pending_payment';

  UPDATE public.subscription_pay_links SET used_at = now() WHERE id = v_link.id;

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error');
END;
$function$;

-- ── Grants: expose only the two public RPCs (+ validator) to anon ────────────
-- REVOKE from PUBLIC too — Postgres grants EXECUTE to PUBLIC by default, so
-- revoking only anon/authenticated would still leave these internal helpers
-- callable by anon (which could mint a pay-link token for ANY invoice).
REVOKE ALL ON FUNCTION public._ensure_renewal_invoice(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ensure_subscription_pay_link(uuid)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.paylink_token_valid(text)              TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_subscription_pay_link(text)        TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.submit_subscription_pay_proof(text, uuid, text, numeric, text, date, text, text, integer, text, text, text) TO anon, authenticated;

-- ── Storage: allow anon to upload ONLY under paylink/<valid-token>/ ──────────
DROP POLICY IF EXISTS paylink_anon_upload ON storage.objects;
CREATE POLICY paylink_anon_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[1] = 'paylink'
    AND public.paylink_token_valid((storage.foldername(name))[2])
  );

-- ── verify_payment: extend from GREATEST(now, current_period_end) ────────────
CREATE OR REPLACE FUNCTION public.verify_payment(p_proof_id uuid, p_action text, p_verified_by uuid, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_proof public.payment_proofs%ROWTYPE;
  v_inv   public.invoices%ROWTYPE;
  v_plan  public.subscription_plans%ROWTYPE;
  v_me    public.app_users;
  v_verifier uuid;
BEGIN
  PERFORM public._rms_require_super_admin();
  v_me := public._rms_caller();
  v_verifier := v_me.id;

  SELECT * INTO v_proof FROM public.payment_proofs WHERE id = p_proof_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'proof_not_found'); END IF;
  IF p_action NOT IN ('approve', 'reject', 'needs_info') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END IF;
  IF v_proof.invoice_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.invoices WHERE id = v_proof.invoice_id LIMIT 1;
    IF FOUND THEN SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_inv.plan_id LIMIT 1; END IF;
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.payment_proofs SET status='approved', verified_by=v_verifier, verified_at=NOW(),
      verification_notes=p_notes, updated_at=NOW() WHERE id = p_proof_id;
    IF v_proof.invoice_id IS NOT NULL THEN
      UPDATE public.invoices SET status='paid', paid_date=CURRENT_DATE, updated_at=NOW()
        WHERE id = v_proof.invoice_id;
    END IF;
    -- Extend the subscription tied to the invoice (fallback: latest for company).
    -- Base = later of (current end, now) so early renewal stacks; lapsed starts now.
    UPDATE public.subscriptions s SET
      status='active',
      current_period_start = CASE WHEN COALESCE(s.current_period_end, NOW()) < NOW()
                                  THEN NOW() ELSE s.current_period_start END,
      current_period_end = GREATEST(COALESCE(s.current_period_end, NOW()), NOW())
        + CASE WHEN COALESCE(v_plan.billing_cycle, 'monthly') = 'yearly'
               THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END,
      updated_at=NOW()
    WHERE s.id = COALESCE(
      v_inv.subscription_id,
      (SELECT id FROM public.subscriptions WHERE company_id = v_proof.company_id ORDER BY created_at DESC LIMIT 1));
  ELSIF p_action = 'reject' THEN
    UPDATE public.payment_proofs SET status='rejected', verified_by=v_verifier, verified_at=NOW(),
      rejection_reason=p_notes, updated_at=NOW() WHERE id = p_proof_id;
    UPDATE public.subscriptions SET status='pending_payment', updated_at=NOW()
      WHERE company_id = v_proof.company_id AND status='payment_under_review';
  ELSIF p_action = 'needs_info' THEN
    UPDATE public.payment_proofs SET status='needs_info', verified_by=v_verifier, verified_at=NOW(),
      verification_notes=p_notes, updated_at=NOW() WHERE id = p_proof_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'action', p_action);
END;
$function$;
