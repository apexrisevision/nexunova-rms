-- ════════════════════════════════════════════════════════════════════════
-- CRM — capture the LOST reason (why a lead died) for the trail + analytics.
-- mark_lead_lost: owner-scoped, sets status=lost + lost_reason + a trail entry.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lost_reason text;

CREATE OR REPLACE FUNCTION public.mark_lead_lost(p_session_token text, p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int; v_r text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_r := NULLIF(TRIM(COALESCE(p_reason,'')),'');
  UPDATE public.leads SET status='lost', lost_reason=v_r, last_activity_at=now(), updated_at=now()
   WHERE id=p_id AND owner_sales_user_id=v_ses.sales_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_id, v_ses.sales_user_id, 'stage', 'Lost'||CASE WHEN v_r IS NOT NULL THEN ' — '||v_r ELSE '' END);
  RETURN jsonb_build_object('success',true);
END; $function$;
