import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Facebook lead-ads webhook (MULTI-PAGE + FULL LOGGING).
// GET  = Meta verification handshake (verify_token must match a connected page).
// POST = leadgen events. For each lead: look up the connected PAGE (page_id is the
//        unique key), pull the full lead from the Graph API with THAT page's token,
//        then create the lead via the create_lead_from_fb RPC — which routes through
//        create_lead (so _norm_phone dedupe, the project-belongs-to-company guard,
//        owner=director and source=facebook are all reused). No raw insert here.
//
// Every event (verify GET / leadgen POST / internal test) is recorded in
// facebook_webhook_logs so the director can debug from the portal. Nothing fails
// silently; each lead row transitions received → processed | duplicate | failed.
//
// TEST MODE: a POST whose change.value carries `_nx_test:true` is logged as event
// 'test' and SKIPS the Graph fetch. It only inserts a real lead when
// `_nx_test_insert:true` is also set (using `_nx_test_fields`); otherwise it just
// proves the webhook received + logged the payload.
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

  // ── 1) Meta webhook verification (GET) ────────────────────────────────────
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
      // unknown token — record the rejection so the director sees a failed verify
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
    let body: any = {};
    try { body = await req.json(); } catch (_) { /* keep {} */ }
    try {
      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          if (change?.field !== "leadgen") continue;
          const v = change?.value ?? {};
          const isTest = v._nx_test === true || body._nx_test === true;
          const pageId = String(v.page_id ?? entry.id ?? "");
          const leadgenId = String(v.leadgen_id ?? "");
          const formId = String(v.form_id ?? "");

          // resolve the connected page (the unique key → per-page token/project/director)
          const { data: conns } = await sb.from("fb_connections")
            .select("id, company_id, page_access_token").eq("page_id", pageId).limit(1);
          const conn = conns?.[0];

          // record receipt immediately — nothing fails silently
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
      }
    } catch (e) {
      console.error("fb-leads-webhook error", e);
      await logEvent({ event_type: "leadgen", status: "failed", http_status: 200, error_message: "handler exception: " + String(e), raw_payload: body ?? null, processed_at: new Date().toISOString() });
    }
    // Always 200 so Meta does not disable the subscription; per-event outcome is in the log.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
