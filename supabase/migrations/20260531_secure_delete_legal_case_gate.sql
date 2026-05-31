-- P0 #4: delete_legal_case — gate deletion through approval; lock executor.
INSERT INTO public.company_restriction_rules (company_id, action, level)
SELECT c.id, 'legal_delete', 'soft' FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_restriction_rules r WHERE r.company_id=c.id AND r.action='legal_delete');

CREATE OR REPLACE FUNCTION public._delete_legal_case_core(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows int;
BEGIN
  DELETE FROM public.legal_cases WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('success', v_rows > 0, 'deleted', v_rows);
END $function$;
REVOKE EXECUTE ON FUNCTION public._delete_legal_case_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.delete_legal_case(uuid,uuid);
CREATE OR REPLACE FUNCTION public.delete_legal_case(p_id uuid, p_company_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_found boolean; v_level text; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT true INTO v_found FROM public.legal_cases WHERE id = p_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'legal_case_not_found'); END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._delete_legal_case_core(p_id, p_company_id);
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'legal_delete');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'legal_delete');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'legal_cases', p_id::text, 'restriction_warning', true, 'restrictions', 'legal_delete');
    RETURN public._delete_legal_case_core(p_id, p_company_id);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request legal case deletion.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','legal_delete','entity_table','legal_cases','entity_id',p_id,
      'title','Legal case deletion','comment',p_reason,
      'payload',jsonb_build_object('case_id',p_id)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.delete_legal_case(uuid,uuid,text) TO authenticated;
