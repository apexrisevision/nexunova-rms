-- ══ Moving off the sales floor retires the agent record ═════════════════════
--
-- Approval already refuses to create an agent for a role that does not sell.
-- Changing a role AFTERWARDS did not undo one, so Amar Taj (director →
-- accounts) and Maria Lodhi (→ recovery officer) were still sale agents in
-- three companies each: in the agents list, in the agent reports, and eligible
-- for commission they can never earn.
--
-- Nothing is deleted. An agent row is only ever set inactive, and only when it
-- carries nothing at all — no sale, no submission, no commission payment, no
-- transaction, no cancellation, no unit change, no sub-agent, and no other
-- portal user pointing at it. An agent with any history stays exactly as it is
-- and the caller is told, because a role change is not a reason to rewrite the
-- books.

CREATE OR REPLACE FUNCTION public._retire_sale_agent(p_agent_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_agent_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.sales                     x WHERE x.agent_id        = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.sale_submissions          x WHERE x.agent_id        = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.agent_commission_payments x WHERE x.agent_id        = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.agent_transactions        x WHERE x.agent_id        = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.unit_cancellations        x WHERE x.agent_id        = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.unit_changes              x WHERE x.agent_id        = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.agents                    x WHERE x.parent_agent_id = p_agent_id)
  OR EXISTS (SELECT 1 FROM public.sales_users               x WHERE x.agent_id        = p_agent_id)
  THEN
    RETURN false;                       -- it carries history: leave it alone
  END IF;

  UPDATE public.agents SET status = 'inactive', updated_at = now()
   WHERE id = p_agent_id AND status <> 'inactive';
  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public._retire_sale_agent(uuid) FROM PUBLIC, anon, authenticated;

-- Take a portal member off the sales floor: drop the company mappings, unhook
-- the agent from the login, then retire whatever is left unused.
CREATE OR REPLACE FUNCTION public._portal_drop_sale_agent(p_sales_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a uuid; v_ids uuid[] := '{}'; v_retired int := 0; v_kept int := 0;
BEGIN
  SELECT array_agg(DISTINCT x) INTO v_ids FROM (
    SELECT d.agent_id AS x FROM public.dealer_company_agents d WHERE d.sales_user_id = p_sales_user_id
    UNION
    SELECT su.agent_id     FROM public.sales_users su WHERE su.id = p_sales_user_id AND su.agent_id IS NOT NULL
  ) q WHERE x IS NOT NULL;

  DELETE FROM public.dealer_company_agents WHERE sales_user_id = p_sales_user_id;
  UPDATE public.sales_users SET agent_id = NULL WHERE id = p_sales_user_id;

  IF v_ids IS NOT NULL THEN
    FOREACH a IN ARRAY v_ids LOOP
      IF public._retire_sale_agent(a) THEN v_retired := v_retired + 1; ELSE v_kept := v_kept + 1; END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('retired', v_retired, 'kept_with_history', v_kept);
END $function$;

REVOKE ALL ON FUNCTION public._portal_drop_sale_agent(uuid) FROM PUBLIC, anon, authenticated;

-- From now on, a role change does it by itself.
DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='set_sales_user_role' AND pronamespace='public'::regnamespace;

  v_old := '  RETURN jsonb_build_object(''success'',true,''role'',p_role);';
  v_new := '  -- A role that cannot sell is not a sale agent. Nothing with history is
  -- touched; _retire_sale_agent refuses those and reports them back.
  IF NOT COALESCE((SELECT lrc.can_have_leads FROM public.lead_role_config lrc
                    WHERE lrc.role = p_role), false) THEN
    RETURN jsonb_build_object(''success'',true,''role'',p_role,
                              ''agent'', public._portal_drop_sale_agent(p_id));
  END IF;

  RETURN jsonb_build_object(''success'',true,''role'',p_role);';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'set_sales_user_role does not return the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;

-- Clear anyone already in that state.
DO $do$
DECLARE r record; res jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT su.id, su.full_name
      FROM public.sales_users su
     WHERE su.role IN ('accounts','recovery_officer','hr','reception','engineer')
       AND (su.agent_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.dealer_company_agents d WHERE d.sales_user_id = su.id))
  LOOP
    res := public._portal_drop_sale_agent(r.id);
    RAISE NOTICE 'retired sale agent for % → %', r.full_name, res;
  END LOOP;
END $do$;
