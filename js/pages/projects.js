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
  '#DC2626', // Red
  '#059669', // Emerald
  '#D97706', // Amber
  '#7C3AED', // Violet
  '#0891B2', // Cyan
  '#BE185D', // Pink
  '#65A30D', // Lime
  '#EA580C', // Orange
  '#0D9488', // Teal
  '#9333EA', // Purple
  '#4F46E5', // Indigo
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

// Compact PKR formatter — international K/M/B (20260608: was lakh/crore "5 Cr"/"25 L")
function _kM(n) {
  if (!n && n !== 0) return '—';
  if (n === 0) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e5) return Math.round(n / 1e3) + 'K';
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
  kpiEl.innerHTML =
    NX.kpi({ icon:'package',      label:'Total Units',     value:String(allUnits.length), delta:`${allProjs.length} project${allProjs.length!==1?'s':''}` }) +
    NX.kpi({ icon:'check-circle', tone:'success', label:'Units Sold', value:String(soldUnits), delta:`${soldPct}% sold` }) +
    NX.kpi({ icon:'trending-up',  label:'Portfolio Value', value:`PKR ${_kM(totalPortfolio)}` }) +
    NX.kpi({ icon:'wallet',       tone:'success', label:'Collected', value:`PKR ${_kM(totalCollected)}`, delta:`${recovPct}% recovery` });
}

// Status → kit badge tone
const _PRJ_STATUS_TONE = { active:'success', planning:'info', on_hold:'warning', completed:'', cancelled:'danger' };
function _prjBadge(status) {
  const lbl = (_prjSmMap[status] || {}).label || status || 'Unknown';
  return NX.badge(lbl, _PRJ_STATUS_TONE[status] || '', { dot:true });
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
      .prj-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
      @media(max-width:900px){.prj-kpis{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:520px){.prj-kpis{grid-template-columns:1fr}}
      .prj-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
      .prj-search{position:relative;flex:1;min-width:200px;max-width:340px}
      .prj-search .nx-input{padding-left:32px}
      .prj-search-ic{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);display:inline-flex;pointer-events:none}
      .prj-count{margin-left:auto;font-size:12px;color:var(--fk-text-muted)}
      .prj-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
      @media(max-width:1100px){.prj-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:680px){.prj-grid{grid-template-columns:1fr}}
      .prjcard{cursor:pointer;display:flex;flex-direction:column;gap:11px}
      .prjc-hd{display:flex;align-items:flex-start;gap:10px}
      .prjc-id{min-width:0;flex:1}
      .prjc-name{font-size:14px;font-weight:600;color:var(--fk-text);letter-spacing:-.01em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .prjc-code{font-size:10px;font-family:var(--fk-font-mono,ui-monospace,monospace);color:var(--fk-text-muted);margin-top:2px;letter-spacing:.02em}
      .prjc-loc{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--fk-text-muted);min-width:0}
      .prjc-loc span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .prjc-stats{display:grid;grid-template-columns:repeat(3,1fr);background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);overflow:hidden}
      .prjc-stat{display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px}
      .prjc-stat + .prjc-stat{border-left:1px solid var(--fk-border)}
      .prjc-sv{font-size:16px;font-weight:600;color:var(--fk-text);font-variant-numeric:tabular-nums;line-height:1}
      .prjc-sl{font-size:9px;font-weight:600;color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.05em}
      .prjc-prog{display:flex;flex-direction:column;gap:5px}
      .prjc-prog-hd{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted)}
      .prjc-pb{height:5px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:99px;overflow:hidden}
      .prjc-pf{height:100%;border-radius:99px;background:var(--fk-primary)}
      .prjc-fin{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--fk-text-muted)}
      .prjc-fin .num{font-weight:600;color:var(--fk-text);font-variant-numeric:tabular-nums}
      .prjc-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--fk-border);padding-top:10px;margin-top:auto}
      .prjc-foot-l{font-size:11px;color:var(--fk-text-muted);display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .prjc-view{font-size:12px;font-weight:500;color:var(--fk-primary);display:inline-flex;align-items:center;gap:3px;flex-shrink:0}
    `;
  })();

  const statusOpts = [['','Status: All'], ..._PRJ_STATUSES]
    .map(([v,l]) => `<option value="${v}"${_prjStatus===v?' selected':''}>${l}</option>`).join('');
  const sortDefs = [['recent','Sort: Recent'],['name_az','Name (A–Z)'],['name_za','Name (Z–A)'],
    ['val_hi','Highest value'],['val_lo','Lowest value'],['units_hi','Most units'],
    ['prog_hi','Most progress'],['prog_lo','Least progress']];
  const sortOpts = sortDefs.map(([v,l]) => `<option value="${v}"${_prjSort===v?' selected':''}>${l}</option>`).join('');

  const actions =
    NX.button('Export', { variant:'secondary', icon:'file-text', onclick:'prjExport()' }) +
    (isA && !atLimit ? NX.button('New project', { variant:'primary', icon:'plus', onclick:'openProjectModal(null)' })
     : isA && atLimit ? `<span class="nx-badge nx-badge--warning">${total}/${maxP} limit</span>` : '');

  document.getElementById('pg-projects').innerHTML =
    '<div class="ani module-inventory">' +
      NX.pageHeader('Projects', actions, { icon:'building-2', sub:`${total} of ${maxP} · ${planLbl} plan` }) +
      '<div class="prj-kpis" id="prj-kpi"></div>' +
      `<div class="prj-toolbar">
        <div class="prj-search"><span class="prj-search-ic">${NX.icon('search',15)}</span>
          <input class="nx-input" id="prj-s" placeholder="Search projects…" value="${esc(_prjS)}" oninput="setPrjS(this.value)" autocomplete="off"></div>
        <select class="nx-select" id="prj-status-sel" style="max-width:160px" onchange="setPrjStatus(this.value)">${statusOpts}</select>
        <select class="nx-select" id="prj-sort-sel" style="max-width:170px" onchange="setPrjSort(this.value)">${sortOpts}</select>
        <span class="prj-count" id="prj-results-count"></span>
      </div>` +
      '<div id="prj-ct"></div>' +
    '</div>';

  rPRJF();
}

function setPrjS(q)      { _prjS=q;      rPRJF(); }
function setPrjStatus(v) { _prjStatus=v;  rPRJF(); }
function setPrjSort(v)   { _prjSort=v;    rPRJF(); }

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
  if (rcEl) rcEl.textContent = `${prjs.length} of ${allProjs.length}`;

  _renderKPIs(allUnits, allProjs);

  if (!prjs.length) {
    const isA = S.role==='admin'||S.role==='owner';
    if (!allProjs.length) {
      ct.innerHTML = NX.card(NX.empty({ icon:'building-2',
        message:'No projects yet — create your first project to start tracking units, sales and recovery.',
        action: isA ? NX.button('New project', { variant:'primary', icon:'plus', onclick:'openProjectModal(null)' }) : '' }));
    } else if (_prjS) {
      ct.innerHTML = NX.card(NX.empty({ icon:'search', message:`No projects match "${esc(_prjS)}".`,
        action: NX.button('Clear search', { variant:'secondary', onclick:"setPrjS('');document.getElementById('prj-s').value=''" }) }));
    } else {
      ct.innerHTML = NX.card(NX.empty({ icon:'building-2', message:'No projects match this filter.',
        action: NX.button('Reset filter', { variant:'secondary', onclick:"setPrjStatus('');var s=document.getElementById('prj-status-sel');if(s)s.value=''" }) }));
    }
    return;
  }

  ct.innerHTML = `<div class="prj-grid">${prjs.map(p=>_prjGridCard(p,allUnits)).join('')}</div>`;
}

function _prjPV(p, allUnits) {
  return allUnits.filter(u=>u.projectId===p.id).reduce((s,u)=>s+Number(u.totalPrice||0),0);
}

// ── Project card (warm — hover lift, ichip, tinted stat strip) ──────
function _prjGridCard(p, allUnits) {
  const pUnits     = allUnits.filter(u=>u.projectId===p.id);
  const sold       = pUnits.filter(u=>u.status!=='Available'&&u.status!=='Dead').length;
  const available  = pUnits.filter(u=>u.status==='Available').length;
  const portfolio  = pUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const collected  = pUnits.reduce((s,u)=>s+Number(u.totalPaid||0),0);
  const outstanding= Math.max(0, portfolio - collected);
  const recovPct   = portfolio>0?Math.min(100,Math.round(collected/portfolio*100)):0;
  const constrPct  = Math.min(100,Number(p.constructionProgress||0));
  const locLine    = [p.location,p.city].filter(Boolean).join(' · ');
  const name       = esc(p.projectName||p.name||'Untitled');

  const inner =
    `<div class="prjc-hd">${NX.ichip('building-2', '', {})}
      <div class="prjc-id">
        <div class="prjc-name">${name}</div>
        ${p.projectCode?`<div class="prjc-code">${esc(p.projectCode)}</div>`:''}
      </div>
      ${_prjBadge(p.status)}
    </div>` +
    (locLine?`<div class="prjc-loc">${NX.icon('map-pin',13)}<span>${esc(locLine)}</span></div>`:'') +
    `<div class="prjc-stats">
      <div class="prjc-stat"><span class="prjc-sv">${pUnits.length}</span><span class="prjc-sl">Units</span></div>
      <div class="prjc-stat"><span class="prjc-sv">${sold}</span><span class="prjc-sl">Sold</span></div>
      <div class="prjc-stat"><span class="prjc-sv">${available}</span><span class="prjc-sl">Avail</span></div>
    </div>` +
    (constrPct>0?`<div class="prjc-prog">
      <div class="prjc-prog-hd"><span>Construction</span><span>${constrPct}%</span></div>
      <div class="prjc-pb"><div class="prjc-pf" style="width:${constrPct}%"></div></div>
    </div>`:'') +
    (portfolio>0?`<div class="prjc-fin">
      <span>Receivable <span class="num">PKR ${_kM(outstanding)}</span></span>
      <span>${recovPct}% recovered</span>
    </div>`:'') +
    `<div class="prjc-foot">
      <span class="prjc-foot-l">${portfolio>0?`PKR ${_kM(portfolio)} portfolio`:`${pUnits.length} unit${pUnits.length!==1?'s':''}`}</span>
      <span class="prjc-view">View ${NX.icon('chevron-right',13)}</span>
    </div>`;

  return `<div class="nx-card nx-card--hover prjcard" onclick="openProjectDetail('${p.id}')">${inner}</div>`;
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

// One-time detail-page CSS — hero, tinted stat strip, two-column section grid.
function _prjDetailCSS() {
  if (document.getElementById('_pd_css')) return;
  const s = document.createElement('style'); s.id = '_pd_css';
  s.textContent = `
    .pd-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px}
    .pd-actions .pd-back{margin-right:auto}
    .pd-hero{display:flex;align-items:flex-start;gap:14px}
    .pd-hero-id{min-width:0;flex:1}
    .pd-hero-code{font-size:11px;font-family:var(--fk-font-mono,ui-monospace,monospace);color:var(--fk-text-muted);letter-spacing:.04em;margin-bottom:3px}
    .pd-hero .nx-page-title{margin:0 0 7px}
    .pd-hero-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .pd-hero-loc{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--fk-text-muted)}
    .pd-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--fk-border)}
    .pd-progress{display:flex;flex-direction:column;gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--fk-border)}
    .pd-prog-hd{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--fk-text-muted);margin-bottom:5px}
    .pd-pb{height:7px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:99px;overflow:hidden}
    .pd-pf{height:100%;border-radius:99px;background:var(--fk-primary)}
    .pd-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    @media(max-width:900px){.pd-cols{grid-template-columns:1fr}}
    .pd-col{display:flex;flex-direction:column;gap:14px}
  `;
  document.head.appendChild(s);
}

// Segmented tab bar for the detail page (Overview · Ledger · Revisions)
function _prjRenderTabs(active) {
  const el = document.getElementById('pd-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({ tabs: [
    { k:'overview',  label:'Overview',         icon:'layout-dashboard' },
    { k:'ledger',    label:'Collection Ledger', icon:'banknote' },
    { k:'revisions', label:'Price Revisions',   icon:'history' }
  ], active, onSelect:"prjSwitchTab('%k')" });
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

  _prjDetailCSS();

  const locTxt = [prj.city, prj.country].filter(Boolean).join(', ') || prj.location || '';
  const heroStats =
    NX.kpi({ tint:'primary', label:'Total Units', value:String(pUnits.length) }) +
    NX.kpi({ tint:'success', label:'Sold',        value:String(sold) }) +
    NX.kpi({ tint:'info',    label:'Available',   value:String(available) }) +
    (portfolio > 0 ? (
      NX.kpi({ label:'Portfolio', value:`PKR ${_kM(portfolio)}` }) +
      NX.kpi({ tint:'success', label:'Collected', value:`PKR ${_kM(collected)}` }) +
      NX.kpi({ tint: outstanding > 0 ? 'danger' : 'success', label:'Outstanding', value:`PKR ${_kM(outstanding)}` })
    ) : '') +
    (totalExpenses > 0 ? NX.kpi({ tint:'warn', label:'Expenses', value:`-PKR ${_kM(totalExpenses)}` }) : '');

  const progressBars = (portfolio > 0 || prj.constructionProgress > 0) ? `<div class="pd-progress">
    ${portfolio > 0 ? `<div><div class="pd-prog-hd"><span>Recovery</span><span>${recovPct}%</span></div><div class="pd-pb"><div class="pd-pf" style="width:${recovPct}%;background:var(--fk-success)"></div></div></div>` : ''}
    ${prj.constructionProgress > 0 ? `<div><div class="pd-prog-hd"><span>Construction</span><span>${prj.constructionProgress}%</span></div><div class="pd-pb"><div class="pd-pf" style="width:${prj.constructionProgress}%"></div></div></div>` : ''}
  </div>` : '';

  const heroCard = NX.card(
    `<div class="pd-hero">${NX.ichip('building-2', '', { size:'lg' })}
      <div class="pd-hero-id">
        ${prj.projectCode ? `<div class="pd-hero-code">${esc(prj.projectCode)}</div>` : ''}
        <h1 class="nx-page-title" style="font-size:22px">${esc(prj.projectName || prj.name)}</h1>
        <div class="pd-hero-meta">${_prjBadge(prj.status)}${locTxt ? `<span class="pd-hero-loc">${NX.icon('map-pin', 13)} ${esc(locTxt)}</span>` : ''}</div>
      </div>
    </div>
    <div class="pd-stats">${heroStats}</div>${progressBars}`);

  // Section card helper — warm header (chip + title + count + actions)
  const sec = (icon, tone, title, sub, actions, body) =>
    NX.card(body, { header: { icon, tone, title, sub, actions } });
  const addBtn = (fn) => isA ? NX.button('Add', { variant:'secondary', size:'sm', icon:'plus', onclick:fn }) : '';

  const projectInfo = sec('building-2', '', 'Project Info', '', '',
    row('Code',        `<span style="font-family:var(--fk-font-mono,monospace)">${esc(prj.projectCode||'—')}</span>`) +
    row('Name',        esc(prj.projectName||prj.name||'—')) +
    row('Status',      _prjBadge(prj.status)) +
    (prj.location ? row('Address',   esc(prj.location)) : '') +
    (prj.city     ? row('City',      esc(prj.city)) : '') +
    (prj.country  ? row('Country',   esc(prj.country)) : '') +
    (prj.gpsLat && prj.gpsLng ? row('GPS', `${prj.gpsLat}, ${prj.gpsLng}${prj.mapLink ? ` <a href="${esc(prj.mapLink)}" target="_blank" style="font-size:11px;color:var(--fk-info)">Open Map</a>` : ''}`) : prj.mapLink ? row('Map', `<a href="${esc(prj.mapLink)}" target="_blank" style="color:var(--fk-info)">Open Map</a>`) : '') +
    (prj.totalArea > 0 ? row('Total Area', `${Number(prj.totalArea).toLocaleString()} ${prj.areaUnit||'sqft'}`) : '') +
    (prj.totalUnits > 0 ? row('Planned Units', prj.totalUnits) : '') +
    (prj.startDate ? row('Start Date', fD(prj.startDate)) : '') +
    (prj.expectedCompletion ? row('Expected Completion', fD(prj.expectedCompletion)) : '') +
    (prj.description ? row('Description', esc(prj.description)) : '') +
    row('Created', prj.createdAt ? fD(prj.createdAt.slice(0,10)) : '—'));

  const amenitiesCard = (prj.amenities && prj.amenities.length)
    ? sec('check-circle', 'success', 'Amenities', '', '',
        `<div style="display:flex;flex-wrap:wrap;gap:8px">${prj.amenities.map(a => `<span class="nx-badge">${esc(a)}</span>`).join('')}</div>`)
    : '';

  const builderCard = (prj.builderName || prj.builderContact || prj.builderEmail)
    ? sec('briefcase', '', 'Builder / Developer', '', '',
        (prj.builderName    ? row('Builder',  esc(prj.builderName))    : '') +
        (prj.builderContact ? row('Contact',  esc(prj.builderContact)) : '') +
        (prj.builderEmail   ? row('Email',    `<a href="mailto:${esc(prj.builderEmail)}" style="color:var(--fk-info)">${esc(prj.builderEmail)}</a>`) : ''))
    : '';

  const nocCard = (prj.nocNumber || prj.nocAuthority || prj.nocDate)
    ? sec('shield', '', 'NOC / Approvals', '', '',
        (prj.nocNumber    ? row('NOC No.',    esc(prj.nocNumber))    : '') +
        (prj.nocAuthority ? row('Authority',  esc(prj.nocAuthority)) : '') +
        (prj.nocDate      ? row('NOC Date',   fD(prj.nocDate))       : '') +
        (prj.nocNotes     ? row('Notes',      esc(prj.nocNotes))     : ''))
    : '';

  const financialCard = sec('wallet', 'success', 'Financial Summary', '', '',
    row('Total Portfolio', fMF(portfolio)) +
    row('Total Collected', `<span style="color:var(--fk-success);font-weight:600">${fMF(collected)}</span>`) +
    row('Outstanding',     `<span style="color:${outstanding > 0 ? 'var(--fk-danger)' : 'var(--fk-success)'};font-weight:600">${outstanding > 0 ? fMF(outstanding) : 'Fully Collected'}</span>`) +
    (portfolio > 0 ? row('Recovery %', `<strong>${recovPct}%</strong>`) : '') +
    (totalExpenses > 0 ? row('Total Expenses', `<span style="color:var(--fk-danger);font-weight:600">-${fMF(totalExpenses)}</span>`) : '') +
    (totalExpenses > 0 && portfolio > 0 ? row('Net (Portfolio − Expenses)', `<strong>${fMF(portfolio - totalExpenses)}</strong>`) : ''));

  const unitsBody = !pUnits.length
    ? NX.empty({ icon:'package', message:'No units linked yet — open any unit → Edit → assign this project.' })
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
      }).join('') + `</div>`;

  document.getElementById('pg-projectdetail').innerHTML = `<div class="ani">
    <div id="pd-form-nav"></div>

    <div class="pd-actions no-p">
      <span class="pd-back">${NX.button('Back', { variant:'ghost', icon:'arrow-left', onclick:"nav('projects')" })}</span>
      ${NX.button('Print', { variant:'secondary', icon:'printer', onclick:`printProjectDetail('${prjId}')` })}
      ${isA ? NX.button('Edit', { variant:'secondary', icon:'pencil', onclick:`openProjectModal('${prjId}')` }) : ''}
      ${isA ? NX.button('Delete', { variant:'danger-soft', icon:'trash-2', onclick:`deleteProjectConfirm('${prjId}')` }) : ''}
    </div>

    ${coverBanner}
    ${galleryImgs}

    <div style="margin-bottom:16px">${heroCard}</div>

    <div id="pd-tabs" style="margin-bottom:14px"></div>

    <div id="prj-tab-overview">
      <div class="pd-cols">
        <div class="pd-col">
          ${projectInfo}
          ${amenitiesCard}
          ${builderCard}
          ${nocCard}
          ${financialCard}
        </div>
        <div class="pd-col">
          ${sec('package', '', 'Units in Project', `${pUnits.length} unit${pUnits.length !== 1 ? 's' : ''} linked`, '', unitsBody)}
          ${sec('layers', '', 'Milestones / Phases', `${milestones.length} milestone${milestones.length !== 1 ? 's' : ''}`, addBtn(`openMilestoneModal(null,'${prjId}')`), milestonesHtml)}
          ${sec('banknote', '', 'Bank Accounts', `${bankAccounts.length} account${bankAccounts.length !== 1 ? 's' : ''}`, addBtn(`openBankAcctModal(null,'${prjId}')`), bankHtml)}
          ${sec('hand-coins', 'warning', 'Project Expenses', `${expenses.length} record${expenses.length !== 1 ? 's' : ''}${totalExpenses > 0 ? ' · -'+fM(totalExpenses) : ''}`, addBtn(`openExpenseModal(null,'${prjId}')`), expensesHtml)}
        </div>
      </div>
    </div>
    <div id="prj-tab-ledger" data-project-id="${prjId}" style="display:none">
      <div id="prj-ledger-body"></div>
    </div>
    <div id="prj-tab-revisions" data-project-id="${prjId}" style="display:none">
      <div id="prj-revisions-body"></div>
    </div>
  </div>`;

  _prjRenderTabs('overview');

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
    const c = document.getElementById('prj-tab-'+t);
    if (c) c.style.display = t === tab ? '' : 'none';
  });
  _prjRenderTabs(tab);
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

// ── Lean create / edit form — warmth kit, host-injected ──────────────
// The owner's named offender ("purana aur ghatya"): 8 always-open stacked
// emoji panels → essentials visible (name · location · code · status) with
// everything else folded under a "More details" disclosure. Same form serves
// edit (prefilled). saveProjectForm() reads the same pf-* ids, untouched.

const _PRJ_AMENITIES = [
  'Swimming Pool','Gym / Fitness','Parking','Security 24/7','Generator / UPS',
  'CCTV','Elevator / Lift','Mosque','Playground','Community Hall',
  'Garden / Park','Rooftop Terrace','Solar Energy','Commercial Area'
];
const _PRJ_AREA_UNITS = [['sqft','Sq ft'],['sqyd','Sq yd'],['sqm','Sq m'],['marla','Marla'],['kanal','Kanal'],['acre','Acre']];
const _PRJ_STATUSES   = [['planning','Planning'],['active','Active'],['on_hold','On Hold'],['completed','Completed'],['cancelled','Cancelled']];

function _prjModalHost() {
  let h = document.getElementById('prj-modal-host');
  if (!h) { h = document.createElement('div'); h.id = 'prj-modal-host'; document.body.appendChild(h); }
  return h;
}

// One-time form CSS — section sub-labels, upload dropzone, amenity grid.
function _prjFormCSS() {
  if (document.getElementById('_pf_css')) return;
  const s = document.createElement('style'); s.id = '_pf_css';
  s.textContent = `
    .pf-sublabel{display:flex;align-items:center;gap:8px;margin:18px 0 10px}
    .pf-sublabel:first-child{margin-top:4px}
    .pf-sublabel span{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--fk-text-muted)}
    .pf-upload{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;
      background:var(--fk-bg-subtle);border:1.5px dashed var(--fk-border);border-radius:var(--fk-radius-control);
      font-size:13px;font-weight:500;cursor:pointer;color:var(--fk-text-muted);margin-bottom:8px;transition:border-color .15s,color .15s}
    .pf-upload:hover{border-color:var(--fk-primary);color:var(--fk-primary)}
    .pf-amenities{display:flex;flex-wrap:wrap;gap:8px 14px}
    .pf-amenity-chk{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--fk-text);cursor:pointer}
    .pf-amenity-chk input{accent-color:var(--fk-primary)}
  `;
  document.head.appendChild(s);
}

// Compact field builder — returns nx-field markup with a stable id.
function _pfField(label, id, o) {
  o = o || {};
  const tag   = o.el || 'input';
  const val   = o.value != null && o.value !== '' ? esc(String(o.value)) : '';
  const ph    = o.ph ? ` placeholder="${esc(o.ph)}"` : '';
  const attrs = o.attrs ? ` ${o.attrs}` : '';
  const req   = o.req ? ' <span class="nx-req">*</span>' : '';
  const lbl   = `<label class="nx-label" for="${id}">${esc(label)}${req}</label>`;
  let ctrl;
  if (tag === 'textarea') {
    ctrl = `<textarea class="nx-textarea" id="${id}"${ph}${attrs} rows="${o.rows||2}">${val}</textarea>`;
  } else if (tag === 'select') {
    const opts = (o.options || []).map(([v, l]) =>
      `<option value="${esc(v)}"${String(v) === String(o.value) ? ' selected' : ''}>${esc(l)}</option>`).join('');
    ctrl = `<select class="nx-select" id="${id}"${attrs}>${opts}</select>`;
  } else {
    ctrl = `<input class="nx-input" id="${id}" type="${o.type || 'text'}" value="${val}"${ph}${attrs}>`;
  }
  const foot = o.errId ? `<div class="nx-error" id="${o.errId}"></div>`
             : o.hint  ? `<div class="nx-error" style="color:var(--fk-text-muted)">${esc(o.hint)}</div>` : '';
  return `<div class="nx-field"${o.fieldId ? ` id="${o.fieldId}"` : ''}>${lbl}${ctrl}${foot}</div>`;
}

function _prjSubLabel(icon, tone, title) {
  return `<div class="pf-sublabel">${NX.ichip(icon, tone, { size:'sm' })}<span>${esc(title)}</span></div>`;
}

function openProjectModal(prjId) {
  _prjFormCSS();
  const isEdit = !!prjId;
  const p      = isEdit ? (gproject(prjId) || {}) : {};
  const code   = isEdit ? (p.projectCode || genProjectCode()) : genProjectCode();
  const amenitySet = new Set(p.amenities || []);
  const moreHas = isEdit && !!(
    p.description || p.totalArea || p.totalUnits || p.startDate || p.expectedCompletion ||
    p.deliveryDate || p.gpsLat || p.gpsLng || p.mapLink || p.constructionProgress ||
    p.builderName || p.builderContact || p.builderEmail || p.nocNumber || p.nocAuthority ||
    p.nocDate || p.nocNotes || p.coverImageUrl || (p.coverImages && p.coverImages.length) || amenitySet.size
  );

  // ── Essentials (always visible) ──
  const essentials =
    _pfField('Project name', 'pf-name', { value: p.projectName || p.name || '', ph: 'e.g. Nexus Heights Phase 2', req: true, errId: 'e-pf-name', fieldId: 'pf-name-field' }) +
    `<div class="nx-grid-2">` +
      _pfField('Address / location', 'pf-location', { value: p.location || '', ph: 'Street, area or landmark' }) +
      _pfField('City', 'pf-city', { value: p.city || '', ph: 'e.g. Karachi' }) +
    `</div>` +
    `<div class="nx-grid-2">` +
      _pfField('Project code', 'pf-code', { value: code, attrs: 'style="font-family:var(--fk-font-mono,monospace)"', hint: 'Auto-suggested — edit if you use your own scheme.' }) +
      _pfField('Status', 'pf-status', { el: 'select', options: _PRJ_STATUSES, value: p.status || 'active' }) +
    `</div>`;

  // ── More details (disclosure) ──
  const more =
    _prjSubLabel('file-text', '', 'About') +
    _pfField('Description', 'pf-desc', { el: 'textarea', value: p.description || '', ph: 'Brief description of the project…' }) +

    _prjSubLabel('package', '', 'Scale & timeline') +
    `<div class="nx-grid-2">` +
      _pfField('Total area', 'pf-total-area', { type: 'number', value: p.totalArea || '', ph: 'e.g. 50000', attrs: 'min="0" step="0.01"' }) +
      _pfField('Area unit', 'pf-area-unit', { el: 'select', options: _PRJ_AREA_UNITS, value: p.areaUnit || 'sqft' }) +
    `</div>` +
    `<div class="nx-grid-2">` +
      _pfField('Total units (planned)', 'pf-total-units', { type: 'number', value: p.totalUnits || '', ph: 'e.g. 120', attrs: 'min="0"' }) +
      _pfField('Start date', 'pf-start', { type: 'date', value: p.startDate || '' }) +
    `</div>` +
    `<div class="nx-grid-2">` +
      _pfField('Expected completion', 'pf-expected-completion', { type: 'date', value: p.expectedCompletion || '' }) +
      _pfField('Delivery date', 'pf-delivery-date', { type: 'date', value: p.deliveryDate || '', hint: 'Breach limit for possession reporting.' }) +
    `</div>` +

    _prjSubLabel('map-pin', '', 'Map & coordinates') +
    `<div class="nx-grid-2">` +
      _pfField('GPS latitude', 'pf-gps-lat', { type: 'number', value: p.gpsLat || '', ph: 'e.g. 24.8607', attrs: 'step="0.000001"' }) +
      _pfField('GPS longitude', 'pf-gps-lng', { type: 'number', value: p.gpsLng || '', ph: 'e.g. 67.0011', attrs: 'step="0.000001"' }) +
    `</div>` +
    _pfField('Map link (Google Maps URL)', 'pf-map-link', { type: 'url', value: p.mapLink || '', ph: 'https://maps.google.com/…' }) +

    _prjSubLabel('image', '', 'Media & progress') +
    _pfField('Cover image URL', 'pf-cover-url', { type: 'url', value: p.coverImageUrl || '', ph: 'https://…' }) +
    `<div class="nx-field">
       <label class="nx-label" for="pf-construction-progress">Construction progress: <span id="pf-progress-val">${Number(p.constructionProgress || 0)}</span>%</label>
       <input class="nx-input" id="pf-construction-progress" type="range" min="0" max="100" step="1" value="${Number(p.constructionProgress || 0)}"
              oninput="document.getElementById('pf-progress-val').textContent=this.value" style="padding:0;cursor:pointer">
     </div>` +
    `<div class="nx-field">
       <label class="nx-label">Project photos</label>
       <label class="pf-upload">${NX.icon('upload', 15)}<span>Browse / upload photo</span>
         <input type="file" id="pf-cover-file" accept="image/*" style="display:none" onchange="_handleFileUploadAppend(this,'pf-cover-images','rms-documents','projects/photos')">
       </label>
       <textarea class="nx-textarea" id="pf-cover-images" rows="2" placeholder="Uploaded URLs appear here (one per line) — you can also paste URLs">${esc((p.coverImages || []).join('\n'))}</textarea>
     </div>` +

    _prjSubLabel('check-circle', 'success', 'Amenities') +
    `<div class="pf-amenities">` + _PRJ_AMENITIES.map(a =>
      `<label class="pf-amenity-chk"><input type="checkbox" class="pf-amenity" value="${esc(a)}"${amenitySet.has(a) ? ' checked' : ''}> ${esc(a)}</label>`).join('') + `</div>` +

    _prjSubLabel('briefcase', '', 'Builder / developer') +
    `<div class="nx-grid-2">` +
      _pfField('Builder / developer', 'pf-builder-name', { value: p.builderName || '', ph: 'e.g. Marwan Builders' }) +
      _pfField('Contact number', 'pf-builder-contact', { value: p.builderContact || '', ph: 'e.g. 0300-0000000' }) +
    `</div>` +
    _pfField('Builder email', 'pf-builder-email', { type: 'email', value: p.builderEmail || '', ph: 'builder@business.com' }) +

    _prjSubLabel('shield', '', 'NOC / approvals') +
    `<div class="nx-grid-2">` +
      _pfField('NOC number', 'pf-noc-number', { value: p.nocNumber || '', ph: 'e.g. NOC-2024-0001' }) +
      _pfField('Issuing authority', 'pf-noc-authority', { value: p.nocAuthority || '', ph: 'e.g. KDA / LDA / SBCA' }) +
    `</div>` +
    `<div class="nx-grid-2">` +
      _pfField('NOC date', 'pf-noc-date', { type: 'date', value: p.nocDate || '' }) +
      `<div></div>` +
    `</div>` +
    _pfField('NOC notes', 'pf-noc-notes', { el: 'textarea', value: p.nocNotes || '', ph: 'Notes about approvals or compliance…' });

  const body =
    `<input type="hidden" id="pf-prj-id" value="${esc(prjId || '')}">` +
    essentials +
    `<button type="button" class="nx-btn nx-btn--secondary nx-btn--sm" id="pf-more-btn" onclick="prjToggleMore()" style="margin-top:6px">` +
      `<span id="pf-more-ico" style="display:inline-flex">${NX.icon(moreHas ? 'chevron-up' : 'chevron-down', 15)}</span>` +
      `<span id="pf-more-txt">${moreHas ? 'Fewer details' : 'More details'}</span></button>` +
    `<div id="pf-more"${moreHas ? '' : ' style="display:none"'}>${more}</div>`;

  const footer =
    NX.button('Cancel', { variant: 'secondary', onclick: 'closeProjectModal()' }) +
    NX.button(isEdit ? 'Save changes' : 'Create project', { variant: 'primary', attrs: 'id="prj-save-btn"', onclick: 'saveProjectForm()' });

  _prjModalHost().innerHTML = NX.modal({
    id: 'm-project', title: isEdit ? 'Edit project' : 'New project',
    size: 'l', onClose: 'closeProjectModal()', body, footer
  });
}

function prjToggleMore() {
  const more = document.getElementById('pf-more');
  const txt  = document.getElementById('pf-more-txt');
  const ico  = document.getElementById('pf-more-ico');
  if (!more) return;
  const open = more.style.display === 'none';
  more.style.display = open ? '' : 'none';
  if (txt) txt.textContent = open ? 'Fewer details' : 'More details';
  if (ico) ico.innerHTML = NX.icon(open ? 'chevron-up' : 'chevron-down', 15);
}

function closeProjectModal() { const h = document.getElementById('prj-modal-host'); if (h) h.innerHTML = ''; }

// ── Save ───────────────────────────────────────────────────

async function saveProjectForm() {
  const name = document.getElementById('pf-name')?.value?.trim();

  let hasErr = false;
  const setErr = (id, msg, inputId) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    const inp = document.getElementById(inputId || id.slice(2));
    const fld = inp ? inp.closest('.nx-field') : null;
    if (fld) fld.classList.toggle('nx-field--error', !!msg);
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
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

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
    closeProjectModal();
    rProjects();
  } catch (err) {
    console.error('[saveProjectForm]', err);
    toast('Could not save project: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = existingId ? 'Save changes' : 'Create project'; }
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
