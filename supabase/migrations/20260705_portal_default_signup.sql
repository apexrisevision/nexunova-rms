-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — /crm AS THE ONE LINK: sign-in + signup on the main portal | 2026-07-05
-- ------------------------------------------------------------------------
-- Opt-in per company: when enabled, a bare /crm visit (no ?signup=, no /join/)
-- shows the sign-in page WITH "Request access" wired to a default signup target
-- (the company's umbrella token, or the company's own token). Signups stay
-- approval-gated. /join/<CODE>, ?signup= and the QR flow keep working unchanged.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS portal_signup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_signup_scope   text    NOT NULL DEFAULT 'umbrella';  -- 'umbrella' | 'company'

-- Admin: read the main-portal-signup setting -----------------------------
CREATE OR REPLACE FUNCTION public.admin_get_portal_signup(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me public.app_users; v_en boolean; v_scope text; v_gname text; v_ghome boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(portal_signup_enabled,false), COALESCE(portal_signup_scope,'umbrella')
    INTO v_en, v_scope FROM public.companies WHERE id=p_company_id;
  SELECT name INTO v_gname FROM public.company_groups
   WHERE home_company_id=p_company_id AND is_active AND signup_token IS NOT NULL LIMIT 1;
  v_ghome := v_gname IS NOT NULL;
  RETURN jsonb_build_object('success',true,'enabled',v_en,'scope',v_scope,
    'is_umbrella_home',v_ghome,'umbrella_name',v_gname);
END $function$;
GRANT EXECUTE ON FUNCTION public.admin_get_portal_signup(uuid) TO anon, authenticated;

-- Admin: enable/disable + choose target ----------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_portal_signup(p_company_id uuid, p_enabled boolean, p_scope text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me public.app_users; v_scope text; v_ghome boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  v_scope := lower(COALESCE(NULLIF(btrim(p_scope),''),'umbrella'));
  IF v_scope NOT IN ('umbrella','company') THEN v_scope := 'umbrella'; END IF;
  -- coerce to 'company' if this company is not an umbrella home
  SELECT EXISTS(SELECT 1 FROM public.company_groups WHERE home_company_id=p_company_id AND is_active AND signup_token IS NOT NULL) INTO v_ghome;
  IF v_scope='umbrella' AND NOT v_ghome THEN v_scope := 'company'; END IF;
  UPDATE public.companies
     SET portal_signup_enabled=COALESCE(p_enabled,false), portal_signup_scope=v_scope
   WHERE id=p_company_id;
  RETURN jsonb_build_object('success',true,'enabled',COALESCE(p_enabled,false),'scope',v_scope);
END $function$;
GRANT EXECUTE ON FUNCTION public.admin_set_portal_signup(uuid, boolean, text) TO anon, authenticated;

-- Public: resolve the main-portal default signup context (anon, no URL) ---
CREATE OR REPLACE FUNCTION public.get_portal_default_signup()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.companies; v_gname text; v_gtok text;
BEGIN
  SELECT * INTO c FROM public.companies
   WHERE portal_signup_enabled AND status='active'
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','disabled'); END IF;

  IF COALESCE(c.portal_signup_scope,'umbrella')='umbrella' THEN
    SELECT name, signup_token INTO v_gname, v_gtok FROM public.company_groups
     WHERE home_company_id=c.id AND is_active AND signup_token IS NOT NULL LIMIT 1;
    IF v_gtok IS NOT NULL THEN
      RETURN jsonb_build_object('success',true,'umbrella',true,'group_name',v_gname,
        'company_name',c.company_name,'company_code',c.company_code,'signup_token',v_gtok);
    END IF;
  END IF;

  IF c.sales_signup_token IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'umbrella',false,
      'company_name',c.company_name,'company_code',c.company_code,'signup_token',c.sales_signup_token);
  END IF;
  RETURN jsonb_build_object('success',false,'error','no_token');
END $function$;
GRANT EXECUTE ON FUNCTION public.get_portal_default_signup() TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPS: git push (frontend on Vercel) for /crm signup UI + admin card.
-- DB migration applied = RPCs live. No edge fn change.
-- ════════════════════════════════════════════════════════════════════════
