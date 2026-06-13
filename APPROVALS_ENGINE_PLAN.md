# Approvals Engine — Architecture & Build Plan (owner review before build)

Read-only inventory + design. **No code changed.** Date: 2026-06-13. Verified against
live RMS DB (`itqxljtfbrppntgyfush`): every table/column/RPC body below was dumped from prod.

---

## 0. Headline — the engine is ~80% built and well-architected (and one bug kills it)

The reskin's "found-not-fixed" notes are **partly stale**. The live DB already has a real,
bank-style maker-checker engine:

| Piece | Status (verified) |
|---|---|
| Parked-payload pattern (park → approve → replay) | **BUILT** — `create_approval_request` + `approve_request`'s 13-branch CASE replays each type via `_*_core` appliers |
| Per-company config store | **BUILT** — `company_restriction_rules(company_id, action, level, threshold jsonb)` |
| Config reader RPC | **BUILT** — `_rms_restriction_level(company, action)` (reskin said "no reader RPC" — wrong) |
| Reject path | **BUILT** — `reject_request(id, comment)` is clean and works (reskin confirmed) |
| Enforcing write RPCs | **BUILT for 9** — `edit_sale`, `request_discount_change`, `cancel_payment`, `edit_payment_meta`, `edit_installment_schedule`, `execute_unit_transfer_v2`, `execute_unit_cancellation`, `update_client`, `delete_legal_case` already detect-and-park |
| The level model | **BUILT** — hard / warning / soft(=park), default `'soft'` |

**The one catastrophic bug** (confirmed): `audit_logs` has
`CHECK (action IN ('INSERT','UPDATE','DELETE'))`, but the engine writes
`action='approval_applied'` (in `approve_request`) and `action='restriction_warning'`
(in `edit_sale` and 9 other RPCs). That insert raises → caught by the function's
`EXCEPTION WHEN OTHERS` → **the whole transaction rolls back**. Net effect:
- **No approval of any type can ever apply** — every approve dead-ends, the parked payload
  never executes. Requests pile up forever.
- The **`warning` restriction level is equally dead** everywhere.
- So today the engine *parks* fine but can never *resolve* — the worst possible state
  (looks like it works, silently does nothing).

So the build is mostly **(a) fix the one bug that unblocks everything, (b) wire the few
genuinely-unenforced rules (new-sale DP/rate/schedule, PDC waiver), (c) make the numeric
thresholds actually read from config, (d) add real maker≠checker SoD.** Far less new
architecture than the prompt assumes — and that's the right outcome (the foundation is sound).

---

## 1. ARCHITECTURE — enforcement lives at the RPC, never the UI

**Principle (Configuration-over-Customization / law #13):** every behaviour that varies by
company is a **row in `company_restriction_rules`**, never a code fork. The same compiled
RPC serves every tenant; the tenant's config rows decide what trips and what happens.

**The enforcement contract (already the live pattern in `edit_sale` — adopt verbatim):**

```
write RPC (e.g. create_sale_with_schedule)
  │  1. compute the candidate write (validate inputs, derive amounts)
  │  2. TRIP TEST — does this write violate a configured rule?
  │       e.g. down_payment / net_amount  <  rule.threshold.min_dp_pct
  │     (no trip → execute normally and return)
  │  3. CONSULT LEVEL — level := _rms_restriction_rule(company, 'sale_down_payment').level
  │       • 'off'      → execute normally (rule disabled for this company)
  │       • 'warning'  → execute, write an advisory audit row, return applied+warned
  │       • 'soft'     → DO NOT execute. Park the FULL payload in approval_requests
  │                       (request_type, entity, reason, amount, severity). Return
  │                       { status:'pending_approval', request_id }.
  │       • 'hard'     → DO NOT execute. Return { error:'action_hard_blocked' }.
  ▼
approval_requests row (status=pending) ──► Approvals queue ──► admin/owner decides
  │
  ├─ approve_request(id, comment)  → replays the stored payload via the SAME _*_core
  │                                   applier the RPC would have called → writes happen
  │                                   EXACTLY as if the maker had had permission.
  └─ reject_request(id, comment)   → nothing executes; request closed 'rejected'.
```

Because the trip test + park happen **inside the SECURITY DEFINER RPC**, a user hitting
the RPC directly (bypassing the UI) is enforced identically — the UI is just a convenience.

### Concrete walkthrough — Sale with down-payment < 25%
1. Sales officer submits `create_sale_with_schedule({sale:{net_amount:10,000,000,
   down_payment:1,500,000,…}, installments:[…]})`. DP = 15%.
2. RPC validates, then **trip test**: `1,500,000 / 10,000,000 = 0.15 < 0.25` (the company's
   `sale_down_payment.threshold.min_dp_pct = 25`). Rule trips.
3. `_rms_restriction_rule(company,'sale_down_payment').level = 'soft'` (default).
4. RPC parks: `create_approval_request({ request_type:'sale_create', entity_table:'sales',
   project_id, title:'New sale — DP 15% (below 25% floor)', amount:10,000,000,
   comment:<officer reason>, payload:{ sale:{…}, installments:[…], trip:'min_dp_pct',
   observed:15, required:25 } })`. **No sale row is created yet.**
5. Officer sees "Submitted for approval." Owner opens Approvals → sees the full sale +
   the DP-trip reason → **Approve** → `approve_request` runs a NEW `'sale_create'` branch →
   `_create_sale_with_schedule_core(payload.sale, payload.installments)` → the sale +
   schedule are created now, atomically, with the approval stamped in audit.
   **Reject** → no sale ever exists; officer notified with the reason.

> The only new plumbing this requires: split `create_sale_with_schedule` into a thin
> guard wrapper + a `_create_sale_with_schedule_core` applier (so `approve_request` can
> replay it) — exactly how `edit_sale`/`_edit_sale_core` are already split.

---

## 2. THE `approve_request` FIX + how parked execution works

### 2a. The execution model (already correct — keep it)
`approve_request` does **not** re-run the maker's RPC; it **replays the stored payload
through the same `_*_core` applier**, e.g.:
- `sale_edit` → `_edit_sale_core(sale_id, company, payload.fields)`
- `payment_void` → `_cancel_payment_core(payment_id, company, me)`
- `payment_backdate` → `_edit_payment_meta_core(payment_id, company, …)`
- `schedule_change` → `_edit_installment_schedule_core(sale_id, company, payload.schedule)`
- `cancellation` → `_execute_unit_cancellation_core(… 40 fields from payload …)`
- `transfer` → `_execute_unit_transfer_v2_core(… payload …)`

This is the cleanest possible design (single source of truth for the write logic; the
guard wrapper and the approver both call the same core). **Recommendation: keep it, and
add two new branches:** `'sale_create'` → `_create_sale_with_schedule_core(...)`, and
`'pdc_waiver'` → `_pdc_apply_waiver_core(...)`.

### 2b. The bug fix (foundation of everything)
**Root cause:** `audit_logs_action_check = CHECK (action IN ('INSERT','UPDATE','DELETE'))`.
The engine writes four non-CRUD verbs: `approval_applied`, `restriction_warning`, and
(by design intent) `approval_rejected` / `restriction_block`.

**Fix — widen the constraint (additive, minimal, honest):**
```sql
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN ('INSERT','UPDATE','DELETE',
                    'approval_applied','approval_rejected',
                    'restriction_warning','restriction_block'));
```
- Why widen vs. remap to 'UPDATE': the summary audit row is semantically *not* an UPDATE —
  it's a governance event. Audit honesty matters more than constraint minimalism here.
  Widening is one DDL line, reversible, and unblocks all 10 engine functions at once.
- **Belt-and-braces:** `approve_request`'s `EXCEPTION WHEN OTHERS` currently masks the real
  failure as a generic `apply_failed`. Keep the handler but have it surface `SQLERRM`
  (it already does) — the audit fix removes the trigger, and we'll prove it in §7.

### 2c. SoD added to the decision (see §4) and the new branches — all in `approve_request`.

---

## 3. CONFIG — `company_restriction_rules` (already the right shape)

**Store (exists):** `company_restriction_rules(id, company_id, action text, level text,
threshold jsonb, created_at, updated_at)`. One row per (company, action).

- **`action`** — the rule key, e.g. `sale_down_payment`, `sale_discount`, `sale_rate_floor`,
  `sale_schedule_delivery`, `sale_edit`, `payment_edit`, `payment_void`, `payment_backdate`,
  `cancellation`, `pdc_waiver`, `schedule_change`, `transfer`.
- **`level`** — `'off' | 'warning' | 'soft' | 'hard'` (what happens when the rule trips).
  Default when no row exists = `'soft'` (per `_rms_restriction_level`). *Note: today there
  are zero rows for any company → every protected action defaults to requiring approval.*
- **`threshold`** — the numeric trip config (currently **defined but unused** — no RPC reads
  it yet; wiring it is part of this build):

| action | threshold jsonb (defaults) | meaning |
|---|---|---|
| `sale_down_payment` | `{"min_dp_pct": 25}` | trip if DP% < 25 |
| `sale_discount` | `{"max_pct": 10}` | trip if discount% > 10 |
| `sale_rate_floor` | `{"min_rate": 0}` | trip if price_per_sqft < floor (0 = off) |
| `sale_schedule_delivery` | `{"grace_days": 0}` | trip if last installment due_date > project.delivery_date + grace |
| `payment_backdate` | `{"max_days": 3}` | trip if payment_date < today − max_days |
| `payment_edit` / `payment_void` / `cancellation` / `transfer` | `{}` | **always** trips (no numeric gate) |
| `pdc_waiver` | `{"max_auto": 0}` | trip if waiver amount > max_auto |

**Reader to add:** extend the reader to return the threshold too, so write RPCs get both in
one call:
```sql
_rms_restriction_rule(p_company_id uuid, p_action text)
  RETURNS TABLE(level text, threshold jsonb)   -- COALESCE level→'soft', threshold→action default
```
(`_rms_restriction_level` stays as a thin wrapper for the 9 RPCs that only need the level.)

**Defaults / seeding:** a `_seed_default_restriction_rules(company_id)` helper inserts the
catalog above with sensible defaults, called from company signup (and a one-time backfill
migration for existing tenants). Absent a row, behaviour already falls back to `'soft'` +
the per-action default threshold baked into `_rms_restriction_rule`, so seeding is for
*visibility/editability*, not correctness.

**Settings page (spec only — don't build UI yet):** Admin → Settings → new **"Approvals &
Controls"** tab. One card per rule group (Sale / Money / Structure). Each rule row =
`[ Rule name ] [ level select: Off · Warn · Approval · Block ] [ threshold input(s) ]`.
Reads via a new `get_approval_settings(company_id)` (returns all rows merged with defaults),
writes via `save_approval_settings(company_id, jsonb[])` (upserts rows). Owner-only. The
existing `company_security_settings` (session/lockout/2FA) is a *separate* store — do not
conflate; this tab sits beside it.

---

## 4. SEPARATION OF DUTIES — maker ≠ checker

**Today:** `approve_request` checks only `_rms_is_admin(v_me)`. The owner can approve their
own request. No maker≠checker. That's the SoD gap.

**Design:**
- **Maker** = `approval_requests.requested_by`. **Checker** = `decided_by` (the approver).
- **Rule:** a checker may not approve a request they made — *when the company has another
  eligible approver*. Add to `approve_request`:
  ```
  IF v_req.requested_by = v_me.id
     AND EXISTS (other active owner/admin in company, id <> v_me.id) THEN
       RETURN { error:'self_approval_blocked',
                message:'This request must be approved by a different admin.' };
  END IF;
  ```
- **1-person tenant (owner is the only admin):** self-approval is **allowed but flagged** —
  stamp `payload`/audit with `self_approved=true` and write the audit row with
  `reason='self_approved_solo_admin'`. The governance trail records that maker=checker;
  this is the honest, auditable compromise for solo operators (banks call this a
  "dual-control exception" log).
- **Approver tiering (optional, config-driven later):** high-stakes actions
  (`cancellation`, `transfer`, `refund`) can require `level`-of-approver = owner (not just
  admin). v1: any admin/owner approves; record the tier in the rule's threshold
  (`{"approver":"owner"}`) for a future enforcement pass — **don't gate on it in v1** to
  avoid locking out admin-run tenants.
- Reject is symmetric but **self-reject is always allowed** (rejecting your own request =
  withdrawing it; `cancel_approval_request` already exists for clean withdrawal).

---

## 5. RULE-BY-RULE ENFORCEMENT TABLE

Legend — Status: ✅ live · 🔧 wire threshold into existing RPC · 🆕 new enforcement.

| # | Rule | Enforcing RPC | What trips it | action key | Default level | Approver | Status |
|---|---|---|---|---|---|---|---|
| **SALE** |
| 1 | DP below floor | `create_sale_with_schedule` | `down_payment/net_amount < min_dp_pct` (25%) | `sale_down_payment` | soft | admin | 🆕 |
| 2 | Discount above limit (at booking) | `create_sale_with_schedule` | `discount_pct > max_pct` (10%) | `sale_discount` | soft | admin | 🆕 |
| 3 | Rate below floor | `create_sale_with_schedule` | `price_per_sqft < min_rate` | `sale_rate_floor` | off* | admin | 🆕 |
| 4 | Schedule past delivery | `create_sale_with_schedule` | `max(installment.due_date) > projects.delivery_date + grace` | `sale_schedule_delivery` | soft | admin | 🆕 (sales.delivery_breach cols already exist) |
| 5 | Post-sale discount/deal amendment | `request_discount_change` · `edit_sale` | discount/price/status key touched by non-admin | `discount` · `sale_edit` | soft | admin | ✅ |
| **MONEY** |
| 6 | Receipt edit | `edit_payment_meta` | any meta change (always) | `payment_edit`/`backdate` | soft | admin | ✅ |
| 7 | Receipt delete / void | `cancel_payment` | always | `payment_void` | soft | admin | ✅ |
| 8 | Backdated receipt beyond N days | `record_payment` (create) · `edit_payment_meta` (edit) | `payment_date < today − max_days` (3) | `payment_backdate` | soft | admin | 🔧 edit ✅ / 🆕 create-side |
| 9 | Cancellation + refund | `execute_unit_cancellation` | always | `cancellation` | soft | owner | ✅ |
| 10 | PDC bounce-charge waiver | PDC clear/bounce RPC | `waiver > max_auto` (0) | `pdc_waiver` | soft | admin | 🆕 |
| **STRUCTURE** |
| 11 | Schedule restructure/reschedule | `edit_installment_schedule` | any schedule change | `schedule_change` | soft | admin | ✅ |
| 12 | Unit / client transfer | `execute_unit_transfer_v2` | always | `transfer` | soft | owner | ✅ |

\* rate floor defaults `off` (companies that don't sell by sqft shouldn't be gated); they opt in.

**Reality check:** 7 of 12 are already enforced (just dead-ended by the §2b bug). The new
work is rules **1–4** (one RPC: `create_sale_with_schedule`), **8 create-side**, and **10**
(PDC waiver) — plus threshold-reading on the existing ones (currently they read `level` but
ignore `threshold`, so e.g. discount "above limit" is really "any protected discount edit"
until we wire the numeric gate).

---

## 6. MIGRATION SCOPE (all additive; staged sign-off before each lands)

**DDL (1):**
1. Widen `audit_logs_action_check` (+ `approval_applied`, `approval_rejected`,
   `restriction_warning`, `restriction_block`). *The unblock-everything change.*
   *(No CHECK exists on `approval_requests` / `approval_request_comments` — verified — so new
   `request_type`/comment `action` values need NO constraint change.)*

**New / changed functions:**
2. `_rms_restriction_rule(company, action) → (level, threshold)` — new reader returning
   both; `_rms_restriction_level` kept as wrapper.
3. `create_sale_with_schedule` → split into guard wrapper + `_create_sale_with_schedule_core`
   applier; wrapper runs trip tests for rules 1–4 and parks (request_type `sale_create`).
4. `approve_request` → add branches `sale_create`, `pdc_waiver`; add **SoD self-approval
   check** (§4); audit fix is automatic via #1.
5. PDC clear/bounce RPC → split + `_pdc_apply_waiver_core`; trip test rule 10
   (request_type `pdc_waiver`).
6. `record_payment` (create) → add backdate trip test for rule 8 create-side
   (request_type `payment_backdate`, replays via existing `_edit_payment_meta_core` or a new
   `_create_payment_core`). *Verify `record_payment`'s exact name/shape before touching.*
7. Threshold wiring into existing enforcers (`request_discount_change`, `edit_payment_meta`)
   so they read `threshold` not just `level` (rules 5, 8-edit).
8. `_seed_default_restriction_rules(company)` + a backfill migration seeding all live
   companies (FG + ZZTEST) with the §3 defaults; hook into signup.
9. `get_approval_settings(company)` / `save_approval_settings(company, jsonb)` for the
   Settings tab (read/write the rule rows).

**No table drops, no column drops, no destructive change.** Every existing approval_requests
row and every `_*_core` applier is reused.

---

## 7. GROUND-TRUTH TEST PLAN (ZZTEST, per the staged-verify discipline)

All on ZZTEST (`a2915ce7…`), impersonating via the proven
`WITH imp AS (SELECT set_config('request.jwt.claims', '{"sub":"<auth_user_id>"}', false)) …`
pattern. Two officers needed to prove SoD (a **maker** sub-user + the **owner** checker).

**Phase 0 — prove the bug, then the fix.** Before the migration: create any approval request,
call `approve_request` → assert it returns `apply_failed` and the entity is unchanged
(reproduce the dead-end). Apply DDL #1 → re-approve → assert `success:true` **and the entity
actually changed**. This single test validates the foundation.

**Phase 1 — per-rule park→approve and park→reject (each of the 12):**
For every rule, drive the enforcing RPC with a value that **trips** it:
1. **Trips → parks:** assert RPC returns `pending_approval` + a new `approval_requests` row,
   and assert **the underlying entity is NOT yet changed** (e.g. no sale row for `sale_create`;
   payment still `received` for `payment_void`).
2. **Approve → applies:** `approve_request(id)` → assert `success:true` **and** the entity now
   reflects the change exactly (sale exists with the parked schedule; payment now `cancelled`;
   discount now the requested value). Hand-compute the expected end-state and compare.
3. **Reject path (separate request):** trip again → `reject_request(id)` → assert the entity
   is **still unchanged** and the request is `rejected`.
4. **No-trip → executes free:** drive the RPC with a compliant value (DP = 30%, discount = 5%)
   → assert it executes immediately with **no** approval row (proves the threshold gate, not a
   blanket block).
5. **level variations:** set the rule to `hard` → assert `action_hard_blocked` + no row + no
   change; set to `warning` → assert it executes **and** writes a `restriction_warning` audit
   row (this also re-proves DDL #1); set to `off` → assert it executes with no row, no audit.

**Phase 2 — SoD:**
- Two admins: maker submits, maker tries to approve own request → assert `self_approval_blocked`;
  owner (different admin) approves → success.
- Solo owner: owner submits + approves own → assert success **and** an audit row with
  `self_approved=true` / `reason='self_approved_solo_admin'`.

**Phase 3 — config round-trip:** `save_approval_settings` flips `sale_down_payment.min_dp_pct`
25→40 and `level` soft→hard; re-run rule 1 at DP 30% → now trips (was compliant) and is hard-blocked.
Proves Configuration-over-Customization end-to-end.

**Anchor numbers (hand-computed verification targets):** seed one ZZTEST sale at
net 10,000,000 / DP 1,500,000 (15%) → rule 1 trips (15 < 25); approve → sale exists with that
exact DP + the parked installment ladder summing to net − DP. Discount 12% on a 10,000,000 sale
→ rule 2 trips (12 > 10). Backdate a receipt 10 days → rule 8 trips (10 > 3). Each cleaned up
after (synthetic ids), like the Team Performance verification.

---

## Decisions for the owner (before build)
1. **Audit fix = widen the CHECK** (recommended) vs. remap engine verbs to 'UPDATE'. Recommend
   widen (audit honesty; one reversible DDL line; unblocks 10 functions).
2. **Default levels** — ship every rule at `soft` (approval-required) except `sale_rate_floor`
   = `off`? Or start *advisory* (`warning`) for the new sale rules so existing workflows aren't
   suddenly gated, then tighten? Recommend **soft for money/structure, warning for the four new
   sale rules at launch**, owner flips to soft when ready.
3. **SoD in solo tenants** — allow self-approval with a flagged audit (recommended) vs. block
   (would make a 1-person company unable to ever cancel/transfer).
4. **Approver tiering** (owner-only for cancellation/transfer/refund) — enforce in v1 or defer?
   Recommend **defer** (record the intended tier in config now, enforce in a later pass) so we
   don't lock out admin-run tenants.
5. **Scope of v1** — fix-the-bug + wire rules 1–4 + 10 + threshold-reading + SoD, OR a smaller
   first cut (just the bug fix + SoD, which already makes 7 live rules actually work)?
   Recommend a **two-step ship**: (A) DDL #1 + SoD + Settings reader/editor → the 7 built rules
   come alive immediately and are configurable; (B) the new sale/PDC rules. Lower risk, faster
   value.
