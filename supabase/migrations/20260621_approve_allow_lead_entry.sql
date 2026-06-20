-- Let admin approve a pending signup DIRECTLY as lead_entry (no temporary sale_rep window).
-- Applied live via MCP (crm_approve_allow_lead_entry). Only the role allowlist in the two approve
-- RPCs changed (…,'director' → …,'director','lead_entry'); all other clamping/security unchanged.
DO $do$
DECLARE src text; sig text;
  oldc text := 'IF p_role NOT IN (''sale_rep'',''marketing_manager'',''admin'',''cfo'',''director'') THEN p_role := ''sale_rep''; END IF;';
  newc text := 'IF p_role NOT IN (''sale_rep'',''marketing_manager'',''admin'',''cfo'',''director'',''lead_entry'') THEN p_role := ''sale_rep''; END IF;';
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.admin_approve_sales_user(uuid,uuid,numeric,uuid,text)',
    'public.admin_approve_sales_user_grouped(uuid,jsonb,text)'
  ] LOOP
    src := pg_get_functiondef(sig::regprocedure);
    IF position(oldc in src) > 0 THEN EXECUTE replace(src, oldc, newc);
    ELSE RAISE EXCEPTION 'allowlist line not found in %', sig; END IF;
  END LOOP;
END $do$;
