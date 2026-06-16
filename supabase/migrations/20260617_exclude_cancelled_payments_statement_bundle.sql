-- Account Statement audit fix (2026-06-17). Applied to prod via MCP.
--
-- The Account Statement (printClientStatement) shows Amount Paid / Balance Pending
-- from the units cache (u.totalPaid, built in js/store/db.js from get_units_cache_bundle)
-- and a Payment History from get_payments_for_unit. BOTH RPCs selected payments with
-- NO status filter → CANCELLED payments were counted as money received: paid overstated,
-- pending understated, and cancelled receipts listed in history. (KBH: 2 sales affected —
-- BKG-232 +130k, BKG-183 +100k.) Exclude cancelled in both. Matches the cancel→FIFO
-- allocation reversal fix (20260616_payment_cancel_reverses_fifo_allocation).

CREATE OR REPLACE FUNCTION public.get_units_cache_bundle(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('units','[]'::jsonb,'sales','[]'::jsonb,'payments','[]'::jsonb,'agents','[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  RETURN jsonb_build_object(
    'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.unit_no)
      FROM public.units u
      WHERE u.company_id = p_company_id
        AND (v_all OR u.project_id = ANY(v_pids))), '[]'::jsonb),
    'sales', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'unit_id', s.unit_id, 'client_id', s.client_id, 'agent_id', s.agent_id,
        'sale_number', s.sale_number, 'sale_date', s.sale_date, 'net_amount', s.net_amount,
        'total_amount', s.total_amount, 'status', s.status, 'sale_type_id', s.sale_type_id))
      FROM public.sales s
      WHERE s.company_id = p_company_id AND s.status <> 'cancelled'
        AND (v_all OR EXISTS (SELECT 1 FROM public.units u2
              WHERE u2.id = s.unit_id AND u2.project_id = ANY(v_pids)))), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sale_id', p.sale_id, 'amount', p.amount, 'payment_date', p.payment_date)
        ORDER BY p.payment_date DESC)
      FROM public.payments p
      WHERE p.company_id = p_company_id
        AND COALESCE(p.status,'') <> 'cancelled'
        AND (v_all OR EXISTS (SELECT 1 FROM public.sales s2
              JOIN public.units u2 ON u2.id = s2.unit_id
              WHERE s2.id = p.sale_id AND u2.project_id = ANY(v_pids)))), '[]'::jsonb),
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'full_name', a.full_name))
      FROM public.agents a WHERE a.company_id = p_company_id), '[]'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.get_payments_for_unit(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'payment_date', p.payment_date, 'amount', p.amount,
    'payment_method', p.payment_method, 'reference_no', p.reference_no,
    'notes', p.notes, 'payment_code', p.payment_code, 'created_by', p.created_by
  ) ORDER BY p.payment_date), '[]'::jsonb)
  FROM public.payments p CROSS JOIN cfg
  WHERE p.company_id = p_company_id
    AND COALESCE(p.status,'') <> 'cancelled'
    AND p.sale_id IN (SELECT s.id FROM public.sales s
      WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id
        AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids)));
$function$;
