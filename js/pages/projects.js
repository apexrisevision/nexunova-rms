// ══ PROJECTS MODULE ══════════════════════════════════════════
// Storage: Supabase — gprojects() / gproject() / saveProject() / deleteProjectDB()

let _prjS         = '';
let _prjId        = null;
let _prjStatus    = '';
let _prjCity      = '';
let _prjSort      = 'recent';
let _prjView      = localStorage.getItem('nxn_prj_view') || 'grid';
let _insightsOpen = false;
let _prjKbListener = null;

// ── Per-project palette — cycles through distinct brand colors ──────
const _PRJ_PALETTE = [
  '#2563EB', // Blue
  '#7C3AED', // Violet
  '#059669', // Emerald
  '#D97706', // Amber
  '#DC2626', // Red
  '#0891B2', // Cyan
  '#EA580C', // Orange
  '#4F46E5', // Indigo
  '#0D9488', // Teal
  '#9333EA', // Purple
  '#65A30D', // Lime
  '#BE185D', // Pink
];
function _prjColor(idx) { return _PRJ_PALETTE[idx % _PRJ_PALETTE.length]; }

// ── Status color map ────────────────────────────────────────
const _prjSmMap = {
  active:    { color:'#10b981', bg:'rgba(16,185,129,0.10)',  label:'Active'    },
  planning:  { color:'#3b82f6', bg:'rgba(59,130,246,0.10)',  label:'Planning'  },
  on_hold:   { color:'#f59e0b', bg:'rgba(245,158,11,0.10)',  label:'On Hold'   },
  completed: { color:'#6b7280', bg:'rgba(107,114,128,0.10)', label:'Completed' },
  cancelled: { color:'#ef4444', bg:'rgba(239,68,68,0.10)',   label:'Cancelled' },
};

// ── Lucide icon strings ─────────────────────────────────────
const _prjIco = {
  building:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
  home:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  check:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  trending:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  wallet:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
  grid:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
  list:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
  mappin:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--t3)"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  search:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  chart:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>`,
  calendar:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
  export:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  plus:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>`,
  building48:`<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
};

// ── Helpers ─────────────────────────────────────────────────

function prjStatusBadge(status) {
  const s = _prjSmMap[status] || { color:'var(--t3)', bg:'rgba(0,0,0,0.06)', label: status || 'Unknown' };
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:${s.bg};color:${s.color};border:1px solid ${s.color}30"><span style="width:5px;height:5px;border-radius:50%;background:${s.color}"></span>${s.label}</span>`;
}

function _prjPill(status) {
  const s = _prjSmMap[status] || { color:'var(--t3)', bg:'rgba(0,0,0,0.06)', label: status || 'Unknown' };
  return `<span class="prj-status-pill" style="background:${s.bg};color:${s.color}"><span class="prj-status-dot" style="background:${s.color}"></span>${s.label}</span>`;
}

// Compact PKR formatter — "5 Cr", "25 L", "9,500"
function _kM(n) {
  if (!n && n !== 0) return '—';
  if (n === 0) return '0';
  if (n >= 10000000) return (n / 10000000).toFixed(1).replace(/\.0$/, '') + ' Cr';
  if (n >= 100000)   return (n / 100000).toFixed(1).replace(/\.0$/, '') + ' L';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function genProjectCode() {
  const year  = new Date().getFullYear();
  const existing = gprojects().map(p => p.projectCode || '');
  let seq = 1;
  while (existing.includes(`PRJ-${year}-${String(seq).padStart(4,'0')}`)) seq++;
  return `PRJ-${year}-${String(seq).padStart(4,'0')}`;
}

function _prjSparkline(color, dir) {
  const pts = dir === 'up'   ? [22,18,19,15,14,11,9,7,5,4]
             : dir === 'down' ? [4,5,7,9,8,11,14,16,18,22]
             : [12,10,13,11,12,10,12,11,13,12];
  const w = 200, h = 28, n = pts.length - 1;
  const minV = Math.min(...pts), range = Math.max(...pts) - minV || 1;
  const c = pts.map((v,i) => [i*w/n, h-5-((v-minV)/range)*(h-10)]);
  let d = `M${c[0][0].toFixed(1)},${c[0][1].toFixed(1)}`;
  for (let i=0; i<n; i++) {
    const p0=c[Math.max(0,i-1)], p1=c[i], p2=c[i+1], p3=c[Math.min(n,i+2)];
    const cx1=p1[0]+(p2[0]-p0[0])/6, cy1=p1[1]+(p2[1]-p0[1])/6;
    const cx2=p2[0]-(p3[0]-p1[0])/6, cy2=p2[1]-(p3[1]-p1[1])/6;
    d += ` C${cx1.toFixed(1)},${cy1.toFixed(1)} ${cx2.toFixed(1)},${cy2.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="prj-kpi-sparkline"><path d="${d} L${w},${h} L0,${h} Z" fill="${color}" opacity="0.08"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.65"/></svg>`;
}

function _prjDonutSVG(sold, avail, total) {
  if (!total) return `<svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" fill="none" stroke="var(--surface2)" stroke-width="12"/><text x="40" y="44" text-anchor="middle" font-size="14" font-weight="600" fill="var(--t3)" font-family="Inter,sans-serif">0</text></svg>`;
  const r = 30, circ = +(2*Math.PI*r).toFixed(2);
  const sA = +(sold/total*circ).toFixed(2), aA = +(avail/total*circ).toFixed(2);
  return `<svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="12"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="#6366f1" stroke-width="12" stroke-dasharray="${sA} ${circ}" transform="rotate(-90 40 40)"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="#10b981" stroke-width="12" stroke-dasharray="${aA} ${circ}" stroke-dashoffset="${(-sA).toFixed(2)}" transform="rotate(-90 40 40)"/><text x="40" y="37" text-anchor="middle" font-size="13" font-weight="600" fill="var(--t1)" font-family="Inter,sans-serif">${total}</text><text x="40" y="50" text-anchor="middle" font-size="7" fill="var(--t3)" font-family="Inter,sans-serif" letter-spacing="0.8">TOTAL</text></svg>`;
}

// ── KPI strip ────────────────────────────────────────────────

function _renderKPIs(allUnits, allProjs) {
  const kpiEl = document.getElementById('prj-kpi');
  if (!kpiEl) return;
  const totalPortfolio = allUnits.reduce((s,u)=>s+Number(u.basePrice||0),0);
  const totalCollected = allUnits.reduce((s,u)=>s+Number(u.totalPaid||0),0);
  const soldUnits      = allUnits.filter(u=>u.status!=='Available'&&u.status!=='Dead').length;
  const soldPct        = allUnits.length>0?Math.round(soldUnits/allUnits.length*100):0;
  const recovPct       = totalPortfolio>0?Math.min(100,Math.round(totalCollected/totalPortfolio*100)):0;
  const stats = [
    { ico:_prjIco.home,     color:'#6b7280', lbl:'Total Units',     val:allUnits.length,           sub:`${allProjs.length} project${allProjs.length!==1?'s':''}` },
    { ico:_prjIco.check,    color:'#10b981', lbl:'Units Sold',      val:soldUnits,                 sub:`${soldPct}% sold rate` },
    { ico:_prjIco.trending, color:'#f59e0b', lbl:'Portfolio Value', val:`<span class="zp-kc">PKR</span>${_kM(totalPortfolio)}`, sub:'Total contract value' },
    { ico:_prjIco.wallet,   color:'#8b5cf6', lbl:'Collected',       val:`<span class="zp-kc">PKR</span>${_kM(totalCollected)}`, sub:`${recovPct}% recovery` },
  ];
  kpiEl.innerHTML = stats.map(s=>`<div class="zp-kpi" style="border-left-color:${s.color}">
    <div class="zp-ki" style="background:${s.color}20;color:${s.color}">${s.ico}</div>
    <div class="zp-kv">${s.val}</div>
    <div class="zp-kl">${s.lbl}</div>
    <div class="zp-ks">${s.sub}</div>
  </div>`).join('');
  kpiEl.querySelectorAll('.zp-kpi').forEach(el => {
    el.addEventListener('mouseenter', () => {
      el.style.transform = 'perspective(600px) translateY(-3px) rotateX(1deg)';
      el.style.boxShadow = '0 10px 28px rgba(15,23,42,.13)';
      el.classList.add('_hov');
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = '';
      el.style.boxShadow = '';
      el.classList.remove('_hov');
    });
  });
}

// ── List page ────────────────────────────────────────────────

async function rProjects() {
  const cid = S?.cid;
  if (!cid) {
    document.getElementById('pg-projects').innerHTML =
      `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div><div class="et">No company selected</div></div></div>`;
    return;
  }

  if (!window._nxnMaxProjects) {
    try {
      const { data } = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: cid });
      window._nxnMaxProjects = data?.max_projects ?? 1;
    } catch(e) { window._nxnMaxProjects = 1; }
  }

  const isA     = S.role === 'admin' || S.role === 'owner';
  const atLimit = gprojects().length >= window._nxnMaxProjects;
  const total   = gprojects().length;
  const maxP    = window._nxnMaxProjects;
  const _pc = (S.planCode || '').toLowerCase();
  const planLbl = _pc.includes('ultimate') ? 'Ultimate' : _pc.includes('pro') ? 'Pro' : _pc.includes('basic') ? 'Basic' : _pc === 'free_trial' ? 'Free Trial' : 'Basic';

  // Inject CSS fresh on every page open — bypasses Electron file:// disk cache completely
  (() => {
    let s = document.getElementById('_zp_css');
    if (!s) { s = document.createElement('style'); s.id = '_zp_css'; document.head.appendChild(s); }
    s.textContent = `
      .prj-kpi-strip{grid-template-columns:repeat(4,1fr)!important}
      .zp-kpi{background:var(--surface);border:1px solid var(--line);border-left:3px solid;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;position:relative;overflow:hidden;transition:transform 220ms cubic-bezier(.2,.8,.3,1),box-shadow 220ms ease;cursor:default}
      .zp-kpi::before{content:'';position:absolute;top:0;left:-80%;bottom:0;width:55%;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.09) 50%,transparent 70%);transition:left .45s ease;pointer-events:none}
      .zp-kpi._hov::before{left:130%}
      .zp-ki{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;margin-bottom:6px}
      .zp-kv{font-size:22px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--t1);display:flex;align-items:baseline;gap:2px}
      .zp-kc{font-size:9px;font-weight:500;color:var(--t3)}
      .zp-kl{font-size:9px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--t3);margin-top:4px}
      .zp-ks{font-size:10.5px;color:var(--t3);margin-top:1px}
      .zp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
      @media(max-width:1100px){.zp-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:700px){.zp-grid{grid-template-columns:1fr}}
      .zp-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;cursor:pointer;display:flex;position:relative;transition:transform 220ms cubic-bezier(.2,.8,.3,1),box-shadow 220ms ease,border-color 220ms ease}
      .zp-card::before{content:'';position:absolute;top:0;left:-80%;bottom:0;width:55%;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.12) 50%,transparent 70%);transition:left .45s ease;pointer-events:none;z-index:1}
      .zp-card._hov::before{left:130%}
      .zp-accent{width:4px;flex-shrink:0}
      .zp-inner{flex:1;display:flex;flex-direction:column;padding:10px 13px;gap:6px;min-width:0}
      .zp-top{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
      .zp-code{font-size:9px;font-weight:600;padding:1px 5px;border-radius:3px;background:rgba(0,0,0,.07);color:var(--t3);letter-spacing:.04em;white-space:nowrap}
      [data-theme=dark] .zp-code{background:rgba(255,255,255,.09)}
      .zp-name{font-size:13.5px;font-weight:700;color:var(--t1);letter-spacing:-.02em;line-height:1.25;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .zp-loc{display:flex;align-items:center;gap:3px;font-size:10px;color:var(--t3)}
      .zp-stats{display:grid;grid-template-columns:repeat(3,1fr);background:var(--surface2);border-radius:6px;overflow:hidden}
      .zp-stat{display:flex;flex-direction:column;align-items:center;padding:5px 4px;gap:1px}
      .zp-stat:not(:last-child){border-right:1px solid var(--line)}
      .zp-sn{font-size:15px;font-weight:700;color:var(--t1);font-variant-numeric:tabular-nums;line-height:1;letter-spacing:-.01em}
      .zp-sl{font-size:8px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.06em}
      .zp-prog{display:flex;flex-direction:column;gap:3px}
      .zp-prog-hd{display:flex;justify-content:space-between;align-items:center}
      .zp-prog-lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--t3)}
      .zp-prog-pct{font-size:10px;font-weight:700}
      .zp-pb{height:3px;background:rgba(15,23,42,.06);border-radius:99px;overflow:hidden}
      [data-theme=dark] .zp-pb{background:rgba(255,255,255,.08)}
      .zp-pf{height:100%;border-radius:99px;transition:width 600ms cubic-bezier(.4,0,.2,1)}
      .zp-fin{display:flex;align-items:center;justify-content:space-between;gap:4px}
      .zp-fv{font-size:12px;font-weight:700;color:var(--t1);display:flex;align-items:baseline;gap:2px}
      .zp-fc{font-size:9px;font-weight:500;color:var(--t3)}
      .zp-fr{font-size:10px;font-weight:600}
      .zp-foot{display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid rgba(15,23,42,.06);margin-top:1px}
      [data-theme=dark] .zp-foot{border-top-color:rgba(255,255,255,.06)}
      .zp-fl{font-size:10px;color:var(--t3);display:flex;align-items:center;gap:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
      .zp-fb{font-size:10px;font-weight:600;color:#2563EB;background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;transition:background 120ms ease}
      .zp-fb:hover{background:rgba(37,99,235,.09)}
      [data-theme=dark] .zp-fb{color:#818CF8}
      [data-theme=dark] .zp-fb:hover{background:rgba(99,102,241,.14)}
    `;
  })();

  document.getElementById('_prjDrawerOverlay')?.remove();
  document.getElementById('_prjDrawer')?.remove();

  document.getElementById('pg-projects').innerHTML = `<div class="prj-page ani module-inventory">

    <div class="prj-header">
      <div class="prj-header-left">
        <div class="prj-breadcrumb">
          <span class="prj-bc-link" onclick="nav('dashboard')">Home</span>
          <span>/</span>
          <span>Projects</span>
        </div>
        <div class="prj-title-row">
          <h1 class="prj-title">Projects</h1>
          <span class="prj-count-chip" id="prj-count-chip">${total} of ${maxP}</span>
          <span class="prj-plan-badge">${planLbl}</span>
        </div>
      </div>
      <div class="prj-header-right">
        <button class="prj-btn-ghost" onclick="prjExport()">${_prjIco.export}&nbsp;Export</button>
        <button class="prj-btn-insights" id="prj-insights-btn" onclick="toggleInsightsDrawer()">${_prjIco.chart}&nbsp;Insights</button>
        <div class="prj-view-toggle">
          <button class="prj-view-btn ${_prjView==='grid'?'active':''}" id="prj-vg" onclick="setPrjView('grid')" title="Grid">${_prjIco.grid}</button>
          <button class="prj-view-btn ${_prjView==='list'?'active':''}" id="prj-vl" onclick="setPrjView('list')" title="List">${_prjIco.list}</button>
        </div>
        ${isA&&!atLimit?`<button class="prj-btn-primary" onclick="openProjectModal(null)">${_prjIco.plus}&nbsp;New Project</button>`:''}
        ${isA&&atLimit?`<span class="prj-count-chip">${total}/${maxP} limit</span>`:''}
      </div>
    </div>

    <div class="prj-kpi-strip" id="prj-kpi"></div>

    <div class="prj-toolbar">
      <div class="prj-toolbar-left">
        <div class="prj-search-wrap">
          <span class="prj-search-icon">${_prjIco.search}</span>
          <input class="prj-search-input" id="prj-s" placeholder="Search projects..." value="${esc(_prjS)}" oninput="setPrjS(this.value)" autocomplete="off">
          <span class="prj-search-kbd">⌘K</span>
        </div>
        <select class="prj-filter-select${_prjStatus?' active':''}" id="prj-status-sel" onchange="setPrjStatus(this.value)">
          <option value="" ${!_prjStatus?'selected':''}>Status: All</option>
          <option value="active"    ${_prjStatus==='active'   ?'selected':''}>Active</option>
          <option value="planning"  ${_prjStatus==='planning' ?'selected':''}>Planning</option>
          <option value="on_hold"   ${_prjStatus==='on_hold'  ?'selected':''}>On Hold</option>
          <option value="completed" ${_prjStatus==='completed'?'selected':''}>Completed</option>
          <option value="cancelled" ${_prjStatus==='cancelled'?'selected':''}>Cancelled</option>
        </select>
        <select class="prj-filter-select${_prjCity?' active':''}" id="prj-city-sel" onchange="setPrjCity(this.value)">
          <option value="">City: All</option>
          ${[...new Set(gprojects().map(p=>p.city||'').filter(Boolean))].sort().map(c=>`<option value="${esc(c)}"${_prjCity===c?' selected':''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="prj-filter-select" id="prj-sort-sel" onchange="setPrjSort(this.value)">
          <option value="recent"  ${_prjSort==='recent' ?'selected':''}>Sort: Recent</option>
          <option value="name_az" ${_prjSort==='name_az'?'selected':''}>Name (A–Z)</option>
          <option value="name_za" ${_prjSort==='name_za'?'selected':''}>Name (Z–A)</option>
          <option value="val_hi"  ${_prjSort==='val_hi' ?'selected':''}>Highest Value</option>
          <option value="val_lo"  ${_prjSort==='val_lo' ?'selected':''}>Lowest Value</option>
          <option value="units_hi"${_prjSort==='units_hi'?'selected':''}>Most Units</option>
          <option value="prog_hi" ${_prjSort==='prog_hi'?'selected':''}>Most Progress</option>
          <option value="prog_lo" ${_prjSort==='prog_lo'?'selected':''}>Least Progress</option>
        </select>
      </div>
      <div class="prj-toolbar-right" id="prj-results-count"></div>
    </div>

    <div class="prj-content"><div id="prj-ct"></div></div>
  </div>`;

  // Insights drawer injected into body (position:fixed, outside page flow)
  const ov = document.createElement('div');
  ov.id = '_prjDrawerOverlay'; ov.className = 'prj-overlay';
  ov.addEventListener('click', closeInsightsDrawer);
  document.body.appendChild(ov);

  const dr = document.createElement('div');
  dr.id = '_prjDrawer'; dr.className = 'prj-drawer';
  dr.innerHTML = `<div class="prj-drawer-hd"><span class="prj-drawer-ttl">Portfolio Insights</span><button class="prj-drawer-x" onclick="closeInsightsDrawer()">×</button></div><div class="prj-drawer-body" id="prj-drawer-body"></div>`;
  document.body.appendChild(dr);

  // Keyboard shortcuts
  if (_prjKbListener) document.removeEventListener('keydown', _prjKbListener);
  _prjKbListener = (e) => {
    const tag = document.activeElement?.tagName;
    if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') {
      if (e.key==='Escape') { document.activeElement.blur(); closeInsightsDrawer(); }
      return;
    }
    if (e.metaKey||e.ctrlKey||e.altKey) return;
    switch(e.key) {
      case '/': e.preventDefault(); document.getElementById('prj-s')?.focus(); break;
      case 'g': setPrjView('grid'); break;
      case 'l': setPrjView('list'); break;
      case 'i': toggleInsightsDrawer(); break;
      case 'n': if (isA&&!atLimit) openProjectModal(null); break;
      case 'Escape': closeInsightsDrawer(); break;
    }
  };
  document.addEventListener('keydown', _prjKbListener);

  rPRJF();
}

function setPrjS(q)      { _prjS=q;      rPRJF(); }
function setPrjStatus(v) { _prjStatus=v;  rPRJF(); }
function setPrjCity(v)   { _prjCity=v;    rPRJF(); }
function setPrjSort(v)   { _prjSort=v;    rPRJF(); }
function setPrjView(v) {
  _prjView = v;
  localStorage.setItem('nxn_prj_view', v);
  document.getElementById('prj-vg')?.classList.toggle('active', v==='grid');
  document.getElementById('prj-vl')?.classList.toggle('active', v==='list');
  rPRJF();
}

// ── Filtered render ──────────────────────────────────────────

function rPRJF() {
  const cid = S?.cid;
  if (!cid) return;
  const ct = document.getElementById('prj-ct');
  if (!ct) return;

  const allUnits = gunits();
  let prjs = gprojects().map(p=>({...p}));

  if (_prjStatus) prjs = prjs.filter(p=>p.status===_prjStatus);
  if (_prjCity)   prjs = prjs.filter(p=>(p.city||'')===_prjCity);
  if (_prjS) {
    const q = _prjS.toLowerCase();
    prjs = prjs.filter(p=>
      (p.projectName||'').toLowerCase().includes(q)||
      (p.name||'').toLowerCase().includes(q)||
      (p.city||'').toLowerCase().includes(q)||
      (p.location||'').toLowerCase().includes(q)||
      (p.projectCode||'').toLowerCase().includes(q)
    );
  }

  switch(_prjSort) {
    case 'name_az':  prjs.sort((a,b)=>(a.projectName||a.name||'').localeCompare(b.projectName||b.name||'')); break;
    case 'name_za':  prjs.sort((a,b)=>(b.projectName||b.name||'').localeCompare(a.projectName||a.name||'')); break;
    case 'val_hi':   prjs.sort((a,b)=>_prjPV(b,allUnits)-_prjPV(a,allUnits)); break;
    case 'val_lo':   prjs.sort((a,b)=>_prjPV(a,allUnits)-_prjPV(b,allUnits)); break;
    case 'units_hi': prjs.sort((a,b)=>allUnits.filter(u=>u.projectId===b.id).length-allUnits.filter(u=>u.projectId===a.id).length); break;
    case 'prog_hi':  prjs.sort((a,b)=>Number(b.constructionProgress||0)-Number(a.constructionProgress||0)); break;
    case 'prog_lo':  prjs.sort((a,b)=>Number(a.constructionProgress||0)-Number(b.constructionProgress||0)); break;
  }

  const allProjs = gprojects();
  const rcEl = document.getElementById('prj-results-count');
  if (rcEl) rcEl.textContent = `${prjs.length} result${prjs.length!==1?'s':''}`;
  const chipEl = document.getElementById('prj-count-chip');
  if (chipEl) chipEl.textContent = `${prjs.length} of ${allProjs.length}`;

  _renderKPIs(allUnits, allProjs);

  if (!prjs.length) {
    const isA = S.role==='admin'||S.role==='owner';
    if (!allProjs.length) {
      ct.innerHTML = `<div class="prj-empty"><div class="prj-empty-icon">${_prjIco.building48}</div><div class="prj-empty-ttl">No projects yet</div><div class="prj-empty-sub">Create your first project to start tracking units, sales, and recovery.</div>${isA?`<button class="prj-btn-primary" onclick="openProjectModal(null)" style="margin-top:8px">${_prjIco.plus}&nbsp;New Project</button>`:''}</div>`;
    } else if (_prjS) {
      ct.innerHTML = `<div class="prj-empty"><div class="prj-empty-ttl">No projects match "${esc(_prjS)}"</div><div class="prj-empty-sub">Try adjusting filters or <button class="prj-empty-link" onclick="setPrjS('');document.getElementById('prj-s').value=''">clear search</button></div></div>`;
    } else {
      ct.innerHTML = `<div class="prj-empty"><div class="prj-empty-ttl">No projects match these filters</div><div class="prj-empty-sub"><button class="prj-empty-link" onclick="setPrjStatus('');setPrjCity('');rProjects()">Reset filters</button></div></div>`;
    }
    return;
  }

  ct.innerHTML = `<div class="${_prjView==='list'?'prj-list':'zp-grid'}">${prjs.map((p,idx)=>_prjView==='list'?_prjListRow(p,allUnits,idx):_prjGridCard(p,allUnits,idx)).join('')}</div>`;
  if (_prjView === 'grid') {
    requestAnimationFrame(() => {
      document.querySelectorAll('#prj-ct .zp-card').forEach(card => {
        _sleekCard(card, card.dataset.col || '#2563EB');
      });
    });
  }
}

function _prjPV(p, allUnits) {
  return allUnits.filter(u=>u.projectId===p.id).reduce((s,u)=>s+Number(u.totalPrice||0),0);
}

// ── List row ─────────────────────────────────────────────────

function _prjListRow(p, allUnits) {
  const pUnits    = allUnits.filter(u=>u.projectId===p.id);
  const sold      = pUnits.filter(u=>u.status!=='Available'&&u.status!=='Dead').length;
  const available = pUnits.filter(u=>u.status==='Available').length;
  const portfolio = pUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const collected = pUnits.reduce((s,u)=>s+Number(u.totalPaid||0),0);
  const recovPct  = portfolio>0?Math.min(100,Math.round(collected/portfolio*100)):0;
  const constrPct = Math.min(100,Number(p.constructionProgress||0));
  const sm        = _prjSmMap[p.status]||_prjSmMap.active;
  const location  = [p.location,p.city].filter(Boolean).join(' · ');
  const isA       = S.role==='admin'||S.role==='owner';
  return `<div class="prj-list-row" onclick="openProjectDetail('${p.id}')">
    <div class="prj-list-status-bar" style="background:${sm.color}"></div>
    <div class="prj-list-body">
      <div class="prj-row-primary">
        <span class="prj-row-name">${esc(p.projectName||p.name)}</span>
        ${p.projectCode?`<span class="prj-id-badge">${esc(p.projectCode)}</span>`:''}
        ${_prjPill(p.status)}
      </div>
      ${location?`<div class="prj-row-secondary">${_prjIco.mappin}<span>${esc(location)}</span></div>`:''}
      <div class="prj-row-tertiary"><span class="sn">${pUnits.length}</span>&nbsp;units&nbsp;·&nbsp;<span class="sn">${sold}</span>&nbsp;sold&nbsp;·&nbsp;<span class="sn">${available}</span>&nbsp;available${portfolio>0?`&nbsp;·&nbsp;PKR&nbsp;<span class="sn">${_kM(portfolio)}</span>`:''}&nbsp;·&nbsp;<span class="sn">${recovPct}%</span>&nbsp;recovery</div>
    </div>
    <div class="prj-row-right">
      <div class="prj-row-progress-wrap">
        <div class="prj-row-progress-bar"><div class="prj-row-progress-fill" style="width:${constrPct}%;background:${sm.color}"></div></div>
        <span class="prj-row-pct" style="color:${sm.color}">${constrPct}%</span>
        <span class="prj-row-built">built</span>
      </div>
    </div>
    <div class="prj-row-actions">
      <button class="prj-row-act-btn primary" onclick="event.stopPropagation();openProjectDetail('${p.id}')">View →</button>
      ${isA?`<button class="prj-row-act-btn" onclick="event.stopPropagation();openProjectModal('${p.id}')">Edit</button>`:''}
    </div>
  </div>`;
}

// ── Grid card ────────────────────────────────────────────────

function _prjGridCard(p, allUnits, idx) {
  const pUnits     = allUnits.filter(u=>u.projectId===p.id);
  const sold       = pUnits.filter(u=>u.status!=='Available'&&u.status!=='Dead').length;
  const available  = pUnits.filter(u=>u.status==='Available').length;
  const portfolio  = pUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const collected  = pUnits.reduce((s,u)=>s+Number(u.totalPaid||0),0);
  const recovPct   = portfolio>0?Math.min(100,Math.round(collected/portfolio*100)):0;
  const constrPct  = Math.min(100,Number(p.constructionProgress||0));
  const sm         = _prjSmMap[p.status]||_prjSmMap.active;
  const locLine    = p.location||p.city||'';
  const dueDate    = p.expectedCompletion?fD(p.expectedCompletion):null;
  const sqft       = p.totalArea>0?Number(p.totalArea).toLocaleString()+' '+(p.areaUnit||'sqft'):null;
  const builder    = (!dueDate&&!sqft&&p.builderName)?p.builderName:null;
  const recovColor = recovPct>=70?'var(--ok)':recovPct>=40?'var(--warn)':'var(--t3)';
  const pCol       = _prjColor(idx||0);
  return `<div class="zp-card" onclick="openProjectDetail('${p.id}')" data-col="${pCol}" style="background:linear-gradient(140deg,${pCol}1A 0%,var(--surface) 48%)">
    <div class="zp-accent" style="background:${pCol}"></div>
    <div class="zp-inner">
      <div class="zp-top">
        ${_prjPill(p.status)}
        ${p.projectCode?`<span class="zp-code">${esc(p.projectCode)}</span>`:''}
      </div>
      <div class="zp-name">${esc(p.projectName||p.name)}</div>
      ${locLine?`<div class="zp-loc">${_prjIco.mappin}<span>${esc(locLine)}</span></div>`:''}
      <div class="zp-stats">
        <div class="zp-stat"><span class="zp-sn">${pUnits.length}</span><span class="zp-sl">Units</span></div>
        <div class="zp-stat"><span class="zp-sn" style="color:${sm.color}">${sold}</span><span class="zp-sl">Sold</span></div>
        <div class="zp-stat"><span class="zp-sn">${available}</span><span class="zp-sl">Avail</span></div>
      </div>
      <div class="zp-prog">
        <div class="zp-prog-hd">
          <span class="zp-prog-lbl">Construction</span>
          <span class="zp-prog-pct" style="color:${sm.color}">${constrPct}%</span>
        </div>
        <div class="zp-pb"><div class="zp-pf" style="width:${constrPct}%;background:${sm.color}"></div></div>
      </div>
      ${portfolio>0?`<div class="zp-fin">
        <span class="zp-fv"><span class="zp-fc">PKR</span>${_kM(portfolio)}</span>
        <span class="zp-fr" style="color:${recovColor}">${recovPct}% recov.</span>
      </div>`:''}
      <div class="zp-foot">
        <span class="zp-fl">${dueDate?`${_prjIco.calendar}&nbsp;${dueDate}`:sqft?sqft:builder?`by ${esc(builder)}`:''}</span>
        <button class="zp-fb" onclick="event.stopPropagation();openProjectDetail('${p.id}')">View →</button>
      </div>
    </div>
  </div>`;
}

// ── Insights drawer ──────────────────────────────────────────

function toggleInsightsDrawer() { _insightsOpen?closeInsightsDrawer():openInsightsDrawer(); }

function openInsightsDrawer() {
  _insightsOpen = true;
  document.getElementById('_prjDrawerOverlay')?.classList.add('open');
  document.getElementById('_prjDrawer')?.classList.add('open');
  document.getElementById('prj-insights-btn')?.classList.add('active');
  _renderInsightsDrawer();
}

function closeInsightsDrawer() {
  _insightsOpen = false;
  document.getElementById('_prjDrawerOverlay')?.classList.remove('open');
  document.getElementById('_prjDrawer')?.classList.remove('open');
  document.getElementById('prj-insights-btn')?.classList.remove('active');
}

function _renderInsightsDrawer() {
  const body = document.getElementById('prj-drawer-body');
  if (!body) return;
  const allUnits = gunits(), allProjs = gprojects();
  const total = allUnits.length;
  const sold  = allUnits.filter(u=>u.status!=='Available'&&u.status!=='Dead').length;
  const avail = allUnits.filter(u=>u.status==='Available').length;
  const p2tot = allUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const c2tot = allUnits.reduce((s,u)=>s+Number(u.totalPaid||0),0);
  const rPct  = p2tot>0?Math.round(c2tot/p2tot*100):0;
  const recovRows = allProjs.map(p=>{
    const pu=allUnits.filter(u=>u.projectId===p.id);
    const pt=pu.reduce((s,u)=>s+Number(u.totalPrice||0),0);
    const pc=pu.reduce((s,u)=>s+Number(u.totalPaid||0),0);
    const pp=pt>0?Math.round(pc/pt*100):0;
    const sm2=_prjSmMap[p.status]||_prjSmMap.active;
    return `<div class="prj-recov-item"><div class="prj-recov-hdr"><span class="prj-recov-name">${esc(p.projectName||p.name)}</span><span class="prj-recov-pct" style="color:${pp>=70?'var(--ok)':pp>=40?'var(--warn)':'var(--t3)'}">${pp}%</span></div><div class="prj-recov-bar"><div class="prj-recov-fill" style="width:${pp}%;background:${sm2.color}"></div></div><div class="prj-recov-meta"><span style="color:var(--ok);font-weight:600">PKR ${_kM(pc)}</span><span style="color:var(--t3)">of PKR ${_kM(pt)}</span></div></div>`;
  }).join('');
  const bRows = [['active','Active','#10b981'],['planning','Planning','#3b82f6'],['on_hold','On Hold','#f59e0b'],['completed','Completed','#6b7280'],['cancelled','Cancelled','#ef4444']].map(([st,lb,cl])=>{
    const cnt=allProjs.filter(p=>p.status===st).length; if(!cnt)return '';
    return `<div class="prj-breakdown-row"><span class="prj-breakdown-lbl"><span class="prj-legend-dot" style="background:${cl}"></span>${lb}</span><span class="prj-breakdown-val">${cnt}</span></div>`;
  }).join('');
  body.innerHTML = `
    <div class="prj-dsec"><div class="prj-dsec-title">Unit Distribution</div>
      <div class="prj-donut-wrap">${_prjDonutSVG(sold,avail,total)}
        <div class="prj-donut-legend">
          <div class="prj-legend-row"><span class="prj-legend-lbl"><span class="prj-legend-dot" style="background:#6366f1"></span>Sold</span><span class="prj-legend-val">${sold}</span></div>
          <div class="prj-legend-row"><span class="prj-legend-lbl"><span class="prj-legend-dot" style="background:#10b981"></span>Available</span><span class="prj-legend-val">${avail}</span></div>
          ${total-sold-avail>0?`<div class="prj-legend-row"><span class="prj-legend-lbl"><span class="prj-legend-dot" style="background:var(--warn)"></span>Other</span><span class="prj-legend-val">${total-sold-avail}</span></div>`:''}
        </div>
      </div>
    </div>
    <div class="prj-dsec"><div class="prj-dsec-title">Payment Recovery</div>${recovRows||'<div style="font-size:11px;color:var(--t3);font-style:italic">No financial data yet</div>'}</div>
    ${p2tot>0?`<div class="prj-dsec"><div class="prj-dsec-title">Overall Recovery</div><div class="prj-overall-num" style="color:${rPct>=70?'var(--ok)':rPct>=40?'var(--warn)':'var(--t3)'}">${rPct}%</div><div class="prj-overall-sub">PKR ${_kM(c2tot)} of ${_kM(p2tot)}</div><div class="prj-overall-bar"><div class="prj-overall-fill" style="width:${rPct}%;background:${rPct>=70?'var(--ok)':rPct>=40?'var(--warn)':'#6366f1'}"></div></div></div>`:''}
    <div class="prj-dsec"><div class="prj-dsec-title">Portfolio Breakdown</div>${bRows||'<div style="font-size:11px;color:var(--t3)">No projects</div>'}${p2tot>0?`<div class="prj-breakdown-total">Total Value:&nbsp;<span>PKR ${_kM(p2tot)}</span></div>`:''}</div>`;
}

function prjExport() {
  if (typeof printProjectsList==='function') printProjectsList(); else window.print();
}
// ── Detail page ────────────────────────────────────────────

function openProjectDetail(id) { _prjId = id; nav('projectdetail'); }

function _msBadge(status) {
  const map = { pending:['var(--t3)','Pending'], in_progress:['var(--info)','In Progress'], completed:['var(--ok)','Completed'], delayed:['var(--err)','Delayed'] };
  const [c, l] = map[status] || ['var(--t3)', status || 'Unknown'];
  return `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${c}22;color:${c};border:1px solid ${c}44">${l}</span>`;
}

async function rProjectDetail() {
  const prjId = _prjId;
  if (!prjId) { nav('projects'); return; }
  const cid = S?.cid;
  if (!cid)   { nav('projects'); return; }

  const prj = gproject(prjId);
  if (!prj) { nav('projects'); return; }

  document.getElementById('pg-projectdetail').innerHTML =
    `<div class="ani"><div class="empty"><div class="ei"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg></div><div class="et">Loading project...</div></div></div>`;

  const [milestones, bankAccounts, expenses] = await Promise.all([
    loadProjectMilestones(prjId, cid),
    loadProjectBankAccounts(prjId, cid),
    loadProjectExpenses(prjId, cid)
  ]);

  const isA       = S.role === 'admin' || S.role === 'owner';
  const allUnits  = gunits();
  const pUnits    = allUnits.filter(u => u.projectId === prjId);
  const sold      = pUnits.filter(u => u.status !== 'Available' && u.status !== 'Dead').length;
  const available = pUnits.filter(u => u.status === 'Available').length;
  const portfolio = pUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const collected = pUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
  const outstanding = Math.max(0, portfolio - collected);
  const recovPct  = portfolio > 0 ? Math.min(100, Math.round(collected / portfolio * 100)) : 0;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const row = (l, v) => `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>`;

  const coverBanner = prj.coverImageUrl
    ? `<div style="width:100%;height:160px;background:url('${prj.coverImageUrl}') center/cover no-repeat;border-radius:var(--rm);margin-bottom:14px"></div>`
    : '';

  // ── Photo Gallery ──
  const galleryImgs = prj.coverImages && prj.coverImages.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">` +
      prj.coverImages.map(url => `<img src="${esc(url)}" style="height:100px;border-radius:var(--rm);object-fit:cover;cursor:pointer" onclick="window.open('${esc(url)}','_blank')" onerror="this.style.display='none'">`).join('') +
      `</div>` : '';

  // ── Milestones HTML ──
  const milestonesHtml = !milestones.length
    ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div><div class="et">No milestones added yet</div></div>`
    : milestones.map(m => `
      <div style="padding:10px 0;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${esc(m.phaseName)}</div>
          ${m.description ? `<div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(m.description)}</div>` : ''}
          <div style="display:flex;gap:12px;margin-top:4px;font-size:11px;color:var(--t3);flex-wrap:wrap">
            ${m.targetDate ? `<span>Target: ${fD(m.targetDate)}</span>` : ''}
            ${m.completionDate ? `<span style="color:var(--ok)">Done: ${fD(m.completionDate)}</span>` : ''}
            ${m.progressPct > 0 ? `<span>${m.progressPct}% complete</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${_msBadge(m.status)}
          ${isA ? `<button class="btn btn-gh btn-xs" onclick="openMilestoneModal('${m.id}','${prjId}')">Edit</button>` : ''}
          ${isA ? `<button class="btn btn-r btn-xs" onclick="deleteMilestoneConfirm('${m.id}','${prjId}')">Del</button>` : ''}
        </div>
      </div>`).join('');

  // ── Bank Accounts HTML ──
  const bankHtml = !bankAccounts.length
    ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg></div><div class="et">No bank accounts added yet</div></div>`
    : bankAccounts.map(b => `
      <div style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px">${esc(b.bankName)} ${b.isPrimary ? `<span style="font-size:10px;background:var(--ok)22;color:var(--ok);padding:1px 6px;border-radius:8px;border:1px solid var(--ok)44">Primary</span>` : ''}</div>
            <div style="font-size:12px;color:var(--t2);margin-top:2px">${esc(b.accountTitle)}</div>
            ${b.accountNo ? `<div style="font-size:11px;color:var(--t3);font-family:monospace">A/C: ${esc(b.accountNo)}</div>` : ''}
            ${b.iban ? `<div style="font-size:11px;color:var(--t3);font-family:monospace">IBAN: ${esc(b.iban)}</div>` : ''}
            ${b.branch ? `<div style="font-size:11px;color:var(--t3)">Branch: ${esc(b.branch)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${isA ? `<button class="btn btn-gh btn-xs" onclick="openBankAcctModal('${b.id}','${prjId}')">Edit</button>` : ''}
            ${isA ? `<button class="btn btn-r btn-xs" onclick="deleteBankAcctConfirm('${b.id}','${prjId}')">Del</button>` : ''}
          </div>
        </div>
      </div>`).join('');

  // ── Expenses HTML ──
  const isAe = isA;
  const expensesHtml = !expenses.length
    ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="et">No expenses recorded yet</div></div>`
    : `<div class="tw"><table class="t">
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="r">Amount</th>${isAe ? '<th></th>' : ''}</tr></thead>
        <tbody>` +
      expenses.map(e => `<tr>
        <td style="font-size:11px;color:var(--t3)">${e.expenseDate ? fD(e.expenseDate) : '—'}</td>
        <td><span style="font-size:11px;padding:2px 7px;background:var(--canvas);border-radius:8px;border:1px solid var(--line)">${esc(e.category)}</span></td>
        <td style="font-size:12px">${esc(e.description || '—')}</td>
        <td class="r mono" style="font-weight:700;color:var(--err)">-${fM(e.amount)}</td>
        ${isAe ? `<td><button class="btn btn-r btn-xs" onclick="deleteExpenseConfirm('${e.id}','${prjId}')">Del</button></td>` : ''}
      </tr>`).join('') +
      `<tr style="background:var(--hover)">
        <td colspan="3" style="font-weight:700">Total Expenses</td>
        <td class="r mono" style="font-weight:700;color:var(--err)">-${fM(totalExpenses)}</td>
        ${isAe ? '<td></td>' : ''}
      </tr></tbody></table></div>`;

  document.getElementById('pg-projectdetail').innerHTML = `<div class="ani">
    <!-- Form navigation bar -->
    <div id="pd-form-nav"></div>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="nav('projects')">← Back</button>
      <button class="btn btn-print btn-sm" onclick="printProjectDetail('${prjId}')">Print</button>
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="openProjectModal('${prjId}')">Edit</button>` : ''}
      ${isA ? `<button class="btn btn-r btn-sm" onclick="deleteProjectConfirm('${prjId}')">Delete</button>` : ''}
    </div>

    ${coverBanner}
    ${galleryImgs}

    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:11px;color:var(--t3);font-family:monospace;margin-bottom:4px">${esc(prj.projectCode||'')}</div>
            <h2 style="font-size:28px;font-weight:800;margin-bottom:8px;letter-spacing:-.3px">${esc(prj.projectName||prj.name)}</h2>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              ${prjStatusBadge(prj.status)}
              ${prj.city ? `<span style="font-size:12px;color:var(--t3)">${esc(prj.city)}${prj.country?', '+esc(prj.country):''}</span>` : prj.location ? `<span style="font-size:12px;color:var(--t3)">${esc(prj.location)}</span>` : ''}
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid var(--line)">
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:20px;font-weight:800;color:var(--t1)">${pUnits.length}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Total Units</div>
          </div>
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:20px;font-weight:800;color:var(--ok)">${sold}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Sold</div>
          </div>
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:20px;font-weight:800;color:var(--info)">${available}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Available</div>
          </div>
          ${portfolio > 0 ? `
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:14px;font-weight:800;color:var(--t1)">${fM(portfolio)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Portfolio</div>
          </div>
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:14px;font-weight:800;color:var(--ok)">${fM(collected)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Collected</div>
          </div>
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:14px;font-weight:800;color:${outstanding > 0 ? 'var(--err)' : 'var(--ok)'}">${fM(outstanding)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Outstanding</div>
          </div>` : ''}
          ${totalExpenses > 0 ? `
          <div style="padding:10px 12px;background:var(--canvas);border-radius:var(--rm);text-align:center">
            <div style="font-size:14px;font-weight:800;color:var(--err)">-${fM(totalExpenses)}</div>
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Expenses</div>
          </div>` : ''}
        </div>

        ${portfolio > 0 || prj.constructionProgress > 0 ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px">
          ${portfolio > 0 ? `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:5px">
              <span>Recovery Progress</span><span style="font-weight:700;color:var(--t1)">${recovPct}%</span>
            </div>
            <div class="pbar" style="width:100%;height:8px"><div class="pbar-f" style="width:${recovPct}%"></div></div>
          </div>` : ''}
          ${prj.constructionProgress > 0 ? `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:5px">
              <span>Construction Progress</span><span style="font-weight:700;color:var(--info)">${prj.constructionProgress}%</span>
            </div>
            <div class="pbar" style="width:100%;height:8px"><div class="pbar-f" style="width:${prj.constructionProgress}%;background:var(--info)"></div></div>
          </div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <!-- Project Collection Ledger tabs -->
    <div style="display:flex;border-bottom:2px solid var(--line);margin-bottom:14px">
      <button id="prj-tab-overview-btn"   onclick="prjSwitchTab('overview')"   style="padding:8px 16px;background:none;border:none;border-bottom:2px solid var(--pri);color:var(--pri);font-weight:600;cursor:pointer;font-size:13px;margin-bottom:-2px">Overview</button>
      <button id="prj-tab-ledger-btn"     onclick="prjSwitchTab('ledger')"     style="padding:8px 16px;background:none;border:none;border-bottom:2px solid transparent;color:var(--t3);font-weight:600;cursor:pointer;font-size:13px;margin-bottom:-2px">Collection Ledger</button>
      <button id="prj-tab-revisions-btn"  onclick="prjSwitchTab('revisions')"  style="padding:8px 16px;background:none;border:none;border-bottom:2px solid transparent;color:var(--t3);font-weight:600;cursor:pointer;font-size:13px;margin-bottom:-2px">Price Revisions</button>
    </div>
    <div id="prj-tab-overview">
    <div class="cd">
      <div style="display:flex;flex-direction:column;gap:13px">

        <div class="card">
          <div class="ch"><h3>Project Info</h3></div>
          <div class="cb">
            ${row('Code',        `<span style="font-family:monospace">${esc(prj.projectCode||'—')}</span>`)}
            ${row('Name',        esc(prj.projectName||prj.name||'—'))}
            ${row('Status',      prjStatusBadge(prj.status))}
            ${prj.location ? row('Address',   esc(prj.location)) : ''}
            ${prj.city     ? row('City',      esc(prj.city)) : ''}
            ${prj.country  ? row('Country',   esc(prj.country)) : ''}
            ${prj.gpsLat && prj.gpsLng ? row('GPS', `${prj.gpsLat}, ${prj.gpsLng}${prj.mapLink ? ` <a href="${esc(prj.mapLink)}" target="_blank" style="font-size:11px;color:var(--info)">Open Map</a>` : ''}`) : prj.mapLink ? row('Map', `<a href="${esc(prj.mapLink)}" target="_blank" style="color:var(--info)">Open Map</a>`) : ''}
            ${prj.totalArea > 0 ? row('Total Area', `${Number(prj.totalArea).toLocaleString()} ${prj.areaUnit||'sqft'}`) : ''}
            ${prj.totalUnits > 0 ? row('Planned Units', prj.totalUnits) : ''}
            ${prj.startDate ? row('Start Date', fD(prj.startDate)) : ''}
            ${prj.expectedCompletion ? row('Expected Completion', fD(prj.expectedCompletion)) : ''}
            ${prj.description ? row('Description', esc(prj.description)) : ''}
            ${row('Created', prj.createdAt ? fD(prj.createdAt.slice(0,10)) : '—')}
          </div>
        </div>

        ${prj.amenities && prj.amenities.length ? `
        <div class="card">
          <div class="ch"><h3>Amenities</h3></div>
          <div class="cb">
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${prj.amenities.map(a => `<span style="font-size:12px;padding:4px 10px;background:var(--canvas);border:1px solid var(--line);border-radius:20px">${esc(a)}</span>`).join('')}
            </div>
          </div>
        </div>` : ''}

        ${prj.builderName || prj.builderContact || prj.builderEmail ? `
        <div class="card">
          <div class="ch"><h3>Builder / Developer</h3></div>
          <div class="cb">
            ${prj.builderName    ? row('Builder',  esc(prj.builderName))    : ''}
            ${prj.builderContact ? row('Contact',  esc(prj.builderContact)) : ''}
            ${prj.builderEmail   ? row('Email',    `<a href="mailto:${esc(prj.builderEmail)}" style="color:var(--info)">${esc(prj.builderEmail)}</a>`) : ''}
          </div>
        </div>` : ''}

        ${prj.nocNumber || prj.nocAuthority || prj.nocDate ? `
        <div class="card">
          <div class="ch"><h3>NOC / Approvals</h3></div>
          <div class="cb">
            ${prj.nocNumber    ? row('NOC No.',    esc(prj.nocNumber))    : ''}
            ${prj.nocAuthority ? row('Authority',  esc(prj.nocAuthority)) : ''}
            ${prj.nocDate      ? row('NOC Date',   fD(prj.nocDate))       : ''}
            ${prj.nocNotes     ? row('Notes',      esc(prj.nocNotes))     : ''}
          </div>
        </div>` : ''}

        <div class="card">
          <div class="ch"><h3>Financial Summary</h3></div>
          <div class="cb">
            ${row('Total Portfolio', fMF(portfolio))}
            ${row('Total Collected', `<span style="color:var(--ok);font-weight:700">${fMF(collected)}</span>`)}
            ${row('Outstanding',     `<span style="color:${outstanding > 0 ? 'var(--err)' : 'var(--ok)'};font-weight:700">${outstanding > 0 ? fMF(outstanding) : 'Fully Collected'}</span>`)}
            ${portfolio > 0 ? row('Recovery %', `<strong>${recovPct}%</strong>`) : ''}
            ${totalExpenses > 0 ? row('Total Expenses', `<span style="color:var(--err);font-weight:700">-${fMF(totalExpenses)}</span>`) : ''}
            ${totalExpenses > 0 && portfolio > 0 ? row('Net (Portfolio − Expenses)', `<strong>${fMF(portfolio - totalExpenses)}</strong>`) : ''}
          </div>
        </div>

      </div>

      <div style="display:flex;flex-direction:column;gap:13px">

        <div class="card">
          <div class="ch">
            <div><h3>Units in Project</h3><p>${pUnits.length} unit${pUnits.length !== 1 ? 's' : ''} linked</p></div>
          </div>
          ${!pUnits.length
            ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><div class="et">No units linked yet</div><div class="es">Open any unit → Edit → assign this project</div></div>`
            : `<div class="ul">` + pUnits.map(u => {
                const paid = actualPaid(u), rem = actualPending(u), p2 = pct(paid, u.totalPrice);
                return `<div class="ur" onclick="openUD('${u.id}')">
                  <div class="ur-no">${esc(u.unitNo || '—')}</div>
                  <div style="flex-shrink:0">${sbadge(u.status)}</div>
                  <div class="ur-meta">
                    <div class="ur-name">${u.customerName || '<span style="color:var(--t3)">Available</span>'}</div>
                    <div class="ur-sub">${esc(u.floorLabel || '—')} · ${esc(u.type || '—')} · ${u.area || '—'} ${u.areaUnit||'sqft'}</div>
                  </div>
                  ${u.totalPrice > 0
                    ? `<div style="flex-shrink:0;width:68px"><div class="pbar"><div class="pbar-f" style="width:${p2}%"></div></div><div style="font-size:9px;color:var(--t3);margin-top:2px">${p2}% paid</div></div>
                       <div class="ur-bal"><div class="ur-v" style="color:${rem>0?'var(--err)':'var(--ok)'}">${fM(rem>0?rem:paid)}</div><div class="ur-vs">${rem>0?'pending':'paid'}</div></div>`
                    : `<div class="ur-bal"><div class="ur-v c-m">—</div></div>`}
                  <div class="arr">›</div>
                </div>`;
              }).join('') + `</div>`
          }
        </div>

        <div class="card">
          <div class="ch">
            <div><h3>Milestones / Phases</h3><p>${milestones.length} milestone${milestones.length !== 1 ? 's' : ''}</p></div>
            ${isA ? `<button class="btn btn-g btn-xs" onclick="openMilestoneModal(null,'${prjId}')">+ Add</button>` : ''}
          </div>
          ${milestonesHtml}
        </div>

        <div class="card">
          <div class="ch">
            <div><h3>Bank Accounts</h3><p>${bankAccounts.length} account${bankAccounts.length !== 1 ? 's' : ''}</p></div>
            ${isA ? `<button class="btn btn-g btn-xs" onclick="openBankAcctModal(null,'${prjId}')">+ Add</button>` : ''}
          </div>
          ${bankHtml}
        </div>

        <div class="card">
          <div class="ch">
            <div><h3>Project Expenses</h3><p>${expenses.length} record${expenses.length !== 1 ? 's' : ''}${totalExpenses > 0 ? ' · -'+fM(totalExpenses) : ''}</p></div>
            ${isA ? `<button class="btn btn-g btn-xs" onclick="openExpenseModal(null,'${prjId}')">+ Add</button>` : ''}
          </div>
          ${expensesHtml}
        </div>

      </div>
    </div>
    </div><!-- /prj-tab-overview -->
    <div id="prj-tab-ledger" data-project-id="${prjId}" style="display:none">
      <div id="prj-ledger-body"></div>
    </div>
    <div id="prj-tab-revisions" data-project-id="${prjId}" style="display:none">
      <div id="prj-revisions-body"></div>
    </div>
  </div>`;

  // Mount reusable form-nav bar
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#pd-form-nav',
      entity:    'project',
      dateField: 'createdAt',
      currentId: prjId,
      storageKey:'rms.fnav.project',
      loadList: async () => (window._projectsCache || []).map(x => ({
        id: x.id,
        createdAt: x.createdAt || x.created_at || x.startDate || ''
      })),
      openEntry: (id) => openProjectDetail(id),
      onEdit:    (id) => isA && openProjectModal(id),
      onDelete:  async (id) => isA && deleteProjectConfirm(id)
    });
  }
}

// ── PROJECT COLLECTION LEDGER ──────────────────────────────

function prjSwitchTab(tab) {
  ['overview','ledger','revisions'].forEach(t => {
    document.getElementById('prj-tab-'+t).style.display = t === tab ? '' : 'none';
    const btn = document.getElementById('prj-tab-'+t+'-btn');
    if (btn) {
      btn.style.borderBottom = t === tab ? '2px solid var(--pri)' : '2px solid transparent';
      btn.style.color        = t === tab ? 'var(--pri)' : 'var(--t3)';
    }
  });
  if (tab === 'ledger') {
    const el   = document.getElementById('prj-tab-ledger');
    const body = document.getElementById('prj-ledger-body');
    const pid  = el?.dataset?.projectId;
    if (pid && body && body.dataset.loaded !== pid) _prjLoadLedger(pid);
  }
  if (tab === 'revisions') {
    const el   = document.getElementById('prj-tab-revisions');
    const body = document.getElementById('prj-revisions-body');
    const pid  = el?.dataset?.projectId;
    if (pid && body && body.dataset.loaded !== pid) _prjLoadRevisions(pid);
  }
}

async function _prjLoadLedger(projectId) {
  const el = document.getElementById('prj-ledger-body');
  if (!el) return;
  el.innerHTML = `<div class="empty" style="padding:28px"><div class="es" style="color:var(--t3)">Loading…</div></div>`;

  const { data, error } = await supabase.rpc('get_project_collection_ledger', {
    p_project_id: projectId, p_company_id: S.cid
  });
  if (error || !data?.success) {
    el.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load ledger</div><div class="es">${esc(data?.error || error?.message || 'Error')}</div></div></div>`;
    return;
  }

  const sales   = data.sales   || [];
  const monthly = data.monthly || [];

  if (!sales.length) {
    el.innerHTML = `<div class="card"><div class="ch"><h3>Collection Ledger</h3></div><div class="empty" style="padding:28px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg></div><div class="et">No sales recorded yet</div><div class="es">Sales for this project will appear here once booked</div></div></div>`;
    el.dataset.loaded = projectId;
    return;
  }

  // Aggregate totals
  let totalPrice = 0, totalCollected = 0, totalOutstanding = 0;
  sales.forEach(s => {
    totalPrice       += Number(s.sale_price   || 0);
    totalCollected   += Number(s.collected    || 0);
    totalOutstanding += Number(s.outstanding  || 0);
  });
  const recovPct = totalPrice > 0 ? Math.round(totalCollected / totalPrice * 100) : 0;

  // Cumulative monthly for bar chart
  let cumulative = 0;
  const monthlyEnriched = monthly.map(m => {
    cumulative += Number(m.collected || 0);
    return { ...m, _collected: Number(m.collected || 0), _cumulative: cumulative };
  });
  const maxMonthly = Math.max(...monthlyEnriched.map(m => m._collected), 1);

  // ── Per-sale summary table ──
  const salesTable = `
    <div class="card" style="margin-bottom:16px">
      <div class="ch"><h3>Per-Client Summary</h3><p>${sales.length} sale${sales.length !== 1 ? 's' : ''}</p></div>
      <div class="tw"><table class="t">
        <thead><tr>
          <th>Unit</th>
          <th>Client</th>
          <th>Sale No</th>
          <th>Date</th>
          <th class="r">Sale Price</th>
          <th class="r" style="color:var(--ok)">Collected</th>
          <th class="r" style="color:var(--err)">Outstanding</th>
          <th class="r">Recovery</th>
        </tr></thead>
        <tbody>
        ${sales.map(s => {
          const pct2 = s.sale_price > 0 ? Math.round(Number(s.collected) / Number(s.sale_price) * 100) : 0;
          const isPaid = Number(s.outstanding) === 0;
          return `<tr>
            <td style="font-family:monospace;font-weight:700;white-space:nowrap">${esc(s.unit_no || s.unit_code || '—')}</td>
            <td style="font-weight:600">${esc(s.client_name || '—')}</td>
            <td style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(s.sale_number || '—')}</td>
            <td style="font-size:12px;color:var(--t3);white-space:nowrap">${fD(s.sale_date)}</td>
            <td class="r mono">${fM(s.sale_price)}</td>
            <td class="r mono" style="color:var(--ok);font-weight:700">${fM(s.collected)}</td>
            <td class="r mono" style="color:${isPaid ? 'var(--ok)' : 'var(--err)'};font-weight:700">${isPaid ? 'Nil' : fM(s.outstanding)}</td>
            <td class="r" style="min-width:80px">
              <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
                <div style="width:48px;height:5px;background:var(--line);border-radius:99px;overflow:hidden">
                  <div style="height:100%;width:${pct2}%;background:${pct2>=100?'var(--ok)':pct2>=50?'#22c55e':'var(--warn)'};-webkit-print-color-adjust:exact"></div>
                </div>
                <span style="font-size:11px;font-weight:700;color:var(--t2)">${pct2}%</span>
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:2px solid var(--line);background:var(--canvas)">
            <td colspan="4" style="padding:10px 12px;font-size:12px;color:var(--t3)">TOTAL (${sales.length} sales)</td>
            <td class="r mono">${fM(totalPrice)}</td>
            <td class="r mono" style="color:var(--ok)">${fM(totalCollected)}</td>
            <td class="r mono" style="color:${totalOutstanding > 0 ? 'var(--err)' : 'var(--ok)'}">${totalOutstanding > 0 ? fM(totalOutstanding) : 'Nil'}</td>
            <td class="r" style="font-size:13px;font-weight:800;color:var(--t1)">${recovPct}%</td>
          </tr>
        </tfoot>
      </table></div>
    </div>`;

  // ── Monthly breakdown table ──
  const monthlyTable = monthlyEnriched.length ? `
    <div class="card">
      <div class="ch"><h3>Monthly Collections</h3><p>${monthlyEnriched.length} month${monthlyEnriched.length !== 1 ? 's' : ''}</p></div>
      <div class="tw"><table class="t">
        <thead><tr>
          <th>Month</th>
          <th class="r" style="color:var(--ok)">Collected</th>
          <th class="r">Cumulative</th>
          <th style="min-width:160px">Trend</th>
        </tr></thead>
        <tbody>
        ${monthlyEnriched.map(m => {
          const barW = Math.round(m._collected / maxMonthly * 100);
          return `<tr>
            <td style="font-weight:600;white-space:nowrap">${esc(m.month_lbl)}</td>
            <td class="r mono" style="color:var(--ok);font-weight:700">${fM(m._collected)}</td>
            <td class="r mono" style="color:var(--t2)">${fM(m._cumulative)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:6px;background:var(--line);border-radius:99px;overflow:hidden">
                  <div style="height:100%;width:${barW}%;background:var(--ok);-webkit-print-color-adjust:exact"></div>
                </div>
                <span style="font-size:10px;color:var(--t3);width:32px;text-align:right">${barW}%</span>
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:2px solid var(--line);background:var(--canvas)">
            <td style="padding:10px 12px;font-size:12px;color:var(--t3)">TOTAL</td>
            <td class="r mono" style="color:var(--ok)">${fM(totalCollected)}</td>
            <td class="r mono" style="color:var(--t2)">${fM(totalCollected)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table></div>
    </div>` : '';

  el.innerHTML = salesTable + monthlyTable;
  el.dataset.loaded = projectId;
}

// ── Modal open/close ───────────────────────────────────────

function openProjectModal(prjId) {
  const isEdit = !!prjId;
  document.getElementById('prj-mtl').textContent = isEdit ? 'Edit Project' : 'Add Project';
  document.getElementById('pf-prj-id').value = prjId || '';

  const fields = ['pf-name','pf-desc','pf-location','pf-city','pf-total-area','pf-total-units','pf-start','pf-expected-completion','pf-delivery-date','pf-cover-url'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const codeEl = document.getElementById('pf-code');
  const statusEl = document.getElementById('pf-status');
  const areaUnitEl = document.getElementById('pf-area-unit');

  document.querySelectorAll('#m-project .pf-err').forEach(el => el.textContent = '');
  document.querySelectorAll('#m-project .inp-err').forEach(el => el.classList.remove('inp-err'));

  if (isEdit) {
    const p = gproject(prjId);
    if (p) {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      set('pf-code',                p.projectCode || '');
      set('pf-name',                p.projectName || p.name);
      set('pf-desc',                p.description);
      set('pf-location',            p.location);
      set('pf-city',                p.city);
      set('pf-total-area',          p.totalArea || '');
      set('pf-total-units',         p.totalUnits || '');
      set('pf-start',               p.startDate);
      set('pf-expected-completion', p.expectedCompletion);
      set('pf-delivery-date',       p.deliveryDate || '');
      set('pf-cover-url',           p.coverImageUrl);
      // Extended fields
      set('pf-gps-lat',             p.gpsLat || '');
      set('pf-gps-lng',             p.gpsLng || '');
      set('pf-map-link',            p.mapLink);
      set('pf-construction-progress', p.constructionProgress || 0);
      set('pf-builder-name',        p.builderName);
      set('pf-builder-contact',     p.builderContact);
      set('pf-builder-email',       p.builderEmail);
      set('pf-noc-number',          p.nocNumber);
      set('pf-noc-authority',       p.nocAuthority);
      set('pf-noc-date',            p.nocDate);
      set('pf-noc-notes',           p.nocNotes);
      set('pf-cover-images',        (p.coverImages || []).join('\n'));
      const progressVal = document.getElementById('pf-progress-val');
      if (progressVal) progressVal.textContent = p.constructionProgress || 0;
      const amenitySet = new Set(p.amenities || []);
      document.querySelectorAll('#m-project .pf-amenity').forEach(cb => { cb.checked = amenitySet.has(cb.value); });
      if (statusEl)   statusEl.value   = p.status   || 'active';
      if (areaUnitEl) areaUnitEl.value = p.areaUnit || 'sqft';
    }
  } else {
    if (codeEl)     codeEl.value     = genProjectCode();
    if (statusEl)   statusEl.value   = 'active';
    if (areaUnitEl) areaUnitEl.value = 'sqft';
    ['pf-gps-lat','pf-gps-lng','pf-map-link','pf-builder-name','pf-builder-contact','pf-builder-email',
     'pf-noc-number','pf-noc-authority','pf-noc-date','pf-noc-notes','pf-cover-images'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const progressEl = document.getElementById('pf-construction-progress');
    if (progressEl) progressEl.value = 0;
    const progressVal = document.getElementById('pf-progress-val');
    if (progressVal) progressVal.textContent = '0';
    document.querySelectorAll('#m-project .pf-amenity').forEach(cb => { cb.checked = false; });
  }

  om('m-project');
}

function closeProjectModal() { cm('m-project'); }

// ── Save ───────────────────────────────────────────────────

async function saveProjectForm() {
  const name = document.getElementById('pf-name')?.value?.trim();

  let hasErr = false;
  const setErr = (id, msg, inputId) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    const inp = document.getElementById(inputId || id.slice(2));
    if (inp) inp.classList.toggle('inp-err', !!msg);
    if (msg) hasErr = true;
  };

  setErr('e-pf-name', !name ? 'Project name is required' : name.length < 2 ? 'Min 2 characters' : '');
  if (hasErr) return;

  const existingId = document.getElementById('pf-prj-id')?.value?.trim() || '';

  // Plan limit check — only for new projects, not edits
  if (!existingId) {
    let limRes;
    try {
      limRes = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: S.cid });
    } catch(e) {
      toast('Could not verify plan limits. Check your connection and try again.', 'err');
      return;
    }
    if (limRes?.error) {
      toast('Could not verify plan limits. Check your connection and try again.', 'err');
      return;
    }
    const maxProjects     = limRes.data?.max_projects ?? 0;
    const currentProjects = gprojects().length;
    if (maxProjects > 0 && currentProjects >= maxProjects) {
      toast(`Project limit reached — your plan allows ${maxProjects} project${maxProjects > 1 ? 's' : ''}. Upgrade to add more.`, 'err');
      return;
    }
  }

  const btn = document.getElementById('prj-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const totalArea  = parseFloat(document.getElementById('pf-total-area')?.value)  || null;
    const totalUnits = parseInt(document.getElementById('pf-total-units')?.value)    || null;
    const startDate  = document.getElementById('pf-start')?.value                   || null;
    const expComp    = document.getElementById('pf-expected-completion')?.value      || null;
    const delivDate  = document.getElementById('pf-delivery-date')?.value           || null;

    const prjData = {
      company_id:               S.cid,
      project_code:             document.getElementById('pf-code')?.value?.trim()   || genProjectCode(),
      project_name:             name,
      status:                   document.getElementById('pf-status')?.value         || 'active',
      description:              document.getElementById('pf-desc')?.value?.trim()   || null,
      location:                 document.getElementById('pf-location')?.value?.trim() || null,
      city:                     document.getElementById('pf-city')?.value?.trim()   || null,
      country:                  'Pakistan',
      total_area:               totalArea,
      area_unit:                document.getElementById('pf-area-unit')?.value      || 'sqft',
      total_units:              totalUnits,
      start_date:               startDate,
      expected_completion_date: expComp,
      delivery_date:            delivDate,
      cover_image_url:          document.getElementById('pf-cover-url')?.value?.trim() || null,
      // Extended fields
      gps_lat:                  parseFloat(document.getElementById('pf-gps-lat')?.value) || null,
      gps_lng:                  parseFloat(document.getElementById('pf-gps-lng')?.value) || null,
      map_link:                 document.getElementById('pf-map-link')?.value?.trim() || null,
      construction_progress:    parseInt(document.getElementById('pf-construction-progress')?.value) || 0,
      amenities:                Array.from(document.querySelectorAll('#m-project .pf-amenity:checked')).map(cb => cb.value),
      builder_name:             document.getElementById('pf-builder-name')?.value?.trim() || null,
      builder_contact:          document.getElementById('pf-builder-contact')?.value?.trim() || null,
      builder_email:            document.getElementById('pf-builder-email')?.value?.trim() || null,
      noc_number:               document.getElementById('pf-noc-number')?.value?.trim() || null,
      noc_authority:            document.getElementById('pf-noc-authority')?.value?.trim() || null,
      noc_date:                 document.getElementById('pf-noc-date')?.value || null,
      noc_notes:                document.getElementById('pf-noc-notes')?.value?.trim() || null,
      cover_images:             (document.getElementById('pf-cover-images')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
      created_by:               existingId ? undefined : S.userId
    };

    if (existingId) {
      delete prjData.created_by;
      prjData.id = existingId;
    }

    const result = await saveProject(prjData);
    if (!result || result._error) {
      const e = result?._error;
      if (e?.message?.startsWith('plan_limit:')) {
        toast('Project limit reached — upgrade your plan to add more projects.', 'err');
      } else {
        toast((e ? `${e.message} (${e.code})` : 'Unknown error — check console'), 'err');
      }
      return;
    }

    await loadProjectsCache(S.cid);
    logA('project', (existingId ? 'Updated' : 'Added') + ' project: ' + name);
    toast(existingId ? 'Project updated' : 'Project added', 'ok');
    cm('m-project');
    rProjects();
  } catch (err) {
    console.error('[saveProjectForm]', err);
    toast('Could not save project: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Project'; }
  }
}

// ── Delete ─────────────────────────────────────────────────

async function deleteProjectConfirm(prjId) {
  const p = gproject(prjId);
  const name = p?.projectName || p?.name || 'this project';

  if (typeof cascadeDelete === 'function') {
    await cascadeDelete({
      entity:      'project',
      displayName: name,
      id:          prjId,
      checks: [
        { table: 'units',    fk: 'project_id', label: 'unit' },
        { table: 'sales',    fk: 'project_id', label: 'sale record' }
      ],
      onDelete: async () => {
        const ok = await deleteProjectDB(prjId);
        if (!ok) throw new Error('Delete RPC returned false');
      },
      onSuccess: async () => {
        await loadProjectsCache(S.cid);
        logA('project', 'Deleted project: ' + name);
        nav('projects');
      }
    });
    return;
  }

  // Legacy fallback
  const linkedUnits = gunits().filter(u => u.projectId === prjId);
  if (linkedUnits.length > 0) {
    toast(`Cannot delete — this project has ${linkedUnits.length} unit(s). Delete or move all units first.`, 'err');
    return;
  }
  if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
  const ok = await deleteProjectDB(prjId);
  if (!ok) { toast('Could not delete project', 'err'); return; }
  await loadProjectsCache(S.cid);
  toast('Project deleted', 'ok'); nav('projects');
}

// ── Milestone Modal ────────────────────────────────────────

function openMilestoneModal(id, prjId) {
  document.getElementById('ms-id').value     = id || '';
  document.getElementById('ms-prj-id').value = prjId || '';
  document.getElementById('ms-mtl').textContent = id ? 'Edit Milestone' : 'Add Milestone';
  ['ms-name','ms-desc','ms-target','ms-completed','ms-progress'].forEach(fid => {
    const el = document.getElementById(fid); if (el) el.value = '';
  });
  document.getElementById('ms-status').value = 'pending';
  document.getElementById('e-ms-name').textContent = '';
  if (id) {
    // For edit, we don't cache milestones, so just open blank — user can re-enter
    // (milestone data is fetched fresh on detail render)
    toast('Fill in the details and save to update', 'info');
  }
  om('m-milestone');
}

async function saveMilestoneForm() {
  const name = document.getElementById('ms-name')?.value?.trim();
  const errEl = document.getElementById('e-ms-name');
  if (!name) { if (errEl) errEl.textContent = 'Name is required'; return; }
  if (errEl) errEl.textContent = '';

  const id    = document.getElementById('ms-id')?.value?.trim() || null;
  const prjId = document.getElementById('ms-prj-id')?.value?.trim();
  const btn   = document.getElementById('ms-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const payload = {
      company_id:   S.cid,
      project_id:   prjId,
      phase_name:   name,
      description:  document.getElementById('ms-desc')?.value?.trim() || null,
      target_date:  document.getElementById('ms-target')?.value || null,
      completion_date: document.getElementById('ms-completed')?.value || null,
      progress_pct: parseInt(document.getElementById('ms-progress')?.value) || 0,
      status:       document.getElementById('ms-status')?.value || 'pending',
      sort_order:   0
    };
    if (id) payload.id = id;
    const result = await saveMilestone(payload);
    if (!result) { toast('Could not save milestone', 'err'); return; }
    cm('m-milestone');
    toast(id ? 'Milestone updated' : 'Milestone added', 'ok');
    _prjId = prjId; nav('projectdetail');
  } catch (err) { toast('Error: ' + err.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
}

async function deleteMilestoneConfirm(id, prjId) {
  if (!confirm('Delete this milestone?')) return;
  const ok = await deleteMilestoneDB(id);
  if (!ok) { toast('Could not delete milestone', 'err'); return; }
  toast('Milestone deleted', 'ok');
  _prjId = prjId; nav('projectdetail');
}

// ── Bank Account Modal ─────────────────────────────────────

function openBankAcctModal(id, prjId) {
  document.getElementById('ba-id').value     = id || '';
  document.getElementById('ba-prj-id').value = prjId || '';
  document.getElementById('ba-mtl').textContent = id ? 'Edit Bank Account' : 'Add Bank Account';
  ['ba-bank','ba-title','ba-acctno','ba-branch','ba-iban','ba-notes'].forEach(fid => {
    const el = document.getElementById(fid); if (el) el.value = '';
  });
  document.getElementById('ba-primary').checked = false;
  ['e-ba-bank','e-ba-title'].forEach(eid => { const el = document.getElementById(eid); if (el) el.textContent = ''; });
  if (id) toast('Fill in the details and save to update', 'info');
  om('m-bankacct');
}

async function saveBankAcctForm() {
  const bank  = document.getElementById('ba-bank')?.value?.trim();
  const title = document.getElementById('ba-title')?.value?.trim();
  let hasErr  = false;
  const setE  = (eid, msg) => { const el = document.getElementById(eid); if (el) el.textContent = msg; if (msg) hasErr = true; };
  setE('e-ba-bank',  !bank  ? 'Bank name is required'      : '');
  setE('e-ba-title', !title ? 'Account title is required'  : '');
  if (hasErr) return;

  const id    = document.getElementById('ba-id')?.value?.trim() || null;
  const prjId = document.getElementById('ba-prj-id')?.value?.trim();
  const btn   = document.getElementById('ba-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const payload = {
      company_id:    S.cid,
      project_id:    prjId,
      bank_name:     bank,
      account_title: title,
      account_no:    document.getElementById('ba-acctno')?.value?.trim() || null,
      branch:        document.getElementById('ba-branch')?.value?.trim() || null,
      iban:          document.getElementById('ba-iban')?.value?.trim()   || null,
      is_primary:    document.getElementById('ba-primary')?.checked      || false,
      notes:         document.getElementById('ba-notes')?.value?.trim()  || null
    };
    if (id) payload.id = id;
    const result = await saveBankAccount(payload);
    if (!result) { toast('Could not save bank account', 'err'); return; }
    cm('m-bankacct');
    toast(id ? 'Bank account updated' : 'Bank account added', 'ok');
    _prjId = prjId; nav('projectdetail');
  } catch (err) { toast('Error: ' + err.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
}

async function deleteBankAcctConfirm(id, prjId) {
  if (!confirm('Delete this bank account?')) return;
  const ok = await deleteBankAccountDB(id);
  if (!ok) { toast('Could not delete bank account', 'err'); return; }
  toast('Bank account deleted', 'ok');
  _prjId = prjId; nav('projectdetail');
}

// ── Expense Modal ──────────────────────────────────────────

function openExpenseModal(id, prjId) {
  document.getElementById('ex-id').value     = id || '';
  document.getElementById('ex-prj-id').value = prjId || '';
  document.getElementById('ex-mtl').textContent = id ? 'Edit Expense' : 'Add Expense';
  ['ex-desc','ex-notes'].forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
  document.getElementById('ex-category').value = '';
  document.getElementById('ex-amount').value   = '';
  document.getElementById('ex-date').value     = new Date().toISOString().slice(0,10);
  ['e-ex-category','e-ex-amount'].forEach(eid => { const el = document.getElementById(eid); if (el) el.textContent = ''; });
  if (id) toast('Fill in the details and save to update', 'info');
  om('m-expense');
}

async function saveExpenseForm() {
  const category = document.getElementById('ex-category')?.value;
  const amount   = parseFloat(document.getElementById('ex-amount')?.value);
  let hasErr     = false;
  const setE     = (eid, msg) => { const el = document.getElementById(eid); if (el) el.textContent = msg; if (msg) hasErr = true; };
  setE('e-ex-category', !category ? 'Select a category' : '');
  setE('e-ex-amount',   (!amount || amount <= 0) ? 'Enter a valid amount' : '');
  if (hasErr) return;

  const id    = document.getElementById('ex-id')?.value?.trim() || null;
  const prjId = document.getElementById('ex-prj-id')?.value?.trim();
  const btn   = document.getElementById('ex-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const payload = {
      company_id:       S.cid,
      project_id:       prjId,
      expense_category: category,
      description:      document.getElementById('ex-desc')?.value?.trim()  || null,
      amount:           amount,
      expense_date:     document.getElementById('ex-date')?.value          || null,
      notes:            document.getElementById('ex-notes')?.value?.trim() || null,
      created_by:       S.userId || S.name || 'system'
    };
    if (id) payload.id = id;
    const result = await saveExpense(payload);
    if (!result) { toast('Could not save expense', 'err'); return; }
    cm('m-expense');
    toast(id ? 'Expense updated' : 'Expense added', 'ok');
    _prjId = prjId; nav('projectdetail');
  } catch (err) { toast('Error: ' + err.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
}

async function deleteExpenseConfirm(id, prjId) {
  if (!confirm('Delete this expense record?')) return;
  const ok = await deleteExpenseDB(id);
  if (!ok) { toast('Could not delete expense', 'err'); return; }
  toast('Expense deleted', 'ok');
  _prjId = prjId; nav('projectdetail');
}

// ══ PRICE REVISIONS ═══════════════════════════════════════════════════════

async function _prjLoadRevisions(projectId) {
  const body = document.getElementById('prj-revisions-body');
  if (!body) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  body.innerHTML = `<div class="empty" style="padding:28px"><div class="es" style="color:var(--t3)">Loading…</div></div>`;

  const { data, error } = await supabase.rpc('get_price_revisions', {
    p_company_id: S.cid,
    p_project_id: projectId
  });

  if (error || !data?.success) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load revisions</div><div class="es">${esc(error?.message || 'Error')}</div></div></div>`;
    return;
  }

  const revs = data.revisions || [];

  const tableBody = revs.length === 0
    ? `<div class="empty" style="padding:32px"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></div><div class="et">No price revisions yet</div><div class="es">Click "Add Revision" to record a price change</div></div>`
    : `<div class="tw"><table class="t">
        <thead><tr>
          <th>Date</th>
          <th>Unit Type</th>
          <th class="r">Old Price</th>
          <th class="r">New Price</th>
          <th class="r">Change</th>
          <th class="r">%</th>
          <th>Reason</th>
          <th>Revised By</th>
          <th class="r">Units Updated</th>
        </tr></thead>
        <tbody>
        ${revs.map(r => {
          const up   = Number(r.change_amount) >= 0;
          const arrow = up ? '↑' : '↓';
          const color = up ? 'var(--ok)' : 'var(--err)';
          const pct   = Number(r.change_percent || 0).toFixed(2);
          return `<tr>
            <td style="white-space:nowrap;font-size:12px">${fD(r.effective_date)}</td>
            <td style="font-weight:600">${esc(r.unit_type_name || 'All Types')}</td>
            <td class="r mono">${fM(r.old_price)}</td>
            <td class="r mono" style="font-weight:700">${fM(r.new_price)}</td>
            <td class="r mono" style="color:${color};font-weight:700">${arrow} ${fM(Math.abs(r.change_amount))}</td>
            <td class="r" style="color:${color};font-weight:700;white-space:nowrap">${arrow} ${Math.abs(pct)}%</td>
            <td style="font-size:12px;color:var(--t2);max-width:200px">${esc(r.reason)}</td>
            <td style="font-size:12px;color:var(--t3)">${esc(r.revised_by)}</td>
            <td class="r" style="font-size:12px;color:var(--t3)">${r.units_updated ?? 0}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>`;

  body.innerHTML = `
    <div class="card">
      <div class="ch">
        <div>
          <h3>Price Revisions</h3>
          <p>${revs.length} revision${revs.length !== 1 ? 's' : ''}</p>
        </div>
        ${isA ? `<button class="btn btn-g btn-sm" onclick="openPriceRevisionModal('${projectId}')">+ Add Revision</button>` : ''}
      </div>
      ${tableBody}
    </div>`;

  body.dataset.loaded = projectId;

  // Update tab button label with count
  const tabBtn = document.getElementById('prj-tab-revisions-btn');
  if (tabBtn) tabBtn.textContent = `Price Revisions${revs.length ? ' ('+revs.length+')' : ''}`;
}

function openPriceRevisionModal(projectId) {
  // Gather unit types present in this project
  const pUnits    = (gunits() || []).filter(u => u.projectId === projectId);
  const typeIds   = [...new Set(pUnits.map(u => u.unitTypeId).filter(Boolean))];
  const allTypes  = (window._typesCache || []);
  const projTypes = typeIds.length
    ? allTypes.filter(t => typeIds.includes(t.id))
    : allTypes;

  // Build unit type → current base_price map from unit cache
  const priceMap = {};
  pUnits.forEach(u => {
    if (u.unitTypeId && u.basePrice != null) priceMap[u.unitTypeId] = u.basePrice;
  });

  const typeOpts = projTypes.map(t =>
    `<option value="${t.id}" data-price="${priceMap[t.id] ?? ''}">${esc(t.typeName || t.name)}</option>`
  ).join('');

  const today = td();
  const userName = S.name || '';

  const html = `
<div id="m-price-rev" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)">
  <div style="background:var(--card);border-radius:14px;width:min(480px,96vw);box-shadow:0 24px 64px rgba(0,0,0,.4);overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line)">
      <div style="font-weight:800;font-size:15px">Add Price Revision</div>
      <button onclick="closePriceRevisionModal()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--t3);line-height:1">×</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
      <input type="hidden" id="pr-project-id" value="${projectId}">

      <div>
        <label class="fl">Unit Type <span style="color:var(--err)">*</span></label>
        <select id="pr-unit-type" class="inp-light" onchange="_prjRevUnitTypeChange()" style="width:100%">
          <option value="">— Select unit type —</option>
          ${typeOpts}
        </select>
        <div id="e-pr-unit-type" class="pf-err"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="fl">Current Price (PKR/sqft)</label>
          <input id="pr-old-price" class="inp-light" type="text" disabled placeholder="Auto-filled" style="width:100%;background:var(--canvas);color:var(--t3)">
        </div>
        <div>
          <label class="fl">New Price (PKR/sqft) <span style="color:var(--err)">*</span></label>
          <input id="pr-new-price" class="inp-light" type="number" min="0" step="1" placeholder="Enter new price" oninput="_prjRevPreview()" style="width:100%">
          <div id="e-pr-new-price" class="pf-err"></div>
        </div>
      </div>

      <!-- Change preview -->
      <div id="pr-preview" style="display:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--canvas)"></div>

      <div>
        <label class="fl">Effective Date <span style="color:var(--err)">*</span></label>
        <input id="pr-eff-date" class="inp-light" type="date" value="${today}" style="width:100%">
        <div id="e-pr-eff-date" class="pf-err"></div>
      </div>

      <div>
        <label class="fl">Reason <span style="color:var(--err)">*</span></label>
        <textarea id="pr-reason" class="inp-light" rows="2" placeholder="Why is the price changing?" style="width:100%;resize:vertical"></textarea>
        <div id="e-pr-reason" class="pf-err"></div>
      </div>

      <div>
        <label class="fl">Revised By <span style="color:var(--err)">*</span></label>
        <input id="pr-revised-by" class="inp-light" type="text" value="${esc(userName)}" placeholder="Your name" style="width:100%">
        <div id="e-pr-revised-by" class="pf-err"></div>
      </div>

      <div style="display:flex;gap:10px;padding-top:4px">
        <button class="btn btn-gh" onclick="closePriceRevisionModal()" style="flex:1">Cancel</button>
        <button id="pr-save-btn" class="btn-primary" onclick="savePriceRevision()" style="flex:1;padding:9px;border-radius:8px;font-weight:700;cursor:pointer">Save Revision</button>
      </div>
    </div>
  </div>
</div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closePriceRevisionModal() {
  document.getElementById('m-price-rev')?.remove();
}

function _prjRevUnitTypeChange() {
  const sel  = document.getElementById('pr-unit-type');
  const opt  = sel?.selectedOptions?.[0];
  const price = opt?.dataset?.price ?? '';
  const oldEl = document.getElementById('pr-old-price');
  if (oldEl) oldEl.value = price ? Number(price).toLocaleString() : '';
  _prjRevPreview();
}

function _prjRevPreview() {
  const oldEl  = document.getElementById('pr-old-price');
  const newEl  = document.getElementById('pr-new-price');
  const prevEl = document.getElementById('pr-preview');
  if (!prevEl) return;
  const oldRaw = (oldEl?.value || '').replace(/,/g, '');
  const oldP   = parseFloat(oldRaw) || 0;
  const newP   = parseFloat(newEl?.value) || 0;
  if (!newP) { prevEl.style.display = 'none'; return; }
  const diff   = newP - oldP;
  const pct    = oldP > 0 ? ((diff / oldP) * 100).toFixed(2) : '—';
  const up     = diff >= 0;
  const color  = up ? 'var(--ok)' : 'var(--err)';
  const arrow  = up ? '↑' : '↓';
  prevEl.style.display = '';
  prevEl.style.color   = color;
  prevEl.style.borderColor = up ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)';
  prevEl.style.background  = up ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)';
  prevEl.innerHTML = `Change: PKR ${fM(Math.abs(diff))} ${arrow} (${pct === '—' ? 'n/a' : Math.abs(pct)+'%'}) &nbsp;|&nbsp; New: PKR ${fM(newP)}`;
}

async function savePriceRevision() {
  const projectId  = document.getElementById('pr-project-id')?.value;
  const unitTypeId = document.getElementById('pr-unit-type')?.value;
  const newPriceV  = parseFloat(document.getElementById('pr-new-price')?.value);
  const effDate    = document.getElementById('pr-eff-date')?.value;
  const reason     = document.getElementById('pr-reason')?.value?.trim();
  const revisedBy  = document.getElementById('pr-revised-by')?.value?.trim();

  let ok = true;
  const setE = (id, msg) => {
    const el = document.getElementById(id); if (el) el.textContent = msg;
    if (msg) ok = false;
  };
  setE('e-pr-unit-type', unitTypeId ? '' : 'Select a unit type');
  setE('e-pr-new-price', (!newPriceV || newPriceV <= 0) ? 'Enter a valid price' : '');
  setE('e-pr-eff-date',  effDate    ? '' : 'Required');
  setE('e-pr-reason',    reason     ? '' : 'Required');
  setE('e-pr-revised-by',revisedBy  ? '' : 'Required');
  if (!ok) return;

  const btn = document.getElementById('pr-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const { data, error } = await supabase.rpc('add_price_revision', {
      p_company_id:     S.cid,
      p_project_id:     projectId,
      p_unit_type_id:   unitTypeId,
      p_new_price:      newPriceV,
      p_effective_date: effDate,
      p_reason:         reason,
      p_revised_by:     revisedBy
    });

    if (error) throw error;
    if (!data?.success) throw new Error('Revision save failed');

    const updated = data.units_updated ?? 0;
    closePriceRevisionModal();
    toast(`Price revision saved — ${updated} Available unit${updated !== 1 ? 's' : ''} updated`, 'ok');

    // Reload units cache so new base_price reflects everywhere
    await loadUnitsCache(S.cid);

    // Reload the revisions tab (force reload)
    const body = document.getElementById('prj-revisions-body');
    if (body) { delete body.dataset.loaded; }
    _prjLoadRevisions(projectId);
  } catch (err) {
    toast('Save failed: ' + err.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Save Revision'; }
  }
}

// ── Print Project Detail ───────────────────────────────────────────
function printProjectDetail(prjId) {
  const id  = prjId || _prjId;
  const prj = gproject(id);
  if (!prj) { toast('Project not found', 'warn'); return; }

  const allUnits  = gunits();
  const pUnits    = allUnits.filter(u => u.projectId === id);
  const sold      = pUnits.filter(u => !u.isAvailable && u.status !== 'Dead').length;
  const available = pUnits.filter(u => u.isAvailable).length;
  const portfolio = pUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const collected = pUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
  const outstanding = Math.max(0, portfolio - collected);
  const recovPct  = portfolio > 0 ? Math.min(100, Math.round(collected / portfolio * 100)) : 0;

  const row = (l, v) => (v != null && v !== '' && v !== '—')
    ? `<tr>
         <td style="color:#666;padding:5px 10px;width:38%;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${l}</td>
         <td style="padding:5px 10px;font-size:11px;font-weight:600;color:#111">${v}</td>
       </tr>`
    : '';

  const unitsRows = pUnits.map(u => `<tr>
    <td style="padding:4px 8px;font-size:10px"><strong>${esc(u.unitNo||'—')}</strong></td>
    <td style="padding:4px 8px;font-size:10px">${esc(u.floorLabel||'—')}</td>
    <td style="padding:4px 8px;font-size:10px">${esc(u.type||'—')}</td>
    <td style="padding:4px 8px;font-size:10px">${u.area ? u.area + ' ' + (u.areaUnit||'sqft') : '—'}</td>
    <td style="padding:4px 8px;font-size:10px;text-align:right">${u.basePrice > 0 ? 'PKR ' + fM(u.basePrice) : '—'}</td>
    <td style="padding:4px 8px;font-size:10px">${esc(u.status||'—')}</td>
  </tr>`).join('');

  const w = typeof _pw === 'function' ? _pw('Project — ' + (prj.projectName||prj.name), _pCSS('A4')) : null;
  if (!w) return;

  w.document.write(typeof _lh === 'function' ? _lh('PROJECT DETAIL REPORT') : '');
  w.document.write(`
    <div class="body">
      <div class="doc-title">${esc(prj.projectName||prj.name)}</div>

      <div class="info-grid">
        <div class="ig-item"><div class="ig-lbl">Project Code</div><div class="ig-val">${esc(prj.projectCode||'—')}</div></div>
        <div class="ig-item"><div class="ig-lbl">Status</div><div class="ig-val">${(prj.status||'').toUpperCase()}</div></div>
        <div class="ig-item"><div class="ig-lbl">City</div><div class="ig-val">${esc(prj.city||'—')}</div></div>
        <div class="ig-item"><div class="ig-lbl">Total Units</div><div class="ig-val">${pUnits.length}</div></div>
        <div class="ig-item"><div class="ig-lbl">Sold</div><div class="ig-val">${sold}</div></div>
        <div class="ig-item"><div class="ig-lbl">Available</div><div class="ig-val">${available}</div></div>
      </div>

      <div class="sec-title">Project Information</div>
      <table><tbody>
        ${row('Project Code',         esc(prj.projectCode))}
        ${row('Project Name',         esc(prj.projectName||prj.name))}
        ${row('Status',               (prj.status||'').toUpperCase())}
        ${row('Address / Location',   esc(prj.location))}
        ${row('City',                 esc(prj.city))}
        ${row('Total Area',           prj.totalArea ? Number(prj.totalArea).toLocaleString() + ' ' + (prj.areaUnit||'sqft') : null)}
        ${row('Planned Units',        prj.totalUnits ? String(prj.totalUnits) : null)}
        ${row('Start Date',             prj.startDate ? fD(prj.startDate) : null)}
        ${row('Expected Completion',   prj.expectedCompletion ? fD(prj.expectedCompletion) : null)}
        ${prj.constructionProgress > 0 ? row('Construction Progress', prj.constructionProgress + '% complete') : ''}
        ${prj.builderName ? row('Builder / Developer',  esc(prj.builderName)) : ''}
        ${prj.nocNumber   ? row('NOC Number',            esc(prj.nocNumber))   : ''}
        ${row('Description',           esc(prj.description))}
      </tbody></table>

      <div class="sec-title">Financial Summary</div>
      <table><tbody>
        ${row('Total Portfolio',  'PKR ' + fM(portfolio))}
        ${row('Total Collected',  'PKR ' + fM(collected))}
        ${row('Outstanding',      'PKR ' + fM(outstanding))}
        ${portfolio > 0 ? row('Recovery %', recovPct + '%') : ''}
      </tbody></table>

      <div class="sec-title">Linked Data Summary</div>
      <div class="info-grid">
        <div class="ig-item"><div class="ig-lbl">Total Units</div><div class="ig-val">${pUnits.length}</div></div>
        <div class="ig-item"><div class="ig-lbl">Sold Units</div><div class="ig-val">${sold}</div></div>
        <div class="ig-item"><div class="ig-lbl">Available Units</div><div class="ig-val">${available}</div></div>
      </div>

      ${pUnits.length > 0 ? `
      <div class="sec-title">Units List (${pUnits.length})</div>
      <table>
        <thead><tr><th>Unit No</th><th>Floor</th><th>Type</th><th>Area</th><th style="text-align:right">Base Price</th><th>Status</th></tr></thead>
        <tbody>${unitsRows}</tbody>
      </table>` : ''}

      <div class="footer-bar">
        Printed on ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'})} &nbsp;·&nbsp;
        ${esc(S?.coName||'Nexunova')} — Nexunova Recovery Management System &nbsp;·&nbsp; Page 1 of 1
      </div>
    </div>
  `);
  if (typeof _pclose === 'function') _pclose(w);
}
