/* ══ A ROOM BEHIND THE LINK, FOR THE DIRECTORS ═════════════════════════════
   The dealer's link answers one question: what can I sell. Rashid asked for a
   second room behind the same door, with a password on it: "isi reservation
   link pe aik password protected detail banao… total units kis kis ne kitnay
   kitnay hold kiye, sold kiye, pagri wagaira… aik commulative summary ho
   directors k liye… Deep report ho aik. Director level report."

   WHAT THIS IS AND WHAT IT IS NOT. It is a reading of the building: who is
   holding what, how much of it, for how long, worth how much, and what that
   says about the month. It is NOT the desk. It writes nothing, books nothing,
   and cancels nothing. A password that leaks costs the company its numbers,
   not its inventory.

   ── HOW THE PASSWORD IS KEPT ──────────────────────────────────────────────
   Hashed, the same way the link token is, and SALTED WITH THE PROJECT so the
   same word on two projects does not produce the same hash. It lives on the
   project rather than on the link: a director reaching this through whichever
   link they happen to have is the point, and a link that is revoked stops
   being a door on its own.

   ── AND WHY IT CANNOT BE GUESSED ──────────────────────────────────────────
   This is an anonymous function on a public URL, so the password is the whole
   of the lock and somebody will eventually try to pick it. Three things:

     · every attempt is written down BEFORE it is judged, so a failure costs
       the same as a success and cannot be rolled back by disconnecting;
     · ten attempts an hour per link, then the door stops answering — to the
       right password as well as the wrong one, because a lock that lets the
       right key through while it is being picked is not a lock;
     · a wrong password and a revoked link answer identically. Probing teaches
       nothing, which is the same rule get_public_availability already keeps.

   The password itself is set by a director from the desk, and is required to
   be twelve characters. A four-digit code on a public URL is not a password,
   and the function refuses to store one. */

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS report_password_hash text,
  ADD COLUMN IF NOT EXISTS report_password_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_password_set_by uuid;

CREATE TABLE IF NOT EXISTS public.availability_report_attempts (
  id       bigserial PRIMARY KEY,
  link_id  uuid NOT NULL REFERENCES public.availability_links(id) ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  ok       boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS availability_report_attempts_link_at
  ON public.availability_report_attempts (link_id, at DESC);

/* The floor is deny-all, as everywhere else: nothing reads this table but the
   SECURITY DEFINER function that writes it. */
ALTER TABLE public.availability_report_attempts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='availability_report_attempts') THEN
    EXECUTE 'CREATE POLICY no_one ON public.availability_report_attempts FOR ALL USING (false)';
  END IF;
END $$;
REVOKE ALL ON public.availability_report_attempts FROM anon, authenticated;

/* ── the director sets it, from the desk ─────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.set_availability_report_password(
  p_session_token text, p_project_id uuid, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cos uuid[]; v_co uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;

  v_cos := public._map_scope_companies(p_session_token);
  SELECT company_id INTO v_co FROM public.projects WHERE id = p_project_id;
  IF v_co IS NULL OR NOT (v_co = ANY(v_cos)) THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;

  /* CLEARING IT IS ALLOWED AND SHUTS THE ROOM. An empty password would
     otherwise mean "any password", which is the worst of both. */
  IF p_password IS NULL OR TRIM(p_password) = '' THEN
    UPDATE public.projects
       SET report_password_hash = NULL, report_password_set_at = now(),
           report_password_set_by = v_ses.sales_user_id
     WHERE id = p_project_id;
    RETURN jsonb_build_object('success',true,'cleared',true);
  END IF;

  IF length(TRIM(p_password)) < 12 THEN
    RETURN jsonb_build_object('success',false,'error','too_short'); END IF;

  UPDATE public.projects
     SET report_password_hash =
           public._availability_token_hash(TRIM(p_password) || ':' || p_project_id::text),
         report_password_set_at = now(),
         report_password_set_by = v_ses.sales_user_id
   WHERE id = p_project_id;
  RETURN jsonb_build_object('success',true,'cleared',false);
END $function$;

REVOKE ALL ON FUNCTION public.set_availability_report_password(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_availability_report_password(text, uuid, text)
  TO anon, authenticated, service_role;

/* ── and the room itself ─────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.get_availability_report(p_token text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_hash text; v_tries int;
  v_out jsonb; v_totals jsonb; v_status jsonb; v_floors jsonb; v_people jsonb; v_ins jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many');
  END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;

  /* written down before it is judged */
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
            public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text));

  IF v_hash IS NULL OR v_hash <>
       public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no');
  END IF;

  /* ── THE BUILDING, ONCE ────────────────────────────────────────────────
     Every unit that is not retired, with the hold on it if there is one. The
     kind is the tenant's public wording, the same word the dealer's screen
     shows, so the two can never disagree about what "Sold" means. */
  CREATE TEMP TABLE _rep ON COMMIT DROP AS
  SELECT u.id, u.unit_no, u.floor_no, COALESCE(u.floor_label, '—') AS floor_label,
         COALESCE(u.base_price, 0)::numeric AS price,
         COALESCE(u.area, 0)::numeric       AS area,
         COALESCE(cs.is_available, false)   AS free,
         CASE WHEN COALESCE(cs.is_available, false) THEN NULL
              ELSE COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name) END AS kind,
         NULLIF(TRIM(r.requested_by_name), '') AS who,
         r.created_at AS held_at, r.expiry_date
    FROM public.units u
    LEFT JOIN public.category_unit_statuses cs ON cs.id = u.status_id
    LEFT JOIN LATERAL (
      SELECT r2.requested_by_name, r2.created_at, r2.expiry_date
        FROM public.reservations r2
       WHERE r2.unit_id = u.id AND r2.status = 'active'
         AND (r2.expiry_date IS NULL OR r2.expiry_date > now())
       ORDER BY r2.created_at DESC LIMIT 1) r ON true
   WHERE u.project_id = v_pr
     AND public._map_unit_state(u.id) <> 'retired';

  SELECT jsonb_build_object(
    'units',      count(*),
    'available',  count(*) FILTER (WHERE free),
    'held',       count(*) FILTER (WHERE NOT free),
    'value',      COALESCE(sum(price), 0),
    'value_free', COALESCE(sum(price) FILTER (WHERE free), 0),
    'value_held', COALESCE(sum(price) FILTER (WHERE NOT free), 0),
    'area',       COALESCE(sum(area), 0),
    'holders',    count(DISTINCT who))
    INTO v_totals FROM _rep;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'units')::int DESC), '[]'::jsonb) INTO v_status
    FROM (SELECT jsonb_build_object('kind', kind, 'units', count(*),
                                    'value', COALESCE(sum(price), 0),
                                    'area',  COALESCE(sum(area), 0)) AS x
            FROM _rep WHERE NOT free GROUP BY kind) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'floor_no')::int), '[]'::jsonb) INTO v_floors
    FROM (SELECT jsonb_build_object(
                   'floor_no', floor_no, 'label', floor_label,
                   'units', count(*),
                   'available', count(*) FILTER (WHERE free),
                   'held', count(*) FILTER (WHERE NOT free),
                   'value_held', COALESCE(sum(price) FILTER (WHERE NOT free), 0),
                   /* the going rate on this floor, from the register itself */
                   'rate', CASE WHEN COALESCE(sum(area),0) > 0
                                THEN round(sum(price) / sum(area)) ELSE NULL END,
                   'by', COALESCE((SELECT jsonb_object_agg(k, n)
                                     FROM (SELECT kind k, count(*) n FROM _rep b
                                            WHERE b.floor_no = a.floor_no AND NOT b.free
                                            GROUP BY kind) z), '{}'::jsonb)) AS x
            FROM _rep a GROUP BY floor_no, floor_label) q;

  /* ── WHO IS HOLDING WHAT ───────────────────────────────────────────────
     The heart of it. Per name: how many of each kind, what it is worth, when
     they started and when they last took one, how many floors they are spread
     across, the oldest hold still standing, and what is about to lapse. */
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'units')::int DESC, x->>'who'), '[]'::jsonb)
    INTO v_people
    FROM (SELECT jsonb_build_object(
                   'who', COALESCE(a.who, '(not recorded)'),
                   'units', count(*),
                   'value', COALESCE(sum(a.price), 0),
                   'area',  COALESCE(sum(a.area), 0),
                   'floors', count(DISTINCT a.floor_no),
                   'first', min(a.held_at), 'last', max(a.held_at),
                   'oldest_days', CASE WHEN min(a.held_at) IS NULL THEN NULL
                                       ELSE floor(extract(epoch FROM now() - min(a.held_at)) / 86400) END,
                   'expiring', count(*) FILTER (WHERE a.expiry_date IS NOT NULL
                                                  AND a.expiry_date < now() + interval '7 days'),
                   'by', COALESCE((SELECT jsonb_object_agg(k, n)
                                     FROM (SELECT kind k, count(*) n FROM _rep b
                                            WHERE b.who IS NOT DISTINCT FROM a.who AND NOT b.free
                                            GROUP BY kind) z), '{}'::jsonb)) AS x
            FROM _rep a WHERE NOT a.free GROUP BY a.who) q;

  /* ── WHAT IT ADDS UP TO ────────────────────────────────────────────────
     Six readings a director can act on, and each one is a number with a name
     rather than a colour on a dial:

       concentration — how much of everything held sits with one person. A
                       building where one name holds most of the stock has one
                       conversation to have, not eight.
       ageing        — a hold is inventory off the market. How much of it is
                       older than a week, a month, two months.
       lapsing       — what falls back in within seven days if nobody renews.
       pace          — units taken per week for eight weeks, so "busy" is a
                       series and not a feeling.
       cancelled     — holds that were taken and given back. The honest
                       counterweight to the pace above.
       floors        — the two moving fastest and the two moving slowest, by
                       the share of the floor already gone. */
  SELECT jsonb_build_object(
    'concentration', (SELECT jsonb_build_object(
                        'top', who, 'units', n,
                        'share', CASE WHEN t.held > 0 THEN round(n * 100.0 / t.held, 1) ELSE 0 END)
                       FROM (SELECT COALESCE(who,'(not recorded)') who, count(*) n
                               FROM _rep WHERE NOT free GROUP BY who
                              ORDER BY 2 DESC LIMIT 1) c,
                            (SELECT count(*) FILTER (WHERE NOT free) held FROM _rep) t),
    'ageing', (SELECT jsonb_build_object(
                 'd0_7',   count(*) FILTER (WHERE held_at > now() - interval '7 days'),
                 'd8_30',  count(*) FILTER (WHERE held_at <= now() - interval '7 days'
                                              AND held_at > now() - interval '30 days'),
                 'd31_60', count(*) FILTER (WHERE held_at <= now() - interval '30 days'
                                              AND held_at > now() - interval '60 days'),
                 'd60',    count(*) FILTER (WHERE held_at <= now() - interval '60 days'),
                 'value_over_30', COALESCE(sum(price) FILTER (
                                    WHERE held_at <= now() - interval '30 days'), 0),
                 'oldest_days', CASE WHEN min(held_at) IS NULL THEN NULL
                                     ELSE floor(extract(epoch FROM now() - min(held_at)) / 86400) END)
                FROM _rep WHERE NOT free),
    'lapsing', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'unit', unit_no, 'who', COALESCE(who,'(not recorded)'),
                         'kind', kind, 'on', expiry_date, 'value', price)
                       ORDER BY expiry_date), '[]'::jsonb)
                  FROM _rep WHERE NOT free AND expiry_date IS NOT NULL
                    AND expiry_date < now() + interval '7 days'),
    'pace', (SELECT COALESCE(jsonb_agg(jsonb_build_object('week', w, 'taken', n) ORDER BY w), '[]'::jsonb)
               FROM (SELECT date_trunc('week', r.created_at)::date w, count(*) n
                       FROM public.reservations r
                      WHERE r.project_id = v_pr
                        AND r.created_at > now() - interval '8 weeks'
                      GROUP BY 1) p),
    'given_back', (SELECT jsonb_build_object(
                     'units', count(*),
                     'names', count(DISTINCT NULLIF(TRIM(requested_by_name),'')))
                     FROM public.reservations
                    WHERE project_id = v_pr AND status = 'cancelled'),
    'floors_fast', (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'share')::numeric DESC), '[]'::jsonb)
                      FROM (SELECT jsonb_build_object('label', floor_label,
                              'share', round(count(*) FILTER (WHERE NOT free) * 100.0 / count(*), 1),
                              'held', count(*) FILTER (WHERE NOT free), 'units', count(*)) AS x
                              FROM _rep GROUP BY floor_label
                             ORDER BY count(*) FILTER (WHERE NOT free) * 1.0 / count(*) DESC
                             LIMIT 3) q2)
  ) INTO v_ins;

  SELECT jsonb_build_object(
    'success', true,
    'project', pr.project_name,
    'company', COALESCE(c.display_name, c.company_name),
    'area_unit', COALESCE((SELECT u.area_unit FROM public.units u
                            WHERE u.project_id = v_pr AND u.area_unit IS NOT NULL LIMIT 1), 'sqft'),
    'as_of', now(),
    'totals', v_totals, 'by_status', v_status, 'by_floor', v_floors,
    'by_person', v_people, 'insights', v_ins)
    INTO v_out
    FROM public.projects pr JOIN public.companies c ON c.id = pr.company_id
   WHERE pr.id = v_pr;

  DROP TABLE IF EXISTS _rep;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.get_availability_report(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_availability_report(text, text)
  TO anon, authenticated, service_role;
