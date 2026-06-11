# NEXUNOVA RMS — COMPLETE UI/UX AUDIT (READ-ONLY)

**Date:** 2026-06-11 · **Auditor:** Claude (senior product engineer pass)
**Trigger:** paying prospect rejected product as "complicated, messy, not premium, confusing."
**Scope:** every page, report, component, token, and add-flow. No code was modified. `js/pages/reports.js` and print/PDF paths were read but not touched (concurrent fix in another terminal).
**Method:** static code audit (grep/read of all 62 page modules, 35 CSS files, login.html shell, ui.js router) + read-only SQL against the live RMS DB (`pg_proc` inspection, verified target = RMS project).

> **CORRECTION (2026-06-12, verified live):** §8(c) and §11 #1 are WRONG — default seeding DOES exist: `upsert_project` calls `public.seed_default_categories(company_id, project_id)` on every new-project INSERT, seeding 10 unit types + 10 statuses (incl. Available with `is_available:true`), `ON CONFLICT DO NOTHING`. The audit grep searched table-name strings and missed the function call. The quick-add `is_available:false` trap (§8c/§11 #2) WAS real and was fixed in the 2026-06-12 P0 hotfix. Do not plan a seeding migration in later phases.

---

## 1. PAGE & MODULE INVENTORY

**Topline: 63 in-app routes (ui.js:899 route map) + 9 shell screens (login.html `s-*` IDs) + 3 standalone HTML apps (buyer-portal.html, pay.html, signup.html) ≈ 71 user-facing surfaces. 46,800 LOC in js/pages alone.**

Nav: Admin sidebar = 8 groups / 38 items (ui.js:470–544). Many routes are reachable only from in-page buttons, not nav.

### Shell screens (login.html)
| Screen | Purpose | Verdict |
|---|---|---|
| s-login | Login | CORE |
| s-signup | Tenant signup (signup.js, 642 LOC) | CORE |
| s-forgot / s-reset | Password recovery (forgot-password.js) | CORE |
| s-email-confirm | Email confirm landing | CORE |
| s-onboarding | 6-step setup wizard (onboarding.js, 815 LOC) | CORE |
| s-payment-wall | Subscription block (payment-wall.js, 741 LOC) | SUPPORT |
| s-super-admin | Platform super-admin (super-admin.js, 1002 LOC) | SUPPORT (internal) |
| s-app | Main app shell | CORE |

### In-app routes (route → file, LOC, nav group, verdict)
| Route | Title | File (LOC) | Nav | One-liner | Verdict |
|---|---|---|---|---|---|
| dashboard | Dashboard | dashboard.js (1687) | Home | Command-center KPIs | CORE |
| contacts | Inbox / Call Logs | contacts.js (1384) | Home | Follow-up call log (appears twice in non-admin navs as "Inbox" AND "Call Logs") | CORE (rename) |
| approvals | Approvals | approvals.js (884) | Home | Discount/breach approval queue | SUPPORT |
| team | Team | team.js (306) | Home | Staff performance | SUPPORT |
| (setup-wizard) | Setup Wizard | onboarding.js | Home | Re-launches onboarding | SUPPORT |
| projects / projectdetail | Projects | projects.js (1792) | Setup | Project master + milestones/banks/expenses tabs | CORE |
| categories | Types & Floors | categories.js (1753) | Setup | Floors / unit types / unit statuses (3-column) | CORE (critical prerequisite page) |
| banks | Banks Master | banks.js (139) | Setup | Bank list | SUPPORT |
| users | Users & Roles | users.js (553) | Setup | Sub-user management | CORE |
| admin | Settings | admin.js (805) | Setup | Company settings panel | CORE |
| clients / clientdetail | Clients | clients.js (1959) | Parties | Client master (+health & blacklist as tabs) | CORE |
| agents / agentdetail | Sales Agents | agents.js (2243) | Parties | Agent master + commissions | SUPPORT |
| sales / salesdetail / newsale / editsale | Sales & Bookings | sales.js (3335) | Sales&Units | Sale register + booking form + schedule grid | CORE |
| units / unitdetail / addunit | All Units | units.js (2516) | Sales&Units | Inventory. **TWO add-unit paths: full page `rAddUnit` (units.js:2040) AND modal `openUnitModal` (units.js:875)** | CORE (merge paths) |
| noc | NOC Management | noc.js (685) | Sales&Units | NOC issuance | BLOAT-CANDIDATE |
| transferunits | Transferred Units | transferred.js (254) | Sales&Units | Transfer ledger | SUPPORT |
| cancelledunits | Cancelled Units | cancelled.js (250) | Sales&Units | Cancellation ledger | SUPPORT |
| commissions | Commissions | agents.js (shared) | Sales&Units | Pay agent commission | SUPPORT |
| agenttransactions | Agent Transactions | agenttransactions.js (209) | Sales&Units | Agent money log | BLOAT-CANDIDATE (overlaps commissions + agent ledger) |
| receipts | Receipt Vouchers | receipts.js (361) | Payments | Voucher list/print | CORE |
| pdc | PDC Register | pdc.js (607) | Payments | Cheque lifecycle (clear/bounce/deposit) | CORE |
| paylinks / paylink-detail | Payment Links | payment-links.js (1068) | Payments | Online payment links | BLOAT-CANDIDATE (no gateway live; Module 7 deferred) |
| receivables | Additional Receivables | receivables.js (255) | Payments | Extra charges | BLOAT-CANDIDATE |
| payables | Payables | payables.js (173) | Payments | Refunds owed | SUPPORT |
| ledgers + ledger-client/-unit/-agent/-project | Ledgers | ledgers.js (587) + 4 stubs (~70 each) | Payments | Crystal-style ledgers | CORE |
| recovery | Recovery Queue / "Payments" | recovery.js (242) | Recovery | Work queue. **Same route labelled "Payments" for accounts role, "Recovery Queue" for admin** | CORE (one name) |
| addpayment | Add Payment | payments.js (2380) | (button) | 3-step receive-payment wizard | CORE |
| recovery-dashboard | Recovery Dashboard | recovery-dashboard.js (359) | Recovery | Recovery KPIs (overlaps dashboard + executive) | BLOAT-CANDIDATE |
| promises | Promise Tracker | promises.js (995) | Recovery | Payment promises | SUPPORT |
| reminders | Reminders | reminders.js (332) | Recovery | Due reminders (overlaps promises/followups) | BLOAT-CANDIDATE |
| campaigns | Campaigns | campaigns.js (477) | Recovery | Bulk recovery campaigns | BLOAT-CANDIDATE |
| fieldvisits | Field Visits | fieldvisits.js (413) | Recovery | Site-visit log | BLOAT-CANDIDATE |
| escalations | Escalations | escalations.js (379) | Recovery | Escalation register (DX reference impl) | BLOAT-CANDIDATE |
| legalcases | Legal Cases | legalcases.js (597) | Recovery | Court case tracker | SUPPORT |
| executive | Executive Dashboard | executive.js (162) | Reports | KPI overview (3rd dashboard) | BLOAT-CANDIDATE |
| reports | Reports & Export | reports.js (2836) | Reports | Reports hub + viewer (see §2) | CORE |
| forecasting | Forecasting | forecasting.js (156) | Reports | "AI" collection forecast | BLOAT-CANDIDATE |
| radar | Recovery Radar | radar.js (882) | Reports | "AI-scored" prospect list | BLOAT-CANDIDATE |
| documents | Documents | documents.js (343) + print.js (1435) | Reports | Print center (vouchers, statements) | CORE |
| commscenter | Comms Center | comms-center.js (451) | Reports | WhatsApp dispatch log | SUPPORT |
| backup | Backup | backup.js (129) | System | Data export | SUPPORT |
| audit | Audit Trail | audit.js (733) | System | Action log | SUPPORT |
| search | Quick Search | search.js (1440) | (Ctrl-K / role nav) | Global find-unit | CORE |
| payment-methods | Payment Methods | payment-methods.js (260) | (admin) | SaaS receiving accounts | SUPPORT |
| officerledger | Officer Ledger | officerledger.js (176) | (links) | Per-officer collections | BLOAT-CANDIDATE (= staff report) |
| receivingledger | Receiving Ledger | receivingledger.js (141) | (links) | All receipts list | BLOAT-CANDIDATE (= `recovery` report duplicate) |
| unittransfer / unitcancel / unitchain | Transfer/Cancel/Chain | transfers.js (1155), cancellation.js (922), ownership-chain.js (266) | (unit detail) | Ops flows | CORE (transfer/cancel), SUPPORT (chain) |
| possession | Possession | possession.js (395) | (unit detail) | Handover checklist | BLOAT-CANDIDATE |
| healthcenter / blacklist | (redirects) | health-center.js (202), blacklist.js (228) | — | Both now redirect to Clients tabs but **both files still ship** | BLOAT (dead routes) |
| changepassword | Change Password | (ui.js) | profile | — | SUPPORT |
| tutorial | Tutorial overlay | tutorial.js (199) | — | First-run tour | SUPPORT |
| company-branding | Company Setup modal | company-branding.js (544) | Admin | Branding wizard (2nd "setup wizard") | SUPPORT (overlaps onboarding) |

**Count by verdict: CORE ≈ 24 routes · SUPPORT ≈ 19 · BLOAT-CANDIDATE ≈ 15 · dead/redirect 2.** Three dashboards exist (dashboard, recovery-dashboard, executive) plus radar — four "overview" screens answering overlapping questions.

---

## 2. REPORTS INVENTORY

**Topline: 35 reports defined in `RPT` (reports.js:3–52) with 82 sub-variants — but the hub (`_DEPTS`, reports.js:58–63) renders only 17 of them. The hero banner says "35 reports across 4 departments" (reports.js:661) while showing 17 → 18 reports are ORPHANED (reachable only via stale Recently-Viewed chips or direct `openRptViewer` calls from other pages).**

Data-source note: **no current report RPC joins `payments.installment_id`** (verified against live `pg_proc`). The only DB functions referencing an `installment_id` are `get_all_promises`, `get_cash_forecast`, `list_payment_promises_by_unit` — all on `payment_promises.installment_id`, which is legitimate. The historical zero-rows bug lived in the OLD `get_recovery_position`, replaced 2026-06-11. However, `payments.js:349` still *reads* `r.installment_id` (always NULL) for display.

Export reality: every hub row gets **Run + Excel** (`_rhRunExcel`, table_to_sheet/json_to_sheet, reports.js:2081–2163). Viewer has a **Print** button (reports.js:718) that opens a popup → browser print/save-as-PDF. **There is no real PDF engine anywhere (no jsPDF/html2pdf in login.html)** — "PDF" = browser print dialog. Recovery Position has its own dedicated Excel (reports.js:2620) and Crystal-letterhead print (reports.js:2545–2556, under repair in other terminal).

Legend — Style: HUB (generic viewer table), RP2 (new Crystal/letterhead document), CUSTOM. Dist = distance from target "Report Document" template (LOW = close, HIGH = total rebuild).

| # | Key | Name | Answers | Source RPC | In hub? | State | Style | Excel/Print | Dist |
|---|---|---|---|---|---|---|---|---|---|
| 1 | recovery_position | Recovery Position (Grand Summary) | period rollforward per sale | get_recovery_position (v3) | ✅ | WORKS (verified vs ground truth) | RP2 letterhead | ✅/✅(fixing) | **LOW — this IS the template seed** |
| 2 | outstanding | Outstanding | who owes what now | list_payments_filtered + cache | ✅ | works | HUB table | ✅/print | MED |
| 3 | aging | Aging Analysis | overdue buckets 30/60/90/180 | client cache calc | ✅ | works | HUB + bucket cards | ✅/print | MED |
| 4 | monthly_trend | Collection Trend | month-wise receipts | list_payments_filtered | ✅ | works | HUB + chart | ✅/print | MED |
| 5 | agent_recovery | Agent Recovery | collections per agent | list_payments_filtered | ✅ | works | HUB | ✅/print | MED |
| 6 | promise_tracker | Promise Tracker | promises kept/broken | get_all_promises | ✅ | works | HUB | ✅/print | MED |
| 7 | field_visits | Field Visits | visit log | list RPC | ✅ | works | HUB | ✅/print | MED |
| 8 | recovery | Receiving Ledger | all payments received | list_payments_filtered | ✅ | works | HUB | ✅/print | MED |
| 9 | statement | Client Ledger | per-client account | client-side calc | ✅ | works | HUB | ✅/print | MED |
| 10 | payables | Payables | refunds owed | list RPC | ✅ | works | HUB | ✅/print | MED |
| 11 | sales_register | Sales Register | all sales | list_sales_for_report | ✅ | works | HUB | ✅/print | MED |
| 12 | unit_status | Units by Status | status-wise count/value | list_sales_for_report + cache | ✅ | works | HUB | ✅/print | MED |
| 13 | sale_type | Sales by Type | deal-type breakdown | get_sales_unit_map | ✅ | works | HUB | ✅/print | MED |
| 14 | pdc | PDC Register | cheque status | list RPC | ✅ | works | HUB | ✅/print | MED |
| 15 | cancelled | Cancellations | cancelled sales | list_sales_for_report | ✅ | works | HUB | ✅/print | MED |
| 16 | ai_radar | AI Radar Summary | scored prospects | radar cache | ✅ | works | HUB | ✅/print | HIGH (cut) |
| 17 | forecasting | Forecasting | 30/60/90 forecast | get_cash_forecast | ✅ | works | HUB | ✅/print | HIGH (cut) |
| 18 | project | Project Summary | project P&L | cache | ❌ ORPHAN | unreachable from hub | HUB | ✅/print | MED |
| 19 | unit | Unit Inventory | unit status list | cache | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 20 | floor_type | Floor / Type | breakdown by floor | cache | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 21 | discount | Discount Report | discounts given | list_sales_for_report | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 22 | commission | Commission | earned vs paid | list_agent_commissions_with_agent | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 23 | commission_hist | Comm. History | payout log | list_agent_commission_payments | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 24 | staff | Staff Report | staff performance | list_payments_filtered | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 25 | client | Client Portfolio | clients & defaulters | cache | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 26 | possession | Possession Status | handover tracking | list_possessions_filtered | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 27 | post_possession_dues | Post-Possession Dues | dues after handover | get_post_possession_dues | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 28 | legal_portfolio | Legal Cases Portfolio | active cases | list_legal_cases | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 29 | transfers_register | Transfers Register | ownership transfers | list_unit_transfers_search | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |
| 30 | pdc_upcoming | Upcoming Cheques | due next 7/30d | list RPC | ❌ ORPHAN | unreachable (subset of #14) | HUB | ✅/print | MERGE |
| 31 | contacts | Follow-up Log | call history | cache | ❌ ORPHAN | unreachable (= Inbox page) | HUB | ✅/print | MERGE |
| 32 | followup | Follow-up Schedule | scheduled follow-ups | cache | ❌ ORPHAN | unreachable (subset of #31) | HUB | ✅/print | MERGE |
| 33 | activity | Daily Activity | staff actions | cache | ❌ ORPHAN | unreachable (≈ #24) | HUB | ✅/print | MERGE |
| 34 | executive | Executive Summary | business KPIs | cache | ❌ ORPHAN | unreachable (= executive page) | HUB | ✅/print | MERGE |
| 35 | tax_report | Tax / WHT | FBR WHT | sale wht field | ❌ ORPHAN | unreachable | HUB | ✅/print | MED |

### Duplication map (merge candidates → 8 core reports)
1. **Recovery Position** ⊃ outstanding + aging + agent_recovery (all answer "who owes what / how overdue") → ONE "Recovery Position" with aging columns + officer filter.
2. **Receiving Ledger** (recovery) = receivingledger.js page = officerledger.js page = staff(payments sub) = activity → ONE "Collections Register" with group-by date/staff/type.
3. **Sales Register** ⊃ sale_type + discount + cancelled(report) + transfers_register → ONE "Sales Register" with type/status filters.
4. **Client Statement** (statement) = client(ledger sub) = ledgers.js client ledger → ONE "Client Statement" on the document template.
5. **PDC Register** ⊃ pdc_upcoming → ONE with date-range filter.
6. **Unit Inventory** ⊃ unit_status + floor_type + project(units sub) + possession → ONE "Inventory Status".
7. **Commission** ⊃ commission_hist + agent_recovery(agent view) → ONE "Agent Commission".
8. **Collection Trend** (monthly_trend) ⊃ executive + forecasting → ONE "Performance Summary".
   Cut outright: ai_radar, contacts/followup (they're work queues, not reports), tax_report (fold into Sales Register column).

**Template distance:** only recovery_position has the formal header block / ruled repeating-thead table / totals / footer. The other 34 share the generic HUB viewer (`#rh-*`/`rpt-*` markup) — header is app-chrome, not a document. Migrating = re-pointing each renderer at the RP2 letterhead shell; data plumbing already exists.

---

## 3. TYPOGRAPHY CHAOS

**Font sizes: 35 distinct values in active use.**
- CSS: **34 distinct** across 1,416 `font-size` declarations. Top: 11px(272), 12px(270), 13px(185), 10px(155), **12.5px(69)**, 14px(66), **10.5px(49)**, 22px(46), **11.5px(43)**, 9px(39)… up to 56px. Fractional sizes (8.5/9.5/10.5/11.5/12.5/13.5/15.5px) = 152 declarations of pure noise.
- JS inline styles: **2,364 more** `font-size` declarations (28 distinct, adds 7px). 676× 11px, 491× 12px, 388× 10px. **Inline JS styling outnumbers CSS — the design system literally lives in string templates.**

**Font weights** (CSS+JS): 700×**1008**, 600×617, 500×306, 800×**197**, 400×69, 900×7, 300×2. The product is ~55% bold/extra-bold by declaration count — directly opposite the owner's "no bold prominence" rule.

**Font families — 5 typefaces ship:**
- `Inter` (the token) — only ~26 direct declarations.
- `'Plus Jakarta Sans'` — **62 declarations** (dashboard-premium, login, signup) — a whole second UI font, 11 with `!important`.
- `'JetBrains Mono'` — 38, `'Space Mono'` — 27, plain `monospace` — 144 (JS), `'DM Mono'` — 3 (JS), plus stray `Arial` (8, JS) and `Georgia` (2, JS print).
- 34 distinct font-family value-strings total in CSS; `var(--font)` used only 37 times.

**LITE mode typography** (visual-overhaul.css:2333–2638): its own micro-scale — re-declares sidebar/nav/page-header sizes (13px nav, reduced paddings) with `!important` on nearly every rule; ~20 font-size/weight overrides scoped under `body.mode-lite`, including `-webkit-text-fill-color` hacks (lines 2375, 2409).

---

## 4. COMPONENT FRAGMENTATION

| Component | Distinct implementations | Evidence | Closest-to-token variant |
|---|---|---|---|
| **Cards** | **162 card-class selectors**, ~25 independent card systems | `.card`(60 rules, components.css), `.db-card`(26, dashboard-premium), `.stat-card`(24), `.inv-board-card`/`.inv-grid-card`(28, inventory), `.app-card`(15), `.rh-card`(14, reports-hub), `.cc-card`(13), `.zp-card`(12), `.adm-nav-card`(10), `.sg-pcard`(9, signup), `.pm-card`, `.cx-card`, `.prj-kpi-card`, `.ob-mode-card`, `.d-qa-card`, `.qa-card`, `.pl-stat-card`… | Base `.card` in components.css (radius ~12px, 1px border) — extend it, kill the rest |
| **Buttons** | **106 btn-class selectors**; core set alone has 20 variants | `.btn`, `.btn-g`(24), `.btn-gh`(26), `.btn-d`(13), `.btn-r`(9), `.btn-gr`(9), `.btn-out`(7), `.btn-sm`, `.btn-xs`, `.btn-xs-icon-only`, `.btn-w`, `.btn-p`, `.btn-print`, `.btn-primary`, `.btn-add`, `.btn-create`, `.btn-edit`, `.btn-delete`, `.btn-danger`, `.btn-filter` + page-prefixed ones (`.dx-tool`, `.rh-row-run`, `.dx-bulk-btn`…) | `.btn` + `.btn-g/.btn-gh/.btn-d/.btn-r` quartet ≈ primary/ghost/secondary/danger — formalize exactly these 4 + 2 sizes |
| **Tables** | **30 table class systems in CSS**; 55 `<table>` literals in reports.js alone, 14 in sales.js, 14 in agents.js… | `.dx-table` (DX system, components.css) vs `.tbl` vs reports' inline tables vs Crystal ledger sheet vs pdc table vs print tables | **DX (`.dx-*` + window.DX)** — already the declared standard, but only **5 of 62 pages** use it (clients, escalations, pdc, team, units) |
| **Modals** | 11 modal-class selectors + **20 distinct max-width values** (480px×7, 500px×6, 460px×4, 600px×3, 1240px×3, 820, 768, 700, 640, 620, 580, 560, 520, 440, 420, 320, 285…) | modals.js, login.html inline, components.css | The 480/500px `m-*` pattern in components.css — standardize to S(440)/M(640)/L(880) |
| **Form inputs** | Label/validation handled 3+ ways: `.pf-err` (projects/units), `.cf-err` (clients), `.inp-err` class toggle, plus toast-only errors elsewhere | units.js:893, clients.js:1549, projects.js:1135 | `.inp` + `.inp-err` + per-field err element — make it the only pattern |
| **Badges/chips** | `_pill()` (categories.js:467), `.bdg` nav badges, status badges `_salStatusBadge`/`_instStatusBadge`/`_instTypeBadge` (sales.js:64–96), `.rh-recent-chip`, DX chips — ≥6 systems | — | DX chip |
| **Tabs** | Pill tabs (unit-detail 5-tab), `.rh-pill` (reports), clients tabs, categories tabs, admin tabs — ≥5 styles | — | clients-page tabs |
| **Dropdowns** | native `<select>`, `_catKebab` custom menu (categories.js:655), `_pdcProjectMenu` (pdc.js:122), `_invBulkStatusMenu` (units.js:629), topbar-aurora mega-menu — ≥5 | — | native select + one styled menu helper |

---

## 5. COLOR & TOKEN VIOLATIONS

**Totals: 2,188 hardcoded hex in CSS (213 distinct) + 2,019 in JS (198 distinct) ≈ 4,200 hardcoded color literals.** Token usage (`var(--…)`) is the minority path.

Worst offenders (CSS counts):
- `#2563eb` ×232 — Blue-600 used as de-facto brand **while the stated token is indigo `#4F46E5`**. Two competing brand colors ship today (`SWATCHES` in onboarding.js even offers both).
- `#ffffff`/`#fff` ×233 → should be `var(--card)`/`--bg`.
- `#0f172a` ×97, `#1e293b` ×29, `#334155` ×20, `#475569` ×26, `#64748b` ×66, `#94a3b8` ×69, `#cbd5e1` ×23, `#e2e8f0` ×78, `#f1f5f9` ×49, `#f8fafc` ×31 — the entire Slate ramp inlined ≈ 490 times → `--t1/--t2/--t3/--line/--bg2`.
- `#00d9ff` ×88 — Aurora cyan (topbar/footer), a third accent family.
- Status colors inlined everywhere: `#dc2626`×57, `#ef4444`×35, `#16a34a`×31, `#10b981`×39, `#d97706`×33, `#f59e0b`×25, `#7c3aed`×32, `#a855f7`×33 → `--err/--ok/--warn/--brand2`.
- Report dept colors hardcoded in JS: reports.js:54 (`_RPT_SEC_COL` — 12 hex values), :58–62 (4 more), sale-type fallback `#94A3B8` (reports.js:1537).

**Gradients: 319 in CSS + 40 in JS = 359 total (forbidden except chart fills).** Hotspots: visual-overhaul.css (50), login.css (26), dashboard-premium.css (23), inventory-drawer.css (23), topbar-aurora.css (20), payment-wall.css (18), saas-polish.css (18), footer-aurora.css (16), inventory-aurora.css (16), signup.css (12). Only the sparkline fill (reports.js:178) is a legitimate chart gradient.

**Emoji in UI: 221 occurrences in page JS (forbidden — Lucide only).** Worst: reports.js **80** (section headers literally render "💰 Recovery", "🏗️ Project" — reports.js:54–55 and every `sec:` field), noc.js 16, dashboard.js 15, payments.js 12, approvals.js 12, legalcases.js 8, company-branding.js 8.

---

## 6. SPACING & SIZING

- **Padding:** 405 distinct `padding:` value-strings in CSS. **Gap:** 100 distinct (incl. `8px !important` ×12, `10px !important` ×12 — !important on layout gaps).
- **Single px values used in padding/margin/gap: 37 distinct** (1–90px). On the 4/8/12/16/24 target scale: only 5 values → **32 distinct values are off-scale**, accounting for ~2,400 of ~3,560 declarations (67%). Biggest off-scale: 10px(323), 14px(291), 6px(226), 2px(176), 18px(152), 20px(144), 5px(126), 3px(105), 7px(103), 9px(94).
- **Border-radius: 76 distinct values** (target: 2). 10px(104), 8px(94), 6px(80), 12px(43), 7px(42), 9px(41), 4px(29), 5px(19), 14px(15)… plus 9 different radius *variables* (`--rm`, `--r`, `--rs`, `--x-r-sm/md/lg`, `--rops-radius`, `--rops-radius-sm`, `--v-card-radius`) — even the tokens are fragmented.
- **Box-shadow: 350 distinct definitions** across 460 declarations (target: ~3 elevation steps). Effectively every shadow is bespoke.

---

## 7. LITE MODE FOOTPRINT (inventory only)

Small, well-contained — **2 files**:
1. **js/ui.js** — ~85 lines: `RMS_LITE_NAV` whitelist of 8 pages (ui.js:302–312), `getUIMode()/setUIMode()` (314–326), toggle renderer `_renderModeToggle` (≈330–345, Lite/Pro buttons), final nav filter + `body.mode-lite` class (653–673), call at 774. **Default is `'lite'` for admins when no localStorage key exists (ui.js:315).**
2. **css/visual-overhaul.css** — lines 2333–2638 (~305 lines), all scoped `body.mode-lite #s-app …`, heavy `!important`, separate light-theme duplicates (2391–2419).
3. **localStorage key:** `rms.uimode` (`'lite'|'pro'`).
4. Side effects of removal: `nav('dashboard')` redirect for non-whitelisted pages (ui.js:326); `document.body.classList.toggle('mode-lite')` (659); mode toggle UI in sidebar.

**Blast radius: LOW.** Delete the CSS block, the ~85 ui.js lines, and the storage key; no other file references `mode-lite` or `getUIMode`. (Note: the separate "Dashboard Lite" feature was already reverted 2026-06-07; this nav-Lite v2 from 2026-06-08 is what remains.)

---

## 8. WORKFLOW FRICTION (code-walked as a brand-new user; click counts = code-derived estimates)

### (a) Fresh signup → first project — **pain 6/10**
signup.html: plan defaults to free_trial (signup.js:8) → ~6 fields + submit (7 interactions) → email confirm round-trip (leave app, click link — 2) → login (3) → onboarding wizard auto-opens, **6 steps** (onboarding.js:33): Company Info → **Branding (color/theme — step 2, before you've created anything!)** → Projects → Business Rules → Users → Review. Minimal path ≈ 10–14 more interactions. **Total ≈ 22–26 interactions, 4 screens.** Confusions: branding before data; "Business Rules — Limits & fees" jargon at minute 2; wizard skippable, after which Projects lives under a collapsed-by-default mental model (Setup group is expanded, fine). Project modal itself is fine (1 required field, projects.js:1135) but sits inside a 1,792-LOC page with milestones/banks/expenses tabs.

### (b) Add floors — **pain 5/10**
Sidebar → Setup → **"Types & Floors"** (route name `categories` — three names for one concept). Page **demands a project selection first** (`_catRequireProject`, categories.js:27) — *but floors are company-wide, not per-project* (db.js:521–524 has no projectId on floors; categories.js:614 saves floor without project_id). So the UI forces an irrelevant choice. Quick-add: ~4 clicks/floor. **Nothing anywhere tells the user floors are optional for units** (unit modal: "— No Floor / Not Set —", units.js:929). **Worse: units store the floor as a *label string*, matched case-insensitively by name** (units.js:925–927 "no floorId stored on units") — rename a floor and every existing unit silently unlinks.

### (c) Add unit types / categories — **pain 8/10 (worst hidden prerequisite)**
Same page; types & statuses ARE per-project. **The system seeds NOTHING**: verified in live DB — `signup_new_company` and `upsert_project` touch no unit_types/unit_statuses/floors. A new project has zero types and zero statuses. The user is **never told** they must come here before adding units. ~4 clicks per type + ~4 per status, per project. **Trap:** quick-add status hardcodes `is_available: false` (categories.js:628) — and the New Sale unit picker filters `u.isAvailable !== false` (sales.js:316). A user who quick-adds "Available" gets units that **can never be sold**, with no error anywhere. Setting availability requires opening the full status modal — hidden knowledge squared.

### (d) Add units — single **pain 7/10**, bulk **pain 6/10**
**Two parallel add paths**: full page `rAddUnit` (units.js:2040, route `addunit`) AND modal `openUnitModal` (units.js:875) — different layouts, same job. Modal = **22 fields** (unit no, project, floor, type, status, block, area+unit, bed, bath, parking, price, facing, premium, features, notes, maintenance, possession date, handover status, transfer history, image URLs, doc URLs) for **2 required** (unit no + project, units.js:1042–1043). Type/Status dropdowns are **empty until a project is picked** and stay empty if (c) wasn't done — no inline "create types" link, just a barren select. Steps when prerequisites exist: Units → Add Unit → project → no → type → status → Save ≈ **7 interactions**. From fresh signup the real total is ~35–40 (see end). Bulk: Units → Import → **paste CSV into a textarea** (units.js:1214–1238) → preview → save. Works, but no file upload, no template download visible, no floor/status mapping.

### (e) Add a client — **pain 6/10**
Clients → Add Client → **one modal with ~30 fields** across identity/contact/KYC docs/next-of-kin/bank (clients.js:1534–1539) — no grouping into steps, no progressive disclosure. Only name effectively required. **Data-integrity trap:** `saveClient` writes to localStorage FIRST and falls back to a fake `local_<timestamp>` id if the RPC fails (js/store/db.js:221–258) — the user sees a "saved" client that exists only in that browser.

### (f) Create a booking/sale — **pain 8/10**
Sales → New Sale = **full-page form with 30 `sf-*` fields** (sales.js:308–670): unit, client, date, sale type, **price-per-sqft (required)**, area, total, discount (+ approved-by + notes), WHT, net, down payment, installment count/type, agent, commission pct/amt, co-buyer (name/CNIC/share), nominee (name/CNIC/relation), notes, schedule grid (add/delete/insert rows, cumulative balance)… Confusions: **a unit without `area` cannot be sold at all** ("Select a unit with area set in Add Unit", sales.js:1344-ish validation) — pricing is sqft-driven with no flat-price path visible; discount can trigger a **breach-approval modal** (`_salShowBreachModal`, sales.js:862) — surprise governance mid-flow; client must already exist (jump-out helper `_salJumpAdd` exists but saves/restores form state — fragile). Minimum happy path ≈ **12–15 interactions** after prerequisites; total prerequisite chain = project + types + statuses + unit(with area!) + client.

### (g) Record a payment — **pain 5/10 (best flow in the app)**
Sidebar Recovery Queue or quick-add → `addpayment` 3-step wizard (payments.js): Step 1 project cards → Step 2 client/unit search → Step 3 schedule rows → "Receive" modal (amount, date, method, bank…) → save. ≈ **8–10 clicks**. Good empty state ("No sold units yet — Create a sale first", payments.js:44). Friction: 2 selection screens before the actual unit even with 1 project; "cascade vs custom allocation" jargon; `trg_payment_health` trigger can hard-RAISE 'forbidden' (memory-verified) → cryptic failure.

### (h) Record/manage a PDC — **pain 7/10**
**There is no "Add PDC" button anywhere.** pdc.js (607 LOC) has zero create functions — only clear/bounce/deposit/redeposit (pdc.js:437–594). Cheques enter ONLY by choosing method=cheque inside flow (g). The PDC Register never says this. A user holding 12 cheques from a new sale has no idea the entry point is "Add Payment". Managing existing PDCs is decent (drawer, status actions, aging analytics).

### (i) Run a report and export — **pain 4/10**
Reports → hub (search/favorites/recents — genuinely good) → Run → viewer → sub-tabs/filters → Excel ✓ (1 click) / Print → browser dialog. ≈ **5 clicks**. Friction: hero promises 35 reports, 17 listed (§2); sub-variant pills duplicate filters; "PDF" doesn't exist as a real export; per-report visual style varies (RP2 letterhead vs generic grid).

### Hidden-knowledge index (things the UI never tells you)
1. Types & statuses must be created per-project before units make sense — no seeding, no prompt.
2. Quick-added statuses are unsellable (`is_available:false`) until edited in the full modal.
3. Units need `area` set or they can't be sold.
4. PDCs are created via Add Payment, not the PDC Register.
5. Floors are company-wide but the UI demands a project context; floor links break on rename (label-string matching).
6. Sale price is sqft-driven only.
7. Two different "setup wizards" exist (onboarding.js vs company-branding.js).

---

## 9. EMPTY & ERROR STATES

- **Pattern A (good):** icon + title + hint — `.empty/.ei/.et` (payments.js:9, 44: "No sold units yet / Create a sale first to receive payments"). Exists in ~10 pages.
- **Pattern B:** `.inv-empty` (units), `.dx-empty` (DX pages) — different markup/styling for the same concept.
- **Pattern C (bad):** bare text or nothing — several report renders return an empty `<tbody>` with headers and totals of 0; reports KPI strip degrades to gray "Could not load metrics" 11px text (reports.js:405–407).
- **Loading:** 48 occurrences of literal "Loading…" text in page JS; no skeleton standard (a few pages have ad-hoc shimmer). First paint after login waits on the full cache bundle (units+sales+payments+agents in one RPC) with console-log progress only (`✅ Units cache loaded`, db.js:139).
- **Errors:** toast-based everywhere, but tone/format varies from helpful ("Project limit reached — upgrade", projects.js:1156) to raw ("Error: " + err.message, projects.js:1322) to silent console.error-only (every db.js getter returns `[]` on failure — pages then render as if the tenant has no data, indistinguishable from empty).

---

## 10. PERFORMANCE SNAPSHOT (numbers only)

- Shipped per app load: **97 `<script>` tags + 36 stylesheets** from login.html (272,809 bytes itself). No bundler, no minification; cache-busting via manual `?v=` tokens.
- **JS total: 3,311,583 bytes** (js/pages = 2,686,577). **CSS total: 1,046,069 bytes.** ≈ **4.6 MB** HTML+JS+CSS.
- Largest: reports.js 270KB / sales.js 200KB / **logo.js 144KB (a base64 PNG wrapped in JS)** / units.js 140KB / payments.js 138KB / agents.js 125KB / clients.js 125KB / visual-overhaul.css 113KB / dashboard-premium.css 104KB / components.css 103KB.
- **Every page loads the entire bundle** — all 62 page modules parse on login regardless of role or Lite whitelist.
- Full-table fetch on login: `get_units_cache_bundle` pulls ALL units + ALL sales + ALL payments + agents into `window._unitsCache` (db.js:39–146); clients/projects/floors/types/statuses/sale-types caches likewise. O(tenant-size) memory; KBH's full dataset now loads through this on every login.
- Reports recompute from these caches client-side (aging, statements) — CPU-bound on big tenants; 36 `.rpc(` calls in reports.js, several pages re-fetch `list_payments_filtered` per tab switch.

---

## 11. BROKEN THINGS REGISTER

| # | Severity | What | Where |
|---|---|---|---|
| 1 | **BLOCKER (UX)** | No default unit types/statuses seeded at signup/project-create → empty dropdowns dead-end the very first add-unit attempt | DB: `signup_new_company`, `upsert_project` (verified); categories.js |
| 2 | **MAJOR** | Quick-add status hardcodes `is_available:false` → units with that status never appear in New Sale picker, no error | categories.js:628 → sales.js:316 |
| 3 | **MAJOR** | Reports hub hero claims "35 reports", renders 17; 18 reports orphaned/unreachable | reports.js:58–63 vs :3–52, hero :661 |
| 4 | **MAJOR** | `saveClient` localStorage-first with `local_<ts>` fake-id fallback — silent unsynced data | js/store/db.js:221–258 |
| 5 | **MAJOR** | Unit↔floor linked by label string, not FK; floor rename orphans units | units.js:925–927, 948–952 |
| 6 | **MAJOR** | 4.6MB unbundled payload, 97 script tags, logo as 144KB base64 JS | login.html, js/logo.js |
| 7 | **MAJOR** | Duplicate add-unit flows (page + modal) with diverging fields | units.js:875 vs :2040 |
| 8 | **MINOR** | `payments.installment_id` read for display but always NULL (legacy; report RPCs verified clean) | payments.js:349 |
| 9 | **MINOR** | `_RPT_SEC_ORDER` (reports.js:55) omits '🧾 Financial' and '🤖 AI' sections present in data — ordering falls through wherever it's used |
| 10 | **MINOR** | Dead routes still shipped: healthcenter/blacklist redirect stubs + their JS files (430 LOC) | ui.js:899, blacklist.js, health-center.js |
| 11 | **MINOR** | Same route, two labels: `recovery` = "Recovery Queue" (admin) / "Payments" (accounts); `contacts` = "Inbox" / "Call Logs" | ui.js navGroups |
| 12 | **MINOR** | "PDF export" doesn't exist — Print button → browser dialog only (no jsPDF/html2pdf shipped) | reports.js:718, login.html |
| 13 | **MINOR** | DB getters swallow errors → error state indistinguishable from zero-data state | js/store/db.js (all getters) |
| 14 | **MINOR** | Demo login invalid on prod (per 2026-05-29 note) — landing-page demo path broken | admin/demo memory |

(Recovery Position print/PDF defect is known and being fixed in the other terminal — excluded.)

---

## 12. TOP 20 INCONSISTENCIES (ranked by damage to "premium")

1. **Two brand accents shipping at once:** Blue-600 `#2563eb` ×232 vs token indigo `#4F46E5` — buttons/links disagree page to page (everywhere; onboarding SWATCHES offers both).
2. **Three UI typefaces + three monos:** Plus Jakarta Sans (dashboard/login/signup) vs Inter (rest) vs Arial/Georgia strays; JetBrains/Space/DM Mono (css/dashboard-premium.css, login.css vs components.css).
3. **1,008 bold-700 + 197 extra-bold-800 declarations** — violates the product's own "no bold prominence" rule everywhere.
4. **35 font sizes incl. fractional 8.5–15.5px** — no scale survives contact with any page (§3).
5. **359 gradients** — aurora topbar (cyan `#00d9ff` ×88), login, dashboards, signup — directly against "neutral + single accent" (topbar-aurora.css, footer-aurora.css, visual-overhaul.css:50 gradients).
6. **221 emoji in UI**, worst in the flagship Reports hub section headers (reports.js:54–55).
7. **~25 card systems / 162 card classes** — every page invented its own card (§4).
8. **30 table systems; the official DX standard used by only 5/62 pages** (components.css `.dx-*` vs everything else).
9. **106 button classes** with single-letter semantics (`.btn-g` vs `.btn-gr` vs `.btn-gh`) (components.css + per-page CSS).
10. **76 border-radius values + 9 competing radius CSS variables** (`--r`, `--rm`, `--rs`, `--x-r-*`, `--rops-*`, `--v-card-radius`).
11. **350 distinct box-shadows** — elevation means nothing (§6).
12. **Three+ dashboards** (dashboard, recovery-dashboard, executive, radar) restating the same KPIs in different visual dialects.
13. **Reports: letterhead RP2 vs generic HUB grid vs Crystal ledgers** — three different "document" aesthetics for outputs that land on the same CFO's desk (reports.js, ledgers.js, print.js).
14. **20 modal widths** and two header/footer patterns (§4).
15. **Two add-unit flows + two setup wizards + duplicate report/page twins** (receivingledger page = recovery report; officerledger = staff report).
16. **2,364 inline font-size styles in JS** — the design isn't in CSS at all on many pages; restyling requires editing string templates.
17. **Spacing: 67% of declarations off the 4/8 scale**, `!important` on gaps (§6).
18. **Inconsistent page naming:** categories="Types & Floors", recovery="Payments"/"Recovery Queue", contacts="Inbox"/"Call Logs"/"Follow-up Log" — same thing, 3 names (ui.js:882, navGroups).
19. **35 CSS files with overlapping ownership** — visual-overhaul.css (113KB) overrides components.css overrides app.css; enterprise-polish.css forces `.scr` colors (known pitfall); fixes require `!important` archaeology.
20. **Validation/error UX varies per page:** inline `.pf-err` vs `.cf-err` vs toast-only vs silent console (§9).

---

## 13. PROPOSED STANDARD KIT (proposal only — no code written)

### (a) App side — ONE design kit
- **Type scale (6 steps, Inter only):** page title 18px/600 · section header 14px/600 · body & table cells 13px/450 · labels 11px/500 UPPERCASE tracking-wide muted · secondary/meta 12px/400 · KPI values 20–22px/600 max. Mono (`JetBrains Mono`) only for amounts/codes in tables, via one `--mono` token. Weights allowed: 400/500/600 only.
- **Card spec:** bg `--card` (#FFFFFF light), 1px solid `#E2E8F0`, radius 12px, shadow `0 1px 3px rgba(0,0,0,0.06)`, padding 16px (KPI) / 24px (content). One class: `.card`, modifiers `.card--kpi`, `.card--flush`.
- **Table spec:** DX as the sole system. Header: 11px uppercase muted on `#F8FAFC`, 1px bottom `#E2E8F0`; rows 40px, hover `#F8FAFC`, 1px row separators only (no verticals); numeric right-aligned mono; sticky header; built-in empty/loading/error slots.
- **Modal spec:** 3 sizes — S 440 / M 640 / L 880px. Header: 16px/600 title + close; body 24px padding; footer right-aligned [ghost Cancel · primary Action]; radius 12px; one overlay.
- **Form spec:** inputs 36px, radius 10px, 1px `#E2E8F0`, focus ring `--brand` 2px; label above 11px uppercase muted; error = red border + 11px message below (the `.inp-err` pattern, made universal); max 2 columns; long forms become grouped sections or steps — never a 30-field wall.
- **Button hierarchy (4 + 2 sizes):** primary (indigo `#4F46E5` solid) · secondary (white, 1px border) · ghost (text only) · danger (red solid). Sizes: 36px default / 30px compact. Everything else deleted.
- **Spacing scale:** 4/8/12/16/24 only (32 allowed for page gutters). Radius: 10px controls / 12px containers. Shadows: exactly 3 tokens (card / popover / modal).
- **Hard rules:** no gradients outside chart fills, no emoji (Lucide only), no `!important` in new code, no inline styles in JS templates — classes only.

### (b) Report side — ONE "Report Document" template
A single shared shell (seeded from the new Recovery Position implementation) used by all 8 surviving reports:
- **Header block:** company name + logo line · report title · Project / Period / Filters line · "Generated <date> by <user>" — formal, ruled.
- **Body:** ruled table, repeating `<thead>` per printed page, 11–12px, numeric mono right-aligned, group subtotal rows shaded.
- **Summary block:** boxed totals/reconciliation at the end (Opening / Due / Recovered / Closing pattern generalized).
- **Footer:** page X of Y + system signature line.
- **Export trio on every report:** Excel (XLSX, already wired) · PDF (one shared print stylesheet → browser print, or add one PDF lib once) · Print. One toolbar component, not per-report buttons.
- **The 8 core reports:** 1 Recovery Position · 2 Collections Register · 3 Sales Register · 4 Client Statement · 5 PDC Register · 6 Inventory Status · 7 Agent Commission · 8 Performance Summary (merge map in §2).

### (c) Migration order (max visible impact first)
1. **Reports** — the prospect-facing artifact; collapse 35→8 onto the document template (hub already decent, keep it).
2. **Dashboard** — kill Plus Jakarta + gradients, one KPI card; retire recovery-dashboard/executive/radar into it.
3. **Units + Add-Unit flow** — single modal, seeded defaults fix, DX table (it's the daily-driver page).
4. **Sales / New Sale** — staged form (Deal → Parties → Schedule), flat-price path.
5. **Clients** — sectioned modal, fix localStorage fallback.
6. **Payments wizard + PDC** — add "Add PDC" entry point, collapse steps when 1 project.
7. **Sidebar/nav + naming** — one label per concept, remove Lite (Phase 2), cut groups to ≤5.
8. **Settings/Setup pages** — last (low traffic).

---

## TOP-LINE NUMBERS

| Metric | Value |
|---|---|
| Total pages/surfaces | 63 routes + 9 shell screens (≈71); 24 CORE / 19 SUPPORT / 15 BLOAT-candidate |
| Total reports | **35 defined / 17 reachable / 18 orphaned**; 0 currently join NULL `payments.installment_id` (verified live); 1 under repair (Recovery Position print) |
| Distinct font sizes | **35** (incl. 7 fractional) across 3,780 declarations |
| Card variants | **162 classes / ~25 systems** |
| Button variants | **106 classes** |
| Table variants | **30** (DX standard used by 5/62 pages) |
| Hardcoded colors | **≈4,200** (213 distinct CSS + 198 distinct JS) · 359 gradients · 221 emoji |
| Spacing off-scale | **32 of 37** distinct px values (67% of declarations) |
| Clicks signup→first unit | **≈35–40 interactions** across ~8 screens (incl. 2 undocumented prerequisites) |
| Worst pain flows | Types/Statuses prerequisite **8/10** · New Sale form **8/10** · Add Unit **7/10** = PDC entry **7/10** |
