-- ══ Awami Market: GF-249 Reserved for Fayaz Bangash, 7 days (20261126c) ══
-- APPLIED 27-Nov-2026 as 20261126193456, on the owner's yes. Expiry = 4-Dec-2026 00:34 PKT.
-- Owner, 26-Nov-2026: "GF249 unit reserve karo for 7 days for fayyaz bangash right now".
-- Booked the way the desk books it (reserve_unit_desk): a new active hold, requester = agent Fayaz Bangash, tag Reserved,
-- expiry now() + 7 days, reserved_by = Rashid; then the unit takes the Reserved tag. No token, no buyer.
-- Stops if the unit is not Available, already has an active hold or a sale, or Fayaz has no WhatsApp number.

DO $m$
DECLARE
  v_co    uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  v_unit  uuid := 'aae71dab-2665-47d0-b1bc-7dffb597173a';   -- GF-249
  v_agent uuid := '5b51f820-29fb-498a-b747-8213fbbb79de';   -- Fayaz Bangash
  v_me    uuid := '015effd0-7ac7-4939-a1b3-dd2826ab8fba';   -- Rashid's sales_user
  v_res_st uuid := 'b15fdc01-0ab9-495a-ae0a-157eeba8543e';  -- Reserved (Awami Market project)
  u public.units; v_name text; v_id uuid;
BEGIN
  PERFORM public._rms_actor('Rashid Manzoor', 'desk');
  SELECT * INTO u FROM public.units WHERE id = v_unit AND company_id = v_co AND unit_no = 'GF-249' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GF-249 not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.category_unit_statuses WHERE id = u.status_id AND is_available) THEN
    RAISE EXCEPTION 'GF-249 is not Available'; END IF;
  IF EXISTS (SELECT 1 FROM public.reservations WHERE unit_id = v_unit AND status = 'active') THEN
    RAISE EXCEPTION 'GF-249 already has an active hold'; END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE unit_id = v_unit AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'GF-249 has a sale'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.category_unit_statuses WHERE id = v_res_st AND project_id = u.project_id
                    AND status_code = 'RESERVED' AND is_active) THEN
    RAISE EXCEPTION 'Reserved status not found for the project'; END IF;
  SELECT full_name INTO v_name FROM public.agents WHERE id = v_agent AND company_id = v_co
     AND public._normalize_pk_mobile(phone) IS NOT NULL;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Fayaz Bangash has no WhatsApp number'; END IF;

  INSERT INTO public.reservations
    (company_id, project_id, unit_id, reserved_by, requested_by_agent_id, requested_by_name,
     expiry_date, token_received, token_amount, note, status, unit_status_id)
  VALUES (u.company_id, u.project_id, v_unit, v_me, v_agent, v_name,
     now() + interval '7 days', false, 0, 'Reserved for 7 days on Rashid''s instruction 26-Nov', 'active', v_res_st)
  RETURNING id INTO v_id;
  UPDATE public.units SET status_id = v_res_st, updated_at = now() WHERE id = v_unit;
  IF NOT EXISTS (SELECT 1 FROM public.reservations WHERE id = v_id AND status = 'active' AND unit_status_id = v_res_st) THEN
    RAISE EXCEPTION 'hold on GF-249 did not stay active and Reserved'; END IF;
END $m$;
