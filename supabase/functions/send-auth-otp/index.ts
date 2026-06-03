import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OTP_TTL_SECONDS   = 5 * 60;
const RESEND_COOLDOWN_S = 30;

// ── Rate limits (H2 #3) — cost-abuse guard beyond the per-target 30s cooldown. ──
// Window matches the OTP TTL / row retention (otp_tokens rows are cleaned at expiry),
// so the sliding-window counts are accurate. Tunable.
const RL_WINDOW_S   = OTP_TTL_SECONDS; // 5 min
const IP_MAX_SENDS  = 8;               // per client IP per window
const GLOBAL_MAX    = 100;             // all senders per window (Resend cost backstop)

// Cryptographically-strong 6-digit code (replaces Math.random).
function genOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { email, type } = await req.json();

    if (!email || !type) {
      return json({ error: "email and type are required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ error: "Invalid email address" });
    }

    const validTypes = ["password_reset", "admin_login"];
    if (!validTypes.includes(type)) {
      return json({ error: "Invalid OTP type" });
    }

    // Client IP (for rate limiting). Supabase proxies set x-forwarded-for.
    const fwd = req.headers.get("x-forwarded-for") || "";
    const clientIp = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Identifier stored in `phone` column — prefixed with type to prevent cross-flow reuse
    const identifier = `${type}:${cleanEmail}`;

    // ── Resend cooldown (per target) ──────────────────────────────────
    const cooldownCutoff = new Date(Date.now() - RESEND_COOLDOWN_S * 1000).toISOString();
    const { data: recentRow } = await supabase
      .from("otp_tokens")
      .select("created_at")
      .eq("phone", identifier)
      .gte("created_at", cooldownCutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRow) {
      const elapsed   = Math.floor((Date.now() - new Date(recentRow.created_at as string).getTime()) / 1000);
      const remaining = RESEND_COOLDOWN_S - elapsed;
      return json({ error: `Please wait ${remaining} seconds before requesting a new code.`, cooldown: remaining });
    }

    // ── IP + global rate limits (H2 #3) ───────────────────────────────
    const rlCutoff = new Date(Date.now() - RL_WINDOW_S * 1000).toISOString();
    const { count: globalCount } = await supabase
      .from("otp_tokens")
      .select("id", { count: "exact", head: true })
      .gte("created_at", rlCutoff);
    if ((globalCount ?? 0) >= GLOBAL_MAX) {
      console.warn("[send-auth-otp] global rate limit hit:", globalCount);
      return json({ error: "Verification service is temporarily busy. Please try again in a few minutes." });
    }
    if (clientIp) {
      const { count: ipCount } = await supabase
        .from("otp_tokens")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", clientIp)
        .gte("created_at", rlCutoff);
      if ((ipCount ?? 0) >= IP_MAX_SENDS) {
        console.warn("[send-auth-otp] per-IP rate limit hit:", clientIp, ipCount);
        return json({ error: "Too many verification requests from your network. Please try again later." });
      }
    }

    // ── Invalidate existing unused OTPs ───────────────────────────────
    await supabase
      .from("otp_tokens")
      .update({ used: true })
      .eq("phone", identifier)
      .eq("used", false);

    // ── Generate OTP (crypto-strong) ──────────────────────────────────
    const otp       = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from("otp_tokens")
      .insert({ phone: identifier, otp, expires_at: expiresAt, ip_address: clientIp || null });

    if (insertErr) {
      console.error("[send-auth-otp] DB insert error:", insertErr.message);
      return json({ error: "Failed to generate OTP. Please try again." });
    }

    // Background cleanup
    supabase.from("otp_tokens").delete().lt("expires_at", new Date().toISOString())
      .then(() => {}).catch(() => {});

    // ── Send email via Resend ─────────────────────────────────────────
    // Requires RESEND_API_KEY env var set in Supabase project settings.
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("[send-auth-otp] RESEND_API_KEY not configured");
      return json({ error: "Email service not configured. Please contact support@nexunova.com" });
    }

    const subject = type === "password_reset"
      ? "Your Nexunova password reset verification code"
      : "Your Nexunova login verification code";

    const context = type === "password_reset"
      ? "to verify your identity before resetting your password"
      : "to complete your admin sign-in";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    "Nexunova RMS <noreply@nexunova.com>",
        to:      cleanEmail,
        subject,
        html: `
<div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
  <div style="margin-bottom:20px;">
    <div style="font-size:20px;font-weight:700;color:#f8fafc;margin:0 0 4px;">Nexunova RMS</div>
    <div style="font-size:12px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Verification Code</div>
  </div>
  <p style="font-size:14px;color:#cbd5e1;margin-bottom:24px;line-height:1.6;">Use the code below ${context}:</p>
  <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:28px 24px;text-align:center;margin-bottom:24px;">
    <div style="font-size:38px;font-weight:700;letter-spacing:10px;font-family:'JetBrains Mono',monospace;color:#6366f1;">${otp}</div>
    <div style="font-size:12px;color:#64748b;margin-top:12px;">Valid for 5 minutes &nbsp;·&nbsp; Do not share this code</div>
  </div>
  <p style="font-size:12px;color:#475569;line-height:1.6;">If you didn't request this code, you can safely ignore this email or contact <a href="mailto:support@nexunova.com" style="color:#6366f1;">support@nexunova.com</a>.</p>
</div>`,
      }),
    });

    const resendStatus = emailRes.status;
    const resendBody   = await emailRes.json().catch(() => ({}));
    console.log("[send-auth-otp] Resend status:", resendStatus);

    if (!emailRes.ok) {
      console.error("[send-auth-otp] Resend error (status", resendStatus, "):", JSON.stringify(resendBody));
      return json({ error: "Failed to send verification code. Please try again." });
    }

    // Mask email for display
    const atIdx  = cleanEmail.indexOf("@");
    const local  = cleanEmail.slice(0, atIdx);
    const domain = cleanEmail.slice(atIdx);
    const masked = local.slice(0, Math.min(2, local.length)) + "***" + domain;

    return json({ success: true, masked_email: masked });

  } catch (e) {
    console.error("[send-auth-otp] Unhandled exception:", (e as Error).message);
    return json({ error: "Internal server error" });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
