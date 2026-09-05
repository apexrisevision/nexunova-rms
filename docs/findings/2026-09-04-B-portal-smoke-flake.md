# Finding 2026-09-04-B — the portal push gate failed once and passed three times

| | |
|---|---|
| **Found** | 2026-09-04, running the push gate for commit `aa181ec` |
| **Written up** | 2026-09-05 |
| **Status** | **OPEN, not chased.** Logged deliberately rather than explained away. |
| **Scope** | `scripts/smoke-portal.js` — the Sales Portal half of `npm run gate`. |
| **Severity** | Unknown, and that is the problem. It is either a harmless timing flake or a real intermittent defect in bulk assign, and the evidence collected does not separate them. |
| **Updated** | 2026-09-05 — the stale-fixture hypothesis was raised and then REFUTED (§6). Cause still unknown. A separate real defect it surfaced is fixed (§5). |

A gate that fails one run in four and passes the rest is the kind of thing that gets explained
away until the once it was real. It blocks pushes, so the pressure is always to re-run it, and
re-running it is exactly what destroys the evidence.

---

## 1 · What failed

Four runs of `npm run gate` against live production, in sequence:

| Run | Fixture | Result |
|---|---|---|
| 1 | `ZZSMOKE-1788547676825` | **FAIL — 19 passed, 15 failed** |
| 2 | (not captured) | pass through the bulk-assign section; final line not captured |
| 3 | `ZZSMOKE-1788547933767` | PASS — 38 passed, 0 failed |
| 4 (pre-push hook) | `ZZSMOKE-1788548079092` | PASS — 38 passed, 0 failed |

Run 1 to run 3 is about 4 min 17 s apart; run 3 to run 4 about 2 min 25 s. `predeploy-check.js`
passed on every run; only `smoke-portal.js` failed.

**Of the 15 failures, only the last 5 were observed.** The command was piped through `tail -30`,
so the first 10 scrolled past unrecorded:

```
❌ project options listed (0)
❌ step 2 modal opened (members)
❌ step 2 lists members (0)
❌ assign_leads_bulk called
❌ assign_leads_bulk was called
```

Everything after that section — Director board, board card detail, "See their leads", console —
was green in the same failing run.

**Throwing away those 10 lines is the actual mistake in this entry, and it is the same disease as
SR-2: the evidence that would have told me what happened was discarded in favour of a summary.**
`tail` on a gate run is now a thing not to do.

---

## 2 · Why it is not commit `aa181ec`

The commit being pushed changed `js/auth.js`, `js/init.js`, `js/pages/company-branding.js`,
`login.html`, two test scripts and three docs. `sales-portal.html` loads **none** of those three
JS files — a grep for `js/init.js`, `js/auth.js` and `company-branding.js` in `sales-portal.html`
returns zero. The portal is a separate shell with its own script list
(`sales-portal.html:13929-13935`).

So the change under test cannot be the cause. That is established, not assumed.

---

## 3 · Reasoning, and one hypothesis already eliminated

### Eliminated: a render race inside the modal

The obvious first guess is that the harness reads too early. `project options listed` and
`step 2 lists members` are plain `page.evaluate()` reads taken immediately after an `until()`
matched the modal **title**, with no wait of their own
(`scripts/smoke-portal.js`, the "Select all, then bulk assign" step). If the title landed before
the body, both would intermittently read 0.

**They cannot.** `openModal()` (`sales-portal.html:13701`) writes the title, the body and the
footer in a single synchronous `innerHTML` assignment. If the title is in the DOM, the `.lrow`
rows are in the DOM in the same tick. This hypothesis is dead.

### What that leaves

`_assignProjectStep()` (`sales-portal.html:5779`) begins
`if(!projs.length) return _assignMemberStep(null);` — with no projects it never opens a
"which project" modal at all. So a state where the title matched *and* the row count was 0 is
self-contradictory. The likelier reading is that the two assertions above the captured window
(`step 1 modal opened`, `step 1 asks which project`) **also failed**, and that the failure began
further upstream and cascaded — the modal never opened, and every read after it returned 0.

That is consistent with 15 failures rather than 5: most of the run's assertions are upstream of
this section (app boot, first-run prompts, leads screen, long-press selection, the selection bar).
If the session or the four `ZZSMOKE` lead fixtures were not visible to the app yet, the whole run
degrades exactly this way while the later read-only sections — board, detail, their-leads — still
pass off separately loaded data.

### The circumstantial part

Run 1 started immediately after seventeen Daily Closing suites had finished against the same live
project, including the load suite (500 entries), the two-writer concurrency suite, and the PDF and
attachment suites that commit real rows and render a real document. A cold or contended first run
right after that workload is a plausible cause. `until()` has a 20-second timeout
(`scripts/smoke-portal.js:83`), so 15 failures could account for several minutes of that run
sitting in timeouts.

It is circumstantial. It would also predict that runs 2-4 should fail *more*, not less, if the
cause were rate limiting — which they did not. So contention is a candidate, not a conclusion.

---

## 4 · What would confirm or refute it

In rough order of value:

1. **Capture the full output.** Run the gate with output redirected to a file, never piped through
   `tail`. The 10 unseen failures decide almost everything: if they sit in "App boots as the
   director" or "Leads screen", the session or the fixtures were not visible and this is a data
   timing problem. If those sections were green and every failure is inside bulk assign, it is
   that flow specifically and the upstream-cascade reading is wrong.
2. **Record how long each failed `until()` waited.** A full 20 s is a timeout — something never
   arrived. A fast failure is a wrong assertion. `until()` currently swallows that distinction by
   returning a bare boolean; having it return the elapsed time would settle it in one run.
3. **Dump `window.__rpc` on failure.** The harness already records RPC calls. If the step-1 project
   list RPC was called and came back empty, it is data. If it was never called, it is UI or an
   earlier failure. Print the call log whenever any assertion in the section fails.
4. **Run it 10 times back to back with full logs, then once after 10 minutes idle.** If failures
   only appear on a run started within a minute or two of a heavy database workload, contention is
   confirmed. If they scatter randomly, it is not.
5. **Check for leftover fixtures.** Cleanup ran in a `finally` scoped to the run's **own** prefix,
   so a run never removed anything an earlier run had left. That is now fixed — see §5 — but the
   fix is hygiene, not the answer to this finding. See §6 for why.

---

## 5 · Resolved separately: fixtures could survive an abort (2026-09-05)

`smoke-portal.js` seeds four `is_test` leads into the **live Awami tenant** and deleted them only
in its exit path, matching `like '<its own prefix>%'`. Any abort that took the process out — a
crash, a kill, Ctrl-C, a harness that stopped capturing — left those rows in the tenant's leads
list permanently, and no later run would ever remove them. On 2026-09-05 four such rows
(`ZZSMOKE-1788596148952 1…4`) were observed surviving a run whose cleanup never printed.

A transaction is not an option: the rows have to be visible to a real browser talking to PostgREST
over HTTP, so they must be committed, and nothing this process holds open can be rolled back.

So the lifecycle is self-healing instead. Before seeding, the suite now sweeps **every** `ZZSMOKE-`
lead older than thirty minutes (with its child rows) plus expired `smoke_` sessions, says loudly
that it found them, and then **asserts a clean slate and refuses to seed if any remain** — exiting
2 (could not run) rather than 1 (the app failed). Thirty minutes cannot overlap a run in flight:
the suite takes about a minute and its session expires in fifteen.

Proved by seeding two deliberately backdated orphans and running it: the warning fired, both were
removed, the run passed 38/38, and the table was left empty. An aborted run is now cleaned up by
the next one.

**This does not close the finding.** It closes a real defect that this finding's investigation
surfaced.

---

## 6 · The stale-fixture hypothesis, tested and REFUTED

On 2026-09-05 this entry was updated to call stale fixtures from an aborted run "the leading
hypothesis, ahead of contention". **That was wrong, and it is retracted here.** It was written
from the fact that orphans existed, without checking whether they could reach the assertions that
failed. They cannot.

`smoke-portal.js` narrows the leads list by typing its **full unique fixture string** into the
search box — `ZZSMOKE-<this run's epoch ms>`, not the `ZZSMOKE-` prefix — and then asserts the
list shows exactly four rows. An orphan from any other run carries a different timestamp, does not
match that search, and is never counted. The same string scopes `Select all picked all 4` and the
bulk-assign counts downstream of it.

So orphan rows are invisible to every assertion that failed. They are a hygiene problem in a live
tenant — a real one, fixed in §5 — and **not the cause of this finding**.

Two things are worth keeping from the mistake. The refutation came from reading the suite for
thirty seconds, which should have happened before the claim was made rather than after. And a
hypothesis that explains the *symptom* ("counts were wrong") is not the same as one that survives
contact with the *mechanism* ("could those rows have been counted?").

**Status: still open. Cause still unknown.** The evidence that would settle it is unchanged and is
listed in §4 — full output on the next red run, above all. That is now standing rule SR-8, so the
next occurrence should arrive with enough to diagnose it.

---

## 7 · Why it is being left alone for now

The parallel run for Awami starts now, and this is in the Sales Portal, which the parallel run
does not touch. The gate passes, so it is not blocking. Chasing an intermittent failure with the
wrong evidence collected is how a real defect gets talked into being a flake, so the honest move
is to fix the evidence collection first (items 1-3 above are small and permanent) and look again
the next time the gate goes red.

**It should not be closed as "flaky" without doing item 1.**

---

## 8 · Related

- `docs/daily-closing/PHASES.md` — **SR-2**: an assertion is suspect until it has been seen to
  fire. The mirror of that rule applies here: a failure is suspect until it has been seen in full.
- `scripts/smoke-portal.js:83` — `until()`, the 20-second bounded wait behind most of these
  assertions.
