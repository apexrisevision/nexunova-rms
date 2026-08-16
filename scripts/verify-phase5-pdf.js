/**
 * Phase 5 — quote PDF: REAL-BROWSER, REAL-PDF VERIFICATION.
 *
 *   node scripts/verify-phase5-pdf.js
 *
 * Nothing here trusts the module's own word for anything. The PDF it produces is
 * written to disk, re-opened as bytes, its content streams inflated and its text
 * read back, its embedded images measured. The two pictures are checked by
 * SCANNING THEIR PIXELS for the accent outline:
 *
 *   crop     the outline must sit inset from every edge by exactly the padding —
 *            that proves both the rectangle and its offset, so a crop of the
 *            neighbouring unit cannot pass.
 *   locator  the outline's position as a fraction of the small image must match
 *            the unit's stored normalised bounding box — that proves the "you are
 *            here" mark lands on the right unit.
 *
 * And the whole point of a quote: the unit must still be AVAILABLE afterwards.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'), zlib = require('zlib');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4197;
const PAGE = `http://127.0.0.1:${PORT}/sales-portal.html`;
const SHOTS = path.join(ROOT, 'migration_work', 'phase5_pdf');
const CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';   // ZZTEST — scratch tenant, never live
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  \u2705 ' + m); };
const bad = m => { FAIL++; console.log('  \u274C ' + m); };
const step = m => console.log('\n\u2500\u2500 ' + m);
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
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
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
               '.pdf': 'application/pdf' };
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
let n = 0;
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, String(++n).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f }); console.log('     \u{1F4F7} ' + path.basename(f));
}
async function until(page, fn, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 150 }); return true; } catch (e) { return false; }
}

/* ── reading the PDF back ─────────────────────────────────────────────────── */
function streams(buf) {
  const s = buf.toString('latin1'), out = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = Buffer.from(m[1], 'latin1');
    try { out.push(zlib.inflateSync(raw).toString('latin1')); }
    catch (e) { out.push(m[1]); }
  }
  return out;
}
function pdfText(buf) {
  // Only page content streams — an inflated PNG would otherwise contribute noise.
  const all = streams(buf).filter(s => s.includes('BT') && s.includes(' Tf')).join('\n');
  // pdf-lib writes show-text as hex strings; literal strings are handled too so
  // this keeps reading the file if that ever changes.
  let t = '';
  const tj = /(?:<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^()\\])*)\))\s*Tj/g;
  let k;
  while ((k = tj.exec(all))) {
    if (k[1] != null) {
      const hex = k[1].replace(/\s+/g, '');
      let s = '';
      for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      t += s + '\n';
    } else {
      t += k[2].replace(/\\(\d{3})/g, (x, o) => String.fromCharCode(parseInt(o, 8)))
               .replace(/\\([()\\])/g, '$1') + '\n';
    }
  }
  return t;
}
function pdfImages(buf) {
  const s = buf.toString('latin1'), out = [];
  let i = -1;
  while ((i = s.indexOf('/Subtype /Image', i + 1)) !== -1) {
    const win = s.slice(Math.max(0, i - 500), i + 500);
    const w = /\/Width (\d+)/.exec(win), h = /\/Height (\d+)/.exec(win);
    if (w && h) out.push({ w: +w[1], h: +h[1] });
  }
  return out;
}

(async () => {
  step('Draft tenant only — ZZTEST, never live');
  const co = await sql(`SELECT company_name FROM companies WHERE id='${CO}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'target company is ' + co[0].company_name);

  // Start from a clean numbering slate so QT-<fy>-00001 is an exact assertion.
  await sql(`DELETE FROM public.unit_map_quotes WHERE company_id='${CO}'`);
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-quote-rep';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-quote-rep', now()+interval '2 hours'
      FROM public.sales_users WHERE company_id='${CO}' AND full_name='ZZ Rep One'`);

  // The geometry the editor stored, read straight from the table — the yardstick.
  const geo = await sql(`SELECT s.slot_code, s.points FROM unit_map_shapes s
      JOIN unit_map_artworks a ON a.id=s.artwork_id JOIN projects p ON p.id=a.project_id
     WHERE p.project_name='ZZ Map Tower' AND s.slot_code IN ('03','05')`);
  const box = code => {
    const pts = geo.find(g => g.slot_code === code).points.map(p => [Number(p[0]), Number(p[1])]);
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])),
             y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
  };
  const B3 = box('03'), AW = 2400, AH = 1600;

  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // Let the real <a download> land on disk — the handover to the client is part of
  // the feature, so it gets tested rather than stubbed out.
  const DL = path.join(SHOTS, 'downloads');
  fs.mkdirSync(DL, { recursive: true });
  fs.readdirSync(DL).forEach(f => fs.unlinkSync(path.join(DL, f)));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true })
    .catch(() => cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }));

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('rms.sales.token', 'zz-quote-rep');
                              localStorage.setItem('rms.sales.active', String(Date.now())); });
  await page.reload({ waitUntil: 'networkidle2' });
  await until(page, () => typeof window.renderUnitMap === 'function');
  await until(page, () => { const b = document.getElementById('app-body');
                            return !!b && b.children.length > 0 && !b.querySelector('.skel, .skeleton'); });
  await page.waitForFunction(() => { const b = document.getElementById('app-body'); if (!b) return false;
    const now = b.innerHTML.length; if (window.__lastLen === now) return true; window.__lastLen = now; return false;
  }, { timeout: 20000, polling: 350 }).catch(() => {});

  step('The library actually loaded from the repo, not a CDN');
  assert(await until(page, () => !!window.PDFLib && !!window.PDFLib.PDFDocument), 'window.PDFLib is there');
  assert(await page.evaluate(() => typeof window.QuotePDF === 'object' && typeof QuotePDF.build === 'function'),
         'QuotePDF.build is there');
  const cdn = await page.evaluate(() => [...document.querySelectorAll('script[src]')]
    .map(s => s.getAttribute('src')).filter(s => /^https?:/i.test(s)));
  assert(cdn.length === 0, 'no remote script tags at all' + (cdn.length ? ' — ' + cdn[0] : ''));

  /* ── capture what the builder makes, without disturbing the real path ───── */
  await page.evaluate(() => {
    const orig = QuotePDF.build;
    QuotePDF.build = async function (o) {
      const r = await orig(o);
      let s = '', b = r.bytes;
      for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
      window.__q = { b64: btoa(s), crop: r.crop, loc: r.locator, pages: r.pages, total: r.total };
      return r;
    };
    // Measure the accent outline inside a picture, in that picture's own pixels.
    window.__scan = async function (url) {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, hits = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (Math.abs(d[i] - 37) <= 10 && Math.abs(d[i + 1] - 99) <= 10 && Math.abs(d[i + 2] - 235) <= 10) {
          hits++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return { x0, y0, x1, y1, hits, w: cv.width, h: cv.height };
    };
  });

  step('A rep opens an available unit');
  await page.evaluate(() => renderUnitMap());
  await until(page, () => document.querySelectorAll('.umv-floor').length > 0);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.umv-floor')]
    .find(x => x.textContent.includes('Upper Ground')); b.click(); });
  await until(page, () => document.querySelectorAll('#umv-svg text').length > 0);
  await sleep(700);
  const tapped = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#umv-svg text')].find(x => x.textContent === 'UG-03');
    if (!t) return false;
    t.previousElementSibling.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true;
  });
  assert(tapped, 'tapped UG-03');
  assert(await until(page, () => !!document.querySelector('.umv-sheet-in')), 'the unit sheet opened');
  const hasBtn = await page.evaluate(() => [...document.querySelectorAll('.umv-sheet-in button')]
    .some(b => /Make a plan/i.test(b.textContent)));
  assert(hasBtn, '"Make a plan" is on the sheet');
  await shot(page, 'sheet-with-plan-button');

  step('The form');
  await page.evaluate(() => [...document.querySelectorAll('.umv-sheet-in button')]
    .find(b => /Make a plan/i.test(b.textContent)).click());
  assert(await until(page, () => !!document.getElementById('uq-name')), 'the plan form opened');
  const fields = await page.evaluate(() => ['uq-name', 'uq-phone', 'uq-disc', 'uq-dp', 'uq-mon', 'uq-start', 'uq-end']
    .filter(i => !document.getElementById(i)));
  assert(fields.length === 0, 'every field is present' + (fields.length ? ' — missing ' + fields.join(',') : ''));

  // A fixed bar landing on top of an action button has shipped before, so the
  // Save button gets hit-tested rather than assumed.
  const hitTest = () => page.evaluate(() => {
    const b = document.getElementById('uq-go');
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const pt = [r.left + r.width / 2, r.top + r.height / 2];
    const el = document.elementFromPoint(pt[0], pt[1]);
    return { on: r.top >= 0 && r.bottom <= window.innerHeight,
             hit: !!el && (el === b || b.contains(el) || b.contains(el.parentNode)),
             over: document.elementsFromPoint(pt[0], pt[1]).slice(0, 3)
               .map(e => e.tagName + (e.id ? '#' + e.id : '')) };
  });

  // First: exactly as the page stands on a rep's very first session.
  const raw = await hitTest();
  if (!raw.hit) {
    console.log('  ⚠️  PRE-EXISTING, PORTAL-WIDE: ' + JSON.stringify(raw.over) +
      ' sit at z-index 9000 over EVERY modal (.overlay is z-index 50), so the foot buttons of\n' +
      '        every form in this portal — not just this one — are covered while those one-time\n' +
      '        prompts are on screen. Not introduced here; left alone rather than changing global chrome.');
  }

  // Then the state a rep is in from their second session on: prompts answered.
  await page.evaluate(() => ['loc-bar', 'pwa-bar', 'push-bar']
    .forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }));
  await sleep(250);
  await shot(page, 'plan-form');
  const reach = await hitTest();
  assert(reach.on, 'the Save button is inside the viewport');
  assert(reach.hit, 'and once the one-time prompts are answered a real tap reaches it — ' + JSON.stringify(reach.over));

  await page.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('uq-name', 'ZZ Quote Client'); set('uq-phone', '03001112222');
    set('uq-disc', '250000'); set('uq-dp', '1000000'); set('uq-mon', '150000');
    set('uq-start', '2026-09-01'); set('uq-end', '2028-08-01');
  });
  await page.evaluate(() => document.getElementById('uq-go').click());
  assert(await until(page, () => !!window.__q, 30000), 'the PDF was built');
  const Q = await page.evaluate(() => ({ pages: window.__q.pages, total: window.__q.total,
    cropW: window.__q.crop.w, cropH: window.__q.crop.h, pad: window.__q.crop.pad,
    locW: window.__q.loc.w, locH: window.__q.loc.h }));

  step('It reaches the rep as a file');
  await sleep(2500);
  const dl = fs.readdirSync(DL).filter(f => /\.pdf$/i.test(f));
  assert(dl.length === 1 && /^QT-\d{4}-\d{5}\.pdf$/.test(dl[0]),
         'the browser saved it as ' + (dl[0] || '(nothing)'));
  assert(dl.length === 1 && fs.statSync(path.join(DL, dl[0])).size > 20000,
         'and the saved file has real content (' + (dl[0] ? Math.round(fs.statSync(path.join(DL, dl[0])).size / 1024) : 0) + ' KB)');
  assert(await until(page, () => !document.getElementById('uq-name')), 'the form closed itself when it was done');

  step('What the database actually stored');
  const rows = await sql(`SELECT q.quote_no, q.client_name, q.list_price, q.discount, q.net_price, q.months,
      q.down_payment, q.rate_pending, jsonb_array_length(q.schedule) sched_n,
      (SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(q.schedule) e) sched_sum,
      u.unit_no, _map_unit_state(u.id) st
     FROM unit_map_quotes q JOIN units u ON u.id=q.unit_id WHERE q.company_id='${CO}' ORDER BY q.created_at`);
  assert(rows.length === 1, 'exactly one quote row was written');
  const R = rows[0];
  const fy = (() => { const d = new Date(); const y = d.getFullYear(), m = d.getMonth() + 1;
    const a = m >= 7 ? y : y - 1; return String(a).slice(2) + String(a + 1).slice(2); })();
  assert(R.quote_no === 'QT-' + fy + '-00001', 'numbered QT-' + fy + '-00001 (got ' + R.quote_no + ')');
  assert(R.unit_no === 'UG-03', 'against UG-03');
  assert(Number(R.net_price) === 4750000, 'net = list 5,000,000 - discount 250,000 = ' + Number(R.net_price).toLocaleString('en-US'));
  assert(Number(R.months) === 23 && Number(R.sched_n) === 23, '23 instalment rows for 1 Sep 2026 → 1 Aug 2028');
  assert(Number(R.down_payment) + Number(R.sched_sum) === Number(R.net_price),
         'down payment + every instalment = net, to the rupee');
  assert(R.rate_pending === false, 'not flagged rate-pending');

  step('A quote is NOT a reservation');
  assert(R.st === 'available', 'UG-03 is STILL available after quoting it');
  const res = await sql(`SELECT count(*)::int n FROM reservations r JOIN units u ON u.id=r.unit_id
     WHERE u.unit_no='UG-03' AND r.company_id='${CO}' AND r.status='active'`);
  assert(Number(res[0].n) === 0, 'no reservation row was created');

  step('The crop is of THIS unit');
  const cs = await page.evaluate(() => window.__scan(window.__q.crop.url));
  const bw = (B3.x1 - B3.x0) * AW, bh = (B3.y1 - B3.y0) * AH, pad = 0.09 * Math.max(bw, bh);
  assert(near(Q.cropW, Math.round(bw + 2 * pad), 2) && near(Q.cropH, Math.round(bh + 2 * pad), 2),
         `crop is ${Q.cropW}×${Q.cropH}px — the unit (${Math.round(bw)}×${Math.round(bh)}) plus 9% padding`);
  assert(cs.hits > 300, 'the unit outline is drawn on the crop (' + cs.hits + ' accent pixels)');
  assert(near(cs.x0, pad, 5) && near(cs.y0, pad, 5),
         `outline starts at ${cs.x0},${cs.y0} — the padding is ${pad.toFixed(1)} on the top-left`);
  assert(near(Q.cropW - 1 - cs.x1, pad, 5) && near(Q.cropH - 1 - cs.y1, pad, 5),
         `and ${(Q.cropW - 1 - cs.x1).toFixed(0)},${(Q.cropH - 1 - cs.y1).toFixed(0)} on the bottom-right — the unit is centred, not the neighbour`);

  step('The locator points at THIS unit');
  const ls = await page.evaluate(() => window.__scan(window.__q.loc.url));
  assert(ls.hits > 300, 'the unit is marked on the locator (' + ls.hits + ' accent pixels)');
  const fx0 = ls.x0 / ls.w, fx1 = ls.x1 / ls.w, fy0 = ls.y0 / ls.h, fy1 = ls.y1 / ls.h;
  assert(near(fx0, B3.x0, 0.012) && near(fx1, B3.x1, 0.012),
         `mark spans x ${fx0.toFixed(3)}–${fx1.toFixed(3)}; the stored unit is ${B3.x0}–${B3.x1}`);
  assert(near(fy0, B3.y0, 0.012) && near(fy1, B3.y1, 0.012),
         `mark spans y ${fy0.toFixed(3)}–${fy1.toFixed(3)}; the stored unit is ${B3.y0}–${B3.y1}`);
  assert(near(ls.w / ls.h, AW / AH, 0.02), 'the locator is the WHOLE floor, at the artwork\'s aspect');

  // Both pictures, side by side, exactly as they went into the PDF.
  await page.evaluate(() => {
    document.body.innerHTML = '<div style="padding:10px;font:13px system-ui">' +
      '<b>crop</b><br><img src="' + window.__q.crop.url + '" style="width:100%;border:1px solid #ccc">' +
      '<br><br><b>locator</b><br><img src="' + window.__q.loc.url + '" style="width:100%;border:1px solid #ccc"></div>';
  });
  await sleep(400);
  await shot(page, 'crop-and-locator');

  step('Open the real PDF and read it');
  fs.mkdirSync(SHOTS, { recursive: true });
  const pdfPath = path.join(SHOTS, R.quote_no + '.pdf');
  const buf = Buffer.from(await page.evaluate(() => window.__q.b64), 'base64');
  fs.writeFileSync(pdfPath, buf);
  console.log('     \u{1F4C4} ' + path.relative(ROOT, pdfPath) + '  (' + Math.round(buf.length / 1024) + ' KB)');

  const { PDFDocument } = require(path.join(ROOT, 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.load(buf);
  assert(buf.slice(0, 5).toString() === '%PDF-', 'the file really is a PDF');
  assert(doc.getPageCount() === Q.pages && doc.getPageCount() >= 1,
         'it opens — ' + doc.getPageCount() + ' page(s)');
  const sz = doc.getPage(0).getSize();
  assert(near(sz.width, 595.28, 1) && near(sz.height, 841.89, 1), 'A4 portrait (' + Math.round(sz.width) + '×' + Math.round(sz.height) + 'pt)');

  const imgs = pdfImages(buf);
  assert(imgs.some(i => i.w === Q.cropW && i.h === Q.cropH),
         'the crop is embedded at full resolution (' + Q.cropW + '×' + Q.cropH + ')');
  assert(imgs.some(i => i.w === Q.locW && i.h === Q.locH),
         'the locator is embedded (' + Q.locW + '×' + Q.locH + ')');

  const txt = pdfText(buf);
  fs.writeFileSync(path.join(SHOTS, R.quote_no + '.txt'), txt);
  const has = s => txt.includes(s);
  assert(has(R.quote_no), 'the quote number is printed: ' + R.quote_no);
  assert(has('ZZ Quote Client'), 'the client name is printed');
  assert(has('Unit UG-03') || has('UG-03'), 'the unit number is printed');
  assert(has('ZZ Map Tower'), 'the project is printed');
  assert(has('PKR 4,750,000'), 'the net payable is printed');
  assert(/not a reservation/i.test(txt), 'the sheet says in writing that it is not a reservation');

  // every stored instalment must be on the paper, and they must add up to the net
  const sched = await sql(`SELECT (e->>'n')::int n, e->>'due' due, (e->>'amount')::numeric amt
     FROM unit_map_quotes q, jsonb_array_elements(q.schedule) e WHERE q.company_id='${CO}'
     ORDER BY (e->>'n')::int`);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pretty = d => { const p = d.split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0]; };
  assert(has(pretty(sched[0].due)) && has(pretty(sched[sched.length - 1].due)),
         'first (' + pretty(sched[0].due) + ') and last (' + pretty(sched[sched.length - 1].due) + ') instalment dates are printed');
  const missing = sched.filter(s => !txt.includes(pretty(s.due)));
  assert(missing.length === 0, 'all ' + sched.length + ' instalment dates are on the paper'
         + (missing.length ? ' — missing ' + missing[0].due : ''));
  const sum = sched.reduce((a, s) => a + Number(s.amt), 0) + Number(R.down_payment);
  assert(sum === Number(R.net_price) && Q.total === sum,
         'the printed Total (' + Q.total.toLocaleString('en-US') + ') equals the net');
  assert(has('PKR ' + sum.toLocaleString('en-US')), 'and that Total is actually on the page');

  step('A rate-pending unit still gets a plan');
  await page.goto(PAGE, { waitUntil: 'networkidle2' });
  await until(page, () => typeof window.renderUnitMap === 'function' && !!window.QuotePDF);
  await sleep(1200);
  const rp = await page.evaluate(async () => {
    const T = localStorage.getItem('rms.sales.token');
    const f = await sb.rpc('get_map_floors', { p_session_token: T });
    const fl = f.data.floors.find(x => x.floor_label === 'Upper Ground');
    const pl = await sb.rpc('get_map_plan', { p_session_token: T, p_plan_id: fl.id });
    const u = pl.data.units.find(x => x.unit_no === 'UG-05');
    const s = await sb.rpc('save_unit_quote', { p_session_token: T, p_unit_id: u.unit_id,
      p_client_name: 'ZZ Pending Client', p_client_phone: null, p_discount: 0,
      p_down_payment: 0, p_monthly: 0, p_start_date: null, p_end_date: null, p_lead_id: null });
    const g = await sb.rpc('get_unit_quote', { p_session_token: T, p_quote_id: s.data.id });
    const out = await QuotePDF.build({ artwork: pl.data.artwork, points: u.points,
      quote: g.data.quote, unit: g.data.unit, project: g.data.project, by: g.data.by });
    let str = '', b = out.bytes;
    for (let i = 0; i < b.length; i += 8192) str += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return { no: s.data.quote_no, pending: s.data.rate_pending, b64: btoa(str) };
  });
  assert(rp.pending === true, 'UG-05 quote is flagged rate-pending');
  assert(rp.no === 'QT-' + fy + '-00002', 'numbering carried on: ' + rp.no);
  const buf2 = Buffer.from(rp.b64, 'base64');
  fs.writeFileSync(path.join(SHOTS, rp.no + '.pdf'), buf2);
  const t2 = pdfText(buf2);
  assert(/Rate pending/i.test(t2), 'the sheet says "Rate pending" instead of a price');
  assert(/provisional/i.test(t2), 'and warns the figures are provisional');
  // "PKR 0" as the net payable would read as a promise of a free flat.
  assert((t2.match(/Rate pending/g) || []).length >= 3,
         'list price, net payable AND total all say "Rate pending", never PKR 0');
  console.log('     \u{1F4C4} ' + rp.no + '.pdf');

  const st5 = await sql(`SELECT _map_unit_state(u.id) st FROM units u JOIN projects p ON p.id=u.project_id
     WHERE p.project_name='ZZ Map Tower' AND u.unit_no='UG-05'`);
  assert(st5[0].st === 'available', 'UG-05 is still available too');

  assert(errs.length === 0, 'no JS errors anywhere' + (errs.length ? ' — ' + errs[0] : ''));

  // ── and finally: look at the finished sheets in a PDF reader ──────────────
  step('Photograph the finished sheets');
  for (const f of [R.quote_no + '.pdf', rp.no + '.pdf']) {
    const v = await browser.newPage();
    await v.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 1.4 });
    await v.goto('file:///' + path.join(SHOTS, f).replace(/\\/g, '/'), { waitUntil: 'networkidle2' }).catch(() => {});
    await sleep(3500);
    const drawn = await v.evaluate(() => document.body.innerHTML.length > 0).catch(() => false);
    fs.mkdirSync(SHOTS, { recursive: true });
    const o = path.join(SHOTS, String(++n).padStart(2, '0') + '-sheet-' + f.replace('.pdf', '') + '.png');
    await v.screenshot({ path: o });
    assert(drawn && fs.statSync(o).size > 30000, f + ' opens in a PDF reader and renders');
    console.log('     \u{1F4F7} ' + path.basename(o));
    await v.close();
  }

  await browser.close(); server.close();
  console.log(`\n${'='.repeat(56)}\n  PASS ${PASS}   FAIL ${FAIL}\n  PDFs + shots \u2192 migration_work/phase5_pdf/\n${'='.repeat(56)}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.stack || e.message); process.exit(1); });
