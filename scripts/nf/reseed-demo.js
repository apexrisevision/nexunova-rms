#!/usr/bin/env node
/**
 * Post-apply, owner decision 2026-09-18 (Decision 3): re-seed ZZTEST-NF-DEMO
 * rather than carry its 8 migrated lines into a half-valid state (the
 * Token Money line has no party_id — the single-entry model never
 * captured one, and requires_party now needs one on 21100). Only 8 rows
 * anywhere, all ZZTEST demo rows, zero cost to redo.
 *
 * Wipes the existing day/vouchers/legs for the existing ZZTEST-NF-DEMO
 * company (keeps the company, its login, its members, its COA/floors —
 * only the day-level cash-book data is cleared) and re-enters the exact
 * same golden day through the real, current RPCs — nf_save_line's new
 * p_party_name on the one line that needs it (head 21100), everything
 * else identical to demo-setup.js's original sequence.
 */
'use strict';
const { q, REF, TOKEN } = require('../_sbq');
const { buildSeed } = require('./gen-seed');

const URL_BASE = `https://${REF}.supabase.co`;
async function http_(method, p, { key, jwt, body } = {}) {
  const h = { apikey: key, 'Content-Type': 'application/json' }; if (jwt) h.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
}

(async () => {
  const [{ api_key: anon }] = (await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).filter(k => k.name === 'anon');

  const [co] = await q(`select id from public.companies where company_name = 'ZZTEST-NF-DEMO'`);
  if (!co) throw new Error('ZZTEST-NF-DEMO company not found — nothing to re-seed');
  const C = co.id;

  // wipe day-level data only — company, members, accounts, floors untouched.
  // The day is currently OPEN; nf_days_guard refuses ANY delete unless
  // nf_purging() is true (its whole DELETE path is "refuse, unless
  // purging"), and nf_voucher_legs_guard requires an authenticated
  // accountant/director role, which this admin script has none of. Both
  // need the same nf.purge_company escape hatch — set with SET LOCAL so it
  // applies only within this one call's own transaction/connection, never
  // leaking to any other session (the Management API may not even reuse
  // the same connection across separate q() calls, so this must all be
  // ONE call, not a set_config then a later delete).
  const before = await q(`select
      (select count(*) from public.nf_voucher_legs where company_id = '${C}') as legs,
      (select count(*) from public.nf_vouchers where company_id = '${C}') as vouchers,
      (select count(*) from public.nf_days where company_id = '${C}') as days`);
  console.log('before wipe:', JSON.stringify(before[0]));

  await q(`
BEGIN;
SET LOCAL "nf.purge_company" = '${C}';
DELETE FROM public.nf_voucher_legs WHERE company_id = '${C}';
DELETE FROM public.nf_vouchers WHERE company_id = '${C}';
DELETE FROM public.nf_party_aliases WHERE company_id = '${C}';
DELETE FROM public.nf_parties WHERE company_id = '${C}';
DELETE FROM public.nf_days WHERE company_id = '${C}';
COMMIT;`);

  const after = await q(`select
      (select count(*) from public.nf_voucher_legs where company_id = '${C}') as legs,
      (select count(*) from public.nf_vouchers where company_id = '${C}') as vouchers,
      (select count(*) from public.nf_days where company_id = '${C}') as days`);
  console.log('after wipe:', JSON.stringify(after[0]));
  if (Number(after[0].legs) !== 0 || Number(after[0].vouchers) !== 0 || Number(after[0].days) !== 0) {
    throw new Error('wipe incomplete — refusing to re-seed on top of leftovers');
  }

  // sign in as the existing demo login (no new user created)
  const login = await http_('POST', '/auth/v1/token?grant_type=password', { key: anon, body: { email: 'nfdemo@zztest-nf.invalid', password: 'NfDemo!2026' } });
  if (!login.json.access_token) throw new Error('demo login failed: ' + JSON.stringify(login.json));
  const jwt = login.json.access_token;
  const rpc = (name, args) => http_('POST', `/rest/v1/rpc/${name}`, { key: anon, jwt, body: args });

  const s = buildSeed().ref.sample;
  let res = await rpc('nf_start_first_day', { p_company_id: C, p_date: s.date, p_closing_no: s.cno, p_open_cash: s.open.Cash, p_open_petty: s.open.Petty, p_open_bank: s.open.Bank });
  if (res.status !== 201 && res.status !== 200) throw new Error('nf_start_first_day failed: ' + JSON.stringify(res.json));
  const dayId = res.json.day.id;

  for (const [side, rows] of [['IN', s.in], ['OUT', s.out]]) {
    for (const x of rows.filter(x => Number(x.a))) {
      const args = { p_day_id: dayId, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d,
        p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null };
      // the one head this golden day uses that is now party-required
      if (x.h === '21100') args.p_party_name = 'Demo Token Customer';
      const r = await rpc('nf_save_line', args);
      if (r.status !== 201 && r.status !== 200) throw new Error(`nf_save_line ${x.v} failed: ${JSON.stringify(r.json)}`);
    }
  }
  await rpc('nf_set_transfers', { p_day_id: dayId, p_to_bank: Number(s.tBank), p_to_petty: null, p_version: 0 });
  const den = Object.fromEntries(Object.entries(s.den).filter(([, v]) => v !== '').map(([k, v]) => [Number(k), Number(v)]));
  res = await rpc('nf_save_count', { p_day_id: dayId, p_denoms: den, p_version: 1 });

  console.log(JSON.stringify({ company_id: C, day_id: dayId, closing: res.json?.day?.status, balanced: res.json?.balanced }));
})().catch(e => { console.error(e); process.exit(1); });
