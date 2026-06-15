# Recovery Officer — "Do I Know What To Do?" Audit
**2026-06-16 · READ-ONLY · the officer's GUIDED experience, traced through real code + live KBH data**

Two prior audits (`RECOVERY_AUDIT.md`, `RECOVERY_MODULE_AUDIT.md`) fixed the **plumbing** — the data
loop, reachability, attribution, the bell. Those blockers are shipped (project-assignment UI,
`fieldvisits`/`promises`/`escalations` now reachable, promises attribute, bell live).

**This audit asks the next question — the one you asked:** when a recovery officer logs in, do they
actually *know* — without being told — **what their job is, where to start, who to call, where to log
it, where the alerts are, where the notifications are?** Traced file-by-file, grounded on live KBH
(`3249e3b5…`, ₨212M overdue / 139 units).

---

## TL;DR
The guided experience **largely already exists and is genuinely good** — the recovery officer's home
is a purpose-built **"My Day"** (`dashboard.js → _dashStaff`, role-dispatched at `dashboard.js:95`),
not the admin command-center. It answers most of your questions. **But three things stop it from
feeling alive**, and they're the gap between "the tools exist" and "the officer *knows what to do":**

1. **The single best 'your job + your numbers' page — "My Recovery" — is NOT in the sidebar.** It's
   reachable only via two dashboard buttons. An officer who clicks away can't find it in the menu.
2. **Alerts/notifications are under-surfaced AND empty in practice.** The bell is a small topbar icon,
   it shows **0** for KBH (because the team logs no promises/follow-ups), and there is no labelled
   "Alerts" panel on the home. *That's exactly why you had to ask "where are the alerts?"*
3. **The whole guided system runs on inputs nobody enters.** The loop plumbing works, but adoption is
   ~0 (`payment_promises`=0, `contact_logs`=1, `follow_up_reminders`=0 across all tenants). So the
   "YOUR DAY" steps 2–4 and the bell render **0** — the page looks half-empty, not because it's
   broken, but because the call→log→promise→follow-up loop is never *fed*. No first-run coaching
   teaches a new officer the loop.

So: **not a broken module — a discoverability + adoption + orientation gap.** Fixes are small.

---

## The officer's day, mapped to your six questions

| Your question (Roman-Urdu) | Where it lives in the UI | Verdict |
|---|---|---|
| **"Mera kaam kia hai?"** (what's my job) | `_dashOffMission` — greeting + **"N accounts to call today · X overdue"** + a **"Y of N contacted today"** progress bar (`dashboard.js:735`) | ✅ **Clear** — the day's job is stated in one line, with progress. |
| **"Kahan se shuru karun?"** (where to start) | **"① START HERE — your most urgent call"** (`_dashOffNext`, `dashboard.js:759`) — the #1 account, full context. | ✅ **Excellent** — literally labelled "Start here". |
| **"Kis ko call karun?"** (who to call) | START HERE shows the top account; **Morning List** (`get_recovery_queue`) is the full tiered list. Live: **162 accounts**, top = *AZMAT KHAN, Tier A, ₨2.33M, "90-day cutoff approaching · No recent contact"*. | ✅ **Real & prioritised** — but ⚠️ some accounts have broken phone data (AZMAT KHAN's phone = `"03"` → "Call now" `tel:` link is dead for them). |
| **"Call kahan log karun?"** (where to log) | **"Log the outcome"** on START HERE → `openConModal(unit_id)`; also "Log a call" in **My Tools** and the **Inbox**. The modal is a real flow: outcome → promise (amount+date) → next follow-up (`modals-log-call.js`). | ✅ **Strong** — one button from the call, captures promise + next follow-up. |
| **"Alerts kahan check karun?"** (where are alerts) | **Topbar bell** (`NXBell`, `recovery-bell.js`, mounted `login.html:1309`) + the **"YOUR DAY"** step counts (promises due / reminders due). | ⚠️ **GAP** — bell is a tiny topbar icon; shows **0** for KBH; no labelled "Alerts" surface on the home. (You asking "where?" *is* the finding.) |
| **"Notifications kahan?"** (where notifications) | Same bell. `platform_notifications` table exists but is **unused/empty**; nothing is generated; no notification inbox, no push. | ⚠️ **GAP** — there is effectively no notification system, just the live-derived bell. |

### The four-step spine (already built — `_dashOffSteps`, `dashboard.js:795`)
**① Call your list** (`queue`) · **② Check promises** (`promises`) · **③ Send reminders**
(`reminders`) · **④ Escalate stuck** (`escalations`) — each a count + a click-through. This is the
clearest articulation of "what to do" in the product. **But ②③④ show 0** because the inputs are never
entered (adoption), so the spine looks inert.

### My Tools (already built — `_dashOffTools`, `dashboard.js:813`)
Every action in one grid: My recovery report · Log a call · Record a payment · Morning List ·
Reminders · Promises · Field visits · Escalations · Call logs. ✅ Good — "nothing to hunt for" — **but
this grid (and two Mission buttons) are the *only* way to reach "My Recovery".**

---

## The real gaps (deep, specific)

### 🔴 G1 — "My Recovery" is invisible in the menu
`get_officer_recovery` powers the officer's best sheet — *this month's target / recovered / still-owed
(clickable KPIs) + an AI brief + a "Who to call" table with Call/WhatsApp/Log per row + propensity +
white-A4 print* (memory `my_recovery_officer_report`). It is **allowed** by the nav gate
(`ui.js` `allow.recovery` includes `'myrecovery'`) **but is NOT a sidebar item** in the recovery
`isR` nav (`ui.js:525–537` — the Recovery group lists Morning List/Payments/PDC/Follow-ups/Reminders/
Field Visits/… but **not** My Recovery). So the one page that most directly answers *"what's my job and
how am I doing"* can only be reached from the dashboard, and vanishes the moment the officer navigates
away. **Fix: add "My Recovery" to the recovery sidebar (top of the Recovery group).** One line.

### 🔴 G2 — Alerts/notifications are under-surfaced and empty
- The bell is correct but **low-discoverability** (small topbar glyph) and **`get_recovery_alerts`
  returns total = 0 for KBH** — verified live — because it only fires on promises/follow-ups/PDC
  events, and the team logs none. So an officer staring at ₨212M overdue sees an **empty bell**.
- There is **no on-home "Alerts / Needs attention" panel** and **no persistent notification center**
  (`platform_notifications` unused).
- **Fix options:** (a) put a visible **"Needs attention"** panel on the My-Day home that shows the bell
  items inline (so it's not hidden in the topbar); (b) widen what counts as an alert so it isn't empty
  when nothing's logged — e.g. *"X accounts not contacted in 14+ days"*, *"promise overdue"*; (c)
  label the bell ("Alerts") so officers know what it is.

### 🟠 G3 — The loop is never fed (adoption), so the guidance looks inert
Plumbing works; usage is ~0 (`payment_promises`=0, `contact_logs`=1, `follow_up_reminders`=0). The
guided dashboard's power (steps, bell, propensity, keep-rate) only appears **after** officers log
calls/promises. A brand-new officer sees mostly zeros and **no orientation** explaining the loop.
**Fix: a first-run "coach" card** — *"Your recovery day: ① call the red account ② log the outcome
③ set a promise date ④ we'll remind you when it's due ⑤ escalate if it breaks"* — shown until the
officer logs their first call. Turns "tools exist" into "I know the routine."

### 🟡 G4 — Smaller, real
- **Dead "Call now" on incomplete phones** (AZMAT KHAN `"03"`). Flag un-callable accounts ("no phone —
  field visit?") instead of a broken `tel:`.
- **Mission/queue vs bell scope:** the My-Day queue is officer/project-scoped server-side (good); the
  bell is too (prior fix). Consistent — noted as PASS, just confirming.
- **`platform_notifications` dead table** — either wire it (G2) or drop it; right now it implies a
  notification system that doesn't exist.

---

## What I'd build (prioritised — pick and I'll do it)
1. **G1 — My Recovery in the sidebar** (1-line nav add). *Highest value / lowest cost.*
2. **G2 — "Needs attention" panel on the My-Day home** (render the bell's alert items inline) **+**
   widen alerts to include *"not contacted in N days"* so it's never falsely empty.
3. **G3 — first-run recovery coach** (an empty-state card teaching the 5-step loop, dismiss after first
   logged call).
4. **G4 — un-callable-account handling** (no-phone badge + "log field visit" CTA instead of dead `tel:`).

> Verdict: the recovery officer's guided home is **80% there and well-designed** — the prior audits
> built the engine. The remaining 20% is **making the best page findable, making alerts visible and
> non-empty, and coaching the loop on day one** — i.e., turning a strong but quiet dashboard into one
> the officer can't misread.

---

### Evidence index
- Role dispatch → guided view: `dashboard.js:90–95` (`effectiveRole` → `_dashStaff`).
- Guided home: `_dashStaff` `dashboard.js:691`; Mission `:735`; **START HERE** `:759`; steps `:795`;
  tools `:813`.
- Morning List queue (live, impersonated FG owner): `get_recovery_queue` → 162 rows, top AZMAT KHAN
  Tier A ₨2,326,400, reasons R4/R7; phone `"03"`.
- Bell: `recovery-bell.js` (`get_recovery_alerts`), topbar mount `login.html:1309`; live `total = 0`.
- Call logging: `modals-log-call.js` `openConModal` — outcome→promise→follow-up.
- Nav: recovery sidebar `ui.js:525–537` (no `myrecovery`); gate `allow.recovery` includes `myrecovery`,
  `promises`, `fieldvisits`, `escalations`, `campaigns`.
- Adoption: prod tables `payment_promises`=0, `contact_logs`=1, `follow_up_reminders`=0 (per
  `RECOVERY_AUDIT.md`, unchanged).
</content>
