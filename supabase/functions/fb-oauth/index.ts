import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Facebook OAuth Connect (one-app, multi-tenant).
// Lets a director connect a Page in 2–3 clicks: no manual Page ID / token / verify
// token / callback URL / subscription. Session-token gated (director/admin).
//
// actions (POST JSON):
//   • config   — public, no session. Returns app_id + redirect_uri + scopes so the
//                portal can open the OAuth dialog. { configured:false } until the
//                platform secrets are set.
//   • exchange — { session_token, code } → code→short→long-lived user token →
//                /me/accounts. Stores user token + page tokens in fb_oauth_sessions
//                under a one-time nonce. Returns nonce + [{ref,name}] only (NO ids/tokens).
//   • save     — { session_token, nonce, ref, project_id } → resolves the chosen page
//                SERVER-SIDE, reuses save_fb_page (mint temp director session) to upsert
//                the connection (auto verify_token via column default), auto-subscribes
//                the page to `leadgen`, verifies the subscription, runs token diagnostics,
//                and returns a masked connected summary.
//
// Platform secrets (set once in Supabase → Edge Functions → Secrets):
//   FB_APP_ID, FB_APP_SECRET, FB_OAUTH_REDIRECT (the whitelisted callback page URL).
// DEPLOY: supabase functions deploy fb-oauth --no-verify-jwt

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const GRAPH = "https://graph.facebook.com/v21.0";
const APP_ID = Deno.env.get("FB_APP_ID") ?? "";
const APP_SECRET = Deno.env.get("FB_APP_SECRET") ?? "";
const REDIRECT = Deno.env.get("FB_OAUTH_REDIRECT") ?? "";
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "leads_retrieval"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const mask = (t?: string | null) => (t && t.length > 8) ? (t.slice(0, 4) + "********" + t.slice(-4)) : (t ? "••••" : "");
const maskId = (id?: string | null) => { const s = String(id ?? ""); return s.length > 4 ? ("•••• " + s.slice(-4)) : s; };
const rid = () => crypto.randomUUID().replaceAll("-", "");

async function gate(token: string): Promise<{ ok: boolean; company_id?: string; sales_user_id?: string; err?: string }> {
  if (!token) return { ok: false, err: "session_required" };
  const { data: ses } = await sb.from("sales_sessions")
    .select("sales_user_id, company_id, expires_at").eq("session_token", token)
    .gt("expires_at", new Date().toISOString()).limit(1);
  const s = ses?.[0];
  if (!s) return { ok: false, err: "session_expired" };
  const { data: u } = await sb.from("sales_users").select("role").eq("id", s.sales_user_id).limit(1);
  const role = u?.[0]?.role;
  if (role !== "director" && role !== "admin") return { ok: false, err: "forbidden" };
  return { ok: true, company_id: s.company_id, sales_user_id: s.sales_user_id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  let b: any = {};
  try { b = await req.json(); } catch (_) { /* {} */ }
  const action = String(b.action ?? "");

  // ── CONFIG (public) ────────────────────────────────────────────────────────
  if (action === "config") {
    const configured = !!(APP_ID && APP_SECRET && REDIRECT);
    return json({ success: true, configured, app_id: APP_ID || null, redirect_uri: REDIRECT || null, scopes: SCOPES, graph_version: "v21.0" });
  }

  const g = await gate(String(b.session_token ?? ""));
  if (!g.ok) return json({ success: false, error: g.err }, g.err === "forbidden" ? 403 : 401);

  // ── EXCHANGE ────────────────────────────────────────────────────────────────
  if (action === "exchange") {
    if (!(APP_ID && APP_SECRET && REDIRECT)) return json({ success: false, error: "not_configured", message: "Facebook OAuth is not set up yet." });
    const code = String(b.code ?? "");
    if (!code) return json({ success: false, error: "code_required" });
    try {
      // code → short-lived user token
      const r1 = await fetch(`${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(APP_ID)}&redirect_uri=${encodeURIComponent(REDIRECT)}&client_secret=${encodeURIComponent(APP_SECRET)}&code=${encodeURIComponent(code)}`);
      const j1 = await r1.json();
      if (j1?.error || !j1?.access_token) return json({ success: false, error: "code_exchange_failed", message: j1?.error?.message ?? "Could not exchange the login code." });
      // short → long-lived user token
      let userTok = j1.access_token as string;
      const r2 = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}&fb_exchange_token=${encodeURIComponent(userTok)}`);
      const j2 = await r2.json();
      if (j2?.access_token) userTok = j2.access_token;
      // managed pages (each carries its own page access token)
      const r3 = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,tasks&limit=200&access_token=${encodeURIComponent(userTok)}`);
      const j3 = await r3.json();
      if (j3?.error) return json({ success: false, error: "pages_fetch_failed", message: j3.error.message });
      const pages = (j3?.data ?? []).map((p: any) => ({ page_id: String(p.id), name: String(p.name ?? p.id), access_token: p.access_token, tasks: p.tasks ?? [] }));
      if (!pages.length) return json({ success: false, error: "no_pages", message: "No Facebook Pages are managed by this account." });

      const nonce = rid() + rid();
      await sb.from("fb_oauth_sessions").delete().lt("expires_at", new Date().toISOString()); // opportunistic cleanup
      const { error: insErr } = await sb.from("fb_oauth_sessions").insert({ nonce, company_id: g.company_id, sales_user_id: g.sales_user_id, user_token: userTok, pages });
      if (insErr) return json({ success: false, error: "state_save_failed", message: insErr.message });

      // expose only an opaque ref + name — never page_id or token
      return json({ success: true, nonce, pages: pages.map((p: any, i: number) => ({ ref: i, name: p.name })) });
    } catch (e) {
      return json({ success: false, error: "exchange_failed", message: String(e) });
    }
  }

  // ── SAVE (select page + project, subscribe, verify, diagnose) ────────────────
  if (action === "save") {
    const nonce = String(b.nonce ?? "");
    const ref = Number(b.ref);
    const projectId = b.project_id ? String(b.project_id) : null;
    if (!nonce || !Number.isInteger(ref)) return json({ success: false, error: "bad_request" });

    const { data: rows } = await sb.from("fb_oauth_sessions")
      .select("nonce, company_id, pages, expires_at").eq("nonce", nonce).eq("company_id", g.company_id)
      .gt("expires_at", new Date().toISOString()).limit(1);
    const st = rows?.[0];
    if (!st) return json({ success: false, error: "oauth_expired", message: "This connection step expired — please reconnect." });
    const pages = (st.pages ?? []) as any[];
    const pick = pages[ref];
    if (!pick || !pick.page_id) return json({ success: false, error: "invalid_selection" });
    const pageId = String(pick.page_id);
    const pageTok = String(pick.access_token ?? "");
    const pageName = String(pick.name ?? pageId);
    if (!pageTok) return json({ success: false, error: "no_page_token", message: "Facebook did not return a token for this page (missing permission?)." });

    // reuse save_fb_page (auto verify_token, page_taken guard, status) via a temp session
    const tempTok = "fboauth_" + rid() + rid();
    await sb.from("sales_sessions").insert({ company_id: g.company_id, sales_user_id: g.sales_user_id, session_token: tempTok, expires_at: new Date(Date.now() + 120000).toISOString() });
    const { data: saveRes, error: saveErr } = await sb.rpc("save_fb_page", {
      p_session_token: tempTok,
      p_payload: { page_id: pageId, page_name: pageName, page_access_token: pageTok, project_id: projectId, auto_notify: true },
    });
    await sb.from("sales_sessions").delete().eq("session_token", tempTok);
    if (saveErr) return json({ success: false, error: "save_failed", message: saveErr.message });
    if (!saveRes?.success) return json({ success: false, error: saveRes?.error ?? "save_failed", message: saveRes?.message ?? "Could not save this page." });

    // auto-subscribe the page to leadgen
    let subscribed = false; let subError: string | null = null;
    try {
      const rs = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(pageTok)}`, { method: "POST" });
      const js = await rs.json();
      if (js?.error) subError = js.error.message ?? "subscribe failed";
      // verify
      const rv = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(pageTok)}`);
      const jv = await rv.json();
      const apps = jv?.data ?? [];
      subscribed = apps.some((a: any) => Array.isArray(a.subscribed_fields) ? a.subscribed_fields.includes("leadgen")
        : (a.subscribed_fields && typeof a.subscribed_fields === "object" && JSON.stringify(a.subscribed_fields).includes("leadgen")));
    } catch (e) { subError = String(e); }

    // token diagnostics (best-effort)
    const diag: any = { token_tail: mask(pageTok) };
    try {
      const rd = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(pageTok)}&access_token=${encodeURIComponent(pageTok)}`);
      const jd = await rd.json();
      if (jd?.data) {
        diag.token_type = jd.data.type ?? null;
        diag.token_valid = jd.data.is_valid ?? null;
        diag.token_expires_at = jd.data.expires_at ? (jd.data.expires_at === 0 ? "never" : new Date(jd.data.expires_at * 1000).toISOString()) : "never";
        diag.token_scopes = jd.data.scopes ?? null;
      }
    } catch (_) { /* optional */ }

    await sb.from("fb_oauth_sessions").delete().eq("nonce", nonce); // one-time

    return json({
      success: true, connection_id: saveRes.id, status: saveRes.status,
      page_name: pageName, page_id_masked: maskId(pageId),
      subscribed, subscribe_error: subError, ...diag,
    });
  }

  return json({ success: false, error: "unknown_action" }, 400);
});
