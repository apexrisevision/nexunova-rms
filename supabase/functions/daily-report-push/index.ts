// ============================================================================
// NEXUNOVA — DAILY ATTENDANCE REPORT PUSH
// ----------------------------------------------------------------------------
// The morning report is produced in NexuAttend at 10:45 (its own cron). This
// runs a couple of minutes later and tells the people who are meant to read it,
// on the phone they actually hold.
//
// It carries the FIGURES, not just a nudge. "Open the app to see something" is
// a notification people learn to swipe away; "2 of 14 in, 12 absent" is the
// report itself, and opening the portal is then a choice rather than a chore.
//
// Nobody is pushed twice: claim_daily_report_pushes stamps the day on the row
// in the same statement that returns it, so a retry finds nobody left.
//
// It stays silent when there is nothing to say — a weekly off, a declared
// closure, or a register whose report has not been made — because a daily alert
// that fires on days with no report is how a daily alert stops being read.
//
// DEPLOY: supabase functions deploy daily-report-push --no-verify-jwt
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RMS_URL     = Deno.env.get('SUPABASE_URL')!;
const RMS_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATT_URL     = Deno.env.get('ATTEND_URL')!;
const ATT_ANON    = Deno.env.get('ATTEND_ANON_KEY')!;
const ATT_SECRET  = Deno.env.get('ATTEND_BRIDGE_SECRET')!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  const rms = createClient(RMS_URL, RMS_SERVICE, { auth: { persistSession: false } });
  const att = createClient(ATT_URL, ATT_ANON, { auth: { persistSession: false } });

  // Who is owed a notification today — claimed, so this is also the guard.
  const { data: claim, error: claimErr } = await rms.rpc('claim_daily_report_pushes', { p_today: null });
  if (claimErr) return json({ ok: false, error: 'claim_failed', message: claimErr.message }, 500);

  const targets: any[] = claim?.targets ?? [];
  if (!targets.length) return json({ ok: true, claimed: 0, sent: 0, note: 'nobody waiting' });

  // One read per register, however many people watch it.
  const byCompany = new Map<string, any>();
  for (const t of targets) {
    if (!t.attend_company_id || byCompany.has(t.attend_company_id)) continue;
    const { data } = await att.rpc('portal_daily_report', {
      p_secret: ATT_SECRET,
      p_company: t.attend_company_id,
    });
    byCompany.set(t.attend_company_id, data ?? null);
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const t of targets) {
    const r = byCompany.get(t.attend_company_id);
    const rep = r?.report;
    // No report, or yesterday's still sitting there: say nothing at all.
    if (!rep || rep.is_today !== true) { skipped++; continue; }

    const body =
      `${rep.present} of ${rep.headcount} in · ${rep.late} late · ${rep.absent} absent` +
      (rep.on_leave ? ` · ${rep.on_leave} on leave` : '');

    for (const s of (t.subs ?? [])) {
      try {
        const res = await fetch(`${RMS_URL}/functions/v1/send-web-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RMS_SERVICE}` },
          body: JSON.stringify({
            subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload: {
              title: `${t.attend_company_name ?? 'Attendance'} — today`,
              body,
              url: 'https://rms.nexunova.com/sales-portal.html',
            },
          }),
        });
        res.ok ? sent++ : failed++;
      } catch (_) { failed++; }
    }
  }

  return json({ ok: true, claimed: targets.length, sent, skipped, failed });
});
