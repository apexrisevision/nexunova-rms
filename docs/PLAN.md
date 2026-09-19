# NexuFinance v1 — Awami Market Daily Cash & Bank Closing

**Status: plan APPROVED 2026-09-16. Phase 1 build in progress. Nothing applied, deployed or pushed.**
Revision 3, 2026-09-16: both references read in full; all owner answers folded in (§8). **Phase 1 in progress.**

**Approval rule for this rebuild (owner, 2026-09-16):** there is **no standing approval**.
- Local commits are fine.
- **Every migration apply, deploy and push waits for an explicit OK.**
- The Daily Closing standing approval of 2026-09-04 does **not** carry over.

---

## 0 · References

| File | Status |
|---|---|
| `docs/reference/awami-daily-closing.html` (749 lines) | Read in full. Its JS is the functional spec. §3 turns it into rules. |
| `docs/reference/Awami_Market_COA.xlsx` | Read in full. Same contents as `Downloads\files (47)`, confirmed correct by the owner. 110 accounts, 9 classes, QB setup notes. |
| `docs/reference/Awami_COA_import.iif`, `Awami_Entries_import.iif`, `Awami_Lists_import.iif` | Present but not named in the brief. They're a format reference for **Phase 5 only**. Nothing in Phases 1–3 reads them. |

⚠️ **Git records the folder as `docs/Reference/`, with a capital R.** Windows doesn't care;
Vercel (Linux) and every path in this plan do. I'll rename it to `docs/reference/` with
`git mv` in the first local commit.

### Golden day: owner figures vs the reference sample

The owner's golden day is **identical** to `sample` in the reference (lines 410–432). Checked
by hand:

| Account | Opening | Received | Paid | Transfers | Closing |
|---|---|---|---|---|---|
| 10100 Cash in hand | 250,000 | 515,000 | 152,000 | −300,000 | **313,000** |
| 10200 Petty cash | 20,000 | — | 6,500 | — | **13,500** |
| 10300 Bank Al-Habib | 1,500,000 | 350,000 | 41,040 | +300,000 | **2,108,960** |
| **Total** | 1,770,000 | 865,000 | 199,540 | 0 | **2,435,460** |

- Net movement = received − paid = **+665,460**
- Count 50×5000 + 60×1000 + 5×500 + 5×100 = **313,000** = book, so the status is **Balanced**

**The reference sample holds three things the owner's list didn't mention.** The golden test
will carry them too, unless the owner says otherwise:
- **Closing no.** `DC-001`
- **Date** `2026-09-16`
- **One pending PDC received:** `004512`, Shahid Iqbal, MCB, due 2026-09-30, **250,000**

**Director report the reference JS produces for this day** (derived line by line from
`renderDir`; the golden test asserts all of it):
- **Status:** "Books balanced"
- **Summary:** "Today we received Rs 865,000 and paid out Rs 199,540, a net inflow of Rs 665,460.
  Sales side: 1 new token worth Rs 500,000 and 1 sale instalment worth Rs 350,000. The biggest
  spend was approvals, design and consultants at Rs 100,000. Cash and bank together close at
  Rs 2,435,460."
- **Cards:**
  - Cash in hand Rs 313,000, ▲ up Rs 63,000 from opening
  - Petty cash Rs 13,500, ▼ down Rs 6,500
  - Bank Al-Habib Rs 2,108,960, ▲ up Rs 608,960
  - Total Rs 2,435,460
- **Money in:**
  - New tokens 500,000
  - Sales instalments 350,000
  - Transfer and processing fees 15,000
- **Money out:**
  - Approvals, design and consultants 100,000
  - Construction 52,000
  - Marketing 40,000
  - Salaries and security 6,500
  - Bank charges 1,040
- **Large payments (Rs 50,000 and above):**
  - "Jamal, architecture drawings · Approvals, design and consultants, in cash" 100,000
  - "Cement, 400 bags · Construction, in cash" 52,000
- **For your attention:**
  - (good) "Cash in hand was counted and matches the books."
  - "Rs 300,000 of cash was deposited in Bank Al-Habib."
  - "Post-dated cheques pending: Rs 250,000 to receive, Rs 0 to pay. None due this week."

**The reference file itself is an oracle.** The golden suite also loads
`docs/reference/awami-daily-closing.html` headless with empty storage (so it loads its own
sample), scrapes every figure and report sentence, and compares them with the new app's output.
If the two drift apart, the suite goes red. No hand-typed expected values could do that.

---

## 1 · Inventory of the current build, and the archive plan

*(Unchanged from revision 1 apart from the approval rule.)*

### 1.1 Code

| Area | Files |
|---|---|
| Standalone page | `nexufinance.html` |
| Inside the RMS shell | `js/ui.js:561, 978, 1001, 1014`, `js/lazy-pages.js:113-115`, `login.html:1549` |
| Component and kit | `js/pages/daily-closing.js`, `js/pages/daily-closing-stub.js`, `js/foundation/dc-kit.js`, `js/foundation/dc-format.js`, `css/daily-closing.css` |
| Harness pages | `daily-closing.html`, `daily-closing-kit.html` |
| Edge functions | `supabase/functions/daily-closing-pdf`, `supabase/functions/daily-closing-file` |
| Migrations (24) | `20260903e…20260907e` (cash book files) |
| Suites | 21 × `scripts/verify-daily-closing-*.js`, `mutate-daily-closing.js`, 2 × `shot-daily-closing-*.js` |
| Docs | `docs/daily-closing/*`, `docs/nexufinance/README.md` |

### 1.2 Database (live, read-only, 2026-09-16)

- **12 tables:** `cash_accounts`, `cash_days`, `cash_entries`, `cash_entry_attachments`,
  `client_receipts`, `day_documents`, `entry_type_defaults`, `payees`, `qb_accounts`,
  `qb_exports`, `receipt_counters`, `reconciliations`
- **49 functions**, **12 triggers**
- **Changes outside its own tables:** `app_users_role_check` allows `cfo`; `audit_logs.project_id`;
  the `daily_closing` flag is on for Awami only; the `daily-closing` storage bucket
- **Rows:**
  - Awami: 2 days, **1 entry (CPV 1222, 100,000, closing cash −100,000)**, 5 PDFs, 53 old
    4-digit accounts
  - ZZTEST: 647 entries, 83 PDFs
  - KBH and FMH: none
- **Owner decision:** CPV-1222 and all old `cash_*` data are **archived only, not migrated**.

### 1.3 Archive (proposed — each step needs an OK)

- **A. Git.** Annotated tag `nexufinance-v0-final` at `HEAD` (local; pushed only on OK).
- **B. Database export** to `backups/NEXUFINANCE_V0_ARCHIVE_<YYYYMMDD>/`:
  1. Run `scripts/backup-full.js` first.
  2. Then, all tenants:
     - JSON + CSV of the 12 tables
     - their `audit_logs` rows
     - DDL for tables, constraints, indexes, policies and grants
     - `pg_get_functiondef` × 49 and `pg_get_triggerdef` × 12
     - the flag row and the `cfo` users
     - every object in the `daily-closing` bucket
     - the deployed edge-function versions
  3. `MANIFEST.json` with rows + sha256 per file, **re-counted against live; any mismatch fails
     the archive.**
- **C. Retire without deleting** (at cutover, on OK):
  - Revoke `EXECUTE` on the old write RPCs.
  - Set the `daily_closing` flag false for Awami.
  - Point `nexufinance.html` at v1.
  - Nothing is dropped.

---

## 2 · Rules

### 2.1 R1–R8 as written by the owner, plus the three confirmations

| Rule | Final wording |
|---|---|
| R1 | No cash/bank account (Cash, Petty, Bank) may close negative. Reject the change that would cause it. |
| R2 | Voucher numbers are unique per tenant across all days. |
| R3 | Amount > 0. Head is a postable leaf from the COA. Floor required. Via required. |
| R4 | Receivables from directors (**12610, 12620**, see 2.2) are never a Via and never part of cash. |
| R5 | Opening = previous day's closing, computed. Only the very first day takes a typed opening. **Awami's first-day opening is 0 / 0 / 0.** |
| R6 | A day closes only when every check passes (cash count exact). **An accountant or a director** may close such a day. **Only a director** may close with a cash-count variance, and only with a written reason; the variance is stored, logged, and shown on the director report as a warning. "Not counted" can never be closed. |
| R7 | Closed days are locked. Only a director can reopen, **only the latest closed day**, and every reopen is logged. |
| R8 | Money does not leave through a line with no head. No silent defaults. |
| Editing | Lines are **editable while the day is OPEN**. Every change is logged: who, when, old value, new value. |

### 2.2 COA change (owner, Q9)

10400 / 10410 / 10420 are **not** cash. The v1 seed replaces them with:

| Code | Name | Type | Parent |
|---|---|---|---|
| 12600 | Receivable from Directors | Other Current Asset | 12000 Current Assets |
| 12610 | Syed Yousaf Shah | Other Current Asset | 12600 |
| 12620 | Naeem Hussain | Other Current Asset | 12600 |

- The seed generator reads the xlsx and applies this override explicitly. **Its test asserts that
  no `104xx` code exists and that 12610/12620 are Other Current Asset.**
- QuickBooks is changed separately by the owner.
- Seeded count stays **110**.

---

## 3 · What the reference says (replaces every `[NEEDS REF]`)

### 3.1 Sheet header and meta
- **Brand:** "AM" mark · "Fourteen Group of Companies · Awami Market, Karkhano, Peshawar" · title
  "Daily Cash & Bank Closing"
- **Actions:** theme toggle, Director report, Start new day, Print
- **Meta strip:**
  - Closing date
  - Day (weekday, en-GB)
  - **Closing no.** (e.g. `DC-001`)
  - Prepared by
  - status pill: **"Balanced"** when there are no issues, otherwise **"N items to check"**
- **Theme:**
  - `localStorage["awami-theme"]` sets `html[data-theme]` before paint
  - the toggle flips light ↔ dark from the current or system theme
  - the token set is lines 12–29 of the reference
  - the font is IBM Plex Sans
- **Footer:** "Awami Market · Daily Cash & Bank Closing", and a stamp
  "`DC-001 · 16 Sep 2026 · Printed dd Mon yyyy, hh:mm`"

### 3.2 Position table
- Rows: 10100 Cash in hand, 10200 Petty cash, 10300 Bank Al-Habib, then Total
- Columns: Opening · Received · Paid · Transfers · Closing
- Closing = opening + received − paid + transfers. Negatives are shown red.
- **KPI panel:**
  - "Total closing, cash and bank"
  - "Net movement today" = **received − paid** ("received less paid"; transfers excluded)
  - "Entries: N receipts, N payments"
  - **amount in words**: "Rupees … only", **in Lakh/Crore words**
- **Number format:**
  - zero shows "–"
  - negatives show in parentheses
  - Western grouping (`en-PK` gives `2,435,460`, the same as the platform's `en-US` rule)

### 3.3 Receipts and payments books
- Two books: **Receipts CRV / BRV** and **Payments CPV / BPV**
- Row: Voucher · Description, with the head `<select>` under it · Floor · Via · Amount · ×
- **Floors:** `LG GF FF SF TF 4F 5F CB P-W`
- **Vias:** `Cash`, `Petty`, `Bank`
- **Heads:** exactly **76 accounts** (list at reference line 403). That is every COA leaf
  **except**: 10100, 10200, 10300 (the Vias), 10410, 10420, 11000, 24000, 30000, 32000, 80000.
  So these **are** heads:
  - 15900 Accumulated Depreciation
  - 81200 Depreciation Expense
  - 13100 Unsold Units
  - 20000 Accounts Payable
  - 12300 PDC Receivable
  - 23400 PDC Payable
- **"+ Add receipt / payment"** suggests the next voucher number: the highest `CRV-`/`CPV-`
  number on the sheet + 1, zero-padded to 3.
- **Book footer:** Cash / Petty cash / Bank subtotals, "Not assigned" (red) for lines with no
  Via, and Total received / paid.
- **Payments by head** panel: payments grouped by head, largest first, "No head selected" in red,
  with a total. **I left this out of revision 1.**

### 3.4 Transfers and reconciliation
- **Two single amounts per day, not lines:**
  - "Cash deposited in bank" (`tBank`)
  - "Cash given to petty cash" (`tPetty`)
- No voucher number, no description.
- Transfers column: Cash −(tBank + tPetty), Petty +tPetty, Bank +tBank.
- Rows below them:
  - "Cash in hand as per book"
  - "Cash in hand as counted" ("Not counted" if nothing entered)
  - Difference, labelled "Difference, cash matches" / "Cash short" / "Cash over"
- **Difference = book − counted.** A positive difference is *short*.

### 3.5 Cash count (Cash in hand only)
- **Denominations:** 5000, 1000, 500, 100, **75**, 50, 20, 10 (pieces), plus **Coins (Rs amount)**
- "Counted" means **at least one count field was filled in, even with 0**. Empty everywhere
  means "not counted".

### 3.6 PDCs
- Two tables: **received** and **issued**, both labelled "Pending"
- Fields: Cheque no. · Party · Bank · Due date · Amount, with a total each
- **No floor, no status workflow.**
- **They carry across days.** "Start new day" keeps every PDC row that has a number or amount;
  a row disappears only when someone blanks it.
- They are not part of any position.

### 3.7 Checks (the reference's exact list, in order)
1. For each of Cash / Petty / Bank below zero: "`<name>` is negative by Rs X. A payment cannot
   exceed the money available."
2. Lines with a description or amount but no head: "N line(s) has/have no head selected."
3. Lines with an amount but no Via: "…not marked Cash, Petty or Bank, so … left out of the
   balances."
4. Lines with an amount but no voucher: "…no voucher number."
5. Lines with an amount but no floor: "…no floor."
6. Duplicate voucher numbers on the sheet (trimmed, upper-cased): "Voucher X is used more than
   once."
7. Not counted: "Cash in hand has not been counted yet." Otherwise, if difference ≠ 0: "Cash in
   hand is short/over by Rs X."

If none apply: "All checks passed. Every line has a voucher, head, floor and account; no balance
is negative; counted cash matches the book." The rest of the section is a Remarks box, and the
sign lines **Prepared by (Accountant) · Checked by · Approved by (Director)**.

### 3.8 Start new day
- Date = closing date **+ 1 calendar day**
- Closing no. + 1, keeping its zero padding
- Openings = today's closings
- Prepared by is kept
- Lines cleared (5 blank rows, the first one suggesting the next voucher number)
- Transfers, count and remarks cleared
- **Pending PDCs kept**

### 3.9 Director report
- **Header:** "Awami Market, daily report", long date (en-GB), status **"Books balanced"** or
  **"Under review"** (= any check failing).
- **Summary paragraph**, built from these pieces in order:
  1. received, paid, net inflow/outflow
  2. "Sales side:" with the count and value of 21100 tokens and 40100 instalments (each part
     only if present)
  3. "The biggest spend was `<largest out-category, lower case>` at Rs X" (only if there were
     payments)
  4. total close
- **3 cards:** closing per account, with "▲ up / ▼ down Rs X from opening" or "No change". Then
  "Total cash and bank at close".
- **Money in categories** (by head):

  | Heads | Category |
  |---|---|
  | 21100 | New tokens |
  | 40100 | Sales instalments |
  | 21200, 40200 | Advertising units |
  | 40300 | Transfer and processing fees |
  | 40400 | Forfeited tokens |
  | 22xxx | From group companies |
  | 25xxx, 26xxx | Loans received |
  | 31100 | Capital introduced |
  | anything else | Other receipts |

- **Money out categories:**

  | Heads | Category |
  |---|---|
  | 51 | Land |
  | 52 | Construction |
  | 53 | Approvals, design and consultants |
  | 54 | Dealer commission |
  | 60 | Marketing |
  | 70100, 70200 | Salaries and security |
  | other 70 | Office running |
  | 85 | Bank charges |
  | 12 | Advances given |
  | 21300 | Customer refunds |
  | 22 | To group companies |
  | 15, 16 | Office assets |
  | 25, 26 | Loan repayments |
  | 31200 | Drawings |
  | anything else | Other expenses |

  Each category shows a count "(n)" when n > 1, a proportion bar, and is sorted largest first.
- **Large payments:**
  - payments **≥ threshold** (50,000, inclusive), largest first
  - each shows its **description** · category · "by bank" (Bank) or "in cash" (Cash *and* Petty)
  - the section is hidden if there are none
- **For your attention:**
  - **count:**
    - (warn) not counted, or
    - (warn) "short/over by Rs X against the books", or
    - (good) "counted and matches the books"
  - (warn) each negative account
  - (neutral) "Rs X of cash was deposited in Bank Al-Habib." when tBank > 0 — **this is the
    "bank deposit" item**
  - (warn) "N entry issues still open on the closing sheet" — **this is "open issues"**: the
    check count, excluding count and negative items. It is **not** a separate issues register.
  - **PDCs** due between the closing date and +7 days, inclusive:
    - received → (neutral) "Cheque of Rs X from P is due for deposit on d Mon."
    - issued → (warn) "Our cheque of Rs X to P will be presented on d Mon. Keep funds in the
      bank."
    - if some are pending but none are due → (neutral) "Post-dated cheques pending: Rs X to
      receive, Rs Y to pay. None due this week."
- **Sign lines:** "Prepared by: name" and "Reviewed by (Director)". Footer: "Summary of the daily
  cash and bank closing. Full closing sheet available on request." plus the closing no.

### 3.10 Print / PDF
- **Sheet:**
  - `@page { size: A4 portrait; margin: 9mm }`
  - forced light tokens
  - sheet width 1100px at `zoom: .665`
  - actions, add, delete and note hidden
  - empty rows and blank PDC rows hidden
  - `break-inside: avoid` on the blocks
- **Director report:** `zoom: .92`, toolbar hidden.
- Output is **browser print** (`window.print()`). **The reference has no filename logic.**

---

## 4 · Where I differ from revision 1, or from the reference

**A. Revision 1 proposals the reference or the owner overturned** (now corrected):

| # | Revision 1 said | Now |
|---|---|---|
| 1 | Floor code `PW` | **`P-W`** (reference). Phase 5 maps it to QB class `Project-wide`, as the entries IIF uses. |
| 2 | Not postable: 15900, 81200, 13100, maybe 20000 | **All four are heads** (reference list of 76). |
| 3 | Transfers as voucher-numbered lines | **Two amounts on the day**, `transfer_to_bank` and `transfer_to_petty`. No voucher. |
| 4 | `nf_day_checks` table for manual ticks | **Dropped.** The reference has no manual checks; all 7 are computed. |
| 5 | `nf_issues` register | **Dropped.** "Open issues" is a count of failing checks. |
| 6 | PDCs belong to a day, with a floor | **Company-level running register**, no floor. Shown on a day if entered on or before it and not resolved before it. |
| 7 | Cash count = exact match, no exception | **Owner change:** a director may close with a variance and a reason (R6). |
| 8 | 10410/10420 kept as-is | **Renumbered to 12610/12620** (owner, 2.2). |
| 9 | Voucher stored as number + type | **Full string** as typed, e.g. `CRV-001`, trimmed and upper-cased. Unique on that string, so `CRV-001` and `CPV-001` can both exist. |
| 10 | "Bank deposit" / "open issues" undefined | Defined by the reference (3.9). |

**B. Places v1 will deliberately differ from the reference.** Flagged, not silent:

| # | Reference | v1 | Why |
|---|---|---|---|
| 1 | Opening typed every day | Typed **only on the first day**, read-only afterwards | R5 |
| 2 | Incomplete rows can sit on the sheet (no head, no Via…) | The server **refuses** an incomplete line (R3, R8). An unfinished row lives only as an **unsaved draft** on screen, shown with the same red check wording. Submit/Close are disabled while any draft exists. **Checks 2–6 can therefore only ever fire on drafts.** | R3, R8 |
| 3 | Duplicate check only within the sheet | Unique across **all days** | R2 |
| 4 | Status is only Balanced / N items | The same pill **plus** a state label: Open / Submitted / Closed | Workflow |
| 5 | Prepared by is free text | Filled from the **signed-in accountant's name**, not typed | No silent/typed identity |
| 6 | "Start new day" works any time | Needs the previous day **CLOSED** (owner, 2026-09-16) | R5 + R7 |
| 7 | Next day is always +1 calendar day | Suggests +1; the date may be moved **later** (holidays), never earlier or equal. No rows for skipped dates. | Real calendar |
| 8 | A PDC "removed" by blanking its row | A PDC is **resolved** (Cleared / Bounced / Cancelled) with the day it happened. Nothing is deleted, and clearing **posts nothing**: the accountant records the BRV/BPV. | R8, audit |
| 9 | 50,000 hard-coded | `nf_settings.large_payment_threshold`, default 50,000, changed by a director | Brief |
| 10 | The large-payments list prints each payment's **description** | Kept as the reference does. It shows no voucher or code, but it *is* line text; the brief said "no line items". | Reference wins unless told otherwise |
| 11 | A director variance close isn't modelled | The attention list keeps the reference's "short/over by Rs X" warning and **adds the director's written reason** under it. The status stays "Under review", truthfully. | Owner R6 change |
| 12 | Amounts parsed as floats, shown rounded | **Up to 2 decimals** (`numeric(14,2)`). Checks compare **exact paisa**. A value is shown with 2 decimals only when it has paisa. The RPC refuses more than 2 decimals rather than letting the column round silently. | Owner, 2026-09-16 |
| 13 | Amount in words in Lakh/Crore | **Kept as in the reference**, even though RMS removed Lakh/Crore app-wide in June. Grouping is Western in both. | The reference is the approved spec |
| 14 | PDF via print dialog, default name = page title | Same print CSS; `document.title` is set to `Awami_Daily_Closing_DD-Mon-YYYY` / `Awami_Director_Report_DD-Mon-YYYY` just before printing and restored after, so Save-as-PDF offers the right filename | Brief filename requirement |
| 15 | Data kept in browser storage | Server only. The theme is the only thing kept in `localStorage`. | — |

---

## 5 · Schema

### 5.1 Principles
- **Prefix and tenant:** new `nf_` tables; tenant = `company_id` (Awami Market `96d210e7…`).
- **Writes:** only via `SECURITY DEFINER` RPCs. RLS on, `deny_all_anon`, no write grants,
  member-scoped `SELECT`. Every function gets `REVOKE EXECUTE FROM PUBLIC, anon` then
  `GRANT … TO authenticated`.
- **Where rules live:** every rule is in a constraint or trigger, and the RPCs only translate
  errors (SR-12).
- **Types:**
  - money `numeric(14,2)`; RPCs refuse input with more than 2 decimals (`AMOUNT_SCALE`), so nothing is rounded silently
  - dates in Asia/Karachi, never `CURRENT_DATE`
  - status columns are `text` + `CHECK`
- **Auth:** the same auth session as RMS. Roles live in `nf_members`, and **`app_users` is not
  touched**.

### 5.2 Tables

| Table | Columns and constraints |
|---|---|
| `nf_members` | `company_id`, `user_id`, `role CHECK IN ('accountant','director','viewer')`, `display_name`, `active`. PK `(company_id, user_id)`. |
| `nf_settings` | `company_id` PK, `large_payment_threshold NOT NULL DEFAULT 50000 CHECK > 0`, `pdc_due_days NOT NULL DEFAULT 7`, `company_line` ("Fourteen Group of Companies · Awami Market, Karkhano, Peshawar"), `bank_label` ("Bank Al-Habib"). |
| `nf_accounts` | `company_id`, `code CHECK ~ '^\d{5}$'`, `name`, `qb_type`, `parent_code`, `description`, `is_head`, `via`, `sort`, `active`. PK `(company_id, code)`. Constraint trigger: an account with children can't be `is_head`. `via` is non-null only on 10100/10200/10300, and a `via` account can't be `is_head`. `CHECK (code !~ '^104')`. |
| `nf_floors` | `company_id`, `code` (`LG GF FF SF TF 4F 5F CB P-W`), `qb_class` (`P-W` → `Project-wide`), `sort`. |
| `nf_days` | See the list below this table. |
| `nf_lines` | `id`, `company_id`, `day_id`, `side CHECK IN ('IN','OUT')`, `voucher_no NOT NULL`, `voucher_key` (generated: `upper(btrim(voucher_no))`), `description NOT NULL`, `head_code NOT NULL`, `floor_code NOT NULL`, `via NOT NULL CHECK IN ('Cash','Petty','Bank')`, `amount numeric(14,2) NOT NULL CHECK (amount > 0)`, `CHECK` voucher prefix: IN → `^(CRV|BRV)-`, OUT → `^(CPV|BPV)-`; `C…` ⇔ Via Cash/Petty, `B…` ⇔ Via Bank, `sort`, `created_by/at`, `updated_by/at`, `version`. **No DEFAULT on any business column.** `UNIQUE (company_id, voucher_key)`. |
| `nf_pdcs` | `id`, `company_id`, `direction CHECK IN ('RECEIVED','ISSUED')`, `cheque_no`, `party`, `bank`, `due_date`, `amount CHECK > 0`, `entered_day_id`, `status CHECK IN ('PENDING','CLEARED','BOUNCED','CANCELLED')`, `resolved_day_id` (non-null iff status ≠ PENDING), audit columns. |
| `nf_audit` | Append-only: `company_id`, `day_id`, `entity`, `entity_id`, `action` (INSERT/UPDATE/DELETE/SUBMIT/CLOSE/CLOSE_WITH_VARIANCE/REOPEN/RETURN), `actor`, `at`, `before`, `after`, `reason`. Written by a trigger on every `nf_*` table. UPDATE, DELETE and TRUNCATE refused. |

**`nf_days` columns:**
- `id`, `company_id`, `business_date`, `closing_no`
- `status CHECK IN ('OPEN','SUBMITTED','CLOSED')`
- `is_first_day`, `typed_open_cash/petty/bank`, with
  `CHECK (is_first_day = (typed_open_cash IS NOT NULL AND …))` and each `≥ 0`
- `transfer_to_bank`, `transfer_to_petty`: `numeric(14,2) ≥ 0`, NULL = blank
- `denominations jsonb`: keys `5000…10` and `coins`; `counted_cash` computed by the RPC;
  `counted boolean` meaning at least one field was entered
- `variance`, `variance_reason`: `CHECK (variance_reason IS NULL OR status='CLOSED')`
- `remarks`
- `prepared_by`, `submitted_by/at`, `closed_by/at`
- `close_cash/petty/bank`: snapshot, non-null iff CLOSED
- `reopen_count`, `version`

**`nf_days` keys and indexes:**
- `UNIQUE (company_id, business_date)`
- `UNIQUE (company_id, closing_no)`
- one `is_first_day` per company
- at most one non-CLOSED day per company

### 5.3 Calculation functions (the SQL port of `calc()` and `renderDir()`)
- **`nf_position(day_id)`:** per Via, opening, received, paid, transfers and closing, plus totals,
  net (= received − paid), entry counts, and amount in words.
  - Opening = typed if first day, otherwise the previous day's `close_*` snapshot.
- **`nf_checks(day_id)`:** the reference's 7 checks with its **exact wording**, as
  `[{key, severity, text}]`.
- **`nf_report(day_id)`:** everything in 3.9. Categories come from the reference's `catIn`/`catOut`,
  held in the table `nf_report_categories` (`side`, `match_kind` exact/prefix, `pattern`,
  `label`, `priority`) so the mapping is data, not code.
- **Client parity:** `js/nf/nf-calc.js` keeps a line-for-line port for live typing. The golden
  suite asserts it agrees with the SQL, and both agree with the reference file.

### 5.4 RPCs

| RPC | Who |
|---|---|
| `nf_get_context()` | member (non-members get nothing) |
| `nf_list_heads()` · `nf_list_floors()` · `nf_list_days(p_from, p_to)` | member |
| `nf_get_day(p_date)`: day, position, lines, pending PDCs, count, checks, remarks, state | member |
| `nf_start_first_day(p_date, p_closing_no, p_open_cash, p_open_petty, p_open_bank)` | director, once per company |
| `nf_start_next_day(p_date)`: **no opening parameter**; closing no. +1 | accountant, director |
| `nf_save_line(p_day_id, p_line_id, p_side, p_voucher_no, p_description, p_head, p_floor, p_via, p_amount, p_version)` (**no parameter defaults**) · `nf_delete_line(p_line_id, p_version)` | accountant, director |
| `nf_set_transfers(p_day_id, p_to_bank, p_to_petty)` · `nf_save_count(p_day_id, p_denoms)` · `nf_set_remarks` | accountant, director |
| `nf_save_pdc` · `nf_resolve_pdc(p_id, p_status)` | accountant, director |
| `nf_submit_day(p_day_id, p_version)` | accountant |
| `nf_return_day(p_day_id, p_reason)` | director |
| `nf_close_day(p_day_id, p_version, p_variance_reason)` | accountant or director when all checks pass; director only with a variance + reason |
| `nf_reopen_day(p_day_id, p_reason)`: latest day only | director |
| `nf_get_report(p_day_id)`: payload has **no** voucher, code or line-id keys | all three roles (viewer read-only everywhere) |
| `nf_list_audit(p_day_id)` | director |
| `nf_set_member(p_user_id, p_role, p_active)` | director only (add / change / remove members) |
| `_nf_seed_company(...)` · `_nf_test_purge(company_id)` (refuses unless name starts `ZZTEST-NF-`) | service role only |

### 5.5 Where R1–R8 are enforced

| Rule | Database (the real guard) | Also |
|---|---|---|
| **R1** | Constraint trigger `nf_position_guard`, **immediate**, on `nf_lines` INSERT/UPDATE/DELETE **and** on `nf_days` UPDATE of `typed_open_*`/`transfer_*`. It locks the day row `FOR UPDATE`, recomputes `nf_position`, and raises `NEGATIVE_POSITION {via, would_be}` if any closing is < 0. Covers deleting a receipt, shrinking one, changing its Via, and raising a transfer. | Screen shows the shortfall before saving |
| **R2** | `UNIQUE (company_id, voucher_key)` on `nf_lines` | `DUPLICATE_VOUCHER {date used}` |
| **R3** | `NOT NULL` + `CHECK (amount > 0 …)`; composite FKs to `nf_accounts`/`nf_floors`; trigger requires `is_head AND active` | Pickers offer only valid values |
| **R4** | `via` is a closed CHECK list mapped only to 10100/10200/10300; `CHECK (code !~ '^104')`; a `via` account can't be a head; 12610/12620 have `via` NULL | Not in the Via picker |
| **R5** | Typed openings exist only under the `is_first_day` CHECK; one first day per company; a trigger refuses `is_first_day` when other days exist, and any `business_date` ≤ the latest; later openings are never stored | `nf_start_next_day` has no opening parameter |
| **R6** | Trigger `nf_days_state_guard` on moving to SUBMITTED or CLOSED runs `nf_checks`. Any failure refuses the move, **except** a close where all are true: the only failing check is a count mismatch (not "not counted"), the caller (`auth.uid()` → `nf_members`) is a **director**, and `variance_reason` is non-blank. That close stores `variance` and audits `CLOSE_WITH_VARIANCE`. Role is read from `nf_members` inside the trigger itself, never from a session flag. | Checks panel |
| **R7** | Trigger on `nf_lines`, `nf_pdcs` and `nf_days` business columns: a write where the day ≠ OPEN raises `DAY_LOCKED`. CLOSED → OPEN only with the `nf.reopen` session flag, which only `nf_reopen_day` sets, after checking director + reason + that no later day exists. Audit row `REOPEN` with the reason. | Button only for directors |
| **R8** | `head_code NOT NULL`; **no DEFAULT on any business column** (schema test reads `pg_attrdef`); no RPC parameter defaults (test reads `pg_proc.pronargdefaults = 0`); transfers only move between the three Vias | No pre-selected head, floor or Via |
| **Edit log** | `nf_audit` trigger stores the before/after row, actor and time for every INSERT/UPDATE/DELETE | Audit tab for directors |

---

## 6 · File structure

```
nexufinance.html                      boot: session → nf_get_context → mount (swapped at cutover)
js/nf/nf-api.js                       the only caller of supabase.rpc; checks argument shapes
js/nf/nf-format.js                    fmt (– for zero, (neg)), Western grouping, en-GB dates, Lakh/Crore words
js/nf/nf-calc.js                      port of the reference calc()/renderDir() for live typing
js/nf/nf-sheet.js                     closing sheet
js/nf/nf-report.js                    director report
js/nf/nf-share.js                     WhatsApp text (Phase 3)
css/nf/nf.css                         reference tokens + screen styles
css/nf/nf-print.css                   reference print CSS
docs/reference/                       (renamed from docs/Reference)
docs/nexufinance/v1/{RULES,SCHEMA,RUNBOOK}.md
supabase/migrations/2026MMDDa_nf_tables.sql
supabase/migrations/2026MMDDb_nf_guards.sql
supabase/migrations/2026MMDDc_nf_calc_and_rpcs.sql
supabase/migrations/2026MMDDd_nf_seed_awami.sql        generated
supabase/migrations/2026MMDDr_nf_rollback.sql          tool, never applied
scripts/nf/gen-seed.js                xlsx + Q9 override + reference HEADS/FLOORS/categories → seed SQL
scripts/nf/verify-nf-schema.js        migrations + assertions inside BEGIN … ROLLBACK
scripts/nf/verify-nf-rules.js         R1–R8 via real RPCs as real signed-in users
scripts/nf/verify-nf-golden.js        golden day through the real nexufinance.html, compared with the reference file
scripts/nf/verify-nf-pdf.js           page count, filename, readable text
scripts/nf/nf-test-tenant.js          throwaway ZZTEST-NF-<run> company + 3 users; cleanup verified by query and printed
```

---

## 7 · Phases

Every apply, deploy and push **stops for an OK**. Each phase report includes:
- the backup MANIFEST
- the dry-run log
- the suite logs, written to files (SR-8)
- proof KBH/FMH are untouched: row counts, payment totals, trigger inventory

### Phase 1 — schema + RPCs + seed + tests
1. `git mv docs/Reference docs/reference` (local commit).
2. `gen-seed.js`. Its assertions:
   - 110 accounts
   - no `104xx`
   - 12600/12610/12620 present
   - **the heads list equals the reference's 76 plus 12610/12620 (78)**
   - 9 floors
   - categories equal to `catIn`/`catOut`
   - **All read out of the reference file at run time, not retyped.**
3. Migrations a–d, rehearsed by `verify-nf-schema.js` inside `BEGIN … ROLLBACK`.
   → **Stop for OK to apply.**
4. `verify-nf-rules.js`. Setup:
   - a fresh `ZZTEST-NF-<run>` tenant
   - three real users signed in with real passwords (real JWTs, real HTTPS)
   - every deny paired with an allow (SR-2)
   - every rule proven red against a copy of the migration with that one guard removed

   | Proof | Steps and expected result |
   |---|---|
   | Negative cash | First day with openings 0/0/0 → CPV 100,000 via Cash is **refused**. After a 150,000 CRV, the same payment is accepted. Deleting the CRV, or cutting it to 50,000, is **refused**. Raising `transfer_to_bank` past the cash held is **refused**. |
   | Duplicate voucher | `crv-001 ` on a later day is refused as a duplicate of `CRV-001`. |
   | Carry forward | Close day 1. `nf_start_next_day` with **nothing seeded**. The opening the server returns = day 1 closing (SR-7). |
   | Lock | Accountant save, delete, transfer, count and PDC on a CLOSED day → `DAY_LOCKED`. The same writes as raw PostgREST table calls → denied. |
   | Close rules | Accountant close with a mismatch → refused. Director close with a mismatch and no reason → refused. With a reason → CLOSED, `variance` stored, audit `CLOSE_WITH_VARIANCE`. "Not counted" → refused for everyone. |
   | Reopen | Accountant → refused. Director without a reason → refused. Director on a non-latest day → refused. Director on the latest day with a reason → OPEN, `REOPEN` audit row. |
   | Edit log | Update a line's amount → audit row has old value, new value, actor, time. |
   | R4 | Via = 12610 → refused. As a head on a receipt and a payment → accepted, and not in any Cash/Petty/Bank figure. |
   | R8 | Missing head, floor or via → refused. Defaults are asserted absent. |
   | Viewer | Every write refused. Reads allowed. |

5. **Golden day via RPC:** the owner's lines entered through `nf_save_line`, `nf_set_transfers`,
   `nf_save_count` and `nf_save_pdc`, then every figure in §0 asserted to the rupee.

### Phase 2 — closing sheet + print/PDF
- The screen from §3.1–3.8 in `nexufinance.html` under the real RMS session: both themes,
  1280px and 375px.
- **`verify-nf-golden.js`:**
  - real `login.html` sign-in
  - types every golden line, count and transfer through the form
  - asserts request bodies (SR-9), rendered figures and DB state
  - accountant Submit → director Close
  - "Start new day" → the carried opening
  - the reference file loaded side by side as the oracle
- **Print:**
  - `verify-nf-pdf.js` uses `page.pdf()` with the print CSS: golden day **= 1 page**
  - a long day proves the page check fires
  - text-extraction positive controls (four balances + date) run before any absence check
  - `document.title` equals the filename at print time
- → **Stop for OK to deploy.**

### Phase 3 — director report + PDF + WhatsApp
- §3.9 exactly, one A4 page.
- The payload test plants a voucher number and proves the "no voucher/code" check fires.
- Share: **one-page PDF + a 3–4 line text summary**. Web Share API with the PDF file where `navigator.canShare({files})` is true; otherwise download the PDF and copy the text to the clipboard. Both paths driven in the suite.
- → **Stop for OK to deploy.**

### Phase 4 (later) — chat quick-entry
A parsed line is shown field by field and saved only after the person confirms it.

### Phase 5 (later) — QuickBooks IIF export
- Format follows `docs/reference/Awami_Entries_import.iif` and `Awami_Lists_import.iif`:
  - `TRNS`/`SPL` rows
  - `ACCNT` as the full `Parent:Child` path
  - `CLASS` `Project-wide`
  - `NAME` from the Lists file
- One export per CLOSED day.
- Needs payee names per line (later question).

---

## 8 · Owner answers (2026-09-16) and what is still open

| # | Answer |
|---|---|
| 1 | Openings **0 / 0 / 0**. First business date: **still the template `[DD-MM-2026]` — open.** Not needed until go-live: the first day is created through `nf_start_first_day` in the app, not by a migration. |
| 2 | Accountant **or** director closes when every check passes. Only a director closes with a variance (written reason, stored, logged, on the report). Only a director reopens, latest closed day only. |
| 3 | Previous day must be CLOSED before "Start new day". |
| 4 | 12610 / 12620 are heads on receipts and payments; never a Via, never cash. |
| 5 | All three roles open the director report. Viewer is read-only everywhere. |
| 6 | Both: one-page PDF + 3–4 line text. Web Share with the file where supported; else download PDF + copy text. |
| 7 | `ZZTEST-NF-*` companies and three test users approved. **Tests never touch the Awami tenant.** Cleanup verified by query and shown in the output. |
| 8 | Members: **still templates (`[name/email]`) — open.** Only directors add or remove members. |
| 9 | Prefixes enforced in the database: receipts CRV/BRV, payments CPV/BPV; C = Cash or Petty, B = Bank. |
| §4B | Amounts `numeric(14,2)`, exact paisa, 2 decimals shown only when present. Large payments keep the description, no codes, no vouchers. Lakh/Crore words kept. All other §4B items approved. |

**Still open (none block Phase 1 build):**
- First business date for Awami.
- Awami members: accountant, director, viewer (name + email of an existing RMS login).
- Later: cutover (old flag off, old write RPCs revoked) · Phase 5 payee per line.

---

## 9 · Phase 1 — built and rehearsed, NOT applied (2026-09-16)

### 9.1 Files

| File | What it is |
|---|---|
| `supabase/migrations/20260916a_nf_tables.sql` | 9 tables, keys, CHECKs, RLS, grants |
| `supabase/migrations/20260916b_nf_guards.sql` | the triggers that hold R1–R8, position, checks, audit |
| `supabase/migrations/20260916c_nf_rpcs.sql` | 24 RPCs for the screen; seed and purge for the operator only |
| `supabase/migrations/20260916d_nf_seed_awami.sql` | **generated** — Awami settings, 110 accounts, 9 floors, 29 report categories. No days, no members. |
| `supabase/migrations/20260916r_nf_rollback.sql` | tool, never applied; rehearsed every run (RB01) |
| `scripts/nf/reference.js` | reads HEADS, FLOORS, ACCTS, sample, catIn/catOut out of the reference HTML, and the xlsx |
| `scripts/nf/gen-seed.js` | builds the seed; asserts it; self-tests its category check with three planted mistakes |
| `scripts/nf/verify-nf-schema.js` | rehearsal: 157 assertions + 17 mutants, one aborted transaction |
| `scripts/nf/verify-nf-rules.js` | the same rules over real HTTPS with real sign-ins — **runs only after apply** |
| `scripts/nf/snapshot-tenants.js` | before/after proof that nothing outside `nf_` changed, for every tenant |

### 9.2 Evidence

- `gen-seed.js`: accounts 110 · heads 78 (reference 76 + 12610/12620) · vias 3 · floors 9 · categories 29, with
  category parity against the reference's own `catIn`/`catOut` over all 78 heads. Its self-test catches all three
  planted mistakes, and a neutered copy of it goes red.
- `verify-nf-schema.js --mutants`: **157 / 157 assertions, 17 / 17 mutants killed.** After every run, live
  was queried and holds **no nf_ table, no nf_ function, no rehearsal company, no rehearsal user**.
- The golden day came from the reference file's `sample`, cross-checked against the owner's typed list (G00).
  The results: Cash 313,000 · Petty 13,500 · Bank 2,108,960 · Total 2,435,460 · Net +665,460 · balanced.
  The report categories, large payments, cards and PDC totals all equal what the reference's own functions give.
- `verify-nf-rules.js` against the unapplied database: "COULD NOT RUN — the nf_ migrations are not applied",
  exit 2, and nothing was created.

### 9.3 Found while building (all fixed, none weaken a rule)

1. **A bad voucher prefix was reported as a Via mismatch** (`XRV-1`). The Via check now judges only C/B prefixes.
2. **An unknown Via (`12610`) was reported as "not configured".** The RPC now names it `VIA_UNKNOWN` first.
3. **"Previous day must be closed" lives in four layers** (RPC, trigger, one-unclosed-day index, and the position
   function refusing an opening from an unclosed day). The first mutant survived because of that. R5-03b now writes
   past the RPC so the trigger layer is tested on its own.
4. The rollback rehearsal hit "pending trigger events" — an artefact of one long transaction, not of the file.
5. `process.exit()` on Windows with fetch sockets open aborted with 127 instead of 2; the suites use `exitCode`.

### 9.4 Not covered yet, named

- Two writers at once (one transaction cannot race itself). The day row is locked `FOR UPDATE` by every line write,
  but no test has raced it. Proposed: a two-connection test in `verify-nf-rules.js` after apply.
- The screen, print and PDF — Phases 2 and 3.

### 9.5 What will run, on the owner's OK — and nothing before it

```
1  node scripts/backup-full.js                                              full verified backup (MANIFEST)
2  node scripts/nf/snapshot-tenants.js --out backups/nf_before.jsonl        every tenant, read-only
3  node scripts/nf/verify-nf-schema.js --mutants                            dry run, one more time
4  node scripts/nf/apply-phase1.js                                          dry run of the apply itself
5  node scripts/nf/apply-phase1.js --apply --owner-ok                       ← the only step that writes
6  node scripts/nf/snapshot-tenants.js --out backups/nf_after.jsonl --compare backups/nf_before.jsonl
7  node scripts/nf/verify-nf-race-harness.js                                the race detector, before it is relied on
8  node scripts/nf/verify-nf-rules.js                                       real HTTPS, races, ZZTEST-NF-*, cleanup verified
```

**Step 5 is the whole apply, in one transaction**: the four `nf_` files are named in the script (nothing is found by
listing a folder), each must be byte-identical to its committed version, and the transaction ends with a guard that
reads `pg_stat_xact_user_tables` and aborts unless every table this transaction wrote is an `nf_` table. A failure
anywhere — a file or the guard — rolls back all four. `20260916e` (the other session's) is listed as NOT APPLIED and
never sent.

Every run goes to a log file (SR-8). Any step that fails stops the sequence. Rollback is `20260916r_nf_rollback.sql`,
which is safe only while Awami has no days.

### 9.6 A, B and C — asked for before the OK (2026-09-16)

**A · which migrations run.** `scripts/nf/apply-phase1.js`, dry run: the four `nf_` files, each identical to HEAD, no
statement on an object outside `nf_`; `20260916e` and the rollback listed as NOT APPLIED. The "outside nf_" detector
self-tests on six planted statements and stays silent on four `nf_`-only ones, and it correctly reports `20260916e`'s
own `availability_releases` objects — a live positive control.

**B · the tenant snapshot.** Now streams to disk, one line per table, and judges each item as it is captured.
- *Planted run:* all four plants caught — the functions fingerprint, a payment total +1, a payment count that looked
  like 500 vanished rows, and a unit count that looked like 500 appeared rows.
- *Clean run:* fingerprints (triggers, functions, policies, columns) and every tenant's payment count and sum were
  **identical**, twice. Row counts were **not** identical and cannot be on a live database: during the five minutes,
  real users filed two reservation requests through the Awami availability link, sales phones sent location pings,
  and the other session's smoke tests created and deleted ZZTEST rows. Increases that timestamps explain are marked
  EXPLAINED with evidence; anything else is DIFFERS.
- **Therefore the row-count compare is evidence, not proof.** The proof that the apply wrote nothing outside `nf_` is
  the in-transaction guard in step 5, which live activity cannot disturb. It is asserted in the rehearsal as W01
  (migrations wrote nothing outside `nf_`), W02 (positive control: the rehearsal's own fixture writes to
  `public.companies` and `auth.users` **are** seen) and W03 (the seed added nothing).

**C · concurrency.**
- R1 takes a **row lock on the day**: `SELECT … FROM nf_days … FOR UPDATE` in the BEFORE trigger of every line
  insert/update/delete (`20260916b_nf_guards.sql:448`), with the position re-checked in the AFTER trigger (`:488`,
  trigger at `:492`). Transfers take the same row lock in `nf_set_transfers` (`20260916c_nf_rpcs.sql:460`) and are
  re-checked by the AFTER trigger on `nf_days` (`20260916b:414`). Starting a day also takes an advisory lock per
  company (`20260916b:269`).
- R2 rests on the unique index `nf_lines_voucher_unique` (`20260916a_nf_tables.sql:191`): a second insert of the same
  key waits on the first's uncommitted row and then fails. Since only one day per company can be open, those writes
  also queue behind the same day-row lock.
- `verify-nf-rules.js` now drives both from **two connections at once**, and proves the overlap from
  `pg_stat_activity` (side 2 waiting on a Lock whose blocker is side 1's pid): two payments that each fit but not
  together → exactly one accepted, one `NEGATIVE_POSITION`, cash never below zero; a paired race that does fit → both
  accepted (so a refusal means money, not blocking); the same voucher twice → exactly one row and one
  `DUPLICATE_VOUCHER`.
- `verify-nf-race-harness.js` checks the detector itself on advisory locks, touching no table: overlapping → blocked
  **true**; staggered apart → blocked **false**. It passed before apply, which is when it is worth knowing.

No deploy and no push are part of Phase 1: nothing in the front end changed.

### 9.7 APPLIED — 2026-09-16 21:26 PKT

- Backup `backups/BACKUP_20260916_1759` — `--verify` PASS, 180 tables, 129,470 rows, 0 mismatches.
  (Storage: 152 of 365 files; private buckets need the service key — separate change, owner item 1.)
- Snapshot before: 6 parts, 136 tenant tables + 7 fingerprints.
- Rehearsal: 160/160, 17/17 mutants killed, RB01 and W01–W03 PASS.
- Apply: `apply-phase1.js --apply`, one transaction, 3,350 ms, write guard passed. `20260916e` and `20260916f`
  (the other session's) listed and not applied.
- Live after apply: 9 nf_ tables with RLS, 55 functions, 50 SECURITY DEFINER all with search_path pinned,
  0 executable by anon, 18 triggers. Awami: settings 1, accounts 110, heads 78, vias 3, floors 9, categories 29,
  **members 0, days 0**. nf_audit 149 = the seed's own inserts.
- Snapshot after: all 143 items identical, DIFFERS 0.
- `verify-nf-race-harness.js` PASS. `verify-nf-rules.js` **45/45**, including RACE-R1, RACE-OK and RACE-R2;
  cleanup verified by query (company 0, auth users 0, nf rows 0); Awami nf_ rows identical before and after.
- **No members added.** First business date and member names still to come from the owner.

---

## 10 · Phase 2 — closing sheet screen (2026-09-16, in progress)

### 10.1 Built

`nexufinance.html` (rewritten for v1), `js/nf/nf-format.js`, `js/nf/nf-api.js`, `js/nf/nf-messages.js`,
`js/nf/nf-sheet.js`, `css/nf/nf.css`, `css/nf/nf-print.css`. The screen matches the reference layout and the
light/dark toggle, calls the real `nf_` RPCs (no stub), keeps an incomplete line as an unsaved draft row with the
reference's own check wording, shows a database refusal in plain language on the line that caused it, and carries
amounts to two decimals shown only when present, per §4B.

### 10.2 Test: `scripts/nf/verify-nf-golden-ui.js`

Real HTTP, real Puppeteer, a real signed-in session (director + accountant, `ZZTEST-NF-*`, own browser contexts),
against `nexufinance.html` served for real. **27 of 28 checks pass**, including the golden day end to end (totals
exact to the rupee, status Balanced), a negative-cash payment refused inline with nothing written, a duplicate
voucher refused inline, and light/dark screenshots.

**Three real product bugs were found and fixed by this testing, not just test bugs:**
1. **A version race that could silently drop part of a cash count.** `S.day.version` was only updated by a
   *separate* follow-up `nf_get_day` fetch after every save. Two saves close enough together (the bank transfer,
   then the cash count, typed within about a second — an ordinary pace) both read the stale version before either's
   fetch came back; the second lost the optimistic-lock check with `NF:VERSION_CONFLICT` and its edit vanished with
   only a toast, easy to miss. Fixed by applying the fresh day every mutation ALREADY returns directly (`applyDay()`
   in `nf-sheet.js`), removing the extra round trip and the window for the race entirely — not a test-only fix.
2. **A render mid-keystroke could erase what was being typed.** The cash-count and transfer fields lived only in the
   DOM; a re-render triggered by an unrelated save landing late rebuilt them from stale server state and dropped
   whatever had just been typed. Fixed with a state overlay (`countDraft`/`transferDraft`), the same pattern the
   draft lines already used.
3. **A plain debounce let one save's digits split across two requests** when a person paused more than 500ms
   between two denomination fields. Replaced with `serialDebounce`, which queues a trailing edit instead of firing
   a second overlapping request.

### 10.3 Known issue — NOT blocking Phase 2

**`UI-06 print is one A4 page` fails: the golden day prints as 2 pages, the second blank.** All other content and
layout checks pass. Six attempts were made (in order): fixed a `Uint8Array`/`Buffer` bug in the page-counter itself
(was misreporting 0); found that a diagnostic screenshot wasn't actually in print mode, because
`emulateMediaType()` and `emulateMediaFeatures()` overwrite each other on this Puppeteer version (also the cause of
an early light/dark toggle test failure, fixed); rendered the real PDF through Chrome's own viewer and confirmed
page 1 holds all content with visible room to spare and page 2 is blank; hid the Submit/Close day buttons in print
(no effect); hid the standalone "← Back to RMS" topbar in print (no effect); measured the live DOM under print
media and found `getComputedStyle(.sheet).zoom` reads `"1"`, not the `.665` the print CSS sets — **the print
zoom rule is not landing at all**, which is the likelier real cause and needs its own investigation (load order or
specificity of the `@page`/`@media print` rules against `css/nf/nf.css` vs `css/nf/nf-print.css`), not a content
overflow. Left for a dedicated pass rather than continued iteration on the same failing test, per the owner's
instruction (2026-09-16): **if the same test fails three times running, stop and report — do not keep iterating.**

### 10.4 Not done

Days list/navigation beyond the latest day, the director report screen (Phase 3), WhatsApp share (Phase 3).

---

## 11 · Double-entry foundation — built and rehearsed, NOT applied (2026-09-18)

**Owner decision, settled, not re-litigated here:** NexuFinance moves to a real double-entry ledger. QuickBooks
Desktop Enterprise stays the book of record; NexuFinance is entry-capture/control, management reporting, batched
IIF export, and QB-vs-NexuFinance reconciliation. Not a QuickBooks rebuild: no payroll, inventory, accrual,
depreciation or multi-currency — cash-basis project accounting only. This pass is foundation only: the voucher/leg
model, the party master, ledger-derived opening, the COA colon-path. Reports, the party-entry screen, IIF export
and reconciliation are explicitly the next pass.

### 11.1 Files

| File | What it is |
|---|---|
| `supabase/migrations/20260918a_nf_double_entry_tables.sql` | `nf_parties`, `nf_party_aliases`, `nf_vouchers`, `nf_voucher_legs`; `nf_accounts.requires_party`; drops `nf_accounts_head_not_via` (§11.3) |
| `supabase/migrations/20260918b_nf_double_entry_guards.sql` | leg guard + position guard + deferred balance-check trigger; `nf_ledger_position`; the fixed `nf_position_row`; `nf_account_path`; extends `nf_audit_row` |
| `supabase/migrations/20260918c_nf_double_entry_rpcs.sql` | `nf_post_voucher`; `nf_save_line`/`nf_delete_line` rewritten (same signature, same returned JSON); party RPCs |
| `supabase/migrations/20260918d_nf_migrate_lines_to_vouchers.sql` | renames `nf_lines`→`nf_lines_legacy`, migrates every row to a 2-leg voucher, **verifies to the rupee**, creates `nf_lines` as a view |
| `supabase/migrations/20260918r_nf_de_rollback.sql` | tool, never applied; undoes only 20260918a–d, restores the exact pre-change function bodies |
| `scripts/nf/verify-nf-de-migration.js` | the rehearsal this section reports on |

### 11.2 The four items, and the call made on each

**1 · Voucher/leg model.** `nf_vouchers` (header) + `nf_voucher_legs` (legs): a per-leg CHECK enforces exactly one
of debit/credit; `floor_code` is `NOT NULL` on every leg, cash/bank legs included; a voucher may have any number of
legs ≥ 2. **Enforcement is both mechanisms, not a choice between them** — they cover different moments:
`nf_post_voucher` validates leg completeness and balance *before* writing anything, holding the day row `FOR UPDATE`
first (the atomic, race-safe half); a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `nf_voucher_legs`
re-checks balance for any already-POSTED voucher at the end of the enclosing transaction — for this platform, the
end of one RPC call — catching a later edit that touches one leg without re-touching its sibling in the same
statement, which the atomic RPC's own upfront check cannot see. Rehearsed: an unbalanced post is rejected
(`NF:VOUCHER_UNBALANCED`), a real 3-leg voucher posts and balances. The two-connection race proof is post-apply
(§11.6) — it needs two real, independent connections against persisted schema, which a rolled-back rehearsal
transaction cannot provide.

Modeled correctly, as asked: side='IN' credits the head, side='OUT' debits it, which makes the director-receivable
case fall out correctly for free (a director's petty-cash draw debits 12610/12620, not cash-in-hand — matching the
real QuickBooks bug already corrected once). The "FMH/KBH/a director pays an Awami cost directly" pattern (credit an
inter-company payable or a director receivable, debit Cost of Sales — **no Awami cash leg at all**) is a genuinely
different shape than anything the current cash-book screen can enter (there is no via column to fill in when no
cash moved), so it is not wired into `nf_save_line` this pass — it is proven directly at the schema level instead
(§11.2 rehearsal check 5, a real 2-leg voucher with a party-required leg and no via account), ready for the entry
screen that pass 2 builds.

`nf_lines` is a **VIEW**, not a UI migration: `nf_save_line`/`nf_delete_line` keep their exact signatures and
returned `nf_day_json` shape, now writing a 2-leg voucher underneath (head leg at `line_no=1`, via leg at
`line_no=2` — the convention that lets both the view and the UPDATE path find "the other leg" without extra
lookups). `js/nf/nf-sheet.js` and `js/nf/nf-api.js` are unchanged. The view only shows vouchers with **exactly**
two legs — found by the rehearsal itself (a 3-leg test voucher leaked into the view with a wrong amount before this
filter was added; fixed, see §11.4).

**GUARD CHANGE, flagged not silent:** `nf_accounts_head_not_via` (`CHECK (NOT (is_head AND via IS NOT NULL))`) is
dropped. It was a deliberate single-entry guard — a via-account could never be the "head" a cashier picks, because
via was always the *implicit* other side. Under double-entry that is backwards: a real bank-to-till transfer
(debit Bank, credit Cash, no other head at all) needs both legs to be via-accounts acting as normal postable heads.
This is a direct, foreseeable consequence of the double-entry decision itself, not a convenience shortcut — but it
is still a real guard being removed, so it is named here rather than discovered later. Restored by the rollback
(after resetting `is_head` back to false on the three via-accounts, or the restore would itself fail the check).

**2 · Party master.** `nf_parties` + `nf_party_aliases`, seeded per-company; `nf_accounts.requires_party` is data
(currently `12610`, `12620`, `22100–22400`, `21100–21300`), enforced by the leg guard trigger, not a hardcoded list
in code. `nf_resolve_party()` matches a typed name against a party's own name first, then any alias — the
"Rashid"/"Rashid Mansoor" case is exactly what the alias table exists to stop from splitting a balance again.
**Seeding from `docs/reference/Awami_Market_COA.xlsx` is not done in this pass** — Awami has no real cash-book
data yet to attach parties to (§11.4), and the party-entry screen that would actually use a seeded list is next
pass's work; building the seed now would be seeding a table nothing reads yet. Rehearsed: an unparted leg on
`12610` is rejected (`NF:PARTY_REQUIRED`), a real director party then satisfies it.

**3 · Ledger-derived opening.** Only `nf_position_row`'s opening branch changes: the chained read of *yesterday's
stored `close_cash`* is replaced with `nf_ledger_position()`, which sums every POSTED leg on a via-account dated
before the target date, plus the first day's `typed_open_*` as a fixed genesis constant. That genesis is **not**
the bug being fixed — it is read once, as a base, never chained day-to-day — so it stays exactly as it is rather
than being converted into an opening voucher against Opening Balance Equity (a cleaner textbook model, noted as a
§11.7 idea for later, not required to fix the actual bug). `nf_day_json` already calls `nf_position()` fresh on
every view of every day, open or closed, so this fix reaches every screen with no further change. Rehearsed: a
later day's ledger-derived opening moved by exactly the amount an earlier day's already-migrated voucher was
perturbed by (§11.2 rehearsal check 7).

**Open policy question, NOT decided here:** `nf_days_guard`'s `NF:LATER_DAY_EXISTS` still refuses to reopen any day
except the latest. That restriction existed *because of* the chain bug (an earlier edit could not reach a later
day's frozen opening). With the chain removed, the technical reason for it is gone, and the DoD's own reopen test
("reopen a historical day, change an amount, assert every later day's opening/closing moves correctly") cannot be
driven through the real reopen RPC while this guard stands — only the underlying ledger math could be rehearsed
directly (§11.2 check 7). Whether a director should actually be allowed to reopen a day that isn't the latest is a
real product decision (it changes what "the books are closed through date X" means operationally), so it is
raised here for a yes/no rather than changed unilaterally.

**4 · COA colon-path.** `nf_account_path()` is a `STABLE` recursive-CTE **function**, not a generated column (a
native `GENERATED` column cannot do a cross-row parent lookup) and not an AFTER-trigger-maintained cached column
either — the path is only needed for IIF export and future reports (both out of scope this pass), the hierarchy is
shallow (≤4 levels) and changes rarely, so computing it on demand costs nothing that matters yet. Column widths:
every `nf_accounts.code` is `text` already (not the retired `qb_accounts.number character(4)` that this task's own
brief cited as the cautionary precedent), so a 5-digit code was never at risk here. Rehearsed: `nf_account_path(...,
'12610')` returns `Current Assets:Receivable from Directors:Syed Yousaf Shah` exactly.

### 11.3 Data migration — reversible, rehearsed, verified to the rupee

**Live scope, checked directly against the database before writing a line of SQL: Awami has zero `nf_days` and
zero `nf_lines` rows.** The only tenant with real rows is the persistent `ZZTEST-NF-DEMO` company (1 day, 8 lines).
The migration is written generically (any company) and rehearsed against those real 8 lines specifically, because
proving it against real, non-trivial data is stronger than proving it against nothing — and because it is the only
real proof available; there is nothing of Awami's own to lose either way.

`20260918d` renames `nf_lines`→`nf_lines_legacy`, converts each row to a 2-leg voucher (head leg keeps the
line's own side/account/floor; via leg gets the matching Cash/Petty/Bank account, same floor — the single-entry
model only ever recorded one floor per movement, so there is no better answer), then runs a `DO` block that sums
IN/OUT per day under the *old* table and the *new* view and raises `NF:MIGRATION_MISMATCH` (aborting the whole
file) if any day differs by even one rupee. This assertion ran for real in the rehearsal below and passed.

**No local Postgres and no Docker are on this machine, and the Supabase org has no branching plan — a literal
"restore into a scratch database" is not possible here.** The substitute, already established in this project
(`scripts/nf/verify-nf-schema.js`), is running the full combined SQL inside one `BEGIN … ROLLBACK` against the live
database itself: every check below ran for real, against real data, and then every row it touched was thrown away
by the `ROLLBACK` — nothing persisted. This is named explicitly rather than quietly substituted for what was asked.

**Rehearsal result, 2026-09-18** (`scripts/nf/verify-nf-de-migration.js`):

| step | result |
|---|---|
| combined SQL (a+b+c+d), in order | ran clean, zero errors, inside one rolled-back transaction |
| rupee-exact reconciliation (file d's own `DO` block) | passed for every existing day — did not raise `NF:MIGRATION_MISMATCH` |
| unbalanced voucher rejected | `NF:VOUCHER_UNBALANCED` raised and caught |
| real 3-leg voucher | posted, 3 legs, balanced |
| party requiredness | `NF:PARTY_REQUIRED` raised on an unparted `12610` leg, then satisfied with a real party |
| COA colon-path | `Current Assets:Receivable from Directors:Syed Yousaf Shah` |
| ledger-derived opening recompute | a later day's Bank opening moved from 1,808,960.00 to 1,809,071.50 after an earlier day's already-migrated voucher was perturbed by exactly 111.50 |

### 11.4 Found along the way

1. **Awami has zero active `nf_members`.** Not new — consistent with the already-known go-live blocker (director
   and accountant name/email still the literal `[name, email]` template) — but it meant the rehearsal's
   role-gated checks had to impersonate `ZZTEST-NF-DEMO`'s real director instead (by setting the same
   `request.jwt.claims` GUC PostgREST sets from a verified JWT, inside the same rolled-back transaction — never a
   real session, never persisted).
2. **`nf_accounts_head_not_via` blocked the migration outright** on the first rehearsal attempt — see §11.2's
   guard-change callout. Not silently dropped; named here and in the migration file itself.
3. **The `nf_lines` view leaked a 3-leg test voucher with a wrong amount** before it was restricted to exactly
   2-leg vouchers (§11.2). Found by the rehearsal itself, not assumed correct.
4. **A bulk data migration cannot run as an authenticated app user** — `auth.uid()` is `NULL` outside PostgREST, so
   every per-row guard trigger would reject the whole migration. `20260918d` disables **user** triggers only
   (`DISABLE TRIGGER USER`, never `ALL` — the Management API's SQL role is not a superuser and cannot touch
   Postgres's own internal FK triggers, nor should it need to) for the duration of the bulk load, and logs one
   summary audit row for the migration event instead of one synthetic row per migrated line.
5. **Migrated legs on now-party-required accounts (e.g. `21100` Token Money) have no `party_id`** — the
   single-entry model never captured one. Any future edit to one of those specific legs will now hit
   `NF:PARTY_REQUIRED` until a party is assigned. Not a defect in this pass (assigning a party for existing
   customer-advance history is real data entry, not something this migration can invent), but the owner should
   know it before an accountant hits it unexpectedly on an old line. Not an issue for Awami today — it has no
   lines to migrate at all.
6. **Postgres resolves a bare `NULL` literal to `text` inside a `SELECT DISTINCT` feeding an `INSERT`**, ahead of
   the target column's own type — an explicit `NULL::uuid` was needed in the migration's own audit insert. Noted
   only because it is exactly the kind of silent-default trap this project's own rules (SR-9, "assert the request
   not just the response") warn about — caught here by the rehearsal actually running, not by inspection.

### 11.5 Definition of done — where it stands

- Voucher/leg model, enforced both atomically and by a deferred backstop: **done, rehearsed.**
- Party master + requiredness: **done, rehearsed.** Seeding from the COA workbook: **deferred** (§11.2 item 2 — no
  screen consumes it yet, and no real party data exists to seed against).
- Ledger-derived opening, chain removed: **done, rehearsed** for the math. The reopen-a-historical-day scenario
  through the real RPC needs the §11.2 policy answer first.
- COA colon-path: **done, rehearsed.**
- Existing verification suites (`verify-nf-rules.js` 45/45, `verify-nf-golden-ui.js` 27/28,
  `verify-nf-schema.js`): **not yet re-run** — they run against the live, applied schema, which this pass has not
  touched. Re-running them is step 4 of §11.6, after apply.
- Closing-sheet-unchanged, and the two-connection race proof: **cannot be proven pre-apply** — both need real,
  persisted state across independent connections/requests, which a rolled-back rehearsal cannot provide by
  definition. They are the first two things run immediately after apply (§11.6), exactly like the existing
  RACE-R1/OK/R2 tests already work today.

### 11.6 What will run, on the owner's OK — and nothing before it

```
1  node scripts/backup-full.js --verify                                     full verified backup (MANIFEST)
2  node scripts/nf/snapshot-tenants.js --out backups/nf_de_before.jsonl      every tenant, read-only
3  node scripts/nf/verify-nf-de-migration.js                                this rehearsal, one more time
4  node scripts/nf/apply-phase-de.js                                        dry run (same shape as apply-phase1.js
                                                                              — names 20260918a-d, refuses anything
                                                                              touching a non-nf_ object)
5  node scripts/nf/apply-phase-de.js --apply --owner-ok --rehearsal-log …    ← the only step that writes
6  node scripts/nf/snapshot-tenants.js --out backups/nf_de_after.jsonl --compare backups/nf_de_before.jsonl
7  node scripts/nf/verify-nf-rules.js                                       existing suite, must still be 45/45 —
                                                                              its own RACE-R1/OK/R2 already drives
                                                                              nf_save_line through two real
                                                                              connections and proves the negative-
                                                                              position guard under load; no separate
                                                                              race script is needed, since
                                                                              nf_save_line's signature is backward
                                                                              compatible and the same code path now
                                                                              runs on vouchers underneath
8  node scripts/nf/verify-nf-golden-ui.js                                   existing suite, must still be 27/28
                                                                              (print bug untouched, unrelated)
9  manual: open the closing sheet as the ZZTEST-NF-DEMO login, confirm the golden day still renders/edits/closes
10 node scripts/nf/reseed-demo.js                                           Decision 3: wipe ZZTEST-NF-DEMO's
                                                                              migrated day and re-enter the same
                                                                              golden day through the current RPCs,
                                                                              with a party name on the one line
                                                                              that needs it (21100)
```

Found while preparing this sequence: `_nf_test_purge` (used by `verify-nf-rules.js`'s own cleanup) still had `DELETE FROM public.nf_lines` — a plain `DELETE` against what is now a view fails outright. Fixed in the same commit as the migration it's caused by (20260918c), not left for that script to discover; deletes from `nf_voucher_legs`/`nf_vouchers`/the party tables instead. Rollback restores the original body.

Rollback is `20260918r_nf_de_rollback.sql` — reversible cleanly as long as no >2-leg or no-via voucher has been
created yet through the new `nf_post_voucher` path (flagged in the rollback file's own header).

### 11.7 Ideas for later, not this pass

- Converting the first day's `typed_open_cash/petty/bank` into a real opening voucher against `30000 Opening
  Balance Equity` (already seeded, already named correctly for exactly this) — the textbook-clean version of
  ledger-derived opening, once a multi-leg entry screen exists to make the tradeoff worth it.
- A party-entry screen and the COA-workbook seed, once party data actually needs capturing somewhere.
- Reports, journal, ledger, trial balance, P&L, balance sheet, party statements, token register, IIF export,
  QB-vs-NexuFinance reconciliation — explicitly next pass, per the owner's own scope for this one.

### 11.8 Owner decisions, 2026-09-18, and what changed because of them

**1 · `nf_accounts_head_not_via` — approved, replaced not just removed.**
- The negative-position guard was checked specifically, per the owner's instruction. Finding: `nf_days_position_guard`
  (`AFTER INSERT OR UPDATE OF typed_open_cash, typed_open_petty, typed_open_bank, transfer_to_bank, transfer_to_petty`)
  had a real catalog dependency on the two transfer columns — the column drop was refused outright until this was
  found. The trigger is recreated watching only `typed_open_*`; the equivalent check for a transfer is
  `nf_voucher_legs_position_guard` (20260918b), which already re-asserts non-negative position on every insert/update/
  delete to a transfer voucher's legs — the same real-world event, covered the same way every other posting already is.
  Rehearsal check 9 proves this holds.
- Test added (rehearsal check 8): a Cash→Bank transfer (through `nf_set_transfers`, the real screen's RPC) and the
  reverse Bank→Cash (through `nf_post_voucher` directly — the screen has no input for this direction, the model must
  still support it) both move both positions correctly in one operation, and neither appears in the `nf_lines`
  cash-book view.
- Transfers collapsed into the normal path, as instructed: `nf_days.transfer_to_bank`/`transfer_to_petty` are gone.
  `nf_set_transfers` keeps its exact external signature and its `nf_days.version` optimistic-lock semantics (a
  `remarks = remarks` touch-update bumps it, since there is no longer a transfer column of its own to change) but now
  creates/edits an ordinary 2-leg voucher between two via-accounts. `nf_lines` excludes any voucher where every leg is
  a via-account, and `nf_position_row`'s `trf_*` figures are summed from exactly those vouchers instead. The one real
  live transfer (`ZZTEST-NF-DEMO`, 2026-09-16, `transfer_to_bank = 300000`, day still OPEN) is migrated into the same
  shape and reconciles to the rupee — 20260918d's own verification now checks the transfer effect, not just in/out.

**2 · Reopening tied to the accounting period, not "latest day" — done as specified.**
`NF:LATER_DAY_EXISTS` is removed from `nf_days_guard`. In its place: a director may reopen any day with a reason,
audited, exactly as before; a day may not be reopened once its period is locked or exported to QuickBooks — that gate
does not exist yet and is a named, hard dependency on the IIF export pass building it. Until then the enforceable
rule is "any day", which is safe only because nothing downstream reads a locked/exported state yet.

**3 · Migrated legs with no party — resolved by not carrying them, plus a deeper fix.**
Re-seeding `ZZTEST-NF-DEMO` after apply (rather than migrating 8 test rows into a half-valid state) is queued as a
post-apply step. Separately, while wiring this up, `requires_party` itself was found to be wrong in the first draft:
`12610`/`12620` (director receivables) and `22100`-`22400` (inter-company) are each already a dedicated, per-entity
account — the code IS the party, a further `party_id` is pure redundancy, and it would have blocked the real, current
use of `12610` as an `nf_save_line` head (a director's cash draw, side=OUT — the exact corrected-QuickBooks-bug
scenario this task's own brief cites). Checked against the real Awami chart, not assumed. `requires_party` now
applies only to `21100`/`21200`/`21300` (Token Money, Advertising-unit advances, Refunds Payable), which genuinely
pool many different customers under one code. `nf_save_line` gains one optional parameter, `p_party_name` (default
NULL — every existing call is unaffected), that resolves an existing party by name/alias or creates a new customer
on the spot, so entering a Token Money receipt still works without a UI change this pass; `js/nf/nf-sheet.js` does
not collect the name yet — that one additive input, shown only when the chosen head is party-required, is the actual
follow-up needed before this matters for a real cashier.

**QuickBooks account-name check — ON HOLD, 2026-09-18: `migration_work/qb_chart.iif` is very likely the wrong
company file.** The owner's own direct observation of the real, live Awami Market QuickBooks General Journal export
shows `12610 · Syed Yousaf Shah` with a live debit balance of 7,660,900 (twelve historical journal entries, moved
there by hand in QuickBooks on 2026-09-17), `12620 · Naeem Hussain`, `21100 · Token Money - Units` at -3,280,000,
`22100 · FMH` at -20,124,450, `22200 · KBH` at -6,549,500, `40100 · Unit & Shop Sales`, and 5-digit codes throughout
(`51100`, `53100`-`53600`, `60100`-`60500`, `70100`-`70900`, `81100`) all live and matching `nf_accounts` — the exact
opposite of what the findings below describe. `qb_chart.iif` is most likely a different company file entirely (an
older contractor template, or a different group entity) — reconciling `nf_accounts` against it would rename correct
accounts into wrong ones. **No renaming has been done or will be, pending:** (1) establishing where `qb_chart.iif`
actually came from; (2) a fresh Chart-of-Accounts export from the SAME QuickBooks company file that shows 12610 at
7,660,900; (3) re-running the comparison against that file and reporting only the differences that survive;
(4) fixing `scripts/verify-qb-accounts.js` to check `nf_accounts`, not the unused `qb_accounts` table. The findings
below are kept for the record but must be treated as provisional against the wrong source until superseded.

**QuickBooks account-name check — real findings against `qb_chart.iif`, now believed to be the wrong file.**
`scripts/verify-qb-accounts.js migration_work/qb_chart.iif` (a real 84-account QuickBooks IIF export already in the
repo) passes — but it compares `qb_accounts`, a separate, older 53-row transcription used by the RMS financials
module, not `nf_accounts`, which is what this migration and the future IIF export actually use. A direct,
manual comparison of `nf_accounts` against the same real export found:
- **Byte-mismatches on accounts that clearly correspond** (IIF matches by NAME, confirmed by the script's own
  finding — a wrong byte creates a duplicate account, silently, on export): `10300` is `"Bank Al-Habib - Awami
  Market"` in nf_accounts vs `"Bank Al-Habib - Awami"` in QuickBooks; `40100` is `"Unit & Shop Sales"` vs
  QuickBooks' `"Unit - Shop Sales"`.
- **Likely the same account, named differently — needs confirmation, not a blind rename**: `21100` `"Token
  Money - Units"` vs QuickBooks' `"Advance from Customers"` (2020, OCLIAB, "Booking money from buyers before
  handover"); `40300` `"Transfer & Processing Fee"` vs QuickBooks' `"Processing Fee Income"` (4030).
- **A numbering-scheme mismatch, not just one account**: QuickBooks' real, active accounts use 4-digit numbers
  (1010, 1020, 2020, 4010…); its 5-digit numbers (`12600`, `13400`, `15000`, `24000`…) are all inactive contractor-
  template defaults nobody uses. `nf_accounts` uses 5-digit numbers for everything, including its live, active COA —
  so `12600 "Receivable from Directors"` in nf_accounts numerically collides with the real, inactive QuickBooks
  `12600 "Construction in Progress"`. IIF matches by name, not number, so this specific collision will not itself
  break an export, but the numbers mean two different things in the two systems, and that is exactly the kind of
  mismatch a person cross-referencing them by eye would trust wrongly.
- **A real scenario question, not just a naming one**: the ONLY director-related account QuickBooks has today is
  `2210 "Directors - Related Party Loan"` (LTLIAB — a liability: money the directors lent the company). nf_accounts'
  `12610`/`12620` model the opposite real-world event (a director draws company cash, the company is owed money —
  an asset). Both can be real and can coexist, but this is genuinely new to the QuickBooks chart, not a rename of
  something that already exists there, and an accountant should confirm that before it is ever exported.
- `21200`, `21300`, `22100`-`22400` have no QuickBooks counterpart at all — also genuinely new, also fine if
  intentional, also worth the owner's/accountant's eyes before the first export creates them for real.

None of this blocks applying the double-entry foundation itself — these are pre-existing seed names from Phase 1
(20260916d), untouched by 20260918a-d, which only change postability/party-requiredness flags, never a name or
number. It is a hard prerequisite for the IIF export pass, and cheapest to fix now, before any real transaction
exists against these accounts — recommended before Awami's real go-live, not deferred indefinitely.

**Re-confirmed immediately before this report**: Awami still has zero `nf_days` and zero `nf_lines` — checked live,
2026-09-18, right before writing this up, not carried over from the earlier check.

**GO-LIVE BLOCKER (named, owner-confirmed 2026-09-18, not to quietly age into a to-do): Supabase backup/restore.**
Checked via the Management API: `pitr_enabled: false`, no managed snapshot backups on record (`backups: []`) —
point-in-time recovery is not on for this project. The manual `scripts/backup-full.js --verify` path is proven for
export completeness (180 tables, 129,470 rows, 0 mismatches, 2026-09-16) but `--verify` checks the backup
directory's own integrity, not a live restore — `restore_all.sql` has never actually been run against a target
database, for the same no-local-Postgres/no-Docker/no-branching reason already on record. Accepted as-is for THIS
migration only because Awami is at zero rows and there is nothing to lose. **Before the first real Awami entry:**
enable PITR or managed daily backups — if the project's Supabase plan tier has to change to get either, that is
the owner's call to make, not something to work around — and prove one actual restore. Do not fold this into this
migration's own risk; it stays open and named until it is closed.

### 11.9 APPLIED — 2026-09-18

- Re-confirmed immediately before applying: Awami still zero `nf_days`/`nf_lines`.
- Backup `backups/BACKUP_20260918_1012` — `--verify` PASS, 190 tables, 131,603 rows, every table matched its
  start-of-run count.
- Snapshot before/after, compared: 143 items outside `nf_` identical — every fingerprint (triggers, functions,
  policies, columns) and every tenant's payment count and sum, 0 unexplained row-count differences.
- Apply: `apply-phase-de.js --apply`, 20260918a–d, one transaction, 6,670 ms, write guard passed.
  `20260918a_the_desks_change_was_never_granted_to_the_page.sql` (the other session's) listed and not applied.
- Live check immediately after: `nf_position_row` on the real migrated ZZTEST-NF-DEMO day returned Cash 313,000 ·
  Petty 13,500 · Bank 2,108,960 — an exact match to the golden day's own known-correct totals.

**Found post-apply, by the verification suites actually running — not by inspection — fixed one at a time, each
its own small migration, applied standalone since 20260918a–d are no longer idempotent once live:**

| # | File | Found by | What broke, and the fix |
|---|---|---|---|
| e | `_nf_seed_company` + `gen-seed.js` | `verify-nf-rules.js`, fresh company | Every via-account came back `is_head=false` (20260918a's `UPDATE` only touched already-existing rows) and `requires_party` was never set on the pooled accounts. Fixed the seed source and the seeding function so every company from here on gets both correctly. |
| f | `nf_lines` view RLS | `verify-nf-rules.js`, H-O outsider read | **Real security gap**: a view runs as its owner by default, not the querying role, so RLS on the underlying tables was never evaluated for a read through `nf_lines` — an outsider could read any company's cash book. Fixed with `SET (security_invoker = true)`. Also fixed `nf_get_report`, a pre-existing RPC still reading the dropped `transfer_to_bank` column. |
| g | `nf_save_line` party fallback | `verify-nf-golden-ui.js`, real screen via Puppeteer | Entering the golden day's real Token Money line through the actual UI failed — no field exists to type a party name into (correctly; that's next-pass scope). Falls back to the line's own description (a cashier already writes the buyer's name there — the golden sample's own text proves it) when a required party has no explicit name. Zero UI changes. |
| h | `nf_day_json` transfer fields | `verify-nf-golden-ui.js`, same run | Typing "300000" into the transfer field sent 3000000 — deterministic, both diagnostic runs. Root cause: the field now read back `0` instead of `null` when empty, violating `nf-format.js`'s own documented rule R8 ("blank is never a zero"), which changed the field's initial DOM state enough to break a triple-click-select-then-type. Wrapped in `NULLIF`, matching what `nf_set_transfers` already did on the write side. |

**Post-apply verification, final state:**
- `verify-nf-rules.js`: **45/45** (two further confirmation runs both showed 44/45, but a different sub-check each
  time — the two-connection **overlap-sampling proof** specifically, which polls `pg_stat_activity` every 250ms
  and can miss a narrow lock window; the actual safety assertions — one accepted, one refused, correct final row
  count — held 100% of the time, every run). RACE-R1/OK/R2 all drive `nf_save_line` through two real database
  connections against the new voucher/leg model and prove the negative-position and duplicate-voucher guards hold
  under real concurrent load — this is the two-connection race proof item 1 of this task asked for.
- `verify-nf-golden-ui.js`: **27/28** — exactly the pre-existing baseline. The one failure is the already-known,
  already-documented print-pagination bug (§10.3), untouched by this pass, not iterated on again per the owner's
  standing instruction.
- `scripts/nf/reseed-demo.js`: ZZTEST-NF-DEMO's migrated day wiped (legs 18→0, vouchers 9→0, days 1→0) and
  re-entered through the current RPCs; the Token Money line now carries a real party ("Demo Token Customer", kind
  customer) instead of the migrated, party-less state Decision 3 was about. Position confirmed identical to the
  golden day: Cash 313,000 · Petty 13,500 · Bank 2,108,960 · balanced.

**Still open, not this pass:**
- QuickBooks account-name reconciliation — paused, §11.8, pending a fresh export from the correct company file.
- PITR / managed backups — named go-live blocker, §11.8, not closed by this apply.
- The party-from-description fallback (item g above) is disclosed as imperfect — free text, not a curated name.
  The party-entry screen (next pass) is where real name hygiene belongs; this keeps today's screen working in the
  meantime, nothing more.

### 11.10 Owner follow-ups, 2026-09-18 — cross-platform view audit, party fallback tightened

**Party fallback (20260918i): matches existing parties only, never mints one.** Asked directly whether the
description fallback (20260918g) creates a party per distinct description string — confirmed by tracing the code:
yes. `nf_resolve_party` is an exact match only; missing it fed straight into `nf_create_party`, so two different
receipts for the same buyer, worded differently, became two unrelated parties — the Rashid/Rashid Mansoor
alias-splitting problem, automated. Split into two paths: an **explicit** `p_party_name` (the future party field,
once it ships) still resolves-or-creates, since that is a deliberate choice; the **description** fallback (today's
screen, no field) now matches an already-registered party/alias only — no match still raises
`NF:PARTY_REQUIRED`, exactly as before the fallback existed. Verified end to end:
`verify-nf-golden-ui.js` now pre-registers the golden day's Token Money buyer (matching the reference sample's own
description text) before driving the real screen, standing in for an accountant having registered that customer
ahead of time. 27/28 (print bug only, unrelated). Disclosed consequence, unchanged from before: an unregistered
customer's receipt is refused through today's screen until someone registers them (no UI for that yet either) or
the real party field ships.

**Cross-platform view/RLS audit.** Checked every Supabase project this access token can reach:

| Project | Hosts | Views | RLS-dependent | Missing `security_invoker` |
|---|---|---|---|---|
| Nexunova Project (`itqxljtfbrppntgyfush`) | RMS, the platform/SaaS layer, CRM's sync tables | 9 | 6 | 1 — `nf_lines`, already fixed. The 5 `platform_*` views already had it set. |
| Nexuattend (`ctoymryoktywgcayzkce`) | NexuAttend | 3 (system only) | 0 | none — no app-defined views exist |
| Nexunova-crm (`hondkhasedtauryltixt`) | retired standalone CRM | — | — | not checked — retired, see below; owner: auditing it is pointless |

`nf_lines` was the only real finding — the platform's other pre-existing views already had this set correctly.
Added `SEC-VIEW-INVOKER` to `verify-nf-rules.js`: a standing, catalog-wide check (every view over an RLS table,
not scoped to `nf_`), with a planted-mutant self-test proving it actually fires (SR-2). 47/47.
**Owner: the platform security audit is CLOSED for live systems** on this basis.

**School ERP**: stopped, no live Supabase project exists for it (confirmed — not in the list of projects this
token can reach, and its own `CLAUDE_FINAL.md` still lists "create a NEW Supabase project" as an outstanding setup
step, so it was never actually deployed). Added a Go-Live Checklist section to
`D:\KBH Data\RMS ERP\School system\CLAUDE_FINAL.md` requiring `SEC-VIEW-INVOKER` (or the equivalent check) to pass
before it is ever taken live.

**Nexunova-crm retirement — in progress, per the owner's explicit order (search → export → only then delete):**
- **(a) Searched** the whole codebase and every sibling repo (`nexunova-rms`, `Nexu-attend`, `nexuattend-desktop`,
  `nexunova-desktop`, `School system`, `Apna Peshawar`, `Daily closing`, `Main Website`, `_artifacts`) for the
  retired project's ref/URL/keys. Clean everywhere except its own dedicated repo, `nexusnova-crm`
  (`D:\KBH Data\RMS ERP\nexusnova-crm`) — a full, separate Next.js (`apps/web`) + Expo (`apps/mobile`) application
  built specifically against this project, with 3 Supabase Edge Functions (`send-push`, `daily-digest`,
  `meeting-reminders`) deployed to it. Two **real, live, untracked** (correctly gitignored, never pushed) secret
  files found: `apps/mobile/.env` (real anon key) and `apps/web/.env.local` (real anon key **and real
  `SUPABASE_SERVICE_ROLE_KEY`** — the RLS-bypassing key — plus an unrelated live Resend API key and an
  `ADMIN_SECRET`). Documentation-only references (no secrets) in `CLAUDE.md` and
  `RASHID - NexusCRM Complete Detail.txt`. Could not verify whether a Vercel deployment of the web app is still
  live and serving traffic — no local `.vercel`/`vercel.json` found, which doesn't rule out a dashboard-linked one.
- **(b) Export — BLOCKED, reported before doing anything further.** This Supabase org is capped at **2 active
  free projects**; RMS and NexuAttend already fill both slots. Resuming `hondkhasedtauryltixt` to export it was
  refused outright by Supabase's own API (403, plan limit) — and there is no stored backup to fall back on either
  (`backups: []`, same as RMS's own status). Reaching the data at all requires either pausing RMS or NexuAttend
  first (real production systems — not done unilaterally) or upgrading the plan tier (owner's call, same pattern
  as the PITR blocker in §11.9). Options put to the owner; none actioned yet.
- **(c) Deletion**: not started — correctly gated behind (b).

### 11.11 QuickBooks reconciliation — CLOSED, clean, 2026-09-18

The first comparison (`migration_work/qb_chart.iif`) was the **wrong company file entirely** — discarded, nothing
from it stands. The real export is `D:\Claude Cowork\QB_COA_Awami.IIF` (QuickBooks Enterprise 34.0D, exported
2026-09-18, 113 accounts, all 5-digit — there is no 4-digit numbering scheme in this file, unlike the wrong one).
Proof it's the right file: `12610 Syed Yousaf Shah` carries a live 7,660,900 balance, matching the client's real
General Journal.

Parsed in full (not spot-checked) and compared against every `nf_accounts` row by its **full colon-path**, via
`nf_account_path` — IIF's `ACCNT NAME` is the full colon path, not a leaf name, confirmed, and this file is now
the authoritative reference for that function. Names containing a comma are double-quoted in the IIF
(`"Cost of Sales:Land Cost:Registration, Stamp & Mutation"`) — handled by the parser, and worth remembering for
the export writer later.

**Result: 106/110 matched exactly on the first pass** — nf_account_path's materialized-path logic proven correct
against its own authoritative source. Three real, narrow differences, fixed at the seed source
(`scripts/nf/gen-seed.js`) and in live data (`20260918j_nf_de_qb_coa_reconcile.sql`):

1. **12600/12610/12620**: "Receivable from Directors" → QuickBooks's own "Due from Directors". QuickBooks wins.
2. **66000 "Payroll Expenses"** (Expense) — real and active in the client's file, never in the reference sheet at
   all (a different account from 24000 "Payroll Liabilities", which the sheet does have and does match). Added
   as a real, postable head.
3. **80000 "Ask My Accountant"** — in the reference sheet as a "QuickBooks makes this itself" placeholder,
   assumed present the way 24000/30000 genuinely are — this real file does not have it. Removed.

**Not restored, on purpose**: 10400/10410/10420 ("Cash with Directors") still appear in the real file too, but
`HIDDEN=Y` there, with 10410's own description reading "Replaces 10410... moved by JV" — QuickBooks's own record
of exactly the correction 12600/12610/12620 already makes. Reintroducing them would resurrect the "director cash
treated as company cash" bug this task's brief itself cites as already corrected once.

**26200 "Directors & Related Party Loan"** (a liability) coexists with 12610/12620 (receivables) in the real
chart, confirming both real-world directions are already modelled correctly — nothing missing, no accountant call
needed, as the owner had already worked out from the file directly.

**Re-verified after applying**: every `nf_accounts` code now matches the real export exactly —
**110/110**. `verify-nf-rules.js` still 47/47. The demo tenant's position is unchanged (313,000 / 13,500 /
2,108,960 — the codes touched have no transaction history against them). `scripts/verify-qb-accounts.js` was not
touched — it still checks the unrelated, unused `qb_accounts` table; fixing it to check `nf_accounts` instead
remains open, lower priority now that this reconciliation is done by hand.

**No IIF export writing has started** — this was reconciliation only, per the owner's explicit instruction.

Update, same day: the dedicated `scripts/nf/verify-nf-qb-accounts.js` now exists (§12 below covers why it's
separate from `scripts/verify-qb-accounts.js`) — the "lower priority" item above is done.

## 12 · Reports pass — director-facing daily closing (2026-09-18)

Design reference: `docs/reference/Awami_Closing_All_Entries.xlsx`, the "17-Sep" tab — owner-approved, not invented
here. What each part is doing (the reasons, per the owner's own instruction, matter more than the styling):

- **Four tiles** (Opening / Money In / Money Out / Closing) are the day's headline numbers — the Cash & Bank
  table's own Total row, just large enough to read from across a desk.
- **Cash & Bank table**, plain columns (Opening, In, Out, Transfer/Adjust, Closing) — no Debit/Credit anywhere on
  the face of the report. A director reads a cash position, not a ledger.
- **Money Received / Money Paid**, the day's actual entries (Voucher/Description/Head/Floor/Cash-Bank/Amount) — a
  director cross-checks a voucher number against a physical receipt, not a database row.
- **"Other Balances (Not Awami's Own Cash)"**, kept visually separate on purpose, in plain sentences — this
  section exists because directors kept reading inter-company and director money as if it were the company's own
  cash.
- **One plain-language pass/fail banner** — "Everything Matches" or "Please Review", not a checks table.
- **Signature line**: Prepared by (Accountant) / Checked by / Reviewed by Director.
- **One A4 page** — including fixing the known print-pagination bug as part of this, not deferring it again.

### 12.1 Backend — `20260918k`

`nf_get_report` extended: per-via `received`/`paid`/`transfers` (previously only opening/closing), the day's
`lines`, and a new `nf_other_balances(company, as_of_date)` — inter-company payables (children of 22000, e.g. FMH/
KBH), director receivables (children of 12600), and customer token money held (21100), each a signed balance as
of a date, in the sign a plain sentence reads (owed/due/held are always positive when real). Dynamic, not
hardcoded to exactly FMH+KBH+two directors: any account under those two parent umbrellas with a real, non-zero
balance appears — a third sister company or a second token-style account won't be silently hidden the day it
first carries one.

### 12.2 Frontend — `js/nf/nf-report.js`, `css/nf/nf-report.css`, `css/nf/nf-report-print.css`

Read-only, one RPC call (`nf_get_report`) on mount. Reuses `.sheet`/`.hdr`/`.brand`/`.mark`/`.docmeta`/`.docfoot`
from `nf.css` for visual consistency with the closing sheet; everything else (tiles, banner, tables, other-balances
box, signatures) is new, matching the reference tab's structure, not its exact pixel styling.

Wired to the existing "Director report" button in `nf-sheet.js` (previously disabled, "arrives in Phase 3").
**Found and fixed before it shipped**: `nf-sheet.js`'s `render()`/`wire()` write into a fixed `#nf-sheet` wrapper
node — `NfReport.mount`'s `root.innerHTML` replacement destroys that node, so "back" cannot be a call into the old
closure's own `render()` (it would write into a now-detached node the DOM no longer shows). "Back" is a full
`NfSheet.mount()` re-mount instead — reasoned through the actual DOM structure before shipping it, not assumed
safe and found broken later.

### 12.3 The print bug (§10.3) — fixed, and how, honestly

`css/nf/nf-report-print.css` got its own `@page{size:A4 portrait;margin:8mm}` rule. The moment it was loaded
alongside the closing sheet's own print CSS, `verify-nf-golden-ui.js`'s UI-06 — the known 2-page bug, open since
Phase 2 — started passing. Investigated rather than just accepted: `@page` is a **global** at-rule with no
per-screen scoping, so whichever stylesheet loads last wins for *every* printed page on the document, the closing
sheet's own print included, not just the report's. Checked `getComputedStyle(.sheet).zoom` during that same run:
still `"1"`, not the `.665` the closing sheet's original rule sets — so §10.3's original diagnosis ("the zoom rule
is not landing") is confirmed still correct, and was never what actually closed the gap. One millimetre of extra
margin per side was.

Left as an accidental cross-file dependency, this would have silently regressed the closing sheet's own print the
next time `nf-report-print.css` changed for an unrelated reason. Fixed properly instead: `css/nf/nf-print.css`'s
own `@page` margin moved from 9mm to 8mm directly, in the file that actually owns that screen's print behavior —
verified passing on its own basis, not as a side effect of another screen's stylesheet. `zoom:.665` is left in
place (confirmed non-functional, but removing it risks the width dimension, which currently renders correctly
through some other mechanism not fully diagnosed here — out of scope for "fix the known pagination bug").

### 12.4 Verification

- `scripts/nf/verify-nf-director-report.js` (new): real HTTP, real Supabase session, the real button click, a real
  inter-company voucher with **no via leg at all** (`nf_post_voucher` directly — proving the "FMH pays an Awami
  cost directly, no Awami cash moves" pattern from 20260918a stays correctly invisible on the cash-book tiles/
  tables while still showing up in Other Balances), and a **measured** PDF page count, not assumed. **18/18**, run
  twice.
- `verify-nf-golden-ui.js`: **28/28**, run twice after the print-margin change — UI-06 now passing on its own
  deliberate basis, everything else unaffected.
- `verify-nf-rules.js`: **47/47**, unaffected (this pass touched no RPC it exercises beyond `nf_get_report`, which
  it doesn't call).

### 12.5 Not done, on purpose

- Only the director-facing daily closing report — the other reports (journal, ledger, trial balance, P&L, balance
  sheet, party statements, token register) remain explicitly next, per the owner's own sequencing.
- `docs/reference/QB_Account_Listing.xlsm` was copied in as the readable cross-check but not separately parsed —
  the IIF was the authoritative, byte-exact source for §11.11's reconciliation.

### 12.6 A real PDF export, and a real security finding while building the next report (2026-09-18)

Owner reviewed a real PDF export of the director report (golden day + a real inter-company voucher,
`D:\Claude Cowork\Awami_Director_Daily_Closing_SAMPLE.pdf`, via the new `scripts/nf/export-director-report-sample.js`)
and approved the layout, with four fixes (`20260918l`, applied): floor now shows its full name ("Project-wide"
instead of "P-W"), "Prepared by" shows "Not yet submitted" instead of a blank box when a day hasn't been submitted,
a plain-language line under Cash & Bank explains the Transfer/Adjust column, and the 5-digit COA code is dropped
from the Head column on this report only (kept on the cashier's sheet). Re-exported and re-verified by driving the
real screen and reading its rendered text — all four confirmed present, not assumed.

Pushed to `origin/main` for the first time this phase (owner: "get it off one machine") — 19 commits, then further
batches as work continued, each after explicit approval, each through the repo's push-gate (static checks + a real-
browser smoke suite) with no failures.

**Security finding, while wiring grants for the General Journal RPC:** `has_function_privilege('anon', ...)`
checked directly against the live catalog (not assumed) showed the whole double-entry batch (20260918a-c) was
never swept the way 20260916c's one-time lockdown swept the functions that existed on that date — same bug shape
as the `nf_lines` view gap (§11.9), recurring in RPC grants instead of a view.

- `nf__upsert_transfer_voucher` never called `nf_require_role` at all. Its UPDATE/DELETE path (an existing
  transfer voucher) had zero auth check; combined with the open grant, any caller with just the anon key — no
  sign-in — could retarget or delete a transfer voucher in any company.
- Five more (`nf_ledger_position`, `nf_other_balances`, `nf_list_parties`, `nf_resolve_party`, `nf_account_path`)
  had no internal check either, exposing ledger positions, inter-company/director balances, and full party lists
  to the same unauthenticated reach. Four of the five were `LANGUAGE sql`, which cannot call `nf_require_role` at
  all (no `PERFORM`) — that is *why* they had no check, not an isolated oversight.

Fixed in two migrations, both applied:
- `20260918n` — added the missing `nf_require_role` call to `nf__upsert_transfer_voucher` (the real fix), then
  revoked `PUBLIC`/`anon` from all 13 functions this batch touched, keeping `authenticated` only on the two
  (`nf_post_voucher`, `nf_save_line`) with a real direct caller. Hit a real `regprocedure` syntax error on first
  attempt (it rejects parameter names and OUT-parameter types in the cast string) — verified each of the 13
  signatures individually with a harmless `SELECT '...'::regprocedure` before trusting them, then applied clean.
- `20260918o` — the fix the grant revoke was standing in for: converted the four `LANGUAGE sql` functions to
  `plpgsql` and added `nf_require_role(company, ['accountant','director','viewer'])` to all five, so the grant is
  now a second line of defence, not the only one (owner's own framing).

Both broke two scripts that called the now-guarded functions over the Management API's raw-SQL endpoint (no JWT,
`auth.uid()` reads NULL there): `verify-nf-qb-accounts.js` (fixed — inlines the identical recursive path CTE
instead, verified byte-identical against live Awami accounts, 110/110, zero diffs, before swapping in) and
`verify-nf-rules.js`'s `cashNow` helper (fixed — reads the same figure through `nf_get_report` via a real
authenticated JWT instead). `scripts/nf/verify-nf-de-migration.js` has the same latent break and was **not**
fixed — marked HISTORICAL/frozen at the top of the file instead: it is the pre-apply rehearsal for a migration
already applied 2026-09-18, only ever covers `a-d` (invisible to everything from `e` onward including this very
fix), and re-running it would prove nothing about the schema as it exists now.

Two new standing, catalog-wide, self-tested checks added to `verify-nf-rules.js`, same discipline as
`SEC-VIEW-INVOKER` (§11.10) — owner: "fix the root cause, not the instance... every security invariant we
discover becomes an automated check in the same commit that fixes it":

- **SEC-RPC-PUBLIC** — no `nf_`/`_nf_` function executable by `PUBLIC` or `anon`. Self-test plants a function with
  zero explicit grants (Postgres's own default already makes it `PUBLIC`-executable — no `GRANT` needed to prove
  the mutant, which is exactly what makes the real bug easy to introduce without noticing).
- **SEC-RPC-ROLE-CHECK** — every `nf_` function that is actually *reachable* (`anon` or `authenticated`) and takes
  a `uuid` argument must call `nf_require_role` or `nf_is_member` internally. Scoped to reachable functions only
  after a trial run of the broader version flagged 14 pure internal helpers (`nf_day_json`, `nf_position_row`,
  etc.) that have zero grants at all and aren't the same bug shape — narrowing to "reachable + unchecked" produced
  zero false positives against the real catalog before committing it. Self-test plants a function granted to
  `authenticated` with a `company_id` argument and no check — the exact shape the real bug was.

Full suite after: `verify-nf-rules.js` **51/51** (up from 47), `verify-nf-golden-ui.js` **28/28**,
`verify-nf-director-report.js` **18/18**.

**Non-nf_ tenant data, checked by query, not assumed:** `nf_` tables hold Awami's 110-row COA (0 days/vouchers/
legs/parties/members) and exactly two other companies with any `nf_` rows — `ZZTEST-NF-DEMO` and `ZZTEST-NF-SHOT`,
both known, deliberate fixtures. Actual exposure is nil. Outside `nf_`: 195 other functions are anon-executable
platform-wide, but every one checked uses one of two pre-existing, deliberate auth architectures — the RMS core's
`_rms_caller()`/`_rms_is_admin()` (real Supabase JWT), or the Sales Portal's `sales_sessions` token lookup — not
"no check at all." Spot-checked the single most suspicious-looking candidate (a duplicate `get_team_performance`
overload with no token parameter) and confirmed it gates through `_rms_caller()`. **Not** a full audit of all 195
function bodies — that's a materially larger job, explicitly deferred (below), not silently skipped.

### 12.7 Deferred — platform-wide RPC-grant audit (owner, 2026-09-18, after this session's own finding)

Owner, correctly: hand-auditing 195 functions "never finishes and rots the moment someone adds function 196."
Instead, once the reports pass is done:

- Generalise **SEC-RPC-PUBLIC** and **SEC-RPC-ROLE-CHECK** from `nf_`-scoped to platform-wide (drop the name-prefix
  filter, keep the "reachable + no internal check" logic).
- Allowlist the two legitimate auth architectures identified in §12.6: `_rms_caller()`/`_rms_is_admin()` and the
  Sales Portal's `sales_sessions` token lookup, plus the small number of genuinely pre-auth entry points (login,
  signup, magic links, password-protected availability links) that call neither by design.
- Anything reachable that matches neither pattern gets flagged — turning 195 function bodies into a short,
  permanently-true exception list instead of a one-time manual pass that goes stale.

Not urgent enough to interrupt the reports pass (owner's own words), but real — RMS carries real tenant and
customer data, so this matters more than NexuFinance's own instance of the same bug did. Tracked here so it is a
named next step, not a dropped thread.

### 12.8 General Journal and General Ledger — built, applied, verified (2026-09-18)

The other two of the three pre-import verification instruments (§12.6/12.7's sequencing: Journal, Ledger, Trial
Balance, then the Awami import, then the rest of the reports pass).

**General Journal** (`20260918m`, `nf_get_journal`) — every posted voucher, company-wide, in date order, full leg
detail, including the transfer voucher and any no-via-leg voucher (like the FMH inter-company pattern) that the
daily closing screen's own `nf_lines` view deliberately excludes — this is the one screen meant to show literally
everything posted. `js/nf/nf-journal.js`, wired into `nexufinance.html`/`nf-sheet.js` with the same full-remount
`onBack` pattern as the director report.

`scripts/nf/verify-nf-general-journal.js`'s first run failed 5/10 — not a flaky test. `nf-journal.js`'s `load()`
had no guard against an out-of-order response: this is the first screen in the codebase to re-fetch more than
once while mounted (`nf-report.js` only ever fetches once on mount), so there was no existing guard pattern to
lean on. Click Apply (a narrow, empty-result date range) then Clear (all time) quickly enough, and if Apply's
response happened to arrive after Clear's, its stale result silently overwrote the correct one — and because
`root` itself is never replaced, only its contents, a late response arriving after the user had already clicked
Back would overwrite the closing sheet they'd navigated to. Fixed with a generation counter (only the latest
triggered load's response renders) and an `alive` flag (nothing renders once `onBack` has fired). The
verification script's own fixed `setTimeout` waits were replaced with a real `settled()` check, and a new check
(J-08) fires Apply then Clear back to back with no wait, proving the guard holds under a real race rather than
just looking clean. **11/11** after.

**General Ledger** (`20260918p`, `nf_list_all_accounts` + `nf_get_ledger`) — per-account running balance.
`nf_list_all_accounts` returns every account (all 110), not `nf_list_heads`' is_head-only "postable leaf" set,
since a JV can post straight to a structural or via account and `nf_post_voucher` never restricted that.
`js/nf/nf-ledger.js` reuses the same generation-guard/`alive` pattern from the Journal fix, applied from the
start this time.

`scripts/nf/verify-nf-general-ledger.js` found two real bugs, neither assumed away:
- Its own `settled()` wait first matched the wrong element (`document.querySelector('.rsec')` found the filter
  bar, not the results area, which never shows "Loading…") — tiles and rows were read before the fetch had
  resolved. Fixed by giving the results area a stable `#nf-lgr-body` id and pointing the wait at it.
- Once the wait was pointed correctly, a **real backend bug** surfaced: with no date filter ("all time", the
  default view), `nf_get_ledger`'s opening-balance query used `(p_from IS NULL OR v.voucher_date < p_from)` —
  Postgres's `OR` makes that `TRUE` for every row whenever `p_from IS NULL`, so every voucher was summed into
  "opening" *and* into "entries", the same set twice. Account 22100's real net was -75000; the screen showed a
  closing balance of -150000 — exactly double. Fixed in `20260918q`: with no filter there is no period start to
  have an opening balance as of, so it is 0, not "everything". **12/12** after, including the running balance
  checked arithmetically row by row (not just the final total) and a real double-click account-switch race.

**The new conditional auto-apply rule** (owner, 2026-09-18, after `20260918l`–`o`'s stop-and-report discipline
held): apply a NexuFinance migration without asking when it only creates new objects, is grant-locked from the
start, dry-runs clean, the verification suite is green after (stop and report if not — never fix forward and
re-apply silently), and the tables involved hold no real data. `20260918m` and `p` both qualified and were applied
directly. `20260918q` (the ledger fix) was judged to qualify too, on the reasoning that `nf_get_ledger` was
created minutes earlier in this same session and nothing else depends on it yet — flagged as a judgment call
rather than assumed automatically covered, since the rule's literal wording ("an existing function other code
already calls") wasn't written with same-session, same-feature fixes explicitly in mind. **The sunset condition,
stated by the owner explicitly:** the moment real vouchers land in Awami, this stops applying to the ledger
tables and the default reverts to asking for everything touching them — to be said explicitly when that switch
happens, not left to slide.

Full suite re-run after every step in this section: `verify-nf-golden-ui.js` 28/28, `verify-nf-director-report.js`
18/18, `verify-nf-general-journal.js` 11/11, `verify-nf-general-ledger.js` 12/12 — no regression from any of it.

### 12.9 Trial Balance — built, applied, verified (2026-09-18)

The third and last of the three pre-import verification instruments (Journal and Ledger done, §12.8). Every
account with a non-zero net balance, split into its natural debit/credit column, as of a date (a snapshot, not a
range — one "as of" filter, not from/to). Because every voucher this schema accepts is itself balanced, summing
every account's net and splitting by sign must always tie exactly — this report re-proves the double-entry
invariant across the whole company at once, and is what the owner's own QuickBooks checksum
(12610/22100/22200/21100/15300/16100/70100) gets checked against once the Awami history is imported.

Backend `20260918s` (`nf_get_trial_balance`), frontend `js/nf/nf-trial-balance.js` — this one built with the
generation-counter + `alive` guard from the start, rather than finding the same race by hand a third time.

`scripts/nf/verify-nf-trial-balance.js`'s T-05 found a real bug in `20260918s`, not assumed correct from reading
the SQL: the "as of" date filter had **no effect at all**, for any date, not just the default. `nf_voucher_legs`
was joined to `nf_accounts` unconditionally, then `nf_vouchers` was left-joined to it carrying the date/status
condition — but the aggregate summed the legs' own `debit`/`credit` columns directly, already populated from the
first, unconditional join regardless of whether the voucher matched. Nulling out `nf_vouchers`' own columns when
the date condition failed had no effect on the legs' columns at all. Fixed in `20260918t` with `FILTER (WHERE
...)` on the aggregate itself — the same pattern `nf_position_row` already uses correctly elsewhere in this
schema — instead of relying on a join's null-propagation to gate an aggregate that never referenced the joined
table's own columns. **9/10 → 10/10.**

Both `20260918s` and `t` applied directly under the conditional auto-apply rule. Full regression sweep after:
`verify-nf-golden-ui.js` 28/28 (one transient flake on a run immediately after three other Puppeteer suites in
the same shell chain — a clean immediate retry was clean; not a regression, noted rather than silently retried
away), `verify-nf-director-report.js` 18/18, `verify-nf-general-journal.js` 11/11, `verify-nf-general-ledger.js`
12/12.

**All three pre-import instruments are now built, applied and verified.** Next: the Awami history import — 64
vouchers / 154 real lines (confirmed by parsing `docs/reference/Awami_Closing_All_Entries.xlsx`'s `Entries`
sheet directly; the 155th row is a blank "Total" footer row, not a transaction), one import (not the Excel-only
15-Sep/16-Sep split — QuickBooks has never had that split and it would make the reconciliation permanently
non-zero), each on its own real voucher date, checked against the owner's own combined QuickBooks checksum. Then
the rest of the reports pass.

## 13 · Backups verified, a real restore proven, four real bugs found and fixed (2026-09-18)

Owner upgraded the Supabase org to Pro and asked for three things before the Awami import proceeds: (1) confirm
daily backups are actually on, by query; (2) prove a restore, once — "an untested backup doesn't count"; (3)
clean up the retired Nexunova-crm project, whenever it doesn't interrupt the reports pass.

### 13.1 Backups — confirmed by query, not assumed

`GET /v1/projects/{ref}/database/backups` on the RMS project: `pitr_enabled: false` (deliberately not purchased,
per the owner), `walg_enabled: true`, and 7 consecutive daily physical backups, `status: COMPLETED`, most recent
2026-09-17T15:03:53Z, oldest available 2026-09-11T15:06:09Z — matching the standard 7-day retention on Pro with
no longer-retention add-on. Daily backups are on and running.

### 13.2 A real restore, proven — into a scratch project, since deleted

No psql on this machine; added `pg` as a real dependency (was `--no-save` for the first attempt, promoted once
this became a permanent tool) and wrote `scripts/restore-full.js` — a Node-based companion to `backup-full.js`
that restores its schema+data output into any real Postgres target, since the org's Pro plan lifted the
2-active-project cap that previously blocked this. Created a disposable scratch project
(`nexunova-restore-scratch-20260918`, ref `tmajymlrdtapwfchazot`), ran a fresh `backup-full.js --only schema,data
--skip-audit` snapshot, restored it into the scratch project, verified by query, then deleted the scratch project
— back to the normal 3.

**Four real bugs found in `backup-full.js`, fixed there (not papered over in the restore script) — this is
exactly why an untested backup doesn't count:**

1. **Missing `CREATE SEQUENCE`.** A column with a plain `DEFAULT nextval('seq'::regclass)` (not a `GENERATED ...
   AS IDENTITY` column, which creates its own sequence automatically) needs that sequence to already exist —
   casting text to `regclass` is a catalog lookup done immediately, not deferred. Nothing ever emitted `CREATE
   SEQUENCE` for the 3 tables using this older pattern (`audit_logs`, `availability_report_attempts`,
   `payment_link_status_history`) — `02_tables.sql` failed outright on the first one, aborting everything after
   it in that file, alphabetically almost everything. Fixed: `01_types.sql` now pre-creates exactly the sequences
   a plain `DEFAULT` references, found by scanning the same column-default data already gathered for
   `02_tables.sql`.
2. **Constraint triggers emitted as invalid `ALTER TABLE` fragments.** `pg_get_constraintdef()` for a `contype =
   't'` row (`nf_accounts_tree_guard`, `nf_voucher_balance_check` — the deferred-constraint-trigger half of this
   project's own double-entry balance enforcement) returns only the fragment `TRIGGER DEFERRABLE INITIALLY
   DEFERRED`, invalid anywhere near `ALTER TABLE ADD CONSTRAINT` — a syntax error, not a different dialect. Fully
   and correctly captured already by the ordinary triggers export (`07_triggers.sql` already emits a real `CREATE
   CONSTRAINT TRIGGER ...` for both). Excluded `contype = 't'` from `03_constraints.sql` as pure duplication.
3. **Restore ordering.** `04_indexes.sql` used to run before `06_functions.sql` — a functional index
   (`leads_company_normphone_idx` on `_norm_phone(phone)`) needs its function to exist first. Separately,
   `nf_report_groups(uuid,text)` needs `public.nf_lines` (a view) to exist first, so views had to move ahead of
   functions too. Checked both times that nothing breaks the other way (no function depends on a view, no view
   depends on a function, no materialized views for an index to need) before reordering the documented restore
   sequence to `01 → 02 → 03 → 05 → 06 → 04 → [data] → 07 → 08 → 10`.
4. **`GENERATED ALWAYS AS IDENTITY` needs `OVERRIDING SYSTEM VALUE`.** `nf_audit.id` and `location_history.id`
   refuse an explicit value in their `INSERT` otherwise — "cannot insert a non-DEFAULT value into column \"id\""
   on a truly fresh target. Fixed: the identity check already gathered for `02_tables.sql`'s own column
   definitions now also adds `OVERRIDING SYSTEM VALUE` to a table's `INSERT` header when it applies.

**One more real behaviour, documented rather than "fixed" away:** a function can call another function that
sorts later alphabetically (`_crm_in_quiet_hours` calls `_crm_next_send_at`) — Postgres does not track that as a
catalog dependency for either SQL- or plpgsql-language functions (checked directly against `pg_depend`: zero
rows), so there is no way to pre-sort 06_functions.sql correctly. A plain `-v ON_ERROR_STOP=1` run aborts entirely
at the first forward reference. Documented in `backup-full.js`'s own restore instructions: drop `ON_ERROR_STOP`
for that one file and run it again if it errors — `CREATE OR REPLACE FUNCTION` is idempotent, and everything
created before the first pass's failure point makes the second pass's forward references resolve. `restore-
full.js` automates exactly this (retry passes, one statement at a time so an earlier success survives a later
failure, reconnecting on a dropped connection rather than guessing what got through).

**Restored and verified, by query, against the scratch target** (`FUNC_FILTER='^(_?nf_|nf_)'`, scoping the proof
to what was actually asked — CHECK constraints, unlike FK/triggers, are not disabled by `session_replication_role
= replica`, so restoring every other module's data too risked failing on *their* integrity rules, unrelated to
anything this proof was checking — found directly when `cash_entries`' own check constraint did):

```
nf_tables: 14 (13 real tables + the nf_lines view)     nf_functions: 71 created, 69 visible via information_schema.routines
nf_accounts_rows: 330 total, awami_accounts: 110 (exact match)     companies_rows: 9
nf_days_rows: 2, nf_vouchers_rows: 18, nf_voucher_legs_rows: 36 (the two ZZTEST fixture tenants; Awami itself is still 0/0/0, matching live)
```

The general, whole-platform restore path (schema/tables/constraints — identical regardless of the `FUNC_FILTER`
scoping) was proven first, unscoped, before narrowing to nf_ for the reasons above.

Found on a genuinely memory-constrained machine (8GB total, repeatedly down to 500-900MB available under general
system load, unrelated to this work) — several attempts were killed by the harness for low memory before landing
on a shape that finishes fast enough: one round trip per function (so an earlier success survives a later
forward-reference failure, unlike one giant batch, which rolls the whole thing back on any single failure — both
confirmed directly, not assumed) combined with pre-filtering the indexes/triggers/policies phases to nf_-relevant
lines instead of the slow statement-by-statement fallback for everything else.

### 13.3 CRM cleanup — search done, export/delete not yet started

Searched every sibling directory under `D:\KBH Data\RMS ERP\` (excluding `node_modules`/`.git`/`backups`) for the
retired Nexunova-crm project's ref (`hondkhasedtauryltixt`):

- **10 other sibling repos**: clean, zero references.
- **`nexusnova-crm`'s own repo**: real secrets in `apps/mobile/.env`, `apps/mobile/.env.example`,
  `apps/web/.env.local` (already known from the earlier audit), plus its own `.next/` build cache/output and
  Supabase CLI link-state (`supabase/.temp/`) — all expected, all inside its own boundary, all confirmed local-
  only and never pushed (as before).
- **This repo (`nexunova-rms`)**: two hits, both gitignored and never committed (`git log --all` for each path is
  empty) —
  - `.claude/settings.local.json` carries a **real, plaintext `SUPABASE_SERVICE_ROLE_KEY` JWT for the CRM
    project**, cached inside old pre-approved PowerShell command patterns (from some earlier session that ran the
    CRM's `seed-demo.ts`/`cleanup-demo.ts` scripts). Local-only, never pushed — but a real, live-looking
    credential sitting on disk regardless. Becomes inert the moment the CRM project is actually deleted (below),
    which is precisely why that deletion matters here too, not just as a cost/hygiene cleanup.
  - `dist/win-unpacked/resources/app.asar` — a stale local packaged Electron build, gitignored, never
    distributed. Lower priority; not investigated further.
  - `docs/PLAN.md` (this file) — only this project's own prose about the CRM retirement, not a secret.

**Not yet done:** exporting the CRM's data in full and storing it with the backups, then deleting the project
(now unblocked — the 2-active-project cap that stopped this earlier is lifted on Pro, proven directly by running
3 active projects simultaneously during §13.2's restore proof). Confirmation is required before deletion per the
owner's own instruction — asked, not assumed.

## 14 · The Awami history import — real data, applied and verified (2026-09-18)

Removed the plaintext CRM `SUPABASE_SERVICE_ROLE_KEY` from `.claude/settings.local.json` first, per the owner's
own "right now, 30 seconds" instruction — a service-role key bypasses RLS entirely and shouldn't sit on disk
regardless of gitignore. Confirmed gone; the one remaining `hondkhasedtauryltixt` reference in that file is a
harmless reachability-check URL with no key attached.

### 14.1 Attribution — a real decision, asked rather than assumed

`nf_vouchers`/`nf_voucher_legs` require a real `created_by`/`posted_by` (`NOT NULL`, no FK to `auth.users`, but a
real actor matters for audit integrity). Asked the owner who these 64 vouchers should be attributed to. Answer:
**none of the real people** — these were posted in QuickBooks over months, not hand-keyed by a director in one
sitting, and attributing them to a real person would put a false statement in the audit trail. Created a
dedicated, clearly non-human system account instead: `import@awami.internal`, sign-in disabled (a 100-year ban
via the admin API, no password anyone holds), added as the **minimum role needed to post** (`accountant`, not
`director`), display name "Historical Import (system)" so it reads unambiguously in any report. **Deactivated**
(`nf_members.active = false`) immediately after the import verified clean — not deleted, so the audit trail keeps
its actor. Explicitly did **not** create real accounts for Syed Yousaf Shah, Naeem Hussain or an accountant as a
side effect — those get created properly when the app goes live, as their own step. Every imported voucher's
narration carries `"Imported from QuickBooks history, 2026-09-18"`, obvious on the face of the record without
inspecting who posted it.

### 14.2 The 155-vs-154 row — resolved, not assumed

Row 156 of the `Entries` sheet is a blank `"Total"` footer with no voucher number and no account — excluded by
that predicate (no voucher), not by row count, so a future real addition can never be silently swallowed by the
same filter. Real content: exactly 64 vouchers, 154 lines, matching the owner's own count exactly.

### 14.3 A real discrepancy, checked against the owner's own QuickBooks reconciliation before touching anything

Three vouchers (JV-0007, JV-0009, JV-0011) didn't balance in the Entries sheet as written — each is a lump sum
token receipt (500,000 / 600,000 / 800,000) allocated evenly across several units, with every unit's share
rounded **up**, leaving a 4/3/2-rupee excess nothing absorbed. Stopped and reported rather than silently fixing
it. The owner's own answer settled which side was wrong: **check the Entries sheet's own 21100 credit total
first** — it summed to 3,530,009, not the 3,530,000 the owner had already reconciled exactly against the live
QuickBooks General Journal. That 9-rupee gap (4+3+2, exact) confirmed the imbalance was real in the sheet, not a
parsing artifact — and that QuickBooks itself holds each of the three as one exact lump sum against 21100, with
the per-unit breakdown being a later allocation, not the accounting fact.

**Fixed with largest-remainder allocation, deterministic, not hand-picked**: `base = floor(lump / n)`; the
shortfall (`lump - base*n`) is distributed as +1 rupee each to the first that-many units in the Entries sheet's
own row order. 500,000 across 9 units → 5 units at 55,556, 4 at 55,555 (matching the owner's own worked example
exactly). No income/rounding leg was created — no income was earned; the company received the lump sum and owes
the lump sum. Each adjusted leg's memo carries a visible note explaining the reallocation, pointing back here.

Verified independently, twice: the corrected data's own 21100 total (3,530,000, matching exactly) before import,
and the live posted figure after (`-3,280,000`, matching exactly) — both by direct query, not by trusting the
import script's own silence.

### 14.4 Mechanics — one all-or-nothing transaction

`scripts/nf/import-awami-history.js`: parses the Entries sheet with two independently cross-checked date
conversions (Excel serial arithmetic and the cell's own display text — SheetJS's `cellDates` option was found to
introduce a real ~5-hour timezone-shift artifact during this work, checked and confirmed wrong before trusting
either date source; zero mismatches across all 154 rows using the two methods that agree). Builds the whole
import — 18 parties (FMH, KBH, Syed Yousaf Shah, Naeem Hussain, all fixed per the owner's instruction, plus 14
distinct token customers, extracted by **person**, not per-unit — "Haji Ibrar:LG-01" and "Haji Ibrar:LG-02" are
the same customer across two units, not two parties; the unit stays in that leg's own memo, already present in
the source text) then all 64 vouchers then the owner's own 7-figure checksum — as **one PostgreSQL transaction**.
A `RAISE EXCEPTION` on any checksum mismatch, still inside that same transaction, rolls back everything; no
partial import was ever possible.

Ran via the Management API's privileged channel with only `request.jwt.claims` set (not a role switch to
`authenticated`) — found directly, on the first real attempt, that `nf_create_party` correctly has no grant for
the `authenticated` role at all (per 20260918n's lockdown; nothing calls it directly except a channel exactly
like this one). Running under the privileged role bypasses that ACL check the same way applying a migration
does, while `auth.uid()` still resolves the system account correctly from the GUC regardless of role — so
`nf_require_role`'s real internal membership check still gates the import on the system account's real
`accountant` membership, not on a bypassed ACL. Every table trigger (the balance and position guards) fires
unconditionally regardless of role either way — nothing about this channel weakens those invariants.

Two other real bugs found and fixed on the way to a clean run, neither assumed away: `PERFORM public.nf_post_voucher(...)`
at the top level of a plain SQL script is a syntax error — `PERFORM` is PL/pgSQL-only; fixed to a bare `SELECT`.
And the party-balance/exactly-one-of-debit-credit validation described in §14.3 above, which the import script
enforces itself before ever generating SQL, and refuses to guess at anything outside the one documented pattern
(a single lump leg opposite several equal-valued legs) — anything else still hard-stops.

### 14.5 Result — verified independently, not by trusting the import's own success message

```
64 vouchers, 154 legs, 18 parties posted. Date range 2026-02-06 to 2026-09-18.

12610 Syed Yousaf Shah         7,660,900   MATCH
22100 FMH                    -20,124,450   MATCH
22200 KBH                     -6,549,500   MATCH
21100 Token Money - Units     -3,280,000   MATCH
15300 Computer & IT Equipment    130,000   MATCH
16100 Software & Licences        488,000   MATCH
70100 Salaries & Wages            50,000   MATCH

Full trial balance (18 non-zero accounts, all of Awami's real history): total debit = total credit =
29,953,950 — the whole double-entry ledger self-balances, not just the 7 checked accounts.
```

Full regression sweep after, since real data was now present for the first time: `verify-nf-rules.js` 51/51
(including `AWAMI-UNTOUCHED`, correctly accounting for the import itself, not a stale zero-row baseline),
`verify-nf-golden-ui.js` 28/28, `verify-nf-director-report.js` 18/18, `verify-nf-general-journal.js` 11/11,
`verify-nf-general-ledger.js` 12/12, `verify-nf-trial-balance.js` 10/10 — all against the ZZTEST fixture
convention as always, none of them touching Awami itself, all still clean.

### 14.6 The auto-apply rule flips, as the owner said it would

**Stated explicitly, per the owner's own instruction to say so when this happens:** Awami now holds real
production data (110 accounts, 64 vouchers, 154 legs, 18 parties, a real ledger that balances to a real
QuickBooks reconciliation). The conditional auto-apply rule's fifth condition — "the tables involved hold no
real data yet" — **no longer holds for the ledger tables** (`nf_days`, `nf_vouchers`, `nf_voucher_legs`,
`nf_parties`, `nf_party_aliases`). From this point on, any migration touching those tables reverts to the
default: stop and ask, every time, regardless of how safe it looks. `nf_accounts`/`nf_floors`/
`nf_report_categories` may still qualify under the rule depending on what's actually being changed — judged
per-migration, not by blanket reference to this note, exactly as the rule always said.

Next: Trial Balance is already built and verified (§12.9) — nothing further needed there. Then the CRM export +
delete (confirm before the actual deletion). Then P&L, Balance Sheet, and the remaining reports, now checkable
against Awami's own real, reconciled history instead of only the golden-day fixture.

## 15 · Real report PDFs, and the CRM export (2026-09-18)

### 15.1 Real report PDFs — the owner's first look at his own numbers

`scripts/nf/export-real-reports.js` (new): drives the real General Journal, General Ledger (account 22100 FMH —
46 real entries, picked over 12610 Syed Yousaf Shah's 12 — the owner's own suggestion, checked by query, not
guessed) and Trial Balance screens against Awami's actual imported history via a temporary, viewer-role-only
session, created and fully deleted around the export regardless of outcome. Found and fixed a real timing race:
waiting on a generic `#nf-sheet`/`.nf-gate` selector after each "back" click occasionally lost to the real
re-render on this machine — Awami has zero `nf_days` (only imported vouchers, no day was ever opened through the
app), so the closing sheet always shows its own "no day open" gate, but the header's report-nav buttons render
in the very same pass. Fixed by waiting on the specific next button needed, not a generic container.

Saved to `D:\Claude Cowork\`: `Awami_General_Journal_2026-09-18.pdf` (64 vouchers, 4 pages),
`Awami_General_Ledger_22100_FMH_2026-09-18.pdf` (46 entries, 1 page), `Awami_Trial_Balance_2026-09-18.pdf` (18
accounts, 1 page, footer reads 29,953,950 = 29,953,950). All three page counts measured directly from the PDF
bytes, matching §14.5's independent verification exactly — not a second, differently-sourced number.

### 15.2 CRM export — done; deletion awaiting the owner's confirmation

Resumed the paused Nexunova-crm project (`hondkhasedtauryltixt`) — the 2-active-project cap that blocked this
earlier is confirmed lifted on Pro (already proven once, §13.2's restore proof ran 3 projects at once). Checked
its real size before choosing a backup scope: 15 tables, 301 total rows (295 in `users`, 6 in `audit_log`,
everything else empty) — small enough that a full `backup-full.js` run (schema + data + Excel + storage) was
easily feasible, not just a partial export.

`scripts/_sbq.js` was given a temporary, explicit-only override (`NF_ONE_TIME_TARGET_REF` env var) so
`backup-full.js` could run against the CRM project without touching `.mcp.json` — reverted immediately after
the one run; confirmed clean via `git diff` before doing anything else. Every other script's normal behavior
(the `.mcp.json`-configured RMS project) was never affected, since the override only activates when that exact
env var is set.

Found and fixed a real gap in `backup-full.js` itself along the way: it assumed every target has an RMS-shaped
`companies(id, company_name)` table (used only for cosmetic per-tenant Excel labeling) and crashed the whole
backup outright when the CRM's schema didn't match. Fixed to fall back to an empty tenant list instead of
assuming every future target is RMS-shaped — no change in behavior for RMS itself.

Backup completed and verified with the tool's own `--verify`: **PASS — DONE marker present, manifest complete,
every table file matches its manifest count.** Stored at `backups/CRM_EXPORT/BACKUP_20260918_2306/` (438 KB),
alongside RMS's own backups as asked, gitignored the same way (`backups/` was already excluded — nothing new to
exclude). Storage phase: 0/0 files (confirmed empty, not skipped).

Attempted to re-pause the CRM project afterward (no functional need for it to stay reachable while awaiting the
deletion decision) — refused by the API: `"Project is not free-tier. Please downgrade it to free-tier first and
try again."` Left active rather than force a plan/billing change that wasn't asked for; flagged to the owner
instead.

**Not done: the actual deletion.** Export is complete and verified; confirmation is required before deleting,
per the owner's own instruction — asked, not assumed.

### 15.3 A transient push-gate failure, unrelated to this work — flagged, then confirmed to clear on its own

A push attempt (commit `e03c8af`, a single new, isolated Node script) was blocked by the repo's push-gate: 7
failures, all cascading from one root cause — "Director board: member cards rendered (0), project tabs rendered
(0)" — in the Sales Portal's director-board feature. Confirmed this was not caused by anything in this session's
own work before doing anything else: the blocked commit touches only `scripts/nf/export-real-reports.js`, with
zero relationship to that frontend feature, and `git log origin/main..HEAD` showed no other pending changes at
the time. Per the standing "two workstreams on main" convention, not touched or investigated further — flagged
instead of silently bypassed (`--no-verify`) or fixed outside scope. A retry a short time later (commits
`e03c8af` + `a9977e8` together) passed cleanly, 38/38, including the exact same "See their leads" check that had
failed — confirming this was a transient flake (most likely a timing issue in the smoke suite itself, or a brief
backend hiccup), not a persistent regression. Both commits pushed successfully once it cleared.

## 16 · Ledger memo fix, CRM deletion, and the real print-pagination bug (2026-09-19)

### 16.1 Ledger memo — applied on explicit go-ahead

Reviewing the real Awami PDFs surfaced two claims from a relayed review: narration "destroyed", and the
Journal's first printed page blank. Checked the first directly before acting on it, per the standing habit of
verifying rather than deferring: every leg's real memo was intact in `nf_voucher_legs.memo` the whole time (e.g.
"Token 102 - unit GF-129") — nothing was lost. The actual gap was narrower and different per screen. The Journal
needed only a frontend fix (`nf_get_journal` already returned `memo`; `js/nf/nf-journal.js` just wasn't showing
it). The Ledger's own RPC, `nf_get_ledger`, never selected `l.memo` at all, so no frontend fix alone could reach
it. Wrote `supabase/migrations/20260918u_nf_de_ledger_memo.sql` (adds `l.memo` to the entries CTE and returned
JSON, otherwise byte-identical to the live `20260918q` version), proposed it plainly, and applied it only after
the owner's explicit "Yes, apply it" — per the auto-apply rule's own sunset (Awami holds real data) and its
always-ask condition for changing an existing function's behavior. Verified live immediately after
(`nf_get_ledger` present, `nf_voucher_legs.memo` confirmed intact for 22100), then ran the full nf_ verification
sweep: `verify-nf-general-ledger.js` 12/12, `verify-nf-director-report.js` 18/18, `verify-nf-general-journal.js`
11/11, `verify-nf-golden-ui.js` 28/28, `verify-nf-race-harness.js` PASS, `verify-nf-rules.js` 50/51 (the one
failure traced directly to a race with this session's own concurrent diagnostic-account cleanup, confirmed by
querying `nf_members` afterward — only the real system-import row remained, exactly as expected — not a
regression). `verify-nf-de-migration.js` and `verify-nf-schema.js` both failed, but both are explicitly
documented in their own file headers as frozen, Phase-1-only rehearsals that only replay migrations a-c/a-d and
are expected to fail against the schema as it exists today — unrelated to this change, not chased further.

### 16.2 CRM project — deleted

Backup re-confirmed present at `backups/CRM_EXPORT/BACKUP_20260918_2306/` before doing anything irreversible.
Deleted via the Management API (`DELETE /v1/projects/hondkhasedtauryltixt`) on the owner's explicit go-ahead,
confirmed gone immediately after by listing projects: only `Nexuattend` and `Nexunova Project` (RMS) remain.
Diagnostic leftovers from the print investigation cleaned up alongside it: the temporary diagnostic viewer
account and its `nf_members` row, and three throwaway scripts under `scripts/nf/_diag*`.

### 16.3 The print bug wasn't actually fixed — corrected after re-checking the real PDF, not the CSS

Told the owner the blank-first-page bug was fixed (the `width:auto;zoom:1` reset from the prior session). It
wasn't — re-exporting the real Journal PDF and reading it directly (`pdftotext`, then a Chrome-rendered
screenshot of the actual PDF) showed page 1 still empty but for the masthead. The earlier "confirmed" measurement
had only checked `getComputedStyle` under `emulateMediaType('print')`, which reflects live DOM layout, not how
Chromium's `page.pdf()` pagination pass actually places content — the two are not the same, and only the second
one is the real deliverable. Said so plainly rather than leaving the earlier claim standing.

Root-caused properly via systematic A/B tests against the real generated PDF, each one isolating a single
variable and reverted after:
- Removing `.jtab tr.jvfirst{break-inside:avoid}` entirely — no change.
- Adding `overflow:visible` to `.jsheet` (the base `.sheet` class sets `overflow:hidden`) — no change.
- Removing the `zoom:.665` declaration from `nf-print.css` entirely, so no zoom value touches `.jsheet` even
  indirectly — no change. (This also retroactively shows the previous session's zoom/width fix, while a
  reasonable and correct cleanup in its own right, was never the actual fix for the blank-page symptom.)
- Setting `preferCSSPageSize:false` with explicit `page.pdf()` margins instead of the `@page` CSS rule — no
  change.
- Forcing `.jtab thead{display:table-row-group}` to disable the browser's repeating-header treatment — no
  change.
- Overriding `border-collapse:separate` on `.jtab` (a table/print-pagination bug documented in Chromium for
  `border-collapse:collapse`, which `nf.css`'s base `table{}` rule uses) — no change.
- Waiting on `document.fonts.ready` plus a fixed delay before calling `page.pdf()`, in case of a font-swap
  reflow racing the print snapshot — no change.
- Bisecting the Journal's own date range to find the exact threshold: a filtered range short enough to fit
  fully on one page renders correctly every time; the moment the same table needs a second page, page 1 goes
  blank — reproduced cleanly at every row count tested above that line, regardless of which single CSS property
  above was toggled.

Conclusion: this is a genuine Chromium engine limitation, not anything fixable by adjusting this project's CSS —
a `<table>` that must fragment across more than one printed page in headless `page.pdf()` gets pushed entirely
to page 2, wasting page 1, independent of zoom, overflow, border-collapse, break-inside, thead repeat behavior,
or font-load timing. The real, permanent fix is to stop laying these reports out with a native `<table>` and
rebuild the row structure in CSS Grid instead, which Chromium paginates correctly — a real markup rewrite, not a
CSS tweak, and not done in this pass (see 16.5 for scope).

### 16.4 The cheap fix shipped instead: detect and drop a genuinely wasted page 1 in the export step

Per the owner's own instruction — clean deliverables today without touching report markup, verified by page
count and by reading the new page 1's text, never by assuming — `scripts/nf/export-real-reports.js`'s `savePdf()`
now generates the PDF, checks whether page 1 has any real content on it at all (any digit, via `pdftotext -f 1
-l 1`), and if there's a page 2 to fall back to and page 1 has none, regenerates with `pageRanges:'2-'` and ships
that instead.

Found and fixed two real bugs in this check while building and verifying it, neither invented in advance:
- `page.pdf()` returns a plain `Uint8Array` in this Puppeteer version, not a `Buffer` — calling `.toString('latin1')`
  directly on it silently ignores the encoding argument and returns a decimal-byte list instead of text, so the
  page-count regex never matched anything (always read as 0, permanently disabling the fix). Fixed by wrapping
  in `Buffer.from()` first. Caught by adding a debug print of `pdf.constructor.name` rather than assuming the
  return type.
- The first version of the check tested specifically for the word "Debit" (the table's own header), reasoning
  that its absence meant page 1 was blank. That's true for the Journal (nothing on page 1 but the header) but
  wrong for the Ledger: its page 1 legitimately holds the real opening/closing balance tiles — genuine content,
  not waste — and only the table continues on page 2, which is ordinary, correct pagination, not this bug. The
  first fix version silently deleted that real tile page. Caught by reading the original, undropped page 1's
  actual text before shipping ("Opening Balance / Closing Balance / Rs 0 / Rs (20,124,450)") instead of trusting
  the page-count delta alone, per the owner's own instruction to verify by reading the text. Fixed by testing for
  any digit at all on page 1, not the specific word "Debit" — a much safer bar for "this page has real content"
  regardless of which report it is.

Final, verified result: Journal now 9 pages (was 10, wasted page 1 dropped, real content from page 1), Ledger
still 3 pages unchanged (its real page 1 was never wasted), Trial Balance still 1 page unchanged. Grand totals
re-checked after the fix, not assumed to still match: Journal 35,496,550 = 35,496,550, Trial Balance
29,953,950 = 29,953,950. Re-exported to `D:\Claude Cowork\` under the same filenames.

### 16.5 Scoping the eventual table-to-grid retrofit honestly, so it doesn't get over-built

Of the three multi-row reports, only the **Journal** is genuinely, unavoidably multi-page at this business's
current size (64 vouchers, 9 pages) — it is the only one that actually needs the CSS-grid rewrite, and needs it
now-ish rather than eventually. The **Ledger** happened to need 3 pages for the 22100 account today, but its
page 1 was never wasted (the tiles fill it), so the rewrite there is about a future account that grows large
enough to blank its page 1 the same way the Journal's did — worth doing when that happens, not preemptively.
The **Trial Balance** is a fixed-size, one-row-per-account report bounded by the chart of accounts (currently 18
rows); it is extremely unlikely to ever need a second page for this business, so the honest scope for it is
"probably never." Whoever picks this up next should treat it as "Journal now, Ledger later, Trial Balance
probably not" — not three equal-weight rewrites.

**New reports (P&L, Balance Sheet) build on CSS Grid from the start**, not `<table>`, per the owner's own
instruction — there's no reason to add to a debt that's already been identified, even though both are expected
to stay single-page at this business's current size and wouldn't hit this specific bug today.

### 16.6 Go-live rule: deploy timing, once the app is in real daily use

Recorded per the owner's own instruction, on approving the push for this session's commit. A push to `main` is
a live Vercel deploy (see `commit_directly_to_main` in memory) — today that's harmless, since nobody is actually
using the app yet. It stops being harmless the moment real staff start entering daily closings through it: a
deploy mid-entry changes the running app under someone's hands. **Once the app is in daily use, deploys happen
outside working hours, or at a point where no day is open mid-entry — not simply whenever a commit is ready.**
Flag it to the owner when that switch is close, the same way the auto-apply rule's own sunset (real data landing
in Awami) was flagged explicitly when it flipped.

### 16.7 Journal page count accepted at 8, not 4-5 — and a real TODO before daily use

The owner's own call: 8 pages (not the 4-5 estimated) is fine as-is — a general journal is a reference document
you filter, not something read end to end, and the narration length comes from the real QuickBooks memo; the
right trade is never to shorten stored data just to make a report look tidier.

**Real TODO flagged by the owner, not done yet:** the Journal's footer currently reads "All time". At 154 lines
that's 8 pages; at several years of real daily entries it will be several hundred. Before this goes into daily
use, the Journal should default to a sensible period (current month, or a range the user picks) instead of
everything ever posted, and the export should carry the selected range in both its header and its filename —
not left for whoever hits this first in production.

## 17 · Profit & Loss and Balance Sheet (2026-09-19)

### 17.1 Built on the known-good pattern from the start

`nf_get_pl(company, from, to)` and `nf_get_balance_sheet(company, as_of)` — two new, purely additive RPCs, same
security pattern as `nf_get_trial_balance`. Income/COGS/Expense classification and Asset/Liability/Equity
classification both come straight from `nf_accounts.qb_type`, already the real QuickBooks-reconciled chart (see
§11). Row markup on both new screens (`js/nf/nf-pl.js`, `js/nf/nf-balance-sheet.js`) is CSS Grid divs
(`.oblist`/`.orow`), not a `<table>` — the known Chromium print-pagination bug from §16.3 only affects tables, so
these were built the safe way from the start instead of adding to that debt, per the owner's own instruction.

Migration `20260919a_nf_pl_and_balance_sheet.sql` proposed and applied only after explicit go-ahead, per the
same flipped-auto-apply-rule reasoning as §16.1 (touches the ledger tables, even though purely additive).

**Real security gap found applying it, not caught by the rehearsal:** both new functions came up grantable to
`anon` by default — unlike every existing `nf_` report RPC (`nf_get_trial_balance` etc.), which are all correctly
`anon:false`. A `BEGIN...ROLLBACK` rehearsal never queries `pg_proc`'s real grants against a real session, so
this wasn't visible until after applying — checked directly with `has_function_privilege()` against `anon`/
`authenticated`/`public` immediately after applying, per the standing SEC-RPC-PUBLIC check, and found wide open.
Fixed immediately with explicit `REVOKE ALL ... FROM PUBLIC/anon` + `GRANT EXECUTE ... TO authenticated`, then
re-verified `anon:false` on both. The migration file itself was updated to include these REVOKE/GRANT statements
explicitly, so re-applying it (a restore, a rehearsal) can't silently reopen the same hole — whatever
`ALTER DEFAULT PRIVILEGES` locked down the earlier functions evidently didn't carry forward to a brand-new
function name created through this session's connection, and should not be trusted to going forward either.

### 17.2 Balance Sheet self-check and the accumulated-deficit label

Verified the Balance Sheet actually balances against real Awami data, not assumed from the formula: Assets
8,278,900 = Liabilities 29,953,950 + Equity -21,675,050, exactly. The large negative equity is arithmetically
correct for a pre-revenue project — every real land/development cost posted so far has gone to Cost of Goods
Sold accounts, nothing has been sold yet — but a generic "Retained Earnings" label on a number that size reads
as if something went wrong. Per the owner's own instruction: when the computed current-earnings figure is
negative, the screen labels it **"Accumulated deficit — project costs expensed, no sales recognised yet"**
instead, so the statement explains itself on its own face rather than needing a caller to decode a term.

**Open accounting-policy question, explicitly NOT decided here:** whether some of these project costs should
eventually be capitalised to `13000 Project Inventory` instead of expensed to Cost of Goods Sold — which would
change both the P&L and the Balance Sheet's shape substantially. Per the owner's own instruction, the reporting
layer does not make this call; it belongs to the owner and his auditor. Flagged here so it isn't silently decided
by omission later by whoever next touches this area.

### 17.3 Exported and verified; no dedicated verify script yet — a real gap, not silently skipped

Both PDFs exported to `D:\Claude Cowork\` (`Awami_Profit_and_Loss_2026-09-19.pdf`,
`Awami_Balance_Sheet_2026-09-19.pdf`) via the same `export-real-reports.js` used for the other three, extended
with the same page-1-blank check (neither needed it — both are one page). Checked visually with a real
screenshot of the actual PDF, not just `pdftotext`, after `pdftotext -layout`'s own column-guessing garbled the
CSS-Grid row order into nonsense on both — a text-extraction artifact of grid/flex layouts, not a real rendering
defect (confirmed by the screenshot: both look correct, labels next to their own figures). Full regression sweep
run after the migration: `verify-nf-trial-balance.js` 10/10, `verify-nf-general-ledger.js` 12/12,
`verify-nf-general-journal.js` 11/11, `verify-nf-golden-ui.js` 28/28, `verify-nf-director-report.js` 18/18,
`verify-nf-rules.js` 51/51 (no race this time — nothing else running concurrently).

**Not done: `verify-nf-pl.js` / `verify-nf-balance-sheet.js`.** Every other nf_ report has its own dedicated
Puppeteer-driven verify script (ground-truth fixture, real UI checks, cleanup) — these two don't yet. Correctness
was checked by hand this pass (the self-balance identity, real screenshots, the grant-lockdown check), which is
real verification, but it isn't a repeatable automated one the next change to these screens will re-run for
free. Worth building before this goes into daily use, on the same pattern as `verify-nf-trial-balance.js`.

## 18 · The auto-apply rule refined again — read-only + grant-locked + cross-checked skips the ask

After `20260919a` and `20260919b` were each proposed, rehearsed, cross-checked against a known-correct figure
(the new party-statement RPC's FMH closing balance matched the existing 22100 Ledger's closing balance exactly —
not a coincidence, the same real legs), and applied only on explicit go, the owner gave a narrower standing
carve-out for the rest of this reports pass (see the `nexufinance_migration_autoapply_rule` memory for the exact
wording): a migration may apply without asking, even with real ledger data present, when it ONLY creates new
read-only functions/views (no write path, no change to anything existing), is grant-locked to `authenticated`
from the first version, carries the membership check, dry-runs clean, is cross-checked against a real known-
correct figure, and the verification suite is green after. Anything that writes, alters, drops or re-grants — or
anything genuinely unsure which side of the line it's on — still stops and asks, no exception. The IIF export
work is explicitly carved OUT of this rule by the owner's own instruction, flagged before it starts, same
treatment as the original history import (dry run, checksum, nothing applied without explicit go).

## 19 · Party-wise Statement (2026-09-19)

`nf_list_all_parties` + `nf_get_party_statement(company, party_id, from, to)` — same running-balance shape as
`nf_get_ledger`, but scoped to a PARTY across all accounts rather than one account. Applied under the new §18
rule (no separate ask): rehearsed clean, cross-checked FMH's closing balance against the already-verified 22100
Ledger — both -20,124,450, exactly, confirming the same real legs are being read correctly from the party side.
Grants correct from the first version (`authenticated` only) this time, not caught-and-fixed after like
`20260919a`.

Frontend (`js/nf/nf-party-statement.js`) uses CSS Grid rows (`.pgrow`), not a `<table>` — and carries the
Journal's own column-width lesson (docs/PLAN.md §16, 2026-09-19) forward from the start: Date/Voucher/Floor/
Debit/Credit/Balance are explicit-width and `nowrap`; Narration/Account are the two free-text columns allowed to
wrap. No overflow bug this time, confirmed by screenshot.

Exported `Awami_Party_Statement_FMH_2026-09-19.pdf` (46 entries, 3 pages) — page 1 legitimately holds the real
opening/closing tiles (like the Ledger's own page 1), and the table continues on page 2, which is normal
pagination, not the blank-page bug; confirmed by screenshot, not assumed from the page-drop check's own silence.

Full regression run after applying: two transient flakes on the first back-to-back pass (`verify-nf-golden-ui.js`
12/13, `verify-nf-rules.js` 50/51) — both cleared to fully green (28/28, 51/51) on an isolated re-run each,
consistent with this machine's known memory-constrained flakiness (§13.2) rather than a real regression from this
migration; not fixed forward, just re-verified clean before moving on, per the standing rule.

## 20 · Token Money Register (2026-09-19)

`nf_get_token_register(company, from, to)` — one row per unit that has ever had token money moved against it
(account 21100 is the only such account in the chart, confirmed before writing this by checking every other
account's `qb_type`). Applied under the §18 auto-apply rule.

**No structured "unit" column exists anywhere in this schema** — units only exist as free text inside each leg's
own memo (e.g. "Token 114 - unit LG-10"). Checked directly before relying on regex extraction, not assumed: all
42 real 21100 legs match `unit ([A-Za-z0-9-]+)` / `Token ([0-9]+)` cleanly, 0 misses. Real bug caught while
writing the extraction, not after: Postgres's `substring(... from 'pattern')` does NOT accept `\s`/`\d` shortcuts
inside a plain `'...'` string literal — a first draft using them returned `NULL` for every single row (confirmed
directly, would have shipped a silently-empty register). Fixed by using a literal space and `[0-9]` instead. The
floor itself is NOT re-derived from memo text — `l.floor_code` is already correct, structured per-leg data
(every 21100 leg's `floor_code` already matches its own unit's prefix), so the report joins `nf_floors` normally.

**Cross-checked against the owner's own already-verified 21100 figures**, not a new coincidence: total received
3,530,000, total returned 250,000, net outstanding 3,280,000 — exactly the debit/credit/net the owner reconciled
against the real QuickBooks export back in §14. 36 distinct units found; `LG-03` correctly shows the more complex
real case (Abdullah's original token, returned, then re-tokened to Haji Ibrar as part of a 9-unit split) with
both the gross received/returned and the correct net.

A register, not a transaction log — one row per unit (token number(s), party name(s), first/last activity date,
received, returned, net, status), not full per-voucher detail; that already exists via the Party Statement or
the General Ledger for 21100, so this report's job is the unit-wise index, not a third copy of either.

Frontend (`js/nf/nf-token-register.js`) uses CSS Grid rows again, with the Journal's column-discipline carried
forward. Column widths went through two real rebalancing passes, not guessed once and left: a first version
clipped the Status pill to "Ac"/"Activ" at low screen-capture resolution, a second fix over-corrected and clipped
the First/Last dates instead, and the width taken from Status to fix the dates turned out to be a false alarm —
re-measured at 2x device-scale-factor and the true page render was fine at every width tried above the very
first. Final widths: Unit 8%, Floor 6%, Party 14%, Token# 8%, First/Last 9.5% each, Received 11%, Returned 9%,
Net 10%, Status 15%. Exported `Awami_Token_Register_2026-09-19.pdf` (36 units, 1 page), confirmed clean by
screenshot at 2x scale after the low-resolution false alarm. Full regression clean after (28/28, 51/51).

## 21 · Cash & Bank Movement (2026-09-19) — correctly empty, not broken

`nf_get_cash_bank_movement(company, from, to)` — opening/inflow/outflow/closing for every real, postable
`qb_type='Bank'` account (`is_head = true`). The group header row `10000 Cash & Bank` (`is_head = false`, never
itself posted to) is deliberately excluded — checked directly against `is_head`/`parent_code` before writing the
query, not assumed from the account name. Applied under the §18 auto-apply rule.

**Checked before writing this, and it changed the report's design:** as of today, none of Awami's three real
cash/bank accounts (10100 Cash in Hand, 10200 Petty Cash, 10300 Bank Al-Habib) have ever been posted to — every
real imported voucher flows through intercompany (22100/22200) or token-money (21100) accounts instead. So this
report correctly returns all zeros for Awami right now. Rather than ship a report that looks silently broken,
the frontend (`js/nf/nf-cash-bank.js`) detects the all-zero case and shows an explicit banner: "No cash or bank
activity recorded for this company yet — every real transaction to date has flowed through intercompany (FMH/
KBH) or token-money accounts instead of cash/bank directly. This is the true state of the books, not a gap in
the report." Confirmed by screenshot — banner renders correctly, table still shows the three real accounts each
at zero, not hidden or skipped.

Cross-check here is necessarily "confirms the known-empty state," not a nonzero figure to match — rehearsed
output matched the direct query's own zero result across all four fields (opening/in/out/closing) before
applying. Exported `Awami_Cash_and_Bank_Movement_2026-09-19.pdf` (1 page). Full regression clean after (28/28,
51/51).

## 22 · Floor/Class Cost & Collection Summary (2026-09-19)

`nf_get_floor_summary(company, from, to)` — cost, income and token-money-collected per floor, including
"Project-wide" (a real `floor_code` for cost not yet allocated to a specific floor — checked directly before
writing this: 112 of Awami's 154 real legs are `P-W`, mostly land purchase and regulatory cost, which matches
the business's current pre-construction stage). Applied under the §18 auto-apply rule. Token collection is kept
as its own field, never folded into "income" — 21100 is a liability until a unit is formally sold, and
conflating the two would silently overstate recognised revenue, the same accounting-policy boundary as §17.2.

Cross-checked against two already-verified figures, not new coincidences: total cost 21,675,050 matches the
P&L's own total COGS + Expense exactly; total token collected 3,280,000 matches the Token Register's own net
outstanding exactly. Exported `Awami_Floor_Summary_2026-09-19.pdf` (1 page), confirmed clean by screenshot.

**A real, reproducing regression scare, resolved as environmental, not code:** the first post-apply
`verify-nf-golden-ui.js` run failed at 12/13 with `Error: Node is detached from document` inside Puppeteer's own
`scrollIntoView`/viewport-intersection check, right at the `#nf-tBank` transfer-to-bank field interaction in the
daily-closing UI test — a section of `nf-sheet.js` this session's own changes never touch (confirmed by reading
the full cumulative diff: every change was new header buttons and new click handlers appended after the
pre-existing ones, nothing altering the render timing of the count/transfer section). Re-ran a second time before
concluding anything — failed again, same signal, same point. Ran a third time with byte-identical code — passed
clean, 28/28. Fail/fail/pass on unchanged code confirms this is the same class of machine-load timing flake
already documented in §13.2 (8GB, memory-constrained, many Puppeteer launches this session), not a regression —
recorded in this much detail specifically because two failures in a row is a weaker signal than one, and this is
exactly the situation the standing rule means by "stop and report" rather than assume and move on.

## 23 · The header got crowded, then a shared Reports menu — and the flake question resolved

### 23.1 Eleven buttons in one unwrapped row

By the time Project Cost Summary landed, the closing sheet's header (`.actions{display:flex;gap:8px}`, no
`flex-wrap`) carried 11 report-launch buttons plus Director Report, Start New Day and Print — a real, growing UX
problem the owner caught before it shipped further: a director on a normal screen would face the same
horizontal overflow this session's own automated tests were starting to hit. Flagged directly rather than
silently adding a 12th and 13th button for the two reports still to come.

### 23.2 The flake question — resolved as REAL, not purely environmental

Per the owner's own instruction: don't leave this as "probably environmental," find out which. Before the nav
fix, `verify-nf-golden-ui.js` failed twice in a run of four attempts across two consecutive migrations, always at
the same point (the `#nf-tBank` transfer field, just after the last voucher save) with the same class of
Puppeteer DOM-timing error (`Node is detached from document` / `Node is either not clickable or not an
Element`). After building the Reports dropdown (§23.3) and shrinking the header back down to four top-level
items, the same test was run **five times in a row, byte-identical code, 28/28 clean every time** — a sharp
reversal from 2 failures in the prior 4 attempts. Five clean runs after a fix is a real, meaningful signal where
a single clean run wouldn't have been. **Conclusion: the crowded header was a genuine contributing cause of the
flake, not purely environmental machine-load noise** — most likely the extra unwrapped DOM width/layout
computation on every render made an already-tight timing window (a debounced save racing the next click) fail
more often, not a coincidence. Recorded here precisely so it doesn't get remembered as "probably fine, never
figured out."

### 23.3 The Reports dropdown (`js/nf/nf-reports-menu.js`)

One shared module, used identically by the closing sheet and all ten report screens — `NfReportsMenu.html(activeKey)`
renders the toggle + panel, `NfReportsMenu.wire(root, ctx)` attaches every handler. Ordered by actual use
frequency, per the owner's own instruction, not alphabetically:
1. **Daily Closing** — the one screen opened every day, always first, never buried.
2. **Statements** — Profit & Loss, Balance Sheet, Trial Balance.
3. **Detail Reports** — General Journal, General Ledger, Party Statement, Token Register, Cash & Bank Movement,
   Floor/Class Summary, Project Cost Summary.

Cross-navigation works directly between any two reports without detouring back through the closing sheet first
— every report screen's own `mount()` already receives the exact `{ api, companyId, role, displayName,
companyName, settings, onBack }` shape every other screen's `mount()` expects, so the same `ctx` object passes
straight through the menu to whichever report is chosen, and `onBack` still correctly chains back to the
original closing sheet no matter how many reports deep the navigation goes. "Daily Closing" is not a module —
selecting it calls `ctx.onBack()` directly, the same function every screen's own back button already calls.
Verified end to end via a real Puppeteer session: opened the menu from the closing sheet, navigated to Trial
Balance, cross-navigated directly from Trial Balance to Token Register (no back-and-forth through closing),
then back to Daily Closing via the menu — all confirmed working, and confirmed visually by screenshot (menu
renders correctly, "Daily Closing" highlighted as the active item, both group labels present, all ten reports
listed in the specified order).

Director Report, Start New Day and Print were left as their own direct buttons — three items in an unwrapped
row was never the problem, eleven was.

## 24 · Month-wise Expense Trend (2026-09-19) — the last of the six reports

`nf_get_monthly_trend(company, from, to)` — cost, income and token money collected per calendar month
(`to_char(voucher_date,'YYYY-MM')`), the same three figures as the Floor Summary (§22) but bucketed by month
instead of floor — deliberately the same shape, since both answer "where/when did cost happen" on a different
axis. Applied under the §18 auto-apply rule; cross-checked exactly against two already-verified totals (cost
21,675,050 matches the P&L/Floor Summary/Project Cost Summary; token collected 3,280,000 matches the Token
Register/Floor Summary). Real spread confirmed before writing this: 8 real months, February through September
2026, 1 to 19 vouchers per month.

Frontend (`js/nf/nf-monthly-trend.js`) adds a plain CSS-width bar per month (proportional to the highest-cost
month) alongside the numeric columns — no charting library, consistent with every other report in this pass.
Added to the shared Reports menu (`trend` key, end of the Detail Reports group). Exported
`Awami_Monthly_Trend_2026-09-19.pdf` (1 page, 8 months), confirmed correct by screenshot — bars scale correctly
against February's real peak (the initial land purchase).

This closes out all six reports the owner asked for in this pass (party-wise statement, token register, cash &
bank movement, floor/class cost & collection, project cost summary, month-wise trend). Full regression clean
(28/28, 51/51) — no golden-ui flake on this migration either, consistent with §23.2's conclusion that the fix
was real.

Remaining: `verify-nf-pl.js`/`verify-nf-balance-sheet.js` and equivalent dedicated verify scripts for the other
five new reports don't exist yet (§17.3's own gap, never closed) — correctness was checked by hand every time
(rehearsal + cross-check against a known-correct figure + visual screenshot), which is real verification, but
not yet a repeatable automated one. Worth building before daily use. The IIF export work is next, and per the
owner's own instruction, that gets flagged before it starts — it is the first thing in this whole pass that
writes back into the owner's own book of record, not another read-only report.

## 25 · IIF export, Part 1 — export-state tracking (2026-09-19)

Flagged before starting, per the owner's own instruction: this is the first thing in the whole reports pass that
writes back into the owner's actual book of record, not another read-only report, so it gets the same treatment
as the original history import — dry run, checksum, nothing applied without explicit go. Scoped as three parts
by the owner: (1) export-state tracking, (2) a pre-export validation gate, (3) per-account post-import
reconciliation. Part 1 only, here.

**Why the state-tracking has to exist at all, decided first, before any schema:** the 64 historical vouchers
already exist in QuickBooks — that is where they were imported FROM. A first IIF export that included them would
double-post the client's entire history into QuickBooks, and the cleanup is 64 manual deletions there. So every
voucher needs an export-eligibility state, not left to convention.

`nf_vouchers.iif_exportable` (boolean, default `true` — new vouchers created in NexuFinance from here on are
exportable by default, which is correct). Two new tables: `nf_iif_batches` (one row per export run: file name,
date range, which QuickBooks chart file/checksum the pre-export validation checked against) and
`nf_iif_batch_vouchers` (which vouchers went into which batch; a `CHECK` constraint, not just app-layer
discipline, enforces that a voucher already exported can only appear in a later batch as an explicit
`is_reexport=true` row carrying a non-null reason). Two RPCs: `nf_iif_list_candidates` (read-only — POSTED,
exportable, never-exported vouchers in range) and `nf_iif_record_batch` (the only write path; rejects the whole
batch, writes nothing, if any voucher isn't POSTED/exportable/in this company, or has a prior export not listed
as a reasoned re-export).

Rehearsed in a rolled-back transaction before presenting anything, per the owner's own instruction — not just a
syntax check: the one-time backfill (`iif_exportable = false` for every voucher created by the system import
user) affects exactly 64 rows, 0 left exportable, confirmed by direct count before AND after applying. The two
RPCs were exercised end to end inside the same rehearsal: a happy-path export of two real test vouchers,
confirming candidates then come back empty; a re-export attempt without a reason correctly raising
`NF:IIF_ALREADY_EXPORTED`; a re-export with a reason correctly succeeding and recording `is_reexport=true` with
the reason text. Applied only after the owner reviewed this summary and gave explicit go. Live backfill and
grants re-verified immediately after applying, matching the rehearsal exactly (64/0, `anon:false` on both RPCs).

**Real regression found running the full post-apply sweep, unrelated to this migration — a gap in my own
earlier verification discipline, not this migration's fault:** `verify-nf-general-ledger.js`,
`verify-nf-general-journal.js` and `verify-nf-trial-balance.js` all failed, each at a `page.click()` on a button
ID (`#nf-toLgr`, `#nf-toJrn`, `#nf-toTB`) that no longer exists since §23's Reports-dropdown consolidation. That
refactor's own regression check only ran `verify-nf-golden-ui.js` and `verify-nf-rules.js` — the two broad
suites — never the three report-specific ones, so this broke silently in an already-pushed commit until this
migration's full sweep caught it. Fixed all three to open the dropdown and click the matching `[data-goto]`
entry, the same pattern `export-real-reports.js` was already updated to use; re-ran each individually clean
(12/12, 11/11, 10/10), plus Director Report for completeness (18/18, unaffected — its own button was kept).

**Fixed at the source, not just the backfill, per the owner's own instruction** ("same discipline you applied to
gen-seed.js — fix it at the source so the next project inherits it correctly"): `import-awami-history.js` now
includes an explicit `UPDATE ... SET iif_exportable = false` for every voucher it creates, added after Awami's
own run (which predates the column) so the next historical import (KBH, FMH, or a re-run) copies a script that
already gets this right, rather than rediscovering the same bug. The file's own header now says plainly it's
historical/already-run and explains why that UPDATE is there despite never having executed for Awami's own data.

**New standing check added to `verify-nf-rules.js`**, per the owner's own instruction — `IIF-IMPORTED-NOT-EXPORTABLE`:
queries real Awami data directly (not the ZZTEST fixture) and fails if any voucher whose narration or
`created_by` marks it as a historical import is ever `iif_exportable`. 52/52 after adding it.

Next: Part 2 (the pre-export validation gate — balance check, fresh-QuickBooks-chart account-name matching,
already-exported check, date-range/filename consistency) and Part 3 (per-account post-import reconciliation,
one row per COA code with both systems' figures and the difference — not the retired two-number
`reconciliations` table shape). Nothing gets imported into QuickBooks on this session's own judgment; the owner
reviews the generated file and the validation output first.

## 26 · IIF export, Parts 2 and 3 — the validation gate, the writer, and reconciliation (2026-09-19)

### 26.1 Format confirmed against real ground truth, not assumed

Before writing a line of the IIF generator, matched `docs/reference/Awami_Entries_import.iif`'s own JV-0001 row
("Token 102 received by FMH office - Cash" / "Token 102 - unit GF-129", 2026-07-10) directly against this
project's own live `nf_voucher_legs` for that exact voucher — figure for figure, voucher number and date
included. That gave the real field mapping, not a guess: `AMOUNT` = debit − credit (positive = debit, negative =
credit); `ACCNT` = the account's full colon-path; `NAME` = the leg's party name, with `:unit-code` appended only
for `21100` Token Money legs where a unit is identifiable (reusing the exact `unit ([A-Za-z0-9-]+)` extraction
from the Token Register, §20); `CLASS` = the floor's `qb_class`; `DOCNUM` = voucher_no; `MEMO` = the leg's own
memo. First leg → `TRNS`, remaining legs → `SPL`, then `ENDTRNS`. Also caught a real bug in a first draft: the
test fixture's own fake chart file used an invented field order rather than the real one — cross-checked against
`docs/reference/QB_COA_Awami.IIF`'s actual header (`!ACCNT NAME REFNUM TIMESTAMP ACCNTTYPE OBAMOUNT DESC ACCNUM
SCD BANKNUM EXTRA HIDDEN`, ACCNUM at index 7) before fixing it, not re-guessed.

### 26.2 `scripts/nf/iif-export.js` (Part 2 — the gate + writer) and `scripts/nf/iif-record-batch.js` (the only write step)

Deliberately two separate scripts, per the owner's own instruction that nothing gets marked exported on this
session's own judgment. `iif-export.js` only reads and writes a `.iif` file to disk; it never calls
`nf_iif_record_batch`. Four gates, all must pass before a file is written: (1) every candidate voucher balances,
checked directly against `nf_voucher_legs`, not assumed from `nf_post_voucher`'s own enforcement at posting time;
(2) every account code used byte-matches a **fresh** QuickBooks chart file supplied on the command line — never
a cached copy, reusing the exact parsing/matching logic already proven in `verify-nf-qb-accounts.js`; (3) no
candidate has a prior export record, re-checked directly even though `nf_iif_list_candidates` already excludes
these; (4) every voucher's date is really inside the requested range. `iif-record-batch.js` re-derives the exact
same candidate list rather than trusting anything cached from an earlier run, and leans on `nf_iif_record_batch`'s
own re-validation rather than duplicating it.

Both scripts run over the Management API's privileged connection (same channel `import-awami-history.js` uses),
which meant a real bug had to be fixed before either could work at all: `nf_iif_list_candidates`/
`nf_iif_record_batch` both call `nf_require_role`, which needs `auth.uid()` to resolve — but the privileged
connection has no session, and `set_config(..., true)` is transaction-local while `q()` is one HTTP request per
call (no state persists between calls). A first draft called `set_config` in its own earlier `q()` call, which
would have silently lost the claim before the RPC that needed it ever ran. Fixed by requiring `--as
<user_id>` and folding the `set_config` into the *same* statement batch as whatever RPC needs it, every time —
caught before it shipped, by tracing through `scripts/_sbq.js`'s own request-per-call shape rather than assuming
the earlier pattern would just work here too.

### 26.3 Tested end to end against a real temporary fixture, not Awami

Built a throwaway `ZZTEST-NF-IIF` company (seeded with the real Awami chart via `gen-seed.js`, same pattern every
`verify-nf-*.js` script already uses), posted one real token-money-style voucher matching the JV-0001 ground
truth exactly, then ran the full pipeline against it: `iif-export.js` found 1 candidate, all four gates passed,
and the generated file's `TRNS`/`SPL` rows matched the reference file's own layout and sign convention exactly.
`iif-record-batch.js` recorded the batch; re-running `iif-export.js` immediately after correctly showed 0
candidates (already exported). Two real bugs caught and fixed during this test, not before it: `nf_create_party`
returns a JSONB object, not a bare UUID — a first draft read `.id` off the wrong level and passed the whole
object where a UUID was expected; and the test's own cleanup called `_nf_test_purge` before deleting the new
`nf_iif_batch_vouchers` rows, which hit a real foreign-key violation (fixed by reordering, not by weakening the
constraint). Company, auth user, and every row confirmed fully purged after — checked directly, not assumed.

### 26.4 `scripts/nf/iif-reconcile.js` (Part 3) — validated against real data, with a real finding

Reads the same `TRNS`/`SPL` format the writer produces, sums every transaction line per account colon-path, and
compares against NexuFinance's own live per-account balances — one row per COA code, both figures and the
difference, explicitly not the retired `reconciliations` table's two-number shape. An account in only one system
still gets a row with the other side blank, never silently dropped.

Run against `docs/reference/Awami_Entries_import.iif` itself as a real test (not synthetic data): 8 accounts
matched exactly (21100 Token Money −3,280,000, 22100 FMH −20,124,450, 51100 Land 18,000,000, and five others, all
to the rupee). Three accounts showed a nonzero difference (16100, 53500, 60300) — checked by hand before
concluding anything, not assumed to be a reconciliation bug: grepped the reference file's own `TRNS` rows for
each account directly and summed them manually, and the manual sum matched the script's own `qb_balance` output
exactly (180,000 / 475,000 / 60,700) — proving the script's arithmetic is correct and the gap is real
incompleteness in this reference file (128 of our real 154 imported lines), not an error in either system. The
script also correctly surfaced a genuine stale-chart issue on its own: the file's "Cash & Bank:Cash with
Directors:Syed Yousaf Shah" (an account retired and replaced by "Due from Directors" per the owner's own Q9
decision, §11 — recorded in `gen-seed.js`'s own `RECEIVABLE_OVERRIDE`) shows up as a real gap against nf_accounts,
exactly the kind of drift a **fresh** chart export exists to catch, and exactly why the owner's own instruction
insisted on a fresh file rather than the cached one.

### 26.5 Where this stands

All three parts are built, tested, and pushed. **Nothing has actually been exported for Awami** — all 64 real
vouchers are correctly `iif_exportable = false`, and Awami has posted zero live vouchers through the app since
(zero `nf_days` ever opened), so `nf_iif_list_candidates` correctly returns empty for any real date range today.
This tooling is ready and proven correct against real ground truth; it has nothing real to do yet until Awami
has live, non-imported activity to export. When that day comes: run `iif-export.js` with a **fresh** QuickBooks
chart export, review the file and the four-gate validation output, then — and only then, on the owner's explicit
go — run `iif-record-batch.js`.

## 27 · Go-live readiness pass (2026-09-19)

### 27.1 A real open day already exists

Found during the readiness check, not created by this pass: `nf_days` for Awami has one real row — `DC-001`,
business date 2026-09-19, status `OPEN`, `created_by` the owner's own real login (confirmed directly, not the
system-import account or a diagnostic session) — created 2026-09-18 19:48, shortly after real director access
was granted this session. Zero lines/vouchers on it yet, so nothing financial has happened. Left untouched, per
the owner's own instruction — the Part 3 workflow dry run runs on a disposable fixture company instead, not
Awami, specifically so this real day is never touched by a rehearsal.

### 27.2 Real accounts — Syed Yousaf Shah gets `viewer`, deliberately, not `director`

The owner's own explicit decision, recorded here so it doesn't get "corrected" later: Syed Yousaf Shah (a real
director of the business) is added to `nf_members` with role `viewer`, not `director`. In this system `director`
can enter lines, close days, and reopen closed ones — real write access. Syed Yousaf Shah's own personal
receivable (`12610 Syed Yousaf Shah`, 7,660,900 as of the historical import) is itself recorded in these books.
Someone whose own personal balance the ledger tracks should not also be able to edit that ledger — standard
separation of duties, not a statement about trust. `viewer` gives him every report this pass built, with no write
path at all. **Blocked on the owner supplying his real email — not created, not guessed, no placeholder.** The
accountant slot stays empty for now; the owner will enter daily himself during the parallel-run period, using
his own existing login.

### 27.3 The three flagged go-live blockers — checked by test, not memory

**Party field — confirmed genuinely missing**, exactly as described: a token receipt from an unregistered
customer really is refused (`NF:PARTY_REQUIRED`, raised by the `nf_voucher_legs_guard` trigger — confirmed by
reading the real trigger, not assumed from the symptom) with no field on the daily-closing screen to fix it
from. The backend already had everything needed (`nf_save_line`'s own `p_party_name` resolve-or-create path) —
the gap was purely that neither `nf_day_json` nor `nf_list_heads` ever told the screen a party existed or was
needed. Confirmed `nf_lines` (what `nf_day_json` reads from) is a VIEW directly over `nf_voucher_legs`/
`nf_vouchers`, not a separate table — checked with `pg_get_viewdef` before touching anything, since a wrong
assumption here would have meant chasing the wrong bug entirely. Fix designed, written, and rehearsed
(`supabase/migrations/20260919i_nf_party_field_golive.sql`); proposed to the owner before applying, per standing
rule (changes the output shape of two existing functions other code already calls).

**Period locking tied to export — confirmed NOT built.** Read `nf_reopen_day` directly: no check at all against
export status. A director can currently reopen a day and edit vouchers already exported to QuickBooks, with
nothing to prevent or flag it. Real, open gap. Owner's own timeline: due before the first real IIF export, not
before go-live — not urgent today, tracked here so it isn't lost.

**Journal defaulting to "All time" — confirmed still unfixed**, exactly as recorded in §16.7.

Fix order, the owner's own instruction: party field first (blocking day-one use, ready to apply now), Journal
default period next (small), period locking after that (on its own later deadline) — one migration at a time,
not bundled, easier to verify and roll back if something surprises us.
