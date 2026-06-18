-- ════════════════════════════════════════════════════════════════════════════
-- SALE AGENT AGREEMENT — Phase 4 (backend): admin management.
-- Admin clause editor (add / edit→new version / remove), compliance view, hold
-- release (bypass = admin waives & records method='admin_bypass'; resign = clear
-- hold so the agent signs at next login), and a full signed-record fetch for PDF.
-- All admin-gated via _rms_caller()+_rms_is_admin(). Lives under the "Dealers &
-- Bookings" admin section (consolidation done in the frontend).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_list_agreement_clauses(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  RETURN jsonb_build_object('success',true,'clauses', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',id,'clause_key',clause_key,'seq',seq,'title',title,'body',body,
             'version',version,'effective_from',effective_from) ORDER BY seq, title)
    FROM public.agent_agreement_clauses WHERE company_id=p_company_id AND is_active),'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.admin_list_agreement_clauses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_agreement_clauses(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_agreement_clause(p_company_id uuid, p_title text, p_body text, p_clause_key uuid DEFAULT NULL, p_seq int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_key uuid; v_ver int; v_seq int; v_id uuid; v_edit boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF TRIM(COALESCE(p_title,''))='' OR TRIM(COALESCE(p_body,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','empty','message','Title and text are required.'); END IF;
  v_edit := (p_clause_key IS NOT NULL);
  IF v_edit THEN
    SELECT COALESCE(MAX(version),0)+1, COALESCE(p_seq, MIN(seq)) INTO v_ver, v_seq
      FROM public.agent_agreement_clauses WHERE company_id=p_company_id AND clause_key=p_clause_key;
    v_key := p_clause_key;
    UPDATE public.agent_agreement_clauses SET is_active=false WHERE company_id=p_company_id AND clause_key=p_clause_key;
  ELSE
    v_key := gen_random_uuid(); v_ver := 1;
    SELECT COALESCE(p_seq, COALESCE(MAX(seq),0)+1) INTO v_seq FROM public.agent_agreement_clauses WHERE company_id=p_company_id;
  END IF;
  INSERT INTO public.agent_agreement_clauses (company_id, clause_key, seq, title, body, version, is_active, created_by)
  VALUES (p_company_id, v_key, COALESCE(v_seq,1), TRIM(p_title), TRIM(p_body), v_ver, true, v_me.id)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, changed_by, changed_by_name, new_data, module, reason)
  VALUES (p_company_id,'agent_agreement_clauses',v_id, CASE WHEN v_edit THEN 'UPDATE' ELSE 'INSERT' END,
    v_me.id, COALESCE(v_me.full_name,v_me.username),
    jsonb_build_object('clause_key',v_key,'version',v_ver,'title',TRIM(p_title)),'agreement',
    CASE WHEN v_edit THEN 'Edited agreement clause (new version '||v_ver||') — agents must re-sign' ELSE 'Added new agreement clause' END);
  RETURN jsonb_build_object('success',true,'clause_key',v_key,'version',v_ver,'is_edit',v_edit);
END $function$;
REVOKE ALL ON FUNCTION public.upsert_agreement_clause(uuid,text,text,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_agreement_clause(uuid,text,text,uuid,int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_agreement_clause(p_company_id uuid, p_clause_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_n int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  UPDATE public.agent_agreement_clauses SET is_active=false WHERE company_id=p_company_id AND clause_key=p_clause_key;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, changed_by, changed_by_name, new_data, module, reason)
  VALUES (p_company_id,'agent_agreement_clauses',NULL,'DELETE',v_me.id,COALESCE(v_me.full_name,v_me.username),
    jsonb_build_object('clause_key',p_clause_key),'agreement','Removed agreement clause');
  RETURN jsonb_build_object('success',true,'removed',v_n);
END $function$;
REVOKE ALL ON FUNCTION public.deactivate_agreement_clause(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_agreement_clause(uuid,uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_agreement_compliance(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_total int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COUNT(*) INTO v_total FROM public.agent_agreement_clauses WHERE company_id=p_company_id AND is_active;
  RETURN jsonb_build_object('success',true,'total_clauses',v_total,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sales_user_id',su.id,'name',su.full_name,'phone',su.phone,'status',su.status,
        'hold',COALESCE(su.agreement_hold,false),
        'signed', (SELECT COUNT(*) FROM public.agent_agreement_clauses c
                   WHERE c.company_id=p_company_id AND c.is_active
                     AND EXISTS (SELECT 1 FROM public.agent_agreement_acceptances a
                          WHERE a.sales_user_id=su.id AND a.clause_key=c.clause_key AND a.version=c.version)),
        'pending', (SELECT COUNT(*) FROM public.agent_agreement_clauses c
                   WHERE c.company_id=p_company_id AND c.is_active
                     AND NOT EXISTS (SELECT 1 FROM public.agent_agreement_acceptances a
                          WHERE a.sales_user_id=su.id AND a.clause_key=c.clause_key AND a.version=c.version))
      ) ORDER BY COALESCE(su.agreement_hold,false) DESC, su.full_name)
      FROM public.sales_users su WHERE su.company_id=p_company_id AND su.status IN ('active','pending')
    ),'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.get_agreement_compliance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agreement_compliance(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_agreement_hold(p_company_id uuid, p_sales_user_id uuid, p_mode text DEFAULT 'resign', p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_n int := 0;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF p_mode='bypass' THEN
    INSERT INTO public.agent_agreement_acceptances (company_id, sales_user_id, clause_id, clause_key, version, method, bypassed_by, reason)
    SELECT p_company_id, p_sales_user_id, c.id, c.clause_key, c.version, 'admin_bypass', v_me.id, COALESCE(p_reason,'Admin bypass — agent did not personally agree')
    FROM public.agent_agreement_clauses c
    WHERE c.company_id=p_company_id AND c.is_active
      AND NOT EXISTS (SELECT 1 FROM public.agent_agreement_acceptances a
            WHERE a.sales_user_id=p_sales_user_id AND a.clause_key=c.clause_key AND a.version=c.version)
    ON CONFLICT (sales_user_id, clause_key, version) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  UPDATE public.sales_users SET agreement_hold=false, agreement_hold_reason=NULL, agreement_hold_at=NULL WHERE id=p_sales_user_id AND company_id=p_company_id;
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, changed_by, changed_by_name, new_data, module, reason)
  VALUES (p_company_id,'sales_users',p_sales_user_id,'UPDATE',v_me.id,COALESCE(v_me.full_name,v_me.username),
    jsonb_build_object('op','release_agreement_hold','mode',p_mode,'bypassed_clauses',v_n),'agreement',
    CASE WHEN p_mode='bypass' THEN 'Bypassed agreement — agent admitted without personally agreeing ('||v_n||' clauses)'
         ELSE 'Released hold — agent will be asked to sign at next login' END);
  RETURN jsonb_build_object('success',true,'mode',p_mode,'bypassed',v_n);
END $function$;
REVOKE ALL ON FUNCTION public.release_agreement_hold(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_agreement_hold(uuid,uuid,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_agent_agreement_record(p_company_id uuid, p_sales_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_sales_user_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  RETURN jsonb_build_object('success',true,
    'agent', jsonb_build_object('name',v_su.full_name,'father_name',v_su.father_name,'phone',v_su.phone,'cnic',v_su.cnic,'status',v_su.status,'hold',COALESCE(v_su.agreement_hold,false)),
    'acceptances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('title',c.title,'body',c.body,'version',a.version,
               'accepted_at',a.accepted_at,'method',a.method,'signature_name',a.signature_name,'bypassed',a.bypassed_by IS NOT NULL)
             ORDER BY c.seq, a.accepted_at)
      FROM public.agent_agreement_acceptances a JOIN public.agent_agreement_clauses c ON c.id=a.clause_id
      WHERE a.sales_user_id=p_sales_user_id),'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.get_agent_agreement_record(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_agreement_record(uuid,uuid) TO anon, authenticated;
