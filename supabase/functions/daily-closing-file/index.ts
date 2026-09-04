// ============================================================================
// DAILY CLOSING — FILE BRIDGE (Edge Function)  ·  P6
// ----------------------------------------------------------------------------
// The `daily-closing` bucket is private and has NO storage policy at all, by
// design (§A10). That means `authenticated` cannot sign a URL for itself, and
// it cannot upload either. This is the only door, and it checks who is knocking
// before it opens.
//
// Two operations, both requiring the caller's own RMS session:
//
//   POST { op: 'upload-url', entry_id }
//        → a short-lived SIGNED UPLOAD url and the storage key to use. The key
//          is built here, never accepted from the browser, and always begins
//          with the entry's project_id — so one project's bill cannot be
//          written into another's folder.
//
//   POST { op: 'read-url', attachment_id }
//        → a 10-minute signed download url (§A7).
//
// AUTHORISATION IS THE DATABASE'S, NOT THIS FUNCTION'S. It forwards the
// caller's JWT to authorize_cash_attachment / a project check, so the same
// invariant-8 rule that guards every other read applies here too. The service
// key is used ONLY to mint the signed url, after the answer is already yes.
//
// DEPLOY:  supabase functions deploy daily-closing-file --no-verify-jwt
//   verify_jwt stays FALSE because this function reads the Authorization
//   header itself; deploying through MCP silently resets it to true.
// ============================================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "daily-closing";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Call an RPC AS THE CALLER, so the database applies its own guards. */
async function rpcAsCaller(auth: string, fn: string, args: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) return null;
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "NOT_AUTHORIZED" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "NOT_AUTHORIZED" }, 401);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "INVALID_TRANSITION" }, 400); }

  // ── read a file ──────────────────────────────────────────────────────────
  if (body.op === "read-url") {
    const ok = await rpcAsCaller(auth, "authorize_cash_attachment", {
      p_company_id: body.company_id,
      p_attachment_id: body.attachment_id,
    });
    if (!ok || ok.success !== true) return json({ error: ok?.error ?? "NOT_AUTHORIZED" }, 403);

    const r = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${ok.storage_key}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 600 }),   // §A7: ten minutes
      },
    );
    if (!r.ok) return json({ error: "NOT_AUTHORIZED" }, 403);
    const signed = await r.json();
    return json({
      success: true,
      url: `${SUPABASE_URL}/storage/v1${signed.signedURL}`,
      mime: ok.mime,
      expires_in: 600,
    });
  }

  // ── put a file ───────────────────────────────────────────────────────────
  if (body.op === "upload-url") {
    // The browser does not get to choose where its file lands. The path is
    // built from the entry the database confirms it may touch.
    const ok = await rpcAsCaller(auth, "get_cash_entry_project", {
      p_company_id: body.company_id,
      p_entry_id: body.entry_id,
    });
    if (!ok || ok.success !== true) return json({ error: ok?.error ?? "NOT_AUTHORIZED" }, 403);

    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" } as
      Record<string, string>)[body.mime] ?? null;
    if (!ext) return json({ error: "INVALID_TRANSITION", message: "JPG, PNG or PDF only." }, 400);

    const key = `${ok.project_id}/${body.entry_id}/${crypto.randomUUID()}.${ext}`;
    const r = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${key}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 300 }),
      },
    );
    if (!r.ok) return json({ error: "NOT_AUTHORIZED" }, 403);
    const signed = await r.json();
    return json({
      success: true,
      storage_key: key,
      url: `${SUPABASE_URL}/storage/v1${signed.url}`,
      expires_in: 300,
    });
  }

  return json({ error: "INVALID_TRANSITION", message: "Unknown op." }, 400);
});
