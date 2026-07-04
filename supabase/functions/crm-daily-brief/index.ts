// ============================================================================
// NEXUNOVA RMS — CRM AI DAILY BRIEF (Edge Function)
// ----------------------------------------------------------------------------
// Called once per company by cron_daily_brief() (pg_net) at 08:00 Asia/Karachi.
//   1. crm_brief_gather(company_id)   → aggregate stats (FIRST NAMES ONLY)
//   2. Anthropic (claude-sonnet-4-6)  → a 5–8 line director briefing
//   3. save_daily_brief(...)          → store (idempotent per company+day)
//   4. crm_brief_claim_pushes(...)    → dedupe + fetch director push subs
//   5. send-web-push per subscription (tap → Command Center brief card)
//
// If the AI call fails, a plain stats-only brief is written instead (source
// 'fallback') — the brief is NEVER silently skipped.
//
// SECURITY: only aggregate stats + first names are sent to the API. No phone
// numbers, no full contact details (enforced by crm_brief_gather).
//
// SECRETS (owner sets): ANTHROPIC_API_KEY
// DEPLOY: supabase functions deploy crm-daily-brief --no-verify-jwt
// ============================================================================
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";

const MODEL = "claude-sonnet-4-6";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}: ${await r.text()}`);
  return await r.json();
}

// Deterministic, plain-English brief from the stats — the graceful AI fallback.
function fallbackBrief(s: any): string {
  const lines: string[] = [];
  const bySrc = (obj: Record<string, number>) =>
    Object.entries(obj || {}).sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  lines.push(`Yesterday: ${s.new_yesterday || 0} new leads (${bySrc(s.yesterday_by_source)}); ${s.won_yesterday || 0} won.`);
  const hot = (s.hot_leads || []);
  if (hot.length) lines.push(`Hot: ${hot.slice(0, 3).map((h: any) => `${h.lead} (${h.stage})`).join(", ")}.`);
  const od = (s.overdue_followups || []);
  if ((s.overdue_total || 0) > 0)
    lines.push(`Overdue follow-ups: ${s.overdue_total} — ${od.slice(0, 5).map((o: any) => `${o.lead} [${o.owner}, ${o.days_overdue}d]`).join(", ")}.`);
  else lines.push("No overdue follow-ups.");
  if ((s.unassigned_open || 0) > 0) lines.push(`${s.unassigned_open} unassigned open leads need an owner.`);
  lines.push(`Today so far: ${s.new_today_so_far || 0} new leads.`);
  return lines.join("\n");
}

async function writeBriefAI(stats: any): Promise<string> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const sys = [
    "You are writing a short morning briefing for a real-estate sales director.",
    "Write 5 to 8 short lines in simple, plain English. Be factual and specific — use the numbers and names given.",
    "No flattery, no filler, no emojis, no markdown headings. One idea per line.",
    "Cover, in this order: yesterday's new leads by source; any hot lead(s); missed/overdue follow-ups by name (say who owns them); and 2-3 concrete priorities for today.",
    "Names given are first names only — use them as-is. If a section has no data, say so in one short line.",
  ].join(" ");
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: sys,
    messages: [{ role: "user", content: "Here are today's stats (JSON):\n" + JSON.stringify(stats) }],
  } as any);
  const text = (msg.content || [])
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  if (!text) throw new Error("empty_ai_response");
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { company_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "invalid_json" }, 400); }
  const companyId = body.company_id;
  if (!companyId) return json({ success: false, error: "missing_company_id" }, 400);

  try {
    // 1) gather aggregate stats (first names only)
    const stats = await rpc("crm_brief_gather", { p_company_id: companyId });

    // 2) AI brief, with graceful stats-only fallback
    let brief: string, source: string, model: string | null;
    try {
      brief = await writeBriefAI(stats);
      source = "ai"; model = MODEL;
    } catch (e) {
      console.error("[crm-daily-brief] AI failed, using fallback:", (e as Error)?.message);
      brief = fallbackBrief(stats); source = "fallback"; model = null;
    }

    // 3) store (idempotent). If not inserted → already done today → no push.
    const saved = await rpc("save_daily_brief", {
      p_company_id: companyId, p_body: brief, p_stats: stats, p_model: model, p_source: source,
    });
    if (!saved?.inserted) return json({ success: true, skipped: "already_generated_today" });

    // 4) claim director pushes (dedupe per director/day) + get subscriptions
    const claim = await rpc("crm_brief_claim_pushes", { p_company_id: companyId });
    const subs = (claim?.subs || []) as Array<{ endpoint: string; p256dh: string; auth: string }>;
    const title = "Daily Brief — " + (claim?.company || stats?.company || "your team");
    const preview = brief.replace(/\s+/g, " ").slice(0, 120) + (brief.length > 120 ? "…" : "");
    const url = "https://rms.nexunova.com/sales-portal.html?brief=1";

    let pushed = 0;
    for (const sub of subs) {
      try {
        await fetch(`${SB_URL}/functions/v1/send-web-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload: { title, body: preview, url },
          }),
        });
        pushed++;
      } catch (e) { console.error("[crm-daily-brief] push failed:", (e as Error)?.message); }
    }
    return json({ success: true, source, pushed, brief_date: saved.brief_date });
  } catch (e) {
    console.error("[crm-daily-brief] fatal:", (e as Error)?.message);
    return json({ success: false, error: (e as Error)?.message ?? "failed" }, 500);
  }
});
