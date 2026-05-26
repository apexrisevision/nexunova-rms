// ══ RECOVERY CAMPAIGNS (Module 1.2) ═══════════════════════════════
// Create + manage recovery drives: assign clients, track collection vs
// target, see officer performance, calls and promises within the window.
// Backend: supabase/migrations/20260525_module1_2_recovery_campaigns.sql
// RPCs: list_campaigns, get_campaign_detail, create_campaign,
//       update_campaign, delete_campaign, close_campaign,
//       assign_clients_to_campaign, remove_client_from_campaign.

let _camList         = [];
let _camFilter       = 'active';   // 'active' | 'closed' | 'all'
let _camCurId        = null;       // when set, render detail view
let _camDetail       = null;
let _camClientsCache = null;       // list_clients_lookup result
let _camAssignSel    = new Set();
let _camAssignSearch = '';

// ─── Entry point (router calls rCampaigns) ────────────────────────
async function rCampaigns() {
  const pg = document.getElementById('pg-campaigns');
  if (!pg) return;
  if (_camCurId) { await _camRenderDetail(pg); return; }

  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Recovery Campaigns</h2>
        <p>Run targeted recovery drives — assign clients, track collection vs target, see officer performance.</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm"  onclick="_camOpenCreate()">+ New Campaign</button>
        <button class="btn btn-gh btn-sm" onclick="_camLoad()">↺ Refresh</button>
      </div>
    </div>

    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${['active','closed','all'].map(f => {
        const active = _camFilter === f;
        return `<button class="btn btn-xs" style="padding:5px 14px;border-radius:20px;border:1px solid ${active?'var(--brand)':'var(--line)'};background:${active?'var(--brand)':'transparent'};color:${active?'#fff':'var(--t2)'};font-weight:700;cursor:pointer" onclick="_camSetFilter('${f}')">${f[0].toUpperCase()+f.slice(1)}</button>`;
      }).join('')}
    </div>

    <div id="cam-list-body"><div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading campaigns…</div></div>
  </div>`;

  pg.insertAdjacentHTML('beforeend', _camCreateModalHTML());
  pg.insertAdjacentHTML('beforeend', _camAssignModalHTML());

  await _camLoad();
}

function _camSetFilter(f) { _camFilter = f; _camRenderList(); rCampaigns(); }

async function _camLoad() {
  const body = document.getElementById('cam-list-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading campaigns…</div>';
  try {
    const { data, error } = await supabase.rpc('list_campaigns', { p_company_id: S.cid });
    if (error) throw error;
    _camList = Array.isArray(data) ? data : [];
    _camRenderList();
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="et">Could not load campaigns</div>
      <div class="es">${esc(e.message || 'Error')}</div>
    </div></div>`;
  }
}

function _camRenderList() {
  const body = document.getElementById('cam-list-body');
  if (!body) return;
  let rows = _camList;
  if (_camFilter !== 'all') rows = rows.filter(c => c.status === _camFilter);

  if (!rows.length) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg></div>
      <div class="et">No ${_camFilter==='all'?'':_camFilter+' '}campaigns yet</div>
      <div class="es">Create a recovery drive to assign clients, track progress, and compare officer performance.</div>
      <button class="btn btn-g btn-sm" style="margin-top:12px" onclick="_camOpenCreate()">+ Create First Campaign</button>
    </div></div>`;
    return;
  }

  body.innerHTML = rows.map(c => _camCardHTML(c)).join('');
}

function _camCardHTML(c) {
  const pct       = Number(c.progress_pct || 0);
  const collected = Number(c.collected || 0);
  const target    = Number(c.target_amount || 0);
  const barColor  = pct >= 100 ? '#22c55e' : pct >= 60 ? '#3b82f6' : pct >= 30 ? '#f59e0b' : '#ef4444';
  const statusCfg = {
    active:    { bg:'rgba(34,197,94,.12)',  color:'#16a34a', lbl:'Active' },
    closed:    { bg:'rgba(59,130,246,.12)', color:'#2563eb', lbl:'Closed' },
    cancelled: { bg:'rgba(239,68,68,.12)',  color:'#dc2626', lbl:'Cancelled' }
  }[c.status] || { bg:'rgba(108,99,255,.12)', color:'var(--brand)', lbl: c.status };

  return `<div class="card" style="margin-bottom:12px;cursor:pointer" onclick="_camOpenDetail('${c.id}')">
    <div class="cb" style="padding:14px 16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="min-width:0;flex:1">
          <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:3px">${esc(c.name)}</div>
          <div style="font-size:11px;color:var(--t3)">${fD(c.start_date)} → ${fD(c.end_date)} · ${c.clients_count||0} clients</div>
          ${c.description ? `<div style="font-size:12px;color:var(--t2);margin-top:4px">${esc(c.description)}</div>` : ''}
        </div>
        <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:${statusCfg.bg};color:${statusCfg.color};white-space:nowrap">${statusCfg.lbl.toUpperCase()}</span>
      </div>

      <div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--t3);margin-bottom:6px">
        <span><b style="color:${barColor};font-size:13px">${pct}%</b> &nbsp;PKR ${fM(collected)} / ${fM(target)}</span>
      </div>
      <div style="height:7px;background:var(--line);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100,pct)}%;background:${barColor};border-radius:4px;transition:width .3s"></div>
      </div>
    </div>
  </div>`;
}

// ─── Detail view ─────────────────────────────────────────────────
function _camOpenDetail(id) {
  _camCurId = id;
  const pg = document.getElementById('pg-campaigns');
  if (pg) _camRenderDetail(pg);
}

function _camBackToList() {
  _camCurId  = null;
  _camDetail = null;
  rCampaigns();
}

async function _camRenderDetail(pg) {
  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l"><button class="btn btn-gh btn-sm" onclick="_camBackToList()">← Campaigns</button></div>
    </div>
    <div id="cam-det-body" style="margin-top:8px"><div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading campaign…</div></div>
  </div>`;
  pg.insertAdjacentHTML('beforeend', _camAssignModalHTML());

  try {
    const { data, error } = await supabase.rpc('get_campaign_detail', {
      p_id: _camCurId, p_company_id: S.cid
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _camDetail = data;
    _camRenderDetailBody();
  } catch(e) {
    const body = document.getElementById('cam-det-body');
    if (body) body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="et">Could not load campaign</div>
      <div class="es">${esc(e.message || 'Error')}</div>
    </div></div>`;
  }
}

function _camRenderDetailBody() {
  const body = document.getElementById('cam-det-body');
  if (!body || !_camDetail) return;
  const c        = _camDetail.campaign;
  const m        = _camDetail.metrics || {};
  const clients  = Array.isArray(_camDetail.clients) ? _camDetail.clients : [];
  const officers = Array.isArray(_camDetail.officer_performance) ? _camDetail.officer_performance : [];
  const pct      = Number(m.progress_pct || 0);
  const barColor = pct >= 100 ? '#22c55e' : pct >= 60 ? '#3b82f6' : pct >= 30 ? '#f59e0b' : '#ef4444';
  const isOpen   = c.status === 'active';
  const isA      = S.role === 'admin' || S.role === 'owner';

  const headerActions = isA ? `
    ${isOpen ? `<button class="btn btn-g btn-sm" onclick="_camOpenAssign()">+ Assign Clients</button>` : ''}
    ${isOpen ? `<button class="btn btn-gh btn-sm" onclick="_camClose()">Close Campaign</button>` : ''}
    <button class="btn btn-gh btn-sm" style="color:#ef4444" onclick="_camDelete()">Delete</button>
  ` : '';

  body.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div style="min-width:0;flex:1">
        <h2 style="margin:0 0 4px;font-size:22px;font-weight:800">${esc(c.name)}</h2>
        <div style="font-size:12px;color:var(--t3)">${fD(c.start_date)} → ${fD(c.end_date)} · status: <b>${esc(c.status)}</b>${c.closed_at?` · closed ${fD(c.closed_at)}`:''}</div>
        ${c.description ? `<div style="font-size:13px;color:var(--t2);margin-top:6px">${esc(c.description)}</div>` : ''}
        ${c.outcome_summary ? `<div style="font-size:12px;color:var(--t2);margin-top:6px;padding:8px 10px;background:var(--canvas);border-radius:6px"><b>Outcome:</b> ${esc(c.outcome_summary)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${headerActions}</div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${_camMetricCard('Target',           'PKR '+fM(m.target_amount||0), 'var(--t1)')}
      ${_camMetricCard('Collected',        'PKR '+fM(m.collected||0),     barColor)}
      ${_camMetricCard('Progress',         pct+'%',                       barColor)}
      ${_camMetricCard('Clients Assigned', (m.clients_count||0)+'',       'var(--brand)')}
      ${_camMetricCard('Calls Made',       (m.calls_made||0)+'',          '#3b82f6')}
      ${_camMetricCard('Promises Kept',    (m.promises_kept||0)+' / '+(m.promises_total||0), '#22c55e')}
    </div>

    <div class="card" style="margin-bottom:14px"><div class="cb">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:6px">
        <span style="color:var(--t3)">Collected vs Target</span>
        <span style="color:${barColor};font-weight:800">${pct}%</span>
      </div>
      <div style="height:10px;background:var(--line);border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100,pct)}%;background:${barColor};border-radius:5px;transition:width .3s"></div>
      </div>
    </div></div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
      <div class="card">
        <div class="ch"><h3>Assigned Clients (${clients.length})</h3></div>
        <div class="cb" style="padding:0">${clients.length ? `
          <div class="tw"><table class="t" style="width:100%">
            <thead><tr><th>Client</th><th class="hide-sm">Phone</th><th class="r">Contributed</th>${isOpen&&isA?'<th style="width:1%"></th>':''}</tr></thead>
            <tbody>${clients.map(cl => `<tr>
              <td style="cursor:pointer" onclick="openClientDetail('${cl.client_id}')">
                <div style="font-weight:700;font-size:13px">${esc(cl.full_name||'—')}</div>
                <div style="font-size:10px;color:var(--t3);font-family:monospace">${esc(cl.client_code||'—')}</div>
              </td>
              <td class="hide-sm" style="font-size:12px;color:var(--t2)">${esc(cl.phone_primary||'—')}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:${Number(cl.contributed||0)>0?'var(--ok)':'var(--t3)'}">${Number(cl.contributed||0)>0?'PKR '+fM(cl.contributed):'—'}</td>
              ${isOpen&&isA?`<td><button class="btn btn-gh btn-xs" title="Remove from campaign" onclick="event.stopPropagation();_camRemoveClient('${cl.client_id}')">✕</button></td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>` : `<div class="empty" style="padding:24px">
            <div class="es">No clients assigned yet.</div>
            ${isOpen&&isA?`<button class="btn btn-g btn-sm" style="margin-top:8px" onclick="_camOpenAssign()">+ Assign Clients</button>`:''}
          </div>`}
        </div>
      </div>

      <div class="card">
        <div class="ch"><h3>Officer Performance</h3></div>
        <div class="cb" style="padding:0">${officers.length ? `
          <div class="tw"><table class="t" style="width:100%">
            <thead><tr><th>Officer</th><th class="r">Payments</th><th class="r">Collected</th><th class="r hide-sm">Calls</th></tr></thead>
            <tbody>${officers.map(o => `<tr>
              <td>
                <div style="font-weight:700;font-size:13px">${esc(o.officer_name||o.username||'—')}</div>
                <div style="font-size:10px;color:var(--t3);font-family:monospace">@${esc(o.username||'')}</div>
              </td>
              <td class="r" style="font-size:12px;font-weight:700">${o.payment_count||0}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:var(--ok)">PKR ${fM(o.amount_collected||0)}</td>
              <td class="r hide-sm" style="font-size:12px">${o.calls_made||0}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No officer activity in this window yet.</div></div>`}
        </div>
      </div>
    </div>
  `;
}

function _camMetricCard(label, value, color) {
  return `<div style="flex:1;min-width:130px;padding:12px 14px;border-radius:10px;background:var(--surface);border:1px solid var(--line);border-top:3px solid ${color}">
    <div style="font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.4px;text-transform:uppercase">${label}</div>
    <div style="font-size:18px;font-weight:800;color:${color};margin-top:3px">${value}</div>
  </div>`;
}

// ─── Create modal ────────────────────────────────────────────────
function _camCreateModalHTML() {
  const today = new Date().toISOString().slice(0,10);
  const end90 = new Date(Date.now() + 86400000*90).toISOString().slice(0,10);
  return `<div id="cam-create-modal" class="mo" style="display:none" onclick="if(event.target===this)_camCloseCreate()">
    <div class="mo-box" style="max-width:520px">
      <div class="mo-hd"><span>New Recovery Campaign</span><button class="mo-cl" onclick="_camCloseCreate()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Name *</label>
          <input id="cam-name" class="fi" placeholder="e.g. Q3 2026 Recovery Drive"></div>
        <div class="fg"><label class="fl">Description</label>
          <textarea id="cam-desc" class="fi" rows="2" placeholder="Optional context — purpose, scope, etc."></textarea></div>
        <div style="display:flex;gap:10px">
          <div class="fg" style="flex:1"><label class="fl">Start Date *</label>
            <input id="cam-start" type="date" class="fi" value="${today}"></div>
          <div class="fg" style="flex:1"><label class="fl">End Date *</label>
            <input id="cam-end" type="date" class="fi" value="${end90}"></div>
        </div>
        <div class="fg"><label class="fl">Target Amount (PKR)</label>
          <input id="cam-target" type="number" min="0" step="1000" class="fi" placeholder="0"></div>
        <div id="cam-create-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-gh btn-sm" onclick="_camCloseCreate()">Cancel</button>
        <button class="btn btn-g btn-sm"  id="cam-create-btn" onclick="_camSaveCreate()">Create Campaign</button>
      </div>
    </div>
  </div>`;
}

function _camOpenCreate() {
  const m = document.getElementById('cam-create-modal');
  if (!m) return;
  ['cam-name','cam-desc','cam-target'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const err = document.getElementById('cam-create-err'); if (err) err.textContent = '';
  m.style.display = 'flex';
}
function _camCloseCreate() { const m = document.getElementById('cam-create-modal'); if (m) m.style.display = 'none'; }

async function _camSaveCreate() {
  const name  = (document.getElementById('cam-name')   || {}).value?.trim() || '';
  const desc  = (document.getElementById('cam-desc')   || {}).value?.trim() || '';
  const start = (document.getElementById('cam-start')  || {}).value || '';
  const end   = (document.getElementById('cam-end')    || {}).value || '';
  const tgt   = Number((document.getElementById('cam-target') || {}).value) || 0;
  const err   = document.getElementById('cam-create-err');
  if (!name)         { if (err) err.textContent = 'Name is required'; return; }
  if (!start || !end){ if (err) err.textContent = 'Start and end dates are required'; return; }
  if (new Date(end) < new Date(start)) { if (err) err.textContent = 'End date must be on or after start date'; return; }

  const btn = document.getElementById('cam-create-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Creating…'; }
  try {
    const { data, error } = await supabase.rpc('create_campaign', {
      p_company_id: S.cid,
      p_data: { name, description: desc, target_amount: tgt, start_date: start, end_date: end, created_by: S.username || null }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _camCloseCreate();
    toast('Campaign created', 'ok');
    await _camLoad();
  } catch(e) {
    if (err) err.textContent = e.message || 'Failed';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Create Campaign'; }
  }
}

// ─── Assign-clients modal ────────────────────────────────────────
function _camAssignModalHTML() {
  return `<div id="cam-assign-modal" class="mo" style="display:none" onclick="if(event.target===this)_camCloseAssign()">
    <div class="mo-box" style="max-width:560px">
      <div class="mo-hd"><span>Assign Clients to Campaign</span><button class="mo-cl" onclick="_camCloseAssign()">✕</button></div>
      <div class="mo-bd">
        <input id="cam-assign-search" class="fi" placeholder="Search clients by name, code, or phone…" oninput="_camAssignFilter(this.value)" style="margin-bottom:8px">
        <div id="cam-assign-list" style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 0">
          <div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">⏳ Loading clients…</div>
        </div>
        <div style="font-size:11px;color:var(--t3);margin-top:8px"><span id="cam-assign-count">0</span> selected</div>
        <div id="cam-assign-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-gh btn-sm" onclick="_camCloseAssign()">Cancel</button>
        <button class="btn btn-g btn-sm"  id="cam-assign-btn" onclick="_camSaveAssign()">Assign Selected</button>
      </div>
    </div>
  </div>`;
}

async function _camOpenAssign() {
  const m = document.getElementById('cam-assign-modal');
  if (!m) return;
  _camAssignSel = new Set();
  _camAssignSearch = '';
  const s = document.getElementById('cam-assign-search'); if (s) s.value = '';
  const err = document.getElementById('cam-assign-err');  if (err) err.textContent = '';
  m.style.display = 'flex';
  await _camLoadClientLookup();
  _camRenderAssignList();
}
function _camCloseAssign() { const m = document.getElementById('cam-assign-modal'); if (m) m.style.display = 'none'; }

async function _camLoadClientLookup() {
  if (_camClientsCache && _camClientsCache.length) return;
  try {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _camClientsCache = Array.isArray(data) ? data : [];
  } catch(e) { _camClientsCache = []; }
}

function _camAssignFilter(q) { _camAssignSearch = (q || '').toLowerCase(); _camRenderAssignList(); }

function _camRenderAssignList() {
  const list = document.getElementById('cam-assign-list');
  if (!list) return;
  const assigned = new Set((_camDetail?.clients || []).map(x => x.client_id));
  let rows = (_camClientsCache || []).filter(c => !assigned.has(c.id));
  if (_camAssignSearch) {
    const q = _camAssignSearch;
    rows = rows.filter(c =>
      (c.full_name||'').toLowerCase().includes(q) ||
      (c.client_code||'').toLowerCase().includes(q) ||
      (c.phone_primary||'').toLowerCase().includes(q)
    );
  }
  if (!rows.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">No clients to assign</div>';
    return;
  }
  list.innerHTML = rows.map(c => {
    const sel = _camAssignSel.has(c.id);
    return `<label style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer;border-bottom:1px solid var(--line);background:${sel?'rgba(108,99,255,.06)':''}">
      <input type="checkbox" ${sel?'checked':''} onchange="_camAssignToggle('${c.id}', this.checked)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(c.full_name||'—')}</div>
        <div style="font-size:10px;color:var(--t3);font-family:monospace">${esc(c.client_code||'')}${c.phone_primary?' · '+esc(c.phone_primary):''}</div>
      </div>
    </label>`;
  }).join('');
  const ct = document.getElementById('cam-assign-count'); if (ct) ct.textContent = _camAssignSel.size;
}

function _camAssignToggle(id, checked) {
  if (checked) _camAssignSel.add(id); else _camAssignSel.delete(id);
  const ct = document.getElementById('cam-assign-count'); if (ct) ct.textContent = _camAssignSel.size;
}

async function _camSaveAssign() {
  const ids = Array.from(_camAssignSel);
  const err = document.getElementById('cam-assign-err');
  if (!ids.length) { if (err) err.textContent = 'Select at least one client.'; return; }
  const btn = document.getElementById('cam-assign-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Assigning…'; }
  try {
    const { data, error } = await supabase.rpc('assign_clients_to_campaign', {
      p_campaign_id: _camCurId,
      p_company_id:  S.cid,
      p_client_ids:  ids,
      p_assigned_by: S.username || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _camCloseAssign();
    toast((data.added_count || ids.length) + ' client(s) assigned', 'ok');
    await _camRenderDetail(document.getElementById('pg-campaigns'));
  } catch(e) {
    if (err) err.textContent = e.message || 'Failed';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Assign Selected'; }
  }
}

async function _camRemoveClient(clientId) {
  if (!confirm('Remove this client from the campaign? (Their payments remain unchanged.)')) return;
  try {
    const { data, error } = await supabase.rpc('remove_client_from_campaign', {
      p_campaign_id: _camCurId, p_client_id: clientId, p_company_id: S.cid
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Client removed', 'ok');
    await _camRenderDetail(document.getElementById('pg-campaigns'));
  } catch(e) {
    toast('Remove failed: ' + (e.message || ''), 'err');
  }
}

async function _camClose() {
  const note = prompt('Outcome summary (optional — what did this campaign achieve?):', '');
  if (note === null) return;
  try {
    const { data, error } = await supabase.rpc('close_campaign', {
      p_id: _camCurId, p_company_id: S.cid, p_outcome_summary: note || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Campaign closed', 'ok');
    await _camRenderDetail(document.getElementById('pg-campaigns'));
  } catch(e) {
    toast('Close failed: ' + (e.message || ''), 'err');
  }
}

async function _camDelete() {
  if (!confirm('Delete this campaign permanently? Client assignments will be removed (payments are NOT affected).')) return;
  try {
    const { data, error } = await supabase.rpc('delete_campaign', {
      p_id: _camCurId, p_company_id: S.cid
    });
    if (error) throw error;
    if (!data?.success) throw new Error('Failed');
    toast('Campaign deleted', 'ok');
    _camBackToList();
  } catch(e) {
    toast('Delete failed: ' + (e.message || ''), 'err');
  }
}
