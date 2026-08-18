-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC AVAILABILITY LINK — a read-only tower anyone can open without logging in
--
-- One link goes into a dealer group on WhatsApp. It opens the availability tower
-- in a browser: which units exist, which are free, their number, floor, type,
-- area, and the price of the ones still FOR SALE. Nothing else.
--
-- The safety is structural, not cosmetic:
--
--   · get_public_availability() NEVER READS clients, payments or installments.
--     `sales` and `reservations` are touched only inside EXISTS(...) to work out
--     whether a unit is taken. There is no column in this function that could
--     carry a buyer's name, a phone number or an amount owed — so there is
--     nothing on the wire for a browser to un-hide. This is the whole design.
--   · price is emitted ONLY for state = 'available'. A sold unit's price does not
--     leave the server either.
--   · the link carries no session and grants no action. Reserve and quoting live
--     behind reserve_unit(p_session_token,…) and are unreachable from here.
--   · anon may execute exactly ONE function in this file. The management RPCs
--     require a live sales_sessions row belonging to a director.
--   · availability_links is RLS deny-all: anon cannot read the token table, so a
--     leaked link exposes one project's availability and nothing else — and can
--     be killed with revoke_availability_link(), after which the same URL is dead.
--
-- One token per project (KBH's link is not FMH's), so a leak is contained and
-- rotating one does not disturb the others. expires_at exists but is NULL by
-- default: a dealer group's link should keep working until someone revokes it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.availability_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token          text NOT NULL UNIQUE,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  label          text,                       -- "KBH — dealers group", so it is known who holds it
  expires_at     timestamptz,                -- NULL = no expiry, revoke is the off switch
  revoked        boolean NOT NULL DEFAULT false,
  views          integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_links_project_idx ON public.availability_links(project_id);

-- deny-all: every path in or out of this table goes through the functions below
ALTER TABLE public.availability_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_links FROM anon, authenticated;

-- ── the ONE thing the public may call ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_availability(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER          -- volatile: it bumps the view counter
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_out jsonb; v_floors jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token = p_token AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  -- one flat answer for missing / revoked / expired: a probe learns nothing,
  -- not even whether the token ever existed
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
                        's', st.state,
                        't', ty.type_name,
                        'a', u.area,
                        -- price leaves the server for FOR-SALE units only
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

-- ── management — a director of the owning company, and nobody else ──────────
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

  -- schema-qualified on purpose: pgcrypto lives in `extensions`, and this
  -- function pins search_path to 'public', so a bare gen_random_bytes() is
  -- not visible here
  v_tok := encode(extensions.gen_random_bytes(16), 'hex');   -- 128 bits, not guessable
  INSERT INTO public.availability_links (token, company_id, project_id, label, created_by)
  VALUES (v_tok, v_co, p_project_id, p_label, v_ses.sales_user_id);

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

  UPDATE public.availability_links SET revoked = true
   WHERE token = p_token AND company_id = ANY(v_cos);
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'token', l.token, 'label', l.label, 'project', pr.project_name,
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
