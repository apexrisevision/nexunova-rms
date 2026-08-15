/**
 * Fills artwork A with all 30 outlines, through the real admin session and the
 * real save_map_shape RPC — no direct SQL. Rough grid geometry: this exists so the
 * viewer has something to render, not to be the final draughting.
 *
 *   node scripts/seed-phase5-shapes.js
 */
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4195;
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function env() {
  const o = {};
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).forEach(l => {
    if (/^\s*#/.test(l) || !l.includes('=')) return;
    const i = l.indexOf('='); o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  return o;
}
(async () => {
  const E = env();
  const server = http.createServer((q, res) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(PORT, '127.0.0.1');

  const exe = BROWSERS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(`http://127.0.0.1:${PORT}/login.html`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(c => {
    const set = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    const ins = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null);
    set(ins.find(i => /user/i.test(i.id + i.name + i.placeholder)) || ins.find(i => i.type === 'text'), c.us + '@' + c.co);
    set(ins.find(i => i.type === 'password'), c.pw);
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && /sign in|login/i.test(x.textContent));
    if (b) b.click();
  }, { co: E.RMS_ADMIN_CO, us: E.RMS_ADMIN_USER, pw: E.RMS_ADMIN_PW });
  await page.waitForFunction(() => typeof window.nav === 'function' && !!document.getElementById('pg-unitmap'), { timeout: 25000 });
  await new Promise(r => setTimeout(r, 1500));

  await page.evaluate(() => nav('unitmap'));
  await page.waitForFunction(() => !!document.querySelector('#um-body table'), { timeout: 20000 });
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('#um-body tbody tr')].find(x => /ZZ Map Tower/.test(x.textContent));
    r.querySelector('button').click();
  });
  await page.waitForFunction(() => !!document.querySelector('#um-slot'), { timeout: 20000 });

  const out = await page.evaluate(async () => {
    const slots = [...document.querySelectorAll('#um-slot option')].map(o => o.value).filter(Boolean);
    const COLS = 6, W = 0.13, H = 0.13, X0 = 0.06, Y0 = 0.10, GX = 0.148, GY = 0.155;
    let ok = 0, fail = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], c = i % COLS, r = Math.floor(i / COLS);
      const x = X0 + c * GX, y = Y0 + r * GY;
      const pts = [[x, y], [x + W, y], [x + W, y + H], [x, y + H]].map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]);
      const zone = /^(10|17)[A-C]$/.test(s) ? s.slice(0, 2) : null;
      const res = await supabase.rpc('save_map_shape', {
        p_artwork_id: UM.artId, p_slot_code: s, p_points: pts,
        p_label_x: +(x + W / 2).toFixed(4), p_label_y: +(y + H / 2).toFixed(4), p_zone_group: zone });
      if (res.data && res.data.success) ok++; else fail.push(s + ':' + JSON.stringify(res.data));
    }
    return { total: slots.length, ok, fail };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
  process.exit(out.fail.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
