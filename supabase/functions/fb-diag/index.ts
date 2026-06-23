import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Facebook leads DIAGNOSTICS endpoint (portal-facing).
// Session-token gated (director/admin) — NOT a Meta endpoint. verify_jwt is false
// only so the portal's anon call reaches us; we authenticate via the sales session.
//
// actions (POST JSON { session_token, action, connection_id, ... }):
//   • test_connection   — validate the saved Page token against the Graph API
//                         (GET /{page_id}, GET /me, debug_token). Token never leaves
//                         the server; UI gets a masked tail + page name + errors.
//   • send_test_webhook — POST a synthetic leadgen payload to fb-leads-webhook so the
//                         director can confirm receipt+logging end to end. Inserts a
//                         real lead ONLY when { insert:true } is passed.
//
// DEPLOY: supabase functions deploy fb-diag --no-verify-jwt

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const GRAPH = "https://graph.facebook.com/v21.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const mask = (t?: string | null) => (t && t.length > 8) ? (t.slice(0, 4) + "…" + t.slice(-4)) : (t ? "••••" : "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  let b: any = {};
  try { b = await req.json(); } catch (_) { /* {} */ }
  const token = String(b.session_token ?? "");
  const action = String(b.action ?? "");
  if (!token) return json({ success: false, error: "session_required" }, 401);

  // ── authenticate the sales session (director/admin only) ──
  const { data: sesRows } = await sb.from("sales_sessions")
    .select("sales_user_id, company_id, expires_at").eq("session_token", token)
    .gt("expires_at", new Date().toISOString()).limit(1);
  const ses = sesRows?.[0];
  if (!ses) return json({ success: false, error: "session_expired" }, 401);
  const { data: u } = await sb.from("sales_users").select("role").eq("id", ses.sales_user_id).limit(1);
  const role = u?.[0]?.role;
  if (role !== "director" && role !== "admin") return json({ success: false, error: "forbidden" }, 403);

  // ── resolve the connection (must belong to caller's company) ──
  const connId = String(b.connection_id ?? "");
  if (!connId) return json({ success: false, error: "connection_required" }, 400);
  const { data: connRows } = await sb.from("fb_connections")
    .select("id, page_id, page_name, page_access_token, company_id")
    .eq("id", connId).eq("company_id", ses.company_id).limit(1);
  const conn = connRows?.[0];
  if (!conn) return json({ success: false, error: "connection_not_found" }, 404);

  // ── TEST CONNECTION ──────────────────────────────────────────────────────
  if (action === "test_connection") {
    if (!conn.page_id) return json({ success: false, error: "no_page_id", message: "This connection has no Page ID." });
    if (!conn.page_access_token) return json({ success: false, error: "no_token", message: "No Page Access Token is saved for this page." });
    const tok = conn.page_access_token as string;
    const out: any = { success: false, page_id: conn.page_id, token_tail: mask(tok) };
    try {
      const r = await fetch(`${GRAPH}/${encodeURIComponent(conn.page_id)}?fields=id,name&access_token=${encodeURIComponent(tok)}`);
      const pg = await r.json();
      if (pg?.error) {
        out.error = "graph_error";
        out.message = pg.error.message ?? "Graph API rejected the token.";
        out.code = pg.error.code ?? null;
        return json(out);
      }
      out.page_name_meta = pg?.name ?? null;
      out.page_id_match = String(pg?.id ?? "") === String(conn.page_id);
      // best-effort token metadata (type / expiry / scopes); ignore if Meta refuses
      try {
        const d = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(tok)}&access_token=${encodeURIComponent(tok)}`);
        const dj = await d.json();
        if (dj?.data) {
          out.token_type = dj.data.type ?? null;
          out.token_app_id = dj.data.app_id ?? null;
          out.token_expires_at = dj.data.expires_at ? (dj.data.expires_at === 0 ? "never" : new Date(dj.data.expires_at * 1000).toISOString()) : null;
          out.token_scopes = dj.data.scopes ?? null;
          out.token_valid = dj.data.is_valid ?? null;
        }
      } catch (_) { /* optional */ }
      out.success = true;
      return json(out);
    } catch (e) {
      out.error = "fetch_failed";
      out.message = String(e);
      return json(out);
    }
  }

  // ── SEND INTERNAL TEST WEBHOOK ─────────────────────────────────────────────
  if (action === "send_test_webhook") {
    const insert = b.insert === true;
    const fields = b.fields ?? { name: "NX Test Lead", phone: "03000000000", email: "nxtest@example.com" };
    const payload = {
      object: "page",
      entry: [{
        id: conn.page_id, time: Math.floor(Date.now() / 1000),
        changes: [{
          field: "leadgen",
          value: {
            page_id: conn.page_id, form_id: "NX_DIAG_FORM",
            leadgen_id: "NX_DIAG_" + Date.now(),
            _nx_test: true, _nx_test_insert: insert, _nx_test_fields: fields,
          },
        }],
      }],
    };
    try {
      const whUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/fb-leads-webhook`;
      const r = await fetch(whUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const text = await r.text();
      return json({ success: true, delivered_http: r.status, webhook_response: text, inserted_requested: insert });
    } catch (e) {
      return json({ success: false, error: "delivery_failed", message: String(e) });
    }
  }

  return json({ success: false, error: "unknown_action" }, 400);
});
