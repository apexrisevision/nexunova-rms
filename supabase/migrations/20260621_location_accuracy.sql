-- GPS accuracy for the Live Map. 2026-06-21. The agent now also reports the GPS
-- accuracy (metres) so the director's map can draw a precision circle around each
-- pin. Back-compat: p_accuracy is optional (old 3/4-arg calls keep working).
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS location_accuracy numeric;

DROP FUNCTION IF EXISTS public.update_my_location(text,numeric,numeric,text);
CREATE OR REPLACE FUNCTION public.update_my_location(
  p_session_token text, p_lat numeric, p_lng numeric,
  p_label text DEFAULT NULL::text, p_accuracy numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success',false,'error','bad_coords'); END IF;
  v_uid := v_ses.sales_user_id;
  UPDATE public.sales_users
     SET lat=p_lat, lng=p_lng,
         location_label = CASE WHEN p_label IS NULL THEN location_label ELSE NULLIF(TRIM(p_label),'') END,
         location_accuracy = COALESCE(p_accuracy, location_accuracy),
         location_at=now(), updated_at=now()
   WHERE id=v_uid;
  IF NOT EXISTS (SELECT 1 FROM public.location_history WHERE sales_user_id=v_uid AND recorded_at > now()-interval '50 seconds') THEN
    INSERT INTO public.location_history(company_id, sales_user_id, lat, lng) VALUES (v_ses.company_id, v_uid, p_lat, p_lng);
  END IF;
  RETURN jsonb_build_object('success',true);
END
$function$;
GRANT EXECUTE ON FUNCTION public.update_my_location(text,numeric,numeric,text,numeric) TO anon, authenticated;

-- expose accuracy on the team-locations feed
CREATE OR REPLACE FUNCTION public.get_team_locations(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_role text; v_pins jsonb; v_key text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT maps_api_key INTO v_key FROM public.app_settings WHERE company_id=v_ses.company_id;
  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE parent_sales_user_id=v_uid AND status='active'
    UNION SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id WHERE su.status='active'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'name', su.full_name, 'role', su.role,
    'lat', su.lat, 'lng', su.lng, 'label', su.location_label, 'at', su.location_at,
    'accuracy', su.location_accuracy, 'is_me', (su.id = v_uid)
  ) ORDER BY su.location_at DESC NULLS LAST), '[]'::jsonb) INTO v_pins
  FROM public.sales_users su
  WHERE (su.id IN (SELECT id FROM sub) OR su.id = v_uid) AND su.lat IS NOT NULL AND su.lng IS NOT NULL;
  RETURN jsonb_build_object('success',true,'pins',v_pins,'maps_api_key',v_key);
END
$function$;
