// ============================================================================
// NEXUNOVA RMS — MODULE 7 DISPATCH — DELIVERY WEBHOOK (Edge Function)
// ----------------------------------------------------------------------------
// Receives provider delivery callbacks and advances message_log status
// (sent -> delivered -> read, or failed) by correlating on
// provider_message_id. Parses the Meta WhatsApp Cloud API webhook shape;
// WeTarseel/other BSPs forward the same Meta envelope or a thin wrapper —
// adjust parseStatuses() if your BSP differs.
//
// GET  = Meta verification handshake (hub.challenge).
// POST = status notifications.
//
// DEPLOY:  supabase functions deploy whatsapp-webhook --no-verify-jwt
// SECRETS: supabase secrets set WHATSAPP_VERIFY_TOKEN=<your-random-token>
// CONFIGURE in Meta App > WhatsApp > Configuration > Callback URL:
//   https://<project-ref>.functions.supabase.co/whatsapp-webhook
//   Verify token = WHATSAPP_VERIFY_TOKEN ; subscribe to "messages".
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Map a Meta status string to our message_log lifecycle vocabulary.
function mapStatus(s: string): string | null {
  switch (s) {
    case "sent": return "sent";
    case "delivered": return "delivered";
    case "read": return "read";
    case "failed": return "failed";
    default: return null;
  }
}

// Extract [{ id, status, error }] from the Meta webhook envelope.
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

  // --- POST: delivery status callbacks ---
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
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
    // Always 200 so the provider doesn't retry-storm on unrelated events.
    return Response.json({ success: true, received: statuses.length, updated });
  }

  return new Response("method_not_allowed", { status: 405 });
});
