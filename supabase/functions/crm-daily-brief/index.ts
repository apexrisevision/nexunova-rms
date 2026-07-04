// ============================================================================
// NEXUNOVA RMS — NEXUBRIEF (Edge Function)
// ----------------------------------------------------------------------------
// Called once per company by cron_daily_brief() (pg_net) at 09:00 Asia/Karachi.
//   1. crm_brief_gather(company_id)  → aggregate stats (FIRST NAMES ONLY)
//   2. Nexunova intelligence layer   → two structured sections:
//        { yesterday: string, suggestions: string[] }
//   3. save_daily_brief(...)         → store (idempotent per company+day)
//   4. post_brief_message(...)       → post into the inbox (directors only)
//   5. crm_brief_claim_pushes(...)   → dedupe + push directors ("NexuBrief")
//
// On generation failure a deterministic stats-only brief is stored + posted
// (source 'fallback') — the brief is NEVER silently skipped.
//
// BRANDING: nothing user-visible names any model or vendor. The product is
// "NexuBrief" / "Nexu Suggestions". (The model id is recorded only in the
// crm_daily_brief.model column, which is never shown to users.)
//
// PRIVACY: only aggregate stats + first names leave for generation — no phone
// numbers, no full contact details (enforced by crm_brief_gather).
//
// SECRETS: ANTHROPIC_API_KEY.  DEPLOY: supabase functions deploy crm-daily-brief --no-verify-jwt
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

function dateLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short" })
      .format(new Date((iso || "") + "T06:00:00Z"));
  } catch { return ""; }
}
function firstLine(s: string): string {
  const l = (s || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] || "Your morning brief is ready.";
  return l.length > 140 ? l.slice(0, 139) + "…" : l;
}
const bySrc = (obj: Record<string, number>) =>
  Object.entries(obj || {}).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, v]) => `${v} ${k}`).join(", ");

// Deterministic content from stats — the graceful fallback (and drives good suggestions).
function fallbackContent(s: any): { yesterday: string; suggestions: string[] } {
  const y: string[] = [];
  y.push(`${s.new_yesterday || 0} new lead${(s.new_yesterday || 0) === 1 ? "" : "s"} yesterday${(s.new_yesterday || 0) > 0 ? " (" + bySrc(s.yesterday_by_source) + ")" : ""}.`);
  if ((s.won_yesterday || 0) > 0) y.push(`${s.won_yesterday} deal${s.won_yesterday === 1 ? "" : "s"} won.`);
  const hot = s.hot_leads || [];
  if (hot.length) y.push(`Hot: ${hot.slice(0, 2).map((h: any) => `${h.lead} (${h.stage})`).join(", ")}.`);
  if ((s.overdue_total || 0) > 0) {
    const od = (s.overdue_followups || []).slice(0, 3).map((o: any) => `${o.lead} [${o.owner}]`).join(", ");
    y.push(`${s.overdue_total} follow-up${s.overdue_total === 1 ? "" : "s"} overdue: ${od}.`);
  }
  if ((s.unassigned_open || 0) > 0) y.push(`${s.unassigned_open} lead${s.unassigned_open === 1 ? "" : "s"} unassigned.`);

  const sug: string[] = [];
  const w = s.worst_untouched;
  if (w && w.hours) sug.push(`${w.lead} has waited ${w.hours} hours with no contact — assign or call today.`);
  if ((s.unassigned_open || 0) > 0) sug.push(`${s.unassigned_open} lead${s.unassigned_open === 1 ? "" : "s"} sit unassigned — distribute them to your team.`);
  const inactive = s.inactive_agents || [];
  if (inactive.length) sug.push(`${inactive.slice(0, 3).join(", ")} logged no follow-ups this week — check in.`);
  const drought = s.source_drought || [];
  if (drought.length) sug.push(`${drought.join(", ")} produced no leads in 3 days — verify the campaign is running.`);
  if (!sug.length && (s.overdue_total || 0) > 0) sug.push(`Clear the ${s.overdue_total} overdue follow-up${s.overdue_total === 1 ? "" : "s"}, oldest first.`);
  return { yesterday: y.join("\n"), suggestions: sug.slice(0, 4) };
}

async function generate(stats: any): Promise<{ yesterday: string; suggestions: string[] }> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const sys = [
    "You write a concise morning briefing for a real-estate sales director. Return ONLY valid JSON — no markdown, no code fences — with exactly two keys:",
    '{"yesterday": string, "suggestions": string[]}.',
    '"yesterday": 4 to 6 short factual lines separated by \\n — leads by source, notable hot lead(s), overdue follow-ups by name, unassigned count. Plain English, no flattery, no emojis.',
    '"suggestions": 2 to 4 concrete, specific actions derived STRICTLY from the data (use the given names and numbers). Examples of shape: "Ali has waited 81 hours with no contact — assign him to a rep today"; "3 leads sit unassigned — distribute them"; "Bilal logged zero follow-ups this week — check in"; "Facebook produced no leads for 3 days — verify the campaign".',
    "Never invent data. If the data supports only one real suggestion, return one. Do not pad with generic advice. No flattery, no emojis. Names given are first names — use as-is; never output phone numbers.",
  ].join(" ");
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 900, system: sys,
    messages: [{ role: "user", content: "Data (JSON):\n" + JSON.stringify(stats) }],
  } as any);
  let text = (msg.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z < 0) throw new Error("no_json");
  const parsed = JSON.parse(text.slice(a, z + 1));
  const yesterday = typeof parsed.yesterday === "string" ? parsed.yesterday.trim() : "";
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).slice(0, 4)
    : [];
  if (!yesterday) throw new Error("empty_yesterday");
  return { yesterday, suggestions };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { company_id?: string; force_fallback?: boolean };
  try { body = await req.json(); } catch { return json({ success: false, error: "invalid_json" }, 400); }
  const companyId = body.company_id;
  if (!companyId) return json({ success: false, error: "missing_company_id" }, 400);

  try {
    const stats = await rpc("crm_brief_gather", { p_company_id: companyId });

    let content: { yesterday: string; suggestions: string[] }, source: string, model: string | null;
    try {
      if (body.force_fallback) throw new Error("forced_fallback_test");  // test-only path exercise
      content = await generate(stats); source = "ai"; model = MODEL;
    } catch (e) {
      console.error("[crm-daily-brief] generation failed, using fallback:", (e as Error)?.message);
      content = fallbackContent(stats); source = "fallback"; model = null;
    }

    const preview = firstLine(content.yesterday);
    const saved = await rpc("save_daily_brief", {
      p_company_id: companyId, p_body: content.yesterday, p_stats: stats,
      p_content: content, p_model: model, p_source: source,
    });
    if (!saved?.inserted) return json({ success: true, skipped: "already_generated_today" });

    // post into the inbox (directors only, references the brief)
    const title = "NexuBrief · " + (dateLabel(stats?.today) || "Today");
    const posted = await rpc("post_brief_message", {
      p_company_id: companyId, p_brief_id: saved.brief_id, p_title: title, p_body: preview,
    });
    const annId = posted?.id;

    // push to directors — deep-links to THIS inbox message
    const claim = await rpc("crm_brief_claim_pushes", { p_company_id: companyId });
    const subs = (claim?.subs || []) as Array<{ endpoint: string; p256dh: string; auth: string }>;
    const pushTitle = "NexuBrief — " + (claim?.company || stats?.company || "your team");
    const url = "https://rms.nexunova.com/sales-portal.html?ann=" + (annId || "");
    let pushed = 0;
    for (const sub of subs) {
      try {
        await fetch(`${SB_URL}/functions/v1/send-web-push`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload: { title: pushTitle, body: preview, url },
          }),
        });
        pushed++;
      } catch (e) { console.error("[crm-daily-brief] push failed:", (e as Error)?.message); }
    }
    return json({ success: true, source, announcement_id: annId, pushed, brief_date: saved.brief_date });
  } catch (e) {
    console.error("[crm-daily-brief] fatal:", (e as Error)?.message);
    return json({ success: false, error: (e as Error)?.message ?? "failed" }, 500);
  }
});
