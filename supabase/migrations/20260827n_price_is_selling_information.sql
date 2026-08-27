-- ══ A price is selling information ══════════════════════════════════════════
--
-- The office roles were already refused the reserved/sold distinction on the
-- Units board. The rate was still going out with every unit — and hiding it in
-- the page would have left it sitting in the network response for anyone who
-- opened the developer tools. So it is withheld where it is read, in the two
-- RPCs that send it.
--
-- The rule is NOT _sales_may_sell. That returns false for admin and cfo too,
-- and a CFO blinded to the price list would be a worse bug than the one being
-- fixed. This names the five desks that do not sell and never quote.

CREATE OR REPLACE FUNCTION public._sales_sees_prices(p_session_token text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT su.role NOT IN ('accounts','recovery_officer','hr','reception','engineer')
      FROM public.sales_sessions ss
      JOIN public.sales_users su ON su.id = ss.sales_user_id
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
     LIMIT 1), false);
$function$;

REVOKE ALL ON FUNCTION public._sales_sees_prices(text) FROM PUBLIC, anon, authenticated;

-- The board: the rate leaves the row entirely for those desks, sold or unsold.
DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'get_availability_board' AND pronamespace = 'public'::regnamespace;

  v_old := '''base_price'', u.base_price,';
  v_new := '''base_price'', CASE WHEN public._sales_sees_prices(p_session_token) THEN u.base_price END,';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'get_availability_board no longer sends base_price the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;
