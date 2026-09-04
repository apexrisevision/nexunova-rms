-- ═══════════════════════════════════════════════════════════════════════════
-- Everything the Director PDF is allowed to know
-- ───────────────────────────────────────────────────────────────────────────
-- P7. Three functions: the one payload the renderer reads, the row it writes
-- back, and the list behind screen S3.
--
-- ⚠️ §A10: "Director PDF omits client phone numbers." get_cash_day_pdf_data
-- therefore does not SELECT one. Not masked, not truncated — never fetched, so
-- there is nothing in the edge function that could leak. clients is joined only
-- to reach a name, and units only to reach a unit number. The P7 test asserts
-- the rendered text contains no phone-shaped string.
--
-- next_version is computed here rather than in the renderer, under the same
-- read, so two regenerations racing cannot both claim v2 — record_day_document
-- has UNIQUE (cash_day_id, kind, version) behind it either way.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_cash_day_pdf_data(
  p_company_id uuid, p_cash_day_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_day public.cash_days; v_proj text; v_t record;
  v_receipts jsonb; v_payments jsonb; v_adj jsonb; v_pdc jsonb;
  v_prepared text; v_closer text; v_next int;
BEGIN
  SELECT * INTO v_day FROM public.cash_days WHERE id = p_cash_day_id;
  IF NOT FOUND OR v_day.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_day.project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT project_name INTO v_proj FROM public.projects WHERE id = v_day.project_id;
  SELECT * INTO v_t FROM public._dc_day_totals(v_day.id);

  -- A post-close adjustment is what was written AFTER closed_at — the same
  -- boundary screen S1 uses, and what §A13's ADJUSTMENTS block means. A void
  -- made while the day was open belongs in Payments/Receipts with the rest.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_receipts FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           p.name AS payee, u.unit_no, e.narration
      FROM public.cash_entries e
      LEFT JOIN public.payees p ON p.id = e.payee_id
      LEFT JOIN public.units  u ON u.id = e.unit_id
     WHERE e.cash_day_id = v_day.id AND e.direction = 'IN'
       AND NOT (e.is_adjustment AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at)
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_payments FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           p.name AS payee, u.unit_no, e.narration
      FROM public.cash_entries e
      LEFT JOIN public.payees p ON p.id = e.payee_id
      LEFT JOIN public.units  u ON u.id = e.unit_id
     WHERE e.cash_day_id = v_day.id AND e.direction = 'OUT'
       AND NOT (e.is_adjustment AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at)
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.seq_no), '[]'::jsonb) INTO v_adj FROM (
    SELECT e.seq_no, e.voucher_type || '-' || e.voucher_no AS voucher, e.amount,
           e.direction, e.adjustment_reason AS reason
      FROM public.cash_entries e
     WHERE e.cash_day_id = v_day.id AND e.is_adjustment
       AND v_day.closed_at IS NOT NULL AND e.created_at > v_day.closed_at
  ) x;

  -- Cheques still out, for the project, as of this day. pdc_cheques is the one
  -- register (PDC_DECISION.md) — no phone number is read here either.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.due_date), '[]'::jsonb) INTO v_pdc FROM (
    SELECT c.cheque_no, c.amount, c.cheque_date AS due_date, c.status
      FROM public.pdc_cheques c
     WHERE c.company_id = p_company_id AND c.project_id = v_day.project_id
       AND c.status IN ('pending', 'deposited', 'bounced')
     LIMIT 12
  ) x;

  SELECT full_name INTO v_closer FROM public.app_users WHERE id = v_day.closed_by;
  SELECT u.full_name INTO v_prepared
    FROM public.cash_entries e JOIN public.app_users u ON u.id = e.created_by
   WHERE e.cash_day_id = v_day.id ORDER BY e.seq_no LIMIT 1;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM public.day_documents WHERE cash_day_id = v_day.id AND kind = 'DIRECTOR_PDF';

  RETURN jsonb_build_object(
    'success', true,
    'project_id', v_day.project_id, 'project_name', v_proj,
    'business_date', v_day.business_date, 'status', v_day.status,
    'opening_cash', v_day.opening_cash, 'opening_bank', v_day.opening_bank,
    'in_cash', v_t.in_cash, 'out_cash', v_t.out_cash,
    'in_bank', v_t.in_bank, 'out_bank', v_t.out_bank,
    'closing_cash', COALESCE(v_day.closing_cash, v_day.opening_cash + v_t.in_cash - v_t.out_cash),
    'closing_bank', COALESCE(v_day.closing_bank, v_day.opening_bank + v_t.in_bank - v_t.out_bank),
    'counted_cash', v_day.counted_cash, 'variance', v_day.variance,
    'variance_note', v_day.variance_note,
    'closed_at', v_day.closed_at, 'closed_by_name', v_closer, 'prepared_by', v_prepared,
    'receipts', v_receipts, 'payments', v_payments,
    'adjustments', v_adj, 'pdc_pending', v_pdc,
    'next_version', v_next);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_cash_day_pdf_data(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_day_pdf_data(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_cash_day_pdf_data(uuid, uuid) IS
  'Everything the Director PDF renders. §A10: it deliberately selects NO client phone number, so there is none in the renderer to leak.';

-- ── the version row, written by the renderer with the service key ──────────
CREATE OR REPLACE FUNCTION public.record_day_document(
  p_company_id uuid, p_cash_day_id uuid, p_version integer, p_storage_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cash_days
                  WHERE id = p_cash_day_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_NOT_OPEN');
  END IF;
  INSERT INTO public.day_documents (company_id, cash_day_id, kind, version, storage_key)
  VALUES (p_company_id, p_cash_day_id, 'DIRECTOR_PDF', p_version, p_storage_key)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'document_id', v_id, 'version', p_version);
EXCEPTION WHEN unique_violation THEN
  -- UNIQUE (cash_day_id, kind, version): two regenerations raced. Invariant —
  -- a version is claimed once, and prior files are never overwritten.
  RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT',
    'message', 'That version already exists. Render again to take the next one.');
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_day_document(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_day_document(uuid, uuid, integer, text) TO service_role;

-- ── S3 · the Days list (§A12) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_cash_days(
  p_company_id uuid, p_project_id uuid, p_limit integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_rows jsonb;
BEGIN
  IF NOT public._dc_may_touch_project(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.business_date DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT d.id AS cash_day_id, d.business_date, d.status, d.is_setup_opening,
           d.closing_cash, d.closing_bank, d.variance, d.variance_note,
           (SELECT count(*) FROM public.cash_entries e WHERE e.cash_day_id = d.id) AS entries,
           (SELECT max(dd.version) FROM public.day_documents dd
             WHERE dd.cash_day_id = d.id AND dd.kind = 'DIRECTOR_PDF') AS pdf_version,
           (SELECT dd.id FROM public.day_documents dd
             WHERE dd.cash_day_id = d.id AND dd.kind = 'DIRECTOR_PDF'
             ORDER BY dd.version DESC LIMIT 1) AS pdf_document_id
      FROM public.cash_days d
     WHERE d.project_id = p_project_id AND d.company_id = p_company_id
     ORDER BY d.business_date DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 365))
  ) x;

  RETURN jsonb_build_object('success', true, 'days', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_cash_days(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_cash_days(uuid, uuid, integer) TO authenticated, service_role;

-- ── a signed link to a stored day document ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.authorize_day_document(
  p_company_id uuid, p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_doc public.day_documents; v_project uuid;
BEGIN
  SELECT * INTO v_doc FROM public.day_documents
   WHERE id = p_document_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION');
  END IF;
  SELECT project_id INTO v_project FROM public.cash_days WHERE id = v_doc.cash_day_id;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_project) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  RETURN jsonb_build_object('success', true, 'bucket', 'daily-closing',
    'storage_key', v_doc.storage_key, 'version', v_doc.version, 'expires_in', 600);
END;
$fn$;

REVOKE ALL ON FUNCTION public.authorize_day_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_day_document(uuid, uuid) TO authenticated, service_role;

COMMIT;
