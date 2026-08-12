-- 2026-08-12 — Team tab goes group-wide (owner-approved)
--
-- Problem: get_my_team / get_member_performance / get_team_targets / get_sales_performance
-- counted sales with "s.company_id = <session company> AND s.agent_id IN (member agents)".
-- On an umbrella tenant the reps live on the home company (awami) while the actual sales
-- sit in the sibling tenants (KBH, FMH), so every rupee column read ₨0.
--
-- Fix: resolve each member to ALL (company_id, agent_id) pairs they own across the group
-- via dealer_company_agents — the same mapping get_my_outstanding (Collect) already uses —
-- and match sales on that pair. Non-umbrella tenants are unaffected: the helper still
-- returns their home-company agent link.

-- ── helper: every (company, agent) pair belonging to these sales_users ───────
CREATE OR REPLACE FUNCTION public._member_agent_scope(p_ids uuid[], p_home_company uuid)
 RETURNS TABLE(company_id uuid, agent_id uuid)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT dca.company_id, dca.agent_id
    FROM public.dealer_company_agents dca
   WHERE dca.sales_user_id = ANY(p_ids) AND dca.agent_id IS NOT NULL
  UNION
  SELECT p_home_company, su.agent_id
    FROM public.sales_users su
   WHERE su.id = ANY(p_ids) AND su.agent_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public._member_agent_scope(uuid[], uuid) FROM PUBLIC, anon;

-- ── Team list ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_team(p_session_token text, p_head uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_root uuid; v_rows jsonb; v_n int;
        v_sales_val numeric; v_outstanding numeric; v_pipeline int; v_ok boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  IF p_head IS NOT NULL THEN
    WITH RECURSIVE sub AS (
      SELECT id FROM public.sales_users WHERE parent_sales_user_id=v_uid
      UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
    ) SELECT EXISTS(SELECT 1 FROM sub WHERE id=p_head) INTO v_ok;
    IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_your_team'); END IF;
  END IF;
  v_root := COALESCE(p_head, v_uid);
  WITH RECURSIVE tree AS (
    SELECT su.id, su.id AS head, su.agent_id FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_root AND su.company_id=v_co AND su.status='active'
    UNION ALL
    SELECT su.id, t.head, su.agent_id FROM public.sales_users su JOIN tree t ON su.parent_sales_user_id=t.id
    WHERE su.company_id=v_co AND su.status='active'
  ),
  heads AS (
    SELECT su.id, su.full_name, su.role, su.phone FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_root AND su.company_id=v_co AND su.status='active'
  ),
  agg AS (
    SELECT h.id, h.full_name, h.role, h.phone,
      (SELECT count(*) FROM public.sales_users c WHERE c.parent_sales_user_id=h.id AND c.status='active') AS reports,
      (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id)) AS leads_total,
      (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id) AND d.stage NOT IN ('won','lost')) AS pipeline,
      (SELECT count(*) FROM public.deals d WHERE d.owner_sales_user_id IN (SELECT id FROM tree WHERE head=h.id) AND d.stage='won') AS won,
      -- group-wide: match (company, agent) pairs owned by this head's branch
      (SELECT count(*) FROM public.sales s WHERE COALESCE(s.is_active,true)
         AND EXISTS (SELECT 1 FROM public._member_agent_scope(ARRAY(SELECT t.id FROM tree t WHERE t.head=h.id), v_co) sc
                     WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)) AS sales_count,
      (SELECT COALESCE(sum(s.net_amount),0) FROM public.sales s WHERE COALESCE(s.is_active,true)
         AND EXISTS (SELECT 1 FROM public._member_agent_scope(ARRAY(SELECT t.id FROM tree t WHERE t.head=h.id), v_co) sc
                     WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)) AS sales_value,
      -- outstanding = net - money actually received (same basis as the Collect tab).
      -- sales.remaining_amount is a GENERATED column (price - discount - down_payment)
      -- and is NOT payment-aware, so it must not be used here.
      (SELECT COALESCE(sum(s.net_amount - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.sale_id=s.id),0)),0)
         FROM public.sales s WHERE COALESCE(s.is_active,true)
         AND EXISTS (SELECT 1 FROM public._member_agent_scope(ARRAY(SELECT t.id FROM tree t WHERE t.head=h.id), v_co) sc
                     WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)) AS outstanding
    FROM heads h
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.full_name, 'role', a.role, 'phone', a.phone, 'reports', a.reports,
           'leads_total', a.leads_total, 'pipeline', a.pipeline, 'won', a.won,
           'sales_count', a.sales_count, 'sales_value', a.sales_value, 'outstanding', a.outstanding,
           'conversion', CASE WHEN a.leads_total>0 THEN round(a.won::numeric*100/a.leads_total,1) ELSE 0 END
         ) ORDER BY a.sales_value DESC, a.full_name), '[]'::jsonb),
         count(*), COALESCE(sum(a.sales_value),0), COALESCE(sum(a.outstanding),0), COALESCE(sum(a.pipeline),0)
    INTO v_rows, v_n, v_sales_val, v_outstanding, v_pipeline
  FROM agg a;
  RETURN jsonb_build_object('success',true,'team',v_rows,'count',COALESCE(v_n,0),
    'totals', jsonb_build_object('sales_value',v_sales_val,'outstanding',v_outstanding,'pipeline',v_pipeline,'agents',COALESCE(v_n,0)));
END; $function$;

-- ── Member drill-down ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_member_performance(p_session_token text, p_member uuid, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text, p_scope text DEFAULT 'self'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_role text; v_co uuid; v_ok boolean;
        v_from date; v_to date; su public.sales_users; v_ids uuid[];
        v_total int; v_won int; v_lost int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id; v_co := v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  WITH RECURSIVE sub AS (SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id)
  SELECT EXISTS(SELECT 1 FROM sub WHERE id=p_member) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('success',false,'error','not_your_team'); END IF;
  v_from := COALESCE(NULLIF(p_from,'')::date,'-infinity'::date);
  v_to   := COALESCE(NULLIF(p_to,'')::date,'infinity'::date);
  SELECT * INTO su FROM public.sales_users WHERE id=p_member;
  WITH RECURSIVE inset AS (
    SELECT p_member AS id
    UNION ALL SELECT s.id FROM public.sales_users s JOIN inset ON s.parent_sales_user_id=inset.id WHERE p_scope='team' AND s.status='active'
  )
  SELECT array_agg(id) INTO v_ids FROM inset;
  SELECT count(*), count(*) FILTER (WHERE stage='won'), count(*) FILTER (WHERE stage='lost')
    INTO v_total, v_won, v_lost FROM public.deals WHERE owner_sales_user_id=ANY(v_ids);
  RETURN jsonb_build_object('success',true,'name',su.full_name,'role',su.role,'scope',p_scope,
    'leads', jsonb_build_object(
      'total', v_total,
      'new', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='new'),
      'contacted', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='contacted'),
      'visit', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='visit'),
      'negotiation', (SELECT count(*) FROM public.deals WHERE owner_sales_user_id=ANY(v_ids) AND stage='negotiation'),
      'won', v_won, 'lost', v_lost),
    'conversion', CASE WHEN v_total>0 THEN round(v_won::numeric*100/v_total,1) ELSE 0 END,
    'sales', jsonb_build_object(
      'count', COALESCE((SELECT count(*) FROM public.sales s WHERE COALESCE(s.is_active,true) AND s.sale_date BETWEEN v_from AND v_to
                          AND EXISTS (SELECT 1 FROM public._member_agent_scope(v_ids, v_co) sc
                                      WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)),0),
      'value', COALESCE((SELECT sum(net_amount) FROM public.sales s WHERE COALESCE(s.is_active,true) AND s.sale_date BETWEEN v_from AND v_to
                          AND EXISTS (SELECT 1 FROM public._member_agent_scope(v_ids, v_co) sc
                                      WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)),0)),
    'outstanding', COALESCE((SELECT sum(s.net_amount - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.sale_id=s.id),0))
                               FROM public.sales s WHERE COALESCE(s.is_active,true)
                              AND EXISTS (SELECT 1 FROM public._member_agent_scope(v_ids, v_co) sc
                                          WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)),0),
    'activity', jsonb_build_object(
      'call', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='call' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1)),
      'whatsapp', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='whatsapp' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1)),
      'visit', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='visit' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1)),
      'meeting', (SELECT count(*) FROM public.lead_activities a WHERE a.kind='meeting' AND a.sales_user_id=ANY(v_ids) AND a.created_at>=v_from AND a.created_at<(v_to+1))));
END; $function$;

-- ── Targets (actual vs target) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_targets(p_session_token text, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_co uuid; v_start date; v_end date; v_rows jsonb;
        v_tu int; v_tv numeric; v_au int; v_av numeric;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid:=v_ses.sales_user_id; v_co:=v_ses.company_id;
  IF p_period !~ '^\d{4}-\d{2}$' THEN p_period := to_char(now(),'YYYY-MM'); END IF;
  v_start := to_date(p_period||'-01','YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;

  WITH RECURSIVE tree AS (
    SELECT su.id, su.id AS head, su.agent_id FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_uid AND su.company_id=v_co AND su.status='active'
    UNION ALL
    SELECT su.id, t.head, su.agent_id FROM public.sales_users su JOIN tree t ON su.parent_sales_user_id=t.id
    WHERE su.company_id=v_co AND su.status='active'
  ),
  heads AS (
    SELECT su.id, su.full_name FROM public.sales_users su
    WHERE su.parent_sales_user_id=v_uid AND su.company_id=v_co AND su.status='active'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.full_name,
    'target_units', COALESCE(tg.target_units,0), 'target_value', COALESCE(tg.target_value,0),
    'actual_units', (SELECT count(*) FROM public.sales s WHERE COALESCE(s.is_active,true)
                       AND s.sale_date>=v_start AND s.sale_date<v_end
                       AND EXISTS (SELECT 1 FROM public._member_agent_scope(ARRAY(SELECT t.id FROM tree t WHERE t.head=h.id), v_co) sc
                                   WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)),
    'actual_value', (SELECT COALESCE(sum(s.net_amount),0) FROM public.sales s WHERE COALESCE(s.is_active,true)
                       AND s.sale_date>=v_start AND s.sale_date<v_end
                       AND EXISTS (SELECT 1 FROM public._member_agent_scope(ARRAY(SELECT t.id FROM tree t WHERE t.head=h.id), v_co) sc
                                   WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id))
  ) ORDER BY h.full_name), '[]'::jsonb) INTO v_rows
  FROM heads h LEFT JOIN public.sales_targets tg ON tg.sales_user_id=h.id AND tg.period=p_period;

  SELECT COALESCE(sum((x->>'target_units')::int),0), COALESCE(sum((x->>'target_value')::numeric),0),
         COALESCE(sum((x->>'actual_units')::int),0), COALESCE(sum((x->>'actual_value')::numeric),0)
    INTO v_tu, v_tv, v_au, v_av FROM jsonb_array_elements(v_rows) x;

  RETURN jsonb_build_object('success',true,'period',p_period,'agents',v_rows,
    'totals', jsonb_build_object('target_units',v_tu,'target_value',v_tv,'actual_units',v_au,'actual_value',v_av));
END; $function$;

-- ── "Sold this month" header (own + own subtree) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_performance(p_session_token text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid;
        v_total int; v_new int; v_cont int; v_visit int; v_neg int; v_won int; v_lost int;
        v_acts jsonb; v_lost_reasons jsonb; v_sales_n int; v_sales_val numeric; v_ids uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ) SELECT array_agg(id) INTO v_ids FROM sub;

  SELECT count(*),
         count(*) FILTER (WHERE stage='new'), count(*) FILTER (WHERE stage='contacted'),
         count(*) FILTER (WHERE stage='visit'), count(*) FILTER (WHERE stage='negotiation'),
         count(*) FILTER (WHERE stage='won'), count(*) FILTER (WHERE stage='lost')
    INTO v_total, v_new, v_cont, v_visit, v_neg, v_won, v_lost
  FROM public.deals d
  WHERE d.owner_sales_user_id = ANY(v_ids)
    AND (p_from IS NULL OR d.created_at::date >= p_from)
    AND (p_to   IS NULL OR d.created_at::date <= p_to);

  SELECT jsonb_build_object(
    'call',     count(*) FILTER (WHERE kind='call'),
    'whatsapp', count(*) FILTER (WHERE kind='whatsapp'),
    'visit',    count(*) FILTER (WHERE kind='visit'),
    'meeting',  count(*) FILTER (WHERE kind='meeting'),
    'total',    count(*) FILTER (WHERE kind IN ('call','whatsapp','visit','meeting')))
    INTO v_acts
  FROM public.lead_activities a
  WHERE a.sales_user_id = ANY(v_ids)
    AND (p_from IS NULL OR a.created_at::date >= p_from)
    AND (p_to   IS NULL OR a.created_at::date <= p_to);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', lost_reason, 'n', n) ORDER BY n DESC), '[]'::jsonb)
    INTO v_lost_reasons
  FROM (
    SELECT COALESCE(NULLIF(TRIM(lost_reason),''),'Unspecified') AS lost_reason, count(*) n
    FROM public.deals
    WHERE owner_sales_user_id = ANY(v_ids) AND stage='lost'
      AND (p_from IS NULL OR created_at::date >= p_from) AND (p_to IS NULL OR created_at::date <= p_to)
    GROUP BY 1
  ) t;

  -- group-wide sales for this user + their subtree
  SELECT count(*), COALESCE(sum(s.net_amount),0) INTO v_sales_n, v_sales_val
  FROM public.sales s
  WHERE COALESCE(s.is_active,true)=true
    AND EXISTS (SELECT 1 FROM public._member_agent_scope(v_ids, v_ses.company_id) sc
                WHERE sc.company_id=s.company_id AND sc.agent_id=s.agent_id)
    AND (p_from IS NULL OR s.sale_date >= p_from) AND (p_to IS NULL OR s.sale_date <= p_to);

  RETURN jsonb_build_object('success',true,
    'leads', jsonb_build_object('total',COALESCE(v_total,0),'new',COALESCE(v_new,0),'contacted',COALESCE(v_cont,0),
       'visit',COALESCE(v_visit,0),'negotiation',COALESCE(v_neg,0),'won',COALESCE(v_won,0),'lost',COALESCE(v_lost,0)),
    'conversion', CASE WHEN COALESCE(v_total,0)>0 THEN round(v_won::numeric*100/v_total,1) ELSE 0 END,
    'activities', COALESCE(v_acts,'{}'::jsonb),
    'lost_reasons', v_lost_reasons,
    'sales', jsonb_build_object('count',COALESCE(v_sales_n,0),'value',COALESCE(v_sales_val,0)));
END; $function$;
