-- ════════════════════════════════════════════════════════════════════════════
-- Announcement inbox: classify (kind) + auto-hide stale system msgs + strip emoji.
-- 2026-06-21. Director announcements were drowning in auto-generated noise
-- (welcome, follow-up reminders). Add an explicit `kind` so the inbox can split
-- Announcements | System | All; filter stale system messages ON READ (no delete);
-- and remove the 🎉 emoji from the welcome template (module is Lucide-only).
--
-- kind: 'announcement' = human (director post_announcement + admin broadcast),
--       'welcome' = one-time signup note (system, NEVER auto-hidden),
--       'followup' = lead follow-up reminder (system, stale after 3 days),
--       'system'   = generic system notice (stale after 30 days).
-- Auto-hide is FILTER-ON-READ only — rows are never deleted.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_announcements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'announcement';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_announcements_kind_chk') THEN
    ALTER TABLE public.sales_announcements ADD CONSTRAINT sales_announcements_kind_chk
      CHECK (kind IN ('announcement','welcome','followup','system'));
  END IF;
END $$;

-- backfill existing rows (default already 'announcement' for human/admin posts)
UPDATE public.sales_announcements
   SET kind='welcome'
 WHERE author_sales_user_id IS NULL AND title ILIKE 'Welcome aboard%';
UPDATE public.sales_announcements
   SET kind='followup'
 WHERE author_sales_user_id IS NULL AND title IN ('Follow-up due today','Overdue follow-up');

-- strip the 🎉 emoji from existing welcome titles (the only emoji in the data)
UPDATE public.sales_announcements
   SET title = btrim(replace(title, '🎉', ''))
 WHERE title LIKE '%🎉%';

-- welcome trigger: kind='welcome', NO emoji
CREATE OR REPLACE FUNCTION public.trg_sales_user_welcome_note()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company text; v_first text;
BEGIN
  SELECT company_name INTO v_company FROM public.companies WHERE id = NEW.company_id;
  v_company := coalesce(v_company, 'your company');
  v_first := split_part(coalesce(NEW.full_name,''), ' ', 1);
  IF coalesce(btrim(v_first),'') = '' THEN v_first := 'there'; END IF;
  INSERT INTO public.sales_announcements(company_id, sales_user_id, title, body, is_important, kind)
  VALUES (
    NEW.company_id, NEW.id,
    'Welcome aboard',
    'Welcome, ' || v_first || '! Your sub-dealer account with ' || v_company || ' is all set. '
    || 'From here you can browse available units, reserve them for your clients, submit sales, '
    || 'and track your recovery & leaderboard. Company updates and notices will also appear right '
    || 'here in this inbox. Wishing you great sales!',
    true, 'welcome'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- best-effort; never block signup
END; $function$;

-- follow-up reminder: kind='followup'
CREATE OR REPLACE FUNCTION public.send_followup_reminder(p_sales_user_id uuid, p_lead_id uuid, p_channel text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lead public.leads; v_overdue boolean; v_title text; v_body text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_overdue := v_lead.next_follow_up_at::date < current_date;
  v_title := CASE WHEN v_overdue THEN 'Overdue follow-up' ELSE 'Follow-up due today' END;
  v_body  := 'Follow up with '||COALESCE(v_lead.name,'your lead')
             ||CASE WHEN v_lead.phone IS NOT NULL THEN ' ('||v_lead.phone||')' ELSE '' END
             ||CASE WHEN v_overdue THEN ' — was due '||to_char(v_lead.next_follow_up_at,'DD Mon') ELSE ' — due today' END||'.';
  IF p_channel='in_app' THEN
    INSERT INTO public.sales_announcements (company_id, sales_user_id, title, body, is_important, is_active, attachments, kind)
    VALUES (v_lead.company_id, p_sales_user_id, v_title, v_body, v_overdue, true, '[]'::jsonb, 'followup');
    RETURN true;
  ELSIF p_channel='whatsapp' THEN
    RAISE NOTICE 'send_followup_reminder: whatsapp channel not configured (lead %)', p_lead_id;
    RETURN false;
  ELSIF p_channel='push' THEN
    RAISE NOTICE 'send_followup_reminder: push channel not configured (lead %)', p_lead_id;
    RETURN false;
  END IF;
  RETURN false;
END; $function$;

-- inbox read: + kind on each row, FILTER stale system msgs, split unread counts
CREATE OR REPLACE FUNCTION public.get_sales_announcements(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      AND NOT (a.kind='followup' AND a.created_at < now() - interval '3 days')   -- stale reminders hidden
      AND NOT (a.kind='system'   AND a.created_at < now() - interval '30 days')  -- stale notices hidden
      AND (
        a.author_sales_user_id = v_uid
        OR a.sales_user_id = v_uid
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
END
$function$;
