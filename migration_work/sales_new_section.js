// ══ SALES LIST PAGE (nx kit) ═══════════════════════════════════════════
// Single 500-row pull → all filtering (search / status / project / period)
// is CLIENT-SIDE. We deliberately avoid list_sales_filtered's project/date
// keys (silently dropped — register #15) by never sending them to an RPC.

var _salAllSales = [];      // unfiltered cache for this company
var _salProject  = '';      // client-side project filter (by project_name)
var _salPeriod   = '';      // '', 'month', 'quarter', 'year', '12m'
var _salSearchTimer = null;

async function rSales() {
  const cid = S?.cid;
  const pg  = document.getElementById('pg-sales');
  if (!pg) return;
  if (!cid) { pg.innerHTML = `<div class="nx-card">${NX.empty({ icon:'inbox', message:'No company selected' })}</div>`; return; }

  const isA = S.role === 'admin' || S.role === 'owner';
  const actions =
    NX.button('Print', { variant:'ghost', size:'sm', onclick:'printSalesList()' }) +
    NX.button('Export', { variant:'ghost', size:'sm', onclick:'exportSalesExcel()' }) +
    (isA ? NX.button('New sale', { variant:'primary', size:'sm', icon:'plus', onclick:"nav('newsale')" }) : '');

  pg.innerHTML = `<div class="nx-page">
    <div class="nx-page-header">
      <div><h1 class="nx-page-title">Sales</h1><div class="nx-kpi-label" id="sal-count" style="margin-top:4px"></div></div>
      <div class="nx-page-actions">${actions}</div>
    </div>
    <div id="sal-kpis" class="nx-kpi-row" style="margin-bottom:var(--fk-sp-4)"></div>
    <div class="nx-card nx-card--compact" style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:center;margin-bottom:var(--fk-sp-4)">
      <div style="position:relative;flex:1;min-width:220px;max-width:320px">
        <input class="nx-input" id="sal-s" placeholder="Sale #, client, unit, agent…" value="${esc(_salSearch)}" oninput="_salDoSearch(this.value)" autocomplete="off" style="padding-left:32px">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);pointer-events:none">${NX.icon('search',14)}</span>
      </div>
      <div class="nx-segment" id="sal-status-seg">
        ${['','active','completed','cancelled'].map(s =>
          `<button class="nx-btn nx-btn--sm ${(_salStatus||'')===s?'nx-btn--primary':'nx-btn--ghost'}" onclick="_salSetStatus('${s}')">${s?s[0].toUpperCase()+s.slice(1):'All'}</button>`).join('')}
      </div>
      <div id="sal-project-wrap"></div>
      <select class="nx-select" style="width:auto" onchange="_salSetPeriod(this.value)">
        ${[['','All time'],['month','This month'],['quarter','This quarter'],['year','This year'],['12m','Last 12 months']]
          .map(([v,l]) => `<option value="${v}"${_salPeriod===v?' selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <div id="sal-ct"></div>
  </div>`;

  await _salLoadAll();
}

async function _salLoadAll() {
  const cid = S?.cid;
  const ct = document.getElementById('sal-ct');
  if (!ct || !cid) return;
  ct.innerHTML = `<div class="nx-card">${[0,1,2,3,4].map(()=>`<div class="nx-skel" style="height:40px;margin:6px 0;border-radius:8px"></div>`).join('')}</div>`;
  try {
    const { data, error } = await supabase.rpc('list_sales', {
      p_company_id: cid, p_search: null, p_status: null, p_limit: 2000, p_offset: 0
    });
    if (error) throw error;
    _salAllSales = Array.isArray(data) ? data : [];
    // build project filter from the project_names actually present
    const projs = [...new Set(_salAllSales.map(s => s.project_name).filter(Boolean))].sort();
    const pw = document.getElementById('sal-project-wrap');
    if (pw) pw.innerHTML = projs.length > 1
      ? `<select class="nx-select" style="width:auto" onchange="_salSetProject(this.value)">
           <option value="">All projects</option>
           ${projs.map(p => `<option value="${esc(p)}"${_salProject===p?' selected':''}>${esc(p)}</option>`).join('')}
         </select>` : '';
    _salApplyFilters();
  } catch(e) {
    ct.innerHTML = `<div class="nx-card">${NX.empty({ icon:'alert-triangle', message:'Failed to load sales — ' + (e.message||'') })}</div>`;
  }
}

function _salFiltered() {
  const q = (_salSearch || '').trim().toLowerCase();
  const now = new Date();
  let from = null;
  if (_salPeriod === 'month')   from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (_salPeriod === 'quarter') from = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
  if (_salPeriod === 'year')    from = new Date(now.getFullYear(), 0, 1);
  if (_salPeriod === '12m')     from = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
  return _salAllSales.filter(s => {
    if (_salStatus && s.status !== _salStatus) return false;
    if (_salProject && s.project_name !== _salProject) return false;
    if (from && s.sale_date && new Date(s.sale_date) < from) return false;
    if (q) {
      const hay = `${s.sale_number||''} ${s.client_name||''} ${s.unit_no||''} ${s.agent_name||''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _salApplyFilters() {
  const rows = _salFiltered();
  const cEl = document.getElementById('sal-count');
  if (cEl) cEl.textContent = rows.length + (rows.length === 1 ? ' sale' : ' sales');
  _salRenderKpis(rows);
  _salRenderTable(rows);
}

function _salRenderKpis(rows) {
  const el = document.getElementById('sal-kpis');
  if (!el) return;
  const active = rows.filter(s => s.status === 'active').length;
  const net    = rows.reduce((a,s) => a + Number(s.net_amount||0), 0);
  const bal    = rows.reduce((a,s) => a + Math.max(0, Number(s.net_amount||0) - Number(s.total_collected||0)), 0);
  el.innerHTML =
    NX.kpi({ label:'Total sales',    value: rows.length }) +
    NX.kpi({ label:'Active',         value: active }) +
    NX.kpi({ label:'Net portfolio',  value: fMF(net) }) +
    NX.kpi({ label:'Outstanding',    value: fMF(bal) });
}

function _salRenderTable(rows) {
  const ct = document.getElementById('sal-ct');
  if (!ct) return;
  if (!rows.length) {
    ct.innerHTML = `<div class="nx-card">${NX.empty({ icon:'search', message:(_salSearch||_salStatus||_salProject||_salPeriod)?'No sales match these filters.':'No sales yet — record your first sale.' })}</div>`;
    return;
  }
  const cols = [
    { label:'Sale #' }, { label:'Client' }, { label:'Unit' },
    { label:'Date' }, { label:'Net', num:true }, { label:'Received', num:true },
    { label:'Balance', num:true }, { label:'Status' }
  ];
  const trows = rows.map(s => {
    const bal = Math.max(0, Number(s.net_amount||0) - Number(s.total_collected||0));
    const tone = s.status === 'cancelled' ? 'danger' : s.status === 'completed' ? 'info' : 'success';
    const lbl  = s.status ? s.status[0].toUpperCase()+s.status.slice(1) : '—';
    return [
      `<span class="nx-mono" style="color:var(--fk-accent);font-weight:var(--fk-fw-semibold)">${esc(s.sale_number||'—')}</span>`,
      esc(s.client_name||'—'),
      `${esc(s.unit_no||'—')}${s.project_name?`<div class="nx-kpi-label" style="text-transform:none">${esc(s.project_name)}</div>`:''}`,
      fD(s.sale_date),
      fMF(s.net_amount),
      `<span style="color:var(--fk-success)">${Number(s.total_collected||0)>0?fMF(s.total_collected):'—'}</span>`,
      `<span style="color:${bal>0?'var(--fk-warning)':'var(--fk-success)'}">${fMF(bal)}</span>`,
      NX.badge(lbl, tone, { dot:true })
    ];
  });
  ct.innerHTML = `<div class="nx-card nx-card--flush"><div class="nx-table-wrap">${
    NX.table({ cols, rows: trows, flush:true })
  }</div></div>`;
  // make rows clickable → sale detail
  const body = ct.querySelectorAll('tbody tr');
  body.forEach((tr, i) => { tr.style.cursor = 'pointer'; tr.onclick = () => openSaleDetail(rows[i].id); });
}

function _salDoSearch(v) { _salSearch = v; clearTimeout(_salSearchTimer); _salSearchTimer = setTimeout(_salApplyFilters, 200); }
function _salSetStatus(v) {
  _salStatus = v;
  document.querySelectorAll('#sal-status-seg .nx-btn').forEach(b => b.classList.remove('nx-btn--primary'));
  _salApplyFilters();
  // re-render segment active state
  const seg = document.getElementById('sal-status-seg');
  if (seg) seg.querySelectorAll('.nx-btn').forEach(b => {
    const on = (b.textContent.trim().toLowerCase() === (v||'all'));
    b.classList.toggle('nx-btn--primary', on); b.classList.toggle('nx-btn--ghost', !on);
  });
}
function _salSetProject(v) { _salProject = v; _salApplyFilters(); }
function _salSetPeriod(v)  { _salPeriod = v;  _salApplyFilters(); }


// ══ INSTALLMENT-PLAN GENERATOR ═════════════════════════════════════════
// THE single source of every downstream schedule. Builds lines so that
// Σ amount_due == net EXACTLY (rounding remainder absorbed into the LAST
// monthly line; booking & possession stay at their exact % values).
// Torture-tested in migration_work/test_plan.js (6 awkward nets incl. the
// 6,678,423 @30%+36mo and 5,391,200 @25%+30+10% ground-truth cases).

function _spRound(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function _spYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _spAddMonths(d, n) { var x = new Date(d.getTime()); var day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); var last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(day, last)); return x; }

function _spGenerate(net, tpl, p) {
  net = _spRound(net);
  var lines = [];
  var bookingDate = p.bookingDate || _spYmd(new Date());
  var i, d;
  if (tpl === 'custom') {
    var bookingAmt = _spRound(p.bookingAmt || 0);
    if (bookingAmt > 0) lines.push({ type: 'down_payment', label: 'Booking / Down Payment', due: bookingDate, amount: bookingAmt });
    var monthlyAmt = _spRound(p.monthlyAmt || 0);
    var cmonths = parseInt(p.months) || 0;
    d = new Date(p.startDate);
    for (i = 1; i <= cmonths; i++) { lines.push({ type: 'installment', label: 'Installment ' + i, due: _spYmd(d), amount: monthlyAmt }); d = _spAddMonths(d, 1); }
    (p.specials || []).forEach(function (s) { lines.push({ type: s.type || 'custom', label: s.label || 'Special', due: s.due || _spYmd(d), amount: _spRound(s.amount || 0) }); });
  } else { // 'equal' or 'possession'
    var bookingPct = Number(p.bookingPct) || 0;
    var possessionPct = tpl === 'possession' ? (Number(p.possessionPct) || 0) : 0;
    var months = parseInt(p.months) || 0;
    var booking = _spRound(net * bookingPct / 100);
    var possession = _spRound(net * possessionPct / 100);
    var remaining = _spRound(net - booking - possession);
    var monthly = months > 0 ? _spRound(remaining / months) : 0;
    lines.push({ type: 'down_payment', label: 'Booking / Down Payment', due: bookingDate, amount: booking });
    d = new Date(p.startDate);
    for (i = 1; i <= months; i++) { lines.push({ type: 'installment', label: 'Installment ' + i, due: _spYmd(d), amount: monthly }); d = _spAddMonths(d, 1); }
    if (possession > 0) lines.push({ type: 'possession', label: 'On Possession', due: _spYmd(d), amount: possession });
  }
  // ── LAST-INSTALLMENT ABSORPTION: Σ amount_due MUST == net exactly ──
  if (lines.length) {
    var sumAll = lines.reduce(function (s, l) { return s + l.amount; }, 0);
    var diff = _spRound(net - sumAll);
    if (diff !== 0) {
      var idx = -1; for (var k = lines.length - 1; k >= 0; k--) { if (lines[k].type === 'installment') { idx = k; break; } }
      if (idx < 0) idx = lines.length - 1;
      lines[idx].amount = _spRound(lines[idx].amount + diff);
    }
  }
  return lines;
}
function _spSum(lines) { return _spRound((lines||[]).reduce(function (s, l) { return s + l.amount; }, 0)); }
function _spBooking(lines) { var b = (lines||[]).find(function (l) { return l.type === 'down_payment'; }); return b ? b.amount : 0; }
function _spMonthlyCount(lines) { return (lines||[]).filter(function (l) { return l.type !== 'down_payment'; }).length; }


// ══ NEW SALE — 5-STEP GUIDED FLOW ══════════════════════════════════════
// Step order is load-bearing: UNIT first fixes the project, so the CLIENT
// step (and inline create) can guarantee the server-side cross_project_client
// guard in create_sale_with_schedule is satisfied.

var _ns = null;
const _NS_STEPS = ['Unit', 'Client', 'Deal', 'Plan', 'Review'];

async function rNewSale() {
  const cid = S?.cid;
  const pg  = document.getElementById('pg-newsale');
  if (!pg) return;
  if (!cid) { nav('sales'); return; }

  // Load agents (project-filtered later)
  let agents = [];
  try {
    const { data } = await supabase.rpc('list_agents', { p_company_id: cid, p_search: null, p_status: 'active', p_sort: 'name' });
    agents = Array.isArray(data) ? data : [];
  } catch (e) { agents = []; }
  _salAgents = agents;

  const today = td();
  _ns = {
    step: 1,
    unit: null, client: null, clientNew: null,
    agentId: null, commPct: null,
    saleDate: today, bookingDate: today, startDate: _spYmd(_spAddMonths(new Date(), 1)),
    rate: 0, area: 0, list: 0, deal: 0, discount: 0, pricePerSqft: 0, net: 0,
    tpl: 'equal', bookingPct: 30, months: 12, possessionPct: 10,
    custom: { bookingAmt: 0, monthlyAmt: 0, months: 12 },
    plan: []
  };

  // Pre-select from unit detail ("Sell this unit")
  if (window._nsPreUnitId) {
    const u = (window._unitsCache || []).find(x => x.id === window._nsPreUnitId);
    window._nsPreUnitId = null;
    if (u && u.isAvailable !== false) { _nsPickUnit(u, true); }
  }

  _nsRender();
}

function _nsRender() {
  const pg = document.getElementById('pg-newsale');
  if (!pg || !_ns) return;
  pg.innerHTML = `<div class="nx-page">
    <div class="no-p" style="margin-bottom:var(--fk-sp-3)">${NX.button('← Back to Sales', { variant:'ghost', size:'sm', onclick:"nav('sales')" })}</div>
    <div class="nx-page-header"><h1 class="nx-page-title">New Sale</h1></div>
    ${_nsStepper()}
    <div id="ns-body" style="margin-top:var(--fk-sp-4)"></div>
  </div>`;
  _nsRenderStep();
}

function _nsStepper() {
  return `<div class="nx-stepper" style="display:flex;gap:8px;flex-wrap:wrap">${
    _NS_STEPS.map((s, i) => {
      const n = i + 1, done = n < _ns.step, cur = n === _ns.step;
      const bg = cur ? 'var(--fk-accent)' : done ? 'var(--fk-success)' : 'var(--fk-surface-2)';
      const fg = (cur||done) ? '#fff' : 'var(--fk-text-muted)';
      const clickable = done;
      return `<div onclick="${clickable?`_nsGoto(${n})`:''}" style="display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:var(--fk-radius);background:var(--fk-surface);border:1px solid var(--fk-border);${clickable?'cursor:pointer':''};opacity:${(cur||done)?1:.7}">
        <span style="width:20px;height:20px;border-radius:50%;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${done?NX.icon('check',12):n}</span>
        <span style="font-size:13px;font-weight:${cur?'var(--fk-fw-semibold)':'400'};color:${cur?'var(--fk-text)':'var(--fk-text-muted)'}">${s}</span>
      </div>`;
    }).join('')
  }</div>`;
}

function _nsRenderStep() {
  const b = document.getElementById('ns-body');
  if (!b) return;
  if (_ns.step === 1) b.innerHTML = _nsStep1();
  else if (_ns.step === 2) { b.innerHTML = _nsStep2(); _nsClientSearch(''); }
  else if (_ns.step === 3) { b.innerHTML = _nsStep3(); _nsDealRecalc(); }
  else if (_ns.step === 4) { b.innerHTML = _nsStep4(); _nsPlanChange(); }
  else if (_ns.step === 5) b.innerHTML = _nsStep5();
}

function _nsGoto(n) { if (n >= 1 && n <= 5) { _ns.step = n; _nsRender(); } }
function _nsBack()  { if (_ns.step > 1) _nsGoto(_ns.step - 1); }

function _nsNav(backLabel, nextLabel, nextFn, nextDisabled) {
  return `<div style="display:flex;justify-content:space-between;gap:10px;margin-top:var(--fk-sp-4)">
    <div>${_ns.step>1 ? NX.button(backLabel||'← Back', { variant:'ghost', onclick:'_nsBack()' }) : ''}</div>
    <div>${nextFn ? NX.button(nextLabel||'Next →', { variant:'primary', onclick:nextFn, disabled:!!nextDisabled }) : ''}</div>
  </div>`;
}

// ── STEP 1: UNIT (available only, floor-grouped) ──────────────────────────
function _nsStep1() {
  const avail = (window._unitsCache || []).filter(u => u.isAvailable !== false && !u.saleId);
  return `<div class="nx-card">
    <div class="nx-card-title">Select a unit <span class="nx-kpi-label" style="text-transform:none">· ${avail.length} available</span></div>
    <input class="nx-input" id="ns-unit-q" placeholder="Search unit no / type / floor…" oninput="_nsUnitSearch(this.value)" style="margin:var(--fk-sp-3) 0">
    <div id="ns-unit-list"></div>
  </div>
  ${_nsNav(null, 'Next: Client →', _ns.unit ? '_nsGoto(2)' : null, !_ns.unit)}`;
}

function _nsUnitSearch(q) {
  const wrap = document.getElementById('ns-unit-list');
  if (!wrap) return;
  q = (q||'').trim().toLowerCase();
  let avail = (window._unitsCache || []).filter(u => u.isAvailable !== false && !u.saleId);
  if (q) avail = avail.filter(u => `${u.unitNo||''} ${u.type||''} ${u.floorLabel||''}`.toLowerCase().includes(q));
  if (!avail.length) { wrap.innerHTML = NX.empty({ icon:'search', message:'No available units match.' }); return; }
  // group by floor
  const groups = {};
  avail.forEach(u => { const k = u.floorLabel || 'Unassigned'; (groups[k] = groups[k] || []).push(u); });
  wrap.innerHTML = Object.keys(groups).map(fl => `
    <div style="margin-bottom:var(--fk-sp-3)">
      <div class="nx-kpi-label" style="margin-bottom:6px">${esc(fl)} <span class="nx-chip">${groups[fl].length}</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">
        ${groups[fl].map(u => {
          const sel = _ns.unit && _ns.unit.id === u.id;
          return `<div onclick="_nsPickUnitById('${u.id}')" style="cursor:pointer;padding:10px 12px;border-radius:var(--fk-radius);border:1.5px solid ${sel?'var(--fk-accent)':'var(--fk-border)'};background:${sel?'var(--fk-accent-soft, rgba(37,99,235,.08))':'var(--fk-surface)'}">
            <div style="font-weight:var(--fk-fw-semibold);font-size:14px">${esc(u.unitNo||'—')}</div>
            <div class="nx-kpi-label" style="text-transform:none">${esc(u.type||'—')}${u.area?` · ${fM(u.area)} sqft`:''}</div>
            ${u.basePrice?`<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted)">${fMF(u.basePrice)}</div>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function _nsPickUnitById(id) {
  const u = (window._unitsCache || []).find(x => x.id === id);
  if (u) _nsPickUnit(u);
}
function _nsPickUnit(u, silent) {
  _ns.unit = u;
  _ns.area = Number(u.area || 0);
  _ns.rate = _ns.area > 0 ? _spRound(Number(u.basePrice || 0) / _ns.area) : 0;
  // reset client if it no longer matches the unit's project
  if (_ns.client && _ns.client.projectId && _ns.client.projectId !== u.projectId) { _ns.client = null; }
  if (!silent) { _nsUnitSearch(document.getElementById('ns-unit-q')?.value || ''); _nsRefreshNav(); }
}
function _nsRefreshNav() {
  // re-render the nav row of the current step (cheap: just re-render step)
  if (_ns.step === 1) {
    const b = document.getElementById('ns-body'); if (b) b.innerHTML = _nsStep1(), _nsUnitSearch(document.getElementById('ns-unit-q')?.value||'');
  }
}

// ── STEP 2: CLIENT (search existing in project, or quick-create) ──────────
function _nsStep2() {
  const proj = (window._projectsCache || []).find(p => p.id === _ns.unit?.projectId);
  const sel = _ns.client;
  return `<div class="nx-card">
    <div class="nx-card-title">Client <span class="nx-kpi-label" style="text-transform:none">· for ${esc(_ns.unit?.unitNo||'')}${proj?` (${esc(proj.name)})`:''}</span></div>
    ${sel ? `<div class="nx-banner nx-banner--info" style="margin:var(--fk-sp-3) 0">${NX.icon('check',16)}<span>Selected: <strong>${esc(sel.full_name||sel.fullName)}</strong>${sel.cnic?` · ${esc(sel.cnic)}`:''} ${NX.button('Change', { variant:'ghost', size:'sm', onclick:'_nsClearClient()' })}</span></div>` : ''}
    <div id="ns-client-pane" style="${sel?'display:none':''}">
      <div class="nx-segment" style="margin:var(--fk-sp-3) 0">
        <button class="nx-btn nx-btn--sm nx-btn--primary" id="ns-cmode-find" onclick="_nsClientMode('find')">Find existing</button>
        <button class="nx-btn nx-btn--sm nx-btn--ghost" id="ns-cmode-new" onclick="_nsClientMode('new')">Create new</button>
      </div>
      <div id="ns-client-find">
        <input class="nx-input" id="ns-client-q" placeholder="Search name / NIC / phone…" oninput="_nsClientSearch(this.value)">
        <div id="ns-client-results" style="margin-top:var(--fk-sp-3)"></div>
      </div>
      <div id="ns-client-new" style="display:none">${_nsClientNewForm()}</div>
    </div>
  </div>
  ${_nsNav('← Back', 'Next: Deal →', _ns.client ? '_nsGoto(3)' : null, !_ns.client)}`;
}

function _nsClientNewForm() {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">
    ${NX.field({ label:'Full name', name:'ns-c-name', required:true })}
    ${NX.field({ label:'Father / Husband name', name:'ns-c-father' })}
    ${NX.field({ label:'NIC / CNIC', name:'ns-c-cnic', attrs:'oninput="_nsCnicDup(this.value)" placeholder="42101-1234567-1"' })}
    ${NX.field({ label:'Phone', name:'ns-c-phone', attrs:'placeholder="03xx-xxxxxxx"' })}
  </div>
  <div id="ns-cnic-dup" class="nx-banner nx-banner--warn" style="display:none;margin-top:var(--fk-sp-3)">${NX.icon('alert-triangle',16)}<span></span></div>
  <details style="margin-top:var(--fk-sp-3)"><summary style="cursor:pointer;font-size:13px;color:var(--fk-text-muted)">More</summary>
    <div style="margin-top:var(--fk-sp-3)">${NX.field({ label:'Address', name:'ns-c-address', el:'textarea' })}</div>
  </details>
  <div style="margin-top:var(--fk-sp-3)">${NX.button('Use this client', { variant:'primary', onclick:'_nsUseNewClient()' })}</div>
  <div id="ns-cnew-err" class="nx-error"></div>`;
}

function _nsClientMode(m) {
  document.getElementById('ns-client-find').style.display = m === 'find' ? '' : 'none';
  document.getElementById('ns-client-new').style.display  = m === 'new' ? '' : 'none';
  document.getElementById('ns-cmode-find').className = 'nx-btn nx-btn--sm ' + (m==='find'?'nx-btn--primary':'nx-btn--ghost');
  document.getElementById('ns-cmode-new').className  = 'nx-btn nx-btn--sm ' + (m==='new'?'nx-btn--primary':'nx-btn--ghost');
}

function _nsClientSearch(q) {
  const box = document.getElementById('ns-client-results');
  if (!box) return;
  const pid = _ns.unit?.projectId;
  q = (q||'').trim().toLowerCase();
  let list = (window._clientsCache || []).filter(c => !pid || c.projectId === pid);
  if (q) list = list.filter(c => `${c.fullName||''} ${c.cnic||''} ${c.phonePrimary||''}`.toLowerCase().includes(q));
  list = list.slice(0, 30);
  if (!list.length) {
    box.innerHTML = NX.empty({ icon:'search', message: q ? 'No matching client in this project. Use "Create new".' : 'Start typing, or switch to "Create new".' });
    return;
  }
  box.innerHTML = list.map(c => `<div onclick="_nsUseExisting('${c.id}')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--fk-border)">
    <div><div style="font-weight:var(--fk-fw-semibold);font-size:13px">${esc(c.fullName||'Unnamed')}</div>
      <div class="nx-kpi-label" style="text-transform:none">${c.cnic?esc(c.cnic):''}${c.phonePrimary?` · ${esc(c.phonePrimary)}`:''}</div></div>
    ${NX.button('Select', { variant:'ghost', size:'sm' })}
  </div>`).join('');
}

function _nsUseExisting(id) {
  const c = (window._clientsCache || []).find(x => x.id === id);
  if (!c) return;
  _ns.client = { id: c.id, full_name: c.fullName, cnic: c.cnic, projectId: c.projectId, isNew: false };
  _nsGoto(2);
}
function _nsClearClient() { _ns.client = null; _nsGoto(2); }

function _nsCnicDup(v) {
  const warn = document.getElementById('ns-cnic-dup');
  if (!warn) return;
  v = (v||'').trim();
  const span = warn.querySelector('span');
  if (!v) { warn.style.display = 'none'; return; }
  const pid = _ns.unit?.projectId;
  const dup = (window._clientsCache || []).find(c => (c.cnic||'').trim() === v);
  if (dup) {
    const samePj = dup.projectId === pid;
    span.textContent = `A client with this NIC already exists: ${dup.fullName||'Unnamed'}${samePj?' (this project)':' (different project)'}. ${samePj?'Consider selecting them instead of creating a duplicate.':''}`;
    warn.style.display = '';
  } else { warn.style.display = 'none'; }
}

function _nsUseNewClient() {
  const name = document.getElementById('ns-c-name')?.value?.trim();
  const err  = document.getElementById('ns-cnew-err');
  if (!name) { if (err) err.textContent = 'Full name is required.'; return; }
  if (err) err.textContent = '';
  _ns.client = {
    isNew: true,
    full_name: name,
    father_name: document.getElementById('ns-c-father')?.value?.trim() || null,
    cnic: document.getElementById('ns-c-cnic')?.value?.trim() || null,
    phone_primary: document.getElementById('ns-c-phone')?.value?.trim() || null,
    address: document.getElementById('ns-c-address')?.value?.trim() || null,
    projectId: _ns.unit?.projectId
  };
  _nsGoto(3);
}

// ── STEP 3: DEAL (list = area×rate; deal → discount live) ─────────────────
function _nsStep3() {
  const agentOpts = '<option value="">— None —</option>' +
    (_salAgents||[]).filter(a => !_ns.unit?.projectId || a.project_id === _ns.unit.projectId)
      .map(a => `<option value="${a.id}"${_ns.agentId===a.id?' selected':''}>${esc(a.full_name||'?')}</option>`).join('');
  return `<div class="nx-card">
    <div class="nx-card-title">Deal terms</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3);margin-top:var(--fk-sp-3)">
      <div class="nx-field"><label class="nx-label">Area (sqft)</label><input class="nx-input" id="ns-area" type="text" inputmode="decimal" value="${_ns.area||''}" oninput="_nsDealRecalc()"></div>
      <div class="nx-field"><label class="nx-label">Rate / sqft</label><input class="nx-input" id="ns-rate" type="text" inputmode="decimal" value="${_ns.rate||''}" oninput="_nsDealRecalc()"></div>
      <div class="nx-field"><label class="nx-label">List price (area × rate)</label><input class="nx-input" id="ns-list" readonly style="background:var(--fk-surface-2)"></div>
      <div class="nx-field"><label class="nx-label">Negotiated deal <span class="nx-req">*</span></label><input class="nx-input" id="ns-deal" type="text" inputmode="decimal" value="${_ns.deal||''}" oninput="_nsDealRecalc()" placeholder="net payable"></div>
      <div class="nx-field"><label class="nx-label">Discount (list − deal)</label><input class="nx-input" id="ns-disc" readonly style="background:var(--fk-surface-2)"></div>
      <div class="nx-field"><label class="nx-label">Booking date</label><input class="nx-input" id="ns-bkdate" type="date" value="${_ns.bookingDate}" oninput="_ns.bookingDate=this.value"></div>
      <div class="nx-field"><label class="nx-label">Sale date</label><input class="nx-input" id="ns-saledate" type="date" value="${_ns.saleDate}" oninput="_ns.saleDate=this.value"></div>
      <div class="nx-field"><label class="nx-label">Agent (optional)</label><select class="nx-select" id="ns-agent" onchange="_ns.agentId=this.value||null;_nsAgentComm()">${agentOpts}</select></div>
      <div class="nx-field"><label class="nx-label">Commission %</label><input class="nx-input" id="ns-comm" type="text" inputmode="decimal" value="${_ns.commPct||''}" oninput="_ns.commPct=parseFloat(this.value)||null"></div>
    </div>
    <div id="ns-deal-note" class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-3)"></div>
  </div>
  ${_nsNav('← Back', 'Next: Plan →', '_nsDealNext()')}`;
}

function _nsDealRecalc() {
  const area = parseAmt(document.getElementById('ns-area')?.value);
  const rate = parseAmt(document.getElementById('ns-rate')?.value);
  let deal   = parseAmt(document.getElementById('ns-deal')?.value);
  _ns.area = area; _ns.rate = rate; _ns.deal = deal;
  const list = _spRound(rate * area);
  _ns.list = list;
  let pricePerSqft, discount;
  if (deal > 0 && deal >= list && area > 0) {
    // deal ≥ list → silently recompute rate, no discount (spec rule)
    pricePerSqft = _spRound(deal / area);
    discount = 0;
  } else {
    pricePerSqft = rate;
    discount = deal > 0 ? _spRound(list - deal) : 0;
  }
  // net == the DB GENERATED formula so the schedule ties to the real net
  const net = _spRound(_spRound(pricePerSqft * area) - discount);
  _ns.pricePerSqft = pricePerSqft; _ns.discount = Math.max(0, discount); _ns.net = net;
  const listEl = document.getElementById('ns-list'); if (listEl) listEl.value = list ? fMF(list) : '';
  const discEl = document.getElementById('ns-disc'); if (discEl) discEl.value = fMF(_ns.discount);
  const note = document.getElementById('ns-deal-note');
  if (note) {
    if (deal > 0 && deal >= list && list > 0) note.innerHTML = `Deal ≥ list — rate recomputed to ${fMF(pricePerSqft)}/sqft, discount 0. Net payable: <strong>${fMF(net)}</strong>`;
    else if (deal > 0) note.innerHTML = `Net payable: <strong>${fMF(net)}</strong>${_ns.discount>0?` (discount ${fMF(_ns.discount)})`:''}`;
    else note.textContent = '';
  }
}
function _nsAgentComm() {
  const a = (_salAgents||[]).find(x => x.id === _ns.agentId);
  if (a && a.commission_percent != null && !document.getElementById('ns-comm').value) {
    document.getElementById('ns-comm').value = a.commission_percent;
    _ns.commPct = Number(a.commission_percent);
  }
}
function _nsDealNext() {
  _nsDealRecalc();
  if (!(_ns.net > 0)) { toast('Enter area, rate and a valid deal amount', 'warn'); return; }
  _nsGoto(4);
}

// ── STEP 4: PLAN (template + live preview + tie-out) ──────────────────────
function _nsStep4() {
  const tpl = _ns.tpl;
  const tplBtn = (v, l) => `<button class="nx-btn nx-btn--sm ${tpl===v?'nx-btn--primary':'nx-btn--ghost'}" onclick="_nsSetTpl('${v}')">${l}</button>`;
  let params;
  if (tpl === 'custom') {
    params = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--fk-sp-3)">
      <div class="nx-field"><label class="nx-label">Booking amount</label><input class="nx-input" id="ns-p-bookamt" type="text" inputmode="decimal" value="${_ns.custom.bookingAmt||''}" oninput="_nsPlanChange()"></div>
      <div class="nx-field"><label class="nx-label">Monthly amount</label><input class="nx-input" id="ns-p-monthamt" type="text" inputmode="decimal" value="${_ns.custom.monthlyAmt||''}" oninput="_nsPlanChange()"></div>
      <div class="nx-field"><label class="nx-label"># Months</label><input class="nx-input" id="ns-p-months" type="number" min="0" value="${_ns.custom.months||''}" oninput="_nsPlanChange()"></div>
      <div class="nx-field" style="grid-column:1/4"><label class="nx-label">First installment date</label><input class="nx-input" id="ns-p-start" type="date" value="${_ns.startDate}" oninput="_nsPlanChange()"></div>
    </div>
    <div class="nx-kpi-label" style="text-transform:none;margin-top:6px">Remainder (net − booking − Σmonthly) is absorbed into the last monthly line automatically.</div>`;
  } else {
    params = `<div style="display:grid;grid-template-columns:repeat(${tpl==='possession'?4:3},1fr);gap:var(--fk-sp-3)">
      <div class="nx-field"><label class="nx-label">Booking %</label><input class="nx-input" id="ns-p-bookpct" type="number" min="0" max="100" step="0.5" value="${_ns.bookingPct}" oninput="_nsPlanChange()"></div>
      <div class="nx-field"><label class="nx-label"># Monthly installments</label><input class="nx-input" id="ns-p-months" type="number" min="1" value="${_ns.months}" oninput="_nsPlanChange()"></div>
      ${tpl==='possession'?`<div class="nx-field"><label class="nx-label">Possession %</label><input class="nx-input" id="ns-p-posspct" type="number" min="0" max="100" step="0.5" value="${_ns.possessionPct}" oninput="_nsPlanChange()"></div>`:''}
      <div class="nx-field"><label class="nx-label">First installment date</label><input class="nx-input" id="ns-p-start" type="date" value="${_ns.startDate}" oninput="_nsPlanChange()"></div>
    </div>`;
  }
  return `<div class="nx-card">
    <div class="nx-card-title">Payment plan <span class="nx-kpi-label" style="text-transform:none">· net ${fMF(_ns.net)}</span></div>
    <div class="nx-segment" style="margin:var(--fk-sp-3) 0">${tplBtn('equal','Booking % + equal monthly')}${tplBtn('possession','Booking % + monthly + possession %')}${tplBtn('custom','Custom')}</div>
    ${params}
    <div id="ns-tieout" style="margin-top:var(--fk-sp-3)"></div>
    <div id="ns-plan-preview" style="margin-top:var(--fk-sp-3)"></div>
  </div>
  ${_nsNav('← Back', 'Next: Review →', '_nsPlanNext()', true)}`;
}

function _nsSetTpl(v) { _ns.tpl = v; _nsRenderStep(); }

function _nsReadPlanParams() {
  _ns.startDate = document.getElementById('ns-p-start')?.value || _ns.startDate;
  if (_ns.tpl === 'custom') {
    _ns.custom.bookingAmt = parseAmt(document.getElementById('ns-p-bookamt')?.value);
    _ns.custom.monthlyAmt = parseAmt(document.getElementById('ns-p-monthamt')?.value);
    _ns.custom.months     = parseInt(document.getElementById('ns-p-months')?.value) || 0;
    return { bookingAmt:_ns.custom.bookingAmt, monthlyAmt:_ns.custom.monthlyAmt, months:_ns.custom.months,
             startDate:_ns.startDate, bookingDate:_ns.bookingDate };
  }
  _ns.bookingPct    = parseFloat(document.getElementById('ns-p-bookpct')?.value) || 0;
  _ns.months        = parseInt(document.getElementById('ns-p-months')?.value) || 0;
  _ns.possessionPct = _ns.tpl === 'possession' ? (parseFloat(document.getElementById('ns-p-posspct')?.value) || 0) : 0;
  return { bookingPct:_ns.bookingPct, months:_ns.months, possessionPct:_ns.possessionPct,
           startDate:_ns.startDate, bookingDate:_ns.bookingDate };
}

function _nsPlanChange() {
  const p = _nsReadPlanParams();
  // validation: booking%+possession% must be < 100, months>=1
  let warnMsg = '';
  if (_ns.tpl !== 'custom') {
    if (p.months < 1) warnMsg = 'Enter at least 1 monthly installment.';
    else if ((p.bookingPct + p.possessionPct) >= 100) warnMsg = 'Booking % + possession % must be under 100%.';
  } else if (p.months < 1 && !(p.bookingAmt > 0)) warnMsg = 'Enter booking and/or monthly installments.';

  _ns.plan = warnMsg ? [] : _spGenerate(_ns.net, _ns.tpl, p);
  const sum = _spSum(_ns.plan);
  const matches = !warnMsg && _ns.plan.length && Math.abs(sum - _ns.net) < 0.01;

  const tie = document.getElementById('ns-tieout');
  if (tie) {
    if (warnMsg) tie.innerHTML = NX.banner(warnMsg, 'warn');
    else if (matches) tie.innerHTML = `<div class="nx-banner nx-banner--info" style="background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.35);color:var(--fk-success)">${NX.icon('check',16)}<span><strong>Plan = Deal ✓</strong> — schedule totals ${fMF(sum)}, exactly the net payable.</span></div>`;
    else tie.innerHTML = NX.banner(`Schedule ${fMF(sum)} ≠ net ${fMF(_ns.net)}`, 'danger');
  }
  _nsRenderPreview();
  // toggle Next button
  const nextBtn = document.querySelector('#ns-body .nx-btn--primary[onclick="_nsPlanNext()"]');
  if (nextBtn) { nextBtn.disabled = !matches; }
}

function _nsRenderPreview() {
  const box = document.getElementById('ns-plan-preview');
  if (!box) return;
  if (!_ns.plan.length) { box.innerHTML = ''; return; }
  let run = 0, instN = 0;
  const cols = [{label:'#'},{label:'Type'},{label:'Due'},{label:'Amount',num:true},{label:'Cumulative',num:true}];
  const rows = _ns.plan.map(l => {
    run += l.amount;
    const isBk = l.type === 'down_payment';
    let num; if (isBk) num = 'Bk'; else { instN++; num = instN; }
    const tone = isBk ? 'primary' : l.type === 'possession' ? 'success' : '';
    const tlabel = isBk ? 'Booking' : l.type === 'possession' ? 'Possession' : l.type === 'custom' ? esc(l.label) : 'Installment';
    return [ num, NX.badge(tlabel, tone), fD(l.due), fMF(l.amount), `<span style="color:var(--fk-text-muted)">${fMF(run)}</span>` ];
  });
  box.innerHTML = `<div class="nx-table-wrap" style="max-height:320px;overflow:auto">${NX.table({ cols, rows })}</div>
    <div style="display:flex;justify-content:flex-end;gap:18px;margin-top:8px;font-size:13px">
      <span class="nx-kpi-label" style="text-transform:none">${_ns.plan.length} lines · ${_spMonthlyCount(_ns.plan)} installments</span>
      <span><strong>Total ${fMF(_spSum(_ns.plan))}</strong></span></div>`;
}

function _nsPlanNext() {
  _nsPlanChange();
  if (!_ns.plan.length || Math.abs(_spSum(_ns.plan) - _ns.net) >= 0.01) { toast('Plan must equal the net payable', 'warn'); return; }
  _nsGoto(5);
}

// ── STEP 5: REVIEW & CREATE ───────────────────────────────────────────────
function _nsStep5() {
  const c = _ns.client || {};
  const agent = (_salAgents||[]).find(a => a.id === _ns.agentId);
  const booking = _spBooking(_ns.plan);
  const row = (l, v) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--fk-border)"><span class="nx-kpi-label" style="text-transform:none">${l}</span><span style="font-weight:var(--fk-fw-semibold)">${v}</span></div>`;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-4)">
    <div class="nx-card">
      <div class="nx-card-title">Sale summary</div>
      <div style="margin-top:var(--fk-sp-3)">
        ${row('Unit', esc(_ns.unit?.unitNo||'—') + (_ns.unit?.floorLabel?` · ${esc(_ns.unit.floorLabel)}`:''))}
        ${row('Client', esc(c.full_name||c.fullName||'—') + (c.isNew?' <span class="nx-chip">new</span>':''))}
        ${c.cnic?row('NIC', esc(c.cnic)):''}
        ${agent?row('Agent', esc(agent.full_name) + (_ns.commPct?` · ${_ns.commPct}%`:'')):''}
        ${row('Sale date', fD(_ns.saleDate))}
      </div>
    </div>
    <div class="nx-card">
      <div class="nx-card-title">Deal & plan</div>
      <div style="margin-top:var(--fk-sp-3)">
        ${row('List price', fMF(_ns.list))}
        ${_ns.discount>0?row('Discount', '− ' + fMF(_ns.discount)):''}
        ${row('Net payable', fMF(_ns.net))}
        ${row('Booking / down', fMF(booking))}
        ${row('Installments', _spMonthlyCount(_ns.plan) + ' lines')}
        ${row('Schedule total', `<span style="color:var(--fk-success)">${fMF(_spSum(_ns.plan))} ✓</span>`)}
      </div>
    </div>
  </div>
  <div id="ns-create-err" class="nx-error" style="margin-top:var(--fk-sp-3)"></div>
  <div style="display:flex;justify-content:space-between;gap:10px;margin-top:var(--fk-sp-4)">
    ${NX.button('← Back', { variant:'ghost', onclick:'_nsBack()' })}
    ${NX.button('Create sale', { variant:'primary', onclick:'_nsCreate()', attrs:'id="ns-create-btn"' })}
  </div>`;
}

async function _nsCreate() {
  const cid = S?.cid;
  if (!cid || !_ns) return;
  const btn = document.getElementById('ns-create-btn');
  const err = document.getElementById('ns-create-err');
  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.querySelector('span') && (btn.querySelector('span').textContent = 'Creating…'); }

  try {
    // 1. Resolve client (create inline if new) — project_id MUST match the unit's project
    let clientId = _ns.client?.id;
    if (_ns.client?.isNew) {
      const cres = await supabase.rpc('create_client', { p_data: {
        company_id: cid, project_id: _ns.unit.projectId,
        full_name: _ns.client.full_name, father_name: _ns.client.father_name,
        cnic: _ns.client.cnic, phone_primary: _ns.client.phone_primary,
        address: _ns.client.address, status: 'active', created_by: S.userId || null
      }});
      if (cres.error) throw cres.error;
      if (!cres.data?.success && !cres.data?.id) throw new Error(cres.data?.error || 'Client create failed');
      clientId = cres.data.id || cres.data.client_id || cres.data.client?.id;
      if (!clientId) throw new Error('Client created but no id returned');
      if (typeof loadClientsCache === 'function') { try { await loadClientsCache(cid); } catch(e){} }
    }
    if (!clientId) throw new Error('No client selected');

    // 2. Build installments from the plan (booking → installment_number 0; rest 1..N)
    let n = 0;
    const installments = _ns.plan.map(l => {
      let num, itype, notes = null;
      if (l.type === 'down_payment') { num = 0; itype = 'down_payment'; }
      else { n++; num = n; itype = (l.type === 'installment') ? 'installment' : l.type;
             if (l.type !== 'installment') notes = l.label; }
      return { installment_number: num, due_date: l.due, amount_due: l.amount, installment_type: itype, notes };
    });

    // 3. Tie-out asserts (binding note #2): header can never disagree with schedule
    const booking = _spBooking(_ns.plan);
    const monthlyCount = _spMonthlyCount(_ns.plan);

    const pSale = {
      company_id: cid, unit_id: _ns.unit.id, client_id: clientId,
      agent_id: _ns.agentId || null,
      sale_date: _ns.saleDate,
      price_per_sqft: _ns.pricePerSqft, area_sqft: _ns.area, discount: _ns.discount,
      down_payment: booking,                 // == booking line amount_due
      installment_count: monthlyCount,       // == count of non-booking lines
      created_by: S.userId || null,
      commission_rate: _ns.commPct || null
    };

    const { data, error } = await supabase.rpc('create_sale_with_schedule', { p_sale: pSale, p_installments: installments });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error === 'cross_project_client' ? 'Client is not in the unit\'s project.' : (data?.detail || data?.error || 'Create failed'));

    if (typeof loadUnitsCache === 'function') { try { await loadUnitsCache(cid); } catch(e){} }
    toast(`Sale ${data.sale_number} created`, 'ok');
    _ns = null;
    openSaleDetail(data.sale_id);
  } catch (e) {
    if (err) err.textContent = 'Could not create sale: ' + (e.message || e);
    if (btn) { btn.disabled = false; const sp = btn.querySelector('span'); if (sp) sp.textContent = 'Create sale'; }
  }
}
