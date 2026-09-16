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

**Phase 1 is being built. It stops before any migration apply, deploy or push.**
