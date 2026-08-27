-- ══ Approving an office role broke the umbrella path ════════════════════════
--
-- 20260827i stopped creating an agents row for a role that does not sell, which
-- is right. What it missed: the very next statement writes that agent id into
-- dealer_company_agents, whose agent_id is NOT NULL. So approving anyone as HR,
-- accounts, recovery, reception or engineer raised
--   null value in column "agent_id" ... violates not-null constraint
-- and the desktop showed the bare "Approval failed".
--
-- dealer_company_agents exists to map a portal member to their agent record in
-- each member company. Someone with no agent record has nothing to map, so the
-- row is not written at all — and any stale mapping from an earlier approval as
-- a seller is removed rather than left pointing at an agent they no longer are.

DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'admin_approve_sales_user_grouped'
                   AND pronamespace = 'public'::regnamespace;

  v_old := '    INSERT INTO public.dealer_company_agents (group_id, sales_user_id, company_id, agent_id)
    VALUES (v_group, p_id, comp, v_aid)
    ON CONFLICT (sales_user_id, company_id) DO UPDATE SET agent_id=EXCLUDED.agent_id;';

  v_new := '    -- No agent record, nothing to map. agent_id is NOT NULL here, so writing
    -- the row anyway is what made every office-role approval fail.
    IF v_aid IS NOT NULL THEN
      INSERT INTO public.dealer_company_agents (group_id, sales_user_id, company_id, agent_id)
      VALUES (v_group, p_id, comp, v_aid)
      ON CONFLICT (sales_user_id, company_id) DO UPDATE SET agent_id=EXCLUDED.agent_id;
    ELSE
      DELETE FROM public.dealer_company_agents
       WHERE sales_user_id = p_id AND company_id = comp;
    END IF;';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'admin_approve_sales_user_grouped does not write the mapping the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;
