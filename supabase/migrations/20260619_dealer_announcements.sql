-- Dealer "Updates" — admin posts dated notices (rate revisions etc.); sub-dealers
-- read them in their portal like an email inbox. Permanent record: dealers cannot
-- delete. Home company of an umbrella posts group-wide; standalone = own dealers.
-- (Applied live via MCP 2026-06-19; create/update RPCs later widened with
--  p_attachments in 20260619_dealer_announcements_attachments.sql.)

CREATE TABLE IF NOT EXISTS public.sales_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  group_id    uuid REFERENCES public.company_groups(id) ON DELETE SET NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  is_important boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_ann_company ON public.sales_announcements(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_ann_group   ON public.sales_announcements(group_id, created_at DESC);

ALTER TABLE public.sales_announcements ENABLE ROW LEVEL SECURITY;
-- All access via SECURITY DEFINER RPCs only; no anon/auth table policies.

-- per-dealer "last seen" marker drives the unread badge (no per-row read writes)
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS announcements_seen_at timestamptz;

-- ADMIN: delete (admin's own content; dealers can never delete)
CREATE OR REPLACE FUNCTION public.delete_sales_announcement(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_me public.app_users; v_ann public.sales_announcements;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_ann FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_ann.company_id != v_me.company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  DELETE FROM public.sales_announcements WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END; $fn$;

-- PORTAL: mark seen (clears the badge)
CREATE OR REPLACE FUNCTION public.mark_sales_announcements_seen(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.sales_users SET announcements_seen_at=now() WHERE id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true);
END; $fn$;

GRANT EXECUTE ON FUNCTION public.delete_sales_announcement(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sales_announcements_seen(text) TO anon, authenticated;
-- create/update/list_admin/get RPCs: see 20260619_dealer_announcements_attachments.sql
-- (final bodies, with attachments) and 20260619_subdealer_welcome_notification.sql
-- (final get/list bodies, with per-dealer targeting).
