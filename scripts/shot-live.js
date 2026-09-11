/* ══ IS IT ACTUALLY LIVE? ══════════════════════════════════════════════════
   A dashboard that says LIVE has to be caught doing it. This opens the page
   against a real payload, then hands it a SECOND payload with one shop taken
   — the way the next fetch would — and reports what the screen did about it:
   whether the reading moved, whether the floor moved, and whether the page
   said out loud which shop it was.

   No stub anywhere: the payloads both come from the real function through a
   link created and rolled back inside one transaction.

   node scripts/shot-live.js
*/
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4233;
const OUT = path.join(ROOT, 'marketing_work');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png' };

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN,
                 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d)) : rej(new Error(d.slice(0, 200)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const server = http.createServer((q, res) => {
  let url = decodeURIComponent(q.url.split('?')[0]);
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (/^\/a\/[A-Za-z0-9_-]+$/.test(url)) url = '/availability.html';
  const p = path.join(ROOT, url);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const is = (c, m) => c ? ok(m) : bad(m);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cap = await sql(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('live_shot_probe'),
            '96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','LIVE PROBE — rolled back');
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('live_shot_probe') AS d;
    SELECT d::text AS payload FROM cap;
    ROLLBACK;`);
  const first = JSON.parse(cap[0].payload);

  /* the second position: one open shop on the busiest floor is taken, exactly
     as the desk would have taken it */
  const later = JSON.parse(JSON.stringify(first));
  let took = null;
  for (const f of later.floors) {
    const u = (f.units || []).find(x => x.s === 'available');
    if (u) { u.s = 'not_available'; u.k = 'Hold'; u.w = 'Fawad khan'; took = u.n; f.available -= 1; break; }
  }
  if (!took) { console.log('nothing open to take'); process.exit(1); }

  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const b = await puppeteer.launch({ channel: 'chrome', headless: 'new' });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${PORT}/a/live_probe?preview=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
  await page.evaluate(p => window._availPreview(p), first);
  await page.evaluate(() => { const s = document.getElementById('nm-skip'); if (s) s.click(); });
  await new Promise(r => setTimeout(r, 600));

  const was = await page.evaluate(() => ({
    hero: document.querySelector('.hero-n').textContent,
    pulse: !!document.querySelector('#upd .pulse'),
    live: (document.getElementById('upd') || {}).textContent || '',
    news: !document.getElementById('news') || document.getElementById('news').hidden
  }));
  is(was.pulse, 'a pulse is beating in the header');
  is(/Live/.test(was.live), 'and the header says it is live: "' + was.live.trim() + '"');
  is(was.news, 'nothing is claimed to have just happened on a first load');
  await page.screenshot({ path: path.join(OUT, 'live-before.png') });

  /* the next fetch lands */
  await page.evaluate(p => window._availPreview(p), later);
  await new Promise(r => setTimeout(r, 900));

  const now = await page.evaluate(() => ({
    hero: document.querySelector('.hero-n').textContent,
    heroTo: document.querySelector('.hero-n').getAttribute('data-v'),
    newsShown: !document.getElementById('news').hidden,
    newsText: document.getElementById('news').textContent,
    moved: document.querySelectorAll('#floors button.moved').length
  }));
  is(now.newsShown, 'the page says something just happened');
  is(new RegExp(took).test(now.newsText), 'and names the shop: ' + took);
  is(/Fawad khan/.test(now.newsText), 'and whose word it was held on');
  is(Number(now.heroTo) === Number(String(was.hero).replace(/[^0-9]/g, '')) - 1,
     'the reading is on its way to one fewer (' + was.hero + ' → ' + now.heroTo + ')');
  is(now.moved >= 1, 'the floor it happened on is marked as moved');
  is(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs[0] : ''));
  await page.screenshot({ path: path.join(OUT, 'live-after.png') });

  await b.close(); server.close();
  console.log('\n' + PASS + ' passed · ' + FAIL + ' failed');
  console.log('shots → marketing_work/live-before.png, live-after.png');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
