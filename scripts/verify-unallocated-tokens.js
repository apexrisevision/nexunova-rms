/**
 * Token money NOT allocated to a unit (21150) — standing check.
 *
 * Two functions read the same 21150 legs through one internal body:
 *   nf_unallocated_tokens(company)       NexuFinance app (Supabase login)
 *   get_unallocated_tokens_desk(session) Sales Portal Reserve Desk (Rashid only)
 * If either ever gains a filter the other lacks, the two screens would quietly
 * disagree. This calls BOTH, as the roles that really call them, and fails if
 * their totals or rows differ.
 *
 * It also proves the desk door is Rashid-only: a REP session and another
 * director's session must get 'forbidden' with no amounts and no names.
 * And it re-checks the invariant the account exists to protect:
 *   sum(reservations.token_amount) active + token_received = 21100 balance.
 *
 * Everything runs inside BEGIN … ROLLBACK: the temporary sessions and the
 * simulated login never persist.
 *
 *   node scripts/verify-unallocated-tokens.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const AWAMI_CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const RASHID_SU = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1]
              || 'itqxljtfbrppntgyfush';
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => r.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    req.on('error', rej); req.write(body); req.end();
  });
}

(async () => {
  console.log('\n── Grants');
  const g = (await sql(`SELECT
      has_function_privilege('anon',          'public.nf_unallocated_tokens(uuid)', 'EXECUTE') AS nf_anon,
      has_function_privilege('authenticated', 'public.nf_unallocated_tokens(uuid)', 'EXECUTE') AS nf_auth,
      has_function_privilege('anon',          'public._nf_unallocated_tokens_body(uuid)', 'EXECUTE') AS body_anon,
      has_function_privilege('authenticated', 'public._nf_unallocated_tokens_body(uuid)', 'EXECUTE') AS body_auth,
      has_function_privilege('anon',          'public.get_unallocated_tokens_desk(text)', 'EXECUTE') AS desk_anon,
      (SELECT count(*)::int FROM information_schema.routine_privileges
        WHERE routine_schema='public' AND routine_name='nf_unallocated_tokens' AND grantee='PUBLIC') AS nf_public;`))[0];
  assert(g.nf_anon === false, 'anon cannot execute nf_unallocated_tokens');
  assert(g.nf_public === 0, 'PUBLIC holds no grant on nf_unallocated_tokens');
  assert(g.nf_auth === true, 'authenticated can execute nf_unallocated_tokens');
  assert(g.body_anon === false && g.body_auth === false, 'the shared body is callable by neither anon nor authenticated');
  assert(g.desk_anon === true, 'the portal (anon) can reach the desk reader — its session check is the gate');

  console.log('\n── Both readers, as the roles that really call them (rolled back)');
  const rows = await sql(`
    BEGIN;
    CREATE TEMP TABLE _vut (k text, v jsonb) ON COMMIT DROP;
    GRANT ALL ON _vut TO anon, authenticated;

    INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at)
    VALUES ('${AWAMI_CO}', '${RASHID_SU}', 'vut_rashid', now() + interval '5 minutes');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at)
    SELECT s.company_id, s.id, 'vut_rep', now() + interval '5 minutes'
      FROM public.sales_users s JOIN public.lead_role_config l ON l.role = s.role
     WHERE s.company_id = '${AWAMI_CO}' AND s.is_active AND l.can_have_leads
       AND s.role NOT IN ('lead_entry','director') AND s.id <> '${RASHID_SU}'
     ORDER BY s.full_name LIMIT 1;
    INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at)
    SELECT s.company_id, s.id, 'vut_otherdir', now() + interval '5 minutes'
      FROM public.sales_users s
     WHERE s.role = 'director' AND s.is_active AND s.id <> '${RASHID_SU}'
       AND s.company_id <> 'a2915ce7-c01c-463b-ba50-b144b2240337'
     ORDER BY (s.company_id = '${AWAMI_CO}') DESC, s.full_name LIMIT 1;
    INSERT INTO _vut SELECT 'who', jsonb_build_object(
      'rep',      (SELECT su.role || ' ' || su.full_name FROM public.sales_sessions ss JOIN public.sales_users su ON su.id = ss.sales_user_id WHERE ss.session_token = 'vut_rep'),
      'otherdir', (SELECT su.role || ' ' || su.full_name FROM public.sales_sessions ss JOIN public.sales_users su ON su.id = ss.sales_user_id WHERE ss.session_token = 'vut_otherdir'));

    INSERT INTO _vut SELECT 'invariant', jsonb_build_object(
      'reservations', (SELECT COALESCE(sum(token_amount), 0) FROM public.reservations
                        WHERE company_id = '${AWAMI_CO}' AND status = 'active' AND token_received),
      'nf_21100',     (SELECT COALESCE(sum(COALESCE(l.credit,0) - COALESCE(l.debit,0)), 0)
                         FROM public.nf_voucher_legs l JOIN public.nf_vouchers v ON v.id = l.voucher_id
                        WHERE l.company_id = '${AWAMI_CO}' AND l.account_code = '21100' AND v.status = 'POSTED'));

    -- the NexuFinance door, as a signed-in director of this company
    -- (claims looked up BEFORE the role switch: nf_members is hidden by RLS
    --  from authenticated, and a NULL claim reads as "not signed in")
    SELECT set_config('request.jwt.claims',
      (SELECT json_build_object('sub', m.user_id::text, 'role', 'authenticated')::text
         FROM public.nf_members m
        WHERE m.company_id = '${AWAMI_CO}' AND m.active AND m.role = 'director' LIMIT 1), true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _vut SELECT 'nf', public.nf_unallocated_tokens('${AWAMI_CO}');
    RESET ROLE;

    -- the portal door, as the portal really arrives: anon + a session token
    SET LOCAL ROLE anon;
    INSERT INTO _vut SELECT 'desk_rashid',   public.get_unallocated_tokens_desk('vut_rashid');
    INSERT INTO _vut SELECT 'desk_rep',      public.get_unallocated_tokens_desk('vut_rep');
    INSERT INTO _vut SELECT 'desk_otherdir', public.get_unallocated_tokens_desk('vut_otherdir');
    INSERT INTO _vut SELECT 'desk_bogus',    public.get_unallocated_tokens_desk('not-a-session');
    RESET ROLE;

    SELECT jsonb_object_agg(k, v)::text AS r FROM _vut;
    ROLLBACK;`);
  const R = JSON.parse(rows[0].r);
  const left = (await sql(`SELECT count(*)::int n FROM public.sales_sessions WHERE session_token LIKE 'vut_%';`))[0].n;

  const nf = R.nf, dk = R.desk_rashid;
  console.log('  NexuFinance: ' + JSON.stringify(nf));
  console.log('  Desk (Rashid): ' + JSON.stringify(dk));
  assert(nf && Number(nf.total) > 0, 'nf_unallocated_tokens answered a signed-in director: total ' + (nf && nf.total));
  assert(dk && dk.success === true, 'the desk reader answered Rashid');
  assert(Number(nf.total) === Number(dk.total), 'the two totals agree (' + nf.total + ' = ' + dk.total + ')');
  assert(JSON.stringify(nf.parties) === JSON.stringify(dk.parties), 'the two readers return the same rows, in the same order');
  const partySum = (dk.parties || []).reduce((s, p) => s + Number(p.amount), 0);
  assert(partySum === Number(dk.total), 'the party rows add up to the total (' + partySum + ')');

  console.log('\n── Nobody else gets the money (as ' + JSON.stringify(R.who) + ')');
  const leaks = (x) => { const t = JSON.stringify(x || {}); return /total|parties|amount|name|reason/.test(t); };
  for (const k of ['desk_rep', 'desk_otherdir', 'desk_bogus']) {
    const x = R[k];
    if (k !== 'desk_bogus' && !R.who[k === 'desk_rep' ? 'rep' : 'otherdir']) { bad(k + ': no such session could be made — not proven'); continue; }
    assert(x && x.success === false && x.error === 'forbidden' && !leaks(x),
           k + ' is refused with no amounts and no names: ' + JSON.stringify(x));
  }

  console.log('\n── The invariant 21150 exists to protect');
  assert(Number(R.invariant.reservations) === Number(R.invariant.nf_21100),
         'active received tokens = 21100 (' + R.invariant.reservations + ' = ' + R.invariant.nf_21100 + ')');

  assert(left === 0, 'no temporary session persisted');
  console.log('\nRESULT: ' + (FAIL ? '❌ FAIL' : '✅ PASS') + '  (' + PASS + ' passed, ' + FAIL + ' failed)');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('ERROR ' + (e && e.message || e)); process.exit(1); });
