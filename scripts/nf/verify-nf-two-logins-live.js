#!/usr/bin/env node
/* After deploy: the LIVE NexuFinance page (rms.nexunova.com), one closing, two logins (docs/PLAN.md §49).
   A throw-away ZZTEST company gets a director (head office cash) and an accountant on the site cash box;
   each enters a line through the real functions, then the live page is opened as each. Everything made here
   is removed afterwards and checked by query. Usage: node scripts/nf/verify-nf-two-logins-live.js <screenshot dir> */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const { q, REF } = require('../_sbq');
const { buildSeed, seedSql } = require('./gen-seed');
const ANON = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js', 'supabase.js'), 'utf8'))[1];
const OUT = process.argv[2];
(async () => {
  const run = crypto.randomBytes(3).toString('hex'), C = crypto.randomUUID();
  const users = { dir: { id: crypto.randomUUID(), role: 'director', box: 'Cash', name: 'ZZ Director' },
                  site: { id: crypto.randomUUID(), role: 'accountant', box: 'Petty', name: 'ZZ Site' } };
  for (const u of Object.values(users)) { u.email = `nf-2login-${u.box.toLowerCase()}-${run}@zztest-nf.invalid`; u.pw = crypto.randomBytes(15).toString('base64url'); }
  const out = { checks: [] }; let br;
  const check = (n, c, x) => out.checks.push((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
  try {
    await q(`insert into companies (id, company_code, company_name) values ('${C}', 'ZZ2L${run}', 'ZZTEST-NF-2LOGIN-${run}')`);
    await q(seedSql(C, buildSeed().seed));
    for (const u of Object.values(users)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
                 confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
               values ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${u.email}', extensions.crypt('${u.pw}', extensions.gen_salt('bf')), now(), now(), now(),
                 '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', '');
               insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
               values (gen_random_uuid(), '${u.id}', '${u.id}', 'email', json_build_object('sub', '${u.id}', 'email', '${u.email}')::jsonb, now(), now(), now());
               insert into nf_members (company_id, user_id, role, display_name, active, cash_via) values ('${C}', '${u.id}', '${u.role}', '${u.name}', true, '${u.box}');`);
    }
    // a day with money in both boxes, and one line from each login
    const as = id => `PERFORM set_config('request.jwt.claims', json_build_object('sub', '${id}', 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', '${id}', true);`;
    await q(`DO $x$ DECLARE d uuid; BEGIN ${as(users.dir.id)}
      PERFORM public.nf_start_first_day('${C}', (now() AT TIME ZONE 'Asia/Karachi')::date, 'DC-001', 50000, 20000, 100000);
      SELECT id INTO d FROM nf_days WHERE company_id = '${C}';
      PERFORM public.nf_save_line(d, NULL, 'OUT', 'CPV-1', 'HO tea', '60400', 'P-W', 'Cash', 500, NULL, NULL);
      ${as(users.site.id)}
      PERFORM public.nf_save_line(d, NULL, 'OUT', 'S-CPV-1', 'Site broom', '60400', 'P-W', 'Petty', 300, NULL, NULL);
      END $x$;`);
    br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
    for (const key of ['site', 'dir']) {
      const u = users[key];
      const r = await fetch(`https://${REF}.supabase.co/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.pw }) });
      const jwt = (await r.json()).access_token;
      const pg = await br.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
      await pg.setViewport({ width: key === 'site' ? 390 : 1300, height: 900, deviceScaleFactor: key === 'site' ? 2 : 1.25 });
      await pg.evaluateOnNewDocument((ref, jwt, id, email) => {
        const now = Math.floor(Date.now() / 1000);
        localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
          user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} } }));
      }, REF, jwt, u.id, u.email);
      await pg.goto(`https://rms.nexunova.com/nexufinance.html?company=${C}`, { waitUntil: 'networkidle2' });
      await pg.waitForSelector('.row[data-saved]', { timeout: 30000 });
      const t = await pg.evaluate(() => ({
        scripts: [...document.scripts].map(s => s.src).filter(s => /nf-sheet/.test(s)).map(s => s.replace(/^.*\/js/, 'js')),
        who: (document.querySelector('.nf-who') || {}).textContent, reports: !!document.querySelector('#nf-rpm-toggle'), xlsx: !!document.querySelector('#nf-dayXlsx'), filter: !!document.querySelector('[data-whose]'),
        close: !!document.querySelector('#nf-close'), tags: [...document.querySelectorAll('.nf-by')].map(x => x.textContent),
        ro: [...document.querySelectorAll('.row[data-ro] input.amt')].map(x => x.disabled), overflow: document.documentElement.scrollWidth - window.innerWidth,
        pos: [...document.querySelectorAll('table.pos tbody tr td:first-child')].map(td => td.textContent).join(' | '),
      }));
      if (key === 'site') {
        check('live page serves the new sheet', t.scripts.some(s => s.indexOf('nf-sheet.js?v=20261119k') >= 0), t.scripts.join(','));
        check('site login: chip "ZZ Site · Petty cash" (a test company keeps the seed labels), no Reports, no Close day', /ZZ Site · Petty cash/.test(t.who || '') && !t.reports && !t.close, t.who);
        check('site login: no Excel button', !t.xlsx);
        // 20261119e: the site box sees its own lines only — no Head Office line, no lock, no filter
        check('site login: only his own line (no Head Office line, no lock, no filter)', t.ro.length === 0 && t.tags.join(',') === 'ZZ Site' && !t.filter, t.tags.join(',') + ' · filter ' + t.filter);
        check('site login: Site Cash only in the position', t.pos === 'Petty cash | Total', t.pos);
        check('site login on a phone: nothing wider than the screen', t.overflow <= 1, String(t.overflow));
        // 20261119f: a deposit is offered in the Cash payment heads
        await pg.click('[data-vtype="CPV"]'); await pg.waitForSelector('[data-pick="nfv-head"] .nfpick-in');
        await pg.type('[data-pick="nfv-head"] .nfpick-in', 'deposit'); await pg.waitForSelector('[data-pick="nfv-head"] .nfpick-opt');
        const dep = await pg.evaluate(() => document.querySelector('[data-pick="nfv-head"] .nfpick-opt').textContent);
        check('site login: Cash payment heads offer "Cash deposited in BOP (bank)"', dep.indexOf('Cash deposited in BOP (bank)') >= 0, dep);
        await pg.screenshot({ path: path.join(OUT, '9 LIVE - site login, deposit head.png') });
        await pg.evaluate(() => { const b = document.querySelector('#nf-vpop'); if (b) b.remove(); });
        await pg.screenshot({ path: path.join(OUT, '6 LIVE - site login, phone.png'), fullPage: true });
      } else {
        check('director: Reports and Close day there, no line locked', t.reports && t.close && t.ro.length === 0);
        check('director: Excel button there', t.xlsx);
        check('director: both tags shown', t.tags.includes('Head Office') && t.tags.includes('ZZ Site'), t.tags.join(','));
        check('position: Cash in hand / Petty cash labels for a non-Awami company (only Awami was relabelled)', /Cash in hand/.test(t.pos), t.pos);
        await pg.screenshot({ path: path.join(OUT, '7 LIVE - director login.png'), fullPage: true });
      }
      // WhatsApp report: the director chooses a view, the site login has none
      await pg.click('#nf-waReport'); await pg.waitForSelector('#nf-wa-dialog [data-wa="preview"]');
      const wa = await pg.evaluate(() => ({ radios: [...document.querySelectorAll('#nf-wa-dialog input[name="nf-wa-view"]')].map(r => r.value).join(','), only: (document.querySelector('.nf-wa-only') || {}).textContent || '' }));
      if (key === 'site') check('site login: WhatsApp report is Site only (no view choice)', wa.radios === '' && wa.only === 'Site view', JSON.stringify(wa));
      else check('director: WhatsApp report offers Site / Head Office / Combined', wa.radios === 'site,ho,combined', JSON.stringify(wa));
      // each view the login has opens as the one-page Daily Brief, and its picture is drawn
      for (const v of (key === 'site' ? [''] : ['site', 'ho', 'combined'])) {
        if (!(await pg.$('#nf-wa-dialog'))) { await pg.click('#nf-waReport'); await pg.waitForSelector('#nf-wa-dialog [data-wa="preview"]'); }
        if (v) await pg.evaluate(v => { document.querySelector('#nf-wa-dialog input[value="' + v + '"]').checked = true; }, v);
        await pg.click('#nf-wa-dialog [data-wa="preview"]'); await pg.waitForSelector('#nfwa-preview .wa');
        await pg.waitForFunction(() => !document.querySelector('#nfwa-preview [data-act="jpg"]').disabled || /Could not/.test(document.querySelector('#nfwa-preview .nfwa-msg').textContent), { timeout: 30000 }).catch(() => {});
        const b = await pg.evaluate(() => { const w = document.querySelector('#nfwa-preview .wa'); return { h1: w.querySelector('h1').textContent, tag: w.querySelector('.tag').textContent, size: w.offsetWidth + 'x' + w.offsetHeight, ready: !document.querySelector('#nfwa-preview [data-act="jpg"]').disabled, msg: document.querySelector('#nfwa-preview .nfwa-msg').textContent }; });
        check(key + ': ' + (v || 'site') + ' view is the one-page Daily Brief, picture drawn', /Daily Brief$/.test(b.h1) && b.size === '1080x1350' && b.ready, JSON.stringify(b));
        await pg.screenshot({ path: path.join(OUT, '8 LIVE - ' + key + ' brief ' + (v || 'site') + '.png') });
        await pg.click('#nfwa-preview [data-act="close"]');
      }
      check(key + ': no script errors', errs.length === 0, errs.join(' / '));
      await pg.close();
    }
  } catch (e) { out.error = e.message; }
  finally {
    if (br) await br.close();
    await q(`DO $c$ BEGIN PERFORM set_config('nf.purge_company', '${C}', true);
      DELETE FROM public.nf_voucher_counters WHERE company_id = '${C}'; PERFORM public._nf_test_purge('${C}'); END $c$;
      delete from auth.identities where user_id in ('${users.dir.id}', '${users.site.id}'); delete from auth.users where id in ('${users.dir.id}', '${users.site.id}');`);
    out.leftover = (await q(`select (select count(*) from companies where id = '${C}') co, (select count(*) from auth.users where id in ('${users.dir.id}', '${users.site.id}')) users,
      (select count(*) from nf_members where company_id = '${C}') members`))[0];
    console.log(out.checks.join('\n')); if (out.error) console.log('ERROR', out.error); console.log('leftover', JSON.stringify(out.leftover));
  }
})();
