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
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('dialog', async d => { await d.accept(); });        // confirm() → yes
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now()));
                               sessionStorage.setItem('nx.loc.dismissed', '1');
                               sessionStorage.setItem('nx.pwa.dismissed', '1'); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
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
      buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim())
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
             buttons: [...card.querySelectorAll('button')].map(b => b.textContent.trim()) };
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
  await until(pub, () => document.querySelectorAll('.win').length > 0);
  await pub.waitForFunction(() =>
    [...document.querySelectorAll('.win')].every(w => parseFloat(getComputedStyle(w).opacity) > 0.99),
    { timeout: 12000, polling: 150 });
  await pub.screenshot({ path: path.join(SHOTS, '03-link-opens.png') });
  console.log('  📸 03-link-opens');
  const opened = await pub.evaluate(() => ({
    title: document.getElementById('ttl').textContent,
    units: document.querySelectorAll('.win').length,
    stored: Object.keys(localStorage).length
  }));
  assert(opened.title === 'ZZ Map Tower' && opened.units === 30,
    'the shared link opens the tower: ' + opened.title + ', ' + opened.units + ' units');
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
