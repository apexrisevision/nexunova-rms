// ══ PROMISE TO PAY MODULE ══════════════════════════════════════

let _prmAllData      = [];
let _prmTab          = 'overdue';
let _prmStats        = null;
let _prmActingId     = null;
let _prmClientsCache = [];

// ── Entry point ────────────────────────────────────────────────
async function rPromises() {
  const pg = document.getElementById('pg-promises');
  if (!pg) return;

  _prmAllData = []; _prmStats = null;

  pg.innerHTML = `<div class="ani">
    ${NX.pageHeader('Promise to Pay',
      NX.button('Log Promise', { variant:'primary', icon:'plus', onclick:'prmLogNew()' }) +
      NX.button('Analytics',   { variant:'secondary', size:'sm', onclick:'prmOpenAnalytics()' }) +
      NX.button('Refresh',     { variant:'ghost', size:'sm', onclick:'_prmLoad()' }),
      { icon:'clock', tone:'warning', sub:'Track client commitments and recovery promises' })}
    <div id="prm-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;margin-bottom:20px">
      ${[...Array(5)].map(()=>NX.kpi({label:'Loading…',value:'—'})).join('')}
    </div>
    <div id="prm-tabs" style="margin-bottom:14px"></div>
    <div id="prm-alert"></div>
    <div id="prm-body"><div style="padding:48px;text-align:center;color:var(--fk-text-muted);font-size:13px">Loading…</div></div>
  </div>`;

  _prmEnsureModals();
  await _prmLoad();
}

// ── Data loading ───────────────────────────────────────────────
async function _prmLoad() {
  try {
    const [{ data: allData, error: e1 }, { data: statsData, error: e2 }] = await Promise.all([
      supabase.rpc('get_all_promises',  { p_company_id: S.cid }),
      supabase.rpc('get_promise_stats', { p_company_id: S.cid, p_days: 30 })
    ]);
    if (e1) throw e1;
    _prmAllData = Array.isArray(allData) ? allData : [];
    _prmStats   = statsData || {};
    _prmRenderStats();
    _prmRenderTabs();
    _prmRenderDueAlert();
    _prmRender();
  } catch(e) {
    const body = document.getElementById('prm-body');
    if (body) body.innerHTML = NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load') }));
  }
}

// ── Stats strip ────────────────────────────────────────────────
function _prmRenderStats() {
  const el = document.getElementById('prm-stats');
  if (!el) return;
  const s = _prmStats || {};
  const today   = _prmAllData.filter(p => p.status==='pending' && p.promise_date===_prmToday());
  const overdue = _prmAllData.filter(p => p.status==='pending' && p.promise_date<_prmToday());
  const todayAmt   = today.reduce((acc,p)=>acc+Number(p.promised_amount||0),0);
  const overdueAmt = overdue.reduce((acc,p)=>acc+Number(p.promised_amount||0),0);

  el.innerHTML = [
    NX.kpi({ label:'Today',      value: today.length,             delta: 'PKR '+fM(todayAmt),                  dot:'primary' }),
    NX.kpi({ label:'Overdue',    value: overdue.length,            delta: 'PKR '+fM(overdueAmt),                 dot:'danger' }),
    NX.kpi({ label:'Kept (30d)', value: s.kept||0,                 delta: (s.kept_percent||0)+'% rate',           dot:'success' }),
    NX.kpi({ label:'Broken',     value: s.broken||0,               delta: (s.broken_percent||0)+'% rate',         dot:'warning' }),
    NX.kpi({ label:'Recovery %', value: (s.recovery_rate||0)+'%',  delta: 'PKR '+fM(s.total_kept_amount||0),      dot:'info' }),
  ].join('');
}

// ── Tabs ───────────────────────────────────────────────────────
function _prmTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

const _prmTabCfg = [
  { key:'overdue',  label:'Overdue',      fn: p => p.status==='pending' && p.promise_date<_prmToday() },
  { key:'today',    label:'Today',        fn: p => p.status==='pending' && p.promise_date===_prmToday() },
  { key:'tomorrow', label:'Due Tomorrow', fn: p => p.status==='pending' && p.promise_date===_prmTomorrow() },
  { key:'upcoming', label:'Upcoming',     fn: p => p.status==='pending' && p.promise_date>_prmToday() },
  { key:'kept',     label:'Kept',         fn: p => p.status==='kept'||p.status==='partial' },
  { key:'broken',   label:'Broken',       fn: p => p.status==='broken' },
  { key:'all',      label:'All',          fn: () => true },
];

function _prmToday() { return new Date().toISOString().split('T')[0]; }

function _prmFiltered() {
  const cfg = _prmTabCfg.find(t => t.key===_prmTab);
  return cfg ? _prmAllData.filter(cfg.fn) : _prmAllData;
}

function _prmRenderTabs() {
  const el = document.getElementById('prm-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({
    tabs: _prmTabCfg.map(t => ({ k: t.key, label: t.label, count: _prmAllData.filter(t.fn).length })),
    active: _prmTab,
    onSelect: "prmSetTab('%k')"
  });
}

function prmSetTab(tab) {
  _prmTab = tab;
  _prmRenderTabs();
  _prmRenderDueAlert();
  _prmRender();
}

function _prmRenderDueAlert() {
  const el = document.getElementById('prm-alert');
  if (!el) return;
  const todayList    = _prmAllData.filter(p => p.status==='pending' && p.promise_date===_prmToday());
  const tomorrowList = _prmAllData.filter(p => p.status==='pending' && p.promise_date===_prmTomorrow());

  if (!todayList.length && !tomorrowList.length) { el.innerHTML = ''; return; }

  const chips = [];
  if (todayList.length) {
    const amt = todayList.reduce((s,p)=>s+Number(p.promised_amount||0),0);
    chips.push(`<span onclick="prmSetTab('today')" style="cursor:pointer">${NX.badge(todayList.length+' promise'+(todayList.length>1?'s':'')+' due today — PKR '+fM(amt), 'warning')}</span>`);
  }
  if (tomorrowList.length) {
    const amt = tomorrowList.reduce((s,p)=>s+Number(p.promised_amount||0),0);
    chips.push(`<span onclick="prmSetTab('tomorrow')" style="cursor:pointer">${NX.badge(tomorrowList.length+' due tomorrow — PKR '+fM(amt), '')}</span>`);
  }
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chips.join('')}</div>`;
}

// ── Table render ───────────────────────────────────────────────
function _prmRender() {
  const body = document.getElementById('prm-body');
  if (!body) return;
  const rows = _prmFiltered();

  if (!rows.length) {
    const msgs = {
      overdue:'No overdue promises — good standing!', today:'No promises due today',
      tomorrow:'No promises due tomorrow', upcoming:'No upcoming promises logged',
      kept:'No kept promises yet', broken:'No broken promises', all:'No promises logged yet'
    };
    const goodTabs = new Set(['overdue','broken']);
    body.innerHTML = NX.card(NX.empty({
      icon: goodTabs.has(_prmTab) ? 'check-circle' : 'clock',
      tone: goodTabs.has(_prmTab) ? 'success' : undefined,
      message: msgs[_prmTab] || 'No data',
      action: _prmTab==='all' ? NX.button('Log First Promise', { variant:'primary', icon:'plus', onclick:'prmLogNew()' }) : ''
    }));
    return;
  }

  body.innerHTML = NX.card(`
    <table class="nx-table">
      <thead><tr>
        <th style="width:110px">Status</th>
        <th>Client</th>
        <th class="hide-sm">Property</th>
        <th class="num">Amount</th>
        <th>Date</th>
        <th class="hide-sm">Via</th>
        <th class="hide-sm">Officer</th>
        <th style="width:10px"></th>
      </tr></thead>
      <tbody>${rows.map(_prmRow).join('')}</tbody>
    </table>`, { flush: true });
}

function _prmRow(p) {
  const today = _prmToday();
  const isOverdue = p.status==='pending' && p.promise_date < today;
  const isToday   = p.status==='pending' && p.promise_date === today;

  let statusBadge;
  if (p.status==='pending') {
    statusBadge = isOverdue ? NX.badge('Overdue','danger',{dot:true})
                            : isToday ? NX.badge('Today','warning',{dot:true})
                                      : NX.badge('Pending','',{dot:true});
  } else {
    const bMap = {
      kept:      NX.badge('Kept','success',{dot:true}),
      partial:   NX.badge('Partial','success',{dot:true}),
      broken:    NX.badge('Broken','danger',{dot:true}),
      postponed: NX.badge('Postponed','',{dot:true}),
      cancelled: NX.badge('Cancelled','',{dot:true}),
    };
    statusBadge = bMap[p.status] || NX.badge(p.status,'');
  }

  const daysNum = Math.round((new Date(p.promise_date)-new Date(today))/86400000);
  const daysLbl = daysNum===0
    ? `<span style="color:var(--fk-warning);font-size:11px;font-weight:600">Today</span>`
    : daysNum>0
    ? `<span style="color:var(--fk-success);font-size:11px">in ${daysNum}d</span>`
    : `<span style="color:var(--fk-danger);font-size:11px">${Math.abs(daysNum)}d ago</span>`;

  const prop = [p.project_name, p.unit_info].filter(Boolean).join(' · ') || '—';
  const remCount = p.reminder_sent_count || 0;

  let actions = '';
  if (p.status==='pending') {
    actions = `
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="prmMarkKept('${p.id}',${p.promised_amount})">Kept</button>
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="prmMarkBroken('${p.id}')">Broken</button>
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="prmPostpone('${p.id}','${p.promise_date}')">Postpone</button>
      <button class="nx-btn nx-btn--ghost nx-btn--sm" onclick="prmSendWA('${p.id}')" title="Send WhatsApp reminder">${NX.icon('message-circle',13)}</button>`;
  } else if (p.status==='kept'||p.status==='partial') {
    actions = `<span class="num" style="font-size:12px;color:var(--fk-success)">PKR ${fM(p.actual_paid_amount||0)}</span>`;
  } else if (p.status==='broken') {
    actions = `<span style="font-size:11px;color:var(--fk-text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;display:inline-block;white-space:nowrap;vertical-align:middle" title="${esc(p.broken_reason||'')}">${esc((p.broken_reason||'—').substring(0,20))}${(p.broken_reason||'').length>20?'…':''}</span>`;
  }

  return `<tr>
    <td>${statusBadge}</td>
    <td>
      <div style="font-weight:600;font-size:13px">${esc(p.client_name||'—')}</div>
      <div style="font-size:11px;color:var(--fk-text-muted)">${esc(p.client_phone||'—')}</div>
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(prop)}</td>
    <td class="num" style="font-weight:600;font-size:13px">PKR ${fM(p.promised_amount||0)}</td>
    <td>
      <div style="font-size:12px">${fD(p.promise_date)}${remCount>0?` <span class="nx-chip">${remCount}×</span>`:''}</div>
      <div>${daysLbl}</div>
    </td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(p.promised_via||'—')}</td>
    <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(p.logged_by||'—')}</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:right">${actions}</td>
  </tr>`;
}

// ── Modals (host-injected once) ────────────────────────────────
function _prmEnsureModals() {
  if (document.getElementById('m-prm-log')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div id="m-prm-log" class="mov">
    <div class="nx-modal nx-modal--m">
      <div class="nx-modal-header">
        <h3 class="nx-modal-title">Log Payment Promise</h3>
        <button class="nx-modal-close" onclick="cm('m-prm-log')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body" id="m-prm-log-body">
        <div style="padding:28px;text-align:center;color:var(--fk-text-muted)">Loading…</div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',       { variant:'ghost',    onclick:"cm('m-prm-log')" })}
        ${NX.button('Log Promise',  { variant:'primary',  attrs:'id="prm-log-save-btn"', onclick:'prmSubmitNew()' })}
      </div>
    </div>
  </div>

  <div id="m-prm-kept" class="mov">
    <div class="nx-modal nx-modal--s">
      <div class="nx-modal-header">
        <div>
          <h3 class="nx-modal-title">Mark Promise Kept</h3>
          <p class="nx-modal-sub" id="m-prm-kept-sub"></p>
        </div>
        <button class="nx-modal-close" onclick="cm('m-prm-kept')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body">
        <div class="nx-field">
          <label class="nx-label" for="prm-k-amount">Actual Amount Received (PKR) <span class="nx-req">*</span></label>
          <input class="nx-input" type="number" id="prm-k-amount" min="1" placeholder="0" oninput="_prmKeptPartialCheck()">
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="prm-k-date">Payment Date</label>
          <input class="nx-input" type="date" id="prm-k-date">
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="prm-k-via">Payment Method</label>
          <select class="nx-select" id="prm-k-via">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="jazzcash">JazzCash</option>
            <option value="easypaisa">EasyPaisa</option>
          </select>
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="prm-k-notes">Notes</label>
          <textarea class="nx-textarea" id="prm-k-notes" rows="2" placeholder="Optional…"></textarea>
          <div class="nx-error"></div>
        </div>
        <div id="prm-k-partial-note" style="display:none;padding:8px 12px;border-radius:var(--fk-radius-control);background:var(--fk-warning-surface,rgba(217,119,6,.08));border:1px solid var(--fk-warning-edge,rgba(217,119,6,.25));font-size:12px;color:var(--fk-warning);margin-top:4px">
          Amount less than promised — will be marked as <b>PARTIAL</b>
        </div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',        { variant:'ghost',    onclick:"cm('m-prm-kept')" })}
        ${NX.button('Confirm Kept',  { variant:'primary',  attrs:'id="prm-kept-save-btn"', onclick:'prmSubmitKept()' })}
      </div>
    </div>
  </div>

  <div id="m-prm-broken" class="mov">
    <div class="nx-modal nx-modal--s">
      <div class="nx-modal-header">
        <div>
          <h3 class="nx-modal-title">Mark Promise Broken</h3>
          <p class="nx-modal-sub" id="m-prm-broken-sub"></p>
        </div>
        <button class="nx-modal-close" onclick="cm('m-prm-broken')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body">
        ${NX.banner('This will reduce the client\'s Health Score by 20 points.','warn')}
        <div class="nx-field" style="margin-top:12px">
          <label class="nx-label" for="prm-b-reason">Reason <span class="nx-req">*</span></label>
          <select class="nx-select" id="prm-b-reason">
            <option value="">— Select reason —</option>
            <option value="Client unreachable">Client unreachable</option>
            <option value="Client refused to pay">Client refused to pay</option>
            <option value="Client cited financial hardship">Client cited financial hardship</option>
            <option value="Family member denied promise">Family member denied promise</option>
            <option value="Cheque issue">Cheque issue</option>
            <option value="Other">Other</option>
          </select>
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="prm-b-detail">Details</label>
          <textarea class="nx-textarea" id="prm-b-detail" rows="3" placeholder="Add more detail about why the promise was broken…"></textarea>
          <div class="nx-error"></div>
        </div>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',          { variant:'ghost',       onclick:"cm('m-prm-broken')" })}
        ${NX.button('Confirm Broken',  { variant:'danger',      attrs:'id="prm-broken-save-btn"', onclick:'prmSubmitBroken()' })}
      </div>
    </div>
  </div>

  <div id="m-prm-postpone" class="mov">
    <div class="nx-modal nx-modal--s">
      <div class="nx-modal-header">
        <div>
          <h3 class="nx-modal-title">Postpone Promise</h3>
          <p class="nx-modal-sub" id="m-prm-postpone-sub"></p>
        </div>
        <button class="nx-modal-close" onclick="cm('m-prm-postpone')">${NX.icon('x',16)}</button>
      </div>
      <div class="nx-modal-body">
        <div class="nx-field">
          <label class="nx-label" for="prm-pp-date">New Promise Date <span class="nx-req">*</span></label>
          <input class="nx-input" type="date" id="prm-pp-date">
          <div class="nx-error"></div>
        </div>
        <div class="nx-field">
          <label class="nx-label" for="prm-pp-reason">Reason</label>
          <textarea class="nx-textarea" id="prm-pp-reason" rows="2" placeholder="Client asked for more time because…"></textarea>
          <div class="nx-error"></div>
        </div>
        <p style="font-size:11px;color:var(--fk-text-muted);margin:4px 0 0">A new promise with the new date will be created automatically.</p>
      </div>
      <div class="nx-modal-footer">
        ${NX.button('Cancel',           { variant:'ghost',   onclick:"cm('m-prm-postpone')" })}
        ${NX.button('Confirm Postpone', { variant:'primary', attrs:'id="prm-postpone-save-btn"', onclick:'prmSubmitPostpone()' })}
      </div>
    </div>
  </div>`;

  while (div.firstChild) document.body.appendChild(div.firstChild);
}

// ── Log New Promise ────────────────────────────────────────────
async function prmLogNew(prefill) {
  prefill = prefill || {};
  _prmEnsureModals();

  const body = document.getElementById('m-prm-log-body');
  if (!body) return;
  body.innerHTML = `<div style="padding:28px;text-align:center;color:var(--fk-text-muted)">Loading clients…</div>`;
  om('m-prm-log');

  if (!_prmClientsCache.length) {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _prmClientsCache = (data || []).map(c => ({
      id: c.id, full_name: c.full_name, phone_primary: c.phone_primary, client_code: c.client_code
    }));
  }

  const next7 = new Date(Date.now()+86400000*7).toISOString().split('T')[0];
  const today  = new Date().toISOString().split('T')[0];

  body.innerHTML = `
    <div class="nx-field">
      <label class="nx-label" for="prm-l-client">Client <span class="nx-req">*</span></label>
      <select class="nx-select" id="prm-l-client" onchange="prmOnClientChange(this.value)">
        <option value="">— Select client —</option>
        ${_prmClientsCache.map(c=>`<option value="${c.id}" ${prefill.clientId===c.id?'selected':''}>${esc(c.full_name||'')} (${esc(c.client_code||'')})</option>`).join('')}
      </select>
      <div class="nx-error"></div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="prm-l-sale">Sale / Property</label>
      <select class="nx-select" id="prm-l-sale" onchange="prmOnSaleChange(this.value)">
        <option value="">— Select client first —</option>
      </select>
      <div class="nx-error"></div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="prm-l-inst">Installment (optional)</label>
      <select class="nx-select" id="prm-l-inst" onchange="prmOnInstChange(this)">
        <option value="">— No specific installment —</option>
      </select>
      <div class="nx-error"></div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="prm-l-amount">Promised Amount (PKR) <span class="nx-req">*</span></label>
      <input class="nx-input" type="number" id="prm-l-amount" min="1" value="${esc(String(prefill.amount||''))}" placeholder="e.g. 500000">
      <div class="nx-error" id="prm-l-hint"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="prm-l-date">Promise Date <span class="nx-req">*</span></label>
        <input class="nx-input" type="date" id="prm-l-date" value="${next7}" min="${today}">
        <div class="nx-error"></div>
      </div>
      <div class="nx-field">
        <label class="nx-label" for="prm-l-via">Promised Via</label>
        <select class="nx-select" id="prm-l-via">
          <option value="call">Phone Call</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="visit">Visit</option>
          <option value="meeting">Meeting</option>
          <option value="email">Email</option>
        </select>
        <div class="nx-error"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="nx-field">
        <label class="nx-label" for="prm-l-by">Promised By (client side)</label>
        <input class="nx-input" type="text" id="prm-l-by" value="${esc(prefill.promisedBy||'Client himself')}" placeholder="Client himself / Wife…">
        <div class="nx-error"></div>
      </div>
      <div class="nx-field">
        <label class="nx-label" for="prm-l-logged">Logged By</label>
        <input class="nx-input" type="text" id="prm-l-logged" value="${esc(S.name||S.username||'')}" readonly style="opacity:.7;cursor:not-allowed">
        <div class="nx-error" style="color:var(--fk-text-muted)">Recorded automatically as the logged-in officer.</div>
      </div>
    </div>
    <div class="nx-field">
      <label class="nx-label" for="prm-l-notes">Notes</label>
      <textarea class="nx-textarea" id="prm-l-notes" rows="2" placeholder="Client said salary aayega 15 ko, payment same day…">${esc(prefill.notes||'')}</textarea>
      <div class="nx-error"></div>
    </div>`;

  if (prefill.clientId) {
    const sel = document.getElementById('prm-l-client');
    if (sel) { sel.value = prefill.clientId; await prmOnClientChange(prefill.clientId); }
  }
}

async function prmOnClientChange(clientId) {
  const saleSel = document.getElementById('prm-l-sale');
  const instSel = document.getElementById('prm-l-inst');
  if (!saleSel) return;
  if (!clientId) {
    saleSel.innerHTML = '<option value="">— Select client first —</option>';
    if (instSel) instSel.innerHTML = '<option value="">— No specific installment —</option>';
    return;
  }
  saleSel.innerHTML = '<option value="">Loading…</option>';
  const { data: sales } = await supabase.rpc('list_sales_by_client', { p_client_id: clientId, p_company_id: S.cid });

  saleSel.innerHTML = '<option value="">— No specific sale —</option>' +
    (sales||[]).map(s => {
      const u = s.units?.unit_no||'';
      const p = s.projects?.project_name||'';
      return `<option value="${s.id}">${esc(p)}${u?' · '+esc(u):''} (${esc(s.sale_number||'')})</option>`;
    }).join('');

  if ((sales||[]).length===1) {
    saleSel.value = sales[0].id;
    await prmOnSaleChange(sales[0].id);
  }
}

async function prmOnSaleChange(saleId) {
  const instSel  = document.getElementById('prm-l-inst');
  const amtInput = document.getElementById('prm-l-amount');
  const hint     = document.getElementById('prm-l-hint');
  if (!instSel) return;
  if (!saleId) {
    instSel.innerHTML = '<option value="">— No specific installment —</option>';
    return;
  }
  instSel.innerHTML = '<option value="">Loading…</option>';
  const { data: insts } = await supabase.rpc('list_open_installments_for_sale', { p_sale_id: saleId, p_company_id: S.cid });

  const totalOut = (insts||[]).reduce((s,i)=>s+Math.max(0,(i.amount_due||0)-(i.amount_paid||0)),0);
  instSel.innerHTML = '<option value="">— No specific installment —</option>' +
    (insts||[]).map(i => {
      const out = Math.max(0,(i.amount_due||0)-(i.amount_paid||0));
      return `<option value="${i.id}" data-out="${out}">
        #${i.installment_number||'?'} · ${fD(i.due_date)} · PKR ${fM(out)} outstanding
      </option>`;
    }).join('');

  if (hint) hint.textContent = totalOut>0 ? `Total outstanding: PKR ${fM(totalOut)}` : '';
  if (amtInput && !amtInput.value && totalOut>0) amtInput.value = totalOut;
}

function prmOnInstChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const out = parseFloat(opt?.dataset?.out||0);
  const amtEl = document.getElementById('prm-l-amount');
  if (out>0 && amtEl) amtEl.value = out;
}

async function prmSubmitNew() {
  const clientId  = document.getElementById('prm-l-client')?.value;
  const saleId    = document.getElementById('prm-l-sale')?.value||null;
  const instId    = document.getElementById('prm-l-inst')?.value||null;
  const amount    = parseFloat(document.getElementById('prm-l-amount')?.value||0);
  const pdate     = document.getElementById('prm-l-date')?.value;
  const via       = document.getElementById('prm-l-via')?.value||'call';
  const byClient  = document.getElementById('prm-l-by')?.value?.trim()||'';
  const loggedBy  = document.getElementById('prm-l-logged')?.value?.trim()||'';
  const notes     = document.getElementById('prm-l-notes')?.value?.trim()||null;

  if (!clientId) { notify.error('Please select a client.'); return; }
  if (!amount||amount<=0) { notify.error('Please enter a valid amount.'); return; }
  if (!pdate) { notify.error('Please enter a promise date.'); return; }

  const btn = document.getElementById('prm-log-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const { data, error } = await supabase.rpc('log_payment_promise', {
      p_company_id:         S.cid,
      p_client_id:          clientId,
      p_promised_amount:    amount,
      p_promise_date:       pdate,
      p_sale_id:            saleId,
      p_installment_id:     instId,
      p_promised_via:       via,
      p_promised_by_client: byClient,
      p_logged_by:          loggedBy,
      p_notes:              notes
    });
    if (error) throw error;
    if (!data?.success) {
      if (data?.error==='duplicate_active_promise')
        throw new Error('An active pending promise already exists for this installment.');
      throw new Error(data?.error||'Failed to log promise');
    }
    cm('m-prm-log');
    if (typeof showToast==='function') showToast('Promise logged successfully','ok');
    await _prmLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Log Promise'; }
  }
}

// ── Mark Kept ──────────────────────────────────────────────────
let _prmKeptPromisedAmt = 0;

function prmMarkKept(id, promisedAmt) {
  _prmActingId = id;
  _prmKeptPromisedAmt = Number(promisedAmt)||0;
  _prmEnsureModals();

  const subEl = document.getElementById('m-prm-kept-sub');
  if (subEl) subEl.textContent = 'Promised: PKR ' + fM(_prmKeptPromisedAmt);

  const amtEl   = document.getElementById('prm-k-amount');
  const dateEl  = document.getElementById('prm-k-date');
  const notesEl = document.getElementById('prm-k-notes');
  if (amtEl)   amtEl.value   = _prmKeptPromisedAmt;
  if (dateEl)  dateEl.value  = new Date().toISOString().split('T')[0];
  if (notesEl) notesEl.value = '';

  const noteEl = document.getElementById('prm-k-partial-note');
  if (noteEl) noteEl.style.display = 'none';
  om('m-prm-kept');
}

function _prmKeptPartialCheck() {
  const amtEl  = document.getElementById('prm-k-amount');
  const noteEl = document.getElementById('prm-k-partial-note');
  if (amtEl && noteEl)
    noteEl.style.display = parseFloat(amtEl.value||0) < _prmKeptPromisedAmt ? '' : 'none';
}

async function prmSubmitKept() {
  const amount = parseFloat(document.getElementById('prm-k-amount')?.value||0);
  const date   = document.getElementById('prm-k-date')?.value;
  const via    = document.getElementById('prm-k-via')?.value;

  if (!amount||amount<=0) { notify.error('Enter the actual amount received.'); return; }

  const btn = document.getElementById('prm-kept-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const { data, error } = await supabase.rpc('mark_promise_kept', {
      p_promise_id:    _prmActingId,
      p_actual_amount: amount,
      p_actual_date:   date||null,
      p_actual_via:    via||null,
      p_updated_by:    S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-prm-kept');
    if (typeof showToast==='function') showToast('Promise marked as kept','ok');
    await _prmLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Confirm Kept'; }
  }
}

// ── Mark Broken ────────────────────────────────────────────────
function prmMarkBroken(id) {
  _prmActingId = id;
  _prmEnsureModals();
  const p = _prmAllData.find(x=>x.id===id);
  const subEl = document.getElementById('m-prm-broken-sub');
  if (subEl) subEl.textContent = p ? esc(p.client_name)+' — PKR '+fM(p.promised_amount) : '';
  const rEl = document.getElementById('prm-b-reason');
  const dEl = document.getElementById('prm-b-detail');
  if (rEl) rEl.value='';
  if (dEl) dEl.value='';
  om('m-prm-broken');
}

async function prmSubmitBroken() {
  const reason = document.getElementById('prm-b-reason')?.value;
  const detail = document.getElementById('prm-b-detail')?.value?.trim();

  if (!reason) { notify.error('Please select a reason.'); return; }

  const btn = document.getElementById('prm-broken-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const fullReason = reason + (detail ? ': '+detail : '');
    const { data, error } = await supabase.rpc('mark_promise_broken', {
      p_promise_id:    _prmActingId,
      p_broken_reason: fullReason,
      p_updated_by:    S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-prm-broken');
    if (data.auto_escalated) {
      if (typeof showToast==='function')
        showToast('Promise broken — auto-escalated to manager ('+data.broken_count_90d+' broken in 90 days)','warn');
    } else {
      if (typeof showToast==='function')
        showToast('Promise marked as broken'+(data.broken_count_90d>1?' ('+data.broken_count_90d+' broken in 90 days)':''),'warn');
    }
    await _prmLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Confirm Broken'; }
  }
}

// ── Postpone ───────────────────────────────────────────────────
function prmPostpone(id, origDate) {
  _prmActingId = id;
  _prmEnsureModals();
  const p = _prmAllData.find(x=>x.id===id);
  const subEl = document.getElementById('m-prm-postpone-sub');
  if (subEl) subEl.textContent = 'Original: '+fD(origDate)+(p?' — PKR '+fM(p.promised_amount):'');

  const newDate = new Date(new Date(origDate).getTime()+86400000*7).toISOString().split('T')[0];
  const minDate = new Date(new Date(origDate).getTime()+86400000).toISOString().split('T')[0];
  const dateEl = document.getElementById('prm-pp-date');
  const rsEl   = document.getElementById('prm-pp-reason');
  if (dateEl) { dateEl.value=newDate; dateEl.min=minDate; }
  if (rsEl)   rsEl.value='';
  om('m-prm-postpone');
}

async function prmSubmitPostpone() {
  const newDate = document.getElementById('prm-pp-date')?.value;
  const reason  = document.getElementById('prm-pp-reason')?.value?.trim()||null;

  if (!newDate) { notify.error('Please select a new date.'); return; }

  const btn = document.getElementById('prm-postpone-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    const { data, error } = await supabase.rpc('postpone_promise', {
      p_promise_id:      _prmActingId,
      p_new_date:        newDate,
      p_postpone_reason: reason,
      p_updated_by:      S.name||null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error||'Failed');
    cm('m-prm-postpone');
    if (typeof showToast==='function') showToast('Promise postponed. New promise created.','ok');
    await _prmLoad();
  } catch(e) {
    notify.error(e.message||'Failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Confirm Postpone'; }
  }
}

// ── WhatsApp ───────────────────────────────────────────────────
function prmSendWA(id) {
  const p = _prmAllData.find(x=>x.id===id);
  if (!p) return;
  const phone = (p.client_phone||'').replace(/[^0-9]/g,'').replace(/^0/,'92');
  if (!phone) { notify.error('No phone number for this client.'); return; }

  const today   = _prmToday();
  const daysNum = Math.round((new Date(p.promise_date)-new Date(today))/86400000);
  const name    = p.client_name||'Client';
  const prop    = [p.project_name, p.unit_info].filter(Boolean).join(' - ');
  const coName  = S.coName||'Nexunova';
  const amtStr  = 'PKR '+fM(p.promised_amount);

  let msg;
  if (daysNum>=1) {
    msg = `Assalam o Alaikum ${name},\nReminder: ${fD(p.promise_date)} ko aap ne payment ka wada kiya tha.\nProperty: ${prop}\nAmount: ${amtStr}\nShukriya - ${coName}`;
  } else if (daysNum===0) {
    msg = `Assalam o Alaikum ${name},\nAaj aap ne payment ka wada kiya tha ${amtStr}.\nProperty: ${prop}\nHum aap ki payment ka intezaar kar rahe hain.\nShukriya - ${coName}`;
  } else {
    msg = `Assalam o Alaikum ${name},\n${Math.abs(daysNum)} din pehle aap ka payment ka wada tha lekin abhi tak nahi mila.\nPlease confirm kab tak ho sakti hai?\nAmount: ${amtStr}\nShukriya - ${coName}`;
  }

  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');

  supabase.rpc('record_promise_reminder', { p_promise_id: id, p_company_id: S.cid })
    .then(() => { _prmLoad(); })
    .catch(e => console.warn('[prmSendWA]', e));
}

// ── Dashboard Widget ───────────────────────────────────────────
async function _rDashPromises() {
  const el = document.getElementById('d-promises-widget');
  if (!el) return;
  try {
    const { data: s } = await supabase.rpc('get_promise_stats', { p_company_id: S.cid, p_days: 30 });
    if (!s) { el.innerHTML = ''; return; }

    const overdueHint = (s.overdue_count||0) > 0
      ? `<div class="db-promises-div"></div>
         <span class="db-promises-item" style="color:#DC2626">
           <span class="db-promises-n" style="color:#DC2626">${s.overdue_count}</span>overdue
         </span>`
      : '';

    el.innerHTML = `<div class="db-promises">
      <span class="db-promises-item">
        <span class="db-promises-n">${s.today_count||0}</span>due today
      </span>
      <div class="db-promises-div"></div>
      <span class="db-promises-item">PKR <span class="db-promises-n">${fM(s.today_amount||0)}</span></span>
      <div class="db-promises-div"></div>
      <span class="db-promises-item">
        <span class="db-promises-n">${s.kept_percent||0}%</span>kept
      </span>
      ${overdueHint}
      <button class="db-btn" style="margin-left:auto;height:26px;padding:0 10px;font-size:11px" onclick="nav('promises')">View All</button>
    </div>`;
  } catch(e) {
    console.warn('[_rDashPromises]', e);
  }
}

// ── Client Profile Tab ─────────────────────────────────────────
async function _cdLoadPromises(clientId) {
  const body = document.getElementById('cd-promises-body');
  if (!body) return;
  body.innerHTML = `<div style="padding:28px;text-align:center;color:var(--fk-text-muted);font-size:13px">Loading…</div>`;

  try {
    const { data, error } = await supabase.rpc('get_client_promise_history', {
      p_client_id: clientId,
      p_limit: 10
    });
    if (error) throw error;

    const promises = Array.isArray(data?.promises) ? data.promises : [];
    const stats = data?.stats || {};

    const statusBadge = st => {
      const m = { pending:['Pending',''], kept:['Kept','success'], partial:['Partial','success'],
                  broken:['Broken','danger'], postponed:['Postponed',''], cancelled:['Cancelled',''] };
      const [lbl, tone] = m[st] || [st, ''];
      return NX.badge(lbl, tone);
    };

    body.innerHTML = NX.card(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:600">Promise History</div>
        ${NX.button('Log Promise', { variant:'primary', size:'sm', icon:'plus', onclick:"prmLogNew({clientId:'"+clientId+"'})" })}
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px">
        ${[
          {val:stats.total||0,   label:'Total',   dot:''},
          {val:stats.kept||0,    label:'Kept',    dot:'success'},
          {val:stats.broken||0,  label:'Broken',  dot:'danger'},
          {val:stats.pending||0, label:'Pending', dot:'warning'},
          {val:(stats.kept_pct||0)+'%', label:'Rate', dot:'primary'},
        ].map(x=>NX.kpi({label:x.label,value:x.val,dot:x.dot||undefined})).join('')}
      </div>
      ${!promises.length
        ? NX.empty({ icon:'clock', message:'No promises recorded for this client yet' })
        : `<table class="nx-table">
            <thead><tr>
              <th>Date</th><th class="num">Amount</th><th>Via</th><th>Status</th>
            </tr></thead>
            <tbody>${promises.map(p=>`<tr>
              <td style="font-size:12px">${fD(p.promise_date)}</td>
              <td class="num" style="font-size:12px;font-weight:600">PKR ${fM(p.promised_amount||0)}</td>
              <td style="font-size:11px;color:var(--fk-text-muted)">${esc(p.promised_via||'—')}</td>
              <td>${statusBadge(p.status)}</td>
            </tr>`).join('')}</tbody>
          </table>`}
    `, { header:{ icon:'clock', tone:'warning', title:'Promise History', actions: NX.button('Log Promise', { variant:'secondary', size:'sm', onclick:"prmLogNew({clientId:'"+clientId+"'})" }) } });
  } catch(e) {
    body.innerHTML = NX.card(NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Failed to load promises') }));
  }
}

// ════════════════════════════════════════════════════════════════
// MODULE 1.3 — PROMISE ANALYTICS  (Recovery Intelligence Engine)
// ════════════════════════════════════════════════════════════════

let _prmAnalyticsDays  = 90;
let _prmAnalyticsChart = null;

function prmOpenAnalytics() {
  if (!document.getElementById('m-prm-analytics')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="m-prm-analytics" class="mov">
      <div class="nx-modal nx-modal--l">
        <div class="nx-modal-header">
          <h3 class="nx-modal-title">Promise Analytics</h3>
          <button class="nx-modal-close" onclick="cm('m-prm-analytics')">${NX.icon('x',16)}</button>
        </div>
        <div class="nx-modal-body" id="m-prm-analytics-body" style="min-height:400px;max-height:70vh;overflow:auto">
          <div style="padding:32px;text-align:center;color:var(--fk-text-muted)">Loading analytics…</div>
        </div>
        <div class="nx-modal-footer" id="m-prm-analytics-foot"></div>
      </div>
    </div>`);
  }
  om('m-prm-analytics');
  _prmRenderAnalyticsFoot();
  _prmLoadAnalytics();
}

function prmSetAnalyticsDays(d) {
  _prmAnalyticsDays = d;
  _prmRenderAnalyticsFoot();
  _prmLoadAnalytics();
}

function _prmRenderAnalyticsFoot() {
  const foot = document.getElementById('m-prm-analytics-foot');
  if (!foot) return;
  foot.innerHTML = `<span style="font-size:11px;color:var(--fk-text-muted);margin-right:auto">Window:</span>` +
    [30,90,365].map(d =>
      NX.button(d+'d', { variant: _prmAnalyticsDays===d ? 'primary' : 'ghost', size:'sm', onclick:'prmSetAnalyticsDays('+d+')' })
    ).join('');
}

async function _prmLoadAnalytics() {
  const body = document.getElementById('m-prm-analytics-body');
  if (!body) return;
  body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--fk-text-muted)">Loading analytics…</div>`;
  try {
    const [{ data, error }, { data: conv }] = await Promise.all([
      supabase.rpc('get_promise_analytics', { p_company_id: S.cid, p_days: _prmAnalyticsDays }),
      supabase.rpc('get_promise_conversion_rate', { p_company_id: S.cid, p_window_days: 7 })
    ]);
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _prmRenderAnalytics(data, conv || {});
  } catch(e) {
    body.innerHTML = NX.empty({ icon:'x-circle', tone:'danger', message: esc(e.message||'Error loading analytics') });
  }
}

function _prmRenderAnalytics(d, conv) {
  const body = document.getElementById('m-prm-analytics-body');
  if (!body) return;
  const officers  = Array.isArray(d.officers)   ? d.officers   : [];
  const weekly    = Array.isArray(d.weekly)     ? d.weekly     : [];
  const topBroken = Array.isArray(d.top_broken) ? d.top_broken : [];
  const convRate  = Number(conv?.rate  || 0);
  const convKept  = Number(conv?.total_kept || 0);
  const convPaid  = Number(conv?.converted  || 0);
  const convDays  = Number(conv?.avg_days_to_pay || 0);
  const convColor = convRate >= 70 ? 'success' : convRate >= 40 ? 'warning' : 'danger';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      ${NX.kpi({ label:'Conversion Rate',     value: convKept>0 ? convRate+'%' : '—',              dot: convColor })}
      ${NX.kpi({ label:'Promises → Payments', value: convKept>0 ? convPaid+' / '+convKept : '—',  dot: 'info' })}
      ${NX.kpi({ label:'Avg Days to Pay',     value: convDays>0 ? convDays+'d' : '—',               dot: '' })}
      ${NX.kpi({ label:'Total Kept (180d)',   value: convKept,                                       dot: 'success' })}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px">
      ${NX.card(officers.length
        ? `<table class="nx-table">
            <thead><tr>
              <th>Officer</th><th class="num">Total</th><th class="num">Kept</th><th class="num">Broken</th><th class="num">Kept %</th><th class="num hide-sm">Recovered</th>
            </tr></thead>
            <tbody>${officers.map(o=>`<tr>
              <td>
                <div style="font-weight:600;font-size:13px">${esc(o.officer_name||o.username||'—')}</div>
                <div style="font-size:11px;color:var(--fk-text-muted)">@${esc(o.username||'')}</div>
              </td>
              <td class="num" style="font-weight:600">${o.total||0}</td>
              <td class="num" style="color:var(--fk-success);font-weight:600">${o.kept_count||0}</td>
              <td class="num" style="color:var(--fk-danger);font-weight:600">${o.broken_count||0}</td>
              <td class="num">${NX.badge((o.kept_rate||0)+'%', (o.kept_rate||0)>=50?'success':'danger')}</td>
              <td class="num hide-sm" style="font-size:12px">PKR ${fM(o.amount_recovered||0)}</td>
            </tr>`).join('')}</tbody>
          </table>`
        : NX.empty({ icon:'users', message:'No officer activity in this window' }),
        { flush:true, header:{ icon:'users', tone:'', title:'Officer Performance' } })}

      ${NX.card(`
        <div id="prm-analytics-chart-wrap" style="height:240px;position:relative">
          <canvas id="prm-analytics-chart"></canvas>
        </div>`,
        { header:{ icon:'bar-chart-3', tone:'info', title:'Weekly Trend' } })}
    </div>

    ${NX.card(topBroken.length
      ? `<table class="nx-table">
          <thead><tr>
            <th>Client</th><th class="hide-sm">Phone</th><th class="num">Total</th><th class="num">Broken</th><th class="num">Kept</th>
          </tr></thead>
          <tbody>${topBroken.map(t=>`<tr style="cursor:pointer" onclick="openClientDetail('${t.client_id}')">
            <td>
              <div style="font-weight:600;font-size:13px">${esc(t.client_name||'—')}</div>
              <div style="font-size:11px;color:var(--fk-text-muted)">${esc(t.client_code||'')}</div>
            </td>
            <td class="hide-sm" style="font-size:12px;color:var(--fk-text-muted)">${esc(t.phone_primary||'—')}</td>
            <td class="num" style="font-weight:600">${t.total||0}</td>
            <td class="num" style="color:var(--fk-danger);font-weight:600">${t.broken_count||0}</td>
            <td class="num" style="color:var(--fk-success);font-weight:600">${t.kept_count||0}</td>
          </tr>`).join('')}</tbody>
        </table>`
      : NX.empty({ icon:'check-circle', tone:'success', message:'No clients with broken promises in this window' }),
      { flush:true, header:{ icon:'alert-triangle', tone:'danger', title:'Top Broken Clients ('+topBroken.length+')' } })}
  `;

  if (weekly.length && typeof Chart !== 'undefined') {
    const ctx = document.getElementById('prm-analytics-chart');
    if (_prmAnalyticsChart) { try { _prmAnalyticsChart.destroy(); } catch(e) {} _prmAnalyticsChart = null; }
    _prmAnalyticsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weekly.map(w => fD(w.week_start)),
        datasets: [
          { label: 'Kept',   data: weekly.map(w => Number(w.kept   || 0)), backgroundColor: 'rgba(22,163,74,.85)', borderRadius: 4 },
          { label: 'Broken', data: weekly.map(w => Number(w.broken || 0)), backgroundColor: 'rgba(220,38,38,.85)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }
      }
    });
  } else if (!weekly.length) {
    const wrap = document.getElementById('prm-analytics-chart-wrap');
    if (wrap) wrap.innerHTML = NX.empty({ icon:'bar-chart-3', message:'No weekly data in this window yet' });
  }
}
