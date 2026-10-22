#!/usr/bin/env node
/* Dry run: give a discount on an existing Awami sale the way the Edit Sale
   screen does, on the live RMS database, as the real Awami login (naseer).
   Every request ends in RAISE, so nothing is kept.

   1. Make two sales through the SAF; read them with get_sale_for_edit (what
      the screen loads).
   2. Run the screen's OWN _absorbIntoLastInstallment (from js/pages/sales.js)
      on that schedule: A = 1,00,000 discount, B = 5,00,000 discount.
   3. Make the same sales again and save exactly what the screen sends:
      edit_sale (payload + reason) then edit_installment_schedule.

   Usage: node scripts/dryrun-sale-discount-edit.js                            */
const fs = require('fs');
const path = require('path');
const { REF, TOKEN } = require('./_sbq');

const DISC_A = 100000, DISC_B = 500000;

// the screen's own helpers, lifted verbatim from sales.js
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'sales.js'), 'utf8');
const lift = name => { const i = SRC.indexOf('function ' + name + '('); const j = SRC.indexOf('\n}\n', i); return SRC.slice(i, j + 2); };
const { _absorbIntoLastInstallment } = new Function(lift('_spRound') + lift('_absorbIntoLastInstallment') + 'return { _absorbIntoLastInstallment };')();

const MAKE = String.raw`
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  PH text := 'https://itqxljtfbrppntgyfush.supabase.co/storage/v1/object/public/rms-documents/96d210e7-e63b-4ef0-b1d0-74e622eac7ce/clients/photos/dry_buyer.jpg';
  buyer jsonb := '{"buyer_relation":"S/O","buyer_father":"Dry Father","buyer_cnic":"17301-1234567-1","buyer_phone":"03001234567","buyer_address":"Dry Peshawar"}';
  naseer uuid; us uuid[]; f uuid; sa uuid; sb uuid; r jsonb;
`;
const MAKE_BODY = String.raw`
  SELECT auth_user_id INTO naseer FROM app_users WHERE company_id = co AND username = 'naseer';
  SELECT array_agg(id) INTO us FROM (
    SELECT u.id FROM units u
     WHERE u.company_id = co
       AND EXISTS (SELECT 1 FROM reservations x WHERE x.unit_id = u.id AND x.status = 'active'
                     AND btrim(coalesce(x.client_name,'')) <> '' AND x.requested_by_agent_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id = u.id AND s.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sale_approval_forms y WHERE y.unit_id = u.id)
       AND coalesce(u.base_price, 0) > 0
       AND (_saf_money(co, u.unit_no)->>'total')::numeric > 0
     ORDER BY u.unit_no LIMIT 2) z;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', naseer, 'role', 'authenticated')::text, true);
  r := saf_new(us[1]); f := (r->'saf'->>'id')::uuid;
  PERFORM saf_save(f, buyer || jsonb_build_object('buyer_photo_url', PH, 'buyer_cnic', '17301-1234567-1'));
  PERFORM saf_submit(f); SELECT id INTO sa FROM sales WHERE saf_id = f;
  r := saf_new(us[2]); f := (r->'saf'->>'id')::uuid;
  PERFORM saf_save(f, buyer || jsonb_build_object('buyer_photo_url', PH, 'buyer_cnic', '17301-1234567-2'));
  PERFORM saf_submit(f); SELECT id INTO sb FROM sales WHERE saf_id = f;
  IF sa IS NULL OR sb IS NULL THEN RAISE EXCEPTION 'DRYRUN_RESULT could not make the two sales'; END IF;
`;

async function run(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  if (res.ok) throw new Error('NO EXCEPTION — check the database for leftovers');
  const txt = await res.text();
  const m = txt.match(/DRYRUN_RESULT([\s\S]*?)(\\n)?CONTEXT:|DRYRUN_RESULT([\s\S]*?)"\}?$/);
  if (!m) throw new Error(txt.slice(0, 1500));
  return JSON.parse(JSON.parse('"' + (m[1] || m[3]).replace(/\\n$/, '') + '"').trim().replace(/^ /, ''));
}

const fM = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

(async () => {
  console.log('project', REF);

  // ── 1. what the Edit screen loads ─────────────────────────────────────
  const loaded = await run('BEGIN;\nDO $t$\nDECLARE' + MAKE + 'BEGIN' + MAKE_BODY + String.raw`
  RAISE EXCEPTION 'DRYRUN_RESULT %', jsonb_build_object(
    'a', get_sale_for_edit(sa, co), 'b', get_sale_for_edit(sb, co))::text;
END $t$;`);

  // ── 2. the screen's own auto-balance ─────────────────────────────────
  const plan = {};
  for (const [k, disc] of [['a', DISC_A], ['b', DISC_B]]) {
    const ed = loaded[k];
    const s = ed.sale;
    const rows = (ed.installments || []).map(i => ({ ...i, _new: false, _deleted: false }));
    const net = Math.max(0, Number(s.price_per_sqft) * Number(s.area_sqft) - disc);
    const before = rows.map(r => Number(r.amount_due));
    let absorbed = _absorbIntoLastInstallment(rows, net);
    let manual = false;
    if (absorbed === null) {
      // the screen shows "Schedule over by X" and the user lowers rows in the
      // grid; here: spread the over-amount evenly over the last 6 unpaid rows
      manual = true;
      const over = rows.reduce((t, r) => t + Number(r.amount_due), 0) - net;
      const tail = rows.filter(r => r.installment_type === 'installment' && !(Number(r.amount_paid) > 0)).slice(-6);
      const each = Math.floor(over / tail.length);
      tail.forEach((r, i) => { r.amount_due = Number(r.amount_due) - each - (i === tail.length - 1 ? over - each * tail.length : 0); });
    }
    plan[k] = { disc, net, absorbed, manual, rows, before, sale: s };
    console.log(`\n[${k.toUpperCase()}] discount ${fM(disc)} on ${s.unit_no || ''} ${s.sale_number || ''}: price ${fM(s.price_per_sqft)} x ${s.area_sqft} = ${fM(s.price_per_sqft * s.area_sqft)}, old discount ${fM(s.discount)}, new net ${fM(net)}`);
    console.log(absorbed === null
      ? `    screen: auto-balance CANNOT (last installment ${fM(before[before.length - 1])} < ${fM(disc)}) -> "Schedule over" popup; grid edited by hand (last 6 rows)`
      : `    screen: auto-balance moved ${fM(absorbed)} into the last installment: ${fM(before[before.length - 1])} -> ${fM(rows[rows.length - 1].amount_due)}`);
  }

  // ── 3. save exactly what the screen sends ────────────────────────────
  const amounts = k => JSON.stringify(plan[k].rows.map(r => [r.installment_number, Number(r.amount_due)]));
  const payload = k => {
    const s = plan[k].sale;
    return JSON.stringify({
      client_id: s.client_id, agent_id: s.agent_id || null, sale_date: s.sale_date,
      price_per_sqft: Number(s.price_per_sqft), discount: plan[k].disc, down_payment: Number(s.down_payment),
      commission_rate: s.commission_rate == null ? null : Number(s.commission_rate), commission_notes: s.commission_notes || null,
      sale_type_id: s.sale_type_id || null, notes: s.notes || null,
      co_buyer_name: s.co_buyer_name || null, co_buyer_cnic: s.co_buyer_cnic || null, co_buyer_share_pct: s.co_buyer_share_pct || null,
      nominee_name: s.nominee_name || null, nominee_cnic: s.nominee_cnic || null, nominee_relation: s.nominee_relation || null,
      wht_amount: Number(s.wht_amount || 0), cvt_amount: Number(s.cvt_amount || 0),
      discount_approved_by: 'Director (dry run)', discount_notes: 'Dry run discount' });
  };
  const SAVE = (k, sid) => String.raw`
  -- ${k}: no reason -> must be refused
  r := edit_sale(${sid}, co, '${payload(k)}'::jsonb || (SELECT jsonb_build_object('client_id', client_id, 'agent_id', agent_id) FROM sales WHERE id = ${sid}), NULL);
  out := out || jsonb_build_object('${k}_no_reason', r);
  -- with reason
  r := edit_sale(${sid}, co, '${payload(k)}'::jsonb || (SELECT jsonb_build_object('client_id', client_id, 'agent_id', agent_id) FROM sales WHERE id = ${sid}), 'Director allowed discount on dry run');
  out := out || jsonb_build_object('${k}_edit_sale', r);
  SELECT jsonb_agg(i || jsonb_build_object('amount_due', (m->>1)::numeric) ORDER BY (i->>'installment_number')::int)
    INTO sch FROM jsonb_array_elements(get_sale_for_edit(${sid}, co)->'installments') x(i)
    JOIN jsonb_array_elements('${amounts(k)}'::jsonb) m ON (m->>0)::int = (i->>'installment_number')::int;
  sch := (SELECT jsonb_agg(e || '{"_new":false,"_deleted":false}') FROM jsonb_array_elements(sch) e);
  r := edit_installment_schedule(${sid}, co, sch, 'Director allowed discount on dry run');
  out := out || jsonb_build_object('${k}_schedule', r);
  out := out || jsonb_build_object('${k}_after', (SELECT jsonb_build_object(
      'discount', s.discount, 'net', s.net_amount, 'remaining', s.remaining_amount, 'dp', s.down_payment,
      'disc_by', s.discount_approved_by,
      'inst_sum', (SELECT sum(amount_due) FROM installments WHERE sale_id = s.id),
      'inst_n', (SELECT count(*) FROM installments WHERE sale_id = s.id),
      'paid', (SELECT sum(amount_paid) FROM installments WHERE sale_id = s.id),
      'last_rows', (SELECT jsonb_agg(amount_due ORDER BY installment_number) FROM
                     (SELECT * FROM installments WHERE sale_id = s.id ORDER BY installment_number DESC LIMIT 7) q),
      'detail_net', coalesce(get_sale_detail(s.id, co)->'net_amount', get_sale_detail(s.id, co)->'sale'->'net_amount', get_sale_detail(s.id, co)->'data'->'net_amount'), 'detail_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(get_sale_detail(s.id, co)) k),
      'audit', (SELECT jsonb_build_object('who', changed_by_name, 'reason', reason, 'fields', changed_fields,
                       'old_disc', old_data->'discount', 'new_disc', new_data->'discount')
                  FROM audit_logs WHERE table_name = 'sales' AND record_id = s.id::text AND action = 'UPDATE'
                   AND changed_fields @> ARRAY['discount'] ORDER BY changed_at DESC LIMIT 1))
    FROM sales s WHERE s.id = ${sid}));`;

  const res = await run('BEGIN;\nDO $t$\nDECLARE' + MAKE + ' out jsonb := \'{}\'; sch jsonb;\nBEGIN' + MAKE_BODY
    + SAVE('a', 'sa') + SAVE('b', 'sb') + "\n  RAISE EXCEPTION 'DRYRUN_RESULT %', out::text;\nEND $t$;");

  let pass = 0, fail = 0;
  const check = (ok, msg) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + msg); };
  for (const k of ['a', 'b']) {
    const p = plan[k], a = res[k + '_after'];
    console.log(`\n[${k.toUpperCase()}] saved result:`);
    check(res[k + '_no_reason'].success === false, 'save without a reason is refused: ' + (res[k + '_no_reason'].message || res[k + '_no_reason'].error));
    check(res[k + '_edit_sale'].success !== false && res[k + '_edit_sale'].status !== 'pending_approval', 'edit_sale applied directly (no approval): ' + JSON.stringify(res[k + '_edit_sale']));
    check(res[k + '_schedule'].success !== false, 'schedule saved: ' + JSON.stringify(res[k + '_schedule']).slice(0, 160));
    check(Number(a.discount) === p.disc, `sales.discount = ${fM(a.discount)}`);
    check(Number(a.net) === p.net, `net = ${fM(a.net)} (expected ${fM(p.net)})`);
    check(Number(a.detail_net) === p.net, `sale detail screen shows net ${fM(a.detail_net)}` + (a.detail_net == null ? ' keys=' + JSON.stringify(a.detail_keys) : ''));
    check(Number(a.inst_sum) === p.net, `installments total ${fM(a.inst_sum)} = net (${a.inst_n} rows)`);
    check(Number(a.dp) === Number(p.sale.down_payment), `down payment unchanged ${fM(a.dp)}; remaining ${fM(a.remaining)}`);
    check(Number(a.paid) > 0, `payments still on the schedule: ${fM(a.paid)}`);
    check(a.audit && /Director allowed/.test(a.audit.reason || ''), `audit log: ${a.audit ? `${a.audit.who} · "${a.audit.reason}" · discount ${fM(a.audit.old_disc)} -> ${fM(a.audit.new_disc)}` : 'none'}`);
    console.log('    last 7 installments now (newest first):', a.last_rows.map(fM).join(', '));
  }
  console.log(`\nRESULT pass=${pass} fail=${fail} (everything rolled back)`);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
