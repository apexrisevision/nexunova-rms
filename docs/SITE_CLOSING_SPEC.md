# Site Closing — spec (NexuFinance, Awami Market)

Status: Stage 1 (database) built; Stages 2–4 to follow. Plain words first, details after.

## What it is for

Awami's money moves in two places:

- **Head Office (HO)** — the CFO posts day lines (CRV / CPV / BRV / BPV, `nf_save_line`) and JVs
  (`nf_jv_save`) into the NexuFinance books.
- **Site** — the site accountant keeps the site cash box and takes token money. Today on Excel.

The site accountant gets his own **Site Closing**: an Excel-like grid per business date. He
enters receipts and payments, counts the cash box and submits. Each submitted site line is
matched against HO's entries so nothing is booked twice. HO reviews the match, and only when no
conflict is left does the date get **one combined closing** (HO cash + site cash + bank), which
drives the Excel day sheet and the QuickBooks IIF.

## Facts checked live (2026-11-17), not assumed

- `nf_lines` is a **view** (the old table was dropped in `20260919m`). A "line" is a voucher
  (`nf_vouchers`) with two legs (`nf_voucher_legs`): leg 1 = the head, leg 2 = the via account.
  The view leaves out any voucher whose leg 1 is itself a cash/bank account, so withdrawals
  (`Dr 10100 / Cr 10300`) and transfers are NOT in it: matching reads vouchers + legs directly.
- Via accounts: **Cash = 10100**, **Petty = 10200**, **Bank = 10300 (BOP)**. 10200 has never been
  used (0 legs), so it becomes the **site cash box**. HO cash stays 10100.
- HO's day `e4da11d4…` (DC-007, dated 05-Oct, OPEN) holds 243 vouchers since 05-Oct; the real date
  sits in the narration ("BOP chq #1313826265 cashed 16-Nov"). It is not moved or re-dated.
- The spec's "BPV-0046" is the **manual** number; its system number is `BPV-000047`. Matching and
  screens must use both (see the two-number rule).
- Bank→Cash withdrawals: 13 exist, all `Dr 10100 / Cr 10300`, source DAY. There was no day-line
  path that produces this shape; Stage 1 adds one (`nf_save_withdrawal`).
- Roles in `nf_members`: accountant, director, viewer. Every read report already names its roles
  explicitly, so a new role is refused by all of them; but every table's SELECT policy only asks
  `nf_is_member(company, false)`, which would have let a new role read the whole ledger.

## Roles

| Role | Site days / lines | HO books, bank, reports |
|---|---|---|
| `site` (new) | read + write (DRAFT / RETURNED days only), submit, withdraw a submission | **none** — not even a table SELECT |
| `accountant`, `director` | read, start the first day, return (with reason); director reopens a merged day | as today |
| `viewer` | read | as today |

**HO never edits a site line** (owner, 2026-11-17). The site record stays exactly as the site
accountant entered it. HO either returns the day with a reason, or corrects head / party on the HO
voucher when it accepts the line (Stage 2).

`nf_is_member()` (used only by the table SELECT policies) now ignores `site` members, so a site
user cannot read `nf_vouchers`, legs, days, PDCs, parties or accounts directly. He reads heads and
units through `nf_site_list_heads` / `nf_site_list_units` only.

## Tables

**`nf_site_days`** — one per company per business date.
`status`: `DRAFT` → `SUBMITTED` → `MERGED`; `SUBMITTED` → `RETURNED` (HO, with reason) →
`SUBMITTED`; `SUBMITTED` → `DRAFT` (withdrawn before review). Fields: `opening_cash` (typed by HO
on the first day only; frozen at merge), `counted_cash`, `denominations`, `book_closing`,
`variance`, `variance_reason`, `submitted_*`, `returned_reason`, `merged_*`,
`combined_closing_id`, `version`, audit fields.

**`nf_site_lines`** — `side` IN/OUT, `doc_no` (printed receipt/voucher no), `party_name`,
`unit_codes`, `token_no`, `head_code`, `via` SITE_CASH/BANK, `amount`, `bank_ref`, `remarks`,
`attachment_url`, `match_status` NEW/DUPLICATE/POSSIBLE/CONFLICT/ACCEPTED/REJECTED/LINKED,
`matched_voucher_id`, `match_reason`, `posted_voucher_id`, `version`, audit fields.

**`nf_combined_closings`** — one per company per date: `ho_cash`, `site_cash_book`,
`site_cash_counted`, `bank`, `snapshot` (every voucher id), `status` OPEN/CLOSED, `closed_*`,
`excel_exported_at`, `iif_batch_id`. Structure only in Stage 1; filled in Stage 4.

All three: RLS on, SELECT only through a role-checked policy, no write grants at all (every write
is a SECURITY DEFINER function), every row change audited by the existing `nf_audit_row` trigger.

## Site cash book

`book_closing(date) = first day's opening + Σ site-cash IN − Σ site-cash OUT` over every site day
up to and including that date. A day's opening is the previous day's book closing. BANK lines do
not touch the site box. Every SITE_CASH line counts **except REJECTED**; LINKED, DUPLICATE and
ACCEPTED lines still count, because the cash physically moved through the site box.

**Never negative:** after every write, the book closing of that day and of every later day must be
≥ 0, otherwise the write is refused (`NF:SITE_CASH_NEGATIVE`).

## Rules (Stage 1)

- The first site day is started by HO with a typed opening (`nf_site_start_first_day`). At go-live
  that opening is the cash counted in the box that day, typed once by HO. Later days
  are created by the first line saved on them; a date before the first day is refused. No future
  dates (Pakistan time).
- Lines change only while the day is DRAFT or RETURNED. Saving a line puts it back to NEW and
  clears any match. A line already posted to the books cannot change.
- Token head (21100) needs a token number. Heads are the HO heads (no cash/bank accounts).
- A printed doc no is never repeated on the same side (receipts / payments).
- Submit needs the cash count (or denominations). Book closing is computed; a variance needs a
  reason. The previous site day must already be submitted or merged. A stale screen (old
  `version`) cannot submit.
- Return (HO) needs a reason. Any later day that was already submitted is returned with it, since
  its opening is about to change. Not allowed if a later day is merged.
- Reopen: a submitted day back to DRAFT (the site accountant only; HO returns instead), only if no later day is submitted/merged. A
  MERGED day back to RETURNED: director only, with a reason, only while its combined closing is
  not CLOSED.

## The real business date on a voucher

`nf_vouchers.real_date` (new, nullable). HO's vouchers all sit on one long-running day, so
`voucher_date` is that day's date, not when the money moved. Every voucher made by a new path
carries the real date in `real_date`; older vouchers keep it empty. Matching (Stage 2) and the
combined closing (Stage 4) use `real_date` when present and only fall back to reading the date out
of the narration for older vouchers.

## Withdrawals (Bank → Cash / Bank → site cash box)

`nf_save_withdrawal(day, manual_no, 'Bank', 'Cash'|'Petty', amount, cheque_no, description, real_date)`
(real date required, not in the future) posts
a BPV day voucher `Dr 10100|10200 / Cr 10300` on an OPEN HO day, through `nf_post_voucher` (so
the day lock, date rule, balance check, negative check and audit all apply). The cheque number goes
into the narration as `BOP chq #<no>` (what matching reads). A cheque already used by another
withdrawal is refused; the manual number is unique within BPV like every other voucher.

## Stage 2 — matching (migration `20261118a_nf_site_matching.sql`, not applied)

**When:** on Submit, and when HO presses "Re-run match" (`nf_site_match`). Only lines HO has not
decided are (re)matched.

**HO's date for a voucher:** `real_date` if set; else the first "16-Nov" / "16 Nov" in the narration
(year of the day it was keyed; a year earlier if that would be in the future); else the day it was
keyed (Pakistan time). Only day vouchers are candidates (JVs never touch cash or bank).

**Kinds of site line:** site-cash in / out; bank in / out; "Bank to Cash" (a site-cash IN line whose
head is the bank, 10300) and "Cash to Bank" (OUT). The Excel file's mirror line in the Bank column is
the same event and is not keyed twice.

**Rules, in order:**
1. *Strong key*, HO date within 3 days: the cheque (full number or the last digits the site wrote,
   read from narrations after "#", "chq", "cheque"; "6257/6258" is two), a bank / Raast / TT ref, the
   token # (token money), the paper doc no = an HO manual no. Amount and kind agree → DUPLICATE
   (bank lines → LINKED). They do not → CONFLICT, with both stories in the reason.
2. *Soft*: same amount, HO date within 2 days, and evidence: the party name, the same head, two shared
   words (≥ 4 letters), or the HO entry says it was paid from a cheque the site drew into its box that
   day. A site-cash line HO booked from HO cash **on the same day** with that evidence → DUPLICATE
   "source mismatch"; otherwise POSSIBLE. Two equally good HO vouchers → POSSIBLE.
3. *Nothing*: site cash → NEW; anything touching the bank → CONFLICT "missing at HO" (HO posts it,
   then re-runs the match).

Afterwards: a withdrawal plus a same-day cash payment of the same amount that both point at ONE HO
bank payment are one event (**pass-through**: both DUPLICATE, nothing posted, nothing moved). Two
other lines claiming one HO voucher → both POSSIBLE. A voucher HO already settled against another
day's site line → CONFLICT.

**What Accept does** (HO only; the site record never changes):

| Status / proposal | Accept |
|---|---|
| NEW | posts a CRV / CPV from the site box (10200) through `nf_save_line`; manual no = paper no (`212/1`, `212/2` when one voucher has several lines) or `SITE-YYYYMMDD-n`; real_date = site date; token lines written as "Token #N — Name, Units FF 120, FF 121 and FF 196 (…)" so the token ledger reads them; HO may give another head / party |
| DUPLICATE · reroute | HO's voucher moves from HO cash to the site box through `nf_save_line` (versioned edit), HO head kept |
| DUPLICATE · transfer | `nf_save_transfer` Cash → site box (or back), dated, voucher `XFR-SITE-n` |
| DUPLICATE · link / pass-through | nothing posted |
| LINKED (bank, automatic) | HO confirms |
| POSSIBLE / CONFLICT | refused: settle with Mark duplicate, Link or Reject (or fix HO's voucher and re-run) |

Reject needs a reason and takes the line out of the site cash book (refused if the box would go below
zero). A site user sees only each line's status; HO's voucher, reason and proposal are withheld from
him, in the functions and at column level.

**Changes to Stage 1:** a paper doc no may repeat on lines of the same day (one voucher, two heads —
Sharose's 212), never on another day. A line HO has decided cannot be edited or deleted by the site.
HO may delete or re-key its own voucher while a site line is only matched to it (the match is
cleared); not once a decided line rests on it (`NF:VOUCHER_SETTLED_BY_SITE`).

**Transfers:** `nf_set_transfers` keeps one undated running transfer per HO day, and HO's day has
been open since 05-Oct, so site transfers use `nf_save_transfer` (dated, one voucher each).

**Accepted by the owner (18-Nov):** dated `XFR-SITE-n` transfers through `nf_save_transfer`; the same
paper voucher number on the same day (posted as n/1, n/2); HO may delete / re-key its own voucher only
while the site line resting on it is undecided; the site user sees status only. Sakhi Jan #209 (bank,
nothing at HO) is a CONFLICT "bank line missing at HO" — HO confirms it against the BOP statement
before posting it.

**Heads:** the head-name mapping in `verify-nf-site-closing-stage2.js` is test-only (it stands in for
the file's Excel names). In real use the site accountant picks from the HO head list, shown as plain
names with no codes.

## Stage 3 — screens (built 18-Nov, not deployed)

**Site Cash Book** (`js/nf/nf-site-closing.js`, `css/nf/nf-site-closing.css`): the only screen a
`site` member sees — the login sends him straight there, with no Reports menu and no link back to
RMS. Mobile-first: each line is a card on a phone and one spreadsheet row on a wide screen.
- Date picker: no future date, and no day after one not yet sent to head office.
- "Money received" / "Money paid": Receipt / Voucher no., From / Paid to, Unit(s) (from RMS), Token #,
  For (plain head names, plus "Cash drawn from bank" / "Cash deposited in bank"), Cash, Bank,
  Cheque / Ref, Remarks, Bill photo, Status. No account codes, no Dr/Cr.
- Each line saves on its own when the person leaves the row (or presses Save), version-checked;
  only that row is redrawn. A line changed elsewhere: "Someone else changed this just now", the
  latest is shown, the stale change is not saved.
- Tiles: Opening cash, Received, Paid, Should be in hand (plus the day's bank lines in a note).
- Cash count drawer: 5000 / 1000 / 500 / 100 / 50 / 20 / 10 notes and coins; counted, difference, a
  required reason when it is not zero; "Send to head office" (`nf_site_submit`).
- After sending: read-only, a status badge per line (New / Duplicate / Possible duplicate / Linked /
  Conflict / Accepted / Rejected) — never HO's voucher or reason. Sent back: HO's reason in a banner,
  editable again (lines HO has already settled stay as they are).

**Site Closing for head office** (`js/nf/nf-site-review.js`), in the Reports menu: the site days with
status and totals; a day with every line beside the HO voucher it matched (number, real date,
amount, head), the status, the reason (head codes shown as names) and what Accept would do.
Conflicts first, then possible duplicates, duplicates, new; decided lines last. Accept (optional head
/ party on the HO voucher), Reject (reason), Link to… and Mark duplicate (search HO vouchers by
amount, number or words), Accept all new, Re-run match, Return day to site (reason). A viewer reads
only.

**Bill photos** live in the private bucket `nf-site-bills` (`20261118b`, applied 18-Nov) under
`<company>/<date>/`: the site accountant adds them; he and head office open them (HO from a "Bill photo"
button on the line); nobody replaces or deletes one. "Link to…" searches HO vouchers by real date too
(the date written in the narration for vouchers keyed before real dates existed).

**Found by the browser test:** Stage 2's match function had an `UPDATE` with no `WHERE`, which the
app's database door (PostgREST's safe-update guard) refuses — so "Send to head office" and "Re-run
match" fail for a real user. Fix: `20261118c_nf_site_match_safeupdate.sql` (not applied).

## Stage 4 — combined closing + exports

### QuickBooks account names in the IIF (owner, 18-Nov)

The IIF export maps every NexuFinance account to its QuickBooks **full account name** through an
explicit mapping, and never writes a NexuFinance display name as a QuickBooks account name.

- 10300 → `Cash & Bank:BOP (Bank of Punjab)` — the account every IIF imported since late September
  has used. NexuFinance's display name "BOP - 14 Group of Companies" and the old QuickBooks name
  "Bank Al-Habib - Awami Market" are never written.
- 10100 → `Cash & Bank:Cash in Hand`.
- 10200 (the site cash box, "Petty Cash") → needs an explicit entry. The 18-Sep reference chart has
  `Cash & Bank:Petty Cash` (number 10200), but that chart is stale (it also carries the old bank name),
  so this must be **confirmed against the live QuickBooks file before the first IIF that touches
  10200**. If it is not there, it is listed as a new QuickBooks account to create — never a name
  invented by the exporter.
- Every other account → the existing mapping.
- No account is renamed, in either system.

The 8 NexuFinance-only accounts (12700, 15500, 15600, 21150, 52550, 52650, 52950, 70950) were
added on purpose and are created in QuickBooks with the next IIF batch.

The reference chart `docs/reference/QB_COA_Awami.IIF` (~18-Sep) is stale; `verify-nf-qb-accounts`
against it reports these 9 differences, accepted as known.


### Fixes after the screenshot review (19-Nov)

- Every line needs its Receipt / Voucher No. and From / Paid to: the screen refuses to save without them;
  `20261119a` (not applied yet) makes `nf_site_save_line` refuse them too (`NF:SITE_DOC_NO_REQUIRED`,
  `NF:SITE_PARTY_REQUIRED`). The same paper number on the same day still posts as n/1, n/2.
- Money paid shows Unit(s) and Token # only under a token head (token money / not allotted); money
  received always shows them. A payment under another head is saved with no unit or token #.
- On a phone each line is one compact row — No. · name · head · amount · status · bill — and opens to the
  full form on a tap; a new line starts open. A wide screen keeps the full row.
- Dates read 13-Nov-2026 on both screens (the native picker stays, with the date written beside it).
