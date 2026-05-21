// ══ DASHBOARD v4.0 — Linear × Stripe × Mercury ══════════════
// Nexunova RMS — Dense. Breathable. Data-forward.
// ════════════════════════════════════════════════════════════

/* ─── SVG icon helpers ──────────────────────────────────────── */
function _ic(p,s=14){return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;}
const _icAlert   =()=>_ic('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>');
const _icTrend   =()=>_ic('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>');
const _icCheck   =(s=14)=>_ic('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',s);
const _icCard    =(s=14)=>_ic('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',s);
const _icPhone   =(s=14)=>_ic('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33A2 2 0 0 1 3.54 1h3a2 2 0 0 1 2 1.72c.127.966.362 1.917.7 2.83a2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.29 6.29l.79-.99a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>',s);
const _icSearch  =(s=14)=>_ic('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',s);
const _icBar     =(s=14)=>_ic('<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',s);
const _icLink    =(s=14)=>_ic('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',s);
const _icHeart   =(s=14)=>_ic('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',s);
const _icCircI   =()=>_ic('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>');

/* ─── Chart registry (destroy before re-init) ───────────────── */
if (!window._dbCI)           window._dbCI = {};
if (!window._dbLastChartData) window._dbLastChartData = null;

/* Re-render charts when theme changes */
document.addEventListener('themechange', function() {
  if (window._dbLastChartData) {
    var d = window._dbLastChartData;
    _dbInitCharts(d.sparkCfg, d.trend6m, d.unitCounts);
  }
});
function _dbDestroyCharts() {
  Object.values(window._dbCI).forEach(c => { try { c.destroy(); } catch(e) {} });
  window._dbCI = {};
}

/* ─── Sparkline data generator ──────────────────────────────── */
function _dbSparkData(endVal, n=7, dir=null) {
  if (!endVal || endVal <= 0) return Array(n).fill(0);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    let base;
    if (dir === 'up')   base = endVal * (0.65 + 0.35 * progress);
    else if (dir === 'dn') base = endVal * (1.00 - 0.30 * progress);
    else                base = endVal * (0.78 + 0.22 * Math.sin(progress * Math.PI * 1.2));
    const noise = (Math.random() - 0.5) * 0.08 * endVal;
    pts.push(Math.max(0, base + noise));
  }
  pts[n - 1] = endVal;
  return pts;
}

/* ─── Chart initialiser ─────────────────────────────────────── */
function _dbInitCharts(sparkCfg, trend6m, unitCounts) {
  if (typeof Chart === 'undefined') return;
  window._dbLastChartData = { sparkCfg: sparkCfg, trend6m: trend6m, unitCounts: unitCounts };
  _dbDestroyCharts();

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const cs       = getComputedStyle(document.documentElement);
  const gridColor  = isDark ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)';
  const tipBg      = cs.getPropertyValue('--x-surface-2').trim() || (isDark ? '#1e2230' : '#F4F6FA');
  const tipText    = cs.getPropertyValue('--x-text').trim()      || (isDark ? '#F4F5F8' : '#0F172A');
  const tipMuted   = cs.getPropertyValue('--x-text-3').trim()    || (isDark ? '#A0A4B5' : '#4B5563');
  const tipBorder  = cs.getPropertyValue('--x-border').trim()    || (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)');
  const tipFont    = { family:'Inter', size:11 };

  function mkSpark(id, data, color, fill) {
    const el = document.getElementById(id);
    if (!el) return;
    window._dbCI[id] = new Chart(el, {
      type: 'line',
      data: {
        labels: data.map((_,i) => i),
        datasets: [{ data, borderColor: color, borderWidth: 1.5,
          fill: true, backgroundColor: fill,
          tension: 0.45, pointRadius: 0, pointHoverRadius: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0 }
        },
        elements: { line: { capBezierPoints: true } }
      }
    });
  }

  mkSpark('db-spark-outstanding', sparkCfg.outstanding, '#DC2626', 'rgba(220,38,38,.06)');
  mkSpark('db-spark-month',       sparkCfg.month,       '#16A34A', 'rgba(22,163,74,.06)');
  mkSpark('db-spark-collected',   sparkCfg.collected,   '#2563EB', 'rgba(37,99,235,.06)');
  mkSpark('db-spark-rate',        sparkCfg.rate,        '#7C3AED', 'rgba(124,58,237,.06)');

  // ── Collection Trend area chart ──────────────────────────────
  const trendEl = document.getElementById('db-chart-trend');
  if (trendEl && trend6m.labels.length) {
    window._dbCI['trend'] = new Chart(trendEl, {
      type: 'line',
      data: {
        labels: trend6m.labels,
        datasets: [{
          data:            trend6m.values,
          borderColor:     '#4F46E5',
          borderWidth:     2,
          fill:            true,
          backgroundColor: isDark
            ? 'rgba(79,70,229,.10)'
            : 'rgba(79,70,229,.07)',
          tension:         0.4,
          pointRadius:     3,
          pointBackgroundColor: '#4F46E5',
          pointBorderColor:     '#fff',
          pointBorderWidth:     1.5,
          pointHoverRadius:     5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tipBg,
            titleColor:      tipMuted,
            bodyColor:       tipText,
            borderColor:     tipBorder,
            borderWidth:     1,
            padding:         10,
            cornerRadius:    6,
            titleFont:       tipFont,
            bodyFont:        { ...tipFont, weight: '600', size: 13 },
            callbacks: {
              label: ctx => ' PKR ' + fM(ctx.raw)
            }
          }
        },
        scales: {
          x: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { font: { family:'Inter', size:11 }, color: tipMuted }
          },
          y: {
            display: false,
            grid:    { color: gridColor, drawBorder: false },
            min:     0
          }
        }
      }
    });
  }

  // ── Unit Status donut ────────────────────────────────────────
  const donutEl = document.getElementById('db-chart-donut');
  if (donutEl) {
    const total = unitCounts.sold + unitCounts.avail + unitCounts.other;
    const hasData = total > 0;
    window._dbCI['donut'] = new Chart(donutEl, {
      type: 'doughnut',
      data: {
        datasets: [{
          data:             hasData ? [unitCounts.sold, unitCounts.avail, unitCounts.other] : [1],
          backgroundColor:  hasData
            ? ['#16A34A', '#4F46E5', '#D97706']
            : [isDark ? '#1e293b' : '#F1F5F9'],
          borderWidth: 0,
          hoverOffset: hasData ? 4 : 0,
        }]
      },
      options: {
        cutout:      '72%',
        responsive:  true,
        maintainAspectRatio: false,
        animation:   { duration: 700 },
        plugins: {
          legend:  { display: false },
          tooltip: {
            enabled:         hasData,
            backgroundColor: tipBg,
            titleColor:      tipMuted,
            bodyColor:       tipText,
            borderColor:     tipBorder,
            borderWidth:     1,
            padding:         10,
            cornerRadius:    6,
            titleFont:       tipFont,
            bodyFont:        { ...tipFont, weight:'600', size:13 },
            callbacks: {
              label: ctx => ' ' + ctx.raw + ' units'
            }
          }
        }
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════
   rDash — main render
════════════════════════════════════════════════════════════ */
async function rDash() {
  // ── Skeleton ─────────────────────────────────────────────
  document.getElementById('pg-dashboard').innerHTML = `<div class="db-skel">
    <div class="db-sb" style="width:200px;height:18px"></div>
    <div class="db-sb" style="height:44px;border-radius:8px"></div>
    <div class="db-sb" style="width:140px;height:11px"></div>
    <div class="db-sk-kpis">${[0,1,2,3].map(()=>`<div class="db-sb db-sk-kpi"></div>`).join('')}</div>
    <div class="db-sb" style="width:110px;height:11px"></div>
    <div class="db-sb" style="height:56px;border-radius:10px"></div>
    <div class="db-sb" style="width:110px;height:11px"></div>
    <div class="db-sk-r1">
      <div class="db-sb db-sk-col" style="height:220px"></div>
      <div class="db-sb db-sk-col" style="height:220px"></div>
    </div>
    <div class="db-sk-r2">
      <div class="db-sb db-sk-col" style="height:240px"></div>
      <div class="db-sb db-sk-col" style="height:240px"></div>
    </div>
    <div class="db-sb" style="width:110px;height:11px"></div>
    <div class="db-sk-r3">
      <div class="db-sb db-sk-col" style="height:260px"></div>
      <div class="db-sb db-sk-col" style="height:260px"></div>
    </div>
  </div>`;

  // ── Core calculations ────────────────────────────────────
  const units     = gunits(), t = td();
  const od        = getOverdueDays();
  const soldUnits = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
  const totalU    = units.length;
  const soldU     = soldUnits.length;
  const availU    = units.filter(u => u.status === 'Available').length;
  const otherU    = Math.max(0, totalU - soldU - availU);

  const totalR        = soldUnits.reduce((s,u) => s + actualPaid(u), 0);
  const outstand      = soldUnits.reduce((s,u) => s + actualPending(u), 0);
  const totalPortfolio= soldUnits.reduce((s,u) => s + Number(u.totalPrice||0), 0);
  const recovPct      = totalPortfolio > 0 ? Math.round(totalR / totalPortfolio * 100) : 0;
  const soldPct       = totalU > 0 ? Math.round(soldU / totalU * 100) : 0;

  const overdueUnits = soldUnits
    .filter(u => isOverdue(u, od) && actualPending(u) > 0)
    .sort((a, b) => actualPending(b) - actualPending(a));

  const fus = gfus();
  const fuAlerts = fus.overdue.length + fus.today.length;

  // ── Month-over-month + 6-month trend ────────────────────
  const ms       = (() => { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); })();
  const prevMs   = (() => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10); })();
  const sixMoAgo = (() => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-5); return d.toISOString().slice(0,10); })();

  let monthR=0, prevMonthR=0, recentRecs=[], trend6m={labels:[],values:[]};

  try {
    const [
      {data:mpRows=[]},
      {data:prevRows=[]},
      {data:trendRows=[]}
    ] = await Promise.all([
      supabase.from('payments').select('id,sale_id,payment_date,amount,payment_method')
        .eq('company_id', S.cid).gte('payment_date', ms)
        .order('payment_date', {ascending:false}).limit(100),
      supabase.from('payments').select('amount')
        .eq('company_id', S.cid).gte('payment_date', prevMs).lt('payment_date', ms),
      supabase.from('payments').select('payment_date,amount')
        .eq('company_id', S.cid).gte('payment_date', sixMoAgo)
        .order('payment_date', {ascending:true}),
    ]);

    monthR     = mpRows.reduce((s,r) => s + Number(r.amount||0), 0);
    prevMonthR = prevRows.reduce((s,r) => s + Number(r.amount||0), 0);

    // Map sale_id → unit_id for recent recs
    const rSids = [...new Set(mpRows.map(r => r.sale_id).filter(Boolean))];
    let rSmMap = {};
    if (rSids.length) {
      const {data:rSd=[]} = await supabase.from('sales').select('id,unit_id').in('id', rSids);
      rSd.forEach(s => { rSmMap[s.id] = s.unit_id; });
    }
    recentRecs = mpRows.slice(0,6).map(r => ({...r, unitId: rSmMap[r.sale_id]||null}));

    // Build 6-month trend
    const monthMap = {};
    trendRows.forEach(r => {
      const k = r.payment_date.slice(0,7);
      monthMap[k] = (monthMap[k]||0) + Number(r.amount||0);
    });
    for (let i=5; i>=0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
      const k = d.toISOString().slice(0,7);
      trend6m.labels.push(d.toLocaleDateString('en-US',{month:'short'}));
      trend6m.values.push(monthMap[k]||0);
    }
  } catch(e) { console.warn('[rDash] payments query failed', e); }

  // ── Trend chip ───────────────────────────────────────────
  const _trendPct = prevMonthR > 0 ? Math.round((monthR - prevMonthR) / prevMonthR * 100) : null;
  const _trendHtml = _trendPct !== null
    ? `<div class="db-trend ${_trendPct>=0?'up':'dn'}">${_ic(_trendPct>=0?'<polyline points="18 15 12 9 6 15"/>':'<polyline points="6 9 12 15 18 9"/>',10)} ${_trendPct>=0?'+':''}${_trendPct}%</div>`
    : '';

  // ── Sparkline data ───────────────────────────────────────
  const sparkCfg = {
    outstanding: _dbSparkData(outstand,   7, overdueUnits.length>0?'dn':null),
    month:       _dbSparkData(monthR,     7, _trendPct!=null&&_trendPct>=0?'up':'dn'),
    collected:   _dbSparkData(totalR,     7, 'up'),
    rate:        _dbSparkData(recovPct,   7, recovPct>=60?'up':null),
  };

  const longDate = new Date().toLocaleDateString('en-US', {weekday:'long', day:'numeric', month:'long', year:'numeric'});

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  document.getElementById('pg-dashboard').innerHTML = `<div class="db ani">

  <!-- A. OVERDUE ALERT STRIP -->
  ${overdueUnits.length > 0 ? `
  <div class="db-strip-alert">
    <span class="db-strip-alert-ic">${_icAlert()}</span>
    <span class="db-strip-alert-txt">
      <b>${overdueUnits.length}</b> installment${overdueUnits.length!==1?'s':''} overdue
      · <b>PKR ${fM(overdueUnits.reduce((s,u)=>s+actualPending(u),0))}</b> outstanding
    </span>
    <button class="db-strip-alert-btn" onclick="nav('reports')">View overdue →</button>
  </div>` : ''}

  <!-- ACTION BAR -->
  <div class="db-actions">
    <button class="db-btn primary" onclick="nav('addpayment')">${_icCard(13)} Add Payment</button>
    <button class="db-btn" onclick="openConModal(null)">${_icPhone(13)} Log a Call</button>
    <button class="db-btn" onclick="nav('search')">${_icSearch(13)} Find Unit</button>
    <button class="db-btn" onclick="nav('reports')">${_icBar(13)} Reports</button>
    <button class="db-btn" onclick="nav('paylinks')">${_icLink(13)} Payment Links</button>
  </div>

  <!-- B. SECTION: FINANCIAL OVERVIEW -->
  <div class="db-sec">Financial Overview</div>

  <!-- C. KPI ROW -->
  <div class="db-kpis">

    <div class="db-kpi" onclick="nav('reports')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic red">${_ic('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',15)}</div>
        ${overdueUnits.length > 0
          ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${overdueUnits.length} overdue</div>`
          : ''}
      </div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(outstand)}</div>
      <div class="db-kpi-lbl">Outstanding</div>
      <div class="db-kpi-sub">${overdueUnits.length>0?overdueUnits.length+' units past due':'All units current'}</div>
      <div class="db-spark-wrap"><canvas id="db-spark-outstanding"></canvas></div>
    </div>

    <div class="db-kpi" onclick="nav('recovery')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic green">${_ic('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',15)}</div>
        ${_trendHtml}
      </div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(monthR)}</div>
      <div class="db-kpi-lbl">This Month</div>
      <div class="db-kpi-sub">${recentRecs.length} payment${recentRecs.length!==1?'s':''} received</div>
      <div class="db-spark-wrap"><canvas id="db-spark-month"></canvas></div>
    </div>

    <div class="db-kpi" onclick="nav('recovery')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic blue">${_ic('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',15)}</div>
      </div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(totalR)}</div>
      <div class="db-kpi-lbl">Total Collected</div>
      <div class="db-kpi-sub">${soldU} active sale${soldU!==1?'s':''}</div>
      <div class="db-spark-wrap"><canvas id="db-spark-collected"></canvas></div>
    </div>

    <div class="db-kpi" onclick="nav('reports')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic purple">${_ic('<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',15)}</div>
        ${recovPct >= 75
          ? `<div class="db-trend up">${_ic('<polyline points="18 15 12 9 6 15"/>',9)} On track</div>`
          : recovPct > 0 ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${recovPct < 40 ? 'Critical' : 'Monitor'}</div>` : ''}
      </div>
      <div class="db-kpi-val">${recovPct}%</div>
      <div class="db-kpi-lbl">Recovery Rate</div>
      <div class="db-kpi-sub">of PKR ${fMH(totalPortfolio)} portfolio</div>
      <div class="db-spark-wrap"><canvas id="db-spark-rate"></canvas></div>
    </div>

  </div>

  <!-- D. SECTION: INVENTORY -->
  <div class="db-sec">Inventory</div>

  <!-- E. INVENTORY STRIP -->
  <div class="db-inv">
    <div class="db-inv-item" onclick="nav('units')">
      <span class="db-inv-n">${totalU}</span>
      <span class="db-inv-lbl">Total Units</span>
    </div>
    <div class="db-inv-div"></div>
    <div class="db-inv-item" onclick="nav('units')">
      <span class="db-inv-n"><span class="db-inv-dot" style="background:#16A34A"></span>${soldU}</span>
      <span class="db-inv-lbl">Sold</span>
    </div>
    <div class="db-inv-div"></div>
    <div class="db-inv-item" onclick="nav('units')">
      <span class="db-inv-n"><span class="db-inv-dot" style="background:#94A3B8"></span>${availU}</span>
      <span class="db-inv-lbl">Available</span>
    </div>
    <div class="db-inv-div db-xs-hide"></div>
    <div class="db-inv-item db-xs-hide" onclick="nav('units')">
      <div class="db-inv-ring">
        <svg width="32" height="32">
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--border-color)" stroke-width="3"/>
          <circle cx="16" cy="16" r="13" fill="none" stroke="#4F46E5" stroke-width="3"
            stroke-dasharray="${totalU>0?Math.round(soldPct/100*81.68):0} 81.68"
            stroke-linecap="round"/>
        </svg>
        <span class="db-inv-ring-txt">${soldPct}%</span>
      </div>
      <span class="db-inv-lbl">Sold Rate</span>
    </div>
    <div class="db-inv-div db-xs-hide"></div>
    <div class="db-inv-item no-click db-xs-hide">
      <div class="db-fill-wrap">
        <div class="db-fill-bar"><div class="db-fill-inner" style="width:${soldPct}%"></div></div>
        <span class="db-fill-pct">${soldPct}%</span>
      </div>
      <span class="db-inv-lbl">Portfolio fill</span>
    </div>
  </div>

  <!-- F. SECTION: OPERATIONS -->
  <div class="db-sec">Operations</div>

  <!-- G. ROW 1: Collection Trend + Unit Status -->
  <div class="db-grid-r1">

    <!-- Collection Trend Chart -->
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icTrend()} Collection Trend</p>
          <p class="db-card-sub">Monthly payments received</p>
        </div>
        <div class="db-pills">
          <button class="db-pill on" onclick="_dbSetRange(this,1)">1M</button>
          <button class="db-pill"    onclick="_dbSetRange(this,3)">3M</button>
          <button class="db-pill"    onclick="_dbSetRange(this,6)">6M</button>
        </div>
      </div>
      <div class="db-chart-wrap" style="height:170px;padding-top:16px">
        <canvas id="db-chart-trend"></canvas>
      </div>
    </div>

    <!-- Unit Status Donut -->
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_ic('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',14)} Unit Status</p>
          <p class="db-card-sub">${totalU} total units</p>
        </div>
      </div>
      <div class="db-donut-body">
        <div class="db-donut-center">
          <div class="db-donut-n">${totalU}</div>
          <div class="db-donut-lbl">Total Units</div>
        </div>
        <div style="height:130px;position:relative">
          <canvas id="db-chart-donut"></canvas>
        </div>
        <div class="db-legend">
          <div class="db-legend-row">
            <div class="db-legend-dot" style="background:#16A34A"></div>
            <span class="db-legend-lbl">Sold / Active</span>
            <span class="db-legend-n">${soldU}</span>
          </div>
          <div class="db-legend-row">
            <div class="db-legend-dot" style="background:#4F46E5"></div>
            <span class="db-legend-lbl">Available</span>
            <span class="db-legend-n">${availU}</span>
          </div>
          ${otherU > 0 ? `<div class="db-legend-row">
            <div class="db-legend-dot" style="background:#D97706"></div>
            <span class="db-legend-lbl">Other / Dead</span>
            <span class="db-legend-n">${otherU}</span>
          </div>` : ''}
        </div>
      </div>
    </div>

  </div>

  <!-- G. ROW 2: Overdue List + Client Health widget -->
  <div class="db-grid-r2">

    <!-- Overdue Units -->
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icCircI()} Overdue — ${od}+ Days
            <span style="font-size:11px;font-weight:500;padding:1px 7px;border-radius:99px;
              background:${overdueUnits.length?'#FEE2E2':'#DCFCE7'};
              color:${overdueUnits.length?'#B91C1C':'#15803D'};margin-left:4px">
              ${overdueUnits.length}
            </span>
          </p>
          <p class="db-card-sub">${overdueUnits.length?'Sorted by highest outstanding':'All units are current'}</p>
        </div>
        <button class="db-btn" onclick="nav('reports')">View all</button>
      </div>
      ${!overdueUnits.length
        ? `<div class="db-empty"><span class="db-empty-ic">${_icCheck(28)}</span><p class="db-empty-tx">No overdue units</p></div>`
        : overdueUnits.slice(0,6).map((u,i) => {
            const d2   = daysSincePay(u);
            const sev  = overdueSeverity(u);
            const clr  = sev==='critical'?'#DC2626':'#D97706';
            const subCls = sev==='critical'?'':'warn';
            const nm   = (u.customerName||'').substring(0,20)+((u.customerName||'').length>20?'…':'');
            return `<div class="db-row" onclick="openUD('${u.id}')">
              <div class="db-row-rk">${i+1}</div>
              <div class="db-row-dot" style="background:${clr}"></div>
              <div class="db-row-i">
                <div class="db-row-nm">${esc(u.unitNo)} · ${esc(nm)}</div>
                <div class="db-row-sb ${subCls}">${d2===null?'Never paid':d2+' days since last payment'}</div>
              </div>
              <div class="db-row-amt" style="color:${clr}">PKR ${fMH(actualPending(u))}</div>
            </div>`;
          }).join('')
      }
      ${overdueUnits.length > 6
        ? `<button class="db-more" onclick="nav('reports')">+${overdueUnits.length-6} more — Open Reports</button>`
        : ''}
    </div>

    <!-- Client Health — populated by _rDashHealth() -->
    <div id="d-health-widget"></div>

  </div>

  <!-- H. SECTION: ACTIVITY -->
  <div class="db-sec">Activity</div>

  <!-- I. BOTTOM GRID: Recent Payments + Recovery Radar -->
  <div class="db-grid-r3">

    <!-- Recent Payments -->
    ${recentRecs.length ? `
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icCard()} Recent Payments</p>
          <p class="db-card-sub">Last ${recentRecs.length} payment${recentRecs.length!==1?'s':''} this month</p>
        </div>
        <button class="db-btn" onclick="nav('recovery')">All Payments →</button>
      </div>
      <div class="db-tbl-wrap">
        <table class="db-tbl">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Customer</th>
              <th class="db-xs-hide">Method</th>
              <th class="db-xs-hide">Date</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${recentRecs.map(r => {
              const u = r.unitId ? gunit(r.unitId) : null;
              const m = r.payment_method||'';
              const mCls = m==='cash'?'cash':m==='cheque'?'cheque':m==='pdc'?'pdc':m==='bank_transfer'?'bank':'other';
              const mLbl = m==='bank_transfer'?'Bank':m==='cheque'?'Cheque':m==='cash'?'Cash':m==='pdc'?'PDC':(m||'—');
              return `<tr onclick="${r.unitId?`openUD('${r.unitId}')`:'void 0'}" style="cursor:${r.unitId?'pointer':'default'}">
                <td><span class="db-unit-chip">${esc(u?.unitNo||'—')}</span></td>
                <td class="db-tbl-mute">${esc((u?.customerName||'—').substring(0,22))}</td>
                <td class="db-xs-hide"><span class="db-meth-badge ${mCls}">${mLbl}</span></td>
                <td class="db-xs-hide db-tbl-mute">${r.payment_date||'—'}</td>
                <td class="db-tbl-amt">+${fM(Number(r.amount))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icCard()} Recent Payments</p>
          <p class="db-card-sub">No payments this month yet</p>
        </div>
        <button class="db-btn" onclick="nav('recovery')">All Payments →</button>
      </div>
      <div class="db-empty"><span class="db-empty-ic">${_icCard(28)}</span><p class="db-empty-tx">No payments recorded this month</p></div>
    </div>`}

    <!-- Recovery Radar — populated by _rDashRadar() -->
    <div id="d-radar-widget"></div>

  </div>

  <!-- J. PROMISES STRIP — populated by _rDashPromises() -->
  <div id="d-promises-widget"></div>

  <!-- PAYMENT LINKS WIDGET -->
  <div id="d-paylinks-widget"></div>

  <!-- AUDIT WIDGET (admin only) -->
  <div id="d-audit-widget"></div>

  </div>`; // end .db.ani

  // ── Init charts after DOM ready ──────────────────────────
  requestAnimationFrame(() => {
    _dbInitCharts(sparkCfg, trend6m, { sold:soldU, avail:availU, other:otherU });
  });

  // ── Widget renders ───────────────────────────────────────
  if (typeof initDashCounters === 'function') initDashCounters();
  _rDashHealth();
  _rDashRadar();
  _rDashPromises();
  if (S.role === 'admin' && typeof _rDashAuditWidget === 'function') _rDashAuditWidget();
  _rDashPayLinks();
}

/* ─── Range pill handler ─────────────────────────────────────── */
function _dbSetRange(btn, months) {
  btn.closest('.db-pills').querySelectorAll('.db-pill').forEach(p => p.classList.remove('on'));
  btn.classList.add('on');
  const chart = window._dbCI['trend'];
  if (!chart || !chart.data.labels) return;
  // Slice from the right to show `months` points out of 6
  const allLabels = chart._fullLabels || chart.data.labels.slice();
  const allData   = chart._fullData   || chart.data.datasets[0].data.slice();
  if (!chart._fullLabels) { chart._fullLabels = allLabels; chart._fullData = allData; }
  const n = Math.min(months, allLabels.length);
  chart.data.labels = allLabels.slice(-n);
  chart.data.datasets[0].data = allData.slice(-n);
  chart.update();
}

/* ════════════════════════════════════════════════════════════
   _rDashHealth — Client Health widget
════════════════════════════════════════════════════════════ */
async function _rDashHealth() {
  const el = document.getElementById('d-health-widget');
  if (!el) return;

  const { data, error } = await supabase.rpc('get_health_dashboard_stats', { p_company_id: S.cid });
  if (error || !data) return;

  const criticalCount    = data.critical?.count    || 0;
  const criticalExposure = data.critical?.exposure  || 0;
  const atRiskExposure   = data.total_at_risk_exposure || 0;

  const alertBanner = criticalCount > 0 ? `
    <div style="padding:14px 18px 0">
      <div class="db-walert red">
        <div class="db-walert-bd">
          ${_icAlert()}
          <div class="db-walert-body">
            <div class="db-walert-title">${criticalCount} client${criticalCount!==1?'s':''} in CRITICAL — PKR ${fM(criticalExposure)} at risk</div>
            <div class="db-walert-sub">Total at-risk: PKR ${fM(atRiskExposure)}</div>
          </div>
        </div>
        <button class="db-btn" onclick="nav('healthcenter')">View →</button>
      </div>
    </div>` : '';

  const cats = [
    { key:'platinum', label:'PLATINUM', cls:'platinum' },
    { key:'good',     label:'GOOD',     cls:'good'     },
    { key:'at_risk',  label:'AT RISK',  cls:'at-risk'  },
    { key:'critical', label:'CRITICAL', cls:'critical'  },
  ];

  const cells = cats.map(c => {
    const d = data[c.key] || { count:0, exposure:0 };
    return `<div class="db-hcell ${c.cls}" onclick="nav('healthcenter')">
      <div class="db-hcell-hd">
        <div class="db-hcell-dot"></div>
        <span class="db-hcell-lbl">${c.label}</span>
      </div>
      <div class="db-hcell-n">${d.count}</div>
      <div class="db-hcell-amt">PKR ${fM(d.exposure)}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icHeart()} Client Health</p>
          <p class="db-card-sub">${data.total_clients || 0} clients scored</p>
        </div>
        <button class="db-btn" onclick="nav('healthcenter')">Health Center →</button>
      </div>
      ${alertBanner}
      <div class="db-health-grid">${cells}</div>
    </div>`;
}

/* ─── Legacy kpiCard (other pages) ──────────────────────────── */
function kpiCard({accent,icon,label,value,sub,color,mono,clickable,onclick}){
  return `<div class="kpi" style="--ka:${accent};--kc:${color||'var(--text)'};${clickable?'cursor:pointer':'cursor:default'}" ${clickable&&onclick?`onclick="${onclick}"`:''}
    onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='var(--sh2)'"
    onmouseout="this.style.transform='';this.style.boxShadow=''">
    <div class="kpi-lbl"><span class="kpi-lbl-dot"></span>${label}</div>
    <div class="kpi-val">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

function getGreeting(){
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/* ════════════════════════════════════════════════════════════
   _rDashPayLinks — Payment Links widget
════════════════════════════════════════════════════════════ */
async function _rDashPayLinks() {
  const el = document.getElementById('d-paylinks-widget');
  if (!el) return;

  let plData = {};
  try {
    const { data, error } = await supabase.rpc('get_payment_link_stats', { p_company_id: S.cid, p_days: 30 });
    if (!error && data) plData = data;
  } catch(e) { console.warn('[paylinks widget]', e); }

  const _plTotal = (plData.total_sent||0) + (plData.verified||0) + (plData.pending_verification||0);
  if (_plTotal === 0) return;

  const pending   = plData.pending_verification || 0;
  const sent      = plData.total_sent           || 0;
  const verified  = plData.verified             || 0;
  const rate      = plData.success_rate         || 0;
  const collected = plData.total_collected      || 0;

  const pendingBanner = pending > 0 ? `
    <div style="padding:14px 18px 0">
      <div class="db-walert orange">
        <div class="db-walert-bd">
          ${_icAlert()}
          <div class="db-walert-body">
            <div class="db-walert-title">${pending} screenshot${pending!==1?'s':''} awaiting verification</div>
            <div class="db-walert-sub">Review and generate PRV vouchers</div>
          </div>
        </div>
        <button class="db-btn" onclick="plSetTab('screenshot_received');nav('paylinks')"
          style="background:rgba(249,115,22,.10);color:#ea580c;border-color:rgba(249,115,22,.25)">Verify →</button>
      </div>
    </div>` : '';

  const statCells = [
    { cls:'amber',                       label:'Awaiting', val: sent     },
    { cls: pending>0?'orange':'amber',   label:'Pending',  val: pending  },
    { cls:'green',                       label:'Verified', val: verified  },
    { cls:'indigo',                      label:'Success',  val: rate+'%' },
  ].map(c => `<div class="db-wcat ${c.cls}" onclick="nav('paylinks')">
    <div class="db-wcat-hd"><div class="db-wcat-dot"></div><span class="db-wcat-lbl">${c.label}</span></div>
    <div class="db-wcat-n">${c.val}</div>
  </div>`).join('');

  el.innerHTML = `
    <div class="db-card" style="margin-top:0">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icLink()} Payment Links</p>
          <p class="db-card-sub">Last 30 days · PKR ${fM(collected)} collected</p>
        </div>
        <button class="db-btn" onclick="nav('paylinks')">View all →</button>
      </div>
      ${pendingBanner}
      <div style="padding:14px 18px">
        <div class="db-wcats">${statCells}</div>
      </div>
    </div>`;
}
