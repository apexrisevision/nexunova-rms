-- ══ Event Guest Register (20261127a) ══
-- APPLIED 27-Nov-2026 as 20261127065800, on the owner's yes. Links minted after apply: desk (expires 5-Dec) and guest QR (expires 29-Nov 2am PKT).
-- Owner, 27-Nov-2026: guest details at the Awami Grand Launch (28-Nov) are to be taken on an online form on the
-- Nexunova site (not a Google Sheet), by 3-4 receptionists at the same time.
--
-- What this adds
--   event_guest_links  one row per shareable form link. mode 'desk' = receptionist form (reference list of staff
--                      names, duplicate warnings, own desk's recent entries); mode 'self' = a guest fills it from a QR
--                      (no staff names, no other guest's data ever returned).
--   event_guests       one row per guest. client_ref makes a retried save a no-op (offline queue on a tablet).
--   event_guest_config / event_guest_check / event_guest_register / event_guest_desk_feed / event_guest_edit
--                      public (anon) functions keyed by the link token; the raw token is never stored, only its sha256.
--   event_guest_list   directors / admin / cfo only, by sales-portal session: the full register for the event.
--   _event_guest_link_create   NOT callable by anon or authenticated; run once by the operator to mint a link.
-- Nothing here touches units, reservations, sales, leads, prices or NexuFinance.

CREATE TABLE IF NOT EXISTS public.event_guest_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  event_code  text NOT NULL,
  event_title text NOT NULL,
  event_date  date NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('desk','self')),
  label       text,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_hash  text NOT NULL UNIQUE,
  revoked     boolean NOT NULL DEFAULT false,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_guests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_no         integer NOT NULL,
  link_id          uuid NOT NULL REFERENCES public.event_guest_links(id),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  project_id       uuid NOT NULL REFERENCES public.projects(id),
  event_code       text NOT NULL,
  source           text NOT NULL CHECK (source IN ('desk','self')),
  desk             text,
  receptionist     text,
  guest_name       text NOT NULL CHECK (char_length(guest_name) BETWEEN 2 AND 80),
  phone            text NOT NULL CHECK (char_length(phone) BETWEEN 8 AND 16),
  reference        text,
  reference_detail text,
  interest         text,
  guest_type       text,
  city             text,
  remarks          text,
  vip              boolean NOT NULL DEFAULT false,
  shield           boolean NOT NULL DEFAULT false,
  is_repeat        boolean NOT NULL DEFAULT false,
  client_ref       uuid NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  UNIQUE (event_code, guest_no)
);
CREATE INDEX IF NOT EXISTS event_guests_event_phone ON public.event_guests (event_code, phone);
CREATE INDEX IF NOT EXISTS event_guests_event_desk  ON public.event_guests (event_code, desk, created_at DESC);

ALTER TABLE public.event_guest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_guests      ENABLE ROW LEVEL SECURITY;
-- no policies: nobody reads or writes these tables directly; only the functions below do.
REVOKE ALL ON public.event_guest_links FROM anon, authenticated;
REVOKE ALL ON public.event_guests      FROM anon, authenticated;

-- ── helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._event_guest_link(p_token text)
RETURNS public.event_guest_links LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.event_guest_links
   WHERE token_hash = public._availability_token_hash(COALESCE(p_token,''))
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now())
$$;

-- Pakistani mobile -> 03XXXXXXXXX; an overseas number written with + -> +<digits>; anything else -> NULL
CREATE OR REPLACE FUNCTION public._event_guest_phone(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v text; d text;
BEGIN
  v := public._normalize_pk_mobile(p);
  IF v IS NOT NULL THEN RETURN v; END IF;
  d := regexp_replace(COALESCE(p,''), '[^0-9+]', '', 'g');
  IF d ~ '^(\+|00)[1-9][0-9]{7,13}$' THEN RETURN '+' || regexp_replace(d, '^(\+|00)', ''); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._event_guest_txt(p jsonb, k text, n int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(left(btrim(regexp_replace(COALESCE(p->>k,''), '\s+', ' ', 'g')), n), '')
$$;

-- ── minting a link (operator only) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._event_guest_link_create(p_project_id uuid, p_event_code text, p_title text,
  p_date date, p_mode text, p_label text, p_config jsonb, p_expires timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid; v_tok text;
BEGIN
  SELECT company_id INTO v_co FROM public.projects WHERE id = p_project_id;
  IF v_co IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  v_tok := encode(extensions.gen_random_bytes(12), 'hex');
  INSERT INTO public.event_guest_links (company_id, project_id, event_code, event_title, event_date, mode, label,
                                        config, token_hash, expires_at)
  VALUES (v_co, p_project_id, p_event_code, p_title, p_date, p_mode, p_label, COALESCE(p_config,'{}'::jsonb),
          public._availability_token_hash(v_tok), p_expires);
  RETURN v_tok;   -- the only time the raw token exists
END $$;
REVOKE ALL ON FUNCTION public._event_guest_link_create(uuid,text,text,date,text,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;

-- ── public: what the form needs ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.event_guest_config(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.event_guest_links; v_proj text;
BEGIN
  l := public._event_guest_link(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_available'); END IF;
  SELECT project_name INTO v_proj FROM public.projects WHERE id = l.project_id;
  RETURN jsonb_build_object('success',true,'mode',l.mode,'title',l.event_title,'date',l.event_date,
    'project',v_proj,'config',l.config);
END $$;

-- ── public: is this mobile already in? (desk mode tells where; self mode only yes/no) ──
CREATE OR REPLACE FUNCTION public.event_guest_check(p_token text, p_phone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.event_guest_links; v_ph text; g public.event_guests;
BEGIN
  l := public._event_guest_link(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_available'); END IF;
  v_ph := public._event_guest_phone(p_phone);
  IF v_ph IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_phone'); END IF;
  SELECT * INTO g FROM public.event_guests WHERE event_code = l.event_code AND phone = v_ph
   ORDER BY created_at LIMIT 1;
  IF g.id IS NULL THEN RETURN jsonb_build_object('success',true,'found',false,'phone',v_ph); END IF;
  IF l.mode <> 'desk' THEN RETURN jsonb_build_object('success',true,'found',true,'phone',v_ph); END IF;
  RETURN jsonb_build_object('success',true,'found',true,'phone',v_ph,'guest_no',g.guest_no,'name',g.guest_name,
    'desk',COALESCE(g.desk, CASE WHEN g.source='self' THEN 'QR self-registration' END),
    'at',to_char(g.created_at AT TIME ZONE 'Asia/Karachi','HH12:MI AM'));
END $$;

-- ── public: save one guest ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.event_guest_register(p_token text, p_guest jsonb, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.event_guest_links; v_ph text; v_name text; v_ref uuid; g public.event_guests; v_no int;
        v_desk text; v_dup public.event_guests;
BEGIN
  l := public._event_guest_link(p_token);
  IF l.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_available'); END IF;

  BEGIN v_ref := (p_guest->>'client_ref')::uuid; EXCEPTION WHEN others THEN v_ref := NULL; END;
  IF v_ref IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_request'); END IF;

  -- a retry of a save that already went through: answer as the first time
  SELECT * INTO g FROM public.event_guests WHERE client_ref = v_ref;
  IF g.id IS NOT NULL THEN
    IF g.link_id <> l.id THEN RETURN jsonb_build_object('success',false,'error','bad_request'); END IF;
    RETURN jsonb_build_object('success',true,'guest_no',g.guest_no,'id',g.id,'replayed',true);
  END IF;

  v_name := public._event_guest_txt(p_guest,'guest_name',80);
  IF v_name IS NULL OR char_length(v_name) < 2 THEN RETURN jsonb_build_object('success',false,'error','name_required'); END IF;
  v_ph := public._event_guest_phone(p_guest->>'phone');
  IF v_ph IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_phone'); END IF;

  IF l.mode = 'desk' THEN
    v_desk := public._event_guest_txt(p_guest,'desk',20);
    IF v_desk IS NULL THEN RETURN jsonb_build_object('success',false,'error','desk_required'); END IF;
  END IF;

  -- one guest per mobile per event, unless the desk says it is a different person on the same number
  PERFORM pg_advisory_xact_lock(hashtext('event_guest:' || l.event_code || ':' || v_ph));
  SELECT * INTO v_dup FROM public.event_guests WHERE event_code = l.event_code AND phone = v_ph
   ORDER BY created_at LIMIT 1;
  IF v_dup.id IS NOT NULL THEN
    IF l.mode = 'self' THEN
      RETURN jsonb_build_object('success',true,'guest_no',v_dup.guest_no,'already',true);
    END IF;
    IF NOT COALESCE(p_force,false) THEN
      RETURN jsonb_build_object('success',false,'error','already_registered','guest_no',v_dup.guest_no,
        'name',v_dup.guest_name,'desk',COALESCE(v_dup.desk,'QR self-registration'),
        'at',to_char(v_dup.created_at AT TIME ZONE 'Asia/Karachi','HH12:MI AM'));
    END IF;
  END IF;

  -- self-registration cannot flood the register
  IF l.mode = 'self' AND (SELECT count(*) FROM public.event_guests WHERE link_id = l.id) >= 5000 THEN
    RETURN jsonb_build_object('success',false,'error','full');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('event_guest_no:' || l.event_code));
  SELECT COALESCE(max(guest_no),0)+1 INTO v_no FROM public.event_guests WHERE event_code = l.event_code;

  INSERT INTO public.event_guests (guest_no, link_id, company_id, project_id, event_code, source, desk, receptionist,
    guest_name, phone, reference, reference_detail, interest, guest_type, city, remarks, vip, shield, is_repeat, client_ref)
  VALUES (v_no, l.id, l.company_id, l.project_id, l.event_code, l.mode,
    v_desk,
    CASE WHEN l.mode='desk' THEN public._event_guest_txt(p_guest,'receptionist',60) END,
    v_name, v_ph,
    public._event_guest_txt(p_guest,'reference',80),
    public._event_guest_txt(p_guest,'reference_detail',120),
    public._event_guest_txt(p_guest,'interest',40),
    public._event_guest_txt(p_guest,'guest_type',60),
    public._event_guest_txt(p_guest,'city',60),
    public._event_guest_txt(p_guest,'remarks',400),
    CASE WHEN l.mode='desk' THEN COALESCE((p_guest->>'vip')::boolean,false) ELSE false END,
    CASE WHEN l.mode='desk' THEN COALESCE((p_guest->>'shield')::boolean,false) ELSE false END,
    v_dup.id IS NOT NULL, v_ref)
  RETURNING * INTO g;

  RETURN jsonb_build_object('success',true,'guest_no',g.guest_no,'id',g.id);
END $$;

-- ── public (desk links only): counters + this desk's recent guests ─────────
CREATE OR REPLACE FUNCTION public.event_guest_desk_feed(p_token text, p_desk text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.event_guest_links; v_out jsonb;
BEGIN
  l := public._event_guest_link(p_token);
  IF l.id IS NULL OR l.mode <> 'desk' THEN RETURN jsonb_build_object('success',false,'error','not_available'); END IF;
  SELECT jsonb_build_object('success',true,
    'total',   (SELECT count(*) FROM public.event_guests WHERE event_code=l.event_code),
    'mine',    (SELECT count(*) FROM public.event_guests WHERE event_code=l.event_code AND desk=p_desk),
    'vip',     (SELECT count(*) FROM public.event_guests WHERE event_code=l.event_code AND vip),
    'shields', (SELECT count(*) FROM public.event_guests WHERE event_code=l.event_code AND shield),
    'self',    (SELECT count(*) FROM public.event_guests WHERE event_code=l.event_code AND source='self'),
    'recent',  COALESCE((SELECT jsonb_agg(r ORDER BY (r->>'no')::int DESC) FROM (
                 SELECT jsonb_build_object('id',g.id,'no',g.guest_no,'name',g.guest_name,'phone',g.phone,
                   'reference',g.reference,'reference_detail',g.reference_detail,'interest',g.interest,
                   'guest_type',g.guest_type,'city',g.city,'remarks',g.remarks,'vip',g.vip,'shield',g.shield,
                   'at',to_char(g.created_at AT TIME ZONE 'Asia/Karachi','HH12:MI AM')) r
                 FROM public.event_guests g WHERE g.event_code=l.event_code AND g.desk=p_desk
                 ORDER BY g.guest_no DESC LIMIT 12) x), '[]'::jsonb))
  INTO v_out;
  RETURN v_out;
END $$;

-- ── public (desk links only): correct a guest this desk entered ───────────
CREATE OR REPLACE FUNCTION public.event_guest_edit(p_token text, p_id uuid, p_desk text, p_guest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.event_guest_links; g public.event_guests; v_ph text; v_name text;
BEGIN
  l := public._event_guest_link(p_token);
  IF l.id IS NULL OR l.mode <> 'desk' THEN RETURN jsonb_build_object('success',false,'error','not_available'); END IF;
  SELECT * INTO g FROM public.event_guests WHERE id=p_id AND event_code=l.event_code AND desk=p_desk FOR UPDATE;
  IF g.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  v_name := public._event_guest_txt(p_guest,'guest_name',80);
  IF v_name IS NULL OR char_length(v_name) < 2 THEN RETURN jsonb_build_object('success',false,'error','name_required'); END IF;
  v_ph := public._event_guest_phone(p_guest->>'phone');
  IF v_ph IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_phone'); END IF;
  UPDATE public.event_guests SET
    guest_name=v_name, phone=v_ph,
    reference=public._event_guest_txt(p_guest,'reference',80),
    reference_detail=public._event_guest_txt(p_guest,'reference_detail',120),
    interest=public._event_guest_txt(p_guest,'interest',40),
    guest_type=public._event_guest_txt(p_guest,'guest_type',60),
    city=public._event_guest_txt(p_guest,'city',60),
    remarks=public._event_guest_txt(p_guest,'remarks',400),
    vip=COALESCE((p_guest->>'vip')::boolean,false),
    shield=COALESCE((p_guest->>'shield')::boolean,false),
    edited_at=now()
  WHERE id=g.id;
  RETURN jsonb_build_object('success',true,'guest_no',g.guest_no);
END $$;

-- ── directors / admin / cfo: the full register ─────────────────────────────
CREATE OR REPLACE FUNCTION public.event_guest_list(p_session_token text, p_event_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_role text; v_cos uuid[]; v_code text; v_events jsonb; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role IS NULL OR v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('code',e.event_code,'title',e.event_title,'date',e.event_date)
                  ORDER BY e.event_date DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT DISTINCT ON (event_code) event_code, event_title, event_date FROM public.event_guest_links
           WHERE company_id = ANY(v_cos) ORDER BY event_code, created_at) e;
  v_code := COALESCE(p_event_code, v_events->0->>'code');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('no',g.guest_no,'source',g.source,'desk',g.desk,
           'receptionist',g.receptionist,'name',g.guest_name,'phone',g.phone,'reference',g.reference,
           'reference_detail',g.reference_detail,'interest',g.interest,'guest_type',g.guest_type,'city',g.city,
           'remarks',g.remarks,'vip',g.vip,'shield',g.shield,'repeat',g.is_repeat,
           'at',g.created_at) ORDER BY g.guest_no), '[]'::jsonb)
    INTO v_rows
    FROM public.event_guests g
   WHERE g.event_code = v_code AND g.company_id = ANY(v_cos);

  RETURN jsonb_build_object('success',true,'event',v_code,'events',v_events,'guests',v_rows);
END $$;

REVOKE ALL ON FUNCTION public._event_guest_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_guest_config(text)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_guest_check(text,text)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_guest_register(text,jsonb,boolean)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_guest_desk_feed(text,text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_guest_edit(text,uuid,text,jsonb)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_guest_list(text,text)                    TO anon, authenticated;
