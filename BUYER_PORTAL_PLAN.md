# Buyer Portal — "Mera Hisaab" (Bomb #2) — Substrate Inventory & Build Plan

**Read-only audit, 2026-06-14.** Live DB target verified = RMS (`itqxljtfbrppntgyfush`).
No code written, no DB writes, no sends. **Plan → owner review before any build.**

**Headline:** like Bomb #1, this is **mostly built, not green-field.** A complete
standalone `buyer-portal.html` (1,795 lines), two backing tables, and **12 working
RPCs** already exist — and they return **real, correct data** (verified live). The work
is (1) **closing a serious cross-client security hole**, (2) **fixing the auth model for
the PK context** (email+password doesn't fit), (3) adding **downloads + uploads**, and
(4) a **warmth/mobile re-skin**. The data layer is the easy 80% that's already done.

> 🔴 **READ SECTION 2 FIRST.** Four buyer RPCs are reachable by *anyone* with the public
> anon key and leak any client's financials. This must be fixed before the portal is
> exposed to a single real user.

---

## 1. WHAT EXISTS

### The page — `buyer-portal.html` (standalone, 1,795 lines)
A full, self-contained SPA (not part of the `#s-app` shell). Points at the RMS project
with the public anon key (`SUPABASE_URL`/`SUPABASE_ANON_KEY` inlined). Screens:
- **Login** — Company Code + Email + Password (calls `portal_login`).
- **Forgot password** — enter CNIC → "we'll email a reset link" (UI only; see gaps).
- **Dashboard** — welcome strip, 4 summary cards, next-installment alert, unit grid,
  payment-progress bar, and **tabs**: Overview · Schedule · Receipts · Possession · NOC ·
  Support. Mobile breakpoints exist (`@media 600/768/900px`).
- Session token kept in `sessionStorage('rms.portal.token')`; 8-hour expiry.

**Design reality (matters for the re-skin):** the page is a **dark gold theme**
(`Sora` + `JetBrains Mono`, `#f5c842` gold, blurred floating "orbs", gradient progress
bars, glow shadows, emoji icons). This **directly violates the foundation KIT.md taste
laws** (Inter only, indigo `--fk-primary`, no gradients, no emoji, no glow, `.num` not
mono). It also has **marketing cruft pasted in** — a `#priceDrawer` pricing panel and a
**Crisp live-chat widget** (`CRISP_WEBSITE_ID`) that have no business in a buyer portal.
So: treat the HTML as a **working reference/prototype**, not the shippable UI.

### The tables (both backing the portal; **0 rows — never used in production**)
| Table | Columns | Role |
|---|---|---|
| `portal_clients` | `id, company_id, client_id, email, password_hash, temp_token, temp_token_expires_at, is_active, last_login_at, …, project_id` | one login per buyer; bcrypt password; 72h temp token; project-scopable |
| `portal_sessions` | `id, company_id, client_id, portal_client_id, session_token, expires_at, …, project_id` | issued by `portal_login`, 8h TTL |

### The RPCs — all `SECURITY DEFINER`; **tested live against a real FG sale, all return correct data**
| RPC | Signature | Returns | Auth gate | Status |
|---|---|---|---|---|
| `admin_invite_portal_client` | `(client_id, email, company_id)` | `{temp_password, email}` | **authenticated**, admin-only, tenant-checked | ✅ works; upserts `portal_clients`, **shows temp pw on screen** + queues an email (email never sends — see gaps) |
| `portal_login` | `(company_code, email, password)` | `{session_token, client_id, company_id, client_name, cnic, …}` | anon | ✅ works; bcrypt verify, tenant-scoped, 8h session |
| `portal_set_password` | `(company_code, email, temp_token, new_password)` | `{success}` | authenticated | ✅ works; consumes temp_token, min-8-char |
| `get_portal_access_status` | `(client_id, company_id)` | `{has_access, email, last_login_at}` | authenticated | ✅ admin-side status check |
| `get_portal_client_data` | **`(session_token)`** | client + **one** active sale + unit + floor | ✅ **session-gated** | ✅ works. ⚠️ returns only the **single most recent active sale**; `floor_label/block/bedrooms/bathrooms` hardcoded NULL |
| `get_buyer_sale_summary` | `(company_id, client_id, unit_id)` | name, CNIC, phone, price, paid, outstanding, next due | authenticated (not anon) | ✅ works — **but the page never calls it** (orphan; `get_portal_client_data` covers the summary) |
| `get_buyer_payment_schedule` | `(company_id, client_id, unit_id)` | array: installment #, due_date, amount_due/paid, balance, status, is_overdue | **anon — raw params** | ✅ works · 🔴 IDOR (§2) |
| `get_buyer_receipts` | `(company_id, client_id, unit_id)` | array: receipt#, date, amount, mode, **bank, cheque#**, status | **anon — raw params** | ✅ works · 🔴 IDOR (§2) · metadata only, **no PDF/URL** |
| `get_buyer_possession_for_portal` | `(client_id, unit_id, company_id)` | possession status | **anon — raw params** | 🔴 IDOR (§2) |
| `get_buyer_nocs_for_portal` | `(client_id, unit_id, company_id)` | NOC list | **anon — raw params** | 🔴 IDOR (§2) |
| `get_buyer_complaints` | **`(session_token)`** | complaint thread | ✅ **session-gated** | ✅ works |
| `submit_buyer_complaint` | **`(session_token, subject, message)`** | `{success}` | ✅ **session-gated** | ✅ works |

**Verified live** (real FG sale): `get_buyer_sale_summary` → *SUNDUS KHALIQ, CNIC
17301-…, unit 6-23, KHUSHAL BAGH HEIGHTS, price 8,400,000, paid 2,025,000, outstanding
6,375,000, next due 2026-07-02 / 495,000.* `get_buyer_payment_schedule` and
`get_buyer_receipts` both return populated arrays. **The data layer works.**

---

## 2. 🔴 THE SECURITY HOLE — cross-client IDOR (top priority, blocks launch)

**Confirmed by grant audit + code trace.** Four RPCs are **`GRANT EXECUTE … TO anon`** and
accept **raw `client_id` / `company_id` arguments with no session check**:
`get_buyer_payment_schedule`, `get_buyer_receipts`, `get_buyer_possession_for_portal`,
`get_buyer_nocs_for_portal`.

The anon key is **published in `buyer-portal.html`** (and the main app). The page itself
calls them with `d.client.company_id, d.client.id, d.unit.id` taken from the login
response — i.e. **client/company ids live in the browser**. Therefore **anyone** (no
login needed) can script the public anon key and call, for any guessed/enumerated
`client_id`+`unit_id`, and read **that buyer's full installment schedule, payment history
with bank names and cheque numbers, possession status, and NOCs.** This is a textbook
**Insecure Direct Object Reference** / cross-client data leak.

- `get_buyer_sale_summary` (which also leaks CNIC + phone) is `authenticated`-only and
  **uncalled** — lower risk, but same flawed shape; fix it too.
- The **session-token RPCs are safe** (`get_portal_client_data`, `get_buyer_complaints`,
  `submit_buyer_complaint`) — they derive `client_id`/`company_id` server-side from the
  validated token. **This is the correct pattern; the others must adopt it.**

**The fix (Phase 0):** every buyer data RPC must take **`p_session_token`** and derive
`client_id`/`company_id`/allowed `unit_id`s *inside* the function from `portal_sessions`
(rejecting expired/mismatched tokens) — drop the caller-supplied ids entirely. RLS is
**not** the lever here (these are `SECURITY DEFINER` and bypass RLS); **the scoped session
token is the enforcement boundary.** Until then, **do not expose the portal.**

---

## 3. WHAT'S MISSING (gap to a real client-facing portal)

| Need | State today | Gap |
|---|---|---|
| **See their unit** | `get_portal_client_data` returns it | works, but **single sale only** (multi-unit buyers see one) + floor/block/beds hardcoded NULL |
| **Payment schedule** | `get_buyer_payment_schedule` | works (after §2 re-gate) |
| **Paid / remaining** | summary RPC + schedule | works (after §2 re-gate) |
| **Receipt download** | `get_buyer_receipts` = **metadata only** | **no PDF, no URL.** Must render (reuse `reports/payment-receipt.html` + `NXPrint`) |
| **Statement download** | **nothing** | no statement RPC/PDF. Reuse `reports/account-ledger.html` / Recovery-Position logic |
| **Payment-proof upload** | **nothing for buyers** | no buyer upload RPC; no Storage policy for buyer writes. (`payment_proofs` table + `payment-receipts` bucket exist for the *admin* side — tie into that) |
| **Login that fits PK buyers** | email + password + admin invite | most buyers have no email / won't check it; invite email **doesn't even send** (below). See §4 |
| **Invite email delivery** | `admin_invite_portal_client` queues `channel='email'` | the `send-message` edge fn **only dispatches WhatsApp** (meta/wetarseel) → email rows never send. Mitigated only because the **temp password is returned on-screen** for manual relay |
| **DOB-based auth option** | **no DOB column on `clients`** (verified) | CNIC+DOB would need a schema add **and** a data backfill (KBH import lacks DOB) |
| **Hosting / route** | standalone file, not deployed anywhere confirmed | needs a subdomain or `/portal` route + cache-bust (`?v=`) |
| **Design** | dark-gold, mono, gradients, emoji, Crisp + price-drawer cruft | off-brand vs KIT.md; needs warm, mobile-first re-skin + cruft removal |

---

## 4. AUTHENTICATION DESIGN (PK context — critical)

**Constraints:** buyers open on **phones**; many have **no email** or never check it;
**Twilio SMS OTP is unreliable for PK numbers** (memory); **WhatsApp OTP depends on Bomb
#1** going live; **CNIC is not a secret** (printed on every document) so CNIC-alone is
unacceptable; **no DOB data** exists, so CNIC+DOB needs schema + backfill we may not be
able to complete.

### Recommendation: **per-buyer magic link (primary), reusing the existing `temp_token`**
The substrate is already there — `portal_clients.temp_token` (72h). Promote it from a
"set-your-password" token to a **login link**:

1. Admin clicks **"Send portal access"** on a client → we generate a token and a URL like
   `portal.nexunova.app/?t=<token>` (regenerable; configurable TTL or long-lived-but-
   revocable). The temp password path already built stays as a fallback.
2. The **developer shares that link over WhatsApp/SMS/print/QR** — *manually for now*, so
   it **does not block on Bomb #1**. (When Bomb #1 is live, the same link auto-sends via
   the WhatsApp `portal_invite` template.)
3. Buyer taps link → optional **light CNIC confirm** (last 6 digits) to bind the device →
   server issues a normal `portal_sessions` token (the existing 8h session). No email, no
   password, no OTP infra.

**Why not the others as primary:**
- *Email + password (already built):* keep as a **"set a password to return"** convenience
  after first magic-link entry — but not the front door (email gap).
- *WhatsApp OTP:* the **best long-term self-service** flow; add it as an upgrade **once
  Bomb #1 is live** (explicit dependency — don't block Bomb #2 on it).
- *CNIC + DOB:* viable offline but needs a `clients.date_of_birth` column **and** a
  backfill; revisit only if the owner can supply DOBs. CNIC-only = rejected (not secret).

### Isolation (a buyer sees ONLY their own unit(s))
- **Enforcement = the scoped session token, server-side.** Every data RPC derives
  `client_id`+`company_id` from `portal_sessions` (per §2) and returns only sales/units
  where `sales.client_id = session.client_id`. The browser is **never trusted** with ids.
- Multi-unit: the token's `client_id` may own several sales → return a **unit picker**;
  each unit's data still filters by that same `client_id`.
- Tenancy: `company_id` from the token keeps tenant A's buyer out of tenant B entirely.
- RLS stays enabled as defence-in-depth, but is not the primary control (DEFINER RPCs).

---

## 5. THE BUILD — pages, RPCs, hosting

**Pages (warm, mobile-first — rebuild on KIT.md tokens; phones are the primary device):**
- **Mera Hisaab (Overview)** — hero: unit + project, big "Paid vs Remaining" journey-bar
  (`NX.journeybar`), next-installment card. Warm light, Inter, indigo, `.num`, Lucide —
  **no** gradients/orbs/emoji/Crisp/price-drawer.
- **Schedule** — installment table (`NX.table`), overdue rows tinted.
- **Receipts** — list + **Download PDF** per receipt.
- **Statement** — one-tap full-account PDF.
- **Documents/NOC · Possession · Support (complaints)** — already have RPCs.
- **Upload proof** (Phase 3) — camera/file upload for a deposit slip.

**RPCs:** reuse `get_portal_client_data`, `get_buyer_payment_schedule`,
`get_buyer_receipts`, `get_buyer_possession_for_portal`, `get_buyer_nocs_for_portal`,
`get_buyer_complaints`, `submit_buyer_complaint` — **all re-gated to `p_session_token`
(§2)**. New: `get_buyer_statement(session_token, unit_id)` (or reuse Recovery-Position
math) and `buyer_upload_payment_proof(session_token, unit_id, file_ref, amount, note)`
writing into the existing `payment_proofs` / `payment-receipts` bucket for admin review.
Receipt/statement PDFs reuse `reports/payment-receipt.html` + `account-ledger.html` via
`NXPrint`.

**Hosting/route:** deploy `buyer-portal.html` (rebuilt) at a **dedicated subdomain**
(e.g. `portal.nexunova.app`, or a per-tenant `coname.portal.…`) **or** an app `/portal`
route — separate from the staff `#s-app` shell. Remember the **`?v=` cache-bust rule** on
every asset.

---

## 6. BUILD ORDER (phased)

- **Phase 0 — SECURITY (must ship before any exposure).** Re-gate the 4 anon raw-param
  RPCs (+ `get_buyer_sale_summary`) to `p_session_token`; revoke anon on the raw shapes.
  Verify an attacker with the anon key + a foreign `client_id` gets `unauthorized`.
- **Phase 1 — View-only "Mera Hisaab" + magic-link auth.** Magic-link login (reuse
  `temp_token`); warm mobile rebuild; Overview / Schedule / Paid-Remaining / Receipts
  (view) / Unit; multi-unit picker; strip Crisp + price-drawer; deploy to the route.
- **Phase 2 — Downloads.** Receipt PDF + full statement PDF (report templates + `NXPrint`).
- **Phase 3 — Interactive.** Payment-proof upload (Storage policy + RPC + admin review
  tie-in); complaints (wire the built RPCs); **WhatsApp OTP self-service once Bomb #1 is
  live** (auto-send the magic link/OTP via the `portal_invite` template).

**Demo-script line:**
> "Your buyer is sitting at home — you WhatsApp him one link. He taps it, confirms the
> last 6 digits of his CNIC, and there it is on his phone: his unit, *2,025,000 paid of
> 8,400,000*, next installment 495,000 due 2 July — and a button to download his receipt
> as a PDF. He never calls your office to ask 'kitna baqi hai?' again."

---

### Appendix — exact substrate
- **Page:** `buyer-portal.html` (standalone SPA, dark-gold, not nx-kit; carries Crisp +
  price-drawer marketing cruft to remove). Anon key + RMS URL inlined.
- **Tables:** `portal_clients` (0 rows), `portal_sessions` (0 rows) — both `project_id`-aware.
- **RPCs (12):** `portal_login`, `portal_set_password`, `admin_invite_portal_client`,
  `get_portal_access_status`, `get_portal_client_data`*, `get_buyer_sale_summary`,
  `get_buyer_payment_schedule`†, `get_buyer_receipts`†, `get_buyer_possession_for_portal`†,
  `get_buyer_nocs_for_portal`†, `get_buyer_complaints`*, `submit_buyer_complaint`*.
  *(\* = session-token-gated, safe; † = anon + raw-param, **IDOR, fix in Phase 0**)*
- **Buckets (reuse):** `payment-receipts` (private), `recovery-documents` (public),
  `rms-documents` (public).
- **Report templates to reuse:** `reports/payment-receipt.html`, `account-ledger.html`,
  `installment-schedule.html` + `NXPrint`.
- **Gaps confirmed live:** no `clients` DOB column; `send-message` edge fn dispatches
  **WhatsApp only** (invite email never sends — temp pw shown on screen instead);
  `get_portal_client_data` returns a single sale (multi-unit gap).
- **WhatsApp-OTP auth dependency:** Bomb #1 (`WHATSAPP_SUITE_PLAN.md`) must be live first.
</content>
