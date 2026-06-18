-- Board Brief: one-page director summary, computed server-side and verified.
-- Wraps get_recovery_position for per-sale closing/ageing, then adds the figures
-- the working report doesn't carry: cash vs imported opening-balance split,
-- concentration (top 10/20), behaviour buckets, and cancellation leakage.
-- Officer/admin scoped via _rms_caller() exactly like get_officer_recovery.
CREATE OR REPLACE FUNCTION public.get_recovery_board_brief(
  p_company_id uuid, p_from date, p_to date, p_month_end date DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cal AS (
    SELECT id AS uid, (COALESCE(is_super_admin,false) OR role IN ('admin','owner')) AS is_full
    FROM public._rms_caller()
  ),
  projset AS (
    SELECT project_id FROM public.user_project_assignments
    WHERE user_id=(SELECT uid FROM cal) AND is_active
  ),
  allowed AS (
    SELECT s.id AS sale_id FROM public.sales s
    WHERE s.company_id=p_company_id
      AND ((SELECT is_full FROM cal) OR s.project_id IN (SELECT project_id FROM projset))
  ),
  base AS (SELECT get_recovery_position(p_company_id, NULL, p_from, p_to) AS d),
  rows AS (
    SELECT e FROM base, jsonb_array_elements(base.d->'rows') e
    JOIN allowed a ON a.sale_id=(e->>'sale_id')::uuid
  ),
  agg AS (
    SELECT
      COUNT(*) active_accounts,
      COALESCE(SUM((e->>'closing')::numeric),0) outstanding,
      COUNT(*) FILTER (WHERE (e->>'closing')::numeric<=0.5) current_or_ahead,
      COUNT(*) FILTER (WHERE (e->>'closing')::numeric>0.5) behind,
      COUNT(*) FILTER (WHERE (e->>'paid_to_date')::numeric<=0.5) never_paid,
      COALESCE(SUM((e->>'net_price')::numeric),0) contract_value,
      COALESCE(SUM((e->>'received_total')::numeric),0) received_period,
      COALESCE(SUM(CASE WHEN (e->>'closing')::numeric>0.5 AND COALESCE((e->>'overdue_days')::numeric,0)<=30 THEN (e->>'closing')::numeric ELSE 0 END),0) age_0_30,
      COALESCE(SUM(CASE WHEN (e->>'closing')::numeric>0.5 AND (e->>'overdue_days')::numeric BETWEEN 31 AND 90 THEN (e->>'closing')::numeric ELSE 0 END),0) age_31_90,
      COALESCE(SUM(CASE WHEN (e->>'closing')::numeric>0.5 AND (e->>'overdue_days')::numeric BETWEEN 91 AND 180 THEN (e->>'closing')::numeric ELSE 0 END),0) age_91_180,
      COALESCE(SUM(CASE WHEN (e->>'closing')::numeric>0.5 AND (e->>'overdue_days')::numeric>180 THEN (e->>'closing')::numeric ELSE 0 END),0) age_180p
    FROM rows
  ),
  ranked AS (
    SELECT (e->>'closing')::numeric closing, ROW_NUMBER() OVER (ORDER BY (e->>'closing')::numeric DESC) rn
    FROM rows WHERE (e->>'closing')::numeric>0.5
  ),
  conc AS (SELECT COALESCE(SUM(closing) FILTER (WHERE rn<=10),0) top10, COALESCE(SUM(closing) FILTER (WHERE rn<=20),0) top20 FROM ranked),
  toplist AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'client',z.e->>'client_name','unit',z.e->>'unit_no',
      'closing',(z.e->>'closing')::numeric,'odd',(z.e->>'overdue_days')::numeric,
      'paid_pct',(z.e->>'paid_pct')::numeric) ORDER BY (z.e->>'closing')::numeric DESC),'[]'::jsonb) top_rows
    FROM (SELECT e FROM rows WHERE (e->>'closing')::numeric>0.5 ORDER BY (e->>'closing')::numeric DESC LIMIT 8) z
  ),
  demand AS (
    SELECT COALESCE(SUM(i.amount_due),0) demand_full
    FROM public.installments i JOIN public.sales s ON s.id=i.sale_id
    WHERE i.company_id=p_company_id AND s.status<>'cancelled' AND COALESCE(s.is_active,s.status='active')
      AND s.id IN (SELECT sale_id FROM allowed)
      AND i.due_date BETWEEN p_from AND COALESCE(p_month_end,p_to)
  ),
  cashsplit AS (
    SELECT
      COALESCE(SUM(pp.amount) FILTER (WHERE pp.payment_date<=p_to AND pp.payment_method<>'adjustment'),0) cash_to_date,
      COALESCE(SUM(pp.amount) FILTER (WHERE pp.payment_date<=p_to AND pp.payment_method='adjustment'),0) adj_to_date,
      COALESCE(SUM(pp.amount) FILTER (WHERE pp.payment_date BETWEEN p_from AND p_to AND pp.payment_method<>'adjustment'),0) cash_period
    FROM public.payments pp JOIN public.sales s ON s.id=pp.sale_id
    WHERE pp.company_id=p_company_id AND pp.status<>'cancelled' AND s.status<>'cancelled' AND COALESCE(s.is_active,s.status='active')
      AND s.id IN (SELECT sale_id FROM allowed)
  ),
  cancel AS (
    SELECT COUNT(*) cancelled_count, COALESCE(SUM(net_amount),0) cancelled_value
    FROM public.sales s WHERE s.company_id=p_company_id AND s.status='cancelled'
      AND ((SELECT is_full FROM cal) OR s.project_id IN (SELECT project_id FROM projset))
  )
  SELECT jsonb_build_object(
    'scoped', NOT (SELECT is_full FROM cal),
    'active_accounts',(SELECT active_accounts FROM agg),
    'outstanding',(SELECT outstanding FROM agg),
    'current_or_ahead',(SELECT current_or_ahead FROM agg),
    'behind',(SELECT behind FROM agg),
    'never_paid',(SELECT never_paid FROM agg),
    'contract_value',(SELECT contract_value FROM agg),
    'cash_to_date',(SELECT cash_to_date FROM cashsplit),
    'adj_to_date',(SELECT adj_to_date FROM cashsplit),
    'collected_all',(SELECT cash_to_date+adj_to_date FROM cashsplit),
    'received_period',(SELECT received_period FROM agg),
    'cash_period',(SELECT cash_period FROM cashsplit),
    'demand_full',(SELECT demand_full FROM demand),
    'age_0_30',(SELECT age_0_30 FROM agg),'age_31_90',(SELECT age_31_90 FROM agg),
    'age_91_180',(SELECT age_91_180 FROM agg),'age_180p',(SELECT age_180p FROM agg),
    'top10',(SELECT top10 FROM conc),'top20',(SELECT top20 FROM conc),
    'top_rows',(SELECT top_rows FROM toplist),
    'cancelled_count',(SELECT cancelled_count FROM cancel),
    'cancelled_value',(SELECT cancelled_value FROM cancel)
  );
$function$;
REVOKE ALL ON FUNCTION public.get_recovery_board_brief(uuid,date,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recovery_board_brief(uuid,date,date,date) TO authenticated, service_role;
