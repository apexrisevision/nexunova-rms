-- Receipt voucher: "User" is whoever is printing it, not who recorded it
-- (Rashid, 2026-10-14: "User mai wohi aai jis se print liya ja raha hai na k
-- Naseer hee aaye"). printed_by_name = the signed-in RMS login's name.
-- Same access rule as before.

CREATE OR REPLACE FUNCTION public.get_payment_full(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids,
      (SELECT me.full_name FROM public._rms_caller() me) AS v_me_name
  )
  SELECT to_jsonb(p) || jsonb_build_object(
           'printed_by_name', cfg.v_me_name,
           'created_by_name',
           COALESCE(
             (SELECT a.full_name FROM public.app_users a
               WHERE a.company_id = p.company_id AND a.id::text = p.created_by),
             CASE WHEN p.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
                  ELSE NULLIF(btrim(p.created_by), '') END))
    FROM public.payments p CROSS JOIN cfg
  WHERE p.id = p_id AND p.company_id = p_company_id
    AND (cfg.v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = p.sale_id AND s.project_id = ANY(cfg.v_pids)));
$function$;
