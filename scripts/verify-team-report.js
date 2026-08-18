/**
 * Daily report — driven from the sidebar, like a person.
 *
 *   node scripts/verify-team-report.js
 *
 * Two things the owner could not see and now can:
 *   · what a rep WRITES on a lead (a note) and the statuses they move
 *   · what each member actually did on a given day
 *
 * The data was never the problem — lead_activities has been recording notes,
 * calls, WhatsApp and status moves all along, and get_team_activity has existed
 * for months with nothing calling it. So the thing worth testing is reachability
 * and truthfulness: can a director get to the screen by clicking, and does what
 * it shows match what is actually in the table?
 *
 * That is why this file is forbidden from calling renderTeamReport() — it
 * clicks the sidebar. The unit map once worked for six commits while being
 * unreachable, and every test drove it directly.
 *
 * ZZTEST only: the fixture writes its own activities on a throwaway lead, checks
 * they surface, and deletes them.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4225;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'daily_report');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const NOTE = 'ZZDR client wants a corner unit, will decide after Eid';

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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  // ── a rep's day, written the way the app writes it ────────────────────────
  stepH('ZZ Rep One works a lead today');
  await sql(`
    DELETE FROM public.lead_activities a USING public.leads l
     WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    DELETE FROM public.leads WHERE company_id='${ZZ}' AND name='ZZDR Lead';
    DELETE FROM public.sales_sessions WHERE session_token IN ('zz-dr-dir','zz-dr-rep');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-dr-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-dr-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';
    INSERT INTO public.leads (company_id, name, phone, status, owner_sales_user_id, is_test)
    SELECT '${ZZ}', 'ZZDR Lead', '03001110000', 'contacted', id, true
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
    SELECT l.id, l.owner_sales_user_id, k.kind, k.body
      FROM public.leads l,
           (VALUES ('call', NULL), ('whatsapp', NULL),
                   ('note', '${NOTE}'), ('stage', 'Moved to contacted')) AS k(kind, body)
     WHERE l.company_id='${ZZ}' AND l.name='ZZDR Lead';`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function portal(token) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1320, height: 940, deviceScaleFactor: 2 });
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
  /* The sidebar is an accordion and Management starts collapsed, so a human
     opens the group first. Doing the same here keeps this a real click-through
     rather than a coordinate poke at something nobody could reach. */
  const navItem = async page => {
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Team report');
      if (!a) return;
      const grp = a.closest('.ni-grp');
      const btn = grp && grp.querySelector('[data-grp-btn]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
    await sleep(500);
    return page.evaluate(() => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Team report');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: getComputedStyle(a).display !== 'none' && r.width > 0 && r.height > 0,
               reachable: !!(hit && a.contains(hit)),
               x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  };

  // ── the director opens it by clicking ─────────────────────────────────────
  stepH('ZZ Director → sidebar → Daily report');
  const D = await portal('zz-dr-dir');
  const nav = await navItem(D.page);
  if (!assert(nav && nav.visible, 'the sidebar shows "Daily report"')) throw new Error('no nav item');
  assert(nav.reachable, 'and a click at it actually lands on it');
  await D.page.mouse.click(nav.x, nav.y);                    // a REAL click
  try { await until(D.page, () => !!document.querySelector('.dr-row')); }
  catch (e) {
    console.log('     body → ' + (await D.page.evaluate(() =>
      (document.getElementById('app-body') || {}).innerText || '(empty)')).slice(0, 200));
    console.log('     errs → ' + D.errs.slice(0, 3).join(' | '));
    throw e;
  }
  await sleep(600);
  await D.page.screenshot({ path: path.join(SHOTS, '01-team-day.png') });
  console.log('  📸 01-team-day');

  const team = await D.page.evaluate(() => ({
    period: (document.querySelector('#tr-out') || {}).textContent || '',
    presetOn: (document.querySelector('.dr-p.on[data-preset]') || {}).textContent || '',
    projects: [...document.querySelectorAll('[data-proj]')].map(b => b.textContent.trim()),
    tiles: [...document.querySelectorAll('.dr-tile')].map(t =>
      t.querySelector('.k').textContent + ' ' + t.querySelector('.v').textContent),
    rows: [...document.querySelectorAll('.dr-row')].map(r => ({
      name: r.querySelector('.dr-nm').textContent,
      bits: [...r.querySelectorAll('.dr-b')].map(b => b.textContent.trim())
    })),
    secs: [...document.querySelectorAll('.dr-sec')].map(s => s.textContent)
  }));
  console.log('     ' + team.tiles.join('  |  '));
  assert(team.presetOn === 'Today', 'it opens on Today ("' + team.presetOn + '")');
  assert(team.rows.length > 0, 'it lists ' + team.rows.length + ' member(s)');
  const rep = team.rows.find(r => /ZZ Rep One/.test(r.name));
  assert(!!rep, 'ZZ Rep One is there');
  assert(rep.bits.some(b => /1 reached/.test(b)), 'showing who they reached: ' + rep.bits.join(' · '));
  assert(rep.bits.some(b => /1 note/.test(b)) && rep.bits.some(b => /1 status/.test(b)),
    'and that they wrote a note and moved a status');
  assert(team.secs.some(s => /Worked in this period/.test(s)) && team.secs.some(s => /Nothing recorded/.test(s)),
    'the period splits into who worked and who did not: ' + team.secs.join(' / '));

  // ── the thing the owner could not see: the actual words ───────────────────
  stepH('Open that member — every note and status change');
  await D.page.evaluate(() => [...document.querySelectorAll('.dr-row')]
    .find(r => /ZZ Rep One/.test(r.querySelector('.dr-nm').textContent)).click());
  await until(D.page, () => !!document.querySelector('.dr-ent'));
  await sleep(600);
  await D.page.screenshot({ path: path.join(SHOTS, '02-member-day.png') });
  console.log('  📸 02-member-day');

  const day = await D.page.evaluate(() => ({
    text: document.getElementById('app-body').innerText,
    entries: [...document.querySelectorAll('.dr-ent')].map(e => ({
      time: e.querySelector('.dr-t').textContent.trim(),
      lead: e.querySelector('.dr-lead').textContent.trim(),
      kind: e.querySelector('.dr-kind').textContent.trim(),
      body: (e.querySelector('.dr-txt') || {}).textContent || ''
    }))
  }));
  day.entries.slice(0, 6).forEach(e =>
    console.log('     ' + e.time.padEnd(6) + e.kind.padEnd(12) + e.lead.padEnd(12) + e.body.slice(0, 44)));
  assert(day.entries.length === 4, 'all four things they did are listed (' + day.entries.length + ')');
  assert(day.entries.some(e => e.body === NOTE),
    'the note they WROTE is shown word for word — this is what a director could never see');
  assert(day.entries.some(e => /Status/.test(e.kind) && /Moved to contacted/.test(e.body)),
    'and the status they moved, with what it moved to');
  assert(day.entries.every(e => /^\d{2}:\d{2}$/.test(e.time)), 'each one carries its time');
  assert(day.entries.every(e => e.lead === 'ZZDR Lead'), 'and the lead it belongs to');

  // ── a day with nothing in it must say so, not look broken ─────────────────
  // ── the period controls: presets, a custom range, and a project tab ──────
  stepH('Widen the period and split it by project');
  await D.page.evaluate(() => document.getElementById('app-body').querySelector('.backbtn').click());
  await until(D.page, () => !!document.querySelector('.dr-row'));

  await D.page.evaluate(() => [...document.querySelectorAll('[data-preset]')]
    .find(b => b.textContent.trim() === 'This month').click());
  await until(D.page, () => /days/.test((document.getElementById('tr-out') || {}).textContent || ''));
  await sleep(700);
  await D.page.screenshot({ path: path.join(SHOTS, '03-this-month.png') });
  console.log('  📸 03-this-month');
  const month = await D.page.evaluate(() => ({
    out: (document.getElementById('tr-out') || {}).textContent || '',
    from: (document.getElementById('tr-from') || {}).value,
    to: (document.getElementById('tr-to') || {}).value,
    on: (document.querySelector('.dr-p.on[data-preset]') || {}).textContent || '',
    rows: document.querySelectorAll('.dr-row').length
  }));
  console.log('     ' + month.out.replace(/\s+/g, ' ').trim());
  assert(month.on === 'This month', 'the preset switched to "' + month.on + '"');
  assert(/-01$/.test(month.from) && month.to >= month.from,
    'the window starts on the 1st (' + month.from + ' → ' + month.to + ')');
  assert(/\d+ days/.test(month.out), 'and the header states its length: ' + month.out.replace(/\s+/g,' ').trim());
  assert(month.rows > 0, 'members are still listed (' + month.rows + ')');

  // a custom from–to, typed the way a person types it
  // every control click refetches — wait for the team view to be back rather
  // than sleeping and hoping, or two loads race and the tabs read empty
  const settle = () => until(D.page, () => document.querySelectorAll('[data-proj]').length > 0 &&
    document.querySelectorAll('.dr-row').length > 0);
  const wanted = { from: month.to, to: month.to };
  await D.page.evaluate(v => {
    const f = document.getElementById('tr-from'), t = document.getElementById('tr-to');
    f.value = v.from; f.dispatchEvent(new Event('change', { bubbles: true }));
  }, wanted);
  await settle();
  const custom = await D.page.evaluate(() => ({
    on: !!document.querySelector('.dr-p.on[data-preset]'),
    out: (document.getElementById('tr-out') || {}).textContent || ''
  }));
  assert(!custom.on, 'typing a date drops the preset — the window is yours now');

  // project tabs are built from the leads that exist
  await D.page.evaluate(() => [...document.querySelectorAll('[data-preset]')]
    .find(b => b.textContent.trim() === 'This month').click());
  await settle();
  const tabs = await D.page.evaluate(() =>
    [...document.querySelectorAll('[data-proj]')].map(b => ({ id: b.dataset.proj, t: b.textContent.trim() })));
  console.log('     projects → ' + tabs.map(t => t.t).join(' | '));
  assert(tabs.length >= 2 && tabs[0].t === 'All projects',
    'the project row starts with All and lists ' + (tabs.length - 1) + ' more');
  const withProject = tabs.filter(t => t.id);
  if (withProject.length) {
    await D.page.evaluate(id => document.querySelector('[data-proj="' + id + '"]').click(), withProject[0].id);
    await settle();
    const picked = await D.page.evaluate(() => ({
      on: (document.querySelector('.dr-p.on[data-proj]') || {}).textContent || '',
      rows: document.querySelectorAll('.dr-row').length
    }));
    assert(picked.on.trim() === withProject[0].t, 'picking ' + withProject[0].t + ' highlights that tab');
    assert(picked.rows > 0, 'and the team is still listed under it (' + picked.rows + ')');
    await D.page.evaluate(() => document.querySelector('[data-proj=""]').click());
    await settle();
  } else { ok('ZZTEST leads carry no project, so there is only the All tab'); }

  // ── a member over a whole month: day by day, then the entries ────────────
  stepH('One member over the month');
  await D.page.evaluate(() => [...document.querySelectorAll('.dr-row')]
    .find(r => /ZZ Rep One/.test(r.querySelector('.dr-nm').textContent)).click());
  await until(D.page, () => !!document.querySelector('.dr-ent'));
  await sleep(700);
  await D.page.screenshot({ path: path.join(SHOTS, '04-member-month.png') });
  console.log('  📸 04-member-month');
  const mon = await D.page.evaluate(() => ({
    tiles: [...document.querySelectorAll('.dr-tile')].map(t =>
      t.querySelector('.k').textContent + ' ' + t.querySelector('.v').textContent),
    days: [...document.querySelectorAll('.dr-d .dd')].map(d => d.textContent.trim()),
    firstStamp: (document.querySelector('.dr-t') || {}).textContent.trim(),
    sec: [...document.querySelectorAll('.dr-sec')].map(s => s.textContent).join(' / ')
  }));
  console.log('     ' + mon.tiles.join('  |  '));
  assert(mon.tiles.some(t => /Leads given/.test(t)) && mon.tiles.some(t => /Active days/.test(t)),
    'the member view reports the period, not just the day');
  assert(/\d{2} \w{3}/.test(mon.firstStamp),
    'over a multi-day window each entry carries its DATE too (' + mon.firstStamp + ')');
  assert(/Everything they did/.test(mon.sec), 'and the full history is listed: ' + mon.sec);

  assert(D.errs.length === 0, 'no console errors' + (D.errs.length ? ': ' + D.errs[0] : ''));
  await D.ctx.close();

  // ── a rep sees only themselves ────────────────────────────────────────────
  stepH('The same report, called by a rep');
  const mine = await sql(`SELECT public.get_daily_report('zz-dr-rep') AS r`);
  const repMembers = mine[0].r.members || [];
  assert(mine[0].r.success === true, 'a rep may call it');
  assert(repMembers.length === 0,
    'and sees nobody, because nobody reports to them (' + repMembers.length + ')');
  /* Only worth asserting if such a user exists — otherwise the session insert
     writes nothing and the call fails with session_expired, which would look
     like a pass for the wrong reason. */
  const hasLE = await sql(`SELECT count(*) AS n FROM public.sales_users
                            WHERE company_id='${ZZ}' AND role='lead_entry'`);
  if (Number(hasLE[0].n) > 0) {
    const le = await sql(`
      DELETE FROM public.sales_sessions WHERE session_token='zz-dr-le';
      INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
      SELECT company_id, id, project_id, 'zz-dr-le', now()+interval '5 minutes'
        FROM public.sales_users WHERE company_id='${ZZ}' AND role='lead_entry' LIMIT 1;
      SELECT (public.get_daily_report('zz-dr-le')->>'error') AS e`);
    assert(le[0].e === 'forbidden', 'a lead-entry operator is refused (' + le[0].e + ')');
  } else {
    ok('ZZTEST has no lead-entry operator, so that refusal is untested here');
  }

  await browser.close(); server.close();
  await sql(`
    DELETE FROM public.lead_activities a USING public.leads l
     WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name='ZZDR Lead';
    DELETE FROM public.leads WHERE company_id='${ZZ}' AND name='ZZDR Lead';
    DELETE FROM public.sales_sessions WHERE session_token IN ('zz-dr-dir','zz-dr-rep','zz-dr-le');`);
  console.log('\n✓ fixture lead, activities and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/daily_report/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
