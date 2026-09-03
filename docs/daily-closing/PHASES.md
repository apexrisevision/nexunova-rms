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
| P2 | **Seeds + payee master** | **owner** | next |
| P3 | Services / use cases + error taxonomy | *inferred* | — |
| P4 | Design system "Ledger" (`--dc-*`) | *inferred* | — |
| P5 | Day Workspace (S1) | *inferred* | — |
| P6 | Close Day (S2) + Days (S3) | *inferred* | — |
| P7 | **Director PDF renderer** | **owner** | — |
| P8 | Roles & RBAC — the front-end half | *inferred* | — |
| P9 | Dashboard tile (S8) | *inferred* | — |
| P10 | **Tests + runbook** (incl. the role×action suite) | **owner** | — |
| P11–P13 | Unit lookup · allocation workflow · unapplied · client receipt | §A15 | Phase 2 |
| P14–P16 | IIF export · handover JV · PDC register | §A15 | Phase 3 |
| P17 | Group position · reconciliation · WhatsApp | §A15 | Phase 4 |

**Three anchors are the owner's own words** — P2 is seeds + payee master, P7 is the PDF
renderer, and P10 carries "the RBAC matrix and the role×action test suite". The six *inferred*
rows are my reading of §A15's Phase-1 ship list — *cash book · design system · Day Workspace ·
Close · Director PDF · roles · dashboard · tests · runbook* — laid against the ten Phase-1
prompt slots: cash book spans P1–P3 (shape, data, behaviour), then one ship per prompt.
It fits all three anchors exactly, which is why I believe it, but **P3, P4, P5, P6, P8 and P9
are inferences and want confirming** before I run them.

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

**Flagged because it may be thrown away.** RULES (b) Q6 asks whether to reuse the
`pdc_cheques` register RMS already runs — page, feature flag, audit trigger, and RPCs where
`mark_pdc_cleared` creates the payment. If the answer is "reuse", `20260903r` drops
`pdc_register` cleanly and `pdc_cheques` gains four columns instead. **Nothing should be
written to `pdc_register` before that question is answered.**

### 4 · PROPOSED MOVE — the private `daily-closing` storage bucket, P7 → P2

*As approved:* the bucket was described alongside the PDF renderer, which is P7.
*Proposal:* create it in **P2**, with the seeds.

**Why:** the renderer is not its first user. `cash_entry_attachments` needs it as soon as a
cashier attaches a bill, which is P3/P5 — two prompts before P7. Creating it in P2 costs one
line and removes a dependency that would otherwise force P5 to either create the bucket
out-of-band or ship attachments broken.

This one is a **proposal, not a decision** — say if you would rather it stayed in P7.

---

## Definition of Done — P2

Recorded here so the deferred item cannot be quietly dropped.

1. `qb_accounts` seeded from the **live Awami QuickBooks company file** — not from
   `BLUEPRINT.md` §A14. The names must match that file exactly and QuickBooks caps them at 31
   characters; the blueprint is a transcription and transcriptions drift.
2. `entry_type_defaults` seeded: `CLIENT_RECEIPT → 2020 Advance from Customers`, `CASH → 1010`,
   `BANK → 1030`, `TRANSFER → 1010 ↔ 1030`, and the suggested type lists for `EXPENSE` and
   `LOAN_CAPITAL`.
3. `cash_accounts` seeded for the pilot project — one CASH drawer, and the bank account(s)
   that **RULES (b) Q2 is still waiting on**.
4. **The invariant-5 trigger** (deviation 2): reject a `cash_entries` row whose
   `qb_account_id` differs from its type's default unless `qb_override_reason` is present and
   non-empty → `OVERRIDE_REASON_REQUIRED`. **Plus the `4010` fence:** no entry may cite
   `4010 Unit - Shop Sales` at all until `recognize_revenue()` exists in Phase 3.
5. The payee master: RPCs to list, create and rename/deactivate, admin-gated, with
   `PAYEE_INACTIVE` returned rather than a silent pass.
6. Tests, in the shape P1 set: assertions inside `BEGIN … ROLLBACK`, and each one proved able
   to go red before it is trusted.
7. `SCHEMA.md`'s "not yet enforced" flag on invariant 5 **removed** — and only then.

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
