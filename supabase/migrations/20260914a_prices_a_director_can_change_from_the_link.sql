/* ══ PRICES, FROM THE LINK, BEHIND THE DIRECTOR'S OWN PASSWORD ═══════════
   Rashid asked for a price list on the public availability link: floor by
   floor, banded where a floor has more than one rate, read-only to everybody
   — and one button behind it that asks for the director's password and then
   changes the rate.

   Three decisions he made, and they are the shape of this file:

   · An update sets a RATE PER SQFT, for a whole floor or for a run of units
     inside it. Each unit's price becomes its own area times that rate, so two
     shops of different sizes on the same rate end up at different prices,
     which is how this market actually quotes.
   · It touches AVAILABLE UNITS ONLY. A unit somebody is holding was quoted at
     the rate it was held on, and a unit already sold is a contract. Neither
     moves.
   · Every update is written down. "aik database banta rahay k kab kab prices
     update hoi hain" — what changed, by how much, over how many units, and
     when.

   The password is the one already on the project for the directors' report.
   There is no second secret to lose, and a director who has changed that one
   has changed this one too. ═══════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS public.availability_price_updates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  link_id       uuid REFERENCES public.availability_links(id) ON DELETE SET NULL,
  /* NULL floor means every floor; NULL from/to means the whole of that floor */
  floor_label   text,
  unit_from     text,
  unit_to       text,
  rate          numeric NOT NULL CHECK (rate > 0),
  area_unit     text,
  units_changed integer NOT NULL DEFAULT 0,
  units_skipped integer NOT NULL DEFAULT 0,
  value_before  numeric,
  value_after   numeric,
  /* a handful of real rows, before and after, so a number in this log can be
     checked against the building rather than believed */
  sample        jsonb,
  at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_price_updates_project_at_idx
  ON public.availability_price_updates (project_id, at DESC);

/* NOBODY REACHES THIS TABLE DIRECTLY. It carries what a building is worth and
   when that changed; the only doors are the two SECURITY DEFINER functions
   below, and both of them ask for the password first. */
ALTER TABLE public.availability_price_updates ENABLE ROW LEVEL SECURITY;

/* ── the update ────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.update_availability_prices(
  p_token text,
  p_password text,
  p_floor text DEFAULT NULL,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL,
  p_rate numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_link public.availability_links; v_pr uuid; v_hash text; v_tries int;
  v_unit text; v_from_k bigint; v_to_k bigint; v_swap bigint;
  v_changed int := 0; v_skipped int := 0;
  v_before numeric := 0; v_after numeric := 0; v_sample jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  /* THE SAME TEN TRIES AN HOUR THE REPORT GETS, counted in the same place. A
     public URL with a password on it is a public URL with a password on it,
     and this door moves money rather than only showing it. */
  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many');
  END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
            public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text));
  IF v_hash IS NULL OR v_hash <>
       public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no');
  END IF;

  /* A RATE HAS TO BE A RATE. Zero empties the building's worth in one tap and
     a fat finger on a phone keypad is the likeliest way it happens. */
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 10000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rate');
  END IF;

  SELECT COALESCE(max(u.area_unit), 'sqft') INTO v_unit
    FROM public.units u WHERE u.project_id = v_pr;

  /* THE RANGE IS READ THE WAY THE PAGE ORDERS UNITS, not alphabetically: every
     digit in the code as one number, which is what puts SF-15 between SF-14
     and SF-16 instead of after SF-149. The two must agree or a director picks
     one run on screen and changes another. */
  IF p_from IS NOT NULL AND p_to IS NOT NULL THEN
    v_from_k := COALESCE(NULLIF(regexp_replace(p_from, '[^0-9]', '', 'g'),'')::bigint, 0);
    v_to_k   := COALESCE(NULLIF(regexp_replace(p_to,   '[^0-9]', '', 'g'),'')::bigint, 0);
    IF v_from_k > v_to_k THEN v_swap := v_from_k; v_from_k := v_to_k; v_to_k := v_swap; END IF;
  END IF;

  CREATE TEMP TABLE _tgt ON COMMIT DROP AS
  SELECT u.id, u.unit_no, COALESCE(u.area,0)::numeric AS area,
         COALESCE(u.base_price,0)::numeric AS was,
         round(COALESCE(u.area,0)::numeric * p_rate) AS now_is
    FROM public.units u
    JOIN public.category_unit_statuses cs ON cs.id = u.status_id
   WHERE u.project_id = v_pr
     AND public._map_unit_state(u.id) = 'available'
     AND COALESCE(cs.is_available, false)
     AND (p_floor IS NULL OR COALESCE(u.floor_label,'—') = p_floor)
     AND (v_from_k IS NULL OR
          COALESCE(NULLIF(regexp_replace(u.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0)
            BETWEEN v_from_k AND v_to_k);

  SELECT count(*) FILTER (WHERE area > 0), count(*) FILTER (WHERE area <= 0),
         COALESCE(sum(was) FILTER (WHERE area > 0), 0),
         COALESCE(sum(now_is) FILTER (WHERE area > 0), 0)
    INTO v_changed, v_skipped, v_before, v_after
    FROM _tgt;

  IF v_changed = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'nothing',
                              'skipped', v_skipped);
  END IF;

  /* A UNIT WITH NO AREA CANNOT BE PRICED BY THE SQUARE FOOT, so it is left
     exactly as it is and counted out loud rather than quietly given a zero. */
  SELECT jsonb_agg(s ORDER BY s->>'n') INTO v_sample FROM (
    SELECT jsonb_build_object('n', unit_no, 'a', area, 'was', was, 'now', now_is) AS s
      FROM _tgt WHERE area > 0 ORDER BY unit_no LIMIT 5) q;

  UPDATE public.units u
     SET base_price = t.now_is, updated_at = now()
    FROM _tgt t
   WHERE u.id = t.id AND t.area > 0;

  INSERT INTO public.availability_price_updates
    (company_id, project_id, link_id, floor_label, unit_from, unit_to, rate,
     area_unit, units_changed, units_skipped, value_before, value_after, sample)
  VALUES (v_link.company_id, v_pr, v_link.id, p_floor, p_from, p_to, p_rate,
          v_unit, v_changed, v_skipped, v_before, v_after, v_sample);

  RETURN jsonb_build_object(
    'success', true, 'changed', v_changed, 'skipped', v_skipped,
    'rate', p_rate, 'area_unit', v_unit,
    'before', v_before, 'after', v_after, 'sample', v_sample);
END;
$fn$;

/* ── and what has been done to them ────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.get_availability_price_log(
  p_token text, p_password text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_link public.availability_links; v_pr uuid; v_hash text; v_tries int; v_rows jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;

  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
            public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text));
  IF v_hash IS NULL OR v_hash <>
       public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'at', pu.at, 'floor', pu.floor_label, 'from', pu.unit_from, 'to', pu.unit_to,
           'rate', pu.rate, 'area_unit', pu.area_unit,
           'changed', pu.units_changed, 'skipped', pu.units_skipped,
           'before', pu.value_before, 'after', pu.value_after) ORDER BY pu.at DESC)
    INTO v_rows
    FROM (SELECT * FROM public.availability_price_updates
           WHERE project_id = v_pr ORDER BY at DESC LIMIT 50) pu;

  RETURN jsonb_build_object('success', true, 'log', COALESCE(v_rows, '[]'::jsonb));
END;
$fn$;

/* THE LOCKDOWN, RESTATED. CREATE OR REPLACE keeps whatever grants a function
   already had, so these lines are the record of what they are rather than a
   change to them: nothing reaches these except through the two roles the page
   actually uses, and both of them still have to know the password. */
REVOKE ALL ON FUNCTION public.update_availability_prices(text,text,text,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_availability_price_log(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_availability_prices(text,text,text,text,text,numeric)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_availability_price_log(text,text)
  TO anon, authenticated, service_role;
