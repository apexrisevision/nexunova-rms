// ══ UNITS MODULE ═════════════════════════════════════════════
// Schema: units table (Supabase) — cache via window._unitsCache
// RPCs: create_unit, update_unit, delete_unit, bulk_create_units

// ── State ──────────────────────────────────────────────────
// _uf and _us are declared globally in data.js
let _uPrjFilter    = '';
let _uTypeFilter   = '';
let _uStatusFilter = '';
let _uFloorFilter  = '';
let _uPage         = 1;
const _U_PER_PAGE  = 20;
let _uSelected     = new Set();
let _invView       = localStorage.getItem('rms.inventory.view') || 'list';
let _invSortField  = 'unitNo';
let _invSortDir    = 'asc';
let _invDrawerUid  = null;
let _invDD         = null;  // open dropdown element
let _invDDOutClick = null;  // outside-click handler (window-level)
let _invKbActive     = false;
let _invFocusedRow   = -1;
let _invSearchTimer  = null;

// ── SVG Icons ──────────────────────────────────────────────
const _UI = {
  search:     `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  plus:       `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  upload:     `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  printer:    `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  layers:     `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  check2:     `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  badge:      `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  ban:        `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  bldg:       `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01"/></svg>`,
  tag:        `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  circle:     `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`,
  filter:     `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  sort:       `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  list:       `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  grid:       `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  board:      `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="11" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>`,
  chevD:      `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>`,
  chevR:      `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`,
  chevU:      `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>`,
  more:       `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
  x:          `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  xsm:        `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  edit:       `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:      `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  refresh:    `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  dollar:     `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  phone:      `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  arrowR:     `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  extLink:    `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  phoneOff:   `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" viewBox="0 0 24 24"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67"/><path d="M2 2l20 20"/><path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94"/><path d="M10.7 2H7a2 2 0 0 0-2 2v.5"/></svg>`,
  square:     `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  user:       `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  layout:     `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  activity:   `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  fileText:   `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  info:       `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  pencil:     `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
  backArrow:  `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
};

// ── Helpers ────────────────────────────────────────────────
function uStatusBadge(statusName, colorHex) {
  const c = colorHex || '#64748B';
  const bg = c + '1F';
  const bd = c + '33';
  return `<span class="u-status-pill" style="background:${bg};color:${c};border-color:${bd}">${esc(statusName||'—')}</span>`;
}

function uIsSold(u) {
  return !u.isAvailable && u.status !== 'Dead' && u.status !== 'Blocked';
}

function genUnitCode(companyId) {
  const year = new Date().getFullYear();
  const existing = (window._unitsCache || []).filter(u => u.companyId === companyId).map(u => u.unitCode || '');
  let seq = 1;
  while (existing.includes(`UNT-${year}-${String(seq).padStart(4,'0')}`)) seq++;
  return `UNT-${year}-${String(seq).padStart(4,'0')}`;
}

// ══ UNITS LIST PAGE ════════════════════════════════════════

function rUnits() {
  const cid = S?.cid;
  if (!cid) {
    document.getElementById('pg-units').innerHTML =
      `<div class="inv-empty" style="padding:60px"><div class="inv-empty-ic">${_UI.bldg}</div><h4>No company selected</h4></div>`;
    return;
  }
  const isA = S.role === 'admin' || S.role === 'owner';
  const units = gunits();
  const total     = units.length;
  const available = units.filter(u =>  u.isAvailable).length;
  const sold      = units.filter(u => !u.isAvailable && u.status !== 'Dead' && u.status !== 'Blocked').length;
  const dead      = units.filter(u =>  u.status === 'Dead' || u.status === 'Blocked').length;
  const projects  = gprojects();

  const kpiTiles = [
    { key:'All',       icon:_UI.layers,  color:'var(--primary)',  val:total,     sub:'across '+projects.length+' project'+(projects.length!==1?'s':'') },
    { key:'Available', icon:_UI.check2,  color:'var(--success)',  val:available, sub:'ready for sale' },
    { key:'Sold',      icon:_UI.badge,   color:'#7C3AED',         val:sold,      sub: total>0 ? Math.round(sold/total*100)+'% sell-through' : 'no sales yet' },
    { key:'Dead',      icon:_UI.ban,     color:'var(--danger)',   val:dead,      sub: dead ? dead+' blocked/dead' : 'no blocked units' },
  ];

  document.getElementById('pg-units').innerHTML = `
<div class="inv-page ani">
  <!-- Page Header -->
  <div class="inv-ph">
    <div class="inv-breadcrumb">
      <span class="lnk" onclick="nav('dashboard')">Home</span>
      <span style="opacity:.4">${_UI.chevR}</span>
      <span style="color:var(--text-soft)">Inventory</span>
    </div>
    <div class="inv-ph-row">
      <h1 class="inv-title">All Units</h1>
      <div class="inv-ph-actions">
        <button class="btn btn-gh btn-sm" onclick="printInventoryList()" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px">${_UI.printer} Print</button>
        ${isA ? `<button class="btn btn-gh btn-sm" onclick="openBulkImportModal()" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px">${_UI.upload} Bulk Import</button>` : ''}
        ${isA ? `<button class="btn btn-g btn-sm" onclick="nav('addunit')" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px">${_UI.plus} Add Unit</button>` : ''}
      </div>
    </div>
  </div>

  <!-- KPI Filter Tiles -->
  <div class="inv-kpi-grid">
    ${kpiTiles.map(t => `
    <div class="inv-kpi-tile${_uf===t.key?' active':''}" style="--kpi-color:${t.color}"
         onclick="_invKpiClick('${t.key}')">
      <div class="inv-kpi-tile-top">
        <div class="inv-kpi-icon">${t.icon}</div>
        <span class="inv-kpi-label">${t.key === 'All' ? 'ALL UNITS' : t.key === 'Dead' ? 'BLOCKED/DEAD' : t.key.toUpperCase()}</span>
      </div>
      <div class="inv-kpi-bottom">
        <div class="inv-kpi-value">${t.val}</div>
        <div class="inv-kpi-sub">${t.sub}</div>
      </div>
      <button class="inv-kpi-clear" onclick="event.stopPropagation();_invKpiClick('All')" title="Clear filter">${_UI.xsm}</button>
    </div>`).join('')}
  </div>

  <!-- Filter Toolbar -->
  <div class="inv-toolbar">
    <div class="inv-search-wrap">
      <span class="inv-search-icon">${_UI.search}</span>
      <input class="inv-search-inp" id="u-s" placeholder="Search unit code, project, type..."
             value="${esc(_us)}" oninput="setUS(this.value)" autocomplete="off">
      <span class="inv-search-cmd">⌘K</span>
    </div>
    <button class="inv-fc${_uPrjFilter?' active':''}" id="inv-fc-prj" onclick="_invFCDropdown('prj',this)">
      ${_UI.bldg}
      <span class="inv-fc-label">Project</span>
      ${_uPrjFilter ? `<span class="inv-fc-val">${esc((gprojects().find(p=>p.id===_uPrjFilter)||{}).projectName||'?')}</span>` : `<span class="inv-fc-cv">All</span>`}
      ${_UI.chevD}
    </button>
    <button class="inv-fc${_uTypeFilter?' active':''}" id="inv-fc-type" onclick="_invFCDropdown('type',this)">
      ${_UI.tag}
      <span class="inv-fc-label">Type</span>
      ${_uTypeFilter ? `<span class="inv-fc-val">${esc(((window._typesCache||[]).find(t=>t.id===_uTypeFilter)||{}).name||'?')}</span>` : `<span class="inv-fc-cv">All</span>`}
      ${_UI.chevD}
    </button>
    <button class="inv-fc${_uStatusFilter?' active':''}" id="inv-fc-status" onclick="_invFCDropdown('status',this)">
      ${_UI.circle}
      <span class="inv-fc-label">Status</span>
      ${_uStatusFilter ? `<span class="inv-fc-val">${esc(((window._statusesCache||[]).find(s=>s.id===_uStatusFilter)||{}).name||'?')}</span>` : `<span class="inv-fc-cv">All</span>`}
      ${_UI.chevD}
    </button>
    <button class="inv-fc${_uFloorFilter?' active':''}" id="inv-fc-floor" onclick="_invFCDropdown('floor',this)">
      ${_UI.layers}
      <span class="inv-fc-label">Floor</span>
      ${_uFloorFilter ? `<span class="inv-fc-val">${esc(((window._floorsCache||[]).find(f=>f.id===_uFloorFilter)||{}).name||'?')}</span>` : `<span class="inv-fc-cv">All</span>`}
      ${_UI.chevD}
    </button>
    <button class="inv-sort-btn" onclick="_invSortMenu(this)">
      ${_UI.sort} Sort: ${_invSortField==='basePrice'?'Price':_invSortField==='unitNo'?'Unit No':'Newest'} ${_UI.chevD}
    </button>
    <div class="inv-view-toggle">
      <button class="inv-view-btn${_invView==='list'?' on':''}" onclick="_invToggleView('list')" title="List view">${_UI.list}</button>
      <button class="inv-view-btn${_invView==='grid'?' on':''}" onclick="_invToggleView('grid')" title="Grid view">${_UI.grid}</button>
      <button class="inv-view-btn${_invView==='board'?' on':''}" onclick="_invToggleView('board')" title="Board view">${_UI.board}</button>
    </div>
  </div>

  <!-- Active Filters Bar -->
  <div class="inv-af-bar" id="inv-af-bar"></div>

  <!-- Content -->
  <div id="ul-ct"></div>
  <div class="inv-pager" id="ul-pager"></div>
</div>

<!-- Insights Drawer -->
<div class="inv-drawer-bd" id="inv-drawer-bd" onclick="_invCloseDrawer()"></div>
<div class="inv-drawer-panel" id="inv-drawer-panel">
  <div class="inv-drawer-hd" id="inv-drawer-hd"></div>
  <div class="inv-drawer-body" id="inv-drawer-body"></div>
  <div class="inv-drawer-footer" id="inv-drawer-footer"></div>
</div>

<!-- Bulk Action Bar -->
<div class="inv-bulk-bar" id="_uBulkBar"></div>`;

  _invRenderAFBar();
  _invAttachKb();
  rULF();
}

function _invKpiClick(key) {
  _uf = key; _uPage = 1;
  // Refresh KPI tiles
  document.querySelectorAll('.inv-kpi-tile').forEach((t, i) => {
    const keys = ['All','Available','Sold','Dead'];
    t.classList.toggle('active', keys[i] === key);
  });
  rULF();
  _invRenderAFBar();
}

function setUF(s)            { _uf = s;           _uPage = 1; _invKpiClick(s); }
function setUS(q)            { _us = q; _uPage = 1; clearTimeout(_invSearchTimer); _invSearchTimer = setTimeout(() => { rULF(); _invRenderAFBar(); }, 220); }
function setUPrjFilter(v)    { _uPrjFilter = v;    _uPage = 1; rULF(); _invRenderAFBar(); _invRefreshToolbar(); }
function setUTypeFilter(v)   { _uTypeFilter = v;   _uPage = 1; rULF(); _invRenderAFBar(); _invRefreshToolbar(); }
function setUStatusFilter(v) { _uStatusFilter = v; _uPage = 1; rULF(); _invRenderAFBar(); _invRefreshToolbar(); }
function setUFloorFilter(v)  { _uFloorFilter = v;  _uPage = 1; rULF(); _invRenderAFBar(); _invRefreshToolbar(); }

function rULF() {
  let units = gunits();

  // KPI / Tab filter
  if (_uf === 'Available') units = units.filter(u =>  u.isAvailable);
  else if (_uf === 'Sold') units = units.filter(u => !u.isAvailable && u.status !== 'Dead' && u.status !== 'Blocked');
  else if (_uf === 'Dead') units = units.filter(u =>  u.status === 'Dead' || u.status === 'Blocked');

  // Dropdown filters
  if (_uPrjFilter)    units = units.filter(u => u.projectId  === _uPrjFilter);
  if (_uTypeFilter)   units = units.filter(u => u.unitTypeId === _uTypeFilter);
  if (_uStatusFilter) units = units.filter(u => u.statusId   === _uStatusFilter);
  if (_uFloorFilter)  units = units.filter(u => {
    // Floor IDs aren't stored on units; match on the floor's label/name
    const fl = (window._floorsCache || []).find(f => f.id === _uFloorFilter);
    if (!fl) return false;
    const flName = (fl.name || '').toLowerCase();
    return (u.floorLabel || '').toLowerCase() === flName
        || (u.floor      || '').toLowerCase() === flName;
  });

  // Search
  if (_us) {
    const q = _us.toLowerCase();
    units = units.filter(u =>
      u.unitNo.toLowerCase().includes(q) ||
      (u.unitCode || '').toLowerCase().includes(q) ||
      (u.block    || '').toLowerCase().includes(q) ||
      (u.type     || '').toLowerCase().includes(q)
    );
  }

  // Sort
  units = units.slice().sort((a, b) => {
    let av = a[_invSortField] ?? '', bv = b[_invSortField] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return _invSortDir === 'asc' ? -1 : 1;
    if (av > bv) return _invSortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const ct = document.getElementById('ul-ct');
  const pg = document.getElementById('ul-pager');
  if (!ct) return;

  if (!units.length) {
    ct.innerHTML = `<div class="inv-table-wrap"><div class="inv-empty"><div class="inv-empty-ic">${_UI.bldg}</div><h4>No units found</h4><p>Try adjusting your filters or search query</p></div></div>`;
    if (pg) pg.innerHTML = '';
    _renderBulkBar();
    return;
  }

  // Pagination
  const totalPages = Math.ceil(units.length / _U_PER_PAGE);
  if (_uPage > totalPages) _uPage = totalPages;
  const sliced = units.slice((_uPage - 1) * _U_PER_PAGE, _uPage * _U_PER_PAGE);
  const isA = S.role === 'admin' || S.role === 'owner';
  const anySelected = _uSelected.size > 0;

  if (_invView === 'board') {
    ct.innerHTML = _invBoardHTML(units);
    _renderBulkBar();
    if (pg) pg.innerHTML = '';
    return;
  }

  if (_invView === 'grid') {
    ct.innerHTML = _invGridHTML(sliced, isA);
  } else {
    // List view — data table
    const thSort = (field, label) => {
      const isSorted = _invSortField === field;
      const icon = isSorted ? (_invSortDir === 'asc' ? _UI.chevU : _UI.chevD) : _UI.chevD;
      return `<th class="inv-th sortable${isSorted?' sorted':''}" onclick="_invSort('${field}')">
        <span class="inv-th-inner">${label}<span class="inv-sort-ic">${icon}</span></span>
      </th>`;
    };

    ct.innerHTML = `<div class="inv-table-wrap${anySelected?' inv-chk-visible':''}">
      <table class="inv-table">
        <thead class="inv-thead">
          <tr>
            ${isA ? `<th class="inv-th inv-th-chk"><input type="checkbox" id="uc-all" onchange="toggleUnitSelectAll(this.checked)" style="cursor:pointer;accent-color:var(--primary);width:14px;height:14px"></th>` : ''}
            <th class="inv-th" style="width:120px">Code</th>
            ${thSort('unitNo', 'Unit No')}
            <th class="inv-th inv-th-hide" style="width:170px">Project</th>
            <th class="inv-th inv-td-hide" style="width:120px">Type</th>
            <th class="inv-th inv-td-hide" style="width:90px">Floor</th>
            <th class="inv-th r inv-td-hide" style="width:90px">Area</th>
            ${thSort('basePrice', 'Base Price')}
            <th class="inv-th" style="width:120px">Status</th>
            ${isA ? `<th class="inv-th" style="width:50px"></th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${sliced.map((u, idx) => {
            const prj  = gproject(u.projectId);
            const prjDot = prj?.colorHex ? `<span class="inv-prj-dot" style="background:${prj.colorHex}"></span>` : '';
            const floor = u.floorLabel || (u.floorNo != null ? 'F'+u.floorNo : '—');
            const area  = u.area ? fN(u.area)+' '+(u.areaUnit||'sqft') : '—';
            const price = u.basePrice > 0 ? fM(u.basePrice) : '—';
            return `<tr class="inv-tr${_uSelected.has(u.id)?' sel':''}"
                       id="utr-${u.id}" data-uid="${u.id}" data-idx="${idx}"
                       onclick="_invRowClick('${u.id}',event)">
              ${isA ? `<td class="inv-td inv-td-chk" onclick="event.stopPropagation()">
                <input class="inv-row-chk" type="checkbox" id="uc-${u.id}" ${_uSelected.has(u.id)?'checked':''}
                       onchange="toggleUnitSelect('${u.id}')">
              </td>` : ''}
              <td class="inv-td inv-td-code">${esc(u.unitCode||'—')}</td>
              <td class="inv-td inv-td-no">${esc(u.unitNo)}</td>
              <td class="inv-td inv-td-prj inv-th-hide"><span class="inv-td-prj-inner">${prjDot}${esc(prj?.projectName||prj?.name||'—')}</span></td>
              <td class="inv-td inv-td-hide" style="color:var(--text-soft)">${esc(u.type||'—')}</td>
              <td class="inv-td inv-td-hide" style="color:var(--text-soft)">${esc(floor)}</td>
              <td class="inv-td inv-td-r inv-td-hide">${area}</td>
              <td class="inv-td inv-td-price">${price}</td>
              <td class="inv-td">${uStatusBadge(u.status, u.statusColor)}</td>
              ${isA ? `<td class="inv-td" style="text-align:center" onclick="event.stopPropagation()">
                <button class="inv-row-keb" onclick="_invRowKebab('${u.id}',this)">${_UI.more}</button>
              </td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Sync select-all state
  const allBox = document.getElementById('uc-all');
  if (allBox) {
    const selOnPage = sliced.filter(u => _uSelected.has(u.id)).length;
    allBox.checked = selOnPage === sliced.length && sliced.length > 0;
    allBox.indeterminate = selOnPage > 0 && selOnPage < sliced.length;
  }
  _renderBulkBar();

  // Pager
  if (pg) {
    if (totalPages <= 1) { pg.innerHTML = ''; return; }
    let html = '';
    if (_uPage > 1) html += `<button class="inv-pg-btn" onclick="_uPage--;rULF()">← Prev</button>`;
    const maxPgs = 7;
    for (let i = 1; i <= totalPages; i++) {
      if (totalPages > maxPgs && i > 2 && i < totalPages - 1 && Math.abs(i - _uPage) > 1) {
        if (i === 3 || i === totalPages - 2) html += `<span style="color:var(--text-faint);padding:0 4px">…</span>`;
        continue;
      }
      html += `<button class="inv-pg-btn${i===_uPage?' on':''}" onclick="_uPage=${i};rULF()">${i}</button>`;
    }
    if (_uPage < totalPages) html += `<button class="inv-pg-btn" onclick="_uPage++;rULF()">Next →</button>`;
    pg.innerHTML = html;
  }
}

// ── Bulk selection ─────────────────────────────────────────

function toggleUnitSelect(id) {
  if (_uSelected.has(id)) _uSelected.delete(id); else _uSelected.add(id);
  const cbs = document.querySelectorAll('[id^="uc-"]:not(#uc-all)');
  const checked = [...cbs].filter(cb => cb.checked).length;
  const allBox = document.getElementById('uc-all');
  if (allBox) {
    allBox.checked = checked === cbs.length && cbs.length > 0;
    allBox.indeterminate = checked > 0 && checked < cbs.length;
  }
  _renderBulkBar();
}

function toggleUnitSelectAll(on) {
  document.querySelectorAll('[id^="uc-"]:not(#uc-all)').forEach(cb => {
    cb.checked = on;
    const uid = cb.id.replace('uc-', '');
    if (on) _uSelected.add(uid); else _uSelected.delete(uid);
  });
  _renderBulkBar();
}

function clearUnitSelection() {
  _uSelected.clear();
  document.querySelectorAll('[id^="uc-"]').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
  _renderBulkBar();
}

function _renderBulkBar() {
  const bar = document.getElementById('_uBulkBar');
  if (!bar) return;
  if (_uSelected.size === 0) { bar.classList.remove('show'); return; }
  bar.innerHTML = `
    <span class="inv-bulk-cnt">${_uSelected.size} selected</span>
    <div class="inv-bulk-div"></div>
    <button class="inv-bb" onclick="_invBulkStatusMenu(this)">${_UI.refresh} Change Status</button>
    <button class="inv-bb" onclick="_invBulkExport()">${_UI.filter} Export</button>
    <div class="inv-bulk-div"></div>
    <button class="inv-bb del" onclick="_invBulkDelete()">${_UI.trash} Delete</button>
    <div class="inv-bulk-div"></div>
    <button class="inv-bb clr" onclick="clearUnitSelection()" title="Clear selection">${_UI.x}</button>`;
  bar.classList.add('show');
}

// ── New helper functions ────────────────────────────────────

function _invSort(field) {
  if (_invSortField === field) {
    _invSortDir = _invSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _invSortField = field; _invSortDir = 'asc';
  }
  rULF();
}

function _invToggleView(v) {
  _invView = v;
  localStorage.setItem('rms.inventory.view', v);
  document.querySelectorAll('.inv-view-btn').forEach((btn, i) => {
    const views = ['list','grid','board'];
    btn.classList.toggle('on', views[i] === v);
  });
  rULF();
}

function _invRowClick(uid, e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
  if (_uSelected.size > 0 && e.shiftKey) { toggleUnitSelect(uid); return; }
  _invOpenDrawer(uid);
}

function _invRowKebab(uid, btn) {
  _invCloseDD();
  const u = gunit(uid);
  if (!u) return;
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';
  dd.style.left = 'auto';
  dd.innerHTML = `
    <button class="inv-dd-item" onclick="_invCloseDD();nav('addunit','${uid}')">${_UI.edit} Edit</button>
    <button class="inv-dd-item" onclick="_invCloseDD();_invOpenDrawer('${uid}')">${_UI.extLink} Preview</button>
    <div class="inv-dd-sep"></div>
    <button class="inv-dd-item" onclick="_invCloseDD();_invChangeStatusMenu('${uid}',this)">${_UI.refresh} Change Status</button>
    <div class="inv-dd-sep"></div>
    <button class="inv-dd-item red" onclick="_invCloseDD();deleteUnitConfirm('${uid}')">${_UI.trash} Delete</button>`;
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

function _invCloseDD() {
  if (_invDD) { _invDD.remove(); _invDD = null; }
  const old = document.getElementById('inv-dd-open');
  if (old) old.remove();
  if (_invDDOutClick) {
    document.removeEventListener('mousedown', _invDDOutClick, true);
    _invDDOutClick = null;
  }
}

// Attach a one-shot outside-click listener that closes the open dropdown.
// `anchorBtn` is the button that opened the dropdown — clicks on it should
// NOT immediately re-close (the button's own onclick will handle re-open/toggle).
function _invArmOutsideClose(anchorBtn) {
  // Detach any previous handler (safety)
  if (_invDDOutClick) document.removeEventListener('mousedown', _invDDOutClick, true);
  _invDDOutClick = function (e) {
    if (!_invDD) { _invCloseDD(); return; }
    if (_invDD.contains(e.target)) return;          // click inside dropdown — ignore
    if (anchorBtn && anchorBtn.contains(e.target)) return; // click on opener — ignore
    _invCloseDD();
  };
  // Capture phase so we run before any inner onclick that might re-create the DD
  document.addEventListener('mousedown', _invDDOutClick, true);
}

// Close any open dropdown when the page navigates away.
window.addEventListener('beforeunload', _invCloseDD);
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && _invDD) _invCloseDD();
});

function _invFCDropdown(type, btn) {
  _invCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  let items = '';
  if (type === 'prj') {
    const prjs = gprojects();
    items = `<div class="inv-dd-chk" onclick="_invCloseDD();setUPrjFilter('')"><input type="checkbox" ${!_uPrjFilter?'checked':''} readonly> All Projects</div>` +
      prjs.map(p => `<div class="inv-dd-chk" onclick="_invCloseDD();setUPrjFilter('${p.id}')"><input type="checkbox" ${_uPrjFilter===p.id?'checked':''} readonly> ${esc(p.projectName||p.name)}</div>`).join('');
  } else if (type === 'type') {
    const types = (window._typesCache||[]).filter(t=>t.isActive);
    items = `<div class="inv-dd-chk" onclick="_invCloseDD();setUTypeFilter('')"><input type="checkbox" ${!_uTypeFilter?'checked':''} readonly> All Types</div>` +
      types.map(t => `<div class="inv-dd-chk" onclick="_invCloseDD();setUTypeFilter('${t.id}')"><input type="checkbox" ${_uTypeFilter===t.id?'checked':''} readonly> ${esc(t.name)}</div>`).join('');
  } else if (type === 'status') {
    const sts = (window._statusesCache||[]).filter(s=>s.isActive);
    items = `<div class="inv-dd-chk" onclick="_invCloseDD();setUStatusFilter('')"><input type="checkbox" ${!_uStatusFilter?'checked':''} readonly> All Statuses</div>` +
      sts.map(s => `<div class="inv-dd-chk" onclick="_invCloseDD();setUStatusFilter('${s.id}')"><input type="checkbox" ${_uStatusFilter===s.id?'checked':''} readonly> ${esc(s.name)}</div>`).join('');
  } else if (type === 'floor') {
    const fls = (window._floorsCache||[]).filter(f=>f.isActive);
    items = `<div class="inv-dd-chk" onclick="_invCloseDD();setUFloorFilter('')"><input type="checkbox" ${!_uFloorFilter?'checked':''} readonly> All Floors</div>` +
      fls.map(f => `<div class="inv-dd-chk" onclick="_invCloseDD();setUFloorFilter('${f.id}')"><input type="checkbox" ${_uFloorFilter===f.id?'checked':''} readonly> ${esc(f.name)}</div>`).join('');
  }
  dd.innerHTML = `<div class="inv-dd-hd">${type.toUpperCase()}</div>${items}`;
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

function _invSortMenu(btn) {
  _invCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';
  dd.style.left = 'auto';
  const opts = [['unitNo','Unit No'],['basePrice','Price'],['unitCode','Code']];
  dd.innerHTML = opts.map(([f,l]) =>
    `<button class="inv-dd-item" onclick="_invCloseDD();_invSort('${f}')">${_invSortField===f?'✓ ':''} ${l}</button>`
  ).join('');
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

function _invBulkStatusMenu(btn) {
  _invCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  dd.style.left   = rect.left + 'px';
  const sts = (window._statusesCache||[]).filter(s=>s.isActive);
  dd.innerHTML = `<div class="inv-dd-hd">CHANGE STATUS TO</div>` +
    sts.map(s => `<button class="inv-dd-item" onclick="_invCloseDD();bulkChangeStatus('${s.id}')">${uStatusBadge(s.name,s.colorHex)} ${esc(s.name)}</button>`).join('');
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

function _invBulkExport() {
  const units = [..._uSelected].map(id => gunit(id)).filter(Boolean);
  if (!units.length) return;
  const rows = [['Unit No','Code','Project','Type','Floor','Area','Base Price','Status']];
  units.forEach(u => {
    const prj = gproject(u.projectId);
    rows.push([u.unitNo, u.unitCode||'', prj?.projectName||prj?.name||'', u.type||'',
      u.floorLabel||(u.floorNo!=null?'F'+u.floorNo:''), u.area?u.area+' '+u.areaUnit:'',
      u.basePrice||0, u.status||'']);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'units-export.csv'; a.click();
}

async function _invBulkDelete() {
  if (!_uSelected.size) return;
  if (!confirm(`Delete ${_uSelected.size} unit(s)? This cannot be undone.`)) return;
  for (const uid of [..._uSelected]) await deleteUnitConfirmSilent(uid);
  clearUnitSelection();
  rULF();
}

function _invRenderAFBar() {
  const bar = document.getElementById('inv-af-bar');
  if (!bar) return;
  const tags = [];
  if (_us) tags.push({ label: `Search: ${_us}`, clear: `setUS('')` });
  // KPI tab is a "view" not a status — distinct from the actual status dropdown.
  if (_uf && _uf !== 'All') tags.push({ label: `View: ${_uf === 'Dead' ? 'Blocked/Dead' : _uf}`, clear: `_invKpiClick('All')` });
  if (_uPrjFilter) {
    const prj = gprojects().find(p=>p.id===_uPrjFilter);
    tags.push({ label: `Project: ${prj?.projectName||prj?.name||'?'}`, clear: `setUPrjFilter('')` });
  }
  if (_uTypeFilter) {
    const t = (window._typesCache||[]).find(t=>t.id===_uTypeFilter);
    tags.push({ label: `Type: ${t?.name||'?'}`, clear: `setUTypeFilter('')` });
  }
  if (_uStatusFilter) {
    const s = (window._statusesCache||[]).find(s=>s.id===_uStatusFilter);
    tags.push({ label: `Status: ${s?.name||'?'}`, clear: `setUStatusFilter('')` });
  }
  if (_uFloorFilter) {
    const f = (window._floorsCache||[]).find(f=>f.id===_uFloorFilter);
    tags.push({ label: `Floor: ${f?.name||'?'}`, clear: `setUFloorFilter('')` });
  }
  if (!tags.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<span class="inv-af-lbl">Filtered by:</span>` +
    tags.map(t => `<span class="inv-af-tag" onclick="${t.clear}">${esc(t.label)} ${_UI.xsm}</span>`).join('') +
    `<button class="inv-af-clear-all" onclick="_invClearAllFilters()">Clear all</button>`;
}

function _invClearAllFilters() {
  _us = ''; _uf = 'All'; _uPrjFilter = ''; _uTypeFilter = ''; _uStatusFilter = ''; _uFloorFilter = '';
  const si = document.getElementById('u-s'); if (si) si.value = '';
  document.querySelectorAll('.inv-kpi-tile').forEach((t,i) => t.classList.toggle('active', i===0));
  _uPage = 1; rULF(); _invRenderAFBar(); _invRefreshToolbar();
}

function _invRefreshToolbar() {
  // Minimal refresh of filter chip labels without full rUnits()
  const prjBtn  = document.getElementById('inv-fc-prj');
  const typeBtn = document.getElementById('inv-fc-type');
  const stBtn   = document.getElementById('inv-fc-status');
  const flBtn   = document.getElementById('inv-fc-floor');
  if (prjBtn)  prjBtn.classList.toggle('active', !!_uPrjFilter);
  if (typeBtn) typeBtn.classList.toggle('active', !!_uTypeFilter);
  if (stBtn)   stBtn.classList.toggle('active',  !!_uStatusFilter);
  if (flBtn)   flBtn.classList.toggle('active',  !!_uFloorFilter);
}

// Board view HTML generator
function _invBoardHTML(units) {
  const statuses = (window._statusesCache||[]).filter(s=>s.isActive);
  if (!statuses.length) return `<div class="inv-empty"><h4>No statuses configured</h4></div>`;
  const cols = statuses.map(s => {
    const colUnits = units.filter(u => u.statusId === s.id || u.status === s.name);
    const c = s.colorHex || '#64748B';
    return `<div class="inv-board-col">
      <div class="inv-board-col-hd">
        ${uStatusBadge(s.name, c)}
        <span class="inv-board-col-cnt">${colUnits.length}</span>
      </div>
      <div class="inv-board-body">
        ${colUnits.length ? colUnits.map(u => {
          const prj = gproject(u.projectId);
          return `<div class="inv-board-card" onclick="_invOpenDrawer('${u.id}')">
            <div class="inv-bc-no">${esc(u.unitNo)}</div>
            <div class="inv-bc-prj">${esc(prj?.projectName||prj?.name||'')}</div>
            <div class="inv-bc-meta">${esc(u.type||'')}${u.floorLabel?' · '+esc(u.floorLabel):''}</div>
            ${u.basePrice > 0 ? `<div class="inv-bc-price">${fM(u.basePrice)}</div>` : ''}
          </div>`;
        }).join('') : `<div style="padding:12px;text-align:center;font-size:12px;color:var(--text-faint)">Empty</div>`}
      </div>
    </div>`;
  }).join('');
  return `<div class="inv-board">${cols}</div>`;
}

// Grid view HTML generator
function _invGridHTML(units, isA) {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
    ${units.map(u => {
      const prj = gproject(u.projectId);
      return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;transition:box-shadow .1s"
                   onmouseenter="this.style.boxShadow='var(--shadow)'" onmouseleave="this.style.boxShadow=''"
                   onclick="_invOpenDrawer('${u.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:15px;font-weight:700;color:var(--text)">${esc(u.unitNo)}</div>
          ${uStatusBadge(u.status, u.statusColor)}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${esc(prj?.projectName||prj?.name||'')}</div>
        <div style="font-size:11px;color:var(--text-faint)">${esc(u.type||'')}${u.area?' · '+fN(u.area)+' '+(u.areaUnit||'sqft'):''}</div>
        ${u.basePrice > 0 ? `<div style="font-size:14px;font-weight:600;color:var(--text);margin-top:10px;font-variant-numeric:tabular-nums">${fM(u.basePrice)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

// ── Insights Drawer ────────────────────────────────────────

function _invOpenDrawer(uid) {
  const u = gunit(uid);
  if (!u) return;
  _invDrawerUid = uid;
  const prj = gproject(u.projectId);

  const hd = document.getElementById('inv-drawer-hd');
  const body = document.getElementById('inv-drawer-body');
  const ft = document.getElementById('inv-drawer-footer');
  if (!hd) return;

  hd.innerHTML = `
    <div>
      <div class="inv-drawer-unit-no">${esc(u.unitNo)}</div>
      <div style="margin-top:3px">${uStatusBadge(u.status, u.statusColor)}</div>
    </div>
    <div class="inv-drawer-hd-right">
      <button class="btn btn-gh btn-sm" onclick="_invCloseDrawer();openUD('${uid}')" style="display:inline-flex;align-items:center;gap:5px;font-size:12px">${_UI.extLink} Open full</button>
      <button class="btn btn-gh btn-sm" onclick="_invCloseDrawer()" style="width:28px;padding:0;display:inline-flex;align-items:center;justify-content:center">${_UI.x}</button>
    </div>`;

  const facts = [
    ['Project', prj?.projectName||prj?.name||'—'],
    ['Type', u.type||'—'],
    ['Floor', u.floorLabel||(u.floorNo!=null?'F'+u.floorNo:'—')],
    ['Block', u.block||'—'],
    ['Facing', u.facing||'—'],
    ['Parking', u.parkingCount > 0 ? u.parkingCount+' space(s)' : '—'],
  ];

  body.innerHTML = `
    <div class="inv-dw-hero">
      ${u.basePrice > 0 ? `<div class="inv-dw-price">
        <span class="inv-dw-pkr">PKR</span>
        <span class="inv-dw-amount">${fM(u.basePrice)}</span>
      </div>
      <div class="inv-dw-sub">Base Price · ${u.area ? fN(u.area)+' '+(u.areaUnit||'sqft') : 'Area not set'}</div>` : `<div class="inv-dw-sub" style="color:var(--text-muted)">No base price set</div>`}
    </div>
    <div class="inv-dw-facts">
      ${facts.map(([l,v]) => `<div class="inv-dw-fact"><span class="inv-dw-fact-lbl">${l}</span><span class="inv-dw-fact-val">${esc(v)}</span></div>`).join('')}
    </div>
    <div class="inv-dw-section">
      <div class="inv-dw-sec-hd">Recent Activity</div>
      <div class="inv-dw-act-item">
        <div class="inv-dw-act-ic">${_UI.bldg}</div>
        <div><div class="inv-dw-act-txt">Unit added to inventory</div><div class="inv-dw-act-time">—</div></div>
      </div>
    </div>`;

  ft.innerHTML = `
    <button class="btn btn-gh btn-sm" onclick="_invCloseDrawer();nav('addunit','${uid}')" style="display:inline-flex;align-items:center;gap:5px;font-size:12px">${_UI.edit} Edit</button>
    <button class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px;font-size:12px">${_UI.refresh} Change Status</button>
    <button class="btn btn-g btn-sm" onclick="_invCloseDrawer();openUD('${uid}')" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin-left:auto">Open Full ${_UI.arrowR}</button>`;

  document.getElementById('inv-drawer-bd').classList.add('show');
  document.getElementById('inv-drawer-panel').classList.add('open');
}

function _invCloseDrawer() {
  _invDrawerUid = null;
  const bd = document.getElementById('inv-drawer-bd');
  const pn = document.getElementById('inv-drawer-panel');
  if (bd) bd.classList.remove('show');
  if (pn) pn.classList.remove('open');
}

// ── Keyboard shortcuts ─────────────────────────────────────

function _invAttachKb() {
  if (_invKbActive) return;
  _invKbActive = true;
  document.addEventListener('keydown', _invKbHandler);
}

function _invDetachKb() {
  _invKbActive = false;
  document.removeEventListener('keydown', _invKbHandler);
}

function _invKbHandler(e) {
  const pg = document.getElementById('pg-units');
  if (!pg || !pg.classList.contains('on')) { _invDetachKb(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey)))) {
    e.preventDefault();
    const si = document.getElementById('u-s'); if (si) si.focus();
    return;
  }
  if (e.key === 'Escape') { _invCloseDrawer(); clearUnitSelection(); return; }
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); nav('addunit'); return; }
  if (e.key === 'g') {
    const waiting = _invKbHandler._g;
    if (waiting) {
      clearTimeout(waiting); _invKbHandler._g = null;
      if (e.code === 'KeyG') { /* already handled */ }
    } else {
      _invKbHandler._g = setTimeout(() => { _invKbHandler._g = null; }, 1000);
    }
    return;
  }
  if (e.key === 'l' && _invKbHandler._g) { e.preventDefault(); _invToggleView('list'); }
  if (e.key === 'g' && _invKbHandler._g) { e.preventDefault(); _invToggleView('grid'); }
  if (e.key === 'b' && _invKbHandler._g) { e.preventDefault(); _invToggleView('board'); }
}

async function bulkChangeStatus(statusId) {
  if (!statusId) { alert('Please select a target status first.'); return; }
  if (!_uSelected.size) return;
  const cid = S?.cid;
  if (!cid) return;
  const bar = document.getElementById('_uBulkBar');
  if (bar) bar.style.opacity = '0.5';
  const st = (window._statusesCache || []).find(s => s.id === statusId);
  let failed = 0;
  for (const uid of [..._uSelected]) {
    const { data } = await supabase.rpc('update_unit', { p_id: uid, p_company_id: cid, p_data: { status_id: statusId } });
    if (data?.success && st) {
      const u = (window._unitsCache || []).find(x => x.id === uid);
      if (u) { u.statusId = statusId; u.status = st.name; u.statusColor = st.colorHex; u.isAvailable = st.isAvailable; }
    } else if (!data?.success) { failed++; }
  }
  _uSelected.clear();
  rULF();
  if (failed) alert(`${failed} unit(s) could not be updated.`);
}

// ══ ADD / EDIT UNIT MODAL ══════════════════════════════════

function openUnitModal(unitId) {
  const isEdit = !!unitId;
  document.getElementById('unit-mtl').textContent = isEdit ? 'Edit Unit' : 'Add Unit';
  document.getElementById('uf-uid').value = unitId || '';

  const codeEl = document.getElementById('uf-code');

  // Reset all fields
  ['uf-no','uf-block','uf-area',
   'uf-bedrooms','uf-bathrooms','uf-parking','uf-price','uf-features','uf-notes',
   'uf-maintenance','uf-possession-date','uf-transfer-history',
   'uf-image-urls','uf-doc-urls'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const premEl = document.getElementById('uf-is-premium');
  if (premEl) premEl.checked = false;
  const hsEl = document.getElementById('uf-handover-status');
  if (hsEl) hsEl.value = '';
  document.querySelectorAll('#m-unit .pf-err').forEach(el => el.textContent = '');
  document.querySelectorAll('#m-unit .inp-err').forEach(el => el.classList.remove('inp-err'));

  // Populate project dropdown
  const projSel = document.getElementById('uf-project');
  if (projSel) {
    projSel.innerHTML = `<option value="">— Select Project —</option>` +
      gprojects().map(p => `<option value="${p.id}">${esc(p.projectName||p.name)}</option>`).join('');
  }

  // In edit mode we need the original unit so we can include its current
  // floor/type/status FK values in the dropdown even if those rows have
  // since been marked inactive (otherwise saving would silently change them).
  const editUnit = isEdit ? gunit(unitId) : null;

  // Helper: build option list from active rows, then re-include any
  // current FK that isn't already in the list, labelled (inactive).
  const buildOpts = (rows, currentId, fmt) => {
    let list = rows.filter(r => r.isActive);
    if (currentId && !list.some(r => r.id === currentId)) {
      const orphan = rows.find(r => r.id === currentId);
      if (orphan) list = list.concat([{ ...orphan, _inactive: true }]);
    }
    return list.map(r => fmt(r)).join('');
  };

  // Populate floor dropdown
  const floorSel = document.getElementById('uf-floor');
  if (floorSel) {
    const floors = (window._floorsCache || []);
    // Match floor by label name (no floorId stored on units)
    const matchedFloor = editUnit && editUnit.floorLabel
      ? floors.find(f => f.name.toLowerCase() === editUnit.floorLabel.toLowerCase())
      : null;
    floorSel.innerHTML = `<option value="">— No Floor / Not Set —</option>` +
      buildOpts(floors, matchedFloor?.id, f =>
        `<option value="${f.id}">${esc(f.name)}${f._inactive ? ' (inactive)' : ''}</option>`);
  }

  // Populate type dropdown
  const typeSel = document.getElementById('uf-type');
  if (typeSel) {
    const types = (window._typesCache || []);
    typeSel.innerHTML = `<option value="">— Select Type —</option>` +
      buildOpts(types, editUnit?.unitTypeId, t =>
        `<option value="${t.id}">${esc(t.name)}${t._inactive ? ' (inactive)' : ''}</option>`);
  }

  // Populate status dropdown
  const stSel = document.getElementById('uf-status');
  if (stSel) {
    const statuses = (window._statusesCache || []);
    const activeStatuses = statuses.filter(s => s.isActive);
    const defaultAvail = activeStatuses.find(s => s.isAvailable) || activeStatuses[0];
    let list = activeStatuses;
    if (editUnit?.statusId && !list.some(s => s.id === editUnit.statusId)) {
      const orphan = statuses.find(s => s.id === editUnit.statusId);
      if (orphan) list = list.concat([{ ...orphan, _inactive: true }]);
    }
    stSel.innerHTML = list.map(s =>
      `<option value="${s.id}"${(!editUnit && s.id === defaultAvail?.id) ? ' selected' : ''}>${esc(s.name)}${s._inactive ? ' (inactive)' : ''}</option>`
    ).join('');
  }

  if (isEdit) {
    const u = gunit(unitId);
    if (u) {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      if (codeEl) codeEl.value = u.unitCode || '';
      set('uf-no',    u.unitNo);
      set('uf-block', u.block);
      // Match floor by label name
      if (floorSel && u.floorLabel) {
        const match = (window._floorsCache || []).find(f =>
          f.name.toLowerCase() === (u.floorLabel || '').toLowerCase()
        );
        if (match) floorSel.value = match.id;
      }
      set('uf-area',        u.area      || '');
      set('uf-bedrooms',    u.bedrooms  != null ? u.bedrooms  : '');
      set('uf-bathrooms',   u.bathrooms != null ? u.bathrooms : '');
      set('uf-parking',     u.parkingCount || '');
      set('uf-price',       u.basePrice || '');
      set('uf-notes',       u.notes);

      const featuresVal = typeof u.features === 'object'
        ? (Array.isArray(u.features) ? u.features.join(', ') : Object.values(u.features).join(', '))
        : (u.features || '');
      set('uf-features', featuresVal);

      const areaUnitEl = document.getElementById('uf-area-unit');
      if (areaUnitEl) areaUnitEl.value = u.areaUnit || 'sqft';
      const facingEl = document.getElementById('uf-facing');
      if (facingEl) facingEl.value = u.facing || '';
      if (projSel && u.projectId) projSel.value = u.projectId;
      if (typeSel && u.unitTypeId) typeSel.value = u.unitTypeId;
      if (stSel  && u.statusId)  stSel.value  = u.statusId;

      // New fields
      const premEl2 = document.getElementById('uf-is-premium');
      if (premEl2) premEl2.checked = !!u.isPremium;
      set('uf-maintenance',      u.maintenanceMonthly || '');
      set('uf-possession-date',  u.possessionDate     || '');
      const hsEl2 = document.getElementById('uf-handover-status');
      if (hsEl2) hsEl2.value = u.handoverStatus || '';
      set('uf-transfer-history', u.transferHistory    || '');
      set('uf-image-urls',       Array.isArray(u.imageUrls) ? u.imageUrls.join('\n') : (u.imageUrls || ''));
      set('uf-doc-urls',         Array.isArray(u.documentUrls) ? u.documentUrls.join('\n') : (u.documentUrls || ''));
    }
  } else {
    if (codeEl) codeEl.value = genUnitCode(S.cid);
    const areaUnitEl = document.getElementById('uf-area-unit');
    if (areaUnitEl) areaUnitEl.value = 'sqft';
  }

  om('m-unit');
}

function closeUnitModal() { cm('m-unit'); }

async function saveUnitForm() {
  if (typeof demoGuard === 'function' && demoGuard('Save Unit')) return;
  const unitNo = (document.getElementById('uf-no')?.value || '').trim();
  const projId = document.getElementById('uf-project')?.value || '';

  let hasErr = false;
  const setErr = (id, msg, inputId) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    const inp = document.getElementById(inputId || id.slice(2));
    if (inp) inp.classList.toggle('inp-err', !!msg);
    if (msg) hasErr = true;
  };

  setErr('e-uf-no',      !unitNo ? 'Unit number is required' : '');
  setErr('e-uf-project', !projId ? 'Project is required' : '');

  if (hasErr) return;

  const existingId = (document.getElementById('uf-uid')?.value || '').trim();
  const btn = document.getElementById('unit-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const area        = parseFloat(document.getElementById('uf-area')?.value)     || null;
    const bedrooms    = parseInt(document.getElementById('uf-bedrooms')?.value)   || null;
    const bathrooms   = parseInt(document.getElementById('uf-bathrooms')?.value)  || null;
    const parking     = parseInt(document.getElementById('uf-parking')?.value)    || 0;
    const basePrice   = parseFloat(document.getElementById('uf-price')?.value)    || 0;
    const featuresRaw = (document.getElementById('uf-features')?.value || '').trim();
    const features    = featuresRaw
      ? featuresRaw.split(',').map(f => f.trim()).filter(Boolean)
      : [];

    const floorId  = document.getElementById('uf-floor')?.value || '';
    const floorObj = (window._floorsCache || []).find(f => f.id === floorId);
    const floorLabel = floorObj?.name || null;
    const floorNo    = floorObj?.sortOrder ?? null;

    const imageUrlsRaw  = (document.getElementById('uf-image-urls')?.value || '').trim();
    const docUrlsRaw    = (document.getElementById('uf-doc-urls')?.value   || '').trim();
    const imageUrls     = imageUrlsRaw ? imageUrlsRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const documentUrls  = docUrlsRaw   ? docUrlsRaw.split('\n').map(s => s.trim()).filter(Boolean)   : [];

    const payload = {
      company_id:           S.cid,
      project_id:           projId,
      unit_no:              unitNo,
      unit_type_id:         document.getElementById('uf-type')?.value    || null,
      status_id:            document.getElementById('uf-status')?.value  || null,
      floor_no:             floorNo,
      floor_label:          floorLabel,
      block:                (document.getElementById('uf-block')?.value || '').trim() || null,
      area:                 area,
      area_unit:            document.getElementById('uf-area-unit')?.value || 'sqft',
      bedrooms,
      bathrooms,
      parking_count:        parking,
      facing:               document.getElementById('uf-facing')?.value || null,
      base_price:           basePrice,
      features:             features,
      notes:                (document.getElementById('uf-notes')?.value || '').trim() || null,
      is_premium:           document.getElementById('uf-is-premium')?.checked || false,
      maintenance_monthly:  parseFloat(document.getElementById('uf-maintenance')?.value) || null,
      possession_date:      document.getElementById('uf-possession-date')?.value || null,
      handover_status:      document.getElementById('uf-handover-status')?.value || null,
      transfer_history:     (document.getElementById('uf-transfer-history')?.value || '').trim() || null,
      image_urls:           imageUrls.length   ? imageUrls   : null,
      document_urls:        documentUrls.length ? documentUrls : null,
    };

    let result;
    if (existingId) {
      const { data, error } = await supabase.rpc('update_unit', {
        p_id:         existingId,
        p_company_id: S.cid,
        p_data:       payload
      });
      if (error) throw error;
      result = data;
    } else {
      payload.created_by = S.userId || null;
      const { data, error } = await supabase.rpc('create_unit', { p_data: payload });
      if (error) throw error;
      result = data;
    }

    if (!result?.success) {
      toast(result?.error || 'Save failed', 'err');
      return;
    }

    await loadUnitsCache(S.cid);
    logA('unit', (existingId ? 'Updated' : 'Added') + ' unit: ' + unitNo);
    toast(existingId ? 'Unit updated' : 'Unit added', 'ok');
    cm('m-unit');
    rUnits();
  } catch (err) {
    console.error('[saveUnitForm]', err);
    toast('Could not save unit: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Unit'; }
  }
}

// ══ DELETE ═════════════════════════════════════════════════

async function deleteUnitConfirm(unitId) {
  const u = gunit(unitId);
  if (!u) return;

  // Use the unified cascade-safe helper. It runs all dependency checks
  // in parallel, shows a rich blocker modal listing every dependency type,
  // and only proceeds with the RPC delete when the unit is truly safe to remove.
  if (typeof cascadeDelete === 'function') {
    await cascadeDelete({
      entity:      'unit',
      displayName: u.unitNo,
      id:          unitId,
      checks: [
        { table: 'sales',              fk: 'unit_id', label: 'sale record',         extra: { is_active: true } },
        { table: 'payments',           fk: 'unit_id', label: 'payment record' },
        { table: 'unit_cancellations', fk: 'unit_id', label: 'cancellation record' },
        { table: 'contact_logs',       fk: 'unit_id', label: 'call/contact log' }
      ],
      onDelete: async () => {
        const { data, error } = await supabase.rpc('delete_unit', { p_id: unitId, p_company_id: S.cid });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Delete failed');
      },
      onSuccess: async () => {
        await loadUnitsCache(S.cid);
        logA('unit', 'Deleted unit: ' + u.unitNo);
        nav('units');
      }
    });
    return;
  }

  // Legacy fallback (kept for safety if cascade-delete.js fails to load)
  try {
    const { count } = await supabase.from('sales').select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId).eq('company_id', S.cid);
    if (count > 0) {
      toast(`Cannot delete — unit "${u.unitNo}" has ${count} sale record${count > 1 ? 's' : ''} linked.`, 'err');
      return;
    }
  } catch (e) {}
  if (!confirm(`Delete unit "${u.unitNo}"? This cannot be undone.`)) return;
  try {
    const { data, error } = await supabase.rpc('delete_unit', { p_id: unitId, p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) { toast(data?.error || 'Delete failed', 'err'); return; }
    await loadUnitsCache(S.cid);
    toast('Unit deleted', 'ok'); nav('units');
  } catch (err) { toast('Could not delete unit: ' + err.message, 'err'); }
}

// ══ BULK IMPORT MODAL ══════════════════════════════════════

let _bulkRows = [];

function openBulkImportModal() {
  _bulkRows = [];
  const projSel = document.getElementById('bi-project');
  if (projSel) {
    projSel.innerHTML = `<option value="">— Select Project —</option>` +
      gprojects().map(p => `<option value="${p.id}">${esc(p.projectName||p.name)}</option>`).join('');
  }
  const typeSel = document.getElementById('bi-default-type');
  if (typeSel) {
    const types = (window._typesCache || []).filter(t => t.isActive);
    typeSel.innerHTML = `<option value="">— Default Type (optional) —</option>` +
      types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  }
  const ta = document.getElementById('bi-csv');
  if (ta) ta.value = '';
  const prev = document.getElementById('bi-preview');
  if (prev) prev.innerHTML = '';
  const statusEl = document.getElementById('bi-status');
  if (statusEl) statusEl.textContent = '';
  om('m-bulk-import');
}

function closeBulkImportModal() { cm('m-bulk-import'); }

function parseBulkCSV() {
  const raw = (document.getElementById('bi-csv')?.value || '').trim();
  const prev = document.getElementById('bi-preview');
  const statusEl = document.getElementById('bi-status');
  if (!raw) { if (prev) prev.innerHTML = ''; _bulkRows = []; return; }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  const dataLines = lines.slice(1).filter(l => l && !l.startsWith('//'));

  const get = (row, ...names) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx !== -1 && row[idx] !== undefined) return (row[idx]||'').trim();
    }
    return '';
  };

  const defaultTypeId = document.getElementById('bi-default-type')?.value || '';
  const types = window._typesCache || [];

  _bulkRows = dataLines.map((line, i) => {
    const cols = line.split(',').map(c => c.trim());
    const typeName = get(cols, 'type', 'unit_type', 'type_name');
    const typeObj  = typeName
      ? types.find(t => t.name.toLowerCase() === typeName.toLowerCase())
      : null;

    return {
      unit_no:     get(cols, 'unit_no', 'unit_number', 'no'),
      unit_type_id: typeObj?.id || defaultTypeId || '',
      floor_no:    get(cols, 'floor_no', 'floor', 'fl'),
      floor_label: get(cols, 'floor_label', 'floor_name'),
      block:       get(cols, 'block'),
      area:        get(cols, 'area', 'sqft', 'size'),
      area_unit:   get(cols, 'area_unit') || 'sqft',
      bedrooms:    get(cols, 'bedrooms', 'beds', 'br'),
      bathrooms:   get(cols, 'bathrooms', 'baths', 'ba'),
      base_price:  get(cols, 'base_price', 'price'),
      notes:       get(cols, 'notes', 'remarks'),
      _row:        i + 2
    };
  }).filter(r => r.unit_no);

  if (!prev) return;
  if (!_bulkRows.length) {
    prev.innerHTML = `<p style="color:var(--err);font-size:12px">No valid rows found. Ensure "unit_no" column exists.</p>`;
    return;
  }

  prev.innerHTML = `
    <p style="font-size:12px;color:var(--t2);margin-bottom:8px">${_bulkRows.length} rows ready to import</p>
    <div class="tw" style="max-height:200px;overflow-y:auto">
      <table class="t" style="width:100%;font-size:11px">
        <thead><tr><th>#</th><th>Unit No</th><th>Type</th><th>Floor</th><th>Area</th><th>Price</th></tr></thead>
        <tbody>
          ${_bulkRows.map((r,i) => `<tr>
            <td style="color:var(--t3)">${i+1}</td>
            <td style="font-weight:700">${esc(r.unit_no)}</td>
            <td style="color:var(--t3)">${esc((types.find(t=>t.id===r.unit_type_id)?.name)||r.unit_type_id||'—')}</td>
            <td style="color:var(--t3)">${esc(r.floor_label||r.floor_no||'—')}</td>
            <td style="color:var(--t3)">${r.area ? r.area+' '+(r.area_unit||'sqft') : '—'}</td>
            <td style="color:var(--t3)">${r.base_price ? fM(Number(r.base_price)) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  if (statusEl) statusEl.textContent = '';
}

async function executeBulkImport() {
  const projId = document.getElementById('bi-project')?.value || '';
  const statusEl = document.getElementById('bi-status');

  if (!projId) { toast('Select a project first', 'warn'); return; }
  if (!_bulkRows.length) { toast('Parse the CSV first', 'warn'); return; }

  const defaultStatusId = (window._statusesCache || []).find(s => s.isAvailable)?.id || null;
  const rows = _bulkRows.map(r => ({
    ...r,
    status_id:   r.status_id || defaultStatusId || '',
    created_by:  S.userId || null
  }));

  const btn = document.getElementById('bi-import-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
  if (statusEl) statusEl.textContent = 'Importing…';

  try {
    const { data, error } = await supabase.rpc('bulk_create_units', {
      p_company_id: S.cid,
      p_project_id: projId,
      p_units:      rows
    });
    if (error) throw error;

    const res = data;
    if (res.inserted > 0) {
      await loadUnitsCache(S.cid);
      logA('unit', `Bulk imported ${res.inserted} units into project ${projId}`);
    }

    const msg = `${res.inserted} imported${res.errors > 0 ? ` · ${res.errors} failed` : ''}`;
    if (statusEl) statusEl.innerHTML = `<span style="color:${res.errors>0?'var(--warn)':'var(--ok)'}">${msg}</span>`;
    toast(msg, res.errors > 0 ? 'warn' : 'ok');

    if (res.errors === 0) {
      setTimeout(() => { cm('m-bulk-import'); rUnits(); }, 1200);
    } else if (res.error_details?.length) {
      const errDiv = document.getElementById('bi-preview');
      if (errDiv) errDiv.innerHTML += `<div style="margin-top:8px;font-size:11px;color:var(--err)">${res.error_details.map(e=>esc(e)).join('<br>')}</div>`;
    }
  } catch (err) {
    console.error('[executeBulkImport]', err);
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--err)">Error: ${esc(err.message)}</span>`;
    toast('Import failed: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Import All'; }
  }
}

// ══ UNIT DETAIL — Premium Redesign ═════════════════════════
//
// New structure:
//   • Single back link + breadcrumb row (no double back)
//   • Sticky header card (code, unit no, status pill, meta, action buttons)
//   • 4-tile KPI summary strip (Base Price, Area, Status, Ownership)
//   • 5 pill tabs: Overview | Payments | Contacts | Documents | Activity
//   • Overview: 2-col grid (Unit Details + Pricing / Contacts / Ownership)
//   • Lucide icons throughout, no emojis
//   • Delete lives inside More menu, never standalone
// ──────────────────────────────────────────────────────────

let _udTab        = localStorage.getItem('rms.ud.tab') || 'overview';
let _udHistLoaded = null;   // unitId for which activity is loaded
let _udPayLoaded  = null;
let _udTxLoaded   = null;
let _udKbActive   = false;

function rUD(unitId) {
  if (!unitId) { nav('units'); return; }
  const u = gunit(unitId);
  if (!u) { nav('units'); return; }

  const cons      = gcons(unitId).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  const totalPaid = actualPaid(u);
  const rem       = actualPending(u);
  const p2        = pct(totalPaid, u.totalPrice);
  const isSold    = uIsSold(u);
  const isA       = S.role === 'admin' || S.role === 'owner';
  const prj       = gproject(u.projectId);
  const conCount  = cons.length;

  // Reset async-load flags whenever the unit changes
  if (_udHistLoaded !== unitId) _udHistLoaded = null;
  if (_udPayLoaded  !== unitId) _udPayLoaded  = null;
  if (_udTxLoaded   !== unitId) _udTxLoaded   = null;

  const drow = (l, v, opts) => {
    if (v == null || v === '') return '';
    const cls = opts?.cls || '';
    return `<div class="ud-row"><span class="ud-row-l">${l}</span><span class="ud-row-r ${cls}">${v}</span></div>`;
  };

  // Meta line — no Lucide icons, just · separators
  const metaBits = [];
  if (prj)             metaBits.push(esc(prj.projectName || prj.name));
  if (u.type)          metaBits.push(esc(u.type));
  if (u.floorLabel)    metaBits.push(esc(u.floorLabel));
  else if (u.floorNo != null) metaBits.push('Floor ' + u.floorNo);
  if (u.area)          metaBits.push(`${fN(u.area)} ${esc(u.areaUnit||'sqft')}`);
  if (u.block)         metaBits.push('Block ' + esc(u.block));
  const metaLine = metaBits.join('<span class="ud-hdr-meta-sep">·</span>');

  // KPI strip data
  const perSqft = (u.basePrice > 0 && u.area > 0) ? Math.round(u.basePrice / u.area) : 0;
  const ownerInfo = isSold && u.customerName
    ? { val:'Sold', sub: esc(u.customerName) }
    : { val:'Original', sub:'1 owner · no transfers' };
  const statusSub = u.created_at
    ? 'Listed ' + _udRelDate(u.created_at)
    : '—';

  const kpis = [
    {
      key:'price', color:'var(--primary)', icon:_UI.dollar, label:'BASE PRICE',
      valHtml: u.basePrice > 0
        ? `<div class="ud-kpi-price-wrap"><span class="ud-kpi-pkr">PKR</span><span class="ud-kpi-num">${fM(u.basePrice)}</span></div>`
        : `<div class="inv-kpi-value sm" style="color:var(--text-muted)">Not set</div>`,
      sub: perSqft > 0 ? `Per sqft: PKR ${fN(perSqft)}` : (u.basePrice > 0 ? 'Base price set' : 'Add a price to list')
    },
    {
      key:'area', color:'var(--info)', icon:_UI.square, label:'AREA',
      valHtml: u.area > 0
        ? `<div class="ud-kpi-price-wrap"><span class="ud-kpi-num">${fN(u.area)}</span><span class="ud-kpi-unit">${esc(u.areaUnit||'sqft')}</span></div>`
        : `<div class="inv-kpi-value sm" style="color:var(--text-muted)">—</div>`,
      sub: [
        u.parkingCount > 0 ? `${u.parkingCount} parking` : null,
        u.facing ? `${esc(u.facing)} facing` : null
      ].filter(Boolean).join(' · ') || 'No extras recorded'
    },
    {
      key:'status', color: u.statusColor || 'var(--success)', icon:_UI.check2, label:'STATUS',
      valHtml: `<div class="inv-kpi-value sm">${esc(u.status || '—')}</div>`,
      sub: statusSub
    },
    {
      key:'owner', color:'#7C3AED', icon:_UI.user, label:'OWNERSHIP',
      valHtml: `<div class="inv-kpi-value sm">${esc(ownerInfo.val)}</div>`,
      sub: ownerInfo.sub
    }
  ];

  const tabDef = [
    { key:'overview',  label:'Overview',  icon:_UI.layout,   badge:'' },
    { key:'payments',  label:'Payments',  icon:_UI.dollar,   badge:'' },  // updated async
    { key:'contacts',  label:'Contacts',  icon:_UI.phone,    badge: conCount ? String(conCount) : '' },
    { key:'documents', label:'Documents', icon:_UI.fileText, badge:'' },
    { key:'ownership', label:'Ownership', icon:_UI.layers,   badge:'' },
    { key:'activity',  label:'Activity',  icon:_UI.activity, badge:'' }
  ];

  document.getElementById('pg-unitdetail').innerHTML = `<div class="ud-page ani">

  <!-- Breadcrumb + Back row -->
  <div class="ud-breadcrumb">
    <div style="display:flex;align-items:center;gap:14px">
      <button class="ud-back" onclick="nav('units')">${_UI.backArrow} Back</button>
      <div class="ud-breadcrumb-trail">
        <span class="lnk" onclick="nav('dashboard')">Home</span>
        <span style="opacity:.4">${_UI.chevR}</span>
        <span class="lnk" onclick="nav('units')">Inventory</span>
        <span style="opacity:.4">${_UI.chevR}</span>
        <span style="color:var(--text-soft)">${esc(u.unitNo)}</span>
      </div>
    </div>
  </div>

  <!-- Form Navigation Bar (mount target) -->
  <div id="ud-form-nav"></div>

  <!-- Sticky Header Card -->
  <div class="ud-header-card ud-sticky-hd">
    <div class="ud-hdr-left">
      ${u.unitCode ? `<div class="ud-hdr-code">${esc(u.unitCode)}</div>` : ''}
      <div class="ud-hdr-no-row">
        <h1 class="ud-hdr-no">${esc(u.unitNo)}</h1>
        ${uStatusBadge(u.status, u.statusColor)}
      </div>
      <div class="ud-hdr-meta">${metaLine || '<span style="color:var(--text-faint)">No details yet</span>'}</div>
    </div>
    <div class="ud-hdr-right">
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="nav('addunit','${unitId}')" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:12px">${_UI.pencil} Edit</button>` : ''}
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="_udChangeStatusMenu('${unitId}',this)" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:12px">${_UI.refresh} Change Status ${_UI.chevD}</button>` : ''}
      ${isSold && isA ? `<button class="btn btn-gh btn-sm ud-act-transfer" onclick="nav('unittransfer','${unitId}')" title="Transfer ownership to a new buyer" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:12px">${_UI.refresh} Transfer</button>` : ''}
      ${isSold && isA ? `<button class="btn btn-gh btn-sm ud-act-cancel" onclick="nav('unitcancel','${unitId}')" title="Cancel this sale and return unit to inventory" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:12px">${_UI.x} Cancel Sale</button>` : ''}
      <button class="btn btn-gh btn-sm" onclick="printUD('${unitId}')" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:12px">${_UI.printer} Print</button>
      ${isA ? `<button class="btn btn-gh btn-sm ud-more-btn" onclick="_udMoreMenu('${unitId}',this)" title="More actions" style="width:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;height:32px">${_UI.more}</button>` : ''}
    </div>
  </div>

  <!-- KPI Summary Strip -->
  <div class="ud-kpi-grid">
    ${kpis.map(k => `
    <div class="inv-kpi-tile ud-kpi-tile" style="--kpi-color:${k.color || 'var(--primary)'};cursor:default">
      <div class="inv-kpi-tile-top">
        <div class="inv-kpi-icon">${k.icon}</div>
        <span class="inv-kpi-label">${k.label}</span>
      </div>
      <div class="inv-kpi-bottom">
        ${k.valHtml}
        <div class="inv-kpi-sub">${k.sub}</div>
      </div>
    </div>`).join('')}
  </div>

  <!-- Tab Bar -->
  <div class="ud-tabs">
    ${tabDef.map(t => `
      <button id="ud-tab-${t.key}" class="ud-tab${_udTab===t.key?' on':''}" onclick="udSwitchTab('${t.key}')">
        ${t.icon} <span>${t.label}</span>
        <span class="ud-tab-badge" id="ud-tb-${t.key}" ${t.badge?'':'style="display:none"'}>${t.badge}</span>
      </button>`).join('')}
  </div>

  <!-- ─── OVERVIEW TAB ─── -->
  <div class="ud-tab-pane${_udTab==='overview'?' on':''}" id="ud-pane-overview">
    <div class="ud-overview-grid">

      <!-- LEFT: Unit Details -->
      <div>
        <div class="ud-card">
          <div class="ud-card-hd">
            <div class="ud-card-title"><span class="ud-card-title-ic">${_UI.info}</span>Unit Details</div>
            ${isA ? `<div class="ud-card-hd-right">
              <button class="btn btn-gh btn-sm" onclick="nav('addunit','${unitId}')" title="Edit unit"
                style="width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center">${_UI.pencil}</button>
            </div>` : ''}
          </div>
          <div class="ud-rows">
            ${drow('Unit No',   esc(u.unitNo))}
            ${drow('Unit Code', u.unitCode ? esc(u.unitCode) : '—', { cls:'mono' })}
            ${drow('Project',   esc(prj?.projectName||prj?.name||'—'))}
            ${drow('Type',      esc(u.type||'—'))}
            ${drow('Status',    uStatusBadge(u.status, u.statusColor))}
            ${drow('Floor',     u.floorLabel ? esc(u.floorLabel) : (u.floorNo!=null ? 'Floor '+u.floorNo : '—'))}
            ${drow('Block',     u.block ? esc(u.block) : '—')}
            ${drow('Area',      u.area > 0 ? `${fN(u.area)} ${esc(u.areaUnit||'sqft')}` : '—')}
            ${u.bedrooms != null ? drow('Bedrooms',  u.bedrooms) : ''}
            ${u.bathrooms != null ? drow('Bathrooms', u.bathrooms) : ''}
            ${drow('Parking',   u.parkingCount > 0 ? `${u.parkingCount} space(s)` : '—')}
            ${drow('Facing',    u.facing ? esc(u.facing) : '—')}
            ${drow('Base Price',u.basePrice > 0 ? `<span class="ud-row-r-pkr">PKR </span>${fM(u.basePrice)}` : '—', { cls:'price' })}
          </div>
          ${u.notes ? `<div class="ud-notes">
            <div class="ud-notes-lbl">Notes</div>
            <div class="ud-notes-body">${esc(u.notes)}</div>
          </div>` : ''}
        </div>
      </div>

      <!-- RIGHT: Pricing / Contact / Ownership -->
      <div>
        <!-- Pricing -->
        <div class="ud-card">
          <div class="ud-card-hd">
            <div class="ud-card-title"><span class="ud-card-title-ic">${_UI.dollar}</span>Pricing</div>
          </div>
          <div class="ud-rows">
            ${drow('Base Price',   u.basePrice > 0 ? `${fM(u.basePrice)}` : '—', { cls:'price' })}
            ${isSold && u.totalPrice > 0 ? drow('Total Quoted', fM(u.totalPrice), { cls:'price' }) : ''}
            ${isSold && totalPaid > 0   ? drow('Collected',     `<span style="color:var(--success)">${fM(totalPaid)}</span>`, { cls:'price' }) : ''}
            ${isSold && rem > 0         ? drow('Outstanding',   `<span style="color:var(--danger)">${fM(rem)}</span>`, { cls:'price' }) : ''}
            ${drow('Per sqft', perSqft > 0 ? `PKR ${fN(perSqft)}` : '—')}
          </div>
        </div>

        <!-- Contact History -->
        <div class="ud-card">
          <div class="ud-card-hd">
            <div class="ud-card-title">Contact History
              <span class="ud-card-meta">${conCount} logged</span>
            </div>
            ${isSold && isA ? `<button class="btn btn-gh btn-sm" onclick="openConModal('${unitId}')"
              style="display:inline-flex;align-items:center;gap:4px;height:26px;font-size:12px">${_UI.plus} Log</button>` : ''}
          </div>
          ${conCount ? `<div class="ud-rows">
            ${cons.slice(0,3).map(c => `
              <div class="ud-con-row">
                <div class="ud-con-ic">${_UI.phone}</div>
                <div class="ud-con-body">
                  <div class="ud-con-label">${esc(c.channel||'Contact')} · ${esc(c.response_received||'—')}</div>
                  ${c.remarks ? `<div class="ud-con-notes">${esc(c.remarks)}</div>` : ''}
                  <div class="ud-con-date">${fD(c.contact_date)}</div>
                </div>
              </div>`).join('')}
            ${conCount > 3 ? `<div style="padding:10px 18px;text-align:center;border-top:1px solid var(--border)">
              <button class="btn btn-gh btn-sm" onclick="udSwitchTab('contacts')"
                style="font-size:12px;padding:4px 10px">View all ${conCount} ${_UI.arrowR}</button>
            </div>` : ''}
          </div>` : `<div class="ud-empty">
            <div class="ud-empty-ic">${_UI.phoneOff}</div>
            <div class="ud-empty-title">No contacts logged yet</div>
            <div class="ud-empty-sub">Log a call, meeting, or email to track engagement with this unit.</div>
            ${isSold && isA ? `<button class="btn btn-gh btn-sm" onclick="openConModal('${unitId}')"
              style="margin-top:8px;display:inline-flex;align-items:center;gap:5px;background:var(--bg-primary-soft);color:var(--primary);border-color:transparent;font-size:12px">${_UI.plus} Log Contact</button>` : ''}
          </div>`}
        </div>

        <!-- Ownership History -->
        <div class="ud-card" id="ud-ownership-card">
          <div class="ud-card-hd">
            <div class="ud-card-title">Ownership
              <span class="ud-card-meta" id="ud-owner-count">${isSold ? '1 owner' : '—'}</span>
            </div>
          </div>
          <div id="ud-ownership-body">
            ${isSold && u.customerName ? `
              <div class="ud-owner-row">
                <div class="ud-owner-avatar">${esc((u.customerName||'?').trim().charAt(0).toUpperCase())}</div>
                <div style="flex:1;min-width:0">
                  <div class="ud-owner-name">${esc(u.customerName)}</div>
                  <div class="ud-owner-sub">Current owner${u.soldDate ? ' · since '+fD(u.soldDate) : ''}</div>
                </div>
                <span class="ud-owner-badge-current">Current</span>
              </div>
              <div class="ud-no-transfer">
                <div class="ud-no-transfer-title">No ownership transfers</div>
                <div class="ud-no-transfer-sub">This unit has had a single owner since listing.</div>
              </div>
            ` : `<div class="ud-empty">
              <div class="ud-empty-ic">${_UI.user}</div>
              <div class="ud-empty-title">No owner yet</div>
              <div class="ud-empty-sub">Once this unit is sold, the buyer's details will appear here.</div>
            </div>`}
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- ─── PAYMENTS TAB ─── -->
  <div class="ud-tab-pane${_udTab==='payments'?' on':''}" id="ud-pane-payments">
    <div class="ud-stub" id="ud-pay-card">
      <div class="ud-stub-hd">
        <div class="ud-stub-title"><span style="color:var(--text-muted);display:flex">${_UI.dollar}</span>Payment Schedule</div>
        ${isSold && isA ? `<button class="btn btn-gh btn-sm" onclick="nav('addpayment','${unitId}')"
          style="display:inline-flex;align-items:center;gap:5px;height:30px;font-size:12px;background:var(--bg-primary-soft);color:var(--primary);border-color:transparent">${_UI.plus} Add Payment</button>` : ''}
      </div>
      <div id="ud-pay-body">
        ${isSold ? `<div class="ud-empty"><div class="ud-empty-sub">Loading payment history…</div></div>`
                  : `<div class="ud-empty">
                       <div class="ud-empty-ic">${_UI.dollar}</div>
                       <div class="ud-empty-title">Not sold yet</div>
                       <div class="ud-empty-sub">Payment schedules become available once a sale is recorded for this unit.</div>
                     </div>`}
      </div>
    </div>
  </div>

  <!-- ─── CONTACTS TAB ─── -->
  <div class="ud-tab-pane${_udTab==='contacts'?' on':''}" id="ud-pane-contacts">
    <div class="ud-stub">
      <div class="ud-stub-hd">
        <div class="ud-stub-title"><span style="color:var(--text-muted);display:flex">${_UI.phone}</span>Contact Timeline
          <span class="ud-card-meta">${conCount} logged</span>
        </div>
        ${isSold && isA ? `<button class="btn btn-gh btn-sm" onclick="openConModal('${unitId}')"
          style="display:inline-flex;align-items:center;gap:5px;height:30px;font-size:12px;background:var(--bg-primary-soft);color:var(--primary);border-color:transparent">${_UI.plus} Log Contact</button>` : ''}
      </div>
      <div id="ud-contacts-body">
        ${conCount ? `<div class="ud-rows">
          ${cons.map(c => `
            <div class="ud-con-row">
              <div class="ud-con-ic">${_UI.phone}</div>
              <div class="ud-con-body">
                <div class="ud-con-label">${esc(c.channel||'Contact')} · ${esc(c.response_received||'—')}</div>
                ${c.remarks ? `<div class="ud-con-notes">${esc(c.remarks)}</div>` : ''}
                <div class="ud-con-date">${fD(c.contact_date)}${c.next_followup_date?' · Follow-up '+fD(c.next_followup_date):''}</div>
              </div>
            </div>`).join('')}
        </div>` : `<div class="ud-empty">
          <div class="ud-empty-ic">${_UI.phoneOff}</div>
          <div class="ud-empty-title">No contacts logged yet</div>
          <div class="ud-empty-sub">Log a call, meeting, or email to track engagement with this unit.</div>
        </div>`}
      </div>
    </div>
  </div>

  <!-- ─── DOCUMENTS TAB ─── -->
  <div class="ud-tab-pane${_udTab==='documents'?' on':''}" id="ud-pane-documents">
    <div class="ud-stub">
      <div class="ud-stub-hd">
        <div class="ud-stub-title"><span style="color:var(--text-muted);display:flex">${_UI.fileText}</span>Documents</div>
      </div>
      <div class="ud-empty">
        <div class="ud-empty-ic">${_UI.fileText}</div>
        <div class="ud-empty-title">No documents yet</div>
        <div class="ud-empty-sub">Upload booking forms, agreements, CNIC scans, and payment receipts here.</div>
      </div>
    </div>
  </div>

  <!-- ─── ACTIVITY TAB ─── -->
  <div class="ud-tab-pane${_udTab==='ownership'?' on':''}" id="ud-pane-ownership">
    <div class="ud-stub">
      <div class="ud-stub-hd">
        <div class="ud-stub-title"><span style="color:var(--text-muted);display:flex">${_UI.layers}</span>Ownership Chain</div>
        <div class="ud-card-hd-right" style="display:flex;gap:8px">
          <button class="btn btn-gh btn-sm" onclick="rUnitChain('${unitId}')">Open Full Report</button>
        </div>
      </div>
      <div id="ud-ownership-body" data-unit-id="${unitId}">
        <div class="rops" style="padding:0"><div class="rops-tbl-empty">Open the tab to load the chain.</div></div>
      </div>
    </div>
  </div>

  <div class="ud-tab-pane${_udTab==='activity'?' on':''}" id="ud-pane-activity">
    <div class="ud-stub">
      <div class="ud-stub-hd">
        <div class="ud-stub-title"><span style="color:var(--text-muted);display:flex">${_UI.activity}</span>Activity Log</div>
      </div>
      <div id="ud-activity-body" data-unit-id="${unitId}">
        <div class="ud-empty"><div class="ud-empty-sub">Loading activity…</div></div>
      </div>
    </div>
  </div>

</div>`;

  _udAttachKb();

  // Mount the reusable form-nav bar (First/Prev/Next/Last/Edit/Delete + month picker).
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#ud-form-nav',
      entity:    'unit',
      dateField: 'created_at',
      currentId: unitId,
      storageKey:'rms.fnav.unit',
      loadList: async () => {
        // Source is the in-memory units cache; nav-bar handles month filtering.
        return (window._unitsCache || []).map(x => ({
          id: x.id,
          created_at: x.created_at || x.createdAt || ''
        }));
      },
      openEntry: (id) => openUD(id),
      onEdit:    (id) => (S.role === 'admin' || S.role === 'owner') && nav('addunit', id),
      onDelete:  async (id) => {
        // deleteUnitConfirm already opens its own dialog; if it returns ok, navigate back.
        if (typeof deleteUnitConfirm === 'function') deleteUnitConfirm(id);
      }
    });
  }

  // Async loaders — fire-and-forget; render into placeholders
  if (isSold) setTimeout(() => _udLoadPayHistory(unitId, isA), 0);
  setTimeout(() => _udLoadTxHistory(unitId), 0);
  if (_udTab === 'activity') setTimeout(() => _udLoadHistory(unitId), 0);
  if (_udTab === 'ownership') setTimeout(() => _udLoadOwnershipChain(unitId), 0);
}

// Lazy-load the ownership chain into the tab pane
async function _udLoadOwnershipChain(unitId) {
  const body = document.getElementById('ud-ownership-body');
  if (!body) return;
  if (typeof ucEmbedTimeline === 'function') {
    body.innerHTML = '<div class="rops" style="padding:0"></div>';
    await ucEmbedTimeline(body.firstElementChild, unitId);
  } else {
    body.innerHTML = '<div class="ud-empty"><div class="ud-empty-sub">Ownership chain module not loaded.</div></div>';
  }
}

// Tiny relative-date helper (today / Nd ago / on date)
function _udRelDate(d) {
  try {
    const t = new Date(d).getTime();
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    return 'on ' + fD(d);
  } catch { return '—'; }
}

// ── Tab switcher ──────────────────────────────────────────
function udSwitchTab(tab) {
  _udTab = tab;
  try { localStorage.setItem('rms.ud.tab', tab); } catch {}
  ['overview','payments','contacts','documents','ownership','activity'].forEach(k => {
    const btn  = document.getElementById('ud-tab-' + k);
    const pane = document.getElementById('ud-pane-' + k);
    if (btn)  btn.classList.toggle('on', k === tab);
    if (pane) pane.classList.toggle('on', k === tab);
  });
  // Lazy-load activity timeline the first time the tab opens
  if (tab === 'activity') {
    const body = document.getElementById('ud-activity-body');
    const uid  = body?.dataset?.unitId;
    if (uid && _udHistLoaded !== uid) _udLoadHistory(uid);
  }
  // Lazy-load ownership chain
  if (tab === 'ownership') {
    const body = document.getElementById('ud-ownership-body');
    const uid  = body?.dataset?.unitId;
    if (uid) _udLoadOwnershipChain(uid);
  }
}

// ── More dropdown ─────────────────────────────────────────
function _udMoreMenu(unitId, btn) {
  _invCloseDD();
  const u = gunit(unitId);
  const isSold = u ? uIsSold(u) : false;
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';
  dd.style.left = 'auto';
  // Transfer + Cancel Sale live as top-level header buttons now (for sold units),
  // so the More menu only holds secondary / less-frequent actions.
  let items = `
    <button class="inv-dd-item" onclick="_invCloseDD();nav('unitchain','${unitId}')">${_UI.layers} Ownership Chain</button>
    <button class="inv-dd-item" onclick="_invCloseDD();_udDuplicate('${unitId}')">${_UI.fileText} Duplicate</button>`;
  if (isSold) {
    items += `
    <div class="inv-dd-sep"></div>
    <button class="inv-dd-item" onclick="_invCloseDD();nav('addpayment','${unitId}')">${_UI.dollar} Add Payment</button>
    <button class="inv-dd-item" onclick="_invCloseDD();openConModal('${unitId}')">${_UI.phone} Log Contact</button>
    <button class="inv-dd-item" onclick="_invCloseDD();openPossessionModal('${unitId}')">${_UI.check2} Mark Possession</button>`;
  }
  if (u && u.phone) {
    items += `
    <button class="inv-dd-item" onclick="_invCloseDD();showWATemplates('${unitId}')">${_UI.phone} WhatsApp</button>`;
  }
  items += `
    <div class="inv-dd-sep"></div>
    <button class="inv-dd-item red" onclick="_invCloseDD();deleteUnitConfirm('${unitId}')">${_UI.trash} Delete Unit</button>`;
  dd.innerHTML = items;
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

function _udDuplicate(unitId) {
  // Placeholder — opens Add Unit prefilled in future. For now navigate to add page.
  nav('addunit');
  toast?.('Duplicate flow: please re-enter the unit details.', 'info');
}

// ── Change Status dropdown ────────────────────────────────
function _udChangeStatusMenu(unitId, btn) {
  _invCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';
  dd.style.left = 'auto';
  const sts = (window._statusesCache || []).filter(s => s.isActive);
  dd.innerHTML = `<div class="inv-dd-hd">CHANGE STATUS TO</div>` +
    (sts.length
      ? sts.map(s => `<button class="inv-dd-item" onclick="_invCloseDD();_udChangeStatus('${unitId}','${s.id}')">${uStatusBadge(s.name, s.colorHex)} <span style="margin-left:4px">${esc(s.name)}</span></button>`).join('')
      : `<div style="padding:10px 14px;font-size:12px;color:var(--text-muted)">No statuses configured</div>`);
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

async function _udChangeStatus(unitId, statusId) {
  const cid = S?.cid;
  if (!cid || !statusId) return;
  const st = (window._statusesCache || []).find(s => s.id === statusId);
  const { data, error } = await supabase.rpc('update_unit', { p_id: unitId, p_company_id: cid, p_data: { status_id: statusId } });
  if (error || !data?.success) {
    toast?.('Could not update status: ' + (data?.error || error?.message || 'Error'), 'err');
    return;
  }
  const u = (window._unitsCache || []).find(x => x.id === unitId);
  if (u && st) {
    u.statusId = statusId; u.status = st.name;
    u.statusColor = st.colorHex; u.isAvailable = st.isAvailable;
  }
  toast?.('Status updated to ' + (st?.name || '—'), 'ok');
  rUD(unitId);
}

// ── Keyboard shortcuts on the detail page ─────────────────
function _udAttachKb() {
  if (_udKbActive) return;
  _udKbActive = true;
  document.addEventListener('keydown', _udKbHandler);
}
function _udDetachKb() {
  _udKbActive = false;
  document.removeEventListener('keydown', _udKbHandler);
}
function _udKbHandler(e) {
  const pg = document.getElementById('pg-unitdetail');
  if (!pg || !pg.classList.contains('on')) { _udDetachKb(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Number keys 1-5 → switch tabs
  const tabs = ['overview','payments','contacts','documents','activity'];
  if (e.key >= '1' && e.key <= '5') {
    e.preventDefault();
    udSwitchTab(tabs[parseInt(e.key,10) - 1]);
    return;
  }
  if (e.key === 'e') {
    e.preventDefault();
    const uid = _uid;
    if (uid && (S.role==='admin'||S.role==='owner')) nav('addunit', uid);
  }
  if (e.key === 's') {
    e.preventDefault();
    const btn = document.querySelector('.ud-hdr-right .btn:nth-child(2)');
    if (btn) btn.click();
  }
}

// ── Async loaders ─────────────────────────────────────────

async function _udLoadTxHistory(unitId) {
  const card = document.getElementById('ud-ownership-card');
  const body = document.getElementById('ud-ownership-body');
  if (!body) return;
  const { data, error } = await supabase.rpc('get_unit_ownership_history', {
    p_unit_id: unitId, p_company_id: S.cid
  });
  if (error || !data?.success) return;  // keep optimistic render
  const hist = data.history || [];
  _udTxLoaded = unitId;

  const cnt = document.getElementById('ud-owner-count');
  if (cnt) cnt.textContent = hist.length ? `${hist.length} record${hist.length!==1?'s':''}` : '—';

  if (!hist.length) return; // optimistic placeholder stays

  body.innerHTML = hist.map(h => {
    const isAct = !!h.is_active;
    const initial = (h.client_name || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="ud-owner-row">
        <div class="ud-owner-avatar" style="${isAct?'':'opacity:.6'}">${esc(initial)}</div>
        <div style="flex:1;min-width:0">
          <div class="ud-owner-name">${esc(h.client_name || '—')}</div>
          <div class="ud-owner-sub">
            ${isAct ? 'Current owner' : 'Previous owner'}${h.sale_date ? ' · booked ' + fD(h.sale_date) : ''}
            ${h.transfer_date && !isAct ? ' · transferred ' + fD(h.transfer_date) : ''}
          </div>
        </div>
        ${isAct ? `<span class="ud-owner-badge-current">Current</span>` : ''}
      </div>`;
  }).join('') + (hist.length === 1
    ? `<div class="ud-no-transfer">
         <div class="ud-no-transfer-title">No ownership transfers</div>
         <div class="ud-no-transfer-sub">This unit has had a single owner since listing.</div>
       </div>` : '');
}

async function _udLoadPayHistory(unitId, isA) {
  const body = document.getElementById('ud-pay-body');
  if (!body) return;
  try {
    const { data: sales, error: sErr } = await supabase
      .from('sales')
      .select('id')
      .eq('unit_id', unitId)
      .eq('company_id', S.cid)
      .eq('status', 'active')
      .limit(1);
    if (sErr) throw sErr;

    const saleId = sales?.[0]?.id || null;
    let payments = [];
    if (saleId) {
      const { data: pRows, error: pErr } = await supabase
        .from('payments')
        .select('id,payment_date,amount,payment_method,reference_no,notes')
        .eq('sale_id', saleId)
        .eq('company_id', S.cid)
        .order('payment_date', { ascending: false })
        .limit(200);
      if (pErr) throw pErr;
      payments = pRows || [];
    }

    _udPayLoaded = unitId;

    // Update badge
    const badge = document.getElementById('ud-tb-payments');
    if (badge) {
      if (payments.length) { badge.textContent = String(payments.length); badge.style.display = ''; }
      else { badge.style.display = 'none'; }
    }

    if (!payments.length) {
      body.innerHTML = `<div class="ud-empty">
        <div class="ud-empty-ic">${_UI.dollar}</div>
        <div class="ud-empty-title">No payments recorded</div>
        <div class="ud-empty-sub">Once payments are received against this unit, they will be listed here in chronological order.</div>
      </div>`;
      return;
    }

    const total = payments.reduce((s, r) => s + Number(r.amount || 0), 0);
    body.innerHTML = `
      <div style="padding:14px 18px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border)">
        <div class="ud-pay-chip"><span class="ud-pay-chip-lbl">Total received</span><span class="ud-pay-chip-val">${fM(total)}</span></div>
        <div class="ud-pay-chip"><span class="ud-pay-chip-lbl">Payments</span><span class="ud-pay-chip-val">${payments.length}</span></div>
      </div>
      <div class="tw" style="padding:0 0 12px">
        <table class="t" style="margin:0">
          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Notes</th><th class="r">Amount</th>${isA?'<th></th>':''}</tr></thead>
          <tbody>
          ${payments.map(r => `<tr>
            <td style="white-space:nowrap">${fD(r.payment_date)}</td>
            <td>${esc(r.payment_method||'—')}</td>
            <td style="font-family:monospace;font-size:11px;color:var(--text-muted)">${esc(r.reference_no||'—')}</td>
            <td style="font-size:11px;color:var(--text-muted);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.notes||'—')}</td>
            <td class="r" style="font-variant-numeric:tabular-nums;font-weight:600;color:var(--success)">+${fM(r.amount)}</td>
            ${isA ? `<td style="white-space:nowrap;text-align:right">
              <button class="btn btn-gh btn-xs" onclick="printPaymentReceipt('${r.id}')" title="Print receipt">${_UI.printer}</button>
            </td>` : ''}
          </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    body.innerHTML = `<div class="ud-empty">
      <div class="ud-empty-ic">${_UI.dollar}</div>
      <div class="ud-empty-title">Could not load payments</div>
      <div class="ud-empty-sub">${esc(e.message||'Unknown error')}</div>
    </div>`;
  }
}

async function _udLoadHistory(unitId) {
  const el = document.getElementById('ud-activity-body');
  if (!el) return;
  const { data, error } = await supabase.rpc('get_unit_history', {
    p_unit_id: unitId, p_company_id: S.cid
  });
  if (error || !data?.success) {
    el.innerHTML = `<div class="ud-empty">
      <div class="ud-empty-ic">${_UI.activity}</div>
      <div class="ud-empty-title">Could not load activity</div>
      <div class="ud-empty-sub">${esc(data?.error || error?.message || 'Error')}</div>
    </div>`;
    return;
  }
  const events = data.events || [];
  _udHistLoaded = unitId;

  // Update badge
  const badge = document.getElementById('ud-tb-activity');
  if (badge) {
    if (events.length) { badge.textContent = String(events.length); badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }

  if (!events.length) {
    el.innerHTML = `<div class="ud-empty">
      <div class="ud-empty-ic">${_UI.activity}</div>
      <div class="ud-empty-title">No activity yet</div>
      <div class="ud-empty-sub">Status changes, edits, payments, and other events will appear here as they happen.</div>
    </div>`;
    return;
  }

  const iconMap = {
    unit_created:_UI.bldg, booking:_UI.fileText, booking_cancelled:_UI.x,
    installment:_UI.dollar, payment:_UI.dollar, pdc:_UI.fileText,
    cancellation:_UI.x, transfer:_UI.refresh
  };
  const clrMap = {
    unit_created:'var(--primary)', booking:'var(--success)', booking_cancelled:'var(--warning)',
    installment:'var(--text-muted)', payment:'var(--success)', pdc:'var(--info)',
    cancellation:'var(--danger)', transfer:'#8b5cf6'
  };

  el.innerHTML = `<div class="ud-activity-timeline">
    ${events.map(ev => {
      const ic = iconMap[ev.event_type] || _UI.info;
      const cl = clrMap[ev.event_type]  || 'var(--text-muted)';
      return `<div class="ud-act-row">
        <div class="ud-act-ic" style="color:${cl};background:color-mix(in srgb, ${cl} 12%, transparent)">${ic}</div>
        <div class="ud-act-body">
          <div class="ud-act-title">${esc(ev.description || ev.event_type || '—')}</div>
          <div class="ud-act-meta">
            ${ev.event_date ? `<span>${fD(ev.event_date)}</span>` : ''}
            ${ev.amount != null ? `<span>· ${fM(ev.amount)}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}


// ══ PRINT (kept for backward compat) ══════════════════════

async function printUD(unitId) {
  const u    = gunit(unitId);
  if (!u) return;
  const cons = gcons(unitId).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  // Load payments from Supabase
  let recs = [];
  try {
    const { data: sRows } = await supabase.from('sales').select('id').eq('unit_id',unitId).eq('company_id',S.cid).eq('status','active').limit(1);
    const sid = sRows?.[0]?.id;
    if (sid) {
      const { data: pRows } = await supabase.from('payments').select('id,payment_date,amount,payment_method,reference_no,notes').eq('sale_id',sid).eq('company_id',S.cid).order('payment_date',{ascending:false});
      recs = pRows || [];
    }
  } catch(e) { /* print without payments if query fails */ }
  const totalPaid = actualPaid(u);
  const rem       = actualPending(u);
  const p2        = pct(totalPaid, u.totalPrice);
  const prj       = gproject(u.projectId);
  const _unitHtml = `<!DOCTYPE html><html><head><title>Unit ${u.unitNo} — Nexunova RMS</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:28px;max-width:720px;margin:0 auto}
    h3{font-size:14px;border-bottom:2px solid #C9A84C;padding-bottom:5px;margin:20px 0 10px}
    .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0}
    .lbl{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    .val{font-weight:600;text-align:right}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th{background:#f5f5f5;padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd}
    td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:12px}
    .hdr{background:#1a1a2e;color:white;padding:18px 22px;border-radius:8px;margin-bottom:20px}
    .hdr h1{color:white;margin:0 0 4px;font-size:22px}
    .hdr p{color:#C9A84C;font-size:11px;margin:0;letter-spacing:1px;text-transform:uppercase}
    @media print{body{padding:0}}
  </style></head><body>
  <div class="hdr"><h1>Unit ${u.unitNo}</h1><p>Nexunova RMS · ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}</p></div>
  <h3>Unit Information</h3>
  ${u.unitCode ? `<div class="row"><span class="lbl">Unit Code</span><span class="val" style="font-family:monospace">${u.unitCode}</span></div>` : ''}
  <div class="row"><span class="lbl">Unit No</span><span class="val">${u.unitNo}</span></div>
  ${prj ? `<div class="row"><span class="lbl">Project</span><span class="val">${prj.projectName||prj.name}</span></div>` : ''}
  <div class="row"><span class="lbl">Type</span><span class="val">${u.type||'—'}</span></div>
  <div class="row"><span class="lbl">Status</span><span class="val">${u.status}</span></div>
  ${u.floorLabel||u.floorNo!=null?`<div class="row"><span class="lbl">Floor</span><span class="val">${u.floorLabel||'Floor '+u.floorNo}</span></div>`:''}
  ${u.block?`<div class="row"><span class="lbl">Block</span><span class="val">${u.block}</span></div>`:''}
  ${u.area?`<div class="row"><span class="lbl">Area</span><span class="val">${u.area} ${u.areaUnit}</span></div>`:''}
  ${u.bedrooms!=null?`<div class="row"><span class="lbl">Bedrooms</span><span class="val">${u.bedrooms}</span></div>`:''}
  ${u.bathrooms!=null?`<div class="row"><span class="lbl">Bathrooms</span><span class="val">${u.bathrooms}</span></div>`:''}
  ${u.basePrice>0?`<div class="row"><span class="lbl">Base Price</span><span class="val">PKR ${Number(u.basePrice).toLocaleString('en-PK')}</span></div>`:''}
  ${u.customerName?`<h3>Client Information</h3>
  <div class="row"><span class="lbl">Name</span><span class="val">${u.customerName}</span></div>
  <div class="row"><span class="lbl">Phone</span><span class="val">${u.phone||'—'}</span></div>
  ${u.bookingNo?`<div class="row"><span class="lbl">Booking #</span><span class="val">${u.bookingNo}</span></div>`:''}
  ${u.soldBy?`<div class="row"><span class="lbl">Sold By</span><span class="val">${u.soldBy}</span></div>`:''}`:''}
  ${u.totalPrice>0?`<h3>Financial Summary</h3>
  <div class="row"><span class="lbl">Total Price</span><span class="val">PKR ${Number(u.totalPrice).toLocaleString('en-PK')}</span></div>
  <div class="row"><span class="lbl">Amount Paid</span><span class="val" style="color:green">PKR ${Number(totalPaid).toLocaleString('en-PK')}</span></div>
  <div class="row"><span class="lbl">Pending</span><span class="val" style="color:${rem>0?'#c00':'green'}">PKR ${Number(rem).toLocaleString('en-PK')}</span></div>
  <div class="row"><span class="lbl">Recovery %</span><span class="val">${p2}%</span></div>`:''}
  ${cons.length?`<h3>Contact History (${cons.length})</h3>
  <table><thead><tr><th>Date</th><th>Type</th><th>Response</th><th>Notes</th><th>Follow-up</th></tr></thead><tbody>
  ${cons.map(c=>`<tr><td>${fD(c.contact_date)}</td><td>${c.channel}</td><td>${c.response_received}</td><td>${c.remarks||'—'}</td><td>${c.next_followup_date?fD(c.next_followup_date):'—'}</td></tr>`).join('')}
  </tbody></table>`:''}
  ${recs.length?`<h3>Payment History (${recs.length})</h3>
  <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead><tbody>
  ${recs.map(r=>`<tr><td>${fD(r.payment_date)}</td><td>${r.payment_method||'—'}</td><td style="font-family:monospace">${r.reference_no||'—'}</td><td style="text-align:right;font-weight:600">PKR ${Number(r.amount).toLocaleString('en-PK')}</td></tr>`).join('')}
  </tbody></table>`:''}
  </body></html>`;
  _printHTML(_unitHtml);
}

// ══ ADD UNIT PAGE ══════════════════════════════════════════════════════

let _auKbHandler = null;
function _auCleanupKb() {
  if (_auKbHandler) { document.removeEventListener('keydown', _auKbHandler); _auKbHandler = null; }
}

function rAddUnit(editUnitId) {
  const pg = document.getElementById('pg-addunit');
  if (!pg) return;
  const isA = S?.role === 'admin' || S?.role === 'owner';
  if (!isA) { nav('dashboard'); return; }
  if (!S?.cid) { pg.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">No company selected</div></div></div>`; return; }

  const editUnit  = editUnitId ? gunit(editUnitId) : null;
  const isEdit    = !!editUnit;
  const eu        = editUnit || {};

  const projects  = gprojects();
  const floors    = (window._floorsCache   || []).filter(f => f.isActive);
  const types     = (window._typesCache    || []).filter(t => t.isActive);
  const statuses  = (window._statusesCache || []).filter(s => s.isActive);
  const defStatus = isEdit
    ? (statuses.find(s => s.id === eu.statusId) || statuses[0])
    : (statuses.find(s => s.isAvailable) || statuses[0]);

  const matchFloor = isEdit
    ? (floors.find(f => f.name.toLowerCase() === (eu.floorLabel || '').toLowerCase()))
    : null;

  const featVal = isEdit
    ? (Array.isArray(eu.features) ? eu.features.join(', ') : (eu.features || ''))
    : '';

  const catLink = (tab, label) =>
    `<a href="#" onclick="setCatTab('${tab}');nav('categories');return false"
      style="font-size:11px;color:var(--info);font-weight:500;text-decoration:none">+ ${label}</a>`;

  const emptyNote = (items, tab, thing) => !items.length
    ? `<div style="font-size:11px;color:var(--warn);margin-top:4px">No ${thing}s set up — ${catLink(tab, 'Add '+thing+' first')}</div>`
    : '';

  const cancelTarget = isEdit ? `nav('unitdetail')` : `nav('units')`;

  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>${isEdit ? 'Edit Unit' : 'Add Unit'}</h2>
        <p>${isEdit ? `Editing unit <strong>${esc(eu.unitNo)}</strong>` : 'Register a new inventory unit into the project'}</p>
      </div>
      <div class="ph-r">
        <button class="btn btn-gh btn-sm" onclick="${cancelTarget}">← Back</button>
      </div>
    </div>

    <!-- Form navigation bar (jump to other saved units) -->
    <div id="afu-form-nav"></div>

    <input type="hidden" id="au-edit-id" value="${esc(editUnitId || '')}">

    <div class="card" style="max-width:720px">
      <div class="cb">

        <!-- Identity -->
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:5px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01"/></svg>Project &amp; Identity</div>
        <div class="g2" style="margin-bottom:16px">
          <div class="fr">
            <label class="fl">Project *</label>
            ${projects.length
              ? `<select id="au-project" class="inp-light">
                  <option value="">— Select Project —</option>
                  ${projects.map(p => `<option value="${p.id}"${p.id === eu.projectId ? ' selected' : ''}>${esc(p.projectName||p.name)}</option>`).join('')}
                </select>`
              : `<div style="font-size:12px;color:var(--warn);padding:8px 0">No projects yet —
                  <a href="#" onclick="nav('projects');return false" style="color:var(--info);font-weight:600">+ Add Project</a></div>
                <input type="hidden" id="au-project" value="">`}
            <div id="e-au-project" style="font-size:11px;color:var(--err);margin-top:3px;min-height:14px"></div>
          </div>
          <div class="fr">
            <label class="fl">Unit Number *</label>
            <input id="au-no" class="inp-light" type="text" placeholder="e.g. A-101, Shop-12, F3-204" value="${esc(eu.unitNo || '')}">
            <div id="e-au-no" style="font-size:11px;color:var(--err);margin-top:3px;min-height:14px"></div>
          </div>
        </div>

        <!-- Classification -->
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;gap:5px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Classification</div>
        <div class="g2" style="margin-bottom:4px">
          <div class="fr">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
              <label class="fl" style="margin:0">Floor *</label>
              ${catLink('floors', 'Add Floor')}
            </div>
            <select id="au-floor" class="inp-light">
              <option value="">— Select Floor —</option>
              ${floors.map(f => `<option value="${f.id}"${matchFloor?.id === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
            </select>
            ${emptyNote(floors, 'floors', 'floor')}
            <div id="e-au-floor" style="font-size:11px;color:var(--err);margin-top:3px;min-height:14px"></div>
          </div>
          <div class="fr">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
              <label class="fl" style="margin:0">Unit Type *</label>
              ${catLink('types', 'Add Type')}
            </div>
            <select id="au-type" class="inp-light">
              <option value="">— Select Type —</option>
              ${types.map(t => `<option value="${t.id}"${t.id === eu.unitTypeId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
            ${emptyNote(types, 'types', 'type')}
            <div id="e-au-type" style="font-size:11px;color:var(--err);margin-top:3px;min-height:14px"></div>
          </div>
        </div>
        <div class="g2" style="margin-bottom:16px">
          <div class="fr">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
              <label class="fl" style="margin:0">Status *</label>
              ${catLink('statuses', 'Add Status')}
            </div>
            <select id="au-status" class="inp-light">
              ${statuses.map(s => `<option value="${s.id}"${s.id === defStatus?.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
            ${emptyNote(statuses, 'statuses', 'status')}
          </div>
          <div class="fr">
            <label class="fl">Block / Tower <span style="color:var(--t3);font-weight:400">(optional)</span></label>
            <input id="au-block" class="inp-light" type="text" placeholder="e.g. A, B, Tower-1" value="${esc(eu.block || '')}">
          </div>
        </div>

        <!-- Area & Price -->
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;gap:5px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 3L3 21"/><path d="M3 3l18 0"/><path d="M3 3l0 18"/></svg>Area &amp; Price</div>
        <div class="g2" style="margin-bottom:12px">
          <div class="fr">
            <label class="fl">Gross Area *</label>
            <div style="display:flex;gap:7px">
              <input id="au-area" class="inp-light" type="number" min="0" step="0.01" placeholder="e.g. 1200" style="flex:2" value="${eu.area != null && eu.area > 0 ? eu.area : ''}">
              <select id="au-area-unit" class="inp-light" style="flex:1">
                <option value="sqft"${(eu.areaUnit||'sqft')==='sqft'?' selected':''}>Sq ft</option>
                <option value="sqyd"${eu.areaUnit==='sqyd'?' selected':''}>Sq yd</option>
                <option value="sqm"${eu.areaUnit==='sqm'?' selected':''}>Sq m</option>
                <option value="marla"${eu.areaUnit==='marla'?' selected':''}>Marla</option>
                <option value="kanal"${eu.areaUnit==='kanal'?' selected':''}>Kanal</option>
              </select>
            </div>
            <div id="e-au-area" style="font-size:11px;color:var(--err);margin-top:3px;min-height:14px"></div>
          </div>
          <div class="fr">
            <label class="fl">Carpet Area <span style="color:var(--t3);font-weight:400">(optional)</span></label>
            <input id="au-carpet-area" class="inp-light" type="number" min="0" step="0.01" placeholder="Usable / carpet area" value="${eu.carpetArea != null ? eu.carpetArea : ''}">
          </div>
        </div>
        <div class="g2" style="margin-bottom:16px">
          <div class="fr">
            <label class="fl">Base Price <span style="color:var(--t3);font-weight:400">(optional)</span></label>
            <input id="au-price" class="inp-light inp-amt" type="text" inputmode="numeric" placeholder="e.g. 5,500,000" value="${eu.basePrice > 0 ? Number(eu.basePrice).toLocaleString('en-PK',{maximumFractionDigits:0}) : ''}">
          </div>
          <div class="fr">
            <label class="fl">Monthly Maintenance <span style="color:var(--t3);font-weight:400">(optional)</span></label>
            <input id="au-maintenance" class="inp-light inp-amt" type="text" inputmode="numeric" placeholder="e.g. 8,000" value="${eu.maintenanceMonthly != null && eu.maintenanceMonthly > 0 ? Number(eu.maintenanceMonthly).toLocaleString('en-PK',{maximumFractionDigits:0}) : ''}">
          </div>
        </div>

        <!-- Optional details -->
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;padding-top:14px;border-top:1px solid var(--line)">
          ℹ️ Additional Details <span style="font-size:9px;font-weight:400;color:var(--t3);letter-spacing:0">(all optional)</span>
        </div>
        <div class="g2" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:12px">
          <div class="fr">
            <label class="fl">Bedrooms</label>
            <input id="au-bedrooms" class="inp-light" type="number" min="0" placeholder="0" value="${eu.bedrooms != null ? eu.bedrooms : ''}">
          </div>
          <div class="fr">
            <label class="fl">Bathrooms</label>
            <input id="au-bathrooms" class="inp-light" type="number" min="0" placeholder="0" value="${eu.bathrooms != null ? eu.bathrooms : ''}">
          </div>
          <div class="fr">
            <label class="fl">Parking</label>
            <input id="au-parking" class="inp-light" type="number" min="0" placeholder="0" value="${eu.parkingCount != null ? eu.parkingCount : ''}">
          </div>
        </div>
        <div class="g2" style="margin-bottom:12px">
          <div class="fr">
            <label class="fl">Facing</label>
            <select id="au-facing" class="inp-light">
              <option value="">— Not specified —</option>
              ${['North','South','East','West','NE','NW','SE','SW'].map(f =>
                `<option value="${f}"${eu.facing===f?' selected':''}>${f==='NE'?'North-East':f==='NW'?'North-West':f==='SE'?'South-East':f==='SW'?'South-West':f}</option>`
              ).join('')}
            </select>
          </div>
          <div class="fr">
            <label class="fl">Possession Date <span style="color:var(--t3);font-weight:400">(optional)</span></label>
            <input id="au-possession-date" class="inp-light" type="date" value="${eu.possessionDate || ''}">
          </div>
        </div>
        <div class="g2" style="margin-bottom:12px">
          <div class="fr">
            <label class="fl">Features / Tags</label>
            <input id="au-features" class="inp-light" type="text" placeholder="Sea view, Park facing, Balcony (comma-separated)" value="${esc(featVal)}">
          </div>
          <div class="fr" style="display:flex;flex-direction:column;gap:10px;justify-content:center;padding-top:18px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--t2)">
              <input id="au-is-corner" type="checkbox" ${eu.isCorner?'checked':''}>
              <span>Corner Unit</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--t2)">
              <input id="au-is-premium" type="checkbox" ${eu.isPremium?'checked':''}>
              <span>Premium Unit</span>
            </label>
          </div>
        </div>
        <div class="fr">
          <label class="fl">Notes</label>
          <textarea id="au-notes" class="inp-light" rows="2" placeholder="Internal notes...">${esc(eu.notes || '')}</textarea>
        </div>

      </div>
      <div style="border-top:1px solid var(--line);padding:16px 20px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-gh" onclick="${cancelTarget}">Cancel</button>
        <button class="btn btn-g" id="au-save-btn" onclick="saveAddUnitForm()">${isEdit ? 'Update Unit' : 'Save Unit'}</button>
      </div>
    </div>
  </div>`;

  // Keyboard: Enter (on text inputs) = save  |  ESC is handled globally by ui.js
  _auCleanupKb();
  _auKbHandler = function(e) {
    const p = document.getElementById('pg-addunit');
    if (!p || !p.classList.contains('on')) return;
    if (e.key === 'Enter') {
      const tag = e.target.tagName;
      const itype = (e.target.type || '').toLowerCase();
      if (tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'BUTTON' && itype !== 'checkbox' && itype !== 'radio') {
        e.preventDefault();
        saveAddUnitForm();
      }
    }
  };
  document.addEventListener('keydown', _auKbHandler);

  // Mount the reusable form-nav bar — lets the user browse other units
  // through the same form. Clicking Prev/Next loads that unit in edit mode.
  // Save / Cancel here are sticky-visible so the user never has to scroll
  // to the bottom of the form to save or abandon.
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#afu-form-nav',
      entity:    'unit',
      dateField: 'created_at',
      currentId: editUnitId || null,
      storageKey:'rms.fnav.unit',
      loadList: async () => (window._unitsCache || []).map(x => ({
        id: x.id,
        created_at: x.created_at || x.createdAt || ''
      })),
      openEntry: (id) => nav('addunit', id),       // reload form in edit mode
      onEdit:    (id) => nav('addunit', id),
      onDelete:  async (id) => deleteUnitConfirm(id),
      onSave:    () => saveAddUnitForm(),
      onCancel:  () => nav(isEdit ? 'unitdetail' : 'units'),
      saveLabel: isEdit ? 'Update' : 'Save Unit'
    });
  }
}

async function saveAddUnitForm() {
  const editId  = (document.getElementById('au-edit-id')?.value || '').trim();
  const isEdit  = !!editId;
  const projId  = document.getElementById('au-project')?.value || '';
  const unitNo  = (document.getElementById('au-no')?.value || '').trim();
  const floorId = document.getElementById('au-floor')?.value || '';
  const typeId  = document.getElementById('au-type')?.value  || '';

  let hasErr = false;
  const setErr = (id, msg) => { const el = document.getElementById(id); if (el) el.textContent = msg; if (msg) hasErr = true; };
  const clrErr = id => { const el = document.getElementById(id); if (el) el.textContent = ''; };

  ['e-au-project','e-au-no','e-au-floor','e-au-type','e-au-area'].forEach(clrErr);
  setErr('e-au-project', !projId  ? 'Project is required' : '');
  setErr('e-au-no',      !unitNo  ? 'Unit number is required' : '');
  setErr('e-au-floor',   !floorId ? 'Floor is required' : '');
  setErr('e-au-type',    !typeId  ? 'Unit type is required' : '');
  if (hasErr) return;

  // Duplicate unit number check — exclude the current unit when editing
  const dupeUnit = (window._unitsCache || []).find(u =>
    (isEdit ? u.id !== editId : true) &&
    u.projectId === projId &&
    (u.unitNo || '').toLowerCase() === unitNo.toLowerCase()
  );
  if (dupeUnit) {
    setErr('e-au-no', `Unit "${unitNo}" already exists in this project. Please use a different number.`);
    return;
  }

  const floorObj  = (window._floorsCache || []).find(f => f.id === floorId);
  const area      = parseFloat(document.getElementById('au-area')?.value)     || null;
  const bedrooms  = parseInt(document.getElementById('au-bedrooms')?.value)   || null;
  const bathrooms = parseInt(document.getElementById('au-bathrooms')?.value)  || null;
  const parking   = parseInt(document.getElementById('au-parking')?.value)    || 0;
  const basePrice = parseAmt(document.getElementById('au-price')?.value);
  const featRaw   = (document.getElementById('au-features')?.value || '').trim();

  // Plan limit check — only for new units, not edits
  if (!isEdit) {
    try {
      const { data: sub } = await supabase.from('subscriptions')
        .select('subscription_plans(max_units)')
        .eq('company_id', S.cid).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const maxUnits = sub?.subscription_plans?.max_units ?? 0;
      const usedUnits = typeof gunits === 'function' ? gunits().length : (window._unitsCache || []).length;
      if (maxUnits > 0 && usedUnits >= maxUnits) {
        setErr('e-au-no', `Unit limit reached — your plan allows ${maxUnits} units. Upgrade to add more.`);
        return;
      }
    } catch(e) { /* non-blocking — don't prevent save if check fails */ }
  }

  const btn = document.getElementById('au-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = isEdit ? 'Updating…' : 'Saving…'; }

  try {
    const carpetArea      = parseFloat(document.getElementById('au-carpet-area')?.value)      || null;
    const maintenanceMo   = parseAmt(document.getElementById('au-maintenance')?.value) || null;
    const possessionDate  = document.getElementById('au-possession-date')?.value               || null;
    const isCorner        = document.getElementById('au-is-corner')?.checked                   || false;
    const isPremium       = document.getElementById('au-is-premium')?.checked                  || false;

    const payload = {
      company_id:          S.cid,
      project_id:          projId,
      unit_no:             unitNo,
      unit_type_id:        typeId || null,
      status_id:           document.getElementById('au-status')?.value || null,
      floor_id:            floorId || null,
      floor_no:            floorObj?.sortOrder ?? null,
      floor_label:         floorObj?.name || null,
      block:               (document.getElementById('au-block')?.value || '').trim() || null,
      area:                area,
      carpet_area:         carpetArea,
      area_unit:           document.getElementById('au-area-unit')?.value || 'sqft',
      bedrooms,
      bathrooms,
      parking_count:       parking,
      facing:              document.getElementById('au-facing')?.value || null,
      base_price:          basePrice,
      maintenance_monthly: maintenanceMo,
      possession_date:     possessionDate,
      is_corner:           isCorner,
      is_premium:          isPremium,
      features:            featRaw ? featRaw.split(',').map(f => f.trim()).filter(Boolean) : [],
      notes:               (document.getElementById('au-notes')?.value || '').trim() || null,
    };

    if (isEdit) {
      const { data, error } = await supabase.rpc('update_unit', {
        p_id:         editId,
        p_company_id: S.cid,
        p_data:       payload
      });
      if (error) throw error;
      if (!data?.success) { toast(data?.error || 'Update failed', 'err'); return; }
      await loadUnitsCache(S.cid);
      logA('unit', 'Updated unit: ' + unitNo);
      toast('Unit "' + unitNo + '" updated', 'ok');
      _uid = editId;
      _auCleanupKb();
      nav('unitdetail');
    } else {
      payload.created_by = S.userId || null;
      const { data, error } = await supabase.rpc('create_unit', { p_data: payload });
      if (error) throw error;
      if (!data?.success) { toast(data?.error || 'Save failed', 'err'); return; }
      await loadUnitsCache(S.cid);
      logA('unit', 'Added unit: ' + unitNo);
      toast('Unit "' + unitNo + '" added successfully', 'ok');
      _auCleanupKb();
      nav('units');
    }
  } catch (err) {
    console.error('[saveAddUnitForm]', err);
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('already exists')) {
      const noEl = document.getElementById('e-au-no');
      if (noEl) noEl.textContent = `Unit "${unitNo}" already exists in this project. Please use a different number.`;
    } else {
      toast('Could not save unit: ' + err.message, 'err');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = isEdit ? 'Update Unit' : 'Save Unit'; }
  }
}

// ══ PRINT INVENTORY LIST ══════════════════════════════════════════════

function printInventoryList() {
  let units = gunits();

  // Apply same filters as rULF()
  if (_uf === 'Available') units = units.filter(u =>  u.isAvailable);
  else if (_uf === 'Sold') units = units.filter(u => !u.isAvailable && u.status !== 'Dead');
  else if (_uf === 'Dead') units = units.filter(u =>  u.status === 'Dead');
  if (_uPrjFilter)    units = units.filter(u => u.projectId    === _uPrjFilter);
  if (_uTypeFilter)   units = units.filter(u => u.unitTypeId   === _uTypeFilter);
  if (_uStatusFilter) units = units.filter(u => u.statusId     === _uStatusFilter);
  if (_us) {
    const q = _us.toLowerCase();
    units = units.filter(u =>
      u.unitNo.toLowerCase().includes(q) ||
      (u.unitCode || '').toLowerCase().includes(q) ||
      (u.block    || '').toLowerCase().includes(q)
    );
  }

  const filters = [];
  if (_uf && _uf !== 'All') filters.push(`Status Tab: ${_uf}`);
  if (_us) filters.push(`Search: "${_us}"`);
  if (_uPrjFilter) {
    const prj = gproject(_uPrjFilter);
    if (prj) filters.push(`Project: ${prj.projectName || prj.name}`);
  }
  if (_uTypeFilter) {
    const t = (window._typesCache || []).find(t => t.id === _uTypeFilter);
    if (t) filters.push(`Type: ${t.name}`);
  }
  if (_uStatusFilter) {
    const st = (window._statusesCache || []).find(s => s.id === _uStatusFilter);
    if (st) filters.push(`Status: ${st.name}`);
  }

  const prjObj  = _uPrjFilter ? gproject(_uPrjFilter) : null;
  const prjName = prjObj ? (prjObj.projectName || prjObj.name || '') : '';

  const w = _pw('Inventory List — Nexunova RMS', _pCSS('A4'));
  if (!w) return;
  w.document.write(`
    ${_lh('inventory')}
    ${prjName
      ? `<div style="border-left:5px solid #C9A84C;padding:6px 14px;margin-bottom:10px;background:#faf8f3">
           <div style="font-size:24px;font-weight:800;color:#1E2D47;letter-spacing:-0.4px;line-height:1.2">${prjName}</div>
           <div style="font-size:12px;color:#666;font-weight:500;margin-top:2px">Inventory List</div>
         </div>`
      : `<h2 style="font-size:17px;font-weight:700;color:#1E2D47;margin:0 0 4px">Inventory List</h2>`
    }
    <p style="font-size:11px;color:#555;margin:0 0 ${filters.length ? '6' : '14'}px">
      ${units.length} unit${units.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Printed: ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}
    </p>
    ${filters.length ? `<p style="font-size:11px;color:#666;background:#f5f7fa;padding:5px 10px;border-radius:4px;margin-bottom:14px">
      Filters: ${filters.join(' &nbsp;|&nbsp; ')}
    </p>` : ''}
    <table>
      <thead><tr>
        <th>Code</th>
        <th>Unit No</th>
        <th>Project</th>
        <th>Type</th>
        <th>Floor</th>
        <th>Area</th>
        <th style="text-align:right">Base Price</th>
        <th>Status</th>
      </tr></thead>
      <tbody>
        ${units.map(u => {
          const prj = gproject(u.projectId);
          return `<tr>
            <td style="font-family:monospace;font-size:10px;color:#666">${u.unitCode || '—'}</td>
            <td style="font-weight:700">${u.unitNo}</td>
            <td>${prj?.projectName || prj?.name || '—'}</td>
            <td>${u.type || '—'}</td>
            <td>${u.floorLabel || (u.floorNo != null ? 'F' + u.floorNo : '—')}</td>
            <td>${u.area ? u.area + ' ' + u.areaUnit : '—'}</td>
            <td style="text-align:right;font-weight:600">${u.basePrice > 0 ? 'PKR ' + Number(u.basePrice).toLocaleString('en-PK') : '—'}</td>
            <td>${u.status || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="6" style="font-weight:700;color:#1E2D47">Total: ${units.length} units</td>
        <td colspan="2" style="text-align:right;font-size:10px;color:#555">Nexunova RMS</td>
      </tr></tfoot>
    </table>
  `);
  _pclose(w);
}
