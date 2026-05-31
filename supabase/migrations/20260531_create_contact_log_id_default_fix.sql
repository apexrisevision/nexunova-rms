-- ════════════════════════════════════════════════════════════
-- create_contact_log: backfill id + created_at so save works
-- 2026-05-31. Bug fix.
-- ════════════════════════════════════════════════════════════
-- Reported: "Log Contact" in the Follow-up & Recovery modal wasn't
-- saving. Empirically reproduced as the FMH recovery officer with
-- a representative payload — RPC failed with:
--   23502: null value in column "id" of relation "contact_logs"
--   violates not-null constraint
--
-- Root cause: the RPC builds rows via
--   INSERT INTO public.contact_logs
--   SELECT * FROM jsonb_populate_record(NULL::public.contact_logs, v_enriched)
-- jsonb_populate_record sets every column NOT present in the JSON to
-- NULL — it does NOT honor the column's DEFAULT. So `id` (which has
-- DEFAULT gen_random_uuid()) and `created_at` (DEFAULT now()) come in
-- as NULL when the JS caller omits them (which it correctly does — the
-- client should never generate these). NOT NULL constraint fires.
--
-- Same gotcha as the upsert_unit jsonb_populate_record null-overrides
-- defaults note in NEXUNOVA_RMS_MASTER_CONTEXT.md.
--
-- Fix: backfill id + created_at into v_enriched right before the
-- INSERT if the caller didn't supply them. Body otherwise verbatim
-- (project/client/sale auto-derivation from unit_id preserved).

CREATE OR REPLACE FUNCTION public.create_contact_log(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row jsonb;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_project uuid; v_client uuid; v_sale uuid;
  v_enriched jsonb;
BEGIN
  IF v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
    SELECT s.id, s.client_id INTO v_sale, v_client
      FROM public.sales s
      WHERE s.unit_id = v_unit AND s.company_id = p_company_id AND s.status <> 'cancelled'
      ORDER BY s.sale_date DESC NULLS LAST LIMIT 1;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project),
         'client_id',  COALESCE(NULLIF(p_data->>'client_id','')::uuid,  v_client),
         'sale_id',    COALESCE(NULLIF(p_data->>'sale_id','')::uuid,     v_sale)));

  -- jsonb_populate_record sets unspecified columns to NULL — it does NOT honor
  -- column DEFAULTs (gen_random_uuid() for id, now() for created_at). Backfill
  -- them here when the caller didn't supply them so the NOT NULL constraints
  -- on id + created_at are satisfied.
  IF NULLIF(v_enriched->>'id','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('id', gen_random_uuid());
  END IF;
  IF NULLIF(v_enriched->>'created_at','') IS NULL THEN
    v_enriched := v_enriched || jsonb_build_object('created_at', now());
  END IF;

  INSERT INTO public.contact_logs
  SELECT * FROM jsonb_populate_record(NULL::public.contact_logs, v_enriched)
  RETURNING id INTO v_id;

  SELECT to_jsonb(cl) INTO v_row FROM public.contact_logs cl WHERE cl.id = v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'row', v_row);
END $function$;
