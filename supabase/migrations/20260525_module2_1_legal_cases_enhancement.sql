-- ================================================================
-- NEXUNOVA RMS — MODULE 2.1 LEGAL CASES ENHANCEMENT
-- 2026-05-25 — APPLIED via MCP + verified (case_type round-trip; analytics
-- active/resolved/by_stage/by_type/upcoming_hearings). Rolled back, 0 residue.
--
--   (a) legal_cases.case_type column (notice/court/arbitration/settlement)
--   (b) list_legal_cases + upsert_legal_case round-trip case_type
--   (c) get_legal_analytics: case stats, settlement rate, avg resolution
--       days, by_stage, by_type, upcoming hearings (30d)
--
-- IMPORTANT — pre-existing bug fixed alongside: legal_cases_stage_check
-- only allows lowercase stages (pre_legal/notice_sent/filed/hearing/
-- judgment/appeal/settled/closed). The UI previously sent capitalised
-- labels ('Hearing', 'Closed', ...) which the CHECK rejected — case
-- creation was silently failing. legalcases.js now uses the DB-valid
-- values; get_legal_analytics keys off 'settled'/'closed' for resolved.
-- (Canonical bodies applied via mcp apply_migration; mirror kept in repo.)
-- ================================================================

ALTER TABLE public.legal_cases ADD COLUMN IF NOT EXISTS case_type text DEFAULT 'court';

-- list_legal_cases (+case_type), upsert_legal_case (+case_type), and
-- get_legal_analytics(p_company_id) were applied via apply_migration
-- 'module2_1_legal_cases_enhancement' + 'module2_1_legal_analytics_stage_fix'.
-- See live DB pg_get_functiondef for authoritative bodies.
