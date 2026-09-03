# PART A — BLUEPRINT

## A1. Purpose and boundary

**Purpose.** One place where every rupee entering or leaving a project is recorded once, verified daily, locked, and routed to (1) the cash book and Director PDF, (2) the RMS client ledger via CFO approval, (3) a QuickBooks export queue, and (4) a client receipt.

**Boundary.** This is a **cash book with routing**, not an accounting system. QuickBooks remains the book of record for P&L, balance sheet and ledgers. The module never computes profit, never holds a general ledger, never replaces RMS's client ledger — it feeds both.

## A2. The eight invariants

These hold everywhere: DB constraints, domain rules, API, UI, tests. A violation is a defect.

1. **Cash is a fact.** A saved `cash_entries` row is immutable. RMS approval or rejection never alters it. Rejection = `UNAPPLIED`, never delete.
2. **Opening is derived.** A day's opening = previous *CLOSED* day's closing. One setup opening exists per project, once, by CFO.
3. **Close locks.** After `CLOSED`, no edits, no deletes. Post-close change = adjustment entry (new row, `JV`, reason required, visible on PDF).
4. **Export once.** An entry is exported to QuickBooks exactly once. Files are date-stamped and retained.
5. **Receipts are advances.** Client money credits `2020 Advance from Customers`. `4010 Unit - Shop Sales` is credited only by the handover JV.
6. **Names from masters.** Payees and QB accounts are selected, never typed.
7. **Everything is audited.** Append-only `audit_log`: entity, id, action, actor, before, after, reason, time.
8. **Project-scoped.** Every row carries `project_id`; every query is scoped; every role is evaluated per project.

## A3. Architecture

```
┌──────────────────────────────── INTERFACE ────────────────────────────────┐
│  Web UI  ·  Day Workspace · Close Day · Pending · Unapplied · PDC · Exports │
│  REST API  ·  project-scoped · role-guarded · idempotent writes            │
└──────────────────────────────────────┬────────────────────────────────────┘
                                       │ use cases
┌──────────────────────────────────────▼────────────────────────────────────┐
│  APPLICATION SERVICES  (transaction boundary, emits domain events)        │
│  OpenDay · RecordEntry · VoidEntry · CloseDay · PostAdjustment             │
│  ApproveAllocation · RejectAllocation · ReapplyReceipt · RefundReceipt     │
│  ExportDay · RecognizeRevenue · RegisterPdc · ClearPdc · BouncePdc         │
└──────────────┬──────────────────────────────────────┬─────────────────────┘
               │ pure rules, no I/O                   │ events (after commit)
┌──────────────▼───────────────────┐   ┌──────────────▼──────────────────────┐
│  DOMAIN                          │   │  EVENT HANDLERS / JOBS               │
│  CashDay · Entry · Pdc · Money   │   │  AuditWriter · PdfRenderer           │
│  state machines · invariants     │   │  ReceiptRenderer · WhatsAppSender    │
│  voucher derivation · totals     │   │  DashboardCounters                   │
└──────────────────────────────────┘   └─────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE                                                           │
│  ORM/DB · FileStorage · PdfEngine · IifWriter · Clock(Asia/Karachi)        │
│  RMS ADAPTERS: UnitsPort · SchedulesPort · ReceiptsPort · HandoverPort ·   │
│                MessagingPort   (interfaces; implementations bind to RMS)   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Why ports.** RMS internals (units, schedules, receipts, WhatsApp) are reached through small interfaces. The module never queries RMS tables directly from a screen. This keeps Phase 1 buildable before Phase 2 adapters exist, and keeps RMS refactors from breaking the cash book.

## A4. Domain model and state machines

**CashDay** — one per project per business date.

```
(none) ──OpenDay──▶ OPEN ──CloseDay──▶ CLOSED  (terminal)
                     │                   │
              RecordEntry          PostAdjustment  (CFO · reason · new JV row)
              VoidEntry            ExportDay       (Phase 3)
```
Guards: at most one `OPEN` day per project · `OpenDay` requires previous day `CLOSED` (or no prior day + setup opening) · `CloseDay` requires `counted_cash` and `variance == 0 OR variance_note`.

**Entry** — immutable cash-book core + two independent routing statuses.

```
rms_status
  NA ────────────────────────────── (non-client entries; terminal)
  PENDING ──Approve──▶ POSTED       (terminal)
  PENDING ──Reject───▶ UNAPPLIED ──Reapply──▶ PENDING
                       UNAPPLIED ──Refund───▶ REFUNDED  (linked CASH/OUT entry; terminal)

qb_status
  NOT_EXPORTED ──ExportDay──▶ EXPORTED  (terminal)
```
Void = reversing row (`is_adjustment`, opposite direction, `adjusts_entry_id`), allowed while `OPEN`. Both rows remain.

**Pdc**

```
PENDING ──Clear──▶ CLEARED   (creates BANK/IN or BANK/OUT entry, linked)
PENDING ──Bounce─▶ BOUNCED   (client flagged; replacement cheque = new row)
```

## A5. Domain events

Emitted after commit; consumed by audit, rendering, messaging, counters. Payload always includes `project_id`, `actor_id`, `occurred_at`, entity id.

| Event | Consumers |
|---|---|
| `DayOpened` | Audit |
| `EntryRecorded` `EntryVoided` | Audit · DashboardCounters |
| `DayClosed` | Audit · PdfRenderer (Director PDF) · WhatsAppSender (P4) |
| `AdjustmentPosted` | Audit · PdfRenderer (regenerate, versioned) |
| `AllocationApproved` | Audit · ReceiptRenderer · RMS ReceiptsPort |
| `AllocationRejected` `ReceiptReapplied` `ReceiptRefunded` | Audit · Counters |
| `ExportGenerated` | Audit |
| `RevenueRecognized` | Audit |
| `PdcCleared` `PdcBounced` | Audit · Counters · RMS flag |

## A6. Data model

Adapt names to RMS conventions; keep semantics exactly.

```sql
cash_accounts        id, project_id, name, kind ENUM(CASH,BANK), qb_account_id, is_active
                     UNIQUE(project_id, kind, name)

cash_days            id, project_id, business_date DATE, status ENUM(OPEN,CLOSED),
                     opening_cash DECIMAL(18,2), opening_bank DECIMAL(18,2),
                     closing_cash DECIMAL(18,2) NULL, closing_bank DECIMAL(18,2) NULL,   -- set at close
                     counted_cash DECIMAL(18,2) NULL, variance DECIMAL(18,2) NULL, variance_note TEXT NULL,
                     denominations JSON NULL, closed_by, closed_at, version INT DEFAULT 0,
                     UNIQUE(project_id, business_date)

cash_entries         id, project_id, cash_day_id, seq_no INT,
                     idempotency_key UUID,   UNIQUE(project_id, idempotency_key)
                     entry_type ENUM(CLIENT_RECEIPT,EXPENSE,TRANSFER,LOAN_CAPITAL,OTHER),
                     mode ENUM(CASH,BANK) NULL, direction ENUM(IN,OUT) NULL,        -- NULL only for JV
                     voucher_type ENUM(CRV,CPV,BRV,BPV,JV), voucher_no VARCHAR(40),
                     amount DECIMAL(18,2) CHECK (amount > 0),
                     narration VARCHAR(500), payee_id, unit_id NULL,
                     qb_account_id, qb_override_reason VARCHAR(300) NULL,
                     qb_debit_account_id NULL, qb_credit_account_id NULL,             -- JV only
                     allocation_kind ENUM(DP,INSTALLMENT,ADVANCE,OTHER) NULL, allocation_ref VARCHAR(40) NULL,
                     expected_amount DECIMAL(18,2) NULL, variance_tag ENUM(SHORT,OVER,ADVANCE,OTHER) NULL,
                     variance_note VARCHAR(300) NULL,
                     rms_status ENUM(NA,PENDING,POSTED,UNAPPLIED,REFUNDED) NOT NULL,
                     rms_receipt_ref VARCHAR(64) NULL, rms_status_reason VARCHAR(300) NULL,
                     qb_status ENUM(NOT_EXPORTED,EXPORTED) NOT NULL DEFAULT 'NOT_EXPORTED', qb_export_id NULL,
                     is_adjustment BOOL DEFAULT FALSE, adjusts_entry_id NULL, adjustment_reason VARCHAR(300) NULL,
                     transfer_group_id UUID NULL,
                     created_by, created_at
                     -- NO updated_at. UPDATE/DELETE blocked (trigger) except columns:
                     --   rms_status, rms_receipt_ref, rms_status_reason, qb_status, qb_export_id
                     UNIQUE(project_id, voucher_type, voucher_no) WHERE is_adjustment = FALSE
                     UNIQUE(cash_day_id, seq_no)
                     CHECK (is_adjustment = FALSE OR adjustment_reason IS NOT NULL)

cash_entry_attachments  id, entry_id, storage_key, mime, size_bytes, uploaded_by, uploaded_at
payees               id, project_id NULL, name, normalized_name, kind ENUM(CUSTOMER,VENDOR,STAFF,DEALER,OTHER), is_active
                     UNIQUE(COALESCE(project_id,0), normalized_name)
qb_accounts          id, number CHAR(4), name VARCHAR(31), qb_type, is_active     UNIQUE(number) UNIQUE(name)
entry_type_defaults  entry_type, default_qb_account_id NULL, suggested_qb_types JSON
receipt_counters     project_id, year, last_no                  -- gapless receipt numbers
client_receipts      id, entry_id, receipt_no, storage_key, rendered_at, sent_at NULL, sent_to NULL
day_documents        id, cash_day_id, kind ENUM(DIRECTOR_PDF), version INT, storage_key, rendered_at
qb_exports           id, project_id, cash_day_id, file_name, storage_key, entry_count, checksum, exported_by, exported_at
pdc_register         id, project_id, kind ENUM(RECEIVABLE,PAYABLE), cheque_no, bank_name, amount, party_payee_id,
                     unit_id NULL, due_date, status ENUM(PENDING,CLEARED,BOUNCED), cleared_entry_id NULL,
                     bounce_note NULL, created_by, created_at
reconciliations      id, project_id, business_date, module_cash, module_bank, qb_cash, qb_bank, diff_cash, diff_bank, notes, actor_id, at
audit_log            id, project_id, entity, entity_id, action, actor_id, before_json, after_json, reason, at
                     -- append-only: no UPDATE/DELETE grants
```

## A7. Engineering standards

| Concern | Standard |
|---|---|
| **Money** | `DECIMAL(18,2)`, PKR. Never float. Sums in SQL or a decimal library. Display `Rs 1,234,567` (paisa shown only if non-zero). Negatives in parentheses. |
| **Time** | `business_date` is a DATE in **Asia/Karachi**. All timestamps stored UTC, displayed Asia/Karachi. "Today" is computed in Asia/Karachi, never server-local. |
| **seq_no** | Assigned inside the insert transaction after `SELECT … FOR UPDATE` on the `cash_days` row. |
| **voucher_no** | Manual (physical book). Unique per `(project, voucher_type)`. Adjustments/JVs auto-number `JV-{YYYY}-{seq}`. |
| **receipt_no** | Gapless per project-year: `{SLUG}-R-{YYYY}-{000001}` via `receipt_counters` with row lock. |
| **Idempotency** | `RecordEntry` requires a client-generated `idempotency_key`; duplicate returns the original. `ExportDay` idempotent by day. `RecognizeRevenue` idempotent by unit. `CloseDay` uses `cash_days.version` optimistic lock. |
| **Concurrency** | Two cashiers on one device or two devices: safe by seq_no locking + idempotency keys. Close while an entry is mid-save: entry insert checks status inside the same lock; loser gets `DAY_LOCKED`. |
| **Attachments** | jpg/png/pdf ≤ 10 MB; private storage; signed URLs (10 min); RMS's scanner if present. |
| **Performance** | Day Workspace first paint < 1.5 s with 500 entries; PDF render < 2 s; dashboard counters one indexed query each. |
| **Observability** | Structured log per domain event; counters: `entries_recorded`, `days_closed`, `exports_generated`, `pdf_render_ms`. |

## A8. API contract (Phase 1)

All under `/api/projects/{projectId}/daily-closing/…`. All write endpoints require `Idempotency-Key` header where noted.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/days?from&to` | Cashier+ | List with status, opening/closing, pdf link |
| POST | `/days` `{business_date}` | Cashier+ | OpenDay. 409 `PREVIOUS_DAY_OPEN` / 422 `SETUP_OPENING_REQUIRED` |
| POST | `/setup-opening` `{cash, bank, effective_date}` | CFO | Once per project |
| GET | `/days/{dayId}` | Cashier+ | Summary + entries |
| POST | `/days/{dayId}/entries` | Cashier+ · Idempotency-Key | RecordEntry. 409 `DAY_LOCKED`, `DUPLICATE_VOUCHER` · 422 `OVERRIDE_REASON_REQUIRED`, `UNIT_REQUIRED`, `VARIANCE_TAG_REQUIRED` |
| POST | `/entries/{entryId}/void` `{reason}` | Accountant+ | Creates reversing entry |
| POST | `/entries/{entryId}/attachments` | Cashier+ | Multipart |
| POST | `/days/{dayId}/close` `{counted_cash, denominations, variance_note?, version}` | CFO | 409 `VERSION_CONFLICT` · 422 `VARIANCE_UNEXPLAINED` |
| POST | `/days/{dayId}/adjustments` `{…, reason}` | CFO | Only when CLOSED |
| GET | `/days/{dayId}/documents/director-pdf` | Accountant+ , Director | Latest version, signed URL |
| GET | `/days/{dayId}/audit` | CFO, Director | Reverse chronological |
| GET/POST/PATCH | `/payees` | Accountant+ | PATCH = rename/deactivate only |
| GET | `/qb-accounts` | Cashier+ | Active list |
| GET | `/dashboard` | Accountant+ , Director | Counters + last 7 days |

## A9. Error taxonomy

Stable codes; UI maps each to a human message. Never leak stack traces.

`DAY_NOT_OPEN` · `DAY_LOCKED` · `PREVIOUS_DAY_OPEN` · `SETUP_OPENING_REQUIRED` · `DUPLICATE_VOUCHER` · `OVERRIDE_REASON_REQUIRED` · `UNIT_REQUIRED` · `VARIANCE_TAG_REQUIRED` · `VARIANCE_UNEXPLAINED` · `VERSION_CONFLICT` · `ALREADY_EXPORTED` · `NOT_AUTHORIZED` · `PAYEE_INACTIVE` · `ACCOUNT_INACTIVE` · `INVALID_TRANSITION`

## A10. Security and privacy

- **Authorization** is object-level: role × project on every request, evaluated server-side. UI hides, server enforces.
- **RBAC matrix**

| Action | Cashier | Accountant | CFO | Director |
|---|:-:|:-:|:-:|:-:|
| Open day, record entry, attach | ✓ | ✓ | ✓ | – |
| Void entry, payees CRUD | – | ✓ | ✓ | – |
| Setup opening, close day, adjustments | – | – | ✓ | – |
| Approve/reject allocation, export, PDC actions | – | – | ✓ | – |
| View days, PDFs, dashboard, audit | own project | ✓ | ✓ | ✓ (read) |

- **Documents** private; signed URLs; Director PDF omits client phone numbers; client receipt shows only that client's data.
- **Audit** append-only at the DB grant level.
- **Inputs** validated at the boundary; narration/notes sanitized; tabs/newlines stripped before IIF.

## A11. Design system — "Ledger"

**Character.** Quiet, precise, high-trust. It should feel like a well-set financial statement, not an admin template. Whitespace does the work; color carries meaning only.

**Principles**
1. Numbers are first-class: right-aligned, tabular figures, consistent width, never wrapped.
2. One accent per meaning: green = money in, rust = money out, amber = needs attention, grey = locked. Nothing else is colored.
3. Color is never the only signal — always paired with a label or icon.
4. No gradients, no illustrations, no decorative icons, no card-inside-card. Hairlines and spacing structure the page.
5. Every screen has defined loading, empty and error states.
6. Keyboard-first on desktop; thumb-first on mobile.

**Tokens** (CSS variables / theme object, namespaced `dc-`; map to RMS tokens where equivalents exist)

```
Color
  --dc-navy-900 #0B1B3A   header bands, PDF header
  --dc-navy-700 #1F3864   primary buttons, active states
  --dc-ink-900  #111827   primary text
  --dc-ink-600  #4B5563   secondary text
  --dc-ink-400  #9CA3AF   labels, hints, disabled
  --dc-line     #E5E7EB   hairlines
  --dc-canvas   #F6F7F9   page background
  --dc-surface  #FFFFFF   cards, tables
  --dc-in       #0F7B4C   --dc-in-bg  #ECF8F1
  --dc-out      #B42318   --dc-out-bg #FDF1EF
  --dc-warn     #B54708   --dc-warn-bg #FFF6E5
  --dc-lock     #6B7280   --dc-lock-bg #F3F4F6
  --dc-focus    #2563EB   focus ring (2px, offset 2px)

Type   Inter (fallback: -apple-system, Segoe UI, Roboto, sans-serif); font-feature-settings: "tnum" on all numerics
  --dc-t-xs 12/16   --dc-t-sm 13/18   --dc-t-md 14/20   --dc-t-lg 16/24
  --dc-t-xl 20/28   --dc-t-2xl 28/34  --dc-t-hero 40/44 (weight 600, letter-spacing -0.01em)
  Labels: 12/16, weight 500, uppercase, letter-spacing 0.06em, --dc-ink-400

Space  8-pt grid: 4 8 12 16 24 32 48
Radius --dc-r-sm 6px (inputs, chips)  --dc-r-md 10px (cards)
Shadow none by default; --dc-shadow-1: 0 1px 2px rgba(17,24,39,.06) for floating panels only
Motion 150 ms ease-out; opacity/transform only; no bounce; respect prefers-reduced-motion
Density table row 40 px desktop / 48 px mobile; input height 40 px / 48 px; touch target ≥ 44 px
```

**Components**

| Component | Spec |
|---|---|
| **HeroFigure** | Label (12 uppercase ink-400) over value (40/44, 600, tnum). Variant `in`/`out`/`neutral`. Used for Closing Cash / Closing Bank. |
| **StatusChip** | 24 px pill, 12/16 500. `OPEN` navy-700 on canvas · `CLOSED` lock on lock-bg with lock icon · `PENDING` warn · `POSTED` in · `UNAPPLIED` out. |
| **VoucherChip** | Monospace-feel (tnum), 13/18 600, hairline border. Shows derived CRV/CPV/BRV/BPV; updates instantly. |
| **SegmentedControl** | For Type / Mode / Direction. Full-width on mobile. Keyboard ← →. Selected: navy-700 text, 2px underline. |
| **MoneyInput** | Right-aligned, 20/28 tnum, live thousands separators, `Rs` prefix inside field, numeric keyboard on mobile. |
| **EntitySelect** | Typeahead; shows 5 recents first; "+ New payee" as last option (Accountant+). Never allows free text. |
| **SuggestedField** | Select with a `Suggested` tag (12, ink-400). On change → reveals `Reason for override` (required) with amber left border. |
| **LedgerTable** | Hairline rows, 40 px, sticky header and sticky totals row; In column green text, Out column rust text; voided rows struck-through at 60% opacity with a link icon to their reversal. |
| **VarianceBanner** | Amber bg, left border 3 px warn, icon, text, inline required field. |
| **DenominationCounter** | Rows 5000/1000/500/100/50/20/10 · count input · line total (tnum) · grand total sticky. |
| **LockBadge** | Lock icon + "Closed 19:05 · CFO" in lock color. |
| **EmptyState** | 48 px icon (outline), one sentence, one primary action. |
| **Skeleton** | Grey blocks matching final layout; no spinners on primary surfaces. |
| **Toast** | Bottom-center, 3 s, one line, no stacking beyond 2. |

## A12. Screen specifications

### S1 · Day Workspace (the primary screen)

Desktop (≥ 1024 px): two columns 5/7. Mobile: single column, composer first, sticky totals bar at bottom.

```
┌─ Header ─────────────────────────────────────────────────────────────────┐
│ [Awami Market ▾]     Thursday, 03 September 2026     ● OPEN     [Close Day]│
│                                                                          │
│  CLOSING CASH            CLOSING BANK            ENTRIES                 │
│  Rs 90,723               Rs 51,000               12                      │
└──────────────────────────────────────────────────────────────────────────┘
┌─ Composer ───────────────────────────┐ ┌─ Ledger ───────────────────────┐
│ TYPE   Receipt · Expense · Transfer  │ │  #  VOUCHER  PAYEE     IN   OUT│
│        Loan/Capital · Other          │ │  1  CRV-0041 Yousaf K 150,000  │
│ MODE   Cash · Bank    DIR  In · Out  │ │  2  CPV-0112 PESCO         77,000│
│                              [ CRV ] │ │  …                             │
│ VOUCHER #  [ 0041      ]             │ │ ────────────────────────────── │
│ AMOUNT     [ Rs 150,000            ] │ │  TOTAL            150,000 77,000│
│ PAYEE      [ Yousaf Khan          ▾] │ └────────────────────────────────┘
│ UNIT       [ 915                  ▾] │
│ QB HEAD    [ Advance from Customers ▾]  Suggested
│ NARRATION  [ Installment #4              ]
│ [ Attach ]                    [ Save ⏎ ] │
└──────────────────────────────────────┘
```

Behaviour
- Tab order: Type → Mode → Direction → Voucher # → Amount → Payee → Unit (if Receipt) → QB Head → Narration → Save. `Enter` in Narration saves.
- Voucher chip appears the instant Mode + Direction are set.
- Save: toast "CRV-0041 · Rs 150,000 recorded", ledger row animates in (150 ms), hero figures update, form resets keeping Type/Mode/Direction, focus → Voucher #.
- Duplicate voucher → inline error under Voucher # with code `DUPLICATE_VOUCHER`.
- QB Head change → `Reason for override` slides in (150 ms) and is required.
- Ledger row actions (Accountant+): `Void` → reason dialog → reversing row appears; both rows linked.
- States: **Not opened** — EmptyState "No day open for 03 Sep" + `Open day` (and CFO-only setup-opening dialog if first ever). **Open** — as above. **Closed** — hero figures + LockBadge; composer replaced by `Add adjustment` (CFO) and `Director PDF` buttons; ledger read-only; adjustments listed in their own group with reasons.

### S2 · Close Day (right-side panel, 480 px; full-screen on mobile)

```
CLOSE DAY · Thursday, 03 September 2026
────────────────────────────────────────
                      CASH        BANK
Opening (B/F)       17,723       1,000
Received (In)      150,000      50,000
Paid (Out)          77,000           –
Closing (C/F)       90,723      51,000
────────────────────────────────────────
CASH COUNT
  5000 × [ 18 ]  =  90,000
  1000 × [  0 ]  =       0
   500 × [  1 ]  =     500
   100 × [  2 ]  =     200
    50 × [  0 ]  =       0
    20 × [  1 ]  =      20
    10 × [  0 ]  =       0
  Counted                   90,720
  System closing            90,723
  VARIANCE                     (3)   ← amber
  [ Reason for variance … ]   required
────────────────────────────────────────
[ Cancel ]                 [ Close day ]
```
Close is disabled until variance = 0 or a note is entered. Confirm dialog states the closing figures. On success: panel shows "Closed · PDF ready" with `Download` and `Share`.

### S3 · Days
Table: Date · Status · Closing Cash · Closing Bank · Variance · PDF. Project switcher. Last 60 days, infinite scroll. Row click → S1 for that day.

### S4 · Pending Allocations (Phase 2)
Table grouped by day: Unit · Client · Allocation (Inst #4 of 24) · Amount vs Expected · Variance tag · Voucher · Attachments (thumbnails) · [Approve] [Reject]. Bulk-approve for rows without variance. Reject → reason dialog.

### S5 · Unapplied Receipts (Phase 2)
Cards: amount, original unit, rejection reason, age. Actions: `Re-apply` (unit picker with lookup panel) · `Refund` (creates linked OUT entry).

### S6 · PDC Register (Phase 3)
Two tabs (Receivable / Payable). Filters: status, due window. Row: Cheque · Bank · Amount · Party · Unit · Due · Status. Actions: `Clear` (date) · `Bounce` (note). Due ≤ 7 days highlighted amber; BOUNCED rust.

### S7 · Exports (Phase 3)
Per day: file name · entries · checksum · exported by/at · download. `Export to QuickBooks` disabled if already exported (shows the existing file).

### S8 · Dashboard tile & Group Position (Phase 1 tile, Phase 4 group)
Tile: today's status + hero figures; four counters as links; last-7-days micro-table. Group Position: one row per project + total; same HeroFigure language.

## A13. Director PDF specification

A4 portrait · margins 18 mm · single page (overflow → "continued" page with header repeated) · Inter embedded · all numbers tnum.

```
┌───────────────────────────────────────────────────────────────┐ navy-900 band, 22 mm
│ FOURTEEN GROUP · AWAMI MARKET                       12/16 white 600 tracking .06em
│ Daily Closing — Thursday, 03 September 2026         20/28 white 500
├───────────────────────────────────────────────────────────────┤ 10 mm gap
│  CLOSING CASH                    CLOSING BANK                  12 label ink-400
│  Rs 90,723                       Rs 51,000                     32/36 600 ink-900
├───────────────────────────────────────────────────────────────┤ hairline
│                          CASH          BANK                    summary table 11/16
│  Opening (B/F)         17,723         1,000
│  Received (In)        150,000        50,000                    In rows green
│  Paid (Out)            77,000             –                    Out rows rust
│  Closing (C/F)         90,723        51,000                    bold, top hairline
├───────────────────────────────────────────────────────────────┤
│  RECEIPTS                                              label   ledger 10/14
│  Yousaf Khan · Unit 915 · Installment #4     CRV-0041   150,000
│  PAYMENTS
│  PESCO · Electricity bill                    CPV-0112    77,000
│  ADJUSTMENTS (if any)  reason shown in ink-600 italics
├───────────────────────────────────────────────────────────────┤
│  PDC PENDING
│  Ch# 10324055 · Rs 2,000,000 · due 30-06-2026 · BOUNCED — to be returned      rust
├───────────────────────────────────────────────────────────────┤
│  Cash counted Rs 90,720 · Variance (3): "short 3, cashier"     10/14 ink-600
│  Prepared  A. Khan · 18:42        Approved  CFO · 19:05
│  Generated 03-09-2026 19:05 · Confidential            v1       9/12 ink-400
└───────────────────────────────────────────────────────────────┘
```
Filename `{ProjectSlug}_Daily_Closing_{YYYY-MM-DD}.pdf`. Every regeneration (after an adjustment) increments `version` and keeps prior files.

## A14. QuickBooks integration

**Chart of accounts (live in Awami company file — names must match exactly):**

```
1010 Cash in Hand BANK · 1020 Petty Cash BANK · 1030 Bank Al-Habib - Awami BANK
1100 Accounts Receivable AR · 1120 PDC Receivable OCASSET · 1130 Staff Advances OCASSET
1140 Advances to Suppliers OCASSET · 1150 Prepaid Expenses OCASSET
1200 Units - Shops Inventory OCASSET · 1210 Development Work in Progress OCASSET
1500 Land FIXASSET · 1510 Building - Construction FIXASSET · 1520 Furniture & Fixtures FIXASSET
1530 Office Equipment FIXASSET · 1540 Computer & IT Equipment FIXASSET · 1550 Vehicles FIXASSET
1590 Accumulated Depreciation FIXASSET
2010 Accounts Payable AP · 2020 Advance from Customers OCLIAB · 2030 PDC Payable OCLIAB
2040 Salaries Payable OCLIAB · 2050 Commission Payable OCLIAB · 2060 Accrued Expenses OCLIAB
2100 Loan Payable - Short Term OCLIAB · 2200 Loan Payable - Long Term LTLIAB
2210 Directors - Related Party Loan LTLIAB
3010 Owner's Capital EQUITY · 3020 Owner's Drawings EQUITY
4010 Unit - Shop Sales INC · 4020 Advertising Unit Income INC · 4030 Processing Fee Income INC
4090 Other Income INC
5010 Cost of Units Sold COGS · 5020 Land Cost COGS · 5030 Construction - Development Cost COGS
5040 Dealer - Subdealer Commission COGS
6010 Salaries & Wages EXP · 6020 Security - Guards Expense EXP · 6030 Electricity & Utility Bills EXP
6040 Gas (Sui Gas) Bill EXP · 6050 Office Rent EXP · 6060 Office & Admin Expense EXP
6070 Printing & Stationery EXP · 6080 Marketing & Advertising EXP · 6090 Communication & Internet EXP
6100 Travelling & Conveyance EXP · 6110 Entertainment Expense EXP · 6120 Repair & Maintenance EXP
6130 Legal & Professional Fees EXP · 6140 Depreciation Expense EXP · 6150 Miscellaneous Expense EXP
7010 Bank Charges EXP · 7020 Financial - Markup Charges EXP
```

**Defaults.** CLIENT_RECEIPT → 2020 · CASH mode → 1010 · BANK mode → 1030 · TRANSFER → 1010 ↔ 1030 · EXPENSE → choose from 5xxx/6xxx/7xxx · LOAN_CAPITAL → choose from 2100/2200/2210/3010/3020.

**IIF (QuickBooks Desktop).** Tab-delimited · CRLF · dates `MM/DD/YYYY` · one balanced `GENERAL JOURNAL` per entry.

```
!TRNS    TRNSID    TRNSTYPE    DATE    ACCNT    NAME    AMOUNT    DOCNUM    MEMO
!SPL    SPLID    TRNSTYPE    DATE    ACCNT    NAME    AMOUNT    DOCNUM    MEMO
!ENDTRNS
TRNS        GENERAL JOURNAL    09/03/2026    Cash in Hand    Yousaf Khan    150000.00    CRV-0041    Unit 915 Installment #4
SPL        GENERAL JOURNAL    09/03/2026    Advance from Customers    Yousaf Khan    -150000.00    CRV-0041    Unit 915 Installment #4
ENDTRNS
```
IN → debit (+) mode account, credit (−) QB head. OUT → debit (+) QB head, credit (−) mode account. Transfers: debit destination, credit source. JVs: debit `qb_debit_account`, credit `qb_credit_account`. `NAME` = payee. `DOCNUM` = `{voucher_type}-{voucher_no}`. `MEMO` = narration, tabs/newlines stripped. Every transaction sums to 0.00.

## A15. Delivery plan and quality gates

| Phase | Prompts | Ships | Retires | Gate to next |
|---|---|---|---|---|
| 0 | P0 | Architecture notes, rules mapping | — | Questions answered |
| 1 | P1–P10 | Cash book · design system · Day Workspace · Close · Director PDF · roles · dashboard · tests · runbook | Excel | 14 consecutive days where module closing = Excel closing |
| 2 | P11–P13 | Unit lookup · allocation workflow · unapplied · client receipt | Manual RMS entry | 30 days, zero unresolved unapplied > 3 days |
| 3 | P14–P16 | IIF export · handover JV · PDC register | Manual QB entry | 4 weekly reconciliations with zero difference |
| 4 | P17 | Group position · reconciliation · WhatsApp | Chasing numbers | — |

## A16. Decisions required before P1

1. Who records entries day-to-day (CFO vs site cashier)?
2. Does RMS have an approval/pending workflow today?
3. Bank accounts per project, now and expected?
4. What RMS event marks a unit as handed over?
5. Director PDF: per project, consolidated, or both?
