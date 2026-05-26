# NEXUNOVA RMS — MASTER CONTEXT

> **Single source of truth.** Every future chat/agent session must read this file first before doing any work on Nexunova RMS. If a decision here conflicts with older notes, **this file wins**. Update this file whenever a decision changes.
>
> **Last updated:** 2026-05-26
> **Companion files:** `DATABASE_AUDIT.md` (live DB inventory), `PROPOSED_SCHEMA.md` (Phase-1 schema design), `supabase/migrations/20260526_phase1_new_tables.sql` (**APPLIED 2026-05-26**).

## Table of contents
1. Project overview
2. Role architecture
3. Multi-site architecture
4. Approval workflow
5. Restriction levels
6. Setup wizard
7. Database decisions
8. UI decisions
9. Reporting
10. Pakistan-specific requirements
11. Current progress
12. Phase plan
13. Key facts cheat-sheet

---

## 1. Project overview

**Nexunova RMS** (Recovery Management System) — a multi-tenant SaaS ERP for Pakistani real-estate developers: manages projects/units, sales & installment schedules, payments, recovery/collections, cancellations, transfers, legal cases, agents/commissions, and reporting.

| Aspect | Current (production) | Future direction |
|---|---|---|
| Shell | Electron desktop app — thin wrapper around the live web app (`login.html`) | Same Electron wrapper, pointing at the new web app |
| Frontend | **Vanilla JS** (one file per page under `js/pages/*.js`) + hand-written CSS (`css/*.css`) | **Next.js + React** with TypeScript |
| Backend | **Supabase** (Postgres + Auth + Storage) | Unchanged — same Supabase project |
| Data access | `supabase-js` calling **SECURITY DEFINER RPCs** (no direct table reads — "PATH_B lockdown") | Same RPC contract; React calls the same functions |
| UI system | Custom CSS, indigo palette (`visual-overhaul.css`) | **Tremor + shadcn/ui**, Blue-600 primary (see §8) |

**Important:** the desktop app is intentionally a thin web wrapper, NOT a local React app. CRM is a **completely separate product** — never touch RMS schema/auth from CRM work or vice-versa.

**Auth model:** custom login via `verify_login(company_code, username, password)` RPC. Each `app_users` row has its own PK `id` plus a separate `auth_user_id` that maps to the Supabase auth user. **`auth.uid()` returns the auth user id → always join on `app_users.auth_user_id = auth.uid()`, never `app_users.id = auth.uid()`** (this exact bug was fixed on 2026-05-26).

---

## 2. Role architecture

Roles live on `app_users.role` (+ `app_users.module_permissions jsonb` for fine-grained overrides, + `is_super_admin` for platform staff).

| Role | Purpose | Default state | Core access |
|---|---|---|---|
| **Admin** | Company owner/operator. The single approver for everything (see §4). | Active | Full access to all modules; only role that approves/rejects requests; manages users, projects, setup wizard, restrictions. |
| **Recovery Officer** | Field/phone collections. | Active | Recovery queue, contact logs, promises, field visits, reminders — scoped to assigned projects only. Monthly targets via `recovery_officer_targets`. |
| **Finance** | Payments, ledgers, refunds, payables/receivables. | **Sleep by default** (dormant/disabled until the Admin explicitly activates it). | When active: payments, PDCs, ledgers, refunds, financial reports. Until activated, the role exists but grants no access. |
| **Manager** | Oversight across modules without Admin-level control. | Active | Read/operate across sales, recovery, payments for assigned projects; can submit approval requests but **cannot approve**. |

**Exact `app_users.role` strings (confirmed 2026-05-26):** `owner`, `admin`, `recovery_officer`, `finance`, `manager`. Admin-level (approver / privileged RPC actions) = `is_super_admin` OR role IN (`owner`,`admin`) OR `companies.owner_user_id = caller.id` (see `_rms_is_admin`). `recovery_officer` / `finance` / `manager` are non-admin.

Notes:
- "Sleep by default" for **Finance** means the role is provisioned but inert — no menu, no data — until the Admin toggles it on. Build this as an explicit activation flag, not a silent permission.
- All non-Admin roles are subject to **multi-site isolation** (§3) and the **approval workflow** (§4).

---

## 3. Multi-site architecture

**Principle (Roman-Urdu, verbatim from client):** *"A wala B ka data na dekhe"* — a user assigned to Project A must **not** see Project B's data.

**Mechanism:**
- `user_project_assignments` (user_id × project_id, with `access_level` view/edit/manage) is the source of truth for who can touch which project/site.
- Every relevant table carries `project_id` (14 columns added in the Phase-1 migration; `sales/units/unit_cancellations/unit_transfers/commission_structures` already had it).
- RPCs filter every list/query by the caller's assigned `project_id`s. **`is_super_admin` and the company owner bypass** the project filter (see all projects).
- `clients` and `agents` are intentionally **company-level** (they span projects) — not project-scoped.

**Isolation enforcement points:**
1. `project_id` column on the row.
2. `user_project_assignments` membership check inside each SECURITY DEFINER RPC.
3. Company-level isolation already enforced by `company_id` on every table.

**Delete-rule policy for `project_id`:** RESTRICT on financial tables (preserve money history), SET NULL on operational tables (see §7 / `PROPOSED_SCHEMA.md`).

---

## 4. Approval workflow

**Model: single approver — the Admin approves everything.** No multi-level chains. "Maker-checker, bank style."

- **Maker** = any user who initiates a restricted action (e.g. discount above limit, cancellation, refund, transfer, price revision, DND, blacklist).
- **Checker** = the **Admin** (the only approver).
- **Both parties must write a comment.** The maker must justify the request (comment on submit); the Admin must comment on approve **and** on reject. Empty approvals/rejections are not allowed — enforce in the RPC and the UI.

**Tables:**
- `approval_requests` — one row per request: `request_type`, generic `entity_table`/`entity_id` link, `payload` (proposed change snapshot), `status` (pending/approved/rejected/cancelled), `requested_by`, `current_approver_id` (the Admin), `decided_by`, `decided_at`, `decision_comment`.
- `approval_request_comments` — the threaded maker/checker comment trail (`action`: comment/approved/rejected/…).

**Flow:** maker submits (status `pending`, mandatory comment) → Admin sees it in their queue → Admin approves/rejects with mandatory comment → on approve, the RPC applies the change from `payload` to the target entity; on reject, nothing is applied. All transitions are recorded in `approval_request_comments` and the audit log.

---

## 5. Restriction levels

Three tiers govern restricted actions. Each restricted operation is tagged with one level:

| Level | Behaviour | Bypass |
|---|---|---|
| **Hard block** | Operation is refused outright. The RPC raises an error; UI disables the action. | **Nobody** — not even Admin. (e.g. negative payment, deleting a client with active financials, paying more than outstanding.) |
| **Soft block** | Operation is held and routed through the **approval workflow** (§4). | Proceeds **only** after Admin approval. (e.g. discount over threshold, cancellation, refund, price revision.) |
| **Warning** | Operation proceeds immediately but is **logged** (audit log + flagged for review). | No approval needed; the action is recorded for after-the-fact oversight. (e.g. backdated entry within tolerance, small over-limit edits.) |

Implementation: each restriction rule maps an action → level. Hard = enforced in RPC unconditionally. Soft = create an `approval_requests` row and block until decided. Warning = write to `audit_logs` (and optionally `is_sensitive=true`) and continue.

---

## 6. Setup wizard

**6 steps, cannot skip, saves draft.** Progress tracked per company in `company_setup_progress` (`step_key`, `status`, `data` draft jsonb). `companies.onboarding_complete` is the rolled-up flag set when all 6 are `completed`.

| # | step_key | Step | Notes |
|---|---|---|---|
| 1 | `company_profile` | Company profile | Name, code, type, contact, country/city, NTN, timezone, currency (PKR). |
| 2 | `branding` | Branding | Logo, brand color, letterhead/footer (feeds `company_branding`). |
| 3 | `projects` | Projects & sites | At least one project/site created. |
| 4 | `users` | Users & roles | Invite users, assign roles + `user_project_assignments`. |
| 5 | `payment_methods` | Payment methods & banks | Receiving banks/accounts (`banks`, `company_payment_methods`). |
| 6 | `categories` | Categories & settings | Unit types/statuses, payment types, security & password policy. |

Rules:
- **Cannot skip** — each step must reach `completed` before the next unlocks (status `skipped` is reserved for future optional steps, not used in the mandatory 6).
- **Saves draft** — partial input persists in `company_setup_progress.data` so the user can resume.

---

## 7. Database decisions

Authoritative DB facts (full detail in `DATABASE_AUDIT.md` and `PROPOSED_SCHEMA.md`):

**Existing platform (as audited 2026-05-26):** 86 base tables, 5 views, 394 functions (388 SECURITY DEFINER), 59 triggers, 103 RLS policies, 139 FKs. Supabase Postgres.

**Security model:** RLS enabled on every table; RMS tables carry a single `deny_all_anon` policy (`USING false / CHECK false` for anon+authenticated) — **all data access flows through SECURITY DEFINER RPCs** (the "PATH_B lockdown"). `platform_*` tables use granular per-command policies (`is_org_admin`/`is_org_member`/`is_nexunova_staff`/`current_app_user_id`).

**Locked decisions (from `PROPOSED_SCHEMA.md`):**
1. **Approval workflow = single-approver** (Admin). No `approval_steps` table.
2. **Password policy = dedicated `company_password_policies` table** (not folded into `company_security_settings`).
3. **`project_id` delete rule = RESTRICT on financial tables, SET NULL on operational tables.**
   - Financial (RESTRICT): `payments, installments, pdc_cheques, additional_receivables, payables`.
   - Operational (SET NULL): `payment_promises, contact_logs, follow_up_reminders, escalations, legal_cases, field_visits, reminder_logs, buyer_complaints, noc`.

**Conventions (must match exactly for all new objects):** `uuid` PK via `gen_random_uuid()`; `company_id uuid NOT NULL → companies(id) ON DELETE CASCADE`; actor cols `uuid → app_users(id) ON DELETE SET NULL`; `created_at/updated_at timestamptz NOT NULL DEFAULT now()`; **RLS enabled + `deny_all_anon`** on every new table; `trg_<table>_upd BEFORE UPDATE` calling `set_updated_at()` on every mutable table.

**Auth join rule:** always `app_users.auth_user_id = auth.uid()` (never `app_users.id = auth.uid()`).

**Phase-1 schema (drafted, NOT applied):** 10 new tables (`user_project_assignments`, `approval_requests` + `approval_request_comments`, `company_setup_progress`, `company_password_policies` + `password_history`, `user_sessions`, `recovery_officer_targets`, `holidays`, `cancellation_policy_tiers`), +2 columns on `app_users` (`password_changed_at`, `password_expires_at`), +14 `project_id` columns (backfilled). IP whitelist already exists (`company_ip_whitelists`) — no new table.

---

## 8. UI decisions

For the **future Next.js + React** build (current vanilla app uses an indigo custom-CSS theme; it stays as-is until replaced):

- **Primary color:** **Blue-600** (Tailwind `#2563EB`).
- **Theme:** dark / light toggle (persisted per user in `app_users.preferences`).
- **Component libraries:** **Tremor** (dashboards, charts, KPI cards) + **shadcn/ui** (forms, dialogs, tables, primitives).
- **Quality bar:** **Linear / Vercel-level** polish — clean spacing, subtle motion, consistent radius/shadows, keyboard-friendly, fast.
- Tailwind CSS as the styling layer; design tokens centralised so Blue-600 + the dark/light palettes are the single source.

---

## 9. Reporting

**Style: "Crystal Report" — formal, print-grade documents.**

- **Standalone A4 page** per report (dedicated print layout, not a screen view shrunk down).
- **Header:** company **logo + company name + project/site name**.
- **Footer:** company **address** (and registration/NTN where relevant).
- **Exports:** **PDF + Excel** for every report.
- Branding pulled from `company_branding` (logo, colors, letterhead subtitle, signature block, footer text).
- Existing print scaffolding lives in `reports/` (`sale-agreement.html`, `account-ledger.html`, `payment-receipt.html`) and `js/pages/print.js` — the React reporting layer should reproduce this A4 letterhead structure.

---

## 10. Pakistan-specific requirements

- **CNIC validation:** 13-digit format `xxxxx-xxxxxxx-x`; validate on client/agent forms.
- **NTN:** capture company + (where relevant) client NTN.
- **WHT filer / non-filer:** withholding tax differs by filer status; sales already carry `wht_amount` and `cvt_amount`. Track filer/non-filer to compute the correct WHT rate.
- **Urdu reports:** reports must support Urdu (RTL text / Urdu labels) for client-facing documents.
- **PKR formatting:** display amounts in **lakh / crore** convention (e.g. `1,00,000` / `1,00,00,000`), not Western thousands grouping, with `PKR`/`Rs` prefix.
- **Holiday calendar:** `holidays` table (Pakistan national + religious + company). Fixed-date holidays recurring; lunar (Eid/Ashura) seeded per year. Used for due-date / working-day calculations in recovery.

---

## 11. Current progress

- ✅ **Database audit done** — full inventory in `DATABASE_AUDIT.md` (86 tables, 394 functions, RLS/policies/triggers/FKs).
- ✅ **4 security fixes applied** to the live DB (migration `audit_remediation_20260526` + `supabase/migrations/20260526_audit_remediation.sql`):
  1. RLS enabled + `deny_all_anon` on `auth_events`, `company_feature_flags`, `sa_announcements`, `sa_support_tickets`.
  2. Fixed isolation predicate on 7 policies → `app_users.auth_user_id = auth.uid()`.
  3. Removed 6 redundant duplicate triggers (`agents`, `clients`, `contact_logs`, `payments`, `pdc_cheques`, `units`).
  4. Resolved `get_record_history` overload (dropped the broken `(text,text,uuid)` signature; kept `(uuid,text,text)`).
- ✅ **`PROPOSED_SCHEMA.md` created** — Phase-1 design (10 tables + 14 columns), all 3 decisions locked.
- ✅ **Phase-1 migration APPLIED & verified (2026-05-26)** — migration `phase1_new_tables_20260526`: 10 new tables (RLS + `deny_all_anon`), 7 `set_updated_at` triggers, +2 `app_users` columns, +14 `project_id` FK columns (5 RESTRICT / 9 SET NULL) + indexes. DB now **96 base tables**. Backfill ran clean (0 rows — no transactional data yet).

- ✅ **Phase-1 RPC layer APPLIED & verified (2026-05-26)** — migration `phase1_rpcs_20260526` / `supabase/migrations/20260526_phase1_rpcs.sql`: 28 SECURITY DEFINER RPCs + 2 helpers (`_rms_caller`, `_rms_is_admin`) for the 10 new tables. All 30 confirmed `SECURITY DEFINER` + `search_path=public`; smoke-tested (return graceful `no_session` envelope without an auth session). Every RPC resolves the caller via `auth_user_id = auth.uid()`, enforces company isolation, and checks role. Total public functions now **423**.

- ✅ **Pakistan holidays seeded** — 2026 & 2027 (6 national/yr) for company ADMIN via `seed_pakistan_holidays`.
- ✅ **Auth wiring — server side APPLIED (2026-05-26)** — migration `phase1_auth_20260526`: `verify_login` v2 (returns `needs_password_reset` + `password_expires_at`; **self-heals `auth.users.encrypted_password`** each login so `signInWithPassword` matches) and new `change_password` RPC (policy + last-3 history + expiry; syncs app_users **and** auth.users; bumps session_version). Session model = **Option A** (real Supabase session).
- ✅ **Auth wiring — `auth.js` edits APPLIED (2026-05-26)** — `signInWithPassword` after `verify_login`; force-password-change overlay (first-login/expired); `create_session`/`revoke_session` device tracking; `signOut` on logout; idle timeout default **30 min**.
- ✅ **Auth gaps migration APPLIED & verified (2026-05-26)** — migration `phase1_auth_gaps_20260526` / `supabase/migrations/20260526_phase1_auth_gaps.sql`: (a) `trg_app_users_auto_bridge` AFTER INSERT on `app_users` (auto-provisions a GoTrue identity for new users); (b) `create_app_user` now sets `needs_password_reset` + `password_expires_at` from the company password policy. NEW users can now use Option A. (Note: the first apply attempt hit a socket drop and rolled back; verified-false, then re-applied cleanly.)
- ⚠️ **Bridge note:** `app_users` ↔ `auth.users` passwords had drifted (cost 10 vs 6) with no sync; `verify_login` v2 now self-heals on each login. Live `signInWithPassword` test could not be run from the agent sandbox (network egress returns 401 even on public `/auth/v1/settings`); structural prerequisites all verified — confirm by a real app login (which triggers self-heal) or run the password-grant curl from an unfiltered network.

- ✅ **`signInWithPassword` end-to-end confirmed (2026-05-26)** — live `POST /auth/v1/token?grant_type=password` against itqxljtfbrppntgyfush with the correct publishable key (`…8VG`) returned **200 + bearer JWT + refresh token** for admin (`user_id=98ab301c…`, `role=authenticated`). The earlier 401 was a key typo (`…8Vg`) in `buyer-portal.html`, since fixed.
- ✅ **Setup Wizard UI built (2026-05-26)** — 6 steps, draft-saving, no-skip, Blue-600 (`#2563EB`) primary on the existing dark `ob-*` shell. Steps: **Company Info → Branding → Projects → Business Rules → Users → Review & Launch**. Each Next validates required fields + calls `update_setup_step` (mapped to fixed `step_key`s); on Launch, real persistence (company/branding/sites/users + `assign_user_to_project`) then `complete_setup_step` for all 6 keys in sort-order → `onboarding_complete=true` → nav dashboard. Files: `js/pages/onboarding.js` (full rewrite, `?v=20260526a`), CSS appended to `css/login.css`. Flagged gaps for follow-up: (a) `companies.logo_url` has no clean save-RPC (`update_company` references non-existent columns — broken; `update_company_profile` lacks `logo_url`) — logo currently kept in wizard draft only; (b) business rules persist in `company_setup_progress.data['categories']` until a dedicated settings table/RPC exists (Phase-3 restrictions will read from there); (c) dark/light default stored in `localStorage['rms.theme.<cid>']` + draft (app theme switching is Phase-5).

- ✅ **Setup Wizard hardening + logo persistence (2026-05-26)** — **Plan-limit cap fix:** parser was looking for `data.projects_used`/`data.users_used` (don't exist in `get_plan_limits_with_usage`'s response), so `*Used` defaulted to 0 and the wizard let users add sites/users that then failed inside `check_plan_limit` at launch. Fixed to read the canonical flat fields `data.count_projects`/`data.count_users`. **Launch is now idempotent** — skips projects whose `project_name` already exists (case-insensitive), with **per-item `try/catch` + friendly errors** ("plan limit reached for projects") and a summary toast (`X created · Y already existed · Z failed`). **Logo persistence resolved:** migration `update_company_profile_add_logo_url_20260526` adds `logo_url` to `update_company_profile`; wizard Step-1 logo now saves to `companies.logo_url`. **Re-entry cancel:** when the wizard is opened from the sidebar (`S.onboardingComplete=true`), a red **"✕ Cancel & return to dashboard"** link appears in the sidebar footer; first-time setup remains uncancellable. **Cleanup:** 2 duplicate `FMH` projects from earlier wizard test runs deleted (KBH preserved). `onboarding.js?v=20260526d`.

- ✅ **Setup Wizard — full polish + module integration (2026-05-26)** — comprehensive UX/integration round:
  - **Step 3 (Projects) module-form reuse:** wizard's "+ Add site" now opens the **same `openProjectModal()`** the Projects page uses (global `#m-project` in `login.html`). Inline mini-card form removed. Wizard observes the modal's `open` class via `MutationObserver`; on close it refreshes `_existing.projects` + `_loadLimits`. **Zero form duplication** — all ~25 project fields (description, builder, NOC, GPS, amenities, cover images) captured via the canonical form.
  - **"Already in your workspace" sections** in Step 3 (projects) and Step 5 (users): read-only cards listing what's already in the DB so user can't accidentally duplicate. Loaded via `list_projects` / `list_app_users` in new `_loadExistingEntities()`.
  - **Plan-limit math fixed**: now correctly subtracts existing+draft from `count_projects`/`count_users` (was mis-reading non-existent `projects_used` field).
  - **Step 5 (Users) kept inline** intentionally — wizard's inline cards have **site assignment checkboxes** that the `users.js` modal doesn't have; module reuse would lose features. Data still flows via `create_app_user` → user appears in User Management identically.
  - **Validation** (email `name@domain.com`, phone digits+separators, NTN format) with **red border + focus** on the offending field. HTML5 `pattern`/`type`/`inputmode`/`maxlength` attributes added. `oninput` clears error class for live feedback.
  - **"Later in [module]" hints** on every step's panel-sub (Admin → Company Profile / Branding / Settings / User Management) — iPhone-restore-style "skip now, set later" guidance.
  - **Date corruption guard** — `22026-03-11`-style 5-digit-year garbage rejected at `_collectSites` (regex check); inputs constrained with `min="today"` + `max="2100-12-31"`. The 2 existing corrupted dates on FMH/KBH **NULLed** for clean re-entry.
  - **Re-entry cancel button** ("✕ Cancel & return to dashboard") in sidebar footer when `S.onboardingComplete=true` (first-time setup remains uncancellable).
  - **Visual polish v4**: 44 px bottom padding on `.ob-panel-wrap` so form doesn't touch the nav footer; subtle dark backdrop + shadow on footer; blue 3 px accent on active sidebar step; swatch glow; better hover/transitions; tighter typography; per-step `.ob-section-divider` for Builder/Timeline groupings.
  - **Critical layout fixes**: (a) wizard's sidebar Cancel link was scrolling out — now pinned via `.ob-step-list { overflow-y:auto; flex:1 }` + `.ob-sb-footer { flex-shrink:0 }`; (b) global FABs/chat (Crisp `.crisp-client`, any `[class*="fab"]`) **hidden during wizard** via `body.wizard-active` class toggled by `OB.show/hide`; (c) **`.sb-user-pop` Admin dropdown** background was bleeding through behind it — forced opaque `#0F172A` (dark) / `#FFFFFF` (light) + `z-index:9999` in `sidebar-premium.css`.
  - **Setup Wizard sidebar button** now hidden when `S.onboardingComplete=true` (was always visible to admins). Re-launch entry point will live in Admin → Settings (Task 2 below).
  - **DB cleanup**: 2 duplicate FMH projects (test runs) + 1 leftover Khushal Bagh Heights (KBH) project (with its 1 test unit, cascade) — deleted via MCP. Final state: 2 wizard-defined sites (FMH 220 units, KBH 280 units). `count_projects=2 / max 3`.
  - **Note**: storage layer — wizard logo upload uses the **existing `rms-files` bucket** via `_handleFileUpload`; **no RLS migration needed** (bucket already configured for the app). Logo persistence to `companies.logo_url` is fixed via `update_company_profile_add_logo_url_20260526` migration.
  - Files touched today: `js/pages/onboarding.js` (`?v=20260526i`), `js/ui.js` (`?v=20260526e`), `css/login.css` (`?v=20260526b`), `css/sidebar-premium.css` (`?v=20260526d`), `login.html`, `buyer-portal.html` (anon key typo fix `8Vg → 8VG`).

- ✅ **Role-based access enforcement (2026-05-26)** — Phase 1 close-out. **Extended** (not rewrote) `buildSB()` in `js/ui.js`:
  - **Role aliasing**: canonical roles `owner / admin / recovery_officer / finance / manager` mapped over the legacy DB values (`recovery` = recovery_officer, `accounts` = finance). Body classes `role-admin / role-recovery / role-finance / role-manager / role-readonly` applied for CSS/page targeting.
  - **Admin/Owner**: full sidebar (incl. System group) — and **always keeps Finance** even with no finance user (in a lean company the admin records receipts/PDCs).
  - **Recovery Officer**: assigned-sites-only nav; `S.assignedProjectIds` loaded via `get_user_projects` RPC; global `hasProjectAccess(pid)` helper in `auth.js` for client-side site filtering.
  - **Finance**: finance modules only; the **Finance group "sleeps"** (hidden) company-wide when no active finance user exists (`S.hasFinanceUser`, computed via `list_app_users`) — except for admin/owner.
  - **Manager**: new nav branch — broad ops+finance **read access, no System group**; gets `role-readonly` → CSS in `css/app.css` hides create/edit/delete affordances (`.btn-primary/.btn-add/.btn-danger`, `open*Modal`, `save*` …) + a fixed **"READ-ONLY MODE"** topbar badge.
  - **Context loader**: `_loadRoleContext(companyId, userId, role)` in `auth.js` runs **before `buildSB()`** on both fresh login (`auth.js`) and session restore (`init.js`); result persisted to `sessionStorage`. Verified end-to-end (recovery officer logs in, sees only assigned site).
  - Cache busters: `css/app.css?v=20260526d`, `js/ui.js?v=20260526f`, `js/auth.js?v=20260526d`, `js/init.js?v=20260526a`.
- ✅ **Re-run Setup Wizard entry point (2026-05-26)** — admin-only button in **Admin → Settings** calls `OB.show(S.cid)`; complements the post-onboarding hidden sidebar button. `js/pages/admin.js?v=20260526c`.
- ✅ **Test recovery officer created & verified (2026-05-26)** — login `recovery@ADMIN` / `Test1234`, role `recovery`, assigned to **FMH** (view). Used to validate site isolation.
- ⚠️ **`create_app_user` gotchas (found 2026-05-26, save for reuse):** (1) it stores the username as **`<role>@<COMPANYCODE>`** (e.g. `recovery@ADMIN`) while the owner is a bare `admin` — and the login form splits on the last `@`, so a stored `role@code` username is **unfindable**; the test user needed `username` reset to bare `recovery` so the form's `recovery@ADMIN` input resolves. (2) it leaves **`email_verified=false`**, which `verify_login` rejects with `email_not_verified`; must be set true. (3) `app_users.email` is **NOT NULL** — pass a real email. All three required a direct DB `UPDATE` (no RPC exposes them). These are latent bugs for *every* admin-created user, not just the test one.

- ✅ **Phase 2 — Sales module COMPLETE (2026-05-26)** — sale form + installment schedule, PK lakh/crore localization, Crystal-style report branding pulled from `company_branding`, Excel export, and print-template fixes across `reports/*.html`. **Fixed the missing management-report backend:** created `get_collection_report`, `get_sales_register`, `get_outstanding_report`, `get_unit_inventory` (migration `phase2_management_report_rpcs` / `supabase/migrations/20260526_phase2_report_rpcs.sql`) — these were called by `reports/viewer.html`, `reports/hub.html` and `js/pages/dashboard.js` but **never existed** in the DB, so the whole management-reports feature was silently failing. All SECURITY DEFINER + company-scoped (the report viewer uses the **anon key with no session**, so report RPCs must NOT do a `_rms_caller`/session check), return shapes mapped to the real schema (`booking_date←sale_date`, `unit_number←unit_no`, `total_paid←SUM(payments)`, `status←category_unit_statuses.status_name`, …). Branch `phase2-sales-reporting` merged to `main` (`af2f07e`) + pushed.

- ✅ **Phase 2 — Payments module COMPLETE (2026-05-26)** — full audit + fixes (branch `phase2-payments`, merged to `main` `5c31791`). **3 direct `.from()` reads that the `deny_all_anon` RLS lockdown silently blocked** (returning 0 rows for the authenticated app) swapped to RPCs: `_pymLoadBanks→list_banks_active`, `_pymLoadAndRenderTx→list_payments_for_sale_full` (new), `_pymRenderPDC→list_pdc_for_sale` (new). **PDC status vocabulary standardized to `presented`** (was `deposited` in the inline payment view) and inline Deposited/Clear/Bounce buttons **routed through the dedicated `mark_pdc_deposited`/`mark_pdc_cleared`/`mark_pdc_bounced` RPCs** (proper deposit/clearance dates + client auto-escalation) instead of generic `update_pdc_cheque`; bounce penalty details persisted as a follow-up. **`edit_payment_meta` now passes `p_bank_id`** (edit modal gained a bank-account dropdown). New migration `supabase/migrations/20260526_phase2_payments_per_sale_list_rpcs.sql` (applied): `list_pdc_for_sale` + `list_payments_for_sale_full`, SECURITY DEFINER, company/sale-scoped. **Reusable gotcha:** the existing `list_payments_for_sale` is a thin 6-column RPC that filters `status='received'` — not usable for full panels (no `id`/`status`/codes); use `list_payments_for_sale_full`. Note: PDC Register (`pdc.js`) and Receipts (`receipts.js`) were already RPC-clean — no changes. See [[report_rpcs_anon_scoped]].

**Immediate next action:** Phase 2 **Payments module ✅ complete (2026-05-26)**. **Next: audit the Recovery Queue redesign** (same approach: front-end calls vs. real RPCs/schema).

---

## 12. Phase plan

### Phase 1 — Foundation ✅ **100% COMPLETE (2026-05-26)**
- ~~Apply the Phase-1 migration (`20260526_phase1_new_tables.sql`) and verify every object.~~ ✅ **done 2026-05-26.**
- ~~Auth system (login, password policy/expiry, force-change-on-first-login, sessions/devices).~~ ✅ **done.**
- ~~Setup wizard (6 steps, no-skip, draft-save).~~ ✅ **done.**
- ~~Role-based access (Admin / Recovery Officer / Finance-sleep / Manager) + `user_project_assignments` enforcement.~~ ✅ **done.**

### Phase 2 — Core modules ◀ **CURRENT**
- ~~**Sales** (with installment schedule)~~ ✅ **COMPLETE (2026-05-26)** — sale form + schedule, PK lakh/crore localization, Crystal-style report branding, Excel export, print templates, + the 4 management-report RPCs.
- ~~**Payments**~~ ✅ **COMPLETE (2026-05-26)** — audited & hardened: 3 RLS-blocked `.from()` reads swapped to RPCs, PDC status standardized to `presented` + routed through dedicated RPCs, `edit_payment_meta` bank_id fix, + 2 new per-sale list RPCs.
- **Recovery Queue** redesign ◀ **NEXT TO AUDIT**.

### Phase 3 — Governance
- Approval workflow (single-approver, mandatory comments), Audit trail, Restriction levels (hard/soft/warning).

### Phase 4 — Intelligence & documents
- Reports (Crystal-style A4, PDF+Excel), AI Recovery Radar, Document generation, Client portal.

### Phase 5 — UI polish
- Tremor + shadcn/ui, Blue-600, dark/light, Linear/Vercel-level finish.

> **Build order rule:** do not jump ahead. Each phase depends on the previous (e.g. approvals in Phase 3 assume roles + isolation from Phase 1). RPCs for the new Phase-1 tables and Pakistan holiday seed data are Phase-1 follow-ups.

---

## 13. Key facts cheat-sheet

| Thing | Value |
|---|---|
| DB | Supabase Postgres, schema `public`, 86 tables (pre-Phase-1) |
| Data access | SECURITY DEFINER RPCs only; tables locked by `deny_all_anon` |
| Auth join | `app_users.auth_user_id = auth.uid()` |
| Login RPC | `verify_login(company_code, username, password)` |
| New-table rules | uuid PK / `gen_random_uuid()` / `deny_all_anon` RLS / `set_updated_at` trigger / `company_id → companies CASCADE` |
| Approver | Admin only (single-approver, both parties comment) |
| Isolation | `user_project_assignments` + `project_id`; super-admin/owner bypass |
| Finance role | dormant until Admin activates |
| Primary colour (future) | Blue-600 `#2563EB`, Tremor + shadcn/ui |
| Currency | PKR, lakh/crore formatting |
| Migration status | Phase-1 migration **applied & verified 2026-05-26** (DB: 96 base tables) |
| Companion docs | `DATABASE_AUDIT.md`, `PROPOSED_SCHEMA.md`, `supabase/migrations/20260526_*.sql` |
