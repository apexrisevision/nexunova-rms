const fs = require('fs');
const f = 'js/pages/clients.js';
let s = fs.readFileSync(f, 'utf8');

const NEW = String.raw`function rClientDetail() {
  const clientId = _cid;
  if (!clientId) { nav('clients'); return; }
  const c = gclient(clientId);
  if (!c) { nav('clients'); return; }
  const pg = document.getElementById('pg-clientdetail');
  if (!pg) return;
  const isA = S.role === 'admin' || S.role === 'owner';
  const hist = c.status === 'inactive';

  const act = [];
  act.push(NX.button('← Back', { variant:'ghost', size:'sm', onclick:"nav('clients')" }));
  if (isA) act.push(NX.button('Edit', { variant:'secondary', size:'sm', onclick:"ClientForm.open({ clientId:'" + clientId + "', onSaved:function(){ rClientDetail(); } })" }));
  act.push(NX.button('Record payment', { variant:'primary', size:'sm', onclick:"nav('addpayment')" }));
  act.push(NX.button('Client ledger', { variant:'secondary', size:'sm', onclick:"openLedgerReport('" + clientId + "')" }));
  act.push(NX.button('Log follow-up', { variant:'secondary', size:'sm', onclick:"_cdLogFollowUp()" }));
  if (isA && !hist) act.push(NX.button('Deactivate', { variant:'ghost', size:'sm', onclick:"setClientStatus('" + clientId + "','inactive')" }));
  if (isA && hist)  act.push(NX.button('Reactivate', { variant:'ghost', size:'sm', onclick:"setClientStatus('" + clientId + "','active')" }));

  const tab = (id, label) => '<button class="nx-btn nx-btn--sm ' + (id==='overview'?'nx-btn--primary':'nx-btn--ghost') + '" id="cd-tab-' + id + '-btn" onclick="cdSwitchTab(\'' + id + '\')">' + label + '</button>';
  const statusBadge = NX.badge(hist?'Historical':(c.status?c.status[0].toUpperCase()+c.status.slice(1):'—'), hist?'':(c.status==='blacklisted'?'danger':'success'), {dot:true});

  pg.innerHTML = '<div class="nx-page">' +
    '<div id="cd-form-nav"></div>' +
    '<div class="no-p" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:var(--fk-sp-3)">' + act.join('') + '</div>' +
    (hist ? NX.banner('Historical / cancelled buyer — this client is inactive. Their cancelled sales are shown below; no current dues are computed.', 'warn') : '') +
    '<div class="nx-card" style="margin:var(--fk-sp-3) 0">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--fk-sp-3)">' +
        '<div>' +
          '<div class="nx-mono nx-kpi-label" style="text-transform:none">' + esc(c.clientCode||'') + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0"><h1 class="nx-page-title">' + esc(c.fullName||'Unnamed') + '</h1>' + statusBadge + (c.clientCategory?NX.chip(c.clientCategory):'') + '</div>' +
          '<div class="nx-kpi-label" style="text-transform:none">' + (c.fatherName?'S/o '+esc(c.fatherName)+' · ':'') + (c.cnic?'NIC '+esc(c.cnic):'') + '</div>' +
          '<div class="nx-kpi-label" style="text-transform:none;margin-top:4px">' + (c.phonePrimary?'<a href="tel:'+esc(c.phonePrimary)+'" style="color:var(--fk-info)">'+esc(c.phonePrimary)+'</a>':'') + (c.address?' · '+esc(c.address):'') + (c.city?', '+esc(c.city):'') + '</div>' +
        '</div>' +
        '<div class="no-p" style="display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap">' +
          (c.phonePrimary?'<a class="nx-btn nx-btn--ghost nx-btn--sm" href="tel:'+esc(c.phonePrimary)+'"><span>Call</span></a>':'') +
          ((c.whatsapp||c.phonePrimary)?'<a class="nx-btn nx-btn--ghost nx-btn--sm" target="_blank" href="https://wa.me/'+(c.whatsapp||c.phonePrimary).replace(/[^0-9]/g,'')+'"><span>WhatsApp</span></a>':'') +
          (c.email?'<a class="nx-btn nx-btn--ghost nx-btn--sm" href="mailto:'+esc(c.email)+'"><span>Email</span></a>':'') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="nx-segment" style="margin-bottom:var(--fk-sp-3)">' + tab('overview','Overview') + tab('ledger','Ledger') + tab('health','Health') + tab('promises','Promises') + tab('paylinks','Payment Links') + tab('documents','Documents') + (isA?tab('history','History'):'') + '</div>' +
    '<div id="cd-tab-overview">' +
      '<div id="cd-fin" class="nx-kpi-row" style="margin-bottom:var(--fk-sp-4)"></div>' +
      '<div class="nx-card nx-card--flush" style="margin-bottom:var(--fk-sp-4)"><div class="nx-card-title" style="padding:var(--fk-sp-3) var(--fk-sp-4)">Portfolio</div><div id="cd-portfolio"><div class="nx-skel" style="height:120px;margin:var(--fk-sp-3)"></div></div></div>' +
      '<div class="nx-grid-2">' +
        '<div class="nx-card"><div class="nx-card-title" style="margin-bottom:var(--fk-sp-3)">Recent payments</div><div id="cd-payments"><div class="nx-skel" style="height:80px"></div></div></div>' +
        '<div class="nx-card"><div class="nx-card-title" style="margin-bottom:var(--fk-sp-3)">Follow-up history</div><div id="cd-followups"><div class="nx-skel" style="height:80px"></div></div></div>' +
      '</div>' +
    '</div>' +
    '<div id="cd-tab-ledger" style="display:none"><div id="cd-ledger-body"></div></div>' +
    '<div id="cd-tab-health" style="display:none"><div id="cd-health-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    '<div id="cd-tab-promises" style="display:none"><div id="cd-promises-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    '<div id="cd-tab-paylinks" style="display:none"><div id="cd-paylinks-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    '<div id="cd-tab-documents" style="display:none"><div id="cd-documents-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>' +
    (isA?'<div id="cd-tab-history" style="display:none"><div id="cd-history-body"><div class="nx-card">' + NX.empty({message:'Loading…'}) + '</div></div></div>':'') +
  '</div>';

  _cdLoadOverview(clientId, c);
  _cdLoadActivity(clientId, c);

  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#cd-form-nav', entity: 'client', dateField: 'createdAt', currentId: clientId, storageKey:'rms.fnav.client',
      loadList: async () => (window._clientsCache || []).map(x => ({ id: x.id, createdAt: x.createdAt || x.created_at || '' })),
      openEntry: (id) => openClientDetail(id),
      onEdit:    (id) => isA && ClientForm.open({ clientId: id, onSaved: function(){ rClientDetail(); } }),
      onDelete:  async () => { if (typeof toast === 'function') toast('Use Deactivate instead — clients are never hard-deleted.', 'warn'); }
    });
  }
}

// Units linked to this client (for Log Follow-up, which is unit-keyed via openConModal)
let _cdUnitIds = [];
function _cdClientUnitIds() {
  if (_cdUnitIds.length) return _cdUnitIds;
  const c = gclient(_cid); if (!c) return [];
  return ((typeof gunits==='function'?gunits():[])||[]).filter(u => u.clientId === _cid || (c.fullName && u.customerName && u.customerName.toLowerCase() === c.fullName.toLowerCase())).map(u => u.id);
}
function _cdLogFollowUp() {
  const ids = _cdClientUnitIds();
  if (!ids.length) { toast('No unit linked to this client to log against.', 'warn'); return; }
  if (typeof openConModal === 'function') openConModal(ids[0]);
  else toast('Contact log unavailable.', 'warn');
}

// Portfolio + financial summary. Spine = list_sales_by_client_all (all sales incl
// cancelled, with sale_number/status); active balances merged from get_recovery_position
// by sale_id. Balances come from RP (dashboard-consistent), NEVER sales.remaining_amount.
async function _cdLoadOverview(clientId, c) {
  const fin = document.getElementById('cd-fin');
  const port = document.getElementById('cd-portfolio');
  let allSales = [], rpRows = [];
  try {
    const [allRes, rpRes] = await Promise.all([
      supabase.rpc('list_sales_by_client_all', { p_client_id: clientId, p_company_id: S.cid }),
      supabase.rpc('get_recovery_position', { p_company_id: S.cid, p_project_id: null, p_from_date: null, p_to_date: (typeof td==='function'?td():null) })
    ]);
    allSales = Array.isArray(allRes.data) ? allRes.data : [];
    rpRows = ((rpRes.data && rpRes.data.rows) || []).filter(r => r.client_code === c.clientCode);
  } catch (e) { if (port) port.innerHTML = NX.empty({ icon:'alert-triangle', message:'Could not load portfolio.' }); }

  const rpBySale = {};
  rpRows.forEach(r => { if (r.sale_id) rpBySale[r.sale_id] = r; });
  _cdUnitIds = allSales.filter(s => s.status === 'active').map(s => s.unit_id).filter(Boolean);

  const contracted = rpRows.reduce((a,r)=>a+Number(r.net_price||0),0);
  const paid = rpRows.reduce((a,r)=>a+Number(r.paid_to_date||0),0);
  const balance = rpRows.reduce((a,r)=>a+Number(r.closing||0),0);
  const overdue = rpRows.reduce((a,r)=>a+Number(r.closing_old||0),0);
  if (fin) fin.innerHTML = NX.kpi({label:'Contracted (net)', value:fMF(contracted)}) + NX.kpi({label:'Paid', value:fMF(paid)}) + NX.kpi({label:'Balance', value:fMF(balance)}) + NX.kpi({label:'Overdue today', value:fMF(overdue)});

  if (!port) return;
  const unitsCache = (typeof gunits==='function'?gunits():[])||[];
  if (!allSales.length) { port.innerHTML = NX.empty({ icon:'inbox', message:'No sales linked to this client.' }); return; }
  // active first, then cancelled
  allSales.sort((a,b) => (a.status==='cancelled'?1:0) - (b.status==='cancelled'?1:0));
  const rows = allSales.map(s => {
    const cancelled = s.status === 'cancelled';
    const rp = rpBySale[s.id];
    const u = unitsCache.find(x => x.id === s.unit_id);
    const unitNo = (rp && rp.unit_no) || (u && u.unitNo) || '—';
    const net = rp ? Number(rp.net_price||0) : Number(s.net_amount||0);
    const pd = rp ? Number(rp.paid_to_date||0) : 0;
    const bal = cancelled ? 0 : (rp ? Number(rp.closing||0) : 0);
    const odd = rp ? Number(rp.overdue_days||0) : 0;
    return [
      esc(unitNo),
      '<span class="nx-mono">' + esc(s.sale_number||'—') + '</span>',
      fMF(net),
      cancelled ? '—' : fMF(pd),
      cancelled ? '<span style="color:var(--fk-text-muted)">—</span>' : '<span style="color:' + (bal>0?'var(--fk-warning)':'var(--fk-success)') + '">' + fMF(bal) + '</span>',
      (!cancelled && odd>0) ? NX.badge(odd+'d','danger',{dot:true}) : '—',
      cancelled ? NX.badge('Cancelled','danger') : NX.badge('Active','success')
    ];
  });
  const cols = [{label:'Unit'},{label:'Sale #'},{label:'Net',num:true},{label:'Paid',num:true},{label:'Balance',num:true},{label:'Overdue'},{label:'Status'}];
  const nCancel = allSales.filter(s=>s.status==='cancelled').length;
  port.innerHTML = '<div class="nx-table-wrap">' + NX.table({ cols, rows, flush:true }) + '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:18px;padding:var(--fk-sp-3) var(--fk-sp-4);border-top:1px solid var(--fk-border);font-size:13px;flex-wrap:wrap">' +
      '<span class="nx-kpi-label" style="text-transform:none">' + rpRows.length + ' active' + (nCancel?(' · ' + nCancel + ' cancelled'):'') + '</span>' +
      '<span>Net <strong>' + fMF(contracted) + '</strong></span><span>Paid <strong>' + fMF(paid) + '</strong></span><span>Balance <strong>' + fMF(balance) + '</strong></span>' +
    '</div>';
}

// Activity: recent payments (ledger CR rows) + follow-up history (contact_logs)
async function _cdLoadActivity(clientId, c) {
  try {
    const { data } = await supabase.rpc('get_client_ledger', { p_client_id: clientId, p_company_id: S.cid, p_from_date: null, p_to_date: null });
    const rows = (data && data.rows) ? data.rows : [];
    const pays = rows.filter(r => r.row_type === 'CR').reverse().slice(0, 10);
    const el = document.getElementById('cd-payments');
    if (el) el.innerHTML = pays.length ? pays.map(p =>
      '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--fk-border)">' +
        '<div><div style="font-size:13px">' + esc((p.description||'Payment').replace('Payment Received — ','')) + '</div>' +
        '<div class="nx-kpi-label" style="text-transform:none">' + fD(p.entry_date) + (p.voucher_no?' · '+esc(p.voucher_no):'') + (p.chq_no?' · Chq '+esc(p.chq_no):'') + '</div></div>' +
        '<div style="color:var(--fk-success);font-weight:var(--fk-fw-semibold);white-space:nowrap">' + fMF(p.credit) + '</div></div>'
    ).join('') : NX.empty({ message:'No payments recorded yet.' });
  } catch (e) {}
  try {
    const { data } = await supabase.rpc('get_contact_logs_cache', { p_company_id: S.cid });
    const logs = (Array.isArray(data)?data:[]).filter(l => l.client_id === clientId).slice(0, 10);
    const el = document.getElementById('cd-followups');
    if (el) el.innerHTML = logs.length ? logs.map(l =>
      '<div style="padding:7px 0;border-bottom:1px solid var(--fk-border)">' +
        '<div style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:13px">' + esc(l.contact_type||l.intent||l.outcome||'Contact') + (l.agent_name?' · '+esc(l.agent_name):'') + '</span><span class="nx-kpi-label" style="text-transform:none">' + fD(l.contact_date) + '</span></div>' +
        (l.notes?'<div class="nx-kpi-label" style="text-transform:none">' + esc(l.notes) + '</div>':'') +
        (l.next_follow_up_date?'<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-warning)">Next: ' + fD(l.next_follow_up_date) + '</div>':'') +
      '</div>'
    ).join('') : NX.empty({ message:'No follow-ups logged yet.' });
  } catch (e) {}
}

`;

const i = s.indexOf('function rClientDetail() {');
const j = s.indexOf('// ── Client detail tabs', i);
if (i < 0 || j < 0) { console.log('ANCHOR MISS', i, j); process.exit(1); }
console.log('replacing', j - i, 'chars');
s = s.slice(0, i) + NEW + s.slice(j);
fs.writeFileSync(f, s);
console.log('done');
