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

---

# Standing rules for this module's test suites

These are not phase notes. They hold for every prompt from here on, and a new suite that
breaks one of them is wrong even if it passes.

## SR-1 · A project that holds permanent fixtures must never host a suite that wipes entries

**Rule.** On any tenant, a project used as a *permanent* fixture (rows that outlive the run)
and a project used by a *wiping* suite (`DELETE FROM public.cash_entries WHERE project_id = …`)
must be different projects. Today: **ZZTEST Tower** holds the golden PDF fixture;
**ZZTEST Garden** (`2da565ca-…`) is where the wiping suites run.

**Why it is not merely tidy.** Invariant 1 makes `cash_entries` undeletable — the trigger raises
on DELETE. A wipe against a project with entries in it therefore cannot succeed *and cannot be
cleaned up afterwards*: there is no supported way to remove those rows. The only escape is
`ALTER TABLE … DISABLE TRIGGER`, which turns invariant 1 off table-wide, for every tenant,
for as long as the window lasts. A tidy-up is never worth that.

**How it hid.** A wipe against a project with no entries raises nothing — a row trigger that
fires on zero rows is silent. So the collision is invisible until the day someone adds a
permanent fixture, and then it lands on the *first line of setup* of a suite that has been
green for weeks and has nothing to do with the change.

**What to do when you add a fixture that cannot be deleted.** Give it its own project, say so
in the script's header, and check that no other suite wipes that project. Moving the fixture
later is not an option — that is the whole point.

## SR-2 · An assertion of the form "X must not appear" is suspect until it has been seen to fire

**Rule.** Every negative assertion — *no phone number*, *no lakh grouping*, *no "delete" on the
page*, *nothing was sent to the server* — must be accompanied by proof that it CAN fail:
either a probe in the same run that feeds the detector something it must catch, or a positive
control establishing that the thing being searched is real.

**Why.** A negative assertion passes on the empty string, on gibberish, on a page that failed
to load, and on a detector with a broken regex. It is green in every one of those cases, and
green is exactly what it would be if everything were fine. This is the same shape as the
NULL-comparison trap that made 52 assertions unfailable in P2–P4; it has now appeared three
times in three costumes:

1. `IF (v_res->>'error') <> 'X'` — NULL on success, so the check never ran. (P4)
2. §A10's phone and lakh checks — green on an empty extraction, then green again on 700
   characters of glyph-id gibberish; and the lakh regex only ever matched *crore* shapes, so
   `1,50,000` passed it. (P7)
3. The same checks after Inter was embedded — the length guard passed, because there was
   plenty of text; it just was not language. (P8)

**The three guards that answer it.** At least one must accompany every negative assertion.

1. **Detector self-test.** Synthetic probes in the same run assert the detector fires on what it
   must catch and stays silent on what it must not. A detector that has never fired is not a
   detector. (`verify-daily-closing-pdf.js` runs eight of them every time.)

2. **Intelligibility gate — REQUIRED whenever the subject is parsed, decoded, rendered or
   fetched.** Before any "must not appear" assertion is allowed to run, **positive controls must
   prove the text being searched is really the thing it claims to be.** Not that it is non-empty
   — that it is *the document*. If the controls are missing, the run stops there with a named
   failure and prints what it actually got.

   This is the generalisation of the third instance, and it is the rule, not a P8 convenience.
   An extracted string, a rendered page's `textContent`, an API response, a log file: every one
   of them can arrive complete, plausible, the right length, and not be the thing you meant to
   read. A length check does not distinguish 700 characters of glyph-id gibberish from 700
   characters of English, and every absent-check downstream of it is then reporting on noise.
   **A negative assertion may only run on output that has been proven readable.**

3. **A paired positive case.** The same action by a caller who *is* permitted must succeed in
   the same run, so a harness that can do nothing at all goes red instead of green. This is what
   makes the P8 role matrix trustworthy: every deny cell has an allow cell beside it.

## SR-5 · A test that supplies the state under test has not tested it

**Rule.** When a harness injects the very state whose *acquisition* is the thing being relied on,
it can only test what the code does with that state — never whether the code ever gets it. Say
so in the file, and cover the acquisition somewhere that seeds nothing.

**What it cost.** `verify-daily-closing-shell.js` had sixteen green assertions about the
Daily Closing feature gate. Every one of them passed while the module was **invisible on the
pilot**. It set `window._featureFlags` with `evaluateOnNewDocument` — before the page loaded —
so `buildSB()` always saw populated flags. The gate's logic was correct and thoroughly proved.
The bug was entirely in the *order*: `js/auth.js` called `buildSB()` at line 383 and
`loadFeatureFlags()` at line 411, so in production the gate was evaluated against `null`.

The owner found it by opening the app. Sixteen assertions did not.

**Why it is the same family as SR-2.** A pre-seeded harness, a NULL comparison, an absent-thing
detector that has never fired, a timing wrapped in `clock_timestamp()` that always reads zero —
all four are a check that **cannot observe the thing it claims to cover**, and all four look
exactly like a passing test.

**How to apply.**

- Ask of every harness: *what am I handing this code that production makes it go and get?*
  A session, a feature flag, a cached list, a config object, a clock. Each one is a candidate.
- Stub the **network**, not the **state**. `?stub=1` in this module replaces the RPC layer and
  the screen still calls, awaits and handles the answer — that is a real async path. Setting
  `window._featureFlags` replaces the *outcome* and skips the path entirely.
- Where the acquisition matters, drive the real entry point with nothing seeded, and make the
  dependency arrive **late and by a stub you control** — `verify-daily-closing-boot.js` answers
  the flags after 1800 ms on purpose, because the interesting case is never the happy one.
- Prove the new test would have caught the original bug. Reverting the fix must turn it red;
  if it stays green, it is testing the fix rather than the failure.

**Where it is done:** `scripts/verify-daily-closing-boot.js` — seeds nothing, runs the real
`_completeLogin()`, and covers flags-on-time, flags-late (the shell must repair itself),
flags-failed (the shell must survive), and a tenant with no flags at all.

## SR-6 · A fix verified on one entry path is unverified on every other

**Rule.** Before a fix is called done, name every way the code under it can be entered, and
say which of them the test actually drove. The ones it did not drive are not "probably fine" —
they are **untested**, and if the bug was an omission rather than a mistake, the untouched
entry point is exactly where the omission still lives.

**What it cost.** The SR-5 boot test above was written to catch the feature-flag ordering bug,
and it did: it drove the real `_completeLogin()`, seeded nothing, and went red on the unfixed
code. The fix shipped. **The module was still invisible on the pilot.**

RMS reaches the app shell two ways, and they are separate code:

| | | |
|---|---|---|
| fresh login | `_completeLogin()` | `js/auth.js` |
| returning visit | `tryRestoreSession()` | `js/init.js` |

The second is what a hard refresh runs — which is how the owner, and every user of every
tenant, actually arrives. It had never loaded the feature flags in its life
(`grep -c loadFeatureFlags js/init.js` → `0`), so the ordering fix could not help it: there
was no order to get wrong. A nineteen-assertion suite went green on a fix applied to half the
app, and the owner found the other half by opening the site.

**Why it is the same family as SR-2 and SR-5.** All three are a green suite that cannot see
the failure. SR-2 is a detector that never fires; SR-5 is a harness that hands over the state
whose acquisition is the bug; SR-6 is a harness pointed at the door the bug is not behind. In
each case the assertions are correct and the coverage is imaginary.

**How to apply.**

- Before fixing, `grep` for every caller and every entry point, and **write the list down**.
  Two boot paths, a page-load and a `nav()`, an RPC and the edge function that wraps it, a
  cron and the manual button beside it — these are the usual shapes.
- Fix it **once, in one place**, and have every entry point call that place. `startShellContext()`
  exists for exactly this: the next thing the shell needs cannot be added to only one path,
  because there is only one path to add it to.
- Drive each entry point in the harness. Not a variant of one — the actual other function.
- Prove each one is a detector, per SR-2. `verify-daily-closing-boot.js` serves `js/init.js`
  a second time with the two shell-context lines stripped out by its own server, and asserts
  the restore-path checks go **red** against it. Generated from the real file, so it cannot rot.
- If an entry point is deliberately left unfixed, say so where the finding lives, not in a
  commit message. See docs/findings/2026-09-04-A-session-timers.md.

**Where it is done:** `scripts/verify-daily-closing-boot.js` sections 6-8 — the returning
visit, the same visit against the unfixed file, and the KBH/FMH shape on that path too.


## SR-7 · Replicate the environment; never construct it

**Rule.** When the thing that broke is the *shape of the environment* — a global, a session, a
storage key, a load order — a harness that builds that shape by hand has already destroyed what
it was meant to test. Load the real files and let the shape happen. Whatever cannot be loaded,
**write down that it is missing** rather than approximating it and staying quiet.

**What it cost.** Daily Closing sat on skeletons for the whole first week of the pilot. The cause
was one identifier: the shell adapter said `global.supabase.rpc`, but `js/supabase.js:37` creates
the client as `const supabase = createClient(…)` — a script-scope lexical binding that is **not**
a property of `window` — while `window.supabase` remains the supabase-js UMD library, which has
`createClient` and no `rpc`. The call threw synchronously, escaped `nav()` (which catches promise
rejections, not throws), and left the DOM exactly as `render(true)` had painted it.

**The first attempt to reproduce it passed.** The repro set `window.supabase = { rpc, auth }`
itself, and with that one line the bug cannot exist. It only went red after the harness stopped
constructing the client and started creating it the way production does — and even then, writing
`var supabase = …` instead of `const` hid it again, because `var` at script top level *does* put
the binding on `window`. Two near misses on one identifier and one keyword.

**Why it is the same family as SR-2, SR-5 and SR-6.** Four ways for a green suite to be blind:
a detector that never fires (SR-2), a harness that hands over the state whose acquisition is the
bug (SR-5), a harness pointed at the entry path the bug is not behind (SR-6), and a harness that
rebuilds the environment the bug lives in (SR-7). All four look exactly like passing tests.

**How to apply.**

- Load the real files: the real vendor bundle, the real client module, the real `login.html`, the
  real `nav()`, the real lazy loader. `verify-daily-closing-shell-adapter.js` asserts the trap
  itself is present before it asserts anything else — `window.supabase.rpc === undefined` and
  `supabase !== window.supabase`. If a future change makes those two false, the suite says so
  rather than passing for the wrong reason.
- Stub the **network** and the **browser's own storage** — a session in `localStorage`, a `fetch`
  interceptor — never the application's globals. Storage is what a signed-in browser holds; a
  global is what the code under test goes and finds.
- Take the payloads from production rather than writing them out. This suite captures them at run
  time by impersonating the pilot's owner, and its §0 **fails** if the pilot stops being in the
  state the suite is about, instead of quietly testing a different case.
- **Name what you could not reproduce, in the file, in the header.** This one cannot exercise TLS,
  PostgREST's routing or the real 401 path (that is what the isolation suite is for), signs no
  one in with a real credential, and answers other modules' RPCs with an empty array — and it
  prints the list of every call that got that default, so a gap is visible instead of shaping the
  result in silence.

**Where it is done:** `scripts/verify-daily-closing-shell-adapter.js` — the only suite that
executes `js/pages/daily-closing.js:1214-1277` and `daily-closing-tile.js:213-244` at all. Its
own server re-serves both files with `supabase.` rewritten back to `global.supabase.`, generated
from the real files, and every assertion must go red against them.

## SR-8 · Evidence that cannot be seen is evidence that does not exist

**Rule.** Never pipe a test, suite or gate run through `tail`, `head` or `grep`. Redirect the whole
thing to a file and read what you need out of it. A summary is for reporting a result, never for
observing one.

**What it cost.** Three times in one week, on the same day's work:

| | |
|---|---|
| `npm run gate` piped through `tail -30` | Ten of fifteen failures scrolled past unrecorded. Finding 2026-09-04-B still has no cause, and the missing ten lines are the single most valuable thing that could settle it. |
| The daily-closing suites piped through `grep -E "PASS\|FAIL"` | The load suite failed once and the line naming which budget it blew was thrown away. Three clean re-runs later there is nothing to diagnose. |
| `npm run gate` piped through `tail` again | A run died without printing its `RESULT` line; the truncated log made it look like a crash and sent an hour into a hypothesis (§6 of Finding B) that reading the suite for thirty seconds would have refuted. |

Each time the run was *observed* through a filter chosen before knowing what mattered. Each time
the filter removed exactly the part that did.

**And a truncated log does not only hide an event — it invents one.** The third row above is the
worst of the three for that reason. The log ended without a `RESULT` line, so it was read as
*"the run crashed"*. It had not: the **capture** ended when the shell call returned, while the
node process carried on and finished its own cleanup minutes later. A crash that never happened
then became the premise of an hour's reasoning — a hypothesis about orphaned fixtures, a finding
updated with it, and a retraction the next day.

Absence of output is not evidence of absence of execution. Before concluding that a run died,
check whether the *process* died: did anything append to the log afterwards, did the side effects
it was going to perform still happen, is there a pid. A missing final line means the observer
stopped watching, and that is the likelier of the two explanations, because the observer is the
thing under your control and the thing you just interrupted.

**Why it is the same family as SR-2, SR-5, SR-6 and SR-7.** Those four are ways for a suite to be
unable to see a failure. This is the way for the *operator* to be unable to see one — and it is
worse, because it destroys evidence of failures the suite did catch. A green summary from a
filtered run and a green summary from a passing run look identical.

**How to apply.**

- `node scripts/verify-x.js > "$SCRATCH/x.log" 2>&1; tail -3 "$SCRATCH/x.log"` — run to a file,
  then read the file. Never `node scripts/verify-x.js | tail -3`.
- For a batch, write one log per suite and `grep` **the files**, which keeps the evidence. Grepping
  a pipe consumes it.
- Reach for the log the moment anything is red, before re-running. **Re-running is what destroys
  the evidence**, and the pressure to re-run is highest exactly when the gate is blocking a push.
- An intermittent failure that has been "fixed by re-running" has not been diagnosed. Say so.
- Never report "the run died" from a short log alone. Establish that the process died, not the
  capture.
- This applies to the model's own tool calls first. Nobody else was filtering these runs.

**A harness must say which of the three things happened.** The same rule one level down: a run
that could not start is not a run that failed, and reporting them the same way is the summary
version of the mistake above.

| exit | meaning |
|---|---|
| `0` | it ran and the thing under test held |
| `1` | it ran and **the thing under test failed** — a real defect |
| `2` | **it could not run** — a dirty slate, no browser, no credentials. Nothing was learned. |

`smoke-portal.js` exits 2 when it finds ZZSMOKE rows it cannot account for and refuses to seed
onto a dirty slate; the browser-based suites exit 0 with an explicit `SKIPPED — nothing was
verified. This is a skip, not a pass.` when Chrome is missing. Keep that distinction everywhere:
a suite that returns 1 for "could not run" trains everyone to treat 1 as noise, which is exactly
how a real 1 gets re-run away.

**Where it is done:** the flake in `verify-daily-closing-boot.js` was caught this way — six runs
written to six files, one of which was red, with the failing assertion named in full. It turned
out to be a racing assertion rather than a product fault, which is a thing only the full line
could have said.

## SR-9 · Stubbing a network means asserting the request, not only supplying the response

**Rule.** A call has two halves. If a harness intercepts one, it owns both: assert what was
**sent** as well as answering it. A stub that matches on the endpoint and replies from a map has
not tested a call — it has tested half of one, and the half it skipped is the half the client
builds.

**What it cost.** `verify-daily-closing-shell-adapter.js` was written specifically to catch a
shell-adapter bug, drove the real `login.html`, loaded the real globals rather than constructing
them, and went red against a deliberately re-broken file. It passed 39/39 while the pilot could
not open the screen at all.

Its interceptor matched `/rest/v1/rpc/<name>` and answered from the captured map. It never looked
at `init.body`. So when `sess.cid` was `undefined` — `js/data.js:5` is `let S = null`, another
lexical binding that is not on window — the page sent `{p_project_id, p_business_date}` with
`p_company_id` **silently dropped by JSON.stringify**, and the stub cheerfully returned a valid
summary anyway. Production answered `PGRST202 … with parameters p_business_date, p_project_id`,
which the module then laundered into *"You do not have access to the cash book. Ask the CFO."*
Three translations from an undefined variable to a false statement about someone's permissions.

**SR-5 was followed, and it still missed it.** SR-5 says stub the network, not the state, and that
is exactly what this harness did — the rule was right and the execution was half. Answering a
request is not intercepting it. Assert the request or you have replaced the client's contribution
to the call with your own assumption about it.

**How to apply.**

- Record every intercepted request body and assert its **whole shape**, not the one argument that
  once caused an outage. See SR-10 for why that distinction is the entire point.
- Watch for silent droppers. `JSON.stringify` removes `undefined` values, `URLSearchParams`
  stringifies them as `"undefined"`, and a missing header is simply absent. None of them raise;
  each turns a missing value into a differently-shaped request.
- The same applies to anything else the code under test *emits*: a payload posted, a file written,
  a log line, an argument passed to an injected function.

**The audit that came with this rule** (2026-09-05, every harness that intercepts a call):

| harness | asserts the request? |
|---|---|
| `verify-daily-closing-shell-adapter.js` | **was the gap** — now records every body and checks all six argument shapes |
| `scripts/smoke-portal.js` | **yes** — `call.args.p_lead_ids.length === selCount`, and it exists because of a past "only 1 lead went" regression. The precedent. |
| `verify-daily-closing-screen.js` | partly — nine assertions on `args` (idempotency key, `p_limit`, `p_reason`, void and close payloads), but never on `p_company_id`, and it could not: the stub page constructs its own `me`. That gap is SR-7, not this one. |
| `js/pages/daily-closing-stub.js` | reads args and behaves on them, which is why the screen suite can assert them at all |
| `verify-daily-closing-boot.js` | **no** — its `rpc` stub takes `(name, args)` and logs only the name. Left as is: it drives the shell's boot ordering, not the module, so no module argument reaches it. Recorded rather than fixed. |
| the SQL suites | nothing is intercepted; the call *is* the request |

## SR-10 · A red proof you chose proves the assertion; a mutant you did not choose finds the assertion you never wrote

**Rule.** Every red proof in this repo is one mutation, hand-picked *after* the cause was known.
That is worth having — it shows the assertion fires. It can never show the assertion that was
never written. Before trusting a suite, break the product in ways **nobody chose**, mechanically,
and require the suite to notice. Anything that survives is a blind spot, named before production
finds it.

**Why this rule exists.** Four times now a green suite could not see the failure it was written
to catch: the NULL-trap in P4, absent-detectors that had never fired, a fix verified on one boot
path, and a stub that only supplied responses. SR-2, SR-5, SR-6, SR-7, SR-8 and SR-9 were each
written afterwards, and each is correct. They share a shape that guarantees a fifth: **an
assertion written after a bug is shaped like that bug.** The suite that just caught a missing
`p_company_id` checks `p_company_id` on every call, and nothing else, because `p_company_id` is
what hurt.

**What the first pass found.** Four mechanical mutations of `js/pages/daily-closing.js`, run
against the 39-assertion shell-adapter suite:

| mutation | result |
|---|---|
| `p_company_id` → a different tenant's id | **killed** — the argument that had just bitten us |
| `p_business_date` → `null` | **survived** — a cash book silently reading a day nobody asked for |
| `list_units_for_picker` loses its project scope | **survived** — a unit picker widened across projects |
| `p_project_id` → `null` on the summary call | **survived** |

Three of four. The first three are now killed by asserting the whole argument shape. The fourth
survives for a different reason and the distinction matters: it mutated the call inside
`loadAudit()`, a view this suite never drives — an **uncovered path** (SR-6) rather than a missing
assertion (SR-9). A mutation pass separates those two automatically, which reading the suite does
not.

**How to apply.**

- Mutate mechanically and in bulk: null an argument, drop a call, invert a condition, make a
  function throw, return an empty list. Choose them from the *code*, never from the bug list.
- Run the suite against each; a non-zero exit is a kill. A survivor is a finding.
- Triage every survivor into **no assertion** (write one) or **no coverage** (drive the path, or
  record it as knowingly uncovered).
- Do this before a module carries real money, not after. The first pass here took four minutes
  and found three real gaps.

**Where it is done:** `scripts/mutate-daily-closing.js`, built 2026-09-05.

```
node scripts/mutate-daily-closing.js              # a reproducible sample
node scripts/mutate-daily-closing.js --all        # all 1609
node scripts/mutate-daily-closing.js --n=40 --seed=7
```

Fifteen mechanical operators over the four module files produce **1609 mutants** — arguments
nulled, conditions forced either way, comparisons and connectives flipped, negations dropped,
literals zeroed, returned markup emptied. There is no list of interesting cases and there must
never be one: **the moment someone curates the list this becomes another backward-looking rule**
and stops finding what nobody thought of. If a mutant is uninteresting that is a fact about the
suites, not a reason to delete the mutant. Sampling is seeded so a run reproduces exactly.

It **separates the two kinds of survivor mechanically**, because "3 survived" sends you looking in
the wrong place. For every function containing a survivor it builds a *reachability probe* — the
same file with `throw` as that function's first statement — and runs the suites again. Probe
killed → the function is driven → the survivor is **unasserted (SR-9)**. Probe survives → the
function never runs → the survivor is **undriven (SR-6)**. That is the `loadAudit` distinction
that separated itself by accident, done on purpose.

It is scoped to the daily-closing module and refuses to mutate anything else. KBH and FMH paths
are deliberately excluded: findings there would surface in live tenant code and have to be triaged
under time pressure, and the point is to harden the cash book *before* it holds money.

**It reports; it does not gate.** Exit 0 whatever survives, exit 2 only if it could not run. A
mutation score wired into the push gate on day one gets tuned down to whatever passes, and then it
is worse than nothing because it looks like a control.

### What mutation testing will NOT catch — the honest summary of this module's first week

The cash book **has never held a real transaction.** Every bug found so far has been in the
**wiring between the RMS shell and the module**, not in the cash book: a feature flag read before
it was loaded, a client read off the wrong object, a session read off the wrong object, a boot path
nobody drove, a failed call rendered as a permissions message. The schema, the services, the eight
invariants and the tenant isolation have held up under real testing, including a real foreign JWT
over real HTTPS against production.

And the wiring is exactly what this runner is **worst** at reaching:

- It mutates the module's own source. `global.supabase` vs `supabase`, `global.S` vs `S` are
  one-token differences an operator could generate in principle — but the bug was about which of
  two globals *exists at runtime*, a property of `js/data.js` and `js/supabase.js`, not of this
  module.
- It cannot mutate load **order**, which is where the feature-flag bug lived.
- It cannot mutate the **absence** of a call. `tryRestoreSession` never called
  `loadFeatureFlags`; there was no line to change.
- It cannot mutate the **harness**. A suite that stubs away the thing under test kills mutants
  happily and proves nothing. SR-5 and SR-7 remain the only defence there.
- It says nothing about whether the module's **rules** are right. A mutant that survives because
  both behaviours are wrong is invisible to it.

What it does reach is logic: predicates, arguments, branches, arithmetic, returned shapes. That is
most of the cash book and almost none of this week's bugs. **Both halves of that sentence are the
point** — this is a strong instrument aimed at the half of the system that has not been failing,
and it is worth having precisely because that half is the half about to hold money.


## SR-3 · Review a query plan with `enable_seqscan = off`, not by reading `pg_indexes`

**Rule.** When a prompt asks for query plans, take each plan **twice**: once as the planner
really runs it, and once inside `SET LOCAL enable_seqscan = off`. Assert on the second.

**Why both of the obvious checks are worthless here.**

- **"It used an index" on the live data proves nothing.** ZZTEST holds single-digit row counts
  and the pilot will hold hundreds for months. Postgres sequentially scans an eight-row table
  and is *right* to; asserting an index scan would fail on a correct database, and asserting a
  seq scan would fail the day the data grows. Neither is a fact about the query.
- **Finding the index in `pg_indexes` proves only that somebody created an index.** It says
  nothing about whether *this* predicate can use it — wrong column order, a type mismatch, a
  function wrapped round the column, `IS DISTINCT FROM`, a `LIKE` with a leading wildcard: every
  one of those leaves a perfectly real index that this query will never touch.

Turning off sequential scans asks the only question that matters: **can this WHERE clause be
answered from an index at all?** If the answer is still `Seq Scan` with seqscan disabled, the
index does not fit the predicate and the query will scan the table forever, whatever
`pg_indexes` says.

**Two honest limits, to be stated rather than papered over.**

- Do **not** assert a specific index *name*. Where two candidate indexes share a leading column,
  the planner picks either on a small table, and pinning the name is over-fitting the planner.
  Assert that the predicate is index-answerable, and print which one it chose.
- `enable_seqscan = off` does not make the planner *prefer* the index at real volume; it only
  shows the index is applicable. That is the claim, and it is the claim the assertion should
  make.

**Where it is done:** `scripts/verify-daily-closing-tile.js`, and any later suite asked for
plans.

## SR-4 · An N+1 cannot be seen in a query plan

A plan is **per statement**. A loop that issues one correct, well-indexed statement per project
produces N perfect plans and one bad page. So "no N+1" is asserted on the **service's source** —
no `LOOP`, and the set resolved once into an array the aggregates run over — alongside the plan
review, never instead of it. (`verify-daily-closing-tile.js`, check 13.)

---

# P10 — Phase 1 is finishable. Every open item, closed or carried.

The Definition of Done asks that every open item from P1–P9 is either closed or explicitly
carried with a reason. This is that list. Nothing has been quietly dropped.

## Closed in P10

| From | Item | How |
|---|---|---|
| P4 | Two-writer `seq_no` concurrency — deferred, and said so | `verify-daily-closing-concurrency.js`: 12 real connections, 12 commits, sequence 1..13 unbroken, nobody met the UNIQUE index |
| P7 | Attach a real file; prove the key starts with the entry's `project_id`; prove another project cannot fetch the signed URL | `verify-daily-closing-attachment.js`, 17 assertions, a genuine PDF through the real bridge |
| P6 | The screen suite fails by timing out rather than printing a named ❌ | Wrapped waits **and** interactions per page, plus an outer catch — proved by breaking the void action |
| P8 | Prove the cashier is refused server-side, not merely shown no button | The role×action matrix (114 cells) and the E2E's ten refusals |
| P9 | `audit_logs` grant decision | Recorded in `SCHEMA.md` with the reasoning — the grant stays, RLS is the boundary |
| P8 | `admin` losing access — record it | `RULES.md` §0.4a, dated, with who is affected and what to do instead |

## Carried into Phase 2, each with its reason

| # | Item | Why it is not a Phase 1 blocker |
|---|---|---|
| Q2 | Bank accounts: three competing tables | Phase 1 uses `cash_accounts`, seeded per project. Reconciling `banks` and `project_bank_accounts` is Phase 2's, and touching them now would change tables KBH and FMH use. |
| Q3 | Director PDF grain — per project, consolidated, or both | Awami has one project, so Phase 1 is per-project either way. The answer decides Phase 4's Group Position, not anything shipped. |
| Q4 | Voucher books — per project or per company | Phase 1 enforces `UNIQUE(project, type, no)`, the stricter of the two. If the answer is per-company, the constraint tightens; nothing already recorded becomes wrong. |
| Q5 | Client receipt: replace or duplicate the existing one | Phase 1 does not print a client receipt at all. Phase 2 owns `client_receipts`. |
| Q7 | Paisa displayed or not | Phase 1 shows paisa only when non-zero; every RMS formatter rounds to 0 dp. The two differ and nothing has yet depended on it. |
| ~~Q8~~ | ~~Double entry during the parallel run~~ | **✅ ANSWERED by the owner, 2026-09-04 — and the answer is a RULE, not code.** During the parallel run client receipts are entered in **Daily Closing only**; RMS's Record Payment is not used for Awami by anyone, for any reason, until Phase 2 lands and the module posts to the client ledger itself. Nothing enforces it in code and nothing can in Phase 1 — Record Payment belongs to the rest of RMS, and blocking it for one tenant would change a screen Khushal Bagh and FMH use every day. So it is the **first thing in `RUNBOOK.md` §5**, with the consequence spelt out: a double credit does not announce itself and is found by an angry customer, not by a report. It is safe to run on a rule because **Awami has one user today**; the day a second person records money there, they must be told before they are given the login. |
| ~~—~~ | ~~The PDF's 2 s budget~~ | **✅ ANSWERED 2026-09-04: keep Inter, raise the budget to 8 s.** The 2 s figure was written before anyone measured what embedding a font costs; the sheet renders once a day, after Day Close, in the background, and nobody waits at a screen for it. §A15 carries the corrected number and the reason. The fonts are deliberately NOT cached and nothing is optimised — revisit only if a real day ever feels slow. |
| — | The two Awami accounts (`cfo`, `staff` cashier) | The owner creates them in Users & Roles. The permission model is complete and tested without them. |
| — | The `price_revision` branch of the approval dispatcher is dead | Noted at P0. Phase 2's allocation approval should route through that engine, so it needs a look **before** it is trusted — not before Phase 1 ships. |
| — | A handover event does not exist in RMS | Three unreconciled representations and the only page that wrote one is archived. Blocks Phase 3's `RecognizeRevenue`, nothing earlier. |

## What Phase 1 does NOT include, deliberately

No QuickBooks export (P16), no client receipts, no allocation approval, no PDC register of its
own, no Group Position board, no revenue recognition, and no general ledger of any kind. The
cash book stores what happened to the cash. QuickBooks remains the book of account.
