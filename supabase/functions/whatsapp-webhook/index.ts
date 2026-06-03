// ============================================================================
// NEXUNOVA RMS — MODULE 7 DISPATCH — DELIVERY WEBHOOK (Edge Function)
// ----------------------------------------------------------------------------
// Receives provider delivery callbacks and advances message_log status
// (sent -> delivered -> read, or failed) by correlating on
// provider_message_id. Parses the Meta WhatsApp Cloud API webhook shape.
//
// GET  = Meta verification handshake (hub.challenge).
// POST = status notifications — REQUIRES a valid X-Hub-Signature-256 (HMAC-SHA256
//        of the raw body using the Meta App Secret). Forged callbacks are rejected.
//
// DEPLOY:  supabase functions deploy whatsapp-webhook --no-verify-jwt
// SECRETS: supabase secrets set WHATSAPP_VERIFY_TOKEN=<your-random-token>
//          supabase secrets set META_APP_SECRET=<Meta App > Settings > Basic > App Secret>
//   ⚠️ POST verification is FAIL-CLOSED: until META_APP_SECRET is set, all POSTs are
//      rejected (401). WhatsApp delivery callbacks are not live yet, so this is safe —
//      but META_APP_SECRET MUST be set before going live or statuses won't advance.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Verify Meta's X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(appSecret, rawBody).
async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return false;                       // fail-closed if not configured
  if (!header || !header.startsWith("sha256=")) return false;
  const sigHex = header.slice("sha256=".length).trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const macHex = [...new Uint8Array(macBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time comparison
  if (macHex.length !== sigHex.length) return false;
  let diff = 0;
  for (let i = 0; i < macHex.length; i++) diff |= macHex.charCodeAt(i) ^ sigHex.charCodeAt(i);
  return diff === 0;
}

function mapStatus(s: string): string | null {
  switch (s) {
    case "sent": return "sent";
    case "delivered": return "delivered";
    case "read": return "read";
    case "failed": return "failed";
    default: return null;
  }
}

function parseStatuses(body: any): Array<{ id: string; status: string; error?: string }> {
  const out: Array<{ id: string; status: string; error?: string }> = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const st of change?.value?.statuses ?? []) {
        if (st?.id && st?.status) {
          out.push({ id: st.id, status: st.status, error: st?.errors?.[0]?.title });
        }
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- GET: Meta verification handshake ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  // --- POST: delivery status callbacks (signature-verified) ---
  if (req.method === "POST") {
    const raw = await req.text();
    const sigOk = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"));
    if (!sigOk) {
      console.warn("[whatsapp-webhook] rejected POST: invalid/absent X-Hub-Signature-256");
      return new Response("invalid signature", { status: 401 });
    }

    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    const statuses = parseStatuses(body);
    let updated = 0;
    for (const s of statuses) {
      const mapped = mapStatus(s.status);
      if (!mapped) continue;
      const { data } = await sb.rpc("update_message_delivery", {
        p_provider_message_id: s.id,
        p_status: mapped,
        p_error: s.error ?? null,
      });
      if (data?.success) updated++;
    }
    // 200 so the provider doesn't retry-storm on unrelated (but validly-signed) events.
    return Response.json({ success: true, received: statuses.length, updated });
  }

  return new Response("method_not_allowed", { status: 405 });
});
