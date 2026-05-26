// ══ CLIENTS MODULE ═══════════════════════════════════════════
// Storage: Supabase — cache via window._clientsCache
// RPCs: create_client, update_client, delete_client

// ── State (globals _cid / _cs declared in data.js) ─────────
let _cStatusFilter   = '';
let _cCategoryFilter = '';
let _cHealthFilter   = '';
let _cPage           = 1;
const _C_PER_PAGE    = 20;
let _cView           = localStorage.getItem('nxn_cl_view') || 'table';

window._healthScoresCache = {}; // client_id → {score, category, total_exposure, ...}

async function loadHealthScoresCache(companyId) {
  try {
    const { data } = await supabase.rpc('get_clients_by_health_category', { p_company_id: companyId });
    window._healthScoresCache = {};
    (Array.isArray(data) ? data : []).forEach(r => { window._healthScoresCache[r.client_id] = r; });
  } catch(e) { console.warn('[loadHealthScoresCache]', e); }
}

function healthBadge(clientId) {
  const h = window._healthScoresCache?.[clientId];
  if (!h) return '<span style="font-size:10px;color:var(--t3)">—</span>';
  const cfg = {
    PLATINUM: { color:'#22c55e', bg:'rgba(34,197,94,.12)',  border:'rgba(34,197,94,.3)',  dot:'<svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="#22c55e"/></svg>' },
    GOOD:     { color:'#3b82f6', bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.3)', dot:'<svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="#3b82f6"/></svg>' },
    'AT RISK':{ color:'#f59e0b', bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.3)', dot:'<svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="#f59e0b"/></svg>' },
    CRITICAL: { color:'#ef4444', bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.3)',  dot:'<svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="#ef4444"/></svg>' },
  };
  const c = cfg[h.category] || cfg['AT RISK'];
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${c.bg};color:${c.color};border:1px solid ${c.border}">${c.dot}${h.score}</span>`;
}

// ── Country flags ──────────────────────────────────────────
const CF_FLAGS = {
  Pakistan:'🇵🇰', UAE:'🇦🇪', USA:'🇺🇸', UK:'🇬🇧', 'Saudi Arabia':'🇸🇦',
  Qatar:'🇶🇦', Kuwait:'🇰🇼', Bahrain:'🇧🇭', Oman:'🇴🇲', Canada:'🇨🇦',
  Australia:'🇦🇺', Germany:'🇩🇪', France:'🇫🇷', Turkey:'🇹🇷', India:'🇮🇳',
  China:'🇨🇳', Bangladesh:'🇧🇩', Philippines:'🇵🇭', Malaysia:'🇲🇾',
  Afghanistan:'🇦🇫', Egypt:'🇪🇬', Morocco:'🇲🇦', Indonesia:'🇮🇩'
};

// ── Helpers ────────────────────────────────────────────────
function cStatusBadge(status) {
  const map = {
    active:      ['var(--ok)',   'Active'],
    inactive:    ['var(--t3)',   'Inactive'],
    blacklisted: ['var(--err)',  'Blacklisted']
  };
  const [color, label] = map[status] || ['var(--t3)', status || '?'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>`;
}

function cCategoryIcon(cat) {
  const icons = {
    Individual:'<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    Investor:  '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    Corporate: '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01"/></svg>',
    NRI:       '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.52 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.44 1.18l3-.01a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>',
    VIP:       '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
  };
  return icons[cat] || icons.Individual;
}

function genClientCode(companyId) {
  const year = new Date().getFullYear();
  const existing = (window._clientsCache || []).filter(c => c.companyId === companyId).map(c => c.clientCode || '');
  let seq = 1;
  while (existing.includes(`CLT-${year}-${String(seq).padStart(4,'0')}`)) seq++;
  return `CLT-${year}-${String(seq).padStart(4,'0')}`;
}

// ══ CLIENTS LIST PAGE ══════════════════════════════════════

function rClients() {
  const cid = S?.cid;
  if (!cid) {
    document.getElementById('pg-clients').innerHTML =
      `<div class="inv-empty" style="padding:60px"><div class="inv-empty-ic">${_UI.user}</div><h4>No company selected</h4></div>`;
    return;
  }
  loadHealthScoresCache(cid).then(() => rCLF());
  const isA   = S.role === 'admin' || S.role === 'owner';
  const all   = gclients();
  const total = all.length;
  const active      = all.filter(c => c.status === 'active').length;
  const inactive    = all.filter(c => c.status === 'inactive').length;
  const blacklisted = all.filter(c => c.status === 'blacklisted').length;

  const _catLabel = _cCategoryFilter || '';
  const _hlthLabel = _cHealthFilter || '';

  const kpiTiles = [
    { key:'',            color:'var(--primary)', val:total,       sub:'all clients',      label:'All Clients' },
    { key:'active',      color:'var(--success)', val:active,      sub:'currently active', label:'Active'      },
    { key:'inactive',    color:'#64748B',        val:inactive,    sub:'not active',       label:'Inactive'    },
    { key:'blacklisted', color:'var(--danger)',  val:blacklisted, sub:'flagged clients',  label:'Blacklisted' },
  ];

  document.getElementById('pg-clients').innerHTML = `<div class="inv-page ani module-client">

  <!-- Breadcrumb -->
  <div class="inv-breadcrumb">
    <span class="lnk" onclick="nav('dashboard')">Home</span>
    <span style="opacity:.4">${_UI.chevR}</span>
    <span style="color:var(--text-soft)">Clients</span>
  </div>

  <!-- Page Header -->
  <div class="inv-ph-row">
    <h1 class="inv-title">All Clients</h1>
    <div class="inv-ph-actions">
      <button class="btn btn-gh btn-sm" onclick="printClientsList()" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px">${_UI.printer} Print</button>
      ${isA ? `<button id="um-add-client-btn" class="btn btn-g btn-sm" onclick="openClientModal(null)" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px">${_UI.plus} Add Client</button>` : ''}
    </div>
  </div>

  <!-- KPI Filter Tiles -->
  <div class="inv-kpi-grid">
    ${kpiTiles.map(t => `
    <div class="inv-kpi-tile${_cStatusFilter===t.key?' active':''}" style="--kpi-color:${t.color}"
         onclick="setCStatusFilter('${t.key}')">
      <div class="inv-kpi-tile-top">
        <div class="inv-kpi-icon">${_UI.user}</div>
        <span class="inv-kpi-label">${t.label.toUpperCase()}</span>
      </div>
      <div class="inv-kpi-bottom">
        <div class="inv-kpi-value">${t.val}</div>
        <div class="inv-kpi-sub">${t.sub}</div>
      </div>
      ${_cStatusFilter===t.key&&t.key?`<button class="inv-kpi-clear" onclick="event.stopPropagation();setCStatusFilter('')" title="Clear filter">${_UI.xsm}</button>`:''}
    </div>`).join('')}
  </div>

  <!-- Filter Toolbar -->
  <div class="inv-toolbar">
    <div class="inv-search-wrap">
      <span class="inv-search-icon">${_UI.search}</span>
      <input class="inv-search-inp" id="c-s" placeholder="Name, CNIC, phone, email, code..."
             value="${esc(_cs)}" oninput="setCS(this.value)" autocomplete="off">
      <span class="inv-search-cmd">⌘K</span>
    </div>
    <button class="inv-fc${_catLabel?' active':''}" id="cl-fc-cat" onclick="_clFCDropdown('cat',this)">
      ${_UI.tag}
      <span class="inv-fc-label">Category</span>
      ${_catLabel ? `<span class="inv-fc-val">${esc(_catLabel)}</span>` : `<span class="inv-fc-cv">All</span>`}
      ${_UI.chevD}
    </button>
    <button class="inv-fc${_hlthLabel?' active':''}" id="cl-fc-hlth" onclick="_clFCDropdown('health',this)">
      ${_UI.activity}
      <span class="inv-fc-label">Health</span>
      ${_hlthLabel ? `<span class="inv-fc-val">${esc(_hlthLabel)}</span>` : `<span class="inv-fc-cv">All</span>`}
      ${_UI.chevD}
    </button>
    <div class="inv-view-toggle">
      <button class="inv-view-btn${_cView==='cards'?' on':''}" onclick="setCView('cards')" title="Card view">${_UI.grid}</button>
      <button class="inv-view-btn${_cView==='table'?' on':''}" onclick="setCView('table')" title="Table view">${_UI.list}</button>
    </div>
  </div>

  <!-- Active Filters Bar -->
  <div class="inv-af-bar" id="cl-af-bar"></div>

  <div id="cl-ct"></div>
  <div class="inv-pager" id="cl-pager"></div>
</div>`;

  _clRenderAFBar();
  rCLF();
  _checkClientLimitUI();
}

async function _checkClientLimitUI() {
  const btn = document.getElementById('um-add-client-btn');
  if (!btn) return;
  try {
    const { data, error } = await supabase.rpc('get_clients_plan_status', { p_company_id: S.cid });
    if (error || !data) return;
    const maxClients     = data.max_allowed ?? 0;
    const currentClients = data.current_count ?? 0;
    if (maxClients > 0 && currentClients >= maxClients) {
      btn.disabled    = true;
      btn.title       = `Client limit reached (${currentClients}/${maxClients}). Upgrade your plan to add more.`;
      btn.textContent = `+ Add Client (${currentClients}/${maxClients})`;
    }
  } catch(e) { /* UI hint only — not blocking */ }
}

function _clFCDropdown(type, btn) {
  _invCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'inv-dd'; dd.id = 'inv-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  let items = '';
  if (type === 'cat') {
    const cats = ['Individual','Investor','Corporate','NRI','VIP'];
    const icons = { Individual:'', Investor:'', Corporate:'', NRI:'', VIP:'' };
    items = `<div class="inv-dd-chk" onclick="_invCloseDD();setCCategoryFilter('')"><input type="checkbox" ${!_cCategoryFilter?'checked':''} readonly> All Categories</div>` +
      cats.map(c => `<div class="inv-dd-chk" onclick="_invCloseDD();setCCategoryFilter('${c}')"><input type="checkbox" ${_cCategoryFilter===c?'checked':''} readonly> ${icons[c]||''} ${c}</div>`).join('');
  } else if (type === 'health') {
    const hs = [['PLATINUM','Platinum'],['GOOD','Good'],['AT RISK','At Risk'],['CRITICAL','Critical']];
    items = `<div class="inv-dd-chk" onclick="_invCloseDD();setCHealthFilter('')"><input type="checkbox" ${!_cHealthFilter?'checked':''} readonly> All Health</div>` +
      hs.map(([v,l]) => `<div class="inv-dd-chk" onclick="_invCloseDD();setCHealthFilter('${v}')"><input type="checkbox" ${_cHealthFilter===v?'checked':''} readonly> ${l}</div>`).join('');
  }
  dd.innerHTML = `<div class="inv-dd-hd">${type === 'cat' ? 'CATEGORY' : 'CLIENT HEALTH'}</div>${items}`;
  document.body.appendChild(dd);
  _invDD = dd;
  _invArmOutsideClose(btn);
}

function _clRenderAFBar() {
  const bar = document.getElementById('cl-af-bar');
  if (!bar) return;
  const chips = [];
  if (_cStatusFilter)   chips.push([`Status: ${_cStatusFilter}`,   () => setCStatusFilter('')]);
  if (_cCategoryFilter) chips.push([`Category: ${_cCategoryFilter}`, () => setCCategoryFilter('')]);
  if (_cHealthFilter)   chips.push([`Health: ${_cHealthFilter}`,   () => setCHealthFilter('')]);
  bar.innerHTML = chips.length
    ? chips.map(([lbl, fn], i) =>
        `<span class="inv-af-chip" onclick="_clAFRemove(${i})">${esc(lbl)} ${_UI.xsm}</span>`
      ).join('') + (chips.length>1?`<button class="inv-af-clear" onclick="_clAFClearAll()">Clear all</button>`:'')
    : '';
  bar._chips = chips;
}
function _clAFRemove(i) { const fn = document.getElementById('cl-af-bar')?._chips?.[i]?.[1]; if(fn) fn(); }
function _clAFClearAll() { _cStatusFilter=''; _cCategoryFilter=''; _cHealthFilter=''; _cPage=1; rClients(); }

function setCS(q)               { _cs = q;              _cPage = 1; rCLF(); }
function setCStatusFilter(v)    { _cStatusFilter = v;   _cPage = 1; rClients(); }
function setCCategoryFilter(v)  { _cCategoryFilter = v; _cPage = 1; _clRenderAFBar(); rCLF(); }
function setCHealthFilter(v)    { _cHealthFilter = v;   _cPage = 1; _clRenderAFBar(); rCLF(); }
function setCView(v) {
  _cView = v;
  localStorage.setItem('nxn_cl_view', v);
  document.querySelectorAll('.inv-view-btn').forEach(b => b.classList.remove('on'));
  const active = document.querySelector(`.inv-view-btn[onclick*="${v}"]`);
  if (active) active.classList.add('on');
  rCLF();
}

function rCLF() {
  const ct = document.getElementById('cl-ct');
  const pg = document.getElementById('cl-pager');
  const countEl = document.getElementById('cl-count');
  if (!ct) return;

  const isA = S.role === 'admin' || S.role === 'owner';
  let clients = gclients().map(c => ({...c}));

  if (_cStatusFilter)   clients = clients.filter(c => c.status         === _cStatusFilter);
  if (_cCategoryFilter) clients = clients.filter(c => c.clientCategory === _cCategoryFilter);
  if (_cHealthFilter)   clients = clients.filter(c => (window._healthScoresCache?.[c.id]?.category) === _cHealthFilter);

  if (_cs) {
    const q = _cs.toLowerCase();
    clients = clients.filter(c =>
      c.fullName.toLowerCase().includes(q) ||
      (c.cnic         || '').toLowerCase().includes(q) ||
      (c.phonePrimary || '').includes(q) ||
      (c.email        || '').toLowerCase().includes(q) ||
      (c.clientCode   || '').toLowerCase().includes(q) ||
      (c.city         || '').toLowerCase().includes(q)
    );
  }

  if (countEl) countEl.textContent = clients.length + (clients.length === 1 ? ' client' : ' clients');

  if (!clients.length) {
    ct.innerHTML = `<div class="inv-empty"><span class="inv-empty-ic">${_UI.user}</span><p class="inv-empty-tx">No clients found</p><p class="inv-empty-sub">Try adjusting filters or add a new client</p></div>`;
    if (pg) pg.innerHTML = '';
    return;
  }

  // Pagination
  const totalPages = Math.ceil(clients.length / _C_PER_PAGE);
  if (_cPage > totalPages) _cPage = totalPages;
  const sliced = clients.slice((_cPage - 1) * _C_PER_PAGE, _cPage * _C_PER_PAGE);

  const _clrPal = ['#6366f1','#8b5cf6','#ec4899','#06b6d4','#10b981','#f59e0b','#f97316','#3b82f6'];
  const _hlthClrMap = { PLATINUM:'#22c55e', GOOD:'#3b82f6', 'AT RISK':'#f59e0b', CRITICAL:'#ef4444' };

  if (_cView === 'cards') {
    ct.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">` +
      sliced.map(c => {
        const clrIdx = c.fullName.split('').reduce((a,ch)=>a+ch.charCodeAt(0),0) % _clrPal.length;
        const clr = _clrPal[clrIdx];
        const initials = (c.fullName||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
        const flag = CF_FLAGS[c.country] || '';
        const hlth = window._healthScoresCache?.[c.id];
        const hlthClr = hlth ? (_hlthClrMap[hlth.category] || 'var(--t3)') : null;
        return `<div onclick="openClientDetail('${c.id}')" style="background:var(--surface);border-radius:14px;border:1px solid var(--line);padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:10px;transition:box-shadow 180ms,transform 180ms;box-shadow:0 2px 8px rgba(0,0,0,.07)"
          onmouseover="this.style.boxShadow='0 0 0 1.5px ${clr},0 6px 20px ${clr}22';this.style.transform='translateY(-2px)'"
          onmouseout="this.style.boxShadow='0 2px 8px rgba(0,0,0,.07)';this.style.transform=''">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,${clr},${clr}bb);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;flex-shrink:0;letter-spacing:-.5px">${initials}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${flag?flag+' ':''}${esc(c.fullName||'Unnamed')}</div>
              <div style="font-size:10px;font-family:monospace;color:var(--t3);margin-top:1px">${esc(c.clientCode||'—')}</div>
            </div>
            ${isA?`<button onclick="event.stopPropagation();openClientModal('${c.id}')" style="padding:4px 8px;background:var(--surface2);border:1px solid var(--line);color:var(--t3);border-radius:7px;font-size:11px;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`:''}
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            ${c.clientCategory?`<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:${clr}18;color:${clr};border:1px solid ${clr}33">${cCategoryIcon(c.clientCategory)} ${esc(c.clientCategory)}</span>`:''}
            ${cStatusBadge(c.status)}
            ${hlth&&hlthClr?`<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${hlthClr}18;color:${hlthClr};border:1px solid ${hlthClr}33">${hlth.score}</span>`:''}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;padding-top:8px;border-top:1px solid var(--line)">
            ${c.phonePrimary?`<div style="display:flex;align-items:center;gap:7px;font-size:12px"><svg width="11" height="11" fill="none" stroke="var(--t3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.52 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.44 1.18l3-.01a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg><a href="tel:${esc(c.phonePrimary)}" onclick="event.stopPropagation()" style="color:var(--info);text-decoration:none">${esc(c.phonePrimary)}</a></div>`:''}
            ${c.email?`<div style="display:flex;align-items:center;gap:7px;font-size:12px;min-width:0"><svg width="11" height="11" fill="none" stroke="var(--t3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()" style="color:var(--info);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.email)}</a></div>`:''}
            ${c.city||c.country?`<div style="font-size:11px;color:var(--t3)">${flag} ${[c.city,c.country].filter(Boolean).join(', ')}</div>`:''}
          </div>
          ${c.cnic?`<div style="font-size:10px;font-family:monospace;color:var(--t3);padding-top:6px;border-top:1px solid var(--line)">CNIC: ${esc(c.cnic)}</div>`:''}
        </div>`;
      }).join('') + `</div>`;
  } else {
    ct.innerHTML = `<div class="tw">
    <table class="t" style="width:100%">
      <thead>
        <tr>
          <th>Code</th>
          <th>Name</th>
          <th class="hide-sm">CNIC</th>
          <th class="hide-sm">Phone</th>
          <th class="hide-sm">City</th>
          <th class="hide-sm">Category</th>
          <th>Status</th>
          <th class="hide-sm">Health</th>
          ${isA ? '<th style="width:50px"></th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${sliced.map(c => {
          const flag = CF_FLAGS[c.country] || '';
          return `<tr style="cursor:pointer" onclick="openClientDetail('${c.id}')">
            <td style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(c.clientCode||'—')}</td>
            <td style="font-weight:700">${flag ? flag+' ' : ''}${esc(c.fullName||'Unnamed')}</td>
            <td class="hide-sm" style="font-family:monospace;font-size:12px;color:var(--t2)">${esc(c.cnic||'—')}</td>
            <td class="hide-sm" style="font-size:12px">${c.phonePrimary ? `<a href="tel:${esc(c.phonePrimary)}" onclick="event.stopPropagation()" style="color:var(--info);text-decoration:none">${esc(c.phonePrimary)}</a>` : '—'}</td>
            <td class="hide-sm" style="font-size:12px;color:var(--t3)">${esc(c.city||'—')}</td>
            <td class="hide-sm" style="font-size:12px">${c.clientCategory ? cCategoryIcon(c.clientCategory)+' '+esc(c.clientCategory) : '—'}</td>
            <td>${cStatusBadge(c.status)}</td>
            <td class="hide-sm">${healthBadge(c.id)}</td>
            ${isA ? `<td onclick="event.stopPropagation()">
              <button class="btn btn-gh btn-xs" onclick="openClientModal('${c.id}')">✏</button>
            </td>` : ''}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
  }

  // Pager
  if (pg) {
    if (totalPages <= 1) { pg.innerHTML = ''; return; }
    let html = '';
    if (_cPage > 1) html += `<button class="inv-pg-btn" onclick="_cPage--;rCLF()">← Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="inv-pg-btn${i===_cPage?' on':''}" onclick="_cPage=${i};rCLF()">${i}</button>`;
    }
    if (_cPage < totalPages) html += `<button class="inv-pg-btn" onclick="_cPage++;rCLF()">Next →</button>`;
    pg.innerHTML = html;
  }
}

// ══ PRINT CLIENTS LIST ════════════════════════════════════

function printClientsList() {
  let clients = gclients().map(c => ({...c}));

  if (_cStatusFilter)   clients = clients.filter(c => c.status         === _cStatusFilter);
  if (_cCategoryFilter) clients = clients.filter(c => c.clientCategory === _cCategoryFilter);
  if (_cs) {
    const q = _cs.toLowerCase();
    clients = clients.filter(c =>
      c.fullName.toLowerCase().includes(q) ||
      (c.cnic         || '').toLowerCase().includes(q) ||
      (c.phonePrimary || '').includes(q) ||
      (c.email        || '').toLowerCase().includes(q) ||
      (c.clientCode   || '').toLowerCase().includes(q) ||
      (c.city         || '').toLowerCase().includes(q)
    );
  }

  const filters = [];
  if (_cStatusFilter)   filters.push(`Status: ${_cStatusFilter}`);
  if (_cCategoryFilter) filters.push(`Category: ${_cCategoryFilter}`);
  if (_cs)              filters.push(`Search: "${_cs}"`);

  const w = _pw('Clients List — Nexunova RMS', _pCSS('A4'));
  if (!w) return;
  w.document.write(`
    ${_lh('CLIENT LIST')}
    <h2 style="font-size:17px;font-weight:700;margin:0 0 4px">Clients</h2>
    <p style="font-size:11px;color:#555;margin:0 0 ${filters.length ? '6' : '14'}px">
      ${clients.length} client${clients.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Printed: ${new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})}
    </p>
    ${filters.length ? `<p style="font-size:11px;color:#666;background:#f5f7fa;padding:5px 10px;border-radius:4px;margin-bottom:14px">
      Filters: ${filters.join(' &nbsp;|&nbsp; ')}
    </p>` : ''}
    <table>
      <thead><tr>
        <th>Code</th>
        <th>Full Name</th>
        <th>CNIC</th>
        <th>Phone</th>
        <th>City</th>
        <th>Category</th>
        <th>Status</th>
      </tr></thead>
      <tbody>
        ${clients.map(c => `<tr>
          <td style="font-family:monospace;font-size:10px;color:#666">${c.clientCode || '—'}</td>
          <td style="font-weight:700">${c.fullName || 'Unnamed'}</td>
          <td style="font-family:monospace;font-size:10px">${c.cnic || '—'}</td>
          <td>${c.phonePrimary || '—'}</td>
          <td>${c.city || '—'}</td>
          <td>${c.clientCategory || '—'}</td>
          <td>${c.status || '—'}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="5" style="font-weight:700;color:#1E2D47">Total: ${clients.length} clients</td>
        <td colspan="2" style="text-align:right;font-size:10px;color:#555">Nexunova RMS</td>
      </tr></tfoot>
    </table>
  `);
  _pclose(w);
}

// ══ CLIENT 360° DETAIL ════════════════════════════════════

function openClientDetail(id) { _cid = id; nav('clientdetail'); }

function rClientDetail() {
  const clientId = _cid;
  if (!clientId) { nav('clients'); return; }
  const c = gclient(clientId);
  if (!c) { nav('clients'); return; }

  const isA  = S.role === 'admin' || S.role === 'owner';
  const flag = CF_FLAGS[c.country] || '';

  // Units linked via legacy customerName matching (until Sales module is built)
  const allUnits = gunits();
  const myUnits  = allUnits.filter(u =>
    u.clientId === clientId ||
    (c.fullName && u.customerName && u.customerName.toLowerCase() === c.fullName.toLowerCase())
  );
  const totalPortfolio = myUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const totalPaid      = myUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
  const outstanding    = Math.max(0, totalPortfolio - totalPaid);
  const recovPct       = totalPortfolio > 0 ? Math.min(100, Math.round(totalPaid / totalPortfolio * 100)) : 0;

  const row = (l, v) => v ? `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>` : '';

  document.getElementById('pg-clientdetail').innerHTML = `<div class="ani">
    <!-- Form navigation bar -->
    <div id="cd-form-nav"></div>

    <!-- Header actions -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="nav('clients')">← Back</button>
      <button class="btn btn-print btn-sm" onclick="printClientDetail()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
      <button class="btn btn-sm" onclick="openLedgerReport('${clientId}')" style="background:#1e2d47;color:#fff;border:1px solid #1e2d47;display:inline-flex;align-items:center;gap:5px" title="A4 Account Ledger"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>A4 Ledger</button>
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="openClientModal('${clientId}')" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>` : ''}
      ${isA && c.status !== 'inactive'    ? `<button class="btn btn-d btn-sm" onclick="setClientStatus('${clientId}','inactive')" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Deactivate</button>`    : ''}
      ${isA && c.status !== 'blacklisted' ? `<button class="btn btn-r btn-sm" onclick="setClientStatus('${clientId}','blacklisted')" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Blacklist</button>`   : ''}
      ${isA && c.status !== 'active'      ? `<button class="btn btn-g btn-sm" onclick="setClientStatus('${clientId}','active')" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Reactivate</button>`       : ''}
    </div>

    <!-- Hero card -->
    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:flex-start;gap:14px">
            ${c.clientPhotoUrl ? `<img src="${esc(c.clientPhotoUrl)}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--line);flex-shrink:0" onerror="this.style.display='none'">` : ''}
            <div>
              <div style="font-size:10px;color:var(--t3);font-family:monospace;margin-bottom:4px">${esc(c.clientCode)}</div>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;flex-wrap:wrap">
                <h2 style="font-size:22px;font-weight:700">${flag} ${esc(c.fullName||'Unnamed')}</h2>
                ${cStatusBadge(c.status)}
                ${c.clientCategory ? `<span style="font-size:11px;background:var(--canvas);padding:2px 8px;border-radius:20px;border:1px solid var(--line)">${cCategoryIcon(c.clientCategory)} ${esc(c.clientCategory)}</span>` : ''}
                ${c.overseasLocal === 'overseas' ? `<span style="font-size:11px;background:rgba(99,102,241,.15);color:#818cf8;padding:2px 8px;border-radius:20px;border:1px solid rgba(99,102,241,.3)">Overseas</span>` : ''}
              </div>
              ${c.cnic ? `<div style="font-size:12px;color:var(--t3);font-family:monospace">CNIC: ${esc(c.cnic)}</div>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap" class="no-p">
            ${c.phonePrimary ? `<a href="tel:${esc(c.phonePrimary)}" class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.52 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.44 1.18l3-.01a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>Call</a>` : ''}
            ${(c.whatsapp||c.phonePrimary) ? `<a href="https://wa.me/${(c.whatsapp||c.phonePrimary).replace(/[^0-9]/g,'')}" target="_blank" class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>WhatsApp</a>` : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}" class="btn btn-gh btn-sm" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>Email</a>` : ''}
          </div>
        </div>

        ${totalPortfolio > 0 ? `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="font-size:11px;color:var(--t3)">Units<br><span style="font-size:15px;font-weight:700;color:var(--t1)">${myUnits.length}</span></div>
          <div style="font-size:11px;color:var(--t3)">Portfolio<br><span style="font-size:15px;font-weight:700;color:var(--t1)">${fM(totalPortfolio)}</span></div>
          <div style="font-size:11px;color:var(--t3)">Paid<br><span style="font-size:15px;font-weight:700;color:var(--ok)">${fM(totalPaid)}</span></div>
          <div style="font-size:11px;color:var(--t3)">Outstanding<br><span style="font-size:15px;font-weight:700;color:${outstanding>0?'var(--err)':'var(--ok)'}">${outstanding>0?fM(outstanding):'Nil'}</span></div>
          <div style="font-size:11px;color:var(--t3)">Recovery<br><span style="font-size:15px;font-weight:700;color:var(--t1)">${recovPct}%</span></div>
        </div>
        <div style="margin-top:10px">
          <div class="pbar" style="width:100%;height:6px"><div class="pbar-f" style="width:${recovPct}%"></div></div>
        </div>` : ''}
      </div>
    </div>

    <!-- Tab strip -->
    <div style="display:flex;border-bottom:2px solid var(--line);margin-bottom:14px">
      <button id="cd-tab-overview-btn" onclick="cdSwitchTab('overview')"
        style="padding:8px 18px;border:none;border-bottom:2px solid var(--brand);margin-bottom:-2px;background:none;font-size:13px;font-weight:700;color:var(--brand);cursor:pointer;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Overview</button>
      <button id="cd-tab-ledger-btn" onclick="cdSwitchTab('ledger')"
        style="padding:8px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>Ledger</button>
      <button id="cd-tab-health-btn" onclick="cdSwitchTab('health')"
        style="padding:8px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>Health Score</button>
      <button id="cd-tab-promises-btn" onclick="cdSwitchTab('promises')"
        style="padding:8px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Promises</button>
      <button id="cd-tab-paylinks-btn" onclick="cdSwitchTab('paylinks')"
        style="padding:8px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Payment Links</button>
      ${(S.role==='admin'||S.role==='owner')?`<button id="cd-tab-history-btn" onclick="cdSwitchTab('history')"
        style="padding:8px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>History</button>`:''}
    </div>

    <div id="cd-tab-overview">
    <div class="cd">
      <!-- Left column: Personal info -->
      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Personal Info</h3></div>
          <div class="cb">
            ${row('Full Name',    esc(c.fullName||'—'))}
            ${row('Father Name',  c.fatherName ? esc(c.fatherName) : null)}
            ${row('CNIC',         c.cnic ? `<span style="font-family:monospace">${esc(c.cnic)}</span>` : null)}
            ${row('Passport',     c.passportNo ? esc(c.passportNo) : null)}
            ${row('Resident',     c.overseasLocal === 'overseas' ? 'Overseas (NICOP)' : 'Local (CNIC)')}
            ${row('Category',     c.clientCategory ? cCategoryIcon(c.clientCategory)+' '+esc(c.clientCategory) : null)}
            ${row('Lead Source',  c.leadSource ? esc(c.leadSource) : null)}
            ${row('Occupation',   c.occupation ? esc(c.occupation) : null)}
            ${row('Company',      c.companyName ? esc(c.companyName) : null)}
            ${row('Referred By',  c.referenceBy ? esc(c.referenceBy) : null)}
            ${row('Created',      c.createdAt ? fD(c.createdAt.slice(0,10)) : null)}
          </div>
        </div>

        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.52 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.44 1.18l3-.01a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>Contact</h3></div>
          <div class="cb">
            ${row('Phone',    c.phonePrimary ? `<a href="tel:${esc(c.phonePrimary)}" style="color:var(--info);text-decoration:none">${esc(c.phonePrimary)}</a>` : null)}
            ${row('Phone 2',  c.phoneSecondary ? esc(c.phoneSecondary) : null)}
            ${row('WhatsApp', c.whatsapp ? `<a href="https://wa.me/${c.whatsapp.replace(/[^0-9]/g,'')}" target="_blank" style="color:var(--ok);text-decoration:none;display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${esc(c.whatsapp)}</a>` : null)}
            ${row('Email',    c.email ? `<a href="mailto:${esc(c.email)}" style="color:var(--info);text-decoration:none">${esc(c.email)}</a>` : null)}
          </div>
        </div>

        ${c.address || c.city ? `
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Address</h3></div>
          <div class="cb">
            ${row('Address', c.address ? esc(c.address) : null)}
            ${row('City',    c.city    ? esc(c.city)    : null)}
            ${row('Country', c.country ? esc(c.country) : null)}
          </div>
        </div>` : ''}

        ${c.cnicFrontUrl || c.cnicBackUrl ? `
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/><line x1="14" y1="15" x2="18" y2="15"/></svg>KYC Documents</h3></div>
          <div class="cb">
            ${c.cnicFrontUrl ? `<div style="margin-bottom:10px">
              <div style="font-size:11px;color:var(--t3);margin-bottom:5px">CNIC Front</div>
              <a href="${esc(c.cnicFrontUrl)}" target="_blank"><img src="${esc(c.cnicFrontUrl)}" style="max-width:100%;border-radius:var(--rm);border:1px solid var(--line)" onerror="this.parentElement.innerHTML='<span style=color:var(--t3)>Could not load image</span>'"></a>
            </div>` : ''}
            ${c.cnicBackUrl ? `<div>
              <div style="font-size:11px;color:var(--t3);margin-bottom:5px">CNIC Back</div>
              <a href="${esc(c.cnicBackUrl)}" target="_blank"><img src="${esc(c.cnicBackUrl)}" style="max-width:100%;border-radius:var(--rm);border:1px solid var(--line)" onerror="this.parentElement.innerHTML='<span style=color:var(--t3)>Could not load image</span>'"></a>
            </div>` : ''}
          </div>
        </div>` : ''}

        ${c.nextOfKinName || c.nextOfKinPhone ? `
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Next of Kin / Nominee</h3></div>
          <div class="cb">
            ${row('Name',     c.nextOfKinName     ? esc(c.nextOfKinName)     : null)}
            ${row('Relation', c.nextOfKinRelation ? esc(c.nextOfKinRelation) : null)}
            ${row('Phone',    c.nextOfKinPhone ? `<a href="tel:${esc(c.nextOfKinPhone)}" style="color:var(--info);text-decoration:none">${esc(c.nextOfKinPhone)}</a>` : null)}
          </div>
        </div>` : ''}

        ${c.bankName || c.bankAccountNo ? `
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>Bank Account</h3></div>
          <div class="cb">
            ${row('Bank',     c.bankName         ? esc(c.bankName)         : null)}
            ${row('Title',    c.bankAccountTitle ? esc(c.bankAccountTitle) : null)}
            ${row('A/C No',   c.bankAccountNo    ? `<span style="font-family:monospace">${esc(c.bankAccountNo)}</span>` : null)}
            ${row('IBAN',     c.bankIban         ? `<span style="font-family:monospace">${esc(c.bankIban)}</span>`     : null)}
          </div>
        </div>` : ''}

        ${c.notes ? `
        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Notes</h3></div>
          <div class="cb"><p style="font-size:12px;color:var(--t2);line-height:1.6;margin:0">${esc(c.notes)}</p></div>
        </div>` : ''}
      </div>

      <!-- Right column: Units + financial -->
      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><div><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01"/></svg>Units Owned</h3><p>${myUnits.length} unit(s)</p></div></div>
          ${!myUnits.length
            ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01"/></svg></div><div class="et">No units linked</div><div class="es">Units will appear here when linked via the Sales module</div></div>`
            : `<div class="ul">` + myUnits.map(u => {
                const paid = actualPaid(u), rem = actualPending(u), p2 = pct(paid, u.totalPrice);
                const prj  = gproject(u.projectId);
                return `<div class="ur" onclick="openUD('${u.id}')">
                  <div class="ur-no">${esc(u.unitNo||'—')}</div>
                  <div style="flex-shrink:0">${uStatusBadge ? uStatusBadge(u.status,u.statusColor) : sbadge(u.status)}</div>
                  <div class="ur-meta">
                    <div class="ur-name">${esc(prj?.projectName||prj?.name||u.type||'—')}</div>
                    <div class="ur-sub">${esc(u.floorLabel||'—')} · ${esc(u.type||'—')} · ${u.area||'—'} ${u.areaUnit||'sqft'}</div>
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

        ${totalPortfolio > 0 ? `
        <div class="card">
          <div class="ch"><h3>Financial Summary</h3></div>
          <div class="cb">
            ${row('Total Portfolio', fMF(totalPortfolio))}
            ${row('Total Paid',      `<span style="color:var(--ok);font-weight:700">${fMF(totalPaid)}</span>`)}
            ${row('Outstanding',     `<span style="color:${outstanding>0?'var(--err)':'var(--ok)'};font-weight:700">${outstanding>0?fMF(outstanding):'Fully Paid'}</span>`)}
            ${row('Recovery %',      `<strong>${recovPct}%</strong>`)}
          </div>
        </div>` : ''}
      </div>
    </div>
    </div><!-- /cd-tab-overview -->
    <div id="cd-tab-ledger" style="display:none">
      <div id="cd-ledger-body"></div>
    </div>
    <div id="cd-tab-health" style="display:none">
      <div id="cd-health-body"><div class="empty" style="padding:28px"><div class="es">Loading…</div></div></div>
    </div>
    <div id="cd-tab-promises" style="display:none">
      <div id="cd-promises-body"><div class="empty" style="padding:28px"><div class="es">Loading…</div></div></div>
    </div>
    <div id="cd-tab-paylinks" style="display:none">
      <div id="cd-paylinks-body"><div class="empty" style="padding:28px"><div class="es">Loading…</div></div></div>
    </div>
    ${(S.role==='admin'||S.role==='owner')?`<div id="cd-tab-history" style="display:none">
      <div id="cd-history-body"><div class="empty" style="padding:28px"><div class="es">Loading…</div></div></div>
    </div>`:''}
  </div>`;

  // Mount the reusable form-nav bar at the top of the client detail page.
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#cd-form-nav',
      entity:    'client',
      dateField: 'createdAt',
      currentId: clientId,
      storageKey:'rms.fnav.client',
      loadList: async () => (window._clientsCache || []).map(x => ({
        id: x.id,
        createdAt: x.createdAt || x.created_at || ''
      })),
      openEntry: (id) => openClientDetail(id),
      onEdit:    (id) => isA && openClientModal(id),
      onDelete:  async () => {
        // Hard delete blocked by design — guide user to Deactivate/Blacklist.
        if (typeof toast === 'function') toast('Use Deactivate or Blacklist instead — clients are never hard-deleted.', 'warn');
      }
    });
  }
}

// ── Client detail tabs ─────────────────────────────────────
function cdSwitchTab(tab) {
  ['overview','ledger','health','promises','paylinks','history'].forEach(t => {
    const div = document.getElementById('cd-tab-'+t);
    const btn = document.getElementById('cd-tab-'+t+'-btn');
    if (div) div.style.display = t === tab ? '' : 'none';
    if (btn) {
      btn.style.color             = t === tab ? 'var(--brand)' : 'var(--t3)';
      btn.style.borderBottomColor = t === tab ? 'var(--brand)' : 'transparent';
      btn.style.fontWeight        = t === tab ? '700' : '600';
    }
  });
  if (tab === 'ledger')   _cdLoadLedger(_cid);
  if (tab === 'health')   _cdLoadHealth(_cid);
  if (tab === 'promises') _cdLoadPromises(_cid);
  if (tab === 'paylinks') _cdLoadPayLinks(_cid);
  if (tab === 'history')  _cdLoadAuditHistory(_cid);
}

async function _cdLoadPayLinks(clientId) {
  const body = document.getElementById('cd-paylinks-body');
  if (!body) return;
  if (body.dataset.loaded === clientId) return;
  body.innerHTML = '<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px">⏳ Loading payment links…</div>';

  try {
    const { data, error } = await supabase.rpc('get_payment_links', {
      p_company_id: S.cid,
      p_client_id:  clientId,
      p_status:     null,
      p_from_date:  null,
      p_to_date:    null,
      p_limit:      100,
      p_offset:     0
    });
    if (error) throw error;

    const rows = data || [];

    const badgeCfg = {
      sent:                ['','Sent',               '#d97706','rgba(245,158,11,.1)'],
      screenshot_received: ['','Screenshot Received','#ea580c','rgba(249,115,22,.1)'],
      verified:            ['','Verified',            '#059669','rgba(16,185,129,.1)'],
      rejected:            ['','Rejected',            '#dc2626','rgba(239,68,68,.1)'],
      expired:             ['⏰','Expired',             '#6b7280','rgba(107,114,128,.1)'],
      cancelled:           ['','Cancelled',           '#6b7280','rgba(107,114,128,.1)'],
    };
    const badge = s => {
      const [ic,lbl,col,bg] = badgeCfg[s] || ['?',s,'var(--t3)','transparent'];
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${bg};color:${col};border:1px solid ${col}44">${ic} ${lbl}</span>`;
    };

    const pending = rows.filter(r => r.status === 'screenshot_received').length;

    const header = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="font-size:12px;color:var(--t3)">${rows.length} link${rows.length!==1?'s':''} total${pending?' · <span style="color:#ea580c;font-weight:700">'+pending+' pending verification</span>':''}</div>
        <button class="btn btn-g btn-sm" onclick="plOpenCreate(null,'${clientId}',null)">New Payment Link</button>
      </div>`;

    if (!rows.length) {
      body.innerHTML = `
        <div style="padding:28px;text-align:center">
          <div style="font-size:32px;margin-bottom:8px"></div>
          <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:4px">No payment links yet</div>
          <div style="font-size:12px;color:var(--t3);margin-bottom:14px">Send a payment request to this client via WhatsApp</div>
          <button class="btn btn-g btn-sm" onclick="plOpenCreate(null,'${clientId}',null)">New Payment Link</button>
        </div>`;
      body.dataset.loaded = clientId;
      return;
    }

    const tableRows = rows.map(r => {
      const date = r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
      let actions = '';
      if (r.status === 'sent') {
        actions = `<button class="btn btn-gh btn-xs" onclick="plResend('${r.id}')">Resend</button>
                   <button class="btn btn-gh btn-xs" onclick="plOpenUpload('${r.id}')">Upload</button>`;
      } else if (r.status === 'screenshot_received') {
        actions = `<button class="btn btn-g btn-xs" onclick="plOpenVerify('${r.id}')">Verify</button>
                   <button class="btn btn-r btn-xs" onclick="plOpenReject('${r.id}')">Reject</button>`;
      } else if (r.status === 'verified') {
        actions = `<button class="btn btn-gh btn-xs" onclick="plOpenDetail('${r.id}')">PRV</button>`;
      } else {
        actions = `<button class="btn btn-gh btn-xs" onclick="plOpenDetail('${r.id}')">View</button>`;
      }
      return `<tr>
        <td style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(r.ref_code||'—')}</td>
        <td style="font-size:12px">${date}${r.days_since_sent>0?`<div style="font-size:10px;color:var(--t3)">${r.days_since_sent}d ago</div>`:''}</td>
        <td style="font-size:12px">${esc(r.unit_number||'—')}<div style="font-size:10px;color:var(--t3)">${esc(r.project_name||'')}</div></td>
        <td style="font-size:13px;font-weight:700;font-family:monospace">PKR ${fM(r.requested_amount)}</td>
        <td>${badge(r.status)}</td>
        <td><div style="display:flex;gap:5px;flex-wrap:wrap">${actions}</div></td>
      </tr>`;
    }).join('');

    body.innerHTML = header + `
      <div class="tw" style="overflow-x:auto">
        <table class="t">
          <thead><tr>
            <th>Ref#</th><th>Date</th><th>Property</th><th>Amount</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
    body.dataset.loaded = clientId;
  } catch(e) {
    body.innerHTML = `<div style="padding:16px;color:var(--err);font-size:12px">${esc(e.message)}</div>`;
  }
}

async function _cdLoadAuditHistory(clientId) {
  const body = document.getElementById('cd-history-body');
  if (!body || typeof openAuditHistory !== 'function') return;
  body.innerHTML = '<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px">⏳ Loading history…</div>';
  try {
    const { data, error } = await supabase.rpc('get_record_history', {
      p_company_id: S.cid,
      p_table_name: 'clients',
      p_record_id:  String(clientId)
    });
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) {
      body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)"><div><svg width="28" height="28" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div><div style="font-size:13px;margin-top:8px">No changes recorded for this client</div></div>';
      return;
    }
    const actionCfg = { INSERT:{col:'#10b981',dot:'',lb:'Created'}, UPDATE:{col:'#f59e0b',dot:'',lb:'Updated'}, DELETE:{col:'#ef4444',dot:'',lb:'Deleted'} };
    const items = [...rows].reverse().map((r,i) => {
      const ac = actionCfg[r.action]||{col:'var(--t3)',dot:'',lb:r.action};
      const flds = Array.isArray(r.changed_fields)&&r.changed_fields.length ? r.changed_fields.slice(0,5).join(', ')+(r.changed_fields.length>5?` +${r.changed_fields.length-5}`:'') : (r.action==='INSERT'?'Record created':'No tracked fields');
      return `<div style="display:flex;gap:12px;padding:10px 0;${i<rows.length-1?'border-bottom:1px solid var(--line)':''}">
        <div style="width:26px;height:26px;border-radius:50%;background:${ac.col}18;border:2px solid ${ac.col}44;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0">${ac.dot}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span style="font-size:12px;font-weight:700;color:${ac.col}">${ac.lb}</span>
            <span style="font-size:10px;color:var(--t3)">${_audFmtTime?_audFmtTime(r.changed_at):r.changed_at}</span>
          </div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">by <b style="color:var(--t2)">${esc(r.changed_by_name||'system')}</b>${r.is_sensitive?' !':''}</div>
          <div style="font-size:11px;font-family:monospace;color:var(--t2);margin-top:2px">${esc(flds)}</div>
        </div>
      </div>`;
    }).join('');
    body.innerHTML = `<div style="padding:0 4px">${items}</div>`;
  } catch(e) {
    body.innerHTML = `<div style="padding:16px;color:var(--err);font-size:12px">${esc(e.message)}</div>`;
  }
}

async function _cdLoadHealth(clientId) {
  const body = document.getElementById('cd-health-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px">⏳ Calculating…</div>';

  const { data, error } = await supabase.rpc('calculate_client_health_score', {
    p_company_id: S.cid,
    p_client_id:  clientId
  });

  if (error || !data?.success) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load health score</div><div class="es">${esc(error?.message||'Error')}</div></div></div>`;
    return;
  }

  const score = data.score;
  const cat   = data.category;
  const bd    = data.breakdown || {};
  const exp   = data.exposure  || 0;
  const last  = new Date().toLocaleString();

  const catCfg = {
    PLATINUM: { color:'#22c55e', bg:'rgba(34,197,94,.12)',  border:'rgba(34,197,94,.3)',  emoji:'', label:'PLATINUM'  },
    GOOD:     { color:'#3b82f6', bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.3)', emoji:'', label:'GOOD'      },
    'AT RISK':{ color:'#f59e0b', bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.3)', emoji:'', label:'AT RISK'   },
    CRITICAL: { color:'#ef4444', bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.3)',  emoji:'', label:'CRITICAL'  },
  };
  const cc = catCfg[cat] || catCfg['AT RISK'];

  // Score ring (SVG)
  const r = 42, circ = 2 * Math.PI * r;
  const dash = ((100 - score) / 100) * circ;
  const ring = `<svg width="110" height="110" viewBox="0 0 110 110">
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--line)" stroke-width="10"/>
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="${cc.color}" stroke-width="10"
      stroke-dasharray="${circ}" stroke-dashoffset="${dash}"
      stroke-linecap="round" transform="rotate(-90 55 55)"/>
    <text x="55" y="58" text-anchor="middle" font-size="20" font-weight="800" fill="${cc.color}">${score}</text>
    <text x="55" y="72" text-anchor="middle" font-size="8" fill="var(--t3)">/ 100</text>
  </svg>`;

  const bLine = (emoji, label, val, color='var(--t1)') => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)">
      <span style="font-size:12px;color:var(--t2)">${emoji} ${label}</span>
      <span style="font-size:13px;font-weight:700;color:${color}">${val}</span>
    </div>`;

  // Update cache
  if (!window._healthScoresCache) window._healthScoresCache = {};
  window._healthScoresCache[clientId] = { score, category: cat, total_exposure: exp };

  body.innerHTML = `
    <div class="cd">
      <!-- Left: score ring + category -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="ch"><h3>Health Score</h3></div>
          <div class="cb" style="text-align:center">
            ${ring}
            <div style="margin-top:8px">
              <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:800;padding:5px 14px;border-radius:20px;background:${cc.bg};color:${cc.color};border:1px solid ${cc.border}">${cc.emoji} ${cc.label}</span>
            </div>
            ${exp > 0 ? `<div style="margin-top:10px;font-size:12px;color:var(--t3)">Exposure: <strong style="color:var(--err)">${fM(exp)}</strong></div>` : ''}
            <div style="margin-top:8px;font-size:10px;color:var(--t3)">Last calculated: ${last}</div>
            <button class="btn btn-gh btn-sm" style="margin-top:12px" onclick="_cdLoadHealth('${clientId}')">Recalculate</button>
          </div>
        </div>

        <div class="card">
          <div class="ch"><h3>Score Breakdown</h3></div>
          <div class="cb">
            ${bLine('','On-time payments', bd.on_time_payments||0, 'var(--ok)')}
            ${bLine('','Late payments',     bd.late_payments||0,    'var(--err)')}
            ${bLine('','Calls answered',    bd.answered_calls||0,   'var(--ok)')}
            ${bLine('','Calls missed',      bd.missed_calls||0,     'var(--err)')}
            ${bLine('','Promises kept',     bd.kept_promises||0,    'var(--ok)')}
            ${bLine('','Promises broken',   bd.broken_promises||0,  'var(--err)')}
            ${bLine('','PDC bounces',       bd.pdc_bounces||0,      bd.pdc_bounces>0?'var(--err)':'var(--t3)')}
            ${bLine('','Active legal cases', bd.legal_active_cases||0, bd.legal_active_cases>0?'var(--err)':'var(--t3)')}
            <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:4px">
              <span style="font-size:12px;color:var(--ok);font-weight:600">+ Points added</span>
              <span style="font-weight:700;color:var(--ok)">+${bd.points_added||0}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding-bottom:8px;border-bottom:2px solid var(--line)">
              <span style="font-size:12px;color:var(--err);font-weight:600">− Points deducted</span>
              <span style="font-weight:700;color:var(--err)">-${bd.points_deducted||0}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0">
              <span style="font-size:12px;font-weight:700">Final Score (Base 50)</span>
              <span style="font-size:15px;font-weight:800;color:${cc.color}">${score}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: scoring guide -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="ch"><h3>Scoring Rules</h3></div>
          <div class="cb">
            <div style="font-size:11px;color:var(--t3);margin-bottom:10px">Base score: 50 · Range: 0–100</div>
            ${[
              ['On-time payment',   '+10', 'var(--ok)'],
              ['Answered call',     '+5',  'var(--ok)'],
              ['Promise kept',      '+5',  'var(--ok)'],
              ['Late payment',      '-15', 'var(--err)'],
              ['Missed call',       '-10', 'var(--err)'],
              ['Promise broken',    '-20', 'var(--err)'],
              ['PDC bounce',        '-25', 'var(--err)'],
              ['Active legal case', '-20', 'var(--err)'],
            ].map(([l,v,c]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)">
              <span style="font-size:12px;color:var(--t2)">${l}</span>
              <span style="font-weight:700;color:${c}">${v}</span>
            </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="ch"><h3>Categories</h3></div>
          <div class="cb">
            ${[
              ['','PLATINUM','80–100','#22c55e'],
              ['','GOOD',    '60–79', '#3b82f6'],
              ['','AT RISK', '40–59', '#f59e0b'],
              ['','CRITICAL','0–39',  '#ef4444'],
            ].map(([e,l,r,c]) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
              <span>${e}</span>
              <span style="flex:1;font-size:12px;font-weight:700;color:${c}">${l}</span>
              <span style="font-size:11px;color:var(--t3)">${r}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="ch" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3>Score History</h3>
        <span style="font-size:11px;color:var(--t3)">higher = healthier · lower = higher default risk</span>
      </div>
      <div class="cb">
        <div id="cd-health-hist-wrap" style="height:220px;position:relative">
          <canvas id="cd-health-hist-canvas"></canvas>
        </div>
      </div>
    </div>`;

  _cdRenderHealthHistory(clientId);
}

// Per-client risk/health score history chart (Module 1.1).
// Reads durable history captured by calculate_client_health_score.
let _cdHealthChart = null;
async function _cdRenderHealthHistory(clientId) {
  const wrap = document.getElementById('cd-health-hist-wrap');
  if (!wrap) return;

  let series = [];
  try {
    const { data, error } = await supabase.rpc('get_client_health_history', {
      p_client_id: clientId, p_company_id: S.cid, p_limit: 60
    });
    if (error) throw error;
    series = Array.isArray(data) ? data : [];
  } catch(e) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">Could not load history: ${esc(e.message||'error')}</div>`;
    return;
  }

  if (series.length < 2) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">Not enough history yet — a point is captured each time the score is recalculated. Check back after the next recalculation.</div>`;
    return;
  }

  if (typeof Chart === 'undefined') {
    wrap.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--t2)">' +
      series.map(p => `${fD(p.calculated_at)}: <b>${p.score}</b>`).join(' &nbsp;·&nbsp; ') + '</div>';
    return;
  }

  const labels = series.map(p => fD(p.calculated_at));
  const scores = series.map(p => Number(p.score));
  const ctx = document.getElementById('cd-health-hist-canvas');
  if (_cdHealthChart) { try { _cdHealthChart.destroy(); } catch(e) {} _cdHealthChart = null; }
  _cdHealthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Health score',
        data: scores,
        borderColor: '#6C63FF',
        backgroundColor: 'rgba(108,99,255,.12)',
        fill: true, tension: .3, pointRadius: 3, borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, ticks: { stepSize: 25 } } },
      plugins: { legend: { display: false } }
    }
  });
}

async function _cdLoadLedger(clientId) {
  const body = document.getElementById('cd-ledger-body');
  if (!body) return;
  if (body.dataset.loaded === clientId) return;   // already loaded for this client
  body.innerHTML = '<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px">⏳ Loading ledger…</div>';

  try {
    const { data, error } = await supabase.rpc('get_client_ledger', {
      p_client_id:  clientId,
      p_company_id: S.cid
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed to load ledger');

    const rows = data.rows || [];
    if (!rows.length) {
      body.innerHTML = '<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div><div class="et">No ledger entries yet</div><div class="es">Entries appear once a sale with installments is created.</div></div></div>';
      body.dataset.loaded = clientId;
      return;
    }

    // Compute running balance
    let balance = 0, totalDR = 0, totalCR = 0;
    const tableRows = rows.map(r => {
      const dr = Number(r.debit  || 0);
      const cr = Number(r.credit || 0);
      balance += dr - cr;
      totalDR += dr;
      totalCR += cr;
      const isDR = r.row_type === 'DR';
      const balAbs  = Math.abs(balance);
      const balColor = balance > 0 ? 'var(--err)' : balance < 0 ? 'var(--ok)' : 'var(--t3)';
      const balStr   = balance === 0 ? '—' : 'PKR ' + fM(balAbs);
      return `<tr style="${isDR ? '' : 'background:rgba(34,197,94,.03)'}">
        <td style="font-size:11px;color:var(--t3);white-space:nowrap">${fD(r.entry_date)}</td>
        <td style="font-size:12px">
          ${esc(r.description)}
          ${r.sale_number ? `<div style="font-size:10px;color:var(--t3);margin-top:1px">${esc(r.sale_number)}</div>` : ''}
        </td>
        <td class="r" style="font-size:12px;font-weight:${dr?'700':'400'};color:${dr?'var(--err)':'var(--t3)'}">${dr ? 'PKR '+fM(dr) : '—'}</td>
        <td class="r" style="font-size:12px;font-weight:${cr?'700':'400'};color:${cr?'var(--ok)':'var(--t3)'}">${cr ? 'PKR '+fM(cr) : '—'}</td>
        <td class="r" style="font-size:12px;font-weight:700;color:${balColor};white-space:nowrap">${balStr}</td>
      </tr>`;
    }).join('');

    const outstanding = totalDR - totalCR;
    body.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div class="tw" style="overflow-x:auto">
        <table class="t">
          <thead><tr>
            <th style="width:90px">Date</th>
            <th>Description</th>
            <th class="r" style="width:140px;color:var(--err)">Debit (Due)</th>
            <th class="r" style="width:140px;color:var(--ok)">Credit (Paid)</th>
            <th class="r" style="width:140px">Balance</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--line)">
              <td colspan="2" style="font-size:11px;font-weight:700;padding:10px 12px;color:var(--t2)">TOTALS</td>
              <td class="r" style="font-size:13px;font-weight:800;color:var(--err)">PKR ${fM(totalDR)}</td>
              <td class="r" style="font-size:13px;font-weight:800;color:var(--ok)">PKR ${fM(totalCR)}</td>
              <td class="r" style="font-size:13px;font-weight:800;color:${outstanding>0?'var(--err)':'var(--ok)'}">PKR ${fM(Math.abs(outstanding))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="display:flex;gap:24px;padding:14px 18px;border-top:1px solid var(--line);flex-wrap:wrap;background:rgba(0,0,0,.02)">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:3px">Total Due</div>
          <div style="font-size:17px;font-weight:800;color:var(--err)">PKR ${fM(totalDR)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:3px">Total Paid</div>
          <div style="font-size:17px;font-weight:800;color:var(--ok)">PKR ${fM(totalCR)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:3px">Outstanding</div>
          <div style="font-size:17px;font-weight:800;color:${outstanding>0?'var(--err)':'var(--ok)'}">
            ${outstanding > 0 ? 'PKR '+fM(outstanding) : 'Fully Paid'}
          </div>
        </div>
      </div>
    </div>`;
    body.dataset.loaded = clientId;
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load ledger</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

// ── Status quick-change ────────────────────────────────────
async function setClientStatus(clientId, newStatus) {
  const c    = gclient(clientId);
  const label = { inactive:'deactivate', blacklisted:'blacklist', active:'reactivate' }[newStatus] || newStatus;
  if (!confirm(`${label.charAt(0).toUpperCase()+label.slice(1)} client "${c?.fullName}"?`)) return;

  try {
    const { data, error } = await supabase.rpc('update_client', {
      p_id:         clientId,
      p_company_id: S.cid,
      p_data:       { status: newStatus }
    });
    if (error) throw error;
    if (!data?.success) { toast(data?.error || 'Update failed', 'err'); return; }
    await loadClientsCache(S.cid);
    toast(`Client ${label}d`, 'ok');
    rClientDetail();
  } catch (err) {
    console.error('[setClientStatus]', err);
    toast('Could not update status: ' + err.message, 'err');
  }
}

// ══ ADD / EDIT CLIENT MODAL ════════════════════════════════

function openClientModal(clientId) {
  const isEdit = !!clientId;
  document.getElementById('client-mtl').textContent = isEdit ? 'Edit Client' : 'Add Client';
  document.getElementById('cf-client-id').value = clientId || '';

  const resetFields = ['cf-name','cf-father','cf-cnic','cf-passport',
    'cf-phone','cf-phone2','cf-whatsapp','cf-email',
    'cf-address','cf-city','cf-occupation','cf-company','cf-reference','cf-notes',
    'cf-photo-url','cf-cnic-front','cf-cnic-back',
    'cf-kin-name','cf-kin-relation','cf-kin-phone',
    'cf-bank-name','cf-bank-title','cf-bank-acctno','cf-bank-iban'];
  resetFields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['cf-photo-file','cf-cnic-front-file','cf-cnic-back-file'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['cf-photo-url-prev','cf-cnic-front-prev','cf-cnic-back-prev'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });

  const codeEl = document.getElementById('cf-code');
  const catEl  = document.getElementById('cf-category');
  const stEl   = document.getElementById('cf-status');
  const ctryEl = document.getElementById('cf-country');

  document.querySelectorAll('#m-client .cf-err').forEach(el => el.textContent = '');
  document.querySelectorAll('#m-client .inp-err').forEach(el => el.classList.remove('inp-err'));
  const dupWarn = document.getElementById('cf-dup-warn');
  if (dupWarn) dupWarn.style.display = 'none';

  const ovlEl = document.getElementById('cf-overseas-local');
  const lsEl  = document.getElementById('cf-lead-source');

  if (isEdit) {
    const c = gclient(clientId);
    if (c) {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      if (codeEl) codeEl.value = c.clientCode;
      set('cf-name',       c.fullName);
      set('cf-father',     c.fatherName);
      set('cf-cnic',       c.cnic);
      set('cf-passport',   c.passportNo);
      set('cf-phone',      c.phonePrimary);
      set('cf-phone2',     c.phoneSecondary);
      set('cf-whatsapp',   c.whatsapp);
      set('cf-email',      c.email);
      set('cf-address',    c.address);
      set('cf-city',       c.city);
      set('cf-occupation', c.occupation);
      set('cf-company',    c.companyName);
      set('cf-reference',  c.referenceBy);
      set('cf-notes',      c.notes);
      // Extended fields
      set('cf-photo-url',    c.clientPhotoUrl);
      set('cf-cnic-front',   c.cnicFrontUrl);
      set('cf-cnic-back',    c.cnicBackUrl);
      // Show existing file previews for hidden URL inputs
      const _showPrev = (urlId, prevId) => {
        const url = document.getElementById(urlId)?.value;
        const el  = document.getElementById(prevId);
        if (!el || !url) { if (el) el.innerHTML = ''; return; }
        _fileUploadPreview(el, url, 'Existing file', true, urlId);
      };
      _showPrev('cf-photo-url',  'cf-photo-url-prev');
      _showPrev('cf-cnic-front', 'cf-cnic-front-prev');
      _showPrev('cf-cnic-back',  'cf-cnic-back-prev');
      set('cf-kin-name',     c.nextOfKinName);
      set('cf-kin-relation', c.nextOfKinRelation);
      set('cf-kin-phone',    c.nextOfKinPhone);
      set('cf-bank-name',    c.bankName);
      set('cf-bank-title',   c.bankAccountTitle);
      set('cf-bank-acctno',  c.bankAccountNo);
      set('cf-bank-iban',    c.bankIban);
      if (catEl)  catEl.value  = c.clientCategory || '';
      if (stEl)   stEl.value   = c.status         || 'active';
      if (ctryEl) ctryEl.value = c.country         || 'Pakistan';
      if (ovlEl)  ovlEl.value  = c.overseasLocal   || 'local';
      if (lsEl)   lsEl.value   = c.leadSource      || '';
    }
  } else {
    if (codeEl) codeEl.value = genClientCode(S.cid);
    if (catEl)  catEl.value  = 'Individual';
    if (stEl)   stEl.value   = 'active';
    if (ctryEl) ctryEl.value = 'Pakistan';
    if (ovlEl)  ovlEl.value  = 'local';
    if (lsEl)   lsEl.value   = '';
  }

  om('m-client');
}

function closeClientModal() { cm('m-client'); }

// ── Duplicate check on CNIC blur ──────────────────────────
async function checkCNICDuplicate() {
  const cnic     = (document.getElementById('cf-cnic')?.value || '').trim();
  const editId   = document.getElementById('cf-client-id')?.value || '';
  const warnEl   = document.getElementById('cf-dup-warn');
  if (!warnEl || !cnic) { if (warnEl) warnEl.style.display = 'none'; return; }

  try {
    const { data } = await supabase.rpc('check_client_duplicate', {
      p_company_id: S.cid, p_cnic: cnic, p_phone: null
    });
    if (data?.found && data.id !== editId) {
      warnEl.innerHTML = `CNIC already registered: <strong>${esc(data.full_name)}</strong> (${esc(data.client_code)}) — <a href="#" onclick="event.preventDefault();closeClientModal();openClientDetail('${data.id}')" style="color:var(--warn)">View Client</a>`;
      warnEl.style.display = 'block';
    } else {
      warnEl.style.display = 'none';
    }
  } catch (e) { /* silent */ }
}

// ── Validation helper ─────────────────────────────────────
function cfV(inp) {
  const val   = inp.value.trim();
  const errEl = document.getElementById('e-' + inp.id);
  let msg = '';
  if (inp.id === 'cf-name') {
    if (val.length > 0 && val.length < 2) msg = 'Min 2 characters';
  } else if (inp.id === 'cf-cnic') {
    if (val && !/^\d{5}-\d{7}-\d$/.test(val)) msg = 'Format: 42101-1234567-1';
  } else if (inp.id === 'cf-email') {
    if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) msg = 'Invalid email';
  }
  if (errEl) errEl.textContent = msg;
}

// ── Save ──────────────────────────────────────────────────
async function saveClientForm() {
  if (typeof demoGuard === 'function' && demoGuard('Save Client')) return;
  const name  = (document.getElementById('cf-name')?.value  || '').trim();
  const phone = (document.getElementById('cf-phone')?.value || '').trim();

  let hasErr = false;
  const setErr = (id, msg, inputId) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    const inp = document.getElementById(inputId || id.slice(2));
    if (inp) inp.classList.toggle('inp-err', !!msg);
    if (msg) hasErr = true;
  };

  setErr('e-cf-name',   !name  ? 'Full name is required' : name.length < 2 ? 'Min 2 characters' : '');
  setErr('e-cf-phone',  !phone ? 'Phone number is required' : '');

  const fatherVal = (document.getElementById('cf-father')?.value || '').trim();
  setErr('e-cf-father', !fatherVal ? 'Father / husband name is required' : '', 'cf-father');

  const isOverseas = document.getElementById('cf-overseas-local')?.value === 'overseas';
  const cnicVal = (document.getElementById('cf-cnic')?.value || '').trim();
  if (!isOverseas && !cnicVal) {
    setErr('e-cf-cnic', 'CNIC is required for local clients');
  } else if (cnicVal && !/^\d{5}-\d{7}-\d$/.test(cnicVal)) {
    setErr('e-cf-cnic', 'Format: 42101-1234567-1');
  } else setErr('e-cf-cnic', '');

  const emailVal = (document.getElementById('cf-email')?.value || '').trim();
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    setErr('e-cf-email', 'Invalid email format'); hasErr = true;
  } else setErr('e-cf-email', '');

  if (hasErr) return;

  const existingId = (document.getElementById('cf-client-id')?.value || '').trim();

  // Plan limit check — only for new clients, not edits
  if (!existingId) {
    let planRes;
    try {
      planRes = await supabase.rpc('get_clients_plan_status', { p_company_id: S.cid });
    } catch(e) {
      toast('Could not verify plan limits. Check your connection and try again.', 'err');
      return;
    }
    if (planRes?.error || !planRes?.data) {
      toast('Could not verify plan limits. Check your connection and try again.', 'err');
      return;
    }
    const maxClients     = planRes.data.max_allowed ?? 0;
    const currentClients = planRes.data.current_count ?? 0;
    if (maxClients > 0 && currentClients >= maxClients) {
      toast(`Client limit reached — your plan allows ${maxClients} clients. Upgrade to add more.`, 'err');
      return;
    }
  }

  const btn = document.getElementById('cf-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const payload = {
      company_id:           S.cid,
      full_name:            name,
      father_name:          (document.getElementById('cf-father')?.value       || '').trim() || null,
      cnic:                 cnicVal || null,
      passport_no:          (document.getElementById('cf-passport')?.value     || '').trim() || null,
      phone_primary:        phone,
      phone_secondary:      (document.getElementById('cf-phone2')?.value       || '').trim() || null,
      whatsapp:             (document.getElementById('cf-whatsapp')?.value     || '').trim() || null,
      email:                emailVal || null,
      address:              (document.getElementById('cf-address')?.value      || '').trim() || null,
      city:                 (document.getElementById('cf-city')?.value         || '').trim() || null,
      country:              document.getElementById('cf-country')?.value       || 'Pakistan',
      occupation:           (document.getElementById('cf-occupation')?.value   || '').trim() || null,
      company_name:         (document.getElementById('cf-company')?.value      || '').trim() || null,
      client_category:      document.getElementById('cf-category')?.value      || null,
      reference_by:         (document.getElementById('cf-reference')?.value    || '').trim() || null,
      notes:                (document.getElementById('cf-notes')?.value        || '').trim() || null,
      status:               document.getElementById('cf-status')?.value        || 'active',
      // Extended fields
      client_photo_url:     (document.getElementById('cf-photo-url')?.value    || '').trim() || null,
      cnic_front_url:       (document.getElementById('cf-cnic-front')?.value   || '').trim() || null,
      cnic_back_url:        (document.getElementById('cf-cnic-back')?.value    || '').trim() || null,
      overseas_local:       document.getElementById('cf-overseas-local')?.value || 'local',
      next_of_kin_name:     (document.getElementById('cf-kin-name')?.value     || '').trim() || null,
      next_of_kin_relation: (document.getElementById('cf-kin-relation')?.value || '').trim() || null,
      next_of_kin_phone:    (document.getElementById('cf-kin-phone')?.value    || '').trim() || null,
      lead_source:          document.getElementById('cf-lead-source')?.value   || null,
      bank_name:            (document.getElementById('cf-bank-name')?.value    || '').trim() || null,
      bank_account_title:   (document.getElementById('cf-bank-title')?.value   || '').trim() || null,
      bank_account_no:      (document.getElementById('cf-bank-acctno')?.value  || '').trim() || null,
      bank_iban:            (document.getElementById('cf-bank-iban')?.value    || '').trim() || null,
    };

    let result;
    if (existingId) {
      const { data, error } = await supabase.rpc('update_client', {
        p_id: existingId, p_company_id: S.cid, p_data: payload
      });
      if (error) throw error;
      result = data;
    } else {
      payload.created_by = S.userId || null;
      const { data, error } = await supabase.rpc('create_client', { p_data: payload });
      if (error) throw error;
      result = data;
    }

    if (!result?.success) {
      if (result?.error === 'plan_limit') {
        toast(result.message || 'Client limit reached. Upgrade your plan to add more clients.', 'err');
      } else if (result?.duplicate_field === 'cnic') {
        setErr('e-cf-cnic', 'CNIC already registered to another client');
      } else {
        toast(result?.error || 'Save failed', 'err');
      }
      return;
    }

    await loadClientsCache(S.cid);
    logA('client', (existingId ? 'Updated' : 'Added') + ' client: ' + name);
    toast(existingId ? 'Client updated' : 'Client added', 'ok');
    cm('m-client');
    if (existingId) rClientDetail();
    else rClients();
  } catch (err) {
    console.error('[saveClientForm]', err);
    toast('Could not save client: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Client'; }
  }
}

// ── cfUpdateIdPlaceholder kept for backward compat ────────
function cfUpdateIdPlaceholder() {}

// ══ PRINT CLIENT DETAIL PROFILE ═══════════════════════════

function printClientDetail() {
  const c = gclient(_cid);
  if (!c) return;

  const allUnits = gunits();
  const myUnits  = allUnits.filter(u =>
    u.clientId === _cid ||
    (c.fullName && u.customerName && u.customerName.toLowerCase() === c.fullName.toLowerCase())
  );
  const totalPortfolio = myUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const totalPaid      = myUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
  const outstanding    = Math.max(0, totalPortfolio - totalPaid);
  const recovPct       = totalPortfolio > 0 ? Math.min(100, Math.round(totalPaid / totalPortfolio * 100)) : 0;

  const w = _pw('Client Profile — Nexunova RMS', _pCSS('A4'));
  if (!w) return;

  const r = (label, val) => val
    ? `<tr><td class="lbl" style="width:30%;padding-right:12px;font-weight:600">${label}</td><td>${val}</td></tr>`
    : '';

  let h = _lh('CLIENT PROFILE');
  h += '<div class="body">';

  // Client name header
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #C9A84C">';
  h += '<div>';
  h += `<div style="font-size:9px;color:#888;font-family:monospace;margin-bottom:4px">${esc(c.clientCode)}</div>`;
  h += `<div style="font-size:20px;font-weight:700;color:#1E2D47">${esc(c.fullName || 'Unnamed')}</div>`;
  const parts = [c.clientCategory, c.city, c.country !== 'Pakistan' ? c.country : null].filter(Boolean);
  if (parts.length) h += `<div style="font-size:10px;color:#888;margin-top:3px">${esc(parts.join(' · '))}</div>`;
  h += '</div>';
  h += '<div style="text-align:right;font-size:10px;color:#555;line-height:1.7">';
  h += `Status: <strong style="color:#1E2D47">${(c.status||'—').charAt(0).toUpperCase()+(c.status||'').slice(1)}</strong><br>`;
  if (c.overseasLocal === 'overseas') h += 'Overseas (NICOP)<br>';
  h += `Code: <strong style="font-family:monospace;color:#1E2D47">${esc(c.clientCode)}</strong>`;
  h += '</div>';
  h += '</div>';

  // Personal info
  h += '<div class="sec-title">Personal Information</div>';
  h += '<table>';
  h += r('Full Name',   esc(c.fullName || '—'));
  if (c.fatherName)     h += r('Father / Husband', esc(c.fatherName));
  if (c.cnic)           h += r('CNIC',              esc(c.cnic));
  if (c.passportNo)     h += r('Passport',          esc(c.passportNo));
  h += r('Resident',     c.overseasLocal === 'overseas' ? 'Overseas (NICOP)' : 'Local (CNIC)');
  if (c.clientCategory) h += r('Category',          esc(c.clientCategory));
  if (c.occupation)     h += r('Occupation',        esc(c.occupation));
  if (c.companyName)    h += r('Company',           esc(c.companyName));
  if (c.referenceBy)    h += r('Referred By',       esc(c.referenceBy));
  if (c.leadSource)     h += r('Lead Source',       esc(c.leadSource));
  h += '</table>';

  // Contact
  h += '<div class="sec-title">Contact Details</div>';
  h += '<table>';
  if (c.phonePrimary)   h += r('Phone',    esc(c.phonePrimary));
  if (c.phoneSecondary) h += r('Phone 2',  esc(c.phoneSecondary));
  if (c.whatsapp)       h += r('WhatsApp', esc(c.whatsapp));
  if (c.email)          h += r('Email',    esc(c.email));
  if (c.address)        h += r('Address',  esc(c.address));
  if (c.city)           h += r('City',     esc(c.city));
  if (c.country)        h += r('Country',  esc(c.country));
  h += '</table>';

  // Next of Kin
  if (c.nextOfKinName || c.nextOfKinPhone) {
    h += '<div class="sec-title">Next of Kin / Nominee</div>';
    h += '<table>';
    if (c.nextOfKinName)     h += r('Name',     esc(c.nextOfKinName));
    if (c.nextOfKinRelation) h += r('Relation', esc(c.nextOfKinRelation));
    if (c.nextOfKinPhone)    h += r('Phone',    esc(c.nextOfKinPhone));
    h += '</table>';
  }

  // Bank
  if (c.bankName || c.bankAccountNo) {
    h += '<div class="sec-title">Bank Account</div>';
    h += '<table>';
    if (c.bankName)         h += r('Bank',   esc(c.bankName));
    if (c.bankAccountTitle) h += r('Title',  esc(c.bankAccountTitle));
    if (c.bankAccountNo)    h += r('A/C No', esc(c.bankAccountNo));
    if (c.bankIban)         h += r('IBAN',   esc(c.bankIban));
    h += '</table>';
  }

  // Notes
  if (c.notes) {
    h += '<div class="sec-title">Notes</div>';
    h += `<p style="font-size:11px;color:#444;line-height:1.6;margin:0 0 16px;padding:8px 10px;background:#f5f7fa;border:1px solid #dde;border-radius:4px">${esc(c.notes)}</p>`;
  }

  // Units portfolio table
  if (myUnits.length > 0) {
    h += `<div class="sec-title">Units Portfolio (${myUnits.length})</div>`;
    h += '<table>';
    h += '<thead><tr><th>Unit No</th><th>Project</th><th>Floor / Type</th><th>Area</th><th style="text-align:right">Total Price</th><th style="text-align:right">Paid</th><th style="text-align:right">Pending</th><th>Status</th></tr></thead>';
    h += '<tbody>';
    myUnits.forEach(u => {
      const prj  = gproject(u.projectId);
      const paid = Number(u.totalPaid  || 0);
      const pend = Math.max(0, Number(u.totalPrice || 0) - paid);
      h += `<tr>
        <td style="font-weight:700">${esc(u.unitNo || '—')}</td>
        <td>${esc(prj?.projectName || prj?.name || '—')}</td>
        <td>${esc(u.floorLabel || '—')} / ${esc(u.type || '—')}</td>
        <td>${u.area ? u.area + ' ' + (u.areaUnit || 'sqft') : '—'}</td>
        <td style="text-align:right">${u.totalPrice ? fM(u.totalPrice) : '—'}</td>
        <td style="text-align:right;color:#16a34a">${paid > 0 ? fM(paid) : '—'}</td>
        <td style="text-align:right;color:${pend > 0 ? '#b91c1c' : '#16a34a'}">${pend > 0 ? fM(pend) : '✓ Nil'}</td>
        <td>${esc(u.status || '—')}</td>
      </tr>`;
    });
    h += '</tbody>';
    h += `<tfoot><tr>
      <td colspan="4" style="font-weight:700">Total (${myUnits.length} unit${myUnits.length !== 1 ? 's' : ''})</td>
      <td style="text-align:right;font-weight:700">${fM(totalPortfolio)}</td>
      <td style="text-align:right;font-weight:700;color:#16a34a">${fM(totalPaid)}</td>
      <td style="text-align:right;font-weight:700;color:${outstanding > 0 ? '#b91c1c' : '#16a34a'}">${outstanding > 0 ? fM(outstanding) : '✓ Nil'}</td>
      <td>${recovPct}% recovered</td>
    </tr></tfoot>`;
    h += '</table>';
  }

  h += '<div class="footer-bar">Nexunova RMS — Confidential Client Record — ' + new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'}) + '</div>';
  h += '</div>';
  w.document.write(h);
  _pclose(w);
}
