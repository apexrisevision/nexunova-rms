// ══ APPROVAL CONTROL CENTER v1 (Admin maker-checker) ════════════════════════
// Tabs: Inbox · History  (Rules tab deferred to Phase 2 — needs reader RPC)
// Decision Drawer (right side, 440px) replaces the old centered modal.
// Risk + SLA computed client-side from get_pending_approvals row fields only.
// Maker / Project / Client chips resolve via existing caches loaded at login:
//   window._appUsersCache · window._projectsCache · window._clientsCache · window._unitsCache
// RPCs used (unchanged, zero new): get_pending_approvals, get_approval_history,
//   approve_request, reject_request, cancel_approval_request.
// Public surface preserved: rApprovals(), refreshApprovalsBadge().
// ═════════════════════════════════════════════════════════════════════════════

// ─── State ──────────────────────────────────────────────────────────────────
let _apTab            = 'inbox';                  // 'inbox' | 'history'
let _apPending        = [];                       // rows from get_pending_approvals
let _apHistory        = [];                       // rows from get_approval_history
let _apFilter         = { risk:'all', type:'all', maker:'all', project:'all', sla:'all', search:'' };
let _apDrawerRequest  = null;                     // full request loaded into drawer
let _apDrawerComments = [];                       // comments thread for drawer
let _apDrawerLoading  = false;                    // drawer detail in-flight
let _apEscBound       = false;                    // Esc-key listener bound once

const _AP_HIGH_RISK_AMOUNT = 1000000;             // PKR 10 lakh — default per spec
const _AP_SLA_HOURS        = { high: 4, medium: 24, low: 72 };

// Restore persisted filter state (per admin browser)
try {
  const _saved = JSON.parse(localStorage.getItem('ap.filters') || '{}');
  Object.assign(_apFilter, _saved || {});
} catch(_) {}

// ─── Type metadata: color, label, and which restriction_rules action it gates ─
const _AP_TYPE = {
  discount:         { c:'#6366f1', lb:'Discount',         action:'discount'        },
  price_revision:   { c:'#8b5cf6', lb:'Price Revision',   action:'price_revision'  },
  cancellation:     { c:'#ef4444', lb:'Cancellation',     action:'cancellation'    },
  transfer:         { c:'#f59e0b', lb:'Transfer',         action:'transfer'        },
  refund:           { c:'#0ea5e9', lb:'Refund',           action:'refund'          },
  dnd:              { c:'#64748b', lb:'DND',              action:'dnd'             },
  blacklist:        { c:'#dc2626', lb:'Blacklist',        action:'blacklist'       },
  payment_void:     { c:'#7c3aed', lb:'Payment Void',     action:'payment_void'    },
  payment_backdate: { c:'#a855f7', lb:'Payment Backdate', action:'backdate'        },
  schedule_change:  { c:'#0ea5e9', lb:'Schedule Change',  action:'schedule_change' },
  client_status:    { c:'#06b6d4', lb:'Client Status',    action:'client_status'   },
  legal_delete:     { c:'#dc2626', lb:'Legal Delete',     action:'legal_delete'    },
  sale_edit:        { c:'#f59e0b', lb:'Sale Edit',        action:'sale_edit'       },
};

// Default restriction levels (since we don't have a reader RPC for company_restriction_rules
// per the v1 scope rule). All seeded as 'soft' per migrations — see Phase 2 for editor.
const _AP_DEFAULT_LEVELS = {
  discount:'soft', price_revision:'soft', cancellation:'soft', transfer:'soft',
  refund:'soft', dnd:'soft', blacklist:'soft', payment_void:'soft',
  backdate:'soft', schedule_change:'soft', client_status:'soft',
  legal_delete:'soft', sale_edit:'soft',
};

// Risk pill colors (HIGH / MEDIUM / LOW)
const _AP_RISK_META = {
  high:   { c:'#ef4444', lb:'HIGH'   },
  medium: { c:'#f59e0b', lb:'MEDIUM' },
  low:    { c:'#3b82f6', lb:'LOW'    },
};

// SLA status colors
const _AP_SLA_META = {
  on_track: { c:'#22c55e', lb:'On track' },
  at_risk:  { c:'#f59e0b', lb:'At risk'  },
  breached: { c:'#ef4444', lb:'Breached' },
};

// ─── Pure helpers ───────────────────────────────────────────────────────────
function _apTypeBadge(t) {
  const m = _AP_TYPE[t] || { c:'#94a3b8', lb: t || '—' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:${m.c}1a;color:${m.c};border:1px solid ${m.c}40;text-transform:uppercase;letter-spacing:.4px">${esc(m.lb)}</span>`;
}

function _apRiskPill(risk) {
  const m = _AP_RISK_META[risk] || _AP_RISK_META.low;
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;background:${m.c}1a;color:${m.c};border:1px solid ${m.c}40;text-transform:uppercase;letter-spacing:.5px"><span style="width:6px;height:6px;border-radius:50%;background:${m.c}"></span>${m.lb}</span>`;
}

function _apSlaBadge(sla) {
  const m = _AP_SLA_META[sla.status] || _AP_SLA_META.on_track;
  const icon = sla.status === 'breached' ? '⚠ ' : '';
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${m.c}1a;color:${m.c};white-space:nowrap" title="Target: ${m.lb} within ${_AP_SLA_HOURS[sla.risk]}h">${icon}${m.lb}</span>`;
}

function _apStatusBadge(s) {
  const map = {
    approved:  ['#22c55e','Approved'],
    rejected:  ['#ef4444','Rejected'],
    pending:   ['#f59e0b','Pending'],
    cancelled: ['#94a3b8','Cancelled'],
  };
  const [c, l] = map[s] || ['#94a3b8', s || '—'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${c}22;color:${c}">${esc(l)}</span>`;
}

function _apRelTime(ts) {
  if (!ts) return '—';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (isNaN(diff)) return '—';
    const m = Math.floor(diff/60000), h = Math.floor(diff/3600000), d = Math.floor(diff/86400000);
    if (diff < 60000) return 'just now';
    if (m < 60) return m + 'm ago';
    if (h < 24) return h + 'h ago';
    if (d < 30) return d + 'd ago';
    return fD(String(ts).slice(0,10));
  } catch { return '—'; }
}

function _apAging(ts) {
  if (!ts) return '—';
  const ageMs = Date.now() - new Date(ts).getTime();
  if (isNaN(ageMs) || ageMs < 0) return '—';
  const h = Math.floor(ageMs / 3600000);
  const d = Math.floor(h / 24);
  const remH = h % 24;
  if (d > 0) return `${d}d ${remH}h`;
  if (h > 0) return `${h}h`;
  const m = Math.floor(ageMs / 60000);
  return `${m}m`;
}

// Risk computation — uses only fields present in get_pending_approvals row shape.
function _apRisk(row) {
  const t   = row.request_type;
  const amt = Number(row.amount || 0);
  const age = Date.now() - new Date(row.requested_at || 0).getTime();
  const ageH = age / 3600000;

  const HIGH_TYPES = ['cancellation','refund','transfer','blacklist','payment_void','payment_backdate','legal_delete'];
  const MED_TYPES  = ['price_revision','schedule_change','sale_edit','client_status'];

  if (HIGH_TYPES.indexOf(t) >= 0 || amt > _AP_HIGH_RISK_AMOUNT || ageH > 48) return 'high';
  if (MED_TYPES.indexOf(t)  >= 0 || ageH > 24) return 'medium';
  return 'low';
}

function _apSLA(row) {
  const risk = _apRisk(row);
  const targetH = _AP_SLA_HOURS[risk];
  const ageH = (Date.now() - new Date(row.requested_at || 0).getTime()) / 3600000;
  let status;
  if (ageH < targetH * 0.75) status = 'on_track';
  else if (ageH <= targetH)  status = 'at_risk';
  else                       status = 'breached';
  return { risk, status, targetH, ageH };
}

// ─── Cache lookups (never throws; falls back to '—' when missing) ────────────
function _apProjectName(project_id) {
  if (!project_id) return null;
  const cache = (window._projectsCache || []);
  const p = cache.find(x => x.id === project_id);
  return p ? (p.projectName || p.name || null) : null;
}

function _apMakerInfo(row) {
  const name = row.requested_by_name || null;
  const id   = row.requested_by || null;
  const u    = (window._appUsersCache || []).find(x => x.id === id);
  const role = u ? (u.role || '') : '';
  return { id, name, role };
}

// Best-effort client resolution from entity_table/entity_id. Returns null when
// not directly knowable (e.g., payment-keyed requests need a detail fetch).
function _apClientInfo(row) {
  const tbl = (row.entity_table || '').toLowerCase();
  const id  = row.entity_id;
  if (!id) return null;
  if (tbl === 'clients') {
    const c = (window._clientsCache || []).find(x => x.id === id);
    return c ? { id: c.id, name: c.fullName || c.full_name || c.name } : { id, name: null };
  }
  if (tbl === 'units') {
    const u = (window._unitsCache || []).find(x => x.id === id);
    return u ? { id: u.clientId || null, name: u.customerName || null } : null;
  }
  if (tbl === 'sales') {
    // Sales -> client via units cache (each sold unit carries customerName)
    const u = (window._unitsCache || []).find(x => x.saleId === id || x.sale_id === id);
    return u ? { id: u.clientId || null, name: u.customerName || null } : null;
  }
  return null;
}

function _apEntityRef(row) {
  if (!row.entity_table) return '—';
  const short = row.entity_id ? String(row.entity_id).slice(0, 8) : '';
  return `<span style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(row.entity_table)}${short ? ' · ' + short : ''}</span>`;
}

// Chip renderers used in rows + drawer
function _apMakerChip(row) {
  const m = _apMakerInfo(row);
  if (!m.name) return `<span style="font-size:11px;color:var(--t3)">Maker: —</span>`;
  const roleSfx = m.role ? ` <span style="color:var(--t3);font-weight:500"> · ${esc(m.role)}</span>` : '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);font-weight:600">👤 ${esc(m.name)}${roleSfx}</span>`;
}

function _apProjectChip(row) {
  const name = _apProjectName(row.project_id);
  if (!name) return '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);font-weight:600">🏢 ${esc(name)}</span>`;
}

function _apClientChip(row) {
  const c = _apClientInfo(row);
  if (!c || !c.name) return '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);font-weight:600">👥 ${esc(c.name)}</span>`;
}

// Restriction rule (default level only — no reader RPC in v1)
function _apRestrictionInfo(request_type) {
  const meta = _AP_TYPE[request_type];
  const action = meta ? meta.action : request_type;
  const level  = _AP_DEFAULT_LEVELS[action] || 'soft';
  return { action, level };
}

// Risk callouts — deterministic per request type, derived only from payload.
function _apRiskCallouts(req) {
  const t = req.request_type;
  const p = req.payload || {};
  const lines = [];
  switch (t) {
    case 'discount':
      lines.push(`New discount amount: PKR ${fM(Number(p.discount_amount || 0))}`);
      break;
    case 'price_revision':
      lines.push(`Sale net_amount becomes: PKR ${fM(Number(p.net_amount || 0))}`);
      break;
    case 'cancellation':
      if (p.net_refund) lines.push(`Refund payable: PKR ${fM(Number(p.net_refund))}`);
      if (p.cancellation_charges) lines.push(`Cancellation charges: PKR ${fM(Number(p.cancellation_charges))}`);
      if (p.agent_commission_pending) lines.push(`Agent commission clawback: PKR ${fM(Number(p.agent_commission_pending))}`);
      lines.push('Unit returns to Available pool.');
      if (p.client_flag && p.client_flag !== 'none') lines.push(`Client will be flagged: ${esc(p.client_flag)}`);
      break;
    case 'transfer':
      lines.push(`Unit transferred to new client · Transfer fee: PKR ${fM(Number(p.transfer_fee || 0))}`);
      if (p.documentation_charges) lines.push(`Documentation charges: PKR ${fM(Number(p.documentation_charges))}`);
      break;
    case 'refund':
      lines.push('Payment status becomes "refunded"');
      if (p.refund_amount) lines.push(`Refund amount: PKR ${fM(Number(p.refund_amount))}`);
      break;
    case 'dnd':
      lines.push('Client will be flagged DND — comms suppressed until cleared.');
      break;
    case 'blacklist':
      lines.push('Client will be flagged blacklisted — future sales blocked.');
      break;
    case 'payment_void':
      lines.push('Payment status becomes "cancelled"');
      lines.push('Installment amount_paid will be restored');
      if (p.reason) lines.push(`Reason: ${esc(p.reason)}`);
      break;
    case 'payment_backdate':
      if (p.payment_date) lines.push(`Payment date will be set to: ${esc(p.payment_date)}`);
      break;
    case 'schedule_change': {
      const sched = Array.isArray(p.schedule) ? p.schedule : [];
      const d = sched.filter(r => r._deleted).length;
      const n = sched.filter(r => r._new).length;
      const u = sched.filter(r => !r._deleted && !r._new && r.id).length;
      lines.push(`Schedule rows: ${n} new · ${u} updated · ${d} deleted`);
      break;
    }
    case 'client_status':
      lines.push(`Client status will become: ${esc(p.status || '—')}`);
      break;
    case 'legal_delete':
      lines.push('Legal case record will be deleted permanently.');
      break;
    case 'sale_edit': {
      const fields = p.fields || {};
      const keys = Object.keys(fields);
      if (keys.length) lines.push(`Protected fields to be updated: ${keys.join(', ')}`);
      keys.forEach(k => { lines.push(`  ${k} → ${esc(String(fields[k]))}`); });
      break;
    }
    default:
      break;
  }
  return lines;
}

function _apMakerCommentPreview(row) {
  // The row from get_pending_approvals doesn't carry comments — that's only in
  // the detail call. For Inbox preview we leave this empty (drawer shows full
  // thread). Function kept for future enhancement.
  return null;
}

// ─── Entry point (PRESERVED PUBLIC NAME) ─────────────────────────────────────
async function rApprovals() {
  const el = document.getElementById('pg-approvals');
  if (!el) return;

  // Role guard — Admin / Owner only (existing behavior preserved)
  if (!S || (S.role !== 'owner' && S.role !== 'admin')) {
    if (typeof nav === 'function') nav('dashboard');
    return;
  }

  el.innerHTML = `<div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Approval Control Center</h2>
        <p>Maker-checker requests — review, decide with a comment, full trail kept.</p>
      </div>
    </div>

    <!-- SLA dashboard band -->
    <div id="ap-sla-band" style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin:6px 0 14px;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:10px"></div>

    <!-- Tabs -->
    <div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--line)">
      <button id="ap-tab-inbox"   class="ap-tab" onclick="_apSetTab('inbox')"
        style="background:none;border:none;border-bottom:2px solid transparent;padding:9px 14px;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;font-family:inherit">Inbox</button>
      <button id="ap-tab-history" class="ap-tab" onclick="_apSetTab('history')"
        style="background:none;border:none;border-bottom:2px solid transparent;padding:9px 14px;font-size:13px;font-weight:600;color:var(--t3);cursor:pointer;font-family:inherit">History</button>
    </div>

    <div id="ap-body"></div>
  </div>`;

  _apEnsureDrawer();
  _apBindEscOnce();
  _apSetTab(_apTab);
}

function _apSetTab(t) {
  _apTab = t;
  ['inbox','history'].forEach(k => {
    const b = document.getElementById('ap-tab-' + k);
    if (!b) return;
    const on = k === t;
    b.style.color        = on ? 'var(--brand)' : 'var(--t3)';
    b.style.borderBottom = on ? '2px solid var(--brand)' : '2px solid transparent';
  });
  if (t === 'inbox') _apLoadInbox(); else _apLoadHistory();
}

function _apBindEscOnce() {
  if (_apEscBound) return;
  _apEscBound = true;
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const d = document.getElementById('ap-drawer');
      if (d && d.classList.contains('open')) { e.stopPropagation(); _apCloseDrawer(); }
    }
  });
}

// ─── SLA dashboard band ──────────────────────────────────────────────────────
function _apRenderSlaBand() {
  const band = document.getElementById('ap-sla-band');
  if (!band) return;

  const enriched = _apPending.map(r => ({ row: r, sla: _apSLA(r) }));
  const total    = enriched.length;
  const h = enriched.filter(x => x.sla.risk === 'high').length;
  const m = enriched.filter(x => x.sla.risk === 'medium').length;
  const l = enriched.filter(x => x.sla.risk === 'low').length;
  const onTrack = enriched.filter(x => x.sla.status === 'on_track').length;
  const atRisk  = enriched.filter(x => x.sla.status === 'at_risk').length;
  const breach  = enriched.filter(x => x.sla.status === 'breached').length;

  const oldestRow = enriched
    .slice()
    .sort((a,b) => new Date(a.row.requested_at || 0) - new Date(b.row.requested_at || 0))[0];
  const oldestLbl = oldestRow ? _apAging(oldestRow.row.requested_at) : '—';

  // Avg decision time (period = last 30 days; from history if loaded, else '—')
  let avgLbl = '—';
  if (Array.isArray(_apHistory) && _apHistory.length) {
    const decided = _apHistory.filter(r => r.decided_at && r.requested_at);
    if (decided.length) {
      const totalMs = decided.reduce((s,r) => s + (new Date(r.decided_at) - new Date(r.requested_at)), 0);
      const avgH = (totalMs / decided.length) / 3600000;
      avgLbl = avgH < 1 ? Math.round(avgH * 60) + 'm' : (avgH < 24 ? avgH.toFixed(1) + 'h' : (avgH/24).toFixed(1) + 'd');
    }
  }

  const tier = (lvl, n) => {
    const meta = _AP_RISK_META[lvl];
    return `<button onclick="_apFilterRisk('${lvl}')" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;background:${meta.c}1a;color:${meta.c};border:1px solid ${meta.c}40;cursor:pointer">
      <span style="width:6px;height:6px;border-radius:50%;background:${meta.c}"></span>${meta.lb} ${n}
    </button>`;
  };

  const sla = (status, n) => {
    const meta = _AP_SLA_META[status];
    const danger = status === 'breached';
    return `<span style="font-size:11px;font-weight:600;color:${danger?meta.c:'var(--t2)'}">${danger?'⚠ ':''}${meta.lb} <b style="color:${meta.c}">${n}</b></span>`;
  };

  band.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      ${tier('high', h)} ${tier('medium', m)} ${tier('low', l)}
      <span style="font-size:11px;color:var(--t3);margin-left:6px">${total} pending</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:flex-end">
      ${sla('on_track', onTrack)} <span style="color:var(--line)">·</span>
      ${sla('at_risk',  atRisk)}  <span style="color:var(--line)">·</span>
      ${sla('breached', breach)}
      <span style="font-size:11px;color:var(--t3)">Oldest: <b style="color:var(--t1)">${esc(oldestLbl)}</b></span>
      <span style="font-size:11px;color:var(--t3)">Avg decision: <b style="color:var(--t1)">${esc(avgLbl)}</b></span>
    </div>`;
}

function _apFilterRisk(level) {
  _apFilter.risk = (_apFilter.risk === level) ? 'all' : level;
  _apPersistFilters(); _apRenderInbox();
}

function _apPersistFilters() {
  try { localStorage.setItem('ap.filters', JSON.stringify(_apFilter)); } catch(_) {}
}

// ─── INBOX ───────────────────────────────────────────────────────────────────
async function _apLoadInbox() {
  const body = document.getElementById('ap-body');
  if (!body) return;
  body.innerHTML = `<div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading inbox…</div></div>`;
  try {
    const { data, error } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'Failed to load');
    _apPending = Array.isArray(data.rows) ? data.rows : [];
    _apRenderSlaBand();
    _apRenderInbox();
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="et">Could not load inbox</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _apApplyFilters(rows) {
  const f = _apFilter;
  const q = (f.search || '').toLowerCase().trim();
  return rows.filter(r => {
    if (f.risk !== 'all' && _apRisk(r) !== f.risk) return false;
    if (f.type !== 'all' && r.request_type !== f.type) return false;
    if (f.maker !== 'all' && r.requested_by !== f.maker) return false;
    if (f.project !== 'all' && (r.project_id || '') !== f.project) return false;
    if (f.sla !== 'all' && _apSLA(r).status !== f.sla) return false;
    if (q) {
      const hay = (
        (r.title || '') + ' ' +
        (r.description || '') + ' ' +
        (r.requested_by_name || '') + ' ' +
        (r.entity_table || '') + ' ' +
        (_apProjectName(r.project_id) || '') + ' ' +
        ((_apClientInfo(r) || {}).name || '')
      ).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

function _apSortInbox(rows) {
  const rank = { high: 0, medium: 1, low: 2 };
  return rows.slice().sort((a,b) => {
    const ra = rank[_apRisk(a)] ?? 3;
    const rb = rank[_apRisk(b)] ?? 3;
    if (ra !== rb) return ra - rb;
    return new Date(a.requested_at || 0) - new Date(b.requested_at || 0);
  });
}

function _apFilterRail() {
  // Derive maker + project option lists from current pending set
  const makerSet = new Map();
  _apPending.forEach(r => {
    if (r.requested_by && r.requested_by_name && !makerSet.has(r.requested_by)) {
      makerSet.set(r.requested_by, r.requested_by_name);
    }
  });
  const projectSet = new Map();
  _apPending.forEach(r => {
    if (r.project_id) {
      const pn = _apProjectName(r.project_id) || r.project_id.slice(0,8);
      if (!projectSet.has(r.project_id)) projectSet.set(r.project_id, pn);
    }
  });

  const typeOpts = Object.keys(_AP_TYPE).map(t => `<option value="${t}"${_apFilter.type===t?' selected':''}>${esc(_AP_TYPE[t].lb)}</option>`).join('');
  const makerOpts = Array.from(makerSet.entries()).map(([id, n]) => `<option value="${esc(id)}"${_apFilter.maker===id?' selected':''}>${esc(n)}</option>`).join('');
  const prjOpts = Array.from(projectSet.entries()).map(([id, n]) => `<option value="${esc(id)}"${_apFilter.project===id?' selected':''}>${esc(n)}</option>`).join('');

  return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:10px 12px;background:var(--surface);border:1px solid var(--line);border-radius:10px">
    <select class="inp-light" style="font-size:12px;padding:5px 8px" onchange="_apSetFilter('type', this.value)">
      <option value="all"${_apFilter.type==='all'?' selected':''}>All Types</option>${typeOpts}
    </select>
    <select class="inp-light" style="font-size:12px;padding:5px 8px" onchange="_apSetFilter('maker', this.value)">
      <option value="all"${_apFilter.maker==='all'?' selected':''}>All Makers</option>${makerOpts}
    </select>
    <select class="inp-light" style="font-size:12px;padding:5px 8px" onchange="_apSetFilter('project', this.value)">
      <option value="all"${_apFilter.project==='all'?' selected':''}>All Projects</option>${prjOpts}
    </select>
    <select class="inp-light" style="font-size:12px;padding:5px 8px" onchange="_apSetFilter('sla', this.value)">
      <option value="all"${_apFilter.sla==='all'?' selected':''}>All SLA</option>
      <option value="on_track"${_apFilter.sla==='on_track'?' selected':''}>On track</option>
      <option value="at_risk"${_apFilter.sla==='at_risk'?' selected':''}>At risk</option>
      <option value="breached"${_apFilter.sla==='breached'?' selected':''}>Breached</option>
    </select>
    <input class="inp-light" type="search" placeholder="Search title / maker / project / client…"
      value="${esc(_apFilter.search || '')}" style="flex:1;min-width:180px;font-size:12px;padding:5px 10px"
      oninput="_apSetFilter('search', this.value)">
    ${(_apFilter.risk !== 'all' || _apFilter.type !== 'all' || _apFilter.maker !== 'all' || _apFilter.project !== 'all' || _apFilter.sla !== 'all' || _apFilter.search) ? `<button class="btn btn-gh btn-xs" onclick="_apResetFilters()">Reset</button>` : ''}
  </div>`;
}

function _apSetFilter(key, val) {
  _apFilter[key] = val;
  _apPersistFilters();
  _apRenderInbox();
}

function _apResetFilters() {
  _apFilter = { risk:'all', type:'all', maker:'all', project:'all', sla:'all', search:'' };
  _apPersistFilters();
  _apRenderInbox();
}

function _apRenderInbox() {
  const body = document.getElementById('ap-body');
  if (!body) return;

  if (!_apPending.length) {
    body.innerHTML = _apFilterRail() + `<div class="card"><div class="empty" style="padding:40px">
      <div class="ei"><svg width="34" height="34" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <div class="et">Inbox zero</div><div class="es">Nothing waiting for your decision.</div>
    </div></div>`;
    return;
  }

  const filtered = _apSortInbox(_apApplyFilters(_apPending));

  if (!filtered.length) {
    body.innerHTML = _apFilterRail() + `<div class="card"><div class="empty" style="padding:32px">
      <div class="et">No requests match the filters</div>
      <div class="es"><a href="javascript:void(0)" onclick="_apResetFilters()" style="color:var(--brand)">Reset filters</a></div>
    </div></div>`;
    return;
  }

  const cards = filtered.map(r => {
    const sla = _apSLA(r);
    const meta = _AP_TYPE[r.request_type] || { lb: r.request_type || '—', c:'#94a3b8' };
    const amtStr = r.amount != null ? `PKR ${fM(Number(r.amount))}` : '';
    const titleLine = `<div style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.title || meta.lb)}${amtStr ? ` <span style="color:var(--t2);font-weight:500"> · ${amtStr}</span>` : ''}</div>`;
    const descLine = r.description ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;max-width:540px">${esc(r.description)}</div>` : '';

    const chips = [_apMakerChip(r), _apProjectChip(r), _apClientChip(r)].filter(Boolean).join('<span style="color:var(--line);margin:0 2px">·</span>');
    const ageLine = `<div style="font-size:11px;color:var(--t3);margin-top:6px">${esc(_apAging(r.requested_at))} ago · ${_apSlaBadge(sla)}</div>`;

    return `<div class="ap-row" data-id="${esc(r.id)}" onclick="_apOpenDrawer('${esc(r.id)}')"
      style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:8px;cursor:pointer;transition:border-color .12s ease,box-shadow .12s ease"
      onmouseover="this.style.borderColor='var(--brand)';this.style.boxShadow='0 2px 8px rgba(0,0,0,.06)'"
      onmouseout="this.style.borderColor='var(--line)';this.style.boxShadow=''">
      <div style="display:flex;flex-direction:column;gap:6px;min-width:88px">
        ${_apRiskPill(sla.risk)}
        ${_apTypeBadge(r.request_type)}
      </div>
      <div style="flex:1;min-width:0">
        ${titleLine}
        ${descLine}
        ${chips ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:6px">${chips}</div>` : ''}
        ${ageLine}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end" onclick="event.stopPropagation()">
        <button class="btn btn-g btn-xs" onclick="_apQuickDecide('${esc(r.id)}','approve')">Approve</button>
        <button class="btn btn-gh btn-xs" style="color:var(--err);border-color:var(--err)" onclick="_apQuickDecide('${esc(r.id)}','reject')">Reject</button>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = _apFilterRail() + cards;
}

// Quick-action chips: open drawer with action staged
function _apQuickDecide(id, action) {
  _apOpenDrawer(id, action);
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
async function _apLoadHistory() {
  const body = document.getElementById('ap-body');
  if (!body) return;
  body.innerHTML = `<div class="empty" style="padding:32px"><div class="es" style="color:var(--t3)">Loading history…</div></div>`;
  try {
    const { data, error } = await supabase.rpc('get_approval_history', { p_filters: { limit: 200 } });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'Failed to load');
    _apHistory = Array.isArray(data.rows) ? data.rows : [];
    _apRenderHistory();
    _apRenderSlaBand(); // refresh avg decision time using new history data
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="empty"><div class="et">Could not load history</div><div class="es">${esc(e.message)}</div></div></div>`;
  }
}

function _apRenderHistory() {
  const body = document.getElementById('ap-body');
  if (!body) return;

  const decided = _apHistory.filter(r => r.status !== 'pending');
  if (!decided.length) {
    body.innerHTML = `<div class="card"><div class="empty" style="padding:40px"><div class="et">No decided requests yet</div><div class="es">Approved, rejected, and cancelled requests will appear here.</div></div></div>`;
    return;
  }

  const rows = decided.map(r => {
    const risk = _apRiskPill(_apRisk(r));
    const maker = r.requested_by_name ? esc(r.requested_by_name) : '—';
    const project = _apProjectName(r.project_id);
    const decidedAt = r.decided_at ? fD(String(r.decided_at).slice(0,10)) : '—';
    return `<tr style="cursor:pointer" onclick="_apOpenDrawer('${esc(r.id)}', null, true)">
      <td>${risk}</td>
      <td>${_apTypeBadge(r.request_type)}</td>
      <td>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.title || '—')}</div>
        ${project ? `<div style="font-size:11px;color:var(--t3);margin-top:2px">🏢 ${esc(project)}</div>` : ''}
      </td>
      <td>${_apStatusBadge(r.status)}</td>
      <td style="font-size:12px">${maker}</td>
      <td style="font-size:12px">${esc(r.decided_by_name || '—')}</td>
      <td style="font-size:11px;color:var(--t3);white-space:nowrap">${decidedAt}</td>
      <td style="font-size:11px;color:var(--t2);max-width:260px">${r.decision_comment ? esc(r.decision_comment) : '<span style="color:var(--t3)">—</span>'}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
    <div class="tw"><table class="t">
      <thead><tr>
        <th>Risk</th><th>Type</th><th>Request</th><th>Decision</th><th>Maker</th><th>Decided By</th><th>Date</th><th>Decision Comment</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

// ─── DECISION DRAWER ─────────────────────────────────────────────────────────
function _apEnsureDrawer() {
  if (document.getElementById('ap-drawer')) return;

  const bd = document.createElement('div');
  bd.id = 'ap-drawer-bd';
  bd.onclick = _apCloseDrawer;
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;display:none;opacity:0;transition:opacity .2s ease';
  document.body.appendChild(bd);

  const dr = document.createElement('div');
  dr.id = 'ap-drawer';
  dr.style.cssText = 'position:fixed;top:0;right:0;width:440px;max-width:96vw;height:100vh;background:var(--surface);border-left:1px solid var(--line);box-shadow:-8px 0 32px rgba(0,0,0,0.18);z-index:9999;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s ease-out';
  dr.innerHTML = `
    <div id="ap-drawer-head" style="flex:0 0 auto;padding:14px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start;gap:10px"></div>
    <div id="ap-drawer-body" style="flex:1 1 auto;overflow-y:auto;padding:0 18px"></div>
    <div id="ap-drawer-foot" style="flex:0 0 auto;padding:12px 18px;border-top:1px solid var(--line);background:var(--surface)"></div>`;
  document.body.appendChild(dr);
}

function _apCloseDrawer() {
  const dr = document.getElementById('ap-drawer');
  const bd = document.getElementById('ap-drawer-bd');
  if (dr) { dr.style.transform = 'translateX(100%)'; dr.classList.remove('open'); }
  if (bd) { bd.style.opacity = '0'; setTimeout(() => { bd.style.display = 'none'; }, 200); }
  _apDrawerRequest  = null;
  _apDrawerComments = [];
}

async function _apOpenDrawer(id, stagedAction, readOnly) {
  _apEnsureDrawer();
  const dr = document.getElementById('ap-drawer');
  const bd = document.getElementById('ap-drawer-bd');
  if (!dr || !bd) return;

  // Slide in
  bd.style.display = 'block';
  requestAnimationFrame(() => { bd.style.opacity = '1'; dr.style.transform = 'translateX(0)'; dr.classList.add('open'); });

  // Reset content while loading
  document.getElementById('ap-drawer-head').innerHTML = `<div><div style="font-size:11px;color:var(--t3)">Loading request…</div></div><button class="mx" onclick="_apCloseDrawer()" style="background:none;border:none;font-size:20px;color:var(--t3);cursor:pointer;padding:0 4px">✕</button>`;
  document.getElementById('ap-drawer-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">⏳</div>`;
  document.getElementById('ap-drawer-foot').innerHTML = '';

  // Find row (from pending if present; otherwise from history)
  let row = _apPending.find(x => x.id === id) || _apHistory.find(x => x.id === id) || { id };

  _apDrawerLoading  = true;
  _apDrawerRequest  = row;
  _apDrawerComments = [];

  try {
    const { data } = await supabase.rpc('get_approval_history', { p_filters: { request_id: id } });
    if (data && data.request) {
      _apDrawerRequest = Object.assign({}, row, data.request);
    }
    _apDrawerComments = (data && Array.isArray(data.comments)) ? data.comments : [];
  } catch (e) {
    console.warn('[approvals] drawer detail load failed', e);
  } finally {
    _apDrawerLoading = false;
  }

  _apRenderDrawer(stagedAction, !!readOnly);
}

function _apRenderDrawer(stagedAction, readOnly) {
  const req = _apDrawerRequest || {};
  const head = document.getElementById('ap-drawer-head');
  const body = document.getElementById('ap-drawer-body');
  const foot = document.getElementById('ap-drawer-foot');
  if (!head || !body || !foot) return;

  const sla = _apSLA(req);
  const rule = _apRestrictionInfo(req.request_type);
  const maker = _apMakerInfo(req);
  const project = _apProjectName(req.project_id);
  const client  = _apClientInfo(req);
  const isDecided = req.status && req.status !== 'pending';

  // Header
  head.innerHTML = `
    <div style="flex:1;min-width:0">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px">
        ${_apRiskPill(sla.risk)} ${_apTypeBadge(req.request_type)} ${isDecided ? _apStatusBadge(req.status) : _apSlaBadge(sla)}
      </div>
      <div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3">${esc(req.title || _AP_TYPE[req.request_type]?.lb || 'Request')}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:3px;font-family:monospace">#${esc(String(req.id || '').slice(0,8))} · ${esc(req.entity_table || '')}${req.entity_id?' · '+esc(String(req.entity_id).slice(0,8)):''}</div>
    </div>
    <button class="mx" onclick="_apCloseDrawer()" style="background:none;border:none;font-size:20px;color:var(--t3);cursor:pointer;padding:0 4px">✕</button>`;

  // Body sections
  const chipsHtml = `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;border-bottom:1px solid var(--line)">
    ${maker.name ? `<span style="font-size:12px;color:var(--t2)">👤 <b>${esc(maker.name)}</b>${maker.role?` <span style="color:var(--t3)">· ${esc(maker.role)}</span>`:''}</span>` : ''}
    ${project ? `<span style="font-size:12px;color:var(--t2)">🏢 <b>${esc(project)}</b></span>` : ''}
    ${client && client.name ? `<span style="font-size:12px;color:var(--t2)">👥 <b>${esc(client.name)}</b></span>` : ''}
    ${req.amount != null ? `<span style="font-size:12px;color:var(--t2)">💰 <b>PKR ${fM(Number(req.amount))}</b></span>` : ''}
    <span style="font-size:11px;color:var(--t3)">${esc(_apAging(req.requested_at))} ago</span>
  </div>`;

  const ruleHtml = `<div style="margin:12px 0;padding:10px 14px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#b45309;margin-bottom:4px">Why approval is required</div>
    <div style="font-size:12px;color:var(--t1)">Action <code style="background:rgba(0,0,0,.05);padding:1px 5px;border-radius:3px">${esc(rule.action)}</code> is configured as <b style="text-transform:uppercase">${esc(rule.level)}</b> block. Default behavior: route to admin approval.</div>
    <div style="font-size:11px;color:var(--t3);margin-top:4px">Hard-blocks still apply at the executor level (e.g. payment &gt; outstanding, delete client with active financials).</div>
  </div>`;

  const callouts = _apRiskCallouts(req);
  const calloutsHtml = callouts.length ? `<div style="margin:12px 0;padding:10px 14px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.18);border-radius:8px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--err);margin-bottom:6px">What changes if you approve</div>
    <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--t1);line-height:1.6">
      ${callouts.map(c => `<li>${c}</li>`).join('')}
    </ul>
  </div>` : '';

  // Payload preview (top-level keys only, values stringified short)
  const pl = req.payload || {};
  const plKeys = Object.keys(pl).filter(k => k !== 'fields' && k !== 'schedule');
  const plHtml = plKeys.length ? `<div style="margin:12px 0">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:6px">Proposed payload</div>
    <div style="background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-family:monospace;font-size:11px;color:var(--t1);max-height:180px;overflow-y:auto">
      ${plKeys.map(k => `<div style="padding:3px 0;display:flex;gap:8px;border-bottom:1px dashed var(--line)"><b style="color:var(--t2);min-width:140px">${esc(k)}</b><span style="word-break:break-all">${esc(_apFmtVal(pl[k]))}</span></div>`).join('')}
    </div>
  </div>` : '';

  // Comments thread (newest last per typical maker-checker order)
  const thread = (_apDrawerComments || []).slice().sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  const threadHtml = `<div style="margin:14px 0 6px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:6px">Comments</div>
    ${thread.length ? thread.map(c => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11px;color:var(--t3)"><b style="color:var(--t2)">${esc(c.author_name || '—')}</b> · ${esc(c.action || 'comment')} · ${esc(_apRelTime(c.created_at))}</div>
        <div style="font-size:12px;color:var(--text);margin-top:3px">${esc(c.comment || '—')}</div>
      </div>`).join('') : `<div style="font-size:12px;color:var(--t3)">No comments on file.</div>`}
  </div>`;

  body.innerHTML = chipsHtml + ruleHtml + calloutsHtml + plHtml + threadHtml;

  // Footer — decision composer (only when pending)
  if (isDecided) {
    foot.innerHTML = `<div style="font-size:12px;color:var(--t3);text-align:center;padding:6px">
      Decided ${esc(req.decided_at ? _apRelTime(req.decided_at) : 'previously')} by ${esc(req.decided_by_name || '—')}.
    </div>`;
    return;
  }

  foot.innerHTML = `
    <textarea id="ap-dec-comment" class="inp-light" rows="2"
      placeholder="Required — explain your decision (≥5 chars)"
      style="width:100%;font-size:12px;margin-bottom:8px;resize:vertical" oninput="_apClearDrawerErr()"></textarea>
    <div id="ap-dec-err" style="font-size:11px;color:var(--err);margin-bottom:8px;min-height:14px"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-gh" onclick="_apDrawerSubmit('reject')" style="flex:1;color:var(--err);border-color:var(--err)">Reject</button>
      <button class="btn btn-g"  onclick="_apDrawerSubmit('approve')" style="flex:2">Approve</button>
    </div>`;

  // Auto-focus textarea, optionally pre-warm based on staged action
  setTimeout(() => {
    const ta = document.getElementById('ap-dec-comment');
    if (ta) ta.focus();
    if (stagedAction === 'reject') {
      // visually emphasize the Reject button if user clicked Reject chip in inbox
      const btn = foot.querySelector('button.btn-gh');
      if (btn) { btn.style.boxShadow = '0 0 0 2px rgba(239,68,68,.25)'; }
    } else if (stagedAction === 'approve') {
      const btn = foot.querySelector('button.btn-g');
      if (btn) { btn.style.boxShadow = '0 0 0 2px rgba(34,197,94,.25)'; }
    }
  }, 50);
}

function _apFmtVal(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 120 ? v.slice(0,117) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function _apClearDrawerErr() {
  const e = document.getElementById('ap-dec-err');
  if (e) e.textContent = '';
  document.getElementById('ap-dec-comment')?.classList.remove('inp-err');
}

async function _apDrawerSubmit(action) {
  const req = _apDrawerRequest;
  if (!req || !req.id) return;

  const comment = (document.getElementById('ap-dec-comment')?.value || '').trim();
  if (comment.length < 5) {
    const e = document.getElementById('ap-dec-err');
    if (e) e.textContent = 'A comment of at least 5 characters is required.';
    document.getElementById('ap-dec-comment')?.classList.add('inp-err');
    document.getElementById('ap-dec-comment')?.focus();
    return;
  }

  const foot = document.getElementById('ap-drawer-foot');
  const allBtns = foot ? foot.querySelectorAll('button') : [];
  allBtns.forEach(b => { b.disabled = true; });
  const submitBtn = foot ? foot.querySelector(action === 'approve' ? 'button.btn-g' : 'button.btn-gh') : null;
  const origTxt = submitBtn ? submitBtn.textContent : '';
  if (submitBtn) submitBtn.textContent = 'Saving…';

  try {
    const rpc = action === 'approve' ? 'approve_request' : 'reject_request';
    const { data, error } = await supabase.rpc(rpc, { p_request_id: req.id, p_comment: comment });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.message || data?.error || 'Decision failed');

    toast(action === 'approve' ? 'Request approved & applied' : 'Request rejected', 'ok');

    // Optimistic local update + sidebar refresh
    _apPending = _apPending.filter(x => x.id !== req.id);
    _apCloseDrawer();
    _apRenderSlaBand();
    _apRenderInbox();
    if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
  } catch (e) {
    const er = document.getElementById('ap-dec-err');
    if (er) er.textContent = e.message || 'Decision failed';
    allBtns.forEach(b => { b.disabled = false; });
    if (submitBtn) submitBtn.textContent = origTxt;
  }
}

// ─── Sidebar pending badge (PRESERVED PUBLIC NAME + SHAPE) ───────────────────
// Sets window._approvalsPending then re-renders the sidebar (admin only).
async function refreshApprovalsBadge() {
  if (!S || (S.role !== 'owner' && S.role !== 'admin')) return;
  try {
    const { data } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
    window._approvalsPending = (data && Array.isArray(data.rows)) ? data.rows.length : 0;
  } catch { window._approvalsPending = 0; }
  if (typeof buildSB === 'function') buildSB();
}
