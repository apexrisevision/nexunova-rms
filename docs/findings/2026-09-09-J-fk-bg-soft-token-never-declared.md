# `--fk-bg-soft` was never declared, so every use of it is the light fallback

**Found:** 2026-09-09, while building bulk actions on the Reserve Desk.
**Status:** my own new uses are fixed; the pre-existing one is NOT touched.

## What it is

`js/portal-reserve-desk.js` styles several pills as

```css
background: var(--fk-bg-soft, #F1F2F4);
color: var(--fk-text-muted);
```

`--fk-bg-soft` is not defined in any stylesheet in this repo — `grep -rn "\-\-fk-bg-soft" css/` finds
only the *uses*, never a declaration. So the fallback always wins, on every
theme. On the dark theme (which is what Rashid actually runs) that draws a
near-white pill carrying muted grey text: legible in a screenshot of the light
theme, close to invisible in use.

## What it changes for a live user

`.tg-off` is the pill on the desk's "Booked today" list that marks a row the
operator has undone. On dark it is a white pill with pale text. It is not
wrong information, it is unreadable information, and it appears exactly when
somebody is checking whether their Undo worked.

## Where

`js/portal-reserve-desk.js`, the `.tg-off` rule in the injected style block.

## Why it is not fixed here

Out of scope for the bulk-actions work, and `.tg-off` is a shipped surface with
its own screenshots. The fix is one token — `var(--fk-bg-subtle, #F1F2F4)`, or
the border + `--fk-bg-card` pattern the rest of the file uses — but it changes
how an existing row looks and should be reviewed as a design change rather than
slipped in beside a feature.

The two rules added by the bulk work (`.rd-uc.bad` and `.rq-us span`) were
written against declared tokens instead, so nothing new inherits the problem.
