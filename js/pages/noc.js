// ══ NOC MANAGEMENT (Module 9.2) ══════════════════════════════════
// No-Objection Certificate: bank / transfer / general
// Workflow: pending → under_review → approved | rejected → revoked
// Backend: supabase/migrations/20260525_module9_2_noc_management.sql
// RPCs: check_noc_eligibility, create_noc_request, get_noc_list,
//       get_noc_by_id, update_noc_status, get_noc_analytics, delete_noc

let _nocList        = [];
let _nocFilter      = 'all';   // all | pending | under_review | approved | rejected | revoked
let _nocTypeFilter  = '';
let _nocSearch      = '';
let _nocAnalytics   = null;
let _nocUnitSearch  = '';
let _nocUnitResults = [];
let _nocSelUnit     = null;   // { id, unitNo, projectName, clientName, clientPhone, saleId }

// ── Status helpers ────────────────────────────────────────────────

const NOC_STATUS_META = {
  pending:      { label: 'Pending',      color: '#f59e0b', bg: 'rgba(245,158,11,.12)'  },
  under_review: { label: 'Under Review', color: '#6366f1', bg: 'rgba(99,102,241,.12)'  },
  approved:     { label: 'Approved',     color: '#16a34a', bg: 'rgba(22,163,74,.12)'   },
  rejected:     { label: 'Rejected',     color: '#dc2626', bg: 'rgba(220,38,38,.12)'   },
  revoked:      { label: 'Revoked',      color: '#6b7280', bg: 'rgba(107,114,128,.12)' },
};

const NOC_TYPE_META = {
  bank:     { label: 'Bank NOC',      icon: '🏦' },
  transfer: { label: 'Transfer NOC',  icon: '🔄' },
  general:  { label: 'General NOC',   icon: '📋' },
};

const _NOC_STATUS_TONE = { pending:'warning', under_review:'info', approved:'success', rejected:'danger', revoked:'' };
const _NOC_TYPE_ICON   = { bank:'banknote', transfer:'history', general:'file-text' };

function _nocBadge(status) {
  const m = NOC_STATUS_META[status] || { label: status };
  return NX.badge(m.label || status, _NOC_STATUS_TONE[status] || '', { dot:true });
}

function _nocTypeBadge(type) {
  const m = NOC_TYPE_META[type] || { label: type };
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--fk-text-muted)">${NX.icon(_NOC_TYPE_ICON[type] || 'file-text', 14)}${esc(m.label)}</span>`;
}

// One-time NOC page CSS
function _nocCSS() {
  if (document.getElementById('_noc_css')) return;
  const s = document.createElement('style'); s.id = '_noc_css';
  s.textContent = `
    .noc-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:18px}
    @media(max-width:960px){.noc-kpis{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:560px){.noc-kpis{grid-template-columns:repeat(2,1fr)}}
    .noc-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .noc-toolbar .nx-input{max-width:280px}
    .noc-acts{display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
  `;
  document.head.appendChild(s);
}

// ── Entry point ───────────────────────────────────────────────────

async function rNOC() {
  const pg = document.getElementById('pg-noc');
  if (!pg) return;
  _nocCSS();

  const typeSel = `<select class="nx-select" style="max-width:150px" onchange="_nocSetType(this.value)">
      <option value="">All types</option>
      <option value="bank" ${_nocTypeFilter==='bank'?'selected':''}>Bank NOC</option>
      <option value="transfer" ${_nocTypeFilter==='transfer'?'selected':''}>Transfer NOC</option>
      <option value="general" ${_nocTypeFilter==='general'?'selected':''}>General NOC</option>
    </select>`;

  pg.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('NOC Management',
        NX.button('Refresh', { variant:'secondary', onclick:'_nocRefresh()' }) +
        NX.button('New NOC request', { variant:'primary', icon:'plus', onclick:'_nocOpenCreate()' }),
        { icon:'file-text', sub:'Issue and manage No-Objection Certificates — bank, transfer and general.' }) +
      '<div id="noc-kpi-strip" class="noc-kpis"></div>' +
      '<div id="noc-tabs" style="margin-bottom:12px"></div>' +
      `<div class="noc-toolbar">${typeSel}
        <input class="nx-input" type="search" placeholder="Search client / unit / NOC#…" value="${esc(_nocSearch)}" oninput="_nocSetSearch(this.value)">
      </div>` +
      '<div id="noc-list-body">' + NX.card(NX.empty({ icon:'file-text', message:'Loading NOCs…' })) + '</div>' +
    '</div>';

  _nocRenderTabs();
  _nocInjectModals(pg);
  await _nocRefresh();
}

async function _nocRefresh() {
  await Promise.all([_nocLoadAnalytics(), _nocLoad()]);
}

function _nocRenderTabs() {
  const el = document.getElementById('noc-tabs');
  if (!el) return;
  const a = _nocAnalytics || {};
  const counts = { all:a.total, pending:a.pending, approved:a.approved };
  const defs = [['all','All'],['pending','Pending'],['under_review','Under Review'],['approved','Approved'],['rejected','Rejected'],['revoked','Revoked']];
  el.innerHTML = NX.tabs({
    tabs: defs.map(([k,label]) => ({ k, label, count: counts[k] })),
    active: _nocFilter, onSelect: "_nocSetFilter('%k')"
  });
}

function _nocSetFilter(f) { _nocFilter = f; _nocRenderTabs(); _nocLoad(); }
function _nocSetType(v)   { _nocTypeFilter = v; _nocLoad(); }
function _nocSetSearch(v) { _nocSearch = v; _nocLoad(); }

// ── Analytics KPI strip ───────────────────────────────────────────

async function _nocLoadAnalytics() {
  const strip = document.getElementById('noc-kpi-strip');
  if (!strip) return;
  try {
    const { data } = await supabase.rpc('get_noc_analytics', { p_company_id: S.cid });
    _nocAnalytics = data || {};
    const a = _nocAnalytics;
    const kpis = [
      { icon:'file-text',      label:'Total NOCs',    val:a.total        || 0 },
      { icon:'clock',          tone:'warning', label:'Pending',  val:a.pending      || 0 },
      { icon:'check-circle',   tone:'success', label:'Approved', val:a.approved     || 0 },
      { icon:'calendar',       label:'This Month',    val:a.this_month   || 0 },
      { icon:'alert-triangle', tone:'danger',  label:'Expiring Soon', val:a.expiring_soon || 0 },
      { icon:'x-circle',       label:'Revoked',       val:a.revoked      || 0 },
    ];
    strip.innerHTML = kpis.map(k => NX.kpi({ icon:k.icon, tone:k.tone, label:k.label, value:String(k.val) })).join('');
    _nocRenderTabs();   // refresh count chips now that analytics are in
  } catch(e) { /* non-blocking */ }
}

// ── List ──────────────────────────────────────────────────────────

async function _nocLoad() {
  const body = document.getElementById('noc-list-body');
  if (!body) return;
  body.innerHTML = NX.card(NX.empty({ icon:'file-text', message:'Loading NOCs…' }));
  try {
    const { data, error } = await supabase.rpc('get_noc_list', {
      p_company_id: S.cid,
      p_status:   _nocFilter !== 'all' ? _nocFilter : null,
      p_noc_type: _nocTypeFilter || null,
      p_search:   _nocSearch     || null,
    });
    if (error) throw error;
    _nocList = Array.isArray(data) ? data : [];
    _nocRenderList();
  } catch(e) {
    body.innerHTML = NX.card(NX.banner('Could not load NOCs: ' + (e.message || 'Error'), 'danger'));
  }
}

function _nocRenderList() {
  const body = document.getElementById('noc-list-body');
  if (!body) return;

  if (!_nocList.length) {
    body.innerHTML = NX.card(NX.empty({
      icon:'file-text',
      message:'No NOCs found — create the first NOC request using the button above.',
      action: NX.button('New NOC request', { variant:'primary', icon:'plus', onclick:'_nocOpenCreate()' })
    }));
    return;
  }

  const canAdmin = ['admin','owner','manager'].includes(S.role);

  const rows = _nocList.map(n => {
    const isExpired = n.valid_until && new Date(n.valid_until) < new Date();
    const validUntilTxt = n.valid_until
      ? (isExpired ? `<span style="color:var(--fk-danger)">${fD(n.valid_until)} · expired</span>` : fD(n.valid_until))
      : '—';

    const canReview  = canAdmin && (n.status === 'pending');
    const canApprove = canAdmin && (n.status === 'pending' || n.status === 'under_review');
    const canReject  = canAdmin && (n.status === 'pending' || n.status === 'under_review');
    const canRevoke  = canAdmin && n.status === 'approved';
    const canDel     = canAdmin && (n.status === 'pending' || n.status === 'rejected');
    const canPrint   = n.status === 'approved';

    const acts =
      (canReview  ? NX.button('Review',  { variant:'secondary', size:'sm', onclick:`_nocMarkReview('${n.id}')` }) : '') +
      (canApprove ? NX.button('Approve', { variant:'primary',   size:'sm', onclick:`_nocOpenApprove('${n.id}')` }) : '') +
      (canReject  ? NX.button('Reject',  { variant:'danger-soft', size:'sm', onclick:`_nocOpenReject('${n.id}')` }) : '') +
      (canRevoke  ? NX.button('Revoke',  { variant:'secondary', size:'sm', onclick:`_nocOpenRevoke('${n.id}')` }) : '') +
      (canPrint   ? NX.button('Print',   { variant:'ghost', size:'sm', onclick:`_nocPrint('${n.id}')` }) : '') +
      (canDel     ? NX.button('Delete',  { variant:'ghost', size:'sm', onclick:`_nocDelete('${n.id}')` }) : '');

    return [
      `<span style="font-weight:600;color:var(--fk-primary);white-space:nowrap">${esc(n.noc_number||'—')}</span>`,
      _nocTypeBadge(n.noc_type),
      `<div style="font-weight:500;color:var(--fk-text)">${esc(n.client_name||'—')}</div>
       <div style="font-size:11px;color:var(--fk-text-muted)">${esc(n.unit_no||'')}${n.project_name?` · ${esc(n.project_name)}`:''}</div>`,
      _nocBadge(n.status),
      `<span style="white-space:nowrap;font-size:12px;color:var(--fk-text-muted)">${n.requested_at?fD(n.requested_at):'—'}</span>`,
      `<span style="font-size:12px">${validUntilTxt}</span>`,
      `<div class="noc-acts">${acts}</div>`
    ];
  });

  body.innerHTML = NX.card(NX.table({
    cols: [
      { label:'NOC #' }, { label:'Type' }, { label:'Client / Unit' }, { label:'Status' },
      { label:'Requested' }, { label:'Valid Until' }, { label:'Actions', num:true }
    ],
    rows, flush:true
  }), { flush:true });
}

// ── Modals HTML injection ─────────────────────────────────────────

function _nocInjectModals(pg) {
  pg.insertAdjacentHTML('beforeend', `
    <!-- New NOC Request Modal -->
    <div class="mov" id="m-noc-create">
      <div class="mox" style="max-width:540px">
        <div class="moh">
          <span class="mot">New NOC Request</span>
          <button class="moc" onclick="cm('m-noc-create')">✕</button>
        </div>
        <div class="mob" style="display:flex;flex-direction:column;gap:14px">
          <!-- Unit search -->
          <div>
            <label class="lbl">Unit *</label>
            <div style="position:relative">
              <input class="inp" id="noc-unit-search" type="search" placeholder="Search by unit no, client name…"
                oninput="_nocSearchUnits(this.value)" autocomplete="off">
              <div id="noc-unit-results" style="position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--card);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);max-height:200px;overflow-y:auto;display:none"></div>
            </div>
            <div id="noc-unit-selected" style="display:none;margin-top:6px;padding:10px 12px;background:var(--hover);border-radius:8px;font-size:13px"></div>
          </div>
          <!-- Eligibility banner -->
          <div id="noc-elig-banner" style="display:none;padding:10px 14px;border-radius:8px;font-size:13px"></div>
          <!-- NOC Type -->
          <div>
            <label class="lbl">NOC Type *</label>
            <select class="inp" id="noc-type-sel" onchange="_nocEligCheck()">
              <option value="bank">🏦 Bank NOC</option>
              <option value="transfer">🔄 Transfer NOC</option>
              <option value="general">📋 General NOC</option>
            </select>
          </div>
          <!-- Purpose -->
          <div>
            <label class="lbl">Purpose</label>
            <textarea class="inp" id="noc-purpose" rows="2" placeholder="Reason / purpose for this NOC…" style="resize:vertical"></textarea>
          </div>
          <!-- Validity -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="lbl">Valid From</label>
              <input class="inp" id="noc-valid-from" type="date">
            </div>
            <div>
              <label class="lbl">Valid Until</label>
              <input class="inp" id="noc-valid-until" type="date">
            </div>
          </div>
          <!-- Notes -->
          <div>
            <label class="lbl">Notes</label>
            <textarea class="inp" id="noc-notes" rows="2" style="resize:vertical" placeholder="Internal notes…"></textarea>
          </div>
        </div>
        <div class="mof">
          <button class="btn btn-gh" onclick="cm('m-noc-create')">Cancel</button>
          <button class="btn btn-g" id="noc-create-btn" onclick="_nocSubmitCreate()">Submit Request</button>
        </div>
      </div>
    </div>

    <!-- Approve Modal -->
    <div class="mov" id="m-noc-approve">
      <div class="mox" style="max-width:420px">
        <div class="moh">
          <span class="mot">Approve NOC</span>
          <button class="moc" onclick="cm('m-noc-approve')">✕</button>
        </div>
        <div class="mob" style="display:flex;flex-direction:column;gap:14px">
          <input type="hidden" id="noc-approve-id">
          <div style="padding:12px;background:rgba(22,163,74,.08);border-radius:8px;font-size:13px;color:#16a34a">
            Approving this NOC will mark it as active. Ensure payment eligibility has been verified.
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="lbl">Valid From</label>
              <input class="inp" id="noc-app-from" type="date">
            </div>
            <div>
              <label class="lbl">Valid Until</label>
              <input class="inp" id="noc-app-until" type="date">
            </div>
          </div>
          <div>
            <label class="lbl">Approved By</label>
            <input class="inp" id="noc-app-by" type="text" placeholder="Approver name">
          </div>
        </div>
        <div class="mof">
          <button class="btn btn-gh" onclick="cm('m-noc-approve')">Cancel</button>
          <button class="btn btn-g" id="noc-approve-btn" onclick="_nocSubmitApprove()">Approve NOC</button>
        </div>
      </div>
    </div>

    <!-- Reject Modal -->
    <div class="mov" id="m-noc-reject">
      <div class="mox" style="max-width:400px">
        <div class="moh">
          <span class="mot">Reject NOC</span>
          <button class="moc" onclick="cm('m-noc-reject')">✕</button>
        </div>
        <div class="mob" style="display:flex;flex-direction:column;gap:14px">
          <input type="hidden" id="noc-reject-id">
          <div>
            <label class="lbl">Rejection Reason *</label>
            <textarea class="inp" id="noc-reject-reason" rows="3" placeholder="Reason for rejection…" style="resize:vertical"></textarea>
          </div>
          <div>
            <label class="lbl">Reviewed By</label>
            <input class="inp" id="noc-reject-by" type="text" placeholder="Reviewer name">
          </div>
        </div>
        <div class="mof">
          <button class="btn btn-gh" onclick="cm('m-noc-reject')">Cancel</button>
          <button class="btn btn-xs" style="padding:8px 18px;background:rgba(220,38,38,.1);color:#dc2626;border:1px solid rgba(220,38,38,.25);border-radius:8px;cursor:pointer;font-weight:700" id="noc-reject-btn" onclick="_nocSubmitReject()">Reject NOC</button>
        </div>
      </div>
    </div>

    <!-- Revoke Modal -->
    <div class="mov" id="m-noc-revoke">
      <div class="mox" style="max-width:400px">
        <div class="moh">
          <span class="mot">Revoke NOC</span>
          <button class="moc" onclick="cm('m-noc-revoke')">✕</button>
        </div>
        <div class="mob" style="display:flex;flex-direction:column;gap:14px">
          <input type="hidden" id="noc-revoke-id">
          <div style="padding:12px;background:rgba(220,38,38,.08);border-radius:8px;font-size:13px;color:#dc2626">
            ⚠ Revoking an approved NOC cancels its validity. This action cannot be undone.
          </div>
          <div>
            <label class="lbl">Revocation Reason *</label>
            <textarea class="inp" id="noc-revoke-reason" rows="3" placeholder="Reason for revocation…" style="resize:vertical"></textarea>
          </div>
          <div>
            <label class="lbl">Revoked By</label>
            <input class="inp" id="noc-revoke-by" type="text" placeholder="Officer name">
          </div>
        </div>
        <div class="mof">
          <button class="btn btn-gh" onclick="cm('m-noc-revoke')">Cancel</button>
          <button class="btn btn-xs" style="padding:8px 18px;background:rgba(220,38,38,.1);color:#dc2626;border:1px solid rgba(220,38,38,.25);border-radius:8px;cursor:pointer;font-weight:700" id="noc-revoke-btn" onclick="_nocSubmitRevoke()">Revoke NOC</button>
        </div>
      </div>
    </div>
  `);
}

// ── New NOC Request ───────────────────────────────────────────────

function _nocOpenCreate() {
  _nocSelUnit     = null;
  _nocUnitResults = [];
  const s  = document.getElementById('noc-unit-search');
  const rs = document.getElementById('noc-unit-results');
  const sd = document.getElementById('noc-unit-selected');
  const eb = document.getElementById('noc-elig-banner');
  if (s)  s.value = '';
  if (rs) { rs.innerHTML = ''; rs.style.display = 'none'; }
  if (sd) sd.style.display = 'none';
  if (eb) eb.style.display = 'none';
  const tf = document.getElementById('noc-type-sel');
  if (tf) tf.value = 'bank';
  ['noc-purpose','noc-notes'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const today = new Date().toISOString().split('T')[0];
  const el = document.getElementById('noc-valid-from');
  if (el) el.value = today;
  const eu = document.getElementById('noc-valid-until');
  if (eu) eu.value = '';
  om('m-noc-create');
}

async function _nocSearchUnits(q) {
  _nocUnitSearch = q.trim();
  const rs = document.getElementById('noc-unit-results');
  if (!rs) return;

  if (!_nocUnitSearch) { rs.innerHTML = ''; rs.style.display = 'none'; return; }

  const lower = _nocUnitSearch.toLowerCase();
  const hits = (typeof gunits === 'function' ? gunits() : (_unitsCache || []))
    .filter(u => !u.isAvailable &&
      (u.unitNo?.toLowerCase().includes(lower) ||
       u.customerName?.toLowerCase().includes(lower) ||
       u.projectName?.toLowerCase().includes(lower)))
    .slice(0, 12);

  if (!hits.length) {
    rs.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--t3)">No sold units found</div>';
    rs.style.display = 'block';
    return;
  }

  rs.innerHTML = hits.map(u => `
    <div style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--hover);transition:background .15s"
      onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''"
      onclick="_nocSelectUnit('${u.id}')">
      <div style="font-weight:600;font-size:13px;color:var(--t1)">${esc(u.unitNo||u.id)}</div>
      <div style="font-size:11px;color:var(--t3)">${esc(u.customerName||'')}${u.projectName?` · ${esc(u.projectName)}`:''}</div>
    </div>`).join('');
  rs.style.display = 'block';
}

async function _nocSelectUnit(unitId) {
  const rs = document.getElementById('noc-unit-results');
  const sd = document.getElementById('noc-unit-selected');
  const si = document.getElementById('noc-unit-search');
  if (rs) { rs.innerHTML = ''; rs.style.display = 'none'; }

  const u = (_unitsCache || []).find(x => x.id === unitId);
  const gdbU = gdb()?.units?.[S.cid]?.[unitId] || {};

  _nocSelUnit = {
    id:          unitId,
    unitNo:      u?.unitNo      || unitId,
    projectName: u?.projectName || gdbU.projectName || '',
    clientName:  u?.customerName || gdbU.customerName || '',
    clientPhone: u?.phone        || gdbU.phone        || '',
    saleId:      gdbU.saleId    || u?.saleId          || '',
    clientId:    gdbU.clientId  || u?.clientId        || '',
  };

  if (si) si.value = _nocSelUnit.unitNo;
  if (sd) {
    sd.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">
        <div style="flex:1">
          <div style="font-weight:700;color:var(--t1)">${esc(_nocSelUnit.unitNo)}</div>
          <div style="font-size:12px;color:var(--t3)">${esc(_nocSelUnit.clientName)}${_nocSelUnit.projectName?` · ${esc(_nocSelUnit.projectName)}`:''}</div>
        </div>
        <button style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:18px" onclick="_nocClearUnit()">✕</button>
      </div>`;
    sd.style.display = 'block';
  }
  _nocEligCheck();
}

function _nocClearUnit() {
  _nocSelUnit = null;
  const si = document.getElementById('noc-unit-search');
  const sd = document.getElementById('noc-unit-selected');
  const eb = document.getElementById('noc-elig-banner');
  if (si) si.value = '';
  if (sd) sd.style.display = 'none';
  if (eb) eb.style.display = 'none';
}

async function _nocEligCheck() {
  const eb = document.getElementById('noc-elig-banner');
  if (!eb || !_nocSelUnit) return;
  eb.style.display = 'none';
  try {
    const nocType = document.getElementById('noc-type-sel')?.value || 'general';
    const { data } = await supabase.rpc('check_noc_eligibility', {
      p_unit_id: _nocSelUnit.id, p_company_id: S.cid,
      p_noc_type: nocType, p_threshold: 80
    });
    if (!data?.success || !data?.has_sale) {
      eb.style.background = 'rgba(245,158,11,.1)'; eb.style.color = '#d97706';
      eb.textContent = '⚠ No active sale found for this unit.';
      eb.style.display = 'block'; return;
    }
    const pct = Number(data.pct_paid || 0);
    if (data.active_noc_exists) {
      eb.style.background = 'rgba(99,102,241,.1)'; eb.style.color = '#6366f1';
      eb.textContent = `ℹ An active ${document.getElementById('noc-type-sel')?.options[document.getElementById('noc-type-sel')?.selectedIndex]?.text || ''} already exists for this unit.`;
    } else if (data.eligible) {
      eb.style.background = 'rgba(22,163,74,.1)'; eb.style.color = '#16a34a';
      eb.textContent = `✓ Eligible — ${pct}% paid (PKR ${fM(data.total_paid)} of ${fM(data.total_due)}). Meets 80% threshold.`;
    } else {
      eb.style.background = 'rgba(245,158,11,.1)'; eb.style.color = '#d97706';
      eb.textContent = `⚠ Only ${pct}% paid (PKR ${fM(data.total_paid)} of ${fM(data.total_due)}). Below 80% threshold — obtain approval before issuing.`;
    }
    eb.style.display = 'block';
  } catch(e) { /* non-blocking */ }
}

async function _nocSubmitCreate() {
  if (!_nocSelUnit) { toast('Select a unit first', 'err'); return; }
  const nocType = document.getElementById('noc-type-sel')?.value;
  if (!nocType) { toast('Select NOC type', 'err'); return; }
  const btn = document.getElementById('noc-create-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    const { data, error } = await supabase.rpc('create_noc_request', {
      p_company_id: S.cid,
      p_data: {
        unit_id:           _nocSelUnit.id,
        sale_id:           _nocSelUnit.saleId   || '',
        client_id:         _nocSelUnit.clientId || '',
        client_name:       _nocSelUnit.clientName,
        client_phone:      _nocSelUnit.clientPhone,
        project_name:      _nocSelUnit.projectName,
        unit_no:           _nocSelUnit.unitNo,
        noc_type:          nocType,
        purpose:           document.getElementById('noc-purpose')?.value?.trim() || '',
        payment_threshold: 80,
        requested_by:      S.name || S.userId || '',
        valid_from:        document.getElementById('noc-valid-from')?.value  || '',
        valid_until:       document.getElementById('noc-valid-until')?.value || '',
        notes:             document.getElementById('noc-notes')?.value?.trim() || '',
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast(`NOC request created: ${data.noc_number}`, 'ok');
    cm('m-noc-create');
    await _nocRefresh();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Request'; }
  }
}

// ── Mark Under Review ─────────────────────────────────────────────

async function _nocMarkReview(id) {
  try {
    const { data, error } = await supabase.rpc('update_noc_status', {
      p_id: id, p_company_id: S.cid, p_status: 'under_review',
      p_data: { reviewed_by: S.name || S.userId || '' }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('NOC marked as Under Review', 'ok');
    await _nocRefresh();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

// ── Approve ───────────────────────────────────────────────────────

function _nocOpenApprove(id) {
  document.getElementById('noc-approve-id').value = id;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('noc-app-from').value = today;
  document.getElementById('noc-app-until').value = '';
  document.getElementById('noc-app-by').value = S.name || '';
  om('m-noc-approve');
}

async function _nocSubmitApprove() {
  const id = document.getElementById('noc-approve-id')?.value;
  if (!id) return;
  const btn = document.getElementById('noc-approve-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
  try {
    const { data, error } = await supabase.rpc('update_noc_status', {
      p_id: id, p_company_id: S.cid, p_status: 'approved',
      p_data: {
        approved_by: document.getElementById('noc-app-by')?.value?.trim() || S.name || '',
        valid_from:  document.getElementById('noc-app-from')?.value  || '',
        valid_until: document.getElementById('noc-app-until')?.value || '',
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('NOC approved successfully', 'ok');
    cm('m-noc-approve');
    await _nocRefresh();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Approve NOC'; }
  }
}

// ── Reject ────────────────────────────────────────────────────────

function _nocOpenReject(id) {
  document.getElementById('noc-reject-id').value = id;
  document.getElementById('noc-reject-reason').value = '';
  document.getElementById('noc-reject-by').value = S.name || '';
  om('m-noc-reject');
}

async function _nocSubmitReject() {
  const id     = document.getElementById('noc-reject-id')?.value;
  const reason = document.getElementById('noc-reject-reason')?.value?.trim();
  if (!id) return;
  if (!reason) { toast('Rejection reason is required', 'err'); return; }
  const btn = document.getElementById('noc-reject-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Rejecting…'; }
  try {
    const { data, error } = await supabase.rpc('update_noc_status', {
      p_id: id, p_company_id: S.cid, p_status: 'rejected',
      p_data: {
        reviewed_by:      document.getElementById('noc-reject-by')?.value?.trim() || S.name || '',
        rejection_reason: reason,
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('NOC rejected', 'ok');
    cm('m-noc-reject');
    await _nocRefresh();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Reject NOC'; }
  }
}

// ── Revoke ────────────────────────────────────────────────────────

function _nocOpenRevoke(id) {
  document.getElementById('noc-revoke-id').value = id;
  document.getElementById('noc-revoke-reason').value = '';
  document.getElementById('noc-revoke-by').value = S.name || '';
  om('m-noc-revoke');
}

async function _nocSubmitRevoke() {
  const id     = document.getElementById('noc-revoke-id')?.value;
  const reason = document.getElementById('noc-revoke-reason')?.value?.trim();
  if (!id) return;
  if (!reason) { toast('Revocation reason is required', 'err'); return; }
  const btn = document.getElementById('noc-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking…'; }
  try {
    const { data, error } = await supabase.rpc('update_noc_status', {
      p_id: id, p_company_id: S.cid, p_status: 'revoked',
      p_data: {
        revoked_by:        document.getElementById('noc-revoke-by')?.value?.trim() || S.name || '',
        revocation_reason: reason,
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('NOC revoked', 'ok');
    cm('m-noc-revoke');
    await _nocRefresh();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke NOC'; }
  }
}

// ── Delete ────────────────────────────────────────────────────────

async function _nocDelete(id) {
  if (!confirm('Delete this NOC request? This cannot be undone.')) return;
  try {
    const { data, error } = await supabase.rpc('delete_noc', { p_id: id, p_company_id: S.cid });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Cannot delete');
    toast('NOC deleted', 'ok');
    await _nocRefresh();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

// ── Print NOC Document ────────────────────────────────────────────

// Open the Crystal-style A4 NOC certificate (reports/noc-certificate.html) in a new tab.
// The template fetches get_noc_by_id + get_client_by_id (for CNIC) + get_company_branding itself.
function _nocPrint(id) {
  if (!id || !S || !S.cid) { toast('Missing NOC or company id', 'err'); return; }
  window.open(
    'reports/noc-certificate.html?noc_id=' + encodeURIComponent(id) + '&company_id=' + encodeURIComponent(S.cid),
    '_blank'
  );
}
