-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance v1 · a · tables, keys, row security, grants
--
-- The daily cash & bank closing, rebuilt small (docs/PLAN.md). New nf_ tables
-- only: nothing here reads, alters or references the old cash_* build, and
-- nothing touches a table KBH or FMH use (companies and auth.users are only
-- referenced by foreign key).
--
-- The rules R1–R8 live in 20260916b (triggers). This file holds the ones a
-- column or CHECK can carry on its own. There are no DEFAULTs on business
-- columns — ids, timestamps, version counters and nf_settings only (R8).
--
-- Money is numeric(14,2): two decimals, compared exactly (owner, 2026-09-16).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── members: who may do what, per company ──────────────────────────────────
CREATE TABLE public.nf_members (
  company_id    uuid        NOT NULL REFERENCES public.companies(id),
  user_id       uuid        NOT NULL REFERENCES auth.users(id),
  role          text        NOT NULL CHECK (role IN ('accountant','director','viewer')),
  display_name  text        NOT NULL CHECK (btrim(display_name) <> ''),
  active        boolean     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz,
  updated_by    uuid,
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX nf_members_user_idx ON public.nf_members (user_id) WHERE active;

-- ── settings ───────────────────────────────────────────────────────────────
CREATE TABLE public.nf_settings (
  company_id               uuid          PRIMARY KEY REFERENCES public.companies(id),
  large_payment_threshold  numeric(14,2) NOT NULL DEFAULT 50000 CHECK (large_payment_threshold > 0),
  pdc_due_days             integer       NOT NULL DEFAULT 7     CHECK (pdc_due_days BETWEEN 0 AND 60),
  company_line             text          NOT NULL CHECK (btrim(company_line) <> ''),
  report_title             text          NOT NULL CHECK (btrim(report_title) <> ''),
  mark                     text          NOT NULL CHECK (btrim(mark) <> ''),
  updated_at               timestamptz,
  updated_by               uuid
);

-- ── chart of accounts ──────────────────────────────────────────────────────
-- is_head: may be chosen as the head of a receipt or payment (a postable leaf).
-- via:     this account IS one of the three money positions. Only those three.
-- A head can never be a via, and a via can never be a head (R4).
CREATE TABLE public.nf_accounts (
  company_id   uuid    NOT NULL REFERENCES public.companies(id),
  code         text    NOT NULL,
  name         text    NOT NULL CHECK (btrim(name) <> ''),
  qb_type      text    NOT NULL CHECK (qb_type IN (
                 'Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset',
                 'Accounts Payable','Credit Card','Other Current Liability','Long Term Liability',
                 'Equity','Income','Cost of Goods Sold','Expense','Other Income','Other Expense')),
  parent_code  text,
  description  text,
  is_head      boolean NOT NULL,
  via          text    CHECK (via IN ('Cash','Petty','Bank')),
  via_label    text,   -- the sheet's own short name: 'Cash in hand', 'Petty cash', 'Bank Al-Habib'
  sort         integer NOT NULL,
  active       boolean NOT NULL,
  PRIMARY KEY (company_id, code),
  CONSTRAINT nf_accounts_code_shape   CHECK (code ~ '^[0-9]{5}$'),
  -- 10400/10410/10420 were cash with directors in the sheet; the owner moved
  -- them to 12600/12610/12620 as receivables (2026-09-16). The old numbers
  -- must not come back as anything.
  CONSTRAINT nf_accounts_no_104       CHECK (code !~ '^104'),
  CONSTRAINT nf_accounts_head_not_via CHECK (NOT (is_head AND via IS NOT NULL)),
  CONSTRAINT nf_accounts_via_is_bank_type CHECK (via IS NULL OR qb_type = 'Bank'),
  CONSTRAINT nf_accounts_via_label    CHECK ((via IS NULL) = (via_label IS NULL)),
  CONSTRAINT nf_accounts_one_per_via  UNIQUE (company_id, via),
  CONSTRAINT nf_accounts_parent_fk    FOREIGN KEY (company_id, parent_code)
                                      REFERENCES public.nf_accounts (company_id, code)
);

-- ── floors (QuickBooks classes) ────────────────────────────────────────────
CREATE TABLE public.nf_floors (
  company_id  uuid    NOT NULL REFERENCES public.companies(id),
  code        text    NOT NULL CHECK (btrim(code) <> ''),
  qb_class    text    NOT NULL CHECK (btrim(qb_class) <> ''),
  sort        integer NOT NULL,
  PRIMARY KEY (company_id, code)
);

-- ── director report categories (the reference's catIn / catOut, as data) ──
CREATE TABLE public.nf_report_categories (
  company_id  uuid    NOT NULL REFERENCES public.companies(id),
  side        text    NOT NULL CHECK (side IN ('IN','OUT')),
  priority    integer NOT NULL,
  match_kind  text    NOT NULL CHECK (match_kind IN ('exact','prefix','fallback')),
  pattern     text,
  label       text    NOT NULL CHECK (btrim(label) <> ''),
  PRIMARY KEY (company_id, side, priority),
  CHECK ((match_kind = 'fallback') = (pattern IS NULL))
);
CREATE UNIQUE INDEX nf_report_categories_one_fallback
  ON public.nf_report_categories (company_id, side) WHERE match_kind = 'fallback';

-- ── days ───────────────────────────────────────────────────────────────────
CREATE TABLE public.nf_days (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id),
  business_date       date          NOT NULL,
  closing_no          text          NOT NULL CHECK (btrim(closing_no) <> ''),
  status              text          NOT NULL CHECK (status IN ('OPEN','SUBMITTED','CLOSED')),

  -- R5: a typed opening exists on the first day and nowhere else.
  is_first_day        boolean       NOT NULL,
  typed_open_cash     numeric(14,2) CHECK (typed_open_cash  >= 0),
  typed_open_petty    numeric(14,2) CHECK (typed_open_petty >= 0),
  typed_open_bank     numeric(14,2) CHECK (typed_open_bank  >= 0),

  -- The two transfers the reference has: one figure each, per day. NULL = blank.
  transfer_to_bank    numeric(14,2) CHECK (transfer_to_bank  > 0),
  transfer_to_petty   numeric(14,2) CHECK (transfer_to_petty > 0),

  -- Cash count. denominations holds only the fields somebody filled in;
  -- NULL means "not counted". counted_cash is derived by trigger, never sent.
  denominations       jsonb,
  counted_cash        numeric(14,2),

  remarks             text,
  prepared_by         uuid,
  prepared_by_name    text,

  submitted_by        uuid,
  submitted_at        timestamptz,
  closed_by           uuid,
  closed_at           timestamptz,
  close_cash          numeric(14,2),
  close_petty         numeric(14,2),
  close_bank          numeric(14,2),
  variance            numeric(14,2),
  variance_reason     text,
  last_return_reason  text,
  last_reopen_reason  text,
  reopen_count        integer       NOT NULL DEFAULT 0,

  version             integer       NOT NULL DEFAULT 0,
  created_by          uuid          NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_by          uuid,
  updated_at          timestamptz,

  CONSTRAINT nf_days_company_id_key   UNIQUE (company_id, id),
  CONSTRAINT nf_days_one_per_date     UNIQUE (company_id, business_date),
  CONSTRAINT nf_days_closing_no_key   UNIQUE (company_id, closing_no),
  CONSTRAINT nf_days_typed_opening_first_day_only CHECK (
    (is_first_day AND typed_open_cash IS NOT NULL AND typed_open_petty IS NOT NULL AND typed_open_bank IS NOT NULL)
    OR (NOT is_first_day AND typed_open_cash IS NULL AND typed_open_petty IS NULL AND typed_open_bank IS NULL)),
  CONSTRAINT nf_days_count_pair       CHECK ((denominations IS NULL) = (counted_cash IS NULL)),
  CONSTRAINT nf_days_closed_has_snapshot CHECK (
    (status = 'CLOSED') = (close_cash IS NOT NULL AND close_petty IS NOT NULL AND close_bank IS NOT NULL
                           AND variance IS NOT NULL AND closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  -- R1, belt and braces: a closed snapshot can never be negative.
  CONSTRAINT nf_days_snapshot_not_negative CHECK (close_cash >= 0 AND close_petty >= 0 AND close_bank >= 0),
  -- R6: a variance close carries its reason, and only a variance close does.
  CONSTRAINT nf_days_variance_reason  CHECK (
    (variance_reason IS NOT NULL) = (status = 'CLOSED' AND variance <> 0)
    AND (variance_reason IS NULL OR btrim(variance_reason) <> ''))
);
CREATE UNIQUE INDEX nf_days_one_first_day ON public.nf_days (company_id) WHERE is_first_day;
CREATE UNIQUE INDEX nf_days_one_unclosed  ON public.nf_days (company_id) WHERE status <> 'CLOSED';

-- ── receipt and payment lines ──────────────────────────────────────────────
CREATE TABLE public.nf_lines (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid          NOT NULL,
  day_id       uuid          NOT NULL,
  side         text          NOT NULL CHECK (side IN ('IN','OUT')),
  voucher_no   text          NOT NULL,
  voucher_key  text          GENERATED ALWAYS AS (upper(btrim(voucher_no))) STORED,
  description  text,
  head_code    text          NOT NULL,
  floor_code   text          NOT NULL,
  via          text          NOT NULL CHECK (via IN ('Cash','Petty','Bank')),
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  sort         integer       NOT NULL,
  version      integer       NOT NULL DEFAULT 0,
  created_by   uuid          NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_by   uuid,
  updated_at   timestamptz,

  CONSTRAINT nf_lines_day_fk   FOREIGN KEY (company_id, day_id) REFERENCES public.nf_days (company_id, id),
  CONSTRAINT nf_lines_head_fk  FOREIGN KEY (company_id, head_code)  REFERENCES public.nf_accounts (company_id, code),
  CONSTRAINT nf_lines_floor_fk FOREIGN KEY (company_id, floor_code) REFERENCES public.nf_floors (company_id, code),
  -- R2: unique per tenant across every day, compared trimmed and upper-cased.
  CONSTRAINT nf_lines_voucher_unique UNIQUE (company_id, voucher_key),
  -- Owner Q9: receipts CRV/BRV, payments CPV/BPV …
  CONSTRAINT nf_lines_voucher_prefix CHECK (
    (side = 'IN'  AND upper(btrim(voucher_no)) ~ '^(CRV|BRV)-[^[:space:]]+$') OR
    (side = 'OUT' AND upper(btrim(voucher_no)) ~ '^(CPV|BPV)-[^[:space:]]+$')),
  -- … and C = Cash or Petty, B = Bank. Judged only once the prefix itself is
  -- C or B, so a bad prefix is reported as a bad prefix.
  CONSTRAINT nf_lines_voucher_matches_via CHECK (
    left(upper(btrim(voucher_no)), 1) NOT IN ('C','B')
    OR (left(upper(btrim(voucher_no)), 1) = 'C') = (via IN ('Cash','Petty')))
);
CREATE INDEX nf_lines_day_idx ON public.nf_lines (day_id, sort);

-- ── post-dated cheques: one running register ───────────────────────────────
CREATE TABLE public.nf_pdcs (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid          NOT NULL,
  direction        text          NOT NULL CHECK (direction IN ('RECEIVED','ISSUED')),
  cheque_no        text          NOT NULL CHECK (btrim(cheque_no) <> ''),
  party            text,
  bank             text,
  due_date         date          NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  entered_day_id   uuid          NOT NULL,
  status           text          NOT NULL CHECK (status IN ('PENDING','CLEARED','BOUNCED','CANCELLED')),
  resolved_day_id  uuid,
  version          integer       NOT NULL DEFAULT 0,
  created_by       uuid          NOT NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_by       uuid,
  updated_at       timestamptz,
  CONSTRAINT nf_pdcs_entered_fk  FOREIGN KEY (company_id, entered_day_id)  REFERENCES public.nf_days (company_id, id),
  CONSTRAINT nf_pdcs_resolved_fk FOREIGN KEY (company_id, resolved_day_id) REFERENCES public.nf_days (company_id, id),
  CONSTRAINT nf_pdcs_resolution  CHECK ((status = 'PENDING') = (resolved_day_id IS NULL))
);
CREATE INDEX nf_pdcs_company_idx ON public.nf_pdcs (company_id, status, due_date);

-- ── audit: every change, old and new ───────────────────────────────────────
CREATE TABLE public.nf_audit (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  uuid        NOT NULL,
  day_id      uuid,
  entity      text        NOT NULL,
  entity_id   text        NOT NULL,
  action      text        NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','SUBMIT','CLOSE',
                                   'CLOSE_WITH_VARIANCE','RETURN','REOPEN')),
  actor       uuid,
  actor_name  text,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  before      jsonb,
  after       jsonb,
  reason      text
);
CREATE INDEX nf_audit_day_idx     ON public.nf_audit (day_id, id);
CREATE INDEX nf_audit_company_idx ON public.nf_audit (company_id, id);

-- ── row security and grants ────────────────────────────────────────────────
-- Every write goes through a SECURITY DEFINER function. The table grants that
-- Supabase's default privileges hand to anon and authenticated are taken back;
-- authenticated keeps SELECT only, and row security narrows that to members.
DO $grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nf_members','nf_settings','nf_accounts','nf_floors','nf_report_categories',
                           'nf_days','nf_lines','nf_pdcs','nf_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END
$grants$;

-- Membership test for policies. It must be executable by authenticated
-- because policies run as the caller; it answers only about the caller.
CREATE FUNCTION public.nf_is_member(p_company_id uuid, p_director_only boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nf_members m
     WHERE m.company_id = p_company_id
       AND m.user_id = auth.uid()
       AND m.active
       AND (NOT p_director_only OR m.role = 'director'));
$$;
REVOKE ALL ON FUNCTION public.nf_is_member(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_is_member(uuid, boolean) TO authenticated;

CREATE POLICY nf_members_read   ON public.nf_members           FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_settings_read  ON public.nf_settings          FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_accounts_read  ON public.nf_accounts          FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_floors_read    ON public.nf_floors            FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_categories_read ON public.nf_report_categories FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_days_read      ON public.nf_days              FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_lines_read     ON public.nf_lines             FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_pdcs_read      ON public.nf_pdcs              FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
CREATE POLICY nf_audit_read     ON public.nf_audit             FOR SELECT TO authenticated USING (public.nf_is_member(company_id, true));

COMMIT;
