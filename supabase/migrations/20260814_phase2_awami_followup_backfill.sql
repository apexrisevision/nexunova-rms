-- Phase 2 — part 3 of 3: STAGGERED BACKFILL for the dateless Awami leads.
--
-- ⚠️ NOT APPLIED. This file changes LIVE Awami data and must only be run on
--    Rashid's word, immediately before company_followup_policy.is_enabled is
--    turned on for Awami. Running it earlier puts dates in members' portals
--    while nothing is enforcing them.
--
-- Why it exists: 173 of Awami's 188 live leads carry no next_follow_up_at. With
-- the engine on and no date, either every one of them is overdue on day one
-- (six of seven members blocked before they open the app) or none of them ever
-- is (the loophole). Rashid chose a clean slate, spread — not everyone on today+2.
--
-- The spread:
--   * per member, their own leads are dealt out across the next 5 working days
--   * Sundays are skipped (policy.skip_sundays)
--   * oldest-touched leads come first, so the coldest get called soonest
--   * leads already carrying a date are left alone
--   * won/lost and deleted leads are left alone
--
-- Run the SELECT at the bottom FIRST (it is the same maths, read-only).

BEGIN;

WITH pol AS (
  SELECT c.id AS company_id
    FROM public.companies c
   WHERE c.company_code = 'awami'
),
-- the next 5 working days, Sundays skipped
days AS (
  SELECT d::date AS day, row_number() OVER (ORDER BY d) - 1 AS slot
    FROM generate_series(public._fu_today() + 1, public._fu_today() + 12, interval '1 day') d
   WHERE extract(dow FROM d) <> 0
   LIMIT 5
),
targets AS (
  SELECT l.id, l.owner_sales_user_id,
         row_number() OVER (PARTITION BY l.owner_sales_user_id
                            ORDER BY COALESCE(l.last_activity_at, l.created_at) ASC) - 1 AS seq
    FROM public.leads l
    JOIN pol ON pol.company_id = l.company_id
    LEFT JOIN public.deals d ON d.lead_id = l.id
   WHERE l.deleted_at IS NULL
     AND COALESCE(l.is_test,false) = false
     AND l.next_follow_up_at IS NULL
     AND l.owner_sales_user_id IS NOT NULL
     AND COALESCE(d.stage, l.status) NOT IN ('won','lost')
),
plan AS (
  SELECT t.id, dy.day
    FROM targets t
    JOIN days dy ON dy.slot = (t.seq % (SELECT count(*) FROM days))
)
UPDATE public.leads l
   SET next_follow_up_at = (p.day + time '10:00')::timestamptz,
       updated_at = now()
  FROM plan p
 WHERE l.id = p.id;

-- The backfill is a system act, not a member disposition: record it so nobody
-- later mistakes these dates for something a member promised.
INSERT INTO public.lead_followup_events (company_id, lead_id, sales_user_id, event,
                                         follow_up_after, comment, actor_kind)
SELECT l.company_id, l.id, l.owner_sales_user_id, 'override', l.next_follow_up_at,
       'Phase 2 clean-slate backfill — no follow-up date existed', 'system'
  FROM public.leads l
  JOIN public.companies c ON c.id = l.company_id AND c.company_code = 'awami'
 WHERE l.updated_at >= now() - interval '1 minute'
   AND l.next_follow_up_at IS NOT NULL;

COMMIT;

-- ── DRY RUN (safe, read-only) — what the UPDATE above would do ───────────────
-- WITH days AS (
--   SELECT d::date AS day, row_number() OVER (ORDER BY d) - 1 AS slot
--     FROM generate_series(public._fu_today()+1, public._fu_today()+12, interval '1 day') d
--    WHERE extract(dow FROM d) <> 0 LIMIT 5),
-- targets AS (
--   SELECT l.id, su.full_name,
--          row_number() OVER (PARTITION BY l.owner_sales_user_id
--                             ORDER BY COALESCE(l.last_activity_at,l.created_at) ASC) - 1 AS seq
--     FROM public.leads l
--     JOIN public.companies c ON c.id=l.company_id AND c.company_code='awami'
--     JOIN public.sales_users su ON su.id=l.owner_sales_user_id
--     LEFT JOIN public.deals d ON d.lead_id=l.id
--    WHERE l.deleted_at IS NULL AND COALESCE(l.is_test,false)=false
--      AND l.next_follow_up_at IS NULL
--      AND COALESCE(d.stage,l.status) NOT IN ('won','lost'))
-- SELECT t.full_name, dy.day, count(*) FROM targets t
--   JOIN days dy ON dy.slot = (t.seq % (SELECT count(*) FROM days))
--  GROUP BY 1,2 ORDER BY 1,2;
