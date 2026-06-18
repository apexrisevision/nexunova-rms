-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA (company group) — Phase 1: foundation (schema only, generic).
-- Opt-in: a company with dealer_group_id = NULL behaves exactly as today (standalone
-- portal). Only companies placed in a group federate their dealer-SELLING:
--   • one umbrella signup link (company_groups.signup_token)
--   • a dealer (sales_user in the group's HOME company) can sell units across all
--     member companies; each sale lands in the unit's own company (separate admin /
--     recovery / commission per company — unchanged).
--   • one umbrella approval creates/links an agent record in EACH member company
--     (dealer_company_agents maps the dealer to their per-company agent).
-- Everything except dealer-selling stays per-company. Default OFF for all tenants.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.company_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  home_company_id uuid NOT NULL,            -- where dealers are managed / approved
  signup_token text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),
  owner_user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS dealer_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_companies_dealer_group ON public.companies(dealer_group_id);

CREATE TABLE IF NOT EXISTS public.dealer_company_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  sales_user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dca_user_company ON public.dealer_company_agents(sales_user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_dca_group ON public.dealer_company_agents(group_id);

ALTER TABLE public.company_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_company_agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_groups FROM anon, authenticated;
REVOKE ALL ON public.dealer_company_agents FROM anon, authenticated;

-- NOTE: the specific group for this customer (home = Awami; members = Fourteen
-- Group + Awami + FMH) is configured as live data, not in this generic migration.
