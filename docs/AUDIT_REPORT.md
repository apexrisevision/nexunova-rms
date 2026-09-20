# NexuFinance — Forensic Audit

**Scope:** ledger integrity, validation loopholes, silent failures, test credibility, blueprint conformance.
**Date:** 2026-09-20 · **Mode:** read-only. No code was changed and nothing was written to the live database;
every finding below comes from reading source, reading the live catalog, or running read-only queries.

---

## 1 · Executive summary — is the money safe?

**Mostly, but not entirely, and the gap is new.** The day-by-day cash book is well defended: debits equal
credits by a deferred constraint trigger, a leg cannot be zero or negative, voucher numbers are unique by
construction, orphan lines are impossible, and no table is writable directly by an app user.

**The Journal Voucher path, added 2026-09-19, sits outside two of those defences.** A journal voucher is posted
with `day_id = NULL` by design, and both the negative-cash guard and the daily closing are keyed on `day_id`.
The three cash/bank accounts are offered as pickable heads. So a journal voucher can (a) drive Cash, Petty or
Bank negative with nothing stopping it — the exact CPV-1222 invariant — and (b) change tomorrow's opening
without appearing in today's closing, breaking the chain the blueprint requires.

Neither is exploitable by an outsider or a viewer; both need a legitimate accountant or director. Nothing in
Awami's live data is wrong **today** — but not for the reason one would hope. **All 64 of Awami's vouchers are
day-less** (`day_id IS NULL`), i.e. every one of them already travelled the unguarded path; what saves them is
that **none touches a cash, petty or bank account** (verified: 0 of 64). So the position is correct, the guard
simply never had anything to catch. This is a live hole, not a live loss — and the hole sits on the path that
100% of the existing book already uses.

**A third hole is worse and is live right now.** The Journal Vouchers screen lists rows by `day_id IS NULL` —
which is also how all 64 imported historical vouchers are stored. Asking the real RPC as the real director
returns **all 64, each marked not-exported, each with a Delete button**. Awami's entire imported history is
deletable through the UI today (CRITICAL-3).

**No test covers any of the three.** Every negative-position test drives `nf_save_line` (the day path); not one
drives `nf_jv_save`, and nothing asserts what the journal list contains. This is the shape of the next
CPV-1222.

---

## 1b · Status after fix passes 1–3 (added 2026-09-20; the findings below are left as written)

The report above is the read-only record of what was found and is deliberately **not** rewritten. This table is
the only thing added: where each finding stands after the three fix passes the owner authorised.

| finding | status | closed by | proved by |
|---|---|---|---|
| CRITICAL-1 — a JV can drive cash negative | **closed** | `20260920a` — `NF:CASH_VIA_DAY_ONLY`; the position guard no longer skips a day-less voucher | `verify-nf-cash-via-day-only.js` CVD-05..09, run red first (17/26 failed) |
| CRITICAL-2 — opening date-scoped vs closing day-scoped | **closed** | same migration: with no via leg possible off the day path, the two agree by construction | CVD-24, dry run S6 carry-forward past a JV's own date |
| CRITICAL-3 — imported history deletable from the JV screen | **closed** | `20260919p` — `nf_vouchers.source`, `nf_jv_list` filtered, `nf_jv_delete` `IMPORTED_LOCKED` | `verify-nf-jv-harden.js` 15/15 |
| HIGH-1 — `nf_accounts_head_not_via` missing | **closed** | `20260920a` — constraint restored after splitting `is_head`'s two meanings | CVD-10 (flips the flag back and requires the CHECK to stop it) |
| MEDIUM-1 — legless voucher header possible | **closed** | `20260920b` — `nf_voucher_has_legs_check`, deferred constraint trigger on the header | `verify-nf-rules.js` H-M1 |
| MEDIUM-2 — strongest R1 tests in a suite that cannot run | **closed** | R1-01/05/06 ported live into `verify-nf-rules.js`; both rehearsal suites now skip cleanly instead of aborting | H-R1, H-R1b..H-R1g |
| MEDIUM-3 — failed refresh swallowed | **closed** | `js/nf/nf-sheet.js` `serialDebounce` now toasts "Screen refresh failed — reload" | read-only change; **no automated coverage** — see §40 in PLAN.md |
| MEDIUM-4 — report opening ≠ sheet opening | **closed** | `20260920b` — the report calls `nf_ledger_position`, the sheet's own function | dry run S6 MEDIUM-4 (first day *and* a later day), CVD-32 |
| LOW-1 — reopen has no period gate | **partly; comment corrected** | `20260919k`/`20260919p` lock the exported *voucher*; the *day*-level gate is still future work, now said so in `nf_days_guard` | no functional change |
| LOW-2 — amount scale checked in RPCs, not the column | **open by decision** | no action; standing rule recorded instead: any NEW write path must route through `nf_check_amount` | — |

---

## 2 · Findings

### CRITICAL-1 — A journal voucher can drive Cash / Petty / Bank negative

**PROVEN** (unambiguous code path + live catalog; no write performed)

**What.** The "cash cannot go negative" invariant is enforced by a trigger that only runs when the voucher
belongs to a day. Journal vouchers deliberately have no day. They can post to the cash accounts. Nothing else
checks the position.

**Where, step by step:**

| # | fact | evidence |
|---|---|---|
| 1 | The guard asserts only for day-attached vouchers | `nf_voucher_legs_position_guard`: `SELECT day_id INTO v_day …; IF v_day IS NOT NULL THEN PERFORM nf_assert_not_negative(v_day); END IF;` |
| 2 | `nf_jv_save` always posts with a NULL day | `supabase/migrations/20260919o_nf_journal_vouchers.sql` — `nf_post_voucher(p_company_id, NULL, …)`, commented "p_day_id is NULL, always and deliberately" |
| 3 | `nf_post_voucher` itself never asserts the position | live catalog: `prosrc LIKE '%assert_not_negative%'` → **false** |
| 4 | The cash accounts are postable heads | `nf_accounts` for Awami: 10100 Cash in Hand, 10200 Petty Cash, 10300 Bank Al-Habib all have `is_head = true, active = true` |
| 5 | They are *offered* in the picker | `nf_list_heads('Awami')` returns 82 heads **including 10100, 10200, 10300** |
| 6 | The leg guard lets them through | `nf_voucher_legs_guard` rejects only `NOT is_head OR NOT active` |

**Repro (dev environment only — do not run against live):** open Journal Vouchers, line 1 `53100` Debit
1,000,000, line 2 `10100 Cash in Hand` Credit 1,000,000, post. It will succeed. Cash is now 1,000,000 below
whatever it was, and the daily closing screen will show the new, negative opening the next day.

**Blast radius.** Any accountant or director. Not reachable by a viewer (`nf_jv_save` requires
accountant/director) nor by anon. Corrupts the cash position for every day at or after that voucher's date;
the Trial Balance still balances, so nothing self-announces.

**Why it slipped through.** The guard predates journal vouchers, and its own source comment says so:
*"Journals with no day_id (future, out of this pass's scope) skip this — there is no shared 'day' to serialize
against."* That was true when written. The journal-voucher feature made it false and did not revisit it — my
own work of 2026-09-19, and I did not check this guard when I built it.

---

### CRITICAL-2 — Day N's closing and day N+1's opening are computed from different sets, so a journal voucher breaks the chain

**PROVEN** (source)

**What.** The blueprint requires tomorrow's opening to equal today's closing, derived from the ledger. Opening
*is* ledger-derived. Closing is **day-derived**. A journal voucher has a date but no day, so it lands in one and
not the other.

**Where.** `nf_position_row`:

- opening (non-first day) ← `nf_ledger_position(company, business_date)`, which filters
  `WHERE … a.via IS NOT NULL AND v.voucher_date >= first_day AND v.voucher_date < p_before_date`
  — **by date, over every posted voucher, day or no day.**
- closing ← `open + in − out + trf`, where `in`/`out` come from `nf_lines WHERE day_id = p_day_id` and `trf`
  from `nf_voucher_legs … WHERE v.day_id = p_day_id`
  — **by day. A NULL day_id matches nothing.**

**Consequence.** Post a JV crediting 10100 dated inside or before an open period: it never shows in any day's
Money In / Money Out, never moves any day's closing, and silently moves every later day's opening. The director
report for that day will reconcile perfectly and still be wrong about what the business holds.

**Compounded by the frozen snapshot.** `nf_days_guard` writes `NEW.close_cash := r.close_cash` from
`nf_position_row` at the moment of close, and `nf_days_closed_has_snapshot` requires it. A journal voucher dated
into an already-closed period changes the ledger-derived figure for later days but cannot change that frozen
snapshot — so the stored closing and the derived position diverge permanently.

**Repro (dev only):** close day 1 at cash X. Post a JV dated day 1 crediting 10100 by 10,000. Day 1's stored
`close_cash` is still X; day 2's `open_cash` is X − 10,000.

**Blast radius.** Same as CRITICAL-1. Silent: nothing raises, nothing reconciles against it.

---

### CRITICAL-3 — The Journal Vouchers screen lists Awami's entire imported history with a Delete button on every row

**PROVEN** (live query through the real RPC, read-only; nothing was deleted)

**What.** `nf_jv_list` selects `WHERE day_id IS NULL AND status = 'POSTED'`. That predicate was written to mean
"journal vouchers" — but **all 64 of Awami's QuickBooks-imported historical vouchers are also `day_id IS NULL`.**
Calling the RPC as the real director returns **64 vouchers, every one with `exported: false`**, and the screen
renders a Delete button for exactly those. `nf_jv_delete` would accept every one of them: role ✓,
`day_id IS NULL` ✓, no row in `nf_iif_batch_vouchers` ✓.

**So an accountant or director can delete Awami's entire 35,496,550 of imported history, one voucher at a time,
with nothing in the way but a browser `confirm()`.**

**The flag that was supposed to protect them does not.** `20260919h` set `iif_exportable = false` on all 64
precisely because they must never be re-exported. But `nf_jv_list`/`nf_jv_delete` read *exported* from
`nf_iif_batch_vouchers` (which is empty), not from `iif_exportable`. The two are different facts and the
protective one is never consulted on this path.

**Evidence.** `nf_jv_list(Awami, null, null)` → `vouchers.length = 64`, `filter(exported).length = 0`, newest
`JV-0017 2026-09-18`, suggested next number `JV-0065`.

**Alongside it, the same path has no period protection at all:**

- **Any date.** `nf_post_voucher` validates only that `p_voucher_date IS NOT NULL` — no range, no "must be in an
  open period", no "not before the first day", no future bound. A JV can be dated into a closed day, or 2031.
- **No version check.** `nf_jv_delete` takes no `p_version`, so it has no optimistic lock.
- The day-lock that protects daily-closing lines (`nf_voucher_legs_guard` → `NF:DAY_LOCKED`) is explicitly
  skipped for day-less vouchers, so it offers no cover here either.

**Blast radius.** The whole imported book, plus any future journal voucher, in a closed period, without
reopening anything. Deletions *are* recorded by `nf_audit_row`, so this is recoverable and traceable after the
fact — but nothing detects or prevents it at the time.

**Why it slipped through.** The screen was built for *new* journal vouchers (2026-09-19) and its list predicate
was the honest definition of one. Nobody asked what else in the live data already matched that predicate. The
answer was: everything.

---

### HIGH-1 — `nf_accounts_head_not_via` does not exist on the live table; cash accounts are pickable heads

**PROVEN** (live catalog)

The blueprint's R4 states a head can never be a via and a via can never be a head, and the rollback tool
`20260918r` reconstructs the table *with* `CONSTRAINT nf_accounts_head_not_via CHECK (NOT (is_head AND via IS
NOT NULL))`. That constraint is **not present on the live table** — the full constraint list for `nf_accounts`
is code_shape, name_check, no_104, qb_type_check, via_check, via_is_bank_type, via_label, one_per_via, the keys
and the FKs. Nothing forbids `is_head AND via IS NOT NULL`, and all three via accounts are flagged `is_head`.

**Consequences.** On the daily sheet, picking "10100 Cash in Hand" as the head of a Cash receipt produces
Dr 10100 / Cr 10100 — balanced, harmless, meaningless, and saveable. On a journal voucher it is the vector for
CRITICAL-1. The rules suite's `H-R4` checks 12610 (a director receivable) as head and as via; it does not check
that a via account is absent from the head list.

---

### MEDIUM-1 — A voucher header with no legs at all is possible at the table layer

**PROVEN** (source + grants) · **reachability limited**

`nf_voucher_balance_check` is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on **`nf_voucher_legs`**. It
raises `NF:VOUCHER_NEEDS_TWO_LEGS` / `NF:VOUCHER_UNBALANCED` — but only if at least one leg row is touched. A
row inserted into `nf_vouchers` with no legs never fires it, and `nf_vouchers` carries no trigger of its own
beyond `nf_audit_row`. Such a voucher would appear in the Journal with no lines and contribute nothing.

Not reachable by an application user: `authenticated` holds **SELECT only** on `nf_vouchers` (verified today,
after `20260919l`), and every RPC that creates a voucher writes its legs in the same call. The exposure is to
`service_role` — migrations, import scripts, and anything run with the service key.

---

### MEDIUM-2 — The strongest negative-position tests are in a suite that can no longer run

**PROVEN** (observed 2026-09-19)

`scripts/nf/verify-nf-schema.js` holds the most precise assertions of the CPV-1222 invariant — `R1-01` (one
paisa too much), `R1-05` (deleting a receipt that would strand a payment), `R1-06` (shrinking a receipt to the
same effect). It is a **from-scratch rehearsal**: it applies migrations a–c inside one transaction. Run against the
currently migrated database it aborts immediately with `ERROR: 42P07: relation "nf_members" already exists`.

Those three assertions therefore do not run in any routine pass. `verify-nf-rules.js` keeps one live equivalent
(`H-R1 the CPV-1222 invariant`) and the golden-day UI keeps `UI-09`, so the invariant is not untested — but the
edge cases (delete-shrinks-position, edit-shrinks-position) are dormant.

---

### MEDIUM-3 — A failed refresh after a failed save is swallowed

**INDICATIVE**

`js/nf/nf-sheet.js:601` — `serialDebounce` runs `fn().catch(function () {}).then(…)`. The inner functions
(`saveTransfers`, `saveCount`, `saveRemarks`, lines 623/633/640) each end in `.catch(err => { toast(…); return
refresh(); })`, so a *save* failure is surfaced. But whatever `refresh()` itself rejects with is caught by that
empty handler and shown nowhere: the person sees the original error toast and a screen that quietly did not
reload.

**What would prove it:** force `nf_get_day` to fail (offline, or revoke EXECUTE) immediately after a transfer
save fails, and observe whether any second message appears. Not reproduced.

---

### LOW-1 — Reopening a closed day still has no period gate

**PROVEN** (source) · **known and documented**

`nf_days_guard`'s reopen branch carries its own note: *"Period locking does not exist yet … the enforceable
rule today is simply 'any day' — harmless for now because nothing downstream reads a locked/exported state
yet, but NOT to be treated as the final word once that gate exists."* `20260919k` built the export gate at the
**voucher** level and deliberately left `nf_reopen_day` untouched (PLAN.md §29). The comment is therefore now
half-stale: an exported voucher is protected, the day around it is not. Reopening is director-only, requires a
reason, bumps `reopen_count`, NULLs the snapshot and is audited — so it is deliberate and traceable, not silent.

---

### LOW-2 — Amount scale is checked in the RPCs, not by the column

**PROVEN** (source)

`nf_check_amount` rejects anything where `p <> round(p, 2)` (`NF:AMOUNT_SCALE`) and anything ≥ 10¹², and
`nf_save_line` additionally rejects `p_amount <= 0`. The columns are `numeric(14,2)`, which would silently
*round* a third decimal rather than refuse it. Every current write path goes through `nf_check_amount`, so the
rounding behaviour is unreachable today; it is a latent difference between "the RPC refuses" and "the column
accepts" worth knowing if a new path is ever added.

---

### MEDIUM-4 — Cash & Bank Movement omits the opening balance the company started with

**PROVEN** (live, 2026-09-20) — *found during fix pass 2, by `verify-nf-cash-via-day-only.js` (CVD-32). Recorded,
deliberately NOT fixed in that pass: it is a separate defect in a different function and was not in its scope.*

`nf_get_cash_bank_movement` derives each account's `opening` purely from voucher legs —
`CASE WHEN p_from IS NULL THEN 0 ELSE sum(debit − credit) WHERE voucher_date < p_from END` — and never reads
`nf_days.typed_open_cash / typed_open_petty / typed_open_bank`. The day sheet's own opening comes from
`nf_ledger_position`, which *does* add them. So the money the company started with is missing from this report's
opening **and** therefore from its closing.

Measured on one real day in the fix-pass-2 fixture (opened at 500,000 cash, took 75,000 in, paid 30,000 out,
transferred 105,000 to bank/petty):

| | opening | in | out | closing |
|---|---:|---:|---:|---:|
| Daily Closing sheet | 500,000 | 75,000 | 135,000 | **440,000** |
| Cash & Bank Movement | 0 | 75,000 | 135,000 | **−60,000** |

The movement columns are right; only the opening (and the closing that depends on it) is wrong. It has been this
way since `20260919d_nf_cash_bank_movement.sql` — `20260920a` widened that function's account-selection CTE only,
and left the `opening` CTE byte-identical (verified by reading the live body before and after).

Not urgent: the report is a director's cross-check, nothing posts from it, and no other report shares the CTE.
But a negative cash figure on a printed report is the kind of thing that gets believed.

---

### What held up under attack (not findings — recorded so the negatives are on the record too)

| invariant | how it is actually enforced | verdict |
|---|---|---|
| debits == credits | `nf_voucher_balance_check`, DEFERRABLE INITIALLY DEFERRED constraint trigger on `nf_voucher_legs`; **plus** an independent pre-write sum inside `nf_post_voucher` | server-side, holds |
| atomic header + lines | `nf_post_voucher` writes both in one function body = one transaction | holds |
| lines without a voucher | FK `nf_voucher_legs_voucher_fk (voucher_id, company_id) → nf_vouchers(id, company_id)` | impossible |
| zero or negative leg | CHECK `nf_voucher_legs_one_side` — exactly one side > 0, the other = 0 — plus `debit >= 0`, `credit >= 0` | impossible |
| duplicate voucher number, incl. race | `voucher_key` is a GENERATED column `upper(btrim(voucher_no))` with UNIQUE `(company_id, voucher_key)`; serialisation is the unique index, not application logic | race-safe |
| nonexistent or inactive head | FK to `nf_accounts(company_id, code)` for existence; `nf_voucher_legs_guard` rejects `NOT is_head OR NOT active` | holds |
| party required on pooled accounts | `nf_voucher_legs_guard` → `NF:PARTY_REQUIRED`, at the trigger, on every path including journal vouchers (rehearsed) | holds |
| direct REST table writes | `authenticated` holds SELECT only on every `nf_` table; `anon` holds nothing (after `20260919l`) | closed |
| viewer reaching a write path | `nf_voucher_legs_guard` and `nf_days_guard` both reject `v_role = 'viewer'` at the trigger, independent of any RPC | holds |
| opening drifting from a stored number | non-first days derive opening from `nf_ledger_position` over the ledger; `nf_days_typed_opening_first_day_only` forbids a stored opening on any later day | holds (but see CRITICAL-2 for what the ledger includes) |
| error surfaced to the user | every save path in `js/nf/nf-*.js` ends in a `.catch` that raises a toast or an inline row error; success toasts fire inside `.then`, after the response | holds |

---

## 3 · Blueprint conformance

Read against `docs/PLAN.md` (§1–§37) and the reference files.

| Blueprint item | Status | Evidence / deviation |
|---|---|---|
| Double-entry ledger, balance enforced in the DB | **BUILT** | deferred constraint trigger + pre-write check |
| ≥2 legs per voucher | **BUILT** | same trigger; see MEDIUM-1 for the zero-leg edge |
| Multi-leg vouchers normal | **BUILT** | journal vouchers, up to 10 legs rehearsed (§33) |
| Closed days immutable | **PARTIAL** | `nf_voucher_legs_guard` → `NF:DAY_LOCKED`, but **only for day-attached vouchers** — and no Awami voucher has a day (CRITICAL-3) |
| Corrections are new entries, never silent overwrites | **PARTIAL** | daily-closing lines are editable while the day is OPEN (audited, time-boxed); journal vouchers have no edit at all, only delete — and delete has no period gate, and reaches the whole imported history (CRITICAL-3) |
| Chart mirrors QuickBooks exactly | **BUILT** | `verify-nf-qb-accounts.js`: 110 exact matches; the 3 absent are the HIDDEN=Y 104xx the CHECK forbids |
| A head can never be a via (R4) | **BUILT DIFFERENTLY** | constraint absent from the live table; all three via accounts are flagged `is_head` and appear in the head picker (HIGH-1) |
| Never invent a head at entry | **BUILT** | picker is a closed list with no "add new"; FK + `is_head/active` guard behind it |
| Party master, aliases, search-first | **BUILT** | `verify-nf-party-field.js` 15/15 |
| Party mandatory on 21100/21200/21300 only | **BUILT** | `requires_party` flag; enforced at the trigger |
| Cash / petty / bank can never go negative | **PARTIAL — CRITICAL** | enforced on the day path; **not** on the journal-voucher path (CRITICAL-1) |
| Today's closing = tomorrow's opening, computed from the ledger | **PARTIAL — CRITICAL** | opening is ledger-derived, closing is day-derived; a journal voucher lands in one and not the other (CRITICAL-2) |
| Trial balance self-checking | **BUILT** | balances by construction; note it stays balanced even in the CRITICAL-1/2 scenarios, so it is not a detector for them |
| Eleven reports, printable | **BUILT** | per-report suites green |
| Director report: plain language, no Dr/Cr, one A4, Other Balances, signatures | **BUILT** | `verify-nf-director-report.js` 18/18 |
| Journal defaults to a period, not all time | **BUILT** | §28 |
| IIF: export-state tracking, validation gate, per-account reconciliation | **BUILT, never run** | zero vouchers exported |
| Exported voucher locked from edit/delete | **BUILT** | §29, covers both `nf_delete_line` and `nf_jv_delete` |
| Voucher numbers unique per company | **BUILT** | generated column + unique index |
| Full before/after audit log, append-only | **BUILT** | `nf_audit_row` on every table; `nf_audit_append_only` + no-truncate; `authenticated` has SELECT only |
| RLS genuinely enforced; nothing on the public key | **BUILT** | closed 2026-09-19 (`20260919l`); standing catalog checks with planted-mutant self-tests |
| Separation of duties (accountant enters/closes, director reopens) | **BUILT** | enforced in `nf_days_guard`, not the UI |
| Scale: 100k+ lines without degradation | **BUILT** | measured (§31): every bounded report < 1s at 104k legs |
| Backups with a proven restore | **BUILT** | §13 |
| Period locking tied to export | **PARTIAL** | voucher-level only; the day around an exported voucher can still be reopened (LOW-1), and journal vouchers are outside it entirely (CRITICAL-3) |
| Do not rebuild QuickBooks / excluded scope | **BUILT** | nothing from Part K exists |

---

## 4 · Test suite — real output, and what it does not cover

Run in this session, on the current code, full output (not a summary claim):

| suite | result |
|---|---|
| `verify-nf-golden-ui.js` | 34 checks · 34 passed · 0 failed |
| `verify-nf-party-field.js` | 15 · 15 · 0 |
| `verify-nf-journal-voucher.js` | 18 · 18 · 0 |
| `verify-nf-general-ledger.js` | 12 · 12 · 0 |
| `verify-nf-general-journal.js` | 14 · 14 · 0 |
| `verify-nf-trial-balance.js` | 10 · 10 · 0 |
| `verify-nf-director-report.js` | 18 · 18 · 0 |
| `dry-run-daily-workflow.js` | 26 · 26 · 0 |
| `verify-nf-rules.js` | 58 · 58 · 0 |
| `verify-nf-schema.js` | **cannot run** — aborts on `relation "nf_members" already exists` (MEDIUM-2) |
| `verify-nf-de-migration.js` | rollback rehearsal for `20260918a–d`; not part of a routine pass |

**205 green checks. They are claims, and here is what they do not claim.**

- **SR-5 / SR-7 — the chain test supplies the condition that makes it pass.** `dry-run-daily-workflow.js` S6
  asserts day 2's opening equals day 1's closing on a fixture that contains **no journal vouchers**. The only
  input that can break the invariant is absent from the test. It is green in the one case where it cannot fail.
- **No test posts a via account.** `grep '10100|10200|10300'` over `verify-nf-journal-voucher.js` and
  `dry-run-daily-workflow.js` returns **nothing**. The account that CRITICAL-1 requires is never used in a test.
- **Every negative-position test drives the day path.** `H-R1` (rules), `UI-09` (golden day), `R1-01/05/06`
  (schema, dormant) all go through `nf_save_line`. Not one drives `nf_jv_save` or `nf_post_voucher` with a NULL
  day. The guard's conditional — the whole of CRITICAL-1 — is untested.
- **SR-11 — the export lock is asserted as a refusal, not as protection of a period.** `nf_jv_delete`'s test
  proves an *exported* voucher cannot be deleted. Nothing asserts what happens to an old *unexported* one, which
  is CRITICAL-3 — and the suite runs on a fixture with no imported history, so it never sees the 64 rows a
  real company has. A test that supplies only the safe case has not tested the rule.
- **SR-9 does not bite here.** No suite stubs the network; all of them drive real HTTP against a real project,
  which is why the RLS and role findings could be settled by the suites rather than by reading.

**Invariants present in the code with no test covering them — the next CPV-1222 list:**

1. Cash/petty/bank non-negative **on the journal-voucher path** (CRITICAL-1).
2. Day N closing == day N+1 opening **when a journal voucher exists** (CRITICAL-2).
3. A journal voucher's date must fall in an open period (CRITICAL-3 — not enforced, so not testable yet; the
   test should exist the moment the rule does).
4. An imported historical voucher must never be deletable from the journal screen, and the journal list must
   not return it at all (CRITICAL-3). No test asserts what  contains for a company with history.
5. A via account must not appear in the head picker (HIGH-1).
6. A voucher header must not exist with zero legs (MEDIUM-1).

---

## 5 · Could not verify

| item | why | what would settle it |
|---|---|---|
| CRITICAL-1 and CRITICAL-2 reproduced end-to-end | Would require **writing** a journal voucher to the live database, which this audit is forbidden from doing. Both are proven by unambiguous code path plus live catalog state, not by execution. | Run the two repro steps in §2 against a disposable `ZZTEST-NF-` company. |
| MEDIUM-1 (zero-leg voucher) reproduced | Requires a service-role INSERT. | `INSERT INTO nf_vouchers (…) VALUES (…)` with no legs on a scratch company, then read it back through `nf_get_journal`. |
| MEDIUM-3 (swallowed refresh) reproduced | Requires forcing `nf_get_day` to fail at a precise moment. | Revoke EXECUTE on `nf_get_day` for the test user mid-run, trigger a transfer save failure, observe the UI. |
| Whether any *other* tenant (KBH, FMH) shares these paths | Only Awami's chart and data were inspected; NexuFinance is Awami-only today. | Repeat the `nf_list_heads` / `is_head AND via` query per company once another tenant is onboarded. |
| Behaviour under two simultaneous journal-voucher saves | `verify-nf-rules.js` proves race handling for the **day** path (`RACE-R1/OK/R2`, overlap proven from `pg_stat_activity`). No equivalent exists for journal vouchers, and the day-row `FOR UPDATE` lock that serialises the day path is explicitly skipped when `day_id IS NULL`. | A two-connection race harness posting two journal vouchers against the same cash account. |

---

*No code was modified and no data was written in the course of this audit.*
