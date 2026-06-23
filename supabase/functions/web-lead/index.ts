import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Website lead capture (public intake).
// A form on the client's own website POSTs here with their intake key; the lead
// is created via create_lead_from_web → create_lead (dedupe + project guard +
// owner=director, source='website'). Accepts JSON (fetch) or a normal HTML form
// post (application/x-www-form-urlencoded / multipart). CORS open so browser
// forms can post directly. verify_jwt=false (the intake key is the credential).
// DEPLOY: supabase functions deploy web-lead --no-verify-jwt

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
function pick(d: Record<string, any>, keys: string[]): string {
  for (const k of Object.keys(d)) { const lk = k.toLowerCase(); if (keys.some((x) => lk === x || lk.includes(x))) { const v = d[k]; if (v != null && String(v).trim()) return String(v).trim(); } }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  const url = new URL(req.url);

  // parse JSON or form-encoded
  let d: Record<string, any> = {};
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) d = await req.json();
    else { const f = await req.formData(); for (const [k, v] of f.entries()) d[k] = typeof v === "string" ? v : ""; }
  } catch (_) { d = {}; }

  const key = String(d.key ?? d.intake_key ?? url.searchParams.get("key") ?? "").trim();
  if (!key) return json({ success: false, error: "key_required" });

  // honeypot — if a hidden field is filled, silently accept (drop) to defeat bots
  if (pick(d, ["_gotcha", "honeypot", "_hp"])) return json({ success: true, dropped: true });

  const name = pick(d, ["full_name", "fullname", "name"]);
  const phone = pick(d, ["phone", "mobile", "contact", "number", "cell"]).replace(/\s+/g, " ");
  const email = pick(d, ["email", "e-mail"]);
  const project_id = String(d.project_id ?? "").trim() || null;
  const redirect = String(d._redirect ?? d.redirect ?? "").trim();

  if (!name && !phone) return json({ success: false, error: "name_or_phone_required", message: "Please include a name or phone." });

  let res: any = null;
  try {
    const r = await sb.rpc("create_lead_from_web", { p_key: key, p_name: name || null, p_phone: phone || null, p_email: email || null, p_project_id: project_id, p_raw: d });
    res = r.data;
    if (r.error) return json({ success: false, error: "server_error", message: r.error.message });
  } catch (e) { return json({ success: false, error: "server_error", message: String(e) }); }

  if (!res || !res.success) {
    const err = res?.error || "failed";
    // duplicates / known states → treat as accepted for the visitor (don't leak details)
    if (String(err).startsWith("duplicate")) { if (redirect) return Response.redirect(redirect, 302); return json({ success: true, duplicate: true }); }
    return json({ success: false, error: err, message: res?.message || "Could not save the lead." });
  }
  if (redirect) return Response.redirect(redirect, 302);   // plain HTML form → thank-you page
  return json({ success: true });
});
