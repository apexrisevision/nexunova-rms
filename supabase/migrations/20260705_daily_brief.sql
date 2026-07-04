-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — DIRECTOR COMMAND CENTER · PART 2: AI DAILY BRIEF  |  2026-07-05
-- ------------------------------------------------------------------------
-- Every morning (08:00 Asia/Karachi) an AI-written briefing lands for each
-- company's directors: yesterday's leads by source, hot lead(s), missed/overdue
-- follow-ups by name, today's priorities. Delivered by web push (tap → Command
-- Center brief card) and stored for a 30-day history.
--
-- ARCHITECTURE
--   cron_daily_brief()  (pg_cron 03:00 UTC = 08:00 PKT)
--     → for each eligible company (feature ON, has active director, no brief yet
--       today) → net.http_post → edge fn `crm-daily-brief`
--   edge fn: crm_brief_gather() → Anthropic (claude-sonnet-4-6) → save_daily_brief()
--            → crm_brief_claim_pushes() → send-web-push
--   On AI failure the edge fn stores a plain stats-only brief (never silent).
--
-- SECURITY: only aggregate stats + FIRST names ever leave for the API — no phone
-- numbers, no full contact details (enforced in crm_brief_gather).
-- Deploy deps at END (edge fn deploy · ANTHROPIC_API_KEY secret · cron).
-- ════════════════════════════════════════════════════════════════════════

-- 1) Company feature flag (default ON) -----------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS crm_ai_daily_brief boolean NOT NULL DEFAULT true;

-- 2) Brief history (30-day; one per company per day) ----------------------
CREATE TABLE IF NOT EXISTS public.crm_daily_brief (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brief_date  date NOT NULL,
  body        text NOT NULL,
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,
  model       text,
  source      text NOT NULL DEFAULT 'ai',           -- 'ai' | 'fallback'
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_daily_brief_uq UNIQUE (company_id, brief_date)
);
CREATE INDEX IF NOT EXISTS idx_crm_daily_brief_co_date ON public.crm_daily_brief(company_id, brief_date DESC);
ALTER TABLE public.crm_daily_brief ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_daily_brief' AND policyname='deny_all_crm_daily_brief') THEN
    CREATE POLICY "deny_all_crm_daily_brief" ON public.crm_daily_brief AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

-- 3) Stats gatherer — FIRST NAMES ONLY, NO PHONES (edge fn → Anthropic) ---
CREATE OR REPLACE FUNCTION public.crm_brief_gather(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tz text := 'Asia/Karachi'; v_today date; v_yest date; v_start timestamptz;
  v_kinds text[] := ARRAY['call','whatsapp','visit','meeting','note','stage'];
  v_coname text;
  v_yest_src jsonb; v_today_src jsonb; v_pipeline jsonb;
  v_hot jsonb; v_overdue jsonb; v_overdue_n int; v_unassigned int;
  v_new_yest int; v_new_today int; v_won_yest int;
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

  -- hot leads: open, late-stage (negotiation/visit), most recently touched — FIRST NAMES
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lead', split_part(COALESCE(h.name,'Lead'),' ',1),
           'stage', h.status,
           'owner', CASE WHEN h.owner_name IS NULL THEN NULL ELSE split_part(h.owner_name,' ',1) END,
           'source', h.source) ORDER BY h.last_activity_at DESC NULLS LAST),'[]'::jsonb)
    INTO v_hot FROM (
    SELECT l.name, l.status, l.source, l.last_activity_at, ow.full_name AS owner_name
      FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
     WHERE l.company_id=p_company_id AND NOT COALESCE(l.is_test,false)
       AND l.status IN ('negotiation','visit')
     ORDER BY l.last_activity_at DESC NULLS LAST LIMIT 5) h;

  -- overdue follow-ups (open, owned, past due) — FIRST NAMES + days overdue
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

  RETURN jsonb_build_object(
    'company', v_coname, 'today', v_today, 'yesterday', v_yest,
    'new_yesterday', v_new_yest, 'yesterday_by_source', v_yest_src,
    'new_today_so_far', v_new_today, 'today_by_source', v_today_src,
    'won_yesterday', v_won_yest,
    'pipeline_open', v_pipeline,
    'hot_leads', v_hot,
    'overdue_followups', v_overdue, 'overdue_total', v_overdue_n,
    'unassigned_open', v_unassigned);
END $function$;
REVOKE EXECUTE ON FUNCTION public.crm_brief_gather(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.crm_brief_gather(uuid) TO service_role;

-- 4) Store the brief (idempotent per company+day) -------------------------
CREATE OR REPLACE FUNCTION public.save_daily_brief(p_company_id uuid, p_body text, p_stats jsonb, p_model text, p_source text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tz text := 'Asia/Karachi'; v_date date; v_id uuid;
BEGIN
  v_date := (now() AT TIME ZONE v_tz)::date;
  INSERT INTO public.crm_daily_brief (company_id, brief_date, body, stats, model, source)
  VALUES (p_company_id, v_date, COALESCE(p_body,''), COALESCE(p_stats,'{}'::jsonb), p_model, COALESCE(p_source,'ai'))
  ON CONFLICT (company_id, brief_date) DO NOTHING RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'inserted', v_id IS NOT NULL, 'brief_date', v_date);
END $function$;
REVOKE EXECUTE ON FUNCTION public.save_daily_brief(uuid,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_daily_brief(uuid,text,jsonb,text,text) TO service_role;

-- 5) Claim brief pushes (dedupe per director per day) — returns subs -------
CREATE OR REPLACE FUNCTION public.crm_brief_claim_pushes(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tz text := 'Asia/Karachi'; v_date date; v_coname text;
        d record; v_ins uuid; v_subs jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  v_date := (now() AT TIME ZONE v_tz)::date;
  SELECT company_name INTO v_coname FROM public.companies WHERE id=p_company_id;
  FOR d IN
    SELECT id FROM public.sales_users
     WHERE company_id=p_company_id AND status='active' AND role IN ('director','admin')
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.sales_user_id=sales_users.id)
  LOOP
    INSERT INTO public.reminder_deliveries (company_id, sales_user_id, channel, dedup_key, status)
    VALUES (p_company_id, d.id, 'push', 'brief:'||d.id||':'||v_date, 'sent')
    ON CONFLICT (company_id, dedup_key) DO NOTHING RETURNING id INTO v_ins;
    IF v_ins IS NULL THEN CONTINUE; END IF;   -- already pushed today
    SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint',endpoint,'p256dh',p256dh,'auth',auth)),'[]'::jsonb)
      INTO v_subs FROM public.push_subscriptions WHERE sales_user_id=d.id;
    v_out := v_out || v_subs;
  END LOOP;
  RETURN jsonb_build_object('success',true,'company',v_coname,'subs',v_out);
END $function$;
REVOKE EXECUTE ON FUNCTION public.crm_brief_claim_pushes(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.crm_brief_claim_pushes(uuid) TO service_role;

-- 6) Frontend read: latest brief + 30-day history (director/admin) --------
CREATE OR REPLACE FUNCTION public.get_daily_brief(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_tz text := 'Asia/Karachi';
        v_today date; v_enabled boolean; v_today_brief jsonb; v_hist jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT COALESCE(crm_ai_daily_brief,true) INTO v_enabled FROM public.companies WHERE id=v_co;

  SELECT to_jsonb(t) INTO v_today_brief FROM (
    SELECT body, source, model, created_at FROM public.crm_daily_brief
     WHERE company_id=v_co AND brief_date=v_today) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date',brief_date,'body',body,'source',source) ORDER BY brief_date DESC),'[]'::jsonb)
    INTO v_hist FROM (
    SELECT brief_date, body, source FROM public.crm_daily_brief
     WHERE company_id=v_co AND brief_date >= v_today-30 AND brief_date < v_today
     ORDER BY brief_date DESC LIMIT 30) h;

  RETURN jsonb_build_object('success',true,'enabled',COALESCE(v_enabled,true),
    'today', v_today, 'brief', v_today_brief, 'history', v_hist);
END $function$;
GRANT EXECUTE ON FUNCTION public.get_daily_brief(text) TO anon, authenticated;

-- 7) Toggle the feature (director/admin, from the Command Center) ----------
CREATE OR REPLACE FUNCTION public.set_company_brief_pref(p_session_token text, p_on boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ses public.sales_sessions; v_role text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  UPDATE public.companies SET crm_ai_daily_brief = COALESCE(p_on,true) WHERE id=v_ses.company_id;
  RETURN jsonb_build_object('success',true,'enabled',COALESCE(p_on,true));
END $function$;
GRANT EXECUTE ON FUNCTION public.set_company_brief_pref(text, boolean) TO anon, authenticated;

-- 8) Cron driver — fire the edge fn per eligible company ------------------
CREATE OR REPLACE FUNCTION public.cron_daily_brief()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE v_tz text := 'Asia/Karachi'; v_today date; c record; v_n int := 0;
BEGIN
  v_today := (now() AT TIME ZONE v_tz)::date;
  FOR c IN
    SELECT co.id FROM public.companies co
     WHERE COALESCE(co.crm_ai_daily_brief,true)
       AND EXISTS (SELECT 1 FROM public.sales_users su
                    WHERE su.company_id=co.id AND su.status='active' AND su.role IN ('director','admin'))
       AND NOT EXISTS (SELECT 1 FROM public.crm_daily_brief b
                        WHERE b.company_id=co.id AND b.brief_date=v_today)
  LOOP
    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/crm-daily-brief',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := jsonb_build_object('company_id', c.id));
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'dispatched',v_n,'ran_at',now());
END $function$;
REVOKE EXECUTE ON FUNCTION public.cron_daily_brief() FROM PUBLIC, anon, authenticated;

-- 9) Schedule: 03:00 UTC = 08:00 Asia/Karachi ----------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='crm-daily-brief') THEN
    PERFORM cron.schedule('crm-daily-brief','0 3 * * *', $q$SELECT public.cron_daily_brief();$q$);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- DEPLOY DEPENDENCIES (owner-only):
--   • supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        (owner sets)
--   • supabase functions deploy crm-daily-brief --no-verify-jwt
--   • (VAPID + send-web-push already live from the follow-up reminders task)
-- ════════════════════════════════════════════════════════════════════════
