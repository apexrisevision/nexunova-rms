# Daily Closing — DESIGN

The "Ledger" layer of `BLUEPRINT.md` §A11, built in P5. Tokens, components, formatters — no
business screen. The Day Workspace is P6.

## Open it

```
https://<your RMS domain>/daily-closing-kit.html
```

Sign in to **Awami Market** at `/login.html` first, in the same browser. The page reads that
session and asks the database for the company's feature flags; without `daily_closing` it shows
a locked notice and no kit. The flag is on for Awami and no one else (`20260904i`).

`?preview=1` renders the kit from sample data with no session — that is what the screenshot
script uses. There is nothing real on the page to protect; the gate exists so the module does
not appear to belong to a tenant that has not bought it.

## Files

| File | What |
|---|---|
| `css/daily-closing.css` | the `dc-` token set and every component style, **entirely scoped to `.dc`** |
| `js/foundation/dc-format.js` | money · date · time · `parseMoney` · `maskMoney`. Runs in the browser and under Node |
| `js/foundation/dc-kit.js` | `window.DCKit` — string-returning renderers plus the keyboard behaviour |
| `daily-closing-kit.html` | the story page, flag-gated |
| `scripts/verify-daily-closing-format.js` | 74 assertions: formatters, parsing, and computed WCAG contrast |
| `scripts/shot-daily-closing-kit.js` | screenshots at 375/1280, light and dark |
| `docs/daily-closing/design/*.png` | the four screenshots |

## Nothing outside the module changed

Every selector in `css/daily-closing.css` begins `.dc`. Khushal Bagh and FMH load the same
bundle and there is no rule that can reach them. `js/pages/users.js` is the only live file P5's
batch touches, and only to reveal the `cfo` role and the `dailyclosing` tick **behind the
feature flag** — that was P4's slice, and it is invisible to any tenant without the flag.

## Tokens are aliases, not a second palette

Where `css/foundation/tokens.css` already has a value, `--dc-*` points at it — so there is one
design system and dark mode arrives for free. Only what RMS genuinely lacks is new: the money
green and rust, the navy band, the 40 px hero.

| `--dc-` | maps to |
|---|---|
| `ink-900` `ink-600` | `--fk-text` · `--fk-text-muted` |
| `line` `canvas` `surface` `subtle` | `--fk-border` · `--fk-bg-page` · `--fk-bg-card` · `--fk-bg-subtle` |
| `focus` | `--fk-info` (#2563EB — tokens.css calls this the only sanctioned use, and a focus ring is not a brand colour) |
| `font` | `--fk-font` (Inter, already loaded by the app — no new webfont) |
| `navy-900/700` · `in` · `out` · `warn` · `lock` · the type scale · `hero` | new — RMS has no equivalent |

## ⚠️ Two measured departures from §A11

Both were found by computing WCAG 2.1 ratios, not by eye, and both are asserted by the test
suite so they cannot be silently reverted.

**1 · Labels do not use `--dc-ink-400`.** §A11 assigns `#9CA3AF` to "labels, hints, disabled".
On `--dc-surface` that is **2.54:1** — it fails AA for text (4.5) and fails even the 3:1
large-text floor. Labels use a new `--dc-ink-500` (`#6B7280`, §A11's own lock grey) at
**4.83:1**. `--dc-ink-400` is kept for **disabled** text only, which WCAG exempts.

**2 · `--dc-lock` is darkened.** §A11's `#6B7280` on its own `#F3F4F6` tint — the CLOSED chip —
is **4.39:1**, under AA by a hair. Darkened to `#5D6470`: **5.42:1**.

Every other pairing passes as specified. The suite prints the real number for each.

## Four things the 375 px screenshot found

The desktop layout got away with all four; a phone did not.

1. **A 40 px hero cannot share a 335 px row**, and its number is `nowrap` so it cannot shrink.
   Two of them inside a card overflowed it. Below 640 px the hero steps to 28 px and the row
   stops negotiating and stacks.
2. **§A11 asks for a full-width segmented control on mobile.** That is right for two or three
   options and impossible for five — "Receipt Expense Transfer Loan/Capital Other" collided.
   They wrap onto a second row, each still a 44 px target.
3. **The denomination count box** was taking every spare pixel, so a two-digit note count sat
   in a 400 px field. Fixed width now, total pushed right where the eye expects it.
4. **The voided row's strike-through was crossing out its voucher chip** — the one thing you
   need in order to find its reversal. The row fades; the chip keeps its face.

## Accessibility

- **Contrast** — computed for 17 pairings, all AA. Numbers above.
- **`aria-live="polite"`** on every hero figure and on the ledger's total cells, so a closing
  figure that moves is announced without the page being re-read.
- **Labels bound to inputs** by `for`/`id` throughout; errors linked with `aria-describedby`
  and `aria-invalid`.
- **Keyboard** — SegmentedControl is a real `tablist` with roving tabindex and ←/→;
  EntitySelect is a `combobox` with ↑ ↓ Enter Esc and `aria-activedescendant`.
- **Focus** — one treatment everywhere: 2 px `--dc-focus`, 2 px offset, on `:focus-visible`.
- **Motion** — 150 ms, opacity and transform only; everything is disabled under
  `prefers-reduced-motion`.
- **Touch** — 44 px minimum; inputs and rows grow to 48 px under 640 px.

## Formatters

`money(1234567)` → `Rs 1,234,567`. Paisa **only** when non-zero, so `1234.00` is `Rs 1,234` and
`1234.5` is `Rs 1,234.50`. Negatives in parentheses — `(Rs 3)`, never a minus, because an
accountant reads the bracket faster and cannot mistake it for a hyphen.

Grouping is **Western**, never lakh/crore. That is a standing RMS rule
(memory `pkr_locale_en_in_not_en_pk`) and the suite fails if `1,23,45,678` ever appears.

Rounding is half-away-from-zero at 2 dp, so `1.005` → `1.01` rather than the `1.00` that
`toFixed` gives.

Dates and times are **Asia/Karachi**, always. The suite proves it with a case that would
otherwise pass silently: `2026-09-03 20:00 UTC` formats as **04 Sep 2026, 01:00**, because in
Karachi it is already tomorrow. That is the same trap the database side avoids by never using
`CURRENT_DATE`.

## Screenshots

`docs/daily-closing/design/` — `kit-1280-light` · `kit-1280-dark` · `kit-375-light` ·
`kit-375-dark`, full page, 2× density. Regenerate with:

```bash
node scripts/shot-daily-closing-kit.js
```

It fails on any console error and names any missing file. If Chrome or `puppeteer-core` is
absent it **skips with a message saying so** rather than exiting green and looking like a pass.

## Open questions

1. **The band's group line is hard-coded in the demo.** `DC_BRAND_NAME = "FOURTEEN GROUP"` is
   the agreed constant (RULES §0.7) but it lives with the PDF renderer in P7. The kit's shell
   preview shows the project name only. Nothing depends on this before P7.
2. **No toast queue beyond two.** §A11 says "no stacking beyond 2" and the implementation drops
   the oldest. If a burst of saves should instead coalesce into one "3 entries recorded",
   that is a P6 decision.
