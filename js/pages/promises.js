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
    <div class="ph">
      <div class="ph-l">
        <h2>Promise to Pay</h2>
        <p id="prm-subtitle">Track client commitments and recovery promises</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm" onclick="prmLogNew()">Log Promise</button>
        <button class="btn btn-gh btn-sm" onclick="prmOpenAnalytics()">Analytics</button>
        <button class="btn btn-gh btn-sm" onclick="_prmLoad()">Refresh</button>
      </div>
    </div>

    <div id="prm-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px">
      ${[...Array(5)].map(() => `<div class="card" style="padding:14px;text-align:center;opacity:.4"><div style="font-size:18px">⏳</div><div style="font-size:10px;color:var(--t3);margin-top:4px">Loading…</div></div>`).join('')}
    </div>

    <div id="prm-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
    <div id="prm-alert"></div>

    <div id="prm-body">
      <div style="padding:48px;text-align:center;color:var(--t3);font-size:13px">Loading…</div>
    </div>
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
    if (body) body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load</div><div class="es">${esc(e.message||'Error')}</div></div></div>`;
  }
}

// ── Stats cards ────────────────────────────────────────────────
function _prmRenderStats() {
  const el = document.getElementById('prm-stats');
  if (!el) return;
  const s = _prmStats || {};
  const today   = _prmAllData.filter(p => p.status==='pending' && p.promise_date===_prmToday());
  const overdue = _prmAllData.filter(p => p.status==='pending' && p.promise_date<_prmToday());
  const todayAmt   = today.reduce((acc,p)=>acc+Number(p.promised_amount||0),0);
  const overdueAmt = overdue.reduce((acc,p)=>acc+Number(p.promised_amount||0),0);

  const cards = [
    { val:today.length,            sub:'PKR '+fM(todayAmt),                color:'var(--brand)', label:'Today' },
    { val:overdue.length,          sub:'PKR '+fM(overdueAmt),              color:'var(--err)',   label:'Overdue' },
    { val:s.kept||0,               sub:(s.kept_percent||0)+'% rate',       color:'var(--ok)',    label:'Kept (30d)' },
    { val:s.broken||0,             sub:(s.broken_percent||0)+'% rate',     color:'#f59e0b',      label:'Broken (30d)' },
    { val:(s.recovery_rate||0)+'%', sub:'PKR '+fM(s.total_kept_amount||0), color:'#8b5cf6',      label:'Recovery' },
  ];

  el.innerHTML = cards.map(c => `
    <div class="card" style="padding:14px;text-align:center;border-top:3px solid ${c.color};cursor:default">
      <div style="font-size:22px;font-weight:800;color:${c.color};line-height:1.1">${c.val}</div>
      <div style="font-size:11px;font-weight:700;color:var(--t2);margin:2px 0">${c.label}</div>
      <div style="font-size:10px;color:var(--t3)">${c.sub}</div>
    </div>`).join('');
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
  el.innerHTML = _prmTabCfg.map(t => {
    const cnt = _prmAllData.filter(t.fn).length;
    const active = _prmTab===t.key;
    return `<button class="btn btn-sm ${active?'btn-g':'btn-gh'}" onclick="prmSetTab('${t.key}')">
      ${t.label} <span style="font-size:10px;opacity:.75">(${cnt})</span>
    </button>`;
  }).join('');
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
  const todayCnt    = todayList.length;
  const tomorrowCnt = tomorrowList.length;

  if (todayCnt === 0 && tomorrowCnt === 0) { el.innerHTML = ''; return; }

  const chips = [];
  if (todayCnt > 0) {
    const amt = todayList.reduce((s,p)=>s+Number(p.promised_amount||0),0);
    chips.push(`<span onclick="prmSetTab('today')" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(99,102,241,.14);color:var(--brand);border:1px solid rgba(99,102,241,.3)">
      <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${todayCnt} promise${todayCnt>1?'s':''} due today — PKR ${fM(amt)}
    </span>`);
  }
  if (tomorrowCnt > 0) {
    const amt = tomorrowList.reduce((s,p)=>s+Number(p.promised_amount||0),0);
    chips.push(`<span onclick="prmSetTab('tomorrow')" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(245,158,11,.12);color:#d97706;border:1px solid rgba(245,158,11,.3)">
      <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${tomorrowCnt} promise${tomorrowCnt>1?'s':''} due tomorrow — PKR ${fM(amt)}
    </span>`);
  }
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${chips.join('')}</div>`;
}

// ── Table render ───────────────────────────────────────────────
function _prmRender() {
  const body = document.getElementById('prm-body');
  if (!body) return;
  const rows = _prmFiltered();

  if (!rows.length) {
    const msgs = {
      overdue:'No overdue promises', today:'No promises due today',
      upcoming:'No upcoming promises', kept:'No kept promises yet',
      broken:'No broken promises', all:'No promises logged yet'
    };
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
      <div class="et">${msgs[_prmTab]||'No data'}</div>
      ${_prmTab==='all'?`<button class="btn btn-g btn-sm" style="margin-top:10px" onclick="prmLogNew()">+ Log First Promise</button>`:''}
    </div></div>`;
    return;
  }

  body.innerHTML = `<div class="tw"><table class="t" style="width:100%">
    <thead><tr>
      <th style="width:90px">Status</th>
      <th>Client</th>
      <th class="hide-sm">Property</th>
      <th class="r">Amount</th>
      <th>Date</th>
      <th class="hide-sm">Via</th>
      <th class="hide-sm">Officer</th>
      <th style="width:120px"></th>
    </tr></thead>
    <tbody>${rows.map(_prmRow).join('')}</tbody>
  </table></div>`;
}

function _prmRow(p) {
  const today = _prmToday();
  const isOverdue = p.status==='pending' && p.promise_date < today;
  const isToday   = p.status==='pending' && p.promise_date === today;

  const sc = {
    pending:   isOverdue ? {icon:'',label:'Overdue', color:'var(--err)'}
             : isToday   ? {icon:'',label:'Today',   color:'#f59e0b'}
             :              {icon:'',label:'Pending', color:'var(--t3)'},
    kept:      {icon:'',label:'Kept',      color:'var(--ok)'},
    partial:   {icon:'',label:'Partial',   color:'#22c55e'},
    broken:    {icon:'',label:'Broken',    color:'var(--err)'},
    postponed: {icon:'',label:'Postponed', color:'var(--t2)'},
    cancelled: {icon:'',label:'Cancelled', color:'var(--t3)'},
  }[p.status] || {icon:'',label:p.status,color:'var(--t3)'};

  const viaIco = {call:'',whatsapp:'',sms:'',visit:'',meeting:'',email:''};
  const daysNum = Math.round((new Date(p.promise_date)-new Date(today))/86400000);
  const daysLbl = daysNum===0 ? `<b style="color:#f59e0b">Today</b>`
    : daysNum>0  ? `<span style="color:var(--ok)">in ${daysNum}d</span>`
    :              `<span style="color:var(--err)">${Math.abs(daysNum)}d ago</span>`;

  const prop = [p.project_name, p.unit_info].filter(Boolean).join(' · ') || '—';

  let actions = '';
  if (p.status==='pending') {
    actions = `
      <button class="btn btn-gh btn-xs" title="Mark Kept"   onclick="prmMarkKept('${p.id}',${p.promised_amount})">Kept</button>
      <button class="btn btn-gh btn-xs" title="Mark Broken" onclick="prmMarkBroken('${p.id}')">Broken</button>
      <button class="btn btn-gh btn-xs" title="Postpone"    onclick="prmPostpone('${p.id}','${p.promise_date}')">Postpone</button>
      <button class="btn btn-gh btn-xs" title="WhatsApp"    onclick="prmSendWA('${p.id}')">WhatsApp</button>`;
  } else if (p.status==='kept'||p.status==='partial') {
    actions = `<span style="font-size:10px;color:var(--ok)">PKR ${fM(p.actual_paid_amount||0)}</span>`;
  } else if (p.status==='broken') {
    actions = `<span style="font-size:10px;color:var(--t3)" title="${esc(p.broken_reason||'')}">
      ${esc((p.broken_reason||'—').substring(0,18))}…</span>`;
  }

  return `<tr>
    <td><span style="font-size:11px;font-weight:700;color:${sc.color}">${sc.label}</span></td>
    <td>
      <div style="font-weight:700;font-size:13px">${esc(p.client_name||'—')}</div>
      <div style="font-size:10px;color:var(--t3)">${esc(p.client_phone||'—')}</div>
    </td>
    <td class="hide-sm" style="font-size:11px;color:var(--t2)">${esc(prop)}</td>
    <td class="r" style="font-weight:700;font-size:13px">PKR ${fM(p.promised_amount||0)}</td>
    <td>
      <div style="font-size:12px">${fD(p.promise_date)}${(p.reminder_sent_count||0)>0?` <span style="font-size:9px;background:rgba(59,130,246,.12);color:#3b82f6;padding:1px 5px;border-radius:8px;font-weight:700" title="WhatsApp reminders sent">×${p.reminder_sent_count}</span>`:''}</div>
      <div style="font-size:10px">${daysLbl}</div>
    </td>
    <td class="hide-sm" style="font-size:11px;color:var(--t2)">${viaIco[p.promised_via]||''} ${p.promised_via||'—'}</td>
    <td class="hide-sm" style="font-size:11px;color:var(--t2)">${esc(p.logged_by||'—')}</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:right">${actions}</td>
  </tr>`;
}

// ── Modals (injected once into body) ──────────────────────────
function _prmEnsureModals() {
  if (document.getElementById('m-prm-log')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div id="m-prm-log" class="mov">
    <div class="md" style="max-width:520px">
      <div class="mh">
        <div><h3>Log Payment Promise</h3><p>Record client's commitment to pay</p></div>
        <button class="mx" onclick="cm('m-prm-log')">✕</button>
      </div>
      <div class="mb" id="m-prm-log-body">
        <div style="padding:28px;text-align:center">Loading…</div>
      </div>
      <div class="mf">
        <button class="btn btn-gh" onclick="cm('m-prm-log')">Cancel</button>
        <button class="btn btn-g"  id="prm-log-save-btn" onclick="prmSubmitNew()">Log Promise</button>
      </div>
    </div>
  </div>

  <div id="m-prm-kept" class="mov">
    <div class="md" style="max-width:420px">
      <div class="mh">
        <div><h3>Mark Promise Kept</h3><p id="m-prm-kept-sub"></p></div>
        <button class="mx" onclick="cm('m-prm-kept')">✕</button>
      </div>
      <div class="mb">
        <div class="fg"><label class="lb">Actual Amount Received (PKR) *</label>
          <input id="prm-k-amount" class="inp" type="number" min="1" placeholder="0"
            oninput="_prmKeptPartialCheck()"></div>
        <div class="fg"><label class="lb">Payment Date</label>
          <input id="prm-k-date" class="inp" type="date"></div>
        <div class="fg"><label class="lb">Payment Method</label>
          <select id="prm-k-via" class="inp">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="jazzcash">JazzCash</option>
            <option value="easypaisa">EasyPaisa</option>
          </select></div>
        <div class="fg"><label class="lb">Notes</label>
          <textarea id="prm-k-notes" class="inp" rows="2" placeholder="Optional…"></textarea></div>
        <div id="prm-k-partial-note" style="display:none;padding:8px 10px;border-radius:8px;
          background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);
          font-size:12px;color:#f59e0b;margin-top:4px">
          Amount less than promised — will be marked as <b>PARTIAL</b>
        </div>
      </div>
      <div class="mf">
        <button class="btn btn-gh" onclick="cm('m-prm-kept')">Cancel</button>
        <button class="btn btn-g" id="prm-kept-save-btn" onclick="prmSubmitKept()">Confirm Kept</button>
      </div>
    </div>
  </div>

  <div id="m-prm-broken" class="mov">
    <div class="md" style="max-width:420px">
      <div class="mh">
        <div><h3>Mark Promise Broken</h3><p id="m-prm-broken-sub"></p></div>
        <button class="mx" onclick="cm('m-prm-broken')">✕</button>
      </div>
      <div class="mb">
        <div style="padding:10px;border-radius:8px;background:rgba(239,68,68,.08);
          border:1px solid rgba(239,68,68,.25);font-size:12px;color:var(--err);margin-bottom:14px">
          This will reduce the client's Health Score by 20 points.
        </div>
        <div class="fg"><label class="lb">Reason *</label>
          <select id="prm-b-reason" class="inp">
            <option value="">— Select reason —</option>
            <option value="Client unreachable">Client unreachable</option>
            <option value="Client refused to pay">Client refused to pay</option>
            <option value="Client cited financial hardship">Client cited financial hardship</option>
            <option value="Family member denied promise">Family member denied promise</option>
            <option value="Cheque issue">Cheque issue</option>
            <option value="Other">Other</option>
          </select></div>
        <div class="fg"><label class="lb">Details</label>
          <textarea id="prm-b-detail" class="inp" rows="3"
            placeholder="Add more detail about why the promise was broken…"></textarea></div>
      </div>
      <div class="mf">
        <button class="btn btn-gh" onclick="cm('m-prm-broken')">Cancel</button>
        <button class="btn btn-gh" id="prm-broken-save-btn"
          style="background:rgba(239,68,68,.1);color:var(--err);border-color:rgba(239,68,68,.4)"
          onclick="prmSubmitBroken()">Confirm Broken</button>
      </div>
    </div>
  </div>

  <div id="m-prm-postpone" class="mov">
    <div class="md" style="max-width:400px">
      <div class="mh">
        <div><h3>Postpone Promise</h3><p id="m-prm-postpone-sub"></p></div>
        <button class="mx" onclick="cm('m-prm-postpone')">✕</button>
      </div>
      <div class="mb">
        <div class="fg"><label class="lb">New Promise Date *</label>
          <input id="prm-pp-date" class="inp" type="date"></div>
        <div class="fg"><label class="lb">Reason</label>
          <textarea id="prm-pp-reason" class="inp" rows="2"
            placeholder="Client asked for more time because…"></textarea></div>
        <div style="font-size:11px;color:var(--t3);margin-top:4px">
          A new promise with the new date will be created automatically.
        </div>
      </div>
      <div class="mf">
        <button class="btn btn-gh" onclick="cm('m-prm-postpone')">Cancel</button>
        <button class="btn btn-g" id="prm-postpone-save-btn" onclick="prmSubmitPostpone()">Confirm Postpone</button>
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
  body.innerHTML = '<div style="padding:28px;text-align:center">Loading clients…</div>';
  om('m-prm-log');

  if (!_prmClientsCache.length) {
    const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
    _prmClientsCache = (data || []).map(c => ({
      id: c.id, full_name: c.full_name, phone_primary: c.phone_primary, client_code: c.client_code
    }));
  }

  const next7 = new Date(Date.now()+86400000*7).toISOString().split('T')[0];

  body.innerHTML = `
    <div class="fg"><label class="lb">Client *</label>
      <select id="prm-l-client" class="inp" onchange="prmOnClientChange(this.value)">
        <option value="">— Select client —</option>
        ${_prmClientsCache.map(c=>`<option value="${c.id}" ${prefill.clientId===c.id?'selected':''}>${esc(c.full_name||'')} (${esc(c.client_code||'')})</option>`).join('')}
      </select></div>

    <div class="fg"><label class="lb">Sale / Property</label>
      <select id="prm-l-sale" class="inp" onchange="prmOnSaleChange(this.value)">
        <option value="">— Select client first —</option>
      </select></div>

    <div class="fg"><label class="lb">Installment (optional)</label>
      <select id="prm-l-inst" class="inp" onchange="prmOnInstChange(this)">
        <option value="">— No specific installment —</option>
      </select></div>

    <div class="fg"><label class="lb">Promised Amount (PKR) *</label>
      <input id="prm-l-amount" class="inp" type="number" min="1"
        value="${prefill.amount||''}" placeholder="e.g. 500000"></div>
    <div id="prm-l-hint" style="font-size:11px;color:var(--t3);margin:-6px 0 10px"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="fg"><label class="lb">Promise Date *</label>
        <input id="prm-l-date" class="inp" type="date" value="${next7}"
          min="${new Date().toISOString().split('T')[0]}"></div>
      <div class="fg"><label class="lb">Promised Via</label>
        <select id="prm-l-via" class="inp">
          <option value="call">Phone Call</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="visit">Visit</option>
          <option value="meeting">Meeting</option>
          <option value="email">Email</option>
        </select></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="fg"><label class="lb">Promised By (client side)</label>
        <input id="prm-l-by" class="inp" type="text"
          value="${prefill.promisedBy||'Client himself'}" placeholder="Client himself / Wife…"></div>
      <div class="fg"><label class="lb">Logged By</label>
        <input id="prm-l-logged" class="inp" type="text"
          value="${esc(S.username||S.name||'')}" placeholder="Officer username"></div>
    </div>

    <div class="fg"><label class="lb">Notes</label>
      <textarea id="prm-l-notes" class="inp" rows="2"
        placeholder="Client said salary aayega 15 ko, payment same day…">${esc(prefill.notes||'')}</textarea></div>`;

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

  const amtEl  = document.getElementById('prm-k-amount');
  const dateEl = document.getElementById('prm-k-date');
  const notesEl= document.getElementById('prm-k-notes');
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

  // Track that a 24h reminder was sent (bumps reminder_sent_count + last_reminder_sent_at).
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
  body.innerHTML = '<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';

  try {
    const { data, error } = await supabase.rpc('get_client_promise_history', {
      p_client_id: clientId,
      p_limit: 10
    });
    if (error) throw error;

    const promises = Array.isArray(data?.promises) ? data.promises : [];
    const stats = data?.stats || {};

    const statusCfg = {
      pending:   {icon:'',color:'var(--t3)'},
      kept:      {icon:'',color:'var(--ok)'},
      partial:   {icon:'',color:'#22c55e'},
      broken:    {icon:'',color:'var(--err)'},
      postponed: {icon:'',color:'var(--t2)'},
      cancelled: {icon:'',color:'var(--t3)'},
    };

    body.innerHTML = `
      <div class="card">
        <div class="ch" style="display:flex;align-items:center;justify-content:space-between">
          <h3>Promise History</h3>
          <button class="btn btn-g btn-xs" onclick="prmLogNew({clientId:'${clientId}'})">Log Promise</button>
        </div>
        <div class="cb">
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px">
            ${[
              {val:stats.total||0, label:'Total', color:'var(--t1)'},
              {val:stats.kept||0,  label:'Kept',  color:'var(--ok)'},
              {val:stats.broken||0,label:'Broken',color:'var(--err)'},
              {val:stats.pending||0,label:'Pending',color:'#f59e0b'},
              {val:(stats.kept_pct||0)+'%',label:'Rate',color:'var(--brand)'},
            ].map(x=>`<div style="text-align:center">
              <div style="font-size:18px;font-weight:800;color:${x.color}">${x.val}</div>
              <div style="font-size:10px;color:var(--t3)">${x.label}</div>
            </div>`).join('')}
          </div>
          ${!promises.length ? `<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><div class="et">No promises yet</div></div>` : `
          <div class="tw"><table class="t" style="width:100%">
            <thead><tr>
              <th>Date</th><th class="r">Amount</th><th>Via</th><th>Status</th>
            </tr></thead>
            <tbody>
              ${promises.map(p=>{
                const sc=statusCfg[p.status]||statusCfg.pending;
                return `<tr>
                  <td style="font-size:12px">${fD(p.promise_date)}</td>
                  <td class="r" style="font-size:12px;font-weight:700">PKR ${fM(p.promised_amount||0)}</td>
                  <td style="font-size:11px;color:var(--t2)">${p.promised_via||'—'}</td>
                  <td style="font-size:11px;font-weight:700;color:${sc.color}">${p.status}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>`}
        </div>
      </div>`;
  } catch(e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Failed to load promises</div><div class="es">${esc(e.message||'Error')}</div></div></div>`;
  }
}

// ════════════════════════════════════════════════════════════════
// MODULE 1.3 — PROMISE ANALYTICS  (Recovery Intelligence Engine)
// Officer-wise stats + weekly trend + top broken clients.
// Backend: get_promise_analytics(p_company_id, p_days).
// ════════════════════════════════════════════════════════════════

let _prmAnalyticsDays  = 90;
let _prmAnalyticsChart = null;

function prmOpenAnalytics() {
  if (!document.getElementById('m-prm-analytics')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="m-prm-analytics" class="mov">
      <div class="md" style="max-width:960px;width:96%">
        <div class="mh">
          <div><h3>Promise Analytics</h3><p>Officer performance, weekly trend, top broken clients</p></div>
          <button class="mx" onclick="cm('m-prm-analytics')">✕</button>
        </div>
        <div class="mb" id="m-prm-analytics-body" style="min-height:400px;max-height:75vh;overflow:auto">
          <div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading analytics…</div>
        </div>
        <div class="mf" id="m-prm-analytics-foot"></div>
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
  foot.innerHTML = `<span style="font-size:11px;color:var(--t3);margin-right:auto">Window:</span>` +
    [30,90,365].map(d => `<button class="btn btn-${_prmAnalyticsDays===d?'g':'gh'} btn-sm" onclick="prmSetAnalyticsDays(${d})">${d}d</button>`).join('');
}

async function _prmLoadAnalytics() {
  const body = document.getElementById('m-prm-analytics-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading analytics…</div>';
  try {
    const [{ data, error }, { data: conv }] = await Promise.all([
      supabase.rpc('get_promise_analytics', { p_company_id: S.cid, p_days: _prmAnalyticsDays }),
      supabase.rpc('get_promise_conversion_rate', { p_company_id: S.cid, p_window_days: 7 })
    ]);
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    _prmRenderAnalytics(data, conv || {});
  } catch(e) {
    body.innerHTML = `<div class="empty" style="padding:32px"><div class="es">${esc(e.message || 'Error')}</div></div>`;
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

  const convColor = convRate >= 70 ? 'var(--ok)' : convRate >= 40 ? '#f59e0b' : 'var(--err)';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      ${[
        { l:'Conversion Rate',     v:convKept>0?convRate+'%':'—',            c:convColor,       t:'% of kept promises that resulted in a payment within 7 days' },
        { l:'Promises → Payments', v:convKept>0?convPaid+' / '+convKept:'—', c:'var(--info)',   t:'Kept promises with a matching payment within the window' },
        { l:'Avg Days to Pay',     v:convDays>0?convDays+'d':'—',            c:'var(--t2)',     t:'Average days from promise date to payment (last 180 days)' },
        { l:'Total Kept (180d)',   v:convKept,                                c:'var(--ok)',     t:'' },
      ].map(k => `<div class="card" style="padding:12px 14px" title="${k.t}">
        <div style="font-size:18px;font-weight:800;color:${k.c}">${k.v}</div>
        <div style="font-size:10px;color:var(--t3);margin-top:3px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px">
      <div class="card">
        <div class="ch"><h3>Officer Performance</h3></div>
        <div class="cb" style="padding:0">${officers.length ? `
          <div class="tw"><table class="t" style="width:100%">
            <thead><tr>
              <th>Officer</th><th class="r">Total</th><th class="r">Kept</th><th class="r">Broken</th><th class="r">Kept %</th><th class="r hide-sm">Recovered</th>
            </tr></thead>
            <tbody>${officers.map(o => `<tr>
              <td>
                <div style="font-weight:700;font-size:13px">${esc(o.officer_name || o.username || '—')}</div>
                <div style="font-size:10px;color:var(--t3);font-family:monospace">@${esc(o.username || '')}</div>
              </td>
              <td class="r" style="font-size:12px;font-weight:700">${o.total || 0}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:var(--ok)">${o.kept_count || 0}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:var(--err)">${o.broken_count || 0}</td>
              <td class="r" style="font-size:12px;font-weight:700;color:${(o.kept_rate || 0) >= 50 ? 'var(--ok)' : 'var(--err)'}">${o.kept_rate || 0}%</td>
              <td class="r hide-sm" style="font-size:11px">PKR ${fM(o.amount_recovered || 0)}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No officer activity in this window</div></div>`}
        </div>
      </div>

      <div class="card">
        <div class="ch"><h3>Weekly Trend</h3></div>
        <div class="cb">
          <div id="prm-analytics-chart-wrap" style="height:240px;position:relative">
            <canvas id="prm-analytics-chart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="ch"><h3>Top Broken Clients (${topBroken.length})</h3></div>
      <div class="cb" style="padding:0">${topBroken.length ? `
        <div class="tw"><table class="t" style="width:100%">
          <thead><tr>
            <th>Client</th><th class="hide-sm">Phone</th><th class="r">Total</th><th class="r">Broken</th><th class="r">Kept</th>
          </tr></thead>
          <tbody>${topBroken.map(t => `<tr style="cursor:pointer" onclick="openClientDetail('${t.client_id}')">
            <td>
              <div style="font-weight:700;font-size:13px">${esc(t.client_name || '—')}</div>
              <div style="font-size:10px;color:var(--t3);font-family:monospace">${esc(t.client_code || '')}</div>
            </td>
            <td class="hide-sm" style="font-size:12px;color:var(--t2)">${esc(t.phone_primary || '—')}</td>
            <td class="r" style="font-size:12px;font-weight:700">${t.total || 0}</td>
            <td class="r" style="font-size:12px;font-weight:700;color:var(--err)">${t.broken_count || 0}</td>
            <td class="r" style="font-size:12px;font-weight:700;color:var(--ok)">${t.kept_count || 0}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty" style="padding:24px"><div class="es">No clients with broken promises in this window</div></div>`}
      </div>
    </div>
  `;

  if (weekly.length && typeof Chart !== 'undefined') {
    const ctx = document.getElementById('prm-analytics-chart');
    if (_prmAnalyticsChart) { try { _prmAnalyticsChart.destroy(); } catch(e) {} _prmAnalyticsChart = null; }
    _prmAnalyticsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weekly.map(w => fD(w.week_start)),
        datasets: [
          { label: 'Kept',   data: weekly.map(w => Number(w.kept   || 0)), backgroundColor: 'rgba(34,197,94,.85)', borderRadius: 4 },
          { label: 'Broken', data: weekly.map(w => Number(w.broken || 0)), backgroundColor: 'rgba(239,68,68,.85)', borderRadius: 4 }
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
    if (wrap) wrap.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3);font-size:12px">No weekly data in this window yet</div>';
  }
}
