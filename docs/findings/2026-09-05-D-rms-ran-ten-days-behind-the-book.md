# Finding 2026-09-05-D — RMS was running ten days behind the receipt book

| | |
|---|---|
| **Found** | 2026-09-05, reconciling KBH August 2026 collections against QuickBooks |
| **Written up** | 2026-09-05 |
| **Status** | **RECORDED — nothing to fix in code, and nothing here authorises a data change.** |
| **Scope** | KBH data entry practice, `payments` / `sales` / `audit_logs`. Not a code defect. |
| **Severity** | Evidence. The figures are right; what they are evidence *of* is wrong. |

This is not a data error. Every figure reconciles. The finding is about **when** the rows were
written relative to when the money moved, and what that means for anything built on top of them —
the Daily Closing parallel run in particular.

---

## 1 · What the data says

Unit **UG-06**, Khushal Bagh Heights, buyer Arbab Zubair khan, PKR 4,900,000.

All system timestamps below are from `audit_logs`, converted from UTC to Pakistan Standard Time.
Dates in the *left* column that carry no time are typed dates, not system time.

| When | What |
|---|---|
| **18 Aug 2026** | The date the RMS receipt **claims**. `payments.payment_date` on PAY-2608-0085, CRV-10013, 4,900,000, `payment_method = 'cash'`. |
| **19 Aug 2026** | QuickBooks books the same 4,900,000 as **JV-939**, adjusted against Awami Market, Kharkhano. |
| **28 Aug 2026, 16:08:05** | Sale **SAL-2026-0009** is inserted. `sale_date` = 28 Aug. The audit row carries **no** `backdated_entry` flag — the sale was booked on the day it was keyed. |
| **28 Aug 2026, 16:08:07** | `sale_type_id` set, two seconds later, same session. |
| **28 Aug 2026, 16:21:39** | The 4,900,000 receipt is inserted — **13 minutes 34 seconds after the sale** — flagged `backdated_entry`, dated back to 18 Aug. |

The receipt's note was written at INSERT and has **never been edited since** (`audit_logs` holds
one row for this payment id and it is the INSERT). It reads, verbatim:

> the amount was not deposited/received into the company's bank or cash accounts and was stated to
> have been adjusted against Awami Market, Kharkhano … subject to proper supporting documentation
> and management approval.

Sale ids, for anyone re-checking this: `e9cdacc2-c95f-4b0f-973a-caaf9073142d` (SAL-2026-0009);
the payment is PAY-2608-0085 under company `3249e3b5-c411-4f5f-ae48-0246304c9c87`.

> **Careful:** `sale_number` is **not** unique across tenants in this database. `SAL-2026-0006`,
> `-0008` and `-0009` all exist for other companies too. Matching KBH sales by number instead of
> by id silently pulls in units 11-09 and 10-32, which are not KBH. Match on id.

---

## 2 · What it is evidence of

**The sale did not exist in RMS while the money was being accounted for.** QuickBooks carried the
transaction from 19 August. RMS had no unit sold, no buyer, and no receipt until the afternoon of
28 August — ten days later — at which point sale and receipt were created inside fourteen minutes
of each other and the receipt was dated backwards to a day the sale had not existed.

This is not unique to UG-06. It is how the whole month was entered. The August KBH payments were
keyed in five batches — 13 Aug, 15 Aug, 27 Aug, 29 Aug and 1 Sep — and **68 of the 78 received
lines carry the `backdated_entry` flag.** Entry lag runs from 2 to 18 days. Two of the three sales
booked in August were also entered late: SAL-2026-0006 was inserted on 15 Aug for a 5 Aug sale
date, and SAL-2026-0008 was inserted on 27 Aug and then had its `sale_date` edited backwards to
10 Aug in the same session.

So RMS in August was not a record of the business as it happened. It was a transcription of the
receipt book, made in batches, one to three weeks after the fact.

---

## 3 · The one-day gap, left open

The RMS receipt is dated **18 August**. JV-939 is dated **19 August**. The receipt was typed on
28 August, so the 18th is somebody's recollection or a copy from the receipt book, not a system
fact.

**Nothing in the database explains the difference and this finding does not guess at it.** The
candidates that would explain it are all outside RMS: the physical receipt date, the date the
adjustment was agreed with Awami Market, and the date the journal was posted are three different
dates and any two of them could be the pair in question. Ask the person who wrote CRV-10013.

Note also that CRV-10013 sits **outside** the KBH receipt series — the book runs 1190→1345 across
June to September, and 10013 is a five-digit number from somewhere else. CRV-10012 appears the same
way in July. Whatever book those two came from is not the one the rest of the month was written in.

---

## 4 · What would change for a KBH or FMH user

### 4a · Nothing, today

No figure moves. KBH's August total, the unit's ledger, the client's statement and the sale's
outstanding balance are all already correct and already agree with QuickBooks to the rupee. There
is nothing to correct and nothing to re-post. **This entry is a record, not a defect report.**

### 4b · It sets the bar the Daily Closing parallel run has to clear

The cash book's whole premise is a day that closes on the day it happened: `cash_days` has an
opening position, a counted-cash figure and a variance, and Invariant 1 makes a saved
`cash_entries` row immutable. That model assumes entries are made **on the day**.

August's actual practice was the opposite — a fortnight of receipts typed in one sitting, dated
backwards. If the cashier works the way KBH worked in August, the parallel run produces days that
were closed and counted long after the cash was counted, and the variance figure means nothing.

**This is the thing to watch in the parallel run:** not whether the totals match — they will — but
whether entries are made on the day they happen. The Daily Closing pilot should be measured on
entry lag as well as on agreement.

### 4c · Backdating is flagged but not surfaced

`audit_logs.reason = 'backdated_entry'` is written faithfully and is how this finding was
established at all — the mechanism works. But no RMS screen shows it. A director looking at the
August receipts list sees eighty rows dated across the month with nothing to say that sixty-eight
of them were typed in five sittings afterwards. Surfacing entry lag — a column, a chip, anything —
would be a small change with a large effect on how much a month's dates can be trusted. **Not
proposed here; it is a separate piece of work.**

### 4d · The UG-06 receipt's own note asks for something that has not been recorded

The note says the transaction is "subject to proper supporting documentation and management
approval". RMS holds no such document and no such approval against this payment: `receipt_url` and
`proof_url` are both null and there is no approval row. The receipt is carrying a condition that
nothing in the system tracks. Whether that matters is a business call, not a system one.

---

## 5 · Related

- The August reconciliation this came out of: three new sales 12,020,000 against QuickBooks'
  12,020,000, exact at sub-line level; older units 7,854,090 against 7,864,090.
- [2026-09-05-E](2026-09-05-E-bank-literal-never-matches.md) — a code defect found in the same
  pass, unrelated to this one.
- `docs/daily-closing/RULES.md` §0.1 and Invariant 1 — the day-closes-on-the-day model that §4b
  is measured against.
