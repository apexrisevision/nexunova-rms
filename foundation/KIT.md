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
· spacing 4/8/12/16/24 · radius 8 control / 12 card · one shadow · no gradients
(charts excepted) · no emoji (Lucide via `NX.icon`) · no `!important` · no inline
styles in JS — use the helpers.

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
