#!/usr/bin/env node
/* Sale Approval Form — tests 1–9 on live Awami, with screenshots and a PDF.

   Test data: three short-lived portal sessions (Naeem prepares, Amar taj
   verifies as Accounts, Rashid approves) and the SAFs they make for LG-01.
   Writes that would outlive the run — the sale (test 6) and the Sold-by-SQL
   attempt (test 7) — happen inside transactions that abort. Clean-up removes
   every SAF, session and counter this run created, then shows the NexuFinance
   21100 / 21150 figures and the token report's 'agree' are what they were.

   Usage: node scripts/verify-saf.js [outDir]                                 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { q, REF, TOKEN: MGMT } = require('./_sbq');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'audit_exports', 'saf');
fs.mkdirSync(OUT, { recursive: true });
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', PROJ = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const RASHID = '015effd0-7ac7-4939-a1b3-dd2826ab8fba', AMAR = 'c94705b2-842b-48a9-801d-c373044974cd',
      NAEEM = '67f8f136-802a-4235-8785-c9151f666644', YOUSAF = '908fe0b1-4270-4982-bae0-ec41f4281f3a';
const RUN = 'saftest_' + crypto.randomBytes(6).toString('hex');
const T = { r: RUN + '_r', a: RUN + '_a', n: RUN + '_n' };
const PORT = 8791, PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const results = [];
const ok = (n, pass, msg) => { results.push({ n, pass, msg }); console.log((pass ? 'PASS ' : 'FAIL ') + n + '  ' + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const one = async sql => (await q(sql))[0];
// a SQL block that ends in RAISE: everything in it rolls back, the message is the result
async function aborted(body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'DO $t$ ' + body + ' $t$;' }) });
  const txt = await res.text();
  const m = txt.match(/RESULT:([\s\S]*?)(\\n)?CONTEXT/);
  return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() : txt;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}

async function money() {
  return one(`select public._token_report_body('${PROJ}','${CO}')->'agree' agree`);
}

(async () => {
  let puppeteer; try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core')); }
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(f => fs.existsSync(f));
  console.log('project', REF, 'run', RUN, 'out', OUT);

  const before = await money();
  const before2 = await one(`select coalesce(sum((e->>'net')::numeric),0) t from jsonb_array_elements(public._nf_token_ledger_body('${CO}',null,null)->'units') e`);
  console.log('before', JSON.stringify(before.agree));
  const runStart = (await one(`select now() t`)).t;
  const counterBefore = await one(`select coalesce((select last_no from saf_counters where company_id='${CO}'),0) n`);

  await q(`insert into sales_sessions (company_id, sales_user_id, session_token, expires_at) values
    ('${CO}','${NAEEM}',${lit(T.n)}, now() + interval '2 hours'),
    ('${CO}','${AMAR}',${lit(T.a)}, now() + interval '2 hours'),
    ('${CO}','${RASHID}',${lit(T.r)}, now() + interval '2 hours')`);

  const unit = await one(`select u.id, u.base_price, u.area, round(u.base_price/u.area,2) rate from units u where company_id='${CO}' and unit_no='LG-01'`);
  const led = await one(`select e from jsonb_array_elements(public._nf_token_ledger_body('${CO}',null,null)->'units') e where e->>'unit_code'='LG-01'`);

  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function as(tok) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(String(e.message || e)));
    page.on('dialog', d => d.accept());
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t); localStorage.setItem('rms.sales.active', String(Date.now())); }, tok);
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof ME !== 'undefined' && ME && ME.sales_user_name && typeof renderSaf === 'function', { timeout: 30000 });
    // let the dashboard finish drawing first: it paints late into the same body
    try { await page.waitForFunction(() => /Welcome|Team report|To collect/.test(document.body.innerText), { timeout: 20000 }); } catch (e) {}
    await sleep(2500);
    await page.evaluate(() => { try { localStorage.setItem('nx.pwa.installed', '1'); } catch (e) {} });
    await page.addStyleTag({ content: '.sf-acts{position:static!important}' });
    await page.evaluate(() => { [...document.querySelectorAll('body *')].filter(e => /^Install Nexunova CRM/.test((e.textContent || '').trim()) && getComputedStyle(e).position === 'fixed').forEach(e => e.remove()); });
    return page;
  }
  const call = (page, fn, args) => page.evaluate((fn, args) => sb.rpc(fn, Object.assign({ p_session_token: TOKEN }, args)).then(r => r.data), fn, args);
  // do something, and make sure its screen is still there a moment later (a late
  // dashboard paint can land on top of it right after sign-in)
  async function ensure(page, fn, sel, arg) {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(fn, arg);
      try {
        await page.waitForFunction(s => document.querySelector(s), { timeout: 10000 }, sel);
        await sleep(2500);
        if (await page.evaluate(s => !!document.querySelector(s), sel)) return;
      } catch (e) {}
    }
    throw new Error('screen did not stay: ' + sel);
  }
  const shot = async (page, name) => {
    // the portal's own pop-ups (email nudge, live location, install) are not the form
    await page.evaluate(() => {
      document.querySelectorAll('#verify-gate').forEach(e => e.remove());
      [...document.querySelectorAll('body > *, body * ')].filter(e => {
        const t = (e.textContent || '').trim(), cs = getComputedStyle(e);
        return (cs.position === 'fixed' || cs.position === 'absolute') && !e.closest('#app-body,.sf-wrap,aside,nav,header')
          && /^(Add your email|Turn on live location|Install Nexunova CRM)/.test(t);
      }).forEach(e => e.remove());
    }); const f = path.join(OUT, name); await page.screenshot({ path: f, fullPage: true }); return f; };

  let id1, id2, LAST = null;
  try {
    // ── preparer: Naeem ────────────────────────────────────────────────────
    const pn = await as(T.n);
    await ensure(pn, () => setTab('saf'), '.sf-wrap .sf-chips');
    await pn.evaluate(() => safFilter('status', ''));
    await sleep(800);
    await ensure(pn, () => safPickUnit(), '#sf-pick');
    // exact unit code: LG-01 is inside LG-01-A
    await ensure(pn, () => { safPickFilter('LG-01'); const d = [...document.querySelectorAll('#sf-pick div')].find(x => x.querySelector('b') && x.querySelector('b').textContent.trim() === 'LG-01'); d && d.click(); }, '.sf-plans');
    const s1 = await pn.evaluate(() => _safCur());
    id1 = s1.id;

    // 1. unit and money from source
    const rec = s1.receipts || [];
    ok('1', Number(s1.base_price) === Number(unit.base_price) && Number(s1.rate_per_sqft) === Number(unit.rate)
           && Number(s1.total_received) === Number(led.e.net) && rec.length === (led.e.lines || []).length
           && rec.every((x, i) => Number(x.amount) === Number(led.e.lines[i].amount)),
       `${s1.saf_no} LG-01: price ${s1.base_price} = unit ${unit.base_price}; rate ${s1.rate_per_sqft} = ${unit.rate}; received ${s1.total_received} = NexuFinance ${led.e.net} over ${rec.length} line(s) ${rec.map(x => x.voucher_no + ' ' + x.amount).join(', ')}`);
    // 2. dp_balance
    ok('2', Number(s1.dp_balance) === Number(s1.dp_amount) - Number(s1.total_received) && Number(s1.dp_amount) === Math.round(Number(s1.net_price) * 0.3),
       `DP ${s1.dp_amount} (30% of ${s1.net_price}) - received ${s1.total_received} = ${s1.dp_balance}`);

    // fill the buyer through the screen's own inputs, then let the preview run
    await pn.evaluate(() => {
      const set = (k, v) => { const el = document.querySelector('[data-k="' + k + '"]'); if (el) { el.value = v; safEdit(el); } };
      set('buyer_relation', 'S/O'); set('buyer_father', 'Haji Gul (TEST)'); set('buyer_phone', '0300-1234567');
      set('buyer_address', 'Karkhano Market, Peshawar (TEST)');
    });
    await sleep(1800);
    await shot(pn, '1-new-saf-screen.png');
    await pn.evaluate(() => safSaveNow());   // what was typed on the screen is saved, as Save draft does
    await sleep(800);

    // 3a. missing CNIC
    let r = await call(pn, 'saf_submit', { p_id: id1 });
    ok('3a', r.error === 'incomplete' && /13 digits/.test(JSON.stringify(r.problems)), 'submit without CNIC: ' + (r.message || r.error));
    // 3b. a custom schedule that does not add up
    await call(pn, 'saf_save', { p_id: id1, p_input: { buyer_cnic: '17301-1234567-1', plan_type: 'custom',
      schedule_json: [{ installment_number: 0, installment_type: 'down_payment', due_date: '2026-10-12', amount_due: 1000000 }] } });
    r = await call(pn, 'saf_submit', { p_id: id1 });
    ok('3b', r.error === 'incomplete' && /schedule adds up/.test(r.message || ''), 'custom schedule 1,000,000 vs net: ' + (r.message || r.error));

    // 4. a discount beyond the plan
    const disc = Math.round(Number(unit.base_price) * 0.15);
    await call(pn, 'saf_save', { p_id: id1, p_input: { plan_type: 'full_100', discount_amount: disc, discount_reason: 'TEST: cash buyer, two units' } });
    r = await call(pn, 'saf_submit', { p_id: id1 });
    ok('4a', r.error === 'incomplete' && /director/.test(JSON.stringify(r.problems)), '15% on the 10% plan, no director: refused');
    r = await call(pn, 'saf_save', { p_id: id1, p_input: { discount_approved_by: YOUSAF } });
    ok('4b', r.success && r.saf.discount_beyond_standard && /Discount beyond/.test(r.saf.flags[0] || ''),
       'with ' + (r.saf && r.saf.discount_approved_by_name) + ': ' + (r.saf && r.saf.flags[0]));
    r = await call(pn, 'saf_submit', { p_id: id1 });
    if (!r.success) throw new Error('submit failed: ' + JSON.stringify(r));

    // ── Accounts ───────────────────────────────────────────────────────────
    console.log("step: accounts login"); const pa = await as(T.a); LAST = pa;
    r = await call(pa, 'saf_approve', { p_id: id1 });
    const accCannotApprove = r.error === 'forbidden';
    r = await call(pa, 'saf_verify', { p_id: id1 });
    if (!r.success) throw new Error('verify failed: ' + JSON.stringify(r));

    // ── Rashid: the approve screen ─────────────────────────────────────────
    console.log("step: rashid login"); const pr = await as(T.r); LAST = pr;
    const naeemApprove = await call(pn, 'saf_approve', { p_id: id1 });
    console.log("step: rashid list");
    await ensure(pr, () => setTab('saf'), '.sf-wrap .sf-chips');
    await shot(pr, '2-sale-approval-list.png');
    await ensure(pr, id => safOpen(id), '.sf-acts', id1);
    await shot(pr, '3-approve-screen.png');
    console.log('acts:', await pr.evaluate(() => (document.querySelector('.sf-acts') || {}).outerHTML || 'none'));
    await pr.evaluate(() => safAct('approve'));   // what the Approve button runs; the confirm() is accepted
    await pr.waitForFunction(() => document.querySelector('.st-approved'), { timeout: 30000 });
    const ap = await one(`select status, snapshot_hash, encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') = snapshot_hash as hash_ok from sale_approval_forms where id='${id1}'`);
    ok('5a', ap.status === 'approved' && ap.hash_ok && accCannotApprove && naeemApprove.error === 'forbidden',
       `approved by Rashid only (Accounts: forbidden, Naeem: ${naeemApprove.error}); sealed ${ap.snapshot_hash.slice(0, 16)}…`);
    await shot(pr, '4-approved.png');

    // 5b. direct SQL cannot edit an approved form
    let lockMsg = '';
    try { await q(`update sale_approval_forms set net_price = net_price - 1 where id='${id1}'`); lockMsg = 'WENT THROUGH'; }
    catch (e) { lockMsg = (e.message.match(/Sale Approval Form[^"\\]*/) || [e.message])[0]; }
    ok('5b', lockMsg !== 'WENT THROUGH', 'direct UPDATE: ' + lockMsg);

    // 8 (PDF): generated, every block, identical on re-print
    const pdf1 = await pr.evaluate(async () => { const b = await window._safBuildPdf(_safCur()); return Array.from(b); });
    const pdf2 = await pr.evaluate(async () => { const b = await window._safBuildPdf(_safCur()); return Array.from(b); });
    const h1 = crypto.createHash('sha256').update(Buffer.from(pdf1)).digest('hex'), h2 = crypto.createHash('sha256').update(Buffer.from(pdf2)).digest('hex');
    fs.writeFileSync(path.join(OUT, 'SAF-sample.pdf'), Buffer.from(pdf1));
    const rec1 = await call(pr, 'saf_record_pdf', { p_id: id1, p_sha256: h1 });
    const rec2 = await call(pr, 'saf_record_pdf', { p_id: id1, p_sha256: h2 });
    const txt = Buffer.from(pdf1).toString('latin1');
    const blocks = ['UNIT', 'DEAL', 'BUYER', 'MONEY RECEIVED', 'SCHEDULE', 'SOLD BY', 'AGENT', 'ACCOUNTS', 'DIRECTOR', 'Fingerprint', 'Any change requires a new SAF'];
    const missing = blocks.filter(b => txt.indexOf(b) < 0);
    ok('8', h1 === h2 && rec1.first && rec2.identical && !missing.length && txt.indexOf(ap.snapshot_hash) >= 0,
       `PDF ${pdf1.length} bytes, sha256 ${h1.slice(0, 16)}…; re-print identical: ${h1 === h2}; recorded first ${rec1.first}, second print identical ${rec2.identical}; blocks missing: ${missing.join(',') || 'none'}; hash printed: ${txt.indexOf(ap.snapshot_hash) >= 0}`);

    // 5c. supersede: new draft, through the same steps, old one SUPERSEDED
    r = await call(pr, 'saf_supersede', { p_id: id1 }); id2 = r.saf.id;
    await call(pn, 'saf_save', { p_id: id2, p_input: { plan_type: 'standard', discount_amount: 0, discount_reason: '', discount_approved_by: null } });
    r = await call(pn, 'saf_submit', { p_id: id2 }); if (!r.success) throw new Error('submit 2: ' + JSON.stringify(r));
    await call(pa, 'saf_verify', { p_id: id2 });
    r = await call(pr, 'saf_approve', { p_id: id2 });
    const old = await one(`select status, superseded_by from sale_approval_forms where id='${id1}'`);
    ok('5c', r.success && old.status === 'superseded' && old.superseded_by === id2,
       `${r.saf && r.saf.saf_no} approved; ${s1.saf_no} now ${old.status.toUpperCase()}`);
    await ensure(pr, id => safOpen(id), '.st-superseded', id1);
    await sleep(1200);
    await shot(pr, '5-superseded.png');

    // 6. the sale: refused without a SAF, made from one with its numbers (rolled back)
    const t6 = await aborted(`
      DECLARE res jsonb; out text; v_sale uuid; f record; u2 uuid;
      BEGIN
        SELECT u.id INTO u2 FROM units u JOIN category_unit_statuses cs ON cs.id=u.status_id
         WHERE u.company_id='${CO}' AND cs.is_available LIMIT 1;
        PERFORM set_config('request.jwt.claims', '{"sub":"315f2852-852f-4653-9253-a5a27a7828c8","role":"authenticated"}', true);
        res := create_sale_with_schedule(jsonb_build_object('company_id','${CO}','unit_id',u2,'client_id',gen_random_uuid(),
                 'price_per_sqft',1,'area_sqft',1,'down_payment',1), '[{"installment_number":0,"installment_type":"down_payment","amount_due":1}]'::jsonb);
        out := 'no SAF: ' || COALESCE(res->>'error','made');
        res := saf_create_sale(${lit(T.r)}, '${id2}'); v_sale := (res->>'sale_id')::uuid;
        SELECT * INTO f FROM sale_approval_forms WHERE id='${id2}';
        out := out || ' | from SAF: ' || COALESCE(res->>'sale_number', res::text)
          || ' net ' || (SELECT price_per_sqft*area_sqft-discount FROM sales WHERE id=v_sale) || '=' || f.net_price
          || ' dp ' || (SELECT down_payment FROM sales WHERE id=v_sale) || '=' || f.dp_amount
          || ' lines ' || (SELECT count(*) FROM installments WHERE sale_id=v_sale) || '=' || jsonb_array_length(f.schedule_json)
          || ' sum ' || (SELECT sum(amount_due) FROM installments WHERE sale_id=v_sale)
          || ' saf_id ' || ((SELECT saf_id FROM sales WHERE id=v_sale) = f.id)::text
          || ' agent ' || ((SELECT agent_id FROM sales WHERE id=v_sale) IS NOT DISTINCT FROM f.agent_id)::text
          || ' hold ' || (SELECT status FROM reservations WHERE id=f.reservation_id);
        RAISE EXCEPTION 'RESULT:%', out;
      END`);
    const m6 = t6.match(/net (\S+)=(\S+) dp (\S+)=(\S+) lines (\d+)=(\d+) sum (\S+) saf_id true agent true/);
    ok('6', /no SAF: saf_required/.test(t6) && m6 && Number(m6[1]) === Number(m6[2]) && Number(m6[3]) === Number(m6[4]) && m6[5] === m6[6] && Number(m6[7]) === Number(m6[2]),
       t6);

    // 7. Sold by direct SQL with nobody on the hold (rolled back either way)
    const t7 = await aborted(`
      DECLARE u uuid; v_err text;
      BEGIN
        SELECT x.id INTO u FROM units x JOIN category_unit_statuses cs ON cs.id=x.status_id
         WHERE x.company_id='${CO}' AND cs.is_available AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id=x.id AND r.status='active') LIMIT 1;
        BEGIN
          UPDATE units SET status_id=(SELECT id FROM category_unit_statuses WHERE company_id='${CO}' AND status_code='SOLD_ENTRY_PENDING') WHERE id=u;
          RAISE EXCEPTION 'RESULT:ALLOWED';
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_err = PG_EXCEPTION_DETAIL;
          IF SQLERRM LIKE 'RESULT:%' THEN RAISE; END IF;
          RAISE EXCEPTION 'RESULT:% — %', v_err, SQLERRM;
        END;
      END`);
    ok('7', /^sold_needs_buyer_and_agent/.test(t7), t7);

    // 9. the audit trail names people
    const aud = await q(`select changed_by_name, action, count(*) n from audit_logs where table_name='sale_approval_forms'
                          and record_id in ('${id1}','${id2}') group by 1,2 order by 1,2`);
    const names = [...new Set(aud.map(x => x.changed_by_name))];
    ok('9', names.length && names.every(n => !['system', 'unknown'].includes(n)) && names.includes('Rashid Manzoor') && names.includes('Amar taj') && names.includes('Naeem Hussain'),
       aud.map(x => `${x.changed_by_name} ${x.action} x${x.n}`).join(', '));

    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } catch (e) {
    console.log('ERROR', e.message);
    try { if (LAST) { await LAST.screenshot({ path: path.join(OUT, 'error.png'), fullPage: true }); console.log('at', await LAST.evaluate(() => (typeof TAB !== 'undefined' ? TAB : '?') + ' | ' + document.body.innerText.slice(0, 300))); } } catch (x) {}
  } finally {
    await browser.close(); server.close();
    // ── clean-up: everything this run made ─────────────────────────────────
    await q(`begin;
      set local session_replication_role = replica;   -- lets the locked test forms go
      delete from sale_approval_forms where id in (select id from sale_approval_forms where prepared_by in ('${NAEEM}','${RASHID}','${AMAR}')
                                                     and created_at >= '${runStart}');
      delete from sales_sessions where session_token like '${RUN}%';
      update saf_counters set last_no = ${counterBefore.n} where company_id = '${CO}';
      delete from saf_counters where company_id = '${CO}' and last_no = 0;
      commit;`);
    const after = await money();
    const left = await one(`select (select count(*) from sale_approval_forms) safs, (select count(*) from sales_sessions where session_token like 'saftest_%') sessions,
                                   (select count(*) from sales where company_id='${CO}') awami_sales,
                                   (select status from reservations where unit_id='${unit.id}' and status='active' limit 1) lg01_hold,
                                   (select cs.status_name from units u join category_unit_statuses cs on cs.id=u.status_id where u.id='${unit.id}') lg01_status`);
    console.log('after ', JSON.stringify(after.agree));
    console.log('left over', JSON.stringify(left));
    ok('cleanup', JSON.stringify(after.agree) === JSON.stringify(before.agree) && Number(left.safs) === 0 && Number(left.sessions) === 0,
       `agree before ${JSON.stringify(before.agree)} after ${JSON.stringify(after.agree)}`);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ run: RUN, before: before.agree, after: after.agree, results }, null, 2));
    console.log(`\n${results.filter(x => x.pass).length}/${results.length} passed`);
  }
})();
