/**
 * DASHBOARD PULSE verification — renders the real _dashAdmin path with the RPCs
 * stubbed to FG-shaped data (auth-free harness can't reach Supabase). Totals use
 * the live-verified figures: June MTD 3,781,500 · May 12,275,100 (Σ daily == RP
 * received_total, proven via MCP). Screenshots the dashboard light + dark.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4211;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots_pulse');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, p === '/' ? 'login.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });   // the fold-safety target
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });

  await page.evaluate(() => {
    // ── stub supabase.rpc with FG-shaped data ──
    const monthTotals = { '01': 8100000, '02': 9300000, '03': 10100000, '04': 11000000, '05': 12275100, '06': 3781500 };
    function mkRows(mk) {
      // 16 arrears sales; closing descending; overdue_days varied. 90+ membership
      // differs between May (s1,s2,s3) and June (s1,s2,s4,s5) → 2 in / 1 out.
      const base = [3200000,2600000,2100000,1700000,1400000,1150000,980000,820000,690000,560000,470000,390000,310000,240000,180000,120000];
      const od90  = mk === '06' ? { s1:120, s2:104, s4:95, s5:92 } : { s1:110, s2:98, s3:93 };
      return base.map((c, i) => {
        const id = 's' + (i + 1);
        let days = 20 + i * 4;                       // spread of overdue days
        if (od90[id] != null) days = od90[id];
        if (mk === '06' && id === 's3') days = 40;   // s3 recovered out of 90+ this month
        return {
          sale_id: id, client_code: 'FG-' + (1000 + i), client_name: ['Imran Khan','Sara Malik','Bilal Ahmed','Ayesha Noor','Usman Tariq','Hina Raza','Kamran Ali','Nadia Shah','Faraz Iqbal','Mehwish Butt','Asad Rauf','Rabia Khan','Tariq Jamil','Sana Mir','Owais Zia','Maria Lodhi'][i],
          unit_no: 'A-' + (101 + i), floor_name: (1 + (i % 8)) + 'th Floor',
          closing: c, overdue_days: days,
          last_payment_date: '2026-' + mk + '-' + String(2 + (i % 9)).padStart(2,'0'), last_payment_amount: 50000 + i * 1000
        };
      });
    }
    function rpTotals(mk) {
      const rt = monthTotals[mk] || 0;
      // received split (sums to received_total): old arrears / current / dp / advance
      const r_old = Math.round(rt * 0.41), r_cur = Math.round(rt * 0.46), r_dp = Math.round(rt * 0.08);
      const r_advance = rt - (r_old + r_cur + r_dp);
      return { received_total: rt, r_old, r_cur, r_dp, r_advance,
        due: 5200000, opening: 9400000, closing: 41800000, recovery_pct: 25.9, row_count: 16 };
    }
    function dailySeries(mk, total, ndays, span) {
      // ndays positive entries within [1..span] summing exactly to total
      const days = []; let acc = 0;
      for (let k = 0; k < ndays; k++) {
        const day = Math.max(1, Math.round((k + 1) * span / ndays) - 1);
        const amt = Math.round(total / ndays);
        days.push({ day: '2026-' + mk + '-' + String(day).padStart(2, '0'), amount: amt }); acc += amt;
      }
      if (days.length) days[days.length - 1].amount += (total - acc);  // fix rounding
      return days;
    }
    const _rpcStub = {
      rpc: async (fn, args) => {
        if (fn === 'get_recovery_position') {
          const mk = String(args.p_to_date || '2026-06-12').slice(5, 7);
          const detailed = (mk === '06' || mk === '05');
          return { data: { totals: rpTotals(mk), rows: detailed ? mkRows(mk) : [], officer_summary: [] }, error: null };
        }
        if (fn === 'get_daily_collections') {
          const mk = String(args.p_to || '2026-06-12').slice(5, 7);
          if (mk === '06') return { data: dailySeries('06', 3781500, 7, 12), error: null };
          if (mk === '05') return { data: dailySeries('05', 12275100, 20, 31), error: null };
          return { data: [], error: null };
        }
        if (fn === 'get_pdc_register') return { data: { rows: [
          { status: 'pending', amount: 450000 }, { status: 'deposited', amount: 300000 }, { status: 'pending', amount: 275000 } ] }, error: null };
        if (fn === 'get_pending_approvals') return { data: [{}, {}], error: null };
        if (fn === 'get_dashboard_receivable') return { data: { receivable: 210697190 }, error: null };
        return { data: null, error: null };
      }
    };
    // Mutate the existing client's rpc method (dashboard uses the real `supabase`
    // binding, not window.supabase), with a window fallback for safety.
    try { if (typeof supabase !== 'undefined' && supabase) supabase.rpc = _rpcStub.rpc; } catch (e) {}
    window.supabase = (typeof supabase !== 'undefined' && supabase) ? supabase : _rpcStub;
    S = { cid: 'fg', userId: 'u', role: 'admin', name: 'Rashid Ali', username: 'admin',
      coName: 'Fourteen Group of companies', coCode: 'fg', permissions: {}, assignedProjectIds: null,
      isProjectAdmin: true, hasFinanceUser: true, subStatus: 'active', sessionVersion: 1 };
    Object.assign(window, { _unitsCache: [], _unitsCacheLoaded: true, _projectsCache: [], _clientsCache: [], _contactLogsCache: [] });
    window.gunits = () => []; window.isOverdue = () => false; window.actualPending = () => 0;
    document.getElementById('s-login').classList.remove('on');
    document.getElementById('s-app').classList.add('on');
    if (typeof stopLoginAnimations === 'function') try { stopLoginAnimations(); } catch (e) {}
    if (typeof buildSB === 'function') buildSB();
    var av=document.getElementById('sb-av'); if(av) av.textContent='R';
    if (typeof updateCoLogo === 'function') try { updateCoLogo(); } catch (e) {}
  });

  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); if (typeof buildSB === 'function') buildSB(); }, theme);
    await page.evaluate(() => rDash());
    await new Promise(r => setTimeout(r, 900));
    await page.screenshot({ path: path.join(OUT, `dashboard_${theme}.png`) });
    // measure: does WHO IS LATE start above the 768 fold?
    const foldOk = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.nx-modal-title')].find(e => /who is late/i.test(e.textContent));
      return h ? Math.round(h.getBoundingClientRect().top) : -1;
    });
    console.log(`[${theme}] "Who is late" top = ${foldOk}px (fold 768)`);
    // scroll to the inflow chart and capture the projection cap
    await page.evaluate(() => { const pw = document.querySelector('.pw'); if (pw) pw.scrollTop = pw.scrollHeight; });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, `inflow_${theme}.png`) });
    await page.evaluate(() => { const pw = document.querySelector('.pw'); if (pw) pw.scrollTop = 0; });
  }

  await browser.close(); srv.close();
  console.log('SHOTS →', OUT);
  console.log('console errors:', errs.length);
  if (errs.length) console.log(errs.slice(0, 15).join('\n'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
