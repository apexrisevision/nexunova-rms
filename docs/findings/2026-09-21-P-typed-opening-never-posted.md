# P · A first-day typed opening balance is never posted, so Cash & Bank and the ledger can disagree

**Found** 2026-09-21, while building drill-down stage 2 (Cash & Bank row → ledger).
**Status** OPEN, recorded rather than fixed. **Live Awami is not affected today**: its first day
(2026-09-19) was started with typed openings of 0 / 0 / 0, and nothing is posted to 10100/10200/10300
before that date (checked by query, 2026-09-21).

## What happens

Starting the first day (`nf_start_first_day`) stores the typed Cash / Petty / Bank openings on the
`nf_days` row (`typed_open_cash`, `typed_open_petty`, `typed_open_bank`). They never become a voucher.

Two families of report then start from different places:

| starts from the typed opening (`nf_ledger_position`) | starts from posted vouchers only |
|---|---|
| Daily Closing sheet, Director Report, Cash & Bank Movement | General Ledger, Trial Balance, Balance Sheet |

**The evidence:** the drill-down suite's disposable company types the golden day's openings (Cash
250,000). There, Cash & Bank showed 10100 closing **613,000**, while the 10100 ledger and the Balance
Sheet showed **363,000**. The 250,000 difference is exactly the typed opening.

The *movement* for any range (in − out) is the same on both sides. Only the opening differs.

## Why it matters

If a company ever starts its first day with a non-zero typed opening:
- the Balance Sheet will not show that cash;
- the Cash & Bank report and the ledger will disagree by that amount forever.

A drill from Cash & Bank or the Director Report into the ledger then lands on a different closing
figure than the one clicked.

## What the drill-down does about it

It does nothing to hide the gap. The two drills affected carry comments naming this file:
- Cash & Bank → ledger (`js/nf/nf-cash-bank.js`);
- Director Report cash row → ledger (`js/nf/nf-report.js`).

The suite (`scripts/nf/verify-nf-drilldown.js`, S2-08 and S2-15) asserts only that the movement ties,
and says why.

## The decision it needs (owner / accountant)

**Option 1.** Post the typed opening as an opening-balance voucher when the first day starts, against
an equity or suspense head. This is what QuickBooks does ("Opening Balance Equity").

**Option 2.** Forbid a non-zero typed opening when earlier history is imported, since the imported
history already carries the balance.
