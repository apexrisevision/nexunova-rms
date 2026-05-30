// ══ SALES MODULE ══════════════════════════════════════════════════════
// DB: sales, installments, sale_sequences (Supabase)
// RPCs: create_sale_with_schedule, list_sales, get_sale_detail

// ── State ──────────────────────────────────────────────────────────────
let _salesCache  = [];
let _salSearch   = '';
let _salStatus   = '';
let _salPage     = 1;
const _SAL_PER_PAGE = 20;
let _salId            = null;
let _salEditId        = null;
let _salSchedule      = [];   // [{installment_number,installment_type,due_date,amount_due,notes}]
let _salAgents        = [];
let _salCurrentDetail = null; // holds last loaded sale detail for print
let _salBreachData     = null; // {lastDueDate, deliveryDate, breachMonths} when breach detected
let _salBreachApproval = null; // {approvedBy, approvalRef, approvedAt, reasonType, reasonDetail}

// ── Helpers ────────────────────────────────────────────────────────────
function _ordinal(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return n + 'th';
}

function _salClearErr(id) {
  const el  = document.getElementById(id);
  if (el)  el.classList.remove('inp-err');
  const err = document.getElementById('e-' + id);
  if (err) err.textContent = '';
}

// Auto-flag: warn if the selected client is actively blacklisted (Module 2.2).
async function _salCheckBlacklist(clientId) {
  const warn = document.getElementById('sf-bl-warn');
  if (!warn) return;
  warn.style.display = 'none';
  warn.textContent = '';
  if (!clientId) return;
  try {
    const { data } = await supabase.rpc('check_client_blacklisted', { p_client_id: clientId, p_company_id: S.cid });
    if (data && data.blacklisted) {
      const t = data.reason_type ? data.reason_type.toUpperCase() : 'BLACKLISTED';
      warn.innerHTML = '⛔ This client is BLACKLISTED (' + esc(t) + ')'
        + (data.reason ? ' — ' + esc(data.reason) : '')
        + '. Proceed with caution; obtain approval before booking a new sale.';
      warn.style.display = '';
    }
  } catch(e) { /* non-blocking */ }
}

// ── Badges ─────────────────────────────────────────────────────────────
function _salStatusBadge(s) {
  const map = {
    active:    ['var(--ok)',   'Active'],
    completed: ['var(--info)', 'Completed'],
    cancelled: ['var(--err)',  'Cancelled'],
  };
  const [color, label] = map[s] || ['var(--t3)', s || '?'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>`;
}

function _instStatusBadge(s) {
  const map = {
    pending:  ['var(--warn)',  'Pending'],
    paid:     ['var(--ok)',    'Paid'],
    partial:  ['var(--info)',  'Partial'],
    overdue:  ['var(--err)',   'Overdue'],
  };
  const [color, label] = map[s] || ['var(--t3)', s || '?'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>`;
}

function _instTypeBadge(t) {
  const map = {
    down_payment: ['var(--brand)', 'Down Pmt'],
    installment:  ['var(--t3)',    'Installment'],
    possession:   ['var(--ok)',    'Possession'],
    custom:       ['var(--info)',  'Custom'],
  };
  const [color, label] = map[t] || ['var(--t3)', t || '?'];
  return `<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:12px;background:${color}18;color:${color}">${label}</span>`;
}

// ══ SALES LIST PAGE ════════════════════════════════════════════════════

async function rSales() {
  const cid = S?.cid;
  const pg  = document.getElementById('pg-sales');
  if (!pg) return;
  if (!cid) {
    pg.innerHTML = `<div class="inv-empty" style="padding:60px"><span class="inv-empty-ic"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span><p class="inv-empty-tx">No company selected</p></div>`;
    return;
  }

  const isA = S.role === 'admin' || S.role === 'owner';
  const isR = S.role === 'recovery' || S.role === 'recovery_officer';

  pg.innerHTML = `<div class="inv-page ani module-sales">

  <!-- Breadcrumb -->
  <div class="inv-breadcrumb">
    <span class="lnk" onclick="nav('dashboard')">Home</span>
    <span style="opacity:.4"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></span>
    <span style="color:var(--text-soft)">Sales</span>
  </div>

  <!-- Page Header -->
  <div class="inv-ph-row">
    <h1 class="inv-title">Sales <span id="sal-count" style="font-size:14px;font-weight:400;color:var(--text-soft);margin-left:4px"></span></h1>
    <div class="inv-ph-actions">
      <button class="btn btn-gh btn-sm" onclick="printSalesList()" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print</button>
      <button class="btn btn-gh btn-sm" onclick="exportSalesExcel()" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg> Export Excel</button>
      ${(isA || isR) ? `<button class="btn btn-g btn-sm" onclick="nav('newsale')" style="display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Sale</button>` : ''}
    </div>
  </div>

  <!-- Stats KPIs (filled async) -->
  <div id="sal-stats"></div>

  <!-- Filter Toolbar -->
  <div class="inv-toolbar">
    <div class="inv-search-wrap">
      <span class="inv-search-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
      <input class="inv-search-inp" id="sal-s" placeholder="Sale #, client, unit, agent…"
             value="${esc(_salSearch)}" oninput="_salDoSearch(this.value)" autocomplete="off">
      <span class="inv-search-cmd">⌘K</span>
    </div>
    <div class="inv-status-pills">
      <button class="inv-spill${!_salStatus?' on':''}"           onclick="_salSetStatus('')">All</button>
      <button class="inv-spill${_salStatus==='active'?' on':''}" onclick="_salSetStatus('active')">Active</button>
      <button class="inv-spill${_salStatus==='completed'?' on':''}" onclick="_salSetStatus('completed')">Completed</button>
      <button class="inv-spill${_salStatus==='cancelled'?' on':''}" onclick="_salSetStatus('cancelled')">Cancelled</button>
    </div>
  </div>

  <div id="sal-ct"></div>
  <div class="inv-pager" id="sal-pager"></div>
</div>`;

  await _loadSalesList();
}

let _salSearchTimer = null;
function _salDoSearch(v) { _salSearch = v; _salPage = 1; clearTimeout(_salSearchTimer); _salSearchTimer = setTimeout(_loadSalesList, 300); }
function _salSetStatus(v) {
  _salStatus = v; _salPage = 1;
  document.querySelectorAll('#pg-sales .inv-spill').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('#pg-sales .inv-spill').forEach(b => {
    if (b.textContent.trim().toLowerCase() === (v||'all')) b.classList.add('on');
  });
  _loadSalesList();
}

async function _loadSalesList() {
  const cid = S?.cid;
  const ct  = document.getElementById('sal-ct');
  if (!ct || !cid) return;
  ct.innerHTML = `<div class="db-skel" style="padding:8px 0">${[0,1,2,3,4].map(()=>`<div class="db-sb" style="height:44px;border-radius:8px;margin-bottom:6px"></div>`).join('')}</div>`;

  try {
    const { data, error } = await supabase.rpc('list_sales', {
      p_company_id: cid,
      p_search:     _salSearch || null,
      p_status:     _salStatus || null,
      p_limit:      500,
      p_offset:     0
    });
    if (error) throw error;
    _salesCache = Array.isArray(data) ? data : [];
    _renderSalesStats(_salesCache);
    _renderSalesTable(_salesCache);
  } catch(e) {
    ct.innerHTML = `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load sales</div><div class="es">${esc(e.message)}</div></div>`;
  }
}

function _renderSalesStats(sales) {
  const el = document.getElementById('sal-stats');
  const countEl = document.getElementById('sal-count');
  if (!el) return;

  const active    = sales.filter(s => s.status === 'active').length;
  const totalNet  = sales.reduce((a, s) => a + Number(s.net_amount || 0), 0);
  const totalRem  = sales.reduce((a, s) => a + Math.max(0, Number(s.net_amount||0) - Number(s.total_collected||0)), 0);

  if (countEl) countEl.textContent = sales.length + (sales.length === 1 ? ' sale' : ' sales');

  el.className = 'inv-kpi-grid';
  el.style.marginBottom = '16px';
  const _salIcoTag = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  const _salIcoCash = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
  const tiles = [
    { color:'var(--primary)', icon:_salIcoTag,  val:sales.length, label:'TOTAL SALES',   sub:`${active} active` },
    { color:'var(--success)', icon:_salIcoTag,  val:active,       label:'ACTIVE',         sub:'currently open' },
    { color:'var(--info)',    icon:_salIcoCash, val:fMF(totalNet), label:'NET PORTFOLIO',  sub:'total sale value' },
    { color:totalRem>0?'var(--warn)':'var(--success)', icon:_salIcoCash, val:fMF(totalRem), label:'OUTSTANDING', sub:totalRem>0?'remaining balance':'fully collected' },
  ];
  el.innerHTML = tiles.map(t => `
    <div class="inv-kpi-tile" style="--kpi-color:${t.color}">
      <div class="inv-kpi-tile-top">
        <div class="inv-kpi-icon">${t.icon}</div>
        <span class="inv-kpi-label">${t.label}</span>
      </div>
      <div class="inv-kpi-bottom">
        <div class="inv-kpi-value" style="font-size:${t.val.toString().length>6?'18px':'22px'}">${t.val}</div>
        <div class="inv-kpi-sub">${t.sub}</div>
      </div>
    </div>`).join('');
}

function _renderSalesTable(sales) {
  const ct = document.getElementById('sal-ct');
  const pg = document.getElementById('sal-pager');
  if (!ct) return;

  if (!sales.length) {
    ct.innerHTML = `<div class="inv-empty"><span class="inv-empty-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span><p class="inv-empty-tx">No sales found</p><p class="inv-empty-sub">${_salSearch||_salStatus?'Try adjusting filters':'Record your first sale to get started'}</p></div>`;
    if (pg) pg.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(sales.length / _SAL_PER_PAGE);
  if (_salPage > totalPages) _salPage = totalPages;
  const sliced = sales.slice((_salPage - 1) * _SAL_PER_PAGE, _salPage * _SAL_PER_PAGE);
  const isAdmin = ['admin','owner'].includes(S?.role);

  ct.innerHTML = `<div class="tw">
    <table class="t" style="width:100%">
      <thead><tr>
        <th>Sale #</th>
        <th>Unit</th>
        <th>Client</th>
        <th class="hide-sm">Agent</th>
        <th class="hide-sm">Sale Date</th>
        <th>Net Amount</th>
        <th>Remaining</th>
        <th>Status</th>
        ${isAdmin ? '<th></th>' : ''}
      </tr></thead>
      <tbody>
        ${sliced.map(s => `<tr style="cursor:pointer" onclick="openSaleDetail('${s.id}')">
          <td style="font-family:monospace;font-size:11px;color:var(--brand);font-weight:700">${esc(s.sale_number||'—')}</td>
          <td style="font-weight:600">${esc(s.unit_no||'—')}<span style="font-size:10px;color:var(--t3);display:block">${esc(s.project_name||'')}</span></td>
          <td>${esc(s.client_name||'—')}</td>
          <td class="hide-sm" style="font-size:12px;color:var(--t3)">${esc(s.agent_name||'—')}</td>
          <td class="hide-sm" style="font-size:12px;color:var(--t3)">${fD(s.sale_date)}</td>
          <td style="font-weight:700">${fMF(s.net_amount)}</td>
          <td style="color:${Math.max(0,Number(s.net_amount||0)-Number(s.total_collected||0))>0?'var(--warn)':'var(--ok)'};font-weight:600">${fMF(Math.max(0,Number(s.net_amount||0)-Number(s.total_collected||0)))}</td>
          <td>${_salStatusBadge(s.status)}</td>
          ${isAdmin ? `<td onclick="event.stopPropagation()"><button class="btn btn-gh btn-xs" onclick="openSaleEdit('${s.id}')" title="Edit"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  if (pg) {
    if (totalPages <= 1) { pg.innerHTML = ''; return; }
    let html = '';
    if (_salPage > 1)          html += `<button class="inv-pg-btn" onclick="_salPage--;_renderSalesTable(_salesCache)">← Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="inv-pg-btn${i===_salPage?' on':''}" onclick="_salPage=${i};_renderSalesTable(_salesCache)">${i}</button>`;
    }
    if (_salPage < totalPages) html += `<button class="inv-pg-btn" onclick="_salPage++;_renderSalesTable(_salesCache)">Next →</button>`;
    pg.innerHTML = html;
  }
}

// ══ NEW SALE — FULL PAGE ═══════════════════════════════════════════════

// Save/restore form state across client/agent jump navigation
function _salSaveFormState() {
  window._salFormState = {
    unitId:    document.getElementById('sf-unit')?.value,
    clientId:  document.getElementById('sf-client')?.value,
    agentId:   document.getElementById('sf-agent')?.value,
    date:      document.getElementById('sf-date')?.value,
    priceSqft: document.getElementById('sf-price-sqft')?.value,
    area:      document.getElementById('sf-area')?.value,
    discount:  document.getElementById('sf-discount')?.value,
    down:      document.getElementById('sf-down')?.value,
    commPct:   document.getElementById('sf-comm-pct')?.value,
    instCount: document.getElementById('sf-inst-count')?.value,
    bkParts:   document.getElementById('sf-bk-portions')?.value,
    instType:  document.getElementById('sf-inst-type')?.value,
    schedule:  JSON.parse(JSON.stringify(_salSchedule))
  };
}
function _salJumpAdd(page, openFn) {
  _salSaveFormState();
  nav(page);
  if (openFn) setTimeout(() => { try { openFn(); } catch(e){} }, 400);
}

async function rNewSale() {
  const cid = S?.cid;
  const pg  = document.getElementById('pg-newsale');
  if (!pg) return;
  if (!cid) { nav('sales'); return; }

  _salSchedule = [];

  const availUnits = (window._unitsCache || []).filter(u => u.isAvailable !== false);
  const unitOpts = availUnits.map(u => {
    const proj = (window._projectsCache || []).find(p => p.id === u.projectId);
    const label = `${u.unitNo}${proj ? ' — ' + proj.name : ''}${u.type ? ' (' + u.type + ')' : ''}`;
    return `<option value="${u.id}" data-area="${u.area || 0}">${esc(label)}</option>`;
  }).join('');

  const clientOpts = (window._clientsCache || []).map(c =>
    `<option value="${c.id}">${esc(c.fullName || 'Unnamed')}</option>`
  ).join('');

  let agentOpts = '<option value="">— None —</option>';
  try {
    const { data } = await supabase.rpc('list_agents', { p_company_id: cid, p_search: null, p_status: 'active', p_sort: 'name' });
    _salAgents = Array.isArray(data) ? data : [];
    agentOpts += _salAgents.map(a => `<option value="${a.id}">${esc(a.full_name || '?')}</option>`).join('');
  } catch(e) { _salAgents = []; }

  const today = td();

  pg.innerHTML = `<div class="ani">

    <div style="margin-bottom:14px" class="no-p">
      <button class="bk" onclick="nav('sales')">← Back to Sales</button>
    </div>

    <!-- Form navigation bar (browse past sales) -->
    <div id="ns-form-nav"></div>

    <div class="ph" style="margin-bottom:20px">
      <div class="ph-l"><h2>New Sale</h2><p>Create a sale and payment schedule</p></div>
    </div>

    <!-- Sale Details -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01"/></svg>Sale Details</h3></div>
      <div class="cb">
        <div class="g2">
          <div class="fr">
            <label class="fl">Unit <span class="req-star">*</span></label>
            <select id="sf-unit" class="inp-light" onchange="_salOnUnitChange();_salClearErr('sf-unit')">
              <option value="">— Select Unit —</option>${unitOpts}
            </select>
            <div id="e-sf-unit" class="ferr"></div>
          </div>
          <div class="fr">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <label class="fl" style="margin:0">Client <span class="req-star">*</span></label>
              <a href="#" onclick="_salJumpAdd('clients',()=>openClientModal(null));return false"
                style="font-size:11px;color:var(--info);font-weight:500;text-decoration:none">+ Add Client</a>
            </div>
            <select id="sf-client" class="inp-light" onchange="_salClearErr('sf-client');_salCheckBlacklist(this.value)">
              <option value="">— Select Client —</option>${clientOpts}
            </select>
            <div id="e-sf-client" class="ferr"></div>
            <div id="sf-bl-warn" style="display:none;margin-top:6px;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);font-size:12px;color:#dc2626;font-weight:600"></div>
          </div>
        </div>
        <div class="g2">
          <div class="fr">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <label class="fl" style="margin:0">Agent <span style="opacity:.4">(optional)</span></label>
              <a href="#" onclick="_salJumpAdd('agents',()=>openAgentModal(null));return false"
                style="font-size:11px;color:var(--info);font-weight:500;text-decoration:none">+ Add Agent</a>
            </div>
            <select id="sf-agent" class="inp-light" onchange="_salFillAgentComm()">${agentOpts}</select>
          </div>
          <div class="fr">
            <label class="fl">Sale Date <span class="req-star">*</span></label>
            <input id="sf-date" class="inp-light" type="date" value="${today}" oninput="_salClearErr('sf-date')">
            <div id="e-sf-date" class="ferr"></div>
          </div>
        </div>
        <div class="g2">
          <div class="fr">
            <label class="fl">Agent Commission % <span style="opacity:.45;font-size:10px">(optional — on net amount)</span></label>
            <input id="sf-comm-pct" class="inp-light" type="number" min="0" max="100" step="0.01" placeholder="e.g. 2.5" oninput="_salCalcComm()">
            <div id="sf-comm-amt" style="font-size:11px;color:var(--ok);margin-top:4px"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pricing -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Pricing</h3></div>
      <div class="cb">
        <div class="g2">
          <div class="fr">
            <label class="fl">Price per Sq Ft (PKR) <span class="req-star">*</span></label>
            <input id="sf-price-sqft" class="inp-light inp-amt" type="text" inputmode="numeric" placeholder="e.g. 12000"
              oninput="_salCalc();_salClearErr('sf-price-sqft');_salClearScheduleIfExists()">
            <div id="e-sf-price-sqft" class="ferr"></div>
          </div>
          <div class="fr">
            <label class="fl">Area (Sq Ft) <span class="req-star">*</span></label>
            <input id="sf-area" class="inp-light" type="number" readonly
              style="opacity:.7;cursor:default" placeholder="Auto-filled from unit selection">
            <div style="font-size:10px;color:var(--t3);margin-top:3px">Comes from the unit record — select a unit above</div>
            <div id="e-sf-area" class="ferr"></div>
          </div>
        </div>
        <div class="g2">
          <div class="fr">
            <label class="fl">Total Amount</label>
            <input id="sf-total" class="inp-light" readonly style="opacity:.65;font-weight:700" placeholder="Auto-calculated">
          </div>
          <div class="fr">
            <label class="fl">Discount (PKR)</label>
            <input id="sf-discount" class="inp-light inp-amt" type="text" inputmode="numeric" value="0" oninput="_salCalc();_salClearScheduleIfExists()">
          </div>
        </div>
        <div class="g2">
          <div class="fr">
            <label class="fl">Net Amount</label>
            <input id="sf-net" class="inp-light" readonly style="opacity:.65;font-weight:800;color:var(--info)" placeholder="Auto-calculated">
          </div>
          <div class="fr">
            <label class="fl">Down Payment (PKR)</label>
            <input id="sf-down" class="inp-light inp-amt" type="text" inputmode="numeric" value="0"
              oninput="_salCalc();_salOnDownChange(parseAmt(this.value))">
          </div>
        </div>
        <div class="g2">
          <div class="fr">
            <label class="fl">Remaining Amount</label>
            <input id="sf-remaining" class="inp-light" readonly style="opacity:.65;font-weight:700;color:var(--warn)" placeholder="Auto-calculated">
          </div>
        </div>
      </div>
    </div>

    <!-- Payment Schedule -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Payment Schedule</h3></div>
      <div class="cb">

        <!-- Generator controls -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
          <div class="fr" style="flex:0 0 110px;margin-bottom:0">
            <label class="fl" title="Split down payment into N booking rows">Booking Portions</label>
            <input id="sf-bk-portions" class="inp-light" type="number" min="1" max="10" value="1" style="width:100%"
              onkeydown="if(event.key==='Enter')_salGenSchedule()">
          </div>
          <div class="fr" style="flex:0 0 100px;margin-bottom:0">
            <label class="fl">Installments</label>
            <input id="sf-inst-count" class="inp-light" type="number" min="1" max="360" value="12" style="width:100%"
              onkeydown="if(event.key==='Enter')_salGenSchedule()">
          </div>
          <div class="fr" style="flex:1;min-width:110px;margin-bottom:0">
            <label class="fl">Frequency</label>
            <select id="sf-inst-type" class="inp-light" style="width:100%">
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <button class="btn btn-gh btn-sm" onclick="_salGenSchedule()" style="flex-shrink:0;margin-bottom:0;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Generate</button>
          <button class="btn btn-gh btn-sm" onclick="_salAddRow()" style="flex-shrink:0;margin-bottom:0">+ Add Row</button>
          <button class="btn btn-print btn-sm" onclick="_salPrintFromForm()" style="flex-shrink:0;margin-bottom:0;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print Preview</button>
        </div>

        <!-- Schedule grid -->
        <div id="sal-schedule-wrap" style="display:none;margin-bottom:10px">
          <div class="tw">
            <table class="t" style="width:100%">
              <thead><tr>
                <th style="width:32px;text-align:center">#</th>
                <th style="width:110px">Type</th>
                <th>Label / Note</th>
                <th style="width:130px">Due Date</th>
                <th style="text-align:right;width:130px">Amount (PKR)</th>
                <th style="text-align:right;width:115px">Cumulative</th>
                <th style="width:32px"></th>
              </tr></thead>
              <tbody id="sal-grid-body"></tbody>
            </table>
          </div>
        </div>

        <!-- Balance status -->
        <div id="sal-balance-bar" style="display:none"></div>

      </div>
    </div>

    <!-- Notes -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Notes</h3></div>
      <div class="cb">
        <textarea id="sf-notes" class="inp-light" rows="3" placeholder="Any notes about this sale…" style="width:100%"></textarea>
      </div>
    </div>

    <!-- Co-buyer / Joint Owner -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Co-buyer / Joint Owner <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional)</span></h3></div>
      <div class="cb">
        <div class="g2">
          <div class="fr">
            <label class="fl">Co-buyer Full Name</label>
            <input id="sf-cobuyer-name" class="inp-light" type="text" placeholder="Full name of co-buyer / joint owner">
          </div>
          <div class="fr">
            <label class="fl">Co-buyer CNIC</label>
            <input id="sf-cobuyer-cnic" class="inp-light" type="text" inputmode="numeric" placeholder="42101-1234567-1" maxlength="15" oninput="maskCNIC(this);_salClearErr('sf-cobuyer-cnic')">
            <div id="e-sf-cobuyer-cnic" class="ferr"></div>
          </div>
        </div>
        <div class="fr" style="max-width:260px">
          <label class="fl">Co-buyer Share %</label>
          <input id="sf-cobuyer-share" class="inp-light" type="number" min="0" max="100" step="0.1" placeholder="e.g. 50">
          <div style="font-size:10px;color:var(--t3);margin-top:3px">Percentage of ownership belonging to co-buyer</div>
        </div>
      </div>
    </div>

    <!-- Nominee Information -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>Nominee Information <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional — legal heir)</span></h3></div>
      <div class="cb">
        <div class="g2">
          <div class="fr">
            <label class="fl">Nominee Full Name</label>
            <input id="sf-nominee-name" class="inp-light" type="text" placeholder="Full name of nominee">
          </div>
          <div class="fr">
            <label class="fl">Nominee CNIC</label>
            <input id="sf-nominee-cnic" class="inp-light" type="text" inputmode="numeric" placeholder="42101-1234567-1" maxlength="15" oninput="maskCNIC(this);_salClearErr('sf-nominee-cnic')">
            <div id="e-sf-nominee-cnic" class="ferr"></div>
          </div>
        </div>
        <div class="fr" style="max-width:260px">
          <label class="fl">Relation to Buyer</label>
          <input id="sf-nominee-relation" class="inp-light" type="text" placeholder="e.g. Spouse, Son, Daughter">
        </div>
      </div>
    </div>

    <!-- WHT / CVT -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>Withholding Tax / CVT <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional — FBR records only)</span></h3></div>
      <div class="cb">
        <div class="g2">
          <div class="fr">
            <label class="fl">WHT Amount (PKR)</label>
            <input id="sf-wht" class="inp-light inp-amt" type="text" inputmode="numeric" value="0" placeholder="0">
            <div style="font-size:10px;color:var(--t3);margin-top:3px">Withholding Tax — typically 1%–2% of value (FBR)</div>
          </div>
          <div class="fr">
            <label class="fl">CVT Amount (PKR)</label>
            <input id="sf-cvt" class="inp-light inp-amt" type="text" inputmode="numeric" value="0" placeholder="0">
            <div style="font-size:10px;color:var(--t3);margin-top:3px">Capital Value Tax — tracked for FBR records</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Discount Approval -->
    <div class="card mb14">
      <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Discount Approval <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional)</span></h3></div>
      <div class="cb">
        <div class="g2">
          <div class="fr">
            <label class="fl">Approved By</label>
            <input id="sf-disc-approved-by" class="inp-light" type="text" placeholder="Manager / authority name">
          </div>
          <div class="fr">
            <label class="fl">Approval Notes / Reference</label>
            <input id="sf-disc-notes" class="inp-light" type="text" placeholder="Reason, reference number, etc.">
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:24px">
      <button class="btn btn-gh" onclick="nav('sales')">Cancel</button>
      <button class="btn btn-g" id="sf-save-btn" onclick="saveSale()" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save Sale</button>
    </div>

  </div>`;

  // Restore form state if user jumped to add client/agent and came back
  if (window._salFormState) {
    const st = window._salFormState;
    window._salFormState = null;
    setTimeout(() => {
      const setV = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      setV('sf-unit',        st.unitId);    _salOnUnitChange();
      setV('sf-price-sqft',  st.priceSqft);
      setV('sf-area',        st.area);
      setV('sf-discount',    st.discount);  _salCalc();
      setV('sf-down',        st.down);
      setV('sf-date',        st.date);
      setV('sf-comm-pct',    st.commPct);
      setV('sf-inst-count',  st.instCount);
      setV('sf-bk-portions', st.bkParts);
      setV('sf-inst-type',   st.instType);
      // Restore client — rebuild opts with refreshed cache, then set value
      const clientSel = document.getElementById('sf-client');
      if (clientSel && st.clientId) {
        // Try setting saved id; if not found, it'll remain blank (new client added)
        clientSel.value = st.clientId;
        if (!clientSel.value) {
          // New client was added — try to find last added (highest index)
          clientSel.selectedIndex = clientSel.options.length - 1;
        }
      }
      // Restore agent
      const agentSel = document.getElementById('sf-agent');
      if (agentSel && st.agentId) agentSel.value = st.agentId;
      // Restore schedule
      if (st.schedule && st.schedule.length > 0) {
        _salSchedule = st.schedule;
        document.getElementById('sal-schedule-wrap').style.display = 'block';
        document.getElementById('sal-balance-bar').style.display   = 'block';
        _salRenderGrid();
        _salUpdateBalance();
      }
    }, 50);
  }

  // Mount form-nav — browse past sales without leaving the form.
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#ns-form-nav',
      entity:    'sale',
      dateField: 'sale_date',
      currentId: null,                                  // new sale — nothing loaded yet
      storageKey:'rms.fnav.sale',
      loadList: async () => {
        try {
          const { data } = await supabase.rpc('list_sales_for_fnav', { p_company_id: S.cid });
          return Array.isArray(data) ? data : [];
        } catch (e) { return []; }
      },
      openEntry: (id) => openSaleDetail(id),
      onEdit:    (id) => openSaleEdit(id),
      onDelete:  async () => {
        if (typeof toast === 'function') toast('Use Cancel Sale (Operations menu) — sales are not hard-deleted.', 'warn');
      },
      onSave:    () => saveSale(),
      onCancel:  () => nav('sales'),
      saveLabel: 'Save Sale'
    });
  }
}

// ── Field event handlers ───────────────────────────────────────────────

function _salOnUnitChange() {
  const sel = document.getElementById('sf-unit');
  const opt = sel?.options[sel.selectedIndex];
  if (!opt || !opt.value) { _salRefreshPickers(''); return; }
  const area = parseFloat(opt.getAttribute('data-area') || '0');
  const areaEl = document.getElementById('sf-area');
  if (areaEl) areaEl.value = area || '';
  if (area > 0) _salClearErr('sf-area');
  _salCalc();
  // Cross-project guard (UX): refilter client & agent pickers to the unit's project.
  // The real guard is server-side in create_sale_with_schedule.
  const unit = (window._unitsCache || []).find(u => u.id === sel.value);
  _salRefreshPickers(unit?.projectId || '');
  // If price was already entered, auto-clear the schedule so it stays in sync
  if (_salSchedule.length > 0) _salClearScheduleIfExists();
}

// Refilter the client & agent dropdowns to the unit's project. Passing '' shows none.
function _salRefreshPickers(projectId) {
  const clientSel = document.getElementById('sf-client');
  if (clientSel) {
    const cur = clientSel.value;
    const clients = (window._clientsCache || []).filter(c => !projectId || c.projectId === projectId);
    clientSel.innerHTML = '<option value="">— Select Client —</option>' +
      clients.map(c => `<option value="${c.id}"${c.id === cur ? ' selected' : ''}>${esc(c.fullName || 'Unnamed')}</option>`).join('');
    if (cur && !clients.some(c => c.id === cur)) clientSel.value = '';
  }
  const agentSel = document.getElementById('sf-agent');
  if (agentSel) {
    const cur = agentSel.value;
    const agents = (typeof _salAgents !== 'undefined' ? _salAgents : []).filter(a => !projectId || a.project_id === projectId);
    agentSel.innerHTML = '<option value="">— None —</option>' +
      agents.map(a => `<option value="${a.id}"${a.id === cur ? ' selected' : ''}>${esc(a.full_name || '?')}</option>`).join('');
    if (cur && !agents.some(a => a.id === cur)) agentSel.value = '';
  }
}

// When down payment changes, sync booking row(s) if schedule is generated
function _salOnDownChange(newDown) {
  _salUpdateBalance();
  const bkRows = _salSchedule.filter(r => r.installment_type === 'down_payment');
  if (bkRows.length === 1) {
    // Single booking row — update it directly
    bkRows[0].amount_due = newDown;
    _salRenderGrid();
    _salUpdateBalance();
  }
  // Multiple booking rows — don't auto-redistribute; user adjusts manually
}

function _salCalc() {
  const pSqft    = parseAmt(document.getElementById('sf-price-sqft')?.value);
  const area     = parseFloat(document.getElementById('sf-area')?.value)        || 0;
  const discount = parseAmt(document.getElementById('sf-discount')?.value);
  const down     = parseAmt(document.getElementById('sf-down')?.value);

  const total     = pSqft * area;
  const net       = total - discount;
  const remaining = net - down;

  const fmt = n => n > 0 ? 'PKR ' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : n === 0 ? 'PKR 0' : '—';

  const tEl = document.getElementById('sf-total');
  const nEl = document.getElementById('sf-net');
  const rEl = document.getElementById('sf-remaining');
  if (tEl) tEl.value = fmt(total);
  if (nEl) nEl.value = fmt(net);
  if (rEl) rEl.value = fmt(remaining);

  _salUpdateBalance();
  _salCalcComm();
}

// When agent changes, auto-fill commission % from agent's default (if set)
function _salFillAgentComm() {
  const agentId = document.getElementById('sf-agent')?.value;
  if (!agentId) return;
  const agent = (window._salAgents || []).find(a => a.id === agentId);
  if (!agent) return;
  const commEl = document.getElementById('sf-comm-pct');
  if (commEl && !commEl.value && agent.commission_percent != null) {
    commEl.value = agent.commission_percent;
    _salCalcComm();
  }
}

// Live commission amount estimate
function _salCalcComm() {
  const pct    = parseFloat(document.getElementById('sf-comm-pct')?.value)    || 0;
  const pSqft  = parseAmt(document.getElementById('sf-price-sqft')?.value);
  const area   = parseFloat(document.getElementById('sf-area')?.value)         || 0;
  const disc   = parseAmt(document.getElementById('sf-discount')?.value);
  const net    = Math.max(0, pSqft * area - disc);
  const amt    = document.getElementById('sf-comm-amt');
  if (amt) {
    amt.textContent = pct > 0 && net > 0
      ? `Est. commission: PKR ${Math.round(net * pct / 100).toLocaleString('en-IN')}`
      : '';
  }
}

// ── Schedule generation ─────────────────────────────────────────────────

function _salGenSchedule() {
  const count    = parseInt(document.getElementById('sf-inst-count')?.value)    || 0;
  const type     = document.getElementById('sf-inst-type')?.value               || 'monthly';
  const dateVal  = document.getElementById('sf-date')?.value                    || td();
  const down     = parseAmt(document.getElementById('sf-down')?.value);
  const bkParts  = Math.max(1, parseInt(document.getElementById('sf-bk-portions')?.value) || 1);

  const pSqft    = parseAmt(document.getElementById('sf-price-sqft')?.value);
  const area     = parseFloat(document.getElementById('sf-area')?.value)         || 0;
  const discount = parseAmt(document.getElementById('sf-discount')?.value);
  const net      = pSqft * area - discount;
  const remaining = net - down;

  if (pSqft <= 0 || area <= 0) { toast('Enter price and area first', 'warn'); return; }
  if (count < 1 || count > 360) { toast('Enter installment count (1–360)', 'warn'); return; }
  if (remaining < 0) { toast('Down payment exceeds net amount', 'warn'); return; }

  _salSchedule = [];

  const saleDate  = new Date(dateVal + 'T00:00:00');
  const monthGap  = type === 'quarterly' ? 3 : 1;
  // First installment = 1st of next month from sale date
  const firstDue  = new Date(saleDate.getFullYear(), saleDate.getMonth() + 1, 1);
  const addMonths = (d, m) => {
    const r = new Date(d.getFullYear(), d.getMonth() + m, 1);
    return r.toISOString().slice(0, 10);
  };

  // Booking rows — split down payment into bkParts portions, all on sale date
  const perBk     = down > 0 ? Math.floor(down / bkParts) : 0;
  for (let b = 1; b <= bkParts; b++) {
    const bkAmt = b === bkParts ? (down - perBk * (bkParts - 1)) : perBk;
    _salSchedule.push({
      installment_number: b,
      installment_type:   'down_payment',
      due_date:           dateVal,
      amount_due:         bkAmt,
      notes:              bkParts === 1 ? 'BOOKING' : 'Booking ' + b
    });
  }

  // Regular installments — 1st of next month, then monthly/quarterly
  const perInst   = remaining > 0 ? Math.floor(remaining / count) : 0;
  const lastExtra = remaining > 0 ? remaining - perInst * count   : 0;
  for (let i = 1; i <= count; i++) {
    const dueDate = addMonths(firstDue, (i - 1) * monthGap);
    const amount  = i === count ? perInst + lastExtra : perInst;
    _salSchedule.push({
      installment_number: bkParts + i,
      installment_type:   'installment',
      due_date:           dueDate,
      amount_due:         amount,
      notes:              _ordinal(i) + ' Installment'
    });
  }

  // ── Delivery date breach check ──────────────────────────────
  _salBreachData = null;
  _salBreachApproval = null;
  const unitId2 = document.getElementById('sf-unit')?.value;
  if (unitId2) {
    const unit = (gunits() || []).find(u => u.id === unitId2);
    if (unit?.projectId) {
      const proj = (window._projectsCache || []).find(p => p.id === unit.projectId);
      if (proj?.deliveryDate) {
        const lastInst = _salSchedule.reduce((latest, r) => {
          return !latest || r.due_date > latest ? r.due_date : latest;
        }, null);
        if (lastInst && lastInst > proj.deliveryDate) {
          const dDel  = new Date(proj.deliveryDate + 'T00:00:00');
          const dLast = new Date(lastInst + 'T00:00:00');
          const breachMonths = (dLast.getFullYear() - dDel.getFullYear()) * 12 + (dLast.getMonth() - dDel.getMonth());
          _salBreachData = { lastDueDate: lastInst, deliveryDate: proj.deliveryDate, breachMonths: Math.max(1, breachMonths) };
          _salShowBreachModal();
          return;
        }
      }
    }
  }
  // ── No breach — show schedule normally ─────────────────────
  document.getElementById('sal-schedule-wrap').style.display = 'block';
  document.getElementById('sal-balance-bar').style.display   = 'block';
  _salRenderGrid();
  _salUpdateBalance();
}

// ── Delivery breach modal ────────────────────────────────────────────────

function _salShowBreachModal() {
  const b = _salBreachData;
  const reasonTypes = ['Project Delay','Force Majeure','Client Agreement','Legal / Regulatory','Other'];
  const opts = reasonTypes.map(t => `<option value="${t}">${t}</option>`).join('');
  const html = `
<div id="m-breach" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)">
  <div style="background:var(--card);border-radius:14px;width:min(520px,96vw);box-shadow:0 24px 64px rgba(0,0,0,.45);overflow:hidden">
    <!-- Warning header -->
    <div style="background:linear-gradient(135deg,#b91c1c,#ef4444);padding:20px 24px">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="color:#fff;flex-shrink:0"><svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
        <div>
          <div style="font-weight:800;font-size:16px;color:#fff">Delivery Date Breach Detected</div>
          <div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:2px">Schedule exceeds project delivery date — approval required</div>
        </div>
      </div>
    </div>
    <!-- Stats -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--line)">
      <div style="flex:1;padding:14px 20px;text-align:center;border-right:1px solid var(--line)">
        <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase">Delivery Deadline</div>
        <div style="font-size:15px;font-weight:700;color:var(--t1);margin-top:4px">${fD(b.deliveryDate)}</div>
      </div>
      <div style="flex:1;padding:14px 20px;text-align:center;border-right:1px solid var(--line)">
        <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase">Last Installment</div>
        <div style="font-size:15px;font-weight:700;color:var(--err);margin-top:4px">${fD(b.lastDueDate)}</div>
      </div>
      <div style="flex:1;padding:14px 20px;text-align:center">
        <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase">Breach</div>
        <div style="font-size:15px;font-weight:700;color:var(--err);margin-top:4px">${b.breachMonths} month${b.breachMonths!==1?'s':''}</div>
      </div>
    </div>
    <!-- Approval form -->
    <div style="padding:20px 24px">
      <div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px">Manager Approval Required</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label class="fl">Approved By <span style="color:var(--err)">*</span></label>
          <input id="br-approved-by" class="inp-light" type="text" placeholder="Manager name" style="width:100%">
          <div id="e-br-approved-by" class="pf-err"></div>
        </div>
        <div>
          <label class="fl">Approval Reference # <span style="color:var(--err)">*</span></label>
          <input id="br-approval-ref" class="inp-light" type="text" placeholder="Ref / Auth number" style="width:100%">
          <div id="e-br-approval-ref" class="pf-err"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label class="fl">Reason Type <span style="color:var(--err)">*</span></label>
          <select id="br-reason-type" class="inp-light" style="width:100%">
            <option value="">— Select —</option>
            ${opts}
          </select>
          <div id="e-br-reason-type" class="pf-err"></div>
        </div>
        <div>
          <label class="fl">Approval Date <span style="color:var(--err)">*</span></label>
          <input id="br-approved-at" class="inp-light" type="date" value="${td()}" style="width:100%">
          <div id="e-br-approved-at" class="pf-err"></div>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label class="fl">Reason Detail <span style="color:var(--err)">*</span></label>
        <textarea id="br-reason-detail" class="inp-light" rows="2" placeholder="Explain reason for schedule breach…" style="width:100%;resize:vertical"></textarea>
        <div id="e-br-reason-detail" class="pf-err"></div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn-danger" onclick="_salCancelBreach()" style="flex:1">Cancel — Revise Schedule</button>
        <button class="btn-primary" onclick="_salSaveBreachApproval()" style="flex:1">Approve & Continue</button>
      </div>
    </div>
  </div>
</div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function _salCancelBreach() {
  document.getElementById('m-breach')?.remove();
  _salBreachData = null;
  _salBreachApproval = null;
}

function _salSaveBreachApproval() {
  const approvedBy   = document.getElementById('br-approved-by')?.value?.trim();
  const approvalRef  = document.getElementById('br-approval-ref')?.value?.trim();
  const reasonType   = document.getElementById('br-reason-type')?.value;
  const reasonDetail = document.getElementById('br-reason-detail')?.value?.trim();
  const approvedAt   = document.getElementById('br-approved-at')?.value;

  let ok = true;
  const setE = (id, msg) => {
    const el = document.getElementById(id); if (el) el.textContent = msg;
    const inp = document.getElementById(id.slice(2)); if (inp) inp.classList.toggle('inp-err', !!msg);
    if (msg) ok = false;
  };
  setE('e-br-approved-by',   approvedBy  ? '' : 'Required');
  setE('e-br-approval-ref',  approvalRef ? '' : 'Required');
  setE('e-br-reason-type',   reasonType  ? '' : 'Required');
  setE('e-br-reason-detail', reasonDetail? '' : 'Required');
  setE('e-br-approved-at',   approvedAt  ? '' : 'Required');
  if (!ok) return;

  _salBreachApproval = { approvedBy, approvalRef, reasonType, reasonDetail, approvedAt };
  document.getElementById('m-breach')?.remove();

  document.getElementById('sal-schedule-wrap').style.display = 'block';
  document.getElementById('sal-balance-bar').style.display   = 'block';
  _salRenderGrid();
  _salUpdateBalance();
  toast('Breach approved — schedule locked', 'warn');
}

function _salAddRow() {
  const dateVal = document.getElementById('sf-date')?.value || td();
  const maxNum  = _salSchedule.reduce((m, r) => Math.max(m, r.installment_number || 0), 0);
  const num     = maxNum + 1;
  _salSchedule.push({
    installment_number: num,
    installment_type:   'installment',
    due_date:           dateVal,
    amount_due:         0,
    notes:              ''
  });
  document.getElementById('sal-schedule-wrap').style.display = 'block';
  document.getElementById('sal-balance-bar').style.display   = 'block';
  _salRenderGrid();
  _salUpdateBalance();
  // Focus the amount field of the newly added row
  setTimeout(() => {
    const rows = document.querySelectorAll('#sal-grid-body tr');
    if (rows.length) rows[rows.length - 1].querySelector('input[type=number]')?.focus();
  }, 30);
}

function _salDelRow(idx) {
  _salSchedule.splice(idx, 1);
  _salRenderGrid();
  _salUpdateBalance();
}

function _salInsertRowAfter(idx) {
  const newRow = {
    installment_number: 0,
    installment_type:   'installment',
    due_date:           '',
    amount_due:         0,
    notes:              ''
  };
  _salSchedule.splice(idx + 1, 0, newRow);
  _salRenumberRows();
  _salRenderGrid();
  _salUpdateBalance();
  setTimeout(() => {
    const tbody = document.getElementById('sal-grid-body');
    // Find real rows (not insert separators) — count separator rows between real ones
    const realRows = Array.from(tbody.querySelectorAll('tr:not(.sal-ins-sep)'));
    const target   = realRows[idx + 1];
    if (target) target.querySelector('input[type=date]')?.focus();
  }, 30);
}

function _salRenumberRows() {
  let bk = 0, inst = 0;
  _salSchedule.forEach(r => {
    if (r.installment_type === 'down_payment') r.installment_number = ++bk;
    else r.installment_number = bk + (++inst);
  });
}

function _salRowChange(idx, field, val) {
  if (_salSchedule[idx]) _salSchedule[idx][field] = val;
}

// ── Schedule grid render ────────────────────────────────────────────────

function _salRenderGrid() {
  const wrap = document.getElementById('sal-grid-body');
  if (!wrap) return;

  if (!_salSchedule.length) {
    wrap.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:14px;font-size:12px">No rows — click Generate or + Add Row</td></tr>`;
    return;
  }

  const bkCount = _salSchedule.filter(r => r.installment_type === 'down_payment').length;
  let bkNum = 0, instNum = 0, running = 0;

  const insRow = (afterIdx) =>
    `<tr class="sal-ins-sep" style="height:6px;cursor:pointer"
      onmouseenter="this.firstElementChild.firstElementChild.style.opacity='1'"
      onmouseleave="this.firstElementChild.firstElementChild.style.opacity='0'"
      onclick="_salInsertRowAfter(${afterIdx})">
      <td colspan="7" style="padding:0;border:none">
        <div style="display:flex;align-items:center;gap:6px;padding:0 4px;opacity:0;transition:.15s">
          <div style="flex:1;height:1px;background:var(--brand);opacity:.5"></div>
          <span style="background:var(--brand);color:#fff;border-radius:8px;padding:1px 8px;font-size:10px;white-space:nowrap;pointer-events:none">+ Insert</span>
          <div style="flex:1;height:1px;background:var(--brand);opacity:.5"></div>
        </div>
      </td>
    </tr>`;

  const rowsHtml = _salSchedule.map((row, i) => {
    running += parseFloat(row.amount_due) || 0;
    const isBooking = row.installment_type === 'down_payment';
    if (isBooking) bkNum++; else instNum++;

    const numDisp   = isBooking ? (bkCount === 1 ? 'Bk' : 'Bk' + bkNum) : instNum;
    const rowBg     = isBooking ? 'background:rgba(201,168,76,0.10)' : '';

    const typeOpts = [
      ['down_payment', 'Booking'],
      ['installment',  'Installment'],
      ['possession',   'Possession'],
      ['custom',       'Custom'],
    ].map(([v, l]) => `<option value="${v}" ${row.installment_type === v ? 'selected' : ''}>${l}</option>`).join('');

    return insRow(i - 1) + `<tr style="${rowBg}">
      <td style="text-align:center;font-size:11px;color:var(--t3);width:32px">${numDisp}</td>
      <td style="width:110px">
        <select class="inp-light" style="width:100%;font-size:11px;padding:4px 5px"
          onchange="_salRowChange(${i},'installment_type',this.value);_salRenderGrid()">
          ${typeOpts}
        </select>
      </td>
      <td>
        <input type="text" class="inp-light" style="width:100%;font-size:12px;padding:5px 8px"
          value="${esc(row.notes || '')}"
          placeholder="${isBooking ? (bkCount === 1 ? 'BOOKING' : 'Booking ' + bkNum) : _ordinal(instNum) + ' Installment'}"
          oninput="_salRowChange(${i},'notes',this.value)"
          onkeydown="_salGridEnter(event,${i},'label')">
      </td>
      <td style="width:130px">
        <input type="date" class="inp-light" style="width:100%;font-size:11px;padding:5px 8px"
          value="${esc(row.due_date || '')}"
          onchange="_salRowChange(${i},'due_date',this.value)"
          onkeydown="_salGridEnter(event,${i},'date')">
      </td>
      <td style="width:130px">
        <input type="text" inputmode="numeric" class="inp-light inp-amt" style="width:100%;font-size:12px;padding:5px 8px;text-align:right"
          value="${row.amount_due > 0 ? Number(row.amount_due).toLocaleString('en-IN',{maximumFractionDigits:0}) : ''}"
          oninput="_salRowChange(${i},'amount_due',parseAmt(this.value));_salUpdateBalance();_salRenderCumulative()"
          onkeydown="_salGridEnter(event,${i},'amount')">
      </td>
      <td id="sal-cum-${i}" style="text-align:right;font-size:12px;font-weight:700;color:var(--info);padding-right:8px;width:115px">
        ${running > 0 ? 'PKR ' + running.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
      </td>
      <td style="width:32px;text-align:center">
        <button class="btn btn-r btn-xs" onclick="_salDelRow(${i})" title="Remove">×</button>
      </td>
    </tr>`;
  });
  // Add final insert-after-last separator
  wrap.innerHTML = rowsHtml.join('') + insRow(_salSchedule.length - 1);
}

function _salGridEnter(e, idx, field) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const realRows = Array.from(document.querySelectorAll('#sal-grid-body tr:not(.sal-ins-sep)'));
  const nextRow  = realRows[idx + 1];
  if (!nextRow) { _salAddRow(); return; }
  const target = field === 'amount'
    ? nextRow.querySelector('input[type=number]')
    : field === 'date'
      ? nextRow.querySelector('input[type=date]')
      : nextRow.querySelector('input[type=text]');
  if (target) target.focus();
}

// Live cumulative column update without full re-render (keeps user focus intact)
function _salRenderCumulative() {
  let running = 0;
  _salSchedule.forEach((row, i) => {
    running += parseFloat(row.amount_due) || 0;
    const cell = document.getElementById(`sal-cum-${i}`);
    if (cell) cell.textContent = running > 0
      ? 'PKR ' + running.toLocaleString('en-IN', { maximumFractionDigits: 0 })
      : '—';
  });
}

// ── Balance check ─────────────────────────────────────────────────────

function _salUpdateBalance() {
  const bar = document.getElementById('sal-balance-bar');
  if (!bar) return;

  const pSqft    = parseFloat(document.getElementById('sf-price-sqft')?.value) || 0;
  const area     = parseFloat(document.getElementById('sf-area')?.value)        || 0;
  const discount = parseFloat(document.getElementById('sf-discount')?.value)    || 0;
  const net      = pSqft * area - discount;

  const scheduled = _salSchedule.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const diff      = net - scheduled;
  const ok        = Math.abs(diff) < 0.01;

  bar.style.display = 'block';
  bar.innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-radius:8px;
      border:1px solid ${ok ? 'var(--ok)' : 'var(--warn)'};
      background:${ok ? 'rgba(16,185,129,.08)' : 'rgba(245,158,11,.08)'}">
      <div style="font-size:12px;color:var(--t2)">Scheduled: <strong style="color:var(--t1)">${fMF(scheduled)}</strong></div>
      <div style="font-size:12px;color:var(--t2)">Net Amount: <strong style="color:var(--t1)">${fMF(net)}</strong></div>
      <div style="font-size:12px;font-weight:700;color:${ok ? 'var(--ok)' : 'var(--err)'}">
        ${ok ? `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Balanced</span>` : (diff > 0 ? `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>Under by ${fMF(diff)}</span>` : `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>Over by ${fMF(-diff)}</span>`)}
      </div>
    </div>`;
}

// Clears the schedule if price or discount changes after generation
function _salClearScheduleIfExists() {
  if (_salSchedule.length === 0) return;
  _salSchedule = [];
  const wrap = document.getElementById('sal-schedule-wrap');
  if (wrap) wrap.style.display = 'none';
  const bar = document.getElementById('sal-balance-bar');
  if (bar) {
    bar.style.display = 'block';
    bar.innerHTML = `<div style="padding:9px 14px;border-radius:8px;border:1px solid var(--warn);background:rgba(245,158,11,.08);font-size:12px;color:var(--warn);display:flex;align-items:center;gap:6px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>Pricing changed — please click Generate to rebuild the schedule</div>`;
  }
}

// ── Print schedule ──────────────────────────────────────────────────────

function _salPrintFromForm() {
  if (!_salSchedule.length) { toast('Generate a schedule first', 'warn'); return; }

  const unitSel  = document.getElementById('sf-unit');
  const unitOpt  = unitSel?.options[unitSel?.selectedIndex];
  const cliSel   = document.getElementById('sf-client');
  const cliOpt   = cliSel?.options[cliSel?.selectedIndex];
  const pSqft    = parseFloat(document.getElementById('sf-price-sqft')?.value) || 0;
  const area     = parseFloat(document.getElementById('sf-area')?.value)        || 0;
  const discount = parseFloat(document.getElementById('sf-discount')?.value)    || 0;
  const down     = parseFloat(document.getElementById('sf-down')?.value)        || 0;
  const total    = pSqft * area;
  const net      = total - discount;
  const saleDate = document.getElementById('sf-date')?.value || '';

  const unitId  = unitOpt?.value || '';
  const unitObj = (window._unitsCache || []).find(u => u.id === unitId);
  const proj    = unitObj ? (window._projectsCache || []).find(p => p.id === unitObj?.projectId) : null;

  _salPrintSchedule({
    saleNumber:    '(DRAFT)',
    clientName:    (cliOpt && cliOpt.value) ? cliOpt.text : '—',
    unitNo:        unitObj?.unitNo || (unitOpt?.value ? unitOpt.text : '—'),
    projectName:   proj?.name || '',
    saleDate:      saleDate,
    pricePerSqft:  pSqft,
    areaSqft:      area,
    totalAmount:   total,
    discount:      discount,
    netAmount:     net,
    downPayment:   down
  }, _salSchedule);
}

function _salPrintScheduleFromDetail() {
  const d = _salCurrentDetail;
  if (!d) return;
  _salPrintSchedule({
    saleNumber:   d.sale_number,
    clientName:   d.client_name,
    unitNo:       d.unit_no,
    projectName:  d.project_name,
    saleDate:     d.sale_date,
    pricePerSqft: d.price_per_sqft,
    areaSqft:     d.area_sqft,
    totalAmount:  d.total_amount,
    discount:     d.discount,
    netAmount:    d.net_amount,
    downPayment:  d.down_payment
  }, d.installments || []);
}

function _salPrintSchedule(info, rows) {
  const fmtPKR  = n => 'PKR ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const fmtDate = s => {
    if (!s) return '—';
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const bkTotal = rows.filter(r => r.installment_type === 'down_payment' || r.installment_number === 0).length;
  let bkNum = 0, instNum = 0, runTotal = 0;
  const rowsHtml = rows.map(r => {
    runTotal += Number(r.amount_due || 0);
    const isBooking = r.installment_type === 'down_payment' || r.installment_number === 0;
    if (isBooking) bkNum++; else instNum++;
    const defaultLbl = isBooking
      ? (bkTotal === 1 ? 'BOOKING' : 'Booking ' + bkNum)
      : _ordinal(instNum) + ' Installment';
    const label   = r.notes || defaultLbl;
    const numDisp = isBooking ? (bkTotal === 1 ? 'Bk' : 'Bk' + bkNum) : instNum;
    return `<tr${isBooking ? ' style="background:#fffbeb"' : ''}>
      <td style="text-align:center">${numDisp}</td>
      <td${isBooking ? ' style="font-weight:700;color:#92400e"' : ''}>${esc(label)}</td>
      <td style="text-align:center">${fmtDate(r.due_date)}</td>
      <td style="text-align:right;font-weight:600">${fmtPKR(r.amount_due)}</td>
      <td style="text-align:right;font-weight:700">${fmtPKR(runTotal)}</td>
    </tr>`;
  }).join('');

  const installmentCount = rows.filter(r => r.installment_type !== 'down_payment' && r.installment_number !== 0).length;

  const w = _pw('Payment Schedule — ' + (info.saleNumber || ''), _pCSS('A4'));
  if (!w) return;

  let h = _lh('Installment Schedule', info.projectName);
  h += '<div class="body">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">'
     + '<div class="doc-title" style="border:none;margin:0;padding:0">Installment Payment Schedule</div>'
     + '<div style="text-align:right"><div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888">Sale No</div>'
     + '<div style="font-size:14px;font-weight:700;font-family:monospace">' + esc(info.saleNumber || 'DRAFT') + '</div></div></div>';

  h += '<div class="info-grid info-grid-2">'
     + '<div class="ig-item"><span class="ig-lbl">Client</span><span class="ig-val">' + esc(info.clientName || '—') + '</span></div>'
     + '<div class="ig-item"><span class="ig-lbl">Unit</span><span class="ig-val">' + esc(info.unitNo || '—') + (info.projectName ? ' — ' + esc(info.projectName) : '') + '</span></div>'
     + '<div class="ig-item"><span class="ig-lbl">Sale Date</span><span class="ig-val">' + fmtDate(info.saleDate) + '</span></div>'
     + '<div class="ig-item"><span class="ig-lbl">Price / Sq Ft</span><span class="ig-val">' + fmtPKR(info.pricePerSqft) + '</span></div>'
     + '<div class="ig-item"><span class="ig-lbl">Area</span><span class="ig-val">' + (info.areaSqft ? Number(info.areaSqft).toLocaleString('en-IN') + ' sq ft' : '—') + '</span></div>'
     + '<div class="ig-item"><span class="ig-lbl">Net Amount</span><span class="ig-val">' + fmtPKR(info.netAmount) + '</span></div>'
     + '</div>';

  h += '<div class="sec-title">Payment Schedule (' + installmentCount + ' installments)</div>';
  h += '<table><thead><tr>'
     + '<th style="width:44px;text-align:center">#</th><th>Installment</th>'
     + '<th style="width:90px;text-align:center">Due Date</th>'
     + '<th style="width:120px;text-align:right">Amount</th>'
     + '<th style="width:120px;text-align:right">Cumulative</th>'
     + '</tr></thead><tbody>' + rowsHtml + '</tbody>'
     + '<tfoot><tr><td colspan="3" style="font-weight:700">TOTAL</td>'
     + '<td style="text-align:right;font-weight:700">' + fmtPKR(info.netAmount) + '</td>'
     + '<td style="text-align:right;font-weight:700">' + fmtPKR(runTotal) + '</td></tr></tfoot></table>';

  h += '<div style="display:flex;justify-content:flex-end;margin-top:10px"><div style="min-width:300px">'
     + '<div class="row"><span class="lbl">Total Amount</span><span class="val">' + fmtPKR(info.totalAmount) + '</span></div>'
     + (Number(info.discount) > 0 ? '<div class="row"><span class="lbl">Discount</span><span class="val" style="color:#dc2626">− ' + fmtPKR(info.discount) + '</span></div>' : '')
     + '<div class="row"><span class="lbl">Down Payment (Booking)</span><span class="val">' + fmtPKR(info.downPayment) + '</span></div>'
     + '<div class="row"><span class="lbl">Balance After Booking</span><span class="val">' + fmtPKR(Number(info.netAmount) - Number(info.downPayment)) + '</span></div>'
     + '<div class="row"><span class="lbl" style="font-weight:700">NET AMOUNT</span><span class="val">' + fmtPKR(info.netAmount) + '</span></div>'
     + '</div></div>';

  h += '<div class="no-break">' + _sigBlock({ label: 'Client Signature', value: info.clientName || '' }) + '</div>';
  h += '</div>';

  w.document.write(h);
  _pclose(w);
}

// ── Save sale ──────────────────────────────────────────────────────────

async function saveSale() {
  const cid = S?.cid;
  if (!cid) return;

  const unitId   = document.getElementById('sf-unit')?.value;
  const clientId = document.getElementById('sf-client')?.value;
  const agentId  = document.getElementById('sf-agent')?.value || null;
  const saleDate = document.getElementById('sf-date')?.value;
  const pSqft    = parseFloat(document.getElementById('sf-price-sqft')?.value) || 0;
  const area     = parseFloat(document.getElementById('sf-area')?.value)        || 0;
  const discount = parseFloat(document.getElementById('sf-discount')?.value)    || 0;
  const down     = parseFloat(document.getElementById('sf-down')?.value)        || 0;
  const notes    = document.getElementById('sf-notes')?.value?.trim() || null;

  // ── Validation with red highlights ──
  let valid = true;
  const setErr = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('inp-err');
    const errEl = document.getElementById('e-' + id);
    if (errEl) errEl.textContent = msg;
    valid = false;
  };
  ['sf-unit','sf-client','sf-date','sf-price-sqft','sf-area','sf-cobuyer-cnic','sf-nominee-cnic'].forEach(id => _salClearErr(id));

  if (!unitId)    setErr('sf-unit',       'Please select a unit');
  if (!clientId)  setErr('sf-client',     'Please select a client');
  if (!saleDate)  setErr('sf-date',       'Please enter the sale date');
  if (pSqft <= 0) setErr('sf-price-sqft', 'Enter price per sq ft');
  if (area  <= 0) setErr('sf-area',       'Select a unit with area set in Add Unit');

  // CNIC format — optional fields, so validate only when something was entered
  const _cbCnic = document.getElementById('sf-cobuyer-cnic')?.value?.trim();
  const _nmCnic = document.getElementById('sf-nominee-cnic')?.value?.trim();
  if (_cbCnic && !isValidCNIC(_cbCnic)) setErr('sf-cobuyer-cnic', 'Format: 42101-1234567-1');
  if (_nmCnic && !isValidCNIC(_nmCnic)) setErr('sf-nominee-cnic', 'Format: 42101-1234567-1');

  if (!valid) {
    const firstErr = document.querySelector('.inp-err');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (!_salSchedule.length) {
    _salSchedErrorPopup(0, pSqft * area - discount, 'No schedule — generate or add installments first.');
    return;
  }

  // Balance check — popup if not balanced
  const net       = pSqft * area - discount;
  const scheduled = _salSchedule.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  if (Math.abs(net - scheduled) >= 1) {
    _salSchedErrorPopup(scheduled, net);
    return;
  }

  const confirmed = await _salSaveConfirmPopup();
  if (!confirmed) return;

  const saveBtn = document.getElementById('sf-save-btn');
  const origTxt = saveBtn?.textContent;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const commPct = parseFloat(document.getElementById('sf-comm-pct')?.value) || null;

    const pSale = {
      company_id:        cid,
      unit_id:           unitId,
      client_id:         clientId,
      agent_id:          agentId,
      sale_date:         saleDate,
      price_per_sqft:    pSqft,
      area_sqft:         area,
      discount:          discount,
      down_payment:      down,
      installment_count: _salSchedule.filter(r => r.installment_type !== 'down_payment').length,
      notes:             notes,
      created_by:        S.userId || null,
      commission_rate:   commPct
    };

    // RPC validates sum(ALL installments) === net_amount (booking rows now included in DB)
    const { data, error } = await supabase.rpc('create_sale_with_schedule', {
      p_sale:         pSale,
      p_installments: _salSchedule
    });

    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Unknown error');

    // Save extended fields via direct update
    const extPatch = {
      co_buyer_name:       document.getElementById('sf-cobuyer-name')?.value?.trim()   || null,
      co_buyer_cnic:       document.getElementById('sf-cobuyer-cnic')?.value?.trim()   || null,
      co_buyer_share_pct:  parseFloat(document.getElementById('sf-cobuyer-share')?.value) || null,
      nominee_name:        document.getElementById('sf-nominee-name')?.value?.trim()   || null,
      nominee_cnic:        document.getElementById('sf-nominee-cnic')?.value?.trim()   || null,
      nominee_relation:    document.getElementById('sf-nominee-relation')?.value?.trim()|| null,
      wht_amount:          parseAmt(document.getElementById('sf-wht')?.value),
      cvt_amount:          parseAmt(document.getElementById('sf-cvt')?.value),
      discount_approved_by:document.getElementById('sf-disc-approved-by')?.value?.trim()|| null,
      discount_notes:      document.getElementById('sf-disc-notes')?.value?.trim()     || null,
    };
    if (_salBreachApproval && _salBreachData) {
      extPatch.delivery_breach       = true;
      extPatch.breach_months         = _salBreachData.breachMonths;
      extPatch.breach_reason_type    = _salBreachApproval.reasonType;
      extPatch.breach_reason_detail  = _salBreachApproval.reasonDetail;
      extPatch.breach_approved_by    = _salBreachApproval.approvedBy;
      extPatch.breach_approval_ref   = _salBreachApproval.approvalRef;
      extPatch.breach_approved_at    = _salBreachApproval.approvedAt;
    }
    // Two-phase write: the sale + schedule are committed atomically by the RPC
    // above. The extended fields (co-buyer / nominee / WHT-CVT / discount &
    // breach approval) are a SECOND update. We cannot client-side roll back the
    // committed sale (no reversible delete RPC; the sale_number + unit-Sold flag
    // are already set), so if the second write fails we DON'T silently report
    // success — we tell the user the core sale exists but the extra details did
    // not save, and point them to Edit Sale to re-enter them.
    // (Proper fix = fold these fields into create_sale_with_schedule so it's one
    //  transaction — tracked with the project_id/RPC hardening.)
    let extError = '';
    const hasExt = Object.values(extPatch).some(v => v !== null && v !== 0 && v !== false);
    if (data.sale_id && hasExt) {
      const extRes = await supabase.rpc('edit_sale', { p_sale_id: data.sale_id, p_company_id: S.cid, p_data: extPatch });
      if (extRes.error || !extRes.data?.success) {
        extError = extRes.error?.message || extRes.data?.error || 'unknown error';
      }
    }

    _salSchedule = [];
    _salBreachData = null;
    _salBreachApproval = null;
    await loadUnitsCache(cid);
    await _loadSalesList();

    if (extError) {
      toast(`Sale ${data.sale_number} created — but the extra details (co-buyer / tax / approval) failed to save (${extError}). Open the sale and use Edit to re-enter them.`, 'warn');
      // Land on the new sale's detail page so the user can immediately fix it.
      if (data.sale_id) { openSaleDetail(data.sale_id); return; }
    } else {
      toast(`Sale ${data.sale_number} created`, 'ok');
    }
    nav('sales');
  } catch(e) {
    toast('Save failed: ' + e.message, 'err');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origTxt; }
  }
}

// ══ PRINT SALES LIST ══════════════════════════════════════════════════

function printSalesList() {
  const sales = _salesCache || [];
  const filters = [];
  if (_salSearch) filters.push(`Search: "${_salSearch}"`);
  if (_salStatus) filters.push(`Status: ${_salStatus}`);

  const totalNet = sales.reduce((a, s) => a + Number(s.net_amount || 0), 0);
  const totalRem = sales.reduce((a, s) => a + Math.max(0, Number(s.net_amount||0) - Number(s.total_collected||0)), 0);

  const w = _pw('Sales List — Nexunova RMS', _pCSS('A4 landscape'));
  if (!w) return;
  w.document.write(`
    ${_lh('SALES LIST')}
    <h2 style="font-size:17px;font-weight:700;margin:0 0 4px">Sales</h2>
    <p style="font-size:11px;color:#555;margin:0 0 ${filters.length ? '6' : '14'}px">
      ${sales.length} sale${sales.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Printed: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
    </p>
    ${filters.length ? `<p style="font-size:11px;color:#666;background:#f5f7fa;padding:5px 10px;border-radius:4px;margin-bottom:14px">
      Filters: ${filters.join(' &nbsp;|&nbsp; ')}
    </p>` : ''}
    <table>
      <thead><tr>
        <th>Sale #</th>
        <th>Unit</th>
        <th>Project</th>
        <th>Client</th>
        <th>Agent</th>
        <th>Sale Date</th>
        <th style="text-align:right">Net Amount</th>
        <th style="text-align:right">Remaining</th>
        <th>Status</th>
      </tr></thead>
      <tbody>
        ${sales.map(s => `<tr>
          <td style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5">${s.sale_number || '—'}</td>
          <td style="font-weight:600">${s.unit_no || '—'}</td>
          <td style="font-size:10px;color:#666">${s.project_name || '—'}</td>
          <td>${s.client_name || '—'}</td>
          <td style="font-size:10px;color:#666">${s.agent_name || '—'}</td>
          <td style="white-space:nowrap">${s.sale_date ? new Date(s.sale_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
          <td style="text-align:right;font-weight:700">PKR ${Number(s.net_amount||0).toLocaleString('en-IN')}</td>
          <td style="text-align:right;color:${Math.max(0,Number(s.net_amount||0)-Number(s.total_collected||0))>0?'#b45309':'#16a34a'};font-weight:600">PKR ${Math.max(0,Number(s.net_amount||0)-Number(s.total_collected||0)).toLocaleString('en-IN')}</td>
          <td>${s.status || '—'}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="6" style="font-weight:700;color:#1E2D47">Total: ${sales.length} sales</td>
        <td style="text-align:right;font-weight:700">PKR ${Number(totalNet).toLocaleString('en-IN')}</td>
        <td style="text-align:right;font-weight:700;color:#b45309">PKR ${Number(totalRem).toLocaleString('en-IN')}</td>
        <td></td>
      </tr></tfoot>
    </table>
  `);
  _pclose(w);
}

// ══ EXPORT SALES → EXCEL (SheetJS) ═════════════════════════════════════
// Exports the currently-loaded/filtered sales list. Amounts are raw numbers
// (so Excel can sum/sort); column headers carry the PKR unit.
function exportSalesExcel() {
  if (typeof XLSX === 'undefined') { toast('Excel library not loaded', 'warn'); return; }
  const sales = _salesCache || [];
  if (!sales.length) { toast('No sales to export', 'warn'); return; }

  const rows = sales.map(s => {
    const net  = Number(s.net_amount || 0);
    const total = Number(s.total_amount != null ? s.total_amount : net);
    const paid = Number(s.total_collected || 0);
    const rem  = Math.max(0, net - paid);
    return {
      'Sale ID':            s.sale_number || '',
      'Client Name':        s.client_name || '',
      'Unit':               s.unit_no || '',
      'Project':            s.project_name || '',
      'Sale Date':          s.sale_date || '',
      'Total Amount (PKR)': total,
      'Paid Amount (PKR)':  paid,
      'Remaining (PKR)':    rem,
      'Status':             s.status || ''
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:16},{wch:26},{wch:12},{wch:22},{wch:12},{wch:18},{wch:18},{wch:16},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  const d = (typeof td === 'function' ? td() : new Date().toISOString().slice(0,10));
  XLSX.writeFile(wb, 'Nexunova_Sales_' + d + '.xlsx');
  if (typeof toast === 'function') toast(`Exported ${rows.length} sale${rows.length !== 1 ? 's' : ''} to Excel`, 'ok');
}

// ══ SALE DETAIL PAGE ══════════════════════════════════════════════════

function openSaleDetail(id) { _salId = id; nav('salesdetail'); }

async function rSaleDetail() {
  const pg = document.getElementById('pg-salesdetail');
  if (!pg) return;
  if (!_salId) { nav('sales'); return; }

  pg.innerHTML = `<div class="ani"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;opacity:.4"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/></svg></div><div class="et">Loading sale…</div></div></div>`;

  try {
    const [detailRes, docsAmendsRes] = await Promise.all([
      supabase.rpc('get_sale_detail', { p_sale_id: _salId, p_company_id: S.cid }),
      supabase.rpc('get_sale_documents_amendments', { p_sale_id: _salId, p_company_id: S.cid })
    ]);
    if (detailRes.error) throw detailRes.error;
    if (!detailRes.data || !detailRes.data.success) throw new Error(detailRes.data?.error || 'Sale not found');

    const d = { ...detailRes.data.sale, installments: detailRes.data.installments || [] };
    const docs = docsAmendsRes.data?.documents || [];
    const amendments = docsAmendsRes.data?.amendments || [];
    _renderSaleDetail(d, docs, amendments);
  } catch(e) {
    pg.innerHTML = `<div class="ani">
      <div style="margin-bottom:12px"><button class="bk" onclick="nav('sales')">← Back to Sales</button></div>
      <div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load</div><div class="es">${esc(e.message)}</div></div></div>
    </div>`;
  }
}

function _renderSaleDetail(d, docs, amendments) {
  docs = docs || [];
  amendments = amendments || [];
  const rawInst = Array.isArray(d.installments) ? d.installments : [];
  _salCurrentDetail = d;
  const pg  = document.getElementById('pg-salesdetail');
  const isA = S.role === 'admin' || S.role === 'owner';
  const inst = Array.isArray(d.installments) ? d.installments : [];

  const totalPaid = rawInst.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  const recovPct  = Number(d.net_amount) > 0 ? Math.min(100, Math.round(totalPaid / Number(d.net_amount) * 100)) : 0;
  const row = (l, v) => v ? `<div class="ir"><span class="ir-l">${l}</span><span class="ir-r">${v}</span></div>` : '';
  const today = td();

  // ── Schedule rows ──
  let runTotal = 0;
  const pendingInstOpts = rawInst
    .filter(r => r.installment_number > 0 && r.status !== 'paid')
    .map(r => {
      const idx = inst.findIndex(x => x.installment_number === r.installment_number && !x._isSynth);
      return `<option value="${inst.indexOf(r)}">${_ordinal(r.installment_number)} Installment · PKR ${fM(r.amount_due)} · Due ${fD(r.due_date)}</option>`;
    }).join('');

  const instRows = inst.map((ins, idx) => {
    runTotal += Number(ins.amount_due || 0);
    const isOverdue     = ins.status !== 'paid' && ins.due_date < today;
    const displayStatus = isOverdue && ins.status === 'pending' ? 'overdue' : ins.status;
    const isBooking     = ins.installment_type === 'down_payment' || ins.installment_number === 0;
    const instN         = Number(ins.installment_number || 0);
    const demandBtn     = !isBooking && ins.status !== 'paid'
      ? `<button class="btn btn-gh btn-xs" onclick="printDemandNotice(${idx})" title="Print Demand Notice"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>` : '';
    const editBtn = isA && ins.id
      ? `<button class="btn btn-gh btn-xs" onclick="openInstEditModal('${ins.id}')" title="Edit installment"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
    return `<tr${isBooking ? ' class="bk-row"' : ''}>
      <td style="font-size:12px;color:var(--t3);text-align:center">${isBooking ? '—' : instN}</td>
      <td style="font-size:12px;font-weight:${isBooking?'700':'400'};color:${isBooking?'var(--brand)':'var(--t1)'}">${esc(ins.notes||(isBooking?'BOOKING':_ordinal(instN)+' Installment'))}</td>
      <td style="font-size:12px">${fD(ins.due_date)}</td>
      <td style="font-weight:700;text-align:right">${fMF(ins.amount_due)}</td>
      <td style="color:var(--ok);text-align:right">${ins.amount_paid > 0 ? fMF(ins.amount_paid) : '—'}</td>
      <td style="text-align:right;font-size:11px;color:var(--info)">${fMF(runTotal)}</td>
      <td>${_instStatusBadge(displayStatus)}</td>
      <td style="padding:4px 6px;white-space:nowrap">${demandBtn}${editBtn}</td>
    </tr>`;
  }).join('');

  // ── Amendment type labels ──
  const aTypeLbl = t => ({price_change:'Price Change',schedule_change:'Schedule Change',discount_change:'Discount Change',agent_change:'Agent Change',other:'Other'}[t]||t||'—');

  // ── Documents HTML ──
  const docsHtml = docs.length === 0
    ? `<div style="font-size:12px;color:var(--t3);padding:8px 0">No documents uploaded yet.</div>`
    : docs.map(doc => {
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.document_url);
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
          <span style="color:var(--t3)">${isImg?`<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`:`<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(doc.document_name)}</div>
            <div style="font-size:10px;color:var(--t3)">${esc(doc.document_type)} · ${fD(doc.uploaded_at?.slice(0,10))}</div>
          </div>
          <a href="${esc(doc.document_url)}" target="_blank" class="btn btn-gh btn-xs">View</a>
          ${isA?`<button class="btn btn-r btn-xs" onclick="deleteSaleDoc('${doc.id}')" title="Delete"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>`:''}
        </div>`;
      }).join('');

  // ── Amendments HTML ──
  const amendsHtml = amendments.length === 0
    ? `<div class="empty" style="padding:20px"><div class="ei"><svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div class="et">No amendments recorded</div></div>`
    : `<div class="tw"><table class="t"><thead><tr>
        <th>Type</th><th>Description</th><th>Reason</th><th>By</th><th>Date</th><th></th>
       </tr></thead><tbody>
       ${amendments.map(a => `<tr>
         <td style="font-size:11px;font-weight:600;white-space:nowrap">${aTypeLbl(a.amendment_type)}</td>
         <td style="font-size:12px">${esc(a.description||'—')}</td>
         <td style="font-size:11px;color:var(--t3)">${esc(a.reason||'—')}</td>
         <td style="font-size:11px;color:var(--t3);white-space:nowrap">${esc(a.amended_by||'—')}</td>
         <td style="font-size:11px;color:var(--t3);white-space:nowrap">${fD(a.amended_at?.slice(0,10))}</td>
         <td>${isA?`<button class="btn btn-r btn-xs" onclick="deleteSaleAmendment('${a.id}')" title="Delete"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>`:''}</td>
       </tr>`).join('')}
       </tbody></table></div>`;

  pg.innerHTML = `<div class="ani">
    <!-- Form navigation bar -->
    <div id="sd-form-nav"></div>

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" class="no-p">
      <button class="bk" onclick="nav('sales')">← Back</button>
      <button class="btn btn-print btn-sm" onclick="printSaleDetail()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
      <button class="btn btn-sm" onclick="openAgreementReport('${d.id}')" style="background:rgba(30,45,71,.08);color:#1e2d47;border:1px solid rgba(30,45,71,.2);display:inline-flex;align-items:center;gap:5px" title="A4 Sale Agreement"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Agreement</button>
      <button class="btn btn-sm" onclick="openScheduleReport('${d.id}')" style="background:rgba(30,45,71,.08);color:#1e2d47;border:1px solid rgba(30,45,71,.2);display:inline-flex;align-items:center;gap:5px" title="A4 Installment Schedule"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Schedule</button>
      <button class="btn btn-sm" onclick="openDemandNotice('${d.id}')" style="background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.2);display:inline-flex;align-items:center;gap:5px" title="A4 Demand Notice"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Demand</button>
      ${isA ? `<button class="btn btn-gh btn-sm" onclick="openSaleEdit('${d.id}')" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>` : ''}
      ${isA && typeof openAuditHistory==='function' ? `<button class="btn btn-gh btn-sm" onclick="openAuditHistory('sales','${d.id}','Sale History: ${esc(d.sale_number||'')}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg> History</button>` : ''}
      ${d.status !== 'cancelled' && typeof plOpenCreate === 'function' ? `<button class="btn btn-sm" style="background:rgba(34,197,94,.12);color:#16a34a;border:1px solid rgba(34,197,94,.3);display:inline-flex;align-items:center;gap:5px" onclick="plOpenCreate(null,'${d.client_id}','${d.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Payment Link</button>` : ''}
    </div>

    ${d.status === 'cancelled' ? `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;margin-bottom:14px">
      <span style="color:var(--err);flex-shrink:0"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></span>
      <div>
        <div style="font-weight:700;color:var(--err)">Sale Cancelled${d.cancellation_date?' — '+fD(d.cancellation_date):''}</div>
        ${d.cancellation_reason?`<div style="font-size:12px;color:var(--t2);margin-top:2px">${esc(d.cancellation_reason)}</div>`:''}
        ${d.cancelled_by?`<div style="font-size:11px;color:var(--t3)">Cancelled by: ${esc(d.cancelled_by)}</div>`:''}
      </div>
    </div>` : ''}

    ${d.delivery_breach ? `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;background:rgba(185,28,28,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;margin-bottom:14px">
      <span style="color:#ef4444;flex-shrink:0"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
      <div style="flex:1">
        <div style="font-weight:700;color:#ef4444;margin-bottom:6px">Delivery Date Breach — Approved</div>
        <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:11px;color:var(--t2)">
          ${d.breach_months?`<span><strong style="color:var(--t1)">Breach:</strong> ${d.breach_months} month${d.breach_months!==1?'s':''}</span>`:''}
          ${d.breach_reason_type?`<span><strong style="color:var(--t1)">Type:</strong> ${esc(d.breach_reason_type)}</span>`:''}
          ${d.breach_approved_by?`<span><strong style="color:var(--t1)">Approved By:</strong> ${esc(d.breach_approved_by)}</span>`:''}
          ${d.breach_approval_ref?`<span><strong style="color:var(--t1)">Ref #:</strong> ${esc(d.breach_approval_ref)}</span>`:''}
          ${d.breach_approved_at?`<span><strong style="color:var(--t1)">Date:</strong> ${fD(d.breach_approved_at)}</span>`:''}
        </div>
        ${d.breach_reason_detail?`<div style="font-size:11px;color:var(--t3);margin-top:4px">${esc(d.breach_reason_detail)}</div>`:''}
      </div>
    </div>` : ''}

    <!-- Hero -->
    <div class="card mb14"><div class="cb">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-family:monospace;font-size:11px;color:var(--brand);font-weight:700;margin-bottom:4px">${esc(d.sale_number||'—')}</div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
            <h2 style="font-size:20px;font-weight:700">${esc(d.client_name||'Unknown Client')}</h2>
            ${_salStatusBadge(d.status)}
            ${d.delivery_breach?`<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(185,28,28,.15);color:#ef4444;border:1px solid rgba(239,68,68,.4);display:inline-flex;align-items:center;gap:4px"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>BREACH APPROVED</span>`:''}
          </div>
          <div style="font-size:12px;color:var(--t3)">Unit: <strong style="color:var(--t1)">${esc(d.unit_no||'—')}</strong>${d.project_name?' · '+esc(d.project_name):''}</div>
          ${d.agent_name?`<div style="font-size:12px;color:var(--t3);margin-top:2px">Agent: <strong style="color:var(--t1)">${esc(d.agent_name)}</strong></div>`:''}
          ${d.co_buyer_name?`<div style="font-size:12px;color:var(--t3);margin-top:2px">Co-buyer: <strong style="color:var(--t1)">${esc(d.co_buyer_name)}</strong></div>`:''}
        </div>
        <div style="font-size:11px;color:var(--t3)">Sale Date<br><strong style="color:var(--t1);font-size:14px">${fD(d.sale_date)}</strong></div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
        <div style="font-size:11px;color:var(--t3)">Total<br><span style="font-size:15px;font-weight:700;color:var(--t1)">${fMF(d.total_amount)}</span></div>
        <div style="font-size:11px;color:var(--t3)">Discount<br><span style="font-size:15px;font-weight:700;color:var(--err)">${d.discount>0?'- '+fMF(d.discount):'—'}</span></div>
        <div style="font-size:11px;color:var(--t3)">Net<br><span style="font-size:15px;font-weight:700;color:var(--info)">${fMF(d.net_amount)}</span></div>
        <div style="font-size:11px;color:var(--t3)">Down Pmt<br><span style="font-size:15px;font-weight:700;color:var(--ok)">${fMF(d.down_payment)}</span></div>
        <div style="font-size:11px;color:var(--t3)">Remaining<br><span style="font-size:15px;font-weight:700;color:${(Number(d.net_amount)-totalPaid)>0?'var(--warn)':'var(--ok)'}">${fMF(Number(d.net_amount)-totalPaid)}</span></div>
        <div style="font-size:11px;color:var(--t3)">Collected<br><span style="font-size:15px;font-weight:700;color:var(--ok)">${fMF(totalPaid)}</span></div>
        ${Number(d.wht_amount)>0?`<div style="font-size:11px;color:var(--t3)">WHT<br><span style="font-size:13px;font-weight:700;color:var(--t2)">${fMF(d.wht_amount)}</span></div>`:''}
        ${Number(d.cvt_amount)>0?`<div style="font-size:11px;color:var(--t3)">CVT<br><span style="font-size:13px;font-weight:700;color:var(--t2)">${fMF(d.cvt_amount)}</span></div>`:''}
      </div>
      <div style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-bottom:4px"><span>Recovery Progress</span><span>${recovPct}%</span></div>
        <div class="pbar" style="width:100%;height:6px"><div class="pbar-f" style="width:${recovPct}%"></div></div>
      </div>
    </div></div>

    <div class="cd">
      <!-- Left column -->
      <div style="display:flex;flex-direction:column;gap:14px">

        <div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Sale Info</h3></div>
          <div class="cb">
            ${row('Sale Number',`<span style="font-family:monospace;color:var(--brand)">${esc(d.sale_number)}</span>`)}
            ${row('Sale Date', fD(d.sale_date))}
            ${row('Price / Sq Ft', fMF(d.price_per_sqft))}
            ${row('Area', d.area_sqft ? fM(d.area_sqft)+' sq ft' : null)}
            ${row('Discount', d.discount>0 ? fMF(d.discount) : null)}
            ${d.discount>0&&d.discount_approved_by ? row('Disc. Approved By', esc(d.discount_approved_by)) : ''}
            ${d.discount>0&&d.discount_notes ? row('Disc. Notes', esc(d.discount_notes)) : ''}
            ${row('Installments', d.installment_count ? d.installment_count+' installments' : null)}
            ${row('Notes', d.notes ? esc(d.notes) : null)}
          </div>
        </div>

        ${(d.co_buyer_name||d.nominee_name) ? `<div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Co-buyer &amp; Nominee</h3></div>
          <div class="cb">
            ${d.co_buyer_name ? `
              <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Co-buyer / Joint Owner</div>
              ${row('Name', esc(d.co_buyer_name))}
              ${row('CNIC', d.co_buyer_cnic?`<span style="font-family:monospace">${esc(d.co_buyer_cnic)}</span>`:null)}
              ${row('Share', d.co_buyer_share_pct ? d.co_buyer_share_pct+'%' : null)}
            ` : ''}
            ${d.co_buyer_name&&d.nominee_name ? `<div style="margin:10px 0;border-top:1px solid var(--line)"></div>` : ''}
            ${d.nominee_name ? `
              <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Nominee (Legal Heir)</div>
              ${row('Name', esc(d.nominee_name))}
              ${row('CNIC', d.nominee_cnic?`<span style="font-family:monospace">${esc(d.nominee_cnic)}</span>`:null)}
              ${row('Relation', d.nominee_relation ? esc(d.nominee_relation) : null)}
            ` : ''}
          </div>
        </div>` : ''}

        ${(Number(d.wht_amount)>0||Number(d.cvt_amount)>0) ? `<div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>WHT / CVT</h3></div>
          <div class="cb">
            ${row('Withholding Tax (WHT)', fMF(d.wht_amount))}
            ${row('Capital Value Tax (CVT)', fMF(d.cvt_amount))}
            ${row('Total Tax', fMF(Number(d.wht_amount||0)+Number(d.cvt_amount||0)))}
          </div>
        </div>` : ''}

        <div class="card">
          <div class="ch"><div><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Documents</h3><p>${docs.length} file${docs.length!==1?'s':''}</p></div></div>
          <div class="cb">
            ${docsHtml}
            ${isA ? `<div style="margin-top:12px">
              <label style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--hover);border:2px dashed var(--line);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;color:var(--t2);transition:border-color .15s" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='var(--line)'">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.47"/></svg> Attach Document
                <input type="file" accept="image/jpeg,image/png,application/pdf" style="display:none" onchange="uploadSaleDoc(this,'${d.id}')">
              </label>
            </div>` : ''}
          </div>
        </div>

      </div>

      <!-- Right column -->
      <div style="display:flex;flex-direction:column;gap:14px">

        ${isA ? `<div class="card">
          <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>Operations</h3></div>
          <div style="display:flex;flex-direction:column">

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div><div style="font-size:13px;font-weight:600;color:var(--t1)">Allotment Letter</div><div style="font-size:11px;color:var(--t3);margin-top:2px">Formal letter confirming unit allotment</div></div>
              <button class="btn btn-print btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="printAllotmentLetter()"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
            </div>

            <div style="padding:12px 16px;border-bottom:1px solid var(--line)">
              <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:8px;display:flex;align-items:center;gap:6px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>Demand Notice</div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <select id="sd-demand-inst" class="inp-light" style="flex:1;min-width:140px;font-size:12px;padding:7px 10px">
                  ${pendingInstOpts || `<option value="">— No pending installments —</option>`}
                </select>
                <button class="btn btn-print btn-sm" style="flex-shrink:0" onclick="printDemandNotice()">Print</button>
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div><div style="font-size:13px;font-weight:600;color:var(--t1)">Possession Letter</div><div style="font-size:11px;color:var(--t3);margin-top:2px">Unit handover document</div></div>
              <button class="btn btn-print btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="printPossessionLetter()"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div><div style="font-size:13px;font-weight:600;color:var(--t1)">Payment Schedule</div><div style="font-size:11px;color:var(--t3);margin-top:2px">Full installment schedule</div></div>
              <button class="btn btn-print btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="_salPrintScheduleFromDetail()"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div><div style="font-size:13px;font-weight:600;color:var(--t1)">Payment Statement</div><div style="font-size:11px;color:var(--t3);margin-top:2px">Outstanding balance view</div></div>
              <button class="btn btn-print btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="_salPrintPaymentStatement()"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)">
              <div><div style="font-size:13px;font-weight:600;color:var(--t1)">Log Amendment</div><div style="font-size:11px;color:var(--t3);margin-top:2px">Record a price or schedule change</div></div>
              <button class="btn btn-gh btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="openSaleAmendmentModal('${d.id}')"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Log</button>
            </div>

            ${d.status !== 'cancelled' ? `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px">
              <div><div style="font-size:13px;font-weight:600;color:var(--err)">Cancel Sale</div><div style="font-size:11px;color:var(--t3);margin-top:2px">Mark as cancelled — requires reason</div></div>
              <button class="btn btn-r btn-sm" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px" onclick="openCancelSaleModal('${d.id}')"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Cancel</button>
            </div>` : `<div style="padding:12px 16px;font-size:12px;color:var(--t3);font-style:italic">This sale has been cancelled.</div>`}

          </div>
        </div>` : ''}

        <div class="card">
          <div class="ch"><h3><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Payment Schedule</h3><span style="font-size:11px;color:var(--t3)">${inst.length} row${inst.length!==1?'s':''}</span><button class="btn btn-print btn-xs" style="margin-left:auto;display:inline-flex;align-items:center;gap:4px" onclick="_salPrintScheduleFromDetail()"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button></div>
          <div class="cb" style="padding:0">
            ${inst.length ? `<div class="tw" style="max-height:420px;overflow-y:auto">
              <table class="t" style="width:100%">
                <thead><tr>
                  <th style="width:32px">#</th><th>Installment</th><th>Due Date</th>
                  <th style="text-align:right">Amount</th><th style="text-align:right">Paid</th>
                  <th style="text-align:right">Cumulative</th><th>Status</th><th style="width:38px"></th>
                </tr></thead>
                <tbody>${instRows}</tbody>
              </table>
            </div>` : `<div class="empty" style="padding:24px"><div class="et">No installments</div></div>`}
          </div>
        </div>

        <div class="card">
          <div class="ch"><div><h3><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Amendment History</h3><p>${amendments.length} record${amendments.length!==1?'s':''}</p></div></div>
          ${amendsHtml}
        </div>

      </div>
    </div>
  </div>`;

  // Mount the reusable form-nav bar at the top.
  // Source list: all active sales for this company (light projection — id + date).
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#sd-form-nav',
      entity:    'sale',
      dateField: 'sale_date',
      currentId: d.id,
      storageKey:'rms.fnav.sale',
      loadList: async () => {
        try {
          const { data } = await supabase.rpc('list_sales_for_fnav', { p_company_id: S.cid });
          return Array.isArray(data) ? data : [];
        } catch (e) { console.error('[fnav sale]', e); return []; }
      },
      openEntry: (id) => openSaleDetail(id),
      onEdit:    (id) => isA && openSaleEdit(id),
      onDelete:  async () => {
        if (typeof toast === 'function') toast('Use Cancel Sale (Operations menu) — sales are not hard-deleted.', 'warn');
      }
    });
  }
}

// ── Print payment statement (outstanding view) from sale detail ───
function _salPrintPaymentStatement() {
  const d = _salCurrentDetail;
  if (!d) { toast('No sale loaded', 'warn'); return; }

  const rawInst  = Array.isArray(d.installments) ? d.installments : [];
  const dpRow    = rawInst.find(r => r.installment_type === 'down_payment' || r.installment_number === 0);
  const instRows = rawInst.filter(r => Number(r.installment_number) > 0);

  const dpDue   = dpRow ? Number(dpRow.amount_due  || 0) : Number(d.down_payment || 0);
  const dpPaid  = dpRow ? Number(dpRow.amount_paid || 0) : 0;
  const dpOut   = Math.max(0, dpDue - dpPaid);
  const dpStat  = dpRow?.status || (dpPaid >= dpDue && dpDue > 0 ? 'paid' : 'pending');

  const data = {
    sale: {
      sale_number:   d.sale_number,
      client_name:   d.client_name,
      agent_name:    d.agent_name,
      unit_no:       d.unit_no,
      floor_label:   d.floor_label,
      unit_type:     d.unit_type,
      project_name:  d.project_name,
      area_sqft:     d.area_sqft,
      price_per_sqft:d.price_per_sqft,
      net_amount:    d.net_amount,
      sale_date:     d.sale_date,
      down_payment:  d.down_payment,
    },
    down_payment: {
      amount_due:  dpDue,
      amount_paid: dpPaid,
      outstanding: dpOut,
      status:      dpStat,
    },
    installments: instRows.map(r => ({
      installment_number: r.installment_number,
      installment_type:   r.installment_type || 'installment',
      notes:              r.notes,
      due_date:           r.due_date,
      amount_due:         Number(r.amount_due  || 0),
      amount_paid:        Number(r.amount_paid || 0),
      outstanding:        Math.max(0, Number(r.amount_due || 0) - Number(r.amount_paid || 0)),
      status:             r.status || 'pending',
    }))
  };

  printPaymentStatement(data);
}

// ══ EDIT SALE — FULL PAGE ══════════════════════════════════════════════

function openSaleEdit(id) { _salEditId = id; nav('editsale'); }

async function rEditSale() {
  const pg = document.getElementById('pg-editsale');
  if (!pg) return;
  if (!_salEditId) { nav('sales'); return; }

  pg.innerHTML = `<div class="ani"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;opacity:.4"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/></svg></div><div class="et">Loading sale…</div></div></div>`;

  try {
    // Fetch sale + full installment data + agents
    const [editRes, agentRes] = await Promise.all([
      supabase.rpc('get_sale_for_edit', { p_sale_id: _salEditId, p_company_id: S.cid }),
      supabase.rpc('list_agents', { p_company_id: S.cid, p_search: null, p_status: 'active', p_sort: 'name' }),
    ]);

    if (editRes.error) throw editRes.error;
    if (!editRes.data?.success) throw new Error(editRes.data?.error || 'Sale not found');
    const d = editRes.data.sale;
    const instData = editRes.data.installments || [];
    const totalPaid = instData.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    window._salEditAgents = Array.isArray(agentRes.data) ? agentRes.data : [];
    window._salEditSchedule = instData.map(i => ({ ...i, _new: false, _deleted: false }));
    window._salEditNetAmount    = Number(d.net_amount    || 0);
    window._salEditOrigDiscount = Number(d.discount      || 0);
    window._salEditOrigPriceSqft= Number(d.price_per_sqft|| 0);
    window._salEditOrigArea     = Number(d.area_sqft     || 0);

    const clientOpts = (window._clientsCache || []).map(c =>
      `<option value="${c.id}" ${c.id === d.client_id ? 'selected' : ''}>${esc(c.fullName || 'Unnamed')}</option>`
    ).join('');
    const agentOpts = (window._salEditAgents).map(a =>
      `<option value="${a.id}" ${a.id === d.agent_id ? 'selected' : ''}>${esc(a.full_name || '?')}</option>`
    ).join('');

    // Unit label from units cache
    const unitRec = (window._unitsCache || []).find(u => u.id === d.unit_id);
    const projRec = unitRec ? (window._projectsCache || []).find(p => p.id === unitRec.projectId) : null;
    const unitLabel = unitRec
      ? `${unitRec.unitNo}${projRec ? ' — ' + projRec.name : ''}${unitRec.type ? ' (' + unitRec.type + ')' : ''}`
      : d.unit_id;

    const fmtV = n => Number(n || 0);

    pg.innerHTML = `<div class="ani">
      <div style="margin-bottom:14px" class="no-p">
        <button class="bk" onclick="nav('salesdetail')">← Back to Sale</button>
      </div>

      <!-- Form navigation bar (browse other sales) -->
      <div id="es-form-nav"></div>

      <div class="ph" style="margin-bottom:20px">
        <div class="ph-l"><h2>Edit Sale</h2><p style="font-family:monospace;font-size:12px">${esc(d.sale_number || '')}</p></div>
      </div>

      <!-- Sale Details -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01"/></svg>Sale Details</h3></div>
        <div class="cb">
          <div class="g2">
            <div class="fr">
              <label class="fl">Unit</label>
              <input class="inp-light" type="text" value="${esc(unitLabel)}" readonly style="opacity:.7;cursor:default">
              <div style="font-size:10px;color:var(--t3);margin-top:3px">Unit cannot be changed after sale</div>
            </div>
            <div class="fr">
              <label class="fl">Client <span class="req-star">*</span></label>
              <select id="ef-client" class="inp-light">
                <option value="">— Select Client —</option>${clientOpts}
              </select>
              <div id="e-ef-client" class="ferr"></div>
            </div>
          </div>
          <div class="g2">
            <div class="fr">
              <label class="fl">Agent <span style="opacity:.4">(optional)</span></label>
              <select id="ef-agent" class="inp-light">
                <option value="">— None —</option>${agentOpts}
              </select>
            </div>
            <div class="fr">
              <label class="fl">Sale Date <span class="req-star">*</span></label>
              <input id="ef-date" class="inp-light" type="date" value="${d.sale_date || ''}">
              <div id="e-ef-date" class="ferr"></div>
            </div>
          </div>
          <div class="g2">
            <div class="fr">
              <label class="fl">Agent Commission % <span style="opacity:.45;font-size:10px">(optional — on net amount)</span></label>
              <input id="ef-comm-pct" class="inp-light" type="number" min="0" max="100" step="0.01" placeholder="e.g. 2.5" value="${d.commission_rate != null ? fmtV(d.commission_rate) : ''}">
              <div id="ef-comm-amt" style="font-size:11px;color:var(--ok);margin-top:4px">${d.commission_rate ? 'Est. commission: PKR ' + Math.round(Number(d.net_amount||0)*Number(d.commission_rate)/100).toLocaleString('en-IN') : ''}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pricing -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Pricing</h3></div>
        <div class="cb">
          <div class="g2">
            <div class="fr">
              <label class="fl">Price per Sq Ft (PKR) <span class="req-star">*</span></label>
              <input id="ef-price-sqft" class="inp-light inp-amt" type="text" inputmode="numeric"
                value="${Number(d.price_per_sqft||0).toLocaleString('en-IN',{maximumFractionDigits:0})}" oninput="_salEditCalc()">
              <div id="e-ef-price-sqft" class="ferr"></div>
            </div>
            <div class="fr">
              <label class="fl">Area (Sq Ft)</label>
              <input id="ef-area" class="inp-light" type="number" readonly
                style="opacity:.7;cursor:default" value="${fmtV(d.area_sqft)}">
              <div style="font-size:10px;color:var(--t3);margin-top:3px">Fixed to the unit record</div>
            </div>
          </div>
          <div class="g2">
            <div class="fr">
              <label class="fl">Total Amount</label>
              <input id="ef-total" class="inp-light" readonly style="opacity:.65;font-weight:700" value="${fmtV(d.total_amount)}">
            </div>
            <div class="fr">
              <label class="fl">Discount (PKR)</label>
              <input id="ef-discount" class="inp-light inp-amt" type="text" inputmode="numeric"
                value="${Number(d.discount||0).toLocaleString('en-IN',{maximumFractionDigits:0})}" oninput="_salEditCalc()">
            </div>
          </div>
          <div class="g2">
            <div class="fr">
              <label class="fl">Net Amount</label>
              <input id="ef-net" class="inp-light" readonly style="opacity:.65;font-weight:800;color:var(--info)" value="${fmtV(d.net_amount)}">
            </div>
            <div class="fr">
              <label class="fl">Down Payment (PKR)</label>
              <input id="ef-down" class="inp-light inp-amt" type="text" inputmode="numeric"
                value="${Number(d.down_payment||0).toLocaleString('en-IN',{maximumFractionDigits:0})}" oninput="_salEditCalc()">
            </div>
          </div>
          <div class="g2">
            <div class="fr">
              <label class="fl">Already Collected</label>
              <input class="inp-light" readonly style="opacity:.65;color:var(--ok)" value="PKR ${Number(totalPaid).toLocaleString('en-IN',{maximumFractionDigits:0})}">
              <div style="font-size:10px;color:var(--t3);margin-top:3px">Sum of all payments received — not editable here</div>
            </div>
            <div class="fr">
              <label class="fl">Remaining (calculated)</label>
              <input id="ef-remaining" class="inp-light" readonly style="opacity:.65;font-weight:700;color:var(--warn)" value="${fmtV(Number(d.net_amount)-totalPaid)}">
            </div>
          </div>
          <input type="hidden" id="ef-total-paid" value="${totalPaid}">
        </div>
      </div>

      <!-- Payment Schedule -->
      <div class="card mb14">
        <div class="ch">
          <h3><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Payment Schedule</h3>
          <div style="display:flex;gap:8px;margin-left:auto">
            <button class="btn btn-gh btn-sm" onclick="_salEditAddRow()">+ Add Row</button>
          </div>
        </div>
        <div class="cb" style="padding:0">
          <div class="tw">
            <table class="t" style="width:100%">
              <thead><tr>
                <th style="width:32px;text-align:center">#</th>
                <th style="width:130px">Type</th>
                <th style="width:140px">Due Date</th>
                <th style="text-align:right;width:150px">Amount (PKR)</th>
                <th>Note / Label</th>
                <th style="width:64px"></th>
              </tr></thead>
              <tbody id="ef-grid-body"></tbody>
            </table>
          </div>
          <div id="ef-balance-bar" style="padding:10px 14px;font-size:12px;border-top:1px solid var(--line)"></div>
        </div>
      </div>

      <!-- Notes -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Notes</h3></div>
        <div class="cb">
          <textarea id="ef-notes" class="inp-light" rows="3" style="width:100%">${esc(d.notes || '')}</textarea>
        </div>
      </div>

      <!-- Co-buyer -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Co-buyer / Joint Owner <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional)</span></h3></div>
        <div class="cb">
          <div class="g2">
            <div class="fr">
              <label class="fl">Co-buyer Full Name</label>
              <input id="ef-cobuyer-name" class="inp-light" type="text" value="${esc(d.co_buyer_name || '')}">
            </div>
            <div class="fr">
              <label class="fl">Co-buyer CNIC</label>
              <input id="ef-cobuyer-cnic" class="inp-light" type="text" inputmode="numeric" placeholder="42101-1234567-1" maxlength="15" value="${esc(d.co_buyer_cnic || '')}" oninput="maskCNIC(this);_salClearErr('ef-cobuyer-cnic')">
              <div id="e-ef-cobuyer-cnic" class="ferr"></div>
            </div>
          </div>
          <div class="fr" style="max-width:260px">
            <label class="fl">Co-buyer Share %</label>
            <input id="ef-cobuyer-share" class="inp-light" type="number" min="0" max="100" step="0.1" value="${fmtV(d.co_buyer_share_pct) || ''}">
          </div>
        </div>
      </div>

      <!-- Nominee -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>Nominee Information <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional)</span></h3></div>
        <div class="cb">
          <div class="g2">
            <div class="fr">
              <label class="fl">Nominee Full Name</label>
              <input id="ef-nominee-name" class="inp-light" type="text" value="${esc(d.nominee_name || '')}">
            </div>
            <div class="fr">
              <label class="fl">Nominee CNIC</label>
              <input id="ef-nominee-cnic" class="inp-light" type="text" inputmode="numeric" placeholder="42101-1234567-1" maxlength="15" value="${esc(d.nominee_cnic || '')}" oninput="maskCNIC(this);_salClearErr('ef-nominee-cnic')">
              <div id="e-ef-nominee-cnic" class="ferr"></div>
            </div>
          </div>
          <div class="fr" style="max-width:260px">
            <label class="fl">Relation to Buyer</label>
            <input id="ef-nominee-relation" class="inp-light" type="text" value="${esc(d.nominee_relation || '')}">
          </div>
        </div>
      </div>

      <!-- WHT / CVT -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>Withholding Tax / CVT <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional)</span></h3></div>
        <div class="cb">
          <div class="g2">
            <div class="fr">
              <label class="fl">WHT Amount (PKR)</label>
              <input id="ef-wht" class="inp-light inp-amt" type="text" inputmode="numeric" value="${Number(d.wht_amount||0).toLocaleString('en-IN',{maximumFractionDigits:0})}">
            </div>
            <div class="fr">
              <label class="fl">CVT Amount (PKR)</label>
              <input id="ef-cvt" class="inp-light inp-amt" type="text" inputmode="numeric" value="${Number(d.cvt_amount||0).toLocaleString('en-IN',{maximumFractionDigits:0})}">
            </div>
          </div>
        </div>
      </div>

      <!-- Discount Approval -->
      <div class="card mb14">
        <div class="ch"><h3><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Discount Approval <span style="font-size:11px;font-weight:400;color:var(--t3);text-transform:none">(optional)</span></h3></div>
        <div class="cb">
          <div class="g2">
            <div class="fr">
              <label class="fl">Approved By</label>
              <input id="ef-disc-approved-by" class="inp-light" type="text" value="${esc(d.discount_approved_by || '')}">
            </div>
            <div class="fr">
              <label class="fl">Approval Notes / Reference</label>
              <input id="ef-disc-notes" class="inp-light" type="text" value="${esc(d.discount_notes || '')}">
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:24px">
        <div id="ef-err" class="ferr" style="flex:1;align-self:center"></div>
        <button class="btn btn-gh" onclick="nav('salesdetail')">Cancel</button>
        <button class="btn btn-g" id="ef-save-btn" onclick="saveEditSale()" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save Changes</button>
      </div>
    </div>`;

    _salEditRenderGrid();

    // Mount form-nav — browse other sales without leaving Edit
    if (typeof mountFormNav === 'function') {
      mountFormNav({
        targetSel: '#es-form-nav',
        entity:    'sale',
        dateField: 'sale_date',
        currentId: d.id,
        storageKey:'rms.fnav.sale',
        loadList: async () => {
          try {
            const { data } = await supabase.rpc('list_sales_for_fnav', { p_company_id: S.cid });
            return Array.isArray(data) ? data : [];
          } catch (e) { return []; }
        },
        openEntry: (id) => openSaleEdit(id),
        onEdit:    (id) => openSaleEdit(id),
        onDelete:  async () => {
          if (typeof toast === 'function') toast('Use Cancel Sale flow — sales are not hard-deleted.', 'warn');
        },
        onSave:    () => saveEditSale(),
        onCancel:  () => nav('salesdetail'),
        saveLabel: 'Update Sale'
      });
    }

  } catch(e) {
    pg.innerHTML = `<div class="ani">
      <div style="margin-bottom:12px"><button class="bk" onclick="nav('salesdetail')">← Back</button></div>
      <div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load</div><div class="es">${esc(e.message)}</div></div></div>
    </div>`;
  }
}

function _salEditCalc() {
  const pSqft    = parseAmt(document.getElementById('ef-price-sqft')?.value);
  const area     = parseFloat(document.getElementById('ef-area')?.value)        || 0;
  const discount = parseAmt(document.getElementById('ef-discount')?.value);
  const down     = parseAmt(document.getElementById('ef-down')?.value);
  const paid     = parseFloat(document.getElementById('ef-total-paid')?.value)  || 0;

  const total     = pSqft * area;
  const net       = Math.max(0, total - discount);
  const remaining = Math.max(0, net - paid);

  const fmt = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const tEl = document.getElementById('ef-total');
  const nEl = document.getElementById('ef-net');
  const rEl = document.getElementById('ef-remaining');
  if (tEl) tEl.value = fmt(total);
  if (nEl) nEl.value = fmt(net);
  if (rEl) rEl.value = fmt(remaining);

  window._salEditNetAmount = net;
  _salEditUpdateBalance();
}

function _salEditRenderGrid() {
  const tbody = document.getElementById('ef-grid-body');
  if (!tbody) return;
  const schedule = window._salEditSchedule || [];
  const visible  = schedule.map((r, origIdx) => ({ ...r, origIdx })).filter(r => !r._deleted);

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:16px;font-size:12px">No installments. Click + Add Row to create.</td></tr>`;
    _salEditUpdateBalance();
    return;
  }

  tbody.innerHTML = visible.map(r => {
    const isPaid  = Number(r.amount_paid || 0) > 0;
    const oi      = r.origIdx;
    const typeOpts = ['installment','down_payment','possession','custom'].map(v =>
      `<option value="${v}" ${r.installment_type === v ? 'selected' : ''}>${v === 'down_payment' ? 'Down Payment' : v.charAt(0).toUpperCase() + v.slice(1)}</option>`
    ).join('');
    return `<tr>
      <td style="text-align:center;font-size:11px;color:var(--t3)">${r.installment_number || '—'}</td>
      <td>
        <select class="inp-light" style="padding:5px 8px;font-size:12px;width:100%" onchange="_salEditField(${oi},'installment_type',this.value)">
          ${typeOpts}
        </select>
      </td>
      <td><input type="date" class="inp-light" style="padding:5px 8px;font-size:12px;width:100%" value="${r.due_date || ''}" onchange="_salEditField(${oi},'due_date',this.value)" onkeydown="_salEditGridEnter(event,${oi},'date')"></td>
      <td><input type="text" inputmode="numeric" class="inp-light inp-amt" style="padding:5px 8px;font-size:12px;width:100%;text-align:right" value="${Number(r.amount_due||0) > 0 ? Number(r.amount_due).toLocaleString('en-IN',{maximumFractionDigits:0}) : 0}" oninput="_salEditField(${oi},'amount_due',parseAmt(this.value));_salEditUpdateBalance()" onkeydown="_salEditGridEnter(event,${oi},'amount')"></td>
      <td><input type="text" class="inp-light" style="padding:5px 8px;font-size:12px;width:100%" value="${esc(r.notes || '')}" onchange="_salEditField(${oi},'notes',this.value)" onkeydown="_salEditGridEnter(event,${oi},'label')"></td>
      <td style="text-align:center">
        ${isPaid
          ? `<span style="font-size:10px;color:var(--ok);white-space:nowrap">Paid</span>`
          : `<button class="btn btn-r btn-xs" onclick="_salEditRemoveRow(${oi})" title="Remove"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`}
      </td>
    </tr>`;
  }).join('');

  _salEditUpdateBalance();
}

function _salEditUpdateBalance() {
  const bar = document.getElementById('ef-balance-bar');
  if (!bar) return;
  const schedule = window._salEditSchedule || [];
  const instSum  = schedule.filter(r => !r._deleted).reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const net      = window._salEditNetAmount || 0;
  const diff     = instSum - net;
  const fmtPKR   = n => 'PKR ' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  if (net === 0) { bar.innerHTML = ''; return; }

  const ok    = Math.abs(diff) < 1;
  const color = ok ? 'var(--ok)' : diff > 0 ? 'var(--err)' : 'var(--warn)';
  const msg   = ok
    ? 'Schedule matches net amount'
    : diff > 0
      ? `▲ Over by ${fmtPKR(diff)} — reduce installment amounts`
      : `▼ Short by ${fmtPKR(diff)} — add more installments or increase amounts`;

  bar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span style="color:${color};font-weight:600">${msg}</span>
    <span style="color:var(--t3);font-size:11px">Schedule total: ${fmtPKR(instSum)} &nbsp;|&nbsp; Net amount: ${fmtPKR(net)}</span>
  </div>`;
}

function _salEditField(origIdx, field, value) {
  if (!window._salEditSchedule) return;
  window._salEditSchedule[origIdx][field] = field === 'amount_due' ? parseAmt(value) : value;
}

function _salEditGridEnter(e, origIdx, field) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const visible = (window._salEditSchedule || []).map((r, i) => ({ ...r, origIdx: i })).filter(r => !r._deleted);
  const curPos  = visible.findIndex(r => r.origIdx === origIdx);
  const next    = visible[curPos + 1];
  if (!next) {
    // Last visible row — add a new one
    _salEditAddRow();
    return;
  }
  const tbody = document.getElementById('ef-grid-body');
  const rows  = tbody?.querySelectorAll('tr');
  if (!rows?.[curPos + 1]) return;
  const target = field === 'amount'
    ? rows[curPos + 1].querySelector('input[type=number]')
    : field === 'date'
      ? rows[curPos + 1].querySelector('input[type=date]')
      : rows[curPos + 1].querySelector('input[type=text]');
  if (target) target.focus();
}

function _salEditAddRow() {
  if (!window._salEditSchedule) window._salEditSchedule = [];
  const existing = window._salEditSchedule.filter(r => !r._deleted);
  const maxNum   = existing.reduce((m, r) => Math.max(m, Number(r.installment_number || 0)), 0);
  window._salEditSchedule.push({
    id: null, installment_number: maxNum + 1, installment_type: 'installment',
    due_date: '', amount_due: 0, amount_paid: 0, notes: '', status: 'pending',
    _new: true, _deleted: false,
  });
  _salEditRenderGrid();
}

function _salEditRemoveRow(origIdx) {
  if (!window._salEditSchedule) return;
  const row = window._salEditSchedule[origIdx];
  if (!row) return;
  if (row._new) {
    window._salEditSchedule.splice(origIdx, 1);
  } else {
    row._deleted = true;
  }
  _salEditRenderGrid();
}

async function saveEditSale() {
  const clientId = document.getElementById('ef-client').value;
  const saleDate = document.getElementById('ef-date').value;
  const pSqft    = parseAmt(document.getElementById('ef-price-sqft').value);
  const area     = parseFloat(document.getElementById('ef-area').value)       || 0;
  const discount = parseAmt(document.getElementById('ef-discount').value);
  const down     = parseAmt(document.getElementById('ef-down').value);
  const paid     = parseFloat(document.getElementById('ef-total-paid').value) || 0;
  const err      = document.getElementById('ef-err');
  const btn      = document.getElementById('ef-save-btn');

  err.textContent = '';

  if (!clientId) { document.getElementById('e-ef-client').textContent = 'Client is required.'; err.textContent = 'Please fix the errors above.'; return; }
  if (!saleDate) { document.getElementById('e-ef-date').textContent   = 'Sale date is required.'; err.textContent = 'Please fix the errors above.'; return; }
  if (pSqft <= 0){ document.getElementById('e-ef-price-sqft').textContent = 'Price per sq ft is required.'; err.textContent = 'Please fix the errors above.'; return; }

  // CNIC format — optional fields, validate only when entered
  const _efCb = document.getElementById('ef-cobuyer-cnic').value.trim();
  const _efNm = document.getElementById('ef-nominee-cnic').value.trim();
  document.getElementById('e-ef-cobuyer-cnic').textContent = '';
  document.getElementById('e-ef-nominee-cnic').textContent = '';
  if (_efCb && !isValidCNIC(_efCb)) { document.getElementById('e-ef-cobuyer-cnic').textContent = 'Format: 42101-1234567-1'; err.textContent = 'Please fix the errors above.'; return; }
  if (_efNm && !isValidCNIC(_efNm)) { document.getElementById('e-ef-nominee-cnic').textContent = 'Format: 42101-1234567-1'; err.textContent = 'Please fix the errors above.'; return; }

  // Generated columns (total_amount, net_amount, remaining_amount) are computed by DB —
  // only include the source fields: price_per_sqft, area_sqft, discount, down_payment
  const net      = Math.max(0, pSqft * area - discount);
  const schedule = window._salEditSchedule || [];
  const instSum  = schedule.filter(r => !r._deleted).reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);

  if (schedule.length > 0 && Math.abs(instSum - net) >= 1) {
    _salSchedErrorPopup(instSum, net);
    return;
  }

  const confirmed = await _salSaveConfirmPopup();
  if (!confirmed) return;

  // ── Approval gates: detect discount / price-revision changes ──────────
  const origDiscount  = window._salEditOrigDiscount  || 0;
  const origPriceSqft = window._salEditOrigPriceSqft || 0;
  const origArea      = window._salEditOrigArea      || 0;
  const origNet       = window._salEditNetAmount     || 0;
  const newNet        = Math.max(0, pSqft * area - discount);

  const discountChanged   = Math.abs(discount - origDiscount)   >= 1;
  const priceAreaChanged  = (Math.abs(pSqft - origPriceSqft)    >= 0.01 ||
                             Math.abs(area  - origArea)          >= 0.01) && !discountChanged;

  if (discountChanged || priceAreaChanged) {
    const gateType = discountChanged ? 'discount' : 'price_revision';
    const gateTitle = discountChanged
      ? `Discount change requires approval`
      : `Price revision requires approval`;
    const gateDetail = discountChanged
      ? `Discount: PKR ${fM(origDiscount)} → PKR ${fM(discount)}`
      : `Net amount: PKR ${fM(origNet)} → PKR ${fM(newNet)}`;

    const comment = await _salMakerCommentPrompt(gateTitle, gateDetail);
    if (comment === null) return; // user cancelled

    btn.disabled = true; btn.textContent = 'Submitting…';

    let pendingApproval = false;

    if (discountChanged) {
      const { data: dr, error: de } = await supabase.rpc('request_discount_change', {
        p_sale_id:       _salEditId,
        p_new_discount:  discount,
        p_maker_comment: comment
      });
      if (de || !dr?.success) {
        btn.disabled = false; btn.textContent = 'Save Changes';
        err.textContent = de?.message || dr?.error || 'Approval request failed'; return;
      }
      if (dr.status === 'pending_approval') pendingApproval = true;
    } else {
      // Price revision — create approval request directly
      const { data: pr, error: pe } = await supabase.rpc('create_approval_request', {
        p_data: {
          request_type: 'price_revision',
          entity_table: 'sales',
          entity_id:    _salEditId,
          title:        'Price revision',
          amount:       newNet,
          comment:      comment,
          payload:      { net_amount: newNet, price_per_sqft: pSqft, area_sqft: area }
        }
      });
      if (pe || !pr?.success) {
        btn.disabled = false; btn.textContent = 'Save Changes';
        err.textContent = pe?.message || pr?.error || 'Approval request failed'; return;
      }
      pendingApproval = true; // price revision is always pending (no admin-bypass path)
    }

    // Build non-gated payload — exclude the fields routed to approval
    const efCommPct2 = parseFloat(document.getElementById('ef-comm-pct')?.value);
    const safePayload = {
      client_id:            clientId,
      agent_id:             document.getElementById('ef-agent').value || null,
      sale_date:            saleDate,
      // discount excluded (handled by request_discount_change above)
      down_payment:         down,
      commission_rate:      isNaN(efCommPct2) ? null : efCommPct2,
      notes:                document.getElementById('ef-notes').value.trim()              || null,
      co_buyer_name:        document.getElementById('ef-cobuyer-name').value.trim()       || null,
      co_buyer_cnic:        document.getElementById('ef-cobuyer-cnic').value.trim()       || null,
      co_buyer_share_pct:   parseFloat(document.getElementById('ef-cobuyer-share').value) || null,
      nominee_name:         document.getElementById('ef-nominee-name').value.trim()       || null,
      nominee_cnic:         document.getElementById('ef-nominee-cnic').value.trim()       || null,
      nominee_relation:     document.getElementById('ef-nominee-relation').value.trim()   || null,
      wht_amount:           parseAmt(document.getElementById('ef-wht').value),
      cvt_amount:           parseAmt(document.getElementById('ef-cvt').value),
      discount_approved_by: document.getElementById('ef-disc-approved-by').value.trim()  || null,
      discount_notes:       document.getElementById('ef-disc-notes').value.trim()         || null,
    };
    if (!priceAreaChanged) {
      // Safe to include price fields if only discount was gated
      safePayload.price_per_sqft = pSqft;
    }
    // price_per_sqft excluded if priceAreaChanged (pending revision approval)

    const safeRes = await supabase.rpc('edit_sale', {
      p_sale_id: _salEditId, p_company_id: S.cid, p_data: safePayload
    });
    if (safeRes.error || !safeRes.data?.success) {
      btn.disabled = false; btn.textContent = 'Save Changes';
      err.textContent = safeRes.error?.message || safeRes.data?.error || 'Save failed'; return;
    }

    btn.disabled = false; btn.textContent = 'Save Changes';
    if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
    toast(pendingApproval
      ? 'Approval request submitted — other fields saved'
      : 'Sale updated (change applied — within policy)', 'ok');
    nav('salesdetail');
    return;
  }

  // ── Normal save (no approval gates triggered) ─────────────────────────
  const efCommPct = parseFloat(document.getElementById('ef-comm-pct')?.value);
  const payload = {
    client_id:            clientId,
    agent_id:             document.getElementById('ef-agent').value || null,
    sale_date:            saleDate,
    price_per_sqft:       pSqft,
    discount:             discount,
    down_payment:         down,
    commission_rate:      isNaN(efCommPct) ? null : efCommPct,
    notes:                document.getElementById('ef-notes').value.trim()              || null,
    co_buyer_name:        document.getElementById('ef-cobuyer-name').value.trim()       || null,
    co_buyer_cnic:        document.getElementById('ef-cobuyer-cnic').value.trim()       || null,
    co_buyer_share_pct:   parseFloat(document.getElementById('ef-cobuyer-share').value) || null,
    nominee_name:         document.getElementById('ef-nominee-name').value.trim()       || null,
    nominee_cnic:         document.getElementById('ef-nominee-cnic').value.trim()       || null,
    nominee_relation:     document.getElementById('ef-nominee-relation').value.trim()   || null,
    wht_amount:           parseAmt(document.getElementById('ef-wht').value),
    cvt_amount:           parseAmt(document.getElementById('ef-cvt').value),
    discount_approved_by: document.getElementById('ef-disc-approved-by').value.trim()  || null,
    discount_notes:       document.getElementById('ef-disc-notes').value.trim()         || null,
  };

  btn.disabled    = true;
  btn.textContent = 'Saving…';

  const saleRes = await supabase.rpc('edit_sale', {
    p_sale_id: _salEditId, p_company_id: S.cid, p_data: payload
  });

  if (saleRes.error || !saleRes.data?.success) {
    btn.disabled    = false;
    btn.textContent = 'Save Changes';
    err.textContent = saleRes.error?.message || saleRes.data?.error || 'Save failed';
    return;
  }

  // Sync installments via single RPC call
  const instRes = await supabase.rpc('edit_installment_schedule', {
    p_sale_id: _salEditId, p_company_id: S.cid, p_schedule: schedule
  });

  btn.disabled    = false;
  btn.textContent = 'Save Changes';

  if (instRes.error || !instRes.data?.success) {
    const errs = instRes.data?.errors || [instRes.error?.message || 'unknown error'];
    err.textContent = 'Sale saved but some installments failed: ' + errs.join('; ');
    return;
  }

  toast('Sale updated');
  nav('salesdetail');
}

// ── Maker-comment prompt for approval-gated actions ───────────────────
// Returns the comment string (min 10 chars) or null if cancelled.
function _salMakerCommentPrompt(title, detail) {
  return new Promise(resolve => {
    document.getElementById('_sal-comment-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = '_sal-comment-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = `
      <div style="background:var(--surface,#0f172a);border:1px solid rgba(99,102,241,.3);border-radius:14px;padding:28px 24px 20px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.6)">
        <div style="font-size:16px;font-weight:700;color:var(--text,#f8fafc);margin-bottom:6px">${esc(title)}</div>
        <div style="font-size:12px;color:var(--t3,rgba(255,255,255,.45));margin-bottom:16px">${esc(detail)}</div>
        <div style="font-size:11px;font-weight:600;color:var(--t2,rgba(255,255,255,.6));margin-bottom:6px">Reason / Justification <span style="color:var(--err,#f43f5e)">*</span></div>
        <textarea id="_sal-cm-txt" rows="3" autocomplete="off"
          placeholder="Explain why this change is needed (min 10 characters)…"
          style="width:100%;padding:9px 11px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.12);border-radius:8px;color:var(--text,#f1f5f9);font-size:13px;font-family:inherit;box-sizing:border-box;resize:vertical;outline:none"
          onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='rgba(255,255,255,.12)'"></textarea>
        <div id="_sal-cm-err" style="font-size:11px;color:var(--err,#f43f5e);min-height:16px;margin-top:4px"></div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button id="_sal-cm-cancel" style="flex:1;padding:9px;background:transparent;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;color:var(--t2,rgba(255,255,255,.6));font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>
          <button id="_sal-cm-ok" style="flex:2;padding:9px;background:#6366f1;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Submit for Approval</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const txt = ov.querySelector('#_sal-cm-txt');
    const errEl = ov.querySelector('#_sal-cm-err');
    setTimeout(() => txt?.focus(), 50);

    ov.querySelector('#_sal-cm-cancel').addEventListener('click', () => { ov.remove(); resolve(null); });
    ov.querySelector('#_sal-cm-ok').addEventListener('click', () => {
      const v = (txt?.value || '').trim();
      if (v.length < 10) { errEl.textContent = 'Please enter at least 10 characters.'; txt?.focus(); return; }
      ov.remove();
      resolve(v);
    });
    txt?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) ov.querySelector('#_sal-cm-ok').click(); });
  });
}

// ══ SCHEDULE / SAVE POPUPS ═════════════════════════════════════════════

function _salSchedErrorPopup(instSum, net, customMsg) {
  document.getElementById('_sal-err-overlay')?.remove();
  const fmtPKR = n => 'PKR ' + Math.abs(Number(n)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const diff   = instSum - net;
  const detail = customMsg || (
    diff > 0
      ? `Schedule total is <strong>${fmtPKR(diff)} over</strong> the net amount.<br>Reduce installment amounts by ${fmtPKR(diff)}.`
      : `Schedule total is <strong>${fmtPKR(diff)} short</strong> of the net amount.<br>Add ${fmtPKR(diff)} more to the schedule.`
  );
  const msg = customMsg || `Schedule: <strong>${fmtPKR(instSum)}</strong> &nbsp;≠&nbsp; Net: <strong>${fmtPKR(net)}</strong>`;

  const el = document.createElement('div');
  el.id = '_sal-err-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  el.innerHTML = `
    <div style="background:var(--bg,#fff);border:2px solid #dc2626;border-radius:16px;padding:32px 28px;max-width:460px;width:100%;text-align:center;box-shadow:0 12px 48px rgba(220,38,38,.25)">
      <div style="margin-bottom:10px"><svg width="40" height="40" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>
      <div style="font-size:17px;font-weight:700;color:#dc2626;margin-bottom:8px">Schedule Not Balanced</div>
      <div style="font-size:13px;color:#666;margin-bottom:6px">${msg}</div>
      <div style="font-size:12px;color:#444;margin-bottom:22px;line-height:1.6">${detail}</div>
      <button onclick="document.getElementById('_sal-err-overlay').remove()"
        style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;cursor:pointer">
        ✕ Close &amp; Adjust Schedule
      </button>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  const _errKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { el.remove(); document.removeEventListener('keydown', _errKey); } };
  document.addEventListener('keydown', _errKey);
}

function _salSaveConfirmPopup() {
  document.getElementById('_sal-confirm-overlay')?.remove();
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.id = '_sal-confirm-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    el.innerHTML = `
      <div style="background:var(--bg,#fff);border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:32px 28px;max-width:380px;width:100%;text-align:center;box-shadow:0 12px 48px rgba(0,0,0,.2)">
        <div style="margin-bottom:10px"><svg width="36" height="36" fill="none" stroke="var(--t2,#444)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></div>
        <div style="font-size:16px;font-weight:700;color:var(--t1,#111);margin-bottom:8px">Save Changes?</div>
        <div style="font-size:12px;color:var(--t3,#888);margin-bottom:24px">This will update the sale record and all schedule changes in the database.</div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button id="_sal-confirm-no"
            style="background:transparent;border:1px solid var(--line,#ccc);border-radius:8px;padding:9px 22px;font-size:13px;font-weight:500;cursor:pointer;color:var(--t2,#444)">
            Cancel
          </button>
          <button id="_sal-confirm-yes"
            style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:9px 22px;font-size:13px;font-weight:600;cursor:pointer">
            Save
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);
    const close = (val) => { el.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
    document.getElementById('_sal-confirm-yes').onclick = () => close(true);
    document.getElementById('_sal-confirm-no').onclick  = () => close(false);
    el.addEventListener('click', e => { if (e.target === el) close(false); });
    document.addEventListener('keydown', onKey);
  });
}

// ══ CANCEL SALE ════════════════════════════════════════════════════════

function openCancelSaleModal(saleId) {
  document.getElementById('cs-sale-id').value       = saleId;
  document.getElementById('cs-reason').value        = '';
  document.getElementById('cs-by').value            = '';
  document.getElementById('cs-err').textContent     = '';
  document.getElementById('e-cs-reason').textContent = '';
  om('m-cancel-sale');
}

async function saveCancelSale() {
  const saleId = document.getElementById('cs-sale-id').value;
  const reason = document.getElementById('cs-reason').value.trim();
  const by     = document.getElementById('cs-by').value.trim();
  const err    = document.getElementById('cs-err');
  const btn    = document.getElementById('cs-save-btn');

  document.getElementById('e-cs-reason').textContent = '';
  err.textContent = '';

  if (!reason) {
    document.getElementById('e-cs-reason').textContent = 'Reason is required';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Cancelling…';

  const res = await supabase.rpc('edit_sale', {
    p_sale_id: saleId, p_company_id: S.cid, p_data: {
      status:              'cancelled',
      cancellation_reason: reason,
      cancellation_date:   td(),
      cancelled_by:        by || null,
    }
  });

  btn.disabled    = false;
  btn.textContent = 'Confirm Cancellation';

  if (res.error || !res.data?.success) { err.textContent = res.error?.message || res.data?.error || 'Cancel failed'; return; }
  cm('m-cancel-sale');
  toast('Sale cancelled');
  rSaleDetail();
}

// ══ SALE AMENDMENTS ════════════════════════════════════════════════════

function openSaleAmendmentModal(saleId) {
  document.getElementById('sa-sale-id').value       = saleId;
  document.getElementById('sa-type').value          = 'price_change';
  document.getElementById('sa-by').value            = '';
  document.getElementById('sa-desc').value          = '';
  document.getElementById('sa-reason').value        = '';
  document.getElementById('sa-err').textContent     = '';
  document.getElementById('e-sa-desc').textContent  = '';
  om('m-sale-amendment');
}

async function saveSaleAmendment() {
  const saleId = document.getElementById('sa-sale-id').value;
  const type   = document.getElementById('sa-type').value;
  const by     = document.getElementById('sa-by').value.trim();
  const desc   = document.getElementById('sa-desc').value.trim();
  const reason = document.getElementById('sa-reason').value.trim();
  const err    = document.getElementById('sa-err');
  const btn    = document.getElementById('sa-save-btn');

  document.getElementById('e-sa-desc').textContent = '';
  err.textContent = '';

  if (!desc) { document.getElementById('e-sa-desc').textContent = 'Description is required'; return; }

  btn.disabled    = true;
  btn.textContent = 'Saving…';

  const res = await supabase.rpc('add_sale_amendment', {
    p_company_id:    S.cid,
    p_sale_id:       saleId,
    p_amendment_type: type,
    p_description:   desc,
    p_reason:        reason || null,
    p_amended_by:    by || null,
  });

  btn.disabled    = false;
  btn.textContent = 'Save Amendment';

  if (res.error || !res.data?.success) { err.textContent = res.error?.message || res.data?.error || 'Save failed'; return; }
  cm('m-sale-amendment');
  toast('Amendment logged');
  rSaleDetail();
}

async function deleteSaleAmendment(id) {
  if (!confirm('Delete this amendment record?')) return;
  const res = await supabase.rpc('delete_sale_amendment', { p_id: id, p_company_id: S.cid });
  if (res.error || !res.data?.success) { toast(res.error?.message || res.data?.error || 'Delete failed', 'err'); return; }
  toast('Amendment deleted');
  rSaleDetail();
}

// ══ SALE DOCUMENTS ═════════════════════════════════════════════════════

async function uploadSaleDoc(input, saleId) {
  const file = input.files?.[0];
  if (!file) return;

  const docType = window.prompt('Document label (e.g. CNIC, Agreement, Payment Proof):', 'Sale Document');
  if (docType === null) { input.value = ''; return; }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path     = `${S.cid}/sales/${saleId}/${Date.now()}_${safeName}`;
  input.disabled = true;

  const { error: upErr } = await supabase.storage.from('rms-documents').upload(path, file, { upsert: false });
  if (upErr) {
    toast('Upload failed: ' + upErr.message, 'err');
    input.disabled = false;
    input.value    = '';
    return;
  }

  const { data: { publicUrl } } = supabase.storage.from('rms-documents').getPublicUrl(path);

  const res = await supabase.rpc('upload_sale_document', {
    p_company_id:    S.cid,
    p_sale_id:       saleId,
    p_document_type: docType.trim() || 'Sale Document',
    p_document_name: file.name,
    p_document_url:  publicUrl,
    p_uploaded_by:   S.uid || null,
  });

  input.disabled = false;
  input.value    = '';

  if (res.error || !res.data?.success) { toast('DB error: ' + (res.error?.message || res.data?.error || 'unknown'), 'err'); return; }
  toast('Document uploaded');
  rSaleDetail();
}

async function deleteSaleDoc(id) {
  if (!confirm('Remove this document?')) return;
  const res = await supabase.rpc('delete_sale_document', { p_id: id, p_company_id: S.cid });
  if (res.error || !res.data?.success) { toast(res.error?.message || res.data?.error || 'Delete failed', 'err'); return; }
  toast('Document removed');
  rSaleDetail();
}

// ══ PRINT: ALLOTMENT LETTER ════════════════════════════════════════════

function printAllotmentLetter() {
  const d = _salCurrentDetail;
  if (!d) { toast('No sale loaded', 'warn'); return; }
  const fmtPKR   = n => 'PKR ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const saleDate = d.sale_date ? new Date(d.sale_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const coName   = (window._cobranding || {}).company_name || S?.coName || 'Company';

  const w = _pw('Allotment Letter — ' + (d.sale_number || ''), _pCSS('A4'));
  if (!w) return;

  const kv = (l, v) => '<tr><td style="background:#f5f7fa;font-weight:700;color:#555;width:180px">' + l + '</td><td>' + v + '</td></tr>';

  let h = _lh('Allotment Letter', d.project_name);
  h += '<div class="body">';
  h += '<div style="font-size:10px;color:#888;margin-bottom:8px">Ref: ' + esc(d.sale_number || '—') + ' &nbsp;|&nbsp; Date: ' + saleDate + '</div>';
  h += '<div class="doc-title">Allotment Letter</div>';
  h += '<p style="margin-bottom:10px">Dear <b>' + esc(d.client_name || 'Valued Customer') + '</b>,</p>';
  h += '<p style="margin-bottom:12px;line-height:1.7">We are pleased to inform you that the following property has been allotted to you in accordance with the terms and conditions of the sale agreement dated <b>' + saleDate + '</b>.</p>';
  h += '<table>';
  h += kv('Client Name', esc(d.client_name || '—'));
  if (d.co_buyer_name) h += kv('Co-buyer / Joint Owner', esc(d.co_buyer_name));
  h += kv('Sale Number', '<span style="font-family:monospace">' + esc(d.sale_number || '—') + '</span>');
  h += kv('Project', esc(d.project_name || '—'));
  h += kv('Unit No.', esc(d.unit_no || '—') + (d.floor_label ? ' — ' + esc(d.floor_label) : ''));
  if (d.unit_type) h += kv('Unit Type', esc(d.unit_type));
  if (d.area_sqft) h += kv('Area', Number(d.area_sqft).toLocaleString('en-IN') + ' sq ft');
  h += kv('Sale Date', saleDate);
  h += kv('Total Sale Value', '<b>' + fmtPKR(d.net_amount) + '</b>');
  if (d.agent_name) h += kv('Sales Agent', esc(d.agent_name));
  h += '</table>';
  h += '<p style="margin:12px 0;line-height:1.7">This letter confirms your allotment. Please retain this document for your records. For any queries, please contact our office.</p>';
  h += '<p style="margin-bottom:4px">Thank you for choosing <b>' + esc(coName) + '</b>.</p>';
  h += '<div class="no-break">' + _sigBlock({ label: 'Client Acknowledgement', value: d.client_name || '' }) + '</div>';
  h += '</div>';

  w.document.write(h);
  _pclose(w);
}

// ══ PRINT: DEMAND NOTICE ═══════════════════════════════════════════════

function printDemandNotice(idx) {
  const d = _salCurrentDetail;
  if (!d) { toast('No sale loaded', 'warn'); return; }

  const allInst = Array.isArray(d.installments) ? d.installments : [];
  let inst;
  if (idx !== undefined && idx !== null) {
    inst = allInst[idx];
  } else {
    const sel = document.getElementById('sd-demand-inst');
    inst = sel ? allInst[Number(sel.value)] : null;
  }
  if (!inst) { toast('No installment selected', 'warn'); return; }

  const fmtPKR      = n => 'PKR ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const dueDate     = inst.due_date ? new Date(inst.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const outstanding = Math.max(0, Number(inst.amount_due || 0) - Number(inst.amount_paid || 0));
  const isOverdue   = inst.due_date && inst.due_date < td();
  const instLabel   = Number(inst.installment_number) > 0
    ? _ordinal(inst.installment_number) + ' Installment'
    : (inst.notes || 'Installment');

  const w = _pw('Demand Notice — ' + (d.sale_number || ''), _pCSS('A4'));
  if (!w) return;

  const kv = (l, v) => '<tr><td style="background:#f5f7fa;font-weight:700;color:#555;width:180px">' + l + '</td><td>' + v + '</td></tr>';

  let h = _lh('Demand Notice', d.project_name);
  h += '<div class="body">';
  h += '<div class="doc-title" style="color:#b91c1c;border-color:#b91c1c">Payment Demand Notice</div>';
  h += '<p style="margin-bottom:10px">Dear <b>' + esc(d.client_name || 'Valued Customer') + '</b>,</p>';
  h += '<p style="margin-bottom:12px;line-height:1.7">This is a formal demand notice for your outstanding installment payment due for the property allotted to you. Please arrange payment at the earliest to avoid any default charges.</p>';
  h += '<table>';
  h += kv('Sale Number', '<span style="font-family:monospace">' + esc(d.sale_number || '—') + '</span>');
  h += kv('Client Name', esc(d.client_name || '—'));
  h += kv('Project', esc(d.project_name || '—'));
  h += kv('Unit No.', esc(d.unit_no || '—') + (d.floor_label ? ' — ' + esc(d.floor_label) : ''));
  h += kv('Installment', esc(instLabel) + (isOverdue ? ' <span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700">OVERDUE</span>' : ''));
  h += kv('Due Date', '<span style="font-weight:700;color:' + (isOverdue ? '#dc2626' : '#111') + '">' + dueDate + '</span>');
  h += kv('Amount Due', '<b>' + fmtPKR(inst.amount_due) + '</b>');
  if (Number(inst.amount_paid) > 0) h += kv('Amount Paid', '<span style="color:#16a34a">' + fmtPKR(inst.amount_paid) + '</span>');
  h += '</table>';
  h += '<div style="text-align:center;background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;padding:16px;margin:14px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact">'
     + '<div style="font-size:10px;color:#7f1d1d;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Outstanding Amount</div>'
     + '<div style="font-size:26px;font-weight:800;color:#b91c1c">' + fmtPKR(outstanding) + '</div></div>';
  h += '<p style="line-height:1.7">Kindly deposit the outstanding amount via bank transfer or visit our office. Failure to pay within <b>7 days</b> of this notice may result in penalty charges as per your agreement.</p>';
  h += '<p>For payment or queries, please contact us immediately.</p>';
  h += '<div class="no-break">' + _sigBlock({ label: 'Client Acknowledgement', value: d.client_name || '' }) + '</div>';
  h += '</div>';

  w.document.write(h);
  _pclose(w);
}

// ══ PRINT: POSSESSION LETTER ═══════════════════════════════════════════

function printPossessionLetter() {
  const d = _salCurrentDetail;
  if (!d) { toast('No sale loaded', 'warn'); return; }
  const br        = window._cobranding || {};
  const H         = br.doc_brand_color || '#1E2D47';
  const printDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const fmtPKR    = n => 'PKR ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const saleDate  = d.sale_date ? new Date(d.sale_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Possession Letter — ${d.sale_number || ''}</title>
<style>${_pCSS('A4')}
  p{font-size:12px;line-height:1.9;margin-bottom:12px}
  .hl{font-weight:700;color:${H}}
  .detail-tbl{width:100%;border-collapse:collapse;margin:16px 0}
  .detail-tbl td{padding:8px 14px;font-size:11.5px;border-bottom:1px solid #edf2f7;vertical-align:top}
  .detail-tbl td:first-child{background:#f6f8fa;font-weight:700;color:#57606a;width:190px}
  .detail-tbl tr:last-child td{border-bottom:none}
  ol{margin:10px 0 14px 20px}
  ol li{font-size:11.5px;margin-bottom:6px;line-height:1.7}
</style>
</head>
<body>
  ${_lh('Possession Letter', d.project_name)}
  <div style="font-size:11px;color:#57606a;margin:8px 0 14px">Date: ${printDate} &nbsp;|&nbsp; Ref: ${esc(d.sale_number || '—')}</div>

  <div class="doc-title">Possession / Handover Letter</div>

  <p>Dear <span class="hl">${esc(d.client_name || 'Valued Customer')}</span>,</p>
  <p>We are delighted to inform you that possession of the following property is hereby handed over to you. This letter serves as a formal acknowledgement of the transfer of physical possession.</p>

  <table class="detail-tbl">
    <tr><td>Client Name</td><td>${esc(d.client_name || '—')}</td></tr>
    ${d.co_buyer_name ? `<tr><td>Co-buyer / Joint Owner</td><td>${esc(d.co_buyer_name)}</td></tr>` : ''}
    <tr><td>Sale Number</td><td style="font-family:monospace">${esc(d.sale_number || '—')}</td></tr>
    <tr><td>Project</td><td>${esc(d.project_name || '—')}</td></tr>
    <tr><td>Unit No.</td><td>${esc(d.unit_no || '—')}${d.floor_label ? ' — ' + esc(d.floor_label) : ''}</td></tr>
    ${d.unit_type ? `<tr><td>Unit Type</td><td>${esc(d.unit_type)}</td></tr>` : ''}
    ${d.area_sqft ? `<tr><td>Area</td><td>${Number(d.area_sqft).toLocaleString('en-IN')} sq ft</td></tr>` : ''}
    <tr><td>Original Sale Date</td><td>${saleDate}</td></tr>
    <tr><td>Possession Date</td><td style="font-weight:700;color:${H}">${printDate}</td></tr>
    <tr><td>Total Sale Value</td><td style="font-weight:700">${fmtPKR(d.net_amount)}</td></tr>
  </table>

  <p>By accepting this possession, you confirm the following:</p>
  <ol>
    <li>You have inspected the property and found it to be in satisfactory condition.</li>
    <li>All keys, access codes, and relevant documents have been received.</li>
    <li>Any outstanding dues remain payable as per the agreed payment schedule.</li>
    <li>Maintenance and utility responsibilities transfer to you from this date.</li>
  </ol>

  <p>Congratulations on your new property. We look forward to a continued relationship with you.</p>

  ${_sigBlock({ label: 'Client Signature', value: '' })}
</body>
</html>`;

  _printHTML(html);
}

// ══ PRINT: SALE SUMMARY ════════════════════════════════════════════════

function printSaleDetail() {
  const d = _salCurrentDetail;
  if (!d) { toast('No sale loaded', 'warn'); return; }
  const fmtPKR    = n => 'PKR ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const saleDate  = d.sale_date ? new Date(d.sale_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

  const installments = (d.installments || []);
  const totalPaid = installments.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  const totalDue  = installments.reduce((s, i) => s + Number(i.amount_due  || 0), 0);
  const totalOut  = installments.reduce((s, i) => s + Number(i.outstanding || 0), 0);

  const stColor = st => st === 'paid' ? '#15803d' : st === 'overdue' ? '#dc2626' : st === 'partial' ? '#d97706' : '#6b7280';
  const schedRows = installments.map((inst, idx) => {
    const dueDate = inst.due_date ? new Date(inst.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const statusLabel = inst.status === 'paid' ? 'Paid' : inst.status === 'overdue' ? 'Overdue' : inst.status === 'partial' ? 'Partial' : 'Pending';
    return '<tr>'
      + '<td style="text-align:center">' + (idx + 1) + '</td>'
      + '<td>' + dueDate + '</td>'
      + '<td>' + esc(inst.installment_type || '—') + '</td>'
      + '<td style="text-align:right">' + fmtPKR(inst.amount_due) + '</td>'
      + '<td style="text-align:right">' + fmtPKR(inst.amount_paid) + '</td>'
      + '<td style="text-align:right;font-weight:600;color:' + (Number(inst.outstanding) > 0 ? '#dc2626' : '#15803d') + '">' + fmtPKR(inst.outstanding) + '</td>'
      + '<td style="text-align:center;color:' + stColor(inst.status) + ';font-weight:600">' + statusLabel + '</td>'
      + '</tr>';
  }).join('');

  const w = _pw('Sale Summary — ' + (d.sale_number || ''), _pCSS('A4'));
  if (!w) return;

  const ig = (l, v) => '<div class="ig-item"><span class="ig-lbl">' + l + '</span><span class="ig-val">' + v + '</span></div>';
  const fr = (l, v) => '<div class="row" style="padding:7px 14px"><span class="lbl">' + l + '</span><span class="val">' + v + '</span></div>';

  let h = _lh('Sale Summary', d.project_name);
  h += '<div class="body">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
     + '<div class="doc-title" style="border:none;margin:0;padding:0">Sale Summary</div>'
     + '<div style="text-align:right"><div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888">Sale No</div>'
     + '<div style="font-size:14px;font-weight:700;font-family:monospace">' + esc(d.sale_number || '—') + '</div></div></div>';

  h += '<div class="sec-title">Sale Information</div>';
  h += '<div class="info-grid info-grid-2">';
  h += ig('Client', '<b>' + esc(d.client_name || '—') + '</b>');
  if (d.co_buyer_name) h += ig('Co-buyer', esc(d.co_buyer_name) + (d.co_buyer_cnic ? ' — ' + esc(d.co_buyer_cnic) : ''));
  h += ig('Sale Date', saleDate);
  h += ig('Status', esc(d.status || '—'));
  h += ig('Project', esc(d.project_name || '—'));
  h += ig('Unit No.', '<b>' + esc(d.unit_no || '—') + '</b>');
  if (d.unit_type) h += ig('Unit Type', esc(d.unit_type));
  if (d.area_sqft) h += ig('Area', Number(d.area_sqft).toLocaleString('en-IN') + ' sq ft');
  if (d.agent_name) h += ig('Agent', esc(d.agent_name));
  if (d.nominee_name) h += ig('Nominee', esc(d.nominee_name) + ' (' + esc(d.nominee_relation || '—') + ')');
  h += '</div>';

  h += '<div class="sec-title">Financial Summary</div>';
  h += '<div style="border:1px solid #dde;border-radius:4px;overflow:hidden;margin-bottom:12px">';
  h += fr('Total Price', fmtPKR(d.total_amount));
  if (Number(d.discount) > 0) h += fr('Discount', '<span style="color:#dc2626">− ' + fmtPKR(d.discount) + '</span>');
  h += fr('Net Amount', '<b>' + fmtPKR(d.net_amount) + '</b>');
  h += fr('Down Payment', '<span style="color:#15803d">' + fmtPKR(d.down_payment) + '</span>');
  h += fr('Total Collected', '<span style="color:#15803d">' + fmtPKR(totalPaid) + '</span>');
  h += fr('Outstanding Balance', '<span style="color:' + (totalOut > 0 ? '#dc2626' : '#15803d') + ';font-weight:700">' + fmtPKR(totalOut) + '</span>');
  if (Number(d.wht_amount) > 0) h += fr('WHT', fmtPKR(d.wht_amount));
  if (Number(d.cvt_amount) > 0) h += fr('CVT', fmtPKR(d.cvt_amount));
  h += '</div>';

  if (installments.length > 0) {
    h += '<div class="sec-title">Payment Schedule (' + installments.length + ' installments)</div>';
    h += '<table><thead><tr>'
       + '<th style="text-align:center;width:32px">#</th><th>Due Date</th><th>Type</th>'
       + '<th style="text-align:right">Amount Due</th><th style="text-align:right">Paid</th>'
       + '<th style="text-align:right">Outstanding</th><th style="text-align:center">Status</th>'
       + '</tr></thead><tbody>' + schedRows + '</tbody>'
       + '<tfoot><tr><td colspan="3" style="font-weight:700">Total</td>'
       + '<td style="text-align:right;font-weight:700">' + fmtPKR(totalDue) + '</td>'
       + '<td style="text-align:right;font-weight:700">' + fmtPKR(totalPaid) + '</td>'
       + '<td style="text-align:right;font-weight:700;color:' + (totalOut > 0 ? '#dc2626' : '#15803d') + '">' + fmtPKR(totalOut) + '</td>'
       + '<td></td></tr></tfoot></table>';
  }

  if (d.notes) h += '<div class="sec-title">Notes</div><p style="font-size:11px;color:#444;background:#f9fafb;border:1px solid #e1e8ed;border-radius:6px;padding:10px 14px">' + esc(d.notes) + '</p>';

  h += _footer();
  h += '</div>';

  w.document.write(h);
  _pclose(w);
}

// ══ EDIT INSTALLMENT ═══════════════════════════════════════════════════

async function openInstEditModal(instId) {
  const { data, error } = await supabase.rpc('get_installment_for_edit', { p_id: instId, p_company_id: S.cid });
  if (error || !data || data.error) { toast('Could not load installment', 'err'); return; }

  document.getElementById('ie-inst-id').value       = data.id;
  document.getElementById('ie-inst-num').textContent = data.installment_number > 0 ? `#${data.installment_number}` : 'Booking';
  document.getElementById('ie-type').value           = data.installment_type || 'installment';
  document.getElementById('ie-due-date').value       = data.due_date || '';
  document.getElementById('ie-amount-due').value     = data.amount_due || '';
  document.getElementById('ie-notes').value          = data.notes || '';
  document.getElementById('ie-err').textContent      = '';

  om('m-inst-edit');
}

async function saveInstEdit() {
  const instId  = document.getElementById('ie-inst-id').value;
  const dueDate = document.getElementById('ie-due-date').value;
  const amtDue  = document.getElementById('ie-amount-due').value;
  const err     = document.getElementById('ie-err');
  const btn     = document.getElementById('ie-save-btn');

  err.textContent = '';

  if (!dueDate)       { err.textContent = 'Due date is required.'; return; }
  if (!amtDue || isNaN(Number(amtDue)) || Number(amtDue) <= 0) {
    err.textContent = 'Amount must be a positive number.'; return;
  }

  const payload = {
    installment_type: document.getElementById('ie-type').value,
    due_date:         dueDate,
    amount_due:       Number(amtDue),
    notes:            document.getElementById('ie-notes').value.trim() || null,
  };

  btn.disabled    = true;
  btn.textContent = 'Saving…';

  // Look up the parent sale_id for the schedule RPC (single-row update)
  const lookup = await supabase.rpc('get_installment_for_edit', { p_id: instId, p_company_id: S.cid });
  const parentSaleRes = await supabase.rpc('get_sale_for_edit', { p_sale_id: null, p_company_id: S.cid });
  // Simpler path: edit via single-row schedule call. Need sale_id — fetch installment record first.
  const instRow = lookup?.data;
  const saleIdFromInst = window._salCurrentDetail?.id || null;

  if (!saleIdFromInst) { err.textContent = 'Cannot resolve parent sale'; btn.disabled=false; btn.textContent='Save'; return; }

  const res = await supabase.rpc('edit_installment_schedule', {
    p_sale_id: saleIdFromInst,
    p_company_id: S.cid,
    p_schedule: [{ id: instId, ...payload }]
  });

  btn.disabled    = false;
  btn.textContent = 'Save';

  if (res.error || !res.data?.success) { err.textContent = res.error?.message || (res.data?.errors?.[0]) || 'Save failed'; return; }
  cm('m-inst-edit');
  toast('Installment updated');
  rSaleDetail();
}
