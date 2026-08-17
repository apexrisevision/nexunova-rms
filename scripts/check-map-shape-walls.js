/**
 * IS THERE A WALL UNDER THE BORDER?
 *
 *   node scripts/check-map-shape-walls.js [artwork_id] [tolerance]
 *
 * The question the earlier checks never asked, and the reason two rounds of
 * hand-tracing shipped borders running through the middle of rooms. Bounding-box
 * overlap could not see it. Colour purity could not see it either — a rectangle
 * drawn wholly inside an L-shaped flat is 100% pure and still wrong.
 *
 * So: walk every edge of every outline in the artwork's own coordinates and look for
 * the drawing's own ink within a few pixels. Perimeter with no wall beneath it is
 * border in the wrong place, and the first few such stretches are printed so they can
 * be found on the sheet.
 *
 * Run it with scripts/check-map-shape-overlap.js — one says the borders are on the
 * walls, the other says no two units claim the same ground.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4215;
const ART = process.argv[2] || '3dbfd2ba-43a0-4e54-8391-9f9c451b5a67';

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

(async () => {
  const art = await sql(`SELECT image_w w, image_h h, image_path FROM unit_map_artworks WHERE id='${ART}'`);
  const W = Number(art[0].w), H = Number(art[0].h);
  const rows = await sql(`SELECT slot_code, points FROM unit_map_shapes WHERE artwork_id='${ART}' ORDER BY slot_code`);

  const srv = http.createServer((q, res) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(p).pipe(res);
  }).listen(PORT, '127.0.0.1');
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  const b = await puppeteer.launch({ executablePath: exe, headless: 'new',
    args: ['--no-sandbox'], protocolTimeout: 900000 });
  const page = await b.newPage();
  await page.setContent('<body></body>');

  const units = rows.map(r => ({ slot: r.slot_code, pts: r.points.map(p => [Number(p[0]) * W, Number(p[1]) * H]) }));
  const TOL = Number(process.argv[3] || 6);

  const out = await page.evaluate(({ port, units, src, TOL }) => new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onerror = () => resolve([]);
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, W, H).data;
      const dark = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return true;      // off the sheet counts as an edge
        const p = ((y | 0) * W + (x | 0)) * 4;
        return Math.max(d[p], d[p + 1], d[p + 2]) < 120;
      };
      const wallNear = (x, y) => {
        for (let dy = -TOL; dy <= TOL; dy++) for (let dx = -TOL; dx <= TOL; dx++) {
          if (dark(x + dx, y + dy)) return true;
        }
        return false;
      };
      resolve(units.map(u => {
        let steps = 0, onWall = 0;
        const gaps = [];
        for (let i = 0; i < u.pts.length; i++) {
          const a = u.pts[i], c = u.pts[(i + 1) % u.pts.length];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          const n = Math.max(1, Math.round(len / 3));
          let runStart = null;
          for (let s = 0; s <= n; s++) {
            const t = s / n, x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t;
            steps++;
            if (wallNear(x, y)) { onWall++; if (runStart !== null) { gaps.push(runStart); runStart = null; } }
            else if (runStart === null) runStart = [Math.round(x), Math.round(y)];
          }
          if (runStart !== null) gaps.push(runStart);
        }
        return { slot: u.slot, pct: onWall / steps, steps, gaps: gaps.slice(0, 4) };
      }));
    };
    img.src = 'http://127.0.0.1:' + port + '/' + src;
  }), { port: PORT, units, src: art[0].image_path, TOL });

  out.sort((a, c) => a.pct - c.pct);
  console.log('how much of each outline has a WALL under it (tolerance ' + TOL + 'px)\n');
  console.log('  slot    on wall    first stretches with NO wall beneath (artwork px)');
  out.forEach(r => console.log('  ' + r.slot.padEnd(6) +
    (r.pct * 100).toFixed(0).padStart(5) + '%     ' +
    (r.pct > 0.97 ? '—' : r.gaps.map(g => g[0] + ',' + g[1]).join('   '))));
  const bad = out.filter(r => r.pct < 0.9);
  console.log('\n  ' + bad.length + ' outline(s) below 90%: ' + (bad.map(r => r.slot).join(', ') || 'none'));
  await b.close(); srv.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
