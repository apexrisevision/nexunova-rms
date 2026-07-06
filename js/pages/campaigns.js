// ══ RECOVERY CAMPAIGNS MODULE ══════════════════════════════════

let _camList        = [];
let _camFilter      = 'active';
let _camCurId       = null;
let _camDetail      = null;
let _camClientsCache= [];
let _camAssignSel   = [];

// ── Entry point ────────────────────────────────────────────────
async function rCampaigns() {
  const pg = document.getElementById('pg-campaigns');
  if (!pg) return;

  if (_camCurId) {
    await _camRenderDetail(pg);
    return;
  }
  _camRenderList(pg);
  await _camLoadList();
}

// ── List view ──────────────────────────────────────────────────
function _camRenderList(pg) {
  pg.innerHTML = `<div class="ani">
    ${NX.pageHeader('Recovery Campaigns',
      NX.button('New Campaign', { variant:'primary', icon:'plus', onclick:'camOpenCreate()' }),
      { icon:'megaphone', tone:'', sub:'Drive collection with targeted recovery pushes' })}
    <div id="cam-tabs" style="margin-bottom:16px"></div>
    <div id="cam-grid"></div>
  </div>`;
}

async function _camLoadList() {
  const gridEl = document.getElementById('cam-grid');
  if (!gridEl) return;
  gridEl.innerHTML = `<div style="padding:32px;text-align:center;color:var(--fk-text-muted)">Loading…</div>`;

  try {
    const { data, error } = await supabase.rpc('list_campaigns', { p_company_id: S.cid });
    if (error) throw error;
    _camList = Array.isArray(data) ? data : [];
    _camRenderTabs();
    _camRenderGrid();
  } catch(e) {
    if (gridEl) gridEl.innerHTML = NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load campaigns') }));
  }
}

function _camFiltered() {
  if (_camFilter==='active') return _camList.filter(c=>c.status==='active'||c.status==='draft');
  if (_camFilter==='closed') return _camList.filter(c=>c.status==='closed'||c.status==='completed'||c.status==='cancelled');
  return _camList;
}

function _camRenderTabs() {
  const el = document.getElementById('cam-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({
    tabs: [
      { k:'active', label:'Active',    count: _camList.filter(c=>c.status==='active'||c.status==='draft').length },
      { k:'closed', label:'Completed', count: _camList.filter(c=>c.status==='closed'||c.status==='completed'||c.status==='cancelled').length },
      { k:'all',    label:'All',       count: _camList.length },
    ],
    active: _camFilter,
    onSelect: "camSetFilter('%k')"
  });
}

function camSetFilter(f) {
  _camFilter = f;
  _camRenderTabs();
  _camRenderGrid();
}

function _camRenderGrid() {
  const el = document.getElementById('cam-grid');
  if (!el) return;
  const list = _camFiltered();

  if (!list.length) {
    el.innerHTML = NX.card(NX.empty({
      icon: 'megaphone',
      message: _camFilter==='active' ? 'No active campaigns right now'
             : _camFilter==='closed' ? 'No completed campaigns yet'
             : 'No campaigns created yet',
      action: NX.button('Create First Campaign', { variant:'primary', icon:'plus', onclick:'camOpenCreate()' })
    }));
    return;
  }

  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">
    ${list.map(_camCardHTML).join('')}
  </div>`;
}

function _camCardHTML(c) {
  const progress = Math.min(100, Math.round(
    (Number(c.collected_amount||0) / Math.max(1, Number(c.target_amount||1))) * 100
  ));
  const statusBadge = {
    active:    NX.badge('Active',    'success', {dot:true}),
    closed:    NX.badge('Completed', 'info',    {dot:true}),
    completed: NX.badge('Completed', 'info',    {dot:true}),
    cancelled: NX.badge('Cancelled', '',        {dot:true}),
    draft:     NX.badge('Draft',     '',        {dot:true}),
  }[c.status] || NX.badge(c.status||'—', '');

  const daysLeft = c.end_date
    ? Math.round((new Date(c.end_date) - new Date()) / 86400000)
    : null;
  const timeStr = daysLeft===null ? '' :
    daysLeft>0  ? `<span style="font-size:11px;color:var(--fk-text-muted)">${daysLeft}d left</span>`
  : daysLeft===0? `<span style="font-size:11px;color:var(--fk-warning)">Ends today</span>`
                : `<span style="font-size:11px;color:var(--fk-danger)">Ended ${Math.abs(daysLeft)}d ago</span>`;

  return `<div class="nx-card nx-card--hover" onclick="camOpenDetail('${c.id}')" style="cursor:pointer">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-weight:600;font-size:14px;color:var(--fk-text)">${esc(c.campaign_name||'—')}</div>
      ${statusBadge}
    </div>
    ${c.description ? `<p style="font-size:12px;color:var(--fk-text-muted);margin:0 0 10px;line-height:1.5">${esc(c.description.substring(0,100))}${c.description.length>100?'…':''}</p>` : ''}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
      ${NX.kpi({ label:'Target',    value: 'PKR '+fM(c.target_amount||0),    inline:true })}
      ${NX.kpi({ label:'Collected', value: 'PKR '+fM(c.collected_amount||0), inline:true })}
      ${NX.kpi({ label:'Clients',   value: c.client_count||0,                inline:true })}
    </div>
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:11px;color:var(--fk-text-muted)">Progress</span>
        <span style="font-size:11px;font-weight:600;color:${progress>=100?'var(--fk-success)':progress>=50?'var(--fk-warning)':'var(--fk-danger)'}">${progress}%</span>
      </div>
      <div style="height:5px;border-radius:100px;background:var(--fk-border);overflow:hidden">
        <div style="height:100%;border-radius:100px;background:${progress>=100?'var(--fk-success)':progress>=50?'var(--fk-warning)':'var(--fk-primary)'};width:${progress}%;transition:width .4s ease"></div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      ${c.start_date?`<span style="font-size:11px;color:var(--fk-text-muted)">${fD(c.start_date)}${c.end_date?' → '+fD(c.end_date):''}</span>`:'<span></span>'}
      ${timeStr}
    </div>
  </div>`;
}

// ── Campaign Detail ────────────────────────────────────────────
async function camOpenDetail(id) {
  _camCurId = id;
  const pg = document.getElementById('pg-campaigns');
  if (!pg) return;

  pg.innerHTML = `<div class="ani">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="_camBackToList()">${NX.icon('arrow-left',14)} Campaigns</button>
    </div>
    <div style="padding:32px;text-align:center;color:var(--fk-text-muted)">Loading campaign…</div>
  </div>`;

  await _camRenderDetail(pg);
}

async function _camRenderDetail(pg) {
  try {
    const [{ data: det, error: e1 }, { data: clients }, { data: officers }] = await Promise.all([
      supabase.rpc('get_campaign_detail',  { p_id: _camCurId, p_company_id: S.cid }),
      supabase.rpc('get_campaign_clients', { p_id: _camCurId, p_company_id: S.cid }),
      supabase.rpc('get_campaign_officers',{ p_id: _camCurId, p_company_id: S.cid })
    ]);
    if (e1) throw e1;
    _camDetail = det;

    const c = det;
    const progress = Math.min(100, Math.round((Number(c.collected_amount||0)/Math.max(1,Number(c.target_amount||1)))*100));
    const statusBadge = {
      active:    NX.badge('Active',    'success', {dot:true}),
      closed:    NX.badge('Completed', 'info',    {dot:true}),
      completed: NX.badge('Completed', 'info',    {dot:true}),
      cancelled: NX.badge('Cancelled', '',        {dot:true}),
      draft:     NX.badge('Draft',     '',        {dot:true}),
    }[c.status] || NX.badge(c.status||'—', '');

    pg.innerHTML = `<div class="ani">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="_camBackToList()">${NX.icon('arrow-left',14)} Campaigns</button>
        <span style="color:var(--fk-border)">|</span>
        <span style="font-size:13px;font-weight:600;color:var(--fk-text)">${esc(c.campaign_name||'Campaign')}</span>
        ${statusBadge}
        <div style="margin-left:auto;display:flex;gap:8px">
          ${c.status==='active'||c.status==='draft' ? NX.button('Assign Clients',  { variant:'secondary', size:'sm', icon:'users',    onclick:"camOpenAssign('"+_camCurId+"')" }) : ''}
          ${c.status==='active'||c.status==='draft' ? NX.button('Close Campaign',  { variant:'ghost',     size:'sm',                   onclick:"camCloseCampaign('"+_camCurId+"')" }) : ''}
        </div>
      </div>

      ${c.description?`<p style="font-size:13px;color:var(--fk-text-muted);margin:0 0 16px">${esc(c.description)}</p>`:''}

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        ${NX.kpi({ label:'Target',    value: 'PKR '+fM(c.target_amount||0),    dot:'info' })}
        ${NX.kpi({ label:'Collected', value: 'PKR '+fM(c.collected_amount||0), dot:'success' })}
        ${NX.kpi({ label:'Progress',  value: progress+'%',                      dot: progress>=100?'success':progress>=50?'warning':'danger' })}
        ${NX.kpi({ label:'Clients',   value: (clients||[]).length,              dot:'primary' })}
        ${NX.kpi({ label:'Start',     value: c.start_date?fD(c.start_date):'—',dot:'' })}
        ${NX.kpi({ label:'End',       value: c.end_date?fD(c.end_date):'Open', dot:'' })}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
        ${NX.card(`
          <table class="nx-table">
            <thead><tr>
              <th>Client</th><th class="num">Outstanding</th><th class="num">Collected</th><th>Status</th>
            </tr></thead>
            <tbody>${!(clients||[]).length
              ? `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--fk-text-muted)">No clients assigned yet</td></tr>`
              : (clients||[]).map(cl=>`<tr>
              <td>
                <div style="font-weight:600;font-size:13px">${esc(cl.client_name||'—')}</div>
                <div style="font-size:11px;color:var(--fk-text-muted)">${esc(cl.phone_primary||'—')}</div>
              </td>
              <td class="num" style="font-weight:600;font-size:13px">PKR ${fM(cl.outstanding_amount||0)}</td>
              <td class="num" style="font-size:12px;color:var(--fk-success)">PKR ${fM(cl.collected_amount||0)}</td>
              <td>${{
                cleared:    NX.badge('Cleared','success'),
                partial:    NX.badge('Partial','warning'),
                no_contact: NX.badge('No Contact',''),
                promised:   NX.badge('Promised','info'),
                refused:    NX.badge('Refused','danger'),
              }[cl.status]||NX.badge(cl.status||'Pending','')}</td>
            </tr>`).join('')}
            </tbody>
          </table>`,
          { flush:true, header:{ icon:'users', title:'Assigned Clients ('+(clients||[]).length+')' } })}

        ${NX.card(`
          <table class="nx-table">
            <thead><tr>
              <th>Officer</th><th class="num">Contacted</th><th class="num">Collected</th>
            </tr></thead>
            <tbody>${!(officers||[]).length
              ? `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--fk-text-muted)">No officer activity yet</td></tr>`
              : (officers||[]).map(o=>`<tr>
              <td>
                <div style="font-weight:600;font-size:13px">${esc(o.officer_name||o.username||'—')}</div>
                <div style="font-size:11px;color:var(--fk-text-muted)">@${esc(o.username||'')}</div>
              </td>
              <td class="num" style="font-weight:600">${o.contacts_made||0}</td>
              <td class="num" style="color:var(--fk-success);font-weight:600">PKR ${fM(o.amount_collected||0)}</td>
            </tr>`).join('')}
            </tbody>
          </table>`,
          { flush:true, header:{ icon:'users', title:'Officer Activity' } })}
      </div>
    </div>`;
  } catch(e) {
    pg.innerHTML = `<div>
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="_camBackToList()" style="margin-bottom:16px">${NX.icon('arrow-left',14)} Back</button>
      ${NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load campaign detail') }))}
    </div>`;
  }
}

function _camBackToList() {
  _camCurId  = null;
  _camDetail = null;
  rCampaigns();
}

// ── Create Campaign ────────────────────────────────────────────
function camOpenCreate() {
  if (!document.getElementById('m-cam-create')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="m-cam-create" class="mov">
      <div class="nx-modal nx-modal--m">
        <div class="nx-modal-header">
          <h3 class="nx-modal-title">New Recovery Campaign</h3>
          <button class="nx-modal-close" onclick="cm('m-cam-create')">${NX.icon('x',16)}</button>
        </div>
        <div class="nx-modal-body">
          <div class="nx-field">
            <label class="nx-label" for="cam-c-name">Campaign Name <span class="nx-req">*</span></label>
            <input class="nx-input" type="text" id="cam-c-name" placeholder="e.g. June Recovery Drive">
            <div class="nx-error"></div>
          </div>
          <div class="nx-field">
            <label class="nx-label" for="cam-c-desc">Description</label>
            <textarea class="nx-textarea" id="cam-c-desc" rows="2" placeholder="Campaign goal and approach…"></textarea>
            <div class="nx-error"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="nx-field">
              <label class="nx-label" for="cam-c-start">Start Date <span class="nx-req">*</span></label>
              <input class="nx-input" type="date" id="cam-c-start">
              <div class="nx-error"></div>
            </div>
            <div class="nx-field">
              <label class="nx-label" for="cam-c-end">End Date</label>
              <input class="nx-input" type="date" id="cam-c-end">
              <div class="nx-error"></div>
            </div>
          </div>
          <div class="nx-field">
            <label class="nx-label" for="cam-c-target">Collection Target (PKR)</label>
            <input class="nx-input" type="number" id="cam-c-target" min="0" placeholder="Leave blank for open-ended">
            <div class="nx-error"></div>
          </div>
          <div class="nx-field">
            <label class="nx-label" for="cam-c-type">Campaign Type</label>
            <select class="nx-select" id="cam-c-type">
              <option value="overdue">Overdue Recovery</option>
              <option value="upcoming">Pre-Due Reminder</option>
              <option value="broken_promises">Broken Promises Follow-up</option>
              <option value="high_risk">High-Risk Clients</option>
              <option value="general">General</option>
            </select>
            <div class="nx-error"></div>
          </div>
        </div>
        <div class="nx-modal-footer">
          ${NX.button('Cancel',          { variant:'ghost',   onclick:"cm('m-cam-create')" })}
          ${NX.button('Create Campaign', { variant:'primary', attrs:'id="cam-create-btn"', onclick:'camSubmitCreate()' })}
        </div>
      </div>
    </div>`);
  }

  document.getElementById('cam-c-name').value   = '';
  document.getElementById('cam-c-desc').value   = '';
  document.getElementById('cam-c-end').value    = '';
  document.getElementById('cam-c-target').value = '';
  document.getElementById('cam-c-start').value  = new Date().toISOString().split('T')[0];
  om('m-cam-create');
}

async function camSubmitCreate() {
  const name   = document.getElementById('cam-c-name')?.value?.trim();
  const desc   = document.getElementById('cam-c-desc')?.value?.trim()||null;
  const start  = document.getElementById('cam-c-start')?.value;
  const end    = document.getElementById('cam-c-end')?.value||null;
  const target = parseFloat(document.getElementById('cam-c-target')?.value||0)||null;
  const type   = document.getElementById('cam-c-type')?.value||'general';

  if (!name) { notify.error('Campaign name is required.'); return; }
  if (!start) { notify.error('Start date is required.'); return; }

  const btn = document.getElementById('cam-create-btn');
  if (btn) { btn.disabled=true; btn.textContent='Creating…'; }

  try {
    const { data, error } = await supabase.rpc('create_campaign', {
      p_company_id:    S.cid,
      p_campaign_name: name,
      p_description:   desc,
      p_start_date:    start,
      p_end_date:      end,
      p_target_amount: target,
      p_campaign_type: type,
      p_created_by:    S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-cam-create');
    if (typeof showToast==='function') showToast('Campaign created successfully','ok');
    await _camLoadList();
  } catch(e) {
    notify.error(e.message||'Failed to create campaign');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Create Campaign'; }
  }
}

// ── Assign Clients ─────────────────────────────────────────────
async function camOpenAssign(campaignId) {
  if (!document.getElementById('m-cam-assign')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="m-cam-assign" class="mov">
      <div class="nx-modal nx-modal--m">
        <div class="nx-modal-header">
          <h3 class="nx-modal-title">Assign Clients to Campaign</h3>
          <button class="nx-modal-close" onclick="cm('m-cam-assign')">${NX.icon('x',16)}</button>
        </div>
        <div class="nx-modal-body" id="m-cam-assign-body">
          <div style="padding:24px;text-align:center;color:var(--fk-text-muted)">Loading clients…</div>
        </div>
        <div class="nx-modal-footer">
          ${NX.button('Cancel',          { variant:'ghost',   onclick:"cm('m-cam-assign')" })}
          ${NX.button('Assign Selected', { variant:'primary', attrs:'id="cam-assign-btn"', onclick:'camSubmitAssign()' })}
        </div>
      </div>
    </div>`);
  }

  om('m-cam-assign');
  const body = document.getElementById('m-cam-assign-body');
  if (!body) return;

  try {
    if (!_camClientsCache.length) {
      const { data } = await supabase.rpc('get_overdue_clients_for_campaign', { p_company_id: S.cid });
      _camClientsCache = Array.isArray(data) ? data : [];
    }

    _camAssignSel = [];
    body.innerHTML = `
      <div style="margin-bottom:10px">
        <input class="nx-input" type="search" id="cam-assign-search" placeholder="Search clients…" oninput="_camFilterAssignList(this.value)">
      </div>
      <div id="cam-assign-list" style="max-height:350px;overflow-y:auto;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control)">
        ${_camRenderAssignList(_camClientsCache)}
      </div>
      <p style="font-size:11px;color:var(--fk-text-muted);margin:8px 0 0" id="cam-assign-count">0 selected</p>`;
  } catch(e) {
    body.innerHTML = NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load clients') });
  }
}

function _camRenderAssignList(clients) {
  if (!clients.length) return `<p style="padding:16px;text-align:center;font-size:12px;color:var(--fk-text-muted)">No clients found</p>`;
  return clients.map(c => `
    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--fk-border);transition:background .1s" onmouseover="this.style.background='var(--fk-surface2)'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${c.client_id}" onchange="_camToggleAssign(this)" style="accent-color:var(--fk-primary);width:14px;height:14px;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--fk-text)">${esc(c.client_name||'—')}</div>
        <div style="font-size:11px;color:var(--fk-text-muted)">${esc(c.phone_primary||'—')} · Overdue: PKR ${fM(c.overdue_amount||0)}</div>
      </div>
      ${NX.badge(fM(c.overdue_amount||0), c.overdue_amount>500000?'danger':c.overdue_amount>100000?'warning':'')}
    </label>`).join('');
}

function _camFilterAssignList(q) {
  const all = _camClientsCache.filter(c =>
    !q || (c.client_name||'').toLowerCase().includes(q.toLowerCase()) || (c.phone_primary||'').includes(q)
  );
  const el = document.getElementById('cam-assign-list');
  if (el) el.innerHTML = _camRenderAssignList(all);
}

function _camToggleAssign(cb) {
  const id = cb.value;
  if (cb.checked) { if (!_camAssignSel.includes(id)) _camAssignSel.push(id); }
  else _camAssignSel = _camAssignSel.filter(x=>x!==id);
  const ct = document.getElementById('cam-assign-count');
  if (ct) ct.textContent = _camAssignSel.length + ' selected';
}

async function camSubmitAssign() {
  if (!_camAssignSel.length) { notify.error('Please select at least one client.'); return; }

  const btn = document.getElementById('cam-assign-btn');
  if (btn) { btn.disabled=true; btn.textContent='Assigning…'; }

  try {
    const { data, error } = await supabase.rpc('assign_clients_to_campaign', {
      p_campaign_id: _camCurId,
      p_client_ids:  _camAssignSel,
      p_company_id:  S.cid
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-cam-assign');
    if (typeof showToast==='function') showToast(_camAssignSel.length+' clients assigned','ok');
    _camAssignSel = [];
    await _camRenderDetail(document.getElementById('pg-campaigns'));
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Assign Selected'; }
  }
}

// ── Close Campaign ─────────────────────────────────────────────
async function camCloseCampaign(id) {
  const c = _camDetail || _camList.find(x=>x.id===id);
  const name = c ? esc(c.campaign_name) : 'this campaign';
  if (!confirm(`Close "${name}"?\nThis will mark it as completed and lock further changes.`)) return;

  try {
    const { data, error } = await supabase.rpc('close_campaign', {
      p_id: id, p_company_id: S.cid, p_closed_by: S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    if (typeof showToast==='function') showToast('Campaign closed','ok');
    if (_camCurId) await _camRenderDetail(document.getElementById('pg-campaigns'));
    else await _camLoadList();
  } catch(e) {
    notify.error(e.message||'Failed to close campaign');
  }
}
