import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Instagram Direct Message lead capture.
// (Instagram lead ADS already arrive via the Facebook Page leadgen webhook; this
//  captures Direct Messages — a separate source.)
// GET  = webhook verification: echo hub.challenge if hub.verify_token matches any
//        company's per-connection verify_token (no platform secret).
// POST = object "instagram", entry[].messaging[] events, SIGNATURE-VERIFIED
//        (X-Hub-Signature-256 = HMAC-SHA256 of the raw body). Resolve company by the
//        IG account id (entry.id) → create lead via create_lead_from_instagram.
//
// SIGNATURE KEYING: instagram_connections has no app secret of its own — IG payloads
// are signed by the company's Meta app: fb_app_config.app_secret (via the
// connection's company_id), else env FB_APP_SECRET / META_APP_SECRET. FAIL-CLOSED.
//
// TEST MODE (`_nx_test:true`): NOT signature-exempt — must carry `_nx_test_secret`
// == the connection's verify_token (per-connection server-side secret). Else 401.
//
// verify_jwt=false.
// DEPLOY: supabase functions deploy ig-leads-webhook --no-verify-jwt

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
async function resolveIgSecrets(igId: string): Promise<{ secrets: string[]; verify: string | null }> {
  const out: string[] = [];
  let verify: string | null = null;
  if (igId) {
    const { data } = await sb.from("instagram_connections").select("company_id, verify_token").eq("ig_account_id", igId).limit(1);
    const c = data?.[0];
    if (c) {
      verify = c.verify_token ?? null;
      if (c.company_id) {
        const { data: fac } = await sb.from("fb_app_config").select("app_secret").eq("company_id", c.company_id).limit(1);
        if (fac?.[0]?.app_secret) out.push(String(fac[0].app_secret));
      }
    }
  }
  const e1 = Deno.env.get("FB_APP_SECRET"); if (e1) out.push(e1);
  const e2 = Deno.env.get("META_APP_SECRET"); if (e2) out.push(e2);
  return { secrets: out, verify };
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
      const { data } = await sb.from("instagram_connections").select("ig_account_id").eq("verify_token", token).limit(1);
      if (data && data.length) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method", { status: 405, headers: CORS });

  const raw = await req.text();
  let body: any = {};
  try { body = JSON.parse(raw || "{}"); } catch (_) { body = {}; }
  const isTest = body && body._nx_test === true;
  const igId = String((Array.isArray(body?.entry) ? body.entry : [])[0]?.id || "").trim();

  // ── GATE ──
  const { secrets, verify } = await resolveIgSecrets(igId);
  if (isTest) {
    const provided = String(body?._nx_test_secret ?? "");
    if (!verify || !provided || provided !== verify) {
      console.warn("[ig-leads-webhook] rejected test: missing/invalid _nx_test_secret");
      return new Response(JSON.stringify({ received: false, error: "unauthorized_test" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  } else {
    const sigOk = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secrets);
    if (!sigOk) {
      console.warn("[ig-leads-webhook] rejected POST: invalid/absent X-Hub-Signature-256");
      return new Response(JSON.stringify({ received: false, error: "invalid_signature" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }

  const results: any[] = [];
  try {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const eid = String(entry?.id || "").trim();
      const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const ev of events) {
        const msg = ev?.message;
        if (!msg || msg.is_echo) continue;                         // skip our own outgoing / non-message events
        const senderId = String(ev?.sender?.id || "").trim();
        if (!eid || !senderId) continue;
        let text = "";
        if (msg?.text) text = msg.text;
        else if (Array.isArray(msg?.attachments) && msg.attachments.length) text = "[" + (msg.attachments[0]?.type || "attachment") + "]";
        const name = ev?.sender?.username || "";                   // usually absent; lead falls back to "Instagram lead"
        const r = await sb.rpc("create_lead_from_instagram", { p_ig_account_id: eid, p_sender_id: senderId, p_name: name, p_text: text });
        if (isTest && r.data?.id) { try { await sb.from("leads").update({ is_test: true }).eq("id", r.data.id); } catch (_) { /* ignore */ } }
        results.push(r.data?.error || (r.data?.success ? "ok" : "failed"));
      }
    }
  } catch (_) { /* swallow — always ack past the gate */ }

  return new Response(JSON.stringify({ received: true, results }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
