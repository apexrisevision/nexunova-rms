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
let _cTab            = 'all';   // folded sub-view: 'all' | 'health' | 'blacklist'
let _cTabPending     = null;    // transient tab request consumed once by rClients()

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
  const pg = document.getElementById('pg-clients');
  if (!pg) return;
  if (!cid) { pg.innerHTML = `<div class="nx-card">${NX.empty({ icon:'inbox', message:'No company selected' })}</div>`; return; }

  if (_cTabPending) { _cTab = _cTabPending; _cTabPending = null; } else { _cTab = 'all'; }
  const isA = S.role === 'admin' || S.role === 'owner';

  const all = gclients();
  const total = all.length;
  const active = all.filter(c => c.status === 'active').length;
  const historical = all.filter(c => c.status === 'inactive').length;

  const actions =
    NX.button('Print', { variant:'ghost', size:'sm', onclick:'printClientsList()' }) +
    (isA ? NX.button('Add client', { variant:'primary', size:'sm', icon:'plus', attrs:'id="cl-add-btn"', onclick:'ClientForm.open({ onSaved: function(){ rClients(); } })' }) : '');

  pg.innerHTML = `<div class="nx-page">
    <div class="nx-page-header">
      <div><h1 class="nx-page-title">Clients</h1>
        <div class="nx-kpi-label" id="cl-count" style="margin-top:4px">${total} clients · ${active} active · ${historical} historical</div></div>
      <div class="nx-page-actions">${actions}</div>
    </div>
    <div class="nx-segment" style="margin-bottom:var(--fk-sp-4)">
      <button class="nx-btn nx-btn--sm ${_cTab==='all'?'nx-btn--primary':'nx-btn--ghost'}" onclick="setClientsTab('all')">All clients</button>
      <button class="nx-btn nx-btn--sm ${_cTab==='health'?'nx-btn--primary':'nx-btn--ghost'}" onclick="setClientsTab('health')">Health</button>
      <button class="nx-btn nx-btn--sm ${_cTab==='blacklist'?'nx-btn--primary':'nx-btn--ghost'}" onclick="setClientsTab('blacklist')">Blacklist</button>
    </div>
    <div id="cl-tab-mount" style="${_cTab==='all'?'display:none':''}"></div>
    <div id="cl-all" style="${_cTab==='all'?'':'display:none'}">
      <div id="cl-kpis" class="nx-kpi-row" style="margin-bottom:var(--fk-sp-4)"></div>
      <div class="nx-card nx-card--compact" style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:center;margin-bottom:var(--fk-sp-4)">
        <div style="position:relative;flex:1;min-width:200px;max-width:300px">
          <input class="nx-input" id="cl-s" placeholder="Name, NIC, phone, code…" value="${esc(_clSearch)}" oninput="_clSetSearch(this.value)" autocomplete="off" style="padding-left:32px">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);pointer-events:none">${NX.icon('search',14)}</span>
        </div>
        <div class="nx-segment" id="cl-status-seg">
          ${[['active','Active'],['inactive','Historical'],['','All']].map(([v,l])=>`<button class="nx-btn nx-btn--sm ${_clStatus===v?'nx-btn--primary':'nx-btn--ghost'}" onclick="_clSetStatus('${v}')">${l}</button>`).join('')}
        </div>
        <div id="cl-project-wrap"></div>
        <select class="nx-select" style="width:auto" onchange="_clSetRisk(this.value)">
          ${[['','Any risk'],['overdue','Overdue > 0'],['aging90','90d+ overdue']].map(([v,l])=>`<option value="${v}"${_clRisk===v?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div id="cl-ct"></div>
    </div>
  </div>`;

  const projs = (typeof gprojects==='function'?gprojects():(window._projectsCache||[]))||[];
  const pw = document.getElementById('cl-project-wrap');
  if (pw && projs.length>1) pw.innerHTML = `<select class="nx-select" style="width:auto" onchange="_clSetProject(this.value)"><option value="">All projects</option>${projs.map(p=>`<option value="${esc(p.id)}"${_clProject===p.id?' selected':''}>${esc(p.projectName||p.name||'Project')}</option>`).join('')}</select>`;

  if (_cTab==='all') { _clLoadAndRender(); _checkClientLimitUI(); }
  else if (_cTab==='health' && typeof rHealthCenter==='function') rHealthCenter();
  else if (_cTab==='blacklist' && typeof rBlacklist==='function') rBlacklist();
}

async function _checkClientLimitUI() {
  const btn = document.getElementById('cl-add-btn');
  if (!btn) return;
  try {
    const { data, error } = await supabase.rpc('get_clients_plan_status', { p_company_id: S.cid });
    if (error || !data) return;
    const maxClients     = data.max_allowed ?? 0;
    const currentClients = data.current_count ?? 0;
    if (maxClients > 0 && currentClients >= maxClients) {
      btn.disabled = true;
      btn.title    = `Client limit reached (${currentClients}/${maxClients}). Upgrade your plan to add more.`;
    }
  } catch(e) { /* UI hint only — not blocking */ }
}

function _clFilterMenu(type, btn) {
  if (type === 'cat') {
    const cats = ['Individual','Investor','Corporate','NRI','VIP'];
    DX.menu(btn, [
      { label:'All Categories', toggle:true, checked:!_cCategoryFilter, onClick:()=>setCCategoryFilter('') },
      ...cats.map(c => ({ label:c, toggle:true, checked:_cCategoryFilter===c, onClick:()=>setCCategoryFilter(c) }))
    ], { label:'Category', align:'left' });
  } else {
    const hs = [['PLATINUM','Platinum'],['GOOD','Good'],['AT RISK','At Risk'],['CRITICAL','Critical']];
    DX.menu(btn, [
      { label:'All Health', toggle:true, checked:!_cHealthFilter, onClick:()=>setCHealthFilter('') },
      ...hs.map(([v,l]) => ({ label:l, toggle:true, checked:_cHealthFilter===v, onClick:()=>setCHealthFilter(v) }))
    ], { label:'Client Health', align:'left' });
  }
}

function _clRenderAFBar() {
  const bar = document.getElementById('cl-af-bar');
  if (!bar) return;
  const chips = [];
  if (_cStatusFilter)   chips.push(['Status', _cStatusFilter,    () => setCStatusFilter('')]);
  if (_cCategoryFilter) chips.push(['Category', _cCategoryFilter, () => setCCategoryFilter('')]);
  if (_cHealthFilter)   chips.push(['Health', _cHealthFilter,    () => setCHealthFilter('')]);
  bar.innerHTML = chips.length
    ? chips.map(([k, v], i) =>
        `<span class="dx-chip"><b>${esc(k)}</b> ${esc(v)} <button class="dx-chip-x" onclick="_clAFRemove(${i})" title="Remove">${_UI.xsm}</button></span>`
      ).join('') + (chips.length>1?`<button class="dx-chip-clear" onclick="_clAFClearAll()">Clear all</button>`:'')
    : '';
  bar.style.display = chips.length ? 'flex' : 'none';
  bar._chips = chips.map(c => c[2]);
}
function _clAFRemove(i) { const fn = document.getElementById('cl-af-bar')?._chips?.[i]; if(fn) fn(); }
function _clAFClearAll() { _cStatusFilter=''; _cCategoryFilter=''; _cHealthFilter=''; _cPage=1; rClients(); }

function setCS(q)               { _cs = q;              _cPage = 1; rCLF(); }
function setCStatusFilter(v)    { _cStatusFilter = v;   _cPage = 1; rClients(); }
function setCCategoryFilter(v)  { _cCategoryFilter = v; _cPage = 1; _clRenderAFBar(); rCLF(); }
function setCHealthFilter(v)    { _cHealthFilter = v;   _cPage = 1; _clRenderAFBar(); rCLF(); }
function setCView(v)            { _cView = v; localStorage.setItem('nxn_cl_view', v); rClients(); }

// Folded sub-view tabs (All · Health · Blacklist). Both in-page clicks and the
// healthcenter/blacklist route redirects funnel through _cTabPending, so a plain
// nav('clients') still defaults back to the All tab.
function setClientsTab(t)          { _cTabPending = (t==='health'||t==='blacklist')?t:'all'; rClients(); }
window.openClientsTab = function(t){ _cTabPending = (t==='health'||t==='blacklist')?t:'all'; nav('clients'); };

// Client-side sort (full filtered set, then paginate)
let _cSort = { col: '', dir: 1 };
function setCSort(col) {
  if (_cSort.col === col) _cSort.dir *= -1; else { _cSort.col = col; _cSort.dir = 1; }
  rCLF();
}

var _clStatus = 'active';   // Active default (spec)
var _clProject = '';
var _clRisk = '';            // '' | 'overdue' | 'aging90'
var _clSearch = '';
var _clRpByCode = {};        // client_code -> aggregated RP balances
var _clSearchTimer = null;

// Balances/overdue come from get_recovery_position (dashboard-consistent), merged
// by client_code onto the roster. NEVER sales.remaining_amount (cohort trap).
async function _clLoadAndRender() {
  const ct = document.getElementById('cl-ct');
  if (!ct) return;
  ct.innerHTML = `<div class="nx-card">${[0,1,2,3].map(()=>'<div class="nx-skel" style="height:40px;margin:6px 0;border-radius:8px"></div>').join('')}</div>`;
  _clRpByCode = {};
  try {
    const { data } = await supabase.rpc('get_recovery_position', { p_company_id: S.cid, p_project_id: null, p_from_date: null, p_to_date: (typeof td==='function'?td():null) });
    const rows = (data && data.rows) ? data.rows : [];
    rows.forEach(r => {
      const code = r.client_code; if (!code) return;
      const a = _clRpByCode[code] || (_clRpByCode[code] = { units:0, contracted:0, paid:0, balance:0, overdue:0, overdueDays:0 });
      a.units += 1;
      a.contracted += Number(r.net_price||0);
      a.paid += Number(r.paid_to_date||0);
      a.balance += Number(r.closing||0);
      if (Number(r.overdue_days||0) > 0) a.overdue += Number(r.closing||0);   // row-level overdue amount
      if (Number(r.closing||0) > 0 && Number(r.overdue_days||0) > 0) a.overdueDays = Math.max(a.overdueDays, Number(r.overdue_days||0));
    });
  } catch(e) { /* balances unavailable — roster still renders */ }
  _clRenderKpis();
  rCLF();
}

function _clRosterFiltered() {
  const q = (_clSearch||'').trim().toLowerCase();
  return gclients().filter(c => {
    if (_clStatus && c.status !== _clStatus) return false;
    if (_clProject && c.projectId !== _clProject) return false;
    const rp = _clRpByCode[c.clientCode] || null;
    if (_clRisk === 'overdue' && !(rp && rp.overdue > 0)) return false;
    if (_clRisk === 'aging90' && !(rp && rp.overdue > 0 && rp.overdueDays >= 90)) return false;
    if (q) {
      const hay = (`${c.fullName||''} ${c.cnic||''} ${c.phonePrimary||''} ${c.clientCode||''}`).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _clRenderKpis() {
  const el = document.getElementById('cl-kpis'); if (!el) return;
  const roster = _clRosterFiltered();
  let bal = 0, ovd = 0;
  roster.forEach(c => { const rp = _clRpByCode[c.clientCode]; if (rp) { bal += rp.balance; ovd += rp.overdue; } });
  const active = roster.filter(c => c.status === 'active').length;
  el.innerHTML =
    NX.kpi({ label:'Clients shown', value: roster.length }) +
    NX.kpi({ label:'Active', value: active }) +
    NX.kpi({ label:'Total balance', value: fMF(bal) }) +
    NX.kpi({ label:'Overdue', value: fMF(ovd) });
}

function rCLF() {
  const ct = document.getElementById('cl-ct'); if (!ct) return;
  const roster = _clRosterFiltered();
  if (!roster.length) { ct.innerHTML = `<div class="nx-card">${NX.empty({ icon:'search', message:'No clients match these filters.' })}</div>`; return; }
  const cols = [
    {label:'Code'},{label:'Client'},{label:'NIC'},{label:'Phone'},
    {label:'Units',num:true},{label:'Balance',num:true},{label:'Overdue',num:true},{label:'Status'}
  ];
  const rows = roster.map(c => {
    const rp = _clRpByCode[c.clientCode] || null;
    const bal = rp ? rp.balance : 0, ovd = rp ? rp.overdue : 0, units = rp ? rp.units : 0;
    const tone = c.status === 'active' ? 'success' : c.status === 'blacklisted' ? 'danger' : '';
    const lbl = c.status === 'inactive' ? 'Historical' : (c.status ? c.status[0].toUpperCase()+c.status.slice(1) : '—');
    return [
      `<span class="nx-mono" style="color:var(--fk-primary);font-weight:var(--fk-fw-semibold)">${esc(c.clientCode||'—')}</span>`,
      `${esc(c.fullName||'Unnamed')}${c.fatherName?`<div class="nx-kpi-label" style="text-transform:none">S/o ${esc(c.fatherName)}</div>`:''}`,
      `<span class="nx-mono">${esc(c.cnic||'—')}</span>`,
      esc(c.phonePrimary||'—'),
      units||'—',
      fMF(bal),
      `<span style="color:${ovd>0?'var(--fk-danger)':'var(--fk-text-muted)'}">${ovd>0?fMF(ovd):'—'}</span>`,
      NX.badge(lbl, tone, { dot:true })
    ];
  });
  ct.innerHTML = `<div class="nx-card nx-card--flush"><div class="nx-table-wrap">${NX.table({ cols, rows, flush:true })}</div></div>`;
  ct.querySelectorAll('tbody tr').forEach((tr,i)=>{ tr.style.cursor='pointer'; tr.onclick=()=>openClientDetail(roster[i].id); });
}

function _clSetSearch(v){ _clSearch=v; clearTimeout(_clSearchTimer); _clSearchTimer=setTimeout(()=>{ _clRenderKpis(); rCLF(); },200); }
function _clSetStatus(v){
  _clStatus=v;
  const seg=document.getElementById('cl-status-seg');
  if(seg) seg.querySelectorAll('.nx-btn').forEach(b=>{ const on=(b.textContent.trim()===(v==='active'?'Active':v==='inactive'?'Historical':'All')); b.classList.toggle('nx-btn--primary',on); b.classList.toggle('nx-btn--ghost',!on); });
  _clRenderKpis(); rCLF();
}
function _clSetProject(v){ _clProject=v; _clRenderKpis(); rCLF(); }
function _clSetRisk(v){ _clRisk=v; _clRenderKpis(); rCLF(); }

function openClientPeek(id) {
  const c = gclient(id);
  if (!c) return;
  const isA  = S.role==='admin'||S.role==='owner';
  const flag = CF_FLAGS[c.country] || '';
  const h    = window._healthScoresCache?.[id];
  const allUnits = (typeof gunits==='function') ? gunits() : [];
  const myUnits  = allUnits.filter(u => u.clientId===id || (c.fullName && u.customerName && u.customerName.toLowerCase()===c.fullName.toLowerCase()));
  const totalPortfolio = myUnits.reduce((s,u)=>s+Number(u.totalPrice||0),0);
  const totalPaid      = myUnits.reduce((s,u)=>s+Number(u.totalPaid||0),0);
  const outstanding    = Math.max(0, totalPortfolio-totalPaid);
  const recovPct       = totalPortfolio>0?Math.min(100,Math.round(totalPaid/totalPortfolio*100)):0;
  const initials = (c.fullName||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
  const hClr = { PLATINUM:'#16a34a', GOOD:'#2563eb', 'AT RISK':'#d97706', CRITICAL:'#dc2626' }[h?.category] || '#64748b';
  const statusKind = c.status==='active'?'ok':c.status==='blacklisted'?'danger':'neutral';
  const statusLbl  = c.status==='active'?'Active':c.status==='blacklisted'?'Blacklisted':c.status==='inactive'?'Inactive':(c.status||'—');

  const hero = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
    ${c.clientPhotoUrl?`<img src="${esc(c.clientPhotoUrl)}" style="width:56px;height:56px;border-radius:15px;object-fit:cover" onerror="this.style.display='none'">`:`<div style="width:56px;height:56px;border-radius:15px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:800">${esc(initials)}</div>`}
    <div style="min-width:0;flex:1">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${DX.statusChip(statusLbl, statusKind)}
        ${c.clientCategory?`<span class="dx-status info">${esc(c.clientCategory)}</span>`:''}
        ${h?`<span class="dx-status" style="color:${hClr};background:${hClr}1a">${esc(h.category)} · ${h.score}</span>`:''}
      </div>
      <div style="font-size:11px;color:var(--text-muted);font-family:var(--mono);margin-top:7px">${esc(c.cnic||'No CNIC on file')}</div>
    </div>
  </div>`;

  const stats = totalPortfolio>0?`<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">Units</div><div class="dx-dstat-v">${myUnits.length}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Portfolio</div><div class="dx-dstat-v">${fM(totalPortfolio)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Outstanding</div><div class="dx-dstat-v" style="color:${outstanding>0?'#dc2626':'#16a34a'}">${outstanding>0?fM(outstanding):'Nil'}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Recovery</div><div class="dx-dstat-v">${recovPct}%</div></div>
  </div>`:'';

  const contact = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
    ${c.phonePrimary?`<a class="dx-tool" style="text-decoration:none" href="tel:${esc(c.phonePrimary)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.52 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.44 1.18l3-.01a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg><span>Call</span></a>`:''}
    ${(c.whatsapp||c.phonePrimary)?`<a class="dx-tool" style="text-decoration:none" target="_blank" href="https://wa.me/${(c.whatsapp||c.phonePrimary).replace(/[^0-9]/g,'')}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>WhatsApp</span></a>`:''}
    ${c.email?`<a class="dx-tool" style="text-decoration:none" href="mailto:${esc(c.email)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span>Email</span></a>`:''}
  </div>`;

  const unitsBlock = `<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:11px">Units${myUnits.length?` · ${myUnits.length}`:''}</div>`
    + (myUnits.length ? myUnits.slice(0,10).map(u => {
        const rem = (typeof actualPending==='function')?actualPending(u):(Number(u.totalPrice||0)-Number(u.totalPaid||0));
        const prj = (typeof gproject==='function')?gproject(u.projectId):null;
        return `<div onclick="document.querySelector('.dx-drawer-x').click();openUD('${u.id}')" style="display:flex;align-items:center;gap:11px;padding:11px 13px;border:1px solid var(--border-color);border-radius:11px;margin-bottom:8px;cursor:pointer;transition:border-color 140ms" onmouseover="this.style.borderColor='rgba(37,99,235,.3)'" onmouseout="this.style.borderColor='var(--border-color)'">
          <span class="dx-code">${esc(u.unitNo||'—')}</span>
          <div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(prj?.projectName||prj?.name||u.type||'—')}</div><div style="font-size:11px;color:var(--text-muted)">${esc(u.floorLabel||u.type||'')}</div></div>
          <div style="font-size:12.5px;font-weight:700;color:${rem>0?'#dc2626':'#16a34a'};white-space:nowrap">${rem>0?'PKR '+fM(rem):'Paid'}</div>
        </div>`;
      }).join('') : `<div style="font-size:12.5px;color:var(--text-muted);padding:6px 0">No units linked yet.</div>`);

  const footer = `<button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click()">Close</button>`
    + (isA?`<button class="btn btn-gh btn-sm" onclick="document.querySelector('.dx-drawer-x').click();openClientModal('${id}')">Edit</button>`:'')
    + `<button class="btn btn-p btn-sm" onclick="document.querySelector('.dx-drawer-x').click();openClientDetail('${id}')">Open full profile →</button>`;

  DX.drawer({
    eyebrow: c.clientCode || 'CLIENT',
    title: (flag?flag+' ':'') + (c.fullName||'Unnamed'),
    subtitle: [c.city,c.country].filter(Boolean).join(', ') || '—',
    body: hero + stats + contact + unitsBlock,
    footer
  });
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
  const pg = document.getElementById('pg-clientdetail');
  if (!pg) return;
  const isA = S.role === 'admin' || S.role === 'owner';
  const hist = c.status === 'inactive';

  const cdInitials = (((c.fullName || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('')) || '?').toUpperCase();
  const cdAvatar = c.clientPhotoUrl
    ? '<img src="' + esc(c.clientPhotoUrl) + '" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">'
    : '<div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:800;flex-shrink:0">' + esc(cdInitials) + '</div>';

  const act = [];
  act.push(NX.button('← Back', { variant:'ghost', size:'sm', onclick:"nav('clients')" }));
  if (isA) act.push(NX.button('Edit', { variant:'secondary', size:'sm', onclick:"ClientForm.open({ clientId:'" + clientId + "', onSaved:function(){ rClientDetail(); } })" }));
  act.push(NX.button('Record payment', { variant:'primary', size:'sm', onclick:"nav('addpayment')" }));
  act.push(NX.button('Client ledger', { variant:'secondary', size:'sm', onclick:"openLedgerReport('" + clientId + "')" }));
  act.push(NX.button('Log follow-up', { variant:'secondary', size:'sm', onclick:"_cdLogFollowUp()" }));
  if (isA && !hist) act.push(NX.button('Deactivate', { variant:'ghost', size:'sm', onclick:"setClientStatus('" + clientId + "','inactive')" }));
  if (isA && hist)  act.push(NX.button('Reactivate', { variant:'ghost', size:'sm', onclick:"setClientStatus('" + clientId + "','active')" }));

  const tab = (id, label) => '<button class="nx-btn nx-btn--sm ' + (id==='overview'?'nx-btn--primary':'nx-btn--ghost') + '" id="cd-tab-' + id + '-btn" onclick="cdSwitchTab(\'' + id + '\')">' + label + '</button>';
  const statusBadge = NX.badge(hist?'Historical':(c.status?c.status[0].toUpperCase()+c.status.slice(1):'—'), hist?'':(c.status==='blacklisted'?'danger':'success'), {dot:true});

  pg.innerHTML = '<div class="nx-page">' +
    '<div id="cd-form-nav"></div>' +
    '<div class="no-p" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:var(--fk-sp-3)">' + act.join('') + '</div>' +
    (hist ? NX.banner('Historical / cancelled buyer — this client is inactive. Their cancelled sales are shown below; no current dues are computed.', 'warn') : '') +
    '<div class="nx-card" style="margin:var(--fk-sp-3) 0">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--fk-sp-3)">' +
        '<div style="display:flex;gap:var(--fk-sp-3);align-items:flex-start">' + cdAvatar + '<div>' +
          '<div class="nx-mono nx-kpi-label" style="text-transform:none">' + esc(c.clientCode||'') + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0"><h1 class="nx-page-title">' + esc(c.fullName||'Unnamed') + '</h1>' + statusBadge + (c.clientCategory?NX.chip(c.clientCategory):'') + '</div>' +
          '<div class="nx-kpi-label" style="text-transform:none">' + (c.fatherName?'S/o '+esc(c.fatherName)+' · ':'') + (c.cnic?'NIC '+esc(c.cnic):'') + '</div>' +
          '<div class="nx-kpi-label" style="text-transform:none;margin-top:4px">' + (c.phonePrimary?'<a href="tel:'+esc(c.phonePrimary)+'" style="color:var(--fk-info)">'+esc(c.phonePrimary)+'</a>':'') + (c.address?' · '+esc(c.address):'') + (c.city?', '+esc(c.city):'') + '</div>' +
          (c.nextOfKinName ? '<div class="nx-kpi-label" style="text-transform:none;margin-top:4px">Nominee: ' + esc(c.nextOfKinName) + (c.nextOfKinRelation?' ('+esc(c.nextOfKinRelation)+')':'') + (c.nextOfKinPhone?' · '+esc(c.nextOfKinPhone):'') + '</div>' : '') +
        '</div></div>' +
        '<div class="no-p" style="display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap">' +
          (c.phonePrimary?'<a class="nx-btn nx-btn--ghost nx-btn--sm" href="tel:'+esc(c.phonePrimary)+'"><span>Call</span></a>':'') +
          ((c.whatsapp||c.phonePrimary)?'<a class="nx-btn nx-btn--ghost nx-btn--sm" target="_blank" href="https://wa.me/'+(c.whatsapp||c.phonePrimary).replace(/[^0-9]/g,'')+'"><span>WhatsApp</span></a>':'') +
          (c.email?'<a class="nx-btn nx-btn--ghost nx-btn--sm" href="mailto:'+esc(c.email)+'"><span>Email</span></a>':'') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="nx-segment" style="margin-bottom:var(--fk-sp-3)">' + tab('overview','Overview') + tab('ledger','Ledger') + tab('health','Health') + tab('promises','Promises') + tab('paylinks','Payment Links') + tab('documents','Documents') + (isA?tab('history','History'):'') + '</div>' +
    '<div id="cd-tab-overview">' +
      '<div id="cd-fin" class="nx-kpi-row" style="margin-bottom:var(--fk-sp-4)"></div>' +
      '<div class="nx-card nx-card--flush" style="margin-bottom:var(--fk-sp-4)"><div class="nx-card-title" style="padding:var(--fk-sp-3) var(--fk-sp-4)">Portfolio</div><div id="cd-portfolio"><div class="nx-skel" style="height:120px;margin:var(--fk-sp-3)"></div></div></div>' +
      '<div class="nx-grid-2">' +
        '<div class="nx-card"><div class="nx-card-title" style="margin-bottom:var(--fk-sp-3)">Recent payments</div><div id="cd-payments"><div class="nx-skel" style="height:80px"></div></div></div>' +
        '<div class="nx-card"><div class="nx-card-title" style="margin-bottom:var(--fk-sp-3)">Follow-up history</div><div id="cd-followups"><div class="nx-skel" style="height:80px"></div></div></div>' +
      '</div>' +
    '</div>' +
    '<div id="cd-tab-ledger" style="display:none"><div id="cd-ledger-body"></div></div>' +
    '<div id="cd-tab-health" style="display:none"><div id="cd-health-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    '<div id="cd-tab-promises" style="display:none"><div id="cd-promises-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    '<div id="cd-tab-paylinks" style="display:none"><div id="cd-paylinks-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    '<div id="cd-tab-documents" style="display:none"><div id="cd-documents-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    (isA?'<div id="cd-tab-history" style="display:none"><div id="cd-history-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>':'') +
  '</div>';

  _cdLoadOverview(clientId, c);
  _cdLoadActivity(clientId, c);

  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#cd-form-nav', entity: 'client', dateField: 'createdAt', currentId: clientId, storageKey:'rms.fnav.client',
      loadList: async () => (window._clientsCache || []).map(x => ({ id: x.id, createdAt: x.createdAt || x.created_at || '' })),
      openEntry: (id) => openClientDetail(id),
      onEdit:    (id) => isA && ClientForm.open({ clientId: id, onSaved: function(){ rClientDetail(); } }),
      onDelete:  async () => { if (typeof toast === 'function') toast('Use Deactivate instead — clients are never hard-deleted.', 'warn'); }
    });
  }
}

// Units linked to this client (for Log Follow-up, which is unit-keyed via openConModal)
let _cdUnitIds = [];
function _cdClientUnitIds() {
  if (_cdUnitIds.length) return _cdUnitIds;
  const c = gclient(_cid); if (!c) return [];
  return ((typeof gunits==='function'?gunits():[])||[]).filter(u => u.clientId === _cid || (c.fullName && u.customerName && u.customerName.toLowerCase() === c.fullName.toLowerCase())).map(u => u.id);
}
function _cdLogFollowUp() {
  const ids = _cdClientUnitIds();
  if (!ids.length) { toast('No unit linked to this client to log against.', 'warn'); return; }
  if (typeof openConModal === 'function') openConModal(ids[0]);
  else toast('Contact log unavailable.', 'warn');
}

// Portfolio + financial summary. Spine = list_sales_by_client_all (all sales incl
// cancelled, with sale_number/status); active balances merged from get_recovery_position
// by sale_id. Balances come from RP (dashboard-consistent), NEVER sales.remaining_amount.
async function _cdLoadOverview(clientId, c) {
  const fin = document.getElementById('cd-fin');
  const port = document.getElementById('cd-portfolio');
  let allSales = [], rpRows = [];
  try {
    const [allRes, rpRes] = await Promise.all([
      supabase.rpc('list_sales_by_client_all', { p_client_id: clientId, p_company_id: S.cid }),
      supabase.rpc('get_recovery_position', { p_company_id: S.cid, p_project_id: null, p_from_date: null, p_to_date: (typeof td==='function'?td():null) })
    ]);
    allSales = Array.isArray(allRes.data) ? allRes.data : [];
    rpRows = ((rpRes.data && rpRes.data.rows) || []).filter(r => r.client_code === c.clientCode);
  } catch (e) { if (port) port.innerHTML = NX.empty({ icon:'alert-triangle', message:'Could not load portfolio.' }); }

  const rpBySale = {};
  rpRows.forEach(r => { if (r.sale_id) rpBySale[r.sale_id] = r; });
  _cdUnitIds = allSales.filter(s => s.status === 'active').map(s => s.unit_id).filter(Boolean);

  // RP buckets (closing_old/current) degenerate to 0 in an all-time call; only 'closing'
  // and 'overdue_days' are meaningful. Overdue = row-level Σ closing WHERE overdue_days>0
  // (the dashboard's Overdue-Today formula at client scope), NOT closing_old.
  const contracted = rpRows.reduce((a,r)=>a+Number(r.net_price||0),0);
  const paid = rpRows.reduce((a,r)=>a+Number(r.paid_to_date||0),0);
  const remaining = contracted - paid;                                  // total still owed on the contract
  const dueToday = rpRows.reduce((a,r)=>a+Number(r.closing||0),0);       // billed-to-date minus paid
  const overdue = rpRows.reduce((a,r)=>a + (Number(r.overdue_days||0) > 0 ? Number(r.closing||0) : 0), 0);
  if (fin) fin.innerHTML = NX.kpi({label:'Contracted (net)', value:fMF(contracted)}) + NX.kpi({label:'Paid', value:fMF(paid)}) + NX.kpi({label:'Remaining', value:fMF(remaining)}) + NX.kpi({label:'Due till today', value:fMF(dueToday)}) + NX.kpi({label:'Overdue', value:fMF(overdue)});

  if (!port) return;
  const unitsCache = (typeof gunits==='function'?gunits():[])||[];
  if (!allSales.length) { port.innerHTML = NX.empty({ icon:'inbox', message:'No sales linked to this client.' }); return; }
  // active first, then cancelled
  allSales.sort((a,b) => (a.status==='cancelled'?1:0) - (b.status==='cancelled'?1:0));
  const rows = allSales.map(s => {
    const cancelled = s.status === 'cancelled';
    const rp = rpBySale[s.id];
    const u = unitsCache.find(x => x.id === s.unit_id);
    const unitNo = (rp && rp.unit_no) || (u && u.unitNo) || '—';
    const net = rp ? Number(rp.net_price||0) : Number(s.net_amount||0);
    const pd = rp ? Number(rp.paid_to_date||0) : 0;
    const bal = cancelled ? 0 : (rp ? Number(rp.closing||0) : 0);
    const odd = rp ? Number(rp.overdue_days||0) : 0;
    return [
      esc(unitNo),
      '<span class="nx-mono">' + esc(s.sale_number||'—') + '</span>',
      fMF(net),
      cancelled ? '—' : fMF(pd),
      cancelled ? '<span style="color:var(--fk-text-muted)">—</span>' : '<span style="color:' + (bal>0?'var(--fk-warning)':'var(--fk-success)') + '">' + fMF(bal) + '</span>',
      (!cancelled && odd>0) ? NX.badge(odd+'d','danger',{dot:true}) : '—',
      cancelled ? NX.badge('Cancelled','danger') : NX.badge('Active','success')
    ];
  });
  const cols = [{label:'Unit'},{label:'Sale #'},{label:'Net',num:true},{label:'Paid',num:true},{label:'Balance',num:true},{label:'Overdue'},{label:'Status'}];
  const nCancel = allSales.filter(s=>s.status==='cancelled').length;
  port.innerHTML = '<div class="nx-table-wrap">' + NX.table({ cols, rows, flush:true }) + '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:18px;padding:var(--fk-sp-3) var(--fk-sp-4);border-top:1px solid var(--fk-border);font-size:13px;flex-wrap:wrap">' +
      '<span class="nx-kpi-label" style="text-transform:none">' + rpRows.length + ' active' + (nCancel?(' · ' + nCancel + ' cancelled'):'') + '</span>' +
      '<span>Net <strong>' + fMF(contracted) + '</strong></span><span>Paid <strong>' + fMF(paid) + '</strong></span><span>Due <strong>' + fMF(dueToday) + '</strong></span>' +
    '</div>';
}

// Activity: recent payments (ledger CR rows) + follow-up history (contact_logs)
async function _cdLoadActivity(clientId, c) {
  try {
    const { data } = await supabase.rpc('get_client_ledger', { p_client_id: clientId, p_company_id: S.cid, p_from_date: null, p_to_date: null });
    const rows = (data && data.rows) ? data.rows : [];
    const pays = rows.filter(r => r.row_type === 'CR').reverse().slice(0, 10);
    const el = document.getElementById('cd-payments');
    if (el) el.innerHTML = pays.length ? pays.map(p =>
      '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--fk-border)">' +
        '<div><div style="font-size:13px">' + esc((p.description||'Payment').replace('Payment Received — ','')) + '</div>' +
        '<div class="nx-kpi-label" style="text-transform:none">' + fD(p.entry_date) + (p.voucher_no?' · '+esc(p.voucher_no):'') + (p.chq_no?' · Chq '+esc(p.chq_no):'') + '</div></div>' +
        '<div style="color:var(--fk-success);font-weight:var(--fk-fw-semibold);white-space:nowrap">' + fMF(p.credit) + '</div></div>'
    ).join('') : NX.empty({ message:'No payments recorded yet.' });
  } catch (e) {}
  try {
    const { data } = await supabase.rpc('get_contact_logs_cache', { p_company_id: S.cid });
    const logs = (Array.isArray(data)?data:[]).filter(l => l.client_id === clientId).slice(0, 10);
    const el = document.getElementById('cd-followups');
    if (el) el.innerHTML = logs.length ? logs.map(l =>
      '<div style="padding:7px 0;border-bottom:1px solid var(--fk-border)">' +
        '<div style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:13px">' + esc(l.contact_type||l.intent||l.outcome||'Contact') + (l.agent_name?' · '+esc(l.agent_name):'') + '</span><span class="nx-kpi-label" style="text-transform:none">' + fD(l.contact_date) + '</span></div>' +
        (l.notes?'<div class="nx-kpi-label" style="text-transform:none">' + esc(l.notes) + '</div>':'') +
        (l.next_follow_up_date?'<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-warning)">Next: ' + fD(l.next_follow_up_date) + '</div>':'') +
      '</div>'
    ).join('') : NX.empty({ message:'No follow-ups logged yet.' });
  } catch (e) {}
}

// ── Client detail tabs ─────────────────────────────────────
function cdSwitchTab(tab) {
  ['overview','ledger','health','promises','paylinks','documents','history'].forEach(t => {
    const div = document.getElementById('cd-tab-'+t);
    const btn = document.getElementById('cd-tab-'+t+'-btn');
    if (div) div.style.display = t === tab ? '' : 'none';
    if (btn) { btn.classList.toggle('nx-btn--primary', t === tab); btn.classList.toggle('nx-btn--ghost', t !== tab); }
  });
  if (tab === 'ledger')    _cdLoadLedger(_cid);
  if (tab === 'health')    _cdLoadHealth(_cid);
  if (tab === 'promises')  _cdLoadPromises(_cid);
  if (tab === 'paylinks')  _cdLoadPayLinks(_cid);
  if (tab === 'documents') _cdLoadDocuments(_cid);
  if (tab === 'history')   _cdLoadAuditHistory(_cid);
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

// ─── Documents tab ────────────────────────────────────────────
async function _cdLoadDocuments(clientId) {
  const body = document.getElementById('cd-documents-body');
  if (!body) return;
  if (body.dataset.loaded === clientId) return;
  body.innerHTML = '<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px">⏳ Loading documents…</div>';

  try {
    const [docsRes, portalRes] = await Promise.all([
      supabase.rpc('get_client_documents', { p_client_id: clientId, p_company_id: S.cid }),
      supabase.rpc('get_portal_access_status', { p_client_id: clientId, p_company_id: S.cid })
    ]);

    if (docsRes.error) throw docsRes.error;
    const d = docsRes.data || {};
    const portal = portalRes.data || { has_access: false };

    const isA = S.role === 'admin' || S.role === 'owner';

    // ── Portal Access card ──
    const portalCard = isA ? `
    <div class="card" style="margin-bottom:14px">
      <div class="ch" style="display:flex;align-items:center;justify-content:space-between">
        <h3><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Buyer Portal Access</h3>
        ${portal.has_access
          ? `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(34,197,94,.12);color:#16a34a;border:1px solid rgba(34,197,94,.3)">${portal.is_active ? 'Portal Active' : 'Deactivated'}</span>`
          : `<span style="font-size:11px;color:var(--t3)">No access</span>`}
      </div>
      <div class="cb">
        ${portal.has_access ? `
          <div style="font-size:12px;color:var(--t2);margin-bottom:10px">
            <b>Email:</b> ${esc(portal.email || '—')}
            ${portal.last_login_at ? ` &nbsp;·&nbsp; <b>Last login:</b> ${fD(portal.last_login_at.slice(0,10))}` : ' &nbsp;·&nbsp; Never logged in'}
          </div>
          <button class="btn btn-gh btn-sm" onclick="cdInvitePortal('${clientId}')">Re-send Invite</button>
        ` : `
          <div style="font-size:12px;color:var(--t3);margin-bottom:10px">Client has no portal access. Invite them to view their installment schedule and payment history online.</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="email" id="cd-portal-email-${clientId}" class="inp" placeholder="Client email address" style="flex:1;min-width:200px;font-size:13px;padding:8px 12px">
            <button class="btn btn-g btn-sm" onclick="cdInvitePortal('${clientId}')">Invite to Portal</button>
          </div>
        `}
      </div>
    </div>` : '';

    // ── Document type badge ──
    const docBadge = t => {
      const cfg = {
        agreement:     ['#2563eb','rgba(37,99,235,.1)','Agreement'],
        demand_notice: ['#dc2626','rgba(220,38,38,.1)','Demand Notice'],
        noc:           ['#16a34a','rgba(22,163,74,.1)','NOC'],
        receipt:       ['#d97706','rgba(217,119,6,.1)','Receipt'],
      };
      const [c,bg,lbl] = cfg[t] || ['var(--t3)','transparent',t];
      return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${bg};color:${c};border:1px solid ${c}44;white-space:nowrap">${lbl}</span>`;
    };

    // ── Open button per doc type ──
    const openBtn = doc => {
      if (doc.doc_type === 'agreement' && doc.sale_id)
        return `<button class="btn btn-gh btn-xs" onclick="window.open('reports/sale-agreement.html?sale_id=${encodeURIComponent(doc.sale_id)}&cid=${encodeURIComponent(S.cid)}','_blank')">Open</button>`;
      if (doc.doc_type === 'demand_notice' && doc.sale_id)
        return `<button class="btn btn-gh btn-xs" onclick="window.open('reports/demand-notice.html?sale_id=${encodeURIComponent(doc.sale_id)}&cid=${encodeURIComponent(S.cid)}','_blank')">Open</button>`;
      if (doc.doc_type === 'noc' && doc.noc_id)
        return `<button class="btn btn-gh btn-xs" onclick="window.open('reports/noc-certificate.html?noc_id=${encodeURIComponent(doc.noc_id)}&company_id=${encodeURIComponent(S.cid)}','_blank')">Open</button>`;
      if (doc.doc_type === 'receipt' && doc.payment_id)
        return `<button class="btn btn-gh btn-xs" onclick="window.open('reports/payment-receipt.html?payment_id=${encodeURIComponent(doc.payment_id)}&cid=${encodeURIComponent(S.cid)}','_blank')">Open</button>`;
      return '';
    };

    // ── Combine all docs into one sorted list ──
    const allDocs = [
      ...(d.sales    || []),
      ...(d.notices  || []),
      ...(d.nocs     || []),
      ...(d.receipts || [])
    ].sort((a, b) => {
      const da = a.date ? new Date(a.date) : new Date(0);
      const db = b.date ? new Date(b.date) : new Date(0);
      return db - da;
    });

    const tableHtml = !allDocs.length
      ? `<div style="padding:32px;text-align:center;color:var(--t3)"><div style="font-size:28px;margin-bottom:8px"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div style="font-size:13px;font-weight:600;color:var(--t2)">No documents yet</div><div style="font-size:12px;color:var(--t3);margin-top:4px">Documents appear here when agreements are made, notices are issued, or NOCs are granted.</div></div>`
      : `<div class="tw"><table class="t" style="width:100%">
          <thead><tr><th>Type</th><th>Reference</th><th>Date</th><th>Details</th><th style="width:1%"></th></tr></thead>
          <tbody>
            ${allDocs.map(doc => `<tr>
              <td style="padding:10px 12px">${docBadge(doc.doc_type)}</td>
              <td style="font-size:12px;font-family:monospace;font-weight:600">${esc(doc.ref || '—')}</td>
              <td style="font-size:12px;color:var(--t3)">${doc.date ? fD(doc.date) : '—'}</td>
              <td style="font-size:11px;color:var(--t3)">
                ${doc.unit_no ? 'Unit: '+esc(doc.unit_no) : ''}
                ${doc.project ? ' · '+esc(doc.project) : ''}
                ${doc.amount ? ' · PKR '+fM(doc.amount) : ''}
                ${doc.channel ? ' · '+esc(doc.channel) : ''}
              </td>
              <td style="padding:4px 8px">${openBtn(doc)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;

    body.innerHTML = portalCard + `<div class="card"><div class="ch"><h3>Generated Documents</h3></div>${tableHtml}</div>`;
    body.dataset.loaded = clientId;

  } catch(e) {
    body.innerHTML = `<div class="card"><div style="padding:16px;color:var(--err);font-size:12px">${esc(e.message || 'Failed to load documents')}</div></div>`;
  }
}

async function cdInvitePortal(clientId) {
  const emailInput = document.getElementById('cd-portal-email-' + clientId);
  const email = emailInput ? emailInput.value.trim() : '';
  if (!email || !email.includes('@')) { toast('Enter a valid email address', 'warn'); return; }

  try {
    const { data, error } = await supabase.rpc('admin_invite_portal_client', {
      p_client_id:  clientId,
      p_email:      email,
      p_company_id: S.cid
    });
    if (error) throw error;
    if (!data.success) throw new Error(data.error || 'Failed');
    toast(`Portal invite sent to ${esc(data.email)} — Temp password: ${data.temp_password}`, 'ok');
    // Reload documents tab to show updated portal status
    const body = document.getElementById('cd-documents-body');
    if (body) body.dataset.loaded = '';
    _cdLoadDocuments(clientId);
  } catch(e) {
    toast('Invite failed: ' + (e.message || 'Unknown error'), 'err');
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
  const c     = gclient(clientId);
  const label = { inactive:'deactivate', blacklisted:'blacklist', active:'reactivate' }[newStatus] || newStatus;

  // Blacklist is a restricted action — must go through maker-checker approval
  if (newStatus === 'blacklisted') {
    const comment = await _clBlacklistCommentPrompt(c?.fullName || 'this client');
    if (comment === null) return;

    try {
      const { data, error } = await supabase.rpc('create_approval_request', {
        p_data: {
          request_type: 'blacklist',
          entity_table: 'clients',
          entity_id:    clientId,
          title:        `Blacklist: ${c?.fullName || 'client'}`,
          comment:      comment,
          payload:      { status: 'blacklisted', client_id: clientId }
        }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Approval request failed');
      toast('Blacklist request submitted for admin approval', 'ok');
      if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
    } catch (err) {
      toast('Could not submit request: ' + err.message, 'err');
    }
    return;
  }

  // Deactivate / Reactivate: status changes are approval-gated server-side for
  // non-admins (reason_required -> prompt -> resubmit -> pending_approval). Admin applies directly.
  if (!confirm(`${label.charAt(0).toUpperCase()+label.slice(1)} client "${c?.fullName}"?`)) return;

  const doStatus = async (reason) => {
    const { data, error } = await supabase.rpc('update_client', {
      p_id:         clientId,
      p_company_id: S.cid,
      p_data:       { status: newStatus },
      p_reason:     reason || null
    });
    if (error) throw error;
    if (data?.status === 'pending_approval') {
      toast('Status change submitted for Admin approval', 'ok');
      if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
      return;
    }
    if (data?.error === 'reason_required') {
      if (typeof _apReason === 'function') {
        _apReason(`${label.charAt(0).toUpperCase()+label.slice(1)} Client`, 'A client status change requires Admin approval.',
          (r) => { doStatus(r).catch(e => toast('Could not update status: ' + e.message, 'err')); });
      } else { toast('A reason is required to request this change', 'warn'); }
      return;
    }
    if (!data?.success) { toast(data?.error || 'Update failed', 'err'); return; }
    await loadClientsCache(S.cid);
    toast(`Client ${label}d`, 'ok');
    rClientDetail();
  };
  try { await doStatus(null); }
  catch (err) {
    console.error('[setClientStatus]', err);
    toast('Could not update status: ' + err.message, 'err');
  }
}

// Maker comment modal for blacklist approval requests
function _clBlacklistCommentPrompt(clientName) {
  return new Promise(resolve => {
    document.getElementById('_cl-bl-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = '_cl-bl-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = `
      <div style="background:var(--surface,#0f172a);border:1px solid rgba(220,38,38,.35);border-radius:14px;padding:28px 24px 20px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.6)">
        <div style="font-size:16px;font-weight:700;color:#fca5a5;margin-bottom:6px">Blacklist Client — Approval Required</div>
        <div style="font-size:12px;color:var(--t3,rgba(255,255,255,.45));margin-bottom:16px">Blacklisting <strong style="color:var(--text,#f8fafc)">${esc(clientName)}</strong> requires admin approval.</div>
        <div style="font-size:11px;font-weight:600;color:var(--t2,rgba(255,255,255,.6));margin-bottom:6px">Reason for blacklisting <span style="color:var(--err,#f43f5e)">*</span></div>
        <textarea id="_cl-bl-txt" rows="3" autocomplete="off"
          placeholder="Explain why this client should be blacklisted (min 10 characters)…"
          style="width:100%;padding:9px 11px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.12);border-radius:8px;color:var(--text,#f1f5f9);font-size:13px;font-family:inherit;box-sizing:border-box;resize:vertical;outline:none"
          onfocus="this.style.borderColor='#dc2626'" onblur="this.style.borderColor='rgba(255,255,255,.12)'"></textarea>
        <div id="_cl-bl-err" style="font-size:11px;color:var(--err,#f43f5e);min-height:16px;margin-top:4px"></div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button id="_cl-bl-cancel" style="flex:1;padding:9px;background:transparent;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;color:var(--t2,rgba(255,255,255,.6));font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>
          <button id="_cl-bl-ok" style="flex:2;padding:9px;background:#dc2626;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Submit for Approval</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const txt   = ov.querySelector('#_cl-bl-txt');
    const errEl = ov.querySelector('#_cl-bl-err');
    setTimeout(() => txt?.focus(), 50);

    ov.querySelector('#_cl-bl-cancel').addEventListener('click', () => { ov.remove(); resolve(null); });
    ov.querySelector('#_cl-bl-ok').addEventListener('click', () => {
      const v = (txt?.value || '').trim();
      if (v.length < 10) { errEl.textContent = 'Please enter at least 10 characters.'; txt?.focus(); return; }
      ov.remove();
      resolve(v);
    });
  });
}

// ══ ADD / EDIT CLIENT MODAL ════════════════════════════════

function openClientModal(clientId) {
  // Legacy entry — now delegates to the ONE shared ClientForm (Phase 3E).
  ClientForm.open({ clientId: clientId || null, onSaved: function(){ if (_cid && clientId) rClientDetail(); else rClients(); } });
}

function closeClientModal() { cm('m-client'); }

// ── Project picker (injected into the static #m-client modal; login.html is frozen) ──
function _cfEnsureProjectPicker() {
  if (document.getElementById('cf-project')) return;
  const mb = document.querySelector('#m-client .mb');
  if (!mb) return;
  const fr = document.createElement('div');
  fr.className = 'fr'; fr.id = 'cf-project-row'; fr.style.marginBottom = '14px';
  fr.innerHTML = '<label class="fl">Project <span class="req-star">*</span></label>'
    + '<select id="cf-project" class="inp-light"></select>'
    + '<div class="cf-err" id="e-cf-project" style="font-size:11px;color:var(--err);margin-top:3px;min-height:14px"></div>';
  const anchor = document.getElementById('cf-dup-warn');
  if (anchor && anchor.parentNode === mb) mb.insertBefore(fr, anchor.nextSibling);
  else mb.insertBefore(fr, mb.firstChild);
}

// Fill the picker with the caller's accessible projects. Disabled on edit (project is immutable).
function _cfPopulateProjects(selectedId, isEdit) {
  const sel = document.getElementById('cf-project');
  if (!sel) return;
  const all = (typeof gprojects === 'function' ? gprojects() : (window._projectsCache || []))
    .filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
  sel.innerHTML = ['<option value="">— Select project —</option>']
    .concat(all.map(p => `<option value="${esc(p.id)}">${esc(p.projectName || p.name || 'Project')}</option>`))
    .join('');
  if (selectedId) sel.value = selectedId;
  else if (!isEdit && all.length === 1) sel.value = all[0].id;
  sel.disabled = !!isEdit;
}

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

  // Project is required on create (immutable on edit, where the picker is disabled)
  const _cfIsCreate = !((document.getElementById('cf-client-id')?.value || '').trim());
  const projId = (document.getElementById('cf-project')?.value || '').trim();
  if (_cfIsCreate) setErr('e-cf-project', !projId ? 'Project is required' : '', 'cf-project');

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
      payload.project_id = projId;
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
