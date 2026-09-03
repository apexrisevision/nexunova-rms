# Daily Closing — P0 Architecture Notes

Discovery only. No application code was created or modified. Every claim below carries the
file path (and line where useful) that proves it. Facts about the database were read live
from the RMS Supabase project `itqxljtfbrppntgyfush` via MCP on 2026-09-03.

> **Read this first if you skim nothing else.** RMS is **not** a framework app. There is no
> ORM, no server-side application tier, no REST controllers, no test framework and no PDF
> engine. It is a static vanilla-JS front end that talks to Postgres exclusively through
> `SECURITY DEFINER` RPCs. Section 12 lists where the blueprint assumes otherwise.

---

## 1. Stack

| Concern | What it actually is | Evidence |
|---|---|---|
| Language | ES5/ES2017 **vanilla JavaScript**, classic `<script>` tags. No modules, no bundler, no transpile step. | `login.html:2480-2570` (37 eager `<script src=…>` tags); `js/lazy-pages.js` (hand-rolled loader) |
| Framework | **None.** Pages are functions named `rXxx()` that write `innerHTML` into a `<div class="pg" id="pg-…">`. | `js/ui.js:1000` (`const fns={dashboard:W.rDash, …}`) |
| App shell | `login.html` (2,784 lines) — login screen **and** the whole application shell in one file. `index.html` is the marketing site; `app.html` is the three-product launcher. | `login.html`; `js/lazy-pages.js:19-25` ("STAYS EAGER … loaded in login.html") |
| Desktop | Electron thin wrapper around the same web app. | `main.js`, `package.json:"main":"main.js"`, `electron/` |
| ORM | **None.** No Prisma/Sequelize/Knex/TypeORM anywhere. | `package.json` devDependencies = electron, electron-builder, puppeteer-core, xlsx only |
| DB engine | **PostgreSQL 15+ on Supabase** (project ref `itqxljtfbrppntgyfush`). | `.mcp.json:8`; live `get_project_url` → `https://itqxljtfbrppntgyfush.supabase.co` |
| Data access | `supabase-js` v2.34.0 (vendored UMD) calling **`SECURITY DEFINER` RPCs only**. Direct table reads are locked out ("PATH_B lockdown"). | `js/vendor/supabase-js-2.34.0.umd.js`; `js/store/db.js:1-4` ("Handles all Supabase data operations via SECURITY DEFINER RPCs"); `supabase/migrations/PATH_B_emergency_lockdown.sql` |
| Migration tool | **Plain `.sql` files** in `supabase/migrations/`, applied by hand via MCP `apply_migration`. 501 files. Naming is `YYYYMMDD<letter>_a_sentence_in_words.sql`. | `supabase/migrations/20260903d_your_team_means_your_team_not_only_its_first_row.sql` and 500 siblings |
| Package manager | npm (`package-lock.json`). Runtime ships **zero** npm dependencies — everything is vendored or CDN. | `package.json`, `package-lock.json` |
| Hosting / deploy | Static hosting on **Vercel**; a `git push` to `main` is the deploy. | `vercel.json`; `.githooks/pre-push` |
| Extensions live in DB | `pg_cron 1.6.4`, `pg_net 0.20.0`, `pgcrypto`, `uuid-ossp` | live `pg_extension` query |

**⚠️ Repo is not the source of truth for RPC bodies.** Many live RPCs were applied directly
via MCP and never written to `supabase/migrations/`. Before touching any existing function,
dump it with `pg_get_functiondef` first. (Documented pattern; also see memory
`rpcs_not_in_repo`.)

---

## 2. Where a new module lives, and the naming conventions

There is **no** models / services / controllers split. A module is exactly five things:

| Layer | Location | Convention |
|---|---|---|
| "Model" + "service" + "API" | One `.sql` migration defining `SECURITY DEFINER` RPCs | `supabase/migrations/YYYYMMDD<x>_sentence_case_words.sql` |
| Page renderer | `js/pages/<module>.js` | one file per page; exports globals `r<Page>()` plus `_<mod>*` private helpers |
| Page container | `<div class="pg" id="pg-<navkey>">` in `login.html` | 72 exist today (`grep -c 'class="pg"' login.html` → 72) |
| Lazy-load manifest | `js/lazy-pages.js` `var M = { <navkey>: ['js/pages/<module>.js?v=<stamp>'] }` | cache-bust `?v=` **must** be bumped on every deploy |
| Router + sidebar | `js/ui.js` — `buildSB()` nav groups (`ui.js:520+`), title map `ts={…}` (`ui.js:964`), dispatch map `fns={…}` (`ui.js:1000`) | nav key is lowercase, no separator (`unitchange`, `callreport`) or hyphenated (`ledger-client`, `payment-methods`) |

Optional sixth: a dedicated stylesheet `css/<module>.css` linked in `login.html:40-71`.
Standalone printable documents live as their own HTML pages under `reports/`
(`reports/payment-receipt.html`, `account-ledger.html`, `demand-notice.html`, …).

**Function-name conventions** (observed across `js/pages/*.js`):
- `r<Page>()` — the render entry point, called by `nav()`.
- `_<mod><Thing>()` — module-private helper, prefixed with a 2–4 letter module tag
  (`_pdcRun`, `_pymShowClientSearch`, `_banksIsAdmin`, `_agCSS`).
- SQL: RPCs are `verb_noun` (`record_payment_simple`, `get_pdc_register`, `list_banks`,
  `upsert_bank`, `mark_pdc_cleared`); internal helpers are `_rms_*` or `_<domain>_*`
  and are revoked from `anon`/`authenticated`.

---

## 3. Auth & RBAC — how it is defined, and how to add a role

### 3.1 Identity
Custom login, **not** Supabase Auth's own user model on the surface:
`verify_login(company_code, username, password)` → then a real Supabase auth session is
established. Every `app_users` row has its own PK `id` **plus** `auth_user_id`.

> **The rule that bites:** `auth.uid()` returns the *auth* user id, so every RPC joins
> `app_users.auth_user_id = auth.uid()`, never `app_users.id = auth.uid()`.
> Evidence: `supabase/migrations/20260526_phase1_rpcs.sql:19-26`.

### 3.2 Server-side authorization — the canonical pattern
Every guarded RPC opens with the same six lines
(`supabase/migrations/20260902a_the_number_from_the_receipt_book.sql:100-137`):

```sql
v_me public.app_users := public._rms_caller();          -- active user or NULL
IF v_me.id IS NULL THEN RETURN … 'auth_required'; END IF;
IF NOT COALESCE(v_me.is_super_admin,false)
   AND v_me.company_id IS DISTINCT FROM p_company_id THEN RETURN … 'wrong_tenant'; END IF;
… validate inputs …
IF NOT public._rms_is_admin(v_me) THEN
  IF v_me.role = 'manager' THEN RETURN … 'forbidden'; END IF;      -- manager = read-only
  IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                 WHERE user_id=v_me.id AND company_id=p_company_id
                   AND project_id=v_project_id AND is_active)
  THEN RETURN … 'project_not_assigned'; END IF;
END IF;
```

Helpers: `_rms_caller()` and `_rms_is_admin(app_users)` —
`supabase/migrations/20260526_phase1_rpcs.sql:19-36`.

Errors are returned as `jsonb {success:false, error:'<code>'}`, **not** raised. There are no
HTTP status codes anywhere in this system.

Grants follow every function:
```sql
REVOKE ALL ON FUNCTION public.foo(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foo(...) TO authenticated, service_role;
```
Internal helpers additionally `REVOKE … FROM PUBLIC, anon, authenticated` and grant only
`service_role` — see `20260902a…sql:80-86` for the exact wording and the reason
(a default-privileges rule silently grants EXECUTE to `authenticated` on every new function).

### 3.3 Client-side authorization (hiding only)
- `effectiveRole()` — `js/helpers.js:290`
- `hasPermission(page)` — `js/helpers.js:253`; per-user `module_permissions` jsonb on
  `app_users` overrides role defaults
- `hasModuleGrant(page)` — `js/helpers.js:247`
- `hasProjectAccess(project_id)` — `js/auth.js:446-452`; `S.assignedProjectIds === null`
  means admin/owner (no scoping)
- `nav()`'s permission gate — `js/ui.js:913-937`
- Body classes `role-admin / role-recovery / role-finance / role-manager / role-readonly`
  are set in `buildSB()` (`js/ui.js:495-501`) so CSS can hide write affordances.

### 3.4 The roles that exist
Canonical (master context §2): **owner · admin · recovery_officer (legacy alias `recovery`) ·
finance (legacy alias `accounts`) · manager**, plus `staff`.
Live counts in the RMS DB today (15 `app_users` rows in total): `owner` 7, `recovery` 6,
`admin` 2. Per tenant: **Awami Market (the pilot) has exactly one account — `awami`,
role `owner`, no admin at all**; Fourteen Group has 1 owner + 1 recovery; FMH has 1 owner +
1 admin + 1 recovery, and that single admin is **"Filling Staff"** (`username: filling`) —
i.e. `admin` is used here as *the data-entry role*, not as an officer role. That, plus
`_rms_is_admin()` collapsing `is_super_admin` / `owner` / `admin` / `companies.owner_user_id`
into one ungraded privilege, is why CFO becomes a **new `cfo` role** rather than a mapping
onto `admin` (RULES §0.4).

**To add a role** you must touch all five places — there is no single registry:
1. `js/ui.js:492-494` — the `isA / isR / isAc / isM` predicates and the body class list.
2. `js/ui.js:520+` — a `navGroups` branch for that role in `buildSB()`.
3. `js/ui.js:919-922` — the baseline page allow-list inside `nav()`.
4. `js/helpers.js:278+` — the `defaults` map inside `hasPermission()`.
5. SQL — wherever `_rms_is_admin()` / `v_me.role = '…'` is tested in the RPCs.
   `app_users.role` is a free-text `text NOT NULL` column with **no CHECK constraint**, so
   the DB will accept any string; the gates are all in code.

---

## 4. Existing entities to integrate with

Column lists below are from `information_schema.columns` on the live DB, trimmed to what
matters for this module. All money columns are `numeric` (unconstrained precision), all
business dates are `date`, all timestamps are `timestamptz`.

| Concept | Table | Key columns |
|---|---|---|
| **Tenant** | `companies` | `id`, `company_code`, `company_name`, `display_name`, `currency`, `timezone`, `logo_url`, `status` |
| **Project (= site)** | `projects` | `id`, `company_id` NN, `project_code`, `project_name`, `short_code`, `status` |
| **Unit** | `units` | `id`, `company_id`, `project_id` NN, `unit_no`, `unit_code`, `status_id`, `floor_id`, `base_price`, **`handover_status`**, **`possession_date`** |
| **Client** | `clients` | `id`, `company_id`, `project_id` NN, `client_code`, `full_name`, `cnic`, `phone_primary`, `whatsapp`, `is_defaulter`, `is_blacklisted` |
| **Sale** | `sales` | `id`, `company_id`, `project_id`, `sale_number`, `unit_id`, `client_id`, `agent_id`, `net_amount`, `down_payment`, `installment_count`, `status`, `is_active` |
| **Schedule** | `installments` | `id`, `company_id`, `project_id`, `sale_id`, `installment_number`, `due_date`, `amount_due`, `amount_paid`, `outstanding`, `installment_type` (`down_payment` \| …), `status`, `related_payment_id` |
| **Receipt / payment** | `payments` | `id`, `company_id`, `project_id`, **`payment_code`** (`PAY-YYMM-0001`), **`voucher_code`** (`PRV-2627-00003`), **`manual_number`** (physical receipt-book number, free text), `sale_id`, `installment_id`, `client_id`, `amount`, `payment_date`, `payment_method` (`cash\|cheque\|bank_transfer\|online\|other\|adjustment`), `bank_id`, `reference_no`, `proof_url`, `status`, `payment_category`, `adjustment_type` |
| **Voucher counters** | `voucher_sequences` | `(company_id, prefix, year)` PK, `seq`. Live prefixes: `PRV` (fiscal-year label `2627`), `TRF` |
| **PDC** | `pdc_cheques` | `id`, `company_id`, `project_id`, `sale_id`, `client_id`, `cheque_no`, `bank_name`, `amount`, `cheque_date`, `deposit_date`, `clearance_date`, `status`, `payment_id` (created on clear), `bounce_reason`, `replaced_by_id` |
| **Cash/bank master** | `banks` | `id`, `company_id`, `bank_name`, `account_title`, `account_number`, `iban`, `is_active` — **company-scoped, not project-scoped** |
| **Bank per project** | `project_bank_accounts` | `id`, `company_id`, `project_id` NN, `bank_name`, `account_title`, `account_no`, `iban`, `is_primary` — **exists but has no UI page and no RPC in the repo** |
| **Expenses** | `project_expenses` | `id`, `company_id`, `project_id`, `expense_category` (free text), `description`, `amount`, `expense_date`, `created_by` — read-only list RPC `list_project_expenses` (`js/store/db.js:577`), upsert/delete in `20260601_authz_batch2c_upserts.sql:92` / `20260601_authz_batch2a_admin_deletes.sql:91`. **No page in the sidebar.** |
| **Money out to clients** | `payables` | `id`, `company_id`, `project_id`, `client_id`, `amount`, `reason`, `status`, `bank_id`, `paid_date` |
| **Extra charges** | `additional_receivables` | `id`, `company_id`, `project_id`, `sale_id`, `amount`, `description`, `due_date`, `status` |
| **Approvals** | `approval_requests` | `id`, `company_id`, `project_id`, `request_type`, `entity_table`, `entity_id`, `title`, `payload jsonb`, `amount`, `status`, `priority`, `requested_by`, `current_approver_id`, `decided_by`, `decided_at`, `decision_comment` (+ `approval_request_comments`) |
| **Project scoping** | `user_project_assignments` | `company_id`, `user_id`, `project_id`, `access_level`, `is_active` |
| **Handover** | `possessions` | `id`, `company_id`, `unit_id`, `sale_id`, `status`, `possession_date`, `handover_by`, `received_by`, `checklist jsonb`, `snagging_items jsonb` |
| **Audit** | `audit_logs` | `id bigint`, `company_id`, `table_name`, `record_id text`, `action`, `old_data`, `new_data`, `changed_fields text[]`, `changed_by`, `changed_by_name`, `changed_by_role`, `is_sensitive`, `reason`, `module`, `ip_address`, `user_agent`, `changed_at` |
| **Messaging** | `message_log`, `message_templates` | outbound log for the Comms Center |
| **Feature flags** | `company_feature_flags` | `company_id`, `feature_key`, `is_enabled`, `override_note`, `set_by`, `set_at` |

### 4.1 Approval / pending workflow — **yes, one exists** (answers blueprint A16 Q2)
A generic single-approver engine: a non-admin's sensitive write is intercepted, an
`approval_requests` row is created with the intended change in `payload jsonb`, and on
approval a dispatcher switch on `request_type` applies it inside one transaction.

- Engine: `supabase/migrations/20260526_phase3_approval_apply_engine.sql` (dispatcher at
  line 64, `unsupported_request_type` at line 190, audit write at line 202)
- Soft-block wiring into the write RPCs: `20260526_phase3_softblock_wiring.sql`
- UI: `js/pages/approvals.js`; RPCs used are `get_pending_approvals`,
  `get_approval_history`, and an approve/reject RPC chosen at `approvals.js:800`
- Known live defect to avoid inheriting: the `price_revision` approve branch is dead
  (memory `approve_request_price_revision_dead`, unfixed).

### 4.2 Handover — **no clean event exists** (answers blueprint A16 Q4)
Three unreconciled representations, and the only writer is archived code:
- `units.handover_status` — written by the Add/Edit Unit form (`js/pages/units.js:341`)
- `units.possession_date`
- `possessions` table with a checklist — its page is **archived**
  (`js/pages/archive/possession.js:227-231`), not reachable from the sidebar

There is **no** `RevenueRecognized` trigger point today. This must be decided before P3.

### 4.3 Attachments / file storage
Supabase Storage. Ten buckets exist; the ones that matter:

| Bucket | Visibility | Size cap |
|---|---|---|
| `rms-documents` | **public** | 10 MB |
| `recovery-documents` | **public** | – |
| `payment-receipts` | private | 5 MB |
| `agent-documents` | private | 5 MB |
| `employee-private` | private | 5 MB |

Upload helpers: `_handleFileUpload(fileInput, urlInputId, bucket, folder)` and
`_handleFileUploadAppend(...)` — `js/ui.js:105-147`. Path convention is
`<company_id>/<folder>/<epoch>_<rand>.<ext>`, and the **public URL is stored as a plain
`text` column** (`payments.proof_url`, `clients.cnic_front_url`, …).
Signed-URL reads exist only for the private buckets — `js/utils.js:130,147`
(`createSignedUrl(path, 300)` / `createSignedUrls(paths, 300)`) and
`js/pages/super-admin.js:294`.

> Consequence for the blueprint: today's attachment story is **public-bucket + stored public
> URL**. A10 ("Documents private; signed URLs") requires a private bucket for this module —
> which is supported (`employee-private` is the precedent, `20260828j_private_bucket_for_employee_documents.sql`)
> but is not the default path any existing RMS page takes.

### 4.4 WhatsApp / messaging
Two unrelated mechanisms:
1. **Deep link, manual** — `openWhatsApp(phone, message)` opens `https://wa.me/…?text=…`
   in a new tab; the human presses send. `js/whatsapp-helper.js:4-8`. This is what the
   recovery/payment-link flows actually use.
2. **Meta Cloud API dispatch** — edge function `supabase/functions/send-message/index.ts`,
   driven by cron `comms-queue-build` (04:00) + `comms-dispatch` (every 2 min), logging to
   `message_log`. Docs: `supabase/functions/README_dispatch.md`, `WHATSAPP_SUITE_PLAN.md`.

> **Do not plan on (2) for P4.** Live state: messages record as "sent" but
> **delivered 0 / read 0**, no approved Meta template is in use, and there is **no attachment
> field**, so a PDF cannot be sent through it (memory `whatsapp_sends_but_never_delivers`).
> Verify before designing the P4 WhatsApp step.

---

## 5. PDF / printable reports — how they are generated today

**There is no PDF engine.** No Puppeteer at runtime, no wkhtmltopdf, no pdfkit, no jsPDF.
Everything is **browser print → "Save as PDF"**, in two flavours:

1. **`NXPrint`** — `js/foundation/print.js`
   - `NXPrint.emit(html, title)` — opens a window, `document.write`s a complete HTML
     document, prints on load with a 1,200 ms fallback. Deliberately avoids blob URLs
     (they caused an intermittent blank-print race). Electron path uses
     `window.electronPrint.print`.
   - `NXPrint.reportFrame({title, company, project, period, bodyHTML, orientation})` —
     the standard letterhead + repeating `<thead>` + per-page footer wrapper, with a
     self-contained print stylesheet (print windows cannot see the app's CSS).
2. **`NXReport`** — `js/foundation/report-page.js` — a config-driven report factory
   (`{id, title, filters, fetch, transform}`) that renders screen + Excel + print from the
   **same** transform output, so the three can never disagree.
3. **Standalone document pages** under `reports/` — real A4 HTML pages that fetch their own
   data with their own Supabase client and offer a Print button:
   `payment-receipt.html`, `account-ledger.html`, `installment-schedule.html`,
   `demand-notice.html`, `noc-certificate.html`, `sale-agreement.html`,
   `transfer-letter.html`, `hub.html`, `viewer.html`.
   Opened via `openReceiptReport(paymentId)` — `js/pages/print.js:1492-1495`:
   `window.open('reports/payment-receipt.html?id=…&cid=…')`.
   These support an Urdu/RTL mode (`body.lang-ur`, Noto Nastaliq Urdu).

Excel export is the vendored `xlsx@0.18.5`, with `xlsxWesternNumFmt(ws)` forcing `#,##0` on
numeric cells (`js/helpers.js:136`).

> **Consequence for the blueprint:** a *server-rendered, stored, versioned* Director PDF
> (A13 + `day_documents.storage_key`) has **no existing mechanism**. See §12.

---

## 6. Background jobs / scheduling

`pg_cron` inside Postgres, calling either a plpgsql function or an edge function through
`pg_net`. 17 jobs are live. Relevant precedents:

| Job | Schedule (UTC) | Command |
|---|---|---|
| `comms-queue-build` | `0 4 * * *` | `SELECT public.cron_enqueue_due_comms_all();` |
| `comms-dispatch` | `*/2 * * * *` | `net.http_post(url := '…/functions/v1/…')` |
| `daily-report-push` | `47 5 * * *` | `net.http_post(…)` |
| `radar-daily-generate` | `0 2 * * *` | `SELECT public.cron_generate_radar_all();` |
| `expire-subscriptions` | `7 * * * *` | `SELECT public.cron_expire_subscriptions();` |
| `lead-alerts` | `40 * * * *` | `SELECT public.cron_lead_alerts();` |

Convention: job name is kebab-case, the function is `cron_<verb>_<noun>`, and the body sets
`SET search_path = public;` first. Schedules are **UTC** — PKT is UTC+5, so "midnight PKT"
is `0 19 * * *` (see `.github/workflows/nightly-backup.yml`).

Edge functions live in `supabase/functions/<name>/index.ts` (Deno).
**⚠️ Deploy them with the CLI and `--no-verify-jwt`** — deploying via MCP silently resets
`verify_jwt` to true (memory `edge_deploy_resets_verify_jwt`).

---

## 7. UI: components, theming, forms, tables, mobile

### 7.1 Component library — `NX` (the "Foundation Kit")
`js/foundation/kit.js` (552 lines), documented in `foundation/KIT.md`. It is a **string-
returning** library: every function returns an HTML string that the page concatenates and
assigns to `innerHTML`. There is no virtual DOM, no reactivity, no state binding.

Available: `NX.icon` (Lucide only, never emoji) · `ichip` · `tabs` · `card` · `button` ·
`table` · `modal` · `field` · `badge` · `chip` · `kpi` · `empty` · `pageHeader` · `banner` ·
`sparkline` · `minibar` · `stackbar` · `journeybar` · `gauge` · `donut` · `trendline` ·
`infoTip` · `animateCounts`.

CSS classes are `nx-*` — `css/foundation/components.css` (515 lines): `.nx-card`, `.nx-btn`
(`--primary/--secondary/--ghost/--danger/--sm/--icon`), `.nx-table`, `.nx-field`,
`.nx-badge--{primary,info,success,warning,danger}`, `.nx-banner--{info,warn,danger}`,
`.nx-empty`, `.nx-chip`, `.nx-amt-words`, `.nx-hero-value`.

Shell chrome (topbar, sidebar, "+ New" menu) is `js/foundation/shell.js` +
`css/foundation/shell.css`.

### 7.2 Forms
`NX.field({name, label, type, options, required, error})` — **`name` becomes the element
`id`**, which `scripts/predeploy-check.js` relies on when hunting shadow IDs.
Reads are raw `document.getElementById(...).value`. There is no form library, no validation
framework and no schema — validation is hand-written per page plus the server RPC's own checks.

Money fields get "Ten Thousand Only" underneath automatically: one global listener in
`js/foundation/amount-words.js` qualifies fields **by their visible label**, not by id
(`data-words` to opt in, `data-no-words` to opt out).

Live thousands-separator masking on `.inp-amt` is in `js/helpers.js:189-199`.

> **Select gotcha to inherit:** setting `sel.value = savedId` against a filtered option list
> silently blanks the field. Use `js/pick.js` (memory `nexuattend_silent_blank_select_and_datacap`).

### 7.3 Tables
`NX.table({cols, rows})` + `.nx-table`; numeric cells carry class `.num`, which is both
right-aligned and `font-variant-numeric: tabular-nums` (`css/foundation/tokens.css`, last
rule). Row height token `--fk-h-row: 40px`. Sticky header + sticky totals are done per-page,
not by the kit.

### 7.4 Mobile
`css/mobile.css` + a `closeMobileSidebar()` call on every `nav()` (`js/ui.js`). It is a
responsive web app, not a separate mobile build. There is a service worker and a manifest
for the *portal* (`sw-portal.js`, `manifest.webmanifest`), not for RMS.

### 7.5 Theming
Light/dark via `html[data-theme="light"|"dark"]` — only the surface ramp flips; brand and
status colours are fixed in both themes (`css/foundation/tokens.css`).

> **Two CSS gotchas that have burned this codebase before:**
> - Never re-add a `transform` to `.pg` — it breaks `position: fixed` modals
>   (memory `pg_transform_breaks_fixed_modals`).
> - `--card` is undefined in the foundation token set; use `--fk-bg-card`
>   (memory `css_card_var_undefined_gotcha`).

---

## 8. Money and date/time conventions

### Money
- **Storage:** Postgres `numeric` with **no precision/scale** on every money column
  (`payments.amount`, `sales.net_amount`, `installments.amount_due`, …). Verified in
  `information_schema.columns`. Not `DECIMAL(18,2)`.
- **Display:** `fM(n)` → `12,345,678` · `fMF(n)` → `PKR 12,345,678` · `fN` · `fMH` —
  `js/utils.js:11-28`. All use `_PK_LOCALE = 'en-US'`.
- **Compact:** `fLakhCr(n)` → `2.5M` / `250K` / `1.2B` — dashboard KPI cards **only**.
- **🚨 Never use `en-IN`** — it renders lakh/crore. Lakh/crore notation was deliberately
  removed app-wide on 2026-06-08. `en-PK` and `en-US` are both Western grouping.
  (memory `pkr_locale_en_in_not_en_pk`.)
- Fraction digits are **0 everywhere** — paisa are not displayed today.
- Amount in words: `amtWords()` in `js/pages/print.js`, Trillion/Billion/Million (no
  Lakh/Crore words), reused on screen by `js/foundation/amount-words.js`.
- `' Dr'` / `' Cr'` in `js/pages/ledgers.js` are Debit/Credit markers — **not** Crore.
  Do not "fix" them.

### Dates and time
- `td()` → `new Date().toISOString().slice(0,10)` — `js/utils.js:2`. **This is UTC**, not
  Karachi. In PKT that is wrong for the first 5 hours of each day.
- `fD(d)` → `03 Sep 2026` via `en-US` — `js/utils.js:41`.
- A correct Karachi "today" exists only in the portal:
  `todayPK()` = `new Date(Date.now() + 5*3600000).toISOString().slice(0,10)` —
  `js/portal-givenleads.js:105`, `js/portal-teamreport.js:150`. Display formatting with
  `timeZone: 'Asia/Karachi'` appears in `js/portal-report-pdf.js:49`.
- Postgres side: RPCs use bare `CURRENT_DATE`, which on Supabase is **UTC**
  (`20260902a…sql:41,131`).
- `companies.timezone` exists as a column and is not consulted by any of the above.

> **This is the single biggest correctness gap for a cash book.** Blueprint A7 requires
> `business_date` in Asia/Karachi. Today's helpers would put a 03:00 PKT entry on the
> previous business date. See §12 and RULES.md.

---

## 9. Testing

**No test framework.** No Jest, Vitest, Mocha, Playwright-test, pytest — nothing. What
exists is a hand-rolled three-layer gate, all under `scripts/`:

| Layer | Script | Run | What it proves |
|---|---|---|---|
| Static | `scripts/predeploy-check.js` | `npm run check` | duplicate element ids, dead static modals, **shadow ids** (a static id that JS also builds), dead `onclick` handlers, `getElementById` reads of ids that exist nowhere, JS syntax errors in every shipped file. Exits non-zero. |
| Runtime, all pages | `scripts/smoke-pages.js` | `npm run check:pages` | boots `login.html` headless and `nav()`s to **every** key in `js/lazy-pages.js` `M{}`, failing on any thrown error. **Note: it stubs `supabase.rpc` wholesale** (`smoke-pages.js:52-58`), so it proves "does not crash", never "is correct". |
| Runtime, forms | `scripts/smoke-forms.js` | `npm run check:forms` | form-level smoke |
| Real browser | `scripts/smoke-portal.js` | `npm run smoke:portal` | signs in for real by minting a `sales_sessions` row, clicks the real buttons, asserts what a user would see |
| **The push gate** | `.githooks/pre-push` | automatic on `git push` | runs `predeploy-check.js` **and** `smoke-portal.js`; **blocks the push** on failure. Bypass is `SKIP_GATE=1 git push` and must be justified in the commit message. `npm run gate` runs the same pair by hand. |

Beyond the gate there are **29 bespoke `scripts/verify-*.js` drivers**, one per shipped
feature. They are the closest thing to an integration test suite.

### The best-tested existing module to copy
**Team Report** — `scripts/verify-team-report.js`. Read its header comment (lines 1-22); it
states the house rules explicitly:
- the test is **forbidden** from calling `renderTeamReport()` directly — it *clicks the
  sidebar*, because "the unit map once worked for six commits while being unreachable, and
  every test drove it directly";
- it asserts **reachability and truthfulness**: it writes its own fixture rows, checks they
  surface on screen, then deletes them;
- it runs against the **ZZTEST** throwaway tenant only (`ZZ = 'a2915ce7-…'`), never real data
  (memory `zztest_internal_test_tenant`);
- it reaches the DB by reading the service token out of `.mcp.json` and posting SQL.

`scripts/smoke-portal.js` adds the second rule worth copying: intercept mutating RPCs inside
the page and assert the **arguments**, so a smoke run can exercise a destructive button
without moving real data.

Chrome is resolved from a hardcoded path list; when Chrome or `puppeteer-core` is missing,
the browser scripts **exit 0 with "SKIPPED"** (`smoke-pages.js:26`). A green run is not
proof the browser layer ran — check the output.

> Screens are also verified visually: `scripts/capture-screenshots.js` (`npm run shots`)
> writes PNGs into `migration_work/*_shots/`. `#verify-gate` overlay eats clicks — call
> `_vgHide()` first (memory `portal_top_chrome_facebook_pass`). And use `page.mouse.click`,
> not `setPointerCapture` (memory `pointer_capture_kills_clicks`).

---

## 10. Design system — the token set the `dc-` palette must map to

**Yes, a token set exists and it is authoritative:** `css/foundation/tokens.css` (152 lines),
declared as *"the ONLY place colours, type sizes, spacing, radius and shadow are defined for
NEW (`nx-*`) code"*. Its own rules: Inter only, no `--mono` token (numbers use `.num`),
closed type scale 11/13/14/18/20-22 (+30 for the single dashboard hero), spacing 4/8/12/16/24,
radius 8 controls / 12 cards, exactly one shadow, zero gradients.

### 10.1 Proposed `dc-` → `fk-` mapping

| Blueprint token | RMS token | Note |
|---|---|---|
| `--dc-ink-900 #111827` | `--fk-text` (`#0F172A` light / `#E5E7EB` dark) | **map** — near-identical, and gives dark mode free |
| `--dc-ink-600 #4B5563` | `--fk-text-muted` (`#64748B` / `#94A3B8`) | **map** |
| `--dc-ink-400 #9CA3AF` | `--fk-text-muted` at reduced opacity, or a new `--dc-ink-400` | RMS has only two text ramps; a third is a genuine addition |
| `--dc-line #E5E7EB` | `--fk-border` (`#E2E8F0` / `#1E293B`) | **map**; `--fk-hairline` (`#EEF1F5`) for the fainter divider |
| `--dc-canvas #F6F7F9` | `--fk-bg-page` (`#F1F5F9` / `#0B1120`) | **map** |
| `--dc-surface #FFFFFF` | `--fk-bg-card` (`#FFFFFF` / `#111A2E`) | **map** |
| `--dc-in #0F7B4C` / `-bg #ECF8F1` | `--fk-success` (`#16A34A`) / `--fk-success-surface` | **map** — the `-surface` ramp is already `color-mix`ed against the live card so it works in dark |
| `--dc-out #B42318` / `-bg #FDF1EF` | `--fk-danger` (`#DC2626`) / `--fk-danger-surface` | **map** |
| `--dc-warn #B54708` / `-bg #FFF6E5` | `--fk-warning` (`#D97706`) / `--fk-warning-surface` | **map** |
| `--dc-lock #6B7280` / `-bg #F3F4F6` | `--fk-text-muted` / `--fk-bg-subtle` | **map** |
| `--dc-focus #2563EB` | `--fk-info` (`#2563EB`) | exact value match; tokens.css calls `#2563EB` "the ONLY sanctioned use" and reserves it as `--fk-info`, **never a brand colour** |
| `--dc-navy-900 #0B1B3A`, `--dc-navy-700 #1F3864` | **no equivalent — conflict** | RMS brand is indigo `--fk-primary #4F46E5`. See §12. |
| `--dc-r-sm 6px` / `--dc-r-md 10px` | `--fk-radius-control 8px` / `--fk-radius-card 12px` | **map** — adopt RMS's values, don't add a second radius scale |
| `--dc-t-hero 40/44` | none — RMS ceiling is `--fk-fs-hero 30px` | conflict; see §12 |
| `--dc-t-2xl 28/34` | `--fk-fs-hero 30px` | close enough to map |
| `--dc-t-xl 20/28` | `--fk-fs-kpi 20px` | **map** |
| `--dc-t-md 14/20` | `--fk-fs-title 14px` | **map** |
| `--dc-t-sm 13/18` | `--fk-fs-body 13px` | **map** |
| `--dc-t-xs 12/16` | `--fk-fs-label 11px` | RMS label is 11px, not 12px |
| Space 4/8/12/16/24/32/48 | `--fk-sp-1..6` = 4/8/12/16/24 | 32 and 48 do not exist; use multiples |
| `--dc-shadow-1` | `--fk-shadow` | **map** |
| Row 40 px desktop | `--fk-h-row: 40px` | exact match |
| Input 40 px | `--fk-h-input: 36px` | conflict — RMS inputs are 36 |
| tnum on numerics | `.num` utility | already exists |

Recommended shape: define `--dc-*` as **aliases** in a new `css/foundation/daily-closing.css`
(`--dc-in: var(--fk-success);` …) rather than as raw hex. That keeps one design system
(memory `feedback_one_design_system`), inherits dark mode, and still lets the module speak
the blueprint's vocabulary in its own markup.

---

## 11. RPC / naming conventions this module should follow

Copy `supabase/migrations/20260902a_the_number_from_the_receipt_book.sql` as the template.
It shows, in one file:
- the migration header comment written as **prose explaining why**, in English
  (this repo's commit messages and migration titles are full sentences, e.g.
  *"A manager sees what he was given and what he passed on"*);
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS` + `COMMENT ON COLUMN`;
- `DROP FUNCTION IF EXISTS` before a signature change (otherwise positional calls go
  ambiguous);
- `LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'`;
- the `_rms_caller()` → tenant → validation → `_rms_is_admin` → project-assignment guard chain;
- `jsonb_build_object('success', …)` returns with string error codes;
- `REVOKE ALL … FROM PUBLIC` / `GRANT EXECUTE … TO authenticated, service_role` after
  **every** function, and `FROM PUBLIC, anon, authenticated` + `TO service_role` for helpers;
- gapless numbering via `voucher_sequences` with `ON CONFLICT … DO UPDATE SET seq = seq + 1
  RETURNING seq` (that is a real row lock — the correct pattern for `receipt_counters`);
- `EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM)`.

Audit is **automatic** for any table that gets the trigger:
```sql
CREATE TRIGGER _trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
```
28 tables carry it today. The function is
`supabase/migrations/20260706_phase2b_audit_hardening.sql:16-95`; an operator-supplied reason
is passed in by `PERFORM set_config('rms.audit_reason', p_reason, true);` before the write
and wins over the auto-tag (line 76).

**Write English in all files** — code, comments, migrations, docs. Roman Urdu belongs only in
chat (memory `feedback_english_only_everywhere`).

---

## 12. Where the blueprint and RMS disagree

Detailed mapping proposals are at the end of RULES.md; this is the index.

| # | Blueprint says | RMS is | Severity |
|---|---|---|---|
| 1 | REST API `/api/projects/{id}/daily-closing/…` with HTTP status codes | No HTTP tier exists. Everything is `supabase.rpc()` returning `jsonb {success,error}` | **Structural** |
| 2 | `DECIMAL(18,2)` | Every money column is bare `numeric` | High |
| 3 | `business_date` in Asia/Karachi | `td()` and `CURRENT_DATE` are both UTC | **High — correctness** |
| 4 | PdfEngine renders and stores a versioned Director PDF | No PDF engine; browser print only, nothing stored. **Owner confirmed generated+stored+versioned; engine proposed — Deno edge function + `pdf-lib` (RULES §0.5), pending approval** | **Structural** |
| 5 | Domain events + handlers | No event bus. Triggers and `pg_cron` are the only async | Medium |
| 6 | `--dc-navy-900/700` as primary | Brand is indigo `--fk-primary #4F46E5`; `#2563EB` is reserved as `--fk-info` | Medium |
| 7 | 40 px hero figures, 12 px labels, 40 px inputs | Type ceiling 30 px, labels 11 px, inputs 36 px | Low |
| 8 | Roles Cashier / Accountant / CFO / Director | Roles are owner/admin/recovery/finance/manager/staff. **Resolved (RULES §0.3/§0.4):** Cashier→`staff`+grant · Accountant→`finance` · Director→`manager` · CFO→ **new `cfo` role**, because `admin` is the data-entry role and `_rms_is_admin()` is ungraded | Resolved |
| 9 | Separate `payees` master | `clients` + `agents` exist; no vendor/staff payee master at all | Medium |
| 10 | Separate `pdc_register` | `pdc_cheques` already exists with a working page and RPCs | Medium — reuse |
| 11 | Own `audit_log` table | `audit_logs` exists, is append-only, and is trigger-driven | Medium — reuse |
| 12 | Own `qb_accounts` master | Nothing exists. `banks` is company-scoped; `project_bank_accounts` is project-scoped but has no UI | New build |
| 13 | "RMS has a client ledger to feed" | It does (`get_client_ledger`). The standing rule was *"RMS does not deal with financials — QuickBooks does"*; **the owner has deliberately reversed it for this module only (RULES §0.1): cash book yes, general ledger / P&L / balance sheet / financial statements never** | Resolved — with a standing guard |
