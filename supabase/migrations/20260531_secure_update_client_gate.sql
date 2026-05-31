-- P0 #3: update_client — gate client status/blacklist changes; strip status from the
-- direct non-admin path; add SET search_path. Demographic edits still apply directly.
INSERT INTO public.company_restriction_rules (company_id, action, level)
SELECT c.id, 'client_status', 'soft' FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_restriction_rules r WHERE r.company_id=c.id AND r.action='client_status');

-- Executor: original full update (incl status), internal-only. Adds SET search_path.
CREATE OR REPLACE FUNCTION public._update_client_core(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER; v_cnic TEXT := NULLIF(TRIM(p_data->>'cnic'), ''); v_dup UUID; v_proj UUID;
BEGIN
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_id AND company_id = p_company_id;
  IF (p_data ? 'project_id') AND (p_data->>'project_id') IS NOT NULL
     AND (p_data->>'project_id')::uuid IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'A client cannot be moved to another project. Create a new client instead.'); END IF;
  IF v_cnic IS NOT NULL AND (p_data ? 'cnic') THEN
    SELECT id INTO v_dup FROM public.clients
    WHERE company_id = p_company_id AND project_id = v_proj AND cnic = v_cnic AND id <> p_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered to another client',
        'duplicate_id', v_dup::TEXT, 'duplicate_field', 'cnic'); END IF;
  END IF;
  UPDATE public.clients SET
    full_name            = CASE WHEN p_data ? 'full_name'            THEN COALESCE(NULLIF(p_data->>'full_name',''), full_name)          ELSE full_name            END,
    father_name          = CASE WHEN p_data ? 'father_name'          THEN NULLIF(p_data->>'father_name','')                             ELSE father_name          END,
    cnic                 = CASE WHEN p_data ? 'cnic'                 THEN v_cnic                                                        ELSE cnic                 END,
    passport_no          = CASE WHEN p_data ? 'passport_no'          THEN NULLIF(p_data->>'passport_no','')                             ELSE passport_no          END,
    phone_primary        = CASE WHEN p_data ? 'phone_primary'        THEN COALESCE(NULLIF(p_data->>'phone_primary',''), phone_primary)  ELSE phone_primary        END,
    phone_secondary      = CASE WHEN p_data ? 'phone_secondary'      THEN NULLIF(p_data->>'phone_secondary','')                         ELSE phone_secondary      END,
    whatsapp             = CASE WHEN p_data ? 'whatsapp'             THEN NULLIF(p_data->>'whatsapp','')                                ELSE whatsapp             END,
    email                = CASE WHEN p_data ? 'email'                THEN NULLIF(p_data->>'email','')                                   ELSE email                END,
    address              = CASE WHEN p_data ? 'address'              THEN NULLIF(p_data->>'address','')                                 ELSE address              END,
    city                 = CASE WHEN p_data ? 'city'                 THEN NULLIF(p_data->>'city','')                                    ELSE city                 END,
    country              = CASE WHEN p_data ? 'country'              THEN COALESCE(NULLIF(p_data->>'country',''),'Pakistan')            ELSE country              END,
    occupation           = CASE WHEN p_data ? 'occupation'           THEN NULLIF(p_data->>'occupation','')                              ELSE occupation           END,
    company_name         = CASE WHEN p_data ? 'company_name'         THEN NULLIF(p_data->>'company_name','')                            ELSE company_name         END,
    client_category      = CASE WHEN p_data ? 'client_category'      THEN NULLIF(p_data->>'client_category','')                         ELSE client_category      END,
    reference_by         = CASE WHEN p_data ? 'reference_by'         THEN NULLIF(p_data->>'reference_by','')                            ELSE reference_by         END,
    notes                = CASE WHEN p_data ? 'notes'                THEN NULLIF(p_data->>'notes','')                                   ELSE notes                END,
    status               = CASE WHEN p_data ? 'status'               THEN COALESCE(NULLIF(p_data->>'status',''), 'active')             ELSE status               END,
    client_photo_url     = CASE WHEN p_data ? 'client_photo_url'     THEN NULLIF(p_data->>'client_photo_url','')                        ELSE client_photo_url     END,
    cnic_front_url       = CASE WHEN p_data ? 'cnic_front_url'       THEN NULLIF(p_data->>'cnic_front_url','')                          ELSE cnic_front_url       END,
    cnic_back_url        = CASE WHEN p_data ? 'cnic_back_url'        THEN NULLIF(p_data->>'cnic_back_url','')                           ELSE cnic_back_url        END,
    overseas_local       = CASE WHEN p_data ? 'overseas_local'       THEN COALESCE(NULLIF(p_data->>'overseas_local',''), 'local')       ELSE overseas_local       END,
    next_of_kin_name     = CASE WHEN p_data ? 'next_of_kin_name'     THEN NULLIF(p_data->>'next_of_kin_name','')                        ELSE next_of_kin_name     END,
    next_of_kin_relation = CASE WHEN p_data ? 'next_of_kin_relation' THEN NULLIF(p_data->>'next_of_kin_relation','')                    ELSE next_of_kin_relation END,
    next_of_kin_phone    = CASE WHEN p_data ? 'next_of_kin_phone'    THEN NULLIF(p_data->>'next_of_kin_phone','')                       ELSE next_of_kin_phone    END,
    lead_source          = CASE WHEN p_data ? 'lead_source'          THEN NULLIF(p_data->>'lead_source','')                             ELSE lead_source          END,
    bank_name            = CASE WHEN p_data ? 'bank_name'            THEN NULLIF(p_data->>'bank_name','')                               ELSE bank_name            END,
    bank_account_title   = CASE WHEN p_data ? 'bank_account_title'   THEN NULLIF(p_data->>'bank_account_title','')                      ELSE bank_account_title   END,
    bank_account_no      = CASE WHEN p_data ? 'bank_account_no'      THEN NULLIF(p_data->>'bank_account_no','')                         ELSE bank_account_no      END,
    bank_iban            = CASE WHEN p_data ? 'bank_iban'            THEN NULLIF(p_data->>'bank_iban','')                               ELSE bank_iban            END,
    updated_at           = now()
  WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found or access denied'); END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
REVOKE EXECUTE ON FUNCTION public._update_client_core(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- Internal status-only setter (used by approve_request)
CREATE OR REPLACE FUNCTION public._set_client_status_core(p_id uuid, p_company_id uuid, p_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows int;
BEGIN
  UPDATE public.clients SET status = p_status,
    is_blacklisted = CASE WHEN p_status='blacklisted' THEN true WHEN p_status='active' THEN false ELSE is_blacklisted END,
    updated_at = now()
  WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'client_not_found'); END IF;
  RETURN jsonb_build_object('success', true);
END; $function$;
REVOKE EXECUTE ON FUNCTION public._set_client_status_core(uuid,uuid,text) FROM PUBLIC, anon, authenticated;

-- Gate wrapper
DROP FUNCTION IF EXISTS public.update_client(uuid,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.update_client(p_id uuid, p_company_id uuid, p_data jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_cur_status text; v_project uuid; v_found boolean;
  v_new_status text; v_status_change boolean; v_demo jsonb; v_level text; v_ar jsonb; v_res jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, status, project_id INTO v_found, v_cur_status, v_project
  FROM public.clients WHERE id = p_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found or access denied'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._update_client_core(p_id, p_company_id, p_data);
  END IF;

  v_new_status   := NULLIF(p_data->>'status','');
  v_status_change := (p_data ? 'status') AND (v_new_status IS DISTINCT FROM v_cur_status);

  v_demo := p_data - 'status';
  IF v_demo <> '{}'::jsonb THEN
    v_res := public._update_client_core(p_id, p_company_id, v_demo);
    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RETURN v_res; END IF;
  END IF;

  IF NOT v_status_change THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'client_status');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'client_status');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'clients', p_id::text, 'restriction_warning', true, 'restrictions', 'client_status');
    RETURN public._set_client_status_core(p_id, p_company_id, v_new_status);
  ELSE  -- soft: approval
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message','A reason is required to request a client status change.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','client_status','entity_table','clients','entity_id',p_id,
      'project_id',v_project,'title','Client status change: '||v_new_status,'comment',p_reason,
      'payload',jsonb_build_object('client_id',p_id,'status',v_new_status)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;
GRANT EXECUTE ON FUNCTION public.update_client(uuid,uuid,jsonb,text) TO authenticated;
