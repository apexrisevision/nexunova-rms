// ============================================================================
// attendance-bridge — the one place where the portal and the attendance
// system are allowed to touch.
//
// They are two applications on two Supabase projects with two different logins.
// The portal signs people in with a phone and a PIN and issues its own session
// token; NexuAttend has never heard of that token and never will. So the
// crossing happens here, on a server, and it obeys three rules:
//
//   1. THE KEY IS CUT TO THE SIZE OF THE JOB. This function does NOT hold
//      NexuAttend's service key — that key bypasses row-level security on every
//      table there, which is far more than five questions about one person
//      needs. It presents the publishable key, which opens nothing by itself,
//      plus a bridge secret that unlocks exactly the five portal functions.
//      If this function were ever compromised, that is the whole of what goes
//      with it.
//
//   2. THE CALLER DOES NOT SAY WHO THEY ARE. They present the session token
//      they already have. RMS resolves it to one sales user and hands back that
//      user's own CNIC and the attendance tenant their company is linked to.
//      There is no employee_id in this request and no way to ask about anybody
//      else.
//
//   3. ONE PROJECT, ONE TENANT, OFF BY DEFAULT. The portal is an umbrella —
//      every sales user shares one company row — so it is the PROJECT that
//      says which business somebody belongs to. The mapping lives in
//      attendance_link, per project, disabled until switched on, because KBH,
//      FMH and Awami Market are joined separately and a wrong mapping would
//      show one office's staff another office's file.
//
// It reads the file, and it lets a person ask for their own leave — which HR
// then forwards and the Head of Department decides. It cannot decide anything
// and it cannot write to RMS at all.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RMS_URL = Deno.env.get('SUPABASE_URL')!;
const RMS_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATT_URL = Deno.env.get('ATTEND_URL')!;
// The publishable key is public by design; the secret is what actually opens
// anything, and it opens only the five portal_* functions.
const ATT_ANON = Deno.env.get('ATTEND_ANON_KEY')!;
const ATT_SECRET = Deno.env.get('ATTEND_BRIDGE_SECRET')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Said plainly, because "nothing here" and "we could not look" are different
// answers and the person reading the screen deserves to know which one it is.
const WHY: Record<string, string> = {
  session_invalid: 'Your session has expired. Please sign in again.',
  bad_secret: 'The attendance connection is not configured correctly. Please tell the office.',
  user_inactive: 'This account is not active.',
  no_project: 'Your portal account is not attached to a project yet, so we cannot tell which office your attendance is kept in. Please ask the office to set it.',
  not_linked: 'Attendance is not connected for your project yet.',
  link_disabled: 'Attendance is not switched on for your project yet.',
  no_cnic: 'Your CNIC is not on your portal profile, so your attendance record cannot be found. Please ask the office to add it.',
  not_matched: 'No attendance record is registered against your CNIC. Please ask HR to add it to your employee file.',
  cnic_duplicated: 'Two employee records carry your CNIC, so it is not clear which one is yours. Please ask HR to correct it.',
  cnic_missing: 'The CNIC on your profile does not look complete.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  let body: {
    session_token?: string; action?: string; from?: string; to?: string;
    leave_type?: string; reason?: string; day_part?: string;
    contact?: string; request_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  const token = (body.session_token || '').trim();
  if (!token) return json({ ok: false, error: 'session_invalid', message: WHY.session_invalid }, 401);

  // ── who is asking, according to RMS ──────────────────────────────────────
  const rms = createClient(RMS_URL, RMS_SERVICE, { auth: { persistSession: false } });
  const { data: ctx, error: ctxErr } = await rms.rpc('portal_attendance_context', {
    p_session_token: token,
  });
  if (ctxErr) return json({ ok: false, error: 'context_failed', message: ctxErr.message }, 500);
  if (!ctx?.ok) {
    const reason = ctx?.reason || 'session_invalid';
    return json(
      { ok: false, error: reason, message: WHY[reason] || 'Attendance is not available.' },
      reason === 'session_invalid' ? 401 : 200,
    );
  }

  // ── what NexuAttend will say about that one person ───────────────────────
  const att = createClient(ATT_URL, ATT_ANON, { auth: { persistSession: false } });
  const action = body.action || 'file';

  try {
    if (action === 'whoami') {
      const { data, error } = await att.rpc('portal_whoami', {
        p_secret: ATT_SECRET,
        p_company: ctx.attend_company_id,
        p_cnic: ctx.cnic,
      });
      if (error) throw error;
      if (data?.error === 'bad_secret') return json({ ok: false, error: 'bad_secret', message: WHY.bad_secret }, 500);
      return json({ ok: true, tenant: ctx.attend_company_name, ...data });
    }

    if (action === 'file') {
      // A window, not the whole history: the default is the current month, and
      // the RPC refuses anything longer than about a year.
      const today = new Date();
      const from = body.from || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
        .toISOString().slice(0, 10);
      const to = body.to || today.toISOString().slice(0, 10);

      const { data, error } = await att.rpc('portal_my_file', {
        p_secret: ATT_SECRET,
        p_company: ctx.attend_company_id,
        p_cnic: ctx.cnic,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      if (data?.error === 'bad_secret') return json({ ok: false, error: 'bad_secret', message: WHY.bad_secret }, 500);
      return json({
        ok: true,
        tenant: ctx.attend_company_name,
        portal_name: ctx.sales_user_name,
        from,
        to,
        ...data,
      });
    }

    if (action === 'leave_types') {
      const { data, error } = await att.rpc('portal_leave_types', {
        p_secret: ATT_SECRET,
        p_company: ctx.attend_company_id,
      });
      if (error) throw error;
      return json({ ok: true, leave_types: data });
    }

    if (action === 'apply_leave') {
      const { data, error } = await att.rpc('portal_apply_leave', {
        p_secret: ATT_SECRET,
        p_company: ctx.attend_company_id,
        p_cnic: ctx.cnic,
        p_type: body.leave_type,
        p_from: body.from,
        p_to: body.to,
        p_reason: body.reason,
        p_day_part: body.day_part || 'full',
        p_contact: body.contact || null,
      });
      if (error) throw error;
      return json(data);
    }

    if (action === 'cancel_leave') {
      const { data, error } = await att.rpc('portal_cancel_leave', {
        p_secret: ATT_SECRET,
        p_company: ctx.attend_company_id,
        p_cnic: ctx.cnic,
        p_id: body.request_id,
      });
      if (error) throw error;
      return json(data);
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    // The attendance side raises named errors for the cases a person can act
    // on — an unmatched CNIC, a duplicated one — so they are passed through as
    // themselves rather than flattened into "something went wrong".
    const raw = String((e as { message?: string })?.message || e);
    const known = Object.keys(WHY).find((k) => raw.includes(k));
    if (known) return json({ ok: false, error: known, message: WHY[known] });
    return json({ ok: false, error: 'attendance_failed', message: raw }, 502);
  }
});
