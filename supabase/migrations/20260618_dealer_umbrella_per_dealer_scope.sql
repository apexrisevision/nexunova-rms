-- ════════════════════════════════════════════════════════════════════════════
-- DEALER UMBRELLA — per-dealer scope (supersedes the company-level gating of
-- phases 3/4/6b). A dealer's reach is now decided by HOW THEY SIGNED UP, not just
-- their company's group membership:
--   • umbrella signup link  → sales_users.is_umbrella = TRUE  → sells ALL member projects
--   • a company's own link  → is_umbrella = FALSE → sells ONLY that company's project
-- So within a group you can still issue single-project links. The selling RPCs gate
-- on (company in a group AND dealer.is_umbrella); the approval chooser appears only
-- for umbrella-scope dealers. The full updated bodies are applied live; this file is
-- the authoritative version of the changed functions.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS is_umbrella boolean NOT NULL DEFAULT false;

-- NOTE: the up-to-date bodies of sales_register, get_availability_board, reserve_unit,
-- submit_sale, get_sales_leaderboard and get_umbrella_approval_context (all gating on
-- COALESCE(sales_users.is_umbrella,false) AND the company's dealer_group_id) are applied
-- live via the MCP session of 2026-06-18. They mirror the phase 2/3/4/5/6b definitions
-- with the single gate change:  v_span := (v_group IS NOT NULL AND COALESCE(v_su.is_umbrella,false));
-- and sales_register sets is_umbrella = (token resolved via company_groups.signup_token).
-- See those phase files for the structure; only the gate predicate + the is_umbrella
-- column write differ.
