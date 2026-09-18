-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · a · tables
--
-- Owner decision, 2026-09-18: single-entry (one head + one via per line) is
-- replaced by a real voucher/leg model. QuickBooks Desktop stays the book of
-- record; this is the entry-capture, control and (later) export layer.
--
-- nf_lines (the table) is renamed to nf_lines_legacy by 20260918d, which
-- migrates its rows into vouchers/legs, and nf_lines is then recreated as a
-- VIEW of the same name — the daily closing screen (nexufinance.html,
-- js/nf/nf-sheet.js) reads nf_lines and does not change.
--
-- Design decisions, and why:
--   · Legs, not a fixed 2-column debit/credit pair on one row: real vouchers
--     already need more than two legs (one receipt covering several units).
--   · via stays on nf_accounts (Cash/Petty/Bank), but those three accounts
--     become normal postable legs (is_head=true) instead of an implicit
--     "other side" of every line — a voucher now names BOTH sides.
--   · floor_code stays mandatory on every leg, non-cash legs included, per
--     the owner's explicit instruction, not just on the cash/bank leg.
--   · requires_party is data on nf_accounts (like entry_type_defaults was
--     data in the old build), not a hardcoded list of codes in a trigger —
--     extending which accounts need a party is then a data change.
--   · No opening-balance voucher against Opening Balance Equity this pass.
--     nf_days.typed_open_* stays a fixed, once-only genesis constant read by
--     nf_ledger_balance() as its base term — it is never chained from
--     another day's stored figure, which is the specific bug being fixed
--     (20260918b), so converting it into a real voucher is not required to
--     fix that bug. Recorded as a §D recommendation for later, not skipped
--     by oversight.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── parties ──────────────────────────────────────────────────────────────
-- Supersedes the retired `payees` table (4 rows platform-wide, never wired
-- into nf_lines). normalized_name and the alias table below exist because a
-- real person in this client's history already appeared as both "Rashid"
-- and "Rashid Mansoor", splitting one balance across two identities.
CREATE TABLE public.nf_parties (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL REFERENCES public.companies(id),
  name           text          NOT NULL CHECK (btrim(name) <> ''),
  normalized_name text         GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  kind           text          NOT NULL CHECK (kind IN ('customer','supplier','director','sister_company','staff','other')),
  is_active      boolean       NOT NULL DEFAULT true,
  created_by     uuid          NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid,
  updated_at     timestamptz,
  CONSTRAINT nf_parties_name_unique UNIQUE (company_id, normalized_name)
);
ALTER TABLE public.nf_parties ADD CONSTRAINT nf_parties_company_id_key UNIQUE (company_id, id);

CREATE TABLE public.nf_party_aliases (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL,
  party_id       uuid          NOT NULL,
  alias          text          NOT NULL CHECK (btrim(alias) <> ''),
  normalized_alias text        GENERATED ALWAYS AS (lower(regexp_replace(btrim(alias), '\s+', ' ', 'g'))) STORED,
  created_by     uuid          NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT nf_party_aliases_party_fk FOREIGN KEY (company_id, party_id) REFERENCES public.nf_parties (company_id, id),
  -- an alias can't collide with another party's own name or another alias —
  -- otherwise "Rashid" could resolve to two different people, the same bug
  -- the alias table exists to prevent, just moved one level down
  CONSTRAINT nf_party_aliases_unique UNIQUE (company_id, normalized_alias)
);

-- ── vouchers ─────────────────────────────────────────────────────────────
-- status: DRAFT while legs are still being assembled (not reachable from any
-- RPC this pass — every RPC in 20260918c creates and posts atomically — but
-- the state exists because a future multi-leg entry screen will build a
-- voucher leg-by-leg across separate calls and post it as its own step).
-- POSTED is the only state the daily closing sheet's RPCs ever produce.
-- day_id is nullable: a voucher belongs to a cash-book day when it came from
-- the daily closing screen; a future adjusting/month-end journal need not.
CREATE TABLE public.nf_vouchers (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL REFERENCES public.companies(id),
  day_id         uuid,
  voucher_no     text          NOT NULL,
  voucher_key    text          GENERATED ALWAYS AS (upper(btrim(voucher_no))) STORED,
  voucher_date   date          NOT NULL,
  narration      text,
  status         text          NOT NULL CHECK (status IN ('DRAFT','POSTED','VOID')),
  sort           integer       NOT NULL DEFAULT 0,  -- display order within its day, same role as nf_lines.sort had
  created_by     uuid          NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid,
  updated_at     timestamptz,
  posted_by      uuid,
  posted_at      timestamptz,
  version        integer       NOT NULL DEFAULT 0,
  CONSTRAINT nf_vouchers_id_company_key UNIQUE (id, company_id),  -- self-FK anchor for nf_voucher_legs, below
  CONSTRAINT nf_vouchers_voucher_unique UNIQUE (company_id, voucher_key),
  CONSTRAINT nf_vouchers_posted_has_stamp CHECK ((status = 'POSTED') = (posted_at IS NOT NULL AND posted_by IS NOT NULL)),
  CONSTRAINT nf_vouchers_day_fk FOREIGN KEY (company_id, day_id) REFERENCES public.nf_days (company_id, id)
);

-- ── legs ─────────────────────────────────────────────────────────────────
CREATE TABLE public.nf_voucher_legs (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL,
  voucher_id     uuid          NOT NULL,
  line_no        integer       NOT NULL,
  account_code   text          NOT NULL,
  party_id       uuid,
  floor_code     text          NOT NULL,
  debit          numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo           text,
  created_by     uuid          NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid,
  updated_at     timestamptz,
  CONSTRAINT nf_voucher_legs_voucher_fk FOREIGN KEY (voucher_id, company_id) REFERENCES public.nf_vouchers (id, company_id),
  CONSTRAINT nf_voucher_legs_account_fk FOREIGN KEY (company_id, account_code) REFERENCES public.nf_accounts (company_id, code),
  CONSTRAINT nf_voucher_legs_floor_fk   FOREIGN KEY (company_id, floor_code)  REFERENCES public.nf_floors (company_id, code),
  CONSTRAINT nf_voucher_legs_party_fk   FOREIGN KEY (company_id, party_id)    REFERENCES public.nf_parties (company_id, id),
  CONSTRAINT nf_voucher_legs_line_unique UNIQUE (voucher_id, line_no),
  -- exactly one of debit/credit is > 0, never both, never neither
  CONSTRAINT nf_voucher_legs_one_side CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX nf_voucher_legs_voucher_idx ON public.nf_voucher_legs (voucher_id, line_no);
-- the shape every balance/ledger query needs: an account's postings in date order
CREATE INDEX nf_voucher_legs_account_idx ON public.nf_voucher_legs (company_id, account_code)
  INCLUDE (debit, credit) WHERE true;
CREATE INDEX nf_vouchers_date_idx ON public.nf_vouchers (company_id, voucher_date) WHERE status = 'POSTED';
CREATE INDEX nf_vouchers_day_idx  ON public.nf_vouchers (day_id) WHERE day_id IS NOT NULL;
CREATE INDEX nf_parties_active_idx ON public.nf_parties (company_id, kind) WHERE is_active;

-- ── nf_accounts: postability and party-requiredness become real questions
--    a voucher leg asks, not an implicit single-entry assumption ──────────
ALTER TABLE public.nf_accounts ADD COLUMN requires_party boolean NOT NULL DEFAULT false;

-- GUARD CHANGE — flagged, not silent: nf_accounts_head_not_via
-- (CHECK (NOT (is_head AND via IS NOT NULL))) was a deliberate single-entry
-- guard: a via-account (Cash/Petty/Bank) could never be picked from the
-- "head" dropdown, because in that model via was always the IMPLICIT other
-- side of a line — a cashier choosing Cash-in-Hand as the head would have
-- been a same-account-both-sides nonsense entry. Under double-entry that
-- restriction is not just unneeded, it is actively wrong: a real transfer
-- between the bank and the till (debit Bank, credit Cash — no other head
-- involved at all) requires BOTH legs to be via-accounts acting as normal
-- postable heads. This is a direct, foreseeable consequence of the
-- owner's own double-entry decision, not a convenience shortcut — dropped
-- here, restored (with is_head reset back to false first) by
-- 20260918r_nf_de_rollback.sql if this migration is ever undone.
ALTER TABLE public.nf_accounts DROP CONSTRAINT nf_accounts_head_not_via;

-- Cash/Petty/Bank were never a "head" in the single-entry model (they were
-- the implicit other side of every line). A voucher now names both sides
-- explicitly, so these three become normal postable accounts too.
UPDATE public.nf_accounts SET is_head = true WHERE via IS NOT NULL;

-- Party is meaningful only where the account POOLS many counterparties
-- under one code — not everywhere the brief's account list mentioned.
-- 12610/12620 (director receivables) and 22100-22400 (inter-company) are
-- each already a dedicated, per-entity account — "Syed Yousaf Shah" IS the
-- party, "FMH" IS the party, a further party_id would be pure redundancy,
-- and worse, it would have blocked the real, everyday use of these exact
-- accounts as an nf_save_line head (a director's cash draw, entered
-- side=OUT head=12610 through today's screen — the very case this task's
-- brief cites as the corrected QuickBooks bug). Checked against the real
-- Awami chart before deciding this, not assumed.
--
-- 21100/21200/21300 (Token Money, Advertising-unit advances, Refunds
-- Payable) are genuinely different: one code covers many different named
-- customers, so only a party_id says which customer's balance moved.
-- These are also real, everyday nf_save_line heads today (the persistent
-- ZZTEST-NF-DEMO tenant's own sample data posts to 21100) — nf_save_line
-- gains an optional p_party_name parameter for exactly these three
-- (20260918c) so entering one still works through the same screen; see
-- docs/PLAN.md §11 for why collecting that name on-screen is flagged as
-- its own small, named follow-up rather than assumed solved here.
UPDATE public.nf_accounts SET requires_party = true WHERE code IN ('21100','21200','21300');

-- ── row security / grants, matching every other nf_ table ─────────────────
DO $grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nf_parties','nf_party_aliases','nf_vouchers','nf_voucher_legs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false))', t, t);
  END LOOP;
END
$grants$;

COMMIT;
