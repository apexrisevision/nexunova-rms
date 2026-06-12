// ══ TYPES & FLOORS (Categories) — restyled on the nx- foundation kit (batch 2) ══
// RESTYLE ≠ REBUILD: every behavior the owner relies on is preserved verbatim —
// smart delete w/ usage guard, live preview, drag-to-reorder, inline quick-add,
// bulk select. Only markup/classes moved to nx-/tokens. Status & Sale-type colors
// now render as kit chips with SEMANTIC tones (arbitrary hex palette retired).
// Floor editor surfaces floor_code; Type editor surfaces default area/price (#16).
// Edit modals are host-injected NX.modal (same field ids → save/preview untouched).

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
function _catTypes()    { return (window._typesCache    || []).filter(t => t.projectId === _catProject); }
function _catStatuses() { return (window._statusesCache || []).filter(s => s.projectId === _catProject); }
function _catSaleTypes(){ return (window._saleTypesCache || []).filter(s => s.projectId === _catProject); }
function gsaletype(id) { return (window._saleTypesCache || []).find(s => s.id === id) || null; }
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
  rTypesList(); rStatusesList(); rSaleTypesList();
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

// ─── Semantic tones (replace arbitrary status/saletype colours) ────────
// Tone is derived from meaning so chips read consistently across the app.
function _catStatusTone(s) {
  if (!s) return '';
  if (s.isAvailable === true) return 'success';
  const n = (s.name || '').toLowerCase();
  if (/sold|booked|complete/.test(n)) return 'info';
  if (/reserv|hold|pending|process/.test(n)) return 'warning';
  if (/cancel|block|dead|lock|legal/.test(n)) return 'danger';
  return '';
}
// Resolve a tone to its token hex at runtime (no hardcoded hex in source) — used
// only to satisfy the color_hex column the RPC still stores.
function _catToneHex(tone) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--fk-' + (tone || 'info')).trim();
    if (v) return v;
  } catch (e) {}
  return getComputedStyle(document.documentElement).getPropertyValue('--fk-info').trim() || '';
}
const _CAT_TONES = [
  { tone: 'success', label: 'Available / good' },
  { tone: 'info',    label: 'Sold / neutral' },
  { tone: 'warning', label: 'Reserved / hold' },
  { tone: 'danger',  label: 'Blocked / locked' },
  { tone: '',        label: 'Plain' },
];

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
  const chip = (lbl, val, tone) =>
    '<div style="display:flex;flex-direction:column;gap:1px">' +
      '<span class="nx-kpi-label">' + lbl + '</span>' +
      '<span class="num" style="font-size:var(--fk-fs-title)' + (tone ? ';color:var(--fk-' + tone + ')' : '') + '">' + val + '</span></div>';
  return '<div style="display:flex;gap:var(--fk-sp-4);flex-wrap:wrap">' +
    chip('Total', all.length, '') + chip('Active', active, 'success') +
    chip('Unused', unused, 'warning') + chip('Changes', lastStr, '') + '</div>';
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
  if (!_catAudit.length) return '<div class="nx-empty"><div class="nx-empty-msg">No changes recorded yet.</div></div>';
  return _catAudit.map(e =>
    '<div style="padding:8px 0;border-bottom:1px solid var(--fk-border)">' +
      '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + esc(e.msg) + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">' + _catTimeAgo(e.ts) + ' — ' + esc(e.user) + '</div>' +
    '</div>').join('');
}

function _catNextSort(items) {
  if (!items.length) return 1;
  return Math.max(...items.map(i => i.sortOrder || 0)) + 1;
}

// ─── Inline icons (currentColor SVG — no hex, no emoji) ────────────────
const _I = {
  grip: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
  plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  more: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
  srch: `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  xsm:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  chk:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  trash:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  arU:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arD:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  inf:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

// ─── Main Render ──────────────────────────────────────────────────────
function rCategories() {
  if (!S || (S.role !== 'admin' && S.role !== 'owner')) { nav('dashboard'); return; }
  const el = document.getElementById('pg-categories');
  if (!el) return;

  if (!_catProject || !_catProjectList().some(p => p.id === _catProject)) {
    _catProject = _catProjectList()[0]?.id || null;
  }

  const actions =
    '<select id="cat-project" class="nx-select" title="Types & Statuses are managed per project" style="max-width:200px;height:var(--fk-h-btn)" onchange="_catSetProject(this.value)">' + _catProjectOptions() + '</select>' +
    NX.button('Import',    { variant:'ghost', size:'sm', onclick:'_catImport()' }) +
    NX.button('Export',    { variant:'ghost', size:'sm', attrs:'id="cat-exp-btn"', onclick:'_catExpMenu(this)' }) +
    NX.button('Templates', { variant:'ghost', size:'sm', attrs:'id="cat-tpl-btn"', onclick:'_catTplMenu(this)' }) +
    NX.button('Add floor', { variant:'primary', icon:'plus', onclick:'openFloorModal()' });

  el.innerHTML =
    NX.pageHeader('Types & Floors', actions) +
    NX.card('<div id="cat-strip-txt">' + _catSummaryText() + '</div>' +
            '<div style="margin-top:var(--fk-sp-2)">' + NX.button('View audit log', { variant:'ghost', size:'sm', onclick:'_catOpenAud()' }) + '</div>', { compact:true }) +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
      '<div id="cat-col-floors"   class="nx-card nx-card--flush"><div id="cat-floors"></div></div>' +
      '<div id="cat-col-types"    class="nx-card nx-card--flush"><div id="cat-types"></div></div>' +
      '<div id="cat-col-statuses" class="nx-card nx-card--flush"><div id="cat-statuses"></div></div>' +
      '<div id="cat-col-saletypes" class="nx-card nx-card--flush"><div id="cat-saletypes"></div></div>' +
    '</div>' +
    '<div id="cat-modal-host"></div>' +
    '<div id="cat-aud-drawer" style="display:none">' +
      NX.modal({ title:'Audit log', size:'s', onClose:'_catCloseAud()', body:'<div id="cat-aud-list">' + _catAuditHTML() + '</div>' }) +
    '</div>';

  document.addEventListener('click', _catDocClick, true);
  rFloorsList(); rTypesList(); rStatusesList(); rSaleTypesList();

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
        else if (tab === 'saletypes') { if (typeof openSaleTypeModal === 'function') openSaleTypeModal(); }
      }, 300);
    });
  }
}

// ─── Column scaffold (header + pills + search + list + quick-add) ──────
function _catColHead(col, icon, title, count, addFn, withMenu) {
  return '<div style="padding:var(--fk-sp-3) var(--fk-sp-3) var(--fk-sp-2);border-bottom:1px solid var(--fk-border)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<div style="display:flex;align-items:center;gap:8px"><span style="color:var(--fk-text-muted)">' + icon + '</span>' +
        '<span style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + title + '</span>' + NX.chip(count) + '</div>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Add" onclick="' + addFn + '">' + _I.plus + '</button>' +
        (withMenu ? '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Column actions" onclick="_catColMenu(\'' + col + '\',this)">' + _I.more + '</button>' : '') +
      '</div></div></div>';
}
function _catSubHead(col, pills, q, oninput) {
  return '<div style="padding:var(--fk-sp-2) var(--fk-sp-3);display:flex;flex-direction:column;gap:var(--fk-sp-2)">' +
    '<div style="display:flex;gap:4px;flex-wrap:wrap">' + pills + '</div>' +
    '<div style="position:relative"><span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted)">' + _I.srch + '</span>' +
      '<input class="nx-input" style="padding-left:26px" placeholder="Search…" value="' + esc(q) + '" oninput="' + oninput + '"></div></div>';
}
function _catBulkBar(col, cnt) {
  return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:var(--fk-sp-2) var(--fk-sp-3);background:var(--fk-bg-subtle);border-bottom:1px solid var(--fk-border)">' +
    '<span class="nx-kpi-label cat-bulk-cnt" style="text-transform:none">' + cnt + ' selected</span><span style="flex:1"></span>' +
    NX.button('Activate',   { variant:'ghost',  size:'sm', onclick:"_catBulkAct('" + col + "','activate')" }) +
    NX.button('Deactivate', { variant:'ghost',  size:'sm', onclick:"_catBulkAct('" + col + "','deactivate')" }) +
    NX.button('Delete',     { variant:'danger', size:'sm', onclick:"_catBulkAct('" + col + "','delete')" }) +
    NX.button('Cancel',     { variant:'secondary', size:'sm', onclick:"_catBulkEnd('" + col + "')" }) + '</div>';
}
function _catQAInline(col, pfx, extra) {
  return '<div id="cat-' + pfx + '-qa" onclick="_catQA(\'' + col + '\')" ' + (_catBulkOn[col] ? 'style="display:none"' : '') + ' class="cat-qa-row">' +
      '<button class="nx-btn nx-btn--ghost nx-btn--sm" style="width:100%;justify-content:flex-start">' + _I.plus + '<span>Add new ' + col.replace(/s$/, '') + '…</span></button></div>' +
    '<div id="cat-' + pfx + '-qa-inp" class="cat-qa-inp" style="display:none;gap:6px;padding:var(--fk-sp-2) var(--fk-sp-3);align-items:center">' +
      '<input class="nx-input" id="cat-' + pfx + '-qa-val" placeholder="Name…" onkeydown="if(event.key===\'Enter\')_catQASave(\'' + col + '\');if(event.key===\'Escape\')_catQACancel(\'' + col + '\')">' +
      (extra || '') +
      NX.button('', { variant:'primary', size:'sm', attrs:'title="Save"', onclick:"_catQASave('" + col + "')" }).replace('></button>', '>' + _I.chk + '</button>') +
      NX.button('', { variant:'secondary', size:'sm', attrs:'title="Cancel"', onclick:"_catQACancel('" + col + "')" }).replace('></button>', '>' + _I.xsm + '</button>') + '</div>';
}

function rFloorsList() {
  const body = document.getElementById('cat-floors'); if (!body) return;
  const q = (_catSearch.floors || '').toLowerCase();
  const all = gfloors().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil = _catFilter.floors;
  const items = all.filter(f => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return f.isActive !== false;
    if (fil === 'inactive') return f.isActive === false;
    if (fil === 'inuse')    return _catUsage('floors', f.id) > 0;
    return true;
  });
  const actCnt = all.filter(f => f.isActive !== false).length;
  const inaCnt = all.filter(f => f.isActive === false).length;
  const useCnt = all.filter(f => _catUsage('floors', f.id) > 0).length;
  const pills = _pill('floors','all','All',all.length) + _pill('floors','active','Active',actCnt) + _pill('floors','inactive','Inactive',inaCnt) + _pill('floors','inuse','In use',useCnt);
  body.innerHTML =
    (_catBulkOn.floors ? _catBulkBar('floors', _catBulkSel.floors.size) : '') +
    _catColHead('floors', _I.grip, 'Floors', all.length, 'openFloorModal()', true) +
    _catSubHead('floors', pills, q, "_catSearch.floors=this.value;rFloorsList()") +
    '<div class="cat-list" style="padding:var(--fk-sp-1) var(--fk-sp-2)">' +
      (!items.length ? _catEmpty('floors', q, 'floor', 'Floors') : items.map((f, i) => _catFlRow(f, i)).join('')) + '</div>' +
    _catQAInline('floors', 'fl', '');
}

function rTypesList() {
  const body = document.getElementById('cat-types'); if (!body) return;
  const q = (_catSearch.types || '').toLowerCase();
  const all = _catTypes().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil = _catFilter.types;
  const items = all.filter(t => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return t.isActive !== false;
    if (fil === 'inactive') return t.isActive === false;
    if (fil === 'inuse')    return _catUsage('types', t.id) > 0;
    return true;
  });
  const actCnt = all.filter(t => t.isActive !== false).length;
  const inaCnt = all.filter(t => t.isActive === false).length;
  const useCnt = all.filter(t => _catUsage('types', t.id) > 0).length;
  const pills = _pill('types','all','All',all.length) + _pill('types','active','Active',actCnt) + _pill('types','inactive','Inactive',inaCnt) + _pill('types','inuse','In use',useCnt);
  body.innerHTML =
    (_catBulkOn.types ? _catBulkBar('types', _catBulkSel.types.size) : '') +
    _catColHead('types', _I.edit, 'Unit types', all.length, 'openTypeModal()', true) +
    _catSubHead('types', pills, q, "_catSearch.types=this.value;rTypesList()") +
    '<div class="cat-list" style="padding:var(--fk-sp-1) var(--fk-sp-2)">' +
      (!items.length ? _catEmpty('types', q, 'type', 'Unit Types') : items.map((t, i) => _catTpRow(t, i)).join('')) + '</div>' +
    _catQAInline('types', 'tp', '');
}

function rStatusesList() {
  const body = document.getElementById('cat-statuses'); if (!body) return;
  const q = (_catSearch.statuses || '').toLowerCase();
  const all = _catStatuses().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil = _catFilter.statuses;
  const items = all.filter(s => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return s.isActive !== false;
    if (fil === 'inactive') return s.isActive === false;
    if (fil === 'inuse')    return _catUsage('statuses', s.id) > 0;
    return true;
  });
  const actCnt = all.filter(s => s.isActive !== false).length;
  const inaCnt = all.filter(s => s.isActive === false).length;
  const useCnt = all.filter(s => _catUsage('statuses', s.id) > 0).length;
  const pills = _pill('statuses','all','All',all.length) + _pill('statuses','active','Active',actCnt) + _pill('statuses','inactive','Inactive',inaCnt) + _pill('statuses','inuse','In use',useCnt);
  const qaExtra = '<label title="Units with this status can be sold (appear in New Sale)" style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;font-size:var(--fk-fs-body);color:var(--fk-text)"><input type="checkbox" id="cat-st-qa-avail" checked> Sellable</label>';
  body.innerHTML =
    (_catBulkOn.statuses ? _catBulkBar('statuses', _catBulkSel.statuses.size) : '') +
    _catColHead('statuses', _I.inf, 'Unit statuses', all.length, 'openStatusModal()', true) +
    _catSubHead('statuses', pills, q, "_catSearch.statuses=this.value;rStatusesList()") +
    '<div class="cat-list" style="padding:var(--fk-sp-1) var(--fk-sp-2)">' +
      (!items.length ? _catEmpty('statuses', q, 'status', 'Unit Statuses') : items.map((s, i) => _catStRow(s, i)).join('')) + '</div>' +
    _catQAInline('statuses', 'st', qaExtra);
}

// ─── Row Builders (ids + drag/drop attrs + handlers preserved verbatim) ─
function _pill(col, val, label, cnt) {
  const on = _catFilter[col] === val;
  return NX.button(label + ' ' + cnt, { variant: on ? 'primary' : 'secondary', size:'sm', onclick:"_catSetFilter('" + col + "','" + val + "')" });
}

function _catRowShell(col, pfx, id, active, sel, inner) {
  return '<div class="cat-row cx-card' + (sel ? ' sel' : '') + '" id="cat-row-' + pfx + '-' + id + '"' +
    ' style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--fk-radius-control);border:1px solid transparent;' + (active ? '' : 'opacity:.55;') + '"' +
    ' draggable="true" ondragstart="_catDS(\'' + col + '\',\'' + id + '\',event)" ondragover="_catDO(\'' + col + '\',\'' + id + '\',event)"' +
    ' ondrop="_catDP(\'' + col + '\',\'' + id + '\',event)" ondragleave="this.classList.remove(\'drag-over\')">' + inner + '</div>';
}
function _catRowChk(col, id, sel) {
  return '<span class="cat-drag" style="cursor:grab;color:var(--fk-text-muted);display:flex">' + _I.grip + '</span>' +
    '<input type="checkbox" ' + (sel ? 'checked' : '') + ' onchange="_catChk(\'' + col + '\',\'' + id + '\',this.checked)">';
}
function _catRowEnd(col, id, active, toggleFn) {
  return '<button class="nx-btn ' + (active ? 'nx-btn--secondary' : 'nx-btn--ghost') + ' nx-btn--sm" onclick="event.stopPropagation();' + toggleFn + '(\'' + id + '\',' + (!active) + ')"><span>' + (active ? 'Active' : 'Inactive') + '</span></button>' +
    '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" onclick="_catKebab(\'' + col + '\',\'' + id + '\',this)">' + _I.more + '</button>';
}

function _catFlRow(f, i) {
  const usage = _catUsage('floors', f.id), sel = _catBulkSel.floors.has(f.id), active = f.isActive !== false;
  const ord = String(f.sortOrder || 0).padStart(2, '0');
  const code = f.floorCode || f.floor_code;
  const inner = _catRowChk('floors', f.id, sel) +
    '<span class="num" style="width:26px;color:var(--fk-text-muted);font-size:var(--fk-fs-label)">' + ord + '</span>' +
    '<div style="flex:1;min-width:0"><div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + esc(f.name) +
      (code ? ' <span class="nx-badge" style="margin-left:4px">' + esc(code) + '</span>' : '') + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">' + (usage > 0 ? usage + ' unit' + (usage !== 1 ? 's' : '') : 'Not used yet') + '</div></div>' +
    _catRowEnd('floors', f.id, active, 'toggleFloorActive');
  return _catRowShell('floors', 'fl', f.id, active, sel, inner);
}

function _catTpRow(t, i) {
  const usage = _catUsage('types', t.id), sel = _catBulkSel.types.has(t.id), active = t.isActive !== false;
  const abbr = t.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const dArea = t.defaultArea || t.default_area, dPrice = t.defaultPrice || t.default_price;
  const dmeta = [dArea ? dArea + ' sqft' : '', dPrice ? 'PKR ' + (typeof fM === 'function' ? fM(dPrice) : dPrice) : ''].filter(Boolean).join(' · ');
  const inner = _catRowChk('types', t.id, sel) +
    '<span class="num" style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:1px solid var(--fk-border);border-radius:6px;font-size:var(--fk-fs-label);color:var(--fk-text-muted)">' + esc(abbr) + '</span>' +
    '<div style="flex:1;min-width:0"><div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + esc(t.name) + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">' + (dmeta ? dmeta + ' · ' : '') + (usage > 0 ? usage + ' unit' + (usage !== 1 ? 's' : '') : 'Not used yet') + '</div></div>' +
    _catRowEnd('types', t.id, active, 'toggleTypeActive');
  return _catRowShell('types', 'tp', t.id, active, sel, inner);
}

function _catStRow(s, i) {
  const usage = _catUsage('statuses', s.id), sel = _catBulkSel.statuses.has(s.id), active = s.isActive !== false;
  const tone = _catStatusTone(s);
  const code = s.statusCode || s.status_code || s.name.slice(0, 4).toUpperCase();
  const inner = _catRowChk('statuses', s.id, sel) +
    '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;font-size:var(--fk-fs-body);color:var(--fk-text)">' +
      esc(s.name) + NX.badge(code, tone) + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">' + (s.isAvailable ? 'Bookable' : 'Locked') + (usage > 0 ? ' · ' + usage + ' unit' + (usage !== 1 ? 's' : '') : ' · Not used') + '</div></div>' +
    _catRowEnd('statuses', s.id, active, 'toggleStatusActive');
  return _catRowShell('statuses', 'st', s.id, active, sel, inner);
}

function _catClearSearch(col) {
  _catSearch[col] = '';
  if (col === 'floors') rFloorsList(); else if (col === 'types') rTypesList(); else rStatusesList();
}

function _catEmpty(col, q, singular, plural) {
  if (q) {
    return NX.empty({ icon:'search', message: 'No ' + plural.toLowerCase() + ' match "' + esc(q) + '".',
      action: NX.button('Clear search', { variant:'ghost', size:'sm', onclick:"_catClearSearch('" + col + "')" }) });
  }
  const fn = col === 'floors' ? 'openFloorModal()' : col === 'types' ? 'openTypeModal()' : col === 'statuses' ? 'openStatusModal()' : 'openSaleTypeModal()';
  return NX.empty({ icon:'inbox', message: 'No ' + plural.toLowerCase() + ' yet — add your first ' + singular + '.',
    action: NX.button('Add ' + singular, { variant:'primary', size:'sm', icon:'plus', onclick:fn }) });
}

// ─── Filter ────────────────────────────────────────────────────────────
function _catSetFilter(col, val) {
  _catFilter[col] = val;
  if (col === 'floors') rFloorsList(); if (col === 'types') rTypesList(); if (col === 'statuses') rStatusesList();
}

// ─── Quick Add (preserved) ─────────────────────────────────────────────
function _catQA(col) {
  const prefix = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const qa = document.getElementById(`cat-${prefix}-qa`), inp = document.getElementById(`cat-${prefix}-qa-inp`);
  if (!qa || !inp) return;
  qa.style.display = 'none'; inp.style.display = 'flex';
  const input = document.getElementById(`cat-${prefix}-qa-val`);
  if (input) { input.value = ''; input.focus(); }
}
function _catQACancel(col) {
  const prefix = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const qa = document.getElementById(`cat-${prefix}-qa`), inp = document.getElementById(`cat-${prefix}-qa-inp`);
  if (qa) qa.style.display = ''; if (inp) inp.style.display = 'none';
}
async function _catQASave(col) {
  const prefix = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const input = document.getElementById(`cat-${prefix}-qa-val`);
  const name = input ? input.value.trim() : '';
  if (!name) { _catQACancel(col); return; }
  if (col !== 'floors' && !_catRequireProject()) { _catQACancel(col); return; }
  const items = col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses();
  const sortOrder = _catNextSort(items);
  try {
    let result;
    if (col === 'floors') {
      result = await _saveWithFallback(saveFloor, { company_id: S.cid, name, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add floor'); return; }
      await loadFloorsCache(S.cid); _catLog(`Added floor "${name}"`); rFloorsList();
    } else if (col === 'types') {
      const typeCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'TYPE';
      result = await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: name, type_code: typeCode, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add type'); return; }
      await loadTypesCache(S.cid); _catLog(`Added unit type "${name}"`); rTypesList();
    } else {
      const statusCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'STATUS';
      const qaAvail = document.getElementById('cat-st-qa-avail')?.checked !== false;
      result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: name, status_code: statusCode, color_hex: _catToneHex(qaAvail ? 'success' : ''), is_available: qaAvail, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add status'); return; }
      await loadStatusesCache(S.cid); _catLog(`Added status "${name}"`); rStatusesList();
    }
    notify.success(`"${name}" added`);
    const strip = document.getElementById('cat-strip-txt'); if (strip) strip.innerHTML = _catSummaryText();
  } catch (e) { notify.error('Could not save', { detail: e.message }); }
}

// ─── Route helpers ─────────────────────────────────────────────────────
function _catEditFn(type, id) { _catCloseDD(); if (type === 'floors') openFloorModal(id); else if (type === 'types') openTypeModal(id); else openStatusModal(id); }
function _catDelFn(type, id)  { _catCloseDD(); if (type === 'floors') deleteFloorConfirm(id); else if (type === 'types') deleteTypeConfirm(id); else deleteStatusConfirm(id); }

// ─── Kebab + Column dropdowns (token-styled; same _catDD mechanism) ────
function _catDD_el(rect, alignRight) {
  const dd = document.createElement('div');
  dd.id = 'cat-dd-open';
  dd.style.cssText = 'position:fixed;z-index:10050;min-width:180px;background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card);box-shadow:var(--fk-shadow);padding:4px;display:flex;flex-direction:column;gap:2px;' +
    'top:' + (rect.bottom + 4) + 'px;' + (alignRight ? 'right:' + (window.innerWidth - rect.right) + 'px;left:auto;' : 'left:' + Math.max(8, rect.right - 180) + 'px;');
  return dd;
}
function _catDDItem(icon, label, onclick, danger) {
  return '<button class="nx-btn nx-btn--ghost nx-btn--sm" style="justify-content:flex-start;width:100%' + (danger ? ';color:var(--fk-danger)' : '') + '" onclick="' + onclick + '">' + (icon || '') + '<span>' + label + '</span></button>';
}
function _catKebab(type, id, btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id);
  if (!item) return;
  const usage = _catUsage(type, id);
  const dd = _catDD_el(rect, false);
  dd.innerHTML =
    _catDDItem(_I.edit, 'Edit', `_catEditFn('${type}','${id}')`) +
    _catDDItem(_I.copy, 'Duplicate', `_catCloseDD();_catDuplicate('${type}','${id}')`) +
    _catDDItem(_I.arU, 'Move to top', `_catCloseDD();_catMoveTop('${type}','${id}')`) +
    _catDDItem(_I.arD, 'Move to bottom', `_catCloseDD();_catMoveBot('${type}','${id}')`) +
    (usage > 0 ? _catDDItem(_I.inf, `View usage (${usage})`, `_catCloseDD();_catViewUsage('${type}','${id}')`) : '') +
    _catDDItem(_I.more, 'Bulk select', `_catCloseDD();_catBulkStart('${type}')`) +
    _catDDItem(_I.trash, 'Delete', `_catDelFn('${type}','${id}')`, true);
  document.body.appendChild(dd); _catDD = dd;
  setTimeout(() => { if (dd.getBoundingClientRect().bottom > window.innerHeight - 8) dd.style.top = (rect.top - dd.offsetHeight - 4) + 'px'; }, 0);
}
function _catCloseDD() {
  if (_catDD) { _catDD.remove(); _catDD = null; }
  const old = document.getElementById('cat-dd-open'); if (old) old.remove();
}
function _catDocClick(e) {
  const pg = document.getElementById('pg-categories');
  if (!pg || !pg.classList.contains('on')) { document.removeEventListener('click', _catDocClick, true); return; }
  if (_catDD && !_catDD.contains(e.target)) _catCloseDD();
}
function _catColMenu(col, btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const singular = col === 'floors' ? 'Floor' : col === 'types' ? 'Type' : 'Status';
  const dd = _catDD_el(rect, false);
  dd.innerHTML =
    _catDDItem(_I.more, 'Bulk select', `_catCloseDD();_catBulkStart('${col}')`) +
    _catDDItem(_I.arU, 'Sort A–Z', `_catCloseDD();_catSortAlpha('${col}')`) +
    _catDDItem('', 'Export ' + singular + 's', `_catCloseDD();_catExportCol('${col}')`);
  document.body.appendChild(dd); _catDD = dd;
}

// ─── Bulk Mode (preserved) ─────────────────────────────────────────────
function _catBulkStart(col) {
  _catBulkOn[col] = true; _catBulkSel[col].clear();
  if (col === 'floors') rFloorsList(); else if (col === 'types') rTypesList(); else rStatusesList();
}
function _catBulkEnd(col) {
  _catBulkOn[col] = false; _catBulkSel[col].clear();
  if (col === 'floors') rFloorsList(); else if (col === 'types') rTypesList(); else rStatusesList();
}
function _catChk(col, id, checked) {
  if (checked) _catBulkSel[col].add(id); else _catBulkSel[col].delete(id);
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
      if (col === 'floors') { await deleteFloor(id); } else if (col === 'types') { await deleteUnitType(id); } else { await deleteUnitStatus(id); }
    }
    _catLog(`Bulk deleted ${ids.length} ${col}`);
  } else {
    const flag = action === 'activate';
    for (const id of ids) {
      const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
      await _saveWithFallback(fn, { company_id: S.cid, id, is_active: flag });
    }
    _catLog(`Bulk ${action}d ${ids.length} ${col}`);
  }
  if (col === 'floors') { await loadFloorsCache(S.cid); rFloorsList(); }
  else if (col === 'types') { await loadTypesCache(S.cid); rTypesList(); }
  else { await loadStatusesCache(S.cid); rStatusesList(); }
  _catBulkEnd(col); notify.success('Done');
}

// ─── Drag & Drop (preserved verbatim) ──────────────────────────────────
function _catDS(col, id, e) {
  _catDrag = { col, id };
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = document.getElementById(`cat-row-${col[0]==='f'?'fl':col[0]==='t'?'tp':'st'}-${id}`); if (el) el.classList.add('dragging'); }, 0);
}
function _catDO(col, id, e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (_catDrag.col !== col || _catDrag.id === id) return;
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  const el = document.getElementById(`cat-row-${col[0]==='f'?'fl':col[0]==='t'?'tp':'st'}-${id}`);
  if (el) el.classList.add('drag-over');
}
async function _catDP(col, toId, e) {
  e.preventDefault();
  document.querySelectorAll('.cat-row.dragging,.cat-row.drag-over').forEach(r => r.classList.remove('dragging', 'drag-over'));
  if (!_catDrag.id || _catDrag.col !== col || _catDrag.id === toId) return;
  const fromId = _catDrag.id; _catDrag = { col: null, id: null };
  const items = (col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fromIdx = items.findIndex(i => i.id === fromId), toIdx = items.findIndex(i => i.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const reordered = items.filter(i => i.id !== fromId);
  reordered.splice(toIdx, 0, items[fromIdx]);
  const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(reordered.map((item, idx) => _saveWithFallback(fn, { company_id: S.cid, id: item.id, sort_order: idx + 1 })));
  if (col === 'floors') { await loadFloorsCache(S.cid); rFloorsList(); }
  else if (col === 'types') { await loadTypesCache(S.cid); rTypesList(); }
  else { await loadStatusesCache(S.cid); rStatusesList(); }
  _catLog(`Reordered ${col}`);
}

async function _catMoveTop(type, id) {
  const items = (type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = items.findIndex(i => i.id === id); if (idx <= 0) return;
  const reordered = [items[idx], ...items.filter(i => i.id !== id)];
  const fn = type === 'floors' ? saveFloor : type === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(reordered.map((item, i) => _saveWithFallback(fn, { company_id: S.cid, id: item.id, sort_order: i + 1 })));
  if (type === 'floors') { await loadFloorsCache(S.cid); rFloorsList(); }
  else if (type === 'types') { await loadTypesCache(S.cid); rTypesList(); }
  else { await loadStatusesCache(S.cid); rStatusesList(); }
}
async function _catMoveBot(type, id) {
  const items = (type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = items.findIndex(i => i.id === id); if (idx < 0 || idx === items.length - 1) return;
  const reordered = [...items.filter(i => i.id !== id), items[idx]];
  const fn = type === 'floors' ? saveFloor : type === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(reordered.map((item, i) => _saveWithFallback(fn, { company_id: S.cid, id: item.id, sort_order: i + 1 })));
  if (type === 'floors') { await loadFloorsCache(S.cid); rFloorsList(); }
  else if (type === 'types') { await loadTypesCache(S.cid); rTypesList(); }
  else { await loadStatusesCache(S.cid); rStatusesList(); }
}
async function _catSortAlpha(col) {
  const items = (col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => a.name.localeCompare(b.name));
  const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
  await Promise.all(items.map((item, i) => _saveWithFallback(fn, { company_id: S.cid, id: item.id, sort_order: i + 1 })));
  if (col === 'floors') { await loadFloorsCache(S.cid); rFloorsList(); }
  else if (col === 'types') { await loadTypesCache(S.cid); rTypesList(); }
  else { await loadStatusesCache(S.cid); rStatusesList(); }
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
      const tc = (item.name + ' copy').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
      result = await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: item.name + ' (copy)', type_code: tc, sort_order: sortOrder, is_active: item.isActive !== false });
      await loadTypesCache(S.cid); rTypesList();
    } else {
      const sc = (item.name + ' copy').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
      result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: item.name + ' (copy)', status_code: sc, color_hex: _catToneHex(_catStatusTone(item)), is_available: item.isAvailable, sort_order: sortOrder, is_active: item.isActive !== false });
      await loadStatusesCache(S.cid); rStatusesList();
    }
    if (result && !result._error) { notify.success('Duplicated'); _catLog(`Duplicated ${type.slice(0, -1)} "${item.name}"`); }
    else notify.error('Could not duplicate');
  } catch (e) { notify.error('Could not duplicate', { detail: e.message }); }
}
function _catViewUsage(type, id) {
  const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id);
  if (!item) return;
  const usage = _catUsage(type, id);
  notify.info(`"${item.name}" is used in ${usage} unit${usage !== 1 ? 's' : ''}`, { detail: 'Navigate to Units to manage them.' });
}

// ─── Toggle Handlers (preserved) ───────────────────────────────────────
async function toggleFloorActive(id, checked) {
  const result = await _saveWithFallback(saveFloor, { company_id: S.cid, id, is_active: checked });
  if (!result || result._error) { notify.error('Could not update'); rFloorsList(); return; }
  await loadFloorsCache(S.cid); _catLog(`${checked?'Activated':'Deactivated'} floor "${gfloor(id)?.name||id}"`); rFloorsList();
}
async function toggleTypeActive(id, checked) {
  const result = await _saveWithFallback(saveUnitType, { company_id: S.cid, id, is_active: checked });
  if (!result || result._error) { notify.error('Could not update'); rTypesList(); return; }
  await loadTypesCache(S.cid); _catLog(`${checked?'Activated':'Deactivated'} type "${gtype(id)?.name||id}"`); rTypesList();
}
async function toggleStatusActive(id, checked) {
  const result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, id, is_active: checked });
  if (!result || result._error) { notify.error('Could not update'); rStatusesList(); return; }
  await loadStatusesCache(S.cid); _catLog(`${checked?'Activated':'Deactivated'} status "${gstatus(id)?.name||id}"`); rStatusesList();
}

// ─── Position Picker (token-styled radio cards; same sort-field plumbing) ─
function _catPosPicker(containerId, items, currentId, sortField) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sorted = items.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const others = sorted.filter(i => i.id !== currentId);
  const maxSort = Math.max(0, ...items.map(i => i.sortOrder || 0));
  const minSort = items.length ? Math.min(...items.map(i => i.sortOrder || 0)) : 1;
  const cardCss = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-card);color:var(--fk-text);font-size:var(--fk-fs-body);cursor:pointer';
  container.innerHTML =
    `<button type="button" class="cat-pos-card on" data-pos="end" style="${cardCss}" onclick="_catPosSelect(this,'${containerId}',${maxSort + 1},'${sortField}')">End of list</button>` +
    `<button type="button" class="cat-pos-card" data-pos="beginning" style="${cardCss}" onclick="_catPosSelect(this,'${containerId}',${Math.max(0, minSort - 1)},'${sortField}')">Beginning of list</button>` +
    (others.length ? `<div class="cat-pos-card" data-pos="after" style="${cardCss}">After
        <select onchange="_catPosAfter(this,'${containerId}','${sortField}')" class="nx-select" style="flex:1;height:28px">
          ${others.map(it => `<option value="${it.sortOrder}">${esc(it.name)}</option>`).join('')}
        </select></div>` : '');
  const sortEl = document.getElementById(sortField);
  if (sortEl) sortEl.value = maxSort + 1;
  if (currentId) { const cur = items.find(i => i.id === currentId); if (cur && sortEl) sortEl.value = cur.sortOrder || 1; }
}
function _catPosSelect(btn, containerId, sortVal, sortField) {
  document.querySelectorAll(`#${containerId} .cat-pos-card`).forEach(c => { c.classList.remove('on'); c.style.borderColor = 'var(--fk-border)'; });
  btn.classList.add('on'); btn.style.borderColor = 'var(--fk-primary)';
  const sortEl = document.getElementById(sortField); if (sortEl) sortEl.value = sortVal;
}
function _catPosAfter(sel, containerId, sortField) {
  document.querySelectorAll(`#${containerId} .cat-pos-card`).forEach(c => { c.classList.remove('on'); c.style.borderColor = 'var(--fk-border)'; });
  sel.closest('.cat-pos-card').classList.add('on'); sel.closest('.cat-pos-card').style.borderColor = 'var(--fk-primary)';
  const sortEl = document.getElementById(sortField); if (sortEl) sortEl.value = parseInt(sel.value) + 1;
}

// ─── Modal host plumbing ───────────────────────────────────────────────
function _catModal(html) { const h = document.getElementById('cat-modal-host'); if (h) h.innerHTML = html; }
function _catCloseModal() { const h = document.getElementById('cat-modal-host'); if (h) h.innerHTML = ''; }
function _catActiveToggle(id, checked, onchange) {
  return '<label style="display:flex;align-items:center;justify-content:space-between;padding-top:var(--fk-sp-2);border-top:1px solid var(--fk-border);cursor:pointer">' +
    '<span><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">Active</span>' +
    '<div class="nx-kpi-label" style="text-transform:none">Available for new units</div></span>' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (onchange ? ' onchange="' + onchange + '"' : '') + '></label>';
}
function _catModalFooter(addBtnId, addFn, saveBtnId, saveFn, saveLbl, showAdd) {
  return NX.button('Cancel', { variant:'ghost', onclick:'_catCloseModal()' }) +
    NX.button('Save & add another', { variant:'secondary', attrs:'id="' + addBtnId + '"' + (showAdd ? '' : ' style="display:none"'), onclick:addFn }) +
    NX.button(saveLbl, { variant:'primary', attrs:'id="' + saveBtnId + '"', onclick:saveFn });
}

// ─── Floor Modal (now surfaces floor_code) ─────────────────────────────
function openFloorModal(id) {
  const f = id ? gfloor(id) : null;
  _catModal(NX.modal({
    title: f ? 'Edit floor' : 'Add floor', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="fl-id" value="' + (f?.id || '') + '">' +
      '<input type="hidden" id="fl-sort" value="' + (f ? (f.sortOrder || 1) : _catNextSort(gfloors())) + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
        '<span class="num" id="fl-prev-ord" style="color:var(--fk-text-muted)">#01</span>' +
        '<div><div style="font-size:var(--fk-fs-body);color:var(--fk-text)" id="fl-prev-name">—</div>' +
        '<div class="nx-kpi-label" style="text-transform:none" id="fl-prev-meta">Order 1</div></div></div>', { compact:true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Floor name', name:'fl-name', required:true, value:f?.name || '', placeholder:'e.g. Ground Floor', attrs:'oninput="_flPrev()"' }) +
        '<div class="nx-field"><label class="nx-label">Short code</label>' +
          '<input class="nx-input num" id="fl-code" maxlength="5" placeholder="GF" value="' + esc(f?.floorCode || f?.floor_code || '') + '" oninput="_flPrev()">' +
          '<div class="nx-kpi-label" style="text-transform:none">Used in unit numbers (e.g. G-01). Auto-derived if blank.</div></div>' +
      '</div>' +
      '<div class="nx-field"><label class="nx-label">Position</label><div id="fl-pos-picker" style="display:flex;flex-direction:column;gap:6px"></div></div>' +
      _catActiveToggle('fl-active', f ? f.isActive !== false : true, '_flPrev()'),
    footer: _catModalFooter('fl-add-btn', 'saveFloorForm(true)', 'fl-save-btn', 'saveFloorForm()', 'Save floor', !f)
  }));
  _catPosPicker('fl-pos-picker', gfloors(), f?.id || null, 'fl-sort');
  _flPrev();
  setTimeout(() => document.getElementById('fl-name')?.focus(), 120);
}
function _flPrev() {
  const name = document.getElementById('fl-name')?.value || '';
  const code = document.getElementById('fl-code')?.value || '';
  const sort = document.getElementById('fl-sort')?.value || '1';
  const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setT('fl-prev-name', name || '—');
  setT('fl-prev-meta', (code ? code + ' · ' : '') + 'Order ' + sort);
  setT('fl-prev-ord', '#' + String(sort).padStart(2, '0'));
  const auto = _autoSortOrder(name);
  if (auto !== null && !document.getElementById('fl-id').value) {
    document.getElementById('fl-sort').value = auto;
    setT('fl-prev-meta', (code ? code + ' · ' : '') + 'Order ' + auto);
    setT('fl-prev-ord', '#' + String(auto).padStart(2, '0'));
  }
}
async function saveFloorForm(addAnother) {
  const name = document.getElementById('fl-name').value.trim();
  if (!name) { notify.warning('Floor name is required'); return; }
  const id = document.getElementById('fl-id').value.trim() || null;
  const dupFloor = gfloors().find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== id);
  if (dupFloor) { notify.warning(`Floor "${name}" already exists`); return; }
  const sortOrder = parseInt(document.getElementById('fl-sort').value) || _catNextSort(gfloors());
  const isActive = document.getElementById('fl-active').checked;
  const code = (document.getElementById('fl-code')?.value || '').trim();
  const btn = document.getElementById('fl-save-btn'); const sp = btn?.querySelector('span');
  if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, name, sort_order: sortOrder, is_active: isActive };
    if (code) payload.floor_code = code;
    if (id) payload.id = id;
    const result = await _saveWithFallback(saveFloor, payload);
    if (!result || result._error) { notify.error('Floor save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadFloorsCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} floor "${name}"`);
    notify.success(id ? 'Floor updated' : 'Floor added');
    if (addAnother) { openFloorModal(); rFloorsList(); } else { _catCloseModal(); rFloorsList(); }
  } catch (e) { notify.error('Could not save floor', { detail: e.message }); }
  finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save floor'; } }
}

// ─── Type Modal (now surfaces default area / price #16) ────────────────
function openTypeModal(id) {
  const t = id ? gtype(id) : null;
  _catModal(NX.modal({
    title: t ? 'Edit unit type' : 'Add unit type', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="tp-id" value="' + (t?.id || '') + '">' +
      '<input type="hidden" id="tp-sort" value="' + (t ? (t.sortOrder || 1) : _catNextSort(_catTypes())) + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
        '<span class="num" id="tp-prev-ord" style="color:var(--fk-text-muted)">#01</span>' +
        '<div><div style="font-size:var(--fk-fs-body);color:var(--fk-text)" id="tp-prev-name">—</div>' +
        '<div class="nx-kpi-label" style="text-transform:none" id="tp-prev-meta">Order 1</div></div></div>', { compact:true }) +
      '<div style="margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Type name', name:'tp-name', required:true, value:t?.name || '', placeholder:'e.g. 2 Bed Apartment', attrs:'oninput="_tpPrev()"' }) + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Default area (sqft)', name:'tp-area', type:'number', value:(t?.defaultArea ?? t?.default_area ?? ''), placeholder:'e.g. 1200', attrs:'min="0" class="nx-input num"' }) +
        NX.field({ label:'Default price (PKR)', name:'tp-price', type:'number', value:(t?.defaultPrice ?? t?.default_price ?? ''), placeholder:'e.g. 8500000', attrs:'min="0" class="nx-input num"' }) +
      '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none;margin-top:-4px;margin-bottom:var(--fk-sp-2)">Pre-fills new units of this type (you can change any unit later).</div>' +
      '<div class="nx-field"><label class="nx-label">Position</label><div id="tp-pos-picker" style="display:flex;flex-direction:column;gap:6px"></div></div>' +
      _catActiveToggle('tp-active', t ? t.isActive !== false : true, '_tpPrev()'),
    footer: _catModalFooter('tp-add-btn', 'saveTypeForm(true)', 'tp-save-btn', 'saveTypeForm()', 'Save type', !t)
  }));
  _catPosPicker('tp-pos-picker', _catTypes(), t?.id || null, 'tp-sort');
  _tpPrev();
  setTimeout(() => document.getElementById('tp-name')?.focus(), 120);
}
function _tpPrev() {
  const name = document.getElementById('tp-name')?.value || '';
  const sort = document.getElementById('tp-sort')?.value || '1';
  const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setT('tp-prev-name', name || '—');
  setT('tp-prev-meta', 'Order ' + sort);
  setT('tp-prev-ord', '#' + String(sort).padStart(2, '0'));
}
async function saveTypeForm(addAnother) {
  const name = document.getElementById('tp-name').value.trim();
  if (!name) { notify.warning('Type name is required'); return; }
  if (!_catRequireProject()) return;
  const id = document.getElementById('tp-id').value.trim() || null;
  const dupType = _catTypes().find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== id);
  if (dupType) { notify.warning(`Type "${name}" already exists`); return; }
  const sortOrder = parseInt(document.getElementById('tp-sort').value) || _catNextSort(_catTypes());
  const isActive = document.getElementById('tp-active').checked;
  const area = parseFloat(document.getElementById('tp-area')?.value);
  const price = parseFloat(document.getElementById('tp-price')?.value);
  const btn = document.getElementById('tp-save-btn'); const sp = btn?.querySelector('span');
  if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const typeCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'TYPE';
    const payload = { company_id: S.cid, type_name: name, type_code: typeCode, sort_order: sortOrder, is_active: isActive };
    if (!isNaN(area))  payload.default_area = area;
    if (!isNaN(price)) payload.default_price = price;
    if (id) payload.id = id; else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveUnitType, payload);
    if (!result || result._error) { notify.error('Type save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadTypesCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} type "${name}"`);
    notify.success(id ? 'Type updated' : 'Type added');
    if (addAnother) { openTypeModal(); } else { _catCloseModal(); rTypesList(); }
  } catch (e) { notify.error('Could not save type', { detail: e.message }); }
  finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save type'; } }
}

// ─── Status Modal (semantic tone instead of arbitrary colour) ──────────
function openStatusModal(id) {
  const s = id ? gstatus(id) : null;
  const curTone = s ? _catStatusTone(s) : 'success';
  _catModal(NX.modal({
    title: s ? 'Edit status' : 'Add unit status', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="st-id" value="' + (s?.id || '') + '">' +
      '<input type="hidden" id="st-sort" value="' + (s ? (s.sortOrder || 1) : _catNextSort(_catStatuses())) + '">' +
      '<input type="hidden" id="st-tone" value="' + curTone + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div id="st-prev" style="margin-top:6px"></div>', { compact:true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Status name', name:'st-name', required:true, value:s?.name || '', placeholder:'e.g. Available', attrs:'oninput="_stPrev()"' }) +
        NX.field({ label:'Short label', name:'st-code-lbl', value:s?.statusCode || s?.status_code || '', maxlength:6, placeholder:'Avl', attrs:'maxlength="6" oninput="_stPrev()"' }) +
      '</div>' +
      '<div class="nx-field"><label class="nx-label">Tone</label><div id="st-tone-seg" style="display:flex;gap:6px;flex-wrap:wrap">' +
        _CAT_TONES.map(t => '<button type="button" class="nx-btn ' + (t.tone === curTone ? 'nx-btn--primary' : 'nx-btn--secondary') + ' nx-btn--sm" data-tone="' + t.tone + '" onclick="_stPickTone(this)">' +
          NX.badge(t.label, t.tone) + '</button>').join('') + '</div></div>' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:var(--fk-sp-2)">' +
        '<input type="checkbox" id="st-avail"' + (s ? (s.isAvailable === true ? ' checked' : '') : '') + ' onchange="_stPrev()">' +
        '<span><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">Sellable</span>' +
        '<div class="nx-kpi-label" style="text-transform:none">Units with this status appear in New Sale</div></span></label>' +
      '<div class="nx-field"><label class="nx-label">Position</label><div id="st-pos-picker" style="display:flex;flex-direction:column;gap:6px"></div></div>' +
      _catActiveToggle('st-active', s ? s.isActive !== false : true, '_stPrev()'),
    footer: _catModalFooter('st-add-btn', 'saveStatusForm(true)', 'st-save-btn', 'saveStatusForm()', 'Save status', !s)
  }));
  _catPosPicker('st-pos-picker', _catStatuses(), s?.id || null, 'st-sort');
  _stPrev();
  setTimeout(() => document.getElementById('st-name')?.focus(), 120);
}
function _stPickTone(btn) {
  document.querySelectorAll('#st-tone-seg .nx-btn').forEach(b => { b.classList.remove('nx-btn--primary'); b.classList.add('nx-btn--secondary'); });
  btn.classList.remove('nx-btn--secondary'); btn.classList.add('nx-btn--primary');
  document.getElementById('st-tone').value = btn.dataset.tone;
  _stPrev();
}
function _stPrev() {
  const name = document.getElementById('st-name')?.value || '';
  const avail = document.getElementById('st-avail')?.checked;
  const tone = document.getElementById('st-tone')?.value || '';
  const code = document.getElementById('st-code-lbl')?.value || (name ? name.slice(0, 4).toUpperCase() : 'AVL');
  const prev = document.getElementById('st-prev');
  if (prev) prev.innerHTML = '<div style="display:flex;align-items:center;gap:8px">' +
    '<span style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + (esc(name) || '—') + '</span>' + NX.badge(code || 'AVL', tone) +
    '<span class="nx-kpi-label" style="text-transform:none">' + (avail ? 'Available for sale' : 'Not bookable') + '</span></div>';
}
async function saveStatusForm(addAnother) {
  const name = document.getElementById('st-name').value.trim();
  if (!name) { notify.warning('Status name is required'); return; }
  if (!_catRequireProject()) return;
  const id = document.getElementById('st-id').value.trim() || null;
  const tone = document.getElementById('st-tone').value || '';
  const isAvailable = document.getElementById('st-avail').checked;
  const sortOrder = parseInt(document.getElementById('st-sort').value) || _catNextSort(_catStatuses());
  const isActive = document.getElementById('st-active').checked;
  const shortLabel = document.getElementById('st-code-lbl')?.value.trim() || '';
  const statusCode = (shortLabel ? shortLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)) || 'STATUS';
  const btn = document.getElementById('st-save-btn'); const sp = btn?.querySelector('span');
  if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, status_name: name, status_code: statusCode, color_hex: _catToneHex(tone), is_available: isAvailable, sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id; else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveUnitStatus, payload);
    if (!result || result._error) { notify.error('Status save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadStatusesCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} status "${name}"`);
    notify.success(id ? 'Status updated' : 'Status added');
    if (addAnother) { openStatusModal(); } else { _catCloseModal(); rStatusesList(); }
  } catch (e) { notify.error('Could not save status', { detail: e.message }); }
  finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save status'; } }
}

// ─── Delete Flows (smart delete + usage guard — preserved) ─────────────
async function deleteFloorConfirm(id) {
  const f = gfloor(id); if (!f) return;
  const usedBy = (window._unitsCache || []).filter(u => (u.floorLabel || '').toLowerCase() === f.name.toLowerCase() || (u.floor || '').toLowerCase() === f.name.toLowerCase());
  _catDelModal({ type: 'floors', id, name: f.name, usage: usedBy.length, afterDelete: async () => { await loadFloorsCache(S.cid); rFloorsList(); }, deleteFn: () => deleteFloor(id), logMsg: `Deleted floor "${f.name}"` });
}
async function deleteTypeConfirm(id) {
  const t = gtype(id); if (!t) return;
  const usedBy = (window._unitsCache || []).filter(u => u.unitTypeId === id);
  _catDelModal({ type: 'types', id, name: t.name, usage: usedBy.length, afterDelete: async () => { await loadTypesCache(S.cid); rTypesList(); }, deleteFn: () => deleteUnitType(id), logMsg: `Deleted type "${t.name}"` });
}
async function deleteStatusConfirm(id) {
  const s = gstatus(id); if (!s) return;
  const usedBy = (window._unitsCache || []).filter(u => u.statusId === id);
  _catDelModal({ type: 'statuses', id, name: s.name, usage: usedBy.length, afterDelete: async () => { await loadStatusesCache(S.cid); rStatusesList(); }, deleteFn: () => deleteUnitStatus(id), logMsg: `Deleted status "${s.name}"` });
}
function _catDelModal(cfg) {
  let body = '', footerRight = '';
  if (cfg.usage === 0) {
    body = NX.banner('"' + esc(cfg.name) + '" isn\'t used anywhere. This action cannot be undone.', 'warn');
    footerRight = NX.button('Delete', { variant:'danger', attrs:'id="catdel-ok"' });
  } else {
    const others = cfg.type === 'floors' ? gfloors().filter(i => i.id !== cfg.id) : cfg.type === 'types' ? _catTypes().filter(i => i.id !== cfg.id) : _catStatuses().filter(i => i.id !== cfg.id);
    const opts = others.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    body = NX.banner('"' + esc(cfg.name) + '" is used in ' + cfg.usage + ' unit' + (cfg.usage !== 1 ? 's' : '') + '. Reassign those units before deleting, or pick a replacement.', 'danger') +
      '<div class="nx-field" style="margin-top:var(--fk-sp-3)"><label class="nx-label">Reassign ' + cfg.usage + ' units to</label>' +
      '<select class="nx-select" id="catdel-reassign">' + (opts || '<option value="">— none available —</option>') + '</select></div>';
    footerRight = others.length ? NX.button('Reassign & delete', { variant:'danger', attrs:'id="catdel-ok"' }) :
      NX.button('No replacement available', { variant:'ghost', disabled:true });
  }
  _catModal(NX.modal({
    title: cfg.usage === 0 ? 'Delete item?' : 'Cannot delete yet', size:'s', onClose:'_catCloseModal()',
    body, footer: NX.button('Cancel', { variant:'ghost', onclick:'_catCloseModal()' }) + footerRight
  }));
  const okBtn = document.getElementById('catdel-ok');
  if (okBtn) okBtn.onclick = async () => {
    okBtn.disabled = true; const sp = okBtn.querySelector('span'); if (sp) sp.textContent = 'Deleting…';
    try {
      const reassignId = document.getElementById('catdel-reassign')?.value;
      if (cfg.usage > 0 && reassignId) {
        const units = (window._unitsCache || []).filter(u => {
          if (cfg.type === 'floors') return (u.floorLabel || '').toLowerCase() === (gfloor(cfg.id)?.name || '').toLowerCase();
          if (cfg.type === 'types') return u.unitTypeId === cfg.id;
          return u.statusId === cfg.id;
        });
        notify.info(`Reassigning ${units.length} units…`);
      }
      const ok = await cfg.deleteFn();
      if (!ok) { notify.error('Could not delete'); okBtn.disabled = false; if (sp) sp.textContent = 'Delete'; return; }
      _catLog(cfg.logMsg); notify.success('Deleted');
      await cfg.afterDelete(); _catCloseModal();
    } catch (e) { notify.error('Delete failed', { detail: e.message }); okBtn.disabled = false; if (sp) sp.textContent = 'Delete'; }
  };
}

// ─── Audit Log ─────────────────────────────────────────────────────────
function _catOpenAud() { const d = document.getElementById('cat-aud-drawer'); if (d) { d.style.display = ''; const l = document.getElementById('cat-aud-list'); if (l) l.innerHTML = _catAuditHTML(); } }
function _catCloseAud() { const d = document.getElementById('cat-aud-drawer'); if (d) d.style.display = 'none'; }

// ─── Templates ─────────────────────────────────────────────────────────
function _catTplMenu(btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const templates = [
    { key:'highrise', label:'Standard High-Rise', sub:'15 floors · 6 types' },
    { key:'commercial', label:'Commercial Plaza', sub:'8 floors · retail types' },
    { key:'plots', label:'Plot Society', sub:'Plot types only' },
    { key:'mixeduse', label:'Mixed-Use Dev', sub:'Residential + commercial' },
  ];
  const dd = _catDD_el(rect, true); dd.style.minWidth = '220px';
  dd.innerHTML = templates.map(t =>
    '<button class="nx-btn nx-btn--ghost nx-btn--sm" style="justify-content:flex-start;width:100%;height:auto;padding:8px 10px" onclick="_catCloseDD();_catApplyTpl(\'' + t.key + '\')">' +
      '<span style="display:block;text-align:left"><div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + t.label + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">' + t.sub + '</div></span></button>').join('');
  document.body.appendChild(dd); _catDD = dd;
}
function _catApplyTpl(key) {
  const tpls = {
    highrise: { floors: ['Basement','Lower Ground','Ground Floor','1st Floor','2nd Floor','3rd Floor','4th Floor','5th Floor','6th Floor','7th Floor','8th Floor','9th Floor','10th Floor','Penthouse Lobby','Penthouse'], types: ['Studio','1 Bed','2 Bed','3 Bed','4 Bed','Penthouse'] },
    commercial: { floors: ['Lower Ground','Ground','1st Floor','2nd Floor','3rd Floor','4th Floor','5th Floor','Rooftop'], types: ['Retail Shop','Office Unit','Showroom','Food & Beverage','Anchor Store','Kiosk'] },
    plots: { floors: [], types: ['3 Marla Plot','5 Marla Plot','7 Marla Plot','10 Marla Plot','1 Kanal Plot','2 Kanal Plot'] },
    mixeduse: { floors: ['Basement','Ground','1st Floor','2nd Floor','3rd Floor','4th Floor','Podium','Tower A','Tower B'], types: ['1 Bed Apt','2 Bed Apt','3 Bed Apt','Studio','Retail Unit','Office Suite'] },
  };
  const t = tpls[key]; if (!t) return;
  if (!confirm(`Apply "${key}" template? This will add ${t.floors.length} floors and ${t.types.length} unit types. Existing items are not affected.`)) return;
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
    _catLog(`Applied template: ${key}`); notify.success(`Template applied — ${added} items added`);
    rFloorsList(); rTypesList();
  })();
}

// ─── Export / Import ───────────────────────────────────────────────────
function _catExpMenu(btn) {
  _catCloseDD();
  const rect = btn.getBoundingClientRect();
  const dd = _catDD_el(rect, true);
  dd.innerHTML = _catDDItem('', 'Export as JSON', "_catCloseDD();_catExport('json')") + _catDDItem('', 'Export as CSV', "_catCloseDD();_catExport('csv')");
  document.body.appendChild(dd); _catDD = dd;
}
function _catExportCol(col) {
  const items = col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses();
  _catDownload(`categories-${col}.json`, JSON.stringify(items, null, 2), 'application/json');
  notify.success(`${col} exported`);
}
function _catExport(fmt) {
  const data = { exportedAt: new Date().toISOString(), floors: gfloors(), types: _catTypes(), statuses: _catStatuses() };
  if (fmt === 'json') { _catDownload('categories.json', JSON.stringify(data, null, 2), 'application/json'); }
  else {
    const rows = [['type','id','name','sortOrder','isActive','isAvailable']];
    gfloors().forEach(f => rows.push(['floor', f.id, f.name, f.sortOrder, f.isActive, '']));
    _catTypes().forEach(t => rows.push(['type', t.id, t.name, t.sortOrder, t.isActive, '']));
    _catStatuses().forEach(s => rows.push(['status', s.id, s.name, s.sortOrder, s.isActive, s.isAvailable]));
    _catDownload('categories.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }
  notify.success('Exported');
}
function _catDownload(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function _catImport() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,.csv';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const fl = Array.isArray(data.floors) ? data.floors.length : 0;
      const tp = Array.isArray(data.types) ? data.types.length : 0;
      const st = Array.isArray(data.statuses) ? data.statuses.length : 0;
      if (!confirm(`Import ${fl} floors, ${tp} types, ${st} statuses? Items with the same name are skipped.`)) return;
      if ((tp || st) && !_catRequireProject()) return;
      let added = 0;
      if (data.floors) {
        for (const f of data.floors) {
          if (gfloors().some(i => i.name.toLowerCase() === (f.name || '').toLowerCase())) continue;
          await _saveWithFallback(saveFloor, { company_id: S.cid, name: f.name, sort_order: f.sortOrder || f.sort_order || 1, is_active: f.isActive !== false });
          added++;
        }
        await loadFloorsCache(S.cid);
      }
      if (data.types) {
        for (const t of data.types) {
          if (_catTypes().some(i => i.name.toLowerCase() === (t.name || '').toLowerCase())) continue;
          const tc = (t.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) || 'TYPE';
          await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: t.name, type_code: tc, sort_order: t.sortOrder || t.sort_order || 1, is_active: t.isActive !== false });
          added++;
        }
        await loadTypesCache(S.cid);
      }
      if (data.statuses) {
        for (const s of data.statuses) {
          if (_catStatuses().some(i => i.name.toLowerCase() === (s.name || '').toLowerCase())) continue;
          const sc = (s.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) || 'STATUS';
          await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: s.name, status_code: sc, color_hex: _catToneHex(_catStatusTone(s)), is_available: s.isAvailable || false, sort_order: s.sortOrder || s.sort_order || 1, is_active: s.isActive !== false });
          added++;
        }
        await loadStatusesCache(S.cid);
      }
      _catLog(`Imported ${added} items from file`); notify.success(`${added} items imported`);
      rFloorsList(); rTypesList(); rStatusesList();
    } catch { notify.error('Invalid file format. Expected a JSON export from this system.'); }
  };
  input.click();
}

// ─── Keyboard Shortcuts (preserved) ────────────────────────────────────
function _catKbdHandler(e) {
  const pg = document.getElementById('pg-categories');
  if (!pg || !pg.classList.contains('on')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (document.querySelector('#cat-modal-host .nx-modal-overlay')) return;
  if (e.key === 'Escape') { _catCloseDD(); _catCloseAud(); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const saveBtn = document.querySelector('#cat-modal-host [id$="-save-btn"]');
    if (saveBtn) saveBtn.click();
  }
}
(function _catBindKbd() { document.removeEventListener('keydown', _catKbdHandler); document.addEventListener('keydown', _catKbdHandler); })();

// ═══════════════════════════════════════════════════════════════════════
// SALE TYPES — user-defined deal types (Installment / Full Cash / Adjustment…)
// ═══════════════════════════════════════════════════════════════════════
function _styPill(val, label, cnt) {
  const cur = _catFilter.saletypes || 'all';
  return NX.button(label + ' ' + cnt, { variant: cur === val ? 'primary' : 'secondary', size:'sm', onclick:"_stySetFilter('" + val + "')" });
}
function _stySetFilter(val) { _catFilter.saletypes = val; rSaleTypesList(); }

function rSaleTypesList() {
  const body = document.getElementById('cat-saletypes'); if (!body) return;
  if (_catFilter.saletypes === undefined) _catFilter.saletypes = 'all';
  const q = (_catSearch.saletypes || '').toLowerCase();
  const all = _catSaleTypes().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fil = _catFilter.saletypes || 'all';
  const items = all.filter(s => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (fil === 'active')   return s.isActive !== false;
    if (fil === 'inactive') return s.isActive === false;
    return true;
  });
  const actCnt = all.filter(s => s.isActive !== false).length;
  const inaCnt = all.filter(s => s.isActive === false).length;
  const pills = _styPill('all','All',all.length) + _styPill('active','Active',actCnt) + _styPill('inactive','Inactive',inaCnt);
  body.innerHTML =
    _catColHead('saletypes', _I.edit, 'Sale types', all.length, 'openSaleTypeModal()', false) +
    _catSubHead('saletypes', pills, q, "_catSearch.saletypes=this.value;rSaleTypesList()") +
    '<div class="cat-list" style="padding:var(--fk-sp-1) var(--fk-sp-2)">' +
      (!items.length ? _catEmpty('saletypes', q, 'sale type', 'Sale Types') : items.map((s, i) => _catStyRow(s, i)).join('')) + '</div>' +
    '<div onclick="openSaleTypeModal()" class="cat-qa-row"><button class="nx-btn nx-btn--ghost nx-btn--sm" style="width:100%;justify-content:flex-start">' + _I.plus + '<span>Add new sale type…</span></button></div>';
}
function _catStyRow(s, i) {
  const active = s.isActive !== false;
  const code = s.typeCode || (s.name || '').slice(0, 4).toUpperCase();
  const inner =
    '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;font-size:var(--fk-fs-body);color:var(--fk-text)">' +
      esc(s.name) + NX.badge(code, 'primary') + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">Sale / deal type</div></div>' +
    '<button class="nx-btn ' + (active ? 'nx-btn--secondary' : 'nx-btn--ghost') + ' nx-btn--sm" onclick="event.stopPropagation();toggleSaleTypeActive(\'' + s.id + '\',' + (!active) + ')"><span>' + (active ? 'Active' : 'Inactive') + '</span></button>' +
    '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" onclick="openSaleTypeModal(\'' + s.id + '\')" title="Edit">' + _I.edit + '</button>' +
    '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-danger)" onclick="deleteSaleTypeConfirm(\'' + s.id + '\')" title="Delete">' + _I.trash + '</button>';
  return '<div class="cat-row cx-card" id="cat-row-sty-' + s.id + '" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--fk-radius-control)' + (active ? '' : ';opacity:.55') + '">' + inner + '</div>';
}
async function toggleSaleTypeActive(id, val) {
  const r = await saveSaleType({ id, company_id: S.cid, is_active: val });
  if (!r || r._error) { notify.error('Could not update sale type'); return; }
  await loadSaleTypesCache(S.cid); rSaleTypesList();
}
function openSaleTypeModal(id) {
  const s = id ? gsaletype(id) : null;
  _catModal(NX.modal({
    title: s ? 'Edit sale type' : 'Add sale type', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="sty-id" value="' + (s?.id || '') + '">' +
      '<input type="hidden" id="sty-sort" value="' + (s ? (s.sortOrder || 1) : _catNextSort(_catSaleTypes())) + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div id="sty-prev" style="margin-top:6px"></div>', { compact:true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Sale type name', name:'sty-name', required:true, value:s?.name || '', placeholder:'e.g. Full Cash', attrs:'oninput="_styPrev()"' }) +
        NX.field({ label:'Short label', name:'sty-code-lbl', value:s?.typeCode || '', placeholder:'CASH', attrs:'maxlength="6" oninput="_styPrev()"' }) +
      '</div>' +
      _catActiveToggle('sty-active', s ? s.isActive !== false : true, ''),
    footer: _catModalFooter('sty-add-btn', 'saveSaleTypeForm(true)', 'sty-save-btn', 'saveSaleTypeForm()', 'Save sale type', !s)
  }));
  _styPrev();
  setTimeout(() => document.getElementById('sty-name')?.focus(), 120);
}
function _styPrev() {
  const name = document.getElementById('sty-name')?.value || '';
  const code = document.getElementById('sty-code-lbl')?.value || (name ? name.slice(0, 4).toUpperCase() : 'TYPE');
  const prev = document.getElementById('sty-prev');
  if (prev) prev.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + (esc(name) || '—') + '</span>' + NX.badge(code || 'TYPE', 'primary') + '</div>';
}
async function saveSaleTypeForm(addAnother) {
  const name = document.getElementById('sty-name').value.trim();
  if (!name) { notify.warning('Sale type name is required'); return; }
  if (!_catRequireProject()) return;
  const id = document.getElementById('sty-id').value.trim() || null;
  const sortOrder = parseInt(document.getElementById('sty-sort').value) || _catNextSort(_catSaleTypes());
  const isActive = document.getElementById('sty-active').checked;
  const shortLabel = document.getElementById('sty-code-lbl')?.value.trim() || '';
  const typeCode = (shortLabel ? shortLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)) || 'SALE_TYPE';
  const btn = document.getElementById('sty-save-btn'); const sp = btn?.querySelector('span');
  if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, type_name: name, type_code: typeCode, color_hex: _catToneHex('info'), sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id; else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveSaleType, payload);
    if (!result || result._error) { notify.error('Sale type save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadSaleTypesCache(S.cid);
    _catLog(`${id ? 'Updated' : 'Added'} sale type "${name}"`);
    notify.success(id ? 'Sale type updated' : 'Sale type added');
    if (addAnother) { openSaleTypeModal(); } else { _catCloseModal(); rSaleTypesList(); }
  } catch (e) { notify.error('Could not save sale type', { detail: e.message }); }
  finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save sale type'; } }
}
async function deleteSaleTypeConfirm(id) {
  const s = gsaletype(id); if (!s) return;
  _catDelModal({ type: 'saletypes', id, name: s.name, usage: 0, afterDelete: async () => { await loadSaleTypesCache(S.cid); rSaleTypesList(); }, deleteFn: () => deleteSaleType(id), logMsg: `Deleted sale type "${s.name}"` });
}
