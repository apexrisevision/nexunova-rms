-- ============================================================================
-- Approving somebody is not the same as making them a sale agent.
-- ----------------------------------------------------------------------------
-- admin_approve_sales_user creates an agents row for everybody it approves: an
-- agent code, a commission percent, a place in the agent reports and in the
-- commission ledger. That is right for the people who sell. It is wrong for the
-- HR manager, the receptionist, the site engineer and the accounts desk, none
-- of whom earn commission and none of whom belong in an agent report.
--
-- It was never hit because the office roles did not exist until today. The very
-- first HR approval would have hit it.
--
-- The test is the one every other part of this uses: lead_role_config says which
-- roles sell. A role that cannot hold a lead gets no agent record and keeps a
-- null agent_id.
--
-- The two functions are shaped differently - one takes p_link_agent_id, the
-- other loops over assignments with `link` - so each gets its own anchor. Both
-- are edited rather than retyped (pg_get_functiondef, one predicate inserted
-- ahead of the existing branch, re-executed) and both are checked afterwards.
-- Applied 2026-08-27.
-- ============================================================================
DO $mig$
DECLARE
  v_def text;
  c1_from constant text := E'  IF p_link_agent_id IS NOT NULL THEN';
  c1_to   constant text :=
       E'  -- An office role is not a sale agent: no agent record, no agent code,\n'
    || E'  -- and nothing in the commission ledger or the agent reports.\n'
    || E'  IF NOT COALESCE((SELECT lrc.can_have_leads FROM public.lead_role_config lrc\n'
    || E'                    WHERE lrc.role = p_role), false) THEN\n'
    || E'    v_agent := NULL;\n'
    || E'  ELSIF p_link_agent_id IS NOT NULL THEN';
  c2_from constant text := E'    IF link IS NOT NULL THEN';
  c2_to   constant text :=
       E'    -- An office role is not a sale agent.\n'
    || E'    IF NOT COALESCE((SELECT lrc.can_have_leads FROM public.lead_role_config lrc\n'
    || E'                      WHERE lrc.role = p_role), false) THEN\n'
    || E'      v_aid := NULL;\n'
    || E'    ELSIF link IS NOT NULL THEN';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='admin_approve_sales_user';
  IF position('v_agent := NULL;' in v_def) = 0 THEN
    IF position(c1_from in v_def) = 0 THEN RAISE EXCEPTION 'admin_approve_sales_user is not shaped as expected'; END IF;
    EXECUTE replace(v_def, c1_from, c1_to);
  END IF;

  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='admin_approve_sales_user_grouped';
  IF position('v_aid := NULL;' in v_def) = 0 THEN
    IF position(c2_from in v_def) = 0 THEN RAISE EXCEPTION 'admin_approve_sales_user_grouped is not shaped as expected'; END IF;
    EXECUTE replace(v_def, c2_from, c2_to);
  END IF;
END $mig$;

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_missing FROM (
    SELECT 'admin_approve_sales_user' AS x WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND proname='admin_approve_sales_user' AND prosrc LIKE '%v_agent := NULL;%')
    UNION ALL
    SELECT 'admin_approve_sales_user_grouped' WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND proname='admin_approve_sales_user_grouped' AND prosrc LIKE '%v_aid := NULL;%')
  ) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'these still make an agent out of every approval: %', v_missing;
  END IF;
END $$;
