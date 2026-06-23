import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — WhatsApp lead capture (Cloud API webhook).
// GET  = Meta webhook verification: echo hub.challenge if hub.verify_token matches
//        any company's per-connection verify_token (no platform secret needed).
// POST = inbound messages: resolve company by metadata.phone_number_id → create a
//        lead via create_lead_from_whatsapp (→ create_lead, source='whatsapp',
//        owner=active director). Always 200 so Meta doesn't retry-storm.
// verify_jwt=false. Separate from the legacy `whatsapp-webhook` function.
// DEPLOY: supabase functions deploy wa-leads-webhook --no-verify-jwt

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  // ── webhook verification ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && token) {
      const { data } = await sb.from("whatsapp_connections").select("phone_number_id").eq("verify_token", token).limit(1);
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
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        const v = ch?.value || {};
        const pnid = v?.metadata?.phone_number_id;
        const msgs = Array.isArray(v?.messages) ? v.messages : [];
        if (!pnid || !msgs.length) continue;                       // statuses / non-message events → ignore
        const contacts = Array.isArray(v?.contacts) ? v.contacts : [];
        for (const m of msgs) {
          const from = String(m?.from || "").trim();
          const c = contacts.find((x: any) => x?.wa_id === from) || contacts[0] || {};
          const name = c?.profile?.name || "";
          const wa_id = String(c?.wa_id || from || "").trim();
          let text = "";
          if (m?.text?.body) text = m.text.body;
          else if (m?.button?.text) text = m.button.text;
          else if (m?.interactive?.list_reply?.title) text = m.interactive.list_reply.title;
          else if (m?.interactive?.button_reply?.title) text = m.interactive.button_reply.title;
          else if (m?.type) text = "[" + m.type + "]";
          if (!wa_id) continue;
          const r = await sb.rpc("create_lead_from_whatsapp", { p_phone_number_id: String(pnid), p_wa_id: wa_id, p_name: name, p_text: text });
          results.push(r.data?.error || (r.data?.success ? "ok" : "failed"));
        }
      }
    }
  } catch (_) { /* swallow — always ack */ }

  return new Response(JSON.stringify({ received: true, results }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
