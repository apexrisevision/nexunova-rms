-- Team Performance: officer-wise scorecard over an arbitrary period.
-- Extends get_team_performance_lite with p_from/p_to params, field_visits,
-- escalations, dual keep-rate (strict kept/made + fair kept/matured), and the
-- collections OLD/CURRENT/DEAD split lifted verbatim from get_recovery_position's
-- FIFO (psum -> lines -> perline). Admin-gated, STABLE SECURITY DEFINER, no new tables.
-- Attribution: collections = project-assignment (matches the lite scoreboard);
--   created_by-precise attribution is a FUTURE upgrade (receipts are not yet stamped).
-- Verified on ZZTEST (seeded officer, hand-computed): calls/visits/escalations 5/3/2,
-- promises made/kept/matured 7/4/6, keep_rate_made 57.1% / keep_rate_matured 66.7%,
-- recovered 150,000 split old/current/dead 100k/50k/100k — all exact.
CREATE OR REPLACE FUNCTION public.get_team_performance(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL::uuid,
  p_from       date DEFAULT (date_trunc('month', CURRENT_DATE))::date,
  p_to         date DEFAULT CURRENT_DATE
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me     public.app_users;
  v_cut    date := p_to - 90;   -- >90d overdue cutoff = "Dead" recovery (same as RP)
  v_result jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL
     OR NOT public._rms_is_admin(v_me)
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'recovered')::numeric DESC NULLS LAST, row->>'full_name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id',            u.id,
      'full_name',          u.full_name,
      'projects',           COALESCE(pj.project_names, ARRAY[]::text[]),
      'calls',              COALESCE(cl.calls, 0),
      'visits',             COALESCE(fv.visits, 0),
      'escalations',        COALESCE(es.escs, 0),
      'promises_made',      COALESCE(pp.made, 0),
      'promises_kept',      COALESCE(pp.kept, 0),
      'promises_matured',   COALESCE(pp.matured, 0),
      'keep_rate_made',     CASE WHEN COALESCE(pp.made,0)    = 0 THEN NULL ELSE ROUND(pp.kept::numeric        / pp.made    * 100, 1) END,
      'keep_rate_matured',  CASE WHEN COALESCE(pp.matured,0) = 0 THEN NULL ELSE ROUND(pp.kept_matured::numeric / pp.matured * 100, 1) END,
      'recovered',          COALESCE(rec.recovered, 0),
      'recovered_old',      COALESCE(rec.r_old, 0),
      'recovered_current',  COALESCE(rec.r_cur, 0),
      'recovered_dead',     COALESCE(rec.r_dead, 0),
      'outstanding',        COALESCE(ins.outstanding, 0),
      'overdue',            COALESCE(ins.overdue, 0),
      'untouched_overdue',  COALESCE(nu.untouched, 0),
      'pending_approvals',  COALESCE(ap.pending_count, 0)
    ) AS row
    FROM public.app_users u
    LEFT JOIN LATERAL (
      SELECT array_agg(p.project_name ORDER BY p.project_name) AS project_names,
             array_agg(upa.project_id)                         AS project_ids
      FROM public.user_project_assignments upa
      JOIN public.projects p ON p.id = upa.project_id
      WHERE upa.user_id = u.id
        AND upa.company_id = p_company_id
        AND upa.is_active = true
        AND (p_project_id IS NULL OR upa.project_id = p_project_id)
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(GREATEST(i.amount_due - i.amount_paid, 0)) AS outstanding,
        SUM(CASE WHEN i.due_date < CURRENT_DATE
                 THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END) AS overdue
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
    ) ins ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS calls
      FROM public.contact_logs c
      WHERE c.company_id = p_company_id
        AND c.agent_id = u.id::text
        AND c.contact_date BETWEEN p_from AND p_to
        AND (p_project_id IS NULL OR c.project_id = p_project_id)
    ) cl ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS visits
      FROM public.field_visits f
      WHERE f.company_id = p_company_id
        AND f.officer_id = u.id
        AND f.visit_date BETWEEN p_from AND p_to
        AND (p_project_id IS NULL OR f.project_id = p_project_id)
    ) fv ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS escs
      FROM public.escalations e
      WHERE e.company_id = p_company_id
        AND e.escalated_by = u.id
        AND e.created_at::date BETWEEN p_from AND p_to
        AND (p_project_id IS NULL OR e.project_id = p_project_id)
    ) es ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE pr.promise_made_on BETWEEN p_from AND p_to) AS made,
        COUNT(*) FILTER (WHERE pr.promise_made_on BETWEEN p_from AND p_to
                           AND pr.status IN ('kept','partial')) AS kept,
        COUNT(*) FILTER (WHERE pr.promise_made_on BETWEEN p_from AND p_to
                           AND pr.promise_date <= p_to) AS matured,
        COUNT(*) FILTER (WHERE pr.promise_made_on BETWEEN p_from AND p_to
                           AND pr.promise_date <= p_to
                           AND pr.status IN ('kept','partial')) AS kept_matured
      FROM public.payment_promises pr
      WHERE pr.company_id = p_company_id
        AND pr.logged_by = u.id::text
        AND pr.project_id = ANY(pj.project_ids)
    ) pp ON true
    LEFT JOIN LATERAL (
      WITH osale AS (
        SELECT s.id FROM public.sales s
        WHERE s.company_id = p_company_id
          AND s.status <> 'cancelled'
          AND COALESCE(s.is_active, s.status='active')
          AND s.project_id = ANY(pj.project_ids)
      ),
      psum AS (
        SELECT p.sale_id,
          COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date <  p_from),0)              AS p1,
          COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date BETWEEN p_from AND p_to),0) AS p2
        FROM public.payments p
        JOIN osale s ON s.id = p.sale_id
        WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
        GROUP BY p.sale_id
      ),
      lines AS (
        SELECT i.sale_id, i.due_date, i.amount_due::numeric AS due,
               (COALESCE(i.installment_type,'')='down_payment') AS is_dp,
               (i.due_date <  p_from)               AS is_old,
               (i.due_date BETWEEN p_from AND p_to) AS is_cur,
               SUM(i.amount_due) OVER (PARTITION BY i.sale_id
                   ORDER BY i.due_date, i.installment_number
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_incl
        FROM public.installments i
        JOIN osale s ON s.id = i.sale_id
        WHERE i.company_id = p_company_id AND i.due_date <= p_to
      ),
      perline AS (
        SELECT l.*,
          GREATEST(0, LEAST(l.due, COALESCE(ps.p1,0)                  - (l.cum_incl - l.due))) AS paid_pre,
          GREATEST(0, LEAST(l.due, COALESCE(ps.p1,0)+COALESCE(ps.p2,0) - (l.cum_incl - l.due))) AS paid_tot
        FROM lines l LEFT JOIN psum ps ON ps.sale_id = l.sale_id
      )
      SELECT
        (SELECT COALESCE(SUM(p2),0) FROM psum)                                            AS recovered,
        COALESCE(SUM(paid_tot - paid_pre) FILTER (WHERE is_old AND NOT is_dp),0)          AS r_old,
        COALESCE(SUM(paid_tot - paid_pre) FILTER (WHERE is_cur AND NOT is_dp),0)          AS r_cur,
        COALESCE(SUM(paid_tot - paid_pre) FILTER (WHERE due_date < v_cut),0)              AS r_dead
      FROM perline
    ) rec ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT i.sale_id) AS untouched
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
        AND i.due_date < CURRENT_DATE
        AND i.amount_due > i.amount_paid
        AND NOT EXISTS (
          SELECT 1 FROM public.contact_logs c2
          WHERE c2.company_id = p_company_id
            AND c2.sale_id = i.sale_id
            AND c2.contact_date >= (CURRENT_DATE - INTERVAL '14 days')::date
        )
    ) nu ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS pending_count
      FROM public.approval_requests ar
      WHERE ar.company_id = p_company_id
        AND ar.requested_by = u.id
        AND ar.status = 'pending'
    ) ap ON true
    WHERE u.company_id = p_company_id
      AND u.role IN ('recovery','recovery_officer')
      AND u.status = 'active'
  ) sub;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_team_performance(uuid,uuid,date,date) TO authenticated, anon, service_role;
