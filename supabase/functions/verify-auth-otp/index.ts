import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { email, otp, type } = await req.json();
    if (!email || !otp || !type) {
      return json({ error: "email, otp, and type are required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const identifier = `${type}:${cleanEmail}`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Read latest unused OTP ────────────────────────────────────────
    const { data: token, error: tokenErr } = await supabase
      .from("otp_tokens")
      .select("id, otp, expires_at, attempts")
      .eq("phone", identifier)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenErr) console.error("[verify-auth-otp] DB read error:", tokenErr.message);

    if (!token) {
      return json({ error: "No active code found. Please request a new one." });
    }

    // ── Max attempts guard ────────────────────────────────────────────
    if ((token.attempts as number) >= MAX_ATTEMPTS) {
      await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);
      return json({ error: "Too many incorrect attempts. Please request a new code.", max_attempts: true, attempts_left: 0 });
    }

    // ── Expiry check ──────────────────────────────────────────────────
    if (new Date() > new Date(token.expires_at as string)) {
      await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);
      return json({ error: "Code has expired. Please request a new one.", expired: true });
    }

    // ── Increment attempt counter ─────────────────────────────────────
    const newAttempts = (token.attempts as number) + 1;
    await supabase
      .from("otp_tokens")
      .update({ attempts: newAttempts })
      .eq("id", token.id as string);

    // ── Compare OTP ───────────────────────────────────────────────────
    if (String(otp).trim() !== String(token.otp).trim()) {
      const attemptsLeft = MAX_ATTEMPTS - newAttempts;
      if (attemptsLeft <= 0) {
        await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);
        return json({ error: "Too many incorrect attempts. Please request a new code.", max_attempts: true, attempts_left: 0 });
      }
      return json({
        error: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining.`,
        attempts_left: attemptsLeft,
      });
    }

    // ── Mark used ─────────────────────────────────────────────────────
    await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);

    return json({ success: true });

  } catch (e) {
    console.error("[verify-auth-otp] Unhandled exception:", (e as Error).message);
    return json({ error: "Internal server error" });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
