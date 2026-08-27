-- ══ Accounts: what was billed this month, beside what was banked ═════════════
--
-- The Collection screen answered "what came in". The desk's other question —
-- the one it is actually asked at month end — is "what was supposed to come
-- in", and nothing in the portal answered it. This adds that half.
--
-- The two halves are deliberately kept apart rather than reconciled into one
-- figure, because they measure different things: the drawer counts CASH on the
-- day it arrived, the billing counts INSTALMENTS by the day they fell due. A
-- payment received in August against a July instalment belongs to August's
-- drawer and to July's billing, and pretending otherwise would produce a
-- number that is wrong in both frames.
--
-- Cancelled sales are excluded. Their instalments stay in the table and, on
-- this group's books, carry PKR 2,043,466 of "due this month" — money nobody
-- is owed and no clerk should be asked to explain.

CREATE OR REPLACE FUNCTION public.portal_accounts_billing(p_session_token text, p_date date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ses      public.sales_sessions;
  v_su       public.sales_users;
  v_day      date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_m1       date;
  v_group    uuid;
  v_projects uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_su.role IS DISTINCT FROM 'accounts' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_accounts',
      'message', 'This screen belongs to the accounts desk.');
  END IF;

  v_m1 := date_trunc('month', v_day)::date;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;

  -- Same scope rule as the collection half: an assignment narrows, its absence
  -- means the whole group.
  SELECT array_agg(upa.project_id) INTO v_projects
    FROM public.user_project_assignments upa
   WHERE upa.user_id = v_su.app_user_id AND upa.is_active;

  IF v_projects IS NULL THEN
    SELECT array_agg(p.id) INTO v_projects
      FROM public.projects p JOIN public.companies c ON c.id = p.company_id
     WHERE (v_group IS NOT NULL AND c.dealer_group_id = v_group)
        OR c.id = v_ses.company_id;
  END IF;

  IF v_projects IS NULL THEN
    RETURN jsonb_build_object('success', true, 'as_of', v_day, 'billed', 0, 'settled', 0,
      'shortfall', 0, 'rows', 0, 'short_rows', 0,
      'projects', '[]'::jsonb, 'unpaid', '[]'::jsonb);
  END IF;

  RETURN (
    WITH due AS (
      SELECT i.*, GREATEST(COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0), 0) AS short
        FROM public.installments i
        JOIN public.sales s ON s.id = i.sale_id
       WHERE i.project_id = ANY(v_projects)
         AND COALESCE(s.status,'active') <> 'cancelled'
         AND i.due_date BETWEEN v_m1 AND v_day
    )
    SELECT jsonb_build_object(
      'success',    true,
      'as_of',      v_day,
      'from',       v_m1,
      'billed',     COALESCE((SELECT round(sum(amount_due))  FROM due), 0),
      'settled',    COALESCE((SELECT round(sum(amount_paid)) FROM due), 0),
      'shortfall',  COALESCE((SELECT round(sum(short))       FROM due), 0),
      'rows',       (SELECT count(*) FROM due),
      'short_rows', (SELECT count(*) FROM due WHERE short > 0),
      'projects', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'billed')::numeric DESC) FROM (
          SELECT jsonb_build_object(
                   'project_name', pr.project_name,
                   'billed',    COALESCE(round(sum(d.amount_due)),0),
                   'settled',   COALESCE(round(sum(d.amount_paid)),0),
                   'shortfall', COALESCE(round(sum(d.short)),0)) AS x
            FROM due d JOIN public.projects pr ON pr.id = d.project_id
           GROUP BY pr.project_name) q), '[]'::jsonb),
      -- The instalments this month that have not been settled, largest first:
      -- the desk's own follow-up list, in the same frame as the figures above.
      'unpaid', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'short')::numeric DESC) FROM (
          SELECT jsonb_build_object(
                   'client',   cl.full_name,
                   'phone',    cl.phone_primary,
                   'unit',     u.unit_no,
                   'project',  pr.project_name,
                   'due_date', d.due_date,
                   'billed',   round(d.amount_due),
                   'short',    round(d.short),
                   'number',   d.installment_number) AS x
            FROM due d
            JOIN public.sales   s  ON s.id  = d.sale_id
            LEFT JOIN public.clients  cl ON cl.id = s.client_id
            LEFT JOIN public.units    u  ON u.id  = s.unit_id
            LEFT JOIN public.projects pr ON pr.id = d.project_id
           WHERE d.short > 0
           ORDER BY d.short DESC
           LIMIT 20) q), '[]'::jsonb))
  );
END $function$;

REVOKE ALL ON FUNCTION public.portal_accounts_billing(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_accounts_billing(text, date) TO anon;
