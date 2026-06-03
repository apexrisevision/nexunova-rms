-- BATCH H1-b (2026-06-03): close the null/orphan-caller read leak on client/health/blacklist SQL-form readers.
-- Same root cause + fix as H1-a: _rms_caller() RETURNS app_users (composite) yields an all-NULL row for a null caller,
--   so `(me.id IS NULL) OR (...)` evaluates TRUE -> v_all TRUE. Fix = remove the `me.id IS NULL OR` disjunct(s)
--   (no-op for authenticated callers; forces v_all=false + empty v_pids for null callers). COALESCE default -> false for hygiene.
-- Idempotent: only rewrites functions still containing `me.id IS NULL`.
DO $$
DECLARE r record; v_new text; v_cnt int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname IN ('check_client_blacklisted','get_client_by_id','get_client_detail_for_search','get_client_health_history',
        'get_client_health_score','get_client_lite','get_clients_all','list_blacklisted_clients','list_clients_for_search',
        'list_clients_lookup','list_sales_by_client','list_sales_by_client_all')
      AND pg_get_functiondef(p.oid) ~ 'me\.id IS NULL'
  LOOP
    v_new := regexp_replace(r.def,  '\(me\.id IS NULL\)\s+OR\s+', '', 'g');
    v_new := regexp_replace(v_new,  'me\.id IS NULL\s+OR\s+',      '', 'g');
    v_new := regexp_replace(v_new,  '(_rms_caller\(\) me\),\s*)true\)', '\1false)', 'g');
    EXECUTE v_new;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE 'H1-b rewrote % functions', v_cnt;
END $$;
