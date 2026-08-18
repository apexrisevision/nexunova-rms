-- ═══════════════════════════════════════════════════════════════════════════
-- list_availability_links — one call that can draw the whole Share-link screen
--
-- The screen has to show a row per PROJECT, whether or not that project has a
-- link yet: "KBH — no link, make one" is as important as "FMH — link live, 12
-- views". Fetching the projects separately would mean a second RPC and a second
-- round of scope logic, so the list returns both, scoped identically.
--
-- Still returns neither the token nor its hash: a link is shown once when it is
-- created and re-issued if lost (see 20260817g). Rotation is create-again.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_availability_links(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cos uuid[]; v_rows jsonb; v_projects jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'label', l.label, 'project', pr.project_name,
    'project_id', l.project_id, 'revoked', l.revoked, 'expires_at', l.expires_at,
    'views', l.views, 'last_viewed_at', l.last_viewed_at, 'created_at', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.availability_links l
  JOIN public.projects pr ON pr.id = l.project_id
  WHERE l.company_id = ANY(v_cos);

  -- every project this director may publish, with what a link would show
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'company', x->>'name'), '[]'::jsonb) INTO v_projects
  FROM (
    SELECT jsonb_build_object(
             'id', pr.id,
             'name', pr.project_name,
             'company', COALESCE(c.display_name, c.company_name),
             'units', (SELECT count(*) FROM public.units u
                        WHERE u.project_id = pr.id AND public._map_unit_state(u.id) <> 'retired'),
             'available', (SELECT count(*) FROM public.units u
                            WHERE u.project_id = pr.id AND public._map_unit_state(u.id) = 'available')
           ) AS x
      FROM public.projects pr
      JOIN public.companies c ON c.id = pr.company_id
     WHERE pr.company_id = ANY(v_cos)
  ) q;

  RETURN jsonb_build_object('success',true,'links',v_rows,'projects',v_projects);
END $function$;

REVOKE ALL ON FUNCTION public.list_availability_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_availability_links(text) TO authenticated;
