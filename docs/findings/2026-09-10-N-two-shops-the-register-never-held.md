# N — Two First Floor shops the register never held, and two areas it had wrong

**Found:** 2026-09-10, reading the First Floor sheet for the public link.
**Acted on:** the same day, on Rashid's instruction. The register was changed.

## What was found

Rashid asked for a complete cross-check of every floor against the drawings
before anything was added. Every unit number on all seven sheets was read and
matched against the register, both ways:

| Floor | Register | On the sheet | In the register, not drawn | Drawn, not in the register |
|---|---|---|---|---|
| LG | 168 | 168 | — | — |
| GF | 274 | 274 | — | — |
| **FF** | **298** | **300** | — | **FF-83A, FF-159A** |
| SF | 305 | 305 | — | — |
| TF | 150 | 150 | — | — |
| 4F | 136 | 136 | — | — |
| 5F | 136 | 136 | — | — |

Nothing the register holds is missing from a drawing. Two shops the drawings
hold were missing from the register: **FF-83A**, drawn between FF-83 and
FF-84, and **FF-159A**, drawn between FF-159 and FF-160. Both are full shops on
the sheet — SHOP, dimensions, an area, and a buyer's name written on them by
the draughtsman.

## And two areas that did not agree

The area PRINTED on the sheet was read for the whole column — not measured,
read, character by character, the same way the unit numbers are:

| Unit | The sheet prints | The register held | |
|---|---|---|---|
| FF-83A | 171.23 | *nothing* | created |
| FF-159A | 171.23 | *nothing* | created |
| FF-84 | 171.23 | 198.00 | corrected |
| FF-160 | 171.23 | 198.00 | corrected |
| FF-83 | 183.56 | 183.56 | agreed — left alone |
| FF-159 | 183.56 | 183.56 | agreed — left alone |

Reading the print mattered. Measuring the rooms by flood said all six cells
were the same size to within a percent, which would have made FF-83 look wrong
too. The sheet's own numbers say otherwise, and the sheet's own numbers are
what the building is sold by.

## What was changed

- `FF-83A` and `FF-159A` inserted: Retail Shop, First Floor, 171.23 sqft,
  PKR 7,705,350 at the floor's own rate of 45,000/sqft, status Available.
- `FF-84` and `FF-160`: area 198.00 → 171.23, price 8,910,000 → 7,705,350.

Nothing anywhere pointed at those four units — no sale, no booking, no
reservation, no lead, no transfer — so the areas could be corrected without
touching a record of money already taken. Checked before writing, against
every foreign key that references `units`.

Awami Market now holds **1,469 units**; the First Floor holds **300**.

## What still needs a person

The names the draughtsman wrote on these shops (ASAD on FF-83A, AMIN on FF-84
and FF-160, NAEEM on FF-159) are not in the register: all of them are
**Available** there. Those names are on the sheet for many shops that the
system says are free, so they are the architect's record and not the office's.
Nobody should read them as sales — but somebody should look at whether the
building has allotments the RMS has never seen.

The two Ground Floor units in finding M (GF-203, GF-205) are still open. Their
printed areas can now be read the same way this one was.
