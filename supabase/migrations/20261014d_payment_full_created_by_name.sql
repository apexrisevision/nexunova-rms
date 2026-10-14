-- Receipt voucher: show WHO recorded the payment by login name, not the raw id
-- (Rashid, 2026-10-14: "is mai wo aaye k kis k login se ye receipt bani hai
-- suppose Amar, Naseer, ya Awami").
-- payments.created_by is text: an app_users id for anything made in the RMS
-- (record_payment_simple, the SAF sale), older rows may hold a name. Same
-- access rule as before; only created_by_name is added.

CREATE OR REPLACE FUNCTION public.get_payment_full(p_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT to_jsonb(p) || jsonb_build_object('created_by_name',
           COALESCE(
             (SELECT a.full_name FROM public.app_users a
               WHERE a.company_id = p.company_id AND a.id::text = p.created_by),
             CASE WHEN p.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
                  ELSE NULLIF(btrim(p.created_by), '') END))
    FROM public.payments p CROSS JOIN cfg
  WHERE p.id = p_id AND p.company_id = p_company_id
    AND (cfg.v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = p.sale_id AND s.project_id = ANY(cfg.v_pids)));
$function$;
