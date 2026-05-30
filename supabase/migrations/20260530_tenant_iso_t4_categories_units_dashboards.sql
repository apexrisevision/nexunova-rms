-- ════════════════════════════════════════════════════════════
-- TENANT-ISOLATION T4: tenant-gate on category / unit / dashboard reads
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Same pattern as T2/T3:
--   v_all formula updated from
--     (me.id IS NULL) OR _rms_is_admin(me)
--   to
--     (me.id IS NULL) OR (me.company_id = p_company_id AND _rms_is_admin(me))
-- Plus, for RPCs with an explicit success/error envelope (dashboards, unit detail),
-- an early-return wrong_tenant gate so the shape matches the existing reject style:
--   • lists / array RPCs        → empty (v_all formula mod only)
--   • envelope RPCs             → {success:false, error:'wrong_tenant'}
--   • plan_status (option-b)    → {applicable:false, error:'wrong_tenant'}
--   • derived (no p_company_id) → scope parent (units/projects) by caller's company
--
-- Anon (me.id NULL) and same-tenant admin → v_all=true unchanged.
-- Cross-tenant admin/officer → v_all=false AND v_pids empty (UPA scoped by p_company_id) → no rows.
--
-- Already-safe derived RPCs that require session AND scope every lookup by
-- v_me.company_id are left as-is (verified): get_applicable_tier,
-- get_cancellation_tiers, get_project_users.

-- ────────────────── CATEGORIES (sql/cfg-CTE) ──────────────────

CREATE OR REPLACE FUNCTION public.list_unit_types(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sort_order, t.type_name), '[]'::jsonb)
  FROM public.category_unit_types t CROSS JOIN cfg
  WHERE t.company_id = p_company_id
    AND (cfg.v_all OR t.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_unit_statuses(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.status_name), '[]'::jsonb)
  FROM public.category_unit_statuses s CROSS JOIN cfg
  WHERE s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ────────────────── UNITS — list-shape (sql/cfg-CTE) ──────────────────

CREATE OR REPLACE FUNCTION public.get_units_all(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
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

CREATE OR REPLACE FUNCTION public.list_sold_unit_ids(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
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

CREATE OR REPLACE FUNCTION public.get_unit_sales_count(p_unit_id uuid, p_company_id uuid)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
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

-- ────────────────── UNITS — list-shape (plpgsql v_me) ──────────────────

CREATE OR REPLACE FUNCTION public.list_units(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  v_all         boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids        uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT COUNT(*) INTO v_total FROM public.units u
  WHERE u.company_id = p_company_id
    AND (v_all OR u.project_id = ANY(v_pids))
    AND (v_project_id IS NULL OR u.project_id   = v_project_id)
    AND (v_status_id  IS NULL OR u.status_id    = v_status_id)
    AND (v_type_id    IS NULL OR u.unit_type_id = v_type_id)
    AND (v_search     IS NULL OR u.unit_no ILIKE '%' || v_search || '%'
                              OR u.unit_code ILIKE '%' || v_search || '%');
  SELECT jsonb_agg(to_jsonb(u) ORDER BY u.unit_no) INTO v_rows FROM (
    SELECT u.* FROM public.units u
    WHERE u.company_id = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
      AND (v_project_id IS NULL OR u.project_id   = v_project_id)
      AND (v_status_id  IS NULL OR u.status_id    = v_status_id)
      AND (v_type_id    IS NULL OR u.unit_type_id = v_type_id)
      AND (v_search     IS NULL OR u.unit_no ILIKE '%' || v_search || '%'
                                OR u.unit_code ILIKE '%' || v_search || '%')
    ORDER BY u.unit_no LIMIT v_limit OFFSET v_offset
  ) u;
  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::JSONB),
    'limit', v_limit, 'offset', v_offset);
END; $function$;

-- ────────────────── UNITS — envelope-shape (plpgsql) ──────────────────

CREATE OR REPLACE FUNCTION public.get_unit_history(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_snapshot jsonb;
  v_events   jsonb;
  v_me       public.app_users := public._rms_caller();
  v_all      boolean;
  v_pids     uuid[];
  v_proj     uuid;
BEGIN
  IF v_me.id IS NOT NULL
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.units
  WHERE id = p_unit_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'snapshot', '{}'::jsonb, 'events', '[]'::jsonb);
  END IF;
  SELECT jsonb_build_object(
    'owner_name',  c.full_name,
    'sale_price',  s.net_amount,
    'sale_number', s.sale_number,
    'sale_date',   TO_CHAR(s.sale_date, 'YYYY-MM-DD'),
    'collected',   COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = s.id AND p.company_id = p_company_id AND p.status <> 'cancelled'), 0),
    'outstanding', GREATEST(0, COALESCE(s.net_amount, 0) - COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = s.id AND p.company_id = p_company_id AND p.status <> 'cancelled'), 0))
  ) INTO v_snapshot
  FROM units u
  LEFT JOIN sales s ON s.unit_id = u.id AND s.company_id = p_company_id AND s.is_active = true
  LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
  WHERE u.id = p_unit_id AND u.company_id = p_company_id;
  SELECT jsonb_agg(ev ORDER BY
    (ev->>'priority')::int  NULLS LAST,
    (ev->>'event_date')     NULLS LAST,
    (ev->>'sort_key')       NULLS LAST
  )
  INTO v_events FROM (
    SELECT jsonb_build_object(
      'event_type','unit_created',
      'event_date',TO_CHAR(u.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD'),
      'description','Unit added to system','amount',NULL,'extra',NULL,'priority','0','sort_key','1') AS ev
    FROM units u WHERE u.id = p_unit_id AND u.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type', CASE WHEN s.status = 'cancelled' THEN 'booking_cancelled' ELSE 'booking' END,
      'event_date', COALESCE(TO_CHAR(s.sale_date,'YYYY-MM-DD'),TO_CHAR(s.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD')),
      'description', CASE WHEN s.status = 'cancelled' THEN 'Sale booked (later cancelled)' ELSE 'Sale booked' END
                     || ' · ' || COALESCE(c.full_name,'Unknown') || ' · ' || COALESCE(s.sale_number,''),
      'amount', s.net_amount,
      'extra', jsonb_build_object('sale_number',s.sale_number,'client_name',c.full_name,'sale_status',s.status),
      'priority','1','sort_key','2')
    FROM sales s LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','installment','event_date',TO_CHAR(i.due_date,'YYYY-MM-DD'),
      'description', CASE WHEN i.installment_type='down_payment' THEN 'Down payment due'
                          ELSE 'Installment #' || i.installment_number || ' due' END,
      'amount', i.amount_due,
      'extra', jsonb_build_object('status',i.status,'amount_paid',i.amount_paid,
        'installment_no',i.installment_number,'type',i.installment_type),
      'priority','1','sort_key','3-' || LPAD(COALESCE(i.installment_number,0)::text,5,'0'))
    FROM installments i JOIN sales s ON s.id = i.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND i.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','payment','event_date',TO_CHAR(p.payment_date,'YYYY-MM-DD'),
      'description','Payment received · ' || COALESCE(p.voucher_code,p.payment_code,'')
                    || CASE WHEN p.payment_method IS NOT NULL THEN ' · ' || p.payment_method ELSE '' END,
      'amount', p.amount,
      'extra', jsonb_build_object('voucher_code',COALESCE(p.voucher_code,p.payment_code),
        'method',p.payment_method,'status',p.status,'reference',p.reference_no),
      'priority','1','sort_key','4')
    FROM payments p JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND p.company_id = p_company_id AND p.status <> 'cancelled'
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','pdc','event_date',TO_CHAR(pc.cheque_date,'YYYY-MM-DD'),
      'description','PDC Cheque · ' || COALESCE(pc.cheque_no,'')
                    || CASE WHEN pc.bank_name IS NOT NULL THEN ' · ' || pc.bank_name ELSE '' END,
      'amount', pc.amount,
      'extra', jsonb_build_object('cheque_no',pc.cheque_no,'bank',pc.bank_name,'status',pc.status),
      'priority','1','sort_key','5')
    FROM pdc_cheques pc JOIN sales s ON s.id = pc.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND pc.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','cancellation','event_date',TO_CHAR(uc.cancellation_date,'YYYY-MM-DD'),
      'description','Sale cancelled'
                    || CASE WHEN uc.reason_category IS NOT NULL THEN ' · ' || uc.reason_category ELSE '' END
                    || CASE WHEN uc.cancellation_voucher_no IS NOT NULL THEN ' · ' || uc.cancellation_voucher_no ELSE '' END,
      'amount', uc.net_refund_amount,
      'extra', jsonb_build_object('voucher_no',uc.cancellation_voucher_no,'reason',uc.reason_category,
        'detail',uc.detailed_reason,'status',uc.status),
      'priority','1','sort_key','6')
    FROM unit_cancellations uc WHERE uc.unit_id = p_unit_id AND uc.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','transfer','event_date',TO_CHAR(ut.transfer_date,'YYYY-MM-DD'),
      'description','Ownership transferred'
                    || CASE WHEN cold.full_name IS NOT NULL THEN ' from ' || cold.full_name ELSE '' END
                    || CASE WHEN cnew.full_name IS NOT NULL THEN ' to '   || cnew.full_name ELSE '' END
                    || CASE WHEN ut.transfer_voucher_no IS NOT NULL THEN ' · ' || ut.transfer_voucher_no ELSE '' END,
      'amount', ut.total_transfer_charges,
      'extra', jsonb_build_object('from_client',cold.full_name,'to_client',cnew.full_name,
        'voucher_no',ut.transfer_voucher_no,'fee',ut.transfer_fee),
      'priority','1','sort_key','7')
    FROM unit_transfers ut
    LEFT JOIN clients cold ON cold.id = ut.old_client_id AND cold.company_id = p_company_id
    LEFT JOIN clients cnew ON cnew.id = ut.new_client_id AND cnew.company_id = p_company_id
    WHERE ut.unit_id = p_unit_id AND ut.company_id = p_company_id
  ) sub;
  RETURN jsonb_build_object('success', true, 'snapshot', COALESCE(v_snapshot,'{}'::jsonb),
    'events', COALESCE(v_events,'[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unit_payment_summary(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sale RECORD; v_sale_j JSONB; v_insts JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
  v_unit_visible boolean;
BEGIN
  IF v_me.id IS NOT NULL
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = p_unit_id AND u.company_id = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
  ) INTO v_unit_visible;

  IF NOT v_unit_visible THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;

  SELECT s.id, s.sale_number, s.sale_date, s.price_per_sqft, s.area_sqft,
         s.discount, s.net_amount, s.down_payment, s.remaining_amount,
         s.installment_count, s.status AS sale_status,
         u.unit_no, u.unit_code, u.floor_label, u.area, u.area_unit, u.block,
         p.project_name, c.full_name AS client_name, c.phone_primary AS client_phone,
         a.full_name AS agent_name, a.commission_percent,
         ct.type_name AS unit_type
  INTO v_sale
  FROM public.sales s
  JOIN public.units u ON u.id = s.unit_id
  JOIN public.projects p ON p.id = u.project_id
  JOIN public.clients c ON c.id = s.client_id
  LEFT JOIN public.agents a ON a.id = s.agent_id
  LEFT JOIN public.category_unit_types ct ON ct.id = u.unit_type_id
  WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id AND s.status = 'active'
  LIMIT 1;

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;

  v_sale_j := jsonb_build_object(
    'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'sale_date', v_sale.sale_date,
    'price_per_sqft', v_sale.price_per_sqft, 'area_sqft', v_sale.area_sqft,
    'discount', v_sale.discount, 'net_amount', v_sale.net_amount,
    'down_payment', v_sale.down_payment, 'installment_count', v_sale.installment_count,
    'unit_no', v_sale.unit_no, 'unit_code', v_sale.unit_code,
    'floor_label', v_sale.floor_label, 'block', v_sale.block,
    'area', v_sale.area, 'area_unit', v_sale.area_unit,
    'project_name', v_sale.project_name, 'unit_type', v_sale.unit_type,
    'client_name', v_sale.client_name, 'client_phone', v_sale.client_phone,
    'agent_name', v_sale.agent_name, 'commission_percent', v_sale.commission_percent
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'installment_id', i.id, 'installment_number', i.installment_number,
      'installment_type', i.installment_type, 'due_date', i.due_date,
      'amount_due', i.amount_due, 'amount_paid', i.amount_paid,
      'outstanding', GREATEST(i.amount_due - i.amount_paid, 0),
      'status', i.status, 'notes', i.notes
    ) ORDER BY i.installment_number
  ), '[]'::jsonb)
  INTO v_insts FROM public.installments i
  WHERE i.sale_id = v_sale.id AND i.company_id = p_company_id;

  IF v_insts = '[]'::jsonb AND v_sale.down_payment > 0 THEN
    v_insts := jsonb_build_array(jsonb_build_object(
      'installment_id', NULL, 'installment_number', 0,
      'installment_type', 'down_payment', 'due_date', v_sale.sale_date,
      'amount_due', v_sale.down_payment, 'amount_paid', 0,
      'outstanding', v_sale.down_payment, 'status', 'pending',
      'notes', 'Down Payment / Booking'
    ));
  END IF;

  RETURN jsonb_build_object('success', true, 'sale', v_sale_j, 'installments', v_insts);
END;
$function$;

-- ────────────────── UNITS — plan-status (option-b) ──────────────────

CREATE OR REPLACE FUNCTION public.get_units_plan_status(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_max   int;
  v_count int;
  v_me    public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NOT NULL
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('applicable', false, 'error', 'wrong_tenant',
      'message', 'Plan status is only visible to the owning tenant.');
  END IF;
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

-- ────────────────── UNITS — derived (no p_company_id) ──────────────────

CREATE OR REPLACE FUNCTION public.get_unit_with_details(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    AND (v_me.id IS NULL OR COALESCE(v_me.is_super_admin, false) OR u.company_id = v_me.company_id)
    AND (v_all OR u.project_id = ANY(v_pids));
  RETURN COALESCE(v_result, jsonb_build_object('error', 'Unit not found'));
END; $function$;

CREATE OR REPLACE FUNCTION public.get_units_by_project(p_project_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH proj AS (
    SELECT p.company_id FROM public.projects p WHERE p.id = p_project_id
  ),
  cfg AS (
    SELECT
      COALESCE(
        (SELECT (me.id IS NULL)
             OR COALESCE(me.is_super_admin, false)
             OR (me.company_id = (SELECT company_id FROM proj) AND public._rms_is_admin(me))
         FROM public._rms_caller() me),
        true) AS v_all,
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

-- ────────────────── DASHBOARDS (plpgsql) ──────────────────

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_month_start date := date_trunc('month', now())::date;
  v_prev_month_start date := (date_trunc('month', now()) - interval '1 month')::date;
  v_six_mo_ago date := (date_trunc('month', now()) - interval '5 months')::date;
  v_this_month numeric; v_prev_month numeric;
  v_today_total numeric; v_today_count integer;
  v_recent jsonb; v_trend jsonb; v_top_overdue jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company_id');
  END IF;
  IF v_me.id IS NOT NULL
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_this_month FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date >= v_month_start
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount),0) INTO v_prev_month FROM payments p
    WHERE p.company_id = p_company_id
      AND p.payment_date >= v_prev_month_start AND p.payment_date < v_month_start
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount),0), COUNT(*) INTO v_today_total, v_today_count
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date = v_today
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT p.id, p.sale_id, p.payment_date, p.amount, p.payment_method, s.unit_id AS "unitId"
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.payment_date >= v_month_start
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
    ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 6
  ) r;

  WITH month_buckets AS (
    SELECT generate_series(v_six_mo_ago, v_month_start, interval '1 month')::date AS m_start
  ), totals AS (
    SELECT date_trunc('month', p.payment_date)::date AS m, SUM(p.amount) AS total
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date >= v_six_mo_ago
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'month', to_char(mb.m_start, 'Mon'), 'month_start', mb.m_start,
    'total', COALESCE(t.total, 0)) ORDER BY mb.m_start)
  INTO v_trend FROM month_buckets mb LEFT JOIN totals t ON t.m = mb.m_start;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.outstanding DESC), '[]'::jsonb)
  INTO v_top_overdue
  FROM (
    SELECT s.id AS sale_id, s.unit_id, c.full_name AS client_name, u.unit_no,
      SUM(p.amount) FILTER (WHERE p.id IS NOT NULL) AS paid,
      s.net_amount,
      (s.net_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL), 0)) AS outstanding,
      MAX(p.payment_date) AS last_payment_date,
      (v_today - MAX(p.payment_date))::int AS days_since_payment
    FROM sales s JOIN units u ON u.id = s.unit_id
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN payments p ON p.sale_id = s.id AND p.company_id = p_company_id
    WHERE s.company_id = p_company_id AND s.status = 'active'
      AND (v_all OR s.project_id = ANY(v_pids))
    GROUP BY s.id, s.unit_id, c.full_name, u.unit_no, s.net_amount
    HAVING (s.net_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL), 0)) > 0
      AND (MAX(p.payment_date) IS NULL OR (v_today - MAX(p.payment_date))::int > 60)
    ORDER BY outstanding DESC LIMIT 3
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'this_month_collection', v_this_month, 'prev_month_collection', v_prev_month,
    'today_collection', v_today_total, 'today_count', v_today_count,
    'recent_payments', v_recent, 'trend_6m', v_trend, 'top_overdue', v_top_overdue
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_health_dashboard_stats(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'platinum', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'PLATINUM'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'PLATINUM'), 0)),
    'good', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'GOOD'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'GOOD'), 0)),
    'at_risk', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'AT RISK'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'AT RISK'), 0)),
    'critical', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'CRITICAL'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'CRITICAL'), 0)),
    'total_clients', COUNT(*),
    'total_at_risk_exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category IN ('AT RISK', 'CRITICAL')), 0)
  ) INTO v_result
  FROM client_health_scores chs
  WHERE chs.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM clients c WHERE c.id = chs.client_id AND c.project_id = ANY(v_pids)));

  RETURN COALESCE(v_result, jsonb_build_object(
    'platinum', jsonb_build_object('count', 0, 'exposure', 0),
    'good', jsonb_build_object('count', 0, 'exposure', 0),
    'at_risk', jsonb_build_object('count', 0, 'exposure', 0),
    'critical', jsonb_build_object('count', 0, 'exposure', 0),
    'total_clients', 0, 'total_at_risk_exposure', 0
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_commissions_overview(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object(
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
      'total_commission_earned', a.total_commission_earned, 'status', a.status
    ) ORDER BY a.full_name) FROM public.agents a CROSS JOIN cfg
      WHERE a.company_id = p_company_id
        AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids))), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('agent_id', p.agent_id, 'amount', p.amount))
      FROM public.agent_commission_payments p CROSS JOIN cfg
      WHERE p.company_id = p_company_id
        AND (cfg.v_all OR EXISTS (SELECT 1 FROM public.agents pa WHERE pa.id = p.agent_id AND pa.project_id = ANY(cfg.v_pids)))), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_pdc_analytics(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status jsonb; v_aging jsonb; v_by_bank jsonb; v_by_proj jsonb; v_methods jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
BEGIN
  IF v_me.id IS NOT NULL
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.status), '[]'::jsonb) INTO v_status
  FROM (
    SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY status
  ) s;

  SELECT jsonb_build_object(
    'due_this_week', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0), 'amount', COALESCE(SUM(amount) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0)),
    'due_this_month', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0), 'amount', COALESCE(SUM(amount) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0)),
    'overdue', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff < CURRENT_DATE),0), 'amount', COALESCE(SUM(amount) FILTER (WHERE eff < CURRENT_DATE),0))
  ) INTO v_aging
  FROM (
    SELECT pc.amount, COALESCE(pc.deposit_date, pc.cheque_date) AS eff
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id AND pc.status IN ('pending','presented')
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
  ) a;

  SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY b.amount DESC), '[]'::jsonb) INTO v_by_bank
  FROM (
    SELECT COALESCE(NULLIF(bank_name,''),'(unknown)') AS bank_name,
           COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount,
           COUNT(*) FILTER (WHERE status='bounced')::int AS bounced
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  ) b;

  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.amount DESC), '[]'::jsonb) INTO v_by_proj
  FROM (
    SELECT pr.id AS project_id, COALESCE(pr.project_name,'(unassigned)') AS project_name,
           COUNT(*)::int AS count, COALESCE(SUM(pc.amount),0)::numeric AS amount
    FROM pdc_cheques pc
    LEFT JOIN sales s ON s.id = pc.sale_id
    LEFT JOIN projects pr ON pr.id = s.project_id
    WHERE pc.company_id = p_company_id
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
    GROUP BY pr.id, pr.project_name
  ) p;

  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY m.amount DESC), '[]'::jsonb) INTO v_methods
  FROM (
    SELECT COALESCE(NULLIF(payment_method,''),'(unspecified)') AS method,
           COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
    FROM payments pmt
    WHERE pmt.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pmt.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  ) m;

  RETURN jsonb_build_object('success', true, 'status_summary', v_status, 'aging', v_aging, 'by_bank', v_by_bank, 'by_project', v_by_proj, 'method_split', v_methods);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_payment_link_stats(p_company_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'total_sent', COUNT(*) FILTER (WHERE sent_at >= NOW() - (p_days || ' days')::INTERVAL),
    'pending_verification', COUNT(*) FILTER (WHERE status = 'screenshot_received'),
    'verified', COUNT(*) FILTER (WHERE status = 'verified'),
    'success_rate',
      CASE WHEN COUNT(*) FILTER (WHERE status IN ('verified','rejected')) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE status = 'verified')::NUMERIC / COUNT(*) FILTER (WHERE status IN ('verified','rejected')) * 100)::INTEGER
        ELSE 0 END,
    'total_collected', COALESCE(SUM(requested_amount) FILTER (WHERE status = 'verified'), 0)
  )
  INTO v_result
  FROM payment_links pl
  WHERE pl.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pl.sale_id AND s.project_id = ANY(v_pids)));

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$function$;

-- ────────────────── DERIVED already tenant-safe (no-op, documented) ──────────────────
-- get_applicable_tier, get_cancellation_tiers, get_project_users:
-- require session AND scope every lookup by v_me.company_id, so cross-tenant
-- ids already return 'project_not_in_company' / 'forbidden' / 'no_session'.
-- Left untouched.
