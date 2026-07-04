-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — SHORT JOIN CODE (human-friendly /join/<CODE> links)  |  2026-07-05
-- ------------------------------------------------------------------------
-- Each company gets an optional short join code (4-12 chars A-Z0-9, unique).
-- /join/<CODE> resolves to that company's signup flow (its sales_signup_token
-- internally). Old ?signup=<token> long links keep working; "Rotate" (existing
-- rotate_sales_signup_token) still invalidates a leaked token — the code is
-- stable, the token rotates behind it.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS sales_join_code text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_sales_join_code
  ON public.companies (sales_join_code) WHERE sales_join_code IS NOT NULL;

-- Admin: read the current join code -------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_join_code(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me public.app_users; v_code text;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT sales_join_code INTO v_code FROM public.companies WHERE id=p_company_id;
  RETURN jsonb_build_object('success',true,'join_code',v_code);
END; $function$;
GRANT EXECUTE ON FUNCTION public.admin_get_join_code(uuid) TO anon, authenticated;

-- Admin: set / change the join code (validated + unique) -----------------
CREATE OR REPLACE FUNCTION public.admin_set_join_code(p_company_id uuid, p_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me public.app_users; v_code text; v_taken boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id <> p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;

  v_code := upper(trim(COALESCE(p_code,'')));
  IF v_code = '' THEN            -- clear the code
    UPDATE public.companies SET sales_join_code=NULL WHERE id=p_company_id;
    RETURN jsonb_build_object('success',true,'join_code',NULL);
  END IF;
  IF v_code !~ '^[A-Z0-9]{4,12}$' THEN
    RETURN jsonb_build_object('success',false,'error','bad_format',
      'message','Use 4–12 letters or numbers (A–Z, 0–9), no spaces.'); END IF;

  SELECT EXISTS(SELECT 1 FROM public.companies WHERE sales_join_code=v_code AND id<>p_company_id) INTO v_taken;
  IF v_taken THEN RETURN jsonb_build_object('success',false,'error','taken',
    'message','That code is already used by another company. Try a different one.'); END IF;

  UPDATE public.companies SET sales_join_code=v_code WHERE id=p_company_id;
  RETURN jsonb_build_object('success',true,'join_code',v_code);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','taken','message','That code was just taken. Try another.');
END; $function$;
GRANT EXECUTE ON FUNCTION public.admin_set_join_code(uuid, text) TO anon, authenticated;

-- Public: resolve /join/<CODE> → company signup context + current token ---
CREATE OR REPLACE FUNCTION public.get_sales_company_by_join_code(p_code text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('success',true,'company_name',company_name,'company_code',company_code,
              'umbrella',false,'signup_token',sales_signup_token)
       FROM public.companies
      WHERE sales_join_code = upper(trim(COALESCE(p_code,''))) AND status='active'
        AND sales_signup_token IS NOT NULL),
    jsonb_build_object('success',false,'error','invalid_code'));
$function$;
GRANT EXECUTE ON FUNCTION public.get_sales_company_by_join_code(text) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPS: vercel.json rewrites (/crm, /join/:code) — need git push to
-- take effect on Vercel. DB migration applied = RPCs live immediately.
-- ════════════════════════════════════════════════════════════════════════
