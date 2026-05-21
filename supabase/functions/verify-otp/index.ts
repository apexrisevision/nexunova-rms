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
    const { cnic, otp } = await req.json();
    if (!cnic || !otp) return json({ error: "CNIC and OTP are required" });

    const cleanCnic = cnic.replace(/[-\s]/g, "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Resolve client ────────────────────────────────────────────────────
    let client: Record<string, unknown> | null = null;
    const { data: d1 } = await supabase
      .from("clients")
      .select("id, full_name, phone_primary, cnic, email, city, address")
      .eq("cnic", cnic)
      .maybeSingle();

    if (d1) {
      client = d1;
    } else {
      const { data: d2 } = await supabase
        .from("clients")
        .select("id, full_name, phone_primary, cnic, email, city, address")
        .eq("cnic", cleanCnic)
        .maybeSingle();
      client = d2;
    }

    if (!client) return json({ error: "No account found for this CNIC" });

    const rawPhone = client.phone_primary as string;
    if (!rawPhone) return json({ error: "No phone number registered. Please contact support." });

    // ── Normalise to E.164 (identical to send-otp) ────────────────────────
    const digits = rawPhone.replace(/\D/g, "");
    const e164Phone = digits.startsWith("0")
      ? "+92" + digits.slice(1)
      : digits.startsWith("92")
      ? "+" + digits
      : rawPhone.startsWith("+")
      ? rawPhone
      : "+92" + digits;

    // ── Read latest unused OTP ────────────────────────────────────────────
    const { data: token, error: tokenErr } = await supabase
      .from("otp_tokens")
      .select("id, otp, expires_at, attempts")
      .eq("phone", e164Phone)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenErr) console.error("[verify-otp] DB read error:", tokenErr.message);

    if (!token) {
      return json({ error: "No active OTP found. Please request a new code." });
    }

    // ── Max attempts guard ────────────────────────────────────────────────
    if ((token.attempts as number) >= MAX_ATTEMPTS) {
      await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);
      return json({ error: "Too many incorrect attempts. Please request a new code." });
    }

    // ── Expiry check ──────────────────────────────────────────────────────
    if (new Date() > new Date(token.expires_at as string)) {
      await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);
      return json({ error: "OTP expired. Please request a new code." });
    }

    // ── Increment attempt counter ─────────────────────────────────────────
    await supabase
      .from("otp_tokens")
      .update({ attempts: (token.attempts as number) + 1 })
      .eq("id", token.id as string);

    // ── Compare OTP ───────────────────────────────────────────────────────
    if (String(otp).trim() !== String(token.otp).trim()) {
      const attemptsLeft = MAX_ATTEMPTS - ((token.attempts as number) + 1);
      return json({
        error: attemptsLeft > 0
          ? `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining.`
          : "Too many incorrect attempts. Please request a new code.",
      });
    }

    // ── Mark used ─────────────────────────────────────────────────────────
    await supabase.from("otp_tokens").update({ used: true }).eq("id", token.id as string);

    // ── Fetch sale ────────────────────────────────────────────────────────
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .select(
        `id, sale_number, sale_date, status, total_amount, net_amount,
         remaining_amount, down_payment, discount, installment_count,
         payment_plan_type, unit_id, client_id, wht_amount, cvt_amount`
      )
      .eq("client_id", client.id)
      .in("status", ["active", "booked", "completed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (saleErr || !sale) {
      console.error("[verify-otp] Sale lookup failed:", saleErr?.message);
      return json({ error: "No sale record found for this account. Please contact support." });
    }

    // ── Fetch unit ────────────────────────────────────────────────────────
    const { data: unit } = await supabase
      .from("units")
      .select(
        `id, unit_no, floor_id, floor_no, floor_label, area, area_unit,
         bedrooms, bathrooms, block, facing, unit_type_id, possession_date,
         handover_status, is_premium`
      )
      .eq("id", sale.unit_id)
      .maybeSingle();

    // ── Fetch floor ───────────────────────────────────────────────────────
    let floor = null;
    if (unit?.floor_id) {
      const { data: f } = await supabase
        .from("floors")
        .select("id, name, sort_order")
        .eq("id", unit.floor_id)
        .maybeSingle();
      floor = f;
    }

    // ── Fetch unit type ───────────────────────────────────────────────────
    let unit_type = null;
    if (unit?.unit_type_id) {
      const { data: t } = await supabase
        .from("category_unit_types")
        .select("id, type_name, type_code")
        .eq("id", unit.unit_type_id)
        .maybeSingle();
      unit_type = t;
    }

    // ── Fetch installments ────────────────────────────────────────────────
    const { data: installments } = await supabase
      .from("installments")
      .select("id, installment_number, due_date, amount_due, amount_paid, status, installment_type, notes")
      .eq("sale_id", sale.id)
      .order("installment_number", { ascending: true });

    // ── Fetch confirmed payments ──────────────────────────────────────────
    const { data: payments } = await supabase
      .from("payments")
      .select("id, payment_code, amount, payment_date, payment_method, reference_no, status, notes, bank_name")
      .eq("sale_id", sale.id)
      .eq("status", "confirmed")
      .order("payment_date", { ascending: false });

    return json({
      success:      true,
      client,
      sale,
      unit:         unit        ?? null,
      floor:        floor       ?? null,
      unit_type:    unit_type   ?? null,
      installments: installments ?? [],
      payments:     payments    ?? [],
    });

  } catch (e) {
    console.error("[verify-otp] Unhandled exception:", (e as Error).message);
    return json({ error: "Internal server error" });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
