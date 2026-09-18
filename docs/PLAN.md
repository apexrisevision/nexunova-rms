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
