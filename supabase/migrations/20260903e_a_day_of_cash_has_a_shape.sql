-- ═══════════════════════════════════════════════════════════════════════════
-- A day of cash has a shape
-- ───────────────────────────────────────────────────────────────────────────
-- The Daily Closing cash book: one place where every rupee entering or leaving
-- a project is recorded once, verified, locked and routed. This migration is
-- the shape only — tables, keys, checks, indexes. No behaviour, no seed data,
-- no service, no screen. The immutability guard and the audit wiring are the
-- next file (20260903f); the CFO privilege is the one after (20260903g).
--
-- What this is NOT. RMS does not become an accounting system. There is no
-- general ledger here, no P&L, no balance sheet, no financial statement.
-- QuickBooks stays the book of record. This is capture → verify → lock →
-- route, and the schema is deliberately incapable of anything more: nothing
-- below totals an ACCOUNT, only a day's own rows.
--
-- Spec: docs/daily-closing/BLUEPRINT.md §A6 · rules and the RMS mapping in
-- docs/daily-closing/RULES.md (§0 decisions, invariants 1/7/8, section (c)).
-- Table-by-table summary: docs/daily-closing/SCHEMA.md.
--
-- Three conventions the blueprint does not state but this codebase requires:
--
--   company_id on EVERY table. RMS is multi-tenant before it is multi-site.
--   §A6 carries only project_id; every existing domain table carries both, and
--   every guard reads company first (wrong_tenant) and project second.
--
--   text + CHECK instead of native ENUM. Every status column in this database
--   is text with a CHECK — payments.status, sales.status, pdc_cheques.status,
--   approval_requests.status. A native enum here would be the only one, and
--   adding a value to it later is a lock where a CHECK is a rewrite of one
--   constraint.
--
--   numeric(18,2), not bare numeric. RMS money columns are unconstrained
--   numeric, which is exact but unscaled — it will accept 0.004. A cash book
--   that reports a three-tenths-of-a-paisa variance no cashier can explain is
--   worse than no cash book. Scale is fixed here at the column.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── qb_accounts ────────────────────────────────────────────────────────────
-- The QuickBooks chart, mirrored so an entry can point at a head by id rather
-- than by a typed string (invariant 6). Names must match the QuickBooks
-- company file exactly, and QuickBooks caps an account name at 31 characters —
-- so does the CHECK, rather than letting a 40-character name be entered here
-- and rejected at import.
CREATE TABLE IF NOT EXISTS public.qb_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  number        char(4) NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 31),
  qb_type       text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qb_accounts_number_unique UNIQUE (company_id, number),
  CONSTRAINT qb_accounts_name_unique   UNIQUE (company_id, name)
);

COMMENT ON TABLE public.qb_accounts IS
  'Mirror of the QuickBooks chart of accounts, per tenant. Selected from, never typed (BLUEPRINT invariant 6). name is capped at 31 chars because QuickBooks is.';

-- ── cash_accounts ──────────────────────────────────────────────────────────
-- Where the money physically sits: a drawer or a bank account, per project.
--
-- Deliberately a NEW table rather than an extension of project_bank_accounts,
-- reversing the recommendation in RULES.md section (c). A cash drawer is not a
-- bank account: project_bank_accounts is all account_title / account_no / iban
-- / branch, and modelling "Cash in Hand" as a row in it would leave every one
-- of those columns empty and lying. bank_account_id below lets a BANK row
-- point at the existing master instead of copying it, so there is still one
-- place a bank account is described.
CREATE TABLE IF NOT EXISTS public.cash_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  project_id      uuid NOT NULL REFERENCES public.projects(id),
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('CASH','BANK')),
  qb_account_id   uuid REFERENCES public.qb_accounts(id),
  bank_account_id uuid REFERENCES public.project_bank_accounts(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_accounts_name_unique UNIQUE (project_id, kind, name),
  CONSTRAINT cash_accounts_bank_link CHECK (kind = 'BANK' OR bank_account_id IS NULL)
);

COMMENT ON TABLE public.cash_accounts IS
  'A cash drawer or bank account, per project. Separate from project_bank_accounts because a drawer is not a bank account; BANK rows may reference one via bank_account_id.';

-- ── payees ─────────────────────────────────────────────────────────────────
-- RMS has clients (buyers) and agents (dealers) and nothing at all for the
-- electricity company, the security guard or the stationer. This is that
-- master. Invariant 6 means a name is chosen from here, never typed into an
-- entry.
--
-- normalized_name is GENERATED — "PESCO " and "pesco" cannot both exist.
-- ⚠️ scripts/backup-full.js must EXCLUDE generated columns from its INSERT
-- column list, or the restore fails on this table.
CREATE TABLE IF NOT EXISTS public.payees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  project_id      uuid REFERENCES public.projects(id),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  normalized_name text GENERATED ALWAYS AS
                  (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  kind            text NOT NULL CHECK (kind IN ('CUSTOMER','VENDOR','STAFF','DEALER','OTHER')),
  client_id       uuid REFERENCES public.clients(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payees_client_link CHECK (kind = 'CUSTOMER' OR client_id IS NULL)
);

-- §A6 writes this as UNIQUE(COALESCE(project_id,0), normalized_name); project_id
-- is a uuid here, so the sentinel is the nil uuid. A NULL project_id means the
-- payee is company-wide.
CREATE UNIQUE INDEX IF NOT EXISTS payees_name_unique
  ON public.payees (company_id,
                    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    normalized_name);

COMMENT ON TABLE public.payees IS
  'Vendor / staff / customer / dealer master for the cash book. A CUSTOMER payee may point at a real RMS client via client_id so the cash book and the client register cannot drift into two spellings of one person.';

-- ── entry_type_defaults ────────────────────────────────────────────────────
-- Invariant 5 lives here rather than in code: a CLIENT_RECEIPT defaults to
-- 2020 Advance from Customers, and any other head requires a written reason.
CREATE TABLE IF NOT EXISTS public.entry_type_defaults (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id),
  entry_type             text NOT NULL CHECK (entry_type IN
                           ('CLIENT_RECEIPT','EXPENSE','TRANSFER','LOAN_CAPITAL','OTHER')),
  default_qb_account_id  uuid REFERENCES public.qb_accounts(id),
  suggested_qb_types     jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT entry_type_defaults_unique UNIQUE (company_id, entry_type)
);

-- ── cash_days ──────────────────────────────────────────────────────────────
-- One row per project per business date. business_date is a DATE in
-- Asia/Karachi; every timestamp on it is UTC. Nothing in this file computes
-- "today" — that belongs to the service layer, and it must not use td() or
-- CURRENT_DATE, both of which are UTC (see RULES risk 2).
CREATE TABLE IF NOT EXISTS public.cash_days (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  project_id       uuid NOT NULL REFERENCES public.projects(id),
  business_date    date NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  is_setup_opening boolean NOT NULL DEFAULT false,
  opening_cash     numeric(18,2) NOT NULL DEFAULT 0,
  opening_bank     numeric(18,2) NOT NULL DEFAULT 0,
  closing_cash     numeric(18,2),
  closing_bank     numeric(18,2),
  counted_cash     numeric(18,2),
  variance         numeric(18,2),
  variance_note    text,
  denominations    jsonb,
  closed_by        uuid REFERENCES public.app_users(id),
  closed_at        timestamptz,
  version          integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES public.app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_days_one_per_date UNIQUE (project_id, business_date),

  -- A closed day is a complete day. Nothing may reach CLOSED half-filled.
  CONSTRAINT cash_days_closed_is_complete CHECK (
    status <> 'CLOSED' OR (closing_cash IS NOT NULL AND closing_bank IS NOT NULL
                       AND counted_cash IS NOT NULL AND closed_at  IS NOT NULL
                       AND closed_by    IS NOT NULL)),

  -- §A4: CloseDay requires variance == 0 OR variance_note. The rule is here so
  -- it holds even if a future service forgets to ask.
  CONSTRAINT cash_days_variance_explained CHECK (
    status <> 'CLOSED' OR variance = 0
                       OR (variance_note IS NOT NULL AND btrim(variance_note) <> ''))
);

-- Invariant: at most one OPEN day per project (§A4 guard).
CREATE UNIQUE INDEX IF NOT EXISTS cash_days_one_open_per_project
  ON public.cash_days (project_id) WHERE status = 'OPEN';

-- Invariant 2: one setup opening per project, ever.
CREATE UNIQUE INDEX IF NOT EXISTS cash_days_setup_opening_once
  ON public.cash_days (project_id) WHERE is_setup_opening;

-- The required index from the P1 brief. cash_days_one_per_date already indexes
-- (project_id, business_date); this is named separately so the brief's list can
-- be checked off against pg_indexes without reading constraint names.
CREATE INDEX IF NOT EXISTS cash_days_project_date_idx
  ON public.cash_days (project_id, business_date DESC);

COMMENT ON COLUMN public.cash_days.business_date IS
  'The business date in Asia/Karachi. NOT derived from CURRENT_DATE, which is UTC on this platform and would file five hours of every night under the wrong day.';
COMMENT ON COLUMN public.cash_days.version IS
  'Optimistic lock for CloseDay. The closer sends the version it read; a mismatch is VERSION_CONFLICT.';

-- ── qb_exports ─────────────────────────────────────────────────────────────
-- Invariant 4: a day exports once. The unique index is the enforcement; the
-- service returning ALREADY_EXPORTED is the courtesy.
CREATE TABLE IF NOT EXISTS public.qb_exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  project_id   uuid NOT NULL REFERENCES public.projects(id),
  cash_day_id  uuid NOT NULL REFERENCES public.cash_days(id),
  file_name    text NOT NULL,
  storage_key  text NOT NULL,
  entry_count  integer NOT NULL CHECK (entry_count >= 0),
  checksum     text NOT NULL,
  exported_by  uuid REFERENCES public.app_users(id),
  exported_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qb_exports_one_per_day UNIQUE (cash_day_id)
);

-- ── cash_entries ───────────────────────────────────────────────────────────
-- The cash book itself. A saved row is a fact (invariant 1): the guard that
-- enforces that is in 20260903f, but the shape assumes it — there is no
-- updated_at, because nothing updates except the five routing columns.
--
-- Two additions to §A6 worth naming:
--   sale_id — RMS money is keyed to the SALE, not the unit. payments.sale_id is
--   NOT NULL and installments hang off sale_id; a resold unit has more than one
--   sale, so unit_id alone cannot say which account was paid.
--   cash_account_id — which drawer or account the movement actually touched.
CREATE TABLE IF NOT EXISTS public.cash_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id),
  project_id           uuid NOT NULL REFERENCES public.projects(id),
  cash_day_id          uuid NOT NULL REFERENCES public.cash_days(id),
  seq_no               integer NOT NULL,
  idempotency_key      uuid NOT NULL,

  entry_type           text NOT NULL CHECK (entry_type IN
                         ('CLIENT_RECEIPT','EXPENSE','TRANSFER','LOAN_CAPITAL','OTHER')),
  mode                 text CHECK (mode IN ('CASH','BANK')),
  direction            text CHECK (direction IN ('IN','OUT')),
  voucher_type         text NOT NULL CHECK (voucher_type IN ('CRV','CPV','BRV','BPV','JV')),
  voucher_no           text NOT NULL CHECK (btrim(voucher_no) <> '' AND length(voucher_no) <= 40),
  amount               numeric(18,2) NOT NULL CHECK (amount > 0),
  narration            text CHECK (length(narration) <= 500),

  payee_id             uuid REFERENCES public.payees(id),
  unit_id              uuid REFERENCES public.units(id),
  sale_id              uuid REFERENCES public.sales(id),
  cash_account_id      uuid REFERENCES public.cash_accounts(id),

  qb_account_id        uuid REFERENCES public.qb_accounts(id),
  qb_override_reason   text CHECK (length(qb_override_reason) <= 300),
  qb_debit_account_id  uuid REFERENCES public.qb_accounts(id),
  qb_credit_account_id uuid REFERENCES public.qb_accounts(id),

  allocation_kind      text CHECK (allocation_kind IN ('DP','INSTALLMENT','ADVANCE','OTHER')),
  allocation_ref       text CHECK (length(allocation_ref) <= 40),
  expected_amount      numeric(18,2) CHECK (expected_amount IS NULL OR expected_amount > 0),
  variance_tag         text CHECK (variance_tag IN ('SHORT','OVER','ADVANCE','OTHER')),
  variance_note        text CHECK (length(variance_note) <= 300),

  rms_status           text NOT NULL CHECK (rms_status IN
                         ('NA','PENDING','POSTED','UNAPPLIED','REFUNDED')),
  rms_receipt_ref      text CHECK (length(rms_receipt_ref) <= 64),
  rms_status_reason    text CHECK (length(rms_status_reason) <= 300),

  qb_status            text NOT NULL DEFAULT 'NOT_EXPORTED'
                         CHECK (qb_status IN ('NOT_EXPORTED','EXPORTED')),
  qb_export_id         uuid REFERENCES public.qb_exports(id),

  is_adjustment        boolean NOT NULL DEFAULT false,
  adjusts_entry_id     uuid REFERENCES public.cash_entries(id),
  adjustment_reason    text CHECK (length(adjustment_reason) <= 300),
  transfer_group_id    uuid,

  created_by           uuid REFERENCES public.app_users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cash_entries_seq_unique  UNIQUE (cash_day_id, seq_no),
  CONSTRAINT cash_entries_idem_unique UNIQUE (company_id, project_id, idempotency_key),

  -- §A6: an adjustment always carries its reason.
  CONSTRAINT cash_entries_adjustment_reason CHECK (
    is_adjustment = false OR (adjustment_reason IS NOT NULL AND btrim(adjustment_reason) <> '')),

  -- §A6: mode/direction are NULL only for a JV, and a JV names both sides.
  CONSTRAINT cash_entries_jv_or_movement CHECK (
    (voucher_type =  'JV' AND mode IS NULL AND direction IS NULL
                          AND qb_debit_account_id IS NOT NULL
                          AND qb_credit_account_id IS NOT NULL
                          AND qb_debit_account_id <> qb_credit_account_id)
    OR
    (voucher_type <> 'JV' AND mode IS NOT NULL AND direction IS NOT NULL
                          AND qb_debit_account_id IS NULL
                          AND qb_credit_account_id IS NULL)),

  -- §A12: the voucher chip is DERIVED from mode + direction. Storing it and
  -- deriving it must never disagree, so the derivation is a constraint.
  CONSTRAINT cash_entries_voucher_matches_movement CHECK (
    voucher_type = 'JV'
    OR (mode = 'CASH' AND direction = 'IN'  AND voucher_type = 'CRV')
    OR (mode = 'CASH' AND direction = 'OUT' AND voucher_type = 'CPV')
    OR (mode = 'BANK' AND direction = 'IN'  AND voucher_type = 'BRV')
    OR (mode = 'BANK' AND direction = 'OUT' AND voucher_type = 'BPV')),

  -- §A8: UNIT_REQUIRED. Client money is always against a unit.
  CONSTRAINT cash_entries_client_receipt_unit CHECK (
    entry_type <> 'CLIENT_RECEIPT' OR unit_id IS NOT NULL),

  -- §A8: VARIANCE_TAG_REQUIRED. If an expectation was recorded and the money
  -- did not match it, the difference is named.
  CONSTRAINT cash_entries_variance_tagged CHECK (
    expected_amount IS NULL OR expected_amount = amount OR variance_tag IS NOT NULL),

  -- §A4: rms_status NA is for non-client entries and only those.
  CONSTRAINT cash_entries_rms_status_scope CHECK (
    (entry_type =  'CLIENT_RECEIPT' AND rms_status <> 'NA')
    OR
    (entry_type <> 'CLIENT_RECEIPT' AND rms_status =  'NA')),

  -- Invariant 4: EXPORTED and a file reference are the same fact.
  CONSTRAINT cash_entries_qb_export_link CHECK (
    (qb_status = 'EXPORTED') = (qb_export_id IS NOT NULL)),

  -- An adjustment points at what it adjusts; a plain entry does not.
  CONSTRAINT cash_entries_adjusts_link CHECK (
    is_adjustment = true OR adjusts_entry_id IS NULL)
);

-- §A6: the physical voucher book is unique per project and type. Adjustments
-- and JVs are auto-numbered and excluded, exactly as written.
CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_voucher_unique
  ON public.cash_entries (project_id, voucher_type, voucher_no)
  WHERE is_adjustment = false;

-- The three indexes named in the P1 brief.
CREATE INDEX IF NOT EXISTS cash_entries_day_seq_idx
  ON public.cash_entries (project_id, cash_day_id, seq_no);
CREATE INDEX IF NOT EXISTS cash_entries_qb_status_idx
  ON public.cash_entries (project_id, qb_status);
CREATE INDEX IF NOT EXISTS cash_entries_rms_status_idx
  ON public.cash_entries (project_id, rms_status);

COMMENT ON TABLE public.cash_entries IS
  'The cash book. A saved row is immutable except for the five routing columns (rms_status, rms_receipt_ref, rms_status_reason, qb_status, qb_export_id) — enforced by the trigger in 20260903f. There is deliberately no updated_at.';
COMMENT ON COLUMN public.cash_entries.sale_id IS
  'Added to §A6. RMS keys money to the sale, not the unit — a resold unit has more than one sale, so unit_id alone cannot say which account was paid.';

-- ── cash_entry_attachments ─────────────────────────────────────────────────
-- storage_key, not a public URL. RMS's prevailing habit is to upload to a
-- public bucket and store the public URL in a text column; §A10 requires these
-- private, read through short-lived signed URLs. The bucket itself is created
-- with the service layer, not here.
CREATE TABLE IF NOT EXISTS public.cash_entry_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  entry_id     uuid NOT NULL REFERENCES public.cash_entries(id),
  storage_key  text NOT NULL,
  mime         text NOT NULL CHECK (mime IN ('image/jpeg','image/png','application/pdf')),
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by  uuid REFERENCES public.app_users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_entry_attachments_entry_idx
  ON public.cash_entry_attachments (entry_id);

COMMENT ON COLUMN public.cash_entry_attachments.storage_key IS
  'Path inside the private daily-closing bucket. NOT a public URL — §A10 requires signed reads.';

-- ── receipt_counters ───────────────────────────────────────────────────────
-- Gapless receipt numbers, per project per year (§A7).
--
-- Kept as its own table rather than folded into voucher_sequences, reversing
-- the recommendation in RULES.md section (c): voucher_sequences is keyed
-- (company_id, prefix, year) — company-wide — and a per-project gapless series
-- cannot be derived from a company-wide counter. The locking pattern is
-- borrowed from it though: INSERT … ON CONFLICT DO UPDATE SET last_no =
-- last_no + 1 RETURNING last_no is a real row lock.
--
-- year is left as an integer without a calendar/fiscal ruling: §A7 writes
-- {SLUG}-R-{YYYY}-{000001} (calendar) while voucher_sequences uses a fiscal
-- label ('2627'). RULES.md (b) Q5 carries the open question.
CREATE TABLE IF NOT EXISTS public.receipt_counters (
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_no     integer NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  PRIMARY KEY (project_id, year)
);

-- ── client_receipts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  project_id   uuid NOT NULL REFERENCES public.projects(id),
  entry_id     uuid NOT NULL REFERENCES public.cash_entries(id),
  receipt_no   text NOT NULL,
  storage_key  text NOT NULL,
  rendered_at  timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  sent_to      text,
  CONSTRAINT client_receipts_one_per_entry UNIQUE (entry_id),
  CONSTRAINT client_receipts_no_unique     UNIQUE (project_id, receipt_no)
);

-- ── day_documents ──────────────────────────────────────────────────────────
-- The Director PDF, and every earlier version of it. §A13: a regeneration
-- after an adjustment increments version and keeps the prior file.
CREATE TABLE IF NOT EXISTS public.day_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  cash_day_id  uuid NOT NULL REFERENCES public.cash_days(id),
  kind         text NOT NULL CHECK (kind IN ('DIRECTOR_PDF')),
  version      integer NOT NULL CHECK (version >= 1),
  storage_key  text NOT NULL,
  rendered_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT day_documents_version_unique UNIQUE (cash_day_id, kind, version)
);

COMMENT ON TABLE public.day_documents IS
  'Rendered day documents. Written by the daily-closing-pdf edge function (Deno + pdf-lib); prior versions are never deleted.';

-- ── pdc_register ───────────────────────────────────────────────────────────
-- ⚠️ READ THIS BEFORE BUILDING ON IT. RMS already has a working post-dated
-- cheque register: pdc_cheques, with a page (js/pages/pdc.js), a feature flag,
-- an audit trigger, and RPCs that create a payment on clearing. This table is
-- created because §A6 and the P1 brief name it, but two registers for one
-- drawer of cheques is a reconciliation problem, and RULES.md (b) Q7 carries
-- the open question of which one survives. Nothing writes here yet.
CREATE TABLE IF NOT EXISTS public.pdc_register (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id),
  project_id        uuid NOT NULL REFERENCES public.projects(id),
  kind              text NOT NULL CHECK (kind IN ('RECEIVABLE','PAYABLE')),
  cheque_no         text NOT NULL,
  bank_name         text,
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),
  party_payee_id    uuid REFERENCES public.payees(id),
  unit_id           uuid REFERENCES public.units(id),
  due_date          date NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','CLEARED','BOUNCED')),
  cleared_entry_id  uuid REFERENCES public.cash_entries(id),
  bounce_note       text,
  created_by        uuid REFERENCES public.app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- §A4: clearing creates the linked entry; bouncing records why.
  CONSTRAINT pdc_register_cleared_link CHECK (
    (status = 'CLEARED') = (cleared_entry_id IS NOT NULL)),
  CONSTRAINT pdc_register_bounce_note CHECK (
    status <> 'BOUNCED' OR (bounce_note IS NOT NULL AND btrim(bounce_note) <> ''))
);

CREATE INDEX IF NOT EXISTS pdc_register_due_idx
  ON public.pdc_register (project_id, status, due_date);

COMMENT ON TABLE public.pdc_register IS
  'Blueprint §A6 PDC register. NOTE: public.pdc_cheques is the register RMS actually uses today — see docs/daily-closing/RULES.md (b) Q7 before writing to either.';

-- ── reconciliations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  project_id     uuid NOT NULL REFERENCES public.projects(id),
  business_date  date NOT NULL,
  module_cash    numeric(18,2) NOT NULL,
  module_bank    numeric(18,2) NOT NULL,
  qb_cash        numeric(18,2) NOT NULL,
  qb_bank        numeric(18,2) NOT NULL,
  diff_cash      numeric(18,2) NOT NULL,
  diff_bank      numeric(18,2) NOT NULL,
  notes          text,
  actor_id       uuid REFERENCES public.app_users(id),
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliations_one_per_date UNIQUE (project_id, business_date)
);

COMMENT ON TABLE public.reconciliations IS
  'A recorded comparison between this cash book and QuickBooks on a date. It stores what was compared; it does not compute an account balance — that is QuickBooks work.';

-- ── audit_logs gains project_id ────────────────────────────────────────────
-- Invariant 7 is served by the audit engine RMS already has: audit_logs, made
-- append-only by revoked grants in 20260706_phase2b_audit_hardening.sql and
-- written by audit_trigger_function() on 28 tables. The one thing it lacks for
-- invariant 8 is a project column, so a director cannot be shown the audit for
-- their own project alone. It is added here, nullable, because every existing
-- row predates it.
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS project_id uuid;

COMMENT ON COLUMN public.audit_logs.project_id IS
  'Filled by audit_trigger_function() from the audited row''s own project_id when it has one. Nullable: rows written before 2026-09-03, and rows from tables that are company-scoped only, have none.';

CREATE INDEX IF NOT EXISTS audit_logs_project_idx
  ON public.audit_logs (project_id, changed_at DESC) WHERE project_id IS NOT NULL;

-- ── The lockdown floor ─────────────────────────────────────────────────────
-- Every RMS table is RLS-enabled with a deny_all_anon policy and reachable only
-- through SECURITY DEFINER RPCs (PATH_B). New tables join that floor on the day
-- they are created, not on the day somebody remembers.
DO $lockdown$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qb_accounts','cash_accounts','payees','entry_type_defaults','cash_days',
    'qb_exports','cash_entries','cash_entry_attachments','receipt_counters',
    'client_receipts','day_documents','pdc_register','reconciliations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_all_anon ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY deny_all_anon ON public.%I
        FOR ALL TO anon, authenticated
        USING (false)
        WITH CHECK (false)
    $f$, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, PUBLIC', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$lockdown$;

COMMIT;
