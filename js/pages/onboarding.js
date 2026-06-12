// ══════════════════════════════════════════════════════════════════════════
// SETUP WIZARD — Phase 3C rebuild on the foundation kit (2026-06-12)
// First-run, data-first flow: Project → Floors → Types → Units → Done.
// Goal: fresh signup → fully structured project in < 10 min, no questions asked.
// The old onboarding's Branding/Users steps are dropped (audit flagged
// "branding before data" as friction); both remain in Admin → Company / Users.
// Resumable (per-company localStorage). Reachable from the nav slot + the Units
// empty-state CTA. Writes via existing RPCs: upsert_project, upsert_floor,
// upsert_unit_type, bulk_create_units (which now sets floor_id — §11 FK fix).
// Kit only: NX.* / .nx-* + --fk-* tokens. Public surface preserved: OB.show / OB.skip.
// ══════════════════════════════════════════════════════════════════════════
var OB = (function () {
  'use strict';
  var _step = 1, _cid = null;
  var _state = { projectName: '', projectId: null, typeDefaults: {}, floorCodes: {}, unitsPer: 10, defaultTypeId: '', generated: 0 };
  function _code(name) { return (_state.floorCodes && _state.floorCodes[name] != null) ? _state.floorCodes[name] : (typeof _uFloorCode === 'function' ? _uFloorCode(name) : String(name || '').charAt(0).toUpperCase()); }

  function _key() { return 'rms.wizard.' + (_cid || 'x'); }
  function _save() { try { localStorage.setItem(_key(), JSON.stringify({ step: _step, state: _state })); } catch (e) {} }
  function _restore() { try { var r = JSON.parse(localStorage.getItem(_key()) || 'null'); if (r) { _step = r.step || 1; _state = Object.assign(_state, r.state || {}); } } catch (e) {} }
  function _clear() { try { localStorage.removeItem(_key()); } catch (e) {} }

  function show(cid) {
    _cid = cid || (window.S && S.cid);
    _restore();
    if (!_state.projectId) { var ps = window._projectsCache || []; if (ps.length) { _state.projectId = ps[0].id; if (!_state.projectName) _state.projectName = ps[0].name || ps[0].projectName || ''; } }
    var scr = document.getElementById('s-onboarding'); if (scr) scr.classList.add('on');
    _render();
  }
  function skip() { close(); }
  function close() { var scr = document.getElementById('s-onboarding'); if (scr) { scr.classList.remove('on'); scr.innerHTML = ''; } }

  function _render() {
    var scr = document.getElementById('s-onboarding'); if (!scr) return;
    var steps = ['Project', 'Floors', 'Types', 'Units', 'Done'];
    var rail = steps.map(function (s, i) {
      var n = i + 1, on = n === _step, done = n < _step;
      return '<div style="display:flex;align-items:center;gap:8px">' +
        '<div class="num" style="width:24px;height:24px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:var(--fk-fs-label);font-weight:var(--fk-fw-semibold);' +
        (on ? 'background:var(--fk-primary);color:#fff' : done ? 'background:var(--fk-success-tint);color:var(--fk-success)' : 'background:var(--fk-bg-subtle);color:var(--fk-text-muted)') + '">' + (done ? '✓' : n) + '</div>' +
        '<span class="nx-kpi-label" style="text-transform:none;' + (on ? 'color:var(--fk-text)' : '') + '">' + s + '</span></div>';
    }).join('<div style="flex:1;height:1px;background:var(--fk-border);margin:0 8px"></div>');

    scr.innerHTML = '<div class="nx" style="max-width:760px;margin:40px auto;padding:0 var(--fk-sp-4);display:flex;flex-direction:column;gap:var(--fk-sp-4)">' +
      '<div class="nx-page-header"><h1 class="nx-page-title">Set up your project</h1>' +
      '<div class="nx-page-actions">' + NX.button('Skip for now', { variant: 'ghost', size: 'sm', onclick: 'OB.skip()' }) + '</div></div>' +
      '<div style="display:flex;align-items:center">' + rail + '</div>' +
      '<div class="nx-card" id="ob-step">' + _stepHTML() + '</div></div>';
    if (_step === 2) _floorPreview();   // build the floor+code list now that the inputs exist in the DOM
  }

  function _stepHTML() {
    if (_step === 1) return _s1();
    if (_step === 2) return _s2();
    if (_step === 3) return _s3();
    if (_step === 4) return _s4();
    return _s5();
  }
  function _nav(backLabel, nextLabel, nextFn) {
    return '<div class="nx-modal-footer" style="border:0;padding:var(--fk-sp-4) 0 0">' +
      (_step > 1 ? NX.button(backLabel || 'Back', { variant: 'ghost', onclick: 'OB._back()' }) : '') +
      NX.button(nextLabel || 'Continue', { variant: 'primary', onclick: nextFn || 'OB._next()' }) + '</div>';
  }

  // ── Step 1: Project ──
  function _s1() {
    return '<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">Step 1 · Project basics</div>' +
      '<div class="nx-field"><label class="nx-label">Project name <span class="nx-req">*</span></label>' +
      '<input class="nx-input" id="ob-pname" value="' + NX.esc(_state.projectName) + '" placeholder="e.g. Sapphire Heights"></div>' +
      '<div class="nx-field"><label class="nx-label">Location (optional)</label><input class="nx-input" id="ob-ploc" placeholder="City / area"></div>' +
      '<div class="nx-error" id="ob-err"></div>' + _nav(null, 'Continue', 'OB._saveProject()');
  }
  async function _saveProject() {
    var name = (document.getElementById('ob-pname') || {}).value || '';
    var loc = (document.getElementById('ob-ploc') || {}).value || '';
    var err = document.getElementById('ob-err');
    if (!name.trim()) { if (err) err.textContent = 'Project name is required'; return; }
    _state.projectName = name.trim();
    try {
      if (!_state.projectId) {
        var r = await supabase.rpc('upsert_project', { p_company_id: _cid, p_data: { project_name: _state.projectName, location: loc || null } });
        if (r.error) throw r.error;
        _state.projectId = (r.data && (r.data.id || (r.data.project && r.data.project.id))) || _state.projectId;
        if (typeof loadProjectsCache === 'function') await loadProjectsCache(_cid);
        if (!_state.projectId) { var ps = window._projectsCache || []; var m = ps.find(function (p) { return (p.name || p.projectName) === _state.projectName; }); if (m) _state.projectId = m.id; }
      }
      _step = 2; _save(); _render();
    } catch (e) { if (err) err.textContent = 'Could not save project: ' + (e.message || e); }
  }

  // ── Step 2: Floors (quick-generate) ──
  function _s2() {
    var existing = (window._floorsCache || []).length;
    return '<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">Step 2 · Floors</div>' +
      (existing ? '<div class="nx-banner nx-banner--info" style="margin-bottom:var(--fk-sp-3)">' + NX.icon('info', 16) + '<span>' + existing + ' floor' + (existing > 1 ? 's' : '') + ' already exist — generating adds only new ones.</span></div>' : '') +
      '<label style="display:flex;align-items:center;gap:8px;font-size:var(--fk-fs-body);margin-bottom:8px"><input type="checkbox" id="ob-fl-ground" checked onchange="OB._floorPreview()"> Ground floor</label>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:var(--fk-fs-body);margin-bottom:8px"><input type="checkbox" id="ob-fl-ug" onchange="OB._floorPreview()"> Upper Ground</label>' +
      '<div class="nx-field"><label class="nx-label">Numbered floors (1st, 2nd, …)</label><input class="nx-input" id="ob-fl-n" type="number" min="0" max="100" value="8" style="max-width:120px" oninput="OB._floorPreview()"></div>' +
      '<div id="ob-floor-list" style="margin-top:var(--fk-sp-2)">' + _floorListHTML() + '</div>' +
      '<div class="nx-error" id="ob-err"></div>' + _nav(null, 'Generate floors & continue', 'OB._genFloors()');
  }
  function _ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function _floorWant() {
    var ground = (document.getElementById('ob-fl-ground') || {}).checked;
    var ug = (document.getElementById('ob-fl-ug') || {}).checked;
    var n = parseInt((document.getElementById('ob-fl-n') || {}).value) || 0;
    var want = [], so = 0;
    if (ground) want.push({ name: 'Ground', sort: so++ });
    if (ug) want.push({ name: 'Upper Ground', sort: so++ });
    for (var i = 1; i <= n; i++) want.push({ name: _ordinal(i) + ' Floor', sort: so++ });
    return want;
  }
  function _floorListHTML() {
    var want = _floorWant();
    if (!want.length) return '<div class="nx-error">Pick at least one floor</div>';
    return '<table class="nx-table"><thead><tr><th>Floor</th><th>Code (used in unit naming)</th></tr></thead><tbody>' +
      want.map(function (f) { return '<tr><td>' + NX.esc(f.name) + '</td><td><input class="nx-input ob-fl-code" data-name="' + NX.esc(f.name) + '" value="' + NX.esc(_code(f.name)) + '" oninput="OB._codeEdit(this)" style="width:84px;height:30px"></td></tr>'; }).join('') +
      '</tbody></table>';
  }
  function _floorPreview() { var el = document.getElementById('ob-floor-list'); if (el) el.innerHTML = _floorListHTML(); }
  function _codeEdit(el) { _state.floorCodes[el.dataset.name] = (el.value || '').trim(); }
  async function _genFloors() {
    var err = document.getElementById('ob-err');
    var want = _floorWant();
    document.querySelectorAll('.ob-fl-code').forEach(function (el) { _state.floorCodes[el.dataset.name] = (el.value || '').trim() || _code(el.dataset.name); });
    if (!want.length) { if (err) err.textContent = 'Pick at least one floor'; return; }
    try {
      var existingNames = (window._floorsCache || []).map(function (f) { return String(f.name || '').toLowerCase(); });
      for (var j = 0; j < want.length; j++) {
        if (existingNames.indexOf(want[j].name.toLowerCase()) !== -1) continue;
        var r = await supabase.rpc('upsert_floor', { p_company_id: _cid, p_data: { name: want[j].name, sort_order: want[j].sort } });
        if (r.error) throw r.error;
      }
      if (typeof loadFloorsCache === 'function') await loadFloorsCache(_cid);
      _step = 3; _save(); _render();
    } catch (e) { if (err) err.textContent = 'Could not create floors: ' + (e.message || e); }
  }

  // ── Step 3: Types (seeded checklist + in-session area/price defaults) ──
  function _s3() {
    var types = (window._typesCache || []).filter(function (t) { return t.isActive !== false; });
    var rows = types.map(function (t) {
      var d = _state.typeDefaults[t.id] || {};
      return '<tr><td><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="ob-ty" value="' + NX.esc(t.id) + '" checked> ' + NX.esc(t.name) + '</label></td>' +
        '<td><input class="nx-input ob-ty-area" data-id="' + NX.esc(t.id) + '" type="number" placeholder="area" value="' + (d.area || '') + '" style="height:30px"></td>' +
        '<td><input class="nx-input ob-ty-price" data-id="' + NX.esc(t.id) + '" type="number" placeholder="price" value="' + (d.price || '') + '" style="height:30px"></td></tr>';
    }).join('');
    return '<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">Step 3 · Unit types &amp; default area / price</div>' +
      (types.length ? '<table class="nx-table"><thead><tr><th>Type</th><th>Default area</th><th>Default price</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<div class="nx-empty"><div class="nx-empty-msg">No types seeded. You can add them later in Types &amp; Floors.</div></div>') +
      '<div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-2)">Defaults are applied when you generate units next. (Per-type defaults aren’t stored on the type yet — tracked for a later release.)</div>' +
      '<div class="nx-error" id="ob-err"></div>' + _nav(null, 'Continue', 'OB._saveTypes()');
  }
  function _saveTypes() {
    _state.typeDefaults = {};
    document.querySelectorAll('.ob-ty-area').forEach(function (el) { var id = el.dataset.id; _state.typeDefaults[id] = _state.typeDefaults[id] || {}; _state.typeDefaults[id].area = parseFloat(el.value) || null; });
    document.querySelectorAll('.ob-ty-price').forEach(function (el) { var id = el.dataset.id; _state.typeDefaults[id] = _state.typeDefaults[id] || {}; _state.typeDefaults[id].price = parseFloat(el.value) || null; });
    var checked = [].map.call(document.querySelectorAll('.ob-ty:checked'), function (c) { return c.value; });
    _state.defaultTypeId = checked[0] || '';
    _step = 4; _save(); _render();
  }

  // ── Step 4: Units (bulk generate, or skip) ──
  function _s4() {
    var floors = _obFloorsSorted();
    var types = (window._typesCache || []).filter(function (t) { return t.isActive !== false; });
    var typeOpts = '<option value="">— No type —</option>' + types.map(function (t) { return '<option value="' + NX.esc(t.id) + '"' + (t.id === _state.defaultTypeId ? ' selected' : '') + '>' + NX.esc(t.name) + '</option>'; }).join('');
    return '<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">Step 4 · Generate units</div>' +
      '<div class="nx-kpi-label" style="text-transform:none;margin-bottom:var(--fk-sp-3)">' + floors.length + ' floors · pattern <b>{floor}-{NN}</b></div>' +
      '<div style="display:flex;gap:var(--fk-sp-3);flex-wrap:wrap;align-items:flex-end">' +
      '<div class="nx-field" style="margin:0"><label class="nx-label">Units per floor</label><input class="nx-input" id="ob-per" type="number" value="' + (_state.unitsPer || 10) + '" min="1" max="200" style="max-width:120px"></div>' +
      '<div class="nx-field" style="margin:0"><label class="nx-label">Type</label><select class="nx-select" id="ob-type">' + typeOpts + '</select></div>' +
      NX.button('Preview', { variant: 'secondary', onclick: 'OB._preview()' }) + '</div>' +
      '<div id="ob-preview" style="margin-top:var(--fk-sp-3)"></div>' +
      '<div class="nx-error" id="ob-err"></div>' +
      '<div class="nx-modal-footer" style="border:0;padding:var(--fk-sp-4) 0 0">' +
      NX.button('Back', { variant: 'ghost', onclick: 'OB._back()' }) +
      NX.button('Skip — I’ll add manually', { variant: 'secondary', onclick: 'OB._goto(5)' }) +
      NX.button('Generate & finish', { variant: 'primary', onclick: 'OB._genUnits()', attrs: 'id="ob-gen" disabled' }) + '</div>';
  }
  function _obFloorsSorted() { return (window._floorsCache || []).slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }); }
  function _buildUnits() {
    var per = parseInt((document.getElementById('ob-per') || {}).value) || 0;
    var typeId = (document.getElementById('ob-type') || {}).value || '';
    var d = _state.typeDefaults[typeId] || {};
    var rows = [];
    _obFloorsSorted().forEach(function (f) {
      for (var i = 1; i <= per; i++) rows.push({ unit_no: _code(f.name) + '-' + String(i).padStart(2, '0'), floor_id: f.id, floor_no: f.sortOrder != null ? f.sortOrder : null, floor_label: f.name, unit_type_id: typeId || null, area: d.area || null, base_price: d.price || null });
    });
    return rows;
  }
  function _preview() {
    var per = parseInt((document.getElementById('ob-per') || {}).value) || 0;
    var host = document.getElementById('ob-preview'); var gen = document.getElementById('ob-gen');
    if (per < 1) { if (host) host.innerHTML = '<div class="nx-error">Units per floor must be ≥ 1.</div>'; return; }
    _state.unitsPer = per;
    var rows = _buildUnits();
    var sample = rows.slice(0, 60).map(function (r) { return '<tr><td>' + NX.esc(r.unit_no) + '</td><td>' + NX.esc(r.floor_label) + '</td></tr>'; }).join('');
    if (host) host.innerHTML = '<div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-2)"><b>' + rows.length + '</b> units will be created</div>' +
      '<div class="nx-card nx-card--flush" style="max-height:220px;overflow:auto"><table class="nx-table nx-table--flush"><thead><tr><th>Unit no</th><th>Floor</th></tr></thead><tbody>' + sample + '</tbody></table></div>';
    if (gen) gen.disabled = false;
  }
  async function _genUnits() {
    var rows = _buildUnits();
    if (!rows.length) { var e0 = document.getElementById('ob-err'); if (e0) e0.textContent = 'Nothing to generate'; return; }
    var statusId = ((window._statusesCache || []).find(function (s) { return s.isAvailable; }) || {}).id || null;
    rows = rows.map(function (r) { return Object.assign({}, r, { status_id: statusId, area_unit: 'sqft', created_by: (window.S && S.userId) || null }); });
    var gen = document.getElementById('ob-gen'); if (gen) { gen.disabled = true; gen.textContent = 'Generating…'; }
    try {
      var r = await supabase.rpc('bulk_create_units', { p_company_id: _cid, p_project_id: _state.projectId, p_units: rows });
      if (r.error) throw r.error;
      _state.generated = (r.data && r.data.inserted) || 0;
      if (_state.generated > 0 && typeof loadUnitsCache === 'function') await loadUnitsCache(_cid);
      _step = 5; _save(); _render();
    } catch (e) { var el = document.getElementById('ob-err'); if (el) el.textContent = 'Generate failed: ' + (e.message || e); if (gen) { gen.disabled = false; gen.textContent = 'Generate & finish'; } }
  }

  // ── Step 5: Done ──
  function _s5() {
    var floors = (window._floorsCache || []).length, types = (window._typesCache || []).filter(function (t) { return t.isActive !== false; }).length, units = (window._unitsCache || []).length;
    return '<div class="nx-empty">' +
      '<div class="nx-empty-icon">' + NX.icon('check', 28) + '</div>' +
      '<div style="font-size:var(--fk-fs-title);font-weight:var(--fk-fw-semibold)">Your project is set up</div>' +
      '<div class="nx-empty-msg">' + NX.esc(_state.projectName || 'Project') + ' · ' + floors + ' floors · ' + types + ' types · ' + units + ' units' + (_state.generated ? ' (' + _state.generated + ' just generated)' : '') + '</div>' +
      '<div style="display:flex;gap:var(--fk-sp-2);margin-top:var(--fk-sp-2)">' +
      NX.button('Go to dashboard', { variant: 'primary', onclick: 'OB._finish()' }) +
      NX.button('View units', { variant: 'secondary', onclick: "OB._finish('units')" }) + '</div></div>';
  }
  function _finish(dest) {
    _clear(); close();
    try { supabase.rpc('mark_onboarding_complete', { p_company_id: _cid }).catch(function () {}); } catch (e) {}
    if (typeof nav === 'function') nav(dest || 'dashboard');
  }

  function _next() { _save(); }
  function _back() { if (_step > 1) { _step--; _save(); _render(); } }
  function _goto(n) { _step = n; _save(); _render(); }

  return {
    show: show, skip: skip, close: close,
    _saveProject: _saveProject, _floorPreview: _floorPreview, _codeEdit: _codeEdit, _genFloors: _genFloors, _saveTypes: _saveTypes,
    _preview: _preview, _genUnits: _genUnits, _finish: _finish, _next: _next, _back: _back, _goto: _goto
  };
})();
