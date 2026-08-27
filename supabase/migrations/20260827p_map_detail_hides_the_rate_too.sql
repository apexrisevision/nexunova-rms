-- The Units board no longer sends a rate to the five office desks; the unit map
-- sheet still did, so the same unit answered differently depending on which
-- screen it was opened from. One rule, both doors.
--
-- can_reserve is left exactly as it was: those roles are already refused by
-- _sales_may_sell inside reserve_unit, so nothing here is what stops them.
DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'get_map_unit_detail' AND pronamespace = 'public'::regnamespace;

  v_old := '  IF v_priv OR v_state <> ''sold'' THEN';
  v_new := '  IF (v_priv OR v_state <> ''sold'') AND public._sales_sees_prices(p_session_token) THEN';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'get_map_unit_detail does not gate the price the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;
