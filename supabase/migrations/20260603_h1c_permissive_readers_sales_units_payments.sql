-- BATCH H1-c (2026-06-03): close the null/orphan-caller read leak on sales/units/payments/pdc/installments/projects/
--   categories SQL-form readers (28). Same root cause + fix as H1-a/H1-b: _rms_caller() RETURNS app_users (composite)
--   yields an all-NULL row for a null caller, so `(me.id IS NULL) OR (...)` evaluates TRUE -> v_all TRUE. Fix = remove
--   the `me.id IS NULL OR` disjunct(s) (no-op for authenticated callers; forces v_all=false + empty v_pids for null callers).
--   COALESCE default -> false for hygiene. NOTE: list_sale_types is anon-executable; its anon grant is vestigial
--   (frontend calls it only from the authenticated app layer), and after this fix an anon/null caller gets an empty result.
-- Idempotent: only rewrites functions still containing `me.id IS NULL`.
DO $$
DECLARE r record; v_new text; v_cnt int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname IN ('get_active_sale_for_unit','get_active_sale_for_unit_full','get_installment_for_edit','get_payment_full',
        'get_payments_for_unit','get_sale_documents_amendments','get_sale_for_lookup','get_sale_quick_edit','get_sale_unit_id',
        'get_sales_unit_map','get_unit_sales_count','get_units_all','get_units_by_project','list_open_installments_for_sale',
        'list_payment_promises_by_unit','list_payments_by_sale_full','list_payments_for_sale','list_payments_for_sale_full',
        'list_payments_for_search','list_payments_with_sales_unit','list_pdc_for_sale','list_projects','list_sales_for_fnav',
        'list_sales_lookup','list_sold_unit_ids','list_unit_statuses','list_unit_types','list_sale_types')
      AND pg_get_functiondef(p.oid) ~ 'me\.id IS NULL'
  LOOP
    v_new := regexp_replace(r.def,  '\(me\.id IS NULL\)\s+OR\s+', '', 'g');
    v_new := regexp_replace(v_new,  'me\.id IS NULL\s+OR\s+',      '', 'g');
    v_new := regexp_replace(v_new,  '(_rms_caller\(\) me\),\s*)true\)', '\1false)', 'g');
    EXECUTE v_new;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE 'H1-c rewrote % functions', v_cnt;
END $$;
