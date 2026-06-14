# Recovery System — Deep Audit (2026-06-14)

Read-only audit of the whole recovery workflow: **promises · calls · follow-ups · reminders · alerts/notifications · escalations**. Verified against live code + the production DB (KBH/Fourteen Group `3249e3b5…`) + a live impersonated write test on ZZTEST.

## THE BIG TRUTH
Every piece **works individually** (writes verified, RPCs attribute project_id + caller). But the **loop is broken at the surfacing layer** — actions get *captured* and then **never come back to the officer**. So despite KBH carrying **₨212.6M overdue / 139 units**, the entire workflow is essentially **unused**:

| table | rows (all tenants) |
|---|---|
| payment_promises | **0** |
| contact_logs (calls/followups) | **1** |
| follow_up_reminders | **0** |
| reminder_logs | 0 · escalations 0 · field_visits 0 · platform_notifications 0 · campaigns 0 |

It is **not broken code — it's a broken feedback loop + heavy fragmentation.** Recovery is *over-built and under-connected*.

## 🔴 P0 — why nobody uses it (loop-breaking)
1. **Follow-up black hole.** Every Log-Call writes a `follow_up_reminders` row (officer's "follow up on the 20th"). **Nothing reads that table** — not Reminders, not Subah-ki-List, not the dashboard (verified: only references in code are the INSERT + the audit-log list). The officer's own follow-up vanishes forever.
2. **Promises never alert.** `payment_promises.promise_date` exists, but there is **no "promise due today / promise broke" actionable surface**. The Promises page is a passive register; nothing pushes a due promise at the officer.
3. **No in-app notification/alert system.** `platform_notifications` table exists but is empty + never generated. The "bell" icon is just the Reminders nav label. No alerts for: promise due, promise broken, follow-up due, PDC maturing/bounced.

## 🟠 P1 — fragmentation (the cause of the above)
4. **"Promise" means 3 different things:** `payment_promises` (proper) vs `contact_logs.next_followup_date` (what the dashboard "Promises due" actually counts) vs `follow_up_reminders` (orphan). No single source of truth.
5. **Reminders = 4 silos:** `follow_up_reminders`, `reminder_logs`, `promise_reminders_log`, `payment_link_reminders`. The Reminders page (`get_reminders_page_data`) only shows `reminder_logs` (SMS dispatch) + due installments + PDC — the other 3 are invisible.
6. **2 promise-create RPCs + 18 promise functions.** `create_payment_promise` (call modal) vs `log_payment_promise` (promises page) — both DO derive project_id correctly (verified live), but it's redundant. 18 promise fns (create/log/update/cancel/mark-kept/mark-broken/postpone/auto-break/…) = heavy overlap.

## 🟡 P2 — robustness / attribution
7. **Silent-fail in Log-Call.** The promise + follow-up inserts are `try/catch → console.warn` only. If they fail, the user still sees "Contact logged ✓" while the promise/follow-up is silently lost.
8. **`mark_promise_broken` → escalation WITHOUT project_id** (column list omits it) — auto-escalations from broken promises won't attribute to a project (same bug class the module audit fixed elsewhere).

## ✅ What works (verified)
- `create_contact_log`, `create_payment_promise`, `log_payment_promise`, `create_follow_up_reminder`, `create_reminder_log` — all EXIST, write, attribute project_id, gate on caller. **Live write test on ZZTEST: promise created, project_id derived from the sale ✓.**
- `get_recovery_queue` (Subah-ki-List) reads promises + ties to recovery_position.
- Promises page has a full lifecycle (kept/broken/postpone/analytics).

## THE FIX (10x move — wire the loop, don't add features)
**Phase 1 — close the loop (highest impact):** one **"Action Queue / My Day"** per officer that unifies, with today + overdue: follow-ups due (`contact_logs.next_followup` + `follow_up_reminders`), promises due & broken (`payment_promises`), overdue installments, PDC maturing. Surface it on the Reminders page AND as a dashboard count.
**Phase 2 — one notification system:** generate `platform_notifications` on key events (promise due/broken, follow-up due, PDC due/bounced) + a bell with an unread count.
**Phase 3 — de-fragment:** pick ONE promise-create path + ONE follow-up store; deprecate the orphans; fix the Log-Call silent-fails; add project_id to the `mark_promise_broken` escalation.

> Verdict: the plumbing is all there. The win is **connection + one alert surface**, not more tools.

---

## STATUS — fixes shipped (2026-06-14)
- ✅ **P0 loop closed** (`6c04646`, migration `20260614_reminders_followups_promises` LIVE): follow-ups due + promises due now surface as actionable cards on the Reminders page (was a black hole).
- ✅ **P0 notification bell** (`eb31151`, migration `20260614_get_recovery_alerts` LIVE): topbar bell + badge + dropdown of live recovery alerts (promises overdue/due/broken · follow-ups overdue/due); click → unit, footer → Reminders.
- ✅ **P2 silent-fail** (`924f1f2`): Log-Call now warns (toast) if a promise / follow-up insert fails.
- ✅ **P2 attribution** (migration `20260614_mark_promise_broken_project_id` LIVE): auto-escalation from a broken promise now carries project_id.
- ⏳ **DEFERRED (low-risk tech-debt, noted):** orphan `follow_up_reminders` table still written by Log-Call but unread (contact_logs.next_followup is the surfaced source now) — harmless dead weight, can be dropped later. Two promise-create RPCs (create_payment_promise / log_payment_promise) both work + attribute — redundant, can be unified later. The other reminder silos (reminder_logs SMS-dispatch · promise_reminders_log · payment_link_reminders) are distinct concerns, left as-is.

Net: the recovery **loop is connected and there is one alert surface** — the two things that made the system unused. Remaining items are cleanup, not function.

## STATUS — round 2 (officer-scoping + PDC alerts)
- ✅ **Officer-scoping** (migrations `20260614_recovery_alerts_officer_scope` + `20260614_reminders_officer_scope` LIVE): both `get_recovery_alerts` and `get_reminders_page_data` are now caller-aware — admin/owner/super see the whole company; a scoped user sees only the projects assigned to them in `user_project_assignments`. No frontend change. Verified by impersonation: owner→all, officer(0 projects)→0, officer(assigned)→their project only.
- ✅ **PDC alerts in the bell** (migration `20260614_recovery_alerts_add_pdc` LIVE): `get_recovery_alerts` now also surfaces bounced cheques (danger) and PDC overdue/maturing (≤3d). Verified — a bounced cheque shows as "Cheque bounced".
- ⏳ **Remaining:** #3 auto-reminder dispatch (auto SMS/WhatsApp on due promise/follow-up — needs the comms pipeline + a scheduler; cron is postgres-locked so approach TBD); de-fragment cleanup; field-visits/campaigns deeper test.

## STATUS — round 3 (#3 dispatch · Option A)
- ✅ **Officer-triggered tracked reminders** (`8887982`): each Follow-up-due / Promise-due row has a "Remind" button → WhatsApp pre-filled (context Roman-Urdu message) + tracked log (promises via `record_promise_reminder` → bumps count + `promise_reminders_log`; follow-ups via `create_reminder_log`). Verified ZZTEST.
- ⛔ **True unattended auto-blast (cron → bulk WhatsApp): intentionally NOT shipped** — outward-facing sends to real clients must be an explicit owner opt-in (which clients / timing / opt-out / quota), not silent. Human-in-the-loop dispatch only.

### Recovery audit — fully addressed
P0 loop ✓ · P0 bell ✓ · officer-scoping ✓ · PDC alerts ✓ · tracked dispatch ✓ · silent-fail ✓ · escalation project_id ✓. Remaining = pure tech-debt (orphan follow_up_reminders write, 2nd redundant promise RPC) + optional true-auto-blast (owner opt-in) + deeper field-visits/campaigns test.
