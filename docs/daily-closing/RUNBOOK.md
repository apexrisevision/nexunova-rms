# Daily Closing — RUNBOOK

Everything needed to put Phase 1 into production on Awami Market and run it beside Excel for
fourteen days. Written for the person doing it, not for the person who built it.

**Scope.** RMS stores the cash book. It is **not** an accounting system: no general ledger, no
P&L, no balance sheet. QuickBooks stays the book of account (RULES §0.1).

---

## 1 · First day — walk the whole loop once, before any volume

Seven steps, in the order you will actually do them. Do this on a quiet day with **one real
entry**, not a made-up one — the point is to see the whole loop close, not to test.

Everywhere below, **`<rms>`** is the address you normally open RMS at.

---

**1 · Sign in.**  →  `<rms>/login.html`

Sign in to **Awami Market** as yourself. You hold `owner`, which the module reads as **CFO**, so
you can do every step below without any further setup.

---

**2 · Check the module is there.**

After signing in you land on the Dashboard. You should see:

- a **Daily Closing** tile directly under the page header, and
- **Daily Closing** in the left sidebar, under **Sales & Money**, just after Record Payment.

If neither is there, the feature flag is off for the tenant — see §2, "Switching it on". Nothing
else in this list will work until it is on.

---

**3 · Set the opening balance — once, ever.**  →  click **Daily Closing** in the sidebar

The screen will say there is no day open. Press **Open day**; because this project has no
opening balance yet, it will offer the *Opening balance* dialog instead.

- **Cash in hand: `0`**
- **Bank balance: `0`**

**Start at zero deliberately.** Every day afterwards carries forward from this figure and you
cannot set it twice — a second attempt answers `ALREADY_SET`. Starting at zero means the cash
book measures *movement from today*, and the real drawer balance is whatever Excel says until
the parallel run agrees. If you would rather start at the true drawer figure, use it — but be
certain of it, because it cannot be corrected without an adjustment.

Press **Set opening balance**.

---

**4 · Open the day.**

The screen returns and offers **Open day** again. Press it. You now have today's cash book, with
the composer on the left and an empty ledger on the right.

---

**5 · Record one real entry.**

Take one voucher out of the physical book — an expense is easiest for a first run — and enter it:

| Field | What to put |
|---|---|
| Type | **Expense** |
| Mode / Direction | **Cash** / **Out** |
| Voucher # | the number printed in the book — it is **not** generated |
| Amount | the amount |
| Payee | start typing; if the vendor is not in the list, **+ Add** creates them |
| QB Head | leave the suggested one unless it is genuinely wrong |
| Narration | what it was for |

Watch the chip beside Mode/Direction: it should read **CPV**. That is derived — if it disagrees
with the book, the Mode or the Direction is wrong, not the chip.

Press **Save** (or Enter in Narration). The entry appears in the ledger with sequence number 1.

---

**6 · Close the day.**  →  **Close Day**, top right

A panel opens on the right, 480 px, with the ledger still visible beside it.

- **Book says** shows what the cash book expects the drawer to hold.
- Count the drawer and enter the notes — 5,000 × how many, 1,000 × how many, and so on. The
  **Recorded as** figure fills in as you go.
- If the drawer holds coins, type the true figure over it.
- If your count differs from the book, a variance banner appears and **Close will not enable
  until you write why**. Write what actually happened.
- Press **Close the day**, confirm, and wait a few seconds.

---

**7 · Open the sheet.**

The panel finishes on **Closed · PDF ready**, with **Download** and **Share**. Press **Download**
and open it.

Check the top line reads **FOURTEEN GROUP · AWAMI MARKET**, the date is right, and the closing
cash matches what you counted. That PDF is what the Directors get. The link works for ten
minutes; the sheet itself is kept for ever and can be reopened any time from **Days**.

---

### If you get stuck

| What you see | What it means |
|---|---|
| No sidebar item and no tile | The feature flag is off — §2 |
| "You do not have access to the cash book" | Your account has no Daily Closing role — §2, "The accounts" |
| **Close Day** is not there | You are not being read as CFO; check your role |
| Close stays greyed out | The count differs from the book and the reason is empty |
| The sheet is in a plain typeface | Inter is not in the bucket — `node scripts/upload-inter-fonts.js` |

Everything else, by error code, is in §8.

> **Before you start recording client money**, read the rule at the top of §5. It is the one
> thing in this runbook that cannot be undone easily if it is got wrong.

---

## 2 · What is deployed, and where

| Piece | Where it lives |
|---|---|
| 13 tables + the audit wiring | `supabase/migrations/20260903e … 20260904q` |
| The services | Postgres `SECURITY DEFINER` functions — there is no application server |
| The Director PDF | edge function `daily-closing-pdf` (Deno + pdf-lib) |
| The attachment bridge | edge function `daily-closing-file` |
| The screen | `js/pages/daily-closing.js`, lazy-loaded, page key `dailyclosing` |
| The dashboard tile | `js/pages/daily-closing-tile.js`, injected by `_dcTile()` in `dashboard.js` |
| Fonts | `daily-closing/_assets/Inter-{Regular,SemiBold}.ttf` in the private bucket |

### Deploying

```bash
# 1 · migrations — applied in filename order, and NEVER out of order
#     (an older file re-applied later would restore that file's older function bodies)
node scripts/_runsql.js supabase/migrations/<file>.sql       # or the Management API

# 2 · the two edge functions — ALWAYS with the CLI and --no-verify-jwt.
#     Deploying through MCP silently resets verify_jwt to true and both functions
#     stop working, because each reads the Authorization header itself.
export SUPABASE_ACCESS_TOKEN=…            # from .mcp.json
supabase functions deploy daily-closing-pdf  --project-ref <ref> --no-verify-jwt
supabase functions deploy daily-closing-file --project-ref <ref> --no-verify-jwt

# 3 · the front end is served from the repo — push to main and Vercel takes it
git push origin main                       # the pre-push gate must pass first
```

### Seeding a tenant

```bash
# the QuickBooks chart and the cash/bank accounts for one project
select public.seed_daily_closing_chart('<company_id>','<project_id>');

# Inter, so the sheet is not rendered in Helvetica
node scripts/upload-inter-fonts.js         # --check just reports what is there
```

### Switching it on

The module is **default-closed everywhere**. Nothing appears for a tenant until this row exists:

```sql
insert into public.company_feature_flags (company_id, feature_key, is_enabled, override_note, set_by)
values ('<company_id>', 'daily_closing', true, 'Daily Closing pilot', '<who>');
```

Today that row exists for **Awami Market only**. Khushal Bagh and FMH see nothing: not the
sidebar item, not the dashboard tile, not the page — and `nav('dailyclosing')` sends them to the
dashboard. `scripts/verify-daily-closing-shell.js` asserts their sidebar and dashboard HTML are
byte-identical with the flag absent.

### The accounts

| Person | RMS role | Also needs |
|---|---|---|
| CFO | `cfo` | — |
| Accountant | `accounts` | — |
| Cashier | `staff` | the **`dailyclosing` module tick** in Users & Roles — without it they have no access at all |
| Director | `manager` | a project assignment (read-only) |

`admin` has **no** Daily Closing access, deliberately (RULES §0.4a). If somebody needs access,
give them one of the four roles above; do not widen the gate.

---

## 3 · The setup opening — once per project, ever

Before the first day can be opened, the CFO sets the opening cash and bank balance. This is
recorded as a **closed day** with `is_setup_opening = true`, so carry-forward has exactly one
code path: "the latest closed day".

- It can be done from the screen: open Daily Closing on a day with no opening and it offers the
  dialog.
- The date must **not** be in the future.
- It cannot be done twice. A second attempt answers `ALREADY_SET`.

**Get the figure right the first time.** Every day afterwards carries forward from it, and
invariant 2 means the opening of a day is derived, never typed.

---

## 4 · The daily procedure

### The cashier, during the day

1. Open Daily Closing. If today has no day yet, press **Open day**.
2. For each voucher in the physical book, record it: Type → Mode → Direction → Voucher # →
   Amount → Payee → Unit (receipts only) → QB Head → Narration → **Save**.
   Enter in the Narration field saves.
3. The **voucher type is derived** — CRV / CPV / BRV / BPV come from Mode + Direction. If the
   chip disagrees with the book, the Mode or the Direction is wrong, not the chip.
4. The **voucher number is the one printed in the book.** It is not generated.
5. Attach the bill where there is one (JPG, PNG or PDF, up to 10 MB).
6. A mistake is **voided**, never edited or deleted: the row action on the entry, with a reason.
   The original stays and a reversing entry is written beside it.

### The CFO, at the end of the day

1. Press **Close Day**. Count the drawer in the panel: notes on the left, the figure fills in.
2. If the drawer holds coins, type the counted figure over the note total.
3. If the count differs from the book, the panel will not let the day close until the difference
   has a reason. **Write what actually happened**, not "difference".
4. Confirm. The Director sheet is rendered immediately; **Download** or **Share** it.
5. A correction found afterwards is an **adjustment**, not an edit: the day stays closed, the
   adjustment appears in its own block on the sheet, and the sheet is re-issued at the next
   version with the old one kept.

### The Director

Reads. The day, the last sixty days, every sheet, and the audit trail. Cannot record, void,
close or adjust — and the server refuses, not just the screen.

---

## 5 · The Excel parallel run — the 14-day gate

> # ⛔ THE ONE RULE THAT MATTERS MOST
>
> ## During the parallel run, client receipts are entered in ONE place: Daily Closing.
>
> **RMS's own Record Payment is not used for Awami. By anyone. For any reason.**
> Not "usually not". Not "unless it is easier". Not once.
>
> ### Why, in plain language
>
> Both screens take a client's money and credit the client. Right now they do **not** know about
> each other: the cash book records the receipt in the day, and Record Payment records it against
> the installment. Enter the same money in both and **the client is credited twice.**
>
> ### Why that is worse than it sounds
>
> A double credit does not announce itself. Nothing turns red, no report flags it, and the day
> still closes and balances — because each screen is individually correct about what it was told.
> The error surfaces weeks later, when a customer who has paid four installments is shown as
> having paid five, and asks why he is being told he owes less than he does. **It is found by an
> angry customer, not by a report.** Unwinding it means voiding entries, reversing a payment, and
> explaining to that customer why his statement was wrong.
>
> ### What to do instead
>
> | The money | Where it goes |
> |---|---|
> | A client's installment, in cash or by cheque | **Daily Closing only.** Record it as a CLIENT_RECEIPT with the unit. It sits `PENDING` until Phase 2 applies it. |
> | An expense, a transfer, a loan | Daily Closing only. It was never Record Payment's job. |
> | A payment on **Khushal Bagh or FMH** | Record Payment, exactly as today. Those tenants do not have the cash book and are unaffected. |
>
> ### When this rule ends
>
> **When Phase 2 lands** and the module posts to the client ledger itself. Until then the two
> routes are separate books that both think they are right, and only a rule keeps them apart.
>
> ### Why a rule is enough, for now
>
> **Nothing in the code enforces this.** It cannot be, in Phase 1: Record Payment belongs to the
> rest of RMS and blocking it for one tenant would change a screen Khushal Bagh and FMH use every
> day. What makes a rule sufficient is that **Awami has one user today** — the CFO. One person,
> one habit. The day a second person records money on Awami, this rule has to be told to them
> before they are given the login, and it is the first thing to revisit if the pilot widens.
>
> *(This is RULES.md (b) Q8, answered by the owner on 2026-09-04.)*

---

Phase 1 is **not finished when the code ships**. It is finished when the module and the existing
Excel sheet agree for fourteen consecutive business days.

### What to compare, every day

Compare the **Director PDF** against the Excel sheet for the same date:

| # | Figure | Where it is on the PDF |
|---|---|---|
| 1 | Opening cash | summary table, `Opening (B/F)`, CASH column |
| 2 | Opening bank | summary table, `Opening (B/F)`, BANK column |
| 3 | Total received, cash | `Received (In)`, CASH |
| 4 | Total received, bank | `Received (In)`, BANK |
| 5 | Total paid, cash | `Paid (Out)`, CASH |
| 6 | Total paid, bank | `Paid (Out)`, BANK |
| 7 | **Closing cash** | `Closing (C/F)`, CASH — and the hero figure |
| 8 | **Closing bank** | `Closing (C/F)`, BANK |
| 9 | Physical count | the line under the ledger: `Cash counted …` |
| 10 | Entry count | the number of ledger lines |

### What "match" means

- **Figures 1–8 must be exact to the rupee.** Not "close". A difference of any size is a
  mismatch and must be explained before the day is signed off.
- **Figure 9** must equal the physical count written in the book. Any variance must be the one
  the day carries, with the reason the CFO typed.
- **Figure 10** may differ only when the Excel sheet groups vouchers that the cash book lists
  separately (a transfer is one act and two rows). Record the reason.

### The gate

- **Fourteen consecutive business days** where all ten agree.
- A mismatch **resets the count to zero**. It does not "carry over with a note".
- Keep a log: date, the ten figures from each side, and either "match" or what differed and why.
- Only after fourteen clean days does Excel stop.

### During the run, the double-entry risk

RMS's own **Record Payment** stays live while the cash book runs. If the same client money is
entered in both, the client is credited twice. **Decide before day one who enters client
receipts and where**, and do not let both routes be used for the same money. (RULES (b) Q8 —
still open, and it is the one open question that touches the parallel run directly.)

---

## 6 · Performance, measured

Measured on **500 entries in one day**, ZZTEST, 2026-09-04. Rerun with
`node scripts/verify-daily-closing-load.js`; the numbers are written to
`migration_work/_dc_p10_numbers.json`.

| What | Measured | Budget | |
|---|--:|--:|---|
| S1 first paint, 500 rows | **717 ms** | 1500 ms | ✅ |
| `get_cash_day_summary` | **10.3 ms** | 200 ms | ✅ |
| `get_daily_closing_tile` | **18 ms** | — | reported |
| `list_cash_entries` (500) | **137 ms** | — | reported |
| `list_cash_day_audit` (200) | **215 ms** | — | reported |
| Director PDF, 500 entries | **5446–6714 ms** | 8000 ms | ✅ |

**How these were measured.** The server figures come from `EXPLAIN ANALYZE`'s own Execution
Time, so they are the query's cost and not the round trip — from a laptop in Peshawar one round
trip to the Supabase region is ~2.5 s, which would swamp every budget and measure the network.
The paint figure is Chrome, from mount to the last ledger row on screen. The PDF figure is the
edge function's own clock, not the wall clock from here.

### Where the PDF time goes, and why the budget is 8 s

The renderer reports its own phases:

```
payload 654 ms · fonts 2743 ms · draw 3850 ms · save 3961 ms · total 5446 ms
```

- **Embedding Inter costs ~2.1 s of every render**, whatever the day holds. pdf-lib parses and
  subsets both weights per document; there is nothing to cache between renders.
- **Drawing 500 rows costs ~1.1 s.** A normal day of 20–40 entries costs a tenth of that.
- The remainder is four HTTP hops the function makes for itself. The version row and the signed
  link are already fetched in parallel; the payload read and the upload cannot be.

**A normal day renders in about 3.5 s**, of which 2.1 s is the typeface.

**The budget was 2 s, and 2 s was a guess.** It was written before anyone had measured what
embedding a font costs. The owner corrected it to **8 s** on 2026-09-04, with the reasoning
recorded in `BLUEPRINT.md` §A15: the sheet renders **once a day, after Day Close, in the
background** — nobody sits at a screen waiting for it — so forcing Helvetica and losing the
typeface §A13 asks for, to save four seconds nobody experiences, would have been the wrong trade.
It was the budget that was wrong, not the renderer.

**Deliberately not optimised.** The fonts are not cached and nothing here has been tuned. If a
real day ever takes uncomfortably long, revisit it then — with a measurement, as this was.

**Expect the figure to move.** Two runs an hour apart gave 5446 ms and 6714 ms for the same
500-entry day: the edge region's load and whether the isolate is warm both matter. 8 s is a
ceiling with room in it, not a typical value — if a render ever exceeds it, that is a signal
worth following rather than noise.
Pre-subsetting Inter to the ~120 glyphs the sheet
actually uses would fix it properly and needs a font tool this repo does not have.

---

## 7 · Rollback

**Nothing in this module touches an existing RMS table's data.** Rolling it back is switching it
off, not undoing writes.

| Level | Do this | Effect |
|---|---|---|
| **Stop it being used** | `update public.company_feature_flags set is_enabled = false where feature_key='daily_closing'` | The sidebar item, the tile and the page vanish. Data is untouched. Reversible in one statement. |
| **Stop the sheets** | redeploy nothing; the flag above covers it | — |
| **Remove the schema** | `supabase/migrations/20260903r_rollback_the_cash_book.sql` | Drops the module's tables and functions. **Never applied.** |

⚠️ **`cash_entries` cannot be deleted — invariant 1 — and that is deliberate.** The immutability
trigger refuses `DELETE` on every row. Removing the schema means dropping the table, which is
the down migration's job and an owner decision, not a maintenance task. Do not disable the
trigger to "tidy up": it is table-wide and off for every tenant while it is off.

The audit trail (`audit_logs`) is shared with the rest of RMS and is **not** touched by any
rollback.

---

## 8 · Troubleshooting, by error code

Every service answers `{ success: false, error: '<CODE>', message: '<sentence>' }`. The codes
are §A9's.

| Code | What actually happened | What to do |
|---|---|---|
| `NOT_AUTHORIZED` | The caller has no Daily Closing role, or no access to that project, or is trying an action above their role. | Check Users & Roles: the role, the project assignment, and — for a cashier — the `dailyclosing` tick. |
| `DAY_LOCKED` | An ordinary entry on a day that is already closed. | The CFO posts it as an **adjustment**. It is not an edit. |
| `DAY_NOT_OPEN` | No day exists for that date, or the id does not belong to that company. | Open the day. If it is a past date, check whether it was ever opened. |
| `SETUP_OPENING_REQUIRED` | The project has no opening balance yet. | The CFO sets it once, from the dialog the screen offers. |
| `ALREADY_SET` | A second attempt at the setup opening. | There is nothing to do — it can only be done once. |
| `DUPLICATE_VOUCHER` | That voucher number is already used on this project. | Check the book. The message names the date it was used on. |
| `OVERRIDE_REASON_REQUIRED` | A QuickBooks head other than the default, with no reason. | Type why, or put it back on the default head. |
| `VARIANCE_UNEXPLAINED` | Closing with a count that differs from the book and no reason. | Write what happened. "Difference" is not a reason. |
| `VARIANCE_TAG_REQUIRED` | The amount differs from what was expected. | Say which kind of difference it is. |
| `VERSION_CONFLICT` | An entry landed while the drawer was being counted, or two sheets were rendered at once. | The panel reloads by itself; check the new figure and close again. Nothing was lost. |
| `PAYEE_INACTIVE` / `ACCOUNT_INACTIVE` | The payee or account chosen has been deactivated. | Pick an active one, or reactivate it. |
| `UNIT_REQUIRED` | A client receipt with no unit. | Every client receipt names a unit. |
| `INVALID_TRANSITION` | The request itself is wrong — a negative amount, a missing voucher number, a future date, a 10 MB+ attachment, a supplied `voucher_type`. | The message says which. |
| `STORAGE_FAILED` | The sheet rendered but could not be filed. | The day is still closed. Render again from the Director PDF button. |
| `RECORD_FAILED` | The sheet was filed but its version row was not written. | Render again — it will take the next version. |

### Symptoms that are not error codes

| Symptom | Cause | Fix |
|---|---|---|
| Both edge functions answer 401 to everything | `verify_jwt` was reset to `true` by an MCP deploy | Redeploy with the CLI and `--no-verify-jwt` |
| The sheet renders in Helvetica | The Inter files are not in the bucket | `node scripts/upload-inter-fonts.js` |
| The tile or the sidebar item is missing for Awami | The `daily_closing` flag row is missing or `is_enabled = false` | See §1, "Switching it on" |
| "Failed to fetch" everywhere in RMS | Supabase is **paused**, not a code problem | Check the project status before debugging anything |
| A cashier sees nothing at all | `staff` without the `dailyclosing` module tick | Tick it in Users & Roles |

---

## 9 · The tests, and what each one is for

```bash
node scripts/verify-daily-closing-schema.js        # 22  the tables and the invariant mechanisms
node scripts/verify-daily-closing-seed.js          # 37  the chart, the payee master, the roles
node scripts/verify-daily-closing-day.js           # 28  open / close / carry-forward
node scripts/verify-daily-closing-entry.js         # 24  record / void / attach
node scripts/verify-daily-closing-format.js        # 74  money, dates, WCAG contrast
node scripts/verify-daily-closing-screen.js        # 158 the screens, in a real browser
node scripts/verify-daily-closing-pdf.js           # 38  a REAL rendered PDF, text read back
node scripts/verify-daily-closing-access.js        # 18  the §A10 role × action matrix
node scripts/verify-daily-closing-shell.js         # 23  KBH and FMH see nothing
node scripts/verify-daily-closing-tile.js          # 13  the S8 counters and their query plans
node scripts/verify-daily-closing-e2e.js           # 16  a whole day, and ten ways to do it wrong
node scripts/verify-daily-closing-attachment.js    # 17  a real file through the real bridge
node scripts/verify-daily-closing-concurrency.js   #  8  two writers, one sequence
node scripts/verify-daily-closing-security.js      # 26  auth, RLS, grants, signed URLs
node scripts/verify-daily-closing-load.js          #     500 entries and the numbers above
```

Most run inside `BEGIN … ROLLBACK` and commit nothing. Four commit by necessity and say so in
their headers: the PDF, the attachment, the concurrency and the load suites.

⚠️ **Standing rule SR-1.** `cash_entries` can never be deleted, so those four leave permanent
rows on ZZTEST. They live on **ZZ Map Tower** and **ZZTEST Tower**; the suites that *wipe* a
project's entries run on **ZZTEST Garden**. A project that holds permanent fixtures must never
also host a wiping suite — the collision is unrecoverable without disabling invariant 1
table-wide.

---

## 10 · What is carried into Phase 2

Listed so the parallel run starts with its eyes open. Full text in `RULES.md` (b).

| # | Open item | Why it is not a Phase 1 blocker |
|---|---|---|
| Q2 | Bank accounts: `banks` vs `project_bank_accounts` vs `cash_accounts` | Phase 1 uses `cash_accounts`, seeded per project. The reconciliation is Phase 2's. |
| Q3 | Director PDF grain — per project, consolidated, or both | Awami has one project, so Phase 1 is per-project either way. Decides Phase 4's Group Position. |
| Q4 | Voucher books — one series per project or per company | Phase 1 enforces `UNIQUE(project, type, no)`, which is the stricter of the two. |
| Q5 | Does the client receipt replace or duplicate the existing one | Phase 2 owns `client_receipts`. Phase 1 does not print a client receipt. |
| Q7 | Paisa: displayed or not | Phase 1 shows paisa only when non-zero. Every RMS formatter rounds to 0 dp; the two differ and nobody has been bitten yet. |
| ~~Q8~~ | ~~Double entry during the parallel run~~ | **✅ ANSWERED 2026-09-04.** Client receipts go in Daily Closing **only**; Record Payment is not used for Awami until Phase 2. The rule, and why it matters, is at the top of §5. |
| ~~—~~ | ~~The PDF's 2 s budget~~ | **✅ ANSWERED 2026-09-04.** The budget was a guess made before the measurement; it is **8 s** now, Inter stays, and nothing is optimised until a real day feels slow. §A15. |
| — | `audit_logs` grants a bare `SELECT` to `anon` | Inert behind RLS deny-all; revoking touches a table KBH and FMH use. Decision recorded in `SCHEMA.md`. |
