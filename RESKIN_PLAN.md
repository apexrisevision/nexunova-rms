# RESKIN_PLAN — Nexunova RMS long-tail (nx- foundation kit roll-out)

Read-only inventory of every surface **not yet** on the `nx-` foundation kit, with a proposed batch order. No code changed.

**Already on the kit (DONE — excluded from this plan):** Dashboard (`dashboard.js`), Reports (`reports.js`), Units (`units.js`), Sales (`sales.js`), Clients (`clients.js` + `components/client-form.js`), Record-Payment flow (`payments.js`), PDC (`pdc.js`), Setup Wizard (`onboarding.js`), and the shell (`foundation/shell.*`).
**Method:** walked `ui.js` `navGroups` (5 role variants) + the `nav()` `fns`/`ts` route maps + `login.html` `pg-*` sections. "Current state" is grounded in a per-file count of `nx-`/`NX.`/`--fk-` usage — **every page below scored 0** (pure legacy styling) unless noted.

**Legend**
- **State:** `legacy` = renders but on pre-kit CSS (`.card/.fi/.fo/.btn/.mov/.dx-*`); `dead` = no live route binding.
- **Importance:** `daily` · `occasional` · `rare` · `kill?` (QA-deferred cut candidate — see `nav_phase_qa_cut_candidates`).
- **Complexity:** **S** = tables+buttons kit-wash · **M** = forms need the lean ClientForm-style treatment · **L** = structural rework (multi-entity / multi-tab / big create flow).
- **Grade:** **Sonnet** = mechanical kit-wash · **Fable** = needs design judgment (forms/IA/structure).

---

## Inventory (by sidebar area)

### INVENTORY
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Projects (list + detail) | `projects` / `projectdetail` | `projects.js` | 1792 | Project master: list, detail, big create/edit form, milestones/banks/expenses | legacy | **daily** | **L** |
| NOC Management | `noc` | `noc.js` | 685 | NOC issue/track register + form | legacy | occasional | M |
| Transferred Units ledger | `transferunits` | `transferred.js` | 254 | Read register of transferred units | legacy | occasional | S |
| Cancelled Units ledger | `cancelledunits` | `cancelled.js` | 250 | Read register of cancelled units | legacy | occasional | S |
| Transfer Unit (action) | `unittransfer` | `transfers.js` | 1155 | Unit-transfer workflow (multi-step form) | legacy | occasional | M |
| Cancel Unit (action) | `unitcancel` | `cancellation.js` | 922 | Unit-cancellation workflow + refund calc | legacy | occasional | M |
| Ownership Chain | `unitchain` | `ownership-chain.js` | 266 | Per-unit ownership history timeline | legacy | rare | S |

### SALES
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Sales Agents (list + detail + commissions) | `agents` / `agentdetail` / `commissions` | `agents.js` | 2243 | Agent master cards/list, detail, commission pay-out, agent ledger | legacy | **daily** | **L** |
| Agent Transactions | `agenttransactions` | `agenttransactions.js` | 209 | Agent debit/credit ledger table | legacy | rare | S |

### RECOVERY
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Payments work-queue | `recovery` | `recovery.js` | 242 | **Daily money screen** — overdue units by urgency, filters, → Add Payment (the *list*; record flow already on kit) | legacy | **daily** | M |
| Receipt Vouchers | `receipts` | `receipts.js` | 361 | Receipt voucher list + print/reprint | legacy | **daily** (owner-named) | S |
| Follow-ups | `promises` | `promises.js` | 995 | Payment-promise tracker + log forms | legacy | daily | M |
| Reminders | `reminders` | `reminders.js` | 332 | Reminder queue/list | legacy | daily | S |
| Campaigns | `campaigns` | `campaigns.js` | 477 | Recovery campaign builder | legacy | rare | M |
| Field Visits | `fieldvisits` | `fieldvisits.js` | 413 | Field-visit log register | legacy | rare | S |
| Escalations | `escalations` | `escalations.js` | 379 | Escalation register | legacy | rare | S |
| Legal Cases | `legalcases` | `legalcases.js` | 597 | Legal-case tracker + form | legacy | rare | M |
| Payment Links | `paylinks` / `paylink-detail` | `payment-links.js` | 1068 | Online pay-link generator + status | legacy | rare | M |
| Ledgers (hub) | `ledgers` | `ledgers.js` | 587 | Entry hub to the 4 ledger views | legacy | **kill?** | S |
| Client / Unit / Agent / Project Ledger | `ledger-*` | `ledger-{client,unit,agent,project}.js` | 64–77 | Thin per-entity ledger tables | legacy | **kill?** | S |
| Officer Ledger | `officerledger` | `officerledger.js` | 176 | Recovery-officer collection ledger | legacy | rare | S |
| Receiving Ledger | `receivingledger` | `receivingledger.js` | 141 | Receipts-received ledger | legacy | rare | S |
| Additional Receivables | `receivables` | `receivables.js` | 255 | Misc receivables register | legacy | **kill?** | S |
| Payables | `payables` | `payables.js` | 173 | Payables register (likely out-of-RMS-scope) | legacy | **kill?** | S |
| Client Health Center | `healthcenter` | `health-center.js` | 202 | Health-score dashboard (tab inside Clients) | legacy | occasional | M |
| Blacklist Register | `blacklist` | `blacklist.js` | 228 | Blacklisted-clients register (tab inside Clients) | legacy | occasional | S |

### REPORTS
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Documents & Print | `documents` | `documents.js` | 343 | Document/print launcher grid | legacy | occasional (demote?) | S |
| Forecasting | `forecasting` | `forecasting.js` | 156 | Recovery forecast view | legacy | **kill?** | S |
| Comms Center | `commscenter` | `comms-center.js` | 451 | WhatsApp/SMS dispatch console | legacy | **kill?** | M |

### INBOX
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Inbox / Follow-up (tabbed) | `contacts` | `contacts.js` | 1384 | v3 tabbed: Dashboard \| Work Queue \| Contact Log \| Reports \| Escalation (+ `modals-log-call.js`, 972) | legacy | **daily** | **L** |
| Approvals | `approvals` | `approvals.js` | 884 | Approval-request inbox + decision modals | legacy | occasional | M |

### ADMIN
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Types & Floors (Categories) | `categories` | `categories.js` | 1759 | 5-entity CRUD: unit types, floors, statuses, payment types, sale types | legacy | **daily** (owner-named) | **L** |
| Banks Master | `banks` | `banks.js` | 139 | Company bank accounts master (used by PDC/payments) | legacy | **daily** (owner-named) | S |
| Users & Roles | `users` | `users.js` | 613 | Staff accounts/roles/permissions (logic just updated; **UI still legacy** `.fi/.fo/.mov`) | legacy | **daily** | M |
| Settings | `admin` | `admin.js` | 805 | Company settings hub (security, policies, etc.) | legacy | occasional | M |
| Payment Methods | `payment-methods` | `payment-methods.js` | 260 | Tenant receiving-method config | legacy | occasional | M |
| Team Performance | `team` | `team.js` | 306 | Team activity/performance table | legacy | occasional | S |
| Audit Trail | `audit` | `audit.js` | 733 | Audit-log viewer + filters | legacy | occasional | S |
| Backup | `backup` | `backup.js` | 129 | Data-backup/export trigger | legacy | occasional | S |

### Outside the tenant sidebar (separate tracks)
| Surface | nav id | file | LOC | What it does | State | Importance | Cplx |
|---|---|---|---|---|---|---|---|
| Quick Search / Find Unit | `search` | `search.js` | 1440 | Global cross-entity search UI | legacy | occasional | **L** |
| Company Branding | (modal) | `company-branding.js` | 544 | Logo/brand wizard (Admin → Company) | legacy | occasional | M |
| Payment Wall | (gate) | `payment-wall.js` | 741 | Blocked-tenant billing/pay screen | legacy | occasional | M |
| Tutorial | (overlay) | `tutorial.js` | 199 | First-run coachmarks | legacy | occasional | S |
| Print templates | — | `print.js` | 1451 | Print/PDF document templates (engine, **not a screen**) | legacy | special | N/A* |
| Super-Admin console | (sa) | `super-admin.js` | 1002 | Platform owner console (separate product surface) | legacy | separate | L |
| **Possession** | — | `possession.js` | 395 | Possession-handover page — **bound to no route/fn** (orphan in `fns`/`ts`) | **dead** | **kill?** | — |
| Signup gate | `s-signup` | `signup.js` (+ `signup-validation.js`) | 631 | Public signup wizard (just hardened in the Main-Gate phase; legacy-styled) | legacy | auth track | M |

\* `print.js` is template/PDF generation, not a kit surface — reskin only its *launcher* (`documents.js`), not the print output, unless print restyle is separately scoped.

---

## Proposed batch order (daily-first; owner-named first; 3–5 surfaces/batch)

> Owner named **Projects, Types & Floors, Banks, Agents, Receipts** as top priority; those lead. Batches are balanced so no single batch stacks three **L** rebuilds.

| # | Batch (theme) | Surfaces | Grade | Why here |
|---|---|---|---|---|
| **1** | Daily money masters — quick wins | **Banks (S)**, **Receipts (S)**, Payments work-queue `recovery` (M), Reminders (S) | **Sonnet** | Owner-named + the daily money screen; small/table-shaped → fast momentum, establishes the table/toolbar/voucher kit patterns the rest reuse |
| **2** | Types & Floors | **Categories / Types & Floors (L)**, Payment Methods (M), Backup (S) | **Fable** | Owner-named; 5-entity CRUD needs IA + lean forms (ClientForm-style) — the template for every multi-entity admin screen |
| **3** | Projects | **Projects + Project Detail (L)**, NOC (M) | **Fable** | Owner-named, daily; big create form + detail tabs = structural |
| **4** | Sales Agents | **Agents + Detail + Commissions (L)**, Agent Transactions (S) | **Fable** | Owner-named, daily; agent form + commission pay-out + ledger |
| **5** | Inventory ledgers & unit actions | Transferred (S), Cancelled (S), Ownership Chain (S), Transfer-Unit (M), Cancel-Unit (M) | **Sonnet** (Fable-review the two action workflows) | Mostly read registers + modal-driven workflows; reuse Batch-1 table kit |
| **6** | Inbox & approvals | **Inbox / contacts (L, tabbed)**, Approvals (M) | **Fable** | Daily; 5-tab rebuild + decision modals need judgment |
| **7** | Admin & oversight | **Users & Roles (M)**, Settings `admin` (M), Audit (S), Team (S) | **Fable** for Users/Settings forms · Sonnet for Audit/Team | Daily admin; Users/Settings are forms, Audit/Team are tables (can split if a session is tight) |
| **8** | Recovery long-tail (kept) | Follow-ups `promises` (M), Campaigns (M), Field Visits (S), Escalations (S), Legal Cases (M) | **Sonnet** (Fable-review promises/campaigns forms) | Daily-ish (`promises`) + rare register tail |
| **9** | **QA-gate batch — do AFTER KEEP/DEMOTE/KILL verdict** | Ledgers + 4 `ledger-*`, Receivables, Payables, Forecasting, Comms-Center, Officer/Receiving ledger, Payment-links, Health-center, Blacklist, **Possession (kill — dead route)** | **Sonnet** (whatever survives) | All flagged `kill?`; reskinning before the cut-review risks polishing pages slated for removal |

**Separate tracks (schedule independently):** Search (L, Fable), Company-Branding (M, Fable), Payment-Wall (M), Tutorial (S, Sonnet), Super-Admin console (L, its own product surface), Signup gate (auth track).

### Sonnet vs Fable at a glance
- **Sonnet-grade (mechanical kit-wash):** Batches **1, 5** and the table halves of **7, 8, 9** — register/ledger/list pages that are `.dx-table`/`.card` → `nx-table`/`nx-card` swaps with toolbar + empty-state polish.
- **Fable-grade (judgment):** Batches **2 (Categories), 3 (Projects), 4 (Agents), 6 (Inbox)**, plus Users/Settings forms in **7** — multi-entity CRUD, big create flows, tabbed IA, and lean-form treatment.

### Notes for the implementer
- **`recovery.js` ≠ `payments.js`:** the record-payment *flow* is already on the kit (Phase 3F); only the Payments *work-queue list* (`recovery.js`) remains.
- **`users.js`** logic was updated in the Main-Gate phase but its markup is still legacy (`.fi/.fo/.mov`) — it's a reskin target, not done.
- **`possession.js`** has no entry in `nav()`'s `fns`/`ts` maps — it's unreachable; confirm and **delete** rather than reskin.
- Health-Center and Blacklist render as **tabs inside Clients** (`openClientsTab`) — reskin them *within* the already-kitted Clients shell, not as standalone pages.
- Several Recovery/Reports surfaces are **feature-flag-gated** (`_PAGE_FLAG`: noc, campaigns, forecasting, commscenter, legal, blacklist, escalations, pdc, possession) — a tenant without the flag never sees them; weight effort accordingly.
