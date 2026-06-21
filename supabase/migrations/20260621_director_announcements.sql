-- ════════════════════════════════════════════════════════════════════════════
-- DIRECTOR-BROADCAST ANNOUNCEMENTS: targeting + read-receipts + acknowledge.
-- 2026-06-21. Builds ON the existing sales_announcements infra (no parallel
-- system). Adds: director compose from the PORTAL (was admin-app only), targeting
-- (all/role/team/user), priority (normal/important/urgent), per-recipient
-- read+ack tracking, and a director-only receipts view.
--
-- Existing & reused: table sales_announcements; get_sales_announcements (inbox
-- read); the Updates UI + nav badge. Existing seen-tracking was a SINGLE
-- sales_users.announcements_seen_at timestamp (no per-announcement, no ack) —
-- replaced by per-recipient announcement_receipts.
-- ════════════════════════════════════════════════════════════════════════════

-- A) extend the announcement with priority + targeting + author + ack-required
ALTER TABLE public.sales_announcements
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_value text,
  ADD COLUMN IF NOT EXISTS author_sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_announcements_priority_chk') THEN
    ALTER TABLE public.sales_announcements ADD CONSTRAINT sales_announcements_priority_chk
      CHECK (priority IN ('normal','important','urgent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_announcements_target_chk') THEN
    ALTER TABLE public.sales_announcements ADD CONSTRAINT sales_announcements_target_chk
      CHECK (target_type IN ('all','role','team','user'));
  END IF;
END $$;

-- B) per-recipient read-receipt + acknowledge
CREATE TABLE IF NOT EXISTS public.announcement_receipts (
  announcement_id uuid NOT NULL REFERENCES public.sales_announcements(id) ON DELETE CASCADE,
  sales_user_id   uuid NOT NULL REFERENCES public.sales_users(id) ON DELETE CASCADE,
  seen_at         timestamptz,
  acknowledged_at timestamptz,
  PRIMARY KEY (announcement_id, sales_user_id)
);
ALTER TABLE public.announcement_receipts ENABLE ROW LEVEL SECURITY;  -- access only via SECURITY DEFINER RPCs

-- C) resolve an announcement's recipient set (targeting), excluding the author
CREATE OR REPLACE FUNCTION public._ann_recipients(p_id uuid)
RETURNS TABLE(sales_user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a public.sales_announcements;
BEGIN
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT su.id FROM public.sales_users su
  WHERE su.status='active'
    AND su.id IS DISTINCT FROM a.author_sales_user_id
    AND (
      (a.target_type='all'  AND su.company_id = a.company_id)
      OR (a.target_type='role' AND su.company_id = a.company_id AND su.role = a.target_value)
      OR (a.target_type='user' AND su.id = NULLIF(a.target_value,'')::uuid)
      OR (a.target_type='team' AND su.id IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM public.sales_users WHERE id = NULLIF(a.target_value,'')::uuid
              UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
            ) SELECT id FROM sub))
    );
END
$function$;

-- D) post_announcement — DIRECTOR ONLY (server-enforced), from the portal
CREATE OR REPLACE FUNCTION public.post_announcement(
  p_session_token text, p_title text, p_body text,
  p_priority text DEFAULT 'normal', p_target_type text DEFAULT 'all', p_target_value text DEFAULT NULL,
  p_requires_ack boolean DEFAULT false, p_attachments jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_id uuid; v_tv text;
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
    v_tv := NULL;  -- 'all'
  END IF;

  INSERT INTO public.sales_announcements(company_id, group_id, title, body, is_important, attachments,
        priority, target_type, target_value, author_sales_user_id, requires_ack)
  VALUES (v_ses.company_id, NULL, btrim(p_title), btrim(p_body),
          (p_priority IN ('important','urgent')), COALESCE(p_attachments,'[]'::jsonb),
          p_priority, p_target_type, v_tv, v_ses.sales_user_id, COALESCE(p_requires_ack,false))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.post_announcement(text,text,text,text,text,text,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_announcement(text,text,text,text,text,text,boolean,jsonb) TO anon, authenticated;

-- E) mark one announcement seen (caller must be a recipient or the author)
CREATE OR REPLACE FUNCTION public.mark_announcement_seen(p_session_token text, p_announcement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public._ann_recipients(p_announcement_id) WHERE sales_user_id=v_ses.sales_user_id) THEN
    RETURN jsonb_build_object('success',true,'noop',true);   -- author / not a recipient: nothing to track
  END IF;
  INSERT INTO public.announcement_receipts(announcement_id, sales_user_id, seen_at)
  VALUES (p_announcement_id, v_ses.sales_user_id, now())
  ON CONFLICT (announcement_id, sales_user_id)
  DO UPDATE SET seen_at = COALESCE(public.announcement_receipts.seen_at, now());
  RETURN jsonb_build_object('success',true);
END
$function$;
GRANT EXECUTE ON FUNCTION public.mark_announcement_seen(text,uuid) TO anon, authenticated;

-- F) acknowledge one announcement (also marks seen)
CREATE OR REPLACE FUNCTION public.acknowledge_announcement(p_session_token text, p_announcement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public._ann_recipients(p_announcement_id) WHERE sales_user_id=v_ses.sales_user_id) THEN
    RETURN jsonb_build_object('success',false,'error','not_recipient'); END IF;
  INSERT INTO public.announcement_receipts(announcement_id, sales_user_id, seen_at, acknowledged_at)
  VALUES (p_announcement_id, v_ses.sales_user_id, now(), now())
  ON CONFLICT (announcement_id, sales_user_id)
  DO UPDATE SET seen_at = COALESCE(public.announcement_receipts.seen_at, now()),
               acknowledged_at = COALESCE(public.announcement_receipts.acknowledged_at, now());
  RETURN jsonb_build_object('success',true);
END
$function$;
GRANT EXECUTE ON FUNCTION public.acknowledge_announcement(text,uuid) TO anon, authenticated;

-- G) director-only receipts view: who received / read / acknowledged
CREATE OR REPLACE FUNCTION public.get_announcement_receipts(p_session_token text, p_announcement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; a public.sales_announcements; v_people jsonb;
        v_received int; v_read int; v_acked int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_announcement_id;
  IF NOT FOUND OR a.company_id <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'sales_user_id', su.id, 'name', su.full_name, 'role', su.role,
      'seen_at', r.seen_at, 'acknowledged_at', r.acknowledged_at)
      ORDER BY (r.acknowledged_at IS NOT NULL) DESC, (r.seen_at IS NOT NULL) DESC, su.full_name),'[]'::jsonb),
    count(*), count(r.seen_at), count(r.acknowledged_at)
    INTO v_people, v_received, v_read, v_acked
  FROM public._ann_recipients(p_announcement_id) rec
  JOIN public.sales_users su ON su.id=rec.sales_user_id
  LEFT JOIN public.announcement_receipts r ON r.announcement_id=p_announcement_id AND r.sales_user_id=su.id;

  RETURN jsonb_build_object('success',true,
    'title', a.title, 'priority', a.priority, 'requires_ack', a.requires_ack,
    'target_type', a.target_type, 'created_at', a.created_at,
    'received', COALESCE(v_received,0), 'read', COALESCE(v_read,0), 'acknowledged', COALESCE(v_acked,0),
    'people', v_people);
END
$function$;
REVOKE ALL ON FUNCTION public.get_announcement_receipts(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_announcement_receipts(text,uuid) TO anon, authenticated;

-- H) compose target picker — director only: roles in use, team heads, all users
CREATE OR REPLACE FUNCTION public.get_announce_targets(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_roles jsonb; v_users jsonb; v_teams jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role <> 'director' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('role',role,'label',public._lead_role_label(role),'n',n) ORDER BY role),'[]'::jsonb)
    INTO v_roles FROM (SELECT role, count(*) n FROM public.sales_users WHERE company_id=v_co AND status='active' GROUP BY role) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role) ORDER BY full_name),'[]'::jsonb)
    INTO v_users FROM public.sales_users WHERE company_id=v_co AND status='active' AND id<>v_ses.sales_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'name',h.full_name,'role',h.role,
     'team_size',(SELECT count(*) FROM public.sales_users k WHERE k.parent_sales_user_id=h.id AND k.status='active')) ORDER BY h.full_name),'[]'::jsonb)
    INTO v_teams
  FROM public.sales_users h
  WHERE h.company_id=v_co AND h.status='active'
    AND EXISTS (SELECT 1 FROM public.sales_users k WHERE k.parent_sales_user_id=h.id AND k.status='active');

  RETURN jsonb_build_object('success',true,'roles',v_roles,'users',v_users,'teams',v_teams);
END
$function$;
REVOKE ALL ON FUNCTION public.get_announce_targets(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_announce_targets(text) TO anon, authenticated;

-- I) inbox read — targeted visibility + per-announcement seen/ack + author/priority
--    (lead_entry guard REMOVED: she is a read-only recipient when targeted)
CREATE OR REPLACE FUNCTION public.get_sales_announcements(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_group uuid; v_role text; v_uid uuid; v_rows jsonb; v_unread int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;

  WITH vis AS (
    SELECT a.* FROM public.sales_announcements a
    WHERE a.is_active AND (
      a.author_sales_user_id = v_uid                                   -- my own posts (see receipts)
      OR a.sales_user_id = v_uid                                       -- legacy personal notification
      OR (a.target_type='all'  AND (a.company_id=v_ses.company_id OR (v_group IS NOT NULL AND a.group_id=v_group)))
      OR (a.target_type='role' AND a.company_id=v_ses.company_id AND v_role = a.target_value)
      OR (a.target_type='user' AND a.target_value = v_uid::text)
      OR (a.target_type='team' AND v_uid IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM public.sales_users WHERE id=NULLIF(a.target_value,'')::uuid
              UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
            ) SELECT id FROM sub))
    )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body,
    'priority', a.priority, 'is_important', a.is_important, 'attachments', a.attachments,
    'created_at', a.created_at,
    'author_name', COALESCE(au.full_name, 'Your company'),
    'is_author', (a.author_sales_user_id = v_uid),
    'requires_ack', a.requires_ack,
    'seen', (r.seen_at IS NOT NULL), 'seen_at', r.seen_at,
    'acknowledged', (r.acknowledged_at IS NOT NULL), 'acknowledged_at', r.acknowledged_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb),
  count(*) FILTER (WHERE a.author_sales_user_id IS DISTINCT FROM v_uid AND r.seen_at IS NULL)
    INTO v_rows, v_unread
  FROM vis a
  LEFT JOIN public.announcement_receipts r ON r.announcement_id=a.id AND r.sales_user_id=v_uid
  LEFT JOIN public.sales_users au ON au.id=a.author_sales_user_id;

  RETURN jsonb_build_object('success',true,'announcements',v_rows,'unread',COALESCE(v_unread,0));
END
$function$;
