-- Authz hardening — Batch 2b: gate remaining company-scoped DELETE/REMOVE RPCs. Source: RPC_AUTHZ_TRIAGE.md.
-- Same null-safe guard as batch 2a (caller-resolve + id IS NULL + tenant IS DISTINCT FROM company param,
-- super-admin bypass). Only the ROLE line differs by group:
--   GROUP A (owner/admin)         — config/recovery/sales-doc/category deletes
--   GROUP B (owner/admin/finance) — money / agent-finance deletes
-- All 15 take a real p_company_id param (remove_client_from_campaign + remove_ip_whitelist_entry too —
-- no derivation needed). None were pre-gated. Signatures, return type, SECURITY DEFINER, search_path,
-- and EXCEPTION/NOT-FOUND logic preserved byte-for-byte; only the guard block + v_me decl are added.

-- ════════════════════════════ GROUP A — owner/admin ════════════════════════════

-- A1. delete_campaign
CREATE OR REPLACE FUNCTION public.delete_campaign(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM recovery_campaigns WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A2. delete_noc
CREATE OR REPLACE FUNCTION public.delete_noc(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT status INTO v_status FROM noc WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','NOC not found'); END IF;
  IF v_status NOT IN ('pending','rejected') THEN
    RETURN jsonb_build_object('success',false,'error','Only pending or rejected NOCs can be deleted');
  END IF;
  DELETE FROM noc WHERE id=p_id AND company_id=p_company_id;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$function$;

-- A3. delete_message_template
CREATE OR REPLACE FUNCTION public.delete_message_template(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM message_templates WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A4. delete_sale_amendment
CREATE OR REPLACE FUNCTION public.delete_sale_amendment(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM sale_amendments WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A5. delete_sale_document
CREATE OR REPLACE FUNCTION public.delete_sale_document(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM sale_documents WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A6. delete_unit_status
CREATE OR REPLACE FUNCTION public.delete_unit_status(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.category_unit_statuses WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- A7. delete_unit_type
CREATE OR REPLACE FUNCTION public.delete_unit_type(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.category_unit_types WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- A8. remove_client_from_campaign  (tenant check on p_company_id; delete keys on all 3 params, preserved)
CREATE OR REPLACE FUNCTION public.remove_client_from_campaign(p_campaign_id uuid, p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM campaign_clients
   WHERE campaign_id = p_campaign_id
     AND client_id  = p_client_id
     AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'removed', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- A9. remove_ip_whitelist_entry  (signature order is (p_company_id, p_id) — preserved)
CREATE OR REPLACE FUNCTION public.remove_ip_whitelist_entry(p_company_id uuid, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM company_ip_whitelists WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ═══════════════════════ GROUP B — owner/admin/finance ═══════════════════════

-- B1. delete_payment_method
CREATE OR REPLACE FUNCTION public.delete_payment_method(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.company_payment_methods WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- B2. delete_pdc_cheque
CREATE OR REPLACE FUNCTION public.delete_pdc_cheque(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM pdc_cheques WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- B3. delete_commission_structure
CREATE OR REPLACE FUNCTION public.delete_commission_structure(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM commission_structures WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Structure not found'); END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- B4. delete_agent_transaction
CREATE OR REPLACE FUNCTION public.delete_agent_transaction(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.agent_transactions WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- B5. delete_agent_commission_payment
CREATE OR REPLACE FUNCTION public.delete_agent_commission_payment(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.agent_commission_payments WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- B6. delete_additional_receivable
CREATE OR REPLACE FUNCTION public.delete_additional_receivable(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.additional_receivables WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;
