#!/usr/bin/env node
/* THE DIRECTORS' ROOM, photographed with Awami's real report.

   The public payload and the room's report are read through the real
   functions inside a transaction that is rolled back (a throw-away link and
   room password, never committed). The page is served locally with
   ?preview=1, so it fetches nothing on its own; every call to Supabase is
   blocked, so nothing is written anywhere.

   node scripts/shot-room.js <outdir> [tag]                                    */
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer-core');
const { q } = require('./_sbq');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'marketing_shots', 'room'));
const TAG = process.argv[3] || 'room';
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', PR = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cap = await q(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('shot_room_probe'), '${CO}', '${PR}', 'ROOM SHOT - rolled back');
    UPDATE public.projects SET report_password_hash = public._availability_secret_hash('${PR}', 'shot-room-pw') WHERE id = '${PR}';
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('shot_room_probe') AS p,
             public.get_availability_report('shot_room_probe', 'shot-room-pw') AS r,
             public.get_hold_decisions('shot_room_probe', 'shot-room-pw') AS h;
    SELECT p::text AS p, r::text AS r, h::text AS h FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].p), report = JSON.parse(cap[0].r), holds = JSON.parse(cap[0].h);
  if (!report.success) throw new Error('report: ' + cap[0].r.slice(0, 200));

  const srv = http.createServer((rq, rs) => {
    const p = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(rs);
  }).listen(4197);

  const br = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)), headless: 'new', args: ['--no-sandbox'] });
  const errs = [];
  try {
    for (const [w, h, name] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
      const pg = await br.newPage();
      pg.on('pageerror', e => errs.push(name + ': ' + e.message));
      await pg.setRequestInterception(true);
      pg.on('request', r => /supabase\.co/.test(r.url()) ? r.abort() : r.continue());
      await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1.5, isMobile: name === 'phone' });
      await pg.goto('http://127.0.0.1:4197/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
      await pg.evaluate(p => window._availPreview(p), payload);
      await pg.evaluate((r, h) => {
        /* every room call answered from what was captured; nothing reaches the network */
        sb.rpc = async function (fn) {
          if (fn === 'get_hold_decisions') return { data: h };
          if (fn === 'saf_room_list') return { data: { success: true, waiting: 1, approvers: [{ name: 'Naeem Hussain', has_password: true }, { name: 'Rashid Manzoor', has_password: false }, { name: 'Syed Yousaf Shah', has_password: true }],
            rows: [{ id: 'x', saf_no: 'SAF-0004', status: 'submitted', unit_code: 'LG-03', floor_label: 'Lower Ground', buyer_name: 'Sample buyer', agent_name: 'Waqar Landlord', net_price: 8500000, prepared_by_name: 'Accounts', submitted_at: new Date().toISOString(), flags: 1 }] } };
          return { data: null };
        };
        REP = r; REPPW = 'x'; REPP = { view: 'home', key: '' }; showRep(); window.scrollTo(0, 0);
      }, report, holds);
      await new Promise(r => setTimeout(r, 900));
      await pg.screenshot({ path: path.join(OUT, TAG + '-' + name + '.png'), fullPage: true });
      const tall = await pg.evaluate(() => document.documentElement.scrollHeight);
      console.log(name, 'page height', tall);
      // MEASURE=1: how tall each block of the room's first screen is
      if (process.env.MEASURE) console.log(await pg.evaluate(() => {
        const out = []; const rp = document.querySelector('#rep-body .rp');
        out.push('above room body: ' + Math.round(document.getElementById('rep-body').getBoundingClientRect().top + scrollY));
        [].forEach.call(rp.children, c => out.push(Math.round(c.getBoundingClientRect().height) + '  ' +
          (c.id || c.className || c.tagName) + '  ' + (c.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' ')));
        return out.join('\n'); }));
      if (name === 'desktop') {
        /* a fold opened stays open when the room redraws itself */
        await pg.click('details.rx[data-x="who"] > summary');
        const kept = await pg.evaluate(() => { decPaint(); const d = document.querySelector('details.rx[data-x="who"]'); return { open: d.open, rows: d.querySelectorAll('.row').length, other: document.querySelector('details.rx[data-x="kind"]').open }; });
        console.log('fold after redraw:', JSON.stringify(kept));
      }
      await pg.close();
    }
  } finally { await br.close(); srv.close(); }
  console.log('errors:', JSON.stringify(errs.filter(e => !/Failed to fetch|NetworkError|net::/.test(e))));
  console.log('written to', OUT);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
