# Module 7 — Comms Dispatch: go-live checklist

The whole pipeline is built and **inert by default** (provider = `dryrun`). Nothing
sends a real message until you complete the steps below. Until then the queue
fills nightly and (if you wire the dispatch cron) rows flip to `sent` in dry-run.

## Architecture (already built)

```
events ─┐
        ├─ enqueue_message() ──► message_log (status=queued)
cron ───┘   (opt-out + DND + dedup enforced)
                                      │
              pg_cron 'comms-dispatch' every 2 min
                                      │  net.http_post
                                      ▼
                       Edge fn: send-message  ──► claim_pending_messages()  (queued→sending)
                            │  provider adapter (meta | wetarseel | dryrun)
                            ▼
                       update_message_result()  (sending→sent | failed)
                                      ▲
                       Edge fn: whatsapp-webhook ──► update_message_delivery()  (→delivered → read)
```

| SQL object | role | exposure |
|---|---|---|
| `enqueue_message` / `enqueue_due_comms` / `enqueue_payment_thankyou` / `broadcast_message` | build the queue | anon, authenticated |
| `cron_enqueue_due_comms_all` | nightly scan (job `comms-queue-build`, 04:00 UTC / 09:00 PKT) | anon, authenticated |
| `claim_pending_messages` / `update_message_result` / `update_message_delivery` | dispatch + webhook | **service_role only** |

## Step 1 — pick a provider & get credentials

**Meta WhatsApp Cloud API (direct):** WABA ID, `phone_number_id`, a **permanent**
access token, plus a random `WHATSAPP_VERIFY_TOKEN` you invent for the webhook.

**WeTarseel (BSP):** the WeTarseel API base URL + API key, and your approved
template names. Then fill in `sendViaWeTarseel()` in `send-message/index.ts`
(the stub marks where the request/response shape goes).

> Business-initiated WhatsApp messages **must use a pre-approved template**.
> In each `message_templates` row set `meta_template_name`, `meta_language`, and
> `variable_map` (ordered keys → `{{1}},{{2}}` e.g. `["client_name","amount","due_date"]`).
> Free-text only works inside an open 24-hour customer-service window.

## Step 2 — deploy the functions

```bash
supabase functions deploy send-message     --no-verify-jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

## Step 3 — set secrets

```bash
# Meta:
supabase secrets set COMMS_PROVIDER=meta \
  META_PHONE_NUMBER_ID=xxxx* META_ACCESS_TOKEN=xxxxx \
  WHATSAPP_VERIFY_TOKEN=<random-string>

# WeTarseel:
supabase secrets set COMMS_PROVIDER=wetarseel \
  WETARSEEL_API_URL=https://api.wetarseel... WETARSEEL_API_KEY=xxxxx
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Step 4 — register the webhook (Meta only)

Meta App → WhatsApp → Configuration → Callback URL:
`https://<project-ref>.functions.supabase.co/whatsapp-webhook`,
Verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**.

## Step 5 — schedule the dispatch sweep

Run in SQL (needs `pg_net`). **Store the service key in Vault, don't inline it**
— the `cron.job` table is readable:

```sql
-- one-time: stash the key
select vault.create_secret('<SERVICE_ROLE_KEY>', 'comms_dispatch_key');

select cron.schedule('comms-dispatch', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.functions.supabase.co/send-message',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='comms_dispatch_key')),
    body := '{}'::jsonb);
$$);
```

## Step 6 — flip the switch

Set `COMMS_PROVIDER=meta` (or `wetarseel`). Send a test by queueing one row to
your own number, then watch `message_log.status` go `queued → sending → sent →
delivered → read`. Leave `dryrun` set to rehearse safely first.
