-- ════════════════════════════════════════════════════════════════════════════
-- PER-TENANT META APP CREDENTIALS — each client connects via THEIR OWN app
-- The OAuth Connect flow previously used one platform app (FB_APP_ID/SECRET).
-- In the "bring your own app" model, each company stores its own App ID + App
-- Secret; the fb-oauth Edge Function uses those (platform = fallback only).
-- app_secret is server-side only (RLS deny-all; read by service_role/SECURITY
-- DEFINER); never returned to any UI (get_fb_app_config returns app_id + has_secret).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fb_app_config (
  company_id  uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  app_id      text,
  app_secret  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_app_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fb_app_config' AND policyname='deny_all_anon') THEN
    CREATE POLICY deny_all_anon ON public.fb_app_config FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_fb_app_config(p_session_token text, p_app_id text, p_app_secret text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_aid text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_aid := NULLIF(TRIM(COALESCE(p_app_id,'')),'');
  IF v_aid IS NULL THEN RETURN jsonb_build_object('success',false,'error','app_id_required','message','App ID is required.'); END IF;
  INSERT INTO public.fb_app_config(company_id, app_id, app_secret, updated_at)
  VALUES (v_ses.company_id, v_aid, NULLIF(TRIM(COALESCE(p_app_secret,'')),''), now())
  ON CONFLICT (company_id) DO UPDATE SET
    app_id     = excluded.app_id,
    app_secret = COALESCE(excluded.app_secret, public.fb_app_config.app_secret),
    updated_at = now();
  RETURN jsonb_build_object('success',true);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_fb_app_config(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_aid text; v_has boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT app_id, (app_secret IS NOT NULL AND length(app_secret)>0) INTO v_aid, v_has
    FROM public.fb_app_config WHERE company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'app_id',v_aid,'has_secret',COALESCE(v_has,false));
END; $function$;

GRANT EXECUTE ON FUNCTION public.save_fb_app_config(text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fb_app_config(text)           TO anon, authenticated, service_role;
