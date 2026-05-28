// ── Escalation Register ───────────────────────────────────────────────────────
// DX reference implementation (2026-05-27): list/toolbar/drawer rebuilt on the
// reusable Enterprise Data Experience layer (components.css .dx-* + helpers.js DX.*).
// All RPC contracts (list_escalations / get_escalation_analytics / create_escalation
// / update_escalation / list_clients_lookup) and both modals are preserved verbatim.

let _escData = null;

const ESC_LEVELS = { 1:'L1 – Officer', 2:'L2 – Manager', 3:'L3 – Director', 4:'L4 – CEO/Legal' };
const ESC_LVL_SHORT = { 1:'L1', 2:'L2', 3:'L3', 4:'L4' };

async function rEscalations() {
  const el = document.getElementById('pg-escalations');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Escalation Register</h2><p>Cases escalated to higher management for resolution</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_escLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-p btn-sm" onclick="_escOpenModal()">+ New Escalation</button>` : ''}
    </div>
  </div>

  <div id="esc-kpi" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:14px"></div>

  <div class="dx">
    <div class="dx-toolbar">
      <div class="dx-toolbar-l">
        <div class="dx-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="esc-q" type="search" placeholder="Search client, code or reason…" autocomplete="off">
        </div>
        <div class="dx-presets" id="esc-presets"></div>
      </div>
      <div class="dx-toolbar-r">
        <button class="dx-tool icon" id="esc-density" title="Row density" onclick="DX.density(document.getElementById('esc-wrap'), this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <button class="dx-tool icon" id="esc-cols" title="Columns" onclick="DX.columns(document.getElementById('esc-table'), this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>
        </button>
      </div>
    </div>
    <div id="esc-body"></div>
  </div>

  <!-- Modal -->
  <div id="esc-modal" class="mo" style="display:none" onclick="if(event.target===this)_escCloseModal()">
    <div class="mo-box" style="max-width:500px">
      <div class="mo-hd"><span id="esc-modal-title">New Escalation</span><button class="mo-cl" onclick="_escCloseModal()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Client *</label>
          <select id="esc-client_id" class="fi"><option value="">— Select client —</option></select></div>
        <div class="fg"><label class="fl">Escalated From Level *</label>
          <select id="esc-from_level" class="fi">
            <option value="1">L1 – Officer</option><option value="2">L2 – Manager</option>
            <option value="3">L3 – Director</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Escalated To Level *</label>
          <select id="esc-to_level" class="fi">
            <option value="2">L2 – Manager</option><option value="3">L3 – Director</option>
            <option value="4">L4 – CEO/Legal</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Reason *</label>
          <textarea id="esc-reason" class="fi" rows="3" placeholder="Why was this case escalated?"></textarea></div>
        <div id="esc-modal-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_escCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="esc-save-btn" onclick="_escSave()">Escalate</button>
      </div>
    </div>
  </div>

  <!-- Resolve Modal -->
  <div id="esc-resolve-modal" class="mo" style="display:none" onclick="if(event.target===this)document.getElementById('esc-resolve-modal').style.display='none'">
    <div class="mo-box" style="max-width:420px">
      <div class="mo-hd"><span>Resolve Escalation</span><button class="mo-cl" onclick="document.getElementById('esc-resolve-modal').style.display='none'">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Resolution Note *</label>
          <textarea id="esc-resolution_note" class="fi" rows="3" placeholder="How was this resolved?"></textarea></div>
        <div id="esc-resolve-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="document.getElementById('esc-resolve-modal').style.display='none'">Cancel</button>
        <button class="btn btn-p btn-sm" id="esc-resolve-btn" onclick="_escResolveConfirm()">Mark Resolved</button>
      </div>
    </div>
  </div>`;

  // Loading skeleton
  document.getElementById('esc-body').innerHTML =
    `<div class="dx-wrap" id="esc-wrap">${DX.skeleton(8, 6)}</div>`;

  await _escLoad();
  _escPopulateClients();
}

let _escCurFilter = 'open';
function _escFilter(f) {
  _escCurFilter = f;
  _escRender();
}

async function _escLoad() {
  const [{ data }, { data: an }] = await Promise.all([
    supabase.rpc('list_escalations', { p_company_id: S.cid }),
    supabase.rpc('get_escalation_analytics', { p_company_id: S.cid })
  ]);
  _escData = data || [];
  _escRenderKpi((an && an.success) ? an : null);
  _escRender();
}

function _escRenderKpi(an) {
  const el = document.getElementById('esc-kpi');
  if (!el) return;
  if (!an) { el.innerHTML = ''; return; }
  const cards = [
    { l:'Open',            v:an.open||0,            c:'var(--err)' },
    { l:'Resolved',        v:an.resolved||0,        c:'var(--ok)' },
    { l:'Resolution Rate', v:(an.resolution_rate||0)+'%', c:'#8b5cf6' },
    { l:'Avg Resolution',  v:(an.avg_resolution_days!=null?an.avg_resolution_days+'d':'—'), c:'var(--t2)' },
    { l:'Total',           v:an.total||0,           c:'var(--info)' },
  ];
  el.innerHTML = cards.map(k => `<div class="card" style="padding:12px 14px">
    <div style="font-size:18px;font-weight:800;color:${k.c}">${k.v}</div>
    <div style="font-size:10px;color:var(--t3);margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
  </div>`).join('');
}

/* Days a case has been open (or to resolution) */
function _escAge(r) {
  const start = r.created_at ? new Date(r.created_at) : null;
  if (!start) return 0;
  const end = (r.status === 'resolved' && r.resolved_at) ? new Date(r.resolved_at) : new Date();
  return Math.max(0, Math.round((end - start) / 86400000));
}

/* Operational severity for the row left-accent */
function _escSev(r) {
  if (r.status === 'resolved') return 'sev-ok';
  if (Number(r.to_level) >= 4) return 'sev-critical';
  if (Number(r.to_level) === 3) return 'sev-warn';
  return 'sev-info';
}

function _escRender() {
  const body = document.getElementById('esc-body');
  if (!body) return;
  const isA = S.role === 'admin' || S.role === 'owner';
  const all = _escData || [];

  // Preset pills with live counts
  const counts = {
    open:     all.filter(r => r.status === 'open').length,
    resolved: all.filter(r => r.status === 'resolved').length,
    all:      all.length
  };
  const presets = [
    { id:'open',     lb:'Open',     alert:true },
    { id:'resolved', lb:'Resolved' },
    { id:'all',      lb:'All' }
  ];
  const presetEl = document.getElementById('esc-presets');
  if (presetEl) {
    presetEl.innerHTML = presets.map(p =>
      `<button class="dx-preset${_escCurFilter === p.id ? ' on' : ''}${p.alert && counts[p.id] ? ' alert' : ''}" onclick="_escFilter('${p.id}')">`
      + esc(p.lb)
      + `<span class="dx-preset-cnt">${counts[p.id]}</span></button>`
    ).join('');
  }

  let rows = all;
  if (_escCurFilter === 'open')     rows = rows.filter(r => r.status === 'open');
  if (_escCurFilter === 'resolved') rows = rows.filter(r => r.status === 'resolved');

  if (!rows.length) {
    body.innerHTML = `<div class="dx-wrap" id="esc-wrap">` + DX.empty({
      icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      title: _escCurFilter === 'open' ? 'No open escalations' : 'No escalations in this filter',
      sub: _escCurFilter === 'open' ? 'Cases escalated to management will appear here.' : 'Try a different filter or create a new escalation.'
    }) + `</div>`;
    return;
  }

  const trs = rows.map(r => {
    const name  = r.clients?.client_name || '—';
    const code  = r.clients?.client_code || '';
    const mono   = (name.trim()[0] || '?').toUpperCase();
    const age   = _escAge(r);
    const isOpen = r.status === 'open';
    const status = isOpen ? DX.statusChip('Open', 'danger') : DX.statusChip('Resolved', 'ok');
    const path  = `<span class="dx-status neutral">${esc(ESC_LVL_SHORT[r.from_level] || r.from_level)}</span>`
                + `<span style="color:var(--text-muted)">→</span>`
                + `<span class="dx-status ${Number(r.to_level) >= 4 ? 'danger' : 'info'}">${esc(ESC_LVL_SHORT[r.to_level] || r.to_level)}</span>`;
    const aging = isOpen ? DX.agingChip(age) : `<span class="dx-aging a0">${age}d</span>`;
    const acts  = `<span class="dx-acts" onclick="event.stopPropagation()">
        <button class="dx-act" title="View details" onclick="_escDrawer('${r.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        ${isA && isOpen ? `<button class="dx-act" title="Resolve" onclick="_escOpenResolve('${r.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
      </span>`;
    return `<tr class="clickable ${_escSev(r)}" data-search="${esc((name + ' ' + code + ' ' + (r.reason || '')).toLowerCase())}" onclick="_escDrawer('${r.id}')">
      <td data-v="${esc(name.toLowerCase())}">
        <span class="dx-cell"><span class="dx-mono">${esc(mono)}</span>
          <span class="dx-cell-main"><span class="dx-cell-t">${esc(name)}</span><span class="dx-cell-s">${esc(code)}</span></span>
        </span>
      </td>
      <td data-v="${esc(String(r.to_level))}"><span class="dx-cell" style="gap:6px">${path}</span></td>
      <td class="wrap muted dx-hide-sm" style="max-width:280px;white-space:normal" data-v="${esc((r.reason || '').toLowerCase())}">${esc(r.reason || '—')}</td>
      <td data-v="${isOpen ? '0' : '1'}">${status}</td>
      <td class="num" data-v="${age}">${aging}</td>
      <td class="muted dx-hide-sm" data-v="${esc(r.created_at || '')}">${r.created_at ? fD(r.created_at.split('T')[0]) : '—'}</td>
      <td class="num">${acts}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `<div class="dx-wrap" id="esc-wrap"><div class="dx-scroll"><table class="dx-table" id="esc-table">
    <thead><tr>
      <th data-sort="text">Client</th>
      <th data-sort="num">Escalation</th>
      <th class="dx-hide-sm">Reason</th>
      <th data-sort="text">Status</th>
      <th class="num" data-sort="num">Age</th>
      <th class="dx-hide-sm num" data-sort="date">Raised</th>
      <th class="num"></th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div>`;

  // Restore persisted density/columns, then wire enhancement
  DX.density(document.getElementById('esc-wrap'));
  DX.enhance(document.getElementById('esc-table'), {
    search: document.getElementById('esc-q')
  });
}

/* ── Detail drawer (view + escalation timeline) ──────────────────────────── */
function _escDrawer(id) {
  const r = (_escData || []).find(x => String(x.id) === String(id));
  if (!r) return;
  const isA = S.role === 'admin' || S.role === 'owner';
  const isOpen = r.status === 'open';
  const name = r.clients?.client_name || '—';
  const age  = _escAge(r);

  const stats = `<div class="dx-dstats">
    <div class="dx-dstat"><div class="dx-dstat-l">From</div><div class="dx-dstat-v">${esc(ESC_LVL_SHORT[r.from_level] || r.from_level)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">To</div><div class="dx-dstat-v">${esc(ESC_LVL_SHORT[r.to_level] || r.to_level)}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Status</div><div class="dx-dstat-v" style="font-size:13px;padding-top:4px">${isOpen ? DX.statusChip('Open', 'danger') : DX.statusChip('Resolved', 'ok')}</div></div>
    <div class="dx-dstat"><div class="dx-dstat-l">Age</div><div class="dx-dstat-v">${age}d</div></div>
  </div>`;

  const reasonBlock = `<div style="margin-bottom:18px">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Reason for escalation</div>
    <div style="font-size:13px;color:var(--text-primary);line-height:1.55">${esc(r.reason || '—')}</div>
  </div>`;

  const tl = [{
    type: 'danger',
    title: `Escalated ${ESC_LVL_SHORT[r.from_level] || r.from_level} → ${ESC_LVL_SHORT[r.to_level] || r.to_level}`,
    time: r.created_at ? fD(r.created_at.split('T')[0]) : '',
    body: r.reason || ''
  }];
  if (r.status === 'resolved') {
    tl.push({
      type: 'ok',
      title: 'Resolved',
      time: r.resolved_at ? fD(r.resolved_at.split('T')[0]) : '',
      body: r.resolution_note || 'Marked resolved.'
    });
  }

  const timelineBlock = `<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px">Activity</div>`
    + DX.timeline(tl);

  const footer = isA && isOpen
    ? `<button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click()">Close</button>
       <button class="btn btn-p btn-sm" id="esc-drawer-resolve">Mark Resolved</button>`
    : `<button class="btn btn-g btn-sm" onclick="document.querySelector('.dx-drawer-x').click()">Close</button>`;

  const d = DX.drawer({
    eyebrow: `Escalation · ${ESC_LVL_SHORT[r.from_level] || ''} → ${ESC_LVL_SHORT[r.to_level] || ''}`,
    title: name,
    subtitle: r.clients?.client_code || '',
    body: stats + reasonBlock + timelineBlock,
    footer
  });

  const rb = document.getElementById('esc-drawer-resolve');
  if (rb) rb.addEventListener('click', () => { d.close(); _escOpenResolve(r.id); });
}

async function _escPopulateClients() {
  const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
  const sel = document.getElementById('esc-client_id');
  if (!sel || !data) return;
  data.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.client_name} (${c.client_code || '—'})`;
    sel.appendChild(o);
  });
}

function _escOpenModal() {
  document.getElementById('esc-modal-err').textContent = '';
  document.getElementById('esc-modal').style.display = 'flex';
}
function _escCloseModal() { document.getElementById('esc-modal').style.display = 'none'; }

async function _escSave() {
  const clientId  = document.getElementById('esc-client_id').value;
  const fromLevel = document.getElementById('esc-from_level').value;
  const toLevel   = document.getElementById('esc-to_level').value;
  const reason    = document.getElementById('esc-reason').value.trim();
  const errEl     = document.getElementById('esc-modal-err');
  if (!clientId || !reason) { errEl.textContent = 'Client and reason are required.'; return; }

  const btn = document.getElementById('esc-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await supabase.rpc('create_escalation', {
    p_company_id: S.cid,
    p_data: {
      client_id: clientId,
      from_level: Number(fromLevel),
      to_level: Number(toLevel),
      reason,
      status: 'open',
      escalated_by: S.uid || null,
    }
  });

  btn.disabled = false; btn.textContent = 'Escalate';
  if (error) { errEl.textContent = error.message; return; }
  _escCloseModal();
  await _escLoad();
  if (typeof toast === 'function') toast('Escalation created', 'ok');
}

let _escResolveId = null;
function _escOpenResolve(id) {
  _escResolveId = id;
  document.getElementById('esc-resolution_note').value = '';
  document.getElementById('esc-resolve-err').textContent = '';
  document.getElementById('esc-resolve-modal').style.display = 'flex';
}
async function _escResolveConfirm() {
  const note = document.getElementById('esc-resolution_note').value.trim();
  const errEl = document.getElementById('esc-resolve-err');
  if (!note) { errEl.textContent = 'Resolution note required.'; return; }

  const btn = document.getElementById('esc-resolve-btn');
  btn.disabled = true;

  const { error } = await supabase.rpc('update_escalation', {
    p_id: _escResolveId,
    p_company_id: S.cid,
    p_data: {
      status: 'resolved',
      resolution_note: note,
      resolved_at: new Date().toISOString(),
    }
  });

  btn.disabled = false;
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('esc-resolve-modal').style.display = 'none';
  await _escLoad();
  if (typeof toast === 'function') toast('Escalation resolved', 'ok');
}
