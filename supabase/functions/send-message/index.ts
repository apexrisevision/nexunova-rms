// ============================================================================
// NEXUNOVA RMS — MODULE 7 DISPATCH — SEND ADAPTER (Edge Function)
// ----------------------------------------------------------------------------
// Drains the message queue and sends via a MODULAR provider adapter.
// Provider is chosen by the COMMS_PROVIDER env var:
//   "meta"      -> WhatsApp Cloud API (graph.facebook.com)   [reference]
//   "wetarseel" -> WeTarseel BSP REST API                    [stub: fill in]
//   "dryrun"    -> no external call; marks rows sent (default when no creds)
//
// The queue claim + write-back live in SQL RPCs (claim_pending_messages /
// update_message_result), so this function is pure transport. Adding SMS
// later = another `case` in dispatch() — the queue logic never changes.
//
// DEPLOY:  supabase functions deploy send-message --no-verify-jwt
// SECRETS: supabase secrets set COMMS_PROVIDER=meta \
//            META_PHONE_NUMBER_ID=... META_ACCESS_TOKEN=...
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform)
// INVOKE:  via pg_cron + pg_net (see supabase/functions/README_dispatch.md)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROVIDER = (Deno.env.get("COMMS_PROVIDER") ?? "dryrun").toLowerCase();

// ---- Meta WhatsApp Cloud API creds ----
const META_PHONE_ID = Deno.env.get("META_PHONE_NUMBER_ID") ?? "";
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_VERSION = Deno.env.get("META_API_VERSION") ?? "v21.0";
// ---- WeTarseel BSP creds ----
const WT_URL = Deno.env.get("WETARSEEL_API_URL") ?? "";
const WT_KEY = Deno.env.get("WETARSEEL_API_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface QueuedMsg {
  id: string;
  company_id: string;
  channel: string;
  to_address: string;
  body_rendered: string;
  category: string | null;
  meta_template_name: string | null;
  meta_language: string | null;
  variable_map: string[] | null;
  merge_data: Record<string, string> | null;
}
interface SendResult { ok: boolean; providerMessageId?: string; error?: string }

// Normalise a PK phone number to E.164 digits (mirrors whatsapp-helper._plCleanPhone)
function cleanPhone(raw: string): string {
  let n = (raw || "").replace(/[^\d]/g, "");
  if (n.startsWith("0092")) return "92" + n.substring(4);
  if (n.startsWith("0")) return "92" + n.substring(1);
  if (!n.startsWith("92")) return "92" + n;
  return n;
}

// ---- Provider adapters -----------------------------------------------------
async function sendViaMeta(m: QueuedMsg): Promise<SendResult> {
  if (!META_PHONE_ID || !META_TOKEN) return { ok: false, error: "meta_creds_missing" };
  const to = cleanPhone(m.to_address);
  let payload: Record<string, unknown>;
  if (m.meta_template_name) {
    // Business-initiated -> approved TEMPLATE message (required outside the 24h window)
    const vars = Array.isArray(m.variable_map) ? m.variable_map : [];
    const params = vars.map((k) => ({ type: "text", text: String(m.merge_data?.[k] ?? "") }));
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: m.meta_template_name,
        language: { code: m.meta_language || "en" },
        ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
      },
    };
  } else {
    // Free-text only valid inside an open 24h session window
    payload = { messaging_product: "whatsapp", to, type: "text", text: { body: m.body_rendered } };
  }
  const res = await fetch(`https://graph.facebook.com/${META_VERSION}/${META_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: JSON.stringify(data?.error ?? data).slice(0, 500) };
  return { ok: true, providerMessageId: data?.messages?.[0]?.id };
}

async function sendViaWeTarseel(m: QueuedMsg): Promise<SendResult> {
  // STUB — WeTarseel exposes its own REST API (not the raw Meta graph endpoint).
  // Fill in once the account + endpoint are known. Typical shape:
  //   POST {WT_URL}/messages  Authorization: Bearer {WT_KEY}
  //   body: { phone, template_name, parameters: [...] }  OR  { phone, text }
  if (!WT_URL || !WT_KEY) return { ok: false, error: "wetarseel_creds_missing" };
  const to = cleanPhone(m.to_address);
  const body = m.meta_template_name
    ? { phone: to, template_name: m.meta_template_name, language: m.meta_language || "en",
        parameters: (m.variable_map ?? []).map((k) => String(m.merge_data?.[k] ?? "")) }
    : { phone: to, text: m.body_rendered };
  const res = await fetch(`${WT_URL.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WT_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: JSON.stringify(data).slice(0, 500) };
  // adjust to WeTarseel's real response field for the message id:
  return { ok: true, providerMessageId: data?.id ?? data?.message_id };
}

function sendViaDryRun(m: QueuedMsg): SendResult {
  console.log(`[DRYRUN] -> ${m.channel}:${m.to_address} :: ${m.body_rendered?.slice(0, 80)}`);
  return { ok: true, providerMessageId: `dryrun-${m.id}` };
}

async function dispatch(m: QueuedMsg): Promise<SendResult> {
  switch (PROVIDER) {
    case "meta": return await sendViaMeta(m);
    case "wetarseel": return await sendViaWeTarseel(m);
    default: return sendViaDryRun(m);
  }
}

// ---- Handler ---------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const { data: claim, error } = await sb.rpc("claim_pending_messages", { p_limit: 50 });
  if (error) return Response.json({ success: false, error: error.message }, { status: 500 });

  const msgs: QueuedMsg[] = claim?.messages ?? [];
  let sent = 0, failed = 0;
  for (const m of msgs) {
    const r = await dispatch(m);
    await sb.rpc("update_message_result", {
      p_id: m.id,
      p_status: r.ok ? "sent" : "failed",
      p_provider: PROVIDER,
      p_provider_message_id: r.providerMessageId ?? null,
      p_error: r.error ?? null,
    });
    r.ok ? sent++ : failed++;
  }
  return Response.json({ success: true, provider: PROVIDER, claimed: msgs.length, sent, failed });
});
