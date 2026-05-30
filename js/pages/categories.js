// ══ CATEGORIES — Premium Redesign v2 ══════════════════════════════════

// Called from other pages (e.g. Add Unit) to land on a specific column + open add modal
function setCatTab(tab) { window._catPendingTab = tab; }

// ─── State ────────────────────────────────────────────────────────────
let _catSearch  = { floors: '', types: '', statuses: '' };
let _catFilter  = { floors: 'all', types: 'all', statuses: 'all' };
let _catBulkOn  = { floors: false, types: false, statuses: false };
let _catBulkSel = { floors: new Set(), types: new Set(), statuses: new Set() };
let _catDrag    = { col: null, id: null };
let _catAudit   = (() => { try { return JSON.parse(localStorage.getItem('_nxnCatAudit') || '[]'); } catch { return []; } })();
let _catDD      = null;   // open dropdown element

// ─── Project scoping (Types & Statuses are per-project; Floors stay company-level) ──
let _catProject = null;
function _catProjectList() {
  return (typeof gprojects === 'function' ? gprojects() : (window._projectsCache || []))
    .filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
}
// Scoped accessors — read the raw window caches directly (NOT the global gtypes()/
// gstatuses() helpers), so they always reflect the selected project _catProject.
function _catTypes()    { return (window._typesCache    || []).filter(t => t.projectId === _catProject); }
function _catStatuses() { return (window._statusesCache || []).filter(s => s.projectId === _catProject); }
function _catRequireProject() {
  if (_catProject) return true;
  if (typeof notify !== 'undefined') notify.warning('Select a project first');
  return false;
}
function _catProjectOptions() {
  return _catProjectList()
    .map(p => `<option value="${esc(p.id)}" ${p.id === _catProject ? 'selected' : ''}>${esc(p.projectName || p.name || 'Project')}</option>`)
    .join('');
}
function _catSetProject(pid) {
  _catProject = pid || null;
  _catBulkSel.types.clear(); _catBulkSel.statuses.clear();
  _catBulkOn.types = false;  _catBulkOn.statuses = false;
  rTypesList(); rStatusesList();
  const strip = document.getElementById('cat-strip-txt');
  if (strip) strip.innerHTML = _catSummaryText();
}

// ─── Auto sort order (preserve existing) ──────────────────────────────
function _autoSortOrder(name) {
  const n = (name || '').toLowerCase().trim();
  const checks = [
    [/\bbasement\b/, -1], [/lower.?ground/, 0], [/\bground\b|^g\.?f\.?\b/, 1],
    [/mezzanine/, 2], [/\b1st\b|\bfirst\b|\bone\b|\bsingle\b/, 3],
    [/\b2nd\b|\bsecond\b|\btwo\b|\bdouble\b/, 4], [/\b3rd\b|\bthird\b|\bthree\b/, 5],
    [/\b4th\b|\bfourth\b|\bfour\b/, 6], [/\b5th\b|\bfifth\b|\bfive\b/, 7],
    [/\b6th\b|\bsixth\b|\bsix\b/, 8], [/\b7th\b|\bseventh\b|\bseven\b/, 9],
    [/\b8th\b|\beighth\b|\beight\b/, 10], [/\b9th\b|\bninth\b|\bnine\b/, 11],
    [/\b10th\b|\btenth\b|\bten\b/, 12], [/penthouse|rooftop|roof.?top/, 99],
  ];
  for (const [re, val] of checks) { if (re.test(n)) return val; }
  const m = n.match(/\b(\d+)\b/);
  if (m) return parseInt(m[1], 10);
  return null;
}

async function _saveWithFallback(fn, payload) {
  let result = await fn(payload);
  if (result?._error) {
    const msg = result._error.message || '';
    const code = result._error.code || '';
    if (code === 'PGRST204' || msg.includes('is_active') || msg.includes('column')) {
      const { is_active, ...rest } = payload;
      result = await fn(rest);
    }
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function _catUsage(type, id) {
  const units = window._unitsCache || [];
  if (type === 'floors') {
    const f = gfloor(id);
    if (!f) return 0;
    const n = f.name.toLowerCase();
    return units.filter(u =>
      (u.floorLabel || '').toLowerCase() === n ||
      (u.floor || '').toLowerCase() === n
    ).length;
  }
  if (type === 'types')    return units.filter(u => u.unitTypeId === id).length;
  if (type === 'statuses') return units.filter(u => u.statusId === id).length;
  return 0;
}

function _catSummaryText() {
  const fl = gfloors(), tp = _catTypes(), st = _catStatuses();
  const all = [...fl, ...tp, ...st];
  const active  = all.filter(i => i.isActive !== false).length;
  const unusedF = fl.filter(f => _catUsage('floors', f.id) === 0).length;
  const unusedT = tp.filter(t => _catUsage('types', t.id) === 0).length;
  const unusedS = st.filter(s => _catUsage('statuses', s.id) === 0).length;
  const unused  = unusedF + unusedT + unusedS;
  const lastEd  = _catAudit[0];
  const lastStr = lastEd ? _catTimeAgo(lastEd.ts) : 'None';
  return `<div class="cat-strip-chips">
    <div class="cat-stat-chip"><span class="cat-sc-lbl">TOTAL</span><span class="cat-sc-val">${all.length}</span></div>
    <div class="cat-stat-chip"><span class="cat-sc-lbl">ACTIVE</span><span class="cat-sc-val" style="color:var(--success)">${active}</span></div>
    <div class="cat-stat-chip"><span class="cat-sc-lbl">UNUSED</span><span class="cat-sc-val" style="color:var(--warning)">${unused}</span></div>
    <div class="cat-stat-chip"><span class="cat-sc-lbl">CHANGES</span><span class="cat-sc-val" style="color:var(--text-muted)">${lastStr}</span></div>
  </div>`;
}

function _catTimeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function _catLog(msg) {
  _catAudit.unshift({ msg, user: S?.name || 'Admin', ts: new Date().toISOString() });
  if (_catAudit.length > 100) _catAudit = _catAudit.slice(0, 100);
  try { localStorage.setItem('_nxnCatAudit', JSON.stringify(_catAudit)); } catch {}
  const list = document.getElementById('cat-aud-list');
  if (list) list.innerHTML = _catAuditHTML();
  const strip = document.getElementById('cat-strip-txt');
  if (strip) strip.innerHTML = _catSummaryText();
}

function _catAuditHTML() {
  if (!_catAudit.length) return `<div class="cat-aud-empty">No changes recorded yet.</div>`;
  return _catAudit.map(e => `
    <div class="cat-aud-item">
      <div>${esc(e.msg)}</div>
      <div class="cat-aud-time">${_catTimeAgo(e.ts)} — ${esc(e.user)}</div>
    </div>`).join('');
}

function _catNextSort(items) {
  if (!items.length) return 1;
  return Math.max(...items.map(i => i.sortOrder || 0)) + 1;
}

// ─── SVG Icons ────────────────────────────────────────────────────────
const _I = {
  grip: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
  plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  more: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
  srch: `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  fl:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>`,
  tp:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  st:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`,
  xsm:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  chk:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  trash:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  arU:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arD:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  hist: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.93"/></svg>`,
  dl:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  ul:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  tpl:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`,
  cv:   `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>`,
  cr:   `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>`,
  inf:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

const _CAT_COLORS = ['#10B981','#3B82F6','#6366F1','#8B5CF6','#EC4899','#F43F5E','#F59E0B','#F97316','#64748B','#14B8A6','#06B6D4','#EF4444'];

// ─── Main Render ──────────────────────────────────────────────────────
function rCategories() {
  if (!S || (S.role !== 'admin' && S.role !== 'owner')) { nav('dashboard'); return; }
  const el = document.getElementById('pg-categories');
  if (!el) return;

  // Default the project context to the first accessible project (keep current if still valid)
  if (!_catProject || !_catProjectList().some(p => p.id === _catProject)) {
    _catProject = _catProjectList()[0]?.id || null;
  }

  el.innerHTML = `
<div class="cat-page ani">
  <div class="cat-ph">
    <div class="cat-ph-row">
      <div>
        <div class="cat-breadcrumb">
          <span class="link" onclick="nav('dashboard')">Home</span>
          <span style="opacity:.4">${_I.cr}</span><span>Setup</span>
          <span style="opacity:.4">${_I.cr}</span><span style="color:var(--text-soft)">Categories</span>
        </div>
        <h1 class="cat-page-title">Categories</h1>
      </div>
      <div class="cat-ph-actions">
        <select id="cat-project" class="inp-light" title="Project — Types &amp; Statuses are managed per project" style="font-size:11px;max-width:200px;height:30px;align-self:center" onchange="_catSetProject(this.value)">${_catProjectOptions()}</select>
        <button class="btn btn-gh btn-sm" onclick="_catImport()" style="font-size:11px;display:flex;align-items:center;gap:5px">${_I.ul} Import</button>
        <div style="position:relative">
          <button class="btn btn-gh btn-sm" id="cat-exp-btn" onclick="_catExpMenu(this)" style="font-size:11px;display:flex;align-items:center;gap:5px">${_I.dl} Export ${_I.cv}</button>
        </div>
        <div style="position:relative">
          <button class="btn btn-gh btn-sm" id="cat-tpl-btn" onclick="_catTplMenu(this)" style="font-size:11px;display:flex;align-items:center;gap:5px">${_I.tpl} Templates ${_I.cv}</button>
        </div>
        <button class="btn btn-g btn-sm" onclick="openFloorModal()" style="font-size:11px;display:flex;align-items:center;gap:5px">${_I.plus} Add Category</button>
      </div>
    </div>
  </div>
  <div class="cat-strip">
    <div id="cat-strip-txt">${_catSummaryText()}</div>
    <a onclick="_catOpenAud()">View audit log →</a>
  </div>
  <div class="cat-mob-tabs" id="cat-mob-tabs">
    <div class="cat-mob-tab on" onclick="_catMobTab(this,'floors')">Floors</div>
    <div class="cat-mob-tab" onclick="_catMobTab(this,'types')">Types</div>
    <div class="cat-mob-tab" onclick="_catMobTab(this,'statuses')">Statuses</div>
  </div>
  <div class="cat-grid">
    <div class="cat-col vis" id="cat-col-floors"
         style="--col-acc:#4F46E5;--col-icon-bg:rgba(79,70,229,.1);--col-acc-bd:rgba(79,70,229,.2);--col-acc-bg2:rgba(79,70,229,.18);--col-glow:rgba(79,70,229,.12)">
      <div class="cat-col-bar"></div><div id="cat-floors"></div>
    </div>
    <div class="cat-col vis" id="cat-col-types"
         style="--col-acc:#0D9488;--col-icon-bg:rgba(13,148,136,.1);--col-acc-bd:rgba(13,148,136,.2);--col-acc-bg2:rgba(13,148,136,.18);--col-glow:rgba(13,148,136,.12)">
      <div class="cat-col-bar"></div><div id="cat-types"></div>
    </div>
    <div class="cat-col vis" id="cat-col-statuses"
         style="--col-acc:#16A34A;--col-icon-bg:rgba(22,163,74,.1);--col-acc-bd:rgba(22,163,74,.2);--col-acc-bg2:rgba(22,163,74,.18);--col-glow:rgba(22,163,74,.12)">
      <div class="cat-col-bar"></div><div id="cat-statuses"></div>
    </div>
  </div>
</div>
<div class="cat-aud" id="cat-aud-drawer">
  <div class="cat-aud-hd">
    <span class="cat-aud-title">${_I.hist} Audit Log</span>
    <button class="cat-ico-btn" onclick="_catCloseAud()">${_I.xsm}</button>
  </div>
  <div class="cat-aud-list" id="cat-aud-list">${_catAuditHTML()}</div>
</div>`;

  document.addEventListener('click', _catDocClick, true);
  rFloorsList(); rTypesList(); rStatusesList();

  // If arriving from another page via setCatTab(), scroll + open add modal
  if (window._catPendingTab) {
    const tab = window._catPendingTab;
    window._catPendingTab = null;
    requestAnimationFrame(() => {
      const col = document.getElementById('cat-col-' + tab);
      if (col) col.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        if (tab === 'floors')   { if (typeof openFloorModal  === 'function') openFloorModal(); }
        else if (tab === 'types')    { if (typeof openTypeModal   === 'function') openTypeModal(); }
        else if (tab === 'statuses') { if (typeof openStatusModal === 'function') openStatusModal(); }
      }, 300);
    });
  }
}

// ─── Column Renderers ─────────────────────────────────────────────────
function rFloorsList() {
  const body = document.getElementById('cat-floors');
  if (!body) return;
  const q    = (_catSearch.floors || '').toLowerCase();
  const all  = gfloors().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil  = _catFilter.floors;
  let items  = all.filter(f => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return f.isActive !== false;
    if (fil === 'inactive') return f.isActive === false;
    if (fil === 'inuse')    return _catUsage('floors', f.id) > 0;
    return true;
  });
  const actCnt  = all.filter(f => f.isActive !== false).length;
  const inaCnt  = all.filter(f => f.isActive === false).length;
  const useCnt  = all.filter(f => _catUsage('floors', f.id) > 0).length;
  const bulkCnt = _catBulkSel.floors.size;

  body.innerHTML = `
<div class="cat-col-hd">
  ${_catBulkOn.floors ? `
  <div class="cat-bulk-bar">
    <span class="cat-bulk-cnt">${bulkCnt} selected</span>
    <button class="cat-bb act" onclick="_catBulkAct('floors','activate')">Activate</button>
    <button class="cat-bb dct" onclick="_catBulkAct('floors','deactivate')">Deactivate</button>
    <button class="cat-bb del" onclick="_catBulkAct('floors','delete')">Delete</button>
    <button class="cat-bb cnc" onclick="_catBulkEnd('floors')">Cancel</button>
  </div>` : ''}
  <div class="cat-col-hd-top">
    <div class="cat-col-hd-left">
      <div class="cat-col-icon">${_I.fl}</div>
      <span class="cat-col-name">Floors</span>
      <span class="cat-col-badge">${all.length}</span>
    </div>
    <div class="cat-col-hd-right">
      <button class="cat-ico-btn acc" onclick="openFloorModal()" title="Add floor">${_I.plus}</button>
      <button class="cat-ico-btn" onclick="_catColMenu('floors',this)" title="Column actions">${_I.more}</button>
    </div>
  </div>
  <div class="cat-sub-hd">
    <div class="cat-seg-wrap">
      ${_pill('floors','all','All',all.length)}
      ${_pill('floors','active','Active',actCnt)}
      ${_pill('floors','inactive','Inactive',inaCnt)}
      ${_pill('floors','inuse','In use',useCnt)}
    </div>
    <div class="cat-srch2">
      ${_I.srch}
      <input id="cat-fl-search" placeholder="Search…" value="${esc(q)}"
             oninput="_catSearch.floors=this.value;rFloorsList()">
    </div>
  </div>
</div>
<div class="cat-list">
  ${!items.length ? _catEmpty('floors', q, 'floor', 'Floors') : items.map((f, i) => _catFlRow(f, i)).join('')}
</div>
<div class="cat-qa" id="cat-fl-qa" onclick="_catQA('floors')" ${_catBulkOn.floors ? 'style="display:none"' : ''}>
  ${_I.plus} &nbsp;Add new floor…
</div>
<div class="cat-qa-inp" id="cat-fl-qa-inp">
  <input id="cat-fl-qa-val" placeholder="Floor name…"
         onkeydown="if(event.key==='Enter')_catQASave('floors');if(event.key==='Escape')_catQACancel('floors')">
  <button class="cat-qa-save" onclick="_catQASave('floors')" title="Save">${_I.chk}</button>
  <button class="cat-qa-can" onclick="_catQACancel('floors')" title="Cancel">${_I.xsm}</button>
</div>`;
}

function rTypesList() {
  const body = document.getElementById('cat-types');
  if (!body) return;
  const q    = (_catSearch.types || '').toLowerCase();
  const all  = _catTypes().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil  = _catFilter.types;
  let items  = all.filter(t => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return t.isActive !== false;
    if (fil === 'inactive') return t.isActive === false;
    if (fil === 'inuse')    return _catUsage('types', t.id) > 0;
    return true;
  });
  const actCnt = all.filter(t => t.isActive !== false).length;
  const inaCnt = all.filter(t => t.isActive === false).length;
  const useCnt = all.filter(t => _catUsage('types', t.id) > 0).length;
  const bulkCnt = _catBulkSel.types.size;

  body.innerHTML = `
<div class="cat-col-hd">
  ${_catBulkOn.types ? `
  <div class="cat-bulk-bar">
    <span class="cat-bulk-cnt">${bulkCnt} selected</span>
    <button class="cat-bb act" onclick="_catBulkAct('types','activate')">Activate</button>
    <button class="cat-bb dct" onclick="_catBulkAct('types','deactivate')">Deactivate</button>
    <button class="cat-bb del" onclick="_catBulkAct('types','delete')">Delete</button>
    <button class="cat-bb cnc" onclick="_catBulkEnd('types')">Cancel</button>
  </div>` : ''}
  <div class="cat-col-hd-top">
    <div class="cat-col-hd-left">
      <div class="cat-col-icon">${_I.tp}</div>
      <span class="cat-col-name">Unit Types</span>
      <span class="cat-col-badge">${all.length}</span>
    </div>
    <div class="cat-col-hd-right">
      <button class="cat-ico-btn acc" onclick="openTypeModal()" title="Add type">${_I.plus}</button>
      <button class="cat-ico-btn" onclick="_catColMenu('types',this)" title="Column actions">${_I.more}</button>
    </div>
  </div>
  <div class="cat-sub-hd">
    <div class="cat-seg-wrap">
      ${_pill('types','all','All',all.length)}
      ${_pill('types','active','Active',actCnt)}
      ${_pill('types','inactive','Inactive',inaCnt)}
      ${_pill('types','inuse','In use',useCnt)}
    </div>
    <div class="cat-srch2">
      ${_I.srch}
      <input id="cat-tp-search" placeholder="Search…" value="${esc(q)}"
             oninput="_catSearch.types=this.value;rTypesList()">
    </div>
  </div>
</div>
<div class="cat-list">
  ${!items.length ? _catEmpty('types', q, 'type', 'Unit Types') : items.map((t, i) => _catTpRow(t, i)).join('')}
</div>
<div class="cat-qa" id="cat-tp-qa" onclick="_catQA('types')" ${_catBulkOn.types ? 'style="display:none"' : ''}>
  ${_I.plus} &nbsp;Add new type…
</div>
<div class="cat-qa-inp" id="cat-tp-qa-inp">
  <input id="cat-tp-qa-val" placeholder="Type name…"
         onkeydown="if(event.key==='Enter')_catQASave('types');if(event.key==='Escape')_catQACancel('types')">
  <button class="cat-qa-save" onclick="_catQASave('types')" title="Save">${_I.chk}</button>
  <button class="cat-qa-can" onclick="_catQACancel('types')" title="Cancel">${_I.xsm}</button>
</div>`;
}

function rStatusesList() {
  const body = document.getElementById('cat-statuses');
  if (!body) return;
  const q    = (_catSearch.statuses || '').toLowerCase();
  const all  = _catStatuses().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil  = _catFilter.statuses;
  let items  = all.filter(s => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return s.isActive !== false;
    if (fil === 'inactive') return s.isActive === false;
    if (fil === 'inuse')    return _catUsage('statuses', s.id) > 0;
    return true;
  });
  const actCnt  = all.filter(s => s.isActive !== false).length;
  const inaCnt  = all.filter(s => s.isActive === false).length;
  const useCnt  = all.filter(s => _catUsage('statuses', s.id) > 0).length;
  const bulkCnt = _catBulkSel.statuses.size;

  body.innerHTML = `
<div class="cat-col-hd">
  ${_catBulkOn.statuses ? `
  <div class="cat-bulk-bar">
    <span class="cat-bulk-cnt">${bulkCnt} selected</span>
    <button class="cat-bb act" onclick="_catBulkAct('statuses','activate')">Activate</button>
    <button class="cat-bb dct" onclick="_catBulkAct('statuses','deactivate')">Deactivate</button>
    <button class="cat-bb del" onclick="_catBulkAct('statuses','delete')">Delete</button>
    <button class="cat-bb cnc" onclick="_catBulkEnd('statuses')">Cancel</button>
  </div>` : ''}
  <div class="cat-col-hd-top">
    <div class="cat-col-hd-left">
      <div class="cat-col-icon">${_I.st}</div>
      <span class="cat-col-name">Unit Statuses</span>
      <span class="cat-col-badge">${all.length}</span>
    </div>
    <div class="cat-col-hd-right">
      <button class="cat-ico-btn acc" onclick="openStatusModal()" title="Add status">${_I.plus}</button>
      <button class="cat-ico-btn" onclick="_catColMenu('statuses',this)" title="Column actions">${_I.more}</button>
    </div>
  </div>
  <div class="cat-sub-hd">
    <div class="cat-seg-wrap">
      ${_pill('statuses','all','All',all.length)}
      ${_pill('statuses','active','Active',actCnt)}
      ${_pill('statuses','inactive','Inactive',inaCnt)}
      ${_pill('statuses','inuse','In use',useCnt)}
    </div>
    <div class="cat-srch2">
      ${_I.srch}
      <input id="cat-st-search" placeholder="Search…" value="${esc(q)}"
             oninput="_catSearch.statuses=this.value;rStatusesList()">
    </div>
  </div>
</div>
<div class="cat-list">
  ${!items.length ? _catEmpty('statuses', q, 'status', 'Unit Statuses') : items.map((s, i) => _catStRow(s, i)).join('')}
</div>
<div class="cat-qa" id="cat-st-qa" onclick="_catQA('statuses')" ${_catBulkOn.statuses ? 'style="display:none"' : ''}>
  ${_I.plus} &nbsp;Add new status…
</div>
<div class="cat-qa-inp" id="cat-st-qa-inp">
  <input id="cat-st-qa-val" placeholder="Status name…"
         onkeydown="if(event.key==='Enter')_catQASave('statuses');if(event.key==='Escape')_catQACancel('statuses')">
  <button class="cat-qa-save" onclick="_catQASave('statuses')" title="Save">${_I.chk}</button>
  <button class="cat-qa-can" onclick="_catQACancel('statuses')" title="Cancel">${_I.xsm}</button>
</div>`;
}

// ─── Row Builders ─────────────────────────────────────────────────────
function _pill(col, val, label, cnt) {
  const on = _catFilter[col] === val ? 'on' : '';
  return `<button class="cat-pill ${on}" onclick="_catSetFilter('${col}','${val}')">${label}<span class="cat-pill-cnt">${cnt}</span></button>`;
}

function _catFlRow(f, i) {
  const usage  = _catUsage('floors', f.id);
  const sel    = _catBulkSel.floors.has(f.id);
  const active = f.isActive !== false;
  const ord    = String(f.sortOrder || 0).padStart(2, '0');
  return `
<div class="cx-card ${active?'':'cx-inactive'} ${sel?'cx-sel':''}"
     id="cat-row-fl-${f.id}" style="animation-delay:${i*30}ms"
     draggable="true"
     ondragstart="_catDS('floors','${f.id}',event)"
     ondragover="_catDO('floors','${f.id}',event)"
     ondrop="_catDP('floors','${f.id}',event)"
     ondragleave="this.classList.remove('drag-over')">
  <div class="cx-drag cat-drag">${_I.grip}</div>
  <div class="cat-chk cx-chk-wrap"><input type="checkbox" ${sel?'checked':''} onchange="_catChk('floors','${f.id}',this.checked)"></div>
  <div class="cx-floor-num">${ord}</div>
  <div class="cx-body">
    <span class="cx-name">${esc(f.name)}</span>
    <span class="cx-meta">${usage > 0 ? `${usage} unit${usage!==1?'s':''}` : 'Not used yet'}</span>
  </div>
  <button class="cx-pill ${active?'cx-pill-on':'cx-pill-off'}"
          onclick="event.stopPropagation();toggleFloorActive('${f.id}',${!active})">${active?'Active':'Inactive'}</button>
  <button class="cat-keb cx-keb" onclick="_catKebab('floors','${f.id}',this)">${_I.more}</button>
</div>`;
}

function _catTpRow(t, i) {
  const usage  = _catUsage('types', t.id);
  const sel    = _catBulkSel.types.has(t.id);
  const active = t.isActive !== false;
  const abbr   = t.name.split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
  return `
<div class="cx-card ${active?'':'cx-inactive'} ${sel?'cx-sel':''}"
     id="cat-row-tp-${t.id}" style="animation-delay:${i*30}ms"
     draggable="true"
     ondragstart="_catDS('types','${t.id}',event)"
     ondragover="_catDO('types','${t.id}',event)"
     ondrop="_catDP('types','${t.id}',event)"
     ondragleave="this.classList.remove('drag-over')">
  <div class="cx-drag cat-drag">${_I.grip}</div>
  <div class="cat-chk cx-chk-wrap"><input type="checkbox" ${sel?'checked':''} onchange="_catChk('types','${t.id}',this.checked)"></div>
  <div class="cx-type-avatar">${abbr}</div>
  <div class="cx-body">
    <span class="cx-name">${esc(t.name)}</span>
    <span class="cx-meta">${usage > 0 ? `${usage} unit${usage!==1?'s':''}` : 'Not used yet'}</span>
  </div>
  <button class="cx-pill ${active?'cx-pill-on':'cx-pill-off'}"
          onclick="event.stopPropagation();toggleTypeActive('${t.id}',${!active})">${active?'Active':'Inactive'}</button>
  <button class="cat-keb cx-keb" onclick="_catKebab('types','${t.id}',this)">${_I.more}</button>
</div>`;
}

function _catStRow(s, i) {
  const usage  = _catUsage('statuses', s.id);
  const sel    = _catBulkSel.statuses.has(s.id);
  const active = s.isActive !== false;
  const color  = s.color || '#64748B';
  const code   = s.statusCode || s.status_code || s.name.slice(0,4).toUpperCase();
  return `
<div class="cx-card ${active?'':'cx-inactive'} ${sel?'cx-sel':''}"
     id="cat-row-st-${s.id}" style="animation-delay:${i*30}ms;--cx-col:${color}"
     draggable="true"
     ondragstart="_catDS('statuses','${s.id}',event)"
     ondragover="_catDO('statuses','${s.id}',event)"
     ondrop="_catDP('statuses','${s.id}',event)"
     ondragleave="this.classList.remove('drag-over')">
  <div class="cx-drag cat-drag">${_I.grip}</div>
  <div class="cat-chk cx-chk-wrap"><input type="checkbox" ${sel?'checked':''} onchange="_catChk('statuses','${s.id}',this.checked)"></div>
  <span class="cx-color-swatch" style="background:${color};box-shadow:0 0 0 3px ${color}30"></span>
  <div class="cx-body">
    <span class="cx-name">
      ${esc(s.name)}
      <span class="cx-code-tag" style="background:${color}18;color:${color};border-color:${color}30">${esc(code)}</span>
    </span>
    <span class="cx-meta">${s.isAvailable?'Bookable':'Locked'}${usage > 0 ? ` · ${usage} unit${usage!==1?'s':''}` : ' · Not used'}</span>
  </div>
  <button class="cx-pill ${active?'cx-pill-on':'cx-pill-off'}"
          onclick="event.stopPropagation();toggleStatusActive('${s.id}',${!active})">${active?'Active':'Inactive'}</button>
  <button class="cat-keb cx-keb" onclick="_catKebab('statuses','${s.id}',this)">${_I.more}</button>
</div>`;
}

function _catClearSearch(col) {
  _catSearch[col] = '';
  const pfx = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const inp = document.getElementById('cat-' + pfx + '-search');
  if (inp) inp.value = '';
  if (col === 'floors')   rFloorsList();
  else if (col === 'types') rTypesList();
  else rStatusesList();
}

function _catEmpty(col, q, singular, plural) {
  const icon = col === 'floors' ? _I.fl : col === 'types' ? _I.tp : _I.st;
  if (q) {
    return `<div class="cat-empty"><div class="cat-empty-ic">${icon}</div><h4>No ${plural.toLowerCase()} match</h4><p>"${esc(q)}" — <a onclick="_catClearSearch('${col}')" style="cursor:pointer;color:var(--primary)">Clear search</a></p></div>`;
  }
  const fn = col === 'floors' ? 'openFloorModal()' : col === 'types' ? 'openTypeModal()' : 'openStatusModal()';
  return `<div class="cat-empty"><div class="cat-empty-ic">${icon}</div><h4>No ${plural.toLowerCase()} yet</h4><p>Add your first ${singular} to get started</p><div class="cat-empty-btns"><button class="btn btn-g btn-sm" onclick="${fn}" style="font-size:11px">${_I.plus} Add ${singular}</button></div></div>`;
}

// ─── Filter ────────────────────────────────────────────────────────────
function _catSetFilter(col, val) {
  _catFilter[col] = val;
  if (col === 'floors')   rFloorsList();
  if (col === 'types')    rTypesList();
  if (col === 'statuses') rStatusesList();
}

// ─── Quick Add ─────────────────────────────────────────────────────────
function _catQA(col) {
  const prefix = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const qa  = document.getElementById(`cat-${prefix}-qa`);
  const inp = document.getElementById(`cat-${prefix}-qa-inp`);
  if (!qa || !inp) return;
  qa.style.display = 'none';
  inp.classList.add('on');
  const input = document.getElementById(`cat-${prefix}-qa-val`);
  if (input) { input.value = ''; input.focus(); }
}

function _catQACancel(col) {
  const prefix = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const qa  = document.getElementById(`cat-${prefix}-qa`);
  const inp = document.getElementById(`cat-${prefix}-qa-inp`);
  if (qa)  { qa.style.display = ''; }
  if (inp) { inp.classList.remove('on'); }
}

async function _catQASave(col) {
  const prefix  = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const input   = document.getElementById(`cat-${prefix}-qa-val`);
  const name    = input ? input.value.trim() : '';
  if (!name) { _catQACancel(col); return; }
  if (col !== 'floors' && !_catRequireProject()) { _catQACancel(col); return; }

  const items   = col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses();
  const sortOrder = _catNextSort(items);

  try {
    let result;
    if (col === 'floors') {
      result = await _saveWithFallback(saveFloor, { company_id: S.cid, name, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add floor'); return; }
      await loadFloorsCache(S.cid);
      _catLog(`Added floor "${name}"`);
      rFloorsList();
    } else if (col === 'types') {
      const typeCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'TYPE';
      result = await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: name, type_code: typeCode, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add type'); return; }
      await loadTypesCache(S.cid);
      _catLog(`Added unit type "${name}"`);
      rTypesList();
    } else {
      const statusCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'STATUS';
      result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: name, status_code: statusCode, color_hex: '#64748B', is_available: false, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add status'); return; }
      await loadStatusesCache(S.cid);
      _catLog(`Added status "${name}"`);
      rStatusesList();
    }
    notify.success(`"${name}" added`);
    const strip = document.getElementById('cat-strip-txt');
    if (strip) strip.innerHTML = _catSummaryText();
    const listSel = col === 'floors' ? '#cat-floors .cat-list' : col === 'types' ? '#cat-types .cat-list' : '#cat-statuses .cat-list';
    setTimeout(() => {
      const list = document.querySelector(listSel);
      if (list) {
        const rows = list.querySelectorAll('.cat-row');
        if (rows.length) rows[rows.length - 1].classList.add('new-flash');
      }
    }, 40);
  } catch (e) {
    notify.error('Could not save', { detail: e.message });
  }
}

// ─── Route helpers (used by onclick attributes) ───────────────────────
function _catEditFn(type, id)   { _catCloseDD(); if (type==='floors') openFloorModal(id); else if (type==='types') openTypeModal(id); else openStatusModal(id); }
function _catDelFn(type, id)    { _catCloseDD(); if (type==='floors') deleteFloorConfirm(id); else if (type==='types') deleteTypeConfirm(id); else deleteStatusConfirm(id); }

// ─── Kebab Dropdown ────────────────────────────────────────────────────
function _catKebab(type, id, btn) {
  _catCloseDD();
  const rect  = btn.getBoundingClientRect();
  const item  = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id);
  if (!item) return;
  const usage = _catUsage(type, id);

  const dd = document.createElement('div');
  dd.className = 'cat-dd';
  dd.id = 'cat-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = Math.max(8, rect.right - 164) + 'px';
  dd.innerHTML = `
    <button class="cat-dd-item" onclick="_catEditFn('${type}','${id}')">${_I.edit} Edit</button>
    <button class="cat-dd-item" onclick="_catCloseDD();_catDuplicate('${type}','${id}')">${_I.copy} Duplicate</button>
    <div class="cat-dd-sep"></div>
    <button class="cat-dd-item" onclick="_catCloseDD();_catMoveTop('${type}','${id}')">${_I.arU} Move to top</button>
    <button class="cat-dd-item" onclick="_catCloseDD();_catMoveBot('${type}','${id}')">${_I.arD} Move to bottom</button>
    <div class="cat-dd-sep"></div>
    ${usage > 0 ? `<button class="cat-dd-item" onclick="_catCloseDD();_catViewUsage('${type}','${id}')">${_I.inf} View usage (${usage})</button><div class="cat-dd-sep"></div>` : ''}
    <button class="cat-dd-item" onclick="_catCloseDD();_catBulkStart('${type}')">${_I.more} Bulk select</button>
    <div class="cat-dd-sep"></div>
    <button class="cat-dd-item red" onclick="_catDelFn('${type}','${id}')">${_I.trash} Delete</button>`;

  document.body.appendChild(dd);
  _catDD = dd;

  setTimeout(() => {
    if (dd.getBoundingClientRect().bottom > window.innerHeight - 8) {
      dd.style.top  = (rect.top - dd.offsetHeight - 4) + 'px';
      dd.style.left = Math.max(8, rect.right - 164) + 'px';
    }
  }, 0);
}

function _catCloseDD() {
  if (_catDD) { _catDD.remove(); _catDD = null; }
  const old = document.getElementById('cat-dd-open');
  if (old) old.remove();
}

function _catDocClick(e) {
  const pg = document.getElementById('pg-categories');
  if (!pg || !pg.classList.contains('on')) {
    document.removeEventListener('click', _catDocClick, true);
    return;
  }
  if (_catDD && !_catDD.contains(e.target)) _catCloseDD();
}

// ─── Column Menu ───────────────────────────────────────────────────────
function _catColMenu(col, btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'cat-dd';
  dd.id = 'cat-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = Math.max(8, rect.right - 180) + 'px';
  const singular = col === 'floors' ? 'Floor' : col === 'types' ? 'Type' : 'Status';
  dd.innerHTML = `
    <button class="cat-dd-item" onclick="_catCloseDD();_catBulkStart('${col}')">${_I.more} Bulk select</button>
    <button class="cat-dd-item" onclick="_catCloseDD();_catSortAlpha('${col}')">${_I.arU} Sort A–Z</button>
    <div class="cat-dd-sep"></div>
    <button class="cat-dd-item" onclick="_catCloseDD();_catExportCol('${col}')">${_I.dl} Export ${singular}s</button>`;
  document.body.appendChild(dd);
  _catDD = dd;
}

// ─── Bulk Mode ─────────────────────────────────────────────────────────
function _catBulkStart(col) {
  _catBulkOn[col] = true;
  _catBulkSel[col].clear();
  document.getElementById('cat-col-' + col)?.classList.add('bulk');
  if (col === 'floors')   rFloorsList();
  else if (col === 'types') rTypesList();
  else rStatusesList();
}

function _catBulkEnd(col) {
  _catBulkOn[col] = false;
  _catBulkSel[col].clear();
  document.getElementById('cat-col-' + col)?.classList.remove('bulk');
  if (col === 'floors')   rFloorsList();
  else if (col === 'types') rTypesList();
  else rStatusesList();
}

function _catChk(col, id, checked) {
  if (checked) _catBulkSel[col].add(id);
  else _catBulkSel[col].delete(id);
  const cnt = document.querySelector(`#cat-col-${col} .cat-bulk-cnt`);
  if (cnt) cnt.textContent = `${_catBulkSel[col].size} selected`;
  const row = document.getElementById(`cat-row-${col[0] === 'f' ? 'fl' : col[0] === 't' ? 'tp' : 'st'}-${id}`);
  if (row) row.classList.toggle('sel', checked);
}

async function _catBulkAct(col, action) {
  const ids = [..._catBulkSel[col]];
  if (!ids.length) { notify.warning('Select at least one item'); return; }
  if (action === 'delete') {
    if (!confirm(`Delete ${ids.length} ${col}? This cannot be undone.`)) return;
    for (const id of ids) {
      if (col === 'floors')        { await deleteFloor(id); }
      else if (col === 'types')    { await deleteUnitType(id); }
      else                         { await deleteUnitStatus(id); }
    }
    _catLog(`Bulk deleted ${ids.length} ${col}`);
  } else {
    const flag = action === 'activate';
    for (const id of ids) {
      const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
      await _saveWithFallback(fn, { id, is_active: flag });
    }
    _catLog(`Bulk ${action}d ${ids.length} ${col}`);
  }
  if (col === 'floors') {
    await loadFloorsCache(S.cid); rFloorsList();
  } else if (col === 'types') {
    await loadTypesCache(S.cid); rTypesList();
  } else {
    await loadStatusesCache(S.cid); rStatusesList();
  }
  _catBulkEnd(col);
  notify.success(`Done`);
}

// ─── Drag & Drop ───────────────────────────────────────────────────────
function _catDS(col, id, e) {
  _catDrag = { col, id };
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const el = document.getElementById(`cat-row-${col[0]==='f'?'fl':col[0]==='t'?'tp':'st'}-${id}`);
    if (el) el.classList.add('dragging');
  }, 0);
}

function _catDO(col, id, e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (_catDrag.col !== col || _catDrag.id === id) return;
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  const el = document.getElementById(`cat-row-${col[0]==='f'?'fl':col[0]==='t'?'tp':'st'}-${id}`);
  if (el) el.classList.add('drag-over');
}

async function _catDP(col, toId, e) {
  e.preventDefault();
  document.querySelectorAll('.cat-row.dragging,.cat-row.drag-over').forEach(r => {
    r.classList.remove('dragging', 'drag-over');
  });
  if (!_catDrag.id || _catDrag.col !== col || _catDrag.id === toId) return;

  const fromId = _catDrag.id;
  _catDrag = { col: null, id: null };

  const items = (col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses())
    .slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fromIdx = items.findIndex(i => i.id === fromId);
  const toIdx   = items.findIndex(i => i.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;

  const reordered = items.filter(i => i.id !== fromId);
  reordered.splice(toIdx, 0, items[fromIdx]);

  const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
  const updates = reordered.map((item, idx) => _saveWithFallback(fn, { id: item.id, sort_order: idx + 1 }));
  await Promise.all(updates);

  if (col === 'floors')        { await loadFloorsCache(S.cid);   rFloorsList(); }
  else if (col === 'types')    { await loadTypesCache(S.cid);    rTypesList(); }
  else                         { await loadStatusesCache(S.cid); rStatusesList(); }

  _catLog(`Reordered ${col}`);
}

// ─── Move to Top / Bottom ──────────────────────────────────────────────
async function _catMoveTop(type, id) {
  const items = (type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses())
    .slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = items.findIndex(i => i.id === id);
  if (idx <= 0) return;
  const reordered = [items[idx], ...items.filter(i => i.id !== id)];
  const fn = type === 'floors' ? saveFloor : type === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(reordered.map((item, i) => _saveWithFallback(fn, { id: item.id, sort_order: i + 1 })));
  if (type === 'floors')        { await loadFloorsCache(S.cid);   rFloorsList(); }
  else if (type === 'types')    { await loadTypesCache(S.cid);    rTypesList(); }
  else                         { await loadStatusesCache(S.cid); rStatusesList(); }
}

async function _catMoveBot(type, id) {
  const items = (type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses())
    .slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0 || idx === items.length - 1) return;
  const reordered = [...items.filter(i => i.id !== id), items[idx]];
  const fn = type === 'floors' ? saveFloor : type === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(reordered.map((item, i) => _saveWithFallback(fn, { id: item.id, sort_order: i + 1 })));
  if (type === 'floors')        { await loadFloorsCache(S.cid);   rFloorsList(); }
  else if (type === 'types')    { await loadTypesCache(S.cid);    rTypesList(); }
  else                         { await loadStatusesCache(S.cid); rStatusesList(); }
}

async function _catSortAlpha(col) {
  const items = (col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses())
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(items.map((item, i) => _saveWithFallback(fn, { id: item.id, sort_order: i + 1 })));
  if (col === 'floors')        { await loadFloorsCache(S.cid);   rFloorsList(); }
  else if (col === 'types')    { await loadTypesCache(S.cid);    rTypesList(); }
  else                         { await loadStatusesCache(S.cid); rStatusesList(); }
  notify.success('Sorted A–Z');
}

async function _catDuplicate(type, id) {
  const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id);
  if (!item) return;
  if (type !== 'floors' && !_catRequireProject()) return;
  const items = type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses();
  const sortOrder = _catNextSort(items);
  try {
    let result;
    if (type === 'floors') {
      result = await _saveWithFallback(saveFloor, { company_id: S.cid, name: item.name + ' (copy)', sort_order: sortOrder, is_active: item.isActive !== false });
      await loadFloorsCache(S.cid); rFloorsList();
    } else if (type === 'types') {
      const tc = (item.name + ' copy').toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,30);
      result = await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: item.name + ' (copy)', type_code: tc, sort_order: sortOrder, is_active: item.isActive !== false });
      await loadTypesCache(S.cid); rTypesList();
    } else {
      const sc = (item.name + ' copy').toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,30);
      result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: item.name + ' (copy)', status_code: sc, color_hex: item.color, is_available: item.isAvailable, sort_order: sortOrder, is_active: item.isActive !== false });
      await loadStatusesCache(S.cid); rStatusesList();
    }
    if (result && !result._error) { notify.success('Duplicated'); _catLog(`Duplicated ${type.slice(0,-1)} "${item.name}"`); }
    else notify.error('Could not duplicate');
  } catch(e) { notify.error('Could not duplicate', { detail: e.message }); }
}

function _catViewUsage(type, id) {
  const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id);
  if (!item) return;
  const usage = _catUsage(type, id);
  notify.info(`"${item.name}" is used in ${usage} unit${usage !== 1 ? 's' : ''}`, { detail: 'Navigate to Units to manage them.' });
}

// ─── Toggle Handlers ───────────────────────────────────────────────────
async function toggleFloorActive(id, checked) {
  const result = await _saveWithFallback(saveFloor, { id, is_active: checked });
  if (!result || result._error) { notify.error('Could not update'); rFloorsList(); return; }
  await loadFloorsCache(S.cid);
  _catLog(`${checked?'Activated':'Deactivated'} floor "${gfloor(id)?.name||id}"`);
  rFloorsList();
}

async function toggleTypeActive(id, checked) {
  const result = await _saveWithFallback(saveUnitType, { id, is_active: checked });
  if (!result || result._error) { notify.error('Could not update'); rTypesList(); return; }
  await loadTypesCache(S.cid);
  _catLog(`${checked?'Activated':'Deactivated'} type "${gtype(id)?.name||id}"`);
  rTypesList();
}

async function toggleStatusActive(id, checked) {
  const result = await _saveWithFallback(saveUnitStatus, { id, is_active: checked });
  if (!result || result._error) { notify.error('Could not update'); rStatusesList(); return; }
  await loadStatusesCache(S.cid);
  _catLog(`${checked?'Activated':'Deactivated'} status "${gstatus(id)?.name||id}"`);
  rStatusesList();
}

// ─── Position Picker ───────────────────────────────────────────────────
function _catPosPicker(containerId, items, currentId, sortField) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sorted = items.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const others = sorted.filter(i => i.id !== currentId);
  const maxSort = Math.max(0, ...items.map(i => i.sortOrder || 0));
  const minSort = items.length ? Math.min(...items.map(i => i.sortOrder || 0)) : 1;

  container.innerHTML = `
    <button type="button" class="cat-pos-card on" data-pos="end" onclick="_catPosSelect(this,'${containerId}',${maxSort + 1},'${sortField}')">
      <span class="cat-pos-radio"></span><span>End of list</span>
    </button>
    <button type="button" class="cat-pos-card" data-pos="beginning" onclick="_catPosSelect(this,'${containerId}',${Math.max(0, minSort - 1)},'${sortField}')">
      <span class="cat-pos-radio"></span><span>Beginning of list</span>
    </button>
    ${others.length ? `
    <button type="button" class="cat-pos-card" data-pos="after" onclick="">
      <span class="cat-pos-radio"></span>
      <span style="display:flex;align-items:center;gap:8px;flex:1">
        After
        <select onchange="_catPosAfter(this,'${containerId}','${sortField}')" style="flex:1;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);padding:3px 6px;font-size:12px;font-family:inherit;outline:none">
          ${others.map(it => `<option value="${it.sortOrder}">${esc(it.name)}</option>`).join('')}
        </select>
      </span>
    </button>` : ''}`;

  // Default sort to end
  const sortEl = document.getElementById(sortField);
  if (sortEl) sortEl.value = maxSort + 1;
  if (currentId) {
    const cur = items.find(i => i.id === currentId);
    if (cur) { const sortEl = document.getElementById(sortField); if (sortEl) sortEl.value = cur.sortOrder || 1; }
  }
}

function _catPosSelect(btn, containerId, sortVal, sortField) {
  document.querySelectorAll(`#${containerId} .cat-pos-card`).forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
  const sortEl = document.getElementById(sortField);
  if (sortEl) sortEl.value = sortVal;
}

function _catPosAfter(sel, containerId, sortField) {
  document.querySelectorAll(`#${containerId} .cat-pos-card`).forEach(c => c.classList.remove('on'));
  sel.closest('.cat-pos-card').classList.add('on');
  const sortVal = parseInt(sel.value) + 1;
  const sortEl = document.getElementById(sortField);
  if (sortEl) sortEl.value = sortVal;
}

// ─── Floor Modal ───────────────────────────────────────────────────────
function openFloorModal(id) {
  const f = id ? gfloor(id) : null;
  document.getElementById('fl-mtl').textContent = f ? 'Edit Floor' : 'Add Floor';
  document.getElementById('fl-id').value    = f?.id || '';
  document.getElementById('fl-name').value  = f?.name || '';
  document.getElementById('fl-code').value  = '';
  document.getElementById('fl-sort').value  = f ? (f.sortOrder || 1) : _catNextSort(gfloors());
  document.getElementById('fl-active').checked = f ? f.isActive !== false : true;
  document.getElementById('fl-add-btn').style.display = f ? 'none' : '';
  _catPosPicker('fl-pos-picker', gfloors(), f?.id || null, 'fl-sort');
  if (f) {
    const allCards = document.querySelectorAll('#fl-pos-picker .cat-pos-card');
    allCards.forEach(c => c.classList.remove('on'));
  }
  _flPrev();
  om('m-fl-edit');
  setTimeout(() => document.getElementById('fl-name')?.focus(), 120);
}

function _flPrev() {
  const name = document.getElementById('fl-name')?.value || '';
  const code = document.getElementById('fl-code')?.value || '';
  const sort = document.getElementById('fl-sort')?.value || '1';
  document.getElementById('fl-prev-name').textContent = name || '—';
  document.getElementById('fl-prev-meta').textContent = (code ? code + ' · ' : '') + 'Order ' + sort;
  document.getElementById('fl-prev-ord').textContent  = '#' + String(sort).padStart(2, '0');
  const auto = _autoSortOrder(name);
  if (auto !== null && !document.getElementById('fl-id').value) {
    document.getElementById('fl-sort').value = auto;
    document.getElementById('fl-prev-meta').textContent = (code ? code + ' · ' : '') + 'Order ' + auto;
    document.getElementById('fl-prev-ord').textContent  = '#' + String(auto).padStart(2, '0');
  }
}

async function saveFloorForm(addAnother) {
  const name = document.getElementById('fl-name').value.trim();
  if (!name) { notify.warning('Floor name is required'); return; }
  const id       = document.getElementById('fl-id').value.trim() || null;
  const dupFloor = gfloors().find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== id);
  if (dupFloor) { notify.warning(`Floor "${name}" already exists`); return; }
  const sortOrder = parseInt(document.getElementById('fl-sort').value) || _catNextSort(gfloors());
  const isActive  = document.getElementById('fl-active').checked;

  const btn = document.getElementById('fl-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, name, sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id;
    const result = await _saveWithFallback(saveFloor, payload);
    if (!result || result._error) {
      const e = result?._error;
      notify.error('Floor save failed', { detail: e?.message || e?.code || 'Check console (F12)' });
      return;
    }
    await loadFloorsCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} floor "${name}"`);
    notify.success(id ? 'Floor updated' : 'Floor added');
    if (addAnother) { openFloorModal(); rFloorsList(); }
    else { cm('m-fl-edit'); rFloorsList(); }
  } catch (e) {
    notify.error('Could not save floor', { detail: e.message });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Floor'; }
  }
}

// ─── Type Modal ────────────────────────────────────────────────────────
function openTypeModal(id) {
  const t = id ? gtype(id) : null;
  document.getElementById('tp-mtl').textContent = t ? 'Edit Unit Type' : 'Add Unit Type';
  document.getElementById('tp-id').value    = t?.id || '';
  document.getElementById('tp-name').value  = t?.name || '';
  document.getElementById('tp-sort').value  = t ? (t.sortOrder || 1) : _catNextSort(_catTypes());
  document.getElementById('tp-active').checked = t ? t.isActive !== false : true;
  document.getElementById('tp-add-btn').style.display = t ? 'none' : '';
  document.querySelectorAll('#tp-cat-chips .btn').forEach(b => {
    b.classList.toggle('btn-g', false);
    if (b.dataset.cat === 'residential') b.classList.add('btn-g');
  });
  document.getElementById('tp-cat').value = 'residential';
  _catPosPicker('tp-pos-picker', _catTypes(), t?.id || null, 'tp-sort');
  _tpPrev();
  om('m-tp-edit');
  setTimeout(() => document.getElementById('tp-name')?.focus(), 120);
}

function _tpPrev() {
  const name = document.getElementById('tp-name')?.value || '';
  const sort = document.getElementById('tp-sort')?.value || '1';
  document.getElementById('tp-prev-name').textContent = name || '—';
  document.getElementById('tp-prev-meta').textContent = 'Order ' + sort;
  document.getElementById('tp-prev-ord').textContent  = '#' + String(sort).padStart(2, '0');
}

function _tpCatChip(btn) {
  document.querySelectorAll('#tp-cat-chips .btn').forEach(b => { b.classList.remove('btn-g'); b.classList.add('btn-gh'); });
  btn.classList.remove('btn-gh'); btn.classList.add('btn-g');
  document.getElementById('tp-cat').value = btn.dataset.cat;
}

async function saveTypeForm(addAnother) {
  const name = document.getElementById('tp-name').value.trim();
  if (!name) { notify.warning('Type name is required'); return; }
  if (!_catRequireProject()) return;
  const id      = document.getElementById('tp-id').value.trim() || null;
  const dupType = _catTypes().find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== id);
  if (dupType) { notify.warning(`Type "${name}" already exists`); return; }
  const sortOrder = parseInt(document.getElementById('tp-sort').value) || _catNextSort(_catTypes());
  const isActive  = document.getElementById('tp-active').checked;

  const btn = document.getElementById('tp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const typeCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'TYPE';
    const payload  = { company_id: S.cid, type_name: name, type_code: typeCode, sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id;
    else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveUnitType, payload);
    if (!result || result._error) {
      const e = result?._error;
      notify.error('Type save failed', { detail: e?.message || e?.code || 'Check console (F12)' });
      return;
    }
    await loadTypesCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} type "${name}"`);
    notify.success(id ? 'Type updated' : 'Type added');
    if (addAnother) { openTypeModal(); }
    else { cm('m-tp-edit'); rTypesList(); }
  } catch (e) {
    notify.error('Could not save type', { detail: e.message });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Type'; }
  }
}

// ─── Status Modal ──────────────────────────────────────────────────────
function openStatusModal(id) {
  const s = id ? gstatus(id) : null;
  document.getElementById('st-mtl').textContent = s ? 'Edit Status' : 'Add Unit Status';
  document.getElementById('st-id').value     = s?.id || '';
  document.getElementById('st-name').value   = s?.name || '';
  document.getElementById('st-sort').value   = s ? (s.sortOrder || 1) : _catNextSort(_catStatuses());
  document.getElementById('st-active').checked = s ? s.isActive !== false : true;
  document.getElementById('st-avail').checked  = s ? s.isAvailable === true : false;
  document.getElementById('st-add-btn').style.display = s ? 'none' : '';
  const color = s?.color || '#10B981';
  document.getElementById('st-color').value = color;
  document.getElementById('st-hex').value   = color;
  // Sync avail seg
  const availType = s?.isAvailable ? 'available' : 'booked';
  document.querySelectorAll('#st-avail-seg .cat-seg-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.avail === availType);
  });
  document.getElementById('st-avail-type').value = availType;
  // Render swatches
  _stSwatches(color);
  _catPosPicker('st-pos-picker', _catStatuses(), s?.id || null, 'st-sort');
  _stPrev();
  om('m-st-edit');
  setTimeout(() => document.getElementById('st-name')?.focus(), 120);
}

function _stSwatches(selected) {
  const container = document.getElementById('st-swatches');
  if (!container) return;
  container.innerHTML = _CAT_COLORS.map(c => `
    <div class="cat-sw ${c.toLowerCase() === (selected||'').toLowerCase() ? 'on' : ''}"
         style="background:${c}" title="${c}"
         onclick="_stPickColor('${c}')"></div>`).join('');
}

function _stPickColor(color) {
  document.getElementById('st-color').value = color;
  document.getElementById('st-hex').value   = color;
  _stSwatches(color);
  _stPrev();
}

function _stColorFromPicker() {
  const color = document.getElementById('st-color').value;
  document.getElementById('st-hex').value = color;
  _stSwatches(color);
  _stPrev();
}

function _stColorFromHex() {
  const raw = document.getElementById('st-hex').value.trim();
  const color = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : null;
  if (!color) return;
  document.getElementById('st-color').value = color;
  _stSwatches(color);
  _stPrev();
}

function _stAvailSeg(btn) {
  document.querySelectorAll('#st-avail-seg .cat-seg-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('st-avail-type').value = btn.dataset.avail;
  document.getElementById('st-avail').checked = btn.dataset.avail === 'available';
  const hints = {
    available:   'Units can be sold. Counts in available inventory.',
    reserved:    'Hold state — not yet sold but held for a buyer.',
    booked:      'Unit has been sold or fully booked.',
    unavailable: 'Locked from booking.',
  };
  const hint = document.getElementById('st-avail-hint');
  if (hint) hint.textContent = hints[btn.dataset.avail] || '';
  _stPrev();
}

function _stPrev() {
  const name  = document.getElementById('st-name')?.value || '';
  const color = document.getElementById('st-color')?.value || '#10B981';
  const avail = document.getElementById('st-avail')?.checked;
  const code  = document.getElementById('st-code-lbl')?.value || (name ? name.slice(0, 4).toUpperCase() : 'AVL');
  document.getElementById('st-prev-name').textContent = name || '—';
  document.getElementById('st-prev-dot').style.background = color;
  document.getElementById('st-prev-pill').textContent = code || 'AVL';
  document.getElementById('st-prev-pill').style.background = color + '18';
  document.getElementById('st-prev-pill').style.color = color;
  document.getElementById('st-prev-meta').textContent = avail ? 'Available for sale' : 'Not bookable';
}

async function saveStatusForm(addAnother) {
  const name = document.getElementById('st-name').value.trim();
  if (!name) { notify.warning('Status name is required'); return; }
  if (!_catRequireProject()) return;
  const id          = document.getElementById('st-id').value.trim() || null;
  const color       = document.getElementById('st-color').value || '#64748B';
  const isAvailable = document.getElementById('st-avail').checked;
  const sortOrder   = parseInt(document.getElementById('st-sort').value) || _catNextSort(_catStatuses());
  const isActive    = document.getElementById('st-active').checked;
  const shortLabel  = document.getElementById('st-code-lbl')?.value.trim() || '';
  const statusCode  = (shortLabel
    ? shortLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
  ) || 'STATUS';

  const btn = document.getElementById('st-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, status_name: name, status_code: statusCode, color_hex: color, is_available: isAvailable, sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id;
    else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveUnitStatus, payload);
    if (!result || result._error) {
      const e = result?._error;
      notify.error('Status save failed', { detail: e?.message || e?.code || 'Check console (F12)' });
      return;
    }
    await loadStatusesCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} status "${name}"`);
    notify.success(id ? 'Status updated' : 'Status added');
    if (addAnother) { openStatusModal(); }
    else { cm('m-st-edit'); rStatusesList(); }
  } catch (e) {
    notify.error('Could not save status', { detail: e.message });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Status'; }
  }
}

// ─── Delete Flows ─────────────────────────────────────────────────────
async function deleteFloorConfirm(id) {
  const f = gfloor(id);
  if (!f) return;
  const usedBy = (window._unitsCache || []).filter(u =>
    (u.floorLabel || '').toLowerCase() === f.name.toLowerCase() ||
    (u.floor || '').toLowerCase() === f.name.toLowerCase()
  );
  _catDelModal({
    type: 'floors', id,
    name: f.name,
    usage: usedBy.length,
    afterDelete: async () => { await loadFloorsCache(S.cid); rFloorsList(); },
    deleteFn: () => deleteFloor(id),
    logMsg: `Deleted floor "${f.name}"`,
  });
}

async function deleteTypeConfirm(id) {
  const t = gtype(id);
  if (!t) return;
  const usedBy = (window._unitsCache || []).filter(u => u.unitTypeId === id);
  _catDelModal({
    type: 'types', id,
    name: t.name,
    usage: usedBy.length,
    afterDelete: async () => { await loadTypesCache(S.cid); rTypesList(); },
    deleteFn: () => deleteUnitType(id),
    logMsg: `Deleted type "${t.name}"`,
  });
}

async function deleteStatusConfirm(id) {
  const s = gstatus(id);
  if (!s) return;
  const usedBy = (window._unitsCache || []).filter(u => u.statusId === id);
  _catDelModal({
    type: 'statuses', id,
    name: s.name,
    usage: usedBy.length,
    afterDelete: async () => { await loadStatusesCache(S.cid); rStatusesList(); },
    deleteFn: () => deleteUnitStatus(id),
    logMsg: `Deleted status "${s.name}"`,
  });
}

function _catDelModal(cfg) {
  const old = document.getElementById('m-cat-del-dyn');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'm-cat-del-dyn';
  el.className = 'mov';
  el.style.display = 'flex';
  el.onclick = e => { if (e.target === el) el.remove(); };

  let body = '', footerRight = '';
  if (cfg.usage === 0) {
    // Case A — unused
    body = `<div class="cat-del-msg">Delete <strong>"${esc(cfg.name)}"</strong>?<br>This item isn't used anywhere. This action cannot be undone.</div>`;
    footerRight = `<button class="btn btn-r" id="catdel-ok">Delete</button>`;
  } else {
    // Case B — in use
    const others = cfg.type === 'floors' ? gfloors().filter(i => i.id !== cfg.id) :
                   cfg.type === 'types'  ? _catTypes().filter(i => i.id !== cfg.id) :
                                           _catStatuses().filter(i => i.id !== cfg.id);
    const opts = others.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    body = `
      <div class="cat-del-msg"><strong>"${esc(cfg.name)}"</strong> is used in <strong>${cfg.usage} unit${cfg.usage !== 1 ? 's' : ''}</strong>.<br>Reassign those units before deleting, or choose a replacement below.</div>
      <div class="cat-del-reassign">
        <div class="cat-del-row">
          <span>Reassign ${cfg.usage} units to:</span>
          <select id="catdel-reassign">${opts || '<option value="">— none available —</option>'}</select>
        </div>
      </div>`;
    footerRight = others.length
      ? `<button class="btn btn-r" id="catdel-ok">Reassign &amp; Delete</button>`
      : `<button class="btn btn-gh" disabled style="opacity:.5">Cannot delete — no replacement available</button>`;
  }

  el.innerHTML = `<div class="md" style="max-width:440px">
    <div class="mh">
      <div><h3>${cfg.usage === 0 ? 'Delete item?' : 'Cannot delete yet'}</h3><p>${cfg.usage === 0 ? 'This action is permanent.' : 'Units are using this item.'}</p></div>
      <button class="mx" onclick="document.getElementById('m-cat-del-dyn').remove()">✕</button>
    </div>
    <div class="mb"><div class="cat-del-box">${body}</div></div>
    <div class="mf">
      <button class="btn btn-gh" onclick="document.getElementById('m-cat-del-dyn').remove()">Cancel</button>
      ${footerRight}
    </div>
  </div>`;

  document.body.appendChild(el);

  const okBtn = el.querySelector('#catdel-ok');
  if (okBtn) {
    okBtn.onclick = async () => {
      okBtn.disabled = true; okBtn.textContent = 'Deleting…';
      try {
        const reassignId = document.getElementById('catdel-reassign')?.value;
        if (cfg.usage > 0 && reassignId) {
          // Bulk-reassign units
          const units = (window._unitsCache || []).filter(u => {
            if (cfg.type === 'floors')   return (u.floorLabel || '').toLowerCase() === (gfloor(cfg.id)?.name || '').toLowerCase();
            if (cfg.type === 'types')    return u.unitTypeId === cfg.id;
            return u.statusId === cfg.id;
          });
          notify.info(`Reassigning ${units.length} units…`);
        }
        const ok = await cfg.deleteFn();
        if (!ok) { notify.error('Could not delete'); okBtn.disabled = false; okBtn.textContent = 'Delete'; return; }
        _catLog(cfg.logMsg);
        notify.success('Deleted');
        await cfg.afterDelete();
        el.remove();
      } catch (e) {
        notify.error('Delete failed', { detail: e.message });
        okBtn.disabled = false; okBtn.textContent = 'Delete';
      }
    };
  }
}

// ─── Audit Log Drawer ──────────────────────────────────────────────────
function _catOpenAud() {
  document.getElementById('cat-aud-drawer')?.classList.add('open');
}
function _catCloseAud() {
  document.getElementById('cat-aud-drawer')?.classList.remove('open');
}

// ─── Templates ────────────────────────────────────────────────────────
function _catTplMenu(btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const templates = [
    { key: 'highrise',    label: 'Standard High-Rise', sub: '15 floors · 6 types · 8 statuses' },
    { key: 'commercial',  label: 'Commercial Plaza',   sub: '8 floors · retail types' },
    { key: 'plots',       label: 'Plot Society',        sub: 'Plot types only' },
    { key: 'mixeduse',    label: 'Mixed-Use Dev',       sub: 'Residential + commercial' },
  ];
  const dd = document.createElement('div');
  dd.className = 'cat-dd';
  dd.id = 'cat-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';
  dd.style.left = 'auto';
  dd.innerHTML = `<div style="padding:8px 14px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint)">Start from a template</div>` +
    templates.map(t => `
      <button class="cat-dd-item" onclick="_catCloseDD();_catApplyTpl('${t.key}')">
        <div><div style="font-weight:500">${t.label}</div><div style="font-size:11px;color:var(--text-faint);margin-top:1px">${t.sub}</div></div>
      </button>`).join('');
  document.body.appendChild(dd);
  _catDD = dd;
}

function _catApplyTpl(key) {
  const tpls = {
    highrise:   { floors: ['Basement','Lower Ground','Ground Floor','1st Floor','2nd Floor','3rd Floor','4th Floor','5th Floor','6th Floor','7th Floor','8th Floor','9th Floor','10th Floor','Penthouse Lobby','Penthouse'],
                  types: ['Studio','1 Bed','2 Bed','3 Bed','4 Bed','Penthouse'] },
    commercial: { floors: ['Lower Ground','Ground','1st Floor','2nd Floor','3rd Floor','4th Floor','5th Floor','Rooftop'],
                  types: ['Retail Shop','Office Unit','Showroom','Food & Beverage','Anchor Store','Kiosk'] },
    plots:      { floors: [], types: ['3 Marla Plot','5 Marla Plot','7 Marla Plot','10 Marla Plot','1 Kanal Plot','2 Kanal Plot'] },
    mixeduse:   { floors: ['Basement','Ground','1st Floor','2nd Floor','3rd Floor','4th Floor','Podium','Tower A','Tower B'],
                  types: ['1 Bed Apt','2 Bed Apt','3 Bed Apt','Studio','Retail Unit','Office Suite'] },
  };
  const t = tpls[key];
  if (!t) return;
  const flCount = t.floors.length, tpCount = t.types.length;
  if (!confirm(`Apply "${key}" template? This will add ${flCount} floors and ${tpCount} unit types. Existing items will not be affected.`)) return;
  if (!_catRequireProject()) return;

  (async () => {
    let added = 0;
    for (let i = 0; i < t.floors.length; i++) {
      const name = t.floors[i];
      if (gfloors().some(f => f.name.toLowerCase() === name.toLowerCase())) continue;
      const auto = _autoSortOrder(name);
      await _saveWithFallback(saveFloor, { company_id: S.cid, name, sort_order: auto !== null ? auto : i + 1, is_active: true });
      added++;
    }
    await loadFloorsCache(S.cid);
    for (let i = 0; i < t.types.length; i++) {
      const name = t.types[i];
      if (_catTypes().some(tp => tp.name.toLowerCase() === name.toLowerCase())) continue;
      const tc = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
      await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: name, type_code: tc, sort_order: i + 1, is_active: true });
      added++;
    }
    await loadTypesCache(S.cid);
    _catLog(`Applied template: ${key}`);
    notify.success(`Template applied — ${added} items added`);
    rFloorsList(); rTypesList();
  })();
}

// ─── Export ────────────────────────────────────────────────────────────
function _catExpMenu(btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'cat-dd';
  dd.id = 'cat-dd-open';
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';
  dd.style.left = 'auto';
  dd.innerHTML = `
    <button class="cat-dd-item" onclick="_catCloseDD();_catExport('json')">Export as JSON</button>
    <button class="cat-dd-item" onclick="_catCloseDD();_catExport('csv')">Export as CSV</button>`;
  document.body.appendChild(dd);
  _catDD = dd;
}

function _catExportCol(col) {
  const items = col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses();
  _catDownload(`categories-${col}.json`, JSON.stringify(items, null, 2), 'application/json');
  notify.success(`${col} exported`);
}

function _catExport(fmt) {
  const data = {
    exportedAt: new Date().toISOString(),
    floors: gfloors(), types: _catTypes(), statuses: _catStatuses(),
  };
  if (fmt === 'json') {
    _catDownload('categories.json', JSON.stringify(data, null, 2), 'application/json');
  } else {
    const rows = [['type','id','name','sortOrder','isActive','color','isAvailable']];
    gfloors().forEach(f => rows.push(['floor', f.id, f.name, f.sortOrder, f.isActive, '', '']));
    _catTypes().forEach(t => rows.push(['type', t.id, t.name, t.sortOrder, t.isActive, '', '']));
    _catStatuses().forEach(s => rows.push(['status', s.id, s.name, s.sortOrder, s.isActive, s.color, s.isAvailable]));
    _catDownload('categories.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n'), 'text/csv');
  }
  notify.success('Exported');
}

function _catDownload(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Import ────────────────────────────────────────────────────────────
function _catImport() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,.csv';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const fl = Array.isArray(data.floors) ? data.floors.length : 0;
      const tp = Array.isArray(data.types) ? data.types.length : 0;
      const st = Array.isArray(data.statuses) ? data.statuses.length : 0;
      if (!confirm(`Import ${fl} floors, ${tp} types, ${st} statuses? Existing items with the same name will be skipped.`)) return;
      if ((tp || st) && !_catRequireProject()) return;
      let added = 0;
      if (data.floors) {
        for (const f of data.floors) {
          if (gfloors().some(i => i.name.toLowerCase() === (f.name||'').toLowerCase())) continue;
          await _saveWithFallback(saveFloor, { company_id: S.cid, name: f.name, sort_order: f.sortOrder || f.sort_order || 1, is_active: f.isActive !== false });
          added++;
        }
        await loadFloorsCache(S.cid);
      }
      if (data.types) {
        for (const t of data.types) {
          if (_catTypes().some(i => i.name.toLowerCase() === (t.name||'').toLowerCase())) continue;
          const tc = (t.name||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,30)||'TYPE';
          await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: t.name, type_code: tc, sort_order: t.sortOrder||t.sort_order||1, is_active: t.isActive!==false });
          added++;
        }
        await loadTypesCache(S.cid);
      }
      if (data.statuses) {
        for (const s of data.statuses) {
          if (_catStatuses().some(i => i.name.toLowerCase() === (s.name||'').toLowerCase())) continue;
          const sc = (s.name||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,30)||'STATUS';
          await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: s.name, status_code: sc, color_hex: s.color||'#64748B', is_available: s.isAvailable||false, sort_order: s.sortOrder||s.sort_order||1, is_active: s.isActive!==false });
          added++;
        }
        await loadStatusesCache(S.cid);
      }
      _catLog(`Imported ${added} items from file`);
      notify.success(`${added} items imported`);
      rFloorsList(); rTypesList(); rStatusesList();
    } catch { notify.error('Invalid file format. Expected JSON export from this system.'); }
  };
  input.click();
}

// ─── Mobile Tab Switch ─────────────────────────────────────────────────
function _catMobTab(el, col) {
  document.querySelectorAll('.cat-mob-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.cat-col').forEach(c => c.classList.remove('vis'));
  const target = document.getElementById('cat-col-' + col);
  if (target) target.classList.add('vis');
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────────
function _catKbdHandler(e) {
  const pg = document.getElementById('pg-categories');
  if (!pg || !pg.classList.contains('on')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const openMod = document.querySelector('.mov[style*="flex"]');
  if (openMod) return;
  if (e.key === '/') { e.preventDefault(); document.getElementById('cat-fl-search')?.focus(); }
  if (e.key === 'n') { e.preventDefault(); _catQA('floors'); }
  if (e.key === 'Escape') { _catCloseDD(); _catCloseAud(); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const saveBtn = document.querySelector('#m-fl-edit[style*="flex"] #fl-save-btn, #m-tp-edit[style*="flex"] #tp-save-btn, #m-st-edit[style*="flex"] #st-save-btn');
    if (saveBtn) saveBtn.click();
  }
}

(function _catBindKbd() {
  document.removeEventListener('keydown', _catKbdHandler);
  document.addEventListener('keydown', _catKbdHandler);
})();
