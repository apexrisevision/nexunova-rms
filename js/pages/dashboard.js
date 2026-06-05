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

/* ─── KPI hover injected at render time (called from _rDashAdminKPIs) ── */
function _injectKpiHoverStyle() {
  var old = document.getElementById('_db-kpi-hover');
  if (old) old.remove();
  var s = document.createElement('style');
  s.id = '_db-kpi-hover';
  s.textContent =
    /* base: kill generic .db-kpi hover, add sweep base + transition per card */
    '.db-kpi:hover{box-shadow:none !important;transform:none !important;}' +
    '#_kpi0,#_kpi1,#_kpi2,#_kpi3{background-repeat:no-repeat !important;background-position:left top !important;background-size:0% 3px !important;transition:background-size .35s cubic-bezier(.4,0,.2,1),box-shadow 180ms ease,transform 180ms ease,border-color 180ms ease !important;}' +
    /* per-card sweep gradient */
    '#_kpi0{background-image:linear-gradient(90deg,#DC2626,#EF4444) !important;}' +
    '#_kpi1{background-image:linear-gradient(90deg,#16A34A,#22C55E) !important;}' +
    '#_kpi2{background-image:linear-gradient(90deg,#2563EB,#6366F1) !important;}' +
    '#_kpi3{background-image:linear-gradient(90deg,#D97706,#F59E0B) !important;}' +
    /* hover: expand sweep + color glow */
    '#_kpi0:hover,#_kpi1:hover,#_kpi2:hover,#_kpi3:hover{background-size:100% 3px !important;}' +
    '#_kpi0:hover{box-shadow:0 0 0 2px rgba(220,38,38,.50),0 8px 28px rgba(220,38,38,.24) !important;transform:translateY(-2px) !important;}' +
    '#_kpi1:hover{box-shadow:0 0 0 2px rgba(22,163,74,.50),0 8px 28px rgba(22,163,74,.24) !important;transform:translateY(-2px) !important;}' +
    '#_kpi2:hover{box-shadow:0 0 0 2px rgba(37,99,235,.50),0 8px 28px rgba(37,99,235,.24) !important;transform:translateY(-2px) !important;}' +
    '#_kpi3:hover{box-shadow:0 0 0 2px rgba(217,119,6,.50),0 8px 28px rgba(217,119,6,.24) !important;transform:translateY(-2px) !important;}';
  document.head.appendChild(s);
}

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
  await loadCommandCenter();
}

/* ════════════════════════════════════════════════════════════
   COMMAND CENTER v2 — forced-dark, animated premium landing.
   #070B18 canvas · Blue #2563EB / Purple #7C3AED / Pink #F472B6.
   5 sections: top bar (live clock) · alert chips · role cards ·
   3-col main grid (gauge / radar+health / units+WA) · bottom row
   (activity · system ticker · quick actions). All data from
   existing RPCs + cc_command_center. (2026-05-29)
════════════════════════════════════════════════════════════ */

window._ccTimers = window._ccTimers || [];
function _ccClearTimers() {
  (window._ccTimers || []).forEach(t => { try { clearInterval(t); } catch(_) {} });
  window._ccTimers = [];
  if (window._ccRaf) { cancelAnimationFrame(window._ccRaf); window._ccRaf = null; }
}

/* The Command Center is ALWAYS dark, but the dark is scoped to #pg-dashboard ONLY:
   loadCommandCenter() adds .cc-active + an inline #070B18 background to the container,
   and ccOpenRole() removes both so role dashboards render in the user's normal theme.
   No body / global theme class is ever touched — the rest of the app is untouched. */

/* role destinations → existing role dashboards */
const _CC_ROLES = {
  admin:    { lb:'My Dashboard',  sub:'KPIs · trends · health',   color:'#2563EB', ic:'<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>' },
  recovery: { lb:'Recovery View', sub:'Collections · promises',   color:'#10B981', ic:'<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>' },
  manager:  { lb:'Manager View',  sub:'Oversight · operations',   color:'#7C3AED', ic:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  finance:  { lb:'Finance View',  sub:'Receipts · PDC · ledgers', color:'#F59E0B', ic:'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>' },
};

/* system status items for the scrolling ticker (informational) */
const _CC_TICKER = [
  '✅ Email live · noreply@nexunova.com',
  '📱 WhatsApp · Meta Cloud API connected',
  '🗂️ Templates pending Meta approval',
  '🔒 OTP authentication active',
  '📊 Recovery Radar cron · 07:00 PKT daily',
  '💚 Health scores recalc · 01:00 PKT nightly',
  '🗃️ Nightly backups enabled',
  '⚙️ All systems operational',
];

/* count a number element from 0 → data-to over 1.2s (easeOut) */
function _ccCountUp(el) {
  const to  = parseFloat(el.dataset.to || '0');
  const fmt = el.dataset.fmt || 'int';
  const out = v => fmt === 'money' ? ('PKR ' + fLakhCr(v)) : fmt === 'pct' ? (Math.round(v) + '%') : String(Math.round(v));
  const t0 = performance.now(), dur = 1200;
  (function step(t) {
    let p = Math.min(1, (t - t0) / dur); p = 1 - Math.pow(1 - p, 3);
    el.textContent = out(to * p);
    if (p < 1) requestAnimationFrame(step); else el.textContent = out(to);
  })(performance.now());
}

async function loadCommandCenter() {
  const pg = document.getElementById('pg-dashboard');
  if (!pg) return;
  _ccClearTimers();
  _dbDestroyCharts();
  pg.classList.add('cc-active');   // dark/light handled by theme-aware CSS (no inline force)

  const now   = new Date();
  const hr    = now.getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const name  = (S?.name || S?.displayName || S?.username || 'Admin').toString().split(' ')[0];
  const dateLbl = now.toLocaleDateString('en-PK', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // ── Skeleton (dark) ──────────────────────────────────────
  pg.innerHTML = `<div class="cc"><div class="cc-skel">
    <div class="cc-sb" style="height:64px"></div>
    <div class="cc-sb" style="height:44px;margin-top:14px"></div>
    <div class="cc-sb" style="height:96px;margin-top:14px"></div>
    <div class="cc-sb" style="height:280px;margin-top:14px"></div>
  </div></div>`;

  // ── Sync (only what role-card badges need) ───────────────
  const t    = td();
  const od    = getOverdueDays();
  const overdueUnits = gunits().filter(u => u.status!=='Available' && u.status!=='Dead' && isOverdue(u, od) && actualPending(u) > 0);
  const yday = new Date(); yday.setDate(yday.getDate() - 1); const ydayStr = yday.toISOString().slice(0,10);

  const from7 = new Date(); from7.setDate(from7.getDate() - 6);

  // ── Async: admin-actionable signals (existing RPCs) ──────
  let approvals=[], pdcRows=[], promToday=0, promAll=0, cc={}, collRows=[],
      monthColl=0, target=0, radar=null, users=[], pdcBounced=[], lockedUsers=[], team=[];

  await Promise.all([
    supabase.rpc('get_pending_approvals', { p_filters:{} })
      .then(r=>{ approvals=(r.data&&Array.isArray(r.data.rows))?r.data.rows:[]; window._approvalsPending=approvals.length; }).catch(()=>{}),
    supabase.rpc('get_pdc_register', { p_company_id:S.cid, p_status:'bounced', p_project_id:null, p_date_from:null, p_date_to:null })
      .then(r=>{ pdcBounced=(r.data&&Array.isArray(r.data.rows))?r.data.rows:[]; }).catch(()=>{}),
    supabase.rpc('get_locked_users', { p_company_id:S.cid })
      .then(r=>{ lockedUsers=Array.isArray(r.data)?r.data:[]; }).catch(()=>{}),
    supabase.rpc('get_pdc_register', { p_company_id:S.cid, p_status:'presented', p_project_id:null, p_date_from:t, p_date_to:t })
      .then(r=>{ pdcRows=(r.data&&Array.isArray(r.data.rows))?r.data.rows:[]; }).catch(()=>{}),
    supabase.rpc('get_all_promises', { p_company_id:S.cid })
      .then(r=>{ if(Array.isArray(r.data)){ promToday=r.data.filter(p=>p.status==='pending'&&p.promise_date===t).length; promAll=r.data.filter(p=>p.status==='pending'&&p.promise_date<=t).length; } }).catch(()=>{}),
    supabase.rpc('cc_command_center', { p_company_id:S.cid })
      .then(r=>{ cc=r.data||{}; }).catch(()=>{}),
    supabase.rpc('get_collection_report', { p_company_id:S.cid, p_from_date:from7.toISOString().slice(0,10), p_to_date:t })
      .then(r=>{ collRows=Array.isArray(r.data)?r.data:[]; }).catch(()=>{}),
    supabase.rpc('get_dashboard_kpis', { p_company_id:S.cid })
      .then(r=>{ monthColl=Number(r.data?.this_month_collection||0); }).catch(()=>{}),
    supabase.rpc('get_company_targets', { p_company_id:S.cid })
      .then(r=>{ target=Number(r.data?.monthly_target||0); }).catch(()=>{}),
    supabase.rpc('get_latest_radar', { p_company_id:S.cid })
      .then(r=>{ radar=r.data||null; }).catch(()=>{}),
    supabase.rpc('list_app_users', { p_company_id:S.cid })
      .then(r=>{ users=Array.isArray(r.data)?r.data:[]; }).catch(()=>{}),
    supabase.rpc('cc_team_activity', { p_company_id:S.cid })
      .then(r=>{ team=Array.isArray(r.data)?r.data:[]; }).catch(()=>{}),
  ]);

  if (!pg.isConnected) return; // stale-guard

  // ── derive signals ───────────────────────────────────────
  const approvalsN = approvals.length;
  const oldestDays = approvalsN ? Math.max(...approvals.map(a=>{const d=a.requested_at?Math.floor((Date.now()-new Date(a.requested_at).getTime())/86400000):0;return isNaN(d)?0:d;})) : 0;
  const pdcToday  = pdcRows.length, pdcAmt = pdcRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const clients90 = Number(cc.clients_90d_overdue||0), exposure90 = Number(cc.amount_90d_overdue||0);

  // collections — 7-day series + today/yesterday
  const byDate = {}; collRows.forEach(r=>{ byDate[r.payment_date]=(byDate[r.payment_date]||0)+Number(r.amount||0); });
  const series7=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); series7.push(byDate[d.toISOString().slice(0,10)]||0); }
  const collToday = byDate[t]||0, collYest = byDate[ydayStr]||0;
  const collDelta = collToday - collYest, collDeltaPct = collYest>0 ? Math.round(collDelta/collYest*100) : null;
  window._ccMonthColl = monthColl;   // used by the goal slider handler

  // ── ACTION RADAR — pending actions as radar contacts ─────
  const blips = [];
  if (approvalsN) blips.push({ c:'#EF4444', n:approvalsN, lb:'Approvals',       sub:`oldest ${oldestDays}d ago`,         go:"nav('approvals')", ang:35  });
  if (clients90)  blips.push({ c:'#EF4444', n:clients90,  lb:'Legal threshold', sub:`PKR ${fLakhCr(exposure90)} · 90d+`,  go:"nav('contacts')",  ang:148 });
  if (pdcToday)   blips.push({ c:'#F59E0B', n:pdcToday,   lb:'PDC due today',   sub:`PKR ${fLakhCr(pdcAmt)}`,             go:"nav('pdc')",       ang:232 });
  if (promToday)  blips.push({ c:'#F59E0B', n:promToday,  lb:'Promises today',  sub:'need a follow-up',                  go:"nav('promises')",  ang:312 });
  const totalActions = approvalsN + clients90 + pdcToday + promToday;
  const blipDots = blips.map((b,i)=>{ const a=b.ang*Math.PI/180, R=66, x=(100+R*Math.cos(a)).toFixed(1), y=(100+R*Math.sin(a)).toFixed(1);
    return `<button id="cc-blip-${i}" class="cc-blip" style="left:${x}px;top:${y}px;--bc:${b.c};animation-delay:${(i*0.45).toFixed(2)}s" onclick="${b.go}" onmouseenter="_ccHot(${i},1)" onmouseleave="_ccHot(${i},0)" title="${esc(b.lb)} (${b.n})"><span class="cc-blip-ping"></span><b>${b.n}</b></button>`; }).join('');
  const blipLegend = blips.length
    ? blips.map((b,i)=>`<button id="cc-rleg-${i}" class="cc-rleg" onclick="${b.go}" onmouseenter="_ccHot(${i},1)" onmouseleave="_ccHot(${i},0)"><span class="cc-rleg-dot" style="background:${b.c}"></span><span class="cc-rleg-lb">${esc(b.lb)}</span><span class="cc-rleg-sub">${esc(b.sub)}</span><span class="cc-rleg-n" style="color:${b.c}">${b.n}</span></button>`).join('')
    : `<div class="cc-rleg-clear">${_ic('<path d="M20 6 9 17l-5-5"/>',15)} Scope clear — nothing needs you right now</div>`;

  // ── TODAY'S INTAKE — needle gauge (-90..+90 over 180°) ───
  const intakeMax = Math.max(collToday*1.35, monthColl/20, target/30, 100000);
  const intakeDeg = -90 + Math.min(1, collToday/intakeMax) * 180;
  const dialTicks = Array.from({length:9},(_,i)=>{ const dd=(-90+i*22.5)*Math.PI/180, maj=(i%2===0);
    const sx=(100+(maj?68:72)*Math.sin(dd)).toFixed(1), sy=(110-(maj?68:72)*Math.cos(dd)).toFixed(1), ex=(100+82*Math.sin(dd)).toFixed(1), ey=(110-82*Math.cos(dd)).toFixed(1);
    return `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="cc-dtick ${maj?'maj':''}"/>`; }).join('');
  // colored zone arcs (red 0-40% · amber 40-70% · green 70-100%) along the 180° rim
  const _arcPt = f => { const d=(-90+f*180)*Math.PI/180; return [(100+82*Math.sin(d)).toFixed(2),(110-82*Math.cos(d)).toFixed(2)]; };
  const _zoneArc = (f0,f1,cls) => { const p0=_arcPt(f0), p1=_arcPt(f1); return `<path d="M ${p0[0]} ${p0[1]} A 82 82 0 0 1 ${p1[0]} ${p1[1]}" class="cc-zone ${cls}"/>`; };
  const dialZones = _zoneArc(0,0.4,'z-red') + _zoneArc(0.4,0.7,'z-amber') + _zoneArc(0.7,1,'z-green');
  const s7max = Math.max(...series7, 1);
  const ekgPts = series7.map((v,i)=>`${(i/6*100).toFixed(1)},${(26-(v/s7max*22)).toFixed(1)}`).join(' ');

  // ── MONTHLY GOAL — ring + interactive slider (localStorage) ──
  const goalKey = 'cc.goal.' + (S.cid||'x');
  let goal = Number(localStorage.getItem(goalKey)||0) || target || 0;
  const goalPct = goal>0 ? Math.round(monthColl/goal*100) : 0;
  const gColor  = goalPct>=70?'#10B981':goalPct>=40?'#F59E0B':'#EF4444';
  const gCirc   = 2*Math.PI*46, gOff = goal>0 ? gCirc*(1-Math.min(100,goalPct)/100) : gCirc;
  const goalMax = 50000000, goalStep = 250000;
  const goalFill = Math.min(100, Math.round(goal/goalMax*100));
  // pace-based projection for the month
  const _dom = now.getDate(), _dim = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const projected = _dom>0 ? Math.round(monthColl/_dom*_dim) : 0;
  const projDelta = goal>0 ? projected-goal : null;

  // ── role cards + WHO uses each dashboard (real names) ────
  const roleUsers = { admin:[], recovery:[], manager:[], finance:[] };
  users.forEach(u=>{ const r=(u.role||'').toLowerCase(), nm=(u.full_name||u.username||'User');
    if (r==='owner'||r==='admin') roleUsers.admin.push(nm);
    else if (r==='recovery'||r==='recovery_officer') roleUsers.recovery.push(nm);
    else if (r==='manager'||r==='staff') roleUsers.manager.push(nm);
    else if (r==='finance'||r==='accounts') roleUsers.finance.push(nm);
  });
  const _names = arr => arr.length ? (esc(arr.slice(0,2).join(', ')) + (arr.length>2?` +${arr.length-2}`:'')) : 'Unassigned';
  const roleBadge = { admin: approvalsN, recovery: promAll, manager: overdueUnits.length, finance: pdcToday };
  const rolesHtml = Object.keys(_CC_ROLES).map((k,i) => {
    const m = _CC_ROLES[k], b = roleBadge[k];
    return `<button class="cc-role" style="--rc:${m.color};animation-delay:${i*60}ms" onclick="ccOpenRole('${k}')">
      ${b>0 ? `<span class="cc-role-badge">${b}</span>` : ''}
      ${k==='finance' ? `<span class="cc-role-wa" title="WhatsApp integrated">WA</span>` : ''}
      <span class="cc-role-ic">${_ic(m.ic, 19)}</span>
      <span class="cc-role-lb">${m.lb}</span>
      <span class="cc-role-users">${_ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',10)} ${_names(roleUsers[k])}</span>
    </button>`;
  }).join('');

  // ── NEEDS YOUR DECISION — consolidated approvals + attention ──
  const _AP_META = {
    discount:       { lb:'Discount changes', ic:'<circle cx="12" cy="12" r="10"/><path d="M16 8 8 16"/><circle cx="9" cy="9" r="1.4"/><circle cx="15" cy="15" r="1.4"/>' },
    price_revision: { lb:'Price revisions',  ic:'<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>' },
    cancellation:   { lb:'Cancellations',    ic:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>' },
    transfer:       { lb:'Transfers',        ic:'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>' },
    refund:         { lb:'Refunds',          ic:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>' },
    blacklist:      { lb:'Blacklist',        ic:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>' },
    dnd:            { lb:'DND flags',        ic:'<path d="M10.5 5H19a2 2 0 0 1 2 2v8M21 21 3 3"/>' },
    other:          { lb:'Other requests',   ic:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>' },
  };
  const apGroups = {};
  approvals.forEach(a=>{ const ty=_AP_META[a.request_type]?a.request_type:'other'; (apGroups[ty]=apGroups[ty]||{n:0,amt:0}).n++; apGroups[ty].amt+=Number(a.amount||0); });
  const apRows = Object.keys(apGroups).sort((x,y)=>apGroups[y].n-apGroups[x].n).map(ty=>{ const g=apGroups[ty], m=_AP_META[ty];
    return `<div class="cc-aprow"><span class="cc-aprow-ic">${_ic(m.ic,15)}</span><span class="cc-aprow-lb">${m.lb}</span>${g.amt?`<span class="cc-aprow-amt">PKR ${fLakhCr(g.amt)}</span>`:''}<span class="cc-aprow-n">${g.n}</span></div>`; }).join('');
  const apInbox = approvalsN
    ? `<div class="cc-ap-hd"><span class="cc-ap-total">${approvalsN}</span><span class="cc-ap-sub">pending · oldest ${oldestDays} day${oldestDays!==1?'s':''} ago</span></div><div class="cc-aprows">${apRows}</div><button class="cc-ap-go" onclick="nav('approvals')">Open approvals queue ${_ic('<path d="m9 18 6-6-6-6"/>',12)}</button>`
    : `<div class="cc-ap-zero">${_ic('<path d="M20 6 9 17l-5-5"/>',22)}<div><b>Inbox zero</b><span>Nothing waiting for your approval</span></div></div>`;
  const bouncedN = pdcBounced.length, bouncedAmt = pdcBounced.reduce((s,r)=>s+Number(r.amount||0),0);
  const lockedN  = lockedUsers.length;

  // ── TEAM ACTIVITY — per user, today (login · time · actions · contacts) ──
  const _hm = m => { m=Math.max(0,Math.round(Number(m)||0)); const h=Math.floor(m/60), mm=m%60; return h ? (mm?`${h}h ${mm}m`:`${h}h`) : `${mm}m`; };
  const _roleShort = { owner:'Owner', admin:'Admin', recovery:'Recovery', recovery_officer:'Recovery', finance:'Finance', accounts:'Finance', manager:'Manager', staff:'Staff' };
  const teamHtml = team.length ? team.map(u => {
    const login = u.login_today ? new Date(u.login_today).toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit'}) : '—';
    const rl = _roleShort[(u.role||'').toLowerCase()] || (u.role||'—');
    const init = ((u.name||'?').trim()[0]||'?').toUpperCase();
    const can = (u.contacts_today||0) > 0 && u.id;
    const ct  = `${u.contacts_today}${u.call_minutes?` · ${u.call_minutes}m`:''}${can?` ${_ic('<path d="m6 9 6 6 6-6"/>',12)}`:''}`;
    return `<div class="cc-twrap">
      <div class="cc-trow ${can?'exp':''}" ${can?`onclick="_ccTeam('${u.id}',this)"`:''}>
        <span class="cc-tmember"><span class="cc-tav">${esc(init)}${u.online?'<i class="cc-ton" title="online now"></i>':''}</span><span class="cc-tname"><b>${esc(u.name)}</b><small>${esc(rl)}</small></span></span>
        <span class="cc-tc">${login}</span>
        <span class="cc-tc">${_hm(u.minutes_today)}</span>
        <span class="cc-tc">${u.actions_today}</span>
        <span class="cc-tc cc-tc-ct">${ct}</span>
      </div>
      ${can?`<div class="cc-tdetail"></div>`:''}
    </div>`;
  }).join('') : `<div class="cc-empty">No active users today</div>`;

  // ── system status ticker (real) ──────────────────────────
  const radarRun = radar && radar.generated_at
    ? new Date(radar.generated_at).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
    : (radar && radar.generated_date ? radar.generated_date : 'not generated yet');
  const activeUsers = (users.filter(u=>{const st=(u.status||'active');return st!=='inactive'&&st!=='suspended';}).length) || users.length;
  const sysItems = [
    `📡 Last radar run · ${radarRun}`, `⏰ Next radar · 07:00 PKT`,
    `📧 Email · Resend connected`, `📱 WhatsApp · Meta Cloud API connected`,
    `💚 Health scores · nightly recalc 01:00 PKT`, `👥 ${activeUsers} active user${activeUsers!==1?'s':''}`,
    `⚙️ All systems operational`,
  ];
  const tickerHtml = sysItems.map(x => `<span class="cc-tick-item">${esc(x)}</span>`).join('');

  // ── Render ───────────────────────────────────────────────
  pg.innerHTML = `<div class="cc">

    <!-- TOP BAR -->
    <header class="cc-top" style="animation-delay:0ms">
      <div class="cc-top-l">
        <div class="cc-greet">${esc(greet)}, ${esc(name)}</div>
        <div class="cc-status"><span class="cc-live-dot"></span> NexuNova RMS · Live · All systems operational</div>
      </div>
      <div class="cc-top-r">
        <svg class="cc-analog" width="110" height="110" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="58" fill="none" stroke="rgba(37,99,235,0.2)" stroke-width="2"/>
          <circle cx="60" cy="60" r="54" fill="#0D1424" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          ${Array.from({length:12},(_,i)=>{const a=i*30*Math.PI/180,maj=i%3===0,r1=50,r2=maj?43:46;const x1=(60+r1*Math.sin(a)).toFixed(1),y1=(60-r1*Math.cos(a)).toFixed(1),x2=(60+r2*Math.sin(a)).toFixed(1),y2=(60-r2*Math.cos(a)).toFixed(1);return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,${maj?0.5:0.25})" stroke-width="${maj?1.5:1}" stroke-linecap="round"/>`;}).join('')}
          <line id="cc-hand-h" x1="60" y1="60" x2="60" y2="32" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line id="cc-hand-m" x1="60" y1="60" x2="60" y2="22" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
          <line id="cc-hand-s" x1="60" y1="65" x2="60" y2="18" stroke="#2563EB" stroke-width="1" stroke-linecap="round"/>
          <circle cx="60" cy="60" r="3" fill="#2563EB"/>
        </svg>
        <div class="cc-clock-date">${esc(dateLbl)}</div>
      </div>
    </header>

    <!-- MISSION CONTROL — radar · intake dial · goal -->
    <div class="cc-sec-lbl">Mission Control</div>
    <div class="cc-cockpit" style="animation-delay:80ms">

      <!-- ACTION RADAR -->
      <div class="cc-card cc-radarcard">
        <div class="cc-card-ttl">Action Radar</div>
        <div class="cc-radar-wrap">
          <div class="cc-scope">
            <svg viewBox="0 0 200 200" class="cc-scope-svg">
              <circle cx="100" cy="100" r="94" class="cc-ring-o"/>
              <circle cx="100" cy="100" r="66" class="cc-ring-i"/>
              <circle cx="100" cy="100" r="34" class="cc-ring-i"/>
              <line x1="100" y1="8" x2="100" y2="192" class="cc-cross"/>
              <line x1="8" y1="100" x2="192" y2="100" class="cc-cross"/>
            </svg>
            <div class="cc-sweep"></div>
            ${blipDots}
            <div class="cc-scope-ctr"><span class="cc-count" data-to="${totalActions}" data-fmt="int">0</span><small>${totalActions?'ACTIONS':'ALL CLEAR'}</small></div>
          </div>
          <div class="cc-rleg-list">${blipLegend}</div>
        </div>
      </div>

      <!-- RECOVERY HEALTH (get_recovery_health_score) -->
      <div class="cc-card cc-intel" id="cc-health-card">
        <div class="cc-card-ttl">Recovery Health</div>
        <div class="cc-intel-body" id="cc-health-body">
          <div class="cc-skel cc-skel-ring"></div>
          <div class="cc-skel-lines"><span></span><span></span><span></span></div>
        </div>
      </div>

      <!-- SMART INSIGHTS (get_smart_insights) -->
      <div class="cc-card cc-intel" id="cc-insights-card">
        <div class="cc-card-ttl">Smart Insights</div>
        <div class="cc-intel-body" id="cc-insights-body">
          <div class="cc-skel-lines full"><span></span><span></span><span></span><span></span></div>
        </div>
      </div>

      <!-- INFLOW · 90 DAYS (get_cash_forecast) -->
      <div class="cc-card cc-intel" id="cc-forecast-card">
        <div class="cc-card-ttl">Inflow · 90 days</div>
        <div class="cc-intel-body" id="cc-forecast-body">
          <div class="cc-skel cc-skel-total"></div>
          <div class="cc-skel-bars"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>

    <!-- NEEDS YOUR DECISION -->
    <div class="cc-sec-lbl">Needs Your Decision</div>
    <div class="cc-decide" style="animation-delay:300ms">
      <div class="cc-card cc-apinbox">
        <div class="cc-card-ttl">Approvals Inbox</div>
        ${apInbox}
      </div>
      <div class="cc-decide-col">
        <button class="cc-card cc-attn ${lockedN?'on':''}" onclick="nav('users')">
          <span class="cc-attn-ic" style="--ac:#F59E0B">${_ic('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',16)}</span>
          <span class="cc-attn-meta"><span class="cc-attn-n">${lockedN}</span><span class="cc-attn-lb">Locked-out users</span></span>
          <span class="cc-attn-go">${_ic('<path d="m9 18 6-6-6-6"/>',13)}</span>
        </button>
        <button class="cc-card cc-attn ${bouncedN?'on':''}" onclick="nav('pdc')">
          <span class="cc-attn-ic" style="--ac:#EF4444">${_ic('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/><path d="m7 15 3-3 4 4"/>',16)}</span>
          <span class="cc-attn-meta"><span class="cc-attn-n">${bouncedN}</span><span class="cc-attn-lb">Bounced cheques${bouncedAmt?` · PKR ${fLakhCr(bouncedAmt)}`:''}</span></span>
          <span class="cc-attn-go">${_ic('<path d="m9 18 6-6-6-6"/>',13)}</span>
        </button>
      </div>
    </div>

    <!-- ROLE CARDS (kept as-is) — shows who runs each dashboard -->
    <div class="cc-sec-lbl">Jump to a view</div>
    <div class="cc-roles" style="animation-delay:340ms">${rolesHtml}</div>

    <!-- TEAM ACTIVITY — per user, today -->
    <div class="cc-sec-lbl">Team Activity · Today</div>
    <div class="cc-card cc-team" style="animation-delay:400ms">
      <div class="cc-tscroll">
        <div class="cc-thead"><span>Member</span><span>Login</span><span>On&nbsp;system</span><span>Actions</span><span>Contacts</span></div>
        <div class="cc-trows">${teamHtml}</div>
      </div>
      <button class="cc-team-go" onclick="nav('users')">${_ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="m16 11 2 2 4-4"/>',14)} Manage users &amp; permissions ${_ic('<path d="m9 18 6-6-6-6"/>',12)}</button>
    </div>

    <!-- SYSTEM STATUS -->
    <div class="cc-sec-lbl">System Status</div>
    <div class="cc-card cc-card-ticker">
      <div class="cc-ticker"><div class="cc-ticker-track">${tickerHtml}${tickerHtml}</div></div>
    </div>

  </div>`;

  // ── Post-render: clock sweep · count-ups · needle · arcs ──
  const animateClock = () => {
    const hh = document.getElementById('cc-hand-h'), mm = document.getElementById('cc-hand-m'), ss = document.getElementById('cc-hand-s');
    if (!ss) { window._ccRaf = null; return; }
    const now = new Date();
    const sec = now.getSeconds() + now.getMilliseconds() / 1000;
    const min = now.getMinutes() + sec / 60;
    const hrr = (now.getHours() % 12) + min / 60;
    hh.setAttribute('transform', `rotate(${hrr * 30} 60 60)`);
    mm.setAttribute('transform', `rotate(${min * 6}  60 60)`);
    ss.setAttribute('transform', `rotate(${sec * 6}  60 60)`);
    window._ccRaf = requestAnimationFrame(animateClock);
  };
  animateClock();

  setTimeout(() => {
    if (!pg.isConnected) return;
    pg.querySelectorAll('.cc-count').forEach(_ccCountUp);
    // Mission Control intelligence cards — 3 RPCs in parallel, each renders independently
    _ccLoadIntel(S.cid, pg);
  }, 400);
}

/* ─── Team Activity — expand a user row → today's contacted clients ─── */
async function _ccTeam(uid, rowEl) {
  const wrap = rowEl.closest('.cc-twrap'); if (!wrap) return;
  const open = wrap.classList.toggle('open');
  const det = wrap.querySelector('.cc-tdetail');
  if (!open || !det || det.dataset.loaded) return;
  det.dataset.loaded = '1';
  det.innerHTML = `<div class="cc-tload">Loading contacts…</div>`;
  try {
    const { data } = await supabase.rpc('cc_user_contacts', { p_company_id: S.cid, p_user_id: uid });
    const rows = Array.isArray(data) ? data : [];
    det.innerHTML = rows.length
      ? rows.map(r => `<div class="cc-tdrow">
          <span class="cc-tdcli">${esc(r.client || '—')}</span>
          <span class="cc-tdmeta">${[(r.channel||'').toUpperCase(), r.time, r.status, r.minutes?`${r.minutes}m`:'', r.promise?`promise PKR ${fLakhCr(r.promise)}`:''].filter(Boolean).map(esc).join(' · ')}</span>
        </div>`).join('')
      : `<div class="cc-tload">No contacts logged today</div>`;
  } catch (_) { det.innerHTML = `<div class="cc-tload">Could not load contacts</div>`; det.dataset.loaded = ''; }
}

/* ─── Action Radar — link a blip to its legend row on hover ─── */
function _ccHot(i, on) {
  ['cc-blip-' + i, 'cc-rleg-' + i].forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hot', !!on); });
}

/* ─── Mission Control intelligence cards (Recovery Health · Smart Insights · Inflow 90 din)
       3 RPCs fired in parallel; each card renders independently; RPC error → quiet '—'. ─── */
function _ccMotionOK() { return !window.matchMedia || window.matchMedia('(prefers-reduced-motion: no-preference)').matches; }

async function _ccLoadIntel(cid, pg) {
  const r = await Promise.allSettled([
    supabase.rpc('get_recovery_health_score', { p_company_id: cid }),
    supabase.rpc('get_smart_insights',        { p_company_id: cid }),
    supabase.rpc('get_cash_forecast',         { p_company_id: cid }),
  ]);
  if (pg && !pg.isConnected) return;
  _ccRenderHealth(r[0].status === 'fulfilled' ? r[0].value.data : null);
  _ccRenderInsights(r[1].status === 'fulfilled' ? r[1].value.data : null);
  _ccRenderForecast(r[2].status === 'fulfilled' ? r[2].value.data : null);
}

function _ccIntelNA(id) { const b = document.getElementById(id); if (b) b.innerHTML = '<div class="cc-intel-na">—</div>'; }

function _ccRenderHealth(d) {
  const b = document.getElementById('cc-health-body'); if (!b) return;
  if (!d || d.success !== true) { _ccIntelNA('cc-health-body'); return; }
  const score = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
  const col = score >= 80 ? '#10B981' : score >= 60 ? '#0EA5A4' : score >= 40 ? '#F59E0B' : '#EF4444';
  const c = d.components || {};
  const pct = v => (v == null ? '—' : Math.round(Number(v) * 100) + '%');
  const agingHot = c.aging_90_plus_share != null && Number(c.aging_90_plus_share) > 0.20;
  const delta = Math.round(Number(d.delta_vs_last_month) || 0);
  const R = 30, CIRC = 2 * Math.PI * R, targetOff = CIRC * (1 - score / 100);
  b.innerHTML =
    '<div class="cc-health-top">' +
      '<div class="cc-ring">' +
        '<svg viewBox="0 0 72 72" width="72" height="72">' +
          '<circle cx="36" cy="36" r="' + R + '" class="cc-ring-trk"/>' +
          '<circle id="cc-ring-arc" cx="36" cy="36" r="' + R + '" fill="none" stroke="' + col + '" stroke-width="7" stroke-linecap="round" ' +
            'stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + CIRC.toFixed(1) + '" transform="rotate(-90 36 36)"/>' +
        '</svg>' +
        '<div class="cc-ring-ctr"><b id="cc-ring-num" style="color:' + col + '">0</b></div>' +
      '</div>' +
      '<div class="cc-health-meta">' +
        '<span class="cc-health-lbl" style="color:' + col + '">' + esc(d.label || '') + '</span>' +
        '<span class="cc-health-delta ' + (delta >= 0 ? 'up' : 'dn') + '">' + (delta >= 0 ? '▲' : '▼') + ' ' + Math.abs(delta) + ' vs last month</span>' +
      '</div>' +
    '</div>' +
    '<div class="cc-health-tbl">' +
      '<div class="cc-htrow"><span>Collection</span><b>' + pct(c.collection_rate) + '</b></div>' +
      '<div class="cc-htrow"><span>Promises</span><b>' + pct(c.promise_keep_rate) + '</b></div>' +
      '<div class="cc-htrow"><span>90+ aging</span><b class="' + (agingHot ? 'hot' : '') + '">' + pct(c.aging_90_plus_share) + '</b></div>' +
    '</div>';
  const arc = document.getElementById('cc-ring-arc'), num = document.getElementById('cc-ring-num');
  if (_ccMotionOK() && arc && num) {
    requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = targetOff.toFixed(1); }));
    const t0 = performance.now(), dur = 900;
    const step = now => { const k = Math.min(1, (now - t0) / dur); num.textContent = Math.round(score * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  } else if (arc && num) { arc.style.strokeDashoffset = targetOff.toFixed(1); num.textContent = score; }
}

function _ccRenderInsights(d) {
  const b = document.getElementById('cc-insights-body'); if (!b) return;
  const items = (d && d.success === true && Array.isArray(d.insights)) ? d.insights : null;
  if (!items) { _ccIntelNA('cc-insights-body'); return; }
  const ICON = {
    'alert-triangle': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'trending-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>'
  };
  const html = items.slice(0, 4).map((it, i) => {
    const sev = (it.severity === 'danger' || it.severity === 'warning' || it.severity === 'success') ? it.severity : 'success';
    const ic = ICON[it.icon] || ICON.check;
    const msg = String(it.message || '').replace('{amt}', it.amount != null ? ('PKR ' + fLakhCr(it.amount)) : '');
    const page = it.page ? String(it.page).replace(/[^a-z0-9-]/gi, '') : '';
    return '<button class="cc-insight ' + sev + '" style="--d:' + (i * 100) + 'ms" ' + (page ? 'onclick="nav(\'' + page + '\')"' : '') + '>' +
      '<span class="cc-insight-ic">' + _ic(ic, 15) + '</span>' +
      '<span class="cc-insight-msg">' + esc(msg) + '</span>' +
    '</button>';
  }).join('');
  b.innerHTML = '<div class="cc-insight-list">' + html + '</div>';
}

function _ccRenderForecast(d) {
  const b = document.getElementById('cc-forecast-body'); if (!b) return;
  if (!d || d.success !== true || !Array.isArray(d.months)) { _ccIntelNA('cc-forecast-body'); return; }
  const months = d.months.slice(0, 3);
  const max = Math.max(1, ...months.map(m => Number(m.expected) || 0));
  const shades = ['#1D4ED8', '#3B82F6', '#60A5FA']; // darkest = nearest month
  const bars = months.map((m, i) => {
    const v = Number(m.expected) || 0, h = Math.round(v / max * 100);
    return '<div class="cc-fc-col">' +
      '<div class="cc-fc-val">' + (v > 0 ? fLakhCr(v) : '—') + '</div>' +
      '<div class="cc-fc-track"><div class="cc-fc-bar" style="--h:' + h + '%;--bc:' + (shades[i] || '#60A5FA') + ';--d:' + (i * 80) + 'ms"></div></div>' +
      '<div class="cc-fc-mon">' + esc(m.month || '') + '</div>' +
    '</div>';
  }).join('');
  b.innerHTML = '<div class="cc-fc-total">PKR ' + fLakhCr(Number(d.total) || 0) + '</div><div class="cc-fc-bars">' + bars + '</div>';
  if (_ccMotionOK()) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      b.querySelectorAll('.cc-fc-bar').forEach(el => { el.style.height = el.style.getPropertyValue('--h'); });
    }));
  } else {
    b.querySelectorAll('.cc-fc-bar').forEach(el => { el.style.transition = 'none'; el.style.height = el.style.getPropertyValue('--h'); });
  }
}

/* ─── Monthly Goal slider — live-updates the ring + persists per company ─── */
function _ccGoal(val) {
  const goal = Number(val) || 0;
  try { localStorage.setItem('cc.goal.' + ((window.S && S.cid) || 'x'), String(goal)); } catch(_) {}
  const monthColl = Number(window._ccMonthColl || 0);
  const pct = goal > 0 ? Math.round(monthColl / goal * 100) : 0;
  const col = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';
  const circ = 2 * Math.PI * 46;
  const arc = document.getElementById('cc-goal-arc');
  if (arc) { arc.style.stroke = col; arc.style.strokeDashoffset = (goal > 0 ? circ * (1 - Math.min(100, pct) / 100) : circ).toFixed(1); }
  const p = document.getElementById('cc-goal-pct'); if (p) { p.textContent = goal > 0 ? pct + '%' : '—'; p.style.color = col; }
  const amt = document.getElementById('cc-goal-amt'); if (amt) amt.textContent = 'PKR ' + fLakhCr(goal);
  const read = document.getElementById('cc-goal-read'); if (read) read.textContent = 'PKR ' + fLakhCr(monthColl) + (goal > 0 ? ' / PKR ' + fLakhCr(goal) : '');
  const inp = document.getElementById('cc-goal-input'); if (inp) inp.style.setProperty('--fill', (goal / (Number(inp.max) || 1) * 100) + '%');
}

/* ─── Role destination → render an existing role dashboard ─── */
async function ccOpenRole(role) {
  _ccClearTimers();
  _dbDestroyCharts();
  const pg = document.getElementById('pg-dashboard');
  if (!pg) return;
  pg.classList.remove('cc-active');         // restore the user's normal theme
  pg.removeAttribute('style');              // clear the forced inline #070B18 background (covers all 4 role cards)
  pg.innerHTML = `<div class="cc-roleview ani">
    <button class="cc-back" onclick="loadCommandCenter()">${_ic('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',15)} Command Center</button>
    <div id="cc-role-mount"></div>
  </div>`;
  const tgt = 'cc-role-mount';
  if (role === 'admin')         await _rDashAdminKPIs(tgt);
  else if (role === 'recovery') await _rDashRecovery(tgt);
  else if (role === 'manager')  await _rDashManagerStaff(tgt);
  else if (role === 'finance')  await _rDashAccounts(tgt);
}

/* ─── relative time for activity feed ─────────────────────── */
function _ccRel(ts) {
  if (!ts) return '';
  const d = new Date(ts); const s = (Date.now() - d.getTime()) / 1000;
  if (isNaN(s)) return '';
  if (s < 60)     return 'just now';
  if (s < 3600)   return Math.floor(s/60) + 'm ago';
  if (s < 86400)  return Math.floor(s/3600) + 'h ago';
  if (s < 604800) return Math.floor(s/86400) + 'd ago';
  return d.toLocaleDateString('en-PK', { day:'2-digit', month:'short' });
}

/* ─── _rDashAdminKPIs — full admin KPI dashboard (on demand) ─── */
async function _rDashAdminKPIs(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;

  el.innerHTML = `<div class="db-skel">
    <div class="db-sk-kpis">${[0,1,2,3].map(()=>`<div class="db-sb" style="height:88px;border-radius:10px"></div>`).join('')}</div>
    <div class="db-sb" style="height:200px;border-radius:10px;margin-top:12px"></div>
    <div class="db-sb" style="height:260px;border-radius:10px;margin-top:12px"></div>
  </div>`;

  const units      = gunits();
  const od         = getOverdueDays();
  const soldUnits  = units.filter(u => u.status !== 'Available' && u.status !== 'Dead');
  const soldU      = soldUnits.length;
  const availU     = units.filter(u => u.status === 'Available').length;

  const totalR         = soldUnits.reduce((s,u) => s + actualPaid(u), 0);
  const outstand       = soldUnits.reduce((s,u) => s + actualPending(u), 0);
  const totalPortfolio = soldUnits.reduce((s,u) => s + Number(u.totalPrice||0), 0);
  const recovPct       = totalPortfolio > 0 ? Math.round(totalR / totalPortfolio * 100) : 0;

  const overdueUnits = soldUnits
    .filter(u => isOverdue(u, od) && actualPending(u) > 0)
    .sort((a,b) => actualPending(b) - actualPending(a));

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

  const _trendPct  = prevMonthR > 0 ? Math.round((monthR - prevMonthR) / prevMonthR * 100) : null;
  const _trendHtml = _trendPct !== null
    ? `<div class="db-trend ${_trendPct>=0?'up':'dn'}">${_ic(_trendPct>=0?'<polyline points="18 15 12 9 6 15"/>':'<polyline points="6 9 12 15 18 9"/>',10)} ${_trendPct>=0?'+':''}${_trendPct}% vs last mo</div>`
    : '';

  el.innerHTML = `
    <div class="db-sec-lbl">Live KPIs</div>
    <div class="db-kpis">

      <div id="_kpi0" class="db-kpi db-kpi-accent-red" onclick="nav('reports')" style="cursor:pointer;background:rgba(220,38,38,.05);border:1px solid rgba(220,38,38,.18);border-left:4px solid #DC2626">
        <div class="db-kpi-row">
          <div class="db-kpi-ic red">${_ic('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',14)}</div>
          <div class="db-kpi-body">
            <div class="db-kpi-lbl">Total Outstanding</div>
            <div class="db-kpi-val db-kpi-val-sm"><span class="db-pkr">PKR</span>${fLakhCr(outstand)}</div>
            <div class="db-kpi-sub">${overdueUnits.length>0?overdueUnits.length+' units overdue':'All current'}</div>
          </div>
          ${overdueUnits.length>0?`<div class="db-trend dn" style="align-self:flex-start">${_ic('<polyline points="6 9 12 15 18 9"/>',9)} ${overdueUnits.length}</div>`:''}
        </div>
      </div>

      <div id="_kpi1" class="db-kpi db-kpi-accent-green" onclick="nav('recovery')" style="cursor:pointer;background:rgba(22,163,74,.05);border:1px solid rgba(22,163,74,.18);border-left:4px solid #16A34A">
        <div class="db-kpi-row">
          <div class="db-kpi-ic green">${_ic('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',14)}</div>
          <div class="db-kpi-body">
            <div class="db-kpi-lbl">This Month</div>
            <div class="db-kpi-val db-kpi-val-sm"><span class="db-pkr">PKR</span>${fLakhCr(monthR)}</div>
            <div class="db-kpi-sub">${recentRecs.length} payment${recentRecs.length!==1?'s':''} received</div>
          </div>
          ${_trendHtml?`<div style="align-self:flex-start">${_trendHtml}</div>`:''}
        </div>
      </div>

      <div id="_kpi2" class="db-kpi db-kpi-accent-blue" onclick="nav('projects')" style="cursor:pointer;background:rgba(37,99,235,.05);border:1px solid rgba(37,99,235,.18);border-left:4px solid #2563EB">
        <div class="db-kpi-row">
          <div class="db-kpi-ic blue">${_ic('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',14)}</div>
          <div class="db-kpi-body">
            <div class="db-kpi-lbl">Portfolio Value</div>
            <div class="db-kpi-val db-kpi-val-sm"><span class="db-pkr">PKR</span>${fLakhCr(totalPortfolio)}</div>
            <div class="db-kpi-sub">${soldU} sold · ${availU} available</div>
          </div>
        </div>
      </div>

      <div id="_kpi3" class="db-kpi db-kpi-accent-amber" onclick="nav('reports')" style="cursor:pointer;background:rgba(217,119,6,.05);border:1px solid rgba(217,119,6,.18);border-left:4px solid #D97706">
        <div class="db-kpi-row">
          <div class="db-kpi-ic amber">${_ic('<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',14)}</div>
          <div class="db-kpi-body">
            <div class="db-kpi-lbl">Recovery Rate</div>
            <div class="db-kpi-val db-kpi-val-sm">${recovPct}<span style="font-size:13px;font-weight:400;color:var(--text-muted);margin-left:1px">%</span></div>
            <div class="db-kpi-sub">PKR ${fMH(totalR)} of ${fMH(totalPortfolio)}</div>
          </div>
          ${recovPct>0?`<div class="db-trend ${recovPct>=75?'up':'dn'}" style="align-self:flex-start">${recovPct>=75?'On track':recovPct<40?'Critical':'Monitor'}</div>`:''}
        </div>
      </div>

    </div>

    <div class="db-sec-lbl">Collection Trend</div>
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icBar()} Collection Trend</p>
          <p class="db-card-sub">Daily cash received · last 30 days</p>
        </div>
        <button class="db-btn" onclick="nav('recovery')">${_icBar(12)} Recovery →</button>
      </div>
      <div class="db-chart-wrap" style="height:160px;padding-top:8px">
        <canvas id="db-chart-bar30"></canvas>
      </div>
    </div>

    <div class="db-sec-lbl">Client Health</div>
    <div id="d-health-widget"></div>

    <div class="db-sec-lbl">AI Recovery Radar</div>
    <div id="d-radar-widget"></div>

    <div class="db-sec-lbl">Recent Payments</div>
    <div class="db-card">
      <div class="db-card-ch">
        <div class="db-card-hl">
          <p class="db-card-title">${_icCard()} Recent Payments</p>
          <p class="db-card-sub">Most recent transactions across all units</p>
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
    </div>`;

  _injectKpiHoverStyle();
  requestAnimationFrame(() => { _dbInitBar30(barData); });
  if (typeof _rDashHealth === 'function') _rDashHealth();
  if (typeof _rDashRadar  === 'function') _rDashRadar();
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
    { cls:'blue',                        label:'Success',  val: rate+'%' },
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
async function _rDashRecovery(targetId = 'pg-dashboard') {
  const pg = document.getElementById(targetId);
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

  // My monthly target (read-only self-view). collected = this_month_collection from
  // get_dashboard_kpis (self-scoped to my assigned projects server-side). Target via
  // get_officer_target, which auto-scopes to the caller's own app_users.id for non-admins.
  let collectedThisMonth = 0;
  try {
    const { data: k } = await supabase.rpc('get_dashboard_kpis', { p_company_id: S.cid });
    if (k && k.success) collectedThisMonth = Number(k.this_month_collection) || 0;
  } catch(e) {}

  let myTarget = 0, myTargetNotes = '';
  try {
    const now = new Date(); const year = now.getFullYear(); const month = now.getMonth() + 1;
    const { data: tg } = await supabase.rpc('get_officer_target', { p_data: { p_user_id: S.userId, year, month } });
    if (tg && tg.success && tg.target) {
      myTarget = Number(tg.target.target_amount) || 0;
      myTargetNotes = tg.target.notes || '';
    }
  } catch(e) {}
  const myTargetPct = myTarget > 0 ? Math.round(collectedThisMonth / myTarget * 100) : 0;   // guard /0
  const targetIcon = _ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', 15);
  const myTargetCard = myTarget > 0
    ? `<div class="db-kpi">
      <div class="db-kpi-hd"><div class="db-kpi-ic green">${targetIcon}</div></div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fM(myTarget)}</div>
      <div class="db-kpi-lbl">My Monthly Target</div>
      <div class="db-kpi-sub">PKR ${fM(collectedThisMonth)} collected · ${myTargetPct}% achieved${myTargetNotes ? ' · ' + esc(myTargetNotes) : ''}</div>
    </div>`
    : `<div class="db-kpi">
      <div class="db-kpi-hd"><div class="db-kpi-ic green">${targetIcon}</div></div>
      <div class="db-kpi-val"><span class="db-pkr">PKR</span>${fM(collectedThisMonth)}</div>
      <div class="db-kpi-lbl">My Monthly Target</div>
      <div class="db-kpi-sub">No monthly target set · collected this month</div>
    </div>`;

  const longDate  = new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const firstName = (S?.name || '').split(' ')[0] || 'there';
  const pendingCalls = fus.overdue.length + fus.today.length;

  pg.innerHTML = `<div class="db ani">

  <div class="db-hd">
    <div class="db-hd-title">Recovery Overview</div>
    <div class="db-hd-sub">Good ${getGreeting()}, ${esc(firstName)} · ${longDate}</div>
  </div>

  <div class="db-sec">At a Glance</div>
  <div class="db-kpis db-kpis-5">

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

    ${myTargetCard}

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
async function _rDashAccounts(targetId = 'pg-dashboard') {
  const pg = document.getElementById(targetId);
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
async function _rDashManagerStaff(targetId = 'pg-dashboard') {
  const pg = document.getElementById(targetId);
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
