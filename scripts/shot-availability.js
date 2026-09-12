/**
 * PUBLIC AVAILABILITY — screenshot it, and assert the things that cannot be
 * seen in a screenshot.
 *
 * TWO SOURCES, ON PURPOSE.
 *
 *   · The CONTRACT is verified end to end on ZZTEST, where a link is created
 *     and revoked through the real director path. That proves the token, the
 *     permissions and the payload shape against the real function over the real
 *     wire.
 *   · The SCALE screens are photographed with Awami's real payload, captured
 *     through the same function inside a transaction that is rolled back. No
 *     Awami link is created — Rashid creates that one himself and sees the token
 *     once. Nothing this script does reaches availability_links.
 *
 * Seven screenshots and the assertions he named: the DOM never holds more than
 * one floor's units, price appears nowhere, and an unavailable unit produces no
 * sheet.
 *
 *   node scripts/shot-availability.js
 */
const fs = require('fs'), path = require('path'), http = require('http'),
      https = require('https'), puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4196, BASE = 'http://127.0.0.1:' + PORT;
const OUT  = path.join(ROOT, 'marketing_shots', 'availability');
const AWAMI_CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const AWAMI_PR = '59ded55b-9bc2-45b2-a372-49fc31807fa9';
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let FAILED = false;
const ok  = m => console.log('  \u2705 ' + m);
const bad = m => { console.log('  \u274C ' + m); FAILED = true; };
const step = t => console.log('\n\u2500\u2500 ' + t);

function sql(q) {
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const body = JSON.stringify({ query: q });
  return new Promise((res, rej) => {
    const r = https.request({ hostname: 'api.supabase.com',
      path: '/v1/projects/itqxljtfbrppntgyfush/database/query', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) } },
      x => { let d = ''; x.on('data', c => d += c);
             x.on('end', () => x.statusCode < 300 ? res(JSON.parse(d || '[]')) : rej(new Error(d))); });
    r.on('error', rej); r.write(body); r.end();
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
               '.json': 'application/json', '.woff2': 'font/woff2' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      let p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      // mirror the vercel rewrite: /a/<token> serves the same file
      if (/^\/a\/[A-Za-z0-9_-]{8,}$/.test(q.url.split('?')[0])) p = path.join(ROOT, 'availability.html');
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404); return res.end('nf');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter(n => /\.png$/.test(n)).forEach(n => fs.unlinkSync(path.join(OUT, n)));

  /* Counted BEFORE anything runs, so "untouched" is a comparison rather than
     an assumption about what Rashid has done in the meantime. */
  const AWAMI_LINKS_BEFORE = (await sql(`SELECT count(*)::int n, count(*) FILTER (WHERE revoked)::int r
                                           FROM public.availability_links
                                          WHERE project_id = '${AWAMI_PR}';`))[0];

  /* ── 1. THE PAYLOAD, from the real function, without creating a link ───── */
  step('The payload — real function, real Awami, rolled back');
  const cap = await sql(`
    BEGIN;
    INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
    VALUES (public._availability_token_hash('shot_avail_probe'),
            '${AWAMI_CO}','${AWAMI_PR}','SHOT PROBE — rolled back');
    CREATE TEMP TABLE cap ON COMMIT DROP AS
      SELECT public.get_public_availability('shot_avail_probe') AS d;
    SELECT d::text AS payload, length(d::text) AS bytes FROM cap;
    ROLLBACK;`);
  const payload = JSON.parse(cap[0].payload);
  const bytes = Number(cap[0].bytes);
  const units = (payload.floors || []).reduce((n, f) => n + f.units.length, 0);
  console.log('  payload ' + bytes.toLocaleString() + ' bytes  ·  ' +
              payload.floors.length + ' floors  ·  ' + units.toLocaleString() + ' units');

  /* ── WHAT MAY BE ON THE WIRE, AND WHERE ────────────────────────────────
     For most of this page's life the answer was: never a price. The link is a
     URL that can be forwarded to anybody. Rashid asked for Awami's totals on
     it — his to decide about his own building, and nobody else's — so it is a
     switch per project, and this lock now has two sides. Awami must carry the
     register's own total on every unit. A project without the switch must
     carry none at all, which is checked on ZZTEST further down.

     Still refused everywhere: the RATE per square foot, and anything that
     reads like a discount. A total is what the office sells at; the rate is
     how the office arrived at it. */
  payload.show_price === true
    ? ok('this project publishes its prices, and the payload says so')
    : bad('Awami is switched to publish prices and the payload does not say so');
  !/per_sqft|per sq|discount|base_price/i.test(cap[0].payload)
    ? ok('and still no rate and no discount, by raw text search of the whole payload')
    : bad('the payload carries more than a total');

  const book = await sql(`SELECT unit_no, base_price::float8 AS v FROM public.units
                           WHERE project_id = '${AWAMI_PR}'
                             AND public._map_unit_state(id) <> 'retired';`);
  const said = {};
  payload.floors.forEach(fl => fl.units.forEach(u => { said[u.n] = u.v; }));
  const wrong = book.filter(r => Number(said[r.unit_no]) !== Number(r.v));
  (wrong.length === 0)
    ? ok('every one of the ' + book.length + ' units carries the register\u2019s own total \u2014 ' +
         'nothing rounded and nothing recalculated on the way out')
    : bad(wrong.length + ' carry a different total from the register, first: ' +
          wrong[0].unit_no + ' register ' + wrong[0].v + ' payload ' + said[wrong[0].unit_no]);
  const keys = new Set();
  payload.floors.forEach(f => f.units.forEach(u => Object.keys(u).forEach(k => keys.add(k))));
  /* Seven, and no more: the number, the state, the area, the type, the total,
     the KIND of hold and the name it was held ON. The type joined them when
     the floor plan had to write the architect's own label, the total when
     Rashid asked for Awami's prices on the link, and k and w on 2026-09-10
     when he asked for the statuses themselves — "hamain zaroorat hai status ki
     proper… aur wo kis ne hold sold kia hai". Everything else about a unit is
     still none of an outsider's business: not the buyer, not the phone, not
     the amount, not the note, not who at the desk pressed the button. This
     list is a lock, not a description — an eighth key fails here before
     anybody has to notice it on the page. */
  JSON.stringify([...keys].sort()) === JSON.stringify(['a', 'k', 'n', 's', 't', 'v', 'w'])
    ? ok('a unit carries exactly: ' + [...keys].sort().join(', '))
    : bad('unexpected unit keys: ' + [...keys].sort().join(', '));
  /* AND THE TWO NEW ONES RIDE ONLY ON A UNIT THAT IS ALREADY GONE. A free
     shop that carried a kind would be telling a dealer about a hold that was
     lifted, which is worse than telling them nothing. */
  {
    const all = payload.floors.flatMap(f => f.units);
    const freeLeak = all.filter(u => u.s === 'available' && ('k' in u || 'w' in u));
    const heldBare = all.filter(u => u.s !== 'available' && !u.k);
    const held = all.filter(u => u.s !== 'available');
    (held.length > 0 && freeLeak.length === 0 && heldBare.length === 0)
      ? ok('all ' + held.length + ' held units say what kind of hold, and no free one does — ' +
           [...new Set(held.map(u => u.k))].sort().join(', '))
      : bad(held.length === 0
            ? 'no held units in the payload — this check proves nothing'
            : freeLeak.length + ' free unit(s) carry a kind, ' + heldBare.length + ' held ones carry none');
    const named = held.filter(u => u.w);
    named.length
      ? ok('and ' + named.length + ' of them name whose word it was held on')
      : bad('not one held unit says on whose word — reservations.requested_by_name is not reaching the wire');
  }
  const states = new Set();
  payload.floors.forEach(f => f.units.forEach(u => states.add(u.s)));
  [...states].every(s => s === 'available' || s === 'not_available')
    ? ok('two states only: ' + [...states].join(', '))
    : bad('a third state reached the wire: ' + [...states].join(', '));
  payload.area_unit
    ? ok('area_unit is sent once for the project: ' + payload.area_unit)
    : bad('area_unit missing from the payload');
  /* ORDER. The floor grid and the search results are drawn in payload order,
     so this is the only place it can be checked. */
  {
    const big2 = payload.floors.reduce((a, b) => (b.units.length > a.units.length ? b : a));
    const want = await sql(`
      SELECT u.unit_no FROM public.units u
       WHERE u.project_id = '${AWAMI_PR}'
         AND COALESCE(NULLIF(u.floor_label,''),'\u2014') = $q$${big2.floor_label}$q$
         AND public._map_unit_state(u.id) <> 'retired'
       ORDER BY COALESCE(NULLIF(regexp_replace(u.unit_no,'[^0-9]','','g'),'')::bigint, 0), u.unit_no;`);
    const got = big2.units.map(u => u.n);
    JSON.stringify(got) === JSON.stringify(want.map(r => r.unit_no))
      ? ok('units come unit-wise, not alphabetically: ' + got.slice(0, 5).join(', ') + ' \u2026')
      : bad('order is wrong on ' + big2.floor_label + '. got ' +
            JSON.stringify(got.slice(0, 6)) + ' want ' + JSON.stringify(want.slice(0, 6).map(r => r.unit_no)));
    /* The specific thing that was wrong: a three-digit number wedged between
       two two-digit ones. */
    const i10 = got.indexOf(got.find(n => /(^|\D)10$/.test(n)));
    const i100 = got.findIndex(n => /(^|\D)100$/.test(n));
    (i10 < 0 || i100 < 0 || i100 > i10 + 1)
      ? ok('no three-digit unit is wedged in among the two-digit ones')
      : bad('unit 100 still follows unit 10 immediately');
  }

  bytes < 150 * 1024
    ? ok('payload is ' + Math.round(bytes / 1024) + ' KB, under the 150 KB ceiling')
    : bad('payload is ' + Math.round(bytes / 1024) + ' KB');

  /* ── DURATIONS OUT OF RANGE ─────────────────────────────────────────────
     Clamped to the desk's own 1..90, never discarded and never silently
     rewritten to the default — a number appearing in the queue that nobody
     asked for is worse than a refusal. Run inside a rolled-back transaction on
     Awami so it cannot run out of units and leaves nothing behind. */
  step('A duration outside 1..90');
  {
    const clamp = await sql(`
      BEGIN;
      INSERT INTO public.availability_links (token_hash, company_id, project_id, label)
      VALUES (public._availability_token_hash('clamp_probe'),
              '${AWAMI_CO}','${AWAMI_PR}','CLAMP PROBE — rolled back');
      CREATE TEMP TABLE cl ON COMMIT DROP AS
        SELECT 'high' AS k, public.submit_availability_request('clamp_probe',
                 (SELECT u.unit_no FROM public.units u
                    JOIN public.category_unit_statuses st ON st.id=u.status_id
                   WHERE u.project_id='${AWAMI_PR}' AND st.is_available
                   ORDER BY u.unit_no LIMIT 1), 999, 'Clamp') AS d
        UNION ALL
        SELECT 'low', public.submit_availability_request('clamp_probe',
                 (SELECT u.unit_no FROM public.units u
                    JOIN public.category_unit_statuses st ON st.id=u.status_id
                   WHERE u.project_id='${AWAMI_PR}' AND st.is_available
                   ORDER BY u.unit_no OFFSET 1 LIMIT 1), 0, 'Clamp')
        UNION ALL
        SELECT 'mid', public.submit_availability_request('clamp_probe',
                 (SELECT u.unit_no FROM public.units u
                    JOIN public.category_unit_statuses st ON st.id=u.status_id
                   WHERE u.project_id='${AWAMI_PR}' AND st.is_available
                   ORDER BY u.unit_no OFFSET 2 LIMIT 1), 12, 'Clamp');
      SELECT k, (SELECT days FROM public.availability_requests r WHERE r.ref = cl.d->>'ref') AS days
        FROM cl ORDER BY k;
      ROLLBACK;`);
    const by = {}; clamp.forEach(r => { by[r.k] = Number(r.days); });
    by.high === 90 ? ok('999 days is clamped to 90, the desk\u2019s own ceiling')
                   : bad('999 days became ' + by.high);
    by.low === 1   ? ok('0 days is clamped to 1, not dropped')
                   : bad('0 days became ' + by.low);
    by.mid === 12  ? ok('and 12 days is taken as 12 \u2014 nothing in range is rewritten')
                   : bad('12 days became ' + by.mid);
  }

  /* ── 2. the browser ────────────────────────────────────────────────────── */
  const server = await serve();
  const exe = BROWSERS.find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=2'] });
  const errs = [];

  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push(String(e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.setViewport({ width: 380, height: 780, deviceScaleFactor: 2, isMobile: true });
    await page.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await page.evaluate(p => window._availPreview(p), payload);
    await sleep(350);

    /* ── a. screen one, 380px, no scrolling ─────────────────────────────── */
    step('Screen one — the whole building, no scrolling');
    const one = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('#floors button')].map(b => ({
        label: b.querySelector('.fn').textContent.trim(),
        count: b.querySelector('.fc').textContent.trim(),
        h: Math.round(b.getBoundingClientRect().height),
        w: Math.round(b.getBoundingClientRect().width)
      })),
      stacked: getComputedStyle(document.getElementById('floors')).flexDirection,
      /* the floors are a building now, so what matters is that they are above
         one another and that every bar adds up to its own floor */
      bars: [...document.querySelectorAll('#floors button')].map(b => {
        const w = [...b.querySelectorAll('.fb i')]
          .reduce((a, i) => a + parseFloat(i.style.width || 0), 0);
        return Math.round(w);
      }),
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      unitsInDom: document.querySelectorAll('#units button').length,
      hero: document.querySelector('.hero-n').textContent.trim(),
      heroFoot: document.querySelector('.hero-f').textContent.trim(),
      heroSize: Math.round(parseFloat(getComputedStyle(document.querySelector('.hero-n')).fontSize)),
      labSize: Math.round(parseFloat(getComputedStyle(document.querySelector('.hero-l')).fontSize)),
      searchH: Math.round(document.getElementById('q').getBoundingClientRect().height),
      chipH: Math.round(document.querySelector('#floors button').getBoundingClientRect().height),
      barFree: document.querySelector('.bar .free').style.width,
      total: document.querySelector('.hero').textContent.trim()
    }));
    one.chips.length === payload.floors.length
      ? ok('all ' + one.chips.length + ' floor chips are on screen one')
      : bad('expected ' + payload.floors.length + ' chips, drew ' + one.chips.length);
    /* THE DESIGN CHANGED AND SO DOES WHAT IS CHECKED. This asked for a grid of
       two columns, which was right while the floors were cards. Rashid had the
       dashboard redrawn as the building itself — one floor above another, each
       a bar of what is left — so a second column would now be a second tower.
       What is worth asserting is that they stack, and that each floor's bar
       accounts for the whole floor rather than a part of it. */
    one.stacked === 'column'
      ? ok('the floors stack into a building, one above another')
      : bad('the floors are laid out "' + one.stacked + '", not stacked');
    one.bars.every(w => w >= 99 && w <= 101)
      ? ok('and every floor\'s bar accounts for the whole floor (' +
           one.bars.join('%, ') + '%)')
      : bad('a floor bar does not add up to 100%: ' + one.bars.join('%, ') + '%');
    /* ── THE PROMISE, MEASURED IN THE STATE IT IS ABOUT ───────────────────
       Screen one holds the whole building without scrolling. On the very
       first visit it also carries a one-time card asking for a name, and with
       an eighth row on the screen (All units) the two no longer both fit —
       150px of card against 52px of row.

       So the promise is checked where it lives: the screen a dealer sees
       every time after the first. The first visit is measured too and
       reported, because "it scrolls a little while it asks your name once" is
       a fact somebody should be able to read here rather than discover. */
    const settled = await page.evaluate(() => {
      const sk = document.getElementById('nm-skip');
      if (sk) sk.click();
      return { docH: document.documentElement.scrollHeight, winH: window.innerHeight };
    });
    await sleep(200);
    settled.docH <= settled.winH
      ? ok('no scrolling at 380×780 once the name is settled — ' +
           settled.docH + 'px of ' + settled.winH + 'px, eight rows and all')
      : bad('screen one scrolls even after the name card: ' + settled.docH +
            'px of ' + settled.winH + 'px');
    console.log('     first visit, with the name card: ' + one.docH + 'px of ' +
                one.winH + 'px — ' + Math.max(0, one.docH - one.winH) + 'px of scroll, once');
    /* THE FIRST VISIT CARRIES TWO THINGS IT WILL NEVER CARRY AGAIN: the card
       that asks the dealer's name, and \u2014 since Rashid asked for the doorway to
       his own reservations at the head of the page \u2014 a card that on a first
       visit can only say \u201cNothing yet\u201d. Neither is a thing anyone reads twice.

       The promise this page makes is about the screen seen every day after,
       and that is asserted above at 780 of 780. This one is bounded rather
       than promised, so that a THIRD one-time card cannot be added quietly. */
    (one.docH - one.winH) <= 140
      ? ok('and the first visit is one screen and a little (' +
           Math.max(0, one.docH - one.winH) + 'px, two one-time cards)')
      : bad('the first visit scrolls ' + (one.docH - one.winH) + 'px, which is a screenful');
    one.unitsInDom === 0
      ? ok('not one unit is in the document on screen one')
      : bad(one.unitsInDom + ' units are mounted on screen one');
    /* ── the hierarchy, measured rather than admired ─────────────────
       "Flat" is a measurable complaint: it means the biggest thing and the
       smallest thing on the screen are nearly the same size. The headline
       number must be at least three times its own label, or the eye has
       nothing to land on first. */
    const sumFree = payload.floors.reduce((a, f) => a + Number(f.available || 0), 0);
    one.hero === String(sumFree)
      ? ok('the hero states ' + one.hero + ' available, which is what the floors add up to')
      : bad('the hero says ' + one.hero + ' but the floors add up to ' + sumFree);
    /* THE FOCAL POINT IS THE SEARCH FIELD, not the count. Most dealers open
       this already knowing the unit number, so the thing they can type into
       has to be the largest object on the screen — larger than the reading
       above it and larger than any single chip below. The count used to be a
       34px headline and this checked that it was; the design changed and so
       does what is checked. */
    (one.searchH > one.heroSize * 2 && one.searchH >= 56)
      ? ok('the search field is the focal point: ' + one.searchH + 'px tall against a ' +
           one.heroSize + 'px reading')
      : bad('the search is not the focal point: field ' + one.searchH +
            'px, reading ' + one.heroSize + 'px');
    (one.heroSize > one.labSize)
      ? ok('and the reading still outranks its own label (' + one.heroSize + '/' +
           one.labSize + 'px)')
      : bad('the reading and its label are the same size');
    /* Every tappable thing clears the 44px the thumb actually needs. */
    (one.chipH >= 44 && one.searchH >= 44)
      ? ok('and nothing tappable is under 44px (chip ' + one.chipH + 'px)')
      : bad('a target is too small: chip ' + one.chipH + 'px, search ' + one.searchH + 'px');
    console.log('     chip ' + one.chips[0].w + '×' + one.chips[0].h + 'px  ·  ' +
                one.hero + ' free  ·  hero ' + one.heroSize + 'px/label ' + one.labSize + 'px');
    await page.screenshot({ path: path.join(OUT, 'a-screen-one-380.png') });

    /* ── b. THE NEWS LINE ─────────────────────────────────────────────────
       Rashid asked for a ticker on the dashboard: how many are sold, held,
       reserved, how many the building has, what a floor costs. It is put in
       the line that was already under the reading, so it costs no height —
       which is the thing most likely to be lost by accident later, and is
       asserted here against the same 780px screen. It steps rather than
       crawls, because nothing on this page may animate for longer than
       300ms, and it holds its place while the reader is on another screen. */
    step('The news line — what it says, and that it costs nothing');
    const tk = await page.evaluate(() => {
      const box = document.getElementById('hero-f');
      const line = box && box.querySelector('.tk-i');
      return {
        there: !!line,
        items: (window.TICK && TICK.items || []).length,
        all: (window.TICK && TICK.items || []).join(' ~ ').replace(/<[^>]*>/g, ''),
        text: line ? line.textContent.trim() : '',
        rows: box ? Math.round(box.getBoundingClientRect().height) : 0,
        lineH: line ? Math.round(parseFloat(getComputedStyle(box).lineHeight) || 0) : 0,
        pageW: document.documentElement.scrollWidth,
        clipped: box ? getComputedStyle(box).overflow : '',
        docH: document.documentElement.scrollHeight
      };
    });
    (tk.there && tk.items >= 6)
      ? ok('the news line is on screen one and has ' + tk.items + ' things to say')
      : bad('the news line is missing or has nothing to say: ' + JSON.stringify(tk));
    /* WHAT HE ASKED FOR, BY NAME. Each of these is a sentence he named: the
       tally by kind, the size of the building, a floor's own count, and — only
       where the link is allowed to show money — what a floor costs. */
    const says = {
      'the tally by kind': /sold|hold|pagri|reserved/i.test(tk.all),
      'the size of the building': /units in all/i.test(tk.all),
      'a floor, and what is left on it': / of [0-9,]+ open|all [0-9,]+ taken/i.test(tk.all),
      'which floor is going fastest': /going fastest/i.test(tk.all),
      'how much floor space is left': /still available across/i.test(tk.all)
    };
    if (payload.show_price) says['what a floor costs'] = /about .* per /i.test(tk.all);
    const dumb = Object.keys(says).filter(k => !says[k]);
    dumb.length === 0
      ? ok('and it says every one of them — ' + Object.keys(says).join(', '))
      : bad('the news line never says: ' + dumb.join(', ') + ' (it says: ' +
            tk.all.slice(0, 200) + ')');
    /* IT COSTS NO HEIGHT. One line, clipped, and the page is no wider for it. */
    (tk.rows <= 40 && tk.pageW <= 380 && tk.clipped === 'hidden')
      ? ok('and it costs no height — one ' + tk.rows + 'px line, clipped, page still ' +
           tk.pageW + 'px wide')
      : bad('the news line changed the shape of screen one: ' + JSON.stringify(
            { rows: tk.rows, pageW: tk.pageW, clipped: tk.clipped }));

    /* AND EVERY LINE OF IT FITS. This is the check that would have caught the
       first cut of this feature: the line rode to the right of the count with
       206px, and fourteen of its nineteen sentences were wider than that. The
       box clips, and the box was right-aligned, so what was lost was the START
       of each sentence — "…193 taken · 66.4% open" with no subject. Nothing on
       screen said anything was wrong. scrollWidth cannot see it either, since
       overflow past the inline START is not counted, so each item is measured
       on a copy of itself laid out with no width limit at all. */
    const tkFit = await page.evaluate(() => {
      const box = document.getElementById('hero-f');
      const was = box.innerHTML;
      const over = [];
      for (let i = 0; i < TICK.items.length; i++) {
        const ghost = document.createElement('span');
        ghost.className = 'tk-i';
        ghost.innerHTML = TICK.items[i];
        ghost.style.position = 'absolute';
        ghost.style.left = '-9999px';
        ghost.style.width = 'max-content';
        box.appendChild(ghost);
        const need = Math.round(ghost.getBoundingClientRect().width);
        ghost.remove();
        if (need > box.clientWidth)
          over.push({ by: need - Math.round(box.clientWidth),
                      t: (TICK.items[i] || '').replace(/<[^>]*>/g, '').slice(0, 50) });
      }
      box.innerHTML = was;
      return { box: Math.round(box.clientWidth), n: TICK.items.length, over: over };
    });
    tkFit.over.length === 0
      ? ok('and all ' + tkFit.n + ' of them fit the ' + tkFit.box + 'px it has, start to finish')
      : bad(tkFit.over.length + ' of ' + tkFit.n + ' news lines are cut off in a ' + tkFit.box +
            'px box: ' + tkFit.over.map(o => '"' + o.t + '" by ' + o.by + 'px').join('; '));

    /* IT STEPS, AND THE STEP IS INSIDE THE PAGE'S OWN 300ms BUDGET. */
    const stepped = await page.evaluate(async first => {
      const t = Date.now();
      while (Date.now() - t < 9000) {
        await new Promise(r => setTimeout(r, 200));
        const l = document.querySelector('#hero-f .tk-i');
        if (l && l.textContent.trim() !== first) {
          /* THE DURATION IS READ OFF THE RULE, NOT OFF THE ELEMENT. The
             arrival class is taken off again once it has arrived, so reading
             a live line gives 300ms or 0s depending on which side of that the
             poll landed on — a check that passes or fails by luck. A throwaway
             span wearing the same classes answers the same question and always
             gives the same answer. */
          const probe = document.createElement('span');
          probe.className = 'tk-i in';
          probe.style.position = 'absolute';
          probe.style.visibility = 'hidden';
          document.body.appendChild(probe);
          const ms = Math.round(parseFloat(getComputedStyle(probe).animationDuration) * 1000);
          probe.remove();
          return { moved: true, to: l.textContent.trim(), ms: ms, waited: Date.now() - t };
        }
      }
      return { moved: false };
    }, tk.text);
    (stepped.moved && stepped.waited < 9000)
      ? ok('and it moves on by itself after ' + (stepped.waited / 1000).toFixed(1) +
           's — “' + stepped.to.slice(0, 60) + '”')
      : bad('the news line never moved on: ' + JSON.stringify(stepped));
    (stepped.moved && stepped.ms > 0 && stepped.ms <= 300)
      ? ok('and the step arrives in ' + stepped.ms + 'ms, inside this page’s 300ms budget')
      : bad('the step is outside the animation budget: ' + JSON.stringify(stepped.ms));

    /* AND IT HOLDS ITS PLACE WHILE THE READER IS SOMEWHERE ELSE. The line
       lives on screen one; stepping through news at a hidden element while a
       floor or the directors' room is open is work nobody asked for. */
    const tkHeld = await page.evaluate(async () => {
      document.querySelector('#floors button').click();
      await new Promise(r => setTimeout(r, 300));
      const was = (document.querySelector('#hero-f .tk-i') || {}).textContent || '';
      const at = window.TICK ? TICK.at : -1;
      await new Promise(r => setTimeout(r, 6000));
      const now = (document.querySelector('#hero-f .tk-i') || {}).textContent || '';
      const at2 = window.TICK ? TICK.at : -1;
      document.getElementById('back').click();
      await new Promise(r => setTimeout(r, 300));
      return { onAFloor: true, same: was === now, at, at2 };
    });
    (tkHeld.same && tkHeld.at === tkHeld.at2)
      ? ok('and it holds its place while a floor is open, instead of talking to nobody')
      : bad('the news line kept stepping on a screen it is not on: ' + JSON.stringify(tkHeld));
    await page.evaluate(p => window._availPreview(p), payload);
    await sleep(350);

    /* ── THE STATES, PHOTOGRAPHED AND MEASURED ────────────────────────────
       A skeleton is only worth having if it stands where the real thing will
       stand; one that is a different height moves the page under the reader
       at the exact moment they started reading it. So it is compared against
       the settled layout rather than admired in a screenshot. */
    const skel = await browser.newPage();
    await skel.setViewport({ width: 380, height: 780, deviceScaleFactor: 2 });
    await skel.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await sleep(250);
    const sk = await skel.evaluate(() => {
      const b = document.getElementById('boot');
      const chips = [...document.querySelectorAll('.sk-ch')];
      return { shown: !!b && !b.hidden,
               chips: chips.length,
               chipH: chips.length ? Math.round(chips[0].getBoundingClientRect().height) : 0,
               searchH: Math.round((document.querySelector('.sk-sr') || {getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
               /* nothing may loop while the page has nothing to say */
               looping: chips.some(c => getComputedStyle(c).animationIterationCount !== 'none'
                                     && getComputedStyle(c).animationName !== 'none') };
    });
    await skel.screenshot({ path: path.join(OUT, 'b-skeleton.png') });
    (sk.shown && sk.chips === 7)
      ? ok('the first paint is a skeleton of seven chips, not a spinner')
      : bad('the skeleton is wrong: ' + JSON.stringify(sk));
    (Math.abs(sk.chipH - one.chipH) <= 4 && Math.abs(sk.searchH - one.searchH) <= 2)
      ? ok('and it stands exactly where the real thing lands \u2014 chip ' + sk.chipH +
           'px vs ' + one.chipH + 'px, field ' + sk.searchH + 'px vs ' + one.searchH + 'px')
      : bad('the skeleton would shift the page: ' + JSON.stringify(sk) +
            ' vs chip ' + one.chipH + ', field ' + one.searchH);
    !sk.looping
      ? ok('and nothing on it loops while the page has nothing to say')
      : bad('the skeleton animates on its own');
    await skel.close();

    /* ── THE PRESS ────────────────────────────────────────────────────────
       Held down with a real mouse, not a class added by hand: the point is
       that :active resolves to a visibly different thing under a thumb. */
    const press = await page.evaluate(() => {
      const b = document.querySelector('#floors button');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               restBg: getComputedStyle(b).backgroundColor,
               hoverBg: '#FDFDFD' === '' ? '' : 'rgb(253, 253, 253)',
               restTf: getComputedStyle(b).transform };
    });
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await sleep(90);
    const held = await page.evaluate(() => {
      const b = document.querySelector('#floors button');
      return { bg: getComputedStyle(b).backgroundColor, tf: getComputedStyle(b).transform };
    });
    await page.screenshot({ path: path.join(OUT, 'd-chip-pressed.png') });
    await page.mouse.up();
    await sleep(120);
    /* The press must beat the hover it is sitting inside: a mouse is
       hovering at the instant it presses, so "different from rest" is not
       enough — it has to be different from the HOVER too. */
    (held.bg !== press.restBg && held.bg !== press.hoverBg &&
     held.tf !== press.restTf && held.tf !== 'none')
      ? ok('a pressed chip answers the thumb: ' + press.restBg + ' \u2192 ' + held.bg +
           ', and it scales')
      : bad('the press is invisible: ' + JSON.stringify({ rest: press, held }));
    /* the press opened a floor; put the page back where it was */
    await page.evaluate(() => { document.getElementById('back').click(); });
    await sleep(260);

    /* ── AND FOR ANYONE WHO HAS ASKED FOR STILLNESS ───────────────────────
       Not "the animations are shorter": nothing may run at all. Measured by
       asking the browser, in that mode, what the durations resolve to. */
    const calm = await browser.newPage();
    await calm.setViewport({ width: 380, height: 780, deviceScaleFactor: 2 });
    await calm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await calm.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await calm.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await calm.evaluate(p => window._availPreview(p), payload);
    await sleep(350);
    const still = await calm.evaluate(() => {
      const secs = t => Math.max(...String(t).split(',').map(x => parseFloat(x) || 0));
      const worst = [];
      [...document.querySelectorAll('#floors button, .sr input, #app, .hero')].forEach(el => {
        const c = getComputedStyle(el);
        worst.push(secs(c.animationDuration), secs(c.transitionDuration));
      });
      return { worstMs: Math.round(Math.max.apply(null, worst) * 1000),
               chips: document.querySelectorAll('#floors button').length };
    });
    await calm.screenshot({ path: path.join(OUT, 'g-reduced-motion.png') });
    (still.worstMs <= 1 && still.chips === payload.floors.length)
      ? ok('with reduced motion asked for, nothing moves at all \u2014 and the page is whole')
      : bad('reduced motion still runs animation: ' + JSON.stringify(still));

    /* BUT STILLNESS IS NOT SILENCE. The first cut of the news line stopped it
       dead in this mode: it painted the first sentence and never moved again,
       which on screen is indistinguishable from the static tally that was
       there before it. That shipped, and Rashid opened the deployed link and
       said the ticker still was not there — Windows with "Animation effects"
       off, or a phone with Reduce Motion on, is an ordinary way to read this
       page, and on it the feature was simply absent. The preference asks that
       nothing slide or fade, not that the news stop, so both halves are
       asserted: no animation (above) and the line still moving on (here). */
    const calmSaid = await calm.evaluate(async () => {
      const box = document.getElementById('hero-f');
      const said = [];
      const t = Date.now();
      while (Date.now() - t < 12000) {
        const txt = (box.textContent || '').trim();
        if (said[said.length - 1] !== txt) said.push(txt);
        if (said.length >= 3) break;
        await new Promise(r => setTimeout(r, 150));
      }
      return said;
    });
    calmSaid.length >= 3
      ? ok('and the news still moves on for that reader — it just arrives without sliding')
      : bad('the news line is frozen under reduced motion, which looks exactly like the ' +
            'feature missing: in 12s it only said ' + JSON.stringify(calmSaid));
    await calm.close();

    /* ── THE MOTION BUDGET ────────────────────────────────────────────────
       One number, across every rule in the stylesheet, so a 600ms flourish
       cannot be added quietly later. */
    const budget = await page.evaluate(() => {
      const secs = t => Math.max(...String(t).split(',').map(x => parseFloat(x) || 0));
      let worst = 0, where = '';
      [...document.querySelectorAll('*')].forEach(el => {
        const c = getComputedStyle(el);
        const m = Math.max(secs(c.animationDuration), secs(c.transitionDuration));
        if (m > worst) { worst = m; where = el.id || el.className || el.tagName; }
      });
      return { ms: Math.round(worst * 1000), where: String(where).slice(0, 30) };
    });
    budget.ms <= 300
      ? ok('no animation on the page runs longer than 300ms (worst ' + budget.ms + 'ms)')
      : bad('an animation runs ' + budget.ms + 'ms on ' + budget.where);

    /* ── b. search across floors ────────────────────────────────────────── */
    step('Search — across every floor, no server call');
    let calls = 0;
    page.on('request', r => { if (/get_public_availability/.test(r.url())) calls++; });
    const search = await page.evaluate(() => {
      const q = document.getElementById('q');
      q.value = 'LG-1'; q.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = [...document.querySelectorAll('#res .res-r')].map(b => ({
        unit: b.querySelector('.n').textContent.trim(),
        floor: b.querySelector('.f').textContent.trim(),
        off: b.disabled
      }));
      return { rows, more: (document.querySelector('.res-more') || {}).textContent || '' };
    });
    search.rows.length > 0
      ? ok('typing LG-1 finds ' + search.rows.length + ' unit(s)' +
           (search.more ? ' and says "' + search.more.trim() + '"' : ''))
      : bad('search found nothing for LG-1');
    search.rows.every(r => /^LG/i.test(r.unit.replace(/[^A-Za-z0-9]/g, '')))
      ? ok('every result starts with what was typed')
      : bad('search returned something that does not match: ' + JSON.stringify(search.rows.slice(0, 3)));
    await sleep(200);
    calls === 0
      ? ok('searching made no server call')
      : bad('searching fired ' + calls + ' request(s)');
    await page.screenshot({ path: path.join(OUT, 'b-search-LG-1.png') });

    /* ── c. the biggest floor, and only that floor ──────────────────────── */
    step('One floor at a time');
    const big = payload.floors.reduce((a, b) => (b.units.length > a.units.length ? b : a));
    const bigIdx = payload.floors.indexOf(big);
    const floorState = await page.evaluate(async i => {
      document.getElementById('q').value = '';
      document.getElementById('q').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      /* THE CHIPS, NOT THE DRAWING. A floor with a plan opens on the plan now,
         and a hidden grid reports no columns — so this asks for the list the way
         a reader would before measuring it. */
      if (typeof PLANV !== 'undefined' && PLANV) { PLANV = false; renderFloor(); }
      await new Promise(r => setTimeout(r, 250));
      const g = document.getElementById('units');
      return {
        name: document.getElementById('fname').textContent.trim(),
        count: document.getElementById('fcount').textContent.trim(),
        mounted: g.querySelectorAll('button').length,
        perRow: getComputedStyle(g).gridTemplateColumns.split(' ').length,
        homeHidden: document.getElementById('home').hidden,
        offShown: g.querySelectorAll('button.off').length
      };
    }, bigIdx);
    const bigAvail = big.units.filter(u => u.s === 'available').length;
    console.log('     ' + big.floor_label + ' \u2014 ' + big.units.length + ' units, ' +
                bigAvail + ' available');
    floorState.mounted === bigAvail
      ? ok('only the ' + bigAvail + ' available units of that floor are mounted')
      : bad('mounted ' + floorState.mounted + ', expected ' + bigAvail);
    floorState.offShown === 0
      ? ok('unavailable units are not drawn by default')
      : bad(floorState.offShown + ' unavailable units drawn with the toggle off');
    /* A GRID, NOT A LIST OF ROWS. Four across until the chips began carrying a
       total and a rate, which needs the width — three across is still a grid
       and still reads as one; two would not. */
    floorState.perRow >= (payload.show_price ? 3 : 4)
      ? ok("a grid of " + floorState.perRow + " per row, not a list of rows")
      : bad("only " + floorState.perRow + " per row");
    floorState.homeHidden
      ? ok('screen one is put away while a floor is open')
      : bad('both screens are showing at once');
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(120);
    await page.screenshot({ path: path.join(OUT, 'c-floor-largest.png') });

    /* THE HARD RULE. Walk every floor and require that opening one leaves the
       previous one with nothing in the document. */
    step('The DOM never holds more than one floor');
    const walk = await page.evaluate(async n => {
      const seen = [];
      for (let i = 0; i < n; i++) {
        document.getElementById('back').click();
        document.querySelector('#floors button[data-f="' + i + '"]').click();
        seen.push(document.querySelectorAll('#units button').length);
      }
      document.getElementById('back').click();
      return { seen, afterBack: document.querySelectorAll('#units button').length };
    }, payload.floors.length);
    const expected = payload.floors.map(f => f.units.filter(u => u.s === 'available').length);
    JSON.stringify(walk.seen) === JSON.stringify(expected)
      ? ok('each floor mounts exactly its own units: ' + walk.seen.join(', '))
      : bad('mounted ' + JSON.stringify(walk.seen) + ', expected ' + JSON.stringify(expected));
    walk.afterBack === 0
      ? ok('going back unmounts them \u2014 zero units in the document')
      : bad(walk.afterBack + ' units left mounted after going back');

    /* ── THE WHOLE BUILDING, ON PURPOSE ───────────────────────────────────
       Every other rule on this page exists to avoid drawing 1,467 units.
       This draws them, because somebody asked for it by name. The question
       is therefore not whether it works but what it COSTS, so the cost is
       measured here rather than assumed: how long the browser takes to lay
       it out, and how many nodes it leaves behind. */
    /* ══ A DOORWAY THAT IS THERE BEFORE THERE IS ANYTHING BEHIND IT ══════
       The dealer's own position used to appear only once that phone had asked
       for something, which meant it could not be found by anybody looking for
       it first \u2014 Rashid opened the link hunting for his report and there was
       nothing on the screen to open. It is a card beside All units now, on
       every visit, and the screen behind it says so plainly when it is empty.

       This browser has made no requests at this point in the run, so this is
       the empty case, which is the one that was missing. */
    const door = await page.evaluate(() => {
      const mine = document.querySelector('#myq [data-mine]');
      const all = document.querySelector('#allrow [data-mine]');
      const hero = document.getElementById('hero');
      return {
        title: mine ? (mine.querySelector('.ac-t') || {}).textContent.trim() : null,
        caption: mine ? (mine.querySelector('.ac-m') || {}).textContent.trim() : null,
        /* ABOVE THE HEADLINE FIGURE. Rashid asked for it at the top, and "at
           the top" is a position, not a wish \u2014 so it is measured against the
           thing that used to be first. */
        aboveHero: !!(mine && hero &&
                      mine.getBoundingClientRect().top < hero.getBoundingClientRect().top),
        /* AND ONLY ONCE ON THE PAGE. It used to be a panel at the top and a
           card at the bottom showing the same report, which is what Rashid
           called out. */
        stillBelow: !!all,
        band: document.querySelectorAll('#myq .myq-r').length,
        reqs: (window.REQS || []).length
      };
    });
    (door.title === 'My Reservations' && door.aboveHero && door.reqs === 0)
      ? ok('a phone that has asked for nothing still finds the door, above the ' +
           'headline figure: \u201c' + door.title + '\u201d')
      : bad('the My Reservations card is not at the head of screen one: ' + JSON.stringify(door));
    (!door.stillBelow && door.band === 0)
      ? ok('and the page carries it ONCE \u2014 no second copy of the same report ' +
           'lower down, and no list of requests at the top')
      : bad('the report is still on the page twice: ' + JSON.stringify(door));
    /Nothing yet/.test(String(door.caption))
      ? ok('it says so rather than pretending \u2014 \u201c' + door.caption + '\u201d')
      : bad('the empty caption reads ' + JSON.stringify(door.caption));

    const inside = await page.evaluate(() => {
      document.querySelector('#myq [data-mine]').click();
      return { open: !document.getElementById('mine').hidden,
               home: document.getElementById('home').hidden,
               text: document.getElementById('mine-body').innerText,
               back: !!document.getElementById('mine-back') };
    });
    (inside.open && inside.home && /Nothing here yet/.test(inside.text) && inside.back)
      ? ok('and it opens on a screen that explains itself instead of a blank one')
      : bad('the My units screen is wrong when empty: ' + JSON.stringify(inside));
    const outAgain = await page.evaluate(() => {
      document.getElementById('mine-back').click();
      return { home: !document.getElementById('home').hidden,
               mine: document.getElementById('mine').hidden };
    });
    (outAgain.home && outAgain.mine)
      ? ok('and there is a way back out of it')
      : bad('the way back is broken: ' + JSON.stringify(outAgain));

    step('All units \u2014 the one screen that draws the whole building');
    const allOpen = await page.evaluate(() => {
      document.getElementById('back') && document.getElementById('back').click();
      const t0 = performance.now();
      document.querySelector('#allrow [data-all]').click();
      /* Forced: reading offsetHeight makes the browser finish the layout it
         would otherwise defer, so the number is the real cost and not the
         time it took to assign a string. */
      const h = document.getElementById('all-body').offsetHeight;
      const ms = Math.round(performance.now() - t0);
      const secs = [...document.querySelectorAll('#all-body .as')].map(x => ({
        name: x.querySelector('.as-n').textContent.trim(),
        meta: x.querySelector('.as-m').textContent.replace(/\s+/g, ' ').trim(),
        units: x.querySelectorAll('.ug button').length
      }));
      return {
        ms, height: h,
        shown: !document.getElementById('all').hidden,
        homeHidden: document.getElementById('home').hidden,
        floorUnitsInDom: document.querySelectorAll('#units button').length,
        sections: secs,
        units: document.querySelectorAll('#all-body .ug button').length,
        nodes: document.getElementById('all-body').querySelectorAll('*').length,
        head: document.getElementById('all-head').textContent.replace(/\s+/g, ' ').trim(),
        headVals: [...document.querySelectorAll('#all-head .ah-v')].map(v => v.textContent.trim()),
        headLabs: [...document.querySelectorAll('#all-head .ah-l')].map(v => v.textContent.trim()),
        filters: [...document.querySelectorAll('#all-filter button')].map(b => b.textContent.trim()),
        stuck: getComputedStyle(document.querySelector('#all-body .as-h')).position
      };
    });
    const totalUnits = payload.floors.reduce((a, f2) => a + (f2.units || []).length, 0);

    (allOpen.shown && allOpen.homeHidden && allOpen.floorUnitsInDom === 0)
      ? ok('the All units chip opens a screen of its own, and the floor screen stays unmounted')
      : bad('the all-units screen did not take over: ' + JSON.stringify(allOpen).slice(0, 160));
    allOpen.units === totalUnits
      ? ok('it draws every one of the ' + totalUnits + ' units in the building')
      : bad('it drew ' + allOpen.units + ' of ' + totalUnits + ' units');
    JSON.stringify(allOpen.sections.map(x => x.name)) ===
      JSON.stringify(payload.floors.map(f2 => f2.floor_label))
      ? ok('floor by floor, in the order the building is walked: ' +
           allOpen.sections.map(x => x.name).join(' \u2192 '))
      : bad('the floors came out in the wrong order: ' +
            JSON.stringify(allOpen.sections.map(x => x.name)));

    /* Every floor states its own three numbers where the floor begins, so
       three hundred identical chips are never anonymous. */
    const f0 = payload.floors[0];
    const s0 = allOpen.sections[0] || {};
    (new RegExp(f0.total + ' units').test(s0.meta) &&
     new RegExp((f0.total - f0.available) + ' not available').test(s0.meta) &&
     new RegExp(f0.available + ' available').test(s0.meta))
      ? ok('and each one opens with its own count: \u201c' + s0.meta + '\u201d')
      : bad('the floor heading does not state its numbers: ' + s0.meta);
    allOpen.stuck === 'sticky'
      ? ok('which stays on screen while you are inside that floor')
      : bad('the floor heading scrolls away: position ' + allOpen.stuck);

    const wantHead = [payload.floors.length, totalUnits,
                      totalUnits - payload.floors.reduce((a, f2) => a + Number(f2.available || 0), 0),
                      payload.floors.reduce((a, f2) => a + Number(f2.available || 0), 0)];
    /* Read as four values, not as one run-together string: 'available1Available'
       has no word boundary around the 1, and a regex over it calls the page
       wrong when the page is right. */
    JSON.stringify(allOpen.headVals) === JSON.stringify(wantHead.map(String))
      ? ok('the top states the building: ' +
           allOpen.headLabs.map((l, i2) => l + ' ' + allOpen.headVals[i2]).join(' · '))
      : bad('the header reads ' + JSON.stringify(allOpen.headVals) +
            ', expected ' + JSON.stringify(wantHead));

    /* THE COST, in the open. A phone has to lay this out. */
    console.log('     ' + allOpen.units + ' units \u00b7 ' + allOpen.nodes + ' nodes \u00b7 laid out in ' +
                allOpen.ms + 'ms \u00b7 ' + allOpen.height + 'px tall');
    allOpen.ms <= 900
      ? ok('drawn in ' + allOpen.ms + 'ms \u2014 one assignment, not one per floor')
      : bad('drawing the building took ' + allOpen.ms + 'ms');
    await page.screenshot({ path: path.join(OUT, 'h-all-units.png') });

    /* ── THE FILTER CUTS, IT DOES NOT TINT ────────────────────────────────
       Finding the held units among 1,467 by looking for a colour is not
       finding them. */
    const heldTotal = totalUnits - payload.floors.reduce((a, f2) => a + Number(f2.available || 0), 0);
    const cut = await page.evaluate(() => {
      const press = v => {
        document.querySelector('#all-filter button[data-f="' + v + '"]').click();
        return { units: document.querySelectorAll('#all-body .ug button').length,
                 off: document.querySelectorAll('#all-body .ug button.off').length };
      };
      return { held: press('held'), free: press('free'), all: press('all') };
    });
    (cut.held.units === heldTotal && cut.held.off === heldTotal)
      ? ok('\u201cNot available\u201d shows the ' + heldTotal + ' held units and nothing else')
      : bad('the held filter showed ' + JSON.stringify(cut.held));
    (cut.free.units === totalUnits - heldTotal && cut.free.off === 0)
      ? ok('\u201cAvailable\u201d shows the other ' + cut.free.units + ', with none of them held')
      : bad('the available filter showed ' + JSON.stringify(cut.free));
    cut.all.units === totalUnits
      ? ok('and \u201cAll\u201d puts the building back')
      : bad('the all filter showed ' + cut.all.units);

    await page.evaluate(() => { document.getElementById('all-back').click(); });
    await sleep(260);
    (await page.evaluate(() => document.querySelectorAll('#all-body .ug button').length)) === 0
      ? ok('and leaving it unmounts all ' + totalUnits + ' of them again')
      : bad('the building stayed in the document after going back');

    /* ── d. the request sheet and its message ───────────────────────────── */
    step('The request sheet');
    await page.evaluate(() => {
      try { localStorage.setItem('avail.name', 'Fawad khan'); } catch (e) {}
    });
    const sheet = await page.evaluate(i => {
      NAME = 'Fawad khan';
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      document.querySelector('#units button:not(.off)').click();
      const out = {
        open: document.getElementById('sheet').classList.contains('on'),
        unit: document.getElementById('sh-n').textContent.trim(),
        label: document.getElementById('wa').textContent.trim(),
        note: document.querySelector('.go-n').textContent.trim(),
        durs: [...document.querySelectorAll('#dur button')].map(b => b.textContent.trim()),
        preset: (document.querySelector('#dur button.on') || {}).textContent,
        acts: [...document.querySelectorAll('.acts button')].map(b => b.textContent.trim()),
        custom: !!document.getElementById('dcust')
      };
      SHEET.ref = 'AB2CD3';   // the server issues this for real; seeded to check the shape
      return Object.assign(out, { msg: message() });
    }, 0);
    sheet.open ? ok('the sheet opens on an available unit') : bad('no sheet');
    /* One action now. It must not read as though tapping it holds the unit. */
    /^Done/.test(sheet.label)
      ? ok('the button says "' + sheet.label + '"')
      : bad('the button says "' + sheet.label + '"');
    /reserve|book|hold/i.test(sheet.label)
      ? bad('the button implies it reserves: ' + sheet.label)
      : ok('and never implies the unit is already held');
    /* The duration chips are buttons too, so counting every button in the
       sheet counts the wrong thing. What must be exactly two is the action
       row: one thing to press and one way out. Two buttons wired to the same
       call is how this sheet asked the same question twice, in the same
       colour — and nothing here noticed. */
    sheet.acts.length === 2
      ? ok('one action and one way out: ' + sheet.acts.join(' / '))
      : bad('the action row holds ' + JSON.stringify(sheet.acts));
    !/request reservation/i.test(JSON.stringify(sheet.acts))
      ? ok('and the old duplicate button is gone')
      : bad('two buttons still send the same request');
    /only held once you receive a confirmation/i.test(sheet.note)
      ? ok('and says the unit is only held once confirmed')
      : bad('the note under the button is wrong: ' + sheet.note);
    JSON.stringify(sheet.durs) === JSON.stringify(['1 day', '3 days', '7 days'])
      ? ok('the chips are 1 / 3 / 7')
      : bad('the chips are ' + JSON.stringify(sheet.durs));
    sheet.custom
      ? ok('with a box beside them for any other number')
      : bad('there is no way to type a custom duration');
    /7/.test(sheet.preset || '') ? ok('7 days preselected') : bad('preselected ' + sheet.preset);
    /* Copy is gone: on a desktop wa.me opens a page that looks like it did
       nothing, so it read as a second equal choice for no reason. One action,
       and a way back that is not a small x in the corner. */
    (sheet.acts.length === 2 && /whatsapp/i.test(sheet.acts[0]) && /cancel/i.test(sheet.acts[1]))
      ? ok('one action and a way out: ' + sheet.acts.join(' / '))
      : bad('actions are ' + JSON.stringify(sheet.acts));
    await sleep(400);            // let it finish sliding before measuring or shooting
    const fit = await page.evaluate(() => {
      const r = document.getElementById('sheet').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom),
               h: Math.round(r.height), win: window.innerHeight };
    });
    (fit.top >= 0 && fit.bottom <= fit.win + 1)
      ? ok('the whole sheet fits the screen \u2014 ' + fit.h + 'px of ' + fit.win + 'px, nothing below the fold')
      : bad('part of the sheet is off-screen: ' + JSON.stringify(fit));

    console.log('\n     ' + sheet.msg.split('\n').join('\n     ') + '\n');
    const M = sheet.msg;
    /^\s*\S.*— Reservation Request/m.test(M) && /^Ref: [A-Z]+-REQ-[A-Z0-9]{6}$/m.test(M) &&
    /^Unit: \S+$/m.test(M) && /^Floor: /m.test(M) && /^Size: /m.test(M) &&
    /^Duration: 7 days$/m.test(M) && /^Requested by: Fawad khan$/m.test(M) &&
    /Please confirm\.$/.test(M)
      ? ok('the message is exactly the shape asked for, unit on its own line')
      : bad('the message shape is wrong');
    !/PKR|price|rate/i.test(M) ? ok('and carries no money') : bad('the message mentions money');
    await page.screenshot({ path: path.join(OUT, 'd-request-sheet.png') });
    fs.writeFileSync(path.join(OUT, 'd-message.txt'), M);

    /* ── WHAT THE DEALER IS ASKING FOR ────────────────────────────────────
       The sheet used to ask one thing: how many days. It now asks which of
       the statuses this project has PUBLISHED — Reserve, Hold, Pagri, Sold on
       Awami
       — and a permanent one has no duration at all, so the question is not on
       the screen rather than greyed out on it.

       It remains an ASK. Nothing here decides: the tag is applied by a
       director tapping Approve, which is the only reason a link that can be
       forwarded to anybody may carry this at all. */
    const kinds = await page.evaluate(() => {
      const read = () => ({
        labels: [...document.querySelectorAll('#ask-k button')].map(b => b.textContent.trim()),
        on: (document.querySelector('#ask-k button.on') || {}).textContent || '',
        days: !!document.getElementById('dur'),
        note: (document.querySelector('.ask-n') || {}).textContent || '',
        msg: message()
      });
      const first = read();
      const press = label => {
        const b = [...document.querySelectorAll('#ask-k button')]
          .find(x => x.textContent.trim() === label);
        if (!b) return null;
        b.click();
        return read();
      };
      return { first, sold: press('Sold'), pagri: press('Pagri'), hold: press('Hold') };
    });

    /* A LOCK, NOT A DESCRIPTION. Whatever a tenant flags public_choice appears
       here the moment it is flagged, which is the point \u2014 and also the risk. If
       this list changes, somebody meant it to change. Pagri joined it on
       2026-09-10 at Rashid's asking. */
    JSON.stringify(kinds.first.labels) === JSON.stringify(['Reserve', 'Hold', 'Pagri', 'Sold'])
      ? ok('the sheet offers what this project publishes: ' + kinds.first.labels.join(' / '))
      : bad('the choices are ' + JSON.stringify(kinds.first.labels));
    (kinds.first.on === 'Reserve' && kinds.first.days)
      ? ok('Reserve is chosen to begin with, and it asks how long')
      : bad('the opening choice is wrong: ' + JSON.stringify(kinds.first));
    (kinds.sold && !kinds.sold.days && /no end date/i.test(kinds.sold.note))
      ? ok('Sold takes the duration away entirely \u2014 \u201c' +
           kinds.sold.note.trim() + '\u201d')
      : bad('Sold still asks for days: ' + JSON.stringify(kinds.sold));
    /* Pagri is permanent too, and nothing about it is a special case: it is one
       more status the tenant published, and it behaves like one. */
    (kinds.pagri && !kinds.pagri.days && /no end date/i.test(kinds.pagri.note) &&
     /pagri/i.test(kinds.pagri.msg))
      ? ok('Pagri asks for no duration either, and the message says what was asked')
      : bad('Pagri is not behaving as a permanent choice: ' + JSON.stringify(kinds.pagri));
    (kinds.hold && kinds.hold.days && kinds.hold.on === 'Hold')
      ? ok('and going back to Hold brings the days question back')
      : bad('Hold did not restore the duration: ' + JSON.stringify(kinds.hold));

    /* The message has to say the same thing the desk will read. */
    (kinds.sold && /^Asking for: Sold$/m.test(kinds.sold.msg) &&
     !/^Duration:/m.test(kinds.sold.msg))
      ? ok('the WhatsApp message says \u201cAsking for: Sold\u201d and carries no duration')
      : bad('the message for a permanent ask is wrong: ' +
            JSON.stringify(String(kinds.sold && kinds.sold.msg).slice(0, 120)));
    (kinds.hold && /^Asking for: Hold$/m.test(kinds.hold.msg) &&
     /^Duration: \d+ days?$/m.test(kinds.hold.msg))
      ? ok('and a timed ask carries both the word and the number')
      : bad('the message for a timed ask is wrong');
    /* put Reserve back, so the steps below send what they always sent */
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#ask-k button')]
        .find(x => x.textContent.trim() === 'Reserve');
      if (b) b.click();
    });

    /* ── SEVERAL UNITS IN ONE ASK ──────────────────────────────────────────
       A dealer taking a row of shops was sending one request per shop, and the
       desk was reading them as unrelated conversations. The sheet now takes a
       list — typed or pasted, which is the same input event — and sends it as
       one batch under one ref.

       Two things have to hold. The units must be resolved against the page's
       own payload, so a number that is not on this link, or one that has gone,
       is refused HERE rather than by a message the dealer reads afterwards.
       And it must still be an ASK: nothing below books anything. */
    const bulk = await page.evaluate(() => {
      const free = [], gone = [];
      (P.floors || []).forEach(f => (f.units || []).forEach(u => {
        (u.s === 'available' ? free : gone).push(u.n);
      }));
      const extra = free.filter(n => n !== SHEET.n).slice(0, 2);
      const read = () => ({
        /* the one figure a dealer taking six shops wants: what the six come to */
        price: (document.querySelector('.sh-p') || {}).textContent || '',
        head: (document.getElementById('sh-n') || {}).textContent || '',
        chips: [...document.querySelectorAll('#uc-r .uc')].map(c => ({
          n: c.textContent.replace(/\u00d7/g, '').trim(),
          bad: c.classList.contains('bad')
        })),
        sending: sheetFree(),
        msg: message()
      });

      /* ONE PASTE, both of them — the trailing comma says the last number is
         finished, which is what a list copied out of a group ends with. */
      const box = document.getElementById('uc-in');
      box.value = extra.join(', ') + ',';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const pasted = read();

      /* a unit somebody already holds, offered to a page that knows better */
      let held = null;
      if (gone.length) {
        const b2 = document.getElementById('uc-in');
        b2.value = gone[0] + ',';
        b2.dispatchEvent(new Event('input', { bubbles: true }));
        held = read();
      }

      /* and the way back out of it */
      const x = document.querySelector('#uc-r .uc button[data-x]');
      if (x) x.click();
      const dropped = read();

      return { extra, gone: gone[0] || null, pasted, held, dropped };
    });

    (bulk.pasted.chips.length === 3 && /3 units/.test(bulk.pasted.head))
      ? ok('a pasted list becomes chips in one gesture \u2014 \u201c' +
           bulk.pasted.head.trim() + '\u201d')
      : bad('the paste did not land: ' + JSON.stringify(bulk.pasted.chips));
    (bulk.pasted.sending.length === 3)
      ? ok('and all three are what would be sent')
      : bad('it would send ' + JSON.stringify(bulk.pasted.sending));

    /* ── ONE FIGURE FOR THE WHOLE ASK ──────────────────────────────────────
       Rashid asked for totals on the reservation, and a dealer taking three
       shops wants what the three come to rather than three numbers to add on
       a phone. It is the sum of exactly what would be sent, checked against
       the register — and a sum that quietly left a unit out would be worse
       than no sum at all. */
    const wantSum = bulk.pasted.sending
      .reduce((t, n) => t + Number((book.find(r => r.unit_no === n) || {}).v || 0), 0);
    /* the money, and not the "for all 3" beside it — stripping every
       non-digit from the line swept that 3 up into the figure */
    const saidSum = Number(((/PKR\s*([\d,]+)/.exec(bulk.pasted.price) || [])[1] || '')
                             .replace(/,/g, ''));
    (wantSum > 0 && saidSum === Math.round(wantSum) && /for all 3/.test(bulk.pasted.price))
      ? ok('three shops asked for together show one total — “' +
           bulk.pasted.price.replace(/\s+/g, ' ').trim() + '”')
      : bad('the total for three is wrong: showed ' + saidSum + ', register says ' +
            Math.round(wantSum));
    (/^Units \(3\): /m.test(bulk.pasted.msg) && !/^Size: /m.test(bulk.pasted.msg) &&
     !/^Unit: /m.test(bulk.pasted.msg))
      ? ok('the message lists them and drops the size \u2014 one size under three ' +
           'units is a claim about two of them that is not true')
      : bad('the message for several units is wrong: ' +
            JSON.stringify(bulk.pasted.msg.slice(0, 160)));
    /* THE COUNT IS THE ASSERTION, not the strike-through. Both the striking and
       the filtering read the same availability out of the payload, so a version
       that ACCEPTED a held unit still drew it struck through and still left it
       out of the send \u2014 the first draft of this check passed with the rule
       deleted, which made it worth nothing. What actually breaks is the
       heading: the sheet would say four units while asking for three, which is
       the sheet lying about what it is about to do. */
    bulk.held
      ? ((bulk.held.chips.filter(c => c.bad).length === 1 &&
          bulk.held.sending.length === 3 &&
          /3 units/.test(bulk.held.head) &&
          bulk.held.sending.indexOf(bulk.gone) < 0)
          ? ok('a unit that is already taken is struck through, left out of the ask, ' +
               'and NOT counted \u2014 the heading still says 3 units')
          : bad('the unavailable unit was mishandled: ' + JSON.stringify(bulk.held)))
      : ok('no held unit in this fixture to offer \u2014 nothing to check');
    (bulk.dropped.sending.length === 2)
      ? ok('and one can be taken back off the list again')
      : bad('removing a chip did not work: ' + JSON.stringify(bulk.dropped.sending));

    /* ── A LETTER, AND A LIST TO TAP ───────────────────────────────────────
       Typing unit numbers out with commas is fine for a list pasted off a
       WhatsApp group and hopeless for a rep who knows they want six shops on
       one floor and not which numbers those carry. The sheet now answers a
       single letter with the free units behind it, and a tap picks one.

       The rule the list has to keep is that every row does something: only
       available units, and never one already on the sheet \u2014 a row that is a
       no-op when tapped is worse than a row that is not there. */
    const sg = await page.evaluate(() => {
      const box = document.getElementById('uc-in');
      const letter = String(SHEET.n).charAt(0);
      box.value = letter;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const read = () => ({
        shown: !document.getElementById('uc-sg').hidden,
        rows: [...document.querySelectorAll('#uc-sg button[data-u]')]
                .map(b => b.getAttribute('data-u')),
        typed: (document.getElementById('uc-in') || {}).value,
        picked: sheetAll()
      });
      const first = read();
      const b = document.querySelector('#uc-sg button[data-u]');
      const want = b ? b.getAttribute('data-u') : null;
      if (b) b.click();
      return { letter: letter, first: first, want: want, after: read() };
    });

    (sg.first.shown && sg.first.rows.length > 0 &&
     sg.first.rows.every(n => n.charAt(0).toUpperCase() === sg.letter.toUpperCase()))
      ? ok('one letter in the sheet lists the free units behind it: ' +
           sg.first.rows.slice(0, 4).join(', ') + (sg.first.rows.length > 4 ? ' \u2026' : ''))
      : bad('the sheet did not answer a bare letter: ' + JSON.stringify(sg.first));
    /* The unit already on the sheet must not be offered back to itself. */
    sg.first.rows.indexOf(sg.first.picked[0]) < 0
      ? ok('and never offers a unit already on the sheet')
      : bad(sg.first.picked[0] + ' was offered although it is already chosen');
    (sg.want && sg.after.picked.indexOf(sg.want) >= 0)
      ? ok('tapping ' + sg.want + ' selects it \u2014 ' + sg.after.picked.length +
           ' units on the sheet now')
      : bad('the tap did not select: ' + JSON.stringify(sg));
    (sg.after.typed === sg.letter && sg.after.rows.indexOf(sg.want) < 0)
      ? ok('the letter stays in the box and the row leaves the list, so the next ' +
           'unit is one more tap')
      : bad('the list did not refresh around the pick: ' + JSON.stringify(sg.after));

    /* A picture of it open, and a measurement: the sheet is anchored to the
       bottom of the phone, so a list that grows without limit pushes the send
       button off the screen. It is capped and scrolls inside itself. */
    await page.screenshot({ path: path.join(OUT, 'p-sheet-typeahead.png') });
    const fit2 = await page.evaluate(() => {
      const r = document.getElementById('sheet').getBoundingClientRect();
      const go = document.getElementById('wa').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom),
               goBottom: Math.round(go.bottom), win: window.innerHeight };
    });
    (fit2.top >= 0 && fit2.bottom <= fit2.win + 1 && fit2.goBottom <= fit2.win + 1)
      ? ok('and the sheet still fits with the list open — the send button is at ' +
           fit2.goBottom + 'px of ' + fit2.win + 'px, on the screen')
      : bad('the list pushed the sheet off the screen: ' + JSON.stringify(fit2));

    await page.evaluate(() => {
      const el = document.getElementById('uc-in');
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });

    /* Back to the one unit that was tapped, so everything below sends exactly
       what it has always sent. */
    await page.evaluate(() => {
      SHEET.more = []; SHEET.bad = [];
      paintSheet();
    });
    const restored = await page.evaluate(() => ({
      n: sheetFree().length, msg: message()
    }));
    (restored.n === 1 && /^Unit: /m.test(restored.msg) && /^Size: /m.test(restored.msg))
      ? ok('and with one unit the sheet is byte for byte the sheet it was')
      : bad('the single-unit sheet did not come back: ' + JSON.stringify(restored));

    /* ── the other state ───────────────────────────────────────────────────
       Everything above ran on a project where every unit is free, so the two
       checks about unavailable units could not have failed. The payload is
       real; a copy of it with one unit in three marked not_available is what
       makes them mean something. */
    const mixed = JSON.parse(JSON.stringify(payload));
    let flipped = 0;
    /* THREE KINDS, ROTATED, so the page has more than one to draw and the
       legend has more than one key to isolate. A flip that left k off would
       exercise the fallback wording and nothing else. */
    const KINDS = [['Hold', 'Akbar Shah'], ['Sold', 'Waqar Landlord'], ['Pagri', 'Haseeb']];
    mixed.floors.forEach(f2 => {
      f2.units.forEach((u, i) => {
        if (i % 3 !== 1) return;
        const k = KINDS[(flipped) % KINDS.length];
        u.s = 'not_available'; u.k = k[0]; u.w = k[1]; flipped++;
      });
      f2.available = f2.units.filter(u => u.s === 'available').length;
    });
    await page.evaluate(p => window._availPreview(p), mixed);
    await sleep(250);
    console.log('     re-rendered with ' + flipped + ' of ' + units + ' units unavailable');

    /* an unavailable unit must produce nothing at all */
    step('An unavailable unit is inert');
    const inert = await page.evaluate(i => {
      closeSheet();
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      document.getElementById('showall').checked = true;
      document.getElementById('showall').dispatchEvent(new Event('change', { bubbles: true }));
      const off = document.querySelector('#units button.off');
      if (!off) return { none: true };
      off.click();
      /* And through the front door too: openSheet must refuse the unit even
         when called directly, not merely be unreachable because the button
         happens to be disabled. */
      const unit = off.querySelector('.un').textContent.trim();
      openSheet(unit, i);
      return { none: false, disabled: off.disabled, unit,
               sheetOpen: document.getElementById('sheet').classList.contains('on'),
               label: off.textContent.replace(/\s+/g, ' ').trim() };
    }, bigIdx);
    inert.none
      ? bad('the mixed payload produced no unavailable unit \u2014 this check is inert')
      : ok('there are unavailable units to click, so this check can fail');
    (!inert.none && !inert.sheetOpen && inert.disabled)
      ? ok('clicking ' + inert.unit + ' opens no sheet, and openSheet refuses it when called directly')
      : bad('an unavailable unit produced a sheet: ' + JSON.stringify(inert));
    /* IT USED TO HAVE TO READ "Not Available" AND NOTHING ELSE, so that a
       sold unit and a reserved one were the same answer to a dealer. Rashid
       turned that over on 2026-09-10: "pehle ham ne decide kia tha k just Not
       available likhaingay magar ab hamain zaroorat hai status ki proper". So
       the chip must now name the kind, and name whose word it was held on. */
    /* THE KIND IS ALWAYS REQUIRED. THE NAME ONLY IF ANYBODY KNOWS IT.
       This asked for both, which held while every taken unit had a reservation
       row behind it carrying the name it was held on. On 2026-09-12 Rashid's
       own sheet brought in 341 units already sold, and it does not say who
       bought them — so they are sold, correctly, with nobody's word attached.
       Requiring a name here would mean failing on the truth or inventing a
       buyer. The kind stays required: "not available" without saying which
       kind is the thing he overturned. */
    (!inert.none && /Hold|Sold|Pagri|Reserved/.test(inert.label))
      ? ok('and it names the kind of hold \u2014 "' + inert.label + '"')
      : bad('an unavailable unit does not say what kind it is: "' + inert.label + '"');

    /* ── e. the toggle ──────────────────────────────────────────────────── */
    step('The unavailable toggle');
    const tog = await page.evaluate(i => {
      document.getElementById('back').click();
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      const before = document.querySelectorAll('#units button').length;
      const cb = document.getElementById('showall');
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
      const after = document.querySelectorAll('#units button').length;
      const off = [...document.querySelectorAll('#units button.off')];
      const on = document.querySelector('#units button:not(.off)');
      const px = e => e ? getComputedStyle(e) : null;
      /* ONE SWATCH PER KIND. The chip carries data-k, so this reads the ink
         of the first chip of each kind rather than of the first chip of any
         kind \u2014 which is what tells apart "they are all coloured" from
         "they are all coloured THE SAME". */
      const byKind = {};
      off.forEach(c => {
        const k = c.getAttribute('data-k') || '?';
        if (!byKind[k]) byKind[k] = { ink: px(c.querySelector('.un')).color,
                                      pill: px(c.querySelector('.us')).backgroundColor,
                                      who: (c.querySelector('.uw') || {}).textContent || '' };
      });
      return { before, after, offCount: off.length, byKind,
               label: off.length ? off[0].textContent.replace(/\s+/g, ' ').trim() : '',
               offBg: off.length ? px(off[0]).backgroundColor : '',
               onBg: on ? px(on).backgroundColor : '',
               offInk: off.length ? px(off[0].querySelector('.un')).color : '' };
    }, bigIdx);
    tog.after > tog.before
      ? ok('the toggle reveals ' + (tog.after - tog.before) + ' more unit(s) (' +
           tog.before + ' \u2192 ' + tog.after + ')')
      : bad('the toggle revealed nothing: ' + tog.before + ' \u2192 ' + tog.after);
    tog.offCount > 0 && /Hold|Sold|Pagri/.test(tog.label)
      ? ok('and the ' + tog.offCount + ' revealed units name their hold')
      : bad('revealed units are labelled "' + tog.label + '"');
    /* ── held units are AMBER ─────────────────────────────────
       Read off the computed style, not the class list, because a class that
       no rule matches is exactly the failure this is here to catch. Amber is
       asserted as "red channel clearly above blue" — a hue test, not a hex
       test, so the palette can be tuned without the check going stale. */
    const rgbOf = t => (String(t).match(/[0-9]+/g) || []).map(Number);
    /* Warm, in the only sense that matters here: more red than blue. The
       threshold used to be 18 and the ground has since been muted on purpose
       — held must be distinguishable at arm's length without ever being the
       loudest thing on a screen of three hundred units. So the GROUND is
       tested for warmth against the available one, and the INK, which carries
       the meaning, is tested properly. */
    const warm = (t, n) => { const c = rgbOf(t); return c.length >= 3 && c[0] > c[2] + n; };
    const heldWarmer = (() => {
      const a = rgbOf(tog.offBg), b = rgbOf(tog.onBg);
      return a.length >= 3 && b.length >= 3 && (a[0] - a[2]) > (b[0] - b[2]) + 8;
    })();
    /* THE GROUND IS STILL WARM — a taken chip has to read as taken before
       anybody reads a word — but the INK is no longer one colour. Rashid:
       "har aik ko alag cross se ya color se differenciate karo… taakay dekhtay
       hee pata chal jai". So what is asserted now is that every kind is drawn
       in its own colour and no two share one. A palette where Hold and Sold
       came out the same would pass every other check on this page. */
    (tog.offCount > 0 && heldWarmer && !warm(tog.onBg, 4))
      ? ok('a taken chip still reads taken — ground ' + tog.offBg +
           ', available still ' + tog.onBg)
      : bad('held units do not read taken: ' + JSON.stringify(
            { off: tog.offBg, on: tog.onBg }));
    {
      const kinds = Object.keys(tog.byKind || {});
      const inks = kinds.map(k => tog.byKind[k].ink);
      const pills = kinds.map(k => tog.byKind[k].pill);
      const named = kinds.filter(k => (tog.byKind[k].who || '').trim());
      /* EVERY KIND ITS OWN COLOUR is the part that matters, and it is
         unchanged. What is no longer demanded of every kind is a holder's
         name: Rashid's sheet of 2026-09-12 brought in 341 units already sold
         and does not say who bought them, so a screen telling the truth about
         those would have failed here. At least one kind must still carry a
         name, which still catches a payload that stopped sending it. */
      (kinds.length >= 2 && new Set(inks).size === kinds.length &&
       new Set(pills).size === kinds.length && named.length >= 1)
        ? ok('and each kind is its own colour — ' +
             kinds.map(k => k + ' ' + tog.byKind[k].ink).join(', ') +
             '; ' + named.length + ' of ' + kinds.length + ' name whose word it was on')
        : bad('the kinds are not told apart: ' + JSON.stringify(tog.byKind));
    }
    /* the sheet from the step before is still up; a screenshot of a toggle with a
       modal over it shows neither */
    await page.evaluate(() => { closeSheet(); window.scrollTo(0, 0); });
    await sleep(260);
    await page.screenshot({ path: path.join(OUT, 'e-unavailable-toggle.png') });

    /* ── f. a failed refetch keeps the last good data ───────────────────── */
    step('A failed refetch keeps the last good screen');
    const failState = await page.evaluate(async () => {
      document.getElementById('back').click();
      const chipsBefore = document.querySelectorAll('#floors button').length;
      const totalBefore = document.querySelector('.hero').textContent.trim();
      const orig = sb.rpc;
      sb.rpc = function () { return Promise.reject(new Error('offline')); };
      await load(false);
      sb.rpc = orig;
      return { chipsBefore, totalBefore,
               chipsAfter: document.querySelectorAll('#floors button').length,
               totalAfter: document.querySelector('.hero').textContent.trim(),
               upd: document.getElementById('upd').textContent.trim(),
               stale: document.getElementById('upd').classList.contains('stale') };
    });
    (failState.chipsAfter === failState.chipsBefore && failState.totalAfter === failState.totalBefore)
      ? ok('the last good data is still on screen after a failed refetch')
      : bad('a failed refetch changed the screen');
    failState.stale && /Updated \d\d:\d\d/.test(failState.upd)
      ? ok('and the timestamp is marked stale rather than blanked or silently kept: "' + failState.upd + '"')
      : bad('the timestamp did not admit the failure: ' + JSON.stringify(failState));
    await page.screenshot({ path: path.join(OUT, 'f-stale-refetch.png') });

    /* ── the whole-DOM price sweep ──────────────────────────────────────── */
    step('Price appears nowhere');
    /* Swept while unavailable units are ON SCREEN — that is the state most
       likely to leak a word like Reserved or Sold into the page. */
    /* Swept with held units ACTUALLY ON SCREEN. The earlier steps left the
       page back on screen one, where there is not a single unit — so this
       check was reading an empty page and passing on nothing. */
    await page.evaluate(i => {
      document.querySelector('#floors button[data-f="' + i + '"]').click();
      const cb = document.getElementById('showall');
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    }, bigIdx);
    await sleep(260);
    const sweep = await page.evaluate(() => {
      const t = document.body.innerText;
      /* THE RULE TURNED OVER ON 2026-09-10. It used to be that a dealer must
         not be able to tell WHY a unit was gone — sold and reserved had to
         read the same. Rashid asked for the opposite, and the sweep asks the
         opposite: every taken chip must NAME its hold.

         What the sweep still guards is the line that did not move. The buyer,
         the phone number, the money taken and the desk's own note are on the
         same reservation row and none of them is a dealer's business, so a
         chip carrying any of them fails here. */
      const cells = [...document.querySelectorAll('#units button, #all-body .ug button, #res .res-r')];
      const taken = [...document.querySelectorAll('#units button.off, #all-body .ug button.off')];
      const mute = taken.filter(c => !c.querySelector('.us'));
      const priv = /\bcnic\b|\bphone\b|\btoken\b|\badvance\b|03[0-9]{2}[- ]?[0-9]{7}/i;
      const bad = cells.filter(c => priv.test(c.textContent || ''))
                       .map(c => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40));
      /* MONEY IS SHOWN WHERE THE PROJECT PUBLISHES IT, and this project does:
         Rashid asked for the total and the rate on the chips and on the plate
         as well as on the request sheet. So the question is no longer whether
         money appears \u2014 it is whether EVERY unit carries it, and whether the
         figures are the register's. A chip that quietly lost its price would
         read as a shop with no price rather than as a fault. */
      const priced = [...document.querySelectorAll('#units button, #all-body .ug button')]
        .map(c => ({
          n: (c.querySelector('.un') || {}).textContent || '',
          v: (c.querySelector('.uv') || {}).textContent || '',
          r: (c.querySelector('.ur') || {}).textContent || ''
        }));
      return { rate: /rate\s*\/|discount/i.test(t),
               chips: priced,
               taken: taken.length, mute: mute.length,
               cells: cells.length, leaks: bad.slice(0, 4), n: bad.length };
    });
    {
      const emptyChip = sweep.chips.filter(c => !c.v || !c.r);
      const money = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
      const wrongChip = sweep.chips.filter(c => {
        const u = book.find(r => r.unit_no === c.n.trim());
        if (!u) return false;
        return c.v.replace(/[^0-9,]/g, '') !== money(u.v);
      });
      (sweep.chips.length > 20 && emptyChip.length === 0 && wrongChip.length === 0 && !sweep.rate)
        ? ok('every one of the ' + sweep.chips.length + ' chips on screen carries the ' +
             'register\u2019s total and the rate it works out to \u2014 e.g. ' +
             sweep.chips[0].n + ' ' + sweep.chips[0].v + ' at ' + sweep.chips[0].r)
        : bad('the chips do not carry the money properly: ' +
              (emptyChip.length ? emptyChip.length + ' without a price (' +
                emptyChip.slice(0, 3).map(c => c.n).join(',') + ')' : '') +
              (wrongChip.length ? '  ' + wrongChip.length + ' with the wrong total (' +
                wrongChip[0].n + ' shows ' + wrongChip[0].v + ')' : '') +
              (sweep.rate ? '  and something reads like a discount' : ''));
    }
    (sweep.cells > 0 && sweep.taken > 0 && sweep.mute === 0 && sweep.n === 0)
      ? ok('every one of the ' + sweep.taken + ' taken units on screen names its hold, ' +
           'and none of the ' + sweep.cells + ' carries a buyer, a number or an amount')
      : bad(sweep.cells === 0 || sweep.taken === 0
            ? 'the sweep found no taken units to check — it proves nothing'
            : sweep.mute + ' taken unit(s) say nothing, ' + sweep.n +
              ' leak something private: ' + JSON.stringify(sweep.leaks));

    step('What the page writes to the phone');
    const store = await page.evaluate(() => {
      const ls = {}, ss = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); ls[k] = localStorage.getItem(k);
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k);
      }
      return { ls, ss, cookies: document.cookie };
    });
    const allowed = ['avail.name', 'avail.name.asked'];
    const extra = Object.keys(store.ls).filter(k => allowed.indexOf(k) < 0);
    extra.length === 0
      ? ok('localStorage holds only ' + Object.keys(store.ls).join(', ') + ' \u2014 the name and the asked flag')
      : bad('the page wrote something else to localStorage: ' + extra.join(', '));
    Object.keys(store.ss).length === 0
      ? ok('sessionStorage is untouched')
      : bad('sessionStorage holds ' + Object.keys(store.ss).join(', '));
    !store.cookies
      ? ok('and no cookie is set')
      : bad('a cookie was set: ' + store.cookies);
    /* The token must never be written down. A dealer forwarding their phone's
       storage is not a threat we can control, but writing the link into it is. */
    !JSON.stringify(store).includes('token') &&
    !Object.values(store.ls).some(v => /^[0-9a-f]{24,}$/i.test(String(v)))
      ? ok('the link token is nowhere in storage')
      : bad('the token or something like it was persisted: ' + JSON.stringify(store.ls));

    /* ── g. desktop ─────────────────────────────────────────────────────── */
    step('Desktop');
    const desk = await browser.newPage();
    await desk.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    await desk.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
    await desk.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 20000 });
    await desk.evaluate(p => window._availPreview(p), payload);
    await sleep(300);
    const dw = await desk.evaluate(() => {
      const w  = document.querySelector('.wrap').getBoundingClientRect();
      const fl = document.getElementById('floors').getBoundingClientRect();
      const sr = document.querySelector('.sr').getBoundingClientRect();
      return { wrap: Math.round(w.width), left: Math.round(w.left), win: window.innerWidth,
               /* the rail is beside the building, not stacked under it */
               beside: Math.round(sr.left) >= Math.round(fl.right) - 1 };
    });
    /* WHAT A DESKTOP IS FOR. This used to ask for a narrow centred column with
       the floors three across, which was the best a grid of cards could do with
       the width. The dashboard is the building itself now, and a building does
       not want a second column of itself \u2014 it wants to be tall, with everything
       you DO to it alongside. So what is asserted is that the page takes the
       width it is given and that the search rail genuinely sits beside the
       stack rather than under it with the right half of the window empty. */
    dw.wrap > 900 && dw.left > 60 && dw.beside
      ? ok('the page uses its width: ' + dw.wrap + 'px, the rail beside the building rather than under it')
      : bad('desktop layout: ' + JSON.stringify(dw));
    await desk.screenshot({ path: path.join(OUT, 'g-desktop-1280.png') });

    /* ── NOTHING INVISIBLE IS SITTING ON THE PAGE ─────────────────────────
       Every assertion in this file clicked things by calling .click() on the
       element, which fires whether or not a person could ever reach it. So a
       closed sheet parked over the middle of the page at opacity 0 — fixed,
       520px wide, and never told to ignore the pointer — swallowed real
       clicks on the unit grid for weeks while every test went on passing.

       This asks the browser the question a thumb asks: at the centre of this
       button, what would actually be hit? Only on the wide layout, because
       that is the layout where the closed sheet has a position on screen at
       all. */
    const reach = await desk.evaluate(() => {
      document.querySelector('#floors button').click();
      const seen = [];
      const check = els => els.map(el => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        /* Bound the POINT, not the box: a button straddling the fold has its
           top on screen and its centre below it, and elementFromPoint outside
           the viewport answers null — which is not the same as 'covered'. */
        if (r.width === 0 || cy < 0 || cy > innerHeight || cx < 0 || cx > innerWidth) return null;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && (hit === el || el.contains(hit))) return null;
        return { what: (el.textContent || '').trim().split('\n')[0].slice(0, 12),
                 blockedBy: hit ? (hit.id || hit.className || hit.tagName) : 'nothing' };
      }).filter(Boolean);
      const units  = check([...document.querySelectorAll('#units button')]);
      document.getElementById('back').click();
      const floors = check([...document.querySelectorAll('#floors button')]);
      return { units, floors,
               nUnits: document.querySelectorAll('#units button').length };
    });
    reach.units.length === 0
      ? ok('every unit on screen can actually be clicked \u2014 nothing invisible is over the grid')
      : bad(reach.units.length + ' unit(s) are covered by something: ' +
            JSON.stringify(reach.units.slice(0, 3)));
    reach.floors.length === 0
      ? ok('and every floor chip too')
      : bad(reach.floors.length + ' floor chip(s) are covered: ' +
            JSON.stringify(reach.floors.slice(0, 3)));
    await desk.close();

    /* ── TIME TO INTERACTIVE, throttled ─────────────────────────────────── */
    step('Time to interactive on a slow connection');
    const slow = await browser.newPage();
    await slow.setViewport({ width: 380, height: 780, deviceScaleFactor: 1, isMobile: true });
    const cdp = await slow.target().createCDPSession();
    await cdp.send('Network.enable');
    /* Regular 3G, and a 4x CPU handicap for the mid-range Android this is
       actually deployed to. */
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 300, downloadThroughput: 780 * 1024 / 8,
      uploadThroughput: 330 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    /* BEST OF THREE, NOT ONE. A single throttled load measures the machine
       as much as the page: the same bytes came back at 2.5s, 4.4s, 5.8s and
       6.2s on this laptop across four consecutive runs, which turned a real
       budget into a coin toss and, worse, would have let a genuine
       regression hide inside the noise. The floor of a noisy measurement is
       the closest thing to the page's actual cost — a page that got slower
       cannot produce a fast run, but a busy machine can produce a slow one. */
    let tPaint = Infinity, tScript = Infinity, transfer = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now();
      await slow.goto(BASE + '/availability.html?preview=1', { waitUntil: 'domcontentloaded' });
      await slow.waitForFunction(() => typeof window._availPreview === 'function', { timeout: 60000 });
      const ts = Date.now() - t0;
      await slow.evaluate(p => window._availPreview(p), payload);
      await slow.waitForFunction(() => document.querySelectorAll('#floors button').length > 0,
                                 { timeout: 60000 });
      const tp = Date.now() - t0;
      if (tp < tPaint) {
        tPaint = tp; tScript = ts;
        transfer = await slow.evaluate(() =>
          performance.getEntriesByType('resource')
            .reduce((n, r) => n + (r.transferSize || 0), 0) +
          (performance.getEntriesByType('navigation')[0] || {}).transferSize || 0);
      }
    }
    console.log('     shell ready ' + tScript + ' ms  ·  floors painted ' + tPaint +
                ' ms   (best of 3)');
    console.log('     page + scripts over the wire: ' + Math.round(transfer / 1024) + ' KB');
    console.log('     payload on top of that: ' + Math.round(bytes / 1024) + ' KB');
    tPaint < 6000
      ? ok('interactive in ' + (tPaint / 1000).toFixed(1) + 's on Regular 3G with a 4× CPU handicap')
      : bad('took ' + (tPaint / 1000).toFixed(1) + 's to become interactive');
    await slow.close();

    /* ══ LIFTED FROM verify-public-availability.js ═════════════════════════
       Twenty-six assertions from the old suite that never depended on the tower
       model: the token, the hash, the table's permissions, what the wire
       carries, rotation, revocation, and what a dead link says. They are the
       reason that file existed, and the redesign does not touch any of them, so
       they move here rather than being retired with it.

       Everything runs on ZZTEST, where a link can be created and thrown away.
       Nothing here reaches Awami. ══════════════════════════════════════════ */
    step('The token, the table and the permissions \u2014 lifted from the old suite');
    const zz = await sql(`SELECT p.id, p.project_name, c.id AS co, c.company_name
                            FROM public.projects p JOIN public.companies c ON c.id = p.company_id
                           WHERE c.company_name ILIKE '%zztest%'
                             AND EXISTS (SELECT 1 FROM public.units u WHERE u.project_id = p.id)
                           ORDER BY p.project_name LIMIT 1;`);
    if (!zz.length) { bad('no ZZTEST project with units to test against'); }
    else {
      const ZZ = zz[0].co, ZZ_PROJECT = zz[0].id;
      await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('zz-avail-dir','zz-avail-rep');
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT s.company_id, s.id, NULL, 'zz-avail-dir', now() + interval '10 minutes'
          FROM public.sales_users s WHERE s.company_id='${ZZ}' AND s.role='director' LIMIT 1;`);

      const made = await sql(`SELECT public.create_availability_link('zz-avail-dir','${ZZ_PROJECT}','avail shot') AS r;`);
      const TOKEN = made[0].r && made[0].r.token;
      /* 1 */ (made[0].r.success && /^[0-9a-f]{32}$/.test(TOKEN || ''))
        ? ok('token is 128 random bits: ' + String(TOKEN).slice(0, 8) + '\u2026')
        : bad('token looks wrong: ' + JSON.stringify(made[0].r));

      const stored = await sql(`SELECT token_hash, label FROM public.availability_links
                                 WHERE token_hash = public._availability_token_hash('${TOKEN}');`);
      /* 2 */ stored.length === 1 ? ok('the link is stored') : bad('the link was not stored');
      /* 3 */ (stored[0] && stored[0].token_hash !== TOKEN && /^[0-9a-f]{64}$/.test(stored[0].token_hash))
        ? ok('stored as a sha256 hash, not the link: ' + stored[0].token_hash.slice(0, 12) + '\u2026')
        : bad('the raw token is in the table');
      const anyRaw = await sql(`SELECT count(*)::int n FROM public.availability_links
                                 WHERE token_hash LIKE '%${TOKEN}%';`);
      /* 4 */ Number(anyRaw[0].n) === 0
        ? ok('a dump of the table yields no working link')
        : bad('the table contains the raw token');
      const cols = await sql(`SELECT column_name FROM information_schema.columns
                               WHERE table_schema='public' AND table_name='availability_links';`);
      /* 5 */ !cols.some(c => c.column_name === 'token')
        ? ok('the plaintext token column is gone')
        : bad('availability_links still has a plaintext token column');

      const listed = await sql(`SELECT public.list_availability_links('zz-avail-dir') AS r;`);
      const one = (listed[0].r.links || [])[0];
      /* 6 */ !JSON.stringify(listed[0].r).includes(TOKEN)
        ? ok('the director list never echoes the link back')
        : bad('list_availability_links leaked the token');
      /* 7 */ (one && one.label)
        ? ok('but it does show which links exist: "' + one.label + '" on ' + one.project)
        : bad('the director cannot see which links exist');

      await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-avail-rep';
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT s.company_id, s.id, s.project_id, 'zz-avail-rep', now()+interval '10 minutes'
          FROM public.sales_users s WHERE s.company_id='${ZZ}' AND s.role NOT IN ('director','admin','cfo') LIMIT 1;`);
      const repTry = await sql(`SELECT public.create_availability_link('zz-avail-rep','${ZZ_PROJECT}','nope') AS r;`);
      /* 8 */ repTry[0].r.success === false
        ? ok('a rep cannot mint a public link \u2014 refused with ' + repTry[0].r.error)
        : bad('a rep minted a public link: ' + JSON.stringify(repTry[0].r));

      const acl = await sql(`SELECT has_table_privilege('anon','public.availability_links','SELECT') AS s,
                                    relrowsecurity AS rls
                               FROM pg_class WHERE oid='public.availability_links'::regclass;`);
      /* 9  */ acl[0].s === false ? ok('anon has no SELECT on availability_links')
                                  : bad('anon can read the token table');
      /* 10 */ acl[0].rls === true ? ok('and RLS is on (deny-all, no policies)')
                                   : bad('RLS is off on availability_links');

      /* The management RPCs ARE callable by anon and that is not a hole: the
         whole portal is an unauthenticated client that identifies its user with
         a session token passed as an argument, so every portal RPC runs as anon.
         The control is the session and role check inside each function, not the
         GRANT \u2014 and that is what has to be measured. An earlier version of the
         old harness asserted grant-level exclusivity instead, which was both
         wrong and the reason the Share-link screen 401'd for real directors. */
      const guarded = await sql(`
        SELECT (public.list_availability_links('no-such-session')->>'error')                  AS l,
               (public.create_availability_link('no-such-session','${ZZ_PROJECT}')->>'error') AS c,
               (public.revoke_availability_link('no-such-session','x')->>'error')             AS r;`);
      /* 11 */ (guarded[0].l === 'session_expired' && guarded[0].c === 'session_expired' &&
                guarded[0].r === 'session_expired')
        ? ok('the three management RPCs refuse a caller with no session')
        : bad('a management RPC answered without a session: ' + JSON.stringify(guarded[0]));
      const repGuard = await sql(`
        SELECT (public.list_availability_links('zz-avail-rep')->>'error')                  AS l,
               (public.create_availability_link('zz-avail-rep','${ZZ_PROJECT}')->>'error') AS c;`);
      /* 12 */ (!!repGuard[0].l && !!repGuard[0].c)
        ? ok('and refuse a rep who does have a session (list: ' + repGuard[0].l +
             ', create: ' + repGuard[0].c + ')')
        : bad('a rep reached a management RPC: ' + JSON.stringify(repGuard[0]));
      const pubOk = await sql(`SELECT (public.get_public_availability('nope')->>'error') AS e;`);
      /* 13 */ pubOk[0].e === 'not_available'
        ? ok('while the public one answers anyone, safely')
        : bad('the public function said something else: ' + pubOk[0].e);

      /* ── the browser, on the real route ──────────────────────────────── */
      const live = await visitToken(browser, TOKEN);
      /* 14 */ live.wire.length > 0
        ? ok('captured the response body over the real anon key')
        : bad('nothing came back on the wire');
      const SECRETS = await sql(`
        SELECT COALESCE(c.full_name,'zz-no-buyer') AS buyer, COALESCE(c.phone_primary,'zz-no-phone') AS phone,
               COALESCE(s.sale_number,'zz-no-sale') AS sale_no
          FROM public.sales s LEFT JOIN public.clients c ON c.id = s.client_id
         WHERE s.project_id='${ZZ_PROJECT}' AND s.status='active' LIMIT 1;`);
      const secret = SECRETS[0] || {};
      const leaked = Object.keys(secret).filter(k => secret[k] && live.wire.includes(secret[k]));
      /* 15 */ leaked.length === 0
        ? ok('no buyer name, phone or sale number on the wire' +
             (secret.buyer ? ' (looked for ' + secret.buyer + ')' : ''))
        : bad('LEAKED on the wire: ' + leaked.join(', '));
      /* show_price is a switch, not a price: it says whether this project put
         its totals on the link, and for ZZTEST it says no. The next check reads
         it rather than trusting the name. */
      const privKeys = ['client', 'phone', 'paid', 'outstanding', 'overdue', 'net_amount',
                        'sale_number', 'due', 'price', 'base_price']
        .filter(k => new RegExp('"[a-z_]*' + k, 'i')
                       .test(live.wire.replace(/"show_price"/g, '"switch"')));
      /* 16 */ privKeys.length === 0
        ? ok('not one private key name is present, price included')
        : bad('private key names on the wire: ' + privKeys.join(', '));

      /* ── AND THE OTHER SIDE OF THE SWITCH ─────────────────────────────────
         Awami publishes its totals because Rashid asked. ZZTEST never did, and
         neither did Khushal Bagh Heights or Fourteen Manzil Height, which run
         on this same code. A project that did not ask must carry no total at
         all \u2014 not a null one, not a zero one, no key. */
      const off = JSON.parse(live.wire);
      const anyV = (off.floors || []).some(fl => (fl.units || [])
        .some(u => Object.prototype.hasOwnProperty.call(u, 'v')));
      (off.show_price === false && !anyV)
        ? ok('a project that never asked for it carries no total at all \u2014 ' +
              'the switch is off and not one unit has the key')
        : bad('a project without the switch is carrying prices: show_price=' +
               off.show_price + ' units with a total: ' + anyV);
      const rpcNames = [...new Set((live.code.match(/\.rpc\(\s*['"]([a-z_]+)['"]/g) || [])
        .map(m => m.replace(/.*['"]([a-z_]+)['"]/, '$1')))];
      /* 17 — THE PAGE'S WHOLE REACH INTO THE SERVER, by name, from its source.
         Six: read the board, register a request, register several at once, ask
         for a change on a unit it already holds, ask what happened to any of
         them, and — behind a password — read the directors' report. Nothing
         that books, nothing that decides, nothing that names a portal RPC. The
         set is exact, so a seventh appearing is a failure rather than a
         surprise, which is the only reason this page can be handed to anybody.

         The plural was added deliberately and is the same thing as the singular:
         it loops over submit_availability_request with this link's own token, so
         it reaches nothing the singular could not, writes nothing but pending
         rows, and still holds no unit — a director's tap does that.

         get_availability_report was added on 2026-09-10 and is the first thing
         here gated by a secret rather than by the token. It READS: no unit
         changes hands through it. Its lock is tested end to end further down. */
      const allowedRpc = ['get_availability_report', 'get_public_availability',
                          'get_request_status',
                          'submit_availability_request', 'submit_availability_requests',
                          'submit_change_request'].sort();
      (JSON.stringify(rpcNames.slice().sort()) === JSON.stringify(allowedRpc))
        ? ok('the page can call exactly these and nothing else: ' + rpcNames.sort().join(', '))
        : bad('the page calls: ' + (rpcNames.join(', ') || 'nothing at all'));

      /* ══ THE ASSERTION THAT WAS INVERTED ═══════════════════════════════
         The old suite asserted "all 30 ZZTEST units drawn". Under the new model
         that is not merely obsolete, it is the OPPOSITE of the requirement: the
         page must never put a whole building in the document. Dropping it would
         have left the redesign's central rule as an intention. It is inverted
         instead \u2014 on the real route, with a real token, the number of unit
         chips in the document must be LESS than the project's unit count, and on
         the first screen it must be zero. */
      /* 18 */ (live.unitsOnHome === 0 && live.totalUnits > 0)
        ? ok('on the real route the first screen renders 0 of ' + live.totalUnits + ' units')
        : bad('the first screen rendered ' + live.unitsOnHome + ' units');
      /* 19 */ (live.unitsAfterFloor > 0 && live.unitsAfterFloor < live.totalUnits)
        ? ok('and opening a floor renders ' + live.unitsAfterFloor + ' of ' + live.totalUnits +
             ' \u2014 never the whole building')
        : bad('a floor rendered ' + live.unitsAfterFloor + ' of ' + live.totalUnits + ' units');

      /* ── rotation ────────────────────────────────────────────────────── */
      const other = await sql(`SELECT id FROM public.projects
                                WHERE company_id='${ZZ}' AND id <> '${ZZ_PROJECT}' LIMIT 1;`);
      let OTHER = null;
      if (other.length) {
        const m2 = await sql(`SELECT public.create_availability_link('zz-avail-dir','${other[0].id}','avail second') AS r;`);
        OTHER = m2[0].r.token;
        /* 20 */ (OTHER && OTHER !== TOKEN)
          ? ok('a second project gets a different token')
          : bad('two projects share a token');
      } else { ok('only one ZZTEST project exists \u2014 isolation covered by rotation'); }

      const rot = await sql(`SELECT public.create_availability_link('zz-avail-dir','${ZZ_PROJECT}','avail rotated') AS r;`);
      const ROTATED = rot[0].r.token;
      const oldDead = await sql(`SELECT (public.get_public_availability('${TOKEN}')->>'success') AS s;`);
      const newLive = await sql(`SELECT (public.get_public_availability('${ROTATED}')->>'success') AS s;`);
      /* 21 */ oldDead[0].s === 'false' ? ok('rotating retires the previous link for that project')
                                        : bad('the old link still works after rotation');
      /* 22 */ newLive[0].s === 'true' ? ok('and the fresh one works')
                                       : bad('the rotated link does not work');
      if (OTHER) {
        const otherLive = await sql(`SELECT (public.get_public_availability('${OTHER}')->>'success') AS s;`);
        /* 23 */ otherLive[0].s === 'true'
          ? ok("the other project's link is untouched")
          : bad('rotating one project killed another');
      }

      /* ── revocation, and what a dead link says ───────────────────────── */
      const rev = await sql(`SELECT public.revoke_availability_link('zz-avail-dir','${ROTATED}') AS r;`);
      /* 24 */ rev[0].r.success === true ? ok('the director revoked it')
                                         : bad('revoke failed: ' + JSON.stringify(rev[0].r));
      const dead = await visitToken(browser, ROTATED);
      /* 25 */ /not available/i.test(dead.text)
        ? ok('the revoked link says so plainly')
        : bad('a revoked link shows: ' + dead.text.slice(0, 60));
      /* 26 */ !new RegExp(zz[0].project_name.split(' ')[0], 'i').test(dead.text)
        ? ok('and does not even name the project it used to show')
        : bad('the dead page names the project');
      /* 27 */ dead.url.includes('/a/')
        ? ok('still on the public route, never redirected into the portal')
        : bad('a dead link redirected to ' + dead.url);
      const guess = await visitToken(browser, 'deadbeefdeadbeefdeadbeefdeadbeef');
      /* 28 */ guess.text === dead.text
        ? ok('a guessed token gives the identical answer \u2014 no oracle')
        : bad('a guessed token answers differently from a revoked one');

      await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('zz-avail-dir','zz-avail-rep');`);
    }

    /* ══ THE WHOLE ROUND TRIP ══════════════════════════════════════════════
       A dealer taps Request on the real page, through the real link, and the
       request has to arrive in the desk with the duration THEY chose and the
       name THEIR phone carries — then one tap books it, for real, with the
       reservation carrying that duration. Nothing about that can be seen in a
       screenshot, and nothing about it is provable from either end alone.

       On ZZTEST. The link is created and revoked here. ══════════════════ */
    step('A dealer asks, the desk answers \u2014 the whole round trip');
    const okU2 = m => console.log('  \u2705 ' + m);
    const badU2 = m => { console.log('  \u274C ' + m); FAILED = true; };
    {
      /* TWO free units at least: the round trip approves one and declines
         another, and a project with one would leave the decline half silently
         untested. */
      const zz2 = await sql(`SELECT p.id, p.company_id, p.project_name,
                                    count(*) FILTER (WHERE st.is_available) AS free
                               FROM public.projects p
                               JOIN public.companies c ON c.id=p.company_id
                               JOIN public.units u ON u.project_id=p.id
                               LEFT JOIN public.category_unit_statuses st ON st.id=u.status_id
                              WHERE c.company_name ILIKE '%zztest%'
                               AND EXISTS (SELECT 1 FROM public.sales_users su
                                            WHERE su.company_id = p.company_id AND su.role = 'director')
                              GROUP BY p.id, p.company_id, p.project_name
                             HAVING count(*) FILTER (WHERE st.is_available) >= 2
                              /* A DETERMINISTIC PICK. Three ZZTEST projects sit on
                                 exactly 18 free units, so "the freest one" was a coin
                                 toss, and one of the three companies has no director —
                                 which is why this whole section passed twice and then
                                 failed twice without a line of it changing. The director
                                 is now a condition of being chosen, and the tie is
                                 broken by id so the same project is picked every run. */
                              ORDER BY free DESC, p.id LIMIT 1;`);
      /* Clear whatever a previous run left behind. ZZTEST only, and only rows
         this harness could have written — a failed run must not poison the
         next one's reading of the queue. */
      await sql(`DELETE FROM public.availability_requests r
                  USING public.companies c
                  WHERE c.id = r.company_id AND c.company_name ILIKE '%zztest%';`);

      if (!zz2.length) { bad('no ZZTEST project with two free units'); }
      else {
        await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-rt-dir';
          INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
          SELECT s.company_id, s.id, NULL, 'zz-rt-dir', now()+interval '10 minutes'
            FROM public.sales_users s WHERE s.company_id='${zz2[0].company_id}' AND s.role='director' LIMIT 1;`);
        const mk = await sql(`SELECT public.create_availability_link('zz-rt-dir','${zz2[0].id}','round trip') AS r;`);
        const T = mk[0].r.token;
        /* If the link was never minted, every assertion below is really about
           THIS, and blaming the dealer page for a token that does not exist
           sent me looking in the wrong file once already. */
        if (!T) { badU2('no link to test with — create_availability_link said: ' +
                        JSON.stringify(mk[0].r)); throw new Error('link not minted'); }

        /* THE DEALER. A fresh browser profile: no name, no history. */
        const ctx = await browser.createBrowserContext();
        const dp = await ctx.newPage();
        const derrs = [];
        dp.on('pageerror', e => derrs.push(String(e.message || e)));
        await dp.setViewport({ width: 380, height: 780 });
        await dp.goto(BASE + '/a/' + T, { waitUntil: 'domcontentloaded', timeout: 30000 });
        /* Wait for the thing the next step touches, not for the network. A
           crash on a null element hides whether the page loaded at all. */
        const ready = await dp.waitForFunction(() =>
          !!document.getElementById('nm-in') ||
          /not available/i.test(document.body.innerText), { timeout: 30000 })
          .then(() => true).catch(() => false);
        const shape = await dp.evaluate(() => ({
          dead: /not available/i.test(document.body.innerText),
          asks: !!document.getElementById('nm-in'),
          floors: document.querySelectorAll('#floors button').length }));
        (ready && shape.asks && shape.floors > 0)
          ? okU2('a fresh phone opens the link and is asked for a name (' + shape.floors + ' floors)')
          : badU2('the dealer page did not come up: ' + JSON.stringify(shape));
        if (!shape.asks) throw new Error('dealer page not usable: ' + JSON.stringify(shape));

        const asked = await dp.evaluate(async () => {
          /* give the name the way a dealer does */
          document.getElementById('nm-in').value = 'Round Trip Rep';
          document.getElementById('nm-ok').click();
          await new Promise(r => setTimeout(r, 150));
          document.querySelector('#floors button').click();
          const u = document.querySelector('#units button:not(.off)');
          const unit = u.querySelector('.un').textContent.trim();
          u.click();
          await new Promise(r => setTimeout(r, 250));
          /* 3 days, not the default 7 — so the duration is proven to travel */
          document.querySelector('#dur button[data-d="3"]').click();
          /* The Copy button is gone from the sheet — one action and a cancel
             now — but requestAndSend still knows how to register without
             opening WhatsApp, which is the only reason a test used it. */
          await requestAndSend('copy');
          /* Captured while the sheet is still up: it confirms and then closes
             itself, and a sleep long enough for the request to land is also
             long enough for SHEET to be gone. */
          const out = { unit, ref: (window.SHEET || {}).ref, msg: message() };
          /* Past the 1600ms the confirmation waits before it goes — a shorter
             sleep would measure the timer rather than the behaviour. */
          await new Promise(r => setTimeout(r, 2000));
          out.dismissed = !window.SHEET;
          return out;
        });
        asked.ref
          ? okU2('the dealer\u2019s tap registered a request, ref ' + asked.ref)
          : badU2('no ref came back from the server');
        new RegExp('REQ-' + asked.ref).test(asked.msg || '')
          ? okU2('and the WhatsApp message carries THAT ref, not one invented in the browser')
          : badU2('the message ref does not match: ' + String(asked.msg).split('\n')[1]);
        /* A tap needs an ending. The sheet says the ask is registered, shows the
           number the desk will quote back, and then goes — rather than simply
           vanishing, which reads as a dismissal. */
        asked.dismissed
          ? okU2('the sheet confirms the request and then dismisses itself')
          : badU2('the sheet stayed open after sending');
        await dp.screenshot({ path: path.join(OUT, 'k-request-sent.png') });

        /* A TYPED DURATION, all the way through. 12 is not one of the chips and
           not the default, so if anything anywhere quietly rewrites it the
           number that comes out the other end will not be 12. */
        const custom = await dp.evaluate(async TAKEN => {
          closeSheet();
          document.getElementById('back').click();
          document.querySelector('#floors button').click();
          const free = [...document.querySelectorAll('#units button:not(.off)')];
          /* Never the one already asked for: the cap would hand back that
             request's own ref and this step would then delete it. */
          const u = free.filter(b => b.querySelector('.un').textContent.trim() !== TAKEN)
                        .slice(-1)[0];
          if (!u) return null;
          u.click();
          await new Promise(r => setTimeout(r, 250));
          const box = document.getElementById('dcust');
          box.value = '12';
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const litChips = [...document.querySelectorAll('#dur button.on')].length;
          const boxLit = box.classList.contains('on');
          await requestAndSend('copy');
          const out2 = { ref: (window.SHEET || {}).ref, days: (window.SHEET || {}).days,
                         unit: (window.SHEET || {}).n, litChips, boxLit, msg: message() };
          await new Promise(r => setTimeout(r, 1400));
          return out2;
        }, asked.unit);
        if (!custom || !custom.ref) { badU2('the custom duration request did not register'); }
        else {
          (custom.litChips === 0 && custom.boxLit)
            ? okU2('typing 12 lights the box and lets go of every chip')
            : badU2('both a chip and the box look chosen: ' + JSON.stringify(custom));
          /Duration: 12 days/.test(custom.msg)
            ? okU2('the WhatsApp message says 12 days')
            : badU2('the message says ' + (String(custom.msg).match(/Duration:.*/) || [''])[0]);
          const cRow = await sql(`SELECT days, status FROM public.availability_requests
                                   WHERE ref='${custom.ref}';`);
          Number(cRow[0] && cRow[0].days) === 12
            ? okU2('and the desk receives 12 days, not a rewritten 7')
            : badU2('the queue received ' + JSON.stringify(cRow[0]));
          custom.ref !== asked.ref
            ? okU2('and it is a request of its own, not the first one handed back')
            : badU2('the custom step landed on ' + custom.unit + ', the unit already asked for');
          if (custom.ref !== asked.ref) {
            await sql(`DELETE FROM public.availability_requests WHERE ref='${custom.ref}';`);
          }
        }

        /* NOTHING IS BOOKED YET. This is the whole safety of the anon write. */
        const mid = await sql(`
          SELECT (SELECT count(*)::int FROM public.availability_requests
                   WHERE ref='${asked.ref}' AND status='pending')                    AS pending,
                 (SELECT requested_by_name FROM public.availability_requests WHERE ref='${asked.ref}') AS who,
                 (SELECT days FROM public.availability_requests WHERE ref='${asked.ref}')              AS days,
                 (SELECT count(*)::int FROM public.reservations r
                    JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}'
                     AND r.status='active')                                          AS booked;`);
        (mid[0].pending === 1 && mid[0].booked === 0)
          ? okU2('the request is waiting and NOTHING is booked \u2014 submit reserves nothing')
          : badU2('state after the ask: ' + JSON.stringify(mid[0]));
        (mid[0].who === 'Round Trip Rep' && Number(mid[0].days) === 3)
          ? okU2('it carries the name and the 3 days the dealer chose')
          : badU2('the request lost the name or the duration: ' + JSON.stringify(mid[0]));

        /* THE DESK. Same session, the real list function. */
        const q = await sql(`SELECT public.list_reservation_requests('zz-rt-dir','${zz2[0].id}') AS r;`);
        const rows = (q[0].r.requests || []).filter(x => x.ref === asked.ref);
        rows.length === 1
          ? okU2('it appears in the desk queue with unit ' + rows[0].unit_no + ', ' +
                 rows[0].days + ' days, ' + rows[0].requested_by)
          : badU2('the request is not in the desk queue');

        /* ── the desk, with the request waiting on it ─────────────────── */
        const deskCtx = await browser.createBrowserContext();
        const deskPage = await deskCtx.newPage();
        const deskErrs = [];
        deskPage.on('pageerror', e2 => deskErrs.push(String(e2.message || e2)));
        await deskPage.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
        await deskPage.goto(BASE + '/sales-portal.html', { waitUntil: 'domcontentloaded' });
        await deskPage.evaluate(t => {
          localStorage.setItem('rms.sales.token', t);
          localStorage.setItem('rms.sales.active', String(Date.now()));
          sessionStorage.setItem('nx.hub.bounce', '1');
        }, 'zz-rt-dir');
        await deskPage.goto(BASE + '/sales-portal.html?tab=desk', { waitUntil: 'domcontentloaded' });
        await deskPage.waitForFunction(() => !!document.getElementById('rd-root'), { timeout: 60000 });
        await sleep(1800);
        const deskQ = await deskPage.evaluate(myRef => {
          const box = document.getElementById('rd-reqs');
          const cards = [...(box ? box.querySelectorAll('.rq-c') : [])];
          /* BY REF, not by position. The queue is oldest-first and anything
             else waiting is somebody else's row. */
          const mine = cards.filter(c => c.innerText.indexOf(myRef) >= 0)[0] || null;
          return {
            count: cards.length,
            badge: (box && box.querySelector('.rq-n') || {}).textContent || '',
            found: !!mine,
            first: mine ? mine.innerText.replace(/\s+/g, ' ').trim() : '',
            acts: mine ? [...mine.querySelectorAll('.rq-a button')].map(b2 => b2.textContent.trim()) : []
          };
        }, asked.ref);
        (deskQ.found && deskQ.count === 1)
          ? okU2('the desk shows this request and only this one, badge "' + deskQ.badge + '"')
          : badU2('the desk queue holds ' + deskQ.count + ' card(s), ours found: ' + deskQ.found);
        (deskQ.acts.length === 2 && /^approve/i.test(deskQ.acts[0]) && /decline/i.test(deskQ.acts[1]))
          ? okU2('with exactly two buttons: ' + deskQ.acts.join(' and '))
          : badU2('the card offers ' + JSON.stringify(deskQ.acts));

        /* ── APPROVE ASKS WHICH ────────────────────────────────────────────
           It used to apply whatever tag was armed on the desk behind this
           queue — invisible from the card, and wrong the moment the last
           booking was a Pagri and this one is not. The question is now asked
           where the decision is made, and the answer travels with it. */
        const pick = await deskPage.evaluate(myRef => {
          const card = [...document.querySelectorAll('#rd-reqs .rq-c')]
            .find(c => c.innerText.indexOf(myRef) >= 0);
          if (!card) return { none: true };
          card.querySelector('.rq-a button[data-act="approve"]').click();
          const box = card.querySelector('.rq-pick');
          const tags = [...card.querySelectorAll('.rq-t')].map(b => ({
            name: b.textContent.trim(), nature: b.getAttribute('data-nature') }));
          return { none: false,
                   opened: !!box && !box.hidden,
                   actionsHidden: !!card.querySelector('.rq-a').hidden,
                   tags };
        }, asked.ref);
        (!pick.none && pick.opened && pick.actionsHidden)
          ? okU2('pressing Approve asks which status, on the card itself')
          : badU2('Approve did not ask: ' + JSON.stringify(pick));
        (pick.tags && pick.tags.length && pick.tags.every(t => t.nature))
          ? okU2('and it offers this project\u2019s own tags: ' +
                 pick.tags.map(t => t.name).join(', '))
          : badU2('the picker offers nothing usable: ' + JSON.stringify(pick.tags));
        await deskPage.screenshot({ path: path.join(OUT, 'm2-approve-asks.png') });
        /* put it back, so the decision below is made the way a person makes it */
        await deskPage.evaluate(() => {
          const b = document.querySelector('#rd-reqs .rq-pick button[data-act="cancelpick"]');
          if (b) b.click();
        });
        /Round Trip Rep/.test(deskQ.first) && /3 days/.test(deskQ.first)
          ? okU2('and the card already carries the name and the duration: ' +
                 deskQ.first.slice(0, 70))
          : badU2('the card is missing the name or the duration: ' + deskQ.first);
        deskErrs.length === 0 ? okU2('no errors on the desk')
                              : badU2('desk errors: ' + deskErrs.slice(0, 2).join(' | '));
        await deskPage.screenshot({ path: path.join(OUT, 'm-desk-queue.png') });

        /* ── THE SIDEBAR, FROM ANOTHER SCREEN ──────────────────────────
           A request is useless if it only announces itself on the screen you
           would have to already be on. Checked from the Daybook, which is
           where he actually is when one arrives. */
        await deskPage.evaluate(() => setTab('daybook'));
        await deskPage.waitForFunction(() => !!document.getElementById('db-root'), { timeout: 40000 });
        await sleep(900);
        const badge = await deskPage.evaluate(async () => {
          const b = document.getElementById('nav-badge-requests');
          return { exists: !!b, shown: !!b && b.classList.contains('show'),
                   text: b ? b.textContent.trim() : '',
                   onDesk: (typeof TAB !== 'undefined') ? TAB : null };
        });
        (badge.exists && badge.shown && badge.text === '1' && badge.onDesk === 'daybook')
          ? okU2('the sidebar shows \u201c1\u201d on Reserve Desk while standing on the Daybook')
          : badU2('the sidebar badge is wrong from another tab: ' + JSON.stringify(badge));
        /* At 420px the sidebar is behind the hamburger, so the badge is set but
           not visible. Photographed at a width where the rail is open, and the
           narrow case is checked separately below. */
        await deskPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
        await sleep(500);
        const wide = await deskPage.evaluate(() => {
          const b = document.getElementById('nav-badge-requests');
          const r = b ? b.getBoundingClientRect() : null;
          return { visible: !!r && r.width > 0 && r.height > 0 && r.left >= 0, text: b ? b.textContent.trim() : '' };
        });
        wide.visible
          ? okU2('and on a wide screen the badge is actually on the rail, reading ' + wide.text)
          : badU2('the badge is set but not rendered on the rail: ' + JSON.stringify(wide));
        await deskPage.screenshot({ path: path.join(OUT, 'n-sidebar-badge.png') });
        await deskPage.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
        await sleep(400);
        /* The narrow case, which is the one he actually uses. The badge is
           behind the drawer, so the burger has to carry the news itself. */
        const narrow = await deskPage.evaluate(() => {
          const t = document.querySelector('.sb-toggle');
          const b2 = document.getElementById('nav-badge-requests');
          const r = b2 ? b2.getBoundingClientRect() : null;
          return { burgerShown: !!t && getComputedStyle(t).display !== 'none',
                   dot: !!t && t.classList.contains('has-req'),
                   badgeOffscreen: !r || r.width === 0 || r.left < 0 };
        });
        (narrow.burgerShown && narrow.dot)
          ? okU2('on a phone the rail is closed, so the burger carries a dot instead')
          : badU2('nothing on the phone says a request is waiting: ' + JSON.stringify(narrow));
        await deskPage.screenshot({ path: path.join(OUT, 'o-phone-dot.png') });

        /* ── A REQUEST ARRIVING WHILE THE DESK IS OPEN ─────────────────
           The watch runs every 45 seconds; waiting that long in a test proves
           patience, not correctness, so the tick is called directly. What is
           being asserted is that a tick with new data repaints the queue and
           moves the badge \u2014 not the length of the interval. */
        await deskPage.evaluate(() => setTab('desk'));
        await deskPage.waitForFunction(() => !!document.getElementById('rd-root'), { timeout: 40000 });
        /* WAIT FOR THE QUEUE, DO NOT GUESS AT IT. A fixed sleep here measured
           the network, not the code: coming back to the desk costs two RPCs,
           and 900ms was sometimes not enough, so the baseline was read as an
           empty queue and every later comparison was against a lie. The one
           card already waiting is a known fact — wait for it, and say so
           plainly if it never comes. */
        const queueBack = await deskPage
          .waitForFunction(() => document.querySelectorAll('#rd-reqs .rq-c').length > 0,
                           { timeout: 20000 })
          .then(() => true).catch(() => false);
        queueBack
          ? okU2('coming back to the desk brings the waiting request with it')
          : badU2('the desk came back empty — the request that is pending did not redraw');

        /* ── AND IT DOES NOT NARROW ITSELF TO THE OPEN TAB ─────────────
           The queue used to be fetched for whichever project the desk happened
           to be showing, and that project is only decided by the FIRST paint —
           so a request could be visible when the desk opened and gone the
           moment he came back to it. Switch the tower deliberately: a request
           addressed to a person must not disappear because he is looking at a
           different building. */
        const spanned = await deskPage.evaluate(async myRef => {
          const sel = document.getElementById('rd-proj');
          if (!sel || sel.options.length < 2) return { only: true };
          const other = [...sel.options].find(o => o.value !== sel.value);
          sel.value = other.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          const mine = () => [...document.querySelectorAll('#rd-reqs .rq-c')]
            .some(c => c.innerText.indexOf(myRef) >= 0);
          for (let i = 0; i < 60 && !mine(); i++) await new Promise(r => setTimeout(r, 250));
          return { only: false, tower: other.textContent.trim(),
                   cards: document.querySelectorAll('#rd-reqs .rq-c').length,
                   found: mine() };
        }, asked.ref);
        spanned.only
          ? okU2('this company has one tower, so there is no other tab to lose it to')
          : (spanned.found
              ? okU2('and switching to ' + spanned.tower + ' still shows THIS request — ' +
                     'the queue is his, not the tab’s')
              : badU2('switching to ' + spanned.tower + ' lost our request (' +
                      spanned.cards + ' other card(s) on screen)'));
        const beforeArr = await deskPage.evaluate(() =>
          document.querySelectorAll('#rd-reqs .rq-c').length);

        /* a second dealer, elsewhere, asks for something */
        const arriving = await sql(`SELECT (public.submit_availability_request('${T}',
          (SELECT u.unit_no FROM public.units u
             JOIN public.category_unit_statuses st ON st.id=u.status_id
            WHERE u.project_id='${zz2[0].id}' AND st.is_available
              AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                               WHERE x.unit_id=u.id AND x.status='pending')
            ORDER BY u.unit_no DESC LIMIT 1), 5, 'Second Rep')->>'ref') AS ref;`);
        if (!arriving[0].ref) { badU2('could not make a second request to arrive'); }
        else {
          const arrived = await deskPage.evaluate(async want => {
            /* The real path: the browser fires this when a tab comes back and
               the watch catches up rather than waiting out its interval. Nudged
               until the card lands, because a fixed sleep here measured the
               network on a busy machine and not whether the desk noticed. */
            for (let i = 0; i < 30; i++) {
              document.dispatchEvent(new Event('visibilitychange'));
              await new Promise(r => setTimeout(r, 400));
              if (document.querySelectorAll('#rd-reqs .rq-c').length === want) break;
            }
            const b = document.getElementById('nav-badge-requests');
            return { cards: document.querySelectorAll('#rd-reqs .rq-c').length,
                     badge: b ? b.textContent.trim() : '' };
          }, beforeArr + 1);
          (arrived.cards === beforeArr + 1 && arrived.badge === String(beforeArr + 1))
            ? okU2('a request arriving while the desk is open appears without a reload (' +
                   beforeArr + ' \u2192 ' + arrived.cards + ', badge ' + arrived.badge + ')')
            : badU2('the open desk did not pick it up: ' + JSON.stringify(arrived));
          await sql(`DELETE FROM public.availability_requests WHERE ref='${arriving[0].ref}';`);
          /* Waited on rather than slept through: a fixed 1200ms measured the
             network on a busy machine, not whether the desk lets go. The tick
             is nudged more than once because one of them may land before the
             delete is visible. */
          const cleared = await deskPage.evaluate(async want => {
            for (let i = 0; i < 30; i++) {
              document.dispatchEvent(new Event('visibilitychange'));
              await new Promise(r => setTimeout(r, 400));
              if (document.querySelectorAll('#rd-reqs .rq-c').length === want) break;
            }
            const b = document.getElementById('nav-badge-requests');
            return { cards: document.querySelectorAll('#rd-reqs .rq-c').length,
                     shown: !!b && b.classList.contains('show') };
          }, beforeArr);
          cleared.cards === beforeArr
            ? okU2('and it disappears again when it is gone')
            : badU2('a withdrawn request stayed on the desk: ' + JSON.stringify(cleared));
        }
        await deskCtx.close();

        const dec = await sql(`SELECT public.decide_reservation_request('zz-rt-dir',
                                 (SELECT id FROM public.availability_requests WHERE ref='${asked.ref}'),
                                 'approve') AS r;`);
        dec[0].r.success === true
          ? okU2('one tap approves it')
          : badU2('approve failed: ' + JSON.stringify(dec[0].r));
        const after = await sql(`
          SELECT (SELECT status FROM public.availability_requests WHERE ref='${asked.ref}') AS st,
                 (SELECT count(*)::int FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}' AND r.status='active') AS booked,
                 (SELECT r.requested_by_name FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}' AND r.status='active') AS who,
                 (SELECT EXTRACT(DAY FROM (r.expiry_date - r.created_at))::int
                    FROM public.reservations r JOIN public.units u ON u.id=r.unit_id
                   WHERE u.unit_no='${asked.unit}' AND u.project_id='${zz2[0].id}' AND r.status='active') AS days;`);
        (after[0].st === 'approved' && after[0].booked === 1 &&
         after[0].who === 'Round Trip Rep' && Number(after[0].days) === 3)
          ? okU2('and the unit is really reserved \u2014 for ' + after[0].who + ', ' + after[0].days + ' days')
          : badU2('after approve: ' + JSON.stringify(after[0]));

        /* THE DEALER SEES THE ANSWER. Decline a second one and read it back
           through the page's own status call. */
        const second = await dp.evaluate(async () => {
          closeSheet();
          document.getElementById('back').click();
          document.querySelector('#floors button').click();
          /* A DIFFERENT unit. The payload in this browser still predates the
             approval, so the first free chip is the one just booked and the
             request would be refused — which is correct behaviour, and not what
             this half is testing. */
          const free = [...document.querySelectorAll('#units button:not(.off)')];
          const u = free[1] || free[0];
          if (!u) return null;
          u.click();
          await new Promise(r => setTimeout(r, 250));
          await requestAndSend('copy');
          /* The ref is set inside submitRequest, before the receipt screen and
             its 1600ms self-close. Waiting 1400ms for it raced that timer and
             read null often enough to fail a run that was otherwise green. */
          await new Promise(r => setTimeout(r, 200));
          return (window.SHEET || {}).ref;
        });
        if (!second) { badU2('no second unit to decline'); }
        else {
          await sql(`SELECT public.decide_reservation_request('zz-rt-dir',
                       (SELECT id FROM public.availability_requests WHERE ref='${second}'),
                       'decline');`);
          const seen = await dp.evaluate(async () => {
            await refreshMyReqs();
            await new Promise(r => setTimeout(r, 300));
            /* THE REPORT MOVED. It was six rows at the top of screen one; it
               is a screen of its own behind the card now, so this reads it
               there \u2014 the same builder draws it, and it is the only copy. */
            const c = document.querySelector('#myq [data-mine]');
            if (c) c.click();
            return document.getElementById('mine-body').innerText;
          });
          /Declined by Management/.test(seen)
            ? okU2('a decline reaches the dealer\u2019s page as \u201cDeclined by Management\u201d')
            : badU2('the dealer does not see the decline: ' + String(seen).replace(/\s+/g, ' ').slice(0, 90));
          /Reserved for you/.test(seen)
            ? okU2('and the approved one reads \u201cReserved for you\u201d')
            : badU2('the approved request does not show as reserved');

          /* ── AND HIS OWN POSITION, ON THE PAGE HE ALREADY HAS OPEN ────────
             A dealer holding fourteen units could see fourteen request rows and
             no total, and nothing at all about the clock \u2014 which is the number
             that matters, because a hold lets go on its own and the unit goes
             back on the board.

             Counted from the GRANTED tag rather than the asked one, and only
             from holds still standing: one approved, one declined, so the
             summary has to say ONE. */
          const mine = await dp.evaluate(() => ({
            head: (document.querySelector('#mine .myq-s .n') || {}).textContent || '',
            tags: [...document.querySelectorAll('#mine .myq-t span')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
            clock: (document.querySelector('#mine .myq-w') || {}).textContent || '',
            rows: document.querySelectorAll('#mine .myq-r').length,
            summary: (window.mySummary ? mySummary() : null)
          }));

          /* The page carries more requests than holds \u2014 one approved, one
             declined, one still waiting \u2014 which is exactly the case the count
             has to get right: it counts UNITS HE HAS, not rows on the screen. */
          (mine.summary && mine.summary.held === 1 && mine.rows > 1 &&
           /^1\s*unit with you/.test(mine.head.replace(/\s+/g, ' ')))
            ? okU2('his own line at the top says \u201c' + mine.head.replace(/\s+/g, ' ').trim() +
                   '\u201d \u2014 ' + mine.rows + ' requests on the page, one unit actually his')
            : badU2('the summary miscounts: ' + JSON.stringify(mine));
          (mine.summary && mine.summary.pending >= 1 &&
           mine.tags.some(t => /waiting$/.test(t)))
            ? okU2('and what is still waiting is counted apart from what he holds')
            : badU2('the waiting count is missing: ' + JSON.stringify(mine.tags));
          /* THE GRANTED TAG. He asked for one thing and the desk answers with
             whatever it chooses; counting the asks would summarise the one
             number he already knew. */
          (mine.tags.length && /^1 Reserved$/.test(mine.tags[0]))
            ? okU2('and names what was GRANTED, not what was asked for: ' + mine.tags.join(' / '))
            : badU2('the tag chips read ' + JSON.stringify(mine.tags));
          /3 days left/.test(mine.clock) && new RegExp(asked.unit).test(mine.clock)
            ? okU2('with the clock on it \u2014 \u201c' + mine.clock.replace(/\s+/g, ' ').trim() + '\u201d')
            : badU2('the release countdown is wrong: ' + JSON.stringify(mine.clock));

          /* AND THE SAME THING ON THE SCREEN OF ITS OWN. The band at the top
             shows the newest six; the screen shows every one of them, from the
             same builder, so the two cannot say different things. */
          const ownScreen = await dp.evaluate(() => {
            const b = document.getElementById('back');
            if (b) b.click();
            const card = document.querySelector('#myq [data-mine]');
            const caption = card ? (card.querySelector('.ac-m') || {}).textContent.trim() : null;
            const badge = card ? (card.querySelector('.ac-n') || {}).textContent.trim() : null;
            if (card) card.click();
            return {
              caption: caption, badge: badge,
              open: !document.getElementById('mine').hidden,
              head: (document.querySelector('#mine .myq-s .n') || {}).textContent || '',
              rows: document.querySelectorAll('#mine .myq-r').length,
              all: (window.REQS || []).length,
              clock: (document.querySelector('#mine .myq-w') || {}).textContent || ''
            };
          });
          (ownScreen.badge === '1' && /With you/.test(String(ownScreen.caption)))
            ? okU2('the card on screen one carries the count itself \u2014 \u201cMy units 1 \u00b7 ' +
                   ownScreen.caption + '\u201d')
            : badU2('the card does not show the count: ' + JSON.stringify(ownScreen));
          (ownScreen.open && ownScreen.rows === ownScreen.all && ownScreen.rows > 0)
            ? okU2('and the screen behind it lists every one of the ' + ownScreen.rows +
                   ' requests, not the newest few')
            : badU2('the My units screen is not complete: ' + JSON.stringify(ownScreen));
          (/^1\s*unit with you/.test(ownScreen.head.replace(/\s+/g, ' ')) &&
           /days left/.test(ownScreen.clock))
            ? okU2('with the same figures and the same clock the band carries')
            : badU2('the screen and the band disagree: ' + JSON.stringify(ownScreen));
          /* ── FLOOR BY FLOOR, AND THE WARNING BEFORE IT LETS GO ────────────
             Two things Rashid asked for and one he did not have to: the report
             grouped by floor from the ground upwards, and a warning the day
             BEFORE a temporary hold releases itself.

             The clock is moved in the browser rather than in the database. The
             hold in this fixture has three days on it; making it fall tomorrow
             means rewriting a reservation on a live row to photograph a
             warning, and the warning is drawn from what the phone already
             holds. Nothing here is written anywhere. */
          const grouped = await dp.evaluate(() => {
            const floors = [...document.querySelectorAll('#mine .myq-f')].map(el => ({
              name: (el.querySelector('.fn') || {}).textContent.trim(),
              line: (el.querySelector('.fs') || {}).textContent.trim()
            }));
            /* every row must sit under a floor heading, not above the first */
            const kids = [...document.querySelectorAll('#mine .myq > *')];
            const firstRow = kids.findIndex(k => k.classList.contains('myq-r'));
            const firstFloor = kids.findIndex(k => k.classList.contains('myq-f'));
            return { floors: floors, firstRow: firstRow, firstFloor: firstFloor,
                     rows: document.querySelectorAll('#mine .myq-r').length };
          });
          (grouped.floors.length >= 1 && grouped.firstFloor >= 0 &&
           grouped.firstFloor < grouped.firstRow)
            ? okU2('the report is grouped by floor, and every unit sits under one: ' +
                   grouped.floors.map(x => x.name).join(', '))
            : badU2('the floor grouping is wrong: ' + JSON.stringify(grouped));
          /\d+ Reserved/.test(grouped.floors[0].line)
            ? okU2('with the floor\u2019s own count beside it \u2014 \u201c' +
                   grouped.floors[0].name + '  ' + grouped.floors[0].line + '\u201d')
            : badU2('the floor line does not count what is held: ' +
                    JSON.stringify(grouped.floors[0]));

          const warned = await dp.evaluate(() => {
            const held = REQS.filter(r => stateOf(r) === 'held' && r.until)[0];
            if (!held) return null;
            const was = held.until;
            const t = new Date(); t.setDate(t.getDate() + 1);
            held.until = t.toISOString();
            renderMine();
            const out = {
              alert: (document.querySelector('#mine .myq-a') || {}).innerText || '',
              row: (document.querySelector('#mine .myq-r .d b.soon') || {}).textContent || '',
              unit: held.unit
            };
            /* and the card on screen one, which is where he will see it first */
            document.getElementById('mine-back').click();
            const cap = document.querySelector('#myq .ac-m');
            out.card = cap ? cap.textContent.trim() : '';
            out.cardWarns = !!(cap && cap.classList.contains('soon'));
            held.until = was; render();
            return out;
          });
          warned
            ? ((/releases? (itself|themselves)/i.test(warned.alert) &&
                new RegExp(warned.unit).test(warned.alert) &&
                /tomorrow/.test(warned.alert))
                ? okU2('a hold that goes tomorrow is called out by name the day ' +
                       'before \u2014 \u201c' + warned.alert.replace(/\s+/g, ' ').trim() + '\u201d')
                : badU2('the day-before warning is wrong: ' + JSON.stringify(warned.alert)))
            : okU2('no dated hold in this fixture to age \u2014 nothing to warn about');
          warned && /tomorrow/.test(warned.row)
            ? okU2('and the row itself says the day rather than a number of days')
            : badU2('the row does not name the day: ' + JSON.stringify(warned && warned.row));
          warned && warned.cardWarns && new RegExp(warned.unit).test(warned.card)
            ? okU2('and it reaches the first screen without opening anything \u2014 \u201c' +
                   warned.card + '\u201d')
            : badU2('the card does not carry the warning: ' + JSON.stringify(warned && warned.card));

          await dp.evaluate(() => {
            const c = document.querySelector('#myq [data-mine]'); if (c) c.click();
          });
          await dp.screenshot({ path: path.join(OUT, 'q-my-units.png') });
          await dp.evaluate(() => {
            const b = document.getElementById('mine-back'); if (b) b.click();
          });


          /* Shot from the HOME screen: that is where his own position sits, and
             a picture of the floor grid says nothing about it. */
          await dp.evaluate(() => { const b = document.getElementById('back'); if (b) b.click(); });
          await sleep(400);
          await dp.screenshot({ path: path.join(OUT, 'l-dealer-sees-decision.png') });

          /* ── AND THE HOLD BEING UNDONE REACHES HIM TOO ───────────────
             This is the one that got out. The dealer's row was reading the
             DECISION, which never moves, so a reservation released at the
             desk left “Reserved for you” standing on a phone whose unit was
             back on sale. Undo it the way the desk does — cancel the
             reservation row — and the phone has to catch up on its own.
             Nothing is clicked on the dealer's side but the refresh it
             already runs on a timer. */
          await sql(`UPDATE public.reservations SET status='cancelled', cancelled_at=now()
                      WHERE id = (SELECT reservation_id FROM public.availability_requests
                                   WHERE ref='${asked.ref}');`);
          const undone = await dp.evaluate(async () => {
            await refreshMyReqs();
            await new Promise(r => setTimeout(r, 300));
            /* THE REPORT MOVED. It was six rows at the top of screen one; it
               is a screen of its own behind the card now, so this reads it
               there \u2014 the same builder draws it, and it is the only copy. */
            const c = document.querySelector('#myq [data-mine]');
            if (c) c.click();
            return document.getElementById('mine-body').innerText;
          });
          (/Hold ended/.test(undone) && !/Reserved for you/.test(undone))
            ? okU2('undoing the reservation turns the dealer’s row into “Hold ended”')
            : badU2('the dealer still believes the unit is held: ' +
                    String(undone).replace(/s+/g, ' ').slice(0, 110));
          /* and the decline it is sitting next to is untouched by that */
          /Declined by Management/.test(undone)
            ? okU2('and the declined one still reads as declined')
            : badU2('the decline changed when the other hold was released');

          /* THE COUNTDOWN MUST NOT SURVIVE THE HOLD. A summary that goes on
             saying \u201c1 unit with you \u00b7 3 days left\u201d after the desk has let the
             unit go is the same lie the row used to tell, moved to a bigger
             typeface. */
          const after2 = await dp.evaluate(() => ({
            strip: !!document.querySelector('#mine .myq-s'),
            head: (document.querySelector('#mine .myq-s .n') || {}).textContent || '',
            clock: (document.querySelector('#mine .myq-w') || {}).textContent || '',
            rows: document.querySelectorAll('#mine .myq-r').length
          }));
          /* The strip itself stays while a request is still waiting \u2014 it has
             something true to say. What must not survive is the COUNT and the
             COUNTDOWN, which were about a unit the desk has taken back. */
          (/^0\s*units? with you/.test(after2.head.replace(/\s+/g, ' ')) &&
           after2.clock === '' && after2.rows > 1)
            ? okU2('and his position goes with it \u2014 \u201c' +
                   after2.head.replace(/\s+/g, ' ').trim() + '\u201d and no countdown, ' +
                   'while every row stays on the page')
            : badU2('the summary outlived the hold: ' + JSON.stringify(after2));
          /* The record of the decision is NOT rewritten — only what the
             dealer is told. A decided row that quietly becomes undecided is
             a forged record, and the desk's own history reads from it. */
          const kept = await sql(`SELECT status FROM public.availability_requests
                                   WHERE ref='${asked.ref}';`);
          kept[0].status === 'approved'
            ? okU2('while the row itself still records that it WAS approved')
            : badU2('the decision was rewritten to ' + kept[0].status);
          /* The band is the evidence; a sheet parked over it is a screenshot
             of nothing. */
          await dp.evaluate(() => { closeSheet(); document.getElementById('back').click();
                                    window.scrollTo(0, 0); });
          await sleep(350);
          await dp.screenshot({ path: path.join(OUT, 'l2-hold-ended.png') });
        }

        /* THE CAPS. One pending per unit, asserted by asking twice. */
        const twice = await sql(`
          SELECT (public.submit_availability_request('${T}','${asked.unit}',7,'Someone')->>'error') AS e;`);
        twice[0].e === 'unit_unavailable'
          ? okU2('asking for a unit that is now booked is refused')
          : badU2('a booked unit accepted a request: ' + twice[0].e);

        derrs.length === 0 ? okU2('no page errors on the dealer\u2019s side')
                           : badU2('dealer page errors: ' + derrs.slice(0, 2).join(' | '));

        await ctx.close();
        /* put ZZTEST back */
        await sql(`
          UPDATE public.reservations SET status='cancelled', cancelled_at=now()
           WHERE id IN (SELECT reservation_id FROM public.availability_requests
                         WHERE ref IN ('${asked.ref}','${second}') AND reservation_id IS NOT NULL);
          DELETE FROM public.availability_requests WHERE ref IN ('${asked.ref}','${second}');
          /* AND UNSTAMP THE UNITS. Cancelling the reservation is only half of
             putting it back: the unit still carries the Reserved status the
             desk wrote on it, and the public page reads that, not the
             reservation. Scoped to ZZTEST and to units that are demonstrably
             free again. */
          WITH avail AS (
            SELECT DISTINCT ON (project_id) project_id, id
              FROM public.category_unit_statuses WHERE is_available AND is_active
             ORDER BY project_id, sort_order NULLS LAST, created_at)
          UPDATE public.units u SET status_id = a.id, updated_at = now()
            FROM avail a, public.companies c, public.category_unit_statuses st
           WHERE a.project_id = u.project_id
             AND c.id = u.company_id AND c.company_name ILIKE '%zztest%'
             AND st.id = u.status_id AND st.is_available = false
             AND public._map_unit_state(u.id) = 'available';
          SELECT public.revoke_availability_link('zz-rt-dir','${T}');
          DELETE FROM public.sales_sessions WHERE session_token='zz-rt-dir';`);
        okU2('ZZTEST put back: requests deleted, reservation cancelled, link revoked');
      }
    }

    /* ══ THE ROOM BEHIND THE PASSWORD ═══════════════════════════════════
       A second room on the same link, for directors: who is holding what,
       what it is worth, and what that adds up to. It is the first thing on
       this page that is gated by a secret rather than by a token, so the lock
       is tested before the room is.

       All of it on ZZTEST, on links made and revoked here. The password on
       Awami's project is Rashid's and is never touched. ════════════════ */
    step('The directors\u2019 room \u2014 the lock, then the room');
    {
      const zr = await sql(`SELECT p.id, p.company_id FROM public.projects p
                              JOIN public.companies c ON c.id = p.company_id
                             WHERE c.company_name ILIKE '%zztest%'
                               AND EXISTS (SELECT 1 FROM public.units u WHERE u.project_id = p.id)
                               AND EXISTS (SELECT 1 FROM public.sales_users su
                                            WHERE su.company_id = p.company_id AND su.role='director')
                               /* AND A PROJECT THAT STILL HAS ITS STATUS LIST. One ZZTEST
                                  project had its statuses deleted long ago and its units
                                  point at rows that are not there; planting a hold on it
                                  means stamping a unit with nothing. */
                               AND EXISTS (SELECT 1 FROM public.category_unit_statuses cs
                                            WHERE cs.project_id = p.id AND NOT cs.is_available
                                              AND cs.is_active)
                             ORDER BY p.id LIMIT 1;`);
      if (!zr.length) { bad('no ZZTEST project with a director to test the report on'); }
      else {
        const RP = zr[0].id, RC = zr[0].company_id;
        const PW = 'zz-report-' + Math.random().toString(36).slice(2, 10);
        await sql(`DELETE FROM public.sales_sessions WHERE session_token IN ('zz-rep-dir','zz-rep-rep');
          INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
          SELECT s.company_id, s.id, NULL, 'zz-rep-dir', now()+interval '10 minutes'
            FROM public.sales_users s WHERE s.company_id='${RC}' AND s.role='director' LIMIT 1;
          INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
          SELECT s.company_id, s.id, NULL, 'zz-rep-rep', now()+interval '10 minutes'
            FROM public.sales_users s WHERE s.company_id='${RC}' AND s.role <> 'director' LIMIT 1;`);

        /* ── the lock ─────────────────────────────────────────────────── */
        const shortPw = await sql(`SELECT (public.set_availability_report_password(
                                     'zz-rep-dir','${RP}','short')->>'error') AS e;`);
        shortPw[0].e === 'too_short'
          ? ok('a password under twelve characters is refused \u2014 this is a public URL')
          : bad('a short password was accepted: ' + JSON.stringify(shortPw[0]));
        const notDir = await sql(`SELECT (public.set_availability_report_password(
                                    'zz-rep-rep','${RP}','${PW}')->>'error') AS e;`);
        (notDir[0].e === 'not_allowed' || notDir[0].e === 'session_expired')
          ? ok('and only a director may set it (' + notDir[0].e + ')')
          : bad('a non-director set the report password: ' + JSON.stringify(notDir[0]));

        const mk = await sql(`SELECT public.create_availability_link('zz-rep-dir','${RP}','report shot') AS r;`);
        const RT = mk[0].r && mk[0].r.token;
        if (!RT) { bad('no link to test the report with: ' + JSON.stringify(mk[0].r)); }
        else {
          const before = await sql(`SELECT (public.get_availability_report('${RT}','${PW}')->>'error') AS e;`);
          before[0].e === 'no'
            ? ok('with no password set, the room does not exist \u2014 not even to the right word')
            : bad('the report opened before a password was set: ' + JSON.stringify(before[0]));

          const setOk = await sql(`SELECT (public.set_availability_report_password(
                                     'zz-rep-dir','${RP}','${PW}')->>'success') AS s;`);
          setOk[0].s === 'true' ? ok('the director sets one')
                                : bad('the director could not set it: ' + JSON.stringify(setOk[0]));
          const stored = await sql(`SELECT report_password_hash h FROM public.projects WHERE id='${RP}';`);
          (stored[0].h && stored[0].h.indexOf(PW) < 0 && /^[0-9a-f]{64}$/.test(stored[0].h))
            ? ok('and it is stored as a sha256, salted with the project \u2014 not as the word')
            : bad('the password is stored badly: ' + JSON.stringify(stored[0]));

          const wrong = await sql(`SELECT (public.get_availability_report('${RT}','not-the-password')->>'error') AS e;`);
          wrong[0].e === 'no' ? ok('a wrong password says only \u201cno\u201d')
                              : bad('a wrong password said: ' + JSON.stringify(wrong[0]));

          /* ── ONE HOLD, PLANTED ─────────────────────────────────────────
             Every ZZTEST unit is free, so a report of nothing held would let
             every page behind the first screen pass on an empty list. One
             unit is stamped and given a reservation in a known name, and put
             back at the end. The unit is stamped BEFORE the reservation is
             written: the trigger on units cancels live reservations when the
             status changes, so the other order silently undoes itself. */
          const HOLDER = 'ZZ Holder';
          const planted = await sql(`
            WITH u AS (SELECT u.id, u.unit_no FROM public.units u
                         JOIN public.category_unit_statuses st ON st.id = u.status_id
                        WHERE u.project_id='${RP}' AND st.is_available
                        ORDER BY u.unit_no LIMIT 1),
                 s AS (SELECT id FROM public.category_unit_statuses
                        WHERE project_id='${RP}' AND NOT is_available AND is_active
                          ORDER BY sort_order LIMIT 1)
            UPDATE public.units SET status_id = (SELECT id FROM s)
             WHERE id = (SELECT id FROM u)
            RETURNING id::text AS uid, unit_no,
                      (SELECT COALESCE(NULLIF(TRIM(public_label),''), status_name)
                         FROM public.category_unit_statuses WHERE id = (SELECT id FROM s)) AS kind;`);
          const PU = planted.length ? planted[0] : null;
          if (PU) {
            await sql(`INSERT INTO public.reservations
              (company_id, project_id, unit_id, reserved_by, client_name, status,
               requested_by_name, expiry_date, created_at)
              SELECT '${RC}','${RP}','${PU.uid}',
                     (SELECT id FROM public.sales_users WHERE company_id='${RC}'
                       AND role='director' LIMIT 1),
                     'ZZ Client','active','${HOLDER}', now() + interval '3 days', now();`);
          }
          PU ? ok('one ZZTEST unit planted as held (' + PU.unit_no + ') so the pages behind ' +
                  'the first screen have something to show')
             : bad('could not plant a hold on ZZTEST — the drill-downs would prove nothing');

          /* ── the room, through the real page, on the real link ──────── */
          const rc = await browser.createBrowserContext();
          const rpg = await rc.newPage();
          const rerr = [];
          rpg.on('pageerror', e => rerr.push(String(e.message || e)));
          await rpg.setViewport({ width: 380, height: 900, deviceScaleFactor: 2 });
          await rpg.goto(BASE + '/a/' + RT, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await rpg.waitForFunction(
            () => !!document.getElementById('dir-open') &&
                  !document.getElementById('app').hidden &&
                  document.getElementById('dir-open').getBoundingClientRect().width > 0,
            { timeout: 30000 });
          /* IT MUST BE FINDABLE. It was set in the dealer's own grey and Rashid
             could not spot it on his own page, so what is asserted now is that
             it says whose door it is and is drawn in a colour of its own —
             red, which nothing else on this page uses. */
          const door = await rpg.evaluate(() => {
            const b = document.getElementById('dir-open');
            const r = b.getBoundingClientRect();
            const c = getComputedStyle(b);
            const rgb = (c.color.match(/[0-9]+/g) || []).map(Number);
            return { text: b.textContent.trim(), w: Math.round(r.width),
                     h: Math.round(r.height), red: rgb[0] > 120 && rgb[0] > rgb[1] + 80,
                     ring: c.borderTopWidth !== '0px', ink: c.color,
                     units: document.querySelectorAll('#units button').length };
          });
          (/director/i.test(door.text) && door.red && door.ring &&
           door.w > 60 && door.w < 170 && door.units === 0)
            ? ok('the door says “' + door.text + '”, is drawn in its own red (' +
                 door.ink + ') and is still ' + door.w + 'px on screen one, ' +
                 'where no unit is mounted')
            : bad('the door is wrong: ' + JSON.stringify(door));

          await rpg.evaluate(() => document.getElementById('dir-open').click());
          await sleep(150);
          await rpg.evaluate(() => {
            document.getElementById('dir-pw').value = 'wrong-wrong-wrong';
            document.getElementById('dir-go').click();
          });
          /* WAIT FOR THE PAGE TO HAVE ANSWERED, NOT FOR A GUESSED NUMBER OF
             MILLISECONDS. This slept 1400ms. Measured on an idle machine the
             page's first get_availability_report call takes ~1280ms (a second
             one ~510ms), so under a suite that is already working the database
             this landed mid-call: the field was still full, nothing was shown
             yet, and — the part that did the real damage — repOpen had set
             dir-go.disabled while it waited, so the NEXT click, the one with
             the right password, was swallowed. The room never opened and every
             check behind the door failed with it: nine failures out of one
             guessed number. The page re-enables the button when the call is
             done, so that is what is waited on. If it never answers, this
             times out and the assertion below still fails, printing the same
             evidence it always would. */
          await rpg.waitForFunction(
            () => !document.getElementById('dir-go').disabled,
            { timeout: 25000 }).catch(() => {});
          const refused = await rpg.evaluate(() => ({
            err: (document.getElementById('dir-err').textContent || '').trim(),
            shown: !document.getElementById('dir-err').hidden,
            body: (document.getElementById('rep-body').innerHTML || '').length,
            kept: document.getElementById('dir-pw').value
          }));
          (refused.shown && refused.body === 0 && refused.kept === '')
            ? ok('a wrong password on the page says so, shows nothing, and clears the field')
            : bad('the page let a wrong password through: ' + JSON.stringify(refused));

          /* and do not knock on a door the page is still holding shut */
          await rpg.waitForFunction(
            () => !document.getElementById('dir-go').disabled,
            { timeout: 25000 }).catch(() => {});
          await rpg.evaluate(pw => {
            document.getElementById('dir-pw').value = pw;
            document.getElementById('dir-go').click();
          }, PW);
          await rpg.waitForFunction(
            () => (document.getElementById('rep-body').innerHTML || '').length > 200,
            { timeout: 20000 }).catch(() => {});
          /* THE FIRST SCREEN IS SHORT ON PURPOSE. Rashid read the first cut
             and said it confused him: "ziada reports confuse karti hain, mai
             professional ho k confuse ho gaya hun to mere directors to non
             professional hain". So what is asserted is that it is four blocks
             of DOORS and not a wall of tables \u2014 a fifth table creeping back
             onto it fails here. */
          const room = await rpg.evaluate(() => {
            const b = document.getElementById('rep-body');
            const t = (b.innerText || '');
            return { len: (b.innerHTML || '').length,
                     heads: [...b.querySelectorAll('h2')].map(h => h.textContent.trim()),
                     tables: b.querySelectorAll('table').length,
                     doors: b.querySelectorAll('[data-go]').length,
                     pdf: !!b.querySelector('#rep-pdf'),
                     dis: (b.querySelector('.dis') || { innerText: '' }).innerText,
                     gate: !document.getElementById('rep-gate').hidden,
                     unitsMounted: document.querySelectorAll('#units button').length,
                     hasPkr: /PKR/.test(t) };
          });
          (room.len > 200 && !room.gate && room.tables === 0 && room.hasPkr &&
           room.heads.length === 4 && room.doors >= 3 && room.pdf && room.unitsMounted === 0)
            ? ok('and the right one opens it \u2014 four blocks, ' + room.doors +
                 ' doors, no table on the way in: ' + room.heads.join(' / '))
            : bad('the room did not open properly: ' + JSON.stringify(room));
          /* THE DISCLAIMER IS NOT DECORATION. It is the reason this page can be
             forwarded at all, so its load-bearing sentences are asserted by
             their meaning rather than by their presence. */
          (/not a confirmation/i.test(room.dis) && /not a record of money/i.test(room.dis) &&
           /does not mean paid/i.test(room.dis) && /no guarantee/i.test(room.dis))
            ? ok('and it carries the disclaimer: not a confirmation, not money, ' +
                 'sold is not paid, a hold is no guarantee')
            : bad('the disclaimer is missing or weak: ' + JSON.stringify(room.dis.slice(0, 120)));
          await rpg.screenshot({ path: path.join(OUT, 'g-directors-room.png'), fullPage: true });

          /* ── AND EVERY DOOR OPENS ONTO THE UNITS THEMSELVES ──────────── */
          const kind = await rpg.evaluate(k => {
            const r = [...document.querySelectorAll('#rep-body [data-go="kind"]')]
              .filter(x => x.getAttribute('data-key') === k)[0];
            if (!r) return { none: true };
            r.click();
            const b = document.getElementById('rep-body');
            return { none: false, rows: b.querySelectorAll('table.ut tr').length,
                     text: (b.innerText || ''),
                     pdf: !!b.querySelector('#rep-pdf'),
                     dis: !!b.querySelector('.dis') };
          }, PU && PU.kind);
          (!kind.none && kind.rows >= 3 && kind.pdf && kind.dis &&
           /zz holder/i.test(kind.text))
            ? ok('tapping a kind opens every unit of that kind, with the name on each')
            : bad('the kind page is wrong: ' + JSON.stringify({ kind: PU && PU.kind,
                  n: kind.none, rows: kind.rows, pdf: kind.pdf, dis: kind.dis,
                  saw: String(kind.text || '').replace(/s+/g, ' ').slice(0, 140) }));

          const backIn = await rpg.evaluate(() => {
            document.getElementById('rep-back').click();
            return { heads: [...document.querySelectorAll('#rep-body h2')].map(h => h.textContent.trim()),
                     stillIn: !document.getElementById('rep').hidden };
          });
          (backIn.stillIn && backIn.heads.length === 4)
            ? ok('and Back goes one step into the room, not out of it')
            : bad('Back left the room: ' + JSON.stringify(backIn));

          const person = await rpg.evaluate(() => {
            const r = [...document.querySelectorAll('#rep-body [data-go="person"]')]
              .filter(x => x.getAttribute('data-key') === 'ZZ Holder')[0];
            if (!r) return { none: true };
            r.click();
            const b = document.getElementById('rep-body');
            return { none: false, text: (b.innerText || ''),
                     rows: b.querySelectorAll('table.ut tr').length,
                     pdf: !!b.querySelector('#rep-pdf') };
          });
          (!person.none && person.rows >= 3 && person.pdf &&
           /zz holder/i.test(person.text) && /Ends|no end date/i.test(person.text))
            ? ok('and tapping a name opens that person\u2019s own units, with what ends when')
            : bad('the person page is wrong: ' + JSON.stringify({ n: person.none,
                  rows: person.rows, pdf: person.pdf,
                  saw: String(person.text || '').replace(/s+/g, ' ').slice(0, 140) }));
          await rpg.screenshot({ path: path.join(OUT, 'h-directors-person.png'), fullPage: true });

          /* ── AND THE WORTH REPORT, FLOOR BY FLOOR ────────────────────── */
          const worth = await rpg.evaluate(() => {
            document.getElementById('rep-back').click();
            const r = document.querySelector('#rep-body [data-go="floors"]');
            if (!r) return { none: true };
            r.click();
            const b = document.getElementById('rep-body');
            /* A CARD PER FLOOR, and every card says all six things. A floor
               that quietly lost one of them would still look like a report. */
            const cards = [...b.querySelectorAll('.wf:not(.wf-t)')];
            return { none: false,
                     floors: cards.length,
                     whole: cards.every(c => c.querySelector('.wf-n') && c.querySelector('.wf-v') &&
                                             c.querySelectorAll('.g-v').length === 2),
                     total: !!b.querySelector('.wf-t'),
                     pdf: !!b.querySelector('#rep-pdf'),
                     text: (b.innerText || '') };
          });
          (!worth.none && worth.total && worth.pdf && worth.floors >= 1 && worth.whole &&
           /On the shelf/i.test(worth.text) && /Taken/i.test(worth.text))
            ? ok('and the worth report reads floor by floor — ' + worth.floors +
                 ' floors, each with its worth, what is on the shelf and what is taken, ' +
                 'and the whole building underneath')
            : bad('the worth report is wrong: ' + JSON.stringify({ n: worth.none,
                  floors: worth.floors, whole: worth.whole, total: worth.total, pdf: worth.pdf }));
          await rpg.screenshot({ path: path.join(OUT, 'i-directors-worth.png'), fullPage: true });

          /* THE PRINTED SHEET IS THE POINT OF THE PDF BUTTON. Print emulation
             is the only way to see what the paper gets: the page furniture
             gone, the letterhead there, the disclaimer still on it. */
          await rpg.emulateMediaType('print');
          const paper = await rpg.evaluate(() => {
            const vis = el => el && getComputedStyle(el).display !== 'none';
            return { head: vis(document.querySelector('.pr-h')),
                     tools: vis(document.querySelector('.rp-x')),
                     nav: vis(document.querySelector('#rep .ft')),
                     home: vis(document.getElementById('home')),
                     dis: vis(document.querySelector('.dis')) };
          });
          (paper.head && paper.dis && !paper.tools && !paper.nav && !paper.home)
            ? ok('and on paper it is a document: letterhead on, buttons and ' +
                 'navigation off, disclaimer still there')
            : bad('the printed sheet is wrong: ' + JSON.stringify(paper));
          await rpg.emulateMediaType(null);

          const wrote = await rpg.evaluate(() => Object.keys(localStorage)
            .filter(k => /pw|pass|report/i.test(k) || /pw|pass/i.test(String(localStorage[k]))));
          wrote.length === 0
            ? ok('and the password is not written to the phone \u2014 the room shuts with the tab')
            : bad('the page stored something about the password: ' + wrote.join(', '));
          rerr.length === 0 ? ok('no page errors in the room')
                            : bad('the room threw: ' + rerr.slice(0, 2).join(' | '));
          await rc.close();

          /* ── and the lock holds while it is being picked ─────────────── */
          const mk2 = await sql(`SELECT public.create_availability_link('zz-rep-dir','${RP}','report throttle') AS r;`);
          const RT2 = mk2[0].r && mk2[0].r.token;
          if (!RT2) { bad('no second link to test the throttle with'); }
          else {
            let last = '';
            for (let i = 0; i < 10; i++) {
              const t = await sql(`SELECT (public.get_availability_report('${RT2}','nope-${i}')->>'error') AS e;`);
              last = t[0].e;
            }
            const shut = await sql(`SELECT (public.get_availability_report('${RT2}','${PW}')->>'error') AS e;`);
            shut[0].e === 'too_many'
              ? ok('after ten wrong tries the door stops answering \u2014 to the right password too')
              : bad('the throttle did not hold: ten wrong tries then ' + JSON.stringify(shut[0]));
            /* A FRESH LINK, WHICH ROTATES THE THROTTLED ONE AWAY. Minting a
               link revokes the project's previous one, so the old link cannot
               be used to prove this \u2014 it is dead for a different reason. The
               new one proves what matters: the hour is spent on the LINK that
               was picked at, not on the project. */
            const mk3 = await sql(`SELECT public.create_availability_link('zz-rep-dir','${RP}','report fresh') AS r;`);
            const RT3 = mk3[0].r && mk3[0].r.token;
            const fresh = await sql(`SELECT (public.get_availability_report('${RT3}','${PW}')->>'success') AS s;`);
            fresh[0].s === 'true'
              ? ok('and the hour is spent on the LINK, not the project \u2014 a fresh link opens at once')
              : bad('picking one link locked the whole project out');

            const revoked = await sql(`SELECT public.revoke_availability_link('zz-rep-dir','${RT3}');
              SELECT (public.get_availability_report('${RT3}','${PW}')->>'error') AS e;`);
            revoked[0].e === 'no'
              ? ok('and revoking a link shuts the room behind it')
              : bad('a revoked link still opened the report: ' + JSON.stringify(revoked[0]));
          }
        }
        /* put ZZTEST back exactly as it was */
        await sql(`
          UPDATE public.reservations SET status='cancelled', cancelled_at=now()
           WHERE project_id='${RP}' AND requested_by_name='ZZ Holder' AND status='active';
          UPDATE public.units u SET status_id = (SELECT id FROM public.category_unit_statuses
                                                  WHERE project_id='${RP}' AND is_available
                                                  ORDER BY sort_order LIMIT 1)
           WHERE u.project_id='${RP}'
             AND EXISTS (SELECT 1 FROM public.reservations r
                          WHERE r.unit_id=u.id AND r.requested_by_name='ZZ Holder');
          DELETE FROM public.reservations
           WHERE project_id='${RP}' AND requested_by_name='ZZ Holder';
          /* A SAFETY NET, not a second thought: a run that dies between the
             stamp and the reservation leaves a unit with no status at all,
             and the next run then reads it as held by nobody. */
          UPDATE public.units u SET status_id = (SELECT id FROM public.category_unit_statuses
                                                  WHERE project_id='${RP}' AND is_available
                                                  ORDER BY sort_order LIMIT 1)
           WHERE u.project_id='${RP}' AND u.status_id IS NULL;`);
        await sql(`SELECT public.set_availability_report_password('zz-rep-dir','${RP}',NULL);
          DELETE FROM public.availability_report_attempts a USING public.availability_links l
           WHERE l.id = a.link_id AND l.project_id = '${RP}';
          DELETE FROM public.sales_sessions WHERE session_token IN ('zz-rep-dir','zz-rep-rep');`);
        ok('ZZTEST put back: password cleared, attempts deleted, links revoked');
      }
    }

    /* ── nothing was created on Awami ───────────────────────────────────── */
    /* Rashid creates the Awami link himself and sees the token once, so the
       claim is not "none exists" — it is that this run made no new one and
       revoked none. Counted at the start, compared at the end. */
    step('Awami is untouched');
    const linksAfter = await sql(`SELECT count(*)::int n, count(*) FILTER (WHERE revoked)::int r
                                    FROM public.availability_links
                                   WHERE project_id = '${AWAMI_PR}';`);
    (linksAfter[0].n === AWAMI_LINKS_BEFORE.n && linksAfter[0].r === AWAMI_LINKS_BEFORE.r)
      ? ok('Awami still has exactly the ' + linksAfter[0].n + ' link(s) it started with \u2014 ' +
           'this run created none and revoked none')
      : bad('Awami links changed: ' + JSON.stringify({ before: AWAMI_LINKS_BEFORE, after: linksAfter[0] }));

    errs.length === 0 ? ok('no console errors') : bad('console: ' + errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (FAILED ? '\u274C SOMETHING IS WRONG' : '\u2705 ALL CHECKS OK') + '  \u2192 ' + OUT);
  process.exit(FAILED ? 1 : 0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

/* Load the page through the REAL route with a REAL token, so the one thing a
   captured payload cannot prove — that the page and the function actually talk
   to each other — is proven on the tenant it is safe to prove it on. Also
   reports how much of the building reached the document, which is what the
   inverted "all units drawn" assertion needs. */
async function visitToken(browser, token) {
  const ctx = await browser.createBrowserContext();   // empty: no storage, no session
  const p = await ctx.newPage();
  const wire = [], pending = [];
  p.on('response', r => {
    if (!/get_public_availability/.test(r.url())) return;
    pending.push(r.text().then(t => wire.push(t)).catch(() => {}));
  });
  try {
    await p.setViewport({ width: 380, height: 780 });
    await p.goto(BASE + '/a/' + token, { waitUntil: 'domcontentloaded', timeout: 30000 });
    /* Rendered, or dead. Waiting on the network going quiet is not the same
       question and answered too early. */
    await p.waitForFunction(() =>
      document.querySelectorAll('#floors button').length > 0 ||
      /not available/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    await Promise.all(pending);
    await sleep(200);
    const out = await p.evaluate(() => {
      const home = document.querySelectorAll('#units button').length;
      const total = (window.P && window.P.floors)
        ? window.P.floors.reduce((n, f) => n + f.units.length, 0) : 0;
      const chip = document.querySelector('#floors button');
      if (chip) chip.click();
      return { home, total, after: document.querySelectorAll('#units button').length,
               text: document.body.innerText };
    });
    const code = fs.readFileSync(path.join(ROOT, 'availability.html'), 'utf8');
    return { wire: wire.join('\n'), code,
             unitsOnHome: out.home, unitsAfterFloor: out.after, totalUnits: out.total,
             text: out.text, url: p.url() };
  } finally { await ctx.close(); }
}
