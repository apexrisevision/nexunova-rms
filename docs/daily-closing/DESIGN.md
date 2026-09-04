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
2. ~~**No toast queue beyond two.**~~ **Answered in P6** — a burst of saves now coalesces into
   one "3 entries recorded" rather than a queue of near-identical lines. See below.

---

# P6 — S1, the Day Workspace

## Open it

```
https://<your RMS domain>/daily-closing.html
```

Sign in to **Awami Market** at `/login.html` first. Optional parameters:
`?project=<uuid>` and `?date=YYYY-MM-DD` (default: today in Karachi).

`?stub=1&state=open|closed|notopened|needsopening` renders the screen against scripted
answers with **no database at all** — that is what the tests and the screenshot script use.

## Files

| File | What |
|---|---|
| `js/pages/daily-closing.js` | the screen, as a **mountable component** — `DailyClosing.mount(el, {rpc, me, projects, …})` |
| `js/pages/daily-closing-stub.js` | scripted RPC answers for the tests |
| `daily-closing.html` | host page: gate, session, project list, then mount |
| `supabase/migrations/20260904k_…` | `list_units_for_picker` · `list_qb_accounts_for_project` · `get_cash_entry_project` |
| `supabase/functions/daily-closing-file/index.ts` | the signed-URL bridge, **deployed** |
| `scripts/verify-daily-closing-screen.js` | 49 assertions, real Chrome, clicking like a person |
| `scripts/shot-daily-closing-screen.js` | 3 states × 2 widths |

**It is a component, not a page.** `rpc` is injected rather than reached for, so P8 can mount
the same file on a `.pg` div inside `login.html` without a rewrite — and so the test can drive
it with scripted answers instead of a live database.

## The attachment bridge, which P4 owed

`supabase/functions/daily-closing-file` — **deployed, `verify_jwt: false`, ACTIVE, version 1.**
Deployed with the CLI and `--no-verify-jwt`, because the function reads the Authorization
header itself and deploying through MCP silently resets that flag to true.

Two operations. `upload-url` returns a short-lived signed **upload** URL and **builds the
storage key itself** — the browser never chooses where its file lands, and the key always
begins with the entry's `project_id`. `read-url` returns a 10-minute signed download URL.

Authorisation is the **database's**, not the function's: it forwards the caller's own JWT to
`authorize_cash_attachment` / `get_cash_entry_project`, so invariant 8 applies here exactly as
it does everywhere else. The service key is used only to mint the URL, after the answer is
already yes.

## Toast burst collapsing

Saving four entries in a row used to raise four near-identical toasts that pushed each other
off the screen, so the cashier read none of them. A toast raised with a `collapse` key within
2.5 s of another with the same key now **replaces** it and counts up: "CRV-0041 recorded" →
"2 entries recorded" → "3 entries recorded". A different message — an error, a void — still
gets its own line. Asserted by the screen suite.

## One design decision worth naming

**A void written while the day was open is not a post-close adjustment.** Both carry
`is_adjustment = true`, and the first version of the closed view grouped them together — so a
correction made at 12:05 during the day appeared under "Adjustments" beside a JV posted the
next morning. The group is now what was written **after `closed_at`**, which is what §A13's
ADJUSTMENTS block means. The test caught it.

## Screenshots

`s1-notopened-1280/375` · `s1-open-1280/375` · `s1-closed-1280/375` in
`docs/daily-closing/design/`.

## Deviations and open questions

1. **`Close Day` and `Add adjustment` are present but inert**, and `Director PDF` is rendered
   disabled with a tooltip saying why. P7 owns all three; the buttons exist so the closed state
   is not a dead end on screen.
2. **The `Void` action is a picker plus a button, not a per-row menu.** §A12 says "Ledger row
   actions (Accountant+): Void". A row menu needs a popover the kit does not have, and adding
   one to §A11 unasked seemed worse than a control that is obvious and reachable. Say if you
   want the row menu and it is a small addition to P5's kit.
3. **Attachments queue but do not upload yet.** The file is held and announced; the actual
   two-step (get signed URL → PUT → `add_cash_entry_attachment`) is wired to the bridge but not
   exercised end-to-end, because there is no entry id until the save returns. It belongs with
   the first real entry recorded on the pilot.
4. **The screen suite goes red by timing out**, not by printing a clean ❌ — proved by removing
   `DUPLICATE_VOUCHER` from the error map (exit 1). A timeout is a real failure, but a named
   one would read better; worth tidying in P10.

---

# P7 — S2 the close panel, the Director PDF, S3 the days list

## Open it

```
https://<your RMS domain>/daily-closing.html            # S1, today
https://<your RMS domain>/daily-closing.html?view=days  # S3
```

`?stub=1&state=open` still drives the whole of P7 with no database: the close panel, the
version conflict, the days list and the PDF handoff are all scripted.

## Files

| File | What |
|---|---|
| `supabase/migrations/20260904m_…` | `get_cash_day_pdf_data` · `record_day_document` · `list_cash_days` · `authorize_day_document` |
| `supabase/functions/daily-closing-pdf/index.ts` | the Director PDF, **deployed**, `verify_jwt: false` |
| `js/foundation/dc-kit.js` | **+ RowMenu** (`rowMenu` / `bindRowMenus`) and **+ SidePanel** (`sidePanel`) |
| `js/pages/daily-closing.js` | S2 close panel · S3 days list · PDF render/open/share · post-close adjustment |
| `scripts/verify-daily-closing-pdf.js` | 38 assertions against a REAL rendered PDF |
| `scripts/verify-daily-closing-screen.js` | now 96 assertions — P6's 60 plus P7's |
| `docs/daily-closing/design/director_pdf_sample.pdf` | a real render, openable |

## An addition to §A11: RowMenu

§A12 asks for row actions on the ledger. P6 shipped a picker plus a button because the kit had
no popover, and said so. **This is that popover, added to the kit properly** — it belongs in
§A11 beside the other components, not recorded as a deviation from it.

- trigger is a 32 px icon button (44 px under 640 px) carrying `aria-haspopup="menu"`,
  `aria-expanded` and an `aria-label` that **names its row** — "Actions for voucher CRV-0041",
  not "menu"
- popover is a real `role="menu"` with `role="menuitem"` children at `tabindex="-1"`
- **Enter · Space · down** open it and move focus to the first item; **up** opens on the last
- **down up Home End** move between items, **Esc** closes and returns focus to the trigger,
  **Tab** closes, a click anywhere else closes
- exactly one menu is open at a time — opening another closes the first
- a **voided** row has no menu; its cell keeps the link to its reversal, which is the more
  useful thing to offer there

Screenshot: `s1-rowmenu-1280` and `s1-rowmenu-375`.

## An addition to §A11: SidePanel

§A12's close panel is 480 px on the right rather than a modal in the middle, so the ledger stays
in view while the drawer is counted. Below 640 px it becomes a full-height sheet — 480 px of
panel on a 375 px phone is a modal wearing a disguise. It is still a dialog to a screen reader:
`aria-modal`, focus moves in and is trapped, Esc and the backdrop close it, focus returns to
whatever opened it.

**It is parented to `document.body`, not to the screen's root, and that is deliberate.** The
screen reloads by rewriting `root.innerHTML`; a panel inside that root would vanish mid-flow —
which is exactly what happens on a VERSION_CONFLICT and again between closing and offering the
sheet. It carries its own `.dc` so the module's styles still reach it. Its z-index sits *below*
`.dc-modal`, because the close confirmation is raised from inside it.

## S2 · what the close panel refuses

Three things it is built around, in order of how much they matter:

1. **The button is disabled until the count is valid** — but `close_cash_day` refuses on its own
   with `VARIANCE_UNEXPLAINED`. The disabled button is a courtesy; the server is the rule. The
   suite asserts both: that the button stays disabled, and that nothing was sent.
2. **The version read is sent back.** If an entry lands while the notes are being counted the
   close is refused, and the panel reloads the day underneath while **keeping the count on
   screen**. Nobody recounts a drawer because of a race.
3. **The denomination breakdown is reported, not enforced** — the server says so too. A drawer
   holds coins, so the counted figure fills in from the notes and can be typed over. If the two
   disagree the panel says so after the close rather than blocking before it.

Two details found by building it:

- **The variance banner lives in a slot, not in a branch.** Typing "90000" makes the variance
  non-zero after the *first* digit; re-rendering the panel there would have eaten the other four
  keystrokes. Asserted.
- **The counter already ends on a row saying "Counted".** The money field beneath it was also
  called "Counted cash" — the same word twice, one line apart, for two different things. It is
  "Recorded as" now.

Screenshot: `s1-closepanel-1280` and `s1-closepanel-375`.

## The Director PDF

Rendered by an edge function with `pdf-lib`, to §A13's layout, at A4. The header reads
`FOURTEEN GROUP · <PROJECT NAME>` — the brand is the constant from RULES §0.7 and the project
name comes from `projects.project_name`, **never** `companies.display_name`, because two tenant
rows share that string.

**§A10, mechanically.** `get_cash_day_pdf_data` does not SELECT a client phone number at all —
not masked, not truncated, never fetched — so there is nothing in the renderer that could leak
one. The suite extracts the text of a real render and asserts no phone-shaped string appears.

**Versions are kept, never overwritten.** The next version is computed inside the same read that
builds the payload, `day_documents` has `UNIQUE (cash_day_id, kind, version)` behind it, and a
regeneration after an adjustment takes the next number. A Director holding v1 can be shown what
changed. Opening a stored sheet from S3 fetches the file — it does not re-render and does not
consume a version; asserted.

Typeface: Inter if `_assets/Inter-Regular.ttf` and `Inter-SemiBold.ttf` are in the bucket,
otherwise Helvetica. Nothing has been uploaded yet, so the sample renders in Helvetica; dropping
the two files into the bucket switches it with no code change.

## S3 · the days list

Sixty days, newest first, from `list_cash_days`. Each row shows status, entry count, closing
cash and bank, and any variance; a row is a link into that day in S1 and works from the keyboard.
A day with a rendered sheet offers it, labelled with its version.

The view switch sits on the navy band, where a navy "primary" fill disappeared and the plain
button read as the selected one — backwards. Inside the band the **current** view is the solid
white button.

Screenshot: `s1-days-1280` and `s1-days-375`.

## Proving the suites can go red

- **Screen suite** — the optimistic lock was removed from the close payload
  (`p_version: null`). Result: `the version READ was sent back, for the optimistic lock — got
  null, want 0`, and `FAIL (95 passed, 1 failed)`. Restored, green again.
- **PDF suite** — the renderer's thousands separator was switched to `en-IN` and the footer
  reworded, then deployed for real. Result: three named failures. Restored and redeployed.

That second red check found **two faults in the instruments themselves**:

1. The lakh check only matched *crore*-shaped numbers, so a document reading `1,50,000` passed
   it. It now matches lakh grouping too.
2. The phone-number check had never fired in its life, on any input.

Both are checks for something that should be **absent**, so on a clean document they are green
whether they work or not — the same false-confidence shape as the NULL trap in P2. The suite now
**self-tests both detectors on synthetic strings every run** (eight probes: each must fire on
what it should catch and stay silent on what it must not), so a broken detector goes red on its
own rather than waiting for a leak to be missed.

## Deviations and open questions

1. **Share uses the browser's share sheet, or copies the link.** Sending on WhatsApp is Phase 4
   and is deliberately not wired.
2. **The signed link lasts ten minutes** (§A7). The panel says so.
3. **The golden fixture moved the other suites, not itself.** `cash_entries` can never be
   deleted, so the fixture's rows on ZZTEST Tower are permanent by design — and P3/P4 begin by
   wiping their project's entries, which only ever worked because there were none. Rather than
   disable invariant 1 to tidy up, the wiping suites moved to **ZZTEST Garden**. One project
   holds undeletable rows; the other holds none. They must not be the same one.
4. **`20260904f`'s verify block was rewritten.** It asserted that *no* row holds `cfo` — true the
   day it ran, false the moment the first CFO account existed, which is the thing the migration
   exists to allow. An assertion that expires is worse than none: it fails on correct data. It
   now asserts that no row holds anything outside the seven values and that none was rewritten.
5. **The screen suite still goes red by timing out** in some paths rather than printing a named
   failure — carried into P10 as agreed, along with the attachment end-to-end item.
