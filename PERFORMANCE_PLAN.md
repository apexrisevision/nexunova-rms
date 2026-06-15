# Nexunova RMS — Performance Audit & Plan

**Read-only audit, 2026-06-14.** Measured against the repo on disk (byte counts via
`wc -c`, gzip estimates via `gzip -c`). No code changed. **Plan → owner review.**

> **The one-line headline:** the "4.6 MB" is a **single 6250×6250 PNG used as the
> favicon** (`assets/nexunova-icon.png` = **4,811,704 bytes**). Fixing that one line
> removes ~60% of the page weight at **zero risk**. Everything else is secondary.

---

## 0. Totals (measured)

| Group | Files | Raw bytes | Raw KB | Gzipped (est.) | Eager? | Ours/Vendor |
|---|---|---|---|---|---|---|
| **Favicon PNG** | 1 | 4,811,704 | **4,586 KB** | 4,467 KB (PNG ≈ incompressible) | yes (`<link rel=icon>`) | ours |
| Local JS | 87 | 2,637,891 | 2,576 KB | ~614 KB | **all eager, render-blocking** | ours |
| Local CSS | 36 | 1,062,302 | 1,037 KB | ~186 KB | all eager | ours |
| `login.html` itself | 1 | 222,405 | 217 KB | ~40 KB | — | ours |
| Vendor CDN JS | 5 | ~1,855 KB* | ~1,855 KB | (CDN-served) | all eager | vendor |
| Google Fonts | 2 families | ~100–200 KB | — | (CDN-served) | vendor |

*Vendor CDN raw bytes are the libraries' published sizes (not on disk): xlsx.full.min
~900 KB · three.min r128 ~580 KB · chart.umd 4.4 ~205 KB · supabase-js 2.34 ~120 KB ·
intl-tel-input 23.1 ~50 KB.

**Cold first load (no compression):** ≈ 4.59 MB favicon + 2.58 MB JS + 1.04 MB CSS +
0.22 MB HTML + ~1.86 MB CDN ≈ **~10.3 MB**. **With server gzip/brotli on text:**
≈ 4.59 (favicon, won't compress) + 0.61 + 0.19 + 0.04 + ~1.86 ≈ **~7.3 MB — and the
favicon alone is ~63% of that.**

---

## 1. The 97 scripts + 38 stylesheets

**Scripts: 97 total = 92 local (`js/…`) + 5 vendor CDN.** **0 use `defer`, 0 `async`,
0 `type=module`** — every one is a synchronous `<script src>` block (lines 3242–3380,
end of `<body>`). The browser must download → parse → execute **all 2.58 MB of JS**
before `js/init.js` boots the app.

### Biggest local JS (top of the list)
| Bytes | File | Group |
|---|---|---|
| 177,918 | js/pages/sales.js | page renderer |
| 141,165 | js/pages/reports.js | page renderer |
| 105,438 | js/pages/clients.js | page renderer |
| 104,417 | js/pages/agents.js | page renderer |
| 96,372 | js/pages/projects.js | page renderer |
| 95,819 | **js/data.js** | core (1,127 chars/line — embeds data; outlier) |
| 93,824 | js/pages/search.js | page renderer |
| 89,087 | js/pages/categories.js | page renderer |
| 88,761 | js/pages/print.js | page renderer |
| 80,047 | js/pages/contacts.js | page renderer |
| 66,134 | js/pages/transfers.js | page renderer |
| 64,158 | js/ui.js | core/router |
| 40,315 | js/foundation/kit.js | foundation |

**Groups:** **59 page renderers (`js/pages/*`) = 2,033 KB — 79% of all JS** and the
single biggest lever. Foundation kit (`kit.js`/`print.js`/`report-page.js`/`shell.js`) ≈
77 KB. Core/router/helpers (`data.js`, `ui.js`, `helpers.js`, `store/db.js`, `auth.js`,
`init.js`, `modals*`, `schedule.engine.js`) ≈ ~350 KB.

### Vendor CDN scripts (all loaded eagerly, every visit)
| ~Size | Lib | Used by | Needed on first paint? |
|---|---|---|---|
| ~900 KB | xlsx.full.min 0.18.5 | Excel export (reports/registers) | **No** — only on export click |
| ~580 KB | three.min r128 | **only** `js/login-bg.js` (login background) | **No** — login screen only |
| ~205 KB | chart.umd 4.4.0 | dashboard/report charts | Only when a chart renders |
| ~120 KB | supabase-js 2.34 | everything (data layer) | **Yes** |
| ~50 KB | intl-tel-input 23.1 | phone inputs (signup/forms) | No |

### Biggest local CSS (36 files, 1,037 KB — all eager)
104 dashboard-premium · 103 components · 102 visual-overhaul · 61 enterprise-polish ·
57 login · 51 payment-wall · 44 sidebar-premium · 39 followup · 38 reports-hub · 31
app · 31 saas-polish · 30 foundation/components · … (KB). Many overlapping
"premium/polish/aurora" layers (see §4).

---

## 2. Where the 4.6 MB comes from — **a favicon**

`assets/nexunova-icon.png` — **6250 × 6250 px, RGBA, 4,811,704 bytes** — is referenced
twice in `login.html`:
```html
<link rel="icon" type="image/png" href="assets/nexunova-icon.png">
<link rel="apple-touch-icon" href="assets/nexunova-icon.png">
```
The browser renders it at 16–32 px but downloads the full 4.6 MB. It is **the largest
single asset by a factor of ~26×** over the next file (sales.js, 178 KB). Smaller icons
already exist in the repo: `Logo/Nexunova logos/NexuNova_Icon_256px.png` (52 KB),
`assets/img/nexunova-logo.png` (79 KB), `assets/nexunova-logo-192.png` (232 KB).
A correct favicon is a 32–48 px PNG/ICO of a few KB.

---

## 3. Load behavior (confirmed)

- **Everything eager, nothing deferred.** No `defer`/`async`/`module` on any of the 97
  scripts → fully **render-blocking** (they sit at end of `<body>`, so the static login
  markup paints, but the **app cannot initialize until all ~2.58 MB JS is parsed**).
- **Yes — the dashboard waits for every page's JS.** All 59 page renderers
  (`sales.js`, `reports.js`, `agents.js`, …) load up front even though a session may
  only ever open 2–3 pages. `nav()` (in `js/ui.js`) just calls an already-loaded
  `rXxx()` render function — the architecture **pre-loads all pages**, exactly as noted.
- **Vendor libs eager too:** three.js (login-bg only) and xlsx (export only) are pulled
  on first paint of every session regardless of use.

---

## 4. Duplicate / dead weight

- ✅ **No dead archived JS loaded.** The three `archive` mentions in `login.html` are
  **comments** (`radar.js`/`executive.js`/topbar retired) — **0** active
  `<script src="js/pages/archive/…">`. Good.
- ⚠️ **Overlapping CSS "polish" layers (RISKY to cut):** `visual-overhaul.css` (102 KB),
  `saas-polish.css` (31 KB), `dashboard-premium.css` (104 KB), `enterprise-polish.css`
  (61 KB), `sidebar-premium.css` (44 KB), `footer-aurora.css`, `inventory-aurora.css` —
  all loaded. Per `KIT.md` the app is **mid-reskin**: legacy pages still depend on these,
  and `saas-polish` defines a `--nx-*` var set the kit deliberately avoids. **Real but
  entangled** — needs per-page coverage analysis before removal, not a blind delete.
- ⚠️ **JetBrains Mono font** — loaded via Google Fonts and referenced across **many**
  legacy CSS files (categories/components/dashboard-premium/…). `KIT.md` calls it
  "legacy life-support only" slated for removal once the last legacy page migrates.
- **One genuine asset duplication:** `assets/nexunova-icon.png` (4.6 MB) vs the 52 KB /
  79 KB / 232 KB icons — the giant one is used where a tiny one belongs.
- **No duplicate JS libraries** (one charting lib, one supabase, etc.).

---

## 5. Caching & minification

- **Per-file cache-busting is in place and good:** `?v=YYYYMMDDxx` tokens (e.g.
  `clients.js?v=20260614bp3`) mean only **changed** files re-download on deploy — the
  others stay cached. This is the right pattern; keep it.
- **No minification.** Files are hand-written source (sales.js ≈ 59 chars/line, CSS ≈
  43–59) — no build step (per the project's vanilla-HTML constraint). Raw JS is 2.58 MB.
- **Compression is the big free lever:** the text assets gzip to **~614 KB JS + ~186 KB
  CSS** (≈4× smaller). **Action: confirm the host serves `Content-Encoding: br`/`gzip`
  on `.js`/`.css`** (one DevTools check). If it's already on, "minify" is low-value; if
  off, turning it on beats hand-minifying and needs no build step. **The favicon PNG
  does not compress** (4,467 KB gzipped) — only a smaller image fixes it.

---

## 6. The wins — ranked by impact ÷ risk

| # | Win | Est. saving (first load) | Risk | Effort |
|---|---|---|---|---|
| **1** | **Shrink the favicon** | **~4.58 MB** | **None** | trivial |
| **2** | **Confirm/enable gzip-brotli** on text | ~2.8 MB → ~0.8 MB JS+CSS | None | config check |
| **3** | **Lazy-load vendor CDN** (three/xlsx/chart on demand) | ~1.5–1.7 MB off first paint | Low–Med | small |
| **4** | **Lazy-load page renderers** via `nav()` | ~1.9 MB JS off first paint | **Med–High** | large |
| **5** | **Drop JetBrains Mono** | ~60–100 KB + a font fetch | Low–Med | small |
| **6** | **Consolidate/dead CSS** | up to ~0.4–0.6 MB | **High** | large (audit-first) |

### Detail per win — saving · risk · verification

**1 — Favicon (DO FIRST).**
*Save* ~4.58 MB (the biggest line item by far). *How:* generate a 48 px (and 192 px
apple-touch) icon from the existing logo, repoint the two `<link>`s; keep the source PNG
out of the icon slot. *Risk:* none — affects only the browser-tab icon. *Verify:*
DevTools → Network → favicon request now a few KB; tab/bookmark icon still shows.

**2 — Compression.**
*Save:* JS 2.58 MB→~0.61 MB, CSS 1.04 MB→~0.19 MB **if not already gzipped**. *How:*
verify the static host (Netlify/Vercel/nginx/Electron file-serve) sends
`Content-Encoding`. *Risk:* none. *Verify:* response headers show `br`/`gzip` on `.js`/`.css`.

**3 — Lazy vendor libs.**
*Save:* don't fetch three.js (~580 KB) except on the login screen, xlsx (~900 KB) except
on export, chart.js (~205 KB) except when a chart mounts. *How:* inject the `<script>` on
first use (a tiny `loadScript(url)` promise) — no bundler. *Risk:* low–med — export/chart
call sites must `await` the loader; login-bg must wait for three. *Verify:* login
background still animates; an Excel export still downloads; dashboard/report charts
render; Network shows the lib fetched only on that action.

**4 — Lazy page renderers (the architectural win).**
*Save:* ~1.9 MB — load a page's `js/pages/X.js` only when `nav('X')` first routes to it.
*How:* a route→script map; `nav()` `await loadScript()` before calling `rX()`; keep core
(`data.js`,`ui.js`,`helpers.js`,`store/db.js`,`kit.js`,`auth.js`,`init.js`) eager. *Risk:*
**med–high** — some renderers reference globals defined in sibling page files, modal
wiring, and the `?v=` tokens must travel with the dynamic loader; a missed dependency
shows as "rXxx is not defined" on first navigation. *Verify:* click through **every**
sidebar route + every "+ New"/modal action with the console open — zero "undefined"
errors; each page renders identically to today. (Highest value, so do it **after** the
zero-risk wins, with a full nav sweep.)

**5 — Drop JetBrains Mono.**
*Save:* a font family + its CSS. *How:* replace `JetBrains Mono` usages with the kit's
`.num`/system mono per `KIT.md`'s stated plan. *Risk:* low–med — legacy pages that
hardcode it for amounts fall back to system mono (cosmetic). *Verify:* amounts still
legible/aligned across legacy pages, light+dark.

**6 — CSS consolidation (LAST, audit-first).**
*Save:* up to ~0.4–0.6 MB if overlapping polish layers collapse. *How:* per-page CSS
coverage audit (which selectors each un-migrated page actually uses) before removing any
file. *Risk:* **high** — blind removal silently breaks legacy pages mid-reskin. *Verify:*
screenshot every page light+dark before/after; pixel-diff.

---

## 7. Safe build order (lowest-risk/highest-value first)

1. **Favicon shrink** — ~4.58 MB, zero risk. *(Ship alone, immediately.)*
2. **Confirm gzip/brotli** is on for `.js`/`.css` — ~2.8 MB if not, zero risk.
3. **Lazy-load three.js + xlsx + intl-tel-input** (clear single-use libs) — ~1.5 MB, low risk.
4. **Lazy-load chart.js** (slightly more call sites) — ~205 KB, low risk.
5. **Lazy-load page renderers** via `nav()` — ~1.9 MB, the big architectural win, med–high
   risk → full click-through verification.
6. **Drop JetBrains Mono** — small, low–med risk.
7. **CSS dead-weight consolidation** — large, high risk, **audit-first**; do last.

**Constraint honored throughout:** no webpack/bundler. Wins 1–6 are dead-weight removal,
config, and on-demand `<script>` injection through the existing `nav()` router — all
within the vanilla-HTML, per-file-`?v=` model. A bundler is explicitly *out of scope*
unless the owner later sanctions it as its own phase.

---

### Appendix — method
Byte counts: `wc -c` on each `src=`/`href=` (minus `?v=`) in `login.html`. Gzip
estimates: `gzip -c | wc -c` over concatenated `js/**/*.js` and `css/**/*.css`.
Load behavior: `grep` for `defer|async|type=module` (all 0) and script line positions
(3242–3380). Image dims: `file assets/nexunova-icon.png` → 6250×6250 RGBA. Vendor sizes
are the libraries' published CDN sizes (not on disk).
