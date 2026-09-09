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

      /* Today must NOT be empty, or the check above proved nothing. Measured on
         MOVEMENT, not on what survived: a day can have five bookings and end
         with none still held, and it is still a day the range test can fail on.
         The first version asked h_close and went red the moment Rashid cancelled
         the last hold — the assertion was wrong, not the report. */
      const moved = t ? (t.h_add + t.h_rem + (t.s_close - 0)) : 0;
      (t && moved > 0)
        ? okP('today had movement (' + t.h_add + ' taken, ' + t.h_rem + ' released), so that check could have failed')
        : badP('nothing at all happened today either, so the edge test proved nothing');

      /* And the old single-date call still means a one-day period. */
      (l && l.one_day === true && t && l.h_close === t.h_close && l.n_booked === t.n_booked)
        ? okP('the old p_date call still returns exactly the same one-day report')
        : badP('p_date and an explicit one-day range disagree: ' + JSON.stringify({ legacy: l, today: t }));
    }

    console.log('\n\u2500\u2500 A booking survives its own tag');
    {
      const sayo0 = rows => (rows && rows[0]) || {};
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

      /* ══ A STATUS SAYS WHAT KIND OF THING IT IS ═══════════════════════════
         The desk used to know three tag codes by name. It now reads a NATURE
         off the statuses table, so a tenant can invent "Verbally Hold" and
         "Landowner" without a line of code changing. Two things have to be
         true for that to be worth having, and neither is visible on a screen:
         a permanent hold must carry NO expiry and survive the sweep that
         releases lapsed ones, and a custom tag must not be cancelled by the
         trigger that keeps units and reservations in step — which is exactly
         what happened the last time a tag was added.

         One transaction, rolled back. The statuses invented here never exist
         outside it. ════════════════════════════════════════════════════════ */
      const nat = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}',NULL,'nat_dir', now() + interval '2 minutes');
        /* a rep who may sell, to prove the director gate is a gate */
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', s.id, NULL, 'nat_rep', now() + interval '2 minutes'
          FROM public.sales_users s WHERE s.company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND s.role='sale_rep'
           AND s.status = 'active' LIMIT 1;

        INSERT INTO public.category_unit_statuses
          (company_id, project_id, status_code, status_name, color_hex, sort_order,
           is_active, is_available, nature, hold_days)
        VALUES
          ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZVERBAL','ZZ Verbally Hold','#f59e0b',90,true,false,'temporary',2),
          ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZLANDOWNER','ZZ Landowner','#8b5cf6',91,true,false,'permanent',NULL);

        CREATE TEMP TABLE nat_out ON COMMIT DROP AS
        WITH t AS (SELECT id, status_code, row_number() OVER (ORDER BY status_code) n
                     FROM public.category_unit_statuses
                    WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code IN ('ZZVERBAL','ZZLANDOWNER')),
             u AS (SELECT u.id, row_number() OVER (ORDER BY u.unit_no) n
                     FROM public.units u
                     JOIN public.category_unit_statuses st ON st.id=u.status_id
                    WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available)
        SELECT t.status_code AS code,
               public.reserve_unit_desk('nat_dir', u.id, NULL, NULL, 'Nature Probe',
                 NULL, NULL, 2, false, 0, NULL, t.id) AS r
          FROM t JOIN u ON u.n = t.n;

        SELECT o.code,
               (o.r->>'success')     AS ok,
               (o.r->>'error')       AS err,
               (o.r->>'nature')      AS nature,
               (o.r->>'expiry_days') AS days,
               res.status            AS res_status,
               (res.expiry_date IS NULL) AS no_expiry,
               upper(cus.status_code)    AS unit_now,
               /* would the hourly sweep let go of it? */
               COALESCE(res.status='active' AND res.expiry_date < now(), false) AS would_lapse,
               /* and would a rep have been allowed to do the same thing? */
               (public.reserve_unit_desk('nat_rep',
                  (SELECT u3.id FROM public.units u3
                     JOIN public.category_unit_statuses s3 ON s3.id=u3.status_id
                    WHERE u3.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND s3.is_available
                    ORDER BY u3.unit_no DESC LIMIT 1),
                  NULL,NULL,'Rep Probe',NULL,NULL,2,false,0,NULL,
                  (SELECT id FROM public.category_unit_statuses
                    WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code=o.code))->>'error') AS rep_err
          FROM nat_out o
          LEFT JOIN public.reservations res ON res.id = (o.r->>'reservation_id')::uuid
          LEFT JOIN public.units u2 ON u2.id = res.unit_id
          LEFT JOIN public.category_unit_statuses cus ON cus.id = u2.status_id
         ORDER BY o.code;
        ROLLBACK;`);

      const byCode = Object.fromEntries(nat.map(r => [r.code, r]));
      const perm = byCode.ZZLANDOWNER, temp = byCode.ZZVERBAL;

      (temp && temp.ok === 'true' && temp.res_status === 'active')
        ? okT('a tag this code has never heard of books a unit and the hold survives')
        : badT('a custom temporary tag did not book: ' + JSON.stringify(temp));
      (temp && temp.days === '2' && temp.no_expiry === false && temp.unit_now === 'ZZVERBAL')
        ? okT('and it holds for its own 2 days, with the unit carrying its own tag')
        : badT('the custom tag lost its duration or its stamp: ' + JSON.stringify(temp));

      (perm && perm.ok === 'true' && perm.res_status === 'active' && perm.no_expiry === true)
        ? okT('a permanent tag books with NO expiry date at all')
        : badT('the permanent tag did not take: ' + JSON.stringify(perm));
      (perm && perm.days === null && perm.unit_now === 'ZZLANDOWNER')
        ? okT('and it asks for no number of days — the unit is simply off the market')
        : badT('a permanent hold came back with a duration: ' + JSON.stringify(perm));
      (perm && perm.would_lapse === false)
        ? okT('the hourly sweep would not release it: nothing to compare against now()')
        : badT('a permanent hold is in reach of cron_expire_reservations');

      /* THE GATE IS A GATE, not a hidden button. The screen only offers
         permanent to a director; this is the half that would still be true if
         somebody called the RPC directly. */
      (perm && perm.rep_err === 'director_only')
        ? okT('a sale rep calling the RPC directly is refused the permanent tag')
        : badT('a rep was allowed to take a unit off the market for good: ' +
               JSON.stringify(perm && perm.rep_err));
      (temp && temp.rep_err === null)
        ? okT('and the same rep can still apply a temporary one')
        : badT('the director gate caught a temporary tag too: ' +
               JSON.stringify(temp && temp.rep_err));

      /* ── WHAT THE DAYBOOK DOES WITH A HOLD THAT NEVER ENDS ─────────────
         Seven filters in that function read "expiry_date >= x", and NULL >=
         anything is NULL, so before this a permanent hold would have been
         absent from the page entirely: the unit off the market and nothing
         anywhere saying why. */
      /* Two of them: one booked now, which belongs in today's list, and one
         backdated to last week, which is the case the NULL filters actually
         guard — a permanent hold taken days ago and still standing. The
         second is the one that would have vanished. */
      const seen = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}',NULL,'nat_dir2', now() + interval '2 minutes');
        INSERT INTO public.category_unit_statuses
          (company_id, project_id, status_code, status_name, color_hex, sort_order,
           is_active, is_available, nature, hold_days)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZLANDOWNER','ZZ Landowner','#8b5cf6',91,true,false,'permanent',NULL);
        SELECT public.reserve_unit_desk('nat_dir2', u.id,
                 NULL,NULL,'Nature Probe',NULL,NULL,2,false,0,NULL,
                 (SELECT id FROM public.category_unit_statuses
                   WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9'
                     AND status_code='ZZLANDOWNER'))
          FROM (SELECT u.id, row_number() OVER (ORDER BY u.unit_no) n
                  FROM public.units u
                  JOIN public.category_unit_statuses st ON st.id=u.status_id
                 WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9'
                   AND st.is_available) u
         WHERE u.n <= 2;

        /* Backdate ONE of them. A hold taken last week and never expiring is
           the row every "expiry_date >= start of period" filter would have
           dropped, and it is the whole reason those seven lines changed. */
        UPDATE public.reservations SET created_at = now() - interval '7 days'
         WHERE requested_by_name = 'Nature Probe'
           AND id = (SELECT id FROM public.reservations
                      WHERE requested_by_name = 'Nature Probe'
                      ORDER BY created_at DESC LIMIT 1);
        WITH d AS (SELECT public.get_reservation_daybook(
                     'nat_dir2', NULL, '59ded55b-9bc2-45b2-a372-49fc31807fa9') AS j),
             hold AS (SELECT x FROM d, jsonb_array_elements(d.j->'holding') x
                       WHERE x->>'requested_by' = 'Nature Probe'),
             today AS (SELECT x FROM d, jsonb_array_elements(d.j->'reserved') x
                        WHERE x->>'requested_by' = 'Nature Probe')
        SELECT (SELECT count(*)::int FROM hold)  AS on_page,
               (SELECT count(*)::int FROM today) AS booked_today,
               (SELECT x->>'permanent' FROM hold LIMIT 1) AS flagged,
               (SELECT x->'days_left'  FROM hold LIMIT 1) AS days_left,
               (SELECT x->'overdue'    FROM hold LIMIT 1) AS overdue,
               (SELECT count(*)::int FROM d, jsonb_array_elements(d.j->'expiring') e
                 WHERE e->>'requested_by' = 'Nature Probe') AS in_expiring;
        ROLLBACK;`);
      const d0 = seen[0] || {};
      Number(d0.on_page) === 1
        ? okT('a permanent hold taken last week is still on the daybook a week later')
        : badT('a permanent hold is missing from the standing list: ' + JSON.stringify(d0));
      Number(d0.booked_today) === 1
        ? okT('and one taken today is in today’s list — each appears once, in one place')
        : badT('the permanent hold taken today is not in the day’s list: ' + JSON.stringify(d0));
      (d0.flagged === 'true' && d0.days_left === null && d0.overdue === false)
        ? okT('marked permanent, no days-left, and not overdue — not "0 days", which reads as today')
        : badT('the daybook describes it wrongly: ' + JSON.stringify(d0));
      Number(d0.in_expiring) === 0
        ? okT('and it never appears in “expiring within 48 hours”, because it does not')
        : badT('a hold with no end date is listed as expiring soon');

      /* ── WHAT CANNOT BE GIVEN A NATURE ─────────────────────────────────
         Sold and its relatives are produced by the sales module and read by
         the register, the receivables and the commission report. A unit the
         desk had stamped Sold would appear in none of them. */
      const refused = await sql(`
        BEGIN;
        SELECT set_config('request.jwt.claims',
          json_build_object('sub', (SELECT auth_user_id::text FROM public.app_users
             WHERE company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND auth_user_id IS NOT NULL LIMIT 1),
            'role','authenticated')::text, true);
        SELECT
          (public.upsert_unit_status('96d210e7-e63b-4ef0-b1d0-74e622eac7ce',
             jsonb_build_object('nature','permanent'),
             (SELECT id FROM public.category_unit_statuses
               WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='SOLD'))->>'error') AS sold_err,
          (public.upsert_unit_status('96d210e7-e63b-4ef0-b1d0-74e622eac7ce',
             jsonb_build_object('nature','temporary'),
             (SELECT id FROM public.category_unit_statuses
               WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='AVAILABLE'))->>'error') AS avail_err,
          (public.upsert_unit_status('96d210e7-e63b-4ef0-b1d0-74e622eac7ce',
             jsonb_build_object('nature','whenever'),
             (SELECT id FROM public.category_unit_statuses
               WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='HOLD'))->>'error') AS junk_err;
        ROLLBACK;`);
      const rf = refused[0] || {};
      rf.sold_err === 'reserved_code'
        ? okT('SOLD cannot be turned into a desk tag — only a sale writes it')
        : badT('SOLD accepted a nature: ' + JSON.stringify(rf));
      (rf.avail_err === 'sellable_has_no_nature' || rf.avail_err === 'reserved_code')
        ? okT('and a sellable status cannot also be a way of holding a unit')
        : badT('a bookable status accepted a nature: ' + JSON.stringify(rf));
      rf.junk_err === 'bad_nature'
        ? okT('a nature the system does not have is refused rather than stored')
        : badT('an invented nature was accepted: ' + JSON.stringify(rf));

      /* Publication may only sit on a status the desk can apply, and a check
         constraint holds that. The Categories form does not send the flag at
         all, so clearing a nature there would have left it standing and the
         save would have failed on a constraint message nobody editing a form
         could act on. The flag follows the nature down instead. */
      const unpub = await sql(`
        BEGIN;
        SELECT set_config('request.jwt.claims',
          json_build_object('sub',(SELECT auth_user_id::text FROM public.app_users
                                    WHERE company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce'
                                      AND auth_user_id IS NOT NULL LIMIT 1),
            'role','authenticated')::text, true);
        CREATE TEMP TABLE up1 ON COMMIT DROP AS
          SELECT public.upsert_unit_status(
            '96d210e7-e63b-4ef0-b1d0-74e622eac7ce',
            jsonb_build_object('nature','none'),
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9'
                AND status_code='HOLD')) AS r;
        SELECT (SELECT r->>'success' FROM up1) AS saved,
               nature IS NULL AS nature_cleared, public_choice AS still_published
          FROM public.category_unit_statuses
         WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='HOLD';
        ROLLBACK;`);
      const up = (unpub && unpub[0]) || {};
      (up.saved === 'true' && up.nature_cleared === true && up.still_published === false)
        ? okT('and taking a nature away unpublishes it from the link, rather than failing the save')
        : badT('clearing a nature left it published: ' + JSON.stringify(up));

      const leftNat = Number((await sql(`select count(*)::int n
          from public.category_unit_statuses
         where status_code like 'ZZ%';`))[0].n);
      leftNat === 0
        ? okT('and the invented statuses rolled back — none on Awami')
        : badT(leftNat + ' invented status(es) were left on a live tenant');

      /* ══ AND THE HOLD LETS GO WHEN THE UNIT SELLS ════════════════════════
         The whole point of "Sold - Entry Pending" is that the real sale is
         entered later. The daybook used to ask whether THIS reservation was
         converted into a sale, which only the portal's own submit-and-approve
         path ever sets — so a sale entered in RMS beside the hold left that
         hold standing on the page for good.

         Told as a story, in one rolled-back transaction: hold it, wait three
         days, sell it. Then look at the same page again. ═════════════════ */
      const handoff = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_handoff', now() + interval '2 minutes');
        INSERT INTO public.category_unit_statuses
          (company_id, project_id, status_code, status_name, color_hex, sort_order,
           is_active, is_available, nature, hold_days)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZPEND','ZZ Sold - Entry Pending','#7e22ce',95,true,false,'permanent',NULL);

        CREATE TEMP TABLE ho_unit ON COMMIT DROP AS
          SELECT u.id FROM public.units u
            JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
           ORDER BY u.unit_no LIMIT 1;

        SELECT public.reserve_unit_desk('dbshot_handoff',(SELECT id FROM ho_unit),
          NULL,NULL,'Handoff Probe',NULL,NULL,7,false,0,NULL,
          (SELECT id FROM public.category_unit_statuses
            WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='ZZPEND'));

        /* taken three days ago, so it belongs to the STANDING list */
        UPDATE public.reservations SET created_at = now() - interval '3 days'
         WHERE requested_by_name='Handoff Probe';

        CREATE TEMP TABLE ho_before ON COMMIT DROP AS
          SELECT (SELECT count(*)::int FROM jsonb_array_elements(
             public.get_reservation_daybook('dbshot_handoff',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'holding') x
            WHERE x->>'requested_by'='Handoff Probe') AS n;

        /* and now somebody enters the sale in RMS, the way they actually do */
        INSERT INTO public.clients (company_id, project_id, full_name, client_code, phone_primary)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZ Handoff Buyer','ZZ-HO-1','0000000000');
        INSERT INTO public.sales (company_id, project_id, unit_id, client_id, sale_number, sale_date, status)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9', (SELECT id FROM ho_unit),
               (SELECT id FROM public.clients WHERE client_code='ZZ-HO-1'),
               'ZZ-HANDOFF-1', current_date, 'active';
        UPDATE public.units SET status_id=(SELECT id FROM public.category_unit_statuses
          WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='SOLD')
         WHERE id=(SELECT id FROM ho_unit);

        SELECT (SELECT n FROM ho_before) AS before_sale,
               (SELECT count(*)::int FROM jsonb_array_elements(
                  public.get_reservation_daybook('dbshot_handoff',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'holding') x
                 WHERE x->>'requested_by'='Handoff Probe') AS after_sale,
               (SELECT count(*)::int FROM jsonb_array_elements(
                  public.get_reservation_daybook('dbshot_handoff',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'released') x
                 WHERE x->>'requested_by'='Handoff Probe') AS in_released,
               (SELECT x->>'went' FROM jsonb_array_elements(
                  public.get_reservation_daybook('dbshot_handoff',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'released') x
                 WHERE x->>'requested_by'='Handoff Probe' LIMIT 1) AS went,
               public._map_unit_state((SELECT id FROM ho_unit)) AS unit_state;
        ROLLBACK;`);
      const h0 = handoff[0] || {};

      Number(h0.before_sale) === 1
        ? okT('a permanent hold taken three days ago is on the standing list')
        : badT('the hold was not on the list to begin with \u2014 this check is inert: ' +
               JSON.stringify(h0));
      h0.unit_state === 'sold'
        ? okT('and once the sale is entered the unit really does read as sold')
        : badT('entering the sale did not make the unit sold: ' + JSON.stringify(h0));
      Number(h0.after_sale) === 0
        ? okT('so the hold lets go \u2014 it is off the standing list, not stranded there for good')
        : badT('the hold outlived the sale it was standing in for: ' + JSON.stringify(h0));
      (Number(h0.in_released) === 1 && h0.went === 'sold')
        ? okT('and it is accounted for as released BECAUSE SOLD, not written off as lapsed')
        : badT('the released list tells the wrong story: ' + JSON.stringify(h0));

      const leftHo = Number((await sql(`select count(*)::int n from public.sales
                                         where sale_number='ZZ-HANDOFF-1';`))[0].n);
      leftHo === 0
        ? okT('and the probe sale rolled back \u2014 no invented sale on Awami')
        : badT(leftHo + ' probe sale(s) were left on a live tenant');

      /* ══ ONE UNIT, ONE SALE ══════════════════════════════════════════════
         The point of marking a unit "Sold - Entry Pending" is that nobody
         sells it again while the real sale is still to be entered. Checking
         that turned up something older: the sale function looked at the
         client, the agent and the arithmetic, and never once at the unit. The
         same unit took two sales in a row here before this was fixed.

         Four things have to be true at once, and they pull against each
         other: a second sale must be refused, the FIRST one must still go
         through on a held unit (or Rashid cannot enter his own sale), a
         cancelled sale must not block a fresh one, and the status a sale
         stamps must never be the hold. ══════════════════════════════════ */
      const onesale = await sql(`
        BEGIN;
        SELECT set_config('request.jwt.claims',
          json_build_object('sub',(SELECT auth_user_id::text FROM public.app_users
                                    WHERE id='03b790d0-199b-4f5c-9010-a60a4129dc66'),
            'role','authenticated')::text, true);
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_onesale', now() + interval '2 minutes');
        INSERT INTO public.category_unit_statuses
          (company_id, project_id, status_code, status_name, color_hex, sort_order,
           is_active, is_available, nature, hold_days)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZPEND2','ZZ Sold - Entry Pending','#7e22ce',96,true,false,'permanent',NULL);

        /* the hold sorts ABOVE the real Sold status, which is the one drag in
           Categories that used to be enough to stamp the wrong one */
        UPDATE public.category_unit_statuses SET sort_order = 900
         WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='SOLD';
        UPDATE public.category_unit_statuses SET sort_order = 3
         WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='ZZPEND2';

        CREATE TEMP TABLE os_unit ON COMMIT DROP AS
          SELECT u.id FROM public.units u
            JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available ORDER BY u.unit_no LIMIT 1;
        INSERT INTO public.clients (company_id, project_id, full_name, client_code, phone_primary)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZ One Sale Buyer','ZZ-OS-1','0000000000');
        CREATE TEMP TABLE os(step text, r jsonb) ON COMMIT DROP;

        INSERT INTO os SELECT 'held',
          public.reserve_unit_desk('dbshot_onesale',(SELECT id FROM os_unit),
            NULL,NULL,'Rashid',NULL,NULL,7,false,0,NULL,
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='ZZPEND2'));

        INSERT INTO os SELECT 'first sale',
          public.create_sale_with_schedule(
            jsonb_build_object('company_id','96d210e7-e63b-4ef0-b1d0-74e622eac7ce','project_id','59ded55b-9bc2-45b2-a372-49fc31807fa9',
              'unit_id',(SELECT id FROM os_unit),
              'client_id',(SELECT id FROM public.clients WHERE client_code='ZZ-OS-1'),
              'price_per_sqft',100,'area_sqft',10,'discount',0,'down_payment',0,
              'installment_count',1,'sale_date',current_date),
            jsonb_build_array(jsonb_build_object('installment_number',1,'amount_due',1000,
                                                 'due_date',current_date)));

        INSERT INTO os SELECT 'second sale',
          public.create_sale_with_schedule(
            jsonb_build_object('company_id','96d210e7-e63b-4ef0-b1d0-74e622eac7ce','project_id','59ded55b-9bc2-45b2-a372-49fc31807fa9',
              'unit_id',(SELECT id FROM os_unit),
              'client_id',(SELECT id FROM public.clients WHERE client_code='ZZ-OS-1'),
              'price_per_sqft',100,'area_sqft',10,'discount',0,'down_payment',0,
              'installment_count',1,'sale_date',current_date),
            jsonb_build_array(jsonb_build_object('installment_number',1,'amount_due',1000,
                                                 'due_date',current_date)));

        /* cancel it, and the unit must be sellable again */
        UPDATE public.sales SET status='cancelled', cancellation_date=now()
         WHERE unit_id=(SELECT id FROM os_unit) AND status='active';
        INSERT INTO os SELECT 'after cancelling',
          public.create_sale_with_schedule(
            jsonb_build_object('company_id','96d210e7-e63b-4ef0-b1d0-74e622eac7ce','project_id','59ded55b-9bc2-45b2-a372-49fc31807fa9',
              'unit_id',(SELECT id FROM os_unit),
              'client_id',(SELECT id FROM public.clients WHERE client_code='ZZ-OS-1'),
              'price_per_sqft',100,'area_sqft',10,'discount',0,'down_payment',0,
              'installment_count',1,'sale_date',current_date),
            jsonb_build_array(jsonb_build_object('installment_number',1,'amount_due',1000,
                                                 'due_date',current_date)));

        SELECT (SELECT r->>'success' FROM os WHERE step='first sale')  AS first_ok,
               (SELECT r->>'success' FROM os WHERE step='second sale') AS second_ok,
               (SELECT r->>'error'   FROM os WHERE step='second sale') AS second_err,
               (SELECT r->>'sale_number' FROM os WHERE step='second sale') AS second_points_at,
               (SELECT r->>'success' FROM os WHERE step='after cancelling') AS resell_ok,
               (SELECT upper(st.status_code) FROM public.units u
                  JOIN public.category_unit_statuses st ON st.id=u.status_id
                 WHERE u.id=(SELECT id FROM os_unit)) AS unit_stamped;
        ROLLBACK;`);
      const o1 = onesale[0] || {};

      o1.first_ok === 'true'
        ? okT('a unit held as Sold - Entry Pending still takes the real sale when it is entered')
        : badT('the hold blocked the sale it was standing in for: ' + JSON.stringify(o1));
      (o1.second_ok === 'false' && o1.second_err === 'already_sold')
        ? okT('and a SECOND sale on that unit is refused \u2014 nobody sells it twice')
        : badT('the same unit took two sales: ' + JSON.stringify(o1));
      (o1.second_err === 'already_sold' && o1.second_points_at)
        ? okT('the refusal names the sale that already stands (' + o1.second_points_at + '), not just “no”')
        : badT('the refusal does not say which sale is in the way: ' + JSON.stringify(o1));
      o1.resell_ok === 'true'
        ? okT('cancel the sale and the unit sells again \u2014 cancel-and-resell is untouched')
        : badT('a cancelled sale still blocks the unit: ' + JSON.stringify(o1));
      o1.unit_stamped === 'SOLD'
        ? okT('and the sale stamps Sold, not the hold that was sitting above it in the list')
        : badT('the sale stamped ' + o1.unit_stamped + ' \u2014 a desk tag, not a sold status');

      /* ══ A REFUSED APPROVAL MUST NOT KILL THE REQUEST ════════════════════
         Approving used to retire the dealer's request whatever went wrong, so
         a tag the desk may not apply told the dealer "Unit was taken" and
         threw the request away — for a unit that was free the whole time.
         Two refusals, told apart: one about the tag, one about the unit. */
      const refuse = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_refuse', now() + interval '5 minutes');
        CREATE TEMP TABLE lk ON COMMIT DROP AS SELECT
          (public.create_availability_link('dbshot_refuse','59ded55b-9bc2-45b2-a372-49fc31807fa9','refuse probe')->>'token') AS tok;
        CREATE TEMP TABLE rq ON COMMIT DROP AS
          SELECT public.submit_availability_request((SELECT tok FROM lk),
            (SELECT u.unit_no FROM public.units u
               JOIN public.category_unit_statuses st ON st.id=u.status_id
              WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
                AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                                 WHERE x.unit_id=u.id AND x.status='pending')
              ORDER BY u.unit_no DESC LIMIT 1), 3, 'Refuse Probe') AS r;

        CREATE TEMP TABLE d1 ON COMMIT DROP AS
          SELECT public.decide_reservation_request('dbshot_refuse',
            (SELECT id FROM public.availability_requests WHERE ref=(SELECT r->>'ref' FROM rq)),
            'approve',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='SOLD')) AS r;

        SELECT (SELECT r->>'status'  FROM d1) AS said,
               (SELECT r->>'message' FROM d1) AS msg,
               (SELECT r->'detail'->>'error' FROM d1) AS why,
               (SELECT x.status FROM public.availability_requests x
                 WHERE x.ref=(SELECT r->>'ref' FROM rq)) AS request_now;
        ROLLBACK;`);
      const rf2 = refuse[0] || {};

      rf2.request_now === 'pending'
        ? okT('a tag the desk may not apply leaves the request WAITING, not retired')
        : badT('the request was thrown away over a tag: ' + JSON.stringify(rf2));
      rf2.said === 'pending'
        ? okT('and the desk is told it is still pending, so it can be approved again properly')
        : badT('the desk was told the wrong thing: ' + JSON.stringify(rf2));
      (rf2.msg && !/taken/i.test(rf2.msg) && rf2.why === 'bad_status')
        ? okT('with the real reason in words: \u201c' + rf2.msg + '\u201d')
        : badT('the reason did not reach the desk: ' + JSON.stringify(rf2));

      /* ...and the case that IS about the unit still retires it. */
      const gone = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_gone', now() + interval '5 minutes');
        CREATE TEMP TABLE lk2 ON COMMIT DROP AS SELECT
          (public.create_availability_link('dbshot_gone','59ded55b-9bc2-45b2-a372-49fc31807fa9','gone probe')->>'token') AS tok;
        CREATE TEMP TABLE u2 ON COMMIT DROP AS
          SELECT u.id, u.unit_no FROM public.units u
            JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
             AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                              WHERE x.unit_id=u.id AND x.status='pending')
           ORDER BY u.unit_no DESC LIMIT 1;
        CREATE TEMP TABLE rq2 ON COMMIT DROP AS
          SELECT public.submit_availability_request((SELECT tok FROM lk2),
                   (SELECT unit_no FROM u2), 3, 'Gone Probe') AS r;
        /* somebody else books it in the meantime */
        SELECT public.reserve_unit_desk('dbshot_gone',(SELECT id FROM u2),
          NULL,NULL,'Somebody Else',NULL,NULL,3,false,0,NULL,NULL);
        CREATE TEMP TABLE d2 ON COMMIT DROP AS
          SELECT public.decide_reservation_request('dbshot_gone',
            (SELECT id FROM public.availability_requests WHERE ref=(SELECT r->>'ref' FROM rq2)),
            'approve', NULL) AS r;
        SELECT (SELECT r->>'status' FROM d2) AS said,
               (SELECT x.status FROM public.availability_requests x
                 WHERE x.ref=(SELECT r->>'ref' FROM rq2)) AS request_now;
        ROLLBACK;`);
      const g2 = gone[0] || {};
      (g2.said === 'stale' && g2.request_now === 'stale')
        ? okT('but a unit that really was taken still retires the request \u2014 the two are told apart')
        : badT('a genuinely taken unit did not retire the request: ' + JSON.stringify(g2));

      /* ══ WHO MAY TOUCH THE QUEUE AT ALL ══════════════════════════════════
         The gate used to be "may this person sell", and every sale rep may.
         So reps opened the desk and found other people's requests waiting
         with Approve and Decline under them. One of them sent Rashid a
         screenshot. Asked here of every role that exists on the tenant, with
         a real session each, because the answer is a matrix and not a rule
         anybody can hold in their head. */
      const roles = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', s.id, NULL, 'dbshot_role_'||s.role, now()+interval '2 minutes'
          FROM public.sales_users s
         WHERE s.company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND s.status='active'
           AND s.id = (SELECT s2.id FROM public.sales_users s2
                        WHERE s2.company_id=s.company_id AND s2.role=s.role
                          AND s2.status='active' LIMIT 1);
        SELECT su.role,
               COALESCE(public.list_reservation_requests(ss.session_token)->>'error','SEES IT') AS queue,
               COALESCE(public.decide_reservation_request(ss.session_token,
                          '00000000-0000-0000-0000-000000000000','approve')->>'error','?') AS decide
          FROM public.sales_sessions ss
          JOIN public.sales_users su ON su.id = ss.sales_user_id
         WHERE ss.session_token LIKE 'dbshot_role_%'
         ORDER BY su.role;
        ROLLBACK;`);
      const canSee = roles.filter(r => r.queue === 'SEES IT').map(r => r.role);
      const canDecide = roles.filter(r => !['forbidden','role_cannot_sell','session_expired']
                                            .includes(r.decide)).map(r => r.role);
      JSON.stringify(canSee) === JSON.stringify(['director'])
        ? okT('only a director sees the request queue (checked ' + roles.length + ' roles)')
        : badT('these roles can see the queue: ' + JSON.stringify(canSee));
      JSON.stringify(canDecide) === JSON.stringify(['director'])
        ? okT('and only a director gets past the gate on approve/decline')
        : badT('these roles can decide: ' + JSON.stringify(canDecide) + ' — ' +
               JSON.stringify(roles));

      /* And no OTHER door into the same table. Two RPCs are gated above; this
         asks whether anything else can reach the rows — another function, a
         permissive policy, or a plain SELECT. Rashid asked for "not even by
         accident", and an accident is usually a later migration, not today. */
      const doors = await sql(`
        SELECT (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public'
                   AND pg_get_functiondef(p.oid) ILIKE '%availability_requests%') AS fns,
               (SELECT count(*)::int FROM pg_policies WHERE tablename='availability_requests') AS policies,
               has_table_privilege('anon','public.availability_requests','SELECT') AS anon_reads,
               has_table_privilege('authenticated','public.availability_requests','SELECT') AS auth_reads,
               (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='availability_requests') AS rls_on;`);
      const dr = doors[0] || {};
      (dr.rls_on === true && Number(dr.policies) === 0 &&
       dr.anon_reads === false && dr.auth_reads === false)
        ? okT('and the table itself is shut: row security on, no policies, no direct read')
        : badT('the requests table can be read around the RPCs: ' + JSON.stringify(dr));
      /* Seven since the batch work. The two new ones are PLURALS of functions
         already on this list: submit_availability_requests loops over
         submit_availability_request with the same link token, and
         decide_reservation_requests loops over decide_reservation_request with
         the caller's own session — so every gate above still runs once per row
         rather than being replaced by a looser one. The rep check further down
         proves that for the decide side rather than asserting it here. */
      Number(dr.fns) === 7
        ? okT('exactly seven functions touch it — the two gated ones and their two ' +
             'plurals, the dealer’s receipt, and the two ways they ask (for a unit, ' +
             'or for a change on one they hold)')
        : badT(dr.fns + ' functions touch availability_requests; a new door may have opened');

      /* ══ A HOLD YOU CAN SEE IS A HOLD YOU CAN LET GO OF ══════════════════
         cancel_reservation would only cancel a hold you booked YOURSELF. That
         is right for a rep and wrong for the person who approves the queue: he
         books units for other people all day, so letting one go for them is
         the same job — and before the clock runs out, not only after.

         And the standing hold list named a unit on every row and never named
         the hold, so there was nothing to act on even once he was allowed to. */
      const rel = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_rel_dir', now() + interval '5 minutes');
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', s.id, '59ded55b-9bc2-45b2-a372-49fc31807fa9', 'dbshot_rel_rep', now() + interval '5 minutes'
          FROM public.sales_users s WHERE s.company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND s.role='sale_rep'
           AND s.status='active' LIMIT 1;

        /* the REP books it, so the director is releasing somebody else's hold */
        CREATE TEMP TABLE rl ON COMMIT DROP AS
          SELECT public.reserve_unit_desk('dbshot_rel_rep',
            (SELECT u.id FROM public.units u
               JOIN public.category_unit_statuses st ON st.id=u.status_id
              WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available ORDER BY u.unit_no DESC LIMIT 1),
            NULL,NULL,'Release Probe',NULL,NULL,7,false,0,NULL,NULL) AS r;
        UPDATE public.reservations SET created_at = now() - interval '4 days'
         WHERE requested_by_name='Release Probe';

        CREATE TEMP TABLE rlo(step text, r jsonb) ON COMMIT DROP;
        /* the row must name the hold, or there is nothing to press */
        INSERT INTO rlo SELECT 'row names the hold',
          (SELECT jsonb_build_object('has_id', (x->>'res_id') IS NOT NULL)
             FROM jsonb_array_elements(public.get_reservation_daybook('dbshot_rel_dir',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'holding') x
            WHERE x->>'requested_by'='Release Probe' LIMIT 1);
        INSERT INTO rlo SELECT 'director releases it',
          public.cancel_reservation('dbshot_rel_dir',
            (SELECT (r->>'reservation_id')::uuid FROM rl));
        SELECT (SELECT r->>'has_id' FROM rlo WHERE step='row names the hold') AS has_id,
               (SELECT r->>'success' FROM rlo WHERE step='director releases it') AS released,
               (SELECT status FROM public.reservations
                 WHERE id=(SELECT (r->>'reservation_id')::uuid FROM rl)) AS res_now,
               (SELECT count(*)::int FROM jsonb_array_elements(
                  public.get_reservation_daybook('dbshot_rel_dir',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'holding') x
                 WHERE x->>'requested_by'='Release Probe') AS still_held;
        ROLLBACK;`);
      const rl0 = rel[0] || {};
      rl0.has_id === 'true'
        ? okT('every standing hold names its own reservation, so it can be acted on')
        : badT('the hold list still has nothing to press: ' + JSON.stringify(rl0));
      rl0.released === 'true'
        ? okT('and a director can release a hold somebody else booked, before its time')
        : badT('the director could not release it: ' + JSON.stringify(rl0));
      (rl0.res_now === 'cancelled' && Number(rl0.still_held) === 0)
        ? okT('the unit leaves the standing list the moment it is released')
        : badT('the released hold is still standing: ' + JSON.stringify(rl0));

      /* and the rule everyone else had is untouched */
      const relRep = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_rr_dir', now() + interval '5 minutes');
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', s.id, '59ded55b-9bc2-45b2-a372-49fc31807fa9', 'dbshot_rr_rep', now() + interval '5 minutes'
          FROM public.sales_users s WHERE s.company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND s.role='sale_rep'
           AND s.status='active' LIMIT 1;
        CREATE TEMP TABLE rr ON COMMIT DROP AS
          SELECT public.reserve_unit_desk('dbshot_rr_dir',
            (SELECT u.id FROM public.units u
               JOIN public.category_unit_statuses st ON st.id=u.status_id
              WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available ORDER BY u.unit_no DESC LIMIT 1),
            NULL,NULL,'Dir Hold',NULL,NULL,7,false,0,NULL,NULL) AS r;
        SELECT (public.cancel_reservation('dbshot_rr_rep',
                  (SELECT (r->>'reservation_id')::uuid FROM rr))->>'error') AS rep_err;
        ROLLBACK;`);
      (relRep[0] || {}).rep_err === 'not_found_or_not_yours'
        ? okT('while a rep still cannot release a hold that is not theirs')
        : badT('a rep released somebody else’s hold: ' + JSON.stringify(relRep[0]));

      /* ── AND TODAY'S HOLDS, WHICH IS WHERE IT ACTUALLY BIT ────────────────
         The first version put Release only on 'Held from before'. A hold made
         TODAY by somebody else therefore had no release anywhere: the desk's
         own list is filtered to your own bookings, and this section had no
         button. Rashid found it by trying. A standing hold is a standing hold
         whether it was taken this morning or last week. */
      const relToday = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', s.id, '59ded55b-9bc2-45b2-a372-49fc31807fa9', 'dbshot_rt_rep', now()+interval '5 minutes'
          FROM public.sales_users s WHERE s.company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND s.role='sale_rep'
           AND s.status='active' LIMIT 1;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_rt_dir', now()+interval '5 minutes');

        /* the REP books it, right now, so it belongs to TODAY and to somebody else */
        CREATE TEMP TABLE rt ON COMMIT DROP AS
          SELECT public.reserve_unit_desk('dbshot_rt_rep',
            (SELECT u.id FROM public.units u
               JOIN public.category_unit_statuses st ON st.id=u.status_id
              WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
              ORDER BY u.unit_no DESC LIMIT 1),
            NULL,NULL,'Someone Else',NULL,NULL,7,false,0,NULL,NULL) AS r;

        CREATE TEMP TABLE rto(step text, r jsonb) ON COMMIT DROP;
        INSERT INTO rto SELECT 'on the day list',
          (SELECT jsonb_build_object('n', count(*), 'has_id', bool_and((x->>'res_id') IS NOT NULL))
             FROM jsonb_array_elements(
               public.get_reservation_daybook('dbshot_rt_dir',NULL,'59ded55b-9bc2-45b2-a372-49fc31807fa9')->'reserved') x
            WHERE x->>'requested_by'='Someone Else');
        INSERT INTO rto SELECT 'director releases it',
          public.cancel_reservation('dbshot_rt_dir', (SELECT (r->>'reservation_id')::uuid FROM rt));

        SELECT (SELECT r->>'n'       FROM rto WHERE step='on the day list') AS on_list,
               (SELECT r->>'has_id'  FROM rto WHERE step='on the day list') AS has_id,
               (SELECT r->>'success' FROM rto WHERE step='director releases it') AS released,
               (SELECT status FROM public.reservations
                 WHERE id=(SELECT (r->>'reservation_id')::uuid FROM rt)) AS res_now;
        ROLLBACK;`);
      const rt0 = relToday[0] || {};
      (Number(rt0.on_list) === 1 && rt0.has_id === 'true')
        ? okT('a hold taken TODAY by somebody else is on the director’s day list, and names itself')
        : badT('today’s hold cannot be acted on: ' + JSON.stringify(rt0));
      (rt0.released === 'true' && rt0.res_now === 'cancelled')
        ? okT('and he can release that one too — not only the ones from earlier days')
        : badT('today’s hold could not be released: ' + JSON.stringify(rt0));

      /* ══ A REP CAN ASK FOR A CHANGE, NOT ONLY FOR A UNIT ═════════════════
         The gap: a rep reserves through the link, the deal matures, and there
         was no way to say so — the link could only ask for units that were
         FREE, so the moment one became theirs it fell out of the only channel
         they have.

         The whole story in one rolled-back transaction: ask, approve, deal
         matures, ask again, approve as permanent. What must be true at the
         end is that the SAME hold carries the new tag — not a release and a
         rebooking, which would put a cancellation on the daybook that nobody
         performed and lose who asked for it in the first place. */
      const chg = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_chg', now() + interval '5 minutes');
        INSERT INTO public.category_unit_statuses
          (company_id, project_id, status_code, status_name, color_hex, sort_order,
           is_active, is_available, nature, hold_days)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','59ded55b-9bc2-45b2-a372-49fc31807fa9','ZZCHG','ZZ Sold - Entry Pending','#7e22ce',99,true,false,'permanent',NULL);

        CREATE TEMP TABLE lk3 ON COMMIT DROP AS SELECT
          (public.create_availability_link('dbshot_chg','59ded55b-9bc2-45b2-a372-49fc31807fa9','chg probe')->>'token') AS tok;
        CREATE TEMP TABLE q1 ON COMMIT DROP AS
          SELECT public.submit_availability_request((SELECT tok FROM lk3),
            (SELECT u.unit_no FROM public.units u
               JOIN public.category_unit_statuses st ON st.id=u.status_id
              WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
                AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                                 WHERE x.unit_id=u.id AND x.status='pending')
              ORDER BY u.unit_no DESC LIMIT 1), 3, 'Field Rep') AS r;
        CREATE TEMP TABLE q2 ON COMMIT DROP AS
          SELECT public.decide_reservation_request('dbshot_chg',
            (SELECT id FROM public.availability_requests WHERE ref=(SELECT r->>'ref' FROM q1)),
            'approve', NULL) AS r;

        /* somebody quoting a ref they overheard */
        CREATE TEMP TABLE q0 ON COMMIT DROP AS
          SELECT public.submit_change_request((SELECT tok FROM lk3), 'ZZZZZZ', 'not mine') AS r;

        CREATE TEMP TABLE q3 ON COMMIT DROP AS
          SELECT public.submit_change_request((SELECT tok FROM lk3),
                   (SELECT r->>'ref' FROM q1), 'Deal done, please mark it sold') AS r;
        CREATE TEMP TABLE q4 ON COMMIT DROP AS
          SELECT public.decide_reservation_request('dbshot_chg',
            (SELECT id FROM public.availability_requests WHERE ref=(SELECT r->>'ref' FROM q3)),
            'approve',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='ZZCHG')) AS r;

        SELECT (SELECT r->>'error'   FROM q0) AS stranger_err,
               (SELECT r->>'success' FROM q3) AS asked,
               (SELECT r->>'success' FROM q4) AS approved,
               (SELECT r->'booking'->>'tag' FROM q4) AS now_tagged,
               (SELECT count(*)::int FROM public.reservations rr
                 WHERE rr.unit_id=(SELECT unit_id FROM public.availability_requests
                                    WHERE ref=(SELECT r->>'ref' FROM q1))
                   AND rr.status='active') AS active_holds,
               (SELECT count(*)::int FROM public.reservations rr
                 WHERE rr.unit_id=(SELECT unit_id FROM public.availability_requests
                                    WHERE ref=(SELECT r->>'ref' FROM q1))
                   AND rr.status='cancelled') AS cancelled_holds,
               ((SELECT rr.id FROM public.reservations rr
                  WHERE rr.id=(SELECT (r->'booking'->>'reservation_id')::uuid FROM q4))
                = (SELECT (r->'booking'->>'reservation_id')::uuid FROM q2)) AS same_hold,
               (SELECT rr.expiry_date IS NULL FROM public.reservations rr
                 WHERE rr.id=(SELECT (r->'booking'->>'reservation_id')::uuid FROM q4)) AS no_expiry,
               (SELECT r->>'note' FROM q3) AS ignore1;
        ROLLBACK;`);
      const c0 = chg[0] || {};

      c0.asked === 'true'
        ? okT('a rep can ask, from the link, about a unit they already hold')
        : badT('the change request was refused: ' + JSON.stringify(c0));
      c0.stranger_err === 'not_yours'
        ? okT('and a ref somebody merely overheard is refused \u2014 there is no login here,')
        : badT('a stranger could ask about somebody else\u2019s hold: ' + JSON.stringify(c0));
      (c0.approved === 'true' && /Entry Pending/.test(c0.now_tagged || ''))
        ? okT('  so ownership is the link that issued the ref, the approval, and a live hold')
        : badT('the change was not applied: ' + JSON.stringify(c0));
      (c0.same_hold === true && Number(c0.active_holds) === 1 && Number(c0.cancelled_holds) === 0)
        ? okT('the SAME hold carries the new tag \u2014 no release, no rebooking, nothing on the daybook that nobody did')
        : badT('approving a change rebooked the unit: ' + JSON.stringify(c0));
      c0.no_expiry === true
        ? okT('and a permanent tag takes its expiry away, the same as booking one outright')
        : badT('the changed hold kept an expiry: ' + JSON.stringify(c0));

      /* ══ THE DEALER SAYS WHAT THEY MEAN, AND STILL DECIDES NOTHING ═══════
         The link used to ask only for days. It now offers the statuses this
         project has published — Reserve, Hold, Sold — and carries the answer
         as an ASK. Three things have to hold at once: only a published status
         may be named, a permanent one takes no days, and none of it is
         applied until a director taps Approve. */
      const say = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_say', now() + interval '5 minutes');
        CREATE TEMP TABLE lk4 ON COMMIT DROP AS SELECT
          (public.create_availability_link('dbshot_say','59ded55b-9bc2-45b2-a372-49fc31807fa9','say probe')->>'token') AS tok;

        CREATE TEMP TABLE fu ON COMMIT DROP AS
          SELECT u.unit_no FROM public.units u
            JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
             AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                              WHERE x.unit_id=u.id AND x.status='pending')
           ORDER BY u.unit_no DESC LIMIT 2;

        CREATE TEMP TABLE sayo(step text, r jsonb) ON COMMIT DROP;

        /* a status that exists but is NOT published to the link */
        INSERT INTO sayo SELECT 'asking for something unpublished',
          public.submit_availability_request((SELECT tok FROM lk4),
            (SELECT unit_no FROM fu LIMIT 1), 3, 'Field Rep',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='LANDOWNER'));

        /* and the real SOLD, which has no nature and can never be published */
        INSERT INTO sayo SELECT 'asking for SOLD itself',
          public.submit_availability_request((SELECT tok FROM lk4),
            (SELECT unit_no FROM fu LIMIT 1), 3, 'Field Rep',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='SOLD'));

        /* the published permanent one, asked with days it must not keep */
        INSERT INTO sayo SELECT 'asking for Sold - Entry Pending',
          public.submit_availability_request((SELECT tok FROM lk4),
            (SELECT unit_no FROM fu LIMIT 1), 30, 'Field Rep',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='SOLD_ENTRY_PENDING'));

        SELECT (SELECT r->>'error' FROM sayo WHERE step='asking for something unpublished') AS unpub_err,
               (SELECT r->>'error' FROM sayo WHERE step='asking for SOLD itself') AS sold_err,
               (SELECT r->>'success' FROM sayo WHERE step='asking for Sold - Entry Pending') AS asked_ok,
               (SELECT r->>'asked' FROM sayo WHERE step='asking for Sold - Entry Pending') AS asked_label,
               (SELECT x.days IS NULL FROM public.availability_requests x
                 WHERE x.ref=(SELECT r->>'ref' FROM sayo
                               WHERE step='asking for Sold - Entry Pending')) AS days_dropped,
               (SELECT a.status_code FROM public.availability_requests x
                  JOIN public.category_unit_statuses a ON a.id = x.asked_status_id
                 WHERE x.ref=(SELECT r->>'ref' FROM sayo
                               WHERE step='asking for Sold - Entry Pending')) AS remembered,
               /* nothing is held yet: an ask is not a decision */
               (SELECT count(*)::int FROM public.reservations rr
                 WHERE rr.unit_id=(SELECT u2.id FROM public.units u2
                                    WHERE u2.unit_no=(SELECT unit_no FROM fu LIMIT 1)
                                      AND u2.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9')
                   AND rr.status='active') AS booked_already,
               (SELECT q->>'asked_tag' FROM jsonb_array_elements(
                  public.list_reservation_requests('dbshot_say','59ded55b-9bc2-45b2-a372-49fc31807fa9')->'requests') q
                 WHERE q->>'ref'=(SELECT r->>'ref' FROM sayo
                                   WHERE step='asking for Sold - Entry Pending')) AS desk_sees;
        ROLLBACK;`);
      const sy = sayo0(say);

      sy.unpub_err === 'bad_choice'
        ? okT('a status this link does not publish cannot be asked for')
        : badT('an unpublished status was accepted: ' + JSON.stringify(sy));
      sy.sold_err === 'bad_choice'
        ? okT('and SOLD itself never can be \u2014 it has no nature, so it could never be granted')
        : badT('SOLD was accepted as an ask: ' + JSON.stringify(sy));
      (sy.asked_ok === 'true' && sy.asked_label === 'Sold')
        ? okT('what IS published is accepted, under the word the dealer sees: \u201c' +
              sy.asked_label + '\u201d')
        : badT('the published choice was refused: ' + JSON.stringify(sy));
      (sy.days_dropped === true && sy.remembered === 'SOLD_ENTRY_PENDING')
        ? okT('the 30 days sent with it are dropped, and the ask itself is remembered')
        : badT('a permanent ask kept its days: ' + JSON.stringify(sy));
      Number(sy.booked_already) === 0
        ? okT('and NOTHING is held by asking \u2014 the tag waits for Approve, as it always did')
        : badT('asking booked the unit: ' + JSON.stringify(sy));
      sy.desk_sees === 'Sold'
        ? okT('the desk sees what was asked for, on the card, before it decides')
        : badT('the desk cannot see the ask: ' + JSON.stringify(sy));
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
    console.log('\n── Movement and Released are switchable');
    {
      const okW = m => console.log('  ✅ ' + m);
      const badW = m => { console.log('  ❌ ' + m); FAILED = true; };
      /* An "it disappears when switched off" check proves nothing on its own —
         a selector typo reads exactly like a working switch. Both states, the
         same payload, one after the other. */
      const both = await page.evaluate(async (AW) => {
        const r = await sb.rpc('get_reservation_daybook',
          { p_session_token: TOKEN, p_date: null, p_project_id: AW, p_from: null, p_to: null });
        const look = () => ({
          movement: !!document.querySelector('#rd-print table.mv-t'),
          released: [...document.querySelectorAll('#rd-print .sec-t')]
                      .some(e => /Released In This Period/.test(e.textContent)),
          floors:   [...document.querySelectorAll('#rd-print .sec-t')]
                      .some(e => /Floor-wise Position/.test(e.textContent)),
          none:     /Nothing was released/.test(document.getElementById('rd-print').textContent)
        });
        const d1 = JSON.parse(JSON.stringify(r.data));
        d1.showMovement = true;  d1.showReleased = true;
        window._dbPreview(d1, d1.date);
        const on = look();
        const d2 = JSON.parse(JSON.stringify(r.data));
        d2.showMovement = false; d2.showReleased = false;
        window._dbPreview(d2, d2.date);
        const off = look();
        return { on, off, released: (r.data.released || []).length };
      }, AWAMI);

      (both.on.movement && !both.off.movement)
        ? okW('the movement table is there when switched on and gone when switched off')
        : badW('the movement switch does nothing: ' + JSON.stringify({ on: both.on.movement, off: both.off.movement }));

      if (both.released > 0) {
        (both.on.released && !both.off.released)
          ? okW('the released list is there when switched on and gone when switched off')
          : badW('the released switch does nothing: ' + JSON.stringify({ on: both.on.released, off: both.off.released }));
        /* Switched off it must leave NO trace — not a heading, not a count, and
           not a line announcing that it is empty. A reader who turned it off did
           not ask to be told it is absent. */
        !both.off.none
          ? okW('switched off it leaves no "nothing was released" line either')
          : badW('switching it off replaced the section with a line saying it is empty');
      } else {
        okW('nothing was released in this period, so the released switch had nothing to hide');
      }

      both.on.floors && both.off.floors
        ? okW('the rest of the report is untouched by either switch')
        : badW('a switch took the floor table with it');
    }

    /* ── THE UNIT TYPE-AHEAD ───────────────────────────────────────────────
       This belongs in verify-reserve-desk.js, which is the desk's own suite —
       but that one needs ZZTEST_PIN and has not run all evening, and a check
       that never executes is not a check. This harness already boots the portal
       as the Awami director, so it drives the real box on the real 1,467-unit
       index rather than a stub. */
    console.log('\n── The unit box searches as you type');
    {
      const okU = m => console.log('  ✅ ' + m);
      const badU = m => { console.log('  ❌ ' + m); FAILED = true; };

      /* The print host is still on screen from the render steps above and would
       otherwise be what gets photographed. Put it away before touching the desk. */
      await page.evaluate(() => {
        document.body.classList.remove('rd-printing');
        const p = document.getElementById('rd-print');
        if (p) { p.innerHTML = ''; p.style.cssText = 'display:none'; }
        setTab('desk');
      });
      await page.waitForFunction(() => !!document.getElementById('rd-root'), { timeout: 30000 });
      await sleep(900);

      const type = async (txt) => await page.evaluate(t => {
        const el = document.getElementById('rd-root').querySelector('#rd-unit');
        el.value = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const box = document.getElementById('rd-root').querySelector('#rd-sugg');
        const rows = [...box.querySelectorAll('.rd-sg')].map(b => ({
          unit: b.querySelector('.n').textContent.trim(),
          floor: (b.querySelector('.f') || {}).textContent || ''
        }));
        const hit = document.getElementById('rd-root').querySelector('#rd-hit');
        return { rows, open: box.style.display !== 'none',
                 more: /more/.test(box.textContent),
                 hitText: hit.textContent.trim(), hitCls: hit.className };
      }, txt);

      /* What the DATABASE says is available, so the page cannot be graded
         against the payload it was drawn from. */
      const avail = await sql(`
        select u.unit_no,
               coalesce(f.sort_order, u.floor_no, 999) as rank,
               coalesce(nullif(regexp_replace(u.unit_no, '[^0-9]', '', 'g'),'')::bigint, 0) as num
          from public.units u
          join public.category_unit_statuses st on st.id = u.status_id
          left join public.floors f on f.id = u.floor_id
         where u.project_id = '${AWAMI}' and st.is_available
         order by rank, num, u.unit_no;`);
      const availSet = new Set(avail.map(r => String(r.unit_no).toUpperCase()));
      const norm = x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '');

      const L  = await type('L');
      const LG = await type('LG');

      L.rows.length > 0
        ? okU('typing L offers ' + L.rows.length + ' unit(s)' + (L.more ? ' and says there are more' : ''))
        : badU('typing L offered nothing at all');

      /* Only available ones. A held unit is not a suggestion — this box exists
         to book, and offering something that cannot be booked is worse than
         offering nothing. */
      const notFree = L.rows.filter(r => !availSet.has(r.unit.toUpperCase()));
      notFree.length === 0
        ? okU('every unit offered is one the database says is available')
        : badU('offered units that are not available: ' + notFree.map(r => r.unit).join(', '));

      const wrongPrefix = L.rows.filter(r => norm(r.unit).indexOf('L') !== 0);
      wrongPrefix.length === 0
        ? okU('every unit offered starts with what was typed')
        : badU('offered units that do not start with L: ' + wrongPrefix.map(r => r.unit).join(', '));

      LG.rows.length > 0 && LG.rows.every(r => norm(r.unit).indexOf('LG') === 0)
        ? okU('typing G after it keeps ' + LG.rows.length + ' unit(s), all of them LG')
        : badU('LG offered something that is not an LG unit: ' + JSON.stringify(LG.rows.slice(0, 5)));

      /* THE ORDER IS THE POINT. A capped list is only useful if it is capped at
         the RIGHT end — the first N in the order the building is walked, floor
         by floor and then by number, so LG-2 is above LG-10. Compared against
         the database's own ordering rather than against the page's. */
      {
        const want = avail.filter(r => norm(r.unit_no).indexOf('L') === 0)
                          .map(r => String(r.unit_no))
                          .slice(0, L.rows.length);
        const got = L.rows.map(r => r.unit);
        JSON.stringify(got) === JSON.stringify(want)
          ? okU('offered in unit-wise order, first ' + got.length + ': ' + got.slice(0, 4).join(', ') + ' …')
          : badU('the list is not the first ' + got.length + ' in unit-wise order.' +
                 ' got ' + JSON.stringify(got.slice(0, 6)) + ' want ' + JSON.stringify(want.slice(0, 6)));
      }

      /* And a prefix that genuinely narrows within the cap, so "typing more
         narrows it" is asserted somewhere it can actually fail. */
      {
        const deep = String((L.rows[0] || {}).unit || '').slice(0, 4);
        if (deep.length >= 3) {
          const D = await type(deep);
          const dbCount = avail.filter(r => norm(r.unit_no).indexOf(norm(deep)) === 0).length;
          (D.rows.length <= L.rows.length && D.rows.length === Math.min(dbCount, 24) &&
           D.rows.every(r => norm(r.unit).indexOf(norm(deep)) === 0))
            ? okU('typing ' + deep + ' narrows to ' + D.rows.length + ', matching the database exactly')
            : badU('a longer prefix did not narrow correctly: ' +
                   JSON.stringify({ typed: deep, shown: D.rows.length, inDb: dbCount }));
        } else {
          okU('no unit number long enough to test a deeper prefix on this project');
        }
      }

      /* Taking one must leave the box in exactly the state typing the number in
         full would leave it: resolved, and ready to book. */
      const picked = await page.evaluate(() => {
        const root = document.getElementById('rd-root');
        const b = root.querySelector('#rd-sugg .rd-sg');
        const want = b.querySelector('.n').textContent.trim();
        b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return { want, value: root.querySelector('#rd-unit').value,
                 goEnabled: !root.querySelector('#rd-go').disabled,
                 hit: root.querySelector('#rd-hit').textContent.trim(),
                 listOpen: root.querySelector('#rd-sugg').style.display !== 'none' };
      });
      (picked.value === picked.want && picked.goEnabled && /Available/.test(picked.hit) && !picked.listOpen)
        ? okU('picking ' + picked.want + ' fills the box, resolves it and enables the button')
        : badU('picking a suggestion left the desk in a half state: ' + JSON.stringify(picked));

      /* And a number that matches nothing must say so — the quiet state is only
         for the middle of typing something real. */
      /* A picture of it open, because the assertions above prove it WORKS and
         say nothing about whether it is legible on a phone. */
      await type('LG-0');
      await page.evaluate(() => document.getElementById('rd-root').scrollIntoView());
      await sleep(400);
      /* The list must STILL be open when the shutter goes: a deferred close from
         an earlier blur used to arrive during this wait and shut it. */
      const stillOpen = await page.evaluate(() =>
        document.getElementById('rd-root').querySelectorAll('#rd-sugg .rd-sg').length);
      stillOpen > 0
        ? okU('the list is still open ' + stillOpen + ' rows deep after a pause — nothing closes it behind your back')
        : badU('the list closed itself while nobody was typing');
      await page.screenshot({ path: path.join(OUT, '06-typeahead.png') });
      console.log('  rendered 06-typeahead.png with the list open');

      const none = await type('ZQ9');
      (!none.open && /No available unit starts with/.test(none.hitText))
        ? okU('a number that matches nothing says so, with no list')
        : badU('a non-matching number did not report itself: ' + JSON.stringify(none));

      await page.evaluate(() => { const e = document.getElementById('rd-root').querySelector('#rd-unit');
                                  e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.evaluate(() => setTab('daybook'));
      await page.waitForFunction(() => !!document.getElementById('db-root'), { timeout: 30000 });
      await sleep(700);
    }

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

    console.log('\n\u2500\u2500 One action, many units');
    {
      const one = rows => (rows && rows[0]) || {};
      const okB = m => console.log('  \u2705 ' + m);
      const badB = m => { console.log('  \u274C ' + m); FAILED = true; };

      /* ══ THE DESK: ONE TAG, MANY UNITS ═══════════════════════════════════
         Forty units to the landowner used to be forty passes over the same
         three fields. reserve_units_desk is a LOOP around the single-unit
         function, not a second copy of it, so what has to be proved is that
         the loop itself does not invent anything: that a repeated unit is not
         booked twice, that the token is money taken once rather than once per
         unit, and that one refusal does not take the batch down with it.

         Inside a transaction that is rolled back. Nothing here reaches Awami. */
      const deskRows = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_bulk1', now() + interval '5 minutes');

        CREATE TEMP TABLE bu ON COMMIT DROP AS
          SELECT u.id, u.unit_no, row_number() OVER (ORDER BY u.unit_no DESC) AS rn
            FROM public.units u JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
             AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                              WHERE x.unit_id=u.id AND x.status='pending')
           ORDER BY u.unit_no DESC LIMIT 4;

        /* A unit that is NOT free, so the batch has something real to refuse. */
        CREATE TEMP TABLE bh ON COMMIT DROP AS
          SELECT u.id, u.unit_no FROM public.units u
            JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND NOT st.is_available
           ORDER BY u.unit_no LIMIT 1;

        CREATE TEMP TABLE bt ON COMMIT DROP AS
          SELECT id, status_name, nature FROM public.category_unit_statuses
           WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='LANDOWNER';

        CREATE TEMP TABLE br ON COMMIT DROP AS SELECT public.reserve_units_desk(
          'dbshot_bulk1',
          /* every free unit TWICE, plus one that is already gone */
          (SELECT array_agg(id ORDER BY rn) FROM bu)
            || (SELECT array_agg(id ORDER BY rn) FROM bu)
            || (SELECT array_agg(id) FROM bh),
          NULL, NULL, 'Bulk Probe', NULL, NULL, 7, true, 50000,
          'bulk probe', (SELECT id FROM bt)) AS j;

        SELECT (j->>'asked')::int  AS asked,
               (j->>'done')::int   AS done,
               (j->>'failed')::int AS failed,
               (SELECT count(*)::int FROM public.reservations rr
                 WHERE rr.unit_id IN (SELECT id FROM bu) AND rr.status='active') AS holds,
               (SELECT count(*)::int FROM public.reservations rr
                 WHERE rr.unit_id IN (SELECT id FROM bu) AND rr.status='active'
                   AND rr.token_amount > 0) AS carrying_token,
               (SELECT count(*)::int FROM public.reservations rr
                 WHERE rr.unit_id IN (SELECT id FROM bu) AND rr.status='active'
                   AND rr.expiry_date IS NULL) AS no_expiry,
               (SELECT count(*)::int FROM public.units u JOIN bt t ON t.id=u.status_id
                 WHERE u.id IN (SELECT id FROM bu)) AS stamped,
               (SELECT x->>'unit_no' FROM jsonb_array_elements(j->'results') x
                 WHERE (x->>'success')::boolean IS NOT TRUE) AS refused_named,
               (SELECT unit_no FROM bh) AS the_held_one
          FROM br;
        ROLLBACK;`);
      const dk = one(deskRows);

      dk.asked === 5
        ? okB('nine ids for five units \u2014 a pasted list repeats itself, and the ' +
              'repeat is folded rather than refused as already reserved')
        : badB('the batch did not dedupe: ' + JSON.stringify(dk));
      (dk.done === 4 && dk.failed === 1 && dk.holds === 4)
        ? okB('four booked and one refused \u2014 a unit that has gone does not ' +
              'take the other four down with it')
        : badB('partial failure was mishandled: ' + JSON.stringify(dk));
      dk.refused_named === dk.the_held_one
        ? okB('and the refusal says WHICH: ' + dk.refused_named)
        : badB('the refused unit was not named: ' + JSON.stringify(dk));
      dk.carrying_token === 1
        ? okB('PKR 50,000 lands on ONE unit, not on all four \u2014 the token is ' +
              'the money that changed hands, not a number stamped four times')
        : badB('the token was multiplied across the batch: ' + JSON.stringify(dk));
      (dk.no_expiry === 4 && dk.stamped === 4)
        ? okB('a permanent tag takes every one of them off the market with no ' +
              'end date, and the units carry it')
        : badB('the permanent tag did not apply across the batch: ' + JSON.stringify(dk));

      /* ══ THE LINK, AND THE ONE TAP THAT ANSWERS IT ═══════════════════════
         A dealer asking for five shops at once writes five rows that share a
         batch_ref, and the desk answers all of them together. What has to hold
         is that the batch is only ever this dealer's own rows \u2014 a ref that
         already belonged to somebody else's pending ask must not be pulled
         into it \u2014 and that approving still books through the same
         reserve_unit_desk the desk itself uses. */
      const askRows = await sql(`
        BEGIN;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce','${DIR}','59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_bulk2', now() + interval '5 minutes');
        CREATE TEMP TABLE lk9 ON COMMIT DROP AS SELECT
          (public.create_availability_link('dbshot_bulk2','59ded55b-9bc2-45b2-a372-49fc31807fa9','bulk probe')->>'token') AS tok;

        CREATE TEMP TABLE fu9 ON COMMIT DROP AS
          SELECT u.unit_no FROM public.units u
            JOIN public.category_unit_statuses st ON st.id=u.status_id
           WHERE u.project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND st.is_available
             AND NOT EXISTS (SELECT 1 FROM public.availability_requests x
                              WHERE x.unit_id=u.id AND x.status='pending')
           ORDER BY u.unit_no DESC LIMIT 3;

        /* three real ones, a number that is not a unit, and one of the three
           again in lower case */
        CREATE TEMP TABLE ask9 ON COMMIT DROP AS SELECT
          public.submit_availability_requests((SELECT tok FROM lk9),
            (SELECT array_agg(unit_no) FROM fu9)
              || ARRAY['ZZ-NOT-A-UNIT', lower((SELECT min(unit_no) FROM fu9))],
            5, 'Bulk Dealer',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='HOLD')) AS j;

        /* READ THE QUEUE BEFORE ANSWERING IT. Approving retires the rows, so a
           desk view taken after dec9 finds nothing and reports "not grouped"
           when the grouping was fine — the first run of this said exactly
           that. */
        CREATE TEMP TABLE see9 ON COMMIT DROP AS SELECT q AS r
          FROM jsonb_array_elements(
            public.list_reservation_requests('dbshot_bulk2','59ded55b-9bc2-45b2-a372-49fc31807fa9')->'requests') q
         WHERE q->>'batch_ref' IS NOT NULL;

        CREATE TEMP TABLE dec9 ON COMMIT DROP AS SELECT
          public.decide_reservation_requests('dbshot_bulk2',
            (SELECT array_agg(id) FROM public.availability_requests
              WHERE batch_ref=(SELECT j->>'batch' FROM ask9) AND status='pending'),
            'approve',
            (SELECT id FROM public.category_unit_statuses
              WHERE project_id='59ded55b-9bc2-45b2-a372-49fc31807fa9' AND status_code='HOLD')) AS k;

        SELECT (SELECT (j->>'asked')::int FROM ask9)  AS asked,
               (SELECT (j->>'ok')::int FROM ask9)     AS ok,
               (SELECT (j->>'failed')::int FROM ask9) AS failed,
               (SELECT length(j->>'batch') FROM ask9) AS batch_len,
               (SELECT count(*)::int FROM public.availability_requests
                 WHERE batch_ref=(SELECT j->>'batch' FROM ask9)) AS in_batch,
               (SELECT count(DISTINCT r->>'batch_ref')::int FROM see9
                 WHERE r->>'batch_ref' = (SELECT j->>'batch' FROM ask9)) AS desk_sees_batch,
               (SELECT count(*)::int FROM see9
                 WHERE r->>'batch_ref' = (SELECT j->>'batch' FROM ask9)) AS desk_sees_rows,
               (SELECT (k->>'done')::int FROM dec9)   AS approved,
               (SELECT (k->>'failed')::int FROM dec9) AS approve_failed,
               (SELECT count(*)::int FROM public.reservations rr
                  JOIN public.availability_requests ar ON ar.reservation_id = rr.id
                 WHERE ar.batch_ref=(SELECT j->>'batch' FROM ask9)
                   AND rr.status='active') AS holds_made;
        ROLLBACK;`);
      const ak = one(askRows);

      (ak.asked === 4 && ak.ok === 3 && ak.failed === 1)
        ? okB('five numbers, one of them the same unit in lower case: four asked ' +
              'for, three registered, and the one that is not a unit refused')
        : badB('the batch ask miscounted: ' + JSON.stringify(ak));
      (ak.batch_len === 6 && ak.in_batch === 3)
        ? okB('the three that landed share one batch ref, and only those three')
        : badB('the batch ref is wrong: ' + JSON.stringify(ak));
      (ak.desk_sees_rows === 3 && ak.desk_sees_batch === 1)
        ? okB('the desk reads them as ONE card carrying three units, not three cards')
        : badB('the queue does not group them: ' + JSON.stringify(ak));
      (ak.approved === 3 && ak.approve_failed === 0 && ak.holds_made === 3)
        ? okB('and one tap answers all three \u2014 three holds, booked through the ' +
              'same reserve_unit_desk the desk itself types into')
        : badB('the bulk approve did not book: ' + JSON.stringify(ak));

      /* THE QUEUE IS STILL THE DIRECTOR'S. The plural must not become a way
         round the gate the singular holds. */
      const repRows = await sql(`
        BEGIN;
        CREATE TEMP TABLE rep9 ON COMMIT DROP AS
          SELECT id FROM public.sales_users
           WHERE company_id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND role='sale_rep' AND status='active' LIMIT 1;
        INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
        SELECT '96d210e7-e63b-4ef0-b1d0-74e622eac7ce', id, '59ded55b-9bc2-45b2-a372-49fc31807fa9','dbshot_bulk3', now() + interval '5 minutes' FROM rep9;
        SELECT (SELECT count(*) FROM rep9) AS have_rep,
               public.decide_reservation_requests('dbshot_bulk3',
                 ARRAY[gen_random_uuid()], 'approve')->'results'->0->>'error' AS rep_gets;
        ROLLBACK;`);
      const rp = one(repRows);
      Number(rp.have_rep) === 0
        ? okB('no sale rep in this tenant to test the gate with \u2014 nothing to check')
        : (rp.rep_gets === 'forbidden'
            ? okB('a sale rep asking the PLURAL to approve is refused exactly as the ' +
                  'singular refuses them \u2014 the loop is not a way round the gate')
            : badB('a rep got past the bulk approve: ' + JSON.stringify(rp)));
    }

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
