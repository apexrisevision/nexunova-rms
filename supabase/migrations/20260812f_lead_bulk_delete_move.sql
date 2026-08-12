-- 2026-08-12 — Leads screen bulk actions (owner-approved)
--   * soft delete (recoverable) + restore
--   * move selected leads to another project
--   * every lead reader hides soft-deleted rows
-- Soft delete was chosen over a hard delete deliberately: Facebook leads cannot
-- be re-fetched, so a mis-tap must be undoable.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.sales_users(id);
CREATE INDEX IF NOT EXISTS leads_deleted_at_idx ON public.leads (company_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.leads.deleted_at IS 'Soft delete. Non-null = hidden from every portal list; restore_leads_bulk clears it.';

-- ── hide soft-deleted rows from every reader ────────────────────────────────
-- Aliased reads become a filtered subquery (same alias, so the rest of the body
-- is untouched). _lead_can_act gets an explicit clause so mutations are blocked.
do $$
declare d text; d2 text; fn text;
begin
  foreach fn in array array['get_lead','get_my_followups','list_my_deals','list_my_leads','get_member_leads']
  loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=fn limit 1;
    if d is null then raise exception 'missing %', fn; end if;
    d2 := replace(d, 'FROM public.leads l', 'FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l');
    d2 := replace(d2,'JOIN public.leads l ON', 'JOIN (SELECT * FROM public.leads WHERE deleted_at IS NULL) l ON');
    if d2 = d then
      if position('WHERE deleted_at IS NULL) l' in d) > 0 then continue; end if;   -- already patched
      raise exception 'no lead-read anchor in %', fn;
    end if;
    execute d2;
  end loop;

  -- director/team stat screens: append to their existing is_test filter
  foreach fn in array array['get_command_center','get_agent_conversion']
  loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=fn limit 1;
    d2 := replace(d, 'NOT COALESCE(l.is_test,false)', 'NOT COALESCE(l.is_test,false) AND l.deleted_at IS NULL');
    if d2 = d then
      if position('AND l.deleted_at IS NULL' in d) > 0 then continue; end if;   -- already patched
      raise exception 'no is_test anchor in %', fn;
    end if;
    execute d2;
  end loop;

  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_lead_can_act';
  if position('FROM public.leads WHERE id=p_lead_id;' in d) > 0 then
    execute replace(d, 'FROM public.leads WHERE id=p_lead_id;',
                       'FROM public.leads WHERE id=p_lead_id AND deleted_at IS NULL;');
  elsif position('id=p_lead_id AND deleted_at IS NULL' in d) = 0 then
    raise exception '_lead_can_act anchor missing';
  end if;
end $$;

-- ── soft delete ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_leads_bulk(p_session_token text, p_lead_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','forbidden',
      'message','Only a director can delete leads.'); END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids,1) IS NULL THEN
    RETURN jsonb_build_object('success',true,'deleted',0); END IF;

  PERFORM set_config('rms.audit_reason','lead soft-deleted from portal', true);
  UPDATE public.leads
     SET deleted_at=now(), deleted_by=v_ses.sales_user_id, updated_at=now()
   WHERE id = ANY(p_lead_ids) AND company_id=v_ses.company_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'deleted',v_n);
END; $function$;

-- ── restore ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_leads_bulk(p_session_token text, p_lead_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  PERFORM set_config('rms.audit_reason','lead restored from portal', true);
  UPDATE public.leads
     SET deleted_at=NULL, deleted_by=NULL, updated_at=now()
   WHERE id = ANY(p_lead_ids) AND company_id=v_ses.company_id AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'restored',v_n);
END; $function$;

-- ── list what was deleted (so it can be restored from the UI) ───────────────
CREATE OR REPLACE FUNCTION public.list_deleted_leads(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'source', l.source,
    'project_name', p.project_name, 'deleted_at', l.deleted_at,
    'deleted_by', (SELECT full_name FROM public.sales_users s WHERE s.id=l.deleted_by)
  ) ORDER BY l.deleted_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.leads l LEFT JOIN public.projects p ON p.id=l.project_id
  WHERE l.company_id=v_ses.company_id AND l.deleted_at IS NOT NULL;

  RETURN jsonb_build_object('success',true,'leads',v_rows);
END; $function$;

-- ── move selected leads to another project ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_leads_project_bulk(p_session_token text, p_lead_ids uuid[], p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_n int; v_pname text; v_lead uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','forbidden',
      'message','Only a director can move leads between projects.'); END IF;

  -- target must be this company's project, or a sibling project inside the group
  SELECT pr.project_name INTO v_pname
  FROM public.projects pr JOIN public.companies c ON c.id=pr.company_id
  WHERE pr.id=p_project_id
    AND ( pr.company_id=v_ses.company_id
          OR (c.dealer_group_id IS NOT NULL
              AND c.dealer_group_id=(SELECT dealer_group_id FROM public.companies WHERE id=v_ses.company_id)) );
  IF v_pname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;

  PERFORM set_config('rms.audit_reason','lead project changed from portal', true);
  UPDATE public.leads
     SET project_id=p_project_id, updated_at=now(), last_activity_at=now()
   WHERE id = ANY(p_lead_ids) AND company_id=v_ses.company_id AND deleted_at IS NULL
     AND project_id IS DISTINCT FROM p_project_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  FOREACH v_lead IN ARRAY COALESCE(p_lead_ids,'{}'::uuid[]) LOOP
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
    SELECT v_lead, v_ses.sales_user_id, 'note', 'Moved to '||v_pname
     WHERE EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead AND project_id=p_project_id AND deleted_at IS NULL);
  END LOOP;

  RETURN jsonb_build_object('success',true,'moved',v_n,'project_name',v_pname);
END; $function$;

-- ── projects the caller may move leads INTO (for the picker) ────────────────
CREATE OR REPLACE FUNCTION public.list_group_projects(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.project_name, 'tag', COALESCE(pr.short_code, pr.project_name),
      'company', c.company_code
    ) ORDER BY COALESCE(pr.short_code, pr.project_name)), '[]'::jsonb) INTO v_rows
  FROM public.projects pr JOIN public.companies c ON c.id=pr.company_id
  WHERE pr.status='active'
    AND ( pr.company_id=v_ses.company_id
          OR (c.dealer_group_id IS NOT NULL
              AND c.dealer_group_id=(SELECT dealer_group_id FROM public.companies WHERE id=v_ses.company_id)) );

  RETURN jsonb_build_object('success',true,'projects',v_rows);
END; $function$;

REVOKE ALL ON FUNCTION public.delete_leads_bulk(text, uuid[])            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_leads_bulk(text, uuid[])           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_leads_project_bulk(text, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_leads_bulk(text, uuid[])             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_leads_bulk(text, uuid[])            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_deleted_leads(text)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_leads_project_bulk(text, uuid[], uuid)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_group_projects(text)                    TO anon, authenticated;

-- ── the Leads screen needs project_id too (for the project step in bulk assign) ──
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='list_my_deals';
  if position($a$'project_id', m.project_id$a$ in d) > 0 then return; end if;   -- already patched
  if position($a$           u.unit_no, p.project_name$a$ in d)=0
     or position($a$'unit_no', m.unit_no, 'project_name', m.project_name,$a$ in d)=0 then
    raise exception 'list_my_deals project anchors not found';
  end if;
  d := replace(d, $a$           u.unit_no, p.project_name$a$,
                  $b$           u.unit_no, p.project_name, l.project_id$b$);
  d := replace(d, $a$'unit_no', m.unit_no, 'project_name', m.project_name,$a$,
                  $b$'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,$b$);
  execute d;
end $$;
