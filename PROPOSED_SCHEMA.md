# Nexunova RMS — Phase 1 Proposed Schema (design only)

**Date:** 2026-05-26
**Source:** gap analysis of `DATABASE_AUDIT.md` against the 10 new-architecture requirements
**Status:** ✅ APPLIED 2026-05-26 — migration `phase1_new_tables_20260526` applied & verified via Supabase MCP (`supabase/migrations/20260526_phase1_new_tables.sql`).

## Locked decisions
1. **Approval workflow = single-approver** (Admin approves everything). No multi-level `approval_steps` table; one `current_approver` / `decided_by` per request.
2. **Password policy = dedicated `company_password_policies` table** (not folded into `company_security_settings`).
3. **`project_id` delete rule** = `ON DELETE RESTRICT` on financial tables, `ON DELETE SET NULL` on operational tables.

## Conventions followed (matching existing schema)
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE`
- `created_at` / `updated_at timestamptz NOT NULL DEFAULT now()`
- Actor columns are `uuid REFERENCES public.app_users(id) ON DELETE SET NULL`
- **RLS:** every table `ENABLE ROW LEVEL SECURITY` + single `deny_all_anon` policy (`FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)`) — all access via SECURITY DEFINER RPCs (PATH_B lockdown)
- **Mutable tables** get a `trg_<table>_upd BEFORE UPDATE` trigger calling the existing `set_updated_at()`

## Scope
| Requirement | Outcome |
|---|---|
| 1. User → project assignment | NEW `user_project_assignments` |
| 2. Approval workflow | NEW `approval_requests` + `approval_request_comments` |
| 3. Multi-site isolation | **14 `project_id` column additions** (no new table) |
| 4. Setup wizard tracking | NEW `company_setup_progress` |
| 5. Password policy / expiry | NEW `company_password_policies` + `password_history` + 2 cols on `app_users` |
| 6. IP whitelist | **Already exists** (`company_ip_whitelists`) — no change |
| 7. Device/session tracking | NEW `user_sessions` |
| 8. Recovery targets per officer/month | NEW `recovery_officer_targets` |
| 9. Holiday calendar | NEW `holidays` |
| 10. Cancellation policy tiers | NEW `cancellation_policy_tiers` |

**10 new physical tables** (the approval feature = parent + comments child) across 8 feature areas, **+14 column additions**, **+2 columns** on `app_users`.

---

# New tables

## 1. `user_project_assignments`
Which users can access which projects/sites. Backs requirement #3's enforcement (RPCs filter by membership; `is_super_admin`/owner bypass in the RPC).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| user_id | uuid NOT NULL | → app_users(id) CASCADE |
| project_id | uuid NOT NULL | → projects(id) CASCADE |
| access_level | text NOT NULL | default `'view'` — view \| edit \| manage |
| is_active | boolean NOT NULL | default true |
| assigned_by | uuid | → app_users(id) SET NULL |
| assigned_at | timestamptz NOT NULL | default now() |
| revoked_at | timestamptz | |
| notes | text | |
| created_at / updated_at | timestamptz NOT NULL | default now() |

**Constraints:** `UNIQUE (user_id, project_id)`. Indexes on `company_id`, `project_id`. RLS `deny_all_anon`. `set_updated_at` trigger.

## 2. `approval_requests` (single-approver)
Generic approval queue — any record can be submitted for Admin approval via the `entity_table`/`entity_id` link.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| request_type | text NOT NULL | discount \| cancellation \| refund \| transfer \| price_revision \| dnd \| blacklist \| … |
| entity_table | text | target table name (generic link) |
| entity_id | uuid | target record id |
| project_id | uuid | → projects(id) SET NULL |
| title | text NOT NULL | |
| description | text | |
| payload | jsonb NOT NULL | default `'{}'` — proposed change snapshot |
| amount | numeric | optional monetary context |
| status | text NOT NULL | default `'pending'` — pending \| approved \| rejected \| cancelled |
| priority | text NOT NULL | default `'normal'` — low \| normal \| high \| urgent |
| requested_by | uuid | → app_users(id) SET NULL |
| requested_at | timestamptz NOT NULL | default now() |
| current_approver_id | uuid | → app_users(id) SET NULL (the Admin) |
| decided_by | uuid | → app_users(id) SET NULL |
| decided_at | timestamptz | |
| decision_comment | text | |
| due_by | timestamptz | |
| created_at / updated_at | timestamptz NOT NULL | default now() |

**Indexes:** `(company_id, status)`, `(entity_table, entity_id)`, `(current_approver_id) WHERE status='pending'`. RLS `deny_all_anon`. `set_updated_at` trigger.

## 3. `approval_request_comments`
Threaded comments / decision trail for an approval.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| request_id | uuid NOT NULL | → approval_requests(id) CASCADE |
| author_id | uuid | → app_users(id) SET NULL |
| action | text | comment \| approved \| rejected \| reassigned \| escalated |
| comment | text NOT NULL | |
| created_at | timestamptz NOT NULL | default now() |

**Index:** `(request_id, created_at)`. RLS `deny_all_anon`. (No `updated_at` — immutable thread, no trigger.)

## 4. `company_setup_progress`
Per-step setup-wizard tracking. `companies.onboarding_complete` stays as the rolled-up flag.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| step_key | text NOT NULL | company_profile \| branding \| projects \| units \| users \| payment_methods \| categories \| … |
| status | text NOT NULL | default `'pending'` — pending \| in_progress \| completed \| skipped |
| completed_by | uuid | → app_users(id) SET NULL |
| completed_at | timestamptz | |
| data | jsonb NOT NULL | default `'{}'` |
| sort_order | integer NOT NULL | default 0 |
| created_at / updated_at | timestamptz NOT NULL | default now() |

**Constraint:** `UNIQUE (company_id, step_key)`. Index on `company_id`. RLS `deny_all_anon`. `set_updated_at` trigger.

## 5. `company_password_policies`
Per-company password rules (1 row per company; PK = company_id).

| Column | Type | Notes |
|---|---|---|
| company_id | uuid PK | → companies(id) CASCADE |
| min_length | integer NOT NULL | default 8 |
| require_uppercase | boolean NOT NULL | default true |
| require_lowercase | boolean NOT NULL | default true |
| require_number | boolean NOT NULL | default true |
| require_symbol | boolean NOT NULL | default false |
| expiry_days | integer NOT NULL | default 90 (0 = never) |
| history_count | integer NOT NULL | default 3 (block reuse of last N) |
| force_change_on_first_login | boolean NOT NULL | default true |
| expiry_warning_days | integer NOT NULL | default 7 |
| updated_by | uuid | → app_users(id) SET NULL |
| updated_at | timestamptz NOT NULL | default now() |

RLS `deny_all_anon`. `set_updated_at` trigger.

## 6. `password_history`
Prevents reuse of recent passwords.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| user_id | uuid NOT NULL | → app_users(id) CASCADE |
| password_hash | text NOT NULL | |
| changed_at | timestamptz NOT NULL | default now() |

**Index:** `(user_id, changed_at DESC)`. RLS `deny_all_anon`. (No `updated_at`.)

### `app_users` additions (expiry tracking)
`needs_password_reset` (already present) covers force-change-on-first-login; add:
- `password_changed_at timestamptz`
- `password_expires_at timestamptz`

`verify_login` would compare `password_expires_at` to `now()`.

## 7. `user_sessions`
Live device/session list (complements the immutable `auth_events` log and `app_users.session_version` kill-switch).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| user_id | uuid NOT NULL | → app_users(id) CASCADE |
| session_token_hash | text NOT NULL | hashed token (never raw) |
| device_label | text | "Chrome 124 on Windows 11" |
| device_type | text | desktop \| mobile \| tablet |
| user_agent | text | |
| ip_address | inet | |
| location | text | coarse geo (optional) |
| session_version | integer | ties to app_users.session_version |
| is_current | boolean NOT NULL | default true |
| last_seen_at | timestamptz NOT NULL | default now() |
| expires_at | timestamptz | |
| revoked_at | timestamptz | |
| revoked_by | uuid | → app_users(id) SET NULL |
| created_at | timestamptz NOT NULL | default now() |

**Constraint:** `UNIQUE (session_token_hash)`. Indexes: `(user_id) WHERE revoked_at IS NULL`, `(company_id)`. RLS `deny_all_anon`. (No `updated_at` — `last_seen_at` is updated explicitly.)

## 8. `recovery_officer_targets`
Per recovery officer, per month (optionally per project). `recovery_agents.monthly_recovery_target` becomes the fallback default.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| recovery_agent_id | uuid NOT NULL | → recovery_agents(id) CASCADE |
| project_id | uuid | → projects(id) SET NULL (NULL = all sites) |
| year | smallint NOT NULL | |
| month | smallint NOT NULL | `CHECK (month BETWEEN 1 AND 12)` |
| target_amount | numeric NOT NULL | default 0 |
| target_calls | integer NOT NULL | default 0 |
| target_promises | integer NOT NULL | default 0 |
| achieved_amount | numeric NOT NULL | default 0 |
| achieved_calls | integer NOT NULL | default 0 |
| achieved_promises | integer NOT NULL | default 0 |
| notes | text | |
| set_by | uuid | → app_users(id) SET NULL |
| created_at / updated_at | timestamptz NOT NULL | default now() |

**Constraint:** `UNIQUE (recovery_agent_id, project_id, year, month)`. Index `(company_id, year, month)`. RLS `deny_all_anon`. `set_updated_at` trigger.

## 9. `holidays`
Holiday calendar. `company_id NULL` = shared national/global defaults; non-null = company-specific.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid | → companies(id) CASCADE (NULL = national default) |
| holiday_date | date NOT NULL | |
| name | text NOT NULL | |
| holiday_type | text NOT NULL | default `'national'` — national \| religious \| company \| optional |
| country | text NOT NULL | default `'Pakistan'` |
| is_recurring | boolean NOT NULL | default false (true for fixed-date annual) |
| is_working_day | boolean NOT NULL | default false (compensatory working-day override) |
| notes | text | |
| created_by | uuid | → app_users(id) SET NULL |
| created_at / updated_at | timestamptz NOT NULL | default now() |

**Constraint:** `UNIQUE (company_id, holiday_date, name)`. Index `(holiday_date)`. RLS `deny_all_anon`. `set_updated_at` trigger.
Fixed dates (Kashmir Day 02-05, Pakistan Day 03-23, Labour Day 05-01, Independence Day 08-14, Iqbal/Quaid Day) → `is_recurring=true`; lunar (Eid, Ashura) → seeded per year. Seed data inserted later, not in this migration.

## 10. `cancellation_policy_tiers`
Per-project (or company-default) cancellation tiers. `execute_unit_cancellation` would resolve the matching tier to pre-compute forfeiture/charges/refund.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | → companies(id) CASCADE |
| project_id | uuid | → projects(id) CASCADE (NULL = company default) |
| tier_name | text NOT NULL | "0–30 days", ">50% paid", … |
| min_days_since_booking | integer | trigger range (optional) |
| max_days_since_booking | integer | |
| min_paid_pct | numeric(5,2) | trigger range (optional) |
| max_paid_pct | numeric(5,2) | |
| forfeiture_pct | numeric(5,2) NOT NULL | default 0 — % of paid forfeited |
| cancellation_charge_pct | numeric(5,2) NOT NULL | default 0 — % of sale value |
| cancellation_charge_flat | numeric NOT NULL | default 0 |
| processing_fee | numeric NOT NULL | default 0 |
| refund_pct | numeric(5,2) | optional explicit refund cap |
| sort_order | integer NOT NULL | default 0 |
| is_active | boolean NOT NULL | default true |
| effective_from / effective_to | date | |
| notes | text | |
| created_by | uuid | → app_users(id) SET NULL |
| created_at / updated_at | timestamptz NOT NULL | default now() |

**Index:** `(company_id, project_id, sort_order)`. RLS `deny_all_anon`. `set_updated_at` trigger.

---

# Column additions — multi-site `project_id` (14 tables)

`units, sales, unit_cancellations, unit_transfers, commission_structures` already carry `project_id`. `clients` and `agents` are intentionally **company-level** (span projects) and are left unchanged. Each addition is nullable, indexed, and backfilled from the parent `sale_id`/`unit_id`.

### Financial → `ON DELETE RESTRICT` (preserve money history)
| Table | Backfill source |
|---|---|
| payments | `sales` via `sale_id` (NOT NULL) |
| installments | `sales` via `sale_id` |
| pdc_cheques | `sales` via `sale_id` (where present) |
| additional_receivables | `sales` via `sale_id` |
| payables | `unit_cancellations` / `unit_transfers` via related ids (best-effort) |

### Operational → `ON DELETE SET NULL`
| Table | Backfill source |
|---|---|
| payment_promises | `sales` via `sale_id` |
| contact_logs | `sales` via `sale_id`, else `units` via `unit_id` |
| follow_up_reminders | `sales` via `sale_id`, else `units` via `unit_id` |
| escalations | `sales` via `sale_id` |
| legal_cases | `sales` via `sale_id`, else `units` via `unit_id` |
| field_visits | `units` via `unit_id` |
| reminder_logs | `sales` via `sale_id`, else `units` via `unit_id` |
| buyer_complaints | none (client-level) — stays NULL |
| noc | `units` via `unit_id` (also has legacy `project_name` text) |

> `additional_receivables` and `payables` are classified **financial (RESTRICT)** as money-bearing ledgers — flag if you want either moved to SET NULL.
> `project_id` is left **nullable** here; `NOT NULL` can be enforced later once backfill is verified for fully-populated tables (e.g. payments).

---

# Intentionally excluded
- **IP whitelist (#6):** `company_ip_whitelists` + `company_security_settings.ip_whitelist_enabled` already satisfy this.
- **Audit triggers** on the new sensitive tables (approvals, password policy, project access) are a sensible follow-up but are **not** in this migration (scope = the confirmed design). Can be added with `audit_trigger_function` later.
- **RPCs** (list/create/update functions for these tables) are a separate Phase-1 follow-up; this migration is schema only.
