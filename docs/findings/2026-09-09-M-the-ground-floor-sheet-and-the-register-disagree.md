# M — Four Ground Floor units where the drawing and the register do not agree

**Found:** 2026-09-09, building the Ground Floor plate for the public availability link.
**Scope:** Awami Market, Ground Floor (274 units). Nothing was changed in the register.

## How this was found

Every room on these sheets is found by flooding from its printed number until
the fill hits ink, and then measured against the area the register holds. The
sheet's scale is derived from the rooms themselves, so the check cannot be
tuned: on the Ground Floor the typical room lands **1.2%** from its record, and
on the Lower Ground **1.4%**. Against that background, four units stand out.

## The four

| Unit | Register | The drawing | What it is |
|---|---|---|---|
| GF-201 | 288.60 sq ft | *no closed cell* | Front row, road side. The cell has no closed boundary on the sheet, so a flood runs out into the site. Pens from 2.5× to 20× were tried; none holds it. |
| GF-256 | 172.73 sq ft | *fill escapes* | A gap in the right-hand wall lets the fill run down into GF-257, GF-258, GF-259. Closing the gap with a wider pen leaves the room 72% smaller than the record. |
| GF-203 | 194.50 sq ft | **116.9 sq ft** (−40%) | A clean cell of its own, sitting on nobody. The walls are simply closer together than the register's area allows. |
| GF-205 | 186.82 sq ft | **252.1 sq ft** (+35%) | Likewise, a clean cell — and a noticeably taller one than its neighbours, which the register does not reflect. |

GF-203 and GF-205 sit in the same stack, and the stack's TOTAL is right:
the four shops GF-203..206 measure 738 sq ft drawn against 746 sq ft recorded.
So the boundary between GF-203 and GF-205 is drawn in a different place from
the one the register was written against — this looks like one wall moved, not
two areas mistyped.

## What was done

- GF-203 and GF-205 **ship with their drawn shapes**. The walls are where the
  walls are; only the area is in dispute, and the page prints the area from the
  register, so a dealer sees the number the office sells against.
- GF-201 and GF-256 **ship with no shape at all** and are recorded in
  `plans/known-gaps.json` with the reason. They still appear in the list view
  and can still be asked for; they simply have no tap target on the plate. The
  suite fails on any gap that is not written down there, and also on a written
  gap that has quietly fixed itself.

## What it needs from a person

Somebody who knows the building has to say which is right — the sheet or the
register — for GF-203 and GF-205. If the register is right, the drawing is a
revision behind and the two shapes are the wrong size on the plate. If the
drawing is right, two areas in the register are wrong, and those areas are what
the building is sold by.

Nothing here is urgent for the link: both units are drawn, tappable, and
labelled with the register's own area.
