-- BATCH H1-a (2026-06-03): close the null/orphan-caller read leak on agent/commission SQL-form readers.
-- ROOT CAUSE: public._rms_caller() is declared RETURNS app_users (a composite, NOT setof), so for a caller with no
--   active app_users row it returns ONE all-NULL row (not zero rows). Thus `(SELECT (me.id IS NULL) OR (...) FROM
--   _rms_caller() me)` evaluates `(me.id IS NULL)` = TRUE -> v_all = TRUE, regardless of the COALESCE default. A
--   true->false change alone is therefore a no-op for null safety.
-- FIX: remove the permissive `me.id IS NULL OR` disjunct(s) (both parenthesized and bare forms). For an authenticated
--   caller `me.id IS NULL` is false, so removal is a no-op for them; for a null/orphan caller v_all becomes false and
--   v_pids is empty -> the row gate `(v_all OR project_id = ANY(v_pids))` yields nothing. COALESCE default also set to
--   false for hygiene. The admin tenant-bind (me.company_id = p_company_id) is unchanged.
-- Idempotent: only rewrites functions whose body still contains `me.id IS NULL`.
DO $$
DECLARE r record; v_new text; v_cnt int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname IN ('get_agent_detail_for_search','get_agent_extended','get_agent_full','get_agent_lite',
        'get_agent_name','get_commissions_overview','list_agent_commission_payments','list_agent_commissions_with_agent',
        'list_agent_transactions','list_agents_for_fnav','list_agents_for_reports','list_agents_for_search',
        'list_agents_lookup','list_sub_agents','list_sales_by_agent')
      AND pg_get_functiondef(p.oid) ~ 'me\.id IS NULL'
  LOOP
    v_new := regexp_replace(r.def,  '\(me\.id IS NULL\)\s+OR\s+', '', 'g');
    v_new := regexp_replace(v_new,  'me\.id IS NULL\s+OR\s+',      '', 'g');
    v_new := regexp_replace(v_new,  '(_rms_caller\(\) me\),\s*)true\)', '\1false)', 'g');
    EXECUTE v_new;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE 'H1-a corrected: rewrote % functions', v_cnt;
END $$;
