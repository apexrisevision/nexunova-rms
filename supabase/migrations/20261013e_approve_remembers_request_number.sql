-- ─────────────────────────────────────────────────────────────────────────────
-- APPROVING A LINK REQUEST REMEMBERS THE NUMBER ON IT  (2026-10-13)
--
-- 20261013d made the desk's booking refuse a requester with no WhatsApp number
-- on record. Approving a request from the link books through the same
-- reserve_unit_desk, but did not pass on the number the dealer typed on the
-- request (requested_by_phone, already required and validated there). So
-- Rashid approving Waqar Landlord's request (03139851347 on it, agent record
-- empty) was refused with "Add a WhatsApp number".
--
-- Now decide_reservation_request saves the request's number to the hold
-- contacts list under every name the booking can resolve to (the name on the
-- request, and the agent's / member's name if one was picked) before it books
-- — unless that name already has a number there, which is left as it is. The
-- number is then remembered for the desk's own bookings too.
--
-- Patched from pg_get_functiondef() on live at a fixed anchor; RAISES if the
-- anchor is not there exactly once. Re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  v_sig constant regprocedure := 'public.decide_reservation_request(text,uuid,text,uuid,uuid,uuid)'::regprocedure;
  v_anchor constant text := E'  v_res := public.reserve_unit_desk(\n';
  v_add constant text :=
       E'  -- 20261013e: the number on the request is remembered for the names it books under\n'
    || E'  IF regexp_replace(COALESCE(v_req.requested_by_phone, ''''), ''[^0-9]'', '''', ''g'') ~ ''^(03[0-9]{9}|923[0-9]{9})$'' THEN\n'
    || E'    INSERT INTO public.availability_hold_contacts (project_id, name_key, name, phone, updated_at)\n'
    || E'    SELECT DISTINCT ON (public._hold_name_key(n.nm)) u.project_id, public._hold_name_key(n.nm), btrim(n.nm),\n'
    || E'           regexp_replace(regexp_replace(v_req.requested_by_phone, ''[^0-9]'', '''', ''g''), ''^0'', ''92''), now()\n'
    || E'      FROM public.units u,\n'
    || E'           (SELECT v_req.requested_by_name AS nm\n'
    || E'            UNION ALL SELECT a.full_name FROM public.agents a WHERE a.id = p_requested_by_agent_id\n'
    || E'            UNION ALL SELECT s.full_name FROM public.sales_users s WHERE s.id = p_requested_by_sales_user_id) n\n'
    || E'     WHERE u.id = v_req.unit_id AND NULLIF(btrim(n.nm), '''') IS NOT NULL AND public._hold_name_key(n.nm) <> ''''\n'
    || E'    ON CONFLICT (project_id, name_key) DO NOTHING;\n'
    || E'  END IF;\n\n';
  v_def text;
BEGIN
  v_def := pg_get_functiondef(v_sig);
  IF position('20261013e' IN v_def) > 0 THEN RETURN; END IF;     -- already applied
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'decide_reservation_request: anchor not found exactly once'; END IF;
  EXECUTE replace(v_def, v_anchor, v_add || v_anchor);
END
$mig$;
