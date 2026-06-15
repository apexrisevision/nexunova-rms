# SUBAH KI LIST (Smart Recovery Queue) + ALERTS ENGINE — Design Plan

**Date:** 2026-06-14 · **Status:** PLAN ONLY (read-only inventory done; no code). Owner review → build.
**Scope:** PART 1 the ranked daily call queue; PART 2 the alerts engine (register #6).
**Truth-law:** every number below names its exact source and reconciles to real rows; every
surfaced figure is ⓘ-tippable with the formula shown here.

---

## 0. Headline finding from the substrate inventory

**Much of the alerts spine already exists — but it is "dark" (computed, never surfaced) and
batch/company-wide, not live/officer-scoped.** The design therefore is mostly *surfacing,
re-scoping, and one new live RPC* — not building an engine from scratch.

| Capability | Exists? | Where | Gap for our goal |
|---|---|---|---|
| Aging / FIFO outstanding | ✅ | `get_recovery_position(company,project,from,to)` | none — reuse verbatim as the money/aging source |
| Daily ranked client list | ⚠️ exists but **dark + propensity-ranked + company-wide + batch** | `generate_recovery_radar()` → `recovery_radar_logs` (cron 2am/9pm); **no reader RPC, no UI** (radar nav redirects to dashboard) | not officer-scoped, not live, ranks *likelihood-to-pay* not *urgency* |
| Client health / propensity | ✅ (but unpopulated for FG) | `client_health_scores` (score 0-100 + category), cron nightly | reuse as the propensity signal; FG has 0 rows yet |
| Promises (attributed) | ✅ (just fixed) | `payment_promises` (logged_by=officer UUID, project_id) | source for broken/promise-due reasons |
| PDC | ✅ | `pdc_cheques` (cheque_date, status, client/sale/project) | source for PDC-due reason |
| Contact recency | ✅ (just fixed) | `contact_logs` (agent_id=officer UUID, project_id, contact_date) | source for no-contact reason |
| Outbound comms queue + dispatch | ✅ end-to-end | `enqueue_message()` → `message_log` → `comms-dispatch` edge fn (every 2 min, Meta WhatsApp) | reuse for digests/reminders — do NOT rebuild |
| **Weekly** at-risk digest (WhatsApp to owner) | ✅ | `cron_weekly_digest_all()` (Mon 4am), ranks by `client_health_scores.score` | pattern to copy for the **daily 8am** digest |
| In-app alert surface | ❌ weak | Inbox badge = `alrt = overdueN` only (`ui.js:424`); radar not shown | the queue itself becomes the live in-app surface |
| Owner **8am daily** digest | ❌ | — | NEW cron + builder (reuses weekly pattern + `get_daily_collections`/`get_today_snapshot`) |
| "Big payment received" alert | ❌ | — | NEW (digest line + optional event surface) |

**Design consequence:** the Subah Ki List is a **new live, officer-scoped, urgency-ranked RPC**
(`get_recovery_queue`) that *reuses* the radar's reason vocabulary + `client_health_scores` as a
*propensity* sub-signal. We retire the radar's role as a would-be UI (it stays as the nightly
propensity scorer feeding health) rather than run two parallel ranked lists.

> **Radar vs. Subah Ki List — the core distinction (must not be conflated):**
> `generate_recovery_radar` answers *"who is most likely to pay if I call today?"* (propensity:
> pays-on-Nth, salary-date match, recent positive contact; it scores >90-day accounts **low**).
> The owner's Subah Ki List answers *"who must I act on today and WHY?"* (urgency: broken promise,
> legal cutoff, PDC clearing). These rank in nearly opposite directions for a dead account. We use
> **urgency to order + reason**, and **propensity to break ties / pick the action** inside the
> collectible tier.

---

## 1. SMALL CHANGE TO INCLUDE THIS PHASE — hide Legal Cases from the recovery role

Recovery officers **escalate**; **admins open legal cases**. Two edits (mirrors the recovery-fix
phase pattern; confirmed against current `ui.js`/`helpers.js`):

1. **`js/ui.js` — `allow.recovery`** (added last phase): remove `'legalcases'`.
   → recovery nav-gate no longer permits the page (bounces to dashboard if hit directly).
2. **`js/ui.js` — recovery sidebar (`isR` branch)**: remove the
   `{ id:'legalcases', ic:'scale', lb:'Legal Cases', more:true }` item (added last phase).
   → not advertised, so no bounce (keeps sidebar == reachable, the BLOCKER-3 invariant).
3. **`js/helpers.js` — `_pageToModule`**: leave `legalcases:'recovery'` **or** change to a
   manager/admin-only key. Simplest: drop `legalcases` from `_pageToModule` so only admin
   (`hasPermission` returns true for admin/owner regardless) and manager (broad read) reach it.
   Manager already gets read-only breadth; admin/owner unrestricted. **Net:** Legal Cases visible
   to admin + manager only; recovery sees Escalations (their handoff) but not Legal.

No DB change. `legalcases` keeps its feature-flag gate (`legal`). Build with this phase.

---

## PART 1 — SUBAH KI LIST (the ranked daily call queue)

### 1.1 Reason catalogue — each reason → exact source + formula + ⓘ tip

All scoped to the officer's assigned projects (`user_project_assignments`, `is_active`) — the
attribution substrate fixed in the recovery-fix phase. `today := p_date` (default `CURRENT_DATE`,
Asia/Karachi). "overdue installment" = `installments` row with `amount_due > amount_paid` and
`due_date < today`, joined to a non-cancelled active sale.

| # | Reason | Trigger formula | Exact source | ⓘ tip text |
|---|---|---|---|---|
| R1 | **BROKEN PROMISE** | `status='broken'` **OR** (`status='pending'` AND `promise_date < today`) | `payment_promises` | "Promised PKR {promised_amount} on {promise_date} — not received. {n} day(s) late." |
| R2 | **PROMISE DUE TODAY** | `status='pending'` AND `promise_date = today` | `payment_promises` | "Client committed PKR {promised_amount} today ({promise_date})." |
| R3 | **PDC DUE today/tomorrow** | `status IN ('pending','deposited')` AND `cheque_date BETWEEN today AND today+1` | `pdc_cheques` | "Cheque #{cheque_no} for PKR {amount} dated {cheque_date} — ensure funds/clear." |
| R4 | **90-DAY APPROACHING** | `oldest_overdue_days BETWEEN 75 AND 90` | `installments` (FIFO, same as `get_recovery_position.overdue_days = today − MIN(due_date) over unpaid`) | "Oldest unpaid is {d} days overdue — legal cutoff at 90. Last chance before escalation." |
| R5 | **NEW OVERDUE** | `oldest_overdue_days BETWEEN 1 AND 7` AND client has **no** unpaid installment older than that AND no prior broken promise/escalation | `installments` (+ absence in `payment_promises`/`escalations`) | "First missed installment — {d} day(s) overdue. Early contact = best recovery." |
| R6 | **HIGH-RECOVERABLE** | `overdue_amt ≥ scope P75` (or ≥ config floor) AND propensity good: `client_health_scores.score ≥ 60` **OR** (fallback when no health row) `paid_pct ≥ 50` **OR** last payment within 60 days | `installments` (amount) + `client_health_scores` / `payments` (propensity fallback) | "Large balance PKR {overdue_amt} + reliable payer (health {score}/100, {paid_pct}% paid)." |
| R7 | **NO CONTACT in N days** | has overdue AND (`MAX(contact_logs.contact_date)` IS NULL OR `today − last_contact > N`, N=14 default, company-configurable) | `contact_logs` | "No contact in {d} day(s) — client has gone quiet." |

**Derived non-call routing (kept out of the "call today" ordering):**

| Flag | Trigger | Routes to | Source |
|---|---|---|---|
| **PAST CUTOFF / DEAD** | `oldest_overdue_days > 90` AND (≥3 broken promises **OR** active legal case **OR** `paid_pct` low) | "Escalate / Legal / Field-visit" section, not the call list | `installments` + `payment_promises` + `legal_cases` (mirrors radar's `next_action` ladder) |

> **FG reality (verified):** Fourteen Group currently has **0 promises, 0 PDCs, 0 contact_logs,
> 0 health rows, 0 escalations** — a pure legacy aging book. So for FG *today* only R4-dormant
> (everything is >90d, i.e. PAST-CUTOFF), R6 (amount), and R7 (no-contact = universal) compute;
> R1/R2/R3 light up the moment officers use the now-fixed recovery tools. The queue degrades
> gracefully: with no promise/PDC/contact data it becomes an aging+propensity list, never empty-by-bug.

### 1.2 Ranking algorithm — two-tier, deterministic

A client may trip several reasons; we **collect all chips** but order by a single priority. The
order is **tiered** so time-critical events always float above "big balance", and dead accounts
never crowd the morning call list:

```
TIER A — TIME-CRITICAL (act today, regardless of propensity)   base = 30000
    sub-rank (highest wins, but show all chips):
      R1 BROKEN PROMISE        +500
      R2 PROMISE DUE TODAY     +400
      R3 PDC DUE today         +350
      R4 90-DAY APPROACHING    +300
      R3 PDC DUE tomorrow      +250
    tie-break: + amount_pts (0–100)

TIER B — COLLECTIBLE OVERDUE (score-ranked)                     base = 20000
    score = 0.50*amount_pts + 0.30*propensity_pts + 0.20*staleness_pts
            + bonus(R5 NEW_OVERDUE +8, R6 HIGH_RECOVERABLE +12, R7 NO_CONTACT +6)
      amount_pts     = LEAST(100, ROUND(overdue_amt / 100000))      -- 1 pt per 100k, cap 100
      propensity_pts = COALESCE(health.score, paid_pct, 40)          -- 0–100
      staleness_pts  = LEAST(100, days_since_last_contact)           -- quiet longer = nudge up

TIER C — DEAD / ESCALATE (PAST-CUTOFF flag)                     base = 10000
    shown in a separate collapsed "Escalate / Legal" section; ordered by overdue_amt desc;
    action = legal_notice / field_visit / coordinate_legal (radar next_action ladder)
```

`priority = base + within-tier points`. Final list = `ORDER BY priority DESC, overdue_amt DESC`.
**Primary reason chip** = the highest-weighted triggered reason; show up to 3 chips total.
Weights live in one constants block (tunable) — same discipline as the radar's score breakdown.

**Why two tiers (not one weighted sum):** a single weighted sum lets a huge dead balance (Tier C)
outrank a broken promise (Tier A). Tiering guarantees "a client who broke a promise yesterday is
above a 957-day defaulter," which is the officer's real priority. Propensity only sorts *within*
the collectible tier — so officers spend the morning where calls actually convert.

### 1.3 New RPC — `get_recovery_queue`

```
get_recovery_queue(
  p_company_id  uuid,
  p_officer_id  uuid  DEFAULT NULL,   -- NULL = caller; admin may pass any/none
  p_project_id  uuid  DEFAULT NULL,   -- NULL = all of the officer's assigned projects
  p_date        date  DEFAULT CURRENT_DATE,
  p_limit       int   DEFAULT 100
) RETURNS jsonb            -- STABLE SECURITY DEFINER, search_path=public
```

**Scoping / auth (same bar as `get_team_performance`):** `_rms_caller()`; non-admin may only see
their own `p_officer_id` and only projects in their active `user_project_assignments`; admin/owner
may pass any officer/project within their company; cross-tenant → `[]`.

**Return shape (one object):**
```
{ "as_of": "2026-06-14",
  "queue": [ {
     client_id, client_name, client_code, phone, sale_id, unit_no, project_name,
     outstanding, overdue_amt, oldest_overdue_days, paid_pct,
     last_contact_date, last_promise:{date,status,amount},
     reasons:[ {code:"R1", label:"Broken promise", detail:"…", tip:"…"} … ],
     tier:"A|B|C", priority, propensity:{score, source:"health|paid_pct|default"},
     suggested_action:"call|follow_up_promise|hold_pdc|field_visit|legal_notice"
  } … ],
  "counts": { "tier_a":N, "tier_b":N, "escalate":N, "total":N } }
```

**Reconciliation (truth-law):**
- `outstanding` / `overdue_amt` / `oldest_overdue_days` / `paid_pct` / `last_payment` are the
  **same FIFO math as `get_recovery_position`** (we lift its `lines→perline→sale_agg` CTEs or call
  a shared helper) → the queue's money ties to the Recovery Position report to the paisa.
- `last_promise` ties to `payment_promises`; `last_contact_date` to `contact_logs`; PDC to
  `pdc_cheques`. No new truth is invented — only joined + ranked.

**Justification (minimal-RPC bar, like `get_daily_collections`):** one read RPC, no new table; it
is the single server-side gate that makes the officer's queue project-isolated and reconciled.
Computed-on-read = always fresh, no staleness, no extra cron.

### 1.4 UI — the queue page (warmth kit)

New page `pg-recovery-queue` (route `queue`; add to recovery + admin sidebars under RECOVERY,
above Payments — it's the morning starting point). Built entirely on `NX.*` (KIT.md):

- **Header:** `NX.pageHeader('Subah ki List', actions, { icon:'sunrise', tone:'primary' })` +
  sub "Who to call today, and why" + a project `NX.tabs` (when the officer has >1 project) +
  date chip. `NX.kpi` strip: To-call (Tier A+B), Time-critical (A), To-escalate (C), Σ overdue.
- **Row anatomy** (a warm `NX.card --hover`, one per client, leading `NX.ichip`):
  ```
  [icon] Asadullah Khan · Unit 1-01 · Tower A          PKR 6,109,716 overdue
         [⛔ Broken promise]  [📵 No contact 21d]  [💰 High balance]   ← reason chips (tinted)
         Last contact: 21d ago · Last promise: PKR 400k broke 3d ago
         [Call]  [WhatsApp]  [Log]   ← quick actions
  ```
  Reason chips use semantic tone (R1/R4 danger-edge, R2/R3 warning, R6 success, R7 muted) per the
  KIT badge rule (tinted bg + 1px `--fk-*-edge`). Numbers carry `.num`.
- **Quick actions** reuse the **existing, now-fixed** flows: **Call** → `tel:`; **WhatsApp** →
  `openWhatsApp(phone,msg)`; **Log** → the existing log-contact wizard (`openConModal`/
  `modals-log-call.js`) prefilled with this client/sale (which already stamps `agent_id=S.userId`
  + `project_id`). Logging a promise/visit from here flows straight into Team Performance.
- **"Escalate / Legal" section:** Tier C collapsed below the call list ("12 accounts past the
  90-day cutoff — review for legal/field"), each with `suggested_action`.
- **Render-gate / empty:** `NX.empty` with the chip pulse. Distinguish three empties honestly:
  (a) no assigned project → "Ask your admin to assign you to a project" (the BLOCKER-1 message,
  reused); (b) assigned but nothing due → "All clear — no overdue accounts in your projects today";
  (c) load failure → banner + retry. Never a silent blank.

---

## PART 2 — ALERTS ENGINE (register #6)

### 2.1 Recommendation on the generation mechanism

**Hybrid, reusing what exists — do not build a new notifications table or scheduler:**

- **In-app alerts = computed-on-read** off `get_recovery_queue` (+ existing readers). No staleness,
  reconciles to source, zero new infra. The queue *is* the officer's alert inbox; its counts feed
  badges.
- **Outbound alerts (leave the app) = pg_cron → `enqueue_message()` → `message_log` →
  `comms-dispatch`** (the pipeline that already works). Only **one new cron** (daily digest);
  promise/PDC client reminders ride the existing `enqueue_due_comms` path.

This matches the codebase's own split: `get_daily_collections` (read-time) vs.
`cron_expire_subscriptions` / `cron_weekly_digest_all` (scheduled outbound).

### 2.2 Alert types → source → surface → mechanism

| Alert | Audience | Source / formula | Surface | Mechanism |
|---|---|---|---|---|
| Promise due today | officer | R2 | Queue (Tier A) + Inbox badge | computed-on-read |
| Promise broken | officer | R1 | Queue (Tier A) + Inbox badge | computed-on-read |
| PDC maturity (today/tmrw) | officer / accounts | R3 | Queue (Tier A) + Inbox badge | computed-on-read |
| 90-day cross | officer + admin | R4 → PAST-CUTOFF | Queue (escalate section) + admin dashboard | computed-on-read |
| No-contact (quiet) | officer | R7 | Queue (Tier B) | computed-on-read |
| Big payment received | officer + owner | `payments` insert today with `amount ≥ company config (e.g. ≥ P95 or ≥ 500k)` | Daily digest line + dashboard "today" | digest (cron) + optional read on dashboard |
| **Owner 8am digest** | owner / admin | yesterday collections + today due + broken promises + PDCs due (see 2.3) | WhatsApp (+ optional email) + dashboard panel | **NEW** `cron_daily_digest_all` |

**In-app badge upgrade (small):** change Inbox/queue badge from `alrt = overdueN` (`ui.js:424`) to
`counts.tier_a` from `get_recovery_queue` (urgent count), so the badge means "things needing action
today," not "all overdue units." Dashboard "Who is late" already exists — link its rows into the
queue.

### 2.3 Owner 8am daily digest — NEW (the one genuinely new cron)

- **New cron job** `daily-recovery-digest` — schedule `0 3 * * *` UTC = **08:00 Asia/Karachi**.
- **New builder** `cron_daily_digest_all()` — a near-clone of `cron_weekly_digest_all()` (same
  per-company loop, same `enqueue_message(category:'daily_digest')` to the owner's phone), but the
  body is the daily summary, composed from **existing readers** (zero new math):
  - **Yesterday's collections** ← `get_daily_collections(company, NULL, yesterday, yesterday)`
  - **Due today** ← `get_today_snapshot(company)` (GROSS Σ amount_due due today — already built)
  - **Broken promises (count + Σ)** ← `payment_promises` R1 aggregate
  - **PDCs due today** ← `pdc_cheques` R3 aggregate
  - **Big payments yesterday** ← `payments` ≥ config
- **Surface:** WhatsApp via the comms pipeline (proven) + an existing dashboard panel can read the
  same numbers live. Email optional (the `send-*` edge fns exist).
- **Justification:** reuses `enqueue_message` + `get_daily_collections` + `get_today_snapshot`; the
  only new artifact is the digest text builder + one cron row. Same bar as the weekly digest.

> **Note:** a *weekly* at-risk digest already ships (`cron_weekly_digest_all`, by health score).
> The daily digest is operational (cash + today's actions); the weekly stays strategic (at-risk
> accounts). Keep both; they don't overlap.

### 2.4 What we deliberately do NOT build

- No new `notifications`/`alerts` table — `recovery_radar_logs`, `message_log`, and computed-on-read
  cover every case; a new table would be a third source of truth to reconcile.
- No new dispatch worker — `comms-dispatch` (every 2 min) already sends `message_log`.
- We do **not** resurrect the radar as a second ranked UI; it stays the nightly propensity/health
  feeder. (Optional later: a thin `get_radar_latest` reader if the owner wants the propensity view
  too — flagged, not in this build.)

---

## 3. Ground-truth anchor — one real FG client, hand-computed

**Client:** `SHUKAR ULLAH` (KBH-C-0037), sale `06d5641e…`, Fourteen Group. Pulled live:

| Field | Value (source) |
|---|---|
| Outstanding | **8,115,720** (`Σ amount_due−amount_paid`, unpaid installments) |
| Overdue amount | **6,109,716** (same, `due_date < today`) |
| Oldest overdue | **957 days** (`today − MIN(due_date)` over unpaid — = `get_recovery_position.overdue_days`) |
| Paid % | **23.5%** (`Σ amount_paid / Σ amount_due`) |
| Last payment | **2025-11-01** (`payments`) |
| Last contact | **NULL** (`contact_logs` — none in FG) |
| Promise / PDC / health | none (FG has 0 of each) |

**Reason evaluation:**
- R1 broken promise — **no** (no promises). R2 promise-due — **no**. R3 PDC — **no**.
- R4 90-day approaching — **no**: 957 > 90 → not "approaching", it has **crossed**.
- R5 new overdue — **no** (957d).
- R6 high-recoverable — amount qualifies (6.1M, top band) **but** propensity weak: 23.5% paid, no
  health row → fallback propensity ≈ 24 (< 60). Borderline; the **PAST-CUTOFF** flag dominates.
- R7 no-contact — **yes** (last_contact NULL).
- **PAST-CUTOFF / DEAD — yes** (957 > 90, paid 23.5% low).

**Placement:** **Tier C — Escalate / Legal**, *not* the top of the call list.
`priority = 10000 (Tier C base) + amount_pts`. `amount_pts = LEAST(100, ROUND(6,109,716/100000)) =
61` → **priority ≈ 10061**. Chips shown: `[⚖ Past 90-day cutoff] [📵 No contact] [💰 PKR 6.1M]`.
`suggested_action = legal_notice` (radar ladder: >90d → legal notice).

**Why this is the correct, honest result:** a 957-day defaulter who has paid 23.5% and never been
contacted is **not a "call this morning" lead** — they are a legal/field matter. The two-tier model
puts them in the Escalate section with PKR 6.1M flagged, while reserving the officer's Tier-A/B call
time for fresh, collectible, promise/PDC-driven accounts. A naïve "rank by overdue amount" would
have wrongly put SHUKAR ULLAH at #1 of the call list.

**Tier-A demonstration (FG has no fresh promise/PDC data):** verified separately in the
recovery-fix phase on ZZTEST3 — an officer logged a promise + field visit + escalation that now
attribute correctly; such a client (promise broken 3d ago, contacted 21d ago, 45-day overdue) would
score `Tier A base 30000 + R1 500 + amount_pts` → top of the call list with chips
`[⛔ Broken promise][📵 No contact 21d]`. This is the path FG enters once officers work the tools.

---

## 4. New RPC / cron summary (minimal set)

| Artifact | Type | Justification |
|---|---|---|
| `get_recovery_queue(company,officer,project,date,limit)` | NEW read RPC | the live officer-scoped urgency queue; reconciles to `get_recovery_position`; one gate, no table |
| `cron_daily_digest_all()` + `daily-recovery-digest` cron (08:00 PKT) | NEW builder + 1 cron row | owner 8am digest; reuses `enqueue_message`+`get_daily_collections`+`get_today_snapshot` |
| Inbox badge → `counts.tier_a` | JS change | badge means "act today", not raw overdue count |
| Legal-Cases hidden from recovery | JS change (§1) | role correctness |
| *(optional, flagged)* `get_radar_latest()` reader | future | only if owner also wants the propensity view in-app |

No new tables. No changes to credential tables. Additive cron only.

---

## 5. Build order — recommendation

1. **Subah Ki List first** (`get_recovery_queue` + the queue page + Inbox-badge swap + the Legal
   hide). **All data exists**, it's computed-on-read (no scheduling infra), and it is the single
   highest-impact deliverable — it turns the now-fixed recovery substrate into an officer's daily
   driver. Verifiable instantly against `get_recovery_position`.
2. **Owner 8am digest second** (`cron_daily_digest_all`). Small, but needs the cron + WhatsApp
   path live-tested (reuses proven pipeline). Independent of #1.
3. **Big-payment + dashboard alert polish third** (digest line + dashboard read). Lowest urgency.

Rationale: #1 is pure read-layer over existing truth (fast, safe, huge impact); #2 touches the
outbound pipeline (slightly more care); #3 is polish. The radar/health crons keep running untouched
as the propensity feeder throughout.

---

## 6. Assumptions & flags (for owner sign-off)

- **A1 — N (no-contact) = 14 days, 90-day window = 75–90, big-payment = ≥500k.** All proposed as
  company-configurable constants; confirm defaults.
- **A2 — Campaigns/Legal reachability:** §1 hides **Legal** from recovery as instructed; **Campaigns**
  stays reachable for recovery (from the last phase). Confirm that's still desired.
- **A3 — Tier weights** (Tier A reason ranks, Tier B 0.50/0.30/0.20) are a first proposal; tune
  after the owner sees the live list against real FG ordering.
- **A4 — FG is a legacy dead-book today** (0 promises/PDCs/contacts/health). The queue will read
  mostly as an Escalate/aging list for FG until officers start logging; that is correct, not a bug.
- **A5 — Radar retirement:** we keep `generate_recovery_radar`/health crons as the propensity
  feeder but do **not** surface the radar as a rival list. If the owner wants the "likely to pay"
  view too, that's the optional `get_radar_latest` reader (out of this build's core).
- **A6 — Propensity when `client_health_scores` is empty** (FG case): fall back to `paid_pct` then
  a neutral 40. Confirm acceptable, or trigger a one-off `recalculate_all_health_scores(FG)` first.

**No code written. Plan → owner review → build (Subah Ki List first).**
