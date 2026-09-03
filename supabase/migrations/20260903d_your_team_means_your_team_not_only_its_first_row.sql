-- ═══════════════════════════════════════════════════════════════════════════
-- Your team means your team, not only its first row
-- ───────────────────────────────────────────────────────────────────────────
-- A REGRESSION I CAUSED, and did not flag when I caused it. Moving the seven
-- Khushal Bagh reps under the new manager took them out of the director's
-- reach: assign_lead and assign_leads_bulk both required
--
--     target.parent_sales_user_id = caller
--
-- — the target must be a DIRECT report. The moment somebody sits between them,
-- the director can no longer hand a lead to the person who does the selling.
-- Trying it returned "You can only assign leads to your own team", about his
-- own company's sales team.
--
-- This is also why the whole org chart was flattened under him in August. The
-- note from that day says it plainly: "reach = direct reports, nothing deeper."
-- The tree was flattened to work around this rule rather than the rule being
-- fixed, and adding one manager brought it straight back.
--
-- So the rule now asks the question it was always meant to ask: is this person
-- ANYWHERE in my team, at any depth. _sales_in_my_tree() walks down from the
-- caller and answers it, carrying the same path guard set_sales_user_role uses,
-- because an unguarded walk over a parent cycle is what once filled the disk.
--
-- Nothing widens beyond a person's own tree. A sale_rep has nobody under them
-- and still gets an empty list and can_assign false — checked, not assumed. The
-- director's reach in this company goes from 17 to 24, which is exactly the
-- seven that moved. Nobody gains anybody outside their own branch.
--
-- get_assignable_users is rewritten on the same helper so the list on screen and
-- the rule on save cannot drift apart. They were two separate implementations of
-- "direct children", and that is how a screen ends up offering somebody the
-- server will then refuse.
--
-- What this deliberately does NOT change: a lead the director hands STRAIGHT to
-- a rep stays invisible to the manager above them. The manager's screen is his
-- own leads plus the ones he passed on (20260903c), and a direct hand-over is
-- neither of those. Verified as part of this change rather than reasoned about.
--
-- The definitions below are what is running — they were read back out of pg_proc
-- after the migration was applied, not retyped from memory.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._sales_in_my_tree(p_me uuid, p_them uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE sub AS (
    SELECT id, ARRAY[id] AS path FROM public.sales_users WHERE id = p_me
    UNION ALL
    SELECT su.id, sub.path || su.id
      FROM public.sales_users su JOIN sub ON su.parent_sales_user_id = sub.id
     WHERE su.id <> ALL(sub.path)          -- a parent cycle once filled the disk
  )
  SELECT EXISTS (SELECT 1 FROM sub WHERE id = p_them AND id <> p_me);
$function$;

-- a helper, never a caller-facing RPC
REVOKE ALL ON FUNCTION public._sales_in_my_tree(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_tname text; v_companywide boolean; v_lname text; v_trole text;
        v_block jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT owner_sales_user_id, company_id, name INTO v_owner, v_company, v_lname FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- Somebody ELSE is working it. Handing on your own is not the same act.
  IF v_owner IS DISTINCT FROM v_ses.sales_user_id
     AND EXISTS (SELECT 1 FROM public.sales_users su2
                  WHERE su2.id = v_owner AND su2.role NOT IN ('director','admin','cfo')) THEN
    RETURN jsonb_build_object('success',false,'error','already_assigned',
      'message','This lead is already with a team member. Pull it back first, then hand it over.');
  END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  IF v_companywide AND v_company <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT v_companywide AND v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

  SELECT full_name, role INTO v_tname, v_trole
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  -- anywhere in my team, at any depth — not only the first row of it
  IF NOT public._sales_in_my_tree(v_ses.sales_user_id, p_to_id) THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  v_block := public._fu_block_state(p_to_id);
  IF COALESCE((v_block->>'blocked')::boolean, false) THEN
    RETURN jsonb_build_object('success',false,'error','assign_blocked','block',v_block,
      'message', v_tname||' has '||(v_block->>'overdue')||' overdue follow-ups. '
                 ||'They must clear these before taking new leads.');
  END IF;

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  PERFORM public._crm_send_push(v_company, p_to_id, 'New lead assigned',
    COALESCE(v_lname,'A new lead')||' was assigned to you.',
    'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id,
    'push:assigned:'||p_lead_id||':'||p_to_id);

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_tname text;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text; v_skipped int := 0;
        v_block jsonb; v_from text; v_last uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_company := v_ses.company_id;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');

  SELECT full_name, role INTO v_tname, v_trole
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  IF NOT public._sales_in_my_tree(v_ses.sales_user_id, p_to_id) THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  v_block := public._fu_block_state(p_to_id);
  IF COALESCE((v_block->>'blocked')::boolean, false) THEN
    RETURN jsonb_build_object('success',false,'error','assign_blocked','block',v_block,
      'message', v_tname||' has '||(v_block->>'overdue')||' overdue follow-ups. '
                 ||'They must clear these before taking new leads.');
  END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    -- Somebody ELSE is working it. Handing on your own is not the same act.
    IF EXISTS (SELECT 1 FROM public.leads l
               JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
              WHERE l.id=v_lead
                AND l.owner_sales_user_id IS DISTINCT FROM v_ses.sales_user_id
                AND ow.role NOT IN ('director','admin','cfo')) THEN
      v_skipped := v_skipped + 1;
    ELSIF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN
      UPDATE public.leads
         SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
             assigned_at=now(), last_activity_at=now(), updated_at=now()
       WHERE id=v_lead;
      INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (v_lead, v_ses.sales_user_id, p_to_id);
      INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (v_lead, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));
      v_count := v_count + 1;
      v_last := v_lead;
    END IF;
  END LOOP;

  /* Handing work over without telling anybody is how 211 leads reached six
     people in silence. One alert per batch, not one per lead. */
  IF v_count > 0 THEN
    SELECT full_name INTO v_from FROM public.sales_users WHERE id = v_ses.sales_user_id;
    PERFORM public._alert_raise(v_company, p_to_id,
      CASE WHEN v_count = 1 THEN v_last END, 'assigned',
      CASE WHEN v_count = 1 THEN 'A new lead is yours'
           ELSE v_count || ' new leads are yours' END,
      COALESCE(v_from, 'Your manager') || ' just assigned ' ||
      CASE WHEN v_count = 1 THEN 'a lead' ELSE v_count || ' leads' END || ' to you.',
      v_count,
      'assigned:' || p_to_id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  END IF;

  RETURN jsonb_build_object('success',true,'assigned',v_count,'skipped',v_skipped,
    'message', CASE WHEN v_skipped>0 THEN v_skipped||' already with a team member — pull them back first.' ELSE NULL END,
    'to_name',v_tname,'to_id',p_to_id);
END $function$;

CREATE OR REPLACE FUNCTION public.get_assignable_users(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb; v_label text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role = 'lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  -- the same rule the save uses, so the screen cannot offer somebody the
  -- server will then refuse
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', su.id,
           'name', su.full_name || COALESCE(' · ' || (SELECT p.project_name FROM public.projects p WHERE p.id = su.home_project_id), ''),
           'role', su.role
         ) ORDER BY su.full_name), '[]'::jsonb)
    INTO v_rows
    FROM public.sales_users su
   WHERE su.company_id = v_ses.company_id
     AND su.status = 'active'
     AND su.role <> 'lead_entry'
     AND public._sales_in_my_tree(v_ses.sales_user_id, su.id);

  SELECT lrc.assigns_to_role INTO v_label FROM public.lead_role_config lrc WHERE lrc.role = v_role;
  RETURN jsonb_build_object('success', true, 'users', v_rows,
                            'can_assign', (jsonb_array_length(v_rows) > 0),
                            'assigns_to_label', COALESCE(v_label, 'team'));
END $function$;
