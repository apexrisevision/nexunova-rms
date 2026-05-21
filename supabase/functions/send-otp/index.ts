import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OTP_TTL_SECONDS   = 5 * 60;
const RESEND_COOLDOWN_S = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { cnic } = await req.json();
    if (!cnic) return json({ error: "CNIC is required" });

    const cleanCnic = cnic.replace(/[-\s]/g, "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Resolve client ────────────────────────────────────────────────────
    let client: Record<string, unknown> | null = null;
    const { data: d1 } = await supabase
      .from("clients")
      .select("id, full_name, phone_primary, cnic")
      .eq("cnic", cnic)
      .maybeSingle();

    if (d1) {
      client = d1;
    } else {
      const { data: d2 } = await supabase
        .from("clients")
        .select("id, full_name, phone_primary, cnic")
        .eq("cnic", cleanCnic)
        .maybeSingle();
      client = d2;
    }

    if (!client) return json({ error: "No account found for this CNIC" });

    const rawPhone = client.phone_primary as string;
    if (!rawPhone) return json({ error: "No phone number registered. Please contact support." });

    // ── Normalise to E.164 ────────────────────────────────────────────────
    const digits = rawPhone.replace(/\D/g, "");
    const e164Phone = digits.startsWith("0")
      ? "+92" + digits.slice(1)
      : digits.startsWith("92")
      ? "+" + digits
      : rawPhone.startsWith("+")
      ? rawPhone
      : "+92" + digits;

    // ── Resend cooldown ───────────────────────────────────────────────────
    const cooldownCutoff = new Date(Date.now() - RESEND_COOLDOWN_S * 1000).toISOString();
    const { data: recentRow } = await supabase
      .from("otp_tokens")
      .select("created_at")
      .eq("phone", e164Phone)
      .gte("created_at", cooldownCutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRow) {
      const elapsed   = Math.floor((Date.now() - new Date(recentRow.created_at as string).getTime()) / 1000);
      const remaining = RESEND_COOLDOWN_S - elapsed;
      return json({ error: `Please wait ${remaining} seconds before requesting a new code.` });
    }

    // ── Invalidate existing unused OTPs ───────────────────────────────────
    await supabase
      .from("otp_tokens")
      .update({ used: true })
      .eq("phone", e164Phone)
      .eq("used", false);

    // ── Generate OTP ──────────────────────────────────────────────────────
    const otp       = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from("otp_tokens")
      .insert({ phone: e164Phone, otp, expires_at: expiresAt });

    if (insertErr) {
      console.error("[send-otp] DB insert error:", insertErr.message);
      return json({ error: "Failed to generate OTP. Please try again." });
    }

    // ── Background cleanup of expired tokens ──────────────────────────────
    supabase.from("otp_tokens").delete().lt("expires_at", new Date().toISOString())
      .then(() => {}).catch(() => {});

    // ── Send SMS via Twilio Messages API ──────────────────────────────────
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
    const msgSvcSid  = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? "";

    const smsParams: Record<string, string> = {
      To:   e164Phone,
      Body: `Your Nexunova verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`,
    };
    if (fromNumber)  smsParams.From               = fromNumber;
    else if (msgSvcSid) smsParams.MessagingServiceSid = msgSvcSid;
    else return json({ error: "SMS sender not configured. Please contact support." });

    const smsRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:  "Basic " + btoa(`${accountSid}:${authToken}`),
        },
        body: new URLSearchParams(smsParams),
      }
    );

    if (!smsRes.ok) {
      let twilioCode = "";
      try {
        const errData = await smsRes.json();
        twilioCode = errData?.code ? ` (code ${errData.code})` : "";
        console.error("[send-otp] Twilio error:", errData?.message, twilioCode);
      } catch (_) { /* ignore */ }
      return json({ error: `Failed to send verification code${twilioCode}. Please try again.` });
    }

    const masked = "****" + rawPhone.slice(-4);
    return json({ success: true, masked_phone: masked });

  } catch (e) {
    console.error("[send-otp] Unhandled exception:", (e as Error).message);
    return json({ error: "Internal server error" });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
