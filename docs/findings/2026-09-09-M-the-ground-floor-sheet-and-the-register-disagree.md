# M — Two Ground Floor units where the drawing and the register disagree

**Found:** 2026-09-09, building the Ground Floor plate for the public link.
**Revised:** 2026-09-10, after four of the six suspects turned out to be faults
in my own reading rather than in the building. Nothing was changed in the
register.

## How this was found

Every room on these sheets is found by flooding from its printed number until
the fill hits ink, and then measured against the area the register holds. The
sheet's scale is derived from the rooms themselves, so the check cannot be
tuned: on the Ground Floor the typical room lands **1.2%** from its record, and
on the Lower Ground **1.4%**. Against that background, two units stand out —
and both of them stand out cleanly, sitting on no neighbour, with walls the
flood found on all four sides.

## The two

| Unit | Register | The drawing | |
|---|---|---|---|
| GF-203 | 194.50 sq ft | **116.9 sq ft** | −40% |
| GF-205 | 186.82 sq ft | **254.9 sq ft** | +36% |

They are in the same stack, and **the stack's total is right**: GF-203 to
GF-206 measure 738 sq ft drawn against 746 sq ft recorded. So one wall between
them is drawn in a different place from the one the register was written
against. That looks like a single wall moved in a revision, not two areas
mistyped.

Both ship with their drawn shapes — the walls are where the walls are — and
the page prints the **register's** area on them, which is the number the office
sells against.

## What it needs from a person

Somebody who knows the building has to say which is right for GF-203 and
GF-205: the sheet, or the register. If the register is right, the drawing is a
revision behind and two shapes on the plate are the wrong size. If the drawing
is right, two areas in the register are wrong — and areas are what the building
is sold by.

Nothing here is urgent for the link: both units are drawn, tappable, and
labelled with the register's own area.

## What this replaced

GF-201, GF-256, GF-139 and GF-49 were listed here as problems on 2026-09-09.
They were not. All four were my flood misreading the sheet, and all four now
match the register to within a percent:

- **GF-201** (483 sq ft) was thrown out by a size cap set at about 394 sq ft —
  a right answer discarded for being a big shop. **GF-139** (417) survived only
  by being squeezed under that cap by a nine-times pen, which is why its area
  then read small.
- **GF-256** was lost to a break in one wall. Widening the pen did not close
  it, because thickness runs across a line and not along it: a flat-ended
  segment ends where it ends, so a wall drawn twenty pixels thick still had the
  same one-pixel gap in the middle. A round cap on the pen closes it.

Both LG and GF now give **every unit in the register a shape** — 168 of 168 and
274 of 274 — and `plans/known-gaps.json` is empty, which is the state it should
be in.
