// ══ TYPES & FLOORS (Categories) — SANCTIONED REDESIGN (2026-06-13) ═════════════
// Owner rejected the washed 4-column board. New UX: a full-width TABBED workspace
// (Floors · Unit Types · Statuses · Sale Types). Floors render as a literal BUILDING
// ELEVATION — top floor up, Ground/Basement at the base, each a wide slab with an
// occupancy bar; drag a slab to re-stack. Types = card grid; Statuses = grouped by
// semantic tone; Sale Types = kit list. Bulk-select hides behind a per-tab "Select".
//
// RESTYLE OF UX ONLY — every data flow / RPC is byte-identical to before:
// saveFloor · saveUnitType · saveUnitStatus · saveSaleType (+ upsert_floor/unit_type/
// unit_status/sale_type under them), delete*, bulk, drag-reorder, quick-add, modals,
// live preview, smart-delete usage guard. Kit only: NX.* / --fk- tokens throughout.

function setCatTab(tab) { window._catPendingTab = tab; }

// ─── State ────────────────────────────────────────────────────────────
let _catTab     = 'floors';   // floors | types | statuses | saletypes
let _catSearch  = { floors: '', types: '', statuses: '' };
let _catFilter  = { floors: 'all', types: 'all', statuses: 'all' };
let _catBulkOn  = { floors: false, types: false, statuses: false };
let _catBulkSel = { floors: new Set(), types: new Set(), statuses: new Set() };
let _catDrag    = { col: null, id: null };
let _bldDrag    = { id: null };
let _catAudit   = (() => { try { return JSON.parse(localStorage.getItem('_nxnCatAudit') || '[]'); } catch { return []; } })();
let _catDD      = null;

// ─── Project scoping (Types & Statuses per-project; Floors company-level) ──
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
  return _catProjectList().map(p => `<option value="${esc(p.id)}" ${p.id === _catProject ? 'selected' : ''}>${esc(p.projectName || p.name || 'Project')}</option>`).join('');
}
function _catSetProject(pid) {
  _catProject = pid || null;
  _catBulkSel.types.clear(); _catBulkSel.statuses.clear();
  _catBulkOn.types = false;  _catBulkOn.statuses = false;
  _catRenderTab();
  const strip = document.getElementById('cat-strip-txt'); if (strip) strip.innerHTML = _catSummaryText();
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
  const m = n.match(/\b(\d+)\b/); if (m) return parseInt(m[1], 10);
  return null;
}
async function _saveWithFallback(fn, payload) {
  let result = await fn(payload);
  if (result?._error) {
    const msg = result._error.message || '', code = result._error.code || '';
    if (code === 'PGRST204' || msg.includes('is_active') || msg.includes('column')) {
      const { is_active, ...rest } = payload; result = await fn(rest);
    }
  }
  return result;
}
// Persist a new ordering. There is a UNIQUE (company_id, sort_order) index, so writing
// the final 1..N directly causes transient duplicate-key collisions while shuffling
// within the existing range. Park every row at a high non-colliding value first, then
// place it. Same saveFloor/upsert_unit_type/status RPC + data flow — just collision-safe.
async function _catApplyOrder(fn, ordered) {
  await Promise.all(ordered.map((item, i) => _saveWithFallback(fn, { company_id: S.cid, id: item.id, sort_order: 100000 + i })));
  await Promise.all(ordered.map((item, i) => _saveWithFallback(fn, { company_id: S.cid, id: item.id, sort_order: i + 1 })));
}

// ─── Semantic tones ────────────────────────────────────────────────────
function _catStatusTone(s) {
  if (!s) return '';
  if (s.isAvailable === true) return 'success';
  const n = (s.name || '').toLowerCase();
  if (/sold|booked|complete|possession/.test(n)) return 'info';
  if (/reserv|hold|pending|process|installment|transfer/.test(n)) return 'warning';
  if (/cancel|block|dead|lock|legal/.test(n)) return 'danger';
  return '';
}
function _catToneHex(tone) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue('--fk-' + (tone || 'info')).trim(); if (v) return v; } catch (e) {}
  return getComputedStyle(document.documentElement).getPropertyValue('--fk-info').trim() || '';
}
const _CAT_TONES = [
  { tone: 'success', label: 'Available / good' }, { tone: 'info', label: 'Sold / neutral' },
  { tone: 'warning', label: 'Reserved / hold' }, { tone: 'danger', label: 'Blocked / locked' }, { tone: '', label: 'Plain' },
];
// Status tone-groups for the grouped Statuses tab.
const _CAT_ST_GROUPS = [
  { key:'success', label:'Available' }, { key:'info', label:'Occupied' },
  { key:'warning', label:'Reserved / hold' }, { key:'danger', label:'Locked' }, { key:'', label:'Other' },
];

// ─── Helpers ──────────────────────────────────────────────────────────
function _catUsage(type, id) {
  const units = window._unitsCache || [];
  if (type === 'floors') { const f = gfloor(id); if (!f) return 0; const n = f.name.toLowerCase();
    return units.filter(u => (u.floorLabel || '').toLowerCase() === n || (u.floor || '').toLowerCase() === n).length; }
  if (type === 'types')    return units.filter(u => u.unitTypeId === id).length;
  if (type === 'statuses') return units.filter(u => u.statusId === id).length;
  return 0;
}
function _catSummaryText() {
  const fl = gfloors(), tp = _catTypes(), st = _catStatuses();
  const all = [...fl, ...tp, ...st];
  const active = all.filter(i => i.isActive !== false).length;
  const unused = fl.filter(f => _catUsage('floors', f.id) === 0).length + tp.filter(t => _catUsage('types', t.id) === 0).length + st.filter(s => _catUsage('statuses', s.id) === 0).length;
  const lastEd = _catAudit[0], lastStr = lastEd ? _catTimeAgo(lastEd.ts) : 'None';
  const chip = (lbl, val, tone) => '<div style="display:flex;flex-direction:column;gap:1px"><span class="nx-kpi-label">' + lbl + '</span>' +
    '<span class="num" style="font-size:var(--fk-fs-title)' + (tone ? ';color:var(--fk-' + tone + ')' : '') + '">' + val + '</span></div>';
  return '<div style="display:flex;gap:var(--fk-sp-4);flex-wrap:wrap">' + chip('Total', all.length, '') + chip('Active', active, 'success') + chip('Unused', unused, 'warning') + chip('Changes', lastStr, '') + '</div>';
}
function _catTimeAgo(ts) { const d = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; return Math.floor(d / 86400) + 'd ago'; }
function _catLog(msg) {
  _catAudit.unshift({ msg, user: S?.name || 'Admin', ts: new Date().toISOString() });
  if (_catAudit.length > 100) _catAudit = _catAudit.slice(0, 100);
  try { localStorage.setItem('_nxnCatAudit', JSON.stringify(_catAudit)); } catch {}
  const list = document.getElementById('cat-aud-list'); if (list) list.innerHTML = _catAuditHTML();
  const strip = document.getElementById('cat-strip-txt'); if (strip) strip.innerHTML = _catSummaryText();
}
function _catAuditHTML() {
  if (!_catAudit.length) return '<div class="nx-empty"><div class="nx-empty-msg">No changes recorded yet.</div></div>';
  return _catAudit.map(e => '<div style="padding:8px 0;border-bottom:1px solid var(--fk-border)"><div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + esc(e.msg) + '</div>' +
    '<div class="nx-kpi-label" style="text-transform:none">' + _catTimeAgo(e.ts) + ' — ' + esc(e.user) + '</div></div>').join('');
}
function _catNextSort(items) { if (!items.length) return 1; return Math.max(...items.map(i => i.sortOrder || 0)) + 1; }

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
  lock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
};

// ─── Occupancy (sold vs available) for a floor ─────────────────────────
function _bldFloorUnits(f) {
  const units = window._unitsCache || [], n = (f.name || '').toLowerCase();
  return units.filter(u => (f.id && u.floorId && u.floorId === f.id) || (u.floorLabel || '').toLowerCase() === n || (u.floor || '').toLowerCase() === n);
}
function _bldOcc(units) {
  const total = units.length;
  const available = units.filter(u => u.isAvailable && !u.saleId).length;
  const sold = total - available;
  return { total, sold, available };
}
function _bldBar(occ) {
  if (!occ.total) return '<span class="nx-kpi-label" style="text-transform:none">No units</span>';
  const bar = (typeof NX.minibar === 'function')
    ? NX.minibar({ a: occ.sold, b: occ.available, toneA: 'primary', toneB: 'success', width: 120, height: 8 })
    : '';
  return '<span title="' + occ.sold + ' sold · ' + occ.available + ' available" style="display:inline-flex;align-items:center;gap:8px">' + bar +
    '<span class="nx-kpi-label" style="text-transform:none">' + occ.available + ' avail</span></span>';
}

// ════════════════════════════════════════════════════════════════════════
// PAGE SHELL — header + tab bar
// ════════════════════════════════════════════════════════════════════════
function rCategories() {
  if (!S || (S.role !== 'admin' && S.role !== 'owner')) { nav('dashboard'); return; }
  const el = document.getElementById('pg-categories'); if (!el) return;
  if (!_catProject || !_catProjectList().some(p => p.id === _catProject)) _catProject = _catProjectList()[0]?.id || null;
  if (window._catPendingTab) { _catTab = window._catPendingTab; window._catPendingTab = null; }

  const actions =
    '<select id="cat-project" class="nx-select" title="Types & Statuses are managed per project" style="max-width:220px;height:var(--fk-h-btn)" onchange="_catSetProject(this.value)">' + _catProjectOptions() + '</select>' +
    NX.button('Import', { variant:'ghost', size:'sm', onclick:'_catImport()' }) +
    NX.button('Export', { variant:'ghost', size:'sm', attrs:'id="cat-exp-btn"', onclick:'_catExpMenu(this)' }) +
    NX.button('Templates', { variant:'ghost', size:'sm', attrs:'id="cat-tpl-btn"', onclick:'_catTplMenu(this)' }) +
    NX.button('Audit log', { variant:'ghost', size:'sm', onclick:'_catOpenAud()' });

  el.innerHTML =
    '<div style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-3)">' +
    NX.pageHeader('Types & Floors', actions, { icon:'layers' }) +
    NX.card('<div id="cat-strip-txt">' + _catSummaryText() + '</div>', { compact:true }) +
    '<div id="cat-tabbar">' + _catTabBar() + '</div>' +
    '<div id="cat-tab-body"></div>' +
    '<div id="cat-modal-host"></div>' +
    '<div id="cat-aud-drawer" style="display:none">' + NX.modal({ title:'Audit log', size:'s', onClose:'_catCloseAud()', body:'<div id="cat-aud-list">' + _catAuditHTML() + '</div>' }) + '</div>' +
    '</div>';

  document.addEventListener('click', _catDocClick, true);
  _catRenderTab();

  if (window._catPendingScroll) { window._catPendingScroll = null; setTimeout(() => {
    const fn = { floors:'openFloorModal', types:'openTypeModal', statuses:'openStatusModal', saletypes:'openSaleTypeModal' }[_catTab];
    if (fn && typeof window[fn] === 'function') window[fn]();
  }, 300); }
}
function _catTabBar() {
  // WARMTH v2 — segmented track (NX.tabs), full-width, glyph + count per pill.
  const tabs = [
    { k:'floors',    label:'Floors',     count: gfloors().length,        icon:'building-2' },
    { k:'types',     label:'Unit types', count: _catTypes().length,      icon:'package' },
    { k:'statuses',  label:'Statuses',   count: _catStatuses().length,   icon:'tag' },
    { k:'saletypes', label:'Sale types', count: _catSaleTypes().length,  icon:'list' },
  ];
  return NX.tabs({ tabs, active: _catTab, onSelect: "_catShowTab('%k')", fill: true });
}
function _catShowTab(tab) {
  _catTab = tab;
  const bar = document.getElementById('cat-tabbar'); if (bar) bar.innerHTML = _catTabBar();
  _catRenderTab();
}
function _catRenderTab() {
  const bar = document.getElementById('cat-tabbar'); if (bar) bar.innerHTML = _catTabBar();
  if (_catTab === 'floors') return rFloorsTab();
  if (_catTab === 'types') return rTypesTab();
  if (_catTab === 'statuses') return rStatusesTab();
  return rSaleTypesTab();
}

// Per-tab toolbar: optional search + Select(bulk) toggle + Add.
function _catTabToolbar(col, opts) {
  opts = opts || {};
  const bulkOn = _catBulkOn[col];
  let html = '<div style="display:flex;align-items:center;gap:var(--fk-sp-2);flex-wrap:wrap;margin-bottom:var(--fk-sp-3)">';
  if (opts.search) html += '<div style="position:relative"><span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted)">' + _I.srch + '</span>' +
    '<input class="nx-input" style="padding-left:26px;max-width:240px" placeholder="Search…" value="' + esc(_catSearch[col] || '') + '" oninput="' + opts.search + '"></div>';
  html += '<div style="flex:1"></div>';
  if (col && _catBulkSel[col]) html += NX.button(bulkOn ? 'Done' : 'Select', { variant: bulkOn ? 'primary' : 'secondary', size:'sm', onclick:"_catToggleSelect('" + col + "')" });
  if (opts.add) html += NX.button(opts.addLabel || 'Add', { variant:'primary', size:'sm', icon:'plus', onclick:opts.add });
  html += '</div>';
  if (bulkOn && col) html += _catBulkBar(col, _catBulkSel[col].size);
  return html;
}
function _catToggleSelect(col) { _catBulkOn[col] ? _catBulkEnd(col) : _catBulkStart(col); }
function _catBulkBar(col, cnt) {
  return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:var(--fk-sp-2) var(--fk-sp-3);background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);margin-bottom:var(--fk-sp-3)">' +
    '<span class="nx-kpi-label cat-bulk-cnt" style="text-transform:none">' + cnt + ' selected</span><span style="flex:1"></span>' +
    NX.button('Activate', { variant:'ghost', size:'sm', onclick:"_catBulkAct('" + col + "','activate')" }) +
    NX.button('Deactivate', { variant:'ghost', size:'sm', onclick:"_catBulkAct('" + col + "','deactivate')" }) +
    NX.button('Delete', { variant:'danger', size:'sm', onclick:"_catBulkAct('" + col + "','delete')" }) + '</div>';
}

// ════════════════════════════════════════════════════════════════════════
// FLOORS TAB — the building stack
// ════════════════════════════════════════════════════════════════════════
function rFloorsTab() {
  const body = document.getElementById('cat-tab-body'); if (!body) return;
  const q = (_catSearch.floors || '').toLowerCase();
  // Physical order: highest sort_order at the TOP of the stack.
  const all = gfloors().slice().sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));
  const items = all.filter(f => !q || f.name.toLowerCase().includes(q));
  const sel = _catBulkOn.floors;

  let html = _catTabToolbar('floors', { search:"_catSearch.floors=this.value;rFloorsTab()", add:'openFloorModal()', addLabel:'Add floor' });
  html += _bldAddRow('top');
  html += '<div id="cat-bld-stack" style="display:flex;flex-direction:column;gap:6px">' +
    (items.length ? items.map(f => _bldSlab(f, sel)).join('') :
      NX.card(NX.empty({ icon:'inbox', message: q ? 'No floors match.' : 'No floors yet — add your first floor.', action: q ? '' : NX.button('Add floor', { variant:'primary', size:'sm', icon:'plus', onclick:'openFloorModal()' }) }))) +
    '</div>';
  html += _bldAddRow('bottom');
  body.innerHTML = html;
}
function _bldSlab(f, selectMode) {
  const active = f.isActive !== false;
  const code = f.floorCode || f.floor_code || String(f.sortOrder || 0);
  const fu = _bldFloorUnits(f), occ = _bldOcc(fu), usage = fu.length || _catUsage('floors', f.id);
  const checked = _catBulkSel.floors.has(f.id);
  // Grid: [grip/chk][code chip 44][name+count 1fr][occupancy bar auto][Active][kebab]
  const lead = selectMode
    ? '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="_catChk(\'floors\',\'' + f.id + '\',this.checked)">'
    : '<span class="cat-drag" style="cursor:grab;color:var(--fk-text-muted);display:flex">' + _I.grip + '</span>';
  const dA = selectMode ? '' : ' draggable="true" ondragstart="_bldDS(\'' + f.id + '\',event)" ondragover="_bldDO(event)" ondrop="_bldDP(\'' + f.id + '\',event)" ondragleave="this.classList.remove(\'drag-over\')"';
  return '<div class="cat-row" id="cat-row-fl-' + f.id + '"' + dA +
    ' style="display:grid;grid-template-columns:18px 46px minmax(0,1fr) auto auto auto;align-items:center;gap:var(--fk-sp-3);padding:12px var(--fk-sp-3);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card);background:var(--fk-bg-card)' + (active ? '' : ';opacity:.55') + '">' +
    lead +
    '<span style="white-space:nowrap;display:flex;justify-content:center">' + _catCodeChip(code) + '</span>' +
    '<span style="min-width:0"><span style="display:block;font-size:var(--fk-fs-title);color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.name) + '</span>' +
      '<span class="nx-kpi-label" style="text-transform:none;display:block">' + (usage > 0 ? usage + ' unit' + (usage !== 1 ? 's' : '') : 'No units yet') + '</span></span>' +
    '<span style="white-space:nowrap">' + _bldBar(occ) + '</span>' +
    '<span style="white-space:nowrap">' + _catActivePill(f.id, active, 'toggleFloorActive') + '</span>' +
    '<span style="white-space:nowrap">' + _catKebabBtn('floors', f.id) + '</span>' +
  '</div>';
}
// Inline add-floor row at the top / bottom of the building.
function _bldAddRow(pos) {
  const id = 'cat-bld-add-' + pos;
  return '<div style="margin:' + (pos === 'top' ? '0 0 6px' : '6px 0 0') + '">' +
    '<div id="' + id + '-btn"><button class="nx-btn nx-btn--ghost nx-btn--sm" style="width:100%;justify-content:center;border:1px dashed var(--fk-border)" onclick="_bldAddOpen(\'' + pos + '\')">' + _I.plus + '<span>Add floor at ' + pos + '</span></button></div>' +
    '<div id="' + id + '-inp" style="display:none;gap:6px;align-items:center">' +
      '<input class="nx-input" id="' + id + '-val" placeholder="Floor name…" onkeydown="if(event.key===\'Enter\')_bldAddSave(\'' + pos + '\');if(event.key===\'Escape\')_bldAddCancel(\'' + pos + '\')">' +
      NX.button('Add', { variant:'primary', size:'sm', onclick:"_bldAddSave('" + pos + "')" }) +
      NX.button('Cancel', { variant:'ghost', size:'sm', onclick:"_bldAddCancel('" + pos + "')" }) + '</div></div>';
}
function _bldAddOpen(pos) {
  const b = document.getElementById('cat-bld-add-' + pos + '-btn'), i = document.getElementById('cat-bld-add-' + pos + '-inp');
  if (b) b.style.display = 'none'; if (i) { i.style.display = 'flex'; const v = document.getElementById('cat-bld-add-' + pos + '-val'); if (v) { v.value = ''; v.focus(); } }
}
function _bldAddCancel(pos) {
  const b = document.getElementById('cat-bld-add-' + pos + '-btn'), i = document.getElementById('cat-bld-add-' + pos + '-inp');
  if (b) b.style.display = ''; if (i) i.style.display = 'none';
}
async function _bldAddSave(pos) {
  const v = document.getElementById('cat-bld-add-' + pos + '-val'); const name = v ? v.value.trim() : '';
  if (!name) { _bldAddCancel(pos); return; }
  const items = gfloors();
  const sorts = items.map(i => i.sortOrder || 0);
  const sortOrder = pos === 'top' ? (items.length ? Math.max(...sorts) + 1 : 1) : (items.length ? Math.min(...sorts) - 1 : 1);
  const r = await _saveWithFallback(saveFloor, { company_id: S.cid, name, sort_order: sortOrder, is_active: true });
  if (!r || r._error) { notify.error('Could not add floor'); return; }
  await loadFloorsCache(S.cid); _catLog('Added floor "' + name + '"'); notify.success('"' + name + '" added');
  rFloorsTab(); const strip = document.getElementById('cat-strip-txt'); if (strip) strip.innerHTML = _catSummaryText();
}
// Building drag — visual top = highest sort_order. Reassign on drop so the stack's
// visual order persists (bottom slab → sort 1, top slab → sort N).
function _bldDS(id, e) { _bldDrag = { id }; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { const el = document.getElementById('cat-row-fl-' + id); if (el) el.classList.add('dragging'); }, 0); }
function _bldDO(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
async function _bldDP(toId, e) {
  e.preventDefault();
  document.querySelectorAll('.cat-row.dragging,.cat-row.drag-over').forEach(r => r.classList.remove('dragging', 'drag-over'));
  const fromId = _bldDrag.id; _bldDrag = { id: null };
  if (!fromId || fromId === toId) return;
  const desc = gfloors().slice().sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0)); // visual top→bottom
  const fromIdx = desc.findIndex(f => f.id === fromId), toIdx = desc.findIndex(f => f.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const moved = desc.filter(f => f.id !== fromId); moved.splice(toIdx, 0, desc[fromIdx]);
  const asc = moved.slice().reverse(); // bottom→top = ascending sort
  await _catApplyOrder(saveFloor, asc);
  await loadFloorsCache(S.cid); _catLog('Re-stacked floors'); rFloorsTab();
}

// ════════════════════════════════════════════════════════════════════════
// UNIT TYPES TAB — card grid
// ════════════════════════════════════════════════════════════════════════
function rTypesTab() {
  const body = document.getElementById('cat-tab-body'); if (!body) return;
  const q = (_catSearch.types || '').toLowerCase();
  const all = _catTypes().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const items = all.filter(t => !q || t.name.toLowerCase().includes(q));
  let html = _catTabToolbar('types', { search:"_catSearch.types=this.value;rTypesTab()", add:'openTypeModal()', addLabel:'Add type' });
  if (!all.length) { body.innerHTML = html + NX.card(NX.empty({ icon:'inbox', message:'No unit types yet — add your first type.', action: NX.button('Add type', { variant:'primary', size:'sm', icon:'plus', onclick:'openTypeModal()' }) })); return; }
  const cards = items.map(t => _catTypeCard(t)).join('') +
    '<button onclick="openTypeModal()" style="border:1px dashed var(--fk-border);border-radius:var(--fk-radius-card);background:none;color:var(--fk-text-muted);cursor:pointer;font-family:inherit;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">' + _I.plus + '<span style="font-size:var(--fk-fs-body)">Add type</span></button>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--fk-sp-3)">' + cards + '</div>';
  body.innerHTML = html;
}
function _catTypeCard(t) {
  const active = t.isActive !== false;
  const abbr = (t.name || '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const usage = _catUsage('types', t.id);
  const dArea = t.defaultArea ?? t.default_area, dPrice = t.defaultPrice ?? t.default_price;
  const checked = _catBulkSel.types.has(t.id);
  const selBox = _catBulkOn.types ? '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="event.stopPropagation();_catChk(\'types\',\'' + t.id + '\',this.checked)" style="position:absolute;top:10px;right:10px">' : '';
  return '<div class="nx-card" style="position:relative;display:flex;flex-direction:column;gap:8px;cursor:pointer' + (active ? '' : ';opacity:.55') + '" onclick="openTypeModal(\'' + t.id + '\')">' + selBox +
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<span class="num" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid var(--fk-border);border-radius:8px;color:var(--fk-text-muted)">' + esc(abbr) + '</span>' +
      '<div style="min-width:0"><div title="' + esc(t.name) + '" style="font-size:var(--fk-fs-title);color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.name) + '</div>' +
        '<div class="nx-kpi-label" style="text-transform:none">' + (usage > 0 ? usage + ' unit' + (usage !== 1 ? 's' : '') : 'Not used yet') + '</div></div></div>' +
    '<div style="display:flex;gap:var(--fk-sp-3);flex-wrap:wrap">' +
      '<div><div class="nx-kpi-label">Default area</div><div class="num" style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + (dArea ? dArea + ' sqft' : '—') + '</div></div>' +
      '<div><div class="nx-kpi-label">Default price</div><div class="num" style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + (dPrice ? 'PKR ' + (typeof fM === 'function' ? fM(dPrice) : dPrice) : '—') + '</div></div></div>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-top:auto" onclick="event.stopPropagation()">' +
      _catActivePill(t.id, active, 'toggleTypeActive') + '<span style="flex:1"></span>' + _catKebabBtn('types', t.id) + '</div></div>';
}

// ════════════════════════════════════════════════════════════════════════
// STATUSES TAB — grouped by semantic tone
// ════════════════════════════════════════════════════════════════════════
function rStatusesTab() {
  const body = document.getElementById('cat-tab-body'); if (!body) return;
  const q = (_catSearch.statuses || '').toLowerCase();
  const all = _catStatuses().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const items = all.filter(s => !q || s.name.toLowerCase().includes(q));
  let html = _catTabToolbar('statuses', { search:"_catSearch.statuses=this.value;rStatusesTab()", add:'openStatusModal()', addLabel:'Add status' });
  // inline quick-add
  html += _catQAStatus();
  if (!all.length) { body.innerHTML = html + NX.card(NX.empty({ icon:'inbox', message:'No statuses yet — add your first status.', action: NX.button('Add status', { variant:'primary', size:'sm', icon:'plus', onclick:'openStatusModal()' }) })); return; }
  const groups = {}; _CAT_ST_GROUPS.forEach(g => groups[g.key] = []);
  items.forEach(s => { const t = _catStatusTone(s); (groups[t] || groups['']).push(s); });
  html += _CAT_ST_GROUPS.filter(g => groups[g.key].length).map(g =>
    '<div style="margin-bottom:var(--fk-sp-3)">' +
      '<div class="nx-kpi-label" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="nx-kpi-dot nx-kpi-dot--' + (g.key || 'primary') + '"></span>' + g.label + ' · ' + groups[g.key].length + '</div>' +
      NX.card(groups[g.key].map(s => _catStatusRow(s)).join(''), { flush:true, compact:true }) +
    '</div>').join('');
  body.innerHTML = html;
}
function _catStatusRow(s) {
  const active = s.isActive !== false, tone = _catStatusTone(s);
  const code = s.statusCode || s.status_code || (s.name || '').slice(0, 4).toUpperCase();
  const usage = _catUsage('statuses', s.id);
  const locked = s.isSystem || s.is_system;
  const checked = _catBulkSel.statuses.has(s.id);
  const lead = _catBulkOn.statuses
    ? '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="_catChk(\'statuses\',\'' + s.id + '\',this.checked)">'
    : '<span class="cat-drag" style="cursor:grab;color:var(--fk-text-muted);display:flex">' + _I.grip + '</span>';
  const dA = _catBulkOn.statuses ? '' : ' draggable="true" ondragstart="_catDS(\'statuses\',\'' + s.id + '\',event)" ondragover="_catDO(\'statuses\',\'' + s.id + '\',event)" ondrop="_catDP(\'statuses\',\'' + s.id + '\',event)" ondragleave="this.classList.remove(\'drag-over\')"';
  return '<div class="cat-row" id="cat-row-st-' + s.id + '"' + dA +
    ' style="display:grid;grid-template-columns:18px auto minmax(0,1fr) auto auto auto;align-items:center;gap:var(--fk-sp-3);padding:9px 12px;border-bottom:1px solid var(--fk-border)' + (active ? '' : ';opacity:.55') + '">' +
    lead +
    '<span style="white-space:nowrap">' + NX.badge(code, tone) + '</span>' +
    '<span style="min-width:0"><span title="' + esc(s.name) + '" style="display:block;font-size:var(--fk-fs-body);color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.name) + '</span>' +
      '<span class="nx-kpi-label" style="text-transform:none">' + (s.isAvailable ? 'Bookable' : 'Locked from sale') + '</span></span>' +
    '<span class="num" style="white-space:nowrap;color:var(--fk-text-muted);font-size:var(--fk-fs-label)">' + (usage > 0 ? usage + ' units' : '—') + '</span>' +
    '<span style="white-space:nowrap">' + (locked ? '<span class="nx-badge">' + _I.lock + ' System</span>' : _catActivePill(s.id, active, 'toggleStatusActive')) + '</span>' +
    '<span style="white-space:nowrap">' + _catKebabBtn('statuses', s.id) + '</span>' +
  '</div>';
}
function _catQAStatus() {
  return '<div id="cat-st-qa-inp" style="display:none;gap:6px;align-items:center;margin-bottom:var(--fk-sp-3)">' +
    '<input class="nx-input" id="cat-st-qa-val" placeholder="Status name…" onkeydown="if(event.key===\'Enter\')_catQASave(\'statuses\');if(event.key===\'Escape\')_catQACancel(\'statuses\')">' +
    '<label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;font-size:var(--fk-fs-body);color:var(--fk-text)"><input type="checkbox" id="cat-st-qa-avail" checked> Sellable</label>' +
    NX.button('Add', { variant:'primary', size:'sm', onclick:"_catQASave('statuses')" }) +
    NX.button('Cancel', { variant:'ghost', size:'sm', onclick:"_catQACancel('statuses')" }) + '</div>' +
    '<div id="cat-st-qa"><button class="nx-btn nx-btn--ghost nx-btn--sm" style="margin-bottom:var(--fk-sp-3)" onclick="_catQA(\'statuses\')">' + _I.plus + '<span>Quick add status</span></button></div>';
}

// ════════════════════════════════════════════════════════════════════════
// SALE TYPES TAB — kit list
// ════════════════════════════════════════════════════════════════════════
function rSaleTypesTab() {
  const body = document.getElementById('cat-tab-body'); if (!body) return;
  if (_catFilter.saletypes === undefined) _catFilter.saletypes = 'all';
  const all = _catSaleTypes().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  let html = _catTabToolbar('', { add:'openSaleTypeModal()', addLabel:'Add sale type' });
  if (!all.length) { body.innerHTML = html + NX.card(NX.empty({ icon:'inbox', message:'No sale types yet — add deal types like Installment, Full Cash or Adjustment.', action: NX.button('Add sale type', { variant:'primary', size:'sm', icon:'plus', onclick:'openSaleTypeModal()' }) })); return; }
  html += NX.card(all.map(s => _catStyRow(s)).join(''), { flush:true });
  body.innerHTML = html;
}
function _catStyRow(s) {
  const active = s.isActive !== false;
  const code = s.typeCode || (s.name || '').slice(0, 4).toUpperCase();
  return '<div class="cat-row" style="display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:var(--fk-sp-3);padding:10px 12px;border-bottom:1px solid var(--fk-border)' + (active ? '' : ';opacity:.55') + '">' +
    '<span style="white-space:nowrap">' + NX.badge(code, 'primary') + '</span>' +
    '<span title="' + esc(s.name) + '" style="min-width:0;font-size:var(--fk-fs-body);color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.name) + '</span>' +
    '<span style="white-space:nowrap">' + _catActivePill(s.id, active, 'toggleSaleTypeActive') + '</span>' +
    '<span style="white-space:nowrap;display:flex;gap:2px">' +
      '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" onclick="openSaleTypeModal(\'' + s.id + '\')" title="Edit">' + _I.edit + '</button>' +
      '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-danger)" onclick="deleteSaleTypeConfirm(\'' + s.id + '\')" title="Delete">' + _I.trash + '</button></span></div>';
}

// ─── Shared chips ──────────────────────────────────────────────────────
// Floor/type code chip — the row's anchor: indigo-tinted icon-chip treatment.
function _catCodeChip(code) {
  return '<span class="num" style="display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:30px;padding:0 6px;border-radius:9px;background:var(--fk-primary-chip);color:var(--fk-primary);font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);border:1px solid var(--fk-primary-edge)">' + esc(code) + '</span>';
}
// "Active" is a STATE, not an action — render the warmth status chip (tinted bg +
// 1px tinted border). Still clickable: the toggle behavior stays on click.
function _catActivePill(id, active, toggleFn) {
  const cls = active ? 'nx-badge nx-badge--success' : 'nx-badge';
  const inner = active ? '<span class="nx-dot"></span>Active' : 'Inactive';
  const title = active ? 'Active — click to deactivate' : 'Inactive — click to activate';
  return '<button class="' + cls + '" style="cursor:pointer" title="' + title + '" onclick="event.stopPropagation();' + toggleFn + '(\'' + id + '\',' + (!active) + ')">' + inner + '</button>';
}
function _catKebabBtn(col, id) {
  return '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" onclick="event.stopPropagation();_catKebab(\'' + col + '\',\'' + id + '\',this)">' + _I.more + '</button>';
}

// ─── Re-render helper for the active tab (after writes) ────────────────
function _catRefreshCol(col) {
  if (col === 'floors' && _catTab === 'floors') rFloorsTab();
  else if (col === 'types' && _catTab === 'types') rTypesTab();
  else if (col === 'statuses' && _catTab === 'statuses') rStatusesTab();
  else if (col === 'saletypes' && _catTab === 'saletypes') rSaleTypesTab();
  const bar = document.getElementById('cat-tabbar'); if (bar) bar.innerHTML = _catTabBar();
}
// Back-compat shims (old render fn names referenced by some flows).
function rFloorsList()   { _catRefreshCol('floors'); }
function rTypesList()    { _catRefreshCol('types'); }
function rStatusesList() { _catRefreshCol('statuses'); }
function rSaleTypesList(){ _catRefreshCol('saletypes'); }

// ─── Quick Add (preserved logic; per-tab UI) ───────────────────────────
function _catQA(col) {
  const pfx = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const qa = document.getElementById('cat-' + pfx + '-qa'), inp = document.getElementById('cat-' + pfx + '-qa-inp');
  if (qa) qa.style.display = 'none'; if (inp) { inp.style.display = 'flex'; const v = document.getElementById('cat-' + pfx + '-qa-val'); if (v) { v.value = ''; v.focus(); } }
}
function _catQACancel(col) {
  const pfx = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const qa = document.getElementById('cat-' + pfx + '-qa'), inp = document.getElementById('cat-' + pfx + '-qa-inp');
  if (qa) qa.style.display = ''; if (inp) inp.style.display = 'none';
}
async function _catQASave(col) {
  const pfx = col === 'floors' ? 'fl' : col === 'types' ? 'tp' : 'st';
  const input = document.getElementById('cat-' + pfx + '-qa-val'); const name = input ? input.value.trim() : '';
  if (!name) { _catQACancel(col); return; }
  if (col !== 'floors' && !_catRequireProject()) { _catQACancel(col); return; }
  const items = col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses();
  const sortOrder = _catNextSort(items);
  try {
    let result;
    if (col === 'floors') {
      result = await _saveWithFallback(saveFloor, { company_id: S.cid, name, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add floor'); return; }
      await loadFloorsCache(S.cid); _catLog('Added floor "' + name + '"'); rFloorsTab();
    } else if (col === 'types') {
      const tc = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'TYPE';
      result = await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: name, type_code: tc, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add type'); return; }
      await loadTypesCache(S.cid); _catLog('Added unit type "' + name + '"'); rTypesTab();
    } else {
      const sc = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'STATUS';
      const qaAvail = document.getElementById('cat-st-qa-avail')?.checked !== false;
      result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: name, status_code: sc, color_hex: _catToneHex(qaAvail ? 'success' : ''), is_available: qaAvail, sort_order: sortOrder, is_active: true });
      if (!result || result._error) { notify.error('Could not add status'); return; }
      await loadStatusesCache(S.cid); _catLog('Added status "' + name + '"'); rStatusesTab();
    }
    notify.success('"' + name + '" added');
    const strip = document.getElementById('cat-strip-txt'); if (strip) strip.innerHTML = _catSummaryText();
  } catch (e) { notify.error('Could not save', { detail: e.message }); }
}

// ─── Route helpers ─────────────────────────────────────────────────────
function _catEditFn(type, id) { _catCloseDD(); if (type === 'floors') openFloorModal(id); else if (type === 'types') openTypeModal(id); else openStatusModal(id); }
function _catDelFn(type, id)  { _catCloseDD(); if (type === 'floors') deleteFloorConfirm(id); else if (type === 'types') deleteTypeConfirm(id); else deleteStatusConfirm(id); }

// ─── Kebab + Column dropdowns ──────────────────────────────────────────
function _catDD_el(rect, alignRight) {
  const dd = document.createElement('div'); dd.id = 'cat-dd-open';
  dd.style.cssText = 'position:fixed;z-index:10050;min-width:180px;background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card);box-shadow:var(--fk-shadow);padding:4px;display:flex;flex-direction:column;gap:2px;' +
    'top:' + (rect.bottom + 4) + 'px;' + (alignRight ? 'right:' + (window.innerWidth - rect.right) + 'px;left:auto;' : 'left:' + Math.max(8, rect.right - 180) + 'px;');
  return dd;
}
function _catDDItem(icon, label, onclick, danger) {
  return '<button class="nx-btn nx-btn--ghost nx-btn--sm" style="justify-content:flex-start;width:100%' + (danger ? ';color:var(--fk-danger)' : '') + '" onclick="' + onclick + '">' + (icon || '') + '<span>' + label + '</span></button>';
}
function _catKebab(type, id, btn) {
  _catCloseDD(); const rect = btn.getBoundingClientRect();
  const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id); if (!item) return;
  const usage = _catUsage(type, id); const dd = _catDD_el(rect, false);
  dd.innerHTML = _catDDItem(_I.edit, 'Edit', `_catEditFn('${type}','${id}')`) +
    _catDDItem(_I.copy, 'Duplicate', `_catCloseDD();_catDuplicate('${type}','${id}')`) +
    _catDDItem(_I.arU, 'Move to top', `_catCloseDD();_catMoveTop('${type}','${id}')`) +
    _catDDItem(_I.arD, 'Move to bottom', `_catCloseDD();_catMoveBot('${type}','${id}')`) +
    (usage > 0 ? _catDDItem(_I.inf, `View usage (${usage})`, `_catCloseDD();_catViewUsage('${type}','${id}')`) : '') +
    _catDDItem(_I.trash, 'Delete', `_catDelFn('${type}','${id}')`, true);
  document.body.appendChild(dd); _catDD = dd;
  setTimeout(() => { if (dd.getBoundingClientRect().bottom > window.innerHeight - 8) dd.style.top = (rect.top - dd.offsetHeight - 4) + 'px'; }, 0);
}
function _catCloseDD() { if (_catDD) { _catDD.remove(); _catDD = null; } const old = document.getElementById('cat-dd-open'); if (old) old.remove(); }
function _catDocClick(e) {
  const pg = document.getElementById('pg-categories');
  if (!pg || !pg.classList.contains('on')) { document.removeEventListener('click', _catDocClick, true); return; }
  if (_catDD && !_catDD.contains(e.target)) _catCloseDD();
}

// ─── Bulk Mode (preserved) ─────────────────────────────────────────────
function _catBulkStart(col) { _catBulkOn[col] = true; _catBulkSel[col].clear(); _catRefreshCol(col); }
function _catBulkEnd(col) { _catBulkOn[col] = false; _catBulkSel[col].clear(); _catRefreshCol(col); }
function _catChk(col, id, checked) {
  if (checked) _catBulkSel[col].add(id); else _catBulkSel[col].delete(id);
  const cnt = document.querySelector('.cat-bulk-cnt'); if (cnt) cnt.textContent = _catBulkSel[col].size + ' selected';
}
async function _catBulkAct(col, action) {
  const ids = [..._catBulkSel[col]]; if (!ids.length) { notify.warning('Select at least one item'); return; }
  if (action === 'delete') {
    if (!confirm('Delete ' + ids.length + ' ' + col + '? This cannot be undone.')) return;
    for (const id of ids) { if (col === 'floors') await deleteFloor(id); else if (col === 'types') await deleteUnitType(id); else await deleteUnitStatus(id); }
    _catLog('Bulk deleted ' + ids.length + ' ' + col);
  } else {
    const flag = action === 'activate';
    for (const id of ids) { const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus; await _saveWithFallback(fn, { company_id: S.cid, id, is_active: flag }); }
    _catLog('Bulk ' + action + 'd ' + ids.length + ' ' + col);
  }
  if (col === 'floors') await loadFloorsCache(S.cid); else if (col === 'types') await loadTypesCache(S.cid); else await loadStatusesCache(S.cid);
  _catBulkEnd(col); notify.success('Done');
}

// ─── Drag & Drop for the non-floor columns (statuses) ──────────────────
function _catDS(col, id, e) { _catDrag = { col, id }; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { const el = document.getElementById('cat-row-' + (col[0] === 'f' ? 'fl' : col[0] === 't' ? 'tp' : 'st') + '-' + id); if (el) el.classList.add('dragging'); }, 0); }
function _catDO(col, id, e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (_catDrag.col !== col || _catDrag.id === id) return;
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over')); const el = document.getElementById('cat-row-' + (col[0] === 'f' ? 'fl' : col[0] === 't' ? 'tp' : 'st') + '-' + id); if (el) el.classList.add('drag-over'); }
async function _catDP(col, toId, e) {
  e.preventDefault(); document.querySelectorAll('.cat-row.dragging,.cat-row.drag-over').forEach(r => r.classList.remove('dragging', 'drag-over'));
  if (!_catDrag.id || _catDrag.col !== col || _catDrag.id === toId) return;
  const fromId = _catDrag.id; _catDrag = { col: null, id: null };
  const items = (col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const fromIdx = items.findIndex(i => i.id === fromId), toIdx = items.findIndex(i => i.id === toId); if (fromIdx < 0 || toIdx < 0) return;
  const reordered = items.filter(i => i.id !== fromId); reordered.splice(toIdx, 0, items[fromIdx]);
  const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
  await _catApplyOrder(fn, reordered);
  if (col === 'floors') await loadFloorsCache(S.cid); else if (col === 'types') await loadTypesCache(S.cid); else await loadStatusesCache(S.cid);
  _catLog('Reordered ' + col); _catRefreshCol(col);
}

async function _catMoveTop(type, id) {
  const items = (type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = items.findIndex(i => i.id === id); if (idx <= 0) return;
  const reordered = [items[idx], ...items.filter(i => i.id !== id)];
  const fn = type === 'floors' ? saveFloor : type === 'types' ? saveUnitType : saveUnitStatus;
  await _catApplyOrder(fn, reordered);
  if (type === 'floors') await loadFloorsCache(S.cid); else if (type === 'types') await loadTypesCache(S.cid); else await loadStatusesCache(S.cid); _catRefreshCol(type);
}
async function _catMoveBot(type, id) {
  const items = (type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = items.findIndex(i => i.id === id); if (idx < 0 || idx === items.length - 1) return;
  const reordered = [...items.filter(i => i.id !== id), items[idx]];
  const fn = type === 'floors' ? saveFloor : type === 'types' ? saveUnitType : saveUnitStatus;
  await _catApplyOrder(fn, reordered);
  if (type === 'floors') await loadFloorsCache(S.cid); else if (type === 'types') await loadTypesCache(S.cid); else await loadStatusesCache(S.cid); _catRefreshCol(type);
}
async function _catSortAlpha(col) {
  const items = (col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses()).slice().sort((a, b) => a.name.localeCompare(b.name));
  const fn = col === 'floors' ? saveFloor : col === 'types' ? saveUnitType : saveUnitStatus;
  await _catApplyOrder(fn, items);
  if (col === 'floors') await loadFloorsCache(S.cid); else if (col === 'types') await loadTypesCache(S.cid); else await loadStatusesCache(S.cid); _catRefreshCol(col); notify.success('Sorted A–Z');
}
async function _catDuplicate(type, id) {
  const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id); if (!item) return;
  if (type !== 'floors' && !_catRequireProject()) return;
  const items = type === 'floors' ? gfloors() : type === 'types' ? _catTypes() : _catStatuses(); const sortOrder = _catNextSort(items);
  try {
    let result;
    if (type === 'floors') { result = await _saveWithFallback(saveFloor, { company_id: S.cid, name: item.name + ' (copy)', sort_order: sortOrder, is_active: item.isActive !== false }); await loadFloorsCache(S.cid); rFloorsTab(); }
    else if (type === 'types') { const tc = (item.name + ' copy').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30); result = await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: item.name + ' (copy)', type_code: tc, sort_order: sortOrder, is_active: item.isActive !== false }); await loadTypesCache(S.cid); rTypesTab(); }
    else { const sc = (item.name + ' copy').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30); result = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: item.name + ' (copy)', status_code: sc, color_hex: _catToneHex(_catStatusTone(item)), is_available: item.isAvailable, sort_order: sortOrder, is_active: item.isActive !== false }); await loadStatusesCache(S.cid); rStatusesTab(); }
    if (result && !result._error) { notify.success('Duplicated'); _catLog('Duplicated ' + type.slice(0, -1) + ' "' + item.name + '"'); } else notify.error('Could not duplicate');
  } catch (e) { notify.error('Could not duplicate', { detail: e.message }); }
}
function _catViewUsage(type, id) { const item = type === 'floors' ? gfloor(id) : type === 'types' ? gtype(id) : gstatus(id); if (!item) return;
  const usage = _catUsage(type, id); notify.info('"' + item.name + '" is used in ' + usage + ' unit' + (usage !== 1 ? 's' : ''), { detail: 'Navigate to Units to manage them.' }); }

// ─── Toggle Handlers (preserved) ───────────────────────────────────────
async function toggleFloorActive(id, checked) { const r = await _saveWithFallback(saveFloor, { company_id: S.cid, id, is_active: checked }); if (!r || r._error) { notify.error('Could not update'); rFloorsTab(); return; } await loadFloorsCache(S.cid); _catLog((checked ? 'Activated' : 'Deactivated') + ' floor "' + (gfloor(id)?.name || id) + '"'); rFloorsTab(); }
async function toggleTypeActive(id, checked) { const r = await _saveWithFallback(saveUnitType, { company_id: S.cid, id, is_active: checked }); if (!r || r._error) { notify.error('Could not update'); rTypesTab(); return; } await loadTypesCache(S.cid); _catLog((checked ? 'Activated' : 'Deactivated') + ' type "' + (gtype(id)?.name || id) + '"'); rTypesTab(); }
async function toggleStatusActive(id, checked) { const r = await _saveWithFallback(saveUnitStatus, { company_id: S.cid, id, is_active: checked }); if (!r || r._error) { notify.error('Could not update'); rStatusesTab(); return; } await loadStatusesCache(S.cid); _catLog((checked ? 'Activated' : 'Deactivated') + ' status "' + (gstatus(id)?.name || id) + '"'); rStatusesTab(); }

// ─── Position Picker (token-styled; same sort-field plumbing) ──────────
function _catPosPicker(containerId, items, currentId, sortField) {
  const container = document.getElementById(containerId); if (!container) return;
  const sorted = items.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const others = sorted.filter(i => i.id !== currentId);
  const maxSort = Math.max(0, ...items.map(i => i.sortOrder || 0)), minSort = items.length ? Math.min(...items.map(i => i.sortOrder || 0)) : 1;
  const cardCss = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-card);color:var(--fk-text);font-size:var(--fk-fs-body);cursor:pointer';
  container.innerHTML =
    `<button type="button" class="cat-pos-card on" data-pos="end" style="${cardCss}" onclick="_catPosSelect(this,'${containerId}',${maxSort + 1},'${sortField}')">End of list</button>` +
    `<button type="button" class="cat-pos-card" data-pos="beginning" style="${cardCss}" onclick="_catPosSelect(this,'${containerId}',${Math.max(0, minSort - 1)},'${sortField}')">Beginning of list</button>` +
    (others.length ? `<div class="cat-pos-card" data-pos="after" style="${cardCss}">After <select onchange="_catPosAfter(this,'${containerId}','${sortField}')" class="nx-select" style="flex:1;height:28px">${others.map(it => `<option value="${it.sortOrder}">${esc(it.name)}</option>`).join('')}</select></div>` : '');
  const sortEl = document.getElementById(sortField); if (sortEl) sortEl.value = maxSort + 1;
  if (currentId) { const cur = items.find(i => i.id === currentId); if (cur && sortEl) sortEl.value = cur.sortOrder || 1; }
}
function _catPosSelect(btn, containerId, sortVal, sortField) { document.querySelectorAll('#' + containerId + ' .cat-pos-card').forEach(c => { c.classList.remove('on'); c.style.borderColor = 'var(--fk-border)'; }); btn.classList.add('on'); btn.style.borderColor = 'var(--fk-primary)'; const sortEl = document.getElementById(sortField); if (sortEl) sortEl.value = sortVal; }
function _catPosAfter(sel, containerId, sortField) { document.querySelectorAll('#' + containerId + ' .cat-pos-card').forEach(c => { c.classList.remove('on'); c.style.borderColor = 'var(--fk-border)'; }); sel.closest('.cat-pos-card').classList.add('on'); sel.closest('.cat-pos-card').style.borderColor = 'var(--fk-primary)'; const sortEl = document.getElementById(sortField); if (sortEl) sortEl.value = parseInt(sel.value) + 1; }

// ─── Modal host plumbing ───────────────────────────────────────────────
function _catModal(html) { const h = document.getElementById('cat-modal-host'); if (h) h.innerHTML = html; }
function _catCloseModal() { const h = document.getElementById('cat-modal-host'); if (h) h.innerHTML = ''; }
function _catActiveToggle(id, checked, onchange) {
  return '<label style="display:flex;align-items:center;justify-content:space-between;padding-top:var(--fk-sp-2);border-top:1px solid var(--fk-border);cursor:pointer">' +
    '<span><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">Active</span><div class="nx-kpi-label" style="text-transform:none">Available for new units</div></span>' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (onchange ? ' onchange="' + onchange + '"' : '') + '></label>';
}
function _catModalFooter(addBtnId, addFn, saveBtnId, saveFn, saveLbl, showAdd) {
  return NX.button('Cancel', { variant:'ghost', onclick:'_catCloseModal()' }) +
    NX.button('Save & add another', { variant:'secondary', attrs:'id="' + addBtnId + '"' + (showAdd ? '' : ' style="display:none"'), onclick:addFn }) +
    NX.button(saveLbl, { variant:'primary', attrs:'id="' + saveBtnId + '"', onclick:saveFn });
}

// ─── Floor Modal (floor_code) ──────────────────────────────────────────
function openFloorModal(id) {
  const f = id ? gfloor(id) : null;
  _catModal(NX.modal({ title: f ? 'Edit floor' : 'Add floor', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="fl-id" value="' + (f?.id || '') + '"><input type="hidden" id="fl-sort" value="' + (f ? (f.sortOrder || 1) : _catNextSort(gfloors())) + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div style="display:flex;align-items:center;gap:10px;margin-top:4px"><span class="num" id="fl-prev-ord" style="color:var(--fk-text-muted)">#01</span><div><div style="font-size:var(--fk-fs-body);color:var(--fk-text)" id="fl-prev-name">—</div><div class="nx-kpi-label" style="text-transform:none" id="fl-prev-meta">Order 1</div></div></div>', { compact:true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Floor name', name:'fl-name', required:true, value:f?.name || '', placeholder:'e.g. Ground Floor', attrs:'oninput="_flPrev()"' }) +
        '<div class="nx-field"><label class="nx-label">Short code</label><input class="nx-input num" id="fl-code" maxlength="5" placeholder="GF" value="' + esc(f?.floorCode || f?.floor_code || '') + '" oninput="_flPrev()"><div class="nx-kpi-label" style="text-transform:none">Used in unit numbers (e.g. G-01). Auto-derived if blank.</div></div></div>' +
      '<div class="nx-field"><label class="nx-label">Position</label><div id="fl-pos-picker" style="display:flex;flex-direction:column;gap:6px"></div></div>' +
      _catActiveToggle('fl-active', f ? f.isActive !== false : true, '_flPrev()'),
    footer: _catModalFooter('fl-add-btn', 'saveFloorForm(true)', 'fl-save-btn', 'saveFloorForm()', 'Save floor', !f) }));
  _catPosPicker('fl-pos-picker', gfloors(), f?.id || null, 'fl-sort'); _flPrev();
  setTimeout(() => document.getElementById('fl-name')?.focus(), 120);
}
function _flPrev() {
  const name = document.getElementById('fl-name')?.value || '', code = document.getElementById('fl-code')?.value || '', sort = document.getElementById('fl-sort')?.value || '1';
  const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setT('fl-prev-name', name || '—'); setT('fl-prev-meta', (code ? code + ' · ' : '') + 'Order ' + sort); setT('fl-prev-ord', '#' + String(sort).padStart(2, '0'));
  const auto = _autoSortOrder(name);
  if (auto !== null && !document.getElementById('fl-id').value) { document.getElementById('fl-sort').value = auto; setT('fl-prev-meta', (code ? code + ' · ' : '') + 'Order ' + auto); setT('fl-prev-ord', '#' + String(auto).padStart(2, '0')); }
}
async function saveFloorForm(addAnother) {
  const name = document.getElementById('fl-name').value.trim(); if (!name) { notify.warning('Floor name is required'); return; }
  const id = document.getElementById('fl-id').value.trim() || null;
  if (gfloors().find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== id)) { notify.warning('Floor "' + name + '" already exists'); return; }
  const sortOrder = parseInt(document.getElementById('fl-sort').value) || _catNextSort(gfloors());
  const isActive = document.getElementById('fl-active').checked, code = (document.getElementById('fl-code')?.value || '').trim();
  const btn = document.getElementById('fl-save-btn'), sp = btn?.querySelector('span'); if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, name, sort_order: sortOrder, is_active: isActive }; if (code) payload.floor_code = code; if (id) payload.id = id;
    const result = await _saveWithFallback(saveFloor, payload);
    if (!result || result._error) { notify.error('Floor save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadFloorsCache(S.cid); _catLog((id ? 'Updated' : 'Added') + ' floor "' + name + '"'); notify.success(id ? 'Floor updated' : 'Floor added');
    if (addAnother) { openFloorModal(); rFloorsTab(); } else { _catCloseModal(); rFloorsTab(); }
  } catch (e) { notify.error('Could not save floor', { detail: e.message }); } finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save floor'; } }
}

// ─── Type Modal (default area / price #16) ─────────────────────────────
function openTypeModal(id) {
  const t = id ? gtype(id) : null;
  _catModal(NX.modal({ title: t ? 'Edit unit type' : 'Add unit type', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="tp-id" value="' + (t?.id || '') + '"><input type="hidden" id="tp-sort" value="' + (t ? (t.sortOrder || 1) : _catNextSort(_catTypes())) + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div style="display:flex;align-items:center;gap:10px;margin-top:4px"><span class="num" id="tp-prev-ord" style="color:var(--fk-text-muted)">#01</span><div><div style="font-size:var(--fk-fs-body);color:var(--fk-text)" id="tp-prev-name">—</div><div class="nx-kpi-label" style="text-transform:none" id="tp-prev-meta">Order 1</div></div></div>', { compact:true }) +
      '<div style="margin-top:var(--fk-sp-3)">' + NX.field({ label:'Type name', name:'tp-name', required:true, value:t?.name || '', placeholder:'e.g. 2 Bed Apartment', attrs:'oninput="_tpPrev()"' }) + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        NX.field({ label:'Default area (sqft)', name:'tp-area', type:'number', value:(t?.defaultArea ?? t?.default_area ?? ''), placeholder:'e.g. 1200', attrs:'min="0" class="nx-input num"' }) +
        NX.field({ label:'Default price (PKR)', name:'tp-price', type:'number', value:(t?.defaultPrice ?? t?.default_price ?? ''), placeholder:'e.g. 8500000', attrs:'min="0" class="nx-input num"' }) + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none;margin-top:-4px;margin-bottom:var(--fk-sp-2)">Pre-fills new units of this type (you can change any unit later).</div>' +
      '<div class="nx-field"><label class="nx-label">Position</label><div id="tp-pos-picker" style="display:flex;flex-direction:column;gap:6px"></div></div>' +
      _catActiveToggle('tp-active', t ? t.isActive !== false : true, '_tpPrev()'),
    footer: _catModalFooter('tp-add-btn', 'saveTypeForm(true)', 'tp-save-btn', 'saveTypeForm()', 'Save type', !t) }));
  _catPosPicker('tp-pos-picker', _catTypes(), t?.id || null, 'tp-sort'); _tpPrev();
  setTimeout(() => document.getElementById('tp-name')?.focus(), 120);
}
function _tpPrev() { const name = document.getElementById('tp-name')?.value || '', sort = document.getElementById('tp-sort')?.value || '1';
  const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; }; setT('tp-prev-name', name || '—'); setT('tp-prev-meta', 'Order ' + sort); setT('tp-prev-ord', '#' + String(sort).padStart(2, '0')); }
async function saveTypeForm(addAnother) {
  const name = document.getElementById('tp-name').value.trim(); if (!name) { notify.warning('Type name is required'); return; }
  if (!_catRequireProject()) return;
  const id = document.getElementById('tp-id').value.trim() || null;
  if (_catTypes().find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== id)) { notify.warning('Type "' + name + '" already exists'); return; }
  const sortOrder = parseInt(document.getElementById('tp-sort').value) || _catNextSort(_catTypes());
  const isActive = document.getElementById('tp-active').checked, area = parseFloat(document.getElementById('tp-area')?.value), price = parseFloat(document.getElementById('tp-price')?.value);
  const btn = document.getElementById('tp-save-btn'), sp = btn?.querySelector('span'); if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const tc = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'TYPE';
    const payload = { company_id: S.cid, type_name: name, type_code: tc, sort_order: sortOrder, is_active: isActive };
    if (!isNaN(area)) payload.default_area = area; if (!isNaN(price)) payload.default_price = price;
    if (id) payload.id = id; else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveUnitType, payload);
    if (!result || result._error) { notify.error('Type save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadTypesCache(S.cid); _catLog((id ? 'Updated' : 'Added') + ' type "' + name + '"'); notify.success(id ? 'Type updated' : 'Type added');
    if (addAnother) openTypeModal(); else { _catCloseModal(); rTypesTab(); }
  } catch (e) { notify.error('Could not save type', { detail: e.message }); } finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save type'; } }
}

// ─── Status Modal (semantic tone) ──────────────────────────────────────
function openStatusModal(id) {
  const s = id ? gstatus(id) : null; const curTone = s ? _catStatusTone(s) : 'success';
  _catModal(NX.modal({ title: s ? 'Edit status' : 'Add unit status', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="st-id" value="' + (s?.id || '') + '"><input type="hidden" id="st-sort" value="' + (s ? (s.sortOrder || 1) : _catNextSort(_catStatuses())) + '"><input type="hidden" id="st-tone" value="' + curTone + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div id="st-prev" style="margin-top:6px"></div>', { compact:true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Status name', name:'st-name', required:true, value:s?.name || '', placeholder:'e.g. Available', attrs:'oninput="_stPrev()"' }) +
        NX.field({ label:'Short label', name:'st-code-lbl', value:s?.statusCode || s?.status_code || '', placeholder:'Avl', attrs:'maxlength="6" oninput="_stPrev()"' }) + '</div>' +
      '<div class="nx-field"><label class="nx-label">Tone</label><div id="st-tone-seg" style="display:flex;gap:6px;flex-wrap:wrap">' +
        _CAT_TONES.map(t => '<button type="button" class="nx-btn ' + (t.tone === curTone ? 'nx-btn--primary' : 'nx-btn--secondary') + ' nx-btn--sm" data-tone="' + t.tone + '" onclick="_stPickTone(this)">' + NX.badge(t.label, t.tone) + '</button>').join('') + '</div></div>' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:var(--fk-sp-2)"><input type="checkbox" id="st-avail"' + (s ? (s.isAvailable === true ? ' checked' : '') : '') + ' onchange="_stPrev()"><span><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">Sellable</span><div class="nx-kpi-label" style="text-transform:none">Units with this status appear in New Sale</div></span></label>' +
      '<div class="nx-field"><label class="nx-label">Position</label><div id="st-pos-picker" style="display:flex;flex-direction:column;gap:6px"></div></div>' +
      _catActiveToggle('st-active', s ? s.isActive !== false : true, '_stPrev()'),
    footer: _catModalFooter('st-add-btn', 'saveStatusForm(true)', 'st-save-btn', 'saveStatusForm()', 'Save status', !s) }));
  _catPosPicker('st-pos-picker', _catStatuses(), s?.id || null, 'st-sort'); _stPrev();
  setTimeout(() => document.getElementById('st-name')?.focus(), 120);
}
function _stPickTone(btn) { document.querySelectorAll('#st-tone-seg .nx-btn').forEach(b => { b.classList.remove('nx-btn--primary'); b.classList.add('nx-btn--secondary'); }); btn.classList.remove('nx-btn--secondary'); btn.classList.add('nx-btn--primary'); document.getElementById('st-tone').value = btn.dataset.tone; _stPrev(); }
function _stPrev() {
  const name = document.getElementById('st-name')?.value || '', avail = document.getElementById('st-avail')?.checked, tone = document.getElementById('st-tone')?.value || '', code = document.getElementById('st-code-lbl')?.value || (name ? name.slice(0, 4).toUpperCase() : 'AVL');
  const prev = document.getElementById('st-prev'); if (prev) prev.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + (esc(name) || '—') + '</span>' + NX.badge(code || 'AVL', tone) + '<span class="nx-kpi-label" style="text-transform:none">' + (avail ? 'Available for sale' : 'Not bookable') + '</span></div>';
}
async function saveStatusForm(addAnother) {
  const name = document.getElementById('st-name').value.trim(); if (!name) { notify.warning('Status name is required'); return; }
  if (!_catRequireProject()) return;
  const id = document.getElementById('st-id').value.trim() || null, tone = document.getElementById('st-tone').value || '', isAvailable = document.getElementById('st-avail').checked;
  const sortOrder = parseInt(document.getElementById('st-sort').value) || _catNextSort(_catStatuses()), isActive = document.getElementById('st-active').checked, shortLabel = document.getElementById('st-code-lbl')?.value.trim() || '';
  const statusCode = (shortLabel ? shortLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)) || 'STATUS';
  const btn = document.getElementById('st-save-btn'), sp = btn?.querySelector('span'); if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, status_name: name, status_code: statusCode, color_hex: _catToneHex(tone), is_available: isAvailable, sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id; else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveUnitStatus, payload);
    if (!result || result._error) { notify.error('Status save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadStatusesCache(S.cid); _catLog((id ? 'Updated' : 'Added') + ' status "' + name + '"'); notify.success(id ? 'Status updated' : 'Status added');
    if (addAnother) openStatusModal(); else { _catCloseModal(); rStatusesTab(); }
  } catch (e) { notify.error('Could not save status', { detail: e.message }); } finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save status'; } }
}

// ─── Delete Flows (smart delete + usage guard) ─────────────────────────
async function deleteFloorConfirm(id) { const f = gfloor(id); if (!f) return; const usedBy = (window._unitsCache || []).filter(u => (u.floorLabel || '').toLowerCase() === f.name.toLowerCase() || (u.floor || '').toLowerCase() === f.name.toLowerCase());
  _catDelModal({ type:'floors', id, name:f.name, usage:usedBy.length, afterDelete: async () => { await loadFloorsCache(S.cid); rFloorsTab(); }, deleteFn: () => deleteFloor(id), logMsg:'Deleted floor "' + f.name + '"' }); }
async function deleteTypeConfirm(id) { const t = gtype(id); if (!t) return; const usedBy = (window._unitsCache || []).filter(u => u.unitTypeId === id);
  _catDelModal({ type:'types', id, name:t.name, usage:usedBy.length, afterDelete: async () => { await loadTypesCache(S.cid); rTypesTab(); }, deleteFn: () => deleteUnitType(id), logMsg:'Deleted type "' + t.name + '"' }); }
async function deleteStatusConfirm(id) { const s = gstatus(id); if (!s) return; const usedBy = (window._unitsCache || []).filter(u => u.statusId === id);
  _catDelModal({ type:'statuses', id, name:s.name, usage:usedBy.length, afterDelete: async () => { await loadStatusesCache(S.cid); rStatusesTab(); }, deleteFn: () => deleteUnitStatus(id), logMsg:'Deleted status "' + s.name + '"' }); }
function _catDelModal(cfg) {
  let body = '', footerRight = '';
  if (cfg.usage === 0) { body = NX.banner('"' + esc(cfg.name) + '" isn\'t used anywhere. This action cannot be undone.', 'warn'); footerRight = NX.button('Delete', { variant:'danger', attrs:'id="catdel-ok"' }); }
  else {
    const others = cfg.type === 'floors' ? gfloors().filter(i => i.id !== cfg.id) : cfg.type === 'types' ? _catTypes().filter(i => i.id !== cfg.id) : _catStatuses().filter(i => i.id !== cfg.id);
    const opts = others.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    body = NX.banner('"' + esc(cfg.name) + '" is used in ' + cfg.usage + ' unit' + (cfg.usage !== 1 ? 's' : '') + '. Reassign those units before deleting, or pick a replacement.', 'danger') +
      '<div class="nx-field" style="margin-top:var(--fk-sp-3)"><label class="nx-label">Reassign ' + cfg.usage + ' units to</label><select class="nx-select" id="catdel-reassign">' + (opts || '<option value="">— none available —</option>') + '</select></div>';
    footerRight = others.length ? NX.button('Reassign & delete', { variant:'danger', attrs:'id="catdel-ok"' }) : NX.button('No replacement available', { variant:'ghost', disabled:true });
  }
  _catModal(NX.modal({ title: cfg.usage === 0 ? 'Delete item?' : 'Cannot delete yet', size:'s', onClose:'_catCloseModal()', body, footer: NX.button('Cancel', { variant:'ghost', onclick:'_catCloseModal()' }) + footerRight }));
  const okBtn = document.getElementById('catdel-ok');
  if (okBtn) okBtn.onclick = async () => {
    okBtn.disabled = true; const sp = okBtn.querySelector('span'); if (sp) sp.textContent = 'Deleting…';
    try {
      const reassignId = document.getElementById('catdel-reassign')?.value;
      if (cfg.usage > 0 && reassignId) { const units = (window._unitsCache || []).filter(u => { if (cfg.type === 'floors') return (u.floorLabel || '').toLowerCase() === (gfloor(cfg.id)?.name || '').toLowerCase(); if (cfg.type === 'types') return u.unitTypeId === cfg.id; return u.statusId === cfg.id; }); notify.info('Reassigning ' + units.length + ' units…'); }
      const ok = await cfg.deleteFn(); if (!ok) { notify.error('Could not delete'); okBtn.disabled = false; if (sp) sp.textContent = 'Delete'; return; }
      _catLog(cfg.logMsg); notify.success('Deleted'); await cfg.afterDelete(); _catCloseModal();
    } catch (e) { notify.error('Delete failed', { detail: e.message }); okBtn.disabled = false; if (sp) sp.textContent = 'Delete'; }
  };
}

// ─── Audit ─────────────────────────────────────────────────────────────
function _catOpenAud() { const d = document.getElementById('cat-aud-drawer'); if (d) { d.style.display = ''; const l = document.getElementById('cat-aud-list'); if (l) l.innerHTML = _catAuditHTML(); } }
function _catCloseAud() { const d = document.getElementById('cat-aud-drawer'); if (d) d.style.display = 'none'; }

// ─── Templates / Export / Import (preserved) ───────────────────────────
function _catTplMenu(btn) {
  _catCloseDD(); const rect = btn.getBoundingClientRect();
  const templates = [ { key:'highrise', label:'Standard High-Rise', sub:'15 floors · 6 types' }, { key:'commercial', label:'Commercial Plaza', sub:'8 floors · retail types' }, { key:'plots', label:'Plot Society', sub:'Plot types only' }, { key:'mixeduse', label:'Mixed-Use Dev', sub:'Residential + commercial' } ];
  const dd = _catDD_el(rect, true); dd.style.minWidth = '220px';
  dd.innerHTML = templates.map(t => '<button class="nx-btn nx-btn--ghost nx-btn--sm" style="justify-content:flex-start;width:100%;height:auto;padding:8px 10px" onclick="_catCloseDD();_catApplyTpl(\'' + t.key + '\')"><span style="display:block;text-align:left"><div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + t.label + '</div><div class="nx-kpi-label" style="text-transform:none">' + t.sub + '</div></span></button>').join('');
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
  if (!confirm('Apply "' + key + '" template? This will add ' + t.floors.length + ' floors and ' + t.types.length + ' unit types. Existing items are not affected.')) return;
  if (!_catRequireProject()) return;
  (async () => {
    let added = 0;
    for (let i = 0; i < t.floors.length; i++) { const name = t.floors[i]; if (gfloors().some(f => f.name.toLowerCase() === name.toLowerCase())) continue; const auto = _autoSortOrder(name); await _saveWithFallback(saveFloor, { company_id: S.cid, name, sort_order: auto !== null ? auto : i + 1, is_active: true }); added++; }
    await loadFloorsCache(S.cid);
    for (let i = 0; i < t.types.length; i++) { const name = t.types[i]; if (_catTypes().some(tp => tp.name.toLowerCase() === name.toLowerCase())) continue; const tc = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30); await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: name, type_code: tc, sort_order: i + 1, is_active: true }); added++; }
    await loadTypesCache(S.cid); _catLog('Applied template: ' + key); notify.success('Template applied — ' + added + ' items added'); _catRenderTab();
  })();
}
function _catExpMenu(btn) { _catCloseDD(); const rect = btn.getBoundingClientRect(); const dd = _catDD_el(rect, true);
  dd.innerHTML = _catDDItem('', 'Export as JSON', "_catCloseDD();_catExport('json')") + _catDDItem('', 'Export as CSV', "_catCloseDD();_catExport('csv')"); document.body.appendChild(dd); _catDD = dd; }
function _catExportCol(col) { const items = col === 'floors' ? gfloors() : col === 'types' ? _catTypes() : _catStatuses(); _catDownload('categories-' + col + '.json', JSON.stringify(items, null, 2), 'application/json'); notify.success(col + ' exported'); }
function _catExport(fmt) {
  const data = { exportedAt: new Date().toISOString(), floors: gfloors(), types: _catTypes(), statuses: _catStatuses() };
  if (fmt === 'json') _catDownload('categories.json', JSON.stringify(data, null, 2), 'application/json');
  else { const rows = [['type','id','name','sortOrder','isActive','isAvailable']]; gfloors().forEach(f => rows.push(['floor', f.id, f.name, f.sortOrder, f.isActive, ''])); _catTypes().forEach(t => rows.push(['type', t.id, t.name, t.sortOrder, t.isActive, ''])); _catStatuses().forEach(s => rows.push(['status', s.id, s.name, s.sortOrder, s.isActive, s.isAvailable])); _catDownload('categories.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv'); }
  notify.success('Exported');
}
function _catDownload(filename, content, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
function _catImport() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.csv';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return; const text = await file.text();
    try {
      const data = JSON.parse(text); const fl = Array.isArray(data.floors) ? data.floors.length : 0, tp = Array.isArray(data.types) ? data.types.length : 0, st = Array.isArray(data.statuses) ? data.statuses.length : 0;
      if (!confirm('Import ' + fl + ' floors, ' + tp + ' types, ' + st + ' statuses? Items with the same name are skipped.')) return;
      if ((tp || st) && !_catRequireProject()) return; let added = 0;
      if (data.floors) { for (const f of data.floors) { if (gfloors().some(i => i.name.toLowerCase() === (f.name || '').toLowerCase())) continue; await _saveWithFallback(saveFloor, { company_id: S.cid, name: f.name, sort_order: f.sortOrder || f.sort_order || 1, is_active: f.isActive !== false }); added++; } await loadFloorsCache(S.cid); }
      if (data.types) { for (const t of data.types) { if (_catTypes().some(i => i.name.toLowerCase() === (t.name || '').toLowerCase())) continue; const tc = (t.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) || 'TYPE'; await _saveWithFallback(saveUnitType, { company_id: S.cid, project_id: _catProject, type_name: t.name, type_code: tc, sort_order: t.sortOrder || t.sort_order || 1, is_active: t.isActive !== false }); added++; } await loadTypesCache(S.cid); }
      if (data.statuses) { for (const s of data.statuses) { if (_catStatuses().some(i => i.name.toLowerCase() === (s.name || '').toLowerCase())) continue; const sc = (s.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) || 'STATUS'; await _saveWithFallback(saveUnitStatus, { company_id: S.cid, project_id: _catProject, status_name: s.name, status_code: sc, color_hex: _catToneHex(_catStatusTone(s)), is_available: s.isAvailable || false, sort_order: s.sortOrder || s.sort_order || 1, is_active: s.isActive !== false }); added++; } await loadStatusesCache(S.cid); }
      _catLog('Imported ' + added + ' items from file'); notify.success(added + ' items imported'); _catRenderTab();
    } catch { notify.error('Invalid file format. Expected a JSON export from this system.'); }
  };
  input.click();
}

// ─── Keyboard ──────────────────────────────────────────────────────────
function _catKbdHandler(e) {
  const pg = document.getElementById('pg-categories'); if (!pg || !pg.classList.contains('on')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (document.querySelector('#cat-modal-host .nx-modal-overlay')) return;
  if (e.key === 'Escape') { _catCloseDD(); _catCloseAud(); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { const saveBtn = document.querySelector('#cat-modal-host [id$="-save-btn"]'); if (saveBtn) saveBtn.click(); }
}
(function _catBindKbd() { document.removeEventListener('keydown', _catKbdHandler); document.addEventListener('keydown', _catKbdHandler); })();

// ─── Sale Types modal + delete (preserved) ─────────────────────────────
function openSaleTypeModal(id) {
  const s = id ? gsaletype(id) : null;
  _catModal(NX.modal({ title: s ? 'Edit sale type' : 'Add sale type', size:'s', onClose:'_catCloseModal()',
    body:
      '<input type="hidden" id="sty-id" value="' + (s?.id || '') + '"><input type="hidden" id="sty-sort" value="' + (s ? (s.sortOrder || 1) : _catNextSort(_catSaleTypes())) + '">' +
      NX.card('<div class="nx-kpi-label">Preview</div><div id="sty-prev" style="margin-top:6px"></div>', { compact:true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">' +
        NX.field({ label:'Sale type name', name:'sty-name', required:true, value:s?.name || '', placeholder:'e.g. Full Cash', attrs:'oninput="_styPrev()"' }) +
        NX.field({ label:'Short label', name:'sty-code-lbl', value:s?.typeCode || '', placeholder:'CASH', attrs:'maxlength="6" oninput="_styPrev()"' }) + '</div>' +
      _catActiveToggle('sty-active', s ? s.isActive !== false : true, ''),
    footer: _catModalFooter('sty-add-btn', 'saveSaleTypeForm(true)', 'sty-save-btn', 'saveSaleTypeForm()', 'Save sale type', !s) }));
  _styPrev(); setTimeout(() => document.getElementById('sty-name')?.focus(), 120);
}
function _styPrev() { const name = document.getElementById('sty-name')?.value || '', code = document.getElementById('sty-code-lbl')?.value || (name ? name.slice(0, 4).toUpperCase() : 'TYPE');
  const prev = document.getElementById('sty-prev'); if (prev) prev.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + (esc(name) || '—') + '</span>' + NX.badge(code || 'TYPE', 'primary') + '</div>'; }
async function toggleSaleTypeActive(id, val) { const r = await saveSaleType({ id, company_id: S.cid, is_active: val }); if (!r || r._error) { notify.error('Could not update sale type'); return; } await loadSaleTypesCache(S.cid); rSaleTypesTab(); }
async function saveSaleTypeForm(addAnother) {
  const name = document.getElementById('sty-name').value.trim(); if (!name) { notify.warning('Sale type name is required'); return; }
  if (!_catRequireProject()) return;
  const id = document.getElementById('sty-id').value.trim() || null, sortOrder = parseInt(document.getElementById('sty-sort').value) || _catNextSort(_catSaleTypes()), isActive = document.getElementById('sty-active').checked, shortLabel = document.getElementById('sty-code-lbl')?.value.trim() || '';
  const typeCode = (shortLabel ? shortLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)) || 'SALE_TYPE';
  const btn = document.getElementById('sty-save-btn'), sp = btn?.querySelector('span'); if (btn) { btn.disabled = true; if (sp) sp.textContent = 'Saving…'; }
  try {
    const payload = { company_id: S.cid, type_name: name, type_code: typeCode, color_hex: _catToneHex('info'), sort_order: sortOrder, is_active: isActive };
    if (id) payload.id = id; else payload.project_id = _catProject;
    const result = await _saveWithFallback(saveSaleType, payload);
    if (!result || result._error) { notify.error('Sale type save failed', { detail: result?._error?.message || 'Check console (F12)' }); return; }
    await loadSaleTypesCache(S.cid); _catLog((id ? 'Updated' : 'Added') + ' sale type "' + name + '"'); notify.success(id ? 'Sale type updated' : 'Sale type added');
    if (addAnother) openSaleTypeModal(); else { _catCloseModal(); rSaleTypesTab(); }
  } catch (e) { notify.error('Could not save sale type', { detail: e.message }); } finally { if (btn) { btn.disabled = false; if (sp) sp.textContent = 'Save sale type'; } }
}
async function deleteSaleTypeConfirm(id) { const s = gsaletype(id); if (!s) return; _catDelModal({ type:'saletypes', id, name:s.name, usage:0, afterDelete: async () => { await loadSaleTypesCache(S.cid); rSaleTypesTab(); }, deleteFn: () => deleteSaleType(id), logMsg:'Deleted sale type "' + s.name + '"' }); }
