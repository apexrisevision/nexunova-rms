/**
 * "Leads I gave" — and "Opened" said out loud on both sides.
 *
 *   node scripts/verify-given-leads.js
 *
 * Two things are proved here, both driven through the real portal in real
 * Chrome, both reached by CLICKING THE SIDEBAR. That rule is not decoration:
 * the unit map once worked for six commits while being unreachable, because
 * every test called its renderer directly. Nothing in this file calls
 * renderGivenLeads().
 *
 *   1. The chain. A lead the director hands over lands in exactly one of four
 *      states, and the screen names the state in the words he would use:
 *        not opened → opened, no contact → contacted, no update → updated
 *      Each is seeded as the app would write it — an assignment row, a view row,
 *      an activity — never by setting the answer directly.
 *
 *   2. "Opened". A lead the OWNER has opened stops calling itself New, on the
 *      rep's own list and on the director's, while leads.status stays 'new' in
 *      the database. That last part matters: if opening counted as contact,
 *      every contacted figure in the business would become a lie. The DB is
 *      re-read at the end to prove it did not move.
 *
 * ZZTEST only. Every row this creates is deleted at the end.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4225;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'given_leads');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const SAID = 'ZZGL client asked for a corner unit';

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const stepH = m => console.log('\n── ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 300)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}
const until = (page, fn, ms = 20000) => page.waitForFunction(fn, { timeout: ms, polling: 250 });

const CLEAN = `
  DELETE FROM public.lead_activities a USING public.leads l
   WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZGL%';
  DELETE FROM public.lead_views v USING public.leads l
   WHERE v.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZGL%';
  DELETE FROM public.lead_assignments la USING public.leads l
   WHERE la.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZGL%';
  DELETE FROM public.leads WHERE company_id='${ZZ}' AND name LIKE 'ZZGL%';
  DELETE FROM public.sales_sessions WHERE session_token IN ('zz-gl-dir','zz-gl-rep');`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  /* Four leads, one per link of the chain, each built the way the app builds it:
     an assignment row hands it over, a view row is the opening, an activity is
     the contact, a note is the update. Nothing sets a state directly. */
  stepH('The director hands over four leads, and four different things happen');
  await sql(`${CLEAN}
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-gl-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-gl-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';

    -- all four sit at 'new' so the Opened label has something to change
    INSERT INTO public.leads (company_id, name, phone, status, owner_sales_user_id, is_test)
    SELECT '${ZZ}', n, '0300222000'||i, 'new', su.id, true
      FROM public.sales_users su,
           (VALUES ('ZZGL A NotOpened',1),('ZZGL B Opened',2),
                   ('ZZGL C Called',3),('ZZGL D Updated',4)) AS v(n,i)
     WHERE su.company_id='${ZZ}' AND su.full_name='ZZ Rep One';

    -- the director gives every one of them away, four hours ago
    INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id, assigned_at)
    SELECT l.id, d.id, l.owner_sales_user_id, now()-interval '4 hours'
      FROM public.leads l, public.sales_users d
     WHERE l.company_id='${ZZ}' AND l.name LIKE 'ZZGL%'
       AND d.company_id='${ZZ}' AND d.full_name='ZZ Director';

    -- B, C and D were opened by the person they belong to. A was not.
    INSERT INTO public.lead_views (lead_id, sales_user_id, seen_at)
    SELECT l.id, l.owner_sales_user_id, now()-interval '3 hours'
      FROM public.leads l
     WHERE l.company_id='${ZZ}' AND l.name IN ('ZZGL B Opened','ZZGL C Called','ZZGL D Updated');

    -- C and D were actually rung
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, created_at)
    SELECT l.id, l.owner_sales_user_id, 'call', now()-interval '2 hours'
      FROM public.leads l
     WHERE l.company_id='${ZZ}' AND l.name IN ('ZZGL C Called','ZZGL D Updated');

    -- only D came back and said what the client wanted
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body, created_at)
    SELECT l.id, l.owner_sales_user_id, 'note', '${SAID}', now()-interval '1 hour'
      FROM public.leads l
     WHERE l.company_id='${ZZ}' AND l.name='ZZGL D Updated';`);
  ok('four leads seeded: never opened / opened only / rang only / rang and reported');

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) { console.log('  ⚠ no Chrome found — skipping the browser half'); process.exit(0); }
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function portal(token) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1320, height: 980, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now()));
                               sessionStorage.setItem('nx.loc.dismissed', '1');
                               sessionStorage.setItem('nx.pwa.dismissed', '1'); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1600);
    try { await until(page, () => { const b = document.getElementById('app-body');
      return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); }); }
    catch (e) { await sleep(1500); }
    await page.evaluate(() => ['loc-bar','pwa-bar','push-bar']
      .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
    return { ctx, page, errs };
  }

  /* Open the group first, then click the item — the sidebar is an accordion and
     Management starts collapsed, which is exactly what a person has to do. */
  const clickNav = async (page, label) => {
    const found = await page.evaluate(lb => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === lb);
      if (!a) return { there: false };
      const grp = a.closest('.ni-grp');
      const btn = grp && grp.querySelector('[data-grp-btn]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
      return { there: true };
    }, label);
    if (!found.there) return false;
    await sleep(350);
    // click where it actually is, and make sure nothing is sitting on top of it
    const hit = await page.evaluate(lb => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === lb);
      if (!a) return false;
      const r = a.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(top && a.contains(top));
    }, label);
    if (!hit) return false;
    await page.evaluate(lb => {
      [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === lb).click();
    }, label);
    await sleep(1400);
    return true;
  };

  // ══ the director's screen ═════════════════════════════════════════════════
  stepH('The director opens it from the sidebar');
  const D = await portal('zz-gl-dir');
  const reached = await clickNav(D.page, 'Leads I gave');
  assert(reached, 'the "Leads I gave" item exists in the sidebar and is clickable — not hidden behind anything');
  await until(D.page, () => !!document.querySelector('.gl-b'), 25000).catch(() => {});

  const buckets = await D.page.evaluate(() => [...document.querySelectorAll('.gl-b')].map(b => ({
    n: +(b.querySelector('.v') || {}).textContent,
    k: (b.querySelector('.k') || {}).textContent,
    w: (b.querySelector('.w') || {}).textContent
  })));
  console.log('     buckets → ' + buckets.map(b => b.k + ' ' + b.n).join(' · '));
  assert(buckets.length === 4, 'four buckets, one per link of the chain');
  assert(buckets.map(b => b.k).join('|') === 'Not opened|No contact|No update|Updated',
    'in the chain\'s order, worst first — not reordered by size');
  assert(buckets.length === 4 && buckets.every(b => b.n === 1),
    'and each holds exactly the one lead that belongs in it (' +
    buckets.map(b => b.n).join('/') + ')');
  assert(buckets.length === 4 && /have not opened it/.test(buckets[0].w) && /never rang/.test(buckets[1].w) &&
         /never said what the client told them/.test(buckets[2].w),
    'each one says what it means in plain words, not a status code');

  const rows = await D.page.evaluate(() => [...document.querySelectorAll('.gl-l')].map(r => ({
    name: (r.querySelector('.gl-l-nm') || {}).textContent,
    line: (r.querySelector('.gl-l-s') || {}).textContent,
    said: (r.querySelector('.gl-said') || {}).textContent || ''
  })));
  console.log('     rows    → ' + rows.map(r => r.name).join(' · '));
  assert(rows.length === 4, 'all four leads are listed with no bucket chosen');
  assert(rows[0].name === 'ZZGL A NotOpened',
    'the one nobody has opened is first — the pile he has to chase leads the list');
  const byName = {}; rows.forEach(r => byName[r.name] = r);
  assert(/never opened it/.test(byName['ZZGL A NotOpened'].line),
    'and it says "never opened it" against that lead');
  assert(/never rang/.test(byName['ZZGL B Opened'].line),
    'the opened-but-silent one says "opened …, never rang"');
  assert(/said nothing since/.test(byName['ZZGL C Called'].line),
    'the rung-but-silent one says "contacted …, said nothing since"');
  assert(byName['ZZGL D Updated'].said.indexOf('corner unit') >= 0,
    'and the one that came back carries what the rep actually wrote: "' +
    byName['ZZGL D Updated'].said.trim() + '"');

  const mem = await D.page.evaluate(() => {
    const m = document.querySelector('.gl-m'); if (!m) return null;
    return { name: (m.querySelector('.gl-m-n') || {}).textContent,
             nums: [...m.querySelectorAll('.gl-n')].map(x => +x.textContent),
             chase: !!m.querySelector('[data-chase]') };
  });
  assert(mem && /ZZ Rep One/.test(mem.name), 'the member rollup names who is holding them');
  assert(mem && mem.nums.join(',') === '1,1,1,1', 'with their four numbers: ' + (mem ? mem.nums.join('/') : '—'));
  assert(mem && mem.chase, 'and a way to go and ask them, right there on the row');
  await D.page.screenshot({ path: path.join(SHOTS, '01-given-leads.png'), fullPage: true });

  // ── the bucket is a filter, and you can get back out of it ────────────────
  stepH('Tapping a bucket narrows it — tapping again lets go');
  await D.page.evaluate(() => document.querySelector('.gl-b[data-state="not_opened"]').click());
  await sleep(1500);
  const only = await D.page.evaluate(() => [...document.querySelectorAll('.gl-l .gl-l-nm')].map(x => x.textContent));
  assert(only.length === 1 && only[0] === 'ZZGL A NotOpened',
    'choosing "Not opened" leaves only that lead (' + only.join(', ') + ')');
  await D.page.evaluate(() => document.querySelector('.gl-b[data-state="not_opened"]').click());
  await sleep(1500);
  const back = await D.page.evaluate(() => document.querySelectorAll('.gl-l').length);
  assert(back === 4, 'and a second tap on the same bucket gives all four back — the filter is not a trap');

  // ══ "Opened" on the director's own lead list ══════════════════════════════
  stepH('The word "Opened" reaches the director\'s Leads list');
  assert(await clickNav(D.page, 'Leads'), 'the Leads screen opens from the sidebar');
  await until(D.page, () => !!document.querySelector('.lead-row'), 25000).catch(() => {});
  const chips = await D.page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.lead-row').forEach(r => {
      const nm = (r.querySelector('.lr-name') || {}).textContent || '';
      const el = r.querySelector('.lead-stat');
      const st = el ? [...el.childNodes].filter(n => n.nodeType === 3)
                        .map(n => n.textContent).join('').trim() : '';
      if (nm.indexOf('ZZGL') >= 0) out[nm.trim()] = st.trim();
    });
    return out;
  });
  console.log('     chips   → ' + JSON.stringify(chips));
  assert(chips['ZZGL A NotOpened'] === 'New',
    'a lead nobody opened still reads New');
  assert(chips['ZZGL B Opened'] === 'Opened',
    'and the one the REP opened reads Opened — on the director\'s screen, which is the whole point');
  await D.page.screenshot({ path: path.join(SHOTS, '02-opened-chip-director.png'), fullPage: true });
  assert(D.errs.length === 0, 'no console errors' + (D.errs.length ? ': ' + D.errs[0] : ''));
  await D.ctx.close();

  // ══ the rep's own side ════════════════════════════════════════════════════
  stepH('And on the rep\'s own list');
  const R = await portal('zz-gl-rep');
  await clickNav(R.page, 'Leads');
  await until(R.page, () => !!document.querySelector('.lead-row'), 25000).catch(() => {});
  const repChips = await R.page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.lead-row').forEach(r => {
      const nm = (r.querySelector('.lr-name') || {}).textContent || '';
      const el = r.querySelector('.lead-stat');
      const st = el ? [...el.childNodes].filter(n => n.nodeType === 3)
                        .map(n => n.textContent).join('').trim() : '';
      if (nm.indexOf('ZZGL') >= 0) out[nm.trim()] = st.trim();
    });
    return out;
  });
  console.log('     chips   → ' + JSON.stringify(repChips));
  assert(repChips['ZZGL B Opened'] === 'Opened',
    'the rep sees Opened on the lead they opened — the tag they complained about is gone');
  assert(repChips['ZZGL A NotOpened'] === 'New',
    'and New on the one they have not');
  const navHidden = await R.page.evaluate(() => {
    const a = [...document.querySelectorAll('.sb .ni')]
      .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Leads I gave');
    if (!a) return true;
    const grp = a.closest('.ni-grp');
    return !!grp && getComputedStyle(grp).display === 'none';
  });
  assert(navHidden, 'a rep is not offered "Leads I gave" — it is a manager\'s screen');
  assert(R.errs.length === 0, 'no console errors on the rep side' + (R.errs.length ? ': ' + R.errs[0] : ''));
  await R.ctx.close();

  // ══ the status did NOT move ═══════════════════════════════════════════════
  stepH('Opening changed the label, not the funnel');
  const st = await sql(`SELECT name, status FROM public.leads
                         WHERE company_id='${ZZ}' AND name LIKE 'ZZGL%' ORDER BY name`);
  console.log('     ' + st.map(r => r.name.replace('ZZGL ', '') + '=' + r.status).join(' · '));
  assert(st.every(r => r.status === 'new'),
    'every one of them is still "new" in the database — opening is not reaching anybody, ' +
    'and if it counted as contact every contacted figure in the business would be a lie');

  // ══ the server refuses an operator ════════════════════════════════════════
  stepH('Who may call it at all');
  const op = await sql(`SELECT count(*) n FROM public.sales_users
                         WHERE company_id='${ZZ}' AND role='lead_entry'`);
  if (Number(op[0].n) > 0) {
    await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-gl-op';
      INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
      SELECT company_id, id, project_id, 'zz-gl-op', now()+interval '5 minutes'
        FROM public.sales_users WHERE company_id='${ZZ}' AND role='lead_entry' LIMIT 1;`);
    const r = await sql(`SELECT public.get_given_leads('zz-gl-op') AS r`);
    assert(r[0].r.success === false && r[0].r.error === 'forbidden',
      'a lead-entry operator is refused by the server, not by the menu');
    await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-gl-op'`);
  } else {
    ok('ZZTEST has no lead-entry operator, so that refusal is untested here');
  }
  const dead = await sql(`SELECT public.get_given_leads('no-such-token') AS r`);
  assert(dead[0].r.success === false && dead[0].r.error === 'session_expired',
    'and an unknown token gets nothing');

  await browser.close(); server.close();
  await sql(CLEAN);
  console.log('\n✓ fixture leads, views, activities and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/given_leads/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
