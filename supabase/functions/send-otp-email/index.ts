// ============================================================================
// NEXUNOVA RMS — SEND OTP EMAIL (Edge Function)
// ----------------------------------------------------------------------------
// Receives a delivery request from an auth RPC (via pg_net) and sends a
// transactional email via Resend (https://resend.com).
//
// Provider: Resend
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//
// Supported purposes (maps to email subject + HTML template):
//   signup               — email verification OTP for new company signup
//   admin_forgot         — admin/owner password reset OTP
//   subuser_reset_notify — notify admin that a sub-user requested a reset
//   temp_password        — send temp password to sub-user after admin reset
//
// DEPLOY:  supabase functions deploy send-otp-email --no-verify-jwt
// INVOKE:  via pg_net from auth RPCs (not called directly by the browser)
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Nexunova RMS <noreply@nexunova.com>";

// ── Internal email sender ────────────────────────────────────────────────────
async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.error("[send-otp-email] RESEND_API_KEY not configured");
    return { ok: false, error: "resend_not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html: htmlBody }),
    });
    const body = await res.json().catch(() => ({}));
    console.log("[send-otp-email] Resend status:", res.status, JSON.stringify(body));
    if (!res.ok) {
      console.error("[send-otp-email] Resend error:", JSON.stringify(body));
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[send-otp-email] fetch error:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

// ── Email templates ───────────────────────────────────────────────────────────
function otpEmailHtml(otp: string, context: string, validMins = 10): string {
  return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
  <div style="margin-bottom:20px;">
    <div style="font-size:20px;font-weight:700;color:#f8fafc;margin:0 0 4px;">Nexunova RMS</div>
    <div style="font-size:12px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Verification Code</div>
  </div>
  <p style="font-size:14px;color:#cbd5e1;margin-bottom:24px;line-height:1.6;">${context}</p>
  <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:28px 24px;text-align:center;margin-bottom:24px;">
    <div style="font-size:38px;font-weight:700;letter-spacing:10px;font-family:'Courier New',monospace;color:#6366f1;">${otp}</div>
    <div style="font-size:12px;color:#64748b;margin-top:12px;">Valid for ${validMins} minutes &nbsp;·&nbsp; Do not share this code</div>
  </div>
  <p style="font-size:12px;color:#475569;line-height:1.6;">If you didn't request this, ignore this email or contact <a href="mailto:support@nexunova.com" style="color:#6366f1;">support@nexunova.com</a></p>
</div>`.trim();
}

function subuserNotifyHtml(subuserName: string, subuserEmail: string, companyName: string): string {
  return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
  <div style="margin-bottom:20px;">
    <div style="font-size:20px;font-weight:700;color:#f8fafc;">Nexunova RMS</div>
    <div style="font-size:12px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Password Reset Request</div>
  </div>
  <p style="font-size:14px;color:#cbd5e1;line-height:1.6;">
    A user in your company <strong style="color:#f8fafc;">${companyName}</strong> has requested a password reset:
  </p>
  <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 20px;margin:20px 0;">
    <div style="font-size:14px;font-weight:600;color:#f8fafc;">${subuserName}</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px;">${subuserEmail}</div>
  </div>
  <p style="font-size:14px;color:#cbd5e1;line-height:1.6;">
    Please go to <strong>Admin Panel → User Management</strong> and click <strong>Reset Password</strong> for this user.
  </p>
  <p style="font-size:12px;color:#475569;line-height:1.6;">Nexunova RMS · support@nexunova.com</p>
</div>`.trim();
}

function tempPasswordHtml(fullName: string, tempPassword: string): string {
  return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
  <div style="margin-bottom:20px;">
    <div style="font-size:20px;font-weight:700;color:#f8fafc;">Nexunova RMS</div>
    <div style="font-size:12px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">Temporary Password</div>
  </div>
  <p style="font-size:14px;color:#cbd5e1;line-height:1.6;">Hi ${fullName},</p>
  <p style="font-size:14px;color:#cbd5e1;line-height:1.6;">Your administrator has reset your password. Use the temporary password below to sign in:</p>
  <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:24px;text-align:center;margin:20px 0;">
    <div style="font-size:22px;font-weight:700;letter-spacing:3px;font-family:'Courier New',monospace;color:#6366f1;">${tempPassword}</div>
    <div style="font-size:12px;color:#64748b;margin-top:10px;">You will be asked to set a new password on first login</div>
  </div>
  <p style="font-size:12px;color:#475569;line-height:1.6;">If you didn't expect this, contact your administrator or <a href="mailto:support@nexunova.com" style="color:#6366f1;">support@nexunova.com</a></p>
</div>`.trim();
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")
    return new Response("method_not_allowed", { status: 405, headers: CORS });

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS });
  }

  const { email, otp, purpose, company_name, subuser_name, subuser_email,
          temp_password, full_name } = body;

  if (!email || !purpose) {
    return Response.json({ error: "email and purpose required" }, { status: 400, headers: CORS });
  }

  let subject: string;
  let html: string;

  switch (purpose) {
    case "signup":
      subject = "Verify your email — Nexunova RMS";
      html    = otpEmailHtml(otp ?? "", "Use the code below to verify your email address and complete signup:");
      break;

    case "admin_forgot":
      subject = "Password reset code — Nexunova RMS";
      html    = otpEmailHtml(
        otp ?? "",
        `Use the code below to reset your Nexunova RMS password${company_name ? ` for ${company_name}` : ""}:`
      );
      break;

    case "subuser_reset_notify":
      subject = `Password reset request — ${subuser_name ?? "A user"} (${company_name ?? "your company"})`;
      html    = subuserNotifyHtml(
        subuser_name ?? "Unknown User",
        subuser_email ?? email,
        company_name ?? "your company"
      );
      break;

    case "temp_password":
      subject = "Your temporary password — Nexunova RMS";
      html    = tempPasswordHtml(full_name ?? "there", temp_password ?? "");
      break;

    default:
      return Response.json({ error: "unknown_purpose" }, { status: 400, headers: CORS });
  }

  const result = await sendEmail(email, subject, html);

  if (!result.ok) {
    console.error(`[send-otp-email] failed for ${purpose} → ${email}: ${result.error}`);
    // Return 200 so pg_net doesn't retry-storm on configuration issues.
    // The OTP is already stored in the DB — user can resend.
    return Response.json({ success: false, error: result.error }, { headers: CORS });
  }

  return Response.json({ success: true, purpose }, { headers: CORS });
});
