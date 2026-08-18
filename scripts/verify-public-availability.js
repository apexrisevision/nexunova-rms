/**
 * The public availability link — opened the way a stranger opens it.
 *
 *   node scripts/verify-public-availability.js
 *
 * This link can be forwarded anywhere: a dealer group, a client, a WhatsApp
 * status. So the thing under test is not "does the page look right" but "what
 * did the server actually put on the wire". Every assertion about privacy reads
 * the RESPONSE BODY of get_public_availability, because a page that merely omits
 * a buyer's name proves nothing — a payload that never contained one proves
 * everything.
 *
 * The browser context is deliberately empty: a fresh incognito-style context,
 * no localStorage, no session token, no portal code on the page. If the tower
 * renders, it rendered for someone with no account at all.
 *
 * Two more things are measured here because they are decisions, not details:
 *   · the wire carries only 'available' and 'taken'. "reserved" and "sold" are
 *     collapsed server-side, so a link holder cannot count today's holds.
 *   · the token is stored ONLY as sha256. The table is read back to prove the
 *     raw token is nowhere in it — a database dump yields no working link.
 *
 * ZZTEST only. The link is created and revoked here through the same director
 * RPCs a human would use, and the fixture is cleaned up at the end.
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..'), PORT = 4221;
const SHOTS = path.join(ROOT, 'migration_work', 'public_link');
const ZZ = 'a2915ce7-c01c-463b-ba50-b144b2240337';
const ZZ_PROJECT = '708605fc-33e9-4538-8b7c-0513b2d2e8b9';

/* what must never appear, taken from the real ZZTEST sale on UG-01 */
const SECRETS = { buyer: 'ZZ Buyer', phone: '03001234567', sale_no: 'ZZ-SALE-001' };

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
      // mirror the vercel rewrite: /a/<token> serves the same file
      let url = decodeURIComponent(q.url.split('?')[0]);
      if (/^\/a\/[A-Za-z0-9_-]+$/.test(url)) url = '/availability.html';
      const p = path.join(ROOT, url);
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });
}
const until = (page, fn, ms = 15000) => page.waitForFunction(fn, { timeout: ms, polling: 200 });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const co = await sql(`SELECT company_name FROM companies WHERE id='${ZZ}'`);
  assert(/ZZTEST/i.test(co[0].company_name), 'measuring on ' + co[0].company_name);

  // ── a director mints the link, exactly as a human would ───────────────────
  stepH('A ZZTEST director creates the link');
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-pub-dir';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-pub-dir', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Director';`);
  const made = await sql(`SELECT public.create_availability_link('zz-pub-dir','${ZZ_PROJECT}','ZZ verify') AS r`);
  const TOKEN = made[0].r.token;
  assert(made[0].r.success && /^[0-9a-f]{32}$/.test(TOKEN || ''),
    'token is 128 random bits: ' + String(TOKEN).slice(0, 8) + '…');

  // the raw token must exist NOWHERE in the table
  const stored = await sql(`SELECT token_hash, label FROM public.availability_links
                              WHERE token_hash = public._availability_token_hash('${TOKEN}')`);
  assert(stored.length === 1, 'the link is stored');
  assert(stored[0].token_hash !== TOKEN && /^[0-9a-f]{64}$/.test(stored[0].token_hash),
    'stored as a sha256 hash, not the link: ' + stored[0].token_hash.slice(0, 12) + '…');
  const anyRaw = await sql(`SELECT count(*) AS n FROM public.availability_links
                              WHERE token_hash LIKE '%${TOKEN}%'`);
  assert(Number(anyRaw[0].n) === 0, 'a dump of the table yields no working link');
  const cols = await sql(`SELECT column_name FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='availability_links'`);
  assert(!cols.some(c => c.column_name === 'token'), 'the plaintext token column is gone');

  // what a director can see: no token, no hash — links are re-issued, not recovered
  const listed = await sql(`SELECT public.list_availability_links('zz-pub-dir') AS r`);
  const one = listed[0].r.links[0];
  assert(!JSON.stringify(listed[0].r).includes(TOKEN), 'the director list never echoes the link back');
  assert(one && one.project === 'ZZ Map Tower' && one.label === 'ZZ verify',
    'but it does show which links exist: "' + one.label + '" on ' + one.project);

  // a rep must NOT be able to mint one
  await sql(`DELETE FROM public.sales_sessions WHERE session_token='zz-pub-rep';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-pub-rep', now()+interval '30 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';`);
  const repTry = await sql(`SELECT public.create_availability_link('zz-pub-rep','${ZZ_PROJECT}','nope') AS r`);
  assert(repTry[0].r.success === false && repTry[0].r.error === 'not_allowed',
    'a rep cannot mint a public link (' + repTry[0].r.error + ')');

  // ── the table itself is closed to the public ──────────────────────────────
  stepH('The token table is not readable by anon');
  const acl = await sql(`SELECT has_table_privilege('anon','public.availability_links','SELECT') AS s,
                                relrowsecurity AS rls
                           FROM pg_class WHERE oid='public.availability_links'::regclass`);
  assert(acl[0].s === false, 'anon has no SELECT on availability_links');
  assert(acl[0].rls === true, 'and RLS is on (deny-all, no policies)');

  /* The management RPCs ARE callable by anon, and that is not a hole: the whole
     sales portal is an unauthenticated supabase client that identifies its user
     with a sales_sessions token passed as an argument, so every portal RPC runs
     as anon. The control is the session + role check inside each function, not
     the GRANT — and that is what has to be measured. An earlier version of this
     harness asserted grant-level exclusivity instead, which was both wrong and
     the reason the Share-link screen 401'd for real directors. */
  const guarded = await sql(`
    SELECT (public.list_availability_links('no-such-session')->>'error')                 AS l,
           (public.create_availability_link('no-such-session', '${ZZ_PROJECT}')->>'error') AS c,
           (public.revoke_availability_link('no-such-session', 'x')->>'error')           AS r`);
  assert(guarded[0].l === 'session_expired' && guarded[0].c === 'session_expired' &&
         guarded[0].r === 'session_expired',
    'the three management RPCs refuse a caller with no session');
  const repGuard = await sql(`
    DELETE FROM public.sales_sessions WHERE session_token='zz-pub-rep2';
    INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
    SELECT company_id, id, project_id, 'zz-pub-rep2', now()+interval '5 minutes'
      FROM public.sales_users WHERE company_id='${ZZ}' AND full_name='ZZ Rep One';
    SELECT (public.list_availability_links('zz-pub-rep2')->>'error') AS l,
           (public.create_availability_link('zz-pub-rep2', '${ZZ_PROJECT}')->>'error') AS c`);
  assert(repGuard[0].l === 'not_allowed' && repGuard[0].c === 'not_allowed',
    'and refuse a rep who does have a session');
  const pubOk = await sql(`SELECT (public.get_public_availability('nope')->>'error') AS e`);
  assert(pubOk[0].e === 'not_available', 'while the public one answers anyone, safely');

  // ── open it in a browser with NOTHING in it ───────────────────────────────
  stepH('A stranger opens /a/<token> — no login, no session, empty browser');
  const server = await serve();
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
               'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });

  async function visit(token) {
    // a fresh context = its own cookie jar and storage; nothing carries over
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
    const errs = [], wire = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('requestfailed', q => errs.push('requestfailed ' + q.url()));
    page.on('response', async r => {
      if (r.status() >= 400) errs.push(r.status() + ' ' + r.url());
      if (!/rpc\/get_public_availability/.test(r.url())) return;
      try { wire.push(await r.text()); } catch (e) { /* body gone */ }
    });
    await page.goto(`http://127.0.0.1:${PORT}/a/${token}`, { waitUntil: 'networkidle0' });
    return { ctx, page, errs, wire };
  }

  const V = await visit(TOKEN);
  await until(V.page, () => document.querySelectorAll('.win').length > 0);
  await sleep(2200);
  /* A fullPage capture resizes the viewport, which fires the page's own resize
     handler and repaints the tower — so the first shot catches the power-on
     sweep mid-climb. Take it twice and keep the settled one. */
  const shotFull = async n => {
    await V.page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
    await sleep(1600);
    await V.page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
    console.log('  📸 ' + n);
  };
  await shotFull('01-public-tower');



  /* The top of the page: one filter, and a visible difference between what you
     read and what you press. All of it measured — a chip that "looks like a
     button" has to actually have a border and a background, and the type filter
     has to exist exactly once. */
  const top = async where => {
    const t = await V.page.evaluate(() => {
      const types = [...document.querySelectorAll('#filters .pill')];
      const cs = types.length ? getComputedStyle(types[0]) : null;
      const card = document.querySelector('.chip');
      const cards = getComputedStyle(card);
      const secTop = document.querySelector('.hunt').getBoundingClientRect().top;
      const cardBottom = Math.max(...[...document.querySelectorAll('.chip')]
        .map(c => c.getBoundingClientRect().bottom));
      return {
        // how many separate places offer a type filter
        typeControls: document.querySelectorAll('[data-t]').length,
        typeGroups: new Set([...document.querySelectorAll('[data-t]')]
          .map(e => e.closest('.filters, .hunt, .brk, .chips') || document.body)).size,
        labels: [...document.querySelectorAll('.f-lb')].map(e => e.textContent.trim()),
        head: (document.querySelector('.hunt-h b') || {}).textContent || '',
        chipText: types.map(p => p.textContent.replace(/\s+/g, ' ').trim()),
        // a button must look like one
        border: parseFloat(cs && cs.borderTopWidth), radius: parseFloat(cs && cs.borderTopLeftRadius),
        bg: cs && cs.backgroundColor, h: Math.round(types[0].getBoundingClientRect().height),
        cursor: cs && cs.cursor,
        // a summary card must not
        cardCursor: cards.cursor, cardIsButton: card.tagName === 'BUTTON',
        cardsClickable: [...document.querySelectorAll('.chips button, .chips [onclick]')].length,
        gap: Math.round(secTop - cardBottom),
        resultLine: (document.getElementById('fout') || {}).innerText || ''
      };
    });
    assert(t.typeGroups === 1,
      'the type filter lives in exactly one place on ' + where + ' (' + t.typeGroups + ')');
    assert(t.head === 'Filter', 'the section is headed "' + t.head + '"');
    assert(t.labels.join('/') === 'Type/Budget', 'with two labelled rows: ' + t.labels.join(', '));
    assert(t.border >= 1 && t.radius >= 6 && t.bg !== 'rgba(0, 0, 0, 0)' && t.h >= 34,
      'a type chip is shaped like a button on ' + where +
      ' (' + t.border + 'px border, r' + t.radius + ', ' + t.h + 'px tall, filled)');
    // ZZTEST has one type; KBH has five. So check the SHAPE, not a fixed list.
    const typeChips = t.chipText.filter(c => c !== 'Only available');
    assert(/^All \d+$/.test(typeChips[0]) && typeChips.every(c => /\s\d+$/.test(c)),
      'every type chip carries its count: ' + typeChips.join(' · '));
    assert(!t.cardIsButton && t.cardCursor === 'default' && t.cardsClickable === 0,
      'the summary cards are not pressable on ' + where);
    assert(t.gap >= 10, 'and a clear gap separates them from the filter (' + t.gap + 'px)');
    assert(/Showing/.test(t.resultLine), 'the filter states its own result: "' +
      t.resultLine.replace(/\s+/g, ' ').trim().slice(0, 70) + '"');
  };

  /* SOLID. The panes used to twinkle; the owner had it removed because on a
     phone it reads as restlessness. Proving "no animation" by reading the CSS
     would prove nothing, so: photograph every pane's colour, filter and opacity
     at two instants and show that not one of them moved. */
  const solid = async where => {
    const snap = () => V.page.evaluate(() => {
      const m = {};
      document.querySelectorAll('.win').forEach(w => {
        const s = getComputedStyle(w);
        m[w.dataset.u] = s.backgroundColor + '|' + s.filter + '|' + s.opacity;
      });
      return m;
    });
    /* The one-time power-on sweep stays by design, so wait for it to be OVER
       before judging whether anything is still moving — and ask the browser
       directly rather than watching opacity creep to 1, which reads as finished
       a frame early. */
    await V.page.waitForFunction(() => !document.getAnimations().some(a =>
      a.playState === 'running' && a.effect && a.effect.target &&
      a.effect.target.classList && a.effect.target.classList.contains('win')),
      { timeout: 12000, polling: 150 });
    const a = await snap();
    await sleep(1600);
    const b = await snap();
    const moved = Object.keys(a).filter(k => a[k] !== b[k]);
    assert(moved.length === 0,
      'not one pane changed in 1.6s on ' + where + ' — the tower is still (' + moved.length + ' moved)');
    const hues = await V.page.evaluate(() => {
      const by = s => [...new Set([...document.querySelectorAll('.win.' + s)]
        .map(w => getComputedStyle(w).backgroundColor))];
      return { av: by('available'), taken: by('taken') };
    });
    assert(hues.av.length === 1 && hues.taken.length === 1,
      'each state is one flat colour on ' + where + ': available ' + hues.av[0] + ', taken ' + hues.taken[0]);
    assert(hues.av[0] !== hues.taken[0], 'and the two are still told apart by colour alone');
  };

  /* The two things that broke on a phone while desktop stayed fine, both
     measured from real geometry rather than read off the stylesheet:
       · glass running over the free-count on the right
       · a lift shaft that ate the middle, because the narrow CSS block was
         being overridden and the phone silently used desktop widths          */
  const geom = async where => {
    const g = await V.page.evaluate(() => {
      const rw = document.querySelector('.rw:nth-child(2)');
      const plate = rw.querySelector('.plate'), stat = rw.querySelector('.fl-stat');
      const wings = [...rw.querySelectorAll('.wing')].map(w => w.getBoundingClientRect());
      const glassR = Math.max(...[...document.querySelectorAll('.win')].map(w => w.getBoundingClientRect().right));
      const inner = plate.clientWidth - parseFloat(getComputedStyle(plate).paddingLeft)
                                      - parseFloat(getComputedStyle(plate).paddingRight);
      return { overlap: Math.round(glassR - stat.getBoundingClientRect().left),
               band: wings.length === 2 ? Math.round(wings[1].left - wings[0].right) : null,
               inner: Math.round(inner),
               spill: Math.round(Math.max(...[...document.querySelectorAll('.win')]
                 .map(w => w.getBoundingClientRect().right)) - plate.getBoundingClientRect().right) };
    });
    assert(g.overlap < 0, 'no glass reaches the free-count on ' + where + ' (' + g.overlap + 'px)');
    assert(g.spill <= 0, 'and no pane spills out of its own floor plate (' + g.spill + 'px)');
    if (g.band != null) {
      const pc = g.band / g.inner * 100;
      assert(pc < 8, 'the lift shaft takes ' + pc.toFixed(1) + '% of the floor on ' + where + ' (< 8%)');
    }
    return g;
  };

  const inside = async where => {
    const r = await V.page.evaluate(() => {
      const s = document.querySelector('.stage-in').getBoundingClientRect();
      const bits = [...document.querySelectorAll('.win, .fl-stat, .fl-name, .plate, .cap, .plinth, .foot-slab')]
        .map(e => e.getBoundingClientRect());
      const stat = document.querySelector('.fl-stat').getBoundingClientRect();
      const widest = Math.max(...[...document.querySelectorAll('.cap, .plinth, .foot-slab')]
        .map(e => e.getBoundingClientRect().right));
      return { left: Math.min(...bits.map(b => b.left)) - s.left,
               right: s.right - Math.max(...bits.map(b => b.right)),
               underCounter: Math.round(widest - stat.left) };
    });
    assert(r.left >= -1 && r.right >= -1,
      'nothing spills out of the stage on ' + where +
      ' (' + Math.round(r.left) + 'px left, ' + Math.round(r.right) + 'px right)');
    assert(r.underCounter <= 0,
      'the roof and footing overhang stays clear of the free-count on ' + where +
      ' (' + r.underCounter + 'px)');
  };

  await inside('desktop');
  const deskShape = await geom('desktop');
  await top('desktop');
  await solid('desktop');

  const storage = await V.page.evaluate(() => ({
    ls: Object.keys(localStorage).length, ss: Object.keys(sessionStorage).length }));
  assert(storage.ls === 0 && storage.ss === 0,
    'the page stored nothing locally (localStorage ' + storage.ls + ', sessionStorage ' + storage.ss + ')');

  const shape = await V.page.evaluate(() => ({
    title: document.getElementById('ttl').textContent,
    units: document.querySelectorAll('.win').length,
    avail: document.querySelectorAll('.win.available').length,
    taken: document.querySelectorAll('.win.taken').length,
    reserved: document.querySelectorAll('.win.reserved').length,
    sold: document.querySelectorAll('.win.sold').length,
    numbered: [...document.querySelectorAll('.win')].filter(w => w.textContent === w.dataset.u).length,
    chips: [...document.querySelectorAll('#filters .pill')].map(p => p.textContent.trim())
  }));
  assert(shape.title === 'ZZ Map Tower', 'the tower is titled "' + shape.title + '"');
  assert(shape.units === 30, 'all 30 ZZTEST units drawn');
  assert(shape.numbered === 30, 'every pane carries its unit number');
  assert(shape.avail === 28 && shape.taken === 2,
    'two states only: ' + shape.avail + ' available, ' + shape.taken + ' not available');
  assert(shape.reserved === 0 && shape.sold === 0,
    'the words "reserved" and "sold" reach no pane — ZZTEST really has one of each');

  // ── THE POINT: what came down the wire ────────────────────────────────────
  stepH('What the server actually sent');
  const body = V.wire.join('\n');
  console.log('     ' + body.replace(/\s+/g, ' ').slice(0, 220) + '…');
  assert(body.length > 0, 'captured the response body');

  const leaked = Object.entries(SECRETS).filter(([, v]) => body.includes(v)).map(([k]) => k);
  assert(leaked.length === 0, 'no buyer name, phone or booking number on the wire' +
    (leaked.length ? ' — LEAKED: ' + leaked : ''));
  const keys = ['client', 'phone', 'paid', 'outstanding', 'overdue', 'net_amount', 'sale_number', 'due']
    .filter(k => new RegExp('"[a-z_]*' + k, 'i').test(body));
  assert(keys.length === 0, 'not one private key name is present' + (keys.length ? ' — found: ' + keys : ''));

  // price: available units yes, sold/reserved no — decided in SQL
  const priced = await V.page.evaluate(() => {
    const out = { availPriced: 0, takenPriced: 0 };
    // read what the page itself received, unit by unit
    return fetch(document.location.href).then(() => out);
  }).catch(() => null);
  const parsed = JSON.parse(body.trim().split('\n').pop());
  const units = parsed.floors.flatMap(f => f.units);
  const states = [...new Set(units.map(u => u.s))].sort();
  assert(JSON.stringify(states) === JSON.stringify(['available', 'taken']),
    'the wire carries exactly two states: ' + states.join(' / '));
  assert(!/reserved|"sold"/i.test(body), 'the words reserved and sold are not in the payload at all');
  const takenWithPrice = units.filter(u => u.s !== 'available' && u.p != null);
  const availWithPrice = units.filter(u => u.s === 'available' && u.p != null);
  assert(takenWithPrice.length === 0,
    'no price for taken units' + (takenWithPrice.length ? ' — ' + takenWithPrice.map(u => u.n) : ''));
  assert(availWithPrice.length > 0, availWithPrice.length + ' available units DO carry a price (a rep needs it)');

  // ── no way to act from here ───────────────────────────────────────────────
  stepH('Read-only: there is nothing to press');
  await V.page.evaluate(() => document.querySelector('.win.taken').click());
  await sleep(600);
  await V.page.screenshot({ path: path.join(SHOTS, '02-sold-unit-card.png'),
    clip: await V.page.evaluate(() => { const r = document.getElementById('card').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 520) }; }) });
  console.log('  📸 02-sold-unit-card');
  const soldCard = await V.page.evaluate(() => ({
    rows: [...document.querySelectorAll('#cbody .row')].map(r => r.children[0].textContent),
    text: document.getElementById('card').innerText,
    badge: (document.querySelector('#cbody .badge') || {}).textContent || ''
  }));
  assert(!soldCard.rows.some(r => /Price|Rate/.test(r)),
    'a taken unit shows no price: ' + soldCard.rows.join(', '));
  // the badge is uppercased by CSS, so match the words, not the casing
  console.log('     badge → "' + soldCard.badge + '"');
  const cardTxt = soldCard.text.toLowerCase();
  assert(soldCard.badge.toLowerCase().includes('not available') &&
         !cardTxt.includes('sold') && !cardTxt.includes('reserved'),
    'the card reads "' + soldCard.badge + '" — the words Sold and Reserved appear nowhere');
  assert(!/ZZ Buyer|0300/.test(soldCard.text), 'and names nobody');

  const buttons = await V.page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean));
  assert(!buttons.some(b => /reserve|hold|make a plan|book/i.test(b)),
    'no Reserve / Make-a-plan / Book button anywhere on the page');
  const src = fs.readFileSync(path.join(ROOT, 'availability.html'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');           // strip comments, judge the CODE
  assert(!/reserve_unit|save_unit_quote|get_map_plan|sales_sessions/.test(code),
    'the page cannot even name a write RPC or a session');
  const rpcs = [...code.matchAll(/sb\.rpc\(\s*'([^']+)'/g)].map(m => m[1]);
  assert(rpcs.length === 1 && rpcs[0] === 'get_public_availability',
    'it calls exactly one RPC: ' + rpcs.join(', '));

  // ── filters still work for a stranger ─────────────────────────────────────
  stepH('Filters and cheapest work without an account');
  await V.page.evaluate(() => document.getElementById('cx').click());
  await V.page.evaluate(() => [...document.querySelectorAll('#filters .pill')]
    .find(p => p.textContent.startsWith('1 Bed')).click());
  await V.page.evaluate(() => { const e = document.getElementById('bmin');
    e.value = '4000000'; e.dispatchEvent(new Event('input', { bubbles: true }));
    const x = document.getElementById('bmax');
    x.value = '6000000'; x.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await shotFull('03-filter-budget');
  const filtered = await V.page.evaluate(() => ({
    lit: [...document.querySelectorAll('.win')].filter(w => !w.classList.contains('off') && !w.classList.contains('gone')).length,
    note: document.getElementById('fout').innerText.replace(/\s+/g, ' ').trim()
  }));
  assert(filtered.lit > 0 && /Showing \d+ of 30 units/.test(filtered.note),
    'type + budget filter works: ' + filtered.note);

  await V.page.evaluate(() => document.getElementById('cheap').click());
  await sleep(600);
  await shotFull('04-cheapest');
  const list = await V.page.evaluate(() => [...document.querySelectorAll('.lrow')].map(r => r.dataset.u));
  assert(list.length > 0, 'the cheapest list opens with ' + list.length + ' units');
  assert(V.errs.length === 0, 'no console errors' + (V.errs.length ? ': ' + V.errs[0] : ''));
  // ── the phone, where this link is actually opened ────────────────────────
  stepH('On a phone (390×844, touch) — WhatsApp opens links here');
  await V.page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3,
                             isMobile: true, hasTouch: true });
  await sleep(1800);
  await shotFull('06-phone-tower');

  /* The one thing a phone gets wrong more than anything else: something wider
     than the screen, so the whole PAGE slides sideways. The tower is allowed to
     scroll inside its own stage; the document is not. */
  const phone = await V.page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stageScrolls: (() => { const s = document.querySelector('.stage-in');
      return s.scrollWidth > s.clientWidth; })(),
    numbered: [...document.querySelectorAll('.win')].filter(w => w.textContent === w.dataset.u).length,
    labelled: [...document.querySelectorAll('.win')].filter(w => w.textContent.trim().length > 0).length,
    fs: parseFloat(getComputedStyle(document.querySelector('.win')).fontSize),
    chipsWrap: document.querySelectorAll('#filters .pill').length,
    // nothing may sit on top of the filters where a thumb lands
    hitFilter: (() => { const b = document.querySelector('#filters .pill');
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(el && b.contains(el)); })()
  }));
  assert(phone.docScroll <= 1, 'the page does not slide sideways (' + phone.docScroll + 'px overflow)');
  /* On a phone the full "UG-01" may not fit; the number then shows as its tail
     with the floor on the rail beside it. What must never happen is a blank. */
  assert(phone.labelled === 30, 'no pane is blank on a phone (' +
    phone.numbered + ' full, ' + (phone.labelled - phone.numbered) + ' shortened to the tail)');
  assert(phone.fs >= 7.5, 'the number is still ' + phone.fs + 'px');
  assert(phone.hitFilter, 'a thumb landing on a filter chip actually reaches the chip');
  await inside('a phone');
  const phoneShape = await geom('a phone');
  await top('a phone');
  await solid('a phone');
  // and the shaft must not be four times fatter on a phone than on a desk
  const deskPc = deskShape.band / deskShape.inner, phonePc = phoneShape.band / phoneShape.inner;
  assert(phonePc < deskPc * 2.2,
    'its share on a phone (' + (phonePc * 100).toFixed(1) + '%) stays close to the desk (' +
    (deskPc * 100).toFixed(1) + '%)');

  // a real TAP, not a mouse click — under touch emulation mouse input raises no
  // pointerdown, which is the trap that hid a bug in the portal smoke suite
  const box = await V.page.evaluate(() => {
    const w = document.querySelector('.win.available');
    w.scrollIntoView({ block: 'center' });
    const r = w.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await V.page.touchscreen.tap(box.x, box.y);
  await sleep(700);
  await V.page.screenshot({ path: path.join(SHOTS, '07-phone-card.png') });
  console.log('  📸 07-phone-card');

  /* The card is position:fixed. If any ancestor ever holds a transform it stops
     anchoring to the viewport and lands half off-screen — the bug that cost real
     time in the portal. Measure the geometry, do not trust the CSS. */
  const card = await V.page.evaluate(() => {
    const c = document.getElementById('card'), r = c.getBoundingClientRect();
    let t = null;
    for (let e = c.parentElement; e; e = e.parentElement) {
      const tr = getComputedStyle(e).transform;
      if (tr && tr !== 'none') { t = e.tagName + '.' + e.className + ' → ' + tr; break; }
    }
    return { x: r.x, y: r.y, w: r.width, h: r.height,
             vw: innerWidth, vh: innerHeight, open: c.classList.contains('on'),
             unit: document.getElementById('cno').textContent,
             transformedAncestor: t,
             scrimCovers: (() => { const s = document.getElementById('scrim').getBoundingClientRect();
               return Math.round(s.width) >= innerWidth - 1 && Math.round(s.height) >= innerHeight - 1; })(),
             above: (() => { const el = document.elementFromPoint(innerWidth / 2, r.y + 40);
               return !!(el && document.getElementById('card').contains(el)); })()
    };
  });
  assert(card.open && card.unit.length > 0, 'a tap opens the unit card (' + card.unit + ')');
  assert(card.transformedAncestor === null,
    'no transformed ancestor above the fixed card' + (card.transformedAncestor ? ': ' + card.transformedAncestor : ''));
  assert(card.y >= 0 && card.y < 2 && Math.round(card.h) >= card.vh - 2,
    'it anchors to the viewport, full height (top ' + Math.round(card.y) + ', ' + Math.round(card.h) + ' of ' + card.vh + ')');
  assert(Math.round(card.x + card.w) <= card.vw + 1 && card.x >= 0,
    'and sits fully on screen (' + Math.round(card.x) + ' → ' + Math.round(card.x + card.w) + ' of ' + card.vw + ')');
  assert(card.scrimCovers, 'the scrim covers the whole viewport behind it');
  assert(card.above, 'nothing is painted over the card (z-index holds)');

  // the cheapest sheet, same test — this is the "share-sheet" shaped one
  await V.page.evaluate(() => document.getElementById('cx').click());
  await sleep(400);
  await V.page.evaluate(() => document.getElementById('cheap').click());
  await sleep(700);
  await V.page.screenshot({ path: path.join(SHOTS, '08-phone-cheapest.png') });
  console.log('  📸 08-phone-cheapest');
  const sheet = await V.page.evaluate(() => {
    const l = document.getElementById('list'), r = l.getBoundingClientRect();
    const row = document.querySelector('.lrow');
    return { x: r.x, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight,
             rows: document.querySelectorAll('.lrow').length,
             rowFits: row ? Math.round(row.getBoundingClientRect().right) <= innerWidth + 1 : false,
             scrollable: l.querySelector('#lbody').scrollHeight > 0,
             docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  assert(sheet.rows > 0, 'the cheapest sheet lists ' + sheet.rows + ' units on a phone');
  assert(Math.round(sheet.x + sheet.w) <= sheet.vw + 1 && sheet.x >= 0,
    'the sheet is fully on screen (' + Math.round(sheet.x) + ' → ' + Math.round(sheet.x + sheet.w) + ' of ' + sheet.vw + ')');
  assert(sheet.rowFits, 'and its rows do not run off the right edge');
  assert(sheet.docScroll <= 1, 'the page still does not slide sideways with the sheet open');
  await V.page.evaluate(() => document.getElementById('lx').click());
  await sleep(300);

  assert(V.errs.length === 0, 'no console errors on the phone either' + (V.errs.length ? ': ' + V.errs[0] : ''));
  await V.ctx.close();

  // ── one project, one link: revoking KBH must not touch FMH ────────────────
  stepH('Each project carries its own token');
  const other = await sql(`SELECT id FROM public.projects
                            WHERE company_id='${ZZ}' AND id <> '${ZZ_PROJECT}' LIMIT 1`);
  let OTHER = null;
  if (other.length) {
    const m2 = await sql(`SELECT public.create_availability_link('zz-pub-dir','${other[0].id}','ZZ second') AS r`);
    OTHER = m2[0].r.token;
    assert(OTHER && OTHER !== TOKEN, 'a second project gets a different token');
  } else { ok('only one ZZTEST project exists — isolation checked by rotation below'); }

  // rotating a project's link retires the old one and leaves others alone
  const rot = await sql(`SELECT public.create_availability_link('zz-pub-dir','${ZZ_PROJECT}','ZZ rotated') AS r`);
  const ROTATED = rot[0].r.token;
  const oldDead = await sql(`SELECT (public.get_public_availability('${TOKEN}')->>'success') AS s`);
  const newLive = await sql(`SELECT (public.get_public_availability('${ROTATED}')->>'success') AS s`);
  assert(oldDead[0].s === 'false', 'rotating retires the previous link for that project');
  assert(newLive[0].s === 'true', 'and the fresh one works');
  if (OTHER) {
    const otherLive = await sql(`SELECT (public.get_public_availability('${OTHER}')->>'success') AS s`);
    assert(otherLive[0].s === 'true', "the other project's link is untouched");
  }

  // ── revoke kills the same URL ─────────────────────────────────────────────
  stepH('Revoke — the same link, a moment later');
  const rev = await sql(`SELECT public.revoke_availability_link('zz-pub-dir','${ROTATED}') AS r`);
  assert(rev[0].r.success === true, 'the director revoked it');

  const D = await visit(ROTATED);
  await until(D.page, () => /no longer active/i.test(document.body.innerText));
  await D.page.screenshot({ path: path.join(SHOTS, '05-revoked.png') });
  console.log('  📸 05-revoked');
  const deadText = await D.page.evaluate(() => document.body.innerText);
  assert(/no longer active/i.test(deadText), 'the revoked link says so plainly');
  assert(!/ZZ Map Tower|ZZTEST/.test(deadText),
    'and does not even name the project it used to show');
  assert(D.page.url().includes('/a/'), 'still on the public route, never redirected into the portal');
  await D.ctx.close();

  // a made-up token answers the same way — a prober learns nothing
  const G = await visit('deadbeefdeadbeefdeadbeefdeadbeef');
  await until(G.page, () => /no longer active/i.test(document.body.innerText));
  const guessText = await G.page.evaluate(() => document.body.innerText);
  assert(guessText === deadText, 'a guessed token gives the identical answer — no oracle');
  await G.ctx.close();

  await browser.close(); server.close();
  await sql(`DELETE FROM public.availability_links WHERE project_id IN
                ('${ZZ_PROJECT}'${OTHER ? ", '" + other[0].id + "'" : ''});
             DELETE FROM public.sales_sessions WHERE session_token IN ('zz-pub-dir','zz-pub-rep','zz-pub-rep2');`);
  console.log('\n✓ fixture link and sessions removed');
  console.log(`\n${PASS} passed · ${FAIL} failed`);
  console.log('shots → migration_work/public_link/');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
