# Daily Closing — PHASES

The blueprint's §A15 plan, mapped onto the prompt sequence actually being run, with every
merge, split and resequence named.

> **Correction.** At the end of P1 I described the next step as *"P2 (RPCs + PDF renderer)"*.
> That was wrong on both halves: P2 is **seeds + the payee master**, and the PDF renderer is
> **P7**. The services/RPC layer is P3. Nothing was built on the wrong assumption — the
> mistake was in a sentence, not in code — but it is recorded here because a wrong sequence
> stated once tends to get repeated.

---

## The phase gates — unchanged, and not negotiable by working faster

Straight from `BLUEPRINT.md` §A15. Prompts are the work; **gates are the permission to stop
doing the old thing**, and three of the four are measured in calendar days, so no amount of
building brings them forward.

| Phase | Prompts | Ships | Retires | Gate to the next phase |
|---|---|---|---|---|
| 0 | P0 | Architecture notes, rules mapping | — | Questions answered ✅ |
| 1 | P1–P10 | Cash book · design system · Day Workspace · Close · Director PDF · roles · dashboard · tests · runbook | Excel | **14 consecutive days where module closing = Excel closing** |
| 2 | P11–P13 | Unit lookup · allocation workflow · unapplied · client receipt | Manual RMS entry | **30 days, zero unresolved unapplied > 3 days** |
| 3 | P14–P16 | IIF export · handover JV · PDC register | Manual QB entry | **4 weekly reconciliations with zero difference** |
| 4 | P17 | Group position · reconciliation · WhatsApp | Chasing numbers | — |

**Finishing P10 does not finish Phase 1.** It starts the 14-day parallel run: the cash book
and the Excel sheet are both kept, every day, and the closing figures must agree fourteen
times in a row. Excel is retired on day fifteen, not on the day the tests go green.

---

## Prompt-level map

| # | Prompt | Source | Status |
|---|---|---|---|
| P0 | Discovery — BLUEPRINT / ARCHITECTURE_NOTES / RULES | given | ✅ done |
| P1 | Schema & models | given | ✅ done — `20260903e/f/g`, `SCHEMA.md` |
| P2 | **Seeds + payee master** | **owner** | ✅ done — `20260904a-g`, applied |
| P3 | **CashDay lifecycle ONLY** — SetupOpening · OpenDay · DaySummary · CloseDay · PostAdjustment | **owner** | ✅ done — `20260904h`, applied |
| P4 | **Entry recording ONLY** — RecordEntry · VoidEntry · attachments · ListEntries | **owner** | ✅ done — `20260904j` (+`i`) |
| P5 | Design system "Ledger" (`--dc-*`) | **owner** | ✅ done — `DESIGN.md`, no DB change |
| P6 | Day Workspace (S1) | **owner** | ✅ done — `daily-closing.html`, `20260904k` |
| P7 | **Close Day (S2) + Director PDF renderer** | **owner** | — |
| P8 | Roles & RBAC — the front-end half | **owner** | — |
| P9 | Dashboard tile (S8) | **owner** | — |
| P10 | **Tests + runbook** (incl. the role×action suite) | **owner** | — |
| P11–P13 | Unit lookup · allocation workflow · unapplied · client receipt | §A15 | Phase 2 |
| P14–P16 | IIF export · handover JV · PDC register | §A15 | Phase 3 |
| P17 | Group position · reconciliation · WhatsApp | §A15 | Phase 4 |

**All ten Phase-1 slots are now the owner's own, not inferred** (confirmed 2026-09-04).

### ⚠️ P3 and P4 are two prompts, two commits, two reviews — do not combine them

My earlier map had a single "Services / use cases" prompt at P3. The owner split it:

- **P3 — the day.** SetupOpening, OpenDay, DaySummary, CloseDay, PostAdjustment. **Nothing
  about entries.**
- **P4 — the entry.** RecordEntry, VoidEntry, attachments, ListEntries.

**Why the split, in his words:** *"P4's idempotency, seq_no locking and transfer atomicity need
their own review; buried in a combined services commit they will get skimmed."* That is the
whole reason — three of the hardest correctness rules in §A7 live in P4, and a reviewer reading
one large services diff will skim past them. Anyone tempted to merge these later should read
that sentence again.

The knock-on: the design system moved P4→**P5**, Day Workspace P5→**P6**, and Close Day joins
the PDF renderer at **P7**. P8, P9 and P10 are unchanged.

---

## Deviations from the blueprint sequence

Four, all in P1, none silent.

### 1 · SPLIT — the CFO role, SQL half pulled forward into P1

*Blueprint:* "roles" is a Phase-1 ship, which the map above puts at **P8**.
*Done:* the SQL half — `public._dc_is_cfo()` — shipped in P1 as `20260903g`.

**Why:** on the owner's own instruction ("plus the cfo role migration since §0.3 depends on
it"). It is also a hard dependency: every service RPC in P3 has to reference the predicate,
so it cannot arrive after them.

**What P8 still owns**, and must not assume is done: the five front-end registration sites
listed in `ARCHITECTURE_NOTES.md` §3.4 — `js/ui.js` role predicates, the `buildSB` nav branch,
`nav()`'s allow-list, `hasPermission()`'s defaults map, and the `dailyclosing` module key. A
`cfo` account today has the privilege at the database and no sidebar to use it from.

### 2 · DEFERRED — invariant 5's override-reason enforcement, P1 → P2

*Blueprint:* invariant 5 holds "everywhere: DB constraints, domain rules, API, UI, tests."
*Done in P1:* the `entry_type_defaults` table that holds the defaults. Nothing enforcing them.

**Why:** `CHECK (qb_account_id = default_for_type OR qb_override_reason IS NOT NULL)` cannot be
written as a CHECK — a CHECK constraint cannot query another table, and this one has to look up
`entry_type_defaults`. It must be a trigger, and P1's brief was shape and immutability only.

**Accepted by the owner, on condition it stays visible.** It is flagged in `SCHEMA.md` under
both the invariant table and "What P1 does NOT include", and it is an **explicit item in P2's
Definition of Done** below. Until that trigger exists the schema will accept any QuickBooks
head on any entry type, including `4010`.

### 3 · RESEQUENCED — `pdc_register` created in P1, though PDC ships in Phase 3

*Blueprint:* the PDC register is **P16**, in Phase 3.
*Done:* the table and its `(project_id, status, due_date)` index exist now, empty, written by
nothing.

**Why:** P1's brief named that index explicitly in its required list, so the table had to
exist for the index to. The cost is a table sitting unused for two phases.

**✅ RESOLVED 2026-09-04 — it was thrown away.** `PDC_DECISION.md` was written in P2 and the
owner accepted its recommendation: the module adopts the live `pdc_cheques`, and
`20260904g` dropped `pdc_register` while it was still empty and the drop was free. The four
fields `pdc_cheques` still needs — `kind`, `party_payee_id`, `cleared_entry_id`, a `status`
CHECK — are P16 work and were deliberately not added now. Test 37 asserts `pdc_register` is
gone and that `pdc_cheques` still holds its seven live rows.

### 4 · PROPOSED MOVE — the private `daily-closing` storage bucket, P7 → P2

*As approved:* the bucket was described alongside the PDF renderer, which is P7.
*Done:* created in **P2**. Accepted by the owner 2026-09-04.

**Why:** the renderer is not its first user. `cash_entry_attachments` needs it as soon as a
cashier attaches a bill, which is P3/P5 — two prompts before P7. Creating it in P2 costs one
line and removes a dependency that would otherwise force P5 to either create the bucket
out-of-band or ship attachments broken.

✅ Accepted.

---

## Definition of Done — P2  ·  built, tested and **applied** 2026-09-04

Recorded here so the deferred item cannot be quietly dropped. Status against each item below.

1. ⚠️ **Deviation, on the owner's instruction.** This item said seed from the **live Awami
   QuickBooks company file**, not from `BLUEPRINT.md` §A14, because the blueprint is a
   transcription and transcriptions drift. P2's prompt said the opposite — *"the 53
   qb_accounts from BLUEPRINT.md §A14 … names EXACTLY as written"* — and that is what was
   built. The risk this item was written to catch is therefore **still open**: nobody has
   diffed §A14 against the real company file. The Phase-3 IIF export matches on NAME, and
   QuickBooks silently creates a new account when a name does not resolve, so one wrong
   character becomes a duplicate account nobody notices until a reconciliation fails.
   **A one-time diff against the live file is owed before P16.** Correcting a drifted name
   afterwards is cheap — re-running the seeder fixes it (test 04).
2. ✅ `entry_type_defaults` seeded — 5 rows, `CLIENT_RECEIPT → 2020`. The §A14 *mode* defaults
   (`CASH → 1010`, `BANK → 1030`, `TRANSFER → 1010 ↔ 1030`) turned out not to belong here at
   all: they describe the drawer and the bank account, so they land on `cash_accounts`
   instead. The other four entry types are deliberately NULL — a default there would make
   every ordinary expense an "override" needing a written reason. Test 05.
3. ✅ `cash_accounts` seeded — `Cash in Hand` → 1010, `Bank Al-Habib - Awami` → 1030. Test 06.
   **RULES (b) Q2 is now answered in practice:** `project_bank_accounts` is the source of
   truth for bank *identity* and `cash_accounts` references it by FK; there is no Awami row
   there yet, so the link is NULL and the seeder re-checks it on every run. See `SCHEMA.md`.
4. ✅ **The invariant-5 trigger** — `cash_entries_qb_head_guard()`, `20260904b`. Both halves:
   `OVERRIDE_REASON_REQUIRED` off-default with no reason (tests 24, 26), allowed with one
   (test 25), no reason needed where there is no default (test 27); and the `4010` fence on
   the single head (test 28), on **both legs of a JV** (test 29), opening only for Phase 3's
   `dc.revenue_recognition` flag (test 30).
5. ✅ The payee master — `list_payees` · `create_payee` · `rename_payee` · `set_payee_active`,
   gated at **Accountant+** (`accounts` or `_dc_is_cfo`), plain `admin` refused. No delete
   exists and none will (test 21). `PAYEE_INACTIVE` on *entry* rather than on listing is P3's
   job — `record_cash_entry` does not exist yet, and that is where a payee is used.
6. ✅ Tests — 33 assertions inside `BEGIN … ROLLBACK`, and the suite proved able to go red:
   running the same batch with `20260904b` removed fails at test 24, as it must.
7. ⚠️ `SCHEMA.md`'s invariant-5 flag is **rewritten, not removed**. It now says the trigger
   exists and is tested but **is not yet applied to the live database** — so the live schema
   still accepts any head. The last sentence comes out when the migrations are applied.

### Other P2 outcomes worth carrying forward

- ✅ **`app_users_role_check` widened to admit `cfo`** (`20260904f`). Found by test 33 on its
  first run — P1 recorded, wrongly, that the column had no CHECK. Additive change, approved by
  the owner, applied after a backup; the migration asserts in its own transaction that all
  rows still pass and none was rewritten. The tripwire is flipped: tests 33–36 now prove a
  real `cfo` account can be created and passes the Accountant+ gate. **RULES §0.9 unblocked.**
- ✏️ **The Accountant's role value is `accounts`, not `finance`.** RULES §0.3 had that
  backwards; corrected there and in §0.4, and confirmed by the constraint itself.
- ✅ **PDC decided** (RULES (b) Q6, `PDC_DECISION.md`). `pdc_register` **dropped now**, not in
  P16 — while it was empty and free. `pdc_cheques` is the one register; its four missing
  fields are P16.
- ✅ **Deviation 4 accepted** — the private `daily-closing` bucket was created in P2.
- 🔍 **`scripts/verify-qb-accounts.js` added**, closing DoD item 1's open risk early rather
  than before P16. It diffs the seeded 53 against a real QuickBooks export and, critically,
  detects whether QuickBooks names carry an account-number prefix — which decides what the
  Phase-3 IIF must emit. **Waiting on the export file from the owner**; the exact format is in
  the script's header.

---

## Standing constraints on every prompt from here

- **No accounting outputs.** No general ledger, no P&L, no balance sheet, no financial
  statement, no account balance rolled across periods. This module totals its own rows and
  never totals accounts. If a prompt asks for one — stop and flag it. (RULES §0.1)
- **One project.** `projects.id = 59ded55b-9bc2-45b2-a372-49fc31807fa9`. The sales portal,
  `smoke-portal.js`, and the two tenant rows sharing the Fourteen Group brand are out of
  scope and untouched. If the cash book would need portal behaviour to change — stop and flag
  it. (RULES §0.8)
- **Karachi, not UTC.** `td()` and Postgres `CURRENT_DATE` are both UTC and would file the
  first five hours of every night under the previous business date. (RULES risk 2)
- **Both roles from day one.** The permission model is not simplified because one person uses
  it. P10 must prove the cashier is refused *server-side*, not merely shown no button.
  (RULES §0.9)

---

## P7 is done — what it left for P10

P7 shipped S2 (the close panel), the Director PDF renderer, and S3 (the days list), and added
RowMenu and SidePanel to the kit. Three items were carried forward deliberately rather than
quietly, and they are now part of **P10's Definition of Done**:

### P10 · Definition of Done — carried items

1. **The attachment path, end to end, for real.** P4 built `daily-closing-file` and P6 wired the
   composer to it, but no file has ever made the round trip. P10 must:
   - attach a real file to a real entry on the pilot project;
   - prove the storage key **starts with that entry's `project_id`** — the bridge builds the key
     and the browser never chooses it, and that must be demonstrated rather than asserted;
   - prove a user assigned to **another project cannot fetch the signed URL** for it.

2. **A named red, not a timeout.** The screen suite proves it can fail, but some paths fail by
   `waitForFunction` timing out rather than printing a `❌` that says what broke. A timeout is a
   real failure; a named one is a usable one. Give every wait a message.

3. **The cashier is refused server-side.** Unchanged from RULES §0.9 — P10 proves the `staff`
   cashier is refused by `close_cash_day` and `post_cash_adjustment` themselves, not merely
   shown no button.

### Still open from earlier prompts

- The two Awami accounts (a `cfo` and a `staff` cashier) are the owner's to create in
  Users & Roles.
- RULES (b) questions Q2 (bank account tables), Q3 (PDF grain), Q4 (voucher book grain),
  Q5 (client receipt duplication), Q7 (paisa display), Q8 (double-entry during the parallel
  run) remain unanswered and none of them blocks P8.
