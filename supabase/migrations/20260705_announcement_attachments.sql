-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM announcements: private attachments (edge-fn gatekeeper)
-- 2026-07-05  (Phase 2)
-- ------------------------------------------------------------------------
-- Announcement files (jpg/png/webp/pdf, ≤5 files, ≤10MB each) live in a PRIVATE
-- bucket. The sales portal is anon (sales_sessions, no GoTrue) so storage RLS
-- can't gate members — instead the `announcement-file` edge function is the sole
-- gatekeeper: it validates the session (director for upload; targeted recipient/
-- author for read) via the two RPCs below, then uses the service role to store /
-- issue a short-lived signed URL. Attachments are stored as
-- {path,name,size,type} in sales_announcements.attachments (legacy {url,...}
-- public entries still render directly for backward compatibility).
-- ════════════════════════════════════════════════════════════════════════

-- 1) private bucket -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('announcement-files','announcement-files', false)
ON CONFLICT (id) DO NOTHING;

-- 2) upload auth: session must be an active director → returns company_id ----
CREATE OR REPLACE FUNCTION public.ann_attach_upload_ok(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  RETURN jsonb_build_object('ok',true,'company_id',v_ses.company_id);
END $function$;
REVOKE ALL ON FUNCTION public.ann_attach_upload_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ann_attach_upload_ok(text) TO service_role;

-- 3) read auth: caller is a recipient/author AND the path belongs to the ann --
CREATE OR REPLACE FUNCTION public.ann_attach_read_ok(p_session_token text, p_announcement_id uuid, p_path text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; a public.sales_announcements; v_path_ok boolean; v_access boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','session_expired'); END IF;
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_announcement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;

  -- the path must actually be one of this announcement's attachments
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.attachments,'[]'::jsonb)) e WHERE e->>'path'=p_path)
    INTO v_path_ok;
  IF NOT v_path_ok THEN RETURN jsonb_build_object('ok',false,'error','bad_path'); END IF;

  -- caller must be the author or a targeted recipient
  v_access := (a.author_sales_user_id = v_ses.sales_user_id)
           OR EXISTS (SELECT 1 FROM public._ann_recipients(a.id) r WHERE r.sales_user_id = v_ses.sales_user_id);
  RETURN jsonb_build_object('ok', v_access);
END $function$;
REVOKE ALL ON FUNCTION public.ann_attach_read_ok(text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ann_attach_read_ok(text,uuid,text) TO service_role;

-- Deploy dep: supabase functions deploy announcement-file --no-verify-jwt
