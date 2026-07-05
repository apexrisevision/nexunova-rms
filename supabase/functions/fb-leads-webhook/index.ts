import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Facebook lead-ads webhook (MULTI-PAGE + FULL LOGGING).
// GET  = Meta verification handshake (verify_token must match a connected page).
// POST = leadgen events. SIGNATURE-VERIFIED (X-Hub-Signature-256 = HMAC-SHA256 of
//        the raw body using the Meta App Secret). For each lead: look up the
//        connected PAGE (page_id is the unique key), pull the full lead from the
//        Graph API with THAT page's token, then create the lead via the
//        create_lead_from_fb RPC.
//
// SIGNATURE KEYING (per connection → per company → platform, first match wins):
//   1. fb_connections.app_secret  (the page's own Meta app secret, if stored)
//   2. fb_app_config.app_secret   (the company's Meta app secret)
//   3. env FB_APP_SECRET / META_APP_SECRET (platform Meta app)
// A real leadgen POST with a missing/invalid signature is rejected 401 and logged
// as 'rejected'. No lead is created. FAIL-CLOSED.
//
// TEST MODE (`_nx_test:true`): our own "Send a test lead" flow. Browsers cannot
// produce a Meta signature, so test events are NOT signature-exempt — instead they
// must carry `_nx_test_secret` equal to the connection's per-connection verify_token
// (a server-side secret the authenticated director has; an attacker who only knows
// the public page_id does not). Missing/invalid → 401 'rejected', no insert.
//
// verify_jwt MUST stay false (Meta sends no auth header).
// DEPLOY: supabase functions deploy fb-leads-webhook --no-verify-jwt

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const GRAPH = "https://graph.facebook.com/v21.0";

function pick(fd: any[], keys: string[]): string {
  for (const f of fd ?? []) {
    const n = String(f?.name ?? "").toLowerCase();
    if (keys.some((k) => n.includes(k))) return String(f?.values?.[0] ?? "");
  }
  return "";
}

// ── Meta X-Hub-Signature-256 verification (tries each candidate secret) ──────
async function hmacHex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
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
    if (diff === 0) return true;                       // constant-time per candidate
  }
  return false;
}
// candidate signing secrets for a page: per-page → per-company → platform env
async function resolveFbSecrets(pageId: string): Promise<string[]> {
  const out: string[] = [];
  if (pageId) {
    const { data } = await sb.from("fb_connections")
      .select("app_secret, company_id").eq("page_id", pageId).limit(1);
    const c = data?.[0];
    if (c?.app_secret) out.push(String(c.app_secret));
    if (c?.company_id) {
      const { data: fac } = await sb.from("fb_app_config")
        .select("app_secret").eq("company_id", c.company_id).limit(1);
      if (fac?.[0]?.app_secret) out.push(String(fac[0].app_secret));
    }
  }
  const e1 = Deno.env.get("FB_APP_SECRET"); if (e1) out.push(e1);
  const e2 = Deno.env.get("META_APP_SECRET"); if (e2) out.push(e2);
  return out;
}

// insert a log row, return its id (best-effort — never throws into the request path)
async function logEvent(row: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await sb.from("facebook_webhook_logs").insert(row).select("id").single();
    if (error) { console.error("log insert error", error); return null; }
    return data?.id ?? null;
  } catch (e) { console.error("log insert threw", e); return null; }
}
async function updateLog(id: string | null, patch: Record<string, unknown>) {
  if (!id) return;
  try {
    const { error } = await sb.from("facebook_webhook_logs").update(patch).eq("id", id);
    if (error) console.error("log update error", error);
  } catch (e) { console.error("log update threw", e); }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── 1) Meta webhook verification (GET) — stays unsigned (Meta requires it) ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token) {
      const { data } = await sb.from("fb_connections")
        .select("id, company_id, page_id").eq("verify_token", token).limit(1);
      const conn = data?.[0];
      if (conn) {
        await logEvent({
          company_id: conn.company_id, connection_id: conn.id, page_id: conn.page_id,
          event_type: "verify", status: "verified", http_status: 200,
          raw_payload: { "hub.mode": mode, "hub.challenge": challenge },
          processed_at: new Date().toISOString(),
        });
        return new Response(challenge ?? "", { status: 200 });
      }
      await logEvent({
        event_type: "verify", status: "forbidden", http_status: 403,
        error_message: "verify_token did not match any connected page",
        raw_payload: { "hub.mode": mode }, processed_at: new Date().toISOString(),
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ── 2) Lead events (POST) ─────────────────────────────────────────────────
  if (req.method === "POST") {
    const raw = await req.text();
    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch (_) { body = {}; }

    // classify the request and find the routing page_id (first one present)
    const pairs: Array<{ e: any; c: any }> = [];
    for (const e of body?.entry ?? []) {
      for (const c of e?.changes ?? []) pairs.push({ e, c });
    }
    const isTestReq = body?._nx_test === true || pairs.some(({ c }) => c?.value?._nx_test === true);
    let firstPageId = "";
    for (const { e, c } of pairs) {
      const pid = String(c?.value?.page_id ?? e?.id ?? "");
      if (pid) { firstPageId = pid; break; }
    }

    // ── GATE ──────────────────────────────────────────────────────────────
    if (isTestReq) {
      // test-mode: require the connection's verify_token as a shared secret
      const provided = String(
        body?._nx_test_secret ??
        pairs.find(({ c }) => c?.value?._nx_test_secret != null)?.c?.value?._nx_test_secret ?? "",
      );
      const { data: vt } = await sb.from("fb_connections")
        .select("verify_token, company_id, id").eq("page_id", firstPageId).limit(1);
      const expected = String(vt?.[0]?.verify_token ?? "");
      if (!expected || !provided || provided !== expected) {
        await logEvent({
          company_id: vt?.[0]?.company_id ?? null, connection_id: vt?.[0]?.id ?? null,
          page_id: firstPageId || null, event_type: "test", status: "rejected", http_status: 401,
          is_test: true, error_message: "test rejected: missing/invalid _nx_test_secret",
          raw_payload: { note: "verify_token gate" }, processed_at: new Date().toISOString(),
        });
        return new Response("unauthorized test", { status: 401 });
      }
    } else {
      // real leadgen: require a valid Meta signature (fail-closed)
      const secrets = await resolveFbSecrets(firstPageId);
      const sigOk = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secrets);
      if (!sigOk) {
        console.warn("[fb-leads-webhook] rejected POST: invalid/absent X-Hub-Signature-256");
        await logEvent({
          page_id: firstPageId || null, event_type: "leadgen", status: "rejected", http_status: 401,
          error_message: secrets.length
            ? "rejected: invalid/absent X-Hub-Signature-256"
            : "rejected: no app secret configured for this page (set fb_app_config.app_secret or FB_APP_SECRET)",
          processed_at: new Date().toISOString(),
        });
        return new Response("invalid signature", { status: 401 });
      }
    }

    // ── PROCESS (authorized) ────────────────────────────────────────────────
    try {
      for (const { e: entry, c: change } of pairs) {
        if (change?.field !== "leadgen") continue;
        const v = change?.value ?? {};
        const isTest = v._nx_test === true || body._nx_test === true;
        const pageId = String(v.page_id ?? entry.id ?? "");
        const leadgenId = String(v.leadgen_id ?? "");
        const formId = String(v.form_id ?? "");

        const { data: conns } = await sb.from("fb_connections")
          .select("id, company_id, page_access_token").eq("page_id", pageId).limit(1);
        const conn = conns?.[0];

        const logId = await logEvent({
          company_id: conn?.company_id ?? null, connection_id: conn?.id ?? null,
          page_id: pageId || null, form_id: formId || null, leadgen_id: leadgenId || null,
          event_type: isTest ? "test" : "leadgen", status: "received", http_status: 200,
          is_test: isTest, raw_payload: { webhook: v },
        });

        if (!pageId || (!leadgenId && !isTest)) {
          await updateLog(logId, { status: "failed", error_message: "missing page_id/leadgen_id", processed_at: new Date().toISOString() });
          continue;
        }
        if (!conn) {
          await updateLog(logId, { status: "failed", error_message: "no connected page for page_id " + pageId, processed_at: new Date().toISOString() });
          continue;
        }

        // ── TEST MODE: skip Graph; only insert if explicitly asked ──
        if (isTest) {
          if (!(v._nx_test_insert === true)) {
            await updateLog(logId, { status: "received", error_message: "test webhook received (no lead inserted)", processed_at: new Date().toISOString() });
            continue;
          }
          const tf = v._nx_test_fields ?? {};
          const tName = String(tf.name ?? "NX Test Lead");
          const tPhone = String(tf.phone ?? "").replace(/\s/g, "");
          const tEmail = String(tf.email ?? "");
          const { data: tRes, error: tErr } = await sb.rpc("create_lead_from_fb", {
            p_page_id: pageId, p_name: tName, p_phone: tPhone || null, p_email: tEmail || null,
            p_raw: { test: true, fields: tf },
          });
          if (tErr) {
            await updateLog(logId, { status: "failed", error_message: "create_lead_from_fb: " + tErr.message, lead_name: tName, lead_phone: tPhone, processed_at: new Date().toISOString() });
          } else if (tRes?.success) {
            await updateLog(logId, { status: "processed", lead_id: tRes.id ?? null, lead_name: tName, lead_phone: tPhone, processed_at: new Date().toISOString() });
          } else {
            const dup = String(tRes?.error ?? "").startsWith("duplicate");
            await updateLog(logId, { status: dup ? "duplicate" : "failed", error_message: tRes?.message ?? tRes?.error ?? "lead not created", lead_name: tName, lead_phone: tPhone, processed_at: new Date().toISOString() });
          }
          continue;
        }

        // ── REAL LEAD: pull from Graph with the page token ──
        if (!conn.page_access_token) {
          await updateLog(logId, { status: "failed", error_message: "page has no saved access token", processed_at: new Date().toISOString() });
          continue;
        }
        let lead: any = null;
        try {
          const r = await fetch(`${GRAPH}/${leadgenId}?access_token=${encodeURIComponent(conn.page_access_token)}`);
          lead = await r.json();
        } catch (e) {
          await updateLog(logId, { status: "failed", error_message: "graph fetch threw: " + String(e), processed_at: new Date().toISOString() });
          continue;
        }
        if (!lead || lead.error) {
          await updateLog(logId, { status: "failed", error_message: "graph error: " + (lead?.error?.message ?? "unknown"), raw_payload: { webhook: v, graph_error: lead?.error ?? null }, processed_at: new Date().toISOString() });
          continue;
        }

        const fd: any[] = lead.field_data ?? [];
        const name = pick(fd, ["full_name", "name"]) || pick(fd, ["first"]) || "Facebook lead";
        const phone = pick(fd, ["phone"]).replace(/\s/g, "");
        const email = pick(fd, ["email"]);

        const { data: res, error } = await sb.rpc("create_lead_from_fb", {
          p_page_id: pageId, p_name: name, p_phone: phone || null, p_email: email || null, p_raw: lead,
        });
        if (error) {
          await updateLog(logId, { status: "failed", error_message: "create_lead_from_fb: " + error.message, lead_name: name, lead_phone: phone, raw_payload: { webhook: v, lead }, processed_at: new Date().toISOString() });
        } else if (res?.success) {
          await updateLog(logId, { status: "processed", lead_id: res.id ?? null, lead_name: name, lead_phone: phone, raw_payload: { webhook: v, lead }, processed_at: new Date().toISOString() });
        } else {
          const dup = String(res?.error ?? "").startsWith("duplicate");
          await updateLog(logId, { status: dup ? "duplicate" : "failed", error_message: res?.message ?? res?.error ?? "lead not created", lead_name: name, lead_phone: phone, raw_payload: { webhook: v, lead }, processed_at: new Date().toISOString() });
        }
      }
    } catch (e) {
      console.error("fb-leads-webhook error", e);
      await logEvent({ event_type: "leadgen", status: "failed", http_status: 200, error_message: "handler exception: " + String(e), raw_payload: body ?? null, processed_at: new Date().toISOString() });
    }
    // Always 200 (past the gate) so Meta does not disable the subscription; per-event outcome is in the log.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
