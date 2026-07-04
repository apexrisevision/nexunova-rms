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

// Deterministic content from stats — the graceful fallback. Headline-first,
// parked-aware, suggestions as commands.
function fallbackContent(s: any): { yesterday: string; suggestions: string[] } {
  const parked = s.parked || { total: 0, by_owner: [] };
  const owner0 = (parked.by_owner || [])[0];
  const top = s.untouched_top || [];
  const y: string[] = [];
  // headline = the day's single most important fact
  if (parked.total > 0 && owner0) {
    y.push(`${parked.total} lead${parked.total === 1 ? " is" : "s are"} sitting with ${owner0.owner}, not yet distributed to the team.`);
  } else if (top.length) {
    y.push(`Oldest untouched lead is now at ${top[0].hours} hours with no contact.`);
  } else if ((s.new_yesterday || 0) > 0) {
    y.push(`${s.new_yesterday} new lead${s.new_yesterday === 1 ? "" : "s"} came in yesterday (${bySrc(s.yesterday_by_source)}).`);
  } else {
    y.push(`No new leads yesterday${(s.zero_new_streak || 0) >= 2 ? ` — ${s.zero_new_streak} days running with none` : ""}.`);
  }
  if ((s.new_yesterday || 0) > 0 && parked.total > 0) y.push(`${s.new_yesterday} new yesterday (${bySrc(s.yesterday_by_source)}).`);
  if ((s.won_yesterday || 0) > 0) y.push(`${s.won_yesterday} deal${s.won_yesterday === 1 ? "" : "s"} won.`);
  if (top.length) y.push(`Longest with no contact: ${top.slice(0, 3).map((t: any) => `${t.lead} (${t.hours}h)`).join(", ")}.`);
  if ((s.overdue_total || 0) > 0) y.push(`${s.overdue_total} follow-up${s.overdue_total === 1 ? "" : "s"} overdue.`);
  if ((s.pool_unassigned || 0) > 0) y.push(`${s.pool_unassigned} lead${s.pool_unassigned === 1 ? "" : "s"} unassigned in the pool.`);

  const sug: string[] = [];
  if (parked.total > 0 && owner0) sug.push(`Distribute the ${parked.total} lead${parked.total === 1 ? "" : "s"} parked with ${owner0.owner} across your reps today.`);
  if (top.length) sug.push(`Call ${top[0].lead} first — ${top[0].hours} hours, no contact.`);
  if ((s.pool_unassigned || 0) > 0) sug.push(`Assign the ${s.pool_unassigned} unassigned pool lead${s.pool_unassigned === 1 ? "" : "s"} now.`);
  if ((s.inactive_agents || []).length) sug.push(`${s.inactive_agents.slice(0, 3).join(", ")} logged no follow-ups this week — check in today.`);
  if ((s.source_drought || []).length) sug.push(`${s.source_drought.join(", ")} has gone quiet — verify the campaign is running.`);
  else if ((s.zero_new_streak || 0) >= 2) sug.push(`No new leads for ${s.zero_new_streak} days — check campaign budget and delivery.`);
  return { yesterday: y.join("\n"), suggestions: sug.slice(0, 4) };
}

async function generate(stats: any): Promise<{ yesterday: string; suggestions: string[] }> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const sys = [
    "You write the morning briefing a real-estate sales director actually acts on. Return ONLY valid JSON — no markdown, no code fences — with exactly two keys: {\"yesterday\": string, \"suggestions\": string[]}.",
    "\"yesterday\": The FIRST line is the headline — the single most important fact or risk of the day, not a routine recap. Then 3 to 5 more short factual lines. Use specific, comparative numbers wherever the data allows (e.g. \"oldest untouched lead now at 84 hours\", \"0 new leads for the 3rd straight day\"). Plain English.",
    "OPERATIONAL REALITY — 'parked' leads (in the data under 'parked') are owned by a director/default-receiver but never distributed to a rep and have had no contact: treat them as UNWORKED and say so plainly by owner name and count, e.g. \"17 leads are sitting with Naeem, not yet distributed to the team.\" This usually IS the headline. Only mention pool_unassigned (owner=none) when it is greater than 0 — do not say 'no unassigned leads' when leads are parked.",
    "\"suggestions\": 2 to 4 direct COMMANDS, not observations. Imperative, short, confident. e.g. \"Distribute the 17 leads parked with Naeem across your reps today\"; \"Call Muhammad first — 82 hours, no contact.\" Derive STRICTLY from the data; use the given names and numbers.",
    "If the day genuinely has nothing notable, say that in ONE line and return few or no suggestions. Never pad. Never invent data. No flattery, no emojis. Names given are first names — use as-is; never output phone numbers.",
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
