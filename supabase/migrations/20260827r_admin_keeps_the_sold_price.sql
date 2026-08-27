-- Correction to 20260827q: admin was wrongly grouped with the sales floor.
-- The people who must not see what a unit sold for are the ones who sell —
-- sale_rep and marketing_manager, because a neighbour's discount travels.
-- Director, CFO and admin keep it.
--
-- The five office desks are already refused every price by _sales_sees_prices,
-- so they never reach this test.
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
