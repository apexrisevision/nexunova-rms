// ── Unit Map — polygon editor (admin/owner only) ─────────────────────────────
//
// Draws unit outlines over a master floor drawing. Geometry belongs to the
// ARTWORK, so one drawing serves every floor that shares it; a shape is bound by
// slot_code ("10A") and each floor resolves that to its own unit ("UG-10A").
//
// Coordinates are normalised 0..1 against the drawing's natural size, never screen
// pixels — the artwork can be re-exported at any resolution and nothing moves.
// save_map_shape rejects anything outside that range, so a bug here fails loudly
// instead of storing a polygon that renders off the page.
//
// The slot dropdown is built from INVENTORY, not from the labels printed on the
// drawing. Artwork A prints "X10A" on both split clusters when the right-hand one
// is really 17A/B/C; because the list comes from the database, a wrong label on the
// drawing cannot put a polygon on the wrong unit.

let UM = {
  floors: [], plan: null, artId: null,
  slot: null,                 // slot currently being drawn / edited
  pts: [],                    // working polygon, normalised
  shapes: {},                 // slot_code → {points,label_x,label_y,zone_group}
  mode: 'idle',               // idle | draw | label
  hoverPt: null,
  dirty: false,
};
const UM_SNAP = 12;           // px on screen; corners closer than this fuse together

async function rUnitMap() {
  const el = document.getElementById('pg-unitmap');
  if (!el) return;
  el.innerHTML = `<div class="ph"><div><h2>Unit Map</h2><p>Draw each unit once on the master drawing — every floor that shares it follows.</p></div></div><div id="um-body">Loading…</div>`;
  const { data } = await supabase.rpc('get_map_editor_floors');
  if (!data || !data.success) {
    document.getElementById('um-body').innerHTML =
      `<div class="card" style="padding:18px">${data && data.error === 'forbidden'
        ? 'Only an owner or admin can draw the floor plan.' : 'Could not load the floor list.'}</div>`;
    return;
  }
  UM.floors = data.floors || [];
  _umFloorList();
}

function _umFloorList() {
  const rows = UM.floors.map(f => `
    <tr>
      <td><b>${esc(f.floor_label)}</b><div class="t3" style="font-size:12px">${esc(f.project_name || '')}</div></td>
      <td>${f.artwork_key ? 'Artwork ' + esc(f.artwork_key) : '<span class="t3">no drawing</span>'}</td>
      <td style="text-align:right">${f.drawn} / ${f.units}</td>
      <td>${_umStatusPill(f.status)}</td>
      <td style="text-align:right">${f.artwork_key
        ? `<button class="btn btn-sm btn-p" onclick="_umOpen('${f.id}')">Draw</button>`
        : '<span class="t3" style="font-size:12px">waiting for artwork</span>'}</td>
    </tr>`).join('');
  document.getElementById('um-body').innerHTML = `
    <div class="card" style="padding:0;overflow:auto">
      <table class="tbl" style="width:100%">
        <thead><tr><th>Floor</th><th>Drawing</th><th style="text-align:right">Drawn</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:18px">No floors registered yet.</td></tr>'}</tbody>
      </table>
    </div>`;
}
function _umStatusPill(s) {
  const m = { draft: ['Draft', '#d97706'], published: ['Published', '#059669'], coming_soon: ['Coming soon', '#6b7280'] }[s] || [s, '#6b7280'];
  return `<span style="font-size:12px;padding:2px 9px;border-radius:99px;background:${m[1]}1a;color:${m[1]}">${m[0]}</span>`;
}

async function _umOpen(planId) {
  const { data } = await supabase.rpc('get_map_editor_plan', { p_plan_id: planId });
  if (!data || !data.success) return notify.error('Could not open this floor');
  UM.plan = data; UM.artId = data.artwork && data.artwork.id;
  UM.shapes = {}; (data.shapes || []).forEach(s => { UM.shapes[s.slot_code] = s; });
  UM.slot = null; UM.pts = []; UM.mode = 'idle'; UM.dirty = false;
  _umRenderEditor();
}

function _umRenderEditor() {
  const p = UM.plan, a = p.artwork;
  const drawn = Object.keys(UM.shapes).length;
  const opts = (p.slots || []).map(s => {
    const done = !!UM.shapes[s.slot];
    return `<option value="${esc(s.slot)}"${UM.slot === s.slot ? ' selected' : ''}>${esc(s.slot)} — ${esc(s.unit_no)} (${esc(s.type)})${done ? ' ✓' : ''}</option>`;
  }).join('');
  document.getElementById('um-body').innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-sm btn-g" onclick="_umBack()">‹ All floors</button>
      <b>${esc(p.floor_label)}</b>
      <span class="t3">${esc(a.key)} · ${a.w}×${a.h}</span>
      <span id="um-count" style="margin-left:auto;font-size:13px">Drawn <b>${drawn}</b> of ${(p.slots || []).length}</span>
    </div>
    <div class="card" style="padding:12px 14px;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <label style="font-size:13px">Unit</label>
      <select id="um-slot" class="inp" style="min-width:260px" onchange="_umPickSlot(this.value)">
        <option value="">— pick a unit —</option>${opts}
      </select>
      <button class="btn btn-sm btn-p" id="um-draw" onclick="_umStartDraw()" disabled>Draw outline</button>
      <button class="btn btn-sm" id="um-label" onclick="_umStartLabel()" disabled>Move number</button>
      <button class="btn btn-sm btn-g" id="um-undo" onclick="_umUndo()" disabled>Undo point</button>
      <button class="btn btn-sm btn-d" id="um-del" onclick="_umDelete()" disabled>Delete</button>
      <span id="um-hint" class="t3" style="font-size:12px;margin-left:auto"></span>
    </div>
    <div class="card" style="padding:10px">
      <div id="um-stage" style="position:relative;display:inline-block;max-width:100%;line-height:0;cursor:crosshair">
        <img id="um-img" src="${esc(a.image_path)}" style="max-width:100%;height:auto;display:block" alt="">
        <svg id="um-svg" viewBox="0 0 1 1" preserveAspectRatio="none"
             style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"></svg>
      </div>
    </div>`;
  const img = document.getElementById('um-img');
  img.onload = () => _umPaint();
  if (img.complete) _umPaint();
  const stage = document.getElementById('um-stage');
  stage.addEventListener('click', _umClick);
  stage.addEventListener('mousemove', _umMove);
  stage.addEventListener('dblclick', _umClose);
  document.addEventListener('keydown', _umKey);
}
function _umBack() { document.removeEventListener('keydown', _umKey); rUnitMap(); }

// screen → normalised, using the IMAGE box (not the page)
function _umNorm(ev) {
  const r = document.getElementById('um-img').getBoundingClientRect();
  return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
          Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
}
// snap to any nearby corner already on the drawing, so neighbours share edges
// instead of leaving hairline gaps between units
function _umSnap(pt) {
  const r = document.getElementById('um-img').getBoundingClientRect();
  const tol = [UM_SNAP / r.width, UM_SNAP / r.height];
  let best = null, bd = Infinity;
  const consider = (q) => {
    const dx = Math.abs(q[0] - pt[0]), dy = Math.abs(q[1] - pt[1]);
    if (dx <= tol[0] && dy <= tol[1]) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = q; } }
  };
  Object.values(UM.shapes).forEach(s => (s.points || []).forEach(consider));
  UM.pts.forEach(consider);
  return best ? [best[0], best[1]] : pt;
}

function _umPickSlot(slot) {
  UM.slot = slot || null; UM.pts = []; UM.mode = 'idle';
  const has = !!(slot && UM.shapes[slot]);
  document.getElementById('um-draw').disabled = !slot;
  document.getElementById('um-label').disabled = !has;
  document.getElementById('um-del').disabled = !has;
  document.getElementById('um-draw').textContent = has ? 'Redraw outline' : 'Draw outline';
  _umHint(slot ? (has ? 'Already drawn. Redraw to replace it, or move its number.' : 'Press “Draw outline”, then click each corner.') : '');
  _umPaint();
}
function _umStartDraw() { UM.mode = 'draw'; UM.pts = []; _umHint('Click each corner. Double-click or Enter to close. Esc cancels.'); _umPaint(); }
function _umStartLabel() { UM.mode = 'label'; _umHint('Click where the unit number should sit.'); }
function _umHint(t) { const el = document.getElementById('um-hint'); if (el) el.textContent = t; }

function _umClick(ev) {
  if (!UM.slot) return;
  const pt = _umNorm(ev);
  if (UM.mode === 'draw') {
    UM.pts.push(_umSnap(pt));
    document.getElementById('um-undo').disabled = UM.pts.length === 0;
    _umPaint();
  } else if (UM.mode === 'label') {
    const s = UM.shapes[UM.slot]; if (!s) return;
    s.label_x = pt[0]; s.label_y = pt[1];
    UM.mode = 'idle';
    _umSave(s.points, s.label_x, s.label_y);
  }
}
function _umMove(ev) { if (UM.mode !== 'draw' || !UM.pts.length) return; UM.hoverPt = _umSnap(_umNorm(ev)); _umPaint(); }
function _umUndo() { if (UM.pts.length) { UM.pts.pop(); document.getElementById('um-undo').disabled = !UM.pts.length; _umPaint(); } }
function _umKey(e) {
  if (e.key === 'Escape') { UM.mode = 'idle'; UM.pts = []; _umHint('Cancelled.'); _umPaint(); }
  else if (e.key === 'Enter' && UM.mode === 'draw') { e.preventDefault(); _umClose(); }
  else if (e.key === 'Backspace' && UM.mode === 'draw') { e.preventDefault(); _umUndo(); }
}
function _umClose() {
  if (UM.mode !== 'draw') return;
  if (UM.pts.length < 3) return notify.error('A unit needs at least three corners');
  const prev = UM.shapes[UM.slot] || {};
  _umSave(UM.pts.slice(), prev.label_x, prev.label_y);
}

async function _umSave(points, lx, ly) {
  const zone = /^(10|17)[A-C]$/.test(UM.slot) ? UM.slot.slice(0, 2) : null;
  const { data } = await supabase.rpc('save_map_shape', {
    p_artwork_id: UM.artId, p_slot_code: UM.slot, p_points: points,
    p_label_x: (lx == null ? null : lx), p_label_y: (ly == null ? null : ly), p_zone_group: zone,
  });
  if (!data || !data.success) return notify.error(data && data.message || 'Could not save this outline');
  UM.shapes[UM.slot] = { slot_code: UM.slot, points, label_x: lx, label_y: ly, zone_group: zone };
  UM.mode = 'idle'; UM.pts = [];
  document.getElementById('um-undo').disabled = true;
  document.getElementById('um-label').disabled = false;
  document.getElementById('um-del').disabled = false;
  document.getElementById('um-count').innerHTML = `Drawn <b>${data.drawn}</b> of ${(UM.plan.slots || []).length}`;
  _umMarkDone(UM.slot);
  _umHint('Saved.');
  notify.success('Outline saved', { detail: UM.slot });
  _umPaint();
}
function _umMarkDone(slot) {
  const sel = document.getElementById('um-slot'); if (!sel) return;
  [...sel.options].forEach(o => { if (o.value === slot && !/✓$/.test(o.textContent)) o.textContent += ' ✓'; });
}
async function _umDelete() {
  if (!UM.slot || !UM.shapes[UM.slot]) return;
  const { data } = await supabase.rpc('delete_map_shape', { p_artwork_id: UM.artId, p_slot_code: UM.slot });
  if (!data || !data.success) return notify.error('Could not delete');
  delete UM.shapes[UM.slot];
  const sel = document.getElementById('um-slot');
  [...sel.options].forEach(o => { if (o.value === UM.slot) o.textContent = o.textContent.replace(/ ✓$/, ''); });
  document.getElementById('um-count').innerHTML = `Drawn <b>${Object.keys(UM.shapes).length}</b> of ${(UM.plan.slots || []).length}`;
  _umPickSlot(UM.slot);
  notify.success('Outline removed');
}

function _umPaint() {
  const svg = document.getElementById('um-svg'); if (!svg) return;
  const parts = [];
  Object.values(UM.shapes).forEach(s => {
    const active = s.slot_code === UM.slot;
    parts.push(`<polygon points="${s.points.map(p => p[0] + ',' + p[1]).join(' ')}"
      fill="${active ? 'rgba(37,99,235,.30)' : 'rgba(16,185,129,.20)'}"
      stroke="${active ? '#2563eb' : '#059669'}" stroke-width="0.0016" vector-effect="non-scaling-stroke"/>`);
    const lx = s.label_x != null ? s.label_x : _umCx(s.points)[0];
    const ly = s.label_y != null ? s.label_y : _umCx(s.points)[1];
    parts.push(`<text x="${lx}" y="${ly}" font-size="0.014" text-anchor="middle"
      fill="#0f172a" style="paint-order:stroke;stroke:#fff;stroke-width:0.004">${esc(s.slot_code)}</text>`);
  });
  if (UM.pts.length) {
    const live = UM.pts.concat(UM.mode === 'draw' && UM.hoverPt ? [UM.hoverPt] : []);
    parts.push(`<polyline points="${live.map(p => p[0] + ',' + p[1]).join(' ')}"
      fill="rgba(37,99,235,.18)" stroke="#2563eb" stroke-width="0.0016" vector-effect="non-scaling-stroke"/>`);
    UM.pts.forEach(p => parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="0.004" fill="#2563eb"/>`));
  }
  svg.innerHTML = parts.join('');
}
function _umCx(pts) {
  let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; });
  return [x / pts.length, y / pts.length];
}
