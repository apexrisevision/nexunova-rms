// ── Legal Cases Register ────────────────────────────────────────

let _lcData      = [];
let _lcAnalytics = null;
let _lcFilter    = 'active';
let _lcEditId    = null;
let _lcCostCaseId= null;
let _lcDocCaseId = null;
let _lcClientsCache = [];

const LC_STAGES = {
  demand_notice:     { label:'Demand Notice',   tone:'warning' },
  lawyer_appointed:  { label:'Lawyer Appointed',tone:'info' },
  notice_filed:      { label:'Notice Filed',    tone:'info' },
  court_filed:       { label:'Court Filed',     tone:'warning' },
  hearing_scheduled: { label:'Hearing',         tone:'danger' },
  judgment_pending:  { label:'Judgment',        tone:'danger' },
  settled:           { label:'Settled',         tone:'success' },
  closed:            { label:'Closed',          tone:'success' },
};

const LC_TYPES = {
  recovery:   'Recovery',
  fraud:      'Fraud',
  title:      'Title Dispute',
  eviction:   'Eviction',
  other:      'Other',
};

const LC_RESOLVED = new Set(['settled','closed']);

function _lcStageTone(stage) {
  return (LC_STAGES[stage]?.tone) || '';
}

// ── Entry point ────────────────────────────────────────────────
async function rLegalCases() {
  const pg = document.getElementById('pg-legalcases');
  if (!pg) return;

  pg.innerHTML = `<div class="ani">
    ${NX.pageHeader('Legal Cases',
      NX.button('Open Case',  { variant:'primary', icon:'plus', onclick:'lcOpenCase()' }) +
      NX.button('Refresh',    { variant:'ghost', size:'sm', onclick:'_lcLoad()' }),
      { icon:'briefcase', tone:'danger', sub:'Track legal proceedings and case progression' })}
    <div id="lc-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:18px">
      ${[...Array(4)].map(()=>NX.kpi({label:'Loading…',value:'—'})).join('')}
    </div>
    <div id="lc-tabs" style="margin-bottom:14px"></div>
    <div id="lc-body"><div style="padding:48px;text-align:center;color:var(--fk-text-muted)">Loading…</div></div>
  </div>`;

  _lcEnsureModals();
  await _lcLoad();
}

// ── Data ───────────────────────────────────────────────────────
async function _lcLoad() {
  try {
    const [{ data: rows, error: e1 }, { data: analytics }] = await Promise.all([
      supabase.rpc('get_legal_cases',   { p_company_id: S.cid }),
      supabase.rpc('get_legal_analytics',{ p_company_id: S.cid })
    ]);
    if (e1) throw e1;
    _lcData      = Array.isArray(rows) ? rows : [];
    _lcAnalytics = analytics || {};
    _lcRenderStats();
    _lcRenderTabs();
    _lcRenderTable();
  } catch(e) {
    const body = document.getElementById('lc-body');
    if (body) body.innerHTML = NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load') }));
  }
}

// ── Stats ──────────────────────────────────────────────────────
function _lcRenderStats() {
  const el = document.getElementById('lc-stats');
  if (!el) return;
  const active   = _lcData.filter(c=>!LC_RESOLVED.has(c.stage)).length;
  const hearing  = _lcData.filter(c=>c.stage==='hearing_scheduled'||c.stage==='judgment_pending').length;
  const settled  = _lcData.filter(c=>LC_RESOLVED.has(c.stage)).length;
  const totalCost= _lcData.reduce((s,c)=>s+Number(c.total_legal_cost||0),0);

  el.innerHTML = [
    NX.kpi({ label:'Active Cases',  value: active,             dot: active>0 ? 'danger' : 'success' }),
    NX.kpi({ label:'In Hearing',    value: hearing,            dot: hearing>0 ? 'danger' : '' }),
    NX.kpi({ label:'Settled/Closed',value: settled,            dot: 'success' }),
    NX.kpi({ label:'Total Costs',   value: 'PKR '+fM(totalCost), dot:'info' }),
  ].join('');
}

// ── Tabs ───────────────────────────────────────────────────────
function _lcRenderTabs() {
  const el = document.getElementById('lc-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({
    tabs: [
      { k:'active',   label:'Active',   count: _lcData.filter(c=>!LC_RESOLVED.has(c.stage)).length },
      { k:'resolved', label:'Closed',   count: _lcData.filter(c=>LC_RESOLVED.has(c.stage)).length },
      { k:'all',      label:'All',      count: _lcData.length },
    ],
    active: _lcFilter,
    onSelect: "lcSetFilter('%k')"
  });
}

function lcSetFilter(f) {
  _lcFilter = f;
  _lcRenderTabs();
  _lcRenderTable();
}

function _lcFiltered() {
  if (_lcFilter==='active')   return _lcData.filter(c=>!LC_RESOLVED.has(c.stage));
  if (_lcFilter==='resolved') return _lcData.filter(c=>LC_RESOLVED.has(c.stage));
  return _lcData;
}

// ── Table ──────────────────────────────────────────────────────
function _lcRenderTable() {
  const body = document.getElementById('lc-body');
  if (!body) return;
  const rows = _lcFiltered();

  if (!rows.length) {
    body.innerHTML = NX.card(NX.empty({
      icon:    _lcFilter==='active' ? 'check-circle' : 'briefcase',
      tone:    _lcFilter==='active' ? 'success' : undefined,
      message: _lcFilter==='active'   ? 'No active legal cases'
             : _lcFilter==='resolved' ? 'No closed cases yet'
             : 'No legal cases opened yet',
      action: _lcFilter==='all' ? NX.button('Open First Case', { variant:'primary', icon:'plus', onclick:'lcOpenCase()' }) : ''
    }));
    return;
  }

  body.innerHTML = NX.card(`
    <table class="nx-table">
      <thead><tr>
        <th style="width:130px">Stage</th>
        <th>Client</th>
        <th class="hide-sm">Type</th>
        <th class="hide-sm">Lawyer</th>
        <th class="num hide-sm">Legal Cost</th>
        <th class="hide-sm">Next Hearing</th>
        <th style="width:10px"></th>
      </tr></thead>
      <tbody>${rows.map(_lcRow).join('')}</tbody>
    </table>`, { flush: true });
}

function _lcRow(c) {
  const stage = LC_STAGES[c.stage] || { label: c.stage||'—', tone:'' };
  const stageBadge = NX.badge(stage.label, stage.tone, {dot:true});

  const typeLabel = LC_TYPES[c.case_type] || c.case_type || '—';
  const isResolved = LC_RESOLVED.has(c.stage);

  const nextHearing = c.next_hearing_date;
  const today = new Date().toISOString().split('T')[0];
  let hearingStr = '—';
  if (nextHearing && !isResolved) {
    const daysLeft = Math.round((new Date(nextHearing)-new Date(today))/86400000);
    hearingStr = `<div style="font-size:12px">${fD(nextHearing)}</div>`;
    if (daysLeft<=3&&daysLeft>=0)
      hearingStr += `<div style="font-size:10px;color:var(--fk-danger);font-weight:600">${daysLeft===0?'Today!':daysLeft+'d left'}</div>`;
    else if (daysLeft<0)
      hearingStr += `<div style="font-size:10px;color:var(--fk-text-muted)">Passed</div>`;
  }

  return `<tr>
    <td>${stageBadge}</td>
    <td>
      <div style="font-weight:600;font-size:13px">${esc(c.client_name||'—')}</div>
      <div style="font-size:11px;color:var(--fk-text-muted)">${esc(c.unit_info||'—')}${c.case_number?' · '+esc(c.case_number):''}</div>
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(typeLabel)}</td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(c.lawyer_name||'—')}</td>
    <td class="num hide-sm" style="font-size:12px;font-weight:600;color:var(--fk-text-muted)">${c.total_legal_cost>0?'PKR '+fM(c.total_legal_cost):'—'}</td>
    <td class="hide-sm">${hearingStr}</td>
    <td onclick="event.stopPropagation()">
      <div style="display:flex;gap:4px">
        <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="lcEditCase('${c.id}')" title="Edit">${NX.icon('pencil',13)}</button>
        <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="lcOpenCosts('${c.id}')" title="Legal Costs">${NX.icon('hand-coins',13)}</button>
        <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="lcOpenDocs('${c.id}')"  title="Documents">${NX.icon('file',13)}</button>
        ${!isResolved?`<button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="lcDemandLetter('${c.id}')" title="Demand Letter">${NX.icon('printer',13)}</button>`:''}
      </div>
    </td>
  </tr>`;
}

// ── Modals (host-injected once) ────────────────────────────────
function _lcEnsureModals() {
  if (document.getElementById('m-lc-case')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="m-lc-case" class="mov">
    <div class="nx-modal nx-modal--m">
      <div class="nx-modal-header">
        <h3 class="nx-modal-title" id="m-lc-case-title">Open Legal Case</h3>
        <button class="nx-modal-close" onclick="cm('m-lc-case')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body" id="m-lc-case-body">
        <div style="padding:24px;text-align:center;color:var(--fk-text-muted)">Loading…</div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',   { variant:'ghost',   onclick:"cm('m-lc-case')" })}
        ${NX.button('Save',     { variant:'primary', attrs:'id="lc-case-btn"', onclick:'lcSubmitCase()' })}
      </div>
    </div>
  </div>

  <div id="m-lc-costs" class="mov">
    <div class="nx-modal nx-modal--s">
      <div class="nx-modal-header">
        <div>
          <h3 class="nx-modal-title">Legal Costs</h3>
          <p class="nx-modal-sub" id="m-lc-costs-sub"></p>
        </div>
        <button class="nx-modal-close" onclick="cm('m-lc-costs')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body">
        <div id="lc-costs-list" style="margin-bottom:12px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
          <div class="nx-field" style="margin:0">
            <label class="nx-label" for="lc-cost-desc">Description</label>
            <input class="nx-input" type="text" id="lc-cost-desc" placeholder="e.g. Filing fee">
          </div>
          <div class="nx-field" style="margin:0">
            <label class="nx-label" for="lc-cost-amount">Amount (PKR)</label>
            <input class="nx-input" type="number" id="lc-cost-amount" min="0" placeholder="0">
          </div>
          <button class="nx-btn nx-btn--secondary" onclick="lcAddCostEntry()" style="white-space:nowrap">${NX.icon('plus',13)} Add</button>
        </div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Close',    { variant:'ghost',   onclick:"cm('m-lc-costs')" })}
        ${NX.button('Save',     { variant:'primary', attrs:'id="lc-costs-btn"', onclick:'lcSaveCosts()' })}
      </div>
    </div>
  </div>

  <div id="m-lc-docs" class="mov">
    <div class="nx-modal nx-modal--s">
      <div class="nx-modal-header">
        <div>
          <h3 class="nx-modal-title">Case Documents</h3>
          <p class="nx-modal-sub" id="m-lc-docs-sub"></p>
        </div>
        <button class="nx-modal-close" onclick="cm('m-lc-docs')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body">
        <div id="lc-docs-list" style="margin-bottom:12px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
          <div class="nx-field" style="margin:0">
            <label class="nx-label" for="lc-doc-name">Document Name</label>
            <input class="nx-input" type="text" id="lc-doc-name" placeholder="e.g. Demand Notice">
          </div>
          <div class="nx-field" style="margin:0">
            <label class="nx-label" for="lc-doc-url">URL / Link</label>
            <input class="nx-input" type="url" id="lc-doc-url" placeholder="https://…">
          </div>
          <button class="nx-btn nx-btn--secondary" onclick="lcAddDocEntry()" style="white-space:nowrap">${NX.icon('plus',13)} Add</button>
        </div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Close', { variant:'ghost',   onclick:"cm('m-lc-docs')" })}
        ${NX.button('Save',  { variant:'primary', attrs:'id="lc-docs-btn"', onclick:'lcSaveDocs()' })}
      </div>
    </div>
  </div>`);
}

// ── Case form ──────────────────────────────────────────────────
async function lcOpenCase(prefill) {
  prefill = prefill || {};
  _lcEditId = null;
  _lcEnsureModals();

  const titleEl = document.getElementById('m-lc-case-title');
  if (titleEl) titleEl.textContent = 'Open Legal Case';
  const body = document.getElementById('m-lc-case-body');
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--fk-text-muted)">Loading clients…</div>`;
  om('m-lc-case');

  if (!_lcClientsCache.length) {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _lcClientsCache = Array.isArray(data) ? data : [];
  }

  _lcFillCaseForm(body, null, prefill);
}

async function lcEditCase(id) {
  _lcEditId = id;
  _lcEnsureModals();

  const c = _lcData.find(x=>x.id===id);
  if (!c) return;

  const titleEl = document.getElementById('m-lc-case-title');
  if (titleEl) titleEl.textContent = 'Edit Legal Case';
  const body = document.getElementById('m-lc-case-body');
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--fk-text-muted)">Loading…</div>`;
  om('m-lc-case');

  if (!_lcClientsCache.length) {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _lcClientsCache = Array.isArray(data) ? data : [];
  }

  _lcFillCaseForm(body, c, {});
}

function _lcFillCaseForm(body, c, prefill) {
  const today = new Date().toISOString().split('T')[0];
  body.innerHTML = `
    <div class="nx-field">
      <label class="nx-label" for="lc-f-client">Client <span class="nx-req">*</span></label>
      <select class="nx-select" id="lc-f-client" ${c?'disabled':''}>
        <option value="">— Select client —</option>
        ${_lcClientsCache.map(cl=>`<option value="${cl.id}" ${(c?.client_id===cl.id||prefill?.clientId===cl.id)?'selected':''}>${esc(cl.full_name||'')} (${esc(cl.client_code||'')})</option>`).join('')}
      </select>
      <div class="nx-error"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="lc-f-type">Case Type</label>
        <select class="nx-select" id="lc-f-type">
          ${Object.entries(LC_TYPES).map(([k,v])=>`<option value="${k}" ${c?.case_type===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="nx-field">
        <label class="nx-label" for="lc-f-stage">Stage <span class="nx-req">*</span></label>
        <select class="nx-select" id="lc-f-stage">
          ${Object.entries(LC_STAGES).map(([k,v])=>`<option value="${k}" ${(c?.stage||'demand_notice')===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="lc-f-lawyer">Lawyer Name</label>
        <input class="nx-input" type="text" id="lc-f-lawyer" value="${esc(c?.lawyer_name||'')}" placeholder="Advocate Shahid…">
      </div>
      <div class="nx-field">
        <label class="nx-label" for="lc-f-casenr">Case Number</label>
        <input class="nx-input" type="text" id="lc-f-casenr" value="${esc(c?.case_number||'')}" placeholder="Court case ref">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="lc-f-filed">Date Filed</label>
        <input class="nx-input" type="date" id="lc-f-filed" value="${c?.date_filed||today}">
      </div>
      <div class="nx-field">
        <label class="nx-label" for="lc-f-next">Next Hearing Date</label>
        <input class="nx-input" type="date" id="lc-f-next" value="${c?.next_hearing_date||''}">
      </div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="lc-f-notes">Notes</label>
      <textarea class="nx-textarea" id="lc-f-notes" rows="3" placeholder="Case background, court, judge assigned…">${esc(c?.notes||prefill?.notes||'')}</textarea>
    </div>`;
}

async function lcSubmitCase() {
  const clientId = document.getElementById('lc-f-client')?.value;
  const type     = document.getElementById('lc-f-type')?.value||'recovery';
  const stage    = document.getElementById('lc-f-stage')?.value;
  const lawyer   = document.getElementById('lc-f-lawyer')?.value?.trim()||null;
  const casenr   = document.getElementById('lc-f-casenr')?.value?.trim()||null;
  const filed    = document.getElementById('lc-f-filed')?.value||null;
  const nextH    = document.getElementById('lc-f-next')?.value||null;
  const notes    = document.getElementById('lc-f-notes')?.value?.trim()||null;

  if (!_lcEditId && !clientId) { notify.error('Please select a client.'); return; }
  if (!stage) { notify.error('Please select a stage.'); return; }

  const btn = document.getElementById('lc-case-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const rpc = _lcEditId ? 'update_legal_case' : 'create_legal_case';
    const args = _lcEditId
      ? { p_id:_lcEditId, p_company_id:S.cid, p_stage:stage, p_lawyer_name:lawyer, p_case_number:casenr, p_date_filed:filed, p_next_hearing_date:nextH, p_notes:notes, p_case_type:type }
      : { p_company_id:S.cid, p_client_id:clientId, p_stage:stage, p_case_type:type, p_lawyer_name:lawyer, p_case_number:casenr, p_date_filed:filed, p_next_hearing_date:nextH, p_notes:notes, p_created_by:S.name||null };

    const { data, error } = await supabase.rpc(rpc, args);
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-lc-case');
    if (typeof showToast==='function') showToast(_lcEditId?'Case updated':'Case opened','ok');
    await _lcLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Save'; }
  }
}

// ── Legal Costs ────────────────────────────────────────────────
let _lcCostEntries = [];

function lcOpenCosts(id) {
  _lcCostCaseId = id;
  _lcEnsureModals();
  const c = _lcData.find(x=>x.id===id);
  const sub = document.getElementById('m-lc-costs-sub');
  if (sub) sub.textContent = c ? esc(c.client_name) : '';
  _lcCostEntries = Array.isArray(c?.legal_costs) ? [...c.legal_costs] : [];
  _lcRenderCostsList();
  om('m-lc-costs');
}

function _lcRenderCostsList() {
  const el = document.getElementById('lc-costs-list');
  if (!el) return;
  if (!_lcCostEntries.length) {
    el.innerHTML = `<p style="font-size:12px;color:var(--fk-text-muted);text-align:center;padding:8px">No costs added yet</p>`;
    return;
  }
  const total = _lcCostEntries.reduce((s,e)=>s+Number(e.amount||0),0);
  el.innerHTML = `
    <table class="nx-table" style="font-size:12px">
      <thead><tr><th>Description</th><th class="num">Amount</th><th style="width:30px"></th></tr></thead>
      <tbody>${_lcCostEntries.map((e,i)=>`<tr>
        <td>${esc(e.description||'—')}</td>
        <td class="num">PKR ${fM(e.amount||0)}</td>
        <td><button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="_lcRemoveCost(${i})">${NX.icon('x',12)}</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="font-weight:600">
        <td>Total</td>
        <td class="num">PKR ${fM(total)}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function lcAddCostEntry() {
  const desc   = document.getElementById('lc-cost-desc')?.value?.trim();
  const amount = parseFloat(document.getElementById('lc-cost-amount')?.value||0);
  if (!desc)      { notify.error('Enter a cost description.'); return; }
  if (!(amount>0)){ notify.error('Enter a valid amount.'); return; }
  _lcCostEntries.push({ description: desc, amount });
  document.getElementById('lc-cost-desc').value   = '';
  document.getElementById('lc-cost-amount').value = '';
  _lcRenderCostsList();
}

function _lcRemoveCost(i) {
  _lcCostEntries.splice(i,1);
  _lcRenderCostsList();
}

async function lcSaveCosts() {
  const btn = document.getElementById('lc-costs-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  try {
    const { data, error } = await supabase.rpc('update_legal_case_costs', {
      p_id:           _lcCostCaseId,
      p_company_id:   S.cid,
      p_legal_costs:  _lcCostEntries
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-lc-costs');
    if (typeof showToast==='function') showToast('Legal costs saved','ok');
    await _lcLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Save'; }
  }
}

// ── Documents ──────────────────────────────────────────────────
let _lcDocEntries = [];

function lcOpenDocs(id) {
  _lcDocCaseId = id;
  _lcEnsureModals();
  const c = _lcData.find(x=>x.id===id);
  const sub = document.getElementById('m-lc-docs-sub');
  if (sub) sub.textContent = c ? esc(c.client_name) : '';
  _lcDocEntries = Array.isArray(c?.documents) ? [...c.documents] : [];
  _lcRenderDocsList();
  om('m-lc-docs');
}

function _lcRenderDocsList() {
  const el = document.getElementById('lc-docs-list');
  if (!el) return;
  if (!_lcDocEntries.length) {
    el.innerHTML = `<p style="font-size:12px;color:var(--fk-text-muted);text-align:center;padding:8px">No documents added yet</p>`;
    return;
  }
  el.innerHTML = `
    <table class="nx-table" style="font-size:12px">
      <thead><tr><th>Document</th><th>Link</th><th style="width:30px"></th></tr></thead>
      <tbody>${_lcDocEntries.map((d,i)=>`<tr>
        <td>${esc(d.name||'—')}</td>
        <td>${d.url?`<a href="${esc(d.url)}" target="_blank" style="color:var(--fk-primary)">Open ${NX.icon('external-link',11)}</a>`:'—'}</td>
        <td><button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="_lcRemoveDoc(${i})">${NX.icon('x',12)}</button></td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function lcAddDocEntry() {
  const name = document.getElementById('lc-doc-name')?.value?.trim();
  const url  = document.getElementById('lc-doc-url')?.value?.trim()||null;
  if (!name) { notify.error('Enter a document name.'); return; }
  _lcDocEntries.push({ name, url });
  document.getElementById('lc-doc-name').value = '';
  document.getElementById('lc-doc-url').value  = '';
  _lcRenderDocsList();
}

function _lcRemoveDoc(i) {
  _lcDocEntries.splice(i,1);
  _lcRenderDocsList();
}

async function lcSaveDocs() {
  const btn = document.getElementById('lc-docs-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  try {
    const { data, error } = await supabase.rpc('update_legal_case_documents', {
      p_id:           _lcDocCaseId,
      p_company_id:   S.cid,
      p_documents:    _lcDocEntries
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-lc-docs');
    if (typeof showToast==='function') showToast('Documents saved','ok');
    await _lcLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Save'; }
  }
}

// ── Demand Letter ──────────────────────────────────────────────
function lcDemandLetter(id) {
  const c = _lcData.find(x=>x.id===id);
  if (!c) return;

  const today = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  const amount = c.outstanding_amount ? 'PKR '+fM(c.outstanding_amount) : '[OUTSTANDING AMOUNT]';
  const coName = S.coName||'[Company Name]';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Legal Demand Notice</title>
  <style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:40px;line-height:1.7;color:#111;font-size:14px}
  h2{text-align:center;margin-bottom:4px;font-size:18px;letter-spacing:1px}
  .header{text-align:center;margin-bottom:32px;border-bottom:2px solid #111;padding-bottom:12px}
  .ref{margin-bottom:20px;font-size:13px}.body-text{margin-bottom:16px}
  .amount{font-weight:bold;font-size:15px}.sig{margin-top:48px}</style>
  </head><body>
  <div class="header">
    <h2>LEGAL DEMAND NOTICE</h2>
    <div style="font-size:12px">Without Prejudice</div>
  </div>
  <div class="ref">
    <div>Date: ${today}</div>
    <div>Ref: ${esc(c.case_number||'[CASE NUMBER]')}</div>
    <div>Client: ${esc(c.client_name||'[CLIENT NAME]')}</div>
  </div>
  <p class="body-text">Dear ${esc(c.client_name||'Sir/Madam')},</p>
  <p class="body-text">We write on behalf of <strong>${esc(coName)}</strong> regarding your outstanding payment obligations.</p>
  <p class="body-text">Despite repeated communications, a sum of <span class="amount">${amount}</span> remains unpaid in respect of your property/installment obligations with ${esc(coName)}.</p>
  <p class="body-text">You are hereby given a final opportunity to clear the aforesaid outstanding amount within <strong>7 (seven) days</strong> of the receipt of this notice, failing which we shall be compelled to initiate legal proceedings against you without further notice.</p>
  <p class="body-text">This notice is being served without prejudice to all our rights and remedies available under law.</p>
  <div class="sig">
    <p>Yours faithfully,</p>
    <p><strong>${esc(c.lawyer_name||coName)}</strong></p>
    <p style="font-size:12px;color:#555">On behalf of ${esc(coName)}</p>
  </div>
  </body></html>`;

  if (typeof _printHTML==='function') {
    _printHTML(html);
  } else {
    const w = window.open('','_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }
}
