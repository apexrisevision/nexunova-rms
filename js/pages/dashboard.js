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
          borderColor:     '#2563EB',
          borderWidth:     2,
          fill:            true,
          backgroundColor: isDark
            ? 'rgba(37,99,235,.10)'
            : 'rgba(37,99,235,.07)',
          tension:         0.4,
          pointRadius:     3,
          pointBackgroundColor: '#2563EB',
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
            ? ['#16A34A', '#2563EB', '#D97706']
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
   rDash — role router
════════════════════════════════════════════════════════════ */
async function rDash() {
  _dbDestroyCharts();
  const role = effectiveRole();
  if (role === 'recovery')                    return _rDashRecovery();
  if (role === 'accounts')                    return _rDashAccounts();
  if (role === 'manager' || role === 'staff') return _rDashManagerStaff();
  await _rDashAdmin();
}

/* ════════════════════════════════════════════════════════════
   _rDashAdmin — Admin / Owner dashboard
════════════════════════════════════════════════════════════ */
async function _rDashAdmin() {
  // ── Skeleton ─────────────────────────────────────────────
  document.getElementById('pg-dashboard').innerHTML = `<div class="db-skel">
    <div class="db-sk-kpis">${[0,1,2,3].map(()=>`<div class="db-sb" style="height:88px;border-radius:10px"></div>`).join('')}</div>
    <div class="db-sk-r1">
      <div class="db-sb db-sk-col" style="height:220px"></div>
      <div class="db-sb db-sk-col" style="height:220px"></div>
    </div>
    <div class="db-sk-r2">
      <div class="db-sb db-sk-col" style="height:240px"></div>
      <div class="db-sb db-sk-col" style="height:240px"></div>
    </div>
    <div class="db-sb" style="height:72px;border-radius:10px"></div>
  </div>`;

  // ── Core calculations ────────────────────────────────────
  const units      = gunits();
  const od         = getOverdueDays();
  const soldUnits  = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
  const soldU      = soldUnits.length;
  const availU     = units.filter(u => u.status === 'Available').length;
  const otherU     = Math.max(0, units.length - soldU - availU);

  const totalR         = soldUnits.reduce((s,u) => s + actualPaid(u), 0);
  const outstand       = soldUnits.reduce((s,u) => s + actualPending(u), 0);
  const totalPortfolio = soldUnits.reduce((s,u) => s + Number(u.totalPrice||0), 0);
  const recovPct       = totalPortfolio > 0 ? Math.round(totalR / totalPortfolio * 100) : 0;

  const overdueUnits = soldUnits
    .filter(u => isOverdue(u, od) && actualPending(u) > 0)
    .sort((a,b) => actualPending(b) - actualPending(a));

  const fus = gfus();

  // ── KPI RPC ───────────────────────────────────────────────
  let monthR=0, prevMonthR=0, recentRecs=[], trend6m={labels:[],values:[]};

  try {
    const { data: k } = await supabase.rpc('get_dashboard_kpis', { p_company_id: S.cid });
    if (k?.success) {
      monthR     = Number(k.this_month_collection  || 0);
      prevMonthR = Number(k.prev_month_collection  || 0);
      recentRecs = Array.isArray(k.recent_payments) ? k.recent_payments : [];
      (Array.isArray(k.trend_6m) ? k.trend_6m : []).forEach(t => {
        trend6m.labels.push(t.month);
        trend6m.values.push(Number(t.total || 0));
      });
    }
  } catch(e) { console.warn('[rDash] KPI RPC failed', e); }

  // ── 30-day daily bar data ─────────────────────────────────
  let barData = [];
  try {
    const from30 = new Date(); from30.setDate(from30.getDate() - 29);
    const { data: coll } = await supabase.rpc('get_collection_report', {
      p_company_id: S.cid,
      p_from_date:  from30.toISOString().slice(0,10),
      p_to_date:    new Date().toISOString().slice(0,10)
    });
    if (Array.isArray(coll) && coll.length > 0) {
      const byDate = {};
      coll.forEach(r => { byDate[r.payment_date] = (byDate[r.payment_date]||0) + Number(r.amount||0); });
      for (let i = 29; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0,10);
        barData.push({ label: d.getDate()+'/'+(d.getMonth()+1), amount: byDate[ds]||0 });
      }
    }
  } catch(_) {}
  if (!barData.length && trend6m.labels.length) {
    barData = trend6m.labels.map((l,i) => ({ label: l, amount: trend6m.values[i] }));
  }

  // ── Trend chip ────────────────────────────────────────────
  const _trendPct  = prevMonthR > 0 ? Math.round((monthR - prevMonthR) / prevMonthR * 100) : null;
  const _trendHtml = _trendPct !== null
    ? `<div class="db-trend ${_trendPct>=0?'up':'dn'}">${_ic(_trendPct>=0?'<polyline points="18 15 12 9 6 15"/>':'<polyline points="6 9 12 15 18 9"/>',10)} ${_trendPct>=0?'+':''}${_trendPct}% vs last mo</div>`
    : '';

  // ── Radar alerts (computed from overdueUnits) ─────────────
  const _radarCards = [];
  const _seen = new Set();
  const _addRadar = (color, label, u) => {
    if (!u || _seen.has(u.id)) return;
    _seen.add(u.id);
    const days = daysSincePay(u) || 0;
    _radarCards.push({ color, label,
      unit: u.unitNo||'—', client: (u.customerName||'').substring(0,22),
      days, amount: actualPending(u), id: u.id });
  };
  if (overdueUnits.length) {
    const byCritical = [...overdueUnits].sort((a,b)=>(daysSincePay(b)||0)-(daysSincePay(a)||0));
    _addRadar('#DC2626', 'Critical Overdue',   byCritical[0]);
    _addRadar('#D97706', 'Highest Outstanding', overdueUnits[0]);
    const neverPaid = overdueUnits.find(u => !Number(u.totalPaid||0));
    _addRadar('#2563EB', 'No Payment Yet', neverPaid || overdueUnits[overdueUnits.length-1]);
  }

  // ── Today's follow-ups ────────────────────────────────────
  const fuToday = [...fus.today, ...fus.overdue].slice(0, 5);

  const _sparkCfg = {
    outstanding: _dbSparkData(outstand,   7, overdueUnits.length>0?'dn':null),
    month:       _dbSparkData(monthR,     7, _trendPct!=null&&_trendPct>=0?'up':'dn'),
    collected:   _dbSparkData(totalR,   7, 'up'),
    rate:        _dbSparkData(recovPct, 7, recovPct>=60?'up':null),
  };

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  document.getElementById('pg-dashboard').innerHTML = `<div class="db ani">

  <!-- ROW 1: 4 KPI cards — max 90px, accent left border -->
  <div class="db-kpis">

    <!-- 1. Total Outstanding — red -->
    <div class="db-kpi db-kpi-accent-red" onclick="nav('reports')" style="cursor:pointer">
      <div class="db-kpi-row">
        <div class="db-kpi-ic red">${_ic('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',14)}</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">Total Outstanding</div>
          <div class="db-kpi-val db-kpi-val-sm" title="PKR ${fMH(outstand)}"><span class="db-pkr">PKR</span>${fLakhCr(outstand)}</div>
          <div class="db-kpi-sub">${overdueUnits.length>0?overdueUnits.length+' units overdue':'All current'}</div>
        </div>
        ${overdueUnits.length>0?`<div class="db-trend dn" style="align-self:flex-start;margin-top:2px">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${overdueUnits.length}</div>`:''}
      </div>
    </div>

    <!-- 2. This Month Collection — green -->
    <div class="db-kpi db-kpi-accent-green" onclick="nav('recovery')" style="cursor:pointer">
      <div class="db-kpi-row">
        <div class="db-kpi-ic green">${_ic('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',14)}</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">This Month Collection</div>
          <div class="db-kpi-val db-kpi-val-sm" title="PKR ${fMH(monthR)}"><span class="db-pkr">PKR</span>${fLakhCr(monthR)}</div>
          <div class="db-kpi-sub">${recentRecs.length} payment${recentRecs.length!==1?'s':''} received</div>
        </div>
        ${_trendHtml ? `<div style="align-self:flex-start;margin-top:2px">${_trendHtml}</div>` : ''}
      </div>
    </div>

    <!-- 3. Total Portfolio Value — blue -->
    <div class="db-kpi db-kpi-accent-blue" onclick="nav('projects')" style="cursor:pointer">
      <div class="db-kpi-row">
        <div class="db-kpi-ic blue">${_ic('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',14)}</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">Total Portfolio Value</div>
          <div class="db-kpi-val db-kpi-val-sm" title="PKR ${fMH(totalPortfolio)}"><span class="db-pkr">PKR</span>${fLakhCr(totalPortfolio)}</div>
          <div class="db-kpi-sub">${soldU} active sale${soldU!==1?'s':''} · ${availU} available</div>
        </div>
      </div>
    </div>

    <!-- 4. Recovery Rate — amber -->
    <div class="db-kpi db-kpi-accent-amber" onclick="nav('reports')" style="cursor:pointer">
      <div class="db-kpi-row">
        <div class="db-kpi-ic amber">${_ic('<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',14)}</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">Recovery Rate</div>
          <div class="db-kpi-val db-kpi-val-sm">${recovPct}<span style="font-size:14px;font-weight:500;color:var(--text-muted);margin-left:2px">%</span></div>
          <div class="db-kpi-sub">PKR ${fMH(totalR)} of ${fMH(totalPortfolio)} collected</div>
        </div>
        <div class="db-trend ${recovPct>=75?'up':recovPct>0?'dn':''}" style="align-self:flex-start;margin-top:2px">${recovPct>=75?'On track':recovPct>0&&recovPct<40?'Critical':recovPct>0?'Monitor':''}</div>
      </div>
    </div>

  </div>

  <!-- ROW 2: Collection Trend (full width — Today's Follow-ups moved to Recovery Dashboard) -->
  <div>

    <!-- 30-day bar chart -->
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icBar()} Collection Trend</p>
          <p class="db-card-sub">Last 30 days — daily payments received</p>
        </div>
        <button class="db-btn" onclick="nav('recovery')">${_icBar(12)} View All</button>
      </div>
      <div class="db-chart-wrap" style="height:180px;padding-top:10px">
        <canvas id="db-chart-bar30"></canvas>
      </div>
    </div>

  </div>

  <!-- ROW 3: Recent Payments (full width — Top Overdue Units moved to Recovery Dashboard) -->
  <div>

    <!-- Recent Payments -->
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icCard()} Recent Payments</p>
          <p class="db-card-sub">Last 5 payments logged</p>
        </div>
        <button class="db-btn" onclick="nav('receipts')">All →</button>
      </div>
      ${!recentRecs.length
        ? `<div class="db-empty"><span class="db-empty-ic">${_icCard(24)}</span><p class="db-empty-tx">No payments this month</p></div>`
        : `<div class="db-tbl-wrap"><table class="db-tbl">
            <thead><tr><th>Date</th><th>Client</th><th>Unit</th><th>Method</th><th>Amount</th></tr></thead>
            <tbody>${recentRecs.slice(0,5).map(r=>{
              const u  = r.unitId?gunit(r.unitId):null;
              const m  = (r.payment_method||'').toLowerCase();
              const mc = m==='bank_transfer'?'bank':m==='cheque'?'cheque':m==='cash'?'cash':m==='pdc'?'pdc':'other';
              const ml = m==='bank_transfer'?'Bank':m==='cheque'?'Cheque':m==='cash'?'Cash':m==='pdc'?'PDC':'Other';
              return `<tr onclick="${r.unitId?`openUD('${r.unitId}')`:'void 0'}" style="cursor:${r.unitId?'pointer':'default'}">
                <td class="db-tbl-mute" style="white-space:nowrap">${r.payment_date||'—'}</td>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((r.client_name||u?.customerName||'—').substring(0,18))}</td>
                <td><span class="db-unit-chip">${esc(u?.unitNo||r.unit_number||'—')}</span></td>
                <td><span class="db-meth-badge ${mc}">${ml}</span></td>
                <td class="db-tbl-amt">PKR ${fM(Number(r.amount))}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`
      }
    </div>

  </div>

  <!-- RADAR STRIP: top 3 alerts -->
  ${_radarCards.length ? `
  <div class="db-radar-inline-strip">
    <div class="db-radar-strip-label">${_icSearch(12)} AI Recovery Radar</div>
    <div class="db-radar-strip-cards">
      ${_radarCards.slice(0,3).map(r=>`
        <div class="db-radar-inline-card" style="border-left-color:${r.color}" onclick="openUD('${r.id}')">
          <div class="db-ric-top">
            <span class="db-ric-label" style="color:${r.color}">${r.label}</span>
            <span class="db-ric-amt">PKR ${fM(r.amount)}</span>
          </div>
          <div class="db-ric-name">${esc(r.client)}</div>
          <div class="db-ric-meta">${esc(r.unit)} · ${r.days>0?r.days+' days overdue':'Never paid'}</div>
        </div>`).join('')}
    </div>
  </div>` : ''}

  </div>`; // end .db.ani

  // ── Init bar chart after DOM ready ──────────────────────
  requestAnimationFrame(() => _dbInitBar30(barData));
}

/* ─── 30-day bar chart initialiser ─────────────────────────── */
function _dbInitBar30(data) {
  if (typeof Chart === 'undefined') return;
  const el = document.getElementById('db-chart-bar30');
  if (!el) return;
  if (window._dbCI['bar30']) { try { window._dbCI['bar30'].destroy(); } catch(_) {} }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const cs     = getComputedStyle(document.documentElement);
  const tipBg  = cs.getPropertyValue('--x-surface-2').trim() || (isDark?'#1e2230':'#F4F6FA');
  const tipTx  = cs.getPropertyValue('--x-text').trim()      || (isDark?'#F4F5F8':'#0F172A');
  const tipMut = cs.getPropertyValue('--x-text-3').trim()    || (isDark?'#A0A4B5':'#6B7280');
  const tipBdr = cs.getPropertyValue('--x-border').trim()    || (isDark?'rgba(255,255,255,.07)':'rgba(15,23,42,.07)');

  const maxAmt = Math.max(...data.map(d=>d.amount), 1);
  const colors = data.map(d => {
    if (!d.amount) return isDark?'rgba(255,255,255,.06)':'rgba(15,23,42,.07)';
    const pct = d.amount / maxAmt;
    if (pct >= 0.75) return '#2563EB';
    if (pct >= 0.40) return '#60A5FA';
    return '#BFDBFE';
  });

  window._dbCI['bar30'] = new Chart(el, {
    type: 'bar',
    data: {
      labels:   data.map(d => d.label),
      datasets: [{ data: data.map(d=>d.amount), backgroundColor: colors, borderRadius: 3, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tipBg, titleColor: tipMut, bodyColor: tipTx,
          borderColor: tipBdr, borderWidth: 1, padding: 10, cornerRadius: 6,
          callbacks: { label: ctx => ' PKR ' + fM(ctx.raw) }
        }
      },
      scales: {
        x: {
          grid:   { display: false },
          border: { display: false },
          ticks:  { font: { family:'Inter', size: 9 }, color: tipMut, maxRotation: 0,
                    callback: (v, i) => (i % 5 === 0 ? data[i]?.label : '') }
        },
        y: { display: false, min: 0 }
      }
    }
  });
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

/* ════════════════════════════════════════════════════════════
   _rDashRecovery — Recovery role dashboard
════════════════════════════════════════════════════════════ */
async function _rDashRecovery() {
  const pg = document.getElementById('pg-dashboard');
  pg.innerHTML = `<div class="db-skel">
    <div class="db-sb" style="width:180px;height:22px"></div>
    <div class="db-sb" style="width:260px;height:14px;margin-top:6px"></div>
    <div class="db-sk-kpis" style="margin-top:20px">${[0,1,2,3].map(()=>`<div class="db-sb db-sk-kpi"></div>`).join('')}</div>
    <div class="db-sb" style="width:110px;height:11px;margin-top:20px"></div>
    <div class="db-sk-kpis">${[0,1,2,3].map(()=>`<div class="db-sb db-sk-kpi"></div>`).join('')}</div>
  </div>`;

  // Core data from cache
  const units     = gunits();
  const soldUnits = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
  const outstand  = soldUnits.reduce((s, u) => s + actualPending(u), 0);
  const od        = getOverdueDays();
  const overdueN  = soldUnits.filter(u => isOverdue(u, od) && actualPending(u) > 0).length;
  const fus       = gfus();

  // Promises due today
  let promisesToday = 0, overduePromises = 0;
  try {
    const { data: pAll } = await supabase.rpc('get_all_promises', { p_company_id: S.cid });
    if (Array.isArray(pAll)) {
      const t = td();
      promisesToday   = pAll.filter(p => p.status === 'pending' && p.promise_date === t).length;
      overduePromises = pAll.filter(p => p.status === 'pending' && p.promise_date < t).length;
    }
  } catch(e) {}

  // Payment links sent (30d)
  let plSent = 0;
  try {
    const { data: plStats } = await supabase.rpc('get_payment_link_stats', { p_company_id: S.cid, p_days: 30 });
    if (plStats) plSent = (plStats.total_sent || 0) + (plStats.verified || 0) + (plStats.pending_verification || 0);
  } catch(e) {}

  const longDate  = new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const firstName = (S?.name || '').split(' ')[0] || 'there';
  const pendingCalls = fus.overdue.length + fus.today.length;

  pg.innerHTML = `<div class="db ani">

  <div class="db-hd">
    <div class="db-hd-title">Recovery Overview</div>
    <div class="db-hd-sub">Good ${getGreeting()}, ${esc(firstName)} · ${longDate}</div>
  </div>

  <div class="db-sec">At a Glance</div>
  <div class="db-kpis">

    <div class="db-kpi" onclick="nav('reports')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic red">${_ic('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',15)}</div>
        ${overdueN > 0 ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${overdueN} overdue</div>` : ''}
      </div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(outstand)}</div>
      <div class="db-kpi-lbl">Total Outstanding</div>
      <div class="db-kpi-sub">${overdueN > 0 ? overdueN + ' unit' + (overdueN !== 1 ? 's' : '') + ' overdue' : 'All units current'}</div>
    </div>

    <div class="db-kpi" onclick="nav('promises')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic purple">${_ic('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',15)}</div>
        ${promisesToday > 0 ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} Due today</div>` : ''}
      </div>
      <div class="db-kpi-val">${promisesToday}</div>
      <div class="db-kpi-lbl">Promises Due Today</div>
      <div class="db-kpi-sub">${overduePromises > 0 ? overduePromises + ' overdue promise' + (overduePromises !== 1 ? 's' : '') : 'No overdue promises'}</div>
    </div>

    <div class="db-kpi" onclick="nav('contacts')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic blue">${_icPhone(15)}</div>
        ${pendingCalls > 0 ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${pendingCalls} pending</div>` : ''}
      </div>
      <div class="db-kpi-val">${pendingCalls}</div>
      <div class="db-kpi-lbl">Overdue Follow-ups</div>
      <div class="db-kpi-sub">${fus.today.length} due today · ${fus.overdue.length} overdue</div>
    </div>

    <div class="db-kpi" onclick="nav('paylinks')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic green">${_icLink(15)}</div>
      </div>
      <div class="db-kpi-val">${plSent}</div>
      <div class="db-kpi-lbl">Payment Links Sent</div>
      <div class="db-kpi-sub">Last 30 days</div>
    </div>

  </div>

  <div class="db-sec">Quick Access</div>
  <div class="db-kpis">

    <div class="db-kpi db-ql" onclick="nav('contacts')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic blue">${_icPhone(15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Call Logs</div>
      <div class="db-kpi-sub">View &amp; log client calls</div>
    </div>

    <div class="db-kpi db-ql" onclick="nav('reminders')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic purple">${_ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Reminders</div>
      <div class="db-kpi-sub">Upcoming follow-ups</div>
    </div>

    <div class="db-kpi db-ql" onclick="nav('radar')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic red">${_ic('<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Recovery Radar</div>
      <div class="db-kpi-sub">At-risk client tracker</div>
    </div>

    <div class="db-kpi db-ql" onclick="nav('paylinks')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic green">${_icLink(15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Payment Links</div>
      <div class="db-kpi-sub">Send &amp; track payment links</div>
    </div>

  </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   _rDashAccounts — Accounts role dashboard
════════════════════════════════════════════════════════════ */
async function _rDashAccounts() {
  const pg = document.getElementById('pg-dashboard');
  pg.innerHTML = `<div class="db-skel">
    <div class="db-sb" style="width:200px;height:22px"></div>
    <div class="db-sb" style="width:260px;height:14px;margin-top:6px"></div>
    <div class="db-sk-kpis" style="margin-top:20px">${[0,1,2,3].map(()=>`<div class="db-sb db-sk-kpi"></div>`).join('')}</div>
    <div class="db-sb" style="width:110px;height:11px;margin-top:20px"></div>
    <div class="db-sk-kpis">${[0,1,2,3].map(()=>`<div class="db-sb db-sk-kpi"></div>`).join('')}</div>
  </div>`;

  // Core data
  const units     = gunits();
  const soldUnits = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
  const soldU     = soldUnits.length;

  // This month's collections (via single dashboard RPC)
  let monthR = 0;
  try {
    const { data: k } = await supabase.rpc('get_dashboard_kpis', { p_company_id: S.cid });
    monthR = Number(k?.this_month_collection || 0);
  } catch(e) {}

  // PDC pending count
  let pdcPending = 0;
  try {
    const { data: pdcData } = await supabase.rpc('get_pdc_register', {
      p_company_id: S.cid, p_status: 'pending',
      p_project_id: null, p_date_from: null, p_date_to: null
    });
    pdcPending = (pdcData?.rows || []).length;
  } catch(e) {}

  // Pending commissions total
  let commPendingAmt = 0;
  try {
    const { data: agents = [] } = await supabase.rpc('list_agents', { p_company_id: S.cid });
    commPendingAmt = (Array.isArray(agents) ? agents : [])
      .reduce((s, a) => s + Number(a.total_commission_pending || 0), 0);
  } catch(e) {}

  const longDate  = new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const firstName = (S?.name || '').split(' ')[0] || 'there';

  pg.innerHTML = `<div class="db ani">

  <div class="db-hd">
    <div class="db-hd-title">Accounts Overview</div>
    <div class="db-hd-sub">Good ${getGreeting()}, ${esc(firstName)} · ${longDate}</div>
  </div>

  <div class="db-sec">At a Glance</div>
  <div class="db-kpis">

    <div class="db-kpi" onclick="nav('recovery')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic green">${_ic('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',15)}</div>
      </div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(monthR)}</div>
      <div class="db-kpi-lbl">Collected This Month</div>
      <div class="db-kpi-sub">${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
    </div>

    <div class="db-kpi" onclick="nav('pdc')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic blue">${_ic('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',15)}</div>
        ${pdcPending > 0 ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${pdcPending} pending</div>` : ''}
      </div>
      <div class="db-kpi-val">${pdcPending}</div>
      <div class="db-kpi-lbl">Pending PDC Cheques</div>
      <div class="db-kpi-sub">${pdcPending > 0 ? 'Awaiting clearance' : 'No pending cheques'}</div>
    </div>

    <div class="db-kpi" onclick="nav('sales')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic purple">${_ic('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>',15)}</div>
      </div>
      <div class="db-kpi-val">${soldU}</div>
      <div class="db-kpi-lbl">Active Bookings</div>
      <div class="db-kpi-sub">Sold / booked units</div>
    </div>

    <div class="db-kpi" onclick="nav('commissions')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic red">${_ic('<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',15)}</div>
        ${commPendingAmt > 0 ? `<div class="db-trend dn">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} Pending</div>` : ''}
      </div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(commPendingAmt)}</div>
      <div class="db-kpi-lbl">Pending Commissions</div>
      <div class="db-kpi-sub">${commPendingAmt > 0 ? 'Unpaid agent commissions' : 'All commissions settled'}</div>
    </div>

  </div>

  <div class="db-sec">Quick Access</div>
  <div class="db-kpis">

    <div class="db-kpi db-ql" onclick="nav('ledgers')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic blue">${_ic('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Ledgers</div>
      <div class="db-kpi-sub">Client &amp; unit ledgers</div>
    </div>

    <div class="db-kpi db-ql" onclick="nav('sales')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic purple">${_ic('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>',15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Sales &amp; Bookings</div>
      <div class="db-kpi-sub">All sale records</div>
    </div>

    <div class="db-kpi db-ql" onclick="nav('receipts')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic green">${_ic('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>',15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Receipt Vouchers</div>
      <div class="db-kpi-sub">Payment receipts</div>
    </div>

    <div class="db-kpi db-ql" onclick="nav('reports')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic red">${_icBar(15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Reports &amp; Export</div>
      <div class="db-kpi-sub">Analytics &amp; exports</div>
    </div>

  </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   _rDashManagerStaff — Manager / Staff dashboard
════════════════════════════════════════════════════════════ */
async function _rDashManagerStaff() {
  const pg = document.getElementById('pg-dashboard');
  pg.innerHTML = `<div class="db-skel">
    <div class="db-sb" style="width:200px;height:22px"></div>
    <div class="db-sb" style="width:280px;height:14px;margin-top:6px"></div>
    <div class="db-sk-kpis" style="margin-top:20px">${[0,1,2].map(()=>`<div class="db-sb db-sk-kpi"></div>`).join('')}</div>
  </div>`;

  const hasPay     = typeof hasPermission === 'function' && hasPermission('recovery');
  const hasClients = typeof hasPermission === 'function' && hasPermission('clients');
  const hasReports = typeof hasPermission === 'function' && hasPermission('reports');
  const hasCons    = typeof hasPermission === 'function' && hasPermission('contacts');

  const units     = gunits();
  const soldUnits = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
  const clientN   = soldUnits.length;

  let monthR = 0;
  if (hasPay) {
    try {
      const { data: k } = await supabase.rpc('get_dashboard_kpis', { p_company_id: S.cid });
      monthR = Number(k?.this_month_collection || 0);
    } catch(e) {}
  }

  const longDate  = new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const firstName = (S?.name || '').split(' ')[0] || 'there';
  const kpiCards  = [];

  if (hasPay) kpiCards.push(`
    <div class="db-kpi" onclick="nav('recovery')">
      <div class="db-kpi-hd"><div class="db-kpi-ic green">${_ic('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',15)}</div></div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fMH(monthR)}</div>
      <div class="db-kpi-lbl">Collected This Month</div>
      <div class="db-kpi-sub">${new Date().toLocaleDateString('en-US',{month:'long'})}</div>
    </div>`);

  if (hasClients) kpiCards.push(`
    <div class="db-kpi" onclick="nav('clients')">
      <div class="db-kpi-hd"><div class="db-kpi-ic blue">${_ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',15)}</div></div>
      <div class="db-kpi-val">${clientN}</div>
      <div class="db-kpi-lbl">Active Clients</div>
      <div class="db-kpi-sub">From booked units</div>
    </div>`);

  if (hasReports) kpiCards.push(`
    <div class="db-kpi db-ql" onclick="nav('reports')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic purple">${_icBar(15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Reports &amp; Export</div>
      <div class="db-kpi-sub">View analytics</div>
    </div>`);

  if (hasCons) kpiCards.push(`
    <div class="db-kpi db-ql" onclick="nav('contacts')">
      <div class="db-kpi-hd">
        <div class="db-kpi-ic red">${_icPhone(15)}</div>
        ${_ic('<path d="m9 18 6-6-6-6"/>',14)}
      </div>
      <div class="db-ql-lbl">Call Logs</div>
      <div class="db-kpi-sub">View &amp; log calls</div>
    </div>`);

  pg.innerHTML = `<div class="db ani">
  <div class="db-hd">
    <div class="db-hd-title">My Overview</div>
    <div class="db-hd-sub">Welcome back, ${esc(firstName)} · ${longDate}</div>
  </div>
  ${kpiCards.length > 0
    ? `<div class="db-sec">My Modules</div><div class="db-kpis">${kpiCards.join('')}</div>`
    : `<div class="db-card" style="padding:32px 24px;text-align:center;margin-top:8px">
        <div style="font-size:32px;margin-bottom:12px">👋</div>
        <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px">You're all set up</div>
        <div style="font-size:13px;color:var(--text-muted)">Contact your administrator to grant module access.</div>
       </div>`}
  </div>`;
}
