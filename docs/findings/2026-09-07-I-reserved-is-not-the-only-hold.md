# Finding I — "Reserved" is treated as the only kind of hold

**Found:** 2026-09-07, while fixing a bug of my own making.
**Status:** the two places that could lose or cancel a booking are FIXED
(`20260907h`). The two places listed under *Left alone* are recorded here and
have **not** been touched.

---

## What happened

The Reserve Desk gained three tags on 2026-09-07 — **On Hold**, **Reserved**,
**Booked** — where it had previously only ever stamped `RESERVED`.

Within the hour, Rashid booked Awami **LG-12** for Kabeer, tagged **Booked**,
and it appeared in neither the daybook nor the PDF. The row was in the database
and it was already cancelled:

```
created_at    2026-09-07 17:34:03.736509
cancelled_at  2026-09-07 17:34:03.736509     <- the same microsecond
cancelled_by  NULL                           <- nobody pressed anything
```

`public._sync_reservation_on_unit_status`, an `AFTER UPDATE OF status_id`
trigger on `units`, cancels every active reservation on a unit whose new status
is not one of `RESERVED, SOLD, SALE_REVIEW`. `reserve_unit_desk` inserts the
reservation and *then* stamps the unit, so tagging a unit On Hold or Booked
cancelled the reservation inside the same transaction — and left the unit
stamped with no reservation behind it, which also made it unbookable, because
`reserve_unit_desk` refuses a unit that is not available.

**This was mine.** The tags were added without checking what else keys on
`units.status_id`. `category_unit_statuses` was checked and `public.sales` was
checked; `pg_trigger` was not.

Blast radius, measured before repairing: **one unit**, Awami LG-12, with no sale
and no active reservation. Repaired by reviving the reservation, matched on the
trigger's fingerprint (`cancelled_at = created_at` with a NULL `cancelled_by`),
which nothing else produces — `cancel_reservation` always records who cancelled
and always runs later than the insert.

## The general shape

Five database functions hardcode the string `RESERVED`. Each had to be asked
whether it means *"this specific status"* or *"a unit somebody is holding"*.

| Function | Meant | Verdict |
|---|---|---|
| `_sync_reservation_on_unit_status` | a hold | **FIXED** — allow-list now includes HOLD and BOOKED |
| `get_reservation_daybook` (floor table) | a hold | **FIXED** — On Hold, Booked and Other now have columns |
| `get_reserve_desk` | the status | correct as written; the *client* reading it was not (below) |
| `get_availability_board` (counts) | a hold | **left alone** — see below |
| `seed_default_categories` | the status | correct — it creates all three |

Two client-side readers had the same assumption and are **FIXED**:

- the desk's unit lookup tested `u.s === 'reserved'` before showing the holder
  block, so typing a unit tagged On Hold named the status and nobody else — not
  who asked for it, not until when;
- `_patchAfterBooking` hardcoded `u.s = 'reserved'` and carried no tag, so a
  unit booked as On Hold painted itself Reserved until the next refetch.

## Left alone — deliberately

**`get_availability_board` counts.** `'reserved', count(*) FILTER (WHERE
st.status_code='RESERVED')`. A unit tagged On Hold or Booked is not in
`available`, not in `reserved`, not in `sold`. The consumer in
`sales-portal.html` draws its bar as `available / reserved / (total − available
− reserved)` and labels the third segment **"Sold / other"**, so the arithmetic
still closes and nothing disappears from the picture — the units are simply
lumped in with sold. The **"Reserved" figure under the bar undercounts** by the
number of held units that are not tagged Reserved.

Not fixed because it is a different screen from the one being worked on and its
numbers still add up. It will become visibly wrong the moment On Hold and Booked
are used in volume. One line in the RPC and one in the renderer.

**The unit map is fine and needs nothing.** `_map_unit_state` does not read
`units.status_id` at all — it derives state from active sales and active
reservations — so once the trigger stops cancelling them, a held unit reads
`reserved` and is drawn amber whatever its tag. Worth recording because it looks
like it should be affected and is not: it was only ever wrong for the window in
which LG-12 sat stamped BOOKED with its reservation cancelled, during which the
map offered it to clients as available, in blue.

## What changes for a live user

- **Rashid (Awami):** bookings tagged On Hold or Booked now survive. LG-12 is
  held for Kabeer again, to 14 Sep, without him re-entering it. Typing a held
  unit at the desk names its holder whatever the tag.
- **Any tenant:** the daybook's floor table no longer loses units — Awami had
  been printing `1,467` total above `0 + 0 + 1,466`.
- **Nobody yet:** the availability board undercount needs a tenant actually
  using the new tags before it shows.

## The rule this leaves behind

`reserve_unit_desk` has an allow-list of the tags the desk may apply, and
`_sync_reservation_on_unit_status` has an allow-list of the statuses that do not
release a hold. **They must be changed together.** A fourth tag added to one and
not the other makes the desk silently cancel its own bookings again, with no
error anywhere — the RPC returns success, and the row is cancelled by the time
the caller reads it.

The regression test lives in `scripts/shot-daybook.js`: it books one unit with
every tag the desk offers, inside a transaction that is rolled back, and fails
if any reservation is not still `active` afterwards. It is a database question,
not a rendering one, so no screenshot could have caught it.
