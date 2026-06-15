# Payment Wall / Subscription Enforcement — Inventory & Plan

**Read-only audit, 2026-06-15.** Live DB target = RMS (`itqxljtfbrppntgyfush`). No code, no
writes. **Plan → owner review before any build.**

> 🔴 **READ §6 FIRST — live-business risk.** FG (`14groupofcompanies`) is on **basic_monthly,
> active, `current_period_end = 2026-06-25` (≈11 days).** `cron_expire_subscriptions` runs
> **hourly** and exempts **only `ADMIN`** — so on/after 25 Jun it will flip **FG → `pending_payment`**
> and the live owner will hit the payment wall. Awami expires 2026-07-13 (29 days). This must be
> handled **before** any enforcement hardening ships.

> **Headline:** enforcement is *much* more built than "probably nothing." There **is** a live
> hourly expiry cron, a login-time wall (5 blocked statuses), plan-limit caps, a pay-proof →
> super-admin `verify_payment` → auto-extend loop, and a password-gated super-admin console. The
> gaps are **consistency** (session-restore vs login), **a couple of unwired admin actions**
> (direct extend / suspend button), and **online-gateway** (scaffolded, not live).

---

## 1. WHAT EXISTS — plans, limits, where data lives, and the live expiry path

### Plan tiers — `public.subscription_plans` (8 rows; price/limits per tier)
| plan_code | price PKR | trial_days | max_users | max_projects | max_units | max_clients | max_agents |
|---|---|---|---|---|---|---|---|
| free_trial | 0 | **7** | 1 | 1 | 10 | 10 | 2 |
| basic_monthly | 10,000 | 0 | 3 | 1 | 500 | 500 | 10 |
| basic_yearly | 108,000 | 0 | 3 | 1 | 500 | 500 | 10 |
| pro_monthly | 25,000 | 0 | 4 | 3 | 1,500 | 1,500 | 30 |
| pro_yearly | 270,000 | 0 | 4 | 3 | 1,500 | 1,500 | 30 |
| ultimate_monthly | 50,000 | 0 | 16 | 10 | 10,000 | 10,000 | 999 |
| ultimate_yearly | 540,000 | 0 | 16 | 10 | 10,000 | 10,000 | 999 |
| enterprise | 0 (`is_active=false`) | 0 | 999 | 999 | 99,999 | 500 | 999 |

Columns: `plan_code, plan_name, billing_cycle, price, currency, trial_days, max_users,
max_projects, max_units, max_clients, max_agents, features(jsonb), is_active, sort_order`.

### Where a company's plan + trial/expiry live — `public.subscriptions` (one row per company)
`company_id, plan_id → subscription_plans, status, billing_cycle, payment_method, amount,
**trial_started_at, trial_ends_at, current_period_start, current_period_end**, cancelled_at,
external_subscription_id, metadata, product, tier, legacy_plan_name, discount_percent`.
- **`status`** is the enforcement signal: observed values `active`, `trialing`, `pending_payment`,
  `expired`, `cancelled`, `past_due`, `payment_under_review`.
- **`current_period_end`** is the expiry clock; `trial_ends_at` the trial clock.
- Lockout/suspension flags live on **`public.companies`**: `status` (`active`/`suspended`),
  `suspended_at`, `suspension_reason`, `deleted_at`.

### Live tenant state (today)
| company | plan | sub_status | period_end | days left |
|---|---|---|---|---|
| Admin Test Company | pro_monthly | active | 2027-05-13 | 333 |
| **Fourteen Group (FG, live)** | **basic_monthly** | **active** | **2026-06-25** | **11** |
| Awami | pro_monthly | active | 2026-07-13 | 29 |
| ZZTEST internal | ultimate | active | 2036-06-12 | 3651 |
| ZZTEST2 | ultimate | trialing | 2026-06-19 | 5 |
| ZZTEST3 | ultimate | trialing | 2026-06-19 | 5 |

### How limits are enforced — `check_plan_limit(company_id, resource_type)` (SECURITY DEFINER)
Reads the latest subscription + plan, counts `projects|units|clients|users`, returns
`{can_add, current_count, max_allowed, plan_name}`. **Caps are enforced** (projects also via a DB
trigger `check_project_plan_limit_trigger`; units/clients/users via the create RPCs +
`get_clients_plan_status`/`get_units_plan_status` readers used by the UI). **It does NOT read
subscription `status`** — i.e. limits gate *new adds beyond the cap*, independent of paid/expired.

### What happens TODAY when a trial ends / a plan isn't paid — **it IS enforced (traced):**
1. **`cron_expire_subscriptions()`** — pg_cron job `expire-subscriptions`, **`7 * * * *` (hourly),
   ACTIVE.** For every `active|trialing` sub with `current_period_end < now()` **and
   `company_code <> 'ADMIN'`**:
   - free_trial / price-0 → `status = 'expired'`.
   - paid plan → ensures a renewal invoice (`_ensure_renewal_invoice`) + pay-link
     (`_ensure_subscription_pay_link` → `pay.html?t=…`), sets **`status = 'pending_payment'`**, and
     emails the owner + writes a `platform_notifications` "Subscription expired" row + fires the
     `send-otp-email` edge function.
2. **Login gate** — `js/auth.js` `verify_login` returns `company.sub_status` (live). Line 312:
   `_blockedStatuses = ['pending_payment','payment_under_review','expired','cancelled','past_due']`
   → if matched, `PW.show(subStatus)` (the payment wall) instead of the app.
3. **The wall** — `js/pages/payment-wall.js` (`PW`) renders `#s-payment-wall`: status message,
   a **WhatsApp "renew" contact link** (pre-filled with company name/code/status), a **pay-proof
   submission** form (→ `submit_subscription_pay_proof`, sets `payment_under_review`), and
   "activated within 2 hours" copy. **Not a dead end** — the owner can always contact + submit.
4. **Manual activation loop** — tenant submits proof → super-admin reviews in the SA console →
   **`verify_payment(proof_id,'approve',…)`** marks the proof approved + invoice paid and
   **extends the sub**: `status='active'`, `current_period_end = GREATEST(existing, now()) + 1
   month|year`. Reject → back to `pending_payment`. (`verify_payment` is `_rms_require_super_admin`-gated.)
5. **Trial countdown** — `auth.js` (≈line 425) reads `get_subscription_with_plan`; if `trialing`
   with `trial_ends_at`, shows a **dismissible `#trial-banner`** (expiring/expired copy). Heads-up
   only, not a wall.

**So: the wall, the expiry cron, the limit caps, and the manual pay-proof→verify→extend loop all
exist and are live.** This is a *finish/harden* job, not green-field.

---

## 2. THE GAP — what's missing for airtight enforcement

| # | Gap | Evidence |
|---|---|---|
| G1 | **Session-restore is inconsistent with login.** `js/init.js` (`tryRestoreSession`) walls only `pending_payment`/`payment_under_review` — **not `expired`/`cancelled`/`past_due`** — and reads `subStatus` from the **stored `nxn_sess`**, never re-checking live DB. `auth.js` login blocks all 5. → a returning user can outlast a status change until next fresh login. |
| G2 | **No live / mid-session enforcement.** Status is read only at login (and stale-cached in the session). An 8-hour session keeps working after the sub flips. No router-level (`nav()`) re-check. |
| G3 | **No direct super-admin "extend / change plan / comp" action.** `verify_payment` only fires off a **tenant-submitted proof**; renews the **same** plan. There's **no RPC/UI** to "extend company X by N months", set/upgrade/downgrade a plan, or grant a comp — needed when a tenant pays offline without submitting a proof. |
| G4 | **`suspend_company` exists but is unwired + maybe unenforced.** The RPC (super-admin) sets `companies.status='suspended'`, but the SA **Companies tab has no suspend/extend buttons** (only the Pending-proofs tab acts), and the **login gate checks `sub_status`, not `companies.status`** — so a "suspended" company may still log in (assumption: `verify_login` doesn't re-check `companies.status`; confirm in build). |
| G5 | **Trial is a dismissible banner, not a graduated wall.** Fine for v1 (cron + next-login block enforce it), but no in-app "trial ends in N days → upgrade" hard prompt. |
| G6 | **Online gateway is scaffolding only.** `subscription_pay_links`, `pay.html`, `get_subscription_pay_link`, `submit_subscription_pay_proof` exist, but there's **no live Safepay/Stripe integration** — payment is manual proof-upload + human verify. |

---

## 3. ENFORCEMENT DESIGN (where the wall lives, what's accessible, grace, no dead-ends)

- **Where:** keep the **login-time gate** (`auth.js` → `verify_login.sub_status` → `PW.show`) as
  the primary boundary, and **make `init.js` session-restore identical** (block the same 5
  statuses) **+ re-validate live** on restore via `get_subscription_with_plan` (cheap, one RPC) so
  a stale session can't outlast expiry (closes G1/G2). Optionally a light `nav()` re-check on a
  timer for very long sessions (lower priority).
- **What a locked tenant SEES:** the existing `#s-payment-wall` (`PW`) — a **clean branded
  "subscription expired / payment due" screen**, NOT a broken app. It shows the plan, amount,
  status, and the renew path. The app shell (`#s-app`) is not mounted.
- **What stays accessible (never a dead end):** the owner **can still log in to reach the wall**,
  see their plan + dues, **submit a payment proof**, and **contact via WhatsApp** (pre-filled).
  Recommend the wall *also* surface the platform's **receiving accounts** (bank / JazzCash /
  EasyPaisa) — `company_payment_methods`/`payment_partners` (0/1 rows today — needs seeding).
- **Grace period:** add a configurable **N-day grace** (e.g. 3 days) — at `current_period_end`,
  flip to a *soft* state (banner + read-only or full access with a countdown), and only hard-wall
  after grace. (Today the cron walls at exactly period_end with no grace.) Store grace in
  `system_config` or `platform_settings`.
- **Read-only vs hard-lock:** v1 = **hard wall** (current behaviour) is simplest and already built;
  a "read-only" tier (can view, can't write) is a bigger change (every write RPC must check status)
  — defer.
- **Fail-open rule (critical):** every gate must treat **`active`/`trialing` (within period) and
  any unknown/missing status as ALLOW**. Never wall on a NULL/missing subscription
  (`check_plan_limit` already returns `can_add:true` when no sub/plan found — keep that posture).

---

## 4. BILLING REALITY (PK context) — how money is actually collected

- **v1 = MANUAL super-admin activation (already the built path).** Tenant pays by **bank transfer /
  JazzCash / EasyPaisa**, uploads a proof through the wall (`submit_subscription_pay_proof`:
  reference number, amount, date, receipt image, payer name/account), status →
  `payment_under_review`; the platform owner verifies the receipt against their account and clicks
  **approve** → `verify_payment` extends the sub. This fits Pakistani B2B SaaS and **needs no
  gateway**. **This is v1.** (To finish it: seed the platform's receiving accounts so the wall can
  show "transfer to …", and add the direct-extend admin action in §5/G3.)
- **Online gateway (Safepay / Stripe) = later phase.** The link/proof scaffolding exists
  (`subscription_pay_links`, `pay.html`) but there is **no live gateway**. Integrating Safepay
  (PK-friendly) or Stripe is a **separate, larger phase** — explicitly **not v1**.

---

## 5. SUPER-ADMIN CONSOLE — what it is, does, and needs

**Found:** `js/pages/super-admin.js` (`window.SA`), reached via `?super-admin` (init.js skips normal
restore for that), **password-gated** (`verify_super_admin(password)` + `_promptPassword`). Server
guard `_rms_require_super_admin()` checks `app_users.is_super_admin`. Tabs:
- **Pending** — pending payment proofs → `_buildProofDetail` → **`verify(proofId,'approve'|'reject'|'needs_info')` → `verify_payment`** (the live activation action).
- **History** — past proofs (`get_all_proofs_admin`).
- **Companies** — `get_companies_admin` → lists every tenant with `sub_status` + `plan_code`.
  **Display only — no action buttons** (no extend/suspend/plan-change).
- **Health** — `get_sa_health_dashboard` (by-plan breakdown). **Stats** — total companies, trial count.
- Announcements / Tickets / Partners (`sa_announcements`, `sa_support_tickets`, `payment_partners`).

**What it needs for real plan management (build):**
1. **Direct actions on the Companies tab:** "Extend N months", "Activate/Set plan", "Suspend /
   Unsuspend" — backed by (a) a **new `admin_extend_subscription(company_id, months|cycle, plan_id?)`**
   RPC (super-admin gated) for offline-paid/comp cases without a proof (closes G3), and (b) wiring
   the **existing `suspend_company`** to a button (closes G4).
2. **Per-tenant detail:** plan, period_end, days-left, usage vs caps (`get_plan_usage_admin`
   exists), proof history.
3. Confirm `get_companies_admin` surfaces `current_period_end`/`trial_ends_at` (so the owner sees
   who's about to lapse — e.g. FG in 11 days).

---

## 6. SAFETY — never brick the live business (#1 risk)

**The concrete danger:** `cron_expire_subscriptions` exempts **only `company_code='ADMIN'`**. FG
(real, live) expires **2026-06-25** and Awami **2026-07-13** → the hourly cron **will** flip them to
`pending_payment` and wall their owners. **This is a live-business lockout waiting to happen,
independent of any new build.**

**Mandatory safeguards (before/with any hardening):**
1. **Protect FG (and real paying tenants) NOW:** either **extend FG's `current_period_end`** well
   ahead, or add an **exemption/perpetual flag** (e.g. `subscriptions.metadata.no_expire=true` or a
   `companies` flag) that the cron and login gate honor for the owner's own business and known-good
   tenants. *(This is the single most important pre-build action; it's a data/owner decision, not
   code.)*
2. **Fail OPEN everywhere:** unknown/NULL status, missing subscription, or any error in the gate →
   **ALLOW** (never wall). `check_plan_limit` already does this; the login/restore gate must too.
3. **Whitelist the platform's own tenants** (ADMIN already hardcoded; add FG + any internal) so
   enforcement logic can never lock the people running the platform.
4. **Grace + warning before the wall** (§3) so a real tenant gets banner + email + days-countdown,
   not an abrupt lockout at the exact second of expiry.
5. **Dry-run any new enforcement** on ZZTEST tenants (ZZTEST2/3 are `trialing`, expire 19 Jun —
   perfect live test subjects) before it can touch FG/Awami.
6. **Test wall = reversible:** verify the full loop (wall → submit proof → SA approve →
   `verify_payment` → `active` → app restored) on a scratch tenant before trusting it on a real one.

---

## 7. PHASES (lowest-risk / highest-value first)

- **Phase 0 — PROTECT THE LIVE BUSINESS (data/owner action, do immediately):** extend FG + Awami
  period_end and/or add the perpetual-exemption flag the cron honors. No lockout of the live tenant.
- **Phase 1 — Consistency + safety hardening (low risk):** make `init.js` restore match the login
  gate (block all 5 statuses) + re-validate live status on restore (close G1/G2); ensure every gate
  fails open; confirm `companies.status='suspended'` is honored at login (close G4 enforcement).
- **Phase 2 — Manual billing management (the v1 money path):** add the SA **Companies-tab actions**
  (Extend / Activate-set-plan / Suspend) + the `admin_extend_subscription` RPC (G3); wire
  `suspend_company`; seed the platform's **receiving accounts** so the wall shows where to transfer.
  This makes the manual collect-and-activate loop fully self-serve for the owner.
- **Phase 3 — Trial UX + grace polish:** graduated trial prompts, configurable grace window, clearer
  "N days left" everywhere.
- **Phase 4 — Online gateway (separate, larger):** Safepay/Stripe on the existing pay-link
  scaffolding for self-serve card/wallet payment + auto-activation (no human verify).

---

## 8. Demo / business line

> "Day 8, a trial company's access freezes onto one clean screen: *your trial has ended — pay to
> reactivate.* They WhatsApp you, transfer ₨25,000 to your account, and upload the receipt. You open
> the super-admin panel, see the receipt, click **Approve** — and their RMS is live again, period
> extended a full month, in under two minutes. No gateway fees, no integration — you collect the way
> Pakistani businesses already pay."

---

### Appendix — exact objects
- **Tables:** `subscription_plans`(8), `subscriptions`(6), `companies`(status/suspended_at),
  `invoices`(2), `payment_proofs`(1), `subscription_pay_links`(0), `payment_partners`(1),
  `company_payment_methods`(0), `platform_subscription_features`(70), `platform_notifications`,
  `platform_email_log`, `sa_support_tickets`/`sa_announcements`.
- **Crons (active):** `expire-subscriptions` (`7 * * * *`), `subscription-reminders` (`0 3 * * *`).
- **RPCs:** `cron_expire_subscriptions`, `cron_subscription_reminders`, `check_plan_limit`,
  `check_project_plan_limit_trigger`(trigger), `get_clients_plan_status`, `get_units_plan_status`,
  `get_plan_limits_with_usage`, `get_subscription_with_plan`, `get_pending_subscription`,
  `_ensure_renewal_invoice`, `_ensure_subscription_pay_link`, `get_subscription_pay_link`,
  `submit_subscription_pay_proof`, **`verify_payment`** (proof→extend, super-admin),
  **`suspend_company`** (super-admin, unwired), `get_companies_admin`, `get_sa_health_dashboard`,
  `get_plan_usage_admin`, `verify_super_admin`, `_rms_require_super_admin`, `_rms_caller`.
- **Frontend:** `js/auth.js` (login gate, `_blockedStatuses`, trial banner), `js/init.js`
  (`tryRestoreSession` gate — narrower than login), `js/pages/payment-wall.js` (`PW` wall +
  pay-proof + WhatsApp renew), `js/pages/super-admin.js` (`SA` console), `css/payment-wall.css`.
- **Assumptions to confirm in build:** (a) `verify_login` does **not** re-check
  `companies.status='suspended'` (so suspend isn't enforced at login); (b) `get_companies_admin`
  may not expose `current_period_end` (needed for the lapse view); (c) platform receiving accounts
  are unseeded (`company_payment_methods`=0) so the wall can't yet show "transfer to …".
