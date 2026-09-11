/**
 * Share link — the screen a director actually uses, driven the way a human does.
 *
 *   node scripts/verify-share-link-screen.js
 *
 * The lesson this harness is built on: proving a screen works is not proving
 * anyone can open it. verify-unitmap-nav.js exists because the unit map worked
 * for six commits while being unreachable — every test drove it by calling
 * renderUnitMap() directly. So this file is FORBIDDEN from calling
 * renderShareLinks(); it clicks the sidebar item, like a person.
 *
 * What it proves end to end: a rep cannot see or reach the screen, a director
 * can; a link made here really opens the public tower with no login; "New link"
 * retires the previous one for that project and leaves other projects alone;
 * "Turn off" kills it; and the token is never on screen or in the DOM except in
 * the one moment after it is minted.
 *
 * ZZTEST only. Every link this creates is deleted at the end.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4223;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'share_link');
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
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 300)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      let url = decodeURIComponent(q.url.split('?')[0]);
      if (/^\/a\/[A-Za-z0-9_-]+$/.test(url)) url = '/availability.html';   // the vercel rewrite
      /* the browser asks for this of its own accord and the site does not have
         one — it declares /assets/favicon-64.png instead. Answering "nothing
         here" rather than "not found" keeps a harness artefact out of the
         console-error count, without hiding anything the page really asked for. */
      if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
      const p = path.join(ROOT, url);
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

  await sql(`DELETE FROM public.availability_links WHERE company_id='${ZZ}';
    DELETE FROM public.sales_sessions WHERE session_token IN ('zz-share-dir','zz-share-rep');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-share-dir', now()+interval '40 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-share-rep', now()+interval '40 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
    args: ['--no-sandbox'] });

  async function portal(token) {
    const ctx = await browser.createBrowserContext();
    await ctx.overridePermissions(`http://127.0.0.1:${PORT}`, ['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    await page.setViewport({ width: 1320, height: 940, deviceScaleFactor: 2 });
    const errs = [];
    page.on('dialog', async d => { await d.accept(); });        // confirm() → yes
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    /* THE PORTAL HANDS ITSELF TO THE INSTALLED-APP HUB ON A PLAIN LAUNCH, and
       under a driver that turns into a 404: the hop pushes /hub onto the URL, so
       the reload below asked the harness for sales-portal.html/hub and got
       nothing. Nothing on this screen had loaded for a while because of it, and
       the rep check passed anyway — a sidebar with no Share link in it looks
       exactly like a sidebar that never rendered, which is why the run only
       fell over one step later. 'nx.hub.bounce' is the page's own guard against
       hopping twice; setting it makes every load here behave like the second
       one, the same way verify-reserve-desk.js does. */
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now()));
                               sessionStorage.setItem('nx.hub.bounce', '1');
                               sessionStorage.setItem('nx.loc.dismissed', '1');
                               sessionStorage.setItem('nx.pwa.dismissed', '1'); }, token);
    /* ERRORS ARE COUNTED FROM HERE, not from the load above. That first load is
       deliberately unprepared — it exists only to reach the page's storage — and
       it is the one that hops to the hub and 404s on the way. Counting its noise
       would mean the run either fails for a thing the harness caused or, worse,
       gets taught to ignore 404s in general. */
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE, { waitUntil: 'networkidle2' });
    await sleep(1600);
    try {
      await until(page, () => { const b = document.getElementById('app-body');
                                return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); });
    } catch (e) { await sleep(1500); }
    await page.evaluate(() => ['loc-bar', 'pwa-bar', 'push-bar']
      .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
    return { ctx, page, errs };
  }
  // the sidebar item, found by its label — never by calling the renderer
  const navItem = page => page.evaluate(() => {
    const a = [...document.querySelectorAll('.sb .ni')]
      .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Share link');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { visible: getComputedStyle(a).display !== 'none' && r.width > 0 && r.height > 0,
             x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  // ══ a rep must not even see the door ═══════════════════════════════════════
  stepH('ZZ Rep One opens the portal');
  const R = await portal('zz-share-rep');
  /* AN ABSENCE PROVES NOTHING UNTIL THE THING IT IS ABSENT FROM IS THERE. This
     check passed for the whole time the page was not loading at all, because a
     sidebar that never rendered has no Share link in it either. So the sidebar
     is counted first, and only then is the missing item worth asserting. */
  const repSide = await R.page.evaluate(() => document.querySelectorAll('.sb .ni').length);
  assert(repSide > 0, 'the rep\'s sidebar actually rendered (' + repSide + ' items)');
  const repNav = await navItem(R.page);
  assert(!repNav || !repNav.visible, 'a rep has no "Share link" in the sidebar');
  const repTry = await R.page.evaluate(async () => {
    const r = await sb.rpc('list_availability_links', { p_session_token: TOKEN });
    return r.data;
  });
  assert(repTry && repTry.success === false && repTry.error === 'not_allowed',
    'and the RPC turns a rep away too (' + (repTry || {}).error + ')');
  await R.ctx.close();

  // ══ the director, clicking like a person ═══════════════════════════════════
  stepH('ZZ Director → sidebar → Share link');
  const D = await portal('zz-share-dir');
  const nav = await navItem(D.page);
  if (!assert(nav && nav.visible, 'the sidebar shows "Share link"')) throw new Error('no nav item');
  await D.page.mouse.click(nav.x, nav.y);                       // a REAL click
  try { await until(D.page, () => !!document.querySelector('.sl-card')); }
  catch (e) {
    console.log('     body → ' + (await D.page.evaluate(() =>
      (document.getElementById('app-body') || {}).innerText || '(empty)')).slice(0, 300));
    console.log('     errs → ' + D.errs.slice(0, 3).join(' | '));
    throw e;
  }
  await sleep(600);
  await D.page.screenshot({ path: path.join(SHOTS, '01-no-link-yet.png') });
  console.log('  📸 01-no-link-yet');

  const before = await D.page.evaluate(() => ({
    title: document.querySelector('.sl-h').textContent,
    cards: [...document.querySelectorAll('.sl-card')].map(c => ({
      name: c.querySelector('.sl-nm').textContent,
      state: c.querySelector('.sl-state').textContent.trim(),
      // the first .sl-act is the link's own row; the report password has its own
      buttons: [...c.querySelector('.sl-act').querySelectorAll('button')].map(b => b.textContent.trim())
    }))
  }));
  assert(before.title === 'Share availability', 'the screen opened: "' + before.title + '"');
  assert(before.cards.length >= 1, 'it lists ' + before.cards.length + ' project(s)');
  const zzCard = before.cards.find(c => /ZZ Map Tower/.test(c.name));
  assert(!!zzCard, 'ZZ Map Tower is one of them');
  assert(zzCard.state === 'No link' && zzCard.buttons.join() === 'Make a link',
    'with no link yet, and one button: ' + zzCard.buttons.join(', '));

  // ── make one ──────────────────────────────────────────────────────────────
  stepH('Make a link');
  const idx = before.cards.findIndex(c => /ZZ Map Tower/.test(c.name));
  const btn = await D.page.evaluate(i => {
    const b = [...document.querySelectorAll('.sl-card')][i].querySelector('button');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, idx);
  await D.page.mouse.click(btn.x, btn.y);
  await until(D.page, () => !!document.querySelector('.sl-url'));
  await sleep(700);
  await D.page.screenshot({ path: path.join(SHOTS, '02-link-made.png') });
  console.log('  📸 02-link-made');

  const made = await D.page.evaluate(() => {
    const box = document.querySelector('.sl-url');
    const card = box.closest('.sl-card');
    return { url: box.textContent.replace(/^Copy this now/, '').trim(),
             state: card.querySelector('.sl-state').textContent.trim(),
             use: (card.querySelector('.sl-use') || {}).textContent || '',
             buttons: [...card.querySelector('.sl-act').querySelectorAll('button')].map(b => b.textContent.trim()) };
  });
  const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/a\/[0-9a-f]{32}$/;
  assert(URL_RE.test(made.url), 'it shows a full URL: ' + made.url);
  assert(made.state === 'Link on', 'the project now reads "' + made.state + '"');
  assert(/Opened 0 times/.test(made.use), 'and starts at zero: "' + made.use.trim() + '"');
  assert(made.buttons.join() === 'Copy link,New link,Turn off',
    'with the three actions: ' + made.buttons.join(', '));

  const TOKEN1 = made.url.split('/a/')[1];
  const stored = await sql(`SELECT count(*) AS n FROM public.availability_links
                             WHERE token_hash = public._availability_token_hash('${TOKEN1}')`);
  assert(Number(stored[0].n) === 1, 'the DB holds its hash');
  const raw = await sql(`SELECT count(*) AS n FROM public.availability_links WHERE token_hash = '${TOKEN1}'`);
  assert(Number(raw[0].n) === 0, 'and not the link itself');

  // Copy must actually put it on the clipboard — a director who taps Copy and
  // gets nothing has lost the only chance to see this token.
  const copyBtn = await D.page.evaluate(() => {
    const b = [...document.querySelectorAll('.sl-card button')].find(x => x.textContent.trim() === 'Copy link');
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await D.page.mouse.click(copyBtn.x, copyBtn.y);
  await sleep(500);
  const clip = await D.page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip === made.url, 'Copy put the link on the clipboard');

  // ══ does that link actually open? ══════════════════════════════════════════
  stepH('Open the link in a browser with no login at all');
  const ctx2 = await browser.createBrowserContext();
  const pub = await ctx2.newPage();
  await pub.setViewport({ width: 1320, height: 940, deviceScaleFactor: 2 });
  const pubErr = [];
  pub.on('pageerror', e => pubErr.push(e.message));
  await pub.goto(made.url, { waitUntil: 'networkidle0' });
  /* THE PUBLIC PAGE STOPPED BEING A WALL OF WINDOWS. It used to paint every
     unit as a lit tile — class "win" — and this waited for those to fade in.
     The page has since been rebuilt around floors, with the units behind one,
     and "win" is not in the file at all any more, so the wait could only ever
     time out. What this step is for is narrower than counting units, which is
     shot-availability.js's work across two hundred assertions: it has to show
     that a link a director made moments ago opens the right tower to somebody
     with no login. The title and the floors prove exactly that. */
  await until(pub, () => document.querySelectorAll('#floors button').length > 0);
  await sleep(600);
  await pub.screenshot({ path: path.join(SHOTS, '03-link-opens.png') });
  console.log('  📸 03-link-opens');
  const opened = await pub.evaluate(() => ({
    title: document.getElementById('ttl').textContent,
    floors: document.querySelectorAll('#floors button').length,
    stored: Object.keys(localStorage).length
  }));
  assert(opened.title === 'ZZ Map Tower' && opened.floors > 0,
    'the shared link opens the tower: ' + opened.title + ', ' + opened.floors + ' floor(s)');
  assert(opened.stored === 0, 'and the visitor is still not logged in to anything');
  assert(pubErr.length === 0, 'no console errors on the public page');
  await ctx2.close();

  // the view counter is what a director watches
  await D.page.mouse.click(nav.x, nav.y);
  await until(D.page, () => !!document.querySelector('.sl-card'));
  await sleep(700);
  const counted = await D.page.evaluate(() =>
    ([...document.querySelectorAll('.sl-card')].find(c => /ZZ Map Tower/.test(c.querySelector('.sl-nm').textContent))
      .querySelector('.sl-use') || {}).textContent || '');
  assert(/Opened 1 time\b/.test(counted), 'the screen counted that visit: "' + counted.trim() + '"');
  /* The token stays on screen while this session lasts, on purpose: a director
     who navigates away and back can still copy it. What must NOT survive is a
     page reload — nothing writes it to storage. */
  assert(/[0-9a-f]{32}/.test(await D.page.content()),
    'the token is still copyable while the screen is open');
  const persisted = await D.page.evaluate(() =>
    JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)));
  assert(!new RegExp(TOKEN1).test(persisted), 'but it was never written to storage');
  await D.page.screenshot({ path: path.join(SHOTS, '04-after-a-visit.png') });
  console.log('  📸 04-after-a-visit');

  // and a reload really does forget it
  await D.page.reload({ waitUntil: 'networkidle2' });
  await sleep(1800);
  const nav2 = await navItem(D.page);
  await D.page.mouse.click(nav2.x, nav2.y);
  await until(D.page, () => !!document.querySelector('.sl-card'));
  await sleep(600);
  assert(!new RegExp(TOKEN1).test(await D.page.content()),
    'after a reload the link is gone from the screen — it can only be re-issued');
  const afterReload = await D.page.evaluate(() =>
    [...document.querySelectorAll('.sl-card')].map(c => c.querySelector('.sl-nm').textContent +
      ' = ' + c.querySelector('.sl-state').textContent.trim()).join(' | '));
  console.log('     cards → ' + afterReload);
  assert(/ZZ Map Tower = Link on/.test(afterReload),
    'while the project still shows its link is on');

  // ══ a new link retires the old one ═════════════════════════════════════════
  stepH('Make a NEW link for the same project');
  const newBtn = await D.page.evaluate(() => {
    const b = [...document.querySelectorAll('.sl-card button')].find(x => x.textContent.trim() === 'New link');
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await D.page.mouse.click(newBtn.x, newBtn.y);                  // the dialog handler accepts
  await until(D.page, () => !!document.querySelector('.sl-url'));
  await sleep(700);
  const TOKEN2 = await D.page.evaluate(() =>
    document.querySelector('.sl-url').textContent.replace(/^Copy this now/, '').trim().split('/a/')[1]);
  assert(TOKEN2 && TOKEN2 !== TOKEN1, 'the new link is a different token');
  const oldNow = await sql(`SELECT (public.get_public_availability('${TOKEN1}')->>'success') AS s`);
  const newNow = await sql(`SELECT (public.get_public_availability('${TOKEN2}')->>'success') AS s`);
  assert(oldNow[0].s === 'false', 'the link shared earlier stopped working');
  assert(newNow[0].s === 'true', 'and the fresh one works');

  // ══ the password that opens the directors' room ════════════════════════════
  // Rashid had no way to change this without asking me, which is the dependence
  // the whole of today was about. So it is driven here the way he will drive it:
  // by clicking, with the wrong things typed first.
  stepH("The directors' report password");

  const repBefore = await D.page.evaluate(() => {
    const c = [...document.querySelectorAll('.sl-card')]
      .find(x => /ZZ Map Tower/.test(x.querySelector('.sl-nm').textContent));
    return { lock: c.querySelector('.sl-lock').textContent.trim(),
             why: c.querySelector('.sl-why').textContent.trim(),
             buttons: [...c.querySelectorAll('.sl-rep button')].map(b => b.textContent.trim()) };
  });
  assert(repBefore.lock === 'Not set', 'it starts unlocked: "' + repBefore.lock + '"');
  assert(/stays shut/.test(repBefore.why),
    'and says the report is SHUT, not open: "' + repBefore.why + '"');
  assert(repBefore.buttons.join() === 'Set a password',
    'with one thing to do: ' + repBefore.buttons.join(', '));

  const clickText = async (t) => {
    const at = await D.page.evaluate(t => {
      const b = [...document.querySelectorAll('.sl-card button')].find(x => x.textContent.trim() === t);
      const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, t);
    await D.page.mouse.click(at.x, at.y);
  };
  const typePair = async (a, b) => D.page.evaluate((a, b) => {
    const f = document.querySelectorAll('.sl-form input[type=password], .sl-form input[type=text]');
    f[0].value = a; f[1].value = b;
  }, a, b);
  /* ASK FOR TEXT, NOT A BOOLEAN. The management API hands a real boolean back as
     JSON true, and comparing that to the string 'true' is false forever — which
     made every "nothing was stored" check below pass without ever looking.
     Casting in SQL keeps one type coming back and the comparison honest. */
  const hashNow = async () => (await sql(
    `SELECT (report_password_hash IS NOT NULL)::text AS set FROM public.projects
      WHERE project_name = 'ZZ Map Tower'`))[0].set === 'true';

  await clickText('Set a password');
  await until(D.page, () => !!document.querySelector('.sl-form'));
  ok('the form opens in the card');

  // too short — refused before it ever reaches the server
  await typePair('short', 'short');
  await clickText('Save password');
  await sleep(400);
  assert(!(await hashNow()), 'a short password is refused and nothing is stored');

  // mistyped — the reason the second box exists
  await typePair('LongEnoughOne1', 'LongEnoughTwo2');
  await clickText('Save password');
  await sleep(400);
  assert(!(await hashNow()), 'two that do not match are refused too');

  // and the real one
  const PW = 'ZZ-report-' + Date.now();
  await typePair(PW, PW);
  await clickText('Save password');
  await until(D.page, () => {
    const c = [...document.querySelectorAll('.sl-card')]
      .find(x => /ZZ Map Tower/.test(x.querySelector('.sl-nm').textContent));
    return c && c.querySelector('.sl-lock').textContent.trim() === 'Password set';
  });
  await sleep(500);
  await D.page.screenshot({ path: path.join(SHOTS, '06-password-set.png') });
  console.log('  📸 06-password-set');
  assert(await hashNow(), 'the password he typed is stored');

  const raw2 = await sql(`SELECT count(*) AS n FROM public.projects
                           WHERE project_name = 'ZZ Map Tower' AND report_password_hash = '${PW}'`);
  assert(Number(raw2[0].n) === 0, 'as a fingerprint — the password itself is not in the table');

  const onScreen = await D.page.content();
  assert(!new RegExp(PW).test(onScreen), 'and it is not left sitting on the screen');

  // the door it actually opens
  const good = await sql(`SELECT (public.get_availability_report('${TOKEN2}','${PW}')->>'success') AS s`);
  assert(good[0].s === 'true', 'the report opens with it');
  const bad1 = await sql(`SELECT (public.get_availability_report('${TOKEN2}','${PW}x')->>'success') AS s`);
  assert(bad1[0].s === 'false', 'and refuses anything else');

  // shutting it again
  await clickText('Shut the report');
  await until(D.page, () => {
    const c = [...document.querySelectorAll('.sl-card')]
      .find(x => /ZZ Map Tower/.test(x.querySelector('.sl-nm').textContent));
    return c && c.querySelector('.sl-lock').textContent.trim() === 'Not set';
  });
  assert(!(await hashNow()), 'Shut the report clears it');
  const shut = await sql(`SELECT (public.get_availability_report('${TOKEN2}','${PW}')->>'success') AS s`);
  assert(shut[0].s === 'false', 'and the room no longer opens with the old password');
  const stillUnits = await sql(`SELECT (public.get_public_availability('${TOKEN2}')->>'success') AS s`);
  assert(stillUnits[0].s === 'true', 'while the link itself keeps showing the units');

  // ══ turn it off ════════════════════════════════════════════════════════════
  stepH('Turn off');
  const offBtn = await D.page.evaluate(() => {
    const b = [...document.querySelectorAll('.sl-card button')].find(x => x.textContent.trim() === 'Turn off');
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await D.page.mouse.click(offBtn.x, offBtn.y);
  await until(D.page, () => [...document.querySelectorAll('.sl-card')]
    .some(c => /ZZ Map Tower/.test(c.querySelector('.sl-nm').textContent) &&
               c.querySelector('.sl-state').textContent.trim() === 'No link'));
  await sleep(500);
  await D.page.screenshot({ path: path.join(SHOTS, '05-turned-off.png') });
  console.log('  📸 05-turned-off');
  const dead = await sql(`SELECT (public.get_public_availability('${TOKEN2}')->>'success') AS s`);
  assert(dead[0].s === 'false', 'and the live link is dead');
  ok('the card is back to "No link"');

  assert(D.errs.length === 0, 'no console errors in the portal' + (D.errs.length ? ': ' + D.errs[0] : ''));
  await D.ctx.close();

  await browser.close(); server.close();
  await sql(`DELETE FROM public.availability_links WHERE company_id='${ZZ}';
             DELETE FROM public.sales_sessions WHERE session_token IN ('zz-share-dir','zz-share-rep');`);
  console.log('\n✓ fixture links and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/share_link/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
