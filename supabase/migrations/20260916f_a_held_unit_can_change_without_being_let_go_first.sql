/* ══ CHANGING A UNIT THAT IS ALREADY HELD ════════════════════════════════
   "Suppose aik unit already reserve hai, hold hai ya sold hai ya hold for x
   days hai, kisi b cheez ko insaan change kar sake. Q k abhi … muje wapis unit
   ko pehle release karna parta hai pehle aur phir dobara se new status dena
   parta hai."

   The desk's own booking call refuses a unit that is not free, and it is right
   to: two dealers reaching for the same shop is exactly what that guard is
   for. So this does not weaken it. It does, in one call and inside one
   transaction, the two steps a director does by hand today — end the hold that
   is on the unit, then book it again under the new status, the new days, the
   new name — and the booking half is reserve_unit_desk itself, unchanged, with
   every rule still in it.

   That matters more than the convenience: there is still ONE piece of code
   that books a unit. This one only clears the way to it, and if the booking
   refuses for any reason the release is rolled back with it, so a unit can
   never be left free because a change half-happened.

   A director's call, and only inside their own company. ══════════════════ */

CREATE OR REPLACE FUNCTION public.change_unit_status_desk(
  p_session_token text,
  p_unit_id uuid,
  p_unit_status_id uuid,
  p_expiry_days integer DEFAULT NULL,
  p_requested_by_name text DEFAULT NULL,
  p_requested_by_agent_id uuid DEFAULT NULL,
  p_requested_by_sales_user_id uuid DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ses public.sales_sessions; v_role text; v_unit public.units;
  v_was text; v_avail uuid; v_n int; v_out jsonb; v_freed boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF NOT public._sales_may_sell(p_session_token) THEN
    RETURN jsonb_build_object('success',false,'error','role_cannot_sell',
      'message','Your role does not book or sell units.'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin','cfo') THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed',
      'message','Changing a unit that is already held is a director''s call.'); END IF;

  SELECT * INTO v_unit FROM public.units WHERE id = p_unit_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;
  IF v_unit.company_id <> v_ses.company_id THEN
    RETURN jsonb_build_object('success',false,'error','not_allowed'); END IF;

  SELECT COALESCE(NULLIF(TRIM(cs.public_label),''), cs.status_name) INTO v_was
    FROM public.category_unit_statuses cs WHERE cs.id = v_unit.status_id;

  /* ── STEP ONE: whatever is on it comes off ──────────────────────────────
     The hold is cancelled by hand rather than by moving the status, because
     the status is about to be set again by the booking below and one journey
     through the trigger is enough. */
  UPDATE public.reservations
     SET status = 'cancelled', cancelled_by = v_ses.sales_user_id,
         cancelled_at = now(), updated_at = now()
   WHERE unit_id = p_unit_id AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_freed := v_n > 0;

  SELECT id INTO v_avail FROM public.category_unit_statuses
   WHERE company_id = v_unit.company_id AND project_id = v_unit.project_id
     AND is_available AND is_active ORDER BY sort_order LIMIT 1;
  IF v_avail IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_available_status'); END IF;
  UPDATE public.units SET status_id = v_avail, updated_at = now() WHERE id = p_unit_id;

  /* ── STEP TWO: the desk's own booking, with every rule still in it ────── */
  SELECT public.reserve_unit_desk(
           p_session_token, p_unit_id, p_requested_by_agent_id,
           p_requested_by_sales_user_id, p_requested_by_name,
           p_client_name, p_client_phone, p_expiry_days,
           false, NULL, p_note, p_unit_status_id)
    INTO v_out;

  /* if the booking refused, the whole change goes back with it: a unit is
     never left on the shelf because half of a change went through */
  IF v_out IS NULL OR NOT COALESCE((v_out->>'success')::boolean, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = COALESCE(v_out->>'message', v_out->>'error', 'the booking refused this change'),
      DETAIL  = COALESCE(v_out->>'error', 'unknown');
  END IF;

  RETURN v_out || jsonb_build_object('changed_from', v_was, 'ended_a_hold', v_freed);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_was = PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('success', false, 'error', COALESCE(NULLIF(v_was,''), 'change_refused'),
                            'message', SQLERRM);
END $function$;

REVOKE ALL ON FUNCTION public.change_unit_status_desk(
  text, uuid, uuid, integer, text, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_unit_status_desk(
  text, uuid, uuid, integer, text, uuid, uuid, text, text, text)
  TO authenticated, service_role;
