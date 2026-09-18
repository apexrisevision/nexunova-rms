-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · j · reconcile nf_accounts against the
--                                            real QuickBooks export
--
-- The first QuickBooks comparison (migration_work/qb_chart.iif) was the
-- WRONG company file — discarded entirely, per the owner. The real export
-- (D:\Claude Cowork\QB_COA_Awami.IIF, QuickBooks Enterprise 34.0D, exported
-- 2026-09-18, 113 accounts) was parsed and every nf_accounts row compared
-- against it by full colon-path. Result: 106 of 110 matched exactly,
-- proving nf_account_path's materialized-path logic correct against its
-- own authoritative reference (this file is now that reference). Three
-- real, narrow differences, all fixed here and at the seed source
-- (scripts/nf/gen-seed.js, same commit):
--
--   1. 12600/12610/12620: nf_accounts said "Receivable from Directors",
--      QuickBooks says "Due from Directors". QuickBooks wins.
--   2. 66000 "Payroll Expenses" (Expense) is real and active in the
--      client's file but was never in the reference sheet at all — a
--      different account from 24000 "Payroll Liabilities", which the
--      sheet does have and which matches. Added as a real, postable head.
--   3. 80000 "Ask My Accountant" is in the reference sheet (one of the
--      "QuickBooks makes this itself" placeholders, assumed present the
--      way 24000/30000 genuinely are) — but this real file does not have
--      it. Removed; nothing here ever posted to it (is_head was already
--      false).
--
-- NOT restored, on purpose: 10400/10410/10420 ("Cash with Directors") still
-- appear in the real file too, but HIDDEN=Y — QuickBooks's own record of
-- exactly the correction 12600/12610/12620 already makes (10410's own
-- description there: "Replaces 10410... moved by JV"). Reintroducing them
-- would resurrect the bug ("director cash treated as company cash") this
-- task's own brief cites as already corrected once.
--
-- Applies to every company that was seeded before this fix (Awami,
-- ZZTEST-NF-DEMO) — any company seeded after this migration already gets
-- it right, from the corrected seed source.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.nf_accounts SET name = 'Due from Directors' WHERE code = '12600' AND name = 'Receivable from Directors';

DELETE FROM public.nf_accounts WHERE code = '80000' AND name = 'Ask My Accountant';

INSERT INTO public.nf_accounts (company_id, code, name, qb_type, parent_code, description, is_head, via, via_label, sort, active, requires_party)
SELECT c.company_id, '66000', 'Payroll Expenses', 'Expense', NULL, 'Payroll expenses', true, NULL, NULL,
       (SELECT COALESCE(max(sort), 0) + 1 FROM public.nf_accounts x WHERE x.company_id = c.company_id),
       true, false
  FROM (SELECT DISTINCT company_id FROM public.nf_accounts) c
 WHERE NOT EXISTS (SELECT 1 FROM public.nf_accounts a WHERE a.company_id = c.company_id AND a.code = '66000');

COMMIT;
