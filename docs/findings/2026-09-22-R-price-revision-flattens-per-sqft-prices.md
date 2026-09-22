# R — The Projects page "Price revision" would flatten Awami's per-sq-ft prices

**Found:** 2026-09-22, during a check that every screen reads Awami prices from one place.
**Status:** recorded, not fixed.

## The one source (checked, fine)

Every place a unit's price is shown reads `units.base_price` live, with no copy in between:

- Database: `get_public_availability`, `get_availability_report`, `get_availability_board`,
  `get_reserve_desk`, `get_reservation_daybook` / `_daybook_held`, `get_my_reservations`,
  `get_map_plan`, `get_map_unit_detail`, `_get_unit_inventory_core`,
  `list_available_units_for_change`, `save_unit_quote` — each one selects `u.base_price` directly.
- RMS app: `js/store/db.js` builds `_unitsCache.basePrice` from `units.base_price`; units,
  search, projects and the new-sale form all read that.
- `scripts/shot-availability.js` confirms that all 1,469 Awami units on the link carry exactly the
  register's own total.
- The places that look like a second source hold nothing for Awami: unit-type `default_price` is empty on
  all 11 types, `project_price_revisions` has 0 rows, `unit_map_quotes` has 0 rows, and Awami has 0 sales.

## The trap

There are two tools that write prices, and they work differently:

| Tool | Where | What it writes |
|---|---|---|
| `update_availability_prices` | Link → Directors' Room | `area × rate` per unit, for a floor + unit range |
| `add_price_revision` | RMS → Projects → Price revision | **one flat TOTAL** for every unit of a *type* |

`add_price_revision` sets `base_price = p_new_price` on every **Available** unit of the chosen type,
across every floor, whatever its area. On Awami, "Retail Shop" is 574 available units across all
floors with 309 different totals (18k–194k per sq ft). One revision would give all 574 the same total:
a Lower Ground corner shop and a Second Floor shop would cost the same, and every per-sq-ft rate on the
link would change.

Both tools also skip every unit that is not Available. The link tool uses `_map_unit_state` plus
`is_available`, and the revision tool uses `status_name = 'Available'`.

## Smaller: an open RMS tab does not refresh prices

`_unitsCache` is loaded at sign-in and after the app's own edits. It has no realtime subscription and no
refetch when the tab comes back into view. A price changed on the link while an RMS tab is open shows the old
figure in that tab until it is reloaded. This is a stale view, not a second source.

## Options (not done)

1. Block `add_price_revision` for projects priced per sq ft, or hide the button for Awami.
2. Turn it into a per-sq-ft revision (`area × rate`) like the link tool.
3. Refetch `_unitsCache` on `visibilitychange`.
