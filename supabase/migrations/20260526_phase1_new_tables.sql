-- ============================================================================
-- Migration: 20260526_phase1_new_tables
-- STATUS: APPLIED 2026-05-26 via Supabase MCP (migration: phase1_new_tables_20260526). Verified.
--
-- Phase 1 new-architecture schema from DATABASE_AUDIT.md gap analysis.
-- See PROPOSED_SCHEMA.md for full documentation.
--
-- Locked decisions:
--   (1) Approval workflow = single-approver (Admin approves; no multi-level steps table)
--   (2) Password policy   = dedicated company_password_policies table
--   (3) project_id delete  = RESTRICT on financial tables, SET NULL on operational tables
--
-- Conventions: uuid PKs via gen_random_uuid(); company_id -> companies(id) CASCADE;
-- actor cols -> app_users(id) SET NULL; RLS enabled + deny_all_anon on every table;
-- set_updated_at() BEFORE UPDATE trigger on every mutable table (trg_<table>_upd).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. user_project_assignments  (which user can access which project/site)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.user_project_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'view',   -- view | edit | manage
  is_active    boolean NOT NULL DEFAULT true,
  assigned_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_project_assignments_user_project_uniq UNIQUE (user_id, project_id)
);
CREATE INDEX idx_upa_company  ON public.user_project_assignments (company_id);
CREATE INDEX idx_upa_project  ON public.user_project_assignments (project_id);
CREATE INDEX idx_upa_user     ON public.user_project_assignments (user_id);

ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.user_project_assignments
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_user_project_assignments_upd
  BEFORE UPDATE ON public.user_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. approval_requests + approval_request_comments  (single-approver workflow)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.approval_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_type        text NOT NULL,        -- discount | cancellation | refund | transfer | price_revision | dnd | blacklist | ...
  entity_table        text,
  entity_id           uuid,
  project_id          uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount              numeric,
  status              text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | cancelled
  priority            text NOT NULL DEFAULT 'normal',    -- low | normal | high | urgent
  requested_by        uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  current_approver_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  decided_by          uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  decided_at          timestamptz,
  decision_comment    text,
  due_by              timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_apreq_company_status ON public.approval_requests (company_id, status);
CREATE INDEX idx_apreq_entity         ON public.approval_requests (entity_table, entity_id);
CREATE INDEX idx_apreq_pending_appr   ON public.approval_requests (current_approver_id) WHERE status = 'pending';

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.approval_requests
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_approval_requests_upd
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.approval_request_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  action      text,                 -- comment | approved | rejected | reassigned | escalated
  comment     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_apcomment_request ON public.approval_request_comments (request_id, created_at);

ALTER TABLE public.approval_request_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.approval_request_comments
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. company_setup_progress  (per-step wizard tracking)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.company_setup_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  step_key     text NOT NULL,   -- company_profile | branding | projects | units | users | payment_methods | categories | ...
  status       text NOT NULL DEFAULT 'pending',   -- pending | in_progress | completed | skipped
  completed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_setup_progress_uniq UNIQUE (company_id, step_key)
);
CREATE INDEX idx_setup_progress_company ON public.company_setup_progress (company_id);

ALTER TABLE public.company_setup_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.company_setup_progress
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_company_setup_progress_upd
  BEFORE UPDATE ON public.company_setup_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. company_password_policies + password_history + app_users columns
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.company_password_policies (
  company_id                  uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  min_length                  integer NOT NULL DEFAULT 8,
  require_uppercase           boolean NOT NULL DEFAULT true,
  require_lowercase           boolean NOT NULL DEFAULT true,
  require_number              boolean NOT NULL DEFAULT true,
  require_symbol              boolean NOT NULL DEFAULT false,
  expiry_days                 integer NOT NULL DEFAULT 90,   -- 0 = never expires
  history_count               integer NOT NULL DEFAULT 3,    -- block reuse of last N
  force_change_on_first_login boolean NOT NULL DEFAULT true,
  expiry_warning_days         integer NOT NULL DEFAULT 7,
  updated_by                  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_password_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.company_password_policies
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_company_password_policies_upd
  BEFORE UPDATE ON public.company_password_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.password_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pwd_history_user ON public.password_history (user_id, changed_at DESC);

ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.password_history
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Password expiry tracking on app_users (force-change reuses existing needs_password_reset)
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_expires_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. user_sessions  (device / session tracking)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.user_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL,
  device_label       text,
  device_type        text,        -- desktop | mobile | tablet
  user_agent         text,
  ip_address         inet,
  location           text,
  session_version    integer,
  is_current         boolean NOT NULL DEFAULT true,
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_sessions_token_uniq UNIQUE (session_token_hash)
);
CREATE INDEX idx_sessions_user_active ON public.user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_company     ON public.user_sessions (company_id);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.user_sessions
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
-- (no updated_at: last_seen_at is updated explicitly; no set_updated_at trigger)

-- ─────────────────────────────────────────────────────────────────────────
-- 6. recovery_officer_targets  (per officer, per month)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.recovery_officer_targets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recovery_agent_id  uuid NOT NULL REFERENCES public.recovery_agents(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES public.projects(id) ON DELETE SET NULL,  -- NULL = all sites
  year               smallint NOT NULL,
  month              smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  target_amount      numeric NOT NULL DEFAULT 0,
  target_calls       integer NOT NULL DEFAULT 0,
  target_promises    integer NOT NULL DEFAULT 0,
  achieved_amount    numeric NOT NULL DEFAULT 0,
  achieved_calls     integer NOT NULL DEFAULT 0,
  achieved_promises  integer NOT NULL DEFAULT 0,
  notes              text,
  set_by             uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_officer_targets_uniq UNIQUE (recovery_agent_id, project_id, year, month)
);
CREATE INDEX idx_rot_company_period ON public.recovery_officer_targets (company_id, year, month);

ALTER TABLE public.recovery_officer_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.recovery_officer_targets
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_recovery_officer_targets_upd
  BEFORE UPDATE ON public.recovery_officer_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 7. holidays  (Pakistan national + company holiday calendar)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.holidays (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES public.companies(id) ON DELETE CASCADE,  -- NULL = global/national default
  holiday_date   date NOT NULL,
  name           text NOT NULL,
  holiday_type   text NOT NULL DEFAULT 'national',  -- national | religious | company | optional
  country        text NOT NULL DEFAULT 'Pakistan',
  is_recurring   boolean NOT NULL DEFAULT false,
  is_working_day boolean NOT NULL DEFAULT false,
  notes          text,
  created_by     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holidays_uniq UNIQUE (company_id, holiday_date, name)
);
CREATE INDEX idx_holidays_date ON public.holidays (holiday_date);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.holidays
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_holidays_upd
  BEFORE UPDATE ON public.holidays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 8. cancellation_policy_tiers  (per project, or company default when project_id NULL)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.cancellation_policy_tiers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id               uuid REFERENCES public.projects(id) ON DELETE CASCADE,  -- NULL = company default
  tier_name                text NOT NULL,
  min_days_since_booking   integer,
  max_days_since_booking   integer,
  min_paid_pct             numeric(5,2),
  max_paid_pct             numeric(5,2),
  forfeiture_pct           numeric(5,2) NOT NULL DEFAULT 0,   -- % of amount paid forfeited
  cancellation_charge_pct  numeric(5,2) NOT NULL DEFAULT 0,   -- % of sale value
  cancellation_charge_flat numeric      NOT NULL DEFAULT 0,
  processing_fee           numeric      NOT NULL DEFAULT 0,
  refund_pct               numeric(5,2),
  sort_order               integer NOT NULL DEFAULT 0,
  is_active                boolean NOT NULL DEFAULT true,
  effective_from           date,
  effective_to             date,
  notes                    text,
  created_by               uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cpt_company_project ON public.cancellation_policy_tiers (company_id, project_id, sort_order);

ALTER TABLE public.cancellation_policy_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_anon ON public.cancellation_policy_tiers
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_cancellation_policy_tiers_upd
  BEFORE UPDATE ON public.cancellation_policy_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 9. Multi-site project_id column additions (14 tables) + backfill + indexes
--    Financial -> ON DELETE RESTRICT ; Operational -> ON DELETE SET NULL
-- ============================================================================

-- ---- Financial (RESTRICT) ----
ALTER TABLE public.payments               ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.installments           ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.pdc_cheques            ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.additional_receivables ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.payables               ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;

-- ---- Operational (SET NULL) ----
ALTER TABLE public.payment_promises    ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.contact_logs        ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.follow_up_reminders ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.escalations         ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.legal_cases         ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.field_visits        ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.reminder_logs       ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.buyer_complaints    ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.noc                 ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- ---- Backfill from parent sale / unit ----
UPDATE public.payments p               SET project_id = s.project_id FROM public.sales s WHERE s.id = p.sale_id;
UPDATE public.installments i           SET project_id = s.project_id FROM public.sales s WHERE s.id = i.sale_id;
UPDATE public.pdc_cheques pc           SET project_id = s.project_id FROM public.sales s WHERE s.id = pc.sale_id;
UPDATE public.additional_receivables a SET project_id = s.project_id FROM public.sales s WHERE s.id = a.sale_id;
-- payables: best-effort via related cancellation, then transfer
UPDATE public.payables pa SET project_id = uc.project_id FROM public.unit_cancellations uc WHERE uc.id = pa.related_cancellation_id;
UPDATE public.payables pa SET project_id = ut.project_id FROM public.unit_transfers ut    WHERE ut.id = pa.related_transfer_id AND pa.project_id IS NULL;

UPDATE public.payment_promises pp SET project_id = s.project_id FROM public.sales s WHERE s.id = pp.sale_id;

UPDATE public.contact_logs cl SET project_id = s.project_id FROM public.sales s WHERE s.id = cl.sale_id;
UPDATE public.contact_logs cl SET project_id = u.project_id FROM public.units u WHERE u.id = cl.unit_id AND cl.project_id IS NULL;

UPDATE public.follow_up_reminders fr SET project_id = s.project_id FROM public.sales s WHERE s.id = fr.sale_id;
UPDATE public.follow_up_reminders fr SET project_id = u.project_id FROM public.units u WHERE u.id = fr.unit_id AND fr.project_id IS NULL;

UPDATE public.escalations e SET project_id = s.project_id FROM public.sales s WHERE s.id = e.sale_id;

UPDATE public.legal_cases lc SET project_id = s.project_id FROM public.sales s WHERE s.id = lc.sale_id;
UPDATE public.legal_cases lc SET project_id = u.project_id FROM public.units u WHERE u.id = lc.unit_id AND lc.project_id IS NULL;

UPDATE public.field_visits fv SET project_id = u.project_id FROM public.units u WHERE u.id = fv.unit_id;

UPDATE public.reminder_logs rl SET project_id = s.project_id FROM public.sales s WHERE s.id = rl.sale_id;
UPDATE public.reminder_logs rl SET project_id = u.project_id FROM public.units u WHERE u.id = rl.unit_id AND rl.project_id IS NULL;

UPDATE public.noc n SET project_id = u.project_id FROM public.units u WHERE u.id = n.unit_id;
-- buyer_complaints: client-level, no reliable parent project -> left NULL

-- ---- Indexes on the new project_id columns ----
CREATE INDEX idx_payments_project               ON public.payments (project_id);
CREATE INDEX idx_installments_project           ON public.installments (project_id);
CREATE INDEX idx_pdc_cheques_project            ON public.pdc_cheques (project_id);
CREATE INDEX idx_additional_receivables_project ON public.additional_receivables (project_id);
CREATE INDEX idx_payables_project               ON public.payables (project_id);
CREATE INDEX idx_payment_promises_project       ON public.payment_promises (project_id);
CREATE INDEX idx_contact_logs_project           ON public.contact_logs (project_id);
CREATE INDEX idx_follow_up_reminders_project    ON public.follow_up_reminders (project_id);
CREATE INDEX idx_escalations_project            ON public.escalations (project_id);
CREATE INDEX idx_legal_cases_project            ON public.legal_cases (project_id);
CREATE INDEX idx_field_visits_project           ON public.field_visits (project_id);
CREATE INDEX idx_reminder_logs_project          ON public.reminder_logs (project_id);
CREATE INDEX idx_buyer_complaints_project       ON public.buyer_complaints (project_id);
CREATE INDEX idx_noc_project                    ON public.noc (project_id);

COMMIT;

-- ============================================================================
-- END — 10 new tables, +2 app_users columns, +14 project_id columns (backfilled).
-- NOT NULL on project_id can be enforced in a later migration once verified.
-- ============================================================================
