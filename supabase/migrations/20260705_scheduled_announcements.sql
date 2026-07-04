-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM announcements: SCHEDULED publish (+ ack pin polish is FE)
-- 2026-07-05
-- ------------------------------------------------------------------------
-- Directors can schedule an announcement for a future date/time (Asia/Karachi).
-- Scheduled ones are invisible to targets until published; the author sees them
-- in a "Scheduled" list (edit/cancel until publish time). A 5-min cron publishes
-- due ones and fires push exactly like a normal publish (urgent bypasses quiet
-- hours; normal/important queue to 08:00 via the existing push drain — a4172a6).
-- ════════════════════════════════════════════════════════════════════════

-- 1) schedule columns -----------------------------------------------------
ALTER TABLE public.sales_announcements
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- 2) post_announcement — now accepts an optional Asia/Karachi schedule --------
-- drop the old 8-arg signature so the new 9-arg one isn't an ambiguous overload
DROP FUNCTION IF EXISTS public.post_announcement(text,text,text,text,text,text,boolean,jsonb);
CREATE OR REPLACE FUNCTION public.post_announcement(p_session_token text, p_title text, p_body text, p_priority text DEFAULT 'normal'::text, p_target_type text DEFAULT 'all'::text, p_target_value text DEFAULT NULL::text, p_requires_ack boolean DEFAULT false, p_attachments jsonb DEFAULT '[]'::jsonb, p_scheduled_at text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_id uuid; v_tv text; v_sched timestamptz; v_future boolean;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden','message','Only a director can post announcements.'); END IF;
  IF coalesce(btrim(p_title),'')='' OR coalesce(btrim(p_body),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','empty','message','Title and message are required.'); END IF;
  IF p_priority NOT IN ('normal','important','urgent') THEN p_priority := 'normal'; END IF;
  IF p_target_type NOT IN ('all','role','team','user') THEN
    RETURN jsonb_build_object('success',false,'error','bad_target'); END IF;
  v_tv := NULLIF(btrim(COALESCE(p_target_value,'')),'');
  IF p_target_type='role' THEN
    IF v_tv IS NULL OR v_tv NOT IN ('sale_rep','marketing_manager','director','cfo','admin','lead_entry') THEN
      RETURN jsonb_build_object('success',false,'error','bad_role'); END IF;
  ELSIF p_target_type IN ('team','user') THEN
    IF v_tv IS NULL OR NOT EXISTS (SELECT 1 FROM public.sales_users WHERE id=v_tv::uuid AND company_id=v_ses.company_id) THEN
      RETURN jsonb_build_object('success',false,'error','bad_target_user'); END IF;
  ELSE
    v_tv := NULL;
  END IF;

  -- interpret the schedule string as Asia/Karachi local time
  IF NULLIF(btrim(COALESCE(p_scheduled_at,'')),'') IS NOT NULL THEN
    BEGIN
      v_sched := (btrim(p_scheduled_at))::timestamp AT TIME ZONE 'Asia/Karachi';
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success',false,'error','bad_schedule','message','Could not read the schedule date/time.');
    END;
  END IF;
  v_future := (v_sched IS NOT NULL AND v_sched > now());

  INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments,
        priority, target_type, target_value, author_sales_user_id, requires_ack, push_enabled,
        is_published, scheduled_at, published_at)
  VALUES (v_ses.company_id, NULL, btrim(p_title), btrim(p_body),
          (p_priority IN ('important','urgent')), COALESCE(p_attachments,'[]'::jsonb),
          p_priority, p_target_type, v_tv, v_ses.sales_user_id, COALESCE(p_requires_ack,false), true,
          NOT v_future, CASE WHEN v_future THEN v_sched ELSE NULL END, CASE WHEN v_future THEN NULL ELSE now() END)
  RETURNING id INTO v_id;

  IF v_future THEN
    RETURN jsonb_build_object('success',true,'id',v_id,'scheduled',true,'scheduled_at',v_sched);
  END IF;

  -- publish now → push (urgent bypasses quiet; normal/important queue to daytime cron)
  PERFORM public._announcement_push(v_id, (p_priority='urgent'));
  RETURN jsonb_build_object('success',true,'id',v_id);
END $function$;
REVOKE ALL ON FUNCTION public.post_announcement(text,text,text,text,text,text,boolean,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_announcement(text,text,text,text,text,text,boolean,jsonb,text) TO anon, authenticated;

-- 3) get_sales_announcements — INBOX shows PUBLISHED only (scheduled hidden) ---
CREATE OR REPLACE FUNCTION public.get_sales_announcements(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_group uuid; v_role text; v_uid uuid;
        v_rows jsonb; v_unread int; v_unread_ann int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;

  WITH vis AS (
    SELECT a.* FROM public.sales_announcements a
    WHERE a.is_active
      AND a.is_published                                   -- scheduled/unpublished never show in the inbox
      AND NOT (a.kind='followup' AND a.created_at < now() - interval '3 days')
      AND NOT (a.kind='system'   AND a.created_at < now() - interval '30 days')
      AND (
        a.author_sales_user_id = v_uid
        OR a.sales_user_id = v_uid
        OR (a.sales_user_id IS NULL AND (
             (a.target_type='all'  AND (a.company_id=v_ses.company_id OR (v_group IS NOT NULL AND a.group_id=v_group)))
             OR (a.target_type='role' AND a.company_id=v_ses.company_id AND v_role = a.target_value)
             OR (a.target_type='user' AND a.target_value = v_uid::text)
             OR (a.target_type='team' AND v_uid IN (
                   WITH RECURSIVE sub AS (
                     SELECT id FROM public.sales_users WHERE id=NULLIF(a.target_value,'')::uuid
                     UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
                   ) SELECT id FROM sub))
        ))
      )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'kind', a.kind,
    'priority', a.priority, 'is_important', a.is_important, 'attachments', a.attachments,
    'created_at', a.created_at,
    'author_name', COALESCE(au.full_name, 'Your company'),
    'is_author', (a.author_sales_user_id = v_uid),
    'requires_ack', a.requires_ack,
    'seen', (r.seen_at IS NOT NULL), 'seen_at', r.seen_at,
    'acknowledged', (r.acknowledged_at IS NOT NULL), 'acknowledged_at', r.acknowledged_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb),
  count(*) FILTER (WHERE a.author_sales_user_id IS DISTINCT FROM v_uid AND r.seen_at IS NULL),
  count(*) FILTER (WHERE a.kind='announcement' AND a.author_sales_user_id IS DISTINCT FROM v_uid AND r.seen_at IS NULL)
    INTO v_rows, v_unread, v_unread_ann
  FROM vis a
  LEFT JOIN public.announcement_receipts r ON r.announcement_id=a.id AND r.sales_user_id=v_uid
  LEFT JOIN public.sales_users au ON au.id=a.author_sales_user_id;

  RETURN jsonb_build_object('success',true,'announcements',v_rows,
    'unread',COALESCE(v_unread,0),'unread_announcements',COALESCE(v_unread_ann,0));
END $function$;

-- 4) list_scheduled_announcements — author's pending (director) ----------------
CREATE OR REPLACE FUNCTION public.list_scheduled_announcements(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'priority', a.priority,
    'target_type', a.target_type, 'target_value', a.target_value, 'requires_ack', a.requires_ack,
    'scheduled_at', a.scheduled_at, 'created_at', a.created_at
  ) ORDER BY a.scheduled_at), '[]'::jsonb) INTO v_rows
  FROM public.sales_announcements a
  WHERE a.author_sales_user_id=v_ses.sales_user_id AND a.is_active AND NOT a.is_published AND a.scheduled_at IS NOT NULL;
  RETURN jsonb_build_object('success',true,'scheduled',v_rows);
END $function$;
GRANT EXECUTE ON FUNCTION public.list_scheduled_announcements(text) TO anon, authenticated;

-- 5) update_scheduled_announcement — edit before publish (author only) ---------
CREATE OR REPLACE FUNCTION public.update_scheduled_announcement(
  p_session_token text, p_id uuid, p_title text, p_body text,
  p_priority text DEFAULT 'normal', p_target_type text DEFAULT 'all', p_target_value text DEFAULT NULL,
  p_requires_ack boolean DEFAULT false, p_scheduled_at text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; a public.sales_announcements; v_tv text; v_sched timestamptz;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND OR a.author_sales_user_id <> v_ses.sales_user_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF a.is_published THEN RETURN jsonb_build_object('success',false,'error','already_published','message','This announcement has already gone out.'); END IF;
  IF coalesce(btrim(p_title),'')='' OR coalesce(btrim(p_body),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','empty','message','Title and message are required.'); END IF;
  IF p_priority NOT IN ('normal','important','urgent') THEN p_priority := 'normal'; END IF;
  IF p_target_type NOT IN ('all','role','team','user') THEN RETURN jsonb_build_object('success',false,'error','bad_target'); END IF;
  v_tv := NULLIF(btrim(COALESCE(p_target_value,'')),'');
  IF p_target_type='role' THEN
    IF v_tv IS NULL OR v_tv NOT IN ('sale_rep','marketing_manager','director','cfo','admin','lead_entry') THEN RETURN jsonb_build_object('success',false,'error','bad_role'); END IF;
  ELSIF p_target_type IN ('team','user') THEN
    IF v_tv IS NULL OR NOT EXISTS (SELECT 1 FROM public.sales_users WHERE id=v_tv::uuid AND company_id=v_ses.company_id) THEN RETURN jsonb_build_object('success',false,'error','bad_target_user'); END IF;
  ELSE v_tv := NULL; END IF;
  IF NULLIF(btrim(COALESCE(p_scheduled_at,'')),'') IS NOT NULL THEN
    BEGIN v_sched := (btrim(p_scheduled_at))::timestamp AT TIME ZONE 'Asia/Karachi';
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','bad_schedule'); END;
  END IF;
  IF v_sched IS NULL OR v_sched <= now() THEN RETURN jsonb_build_object('success',false,'error','bad_schedule','message','Pick a future date & time.'); END IF;

  UPDATE public.sales_announcements SET
    title=btrim(p_title), body=btrim(p_body), priority=p_priority,
    is_important=(p_priority IN ('important','urgent')),
    target_type=p_target_type, target_value=v_tv, requires_ack=COALESCE(p_requires_ack,false),
    scheduled_at=v_sched, updated_at=now()
  WHERE id=p_id;
  RETURN jsonb_build_object('success',true,'scheduled_at',v_sched);
END $function$;
GRANT EXECUTE ON FUNCTION public.update_scheduled_announcement(text,uuid,text,text,text,text,text,boolean,text) TO anon, authenticated;

-- 6) cancel_scheduled_announcement — remove before publish (author only) -------
CREATE OR REPLACE FUNCTION public.cancel_scheduled_announcement(p_session_token text, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; a public.sales_announcements;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND OR a.author_sales_user_id <> v_ses.sales_user_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF a.is_published THEN RETURN jsonb_build_object('success',false,'error','already_published'); END IF;
  DELETE FROM public.sales_announcements WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END $function$;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_announcement(text,uuid) TO anon, authenticated;

-- 7) cron: publish due scheduled announcements + push (every 5 min) ------------
CREATE OR REPLACE FUNCTION public.cron_publish_scheduled()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE rec record; v_n int := 0;
BEGIN
  FOR rec IN
    SELECT id, priority FROM public.sales_announcements
    WHERE is_active AND NOT is_published AND scheduled_at IS NOT NULL AND scheduled_at <= now()
  LOOP
    UPDATE public.sales_announcements SET is_published=true, published_at=now() WHERE id=rec.id;
    -- fire push exactly like a normal publish; urgent bypasses quiet hours,
    -- normal/important queue to 08:00 via cron_announcement_push (push_enabled=true)
    PERFORM public._announcement_push(rec.id, (rec.priority='urgent'));
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'published',v_n,'ran_at',now());
END $function$;
REVOKE EXECUTE ON FUNCTION public.cron_publish_scheduled() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('crm-publish-scheduled'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('crm-publish-scheduled','*/5 * * * *',$$SET search_path=public; SELECT public.cron_publish_scheduled();$$);
