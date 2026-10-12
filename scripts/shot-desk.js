#!/usr/bin/env node
/* THE RESERVE DESK ON THE LINK, photographed with Awami's real data.

   The desk's own reads (get_reserve_desk, list_reservation_requests,
   list_link_payments, get_unallocated_tokens_desk) are called for Rashid's
   sign-in inside a transaction that is rolled back: the session they need is
   never committed. The page is served locally with ?preview=1; every Supabase
   call is answered from what was captured or blocked, so nothing is booked and
   nothing is written.

   node scripts/shot-desk.js <outdir> [tag]          MEASURE=1 prints block heights */
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer-core');
const { q } = require('./_sbq');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'marketing_shots', 'desk'));
const TAG = process.argv[3] || 'desk';
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', PR = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const RASHID = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cap = await q(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('shot_desk_probe'), '${CO}', '${PR}', 'DESK SHOT - rolled back');
    INSERT INTO public.sales_sessions (company_id, sales_user_id, session_token, expires_at)
    VALUES ('${CO}', '${RASHID}', 'shot_desk_session', now() + interval '10 minutes');
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('shot_desk_probe') AS p,
             public.get_reserve_desk('shot_desk_session', NULL) AS d,
             public.list_reservation_requests('shot_desk_session', NULL) AS r,
             public.list_link_payments('shot_desk_session') AS l,
             public.get_unallocated_tokens_desk('shot_desk_session') AS u;
    SELECT p::text p, d::text d, r::text r, l::text l, u::text u FROM cap;
    ROLLBACK;`);
  const C = {}; ['p', 'd', 'r', 'l', 'u'].forEach(k => { C[k] = JSON.parse(cap[0][k]); });
  if (!C.d.success) throw new Error('desk: ' + cap[0].d.slice(0, 200));

  const srv = http.createServer((rq, rs) => {
    const p = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(rs);
  }).listen(4198);

  const br = await puppeteer.launch({ executablePath: BROWSERS.find(p => fs.existsSync(p)), headless: 'new', args: ['--no-sandbox'] });
  const errs = [];
  try {
    for (const [w, h, name] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
      const pg = await br.newPage();
      pg.on('pageerror', e => errs.push(name + ': ' + e.message));
      await pg.setRequestInterception(true);
      pg.on('request', r => /supabase\.co/.test(r.url()) ? r.abort() : r.continue());
      await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1.5, isMobile: name === 'phone' });
      await pg.goto('http://127.0.0.1:4198/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
      await pg.evaluate(p => window._availPreview(p), C.p);
      await pg.evaluate(C => {
        sb.rpc = async function (fn) {
          if (fn === 'get_my_profile') return { data: { success: true, profile: { role: 'director', name: 'Rashid Manzoor', company_name: 'Awami Market' } } };
          if (fn === 'can_authorize_reservation') return { data: true };
          if (fn === 'get_reserve_desk') return { data: C.d };
          if (fn === 'list_reservation_requests') return { data: C.r };
          if (fn === 'list_link_payments') return { data: C.l };
          if (fn === 'get_unallocated_tokens_desk') return { data: C.u };
          return { data: null };
        };
        try { localStorage.setItem(DESK_TOK_KEY, 'shot'); } catch (e) {}
        openDesk();
      }, C);
      await pg.waitForSelector('#rd-root', { timeout: 20000 });
      await new Promise(r => setTimeout(r, 1200));
      // REQ="name": type a requester, and print what the WhatsApp line says
      if (process.env.REQ) {
        await pg.type('#rd-req', process.env.REQ);
        await new Promise(r => setTimeout(r, 300));
        console.log(name, 'whatsapp line for', process.env.REQ + ':', await pg.$eval('#rd-wahit', e => e.textContent));
      }
      await pg.screenshot({ path: path.join(OUT, TAG + '-' + name + '.png'), fullPage: true });
      console.log(name, 'page height', await pg.evaluate(() => document.documentElement.scrollHeight));
      if (process.env.MEASURE) console.log(await pg.evaluate(() => {
        const out = []; const rp = document.getElementById('rd-root');
        out.push('above desk: ' + Math.round(rp.getBoundingClientRect().top + scrollY));
        [].forEach.call(rp.children, c => out.push(Math.round(c.getBoundingClientRect().height) + '  ' +
          (c.id || c.className || c.tagName) + '  ' + (c.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' ')));
        return out.join('\n'); }));
      await pg.close();
    }
  } finally { await br.close(); srv.close(); }
  console.log('errors:', JSON.stringify(errs.filter(e => !/Failed to fetch|NetworkError|net::/.test(e))));
  console.log('written to', OUT);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
