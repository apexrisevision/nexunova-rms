> **ARCHIVED — aspirational post-launch wishlist, NOT current instructions. Authority is NEXUNOVA_RMS_MASTER_CONTEXT.md.**

# Nexunova RMS — International Standards Gap Analysis

> **Purpose:** Measure the current Nexunova RMS implementation against world-class ERP / Recovery-Management-System standards and enumerate everything missing or incomplete. **Analysis only — nothing is being changed.**
>
> **Date:** 2026-05-26
> **Method:** Code + DB audit (`CLAUDE_RMS.md`, `DATABASE_AUDIT.md`, `NEXUNOVA_RMS_MASTER_CONTEXT.md`, `js/pages/*`, `supabase/migrations/*`, live schema inventory).
> **Reference standards used:** ISO/IEC 27001 (ISMS), SOC 2 (security/availability/confidentiality), OWASP ASVS 4.0, NIST 800-63B (auth), PCI-DSS (if cards ever touched), GDPR + Pakistan PDPA (draft), WCAG 2.1 AA (accessibility), and collections best-practice (automated dunning, omnichannel, promise-to-pay, maker-checker financial control, FDCPA-style conduct/quiet-hours discipline).

---

## How to read this

**Rating definitions**

| Rating | Meaning |
|---|---|
| 🔴 **Critical** | Blocks a credible production launch, or a core RMS capability is absent / security is unsound. Must-have. |
| 🟠 **Important** | Expected of a professional SaaS ERP; absence is a competitive/compliance weakness but not a hard blocker. |
| 🟢 **Nice to have** | Polish, advanced/premium capability, or low-frequency need. Defer without risk. |

A gap marked **(tables exist)** means the database scaffolding is present but the behaviour is not wired into the app yet.

---

## Executive summary — scorecard

| # | Category | 🔴 Critical | 🟠 Important | 🟢 Nice | Maturity* |
|---|---|---|---|---|---|
| 1 | Security & Compliance | 4 | 7 | 3 | ◖◐ Moderate |
| 2 | Recovery Operations | 2 | 6 | 4 | ◕ Strong base, automation missing |
| 3 | Financial Controls | 3 | 5 | 3 | ◐ Partial |
| 4 | Reporting | 1 | 4 | 4 | ◕ Strong, no PDF/scheduling |
| 5 | Client Management | 0 | 4 | 4 | ◕ Strong |
| 6 | Document Management | 0 | 4 | 4 | ◐ Print-based only |
| 7 | Communication | 2 | 5 | 2 | ◔ Foundation only |
| 8 | Admin & Audit | 2 | 4 | 4 | ◕ Strong, integrity gaps |
| 9 | Integration | 3 | 5 | 4 | ◔ Largely absent |
| 10 | UX & Accessibility | 0 | 5 | 4 | ◐ Responsive yes, a11y/i18n no |
| — | **Total** | **17** | **49** | **35** | — |

\*Maturity is a subjective read of how close that area is to "world-class," not a precise score.

**Headline finding:** The RMS has an unusually **deep functional surface** (recovery intelligence, legal, PDC, possession/NOC, commissions, executive analytics, client portal, branding engine) — broader than most products at this stage. The gaps cluster in **three structural areas**, all of which are known and partially scaffolded:

1. **Governance not yet enforced** — RBAC, multi-site isolation, and maker-checker approvals exist as DB tables but are not active in code. This is the single biggest risk surface.
2. **No outbound automation** — there is no messaging/payment gateway, so dunning, reminders, statements, and online collection are all manual. For a *Recovery* system this is core, not peripheral.
3. **No integration / extensibility layer** — no public API, webhooks, accounting export, SSO, or bank reconciliation.

---

## What is already strong (so we don't relitigate it)

To keep this analysis honest, these are already in place and at or near standard:

- **Data-access security model** — RLS + `deny_all_anon` + 388 `SECURITY DEFINER` RPCs ("PATH_B lockdown"). No direct table access. Solid foundation.
- **Auth hardening** — password policy + expiry + history(3), force-change on first login, failed-login lockout, account lock, idle session timeout, session/device tracking, email-OTP gate for admin/owner.
- **Audit trail** — `audit_logs` + `audit_log_archive` + `auth_events`, triggers on financial tables, in-app audit viewer with export.
- **Recovery depth** — health/risk scoring, recovery radar, promise tracker + analytics, escalations + auto-escalation rules, campaigns, forecasting, field visits (GPS + photo + offline queue).
- **Financial breadth** — payments, receipts, PDC full lifecycle, payables, additional receivables, agent commissions + structures, 6 ledger views, installment schedule (deferral, restructure, snapshot compare).
- **Reporting** — 25+ report types with **real XLSX (SheetJS) + CSV** export, executive dashboard, Crystal-style A4 branded print layouts.
- **Client portal** — self-service schedule, payments, documents, complaints, possession status.
- **Branding engine** — company identity defined once, propagated to every print document.
- **Pakistan localization (data layer)** — CNIC/NTN fields, WHT/CVT capture, PKR, holidays table, lakh/crore display convention.
- **Multi-tenant SaaS plumbing** — feature flags, plan gating, super-admin console (tenant health, suspend, announcements, support tickets), setup wizard.

---

## Deliberate exclusions (NOT counted as gaps)

Per project decisions (see `CLAUDE_RMS.md` → Critical Rules / Decisions Log), the following are **intentionally out of scope** and are excluded from the gap counts above:

- **Double-entry accounting / GL / chart-of-accounts / vouchers** — explicitly excluded ("not needed in RMS; School ERP has it"). *Note: reconciliation and financial controls (below) are still in scope — they are a separate concern from a general ledger.*
- **Framework migration** — staying Vanilla JS by decision (the future React build is a roadmap item, not a gap).
- **Cross-tenant blacklist sharing** — skipped for privacy.
- **True super-admin impersonation** — skipped for security (service-role-in-browser risk).

---

# 1. Security & Compliance gaps

> Standard: ISO 27001 ISMS controls, SOC 2 trust criteria, OWASP ASVS, NIST 800-63B, least-privilege RBAC, immutable audit, data-protection (GDPR / PK PDPA), tested backup + DR.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| S1 | **Role-based access not enforced** | 🔴 Critical | `app_users.role` + `module_permissions` jsonb exist; roles defined (owner/admin/recovery_officer/finance/manager); **enforcement is the pending next task**. Every authenticated user effectively reaches every RPC. | Least-privilege (ISO A.9 / ASVS V1). A non-admin can currently call privileged RPCs. |
| S2 | **Multi-site isolation not enforced** | 🔴 Critical | `user_project_assignments` + 14 `project_id` columns exist; RPCs do **not** filter by assigned projects yet. Client's core rule *"A wala B ka data na dekhe"* is unmet. | Tenant/site data segregation. Stated #1 business requirement. |
| S3 | **Maker-checker / approval workflow not wired** | 🔴 Critical | `approval_requests` + `approval_request_comments` tables exist; **`create_approval_request` is called nowhere in the app**. Restricted actions execute immediately. | Segregation of duties (SOC 2 CC). No "soft block" enforcement exists. |
| S4 | **Restriction levels (hard/soft/warning) not implemented** | 🔴 Critical | Designed in master context; no rule engine maps actions → level. | Without it, discounts/refunds/cancellations/price-revisions have no control tier. |
| S5 | **Audit log is mutable (not tamper-evident)** | 🟠 Important | `audit_logs` is a normal table; no append-only enforcement, hash-chaining, or WORM archival. | SOC 2 / ISO require integrity-protected logs. An admin with DB access could alter history. |
| S6 | **IP whitelist not enforced server-side** | 🟠 Important | Table + UI exist; enforcement "requires an Edge Function" (noted in code). Currently advisory only. | A configured control that doesn't actually block is a false sense of security. |
| S7 | **MFA limited to email OTP** | 🟠 Important | Email OTP for admin/owner only; no TOTP/authenticator app, no WebAuthn/passkeys, no per-user MFA enrollment. | NIST 800-63B favours app-based/hardware factors; email is the weakest second factor. |
| S8 | **No data-protection / privacy tooling** | 🟠 Important | No data-retention policy, no right-to-erasure / data-subject export, no consent ledger. Only a signup ToS checkbox. | GDPR + Pakistan PDPA (forthcoming). PII (CNIC, bank, phone) held indefinitely. |
| S9 | **No app-layer PII encryption / masking** | 🟠 Important | CNIC, bank account, IBAN stored plaintext (Supabase encrypts at rest, but no field-level encryption or UI masking). | Defence-in-depth for sensitive identifiers; reduces breach blast radius. |
| S10 | **No rate limiting / abuse protection on RPCs** | 🟠 Important | Login lockout exists; no throttling on other RPCs, no CAPTCHA on signup/forgot-password, no anomaly detection. | OWASP ASVS V11. Enumeration / scraping / brute-force on non-login endpoints. |
| S11 | **No security testing in lifecycle** | 🟠 Important | No dependency audit, SAST/DAST, or pen-test cadence; no `npm audit` in CI (no CI at all). | SOC 2 vulnerability-management criterion. |
| S12 | **Backup/DR not verified as automated + tested** | 🟢 Nice→🟠 | A `backup.js` module exists; unclear if backups are automated, offsite, and **restore-tested**, with defined RPO/RTO. | ISO A.12.3 / business continuity. "We have backups" ≠ "we can restore." |
| S13 | **Password complexity / breach check** | 🟢 Nice | Policy + expiry + history exist; unclear if complexity rules and HaveIBeenPwned-style breached-password rejection are enforced. | NIST 800-63B recommends breached-password screening over arbitrary complexity. |
| S14 | **Secrets / key handling documented** | 🟢 Nice | Publishable anon key in client (expected for Supabase); confirm no service-role key ever ships to the browser and rotation policy exists. | Secrets-management hygiene. |

---

# 2. Recovery Operations gaps

> Standard: automated multi-stage dunning, omnichannel outreach, promise-to-pay lifecycle, work-queue/SLA management, dispute & settlement workflows, conduct compliance (quiet hours / DND), CTI/dialer.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| R1 | **No automated dunning sequences** | 🔴 Critical | Reminders/escalations are manual or in-app only. No rule-driven cadence (e.g. D-3 reminder → D+1 overdue → D+7 escalation → D+15 legal notice) firing automatically. | Automated dunning is the *core* of a recovery system. Today it's a manual tool. Depends on gateway (see §7). |
| R2 | **No omnichannel auto-dispatch** | 🔴 Critical | Only manual `wa.me` click-to-send. No automated WhatsApp/SMS/email send, no fallback chaining. | Recovery rates depend on timely, automated, multi-channel contact. |
| R3 | **No work-queue / SLA / auto-assignment engine** | 🟠 Important | Recovery radar prioritizes a list; no formal queue with assignment rules, SLAs, aging-of-task, or reallocation on inactivity. | Collections ops need accountable, time-bound queues per officer. |
| R4 | **No dispute / hardship / settlement-plan workflow** | 🟠 Important | Legal cases + escalations exist; no structured "client disputes amount" or "request restructure/settlement" flow with approval and audit. | Standard collections module; reduces ad-hoc concessions. |
| R5 | **Promise auto-reminder (24h before due) deferred** | 🟠 Important | Manual officer-triggered only; auto-send needs gateway + cron. | Promise-kept rates improve sharply with automated pre-due nudges. |
| R6 | **No quiet-hours / DND-window / time-zone compliance** | 🟠 Important | `dnd_status` flag exists; no enforcement of legal calling/contact windows or per-region quiet hours at dispatch time. | FDCPA-style conduct discipline; avoids harassment complaints. |
| R7 | **No recovery-officer target tracking surfaced** | 🟠 Important | `recovery_officer_targets` table exists (Phase 1); UI for set/track/attainment not confirmed built. | Performance management of the recovery team. |
| R8 | **No configurable strategy/segmentation rules** | 🟠 Important | Auto-escalation thresholds are hard-coded (e.g. 3 broken promises); no per-company strategy config. | Tenants need to tune cadence/thresholds without code. |
| R9 | **No CTI / click-to-call / dialer integration** | 🟢 Nice | Calls logged manually (8-step wizard). No softphone, auto-dial, or call-recording link. | Productivity + QA in high-volume call centers. |
| R10 | **No "next best action" recommendation** | 🟢 Nice | Risk score exists; no prescriptive recommended action per account. | Premium intelligence layer. |
| R11 | **No skip-tracing / contact enrichment** | 🟢 Nice | Manual contact data only. | Useful for unreachable defaulters. |
| R12 | **No call recording / QA scoring** | 🟢 Nice | Not present. | Call-center quality programs. |

---

# 3. Financial Controls gaps

> Standard: segregation of duties, maker-checker on money-movement, reconciliation, write-off/refund approval, tamper-proof receipt numbering, tax compliance. (Double-entry GL is intentionally excluded.)

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| F1 | **No maker-checker on financial actions** | 🔴 Critical | Refunds, discounts above limit, write-offs, price revisions, cancellations execute without an approval gate (ties to S3). | Core financial control; prevents single-person fraud/error. |
| F2 | **No write-off / bad-debt approval workflow** | 🔴 Critical | No formal write-off action with reason, approval, and audit. | Standard receivables control; write-offs are high-risk. |
| F3 | **No refund control workflow** | 🔴 Critical | `payables` records refunds, but no approval gating / dual control on outbound money. | Outbound payments are the highest-risk operation. |
| F4 | **No bank reconciliation / statement matching** | 🟠 Important | Payments entered manually; no import of bank statements and matching to receipts. | Ensures recorded receipts equal banked funds. |
| F5 | **Overpayment / credit-balance handling deferred** | 🟠 Important | Known deferral; overpayment isn't credited to next installment automatically. | Common real-estate scenario; manual handling is error-prone. |
| F6 | **Configurable payment-allocation rules deferred** | 🟠 Important | Cascades oldest-first only; not configurable (oldest/newest/proportional/specific). | Different developers have different allocation policies. |
| F7 | **WHT/CVT: capture only, no rate engine / FBR reporting** | 🟠 Important | `wht_amount`/`cvt_amount` stored; no filer/non-filer rate computation or statutory tax report output. | Pakistan tax compliance (FBR); filer status drives the rate. |
| F8 | **Receipt numbering integrity not confirmed** | 🟠 Important | Payment codes / PRV numbers exist; confirm they are sequential, gap-free, and non-reusable (anti-tamper). | Auditability of cash receipts; regulators expect unbroken sequences. |
| F9 | **No period-close / financial lock** | 🟢 Nice | No concept of locking a closed month against backdated edits (warning-level backdating only). | Prevents retroactive tampering after reporting. |
| F10 | **Single currency (PKR only)** | 🟢 Nice | Hard-coded PKR. Fine for PK; limits overseas/multi-country tenants. | Multi-currency for expansion. |
| F11 | **No cost-center / project P&L roll-up** | 🟢 Nice | Project-level recovery metrics exist; no cost/expense roll-up (legal cost log exists but isolated). | Light financial visibility without full GL. |

---

# 4. Reporting gaps

> Standard: server-rendered archivable PDFs, scheduled distribution, drill-down/BI, regulatory templates, localized output, governed exports.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| RP1 | **No true server-side PDF generation** | 🟠 Important | "PDF" = browser `window.print()` → user prints to PDF manually. Not archivable, not emailable, not consistent across browsers. | Crystal-grade reporting implies stored, reproducible PDF artifacts (jsPDF/headless render/Edge Function). |
| RP2 | **No scheduled report distribution** | 🟠 Important | All reports are pull-only/manual. No "email me the aging report every Monday." Needs gateway + cron. | Executives expect push reporting. |
| RP3 | **No Urdu / RTL report output** | 🟠 Important | Stated PK requirement; no `dir="rtl"` / Urdu labels anywhere. | Client-facing legal/notice documents must support Urdu. |
| RP4 | **Inconsistent Excel export quality** | 🟢 Nice→🟠 | `reports.js` uses real XLSX (SheetJS) ✅; `audit.js` exports HTML-as-`.xls` (weaker). | Consistency; HTML-`.xls` triggers Excel warnings. |
| RP5 | **No ad-hoc / custom report builder** | 🟢 Nice | Deferred (Module 8.4). 25+ fixed reports cover most needs. | Self-serve analytics for power users. |
| RP6 | **No drill-down / pivot / saved views** | 🟢 Nice | Reports are flat tables + charts. | BI-grade interactivity. |
| RP7 | **No statutory/regulatory report pack** | 🟢 Nice | No pre-built FBR/registrar/audit-pack templates. | PK compliance reporting. |
| RP8 | **No historical snapshotting / data warehouse** | 🟢 Nice | Some history (health, snapshots); no general point-in-time reporting store. | Trend integrity over time. |

---

# 5. Client Management gaps

> Standard: 360 view, KYC/AML, dedup/merge, consent center, segmentation, data quality.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| C1 | **No KYC / AML / sanctions-PEP screening** | 🟠 Important | CNIC/passport captured; no verification or watchlist screening. | AML obligations for high-value real-estate transactions. |
| C2 | **No duplicate detection / merge** | 🟠 Important | No dedup on CNIC/phone at create; no merge tool for duplicate clients. | Data quality; duplicate clients fragment recovery history. |
| C3 | **No granular consent / preference center** | 🟠 Important | Single `comms_opt_out` flag; no per-channel (WhatsApp/SMS/email/call) consent or marketing-vs-transactional split. | Data-protection + comms compliance. |
| C4 | **No CNIC/NADRA verification integration** | 🟠 Important | Manual entry only. | Identity assurance in PK. |
| C5 | **No data-quality / completeness scoring** | 🟢 Nice | No prompts for missing critical fields, no quality dashboard. | Clean data → better recovery. |
| C6 | **No relationship / household / co-buyer linking** | 🟢 Nice | Next-of-kin captured as text; not linked as entities; co-buyers limited. | Joint ownership is common in real estate. |
| C7 | **No client segmentation / tagging beyond category** | 🟢 Nice | `client_category` only. | Targeted campaigns/strategies. |
| C8 | **No client-facing onboarding / e-KYC capture** | 🟢 Nice | Portal exists but no self-service KYC document upload/verification. | Reduces manual data entry. |

> *360 view, complaint management, and the self-service portal already exist and are strong — not listed as gaps.*

---

# 6. Document Management gaps

> Standard: versioned DMS, e-signature, retention, access control + audit on documents, OCR, watermarking, batch generation.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| D1 | **No document versioning** | 🟠 Important | Docs are regenerated on demand (print) or stored as flat links (legal vault = URL list). No version history. | Legal documents need immutable versions + history. |
| D2 | **No e-signature integration** | 🟠 Important | No DocuSign/local e-sign; signatures are printed blocks only. | Agreements/NOCs increasingly signed digitally. |
| D3 | **No true DMS with access control + retention + doc audit** | 🟠 Important | Files in `rms-files` bucket; legal vault is link metadata. No per-document permissions, retention, or access log. | Confidential docs (CNIC scans, agreements) need governed storage. |
| D4 | **User-editable document templates limited** | 🟠 Important | Message templates editable; full legal/agreement document templates are code-built, not tenant-editable (WYSIWYG). | Tenants want to brand/edit their own agreement wording. |
| D5 | **No OCR / auto-classification** | 🟢 Nice | Uploaded scans are opaque blobs. | Auto-extract CNIC/cheque data. |
| D6 | **No watermarking / DRM** | 🟢 Nice | Generated docs unprotected. | Protect sensitive client-facing PDFs. |
| D7 | **No batch / mail-merge document generation** | 🟢 Nice | One-at-a-time generation. | Bulk demand notices / statements. |
| D8 | **No document expiry / validity tracking (beyond NOC)** | 🟢 Nice | NOC has validity; general docs don't. | Track expiring CNICs/agreements. |

---

# 7. Communication gaps

> Standard: omnichannel gateway, delivery tracking, scheduling/triggers, bulk broadcast, two-way inbox, consent + quiet hours, template governance.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| M1 | **No messaging gateway / auto-dispatch** | 🔴 Critical | Comms Center has templates + `message_log` + opt-out, but **no provider integration**. Only manual `wa.me` links. Gateway decision is an open blocker. | Without dispatch, every "automation" feature is inert. Core to recovery (see R1/R2). |
| M2 | **No delivery-status tracking** | 🟠 Important | `message_log.status` supports queued/sent/delivered/read/failed but only ever set to `manual` (no webhooks). | Can't prove a notice/reminder was delivered/read. |
| M3 | **No scheduled / triggered messages** | 🟠 Important | Deferred; needs cron + Edge Function. | Event-driven comms (due-date, payment-received, bounce). |
| M4 | **No bulk broadcast** | 🟠 Important | Deferred; manual single-send only. | Campaign-scale outreach. |
| M5 | **No SMS / email automation** | 🟠 Important | Template categories exist; no SMS gateway, no transactional email (receipts/statements). | Multi-channel fallback + receipts. |
| M6 | **No two-way messaging / inbox** | 🟠 Important→🟢 | Outbound-only model; client replies aren't captured. | Conversational recovery; reply handling. |
| M7 | **No WhatsApp template approval management** | 🟢 Nice | If using WhatsApp Cloud API, Meta template approval lifecycle isn't modeled. | Required to send templated WhatsApp at scale. |
| M8 | **Quiet-hours / consent enforcement at send time** | 🟢 Nice→🟠 | Opt-out flag exists but isn't checked by an automated sender (there is none yet). | Compliance once dispatch is built (ties to R6/C3). |

---

# 8. Admin & Audit gaps

> Standard: immutable audit, config-change logging, granular RBAC, SoD, monitoring/alerting, governed impersonation, retention.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| A1 | **RBAC / module-permission enforcement absent** | 🔴 Critical | `module_permissions` jsonb defined but not enforced (mirror of S1). Admin console can be reached by inspecting routes. | Privilege containment. |
| A2 | **No system health monitoring / alerting** | 🔴 Critical→🟠 | `health-center.js` is *client* health, not system. No uptime/error/RPC-failure monitoring or alerting. | Operability of a production SaaS (SOC 2 availability). |
| A3 | **Audit log not immutable / tamper-evident** | 🟠 Important | Mirror of S5. | Investigation integrity. |
| A4 | **No configuration-change audit** | 🟠 Important | Data CRUD is audited; changes to settings/security/feature-flags/branding may not be. | "Who changed the session timeout / disabled a control?" |
| A5 | **No admin activity dashboard / anomaly detection** | 🟠 Important | Auth events logged; no aggregated view of privileged actions or unusual-behaviour flags. | Insider-threat detection. |
| A6 | **No audit-retention / archival automation** | 🟠 Important | `audit_log_archive` table exists; no automated rotation/retention policy. | Storage + compliance retention windows. |
| A7 | **No governed impersonation ("support as tenant")** | 🟢 Nice | Skipped by decision; support relies on read-only company detail overlay. | Faster support with full audit trail. |
| A8 | **IP-whitelist enforcement pending** | 🟢 Nice | Mirror of S6 (listed there as Important; here noted for completeness). | — |
| A9 | **No bulk-action audit granularity** | 🟢 Nice | Bulk ops audited per-row via triggers, but no "bulk operation" grouping/intent record. | Trace one bulk action as one event. |
| A10 | **No legal-hold / e-discovery support** | 🟢 Nice | No ability to freeze a client's records from deletion during litigation. | Useful given legal-cases module. |

---

# 9. Integration gaps

> Standard: public API, webhooks, accounting export, payment gateway, bank feeds, SSO, messaging providers, bureau/identity integrations, ETL.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| I1 | **No online payment gateway** | 🔴 Critical | No JazzCash/Easypaisa/PayFast/Stripe collection. Clients pay offline; portal shows info only. | Frictionless online collection materially raises recovery rates; expected of a modern RMS. |
| I2 | **No messaging gateway (WhatsApp/SMS/email)** | 🔴 Critical | Mirror of M1 — no provider wired. | Enables all automated comms. |
| I3 | **No public API / webhooks** | 🔴 Critical→🟠 | No REST/GraphQL surface for tenants; no outbound webhooks. | Extensibility, partner integrations, ecosystem. |
| I4 | **No accounting-software export** | 🟠 Important | No Tally/QuickBooks/Xero/SAP export of receipts/refunds. (GL itself is out of scope, but *export* isn't.) | Finance teams reconcile in their accounting system. |
| I5 | **No bank statement import / feed** | 🟠 Important | Mirror of F4. | Reconciliation automation. |
| I6 | **No SSO / SAML / OAuth / social login** | 🟠 Important | Custom credentials only. | Enterprise tenants expect SSO; reduces password risk. |
| I7 | **No NADRA / credit-bureau (eCIB) integration** | 🟠 Important→🟢 | No identity or credit-history checks. | Risk assessment + identity assurance in PK. |
| I8 | **No bulk import / data-migration tooling** | 🟠 Important | No CSV/Excel import to onboard existing clients/units/sales from legacy systems. | Onboarding new tenants with existing data. |
| I9 | **No CRM / external data sync** | 🟢 Nice | RMS and CRM are deliberately separate products; no controlled sync bridge. | Lead-to-recovery continuity. |
| I10 | **No calendar / email-client integration** | 🟢 Nice | Hearings/follow-ups not pushed to Google/Outlook calendars. | Officer productivity. |
| I11 | **No open API documentation / developer portal** | 🟢 Nice | N/A until I3 exists. | Partner/self-serve integration. |
| I12 | **No real-estate portal / listing integration** | 🟢 Nice | No Zameen-style listing or external inventory sync. | Sales-side extension. |

---

# 10. UX & Accessibility gaps

> Standard: WCAG 2.1 AA, full keyboard operability, screen-reader support, i18n/RTL, consistent states, tested.

| ID | Gap | Rating | Current state | Why it matters / standard |
|---|---|---|---|---|
| U1 | **No Urdu / multi-language i18n** | 🟠 Important | No i18n framework; UI strings hard-coded English. Urdu is a stated requirement. | Localization for PK users + client-facing docs. |
| U2 | **No RTL support** | 🟠 Important | No `dir="rtl"`; layout is LTR-only. | Required for Urdu rendering. |
| U3 | **Not WCAG 2.1 AA compliant** | 🟠 Important | Partial ARIA (~100 attrs) but no a11y audit; contrast, labels, roles unverified. | Accessibility + procurement requirements. |
| U4 | **Keyboard navigation / focus management not audited** | 🟠 Important | Modals/menus may trap focus or be mouse-only; no documented keyboard map. | Operability for power users + a11y. |
| U5 | **No screen-reader / assistive-tech testing** | 🟠 Important→🟢 | Untested with NVDA/JAWS/VoiceOver. | Inclusive access. |
| U6 | **No automated a11y / visual-regression testing** | 🟢 Nice | No axe/Lighthouse/visual tests (no test infra at all). | Prevents regressions. |
| U7 | **Inconsistent empty/error/loading states** | 🟢 Nice | Shimmer skeletons exist for some pages; consistency not audited. | Perceived quality. |
| U8 | **Offline support is partial** | 🟢 Nice | Field-visit call logging queues offline; rest of app is online-only. | Field officers in low-connectivity areas. |
| U9 | **No in-app contextual help / guided tours** | 🟢 Nice | `tutorial.js` + setup wizard exist; no per-feature coach marks. | Onboarding new users. |

> *Mobile responsiveness is already implemented (`css/mobile.css`, touch targets) — not a gap.*

---

# Top priorities (the 🔴 Critical list, ranked)

If this list drives sequencing, fix governance first (cheap, already scaffolded, unblocks trust), then automation (needs a vendor decision), then extensibility.

**Tier 1 — Governance (scaffolded; mostly wiring, no external dependency):**
1. **S1 / A1** — Enforce role-based access in every RPC. *(This is the project's stated next task.)*
2. **S2** — Enforce `user_project_assignments` multi-site isolation in RPCs ("A wala B ka data na dekhe").
3. **S3 / F1** — Wire the maker-checker approval workflow into restricted actions.
4. **S4** — Implement the hard/soft/warning restriction-level engine.
5. **F2 / F3** — Write-off and refund approval workflows (build on #3).

**Tier 2 — Automation (requires a gateway/provider decision — the open blocker):**
6. **M1 / I2** — Choose + integrate a messaging gateway (WhatsApp Cloud API / Twilio / local SMS).
7. **R1 / R2** — Build automated dunning sequences + omnichannel dispatch on top of #6.
8. **I1** — Integrate an online payment gateway (JazzCash/Easypaisa/PayFast).

**Tier 3 — Platform integrity & extensibility:**
9. **S5 / A3** — Make the audit log tamper-evident (append-only + hash chain).
10. **A2** — System health monitoring + alerting.
11. **I3** — Public API + webhooks.

---

## Closing notes

- **The product is functionally broad but governance-thin.** Most "missing" Critical items are not greenfield — the database scaffolding (roles, project assignments, approval tables, restriction design) already exists. The work is enforcement + wiring, which is comparatively low-risk and high-trust-payoff.
- **The second cluster (automation + payments) is gated on one external decision:** which messaging and payment providers to use. Until that's chosen, ~12 deferred features across Recovery, Communication, Reporting, and Integration stay inert by design — they are *built to be gateway-agnostic and waiting*.
- **Pakistan-localization is half-done:** the data layer (CNIC, NTN, WHT/CVT, PKR, holidays) is in place, but the experience layer (Urdu/RTL, FBR tax computation, NADRA/eCIB) is not.

*Analysis complete. No code or schema was modified. — 2026-05-26*
