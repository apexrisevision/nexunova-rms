/**
 * Alerts — the lead asking for the person holding it.
 *
 *   node scripts/verify-lead-alerts.js
 *
 * What has to be true, and why each one is here:
 *
 *   · handing leads over stops being silent. assign_leads_bulk wrote the
 *     assignment, the activity, and told nobody — which is how 211 leads reached
 *     six people this month without one notification.
 *   · a lead with no follow-up date can still raise an alert. The old engine's
 *     first line was `WHERE next_follow_up_at IS NOT NULL`, so a lead that was
 *     given and never touched could never be due and was never mentioned.
 *   · ONE alert per kind per day, counting the leads. Three unopened leads make
 *     one row that says three — not three rows. A wall of notifications is the
 *     thing people learn to ignore, so the anti-flood rule is tested, not hoped.
 *   · the second sweep of the same day adds nothing.
 *   · a member sees their own alerts and nobody else's.
 *   · the screen is reached by CLICKING THE SIDEBAR, and the badge clears once
 *     it has actually been read.
 *
 * ZZTEST only — the one tenant with the engine switched on. Every row this
 * creates is deleted at the end.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4227;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'alerts');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';

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
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 400)))); });
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

/* Rep TWO is the subject: Rep One is blocked by the Phase-2 follow-up engine in
   this tenant, so a bulk assign to them would be refused for a reason that has
   nothing to do with alerts. */
const CLEAN = `
  DELETE FROM public.lead_alerts a USING public.sales_users su
   WHERE a.sales_user_id=su.id AND su.company_id='${ZZ}' AND su.full_name='ZZ Rep Two';
  DELETE FROM public.lead_alerts WHERE dedup_key LIKE 'ZZAL%';
  DELETE FROM public.lead_activities a USING public.leads l
   WHERE a.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZAL%';
  DELETE FROM public.lead_views v USING public.leads l
   WHERE v.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZAL%';
  DELETE FROM public.lead_assignments la USING public.leads l
   WHERE la.lead_id=l.id AND l.company_id='${ZZ}' AND l.name LIKE 'ZZAL%';
  DELETE FROM public.reminder_deliveries WHERE dedup_key LIKE 'alert:%'
     AND company_id='${ZZ}' AND created_at > now()-interval '2 hours';
  DELETE FROM public.leads WHERE company_id='${ZZ}' AND name LIKE 'ZZAL%';
  DELETE FROM public.sales_sessions WHERE session_token IN ('zz-al-dir','zz-al-rep');`;

const alertsOf = async who => sql(`
  SELECT a.kind, a.title, a.n, a.seen_at IS NOT NULL AS seen
    FROM public.lead_alerts a JOIN public.sales_users su ON su.id=a.sales_user_id
   WHERE su.company_id='${ZZ}' AND su.full_name='${who}'
   ORDER BY a.created_at`);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);
  const base = await sql(`SELECT count(*) n FROM public.lead_alerts WHERE company_id <> '${ZZ}'`);
  process.env.ZZ_BASELINE = String(base[0].n);
  const st = await sql(`SELECT enabled FROM public.alert_settings WHERE company_id='${ZZ}'`);
  assert(st.length && st[0].enabled === true, 'and the engine is switched on for it');

  // ══ leads that no old engine could ever have mentioned ═══════════════════
  stepH('Three leads given yesterday and never opened, one opened and never rung');
  await sql(`${CLEAN}
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-al-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-al-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep Two';

    -- NOTE: not one of these has a next_follow_up_at. That is the point.
    INSERT INTO public.leads (company_id, name, phone, status, owner_sales_user_id,
                              assigned_at, last_activity_at, is_test)
    SELECT '${ZZ}', v.n, '0300333000'||v.i, 'new', su.id,
           now()-interval '30 hours', now()-interval '30 hours', true
      FROM public.sales_users su,
           (VALUES ('ZZAL Unopened One',1),('ZZAL Unopened Two',2),
                   ('ZZAL Unopened Three',3),('ZZAL Silent',4),
                   ('ZZAL Rung From List',5)) AS v(n,i)
     WHERE su.company_id='${ZZ}' AND su.full_name='ZZ Rep Two';

    -- the fourth one they DID open, sixty hours ago, and never rang
    INSERT INTO public.lead_views (lead_id, sales_user_id, seen_at)
    SELECT l.id, l.owner_sales_user_id, now()-interval '60 hours'
      FROM public.leads l WHERE l.company_id='${ZZ}' AND l.name='ZZAL Silent';

    -- IQRA's case: rung and messaged straight from the Leads list, so there is
    -- real work on it and NO view row. It must not be called \"not opened\".
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, created_at)
    SELECT l.id, l.owner_sales_user_id, k.kind, now()-interval '20 hours'
      FROM public.leads l, (VALUES ('call'),('whatsapp')) AS k(kind)
     WHERE l.company_id='${ZZ}' AND l.name='ZZAL Rung From List';

    -- two more the director still holds, to hand over later in this test
    INSERT INTO public.leads (company_id, name, phone, status, owner_sales_user_id, is_test)
    SELECT '${ZZ}', v.n, '0300444000'||v.i, 'new', su.id, true
      FROM public.sales_users su, (VALUES ('ZZAL ToGive One',1),('ZZAL ToGive Two',2)) AS v(n,i)
     WHERE su.company_id='${ZZ}' AND su.full_name='ZZ Director';`);
  ok('seeded, and not one of them has a follow-up date — the old engine was blind to all of them');
  const noView = await sql(`SELECT count(*) n FROM public.lead_views v JOIN public.leads l ON l.id=v.lead_id
     WHERE l.company_id='${ZZ}' AND l.name='ZZAL Rung From List'`);
  assert(Number(noView[0].n) === 0,
    'and one of them was rung from the list with no view row at all — the exact case IQRA hit');

  stepH('The sweep runs');
  const run1 = await sql(`SELECT public.cron_lead_alerts() AS r`);
  assert(run1[0].r.success === true, 'cron_lead_alerts ran');
  let as = await alertsOf('ZZ Rep Two');
  console.log('     ' + as.map(a => a.kind + ' ×' + a.n + ' "' + a.title + '"').join('  |  '));
  assert(as.length === 2,
    'two alerts for the rep — one per kind, not one per lead (' + as.length + ')');

  const un = as.filter(a => a.kind === 'not_opened')[0];
  assert(un && un.n === 3, 'the unopened three are counted into ONE alert, n=' + (un ? un.n : '—'));
  /* The fourth lead was rung and never opened. Counting it here is what IQRA
     complained about: being told to do a thing she had already done. */
  assert(un && un.n === 3 && !/4 leads/.test(un.title),
    'and the one she RANG is not among them — working a lead is opening it');
  const untouched = await sql(`SELECT public._lead_untouched(l.id, l.owner_sales_user_id) u
     FROM public.leads l WHERE l.company_id='${ZZ}' AND l.name='ZZAL Rung From List'`);
  assert(untouched[0].u === false,
    'the server agrees: a lead you have called is not untouched');
  assert(un && /3 leads you have not opened yet/.test(un.title),
    'and it says so in words: "' + (un ? un.title : '') + '"');
  /* A count alone leaves them staring at a list. The alert has to name a first
     move, which is the third thing that was asked for: who should I call. */
  const unBody = await sql("SELECT body FROM public.lead_alerts WHERE kind='not_opened'" +
    " AND dedup_key LIKE 'notopen:%' ORDER BY created_at DESC LIMIT 1");
  assert(unBody.length && /Start with ZZAL Unopened/.test(unBody[0].body),
    'and names which one to start with: "' + (unBody[0]||{}).body + '"');
  const nc = as.filter(a => a.kind === 'no_contact')[0];
  assert(nc && nc.n === 1 && /opened this lead but never called/i.test(nc.title),
    'the opened-and-silent one names the lead instead of counting: "' + (nc ? nc.title : '') + '"');

  stepH('The same sweep, an hour later');
  const run2 = await sql(`SELECT public.cron_lead_alerts() AS r`);
  const after = await alertsOf('ZZ Rep Two');
  assert(after.length === 2 && run2[0].r.raised === 0,
    'raises nothing new — an alert repeated every hour is how people learn to ignore alerts');

  // ══ handing leads over ═══════════════════════════════════════════════════
  stepH('The director hands two leads over');
  const giv = await sql(`
    SELECT public.assign_leads_bulk('zz-al-dir',
      ARRAY(SELECT id FROM public.leads WHERE company_id='${ZZ}' AND name LIKE 'ZZAL ToGive%'),
      (SELECT id FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep Two')) AS r`);
  assert(giv[0].r.success === true && giv[0].r.assigned === 2,
    'both leads moved (' + JSON.stringify(giv[0].r.assigned) + ')');
  as = await alertsOf('ZZ Rep Two');
  const ass = as.filter(a => a.kind === 'assigned')[0];
  assert(!!ass, 'and the person receiving them was told — bulk assign is no longer silent');
  assert(ass && ass.n === 2 && /2 new leads are yours/.test(ass.title),
    'once for the batch, not once per lead: "' + (ass ? ass.title : '') + '"');

  // ══ the screen ═══════════════════════════════════════════════════════════
  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) { console.log('  ⚠ no Chrome found — skipping the browser half'); server.close(); process.exit(FAIL ? 1 : 0); }
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
    await sleep(1800);
    try { await until(page, () => { const b = document.getElementById('app-body');
      return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); }); }
    catch (e) { await sleep(1500); }
    await page.evaluate(() => ['loc-bar','pwa-bar','push-bar']
      .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
    return { ctx, page, errs };
  }
  const clickNav = async (page, label) => {
    await page.evaluate(lb => {
      const a = [...document.querySelectorAll('.sb .ni')]
        .find(x => (x.querySelector('.ni-lb') || {}).textContent === lb);
      if (!a) return;
      const grp = a.closest('.ni-grp'), btn = grp && grp.querySelector('[data-grp-btn]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    }, label);
    await sleep(350);
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
    await sleep(1500);
    return true;
  };

  stepH('The rep opens the portal');
  const R = await portal('zz-al-rep');
  // the badge is filled at boot, before anybody navigates anywhere
  await until(R.page, () => {
    const b = document.getElementById('nav-badge-alerts');
    return !!b && b.textContent.trim() !== '';
  }, 15000).catch(() => {});
  const badge = await R.page.evaluate(() => {
    const b = document.getElementById('nav-badge-alerts');
    return b ? { txt: b.textContent.trim(), shown: b.classList.contains('show') } : null;
  });
  console.log('     badge   → ' + JSON.stringify(badge));
  assert(badge && badge.shown && badge.txt === '3',
    'the sidebar badge says 3 before they go anywhere — a count nobody can see is not an alert');

  assert(await clickNav(R.page, 'Alerts'), 'the Alerts item is in the sidebar and clickable');
  await until(R.page, () => !!document.querySelector('.al-a'), 20000).catch(() => {});
  const shown = await R.page.evaluate(() => [...document.querySelectorAll('.al-a')].map(a => ({
    t: (a.querySelector('.al-t') || {}).textContent,
    x: (a.querySelector('.al-x') || {}).textContent || '',
    dot: !!a.querySelector('.al-dot')
  })));
  console.log('     ' + shown.map(s => '"' + s.t + '"').join('  |  '));
  assert(shown.length === 3, 'all three alerts are on the screen (' + shown.length + ')');
  assert(shown.some(s => /2 new leads are yours/.test(s.t)),
    'including the two the director just handed over');
  assert(shown.some(s => /3 leads you have not opened/.test(s.t)),
    'and the three nobody opened');
  assert(shown.every(s => s.dot), 'each one is marked unread until it has been looked at');
  await R.page.screenshot({ path: path.join(SHOTS, '01-alerts.png'), fullPage: true });

  stepH('Reading them is what clears them');
  await sleep(2200);   // the screen marks them seen a beat after painting, on purpose
  await R.page.evaluate(() => window.AlertBell && window.AlertBell.refresh());
  await sleep(900);
  const cleared = await R.page.evaluate(() => {
    const b = document.getElementById('nav-badge-alerts');
    return b ? { txt: b.textContent.trim(), shown: b.classList.contains('show') } : null;
  });
  assert(cleared && (!cleared.shown || cleared.txt === ''),
    'the badge is gone once they have been read');
  const seen = await alertsOf('ZZ Rep Two');
  assert(seen.every(a => a.seen), 'and the server agrees — every one carries the time it was read');
  assert(R.errs.length === 0, 'no console errors' + (R.errs.length ? ': ' + R.errs[0] : ''));
  await R.ctx.close();

  // ══ nobody else's ════════════════════════════════════════════════════════
  stepH('An inbox is your own');
  const mine = await sql(`SELECT public.get_my_alerts('zz-al-rep', 100) AS r`);
  const titles = (mine[0].r.alerts || []).map(a => a.title);
  const others = await sql(`
    SELECT count(*) n FROM public.lead_alerts a JOIN public.sales_users su ON su.id=a.sales_user_id
     WHERE su.company_id='${ZZ}' AND su.full_name <> 'ZZ Rep Two'`);
  assert(titles.length === 3, 'the rep is handed exactly their own three');
  assert(Number(others[0].n) > 0,
    'while ' + others[0].n + ' alerts belonging to other people exist in the same tenant');
  const leaked = await sql(`
    SELECT count(*) n FROM public.lead_alerts a JOIN public.sales_users su ON su.id=a.sales_user_id
     WHERE su.full_name='ZZ Rep One' AND a.title = ANY(ARRAY[${titles.map(t => `'${String(t).replace(/'/g, "''")}'`).join(',') || "''"}])`);
  assert(Number(leaked[0].n) === 0, 'and not one of them is somebody else\'s');
  const dead = await sql(`SELECT public.get_my_alerts('no-such-token') AS r`);
  assert(dead[0].r.success === false && dead[0].r.error === 'session_expired',
    'an unknown token gets nothing');

  // ══ every other company is still off ═════════════════════════════════════
  stepH('Nobody else has been switched on');
  const live = await sql(`
    SELECT count(*) n FROM public.lead_alerts WHERE company_id <> '${ZZ}'`);
  /* Awami Market was switched on deliberately on 2026-08-19, so 'nobody else is
     enabled' is no longer the property worth guarding. What still matters is that
     this harness never writes into a live tenant: the fixtures it made are ZZTEST's
     and the count for every other company is unchanged by running it. */
  assert(Number(live[0].n) === Number(process.env.ZZ_BASELINE || live[0].n),
    'other tenants hold ' + live[0].n + ' alerts, none of them written by this run');
  const strays = await sql(`SELECT count(*) n FROM public.lead_alerts
     WHERE company_id <> '${ZZ}' AND dedup_key LIKE '%ZZ%'`);
  assert(Number(strays[0].n) === 0,
    'and not one fixture alert leaked out of the scratch tenant');

  await browser.close(); server.close();
  await sql(CLEAN);
  console.log('\n✓ fixture leads, alerts and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/alerts/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
