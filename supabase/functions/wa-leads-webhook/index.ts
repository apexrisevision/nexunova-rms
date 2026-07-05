import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — WhatsApp lead capture (Cloud API webhook).
// GET  = Meta webhook verification: echo hub.challenge if hub.verify_token matches
//        any company's per-connection verify_token (no platform secret needed).
// POST = inbound messages, SIGNATURE-VERIFIED (X-Hub-Signature-256 = HMAC-SHA256 of
//        the raw body using the company's Meta App Secret). Resolve company by
//        metadata.phone_number_id → create a lead via create_lead_from_whatsapp.
//
// SIGNATURE KEYING: whatsapp_connections has no app secret of its own — WhatsApp
// Cloud API payloads are signed by the Meta app the WABA is subscribed under, i.e.
// the company's app: fb_app_config.app_secret (resolved via the connection's
// company_id), else env FB_APP_SECRET / META_APP_SECRET. FAIL-CLOSED (401).
//
// TEST MODE (`_nx_test:true`, our "Send a test lead"): browsers can't sign, so test
// events are NOT signature-exempt — they must carry `_nx_test_secret` == the
// connection's verify_token (a per-connection server-side secret). Else 401, no lead.
//
// verify_jwt=false. Separate from the legacy `whatsapp-webhook` function.
// DEPLOY: supabase functions deploy wa-leads-webhook --no-verify-jwt

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-hub-signature-256", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };

async function hmacHex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyMetaSignature(raw: string, header: string | null, secrets: string[]): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const sigHex = header.slice("sha256=".length).trim().toLowerCase();
  for (const secret of secrets) {
    if (!secret) continue;
    const macHex = await hmacHex(secret, raw);
    if (macHex.length !== sigHex.length) continue;
    let diff = 0;
    for (let i = 0; i < macHex.length; i++) diff |= macHex.charCodeAt(i) ^ sigHex.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}
// company Meta app secret for a phone_number_id, else platform env
async function resolveWaSecrets(pnid: string): Promise<{ secrets: string[]; verify: string | null; found: boolean }> {
  const out: string[] = [];
  let verify: string | null = null;
  let found = false;
  if (pnid) {
    const { data } = await sb.from("whatsapp_connections").select("company_id, verify_token").eq("phone_number_id", pnid).limit(1);
    const c = data?.[0];
    if (c) {
      found = true;
      verify = c.verify_token ?? null;
      if (c.company_id) {
        const { data: fac } = await sb.from("fb_app_config").select("app_secret").eq("company_id", c.company_id).limit(1);
        if (fac?.[0]?.app_secret) out.push(String(fac[0].app_secret));
      }
    }
  }
  const e1 = Deno.env.get("FB_APP_SECRET"); if (e1) out.push(e1);
  const e2 = Deno.env.get("META_APP_SECRET"); if (e2) out.push(e2);
  return { secrets: out, verify, found };
}
function firstPnid(body: any): string {
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const pnid = ch?.value?.metadata?.phone_number_id;
      if (pnid) return String(pnid);
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  // ── webhook verification (GET) — stays unsigned ──
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

  const raw = await req.text();
  let body: any = {};
  try { body = JSON.parse(raw || "{}"); } catch (_) { body = {}; }
  const isTest = body && body._nx_test === true;
  const pnid = firstPnid(body);

  // ── GATE ──
  const { secrets, verify } = await resolveWaSecrets(pnid);
  if (isTest) {
    const provided = String(body?._nx_test_secret ?? "");
    if (!verify || !provided || provided !== verify) {
      console.warn("[wa-leads-webhook] rejected test: missing/invalid _nx_test_secret");
      return new Response(JSON.stringify({ received: false, error: "unauthorized_test" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  } else {
    const sigOk = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secrets);
    if (!sigOk) {
      console.warn("[wa-leads-webhook] rejected POST: invalid/absent X-Hub-Signature-256");
      return new Response(JSON.stringify({ received: false, error: "invalid_signature" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }

  const results: any[] = [];
  try {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        const v = ch?.value || {};
        const pn = v?.metadata?.phone_number_id;
        const msgs = Array.isArray(v?.messages) ? v.messages : [];
        if (!pn || !msgs.length) continue;                       // statuses / non-message events → ignore
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
          const r = await sb.rpc("create_lead_from_whatsapp", { p_phone_number_id: String(pn), p_wa_id: wa_id, p_name: name, p_text: text });
          if (isTest && r.data?.id) { try { await sb.from("leads").update({ is_test: true }).eq("id", r.data.id); } catch (_) { /* ignore */ } }
          results.push(r.data?.error || (r.data?.success ? "ok" : "failed"));
        }
      }
    }
  } catch (_) { /* swallow — always ack past the gate */ }

  return new Response(JSON.stringify({ received: true, results }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
