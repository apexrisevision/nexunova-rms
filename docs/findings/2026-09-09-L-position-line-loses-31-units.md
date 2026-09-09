# The board report's position line did not add up — 31 units were in no column

**Found:** 2026-09-09, while shortening the daybook.
**Status:** FIXED the same day, on Rashid's word. Kept as the record of what was
wrong, and of the one wrinkle the fix does not reach.

## What it was

The Reservation Daybook opens with PROJECT POSITION and closes with Floor-wise
Position. Both are built from the `available` array the RPC returns, and both
stated:

```
TOTAL 1,467   SOLD 0   HELD 110   AVAILABLE 1,326
```

0 + 110 + 1,326 = **1,436**. Thirty-one units were counted in Total and in no
column. The floor table had the same hole and printed it as a footed total, so
four of its seven rows visibly failed to add up.

Asked of the database directly, before the fix:

| sold | hold | reserved | booked | other | available | total |
|---|---|---|---|---|---|---|
| 0 | 110 | 0 | 0 | **0** | 1,326 | 1,467 |

and `SELECT count(*) FROM units JOIN category_unit_statuses ON …
WHERE status_code IN ('SOLD_ENTRY_PENDING','PAGRI','LANDOWNER')` returned **31**.

## Why

`get_reservation_daybook` sorts each unit into sold / reserved / hold / booked /
other / available. The first four are matched on `tag_code`; `other` was written
as *"no reservation, and the unit's status is not an available one"*. That
catches a Dead or Mortgaged unit nobody has booked — and refuses a unit that IS
held, under a tag the project invented. Awami's Sold - Entry Pending, Pagri and
Landowner match none of RESERVED, HOLD or BOOKED, so the named buckets turned
them away and `other` turned them away too, for the crime of having a
reservation at all.

## What it changed for a live user

Twelve of those 31 are units Rashid has marked **Sold - Entry Pending**. The
report he prints for the board said SOLD 0. It understated how much of the
building is off the market by 31 units, and Available was the only headline
figure that stayed right — so the error read as *"we hold less than we do"*.

Page 1 also carried two figures about the same thing that disagreed: HELD 110,
and a Movement table four centimetres below it closing at 141.

## What was done

Two lines, in two places.

1. **`get_reservation_daybook`, the `other` bucket.** It now reads *"not sold,
   AND held under a tag that is not one of the three named ones, OR not held and
   not available"*. The six buckets are then exhaustive and disjoint by
   construction. Migration `20260909h`, applied to the function's own source
   text — it finds the old expression or raises — so the other 250 lines could
   not be retyped wrongly.
2. **The printed headline.** `tHeld` added reserved + hold + booked and left
   `other` out, so the four figures still would not have closed. It includes it
   now, which also makes HELD agree with the Movement closing balance: 141
   either way.

Awami now reads TOTAL 1,467 · SOLD 0 · HELD 141 · AVAILABLE 1,326, of which on
hold 110 and under other tags 31. Every floor row balances on its own.

`sold` was deliberately NOT changed. It still means a row in `sales`. Sold -
Entry Pending is a unit somebody has agreed to buy with no sale recorded
against it; counting it as sold would put revenue on a board report that exists
nowhere in the books.

## The assertions that were missing

`scripts/shot-daybook.js` now checks the property rather than the symptom: every
floor row and the footer must equal the sum of their own columns, the printed
position line must equal its own parts, and HELD must equal the Movement closing
balance. Nothing tests for Pagri or Landowner by name, so a seventh tag invented
next month is caught by the same lines.

All of them were watched failing before being left green — the old rule,
recomputed read-only, puts 4 floors out and the columns at 1,436 against 1,467;
and reverting `tHeld` by hand turns the two printed checks red.

## THE WRINKLE THAT REMAINS

`other` is the one figure in that table which is **not point-in-time**, and the
RPC has always said so: `units.status_id` carries no history, so a unit with no
reservation is bucketed by the status it wears *today*. Ask for a report dated
07 September and today's 141 held units have no reservation as at that date, yet
their current status is not available — so they land in `other`, and now, because
`other` is part of HELD, they land in the headline too.

Before the fix a back-dated report said HELD 0 with Other 141 in the table and a
total that did not add up. After it, the same report says HELD 141. Both are
wrong about 07 September; the second is wrong in a way that looks right, which is
worse. It cannot be closed from the reservation side — it needs a history of
`units.status_id`, which does not exist.

**Treat a back-dated daybook's position line as approximate. The Movement table
on the same page is exact, because it is built from reservations, which do carry
their dates.**
