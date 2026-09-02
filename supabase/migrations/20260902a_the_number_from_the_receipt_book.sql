-- ═══════════════════════════════════════════════════════════════════════════
-- The number from the receipt book
-- ───────────────────────────────────────────────────────────────────────────
-- When a recovery officer collects money in the field he tears a receipt out of
-- a physical book and hands it to the client. That hand-written book number is
-- the only reference the client actually holds; the system's PAY-/PRV- codes
-- mean nothing to him. So the book number now travels with the payment:
-- captured on Record Payment, and shown wherever the payment is read back
-- (Collections report, client ledger).
--
-- Free text on purpose — books are pre-printed, series differ per book, and a
-- collection may legitimately carry no book number at all (bank transfer,
-- online). No uniqueness is imposed.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS manual_number text;

COMMENT ON COLUMN public.payments.manual_number IS
  'Receipt number from the physical receipt book handed to the client at collection time. Free text, not a system series, nullable.';

-- ── Helper: carry the book number into the insert ──────────────────────────
-- Signature gains p_manual_number, so the old 13-arg function must go first —
-- leaving both would make the positional calls in record_payment_simple and
-- mark_pdc_cleared ambiguous.
DROP FUNCTION IF EXISTS public._rms_insert_simple_payment(
  uuid, uuid, uuid, uuid, numeric, date, text, text, text, text, text, date, uuid);

CREATE OR REPLACE FUNCTION public._rms_insert_simple_payment(
  p_company_id uuid, p_sale_id uuid, p_client_id uuid, p_project_id uuid,
  p_amount numeric, p_payment_date date, p_method text, p_reference_no text,
  p_bank_name text, p_notes text, p_created_by text, p_cheque_date date,
  p_bank_id uuid, p_manual_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ym text := TO_CHAR(CURRENT_DATE, 'YYMM');
  v_seq integer; v_pay_code text;
  v_fy_start integer; v_fy_label text; v_prv_seq integer; v_voucher_code text;
  v_pay_id uuid;
BEGIN
  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(payment_code, '^PAY-[0-9]+-0*', '') AS INTEGER)), 0) + 1
  INTO v_seq FROM public.payments
  WHERE company_id = p_company_id AND payment_code LIKE 'PAY-' || v_ym || '-%';
  v_pay_code := 'PAY-' || v_ym || '-' || LPAD(v_seq::text, 4, '0');

  IF EXTRACT(MONTH FROM CURRENT_DATE)::int >= 7 THEN v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  ELSE v_fy_start := EXTRACT(YEAR FROM CURRENT_DATE)::int - 1; END IF;
  v_fy_label := RIGHT(v_fy_start::text, 2) || RIGHT((v_fy_start + 1)::text, 2);
  INSERT INTO public.voucher_sequences (company_id, prefix, year, seq)
  VALUES (p_company_id, 'PRV', v_fy_label, 1)
  ON CONFLICT (company_id, prefix, year) DO UPDATE SET seq = voucher_sequences.seq + 1
  RETURNING seq INTO v_prv_seq;
  v_voucher_code := 'PRV-' || v_fy_label || '-' || LPAD(v_prv_seq::text, 5, '0');

  INSERT INTO public.payments (
    company_id, payment_code, voucher_code, sale_id, installment_id, client_id, project_id,
    amount, payment_date, payment_method, reference_no, bank_name, notes, status, created_by,
    cheque_date, bank_id, payment_category, manual_number
  ) VALUES (
    p_company_id, v_pay_code, v_voucher_code, p_sale_id, NULL, p_client_id, p_project_id,
    p_amount, p_payment_date, p_method,
    NULLIF(TRIM(COALESCE(p_reference_no,'')),''), NULLIF(TRIM(COALESCE(p_bank_name,'')),''),
    NULLIF(TRIM(COALESCE(p_notes,'')),''), 'received', p_created_by,
    p_cheque_date, p_bank_id, 'regular',
    NULLIF(TRIM(COALESCE(p_manual_number,'')),'')
  ) RETURNING id INTO v_pay_id;

  PERFORM public._rms_credit_installments_fifo(p_company_id, p_sale_id, p_amount);

  RETURN jsonb_build_object('success', true, 'payment_id', v_pay_id,
                            'payment_code', v_pay_code, 'voucher_code', v_voucher_code);
END;
$function$;

-- anon/authenticated are named explicitly: a default-privileges rule grants
-- EXECUTE to authenticated on every new function, and this helper writes a
-- payment with no caller check of its own — only the RPC above may call it.
REVOKE ALL ON FUNCTION public._rms_insert_simple_payment(
  uuid, uuid, uuid, uuid, numeric, date, text, text, text, text, text, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rms_insert_simple_payment(
  uuid, uuid, uuid, uuid, numeric, date, text, text, text, text, text, date, uuid, text) TO service_role;

-- ── Record Payment RPC: accepts the book number ────────────────────────────
DROP FUNCTION IF EXISTS public.record_payment_simple(
  uuid, uuid, numeric, date, text, text, text, text, uuid, date, uuid);

CREATE OR REPLACE FUNCTION public.record_payment_simple(
  p_company_id uuid, p_sale_id uuid, p_amount numeric, p_payment_date date,
  p_payment_method text, p_reference_no text DEFAULT NULL::text,
  p_bank_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid, p_cheque_date date DEFAULT NULL::date,
  p_bank_id uuid DEFAULT NULL::uuid, p_manual_number text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_client_id uuid; v_project_id uuid;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN
       ('cash','cheque','bank_transfer','online','other','adjustment') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_payment_method');
  END IF;

  SELECT client_id, project_id INTO v_client_id, v_project_id
  FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Managers have read-only access.');
    END IF;
    IF v_project_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_project_assignments
        WHERE user_id = v_me.id AND company_id = p_company_id AND project_id = v_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  RETURN public._rms_insert_simple_payment(
    p_company_id, p_sale_id, v_client_id, v_project_id, p_amount,
    COALESCE(p_payment_date, CURRENT_DATE), p_payment_method, p_reference_no, p_bank_name,
    p_notes, COALESCE(p_created_by::text, v_me.id::text), p_cheque_date, p_bank_id,
    p_manual_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_payment_simple(
  uuid, uuid, numeric, date, text, text, text, text, uuid, date, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payment_simple(
  uuid, uuid, numeric, date, text, text, text, text, uuid, date, uuid, text) TO authenticated, service_role;

-- ── Client ledger: the payment rows carry the book number ──────────────────
-- Only the CR (payment) branch can have one; the three other branches return
-- NULL so the UNION column list stays aligned.
CREATE OR REPLACE FUNCTION public.get_client_ledger(
  p_client_id uuid, p_company_id uuid,
  p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0;
  v_ob_debit numeric := 0; v_ob_credit numeric := 0;
  v_period_net numeric := 0; v_client_info jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'client_info', '{}'::jsonb,
      'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  SELECT jsonb_build_object('client_name', c.full_name, 'client_code', c.client_code,
    'projects', (SELECT STRING_AGG(DISTINCT pj.project_name, ', ' ORDER BY pj.project_name)
      FROM sales s2 JOIN projects pj ON pj.id = s2.project_id
      WHERE s2.client_id = p_client_id AND s2.company_id = p_company_id AND s2.status NOT IN ('cancelled')))
  INTO v_client_info FROM clients c WHERE c.id = p_client_id AND c.company_id = p_company_id;
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit
    FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.client_id = p_client_id
      AND s.status NOT IN ('cancelled','transferred')
      AND i.due_date < p_from_date;
    -- shifts OUT before the window add to opening debit
    v_ob_debit := v_ob_debit + COALESCE((SELECT SUM(sh.amount) FROM unit_amount_shifts sh
      JOIN sales s ON s.id = sh.from_sale_id
      WHERE sh.company_id = p_company_id AND s.client_id = p_client_id AND sh.shift_date < p_from_date), 0);
    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.client_id = p_client_id AND p.status != 'cancelled'
      AND s.status NOT IN ('cancelled','transferred')
      AND p.payment_date < p_from_date;
    -- shifts IN before the window add to opening credit
    v_ob_credit := v_ob_credit + COALESCE((SELECT SUM(sh.amount) FROM unit_amount_shifts sh
      JOIN sales s ON s.id = sh.to_sale_id
      WHERE sh.company_id = p_company_id AND s.client_id = p_client_id AND sh.shift_date < p_from_date), 0);
    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;
  SELECT jsonb_agg(to_jsonb(r)) INTO v_rows FROM (
    SELECT CASE i.installment_type WHEN 'down_payment' THEN 'DP-0' ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0') END AS voucher_no,
      'DR' AS row_type, 1 AS row_order, i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type WHEN 'down_payment' THEN 'Installment Due — Down Payment / Booking'
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th'
            WHEN i.installment_number % 10 = 1 THEN 'st'
            WHEN i.installment_number % 10 = 2 THEN 'nd'
            WHEN i.installment_number % 10 = 3 THEN 'rd' ELSE 'th' END || ' Installment' END AS description,
      i.amount_due AS debit, NULL::numeric AS credit, NULL::text AS chq_no,
      NULL::text AS manual_no, s.sale_number AS sale_number,
      NULL::uuid AS payment_id
    FROM public.installments i JOIN public.sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.client_id = p_client_id
      AND s.status NOT IN ('cancelled','transferred')
      AND (p_from_date IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT COALESCE(p.voucher_code, p.payment_code) AS voucher_no,
      'CR' AS row_type, 2 AS row_order, p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']'
          WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']' ELSE '' END AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      p.manual_number AS manual_no, s.sale_number AS sale_number,
      p.id AS payment_id
    FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.client_id = p_client_id AND p.status != 'cancelled'
      AND s.status NOT IN ('cancelled','transferred')
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    UNION ALL
    -- amount shifted OUT of this client's units → DR
    SELECT 'ADJ-SHIFT' AS voucher_no, 'DR' AS row_type, 3 AS row_order, sh.shift_date AS entry_date, sh.created_at AS created_at,
      COALESCE(sh.narration, 'Amount shifted out') AS description,
      sh.amount AS debit, NULL::numeric AS credit, NULL::text AS chq_no,
      NULL::text AS manual_no, fs.sale_number AS sale_number, NULL::uuid AS payment_id
    FROM public.unit_amount_shifts sh JOIN public.sales fs ON fs.id = sh.from_sale_id
    WHERE sh.company_id = p_company_id AND fs.client_id = p_client_id
      AND (p_from_date IS NULL OR sh.shift_date >= p_from_date)
      AND (p_to_date IS NULL OR sh.shift_date <= p_to_date)
    UNION ALL
    -- amount shifted INTO this client's units → CR
    SELECT 'ADJ-SHIFT' AS voucher_no, 'CR' AS row_type, 2 AS row_order, sh.shift_date AS entry_date, sh.created_at AS created_at,
      COALESCE(sh.narration, 'Amount shifted in') AS description,
      NULL::numeric AS debit, sh.amount AS credit, NULL::text AS chq_no,
      NULL::text AS manual_no, ts.sale_number AS sale_number, NULL::uuid AS payment_id
    FROM public.unit_amount_shifts sh JOIN public.sales ts ON ts.id = sh.to_sale_id
    WHERE sh.company_id = p_company_id AND ts.client_id = p_client_id
      AND (p_from_date IS NULL OR sh.shift_date >= p_from_date)
      AND (p_to_date IS NULL OR sh.shift_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;
  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0) INTO v_period_net
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'client_info', COALESCE(v_client_info, '{}'::jsonb),
    'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── Collection report core: expose the book number ─────────────────────────
-- (the Reports-hub Collections report reads list_payments_filtered, which
-- already returns the whole payments row; this keeps the dedicated RPC in step)
CREATE OR REPLACE FUNCTION public._get_collection_report_core(
  p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date,
  p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payment_date', p.payment_date,
    'receipt_no',   COALESCE(p.payment_code, p.reference_no),
    'manual_no',    p.manual_number,
    'client_name',  COALESCE(cl.full_name, scl.full_name),
    'unit_ref',     u.unit_no,
    'project_name', pr.project_name,
    'payment_mode', p.payment_method,
    'amount',       p.amount,
    'received_by',  p.created_by
  ) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb)
  FROM public.payments p
  LEFT JOIN public.clients  cl  ON cl.id  = p.client_id
  LEFT JOIN public.sales    s   ON s.id   = p.sale_id
  LEFT JOIN public.clients  scl ON scl.id = s.client_id
  LEFT JOIN public.units    u   ON u.id   = s.unit_id
  LEFT JOIN public.projects pr  ON pr.id  = COALESCE(p.project_id, s.project_id, u.project_id)
  WHERE p.company_id = p_company_id
    AND (p.status IS DISTINCT FROM 'cancelled')
    AND (p_from_date  IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date    IS NULL OR p.payment_date <= p_to_date)
    AND (p_project_id IS NULL OR COALESCE(p.project_id, s.project_id, u.project_id) = p_project_id);
$function$;
