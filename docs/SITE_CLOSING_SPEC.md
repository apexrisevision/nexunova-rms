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

- There is no `nf_lines` table any more (dropped in `20260919m`). A "line" is a voucher
  (`nf_vouchers`) with two legs (`nf_voucher_legs`): leg 1 = the head, leg 2 = the via account.
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
| `accountant`, `director` | read + write, return, reopen | as today |
| `viewer` | read | as today |

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
not touch the site box. REJECTED lines do not count.

**Never negative:** after every write, the book closing of that day and of every later day must be
≥ 0, otherwise the write is refused (`NF:SITE_CASH_NEGATIVE`).

## Rules (Stage 1)

- The first site day is started by HO with a typed opening (`nf_site_start_first_day`). Later days
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
- Reopen: a submitted day back to DRAFT (site or HO), only if no later day is submitted/merged. A
  MERGED day back to RETURNED: director only, with a reason, only while its combined closing is
  not CLOSED.

## Withdrawals (Bank → Cash / Bank → site cash box)

`nf_save_withdrawal(day, manual_no, 'Bank', 'Cash'|'Petty', amount, cheque_no, description)` posts
a BPV day voucher `Dr 10100|10200 / Cr 10300` on an OPEN HO day, through `nf_post_voucher` (so
the day lock, date rule, balance check, negative check and audit all apply). The cheque number goes
into the narration as `BOP chq #<no>` (what matching reads). A cheque already used by another
withdrawal is refused; the manual number is unique within BPV like every other voucher.

## Matching (Stage 2), screens (Stage 3), combined closing + exports (Stage 4)

To be written into this file as each stage is built. The rules in the owner's brief stand.
