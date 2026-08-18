-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC AVAILABILITY — two corrections to 20260817f
--
-- 1. THE TOKEN IS NOW HASHED. The first cut stored the raw token in
--    availability_links.token, so anyone who could read that table held working
--    links. Now only sha256(token) is stored: create_availability_link() returns
--    the raw token ONCE and it is never written down. A database dump, a backup
--    or a stray SELECT yields hashes, and a hash cannot be pasted into a browser.
--    The raw token is unrecoverable by design — a lost link is re-issued, not
--    looked up.
--
-- 2. THE PUBLIC SEES TWO STATES, NOT THREE. "reserved" and "sold" both leave the
--    server as 'taken'. Whoever holds this link has no business knowing whether a
--    flat is under a hold or already registered — only whether it can be bought.
--    Collapsing it server-side also removes a small inference channel: a rival
--    watching the link can no longer count today's holds.
--
-- Everything else from 20260817f stands: the function still never reads clients,
-- payments or installments; price still leaves only for available units; anon may
-- still execute exactly this one function.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── hashed token ───────────────────────────────────────────────────────────
ALTER TABLE public.availability_links ADD COLUMN IF NOT EXISTS token_hash text;

-- the table is new and its only rows were verification fixtures; nothing to migrate
DELETE FROM public.availability_links WHERE token_hash IS NULL;

ALTER TABLE public.availability_links DROP COLUMN IF EXISTS token;
ALTER TABLE public.availability_links ALTER COLUMN token_hash SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.availability_links ADD CONSTRAINT availability_links_hash_key UNIQUE (token_hash);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- one place that turns a link into a lookup key
CREATE OR REPLACE FUNCTION public._availability_token_hash(p_token text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$function$;

REVOKE ALL ON FUNCTION public._availability_token_hash(text) FROM PUBLIC, anon;

-- ── the one public call ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_out jsonb; v_floors jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- missing, revoked and expired answer identically: probing teaches nothing
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  UPDATE public.availability_links
     SET views = views + 1, last_viewed_at = now()
   WHERE id = v_link.id;

  SELECT jsonb_agg(f ORDER BY (f->>'floor_no')::int, f->>'floor_label') INTO v_floors
  FROM (
    SELECT jsonb_build_object(
             'floor_no', u.floor_no,
             'floor_label', COALESCE(u.floor_label, '—'),
             'units', jsonb_agg(jsonb_build_object(
                        'n', u.unit_no,
                        -- TWO states only. 'reserved' and 'sold' are both 'taken'
                        -- before they reach the wire.
                        's', CASE WHEN st.state = 'available' THEN 'available' ELSE 'taken' END,
                        't', ty.type_name,
                        'a', u.area,
                        'p', CASE WHEN st.state = 'available' THEN u.base_price ELSE NULL END
                      ) ORDER BY u.unit_no)
           ) AS f
      FROM public.units u
      LEFT JOIN public.category_unit_types ty ON ty.id = u.unit_type_id
      CROSS JOIN LATERAL (SELECT public._map_unit_state(u.id) AS state) st
     WHERE u.project_id = v_link.project_id
       AND st.state <> 'retired'
     GROUP BY u.floor_no, COALESCE(u.floor_label, '—')
  ) q;

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'floors',  COALESCE(v_floors, '[]'::jsonb)
  ) INTO v_out
  FROM public.projects pr
  JOIN public.companies c ON c.id = pr.company_id
  WHERE pr.id = v_link.project_id;

  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.get_public_availability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_availability(text) TO anon, authenticated;

-- ── management: the raw token is shown once, then only its hash survives ────
CREATE OR REPLACE FUNCTION public.create_availability_link(
  p_session_token text, p_project_id uuid, p_label text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cos uuid[]; v_co uuid; v_tok text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;

  v_cos := public._map_scope_companies(p_session_token);
  SELECT company_id INTO v_co FROM public.projects WHERE id = p_project_id;
  IF v_co IS NULL OR NOT (v_co = ANY(v_cos)) THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- pgcrypto lives in `extensions`; this function pins search_path to 'public'
  v_tok := encode(extensions.gen_random_bytes(16), 'hex');   -- 128 bits

  -- ONE link per project: a fresh one retires the old, so "rotate" is one call
  UPDATE public.availability_links SET revoked = true
   WHERE project_id = p_project_id AND NOT revoked;

  INSERT INTO public.availability_links (token_hash, company_id, project_id, label, created_by)
  VALUES (public._availability_token_hash(v_tok), v_co, p_project_id, p_label, v_ses.sales_user_id);

  -- the only time the raw token exists anywhere. It is not stored.
  RETURN jsonb_build_object('success',true,'token',v_tok);
END $function$;

CREATE OR REPLACE FUNCTION public.revoke_availability_link(p_session_token text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cos uuid[]; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  -- takes either the raw link (hashed here) or the id shown in the list
  UPDATE public.availability_links SET revoked = true
   WHERE company_id = ANY(v_cos)
     AND (token_hash = public._availability_token_hash(p_token)
          OR id::text = p_token);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', v_n > 0);
END $function$;

CREATE OR REPLACE FUNCTION public.list_availability_links(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cos uuid[]; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  -- deliberately no token and no hash: a director sees WHICH links exist and how
  -- they are used, and re-issues when one is lost. There is nothing to copy back.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'label', l.label, 'project', pr.project_name,
    'project_id', l.project_id, 'revoked', l.revoked, 'expires_at', l.expires_at,
    'views', l.views, 'last_viewed_at', l.last_viewed_at, 'created_at', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.availability_links l
  JOIN public.projects pr ON pr.id = l.project_id
  WHERE l.company_id = ANY(v_cos);

  RETURN jsonb_build_object('success',true,'links',v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.create_availability_link(text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_availability_link(text, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_availability_links(text)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_availability_link(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_availability_link(text, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_availability_links(text)              TO authenticated;
