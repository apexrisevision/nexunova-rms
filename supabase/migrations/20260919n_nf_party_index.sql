-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19n · Party index on legs
--
-- From the blueprint Part I scale measurement (docs/PLAN.md §31): at 104,000
-- legs the party statement did a sequential scan over every leg of the
-- company (nf_voucher_legs is indexed by account and by voucher, never by
-- party) — 1,236 ms; with this index, 36 ms, same 260 entries, measured in
-- the same rolled-back transaction. Partial (party_id IS NOT NULL) because
-- most legs carry no party and never will (§27.6). Purely additive and
-- reversible (DROP INDEX); no function, grant or data changes.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS nf_voucher_legs_party_idx
  ON public.nf_voucher_legs (company_id, party_id)
  WHERE party_id IS NOT NULL;

COMMIT;
