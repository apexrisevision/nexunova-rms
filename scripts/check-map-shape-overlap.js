/**
 * Do any two unit outlines share ground? — REAL polygon overlap, not bounding boxes.
 *
 *   node scripts/check-map-shape-overlap.js [artwork_id]
 *
 * The earlier check compared bounding BOXES with a 400px² tolerance, which is why a
 * polygon drawn as a fat square over an L-shaped flat — swallowing half of the
 * neighbour's bathroom — sailed through. This one rasterises every outline at the
 * artwork's own resolution and counts the cells two units both claim. Two flats
 * cannot occupy the same square foot, so any shared cell at all is a defect.
 *
 * It also reports how much of each polygon is NOT the flat it names: a rectangle
 * laid over an L-shaped unit covers corridor and neighbour, and that shows up as
 * area the drawing does not agree with.
 */
const fs = require('fs'), path = require('path'), https = require('https');
const ROOT = path.resolve(__dirname, '..');
const ART = process.argv[2] || '3dbfd2ba-43a0-4e54-8391-9f9c451b5a67';   // KBH artwork A

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

// scanline fill of one polygon into the owner grid
function fill(poly, W, H, owner, id, clash) {
  const ys = poly.map(p => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  let area = 0;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5, xs = [];
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const ya = poly[a][1], yb = poly[b][1];
      if ((ya > yc) !== (yb > yc)) {
        xs.push((poly[b][0] - poly[a][0]) * (yc - ya) / (yb - ya) + poly[a][0]);
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xa; x <= xb; x++) {
        const k = y * W + x;
        area++;
        if (owner[k] === 0) owner[k] = id;
        else {
          const key = Math.min(owner[k], id) + ':' + Math.max(owner[k], id);
          clash.set(key, (clash.get(key) || 0) + 1);
        }
      }
    }
  }
  return area;
}

// Reading the artwork's pixels needs a canvas, so this half runs in a browser.
async function colourPurity(rows, W, H, imgPath) {
  const http = require('http'), puppeteer = require('puppeteer-core');
  const PORT = 4214;
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
  const out = await page.evaluate(({ port, units, src }) => new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onerror = () => resolve([]);
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, W, H).data;
      const q = v => Math.round(v / 24);
      const isFill = (r, g, bl) => {
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        return !(mx > 244 && mn > 236) && mx >= 100 && (mx - mn) >= 14 &&
               !(r > 200 && g > 170 && bl < 150 && r - bl > 60);
      };
      const inPoly = (px, py, poly) => {
        let on = false;
        for (let a = 0, c = poly.length - 1; a < poly.length; c = a++) {
          const xa = poly[a][0], ya = poly[a][1], xb = poly[c][0], yb = poly[c][1];
          if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) on = !on;
        }
        return on;
      };
      resolve(units.map(u => {
        const xs = u.pts.map(p => p[0]), ys = u.pts.map(p => p[1]);
        const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
        const hist = new Map(); let fillPx = 0, total = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (!inPoly(x + 0.5, y + 0.5, u.pts)) continue;
          total++;
          const p = (y * W + x) * 4;
          if (!isFill(d[p], d[p + 1], d[p + 2])) continue;
          fillPx++;
          const k = q(d[p]) + ',' + q(d[p + 1]) + ',' + q(d[p + 2]);
          hist.set(k, (hist.get(k) || 0) + 1);
        }
        // One flat's fill can land in two neighbouring quantisation buckets through
        // shading and anti-aliasing. Merge buckets that are near-identical colours
        // first, or a perfectly good outline reads as if it straddled two flats.
        const buckets = [...hist.entries()].map(([k, n]) => ({ c: k.split(',').map(Number), n }))
          .sort((a, c) => c.n - a.n);
        const merged = [];
        buckets.forEach(b => {
          const near = merged.find(m => Math.abs(m.c[0] - b.c[0]) <= 1 &&
                                        Math.abs(m.c[1] - b.c[1]) <= 1 && Math.abs(m.c[2] - b.c[2]) <= 1);
          if (near) near.n += b.n; else merged.push({ c: b.c, n: b.n });
        });
        merged.sort((a, c) => c.n - a.n);
        return { slot: u.slot, coloured: fillPx / Math.max(1, total),
                 first: (merged[0] ? merged[0].n : 0) / Math.max(1, fillPx),
                 second: (merged[1] ? merged[1].n : 0) / Math.max(1, fillPx) };
      }));
    };
    img.src = 'http://127.0.0.1:' + port + '/' + src;
  }), { port: PORT, units, src: imgPath });
  await b.close(); srv.close();
  return out.sort((a, c) => c.second - a.second);
}

(async () => {
  const art = await sql(`SELECT image_w w, image_h h, image_path FROM unit_map_artworks WHERE id='${ART}'`);
  if (!art.length) { console.error('artwork not found'); process.exit(1); }
  const W = Number(art[0].w), H = Number(art[0].h);
  const rows = await sql(`SELECT slot_code, points FROM unit_map_shapes WHERE artwork_id='${ART}' ORDER BY slot_code`);
  console.log(`artwork ${art[0].image_path}  ${W}x${H}   shapes: ${rows.length}\n`);

  const owner = new Int16Array(W * H);
  const clash = new Map();
  const areas = {};
  rows.forEach((r, i) => {
    const poly = r.points.map(p => [Number(p[0]) * W, Number(p[1]) * H]);
    areas[r.slot_code] = fill(poly, W, H, owner, i + 1, clash);
  });
  const name = i => rows[i - 1].slot_code;

  let bad = 0;
  if (clash.size === 0) {
    console.log('  ✅ no two outlines share a single square pixel');
  } else {
    const list = [...clash.entries()].map(([k, n]) => {
      const [a, b] = k.split(':').map(Number);
      return { a: name(a), b: name(b), n,
               pa: n / areas[name(a)], pb: n / areas[name(b)] };
    }).sort((x, y) => y.n - x.n);
    console.log('  ❌ ' + list.length + ' overlapping pair(s):\n');
    console.log('     pair            shared px     % of A    % of B');
    list.forEach(o => {
      console.log('     ' + (o.a + ' ↔ ' + o.b).padEnd(16) +
        String(o.n).padStart(9) + '   ' +
        (o.pa * 100).toFixed(1).padStart(7) + '%  ' + (o.pb * 100).toFixed(1).padStart(7) + '%');
    });
    bad = list.length;
    console.log('\n     Two flats cannot occupy the same square foot. Every pair above is a defect.');
  }

  // A rectangle laid over an L-shaped flat also eats corridor. Report the shape's
  // "squareness" so the fat ones are easy to find even when they miss a neighbour.
  console.log('\n  outline shape (area ÷ its own bounding box):');
  const sq = rows.map(r => {
    const xs = r.points.map(p => Number(p[0]) * W), ys = r.points.map(p => Number(p[1]) * H);
    const bb = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return { slot: r.slot_code, corners: r.points.length, ratio: areas[r.slot_code] / bb };
  }).sort((a, b) => b.ratio - a.ratio);
  const rect = sq.filter(s => s.corners === 4);
  console.log('     ' + rect.length + ' of ' + rows.length + ' outlines are plain 4-corner rectangles: ' +
    rect.map(s => s.slot).join(', '));

  // ── does any outline stand on a NEIGHBOUR'S flat? ────────────────────────
  // Two shrunken rectangles never overlap each other and still both sit wrong, so
  // polygon-vs-polygon is only half the test. Each flat on this drawing is one solid
  // pastel: an outline that keeps to its own flat is dominated by ONE colour, and one
  // that has eaten the neighbour shows a second.
  const straddle = await colourPurity(rows, W, H, art[0].image_path);
  console.log('\n  second colour inside each outline (a neighbour showing through):');
  const off = straddle.filter(s => s.second > 0.09 && s.coloured > 0.4);
  straddle.slice(0, 6).forEach(s => console.log('     ' + s.slot.padEnd(5) +
    (s.coloured * 100).toFixed(0).padStart(5) + '% coloured   dominant ' +
    (s.first * 100).toFixed(0).padStart(3) + '%   second ' + (s.second * 100).toFixed(0).padStart(3) + '%' +
    (off.some(o => o.slot === s.slot) ? '   ← STANDS ON A NEIGHBOUR' : '')));
  const white = straddle.filter(s => s.coloured <= 0.4).map(s => s.slot);
  if (white.length) console.log('     (' + white.join(', ') + ' are drawn uncoloured on this sheet — judged by eye, not colour)');
  if (off.length) { bad += off.length; console.log('\n  ❌ ' + off.length + ' outline(s) stand on a neighbouring flat: ' + off.map(o => o.slot).join(', ')); }
  else console.log('     ✅ none');

  console.log('\n' + '='.repeat(56));
  console.log(bad ? '  FAIL — ' + bad + ' problem(s)' : '  PASS — no overlaps, none standing on a neighbour');
  console.log('='.repeat(56));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
