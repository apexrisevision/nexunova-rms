/**
 * Reserve Desk — several units, one action.
 *
 * The desk was built around one unit at a time, which is the right shape for
 * "Unit LG-12 reserve kar do" off a WhatsApp group and the wrong shape for
 * forty units going to the landowner. A typed or pasted list now becomes chips
 * and the tag below applies to all of them.
 *
 * READ-ONLY BY CONSTRUCTION. It drives the real desk against the real Awami
 * index — 1,467 units, so the tray is being filled from live data — but it
 * NEVER presses the button. Nothing here books anything; the one thing written
 * is a short-lived session, deleted in the finally block. The booking itself is
 * proved server-side in shot-daybook.js, inside a rolled-back transaction.
 *
 *   node scripts/shot-desk-bulk.js
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'),
      puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4197, BASE = 'http://127.0.0.1:' + PORT, PAGE = BASE + '/sales-portal.html';
const OUT = path.join(ROOT, 'marketing_shots', 'desk');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const DIR = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const TOK = 'dkshot_' + Math.random().toString(36).slice(2, 10);
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
               '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
               '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  return new Promise(r => {
    const s = http.createServer((q, res) => {
      const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
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
  await sql(`insert into public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
             values ('${CO}','${DIR}',null,'${TOK}', now() + interval '15 minutes');`);
  const server = await serve();
  const exe = BROWSERS.find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
                                           args: ['--no-sandbox', '--force-device-scale-factor=2'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 1000, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  let FAILED = false;
  const ok = m => console.log('  \u2705 ' + m);
  const bad = m => { console.log('  \u274C ' + m); FAILED = true; };

  try {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => {
      localStorage.setItem('rms.sales.token', t);
      localStorage.setItem('rms.sales.active', String(Date.now()));
      sessionStorage.setItem('nx.hub.bounce', '1');
    }, TOK);
    await page.goto(PAGE + '?tab=desk', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.getElementById('rd-root'), { timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('rd-unit'), { timeout: 60000 });
    await sleep(1500);

    console.log('\n\u2500\u2500 One unit \u2014 the desk it has always been');
    const before = await page.evaluate(() => ({
      tray: (document.getElementById('rd-cart') || {}).innerHTML || '',
      sumShown: !!(document.getElementById('rd-sum') &&
                   document.getElementById('rd-sum').style.display !== 'none'),
      go: (document.getElementById('rd-go') || {}).textContent || '',
      disabled: !!(document.getElementById('rd-go') || {}).disabled
    }));
    (before.tray === '' && !before.sumShown)
      ? ok('nothing extra on screen until somebody asks for more than one unit')
      : bad('the tray is showing before anything was typed: ' + JSON.stringify(before));

    const nums = await page.evaluate(() => {
      /* Read three available unit numbers straight off the rendered suggestion
         machinery: type a letter and take what it offers. */
      const el = document.getElementById('rd-unit');
      el.value = 'LG';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const list = [...document.querySelectorAll('#rd-sugg .rd-sg .n')].map(x => x.textContent.trim());
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return list.slice(0, 3);
    });
    (nums.length === 3)
      ? ok('the type-ahead still answers a bare letter: ' + nums.join(', '))
      : bad('could not read three available units off the desk: ' + JSON.stringify(nums));

    const one = await page.evaluate(n => {
      const el = document.getElementById('rd-unit');
      el.value = n;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        hit: (document.getElementById('rd-hit') || {}).textContent || '',
        tray: (document.getElementById('rd-cart') || {}).innerHTML || '',
        go: (document.getElementById('rd-go') || {}).textContent || '',
        disabled: !!(document.getElementById('rd-go') || {}).disabled
      };
    }, nums[0]);
    (/available/i.test(one.hit) && one.tray === '' && !one.disabled)
      ? ok('one number typed resolves to one unit and no tray \u2014 ' +
           '\u201c' + one.go.trim() + '\u201d')
      : bad('the single-unit path changed: ' + JSON.stringify(one));

    console.log('\n\u2500\u2500 Typing a letter and tapping what comes back');
    /* ══ A TAP SELECTS ═══════════════════════════════════════════════════
       Rashid's words: type L and every free unit on the L floors should come
       up, and tapping one should pick it. It used to fill the box and move to
       the requester, which ends a booking \u2014 right for one unit, useless for
       ten, because the first tap closed the selection.

       The list is bound on MOUSEDOWN, not click: the box blurs on mousedown
       and a deferred close would otherwise race the click. So this drives a
       real mouse rather than calling .click(), which fires neither. */
    const listed = await page.evaluate(() => {
      const el = document.getElementById('rd-unit');
      el.value = 'L';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        rows: [...document.querySelectorAll('#rd-sugg .rd-sg .n')].map(x => x.textContent.trim()),
        shown: (document.getElementById('rd-sugg') || {}).style.display
      };
    });
    (listed.shown === 'block' && listed.rows.length >= 3 && listed.rows.every(n => /^L/i.test(n)))
      ? ok('one letter brings up the free units on that floor: ' +
           listed.rows.slice(0, 4).join(', ') + (listed.rows.length > 4 ? ' \u2026' : ''))
      : bad('the list did not answer a bare letter: ' + JSON.stringify(listed));

    async function tapFirst() {
      const box = await page.$('#rd-sugg .rd-sg');
      if (!box) return null;
      const b = await box.boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(120);
      return page.evaluate(() => ({
        chips: [...document.querySelectorAll('#rd-cart .rd-uc')]
                 .map(c => c.textContent.replace(/\u00d7/g, '').trim()),
        rows: [...document.querySelectorAll('#rd-sugg .rd-sg .n')].map(x => x.textContent.trim()),
        box: document.getElementById('rd-unit').value,
        focused: document.activeElement && document.activeElement.id,
        go: (document.getElementById('rd-go') || {}).textContent || ''
      }));
    }

    const first = await tapFirst();
    (first && first.chips.length === 1 && first.chips[0] === listed.rows[0])
      ? ok('tapping one selects it \u2014 ' + first.chips[0] + ' is now a chip')
      : bad('the tap did not select: ' + JSON.stringify(first));
    (first && first.box === 'L' && first.rows.indexOf(listed.rows[0]) < 0)
      ? ok('the letter stays in the box and the list comes back WITHOUT it \u2014 ' +
           'a unit already picked is not offered again')
      : bad('the list did not refresh around the pick: ' + JSON.stringify(first));
    (first && first.focused === 'rd-unit')
      ? ok('and the thumb is left where the next tap is')
      : bad('focus moved to ' + JSON.stringify(first && first.focused));

    const second = await tapFirst();
    (second && second.chips.length === 2 && /\b2 units\b/.test(second.go))
      ? ok('so they can be tapped one after another: ' + second.chips.join(' ') +
           ' \u2014 \u201c' + second.go.trim() + '\u201d')
      : bad('the second tap did not add: ' + JSON.stringify(second));

    await page.screenshot({ path: path.join(OUT, 'c-tap-to-pick.png') });

    /* Cleared, so the paste test below starts from the screen it expects. */
    await page.evaluate(() => {
      let x; while ((x = document.querySelector('#rd-cart .rd-uc button[data-x]'))) x.click();
      const el = document.getElementById('rd-unit');
      el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    console.log('\n\u2500\u2500 A pasted list');
    /* ONE input event, which is exactly what a paste is. Forty units off a
       WhatsApp group arrive this way, not keystroke by keystroke. */
    const many = await page.evaluate(list => {
      const el = document.getElementById('rd-unit');
      el.value = list.join(', ') + ',';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        chips: [...document.querySelectorAll('#rd-cart .rd-uc')]
                 .map(c => c.textContent.replace(/\u00d7/g, '').trim()),
        sum: (document.getElementById('rd-sum') || {}).textContent || '',
        go: (document.getElementById('rd-go') || {}).textContent || '',
        disabled: !!(document.getElementById('rd-go') || {}).disabled,
        left: document.getElementById('rd-unit').value,
        /* An empty resolution box must be EMPTY, not a coloured outline with
           nothing in it — clearing the text but keeping the ok class left one
           under the field on every number the tray absorbed. */
        hitCls: (document.getElementById('rd-hit') || {}).className || '',
        hitTxt: ((document.getElementById('rd-hit') || {}).textContent || '').trim()
      };
    }, nums);
    (JSON.stringify(many.chips) === JSON.stringify(nums))
      ? ok('three numbers pasted in one gesture become three chips: ' + many.chips.join(' '))
      : bad('the paste did not become chips: ' + JSON.stringify(many));
    (many.left === '')
      ? ok('and the box is empty afterwards, ready for the next one')
      : bad('the box kept ' + JSON.stringify(many.left));
    /3 units/.test(many.sum) && /3.*available/.test(many.sum)
      ? ok('the line under them counts what is going to happen \u2014 \u201c' +
           many.sum.trim() + '\u201d')
      : bad('the summary is wrong: ' + JSON.stringify(many.sum));
    (/\b3 units\b/.test(many.go) && !many.disabled)
      ? ok('and the button says what it will do to how many \u2014 \u201c' + many.go.trim() + '\u201d')
      : bad('the button does not name the count: ' + JSON.stringify(many.go));
    (many.hitTxt === '' && many.hitCls === '')
      ? ok('and nothing is left behind under the field — no empty coloured box')
      : bad('the resolution box is still drawn: ' + JSON.stringify([many.hitCls, many.hitTxt]));


    const tags = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('#rd-tags .rd-chip[data-tag]')].map(b => b.textContent.trim()),
      armed: (document.querySelector('#rd-tags .rd-chip.on') || {}).textContent || ''
    }));
    (tags.chips.length > 1)
      ? ok('the tags are still one row and still apply to the whole tray: ' + tags.chips.join(' / '))
      : bad('no tag chips on the desk: ' + JSON.stringify(tags));

    /* Arm a different tag and the button has to follow, or it is naming an
       action nobody chose. */
    const relabel = await page.evaluate(() => {
      const all = [...document.querySelectorAll('#rd-tags .rd-chip[data-tag]')];
      const off = all.find(b => !b.classList.contains('on'));
      if (!off) return null;
      off.click();
      return { picked: off.textContent.trim(),
               go: (document.getElementById('rd-go') || {}).textContent || '' };
    });
    relabel
      ? (/\b3 units\b/.test(relabel.go)
          ? ok('changing the tag keeps the count and changes the verb \u2014 \u201c' +
               relabel.go.trim() + '\u201d')
          : bad('the button lost the count on a tag change: ' + JSON.stringify(relabel)))
      : ok('only one tag on this project \u2014 nothing to switch to');

    await page.screenshot({ path: path.join(OUT, 'a-desk-tray.png') });

    console.log('\n\u2500\u2500 Taking one back out');
    const dropped = await page.evaluate(() => {
      const x = document.querySelector('#rd-cart .rd-uc button[data-x]');
      if (x) x.click();
      return {
        chips: [...document.querySelectorAll('#rd-cart .rd-uc')].length,
        go: (document.getElementById('rd-go') || {}).textContent || ''
      };
    });
    (dropped.chips === 2 && /\b2 units\b/.test(dropped.go))
      ? ok('a chip comes off and the button counts again: \u201c' + dropped.go.trim() + '\u201d')
      : bad('removing a chip did not update the count: ' + JSON.stringify(dropped));

    const empty = await page.evaluate(() => {
      let x;
      while ((x = document.querySelector('#rd-cart .rd-uc button[data-x]'))) x.click();
      return {
        chips: [...document.querySelectorAll('#rd-cart .rd-uc')].length,
        sumShown: !!(document.getElementById('rd-sum') &&
                     document.getElementById('rd-sum').style.display !== 'none'),
        go: (document.getElementById('rd-go') || {}).textContent || '',
        disabled: !!(document.getElementById('rd-go') || {}).disabled
      };
    });
    (empty.chips === 0 && !empty.sumShown && !/units/.test(empty.go))
      ? ok('emptying it hands the desk back exactly as it was \u2014 \u201c' + empty.go.trim() + '\u201d')
      : bad('the desk did not return to one unit: ' + JSON.stringify(empty));

    /* ══ THE QUEUE ═══════════════════════════════════════════════════════════
       Eight units asked for in one breath used to arrive as eight identical
       cards — eight taps for one decision, and a queue that read as a backlog
       when it was one conversation.

       The rows are handed in rather than fetched, because a waiting request
       cannot be manufactured on a live tenant just to photograph it. That is
       the same harness availability.html already carries; it paints, and it
       cannot decide anything. The DECIDING is proved server-side in
       shot-daybook.js against the real RPC, inside a rolled-back transaction. */
    console.log('\n\u2500\u2500 The queue, when several were asked for together');
    const q = await page.evaluate(() => {
      const at = new Date(Date.now() - 9 * 60000).toISOString();
      const row = (id, unit, batch, free) => ({
        id: id, ref: 'AAA111', batch_ref: batch, kind: 'new',
        asked_status_id: null, asked_tag: null, asked_nature: null, note: null,
        current_tag: null, unit_no: unit, unit_id: 'u-' + id,
        floor: 'Lower Ground', area: 200, area_unit: 'sqft', days: 5,
        requested_by: 'Bulk Dealer', at: at, minutes_waiting: 9,
        still_free: free, link_label: 'probe'
      });
      /* three asked for together, one of which has gone since; and one lone
         request that has nothing to do with them */
      const n = window._deskPreviewRequests([
        row('r1', 'LG-21', 'BATCH1', true),
        row('r2', 'LG-22', 'BATCH1', true),
        row('r3', 'LG-23', 'BATCH1', false),
        row('r9', 'GF-07', null, true)
      ]);
      const cards = [...document.querySelectorAll('#rd-reqs .rq-c')];
      return {
        fed: n,
        cards: cards.length,
        heads: cards.map(c => (c.querySelector('.rq-u') || {}).textContent || ''),
        units: cards.map(c => [...c.querySelectorAll('.rq-us span')].map(x => x.textContent)),
        struck: cards.map(c => c.querySelectorAll('.rq-us span.gone').length),
        approve: cards.map(c => (c.querySelector('[data-act="approve"]') || {}).textContent || ''),
        warn: cards.map(c => (c.querySelector('.rq-gone') || {}).textContent || ''),
        ids: cards.map(c => c.getAttribute('data-r'))
      };
    });

    (q.fed === 4 && q.cards === 2)
      ? ok('four waiting requests, two cards \u2014 the three asked for together are ' +
           'one conversation, not three')
      : bad('the queue did not group them: ' + JSON.stringify(q));
    (/3 units/.test(q.heads[0]) && q.units[0].length === 3)
      ? ok('the grouped card names every unit it speaks for: ' + q.units[0].join(' '))
      : bad('the grouped card is wrong: ' + JSON.stringify([q.heads, q.units]));
    (q.struck[0] === 1 && /Approve 2/.test(q.approve[0]) &&
     /2 will be booked|only 2/.test(q.warn[0]))
      ? ok('one of them has gone since \u2014 struck through, and the button offers ' +
           'the two that are left rather than failing on all three')
      : bad('a unit that had gone was mishandled: ' + JSON.stringify([q.struck, q.approve, q.warn]));
    (String(q.ids[0]).split(',').length === 3 && String(q.ids[1]).split(',').length === 1)
      ? ok('and one tap on it answers all three, while the lone request stays alone')
      : bad('the card ids are wrong: ' + JSON.stringify(q.ids));

    /* SELECTING ACROSS CARDS. Rashid asked for the batch AND for answering
       several unrelated ones together; the tick does the second. */
    const sel = await page.evaluate(() => {
      const ticks = [...document.querySelectorAll('#rd-reqs .rq-ck')];
      ticks.forEach(t => { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); });
      const bar = document.querySelector('#rd-reqs .rq-bar');
      const out = { bar: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '',
                    lit: document.querySelectorAll('#rd-reqs .rq-c.sel').length };
      const ap = document.querySelector('#rd-reqs [data-act="bulkapprove"]');
      if (ap) ap.click();
      const pick = document.getElementById('rq-bulkpick');
      out.asks = pick ? !pick.hidden : false;
      out.asksWhat = pick ? (pick.querySelector('.rq-pl') || {}).textContent : '';
      out.tags = pick ? [...pick.querySelectorAll('.rq-t')].length : 0;
      return out;
    });

    (/4 selected/.test(sel.bar) && sel.lit === 2)
      ? ok('ticking both cards counts the REQUESTS behind them, not the cards \u2014 ' +
           '\u201c' + sel.bar + '\u201d')
      : bad('the selection bar is wrong: ' + JSON.stringify(sel));
    (sel.asks && /Approve all 4 as/.test(sel.asksWhat) && sel.tags > 1)
      ? ok('and Approve still asks WHICH before it does anything to four units')
      : bad('the bulk approve did not ask which tag: ' + JSON.stringify(sel));

    await page.screenshot({ path: path.join(OUT, 'b-queue-batch.png') });

    /* Put the queue back to what the server actually says, so nothing below
       is reading a fixture. */
    await page.evaluate(() => window._deskPreviewRequests([]));

    /* NOTHING WAS BOOKED. The whole point of this script is that it drives the
       real desk against real inventory without writing to it. */
    const wrote = await sql(`select count(*)::int as n from public.reservations
                              where reserved_by='${DIR}' and created_at > now() - interval '10 minutes';`);
    Number((wrote[0] || {}).n) === 0
      ? ok('and not one reservation was written while this ran')
      : bad('this script booked something: ' + JSON.stringify(wrote));

    const real = errs.filter(e => !/favicon|manifest|404|Not Found/i.test(e));
    real.length === 0 ? ok('no console errors') : bad('console: ' + real.slice(0, 3).join(' | '));

    console.log('\n' + (FAILED ? '\u274C SOMETHING IS WRONG' : '\u2705 ALL CHECKS OK') + '  \u2192 ' + OUT);
    process.exitCode = FAILED ? 1 : 0;
  } finally {
    await browser.close(); server.close();
    await sql(`delete from public.sales_sessions where session_token='${TOK}';`);
  }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
