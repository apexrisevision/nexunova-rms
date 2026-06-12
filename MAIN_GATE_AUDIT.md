# MAIN GATE AUDIT — Signup → OTP → Login → Onboarding → Users
**Scope:** the complete first-touch journey of Nexunova RMS, audited against the owner's refined identity model.
**Method:** read-only code/RPC/edge-function review + a **real prod walkthrough** driven by Puppeteer against a freshly self-created tenant.
**Date:** 2026-06-12 · **Auditor session:** read-only + ZZTEST2 scratch tenant only (Fourteen Group + ZZTEST untouched).
**Mailer:** Resend (confirmed live — `send-otp-email` returned HTTP **200** during this run).

> **Test tenant created via the real signup UI:** company **“ZZTEST2 Gate Audit”** → handle **`zztest2gateaudit`**, owner email `zztest2.gate@nexunova.test`.
> Owner login after the recovery test = `zztest2gateaudit` / `NewPass!2026` (password was rotated by the forgot-password E2E). Plan was bumped trial→ultimate to exercise user limits.
> Screenshots: `migration_work/gate_shots/` (A* = signup, C*/W* = login+wizard, D* = users). Driver scripts: `migration_work/gate_*.js`.

---

## ✅ FIXES APPLIED — 2026-06-12 (migration `supabase/migrations/20260612_main_gate_fixes.sql`)
Verified end-to-end on a brand-new **ZZTEST3** tenant created through the real UI with zero manual DB intervention (screenshots `migration_work/gate_shots/zz3_*`):
1. **BLOCKER — wizard project_code:** `upsert_project` now mints/uniquifies a code (new `generate_project_code`); the wizard also sends an `auto_code` suggestion. Fresh signup → wizard completes **Project→Floors→Types→Units→Done** with no error.
2. **OTP is now the real gate + double-verify collapsed:** `signup_new_company` requires a server-`verified_at` `email_otps` row (proven: wrong OTP → `invalid_otp`, missing → `email_not_verified`) and creates the owner `email_verified=true`, so the existing app_users→auth.users **auto-bridge mints a CONFIRMED identity** — login works immediately, **no GoTrue activation link / second email**.
3. **User identity per spec:** Add-User has a **Username** field (signs in as `username@companycode`); **email is optional** — when blank a synthetic `<username>.<companycode>@users.internal` plumbing identity is minted (never mailed, hidden in UI, GoTrue login verified). Admin reset shows the temp password **on-screen** for users without a real email; both paths set `needs_password_reset` (forced change proven).
4. **Audit (#7 correction):** `app_users` already carries the generic `audit_trigger_function` (actor/target/changed_fields/IP) — so the original report's "not logged" was overstated. This phase adds a semantic `reason` tag (`user_created` / `password_reset` / `user_status_change` …) via a transaction-local GUC; `audit_logs` now shows every credential action with a clear label + actor.
5. **Wizard rough edges:** all raw-Postgres error text replaced with human messages; Floor-**Code** column explained; Types tip de-jargoned; "no floors" guidance added; type/status caches refreshed after the project insert (Types step no longer empty); **`mark_onboarding_complete` is now awaited** so a finished wizard never re-opens on next login.

Regression (note 2): FG/ZZTEST/ZZTEST2 logins unchanged; `verify_login` untouched.

---

## 1. Step-by-step trace (real UI, with click ledger)

### A. SIGNUP — 5-step wizard (`login.html#s-signup`, controller `js/pages/signup.js`)
The landing CTA and `signup.html` both funnel into the same in-app 5-step wizard.

| Step | Screen | Fields asked | Clicks to pass | Screenshot |
|---|---|---|---|---|
| 1 | **Personal Info** | Full name, **Work email**, Phone | type ×3, **“Verify Email →”** (1), OTP digits (6) + **Verify** (1), **Continue** (1) | `A1`, `A2`, `A3` |
| 2 | **Your Company** | Company name, Type, Country, City, **Business address** | type, **Continue** (1) | `A4`, `A5` |
| 3 | **Set Password** | Password + Confirm (live strength meter) | type, **Continue** (1) | `A6` (weak rejected), `A7` |
| 4 | **Choose a Plan** | Monthly/Yearly toggle, 4 plan cards | select plan (1), **Continue** (1) | `A8` |
| 5 | **Review & Confirm** | Summary + **Terms** checkbox | check (1), **Create Account** (1) | `A9` |
| — | **Result** | Username box (copy) + activation notice | — | `A10` |

**Happy-path click count:** ~9 button clicks + 6 OTP digits beyond typing. Clean, modern, dark UI; progress rail with check-marks; per-field inline validation; password visibility toggles; caps-lock warning.

**What the gate actually does, field by field:**
- **Company-code suggestion / uniqueness:** there is **no company-code field**. The handle is *auto-derived* from the company **name** (`lower`, strip non-alphanumeric, ≤20 chars, +numeric suffix on collision). Live availability is checked via `check_company_available` (on the slug). To get a different code you must change the **name** (the Step-2 error literally says *“choose a different company name”*).
- **Email existence:** `check_company_email` (anon) → “This email is already registered” if taken (Step-1 enforces this before allowing OTP).
- **Password policy:** canonical `validatePasswordStrength` — **min 8 + upper + lower + number + special + common-password blocklist**. `123456` is **rejected** (proven, `A6`). Strength meter Weak→Strong.
- **Bot defenses:** hidden honeypot (`sg-hp`) + a 3-second time-trap on submit.

### B. OTP (email verification) — `send_signup_otp` / `verify_signup_otp` → `send-otp-email` (Resend)
- **Does it send?** **Yes.** Clicking “Verify Email” inserted a hashed 6-digit code into `email_otps` (10-min TTL, bcrypt hash) and `send-otp-email` returned **HTTP 200** from Resend (edge logs confirmed, timestamp matched the run).
- **Overlay** (`A3`): 6-box code entry, “Code sent — check your inbox”, a 5:00 countdown, and **“Resend in 29s”** throttle. Server rate-limit = **3 sends / hour**; verify allows **5 attempts** then forces a new code.
- **Abandon mid-OTP:** no account is created until final submit, so abandoning at the OTP screen leaves only an `email_otps` row — **no orphan account** at this stage. (Orphans appear *after* submit — see S4.)
- ⚠️ **The OTP is not server-enforced** — see **S2** below.

### C. FIRST LOGIN (`js/auth.js` → `verify_login`)
- **Identity format:** the login box placeholder is literally **`username@COMPANYCODE`**. `doLogin` splits on the last `@`; **a bare entry sets username = company code**. Because the **owner’s username == the company code == the name-slug**, the admin simply types the handle (e.g. `zztest2gateaudit`) — **no `@`, case-insensitive**. So *“samsung” alone works for the admin*; staff use `recovery@SAMSUNG`. ✔ matches the “shorthand” intent (caveat: the product calls it *“username”*, the spec calls it *“company code”* — same string).
- **Login proven live:** typed the bare handle + password → app loaded, wizard auto-launched (`C2`: `appOn:true, obOn:true`).
- **Lockout:** **proven live** — 5 wrong passwords → `account_locked` with a `locked_until` (15-minute lock); `failed_login_attempts` increments, resets on success.
- **Email gate:** `email_verified=false` → login blocked with a “Resend confirmation email” affordance.
- **Forced password change:** `needs_password_reset` **or** expired password → blocking overlay before the app renders (`change_password`, enforces full policy + last-3 history + 90-day expiry).
- **Session/idle:** real Supabase JWT bridged via `signInWithPassword`; idle timeout (default 30 min) with a 60-s warning bar; 5-min session-version poll; device/session registered in `user_sessions`.

### D. ONBOARDING WIZARD (`js/pages/onboarding.js`, `OB`) — Project → Floors → Types → Units → Done
- First login **does** auto-launch the wizard when `onboarding_complete=false` (`C2`).
- 🔴 **It cannot be completed by a new tenant — see BLOCKER S1.** Step 1 (“Create project”) fails with a raw Postgres error (`C4`/`W_units` show the dead state). After seeding a project to get past it, the rest renders well: **Floors** (Ground / Upper-Ground / N numbered, each with an editable **code** used in unit naming), **Types** (10 seeded types, area/price defaults — `W_types`), **Units** (bulk `{floor}-{NN}` generator with preview), **Done**. Floor creation verified (9 floors written to DB). `bulk_create_units` correctly enforces the plan’s unit cap.

### E. USER MANAGEMENT (`js/pages/users.js` → `create_app_user` / `update_app_user`)
- Live create proven (`D2`→`D4`): added “Bilal Recovery”. **The generated identity is `@recovery`** — i.e. **username = the role**, not a chosen name (second recovery user would be `recovery2`). Owner card shows `@zztest2gateaudit`.
- **Email is required by the server** (`email_required`) even though the modal labels **Email** as optional (no `*`). Proven live: blank email → *“A valid email is required to create a user.”* (`D3`).
- **Temp password + forced change:** “Reset Pwd” → `admin_reset_subuser_password` sets `needs_password_reset=true`, bumps `session_version`, and **emails the temp password** (Resend `temp_password` template). First login then forces a change. ✔
- **Deactivate/Activate** via `update_app_user(p_status)`. Owner can’t deactivate self/owner.
- **Plan limit:** enforced **client + server**. On trial the “+ Add User” button was disabled **“(1/1)”** live (`C9`) because the owner consumes the single seat; `create_app_user` also blocks the N+1 via `check_plan_limit`. Limits match spec exactly (trial 1 / basic 3 / pro 4 / ultimate 16).

### F. RECOVERY
- **Admin forgot-password — proven E2E server-side:** `send_admin_reset_otp` (`sent:true`, channels **email + WhatsApp** since the owner has a phone) → completed `verify_admin_reset_otp` with a new password (`reset:true`) → `verify_login` with the new password returned **success**. Full chain works.
- **User-reset-by-admin:** covered in E (temp password emailed, forced change). Requires the user to have an email on file.

### G. EXPOSURE / ENUMERATION
- **Login leaks nothing:** wrong-company and wrong-user both return the generic `invalid_credentials` (verified). ✔ This matches the owner’s decision to keep clear UX *without* leaking at the login door.
- **Signup deliberately reveals existence** (`check_company_email` → “already registered”; `check_company_available` → “taken”). These are anon-callable, so any email/handle can be probed for existence platform-wide — **owner-sanctioned B2B UX**, noted as a minor surface.
- No secrets in client/network: the page ships only the anon key; OTP plaintext is never returned to the browser (hash-only in `email_otps`, delivered by email).

---

## 2. GAP TABLE — spec line vs current reality vs severity

| # | Spec (owner’s target model) | Current reality | Severity |
|---|---|---|---|
| 1 | Company code = unique handle **chosen/confirmed** at signup (suggested from name) | **Auto-derived** from company name; no field to edit/confirm. Different code ⇒ must change the name. Produces ugly handles (`14groupofcompanies`, `zztest2gateaudit`). | **MAJOR** |
| 2 | Admin logs in with **company code + password** (shorthand); admin email is the only verified email; OTP + forgot-pw here | ✔ Functionally works (owner username == code == slug; bare code logs in, case-insensitive). Forgot-pw to admin email works. Label says “username” not “company code”. | MINOR |
| 3a | Users = **username@companycode**, admin-chosen username | Username = **the role** (`recovery@CODE`, `recovery2@CODE`); admin **cannot choose** a username. | **MAJOR** |
| 3b | **No email required** for users (synthetic internal email acceptable) | Email is **mandatory** server-side; modal labels it optional → **UI/server mismatch**. | **MAJOR** |
| 4 | User forgot-pw = admin resets → temp password → **forced change** (`needs_password_reset`) | ✔ `admin_reset_subuser_password` does exactly this (and emails the temp pw). Caveat: needs a user email; the *Edit-modal* inline password change does **not** force a change (two inconsistent paths). | MINOR |
| 5 | **No default credentials** anywhere | ✔ Per-tenant generated; platform super-admin is separate. | PASS |
| 6 | **Lockout** after N failed attempts | ✔ 5 attempts → 15-min lock (proven live). | PASS |
| 7 | **Every credential action audit-logged** | Login success/fail/lock → `auth_events`. **User create / password reset / deactivate are NOT logged** (no audit write in those RPCs). | **MAJOR** |
| 8 | Plan limits on active users (1/3/4/16) | ✔ Exact; enforced client + server (proven live). | PASS |

### Additional findings (not a 1:1 spec line)
| ID | Finding | Severity |
|---|---|---|
| **S1** | **Onboarding wizard is broken at Step 1 for every new tenant.** `upsert_project` inserts `project_code = p_data->>'project_code'` but the wizard sends only `{project_name, location}`; `projects.project_code` is `NOT NULL` with no default → *“null value in column project_code … violates not-null constraint”* shown raw to the user (`C4`). A non-technical owner is hard-stuck (can only “Skip for now”). | **BLOCKER** |
| **S2** | **Signup email-OTP is client-side only.** `signup_new_company` never checks `email_otps`; the gate lives entirely in JS (`SV.step1`). A scripted client skips OTP and still creates the tenant (this audit did). Impact limited to handle/email **squatting** (account still unusable until activation), but the server doesn’t enforce the proof it shows the user. | **MAJOR (sec)** |
| **S3** | **Double email verification.** Step-1 OTP (Resend) **and** a post-submit GoTrue activation link both verify the same email through two different mailers; login is gated on the **GoTrue** link (`email_verified`), so the OTP step is functionally redundant friction. GoTrue/SMTP deliverability is separate from the (working) Resend path — if that link doesn’t arrive, the owner is locked out despite passing OTP. | **MAJOR (UX)** |
| **S4** | **Orphaned/squatted tenants.** Account is created at submit with `email_verified=false`. Never-clicked activation ⇒ the handle + email are **permanently occupied**; re-signup → `email_taken`. No cleanup, no self-service recovery beyond “resend link”. | **MAJOR** |
| **S5** | New owner’s `auth.users` is created lazily/unconfirmed by a best-effort `auth.resend` (wrapped in try/catch); `app_users.auth_user_id` stays NULL until the activation trigger links it. If the resend fails, **no activation email is ever sent** and the only re-trigger is the result-screen link. | INFO |
| **S6** | Wizard Units step silently shows **“0 floors · Nothing to generate”** if the floors cache is empty (e.g. a cache-load failure), with no guidance back. | MINOR |
| **S7** | `verify_admin_reset_otp` enforces only **length ≥ 8** for the new admin password — weaker than the full canonical policy used everywhere else. | MINOR |
| **S8** | OTP overlay shows a **5:00** countdown while the DB TTL is **10:00** — understates validity. | COSMETIC |
| **S9** | Admin/owner **2FA fails OPEN** (mailer unreachable ⇒ login proceeds without OTP). Deliberate availability trade-off; off by default. Worth a conscious sign-off. | INFO |

**Positives worth keeping:** generic login errors (no enumeration), honeypot + time-trap, anti-autofill readonly trick, caps-lock warning, strong unified password policy + history + expiry, session-version invalidation, idle timeout, device/session tracking, exact plan-limit enforcement, real Resend delivery.

---

## 3. Onboarding wizard — rough-edge list (non-technical Pakistani office user lens)
1. **Step 1 dead-ends with a database error** (S1) — the single worst thing a first-run user can hit. Looks broken on day one.
2. The fix-path isn’t obvious: the only escape is the quiet **“Skip for now”** top-right; nothing tells the user the full Projects page exists.
3. **Types step** lists 10 pre-checked types with empty area/price — fine, but no hint that leaving them blank is OK, and the label *“Defaults… pre-fill the bulk generator next time”* is jargon.
4. **Floors “Code”** column (G, UG, 1, 2…) is powerful but unexplained — a user won’t know it drives unit numbering until they see the preview.
5. **Units step** “0 floors / Nothing to generate” (S6) gives no recovery hint if floors didn’t load.
6. Wizard is **data-only** (Project→Units); company branding/users were intentionally dropped — good, but there’s no closing “invite your team / set your logo” nudge.
7. Numbers/areas are unlabeled units (sqft assumed); no thousands separators on price inputs.

---

## 4. Recommended fix order
1. **🔴 BLOCKER — wizard project creation (S1).** One-line server fix: in `upsert_project`, when `p_data->>'project_code'` is NULL, generate one (e.g. slug of `project_name` + uniqueness suffix), **or** have `OB._saveProject` send a derived code. Until fixed, no fresh tenant can self-onboard.
2. **Collapse the double email-verification & enforce it server-side (S2+S3).** Pick **one** mechanism. Recommended: keep the Step-1 Resend OTP and have `signup_new_company` (or a follow-up RPC) require a verified `email_otps` row, set `email_verified=true` on success, and **drop** the GoTrue activation-link gate. Removes redundant friction, the second-mailer reliability risk, and the client-only bypass in one move.
3. **User identity model (3a/3b).** Let the admin enter a **username**; make email genuinely optional by minting a synthetic internal email (`<username>@<companycode>.nexunova.local`) for the auth bridge; fix the Add-User modal so the Email label/validation matches the server (or relax the server). Align with `username@companycode`.
4. **Audit-log credential actions (#7).** Emit `auth_events`/`audit_logs` rows from `create_app_user`, `update_app_user` (status/password), `admin_reset_subuser_password`, and `verify_admin_reset_otp`.
5. **Orphan/unactivated cleanup + recovery (S4).** Either don’t persist the tenant until activation, or add a sweep for stale `email_verified=false` signups and a self-service “this email is unactivated — resend / reclaim” path.
6. **Company-code chosen/confirmed field (#1)** — surface an editable, availability-checked handle at Step 2 (pre-filled from the name).
7. **Consistency/cosmetic:** admin-reset password policy parity (S7), inline-edit forced-change flag (#4), wizard “0 floors” guidance (S6), OTP countdown↔TTL (S8), and a conscious decision on 2FA fail-open (S9).

---
*No application code or schema was modified. The only DB writes were to provision/operate the ZZTEST2 tenant (create via real signup, simulate its activation, seed one project, bump its plan, run + clear its own lockout, rotate its own password). Fourteen Group and ZZTEST were not touched.*
