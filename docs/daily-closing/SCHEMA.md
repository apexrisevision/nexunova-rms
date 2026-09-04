# Daily Closing — SCHEMA

What P1 creates, one line per table, plus the mechanisms that carry the invariants.

| Migration | Purpose |
|---|---|
| `supabase/migrations/20260903e_a_day_of_cash_has_a_shape.sql` | 13 tables, keys, CHECKs, indexes, `audit_logs.project_id`, RLS/grant floor |
| `supabase/migrations/20260903f_a_saved_entry_is_a_fact.sql` | immutability, day-lock and project guards; audit wiring |
| `supabase/migrations/20260903g_closing_the_day_is_not_an_everyday_permission.sql` | `_dc_is_cfo()` |
| `supabase/migrations/20260903r_rollback_the_cash_book.sql` | the down path (destructive; see its header) |
| `scripts/verify-daily-closing-schema.js` | runs all four inside `BEGIN … ROLLBACK` and asserts 22 things |

**Status: P1 and P2 both APPLIED to the live RMS database (`itqxljtfbrppntgyfush`) — P1 on
2026-09-03, P2 on 2026-09-04**, each after a
full verified backup. Evidence in "Applying this" at the end. The rollback file and the
verification script are not applied and never are — they are tools.

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
| ~~`pdc_register`~~ | **DROPPED 2026-09-04** (`20260904g`). The module adopts the live `pdc_cheques` as its single cheque table — see `PDC_DECISION.md`. |
| `reconciliations` | A recorded comparison between this cash book and QuickBooks on a date; it stores what was compared and computes no balance. |
| `audit_logs` *(existing, altered)* | Gains a nullable `project_id` so a director can be shown the audit for their own project and no other. |

## The invariants, and where each one actually lives

| # | Invariant | Mechanism |
|---|---|---|
| 1 | Cash is a fact | **`cash_entries_immutable()`** on `BEFORE UPDATE OR DELETE` — rejects every DELETE, and any UPDATE touching anything but the five routing columns. Plus `cash_entries_no_truncate()` on `BEFORE TRUNCATE`, and revoked table grants. |
| 2 | Opening is derived | Partial unique indexes `cash_days_setup_opening_once` and `cash_days_one_open_per_project`, plus **`open_cash_day()`** (P3, `20260904h`) which takes **no opening parameter** — it reads the latest CLOSED day, and returns `SETUP_OPENING_REQUIRED` when there is none. `setup_cash_opening()` stores the starting balances as a CLOSED day so carry-forward has exactly one code path. |
| 3 | Close locks | **`cash_entries_day_guard()`** on `BEFORE INSERT` locks the day and raises `DAY_LOCKED` for a non-adjustment into a CLOSED day. `CHECK (is_adjustment = false OR adjustment_reason IS NOT NULL)` makes a reasonless adjustment impossible. P3 adds **`close_cash_day()`** (optimistic lock on `version` → `VERSION_CONFLICT`; `VARIANCE_UNEXPLAINED` unless variance is 0 or a note is given) and **`post_cash_adjustment()`** (CFO only, CLOSED days only, reason always). |
| 4 | Export once | `UNIQUE (cash_day_id)` on `qb_exports`; `CHECK ((qb_status='EXPORTED') = (qb_export_id IS NOT NULL))` on `cash_entries`. |
| 5 | Receipts are advances | `entry_type_defaults` holds the default head per type, seeded in P2. **`cash_entries_qb_head_guard()`** on `BEFORE INSERT` (P2, `20260904b`) raises `OVERRIDE_REASON_REQUIRED` when the head differs from the type's default with no written reason, and `REVENUE_ACCOUNT_FENCED` for account 4010 unless the transaction-local flag `dc.revenue_recognition` is `'on'` — which only Phase 3's handover JV will set. |
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
| ~~`pdc_register.kind` / `.status`~~ | table dropped; `pdc_cheques.status` holds `pending` `deposited` `cleared` `bounced` `replaced` and gains a CHECK in P16 |
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
- ~~**`pdc_register_cleared_link`**~~ — went with the table. The equivalent on `pdc_cheques`
  is P16 work, and cannot be added before then: seven live rows already read `cleared` with no
  cash entry behind them, and the constraint would reject them.

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

**Resolved 2026-09-04: there is one.** `pdc_register` was created in P1 only because the brief
named its index; it never held a row, and `20260904g` dropped it. `public.pdc_cheques` — with
a page (`js/pages/pdc.js`), a feature flag, an audit trigger, thirteen RPCs, deposit
scheduling, bounce penalties and a replacement chain — is the module's single cheque table.
Its live vocabulary (`pending` / `cleared` / `bounced`) is already §A4's three states, so the
blueprint's model is a subset of what runs. Four fields are still owed and are P16 work:
`kind`, `party_payee_id`, `cleared_entry_id`, and a `status` CHECK. Full reasoning:
`PDC_DECISION.md`.

## What P1 does NOT include

No services, no RPCs, no screens, and no seed data — `qb_accounts` and `entry_type_defaults`
were created empty. P2 fills them; see below.

> ### Invariant 5 — the P1 flag comes down
> P1 shipped `entry_type_defaults` with nothing enforcing it, and this section carried a
> warning that the schema would accept any QuickBooks head on any entry type. **P2's
> `cash_entries_qb_head_guard()` closes it**, proved in both directions by tests 23–30 of
> `scripts/verify-daily-closing-seed.js` — including a red check confirming the suite fails
> when the trigger is removed.
>
> ✅ **Applied to the live database on 2026-09-04.** The flag is fully down: the live schema
> now refuses an off-default head with no reason, and refuses `4010` outright.

---

# P2 — seeds, the payee master, invariant 5

| Migration | Purpose |
|---|---|
| `20260904a_the_chart_and_the_people_paid.sql` | `seed_daily_closing_chart()` + the pilot's run; `payees.normalized_name` regenerated |
| `20260904b_a_head_that_is_not_the_default_needs_a_reason.sql` | invariant 5 — `cash_entries_qb_head_guard()` |
| `20260904c_a_private_shelf_for_the_days_documents.sql` | the private `daily-closing` storage bucket |
| `20260904d_the_payee_master_opens.sql` | `list_payees` · `create_payee` · `rename_payee` · `set_payee_active` · `_dc_can_manage_payees()` |
| `20260904e_the_role_column_was_never_free_text.sql` | corrects a false comment P1 left on `app_users.role` |
| `20260904f_the_cfo_role_becomes_storable.sql` | widens `app_users_role_check` to admit `cfo` |
| `20260904g_one_drawer_of_cheques_one_table.sql` | drops `pdc_register`; `pdc_cheques` is the one register |
| `scripts/verify-daily-closing-seed.js` | 37 assertions inside `BEGIN … ROLLBACK` — **applied 2026-09-04** |
| `scripts/verify-qb-accounts.js` | diffs `qb_accounts` against a real QuickBooks chart export |

## `app_users_role_check` — widened to admit `cfo`

P1 recorded that `app_users.role` had no CHECK. It has one, and P2's test suite caught it on
its first run. The constraint permitted `owner, admin, manager, recovery, accounts, staff` —
so `_dc_is_cfo()` was a predicate for a value no account could hold, and the Accountant's real
value is `accounts`, not `finance` (the front end reads both; only one is storable).

`20260904f` adds `cfo` and nothing else. The change is additive — six existing values
untouched, no row read or rewritten — and the migration asserts inside its own transaction
that every row still passes **and** still holds one of the original six. Tests 32–36.

---

# P3 — the CashDay state machine

| Migration | Purpose |
|---|---|
| `20260904h_a_day_opens_and_a_day_closes.sql` | pure domain helpers, the injected clock, and five services |
| `scripts/verify-daily-closing-day.js` | 28 assertions inside `BEGIN … ROLLBACK` |

**Services:** `setup_cash_opening` · `open_cash_day` · `get_cash_day_summary` ·
`close_cash_day` · `post_cash_adjustment`. Entry recording is **P4** — deliberately a separate
prompt, because its idempotency, `seq_no` locking and transfer atomicity need their own review.

## Where the "domain layer" went

§A3 asks for pure rules beneath a service layer. RMS has no application tier, so the split is
expressed the only way it can be: **IMMUTABLE functions that compute and touch nothing**, and
`SECURITY DEFINER` RPCs that do the I/O and own the transaction.

| Pure (IMMUTABLE) | What it is |
|---|---|
| `_dc_voucher_for(mode, direction)` | the §A12 derivation — CASH/IN→CRV, CASH/OUT→CPV, BANK/IN→BRV, BANK/OUT→BPV. One definition, reused by P4, so screen, service and CHECK cannot disagree |
| `_dc_variance(counted, closing)` | counted − closing. Negative is short |
| `_dc_jv_number(year, seq)` | `JV-2026-0007` |
| `_dc_may_close(status)` / `_dc_may_adjust(status)` | the §A4 guards as predicates rather than scattered IFs |

Test 01 exercises all of them with **no fixture at all** — that is the point of separating them.

## The clock

`_dc_today()` is the one impure primitive and it is isolated. It reads **Asia/Karachi**, never
`CURRENT_DATE`, which is UTC on this platform and would file the first five hours of every
night under the previous business date (RULES risk 2). Tests override it with a
transaction-local `dc.today` — the same seam as `rms.audit_reason` and `dc.revenue_recognition`.

That setting is reachable only by something holding a direct SQL connection: PostgREST exposes
RPCs, and `set_config` lives in `pg_catalog`, not the exposed schema. It is a test seam, not a
back door. Test 02 asserts both the override and the real Karachi date.

## SetupOpening — modelled as a CLOSED day

Invariant 2's "one setup opening per project, once, by the CFO" is stored as a `cash_days` row
with `is_setup_opening = true`, `status = 'CLOSED'`, opening 0/0 and closing = the balances
given. Two things fall out of that: OpenDay's carry-forward has exactly **one** code path —
"the latest CLOSED day" — and the row satisfies `cash_days_closed_is_complete` honestly,
because the CFO did count the opening cash. Enforced by the partial unique index
`cash_days_setup_opening_once` plus an explicit "this project already has a cash book" check.

## DaySummary — computed, never stored

Live from the entries. **JV rows carry `mode` NULL and are excluded**: a reclassification moves
an amount between QuickBooks heads, it does not move cash. **Voids need no special case** — a
void is a reversing entry with the opposite direction, so it nets itself out, which is only
true because invariant 1 forbids touching the original.

For a CLOSED day the summary reports the **stored** closing, not a recomputation: that figure
is the record of what was locked. Test 22 proves an adjustment posted afterwards moves the
totals while leaving the locked closing alone — and test 16 proves the two agree at the moment
of closing.

## ⚠️ Deviation — a cash-affecting adjustment is not a JV

The P3 brief said an adjustment is written with `voucher_type='JV'`, and also that
"for cash/bank-affecting adjustments set mode/direction". **Those cannot both hold.** §A6 says
mode and direction are "NULL only for JV", and the shipped `cash_entries_jv_or_movement` CHECK
enforces it. A JV that moves cash cannot exist.

Resolved in favour of the blueprint and the constraint, because §A6 is the law and the brief's
sentence contradicts it:

| Adjustment | voucher_type | mode/direction | accounts |
|---|---|---|---|
| Cash- or bank-affecting | derived — `CRV`/`CPV`/`BRV`/`BPV` | set | `qb_account_id` |
| Pure reclassification | **`JV`** | NULL | `qb_debit_account_id` + `qb_credit_account_id`, which must differ |

Both are `is_adjustment = true`, both carry a reason, both auto-number `JV-{YYYY}-{seq}` from
`voucher_sequences` under prefix `DCJV`, and both appear in the PDF's ADJUSTMENTS block.
Nothing is weakened — §A12's derivation invariant is upheld. P1's own test 16 already wrote an
adjustment this way. Tests 21 and 23 assert both shapes.

The alternative — relaxing the CHECK so a JV may carry mode/direction — would let a voucher
chip disagree with the row it labels, and was not taken.

## Two layers, found by a red check

Removing `close_cash_day`'s `VARIANCE_UNEXPLAINED` guard **did not** let a bad close through:
the P1 CHECK `cash_days_variance_explained` rejected it at the database. The rule is enforced
twice, and the service check exists to return a usable message rather than a constraint
violation. The red check that does prove the suite can fail targets `VERSION_CONFLICT`, which
is service-only — without it the stale close succeeds and the suite fails at test 15.

---

# P4 — recording and voiding an entry

| Migration | Purpose |
|---|---|
| `20260904j_an_entry_is_recorded_and_an_entry_is_voided.sql` | `record_cash_entry` · `void_cash_entry` · `add_cash_entry_attachment` · `authorize_cash_attachment` · `list_cash_entries` |
| `20260904i_awami_can_see_the_daily_closing_switches.sql` | one feature-flag row so Awami's Users & Roles offers the `cfo` role and the `dailyclosing` tick |
| `scripts/verify-daily-closing-entry.js` | 24 assertions inside `BEGIN … ROLLBACK` |

## The three hard ones

**Idempotency.** The key is checked **before any validation**, so a replay returns the original
entry and `success`, never a 409 and never a second row. A cashier whose phone lost the
response can press Save again. The `UNIQUE (company_id, project_id, idempotency_key)` index is
the backstop if two replays race, and the exception handler turns that race into the same
replay answer. Tests 02 and 03.

**seq_no.** Assigned after `SELECT … FOR UPDATE` on the `cash_days` row, so two writers on one
day serialise; `UNIQUE (cash_day_id, seq_no)` is the backstop. Test 11 asserts the numbering is
contiguous, that a duplicate is refused, and that the lock is present in the function body.

> ⚠️ **Two-writer concurrency is NOT proved by this harness**, and the test file says so in its
> header. Everything runs on one connection in one transaction. A real race needs two
> connections that commit — and a committed `cash_entries` row cannot be removed, because
> invariant 1 forbids deleting one. That test belongs in P10 against a disposable database.

**Transfer atomicity.** Both legs are inserted in one function with **no exception handler
around them**, so a failure on the second takes the first with it. Test 14 proves it rather
than asserting it: a trigger installed for the duration of the test makes leg B raise, and the
test then checks that **zero** `TX-2%` rows survive.

## RecordEntry

Derives `voucher_type` from mode + direction and **refuses a caller who tries to supply it** —
a caller who could set it is a caller who could make the chip disagree with the row. Uniqueness
is per `(project, voucher_type, voucher_no)` among non-adjustments, so `CPV 0041` and
`CRV 0041` are different books; `DUPLICATE_VOUCHER` names the conflicting entry's date.

A `TRANSFER` writes two rows sharing a `transfer_group_id`, `-A` and `-B`, each carrying **the
other account's** QuickBooks head — so each row reads as a self-describing double entry
(§A14: debit destination, credit source).

> ⚠️ **For P16:** because each leg names the other account, the IIF export must emit **one**
> transaction per `transfer_group_id`, not one per row, or a transfer is booked twice.

## VoidEntry

Accountant and up, `OPEN` days only. Writes a reversing row — same amount, opposite direction,
derived voucher type, `{orig}-VOID`, `is_adjustment`, `adjusts_entry_id` — and touches the
original only on `rms_status`, which is one of the five columns invariant 1's trigger allows to
move. A voided `PENDING` receipt becomes `UNAPPLIED` with reason `Voided`: money received and
then voided was never *applied*. No double void, and a reversal cannot itself be voided.

## Attachments — half of it, honestly

`add_cash_entry_attachment` validates type (jpg/png/pdf), size (≤ 10 MB) and that the storage
key begins with the entry's `project_id`, so one project's bill can never be addressed from
another's. `authorize_cash_attachment` answers "may this caller read this file, and where is it".

> ⚠️ **The signing step does not exist yet.** Postgres cannot mint a signed URL — that is a
> Storage API call — and the `daily-closing` bucket deliberately has no policy, so
> `authenticated` cannot sign for itself. It needs a service-key bridge, the shape
> `20260828j` used for employee documents. **That bridge ships with P6**, the screen that first
> needs to show a thumbnail. Until then an attachment can be recorded and authorised but not
> fetched.

## Two test bugs this prompt found — in the tests, not the code

Both were found by the red check, and both made assertions silently pass:

1. **`IF (v_res->>'error') <> 'X'`** is `NULL <> 'X'` = NULL when the call unexpectedly
   **succeeds**, so the assertion never fired. Every negative assertion across P2, P3 and P4
   had it — 52 of them. All are now `IS DISTINCT FROM`.
2. **`PERFORM` throws the result away**, so a `close_cash_day` that failed looked exactly like
   one that worked, and the test that followed was quietly testing an *open* day. Results are
   assigned and asserted now.

The first one is why the red check exists at all: without it, the suite was green and three of
its guards were decorative.

---

# THE QUICKBOOKS CONTRACT

**This is the authoritative record of how the Phase-3 IIF export must address an account.**
Verified against the real Awami company file on 2026-09-04, not inferred.

## The rule

> **Phase 3 writes the BARE account name in the `ACCNT` field — `Cash in Hand`, not
> `1010 · Cash in Hand` — exactly as `BLUEPRINT.md` §A14's example shows.**

## The evidence, and a correction

I previously warned that if "Use account numbers" were switched on in the company file, the
account's full name would include the number and the export would have to emit the prefixed
form. **That warning was wrong**, and the real export settles it.

"Use account numbers" **is** on in the Awami file — and the IIF export still writes:

```
!ACCNT  NAME            REFNUM  TIMESTAMP   ACCNTTYPE  OBAMOUNT  DESC                ACCNUM  …
ACCNT   Cash in Hand    36      1788440359  BANK       0.00      Main cash account   1010    …
```

The number lives in its own `ACCNUM` column — in all 84 rows — and `NAME` is bare. The setting
changes what the QuickBooks **user interface displays**; it does not change the IIF `NAME`
field. An IIF export is what an IIF import reads back, so the exported form is the round-trip
contract, and that form is the bare name.

`scripts/verify-qb-accounts.js` now asserts this on every run and would flag a change.

## The diff — 2026-09-04, `migration_work/qb_chart.iif`

```
parsed  84 account(s) from QuickBooks   (57 active, 27 inactive)
parsed  53 account(s) from qb_accounts (live)
✅ PASS
```

| Check | Result |
|---|---|
| In the chart but not in QuickBooks — *the dangerous direction* | **none** |
| Ours, but inactive in QuickBooks (an import would be refused) | **none** |
| Same number, different name | **none** |
| Same name, different type | **none** |
| Name over 31 characters | **none** (longest is `Construction - Development Cost`, exactly 31) |
| Sub-accounts (`Parent:Child`) | **none** |

All 53 seeded accounts exist in QuickBooks, active, with matching numbers and types.

**Four QuickBooks accounts are not seeded, deliberately** — they are QuickBooks' own built-ins
and nothing in this module posts to them: `24000 Payroll Liabilities`,
`30000 Opening Balance Equity`, `32000 Retained Earnings`, `80000 Ask My Accountant`.

**27 inactive accounts are expected and are not a diff failure.** They are the default
contractor-template chart (`Construction in Progress`, `Retainage Receivable`,
`Blueprints and Reproduction`, …), switched off in the company file. The script reads the IIF
`HIDDEN` column, reports them separately, and does not count them. It *does* fail if one of
**our** 53 turns up hidden, because posting to an inactive account is refused at import.

## Running it

```bash
node scripts/verify-qb-accounts.js migration_work/qb_chart.iif
```

The export to ask for is in that script's header (IIF preferred, CSV accepted). Re-run it
whenever the company file's chart is edited, and before P16 ships the export. Before P2 was
applied the script read the chart out of `20260904a`'s own `VALUES` block; it now reads the
live `qb_accounts` table.

## The seeder

`seed_daily_closing_chart(p_company_id, p_project_id)` — `service_role` only, and **idempotent
by construction**: `ON CONFLICT DO UPDATE` on every insert, so a re-run inserts what is
missing, corrects a name that has drifted, and reactivates what was switched off. It never
deletes, because an account an entry has cited is cited forever. Test 04 proves the drift
correction by renaming and deactivating 2020 and re-running.

It seeds three things:

- **53 QuickBooks accounts** (§A14), for the tenant. ⚠️ **The names are the contract** — the
  Phase-3 IIF export matches on NAME, and QuickBooks silently creates a new account when a
  name does not resolve. Longest is `Construction - Development Cost` at exactly 31, which is
  QuickBooks' own cap. Test 02 asserts nothing exceeds it; test 03 asserts exact spellings
  including the apostrophe in `Owner's Capital`.
- **5 `entry_type_defaults`.** Only `CLIENT_RECEIPT` has a default — `2020 Advance from
  Customers`, which *is* invariant 5. The other four are deliberately NULL: choosing among
  5xxx/6xxx/7xxx for an expense is the ordinary act, not an override, and a default there
  would make every real entry an "override" needing a reason. §A14's *mode* defaults
  (CASH → 1010, BANK → 1030) are not entry-type defaults at all — they belong to the drawer
  and the bank account, and land on `cash_accounts`.
- **2 `cash_accounts` for the pilot** — `Cash in Hand` → 1010, `Bank Al-Habib - Awami` → 1030.

## Bank identity — which table is the source of truth

**`project_bank_accounts` is the source of truth for bank identity** — the account title,
number, IBAN and branch. `cash_accounts` says *where money moves* and carries only a name, a
kind, its QuickBooks head, and `bank_account_id` pointing at that master. A bank account is
described in one place.

At the pilot, `project_bank_accounts` currently holds **no row for Awami** (nor does the
company-wide `banks` table), so `cash_accounts.bank_account_id` is NULL and the BANK row
stands alone. The seeder looks the link up on **every run** — `bank_name ILIKE '%al%habib%'`,
primary first — so adding the real row later and re-seeding links them with no migration.

Until that row exists, `Bank Al-Habib - Awami` in `cash_accounts` is a label with no account
number behind it. That is fine for the cash book, which only needs to know a movement was
"bank" — and it is **not** fine for the Phase-3 export, which will need the real account.

## `payees.normalized_name` — regenerated in P2

P1 shipped lower + trim + collapse-whitespace. P2's brief adds punctuation stripping, so the
generated expression was replaced:

```sql
btrim(regexp_replace(regexp_replace(lower(btrim(name)), '[[:punct:]]', '', 'g'), '\s+', ' ', 'g'))
```

Postgres cannot alter a generation expression in place, so the column was dropped and re-added
with its unique index — safe only because the table is empty, and not a pattern to repeat once
it carries rows.

`[[:punct:]]` rather than `[^a-z0-9 ]` on purpose: the second erases an Urdu or accented name
down to the empty string, and a payee master for a Peshawar site cannot assume ASCII. Test 09
covers it. Collapse runs *after* the strip, so `Ahmed & Sons` → `ahmed sons`, not `ahmed  sons`.

Consequence worth knowing: `M/s. Ahmed & Sons` and `Ms Ahmed   Sons` are now **one payee**
(test 08). That is the intent — a master list exists to stop the same vendor appearing twice —
but it is stricter than P1 was, and a genuinely different name that differs only by punctuation
would now collide and return `PAYEE_DUPLICATE`.

Generated columns are excluded from backup INSERTs by `scripts/backup-full.js:252`, which
already handles this — the ⚠️ in RULES invariant 6 is satisfied and needs no change.

## The payee master

Four RPCs, all `SECURITY DEFINER`, all returning `{success, error}` jsonb in §A9's vocabulary:
`list_payees` · `create_payee` · `rename_payee` · `set_payee_active`.

**There is no delete, and there will not be one** (test 21 asserts none exists). A payee named
on an entry is named on it forever; deactivating removes them from the picker and leaves the
history readable.

**Who may maintain it:** `_dc_can_manage_payees()` = `role IN ('finance','accounts')` OR
`_dc_is_cfo()`. That is §A10's "Accountant+" exactly. Plain `admin` is **refused** (test 17) —
in this database admin is the everyday data-entry role. Reading the list is wider: a cashier
has to pick a payee, so `list_payees` admits any tenant user with the project assignment
(tests 18–19).

## The `daily-closing` bucket

`public = false`, 10 MB cap, and **no storage policy at all** — the shape `20260828j` used for
employee documents. `anon` and `authenticated` cannot read, write or list it by any route;
every read is a short-lived signed URL minted server-side. Test 31 asserts the bucket exists,
is private, and that no `storage.objects` policy references it.

Created in P2 rather than P7 because the renderer is not its first user: `cash_entry_attachments`
needs it as soon as the composer exists.

## Rollback

`20260903r_rollback_the_cash_book.sql` drops everything children-first without `CASCADE`,
removes `audit_logs.project_id`, and restores `audit_trigger_function()` to the exact body
dumped from the live database before this module touched it. It deliberately does **not**
delete files already written to storage, and does **not** rewrite anybody's `app_users.role`.

It destroys data. It is for use before the pilot's first close, and not after.

## Applying this

```bash
node scripts/verify-daily-closing-schema.js                 # dry run: sends up + assertions +
                                                            # down inside BEGIN … ROLLBACK
node scripts/verify-daily-closing-schema.js --against-live  # asserts the APPLIED schema only;
                                                            # sends no migration at all
```

The dry run is what proved the migrations before they were applied: **PASS**, 22 assertions,
rollback returned the database to its starting state, and production afterwards still had 0 of
the 13 tables and an `audit_trigger_function` hashing to its pre-run value.

The harness was also checked in the other direction — with the immutability test's exception
handler removed, the batch fails with `23001 … cash_entries is immutable: amount cannot be
updated`. A test that cannot go red proves nothing.

### The live apply — 2026-09-03

1. **Backup first.** `node scripts/backup-full.js` → `backups/BACKUP_20260903_2336`, 265 MB,
   160 table dumps, all 7 tenants, `MANIFEST.json` present. Row counts in the manifest match
   the live database exactly: clients 360, sales 504, payments 3274, installments 16121,
   units 2318, app_users 15, audit_logs 54055.
2. **Applied in order** `20260903e` → `20260903f` → `20260903g`, each atomic on its own
   `BEGIN … COMMIT`, and recorded in `supabase_migrations.schema_migrations` as
   `20260903235001/2/3`. (The repo files keep letter suffixes; the recorded versions are
   timestamps, which is what that table takes.)
3. **`--against-live` verification: PASS**, 22 assertions against the real applied schema.

### What was proved untouched afterwards

| Check | Before | After |
|---|---|---|
| Schema fingerprint, excluding the 13 new tables and `audit_logs.project_id` | `37894cdf956332199f4afab9bec18103` / 2382 cols | **identical** |
| `_trg_audit` triggers | 23 | 35 — the 12 new tables, none lost |
| FMH: clients / sales / payments / installments / units | 184 / 255 / 1312 / 9519 / 455 | **identical** |
| FMH payments total | `603,399,181.00` | **identical** |
| KBH (Fourteen Group): clients / sales / payments / installments / units | 172 / 241 / 1957 / 6544 / 322 | **identical** |
| KBH payments total | `669,934,989.00` | **identical** |
| `audit_trigger_function` | `66c3a0390047ed512091e783105f67af` | `3ab9fee6f16a5a958200828cc662854e` — **intentionally rewired** |

The audit function is the one existing object this module changes. Diffing the old body
(embedded verbatim in `20260903r`) against the new one gives exactly four hunks and nothing
else: the `v_project_id` declaration, the two Daily Closing sensitivity rules, the
`project_id` capture, and `project_id` added to the INSERT. Every pre-existing rule —
payments, sales, installments, pdc_cheques, units, subscriptions, backdating, the operator
reason — is byte-identical.

**FMH flow smoke**, run on real rows inside `BEGIN … ROLLBACK`: an UPDATE of a live FMH
payment still fires the audit trigger and now carries the correct `project_id`; a full INSERT
into `payments` still works and audits; and `payments` still accepts UPDATE **and** DELETE —
only `cash_entries` is locked. All three passed, nothing persisted (0 rows left, `payments`
still 3274).

The cash book itself is empty and stays empty until P2: `cash_days` 0, `cash_entries` 0.
