-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM push: prune dead subscriptions (404/410 Gone)
-- 2026-07-04
-- ------------------------------------------------------------------------
-- When a push service returns 404/410 the endpoint is permanently dead
-- (unsubscribed / token expired). send-web-push detects this and calls this
-- RPC (with the service-role key) to remove the stale row so dead endpoints
-- don't accumulate and every future fan-out stays clean.
-- Keyed by the opaque unique endpoint; service_role only.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prune_push_subscription(p_endpoint text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF p_endpoint IS NULL OR p_endpoint='' THEN RETURN jsonb_build_object('success',false,'error','no_endpoint'); END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint=p_endpoint;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'pruned',v_n);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.prune_push_subscription(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_push_subscription(text) TO service_role;
