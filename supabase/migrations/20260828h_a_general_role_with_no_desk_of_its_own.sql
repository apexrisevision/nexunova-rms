-- ══ "general" — the portal with nothing bolted on ═══════════════════════════
--
-- Every office role so far carries one screen of its own: recovery has the
-- position, accounts has collection, the engineer has the site. Some people
-- need none of that — they need the projects, what is available, the unit map,
-- their own record and the company's messages, and nothing else.
--
-- It is an office role in every other respect, so it inherits all of their
-- restraints without a line being written for it anywhere:
--   * can_have_leads = false      → no lead can be assigned to them, and
--                                    approval creates no sale agent
--   * refused by _sales_may_sell  → reserve_unit and save_unit_quote say no
--   * refused by _sales_sees_prices (below) → no unit rate, sold or unsold
--   * scoped by _portal_own_projects → their own project, never the group

ALTER TABLE public.sales_users DROP CONSTRAINT IF EXISTS sales_users_role_check;
ALTER TABLE public.sales_users ADD CONSTRAINT sales_users_role_check
  CHECK (role = ANY (ARRAY[
    'sale_rep','marketing_manager','admin','cfo','director','lead_entry',
    'accounts','recovery_officer','hr','reception','engineer','general']));

INSERT INTO public.lead_role_config (role, can_have_leads, create_sources)
VALUES ('general', false, '{}')
ON CONFLICT (role) DO UPDATE SET can_have_leads = false;

-- A price is selling information, and this role does not sell.
CREATE OR REPLACE FUNCTION public._sales_sees_prices(p_session_token text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT su.role NOT IN ('accounts','recovery_officer','hr','reception','engineer','general')
      FROM public.sales_sessions ss
      JOIN public.sales_users su ON su.id = ss.sales_user_id
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
     LIMIT 1), false);
$function$;

REVOKE ALL ON FUNCTION public._sales_sees_prices(text) FROM PUBLIC, anon, authenticated;
