-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 6, GROUP 6A: server-side isolation on unit
-- list/detail RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Same template as Batch 3/4. Anon (no session) stays PERMISSIVE.
--
-- 8 RPCs. Notes on per-RPC choices:
--   • list_units, get_units_all, get_units_by_project       → direct u.project_id gate
--   • get_unit_with_details (takes only p_id)               → v_pids by user_id only
--                                                             (like get_client_360 / get_agent_name)
--   • get_unit_history (multi-source timeline keyed by unit) → early-gate on parent unit.project_id
--                                                             (like get_client_ledger / get_agent_ledger)
--   • get_unit_sales_count (sales count for one unit)       → direct s.project_id on the inner SELECT
--   • list_sold_unit_ids (company-wide sold unit ids)        → direct s.project_id
--   • get_units_plan_status                                  → option-b admin-only / not_applicable
--                                                             (same as get_clients_plan_status from 3A)

-- ── 1. list_units ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_units(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id  UUID   := NULLIF(p_filters->>'project_id',  '')::UUID;
  v_status_id   UUID   := NULLIF(p_filters->>'status_id',   '')::UUID;
  v_type_id     UUID   := NULLIF(p_filters->>'type_id',     '')::UUID;
  v_search      TEXT   := NULLIF(p_filters->>'search',      '');
  v_limit       INTEGER := COALESCE((p_filters->>'limit')::INTEGER,  20);
  v_offset      INTEGER := COALESCE((p_filters->>'offset')::INTEGER,  0);
  v_total       INTEGER;
  v_rows        JSONB;
  v_me          public.app_users := public._rms_caller();
  v_all         boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids        uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.units u
  WHERE u.company_id  = p_company_id
    AND (v_all OR u.project_id = ANY(v_pids))
    AND (v_project_id IS NULL OR u.project_id   = v_project_id)
    AND (v_status_id  IS NULL OR u.status_id    = v_status_id)
    AND (v_type_id    IS NULL OR u.unit_type_id = v_type_id)
    AND (v_search     IS NULL OR u.unit_no ILIKE '%' || v_search || '%'
                              OR u.unit_code ILIKE '%' || v_search || '%');

  SELECT jsonb_agg(to_jsonb(u) ORDER BY u.unit_no) INTO v_rows
  FROM (
    SELECT u.*
    FROM public.units u
    WHERE u.company_id  = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
      AND (v_project_id IS NULL OR u.project_id   = v_project_id)
      AND (v_status_id  IS NULL OR u.status_id    = v_status_id)
      AND (v_type_id    IS NULL OR u.unit_type_id = v_type_id)
      AND (v_search     IS NULL OR u.unit_no ILIKE '%' || v_search || '%'
                                OR u.unit_code ILIKE '%' || v_search || '%')
    ORDER BY u.unit_no
    LIMIT v_limit OFFSET v_offset
  ) u;

  RETURN jsonb_build_object(
    'total',  v_total,
    'rows',   COALESCE(v_rows, '[]'::JSONB),
    'limit',  v_limit,
    'offset', v_offset
  );
END; $function$;

-- ── 2. get_units_all ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_units_all(p_company_id uuid)
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
  SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.unit_no), '[]'::jsonb)
  FROM public.units u CROSS JOIN cfg
  WHERE u.company_id = p_company_id
    AND (cfg.v_all OR u.project_id = ANY(cfg.v_pids));
$function$;

-- ── 3. get_units_by_project (no p_company_id; v_pids by user_id only) ──
CREATE OR REPLACE FUNCTION public.get_units_by_project(p_project_id uuid)
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
           ON upa.user_id = me.id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.unit_no), '[]'::jsonb)
  FROM public.units u CROSS JOIN cfg
  WHERE u.project_id = p_project_id
    AND (cfg.v_all OR p_project_id = ANY(cfg.v_pids));
$function$;

-- ── 4. get_unit_with_details (no p_company_id; v_pids by user_id only) ──
CREATE OR REPLACE FUNCTION public.get_unit_with_details(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'unit',    to_jsonb(u),
    'project', to_jsonb(p),
    'type',    to_jsonb(t),
    'status',  to_jsonb(s)
  )
  INTO v_result
  FROM public.units u
  LEFT JOIN public.projects               p ON p.id = u.project_id
  LEFT JOIN public.category_unit_types    t ON t.id = u.unit_type_id
  LEFT JOIN public.category_unit_statuses s ON s.id = u.status_id
  WHERE u.id = p_id
    AND (v_all OR u.project_id = ANY(v_pids));

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Unit not found'));
END; $function$;

-- ── 5. get_unit_history (early-gate on parent unit.project_id) ──
CREATE OR REPLACE FUNCTION public.get_unit_history(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_snapshot jsonb;
  v_events   jsonb;
  v_me       public.app_users := public._rms_caller();
  v_all      boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids     uuid[];
  v_proj     uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- Early gate on the parent unit
  SELECT project_id INTO v_proj
  FROM public.units
  WHERE id = p_unit_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'snapshot', '{}'::jsonb, 'events', '[]'::jsonb);
  END IF;

  -- Current state snapshot
  SELECT jsonb_build_object(
    'owner_name',  c.full_name,
    'sale_price',  s.net_amount,
    'sale_number', s.sale_number,
    'sale_date',   TO_CHAR(s.sale_date, 'YYYY-MM-DD'),
    'collected',   COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = s.id AND p.company_id = p_company_id AND p.status <> 'cancelled'
    ), 0),
    'outstanding', GREATEST(0, COALESCE(s.net_amount, 0) - COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = s.id AND p.company_id = p_company_id AND p.status <> 'cancelled'
    ), 0))
  ) INTO v_snapshot
  FROM units u
  LEFT JOIN sales s ON s.unit_id = u.id AND s.company_id = p_company_id AND s.is_active = true
  LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
  WHERE u.id = p_unit_id AND u.company_id = p_company_id;

  -- Timeline events (preserved verbatim — body unchanged)
  SELECT jsonb_agg(ev ORDER BY
    (ev->>'priority')::int  NULLS LAST,
    (ev->>'event_date')     NULLS LAST,
    (ev->>'sort_key')       NULLS LAST
  )
  INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'event_type',  'unit_created',
      'event_date',  TO_CHAR(u.created_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD'),
      'description', 'Unit added to system',
      'amount',      NULL,
      'extra',       NULL,
      'priority',    '0',
      'sort_key',    '1'
    ) AS ev
    FROM units u
    WHERE u.id = p_unit_id AND u.company_id = p_company_id

    UNION ALL

    SELECT jsonb_build_object(
      'event_type',  CASE WHEN s.status = 'cancelled' THEN 'booking_cancelled' ELSE 'booking' END,
      'event_date',  COALESCE(
        TO_CHAR(s.sale_date, 'YYYY-MM-DD'),
        TO_CHAR(s.created_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD')
      ),
      'description', CASE WHEN s.status = 'cancelled' THEN 'Sale booked (later cancelled)' ELSE 'Sale booked' END
                     || ' · ' || COALESCE(c.full_name, 'Unknown')
                     || ' · ' || COALESCE(s.sale_number, ''),
      'amount',      s.net_amount,
      'extra',       jsonb_build_object(
                       'sale_number', s.sale_number,
                       'client_name', c.full_name,
                       'sale_status', s.status
                     ),
      'priority',    '1',
      'sort_key',    '2'
    )
    FROM sales s
    LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id

    UNION ALL

    SELECT jsonb_build_object(
      'event_type',  'installment',
      'event_date',  TO_CHAR(i.due_date, 'YYYY-MM-DD'),
      'description', CASE
        WHEN i.installment_type = 'down_payment' THEN 'Down payment due'
        ELSE 'Installment #' || i.installment_number || ' due'
      END,
      'amount',      i.amount_due,
      'extra',       jsonb_build_object(
                       'status',         i.status,
                       'amount_paid',    i.amount_paid,
                       'installment_no', i.installment_number,
                       'type',           i.installment_type
                     ),
      'priority',    '1',
      'sort_key',    '3-' || LPAD(COALESCE(i.installment_number, 0)::text, 5, '0')
    )
    FROM installments i
    JOIN sales s ON s.id = i.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND i.company_id = p_company_id

    UNION ALL

    SELECT jsonb_build_object(
      'event_type',  'payment',
      'event_date',  TO_CHAR(p.payment_date, 'YYYY-MM-DD'),
      'description', 'Payment received · '
                     || COALESCE(p.voucher_code, p.payment_code, '')
                     || CASE WHEN p.payment_method IS NOT NULL THEN ' · ' || p.payment_method ELSE '' END,
      'amount',      p.amount,
      'extra',       jsonb_build_object(
                       'voucher_code', COALESCE(p.voucher_code, p.payment_code),
                       'method',       p.payment_method,
                       'status',       p.status,
                       'reference',    p.reference_no
                     ),
      'priority',    '1',
      'sort_key',    '4'
    )
    FROM payments p
    JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND p.company_id = p_company_id AND p.status <> 'cancelled'

    UNION ALL

    SELECT jsonb_build_object(
      'event_type',  'pdc',
      'event_date',  TO_CHAR(pc.cheque_date, 'YYYY-MM-DD'),
      'description', 'PDC Cheque · '
                     || COALESCE(pc.cheque_no, '')
                     || CASE WHEN pc.bank_name IS NOT NULL THEN ' · ' || pc.bank_name ELSE '' END,
      'amount',      pc.amount,
      'extra',       jsonb_build_object(
                       'cheque_no', pc.cheque_no,
                       'bank',      pc.bank_name,
                       'status',    pc.status
                     ),
      'priority',    '1',
      'sort_key',    '5'
    )
    FROM pdc_cheques pc
    JOIN sales s ON s.id = pc.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND pc.company_id = p_company_id

    UNION ALL

    SELECT jsonb_build_object(
      'event_type',  'cancellation',
      'event_date',  TO_CHAR(uc.cancellation_date, 'YYYY-MM-DD'),
      'description', 'Sale cancelled'
                     || CASE WHEN uc.reason_category IS NOT NULL THEN ' · ' || uc.reason_category ELSE '' END
                     || CASE WHEN uc.cancellation_voucher_no IS NOT NULL THEN ' · ' || uc.cancellation_voucher_no ELSE '' END,
      'amount',      uc.net_refund_amount,
      'extra',       jsonb_build_object(
                       'voucher_no', uc.cancellation_voucher_no,
                       'reason',     uc.reason_category,
                       'detail',     uc.detailed_reason,
                       'status',     uc.status
                     ),
      'priority',    '1',
      'sort_key',    '6'
    )
    FROM unit_cancellations uc
    WHERE uc.unit_id = p_unit_id AND uc.company_id = p_company_id

    UNION ALL

    SELECT jsonb_build_object(
      'event_type',  'transfer',
      'event_date',  TO_CHAR(ut.transfer_date, 'YYYY-MM-DD'),
      'description', 'Ownership transferred'
                     || CASE WHEN cold.full_name IS NOT NULL THEN ' from ' || cold.full_name ELSE '' END
                     || CASE WHEN cnew.full_name IS NOT NULL THEN ' to '   || cnew.full_name ELSE '' END
                     || CASE WHEN ut.transfer_voucher_no IS NOT NULL THEN ' · ' || ut.transfer_voucher_no ELSE '' END,
      'amount',      ut.total_transfer_charges,
      'extra',       jsonb_build_object(
                       'from_client', cold.full_name,
                       'to_client',   cnew.full_name,
                       'voucher_no',  ut.transfer_voucher_no,
                       'fee',         ut.transfer_fee
                     ),
      'priority',    '1',
      'sort_key',    '7'
    )
    FROM unit_transfers ut
    LEFT JOIN clients cold ON cold.id = ut.old_client_id AND cold.company_id = p_company_id
    LEFT JOIN clients cnew ON cnew.id = ut.new_client_id AND cnew.company_id = p_company_id
    WHERE ut.unit_id = p_unit_id AND ut.company_id = p_company_id
  ) sub;

  RETURN jsonb_build_object(
    'success',  true,
    'snapshot', COALESCE(v_snapshot, '{}'::jsonb),
    'events',   COALESCE(v_events, '[]'::jsonb)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── 6. get_unit_sales_count (direct s.project_id) ──────────
CREATE OR REPLACE FUNCTION public.get_unit_sales_count(p_unit_id uuid, p_company_id uuid)
 RETURNS integer
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
  SELECT COUNT(*)::int FROM public.sales s CROSS JOIN cfg
  WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id AND s.status = 'active'
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── 7. list_sold_unit_ids (direct s.project_id) ────────────
CREATE OR REPLACE FUNCTION public.list_sold_unit_ids(p_company_id uuid)
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
  SELECT COALESCE(jsonb_agg(DISTINCT s.unit_id), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.company_id = p_company_id AND s.status <> 'cancelled' AND s.unit_id IS NOT NULL
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── 8. get_units_plan_status (option-b admin-only / not_applicable) ─
CREATE OR REPLACE FUNCTION public.get_units_plan_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max   int;
  v_count int;
  v_me    public.app_users := public._rms_caller();
BEGIN
  -- Plan limits are company-level. Non-admin → not_applicable; admins/anon see the real count.
  IF v_me.id IS NOT NULL AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('applicable', false, 'error', 'not_applicable',
      'message', 'Plan status is visible to admins only.');
  END IF;

  SELECT sp.max_units INTO v_max FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id AND s.status IN ('active','trialing')
  ORDER BY s.created_at DESC NULLS LAST LIMIT 1;
  SELECT COUNT(*)::int INTO v_count FROM units WHERE company_id = p_company_id;
  RETURN jsonb_build_object('current_count', v_count,
    'max_allowed', COALESCE(v_max, 0), 'can_add', v_count < COALESCE(v_max, 0));
END;
$function$;
