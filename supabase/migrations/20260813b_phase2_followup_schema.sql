-- Phase 2 — Member accountability (forced follow-up), part 1 of 3: SCHEMA ONLY.
--
-- Owner-approved 2026-08-13. Six decisions taken:
--   1. The 173 dateless Awami leads get a STAGGERED backfill (part 3, separate file).
--   2. Block on the 3rd overdue          → max_overdue_before_block = 2
--   3. Soft-lock = read-only + disposition modal. The lead is never hidden.
--   4. director + lead_entry are exempt.
--   5. Awami ON, every other tenant OFF  → is_enabled defaults false.
--   6. Sundays do not count as overdue.
--
-- DDL is schema-wide: these columns land for every tenant. Tenant isolation of the
-- BEHAVIOUR comes from company_followup_policy.is_enabled, which this file seeds to
-- false everywhere. Nothing changes for anyone until a policy row is flipped on.
--
-- This file adds no RPC and no cron. It is safe to run on its own.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. company_followup_policy — the per-tenant switch and knobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_followup_policy (
  company_id                uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  is_enabled                boolean     NOT NULL DEFAULT false,
  max_overdue_before_block  smallint    NOT NULL DEFAULT 2,
  lock_after_days           smallint    NOT NULL DEFAULT 1,
  morning_list_hour_pkt     smallint    NOT NULL DEFAULT 8,
  exempt_roles              jsonb       NOT NULL DEFAULT '["director","lead_entry"]'::jsonb,
  skip_sundays              boolean     NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_followup_policy_max_overdue_chk
    CHECK (max_overdue_before_block BETWEEN 0 AND 50),
  CONSTRAINT company_followup_policy_lock_days_chk
    CHECK (lock_after_days BETWEEN 0 AND 30),
  CONSTRAINT company_followup_policy_hour_chk
    CHECK (morning_list_hour_pkt BETWEEN 0 AND 23),
  CONSTRAINT company_followup_policy_exempt_is_array_chk
    CHECK (jsonb_typeof(exempt_roles) = 'array')
);

COMMENT ON TABLE public.company_followup_policy IS
  'Phase 2 forced-follow-up policy, one row per tenant. is_enabled=false means the '
  'entire accountability engine is inert for that company — no locks, no counters, no blocks.';

DROP TRIGGER IF EXISTS trg_company_followup_policy_upd ON public.company_followup_policy;
CREATE TRIGGER trg_company_followup_policy_upd
  BEFORE UPDATE ON public.company_followup_policy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_followup_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon ON public.company_followup_policy;
CREATE POLICY deny_all_anon ON public.company_followup_policy
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Every existing tenant gets an explicit OFF row, so "no row" never means "unknown".
INSERT INTO public.company_followup_policy (company_id, is_enabled)
SELECT c.id, false FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. leads — accountability state
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS followup_locked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS overdue_since         date,
  ADD COLUMN IF NOT EXISTS missed_followup_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_disposition_at   timestamptz;

COMMENT ON COLUMN public.leads.followup_locked_at IS
  'Soft-lock stamp. NULL = open. Set by cron_followup_sweep once the follow-up date has '
  'passed by policy.lock_after_days. A locked lead is READ-ONLY in the portal except for '
  'the disposition modal — it is never hidden from the member.';
COMMENT ON COLUMN public.leads.overdue_since IS
  'The date this lead first went overdue in its current cycle. Makes the hourly sweep '
  'idempotent: the miss is counted once per cycle, not once per hour. Cleared on disposition.';
COMMENT ON COLUMN public.leads.missed_followup_count IS
  'How many follow-up dates this lead has blown through. Never reset by the member.';
COMMENT ON COLUMN public.leads.last_disposition_at IS
  'When the owner last supplied status + comment + next date together. Distinct from '
  'last_activity_at, which any touch bumps.';

-- ---------------------------------------------------------------------------
-- 3. sales_users — per-member counter and assign block
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS overdue_lead_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assign_blocked_since timestamptz;

COMMENT ON COLUMN public.sales_users.overdue_lead_count IS
  'Live count of this member''s overdue leads, maintained by cron_followup_sweep. '
  'Drives the director red flag and the assign block.';
COMMENT ON COLUMN public.sales_users.assign_blocked_since IS
  'When this member became ineligible to receive new leads (overdue_lead_count > '
  'policy.max_overdue_before_block). NULL = can receive leads.';

-- ---------------------------------------------------------------------------
-- 4. lead_views — catches "opened the lead, then closed the app"
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_views
  ADD COLUMN IF NOT EXISTS disposition_pending_since timestamptz;

COMMENT ON COLUMN public.lead_views.disposition_pending_since IS
  'Set when the member opens the lead, cleared when they submit status + comment + next '
  'date. Non-NULL means they opened it and walked away — the UI modal alone cannot catch that.';

-- ---------------------------------------------------------------------------
-- 5. lead_followup_events — append-only enforcement audit (the director''s evidence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_followup_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id)   ON DELETE CASCADE,
  lead_id          uuid        NOT NULL REFERENCES public.leads(id)       ON DELETE CASCADE,
  sales_user_id    uuid                 REFERENCES public.sales_users(id) ON DELETE SET NULL,
  event            text        NOT NULL,
  status_before    text,
  status_after     text,
  comment          text,
  follow_up_before timestamptz,
  follow_up_after  timestamptz,
  actor_kind       text        NOT NULL DEFAULT 'system',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_followup_events_event_chk CHECK (event IN (
    'disposition','missed','locked','unlocked','assign_blocked','assign_unblocked','override')),
  CONSTRAINT lead_followup_events_actor_chk CHECK (actor_kind IN ('member','system','director'))
);

COMMENT ON TABLE public.lead_followup_events IS
  'Append-only. Every disposition, miss, lock and block. Kept separate from lead_activities '
  'so the member''s human notes stay readable and system noise never pollutes them. '
  'INSERT only — no UPDATE, no DELETE.';

ALTER TABLE public.lead_followup_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon ON public.lead_followup_events;
CREATE POLICY deny_all_anon ON public.lead_followup_events
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
-- The sweep and the morning list both scan "whose date is due", which today has no index.
CREATE INDEX IF NOT EXISTS idx_leads_followup_due
  ON public.leads (owner_sales_user_id, next_follow_up_at)
  WHERE deleted_at IS NULL AND status NOT IN ('won','lost');

CREATE INDEX IF NOT EXISTS idx_leads_locked
  ON public.leads (company_id)
  WHERE followup_locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_followup_events_lead
  ON public.lead_followup_events (lead_id, created_at DESC);

COMMIT;
