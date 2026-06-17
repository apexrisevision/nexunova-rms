# Sale Agent Self-Service Sale + Admin Approval — Plan

**Date:** 2026-06-17
**Owner-approved concept.** Builds on the Availability & Reservation module (Phases 1–3, live).

## Core principle
**Sale Agent = Sale User = one identity.** A person who signs up through the sales
portal becomes a registered RMS **Sale Agent** (with an agent code / ID). That agent
then runs the *entire* sale themselves from the portal — capture client, enter the
deal + schedule — and the admin's only job becomes **review + approve**. Nothing
"real" lands in RMS until the admin approves the whole package atomically.

## Locked decisions (owner)
1. **Agent becomes real at SIGNUP-approval.** When admin approves a portal signup,
   a real `agents` row is created (agent_code, project, commission %). The person can
   then log in + reserve + submit sales. (One gate at onboarding; sale packages are a
   second, per-deal gate.)
2. **Duplicate client → admin links in review.** If the submitted client matches an
   existing client (CNIC/phone), the review screen flags it; admin links to the
   existing client instead of creating a duplicate.
3. **Plan limits — linked agent is EXEMPT from `max_agents`.** The person already
   consumed a sales-access seat (`max_sales_users`); the linked agent row does not
   also count against `max_agents`.
4. **"Under Sale Review" unit status.** Between submission and approval the unit shows
   a distinct status (not Available, not Sold). Approve → Sold; Reject → back to Reserved.

## Lifecycle
```
signup (sales_register, pending)
   │  admin approve  ──►  agents row created (ID, commission) + sales-access active
   ▼
LOGIN → Availability → reserve_unit            [unit: Reserved]
   │
   ├─ cancel reserve  (cancel_reservation)      [unit: Available]
   │
   └─ MARK SOLD → multi-step form
         Step 1: full client info  (not yet saved)
         Step 2: full sale + schedule (price/discount/net/plan/installments)
         SUBMIT → sale_submissions(status=pending) [unit: Under Sale Review]
                                                     reservation expiry FROZEN
            │
            ├─ admin REJECT (+reason)  → reservation stays active [unit: Reserved]
            │                            agent can re-submit
            │
            └─ admin APPROVE (atomic txn):
                  create_client (or link existing)
                  create_sale_with_schedule (agent_id = this agent)
                  reservation → converted (+converted_sale_id)
                  unit → Sold
```

## Phases

### Phase 1 — Identity link (sales_user ↔ agent)
- Add `sales_users.agent_id uuid REFERENCES agents(id)` (nullable).
- Add `agents.sales_user_id uuid` (nullable) for the reverse lookup, or rely on the
  FK above only — decide at build (single FK on sales_users is enough).
- Extend `admin_approve_sales_user(p_id, p_project_id, p_commission_percent)`:
  on approval, create the `agents` row (reuse `create_agent` internals; **skip the
  `max_agents` plan check** for linked agents per decision 3) and store `agent_id`
  back on the sales_user. Commission % set by admin in the approve dialog (default 2%).
- Admin Sales-Access UI: approve dialog gains a commission % field; the row shows the
  linked agent code once approved.
- (Optional, low-cost) Agent module "create agent" gains a "give sales-portal access"
  toggle that provisions a `sales_users` row with a temp PIN — symmetric path. Defer
  unless owner wants it now.

### Phase 2 — "Under Sale Review" status + portal Mark-Sold + submission
- **Migration:** seed a new `category_unit_statuses` row per project:
  `status_code='SALE_REVIEW'`, name "Under Sale Review", `is_available=false`,
  distinct color. Backfill across existing projects; add to project seeding
  (`seed_default_categories`) so new projects get it too.
- **`sale_submissions` table:** id, company_id, project_id, unit_id, reservation_id,
  submitted_by (sales_user_id), agent_id, client_payload jsonb, sale_payload jsonb,
  schedule_payload jsonb, matched_client_id (nullable, set during review),
  status ('pending'|'approved'|'rejected'), reject_reason, created_at, decided_at,
  decided_by. RLS deny-all; DEFINER RPCs only.
- **Portal RPCs (session-token gated):**
  - `submit_sale(p_session_token, p_reservation_id, p_client jsonb, p_sale jsonb, p_schedule jsonb)`
    — validates reservation is active + owned by caller; row-locks the unit;
    inserts `sale_submissions(pending)`; sets unit → SALE_REVIEW; freezes reservation
    expiry (e.g. expiry_date = far future or a `review_hold` flag honored by the cron).
  - `get_my_submissions(p_session_token)` — agent sees their pending/approved/rejected.
  - `cancel_my_submission(p_session_token, p_id)` — withdraw while pending → unit back
    to Reserved.
- **Cron guard:** `cron_expire_reservations` must skip reservations that have a pending
  submission (don't auto-expire a deal under review).
- **Portal UI (sales-portal.html):** "My Reserved Units" gets per-unit actions:
  Cancel reserve | Mark Sold. Mark Sold opens the 2-step form (client → sale+schedule),
  reusing the RMS field set (incl. KBH application-form fields). Shows
  "Under Sale Review" badge after submit.

### Phase 3 — Admin approval queue + atomic commit
- **Admin RPCs (`_rms_caller` + `_rms_is_admin` gated):**
  - `get_sale_submissions_admin(company, project, status)` — list with unit/client/agent
    summary + a duplicate-client hint (match on CNIC/phone).
  - `get_sale_submission_detail(p_id)` — full payloads for review (editable on client side).
  - `approve_sale_submission(p_id, p_overrides jsonb, p_client_id_to_link uuid)` —
    **one transaction:** create/link client → `create_sale_with_schedule` (agent_id set)
    → `mark_reservation_converted` → unit → Sold → submission → approved. `already_sold`
    guard like `convert_reservation_prefill`. `p_overrides` lets admin tweak
    price/schedule before commit.
  - `reject_sale_submission(p_id, p_reason)` — submission → rejected, reservation stays
    active, unit → Reserved.
- **Admin UI:** new "Sale Submissions" review page (or a tab under Reservations /
  Approvals) — package view, edit-before-approve, approve/reject with reason.

## Cross-cutting — Photo / CNIC capture (camera + browse) [owner add 2026-06-17]
Wherever the app captures a person's photo or CNIC, offer BOTH **Take photo (camera)**
and **Browse (file)** — today every uploader is browse-only (no camera affordance).
- Build ONE reusable widget `NX.capture(slotId, { bucket, folder, label, accept })`
  rendering: 📷 Take photo (`<input type=file accept="image/*" capture="environment">`),
  📁 Browse (`<input type=file accept="image/jpeg,image/png,application/pdf">`), a
  thumbnail preview, and a hidden url field. Uploads via the existing
  `_handleFileUpload` (ui.js) → returns public URL. Mobile camera opens the rear cam;
  desktop falls back to the file dialog.
- **Storage:** signup/agent → `agent-documents`; client/nominee → `rms-documents`
  (match the buckets each form already uses).
- **Locations to wire it:**
  1. Sale-agent **signup** (sales-portal.html): profile photo + CNIC front + CNIC back
     → stored on `sales_users` (cols added P1) → copied to the agent on approval.
  2. **Client** capture (Mark-Sold form + existing `client-form.js`): client photo +
     client CNIC front/back.
  3. **Nominee** (client-form.js next-of-kin): nominee photo + nominee CNIC front/back.
  4. **Agent module** create/edit form (agents.js): retrofit its existing browse-only
     photo + CNIC F/B inputs to the camera+browse widget.
- DB already has the columns: `agents.profile_photo_url/cnic_front_url/cnic_back_url`,
  `sales_users.*` (added in P1); clients store via existing client jsonb/photo fields.
- sales_register signature gains `p_profile_photo_url/p_cnic_front_url/p_cnic_back_url`
  (DEFAULT NULL) when the signup form is built (Phase 2).

## Mandatory field sets (derived from the live RMS forms) + KYC [owner 2026-06-17]
**Sale Agent (signup must collect the full profile — admin only adds commission% +
project at approval):** full_name*, father_name*, phone*, CNIC#*, address* (identity);
email (optional); KYC docs — profile photo*, CNIC front*, CNIC back* (*=required, all
server-enforced; process blocks without them). Bank details were DROPPED from signup
(owner 2026-06-17) — admin can add payout later in the agent module. Source:
`create_agent` + agents.js form. Admin-managed (NOT self-signup): commission%, project,
territory, targets, parent agent, contract, status.
**Guided KYC capture:** the portal camera is NOT the raw full-frame camera — it shows a
CNIC-sized box (landscape 1.585) / face box (portrait) overlay via getUserMedia; the
capture is cropped to that frame so the doc/face fills it cleanly. Browse is the
fallback. (sales-portal.html `.cam*` CSS + `capCamera/capShoot/capCloseCam` JS.)
**Client (Mark-Sold step 1) — mandatory:** full_name, father/husband name,
phone_primary, CNIC (or passport if overseas), project. Optional: address/city/country,
2nd phone, whatsapp, email, category, reference_by, lead_source, occupation,
company_name, monthly_income, NTN, notes, CNIC front/back, bank (name/title/no/IBAN),
nominee (name/relation/phone/CNIC/photo), client photo. Source: `client-form.js` +
`create_client(p_data jsonb)`.
**Sale (Mark-Sold step 2) — mandatory:** unit_id, area_sqft, price_per_sqft, discount,
down_payment; schedule = installments[] of {installment_number, installment_type
(down_payment|installment), due_date, amount_due, notes}. Optional: co_buyer
(name/cnic/share%), nominee (name/cnic), booking_date. Server derives gross=price*area,
net=gross-discount; restriction rules (min DP%, max disc%, rate floor) already fire in
`create_sale_with_schedule(p_sale jsonb, p_installments jsonb)`.
**KYC:** signup REQUIRES photo + CNIC front + back + CNIC# (server-enforced
`kyc_required`); `sales_users.kyc_status` = pending→ admin reviews the docs in the
approve dialog → approval sets `verified` (human verification = the KYC gate).
Client KYC mirrors this in the Mark-Sold/approval flow (P3).

## Reuse (no parallel paths)
- `create_sale_with_schedule` — the ONE sale path (admin already uses it).
- `create_client` / client-core updaters — the ONE client path.
- `mark_reservation_converted`, `convert_reservation_prefill` guards — reuse the
  already-sold / double-convert protections.
- Session-token + `_rms_caller` security posture — identical to existing reservation RPCs.

## Open / defer
- Symmetric "agent module → portal access" toggle (Phase 1 optional bullet).
- Whether admin can edit the schedule line-by-line in review, or only approve/reject
  as-submitted (recommend: allow edit).
- Notifications to the agent on approve/reject (toast in portal; WhatsApp later).
