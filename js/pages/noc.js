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

function _nocBadge(status) {
  const m = NOC_STATUS_META[status] || { label: status, color: '#6b7280', bg: '#f3f4f6' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:${m.bg};color:${m.color};border:1px solid ${m.color}33;white-space:nowrap">${m.label}</span>`;
}

function _nocTypeBadge(type) {
  const m = NOC_TYPE_META[type] || { label: type, icon: '📄' };
  return `<span style="font-size:11px;color:var(--t2)">${m.icon} ${m.label}</span>`;
}

// ── Entry point ───────────────────────────────────────────────────

async function rNOC() {
  const pg = document.getElementById('pg-noc');
  if (!pg) return;

  pg.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>NOC Management</h2>
        <p>Issue and manage No-Objection Certificates — bank, transfer, and general.</p>
      </div>
      <div class="ph-r" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm" onclick="_nocOpenCreate()">+ New NOC Request</button>
        <button class="btn btn-gh btn-sm" onclick="_nocRefresh()">↺ Refresh</button>
      </div>
    </div>

    <div id="noc-kpi-strip" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px"></div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${['all','pending','under_review','approved','rejected','revoked'].map(f => {
          const lbl = f === 'all' ? 'All' : (NOC_STATUS_META[f]?.label || f);
          const active = _nocFilter === f;
          return `<button class="btn btn-xs" style="padding:4px 12px;border-radius:20px;border:1px solid ${active?'var(--brand)':'var(--line)'};background:${active?'var(--brand)':'transparent'};color:${active?'#fff':'var(--t2)'};font-weight:700;cursor:pointer" onclick="_nocSetFilter('${f}')">${lbl}</button>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap">
        <select class="inp" style="width:140px;font-size:12px;padding:5px 8px" onchange="_nocSetType(this.value)">
          <option value="">All Types</option>
          <option value="bank" ${_nocTypeFilter==='bank'?'selected':''}>Bank NOC</option>
          <option value="transfer" ${_nocTypeFilter==='transfer'?'selected':''}>Transfer NOC</option>
          <option value="general" ${_nocTypeFilter==='general'?'selected':''}>General NOC</option>
        </select>
        <input class="inp" type="search" placeholder="Search client / unit / NOC#…" value="${esc(_nocSearch)}"
          style="width:220px;font-size:12px;padding:5px 10px" oninput="_nocSetSearch(this.value)">
      </div>
    </div>

    <div id="noc-list-body"><div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading…</div></div>
  </div>`;

  _nocInjectModals(pg);
  await _nocRefresh();
}

async function _nocRefresh() {
  await Promise.all([_nocLoadAnalytics(), _nocLoad()]);
}

function _nocSetFilter(f) { _nocFilter = f; rNOC(); }
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
      { label: 'Total NOCs',    val: a.total        || 0, color: 'var(--brand)' },
      { label: 'Pending',       val: a.pending       || 0, color: '#f59e0b' },
      { label: 'Approved',      val: a.approved      || 0, color: '#16a34a' },
      { label: 'This Month',    val: a.this_month    || 0, color: '#6366f1' },
      { label: 'Expiring Soon', val: a.expiring_soon || 0, color: '#ef4444', sub: '(30 days)' },
      { label: 'Revoked',       val: a.revoked       || 0, color: '#9ca3af' },
    ];
    strip.innerHTML = kpis.map(k => `
      <div class="card" style="padding:14px 16px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:${k.color};line-height:1.1">${k.val}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:3px">${k.label}${k.sub?`<br><span style="font-size:10px">${k.sub}</span>`:''}</div>
      </div>`).join('');
  } catch(e) { /* non-blocking */ }
}

// ── List ──────────────────────────────────────────────────────────

async function _nocLoad() {
  const body = document.getElementById('noc-list-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)">⏳ Loading NOCs…</div>';
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
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="et">Could not load NOCs</div>
      <div class="es">${esc(e.message||'Error')}</div>
    </div></div>`;
  }
}

function _nocRenderList() {
  const body = document.getElementById('noc-list-body');
  if (!body) return;

  if (!_nocList.length) {
    body.innerHTML = `<div class="card"><div class="empty">
      <div class="ei"><svg width="40" height="40" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
      <div class="et">No NOCs found</div>
      <div class="es">Create the first NOC request using the button above.</div>
    </div></div>`;
    return;
  }

  const canAdmin = ['admin','owner','manager'].includes(S.role);

  body.innerHTML = `<div class="card" style="overflow:hidden">
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid var(--line)">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);white-space:nowrap">NOC #</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3)">Type</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3)">Client / Unit</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3)">Status</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);white-space:nowrap">Requested</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);white-space:nowrap">Valid Until</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3)">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${_nocList.map(n => {
            const sm = NOC_STATUS_META[n.status] || {};
            const isExpired = n.valid_until && new Date(n.valid_until) < new Date();
            const validUntilTxt = n.valid_until
              ? (isExpired ? `<span style="color:#dc2626">${fD(n.valid_until)} (expired)</span>` : fD(n.valid_until))
              : '—';

            const canReview  = canAdmin && (n.status === 'pending');
            const canApprove = canAdmin && (n.status === 'pending' || n.status === 'under_review');
            const canReject  = canAdmin && (n.status === 'pending' || n.status === 'under_review');
            const canRevoke  = canAdmin && n.status === 'approved';
            const canDel     = canAdmin && (n.status === 'pending' || n.status === 'rejected');
            const canPrint   = n.status === 'approved';

            return `<tr style="border-bottom:1px solid var(--hover);transition:background .15s" onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''">
              <td style="padding:10px 12px;font-weight:700;color:var(--brand);white-space:nowrap">${esc(n.noc_number||'—')}</td>
              <td style="padding:10px 12px">${_nocTypeBadge(n.noc_type)}</td>
              <td style="padding:10px 12px">
                <div style="font-weight:600;color:var(--t1)">${esc(n.client_name||'—')}</div>
                <div style="font-size:11px;color:var(--t3)">${esc(n.unit_no||'')}${n.project_name?` · ${esc(n.project_name)}`:''}</div>
              </td>
              <td style="padding:10px 12px">${_nocBadge(n.status)}</td>
              <td style="padding:10px 12px;color:var(--t2);white-space:nowrap;font-size:12px">${n.requested_at?fD(n.requested_at):'—'}</td>
              <td style="padding:10px 12px;font-size:12px">${validUntilTxt}</td>
              <td style="padding:10px 12px;text-align:right;white-space:nowrap">
                <div style="display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
                  ${canReview  ? `<button class="btn btn-xs btn-gh" onclick="_nocMarkReview('${n.id}')">Review</button>` : ''}
                  ${canApprove ? `<button class="btn btn-xs btn-g"  onclick="_nocOpenApprove('${n.id}')">Approve</button>` : ''}
                  ${canReject  ? `<button class="btn btn-xs" style="background:rgba(220,38,38,.1);color:#dc2626;border:1px solid rgba(220,38,38,.2)" onclick="_nocOpenReject('${n.id}')">Reject</button>` : ''}
                  ${canRevoke  ? `<button class="btn btn-xs btn-gh" onclick="_nocOpenRevoke('${n.id}')">Revoke</button>` : ''}
                  ${canPrint   ? `<button class="btn btn-xs btn-gh" onclick="_nocPrint('${n.id}')">Print</button>` : ''}
                  ${canDel     ? `<button class="btn btn-xs btn-gh" style="color:#dc2626" onclick="_nocDelete('${n.id}')">Del</button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
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
  const hits = (_unitsCache || [])
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

async function _nocPrint(id) {
  try {
    const { data: n } = await supabase.rpc('get_noc_by_id', { p_id: id, p_company_id: S.cid });
    if (!n) { toast('NOC not found', 'err'); return; }

    const typeMeta = NOC_TYPE_META[n.noc_type] || { label: n.noc_type, icon: '📄' };
    const validLine = n.valid_from
      ? `Valid from <strong>${fD(n.valid_from)}</strong>${n.valid_until ? ` to <strong>${fD(n.valid_until)}</strong>` : ' (no expiry)'}`
      : 'Validity period not specified';

    const html = `<!DOCTYPE html><html><head><title>NOC — ${n.noc_number}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;color:#111;padding:50px;font-size:13px;max-width:760px;margin:0 auto}
      .header{text-align:center;margin-bottom:30px;border-bottom:3px solid #6C63FF;padding-bottom:20px}
      h1{font-size:20px;font-weight:800;letter-spacing:1px;margin-bottom:4px}
      h2{font-size:13px;font-weight:600;color:#6C63FF;letter-spacing:2px}
      .noc-title{font-size:18px;font-weight:800;text-align:center;margin:24px 0 8px;letter-spacing:1px;text-transform:uppercase}
      .noc-sub{text-align:center;font-size:12px;color:#6b7280;margin-bottom:24px}
      .noc-badge{display:inline-block;padding:4px 14px;background:#e7e5ff;color:#6C63FF;border-radius:20px;font-weight:800;font-size:11px;letter-spacing:1px;margin:0 auto 20px;display:block;width:fit-content;margin:0 auto 20px}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
      .meta-item{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}
      .meta-item label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:3px}
      .body-text{line-height:1.8;color:#374151;margin:20px 0;font-size:13px}
      .valid-box{background:#ecfdf5;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin:16px 0;color:#16a34a;font-size:13px}
      .sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:50px}
      .sig-box{border-top:2px solid #374151;padding-top:10px;text-align:center;font-size:11px;color:#374151}
      .footer{text-align:center;margin-top:30px;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:14px}
      @media print{body{padding:30px}}
    </style></head><body>
    <div class="header">
      <h1>${esc(S.companyName || 'Company Name')}</h1>
      <h2>NO-OBJECTION CERTIFICATE</h2>
    </div>

    <p class="noc-badge">REF: ${esc(n.noc_number)}</p>

    <p class="noc-title">${typeMeta.icon} ${typeMeta.label}</p>
    <p class="noc-sub">This certificate is issued as a formal No-Objection Certificate by the company.</p>

    <div class="meta">
      <div class="meta-item"><label>Client / Buyer</label><strong>${esc(n.client_name||'—')}</strong></div>
      <div class="meta-item"><label>Contact</label><strong>${esc(n.client_phone||'—')}</strong></div>
      <div class="meta-item"><label>Unit No.</label><strong>${esc(n.unit_no||'—')}</strong></div>
      <div class="meta-item"><label>Project</label><strong>${esc(n.project_name||'—')}</strong></div>
      <div class="meta-item"><label>NOC Type</label><strong>${typeMeta.label}</strong></div>
      <div class="meta-item"><label>Issue Date</label><strong>${n.approved_at ? fD(n.approved_at) : fD(new Date().toISOString())}</strong></div>
    </div>

    <p class="body-text">
      To Whom It May Concern,<br><br>
      This is to certify that <strong>${esc(n.client_name||'the above-named buyer')}</strong> is the registered
      owner/buyer of Unit <strong>${esc(n.unit_no||'—')}</strong> in <strong>${esc(n.project_name||'our project')}</strong>.
      ${n.purpose ? `This NOC is issued for the purpose of: <em>${esc(n.purpose)}</em>.` : ''}
      <br><br>
      <strong>${esc(S.companyName||'The company')}</strong> has no objection to the above-mentioned client
      exercising their rights with respect to the said unit for the purpose stated herein,
      subject to all applicable terms and conditions of the sale agreement.
    </p>

    <div class="valid-box">✓ ${validLine}</div>

    ${n.notes ? `<p style="font-size:12px;color:#6b7280;margin:12px 0"><strong>Notes:</strong> ${esc(n.notes)}</p>` : ''}

    <div class="sig">
      <div class="sig-box">
        <p style="margin-bottom:40px"></p>
        <strong>${esc(n.approved_by||'Authorised Signatory')}</strong><br>Authorised Signatory
      </div>
      <div class="sig-box">
        <p style="margin-bottom:40px"></p>
        <strong>Company Stamp</strong><br>Official Seal
      </div>
      <div class="sig-box">
        <p style="margin-bottom:40px"></p>
        <strong>${esc(n.client_name||'Client')}</strong><br>Client Acknowledgement
      </div>
    </div>

    <div class="footer">
      NOC Ref: ${esc(n.noc_number)} · Issued by Nexunova RMS · ${new Date().toLocaleDateString()}<br>
      This document is computer-generated and is valid without physical signature unless stated otherwise.
    </div>
    </body></html>`;

    _printHTML(html, `NOC-${n.noc_number}`);
  } catch(e) { toast('Could not load NOC for printing', 'err'); }
}
