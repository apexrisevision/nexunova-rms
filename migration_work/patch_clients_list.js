const fs = require('fs');
const f = 'js/pages/clients.js';
let s = fs.readFileSync(f, 'utf8');

const newClients = `function rClients() {
  const cid = S?.cid;
  const pg = document.getElementById('pg-clients');
  if (!pg) return;
  if (!cid) { pg.innerHTML = \`<div class="nx-card">\${NX.empty({ icon:'inbox', message:'No company selected' })}</div>\`; return; }

  if (_cTabPending) { _cTab = _cTabPending; _cTabPending = null; } else { _cTab = 'all'; }
  const isA = S.role === 'admin' || S.role === 'owner';

  const all = gclients();
  const total = all.length;
  const active = all.filter(c => c.status === 'active').length;
  const historical = all.filter(c => c.status === 'inactive').length;

  const actions =
    NX.button('Print', { variant:'ghost', size:'sm', onclick:'printClientsList()' }) +
    (isA ? NX.button('Add client', { variant:'primary', size:'sm', icon:'plus', attrs:'id="cl-add-btn"', onclick:'ClientForm.open({ onSaved: function(){ rClients(); } })' }) : '');

  pg.innerHTML = \`<div class="nx-page">
    <div class="nx-page-header">
      <div><h1 class="nx-page-title">Clients</h1>
        <div class="nx-kpi-label" id="cl-count" style="margin-top:4px">\${total} clients · \${active} active · \${historical} historical</div></div>
      <div class="nx-page-actions">\${actions}</div>
    </div>
    <div class="nx-segment" style="margin-bottom:var(--fk-sp-4)">
      <button class="nx-btn nx-btn--sm \${_cTab==='all'?'nx-btn--primary':'nx-btn--ghost'}" onclick="setClientsTab('all')">All clients</button>
      <button class="nx-btn nx-btn--sm \${_cTab==='health'?'nx-btn--primary':'nx-btn--ghost'}" onclick="setClientsTab('health')">Health</button>
      <button class="nx-btn nx-btn--sm \${_cTab==='blacklist'?'nx-btn--primary':'nx-btn--ghost'}" onclick="setClientsTab('blacklist')">Blacklist</button>
    </div>
    <div id="cl-tab-mount" style="\${_cTab==='all'?'display:none':''}"></div>
    <div id="cl-all" style="\${_cTab==='all'?'':'display:none'}">
      <div id="cl-kpis" class="nx-kpi-row" style="margin-bottom:var(--fk-sp-4)"></div>
      <div class="nx-card nx-card--compact" style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:center;margin-bottom:var(--fk-sp-4)">
        <div style="position:relative;flex:1;min-width:200px;max-width:300px">
          <input class="nx-input" id="cl-s" placeholder="Name, NIC, phone, code…" value="\${esc(_clSearch)}" oninput="_clSetSearch(this.value)" autocomplete="off" style="padding-left:32px">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);pointer-events:none">\${NX.icon('search',14)}</span>
        </div>
        <div class="nx-segment" id="cl-status-seg">
          \${[['active','Active'],['inactive','Historical'],['','All']].map(([v,l])=>\`<button class="nx-btn nx-btn--sm \${_clStatus===v?'nx-btn--primary':'nx-btn--ghost'}" onclick="_clSetStatus('\${v}')">\${l}</button>\`).join('')}
        </div>
        <div id="cl-project-wrap"></div>
        <select class="nx-select" style="width:auto" onchange="_clSetRisk(this.value)">
          \${[['','Any risk'],['overdue','Overdue > 0'],['aging90','90d+ overdue']].map(([v,l])=>\`<option value="\${v}"\${_clRisk===v?' selected':''}>\${l}</option>\`).join('')}
        </select>
      </div>
      <div id="cl-ct"></div>
    </div>
  </div>\`;

  const projs = (typeof gprojects==='function'?gprojects():(window._projectsCache||[]))||[];
  const pw = document.getElementById('cl-project-wrap');
  if (pw && projs.length>1) pw.innerHTML = \`<select class="nx-select" style="width:auto" onchange="_clSetProject(this.value)"><option value="">All projects</option>\${projs.map(p=>\`<option value="\${esc(p.id)}"\${_clProject===p.id?' selected':''}>\${esc(p.projectName||p.name||'Project')}</option>\`).join('')}</select>\`;

  if (_cTab==='all') { _clLoadAndRender(); _checkClientLimitUI(); }
  else if (_cTab==='health' && typeof rHealthCenter==='function') rHealthCenter();
  else if (_cTab==='blacklist' && typeof rBlacklist==='function') rBlacklist();
}

`;

const newCLF = `var _clStatus = 'active';   // Active default (spec)
var _clProject = '';
var _clRisk = '';            // '' | 'overdue' | 'aging90'
var _clSearch = '';
var _clRpByCode = {};        // client_code -> aggregated RP balances
var _clSearchTimer = null;

// Balances/overdue come from get_recovery_position (dashboard-consistent), merged
// by client_code onto the roster. NEVER sales.remaining_amount (cohort trap).
async function _clLoadAndRender() {
  const ct = document.getElementById('cl-ct');
  if (!ct) return;
  ct.innerHTML = \`<div class="nx-card">\${[0,1,2,3].map(()=>'<div class="nx-skel" style="height:40px;margin:6px 0;border-radius:8px"></div>').join('')}</div>\`;
  _clRpByCode = {};
  try {
    const { data } = await supabase.rpc('get_recovery_position', { p_company_id: S.cid, p_project_id: null, p_from_date: null, p_to_date: (typeof td==='function'?td():null) });
    const rows = (data && data.rows) ? data.rows : [];
    rows.forEach(r => {
      const code = r.client_code; if (!code) return;
      const a = _clRpByCode[code] || (_clRpByCode[code] = { units:0, contracted:0, paid:0, balance:0, overdue:0, overdueDays:0 });
      a.units += 1;
      a.contracted += Number(r.net_price||0);
      a.paid += Number(r.paid_to_date||0);
      a.balance += Number(r.closing||0);
      a.overdue += Number(r.closing_old||0);
      if (Number(r.closing||0) > 0) a.overdueDays = Math.max(a.overdueDays, Number(r.overdue_days||0));
    });
  } catch(e) { /* balances unavailable — roster still renders */ }
  _clRenderKpis();
  rCLF();
}

function _clRosterFiltered() {
  const q = (_clSearch||'').trim().toLowerCase();
  return gclients().filter(c => {
    if (_clStatus && c.status !== _clStatus) return false;
    if (_clProject && c.projectId !== _clProject) return false;
    const rp = _clRpByCode[c.clientCode] || null;
    if (_clRisk === 'overdue' && !(rp && (rp.overdue > 0 || rp.overdueDays > 0))) return false;
    if (_clRisk === 'aging90' && !(rp && rp.overdueDays >= 90)) return false;
    if (q) {
      const hay = (\`\${c.fullName||''} \${c.cnic||''} \${c.phonePrimary||''} \${c.clientCode||''}\`).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _clRenderKpis() {
  const el = document.getElementById('cl-kpis'); if (!el) return;
  const roster = _clRosterFiltered();
  let bal = 0, ovd = 0;
  roster.forEach(c => { const rp = _clRpByCode[c.clientCode]; if (rp) { bal += rp.balance; ovd += rp.overdue; } });
  const active = roster.filter(c => c.status === 'active').length;
  el.innerHTML =
    NX.kpi({ label:'Clients shown', value: roster.length }) +
    NX.kpi({ label:'Active', value: active }) +
    NX.kpi({ label:'Total balance', value: fMF(bal) }) +
    NX.kpi({ label:'Overdue', value: fMF(ovd) });
}

function rCLF() {
  const ct = document.getElementById('cl-ct'); if (!ct) return;
  const roster = _clRosterFiltered();
  if (!roster.length) { ct.innerHTML = \`<div class="nx-card">\${NX.empty({ icon:'search', message:'No clients match these filters.' })}</div>\`; return; }
  const cols = [
    {label:'Code'},{label:'Client'},{label:'NIC'},{label:'Phone'},
    {label:'Units',num:true},{label:'Balance',num:true},{label:'Overdue',num:true},{label:'Status'}
  ];
  const rows = roster.map(c => {
    const rp = _clRpByCode[c.clientCode] || null;
    const bal = rp ? rp.balance : 0, ovd = rp ? rp.overdue : 0, units = rp ? rp.units : 0;
    const tone = c.status === 'active' ? 'success' : c.status === 'blacklisted' ? 'danger' : '';
    const lbl = c.status === 'inactive' ? 'Historical' : (c.status ? c.status[0].toUpperCase()+c.status.slice(1) : '—');
    return [
      \`<span class="nx-mono" style="color:var(--fk-primary);font-weight:var(--fk-fw-semibold)">\${esc(c.clientCode||'—')}</span>\`,
      \`\${esc(c.fullName||'Unnamed')}\${c.fatherName?\`<div class="nx-kpi-label" style="text-transform:none">S/o \${esc(c.fatherName)}</div>\`:''}\`,
      \`<span class="nx-mono">\${esc(c.cnic||'—')}</span>\`,
      esc(c.phonePrimary||'—'),
      units||'—',
      fMF(bal),
      \`<span style="color:\${ovd>0?'var(--fk-danger)':'var(--fk-text-muted)'}">\${ovd>0?fMF(ovd):'—'}</span>\`,
      NX.badge(lbl, tone, { dot:true })
    ];
  });
  ct.innerHTML = \`<div class="nx-card nx-card--flush"><div class="nx-table-wrap">\${NX.table({ cols, rows, flush:true })}</div></div>\`;
  ct.querySelectorAll('tbody tr').forEach((tr,i)=>{ tr.style.cursor='pointer'; tr.onclick=()=>openClientDetail(roster[i].id); });
}

function _clSetSearch(v){ _clSearch=v; clearTimeout(_clSearchTimer); _clSearchTimer=setTimeout(()=>{ _clRenderKpis(); rCLF(); },200); }
function _clSetStatus(v){
  _clStatus=v;
  const seg=document.getElementById('cl-status-seg');
  if(seg) seg.querySelectorAll('.nx-btn').forEach(b=>{ const on=(b.textContent.trim()===(v==='active'?'Active':v==='inactive'?'Historical':'All')); b.classList.toggle('nx-btn--primary',on); b.classList.toggle('nx-btn--ghost',!on); });
  _clRenderKpis(); rCLF();
}
function _clSetProject(v){ _clProject=v; _clRenderKpis(); rCLF(); }
function _clSetRisk(v){ _clRisk=v; _clRenderKpis(); rCLF(); }

`;

function spliceBetween(str, startAnchor, endAnchor, replacement, label) {
  const i = str.indexOf(startAnchor);
  const j = str.indexOf(endAnchor, i + startAnchor.length);
  if (i < 0 || j < 0) { console.log('ANCHOR MISS:', label, i, j); return str; }
  console.log('spliced', label, 'removed', j - i, 'chars');
  return str.slice(0, i) + replacement + str.slice(j);
}

s = spliceBetween(s, 'function rClients() {', 'async function _checkClientLimitUI() {', newClients, 'rClients');
s = spliceBetween(s, 'function rCLF() {', 'function openClientPeek(id) {', newCLF, 'rCLF');

fs.writeFileSync(f, s);
console.log('done');
