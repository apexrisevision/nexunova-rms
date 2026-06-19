-- ════════════════════════════════════════════════════════════════════════
-- CRM — LEAD ASSIGNMENT ENGINE (the "transformation": Director→Manager→Sub-agent)
-- Design calls (architect's judgment, not literal):
--  1) Handing a lead down SELF-BUILDS the org tree: on assign, if the target has
--     no parent yet, their parent becomes the assigner. Hierarchy emerges from
--     real distribution — no separate org-chart setup needed.
--  2) UPWARD VISIBILITY: list_my_leads / get_lead now scope to the caller's whole
--     SUBTREE (self + all descendants). A director sees every lead in their tree
--     and who currently holds it; a leaf sale_rep sees only their own (no kids).
--  3) ACCOUNTABILITY: every handoff writes a lead_assignments trail row + an
--     'assigned' activity; get_assignable_users shows each candidate's open-lead
--     load so work is distributed fairly.
-- Edits/stage/log stay OWNER-only; viewing is subtree-wide.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_by_sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

ALTER TABLE public.lead_activities DROP CONSTRAINT IF EXISTS lead_activities_kind_check;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_kind_check
  CHECK (kind IN ('note','call','whatsapp','visit','meeting','stage','assigned'));

CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  to_sales_user_id   uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  assigned_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON public.lead_assignments(lead_id, assigned_at DESC);
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;

-- get_assignable_users — who the caller may hand leads down to (+ their load) --
CREATE OR REPLACE FUNCTION public.get_assignable_users(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_to_role text; v_users jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT assigns_to_role INTO v_to_role FROM public.lead_role_config WHERE role=v_role;
  IF v_to_role IS NULL THEN
    RETURN jsonb_build_object('success',true,'can_assign',false,'users','[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'name', su.full_name, 'role', su.role,
    'mine', (su.parent_sales_user_id = v_ses.sales_user_id),
    'open_leads', (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id AND l.status NOT IN ('won','lost'))
  ) ORDER BY (su.parent_sales_user_id = v_ses.sales_user_id) DESC, su.full_name), '[]'::jsonb) INTO v_users
  FROM public.sales_users su
  WHERE su.company_id=v_ses.company_id AND su.role=v_to_role
    AND su.status='active' AND su.id<>v_ses.sales_user_id;

  RETURN jsonb_build_object('success',true,'can_assign',true,
    'assigns_to_role', v_to_role,
    'assigns_to_label', public._lead_role_label(v_to_role),
    'users', v_users);
END; $function$;

-- assign_lead — hand a lead down one level (self-builds the tree + trail) ------
CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_to_role text; v_trole text; v_tname text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT owner_sales_user_id, company_id INTO v_owner, v_company FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT assigns_to_role INTO v_to_role FROM public.lead_role_config WHERE role=v_role;
  IF v_to_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','cannot_assign','message','Your role does not hand leads down.'); END IF;

  SELECT role, full_name INTO v_trole, v_tname FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_trole IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole <> v_to_role THEN
    RETURN jsonb_build_object('success',false,'error','wrong_target_role','message','You can only assign to a '||public._lead_role_label(v_to_role)||'.'); END IF;

  -- 1) self-build the org tree: adopt the target if they have no parent yet
  UPDATE public.sales_users SET parent_sales_user_id=v_ses.sales_user_id, updated_at=now()
   WHERE id=p_to_id AND parent_sales_user_id IS NULL;

  -- 2) move the lead to the target
  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), source='assigned', last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;

  -- 3) trail + timeline
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id)
  VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$;

-- list_my_leads — now SUBTREE-scoped (self + all descendants) -----------------
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', l.status, 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'owner_name', ow.full_name, 'is_mine', (l.owner_sales_user_id=v_uid),
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) ORDER BY l.last_activity_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.leads l
  JOIN sub ON sub.id = l.owner_sales_user_id
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  WHERE (p_status IS NULL OR l.status=p_status);

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT l.status, count(*) n FROM public.leads l JOIN sub ON sub.id=l.owner_sales_user_id GROUP BY l.status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb));
END; $function$;

-- get_lead — subtree-scoped view + holder/assigned-from context --------------
CREATE OR REPLACE FUNCTION public.get_lead(p_session_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_lead jsonb; v_acts jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', l.status, 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'next_follow_up_at', l.next_follow_up_at,
    'owner_name', ow.full_name, 'is_mine', (l.owner_sales_user_id=v_uid),
    'assigned_from', ab.full_name,
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) INTO v_lead
  FROM public.leads l
  JOIN sub ON sub.id = l.owner_sales_user_id
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
  LEFT JOIN public.sales_users ab ON ab.id=l.assigned_by_sales_user_id
  WHERE l.id=p_id;

  IF v_lead IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'body', a.body, 'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_acts
  FROM public.lead_activities a WHERE a.lead_id=p_id;

  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts);
END; $function$;
