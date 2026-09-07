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
            d.reserved.push(c);
          }
          d.expiring = d.reserved.slice(0,6).map((x,i)=>({
            unit_no:x.unit_no, floor:x.floor, requested_by:x.requested_by, hours_left:6+i*4,
            expiry_date:new Date(Date.now()+(6+i*4)*36e5).toISOString() }));
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
    await shot('03-page-break',    '2026-09-07', 34, false);
    await shot('04-greyscale',     '2026-09-07', 34, true);

    // structural checks on the padded render (the one with breaks)
    await page.evaluate(async (AWAMI) => {
      const r = await sb.rpc('get_reservation_daybook',
        { p_session_token: TOKEN, p_date: '2026-09-07', p_project_id: AWAMI });
      const d = r.data;
      const names=['Nimra Khan','Malik Sikandar','Muhammad Saeed','IQRA','Salman Sajjad','Naseer khan'];
      const floors=['Lower Ground','Ground Floor','First Floor','Second Floor','Third Floor'];
      const base=(d.reserved&&d.reserved[0])||{};
      d.reserved=[];
      for(let i=0;i<34;i++){ const c=JSON.parse(JSON.stringify(base));
        c.unit_no=floors[i%5].split(' ')[0].slice(0,2).toUpperCase()+'-'+String(i+1).padStart(2,'0');
        c.floor=floors[i%5]; c.requested_by=names[i%names.length];
        c.agent_code='AGT-2026-'+String(1+(i%40)).padStart(4,'0');
        c.client_name=(i%3===0)?null:'Buyer '+(i+1); d.reserved.push(c); }
      d.expiring=d.reserved.slice(0,6).map((x,i)=>({unit_no:x.unit_no,floor:x.floor,
        requested_by:x.requested_by,hours_left:6+i*4,
        expiry_date:new Date(Date.now()+(6+i*4)*36e5).toISOString()}));
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
      // a page that carries table ROWS must carry a header for them; a page
      // that carries none (the signature page) needs no header at all
      const bodyRows=pgs.map(p=>p.querySelectorAll('tbody tr').length);
      const theads=pgs.map(p=>p.querySelectorAll('thead').length);
      const headless=pgs.map((p,i)=>({i:i+1,rows:bodyRows[i],heads:theads[i]}))
                        .filter(x=>x.rows>0 && x.heads===0);
      const sig=pgs.filter(p=>p.querySelector('.sig')).length;
      return { n:pgs.length, foot, headsOnP1:heads[0], headsRest:heads.slice(1).every(Boolean),
               orphan, overflow, clash, theads, bodyRows, headless, sigPages:sig,
               sigSplit: pgs.some(p=>{const s=p.querySelector('.sig'); return s && s.getBoundingClientRect().bottom > p.getBoundingClientRect().bottom;}) };
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
      const tables = [...document.querySelectorAll('#rd-print table')];
      const ft = tables[tables.length - 1];
      const rows = [...ft.querySelectorAll('tbody tr')];
      const tot = rows.find(t => t.classList.contains('tot'));
      const N = s => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;
      const kpi = [...p1.querySelectorAll('.kpi')].slice(0, 4)
                    .map(k => N(k.querySelector('.v').textContent));
      return {
        proj: (p1.querySelector('.mh-proj') || {}).textContent.trim(),
        floors: rows.filter(t => !t.classList.contains('tot')).map(t => t.cells[0].textContent.trim()),
        kpi: { total: kpi[0], sold: kpi[1], res: kpi[2], av: kpi[3] },
        tbl: { sold: N(tot.cells[2].textContent), res: N(tot.cells[3].textContent),
               av: N(tot.cells[4].textContent), total: N(tot.cells[5].textContent) }
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
    (sem.kpi.total === sem.tbl.total && sem.kpi.sold === sem.tbl.sold &&
     sem.kpi.res === sem.tbl.res && sem.kpi.av === sem.tbl.av)
      ? okS('KPI cards equal the floor-table totals (' + sem.kpi.total + ' = ' + sem.tbl.total + ')')
      : badS('KPI vs table mismatch: ' + JSON.stringify(sem));
    (sem.tbl.sold + sem.tbl.res + sem.tbl.av === sem.tbl.total)
      ? okS('sold + reserved + available = total')
      : badS('the totals do not add up: ' + JSON.stringify(sem.tbl));

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
    chk.clash.length===0 ? ok('nothing collides with the footer rule')
                         : bad('content runs into the footer: '+JSON.stringify(chk.clash));
    chk.sigPages===1 && !chk.sigSplit ? ok('signature block whole, on one page') : bad('signature block split or missing');

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
