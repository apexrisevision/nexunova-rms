-- ════════════════════════════════════════════════════════════
-- TENANT-ISOLATION T5: tenant-gate on 13 sales-read RPCs (B6B)
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Same v_all-formula mod as T2/T3/T4. No explicit wrong_tenant gates needed:
-- every RPC has a natural reject path (empty array / NULL / existing
-- {success:false, error:'not_found' | 'sale_not_found'}) that fires when
-- v_all=false and v_pids is empty (UPA scoped by p_company_id).
--
-- NOTE: get_sales_register is intentionally EXCLUDED. It is one of the
-- caller-blind report RPCs (reverted 2026-05-30, see
-- 20260530_revert_get_sales_register_to_caller_blind.sql).
--
-- Anon (me.id NULL) → v_all=true unchanged. Same-tenant admin unchanged.
-- Cross-tenant admin/officer → v_all=false AND v_pids empty → empty/null/not_found.

-- ────────────────── sql/cfg-CTE ──────────────────

CREATE OR REPLACE FUNCTION public.list_sales_for_fnav(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'sale_date', sale_date)
                            ORDER BY sale_date ASC), '[]'::jsonb)
  FROM (SELECT s.id, s.sale_date FROM sales s CROSS JOIN cfg
        WHERE s.company_id = p_company_id AND s.is_active = true
          AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
        ORDER BY s.sale_date ASC LIMIT 2000) t;
$function$;

CREATE OR REPLACE FUNCTION public.list_sales_lookup(p_company_id uuid)
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'client_id', s.client_id, 'unit_id', s.unit_id,
    'clients', jsonb_build_object('client_name', c.full_name, 'full_name', c.full_name),
    'units', jsonb_build_object('unit_no', u.unit_no, 'unit_number', u.unit_no, 'unit_code', u.unit_code)
  ) ORDER BY s.sale_number), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  LEFT JOIN public.clients c ON c.id = s.client_id
  LEFT JOIN public.units u ON u.id = s.unit_id
  WHERE s.company_id = p_company_id
    AND s.status <> 'cancelled'
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_unit_map(p_company_id uuid, p_sale_ids uuid[])
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'unit_id', s.unit_id)), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.company_id = p_company_id
    AND s.id = ANY(p_sale_ids)
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_for_lookup(p_sale_id uuid, p_company_id uuid)
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
  SELECT to_jsonb(s) FROM (
    SELECT s.id, s.client_id, s.unit_id, s.sale_number, s.status
    FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_quick_edit(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
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
  SELECT COALESCE(to_jsonb(s), jsonb_build_object('error','sale_not_found'))
  FROM (SELECT s.id, s.client_id, s.agent_id, s.sale_date, s.notes,
               s.co_buyer_name, s.co_buyer_cnic, s.co_buyer_share_pct,
               s.nominee_name, s.nominee_cnic, s.nominee_relation,
               s.wht_amount, s.cvt_amount
        FROM sales s CROSS JOIN cfg
        WHERE s.id = p_sale_id AND s.company_id = p_company_id
          AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))) s;
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_unit_id(p_id uuid, p_company_id uuid)
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
  SELECT jsonb_build_object('unit_id', s.unit_id)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.id = p_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_documents_amendments(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
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
  SELECT jsonb_build_object(
    'documents', COALESCE((
      SELECT jsonb_agg(row_to_json(d) ORDER BY d.uploaded_at DESC)
      FROM (SELECT id, sale_id, document_type, document_name, document_url, uploaded_by, uploaded_at
            FROM sale_documents
            WHERE sale_id = p_sale_id AND company_id = p_company_id
              AND EXISTS (SELECT 1 FROM parent)) d
    ), '[]'::jsonb),
    'amendments', COALESCE((
      SELECT jsonb_agg(row_to_json(a) ORDER BY a.amended_at DESC)
      FROM (SELECT id, sale_id, amendment_type, description, reason, amended_by, amended_at
            FROM sale_amendments
            WHERE sale_id = p_sale_id AND company_id = p_company_id
              AND EXISTS (SELECT 1 FROM parent)) a
    ), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.get_active_sale_for_unit(p_unit_id uuid, p_company_id uuid)
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
  SELECT to_jsonb(s) FROM (
    SELECT s.id, s.client_id, s.agent_id, s.net_amount, s.sale_date, s.sale_number,
           s.commission_rate, s.is_resale, s.is_transfer, s.unit_id, s.status
    FROM public.sales s CROSS JOIN cfg
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id AND s.is_active = true
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
    ORDER BY s.created_at DESC LIMIT 1
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_sale_for_unit_full(p_unit_id uuid, p_company_id uuid)
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
  SELECT to_jsonb(s) FROM (
    SELECT s.id, s.client_id, s.agent_id, s.total_amount, s.discount_amount, s.discount_percentage,
           s.payment_plan_type, s.wht_amount, s.cvt_amount, s.co_buyer_name, s.nominee_name,
           s.nominee_relation, s.is_transfer, s.transferred_from_sale_id, s.is_active
    FROM public.sales s CROSS JOIN cfg
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id AND s.status = 'active'
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
    LIMIT 1
  ) s;
$function$;

-- ────────────────── plpgsql v_me ──────────────────

CREATE OR REPLACE FUNCTION public.list_sales(p_company_id uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(row_to_json(q)) INTO v_result
  FROM (
    SELECT
      s.id, s.sale_number, s.sale_date, s.status,
      s.price_per_sqft, s.area_sqft,
      s.total_amount, s.discount, s.net_amount,
      s.down_payment, s.remaining_amount, s.installment_count,
      u.id AS unit_id, u.unit_no, u.unit_code,
      pr.project_name,
      c.id AS client_id, c.full_name AS client_name,
      ag.id AS agent_id, ag.full_name AS agent_name,
      COUNT(i.id) FILTER (WHERE i.status = 'paid') AS installments_paid,
      COUNT(i.id)                                   AS installments_total,
      COALESCE(SUM(i.amount_paid), 0)               AS total_collected,
      COALESCE(SUM(i.outstanding), s.net_amount)    AS total_outstanding
    FROM      public.sales        s
    LEFT JOIN public.units        u   ON u.id  = s.unit_id
    LEFT JOIN public.projects     pr  ON pr.id = u.project_id
    LEFT JOIN public.clients      c   ON c.id  = s.client_id
    LEFT JOIN public.agents       ag  ON ag.id = s.agent_id
    LEFT JOIN public.installments i   ON i.sale_id = s.id
    WHERE s.company_id = p_company_id
      AND (v_all OR s.project_id = ANY(v_pids))
      AND (p_status IS NULL OR s.status = p_status)
      AND (p_search IS NULL OR p_search = '' OR
           u.unit_no     ILIKE '%' || p_search || '%' OR
           c.full_name   ILIKE '%' || p_search || '%' OR
           s.sale_number ILIKE '%' || p_search || '%')
    GROUP BY s.id, u.id, pr.id, c.id, ag.id
    ORDER BY s.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) q;
  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_sales_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := NULLIF(p_filters->>'status','');
  v_status_in text := NULLIF(p_filters->>'status_in','');
  v_ids_in text := NULLIF(p_filters->>'ids_in','');
  v_discount_gt numeric := COALESCE((p_filters->>'discount_gt')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
      AND (v_status IS NULL OR status = v_status)
      AND (v_status_in IS NULL OR status = ANY(string_to_array(v_status_in, ',')))
      AND (v_ids_in IS NULL OR id::text = ANY(string_to_array(v_ids_in, ',')))
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_sale  JSONB;
  v_instl JSONB;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids  uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'sale_date', s.sale_date,
    'status', s.status, 'price_per_sqft', s.price_per_sqft,
    'area_sqft', s.area_sqft, 'total_amount', s.total_amount,
    'discount', s.discount, 'net_amount', s.net_amount,
    'down_payment', s.down_payment, 'remaining_amount', s.remaining_amount,
    'installment_count', s.installment_count, 'notes', s.notes,
    'unit_id', u.id, 'unit_no', u.unit_no, 'unit_code', u.unit_code,
    'floor_label', u.floor_label, 'unit_type', ut.type_name,
    'project_name', pr.project_name,
    'client_id', c.id, 'client_name', c.full_name,
    'agent_id', ag.id, 'agent_name', ag.full_name,
    'created_at', s.created_at,
    'co_buyer_name', s.co_buyer_name, 'co_buyer_cnic', s.co_buyer_cnic,
    'co_buyer_share_pct', s.co_buyer_share_pct,
    'nominee_name', s.nominee_name, 'nominee_cnic', s.nominee_cnic,
    'nominee_relation', s.nominee_relation,
    'wht_amount', s.wht_amount, 'cvt_amount', s.cvt_amount,
    'discount_approved_by', s.discount_approved_by,
    'discount_notes', s.discount_notes,
    'cancellation_reason', s.cancellation_reason,
    'cancellation_date', s.cancellation_date,
    'cancelled_by', s.cancelled_by,
    'commission_rate', s.commission_rate,
    'delivery_breach', s.delivery_breach,
    'breach_months', s.breach_months,
    'breach_reason_type', s.breach_reason_type,
    'breach_reason_detail', s.breach_reason_detail,
    'breach_approved_by', s.breach_approved_by,
    'breach_approval_ref', s.breach_approval_ref,
    'breach_approved_at', s.breach_approved_at
  ) INTO v_sale
  FROM public.sales s
  LEFT JOIN public.units                u   ON u.id  = s.unit_id
  LEFT JOIN public.category_unit_types  ut  ON ut.id = u.unit_type_id
  LEFT JOIN public.projects             pr  ON pr.id = u.project_id
  LEFT JOIN public.clients              c   ON c.id  = s.client_id
  LEFT JOIN public.agents               ag  ON ag.id = s.agent_id
  WHERE s.id = p_sale_id AND s.company_id = p_company_id
    AND (v_all OR s.project_id = ANY(v_pids));

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', i.id, 'installment_number', i.installment_number,
      'due_date', i.due_date, 'amount_due', i.amount_due,
      'amount_paid', i.amount_paid,
      'balance', GREATEST(i.amount_due - i.amount_paid, 0),
      'installment_type', i.installment_type,
      'status', i.status, 'paid_at', i.paid_at, 'notes', i.notes
    ) ORDER BY i.installment_number
  ) INTO v_instl
  FROM public.installments i
  WHERE i.sale_id = p_sale_id AND i.company_id = p_company_id;

  RETURN jsonb_build_object(
    'success', true, 'sale', v_sale,
    'installments', COALESCE(v_instl, '[]'::JSONB)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_for_edit(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         jsonb;
  v_installments jsonb;
  v_me           public.app_users := public._rms_caller();
  v_all          boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids         uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT to_jsonb(s) INTO v_sale FROM (
    SELECT id, sale_number, unit_id, client_id, agent_id, sale_date,
           price_per_sqft, area_sqft, total_amount, discount, net_amount,
           down_payment, remaining_amount, notes, co_buyer_name, co_buyer_cnic,
           co_buyer_share_pct, nominee_name, nominee_cnic, nominee_relation,
           wht_amount, cvt_amount, discount_approved_by, discount_notes, status
    FROM sales WHERE id = p_sale_id AND company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
  ) s;
  IF v_sale IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.installment_number), '[]'::jsonb)
  INTO v_installments FROM (
    SELECT id, installment_number, installment_type, due_date,
           amount_due, amount_paid, notes, status
    FROM installments WHERE sale_id = p_sale_id AND company_id = p_company_id
    ORDER BY installment_number
  ) i;
  RETURN jsonb_build_object('success', true, 'sale', v_sale, 'installments', v_installments);
END;
$function$;
