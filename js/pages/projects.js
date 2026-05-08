// ══ PROJECTS MODULE ══════════════════════════════════════════
// Storage: localStorage only — gdb() / sdb()

let _prjS  = '';
let _prjId = null;

// ── List page ──────────────────────────────────────────────

function rProjects() {
  const cid = S?.cid;
  if (!cid) {
    document.getElementById('pg-projects').innerHTML =
      `<div class="card"><div class="empty"><div class="ei">⚠️</div><div class="et">No company selected</div></div></div>`;
    return;
  }
  const isA = S.role === 'admin';
  document.getElementById('pg-projects').innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><h2>Projects</h2><p id="prj-count"></p></div>
      <div class="ph-r">${isA ? `<button class="btn btn-g btn-sm" onclick="openProjectModal(null)">+ Add Project</button>` : ''}</div>
    </div>
    <div class="sbar">
      <span class="sbar-ic">🔍</span>
      <input class="sinp" id="prj-s" placeholder="Search name, location..." value="${esc(_prjS)}" oninput="setPrjS(this.value)">
    </div>
    <div id="prj-kpi" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px"></div>
    <div id="prj-ct"></div>
  </div>`;
  rPRJF();
}

function setPrjS(q) { _prjS = q; rPRJF(); }

function rPRJF() {
  const cid = S?.cid;
  if (!cid) return;
  const ct = document.getElementById('prj-ct');
  if (!ct) return;

  const db       = gdb();
  const allUnits = db.units?.[cid] || [];
  let   prjs     = (db.projects?.[cid] || []).map(p => ({...p}));

  if (_prjS) {
    const q = _prjS.toLowerCase();
    prjs = prjs.filter(p =>
      (p.name     || '').toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q)
    );
  }

  const countEl = document.getElementById('prj-count');
  if (countEl) countEl.textContent = prjs.length + (prjs.length === 1 ? ' project' : ' projects');

  // KPI summary
  const kpiEl = document.getElementById('prj-kpi');
  if (kpiEl) {
    const totalPortfolio = allUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
    const totalCollected = allUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
    const soldUnits      = allUnits.filter(u => u.status !== 'Available' && u.status !== 'Dead').length;
    kpiEl.innerHTML = [
      ['🏗️ Projects',    (db.projects?.[cid] || []).length,  ''],
      ['🏢 Units',        allUnits.length,                    ''],
      ['✅ Sold',         soldUnits,                          'color:var(--ok)'],
      ['💰 Portfolio',    fM(totalPortfolio),                 ''],
      ['📥 Collected',    fM(totalCollected),                 'color:var(--ok)'],
    ].map(([l, v, style]) =>
      `<div style="flex:1;min-width:120px;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--rm)">
         <div style="font-size:10px;color:var(--t3);margin-bottom:3px">${l}</div>
         <div style="font-size:15px;font-weight:700;${style}">${v}</div>
       </div>`
    ).join('');
  }

  if (!prjs.length) {
    ct.innerHTML = `<div class="card"><div class="empty"><div class="ei">🏗️</div><div class="et">No projects found</div>${S.role === 'admin' ? '<div class="es">Create your first project to organise units</div>' : ''}</div></div>`;
    return;
  }

  ct.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:13px">` +
    prjs.map(p => {
      const pUnits    = allUnits.filter(u => u.projectId === p.id);
      const sold      = pUnits.filter(u => u.status !== 'Available' && u.status !== 'Dead').length;
      const available = pUnits.filter(u => u.status === 'Available').length;
      const portfolio = pUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
      const collected = pUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
      const recovPct  = portfolio > 0 ? Math.min(100, Math.round(collected / portfolio * 100)) : 0;

      return `<div class="card" style="cursor:pointer;transition:transform .12s,box-shadow .12s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''" onclick="openProjectDetail('${p.id}')">
        <div class="cb">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px">
            <div>
              <div style="font-size:15px;font-weight:700;margin-bottom:3px">🏗️ ${esc(p.name)}</div>
              ${p.location ? `<div style="font-size:11px;color:var(--t3)">📍 ${esc(p.location)}</div>` : ''}
            </div>
            <span class="arr" style="font-size:18px;color:var(--t3);flex-shrink:0;margin-top:2px">›</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px">
            <div style="text-align:center;padding:8px 4px;background:var(--canvas);border-radius:var(--rm)">
              <div style="font-size:17px;font-weight:700;color:var(--t1)">${pUnits.length}</div>
              <div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Units</div>
            </div>
            <div style="text-align:center;padding:8px 4px;background:var(--canvas);border-radius:var(--rm)">
              <div style="font-size:17px;font-weight:700;color:var(--ok)">${sold}</div>
              <div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Sold</div>
            </div>
            <div style="text-align:center;padding:8px 4px;background:var(--canvas);border-radius:var(--rm)">
              <div style="font-size:17px;font-weight:700;color:var(--info)">${available}</div>
              <div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Avail.</div>
            </div>
          </div>

          ${portfolio > 0 ? `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-bottom:4px">
              <span>Recovery</span>
              <span style="font-weight:700;color:var(--t1)">${recovPct}%</span>
            </div>
            <div class="pbar" style="width:100%;height:5px;margin-bottom:6px"><div class="pbar-f" style="width:${recovPct}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3)">
              <span style="color:var(--ok)">${fM(collected)} collected</span>
              <span>${fM(portfolio)} total</span>
            </div>
          </div>` : `<div style="font-size:11px;color:var(--t3);font-style:italic">No financial data yet</div>`}
        </div>
      </div>`;
    }).join('') + `</div>`;
}

// ── Detail page ────────────────────────────────────────────

function openProjectDetail(id) { _prjId = id; nav('projectdetail'); }

function rProjectDetail() {
  const prjId = _prjId;
  if (!prjId) { nav('projects'); return; }
  const cid = S?.cid;
  if (!cid)   { nav('projects'); return; }

  const db  = gdb();
  const prj = (db.projects?.[cid] || []).find(p => p.id === prjId);
  if (!prj) { nav('projects'); return; }

  const isA       = S.role === 'admin';
  const allUnits  = db.units?.[cid] || [];
  const pUnits    = allUnits.filter(u => u.projectId === prjId);
  const sold      = pUnits.filter(u => u.status !== 'Available' && u.status !== 'Dead').length;
  const available = pUnits.filter(u => u.status === 'Available').length;
  const portfolio = pUnits.reduce((s, u) => s + Number(u.totalPrice || 0), 0);
  const collected = pUnits.reduce((s, u) => s + Number(u.totalPaid  || 0), 0);
  const outstanding = Math.max(0, portfolio - collected);
  const recovPct  = portfolio > 0 ? Math.min(100, Math.round(collected / portfolio * 100)) : 0;

  const row = (l, v) => `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>`;

  document.getElementById('pg-projectdetail').innerHTML = `<div class="ani">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px" class="no-p">
      <button class="bk" onclick="nav('projects')">← Back</button>
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="openProjectModal('${prjId}')">✏ Edit</button>` : ''}
      ${isA ? `<button class="btn btn-r btn-sm" onclick="deleteProjectConfirm('${prjId}')">🗑 Delete</button>` : ''}
    </div>

    <div class="card mb14">
      <div class="cb">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <h2 style="font-size:24px;font-weight:700;margin-bottom:5px">🏗️ ${esc(prj.name)}</h2>
            ${prj.location ? `<div style="font-size:12px;color:var(--t3)">📍 ${esc(prj.location)}</div>` : ''}
          </div>
        </div>

        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="font-size:11px;color:var(--t3)">Total Units<br><span style="font-size:15px;font-weight:700;color:var(--t1)">${pUnits.length}</span></div>
          <div style="font-size:11px;color:var(--t3)">Sold<br><span style="font-size:15px;font-weight:700;color:var(--ok)">${sold}</span></div>
          <div style="font-size:11px;color:var(--t3)">Available<br><span style="font-size:15px;font-weight:700;color:var(--info)">${available}</span></div>
          ${portfolio > 0 ? `
          <div style="font-size:11px;color:var(--t3)">Portfolio<br><span style="font-size:15px;font-weight:700;color:var(--t1)">PKR ${Number(portfolio).toLocaleString('en-PK')}</span></div>
          <div style="font-size:11px;color:var(--t3)">Collected<br><span style="font-size:15px;font-weight:700;color:var(--ok)">PKR ${Number(collected).toLocaleString('en-PK')}</span></div>
          <div style="font-size:11px;color:var(--t3)">Outstanding<br><span style="font-size:15px;font-weight:700;color:${outstanding > 0 ? 'var(--err)' : 'var(--ok)'}">PKR ${Number(outstanding).toLocaleString('en-PK')}</span></div>` : ''}
        </div>

        ${portfolio > 0 ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:5px">
            <span>Recovery Progress</span>
            <span style="font-weight:700;color:var(--t1)">${recovPct}%</span>
          </div>
          <div class="pbar" style="width:100%;height:8px"><div class="pbar-f" style="width:${recovPct}%"></div></div>
        </div>` : ''}
      </div>
    </div>

    <div class="cd">
      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><h3>🏗️ Project Info</h3></div>
          <div class="cb">
            ${row('Name',        esc(prj.name || '—'))}
            ${row('Location',    esc(prj.location || '—'))}
            ${prj.totalUnits ? row('Planned Units', prj.totalUnits) : ''}
            ${prj.startDate  ? row('Start Date',    fD(prj.startDate)) : ''}
            ${prj.description ? row('Description',  esc(prj.description)) : ''}
            ${prj.remarks     ? row('Remarks',       esc(prj.remarks)) : ''}
            ${row('Created', prj.createdAt ? fD(prj.createdAt.slice(0,10)) : '—')}
          </div>
        </div>

        <div class="card">
          <div class="ch"><h3>💰 Financial Summary</h3></div>
          <div class="cb">
            ${row('Total Portfolio', fMF(portfolio))}
            ${row('Total Collected', `<span style="color:var(--ok);font-weight:700">${fMF(collected)}</span>`)}
            ${row('Outstanding',     `<span style="color:${outstanding > 0 ? 'var(--err)' : 'var(--ok)'};font-weight:700">${outstanding > 0 ? fMF(outstanding) : '✅ Fully Collected'}</span>`)}
            ${portfolio > 0 ? row('Recovery %', `<strong>${recovPct}%</strong>`) : ''}
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:13px">
        <div class="card">
          <div class="ch"><div><h3>🏢 Units in Project</h3><p>${pUnits.length} unit${pUnits.length !== 1 ? 's' : ''} linked</p></div></div>
          ${!pUnits.length
            ? `<div class="empty"><div class="ei">🏢</div><div class="et">No units linked yet</div><div class="es">Open any unit → Edit → assign this project</div></div>`
            : `<div class="ul">` + pUnits.map(u => {
                const paid = actualPaid(u), rem = actualPending(u), p2 = pct(paid, u.totalPrice);
                return `<div class="ur" onclick="openUD('${u.id}')">
                  <div class="ur-no">${esc(u.unitNo || '—')}</div>
                  <div style="flex-shrink:0">${sbadge(u.status)}</div>
                  <div class="ur-meta">
                    <div class="ur-name">${u.customerName || '<span style="color:var(--t3)">Available</span>'}</div>
                    <div class="ur-sub">${esc(u.floorLabel || u.floor || '—')} · ${esc(u.type || '—')} · ${u.area || '—'} sqft</div>
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
      </div>
    </div>
  </div>`;
}

// ── Modal open/close ───────────────────────────────────────

function openProjectModal(prjId) {
  const isEdit = !!prjId;
  document.getElementById('prj-mtl').textContent = isEdit ? 'Edit Project' : 'Add Project';
  document.getElementById('pf-prj-id').value = prjId || '';

  ['pf-name','pf-location','pf-total-units','pf-desc','pf-start','pf-remarks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.querySelectorAll('#m-project .pf-err').forEach(el => el.textContent = '');

  if (isEdit) {
    const p = (gdb().projects?.[S.cid] || []).find(x => x.id === prjId);
    if (p) {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      set('pf-name',        p.name);
      set('pf-location',    p.location);
      set('pf-total-units', p.totalUnits || '');
      set('pf-desc',        p.description);
      set('pf-start',       p.startDate);
      set('pf-remarks',     p.remarks);
    }
  }

  om('m-project');
}

function closeProjectModal() { cm('m-project'); }

// ── Save ───────────────────────────────────────────────────

function saveProjectForm() {
  const name     = document.getElementById('pf-name')?.value?.trim();
  const location = document.getElementById('pf-location')?.value?.trim();

  let hasErr = false;
  const setErr = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    if (msg) hasErr = true;
  };

  setErr('e-pf-name',     !name     ? 'Project name is required' : name.length < 2 ? 'Min 2 characters' : '');
  setErr('e-pf-location', !location ? 'Location is required'     : '');

  if (hasErr) return;

  const cid        = S?.cid;
  const existingId = document.getElementById('pf-prj-id')?.value?.trim() || '';

  const db = gdb();
  db.projects      = db.projects || {};
  db.projects[cid] = db.projects[cid] || [];

  const totalUnitsVal = parseInt(document.getElementById('pf-total-units')?.value) || 0;

  const prjData = {
    id:          existingId || uid(),
    company_id:  cid,
    name,
    location,
    totalUnits:  totalUnitsVal || 0,
    description: document.getElementById('pf-desc')?.value?.trim()    || '',
    startDate:   document.getElementById('pf-start')?.value           || '',
    remarks:     document.getElementById('pf-remarks')?.value?.trim() || ''
  };

  const idx = db.projects[cid].findIndex(p => p.id === prjData.id);
  if (idx !== -1) {
    db.projects[cid][idx] = { ...db.projects[cid][idx], ...prjData };
  } else {
    prjData.createdAt = new Date().toISOString();
    db.projects[cid].push(prjData);
  }

  sdb(db);
  logA('project', (existingId ? 'Updated' : 'Added') + ' project: ' + name);
  toast(existingId ? 'Project updated!' : 'Project added!', 'ok');
  cm('m-project');
  rProjects();
}

// ── Delete ─────────────────────────────────────────────────

function deleteProjectConfirm(prjId) {
  const db  = gdb();
  const cid = S?.cid;
  const p   = (db.projects?.[cid] || []).find(x => x.id === prjId);

  const linkedCount = (db.units?.[cid] || []).filter(u => u.projectId === prjId).length;
  const warnMsg = linkedCount > 0
    ? `\n\n⚠ ${linkedCount} unit(s) linked to this project will be unlinked.`
    : '';

  if (!confirm(`Delete project "${p?.name || 'this project'}"? This cannot be undone.${warnMsg}`)) return;

  if (linkedCount > 0 && db.units?.[cid]) {
    db.units[cid] = db.units[cid].map(u => u.projectId === prjId ? { ...u, projectId: '' } : u);
  }

  if (db.projects?.[cid]) {
    db.projects[cid] = db.projects[cid].filter(x => x.id !== prjId);
  }

  sdb(db);
  logA('project', 'Deleted project: ' + (p?.name || prjId));
  toast('Project deleted', 'ok');
  nav('projects');
}
