// ══════════════════════════════════════════════════════════════════════════
// UNITS — Phase 3C rebuild on the foundation kit (2026-06-12)
// Floor-grouped inventory (grid / nx-table), live counts, quick-add (≤15s),
// ONE consolidated full-form modal, and a bulk generator (floors × units/floor
// → {floor}-{NN} → preview → bulk_create_units). The duplicate add-unit page
// (rAddUnit) is GONE; the addunit route redirects here.
//
// DATA-TRAP FIX (audit §11): every write sets floor_id (the FK), not just the
// floor_label string. The old saveUnitForm sent floor_label/floor_no but NOT
// floor_id → form-added units had a NULL FK. Quick-add, full-form and bulk all
// now send floor_id. NOTE: single creates use create_unit (it writes floor_id);
// upsert_unit IGNORES floor_id — do not switch to it.
//
// Kit only: NX.* / .nx-* + --fk-* tokens. No hardcoded hex, no off-scale sizes.
// Data source: window._unitsCache (db.js loadUnitsCache) + _floorsCache /
// _typesCache / _statusesCache. RPCs: create_unit, update_unit, bulk_create_units,
// delete_unit, generate-not-needed (RPC auto-codes).
// ══════════════════════════════════════════════════════════════════════════

// RPCs: create_unit, update_unit, delete_unit, bulk_create_units
let _uView = 'grid';                 // 'grid' | 'table'
let _uSearch = '';
let _uFloorFilter = '', _uTypeFilter = '', _uStatusFilter = '';
let _uCollapsed = {};                // floor section collapse state (by floorId)

function _uUnits() { return Array.isArray(window._unitsCache) ? window._unitsCache : []; }
function _uFloors() { return (window._floorsCache || []).slice().sort((a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) || String(a.name || '').localeCompare(String(b.name || ''))); }
function _uTypes() { return (window._typesCache || []).filter(t => t.isActive !== false); }
function _uStatuses() { return (window._statusesCache || []).filter(s => s.isActive !== false); }

// status chip — Available (green) is the ONLY loud chip: a sales team scans for open
// inventory, so that's the one that should pop. Sold is settled, not a call to action →
// neutral/muted (bare nx-badge: subtle bg + muted text). Blocked/other → amber caution.
function _uStatusChip(u) {
  const tone = u.saleId ? '' : (u.isAvailable ? 'success' : 'warning');
  const cls = 'nx-badge' + (tone ? ' nx-badge--' + tone : '');
  return `<span class="${cls}"><span class="nx-dot"></span>${esc(u.status || (u.saleId ? 'Sold' : 'Available'))}</span>`;
}

function _uCounts(units) {
  const total = units.length;
  const sold = units.filter(u => u.saleId).length;
  const available = units.filter(u => u.isAvailable && !u.saleId).length;
  const blocked = total - sold - available;
  return { total, sold, available, blocked };
}

function _uFiltered() {
  const q = _uSearch.trim().toLowerCase();
  return _uUnits().filter(u => {
    if (_uFloorFilter && u.floorId !== _uFloorFilter) return false;
    if (_uTypeFilter && u.unitTypeId !== _uTypeFilter) return false;
    if (_uStatusFilter && u.statusId !== _uStatusFilter) return false;
    if (q) {
      const hay = (u.unitNo + ' ' + (u.type || '') + ' ' + (u.floorLabel || '') + ' ' + (u.customerName || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ════════════════════════════════════════════════════════════════════════
   rUnits — the page
   ════════════════════════════════════════════════════════════════════════ */
function rUnits() {
  const pg = document.getElementById('pg-units');
  if (!pg) return;
  const all = _uUnits();
  // Empty inventory → wizard CTA
  if (!all.length) {
    pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">
      ${NX.pageHeader('Inventory', '', { icon:'package' })}
      <div class="nx-card">${NX.empty({
        icon: 'inbox',
        message: 'No units yet. Set up your project — floors, types and units — in a couple of minutes.',
        action: NX.button('Set up your project', { variant: 'primary', onclick: "if(typeof OB!=='undefined')OB.show(S&&S.cid)" }) +
                ' ' + NX.button('Add one unit', { variant: 'secondary', onclick: 'openUnitModal(null)' })
      })}</div></div>`;
    return;
  }
  const filtered = _uFiltered();
  const c = _uCounts(all);
  const countLine = `${c.total} units · ${c.sold} sold · ${c.available} available${c.blocked ? ' · ' + c.blocked + ' blocked' : ''}`;
  const actions =
    NX.button('Quick add', { variant: 'secondary', size: 'sm', icon: 'plus', onclick: '_uToggleQuickAdd()' }) +
    NX.button('Bulk generate', { variant: 'secondary', size: 'sm', onclick: 'openBulkGen()' }) +
    NX.button('Add unit', { variant: 'primary', size: 'sm', icon: 'plus', onclick: 'openUnitModal(null)' });

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    <div class="nx-page-header">
      <div class="nx-page-head-l">
        ${NX.ichip('package', '', { size:'lg' })}
        <div>
          <h1 class="nx-page-title">Inventory</h1>
          <div class="nx-kpi-label" style="margin-top:4px">${esc(countLine)}</div>
        </div>
      </div>
      <div class="nx-page-actions">${actions}</div>
    </div>

    <div class="nx-card nx-card--compact" style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:center">
      <input class="nx-input" style="max-width:240px" placeholder="Search unit, type, floor, client…" value="${esc(_uSearch)}" oninput="_uSetSearch(this.value)">
      ${_uFilterSelect('floor', 'All floors', _uFloors().map(f => ({ v: f.id, l: f.name })), _uFloorFilter)}
      ${_uFilterSelect('type', 'All types', _uTypes().map(t => ({ v: t.id, l: t.name })), _uTypeFilter)}
      ${_uFilterSelect('status', 'All statuses', _uStatuses().map(s => ({ v: s.id, l: s.name })), _uStatusFilter)}
      <div style="flex:1"></div>
      <div style="display:inline-flex;gap:2px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);padding:2px">
        <button class="nx-btn nx-btn--sm ${_uView === 'grid' ? 'nx-btn--primary' : 'nx-btn--ghost'}" onclick="_uSetView('grid')">Grid</button>
        <button class="nx-btn nx-btn--sm ${_uView === 'table' ? 'nx-btn--primary' : 'nx-btn--ghost'}" onclick="_uSetView('table')">Table</button>
      </div>
    </div>

    <div id="u-quickadd" style="display:none">${_uQuickAddBar()}</div>

    <div id="u-body">${_uView === 'table' ? _uTableHTML(filtered) : _uGridHTML(filtered)}</div>
  </div>`;
}

function _uFilterSelect(kind, allLabel, opts, val) {
  const o = `<option value="">${esc(allLabel)}</option>` + opts.map(x => `<option value="${esc(x.v)}"${x.v === val ? ' selected' : ''}>${esc(x.l)}</option>`).join('');
  return `<select class="nx-select" style="width:auto" onchange="_uSetFilter('${kind}',this.value)">${o}</select>`;
}
function _uSetSearch(v) { _uSearch = v; _uRefreshBody(); }
function _uSetFilter(kind, v) { if (kind === 'floor') _uFloorFilter = v; else if (kind === 'type') _uTypeFilter = v; else _uStatusFilter = v; _uRefreshBody(); }
function _uSetView(v) { _uView = v; rUnits(); }
function _uRefreshBody() { const b = document.getElementById('u-body'); if (b) b.innerHTML = _uView === 'table' ? _uTableHTML(_uFiltered()) : _uGridHTML(_uFiltered()); }

// ── Grid: floor-grouped collapsible sections of compact cells ──────────────
function _uGridHTML(units) {
  if (!units.length) return `<div class="nx-card">${NX.empty({ icon: 'search', message: 'No units match these filters.' })}</div>`;
  const floors = _uFloors();
  const byFloor = {}; units.forEach(u => { (byFloor[u.floorId || '_none'] = byFloor[u.floorId || '_none'] || []).push(u); });
  const order = floors.filter(f => byFloor[f.id]).map(f => ({ id: f.id, name: f.name, units: byFloor[f.id] }));
  if (byFloor['_none']) order.push({ id: '_none', name: 'No floor', units: byFloor['_none'] });
  return order.map(sec => {
    const collapsed = !!_uCollapsed[sec.id];
    const cells = sec.units.slice().sort((a, b) => String(a.unitNo).localeCompare(String(b.unitNo), undefined, { numeric: true })).map(u => `
      <div class="nx-card nx-card--compact" style="cursor:pointer;display:flex;flex-direction:column;gap:6px" onclick="rUD('${u.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div style="font-weight:var(--fk-fw-semibold)">${esc(u.unitNo)}</div>${_uStatusChip(u)}
        </div>
        <div class="nx-kpi-label" style="text-transform:none">${esc(_uMeta(u))}</div>
        ${u.customerName ? `<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted)">${esc(u.customerName)}</div>` : ''}
      </div>`).join('');
    return `<div style="margin-bottom:var(--fk-sp-4)">
      <button class="nx-btn nx-btn--ghost" style="justify-content:flex-start;width:100%;font-weight:var(--fk-fw-semibold)" onclick="_uToggleFloor('${sec.id}')">
        ${NX.icon(collapsed ? 'chevron-right' : 'chevron-down', 14)} ${esc(sec.name)} <span class="nx-chip" style="margin-left:6px">${sec.units.length}</span>
      </button>
      ${collapsed ? '' : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">${cells}</div>`}
    </div>`;
  }).join('');
}
function _uToggleFloor(id) { _uCollapsed[id] = !_uCollapsed[id]; _uRefreshBody(); }
function _uArea(u) { return Number(u.area).toLocaleString('en-US') + ' ' + (u.areaUnit || 'sqft'); }
// Card meta line: type · area, but never an empty dash — fall back to area alone when
// type is missing (e.g. G-02 shows "2,700 sqft"), or "—" only when BOTH are absent.
function _uMeta(u) { return [u.type, u.area ? _uArea(u) : ''].filter(Boolean).join(' · ') || '—'; }

// Floor CODE for the {floor} token in unit naming — derived from the floor name,
// editable in the bulk generator + wizard. floors has no code column yet, so this
// is deterministic-at-generation (register item for a future sanctioned migration).
function _uFloorCode(name) {
  var n = String(name || '').trim(), low = n.toLowerCase();
  if (low === 'ground' || low === 'ground floor') return 'G';
  if (low === 'upper ground' || low === 'upper ground floor') return 'UG';
  if (low === 'lower ground' || low === 'lower ground floor') return 'LG';
  if (low === 'mezzanine') return 'M';
  if (low === 'penthouse') return 'PH';
  if (low === 'roof' || low === 'rooftop') return 'R';
  var bm = low.match(/^basement\s*(\d*)/); if (bm) return 'B' + (bm[1] || '');
  var num = n.match(/(\d+)/); if (num) return num[1];                 // "1st Floor" -> "1"
  return (n.split(/\s+/).map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 3)) || 'F';
}

// ── Table: one nx-table ────────────────────────────────────────────────────
function _uTableHTML(units) {
  if (!units.length) return `<div class="nx-card">${NX.empty({ icon: 'search', message: 'No units match these filters.' })}</div>`;
  const rows = units.slice().sort((a, b) => String(a.floorLabel).localeCompare(String(b.floorLabel)) || String(a.unitNo).localeCompare(String(b.unitNo), undefined, { numeric: true })).map(u => `
    <tr style="cursor:pointer" onclick="rUD('${u.id}')">
      <td>${esc(u.unitNo)}</td><td>${esc(u.floorLabel || '—')}</td><td>${esc(u.type || '—')}</td>
      <td class="num">${u.area ? esc(_uArea(u)) : '—'}</td><td>${_uStatusChip(u)}</td><td>${esc(u.customerName || '—')}</td></tr>`).join('');
  return `<div class="nx-card nx-card--flush"><table class="nx-table nx-table--flush">
    <thead><tr><th>Unit</th><th>Floor</th><th>Type</th><th class="num">Area</th><th>Status</th><th>Client</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   QUICK ADD — the 15-second path (unit_no + floor + type; rest defaults)
   ════════════════════════════════════════════════════════════════════════ */
function _uQuickAddBar() {
  const proj = _uDefaultProject();
  const floorOpts = _uFloors().map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  const typeOpts = _uTypes().map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  return `<div class="nx-card nx-card--compact" style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:flex-end">
    <div class="nx-field" style="margin:0;min-width:140px"><label class="nx-label">Unit no <span class="nx-req">*</span></label><input class="nx-input" id="qa-no" placeholder="e.g. 5-12"></div>
    <div class="nx-field" style="margin:0"><label class="nx-label">Floor</label><select class="nx-select" id="qa-floor">${floorOpts}</select></div>
    <div class="nx-field" style="margin:0"><label class="nx-label">Type</label><select class="nx-select" id="qa-type">${typeOpts}</select></div>
    ${NX.button('Add', { variant: 'primary', onclick: 'quickAddUnit()' })}
    ${NX.button('Cancel', { variant: 'ghost', onclick: '_uToggleQuickAdd()' })}
    <div id="qa-err" class="nx-error" style="flex-basis:100%"></div>
    ${proj ? '' : '<div class="nx-error" style="flex-basis:100%">No project found — create a project first.</div>'}
  </div>`;
}
function _uToggleQuickAdd() {
  const el = document.getElementById('u-quickadd'); if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  if (show) { el.innerHTML = _uQuickAddBar(); setTimeout(() => document.getElementById('qa-no')?.focus(), 30); }
}
function _uDefaultProject() {
  const ps = window._projectsCache || [];
  return ps.length === 1 ? ps[0].id : (ps[0] ? ps[0].id : null);
}
function _uSellableStatusId() {
  // P0: default to a SELLABLE status (isAvailable true) so quick-added units appear in New Sale
  const s = _uStatuses().find(x => x.isAvailable);
  return s ? s.id : (_uStatuses()[0] ? _uStatuses()[0].id : null);
}
async function quickAddUnit() {
  if (typeof demoGuard === 'function' && demoGuard('Add Unit')) return;
  const no = (document.getElementById('qa-no')?.value || '').trim();
  const floorId = document.getElementById('qa-floor')?.value || '';
  const typeId = document.getElementById('qa-type')?.value || '';
  const err = document.getElementById('qa-err');
  if (!no) { if (err) err.textContent = 'Unit number is required'; return; }
  const projId = _uDefaultProject();
  if (!projId) { if (err) err.textContent = 'No project found — create a project first.'; return; }
  const floorObj = _uFloors().find(f => f.id === floorId);
  const payload = {
    company_id: S.cid, project_id: projId, unit_no: no,
    unit_type_id: typeId || null,
    status_id: _uSellableStatusId(),                       // sellable default (P0)
    floor_id: floorId || null,                             // §11 FK fix
    floor_no: floorObj ? (floorObj.sortOrder ?? null) : null,
    floor_label: floorObj ? floorObj.name : null,
    area_unit: 'sqft', parking_count: 0, base_price: 0, features: [],
    created_by: S.userId || null
  };
  try {
    const { data, error } = await supabase.rpc('create_unit', { p_data: payload });
    if (error) throw error;
    if (!data?.success) { if (err) err.textContent = data?.message || data?.error || 'Save failed'; return; }
    await loadUnitsCache(S.cid);
    if (typeof logA === 'function') logA('unit', 'Quick-added unit: ' + no);
    toast('Unit ' + no + ' added', 'ok');
    rUnits(); _uToggleQuickAdd();
    document.getElementById('u-quickadd').style.display = '';
    document.getElementById('u-quickadd').innerHTML = _uQuickAddBar();
    setTimeout(() => document.getElementById('qa-no')?.focus(), 30);
  } catch (e) { if (err) err.textContent = 'Could not add unit: ' + (e.message || e); }
}

/* ════════════════════════════════════════════════════════════════════════
   FULL FORM — ONE consolidated nx-modal (≤10 visible + "More")
   ════════════════════════════════════════════════════════════════════════ */
function openUnitModal(unitId) {
  const u = unitId ? _uUnits().find(x => x.id === unitId) : null;
  const projOpts = (window._projectsCache || []).map(p => `<option value="${esc(p.id)}"${u && u.projectId === p.id ? ' selected' : ''}>${esc(p.name || p.projectName || 'Project')}</option>`).join('');
  const floorOpts = '<option value="">— No floor —</option>' + _uFloors().map(f => `<option value="${esc(f.id)}"${u && u.floorId === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  const typeOpts = '<option value="">— Type —</option>' + _uTypes().map(t => `<option value="${esc(t.id)}"${u && u.unitTypeId === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  const statusOpts = _uStatuses().map(s => `<option value="${esc(s.id)}"${u ? (u.statusId === s.id ? ' selected' : '') : (s.isAvailable ? ' selected' : '')}>${esc(s.name)}</option>`).join('');
  const fld = (label, inner, req) => `<div class="nx-field" style="margin:0"><label class="nx-label">${esc(label)}${req ? ' <span class="nx-req">*</span>' : ''}</label>${inner}</div>`;
  const body = `
    <input type="hidden" id="uf-uid" value="${u ? esc(u.id) : ''}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">
      ${fld('Unit no', `<input class="nx-input" id="uf-no" value="${u ? esc(u.unitNo) : ''}">`, true)}
      ${fld('Project', `<select class="nx-select" id="uf-project">${projOpts}</select>`, true)}
      ${fld('Floor', `<select class="nx-select" id="uf-floor">${floorOpts}</select>`)}
      ${fld('Type', `<select class="nx-select" id="uf-type">${typeOpts}</select>`)}
      ${fld('Status', `<select class="nx-select" id="uf-status">${statusOpts}</select>`)}
      ${fld('Area', `<input class="nx-input" id="uf-area" type="number" value="${u && u.area ? u.area : ''}">`)}
      ${fld('Base price', `<input class="nx-input" id="uf-price" type="number" value="${u && u.basePrice ? u.basePrice : ''}">`)}
      ${fld('Block', `<input class="nx-input" id="uf-block" value="${u ? esc(u.block || '') : ''}">`)}
    </div>
    <div style="margin-top:var(--fk-sp-3)">
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="_uToggleMore()" id="uf-more-btn">${NX.icon('chevron-down', 14)} More fields</button>
      <div id="uf-more" style="display:none;margin-top:var(--fk-sp-3);display:none;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">
        ${fld('Bedrooms', `<input class="nx-input" id="uf-bedrooms" type="number" value="${u && u.bedrooms ? u.bedrooms : ''}">`)}
        ${fld('Bathrooms', `<input class="nx-input" id="uf-bathrooms" type="number" value="${u && u.bathrooms ? u.bathrooms : ''}">`)}
        ${fld('Parking', `<input class="nx-input" id="uf-parking" type="number" value="${u ? (u.parkingCount || 0) : 0}">`)}
        ${fld('Facing', `<input class="nx-input" id="uf-facing" value="${u ? esc(u.facing || '') : ''}">`)}
        ${fld('Notes', `<input class="nx-input" id="uf-notes" value="">`)}
        <input type="hidden" id="uf-area-unit" value="sqft">
      </div>
    </div>`;
  const footer = NX.button('Cancel', { variant: 'ghost', onclick: '_uCloseModal()' }) +
    NX.button(u ? 'Save changes' : 'Add unit', { variant: 'primary', onclick: 'saveUnitForm()', attrs: 'id="unit-save-btn"' });
  _uCloseModal();
  document.body.insertAdjacentHTML('beforeend', `<div id="u-modal-host" class="nx">` + NX.modal({ title: u ? 'Edit unit' : 'Add unit', size: 'm', body, footer, onClose: '_uCloseModal()' }) + `</div>`);
  setTimeout(() => document.getElementById('uf-no')?.focus(), 30);
}
function _uCloseModal() { const h = document.getElementById('u-modal-host'); if (h) h.remove(); }
function _uToggleMore() {
  const m = document.getElementById('uf-more'); const b = document.getElementById('uf-more-btn'); if (!m) return;
  const show = m.style.display === 'none';
  m.style.display = show ? 'grid' : 'none';
  if (b) b.innerHTML = NX.icon(show ? 'chevron-up' : 'chevron-down', 14) + ' ' + (show ? 'Fewer fields' : 'More fields');
}

async function saveUnitForm() {
  if (typeof demoGuard === 'function' && demoGuard('Save Unit')) return;
  const unitNo = (document.getElementById('uf-no')?.value || '').trim();
  const projId = document.getElementById('uf-project')?.value || '';
  if (!unitNo || !projId) { toast(!unitNo ? 'Unit number is required' : 'Project is required', 'err'); return; }
  const existingId = (document.getElementById('uf-uid')?.value || '').trim();
  const btn = document.getElementById('unit-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const floorId = document.getElementById('uf-floor')?.value || '';
    const floorObj = _uFloors().find(f => f.id === floorId);
    const payload = {
      company_id: S.cid, project_id: projId, unit_no: unitNo,
      unit_type_id: document.getElementById('uf-type')?.value || null,
      status_id: document.getElementById('uf-status')?.value || null,
      floor_id: floorId || null,                            // §11 FK fix
      floor_no: floorObj ? (floorObj.sortOrder ?? null) : null,
      floor_label: floorObj ? floorObj.name : null,
      block: (document.getElementById('uf-block')?.value || '').trim() || null,
      area: parseFloat(document.getElementById('uf-area')?.value) || null,
      area_unit: document.getElementById('uf-area-unit')?.value || 'sqft',
      bedrooms: parseInt(document.getElementById('uf-bedrooms')?.value) || null,
      bathrooms: parseInt(document.getElementById('uf-bathrooms')?.value) || null,
      parking_count: parseInt(document.getElementById('uf-parking')?.value) || 0,
      facing: document.getElementById('uf-facing')?.value || null,
      base_price: parseFloat(document.getElementById('uf-price')?.value) || 0,
      features: [], notes: (document.getElementById('uf-notes')?.value || '').trim() || null
    };
    let result;
    if (existingId) {
      const { data, error } = await supabase.rpc('update_unit', { p_id: existingId, p_company_id: S.cid, p_data: payload });
      if (error) throw error; result = data;
    } else {
      payload.created_by = S.userId || null;
      const { data, error } = await supabase.rpc('create_unit', { p_data: payload });   // create_unit writes floor_id
      if (error) throw error; result = data;
    }
    if (!result?.success) { toast(result?.message || result?.error || 'Save failed', 'err'); return; }
    await loadUnitsCache(S.cid);
    if (typeof logA === 'function') logA('unit', (existingId ? 'Updated' : 'Added') + ' unit: ' + unitNo);
    toast(existingId ? 'Unit updated' : 'Unit added', 'ok');
    _uCloseModal(); rUnits();
  } catch (err) { console.error('[saveUnitForm]', err); toast('Could not save unit: ' + (err.message || err), 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = existingId ? 'Save changes' : 'Add unit'; } }
}

/* ════════════════════════════════════════════════════════════════════════
   BULK GENERATE — floors × units/floor → {floor}-{NN} → preview → batch
   ════════════════════════════════════════════════════════════════════════ */
let _bgRows = [];
function openBulkGen() {
  const floors = _uFloors();
  const floorChecks = floors.map(f => `<div style="display:flex;align-items:center;gap:8px;font-size:var(--fk-fs-body)">
    <input type="checkbox" class="bg-floor" value="${esc(f.id)}" checked data-name="${esc(f.name)}" data-no="${f.sortOrder ?? ''}">
    <span style="flex:1">${esc(f.name)}</span>
    <input class="nx-input bg-code" data-id="${esc(f.id)}" value="${esc(f.floorCode || _uFloorCode(f.name))}" title="Code used in {floor} unit naming (saved to the floor)" oninput="buildBulkPreview()" style="width:60px;height:28px;padding:0 8px">
  </div>`).join('');
  const typeOpts = '<option value="">— No type —</option>' + _uTypes().map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-4)">
      <div>
        <div class="nx-label" style="margin-bottom:var(--fk-sp-2)">Floors · code (used by {floor})</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto">${floorChecks || '<div class="nx-error">No floors — create floors first.</div>'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--fk-sp-3)">
        <div class="nx-field" style="margin:0"><label class="nx-label">Units per floor</label><input class="nx-input" id="bg-per" type="number" value="10" min="1" max="200"></div>
        <div class="nx-field" style="margin:0"><label class="nx-label">Naming pattern</label><input class="nx-input" id="bg-pattern" value="{floor}-{NN}"><div class="nx-kpi-label" style="text-transform:none">{floor}=floor no · {NN}=2-digit unit · {N}=plain</div></div>
        <div class="nx-field" style="margin:0"><label class="nx-label">Default type</label><select class="nx-select" id="bg-type" onchange="_bgFillTypeDefaults()">${typeOpts}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-2)">
          <div class="nx-field" style="margin:0"><label class="nx-label">Area (each)</label><input class="nx-input" id="bg-area" type="number" placeholder="optional"></div>
          <div class="nx-field" style="margin:0"><label class="nx-label">Price (each)</label><input class="nx-input" id="bg-price" type="number" placeholder="optional"></div>
        </div>
      </div>
    </div>
    <div style="margin-top:var(--fk-sp-3)">${NX.button('Build preview', { variant: 'secondary', onclick: 'buildBulkPreview()' })}</div>
    <div id="bg-preview" style="margin-top:var(--fk-sp-3)"></div>`;
  const footer = NX.button('Cancel', { variant: 'ghost', onclick: '_uCloseModal()' }) +
    NX.button('Generate units', { variant: 'primary', onclick: 'executeBulkGen()', attrs: 'id="bg-go" disabled' });
  _uCloseModal();
  document.body.insertAdjacentHTML('beforeend', `<div id="u-modal-host" class="nx">` + NX.modal({ title: 'Bulk generate units', size: 'l', body, footer, onClose: '_uCloseModal()' }) + `</div>`);
}
function _bgPad(n, pattern) {
  return pattern.replace(/\{floor\}/g, n.code).replace(/\{NN\}/g, String(n.i).padStart(2, '0')).replace(/\{N\}/g, String(n.i));
}
// Pre-fill area/price from the selected type's persisted defaults (#16). Only
// fills empty inputs so a manual override the user already typed is preserved.
function _bgFillTypeDefaults() {
  const t = _uTypes().find(x => x.id === (document.getElementById('bg-type')?.value || ''));
  if (!t) return;
  const a = document.getElementById('bg-area'), p = document.getElementById('bg-price');
  if (a && !a.value && t.defaultArea != null) a.value = t.defaultArea;
  if (p && !p.value && t.defaultPrice != null) p.value = t.defaultPrice;
  buildBulkPreview();
}
function buildBulkPreview() {
  const floors = [...document.querySelectorAll('.bg-floor:checked')].map(c => {
    const codeEl = document.querySelector('.bg-code[data-id="' + c.value + '"]');
    return { id: c.value, name: c.dataset.name, floorNo: c.dataset.no || '', code: (codeEl && codeEl.value.trim()) || _uFloorCode(c.dataset.name) };
  });
  const per = parseInt(document.getElementById('bg-per')?.value) || 0;
  const pattern = (document.getElementById('bg-pattern')?.value || '{floor}-{NN}').trim();
  const typeId = document.getElementById('bg-type')?.value || '';
  const typeName = (_uTypes().find(t => t.id === typeId) || {}).name || '';
  const area = parseFloat(document.getElementById('bg-area')?.value) || null;
  const price = parseFloat(document.getElementById('bg-price')?.value) || null;
  const host = document.getElementById('bg-preview'); const go = document.getElementById('bg-go');
  if (!floors.length || per < 1) { if (host) host.innerHTML = `<div class="nx-error">Pick at least one floor and units/floor ≥ 1.</div>`; if (go) go.disabled = true; return; }
  _bgRows = [];
  floors.forEach(f => { for (let i = 1; i <= per; i++) _bgRows.push({ unit_no: _bgPad({ code: f.code, i }, pattern), floor_id: f.id, floor_no: f.floorNo || null, floor_label: f.name, unit_type_id: typeId || null, area, base_price: price, _typeName: typeName }); });
  const rowsHtml = _bgRows.slice(0, 500).map(r => `<tr><td>${esc(r.unit_no)}</td><td>${esc(r.floor_label)}</td><td>${esc(r._typeName || '—')}</td><td class="num">${r.area ? Number(r.area).toLocaleString('en-US') : '—'}</td><td class="num">${r.base_price ? fM(r.base_price) : '—'}</td></tr>`).join('');
  if (host) host.innerHTML = `<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-2)">Preview — <b>${_bgRows.length}</b> units will be created</div>
    <div class="nx-card nx-card--flush" style="max-height:300px;overflow:auto"><table class="nx-table nx-table--flush">
    <thead><tr><th>Unit no</th><th>Floor</th><th>Type</th><th class="num">Area</th><th class="num">Price</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  if (go) go.disabled = false;
}
async function executeBulkGen() {
  if (typeof demoGuard === 'function' && demoGuard('Bulk Generate')) return;
  if (!_bgRows.length) { toast('Build the preview first', 'warn'); return; }
  const projId = _uDefaultProject();
  if (!projId) { toast('No project found — create a project first.', 'err'); return; }
  const statusId = _uSellableStatusId();
  const rows = _bgRows.map(r => ({ unit_no: r.unit_no, floor_id: r.floor_id, floor_no: r.floor_no, floor_label: r.floor_label, unit_type_id: r.unit_type_id, status_id: statusId, area: r.area, base_price: r.base_price, area_unit: 'sqft', created_by: S.userId || null }));
  // Persist any floor codes the user set/edited so {floor} naming reads the column next time.
  const codeEdits = [...document.querySelectorAll('.bg-code')].map(el => {
    const f = _uFloors().find(x => x.id === el.dataset.id);
    const code = (el.value || '').trim();
    return (f && code && code !== (f.floorCode || '')) ? { id: el.dataset.id, code } : null;
  }).filter(Boolean);
  const go = document.getElementById('bg-go'); if (go) { go.disabled = true; go.textContent = 'Generating…'; }
  try {
    if (codeEdits.length) {
      await Promise.all(codeEdits.map(e => supabase.rpc('upsert_floor', { p_company_id: S.cid, p_data: { floor_code: e.code }, p_id: e.id })));
      if (typeof loadFloorsCache === 'function') { try { await loadFloorsCache(S.cid); } catch (_) {} }
    }
    const { data, error } = await supabase.rpc('bulk_create_units', { p_company_id: S.cid, p_project_id: projId, p_units: rows });
    if (error) throw error;
    if (data?.inserted > 0) { await loadUnitsCache(S.cid); if (typeof logA === 'function') logA('unit', `Bulk generated ${data.inserted} units`); }
    toast(`${data.inserted || 0} units generated${data.errors ? ' · ' + data.errors + ' failed' : ''}`, data.errors ? 'warn' : 'ok');
    if (!data.errors) { _uCloseModal(); rUnits(); }
  } catch (e) { toast('Bulk generate failed: ' + (e.message || e), 'err'); }
  finally { if (go) { go.disabled = false; go.textContent = 'Generate units'; } }
}

/* ════════════════════════════════════════════════════════════════════════
   rUD — unit detail panel  (NOTE: _uid is a GLOBAL from js/data.js — do not re-declare)
   ════════════════════════════════════════════════════════════════════════ */
function rUD(unitId) {
  _uid = unitId;
  const pg = document.getElementById('pg-unitdetail') || document.getElementById('pg-units');
  const u = _uUnits().find(x => x.id === unitId);
  if (!pg) return;
  if (!u) { pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">${NX.banner('Unit not found.', 'danger')}</div>`; return; }
  const info = (l, v) => `<div><div class="nx-kpi-label">${esc(l)}</div><div style="font-size:var(--fk-fs-body)">${v}</div></div>`;
  const target = document.getElementById('pg-unitdetail') ? 'pg-unitdetail' : 'pg-units';
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
  document.getElementById(target).classList.add('on');
  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    <div class="nx-page-header">
      <div><h1 class="nx-page-title">Unit ${esc(u.unitNo)}</h1><div class="nx-kpi-label" style="margin-top:4px">${esc(u.floorLabel || '')}${u.type ? ' · ' + esc(u.type) : ''}</div></div>
      <div class="nx-page-actions">
        ${NX.button('Back', { variant: 'ghost', size: 'sm', onclick: "nav('units')" })}
        ${NX.button('Edit', { variant: 'secondary', size: 'sm', icon: 'plus', onclick: `openUnitModal('${u.id}')` })}
      </div>
    </div>
    <div class="nx-card">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--fk-sp-4)">
        ${info('Status', _uStatusChip(u))}
        ${info('Area', u.area ? esc(_uArea(u)) : '—')}
        ${info('Base price', u.basePrice ? fM(u.basePrice) : '—')}
        ${info('Block', esc(u.block || '—'))}
      </div>
    </div>
    ${u.saleId ? `<div class="nx-card">
      <div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">Current sale</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--fk-sp-4)">
        ${info('Client', esc(u.customerName || '—'))}
        ${info('Deal value', u.totalPrice ? fM(u.totalPrice) : '—')}
        ${info('Paid', u.totalPaid ? fM(u.totalPaid) : '—')}
        ${info('Outstanding', fM(u.pendingAmount))}
      </div>
      <div style="margin-top:var(--fk-sp-3)">
        <a class="nx-btn nx-btn--secondary nx-btn--sm" onclick="nav('reports'); if(typeof openRptViewer==='function') setTimeout(function(){openRptViewer('unit_statement');},300)">View Unit Statement</a>
      </div>
    </div>` : `<div class="nx-card">${NX.empty({ icon: 'inbox', message: 'This unit is not sold yet.', action: NX.button('Create sale', { variant: 'primary', onclick: "nav('newsale')" }) })}</div>`}
  </div>`;
}
