/* ══ RELEASING A UNIT FROM THE LINK, BEHIND THE DIRECTOR'S OWN PASSWORD ═══
   "Director k login se koi b unit click karke release kia ja sakay. Means agar
   director kisi banday ki holdings kholay to kisi b unit pe click karkay
   release kar sakay."

   Until now the room behind that password only READ. Nothing on the public
   link could change a unit; every hold had to be let go from the Reserve Desk
   inside RMS. This is the first thing on that link that writes, and it is
   worth saying plainly what that costs: whoever holds the link AND the
   password can now free a unit. The safeguards are the ones already here,
   used deliberately rather than added for show:

   · THE SAME PASSWORD, and the same ten-tries-an-hour on the same link. A
     wrong password releases nothing and is written down as an attempt, so the
     hour closes on somebody guessing exactly as it does on the report.
   · ONE UNIT AT A TIME, by its own number, inside this link's own project. No
     "release all", no floor, no holder — a director who wants to free forty
     units presses forty times and sees forty confirmations.
   · A UNIT THAT IS ALREADY FREE IS NOT TOUCHED, and neither is one this
     project does not have.
   · EVERY RELEASE IS WRITTEN DOWN — which unit, what it was, whose it was,
     which link did it and when. The unit's own audit trail records the status
     change as always; this table records that it came from the link.

   What it actually does is what the desk does: the unit is moved to the
   project's own available status, and the trigger that has always watched that
   column cancels whatever live reservation was on it. One way for a unit to
   come free, not two. ══════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS public.availability_releases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  link_id     uuid REFERENCES public.availability_links(id) ON DELETE SET NULL,
  unit_id     uuid REFERENCES public.units(id) ON DELETE SET NULL,
  unit_no     text NOT NULL,
  floor_label text,
  /* what it was before, in words a person can read a year from now */
  was_status  text,
  was_held_by text,
  /* and whether a live reservation went with it */
  freed_reservation boolean NOT NULL DEFAULT false,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_releases_project_at_idx
  ON public.availability_releases (project_id, at DESC);

/* Nobody reads this table over the wire. It is read by the RPC below, which
   is SECURITY DEFINER, and by a director inside RMS. */
ALTER TABLE public.availability_releases ENABLE ROW LEVEL SECURITY;

/* ── THE RELEASE ───────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.release_availability_unit(
  p_token text, p_password text, p_unit_no text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.availability_links; v_pr uuid; v_co uuid; v_hash text; v_tries int;
  v_unit public.units; v_was text; v_who text; v_avail uuid;
  v_res int; v_free boolean;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id; v_co := v_link.company_id;

  /* the same hour, the same ten tries, the same table as the report: somebody
     guessing at the password cannot get more attempts by guessing here */
  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many'); END IF;

  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;

  /* written down before it is judged */
  INSERT INTO public.availability_report_attempts (link_id, ok)
  VALUES (v_link.id, v_hash IS NOT NULL AND v_hash =
          public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text));

  IF v_hash IS NULL OR v_hash <>
     public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  /* ONE UNIT, BY ITS OWN NUMBER, IN THIS LINK'S OWN PROJECT. Matched the way
     the page matches it — case and spacing are what a person typed, not what
     the unit is called. */
  SELECT u.* INTO v_unit FROM public.units u
   WHERE u.project_id = v_pr
     AND upper(regexp_replace(COALESCE(u.unit_no,''), '[^A-Za-z0-9]', '', 'g'))
       = upper(regexp_replace(COALESCE(p_unit_no,''), '[^A-Za-z0-9]', '', 'g'))
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found'); END IF;

  /* what it is now, in the words the link shows, and whether it is free
     already — a unit nobody is holding has nothing to release */
  SELECT COALESCE(NULLIF(TRIM(cs.public_label), ''), cs.status_name),
         COALESCE(cs.is_available, true)
    INTO v_was, v_free
    FROM public.category_unit_statuses cs WHERE cs.id = v_unit.status_id;
  IF v_unit.status_id IS NULL OR v_free THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_free',
                              'unit', v_unit.unit_no); END IF;

  SELECT r.requested_by_name INTO v_who FROM public.reservations r
   WHERE r.unit_id = v_unit.id AND r.status = 'active'
     AND (r.expiry_date IS NULL OR r.expiry_date > now())
   ORDER BY r.created_at DESC LIMIT 1;


  SELECT count(*)::int INTO v_res FROM public.reservations
   WHERE unit_id = v_unit.id AND status = 'active';

  /* the project's own available status, the same one the desk uses */
  SELECT id INTO v_avail FROM public.category_unit_statuses
   WHERE company_id = v_co AND project_id = v_pr AND is_available AND is_active
   ORDER BY sort_order LIMIT 1;
  IF v_avail IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_available_status'); END IF;

  /* ONE WAY FOR A UNIT TO COME FREE. Moving the status is what the desk does,
     and the trigger on this column cancels the live reservation behind it. */
  UPDATE public.units SET status_id = v_avail, updated_at = now()
   WHERE id = v_unit.id AND project_id = v_pr;

  INSERT INTO public.availability_releases
    (company_id, project_id, link_id, unit_id, unit_no, floor_label,
     was_status, was_held_by, freed_reservation)
  VALUES (v_co, v_pr, v_link.id, v_unit.id, v_unit.unit_no, v_unit.floor_label,
          v_was, v_who, v_res > 0);

  RETURN jsonb_build_object('success', true, 'unit', v_unit.unit_no,
                            'was', v_was, 'who', v_who,
                            'freed_reservation', v_res > 0);
END $function$;

/* the public route reaches this and nothing else reaches it */
REVOKE ALL ON FUNCTION public.release_availability_unit(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_availability_unit(text, text, text)
  TO anon, authenticated, service_role;

/* ── AND THE LOG OF THEM, FOR THE SAME PASSWORD ────────────────────────── */
CREATE OR REPLACE FUNCTION public.get_availability_releases(p_token text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_pr uuid; v_hash text; v_rows jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;
  v_pr := v_link.project_id;
  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_pr;
  IF v_hash IS NULL OR v_hash <>
     public._availability_token_hash(COALESCE(p_password,'') || ':' || v_pr::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'no'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit', unit_no, 'floor', floor_label, 'was', was_status,
           'who', was_held_by, 'freed', freed_reservation, 'at', at)
         ORDER BY at DESC), '[]'::jsonb)
    INTO v_rows FROM (SELECT * FROM public.availability_releases
                       WHERE project_id = v_pr ORDER BY at DESC LIMIT 200) q;
  RETURN jsonb_build_object('success', true, 'releases', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.get_availability_releases(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_availability_releases(text, text)
  TO anon, authenticated, service_role;
