-- Email-style attachments (images/files) on dealer announcements + final
-- create/update bodies (5-arg, with p_attachments). Applied live via MCP 2026-06-19.
ALTER TABLE public.sales_announcements
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP FUNCTION IF EXISTS public.create_sales_announcement(uuid,text,text,boolean);
DROP FUNCTION IF EXISTS public.update_sales_announcement(uuid,text,text,boolean);

CREATE OR REPLACE FUNCTION public.create_sales_announcement(
  p_company_id uuid, p_title text, p_body text,
  p_important boolean DEFAULT false, p_attachments jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_me public.app_users; v_group uuid; v_is_home boolean; v_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF coalesce(btrim(p_title),'')='' OR coalesce(btrim(p_body),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','empty','message','Title and message are required.');
  END IF;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=p_company_id;
  v_is_home := v_group IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_groups WHERE id=v_group AND home_company_id=p_company_id);
  INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments, created_by)
  VALUES (p_company_id, CASE WHEN v_is_home THEN v_group ELSE NULL END,
          btrim(p_title), btrim(p_body), coalesce(p_important,false),
          coalesce(p_attachments,'[]'::jsonb), v_me.id)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END; $fn$;

CREATE OR REPLACE FUNCTION public.update_sales_announcement(
  p_id uuid, p_title text, p_body text,
  p_important boolean DEFAULT false, p_attachments jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_me public.app_users; v_ann public.sales_announcements;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_ann FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_ann.company_id != v_me.company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF coalesce(btrim(p_title),'')='' OR coalesce(btrim(p_body),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','empty','message','Title and message are required.');
  END IF;
  UPDATE public.sales_announcements
     SET title=btrim(p_title), body=btrim(p_body), is_important=coalesce(p_important,false),
         attachments=coalesce(p_attachments,'[]'::jsonb), updated_at=now()
   WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END; $fn$;

GRANT EXECUTE ON FUNCTION public.create_sales_announcement(uuid,text,text,boolean,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_sales_announcement(uuid,text,text,boolean,jsonb) TO anon, authenticated;
-- get_sales_announcements / list_sales_announcements_admin final bodies (with
-- attachments + per-dealer targeting) live in 20260619_subdealer_welcome_notification.sql
