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

---

# P8 — roles, guards, the audit tab, and the shell

## Open it

Daily Closing is now in the sidebar, under **Sales & Money**, after Record Payment — for Awami
Market only. `/daily-closing.html` still works and is what the tests drive.

`?stub=1&role=CASHIER|ACCOUNTANT|CFO|DIRECTOR|NONE` renders the screen as any of §A10's callers
with no database.

## Files

| File | What |
|---|---|
| `supabase/migrations/20260904p_…` | `_dc_role` · `_dc_may_view` · `_dc_may_record` · `_dc_has_module_grant` · `get_my_daily_closing_access` · `list_cash_day_audit` · `_dc_audit_whitelist` · `_dc_service_registry`, and the four endpoints that were gated wrongly |
| `supabase/migrations/20260904n_…` | one MIME type added to the bucket so Inter can live in it |
| `scripts/upload-inter-fonts.js` | downloads Inter v4.1 and puts it in `_assets/`; `--check` just reports |
| `js/pages/daily-closing.js` | asks the server what it may do; audit tab; a Director's read-only day; the shell adapter `rDailyClosing()` |
| `js/ui.js` · `login.html` · `js/lazy-pages.js` | the nav item, the page host, the lazy manifest — **all default-closed** |
| `js/pages/daily-closing-stub.js` | `get_my_daily_closing_access`, `list_cash_day_audit`, and a `role` argument |
| `css/daily-closing.css` | the audit timeline |
| `scripts/verify-daily-closing-access.js` | **new** — 18 checks, 108 matrix cells |
| `scripts/verify-daily-closing-shell.js` | **new** — 16 assertions that KBH and FMH see nothing |
| `scripts/verify-daily-closing-screen.js` | 96 → **132** |

## Three holes P8 closed

All three were the same mistake wearing different clothes: **a scope test doing duty as a role
test.** `_dc_may_touch_project` answers "is this project yours?", and four endpoints were
treating that as "may you write?".

1. **A Director could write.** `open_cash_day`, `record_cash_entry` and
   `add_cash_entry_attachment` checked scope only, so a `manager` assigned to the project could
   open a day and record entries. §A10 gives the Director a read-only row.
2. **A data-entry admin got in by default.** `admin` in this database is the everyday
   data-entry role — FMH's only admin is a filling clerk (RULES §0.4) — and it appears nowhere
   in §A10's matrix. It now passes the scope test and is refused for having no Daily Closing
   role.
3. **The cashier's module grant was decoration.** RULES §0.3 defines the Cashier as `staff`
   **plus** an explicit `dailyclosing` grant. The grant existed only in the Users & Roles UI;
   the server never read it. It is now what makes a cashier.

A fourth turned up while the matrix was running: **`list_payees` inlined invariant 8's chain**
rather than calling the shared predicate, so the new role test did not reach it and any admin
could list the payee master. Found by the matrix on its first green run of everything else.

## What is deliberately unchanged

`_dc_may_touch_project` keeps invariant 8's canonical chain **verbatim** — `_rms_caller()` →
tenant → `_rms_is_admin()` → active assignment. Invariant 8 names that chain as its enforcement,
so the role test goes **on top of it**, never inside it as an exception.

## The audit tab

Reverse-chronological, for the CFO and the Directors, from `list_cash_day_audit`. Each row: who,
when, what they did, why (the reason the action carried), and the before/after of any
**whitelisted** field.

**The diff is whitelisted, not wholesale.** `audit_logs.old_data`/`new_data` hold the entire row,
and a cash entry's row carries a payee, a unit and a narration. Handing that to a diff viewer
would put a client's business into a panel that §A10 keeps out of the Director PDF two files
away. `_dc_audit_whitelist` names the fields per table — status and the figures for a day,
`is_voided`/`rms_status` for an entry — and nothing else is ever returned. Asserted from both
ends: the suite proves the status change **is** there, and that narration, payee and unit are
**not**, after first proving the diff renderer produces output at all.

Field names are shown in words. A Director reading `counted_cash` is reading the database.

Screenshot: `s1-audit-1280` · `s1-audit-375` · `s1-director-1280` · `s1-director-375`.

## The UI stopped guessing

P6 read a role string out of the session and worked out the buttons here. P8 replaces that with
`get_my_daily_closing_access`, which returns the same booleans the server enforces with. The
stub deliberately still says `me.isCfo = true` for every role — so if the screen had gone on
reading the session, every one of the four role tests would show a CFO, and they do not.

The payload has **one shape for everybody**, including a caller with no access at all. A
function that returns `{role, may_view}` here and `{role, may_view, may_record, …}` there makes
every consumer test for `undefined`, and `undefined` is falsy right up until somebody writes
`!== false`.

## The service registry

"Assert each mutating service emits an audit row" is only worth anything if the list cannot go
stale, so `_dc_service_registry()` **derives** it from `pg_proc`: every function in `public` that
`authenticated` may execute, that is VOLATILE, and that mentions a Daily Closing table. A
service added in P9 appears in it the moment it is created, and the suite fails until it has a
cell in the RBAC matrix.

Two trigger functions turned up in the first run and would have demanded RBAC cells. A trigger
function is not a service — nobody calls it, the table does — so the registry excludes anything
returning `trigger`.

## The shell mount, and why it is default-closed

**`hasFeature()` returns TRUE for a key it has never seen.** The SaaS model is deliberately
default-open, so routing this module through it would have put the cash book into Khushal Bagh's
and FMH's sidebars the moment the line shipped. Both gates — the sidebar item and `nav()` — test
`window._featureFlags.daily_closing === true` explicitly and do not call `hasFeature` at all.

`verify-daily-closing-shell.js` runs the real `buildSB()` and the real `nav()` twice and asserts:
`hasFeature('daily_closing')` really does answer true for a tenant that has never heard of it;
the sidebar has no item; `nav('dailyclosing')` lands on the dashboard; and — with the item cut
out of the flagged sidebar — the two sidebars are **identical character for character**.

The page is lazy: `login.html` carries an empty host div and no script tag, and the three files
are in the lazy manifest, so a tenant that cannot reach the page never downloads it.

## Inter

The Director PDF renders in **Inter** now. `node scripts/upload-inter-fonts.js` takes the two
static TTFs from the official rsms/inter v4.1 release (SIL OFL 1.1), uploads them to
`daily-closing/_assets/` with the licence beside them, and reads them back to prove they are
fonts. No redeploy: the renderer picks them up on the next render.

The bucket's MIME allow-list had to gain **one** type, `font/ttf` (`20260904n`). That list is
defence in depth, not the boundary: user uploads go through `daily-closing-file`, which
independently refuses anything but JPG, PNG and PDF and **builds the storage key itself**, so
nothing arriving at that door can land under `_assets/` whatever it claims to be. The migration
asserts the bucket is still private, still 10 MB, still exactly six types, and still carries the
three attachment types.

## The extractor had to be rewritten, and that is the interesting part

Switching the renderer to embedded Inter **broke the golden PDF test**, and the way it broke is
the third appearance of the same bug.

With Helvetica, pdf-lib writes WinAnsi codes: `<44 61 69 6C 79>` is literally "Daily". With an
embedded subset it writes **glyph ids**, whose meaning lives only in that font's `/ToUnicode`
CMap. The old extractor decoded those as WinAnsi and produced ~700 characters of confident
nonsense — which sailed straight through the length guard, while **every §A10 check went green
on the gibberish**.

So the extractor now decodes **per font, through that font's own CMap**. The two subsets in one
sheet share 33 codes and disagree about 29 of them, so a merged map is not an approximation, it
is a lie. Two things had to be understood to get there: the font dictionaries live in
**compressed object streams**, so a raw search for `/ToUnicode` finds zero hits in a file that
has two; and pdf-lib names each font resource `/Inter-Regular-6837590713`, so a `\w+` name
pattern matches "Inter", fails on the hyphen, and silently falls back to WinAnsi for everything.

And a second guard was added: **an intelligibility gate**. Before any "must not appear"
assertion runs, the extracted text must contain known positive controls. If it does not, the run
stops with a named failure and prints what it actually got. Standing rule SR-2 is in
`PHASES.md`.

## Proving the suites can go red

- **access** — `_dc_may_record` widened to include DIRECTOR. Result: `3 of 108 cells disagree
  with §A10` naming exactly `open_cash_day`, `record_cash_entry`, `add_cash_entry_attachment`.
- **shell** — the sidebar gate routed through `hasFeature('daily_closing')`, the real mistake it
  exists to catch. Result: 4 failures, including the two sidebars no longer matching.
- **pdf** — after Inter, the intelligibility gate fired on its own and refused to run 18
  assertions on gibberish. That was not a staged red check; it was the guard doing its job.

## Deviations and open questions

1. **`admin` loses access it technically had.** Nobody is affected today — Awami's only user is
   `owner`, which is CFO — and §A10's matrix has no admin row. Flagged because it is a
   tightening of live behaviour, not an addition.
2. **`audit_logs` grants `SELECT` to `anon` and `authenticated`.** RMS's default privileges hand
   that out on every table. It reaches no rows: RLS is on with a deny-all policy `USING (false)`
   covering both, and neither has UPDATE or DELETE. The suite asserts the RLS facts rather than
   the grant, because the grant is true and does not matter. **Revoking it would touch a table
   KBH and FMH use in production, so it is not done here — say the word and it is a one-line
   migration.**
3. **`get_my_daily_closing_access` is advisory.** Every flag it returns is re-checked
   server-side by the call it guards. It exists to draw buttons.
4. **A re-run of an older migration would revert P8's guards.** `20260904h`/`j` contain the
   pre-P8 bodies of the three write endpoints. Forward-only migrations applied in order are
   fine; re-applying an old one out of order is not, and never was.

---

# P9 — S8, the dashboard tile

## Where it is

On the RMS dashboard, directly under the header, **for Awami Market only**. Not a page — a tile
on the page everybody already lands on.

`/daily-closing.html?stub=1&tile=1` mounts it on its own with no dashboard, no session and no
database; add `&all=1` for the company-wide view and `&role=…` for any of §A10's callers.

## Files

| File | What |
|---|---|
| `supabase/migrations/20260904q_…` | `get_daily_closing_tile` — the whole tile in one round trip |
| `js/pages/daily-closing-tile.js` | the tile component, plus the `rDailyClosingTile()` shell adapter |
| `js/pages/dashboard.js` | **one function, `_dcTile()`**, and one call to it |
| `js/lazy-pages.js` | exposes `_lazyLoadFiles` so the tile can be fetched on demand |
| `js/pages/daily-closing.js` | honours `_dcOpenAt` so a click on the tile opens *that* day |
| `js/foundation/dc-kit.js` | a `wallet` icon |
| `css/daily-closing.css` | the tile |
| `scripts/verify-daily-closing-tile.js` | **new** — 13 checks, counters against fixtures, plans |
| `scripts/verify-daily-closing-screen.js` | 132 → **158** |
| `scripts/verify-daily-closing-shell.js` | 16 → **23** — now covers the dashboard hook |
| `scripts/verify-daily-closing-access.js` | the tile gets a cell; 108 → **114** matrix cells |

## One call, and why that is the whole design

`get_daily_closing_tile` returns the status, both figures, all five counters and the last seven
days **together**. The tile is the first thing a CFO looks at, so the cost of drawing it is paid
on every dashboard load; five queries would become fifteen the moment somebody picks "All
projects", which is exactly the N+1 the Definition of Done asks about.

The function resolves the visible projects **once** into a `uuid[]` and every counter is a single
aggregate over `= ANY (v_pids)`. There is no loop in the body, and the suite asserts that: a
plan review cannot see an N+1, because a plan is per statement — so the absence of `LOOP` and the
presence of the array are asserted on the function's source.

## The counters, and what each one means

| Counter | Reads | Deliberately excludes |
|---|---|---|
| Receipts pending | `rms_status = 'PENDING'` | expenses (`NA`), voided receipts |
| Not exported | `qb_status = 'NOT_EXPORTED'` **on a CLOSED day** | entries on the open day — the day is still being written, so they are not late |
| Unapplied | `rms_status = 'UNAPPLIED'` | — |
| PDC pending | `pdc_cheques.status = 'pending'` | deposited, cleared, bounced |
| PDC due ≤ 7 days | pending **and** `cheque_date` within the week | the one due in 30 days |

Each is a link, and each goes somewhere that exists: the three cash-book counters open the cash
book, the two PDC counters open the PDC register RMS already has. None of them pretends to be a
filtered list that has not been built.

**A zero is drawn quietly** — lighter weight, muted — because a zero is not a problem and should
not carry a problem's visual weight.

**On the pilot, the PDC and export counters read zero, by design.** Awami has no `pdc_cheques`
rows and no closed day with entries yet. Nothing from Phase 2 or Phase 3 is built here: no
export, no PDC register, no Group Position.

## What it is not

**Group Position is Phase 4 and is absent.** Across projects the tile shows ONE aggregate — the
summed figures, a breakdown of how many projects are open/closed/not opened, and the summed
counters. It does not list the projects, and the last-7-days table is omitted with a line saying
to pick a project. One row per project per date is the Phase 4 board, and building it here would
have been building Phase 4 early.

"All projects" is offered to the **CFO and the Director** only (§A12). A Cashier's row reads
"own project"; an Accountant works one book at a time. Both are told to pick one rather than
handed a company-wide total they were never given — and `get_daily_closing_tile` refuses it
server-side, not just in the picker.

## Query plans, honestly

ZZTEST holds single-digit row counts, so Postgres picks a **sequential scan** for every counter
and is right to. "It seq-scanned" therefore proves nothing, and grepping `pg_indexes` for a name
proves only that somebody created an index — not that this predicate can use it.

So each plan is taken **twice**: once as the planner really runs it, and once with
`enable_seqscan = off`, which asks the question that matters — *can this WHERE clause be answered
from that index at all?* If the answer is still a sequential scan, the index does not fit the
predicate and the counter will scan the table forever.

```
✅ receipts PENDING / UNAPPLIED   can use cash_entries_rms_status_idx
✅ NOT_EXPORTED on CLOSED days    can use cash_entries_rms_status_idx
✅ the last seven days            can use cash_days_project_date_idx
```

Note the second line naming the `rms_status` index. Both candidate indexes **lead with
`project_id`**, and with eight rows the second column is worth nothing, so the planner takes
either. Pinning a specific index name here would be over-fitting the planner on a table this
size; what is asserted is that the predicate is index-answerable.

**No index was added.** `pdc_cheques` has a `(project_id)` index and **seven rows in the entire
database**. A composite index would be a change to a table Khushal Bagh and FMH use in
production, bought for nothing. Revisit when PDC is real (Phase 3).

## The dashboard hook is one function, and it is default-closed

`js/pages/dashboard.js` is eager-loaded by every tenant, so P9 adds exactly one function to it,
`_dcTile()`, and one call. It returns immediately unless
`window._featureFlags.daily_closing === true` — **not** `hasFeature()`, which answers true for a
key it has never seen. Everything inside is wrapped in `try/catch`: a failure in the cash book
must never take a tenant's dashboard down with it.

`verify-daily-closing-shell.js` runs the real `_dcTile()` against a mock dashboard and asserts
that with the flag absent **the dashboard HTML is byte-identical afterwards** and no host div is
inserted — then, with the flag on, that the host div appears directly under the header.

The tile's three files are fetched on demand through `_lazyLoadFiles`, so a tenant that cannot
see it never downloads it.

## Two things found while building

1. **`<caption class="dc-label">` renders below the header row.** `.dc-label` sets
   `display:block`, and a block-display caption is laid out inside the table's flow rather than
   above it — "LAST 7 DAYS" appeared between the column names and the first row. It is a `div`
   above the table now.
2. **The suite's own arithmetic was wrong before the code was.** The first expected closing cash
   forgot that a void writes a *reversing entry*, so it double-counted. The code was right; the
   fixture comment now spells the sum out line by line.

## Proving it can go red

`NOT_EXPORTED` widened to count open days as well as closed ones — the single most plausible way
to get that counter wrong. Result:

```
❌ FAIL 05: not_exported = 5, expected 4 (yesterday only)
```

Exactly the one counter, naming both numbers. Restored, green again.

## Deviations and open questions

1. **The counters compute real numbers rather than returning a hard-coded zero.** The brief says
   the PDC and export counters "read zero for now by design". Both readings give zero on the
   pilot today — Awami has no cheques and no closed day with entries — so the behaviour is
   identical; the real query is what makes the counter correct the day the data exists, and what
   makes it testable now against fixtures. Say the word if you want them literally pinned to 0.
2. **The micro-table is per project.** Omitted in "All projects" with a line saying so, because
   the alternative is Phase 4's Group Position.
3. **The tile is not shown to a Cashier's "All projects"**, but the tile IS shown to a Cashier
   for their own project. §A12's S8 row lists Accountant/CFO/Director; a Cashier who may record
   into the day can see the day, which is the same information S1 already gives them.

---

# P10 — making Phase 1 finishable

No new migration. One edge-function change, five new suites, and the runbook.

## Files

| File | What |
|---|---|
| `docs/daily-closing/RUNBOOK.md` | **new** — deploy · seed · setup opening · the daily procedure · the 14-day Excel gate · rollback · troubleshooting by error code · the measured numbers |
| `scripts/verify-daily-closing-e2e.js` | **new** — a whole day through the services, and ten ways to do it wrong |
| `scripts/verify-daily-closing-attachment.js` | **new** — a real file through the real bridge (the P7 carry) |
| `scripts/verify-daily-closing-concurrency.js` | **new** — two writers, one sequence (the P4 carry) |
| `scripts/verify-daily-closing-load.js` | **new** — 500 entries, and the numbers |
| `scripts/verify-daily-closing-security.js` | **new** — auth, RLS, grants, signed URLs |
| `scripts/verify-daily-closing-screen.js` | a timeout is now a named ❌ (the P6 carry); 158 assertions |
| `supabase/functions/daily-closing-pdf/index.ts` | phase timings in the answer; the version row and the signed link fetched in parallel |
| `js/pages/daily-closing-stub.js` | `make(state, role, bulk)` — pads a day out for the load run |
| `daily-closing.html` | `?entries=N`, and a paint-start mark |

## The three items carried in from earlier prompts, now closed

**A real file, through the real bridge** (carried from P7). `verify-daily-closing-attachment.js`
uploads a genuine PDF with a signed URL the bridge issued, and asserts: the key **begins with the
entry's `project_id`**; a `storage_key` supplied by the caller is **ignored**, because the bridge
builds its own; an executable is refused a URL at all; the owner's signed link returns the file
byte-for-byte and expires in ten minutes; and **a user on another project is refused the same
attachment id** — paired with the owner's identical call succeeding first, so a broken harness
cannot pass it.

**Two writers, one sequence** (carried from P4, which said plainly that it could not do this).
Every Management API call is its own connection, transaction and COMMIT, so twelve fired together
are twelve real writers. Result: twelve accepted, sequence 1..13 unbroken, no duplicate
`seq_no`, and nobody met the `UNIQUE` index — they queued on `SELECT … FOR UPDATE`. The run took
3.2 s against ~20.8 s for twelve serial round trips, which is the assertion that says they
actually overlapped rather than politely queuing in the driver.

**A named ❌ instead of an explosion** (carried from P6). A wait that never came true used to
throw, kill the process and print a puppeteer stack trace — no summary, no count, and every later
assertion silently not run. Now the wait methods *and* the interaction methods are wrapped per
page, a missing element prints one ❌ naming what it looked for, and an outer catch turns any
remaining surprise into `the run stopped early: …`. Proved by breaking the void row action:
`❌ FAIL (54 passed, 5 failed)` with four named lines, where before there was a stack trace.

## What the end-to-end suite actually drives

Opening balance → open → eight entries (2 receipts, 3 expenses, a transfer **pair from one
call**, a loan) → void an expense → attach → close on an exact count with variance 0 → the sheet
at v1 → tomorrow opens on today's closing → an ordinary entry on the closed day is `DAY_LOCKED`
→ the CFO's adjustment lands without reopening it → the sheet re-issues at v2 with v1 kept → the
dashboard counters agree with the tables → the Director reads the day, the audit and the sheet
and is refused a write.

Then ten refusals by code: `VARIANCE_UNEXPLAINED`, a second day on one date, `DUPLICATE_VOUCHER`,
`OVERRIDE_REASON_REQUIRED`, the cashier's close, the cross-project read, `VERSION_CONFLICT`, the
idempotent replay returning the *same* entry, the 10 MB + 1 byte attachment, and a JV on an open
day. And then a good entry, so a wall of refusals cannot be a wedged service.

**One honest limit, written into the file.** Inside a single transaction `now()` is frozen, so
the void (written before the close) and the JV (written after it) share a `created_at` to the
microsecond and no value of `closed_at` can separate them. The adjustments block is therefore
asserted **by content**, not by count, and the `created_at > closed_at` boundary is exercised
where the timestamps genuinely differ — the P6 and P7 screen suites.

## Performance: five numbers, one of them red

| What | Measured | Budget | |
|---|--:|--:|---|
| S1 first paint, 500 rows | 717 ms | 1500 | ✅ |
| `get_cash_day_summary` | 10.3 ms | 200 | ✅ |
| `get_daily_closing_tile` | 18 ms | — | |
| `list_cash_entries` (500) | 137 ms | — | |
| Director PDF, 500 entries | **5446 ms** | 2000 | ❌ |

**The measurement was broken before the numbers were.** The first version wrapped each call in
`(select clock_timestamp() t0), lateral (select fn(...))` and every figure came back **0.0 ms** —
the planner is under no obligation to evaluate those in written order. Four green lines, all
meaningless, and very nearly shipped. They come from `EXPLAIN ANALYZE`'s own Execution Time now
(SR-2: a timing that always reads zero is a check that cannot fail).

**The PDF misses, and the renderer says why.** It now reports its phases:
`payload 654 · fonts 2743 · draw 3850 · save 3961 · total 5446 ms`. Embedding Inter is **~2.1 s
of every render** whatever the day holds — pdf-lib parses and subsets both weights per document
and there is nothing to cache. 500 rows add ~1.1 s; a normal day of 20–40 entries adds a tenth of
that, so a real day renders in ~3.5 s. Helvetica brings it inside 2 s and loses Inter, which the
owner asked for one prompt ago, so **nothing was changed to make the number go green.** Pre-
subsetting Inter to the ~120 glyphs the sheet uses would fix it properly and needs a font tool
this repo does not have.

One cheap win was taken: the version row and the signed link depend only on the key and not on
each other, so they are fetched in parallel instead of in sequence.

## Two mistakes worth recording

1. **`T` was already taken.** The phase-timing object was called `T`, which is also the
   text-drawing helper thirty lines further down. The function boot-failed with
   `Identifier 'T' has already been declared` and served 503s until the logs were read — worth
   remembering that an edge function's boot error is invisible from the client, which only sees
   `BOOT_ERROR`.
2. **The invariant-5 trigger caught the load fixture.** The bulk insert put client receipts on
   6050 with no reason and was refused by `cash_entries_qb_head_guard`. The guard was right and
   the fixture was wrong — which is the correct direction for that to happen in.

## Deviations and open questions

1. **The PDF budget is not met.** Numbers, cause and options above and in `RUNBOOK.md` §5.
   Needs an owner decision: Inter, or 2 s.
2. **The e2e suite runs in one transaction**, so the two HTTP steps are represented by the rows
   they produce and proved for real in their own suites. Stated at the top of the file.
3. **The load fixture inserts directly**, not through `record_cash_entry` — 487 round trips would
   take twenty minutes and the suite measures reads. The write path is proved by P4, the E2E and
   the concurrency suite.
4. **Permanent ZZTEST rows.** The four committing suites leave rows that invariant 1 forbids
   deleting. They live on ZZ Map Tower and ZZTEST Tower; the wiping suites live on ZZTEST Garden
   (SR-1).
