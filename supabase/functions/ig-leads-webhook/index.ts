import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Instagram Direct Message lead capture.
// (Instagram lead ADS already arrive via the Facebook Page leadgen webhook; this
//  captures Direct Messages — a separate source.)
// GET  = webhook verification: echo hub.challenge if hub.verify_token matches any
//        company's per-connection verify_token (no platform secret).
// POST = object "instagram", entry[].messaging[] events. Resolve company by the IG
//        account id (entry.id) → create lead via create_lead_from_instagram.
//        Skips echoes (our own outgoing) and read/delivery events. Always 200.
// verify_jwt=false.
// DEPLOY: supabase functions deploy ig-leads-webhook --no-verify-jwt

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && token) {
      const { data } = await sb.from("instagram_connections").select("ig_account_id").eq("verify_token", token).limit(1);
      if (data && data.length) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method", { status: 405, headers: CORS });

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  const results: any[] = [];
  try {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const igId = String(entry?.id || "").trim();
      const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const ev of events) {
        const msg = ev?.message;
        if (!msg || msg.is_echo) continue;                         // skip our own outgoing / non-message events
        const senderId = String(ev?.sender?.id || "").trim();
        if (!igId || !senderId) continue;
        let text = "";
        if (msg?.text) text = msg.text;
        else if (Array.isArray(msg?.attachments) && msg.attachments.length) text = "[" + (msg.attachments[0]?.type || "attachment") + "]";
        const name = ev?.sender?.username || "";                   // usually absent; lead falls back to "Instagram lead"
        const r = await sb.rpc("create_lead_from_instagram", { p_ig_account_id: igId, p_sender_id: senderId, p_name: name, p_text: text });
        results.push(r.data?.error || (r.data?.success ? "ok" : "failed"));
      }
    }
  } catch (_) { /* swallow — always ack */ }

  return new Response(JSON.stringify({ received: true, results }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
