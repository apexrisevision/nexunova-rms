# Team Performance — Build Plan (owner review before build)

Read-only inventory + proposal. **No code was changed.** Date: 2026-06-13.

Anchored to live RMS DB (`itqxljtfbrppntgyfush`). All source tables/columns/RPCs below
were verified against the live schema and live FG/ZZTEST data.

---

## 0. Headline finding (read this first)

**The recovery-ops layer is empty across the whole platform.** The real tenant
(Fourteen Group / KBH) has **0 recovery-role officers, 0 calls, 0 promises, 0 field
visits, 0 escalations**, and **every `payments.created_by` is NULL**. ZZTEST has
exactly **1 call** and nothing else. The KBH import loaded only the *financial spine*
(sales, installments, payments, clients) — none of the recovery activity this feature
measures.

Consequences that shape the whole build:
- The **existing Team page already renders empty for FG** (it gates to
  `role IN ('recovery','recovery_officer')`, of which FG has none).
- Report #9 and the dashboard panel will also be **empty for FG** until officers +
  activity exist. They must **render-gate to "hidden when no officers/activity"**, not
  show a sad empty table.
- The **only metric with real FG data is gross collections** (by project/period,
  unattributed to any officer). Everything officer-level must be **verified on seeded
  ZZTEST data** (§6).
- This is itself the most important thing to tell the owner: *the feature is built on a
  substrate that production isn't using yet.* The build should ship the engine **and** a
  short "to light this up, your team must (a) have recovery-role logins and (b) log
  calls/promises/visits, and receipts must carry `created_by`" note.

---

## 1. WHAT EXISTS

**Page:** `js/pages/team.js` → `rTeam()` (route `team`, sidebar "Team Performance",
admin/owner only). Already on the warmth kit (admin batch). Detail uses the shared
`DX.drawer` slide-over + monthly target (`get_officer_target` / `set_officer_target_v2`).

**Feed:** `get_team_performance_lite(p_company_id)` — one RPC, **current calendar month
only**, no period/project params. Officer set = `app_users WHERE role IN
('recovery','recovery_officer') AND status='active'`.

**Returns per officer** (verified from the function body):

| Field | Source | Attribution key | Window |
|---|---|---|---|
| `outstanding`, `overdue` | `installments` (GREATEST(due−paid,0)) | officer's assigned `project_id`s | as-of today |
| `collected_this_month` | `payments` ⋈ `sales` | **by assigned project** (NOT `created_by`) | this calendar month |
| `calls_this_month` | `contact_logs` COUNT | `agent_id = u.id::text` | this calendar month |
| `promises_made / kept / broken` | `payment_promises` | `logged_by = u.id::text` | made=this month; kept/broken=**past-due** cohort |
| `untouched_overdue` | `installments` w/ no `contact_logs` in 14d | by assigned project | as-of today |
| `pending_approvals` | `approval_requests` | `requested_by = u.id` | open |
| `projects` | `user_project_assignments` ⋈ `projects` | — | active |

**Table columns shown:** Officer · Projects · Calls · Promises (kept/broken) · Collected ·
Untouched · Approvals. Drawer adds outstanding/overdue, monthly target/achieved, and
`keptRate = kept ÷ (kept+broken)`.

**What's MISSING (the gap this feature closes):**
1. **No period flexibility** — hard-wired to `date_trunc('month', CURRENT_DATE)`. No
   day/week/month, no custom from–to, no project filter.
2. **No OLD-arrears vs CURRENT-dues split** of collections (the headline metric).
3. **No field visits.**
4. **No escalations opened.**
5. **Keep-rate uses the wrong denominator** — `kept÷(kept+broken)` over a *past-due*
   cohort, not `kept÷made` (see §2c — this is a real methodology decision for the owner).
6. **Collections attribution is project-level** (sums all receipts on the officer's
   projects). Two officers sharing a project both get full credit → double-counting. The
   *precise* key (`payments.created_by`) exists but is NULL in FG.
7. Renders **empty for FG** (no recovery-role users).

---

## 2. THE METRICS (officer-wise, per period `from`→`to`)

For every metric: exact table · column · aggregation · attribution key · date column ·
RPC status. Period is a half-open `[from, to]` on the date column (day = from==to;
week/month = caller passes the boundaries — keep the RPC period-agnostic).

### a) Collections recovered — **with the OLD-vs-CURRENT split**
- **Gross:** `payments.amount`, `WHERE status<>'cancelled' AND payment_date BETWEEN from AND to`,
  joined to a non-cancelled active `sales` row. Date col = `payment_date`.
- **Attribution:** *project-assignment* (consistent with the existing scoreboard) — sum
  over sales whose `project_id ∈ officer's assigned projects`. *(Precise alternative:
  `payments.created_by`; deferred until receipts are attributed — FG is all-NULL.)*
- **The split — REUSE `get_recovery_position`'s FIFO (do not reinvent).** That function
  already computes, **per sale**, exactly this split via these CTEs:
  - `lines`: installments with `due ≤ to`, tagged `is_old = due_date < from`,
    `is_cur = from ≤ due_date ≤ to`, `is_dp = down_payment`, plus a running cumulative
    `cum_incl`.
  - `perline`/`pl2`: FIFO-fills each line first with pre-period payments (`p1`) then
    period payments (`p2`); `paid_per = paid_tot − paid_pre` = **recovered THIS PERIOD
    applied to that line**.
  - `sale_agg`:
    - `r_old = Σ paid_per FILTER (NOT is_dp AND is_old)` → **recovered from old arrears**
    - `r_cur = Σ paid_per FILTER (NOT is_dp AND is_cur)` → **recovered from current dues**
    - `r_dp` (down-payment), and a separate `dead_recovery = Σ paid_per FILTER (due_date <
      to−90)` → the **>90-day "Dead" recovery** split already surfaced in RP's
      `officer_summary` (today lumped as "All Officers").
  - **To make it per-officer:** aggregate the same `sale_agg` rows but `GROUP BY` the
    officer derived from the sale's `project_id → user_project_assignments`. Same
    double-counting caveat as gross collections; documented.
- **RPC status:** the *split math exists* in `get_recovery_position` (sale-level, all
  officers). A new RPC must run the same FIFO and group by officer (§5).

### b) Calls logged
- `contact_logs` · `COUNT(*)` · `agent_id = u.id::text` · `contact_date BETWEEN from AND to`.
- RPC: exists in `_lite` (month only) → needs period params.
- ⚠️ `contact_logs` also has `created_by` and `recovery_agent_id`; the canonical key (used
  by `_lite`) is **`agent_id`**. Keep that; flag the ambiguity for the engine phase.

### c) Promises made + keep-rate
- **Made:** `payment_promises` · `COUNT(*) FILTER (promise_made_on BETWEEN from AND to)` ·
  `logged_by = u.id::text`.
- **Keep-rate = kept ÷ made** (the prompt's "real recovery KPI"):
  - `kept = COUNT(*) FILTER (promise_made_on in period AND status IN ('kept','partial'))`
  - `rate = kept ÷ NULLIF(made,0)`.
- ⚠️ **Owner decision.** `kept÷made` over *made-this-period* promises **deflates** the rate
  for promises not yet due (a promise made yesterday for next month counts as "not kept").
  The existing `_lite` instead measures the *past-due* cohort (`kept÷(kept+broken)`), which
  is fairer but mixes cohorts (counts promises made in earlier periods). **Recommend
  exposing both:** a strict `keep_rate_made` (kept÷made, period-pure) **and** a
  `keep_rate_matured` (kept÷matured, where matured = promise_date ≤ to). Let the owner pick
  the headline; ship both numbers so the report is honest.
- RPC: `_lite` has made/kept/broken (month, wrong cohort for keep-rate) → new.

### d) Field visits
- `field_visits` · `COUNT(*)` · `officer_id = u.id` (uuid) · `visit_date BETWEEN from AND to`.
- Optional richer: `COUNT(*) FILTER (outcome='...')` for productive vs no-show.
- RPC: **none exists** → new.

### e) Escalations opened
- `escalations` · `COUNT(*)` · `escalated_by = u.id` (uuid) · `created_at::date BETWEEN
  from AND to`.
- Optional: `... FILTER (status='resolved')` for resolution credit (`resolved_at`).
- RPC: **none exists** → new.

> Officer set, project scoping, `untouched_overdue`, and `pending_approvals` carry over
> from `_lite` unchanged.

---

## 3. REPORT #9 — Officer / Team Performance (on the NXReport factory)

Slots into the `REPORTS` registry (`js/pages/reports.js`) exactly like the others — a
`{ meta, config }` entry rendered by `js/foundation/report-page.js`. Closest existing
template = **`collections`** (daterange filter, RPC fetch, officer-wise summary via
`gunm()` + an attribution-gap note). Crystal-style print, Excel/PDF inherited from the
factory for free.

```js
REPORTS.team_performance = {
  meta: { title: 'Officer Performance', group: 'OPERATIONS',
          desc: 'Per-officer recovery scorecard — calls, promises (keep-rate), visits, escalations, recovered (arrears vs current)' },
  config: {
    id: 'team_performance', title: 'Officer Performance Report', group: 'OPERATIONS',
    orientation: 'landscape',           // 8 numeric columns
    filters: [ { kind: 'project' }, { kind: 'daterange' }
               /* , { kind: 'officerPicker' }  ← NEW filter kind, see note */ ],
    fetch: async f => {
      const r = await supabase.rpc('get_team_performance',
        { p_company_id: S.cid, p_project_id: f.project || null, p_from: f.from || null, p_to: f.to || null });
      if (r.error) throw r.error; return r.data || [];
    },
    transform: (rows, f) => {
      const columns = [
        { key: 'officer',    label: 'Officer' },
        { key: 'calls',      label: 'Calls',        num: true },
        { key: 'visits',     label: 'Visits',       num: true },
        { key: 'made',       label: 'Promises',     num: true },
        { key: 'keep_rate',  label: 'Keep-rate',    num: true, fmt: 'pct' },
        { key: 'escalations',label: 'Escalations',  num: true },
        { key: 'recovered',  label: 'Recovered',    num: true, fmt: 'money' },
        { key: 'r_old',      label: 'from Arrears', num: true, fmt: 'money' },
        { key: 'r_cur',      label: 'from Current', num: true, fmt: 'money' },
      ];
      const out = rows.map(r => ({ officer: r.full_name, calls: r.calls, visits: r.visits,
        made: r.promises_made, keep_rate: r.keep_rate_made, escalations: r.escalations,
        recovered: r.recovered, r_old: r.recovered_old, r_cur: r.recovered_current }));
      const tot = k => out.reduce((s,x)=>s+(Number(x[k])||0),0);
      return { columns, rows: out,
        totals: { calls: tot('calls'), visits: tot('visits'), made: tot('made'),
                  escalations: tot('escalations'), recovered: tot('recovered'),
                  r_old: tot('r_old'), r_cur: tot('r_cur') },
        totalsLabel: 'TOTAL',
        summary: [ { label: 'Officers', value: out.length },
                   { label: 'Recovered', value: tot('recovered'), money: true } ],
        appendix: [{ title: 'Notes', columns:[{key:'k',label:''},{key:'v',label:''}],
          rows: [ { k:'Recovered attribution', v:'By assigned project (a shared project credits each assigned officer).' },
                  { k:'Keep-rate', v:'Promises kept ÷ promises made in period (strict).' } ] }] };
    }
  }
};
```
- **Filters: project + daterange** match the request. An **officer filter** is a *new
  `officerPicker` filter kind* (small addition to `report-page.js` `_defaultFilters` +
  `_headerHTML` — one `case`). Optional; the report is already officer-wise by row, so
  this is a convenience filter, not a blocker.
- **#9** = the next report after the consolidated #1–#8 (recovery_position, aging,
  client_ledger, unit_statement, collections, pdc, sales_summary, availability). Hub group
  `OPERATIONS` (or a new `TEAM` group if the owner wants it separated).

---

## 4. DASHBOARD TEAM PANEL (admin-only, render-gated)

Slots into `_dashAdmin(pg)` (`js/pages/dashboard.js`, already `isAdmin`-gated). A compact
**officer leaderboard** card, sorted by recovered-this-period.

- **Render-gate (truth-law):** show the panel **only if** `get_team_performance` returns
  ≥1 officer **with any activity this period** (calls+visits+promises+recovered > 0).
  Otherwise omit entirely — no empty panel (this is the FG reality today).
- **Row:** avatar+name · **Recovered (this month)** `.num` · **Keep-rate %** · a tiny trend.
  - Sparkline: `NX.sparkline` exists, but a **per-officer** daily series needs per-payment
    `created_by` attribution, which FG lacks. **Recommendation:** ship the panel WITHOUT a
    per-officer sparkline at v1 (flag it). If a trend is wanted, show **one** company-level
    `NX.sparkline` of daily recovered using the existing `get_daily_collections` as the
    panel's context strip — real, already-proven, no new attribution needed. Render-gate
    any line at **≥3 points** (kit rule).
- **Formula tips (`NX.infoTip`, per the truth-law — every number explains itself):**
  - Recovered ⓘ "Σ receipts on this officer's assigned projects, {period}. Gross; a shared
    project credits each assigned officer."
  - Keep-rate ⓘ "Promises kept ÷ promises made this period."
- **Cross-tie (truth-law):** Σ(officer Recovered) should reconcile to the dashboard's
  company `collected this month` (modulo shared-project double-count, which the tip
  discloses). Surface the reconciliation, don't hide it.
- Period = current month (matches the rest of the dashboard). No count-up needed; numbers
  are small.

---

## 5. NEW RPCs (minimal set — signatures only, do not build yet)

Justification bar = `get_daily_collections`: one tight `STABLE SECURITY DEFINER` function,
single purpose, admin-gated, **no new tables**, reuses existing math.

**ONE new RPC powers all three surfaces** (Team page, Report #9, dashboard panel):

```sql
get_team_performance(
  p_company_id  uuid,
  p_project_id  uuid  DEFAULT NULL,                 -- project filter (NULL = all assigned)
  p_from        date  DEFAULT date_trunc('month',CURRENT_DATE)::date,
  p_to          date  DEFAULT CURRENT_DATE
) RETURNS jsonb        -- array, one object per recovery officer
```
Returns per officer: `user_id, full_name, projects[], calls, visits, promises_made,
promises_kept, keep_rate_made, keep_rate_matured, escalations, recovered,
recovered_old, recovered_current, recovered_dead, outstanding, overdue, untouched_overdue,
pending_approvals`.

Construction (all reuse, nothing new):
- Start from `get_team_performance_lite`'s officer skeleton + LATERAL joins, **parametrize
  the window** with `p_from/p_to` instead of `date_trunc('month',...)`.
- Add `field_visits` (officer_id, visit_date) and `escalations` (escalated_by, created_at)
  LATERALs.
- Fix the promise block to the §2c definitions (`keep_rate_made`, `keep_rate_matured`).
- Fold in the `get_recovery_position` FIFO CTEs (`lines→perline→pl2→sale_agg`),
  `GROUP BY` officer-via-project, to produce `recovered_old / recovered_current /
  recovered_dead`. This is the only non-trivial piece — it lifts ~40 lines straight from
  the proven RP function.
- Same admin gate (`_rms_is_admin` + company match) as `_lite`.

**Back-compat:** keep `get_team_performance_lite` as a thin wrapper that calls
`get_team_performance` with month defaults (or repoint `team.js`). Both is fine.

**Deferred / not now:** a per-officer *daily* recovered series RPC (for officer
sparklines) — needs `payments.created_by` populated; propose only after attribution
backfill. The panel's optional company sparkline reuses `get_daily_collections` (already
exists).

That's **one new RPC** for the whole feature. Migration = additive function, owner
sign-off per the staged-approval rule before it lands.

---

## 6. GROUND-TRUTH ANCHOR

### 6a. FG reality (the verification truth, and a finding)
Hand-verified on FG (`3249e3b5…`):

| Officer-level metric | FG value |
|---|---|
| recovery-role officers | **0** |
| contact_logs (calls) | **0** |
| payment_promises | **0** |
| field_visits | **0** |
| escalations | **0** |
| payments with `created_by` | **0** (all NULL) |

→ Officer-level outputs for FG are **all zero by construction**. The build must prove it
renders the **hidden/empty-gated** state correctly for FG, not crash or show a bogus row.

### 6b. The one real FG number — gross collections (company-level, the only verifiable anchor)
Monthly receipts on KBH's project (verified, `status<>'cancelled'`):

| Month | Receipts | Collected (PKR) |
|---|---:|---:|
| 2026-06 (partial) | 13 | 3,781,500 |
| **2026-05** | **61** | **12,275,100** |
| 2026-04 | 68 | 13,197,643 |
| 2026-03 | 46 | 8,112,500 |
| 2026-02 | 59 | 20,269,000 |
| 2026-01 | 68 | 16,215,800 |

**Pick May 2026 as the period anchor: 61 receipts, PKR 12,275,100.** It must reconcile to:
`get_daily_collections(FG, 2026-05-01, 2026-05-31)` Σ **and** `get_recovery_position`'s
`received_total` for the same window. The **old-vs-current split** for that period is
verifiable against `get_recovery_position`(FG, 2026-05-01, 2026-05-31) `totals.r_old` /
`totals.r_cur` / officer_summary `dead_recovery_total` — those are the exact numbers
`get_team_performance` must reproduce (summed across officers === all-officers RP totals).

### 6c. Officer-level anchor — must be SEEDED (ZZTEST), because no real data exists
Recipe for the build's verification target (ZZTEST `a2915ce7…`, "safe to wipe"):
1. One recovery officer: `app_users` role `recovery`, active (note its `user_id`).
2. Assign it to ZZTEST's project (`user_project_assignments`).
3. Seed, all dated inside one test month, attributed to that officer:
   - **N** `contact_logs` rows (`agent_id = user_id::text`, `contact_date` in month).
   - **M** `payment_promises` (`logged_by = user_id::text`, `promise_made_on` in month) —
     make e.g. 3 with `status='kept'`, 1 `'partial'`, 2 `'broken'`, 1 still `'pending'`
     (promise_date in future) → expected `made=7, kept=4, keep_rate_made=4/7=57.1%`;
     `keep_rate_matured = 4 ÷ 6 = 66.7%` (the pending one excluded).
   - **K** `field_visits` (`officer_id = user_id`, `visit_date` in month).
   - **J** `escalations` (`escalated_by = user_id`, `created_at` in month).
   - A couple of `payments` with `created_by = user_id::text` against an installment ladder
     where one installment was due before the month (→ `recovered_old`) and one in the
     month (→ `recovered_current`); hand-FIFO the split and assert.
4. Hand-compute each field → call `get_team_performance(ZZCID, null, monthFrom, monthTo)` →
   assert byte-for-byte. Then delete the seed (MCP), like every prior batch.

This gives the build a concrete pass/fail target for **every** metric, since production
can't provide one yet.

---

## Decisions for the owner (before build)
1. **Keep-rate denominator:** strict `kept÷made` (prompt) vs fair `kept÷matured`. Recommend
   shipping **both**, headline = your pick.
2. **Collections attribution:** project-based now (matches existing scoreboard, double-counts
   shared projects — disclosed in a tip) vs precise `created_by` later (needs receipt
   attribution backfill). Recommend project-based v1.
3. **Officer sparkline on the dashboard:** defer (no per-officer daily attribution) vs ship a
   company-level `get_daily_collections` trend strip instead. Recommend the latter.
4. **Scope reality:** ship the engine + a one-line "to light this up, your team needs
   recovery logins and must log activity; receipts need `created_by`" note. Without that,
   the panel/report are correctly empty for FG.
5. **One new RPC** (`get_team_performance`) — additive migration; staged sign-off before it
   lands.
