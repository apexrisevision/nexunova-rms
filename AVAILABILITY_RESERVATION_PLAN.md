# Availability & Reservation + Sales Access — Build Plan

**Read-only design, 2026-06-15.** Live DB target = RMS (`itqxljtfbrppntgyfush`).
No code written, no DB writes. **Plan → owner review before any build.** English only.

**The headline:** this is the owner's #1 feature, and it sits on top of substrate that
**already exists** — the unit-status lifecycle, the New Sale flow, the per-plan limit
engine, and (critically) the **Buyer-Portal access pattern**. We do **not** build a new
auth system, and sales people do **not** consume paid admin/user seats. We add a **light
access layer** that is a near-copy of `portal_clients`/`portal_sessions`, plus a
`reservations` table, a handful of session-gated RPCs, one cron, one new plan-limit
column, and two surfaces (a light sales SPA + an admin reservations view). The
anti-double-booking lock is enforced **at the database level**, not in the UI.

---

## 0. What already exists (and we reuse, not rebuild)

| Substrate | Where | How we use it |
|---|---|---|
| **Unit status lifecycle** | `category_unit_statuses` per `(company_id, project_id)`: `status_code, status_name, is_available, is_active, sort_order, color_hex`. Seeded codes already include **`AVAILABLE`** (`is_available=true`), **`RESERVED`** (amber `#f59e0b`, `is_available=false`, sort 4), **`BOOKED`**, **`SOLD`**, `DEAD`. Units carry `units.status_id` (FK). | **No new statuses needed.** Reserve = flip `units.status_id` to the project's `RESERVED` row; convert = the existing sale flow flips it to `SOLD`; cancel/expire = flip back to `AVAILABLE`. One source of truth on the unit. |
| **Buyer-Portal access pattern** | `portal_clients` (login identity, bcrypt `password_hash`, `temp_token`/`temp_token_expires_at`, `is_active`, `project_id`) + `portal_sessions` (`session_token`, `expires_at`). RPCs `portal_login`, `portal_magic_login` (reuses `temp_token` → issues an 8h `portal_sessions` token), and every data RPC takes **`p_session_token`** and derives `client_id`/`company_id` **server-side** (anon GRANT; the token is the only gate; the Phase-0 IDOR fix proved this is the correct boundary). | **This is the exact template for Sales Access.** `sales_users` ≈ `portal_clients`; `sales_sessions` ≈ `portal_sessions`; `sales_login`/`sales_magic_login` ≈ `portal_*_login`; every sales RPC is `p_session_token`-gated and trusts **nothing** from the browser. |
| **Plan-limit engine** | `subscription_plans` (`max_users, max_projects, max_units, max_clients, max_agents`) + `check_plan_limit(company_id, resource_type)` → `{can_add, current_count, max_allowed, plan_name}`. Enforced inside the create RPCs (`create_app_user` calls `check_plan_limit(...,'users')`). | Add **one column** `max_sales_users` + a **`'sales_users'`** branch to `check_plan_limit`, and call it inside `create_sales_user`. Identical pattern to the existing user-seat cap. |
| **New Sale flow** | `create_sale_with_schedule(p_sale jsonb, p_installments jsonb)` — inserts the sale + installments and **flips the unit to its project's `SOLD` status**. UI pre-selects a unit via `window._nsPreUnitId` (5-step wizard: Unit → Client → Deal → Plan → Review). Already runs through the **Approvals Engine** booking rules. | Convert = open the existing New Sale **pre-filled** (unit + client + token note) and, on success, mark the reservation `converted`. We add no parallel sale path; reservations *feed* the real one. |
| **Agents / `created_by` attribution** | sales carry `agent_id` + `commission_rate`; rows carry `created_by` (app_user uuid). | A reservation records **`reserved_by` (a `sales_users.id`)**; on convert, the sale's `created_by`/`agent_id` are set in New Sale as today. Commission attribution is unchanged and out of scope for v1. |

---

## 1. Minimal NEW schema (additive, justified)

Three new tables + one new column. Nothing existing changes shape.

### 1a. `sales_users` — the light access identity (≈ `portal_clients`)
A sales person is **not** an `app_user` and never logs into `#s-app`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | tenant |
| `project_id` | uuid NULL | **scope** — NULL = all projects (see Open Question A). Mirrors `portal_clients.project_id`. |
| `full_name` | text NOT NULL | |
| `phone` | text NOT NULL | the login handle (PK buyers/staff live on phones) |
| `pin_hash` | text | bcrypt of a 4–6 digit PIN (`crypt(pin, gen_salt('bf',8))`) — same hashing as `portal_clients.password_hash` |
| `temp_token` | text | powers the **magic link** the admin shares (WhatsApp/QR), reused exactly like `portal_clients.temp_token` |
| `temp_token_expires_at` | timestamptz | 30-day default (matches the buyer-portal invite TTL) |
| `is_active` | boolean DEFAULT true | deactivate frees a plan slot |
| `last_login_at` | timestamptz | |
| `created_by` | uuid | the admin `app_user` who added them |
| `created_at` / `updated_at` | timestamptz | |

Unique: `(company_id, phone)`.

### 1b. `sales_sessions` — issued tokens (≈ `portal_sessions`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `sales_user_id` | uuid NOT NULL → `sales_users(id)` | |
| `session_token` | text NOT NULL | `encode(gen_random_bytes(32),'hex')` |
| `expires_at` | timestamptz NOT NULL | 8-hour TTL (same as `portal_sessions`) |
| `created_at` | timestamptz | |

Kept **separate** from `portal_sessions` so the two access types can never read each
other's tokens — clean isolation, zero blast radius.

### 1c. `reservations` — the reservation record (the new business object)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | derived from the unit |
| `unit_id` | uuid NOT NULL → `units(id)` | |
| `reserved_by` | uuid NOT NULL → `sales_users(id)` | **attribution** — who reserved it |
| `client_id` | uuid NULL → `clients(id)` | the buyer may not exist as a client yet |
| `client_name` | text NOT NULL | free-text capture at reserve time |
| `client_phone` | text | |
| `status` | text NOT NULL DEFAULT `'active'` | `active` · `converted` · `cancelled` · `expired` |
| `expires_at` | timestamptz NOT NULL | reserve time + 3 or 7 days (mandatory) |
| `token_received` | boolean DEFAULT false | **record-only** flag |
| `token_amount` | numeric(15,2) DEFAULT 0 | **record-only** — NO payment row, NO receipt, NO ledger posting |
| `note` | text | |
| `converted_sale_id` | uuid NULL → `sales(id)` | set on convert |
| `cancelled_by` | uuid NULL | sales_user or app_user who cancelled |
| `cancelled_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

**The anti-double-book backstop (DB-level, declarative):**
```
CREATE UNIQUE INDEX reservations_one_active_per_unit
  ON reservations (unit_id) WHERE status = 'active';
```
A second `active` reservation on the same unit is **impossible** — the database rejects
the INSERT. This is belt; the row-lock in `reserve_unit` (§2) is the suspenders.

### 1d. `subscription_plans.max_sales_users` (new column)
`ALTER TABLE subscription_plans ADD COLUMN max_sales_users integer NOT NULL DEFAULT 0;`
then seed per tier (owner-confirmed counts):

| plan | max_sales_users |
|---|---|
| free_trial | 2 |
| basic (monthly/yearly) | **15** |
| pro (monthly/yearly) | **25** |
| ultimate (monthly/yearly) | **50** |
| enterprise | 999 |

Separate from `max_users` (admin/user seats) — adding a sales person never touches the
paid-seat count and vice-versa.

---

## 2. RPCs (minimal signatures, Buyer-Portal-shaped)

All sales-facing RPCs are `SECURITY DEFINER`, `GRANT EXECUTE … TO anon, authenticated`,
and take **`p_session_token`** — the token is the gate, exactly like the re-gated buyer
RPCs. Admin-side RPCs are `_rms_caller()` + `_rms_is_admin()` gated and tenant-checked
(like `admin_invite_portal_client`).

### Provisioning (admin side)
- **`create_sales_user(p_company_id uuid, p_project_id uuid, p_name text, p_phone text)`**
  → `{success, sales_user_id, temp_pin, temp_token, magic_url}`.
  Admin + tenant gated. **Enforces the limit:** `check_plan_limit(p_company_id,
  'sales_users')->>'can_add'` must be true, else `{success:false, error:'plan_limit',
  current, max, plan_name}`. Generates a 4–6 digit PIN (shown on-screen, like the temp
  password) + a 30-day `temp_token`. Upsert on `(company_id, phone)`. Models
  `admin_invite_portal_client` line-for-line.
- **`deactivate_sales_user(p_id uuid)`** / **`reset_sales_user_pin(p_id uuid)`** — admin,
  tenant-scoped. Deactivate frees a plan slot.
- **`check_sales_access_limit(p_company_id uuid)`** — thin reader returning
  `check_plan_limit(p_company_id,'sales_users')` for the admin UI badge (X / 15).

### Authentication (light path — anon-friendly, token-gated)
- **`sales_login(p_company_code text, p_phone text, p_pin text)`** → `{success,
  session_token, sales_user_id, company_id, company_name, sales_user_name, project_id}`.
  Mirror of `portal_login`: case-insensitive company-code match, bcrypt PIN verify,
  delete prior sessions, issue an 8h `sales_sessions` token. `search_path` **must include
  `extensions`** (pgcrypto lives there — the exact bug that once broke `portal_login`).
- **`sales_magic_login(p_token text)`** → same payload. Mirror of `portal_magic_login`:
  validates `temp_token` + `temp_token_expires_at > now()` + `is_active`, issues a
  session token. This is the **primary** front door — admin shares the link over
  WhatsApp; no PIN typing.

### The board + reservation actions (session-gated)
- **`get_availability_board(p_session_token text, p_project_id uuid DEFAULT NULL)`**
  → floors → units `{unit_id, unit_no, floor_label, status_code, status_name, color_hex,
  is_available, reservation:{reserved_by_name, client_name, expires_at} | null}`.
  Derives `company_id` + allowed scope **from `sales_sessions`** (never from the caller).
  If the sales_user is project-scoped, the board is filtered to that project; a passed
  `p_project_id` outside scope is ignored. Powers the building-stack visual.
- **`reserve_unit(p_session_token text, p_unit_id uuid, p_client_name text,
  p_client_phone text, p_expiry_days int, p_token_received bool, p_token_amount numeric,
  p_note text)`** → `{success, reservation_id}` — **the killer RPC.** See §3 for the
  DB-level lock. `reserved_by` = the `sales_user` from the session. `p_expiry_days`
  constrained to {3,7}. **No payment is written** — `token_*` are recorded on the
  reservation only.
- **`cancel_reservation(p_session_token text, p_reservation_id uuid)`** → unit back to
  `AVAILABLE`, reservation `cancelled`. A sales_user may cancel only their **own** active
  reservation (derived from session); an **admin twin** `admin_cancel_reservation(
  p_reservation_id)` (caller-gated) lets the admin override any.
- **`get_my_reservations(p_session_token text)`** → the sales_user's own reservations
  (active + history) with live expiry countdown. Filtered to `reserved_by =
  session.sales_user_id` — a sales person sees **only their own**.
- **`get_reservations_admin(p_company_id uuid, p_project_id uuid, p_status text)`** →
  admin reader: every reservation + who reserved + client + expiry. Caller-gated.

### Convert + expiry
- **`get_reservation_for_conversion(p_reservation_id uuid)`** (caller-gated, admin/staff)
  → prefill bundle `{unit_id, client_id, client_name, client_phone, token_amount, note}`
  for the New Sale wizard.
- **`mark_reservation_converted(p_reservation_id uuid, p_sale_id uuid)`** — called by the
  app **after** `create_sale_with_schedule` succeeds: sets `status='converted'`,
  `converted_sale_id`. The unit is already `SOLD` (the sale RPC did that). We do **not**
  fork the sale path — convert *is* the existing New Sale, just pre-filled. (See Open
  Question B on whether the sales person may run this unattended.)
- **`cron_expire_reservations()`** — pg_cron job (same shape as the subscription crons):
  for every `status='active'` reservation with `expires_at < now()`, set
  `status='expired'`, flip the unit back to its project's `AVAILABLE` status, and write a
  `platform_notifications` / recovery-style **alert to the admin** ("Reservation on unit
  9-03 by Ahmad expired — back on the board"). Inventory is **never** falsely locked.

---

## 3. The DB-level anti-double-booking lock (the critical part)

`reserve_unit` runs as a single transaction:

1. Resolve `company_id` + `sales_user_id` (+ scope) **from `sales_sessions`** (reject
   expired/unknown token → `unauthorized`).
2. **`SELECT … FROM units WHERE id = p_unit_id AND company_id = <session co> FOR UPDATE`**
   — this **row-locks** the unit. Any concurrent `reserve_unit` on the same unit **blocks
   here** until this transaction commits.
3. Verify the unit's current `status_id` resolves to **`is_available = true`** in
   `category_unit_statuses` (i.e. it is genuinely `AVAILABLE`), and that **no `active`
   reservation already exists** for it. If not → `{success:false, error:'unit_unavailable'}`.
4. If project-scoped, verify the unit's `project_id` is within the sales_user's scope.
5. INSERT the `reservations` row (`status='active'`). The **partial unique index**
   (`one active per unit`) is the declarative backstop — even a hand-crafted concurrent
   call cannot create a second active reservation.
6. Flip `units.status_id` to the project's **`RESERVED`** status (same lookup pattern
   `create_sale_with_schedule` uses for `SOLD`).
7. Commit → the lock releases. The **next** blocked caller now re-reads step 3, sees the
   unit is `RESERVED` (not available) → rejected.

**Why it's airtight:** the `FOR UPDATE` serializes concurrent attempts; the
availability re-check happens *inside* the lock (not on stale UI state); and the partial
unique index makes a double-active-reservation a database-level impossibility regardless
of how the RPC is called. The admin RMS, reading the same `units.status_id`, sees the
unit as **Reserved** the instant the transaction commits — one source of truth, live.

---

## 4. Sales-Access security & isolation (proving the boundary)

We copy the boundary that closed the buyer-portal IDOR verbatim:

1. **The session token is the only identity.** Every sales RPC derives
   `company_id`/`sales_user_id`/scope **from `sales_sessions`**, never from caller
   arguments. The browser is never trusted with ids (the buyer-portal mistake was raw
   `client_id`/`company_id` args — we do not repeat it).
2. **A sales person can read only the board + their own reservations.** There is **no**
   sales RPC that returns clients, payments, ledgers, recovery, agents, or other sales
   users. `get_my_reservations` filters to `reserved_by = session.sales_user_id`;
   `get_availability_board` returns unit status + (for reserved units) only the
   reserver/client *name* and expiry — no financials, no CNIC, no schedule.
3. **A sales person cannot reach the full RMS.** They log into a **separate light SPA**
   (`sales-portal.html`, standalone like `buyer-portal.html`) — never the `#s-app` shell.
   They are not an `app_user`, have no `verify_login` path, no role, no nav.
4. **Tenant + project isolation.** `company_id` from the token walls tenant A's sales
   person out of tenant B. If project-scoped, the board and `reserve_unit` reject units
   outside scope server-side.
5. **No public link, ever.** Access is per-person (a `sales_users` row) via PIN or a
   per-person magic token that is **revocable** (`is_active=false`) and TTL'd — exactly
   like the buyer-portal magic link. There is no anonymous "browse inventory" URL.
6. **Anon GRANT is fine** because — as in the buyer portal — anon is just the Postgres
   role the SPA connects as; the scoped session token, validated inside each DEFINER
   function, is the real enforcement. RLS stays on as defence-in-depth.

---

## 5. UI (warm kit, English, mobile-first)

### Sales person — light SPA `sales-portal.html` (standalone, KIT.md tokens)
Rebuilt on the foundation kit (Inter, indigo `--fk-primary`, `.num`, Lucide — **no**
gradients/emoji/orbs; learn from the buyer-portal's off-brand prototype, don't copy its
look). Phones are the primary device.
- **Login** — Company Code + Phone + PIN, **or** land directly via magic link
  (`sales-portal.html?t=<token>` → `sales_magic_login`). Session in
  `sessionStorage('rms.sales.token')`.
- **Availability Board** — the **building-stack / occupancy visual reused from the
  Categories page**: floors as rows, units as cells coloured by status
  (`AVAILABLE` green / `RESERVED` amber / `SOLD` muted). Reserved cells show **who
  reserved · client · expiry countdown**. Filter by floor/project (within scope). This is
  the home screen.
- **Reserve** (tap an Available unit) — `NX.modal`: Client name *, Client phone, Expiry
  (segmented 3 / 7 days), **Token received** toggle + **Token amount** + Note. A clear
  one-liner: *"Recording the token here does not post a payment — hand cash to the office
  as usual."* On submit → `reserve_unit` → optimistic lock + toast.
- **My Reservations** — `NX.table`/cards of the sales_user's own reservations: unit,
  client, expiry countdown (amber when <24h), status badge, **Cancel** (own active only),
  and **Confirm booking** CTA (→ convert; gated per Open Question B).
- **Light dashboard** — three KPI chips (My active reservations · Converted this month ·
  Available in my scope) above the board. Restraint, not clutter.

### Admin — inside `#s-app`
- **Sales Access** admin page (Admin area) — manage `sales_users` (add / deactivate /
  reset PIN / copy magic link), each row showing last login + active-reservation count,
  and a header badge **"Sales access: 7 / 15"** (`check_sales_access_limit`). The "Add
  sales person" form mirrors the Users modal but writes `sales_users`, **not**
  `app_users`, and shows the temp PIN + magic link on-screen (buyer-portal style).
- **Units page (live)** — a reserved unit already renders with the `RESERVED` (amber)
  status chip via `units.status_id`; we enrich the chip/tooltip with **"Reserved by Ahmad
  for {client} · expires in 2d"** from `reservations`. Zero new status logic — the flip
  is the existing `status_id`.
- **Reservations** admin view (`get_reservations_admin`) — warm `NX.table`: unit · client
  · reserved-by · token recorded · expiry countdown · status, with **Confirm → New Sale**
  (prefilled) and **Cancel** (override) actions. KPI strip: Active · Expiring today ·
  Converted · Expired.

---

## 6. Subscription wiring

- New column `subscription_plans.max_sales_users` (seeded 15 / 25 / 50; trial 2;
  enterprise 999). `check_plan_limit` gains a **`'sales_users'`** branch that counts
  `sales_users WHERE company_id = ? AND is_active = true`.
- `create_sales_user` calls `check_plan_limit(company,'sales_users')` **before** insert —
  identical to how `create_app_user` gates on `'users'`.
- **What the admin sees at the cap:** the "Add sales person" button shows **"(15/15)"**
  and is disabled (mirroring the live "(1/1)" user-seat behaviour); attempting anyway
  returns `{error:'plan_limit'}` and the UI shows *"You've used all 15 sales accesses on
  Basic. Upgrade to Pro for 25, or deactivate an unused sales person."* Never a dead end —
  deactivating a sales person frees a slot immediately.
- **Fail-open** (house rule): if no subscription/plan is found, `check_plan_limit`
  already returns `can_add:true` — keep that posture; never wall on a missing plan.

---

## 7. Worked example

1. **Admin adds Ahmad.** Admin → Sales Access → "Add sales person": name *Ahmad*, phone.
   `create_sales_user` checks `check_plan_limit('sales_users')` → **1 of 15** on Basic →
   inserts a `sales_users` row, returns PIN `4821` + a magic link. **No paid user seat is
   consumed** (admin/user count unchanged). Admin WhatsApps Ahmad the link.
2. **Ahmad logs in (light access).** Taps the link → `sales_magic_login` issues an 8h
   `sales_sessions` token → he lands on the **Availability Board** in `sales-portal.html`.
   He cannot see clients, money, or the RMS — only the board.
3. **Ahmad opens the 9th floor.** Building-stack shows 5 green (Available) cells. He taps
   **9-03** → Reserve form → client *"Mr. X"*, phone, expiry **7 days**, **token received
   ₨50,000**, note. Submit → `reserve_unit`: row-locks unit 9-03, confirms it's Available,
   inserts the reservation (`reserved_by=Ahmad`, `token_amount=50000` **recorded, no
   payment posted**), flips `units.status_id` → **RESERVED**, commits.
4. **The admin's RMS updates live.** On the Units page, 9-03 now shows the amber
   **Reserved** chip — *"Reserved by Ahmad for Mr. X · expires in 7d"* — pulled from the
   same `units.status_id` + `reservations` row. One source of truth.
5. **Nobody else can touch 9-03.** Another sales person tapping 9-03 gets
   `unit_unavailable`; the `FOR UPDATE` lock + partial unique index make a second active
   reservation impossible. The admin can't accidentally re-reserve or re-sell it either.
6. **Mr. X confirms.** Admin (or Ahmad, per Open Question B) hits **Confirm booking** →
   New Sale opens **pre-filled** (unit 9-03, client, ₨50k token note) → completes →
   `create_sale_with_schedule` flips 9-03 → **SOLD** → `mark_reservation_converted` links
   the sale. Done.
7. **Or it expires.** If 7 days pass with no confirm, `cron_expire_reservations()` sets
   the reservation `expired`, flips 9-03 back to **AVAILABLE**, and alerts the admin.
   Inventory frees itself.

---

## 8. Build phases

- **Phase 1 — Foundation + the lock.** `sales_users` + `sales_sessions` tables;
  `create_sales_user` / `sales_login` / `sales_magic_login`; `reservations` table + the
  partial unique index; `get_availability_board` + `reserve_unit` (with the `FOR UPDATE`
  lock); the light `sales-portal.html` (login + board + reserve). *Ship the killer
  anti-double-book demo first.*
- **Phase 2 — Convert + expiry + token record.** `get_reservation_for_conversion` +
  `mark_reservation_converted` wired into New Sale prefill; `cancel_reservation` +
  `get_my_reservations`; `cron_expire_reservations()` + admin alert; token-record fields
  finalised on the reserve form.
- **Phase 3 — Subscription limit + admin surface + polish.** `max_sales_users` column +
  `check_plan_limit` branch + `create_sales_user` enforcement + admin "X / 15" badge; the
  admin **Sales Access** page + **Reservations** view; Units-page reserved-by enrichment;
  warm/mobile polish + `?v=` cache-bust.

---

## 9. TWO open business questions for the owner (please decide)

**A. Sales-person scope — any project, or only admin-assigned?**
`sales_users.project_id` supports both. *NULL* = the sales person can reserve in **any**
project the company owns; *set* = locked to **one** assigned project (board + reserve are
filtered server-side). Multi-project assignment would need a small join table later.
→ Which is the default for a new sales person?

**B. Convert reservation → sale — free for the sales person, or admin approval?**
Option 1: the sales person hits "Confirm booking" and the sale is created directly (fast,
but they'd be initiating a financial booking from the light app). Option 2: "Confirm" only
*flags* the reservation; an **admin** completes the New Sale (tighter control, fits the
existing Approvals Engine, keeps money decisions with the office). The plan currently
assumes **Option 2** (sales person reserves; admin converts) as the safer default — confirm
or override.

---

### Appendix — exact new surface
- **Tables:** `sales_users`, `sales_sessions`, `reservations` (+ `subscription_plans.max_sales_users` column + `reservations_one_active_per_unit` partial unique index).
- **RPCs:** `create_sales_user`, `deactivate_sales_user`, `reset_sales_user_pin`, `check_sales_access_limit`, `sales_login`, `sales_magic_login`, `get_availability_board`, `reserve_unit`, `cancel_reservation` (+ `admin_cancel_reservation`), `get_my_reservations`, `get_reservations_admin`, `get_reservation_for_conversion`, `mark_reservation_converted`, `cron_expire_reservations`.
- **Cron:** `cron_expire_reservations()` (pg_cron, hourly — same shape as `cron_expire_subscriptions`).
- **Pages:** `sales-portal.html` (new standalone light SPA); admin **Sales Access** + **Reservations** pages in `#s-app`; Units-page reserved-by enrichment.
- **Reused unchanged:** `category_unit_statuses` (AVAILABLE/RESERVED/SOLD), `create_sale_with_schedule`, `check_plan_limit`, the Approvals Engine, the buyer-portal magic-link/session pattern, the Categories building-stack visual.
</content>
</invoke>
