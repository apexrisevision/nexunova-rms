-- ============================================================================
-- get_my_feature_flags — caller-scoped feature-flag reader (Phase A2 follow-up)
-- ----------------------------------------------------------------------------
-- Root cause of the "benign 403" firing on EVERY login for EVERY user:
--   js/pages/company-branding.js loadFeatureFlags() called
--   list_company_feature_flags(uuid) — but that RPC is the SUPER-ADMIN console
--   reader: it runs _rms_require_super_admin(), which RAISEs 42501 for any
--   normal user → PostgREST returns HTTP 403. (It is granted to `authenticated`,
--   so the 403 was the in-function super-admin guard, not a missing grant.)
--
-- Fix: a proper per-tenant reader scoped to the CALLER's OWN company via
-- _rms_caller() (never trusts a passed company_id — no cross-tenant read),
-- granted to the app role. company-branding.js now calls this instead.
-- list_company_feature_flags stays super-admin-only for the super-admin console.
--
-- Return shape matches the existing consumer:
--   flags[r.feature_key] = r.enabled !== false;   (column is is_enabled → aliased)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_feature_flags()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_me   public.app_users;
  v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL OR v_me.company_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('feature_key', f.feature_key, 'enabled', f.is_enabled)
           ORDER BY f.feature_key), '[]'::jsonb)
    INTO v_rows
    FROM public.company_feature_flags f
   WHERE f.company_id = v_me.company_id;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_feature_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_feature_flags() TO authenticated, service_role;
