// ── Escalation Register ─────────────────────────────────────────
// DX-based reference implementation. Kit-wash: NX.pageHeader/tabs/kpi/badge/empty/card;
// inner DX.drawer/DX.timeline/DX.enhance kept (complex, worth preserving).
// Modals: .mov + .nx-modal (host-injected once).

let _escData      = [];
let _escCurFilter = 'open';

const ESC_LEVELS = {
  L1: 'Officer',
  L2: 'Manager',
  L3: 'Director',
  L4: 'CEO',
};

const ESC_LVL_SHORT = { L1:'L1', L2:'L2', L3:'L3', L4:'L4' };

function _escLevelTone(level, status) {
  if (status==='resolved') return 'success';
  if (level==='L4') return 'danger';
  if (level==='L3') return 'warning';
  if (level==='L2') return 'info';
  return '';
}

// ── Entry point ────────────────────────────────────────────────
async function rEscalations() {
  const pg = document.getElementById('pg-escalations');
  if (!pg) return;

  pg.innerHTML = `<div class="ani">
    ${NX.pageHeader('Escalations',
      NX.button('New Escalation', { variant:'primary', icon:'plus', onclick:'escOpenNew()' }) +
      NX.button('Refresh',        { variant:'ghost', size:'sm', onclick:'_escLoad()' }),
      { icon:'alert-triangle', tone:'danger', sub:'Track recovery escalations by severity level' })}
    <div id="esc-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:18px">
      ${[...Array(4)].map(()=>NX.kpi({label:'Loading…',value:'—'})).join('')}
    </div>
    <div id="esc-tabs" style="margin-bottom:14px"></div>
    <div id="esc-body"><div style="padding:48px;text-align:center;color:var(--fk-text-muted)">Loading…</div></div>
  </div>`;

  _escEnsureModals();
  await _escLoad();
}

// ── Data ───────────────────────────────────────────────────────
async function _escLoad() {
  try {
    const [{ data, error: e1 }, { data: analytics }] = await Promise.all([
      supabase.rpc('list_escalations', { p_company_id: S.cid }),
      supabase.rpc('get_escalation_analytics', { p_company_id: S.cid })
    ]);
    if (e1) throw e1;
    // Normalize list_escalations (DB contract) → the fields this page renders.
    // DB stores to_level (int) / reason / resolution_note / nested clients{};
    // the page reads escalation_level ('Ln') / description / resolution / client_name.
    _escData = (Array.isArray(data) ? data : []).map(e => Object.assign({}, e, {
      escalation_level: e.escalation_level || (e.to_level ? ('L' + e.to_level) : null),
      description:      e.description      || e.reason || '',
      resolution:      e.resolution       || e.resolution_note || '',
      client_name:     e.client_name       || (e.clients && e.clients.client_name) || '—'
    }));
    _escRenderStats(analytics||{});
    _escRenderTabs();
    _escRenderTable();
  } catch(e) {
    const body = document.getElementById('esc-body');
    if (body) body.innerHTML = NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load') }));
  }
}

// ── Stats ──────────────────────────────────────────────────────
function _escRenderStats(a) {
  const el = document.getElementById('esc-stats');
  if (!el) return;
  const open    = _escData.filter(e=>e.status!=='resolved').length;
  const critical= _escData.filter(e=>e.escalation_level==='L4'&&e.status!=='resolved').length;
  const resolved= _escData.filter(e=>e.status==='resolved').length;
  const l2plus  = _escData.filter(e=>['L2','L3','L4'].includes(e.escalation_level)&&e.status!=='resolved').length;

  el.innerHTML = [
    NX.kpi({ label:'Open',           value: open,      dot: open>0     ? 'danger'  : 'success' }),
    NX.kpi({ label:'L4/CEO',         value: critical,  dot: critical>0 ? 'danger'  : '' }),
    NX.kpi({ label:'L2+ Escalated',  value: l2plus,    dot: l2plus>0   ? 'warning' : '' }),
    NX.kpi({ label:'Resolved',       value: resolved,  dot: 'success' }),
  ].join('');
}

// ── Tabs ───────────────────────────────────────────────────────
function _escRenderTabs() {
  const el = document.getElementById('esc-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({
    tabs: [
      { k:'open',     label:'Open',     count: _escData.filter(e=>e.status!=='resolved').length },
      { k:'resolved', label:'Resolved', count: _escData.filter(e=>e.status==='resolved').length },
      { k:'all',      label:'All',      count: _escData.length },
    ],
    active: _escCurFilter,
    onSelect: "escSetFilter('%k')"
  });
}

function escSetFilter(f) {
  _escCurFilter = f;
  _escRenderTabs();
  _escRenderTable();
}

function _escFiltered() {
  if (_escCurFilter==='open')     return _escData.filter(e=>e.status!=='resolved');
  if (_escCurFilter==='resolved') return _escData.filter(e=>e.status==='resolved');
  return _escData;
}

// ── Table ──────────────────────────────────────────────────────
function _escRenderTable() {
  const body = document.getElementById('esc-body');
  if (!body) return;
  const rows = _escFiltered();

  if (!rows.length) {
    body.innerHTML = NX.card(NX.empty({
      icon:    _escCurFilter==='open' ? 'check-circle' : 'alert-triangle',
      tone:    _escCurFilter==='open' ? 'success' : undefined,
      message: _escCurFilter==='open'     ? 'No open escalations — all clear!'
             : _escCurFilter==='resolved' ? 'No resolved escalations yet'
             : 'No escalations logged yet',
      action: _escCurFilter==='all' ? NX.button('Open First Escalation', { variant:'primary', icon:'plus', onclick:'escOpenNew()' }) : ''
    }));
    return;
  }

  body.innerHTML = NX.card(`
    <table class="nx-table" id="esc-table">
      <thead><tr>
        <th style="width:70px">Level</th>
        <th>Client</th>
        <th class="hide-sm">Category</th>
        <th>Status</th>
        <th class="hide-sm">Opened</th>
        <th class="hide-sm">Assigned</th>
        <th style="width:10px"></th>
      </tr></thead>
      <tbody id="esc-tbody">${rows.map(_escRow).join('')}</tbody>
    </table>`, { flush: true });

  if (typeof DX !== 'undefined' && DX.enhance) {
    DX.enhance('#esc-table', { sort: true, search: false });
  }
}

function _escRow(e) {
  const tone    = _escLevelTone(e.escalation_level, e.status);
  const lvlBadge = NX.badge((ESC_LEVELS[e.escalation_level]||e.escalation_level||'—')+' ('+ESC_LVL_SHORT[e.escalation_level]+')', tone, {dot:true});

  const stMap = {
    open:        NX.badge('Open','danger',{dot:true}),
    in_progress: NX.badge('In Progress','warning',{dot:true}),
    pending:     NX.badge('Pending','',{dot:true}),
    resolved:    NX.badge('Resolved','success',{dot:true}),
  };
  const statusBadge = stMap[e.status] || NX.badge(e.status||'—','');

  const daysOpen = e.status!=='resolved' && e.created_at
    ? Math.floor((Date.now()-new Date(e.created_at).getTime())/86400000)
    : null;

  return `<tr onclick="escOpenDetail('${e.id}')" style="cursor:pointer">
    <td>${lvlBadge}</td>
    <td>
      <div style="font-weight:600;font-size:13px">${esc(e.client_name||'—')}</div>
      <div style="font-size:11px;color:var(--fk-text-muted)">${esc(e.unit_info||'—')}</div>
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(e.category||'—')}</td>
    <td>
      ${statusBadge}
      ${daysOpen!==null?`<div style="font-size:10px;color:${daysOpen>14?'var(--fk-danger)':daysOpen>7?'var(--fk-warning)':'var(--fk-text-muted)'};margin-top:2px">${daysOpen}d open</div>`:''}
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${fD(e.created_at?.split('T')[0])}</td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(e.assigned_to_name||'—')}</td>
    <td onclick="event.stopPropagation()">
      ${e.status!=='resolved'
        ? `<button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="event.stopPropagation();escOpenResolve('${e.id}')">Resolve</button>`
        : ''}
    </td>
  </tr>`;
}

// ── Detail Drawer ──────────────────────────────────────────────
async function escOpenDetail(id) {
  const row = _escData.find(e=>e.id===id);
  if (!row) return;

  if (typeof DX==='undefined' || !DX.drawer) {
    _escRenderDetailFallback(row);
    return;
  }

  const tone = _escLevelTone(row.escalation_level, row.status);
  const statusMap = { open:'danger', in_progress:'warning', pending:'', resolved:'success' };
  const header = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div>
      <div style="font-size:15px;font-weight:600;color:var(--fk-text)">${esc(row.client_name||'—')}</div>
      <div style="font-size:12px;color:var(--fk-text-muted)">${esc(row.unit_info||'')}${row.project_name?' · '+esc(row.project_name):''}</div>
    </div>
    ${NX.badge((ESC_LEVELS[row.escalation_level]||row.escalation_level||'—'), tone)}
    ${NX.badge(row.status||'open', statusMap[row.status]||'')}
    ${row.status!=='resolved'?NX.button('Resolve', { variant:'danger', size:'sm', onclick:"escOpenResolve('"+id+"')" }):''}
  </div>`;

  const { data: timeline } = await supabase.rpc('get_escalation_timeline', {
    p_escalation_id: id, p_company_id: S.cid
  });

  const body = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">
      ${NX.kpi({ label:'Level',    value: ESC_LEVELS[row.escalation_level]||row.escalation_level||'—', dot:tone })}
      ${NX.kpi({ label:'Category', value: row.category||'—', dot:'' })}
      ${NX.kpi({ label:'Assigned', value: row.assigned_to_name||'—', dot:'' })}
      ${NX.kpi({ label:'Opened',   value: fD(row.created_at?.split('T')[0]), dot:'' })}
    </div>
    ${row.description?NX.card(`<p style="font-size:13px;color:var(--fk-text);margin:0">${esc(row.description)}</p>`, {header:{title:'Description'}}):''}
    ${row.status==='resolved'&&row.resolution?NX.card(`<p style="font-size:13px;color:var(--fk-text);margin:0">${esc(row.resolution)}</p>`, {header:{icon:'check-circle',tone:'success',title:'Resolution'}}):''}
    ${NX.card(`
      <div id="esc-timeline-body">
        ${Array.isArray(timeline)&&timeline.length
          ? (typeof DX!=='undefined'&&DX.timeline
            ? DX.timeline(timeline.map(t=>({ label:t.event_type, text:t.description, ts:t.created_at, by:t.created_by })))
            : timeline.map(t=>`<div style="padding:8px 0;border-bottom:1px solid var(--fk-border);font-size:12px">
                <div style="font-weight:600">${esc(t.event_type||'Event')}</div>
                <div style="color:var(--fk-text-muted)">${esc(t.description||'')}</div>
                <div style="font-size:11px;color:var(--fk-text-muted)">${fD(t.created_at?.split('T')[0])} · ${esc(t.created_by||'')}</div>
              </div>`).join(''))
          : NX.empty({ icon:'clock', message:'No timeline events yet' })}
      </div>`, { flush:true, header:{icon:'clock',title:'Timeline'} })}`;

  DX.drawer({ id:'esc-detail-drawer', header, body, width:'480px' });
}

function _escRenderDetailFallback(row) {
  om('m-esc-new');
}

// ── New Escalation Modal ───────────────────────────────────────
let _escClientsCache = [];

function _escEnsureModals() {
  if (document.getElementById('m-esc-new')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="m-esc-new" class="mov">
    <div class="nx-modal nx-modal--m">
      <div class="nx-modal-header">
        <h3 class="nx-modal-title">Open Escalation</h3>
        <button class="nx-modal-close" onclick="cm('m-esc-new')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body" id="m-esc-new-body">
        <div style="padding:24px;text-align:center;color:var(--fk-text-muted)">Loading…</div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',           { variant:'ghost',   onclick:"cm('m-esc-new')" })}
        ${NX.button('Open Escalation',  { variant:'primary', attrs:'id="esc-new-btn"', onclick:'escSubmitNew()' })}
      </div>
    </div>
  </div>

  <div id="m-esc-resolve" class="mov">
    <div class="nx-modal nx-modal--s">
      <div class="nx-modal-header">
        <div>
          <h3 class="nx-modal-title">Resolve Escalation</h3>
          <p class="nx-modal-sub" id="m-esc-resolve-sub"></p>
        </div>
        <button class="nx-modal-close" onclick="cm('m-esc-resolve')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body">
        <div class="nx-field">
          <label class="nx-label" for="esc-r-notes">Resolution Notes <span class="nx-req">*</span></label>
          <textarea class="nx-textarea" id="esc-r-notes" rows="4" placeholder="How was this escalation resolved?"></textarea>
          <div class="nx-error"></div>
        </div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',    { variant:'ghost',   onclick:"cm('m-esc-resolve')" })}
        ${NX.button('Resolve',   { variant:'primary', attrs:'id="esc-resolve-btn"', onclick:'escSubmitResolve()' })}
      </div>
    </div>
  </div>`);
}

async function escOpenNew(prefill) {
  prefill = prefill || {};
  _escEnsureModals();

  const body = document.getElementById('m-esc-new-body');
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--fk-text-muted)">Loading clients…</div>`;
  om('m-esc-new');

  if (!_escClientsCache.length) {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _escClientsCache = Array.isArray(data) ? data : [];
  }

  body.innerHTML = `
    <div class="nx-field">
      <label class="nx-label" for="esc-n-client">Client <span class="nx-req">*</span></label>
      <select class="nx-select" id="esc-n-client">
        <option value="">— Select client —</option>
        ${_escClientsCache.map(c=>`<option value="${c.id}" ${prefill.clientId===c.id?'selected':''}>${esc(c.full_name||'')} (${esc(c.client_code||'')})</option>`).join('')}
      </select>
      <div class="nx-error"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="esc-n-level">Escalation Level <span class="nx-req">*</span></label>
        <select class="nx-select" id="esc-n-level">
          ${Object.entries(ESC_LEVELS).map(([k,v])=>`<option value="${k}">${k} — ${v}</option>`).join('')}
        </select>
        <div class="nx-error"></div>
      </div>
      <div class="nx-field">
        <label class="nx-label" for="esc-n-cat">Category</label>
        <select class="nx-select" id="esc-n-cat">
          <option value="non_payment">Non-payment</option>
          <option value="payment_dispute">Payment Dispute</option>
          <option value="communication">Communication Failure</option>
          <option value="legal_threat">Legal Threat</option>
          <option value="fraud">Suspected Fraud</option>
          <option value="other">Other</option>
        </select>
        <div class="nx-error"></div>
      </div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="esc-n-desc">Description <span class="nx-req">*</span></label>
      <textarea class="nx-textarea" id="esc-n-desc" rows="4" placeholder="Describe the situation and reason for escalation…" value="${esc(prefill.description||'')}"></textarea>
      <div class="nx-error"></div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="esc-n-assigned">Assign To</label>
      <input class="nx-input" type="text" id="esc-n-assigned" placeholder="Officer or manager name">
      <div class="nx-error"></div>
    </div>`;
}

let _escActingId = null;

async function escSubmitNew() {
  const clientId = document.getElementById('esc-n-client')?.value;
  const level    = document.getElementById('esc-n-level')?.value;
  const cat      = document.getElementById('esc-n-cat')?.value||null;
  const desc     = document.getElementById('esc-n-desc')?.value?.trim();
  const assigned = document.getElementById('esc-n-assigned')?.value?.trim()||null;

  if (!clientId) { notify.error('Please select a client.'); return; }
  if (!level)    { notify.error('Please select an escalation level.'); return; }
  if (!desc)     { notify.error('Description is required.'); return; }

  const btn = document.getElementById('esc-new-btn');
  if (btn) { btn.disabled=true; btn.textContent='Opening…'; }

  try {
    // RPC signature is (p_company_id, p_data jsonb). The table stores to_level (int) /
    // reason / escalated_by(uuid). Map the form's L-level → int, fold category +
    // assignee into the reason text, and attribute to the officer (the calls pattern).
    const _toLevel = parseInt(String(level).replace(/[^0-9]/g, ''), 10) || 1;
    const _reason  = (cat ? '[' + cat + '] ' : '') + desc +
                     (assigned ? '\nAssigned to: ' + assigned : '');
    const { data, error } = await supabase.rpc('create_escalation', {
      p_company_id: S.cid,
      p_data: {
        client_id:    clientId,
        to_level:     _toLevel,
        from_level:   1,
        reason:       _reason,
        escalated_by: S.userId,
        status:       'open'
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-esc-new');
    if (typeof showToast==='function') showToast('Escalation opened','ok');
    await _escLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Open Escalation'; }
  }
}

function escOpenResolve(id) {
  _escActingId = id;
  _escEnsureModals();
  const e = _escData.find(x=>x.id===id);
  const sub = document.getElementById('m-esc-resolve-sub');
  if (sub) sub.textContent = e ? esc(e.client_name)+'  ·  '+ESC_LVL_SHORT[e.escalation_level] : '';
  const notesEl = document.getElementById('esc-r-notes');
  if (notesEl) notesEl.value = '';
  om('m-esc-resolve');
}

async function escSubmitResolve() {
  const notes = document.getElementById('esc-r-notes')?.value?.trim();
  if (!notes) { notify.error('Resolution notes are required.'); return; }

  const btn = document.getElementById('esc-resolve-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const { data, error } = await supabase.rpc('resolve_escalation', {
      p_id:             _escActingId,
      p_company_id:     S.cid,
      p_resolution:     notes,
      p_resolved_by:    S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-esc-resolve');
    if (typeof showToast==='function') showToast('Escalation resolved','ok');
    await _escLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Resolve'; }
  }
}
