// ============================================================================
// NEXUNOVA RMS — ANNOUNCEMENT FILE GATEKEEPER (Edge Function)
// ----------------------------------------------------------------------------
// The sales portal is anon (sales_sessions, no GoTrue), so this function is the
// sole gatekeeper for the PRIVATE `announcement-files` bucket:
//   • multipart POST  → UPLOAD: caller must be a director (ann_attach_upload_ok);
//     validates type (jpg/png/webp/pdf) + size (≤10MB); stores under
//     <company_id>/<uuid>.<ext>; returns {path,name,size,type}.
//   • JSON POST       → SIGN:   caller must be a targeted recipient/author AND the
//     path must belong to that announcement (ann_attach_read_ok); returns a
//     short-lived (5 min) signed URL.
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
// DEPLOY:  supabase functions deploy announcement-file --no-verify-jwt
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const BUCKET = "announcement-files";
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX = 10 * 1024 * 1024;

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  const sb = svc();
  const ctype = req.headers.get("content-type") || "";

  // ── UPLOAD (director only) ──
  if (ctype.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return json({ success: false, error: "bad_form" }, 400); }
    const token = String(form.get("session_token") || "");
    const file = form.get("file");
    if (!token || !(file instanceof File)) return json({ success: false, error: "bad_request" }, 400);

    const { data: authd } = await sb.rpc("ann_attach_upload_ok", { p_session_token: token });
    if (!authd || !authd.ok) return json({ success: false, error: authd?.error || "forbidden" }, 403);

    const type = file.type || "";
    if (!ALLOWED.includes(type)) return json({ success: false, error: "bad_type" }, 400);
    if (file.size > MAX) return json({ success: false, error: "too_large" }, 400);

    const ext = type === "application/pdf" ? "pdf" : (type.split("/")[1] || "bin");
    const path = `${authd.company_id}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
    if (error) { console.error("[announcement-file] upload:", error.message); return json({ success: false, error: "upload_failed" }, 500); }
    return json({ success: true, path, name: String(file.name || "file").slice(0, 120), size: file.size, type });
  }

  // ── SIGN / read (targeted recipient or author only) ──
  let body: { session_token?: string; announcement_id?: string; path?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "invalid_json" }, 400); }
  const { session_token, announcement_id, path } = body || {};
  if (!session_token || !announcement_id || !path) return json({ success: false, error: "bad_request" }, 400);

  const { data: authd } = await sb.rpc("ann_attach_read_ok", {
    p_session_token: session_token, p_announcement_id: announcement_id, p_path: path,
  });
  if (!authd || !authd.ok) return json({ success: false, error: authd?.error || "forbidden" }, 403);

  const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !signed) { console.error("[announcement-file] sign:", error?.message); return json({ success: false, error: "sign_failed" }, 500); }
  return json({ success: true, url: signed.signedUrl });
});
