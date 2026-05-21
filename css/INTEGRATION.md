# Nexunova RMS — Enterprise Polish v1.0
## Integration Instructions

## 2 files to deploy:

### 1. NEW FILE: `css/enterprise-polish.css`
Place this file in your `css/` folder.

### 2. REPLACE: `js/utils.js`
Overwrite the existing file (only `fM`, `fMF`, `fMH` formatters changed — no L/Cr suffixes).

---

## Update `index.html`:

Add **ONE LINE** at the very END of the existing CSS imports — it MUST be the last stylesheet:

```html
<link rel="stylesheet" href="css/design-system.css">
<link rel="stylesheet" href="css/login.css">
<link rel="stylesheet" href="css/app.css">
<link rel="stylesheet" href="css/components.css">
<link rel="stylesheet" href="css/pages.css">
<link rel="stylesheet" href="css/schedule.css">
<link rel="stylesheet" href="css/theme-system.css">
<link rel="stylesheet" href="css/sidebar-premium.css">
<link rel="stylesheet" href="css/dashboard-premium.css">
<link rel="stylesheet" href="css/enterprise-polish.css">  <!-- ⬅️ ADD THIS LAST -->
```

That's it. Hard refresh (Ctrl+Shift+R) and the dashboard transforms.

---

## What changed (summary)

| Issue | Fix |
|-------|-----|
| Washed-out look | Solid surfaces, no backdrop blur on cards |
| Theme toggle invisible | Larger 44×24 toggle, branded thumb, sun/moon icons |
| Weak typography | Plus Jakarta Sans for headings, Inter for body, proper sizes & weights |
| Lakhs/Crores | International commas: `1,000,000` |
| Random pastels | One brand (indigo `#6366F1`), one accent (emerald), neutrals |
| Inconsistent cards | Unified `--x-r-lg`, `--x-shadow`, `--x-border` tokens |
| KPI hierarchy | 32px Plus Jakarta numbers, icon chips, hover lift |
| Overdue rows merge | Grid layout, dividers, severity bar, hover bg |
| Footer scrollbar | `overflow-x: hidden` on main + footer |
| Sidebar inconsistency | Single hover/active style, brand-soft active state |

Inspired by Linear, Stripe, Vercel, Notion.
