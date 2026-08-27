-- ══ What a unit sold for is not for the sales floor ═════════════════════════
--
-- A rep and a marketing manager need the price of what they are selling. What
-- the flat NEXT DOOR went for is a different thing: it is the discount somebody
-- negotiated, and it travels. Only the director, the CFO and the admin see a
-- sold unit's price.
--
-- This is deliberately its own test rather than a narrowing of v_priv inside
-- get_map_unit_detail. v_priv also opens the buyer's name, phone, net, paid and
-- outstanding; that access is untouched. Only the price moves.

CREATE OR REPLACE FUNCTION public._sales_sees_sold_price(p_session_token text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT su.role IN ('director','cfo','admin')
      FROM public.sales_sessions ss
      JOIN public.sales_users su ON su.id = ss.sales_user_id
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
     LIMIT 1), false);
$function$;

REVOKE ALL ON FUNCTION public._sales_sees_sold_price(text) FROM PUBLIC, anon, authenticated;

-- The board: a SOLD row carries no rate unless the caller is one of those three.
DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'get_availability_board' AND pronamespace = 'public'::regnamespace;

  v_old := '''base_price'', CASE WHEN public._sales_sees_prices(p_session_token) THEN u.base_price END,';
  v_new := '''base_price'', CASE WHEN public._sales_sees_prices(p_session_token)'
        || ' AND (st.status_code <> ''SOLD'' OR public._sales_sees_sold_price(p_session_token))'
        || ' THEN u.base_price END,';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'get_availability_board does not gate base_price the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;

-- The map sheet: same rule, so one unit cannot answer two ways.
DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'get_map_unit_detail' AND pronamespace = 'public'::regnamespace;

  v_old := '  IF (v_priv OR v_state <> ''sold'') AND public._sales_sees_prices(p_session_token) THEN';
  v_new := '  IF (public._sales_sees_sold_price(p_session_token) OR v_state <> ''sold'')'
        || ' AND public._sales_sees_prices(p_session_token) THEN';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'get_map_unit_detail does not gate the rate the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;
