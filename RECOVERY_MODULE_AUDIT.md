# Recovery Module — End-to-End Workday Audit

**Date:** 2026-06-14  **Auditor seat:** Recovery Officer (lived one full workday)
**Mode:** READ-ONLY on Fourteen Group (KBH). Live walkthrough on a scratch tenant.
**Scratch tenant:** ZZTEST3 ("ZZTEST3 Tower", company `1bf387f4…`, Ultimate plan — all recovery
feature flags ON). Driven through the **real UI** via headless Chrome/puppeteer against the
production Supabase (`itqxljtfbrppntgyfush`). FG data never touched.

> This is not a reskin check. The question was: **does the recovery chain work as a living
> system** — can a recovery officer log in, find who to call, log a call / promise / visit /
> escalation / payment, and does every action attribute back to them on the Team Performance
> scoreboard? **Answer: No. The module is a set of partly-disconnected pages, not a living system.**

---

## 1. Executive verdict

A freshly-created recovery officer **cannot do their job out of the box, and several core
recovery actions are broken for everyone (admins included).** Of the six core-loop actions:

| Core action | Works for a new recovery officer? | Attributes to them on scoreboard? |
|---|---|---|
| Log a call (Inbox) | ❌ blocked → ✅ only after a hidden DB setup step | ✅ (calls = correct) |
| Record a payment | ❌ blocked → ✅ after setup step | ⚠️ by project, not by who recorded it |
| Log a payment promise | ❌ blocked → ✅ after setup step | ❌ **always reads 0** |
| Mark a promise **kept** | ❌ **impossible** (NULL project) | ❌ |
| Log a field visit | ❌ **page unreachable + RPC 404 (broken for all)** | ❌ |
| Open an escalation | ❌ **page unreachable + RPC 404 (broken for all)** | ❌ |

The "hidden setup step" is **assigning the officer to a project** — and **there is no UI anywhere
in the product to do it.** Without it, every recovery write returns `project_not_assigned` and the
officer's morning work-queue is empty.

**Three system-level failures stack on top of each other:**

1. **No project-assignment UI exists** → new officer is locked out of the entire recovery loop.
2. **The recovery role's own sidebar advertises pages the nav gate blocks** (Field Visits is in
   the sidebar but bounces to Dashboard); Follow-ups/Escalations/Campaigns/Legal are unreachable.
3. **The pages and the scoreboard are wired to different attribution keys**, and two write RPCs
   (`log_field_visit`, `create_escalation`) are called with a signature that no longer exists →
   the scoreboard is blind to promises, visits, and escalations even when an officer does the work.

---

## 2. The recovery-role surface map (what the officer actually sees & can reach)

Created via the real **Users & Roles → Add user** modal as role `recovery`, then logged in as
`zzrbilal@zztest3`. Live probe of every nav target (`nav('x')` → which page actually rendered):

| Sidebar item shown to recovery | Clicking it lands on | Verdict |
|---|---|---|
| Dashboard | dashboard | ✅ |
| Units (+ Transferred/Cancelled in "More") | units | ✅ |
| Sales | sales | ✅ |
| Clients | clients | ✅ |
| **Payments** (Recovery queue) | recovery | ✅ reachable (but empty — see §4B) |
| PDC | pdc | ✅ |
| Reminders | reminders | ✅ |
| **Field Visits** | **dashboard** | ❌ **BOUNCES — advertised but dead** |
| Receipt Vouchers / Ledgers / Payment Links ("More") | receipts / ledgers / paylinks | ✅ |
| Inbox | contacts | ✅ |

Pages **not** in the recovery sidebar and blocked by the nav gate (all bounce to dashboard):
`promises` (Follow-ups), `escalations`, `campaigns`, `legalcases`, plus correctly-restricted
admin pages (`team`, `users`, `admin`, `reports`).

**Root cause (code):** `js/ui.js` defines the recovery sidebar (`isR` branch, ~line 519) which
*includes* Field Visits, but the nav permission gate's `allow.recovery` allow-list (~line 797)
does **not** include `fieldvisits`, `promises`, `escalations`, `campaigns`, or `legalcases`, and
`hasPermission()` role defaults (`js/helpers.js:257`) don't grant them either. The sidebar and the
gate are maintained from two different lists that have drifted apart. The admin's own Recovery menu
lists Follow-ups, Campaigns, Field Visits, Escalations and Legal Cases — so these *are* recovery
features; the recovery role simply can't reach them.

---

## 3. Permission correctness (Part E — can they see/do the wrong things?)

- **Over-permission:** none found. `team`, `users`, `admin`, `reports`, `projects`, `agents` all
  correctly bounce to dashboard for the recovery role. Server RPCs (`get_team_performance`,
  `create_app_user`, …) re-check admin server-side.
- **Under-permission (the problem):** the role is restricted **below what the job needs** —
  Follow-ups/Promises, Field Visits, Escalations are recovery work but are unreachable.

---

## 4. The lived workday — step-by-step PASS/FAIL

### A. Setup reality — admin creates a recovery user
| Step | Result |
|---|---|
| Owner logs in, opens Users & Roles, fills Add-user modal (role `recovery`), submits | ✅ PASS — user `zzrbilal` created, synthetic email `zzrbilal.zztest3@users.internal`, on-screen username shown |
| New user can log in | ✅ PASS — logs in as `zzrbilal@zztest3`; first login correctly forces a password change (`needs_password_reset=true`) |
| Create flow offers a **project assignment** | ❌ **FAIL** — no project field in the modal; `create_app_user` takes no project param; `user_project_assignments` left empty (0 rows) |

### B. The morning — find who to call today
| Step | Result |
|---|---|
| Open Payments (Recovery queue) | ⚠️ **FAIL** — shows *"No overdue units — all installments are current"* and all aging buckets `0`, **despite 9 real overdue installments** in the project. The queue is project-scoped and the new officer is assigned to no project, so it is empty. |
| Dashboard money picture | ⚠️ Inconsistent — Dashboard shows **15.0M receivable / 3.6M overdue / 24%** company-wide, while the actionable queue shows 0. The officer is told "3.6M overdue" but handed an empty call list. |

### C. The core loop (each action driven against the server contract the page uses)

Phase 1 = officer as-created (no project assignment). Phase 2 = after manually inserting a
`user_project_assignments` row (simulating the missing setup UI).

| Action | Phase 1 (as created) | Phase 2 (project assigned) |
|---|---|---|
| **Log a call** `create_contact_log` | ❌ `project_not_assigned` | ✅ success — `agent_id` & `created_by` = officer UUID, `project_id` set |
| **Record a payment** `record_payment_simple` | ❌ `project_not_assigned` | ✅ success — `created_by` = officer UUID |
| **Log a promise** `log_payment_promise` | ❌ `project_not_assigned` | ✅ row created — **but `logged_by` = username string, `project_id` = NULL** |
| **Mark promise kept** `mark_promise_kept` | — | ❌ `project_not_assigned` — *the promise's `project_id` is NULL, and the RPC treats NULL project as "not assigned"* |
| **Mark promise broken** `mark_promise_broken` | — | ✅ success — *(no project gate at all — asymmetric with "kept")* |
| **Log a field visit** `log_field_visit` | ❌ **PostgREST 404** — function signature not found | ❌ **PostgREST 404** (same — broken regardless of role/permission) |
| **Open an escalation** `create_escalation` | ❌ **PostgREST 404** — function signature not found | ❌ **PostgREST 404** (broken regardless of role/permission) |

Exact errors (verbatim from the live session):
```
log_field_visit  → Could not find the function public.log_field_visit(p_address, p_amount_collected,
                   p_client_id, p_company_id, p_gps_lat, p_gps_lng, p_notes, p_officer_name, p_outcome,
                   p_payment_method, p_promise_date, p_promised_amount, p_visit_date) in the schema cache
create_escalation → Could not find the function public.create_escalation(p_assigned_to, p_category,
                   p_client_id, p_company_id, p_created_by, p_description, p_escalation_level) in the schema cache
```
The DB only has `log_field_visit(p_company_id, p_data jsonb)` and `create_escalation(p_company_id,
p_data jsonb)`. `js/pages/fieldvisits.js` and `js/pages/escalations.js` call them with flat,
out-of-date parameter lists → **field-visit and escalation logging are broken for every role,
including admin.** This matches the production reality: `field_visits` and `escalations` both have
**0 rows** company-wide.

### D. The attribution proof — Team Performance (logged in as owner)

After the loop (with the officer project-assigned), the **Team Performance** scoreboard showed for
**ZZR Bilal Recovery** (raw `get_team_performance` + on-screen, both agree):

| Metric | Officer actually did (verified in DB) | Scoreboard shows | Verdict |
|---|---|---|---|
| Calls | 2 logged | **2** | ✅ MATCH |
| Recovered | PKR 200,000 (2 payments) | **PKR 200,000** | ✅ MATCH (via project assignment) |
| Promises made | 3 logged successfully | **0** | ❌ **MISMATCH** |
| Promises kept / keep-rate | (kept blocked; 2 broken) | 0 / `—` | ❌ blind |
| Field visits | attempted (404) | **0** | ❌ can't create |
| Escalations | attempted (404) | **0** | ❌ can't create |

**Why promises read 0:** `get_team_performance` counts promises with
`logged_by = <user-uuid>::text` **AND** `project_id = ANY(assigned projects)`. Every promise row
created through the UI has `logged_by` = a **name/username string** (the form prefills
`S.username`) and `project_id` = **NULL** (`log_payment_promise` never sets it). Both join keys
miss → the headline recovery KPI (promise keep-rate) is structurally always zero.

**Calls work** only because the call-log modal stamps `agent_id = S.userId` (the app-user UUID,
which is exactly what the scoreboard matches) and `create_contact_log` enriches `project_id` from
the unit. So the *correct* pattern already exists in one place — it just isn't used by the others.

### E. Gaps & dead-ends (summary)
- New officer: empty work-queue, every write blocked, no self-service way to fix it.
- "Field Visits" is a dead sidebar entry.
- Promises can be **broken** but never **kept** by an officer (NULL-project asymmetry).
- Promise/visit/escalation activity is invisible on the scoreboard.
- Minor: a `403` resource error fires on recovery-role page loads (a cache/RPC the role lacks a
  grant for); non-fatal but noisy — worth a follow-up.

---

## 5. Prioritized fix list

### 🔴 BLOCKER
1. **No project-assignment UI** — `create_app_user`/Users & Roles never assign a project;
   `user_project_assignments` is empty system-wide, and every non-admin recovery RPC requires an
   active assignment. Add project selection to the user create/edit modal (write
   `user_project_assignments`). Until then, every new recovery officer is fully locked out.
2. **`log_field_visit` is broken for all roles** — `js/pages/fieldvisits.js:324` calls a flat
   signature that doesn't exist; DB only has `(p_company_id, p_data jsonb)`. Field visits can never
   be logged (table = 0 rows in prod). Fix the JS to send `{p_company_id, p_data:{…, officer_id:S.userId}}`.
3. **`create_escalation` is broken for all roles** — `js/pages/escalations.js:356` calls a
   non-existent flat signature; DB expects `(p_company_id, p_data jsonb)`. Escalations can never be
   opened from the page (table = 0 rows). Fix the JS payload **and** pass `escalated_by:S.userId`.
4. **Recovery role can't reach its own pages** — Field Visits is in the recovery sidebar but the
   nav gate (`allow.recovery`, `ui.js:797`) and `hasPermission` defaults omit `fieldvisits`,
   `promises`, `escalations`, `campaigns`, `legalcases`. Add the intended recovery pages to the
   allow-list (and to the sidebar where missing, e.g. Follow-ups), or remove Field Visits from the
   sidebar. Sidebar and gate must be driven from one list.

### 🟠 MAJOR
5. **Promises never attribute to the officer** — `log_payment_promise` stores `logged_by` = a free
   text name (form prefill) and never sets `project_id`, but `get_team_performance` matches
   `logged_by = uuid` AND `project_id`. Stamp `logged_by` server-side from `_rms_caller().id` and
   set `project_id` (it is already computed in the RPC for the auth check). Keep-rate is the
   module's headline metric and is structurally 0 today.
6. **Officers can mark promises broken but never kept** — `mark_promise_kept` rejects when the
   promise's `project_id` is NULL (treats NULL as not-assigned), which is the normal case;
   `mark_promise_broken` has no such gate. This biases keep-rate downward and blocks the positive
   outcome. Set `project_id` on promises (fix #5) and/or align the two RPCs' permission logic.
7. **Empty recovery queue vs. non-empty dashboard** — the officer is told "3.6M overdue" on the
   dashboard but shown an empty call list. After fix #1 the queue populates, but the two surfaces
   should be reconciled (both should respect the same project scope and show the same picture).
8. **Attribution keys are inconsistent across the app** — calls use `agent_id`; the personal
   dashboard uses `recovery_agent_id`/`created_by` (`dashboard.js:646`); Team Performance uses
   `agent_id`/`logged_by`/`officer_id`/`escalated_by`; collections use project-assignment. Pick one
   officer-stamping convention (caller UUID, server-set) and apply it to every write.

### 🟡 MINOR
9. Collections on the scoreboard attribute by **project assignment**, not by who recorded the
   payment (`get_team_performance` comment: "receipts are not yet stamped"). Two officers on the
   same project get identical "recovered" numbers. Consider per-`created_by` attribution.
10. `log_payment_promise` side-inserts a `contact_logs` row with **no `agent_id`** → promise-driven
    contacts are unattributed in the Inbox/Team views.
11. `403` resource error on recovery-role page load — investigate the missing grant.
12. First-login forced password change works (good); no change needed — noted as PASS.

---

## 6. Evidence index

Screenshots: `migration_work/recovery_audit/shots/`
`A0_owner_dashboard`, `A1_users_list`, `A2_create_modal`, `A3_after_create`,
`B0_rec_dashboard`, `B1_payments_queue` (empty queue), `B2_inbox`,
`B3_fieldvisits_attempt` (bounced to Dashboard), `D1_team_performance`.

Repro scripts: `migration_work/recovery_audit/` — `lib.js`, `a_owner_create.js`,
`b_recovery_surface.js`, `c_core_loop.js` (`phase1`/`phase2`), `d_team.js`.

Key live outputs:
- Nav bounce: `{promises, fieldvisits, escalations, campaigns, legalcases} → dashboard`.
- Phase-1 writes: call/payment/promise = `project_not_assigned`; visit/escalation = PostgREST 404.
- Phase-2 writes: call/payment/promise = success; visit/escalation still 404; `mark_promise_kept`
  = `project_not_assigned` (NULL project); `mark_promise_broken` = success.
- DB after loop: contact_logs attributed to officer UUID ✅; payments `created_by` = UUID ✅;
  payment_promises `logged_by` = name string & `project_id` NULL (0 of 4 attributable) ❌;
  field_visits 0; escalations 0.
- Team Performance for the officer: calls 2 ✅, recovered 200,000 ✅, promises_made 0 ❌,
  visits 0 ❌, escalations 0 ❌.

## 7. Cleanup
Scratch artifacts created in ZZTEST3 (clients `ZZR-*`, sales `ZZR-*`, their installments, the PDC,
the test promises, contact logs, payments, the `zzrbilal` user + its project assignment) are test
data in a sanctioned scratch tenant. See the cleanup note at the end of this session. **Fourteen
Group / KBH was never modified.** No fixes were applied — audit only.
