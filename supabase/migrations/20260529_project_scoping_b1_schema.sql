-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 0 (cleanup) + BATCH 1 (schema, project_id NULLABLE)
-- 2026-05-29.  ⚠️ REVIEW ONLY — DO NOT APPLY until Rashid approves.
-- ════════════════════════════════════════════════════════════
-- Goal (NEXUNOVA_RMS_MASTER_CONTEXT.md §3): make clients, agents and the three
-- category tables project-scoped so every entity belongs to exactly ONE project
-- ("A wala B ka data na dekhe"). Same CNIC/code in two projects = two records.
--
-- This batch is PURELY ADDITIVE and WRITE-SAFE:
--   • adds project_id (NULLABLE for now) + FK + index to the 5 primary entities
--     and 12 client/agent dependents;
--   • re-scopes the cnic / code / sort_order UNIQUE constraints to include
--     project_id. Verified: NONE of these uniques are ON CONFLICT targets in any
--     RPC (the only ON CONFLICTs hit blacklisted_clients, portal_clients.email,
--     client_health_scores.client_id, recovery_radar_logs — all untouched here),
--     so no write path breaks.
--
-- project_id is flipped to NOT NULL in BATCH 2, AFTER the write RPCs + create
-- forms are taught to supply it. Per-project category SEEDING + project-scoped
-- code generators are also BATCH 2. Server-side isolation is BATCH 3+.
--
-- ⚠️ INTERIM WINDOW (Batch 1 → Batch 2): existing write RPCs do NOT yet send
--   project_id, so anything created in the app during this window gets
--   project_id = NULL, and CNIC/code dedup is effectively company-wide (NULLs are
--   distinct under the re-scoped uniques). DB is pre-go-live — do NOT create
--   clients/agents/categories in the app until Batch 2 ships.

-- ─────────────────────────────────────────────────────────────
-- BATCH 0 — remove pre-go-live TEST DATA
--   (1 test client + its 1 health score + 4 health-history rows, 1 test agent;
--    everything else already empty). Delete child→parent to respect FKs.
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.client_health_history;
DELETE FROM public.client_health_scores;
DELETE FROM public.clients;
DELETE FROM public.agents;

-- ─────────────────────────────────────────────────────────────
-- BATCH 1a — add NULLABLE project_id column
-- ─────────────────────────────────────────────────────────────
-- Primary entities
ALTER TABLE public.clients                ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.agents                 ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.category_unit_types    ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.category_unit_statuses ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.category_payment_types ADD COLUMN IF NOT EXISTS project_id uuid;
-- Client dependents (project_id derived from parent client in Batch 2)
ALTER TABLE public.blacklisted_clients        ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.client_health_scores       ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.client_health_history      ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.demand_notices             ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.payment_links              ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.portal_clients             ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.portal_sessions            ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.radar_actions              ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.radar_action_logs          ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.campaign_clients           ADD COLUMN IF NOT EXISTS project_id uuid;
-- Agent dependents (project_id derived from parent agent in Batch 2)
ALTER TABLE public.agent_transactions         ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.agent_commission_payments  ADD COLUMN IF NOT EXISTS project_id uuid;

-- ─────────────────────────────────────────────────────────────
-- BATCH 1b — FOREIGN KEYS  (ON DELETE RESTRICT: never silently orphan
--   master/financial data; a project can't be deleted while it owns rows)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.clients                ADD CONSTRAINT clients_project_id_fkey                FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.agents                 ADD CONSTRAINT agents_project_id_fkey                 FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.category_unit_types    ADD CONSTRAINT cut_project_id_fkey                    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.category_unit_statuses ADD CONSTRAINT cus_project_id_fkey                    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.category_payment_types ADD CONSTRAINT cpt_project_id_fkey                    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.blacklisted_clients        ADD CONSTRAINT blacklisted_clients_project_id_fkey       FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.client_health_scores       ADD CONSTRAINT client_health_scores_project_id_fkey      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.client_health_history      ADD CONSTRAINT client_health_history_project_id_fkey     FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.demand_notices             ADD CONSTRAINT demand_notices_project_id_fkey            FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_links              ADD CONSTRAINT payment_links_project_id_fkey             FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.portal_clients             ADD CONSTRAINT portal_clients_project_id_fkey            FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.portal_sessions            ADD CONSTRAINT portal_sessions_project_id_fkey           FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.radar_actions              ADD CONSTRAINT radar_actions_project_id_fkey             FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.radar_action_logs          ADD CONSTRAINT radar_action_logs_project_id_fkey         FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_clients           ADD CONSTRAINT campaign_clients_project_id_fkey          FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.agent_transactions         ADD CONSTRAINT agent_transactions_project_id_fkey        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.agent_commission_payments  ADD CONSTRAINT agent_commission_payments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────
-- BATCH 1c — INDEXES on project_id (powers the Batch 3+ isolation predicate
--   `company_id = X AND project_id = ANY(v_pids)`)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_project                 ON public.clients(project_id);
CREATE INDEX IF NOT EXISTS idx_agents_project                  ON public.agents(project_id);
CREATE INDEX IF NOT EXISTS idx_cut_project                     ON public.category_unit_types(project_id);
CREATE INDEX IF NOT EXISTS idx_cus_project                     ON public.category_unit_statuses(project_id);
CREATE INDEX IF NOT EXISTS idx_cpt_project                     ON public.category_payment_types(project_id);
CREATE INDEX IF NOT EXISTS idx_blacklisted_clients_project     ON public.blacklisted_clients(project_id);
CREATE INDEX IF NOT EXISTS idx_client_health_scores_project    ON public.client_health_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_client_health_history_project   ON public.client_health_history(project_id);
CREATE INDEX IF NOT EXISTS idx_demand_notices_project          ON public.demand_notices(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_project           ON public.payment_links(project_id);
CREATE INDEX IF NOT EXISTS idx_portal_clients_project          ON public.portal_clients(project_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_project         ON public.portal_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_radar_actions_project           ON public.radar_actions(project_id);
CREATE INDEX IF NOT EXISTS idx_radar_action_logs_project       ON public.radar_action_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_campaign_clients_project        ON public.campaign_clients(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_project      ON public.agent_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_commission_payments_project ON public.agent_commission_payments(project_id);

-- ─────────────────────────────────────────────────────────────
-- BATCH 1d — RE-SCOPE UNIQUE constraints to include project_id
--   (primary entities only; dependents have no code/cnic uniques)
--   NOTE: while project_id is nullable these dedup NULL-project rows as distinct.
--   Becomes fully effective after the NOT NULL flip in Batch 2.
-- ─────────────────────────────────────────────────────────────
-- clients: (company_id, cnic) + (company_id, client_code) → add project_id
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_company_id_cnic_key;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_company_id_client_code_key;
ALTER TABLE public.clients ADD  CONSTRAINT clients_company_project_cnic_key UNIQUE (company_id, project_id, cnic);
ALTER TABLE public.clients ADD  CONSTRAINT clients_company_project_code_key UNIQUE (company_id, project_id, client_code);

-- agents: (company_id, agent_code) → add project_id
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_company_id_agent_code_key;
ALTER TABLE public.agents ADD  CONSTRAINT agents_company_project_code_key UNIQUE (company_id, project_id, agent_code);

-- category_unit_types: (company_id, type_code) + (company_id, sort_order) → add project_id
ALTER TABLE public.category_unit_types DROP CONSTRAINT IF EXISTS category_unit_types_company_id_type_code_key;
ALTER TABLE public.category_unit_types DROP CONSTRAINT IF EXISTS unit_types_company_sort_unique;
ALTER TABLE public.category_unit_types ADD  CONSTRAINT cut_company_project_code_key UNIQUE (company_id, project_id, type_code);
ALTER TABLE public.category_unit_types ADD  CONSTRAINT cut_company_project_sort_key UNIQUE (company_id, project_id, sort_order);

-- category_unit_statuses: (company_id, status_code) + (company_id, sort_order) → add project_id
ALTER TABLE public.category_unit_statuses DROP CONSTRAINT IF EXISTS category_unit_statuses_company_id_status_code_key;
ALTER TABLE public.category_unit_statuses DROP CONSTRAINT IF EXISTS unit_statuses_company_sort_unique;
ALTER TABLE public.category_unit_statuses ADD  CONSTRAINT cus_company_project_code_key UNIQUE (company_id, project_id, status_code);
ALTER TABLE public.category_unit_statuses ADD  CONSTRAINT cus_company_project_sort_key UNIQUE (company_id, project_id, sort_order);

-- category_payment_types: (company_id, type_code) → add project_id
ALTER TABLE public.category_payment_types DROP CONSTRAINT IF EXISTS category_payment_types_company_id_type_code_key;
ALTER TABLE public.category_payment_types ADD  CONSTRAINT cpt_company_project_code_key UNIQUE (company_id, project_id, type_code);
