-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — NEXUBRIEF 2.0: daily brief as a premium inbox message  |  2026-07-05
-- ------------------------------------------------------------------------
-- The morning brief moves from the Command Center card to the announcements
-- inbox as a system-posted, directors-only message ("NexuBrief"). Content is
-- structured into two sections: "Yesterday" + "Nexu Suggestions" (data-derived,
-- first names only, no phone numbers). Read-receipts, deep-links and archive
-- reuse the existing announcement machinery. crm_daily_brief stays source of
-- truth; the inbox row references it via sales_announcements.brief_id.
--
-- NOTE (branding): nothing here is user-visible except titles/bodies which the
-- edge fn/frontend brand as "NexuBrief" — no model/vendor names anywhere.
-- Cron moves 08:00 → 09:00 Asia/Karachi.
-- ════════════════════════════════════════════════════════════════════════

-- 0) Widen CHECK constraints: allow kind='brief' + target_type='directors' --
ALTER TABLE public.sales_announcements DROP CONSTRAINT IF EXISTS sales_announcements_kind_chk;
ALTER TABLE public.sales_announcements ADD  CONSTRAINT sales_announcements_kind_chk
  CHECK (kind = ANY (ARRAY['announcement','welcome','followup','system','brief']));
ALTER TABLE public.sales_announcements DROP CONSTRAINT IF EXISTS sales_announcements_target_chk;
ALTER TABLE public.sales_announcements ADD  CONSTRAINT sales_announcements_target_chk
  CHECK (target_type = ANY (ARRAY['all','role','team','user','directors']));

-- 1) Structured content + inbox linkage ----------------------------------
ALTER TABLE public.crm_daily_brief   ADD COLUMN IF NOT EXISTS content jsonb;   -- {yesterday, suggestions[]}
ALTER TABLE public.sales_announcements ADD COLUMN IF NOT EXISTS brief_id uuid
  REFERENCES public.crm_daily_brief(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sales_ann_brief ON public.sales_announcements(brief_id) WHERE brief_id IS NOT NULL;

-- 2) crm_brief_gather — add signals that drive concrete suggestions -------
CREATE OR REPLACE FUNCTION public.crm_brief_gather(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tz text := 'Asia/Karachi'; v_today date; v_yest date;
  v_kinds text[] := ARRAY['call','whatsapp','visit','meeting','note','stage'];
  v_fu    text[] := ARRAY['call','whatsapp','visit','meeting','note'];
  v_chan  text[] := ARRAY['facebook','instagram','whatsapp','website'];
  v_coname text;
  v_yest_src jsonb; v_today_src jsonb; v_pipeline jsonb;
  v_hot jsonb; v_overdue jsonb; v_overdue_n int; v_unassigned int;
  v_new_yest int; v_new_today int; v_won_yest int;
  v_worst jsonb; v_inactive jsonb; v_drought jsonb;
BEGIN
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_yest  := v_today - 1;
  SELECT company_name INTO v_coname FROM public.companies WHERE id=p_company_id;

  SELECT COALESCE(jsonb_object_agg(source, n),'{}'::jsonb) INTO v_yest_src FROM (
    SELECT source, count(*) n FROM public.leads
     WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
       AND (created_at AT TIME ZONE v_tz)::date = v_yest GROUP BY source) a;
  SELECT COALESCE(sum(v),0) INTO v_new_yest FROM (SELECT (value)::int v FROM jsonb_each_text(v_yest_src)) z;

  SELECT COALESCE(jsonb_object_agg(source, n),'{}'::jsonb) INTO v_today_src FROM (
    SELECT source, count(*) n FROM public.leads
     WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
       AND (created_at AT TIME ZONE v_tz)::date = v_today GROUP BY source) b;
  SELECT COALESCE(sum(v),0) INTO v_new_today FROM (SELECT (value)::int v FROM jsonb_each_text(v_today_src)) z;

  SELECT count(*) INTO v_won_yest FROM public.leads
   WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
     AND status='won' AND (updated_at AT TIME ZONE v_tz)::date = v_yest;

  SELECT COALESCE(jsonb_object_agg(status, n),'{}'::jsonb) INTO v_pipeline FROM (
    SELECT status, count(*) n FROM public.leads
     WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
       AND status NOT IN ('won','lost') GROUP BY status) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lead', split_part(COALESCE(h.name,'Lead'),' ',1), 'stage', h.status,
           'owner', CASE WHEN h.owner_name IS NULL THEN NULL ELSE split_part(h.owner_name,' ',1) END,
           'source', h.source) ORDER BY h.last_activity_at DESC NULLS LAST),'[]'::jsonb)
    INTO v_hot FROM (
    SELECT l.name, l.status, l.source, l.last_activity_at, ow.full_name AS owner_name
      FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status IN ('negotiation','visit')
     ORDER BY l.last_activity_at DESC NULLS LAST LIMIT 5) h;

  SELECT count(*) INTO v_overdue_n FROM public.leads l
   WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
     AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
     AND l.next_follow_up_at IS NOT NULL
     AND (l.next_follow_up_at AT TIME ZONE v_tz)::date < v_today;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lead', split_part(COALESCE(o.name,'Lead'),' ',1),
           'owner', split_part(COALESCE(o.owner_name,'—'),' ',1),
           'days_overdue', o.dd) ORDER BY o.dd DESC),'[]'::jsonb)
    INTO v_overdue FROM (
    SELECT l.name, ow.full_name AS owner_name,
           (v_today - (l.next_follow_up_at AT TIME ZONE v_tz)::date) AS dd
      FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status NOT IN ('won','lost') AND l.owner_sales_user_id IS NOT NULL
       AND l.next_follow_up_at IS NOT NULL
       AND (l.next_follow_up_at AT TIME ZONE v_tz)::date < v_today
     ORDER BY (l.next_follow_up_at AT TIME ZONE v_tz)::date ASC LIMIT 8) o;

  SELECT count(*) INTO v_unassigned FROM public.leads
   WHERE company_id=p_company_id AND NOT COALESCE(is_test,false)
     AND owner_sales_user_id IS NULL AND status NOT IN ('won','lost');

  -- worst untouched: longest-waiting OPEN lead with NO activity yet
  SELECT to_jsonb(w) INTO v_worst FROM (
    SELECT split_part(COALESCE(l.name,'Lead'),' ',1) AS lead,
           round(extract(epoch FROM (now()-l.created_at))/3600) AS hours,
           CASE WHEN ow.full_name IS NULL THEN NULL ELSE split_part(ow.full_name,' ',1) END AS owner
      FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status NOT IN ('won','lost')
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id=l.id AND a.kind = ANY(v_kinds))
     ORDER BY l.created_at ASC LIMIT 1) w;

  -- inactive agents: active reps owning open leads but 0 follow-ups in 7 days
  SELECT COALESCE(jsonb_agg(split_part(full_name,' ',1) ORDER BY full_name),'[]'::jsonb) INTO v_inactive FROM (
    SELECT m.full_name FROM public.sales_users m
     WHERE m.company_id=p_company_id AND m.status='active' AND m.role IN ('sale_rep','marketing_manager')
       AND EXISTS (SELECT 1 FROM public.leads l WHERE l.owner_sales_user_id=m.id
                    AND l.status NOT IN ('won','lost') AND NOT COALESCE(l.is_test,false))
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.sales_user_id=m.id
                    AND a.kind = ANY(v_fu) AND a.created_at >= now()-interval '7 days')
     LIMIT 5) q;

  -- source drought: channel that was active in last 30d but produced 0 leads in last 3d
  SELECT COALESCE(jsonb_agg(s),'[]'::jsonb) INTO v_drought FROM unnest(v_chan) s
   WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
                  AND l.source=s AND l.created_at >= now()-interval '30 days')
     AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
                  AND l.source=s AND (l.created_at AT TIME ZONE v_tz)::date > v_today-3);

  RETURN jsonb_build_object(
    'company', v_coname, 'today', v_today, 'yesterday', v_yest,
    'new_yesterday', v_new_yest, 'yesterday_by_source', v_yest_src,
    'new_today_so_far', v_new_today, 'today_by_source', v_today_src,
    'won_yesterday', v_won_yest, 'pipeline_open', v_pipeline,
    'hot_leads', v_hot, 'overdue_followups', v_overdue, 'overdue_total', v_overdue_n,
    'unassigned_open', v_unassigned,
    'worst_untouched', v_worst, 'inactive_agents', v_inactive, 'source_drought', v_drought);
END $function$;
REVOKE EXECUTE ON FUNCTION public.crm_brief_gather(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.crm_brief_gather(uuid) TO service_role;

-- 3) save_daily_brief — store structured content, return the brief id -----
DROP FUNCTION IF EXISTS public.save_daily_brief(uuid, text, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.save_daily_brief(p_company_id uuid, p_body text, p_stats jsonb, p_content jsonb, p_model text, p_source text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tz text := 'Asia/Karachi'; v_date date; v_id uuid; v_ins boolean;
BEGIN
  v_date := (now() AT TIME ZONE v_tz)::date;
  INSERT INTO public.crm_daily_brief (company_id, brief_date, body, stats, content, model, source)
  VALUES (p_company_id, v_date, COALESCE(p_body,''), COALESCE(p_stats,'{}'::jsonb), COALESCE(p_content,'{}'::jsonb), p_model, COALESCE(p_source,'ai'))
  ON CONFLICT (company_id, brief_date) DO NOTHING RETURNING id INTO v_id;
  v_ins := v_id IS NOT NULL;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.crm_daily_brief WHERE company_id=p_company_id AND brief_date=v_date;
  END IF;
  RETURN jsonb_build_object('success',true,'inserted',v_ins,'brief_id',v_id,'brief_date',v_date);
END $function$;
REVOKE EXECUTE ON FUNCTION public.save_daily_brief(uuid,text,jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_daily_brief(uuid,text,jsonb,jsonb,text,text) TO service_role;

-- 4) post_brief_message — system-post the brief into the inbox (directors) -
CREATE OR REPLACE FUNCTION public.post_brief_message(p_company_id uuid, p_brief_id uuid, p_title text, p_body text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.sales_announcements WHERE brief_id=p_brief_id LIMIT 1;  -- idempotent
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'id',v_id,'existed',true); END IF;
  INSERT INTO public.sales_announcements(company_id, title, body, kind, priority, is_important,
        target_type, target_value, author_sales_user_id, sales_user_id, requires_ack,
        push_enabled, is_published, published_at, brief_id, attachments)
  VALUES (p_company_id, p_title, p_body, 'brief', 'normal', false,
        'directors', NULL, NULL, NULL, false,
        false, true, now(), p_brief_id, '[]'::jsonb)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END $function$;
REVOKE EXECUTE ON FUNCTION public.post_brief_message(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.post_brief_message(uuid,uuid,text,text) TO service_role;

-- 5) get_brief_detail — structured content for the premium inbox view -----
CREATE OR REPLACE FUNCTION public.get_brief_detail(p_session_token text, p_announcement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; a public.sales_announcements; b public.crm_daily_brief;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_announcement_id AND kind='brief';
  IF NOT FOUND OR a.company_id <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT * INTO b FROM public.crm_daily_brief WHERE id=a.brief_id;
  RETURN jsonb_build_object('success',true,'title',a.title,'created_at',a.created_at,
    'brief_date', b.brief_date, 'source', b.source,
    'yesterday', COALESCE(b.content->'yesterday', to_jsonb(b.body)),
    'suggestions', COALESCE(b.content->'suggestions','[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.get_brief_detail(text,uuid) TO anon, authenticated;

-- 6) get_daily_brief — add latest brief's inbox message id (CC deep-link) --
CREATE OR REPLACE FUNCTION public.get_daily_brief(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_tz text := 'Asia/Karachi';
        v_today date; v_enabled boolean; v_latest_ann uuid; v_latest_date date;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT COALESCE(crm_ai_daily_brief,true) INTO v_enabled FROM public.companies WHERE id=v_co;

  SELECT a.id, b.brief_date INTO v_latest_ann, v_latest_date
    FROM public.sales_announcements a JOIN public.crm_daily_brief b ON b.id=a.brief_id
   WHERE a.company_id=v_co AND a.kind='brief' AND a.is_active
   ORDER BY b.brief_date DESC LIMIT 1;

  RETURN jsonb_build_object('success',true,'enabled',COALESCE(v_enabled,true),
    'today', v_today, 'latest_announcement_id', v_latest_ann, 'latest_date', v_latest_date);
END $function$;
GRANT EXECUTE ON FUNCTION public.get_daily_brief(text) TO anon, authenticated;

-- 7) _ann_recipients — support target_type='directors' -------------------
CREATE OR REPLACE FUNCTION public._ann_recipients(p_id uuid)
 RETURNS TABLE(sales_user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE a public.sales_announcements;
BEGIN
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF a.sales_user_id IS NOT NULL THEN
    RETURN QUERY SELECT su.id FROM public.sales_users su WHERE su.id=a.sales_user_id AND su.status='active';
    RETURN;
  END IF;
  RETURN QUERY
  SELECT su.id FROM public.sales_users su
  WHERE su.status='active'
    AND su.id IS DISTINCT FROM a.author_sales_user_id
    AND (
      (a.target_type='all'  AND su.company_id = a.company_id)
      OR (a.target_type='directors' AND su.company_id = a.company_id AND su.role IN ('director','admin'))
      OR (a.target_type='role' AND su.company_id = a.company_id AND su.role = a.target_value)
      OR (a.target_type='user' AND su.id = NULLIF(a.target_value,'')::uuid)
      OR (a.target_type='team' AND su.id IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM public.sales_users WHERE id = NULLIF(a.target_value,'')::uuid
              UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
            ) SELECT id FROM sub))
    );
END $function$;

-- 8) get_sales_announcements — brief visibility (directors) + 30d archive -
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
      AND a.is_published
      AND NOT (a.kind='followup' AND a.created_at < now() - interval '3 days')
      AND NOT (a.kind='system'   AND a.created_at < now() - interval '30 days')
      AND NOT (a.kind='brief'    AND a.created_at < now() - interval '30 days')
      AND (
        a.author_sales_user_id = v_uid
        OR a.sales_user_id = v_uid
        OR (a.sales_user_id IS NULL AND (
             (a.target_type='all'  AND (a.company_id=v_ses.company_id OR (v_group IS NOT NULL AND a.group_id=v_group)))
             OR (a.target_type='directors' AND a.company_id=v_ses.company_id AND v_role IN ('director','admin'))
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

-- 9) Cron: 08:00 → 09:00 Asia/Karachi (04:00 UTC) ------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='crm-daily-brief') THEN
    PERFORM cron.unschedule('crm-daily-brief');
  END IF;
  PERFORM cron.schedule('crm-daily-brief','0 4 * * *', $q$SELECT public.cron_daily_brief();$q$);
END $$;
-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPS: redeploy edge fn `crm-daily-brief` (rewritten for structured
-- content + inbox post + NexuBrief push). DB migration applied = RPCs + cron
-- time live. ANTHROPIC_API_KEY secret already set.
-- ════════════════════════════════════════════════════════════════════════
