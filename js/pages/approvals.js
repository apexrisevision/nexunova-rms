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

// ─── Warmth-kit tone maps + helpers ──────────────────────────────────────────
const _AP_TYPE_TONE = {
  discount:'primary', price_revision:'info', cancellation:'danger', transfer:'warning',
  refund:'info', dnd:'', blacklist:'danger', payment_void:'primary',
  payment_backdate:'primary', schedule_change:'info', client_status:'info',
  legal_delete:'danger', sale_edit:'warning',
};
const _AP_RISK_TONE = { high:'danger', medium:'warning', low:'info' };
const _AP_SLA_TONE  = { on_track:'success', at_risk:'warning', breached:'danger' };
const _AP_STATUS_TONE = { approved:'success', rejected:'danger', pending:'warning', cancelled:'' };

// One-time CSS — sla band, filter row, inbox rows (class names avoid "-card").
function _apCSS() {
  if (document.getElementById('_ap_css')) return;
  const s = document.createElement('style'); s.id = '_ap_css';
  s.textContent = `
    .ap-band{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;padding:12px 16px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card)}
    .ap-band-l,.ap-band-r{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .ap-tier{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;border:1px solid var(--fk-border);background:var(--fk-bg-card);cursor:pointer;color:var(--fk-text-muted)}
    .ap-tier .dot{width:6px;height:6px;border-radius:50%}
    .ap-tier.is-on{border-color:var(--fk-primary);color:var(--fk-primary);background:var(--fk-primary-tint)}
    .ap-band-meta{font-size:11px;color:var(--fk-text-muted)}
    .ap-band-meta b{color:var(--fk-text)}
    .ap-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
    .ap-filters .nx-select{max-width:160px}
    .ap-filters .ap-search{flex:1;min-width:200px;max-width:360px}
    .ap-row{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;margin-bottom:9px;cursor:pointer}
    .ap-row-lead{display:flex;flex-direction:column;gap:6px;min-width:92px;flex-shrink:0}
    .ap-row-main{flex:1;min-width:0}
    .ap-row-title{font-size:13px;font-weight:600;color:var(--fk-text)}
    .ap-row-desc{font-size:11.5px;color:var(--fk-text-muted);margin-top:2px;max-width:560px}
    .ap-row-chips{margin-top:7px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11.5px;color:var(--fk-text-muted)}
    .ap-row-age{font-size:11px;color:var(--fk-text-muted);margin-top:7px;display:flex;align-items:center;gap:8px}
    .ap-row-acts{display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0}
    .ap-grp{margin-bottom:14px}
    .ap-grp-hd{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted);margin-bottom:7px}
    .ap-kv{display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:12.5px}
    .ap-kv .l{color:var(--fk-text-muted)} .ap-kv .r{color:var(--fk-text);font-weight:500;font-variant-numeric:tabular-nums;word-break:break-all;text-align:right}
    .ap-thread{padding:9px 0;border-bottom:1px solid var(--fk-border)}
    .ap-thread:last-child{border-bottom:none}
    .ap-thread-meta{font-size:11px;color:var(--fk-text-muted)} .ap-thread-meta b{color:var(--fk-text)}
    .ap-thread-body{font-size:12.5px;color:var(--fk-text);margin-top:3px}
    .ap-payload{background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);padding:8px 12px;font-family:var(--fk-font-mono,ui-monospace,monospace);font-size:11px;max-height:200px;overflow:auto}
    .ap-payload-row{display:flex;gap:8px;padding:3px 0;border-bottom:1px dashed var(--fk-border)}
    .ap-payload-row b{color:var(--fk-text-muted);min-width:140px}
  `;
  document.head.appendChild(s);
}

function _apTypeBadge(t) {
  const m = _AP_TYPE[t] || { lb: t || '—' };
  return NX.badge(m.lb, _AP_TYPE_TONE[t] || '');
}
function _apRiskPill(risk) {
  const m = _AP_RISK_META[risk] || _AP_RISK_META.low;
  return NX.badge(m.lb, _AP_RISK_TONE[risk] || 'info', { dot:true });
}
function _apSlaBadge(sla) {
  const m = _AP_SLA_META[sla.status] || _AP_SLA_META.on_track;
  return NX.badge(m.lb, _AP_SLA_TONE[sla.status] || 'success');
}
function _apStatusBadge(s) {
  const map = { approved:'Approved', rejected:'Rejected', pending:'Pending', cancelled:'Cancelled' };
  return NX.badge(map[s] || s || '—', _AP_STATUS_TONE[s] || '', { dot:true });
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
  return `<span class="nx-mono" style="font-size:11px;color:var(--fk-text-muted)">${esc(row.entity_table)}${short ? ' · ' + short : ''}</span>`;
}

// Chip renderers used in rows + drawer
function _apChip(icon, text, suffix) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--fk-text);font-weight:500">${NX.icon(icon,13)} ${esc(text)}${suffix||""}</span>`;
}
function _apMakerChip(row) {
  const m = _apMakerInfo(row);
  if (!m.name) return `<span style="font-size:11px;color:var(--fk-text-muted)">Maker: —</span>`;
  const roleSfx = m.role ? ` <span style="color:var(--fk-text-muted);font-weight:400"> · ${esc(m.role)}</span>` : "";
  return _apChip("user", m.name, roleSfx);
}
function _apProjectChip(row) {
  const name = _apProjectName(row.project_id);
  if (!name) return "";
  return _apChip("building-2", name);
}
function _apClientChip(row) {
  const c = _apClientInfo(row);
  if (!c || !c.name) return "";
  return _apChip("users", c.name);
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

  _apCSS();
  el.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Approval Control Center', '', { icon:'shield', sub:'Maker-checker requests — review, decide with a comment, full trail kept.' }) +
      '<div class="ap-band" id="ap-sla-band"></div>' +
      '<div id="ap-tabs" style="margin-bottom:14px"></div>' +
      '<div id="ap-body"></div>' +
    '</div>' +
    '<div id="ap-modal-host"></div>';

  _apBindEscOnce();
  _apRenderTabs(_apTab);
  _apSetTab(_apTab);
}

function _apRenderTabs(active) {
  const el = document.getElementById('ap-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({ tabs: [
    { k:'inbox',   label:'Inbox',   icon:'inbox',   count: _apPending.length || undefined },
    { k:'history', label:'History', icon:'history' }
  ], active, onSelect:"_apSetTab('%k')" });
}

function _apSetTab(t) {
  _apTab = t;
  _apRenderTabs(t);
  if (t === 'inbox') _apLoadInbox(); else _apLoadHistory();
}

function _apBindEscOnce() {
  if (_apEscBound) return;
  _apEscBound = true;
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const h = document.getElementById('ap-modal-host');
      if (h && h.firstChild) { e.stopPropagation(); _apCloseDrawer(); }
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

  const _DOT = { high:'var(--fk-danger)', medium:'var(--fk-warning)', low:'var(--fk-info)' };
  const tier = (lvl, n) => {
    const meta = _AP_RISK_META[lvl];
    const on = _apFilter.risk === lvl;
    return `<button class="ap-tier${on?' is-on':''}" onclick="_apFilterRisk('${lvl}')"><span class="dot" style="background:${_DOT[lvl]}"></span>${meta.lb} ${n}</button>`;
  };
  const sla = (status, n) => {
    const tone = _AP_SLA_TONE[status] || 'success';
    return `<span class="ap-band-meta">${_AP_SLA_META[status].lb} <b style="color:var(--fk-${tone})">${n}</b></span>`;
  };

  band.innerHTML = `
    <div class="ap-band-l">
      ${tier('high', h)} ${tier('medium', m)} ${tier('low', l)}
      <span class="ap-band-meta" style="margin-left:4px">${total} pending</span>
    </div>
    <div class="ap-band-r">
      ${sla('on_track', onTrack)}<span style="color:var(--fk-border)">·</span>
      ${sla('at_risk', atRisk)}<span style="color:var(--fk-border)">·</span>
      ${sla('breached', breach)}
      <span class="ap-band-meta">Oldest <b>${esc(oldestLbl)}</b></span>
      <span class="ap-band-meta">Avg <b>${esc(avgLbl)}</b></span>
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
  body.innerHTML = NX.card(NX.empty({ icon:'inbox', message:'Loading inbox…' }));
  try {
    const { data, error } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'Failed to load');
    _apPending = Array.isArray(data.rows) ? data.rows : [];
    _apRenderTabs('inbox');   // refresh the count chip
    _apRenderSlaBand();
    _apRenderInbox();
  } catch (e) {
    body.innerHTML = NX.card(NX.banner('Could not load inbox: ' + (e.message || 'Error'), 'danger'));
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

  const hasFilters = _apFilter.risk !== 'all' || _apFilter.type !== 'all' || _apFilter.maker !== 'all' || _apFilter.project !== 'all' || _apFilter.sla !== 'all' || _apFilter.search;
  return `<div class="ap-filters">
    <select class="nx-select" onchange="_apSetFilter('type', this.value)"><option value="all"${_apFilter.type==='all'?' selected':''}>All types</option>${typeOpts}</select>
    <select class="nx-select" onchange="_apSetFilter('maker', this.value)"><option value="all"${_apFilter.maker==='all'?' selected':''}>All makers</option>${makerOpts}</select>
    <select class="nx-select" onchange="_apSetFilter('project', this.value)"><option value="all"${_apFilter.project==='all'?' selected':''}>All projects</option>${prjOpts}</select>
    <select class="nx-select" onchange="_apSetFilter('sla', this.value)">
      <option value="all"${_apFilter.sla==='all'?' selected':''}>All SLA</option>
      <option value="on_track"${_apFilter.sla==='on_track'?' selected':''}>On track</option>
      <option value="at_risk"${_apFilter.sla==='at_risk'?' selected':''}>At risk</option>
      <option value="breached"${_apFilter.sla==='breached'?' selected':''}>Breached</option>
    </select>
    <input class="nx-input ap-search" type="search" placeholder="Search title / maker / project / client…" value="${esc(_apFilter.search || '')}" oninput="_apSetFilter('search', this.value)">
    ${hasFilters ? NX.button('Reset', { variant:'secondary', size:'sm', onclick:'_apResetFilters()' }) : ''}
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
    body.innerHTML = _apFilterRail() + NX.card(NX.empty({ icon:'check-circle', tone:'success', message:'Inbox zero — nothing waiting for your decision.' }));
    return;
  }

  const filtered = _apSortInbox(_apApplyFilters(_apPending));

  if (!filtered.length) {
    body.innerHTML = _apFilterRail() + NX.card(NX.empty({ icon:'inbox', message:'No requests match the filters.',
      action: NX.button('Reset filters', { variant:'secondary', onclick:'_apResetFilters()' }) }));
    return;
  }

  const cards = filtered.map(r => {
    const sla = _apSLA(r);
    const meta = _AP_TYPE[r.request_type] || { lb: r.request_type || '—' };
    const amtStr = r.amount != null ? `<span style="color:var(--fk-text-muted);font-weight:500"> · PKR ${fM(Number(r.amount))}</span>` : '';
    const chips = [_apMakerChip(r), _apProjectChip(r), _apClientChip(r)].filter(Boolean).join('<span style="color:var(--fk-border)">·</span>');

    const inner = `
      <div class="ap-row-lead">${_apRiskPill(sla.risk)}${_apTypeBadge(r.request_type)}</div>
      <div class="ap-row-main">
        <div class="ap-row-title">${esc(r.title || meta.lb)}${amtStr}</div>
        ${r.description ? `<div class="ap-row-desc">${esc(r.description)}</div>` : ''}
        ${chips ? `<div class="ap-row-chips">${chips}</div>` : ''}
        <div class="ap-row-age">${esc(_apAging(r.requested_at))} ago${_apSlaBadge(sla)}</div>
      </div>
      <div class="ap-row-acts" onclick="event.stopPropagation()">
        ${NX.button('Approve', { variant:'primary', size:'sm', onclick:`_apQuickDecide('${esc(r.id)}','approve')` })}
        ${NX.button('Reject', { variant:'danger-soft', size:'sm', onclick:`_apQuickDecide('${esc(r.id)}','reject')` })}
      </div>`;
    return `<div class="nx-card nx-card--hover ap-row" data-id="${esc(r.id)}" onclick="_apOpenDrawer('${esc(r.id)}')">${inner}</div>`;
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
  body.innerHTML = NX.card(NX.empty({ icon:'history', message:'Loading history…' }));
  try {
    const { data, error } = await supabase.rpc('get_approval_history', { p_filters: { limit: 200 } });
    if (error) throw error;
    if (!data || !data.success) throw new Error(data?.error || 'Failed to load');
    _apHistory = Array.isArray(data.rows) ? data.rows : [];
    _apRenderHistory();
    _apRenderSlaBand(); // refresh avg decision time using new history data
  } catch (e) {
    body.innerHTML = NX.card(NX.banner('Could not load history: ' + (e.message || 'Error'), 'danger'));
  }
}

function _apRenderHistory() {
  const body = document.getElementById('ap-body');
  if (!body) return;

  const decided = _apHistory.filter(r => r.status !== 'pending');
  if (!decided.length) {
    body.innerHTML = NX.card(NX.empty({ icon:'history', message:'No decided requests yet — approved, rejected and cancelled requests appear here.' }));
    return;
  }

  const rows = decided.map(r => {
    const project = _apProjectName(r.project_id);
    const decidedAt = r.decided_at ? fD(String(r.decided_at).slice(0,10)) : '—';
    const reqCell = '<div style="font-weight:500">' + esc(r.title || '—') + '</div>' +
      (project ? '<div style="font-size:11px;color:var(--fk-text-muted);margin-top:2px">' + esc(project) + '</div>' : '');
    return [
      _apRiskPill(_apRisk(r)),
      _apTypeBadge(r.request_type),
      reqCell,
      _apStatusBadge(r.status),
      esc(r.requested_by_name || '—'),
      esc(r.decided_by_name || '—'),
      '<span style="white-space:nowrap;color:var(--fk-text-muted)">' + decidedAt + '</span>',
      r.decision_comment ? '<span style="color:var(--fk-text-muted)">' + esc(r.decision_comment) + '</span>' : '<span style="color:var(--fk-text-muted)">—</span>'
    ];
  });

  body.innerHTML = NX.card(NX.table({
    cols: [{label:'Risk'},{label:'Type'},{label:'Request'},{label:'Decision'},{label:'Maker'},{label:'Decided By'},{label:'Date'},{label:'Comment'}],
    rows, flush:true
  }), { flush:true });
}

// ─── DECISION DRAWER ─────────────────────────────────────────────────────────
function _apModalHost() {
  let h = document.getElementById('ap-modal-host');
  if (!h) { h = document.createElement('div'); h.id = 'ap-modal-host'; document.body.appendChild(h); }
  return h;
}
function _apEnsureDrawer() { _apModalHost(); }

function _apCloseDrawer() {
  const h = document.getElementById('ap-modal-host'); if (h) h.innerHTML = '';
  _apDrawerRequest  = null;
  _apDrawerComments = [];
}

async function _apOpenDrawer(id, stagedAction, readOnly) {
  _apModalHost().innerHTML = NX.modal({ id:'ap-modal', title:'Loading request…', size:'l', onClose:'_apCloseDrawer()', body: NX.empty({ icon:'shield', message:'Loading…' }) });

  let row = _apPending.find(x => x.id === id) || _apHistory.find(x => x.id === id) || { id };
  _apDrawerLoading  = true;
  _apDrawerRequest  = row;
  _apDrawerComments = [];
  try {
    const { data } = await supabase.rpc('get_approval_history', { p_filters: { request_id: id } });
    if (data && data.request) _apDrawerRequest = Object.assign({}, row, data.request);
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
  const sla = _apSLA(req);
  const rule = _apRestrictionInfo(req.request_type);
  const maker = _apMakerInfo(req);
  const project = _apProjectName(req.project_id);
  const client  = _apClientInfo(req);
  const isDecided = req.status && req.status !== 'pending';

  const grp = (icon, tone, title, inner) => '<div class="ap-grp"><div class="ap-grp-hd">' + NX.ichip(icon, tone, { size:'sm' }) + esc(title) + '</div>' + inner + '</div>';
  const kv = (l, v) => '<div class="ap-kv"><span class="l">' + esc(l) + '</span><span class="r">' + v + '</span></div>';

  const overview =
    (maker.name ? kv('Maker', '<strong>' + esc(maker.name) + '</strong>' + (maker.role ? ' · ' + esc(maker.role) : '')) : '') +
    (project ? kv('Project', esc(project)) : '') +
    (client && client.name ? kv('Client', esc(client.name)) : '') +
    (req.amount != null ? kv('Amount', '<strong>PKR ' + fM(Number(req.amount)) + '</strong>') : '') +
    kv('Requested', esc(_apAging(req.requested_at)) + ' ago') +
    kv('Reference', '<span class="nx-mono">#' + esc(String(req.id || '').slice(0,8)) + '</span> · ' + esc(req.entity_table || ''));

  const ruleHtml = NX.banner('Action "' + esc(rule.action) + '" is configured as ' + String(rule.level).toUpperCase() + ' block — routed to admin approval. Hard-blocks still apply at the executor level.', 'warn');

  const callouts = _apRiskCallouts(req);
  const calloutsHtml = callouts.length ? grp('alert-triangle','danger','What changes if you approve', '<ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--fk-text);line-height:1.6">' + callouts.map(c => '<li>' + c + '</li>').join('') + '</ul>') : '';

  const pl = req.payload || {};
  const plKeys = Object.keys(pl).filter(k => k !== 'fields' && k !== 'schedule');
  const plHtml = plKeys.length ? grp('file-text','','Proposed payload', '<div class="ap-payload">' + plKeys.map(k => '<div class="ap-payload-row"><b>' + esc(k) + '</b><span>' + esc(_apFmtVal(pl[k])) + '</span></div>').join('') + '</div>') : '';

  const thread = (_apDrawerComments || []).slice().sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  const threadHtml = grp('message-circle','','Comments', thread.length ? thread.map(c => '<div class="ap-thread"><div class="ap-thread-meta"><b>' + esc(c.author_name || '—') + '</b> · ' + esc(c.action || 'comment') + ' · ' + esc(_apRelTime(c.created_at)) + '</div><div class="ap-thread-body">' + esc(c.comment || '—') + '</div></div>').join('') : '<div style="font-size:12.5px;color:var(--fk-text-muted)">No comments on file.</div>');

  const badges = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px">' + _apRiskPill(sla.risk) + ' ' + _apTypeBadge(req.request_type) + ' ' + (isDecided ? _apStatusBadge(req.status) : _apSlaBadge(sla)) + '</div>';
  const body = badges + grp('user','','Overview', overview) + ruleHtml + calloutsHtml + plHtml + threadHtml;

  let footer;
  if (isDecided) {
    footer = '<div style="font-size:12px;color:var(--fk-text-muted);text-align:center;width:100%">Decided ' + esc(req.decided_at ? _apRelTime(req.decided_at) : 'previously') + ' by ' + esc(req.decided_by_name || '—') + '.</div>';
  } else {
    footer =
      '<div style="width:100%">' +
      '<textarea id="ap-dec-comment" class="nx-textarea" rows="2" placeholder="Required — explain your decision (≥5 chars)" oninput="_apClearDrawerErr()"></textarea>' +
      '<div class="nx-error" id="ap-dec-err"></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        NX.button('Reject', { variant:'danger-soft', attrs:'id="ap-reject-btn" style="flex:1"', onclick:"_apDrawerSubmit('reject')" }) +
        NX.button('Approve', { variant:'primary', attrs:'id="ap-approve-btn" style="flex:2"', onclick:"_apDrawerSubmit('approve')" }) +
      '</div></div>';
  }

  _apModalHost().innerHTML = NX.modal({ id:'ap-modal', title: req.title || (_AP_TYPE[req.request_type] && _AP_TYPE[req.request_type].lb) || 'Request', size:'l', onClose:'_apCloseDrawer()', body, footer });

  if (!isDecided) setTimeout(() => {
    const ta = document.getElementById('ap-dec-comment'); if (ta) ta.focus();
    const bid = stagedAction === 'reject' ? 'ap-reject-btn' : (stagedAction === 'approve' ? 'ap-approve-btn' : null);
    if (bid) { const b = document.getElementById(bid); if (b) b.style.boxShadow = '0 0 0 3px var(--fk-primary-tint)'; }
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
  document.getElementById('ap-dec-comment')?.closest('div')?.classList.remove('nx-field--error');
}

async function _apDrawerSubmit(action) {
  const req = _apDrawerRequest;
  if (!req || !req.id) return;

  const comment = (document.getElementById('ap-dec-comment')?.value || '').trim();
  if (comment.length < 5) {
    const e = document.getElementById('ap-dec-err');
    if (e) e.textContent = 'A comment of at least 5 characters is required.';
    
    document.getElementById('ap-dec-comment')?.focus();
    return;
  }

  const host = document.getElementById('ap-modal-host');
  const allBtns = host ? host.querySelectorAll('button') : [];
  allBtns.forEach(b => { b.disabled = true; });
  const submitBtn = document.getElementById(action === 'approve' ? 'ap-approve-btn' : 'ap-reject-btn');
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
