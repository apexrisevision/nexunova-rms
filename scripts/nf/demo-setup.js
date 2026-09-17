#!/usr/bin/env node
/** One-off: a persistent ZZTEST-NF-DEMO tenant, a real login, the golden day entered. Not auto-purged. */
'use strict';
const { q, REF, TOKEN } = require('../_sbq');
const { buildSeed, seedSql } = require('./gen-seed');
const crypto = require('crypto');

const URL_BASE = `https://${REF}.supabase.co`;
async function http_(method, p, { key, jwt, body } = {}) {
  const h = { apikey: key, 'Content-Type': 'application/json' }; if (jwt) h.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
}

(async () => {
  const [{ api_key: anon }] = (await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).filter(k => k.name === 'anon');
  const [{ api_key: svc }] = (await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).filter(k => k.name === 'service_role');

  const built = buildSeed();
  const C = crypto.randomUUID();
  const email = 'nfdemo@zztest-nf.invalid', password = 'NfDemo!2026';
  await q(`insert into companies (id, company_code, company_name) values ('${C}','ZZNFDEMO','ZZTEST-NF-DEMO')
           on conflict (company_code) do update set id = excluded.id`);
  await q(seedSql(C, built.seed));
  const r = await http_('POST', '/auth/v1/admin/users', { key: svc, jwt: svc, body: { email, password, email_confirm: true } });
  const uid = r.json.id;
  await q(`insert into app_users (company_id, full_name, username, email, role, auth_provider, status, auth_user_id)
           values ('${C}','NF Demo','nfdemo','${email}','accounts','password','active','${uid}')`);
  await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}','${uid}','director','NF Demo',true)`);

  const login = await http_('POST', '/auth/v1/token?grant_type=password', { key: anon, body: { email, password } });
  const jwt = login.json.access_token;
  const rpc = (name, args) => http_('POST', `/rest/v1/rpc/${name}`, { key: anon, jwt, body: args });

  const s = built.ref.sample;
  let res = await rpc('nf_start_first_day', { p_company_id: C, p_date: s.date, p_closing_no: s.cno, p_open_cash: s.open.Cash, p_open_petty: s.open.Petty, p_open_bank: s.open.Bank });
  const dayId = res.json.day.id;
  for (const [side, rows] of [['IN', s.in], ['OUT', s.out]])
    for (const x of rows.filter(x => Number(x.a)))
      await rpc('nf_save_line', { p_day_id: dayId, p_line_id: null, p_side: side, p_voucher_no: x.v, p_description: x.d, p_head: x.h, p_floor: x.f, p_via: x.m, p_amount: Number(x.a), p_version: null });
  await rpc('nf_set_transfers', { p_day_id: dayId, p_to_bank: Number(s.tBank), p_to_petty: null, p_version: 0 });
  const den = Object.fromEntries(Object.entries(s.den).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
  res = await rpc('nf_save_count', { p_day_id: dayId, p_denoms: den, p_version: 1 });
  console.log(JSON.stringify({ company_id: C, username: 'nfdemo@ZZNFDEMO', password, email, closing: res.json.day.status, balanced: res.json.balanced }));
})().catch(e => { console.error(e); process.exit(1); });
