-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-02  B1b — gate the 10 caller-blind, anon-exec report RPCs.
-- They had NO caller/company check and anon EXECUTE -> anyone could read any
-- company's financial reports by passing a company_id. Fix per RPC:
--   1. rename original (SQL body untouched) -> _<name>_core; REVOKE EXECUTE from anon/authenticated/public
--   2. create a plpgsql wrapper (same name+signature+defaults) that resolves _rms_caller(),
--      returns '[]'::jsonb if no session OR (not super_admin AND company_id <> p_company_id),
--      else delegates to _<name>_core
--   3. wrapper EXECUTE granted to authenticated + service_role only (NOT anon)
-- Super-admin keeps cross-company access. No report SQL logic changed.
-- Frontend: reports/viewer.html now awaits sb.auth.getSession() before the report RPC.
-- ════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.get_collection_report(uuid, date, date, uuid, text) RENAME TO _get_collection_report_core;
REVOKE EXECUTE ON FUNCTION public._get_collection_report_core(uuid, date, date, uuid, text) FROM anon, authenticated, public;
CREATE FUNCTION public.get_collection_report(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_collection_report_core(p_company_id, p_from_date, p_to_date, p_project_id, p_status);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_collection_report(uuid, date, date, uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_collection_report(uuid, date, date, uuid, text) TO authenticated, service_role;

ALTER FUNCTION public.get_sales_register(uuid, date, date, uuid, text) RENAME TO _get_sales_register_core;
REVOKE EXECUTE ON FUNCTION public._get_sales_register_core(uuid, date, date, uuid, text) FROM anon, authenticated, public;
CREATE FUNCTION public.get_sales_register(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_sales_register_core(p_company_id, p_from_date, p_to_date, p_project_id, p_status);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_sales_register(uuid, date, date, uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_sales_register(uuid, date, date, uuid, text) TO authenticated, service_role;

ALTER FUNCTION public.get_outstanding_report(uuid, date, date, uuid, text) RENAME TO _get_outstanding_report_core;
REVOKE EXECUTE ON FUNCTION public._get_outstanding_report_core(uuid, date, date, uuid, text) FROM anon, authenticated, public;
CREATE FUNCTION public.get_outstanding_report(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_outstanding_report_core(p_company_id, p_from_date, p_to_date, p_project_id, p_status);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_outstanding_report(uuid, date, date, uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_outstanding_report(uuid, date, date, uuid, text) TO authenticated, service_role;

ALTER FUNCTION public.get_unit_inventory(uuid, date, date, uuid, text) RENAME TO _get_unit_inventory_core;
REVOKE EXECUTE ON FUNCTION public._get_unit_inventory_core(uuid, date, date, uuid, text) FROM anon, authenticated, public;
CREATE FUNCTION public.get_unit_inventory(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_unit_inventory_core(p_company_id, p_from_date, p_to_date, p_project_id, p_status);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_unit_inventory(uuid, date, date, uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_unit_inventory(uuid, date, date, uuid, text) TO authenticated, service_role;

ALTER FUNCTION public.get_aging_report(uuid, uuid) RENAME TO _get_aging_report_core;
REVOKE EXECUTE ON FUNCTION public._get_aging_report_core(uuid, uuid) FROM anon, authenticated, public;
CREATE FUNCTION public.get_aging_report(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_aging_report_core(p_company_id, p_project_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_aging_report(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_aging_report(uuid, uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_project_summary(uuid, uuid) RENAME TO _get_project_summary_core;
REVOKE EXECUTE ON FUNCTION public._get_project_summary_core(uuid, uuid) FROM anon, authenticated, public;
CREATE FUNCTION public.get_project_summary(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_project_summary_core(p_company_id, p_project_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_project_summary(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_project_summary(uuid, uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_tax_wht_report(uuid, uuid) RENAME TO _get_tax_wht_report_core;
REVOKE EXECUTE ON FUNCTION public._get_tax_wht_report_core(uuid, uuid) FROM anon, authenticated, public;
CREATE FUNCTION public.get_tax_wht_report(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_tax_wht_report_core(p_company_id, p_project_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_tax_wht_report(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_tax_wht_report(uuid, uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_post_possession_dues_report(uuid, uuid) RENAME TO _get_post_possession_dues_report_core;
REVOKE EXECUTE ON FUNCTION public._get_post_possession_dues_report_core(uuid, uuid) FROM anon, authenticated, public;
CREATE FUNCTION public.get_post_possession_dues_report(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_post_possession_dues_report_core(p_company_id, p_project_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_post_possession_dues_report(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_post_possession_dues_report(uuid, uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_legal_portfolio(uuid, uuid) RENAME TO _get_legal_portfolio_core;
REVOKE EXECUTE ON FUNCTION public._get_legal_portfolio_core(uuid, uuid) FROM anon, authenticated, public;
CREATE FUNCTION public.get_legal_portfolio(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_legal_portfolio_core(p_company_id, p_project_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_legal_portfolio(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_legal_portfolio(uuid, uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_executive_kpis(uuid, uuid) RENAME TO _get_executive_kpis_core;
REVOKE EXECUTE ON FUNCTION public._get_executive_kpis_core(uuid, uuid) FROM anon, authenticated, public;
CREATE FUNCTION public.get_executive_kpis(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._get_executive_kpis_core(p_company_id, p_project_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_executive_kpis(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_executive_kpis(uuid, uuid) TO authenticated, service_role;
