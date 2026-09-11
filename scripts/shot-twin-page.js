/* ══ THE BUILDING, ON THE REAL PAGE ════════════════════════════════════════
   Drives availability.html at ?view=twin against a captured payload — the same
   one shot-availability.js uses — so the model can be seen with real statuses
   on it without an Awami link being made. Takes pictures and reports what the
   page says about itself.

   node scripts/shot-twin-page.js
*/
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN,
                 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d)) : rej(new Error(d.slice(0,200)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4232;
const OUT = path.join(ROOT, 'marketing_work');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((q, res) => {
  let url = decodeURIComponent(q.url.split('?')[0]);
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  /* THE VERCEL REWRITE, COPIED. The page is served from /a/<token> and lives
     at the root, so anything it asks for by a relative path resolves under
     /a/ and is not there. Serving it from its own filename here hid exactly
     that bug: the geometry 404'd in production and the model fell back to the
     flat page without a word. The harness now opens the URL a dealer opens. */
  if (/^\/a\/[A-Za-z0-9_-]+$/.test(url)) url = '/availability.html';
  const p = path.join(ROOT, url);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  /* THE REAL PAYLOAD, FROM THE REAL FUNCTION, AND NO LINK LEFT BEHIND — the
     same trick shot-availability.js uses: a link is made inside a transaction,
     the function is called through it, and the whole thing is rolled back. */
  const cap = await sql(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('twin_shot_probe'),
            '96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','TWIN PROBE — rolled back');
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('twin_shot_probe') AS d;
    SELECT d::text AS payload FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].payload);

  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const b = await puppeteer.launch({ channel: 'chrome', headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  for (const shot of [{ n: 'twin-overview', w: 1400, h: 950 },
                      { n: 'twin-phone', w: 390, h: 800 }]) {
    const page = await b.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.setViewport({ width: shot.w, height: shot.h, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORT}/a/shot_twin_token?preview=1&view=twin`,
                    { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await page.evaluate(p => window._availPreview(p), payload);
    try {
      await page.waitForFunction(() => {
        const l = document.getElementById('tw-load');
        return l && l.hidden;
      }, { timeout: 90000 });
    } catch (e) { console.log('  ' + shot.n + ': the model never finished building'); }
    await new Promise(r => setTimeout(r, 2600));
    const said = await page.evaluate(() => ({
      shown: !document.getElementById('twin').hidden,
      flat: document.getElementById('app').hidden,
      open: (document.getElementById('tw-open') || {}).textContent,
      of: (document.getElementById('tw-of') || {}).textContent,
      rail: document.querySelectorAll('#tw-lift button').length,
      keys: [...document.querySelectorAll('#tw-key span')].map(s => s.textContent)
    }));
    console.log(shot.n + ': ' + JSON.stringify(said));
    if (errs.length) console.log('  errors → ' + errs.slice(0, 4).join(' | '));
    await page.screenshot({ path: path.join(OUT, shot.n + '.png') });
    await page.close();
  }
  await b.close(); server.close();
  console.log('shots → marketing_work/');
})().catch(e => { console.error(e.message); process.exit(1); });
