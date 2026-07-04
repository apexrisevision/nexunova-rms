// ============================================================================
// NEXUNOVA RMS — SEND WEB PUSH (Edge Function)
// ----------------------------------------------------------------------------
// Receives { subscription:{endpoint,keys:{p256dh,auth}}, payload:{title,body,url} }
// from _crm_send_push (via pg_net) and delivers a Web Push notification signed
// with VAPID.
//
// SECRETS (owner sets):
//   supabase secrets set VAPID_PUBLIC_KEY=<base64url public>
//   supabase secrets set VAPID_PRIVATE_KEY=<base64url private>
//   supabase secrets set VAPID_SUBJECT=mailto:support@nexunova.com
// Generate a keypair once:  npx web-push generate-vapid-keys
//
// DEPLOY:  supabase functions deploy send-web-push --no-verify-jwt
// ============================================================================
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subj = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@nexunova.com";
  if (!pub || !priv) {
    console.error("[send-web-push] VAPID keys not configured");
    return json({ success: false, error: "vapid_not_configured" });
  }

  let body: { subscription?: unknown; payload?: unknown };
  try { body = await req.json(); } catch { return json({ success: false, error: "invalid_json" }, 400); }
  const { subscription, payload } = body;
  if (!subscription || typeof subscription !== "object") {
    return json({ success: false, error: "missing_subscription" }, 400);
  }

  try {
    webpush.setVapidDetails(subj, pub, priv);
    await webpush.sendNotification(subscription as never, JSON.stringify(payload ?? {}));
    return json({ success: true });
  } catch (e) {
    // 404/410 → subscription is dead; caller may prune. Return 200 so pg_net doesn't retry-storm.
    const status = (e as { statusCode?: number })?.statusCode;
    console.error("[send-web-push] send failed:", status, (e as Error)?.message);
    return json({ success: false, status: status ?? null, error: (e as Error)?.message ?? "send_failed", gone: status === 404 || status === 410 });
  }
});
