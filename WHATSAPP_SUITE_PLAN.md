# WhatsApp Recovery Suite — Substrate Inventory & Build Plan ("Bomb #1")

**Read-only audit, 2026-06-14.** Live DB target verified = RMS (`itqxljtfbrppntgyfush`).
No code written. This is **plan → owner review** before any build (high-stakes:
sends real messages to real clients).

**Headline:** the comms spine is **far more built than expected.** This is *not* a
green-field build — it is a **finish-and-wire** job plus an **external Meta setup the
owner must do**. The pipeline already sent one real WhatsApp message via Meta. What's
missing is (a) Meta-approved templates, (b) per-tenant template seeding, (c) three
event triggers, (d) scheduling one cron, and (e) a receipt-PDF mechanism.

---

## 1. WHAT EXISTS & WORKS — the full pipeline, traced

### The architecture (all built, Module 7, May–Jun 2026)

```
EVENTS / CRON
   │  enqueue_message(company, jsonb)         ← single choke-point; enforces
   │    ├ enqueue_due_comms (nightly scan)       opt-out, DND, dedup, template
   │    ├ enqueue_payment_thankyou (on payment)  resolution, recipient resolution
   │    ├ cron_daily_digest_all  (owner digest)
   │    ├ cron_weekly_digest_all (owner digest)
   │    └ broadcast_message (manual blast)
   ▼
message_log  (status = queued)
   │
   │  pg_cron job 'comms-dispatch'  every 2 min  → net.http_post
   ▼
Edge fn  send-message  (deployed, ACTIVE v6, --no-verify-jwt)
   │   claim_pending_messages()   queued → sending  (FOR UPDATE SKIP LOCKED)
   │   dispatch() by COMMS_PROVIDER env: meta | wetarseel(stub) | dryrun
   │   → Meta Cloud API  graph.facebook.com/v21.0/{PHONE_ID}/messages
   │   update_message_result()    sending → sent | failed
   ▼
Edge fn  whatsapp-webhook  (deployed, ACTIVE v6)
       update_message_delivery()  sent → delivered → read
```

### Is it actually sending live? — **YES, proven once.**
`message_log` holds exactly **1 row**, and it is a **real Meta send**:
- `provider = "meta"`, `provider_message_id = "wamid.HBgMOTIzMDA5OTk4ODc3…"` (a genuine
  WhatsApp message id), `status = sent`, sent 2026-06-12.
- BUT it was `category = admin_reset_otp` (a password-reset OTP) to a **test number**
  (`+923009998877`, company ZZTEST2). **It was an auth OTP, not a recovery message.**

**Conclusion:** Meta credentials are real and the transport works end-to-end. But the
**recovery comms pipeline has never sent a single real message.** The OTP almost
certainly succeeded because the test number had an **open 24-hour session** (it was
sent as free-text — see the template gap below).

### Meta credentials / config — where they live
`send-message/index.ts` reads **only Supabase Edge Function secrets** (env vars),
never the DB:
| Env var | Purpose |
|---|---|
| `COMMS_PROVIDER` | `meta` \| `wetarseel` \| `dryrun` (default `dryrun`). The 2026-06-12 send proves it is currently **`meta`**. |
| `META_PHONE_NUMBER_ID` | the WABA sender phone-number id |
| `META_ACCESS_TOKEN` | permanent access token |
| `META_API_VERSION` | defaults `v21.0` |
| `WHATSAPP_VERIFY_TOKEN` | webhook handshake (read by `whatsapp-webhook`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | injected by platform |
> Secrets are **not** readable via SQL/MCP — confirmed live only by the real `meta` send.
> The dispatch cron (`comms-dispatch`, job 7, `*/2 * * * *`, **active**) invokes the
> edge fn with the **publishable/anon key** inlined (safe — the fn uses its own injected
> service key internally; `cron.job` is world-readable so no secret is stored there).

### Templates that exist — `message_templates`, **6 rows, Roman-Urdu, ALL for the ADMIN test company only**
| category | gist |
|---|---|
| `installment_due` | "installment PKR {{amount}} ki due date {{due_date}} hai…" |
| `overdue` | "payment PKR {{amount}} overdue ho chuki hai ({{days_overdue}} din)…" |
| `legal_notice` | "legal proceedings shuru ki ja sakti hain…" |
| `payment_received` | "Shukriya! payment PKR {{amount}} receive… Receipt: {{receipt_no}}" |
| `pdc_reminder` | "cheque {{cheque_no}} (PKR {{amount}}) {{deposit_date}} ko deposit hoga…" |
| `promise_reminder` | "kal ({{promise_date}}) aap ne PKR {{amount}} ka wada kiya tha…" |

**Two critical facts about these templates:**
1. **`meta_template_name` is NULL on all six** and `variable_map = []`. So even when
   dispatched they go out as **free-text** → Meta rejects free-text outside a 24h
   session → business-initiated recovery cannot send.
2. They belong **only to `Admin Test Company`** (`f46bb375…`). **Fourteen Group and
   Awami have ZERO templates.** A `seed_default_templates(company)` RPC exists (and a
   "Seed defaults" button in the Comms Center UI) — FG simply never seeded.

### Frontend that exists — `js/pages/comms-center.js` (451 lines, legacy CSS, not nx-kit)
A working **Comms Center** page already ships: **Templates** tab (list / edit / delete /
seed defaults — the editor *already has* an "Approved template name" + ordered merge-key
field for Meta), a **Broadcast** tab (audience picker → `broadcast_message`), and a
**Log** tab (`get_message_log`). RPCs: `list/upsert/delete_message_template`,
`seed_default_templates`, `get_message_log`. (Per memory, this page is a Nav-phase
"QA cut candidate" — it is **not** cut; it's the natural admin home for the suite.)

---

## 2. WHAT'S DORMANT vs WIRED

| Message type | Builder | State | Why dormant |
|---|---|---|---|
| **Due reminder** (T-3 days) | `enqueue_due_comms` | **Built + cron-wired** (`comms-queue-build`, daily 04:00 UTC, active) | Fires, but **`no_template`** for FG/Awami (no rows) → nothing queues. And templates lack `meta_template_name`. |
| **Overdue escalation** (D+1/7/15/30) | `enqueue_due_comms` (UNION) | **Built + cron-wired** | same as above |
| **Promise reminder** (T-1) | `enqueue_due_comms` (UNION) | **Built + cron-wired** | same (also: 0 `payment_promises` rows yet) |
| **PDC deposit reminder** (T-2) | `enqueue_due_comms` (UNION) | **Built + cron-wired** | same |
| **Payment thank-you / receipt** | `enqueue_payment_thankyou` | **Built but NEVER CALLED** (0 callers in DB — confirmed) | not wired to `record_payment*`. Pure orphan. |
| **Daily owner digest** ("Subah ki List") | `cron_daily_digest_all` | **Built but NOT SCHEDULED** | the function exists; no `cron.job` row calls it (only `radar-weekly-digest` is scheduled). Needs owner's `app_users.phone` set. |
| **Weekly owner digest** (top-10 at-risk) | `cron_weekly_digest_all` | **Built + scheduled** (`radar-weekly-digest`, Mon 04:00 UTC) | runs; same template/window caveat for sends. |
| **Statement-on-demand** | — | **MISSING entirely** | no builder, no trigger, no template. |
| **Legal notice** | template only | **Half** | template exists; no automated trigger (intentional — Legal is hidden from recovery per Subah-ki-List). Manual broadcast only. |

### Why `message_log` is empty despite live data (the root cause, ranked)
FG genuinely *has* sendable data right now: **164 clients, 100% have a phone, 0 opt-outs;
7 installments due at T+3; 17 overdue at exactly D+1/7/15/30; 1,588 overdue overall.** The
nightly cron *should* have queued ~24 FG messages. It hasn't, because:

1. **PRIMARY BLOCKER — no templates for real tenants.** `enqueue_message` looks up
   `message_templates WHERE company_id = <tenant>`. FG/Awami have none → it returns
   `{success:false, error:'no_template'}` and **inserts nothing**. Fixed by seeding.
2. **SECONDARY BLOCKER — even if seeded, `meta_template_name` is NULL** → dispatch sends
   free-text → Meta rejects business-initiated outside 24h → rows would flip `failed`.
   Fixed only after Meta approves templates and we store the approved names.
3. Window precision: the overdue trigger fires at *exactly* D+1/7/15/30, so most of the
   1,588-strong historical backlog never re-enters a window. (Design choice — fine for
   live operations; means no retroactive spam of old debt. Worth confirming with owner.)

---

## 3. THE OWNER'S EXTERNAL SETUP — what only the owner can do (CANNOT be coded)

This is the **gating dependency**. Nothing below is in our control; budget **1–3 days**
for Meta's review. Do this **before** the build's "go-live" step.

1. **Meta Business Account + WhatsApp Business Platform (Cloud API) app.**
   - A verified **Meta Business Manager** (business verification can itself take days if
     not already done).
   - Create a **WhatsApp Business App** → get the **WABA ID** and a **`phone_number_id`**.
2. **A dedicated sender phone number.**
   - A number **not already on the WhatsApp consumer/Business app**, that can receive an
     OTP to register on the Cloud API. Once registered to the API it can't be used in the
     normal WhatsApp app. Set a **display name** (Meta reviews it).
3. **A permanent access token.**
   - Create a **System User** in Business Manager → generate a **permanent token** with
     `whatsapp_business_messaging` + `whatsapp_business_management`. (Temporary tokens
     expire in 24h — must be the permanent one.)
4. **Submit message templates for approval (the long pole).**
   - Every **business-initiated** message (all our reminders/digests) **must use a
     pre-approved template** — free-text is allowed *only* inside a 24h window after the
     client messages first (won't happen for recovery).
   - Submit, in **Meta Business Manager → WhatsApp Manager → Message Templates**, one
     template per category we want to send (due / overdue / promise / pdc / payment
     receipt / digest). Each needs: name, language (we use `en`/Roman-Urdu body is fine
     under `en`), **category** (`UTILITY` for transactional reminders — cheaper & faster
     to approve than `MARKETING`), and **numbered placeholders `{{1}} {{2}}…`** matching
     our merge order.
   - **Meta approves in ~1–2 days** (sometimes minutes, sometimes rejected for wording —
     avoid anything that reads promotional; recovery reminders should be `UTILITY`).
5. **Per-message cost / WhatsApp pricing.**
   - Meta bills **per conversation** (24h window), priced by category and country
     (Pakistan). **UTILITY** conversations are cheap; **MARKETING** higher. There's a
     monthly free tier of service conversations. Owner should expect a **small per-message
     cost** and add a payment method to the WABA, or sends pause.
6. **Register the webhook (for delivery/read receipts).**
   - Meta App → WhatsApp → Configuration → Callback URL =
     `https://itqxljtfbrppntgyfush.functions.supabase.co/whatsapp-webhook`,
     Verify token = our `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**.

**Deliverables the owner hands us:** WABA id, `phone_number_id`, permanent token, the
**approved template names + their exact placeholder order**, and confirmation a billing
method is attached. We set these as Edge secrets and store the approved names in
`message_templates.meta_template_name` / `variable_map`.

---

## 4. THE BUILD — what we do once Meta is ready

Each row: **trigger → template needed → data pulled.** Most builders already exist; the
work is wiring, seeding, and the receipt-PDF mechanism.

| # | Message | Trigger | Template (Meta-approved) | Data source | Build effort |
|---|---|---|---|---|---|
| B1 | **Per-tenant template seeding + Meta-name wiring** | one-time / admin button | the 6 defaults | `seed_default_templates(FG)` + `seed_default_templates(Awami)`; then paste each approved `meta_template_name` + `variable_map` order into the editor | **tiny** — already-built RPCs |
| B2 | **Due reminder** | existing nightly cron | `installment_due` | `enqueue_due_comms` (already pulls client/amount/due_date/unit/project) | **none** — works once B1 done |
| B3 | **Overdue escalation** | existing nightly cron | `overdue` | same builder | **none** once B1 |
| B4 | **Promise / PDC reminders** | existing nightly cron | `promise_reminder` / `pdc_reminder` | same builder | **none** once B1 |
| B5 | **Payment thank-you (text)** | **NEW: call `enqueue_payment_thankyou` from `record_payment*` on success** | `payment_received` | already assembles client/amount/receipt_no/date | **small** — 1 call inside payment RPC(s); must be best-effort (never block/rollback a payment if comms fails) |
| B6 | **Daily owner digest** | **NEW: schedule `cron_daily_digest_all`** (e.g. `30 2 * * *` UTC ≈ 07:30 PKT) + ensure owner `app_users.phone` set | needs an approved **digest** template (or rely on owner's open 24h window) | reuses `get_daily_collections` + `get_today_snapshot` + promises/PDC | **small** — 1 cron + 1 template + owner phone |
| B7 | **Receipt PDF on payment** | rides B5 | a `payment_received` template **with a document header** | render existing receipt → upload to `payment-receipts` bucket → attach | **medium** — see below |
| B8 | **Statement-on-demand** | **NEW: on-demand button** (client profile / recovery queue / portal) | a `statement` template w/ document header, or a link | build statement PDF (reuse Recovery Position / ledger) → bucket → WhatsApp | **medium–large** — new builder + UI button |

### Receipt-PDF-on-WhatsApp — the mechanism (B7), concretely
`message_log` has **no media column** today, and the dispatch adapter only sends
`text`/`template` — **no document path yet.** Two viable routes:

- **(A) Link in the template body (simplest, ship first).** Render the receipt PDF
  (we already have `NXPrint`/receipt printing), upload to the **`payment-receipts`** or
  public **`recovery-documents`** bucket, get a signed/public URL, and pass it as a
  template variable (`{{4}} = receipt link`). No schema/adapter change. Client taps a
  link. **Recommended for v1.**
- **(B) True WhatsApp document attachment (richer, later).** Requires: (1) add
  `media_url` + `media_type` columns to `message_log`; (2) extend `claim_pending_messages`
  to surface them; (3) extend `sendViaMeta()` to build a **template with a `document`
  header component** (`type:"document", document:{ link }`) or upload via the **Meta media
  API** (`/{PHONE_ID}/media`) to get a `media_id`. The template must be approved **with a
  document header.** More moving parts + a template re-approval.

> Recommendation: **B7 route (A)** for launch (link), upgrade to (B) only if the owner
> wants the PDF to land inline as an attachment.

---

## 5. SAFETY — building & testing WITHOUT spamming real clients (the #1 risk)

The pipeline auto-sends every 2 minutes the moment a row hits `message_log` with
`status=queued` and `COMMS_PROVIDER=meta`. Treat every test as potentially live.

**Layered safeguards, strongest first:**
1. **Rehearse in `dryrun`.** Set `COMMS_PROVIDER=dryrun` while building — rows flip
   `queued → sent` with `provider_message_id = dryrun-…` and **no external call**. This
   is the built-in safe mode. Do all queue/template/wiring verification here first.
2. **Test in the ZZTEST scratch tenant**, never FG/Awami. ZZTEST companies exist
   (`a2915ce7…`, `1bf387f4…`); seed a single test client whose **`whatsapp` = a phone the
   tester controls**. Verify the full chain on that one number.
3. **Owner-only first.** Daily/weekly digests go to the **owner's own phone** — safe to
   live-test because the owner consents and can open a 24h window.
4. **Recipient guardrails already in `enqueue_message` (keep/lean on them):** it skips
   `comms_opt_out`, skips `dnd_status` for whatsapp/sms, and **dedups on `dedup_key`** so
   a given installment/promise can't double-send. The window-precision design (exactly
   D+1/7/15/30) also prevents mass re-blasting the 1,588-row historical backlog.
5. **A kill-switch before first FG send.** Recommend a **dry-run / test-number override
   flag** (env or a `system_config`/`company_feature_flags` gate) so a real tenant can be
   flipped live deliberately, one tenant at a time — and instantly paused by setting
   `COMMS_PROVIDER=dryrun` or unscheduling `comms-dispatch`.
6. **Confirm the historical-backlog policy with the owner** *before* go-live: do we ever
   message the 1,588 old overdue installments, or only go-forward? Default = go-forward
   (current behaviour). This is the single biggest "accidental mass-message" risk.

---

## 6. BUILD ORDER + demo line

**Phase 0 — Owner (external, blocks everything):** Meta WABA + verified number +
permanent token + submit ~7 `UTILITY` templates for approval + attach billing + register
webhook. *(1–3 days, owner-driven.)*

**Phase 1 — Wire & seed (we can start NOW, in `dryrun`):**
1. B1 — `seed_default_templates` for FG + Awami; confirm nightly enqueue starts producing
   `queued` rows in dry-run (proves due/overdue/promise/PDC end-to-end without sending).
2. B5 — wire `enqueue_payment_thankyou` into `record_payment*` (best-effort).
3. B6 — schedule `cron_daily_digest_all`; set owner phone.
4. Verify the whole queue in **dryrun** against ZZTEST + FG (rows appear, dedup holds,
   opt-out/DND respected).

**Phase 2 — Meta-ready (after Phase 0 returns):**
5. Set Edge secrets (token/phone-id), paste approved `meta_template_name` + `variable_map`
   into each template.
6. Live-test on the **tester's own number** in ZZTEST, then the **owner's number** (daily
   digest), watching `queued → sending → sent → delivered → read`.
7. B7(A) — receipt link on payment thank-you.

**Phase 3 — Go live + extend:**
8. Flip FG live (one tenant), confirm the go-forward backlog policy, monitor `message_log`.
9. B8 — statement-on-demand button; later B7(B) true PDF attachment if wanted.

**Demo-script line:**
> "Watch — I record a PKR 500,000 payment for this client… and within two minutes their
> phone buzzes: a WhatsApp from us, *'Shukriya — payment receive ho gayi, receipt #…'*,
> receipt PDF attached. Tomorrow at 7:30am you wake up to your Daily Recovery Digest, and
> every client whose installment is due in 3 days has already been reminded — automatically,
> no one lifted a finger."

---

### Appendix — exact substrate (for the builder)
- **Edge fns (deployed, ACTIVE):** `send-message` v6, `whatsapp-webhook` v6.
- **RPCs (in DB):** `enqueue_message`, `enqueue_due_comms`, `enqueue_payment_thankyou`,
  `broadcast_message`, `cron_enqueue_due_comms_all`, `cron_daily_digest_all`,
  `cron_weekly_digest_all`, `claim_pending_messages`, `update_message_result`,
  `update_message_delivery`, `render_template`, `seed_default_templates`,
  `list/upsert/delete_message_template`, `get_message_log`.
- **Cron (active):** `comms-dispatch` (*/2 min), `comms-queue-build` (daily 04:00 UTC),
  `radar-weekly-digest` (Mon 04:00 UTC). **NOT scheduled:** `cron_daily_digest_all`.
- **Tables:** `message_log` (1 row; **no media column**), `message_templates` (6 rows,
  ADMIN-only, `meta_template_name` all NULL). Recipient fields on `clients`:
  `whatsapp`, `phone_primary`, `phone_secondary`, `comms_opt_out`, `dnd_status`.
- **Buckets:** `payment-receipts` (private), `recovery-documents` (public),
  `rms-documents` (public) — usable for receipt/statement PDFs.
- **Frontend:** `js/pages/comms-center.js` (Templates / Broadcast / Log; legacy CSS,
  not yet on nx-kit — reskin opportunity if surfaced as the suite's admin home).
- **FG sendable-data snapshot (today):** 164 clients, 100% have a phone, 0 opt-outs;
  7 due T+3, 17 overdue at D+1/7/15/30, 1,588 overdue total.
</content>
</invoke>
