-- ============================================================================
-- NEXUNOVA RMS — AGENT RECOVERY BOOK (sale-agent-wise outstanding)
-- 2026-06-17.  Owner ask: "har sale agent ko pata ho usne kaunsa unit becha aur
-- us client ke peeche kitna outstanding hai — taake wo apne client se khud recover
-- kare."  This is the SELLER-accountability mirror of My Recovery (which is the
-- recovery OFFICER's view). Same FIFO arrears math, pivoted on sales.agent_id.
--
-- Pieces:
--   _agent_outstanding_core(co, project, agent, as_of)  — private engine (jsonb)
--   get_agent_outstanding(co, project, agent, as_of)     — ADMIN report (_rms_caller)
--   get_my_outstanding(session_token)                    — agent SELF-view (portal)
--   assign_sale_agent(co, sale_ids[], agent)             — attribute existing sales
--
-- Outstanding model (as_of a single date, no future installments):
--   received     = Σ non-cancelled payments (payment_date <= as_of)
--   due_to_date  = Σ installment amount_due (due_date <= as_of, incl. down payment)
--   overdue      = greatest(0, due_to_date − received)   ← THE headline (arrears)
--   total_remaining = net_amount − received              (lifetime balance owed)
--   month_due    = Σ amount_due due in the as_of calendar month
--   overdue_days = as_of − oldest still-unpaid due_date (FIFO running coverage)
-- Sales with agent_id IS NULL roll up under a synthetic "Direct / Unassigned"
-- bucket (agent_id = null in the payload) so nothing is silently dropped.
-- ============================================================================

-- ── 1. PRIVATE ENGINE ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._agent_outstanding_core(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_agent_id   uuid DEFAULT NULL,
  p_as_of      date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_as date := COALESCE(p_as_of, CURRENT_DATE);
  v_ms date := date_trunc('month', COALESCE(p_as_of, CURRENT_DATE))::date;
  v_me date := (date_trunc('month', COALESCE(p_as_of, CURRENT_DATE)) + interval '1 month')::date;
  v_result jsonb;
BEGIN
  WITH
  recv AS (
    SELECT p.sale_id, COALESCE(SUM(p.amount),0) AS received
    FROM public.payments p
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date <= v_as
    GROUP BY p.sale_id
  ),
  last_pay AS (
    SELECT p.sale_id, MAX(p.payment_date) AS last_dt
    FROM public.payments p
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date <= v_as
    GROUP BY p.sale_id
  ),
  due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS due_to_date
    FROM public.installments i
    WHERE i.company_id = p_company_id AND i.due_date <= v_as
    GROUP BY i.sale_id
  ),
  mdue AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS month_due
    FROM public.installments i
    WHERE i.company_id = p_company_id AND i.due_date >= v_ms AND i.due_date < v_me
    GROUP BY i.sale_id
  ),
  inst_cum AS (
    SELECT i.sale_id, i.due_date,
      SUM(i.amount_due) OVER (PARTITION BY i.sale_id
        ORDER BY i.due_date, COALESCE(i.installment_number,0)
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_due
    FROM public.installments i
    WHERE i.company_id = p_company_id AND i.due_date <= v_as
  ),
  oldest_unpaid AS (
    SELECT ic.sale_id, MIN(ic.due_date) AS odue
    FROM inst_cum ic
    JOIN recv r ON r.sale_id = ic.sale_id
    WHERE ic.cum_due > COALESCE(r.received,0) + 0.5
    GROUP BY ic.sale_id
  ),
  pdc_hand AS (
    SELECT pc.sale_id, COALESCE(SUM(pc.amount),0) AS pdc_amt
    FROM public.pdc_cheques pc
    WHERE pc.company_id = p_company_id AND lower(pc.status) IN ('pending','presented')
    GROUP BY pc.sale_id
  ),
  rowsrc AS (
    SELECT
      s.id                                  AS sale_id,
      s.unit_id,
      s.client_id,
      s.agent_id,
      ag.agent_code,
      COALESCE(ag.full_name, 'Direct / Unassigned') AS agent_name,
      ag.phone                              AS agent_phone,
      pr.id                                 AS project_id,
      pr.project_name,
      cl.client_code,
      cl.full_name                          AS client_name,
      COALESCE(NULLIF(TRIM(cl.phone_primary),''), NULLIF(TRIM(cl.phone_secondary),'')) AS client_phone,
      u.unit_no,
      COALESCE(fl.name, NULLIF(u.floor_label,''), u.floor_no::text) AS floor_name,
      ut.type_name                          AS category_name,
      s.sale_date                           AS reg_date,
      s.net_amount                          AS net_price,
      COALESCE(rc.received,0)               AS received,
      (s.net_amount - COALESCE(rc.received,0)) AS total_remaining,
      COALESCE(d.due_to_date,0)             AS due_to_date,
      GREATEST(0, COALESCE(d.due_to_date,0) - COALESCE(rc.received,0)) AS overdue,
      COALESCE(md.month_due,0)              AS month_due,
      CASE WHEN ou.odue IS NOT NULL THEN GREATEST(0, (v_as - ou.odue)) ELSE 0 END AS overdue_days,
      lp.last_dt                            AS last_payment_date,
      COALESCE(ph.pdc_amt,0)                AS pdc_in_hand,
      COALESCE(ROUND(COALESCE(rc.received,0) / NULLIF(s.net_amount,0) * 100, 1), 0) AS paid_pct,
      ( EXISTS (SELECT 1 FROM public.legal_cases lc
                 WHERE lc.company_id = p_company_id
                   AND (lc.sale_id = s.id OR lc.client_id = s.client_id)
                   AND lc.outcome IS NULL
                   AND lower(lc.stage) NOT IN ('settled','closed'))
        OR EXISTS (SELECT 1 FROM public.escalations e
                 WHERE e.company_id = p_company_id
                   AND (e.sale_id = s.id OR e.client_id = s.client_id)
                   AND lower(e.status) NOT IN ('resolved','closed','dismissed','cancelled')) ) AS flag_legal
    FROM public.sales s
    JOIN      public.units    u  ON u.id = s.unit_id AND u.company_id = s.company_id
    LEFT JOIN public.floors   fl ON fl.id = u.floor_id AND fl.company_id = u.company_id
    LEFT JOIN public.clients  cl ON cl.id = s.client_id
    LEFT JOIN public.agents   ag ON ag.id = s.agent_id
    LEFT JOIN public.projects pr ON pr.id = s.project_id
    LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN recv          rc ON rc.sale_id = s.id
    LEFT JOIN due           d  ON d.sale_id  = s.id
    LEFT JOIN mdue          md ON md.sale_id = s.id
    LEFT JOIN oldest_unpaid ou ON ou.sale_id = s.id
    LEFT JOIN last_pay      lp ON lp.sale_id = s.id
    LEFT JOIN pdc_hand      ph ON ph.sale_id = s.id
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_agent_id   IS NULL OR s.agent_id   = p_agent_id)
  )
  SELECT jsonb_build_object(
    'as_of', to_char(v_as,'YYYY-MM-DD'),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sale_id', sale_id, 'unit_id', unit_id, 'client_id', client_id,
        'agent_id', agent_id, 'agent_code', agent_code, 'agent_name', agent_name,
        'project_id', project_id, 'project_name', project_name,
        'client_code', client_code, 'client_name', client_name, 'phone', client_phone,
        'unit_no', unit_no, 'floor_name', floor_name, 'category_name', category_name,
        'reg_date', to_char(reg_date,'YYYY-MM-DD'),
        'net_price', net_price, 'received', received, 'total_remaining', total_remaining,
        'due_to_date', due_to_date, 'overdue', overdue, 'month_due', month_due,
        'overdue_days', overdue_days,
        'last_payment_date', to_char(last_payment_date,'YYYY-MM-DD'),
        'pdc_in_hand', pdc_in_hand, 'paid_pct', paid_pct, 'flag_legal', flag_legal
      ) ORDER BY overdue DESC, total_remaining DESC)
      FROM rowsrc), '[]'::jsonb),
    'agents', COALESCE((
      SELECT jsonb_agg(a) FROM (
        SELECT jsonb_build_object(
          'agent_id', agent_id, 'agent_code', MIN(agent_code), 'agent_name', agent_name,
          'agent_phone', MIN(agent_phone),
          'units_sold', COUNT(*),
          'clients', COUNT(DISTINCT client_id),
          'net_value', COALESCE(SUM(net_price),0),
          'received', COALESCE(SUM(received),0),
          'total_remaining', COALESCE(SUM(total_remaining),0),
          'overdue', COALESCE(SUM(overdue),0),
          'month_due', COALESCE(SUM(month_due),0),
          'pdc_in_hand', COALESCE(SUM(pdc_in_hand),0),
          'clients_in_arrears', COUNT(*) FILTER (WHERE overdue > 0.5),
          'last_collection', to_char(MAX(last_payment_date),'YYYY-MM-DD'),
          'collected_pct', COALESCE(ROUND(SUM(received)/NULLIF(SUM(net_price),0)*100,1),0)
        ) AS a
        FROM rowsrc
        GROUP BY agent_id, agent_name
        ORDER BY COALESCE(SUM(overdue),0) DESC, COALESCE(SUM(total_remaining),0) DESC
      ) z), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'agents',            COUNT(DISTINCT agent_id),
        'units_sold',        COUNT(*),
        'clients',           COUNT(DISTINCT client_id),
        'net_value',         COALESCE(SUM(net_price),0),
        'received',          COALESCE(SUM(received),0),
        'total_remaining',   COALESCE(SUM(total_remaining),0),
        'overdue',           COALESCE(SUM(overdue),0),
        'month_due',         COALESCE(SUM(month_due),0),
        'pdc_in_hand',       COALESCE(SUM(pdc_in_hand),0),
        'clients_in_arrears',COUNT(*) FILTER (WHERE overdue > 0.5),
        'collected_pct',     COALESCE(ROUND(SUM(received)/NULLIF(SUM(net_price),0)*100,1),0)
      ) FROM rowsrc)
  )
  INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('as_of',to_char(v_as,'YYYY-MM-DD'),'rows','[]'::jsonb,'agents','[]'::jsonb,'totals','{}'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public._agent_outstanding_core(uuid,uuid,uuid,date) FROM PUBLIC;

-- ── 2. ADMIN report wrapper ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_agent_outstanding(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_agent_id   uuid DEFAULT NULL,
  p_as_of      date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_res jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  v_res := public._agent_outstanding_core(p_company_id, p_project_id, p_agent_id, p_as_of);
  RETURN v_res || jsonb_build_object('success',true);
END
$function$;

REVOKE ALL ON FUNCTION public.get_agent_outstanding(uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_outstanding(uuid,uuid,uuid,date) TO anon, authenticated;

-- ── 3. AGENT self-view wrapper (sales-portal session) ───────────────────────
CREATE OR REPLACE FUNCTION public.get_my_outstanding(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_res jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_su.agent_id IS NULL THEN
    RETURN jsonb_build_object('success',true,'no_agent',true,'rows','[]'::jsonb,'agents','[]'::jsonb,'totals','{}'::jsonb,
      'message','Your sales-agent profile is being set up. Once your admin links it, your recovery book appears here.');
  END IF;
  v_res := public._agent_outstanding_core(v_ses.company_id, NULL, v_su.agent_id, CURRENT_DATE);
  RETURN v_res || jsonb_build_object('success',true,
    'agent_name', v_su.full_name);
END
$function$;

REVOKE ALL ON FUNCTION public.get_my_outstanding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_outstanding(text) TO anon, authenticated;

-- ── 4. ASSIGN sale agent to existing sale(s) — attribution, NOT commission ──
-- RMS records WHO recovers; money/commission stays in QuickBooks. So this only
-- stamps sales.agent_id (+ audit). It does NOT touch agent commission totals.
CREATE OR REPLACE FUNCTION public.assign_sale_agent(
  p_company_id uuid,
  p_sale_ids   uuid[],
  p_agent_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_n int; v_agent public.agents;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF p_sale_ids IS NULL OR array_length(p_sale_ids,1) IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_sales','message','Pick at least one client/unit to assign.'); END IF;

  -- p_agent_id NULL = clear attribution (move back to Direct/Unassigned)
  IF p_agent_id IS NOT NULL THEN
    SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_agent'); END IF;
  END IF;

  UPDATE public.sales
     SET agent_id = p_agent_id, updated_at = now()
   WHERE company_id = p_company_id
     AND id = ANY(p_sale_ids)
     AND status <> 'cancelled';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action,
                                 changed_by, changed_by_name, new_data, module, reason)
  VALUES (p_company_id, 'sales', NULL, 'UPDATE',
    v_me.id, COALESCE(v_me.full_name, v_me.username),
    jsonb_build_object('op','assign_sale_agent','agent_id',p_agent_id,
      'agent_name', COALESCE(v_agent.full_name,'(cleared)'),
      'sale_count', v_n, 'sale_ids', to_jsonb(p_sale_ids)),
    'sales',
    'Assigned sale agent '||COALESCE(v_agent.full_name,'(cleared)')||' to '||v_n||' sale(s)');

  RETURN jsonb_build_object('success',true,'updated',v_n,
    'agent_name', COALESCE(v_agent.full_name,null));
END
$function$;

REVOKE ALL ON FUNCTION public.assign_sale_agent(uuid,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_sale_agent(uuid,uuid[],uuid) TO anon, authenticated;
