# Daily Closing — SCHEMA

What P1 creates, one line per table, plus the mechanisms that carry the invariants.

| Migration | Purpose |
|---|---|
| `supabase/migrations/20260903e_a_day_of_cash_has_a_shape.sql` | 13 tables, keys, CHECKs, indexes, `audit_logs.project_id`, RLS/grant floor |
| `supabase/migrations/20260903f_a_saved_entry_is_a_fact.sql` | immutability, day-lock and project guards; audit wiring |
| `supabase/migrations/20260903g_closing_the_day_is_not_an_everyday_permission.sql` | `_dc_is_cfo()` |
| `supabase/migrations/20260903r_rollback_the_cash_book.sql` | the down path (destructive; see its header) |
| `scripts/verify-daily-closing-schema.js` | runs all four inside `BEGIN … ROLLBACK` and asserts 22 things |

**Status: written and proven, NOT applied.** Nothing above has been run against the live
database outside a rolled-back transaction. See "Applying this" at the end.

---

## Tables

| Table | One line |
|---|---|
| `qb_accounts` | The QuickBooks chart mirrored per tenant, so a head is chosen by id and never typed; `name` capped at 31 chars because QuickBooks is. |
| `cash_accounts` | Where money physically sits — a drawer or a bank account — per project, `kind IN (CASH,BANK)`, optionally pointing at an existing `project_bank_accounts` row. |
| `payees` | The vendor / staff / customer / dealer master RMS never had; `normalized_name` is generated so "PESCO " and "pesco" cannot both exist. |
| `entry_type_defaults` | Which QuickBooks head each entry type defaults to — this is where invariant 5 lives, as data rather than as code. |
| `cash_days` | One row per project per business date, `OPEN` or `CLOSED`, carrying opening, closing, counted cash, variance, denominations and an optimistic-lock `version`. |
| `cash_entries` | The cash book itself: an immutable movement with a derived voucher type, two independent routing statuses, and no `updated_at` because nothing updates. |
| `cash_entry_attachments` | Bills and slips against an entry, held as a private storage key rather than a public URL. |
| `receipt_counters` | Gapless receipt numbers per project per year, incremented under a row lock. |
| `client_receipts` | One rendered receipt per approved client entry, numbered and retained. |
| `day_documents` | Every version of the Director PDF for a day; a regeneration adds a version and keeps the old file. |
| `qb_exports` | One export per day, with file name, checksum and entry count — the row that makes invariant 4 true. |
| `pdc_register` | Blueprint §A6's post-dated cheque register. ⚠️ `pdc_cheques` is the one RMS actually uses — see below. |
| `reconciliations` | A recorded comparison between this cash book and QuickBooks on a date; it stores what was compared and computes no balance. |
| `audit_logs` *(existing, altered)* | Gains a nullable `project_id` so a director can be shown the audit for their own project and no other. |

## The invariants, and where each one actually lives

| # | Invariant | Mechanism |
|---|---|---|
| 1 | Cash is a fact | **`cash_entries_immutable()`** on `BEFORE UPDATE OR DELETE` — rejects every DELETE, and any UPDATE touching anything but the five routing columns. Plus `cash_entries_no_truncate()` on `BEFORE TRUNCATE`, and revoked table grants. |
| 2 | Opening is derived | Partial unique indexes `cash_days_setup_opening_once` (one setup opening per project, ever) and `cash_days_one_open_per_project` (at most one OPEN day). Deriving the figure itself is service work — P2. |
| 3 | Close locks | **`cash_entries_day_guard()`** on `BEFORE INSERT` takes `SELECT … FOR UPDATE` on the day and raises `DAY_LOCKED` for a non-adjustment into a CLOSED day. `CHECK (is_adjustment = false OR adjustment_reason IS NOT NULL)` makes a reasonless adjustment impossible. |
| 4 | Export once | `UNIQUE (cash_day_id)` on `qb_exports`; `CHECK ((qb_status='EXPORTED') = (qb_export_id IS NOT NULL))` on `cash_entries`. |
| 5 | Receipts are advances | `entry_type_defaults` holds the default head per type. The override-reason requirement is a service check (P2) — it needs a lookup, which a CHECK cannot do. **Not yet enforced at the DB layer.** |
| 6 | Names from masters | FKs `payee_id → payees` and `qb_account_id → qb_accounts`. There is no free-text payee or account column to fall back to. |
| 7 | Everything is audited | The existing `audit_trigger_function()`, attached to all 12 new tables; `audit_logs` is append-only by revoked grants. Closing a day and posting an adjustment are flagged `is_sensitive`, and an adjustment's reason is carried into `audit_logs.reason`. |
| 8 | Project-scoped | `project_id NOT NULL` (and `company_id NOT NULL`) on every table; `cash_entries_day_guard()` refuses an entry whose project or company is not its day's; RLS `deny_all_anon` + revoked grants on all 13 tables. |

## Immutability — the mechanism chosen, and why

**A `BEFORE UPDATE OR DELETE` row trigger, `public.cash_entries_immutable()`.**

It diffs `to_jsonb(OLD)` against `to_jsonb(NEW)` and raises unless every changed key is in
`{rms_status, rms_receipt_ref, rms_status_reason, qb_status, qb_export_id}`. DELETE is
refused unconditionally. Error class is `23001 restrict_violation`, and the message names
the offending columns:

```
cash_entries is immutable: amount cannot be updated. Only rms_status,
rms_receipt_ref, rms_status_reason, qb_status, qb_export_id may change after
insert (invariant 1).
```

Why a trigger and not the model layer: **there is no model layer.** RMS has no ORM — the
front end calls `SECURITY DEFINER` RPCs and Postgres is the application server
(`ARCHITECTURE_NOTES.md` §1). A guard in JavaScript would be a guard the database does not
have, and the whole point of invariant 1 is that the row cannot be altered by anything,
including a future RPC written by someone who has not read this file.

Three ways around it exist and are accepted: a superuser can `ALTER TABLE … DISABLE
TRIGGER`, `service_role` holds the table grant, and a `postgres` session can drop the
function. All three are deliberate operator escape hatches, all three are logged by
`audit_logs`, and none is reachable from the application.

## Enums

Postgres native `ENUM` types are **not** used. Every status-like column is `text` with a
`CHECK`, matching every existing RMS status column (`payments.status`, `sales.status`,
`pdc_cheques.status`, `approval_requests.status`). A native enum here would be the only one
in the schema, and adding a value to one later takes a lock where rewriting a CHECK does not.

| Column | Values |
|---|---|
| `cash_days.status` | `OPEN` `CLOSED` |
| `cash_entries.entry_type` | `CLIENT_RECEIPT` `EXPENSE` `TRANSFER` `LOAN_CAPITAL` `OTHER` |
| `cash_entries.mode` | `CASH` `BANK` (NULL only for a JV) |
| `cash_entries.direction` | `IN` `OUT` (NULL only for a JV) |
| `cash_entries.voucher_type` | `CRV` `CPV` `BRV` `BPV` `JV` |
| `cash_entries.allocation_kind` | `DP` `INSTALLMENT` `ADVANCE` `OTHER` |
| `cash_entries.variance_tag` | `SHORT` `OVER` `ADVANCE` `OTHER` |
| `cash_entries.rms_status` | `NA` `PENDING` `POSTED` `UNAPPLIED` `REFUNDED` |
| `cash_entries.qb_status` | `NOT_EXPORTED` `EXPORTED` |
| `cash_accounts.kind` | `CASH` `BANK` |
| `payees.kind` | `CUSTOMER` `VENDOR` `STAFF` `DEALER` `OTHER` |
| `pdc_register.kind` / `.status` | `RECEIVABLE` `PAYABLE` / `PENDING` `CLEARED` `BOUNCED` |
| `day_documents.kind` | `DIRECTOR_PDF` |

## Constraints worth knowing about

Beyond the obvious NOT NULLs and FKs, these encode blueprint rules that would otherwise live
only in someone's memory:

- **`cash_entries_voucher_matches_movement`** — the voucher type is *derived* from mode +
  direction (CASH/IN→CRV, CASH/OUT→CPV, BANK/IN→BRV, BANK/OUT→BPV). §A12 shows the chip
  updating live on screen; storing it separately means the stored and derived values could
  disagree, so the derivation is a constraint.
- **`cash_entries_jv_or_movement`** — a JV has no mode or direction and names both accounts,
  which must differ; a movement has mode and direction and names neither.
- **`cash_entries_rms_status_scope`** — `NA` is for non-client entries and only those; a
  client receipt can never be `NA`.
- **`cash_entries_client_receipt_unit`** — `UNIT_REQUIRED` (§A8).
- **`cash_entries_variance_tagged`** — `VARIANCE_TAG_REQUIRED`: if an expectation was
  recorded and the money did not match it, the difference is named.
- **`cash_days_closed_is_complete`** / **`cash_days_variance_explained`** — nothing reaches
  `CLOSED` half-filled, and `VARIANCE_UNEXPLAINED` blocks the close.
- **`pdc_register_cleared_link`** — `CLEARED` and a linked entry are the same fact.

## Money and time

- **Money is `numeric(18,2)`.** RMS's existing money columns are bare `numeric`, which is
  exact but unscaled and will accept `0.004`. That is precisely the variance a cashier cannot
  explain, so scale is pinned at the column here. Verified by assertion 03 in the test script.
- **`business_date` is a `date`**, meant in Asia/Karachi. Nothing in P1 computes it.
  ⚠️ When the service layer arrives it must **not** use `td()` or Postgres `CURRENT_DATE` —
  both are UTC on this platform and would file the first five hours of every night under the
  previous day. `todayPK()` (`js/portal-givenleads.js:105`) is the shape to copy.
- **All timestamps are `timestamptz`**, stored UTC.

## Two deliberate departures from RULES.md section (c)

Section (c) of `RULES.md` recommended reusing an existing table in both cases. Building the
schema changed the answer, and the reasoning is recorded here rather than silently:

1. **`cash_accounts` is a new table, not an extension of `project_bank_accounts`.**
   A cash drawer is not a bank account. `project_bank_accounts` is `account_title` /
   `account_no` / `iban` / `branch`; a "Cash in Hand" row would leave every one of those
   empty and lying. `cash_accounts.bank_account_id` lets a BANK row reference the existing
   master instead of copying it, so a bank account is still described in one place.
   *(RULES (b) Q2 — which table wins — remains formally open.)*
2. **`receipt_counters` is a new table, not a `DCR` prefix in `voucher_sequences`.**
   `voucher_sequences` is keyed `(company_id, prefix, year)` — company-wide. A per-project
   gapless series cannot be derived from a company-wide counter. The *locking pattern* is
   borrowed from it (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), which is the part that
   was worth reusing. `year` is left an integer pending RULES (b) Q5: §A7 writes a calendar
   year, `voucher_sequences` uses a fiscal label (`2627`).

## ⚠️ Two registers for one drawer of cheques

`pdc_register` is created because §A6 and the P1 brief name it. **RMS already has
`pdc_cheques`** — with a page (`js/pages/pdc.js`), a feature flag, an audit trigger, and RPCs
where `mark_pdc_cleared` creates the payment on clearing. Nothing writes to `pdc_register`
yet, and nothing should until RULES (b) Q7 is answered. If the answer is "reuse", the
rollback drops `pdc_register` cleanly and `pdc_cheques` gains `kind`, `party_payee_id`,
`unit_id` and `cleared_entry_id` instead.

## What P1 does NOT include

No services, no RPCs, no screens, and **no seed data** — `qb_accounts` and
`entry_type_defaults` are created empty. The 52-account chart must be copied from the live
Awami QuickBooks company file, not from `BLUEPRINT.md` §A14, because the names must match
that file exactly and QuickBooks caps them at 31 characters.

Invariant 5's override-reason rule is also not yet enforced at the DB layer: it requires a
lookup against `entry_type_defaults`, which a CHECK cannot do, so it becomes a trigger or a
service check in P2. Until then the schema permits any head on any entry type.

## Rollback

`20260903r_rollback_the_cash_book.sql` drops everything children-first without `CASCADE`,
removes `audit_logs.project_id`, and restores `audit_trigger_function()` to the exact body
dumped from the live database before this module touched it. It deliberately does **not**
delete files already written to storage, and does **not** rewrite anybody's `app_users.role`.

It destroys data. It is for use before the pilot's first close, and not after.

## Applying this

```bash
node scripts/verify-daily-closing-schema.js     # proves up + down against the real engine,
                                                # inside BEGIN … ROLLBACK. Commits nothing.
```

Last run: **PASS** — migrations applied, 22 assertions held, rollback returned the database
to its starting state. Verified afterwards that production still has 0 of the 13 tables, no
`audit_logs.project_id`, none of the new functions, and an `audit_trigger_function` whose
definition hashes to the same value as before the run.

The harness was also checked in the other direction — with the immutability test's exception
handler removed, the batch fails with `23001 … cash_entries is immutable: amount cannot be
updated`. A test that cannot go red proves nothing.

To apply for real, run the three up migrations through `apply_migration`, in order:
`20260903e` → `20260903f` → `20260903g`. **Not yet done — it needs the owner's go-ahead.**
