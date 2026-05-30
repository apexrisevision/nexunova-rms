-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 6 GROUP 6C: server-side isolation on unit/sale-keyed dependents
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- 15 RPCs retrofitted. Per Rashid (2026-05-30): gate each via the PARENT
-- sale's (or unit's) project_id — not by assuming a direct project_id
-- column on the dependent row. This mirrors how client/agent dependents
-- were handled in Batches 3D/3E and 6B's get_sale_documents_amendments.
--
-- Anon (no session) stays PERMISSIVE (v_all = true).
--
-- Design decisions landed:
--  • NULL-sale rows (payment/PDC with sale_id=NULL — e.g. adjustments,
--    opening balances): invisible to non-admins by default. Admin still
--    sees them via v_all. "No parent = no membership decision" — safer.
--  • get_pdc_register: mirrors get_sales_register — silent-empty [] when
--    a non-admin passes a p_project_id not in their assigned set.
--  • list_payments_filtered: keeps its EXECUTE format(...) mechanism;
--    gate injected via bound params $10 (v_all) + $11 (v_pids).
--
-- NOT TOUCHED (preserved verbatim):
--   • get_buyer_payment_schedule, get_buyer_sale_summary  — buyer-portal
--   • 9 report RPCs (none in this surface anyway)
--   • payment_links read RPCs                              — separate workflow
--   • All writer RPCs (record_payment, create_pdc_cheque, etc.)
--
-- ────────────────────────────────────────────────────────────
-- PAYMENTS — single-id detail (1)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_payment_full(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT to_jsonb(p) FROM public.payments p CROSS JOIN cfg
  WHERE p.id = p_id AND p.company_id = p_company_id
    AND (cfg.v_all
         OR EXISTS (SELECT 1 FROM public.sales s
                    WHERE s.id = p.sale_id AND s.project_id = ANY(cfg.v_pids)));
$function$;

-- ────────────────────────────────────────────────────────────
-- PAYMENTS — unit-keyed (1)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_payments_for_unit(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'payment_date', p.payment_date, 'amount', p.amount,
    'payment_method', p.payment_method, 'reference_no', p.reference_no,
    'notes', p.notes, 'payment_code', p.payment_code, 'created_by', p.created_by
  ) ORDER BY p.payment_date), '[]'::jsonb)
  FROM public.payments p CROSS JOIN cfg
  WHERE p.company_id = p_company_id
    AND p.sale_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id
        AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
    );
$function$;

-- ────────────────────────────────────────────────────────────
-- PAYMENTS — sale-keyed lists (3) — early-gate on parent sale
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_payments_by_sale_full(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  parent AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'amount', p.amount, 'payment_date', p.payment_date, 'payment_method', p.payment_method,
    'reference_no', p.reference_no, 'bank_name', p.bank_name, 'notes', p.notes,
    'payment_category', p.payment_category, 'adjustment_note', p.adjustment_note,
    'adjustment_type', p.adjustment_type
  ) ORDER BY p.payment_date), '[]'::jsonb)
  FROM public.payments p
  WHERE p.sale_id = p_sale_id AND p.company_id = p_company_id
    AND EXISTS (SELECT 1 FROM parent);
$function$;

CREATE OR REPLACE FUNCTION public.list_payments_for_sale(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  parent AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payment_method', p.payment_method, 'amount', p.amount,
    'payment_category', p.payment_category, 'payment_date', p.payment_date,
    'reference_no', p.reference_no, 'status', p.status
  )), '[]'::jsonb)
  FROM public.payments p
  WHERE p.sale_id = p_sale_id AND p.company_id = p_company_id AND p.status = 'received'
    AND EXISTS (SELECT 1 FROM parent);
$function$;

CREATE OR REPLACE FUNCTION public.list_payments_for_sale_full(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  parent AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb)
  FROM public.payments p
  WHERE p.sale_id = p_sale_id AND p.company_id = p_company_id
    AND EXISTS (SELECT 1 FROM parent);
$function$;

-- ────────────────────────────────────────────────────────────
-- PAYMENTS — global lists (3) — row-level gate via EXISTS on sales
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_payments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_columns text := COALESCE(p_filters->>'columns', '*');
  v_method text := NULLIF(p_filters->>'payment_method','');
  v_date_from date := NULLIF(p_filters->>'date_from','')::date;
  v_date_to date := NULLIF(p_filters->>'date_to','')::date;
  v_deposit_confirmed text := p_filters->>'deposit_confirmed';
  v_cheque_from date := NULLIF(p_filters->>'cheque_from','')::date;
  v_cheque_to date := NULLIF(p_filters->>'cheque_to','')::date;
  v_tax_gt numeric := COALESCE((p_filters->>'tax_gt')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) FROM (
       SELECT %s FROM public.payments pmt
       WHERE pmt.company_id = $1
         AND ($10::boolean OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = pmt.sale_id AND s.project_id = ANY($11)))
         AND ($2::text IS NULL OR pmt.payment_method = $2)
         AND ($3::date IS NULL OR pmt.payment_date >= $3)
         AND ($4::date IS NULL OR pmt.payment_date <= $4)
         AND ($5::text IS NULL OR ($5 = ''true'' AND pmt.deposit_confirmed) OR ($5 = ''false'' AND NOT pmt.deposit_confirmed))
         AND ($6::date IS NULL OR pmt.cheque_date >= $6)
         AND ($7::date IS NULL OR pmt.cheque_date <= $7)
         AND ($8::numeric IS NULL OR pmt.tax_amount > $8)
       LIMIT $9
     ) p',
    CASE WHEN v_columns = '*' THEN '*' ELSE v_columns END
  ) USING p_company_id, v_method, v_date_from, v_date_to, v_deposit_confirmed,
            v_cheque_from, v_cheque_to, v_tax_gt, v_limit, v_all, v_pids
  INTO v_result;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.list_payments_for_search(p_company_id uuid, p_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'payment_code', p.payment_code, 'reference_no', p.reference_no,
    'amount', p.amount, 'payment_date', p.payment_date, 'payment_method', p.payment_method,
    'bank_name', p.bank_name, 'notes', p.notes, 'payment_category', p.payment_category
  )), '[]'::jsonb)
  FROM (SELECT pmt.* FROM public.payments pmt CROSS JOIN cfg
        WHERE pmt.company_id = p_company_id
          AND (cfg.v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = pmt.sale_id AND s.project_id = ANY(cfg.v_pids)))
          AND (p_filter IS NULL
            OR (p_filter='cash' AND pmt.payment_method='cash')
            OR (p_filter='bank' AND pmt.payment_method IN ('bank_transfer','bank','cheque','online'))
            OR (p_filter='adjustment' AND pmt.payment_category='adjustment')
          )
        ORDER BY pmt.payment_date DESC LIMIT 150) p;
$function$;

CREATE OR REPLACE FUNCTION public.list_payments_with_sales_unit(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'payment_date', p.payment_date, 'amount', p.amount,
    'payment_method', p.payment_method, 'reference_no', p.reference_no,
    'notes', p.notes, 'created_by', p.created_by, 'sale_id', p.sale_id,
    'sales', jsonb_build_object('unit_id', s.unit_id)
  )), '[]'::jsonb)
  FROM public.payments p CROSS JOIN cfg
  LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.company_id = p_company_id
    AND (cfg.v_all OR (s.id IS NOT NULL AND s.project_id = ANY(cfg.v_pids)))
    AND (NULLIF(p_filters->>'date_from','')::date IS NULL OR p.payment_date >= (p_filters->>'date_from')::date)
    AND (NULLIF(p_filters->>'date_to','')::date IS NULL OR p.payment_date <= (p_filters->>'date_to')::date);
$function$;

-- ────────────────────────────────────────────────────────────
-- INSTALLMENTS — single-id detail (1)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_installment_for_edit(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(to_jsonb(i), jsonb_build_object('error','installment_not_found'))
  FROM (SELECT i.id, i.installment_number, i.installment_type, i.due_date, i.amount_due, i.notes, i.status
        FROM installments i CROSS JOIN cfg
        WHERE i.id = p_id AND i.company_id = p_company_id
          AND (cfg.v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = i.sale_id AND s.project_id = ANY(cfg.v_pids)))) i;
$function$;

-- ────────────────────────────────────────────────────────────
-- INSTALLMENTS — sale-keyed list (1) — early-gate on parent sale
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_open_installments_for_sale(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  parent AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'installment_number', i.installment_number, 'installment_type', i.installment_type,
    'due_date', i.due_date, 'amount_due', i.amount_due, 'amount_paid', i.amount_paid, 'status', i.status
  ) ORDER BY i.installment_number), '[]'::jsonb)
  FROM public.installments i
  WHERE i.sale_id = p_sale_id AND i.company_id = p_company_id
    AND i.status IN ('pending','partial','overdue')
    AND EXISTS (SELECT 1 FROM parent);
$function$;

-- ────────────────────────────────────────────────────────────
-- INSTALLMENTS — global lists (2)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_installments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status_in text := NULLIF(p_filters->>'status_in','');
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT i.* FROM public.installments i
    WHERE i.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)))
      AND (v_status_in IS NULL OR i.status = ANY(string_to_array(v_status_in, ',')))
    LIMIT v_limit
  ) i;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.list_installments_for_search(p_company_id uuid, p_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_30    date := CURRENT_DATE + INTERVAL '30 days';
  v_result jsonb;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids  uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'installment_number', i.installment_number, 'due_date', i.due_date,
    'amount_due', i.amount_due, 'outstanding', i.outstanding, 'status', i.status,
    'notes', i.notes, 'sale_id', i.sale_id
  )), '[]'::jsonb) INTO v_result
  FROM (
    SELECT i.* FROM public.installments i
    WHERE i.company_id = p_company_id AND i.status <> 'paid'
      AND (v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)))
      AND (p_filter IS NULL
        OR (p_filter = 'overdue' AND i.due_date < v_today)
        OR (p_filter = 'upcoming' AND i.due_date >= v_today AND i.due_date <= v_30)
      )
    ORDER BY i.due_date
    LIMIT 150
  ) i;
  RETURN v_result;
END $function$;

-- ────────────────────────────────────────────────────────────
-- PDC — sale-keyed list (1) + global register (1)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_pdc_for_sale(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  parent AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.cheque_date NULLS LAST, c.created_at), '[]'::jsonb)
  FROM public.pdc_cheques c
  WHERE c.sale_id = p_sale_id AND c.company_id = p_company_id
    AND EXISTS (SELECT 1 FROM parent);
$function$;

CREATE OR REPLACE FUNCTION public.get_pdc_register(p_company_id uuid, p_status text DEFAULT 'All'::text, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'cheque_date') DESC NULLS LAST, r->>'id')
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id',             pc.id,
      'cheque_no',      pc.cheque_no,
      'bank_name',      pc.bank_name,
      'amount',         pc.amount,
      'cheque_date',    TO_CHAR(pc.cheque_date,    'YYYY-MM-DD'),
      'received_date',  TO_CHAR(pc.received_date,  'YYYY-MM-DD'),
      'clearance_date', TO_CHAR(pc.clearance_date, 'YYYY-MM-DD'),
      'deposit_date',   TO_CHAR(pc.deposit_date,   'YYYY-MM-DD'),
      'bounce_date',    TO_CHAR(pc.bounce_date,    'YYYY-MM-DD'),
      'status',         pc.status,
      'notes',          pc.notes,
      'bounce_reason',  pc.bounce_reason,
      'payment_id',     pc.payment_id,
      'sale_id',        pc.sale_id,
      'client_id',      pc.client_id,
      'client_name',    c.full_name,
      'sale_number',    s.sale_number,
      'unit_no',        u.unit_no,
      'unit_code',      u.unit_code,
      'project_id',     s.project_id,
      'project_name',   pr.project_name
    ) AS r
    FROM pdc_cheques pc
    LEFT JOIN clients  c  ON c.id  = pc.client_id  AND c.company_id  = p_company_id
    LEFT JOIN sales    s  ON s.id  = pc.sale_id    AND s.company_id  = p_company_id
    LEFT JOIN units    u  ON u.id  = s.unit_id
    LEFT JOIN projects pr ON pr.id = s.project_id
    WHERE pc.company_id = p_company_id
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_status = 'All' OR LOWER(pc.status) = LOWER(p_status))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR pc.cheque_date >= p_date_from)
      AND (p_date_to    IS NULL OR pc.cheque_date <= p_date_to)
  ) sub;

  RETURN jsonb_build_object(
    'success', true,
    'rows',    COALESCE(v_rows, '[]'::jsonb)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- PROMISES — unit-keyed (1) — gate via the sales the promise hangs off
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_payment_promises_by_unit(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  allowed_sales AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(pp) ORDER BY pp.promise_made_on DESC), '[]'::jsonb)
  FROM public.payment_promises pp
  WHERE pp.company_id = p_company_id
    AND (
      pp.installment_id IN (SELECT i.id FROM public.installments i WHERE i.sale_id IN (SELECT id FROM allowed_sales))
      OR pp.sale_id IN (SELECT id FROM allowed_sales)
    );
$function$;
