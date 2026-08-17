/**
 * Pull every unit outline onto the drawing's own walls.
 *
 *   node scripts/snap-map-shapes-to-walls.js [artwork_id] [--write]
 *
 * Two attempts at tracing these by eye both shipped borders that ran through the
 * middle of rooms, and the checks I wrote agreed with me because they measured the
 * wrong thing — how pure the colour was INSIDE an outline, which a rectangle drawn
 * within an L-shaped flat passes perfectly. The only question that matters is
 * whether there is a wall under the border, so that is what this optimises.
 *
 * The outlines are rectilinear, so each one is described by a handful of distinct x
 * and y values. Each value is moved, within ±25px, to wherever the drawing's ink
 * actually runs — weighted by how much edge sits on it. Edges that still have no
 * wall beneath them are split and each half snapped on its own, which is how the
 * stepped boundaries get their extra corners.
 *
 * Finally every outline is inset a little, so two neighbours can never touch: with
 * translucent fills, two adjacent units of the same state read as one flat when
 * their borders meet.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4216;
const ART = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2]
          : '3dbfd2ba-43a0-4e54-8391-9f9c451b5a67';
const WRITE = process.argv.includes('--write');
const SEARCH = 40, INSET = 1.5;

function sql(query) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const ref = (mcp.mcpServers.supabase.args.find(a => a.startsWith('--project-ref=')) || '').split('=')[1];
  const body = JSON.stringify({ query });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${ref}/database/query`, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d.slice(0, 400)))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

(async () => {
  const art = await sql(`SELECT image_w w, image_h h, image_path FROM unit_map_artworks WHERE id='${ART}'`);
  if (!art.length) { console.error('artwork not found'); process.exit(1); }
  const W = Number(art[0].w), H = Number(art[0].h);
  const rows = await sql(`SELECT slot_code, points, zone_group FROM unit_map_shapes WHERE artwork_id='${ART}' ORDER BY slot_code`);
  console.log(art[0].image_path + '  ' + W + 'x' + H + '   ' + rows.length + ' outlines\n');

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

  const units = rows.map(r => ({ slot: r.slot_code, zone: r.zone_group,
    pts: r.points.map(p => [Number(p[0]) * W, Number(p[1]) * H]) }));

  const out = await page.evaluate(({ port, units, src, SEARCH, INSET }) => new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onerror = () => resolve({ error: 'artwork failed to load' });
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, W, H).data;
      const ink = (x, y) => {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        const p = (y * W + x) * 4;
        return Math.max(d[p], d[p + 1], d[p + 2]) < 120;
      };
      // is there ink within `tol` of this point?
      const near = (x, y, tol) => {
        for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) if (ink(x + dx, y + dy)) return true;
        return false;
      };
      const inPoly = (px, py, poly) => {
        let on = false;
        for (let a = 0, c = poly.length - 1; a < poly.length; c = a++) {
          const xa = poly[a][0], ya = poly[a][1], xb = poly[c][0], yb = poly[c][1];
          if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) on = !on;
        }
        return on;
      };
      // fraction of a straight run that has ink under it
      const runScore = (fixed, from, to, vertical, tol) => {
        const len = Math.abs(to - from);
        const n = Math.max(2, Math.round(len / 2));
        let hit = 0;
        for (let s = 0; s <= n; s++) {
          const t = from + (to - from) * (s / n);
          if (vertical ? near(fixed, t, tol) : near(t, fixed, tol)) hit++;
        }
        return hit / (n + 1);
      };
      const edgeScore = (poly, tol) => {
        let steps = 0, hit = 0;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          const n = Math.max(1, Math.round(len / 3));
          for (let s = 0; s <= n; s++) {
            const t = s / n;
            steps++;
            if (near(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, tol)) hit++;
          }
        }
        return hit / steps;
      };

      // ── snap the distinct x's and y's of a rectilinear outline ──
      function snapValues(poly) {
        const vx = new Map(), hy = new Map();      // value -> total edge length on it
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length];
          if (Math.abs(a[0] - c[0]) < 0.6) {
            const k = Math.round(a[0]); vx.set(k, (vx.get(k) || 0) + Math.abs(c[1] - a[1]));
          } else if (Math.abs(a[1] - c[1]) < 0.6) {
            const k = Math.round(a[1]); hy.set(k, (hy.get(k) || 0) + Math.abs(c[0] - a[0]));
          }
        }
        const bestFor = (val, vertical) => {
          // the spans this value carries, so the score is about THIS outline's edges
          const spans = [];
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i], c = poly[(i + 1) % poly.length];
            if (vertical && Math.abs(a[0] - c[0]) < 0.6 && Math.round(a[0]) === val) spans.push([a[1], c[1]]);
            if (!vertical && Math.abs(a[1] - c[1]) < 0.6 && Math.round(a[1]) === val) spans.push([a[0], c[0]]);
          }
          let best = val, bestS = -1;
          for (let off = -SEARCH; off <= SEARCH; off++) {
            const cand = val + off;
            let tot = 0, wsum = 0;
            spans.forEach(sp => {
              const w = Math.abs(sp[1] - sp[0]) || 1;
              tot += runScore(cand, sp[0], sp[1], vertical, 2) * w; wsum += w;
            });
            const s = wsum ? tot / wsum : 0;
            if (s > bestS + 1e-6 || (Math.abs(s - bestS) <= 1e-6 && Math.abs(off) < Math.abs(best - val))) {
              bestS = s; best = cand;
            }
          }
          return best;
        };
        const mapX = new Map(), mapY = new Map();
        [...vx.keys()].forEach(v => mapX.set(v, bestFor(v, true)));
        [...hy.keys()].forEach(v => mapY.set(v, bestFor(v, false)));
        return poly.map(p => [mapX.has(Math.round(p[0])) ? mapX.get(Math.round(p[0])) : p[0],
                              mapY.has(Math.round(p[1])) ? mapY.get(Math.round(p[1])) : p[1]]);
      }

      /* ── split any edge that still has no wall under it, snap the halves ──
         Worked on EDGES, not points. Splitting a vertical run into two runs at
         different x needs a horizontal connector between them, and rebuilding from
         moved points instead of from edges is how the first attempt produced
         diagonal sides and made 15 worse than it started. */
      const toEdges = poly => {
        const e = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length];
          if (Math.abs(a[0] - c[0]) <= Math.abs(a[1] - c[1])) e.push({ t: 'V', v: a[0], a: a[1], b: c[1] });
          else e.push({ t: 'H', v: a[1], a: a[0], b: c[0] });
        }
        return e;
      };
      const toPoints = edges => {
        const pts = [];
        for (let i = 0; i < edges.length; i++) {
          const prev = edges[(i - 1 + edges.length) % edges.length], cur = edges[i];
          if (prev.t === cur.t) continue;                       // degenerate, drop
          pts.push(cur.t === 'H' ? [prev.v, cur.v] : [cur.v, prev.v]);
        }
        const clean = [];
        pts.forEach(p => {
          const q = clean[clean.length - 1];
          if (!q || Math.abs(q[0] - p[0]) > 0.5 || Math.abs(q[1] - p[1]) > 0.5) clean.push(p);
        });
        if (clean.length > 2) {
          const f = clean[0], l = clean[clean.length - 1];
          if (Math.abs(f[0] - l[0]) < 0.5 && Math.abs(f[1] - l[1]) < 0.5) clean.pop();
        }
        return clean;
      };
      const bestOffset = (fixed, from, to, vertical) => {
        let best = fixed, bestS = -1;
        for (let off = -SEARCH; off <= SEARCH; off++) {
          const s = runScore(fixed + off, from, to, vertical, 2);
          if (s > bestS + 1e-6 || (Math.abs(s - bestS) <= 1e-6 && Math.abs(off) < Math.abs(best - fixed))) {
            bestS = s; best = fixed + off;
          }
        }
        return { v: best, s: bestS };
      };
      function splitWeak(poly, rounds) {
        let edges = toEdges(poly);
        for (let r = 0; r < rounds; r++) {
          const next = [];
          let changed = false;
          edges.forEach(e => {
            const vertical = e.t === 'V';
            const len = Math.abs(e.b - e.a);
            if (len < 45) { next.push(e); return; }
            const sc = runScore(e.v, e.a, e.b, vertical, 2);
            if (sc > 0.85) { next.push(e); return; }
            const mid = (e.a + e.b) / 2;
            const p1 = bestOffset(e.v, e.a, mid, vertical), p2 = bestOffset(e.v, mid, e.b, vertical);
            if (Math.abs(p1.v - p2.v) < 1.5 || (p1.s + p2.s) / 2 < sc + 0.08) { next.push(e); return; }
            changed = true;
            next.push({ t: e.t, v: p1.v, a: e.a, b: mid });
            next.push({ t: vertical ? 'H' : 'V', v: mid, a: p1.v, b: p2.v });
            next.push({ t: e.t, v: p2.v, a: mid, b: e.b });
          });
          edges = next;
          if (!changed) break;
        }
        return toPoints(edges);
      }

      // ── pull the whole outline inward so neighbours never touch ──
      function inset(poly, by) {
        const out = poly.map(p => p.slice());
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length];
          const vertical = Math.abs(a[0] - c[0]) < 0.6;
          const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
          // which side is the inside?
          const dir = vertical ? (inPoly(mx + 2, my, poly) ? 1 : -1) : (inPoly(mx, my + 2, poly) ? 1 : -1);
          const j = (i + 1) % poly.length;
          if (vertical) { out[i][0] += dir * by; out[j][0] += dir * by; }
          else { out[i][1] += dir * by; out[j][1] += dir * by; }
        }
        return out;
      }

      const area = poly => {
        let a = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
        }
        return Math.abs(a / 2);
      };

      const res = units.map(u => {
        const before = edgeScore(u.pts, 6);
        const a0 = area(u.pts);
        const plain = snapValues(u.pts);
        let p = snapValues(splitWeak(plain, 2));
        // A wall is not worth chasing into the neighbour's flat. Splitting found a
        // real boundary for most units and a wander for unit 11, so anything that
        // inflates the outline falls back to the plain snap.
        let note = '';
        if (area(p) > a0 * 1.8) { p = plain; note = 'split rejected (grew too much)'; }
        if (area(p) > a0 * 1.8) { p = u.pts.map(q => q.slice()); note = 'snap rejected (grew too much)'; }
        const afterRaw = edgeScore(p, 6);
        p = inset(p, INSET);
        return { slot: u.slot, zone: u.zone, before, after: afterRaw, note,
                 corners: [u.pts.length, p.length],
                 pts: p.map(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) };
      });
      resolve({ res });
    };
    img.src = 'http://127.0.0.1:' + port + '/' + src;
  }), { port: PORT, units, src: art[0].image_path, SEARCH, INSET });

  await b.close(); srv.close();
  if (out.error) { console.error(out.error); process.exit(1); }

  out.res.sort((a, c) => a.after - c.after);
  console.log('  slot    on-wall before → after   corners');
  out.res.forEach(r => console.log('  ' + r.slot.padEnd(6) +
    (r.before * 100).toFixed(0).padStart(8) + '% → ' + (r.after * 100).toFixed(0).padStart(3) + '%' +
    '      ' + r.corners[0] + ' → ' + r.corners[1] + (r.note ? '   ' + r.note : '')));
  const worst = out.res.filter(r => r.after < 0.95);
  console.log('\n  below 95%: ' + (worst.length ? worst.map(r => r.slot + ' (' + (r.after * 100).toFixed(0) + '%)').join(', ') : 'none'));

  if (WRITE) {
    const byName = {};
    out.res.forEach(r => { byName[r.slot] = { pts: r.pts, zone: r.zone }; });
    fs.writeFileSync(path.join(ROOT, 'migration_work', 'kbh_live', 'snapped_shapes.json'),
      JSON.stringify({ W, H, units: byName }, null, 1));
    console.log('\n  → migration_work/kbh_live/snapped_shapes.json');
  } else {
    console.log('\n  (dry run — pass --write to save the snapped geometry)');
  }
})().catch(e => { console.error('ERROR:', e.stack || e.message); process.exit(1); });
