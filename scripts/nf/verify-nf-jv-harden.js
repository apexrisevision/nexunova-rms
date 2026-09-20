#!/usr/bin/env node
/**
 * NexuFinance v1 — the journal-voucher hardening (20260919p), driven for
 * real. Closes docs/AUDIT_REPORT.md CRITICAL-3: nf_jv_list selected by
 * day_id IS NULL, which also matches every QuickBooks-imported historical
 * voucher, so the Journal Vouchers screen listed Awami's entire imported
 * history with a Delete button on every row.
 *
 * SR-5/SR-7: the earlier suite (verify-nf-journal-voucher.js) never seeded
 * an imported-history voucher, so it could not have caught this — a test
 * that only supplies the safe case has not tested the rule. This suite
 * seeds the UNSAFE case on purpose: a real ZZTEST-NF company carrying a
 * fixture 'IMPORT' voucher alongside a real 'JV' one, exactly the shape
 * Awami's real data is in.
 *
 * Two layers of proof, deliberately not just one:
 *   - UI: the real Journal Vouchers screen, in a real browser, must never
 *     show the imported voucher — not "no Delete button on it", not
 *     rendered AT ALL, because a UI omission is not the guarantee.
 *   - RPC: nf_jv_delete is called directly over real HTTP with a real JWT
 *     (SR-9 — the actual request, not a shortcut through raw SQL) on the
 *     imported voucher's id, bypassing the screen entirely, and must still
 *     be refused. The database is the one making the promise, not the menu.
 *
 *   node scripts/nf/verify-nf-jv-harden.js > "$SCRATCH/nf-jv-harden.log" 2>&1
 *
 * Disposable ZZTEST-NF-<run> company; Awami is never touched; cleanup
 * verified by query, always, even on failure.
 *
 * Exit: 0 held · 1 something failed · 2 could not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const { q, REF, TOKEN } = require(path.join(ROOT, 'scripts', '_sbq'));
const { buildSeed, seedSql, AWAMI_COMPANY_ID } = require(path.join(ROOT, 'scripts', 'nf', 'gen-seed'));

const PORT = 4499;
const URL_BASE = `https://${REF}.supabase.co`;
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch { return false; } });
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { try { puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(ROOT, 'migration_work', 'node_modules')] })); } catch {} }
if (!puppeteer || !CHROME) { console.log('[verify-nf-jv-harden] SKIPPED — no puppeteer-core/Chrome.'); process.exit(0); }

const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(50)} ${pass ? '' : String(detail).slice(0, 300)}`); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'nexufinance.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}
async function keys() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`api-keys HTTP ${r.status}`);
  const list = await r.json();
  return { anon: list.find(k => k.name === 'anon').api_key, svc: list.find(k => k.name === 'service_role').api_key };
}
async function http_(method, urlPath, { key, jwt, body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(URL_BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
// Every RPC call goes over real HTTP with a real JWT (SR-9) — the same
// request shape PostgREST gives the real frontend, not a shortcut through
// raw SQL. Every argument is asserted present before sending.
function rpc(anonKey, jwt, name, args) {
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) throw new Error(`rpc ${name}: argument ${k} is undefined`);
  }
  return http_('POST', `/rest/v1/rpc/${name}`, { key: anonKey, jwt, body: args });
}
const code = r => (r.json && typeof r.json === 'object' && r.json.message) || null;

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  console.log(`[verify-nf-jv-harden] project ${REF} · run ${run}`);
  let K;
  try {
    const [probe] = await q(`select (select count(*) from information_schema.columns where table_name='nf_vouchers' and column_name='source') has_source`);
    if (Number(probe.has_source) === 0) { console.log('COULD NOT RUN — 20260919p is not applied.'); process.exitCode = 2; return; }
    K = await keys();
  } catch (e) { console.log('COULD NOT RUN —', e.message); process.exitCode = 2; return; }

  const built = buildSeed();
  if (built.failures.length) { console.log('COULD NOT RUN — seed assertions failed'); process.exitCode = 2; return; }
  const C = crypto.randomUUID();
  if (C === AWAMI_COMPANY_ID) { process.exitCode = 2; return; }
  const users = {};
  const awamiBefore = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;

  let srv, browser, C2 = null;
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZJVX${run}', 'ZZTEST-NF-${run}')`);
    await q(seedSql(C, built.seed));
    const email = `nf-jvx-${run}@zztest-nf.invalid`, password = crypto.randomBytes(18).toString('base64url');
    const cu = await http_('POST', '/auth/v1/admin/users', { key: K.svc, jwt: K.svc, body: { email, password, email_confirm: true } });
    if (cu.status >= 300) throw new Error(`create user: HTTP ${cu.status}`);
    users.D = { id: cu.json.id, email, password };
    await q(`insert into nf_members (company_id, user_id, role, display_name, active) values ('${C}','${users.D.id}','director','JVX Director',true)`);
    const li = await http_('POST', '/auth/v1/token?grant_type=password', { key: K.anon, body: { email, password } });
    if (li.status !== 200) throw new Error(`sign-in: HTTP ${li.status}`);
    users.D.jwt = li.json.access_token;

    // ── the fixture: SR-5/SR-7 — seed the UNSAFE case, not only the safe one ──
    // a real, unattended-to-QuickBooks-import-marker voucher (mirrors the
    // exact shape scripts/nf/import-awami-history.js leaves behind: day_id
    // NULL, iif_exportable=false, source='IMPORT'), and a real JV alongside it.
    await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select public.nf_post_voucher('${C}', NULL, 'JV-9001', '2026-01-01', 'fixture: imported history', 0,
        '[{"account_code":"22100","floor_code":"P-W","debit":500},{"account_code":"70100","floor_code":"P-W","credit":500}]'::jsonb)`);
    await q(`update nf_vouchers set source='IMPORT', iif_exportable=false where company_id='${C}' and voucher_key='JV-9001'`);
    const [importRow] = await q(`select id, version from nf_vouchers where company_id='${C}' and voucher_key='JV-9001'`);
    await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select public.nf_post_voucher('${C}', NULL, 'JV-0001', '2026-01-05', 'a real journal voucher', 0,
        '[{"account_code":"22100","floor_code":"P-W","debit":100},{"account_code":"70100","floor_code":"P-W","credit":100}]'::jsonb)`);
    console.log('  fixture: company, real chart, a director, one IMPORT voucher + one real JV\n');

    // ── layer 1: the real screen must never show the imported voucher ────────
    srv = await serve();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.evaluateOnNewDocument((ref, jwt, uid, mail) => {
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({
        access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, aud: 'authenticated', role: 'authenticated', email: mail, app_metadata: {}, user_metadata: {} } }));
    }, REF, users.D.jwt, users.D.id, users.D.email);
    await page.setViewport({ width: 1500, height: 1100 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto(`http://127.0.0.1:${PORT}/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
    // No day has been started in this fixture yet (only journal vouchers
    // exist so far) — the sheet shows the "start first day" form instead of
    // .pos-grid, but the header and its Reports menu render regardless.
    await page.waitForSelector('#nf-rpm-toggle', { timeout: 15000 });
    await page.click('#nf-rpm-toggle');
    await page.waitForSelector('#nf-rpm-panel:not([hidden])', { timeout: 5000 });
    await page.click('[data-goto="jv"]');
    await page.waitForSelector('.jvsheet #nf-jv-post', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.jvcard').length > 0, { timeout: 15000 });

    const screenState = await page.evaluate(() => ({
      cardCount: document.querySelectorAll('.jvcard').length,
      voucherNos: [...document.querySelectorAll('.jvhead b')].map(b => b.textContent.trim()),
      bodyHasImportNo: document.body.innerText.includes('JV-9001'),
      deleteButtons: document.querySelectorAll('[data-del-jv]').length,
    }));
    ok('JVX-01 the real screen lists exactly the one real JV', screenState.cardCount === 1 && screenState.voucherNos[0] === 'JV-0001', JSON.stringify(screenState));
    ok('JVX-02 the imported voucher is not rendered ANYWHERE on the screen (not just Delete-less)',
      screenState.bodyHasImportNo === false, JSON.stringify(screenState));
    ok('JVX-03 exactly one Delete button exists (on the real JV, not the import)',
      screenState.deleteButtons === 1, JSON.stringify(screenState));

    // ── layer 2: the DB refuses it even bypassing the screen entirely ────────
    // Real REST call, real JWT, the imported voucher's own id — proves the
    // lock is a database fact, not something the menu merely declines to show.
    let r = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: importRow.id, p_version: importRow.version });
    ok('JVX-04 nf_jv_delete refuses the imported voucher by id, bypassing the UI', code(r) === 'NF:IMPORTED_LOCKED', JSON.stringify(r.json));
    const [stillThere] = await q(`select count(*) n from nf_vouchers where id='${importRow.id}'`);
    ok('JVX-04 it is still there', Number(stillThere.n) === 1, JSON.stringify(stillThere));

    // future date
    r = await rpc(K.anon, users.D.jwt, 'nf_jv_save', {
      p_company_id: C, p_voucher_no: 'JV-FUT', p_voucher_date: '2031-01-01', p_narration: 'too far ahead',
      p_legs: [{ account_code: '22100', floor_code: 'P-W', debit: 10 }, { account_code: '70100', floor_code: 'P-W', credit: 10 }],
    });
    ok('JVX-05 a future-dated voucher is refused', code(r) === 'NF:DATE_FUTURE', JSON.stringify(r.json));

    // period gate: close a day directly (bypassing the real submit/close
    // workflow, already covered by dry-run-daily-workflow.js), then confirm
    // save AND delete both respect it. DISABLE TRIGGER is DDL and therefore
    // transactional — wrapped in its own explicit BEGIN/COMMIT, in ONE q()
    // call, so a failure anywhere in between rolls back the disable too and
    // nf_days' triggers can never be left off. Same technique already
    // established for the scale-test harness (scripts/nf/scale-test-nf.js),
    // there inside a rolled-back rehearsal; here inside a real, committed,
    // single statement batch instead, for exactly the same reason.
    await q(`select set_config('request.jwt.claim.sub','${users.D.id}',true);
      select public.nf_start_first_day('${C}', '2026-02-01', 'DC-1', 1000, 0, 0)`);
    await q(`BEGIN;
      alter table nf_days disable trigger user;
      update nf_days set status='CLOSED', close_cash=1000, close_petty=0, close_bank=0, variance=0, closed_at=now(), closed_by='${users.D.id}'
       where company_id='${C}' and business_date='2026-02-01';
      alter table nf_days enable trigger user;
      COMMIT;`);

    r = await rpc(K.anon, users.D.jwt, 'nf_jv_save', {
      p_company_id: C, p_voucher_no: 'JV-INCLOSED', p_voucher_date: '2026-02-01', p_narration: 'inside the closed period',
      p_legs: [{ account_code: '22100', floor_code: 'P-W', debit: 10 }, { account_code: '70100', floor_code: 'P-W', credit: 10 }],
    });
    ok('JVX-06 nf_jv_save refuses a date inside a closed period', code(r) === 'NF:PERIOD_CLOSED', JSON.stringify(r.json));

    r = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: importRow.id, p_version: importRow.version });
    // still IMPORTED_LOCKED takes priority (checked first) — confirms ordering didn't regress
    ok('JVX-06b delete on the import voucher still says IMPORTED_LOCKED, not PERIOD_CLOSED', code(r) === 'NF:IMPORTED_LOCKED', JSON.stringify(r.json));

    const [realOld] = await q(`select id, version from nf_vouchers where company_id='${C}' and voucher_key='JV-0001'`);
    r = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: realOld.id, p_version: realOld.version });
    ok('JVX-07 nf_jv_delete refuses a REAL (source=JV) voucher dated before a since-closed period',
      code(r) === 'NF:PERIOD_CLOSED', JSON.stringify(r.json));

    // stale version, on a voucher dated AFTER the closed period so PERIOD_CLOSED doesn't mask it
    r = await rpc(K.anon, users.D.jwt, 'nf_jv_save', {
      p_company_id: C, p_voucher_no: 'JV-AFTER', p_voucher_date: '2026-02-02', p_narration: 'after the closed period',
      p_legs: [{ account_code: '22100', floor_code: 'P-W', debit: 10 }, { account_code: '70100', floor_code: 'P-W', credit: 10 }],
    });
    const afterId = r.json && r.json.id;
    ok('JVX-08 setup: a voucher dated after the closed period saves', !!afterId, JSON.stringify(r.json));
    r = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: afterId, p_version: 999 });
    ok('JVX-08 a stale version is refused', code(r) === 'NF:VERSION_CONFLICT', JSON.stringify(r.json));
    r = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: afterId, p_version: 0 });
    ok('JVX-08 the correct version deletes cleanly', r.status >= 200 && r.status < 300 && r.json && r.json.deleted === 'JV-AFTER', JSON.stringify(r.json));

    ok('JVX-09 no console or page errors on the real screen', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

    // ── JVX-10 · the REAL import path must tag its own rows (SR-7) ──────────
    // Re-audit test gap (b): everything above proves the RULE — an IMPORT
    // voucher cannot be listed or deleted — but the fixture sets
    // source='IMPORT' by hand, so nothing proved that the thing which
    // actually creates imported history produces that state. If a future
    // KBH/FMH import arrived untagged it would default to source='JV' and be
    // listed with a Delete button on every row, which is CRITICAL-3 again.
    //
    // So run the real script, on the real spreadsheet, through its own code
    // path (`--dry-run` regenerates the SQL and writes it without executing),
    // then execute that SQL against THIS disposable company and check what
    // actually lands in the table. Nothing is hand-set here.
    const genPath = path.join(ROOT, 'scripts', 'nf', '_import_awami_generated.sql');
    try { fs.unlinkSync(genPath); } catch {}
    const dry = require('child_process').spawnSync(process.execPath,
      [path.join(ROOT, 'scripts', 'nf', 'import-awami-history.js'), '--dry-run'],
      { cwd: ROOT, encoding: 'utf8' });
    ok('JVX-10 the real import script runs and regenerates its SQL',
      dry.status === 0 && fs.existsSync(genPath),
      `exit ${dry.status} · ${String(dry.stderr || '').slice(0, 200)}`);

    if (dry.status === 0 && fs.existsSync(genPath)) {
      // A SECOND disposable company, because the import's own voucher numbers
      // are JV-0001..JV-0064 and the fixture above already owns JV-0001 —
      // a collision would fail on NF:DUPLICATE_VOUCHER and prove nothing
      // about tagging. Renaming the vouchers instead would mean editing the
      // script's output, and the point is to run what the script produces.
      C2 = crypto.randomUUID();
      await q(`insert into companies (id, company_code, company_name) values ('${C2}', 'ZZIMP${run}', 'ZZTEST-NF-${run}-imp')`);
      await q(seedSql(C2, built.seed));
      await q(`insert into nf_members (company_id, user_id, role, display_name, active)
               values ('${C2}','${users.D.id}','director','JVX Director',true)`);

      let importSql = fs.readFileSync(genPath, 'utf8');
      const sysUser = fs.readFileSync(path.join(ROOT, 'scripts', 'nf', '_import_system_user_id.txt'), 'utf8').trim();
      // retarget: that second disposable company and this test's director, nobody else
      importSql = importSql.split(AWAMI_COMPANY_ID).join(C2).split(sysUser).join(users.D.id);
      // SAFETY, asserted rather than assumed — if a single Awami id or the
      // system user survived the retarget this would write to the real book.
      const clean = !importSql.includes(AWAMI_COMPANY_ID) && !importSql.includes(sysUser);
      ok('JVX-10 setup: the retargeted SQL contains no Awami id and no system user id', clean,
        'retarget failed — NOT executed');
      if (clean) {
        let impErr = null;
        try { await q(importSql); } catch (e) { impErr = e.message; }
        ok('JVX-11 the real import path completes against a scratch company',
          impErr === null, String(impErr).slice(0, 300));

        const [tag] = await q(`select
            count(*) total,
            count(*) filter (where source = 'IMPORT') tagged,
            count(*) filter (where source <> 'IMPORT') untagged,
            count(*) filter (where iif_exportable) exportable,
            count(*) filter (where day_id is null) dayless
          from nf_vouchers where company_id='${C2}' and created_by='${users.D.id}'`);
        ok('JVX-12 every voucher the import created carries source=\'IMPORT\' — none defaulted to \'JV\'',
          Number(tag.total) === 64 && Number(tag.tagged) === 64 && Number(tag.untagged) === 0,
          JSON.stringify(tag));
        ok('JVX-13 …and each is day-less and not queued for re-export to QuickBooks',
          Number(tag.dayless) === 64 && Number(tag.exportable) === 0, JSON.stringify(tag));

        // the consequence that matters: they are invisible and undeletable
        const lst = await rpc(K.anon, users.D.jwt, 'nf_jv_list', { p_company_id: C2, p_from: null, p_to: null });
        const listed = (lst.json && lst.json.vouchers) || [];
        // C2 holds the 64 imported vouchers and nothing else, so a correct
        // nf_jv_list returns an EMPTY list here — the real JV-0001 lives in C.
        ok('JVX-14 nf_jv_list shows none of the 64 freshly imported vouchers',
          listed.length === 0,
          `${listed.length} listed: ${JSON.stringify(listed.map(v => v.voucher_no).slice(0, 5))}`);
        // "nothing is listed" is only meaningful if the list can show something,
        // so prove the same call in the SAME company does return a real JV once
        // one exists — otherwise an always-empty list would pass this.
        const realJv = await rpc(K.anon, users.D.jwt, 'nf_jv_save', {
          p_company_id: C2, p_voucher_no: 'JV-REAL-1', p_voucher_date: '2026-09-01',
          p_narration: 'a genuine journal voucher alongside the imported ones',
          p_legs: [{ account_code: '22100', floor_code: 'P-W', debit: 10 },
                   { account_code: '70100', floor_code: 'P-W', credit: 10 }] });
        const lst2 = await rpc(K.anon, users.D.jwt, 'nf_jv_list', { p_company_id: C2, p_from: null, p_to: null });
        const listed2 = (lst2.json && lst2.json.vouchers) || [];
        ok('JVX-14b …and the list is not simply always empty: a real JV in the same company IS shown',
          realJv.status === 200 && listed2.length === 1 && listed2[0].voucher_no === 'JV-REAL-1',
          `${listed2.length}: ${JSON.stringify(listed2.map(v => v.voucher_no))}`);
        const [anImport] = await q(`select id, version from nf_vouchers
          where company_id='${C2}' and created_by='${users.D.id}' and source='IMPORT' limit 1`);
        const del = await rpc(K.anon, users.D.jwt, 'nf_jv_delete', { p_voucher_id: anImport.id, p_version: anImport.version });
        ok('JVX-15 …and nf_jv_delete refuses one of them by id', code(del) === 'NF:IMPORTED_LOCKED', JSON.stringify(del.json));
      }
    }
  } catch (e) {
    ok('RUN', false, e.stack || e.message);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();
    console.log('\n── cleanup');
    if (C2) { try { console.log('  purge C2:', JSON.stringify((await q(`select public._nf_test_purge('${C2}') j`))[0].j)); } catch (e) { console.log('  purge C2 raised:', e.message); } }
    try { console.log('  purge:', JSON.stringify((await q(`select public._nf_test_purge('${C}') j`))[0].j)); }
    catch (e) { console.log('  purge raised:', e.message); }
    if (users.D && users.D.id) {
      const r = await http_('DELETE', `/auth/v1/admin/users/${users.D.id}`, { key: K.svc, jwt: K.svc });
      console.log(`  delete user: HTTP ${r.status}`);
    }
    const [left] = await q(`select json_build_object(
      'company', (select count(*) from companies where id='${C}'),
      'nf_rows', (select count(*) from nf_vouchers where company_id='${C}') + (select count(*) from nf_days where company_id='${C}')) j`);
    console.log('  verified by query:', JSON.stringify(left.j));
    ok('CLEANUP', left.j.company === 0 && left.j.nf_rows === 0, JSON.stringify(left.j));
    const awamiAfter = (await q(`select count(*) n from nf_vouchers where company_id='${AWAMI_COMPANY_ID}'`))[0].n;
    ok('AWAMI-UNTOUCHED', String(awamiAfter) === String(awamiBefore), `${awamiBefore} → ${awamiAfter}`);

    const failed = results.filter(x => !x.pass);
    console.log(`\n${results.length} checks · ${results.length - failed.length} passed · ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
