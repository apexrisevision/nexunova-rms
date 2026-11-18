# Finding: three RMS report functions answer a Staff login with no modules (18-Nov-2026)

Found while checking Sharose (sharose@awami, role **staff**, module_permissions `{}`, no projects,
NexuFinance role `site`). The RMS screens hide everything but the dashboard from such a login
(`hasPermission`: staff is fully permission-driven), but the database functions are not all gated
the same way. Called as his identity (claims only, read-only, rolled back):

| Function | What a no-module Staff login gets |
|---|---|
| `list_sales_for_report(p_company_id, …)` | **17 rows — every Awami sale** (client_id, unit, discount, net amount, agent, dates…) |
| `get_portfolio_summary(p_company_id, …)` | **17 rows** of the portfolio |
| `get_dashboard_receivable(p_company_id)` | company totals (net active, receivable, paid) — the dashboard is open to every role by design |
| `get_clients_all`, `get_units_all`, `list_agents`, `list_payments_filtered`, `list_sales`, `get_daily_collections`, `get_pdc_register`, `get_recovery_queue` | nothing (0 rows / empty queue) |

Reaching them needs a direct API call with his session — nothing on the screen leads there.
**Not fixed** (recorded, per the findings convention). The fix would be a role / module check
inside the two report functions, matching `hasPermission` (reports module, or an admin / accounts
/ manager role).

## Fixed — 18-Nov-2026 (20261118e, applied as 20261118101601)
Both functions now start with `_rms_can_read_reports(p_company_id)` (mirrors `hasPermission('reports')`
and checks the caller's company). Live check: awami 17/17, naseer 17/17, sharose refused/refused;
the helper is not callable from the API.
