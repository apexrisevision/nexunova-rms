-- ═══════════════════════════════════════════════════════════════════════════
-- CLEARING A NATURE UNPUBLISHES THE STATUS.
--
-- public_choice may only be true on a status the desk can apply, and a check
-- constraint holds that. But the Categories form does not send public_choice
-- at all, so clearing a status's nature there would have left the flag
-- standing and the save would have failed on a constraint message nobody
-- editing a form could act on.
--
-- A status the desk can no longer apply cannot go on being offered on a link.
-- So the flag follows the nature down rather than fighting it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE OR REPLACE FUNCTION public.upsert_unit_status(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
  v_nature text; v_days int; v_avail boolean; v_code text; v_pub boolean;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF p_id IS NULL THEN
    v_target_pid := NULLIF(p_data->>'project_id','')::uuid;
  ELSE
    SELECT project_id INTO v_target_pid FROM public.category_unit_statuses
    WHERE id = p_id AND company_id = p_company_id;
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  /* ── THE NATURE, CHECKED HERE AND NOT ONLY IN THE BROWSER ───────────────
     The browser draws three choices; a caller can send any JSON it likes.
     "none" arrives as a string from a <select> and means the same as absent. */
  v_nature := NULLIF(NULLIF(TRIM(COALESCE(p_data->>'nature','')), ''), 'none');
  IF v_nature IS NOT NULL AND v_nature NOT IN ('temporary','permanent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_nature',
      'message', 'A status is either temporary, permanent, or neither.');
  END IF;

  v_avail := COALESCE((p_data->>'is_available')::bool,
                      (SELECT is_available FROM public.category_unit_statuses WHERE id = p_id),
                      false);
  IF v_nature IS NOT NULL AND v_avail THEN
    RETURN jsonb_build_object('success', false, 'error', 'sellable_has_no_nature',
      'message', 'A sellable status cannot also hold a unit off the market.');
  END IF;

  /* Sale-driven statuses are produced by the sales module and read by the
     register, the receivables and the commission report. Letting the desk
     stamp one would put a unit in a state that no sale explains. */
  v_code := upper(COALESCE(p_data->>'status_code',
                  (SELECT status_code FROM public.category_unit_statuses WHERE id = p_id), ''));
  IF v_nature IS NOT NULL AND v_code IN
     ('SOLD','INSTALLMENT','POSSESSION','TRANSFER','MORTGAGED','SALE_REVIEW','DEAD','AVAILABLE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'reserved_code',
      'message', v_code || ' is produced by the sales module, so the desk cannot apply it.');
  END IF;

  /* PUBLISHED TO THE LINK, and only ever something the desk can apply. A
     status with no nature cannot be asked for, because it could not then be
     granted — which is how SOLD stays out of a dealer's reach while
     "Sold - Entry Pending" stands in its place. */
  v_pub := COALESCE((p_data->>'public_choice')::bool, false);
  IF v_pub AND v_nature IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_desk_tag',
      'message', 'Only a status the desk can apply may be offered on a link.');
  END IF;

  v_days := NULLIF(p_data->>'hold_days','')::int;
  IF v_nature = 'permanent' THEN
    v_days := NULL;                      -- permanent asks for no number of days
  ELSIF v_days IS NOT NULL AND (v_days < 1 OR v_days > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_hold_days',
      'message', 'A hold runs between 1 and 90 days.');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.category_unit_statuses (company_id, project_id, status_code, status_name, color_hex, sort_order, is_active, is_available, nature, hold_days, public_choice, public_label)
    VALUES (p_company_id, (p_data->>'project_id')::uuid, p_data->>'status_code', p_data->>'status_name',
            COALESCE(p_data->>'color_hex','#6b7280'), COALESCE((p_data->>'sort_order')::int, 0),
            COALESCE((p_data->>'is_active')::bool, true), COALESCE((p_data->>'is_available')::bool, false),
            v_nature, v_days, v_pub, NULLIF(TRIM(COALESCE(p_data->>'public_label','')),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.category_unit_statuses SET
      status_code = COALESCE(p_data->>'status_code', status_code),
      status_name = COALESCE(p_data->>'status_name', status_name),
      color_hex = COALESCE(p_data->>'color_hex', color_hex),
      sort_order = COALESCE((p_data->>'sort_order')::int, sort_order),
      is_active = COALESCE((p_data->>'is_active')::bool, is_active),
      is_available = COALESCE((p_data->>'is_available')::bool, is_available),
      /* Sent on every save, so choosing "none" clears it rather than being
         swallowed by a COALESCE that reads absence as "leave it alone". */
      nature = CASE WHEN p_data ? 'nature' THEN v_nature ELSE nature END,
      hold_days = CASE WHEN p_data ? 'nature' OR p_data ? 'hold_days' THEN v_days ELSE hold_days END,
      /* TAKING THE NATURE AWAY TAKES THE PUBLICATION WITH IT. A status the
         desk can no longer apply cannot go on being offered on a link — and
         the check constraint would otherwise refuse the save with a message
         nobody editing a form could act on. */
      public_choice = CASE WHEN v_nature IS NULL THEN false
                          WHEN p_data ? 'public_choice' THEN v_pub
                          ELSE public_choice END,
      public_label  = CASE WHEN p_data ? 'public_label'
                          THEN NULLIF(TRIM(COALESCE(p_data->>'public_label','')),'')
                          ELSE public_label END,
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

COMMIT;
