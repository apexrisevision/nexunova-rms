// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD — Phase 3A rebuild (2026-06-12)
// The single, role-aware home page on the foundation kit. Answers exactly three
// questions: HOW MUCH is owed · BY WHOM · WHO IS LATE. No theater — the gradient
// greeting, analog clock, MISSION CONTROL / ACTION RADAR, invented health score,
// gradient strips, ticker and FAB are all gone.
//
// Every number is real and traceable:
//   • KPIs / WHO-IS-LATE / overdue  = get_recovery_position (current month-to-date)
//   • Inflow (6 mo)                 = get_recovery_position per month (parallel, cached)
//                                     -> totals.received_total (same RPC = consistent)
//   • PDCs ≤7d                      = get_pdc_register
//   • Pending approvals             = get_pending_approvals (count; hidden if 0)
// Kit only: NX.* / .nx-* + --fk-* tokens. No hardcoded hex, no off-scale sizes,
// no gradients (chart uses a flat token fill), no emoji.
// ══════════════════════════════════════════════════════════════════════════

/* ── format helpers ──────────────────────────────────────────────────────── */
function _dashCompact(v) {                 // 210,697,190 -> "210.7M" (KPI values)
  v = Number(v || 0); const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + a.toFixed(0);
}
function _dashExact(v) {                    // exact, comma-grouped (tables/strips)
  return (typeof fM === 'function') ? fM(Number(v || 0)) : Number(v || 0).toLocaleString('en-US');
}
function _dashPct(v) { return (Number(v || 0)).toFixed(1) + '%'; }
function _dashRiskTone(days) { days = Number(days || 0); return days > 90 ? 'danger' : days > 30 ? 'warning' : 'success'; }

/* ── month ranges (oldest->current; current is month-start->today, MTD) ─────── */
function _dashMonths(n) {
  const out = [], now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const ymd  = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const isCurrent = i === 0;
    out.push({ from: ymd(d), to: isCurrent ? (typeof td === 'function' ? td() : ymd(now)) : ymd(last),
               label: d.toLocaleDateString('en-US', { month: 'short' }), current: isCurrent });
  }
  return out;
}

/* ── get_recovery_position with per-session cache (keyed by cid|project|from|to) ── */
function _dashRpCacheClear() { window._dashRpCache = {}; }
async function _dashRP(from, to, projectId) {
  window._dashRpCache = window._dashRpCache || {};
  const key = `${S.cid}|${projectId || ''}|${from}|${to}`;
  if (window._dashRpCache[key]) return window._dashRpCache[key];
  const { data, error } = await supabase.rpc('get_recovery_position', {
    p_company_id: S.cid, p_project_id: projectId || null, p_from_date: from, p_to_date: to
  });
  if (error || !data) throw (error || new Error('recovery position unavailable'));
  window._dashRpCache[key] = data;
  return data;
}

/* ════════════════════════════════════════════════════════════════════════
   rDash — role router (the only external entry; called from ui.js fns map)
   ════════════════════════════════════════════════════════════════════════ */
async function rDash() {
  const pg = document.getElementById('pg-dashboard');
  if (!pg) return;
  pg.classList.remove('cc-active');                 // shed any legacy theater state
  try { (window._ccTimers || []).forEach(t => clearInterval(t)); window._ccTimers = []; } catch (_) {}
  const role    = (typeof effectiveRole === 'function') ? effectiveRole() : (S && S.role) || 'admin';
  const isAdmin = role === 'admin' || role === 'owner';
  pg.innerHTML = `<div class="nx">${_dashSkeleton()}</div>`;
  try {
    if (isAdmin) await _dashAdmin(pg);
    else         await _dashStaff(pg, role);
  } catch (e) {
    console.error('[dashboard] load failed', e);
    pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">` +
      _dashHeader() +
      NX.banner('Could not load the dashboard. Check your connection and retry.', 'danger') +
      `<div style="margin-top:var(--fk-sp-3)">` +
        NX.button('Retry', { variant: 'secondary', onclick: 'rDash()' }) + `</div></div>`;
  }
}

/* ── shared header (title + current-month context + Record Payment) ───────── */
function _dashMonthLabel() { return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function _dashHeader() {
  const action = NX.button('Record Payment', { variant: 'primary', icon: 'plus', onclick: "nav('addpayment')" });
  return `<div class="nx-page-header">
    <div>
      <h1 class="nx-page-title">Dashboard</h1>
      <div class="nx-kpi-label" style="margin-top:4px">${esc(_dashMonthLabel())}</div>
    </div>
    <div class="nx-page-actions">${action}</div>
  </div>`;
}
function _dashSkeleton() {
  return _dashHeader() + `<div class="nx-card" style="margin-top:var(--fk-sp-4)">
    <div class="nx-empty"><div class="nx-empty-msg">Loading…</div></div></div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   ADMIN / OWNER — Team view
   ════════════════════════════════════════════════════════════════════════ */
async function _dashAdmin(pg) {
  const months = _dashMonths(6);
  // All RP month calls + PDC + approvals in parallel (per-session cached).
  const [rps, pdc, apprCount, receivable] = await Promise.all([
    Promise.all(months.map(m => _dashRP(m.from, m.to))),
    _dashLoadPDC().catch(() => null),
    _dashLoadApprovals().catch(() => 0),
    _dashLoadReceivable().catch(() => 0)
  ]);
  months.forEach((m, i) => { m.collected = Number(rps[i].totals?.received_total || 0); });
  const rp     = rps[months.length - 1];            // current month MTD = KPI/source of truth
  const t      = rp.totals || {};
  const rows   = Array.isArray(rp.rows) ? rp.rows : [];
  const overdueAmt = rows.reduce((s, r) => s + (Number(r.overdue_days) > 0 ? Number(r.closing || 0) : 0), 0);
  const cross90    = rows.filter(r => { const d = Number(r.overdue_days || 0); return d >= 84 && d <= 90; }).length;

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    ${_dashHeader()}
    ${_dashKpiRow(t, overdueAmt, receivable)}
    ${_dashWhoLate(rows)}
    ${_dashActionStrip(pdc, cross90, apprCount)}
    ${_dashInflow(months)}
  </div>`;
}

function _dashKpiRow(t, overdueAmt, receivable) {
  const cards = [
    NX.kpi({ label: 'Total Receivable',     value: _dashCompact(receivable) }),
    NX.kpi({ label: 'Overdue Today',        value: _dashCompact(overdueAmt) }),
    NX.kpi({ label: 'Due This Month',       value: _dashCompact(t.due) }),
    NX.kpi({ label: 'Collected This Month', value: _dashCompact(t.received_total) }),
    NX.kpi({ label: 'Recovery %',           value: _dashPct(t.recovery_pct) })
  ].join('');
  return `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:var(--fk-sp-3)">${cards}</div>`;
}

/* WHO IS LATE — the heart of the page */
function _dashWhoLate(rows) {
  const late = rows
    .filter(r => Number(r.overdue_days) > 0 && Number(r.closing) > 0)
    .sort((a, b) => Number(b.closing) - Number(a.closing))
    .slice(0, 10);
  const head = `<thead><tr>
    <th>Client</th><th>Unit</th><th class="num">Overdue</th><th>Days</th><th>Last payment</th>
  </tr></thead>`;
  let body;
  if (!late.length) {
    body = `<tbody><tr><td colspan="5">${NX.empty({ icon: 'check', message: 'Nothing overdue right now.' })}</td></tr></tbody>`;
  } else {
    body = '<tbody>' + late.map(r => {
      const tone = _dashRiskTone(r.overdue_days);
      const days = `<span class="nx-badge nx-badge--${tone}"><span class="nx-dot"></span>${Number(r.overdue_days || 0)}d</span>`;
      const last = r.last_payment_date
        ? `${esc(r.last_payment_date)} · <span class="num">${_dashExact(r.last_payment_amount)}</span>`
        : '—';
      const client = esc(r.client_name || '') + (r.client_code ? ` · ${esc(r.client_code)}` : '');
      const unit   = esc(r.unit_no || '') + (r.floor_name ? ` · ${esc(r.floor_name)}` : '');
      return `<tr style="cursor:pointer" onclick="nav('salesdetail','${esc(r.sale_id)}')">
        <td>${client}</td><td>${unit}</td>
        <td class="num">${_dashExact(r.closing)}</td><td>${days}</td><td>${last}</td></tr>`;
    }).join('') + '</tbody>';
  }
  return `<div class="nx-card nx-card--flush">
    <div class="nx-page-header" style="padding:var(--fk-sp-4) var(--fk-sp-4) 0;margin:0">
      <h2 class="nx-modal-title">Who is late</h2>
      <a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="nav('reports'); if(typeof openRptViewer==='function') setTimeout(function(){openRptViewer('recovery_position');},300)">View full Recovery Position report</a>
    </div>
    <table class="nx-table nx-table--flush">${head}${body}</table>
  </div>`;
}

/* ACTION STRIP — PDCs ≤7d · sales crossing 90d this week · pending approvals (if any) */
function _dashActionStrip(pdc, cross90, apprCount) {
  const card = (label, value, sub, onclick) =>
    `<div class="nx-card nx-card--compact" ${onclick ? `style="cursor:pointer" onclick="${onclick}"` : ''}>
      <div class="nx-kpi-label">${label}</div>
      <div class="nx-kpi-value num">${value}</div>
      ${sub ? `<div class="nx-kpi-label" style="text-transform:none">${sub}</div>` : ''}
    </div>`;
  const cards = [];
  if (pdc) cards.push(card('PDCs due ≤ 7 days', String(pdc.count),
    'PKR ' + _dashExact(pdc.amount), "nav('pdc')"));
  cards.push(card('Sales crossing 90 days', String(cross90), 'this week', "nav('reports')"));
  if (Number(apprCount) > 0) cards.push(card('Pending approvals', String(apprCount), 'awaiting you', "nav('approvals')"));
  return `<div style="display:grid;grid-template-columns:repeat(${cards.length},1fr);gap:var(--fk-sp-3)">${cards.join('')}</div>`;
}

/* INFLOW — collections last 6 months (flat token bars, no gradient) */
function _dashInflow(months) {
  const max = Math.max(1, ...months.map(m => m.collected));
  const bars = months.map(m => {
    const h = Math.round((m.collected / max) * 100);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:var(--fk-sp-2)">
      <div style="width:100%;height:120px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${h}%;min-height:2px;background:var(--fk-primary);border-radius:6px 6px 0 0"
             title="${esc(m.label)}: ${_dashExact(m.collected)}"></div>
      </div>
      <div class="num">${_dashCompact(m.collected)}</div>
      <div class="nx-kpi-label">${esc(m.label)}</div>
    </div>`;
  }).join('');
  return `<div class="nx-card">
    <div class="nx-kpi-label">Collections — last 6 months</div>
    <div style="display:flex;gap:var(--fk-sp-3);align-items:flex-end;margin-top:var(--fk-sp-3)">${bars}</div>
  </div>`;
}

/* ── action-strip loaders ─────────────────────────────────────────────────── */
async function _dashLoadPDC() {
  const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
  const end   = new Date(); end.setDate(end.getDate() + 7);
  const to    = end.toISOString().slice(0, 10);
  const { data } = await supabase.rpc('get_pdc_register', {
    p_company_id: S.cid, p_status: 'all', p_project_id: null, p_date_from: today, p_date_to: to
  });
  const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
  // status not yet cleared/bounced, cheque due within the window
  const open = rows.filter(r => {
    const st = String(r.status || '').toLowerCase();
    return st !== 'cleared' && st !== 'bounced' && st !== 'cancelled';
  });
  return { count: open.length, amount: open.reduce((s, r) => s + Number(r.amount || 0), 0) };
}
async function _dashLoadApprovals() {
  const { data } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.rows)) return data.rows.length;
  return 0;
}
// Total Receivable — Σ net_amount(active) − Σ payments(active sales). Non-aging
// contract metric (read-only RPC get_dashboard_receivable), distinct from the
// recovery rollforward, so it does not duplicate Overdue Today / closing.
async function _dashLoadReceivable() {
  const { data } = await supabase.rpc('get_dashboard_receivable', { p_company_id: S.cid, p_project_id: null });
  return Number((data && data.receivable) || 0);
}

/* ════════════════════════════════════════════════════════════════════════
   STAFF (recovery / accounts / finance / manager) — My-Day view
   Same header + company KPI shell, then three personal panels. Per-user
   attribution uses real fields only (contact_logs); the gaps are labelled
   honestly, never fabricated. See handoff: clients have no officer-assignment
   FK, and get_recovery_position exposes only an 'All Officers' aggregate.
   ════════════════════════════════════════════════════════════════════════ */
async function _dashStaff(pg, role) {
  const months = _dashMonths(1);
  const [rp, receivable] = await Promise.all([
    _dashRP(months[0].from, months[0].to),
    _dashLoadReceivable().catch(() => 0)
  ]);
  const t  = rp.totals || {};
  const rows = Array.isArray(rp.rows) ? rp.rows : [];
  const overdueAmt = rows.reduce((s, r) => s + (Number(r.overdue_days) > 0 ? Number(r.closing || 0) : 0), 0);

  const me   = S && (S.userId || '');
  const logs = Array.isArray(window._contactLogsCache) ? window._contactLogsCache : [];
  const mine = logs.filter(l => String(l.recovery_agent_id || l.created_by || '') === String(me));
  const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
  const followToday = mine.filter(l => String(l.next_followup_date || '').slice(0, 10) === today);

  // "Clients you've worked, in arrears" — contact_logs proxy ∩ RP arrears (honest label).
  const workedClientKeys = new Set(mine.map(l => String(l.client_id || l.client_code || l.sale_id || '')).filter(Boolean));
  const workedArrears = rows.filter(r => Number(r.closing) > 0 &&
    (workedClientKeys.has(String(r.sale_id)) || workedClientKeys.has(String(r.client_code)))).slice(0, 10);

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    ${_dashHeader()}
    ${_dashKpiRow(t, overdueAmt, receivable)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">
      ${_dashStaffFollowups(followToday)}
      ${_dashStaffWorked(workedArrears)}
    </div>
    ${_dashStaffRecoveries()}
  </div>`;
}

function _dashPanel(title, inner) {
  return `<div class="nx-card">
    <div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">${title}</div>${inner}</div>`;
}
function _dashStaffFollowups(list) {
  if (!list.length) return _dashPanel('My follow-ups today',
    NX.empty({ icon: 'check', message: 'No follow-ups scheduled for today.' }));
  const items = list.slice(0, 8).map(l =>
    `<tr style="cursor:pointer" onclick="nav('contacts')">
       <td>${esc(l.client_name || l.client_code || '—')}</td>
       <td>${esc(l.status_tag || l.call_status || '')}</td>
       <td class="num">${l.promise_amount ? _dashExact(l.promise_amount) : ''}</td>
     </tr>`).join('');
  return _dashPanel('My follow-ups today',
    `<table class="nx-table"><thead><tr><th>Client</th><th>Status</th><th class="num">Promise</th></tr></thead><tbody>${items}</tbody></table>`);
}
function _dashStaffWorked(rowsArr) {
  if (!rowsArr.length) return _dashPanel("Clients you've worked, in arrears",
    NX.empty({ icon: 'inbox', message: 'No arrears among clients you have logged contact with.' }));
  const items = rowsArr.map(r =>
    `<tr style="cursor:pointer" onclick="nav('salesdetail','${esc(r.sale_id)}')">
       <td>${esc(r.client_name || r.client_code || '—')}</td>
       <td class="num">${_dashExact(r.closing)}</td>
       <td><span class="nx-badge nx-badge--${_dashRiskTone(r.overdue_days)}"><span class="nx-dot"></span>${Number(r.overdue_days || 0)}d</span></td>
     </tr>`).join('');
  return _dashPanel("Clients you've worked, in arrears",
    `<table class="nx-table"><thead><tr><th>Client</th><th class="num">Overdue</th><th>Days</th></tr></thead><tbody>${items}</tbody></table>`);
}
function _dashStaffRecoveries() {
  // Attribution gap (reported): payments aren't broken down per user by the
  // recovery RPC (only an 'All Officers' aggregate), and there's no per-creator
  // read RPC. We render the panel structurally rather than fabricate a number.
  return _dashPanel('My recoveries this month',
    NX.empty({ icon: 'info', message: 'Per-officer recovery totals aren’t available yet — payments are not attributed per user in the recovery data. Tracked for Phase 3.' }));
}
