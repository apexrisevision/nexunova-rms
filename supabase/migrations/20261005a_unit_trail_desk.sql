-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-05a · Unit trail on the Reserve Desk, before Approve
--
-- Rashid: "reserve desk pe jab mai approve karun unit ko to pehle muje trail
-- show kare k ye unit pehle reserve howa tha, is banday means sale rep ne kiya
-- tha is k liye kia tha, token is mai aaya howa hai ya nahi."
--
-- Why: LG-22 / LG-23 — Yousaf Shah's hold ran out on 19-Sep and the sweep put
-- the units back; on 22-Sep they were approved for Waqar Landlord. The first
-- rep came back and said the units were his. Nothing on the desk showed that
-- the unit had been somebody else's three days earlier.
--
-- The trail itself already exists: _unit_trail_body (20261004a) — every hold
-- and how it ended, every link request, every rupee of token in NexuFinance.
-- Its only door is get_unit_trail, behind the Directors' Room password. The
-- desk signs in with a CRM session instead, so this is a second door onto the
-- SAME body, gated exactly like the request queue it serves
-- (list_reservation_requests / decide_reservation_request):
--   live sales session · not lead_entry · director only ·
--   units of the session's own company, or its dealer group for an umbrella.
--
-- READ ONLY. No table, no column, no trigger, no change to any existing
-- function. _unit_trail_body is called, not copied. Up to 40 units per call
-- (a bulk approve sends the units it is about to book).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_unit_trail_desk(p_session_token text, p_unit_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER   -- reads only
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users;
        v_group uuid; v_companies uuid[]; v_span boolean;
        v_out jsonb := '[]'::jsonb; r record;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token) = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  /* the same gate as the queue: a request is a director's call, and so is
     reading the history that call is made on */
  IF COALESCE(public._sales_role_of(p_session_token),'') <> 'director' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  IF p_unit_ids IS NULL OR cardinality(p_unit_ids) = 0 OR cardinality(p_unit_ids) > 40 THEN
    RETURN jsonb_build_object('success',false,'error','bad_units'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
  IF v_span THEN
    SELECT array_agg(id) INTO v_companies FROM public.companies
     WHERE dealer_group_id = v_group AND status = 'active';
  ELSE v_companies := ARRAY[v_ses.company_id]; END IF;

  /* the unit's own project and company: on every availability link the link's
     company is the unit's company, so this reads the same books the room does */
  FOR r IN SELECT u.id, u.project_id, u.company_id, u.unit_no
             FROM public.units u
            WHERE u.id = ANY(p_unit_ids) AND u.company_id = ANY(v_companies)
            ORDER BY u.unit_no
  LOOP
    v_out := v_out || jsonb_build_array(
      public._unit_trail_body(r.project_id, r.company_id, r.unit_no)
      || jsonb_build_object('unit_id', r.id, 'unit_no', r.unit_no));
  END LOOP;

  RETURN jsonb_build_object('success', true, 'trails', v_out);
END
$function$;

COMMENT ON FUNCTION public.get_unit_trail_desk(text, uuid[]) IS
  'Reserve Desk: the unit trail (_unit_trail_body) for the units a director is about to approve. '
  'Read only. Same gate as list_reservation_requests (live session, director, own company or dealer group).';

REVOKE ALL ON FUNCTION public.get_unit_trail_desk(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unit_trail_desk(text, uuid[]) TO anon, authenticated;

COMMIT;
