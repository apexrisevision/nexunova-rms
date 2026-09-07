/**
 * Reservation Daybook — render every page at A4 and screenshot it.
 *
 * The document paginates itself into real 210×297mm .rd-pg boxes, and the CSS
 * that shapes them lives OUTSIDE @media print — only the show/hide toggle is
 * inside it. So what this screenshots on screen is what comes out of the
 * printer, rather than an approximation of it.
 *
 * Three renders, because the failure modes differ:
 *   1. a date with real activity          (2026-09-07, Awami: LG-02 reserved)
 *   2. a date with none                   (the empty state is what looks broken)
 *   3. the same data padded to force page breaks — rows are added to the
 *      PAYLOAD IN THE BROWSER ONLY. Nothing is written to any database.
 * Plus a greyscale pass, because the accent must not be carrying meaning.
 *
 *   ZZTEST_PIN unused. Read-only: one short-lived session, deleted at the end.
 *   node scripts/shot-daybook.js
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'),
      puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 4195, BASE = 'http://127.0.0.1:' + PORT, PAGE = BASE + '/sales-portal.html';
const OUT = path.join(ROOT, 'marketing_shots', 'daybook');
const CO = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const DIR = '015effd0-7ac7-4939-a1b3-dd2826ab8fba';
const AWAMI = '59ded55b-9bc2-45b2-a372-49fc31807fa9';   // the daybook is ONE project's book
const TOK = 'dbshot_' + Math.random().toString(36).slice(2, 10);
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function sql(q){
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT,'.mcp.json'),'utf8'));
  const key = mcp.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
  const body = JSON.stringify({ query: q });
  return new Promise((res,rej)=>{ const r=https.request({hostname:'api.supabase.com',
    path:'/v1/projects/itqxljtfbrppntgyfush/database/query',method:'POST',
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
    x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>x.statusCode<300?res(JSON.parse(d||'[]')):rej(new Error(d)));});
    r.on('error',rej); r.write(body); r.end(); });
}
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
            '.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
function serve(){ return new Promise(r=>{ const s=http.createServer((q,res)=>{
  const p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
  if(!p.startsWith(ROOT)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'});
  fs.createReadStream(p).pipe(res); }); s.listen(PORT,'127.0.0.1',()=>r(s)); }); }

(async () => {
  /* Clear first. A shorter render leaves the previous run's extra pages behind,
     and a stale p3 sitting next to a fresh p1 is exactly the kind of thing that
     gets reviewed as if it were current. */
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter(function (n) { return /.png$/.test(n); })
    .forEach(function (n) { fs.unlinkSync(path.join(OUT, n)); });
  await sql(`insert into public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
             values ('${CO}','${DIR}',null,'${TOK}', now() + interval '20 minutes');`);
  const server = await serve();
  const exe = BROWSERS.find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
                                           args: ['--no-sandbox', '--force-device-scale-factor=2'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message||e)));
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });

  let FAILED=false, SEMFAIL=false;
  try {
    await page.goto(PAGE, { waitUntil:'domcontentloaded' });
    await page.evaluate(t => { localStorage.setItem('rms.sales.token', t);
      localStorage.setItem('rms.sales.active', String(Date.now()));
      sessionStorage.setItem('nx.hub.bounce','1'); }, TOK);
    await page.goto(PAGE + '?tab=daybook', { waitUntil:'domcontentloaded' });
    await page.waitForFunction(()=>!!document.getElementById('db-root'), { timeout:60000 });
    await sleep(1200);

    /* ── THE PERIOD ────────────────────────────────────────────────────────
       Rashid's condition was blunt: nothing before the From and nothing after
       the To may appear. That is a question about the RPC, not about pixels,
       so it is asked of the database directly — and asked for a day on which
       nothing happened, which is the only shape in which a leak shows. */
    console.log('\n\u2500\u2500 The period holds its edges');
    {
      const okP = m => console.log('  \u2705 ' + m);
      const badP = m => { console.log('  \u274C ' + m); FAILED = true; };
      const rows = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('${CO}','${DIR}',NULL,'dbshot_period', now() + interval '2 minutes');
        CREATE TEMP TABLE per ON COMMIT DROP AS
          SELECT 'today'::text AS label, public.get_reservation_daybook('dbshot_period', NULL, '${AWAMI}',
                   (now() AT TIME ZONE 'Asia/Karachi')::date,
                   (now() AT TIME ZONE 'Asia/Karachi')::date) AS d
          UNION ALL
          SELECT 'a quiet day before', public.get_reservation_daybook('dbshot_period', NULL, '${AWAMI}',
                   (now() AT TIME ZONE 'Asia/Karachi')::date - 30,
                   (now() AT TIME ZONE 'Asia/Karachi')::date - 30)
          UNION ALL
          SELECT 'legacy p_date', public.get_reservation_daybook('dbshot_period',
                   (now() AT TIME ZONE 'Asia/Karachi')::date, '${AWAMI}');
        SELECT label,
               (d->>'single_day')::boolean                       AS one_day,
               (d->'ledger'->'held'->>'opening')::int            AS h_open,
               (d->'ledger'->'held'->>'added')::int              AS h_add,
               (d->'ledger'->'held'->>'removed')::int            AS h_rem,
               (d->'ledger'->'held'->>'closing')::int            AS h_close,
               (d->'ledger'->'sold'->>'closing')::int            AS s_close,
               (d->'ledger'->'available'->>'closing')::int       AS av_close,
               (d->'ledger'->>'total')::int                      AS total,
               jsonb_array_length(d->'reserved')                 AS n_booked,
               jsonb_array_length(d->'released')                 AS n_released,
               jsonb_array_length(d->'holding')                  AS n_earlier
          FROM per ORDER BY label;
        ROLLBACK;`);

      const by = {}; rows.forEach(r => { by[r.label] = r; });
      const t = by['today'], q = by['a quiet day before'], l = by['legacy p_date'];

      /* The ledger has to close on every one of them, or the four figures are
         four opinions rather than one position. */
      const bad = rows.filter(r => r.h_open + r.h_add - r.h_rem !== r.h_close);
      bad.length === 0
        ? okP('opening + added \u2212 released = closing on all ' + rows.length + ' periods')
        : badP('the ledger does not close: ' + JSON.stringify(bad));

      const off = rows.filter(r => r.h_close + r.s_close + r.av_close !== r.total);
      off.length === 0
        ? okP('held + sold + available = total on all ' + rows.length + ' periods')
        : badP('the board does not add up: ' + JSON.stringify(off));

      /* A day thirty days back, before this project had any activity at all.
         Anything non-zero here is something from outside the range leaking in. */
      (q && q.h_open === 0 && q.h_add === 0 && q.h_close === 0 &&
       q.n_booked === 0 && q.n_released === 0 && q.n_earlier === 0 && q.av_close === q.total)
        ? okP('a day 30 days back shows nothing at all \u2014 the range holds its edges')
        : badP('activity from outside the range leaked into a quiet day: ' + JSON.stringify(q));

      /* Today must NOT be empty, or the check above proved nothing. */
      (t && (t.n_booked > 0 || t.h_close > 0))
        ? okP("today is not empty (" + t.n_booked + ' booked, ' + t.h_close + ' held), so that check could have failed')
        : badP('today is empty too, so the edge test proved nothing');

      /* And the old single-date call still means a one-day period. */
      (l && l.one_day === true && t && l.h_close === t.h_close && l.n_booked === t.n_booked)
        ? okP('the old p_date call still returns exactly the same one-day report')
        : badP('p_date and an explicit one-day range disagree: ' + JSON.stringify({ legacy: l, today: t }));
    }

    console.log('\n\u2500\u2500 A booking survives its own tag');
    {
      const okT = m => console.log('  \u2705 ' + m);
      const badT = m => { console.log('  \u274C ' + m); FAILED = true; };
      /* One transaction, rolled back. Nothing below reaches Awami. */
      const rows = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('${CO}','${DIR}',NULL,'dbshot_tagprobe', now() + interval '2 minutes');
        CREATE TEMP TABLE probe_out ON COMMIT DROP AS
          WITH tags AS (
            SELECT cus.id, upper(cus.status_code) AS code,
                   row_number() OVER (ORDER BY cus.status_code) AS n
              FROM public.category_unit_statuses cus
             WHERE cus.project_id = '${AWAMI}' AND cus.is_active
               AND upper(cus.status_code) IN ('HOLD','RESERVED','BOOKED')),
          units AS (
            SELECT u.id, row_number() OVER (ORDER BY u.unit_no) AS n
              FROM public.units u
              JOIN public.category_unit_statuses st ON st.id = u.status_id
             WHERE u.project_id = '${AWAMI}' AND st.is_available)
          SELECT t.code,
                 public.reserve_unit_desk('dbshot_tagprobe', u.id, NULL, NULL,
                   'Tag Probe', NULL, NULL, 7, false, 0, NULL, t.id) AS r
            FROM tags t JOIN units u ON u.n = t.n;
        SELECT p.code,
               (p.r->>'success') AS ok,
               (p.r->>'error')   AS err,
               res.status                    AS res_status,
               upper(cus.status_code)        AS unit_status
          FROM probe_out p
          LEFT JOIN public.reservations res ON res.id = (p.r->>'reservation_id')::uuid
          LEFT JOIN public.units u2 ON u2.id = res.unit_id
          LEFT JOIN public.category_unit_statuses cus ON cus.id = u2.status_id
         ORDER BY p.code;
        ROLLBACK;`);

      const want = ['BOOKED','HOLD','RESERVED'];
      const got = rows.map(r => r.code).sort();
      JSON.stringify(got) === JSON.stringify(want)
        ? okT('all three tags booked a unit: ' + got.join(', '))
        : badT('the desk did not book every tag: ' + JSON.stringify(rows));

      const dead = rows.filter(r => r.res_status !== 'active');
      dead.length === 0
        ? okT('every reservation is still ACTIVE after its tag was stamped on the unit')
        : badT('a tag cancelled its own booking: ' +
               JSON.stringify(dead.map(r => ({ tag: r.code, reservation: r.res_status }))));

      const wrong = rows.filter(r => r.unit_status !== r.code);
      wrong.length === 0
        ? okT('each unit carries the tag it was booked with')
        : badT('unit status does not match the tag: ' + JSON.stringify(wrong));

      /* And the probe must have left nothing behind. */
      const left = Number((await sql(`select count(*)::int n from public.reservations
                                       where requested_by_name='Tag Probe';`))[0].n);
      left === 0 ? okT('the probe rolled back cleanly \u2014 no rows on Awami')
                 : badT(left + ' probe reservation(s) were left behind on a live tenant');
    }

    console.log('\n\u2500\u2500 On-screen daybook \u2014 the same day, told the same way');
    {
      /* Counted in the DATABASE, not read back out of the payload the page was
         drawn from. A page compared against its own input agrees with itself by
         construction; this is the only version of the check that can fail. */
      const dbHolds = Number((await sql(`select count(*)::int n from public.reservations
                                          where project_id='${AWAMI}' and status='active';`))[0].n);
      /* Reservations CREATED today that were undone again before the day ended.
         This is the defect Rashid reported: they used to print as live holds.
         Read from the database so the assertion cannot pass by agreeing with
         the page it is checking. */
      const dbToday = (await sql(`select
            count(*) filter (where status='active')::int    as live,
            count(*) filter (where status<>'active')::int   as gone
          from public.reservations
         where project_id='${AWAMI}'
           and (created_at at time zone 'Asia/Karachi')::date
               = (now() at time zone 'Asia/Karachi')::date;`))[0];
      const scr = await page.evaluate(async () => {
        // exactly what the desk does: no stubbing, no arguments, today's book
        await window.renderDaybook();
        const root = document.getElementById('db-root');
        const secs = [...root.querySelectorAll('.db-sec')].map(x => ({
          t: (x.querySelector('.db-t') || {}).textContent.trim(),
          rows: x.querySelectorAll('.db-tbl tbody tr').length,
          asat: !!x.querySelector('.db-asat'),
          // every tag chip in the section, and whether it reads as struck off
          tags: [...x.querySelectorAll('.db-tbl tbody tr')].map(tr => {
            const g = tr.querySelector('.tg');
            return g ? { txt: g.textContent.trim(), off: g.classList.contains('tg-off') } : null;
          }),
          // does any row still claim time left after being released?
          released: [...x.querySelectorAll('.db-tbl tbody tr')]
                      .filter(tr => /released/i.test(tr.textContent)).length
        }));
        return { secs };
      });
      scr.payloadHolds = dbHolds;
      scr.dbToday = dbToday;
      scr.hasGeneratedAt = await page.evaluate(async (AW) => {
        const r = await sb.rpc('get_reservation_daybook',
          { p_session_token: TOKEN, p_date: null, p_project_id: AW });
        return !!(r.data && r.data.generated_at);
      }, AWAMI);
      const okC = m => console.log('  \u2705 ' + m);
      const badC = m => { console.log('  \u274C ' + m); FAILED = true; };
      const titles = scr.secs.map(x => x.t.replace(/\s+\d+$/, '').trim());
      const hold = scr.secs.find(x => /^Held from before/.test(x.t));
      scr.hasGeneratedAt ? okC('the RPC returns generated_at, so the page can date its own hold list')
                         : badC('generated_at missing from the payload');
      hold ? okC('screen shows a "Held from before" section')
           : okC('nothing is held from an earlier day, so that section collapsed');
      /* The payload count is the truth; the screen has to match it exactly. A
         hold that is in the data and not on the page reads as an available
         unit, which is the one error that costs a double booking. */
      /* With zero holds the section collapses to an empty state and prints no
         rows, which is correct — so the expected row count is the database's
         count either way, and 0 has to mean 0 rather than mean "skip". */
      /* The section shows what was held BEFORE today. The database count of
         everything active minus what was booked today is the number it owes. */
      const holdRows = hold ? hold.rows : 0;
      const earlierExpected = scr.payloadHolds - scr.dbToday.live;
      holdRows === earlierExpected
        ? okC('screen lists the ' + earlierExpected + ' unit(s) held from before today (' +
              scr.payloadHolds + ' held in total, ' + scr.dbToday.live + ' booked today)')
        : badC('screen shows ' + holdRows + ' earlier holds; the database says ' + earlierExpected);
      /* A section with no rows collapses to one line and carries no note - that
         is the empty state, not a missing stamp. */
      (!hold || holdRows === 0 || hold.asat)
        ? okC(holdRows ? 'screen stamps the held list with the moment it was read'
                       : 'nothing held from earlier, so the section is one line with no stamp')
        : badC('screen held list carries no as-at line');

      /* ── THE UNDO DEFECT ────────────────────────────────────────────────
         A booking that was cancelled must be GONE from the daybook — not
         marked, not struck through, absent. The first fix marked them and
         Rashid rejected it, so this asserts the count the database says is
         still standing, and nothing else. Today's live data has one cancelled
         booking and no live one, so the check can actually fail. */
      const bt = scr.secs.find(x => /^Booked today/.test(x.t));
      const btRows = bt ? bt.rows : 0;
      btRows === scr.dbToday.live
        ? okC("today's list shows the " + btRows + ' booking(s) still standing, of ' +
              (scr.dbToday.live + scr.dbToday.gone) + ' made today')
        : badC("today's list shows " + btRows + ' rows; only ' + scr.dbToday.live +
               ' of today\u2019s bookings are still active');
      scr.dbToday.gone > 0
        ? (btRows === scr.dbToday.live && (!bt || bt.released === 0)
            ? okC('the ' + scr.dbToday.gone + ' cancelled booking(s) appear nowhere on the daybook')
            : badC('a cancelled booking is still on the daybook'))
        : okC('nothing was cancelled today \u2014 this check had nothing to catch');
      /* And never on the hold list either. */
      /* Nothing released may reach either list. */
      (bt && bt.released === 0 && holdRows === earlierExpected)
        ? okC('no released reservation reaches either list')
        : badC('a released reservation is still being listed');
      titles.indexOf('Expiring within 48 hours') < 0
        ? okC('screen and PDF agree: no separate 48-hour section')
        : badC('screen still carries the 48-hour section the PDF dropped');
    }

    async function shot(tag, dateISO, pad, grey) {
      const n = await page.evaluate(async (dt, padN, AWAMI) => {
        const r = await sb.rpc('get_reservation_daybook',
          { p_session_token: TOKEN, p_date: dt, p_project_id: AWAMI });
        const d = r.data;
        if (padN) {
          // BROWSER-ONLY padding, to force page breaks. No DB write.
          const base = (d.reserved && d.reserved[0]) || {
            unit_no:'LG-01', floor:'Lower Ground', requested_by:'Nimra Khan',
            agent_code:'AGT-2026-0009', booked_by:'Rashid Manzoor',
            client_name:null, expiry_date:new Date(Date.now()+6e8).toISOString() };
          const names=['Nimra Khan','Malik Sikandar','Muhammad Saeed','IQRA','Salman Sajjad','Naseer khan'];
          const floors=['Lower Ground','Ground Floor','First Floor','Second Floor','Third Floor'];
          d.reserved = [];
          for (let i=0;i<padN;i++){
            const c = JSON.parse(JSON.stringify(base));
            c.unit_no = floors[i%5].split(' ')[0].slice(0,2).toUpperCase()+'-'+String(i+1).padStart(2,'0');
            c.floor = floors[i%5];
            c.requested_by = names[i%names.length];
            c.agent_code = 'AGT-2026-'+String(1+(i%40)).padStart(4,'0');
            c.client_name = (i%3===0) ? null : 'Buyer '+(i+1);
            const TG=[['On Hold','HOLD'],['Reserved','RESERVED'],['Booked','BOOKED']];
            const tg=TG[i%3];
            c.tag=tg[0]; c.tag_code=tg[1];
            c.status=(i%9===4)?'cancelled':'active';
            c.cancelled_at=(i%9===4)?new Date(Date.now()-36e5).toISOString():null;
            d.reserved.push(c);
          }
          d.sold = [];
          for (let i=0;i<12;i++){
            d.sold.push({ unit_no:'SL-'+String(i+1).padStart(2,'0'), floor:floors[i%5],
              client_name:'Buyer '+(i+1), agent:names[i%names.length],
              sale_number:'SAL-2026-'+String(100+i), amount:15000000+i*250000,
              sale_date:dt });
          }
          d.expiring = d.reserved.slice(0,6).map((x,i)=>({
            unit_no:x.unit_no, floor:x.floor, requested_by:x.requested_by, hours_left:6+i*4,
            expiry_date:new Date(Date.now()+(6+i*4)*36e5).toISOString() }));
          const HOLD=[]; {
            const hn=['Nimra Khan','Malik Sikandar','Fawad khan','IQRA','Fawad khan','Naseer khan'];
            for(let i=0;i<18;i++){
              const hrs = i===0 ? -30 : (i<4 ? 6+i*9 : (i<9 ? 30+i*22 : 200+i*60));
              HOLD.push({ unit_no:floors[i%5].split(' ')[0].slice(0,2).toUpperCase()+'-'+String(80+i),
                floor:floors[i%5], area:900+i*115, area_unit:'sqft', price:12500000+i*640000,
                requested_by:hn[i%hn.length], agent_code:'AGT-2026-'+String(11+i).padStart(4,'0'),
            tag:['On Hold','Reserved','Booked'][i%3], tag_code:['HOLD','RESERVED','BOOKED'][i%3],
                tag:['On Hold','Reserved','Booked'][i%3], tag_code:['HOLD','RESERVED','BOOKED'][i%3],
                booked_by:'Rashid Manzoor', client_name:(i%4===0)?null:'Buyer '+(i+1),
                reserved_at:new Date(Date.now()-(3+i)*864e5).toISOString(),
                expiry_date:new Date(Date.now()+hrs*36e5).toISOString(),
                overdue:hrs<0, days_left:Math.max(0,Math.ceil(hrs/24)),
                hours_left:Math.max(0,Math.round(hrs)) });
            }
          }
            /* The first four holds ARE the day's own bookings: same unit numbers
               as the reserved stubs, flagged the way the RPC flags them. Without
               this the two lists never intersect and the de-duplication check
               passes while doing nothing. */
            HOLD.slice(0,4).forEach(function(h,k){
              h.booked_today = true;
              h.unit_no = d.reserved[k].unit_no;
              h.floor   = d.reserved[k].floor;
            });
          d.holding = HOLD;
          d.generated_at = new Date().toISOString();
        }
        return window._dbPreview(d, d.date);
      }, dateISO, pad || 0, AWAMI);

      if (grey) await page.evaluate(()=>{ document.getElementById('rd-print').style.filter='grayscale(1)'; });
      const files = [];
      for (let i = 0; i < n; i++) {
        const el = (await page.$$('#rd-print .rd-pg'))[i];
        const f = path.join(OUT, tag + '-p' + (i+1) + '.png');
        await el.screenshot({ path: f });
        files.push(path.basename(f));
      }
      if (grey) await page.evaluate(()=>{ document.getElementById('rd-print').style.filter=''; });
      console.log('  ' + tag.padEnd(22) + n + ' page(s)  ' + files.join('  '));
      return n;
    }

    console.log('\n\u2500\u2500 Renders');
    await shot('01-with-activity', '2026-09-07', 0, false);
    await shot('02-empty-day',     '2026-09-06', 0, false);
    await shot('03-page-break',    '2026-09-07', 40, false);
    await shot('04-greyscale',     '2026-09-07', 40, true);

    // structural checks on the padded render (the one with breaks)
    await page.evaluate(async (AWAMI) => {
      const r = await sb.rpc('get_reservation_daybook',
        { p_session_token: TOKEN, p_date: '2026-09-07', p_project_id: AWAMI });
      const d = r.data;
      const names=['Nimra Khan','Malik Sikandar','Muhammad Saeed','IQRA','Salman Sajjad','Naseer khan'];
      const floors=['Lower Ground','Ground Floor','First Floor','Second Floor','Third Floor'];
      const base=(d.reserved&&d.reserved[0])||{};
      d.reserved=[];
      for(let i=0;i<40;i++){ const c=JSON.parse(JSON.stringify(base));
        c.unit_no=floors[i%5].split(' ')[0].slice(0,2).toUpperCase()+'-'+String(i+1).padStart(2,'0');
        c.floor=floors[i%5]; c.requested_by=names[i%names.length];
        c.agent_code='AGT-2026-'+String(1+(i%40)).padStart(4,'0');
        c.client_name=(i%3===0)?null:'Buyer '+(i+1);
        const TG=[['On Hold','HOLD'],['Reserved','RESERVED'],['Booked','BOOKED']];
        const tg=TG[i%3];
        c.tag=tg[0]; c.tag_code=tg[1];
        c.status=(i%9===4)?'cancelled':'active';
        c.cancelled_at=(i%9===4)?new Date(Date.now()-36e5).toISOString():null;
        d.reserved.push(c); }
      d.expiring=d.reserved.slice(0,6).map((x,i)=>({unit_no:x.unit_no,floor:x.floor,
        requested_by:x.requested_by,hours_left:6+i*4,
        expiry_date:new Date(Date.now()+(6+i*4)*36e5).toISOString()}));
      const HOLD=[]; {
        const hn=['Nimra Khan','Malik Sikandar','Fawad khan','IQRA','Fawad khan','Naseer khan'];
        for(let i=0;i<18;i++){
          const hrs = i===0 ? -30 : (i<4 ? 6+i*9 : (i<9 ? 30+i*22 : 200+i*60));
          HOLD.push({ unit_no:floors[i%5].split(' ')[0].slice(0,2).toUpperCase()+'-'+String(80+i),
            floor:floors[i%5], area:900+i*115, area_unit:'sqft', price:12500000+i*640000,
            requested_by:hn[i%hn.length], agent_code:'AGT-2026-'+String(11+i).padStart(4,'0'),
            tag:['On Hold','Reserved','Booked'][i%3], tag_code:['HOLD','RESERVED','BOOKED'][i%3],
            booked_by:'Rashid Manzoor', client_name:(i%4===0)?null:'Buyer '+(i+1),
            reserved_at:new Date(Date.now()-(3+i)*864e5).toISOString(),
            expiry_date:new Date(Date.now()+hrs*36e5).toISOString(),
            overdue:hrs<0, days_left:Math.max(0,Math.ceil(hrs/24)),
            hours_left:Math.max(0,Math.round(hrs)) });
        }
      }
      /* The first four holds ARE the day's own bookings: same unit numbers
         as the reserved stubs, flagged the way the RPC flags them. Without
         this the two lists never intersect and the de-duplication check
         passes while doing nothing. */
      HOLD.slice(0,4).forEach(function(h,k){
        h.booked_today = true;
        h.unit_no = d.reserved[k].unit_no;
        h.floor   = d.reserved[k].floor;
      });
      d.holding = HOLD;
      d.generated_at = new Date().toISOString();
      window._dbPreview(d, d.date);
    }, AWAMI);
    const chk = await page.evaluate(() => {
      const pgs=[...document.querySelectorAll('#rd-print .rd-pg')];
      const foot=pgs.map(p=>(p.querySelector('.ft')||{}).textContent||'');
      const heads=pgs.map(p=>!!p.querySelector('.rh'));
      const orphan=pgs.some(p=>{ const b=p.querySelector('.pg-body'); if(!b) return false;
        const last=b.lastElementChild; return !!(last && last.classList.contains('sec') &&
          last.querySelector('h2') && !last.querySelector('tbody tr') && !last.querySelector('.none')); });
      // does any content actually collide with the footer rule?
      const clash=pgs.map((p,i)=>{
        const col=p.querySelector('.col'), ft=p.querySelector('.ft');
        if(!col||!ft) return null;
        const last=col.lastElementChild; if(!last) return null;
        const gap=Math.round((ft.getBoundingClientRect().top-last.getBoundingClientRect().bottom));
        return {page:i+1, gapPx:gap};
      }).filter(x=>x && x.gapPx < 0);
      const overflow=pgs.some(p=>{ const c=p.querySelector('.col');
        return c && c.getBoundingClientRect().bottom > p.getBoundingClientRect().bottom + 1; });
      // sideways: a nowrap table that does not fit is silently cropped on paper
      const wide=[];
      pgs.forEach((p,i)=>{
        p.querySelectorAll('table').forEach(t=>{
          const col=t.closest('.col'); if(!col) return;
          const over=Math.round(t.scrollWidth - col.clientWidth);
          if(over>1) wide.push({page:i+1, overPx:over,
            head:[...t.querySelectorAll('thead th')].map(h=>h.textContent.trim()).join('|')});
        });
      });
      // a page that carries table ROWS must carry a header for them. There is no
      // longer a signature page, so every page here holds either rows or the
      // summary block, and only the former needs a thead.
      const bodyRows=pgs.map(p=>p.querySelectorAll('tbody tr').length);
      const theads=pgs.map(p=>p.querySelectorAll('thead').length);
      const headless=pgs.map((p,i)=>({i:i+1,rows:bodyRows[i],heads:theads[i]}))
                        .filter(x=>x.rows>0 && x.heads===0);
      const sig=pgs.filter(p=>p.querySelector('.sig')).length;
      const txt=pgs.map(p=>p.textContent||'').join(' ');
      // the hold section, by its heading, and how many rows it printed
      const heads2=[...document.querySelectorAll('#rd-print .sec-t')].map(e=>e.textContent.trim());
      const holdIdx=heads2.indexOf('Held From Before');
      // rows in the printed day list, to compare against the stub's live count
      const bookIdx=heads2.indexOf('Booked Today');
      let holdRows=0, holdNote='';
      if (holdIdx>=0) {
        const hd=[...document.querySelectorAll('#rd-print .sec-t')][holdIdx].closest('.sec-h');
        holdNote=(hd.parentElement.querySelector('.sec-note')||{}).textContent||'';
        // Document order, not sibling order: a spilled section continues on the
        // next PAGE, so its rows are nowhere near the heading in the tree.
        const seq=[...document.querySelectorAll('#rd-print .sec-h, #rd-print tbody tr')];
        let cur=-1;
        for(const n of seq){
          if(n.classList.contains('sec-h')){
            const t=(n.querySelector('.sec-t')||{}).textContent||'';
            cur = heads2.indexOf(t.trim());
          } else if(cur===holdIdx && !n.classList.contains('tot')){ holdRows++; }
        }
      }
      return { n:pgs.length, foot, headsOnP1:heads[0], headsRest:heads.slice(1).every(Boolean),
               orphan, overflow, wide, clash, theads, bodyRows, headless, sigPages:sig,
               prepared: /Prepared by|Approved by/.test(txt),
               secTitles: heads2, holdIdx, holdRows, holdNote, bookIdx,
               // unit numbers printed under each of the two lists, in order
               unitsBy: (function () {
                 const out = {};
                 const seq = [...document.querySelectorAll('#rd-print .sec-h, #rd-print tbody tr')];
                 let cur = null;
                 for (const x of seq) {
                   if (x.classList.contains('sec-h')) {
                     cur = ((x.querySelector('.sec-t') || {}).textContent || '').trim();
                     out[cur] = out[cur] || [];
                   } else if (cur && !x.classList.contains('tot') && x.cells.length) {
                     out[cur].push(x.cells[0].textContent.trim());
                   }
                 }
                 return out;
               })(),
               bookRows: (function(){
                 if(bookIdx<0) return 0;
                 const seq=[...document.querySelectorAll('#rd-print .sec-h, #rd-print tbody tr')];
                 let cur=-1,n=0;
                 for(const x of seq){
                   if(x.classList.contains('sec-h')){
                     cur=heads2.indexOf(((x.querySelector('.sec-t')||{}).textContent||'').trim());
                   } else if(cur===bookIdx && !x.classList.contains('tot')) n++;
                 }
                 return n;
               })(),
               };
    });
    /* \u2550\u2550 SEMANTIC \u2550\u2550 The masthead names a project; every floor in the position
       table must belong to THAT project, and the KPI cards must equal the floor
       table's totals. This is the check that would have caught the three-tower
       report, whose numbers were internally consistent and simply were not this
       project's. The floor set is read from the database, not from the page. */
    console.log('\n\u2500\u2500 Semantics \u2014 the page must be about ONE project');
    const sem = await page.evaluate(async (AW) => {
      const r = await sb.rpc('get_reservation_daybook',
        { p_session_token: TOKEN, p_date: '2026-09-07', p_project_id: AW });
      window._dbPreview(r.data, r.data.date);
      const p1 = document.querySelector('#rd-print .rd-pg');
      // Collect the floor section's rows wherever they landed: a spilled section
      // continues on the next PAGE, so its rows are not siblings of its heading.
      const titles = [...document.querySelectorAll('#rd-print .sec-t')].map(e => e.textContent.trim());
      const fIdx = titles.indexOf('Floor-wise Position');
      const seq = [...document.querySelectorAll('#rd-print .sec-h, #rd-print tbody tr')];
      const rows = [];
      let cur = -1;
      for (const n of seq) {
        if (n.classList.contains('sec-h')) {
          cur = titles.indexOf(((n.querySelector('.sec-t') || {}).textContent || '').trim());
        } else if (cur === fIdx && fIdx >= 0) rows.push(n);
      }
      const tot = rows.find(t => t.classList.contains('tot'));
      const N = s => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;
      // the summary is a line of figures now, not four cards
      const kpi = [...p1.querySelectorAll('.sum-r')][0]
                    ? [...p1.querySelectorAll('.sum-r')][0].querySelectorAll('.sum-i')
                    : [];
      const sumv = [...kpi].map(c => N(c.querySelector('.v').textContent));
      return {
        proj: (p1.querySelector('.mh-proj') || {}).textContent.trim(),
        floors: rows.filter(t => !t.classList.contains('tot')).map(t => t.cells[0].textContent.trim()),
        kpi: { total: sumv[0], sold: sumv[1], res: sumv[2], av: sumv[3] },
        // Read the total row BY ITS HEADER, not by a remembered index. The
        // column order changed once already and an index-based reader would
        // have gone on comparing the wrong two numbers without saying so.
        tbl: (function () {
          const hs = [...document.querySelectorAll('#rd-print table')]
                       .map(t => [...t.querySelectorAll('thead th')].map(h => h.textContent.trim()))
                       .find(h => h[0] === 'Floor') || [];
          const at = name => { const i = hs.indexOf(name);
                               return i < 0 ? null : N(tot.cells[i].textContent); };
          return { cols: hs, hold: at('On hold'), res: at('Reserved'), booked: at('Booked'),
                   sold: at('Sold'), other: at('Other'), av: at('Available'), total: at('Total') };
        })(),
        // how much of the page the summary block eats
        sumMM: (function () {
          const blocks = p1.querySelectorAll('.col > div');
          const first = blocks[0];
          if (!first) return null;
          const r = first.getBoundingClientRect();
          const probe = document.createElement('div');
          probe.style.cssText = 'position:absolute;visibility:hidden;width:100mm';
          document.body.appendChild(probe);
          const mm = probe.getBoundingClientRect().width / 100;
          document.body.removeChild(probe);
          return { h: Math.round(r.height / mm), pageH: 297 };
        })(),
        // nothing above 13pt except the masthead title
        oversize: (function () {
          const bad = [];
          p1.querySelectorAll('*').forEach(function (el) {
            if (!el.textContent || !el.textContent.trim()) return;
            if (el.children.length) return;             // leaf nodes only
            const pt = parseFloat(getComputedStyle(el).fontSize) * 72 / 96;
            if (pt > 13.05 && !el.classList.contains('mh-t')) {
              bad.push(el.className + ' ' + pt.toFixed(1) + 'pt: ' +
                       el.textContent.trim().slice(0, 24));
            }
          });
          return bad;
        })()
      };
    }, AWAMI);
    const dbFloors = await sql(`select distinct coalesce(nullif(floor_label,''),'-') f
                                  from public.units where project_id='${AWAMI}';`);
    const allowed = new Set(dbFloors.map(r => r.f));
    const stray = sem.floors.filter(f => !allowed.has(f));
    const okS = m => console.log('  \u2705 ' + m);
    const badS = m => { console.log('  \u274C ' + m); SEMFAIL = true; };
    sem.proj === 'AWAMI MARKET' ? okS('masthead names the project: ' + sem.proj)
                                : badS('masthead says ' + JSON.stringify(sem.proj));
    stray.length === 0 ? okS(sem.floors.length + ' floor rows, every one belongs to that project')
                       : badS('floors from another project: ' + stray.join(', '));
    sem.floors.length === allowed.size
      ? okS("all " + allowed.size + " of the project's floors are present")
      : badS(sem.floors.length + ' floors shown, the project has ' + allowed.size);
    /* The position line says Held, which is the three hold columns added up. */
    (sem.kpi.total === sem.tbl.total && sem.kpi.sold === sem.tbl.sold &&
     sem.kpi.res === (sem.tbl.hold + sem.tbl.res + sem.tbl.booked) &&
     sem.kpi.av === sem.tbl.av)
      ? okS('the position line equals the floor table (' + sem.kpi.total + ' = ' + sem.tbl.total +
            ', held ' + sem.kpi.res + ')')
      : badS('position line vs table mismatch: ' + JSON.stringify({kpi: sem.kpi, tbl: sem.tbl}));
    /* THE ARITHMETIC MUST CLOSE. This used to read sold + reserved + available
       and it held only because three states were all the table could show. The
       night the desk learned to stamp On Hold and Booked, a unit fell out of
       every column and Awami printed 1,467 total over 0 + 0 + 1,466 — this
       check would have caught it, and now it covers every column the table has
       rather than the three it used to have. */
    {
      const t = sem.tbl;
      const parts = ['hold','res','booked','sold','other','av']
                      .filter(k => t[k] !== null && t[k] !== undefined);
      const sum = parts.reduce((a, k) => a + t[k], 0);
      sum === t.total
        ? okS(parts.join(' + ') + ' = total (' + sum + ')')
        : badS('the floor table loses units: ' + parts.join('+') + ' = ' + sum +
               ' but total = ' + t.total + '  ' + JSON.stringify(t));
      ['On hold','Reserved','Booked','Sold','Available','Total'].every(c => t.cols.indexOf(c) >= 0)
        ? okS('every state has its own column: ' + t.cols.join(' · '))
        : badS('a state has no column of its own: ' + JSON.stringify(t.cols));
    }
    sem.sumMM && sem.sumMM.h <= 297 / 4
      ? okS('summary block is ' + sem.sumMM.h + 'mm — under a quarter of the page (74mm)')
      : badS('summary block is ' + (sem.sumMM && sem.sumMM.h) + 'mm, over a quarter of the page');
    sem.oversize.length === 0
      ? okS('no element above 13pt except the masthead title')
      : badS('type above 13pt: ' + sem.oversize.join(' | '));

    console.log('\n\u2500\u2500 Structure (padded render)');
    const ok=m=>console.log('  \u2705 '+m), bad=m=>{console.log('  \u274C '+m); FAILED=true;};
    chk.n>1 ? ok(chk.n+' pages — breaks exercised') : bad('only '+chk.n+' page, no break to test');
    chk.headsOnP1===false ? ok('no running header on page 1') : bad('running header leaked onto page 1');
    chk.headsRest ? ok('running header on every page after the first') : bad('a later page has no running header');
    chk.foot.every((f,i)=>f.indexOf('Page '+(i+1)+' of '+chk.n)>-1)
      ? ok('footer numbering correct: '+JSON.stringify(chk.foot[chk.foot.length-1])) : bad('footer numbering wrong: '+JSON.stringify(chk.foot));
    chk.headless.length===0 ? ok('every page with rows carries a header (rows '+chk.bodyRows.join(',')+' / heads '+chk.theads.join(',')+')') : bad('page(s) carry rows with no header: '+JSON.stringify(chk.headless));
    !chk.orphan ? ok('no section heading stranded without rows') : bad('an orphaned section heading');
    !chk.overflow ? ok('no page overflows its 297mm box') : bad('content spills past the page box');
    chk.wide.length===0
      ? ok('no table is wider than its column — nothing is cropped off the right edge')
      : bad('table(s) run past the page width: ' + JSON.stringify(chk.wide));
    chk.clash.length===0 ? ok('nothing collides with the footer rule')
                         : bad('content runs into the footer: '+JSON.stringify(chk.clash));
    /* The signature block was REMOVED, so both the element and the words have to
       be gone. Asserted two ways because a class can be renamed and the text
       survive, or the text be dropped and an empty block remain. */
    chk.sigPages===0 ? ok('no signature block on any page')
                     : bad('a .sig block is still rendered on ' + chk.sigPages + ' page(s)');
    !chk.prepared ? ok('the words "Prepared by" / "Approved by" appear nowhere')
                  : bad('the report still says Prepared by / Approved by');

    /* The hold list. 18 stub rows go in; 18 rows have to come out, or the
       section is silently dropping units \u2014 which is the failure that matters,
       since a unit missing from this page reads as available. */
    chk.holdIdx>=0 ? ok('"Held From Before" section present, at position ' + (chk.holdIdx+1))
                   : bad('no "Held From Before" section: ' + JSON.stringify(chk.secTitles));
    /* 18 holds go in, 4 of them flagged as booked on the day being reported and
       already listed above. 14 must print here, and NONE of the four. */
    chk.holdRows===14 ? ok("14 of 18 holds printed \u2014 the 4 booked today are not repeated")
                      : bad('the earlier-holds list printed ' + chk.holdRows + ' rows; 14 were held from before');
    {
      /* THE COMPLAINT, ASSERTED. Three bookings printed as six because both
         sections were right about the same rows. No unit may appear in both. */
      const a = chk.unitsBy['Booked Today'] || [];
      const b = chk.unitsBy['Held From Before'] || [];
      const both = a.filter(u => b.indexOf(u) >= 0);
      (a.length && b.length && both.length === 0)
        ? ok('no unit is printed in both lists (' + a.length + ' booked today, ' + b.length + ' held from earlier)')
        : bad(both.length ? 'printed twice: ' + both.join(', ')
                          : 'one of the two lists is empty, so this proved nothing: ' +
                            JSON.stringify({ bookedToday: a.length, earlier: b.length }));
    }
    /* THE CLIENT FILTER, EXERCISED. The stub feeds 40 bookings of which 4 are
       cancelled — a payload the live RPC will no longer produce, which is
       exactly the point: if an older RPC is still deployed somewhere, the page
       must still refuse to draw them. 36 rows, or the second filter is dead. */
    chk.bookRows===36
      ? ok('36 of 40 stub bookings printed — the 4 cancelled ones were dropped client-side too')
      : bad("today's list printed " + chk.bookRows + ' rows; 36 of the 40 stubs are active');
    /* The note must carry BOTH the moment it was read and the fact that the
       day's own bookings are elsewhere - that second half is the whole reason
       this section is narrower than the payload. */
    (/^As at /.test(chk.holdNote) && /still held from before/.test(chk.holdNote) &&
     /inside the period are in 01/.test(chk.holdNote))
      ? ok('the note says as-at, and says where today’s bookings are: ' + chk.holdNote.slice(0,64))
      : bad('the earlier-holds note is wrong or missing: ' + JSON.stringify(chk.holdNote));
    chk.secTitles.indexOf('Expiring Within 48 Hours')<0
      ? ok('the 48-hour section is folded in, so no unit prints twice')
      : bad('both "Expiring Within 48 Hours" and the hold list are on the page');

    /* ══ BACKGROUND GRAPHICS OFF ══ The design is carried by its backgrounds, so
       this renders a real PDF with printBackground:false — the programmatic
       equivalent of unchecking "Background graphics" — and reopens it in Chrome's
       own viewer to photograph what actually comes out. */
    console.log('\n── Print with Background graphics OFF');
    await page.evaluate(async (AWAMI) => {
      const r = await sb.rpc('get_reservation_daybook',
        { p_session_token: TOKEN, p_date: '2026-09-07', p_project_id: AWAMI });
      window._dbPreview(r.data, r.data.date);
      document.getElementById('rd-print').className = '';   // print layout, not preview
    }, AWAMI);
    /* The footer says "Page 1 of N" from the JS pagination. If Chrome's own
       pagination disagrees, that footer is a lie on paper — so the PDF is
       produced whole and its page count compared against ours. */
    const jsPages = await page.evaluate(() => document.querySelectorAll('#rd-print .rd-pg').length);
    const pdfPath = path.join(OUT, '05-nobg.pdf');
    await page.pdf({ path: pdfPath, width: '210mm', height: '297mm',
                     printBackground: false, margin: {top:0,right:0,bottom:0,left:0} });
    /* Read the count with pdf-lib (already vendored) rather than by grepping the
       file: a PDF's page objects live in compressed object streams, so a text
       search finds nothing and reports zero pages very convincingly. */
    const { PDFDocument } = require(path.join(ROOT, 'vendor', 'pdf-lib.min.js'));
    const pdfPages = (await PDFDocument.load(fs.readFileSync(pdfPath))).getPageCount();
    if (pdfPages === jsPages) {
      console.log('  ✅ Chrome paginates it the same way we do (' + pdfPages +
                  ' pages) — the footer count is true on paper');
    } else {
      console.log('  ❌ the printed PDF has ' + pdfPages +
                  ' pages but the footer claims ' + jsPages);
      FAILED = true;
    }
    const pv = await browser.newPage();
    await pv.setViewport({ width: 900, height: 1300, deviceScaleFactor: 2 });
    await pv.goto('file:///' + pdfPath.split(path.sep).join('/'), { waitUntil: 'networkidle2' });
    await sleep(3000);
    await pv.screenshot({ path: path.join(OUT, '05-print-nobg-p1.png') });
    await pv.close();
    console.log('  rendered 05-print-nobg-p1.png from a printBackground:false PDF');

    const real=errs.filter(e=>!/favicon|manifest|404|Not Found/i.test(e));
    real.length===0 ? ok('no console errors') : bad('console: '+real.slice(0,3).join(' | '));
    // a semantic failure must fail the run too, or the check is decoration
    const BAD = FAILED || SEMFAIL;
    console.log('\n' + (BAD ? '\u274C SOMETHING IS WRONG' : '\u2705 ALL CHECKS OK') + '  \u2192 ' + OUT);
    process.exitCode = BAD ? 1 : 0;
  } finally {
    await browser.close(); server.close();
    await sql(`delete from public.sales_sessions where session_token='${TOK}';`);
  }
})().catch(e=>{ console.error('DRIVER ERROR:', e); process.exit(2); });
