-- Bulk lead import RPC. Applied live via MCP (crm_import_leads_bulk); filed here for the record.
-- Runs EACH row through create_lead → reuses dedupe, _norm_phone, role permissions & source
-- rules (single source of truth). Never aborts the batch; returns per-row results. Cap 500.
CREATE OR REPLACE FUNCTION public.import_leads(p_session_token text, p_rows jsonb, p_default_source text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_cfg public.lead_role_config;
        v_n int; i int; v_row jsonb; v_src text; v_payload jsonb; v_res jsonb;
        v_results jsonb := '[]'::jsonb; v_imp int:=0; v_dup int:=0; v_inv int:=0;
        v_status text; v_reason text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF v_cfg.role IS NULL OR NOT v_cfg.can_have_leads
     OR v_cfg.create_sources IS NULL OR jsonb_array_length(v_cfg.create_sources)=0 THEN
    RETURN jsonb_build_object('success',false,'error','cannot_create',
      'message','Your role can’t create leads, so bulk import isn’t available.'); END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)=0 THEN
    RETURN jsonb_build_object('success',false,'error','bad_input','message','No rows to import.'); END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n>500 THEN RETURN jsonb_build_object('success',false,'error','too_many',
    'message','Import is limited to 500 rows at a time. Split the file and try again.'); END IF;

  FOR i IN 0..v_n-1 LOOP
    v_row := p_rows->i;
    v_src := NULLIF(TRIM(COALESCE(v_row->>'source','')),'');
    IF v_src IS NULL THEN v_src := COALESCE(NULLIF(TRIM(p_default_source),''),'manual'); END IF;
    v_payload := jsonb_build_object(
      'name',     TRIM(COALESCE(v_row->>'name','')),
      'phone',    TRIM(COALESCE(v_row->>'phone','')),
      'source',   v_src,
      'interest', TRIM(COALESCE(v_row->>'interest','')),
      'budget',   TRIM(COALESCE(v_row->>'budget','')),
      'notes',    TRIM(COALESCE(v_row->>'notes','')));
    v_res := public.create_lead(p_session_token, v_payload, false);

    IF (v_res->>'success')::boolean THEN
      v_status:='imported'; v_reason:=NULL; v_imp:=v_imp+1;
    ELSE
      CASE v_res->>'error'
        WHEN 'name_required'       THEN v_status:='invalid';   v_reason:='Missing name';                       v_inv:=v_inv+1;
        WHEN 'duplicate_owned'     THEN v_status:='duplicate'; v_reason:='Already in your pipeline';            v_dup:=v_dup+1;
        WHEN 'duplicate_elsewhere' THEN v_status:='duplicate'; v_reason:='Already exists in the organization';  v_dup:=v_dup+1;
        ELSE v_status:='invalid'; v_reason:=COALESCE(v_res->>'message', v_res->>'error', 'Could not import');   v_inv:=v_inv+1;
      END CASE;
    END IF;

    v_results := v_results || jsonb_build_object(
      'row', i+1, 'name', v_row->>'name', 'phone', v_row->>'phone',
      'status', v_status, 'reason', v_reason, 'lead_id', v_res->>'id');
  END LOOP;

  RETURN jsonb_build_object('success',true,'total',v_n,
    'imported',v_imp,'skipped_duplicate',v_dup,'skipped_invalid',v_inv,'results',v_results);
END; $function$;
GRANT EXECUTE ON FUNCTION public.import_leads(text, jsonb, text) TO anon, authenticated;
