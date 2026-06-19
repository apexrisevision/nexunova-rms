-- Welcome the new sub-dealer with an in-portal NOTIFICATION (not email):
-- a personal message that lands in their own Updates inbox at signup.
-- Also adds per-dealer targeting + final get/list bodies. Applied live via MCP 2026-06-19.

-- 1) per-dealer targeting: NULL = broadcast (existing), set = personal to that dealer
ALTER TABLE public.sales_announcements
  ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sales_ann_user ON public.sales_announcements(sales_user_id, created_at DESC);

-- 2) drop the earlier email-based welcome (owner wanted an in-portal notification)
DROP TRIGGER IF EXISTS sales_user_welcome_email ON public.sales_users;
DROP FUNCTION IF EXISTS public.trg_sales_user_welcome_email();

-- 3) portal feed = dealer's OWN personal notifications + broadcasts (company/group);
--    other dealers' personal notifications excluded.
CREATE OR REPLACE FUNCTION public.get_sales_announcements(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ses public.sales_sessions; v_group uuid; v_seen timestamptz; v_rows jsonb; v_unread int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  SELECT announcements_seen_at INTO v_seen FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'title',a.title,'body',a.body,'is_important',a.is_important,
    'attachments',a.attachments,'created_at',a.created_at
  ) ORDER BY a.created_at DESC),'[]'::jsonb), count(*) FILTER (WHERE v_seen IS NULL OR a.created_at>v_seen)
    INTO v_rows, v_unread
  FROM public.sales_announcements a
  WHERE a.is_active AND (
    a.sales_user_id = v_ses.sales_user_id
    OR (a.sales_user_id IS NULL AND (
         a.company_id = v_ses.company_id
         OR (v_group IS NOT NULL AND a.group_id = v_group))));
  RETURN jsonb_build_object('success',true,'announcements',v_rows,
    'unread',coalesce(v_unread,0),'seen_at',v_seen);
END; $fn$;

-- 4) admin "sent" history = broadcasts only (per-dealer welcome notes are system-generated)
CREATE OR REPLACE FUNCTION public.list_sales_announcements_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_me public.app_users; v_rows jsonb; v_group uuid; v_is_home boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=p_company_id;
  v_is_home := v_group IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_groups WHERE id=v_group AND home_company_id=p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'title',a.title,'body',a.body,'is_important',a.is_important,
    'is_active',a.is_active,'group_id',a.group_id,'attachments',a.attachments,
    'created_at',a.created_at,'updated_at',a.updated_at
  ) ORDER BY a.created_at DESC),'[]'::jsonb) INTO v_rows
  FROM public.sales_announcements a WHERE a.company_id=p_company_id AND a.sales_user_id IS NULL;
  RETURN jsonb_build_object('success',true,'announcements',v_rows,'is_group_home',v_is_home);
END; $fn$;

-- 5) auto welcome notification on new sub-dealer signup
CREATE OR REPLACE FUNCTION public.trg_sales_user_welcome_note()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company text; v_first text;
BEGIN
  SELECT company_name INTO v_company FROM public.companies WHERE id = NEW.company_id;
  v_company := coalesce(v_company, 'your company');
  v_first := split_part(coalesce(NEW.full_name,''), ' ', 1);
  IF coalesce(btrim(v_first),'') = '' THEN v_first := 'there'; END IF;
  INSERT INTO public.sales_announcements(company_id, sales_user_id, title, body, is_important)
  VALUES (
    NEW.company_id, NEW.id,
    'Welcome aboard 🎉',
    'Welcome, ' || v_first || '! Your sub-dealer account with ' || v_company || ' is all set. '
    || 'From here you can browse available units, reserve them for your clients, submit sales, '
    || 'and track your recovery & leaderboard. Company updates and notices will also appear right '
    || 'here in this inbox. Wishing you great sales!',
    true
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS sales_user_welcome_note ON public.sales_users;
CREATE TRIGGER sales_user_welcome_note
AFTER INSERT ON public.sales_users
FOR EACH ROW EXECUTE FUNCTION public.trg_sales_user_welcome_note();
