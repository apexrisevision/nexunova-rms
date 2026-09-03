# Daily Closing — RULES

The eight invariants from `BLUEPRINT.md` §A2, each followed by the concrete mechanism that
will enforce it **in this codebase**, and the files that will hold it.

House conventions the mechanisms below assume (evidence in `ARCHITECTURE_NOTES.md`):
there is no application server, so **the server is Postgres**; every rule that must hold
lives in a DB constraint, trigger or `SECURITY DEFINER` RPC, and the UI only mirrors it.

**Proposed file names** (following `supabase/migrations/YYYYMMDD<x>_a_sentence_in_words.sql`):

| Slot | File |
|---|---|
| Schema | `supabase/migrations/<date>a_a_day_of_cash_has_a_shape.sql` |
| Immutability + audit triggers | `supabase/migrations/<date>b_a_saved_entry_is_a_fact.sql` |
| Write RPCs | `supabase/migrations/<date>c_opening_recording_and_closing_a_day.sql` |
| Read RPCs | `supabase/migrations/<date>d_what_the_day_looks_like.sql` |
| Page | `js/pages/daily-closing.js` |
| Page styles | `css/daily-closing.css` (+ `--dc-*` aliases) |
| Page container | `login.html` → `<div class="pg" id="pg-dailyclosing">` |
| Lazy manifest | `js/lazy-pages.js` → `dailyclosing: ['js/pages/daily-closing.js?v=…']` |
| Nav + router + gate | `js/ui.js` (`buildSB` group, `ts` title map, `fns` dispatch, `nav()` allow-list) |
| Director document | `reports/daily-closing.html` |
| Test driver | `scripts/verify-daily-closing.js` |
| New CFO role | `supabase/migrations/<date>e_closing_the_day_is_not_an_everyday_permission.sql` |
| Director PDF renderer | `supabase/functions/daily-closing-pdf/index.ts` (Deno + `pdf-lib`) |

---

## 0 — Decisions taken (owner, 2026-09-03)

These close four of the five open questions from the P0 report. They are binding on every
later prompt; where a decision contradicts something written further down, the decision wins.

### 0.1 Scope — cash book, not accounting

RMS **will** store the cash book: a chronological record of cash and bank movements.
RMS does **not** become an accounting system. It holds **no general ledger**, computes **no
P&L and no balance sheet**, and produces **no financial statements**. QuickBooks remains the
book of record. The module's job is exactly four verbs: **capture → verify → lock → route.**

> **Standing instruction for every later prompt (P1–P17):** if a prompt asks for an
> accounting output to be computed inside RMS — a trial balance, a P&L line, an account
> balance rolled forward across periods, a profit figure, a balance-sheet total — **stop and
> flag it.** Do not build it. Day-level opening/closing cash and bank are *not* accounting
> outputs: they are the cash book's own running position, which is what §A2 invariant 2
> defines. The line is: this module may total *its own rows*; it may never total *accounts*.

This supersedes the earlier blanket rule *"RMS does not deal with financials"* for this
module only. Everything that rule covers — refunds, forfeitures, cancellation charges,
commission clawback, deductions — stays in QuickBooks and stays out of RMS.

### 0.2 Director PDF — generated, stored, versioned

Confirmed as the **primary Phase-1 deliverable**. It must be reproducible, auditable and
shareable, so it is rendered server-side and retained — not printed from a browser.
Proposed engine in §0.5. **Nothing is added until that proposal is approved.**

### 0.3 Roles

| Blueprint role | RMS role | Status |
|---|---|---|
| Cashier | `staff` + an explicit `dailyclosing` module grant | **accepted** |
| Accountant | `finance` (legacy alias `accounts`) | **accepted** |
| Director | `manager` — already app-wide read-only (`js/ui.js:501`) and rejected outright by write RPCs (`20260902a…sql:127-129`) | **accepted** |
| CFO | **new `cfo` role — do NOT map to `admin`** | see §0.4 |

### 0.4 CFO — the evidence, and the ruling

The question was whether `admin` is broadly assigned. Counted live on 2026-09-03 across all
15 `app_users` rows in the RMS project:

| Tenant | Active users | `owner` | `admin` | Who holds admin |
|---|--:|--:|--:|---|
| **Awami Market** (pilot) | 1 | 1 | 0 | — (the single user is `owner`) |
| Fourteen Group of companies | 2 | 1 | 0 | — |
| FMH | 3 | 1 | 1 | **"Filling Staff"** (`username: filling`) |
| ZZTEST / ZZTEST2 / ZZTEST3 / Admin Test | 7 | 4 | 1 | test accounts |

By **headcount** admin is narrow — two admins in the whole database. But headcount is the
wrong measure, and the ruling is **create a distinct `cfo` role**, for three reasons:

1. **`admin` is semantically the data-entry role, not an officer role.** FMH's only admin is
   a filling clerk. Whoever needs to add a client or record a payment gets `admin`, because
   that is the escape hatch every write RPC tests.
2. **`_rms_is_admin()` collapses three things into one privilege** —
   `is_super_admin OR role IN ('owner','admin') OR companies.owner_user_id = id`
   (`supabase/migrations/20260526_phase1_rpcs.sql:28-36`) — with no gradation. Mapping CFO to
   `admin` means "the CFO is anyone who can add a client", and that is precisely what
   Close Day, adjustments, allocation approval and the QuickBooks export must not be.
3. **The pilot has one user.** Awami's only account is `owner`. There is no incumbent admin
   population to inherit, so introducing `cfo` now costs nothing and avoids a migration later
   when the site cashier is added.

**Therefore:** add `cfo` as a role. Close Day · setup opening · adjustments · allocation
approve/reject · QuickBooks export · PDC clear/bounce are gated on
`v_me.role = 'cfo' OR _rms_is_admin(v_me)` — `owner` keeps access as the account of last
resort, plain `admin` does **not**. The five places a new role must be registered are listed
in `ARCHITECTURE_NOTES.md` §3.4; the SQL side goes in
`<date>e_closing_the_day_is_not_an_everyday_permission.sql`.

> Note `app_users.role` is `text NOT NULL` with **no CHECK constraint**, so the DB accepts
> `'cfo'` today. The work is entirely in the five code sites, not in the schema.

### 0.5 PDF engine — proposal (approval required before anything is added)

**Proposed: a Supabase Edge Function `daily-closing-pdf` (Deno) using `pdf-lib`
(+ `@pdf-lib/fontkit` to embed Inter), writing the file to a new private Storage bucket and
inserting the `day_documents` version row in the same call.**

Why this and not the alternatives:

| Option | Verdict |
|---|---|
| **Edge Function + `pdf-lib`** | **Proposed.** Pure JavaScript, no native binary, no browser, ~200 KB. Runs inside Supabase next to the data with `service_role`, so it can read the day and write the file and the version row in one transaction-shaped call. Output is byte-deterministic for the same input — which is what "reproducible" means. Edge functions are already an established part of this stack: 20 of them live in `supabase/functions/`. |
| Browser render + upload (`jsPDF` / `html2pdf`) | **Rejected.** Output depends on the viewer's browser, fonts and zoom, so two people generating v1 get two different files. Fails reproducible *and* auditable, and makes the Director's document a by-product of whoever happened to click. |
| Headless Chrome (`puppeteer` + `@sparticuz/chromium` on Vercel) | **Rejected for Phase 1.** ~50 MB bundle, cold starts, and RMS has no Node runtime in production — `puppeteer-core` is a **devDependency** used only by the test scripts (`package.json`). It would be the single heaviest thing in the stack, for one A4 page. |
| Gotenberg / an external PDF API | **Rejected.** Adds an external dependency and sends cash figures off-platform. |

Cost of the proposal, stated honestly: §A13 is laid out as a fixed single-page A4 document —
navy band, two hero figures, a 4×2 summary table, three list blocks, a footer — so it maps
cleanly onto `pdf-lib`'s drawing primitives. But it **is** hand-placed coordinates, not
HTML/CSS. Budget roughly a day for the layout and expect the first version to need nudging
against a printed proof.

Two things that must be in the same commit if this is approved:
- deploy with **`supabase functions deploy daily-closing-pdf --no-verify-jwt` via the CLI** —
  deploying an edge function through MCP silently resets `verify_jwt` to `true`;
- a private bucket `daily-closing` (RMS's default habit of public buckets + stored public
  URLs is wrong for this document — §A10 requires private + signed URLs).

Fallback if the font embedding proves fiddly: `pdf-lib`'s standard-14 Helvetica renders
without `fontkit`, at the cost of the Inter/tabular-figures spec. Ask before taking it.

### 0.6 Pilot tenant — Awami Market (located, do not create)

Found in the live RMS project; **use these ids, do not provision anything new**:

| Field | Value |
|---|---|
| `companies.id` | `96d210e7-e63b-4ef0-b1d0-74e622eac7ce` |
| `companies.company_code` | `awami` |
| `companies.company_name` | `Awami Market` |
| `companies.display_name` | `Fourteen Group of Companies` — this is the outward brand, and the name that belongs on the Director PDF's letterhead band (§A13 reads "FOURTEEN GROUP · AWAMI MARKET") |
| `projects.id` | `59ded55b-9bc2-45b2-a372-49fc31807fa9` |
| `projects.project_code` / `short_code` | `AM` / `Awami` |
| Status | `active` |

**Transaction history confirmed empty** — 0 sales, 0 payments, 0 clients, against **1,467
units** already loaded. The cash book genuinely starts from zero balances, exactly as
intended. This also means the pilot exercises the `SETUP_OPENING_REQUIRED` path on day one
(invariant 2), which is the branch most likely to be got wrong.

Two things to know about this tenant before building on it:
- It is a **separate company** from `Fourteen Group of companies`
  (`3249e3b5-c411-4f5f-ae48-0246304c9c87`), which is the tenant KBH sits under. Same brand,
  two tenant rows. Do not conflate them.
- The company id `96d210e7-…` is already hard-coded as the Awami tenant in
  `scripts/smoke-portal.js:32` — the sales portal and lead pipeline run on it. So the tenant
  is not idle; only its *RMS transaction* side is empty.

---

## Invariant 1 — Cash is a fact

> A saved `cash_entries` row is immutable. RMS approval or rejection never alters it.
> Rejection = `UNAPPLIED`, never delete.

**Enforced by:**

1. **DB trigger (the real lock).** A `BEFORE UPDATE OR DELETE` trigger on `cash_entries`
   that raises unless the change touches **only** the five routing columns
   (`rms_status`, `rms_receipt_ref`, `rms_status_reason`, `qb_status`, `qb_export_id`):
   ```sql
   CREATE TRIGGER _trg_cash_entries_immutable
     BEFORE UPDATE OR DELETE ON public.cash_entries
     FOR EACH ROW EXECUTE FUNCTION public.cash_entries_immutable();
   ```
   *File:* `<date>b_a_saved_entry_is_a_fact.sql`.
   Compare `to_jsonb(OLD)` / `to_jsonb(NEW)` per key, the way
   `audit_trigger_function()` already builds `changed_fields`
   (`supabase/migrations/20260706_phase2b_audit_hardening.sql:44-47`).
2. **Grant floor.** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cash_entries FROM
   anon, authenticated, PUBLIC;` — exactly the pattern already used to make `audit_logs`
   append-only (`20260706_phase2b_audit_hardening.sql:15`). Writes then only reach the table
   through `SECURITY DEFINER` RPCs.
3. **RLS deny-all floor** on the new tables, matching every other RMS table
   (`supabase/migrations/PATH_B_emergency_lockdown.sql` §3; all 150+ tables report
   `rls_enabled: true`).
4. **Service layer.** `void_cash_entry(p_entry_id, p_reason)` inserts a *reversing* row with
   `is_adjustment=true`, `adjusts_entry_id`, opposite `direction` — it never updates the
   original. *File:* `<date>c_…sql`.
5. **UI.** `js/pages/daily-closing.js` renders saved rows read-only; the only row action is
   `Void`, which opens a reason dialog. Voided rows render struck-through with a link to the
   reversal (`LedgerTable` spec, BLUEPRINT §A11).

---

## Invariant 2 — Opening is derived

> A day's opening = previous *CLOSED* day's closing. One setup opening exists per project,
> once, by CFO.

**Enforced by:**

1. **RPC, not client input.** `open_cash_day(p_company_id, p_project_id, p_business_date)`
   computes `opening_cash` / `opening_bank` by selecting the most recent
   `cash_days` row with `status='CLOSED'` for that project. The caller **cannot pass**
   opening figures — there is no parameter for them. *File:* `<date>c_…sql`.
2. **Guard.** If no prior CLOSED day and no setup-opening row exists → return
   `{'success':false,'error':'SETUP_OPENING_REQUIRED'}`. If a prior day exists in `OPEN` →
   `PREVIOUS_DAY_OPEN`. Same `jsonb` error-code shape as every RMS RPC
   (`20260902a…sql:106-118`).
3. **"Once per project" as a DB constraint.** A partial unique index, so it is not
   defensible only in code:
   ```sql
   CREATE UNIQUE INDEX cash_days_setup_opening_once
     ON public.cash_days (project_id) WHERE is_setup_opening;
   ```
4. **Single OPEN day per project.**
   ```sql
   CREATE UNIQUE INDEX cash_days_one_open_per_project
     ON public.cash_days (project_id) WHERE status = 'OPEN';
   ```
   *File:* `<date>a_a_day_of_cash_has_a_shape.sql`.
5. **Role.** `set_setup_opening(...)` is admin-only via `_rms_is_admin(v_me)` (see
   invariant 8 and Question 1 on the role mapping).
6. **UI.** The opening figures are display-only on S1/S2 — no input element exists for them.

---

## Invariant 3 — Close locks

> After `CLOSED`, no edits, no deletes. Post-close change = adjustment entry (new row, `JV`,
> reason required, visible on PDF).

**Enforced by:**

1. **Insert-time guard inside the same lock.** `record_cash_entry(...)` does
   `SELECT status, version FROM public.cash_days WHERE id = p_cash_day_id FOR UPDATE;`
   and returns `DAY_LOCKED` if the status is not `OPEN` — *inside* the transaction that
   assigns `seq_no`, so a close racing an entry cannot interleave (BLUEPRINT §A7,
   Concurrency).
2. **DB trigger.** The immutability trigger from invariant 1 also rejects any INSERT into
   `cash_entries` whose `cash_day_id` points at a CLOSED day unless
   `NEW.is_adjustment = true`.
3. **`CHECK (is_adjustment = FALSE OR adjustment_reason IS NOT NULL)`** on `cash_entries` —
   a reasonless adjustment cannot exist even if an RPC forgets to ask.
   *File:* `<date>a_…sql`.
4. **`cash_days` is closed once.** `close_cash_day(...)` guards `status='OPEN'` and uses the
   `version` optimistic lock → `VERSION_CONFLICT`.
5. **UI.** When `status='CLOSED'`, `js/pages/daily-closing.js` replaces the composer with
   `Add adjustment` (admin only) + `Director PDF`, and shows the `LockBadge`.
   Adjustments render in their own group with their reasons.
6. **Document.** `reports/daily-closing.html` prints the ADJUSTMENTS block whenever any
   adjustment row exists for the day (BLUEPRINT §A13).

---

## Invariant 4 — Export once

> An entry is exported to QuickBooks exactly once. Files are date-stamped and retained.

**Enforced by:**

1. **Column state + guard.** `cash_entries.qb_status` starts `NOT_EXPORTED`;
   `export_cash_day(p_cash_day_id)` updates only rows still `NOT_EXPORTED`, inside one
   transaction, and stamps `qb_export_id`.
2. **DB constraint.** `CREATE UNIQUE INDEX qb_exports_one_per_day ON public.qb_exports
   (cash_day_id);` → a second export attempt returns `ALREADY_EXPORTED` rather than writing
   a second file. *File:* `<date>a_…sql`.
3. **Idempotency.** `export_cash_day` is idempotent by day: a repeat call returns the
   existing `qb_exports` row (file name, checksum, count) instead of re-generating —
   mirroring `_rms_insert_simple_payment`'s "duplicate returns the original" contract.
4. **Retention.** The `.iif` file is written to a **private** Storage bucket
   (`daily-closing` — new, private, modelled on
   `20260828j_private_bucket_for_employee_documents.sql`), and `qb_exports.storage_key` +
   `checksum` are recorded. Nothing is ever deleted.
5. **UI.** S7 Exports disables the button when a `qb_exports` row exists and shows the
   existing file instead. Server still enforces — UI hides, server decides
   (`ARCHITECTURE_NOTES.md` §3.2).

> ⚠️ Phase 3. Nothing about IIF exists in RMS today (verified: zero repo hits for `.iif`).

---

## Invariant 5 — Receipts are advances

> Client money credits `2020 Advance from Customers`. `4010 Unit - Shop Sales` is credited
> only by the handover JV.

**Enforced by:**

1. **Defaults table, not code.** `entry_type_defaults(entry_type, default_qb_account_id,
   suggested_qb_types)` seeded so `CLIENT_RECEIPT → 2020`. Seeded in `<date>a_…sql`
   alongside the `qb_accounts` master (52 rows, BLUEPRINT §A14).
2. **Server-side default.** `record_cash_entry` resolves `qb_account_id` from
   `entry_type_defaults` when the caller sends none, and **requires**
   `qb_override_reason` when the caller sends a different account →
   `OVERRIDE_REASON_REQUIRED`. This is the same shape as the existing mandatory-reason gate
   on `cancel_payment` (`20260706_phase2b_audit_hardening.sql:105-110`, min 10 chars).
3. **DB constraint.**
   `CHECK (qb_account_id = default_for_type OR qb_override_reason IS NOT NULL)` cannot be
   expressed directly (it needs a lookup), so it is a **trigger** in `<date>b_…sql` rather
   than a CHECK — noted so it is not silently dropped.
4. **4010 is fenced.** A trigger rejects any `cash_entries` row citing account `4010` unless
   `entry_type='OTHER' AND is_adjustment` and the row was created by
   `recognize_revenue(p_unit_id)` (Phase 3). Until that RPC exists, `4010` is simply
   unreachable from the composer.
5. **UI.** `SuggestedField` shows the resolved account with a `Suggested` tag; changing it
   reveals a required `Reason for override` (BLUEPRINT §A11).

---

## Invariant 6 — Names from masters

> Payees and QB accounts are selected, never typed.

**Enforced by:**

1. **Foreign keys.** `cash_entries.payee_id → payees(id)` and
   `cash_entries.qb_account_id → qb_accounts(id)`, both `NOT NULL` for their entry types.
   There is no free-text payee column. *File:* `<date>a_…sql`.
2. **Active-only guard.** `record_cash_entry` returns `PAYEE_INACTIVE` / `ACCOUNT_INACTIVE`
   when the referenced master row has `is_active = false`.
3. **Uniqueness on the master.**
   `UNIQUE (COALESCE(project_id,'00000000-…'::uuid), normalized_name)` on `payees`, with
   `normalized_name` a generated lower/trim/collapse-whitespace column — so "PESCO " and
   "pesco" cannot both exist.
   > ⚠️ `npm run backup` **must exclude generated columns** (memory
   > `local_full_backup_script`); if `normalized_name` is generated, add it to the exclusion
   > list in `scripts/backup-full.js` in the same commit.
4. **UI.** `EntitySelect` is a typeahead over the master with a "+ New payee" option gated to
   admin; it never accepts free text. Follow `js/pick.js` rather than assigning
   `sel.value = savedId` against a filtered list — that silently blanks the field
   (`ARCHITECTURE_NOTES.md` §7.2).

---

## Invariant 7 — Everything is audited

> Append-only audit: entity, id, action, actor, before, after, reason, time.

**Enforced by:**

1. **Reuse the existing engine — do not build a second one.** Attach the standard trigger to
   every new table:
   ```sql
   CREATE TRIGGER _trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.cash_days
     FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
   -- likewise cash_entries, payees, qb_accounts, qb_exports, pdc_register, client_receipts
   ```
   `audit_trigger_function()` already captures actor (`auth.uid()` → `app_users.full_name`,
   `role`), `old_data`, `new_data`, `changed_fields`, IP, user-agent and `company_id`
   (`supabase/migrations/20260706_phase2b_audit_hardening.sql:16-95`). This makes the
   blueprint's `audit_log` table unnecessary — see mapping (c) below.
2. **Operator reason.** Every RPC that takes a reason calls
   `PERFORM set_config('rms.audit_reason', p_reason, true);` before the write; the trigger
   picks it up and it wins over the auto-tag (same file, line 76).
   Applies to: void, adjustment, close-with-variance, allocation reject, PDC bounce.
3. **Append-only at the grant level.** `audit_logs` already has
   `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM anon, authenticated, PUBLIC`
   (line 15) — the new tables inherit that protection for free by writing into it.
4. **Sensitivity.** Extend the `is_sensitive` rules in `audit_trigger_function()` so a
   `cash_days` close and any `cash_entries` adjustment are flagged, matching the existing
   `payments.amount` / `pdc_cheques.status='bounced'` rules (lines 51-58).
   *File:* `<date>b_…sql` (a `CREATE OR REPLACE` of the trigger function — **dump the live
   body first**; the repo copy may be stale, memory `rpcs_not_in_repo`).
5. **Viewer.** The existing Audit Trail page (`js/pages/audit.js`, nav key `audit`,
   director-only) shows the new rows with no work, because it reads `audit_logs` generically.

---

## Invariant 8 — Project-scoped

> Every row carries `project_id`; every query is scoped; every role is evaluated per project.

**Enforced by:**

1. **Schema.** `project_id uuid NOT NULL` **and** `company_id uuid NOT NULL` on every new
   table. RMS is multi-tenant *and* multi-site: `company_id` is the tenant, `project_id` is
   the site. Every existing domain table carries both (`clients.project_id NOT NULL`,
   `units.project_id NOT NULL`). *File:* `<date>a_…sql`.
2. **Server-side scope guard in every RPC** — the canonical chain, copied verbatim from
   `20260902a_the_number_from_the_receipt_book.sql:100-137`:
   `_rms_caller()` → `wrong_tenant` on company mismatch → `_rms_is_admin()` → else require an
   active row in `user_project_assignments` for that `project_id` → else
   `project_not_assigned`.
3. **Read RPCs are scoped too, not just writes.** Read functions build
   `v_pids uuid[]` from `user_project_assignments` and filter, exactly as
   `get_client_ledger` does (`20260902a…sql:165-176`). A non-admin with no assignment sees
   an empty result, not an error.
4. **RLS deny-all** on all new tables so a leaked anon key reaches nothing directly.
5. **UI mirror only.** `hasProjectAccess(pid)` (`js/auth.js:446-452`) hides other projects
   from the project switcher; `nav()`'s gate (`js/ui.js:913-937`) hides the page. Neither is
   a security boundary.
6. **Test.** `scripts/verify-daily-closing.js` must assert the negative case: sign in as a
   user assigned to project A, call the RPC for project B, assert `project_not_assigned` —
   the same shape the write-isolation pass (W1–W5) was verified with.

---

# (a) Risks

1. ~~**The owner's standing rule says RMS does not hold money.**~~ **RESOLVED — §0.1.**
   The reversal is deliberate and on the record: RMS stores the cash book, and nothing more.
   The residual risk is now **drift**, not policy: the gap between "a cash book" and "an
   accounting system" is one prompt wide. A later prompt asking for a running account balance,
   a trial balance or a P&L line would cross it without looking like it did. §0.1 carries the
   standing instruction to stop and flag; keep it in front of every subsequent prompt.
   Eleven migrations and `js/pages/cancellation.js:654` still say *"refunds are settled in
   QuickBooks"* — those stay true and must not be edited to match this module.
2. **UTC vs Asia/Karachi.** `td()` and Postgres `CURRENT_DATE` are both UTC
   (`js/utils.js:2`; `20260902a…sql:41`). A cash book keyed on the wrong business date is
   wrong from day one, and the error only shows between 00:00 and 05:00 PKT — i.e. rarely,
   and always at the worst time. Every date in this module must go through one Karachi
   helper, and the existing `todayPK()` must not be re-implemented per file.
3. **There is no PDF engine, and the Director PDF is the whole point of Phase 1.** Today
   every "PDF" in RMS is a browser print dialog and nothing is stored. **Confirmed as the
   primary Phase-1 deliverable (§0.2); engine proposed in §0.5 — Deno edge function +
   `pdf-lib`, pending approval.** Residual risk: this is the one genuinely new piece of
   infrastructure in the module, it is hand-placed coordinates rather than HTML/CSS, and it
   is the deliverable everything else is judged by. Expect the first proof to need nudging,
   and deploy it via the CLI with `--no-verify-jwt` or it ships unreachable.
4. **`numeric` without scale.** Existing money columns accept 3+ decimal places. If any
   existing amount is fed into a cash-book total, `counted_cash − system_closing` can throw a
   variance of 0.004 that no cashier can explain. New columns must be `numeric(18,2)`, and
   the reconciliation must round at the boundary.
5. **Four blueprint roles, none of which existed.** **RESOLVED — §0.3/§0.4:** Cashier→`staff`
   +grant, Accountant→`finance`, Director→`manager`, and CFO becomes a **new `cfo` role**
   rather than `admin`, because `admin` is this system's data-entry role (FMH's only admin is
   a filling clerk) and `_rms_is_admin()` collapses owner/admin/super-admin into one
   ungraded privilege. Residual risk: a role must be registered in **five** separate places
   (`ARCHITECTURE_NOTES.md` §3.4) and `role` has no CHECK constraint, so a typo'd `'CFO'`
   fails open to "not admin, not assigned" — silently locking the CFO out rather than letting
   anyone in. `scripts/verify-daily-closing.js` must assert the CFO-only actions from a
   non-CFO account.
6. **No test framework, and the push gate is a real gate.** `.githooks/pre-push` blocks the
   push unless `predeploy-check.js` and `smoke-portal.js` both pass. Any new page must
   survive `smoke-pages.js` (which stubs every RPC — so it proves "does not crash", not
   "is correct"), and must ship its own `scripts/verify-daily-closing.js` driver that
   *clicks the sidebar* rather than calling the render function, per the Team Report rule.
7. **`login.html` is a 2,784-line file that everything is appended to.** A 73rd `.pg`
   container plus another eager script tag adds to a file already carrying the app shell,
   the login screen and the payment wall. Duplicate-id and shadow-id failures are exactly
   what `predeploy-check.js` was written to catch — expect to hit it.
8. **Concurrency claim is untested here.** No RMS RPC currently uses `SELECT … FOR UPDATE`;
   gapless numbering is done with `INSERT … ON CONFLICT DO UPDATE … RETURNING seq`
   (`20260902a…sql:52-57`), which is a correct row lock, whereas `payment_code` is generated
   with a `MAX(...)+1` scan (line 45) that is **not** race-safe. Do not copy the latter.
9. **PgBouncer/pooler.** Supabase's connection pooling means session-level state is not
   guaranteed across statements. `set_config(..., true)` (transaction-local) is used
   correctly by the audit path; anything relying on session-level `SET` would not be safe.
10. **A quiet dependency on QuickBooks account *names*.** §A14 says names must match the
    Awami company file exactly, and QuickBooks account names are capped at 31 characters.
    `2020 Advance from Customers` is 27 — fine — but "5030 Construction - Development Cost"
    is 33 with the number, 28 without. Whoever seeds `qb_accounts` must copy from the live
    file, not from this document.

---

# (b) Questions to answer before P1

Blueprint §A16 asks five. Two are answered by discovery; the rest, plus five more this
codebase raises, are below.

**Answered by discovery**

- **A16 Q2 — "Does RMS have an approval/pending workflow today?"** → **Yes.**
  `approval_requests` + `approval_request_comments`, single-approver, with a dispatcher that
  applies `payload jsonb` on approval
  (`supabase/migrations/20260526_phase3_approval_apply_engine.sql`), a UI at
  `js/pages/approvals.js`, and non-admin writes soft-blocked into it
  (`20260526_phase3_softblock_wiring.sql`). **Recommendation:** route Phase-2
  allocation approval through this engine as a new `request_type` rather than building a
  second approval mechanism. Caveat: the `price_revision` branch is currently dead, so the
  dispatcher needs a look before it is trusted.
- **A16 Q4 — "What RMS event marks a unit as handed over?"** → **None that is usable.**
  Three unreconciled representations (`units.handover_status`, `units.possession_date`, the
  `possessions` table) and the only page that ever wrote the `possessions` table is
  **archived** (`js/pages/archive/possession.js`). A handover event must be *created*, not
  adopted. **This blocks Phase 3's `RecognizeRevenue`, not Phase 1.**

**Answered by the owner, 2026-09-03 — full text in §0**

- **Is the "no financials in RMS" rule being reversed?** → **Yes, deliberately.** Cash book
  only; no GL, no P&L, no balance sheet, no financial statements. §0.1, which also carries
  the standing "stop and flag" instruction for later prompts.
- **A16 Q5 — stored versioned PDF, or print-to-PDF?** → **Generated, stored, versioned.**
  Primary Phase-1 deliverable. Engine proposed in §0.5, awaiting approval.
- **A16 Q1 — role mapping.** → Cashier→`staff`+grant, Accountant→`finance`,
  Director→`manager`. **CFO→ a new `cfo` role, not `admin`** — evidence and reasoning in §0.4.
- **Which project is the pilot?** → **Awami Market, already in RMS.** company
  `96d210e7-e63b-4ef0-b1d0-74e622eac7ce` / project `59ded55b-9bc2-45b2-a372-49fc31807fa9`.
  0 sales, 0 payments, 0 clients, 1,467 units. Do not create a tenant. §0.6.

**Still open — need the owner**

1. **Approve the PDF engine (§0.5)** — Deno edge function + `pdf-lib` + private
   `daily-closing` bucket. Nothing is added until this is approved.
2. **A16 Q1's other half — who *physically* records entries at Awami day-to-day?** The role
   mapping is settled; the staffing is not. Awami currently has **exactly one user account**
   (`awami`, role `owner`). At minimum a `cfo` account and a `staff` cashier account have to
   exist before P1 can be tested end-to-end. Who are they?
3. **A16 Q3 — Bank accounts per project, now and expected?** RMS has **two** competing
   tables: `banks` (company-scoped, has a UI at `js/pages/banks.js`, RPCs `list_banks` /
   `upsert_bank` / `delete_bank`) and `project_bank_accounts` (project-scoped, correct shape,
   **no UI and no RPC**). The blueprint's `cash_accounts` is a third. Which one wins?
   *Recommendation:* extend `project_bank_accounts` and give it the UI it never got.
4. **A16 Q5's remaining half — Director PDF per project, consolidated, or both?** The
   *format* is settled (§0.2); the *grain* is not. Awami has one project, so Phase 1 is
   per-project either way — but the answer decides whether §A12 S8's Group Position (Phase 4)
   is a second document or a second page.
5. **Which company name goes on the letterhead?** The pilot tenant's `company_name` is
   `Awami Market` but its `display_name` is `Fourteen Group of Companies`, and §A13 wants
   both ("FOURTEEN GROUP · AWAMI MARKET"). RMS already distinguishes these:
   `coLegalName()` vs `coDisplayName()` (`js/helpers.js:308-309`), where display_name is the
   outward brand. Confirm: band reads `{display_name} · {project_name}`?
6. **Physical voucher books — one series per project, or per company?** The blueprint says
   `UNIQUE(project, voucher_type, voucher_no)`. RMS's existing `voucher_sequences` is keyed
   `(company_id, prefix, year)` — company-wide, fiscal-year-labelled `2627`. Two different
   grains. Which is the truth on the ground?
7. **Does the client receipt replace, or duplicate, the existing one?**
   `reports/payment-receipt.html` already prints a client receipt from a `payments` row, and
   `payments.manual_number` already carries the physical receipt-book number (shipped
   2026-09-02). Phase 2's `client_receipts` + gapless `{SLUG}-R-{YYYY}-{000001}` would be a
   *second* receipt series for the same money. Confirm the intent.
8. **Reuse `pdc_cheques`, or build `pdc_register`?** RMS already has a working PDC register
   with a page, feature flag, and clear/bounce/replace RPCs
   (`js/pages/pdc.js`, `mark_pdc_cleared` creates the payment). Two registers for one drawer
   of cheques is a reconciliation problem waiting to happen.
   *Recommendation:* extend `pdc_cheques` with `kind` and `cleared_entry_id`.
9. **Paisa: displayed or not?** Every RMS formatter rounds to 0 fraction digits
   (`js/utils.js:11-28`). §A7 wants paisa shown when non-zero, and the variance example is
   `Rs (3)`. A 3-rupee variance is fine; a 0.50 variance would currently render as `Rs 1`.
10. **Do cash entries have to reconcile against `payments` on day one?** If a CLIENT_RECEIPT
    is recorded in the cash book *and* somebody records the same money through
    Record Payment (`js/pages/receipts.js`), the client is credited twice. Phase 1 ships the
    cash book while RMS's own payment entry stays live — what stops the double entry during
    the 14-day parallel run?

---

# (c) Blueprint §A6 data model vs RMS conventions — proposed mapping

Conventions that apply to **every** table below: `uuid` PKs with `DEFAULT gen_random_uuid()`
(pgcrypto is installed), `company_id uuid NOT NULL` **added to every table** (the blueprint
omits it — RMS is multi-tenant before it is multi-site), `created_at timestamptz DEFAULT
now()`, `created_by uuid REFERENCES app_users(id)`, snake_case names, and `text` instead of
`VARCHAR(n)` with a `CHECK (length(...) <= n)` where the cap matters — RMS uses bare `text`
everywhere (`clients.full_name text NOT NULL`, `payments.notes text`).

Postgres has no `ENUM` in this schema — **every existing status column is `text`**
(`payments.status`, `sales.status`, `pdc_cheques.status`, `approval_requests.status`).
Follow that: `text NOT NULL CHECK (x IN (...))`. It keeps migrations cheap and matches
what every RPC already expects.

| Blueprint table | Verdict | Proposed RMS mapping |
|---|---|---|
| `cash_accounts` | **Conflict — three candidates** | Do **not** create a fourth table. Extend **`project_bank_accounts`** (already `company_id` + `project_id` + `bank_name` + `account_title` + `account_no` + `iban` + `is_primary`) with `kind text CHECK (kind IN ('CASH','BANK'))`, `qb_account_id uuid`, `is_active boolean NOT NULL DEFAULT true`, and give it the RPCs + UI it never got. Leave company-wide `banks` alone — it is what `payments.bank_id` points at. **Needs Question 3 answered.** |
| `cash_days` | **New — build as specified** | Add `company_id uuid NOT NULL`. `status text NOT NULL CHECK (status IN ('OPEN','CLOSED'))`. Money columns `numeric(18,2)` — **explicitly scaled, unlike every existing RMS money column** (Risk 4). `denominations jsonb` (RMS uses `jsonb`, never `json` — cf. `possessions.checklist jsonb`, `approval_requests.payload jsonb`). Add `is_setup_opening boolean NOT NULL DEFAULT false` for the partial unique index in invariant 2. |
| `cash_entries` | **New — build as specified** | Add `company_id`. All ENUMs → `text` + CHECK. `idempotency_key uuid NOT NULL` with `UNIQUE (company_id, project_id, idempotency_key)`. Keep "no `updated_at`" — but note RMS's `_trg_audit` gives before/after for free, so the routing-column updates are still fully traced. `unit_id uuid REFERENCES units(id)`; add `sale_id uuid REFERENCES sales(id)` too — RMS money is keyed to the **sale**, not the unit (`payments.sale_id NOT NULL`, `installments.sale_id`), and a resold unit has more than one sale. `qb_account_id` FK to the new `qb_accounts`. |
| `cash_entry_attachments` | **New**, but change the storage story | `storage_key text` pointing into a **new private bucket `daily-closing`**, read through `createSignedUrl(path, 300)` (`js/utils.js:130`). Do **not** follow the prevailing RMS habit of storing a public URL in a text column — §A10 requires private. Precedent for a private bucket + path-not-URL: `20260828k_identity_documents_get_a_private_path.sql`. |
| `payees` | **New — genuine gap** | RMS has `clients` (buyers) and `agents` (dealers) but **no vendor/staff/utility master**. Build `payees` with `company_id NOT NULL`, `project_id NULL`, `kind text CHECK (kind IN ('CUSTOMER','VENDOR','STAFF','DEALER','OTHER'))`. The blueprint's `UNIQUE(COALESCE(project_id,0), normalized_name)` needs a uuid sentinel, not `0`: `UNIQUE (company_id, COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid), normalized_name)`. For `kind='CUSTOMER'` carry a nullable `client_id → clients(id)` so a cash-book payee resolves to a real RMS client rather than a lookalike name. |
| `qb_accounts` | **New — global, not tenant** | The 52-row chart is one company file's. Give it `company_id uuid NOT NULL` anyway — RMS is a multi-tenant SaaS and a second tenant will have a different chart. `number char(4)`, `name text` with `CHECK (length(name) <= 31)` (QuickBooks' own cap), `UNIQUE (company_id, number)`, `UNIQUE (company_id, name)`. Seeded from the live Awami file, not from the blueprint. |
| `entry_type_defaults` | **New** | Add `company_id`. `suggested_qb_types jsonb`. |
| `receipt_counters` | **Conflict — reuse the existing counter** | RMS already has `voucher_sequences (company_id, prefix, year) → seq` with the correct `ON CONFLICT DO UPDATE … RETURNING seq` locking pattern (`20260902a…sql:52-57`) and live prefixes `PRV`, `TRF`. Add a `DCR` prefix rather than a new table. Note RMS's `year` is a **fiscal-year label** (`'2627'` = Jul-2026→Jun-2027, computed at `20260902a…sql:48-51`), not a calendar year — so `{SLUG}-R-{YYYY}-{000001}` needs a ruling: calendar or fiscal. |
| `client_receipts` | **Overlaps existing** | See Question 7. If it survives, `entry_id` unique, `receipt_no` unique per company-year, `storage_key` in the private bucket. |
| `day_documents` | **New — but no engine exists** | Shape is fine (`kind text CHECK (kind='DIRECTOR_PDF')`, `version int`, `storage_key`). The blocker is Risk 3, not the schema. |
| `qb_exports` | **New — build as specified** | Add `company_id`. `UNIQUE (cash_day_id)` per invariant 4. `checksum text` (sha-256 hex). |
| `pdc_register` | **Conflict — reuse `pdc_cheques`** | `pdc_cheques` already carries `company_id`, `project_id`, `sale_id`, `client_id`, `cheque_no`, `bank_name`, `amount`, `cheque_date`, `deposit_date`, `clearance_date`, `status`, `payment_id`, `bounce_reason`, `replaced_by_id`, has `_trg_audit` attached, has a live page (`js/pages/pdc.js`) behind feature flag `pdc`, and `mark_pdc_cleared` already creates the payment on clearing. **Add** `kind text NOT NULL DEFAULT 'RECEIVABLE' CHECK (kind IN ('RECEIVABLE','PAYABLE'))`, `party_payee_id uuid`, `unit_id uuid`, `cleared_entry_id uuid`. Do not build a parallel register. |
| `reconciliations` | **New — build as specified** | Add `company_id`. `UNIQUE (project_id, business_date)`. |
| `audit_log` | **Do not build.** | `audit_logs` already exists, is append-only at the grant level, is written by `audit_trigger_function()` on 28 tables, carries actor/before/after/reason/IP/user-agent, and has a director-only viewer (`js/pages/audit.js`). Attach the trigger to the new tables (invariant 7) and delete this table from the plan. Only genuine loss: `audit_logs` has `company_id` but **no `project_id`** — add one, defaulted from the row's own `project_id` when present, in `<date>b_…sql`. |

**Two structural mappings that are not table-shaped:**

- **§A8's REST API does not exist and should not be invented.** Each endpoint becomes one
  RPC, keeping the blueprint's error codes verbatim as the `error` string:
  `POST /days` → `open_cash_day` · `POST /setup-opening` → `set_setup_opening` ·
  `POST /days/{id}/entries` → `record_cash_entry` · `POST /entries/{id}/void` →
  `void_cash_entry` · `POST /days/{id}/close` → `close_cash_day` ·
  `POST /days/{id}/adjustments` → `post_cash_adjustment` · `GET /days` → `list_cash_days` ·
  `GET /days/{id}` → `get_cash_day` · `GET /dashboard` → `get_cash_dashboard` ·
  `GET/POST/PATCH /payees` → `list_payees` / `upsert_payee` ·
  `GET /qb-accounts` → `list_qb_accounts`. The `Idempotency-Key` header becomes a
  `p_idempotency_key uuid` parameter. HTTP 409/422 become `{success:false, error:'DAY_LOCKED'}` —
  the codes survive, the transport does not.
- **§A5's domain events have no bus.** `DayOpened`, `EntryRecorded`, `AdjustmentPosted` etc.
  are already covered by `_trg_audit` (invariant 7). `DayClosed → PdfRenderer` and
  `AllocationApproved → ReceiptRenderer` become explicit steps at the end of the closing RPC
  (or a `pg_cron` job calling an edge function, the pattern `comms-dispatch` uses).
  Dashboard counters are one indexed query each, computed on read — RMS has no counter
  cache anywhere and should not gain one here.
