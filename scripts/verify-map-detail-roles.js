/**
 * A sold unit answers in three tiers — and the cut is made on the SERVER.
 *
 *   node scripts/verify-map-detail-roles.js
 *
 * The owner's rule, in his words: a rep may see the buyer's NAME and the unit;
 * he may not see price, phone or dues — and those must not reach his browser at
 * all, so there is nothing to un-hide with a devtools console.
 *
 * That last part is why this harness reads the RESPONSE BODY off the wire
 * (page.on('response') on /rest/v1/rpc/get_map_unit_detail) instead of reading
 * the rendered sheet. A screen that merely omits a number proves nothing; a
 * payload that never contained it proves everything. The sheet is checked too,
 * because both have to be right.
 *
 * ZZTEST only — its sold unit is UG-01 (ZZ Buyer, PKR 5,000,000, 03001234567).
 * Nothing here writes to a real tenant.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4219;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'detail_roles');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const SOLD = 'UG-01';
const SECRETS = { price: '5000000', phone: '03001234567', sale_no: 'ZZ-SALE-001' };

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
const until = (page, fn, ms = 15000) => page.waitForFunction(fn, { timeout: ms, polling: 250 });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  await sql(`DELETE FROM public.sales_sessions WHERE session_token LIKE 'zz-roles%';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-roles-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-roles-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';`);

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  /* Open the map the way a human does — sidebar → Unit map → floor — then click
     the sold unit with a real mouse, and keep whatever the server sent back. */
  async function soldSheet(token, tag) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1320, height: 900, deviceScaleFactor: 1.5 });
    const errs = [], wire = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('response', async r => {
      if (!/rpc\/get_map_unit_detail/.test(r.url())) return;
      try { wire.push(await r.text()); } catch (e) { /* body already gone */ }
    });

    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
                               localStorage.setItem('rms.sales.active', String(Date.now()));
                               // the location + install bars are raised on a timer and would land
                               // on top of the sheet in the proof photo; both honour these flags
                               sessionStorage.setItem('nx.loc.dismissed', '1');
                               sessionStorage.setItem('nx.pwa.dismissed', '1'); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    try {
      await until(page, () => { const b = document.getElementById('app-body');
                                return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); });
    } catch (e) { await sleep(1500); }
    // first-run prompts float over everything and would sit in the middle of the
    // proof photograph — dismiss them, do not photograph around them
    await page.evaluate(() => {
      ['loc-bar', 'pwa-bar', 'push-bar'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
      document.querySelectorAll('.overlay, .prompt-card, .loc-prompt, [class*="prompt"]').forEach(e => e.remove());
    });
    await page.evaluate(() => [...document.querySelectorAll('.sb .ni')]
      .find(x => (x.querySelector('.ni-lb') || {}).textContent === 'Unit map').click());
    await until(page, () => document.querySelectorAll('.umv-floor').length > 0);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.umv-floor')]
      .find(x => x.textContent.includes('Upper Ground') && !x.classList.contains('soon')); b.click(); });
    await until(page, () => document.querySelectorAll('#umv-svg polygon').length > 0);
    await sleep(1500);

    const pt = await page.evaluate(t => {
      const el = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === t);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, SOLD);
    if (!pt) throw new Error(SOLD + ' is not on the drawing');
    await page.mouse.click(pt.x, pt.y);                    // a REAL click
    await until(page, () => !!document.querySelector('.umv-sheet-in'));
    await sleep(700);

    const sheet = await page.evaluate(() => ({
      unit: (document.querySelector('.umv-sheet-in b') || {}).textContent || '',
      state: (document.querySelector('.umv-state') || {}).textContent || '',
      rows: [...document.querySelectorAll('.umv-row')].map(r =>
        [...r.children].map(c => c.textContent.trim())),
      text: document.querySelector('.umv-sheet-in').innerText
    }));
    await page.screenshot({ path: path.join(SHOTS, tag + '.png'),
      clip: await page.evaluate(() => { const r = document.querySelector('.umv-sheet-in').getBoundingClientRect();
        return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 }; }) });
    await page.close();
    return { sheet, wire: wire.join('\n'), errs };
  }

  // ══ REP ═══════════════════════════════════════════════════════════════════
  stepH('ZZ Rep One clicks the sold unit UG-01');
  const rep = await soldSheet('zz-roles-rep', 'rep-sold-sheet');
  console.log('     wire → ' + rep.wire.replace(/\s+/g, ' ').slice(0, 300));

  // PostgREST pretty-prints jsonb with a space after the colon — match either way
  assert(/"state":\s*"sold"/.test(rep.wire), 'the response says sold');
  assert(rep.wire.includes('ZZ Buyer'), 'the buyer NAME is on the wire — the rep is meant to have it');
  assert(/"unit_no":\s*"UG-01"/.test(rep.wire), 'unit number is there');
  assert(/"floor_label"/.test(rep.wire) && /"area"/.test(rep.wire) && /"type"/.test(rep.wire),
    'floor, area and type are there');

  const leaks = Object.entries(SECRETS).filter(([, v]) => rep.wire.includes(v)).map(([k]) => k);
  assert(leaks.length === 0, 'no money or contact value on the wire' + (leaks.length ? ' — LEAKED: ' + leaks : ''));
  const keys = ['"price"', '"rate_pending"', '"client_phone"', '"net_amount"', '"paid"', '"outstanding"', '"overdue"', '"sale_number"']
    .filter(k => rep.wire.includes(k));
  assert(keys.length === 0, 'not even the KEYS are present' + (keys.length ? ' — found: ' + keys : ''));

  const repLabels = rep.sheet.rows.map(r => r[0]);
  assert(repLabels.includes('Client'), 'the rep\'s sheet shows a Client row');
  assert(/ZZ Buyer/.test(rep.sheet.text), 'and it names ZZ Buyer');
  assert(repLabels.includes('Type') && repLabels.includes('Area'), 'unit details are shown (Type, Area)');
  assert(!repLabels.includes('Rate') && !repLabels.includes('Phone') &&
         !repLabels.includes('Outstanding') && !repLabels.includes('Paid'),
    'no Rate / Phone / Paid / Outstanding row: ' + repLabels.join(', '));
  assert(rep.errs.length === 0, 'no console errors' + (rep.errs.length ? ': ' + rep.errs[0] : ''));

  // ══ DIRECTOR ══════════════════════════════════════════════════════════════
  stepH('ZZ Director clicks the same unit');
  const dir = await soldSheet('zz-roles-dir', 'director-sold-sheet');

  assert(dir.wire.includes('ZZ Buyer'), 'buyer name');
  assert(dir.wire.includes(SECRETS.phone), 'phone reaches the director');
  assert(dir.wire.includes(SECRETS.price), 'price reaches the director');
  assert(/"outstanding"/.test(dir.wire) && /"overdue"/.test(dir.wire), 'dues reach the director');
  const dirLabels = dir.sheet.rows.map(r => r[0]);
  assert(dirLabels.includes('Phone') && dirLabels.includes('Outstanding') && dirLabels.includes('Rate'),
    'the director\'s sheet shows Phone, Rate and Outstanding: ' + dirLabels.join(', '));
  assert(dir.errs.length === 0, 'no console errors' + (dir.errs.length ? ': ' + dir.errs[0] : ''));

  // ══ an AVAILABLE unit still prices for a rep ══════════════════════════════
  stepH('A rep must still be able to price what is FOR SALE');
  const avail = await sql(`SELECT public.get_map_unit_detail('zz-roles-rep',
    (SELECT id FROM public.units WHERE project_id='708605fc-33e9-4538-8b7c-0513b2d2e8b9'
       AND unit_no='UG-03')) AS d`);
  const av = avail[0].d;
  assert(av.state === 'available', 'UG-03 is available');
  assert(av.price != null, 'a rep still gets the price of an available unit (PKR ' + av.price + ')');
  assert(av.can_reserve === true, 'and can still reserve it');

  await sql(`DELETE FROM public.sales_sessions WHERE session_token LIKE 'zz-roles%'`);
  await browser.close(); server.close();
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/detail_roles/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
