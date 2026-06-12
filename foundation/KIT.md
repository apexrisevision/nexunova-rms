# Nexunova RMS — Foundation Kit (Phase 2)

The single source of truth for **new** UI. Phase-3 page migrations follow this
document class-for-class. Nothing here changes legacy pages — every class is
`nx-` prefixed and additive.

**Files**
- `css/foundation/tokens.css` — the only place colours/sizes/spacing live.
- `css/foundation/components.css` — the `nx-*` component classes.
- `js/foundation/kit.js` — `window.NX` string render helpers.
- `js/foundation/print.js` — `window.NXPrint` print emitter.

**Naming — two prefixes, on purpose:**
- **Classes / JS = `nx-` / `NX.`** (e.g. `.nx-card`, `NX.button`). The `.nx-`
  *class* namespace is collision-free in the legacy CSS.
- **CSS variables = `--fk-`** (foundation-kit), e.g. `--fk-primary`. We can NOT
  use `--nx-*` for variables: `css/saas-polish.css` already defines a `--nx-*`
  variable set (incl. `--nx-primary: #2563EB`) and loads after us, so reusing it
  would either be overridden or would silently restyle legacy pages. `--fk-*` is
  unused anywhere else. (Phase-3 cleanup may retire saas-polish's `--nx-*`.)

**Hard rules (enforced in review):** Inter only · indigo `--fk-primary` is the
only brand colour (`#2563EB` = `--fk-info` only) · type scale 11/13/14/18/20–22
· spacing 4/8/12/16/24 · radius 8 control / 12 card · no gradients
(charts excepted) · no emoji (Lucide via `NX.icon`) · no `!important` · no inline
styles in JS — use the helpers.

---

## WARMTH v2 — the warmth vocabulary (2026-06-13)

The owner's verdict that drove this: *"the old was confusing, the new is BORING —
everything is being stripped flat; find the middle path."* **Premium = restraint
+ precision + WARMTH.** Flat is not the goal; *quiet* is. Warmth is added through
a fixed vocabulary — never through gradients, glows, bounce, emoji or saturation.

**Build warm by default. Every new surface uses these:**

1. **Tabs = a segmented track, never underline buttons.** Use `NX.tabs(...)` /
   `.nx-tabs`. A contained bar (`bg-subtle` + 1px border + radius 10) holding pill
   tabs; the active pill is a **raised card pill** (`--fk-shadow` + semibold +
   indigo text), inactive is muted with a hover tint. Count chip lives *inside*
   the pill. `fill:true` spreads them full-width. Nobody should wonder whether a
   tab is clickable.
2. **Button hierarchy is visible at a glance.** `primary` solid indigo · `secondary`
   = **filled subtle** (`bg-subtle` + border, hover deepens — *not* a border-only
   ghost) · `ghost` text-only for tertiary · `danger` solid (confirm) /
   `danger-soft` tinted (resting destructive). All have a pressed state.
3. **Tinted icon chips — the single biggest warmth lever.** `NX.ichip(name, tone)`
   / `.nx-ichip`: a 30px (sm 26 / lg 34) rounded chip with a ~12% semantic tint
   behind a Lucide glyph. Indigo by default; semantic tone *where meaning exists*
   (recovery danger-tint, success green-tint). Muted, never saturated, never
   gradient. Put one on every page header, card/section header, list-leading slot
   and empty state.
4. **Cards have structure.** Optional header zone via `NX.card(body,{header:{icon,
   tone,title,sub,actions}})` → `.nx-card-hd` (chip + title + actions over a
   hairline). Shadow is bumped one notch globally (token). Interactive cards add
   `hover:true` → `.nx-card--hover` (lift 1px + raised shadow, 150ms).
5. **Stat surfaces may be tinted.** `NX.kpi({tint:'success'})` (5% bg) **or**
   `NX.kpi({icon,tone})` (icon chip) — choose one per surface, never both loud.
   Numbers stay `.num` tabular.
6. **Empty states + section labels get the chip pulse** so even empty screens have
   a heartbeat (`NX.empty` wraps its icon in a chip automatically).
7. **Badges have presence:** tinted bg **+ 1px tinted border** (`--fk-*-edge`), not
   a borderless wash.

**New tokens:** `--fk-{tone}-chip` (≈12%, theme-adaptive via `color-mix` against
`--fk-bg-card`) · `--fk-{tone}-surface` (≈5%) · `--fk-{tone}-edge` (badge border) ·
`--fk-subtle-hover` · `--fk-shadow` (bumped) + `--fk-shadow-raised`.

**Before → after:**
```js
// tabs — BEFORE: bespoke underline buttons (flat, "are these clickable?")
'<button style="border-bottom:2px solid …">Floors <span class=nx-chip>11</span></button>'
// AFTER: a segmented control
NX.tabs({ tabs:[{k:'floors',label:'Floors',count:11,icon:'building-2'}], active:_tab,
          onSelect:"showTab('%k')", fill:true });

// page header — BEFORE: bare title
NX.pageHeader('Inventory', actions);
// AFTER: leading tinted icon chip
NX.pageHeader('Inventory', actions, { icon:'package' });

// card — BEFORE: title was just a <div> inside the body
NX.card('<div class="nx-card-title">Recovery mix</div>' + body);
// AFTER: a structured header zone with a semantic chip
NX.card(body, { header:{ icon:'trending-up', tone:'success', title:'Recovery mix' } });
```

---

## Tokens (quick reference)

| Token | Value (light → dark) |
|---|---|
| `--fk-font` | Inter, system-ui, … |
| `--fk-fs-label / body / title / page / kpi` | 11 / 13 / 14 / 18 / 20–22px |
| `--fk-primary` / `--fk-primary-hover` / `--fk-primary-tint` | `#4F46E5` / `#4338CA` / 10% indigo |
| `--fk-info` | `#2563EB` (info only — never brand) |
| `--fk-success / --fk-warning / --fk-danger` | `#16A34A` / `#D97706` / `#DC2626` |
| `--fk-bg-page` | `#F1F5F9` → `#0B1120` |
| `--fk-bg-card` | `#FFFFFF` → `#111A2E` |
| `--fk-bg-sidebar` | `#FFFFFF` → `#0F172A` |
| `--fk-bg-subtle` | `#F8FAFC` → `#0F1B33` |
| `--fk-border` | `#E2E8F0` → `#1E293B` |
| `--fk-text` / `--fk-text-muted` | `#0F172A`/`#64748B` → `#E5E7EB`/`#94A3B8` |
| `--fk-sp-1..6` | 4 / 8 / 12 / 16 / 24px |
| `--fk-radius-control / -card` | 8 / 12px |
| `--fk-shadow` | `0 1px 3px rgba(0,0,0,.06)` |
| `--fk-h-btn / -btn-sm / -input / -row` | 32 / 28 / 36 / 40px |

Numbers: add the `.num` utility (tabular figures). There is **no `--mono`
token** — see TODO below.

---

## Components

### Card
```html
<div class="nx-card">…</div>
<div class="nx-card nx-card--compact">…</div>   <!-- 12px padding -->
<div class="nx-card nx-card--flush">…</div>      <!-- 0 padding, e.g. wraps a table -->
```
```js
el.innerHTML = NX.card('<p>Body</p>', { compact:true });
```

### Buttons — primary / secondary / ghost / danger · default 32 / small 28
```html
<button class="nx-btn nx-btn--primary">Save</button>
<button class="nx-btn nx-btn--secondary nx-btn--sm">Cancel</button>
<button class="nx-btn nx-btn--ghost nx-btn--icon">…icon…</button>
<button class="nx-btn nx-btn--danger">Delete</button>
```
```js
NX.button('Save',   { variant:'primary', onclick:'save()' });
NX.button('Add',    { variant:'primary', icon:'plus' });
NX.button('Cancel', { variant:'secondary', size:'sm', onclick:'close()' });
```

### Table — the single standard
```html
<table class="nx-table">
  <thead><tr><th>Client</th><th class="num">Outstanding</th></tr></thead>
  <tbody><tr><td>Ali</td><td class="num">1,250,000</td></tr></tbody>
</table>
```
```js
NX.table({
  cols: [{label:'Client'}, {label:'Outstanding', num:true}],
  rows: [['Ali', '1,250,000']],
  flush: true   // when inside a .nx-card--flush
});
```
Header = 11px uppercase muted on `--fk-bg-subtle`, rows 40px, hover, sticky
thead, right-aligned `.num` cells.

### Modal — S 480 / M 640 / L 880
```html
<div class="nx-modal-overlay">
  <div class="nx-modal nx-modal--m">
    <div class="nx-modal-header"><h3 class="nx-modal-title">Edit client</h3>
      <button class="nx-modal-close">…x…</button></div>
    <div class="nx-modal-body">…</div>
    <div class="nx-modal-footer">
      <button class="nx-btn nx-btn--ghost">Cancel</button>
      <button class="nx-btn nx-btn--primary">Save</button>
    </div>
  </div>
</div>
```
```js
document.body.insertAdjacentHTML('beforeend', NX.modal({
  title:'Edit client', size:'m', onClose:'closeModal()',
  body: NX.field({ label:'Name', name:'cname', required:true }),
  footer: NX.button('Cancel',{variant:'ghost',onclick:'closeModal()'}) +
          NX.button('Save',{variant:'primary',onclick:'save()'})
}));
```

### Form — 36px input, 11px label above, inline error, required marker
```html
<div class="nx-field">
  <label class="nx-label">Email <span class="nx-req">*</span></label>
  <input class="nx-input" type="email">
  <div class="nx-error"></div>
</div>
<div class="nx-field nx-field--error">…<div class="nx-error">Required</div></div>
```
```js
NX.field({ label:'Phone', name:'phone', required:true, error:'Invalid number' });
NX.field({ label:'Status', name:'status', el:'select',
           options:[{value:'a',label:'Active'},{value:'i',label:'Inactive'}], value:'a' });
NX.field({ label:'Notes', name:'notes', el:'textarea' });
```

### Badge / chip
```html
<span class="nx-badge nx-badge--success"><span class="nx-dot"></span>Active</span>
<span class="nx-chip">12</span>
```
```js
NX.badge('Overdue', 'danger', { dot:true });
NX.chip(12);
```

### KPI card — 11px label + 20–22px tabular value + optional delta
```html
<div class="nx-kpi">
  <div class="nx-kpi-label">Recovered</div>
  <div class="nx-kpi-value num">4,820,000</div>
  <div class="nx-kpi-delta nx-kpi-delta--up">+8.2%</div>
</div>
```
```js
NX.kpi({ label:'Recovered', value:'4,820,000', delta:'+8.2%', deltaDir:'up' });
```

### Empty state — icon + 13px message + primary action
```js
container.innerHTML = NX.empty({
  icon:'inbox', message:'No sold units yet — create a sale first to receive payments.',
  action: NX.button('Create sale', { variant:'primary', onclick:"nav('newsale')" })
});
```

### Page header — 18px title + right-aligned actions
```js
NX.pageHeader('Clients', NX.button('Add client',{variant:'primary',icon:'plus'}));
```

### Banner — info / warn / danger
```js
NX.banner('Some data failed to load — not all records are shown', 'warn');
```

### Dashboard gadget primitives — `journeybar` · `gauge` · `donut`
Inline-SVG, flat token fills (no gradients), one-shot fill motion. Reusable anywhere.
```js
// One segmented bar telling a whole quantity's story + a legend row.
NX.journeybar({ height:16, segments:[
  { value:580, tone:'success', label:'Collected',         amount:'580.1M' },
  { value:212, tone:'danger',  label:'Recoverable today', amount:'212.0M' },
  { value:388, tone:'muted',   label:'Future',            amount:'388.4M' } ]});
// Semi-donut gauge — value/max arc + centred value + caption. count:{} animates it.
NX.gauge({ value:212, max:600, tone:'danger', size:180, count:{ value:35.3, fmt:'pct' },
           caption:'of the book is overdue' });
// Full multi-segment ring + centred total + legend.
NX.donut({ segments:[{value:67,tone:'info',label:'0–30',amount:'0.7M'}, …],
           size:132, thickness:15, centerLabel:'212.0M', centerSub:'Overdue' });
// Small area+line trend — single tone, soft 8% flat fill (no gradient), hollow
// dots, LAST point emphasized, draws in once ≤300ms. Render-gate ≥3 points.
NX.trendline({ series:[164.4,170.6,183.2,195.6,206.7,211.4], tone:'danger' });
```
tone = `success|danger|warning|info|primary|muted` (muted = `--fk-muted-fill`, the
neutral "remaining / not-yet-due" fill).

> Taste note (owner verdict 2026-06-13): the **gauge** semi-donut and full **donut**
> ring can read as *preloaders* — prefer `journeybar` / `trendline` / `stackbar`
> (horizontal, flat, premium) for dashboard surfaces. Keep gauge/donut for genuine
> radial cases only. Charts stay single-tone + restrained; rainbow ≠ premium.

### Motion (lawful gadget feel) — `NX.animateCounts` + CSS one-shots
Numbers count up once on load; bars/arcs fill in; **no loops, no pulsing.**
```js
// mark a number, then animate every [data-nx-count] under a root (once, ≤400ms):
'<span data-nx-count="600345471" data-nx-fmt="compact">0</span>'   // fmt: compact|exact|pct|int
NX.animateCounts(containerEl);
```
CSS one-shot classes (`both`, never iterate): `.nx-grow-x` (bar grows L→R), `.nx-arc-draw`
(gauge arc strokes in, needs `pathLength="1"`), `.nx-pop` (donut scales in), `.nx-rise`
(card fades up). **All gated by `prefers-reduced-motion: reduce` (snap to final).**

> Type-scale note: the **only** sanctioned figure above 22px is the dashboard hero
> number — `--fk-fs-hero` (30px) / `.nx-hero-value`. Nothing else breaks the closed scale.

### Icons — Lucide only (never emoji)
```js
NX.icon('search');        // 16px default
NX.icon('alert-triangle', 20);
```
`NX.icon` uses a real Lucide build if the app ships one (`window.lucide`),
otherwise an inline fallback covering the kit's needs. Add new glyphs to the
fallback set in `kit.js` as pages migrate.

---

## Printing — `NXPrint`
```js
// Drop-in: a complete HTML doc → race-free print / save-as-PDF (Electron-aware)
NXPrint.emit(fullHtmlString, 'Document title');

// Standard "Report Document" frame (letterhead + repeating thead + footer):
NXPrint.emit(NXPrint.reportFrame({
  title:'Sales Register', company:S.coName, project:'Tower A',
  period:'Jan–Jun 2026', orientation:'landscape',
  bodyHTML: NX.table({ cols:[…], rows:[…] })
}), 'Sales Register');
```
The legacy `_printHTML(html,title)` (js/pages/print.js) now **delegates to
`NXPrint.emit`**, so existing report/voucher callers are fixed without code
changes. Report *layouts* are migrated onto `reportFrame` in Phase 3+.

---

## Phase-3 TODO (do NOT do in Phase 2)
- **Mono / JetBrains:** the `JetBrains Mono` `<link>` in `login.html` is kept as
  **legacy life-support only** (old pages hardcode it for amounts). Foundation
  files never reference it or a `--mono` token. Remove the link + any legacy
  `--mono` token when the last legacy page migrates to `.num`.
- **Voucher printer race:** `_pw` / `_pclose` (js/pages/print.js — receipts &
  vouchers) still use the old `blob → revokeObjectURL` race. Migrate them to
  `NXPrint.emit` when receipts/vouchers are touched. (Out of Phase-2 scope.)
- **Aurora topbar:** the Aurora Command mega-menu is **protected *until the Nav
  phase review*** (not forever). Phase 2 only re-skins it to tokens (no
  gradient, Inter, indigo). Whether to keep or replace the mega-menu is decided
  in the Nav phase.
- **Quick-Actions FAB (`#qab-btn`):** the floating ⚡ menu (Log a Call / Log
  Field Visit / Record Promise) is a **global shell** element on every page.
  Phase 3A (dashboard) deliberately left it alone — relocating its actions into
  the topbar is a shell job for the **Nav phase** (decide alongside Aurora).
- Legacy `.card` (162) / `.btn` (106) / 30 table systems get migrated to the
  `nx-*` equivalents page-by-page; delete the legacy class once its last
  consumer is gone.
