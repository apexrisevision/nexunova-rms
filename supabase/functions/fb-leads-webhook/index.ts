import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NEXUNOVA RMS — Facebook lead-ads webhook (MULTI-PAGE).
// GET  = Meta verification handshake (verify_token must match a connected page).
// POST = leadgen events. For each lead: look up the connected PAGE (page_id is the
//        unique key), pull the full lead from the Graph API with THAT page's token,
//        then create the lead via the create_lead_from_fb RPC — which routes through
//        create_lead (so _norm_phone dedupe, the project-belongs-to-company guard,
//        owner=director and source=facebook are all reused). No raw insert here.
// DEPLOY: supabase functions deploy fb-leads-webhook --no-verify-jwt

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const GRAPH = "https://graph.facebook.com/v21.0";

function pick(fd: any[], keys: string[]): string {
  for (const f of fd ?? []) {
    const n = String(f?.name ?? "").toLowerCase();
    if (keys.some((k) => n.includes(k))) return String(f?.values?.[0] ?? "");
  }
  return "";
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1) Meta webhook verification (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token) {
      const { data } = await sb.from("fb_connections").select("id").eq("verify_token", token).limit(1);
      if (data && data.length) return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2) Lead events (POST)
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch (_) { /* ignore */ }
    try {
      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          if (change?.field !== "leadgen") continue;
          const v = change?.value ?? {};
          const pageId = String(v.page_id ?? entry.id ?? "");
          const leadgenId = String(v.leadgen_id ?? "");
          if (!pageId || !leadgenId) continue;

          // the connected page is the unique key — per-page token + project + director
          const { data: conns } = await sb.from("fb_connections")
            .select("id, page_access_token").eq("page_id", pageId).limit(1);
          const conn = conns?.[0];
          if (!conn || !conn.page_access_token) { console.log("skip: unconnected page", pageId); continue; }

          const r = await fetch(`${GRAPH}/${leadgenId}?access_token=${encodeURIComponent(conn.page_access_token)}`);
          const lead = await r.json();
          if (!lead || lead.error) { console.error("graph error", lead?.error); continue; }

          const fd: any[] = lead.field_data ?? [];
          const name = pick(fd, ["full_name", "name"]) || pick(fd, ["first"]) || "Facebook lead";
          const phone = pick(fd, ["phone"]).replace(/\s/g, "");
          const email = pick(fd, ["email"]);

          // single validated path — dedupe / project guard / owner=director all reused
          const { data: res, error } = await sb.rpc("create_lead_from_fb", {
            p_page_id: pageId,
            p_name: name,
            p_phone: phone || null,
            p_email: email || null,
            p_raw: lead,
          });
          if (error) console.error("create_lead_from_fb error", error);
          else if (!res?.success) console.log("lead not created", res?.error, phone);
        }
      }
    } catch (e) { console.error("fb-leads-webhook error", e); }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
