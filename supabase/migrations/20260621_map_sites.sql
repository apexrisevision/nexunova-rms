-- Geofence sites for the Live Map. 2026-06-21. The director marks project sites /
-- office locations; the map shows who is inside each site and the nearest agent.
-- Director-only management; RLS-on (access via SECURITY DEFINER RPCs).
CREATE TABLE IF NOT EXISTS public.map_sites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  lat        numeric NOT NULL,
  lng        numeric NOT NULL,
  radius_m   integer NOT NULL DEFAULT 200 CHECK (radius_m BETWEEN 20 AND 20000),
  created_by uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_map_sites_company ON public.map_sites (company_id);
ALTER TABLE public.map_sites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._site_director(p_session_token text)
RETURNS public.sales_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN NULL; END IF;
  RETURN v_ses;
END $function$;

CREATE OR REPLACE FUNCTION public.add_map_site(p_session_token text, p_name text, p_lat numeric, p_lng numeric, p_radius integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_id uuid; v_r int;
BEGIN
  v_ses := public._site_director(p_session_token);
  IF v_ses.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF coalesce(btrim(p_name),'')='' THEN RETURN jsonb_build_object('success',false,'error','name_required'); END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success',false,'error','bad_coords'); END IF;
  v_r := LEAST(20000, GREATEST(20, COALESCE(p_radius,200)));
  INSERT INTO public.map_sites(company_id,name,lat,lng,radius_m,created_by)
  VALUES (v_ses.company_id, btrim(p_name), p_lat, p_lng, v_r, v_ses.sales_user_id)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END $function$;
REVOKE ALL ON FUNCTION public.add_map_site(text,text,numeric,numeric,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_map_site(text,text,numeric,numeric,integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_map_sites(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb;
BEGIN
  v_ses := public._site_director(p_session_token);
  IF v_ses.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'lat',lat,'lng',lng,'radius_m',radius_m) ORDER BY name),'[]'::jsonb)
    INTO v_rows FROM public.map_sites WHERE company_id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'sites',v_rows);
END $function$;
REVOKE ALL ON FUNCTION public.list_map_sites(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_map_sites(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_map_site(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int;
BEGIN
  v_ses := public._site_director(p_session_token);
  IF v_ses.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  DELETE FROM public.map_sites WHERE id=p_id AND company_id=v_ses.company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', v_n>0);
END $function$;
REVOKE ALL ON FUNCTION public.delete_map_site(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_map_site(text,uuid) TO anon, authenticated;
