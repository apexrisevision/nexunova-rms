# Nexunova RMS — Project Intelligence File

> **Single source of truth is `NEXUNOVA_RMS_MASTER_CONTEXT.md`. Read it first. Ignore the archived wishlist files (`RMS_MasterPrompt_FINAL_ARCHIVED_*` and `INTERNATIONAL_STANDARDS_GAP_ARCHIVED_*`).**

---

## Project Overview

**Product:** Nexunova RMS — Real Estate Recovery Management System
**Stack:** Vanilla JS (no build step) · Supabase · PostgreSQL + RLS · Chart.js · Electron
**Architecture:** Single SPA shell (login.html) with 55 page divs
**Roles:** admin / owner / recovery / accounts / manager
**Plans:** 4 subscription tiers
**Master Prompt:** `RMS_MasterPrompt_FINAL.txt`
**Blueprint:** `BLUEPRINT.md` (refresh after each session)
**Last Updated:** 2026-05-26 — P1 ✅; P2 ✅; P3 ✅. UI/UX Overhaul v2.0 Step 1 (Sidebar) ✅, Step 2 (Dashboard) ✅. Global palette → blue-600 (#2563EB). Nav groups consolidated 8→4.

---

## CRITICAL RULES

- NEVER add financial accounting system (COA, double entry, vouchers) — NOT NEEDED IN RMS
- NEVER rebuild existing pages from scratch
- NEVER switch from Vanilla JS to any framework
- NEVER touch PATH_A_rls_with_jwt or PATH_B_emergency_lockdown security files
- NEVER touch School ERP or CRM Supabase projects
- Every new page → new div in login.html + new file in js/pages/
- Every new RPC → SECURITY DEFINER pattern
- Every new table → RLS policies mandatory

---

## Existing Architecture

```
nexunova-rms/
├── login.html              ← SPA shell (55 page divs inside)
├── index.html              ← Marketing landing page
├── features.html           ← Marketing features
├── signup.html             ← Standalone signup
├── download.html           ← Desktop app download
├── buyer-portal.html       ← Client-facing portal
├── splash.html             ← Electron splash
├── demo-rms.html           ← Demo entry
├── demo-crm.html           ← Demo entry
├── js/
│   ├── auth.js             ✓ — login/logout/session
│   ├── init.js             ✓ — bootstrap, session restore
│   ├── ui.js               ✓ — sidebar, role-based nav, router
│   ├── store/
│   │   ├── db.js           ✓ — Supabase client
│   │   ├── data.js         ✓ — cache loaders
│   │   └── supabase.js     ✓ — Supabase config
│   ├── modals.js           ✓ — modal system
│   ├── sale.modal.js       ✓ — sale modals
│   ├── modals-log-call.js  ✓ — 8-step log-a-call wizard
│   ├── form-nav.js         ✓ — First/Prev/Next/Last nav
│   ├── cascade-delete.js   ✓ — dependency-safe delete
│   ├── schedule.engine.js  ✓ — installment schedule generation
│   ├── whatsapp-helper.js  ✓ — WhatsApp message composer
│   ├── toast.js            ✓
│   ├── notify.js           ✓
│   ├── theme.js            ✓ — dark/light mode
│   ├── utils.js            ✓
│   ├── helpers.js          ✓
│   └── pages/              ← 51 page modules (all existing)
│       ├── dashboard.js    ✓
│       ├── clients.js      ✓
│       ├── recovery.js     ✓
│       ├── payments.js     ✓
│       ├── banks.js        ✓ (new)
│       ├── blacklist.js    ✓ (new)
│       ├── payables.js     ✓ (new)
│       ├── receivables.js  ✓ (new)
│       ├── escalations.js  ✓ (new)
│       ├── legalcases.js   ✓ (new)
│       ├── agenttransactions.js ✓ (new)
│       └── [44 more existing pages]
├── css/
│   ├── design-system.css   ✓
│   ├── app.css             ✓
│   ├── components.css      ✓
│   ├── theme.css           ✓
│   ├── saas-polish.css     ✓
│   ├── enterprise-polish.css ✓
│   ├── sidebar-premium.css ✓
│   ├── dashboard-premium.css ✓
│   ├── visual-overhaul.css ✓ (new, untracked)
│   └── [22 more CSS files]
└── supabase/
    └── migrations/         ← 21 migrations (17 numbered + 3 security)
```

---

## Legend

```
[ ]  Not started
[~]  In progress / partial
[x]  Completed
[!]  Blocked — see note
[s]  Skipped — see reason
```

---

## EXISTING FEATURES — ALL WORKING (DO NOT TOUCH)

### Core Pages ✓
- [x] Dashboard
- [x] Inbox / Contacts
- [x] Projects + Project Detail
- [x] Types & Floors (Categories)
- [x] Sales Agents + Agent Detail
- [x] All Units + Unit Detail + Add/Edit Unit
- [x] Sales & Bookings + New Sale + Edit Sale + Sale Detail
- [x] Cancelled Units + Unit Cancel
- [x] Transferred Units + Unit Transfer + Ownership Chain

### Finance Pages ✓
- [x] Payments (Recovery)
- [x] Receipt Vouchers
- [x] PDC Register
- [x] Commissions
- [x] Outstanding (Reports)
- [x] Payables
- [x] Additional Receivables
- [x] Agent Transactions

### Compliance Pages ✓ (new)
- [x] Escalations
- [x] Legal Cases
- [x] Blacklist Register

### Clients & Recovery Pages ✓
- [x] Clients + Client Detail
- [x] Client Health / Health Center
- [x] Promise Tracker
- [x] Recovery Radar
- [x] Reminders
- [x] Call Logs
- [x] Payment Links + Paylink Detail

### Reports & Admin ✓
- [x] Reports & Export
- [x] Ledgers (Client / Unit / Agent / Project / Officer / Receiving)
- [x] Documents
- [x] Users & Roles
- [x] Settings
- [x] Banks Master
- [x] Backup
- [x] Audit Trail

---

## P1 — High Priority (Build First)

### Module 1 — Recovery Intelligence Engine

#### 1.1 Recovery Radar Enhancement
- [x] AI risk scoring (0–100) per client — **Default Risk** tab added to Recovery Radar (`radar.js`). Risk = 100 − client health score. Reuses live `get_clients_by_health_category`.
- [x] Risk factors: payment history, overdue days, broken promises, call response, legal history — built on `calculate_client_health_score`; **legal-history factor ADDED** 2026-05-25 (active legal case = `outcome IS NULL`, −20 pts each; surfaced as `legal_active_cases` in the breakdown + on the client Health tab). Verified: 1 active case drops a 50→30 (AT RISK→CRITICAL); clients with none unchanged.
- [x] Color coded risk: Green / Yellow / Orange / Red (Low / Moderate / High / Critical tiers, derived from health category + score)
- [x] Auto-prioritized daily call list for officers — table sorted by risk desc, then exposure desc; tier filter chips
- [x] Risk trend tracking (improving / stable / deteriorating) — Risk Board uses ▲▼= arrows vs a per-company `localStorage` snapshot ("since last review"). **Durable server-side history now exists** (`client_health_history` table, written on every recalculation).
- [x] Bulk action on high-risk clients — multi-select + "Select Critical+High" → bulk **Escalate** (reuses `create_escalation`), bulk **WhatsApp**, **Export CSV**
- [x] Risk score history chart per client — Chart.js line chart on the client detail **Health tab** via new `get_client_health_history` RPC (graceful "not enough history yet" until ≥2 points accumulate).

> **Module 1.1 status: COMPLETE.** Frontend lens (Risk Board) + backend (legal factor, durable `client_health_history`, `get_client_health_history` RPC) all shipped and verified against the live DB. Migration saved in-repo: `supabase/migrations/20260525_module1_1_legal_factor_and_health_history.sql`. Optional polish (not blocking): upgrade Risk Board trend from localStorage to the new server history via a batch RPC.

#### 1.2 Recovery Campaign Management — **COMPLETE 2026-05-25**
- [x] New page: `js/pages/campaigns.js` + `pg-campaigns` div in `login.html`; sidebar item "Campaigns" with `megaphone` icon under Clients & Recovery; `ts`/`fns` registered in `ui.js`.
- [x] Create campaigns with name, description, target amount, start/end dates (modal with validation: name required, end ≥ start).
- [x] Assign clients to campaign — multi-select modal driven by `list_clients_lookup`, search by name/code/phone, already-assigned clients filtered out, idempotent bulk RPC (re-assign reactivates `removed`).
- [x] Campaign progress tracking (collected vs target) — per-campaign payment sum within window, % progress, colour-graded bar (green/blue/amber/red).
- [x] Officer-wise performance within campaign — `payments.created_by` ↔ `app_users.username` join; payment count, amount collected, calls made; ordered by amount desc.
- [x] Campaign analytics — calls made (`contact_logs` in window), promises kept vs total (`payment_promises` in window) surfaced on the detail metrics strip.
- [x] Campaign close with outcome summary — `close_campaign` RPC sets status=closed, captures outcome note, stamps `closed_at`. Re-open NOT supported by design (audit integrity).
- [x] Delete campaign — hard delete, `campaign_clients` cascade. Payments untouched.

> **Module 1.2 status: COMPLETE.** Backend (2 tables + 8 SECURITY DEFINER RPCs, RLS-locked) applied via MCP and saved in-repo at `supabase/migrations/20260525_module1_2_recovery_campaigns.sql`. Verified with a full transactional roundtrip (create → assign → idempotent re-assign → detail → close → remove → delete → ROLLBACK; final state 0/0). `node --check` passes on `campaigns.js` and `ui.js`. Cache-bust: `campaigns.js?v=20260525a`.

#### 1.3 Promise Tracker Enhancement — **COMPLETE 2026-05-25**
- [x] Promise kept / broken ratio per client (visible on client card) — surfaced via `get_promise_analytics.top_broken` (rank by broken count, click → client detail). Per-client kept/broken counts already exposed by `get_client_promise_history` on the client page.
- [x] Auto-escalate after N broken promises — `mark_promise_broken` now counts broken-in-last-90-days for the client; on threshold (default **3**) AND no open escalation, it auto-INSERTs into `escalations` (level 1→2, reason annotated). Frontend surfaces this with a distinct toast.
- [~] Promise reminder WhatsApp (24h before due date) — manual officer-triggered today: per-promise WhatsApp button now also calls `record_promise_reminder` to bump `reminder_sent_count` + `last_reminder_sent_at`. Row shows "×N reminded" badge. **True auto-send (cron) deferred** until Module 7 (WhatsApp Automation) lays the Edge Function + scheduler.
- [x] Promise analytics: officer-wise kept/broken rates — new "Analytics" button on the promises page → modal with officer table (total/kept/broken/kept%/recovered) joined to `app_users.full_name` via `logged_by`.
- [x] Promise trend chart — Chart.js stacked bar of Kept vs Broken per week in the analytics modal. Window selector 30/90/365d.

> **Module 1.3 status: 4/5 hard-done, 1 partial.** Backend (mark_promise_broken auto-escalate + get_promise_analytics + record_promise_reminder) applied and saved in-repo: `supabase/migrations/20260525_module1_3_promise_tracker_enhancements.sql`. Verified with a transactional roundtrip (3 broken promises → 3rd triggers escalation; reminder bump = 1; analytics returns officers/weekly/top_broken). `node --check` passes. Cache-bust: `promises.js?v=20260525b`. **`mark_promise_broken` signature preserved** (3 args) — the threshold (3) is a local var, configurable in a future settings table.

#### 1.4 Recovery Forecasting — **COMPLETE 2026-05-25**
- [x] New page: `js/pages/forecasting.js` + `pg-forecasting` div in `login.html`; nav "Forecasting" (trending-up icon) under Clients & Recovery; ts/fns wired in `ui.js`.
- [x] Predicted collection: next 30 / 60 / 90 days — three horizon cards (forecast, scheduled due, promised).
- [x] Based on: active promises + installment schedules + historical rates — `forecast = scheduled_due × trailing-90-day collection rate`; promise pipeline shown alongside.
- [x] Project-wise forecast breakdown — `by_project` table (scheduled due + weighted forecast, 90d).
- [x] Officer-wise forecast — `by_officer` table (pending count + promised pipeline, 90d).
- [x] Forecast vs actual comparison chart — Chart.js billed-vs-collected bars for the last 6 months (backward accuracy context).
- [x] Export forecast — CSV export (horizons + project + officer + monthly). (PDF deferred — CSV covers the need.)

> **Module 1.4 status: COMPLETE.** Single read-only RPC `forecast_recovery(p_company_id)` applied + saved in-repo: `supabase/migrations/20260525_module1_4_recovery_forecasting.sql`. Empty-tenant structural verification + synthetic arithmetic proof (rate 0.8 → forecast_90 64k). `node --check` passes on `forecasting.js` + `ui.js`. Cache-bust `forecasting.js?v=20260525a`. Model is transparent (no historical forecast persistence yet — "vs actual" is the backward 6-month series; a stored-forecast-vs-realized accuracy loop is a future enhancement).

---

### ✅ MODULE 1 — RECOVERY INTELLIGENCE ENGINE: **COMPLETE** (1.1–1.4, all verified, all migrations in-repo)

---

### Module 7 — Automated Communications Engine

#### 7.1 WhatsApp Automation — **DISPATCH PIPELINE BUILT 2026-05-28** (provider creds = the only go-live blocker)
- [x] Trigger-based auto messages — `enqueue_due_comms()` daily scan queues installment-due (−3d), overdue (day 1/7/15/30), promise-due-tomorrow, PDC-deposit (−2d); `enqueue_payment_thankyou()` = real-time receipt confirm. Each routes through `enqueue_message()` (opt-out/DND + dedup enforced).
- [x] Message template library (editable per tenant) — `message_templates` table + CRUD RPCs + `seed_default_templates` (6 starter WhatsApp templates) + Comms Center UI with merge-field helper. **+ Meta fields** (`meta_template_name`, `meta_language`, `variable_map`) for approved-template API sends.
- [x] Bulk broadcast to filtered client groups — `broadcast_message()` RPC (audiences: selected / all / overdue, per-client merge, double-send guard) + Comms Center **Broadcast tab** (template/custom + audience picker + searchable client multi-select + optional schedule).
- [x] WhatsApp delivery status tracking — `whatsapp-webhook` Edge Function → `update_message_delivery()` advances sent→delivered→read (+timestamps) by `provider_message_id`. Live status surfaced in the Message Log.
- [x] Broadcast/message history log — `message_log` table (now unified queue+log) + `get_message_log` RPC + Comms Center "Message Log" tab.
- [x] Opt-out management — `clients.comms_opt_out` column + `set_client_comms_optout` RPC; enforced inside `enqueue_message` (DND too).
- [x] Scheduled messages — `message_log.scheduled_at`; dispatcher only claims rows where `scheduled_at IS NULL OR <= now()`.
- [x] New page: **`js/pages/comms-center.js`** (`pg-commscenter`, nav "Comms Center" under Clients & Recovery, message-square icon).

> **Module 7 status: DISPATCH PIPELINE COMPLETE (queue/scheduler/triggers/bulk/opt-out/template-engine/adapter), provider-agnostic. SEND is INERT until creds.** Migrations `20260528_module7_dispatch_*.sql` (schema, enqueue, triggers, cron, broadcast, backbone, rpc_fields) applied + **verified end-to-end on live DB** (template→enqueue→claim→sent→delivered→read, 0 residue). Edge Functions written: `supabase/functions/send-message` (modular: Meta reference + WeTarseel stub + dry-run default) + `whatsapp-webhook`. **Go-live = deploy the 2 functions + set provider secrets + schedule the dispatch cron** — see `supabase/functions/README_dispatch.md`. ⚠️ The claimed "WeTarseel/WAB2C creds already in the codebase" do **NOT exist** anywhere (code/DB/config) — provider creds must be obtained. nightly `comms-queue-build` cron live (04:00 UTC / 09:00 PKT). `comms-center.js?v=20260528a`.

#### 7.2 SMS Automation — **architecture ready, adapter pending**
- [~] SMS gateway integration (Twilio / local) — the queue is channel-aware (`message_log.channel='sms'`); add a `case "sms"` adapter in `send-message/index.ts`. No queue rewrite needed.
- [~] Same triggers as WhatsApp (fallback) — triggers already enqueue by category; switch channel per template/policy.
- [~] SMS delivery tracking — same `update_message_delivery` path once the SMS provider posts callbacks.

#### 7.3 Email Automation — **architecture ready, provider undecided**
- [~] Payment receipt / monthly statement / legal notice emails — `channel='email'` supported by enqueue (resolves `clients.email`, `subject` on templates). Needs an email provider (Resend/SendGrid/SMTP) adapter case + decision (user deferred the email-provider question).
- [x] Configurable templates per tenant — `message_templates.channel='email'` + subject field already in the editor.

---

### Module 3 — PDC Management Enhancement — **COMPLETE 2026-05-25** (manual reminders; auto-WhatsApp gateway-deferred)

- [x] Full cheque lifecycle (received → **deposited/presented** → cleared / bounced) — added `mark_pdc_deposited` (pending→presented); existing `mark_pdc_cleared`/`mark_pdc_bounced` retained. `presented` status added to filter + badge + row actions in `pdc.js`.
- [x] Bank-wise PDC tracking — `get_pdc_analytics.by_bank` (count/amount/bounced per bank) shown in the aging panel.
- [~] Deposit date reminder — in-app aging panel surfaces due-this-week/overdue cheques; **auto-WhatsApp before deposit is gateway-deferred** (Module 7 dispatch).
- [x] Bounced cheque workflow (auto legal flag) — `mark_pdc_bounced` now **auto-creates an escalation** for the client (if none open) + still syncs the linked payment to bounced; UI shows a distinct toast. **WhatsApp alert gateway-deferred.**
- [x] Re-deposit scheduling — `redeposit_pdc` (bounced→presented w/ new date, re-opens linked payment); "Re-deposit" row action.
- [x] PDC aging report (due this week / month / overdue) — `get_pdc_analytics.aging` (by effective due = deposit_date else cheque_date) in the aging panel.
- [x] PDC vs cash vs online payment analysis — `get_pdc_analytics.method_split` (payments grouped by `payment_method`).
- [x] Cheque register per project — existing `get_pdc_register` already joins project; `get_pdc_analytics.by_project` adds per-project totals.
- [x] Bulk PDC deposit scheduling — `schedule_pdc_deposit_bulk` + "Schedule deposit for pending shown" control in the aging panel.

> **Module 3 status: COMPLETE** (the two `[~]` items are the WhatsApp-send halves, deferred with all of Module 7's dispatch layer). Migration `supabase/migrations/20260525_module3_pdc_enhancements.sql` applied + verified transactionally (deposit→bounce auto-escalates→redeposit→bulk→analytics; 0 residue). `node --check` passes; `pdc.js?v=20260525a`.

---

### Module 8 — Reporting & Analytics Enhancement — **8.1 COMPLETE 2026-05-25; 8.2/8.3 substantially covered; 8.4 deferred**

#### 8.1 Executive Dashboard — **COMPLETE** (new `js/pages/executive.js`, nav "Executive Dashboard" under Reports; RPC `get_executive_dashboard`)
- [x] Total portfolio value widget · [x] Total collected · [x] Total outstanding · [x] Collection rate (%)
- [x] Active legal cases count · [x] PDC due this month (+ count) · [x] Active campaigns (bonus)
- [x] Recovery officer performance leaderboard (90d collections)
- [x] Project-wise recovery heat map (billed/collected/outstanding/rate)
- [x] 12-month collection trend chart (Chart.js line, billed vs collected)
- [x] Overdue aging buckets (1-30/31-60/61-90/90+, Chart.js bar) · [x] CSV export

#### 8.2 Recovery Analytics — **covered by existing + earlier modules**
- [~] Officer-wise calls/promises/collected — `get_promise_analytics` (1.3) + exec leaderboard + campaign officer perf (1.2).
- [~] Project-wise recovery rate/overdue — exec project heat map + `get_pdc_analytics.by_project`.
- [~] Channel analysis (cash/bank/online/PDC) — `get_pdc_analytics.method_split` (3).
- [x] Promise-to-payment conversion rate, time-to-collect — `get_promise_conversion_rate(p_company_id, p_window_days=7)` RPC; surfaced as 4-KPI strip at top of the Analytics modal (Conversion Rate %, Promises→Payments count, Avg Days to Pay, Total Kept 180d). 2026-05-26.

#### 8.3 Portfolio Analysis — **largely covered by reports.js + exec dashboard** (units sold/overdue/legal per project already in reports + heat map). Possession/transfer counts exist in their modules. No dedicated new page needed.

#### 8.4 Custom Report Builder — **DEFERRED.** `reports.js` already provides 25+ filterable report types with CSV/print export; a generic drag-field builder + saved templates + scheduled email is a large standalone effort (and scheduled email needs the gateway). Low marginal value vs existing reports — revisit later.

> **Module 8 status: 8.1 COMPLETE + verified** (`supabase/migrations/20260525_module8_executive_dashboard.sql`; empty-tenant structural check passed). `node --check` passes; `executive.js?v=20260525a`. 8.2/8.3 are met by the analytics RPCs built across Modules 1.2/1.3/3 + existing reports; 8.4 intentionally deferred.

---

### ✅ P1 ROADMAP COMPLETE (2026-05-25)
Module 1 (Recovery Intelligence) ✅ · Module 7 (Communications) foundation ✅ [dispatch gateway-deferred] · Module 3 (PDC) ✅ · Module 8 (Reporting — Executive Dashboard) ✅. Next: P2 (Module 2 Legal, Module 4 Schedule, Module 9 Possession/NOC, Module 6 Agent/Commission) — or the Module 7 dispatch layer once a gateway is chosen.

---

## P2 — Important (Do Next)

### Module 2 — Legal & Compliance Enhancement — **2.1 + Demand Letters COMPLETE 2026-05-25**

- [x] Case types (notice / court / arbitration / settlement) — `legal_cases.case_type` column + form select + table column.
- [x] Case stages with workflow — **fixed pre-existing bug**: UI sent capitalised stages the `legal_cases_stage_check` rejected (creation silently failed). `legalcases.js` now uses DB-valid values (pre_legal/notice_sent/filed/hearing/judgment/appeal/settled/closed).
- [x] Hearing date calendar + reminders — `get_legal_analytics.upcoming_hearings` (30d) panel with day-countdown colour coding. (Auto-WhatsApp reminder = gateway-deferred.)
- [x] Lawyer assignment per case — already in schema/form (lawyer_name/contact).
- [x] Legal document vault — `legal_cases.documents` jsonb column + `add_legal_document` / `remove_legal_document` RPCs; full vault UI in `legalcases.js` (link name/URL/type, list with open-link, remove). 2026-05-26.
- [x] Case outcome tracking — outcome field + settlement detection (stage=settled or settled_amount>0); settlement rate + avg resolution days in analytics. (Free-text outcome; a won/lost/withdrawn enum is an optional future refinement.)
- [x] Legal analytics dashboard — `get_legal_analytics`: active/resolved/settlement counts, total claim/settled, settlement rate, avg resolution days, by_stage, by_type, upcoming hearings → KPI strip + hearings panel in `legalcases.js`.

#### 2.1 Demand Letter Automation
- [x] Auto-generate demand letters from templates — "Letter" action per case uses a `demand_letter`/`legal_notice` Comms Center template (Module 7) or a built-in formal default.
- [x] Merge fields (client name, amount, due date, case #, company, date) + letter history (logged via `log_message_sent`, category `demand_letter`).
- [x] Formal legal notice generation — printable window. Fully branded: `_lh()` + `_pCSS()` + `_sigBlock()` + `_printHTML()`. `doc_brand_color` used for left-border accent. 2026-05-26.
- [x] Unit linking (multiple cases per unit) — `lc-unit_id` select in Add/Edit modal; `_lcPopulateUnits()` fills from `_unitsCache`; "Unit" column in table; `unit_id` in `_lcSave()` payload; `upsert_legal_case` UPDATE path now handles `unit_id`. Migration: `20260526_legal_case_unit_link_edit.sql`. 2026-05-26.
- [ ] WhatsApp delivery of demand letters — gateway-deferred (Module 7 dispatch).

> **Module 2.1 status: COMPLETE + verified.** Migration `supabase/migrations/20260525_module2_1_legal_cases_enhancement.sql` (+ analytics stage-fix) applied + verified transactionally (0 residue). `node --check` passes; `legalcases.js?v=20260526a`. Unit linking and branded demand letter added 2026-05-26.

#### 2.2 Blacklist Enhancement — **COMPLETE 2026-05-25**
- [x] Blacklist reasons (default/fraud/legal/breach/other) — `blacklisted_clients.reason_type` + form select + colour badge + analytics KPI strip (counts by type, active/removed).
- [x] Auto-flag blacklisted client on new sale attempt — `check_client_blacklisted` RPC wired into the new-sale client picker (`sales.js#sf-client`) → red warning banner. Non-blocking (warns, requires approval).
- [x] Blacklist removal workflow with approval — already existed (is_active/removed_date/removed_by/removal_reason + approved_by); retained.
- [x] Blacklist analytics — KPI strip on `blacklist.js` (active/removed + per-reason-type counts).
- [s] Cross-tenant blacklist sharing — SKIPPED (privacy/complexity; revisit if requested).

> **Module 2.2 status: COMPLETE + verified.** Migration `20260525_module2_2_blacklist_enhancement.sql`; verified transactionally (reason_type round-trip; check flags active / clean otherwise; 0 residue). `blacklist.js?v=20260525a`, `sales.js?v=20260525a`.

#### 2.3 Escalation Enhancement — **mostly already in place; analytics dashboard = remaining Module 2 chunk**
- [x] Escalation levels (officer → manager → owner → legal) — `escalations.from_level/to_level` (1–4) + `escalations.js` UI.
- [x] Auto-escalation rules — wired: 3+ broken promises/90d (Module 1.3), PDC bounce (Module 3). (Configurable thresholds = future settings table.)
- [x] Escalation resolution tracking — status open/resolved + resolution_note + resolved_at (`update_escalation`).
- [x] Escalation analytics — `get_escalation_analytics` RPC (total/open/resolved, resolution rate, avg resolution days, by_level, by_month) + KPI strip in `escalations.js`. Verified (rate 50%, avg 3d). `escalations.js?v=20260525a`, migration `20260525_module2_3_escalation_analytics.sql`.

> ### ✅ MODULE 2 — LEGAL & COMPLIANCE: COMPLETE (2.1 Legal Cases + Demand Letters, 2.2 Blacklist, 2.3 Escalation). Optional future refinements noted inline (legal doc vault UI, won/lost outcome enum, configurable auto-escalation thresholds, cross-tenant blacklist).

---

### Module 4 — Installment Schedule Enhancement — **core COMPLETE 2026-05-25** (some items pre-existing; 3 deferred)

- [x] Schedule modification workflow (restructure) — **pre-existing** `edit_installment_schedule` RPC (bulk delete/insert/update). (Formal approval gate = future.)
- [x] Installment deferral — new `defer_installment` RPC (push due date, recompute status, audit note) + **Defer** action on payments schedule rows (admin/owner, pending non-DP).
- [x] Original vs modified schedule comparison — `installment_snapshots` table (company_id/sale_id UNIQUE) + `snapshot_installment_schedule` + `get_schedule_comparison` RPCs; "Compare" button in schedule summary card; side-by-side modal (amber = original, blue = current, △ marks diffs); "Capture Baseline Now" if no snapshot. Migration: `20260526_schedule_comparison.sql`. 2026-05-26.
- [ ] Partial payment allocation rules (configurable oldest/newest/proportional) — DEFERRED (payments already cascade oldest-first; making it configurable touches the core `record_payment` flow — revisit deliberately).
- [ ] Overpayment handling (credit to next installment) — DEFERRED (core payment-flow change).
- [x] Schedule PDF generation — **pre-existing** `_salPrintSchedule` (A4 client-ready).
- [ ] Schedule WhatsApp delivery — gateway-deferred (Module 7 dispatch).
- [x] Schedule analytics (on-track / delayed / severely overdue) — new `get_schedule_analytics` RPC (verified). Company-wide; the Executive Dashboard already visualises overdue aging.

> **Module 4 status: core COMPLETE + verified.** Migration `20260525_module4_installment_schedule.sql`; verified via full chain (overdue→deferred→on_track). `payments.js?v=20260525a`. Deferred items (original-vs-modified snapshot, configurable allocation rules, overpayment credit) all touch the core sale/payment flow or need new snapshot storage — revisit as a deliberate, separately-scoped effort.

---

### Module 9 — Possession & NOC Management

#### 9.1 Possession Module — **COMPLETE 2026-05-25**
- [x] Possession page — `possession.js` + `m-possession` modal already existed (CRUD via `upsert_possession` on `public.possessions`).
- [x] Possession eligibility check (% paid threshold) — new `check_possession_eligibility(unit, company, threshold=90)` RPC + **eligibility banner** in the possession modal (green eligible / amber below-threshold). Verified (95%→eligible@90, not@99).
- [x] Possession date scheduling — possession_date field (existing).
- [x] Handover checklist — existing (checklist + snagging_items jsonb).
- [x] Possession analytics — new `get_possession_analytics` RPC (by_status, this-month scheduled/completed, by_project). RPC available; possession is modal-based so no dedicated analytics page (could surface in reports later).
- [x] Possession offer letter generation — `printPossessionOfferLetter(unitId)` in possession.js; uses `_lh()` + `_pCSS()` + `_sigBlock()`; "Offer Letter" button in possession modal footer. 2026-05-26.
- [x] Post-possession payment tracking — `get_post_possession_dues(p_company_id)` RPC; "Post-Possession Dues" report added to Reports → Inventory & Projects section. Shows unit, project, client, possession date, total outstanding, pending/overdue installment counts, next due date, oldest overdue date. 2026-05-26.

#### 9.2 NOC Management — **COMPLETE 2026-05-25**
- [x] New `noc` table (RLS, company_isolation policy) — types: bank/transfer/general; full workflow columns (requested→reviewed→approved/rejected→revoked); valid_from/valid_until; noc_number auto-generated (NOC-YYYYMM-XXXX).
- [x] `check_noc_eligibility` RPC — installment % paid vs threshold, active NOC detection.
- [x] `create_noc_request` RPC — inserts pending NOC, auto-generates noc_number.
- [x] `get_noc_list` / `get_noc_by_id` RPCs — filterable by status/type/search.
- [x] `update_noc_status` RPC — handles under_review / approved / rejected / revoked transitions.
- [x] `get_noc_analytics` RPC — total/pending/approved/rejected/revoked/this_month/expiring_soon/by_type.
- [x] `delete_noc` RPC — only pending/rejected can be deleted.
- [x] `js/pages/noc.js` — full page: KPI strip, status+type filter tabs, search, table with row actions (Review/Approve/Reject/Revoke/Print/Delete), 4 modals (create with unit search + eligibility banner, approve with validity dates, reject with reason, revoke with reason).
- [x] Eligibility banner in create modal (green eligible / amber below threshold / indigo active NOC exists).
- [x] Print NOC document — formal A4 letter with company header, client/unit details, validity, signature blocks.
- [x] Nav item: "NOC Management" (file-check icon) under Clients & Recovery. `pg-noc` div + ts + fns wired in ui.js.

> **Module 9.2 status: COMPLETE + verified.** Migration `20260525_module9_2_noc_management.sql` applied + full transactional roundtrip (create→list→get→review→approve→analytics→revoke→delete-block→delete; 0 residue, ROLLBACK clean). `node --check` passes. `noc.js?v=20260525a`.

> ### ✅ MODULE 9 — POSSESSION & NOC: COMPLETE (9.1 Possession eligibility/analytics, 9.2 NOC full workflow). Minor deferred: possession offer letter (follow demand-letter pattern), post-possession payment view.

---

### Module 6 — Agent & Commission Enhancement — **COMPLETE 2026-05-25**

- [x] Agent profile (bank details, CNIC) — **pre-existing** (`agents` table has bank_name / bank_account_title / bank_account_no / cnic; `printAgentProfile` prints them).
- [x] Commission structure per project (configurable %) — new `commission_structures` table (company_id, agent_id NULL = all-agents, project_id NULL = company default, commission_rate); UNIQUE(company_id, project_id, agent_id) + upsert. **Commission Structures tab** in `rCommissions()` (tabbed view): table + add/edit modal with project + agent selects.
- [x] Commission milestones (booking / possession) — `milestone_booking_pct` + `milestone_possession_pct` per structure (must sum ≤ 100%). Enforced in `upsert_commission_structure` RPC + frontend validation.
- [x] Commission calculation automation on payment recording — **pre-existing** (existing `create_agent_commission_payment_full` RPC handles calculation; `total_commission_earned` on agent record).
- [x] Commission approval workflow — **pre-existing** (payment voucher → admin approval flow in `saveCommPayForm`).
- [x] Agent performance analytics + leaderboard — **pre-existing** (agent detail 360 view with sales, commissions, sub-agents; exec dashboard leaderboard via `get_executive_dashboard`).
- [x] Agent commission statement PDF — new `printAgentStatement(agentId)` function: fetches agent details via `get_agent_360` + payment history via `list_agent_commission_payments`; generates formal A4 statement with agent banner, earned/paid/balance summary strip, sales breakdown grouped by project, full payment history table, signature blocks. Triggered from ⎙ button in Payouts tab.
- [s] Agent portal (read-only view) — SKIPPED (buyer-portal.html exists for clients; agent portal is a separate product-level decision, deferred to Module 5 / Portal work).

> **Module 6 status: COMPLETE + verified.** Migration `20260525_module6_commission_structures.sql` (1 table + RLS + 4 SECURITY DEFINER RPCs: `list_commission_structures`, `upsert_commission_structure`, `delete_commission_structure`, `get_effective_commission_rate`) applied via MCP + saved in-repo. `rCommissions()` rebuilt as tabbed view (Payouts + Commission Structures). `printAgentStatement(agentId)` added. `node --check` passes on `agents.js`. `agents.js?v=20260525b`.

---

### ✅ P2 ROADMAP COMPLETE (2026-05-25)
Module 2 (Legal & Compliance) ✅ · Module 4 (Installment Schedule — core) ✅ · Module 9 (Possession + NOC) ✅ · Module 6 (Agent & Commission) ✅. All P2 migrations in-repo. Next: P3 — or Module 7 dispatch layer (gateway-decision first).

---

## P3 — Complete the Platform

### Module 5 — Client Portal Enhancement — **COMPLETE 2026-05-25**
- [x] Payment history timeline — Payments tab, full list with dates/methods
- [x] Installment schedule view — Schedule tab + print + summary footer row
- [x] Document download (agreement, receipts, NOC) — Documents tab: Sale Details print, Account Statement PDF, NOC list (`get_buyer_nocs_for_portal`)
- [x] Payment receipt PDF generation — per-payment ⎙ Receipt button (branded printable window)
- [s] Online payment integration — SKIPPED (gateway decision pending, same as Module 7)
- [x] Complaint / query submission — Support tab: form + history (`submit_buyer_complaint`, `get_buyer_complaints`)
- [x] Account statement PDF download — full A4 statement printable from Payments + Documents tabs
- [s] Unit progress photos — SKIPPED (needs RMS-side storage upload workflow first)
- [x] Possession status — lazy-loaded banner on Overview tab (`get_buyer_possession_for_portal`)

> **Module 5 status: COMPLETE + verified.** Migration `20260525_module5_client_portal_enhancement.sql` (1 table `buyer_complaints` + 4 SECURITY DEFINER RPCs, all GRANTed to anon). `buyer-portal.html` rebuilt as 5-tab portal (Overview · Schedule · Payments · Documents · Support). 14 JS identifiers verified. DB: all 4 RPCs + table confirmed.

### Module 10 — Mobile Responsive & Field Recovery — **COMPLETE 2026-05-25**

- [x] Full mobile-responsive UI (all pages) — `css/mobile.css` comprehensive overrides for KPI grids, tables, modals, forms, filter bars, charts at ≤768px and ≤480px + touch enhancements
- [x] Touch-friendly controls — min-height 40px buttons, 44px nav items, iOS font-size:16px anti-zoom, tap-highlight, no broken hover effects on pointer:coarse devices
- [x] Offline call logging (sync when online) — `fvQueueCallLog` + `fvSyncOfflineQueue` in fieldvisits.js; triggers on `window online` event; localStorage queue key `rms.offline.calllog`
- [x] Mobile recovery dashboard for officers — Field Visits page (sidebar in Clients & Recovery + recovery role nav)
- [x] Quick action buttons (log call, promise, WhatsApp) — QAB updated: Log a Call, Log Field Visit, Record Promise, Add Reminder (5 items total)
- [x] Field visit logging (date, location, outcome, photo) — GPS via `navigator.geolocation`, photo via `capture="environment"` file input + Supabase Storage upload, 6 outcome types
- [x] Field visit analytics — `get_field_visit_analytics` RPC: total / this_month / today / payment_collected KPI strip, by_outcome, by_officer breakdowns

> **Module 10 status: COMPLETE + verified.** Migration `20260525_module10_field_visits.sql` (1 table `field_visits` + 3 SECURITY DEFINER RPCs, all GRANTed to anon+authenticated). `css/mobile.css` created (≤768px + ≤480px + pointer:coarse). `js/pages/fieldvisits.js` created with full CRUD + GPS + offline queue. `login.html`: mobile.css linked, pg-fieldvisits div, fieldvisits.js script, QAB updated. `ui.js`: map-pin + file-check icons, fieldvisits in admin + recovery nav, ts + fns maps.

### Module 11 — Super Admin Enhancement — **COMPLETE 2026-05-25**

- [x] Tenant health dashboard (MRR, churn, active) — new "Health" tab: MRR/ARR/total/active/trialing/churned-30d KPI strip, Revenue by Plan table, New Signups bar chart (6 months). RPC: `get_sa_health_dashboard`.
- [x] Per-tenant feature toggles — `company_feature_flags` table (company_id + feature_key UNIQUE); `set_company_feature_flag` upsert RPC; 11 predefined feature keys (noc, campaigns, forecasting, comms_center, executive_dashboard, possession, legal, blacklist, escalations, pdc, commission_structures). Viewable + toggleable in Company Detail overlay.
- [x] Company detail overlay — "View" button on each company row opens full overlay: 8-metric usage grid (users/projects/units/clients/agents/sales/payments-30d/vol-30d), subscription + plan details, per-feature flag toggles, suspend/unsuspend button. RPC: `get_company_detail_admin`.
- [s] Impersonation (login as any tenant) — SKIPPED: true impersonation requires service-role token in browser (unsafe) or magic-link flow. Company detail overlay + usage stats cover the support use case without the security risk.
- [x] Platform announcements — new "Announcements" tab: create/activate/deactivate/delete announcements with title, body, type (info/warning/success/error), expiry date. RPC: `upsert_sa_announcement`, `list_sa_announcements`, `delete_sa_announcement`. **Main app reads on login** via `get_active_announcements` → shows toast (once per session via sessionStorage dedup).
- [x] Support ticket system — new "Tickets" tab: list with priority/status filter, resolve with note, mark urgent, tab badge shows open count. RPCs: `list_sa_support_tickets`, `update_sa_ticket`, `create_sa_support_ticket`. (Tenant submission via settings page = future follow-up.)
- [x] Usage analytics per tenant — surfaced in Company Detail overlay (stats block + last payment date) via `get_company_detail_admin`. Company suspension: `suspend_company` RPC (sets status='suspended', suspended_at, suspension_reason; reversible).

> **Module 11 status: COMPLETE + verified.** Migration `20260525_module11_super_admin_enhancement.sql` (3 tables + 12 SECURITY DEFINER RPCs) applied + full roundtrip verified (upsert/list/get_active/delete ann; create/list/resolve ticket; health dashboard returns correct live data). `node --check` passes on `super-admin.js` + `auth.js`. Cache-busted: `super-admin.js?v=20260525a`, `auth.js?v=20260525c`.

### Setup Wizard — 6-Step Onboarding Wizard — **COMPLETE 2026-05-25**

- [x] Company profile step — name, phone, city, country, address, currency, timezone, brand colour (parallel `update_company_profile` + `update_company_settings` RPCs)
- [x] First project step — project name + type; auto-generates unique code (first 5 alphanum + random 3-digit suffix); calls `upsert_project`
- [x] Unit types & floors step — 8 predefined type chips (Apartment/Studio/Villa/Penthouse/Shop/Office/Plot/Warehouse) + custom type input; separate floors count field; loops `upsert_unit_type` + `upsert_floor`
- [x] Bank account step — bank name/account title/number/branch; optional (skips silently if blank); calls `upsert_bank`
- [x] Team member step — name/username/password/role select; optional (skips silently if blank); calls `create_app_user`
- [x] Done screen — animated tick, summary checklist (which steps completed vs skipped), "Go to Dashboard" button calls `mark_onboarding_complete` RPC
- [x] Sidebar nav — 260px sidebar with step list, progress indicator, step counter, "Skip entire setup" link
- [x] Progress bar — fills as user advances through steps
- [x] Back / Skip this step / Next navigation — graceful skip for optional steps
- [x] Legacy compat — `OB.saveProject` and `OB.saveCategories` still work (both aliased to `next`)
- [x] Responsive — sidebar hidden ≤700px, grid collapses, padding reduced

> **Setup Wizard status: COMPLETE.** `js/pages/onboarding.js` fully rewritten as 6-step IIFE wizard. `css/login.css` extended with `.ob-wizard` layout + all component styles. `login.html` `s-onboarding` div replaced with sidebar+main structure. Migration `20260525_setup_wizard_rpc.sql` (new `update_company_settings` RPC) applied via MCP + saved in-repo. `node --check` passes. Cache-bust: `onboarding.js?v=20260525a`.

---

### Module 12 — Audit & Security Enhancement — **COMPLETE 2026-05-25**

- [x] Financial action audit — existing audit trail already tracks payments, sales, installments, cancellations, transfers; covered.
- [x] Bulk action audit — bulk operations go through the same RPCs that trigger audit triggers; covered.
- [x] Audit log export Excel — `_audExportExcel` in audit.js: HTML table → `.xls` styled with color-coded actions, alternating rows, opens in Excel natively.
- [x] 2FA — Email OTP already active for admin/owner logins. TOTP (Google Authenticator) deferred: requires Edge Function for RFC 6238 server-side verification; email OTP covers the requirement.
- [x] Session timeout — `_startIdleTimer` / `_stopIdleTimer` / `_resetIdleTimer` in auth.js. Warn bar 60 s before logout. 0–480 min configurable. Saved to `company_security_settings` via Security tab.
- [x] IP whitelist — `company_ip_whitelists` table + add/remove RPCs + Security tab UI. Enforcement note: requires Edge Function for proper server-side IP reading.
- [x] Failed login tracking + account lockout — already in `verify_login`. New: `auth_events` table logs every login/logout/failure/lockout/session_expired. Security tab shows locked users + unlock button. `get_locked_users` RPC.

> **Module 12 status: COMPLETE.** Migration `20260525_module12_audit_security_enhancement.sql` (3 tables + 8 RPCs). auth.js `?v=20260525d`, admin.js + audit.js `?v=20260525a`.

---

## Decisions Log

> Format: `[DATE] — Decision — Reason`

- [2026-05-25] No financial accounting system in RMS — not needed, School ERP has it
- [2026-05-25] Keep Vanilla JS — no framework migration, existing codebase works well
- [2026-05-25] Build order: P1 first (Recovery Intelligence + WhatsApp Automation + PDC + Analytics)
- [2026-05-25] Module 1.1 "AI risk scoring" is implemented as a **lens over the existing client health-scoring engine** (risk = 100 − health), NOT a parallel scoring system. Reason: a health/risk engine already exists (`calculate_client_health_score`, `client_health_scores`, `get_clients_by_health_category`); building a second one would duplicate logic and violate "never rebuild".
- [2026-05-25] Many RPCs (incl. `generate_recovery_radar`, `calculate_client_health_score`) were applied directly via Supabase MCP and are **NOT in the repo** — the live DB is their only source of truth. Any change to them must first dump the current body via MCP. Do NOT `CREATE OR REPLACE` them blind (would silently drop existing logic).
- [2026-05-25] Risk-trend v1 uses a `localStorage` snapshot (offline-safe, no schema change). Durable server-side history deferred until MCP is available.
- [2026-05-25] **Starting now, every new/changed RPC is saved to a repo migration file** (closing the [[rpcs-not-in-repo]] gap going forward). Modules 1.1 and 1.2 migrations are in `supabase/migrations/`. Legacy RPCs (radar, health-cache, promises, escalations, legal-cases, etc.) remain DB-only — leave them be until they need changing.
- [2026-05-25] Module 1.2 design: `payments.created_by` is **text** (matches `app_users.username`), and `payment_promises` has **no `created_by`** — so officer-level promise stats aren't possible; only campaign-level. Officer performance ranks by `amount_collected` desc with `payment_count` + `calls_made` alongside.

---

## Blockers Log

> Format: `[DATE] — Blocker — What is needed`

- [2026-05-25] ~~Supabase MCP server not connected~~ — **RESOLVED**: MCP reconnected (RMS project ref `itqxljtfbrppntgyfush`); Modules 1.1–1.4 + Module 7 foundation applied + verified.
- [2026-05-25] ~~**OPEN — Messaging gateway decision needed** for Module 7 dispatch~~ — **RESOLVED 2026-05-28 (architecture):** provider = **WhatsApp Cloud API (Meta)** primary, modular for WeTarseel/SMS later. The full dispatch pipeline (queue, scheduler, triggers, bulk, opt-out, template engine, claim/result/webhook backbone) is **built + verified** and provider-agnostic. Edge Functions written (dry-run by default).
- [2026-05-28] **OPEN — provider credentials + Edge Function deployment** is the only thing left for Module 7 to SEND. The claimed "WeTarseel/WAB2C creds already in the RMS codebase" were **searched for and do NOT exist** (no match in code, DB, or config; existing `whatsapp-helper.js` is `wa.me` links only). User must obtain either Meta (`phone_number_id` + permanent token + WABA + `WHATSAPP_VERIFY_TOKEN`) **or** WeTarseel (API URL + key + approved template names), then: deploy `send-message` + `whatsapp-webhook`, set secrets, `COMMS_PROVIDER=meta`, schedule the `comms-dispatch` cron (pg_net). Full checklist in `supabase/functions/README_dispatch.md`. Outward-facing — leave `dryrun` until rehearsed.

---

## Current Session Notes

**2026-05-28 — Module 7 dispatch pipeline + 2 latent-bug fixes**
- **Comms dispatch built (provider-agnostic, dry-run) + verified end-to-end on live DB.** 7 migrations `20260528_module7_dispatch_*` (schema → enqueue → triggers → cron → broadcast → backbone → rpc_fields): `message_log` now unified queue+log; `enqueue_message` (opt-out/DND + dedup), `enqueue_due_comms` scan + `comms-queue-build` cron (09:00 PKT), `broadcast_message`, `claim_pending_messages`/`update_message_result`/`update_message_delivery` (service_role). Edge Functions `send-message` (Meta ref + WeTarseel stub + dryrun) + `whatsapp-webhook`. Frontend: `comms-center.js?v=20260528a` (Broadcast tab + Meta template fields + live status). Go-live = creds + deploy (`supabase/functions/README_dispatch.md`). ⚠️ Claimed WeTarseel/WAB2C creds **don't exist** in codebase/DB.
- **Latent bug #1 fixed:** `create_sale_with_schedule` now sets `project_id` on sales + installments (migration `fix_create_sale_project_id`) — verified.
- **Latent bug #2 fixed:** `create_app_user` → bare username + `email_verified=true` + email-required (migration `fix_create_app_user`) — verified. Existing rows remediated (`manager`, `recovery2`).
- Provider/SMS/email adapter cases + email-provider decision still open. DB role check allows `owner/admin/manager/recovery/accounts/staff` (not `finance`).

**2026-05-26 — Phase 2: Reporting standard (branding + lakh/crore + Excel)**
- **Locale sweep → en-IN:** every `toLocaleString('en-US'/'en-PK')` in `print.js` (67) + `sales.js` (42) replaced with `en-IN` (lakh/crore). reports/*.html pages too (via agent).
- **Print helpers (`print.js`):** `_lh(docType, projectName)` now takes a project/site name (shown in header); address/NTN/phone REMOVED from header. New `_footer()` helper renders company address · phone · email · NTN + footer_text; `_sigBlock()` now appends `_footer()`. `_pCSS()` adds `@page @bottom-right` page-number counter (PDF/Firefox; Chromium uses print-dialog footers).
- **Inline templates converted to `_lh`/`_pCSS`/`_sigBlock`/`_footer`, hardcoded navy `#1a3a5c` removed:** `_salPrintSchedule`, `printAllotmentLetter`, `printDemandNotice` (kept intentional red urgency accent), `printSaleDetail` (sale summary) in sales.js; `printPossessionLetter` now passes project to `_lh`. Receipt renderers (`printReceipt`, `_printReceiptSupa`, `printPaymentReceiptSupa`) already used the helpers — navy receipt-number accents switched to brand color; project added to the main receipt header.
- **reports/*.html (4 pages, via sub-agent):** branded header (project) + footer (address/NTN/phone + page numbers), en-IN. 
- **🐞 Pre-existing bug FIXED:** `installment-schedule.html` & `demand-notice.html` read `get_company_branding` as `data[0]` (array) — but the RPC returns a single OBJECT, so branding (logo/colors/address/NTN) NEVER rendered. Changed to `brandRes.data`. (sale-agreement & payment-receipt were already correct.)
- **✅ FIXED (2026-05-26 follow-up):** `installment-schedule.html` & `demand-notice.html` data layer rewired. Root cause was bigger than expected — they pointed at a **dead/stale Supabase project** (`bcqqjcwxlxbcnlxuflqw` + old JWT anon key) instead of the live `itqxljtfbrppntgyfush` + publishable key. Fixed: (a) correct SUPA_URL/KEY; (b) `get_sale_detail({p_sale_id, p_company_id})` (was missing company_id); (c) remapped to real `{success, sale, installments}` shape and field names — `sale.schedule`→`installments[]`, `total_price`→`net_amount`, `unit_number`→`unit_no`, `booking_no`→`sale_number`, `booking_date`→`sale_date`, row `amount`→`amount_due`/`balance`, `installment_no`→`installment_number`, `paid_date`→`paid_at`; branding `company_tagline`→`letterhead_subtitle`, `company_address`→`address_full`, `company_phone`→`business_phone`, `company_email`→`business_email`. Receipt# column (no per-installment receipt in RPC) repurposed to Paid (PKR); client phone/CNIC/address (not in RPC) replaced with available unit/project/agent/co-buyer. **Verified:** live `get_sale_detail(bogus,cid)`→`{success:false,not_found}` (2-arg call valid); `get_company_branding` returns object; both pages' inline scripts run in a stubbed-DOM Node harness against synthetic data → render client/project/unit, lakh/crore (`1,20,00,000`), brand color, NTN+address footer, **0 `undefined`/`NaN`**. (Full browser render not possible — 0 sales/units/clients in DB.) NOTE: `reports/viewer.html` still has the same stale-project + branding issues — separate page, not in scope.
- **Excel export:** `exportSalesExcel()` (SheetJS) + "Export Excel" button beside Print on Sales List. Columns: Sale ID, Client Name, Unit, Project, Sale Date, Total Amount (PKR), Paid Amount (PKR), Remaining (PKR), Status. Amounts as raw numbers (Excel-summable) from `_salesCache`.
- All edited JS pass `node --check`. Cache busters: `print.js?v=20260526a`, `sales.js?v=20260526c`.

**2026-05-26 — Phase 2: PK localization (lakh/crore + CNIC)**
- **Lakh/crore PKR formatting:** `fM`/`fMF`/`fMH`/`fN` in **`js/utils.js`** (NOT helpers.js — that's where they actually live) switched from `en-US` → **`en-IN`** (verified: `en-PK` gives WESTERN grouping, only `en-IN` gives `1,00,000`/`1,23,45,678`). Input-field formatters in `js/helpers.js` (`_amtFmt` + `inp-amt` live mask) also → `en-IN` so typing matches display. New `fLakhCr(n)` helper (`1.25 Cr` / `12.50 L`) applied to the **3 money KPI cards on the dashboard ONLY** (`dashboard.js`; full value kept in `title=` tooltip). Memory: [[pkr-locale-en-in-not-en-pk]].
- **CNIC mask + validation:** added `maskCNIC(el)` (live `xxxxx-xxxxxxx-x`, 5-7-1) + `isValidCNIC(v)` to `js/helpers.js`. Wired `oninput` mask on co-buyer + nominee CNIC in BOTH the new-sale and edit-sale forms (`sales.js`) with inline `e-…-cnic` error divs + format validation in `saveSale`/`saveEditSale` (optional fields — only validated when filled). Client form (`login.html#cf-cnic`) got the live mask too; `clients.js` already validated on save (`cfV` + `saveClientForm` regex) — unchanged.
- Verified formatter + mask + validation logic in Node (lakh/crore output, suffix thresholds, partial/dashed/letter-stripping mask, regex). All edited files pass `node --check`.
- Cache busters: `utils.js?v=20260526a`, `helpers.js?v=20260526a`, `dashboard.js?v=20260526e`, `sales.js?v=20260526b`.

**2026-05-26 — Phase 2 kickoff: Sales module audit + RPC verification + cleanup**
- **Audit:** sales.js (~3.2k lines) reviewed vs MASTER_CONTEXT. Module ~90% complete; no direct `.from()` reads (PATH_B clean). Open gaps vs standard: PKR not lakh/crore (`fM`/`fMF` use en-US — global helper); CNIC unvalidated on co-buyer/nominee; WHT filer/non-filer rate not computed; **no Excel export** (§9 wants PDF+Excel); report branding inconsistent (only possession letter uses `_lh/_pCSS/_sigBlock`, others hardcode navy `#1a3a5c`); no Urdu/RTL; discount+breach "approvals" are free-text, not wired to `approval_requests` (Phase-3 seam).
- **RPC contract VERIFIED via MCP:** `create_sale_with_schedule` validates `SUM(full schedule incl. booking rows) ≈ net_amount` (±1) — current JS (sends full `_salSchedule`) is CORRECT. (Old memory note saying "exclude booking row" was stale — corrected.)
- **⚠️ project_id isolation gap found:** `create_sale_with_schedule` never sets `sales.project_id` and no trigger backfills it → new sales get `project_id=NULL` (breaks §3 site-isolation for recovery/manager). Neither it nor `edit_installment_schedule` checks caller/role/`user_project_assignments` — both trust client `p_company_id`. Latent (create is admin-only; 0 sales in DB). **TODO (Phase-3 hardening):** set project_id from unit on insert + add caller guard.
- **Code cleanup:** removed dead `m-sale-edit` modal (login.html) + orphaned `openSaleEditModal`/`saveSaleEdit` (sales.js); reduced duplicate modal sale-form (`sale.modal.js`) + `modals.js`'s `openSellModal` to a single redirect shim → `nav('newsale')` with unit pre-selected (the modals.js copy wins by load order; both kept identical). Hardened `saveSale` two-phase write: if the post-create extended-fields update fails, it now warns the user + lands on the sale detail to re-enter (no silent success). `get_sale_quick_edit` RPC now client-unused (orphaned, harmless).
- Cache busters: `sales.js?v=20260526a`, `sale.modal.js?v=20260526a`, `modals.js?v=20260526a`. All `node --check` pass.

**Last session:** 2026-05-25
**Completed this session:**
- Module 9.2 — **NOC Management** (greenfield): `noc` table + RLS + 7 SECURITY DEFINER RPCs + `js/pages/noc.js` + nav + login.html div + script tag.
  - Full workflow: pending → under_review → approved | rejected → revoked.
  - `check_noc_eligibility` with installment % + active-NOC detection.
  - `create_noc_request` with auto NOC number (NOC-YYYYMM-XXXX).
  - `get_noc_list` (filterable status/type/search), `get_noc_by_id`, `get_noc_analytics`, `delete_noc`.
  - UI: KPI strip (6 cards), status + type filter tabs, search, full table with per-row actions.
  - 4 modals: create (unit search from `_unitsCache`, eligibility banner), approve (validity dates), reject, revoke.
  - Print NOC document — formal A4 letter with signature blocks.
  - Migration: `20260525_module9_2_noc_management.sql`. Roundtrip verified (10-step), 0 residue.

- Module 10 — **Mobile Responsive & Field Recovery** (2026-05-25): `css/mobile.css` comprehensive overrides; `js/pages/fieldvisits.js` (GPS + photo + offline queue + analytics); `field_visits` table + 3 RPCs; QAB updated (Log Call + Log Field Visit + Record Promise); `ui.js` wired; `login.html` updated.

- Setup Wizard — **Complete 6-step onboarding wizard** (2026-05-25): Company profile, First project (auto-code), Unit types + floors (chip picker), Bank account (optional), Team member (optional), Done screen (animated summary). `js/pages/onboarding.js` fully rewritten as IIFE. `css/login.css` extended. `login.html` `s-onboarding` rebuilt with sidebar nav. `20260525_setup_wizard_rpc.sql` applied + saved. `node --check` passes.

- Module 6 — **Agent Commission Statement PDF** (2026-05-25): `printAgentStatement(agentId)` function added to `agents.js`. Formal A4 statement with agent banner, earned/paid/balance strip, per-project sales breakdown, payment history table, signature blocks.

- Module 12 — **Audit & Security Enhancement** (2026-05-25): 3 tables (`auth_events`, `company_ip_whitelists`, `company_security_settings`) + 8 RPCs; session inactivity timeout with warn bar in auth.js; Security tab in admin.js (timeout config, IP whitelist CRUD, locked users, auth event log + CSV export); Excel export added to audit.js.

**P1 ✅. P2 ✅. P3 ✅. SaaS Overhaul Phase 1 ✅. SaaS Overhaul Phase 2 (2026-05-26) ✅. SaaS Overhaul Phase 3 (2026-05-26) ✅. UI/UX Overhaul v2.0 Step 1 (Sidebar) ✅. Step 2 (Dashboard) ✅.**

---

## SaaS Overhaul — Session 2026-05-25

### ✅ Company Branding Engine (COMPLETE)
**Goal:** Define company identity ONCE → propagates to every print document and the UI.

**DB:** `company_branding` table (company_id PK → companies FK, letterhead_subtitle, address_full, ntn_number, registration_number, doc_brand_color, accent_color, signature_name, signature_title, footer_text) + RLS policy `cb_company_isolation`.

**RPCs:** `get_company_branding(uuid)` → joins companies + company_branding, returns full jsonb including company_name, email, phone, city, country, address, logo_url. `save_company_branding(uuid, jsonb)` → upserts both tables atomically.

**`js/pages/company-branding.js`** (NEW):
- `loadCobranding()` — called on login, caches result as `window._cobranding`
- `rBranding(ct)` — full brand editor tab (logo, colors, letterhead subtitle, address, NTN/Reg, signature, footer) with live preview
- `saveBranding()` — calls `save_company_branding`, updates `window._cobranding` in memory
- `openBrandingWizard()` — full-screen step-by-step modal (4 steps): Company Identity → Branding → Documents → Preview
- `_wzFinish()` — saves all + sets `onboarding_complete=true`

**`js/pages/print.js`** (ENHANCED):
- `_pCSS(sz)` — now reads `window._cobranding.doc_brand_color` + `accent_color`. ALL print documents auto-use company brand colors (header, table headers, doc-title, sec-title, sig-box, gold-bar).
- `_lh(docType)` — Crystal Reports-style: shows company name, subtitle, full address, phone, email, NTN on right side of header. Uses logo from localStorage + branding from `_cobranding`.
- `_sigBlock(extraCol)` — new helper used by all docs: renders authorized signatory block (from branding) + optional extra column + footer text.
- All 8+ print functions updated: `coName` reads from `_cobranding`, hardcoded 'Nexunova' strings eliminated, signature blocks use `_sigBlock()`.

**`js/pages/admin.js`** — Company tab now calls `rBranding(ct)` (full branding editor + wizard button).

**`js/auth.js`** — `loadCobranding()` called after successful login.

**`login.html`** — `<script src="js/pages/company-branding.js?v=20260525a">` added.

**Migration:** `supabase/migrations/20260525_company_branding_letterhead.sql` — applied ✅.

**SaaS Overhaul — Session 2026-05-25 (continued):**

**Dashboard 2.0** ✅
- Today Panel strip (4 chips: collections, follow-ups, critical count, monthly target %)
- `company_targets` table + `get_company_targets` / `save_company_targets` RPCs
- Enhanced `get_dashboard_kpis` RPC returns `today_collection`, `today_count`, `top_overdue`
- Target progress bar on "This Month" KPI card
- **Priority Accounts strip** — fetches top 3 most overdue (>60 days, by outstanding) from DB;
  shown between Today Panel and Financial Overview; color-coded red/amber by severity
- CSS: `.db-priority-strip`, `.db-priority-card`, `.db-priority-rank`, `.db-priority-info`,
  `.db-priority-amt` added to `css/dashboard-premium.css`

**UI Consistency Pass** ✅
Added sections 39–47 to `css/visual-overhaul.css`:
- 39: Form groups (`.fg` spacing inside `.mo-bd`, `.fg-row` 2-col grid, `.fg-sep` divider)
- 40: Amount inputs (`.inp-amt` — tabular nums, right-align, weight 500)
- 41: Modal size variants (`.mo-sm` 460px / `.mo-md` 600px / `.mo-lg` 820px / `.mo-xl` 1020px)
- 42: `.d-kpi` card design matching dashboard style
- 43: `.ph-r` button row flex alignment
- 44: Search bar indigo focus ring
- 45: `.count-chip` — count pill used in module filter tabs
- 46: `.shimmer-row` loading skeleton animation
- 47: Mobile responsive — `.ph` stack, `.mo` bottom-sheet on narrow screens

**Document Hub** ✅ (was already complete in `js/pages/documents.js`)
— 6 doc types: Sale Agreement, Account Statement, Demand Letter, Unit Report, Payment Schedule, Inventory List
— Picker panel with live search, delegates to print.js functions

---

## SaaS Overhaul — Session 2026-05-25 (Part 3)

### ✅ Feature Flags System (COMPLETE)
**Goal:** Gate premium features per company; super-admin can enable/disable per tenant.

**`js/pages/company-branding.js`** — added:
- `loadFeatureFlags()` — calls `list_company_feature_flags` RPC, caches as `window._featureFlags`
- `hasFeature(key)` — global helper; returns true if flag is enabled OR no flag exists (default-open)
- `_updateSidebarFeatureVisibility()` — dims nav icons + adds tooltip for disabled features
- `_showFeatureGate(pg)` — renders "Feature Locked" screen (lock icon, upgrade prompt, → Admin button)

**`js/auth.js`** — `loadFeatureFlags()` called after `loadCobranding()` on every login; `window._featureFlags` and `window._cobranding` both reset to null on logout.

**`js/ui.js`** — `nav()` now checks `hasFeature()` before dispatching to gated pages:
- Gated pages: `noc`, `campaigns`, `forecasting`, `commscenter`, `executive`, `possession`, `legalcases`, `blacklist`, `escalations`, `pdc`
- If flag disabled → shows `_showFeatureGate(pg)` instead of the page
- If flags not loaded yet (null) → default-allow (non-blocking)

**Default behavior:** No flag set = feature enabled. Super-admin must explicitly disable a feature per company.

### ✅ Possession Print Documents — Company Branding (COMPLETE)
Both possession documents now use the Crystal Reports print engine:

**`printPossessionLetter()` (sales.js):**
- Was: hardcoded #14532d green header, inline CSS
- Now: `_lh('Possession Letter')`, `_pCSS('A4')`, `_sigBlock({label:'Client Signature',value:''})`, reads `_cobranding.doc_brand_color`

**`printPossessionDoc()` (possession.js):**
- Was: hardcoded #6C63FF purple header, separate styling
- Now: `_lh('Possession Certificate')`, `_pCSS('A4')`, `_sigBlock(...)` with graceful fallback if print.js not loaded

### ✅ BLUEPRINT.md Full Refresh (COMPLETE)
- Rewrote BLUEPRINT.md from scratch — version 3.0
- Documents all 38+ modules, 65+ pages, all tables, all RPCs
- Includes: print system, branding pipeline, feature flags, CSS architecture, navigation, RBAC, deployment
- Deferred items section updated

**Cache busts:** `auth.js?v=20260525e`, `ui.js?v=20260525b`, `sales.js?v=20260525b`, `possession.js?v=20260525b`, `company-branding.js?v=20260525b`

---

---

## SaaS Overhaul — Session 2026-05-26

### ✅ Legal Cost Tracking (COMPLETE)
**Master prompt requirement: "legal cost tracking (no accounting — just cost log)"**

**DB:** `legal_cases.legal_costs jsonb DEFAULT '[]'` column (added). 2 RPCs:
- `add_legal_cost(p_company_id, p_case_id, p_cost jsonb)` — appends `{date, amount, description, category}` to array
- `remove_legal_cost(p_company_id, p_case_id, p_index integer)` — splices by index

**`legalcases.js`** additions:
- **Legal Costs modal** — per-case, opens with "Costs" button on row (shows badge count if entries exist)
- Form: date, amount (PKR), description, category (lawyer_fee / court_fee / documentation / misc)
- List: shows all cost entries with date, category, amount; remove button per entry
- Footer: running total (PKR X)
- **KPI strip**: added "Legal Costs" card (amber, PKR total computed from `_lcData`)

**Migration:** `supabase/migrations/20260526_legal_cost_and_doc_vault.sql` — pending MCP apply (token expired mid-session).
**Cache-bust:** `legalcases.js?v=20260526a`

---

### ✅ Legal Document Vault UI (COMPLETE)
**Module 2 `[~]` item — UI built for existing `legal_cases.documents` jsonb column**

**DB:** `legal_cases.documents jsonb DEFAULT '[]'` confirmed + added if missing. 2 RPCs:
- `add_legal_document(p_company_id, p_case_id, p_doc jsonb)` — appends `{name, url, type, added_at}`
- `remove_legal_document(p_company_id, p_case_id, p_index integer)` — splices by index

**`legalcases.js`** additions:
- **Document Vault modal** — per-case, opens with "Docs" button on row (purple badge count)
- Form: document name (required), URL/link (optional), type select (petition/evidence/court_order/agreement/notice/other)
- List: doc name + type + open-link (↗ if URL); remove button
- Footer: document count

**Migration:** same file as legal costs above.

---

### ✅ Promise-to-Payment Conversion Rate (COMPLETE)
**Module 8.2 `[ ]` item**

**DB:** New RPC `get_promise_conversion_rate(p_company_id, p_window_days=7)` → `{total_kept, converted, rate, avg_days_to_pay, window_days}`.
- Joins `payment_promises` (status='kept', last 180d) with `payments` (client match, within window_days of promise date, status confirmed/cleared/verified/received).

**`promises.js`** changes:
- `_prmLoadAnalytics()` now fetches both `get_promise_analytics` + `get_promise_conversion_rate` in parallel
- `_prmRenderAnalytics(d, conv)` — 4-card KPI strip added at top of modal:
  - **Conversion Rate** — % of kept promises with matching payment within 7 days (color: green≥70 / amber≥40 / red)
  - **Promises→Payments** — e.g. "12 / 18"
  - **Avg Days to Pay** — average days from promise date to payment
  - **Total Kept (180d)** — baseline count

**Migration:** `supabase/migrations/20260526_promise_conversion_rate.sql` — pending MCP apply.
**Cache-bust:** `promises.js?v=20260526a`

---

### ✅ CLAUDE_RMS.md Cleanup
- Removed duplicate stale `#### 2.1 Demand Letter Automation` block (had `[ ]` items after the already-complete one).

---

**Migrations applied + verified 2026-05-26:** `legal_costs` + `documents` columns on `legal_cases` ✅, all 5 RPCs live ✅, `get_post_possession_dues` RPC applied ✅.

---

---

### ✅ Possession Offer Letter (COMPLETE)
**Module 9.1 `[~]` — possession offer letter**

`printPossessionOfferLetter(unitId)` added to `possession.js`:
- Formal A4 letter: company letterhead (`_lh()`), branded CSS (`_pCSS()`), signature blocks (`_sigBlock()`)
- Body: unit/project/client/possession date meta grid, itemised requirements list (CNIC, receipts, balance, signed copy)
- Valid-for-30-days clause
- Triggered via **"Offer Letter"** button in the possession modal footer (always available, not just on completed possessions)
- Cache-bust: `possession.js?v=20260526a`

---

### ✅ Post-Possession Payment Tracking (COMPLETE)
**Module 9.1 `[~]` — no separate view**

**DB:** `get_post_possession_dues(p_company_id)` RPC — joins `possessions` (status=completed) → `units` → `projects` → `installments` (not paid/cleared/waived, outstanding > 0). Returns per unit: unit_no, project_name, client_name, client_phone, possession_date, pending_count, overdue_count, total_outstanding, next_due_date, oldest_overdue_date. Ordered by outstanding DESC.

**`reports.js`** — new `post_possession_dues` report type added:
- Section: 🏠 Possession → "Post-Possession Dues" · "Handed-over units with open dues"
- Department: Inventory & Projects (alongside existing `possession` report)
- Banner: count / total outstanding (red) / units with overdue (red)
- Table: all columns above with color-coded overdue count, footer total row
- Empty state: "All completed possessions are fully paid up"

**Migration:** `supabase/migrations/20260526_post_possession_dues.sql` — applied ✅
**Cache-bust:** `reports.js?v=20260526a`

---

---

## SaaS Overhaul — Session 2026-05-26 (Phase 3)

### ✅ Legal Case Unit Linking + Demand Letter Branding (COMPLETE)
- `lc-unit_id` select added to Add/Edit modal; `_lcPopulateUnits()` fills from `_unitsCache`
- "Unit" column added to legal cases table; linked unit shown from `_unitsCache` by `unit_id`
- `unit_id` included in `_lcSave()` payload
- `upsert_legal_case` UPDATE path now updates `unit_id` (migration: `20260526_legal_case_unit_link_edit.sql`)
- Demand letter (`_lcDemandLetter`) converted from hardcoded `window.open` + raw HTML to `_lh()` + `_pCSS()` + `_sigBlock()` + `_printHTML()`; `doc_brand_color` used for left-border accent
- `legalcases.js?v=20260526a`

### ✅ Schedule Comparison — Original vs Modified (COMPLETE)
- `installment_snapshots` table: company_id + sale_id (UNIQUE), snapshot jsonb, taken_at
- `snapshot_installment_schedule(company_id, sale_id)` — upserts snapshot of current schedule
- `get_schedule_comparison(company_id, sale_id)` — returns {has_snapshot, taken_at, snapshot[], current[]}
- **Compare** button added to payment schedule summary card (next to Print)
- Opens modal: amber = original column, blue = current column, △ for each changed row
- "Capture Baseline Now" button shown when no snapshot exists
- Migration: `20260526_schedule_comparison.sql` — applied ✅
- `payments.js?v=20260526b`

### ✅ Trial Expiry Management — Module 11 Supplement (COMPLETE)
- `_loadSubscription()` in `auth.js` — loads `get_subscription_with_plan` on login, stores `window._subscription`
- If `status=trialing` AND `trial_ends_at ≤ 7 days` → injects dismissable warning banner at top of app
- Banner: amber for expiring (≤7d), red for expired; shows exact days remaining
- Admin → Plan tab enhanced: days-remaining display (colored amber/red), "Request Upgrade" button
- Upgrade request form (desired plan select + optional message) → calls `create_sa_support_ticket` (category=billing, priority=high)
- Super-admin sees upgrade requests in existing Tickets tab
- `auth.js?v=20260526b`, `admin.js?v=20260526b`

### ✅ Promise Due-Tomorrow In-App Alert — Module 1.3 Supplement (COMPLETE)
- "Due Tomorrow" tab added to Promise Tracker (between Today and Upcoming)
- `_prmRenderDueAlert()` — injects clickable chips above the tab body when promises are due today or tomorrow
- Chips navigate to the relevant tab on click; show count + PKR total
- `promises.js?v=20260526b`

### ✅ Portfolio Reports — Compliance Section (COMPLETE)
- **Legal Cases Portfolio** report type — uses `list_legal_cases` RPC; filter sub-tabs: All/Active/Resolved; KPI banner (total, active, claim, settled); table with stage badge, unit link, claim/settled amounts
- **Transfers Register** report type — uses `list_unit_transfers_search` RPC; KPI banner (count, total fees); table with unit name from `_unitsCache`
- New "⚖️ Compliance" section added to Reports Hub (alongside existing sections)
- `reports.js?v=20260526b`

---

*This file is maintained by Claude Code. Do not delete. Do not ignore.*
*Also keep BLUEPRINT.md refreshed after each session.*
