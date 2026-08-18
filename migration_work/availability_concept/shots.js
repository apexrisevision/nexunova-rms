/* Photograph the Availability Tower concept in a real browser — and MEASURE the
   thing that was asked for: is every unit's number actually on its pane, and is
   it big enough to read?

     node migration_work/availability_concept/shots.js

   Every click is page.mouse.click() at real coordinates — see the lesson in
   verify-unitmap-focus.js. Nothing here touches the portal or the database. */
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require('puppeteer-core');
const DIR = __dirname, PORT = 4213, PAGE = `http://127.0.0.1:${PORT}/concept.html`;
const OUT = path.join(DIR, 'shots');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = m => { PASS++; console.log('  ✅ ' + m); };
const bad = m => { FAIL++; console.log('  ❌ ' + m); };
const assert = (c, m) => { c ? ok(m) : bad(m); return !!c; };

function serve(){ return new Promise(r => {
  const s = http.createServer((q, res) => {
    const p = path.join(DIR, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  s.listen(PORT, '127.0.0.1', () => r(s));
}); }

/* Counted in the page: for every pane, does its printed text equal the whole
   unit number, just the tail after the floor prefix, or nothing at all? */
const LABELS = () => ({
  full:  [...document.querySelectorAll('.win')].filter(w => w.textContent === w.dataset.u).length,
  tail:  [...document.querySelectorAll('.win')].filter(w => w.textContent && w.textContent !== w.dataset.u).length,
  blank: [...document.querySelectorAll('.win')].filter(w => !w.textContent).length,
  total: document.querySelectorAll('.win').length,
  px:    parseFloat(getComputedStyle(document.querySelector('.win')).fontSize),
  pane:  (r => Math.round(r.width) + '×' + Math.round(r.height))(document.querySelector('.win').getBoundingClientRect())
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });

  /* A fullPage capture resizes the viewport, which fires the page's own resize
     handler and restarts the power-on sweep — so a fullPage shot photographs an
     unlit building no matter how long you wait first. Grow the viewport once,
     let the lights finish, then take an ordinary screenshot. */
  const shotTall = async n => {
    const vp = page.viewport();
    const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewport(Object.assign({}, vp, { height: Math.min(h + 20, 5200) }));
    // wait for the lights rather than guessing — see the note in the public harness
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.win')].every(w => parseFloat(getComputedStyle(w).opacity) > 0.99),
      { timeout: 12000, polling: 150 });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, n + '.png') });
    await page.setViewport(vp);
    await sleep(500);
    console.log('  📸 ' + n + ' (tall)');
  };
  const shot = async (n, opt) => {
    // every click parks the pointer on a pane, so the hover tag would drift
    // through later photos — only the hover shot is allowed to keep it
    if (!/hover/.test(n)) {
      await page.evaluate(() => { const t = document.getElementById('tag'); if (t) t.classList.remove('on'); });
      await sleep(180);                       // the tag fades out; do not catch it mid-fade
    }
    await page.screenshot(Object.assign({ path: path.join(OUT, n + '.png') }, opt || {}));
    console.log('  📸 ' + n);
  };
  const centre = async sel => page.$eval(sel, el => { const r = el.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 }; });
  const clickSel = async sel => { const c = await centre(sel); await page.mouse.click(c.x, c.y); };
  const project = async i => { await page.evaluate(n => document.querySelector('[data-p="'+n+'"]').click(), i); };

  await page.goto(PAGE, { waitUntil: 'networkidle0' });

  // ── 1 · power-on, restarted so the sweep is caught mid-climb ──────────────
  console.log('\n── KBH');
  await page.evaluate(() => paint());
  await sleep(300); await shot('01a-poweron-300ms');
  await sleep(300); await shot('01b-poweron-600ms');
  await sleep(1500); await shotTall('02-tower-lit-dark');

  // ── 2 · the measurement: numbers on the glass ────────────────────────────
  let m = await page.evaluate(LABELS);
  console.log('     panes ' + m.pane + ' · font ' + m.px + 'px · full ' + m.full +
              ' / tail ' + m.tail + ' / blank ' + m.blank + ' of ' + m.total);
  assert(m.total === 304, 'KBH draws all 304 live units');
  assert(m.blank === 0, 'no pane is left without a number');
  assert(m.full === m.total, 'every pane prints its WHOLE unit number');
  assert(m.px >= 9, 'number is ' + m.px + 'px (≥9px)');

  // nothing may be sliced off: the whole tower, counters included, sits inside the stage
  const fit = await page.evaluate(() => {
    const s = document.querySelector('.stage-in').getBoundingClientRect();
    const bits = [...document.querySelectorAll('.win, .fl-stat, .fl-name')].map(e => e.getBoundingClientRect());
    return { left: Math.min(...bits.map(b => b.left)) - s.left,
             right: s.right - Math.max(...bits.map(b => b.right)) };
  });
  assert(fit.left >= 0 && fit.right >= 0,
    'tower fits the stage (' + Math.round(fit.left) + 'px left, ' + Math.round(fit.right) + 'px right)');

  // a close crop, so the numbers can be judged at true size
  const band = await page.$eval('.rw:nth-child(2) .plate', el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x) - 70, y: Math.round(r.y) - 6, width: Math.round(r.width) + 150, height: Math.round(r.height) + 12 };
  });
  await shot('03-numbers-closeup', { clip: band });

  // ── 2b · on a real desk monitor there is room for one course per floor ───
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1.5 });
  await sleep(1800); await shotTall('03b-desktop-1920');
  const wide19 = await page.evaluate(LABELS);
  console.log('     1920  panes ' + wide19.pane + ' · font ' + wide19.px + 'px · full ' + wide19.full + ' / blank ' + wide19.blank);
  assert(wide19.px >= 11, '1920px window puts the number at ' + wide19.px + 'px');
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
  await sleep(1400);

  // ── 3 · hover + detail ───────────────────────────────────────────────────
  const c = await centre('.win.available');
  await page.mouse.move(c.x, c.y); await sleep(320); await shot('04-hover-glow');
  // park the pointer off the tower, or its tag floats through every later photo
  await page.mouse.move(4, 4); await sleep(200);
  await clickSel('.win.available'); await sleep(600); await shot('05-detail-available');
  await page.mouse.click(200, 500); await sleep(400);

  // ── SOLID: the panes hold still, and the colour is the only signal ───────
  /* Twinkle was removed at the owner's request — on a phone it read as
     restlessness rather than as a building at night. The test that replaces it
     is the same kind of measurement, inverted: photograph the panes at two
     instants and prove NOTHING changed, and read the colours to prove each
     state holds one steady value. */
  const still = () => page.evaluate(() => {
    const m = {};
    document.querySelectorAll('.win').forEach(w => {
      const s = getComputedStyle(w);
      m[w.dataset.u] = s.backgroundColor + '|' + s.filter + '|' + s.opacity;
    });
    return m;
  });
  const anim = await page.evaluate(() => {
    const one = s => getComputedStyle(document.querySelector(s)).animationName;
    return { av: one('.win.available'), sold: one('.win.sold'),
             res: document.querySelector('.win.reserved') ? one('.win.reserved') : 'none' };
  });
  assert(!/twinkle|breathe/.test(anim.av), 'available panes no longer pulse (' + anim.av + ')');
  assert(!/twinkle|breathe/.test(anim.sold) && !/twinkle|breathe/.test(anim.res),
    'and neither do sold or reserved');

  await sleep(2000);
  const S1 = await still(); await shot('04a-solid');
  await sleep(1500);
  const S2 = await still(); await shot('04b-solid-later');
  const moved = Object.keys(S1).filter(k => S1[k] !== S2[k]);
  console.log('     panes that changed in 1.5s: ' + moved.length + ' of ' + Object.keys(S1).length);
  assert(moved.length === 0, 'not one pane changed between two instants — the tower is still');

  const colours = await page.evaluate(() => {
    const by = s => new Set([...document.querySelectorAll('.win.' + s)]
      .map(w => getComputedStyle(w).backgroundColor));
    return { av: [...by('available')], sold: [...by('sold')], res: [...by('reserved')] };
  });
  assert(colours.av.length === 1, 'every available pane is one solid colour: ' + colours.av[0]);
  assert(colours.sold.length === 1, 'every sold pane is one solid colour: ' + colours.sold[0]);
  assert(colours.res.length <= 1, 'and reserved likewise' + (colours.res[0] ? ': ' + colours.res[0] : ''));
  assert(new Set([colours.av[0], colours.sold[0]]).size === 2,
    'available and sold are still told apart by colour alone');

  // "Inventory left" is money — a rep never sees the chip
  const repChips = await page.evaluate(() => [...document.querySelectorAll('.chip .k')].map(e => e.textContent.trim()));
  assert(!repChips.some(c => /Inventory/i.test(c)), 'rep view has no Inventory-left chip: ' + repChips.join(' · '));

  await clickSel('.win.sold'); await sleep(600); await shot('06-detail-sold-rep');
  const repRows = await page.evaluate(() => [...document.querySelectorAll('#cbody .row')].map(r => r.children[0].textContent));
  assert(repRows.includes('Client'), 'rep sold card names the client');
  assert(!repRows.some(r => /Rate|List price|Phone|Outstanding|Paid/.test(r)),
    'rep sold card has no money or contact row: ' + repRows.join(', '));

  await page.evaluate(() => document.querySelector('[data-role="dir"]').click());
  await sleep(400); await shot('07-detail-sold-director');
  const dirChips = await page.evaluate(() => [...document.querySelectorAll('.chip .k')].map(e => e.textContent.trim()));
  const dirRows = await page.evaluate(() => [...document.querySelectorAll('#cbody .row')].map(r => r.children[0].textContent));
  assert(dirChips.some(c => /Inventory/i.test(c)), 'director view shows the Inventory-left chip');
  assert(dirRows.includes('Phone') && dirRows.includes('List price') && dirRows.includes('Outstanding'),
    'director sold card shows contact, price and dues: ' + dirRows.join(', '));
  await page.evaluate(() => document.getElementById('cx').click()); await sleep(400);
  await page.evaluate(() => document.querySelector('[data-role="rep"]').click());

  // ── 3a2 · the summary the owner asked for: counts, no "Sold %" tile ──────
  // switching role repaints, which restarts the power-on sweep — let it finish,
  // or the summary shot is a photograph of an unlit building
  await page.evaluate(() => document.querySelector('[data-role="rep"]').click());
  await sleep(2000); await shot('03c-summary');
  const sum = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip')].map(c => ({
      k: c.querySelector('.k').textContent.trim(),
      v: c.querySelector('.v').textContent.trim(),
      s: (c.querySelector('.s') || {}).textContent.trim() || ''
    }));
    return { chips,
             // the type filter now lives in exactly one place
             typePlaces: new Set([...document.querySelectorAll('[data-t]')]
               .map(e => e.closest('.filters, .brk, .chips') || document.body)).size,
             head: (document.querySelector('.hunt-h b') || {}).textContent || '',
             labels: [...document.querySelectorAll('.f-lb')].map(e => e.textContent.trim()),
             out: (document.getElementById('fout') || {}).innerText.replace(/\s+/g, ' ').trim() };
  });
  console.log('     ' + sum.chips.map(c => c.k + ' ' + c.v).join('  |  '));
  assert(!sum.chips.some(c => /^Sold$/.test(c.k) && /%/.test(c.v)), 'no "Sold %" tile any more');
  const tot = sum.chips.find(c => c.k === 'Total units'), un = sum.chips.find(c => c.k === 'Unsold'),
        sold = sum.chips.find(c => c.k === 'Sold');
  assert(tot && tot.v === '304', 'Total units 304');
  assert(un && un.v === '131' && /131 available · 0 reserved/.test(un.s), 'Unsold 131 (' + un.s + ')');
  assert(sold && sold.v === '173', 'Sold 173 as a COUNT');
  assert(Number(tot.v) === Number(un.v) + Number(sold.v), 'total = unsold + sold');
  assert(sum.typePlaces === 1, 'the type filter exists in exactly one place (' + sum.typePlaces + ')');
  assert(sum.head === 'Filter', 'the filter section is headed "' + sum.head + '"');
  assert(sum.labels.join('/') === 'Type/Budget', 'with two labelled rows: ' + sum.labels.join(', '));
  assert(/Showing 304 of 304 units/.test(sum.out), 'and states its own result: "' + sum.out + '"');

  // the type chip filters the tower
  await page.evaluate(() => [...document.querySelectorAll('#filters .pill')]
    .find(b => b.textContent.trim().startsWith('3 Bed')).click());
  await sleep(400);
  const via = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off')).length,
    chip: (document.querySelector('#filters .pill.on') || {}).textContent
  }));
  assert(via.lit === 22 && /3 Bed/.test(via.chip), 'clicking a type chip filters the tower (' + via.chip.trim() + ')');
  await page.evaluate(() => document.getElementById('clr').click()); await sleep(300);

  // ── 3b · type filter: chips come from the DB, not from a hardcoded list ──
  await page.evaluate(() => document.querySelector('[data-role="rep"]').click());
  await sleep(300);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#filters .pill')].map(p => p.textContent.trim()));
  console.log('     chips → ' + chips.join(' | '));
  assert(chips.some(c => /^2 Bed 130/.test(c)) && chips.some(c => /^1 Bed 126/.test(c)) &&
         chips.some(c => /^Studio 18/.test(c)) && chips.some(c => /^No type 8/.test(c)),
    'KBH chips carry the real type counts');
  // smallest home first — not "whichever type happens to have the most units"
  const order = chips.filter(c => !/^All|Only available/.test(c)).map(c => c.split(/\s+\d+$/)[0].trim());
  assert(JSON.stringify(order) === JSON.stringify(['Studio', '1 Bed', '2 Bed', '3 Bed', 'No type']),
    'chips run in natural order: ' + order.join(' → '));

  await page.evaluate(() => [...document.querySelectorAll('#filters .pill')]
    .find(p => p.textContent.startsWith('2 Bed')).click());
  await sleep(500); await shot('14-filter-2bed');
  const f2 = await page.evaluate(() => {
    const on = [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off'));
    return { lit: on.length, dim: document.querySelectorAll('.win.off').length,
             note: document.getElementById('fout').innerText.replace(/\s+/g, ' ').trim(),
             sample: on.slice(0, 4).map(w => w.dataset.u) };
  });
  assert(f2.lit === 130, '2 Bed leaves exactly its 130 units bright (' + f2.sample.join(', ') + '…)');
  assert(f2.dim === 174, 'and dims the other 174');
  assert(/Showing 130 of 304/.test(f2.note), 'the bar says "' + f2.note + '"');

  // + only available
  await page.evaluate(() => document.querySelector('[data-avail]').click());
  await sleep(500); await shot('15-filter-2bed-available');
  const f3 = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone')).length,
    gone: document.querySelectorAll('.win.gone').length,
    note: document.getElementById('fout').innerText.replace(/\s+/g, ' ').trim()
  }));
  assert(f3.lit > 0 && f3.lit < 130, '"Only available" narrows 2 Bed to ' + f3.lit + ' units');
  assert(f3.gone > 0, 'sold units are blanked out of the facade (' + f3.gone + ')');

  // ── 3b2 · budget typed in PLAIN RUPEES, exactly as the owner asked ────────
  // (still on 2 Bed + Only available from the step above)
  const typeBudget = (mn, mx) => page.evaluate((a, b) => {
    const set = (id, v) => { const e = document.getElementById(id);
      e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('bmin', a); set('bmax', b);
  }, mn, mx);

  await typeBudget('8500000', '10000000');
  await sleep(700); await shot('15b-budget-2bed-85L-1Cr');
  const inBand = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone'))
           .map(w => w.dataset.u),
    note: document.getElementById('fout').innerText.replace(/\s+/g, ' ').trim()
  }));
  const want = await page.evaluate(() => {
    const out = [];
    TOWER_DATA[0].floors.forEach(f => f.units.forEach(u => {
      if (u.s === 'available' && u.t === '2 Bed' && u.p >= 8500000 && u.p <= 10000000) out.push(u.n);
    }));
    return out;
  });
  assert(inBand.lit.length === want.length && inBand.lit.every(u => want.includes(u)),
    'budget 85 L – 1 Cr on 2 Bed lights exactly the ' + want.length + ' units the data says');
  assert(/Showing \d+ of 304/.test(inBand.note), 'the bar reads "' + inBand.note + '"');

  // the owner's own figures: min 4,100,000 → max 10,000,000, all types
  await page.evaluate(() => document.querySelector('#filters .pill[data-t=""]').click());
  await typeBudget('4100000', '10000000');
  await sleep(700); await shot('15b2-budget-41L-1Cr-rupees');
  const raw = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone')).length,
    echo: document.getElementById('bmine').textContent + ' – ' + document.getElementById('bmaxe').textContent,
    want: (() => { let n = 0; TOWER_DATA[0].floors.forEach(f => f.units.forEach(u => {
      if (u.s === 'available' && u.p >= 4100000 && u.p <= 10000000) n++; })); return n; })()
  }));
  assert(raw.lit === raw.want,
    'typing 4100000 – 10000000 in rupees lights the ' + raw.want + ' units in that range');
  assert(raw.echo === '41 L – 1 Cr', 'the boxes read the figures back as "' + raw.echo + '"');

  // a gap the data really has: nothing between 60 and 80 lakh
  await page.evaluate(() => [...document.querySelectorAll('#filters .pill')]
    .find(p => p.textContent.startsWith('2 Bed')).click());
  await typeBudget('6000000', '8000000');
  await sleep(700); await shot('15c-budget-60-80L-empty');
  const gap = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone')).length,
    msg: (document.getElementById('nores') || {}).innerText || ''
  }));
  const realGap = await page.evaluate(() => {
    let n = 0;
    TOWER_DATA[0].floors.forEach(f => f.units.forEach(u => {
      if (u.s === 'available' && u.p >= 6000000 && u.p <= 8000000) n++; }));
    return n;
  });
  assert(gap.lit === realGap, 'KBH has ' + realGap + ' units between 60 and 80 lakh — the tower shows ' + gap.lit);
  assert(/Nothing in this filter/.test(gap.msg), 'and says so plainly: "' + gap.msg.replace(/\n/g, ' — ') + '"');

  // a preset band, all types
  await page.evaluate(() => document.querySelector('#filters .pill[data-t=""]').click());
  await typeBudget('', '');
  await page.evaluate(() => [...document.querySelectorAll('#budget .pill')]
    .find(p => p.textContent.includes('Under 50')).click());
  await sleep(700); await shot('15d-budget-under-50L');
  const u50 = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone')).length,
    want: (() => { let n = 0; TOWER_DATA[0].floors.forEach(f => f.units.forEach(u => {
      if (u.s === 'available' && u.p && u.p <= 5000000) n++; })); return n; })()
  }));
  assert(u50.lit === u50.want, '"Under 50 L" preset lights ' + u50.want + ' units');

  // put the state back where the later steps expect it: 2 Bed · available · any price
  await page.evaluate(() => document.querySelector('#budget .pill[data-b=""]').click());
  await page.evaluate(() => [...document.querySelectorAll('#filters .pill')]
    .find(p => p.textContent.startsWith('2 Bed')).click());
  await sleep(500);

  // ── 3c · price without opening a unit ────────────────────────────────────
  const tip = await page.evaluate(async () => {
    const w = [...document.querySelectorAll('.win.available')].find(x => !x.classList.contains('off'));
    w.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    return { unit: w.dataset.u, text: document.getElementById('tag').textContent };
  });
  assert(/PKR\s[\d,]+/.test(tip.text) || /rate pending/.test(tip.text),
    'hover shows the price straight away — "' + tip.text + '"');

  // ── 3d · cheapest first ──────────────────────────────────────────────────
  await clickSel('#cheap'); await sleep(600); await shot('16-cheapest-2bed');
  const list = await page.evaluate(() => ({
    sub: document.getElementById('lsub').textContent,
    rows: [...document.querySelectorAll('.lrow')].map(r => ({
      u: r.dataset.u,
      p: Number((r.querySelector('.lp').textContent.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''))
    }))
  }));
  const asc = list.rows.every((r, i) => i === 0 || r.p === 0 || list.rows[i-1].p <= r.p);
  assert(list.rows.length > 0, 'the list has ' + list.rows.length + ' available 2 Bed units');
  assert(asc, 'sorted cheapest first — ' + list.rows.slice(0, 3).map(r => r.u + ' ' + r.p).join(' · '));
  const cheapest = await page.evaluate(() => {
    let best = null;
    TOWER_DATA[0].floors.forEach(f => f.units.forEach(u => {
      if (u.s === 'available' && u.t === '2 Bed' && u.p && (!best || u.p < best.p)) best = u;
    }));
    return best;
  });
  assert(list.rows[0].u === cheapest.n && list.rows[0].p === cheapest.p,
    'the top row IS the cheapest 2 Bed in the data (' + cheapest.n + ' @ ' + cheapest.p + ')');

  // clicking a row opens that unit
  await page.evaluate(() => document.querySelector('.lrow').click());
  await sleep(700); await shot('17-cheapest-opened');
  const opened = await page.evaluate(() => document.getElementById('cno').textContent);
  assert(opened === cheapest.n, 'clicking the top row opens ' + opened);
  await page.evaluate(() => document.getElementById('cx').click()); await sleep(300);

  // back to All
  await page.evaluate(() => document.querySelector('#filters .pill[data-t=""]').click());
  await page.evaluate(() => { const t = document.querySelector('[data-avail].on'); if (t) t.click(); });
  await sleep(500);

  // ── 4 · share poster (now carries the free unit numbers) ─────────────────
  await clickSel('#share'); await sleep(500); await shot('08-share-snapshot');
  await page.evaluate(() => document.getElementById('snx').click()); await sleep(300);

  // ── 5 · bigger panes, on demand ──────────────────────────────────────────
  await page.evaluate(() => { document.querySelector('[data-z="1"]').click(); document.querySelector('[data-z="1"]').click(); });
  await sleep(1600); await shot('09-zoomed-panes');
  await page.evaluate(() => { document.querySelector('[data-z="-1"]').click(); document.querySelector('[data-z="-1"]').click(); });
  await sleep(1200);

  // ── 6 · light theme ──────────────────────────────────────────────────────
  await clickSel('#theme'); await sleep(1400); await shotTall('10-tower-lit-light');
  await clickSel('#theme'); await sleep(400);

  // ── 7 · ZZTEST — the only live reservation in the database ───────────────
  console.log('\n── ZZTEST (reservation proof)');
  await project(3); await sleep(1400);
  await shotTall('11-zztest-reserved');
  // look the chip up by its LABEL — the order changed once already when "Sold %"
  // was dropped, and an index-based read silently measured the wrong number
  const zz = await page.evaluate(() => {
    const by = {};
    document.querySelectorAll('.chip').forEach(c => {
      by[c.querySelector('.k').textContent.trim()] =
        { v: c.querySelector('.v').textContent.trim(),
          s: (c.querySelector('.s') || {}).textContent || '' };
    });
    return { reserved: [...document.querySelectorAll('.win.reserved')].map(w => w.dataset.u), chips: by };
  });
  assert(zz.reserved.length === 1 && zz.reserved[0] === 'UG-02',
    'amber pane is the real live reservation: ' + zz.reserved.join(', '));
  assert(/1 reserved/.test(zz.chips['Unsold'].s),
    'the Unsold chip counts it: "' + zz.chips['Unsold'].v + ' — ' + zz.chips['Unsold'].s + '"');

  // ── 8 · the other two projects ───────────────────────────────────────────
  console.log('\n── FMH / Awami');
  await project(1); await sleep(2200); await shotTall('12-fmh-tall');
  m = await page.evaluate(LABELS);
  console.log('     FMH   panes ' + m.pane + ' · font ' + m.px + 'px · full ' + m.full + ' / tail ' + m.tail + ' / blank ' + m.blank);
  assert(m.blank === 0, 'FMH: no unnumbered pane');

  await project(2); await sleep(2600); await shotTall('13-awami-wide');
  m = await page.evaluate(LABELS);
  console.log('     AWAMI panes ' + m.pane + ' · font ' + m.px + 'px · full ' + m.full + ' / tail ' + m.tail + ' / blank ' + m.blank);
  assert(m.blank === 0, 'Awami (1467 units, 305 on one floor): no unnumbered pane');

  console.log('\n' + (errs.length ? '❌ console/page errors:\n  ' + errs.join('\n  ') : '✅ no console errors'));
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  await browser.close(); server.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
