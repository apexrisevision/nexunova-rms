-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM push: subscribing turns the member's push pref ON
-- 2026-07-04
-- ------------------------------------------------------------------------
-- Bug found in live test: a member could have push_subscriptions but
-- notify_push=false (the enable-UX flow persisted false when _enablePush
-- failed on ONE device), so _crm_send_push blocked ALL their sends.
-- Fix: a successful subscribe implies the member wants push → set
-- notify_push=true here so a real subscription can never be silently
-- overridden by a stale/false account pref. (Frontend _saveNotif is also
-- fixed to not persist false on a per-device enable failure.)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_push_subscription(p_session_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF p_endpoint IS NULL OR p_p256dh IS NULL OR p_auth IS NULL THEN RETURN jsonb_build_object('success',false,'error','bad_subscription'); END IF;
  INSERT INTO public.push_subscriptions (company_id, sales_user_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_ses.company_id, v_ses.sales_user_id, p_endpoint, p_p256dh, p_auth, p_ua)
  ON CONFLICT (endpoint) DO UPDATE
     SET sales_user_id=EXCLUDED.sales_user_id, company_id=EXCLUDED.company_id,
         p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent, last_seen_at=now();
  -- subscribing on a device means the member wants push → guarantee the account pref is on
  UPDATE public.sales_users SET notify_push=true, updated_at=now()
   WHERE id=v_ses.sales_user_id AND notify_push IS DISTINCT FROM true;
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text, text) TO anon, authenticated;
