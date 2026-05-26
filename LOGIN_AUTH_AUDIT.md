# Nexunova RMS — Login / Auth Screens Audit (International Standard)

> **Scope:** The full unauthenticated auth surface — **Login**, **Forgot Password**, **Reset Password**, **Email Confirmation**, and **Signup (email + password)**.
> **Standards referenced:** OWASP ASVS 4.0 (V2 Authentication, V3 Session), NIST 800-63B, WCAG 2.1 AA, GDPR/PK-PDPA consent.
> **Date:** 2026-05-26
> **Files in scope:** `login.html` (auth screens), `js/auth.js`, `js/forgot-password.js`, `js/otp.js`, `js/pages/signup.js`, `js/pages/signup-validation.js`, `js/helpers.js`, `css/login.css`.

---

## 1. What was already strong (verified, not changed)

- **Login hardening** — brute-force lockout with countdown (`account_locked`), email-not-verified gate + resend, autofill suppression, loading state, password show/hide.
- **Session model** — real Supabase session bridge (`signInWithPassword`), device/session tracking (`create_session`/`revoke_session`), session-version polling, idle-timeout (30 min) with warning bar.
- **Force password change** — first-login + expired-password overlay → `change_password` (policy + last-3 history + expiry).
- **Forgot/Reset** — PKCE `exchangeCodeForSession`, **email-OTP gate before the reset form**, reset rate-limit (3/email/hr), resend cooldown (60 s), one-time session sign-out after reset, `sync_reset_password` failure handled explicitly.
- **Signup** — 5-step wizard, **live email + company-name availability** checks, password strength meter, plan selection, ToS checkbox, trial/pending result screens.
- **Backend** — every RPC the screens call exists and is `SECURITY DEFINER` (`verify_login`, `change_password`, `signup_new_company`, `check_email_available`, `check_email_exists`, `check_company_available`, `check_reset_rate_limit`, `sync_reset_password`, `confirm_user_email`, `create_session`, `revoke_session`, `check_session_valid`, `log_auth_event`).

---

## 2. Findings & resolution

| ID | Screen | Finding | Std | Status |
|---|---|---|---|---|
| L1 | Login | **No "Sign up" link** — signup screen existed but nothing on the login form linked to it; `showSignup()` was never reachable from login. | UX | ✅ **Fixed** — "Don't have an account? Sign up free" link under Sign In. |
| L2 | Login | **Fields not in a `<form>`** — username Enter didn't submit; weaker for password managers / assistive tech. Only the password field had an inline Enter handler. | ASVS V2, WCAG | ✅ **Fixed** — wrapped in `<form onsubmit="doLogin()">`, submit button is `type=submit`, `autocomplete="current-password"`. |
| L3 | Login | **A11y gaps** — error banner not announced; icon-only eye button unlabeled; labels not associated with inputs. | WCAG 4.1.3 / 1.3.1 / 4.1.2 | ✅ **Fixed** — `role="alert" aria-live="assertive"` on `#lerr`; `aria-label` on eye toggle (kept in sync on toggle); `for`/`id` label association + `aria-describedby`. |
| F1 | Forgot Pwd | **🔴 User enumeration** — `fpSubmit()` showed *"No account found with this email address"* when the email didn't exist (and on send error), directly contradicting the file's own anti-enumeration comment. An attacker could harvest valid emails. | OWASP ASVS V2.5, NIST 800-63B | ✅ **Fixed** — every outcome (exists / absent / rate-limited / swallowed error) now shows the **same neutral** *"If an account exists for X, we've sent a reset link"* screen. Removed the `check_email_exists` reveal; reset-email errors swallowed. |
| P1 | Signup | **Weaker password policy than the rest of the app** — signup used a local heuristic (length≥8 + any one class). The app-wide `validatePasswordStrength` requires upper+lower+number+special + common-password blocklist. A user could register a password the app would later reject. | NIST 800-63B, consistency | ✅ **Fixed** — `SV.step3()` now calls `validatePasswordStrength` (with the heuristic kept only as a fallback). Strength meter retained. |
| A1 | All | **No Caps Lock warning** on password entry — common cause of repeated failed logins → lockout. | UX best practice | ✅ **Fixed** — shared `wireCapsLockWarning()` on login, reset, and signup password fields ("⇪ Caps Lock is on"). |
| A2 | Reset/Signup | Error banners not announced to assistive tech. | WCAG 4.1.3 | ✅ **Fixed** — `role="alert"` on `#fp-err`, `#rp-form-err`, `#sg-err`. |
| P2 | Signup | **🔴 Signup dead-end** — `signup_new_company` creates the owner with `email_verified=false` and the auto-bridge leaves the auth user unconfirmed, but **no confirmation email was ever sent** and the result screen said *"Sign In Now."* `verify_login` then rejects every login with `email_not_verified` → a new customer could **never get in**. The whole confirm flow (confirm screen, `_handleEmailConfirm`, `confirm_user_email`) was already built — only the initial send was missing. | functional / ASVS V2 | ✅ **Fixed** — signup now sends the activation email (`supabase.auth.resend({type:'signup'})` → existing confirm flow); result screen changed to "Confirm your email" + Resend link for both trial and pending. ⚠️ *Delivery needs Supabase Auth email enabled / SMTP — see ops follow-ups.* |

---

## 3. Previously-flagged items — now RESOLVED (2026-05-26)

The three items that originally needed a decision have been built:

- **G1 — Admin/Owner 2FA now wired end-to-end ✅.** Discovered the toggle already exists (`company_security_settings.require_2fa_admin`) and the `send-auth-otp` / `verify-auth-otp` edge functions + `otp_tokens` table are in the repo. **Fixed:**
  - `verify_login` now returns `require_2fa_admin`; `doLogin()` gates admin/owner logins on it and calls `_triggerAdminOTP()`.
  - **`_triggerAdminOTP()` now fails OPEN** — if the OTP service is unreachable or `RESEND_API_KEY` isn't configured, the admin still gets in (console warning) instead of being locked out.
  - **Added a real toggle** in Admin → Security ("Require email 2FA for Admin / Owner logins") so admins can actually turn it on/off (`secSave2FA`).
  - **Fixed a latent landmine:** `save_security_settings` is now **merge-safe** (a partial save no longer clobbers other fields) and both it and `get_security_settings` now default `require_2fa_admin` to **false** (was `true` — combined with the lossy save, saving the session timeout could have silently enabled 2FA). Migration `security_settings_merge_safe_2fa_default_off`.
  - **Off by default; opt-in.** ⚠️ *For the OTP email to actually send, deploy the edge functions + set `RESEND_API_KEY` in the Supabase project.*
- **G2 — Real Terms & Privacy pages built ✅.** Created `terms.html` + `privacy.html` (branded, standalone, Pakistan-law governed, processor/controller split, retention, data-subject rights). Signup's checkbox + summary now link to them (`target=_blank`) instead of `mailto:`. ⚠️ *Standard SaaS boilerplate — have legal counsel review before relying on it commercially.*
- **G3 — Bot protection added ✅.** Self-contained **honeypot + time-trap** (`nxBotCheck()`) on both signup (hidden `#sg-hp`, 3 s minimum) and forgot-password (hidden `#fp-hp`, 1.5 s minimum) — no external service or keys required. Forgot-password bot hits return the same neutral success (no enumeration signal). *Optional future upgrade: Cloudflare Turnstile / hCaptcha via Supabase Auth's native CAPTCHA support for a stronger guarantee.*

---

## 4. Files changed

| File | Change | Cache buster |
|---|---|---|
| `login.html` | Login `<form>` + signup link + Caps Lock elements + `role=alert` on 4 error banners + neutral forgot-pwd success copy | — |
| `js/auth.js` | `toggleLxPwd()` keeps `aria-label` in sync | `?v=20260526e` |
| `js/forgot-password.js` | Anti-enumeration rewrite of `fpSubmit()` | `?v=20260526a` |
| `js/pages/signup-validation.js` | `step3()` uses canonical `validatePasswordStrength` | `?v=20260526a` |
| `js/helpers.js` | `wireCapsLockWarning()` + `nxBotCheck()` + wiring | `?v=20260526b` |
| `css/login.css` | `.lx-signup-row` / `.lx-signup-link` / `.lx-caps` / `.nx-hp` styles | `?v=20260526c` |

### G1–G3 fixes (this round)

| File | Change |
|---|---|
| `verify_login` (DB) | migration `verify_login_return_require_2fa_admin` — returns `company.require_2fa_admin` |
| `get/save_security_settings` (DB) | migration `security_settings_merge_safe_2fa_default_off` — merge-safe save, 2FA defaults off |
| `js/auth.js` | admin/owner 2FA gate in `doLogin()`; `_triggerAdminOTP()` fails open | `?v=20260526e` |
| `js/pages/admin.js` | 2FA toggle in Security tab + `secSave2FA()` | `?v=20260526d` |
| `terms.html`, `privacy.html` | **new** — branded legal pages |
| `login.html` | signup ToS/Privacy → real pages; honeypot fields on signup + forgot |
| `js/pages/signup.js` | `shownAt` baseline + `nxBotCheck` in `sgSubmit` | `?v=20260526a` |
| `js/forgot-password.js` | `_fpShownAt` baseline + `nxBotCheck` in `fpSubmit` | `?v=20260526a` |

### Email is now a shared dependency for THREE flows

Configuring email unblocks all of these at once:
1. **Signup confirmation** + **password reset** — use **Supabase Auth** email (Auth → Providers → Email: confirmations ON; set custom SMTP for production deliverability).
2. **Admin 2FA OTP** — uses the **`send-auth-otp` edge function + Resend** (`RESEND_API_KEY` secret + deploy the function; `config.toml` with `verify_jwt=false` now added for both auth-OTP functions).

Tip: one Resend account can power both — use it as the Supabase custom SMTP **and** as the edge-function `RESEND_API_KEY`.

**Ops follow-ups (not code):** (1) enable Supabase Auth email confirmations + SMTP; (2) deploy `send-auth-otp`/`verify-auth-otp` + set `RESEND_API_KEY`; (3) counsel review of `terms.html`/`privacy.html`.

*Audit + all fixes complete, including G1–G3. — 2026-05-26*
