// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD 2.0 — "THE COMMAND VIEW" (2026-06-13)
// The single, role-aware home page on the foundation kit. Anatomy:
//   HERO (money picture: receivable + journey bar + overdue gauge) → 3 stat chips
//   → PULSE row (4 insight cards) → WORK GRID 2/3 Who-is-late + 1/3 gadget rail
//   (Aaj ka din · Aging donut · PDC pipeline · Inflow). Truth-law: every gadget
//   ⓘ formula-tipped, render-gated on real data, ZERO invented metrics.
//
// Every number is real and traceable:
//   • Hero journey + gauge          = get_dashboard_receivable (net/paid/receivable)
//                                     + get_recovery_position (overdue closing)
//   • Stat chips / Who-is-late / aging = get_recovery_position (MTD)
//   • Aaj ka din due+promises       = get_today_snapshot (thin read-only RPC)
//   • Aaj ka din received           = get_daily_collections (today)
//   • Inflow (6 mo)                 = get_recovery_position per month (cached)
//   • PDC pipeline                  = get_pdc_register (next 4 weeks)
//   • Pending approvals             = get_pending_approvals (count; hidden if 0)
// Motion: NX.animateCounts (count-up ≤400ms) + CSS one-shot fills; reduced-motion
// safe; no loops. Kit only: NX.* / .nx-* + --fk-* tokens. No hex/off-scale/emoji
// (the single >22px figure is the hero number, via --fk-fs-hero).
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
  if (projectId === undefined) projectId = (typeof activeProjectId === 'function' ? activeProjectId() : null);  // global project lens
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

/* ── get_daily_collections — per-day collected for a period (Pulse sparkline).
   Reconciles to get_recovery_position.received_total for the same period (proven
   in the migration cross-check). Per-session cached on the same store. ── */
async function _dashDaily(from, to, projectId) {
  if (projectId === undefined) projectId = (typeof activeProjectId === 'function' ? activeProjectId() : null);  // global project lens
  window._dashDayCache = window._dashDayCache || {};
  const key = `${S.cid}|${projectId || ''}|${from}|${to}`;
  if (window._dashDayCache[key]) return window._dashDayCache[key];
  const { data, error } = await supabase.rpc('get_daily_collections', {
    p_company_id: S.cid, p_project_id: projectId || null, p_from: from, p_to: to
  });
  if (error || !Array.isArray(data)) throw (error || new Error('daily collections unavailable'));
  window._dashDayCache[key] = data;
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
    <div class="nx-page-head-l">
      ${NX.ichip('layout-dashboard', '', { size:'lg' })}
      <div>
        <h1 class="nx-page-title">Dashboard</h1>
        <div class="nx-kpi-label" style="margin-top:4px">${esc(_dashMonthLabel())}</div>
      </div>
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
  // All RP month calls + receivable + today + PDC pipeline + approvals + the two
  // daily series (this MTD + last full month, for the pace sparkline) in parallel.
  const [rps, rec, today, pdc, apprCount, dailyThis, dailyLast, team] = await Promise.all([
    Promise.all(months.map(m => _dashRP(m.from, m.to))),
    _dashReceivable().catch(() => ({ receivable: 0, contracted: 0, collected: 0 })),
    _dashToday().catch(() => null),
    _dashLoadPdcPipeline().catch(() => null),
    _dashLoadApprovals().catch(() => 0),
    _dashDaily(months[5].from, months[5].to).catch(() => null),
    _dashDaily(months[4].from, months[4].to).catch(() => null),
    _dashTeam(months[5].from, months[5].to).catch(() => [])
  ]);
  months.forEach((m, i) => { m.collected = Number(rps[i].totals?.received_total || 0); });
  const rp     = rps[months.length - 1];            // current month MTD = source of truth
  const t      = rp.totals || {};
  const rows   = Array.isArray(rp.rows) ? rp.rows : [];
  const overdueAmt = rows.reduce((s, r) => s + (Number(r.overdue_days) > 0 ? Number(r.closing || 0) : 0), 0);
  // overdue-closing per month-end (same Σ closing WHERE overdue as the hero) for the
  // trend. Last element === overdueAmt by construction → cross-tie holds. Zero new RPC.
  const overdueSeries = rps.map(r => (Array.isArray(r.rows) ? r.rows : []).reduce((s, x) => s + (Number(x.overdue_days) > 0 ? Number(x.closing || 0) : 0), 0));
  const monLabels = months.map(m => m.label);

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    ${_dashHeader()}
    ${_dashHero(rec, overdueAmt, overdueSeries, monLabels)}
    ${_dashStatChips(t)}
    ${_dashPulse({ rps, months, t, rows, overdueAmt, dailyThis, dailyLast })}
    ${_dashRecoveryIQ(rows)}
    <div class="nx-workgrid" style="display:grid;grid-template-columns:2fr 1fr;gap:var(--fk-sp-4);align-items:start">
      <div style="display:flex;flex-direction:column;gap:var(--fk-sp-4);min-width:0">${_dashWhoLate(rows)}</div>
      <div style="display:flex;flex-direction:column;gap:var(--fk-sp-3);min-width:0">
        ${_dashApprovalsMini(apprCount)}
        ${_dashTeamPanel(team, dailyThis)}
        ${_dashTodayCard(today)}
        ${_dashAging(rows, overdueAmt)}
        ${_dashPdcPipeline(pdc)}
        ${_dashInflow(months)}
      </div>
    </div>
  </div>`;
  if (typeof NX.animateCounts === 'function') NX.animateCounts(pg);
}

/* ════════════════════════════════════════════════════════════════════════
   RECOVERY INTELLIGENCE band — the verdict (health grade) + behaviour split
   (Dead/Stalled/Active) + who-to-chase, computed from the already-loaded
   current-month RP rows (zero new RPC; month-rollforward closing == net
   recoverable). Links to the full Recovery Intelligence page. Position-only
   (no collection figures), so it stays consistent with the hero's overdue.
   Hidden when the book has no overdue.
   ════════════════════════════════════════════════════════════════════════ */
function _dashRecoveryIQ(rows) {
  const now = Date.now();
  const over = (rows || []).map(r => {
    const lp = r.last_payment_date ? new Date(String(r.last_payment_date) + 'T00:00:00').getTime() : null;
    return { sale_id: r.sale_id, client: r.client_name || '—', unit: r.unit_no || '—', phone: r.phone || '',
      arrears: Math.max(0, Number(r.closing || 0)), odd: Number(r.overdue_days || 0),
      paid: Number(r.paid_to_date || 0), ds: lp ? Math.floor((now - lp) / 86400000) : null };
  }).filter(r => r.odd > 0 && r.arrears > 0.5);
  if (!over.length) return '';
  const tot = over.reduce((s, r) => s + r.arrears, 0);
  const aged = over.filter(r => r.odd > 180).reduce((s, r) => s + r.arrears, 0);
  const agedPct = tot > 0 ? aged / tot : 0;
  const grade = agedPct >= 0.7 ? { w: 'Critical', t: 'danger' } : agedPct >= 0.5 ? { w: 'Strained', t: 'danger' } : agedPct >= 0.3 ? { w: 'Watch', t: 'warning' } : { w: 'Stable', t: 'success' };
  let dead = 0, stalled = 0, active = 0;
  over.forEach(r => { const s = (r.paid <= 0.5 || r.ds == null || r.ds >= 365) ? 'dead' : (r.ds >= 90 ? 'stalled' : 'active'); if (s === 'dead') dead += r.arrears; else if (s === 'stalled') stalled += r.arrears; else active += r.arrears; });
  const sTot = (dead + stalled + active) || 1;
  const seg = (v, c) => v > 0 ? `<div style="width:${(v / sTot * 100).toFixed(1)}%;background:var(--fk-${c})"></div>` : '';
  const lg = (c, l, v) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--fk-text-muted)"><i style="width:8px;height:8px;border-radius:2px;background:var(--fk-${c})"></i>${l} <b style="color:var(--fk-text)">${_dashCompact(v)}</b></span>`;
  const top = over.slice().sort((a, b) => b.arrears - a.arrears).slice(0, 3);
  const chase = (r, i) => { const ph = (r.phone || '').replace(/[^0-9]/g, '');
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;${i ? 'border-top:1px solid var(--fk-border)' : ''}">
      <div style="flex:1;min-width:0"><div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.client)}</div><div class="nx-kpi-label" style="text-transform:none">${esc(r.unit)} · ${r.odd}d</div></div>
      <div class="num" style="font-weight:600;font-size:12px;white-space:nowrap">${_dashCompact(r.arrears)}</div>
      ${ph ? `<a class="nx-btn nx-btn--ghost nx-btn--sm" target="_blank" href="https://wa.me/${ph}" title="WhatsApp">${NX.icon('message-circle', 13)}</a>` : '<span style="width:26px;flex-shrink:0"></span>'}</div>`; };
  return `<div class="nx-card nx-rise" style="padding:var(--fk-sp-6)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:var(--fk-sp-4)">
      ${NX.icon('radar', 18)}<span class="nx-kpi-label" style="text-transform:none;font-weight:600;color:var(--fk-text)">Recovery Intelligence</span>${NX.badge(grade.w, grade.t, { dot: true })}
      <a class="nx-btn nx-btn--ghost nx-btn--sm" style="margin-left:auto" onclick="nav('recoveryiq')">Open full intelligence ${NX.icon('arrow-right', 13)}</a></div>
    <div class="nx-riq-grid" style="display:grid;grid-template-columns:0.85fr 1.25fr 1fr;gap:var(--fk-sp-6);align-items:start">
      <div>
        <div class="nx-kpi-label" style="margin-bottom:7px">Overdue now</div>
        <div class="nx-hero-value" style="font-size:24px;line-height:1.05">${_dashCompact(tot)}</div>
        <div class="nx-kpi-label" style="text-transform:none;margin-top:5px">${over.length} units · ${Math.round(agedPct * 100)}% is 180+ days aged</div>
      </div>
      <div>
        <div class="nx-kpi-label" style="margin-bottom:7px">By behaviour</div>
        <div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--fk-bg-subtle);margin-bottom:9px">${seg(dead, 'danger')}${seg(stalled, 'warning')}${seg(active, 'success')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 16px">${lg('danger', 'Dead', dead)}${lg('warning', 'Stalled', stalled)}${lg('success', 'Active', active)}</div>
        ${stalled > 0 ? `<div class="nx-kpi-label" style="text-transform:none;margin-top:9px">Priority: ${_dashCompact(stalled)} stalled — re-engage before they turn dead.</div>` : ''}
      </div>
      <div>
        <div class="nx-kpi-label" style="margin-bottom:3px">Chase first</div>
        <div>${top.map(chase).join('')}</div>
      </div>
    </div>
    <style>@media(max-width:860px){.nx-riq-grid{grid-template-columns:1fr!important;gap:var(--fk-sp-4)!important}}</style>
  </div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   HERO — "the money picture": receivable + journey bar (left) · overdue gauge
   (right). Every number cross-ties: journey Σ = contracted; gauge = overdue/recv.
   ════════════════════════════════════════════════════════════════════════ */
function _dashHero(rec, overdueAmt, series, labels) {
  const future = Math.max(0, rec.receivable - overdueAmt);
  const pct = rec.receivable > 0 ? (overdueAmt / rec.receivable * 100) : 0;
  const collPct = rec.contracted > 0 ? (rec.collected / rec.contracted * 100) : 0;
  const tip = 'Contracted (Σ net of active sales) = Collected (Σ payments) + Receivable. ' +
    'Receivable = Overdue (past due) + Future (not yet due). Source: get_dashboard_receivable + recovery position.';
  return `<div class="nx-card nx-rise nx-dash-hero" style="padding:var(--fk-sp-6);display:grid;grid-template-columns:1.55fr 1fr;gap:var(--fk-sp-6);align-items:stretch">
    <div style="min-width:0;display:flex;flex-direction:column;justify-content:center">
      <div class="nx-kpi-label" style="display:flex;align-items:center">Total receivable${NX.infoTip(tip)}</div>
      <div class="nx-hero-value" style="margin:10px 0 6px">${_dashCompact(rec.receivable)}</div>
      <div class="nx-kpi-label" style="text-transform:none;margin-bottom:var(--fk-sp-4)">${_dashCompact(rec.collected)} collected of ${_dashCompact(rec.contracted)} contracted · ${collPct.toFixed(0)}%</div>
      ${NX.journeybar({ height: 10, segments: [
        { value: rec.collected, tone: 'primary', label: 'Collected', amount: _dashCompact(rec.collected) },
        { value: overdueAmt,    tone: 'danger',  label: 'Overdue',   amount: _dashCompact(overdueAmt) },
        { value: future,        tone: 'muted',   label: 'Future',    amount: _dashCompact(future) }
      ] })}
    </div>
    <div style="display:flex;flex-direction:column;justify-content:center;padding-left:var(--fk-sp-6);border-left:1px solid var(--fk-border)">
      ${_dashOverdueTrend(overdueAmt, pct, series, labels)}
    </div>
  </div>`;
}

/* the hero's right side — OVERDUE TREND: is the stuck money growing or shrinking?
   ≥3 months → delta chip + area/line trend (last point === Overdue Today); below
   that → plain stat + caption. Data is the 6 already-cached RPs (zero new RPC). */
function _dashOverdueTrend(overdueAmt, pct, series, labels) {
  const ttip = 'Month-end recoverable (Σ closing of sales past their due date) per the recovery-position rollforward, last 6 months + today.';
  const caption = `Overdue today ${_dashCompact(overdueAmt)} · ${pct.toFixed(1)}% of book`;
  series = Array.isArray(series) ? series : [];
  if (series.length < 3) {
    // render-gate fallback — the old gauge's facts as a quiet stat
    return `<div class="nx-kpi-label" style="display:flex;align-items:center">Overdue today${NX.infoTip(ttip)}</div>
      <div class="nx-hero-value" style="color:var(--fk-danger);margin:10px 0 6px">${pct.toFixed(0)}%</div>
      <div class="nx-kpi-label" style="text-transform:none">${_dashCompact(overdueAmt)} of the book past its due date</div>`;
  }
  const last = series[series.length - 1], prev = series[series.length - 2];
  const delta = last - prev, up = delta >= 0;
  const prevLabel = (labels && labels[labels.length - 2]) || 'last month';
  const deltaChip = `<span class="nx-badge nx-badge--${up ? 'danger' : 'success'}">${up ? '▲' : '▼'} ${up ? '+' : '−'}${_dashCompact(Math.abs(delta))} vs ${esc(prevLabel)}</span>`;
  return `<div class="nx-kpi-label" style="display:flex;align-items:center">Overdue trend${NX.infoTip(ttip)}</div>
    <div style="margin:8px 0 6px">${deltaChip}</div>
    ${NX.trendline({ series, tone: 'danger' })}
    <div class="nx-kpi-label" style="text-transform:none;margin-top:6px">${caption}</div>`;
}

/* three quiet inline stats under the hero — borderless, hairline-separated (airy) */
function _dashStatChips(t) {
  const stat = (label, val) => `<div style="flex:1;padding:0 var(--fk-sp-4)">
    <div class="nx-statchip-l">${label}</div>
    <div class="nx-statchip-v" style="font-size:var(--fk-fs-kpi);margin-top:3px">${val}</div></div>`;
  const div = '<div style="width:1px;align-self:stretch;background:var(--fk-border)"></div>';
  return `<div class="nx-card nx-dash-stats" style="display:flex;align-items:center;padding:var(--fk-sp-4) var(--fk-sp-2)">
    ${stat('Due this month', _dashCompact(t.due))}${div}${stat('Collected this month', _dashCompact(t.received_total))}${div}${stat('Recovery rate', _dashPct(t.recovery_pct))}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   PULSE STRIP — 3–4 compact insight cards. Each: real RPC data · ⓘ formula ·
   renders only if its backing data exists · one sharp sentence + one micro-viz.
   ════════════════════════════════════════════════════════════════════════ */
function _dashDaysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function _dashSumDaily(arr) { return (arr || []).reduce((s, x) => s + Number(x.amount || 0), 0); }
function _dashCumByDay(arr, n) {                 // sparse [{day,amount}] -> cumulative[1..n]
  const m = {}; (arr || []).forEach(d => { const k = Number(String(d.day).slice(8, 10)); m[k] = (m[k] || 0) + Number(d.amount || 0); });
  const out = []; let run = 0;
  for (let i = 1; i <= n; i++) { run += (m[i] || 0); out.push(run); }
  return out;
}
function _dashSet90(rp) {                          // sale_ids with 90+ days overdue & balance
  const rows = Array.isArray(rp && rp.rows) ? rp.rows : [], s = new Set();
  rows.forEach(r => { if (Number(r.overdue_days || 0) >= 90 && Number(r.closing || 0) > 0) s.add(String(r.sale_id)); });
  return s;
}

function _dashPulse(ctx) {
  const { rps, months, t, rows, overdueAmt, dailyThis, dailyLast } = ctx;
  const now = new Date(), daysElapsed = now.getDate(), dim = _dashDaysInMonth(now);
  const collected = Number(months[5].collected || 0), lastTotal = Number(months[4].collected || 0);
  const cards = [];

  // 1 · COLLECTION PACE (needs MTD + a prior full month to compare against)
  if (collected > 0 && lastTotal > 0) {
    const pace = collected / daysElapsed * dim;
    const head = `<strong>PKR ${_dashCompact(collected)}</strong> by day ${daysElapsed} — at this pace `
      + `${esc(months[5].label)} closes <strong>~${_dashCompact(pace)}</strong> vs ${esc(months[4].label)}'s ${_dashCompact(lastTotal)}`;
    // Cross-check the series against the KPI; only draw the line if it reconciles.
    const okThis = dailyThis && Math.abs(_dashSumDaily(dailyThis) - collected) <= 1;
    const okLast = dailyLast && Math.abs(_dashSumDaily(dailyLast) - lastTotal) <= 1;
    let viz;
    if (okThis && okLast) {
      const lastLen = _dashDaysInMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      viz = NX.sparkline({
        series: [_dashCumByDay(dailyThis, daysElapsed), _dashCumByDay(dailyLast, lastLen)],
        colors: ['var(--fk-primary)', 'var(--fk-text-muted)'], spanMax: Math.max(dim, lastLen), height: 32
      }) + `<div class="nx-kpi-label" style="display:flex;gap:var(--fk-sp-3);text-transform:none;margin-top:4px">
        <span style="color:var(--fk-primary)">— ${esc(months[5].label)}</span><span>- - ${esc(months[4].label)}</span></div>`;
    } else {
      viz = _dashPaceBar(collected, pace, lastTotal, months);   // arithmetic fallback (no lying line)
    }
    cards.push(_dashPulseCard('Collection pace',
      'pace = collected ÷ days elapsed × days in month (arithmetic projection, not a forecast)', head, viz));
  }

  // 2 · RISK CONCENTRATION (needs overdue balance)
  if (overdueAmt > 0) {
    const overdue = rows.filter(r => Number(r.overdue_days) > 0 && Number(r.closing) > 0)
      .sort((a, b) => Number(b.closing) - Number(a.closing));
    const top10 = overdue.slice(0, 10).reduce((s, r) => s + Number(r.closing || 0), 0);
    const pct = overdueAmt > 0 ? (top10 / overdueAmt * 100) : 0;
    const head = `Top 10 defaulters hold <strong>PKR ${_dashCompact(top10)}</strong> — <strong>${pct.toFixed(0)}%</strong> of all overdue`;
    const viz = NX.minibar({ a: top10, b: Math.max(0, overdueAmt - top10), toneA: 'danger' })
      + `<div class="nx-kpi-label" style="text-transform:none;margin-top:4px">Top 10 vs rest of overdue</div>`;
    cards.push(_dashPulseCard('Risk concentration',
      'Σ closing of the 10 largest overdue sales ÷ Σ closing of all overdue sales (= Overdue Today)', head, viz));
  }

  // 3 · RECOVERY MIX (needs collections this month)
  const rt = Number(t.received_total || 0);
  if (rt > 0) {
    const segOld = Number(t.r_old || 0), segCur = Number(t.r_cur || 0) + Number(t.r_dp || 0), segAdv = Number(t.r_advance || 0);
    const other = rt - (segOld + segCur + segAdv);
    const segs = [{ value: segOld, tone: 'danger' }, { value: segCur, tone: 'primary' }, { value: segAdv, tone: 'success' }];
    if (Math.abs(other) > 0.005) segs.push({ value: Math.max(0, other), tone: 'info' });   // never hide a paisa
    const pctOld = (segOld / rt * 100);
    const head = `<strong>${pctOld.toFixed(0)}%</strong> of this month's collections cleared <strong>old arrears</strong>`;
    const viz = NX.stackbar({ segments: segs })
      + `<div class="nx-kpi-label" style="display:flex;gap:var(--fk-sp-3);text-transform:none;margin-top:4px">
        <span style="color:var(--fk-danger)">Old</span><span style="color:var(--fk-primary)">Current</span><span style="color:var(--fk-success)">Advance</span></div>`;
    cards.push(_dashPulseCard('Recovery mix',
      'Old arrears (r_old) · Current dues + down-payment (r_cur+r_dp) · Advance (r_advance) — segments sum to received_total', head, viz));
  }

  // 4 · 90-DAY DRIFT (needs any 90+ membership at either as-of date)
  const setStart = _dashSet90(rps[4]), setNow = _dashSet90(rps[5]);
  if (setStart.size || setNow.size) {
    let inN = 0, outN = 0;
    setNow.forEach(id => { if (!setStart.has(id)) inN++; });
    setStart.forEach(id => { if (!setNow.has(id)) outN++; });
    const head = `<strong>${inN}</strong> sales crossed 90 days this month · <strong>${outN}</strong> recovered out`;
    const viz = `<div style="display:flex;gap:var(--fk-sp-4);margin-top:2px">
      <span class="nx-badge nx-badge--danger"><span class="nx-dot"></span>${inN} in</span>
      <span class="nx-badge nx-badge--success"><span class="nx-dot"></span>${outN} out</span></div>`;
    cards.push(_dashPulseCard('90-day drift',
      'Sales at 90+ days overdue: newly entered (now − month-start) vs left the set = paid down (month-start − now)', head, viz));
  }

  if (!cards.length) return '';
  return `<div class="nx-pulse-grid" style="grid-template-columns:repeat(${cards.length},minmax(0,1fr))">${cards.join('')}</div>`;
}

function _dashPulseCard(title, tip, headlineHTML, footHTML, icon, tone) {
  const chip = icon ? NX.ichip(icon, tone || '', { size: 'sm' }) : '';
  return `<div class="nx-card nx-card--compact nx-pulse-card">
    <div class="nx-kpi-label" style="display:flex;align-items:center;gap:var(--fk-sp-2)">${chip}<span style="display:inline-flex;align-items:center">${esc(title)}${NX.infoTip(tip)}</span></div>
    <div class="nx-pulse-headline" style="margin-top:6px">${headlineHTML}</div>
    ${footHTML ? `<div style="margin-top:var(--fk-sp-2)">${footHTML}</div>` : ''}
  </div>`;
}

/* Pace-bar fallback — pure arithmetic, drawn only when the daily series fails to
   reconcile to the KPI (so we never draw a misleading cumulative line). MTD fill,
   dotted projection cap, last-month tick. */
function _dashPaceBar(collected, pace, lastTotal, months) {
  const W = 132, H = 12, max = Math.max(pace, lastTotal, collected, 1);
  const cw = collected / max * W, px = pace / max * W, lx = lastTotal / max * W, r = H / 2;
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" style="width:100%">
    <rect x="0" y="0" width="${W}" height="${H}" rx="${r}" fill="var(--fk-border)"/>
    <rect x="0" y="0" width="${cw.toFixed(1)}" height="${H}" rx="${r}" fill="var(--fk-primary)"/>
    <line x1="${px.toFixed(1)}" y1="0" x2="${px.toFixed(1)}" y2="${H}" stroke="var(--fk-primary)" stroke-width="1.5" stroke-dasharray="2 2"/>
    <line x1="${lx.toFixed(1)}" y1="0" x2="${lx.toFixed(1)}" y2="${H}" stroke="var(--fk-text-muted)" stroke-width="1.5"/>
  </svg>`;
  return svg + `<div class="nx-kpi-label" style="display:flex;gap:var(--fk-sp-3);text-transform:none;margin-top:4px">
    <span style="color:var(--fk-primary)">MTD</span><span style="color:var(--fk-primary)">··· projected</span><span>| ${esc(months[4].label)}</span></div>`;
}

/* ── GADGET RAIL (right 1/3) ──────────────────────────────────────────── */

// quiet initials avatar — single neutral tone (premium restraint, no rainbow)
function _dashAvatar(name) {
  const parts = String(name || '—').trim().split(/\s+/);
  const ini = (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase() || '—';
  return `<span class="nx-avatar" style="background:var(--fk-bg-subtle);color:var(--fk-text-muted)">${esc(ini)}</span>`;
}

// a. AAJ KA DIN — due today · received today · promises due today
function _dashTodayCard(today) {
  if (!today) return '';
  const tip = 'Due today = Σ outstanding of installments dated today (get_today_snapshot). ' +
    'Received today = get_daily_collections for today. Promises = contact_logs with next-followup today.';
  const names = (today.promiseNames && today.promiseNames.length) ? today.promiseNames.join(', ') : 'No names on file';
  const line = (label, valHTML, extra, last) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--fk-sp-2);padding:7px 0${last ? '' : ';border-bottom:1px solid var(--fk-border)'}">
    <span class="nx-kpi-label" style="text-transform:none">${label}</span><span style="display:flex;align-items:baseline;gap:6px">${valHTML}${extra || ''}</span></div>`;
  const body =
    line('Due today', `<span class="nx-statchip-v">${_dashCompact(today.due)}</span>`, today.dueCount ? `<span class="nx-kpi-label">${today.dueCount} inst.</span>` : '') +
    line('Received today', `<span class="nx-statchip-v">${_dashCompact(today.received)}</span>`, '') +
    line('Promises due', `<span class="nx-statchip-v" title="${esc(names)}">${today.promises}</span>`, '', true);
  return NX.card(`<div style="margin-top:var(--fk-sp-1)">${body}</div>`,
    { class: 'nx-rise', header: { icon: 'sunrise', tone: '', title: 'Today', sub: 'Today at a glance', actions: NX.infoTip(tip) } });
}

// b. AGING DONUT — closing split by overdue age; click → Aging report
function _dashAging(rows, overdueAmt) {
  if (!(overdueAmt > 0)) return '';
  const b = [0, 0, 0, 0];
  rows.forEach(r => {
    const d = Number(r.overdue_days || 0), c = Number(r.closing || 0);
    if (c <= 0 || d <= 0) return;
    if (d <= 30) b[0] += c; else if (d <= 60) b[1] += c; else if (d <= 90) b[2] += c; else b[3] += c;
  });
  const segs = [
    { value: b[0], tone: 'muted',   label: '0–30 days',  amount: _dashCompact(b[0]) },
    { value: b[1], tone: 'warning', label: '31–60 days', amount: _dashCompact(b[1]) },
    { value: b[2], tone: 'warning', label: '61–90 days', amount: _dashCompact(b[2]) },
    { value: b[3], tone: 'danger',  label: '90+ days',   amount: _dashCompact(b[3]) }
  ];
  const tip = 'Σ closing grouped by overdue age (0–30 / 31–60 / 61–90 / 90+). Sums to Overdue Today.';
  const dotCol = tone => tone === 'muted' ? 'var(--fk-muted-fill)' : `var(--fk-${tone})`;
  const bar = NX.stackbar({ segments: segs, height: 10 });
  const legend = segs.map(s => `<div class="nx-jl" style="justify-content:flex-start;width:100%">
    <span class="nx-jl-dot" style="background:${dotCol(s.tone)}"></span>
    <span class="nx-jl-t" style="text-transform:none;letter-spacing:0;font-weight:var(--fk-fw-medium);color:var(--fk-text-muted)">${s.label}</span>
    <span class="nx-jl-a num" style="margin-left:auto">${s.amount}</span></div>`).join('');
  const inner = `<div style="margin-top:var(--fk-sp-2)">${bar}
    <div style="display:flex;flex-direction:column;gap:7px;margin-top:var(--fk-sp-3)">${legend}</div></div>`;
  const card = NX.card(inner, { hover: true, header: { title: 'Aging', sub: _dashCompact(overdueAmt) + ' overdue', actions: NX.infoTip(tip) } });
  return `<div class="nx-rise" style="cursor:pointer" onclick="nav('reports');if(typeof openRptViewer==='function')setTimeout(function(){openRptViewer('aging')},300)">${card}</div>`;
}

// c. PDC PIPELINE — next 4 weeks' maturing cheques, or a useful empty state
function _dashPdcPipeline(pipe) {
  const tip = 'Open cheques in hand maturing in the next 4 weeks (get_pdc_register), bucketed by week.';
  if (!pipe || !pipe.count) {
    return NX.card(NX.empty({ icon: 'calendar-clock', message: 'No cheques in hand — record PDCs to see your paper pipeline.', action: NX.button('Add PDC', { variant: 'secondary', size: 'sm', icon: 'plus', onclick: "nav('pdc')" }) }),
      { class: 'nx-rise', header: { icon: 'calendar-clock', title: 'PDC pipeline', actions: NX.infoTip(tip) } });
  }
  const max = Math.max(1, ...pipe.weeks.map(w => w.amount));
  const bars = pipe.weeks.map(w => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
    <div style="width:100%;height:56px;display:flex;align-items:flex-end"><div style="width:100%;height:${Math.round(w.amount / max * 100)}%;min-height:2px;background:var(--fk-info);border-radius:4px 4px 0 0"></div></div>
    <div class="num" style="font-size:var(--fk-fs-label);color:var(--fk-text)">${w.count ? _dashCompact(w.amount) : '—'}</div>
    <div class="nx-kpi-label">${w.label}</div></div>`).join('');
  return NX.card(`<div style="display:flex;gap:var(--fk-sp-2);align-items:flex-end;margin-top:var(--fk-sp-2)">${bars}</div>`,
    { class: 'nx-rise', header: { icon: 'calendar-clock', title: 'PDC pipeline', sub: _dashCompact(pipe.amount) + ' in hand', actions: NX.infoTip(tip) } });
}

// pending approvals — small actionable card, hidden when none
function _dashApprovalsMini(n) {
  if (!(Number(n) > 0)) return '';
  return NX.card(`<div style="display:flex;align-items:center;gap:var(--fk-sp-3)">${NX.ichip('check', 'info', {})}
    <div style="min-width:0"><div class="nx-statchip-l">Pending approvals</div><div class="nx-statchip-v num">${Number(n)}</div></div>
    <a class="nx-btn nx-btn--ghost nx-btn--sm" style="margin-left:auto" onclick="nav('approvals')">Open</a></div>`,
    { class: 'nx-rise nx-card--hover', compact: true });
}

/* RECOVERY TEAM — compact admin-only officer leaderboard (this month), top by
   recovered, with the fair keep-rate. Company collected-trend sparkline reuses
   the already-fetched daily series (get_daily_collections — zero new RPC on the
   trend). RENDER-GATED: hidden entirely when no officer has activity (the FG
   reality today), so it never shows an empty shell. */
async function _dashTeam(from, to) {
  const { data, error } = await supabase.rpc('get_team_performance', {
    p_company_id: S.cid, p_project_id: (typeof activeProjectId === 'function' ? activeProjectId() : null), p_from: from, p_to: to
  });
  if (error || !Array.isArray(data)) throw (error || new Error('team performance unavailable'));
  return data;
}

function _dashTeamPanel(officers, dailyThis) {
  const active = (officers || []).filter(o =>
    (Number(o.calls) || 0) + (Number(o.visits) || 0) + (Number(o.promises_made) || 0) + (Number(o.recovered) || 0) > 0);
  if (!active.length) return '';                          // RENDER-GATE — no activity ⇒ no panel

  const top = active.slice().sort((a, b) => (Number(b.recovered) || 0) - (Number(a.recovered) || 0)).slice(0, 5);
  const tip = 'Recovered = Σ receipts on each officer’s assigned projects this month (gross). ' +
    'Keep-rate = promises kept ÷ matured. Σ officer recovered reconciles to the company collected. Source: get_team_performance.';

  const rowsHtml = top.map(o => {
    const nm = o.full_name || '—', initial = (String(nm).trim()[0] || '?').toUpperCase();
    const rec = Number(o.recovered) || 0;
    const fair = o.keep_rate_matured;
    const keepChip = (fair == null)
      ? '<span class="nx-kpi-label" style="text-transform:none">no promises</span>'
      : NX.badge(Math.round(Number(fair)) + '%', Number(fair) >= 70 ? 'success' : Number(fair) >= 40 ? 'warning' : 'danger');
    return `<div style="display:flex;align-items:center;gap:var(--fk-sp-3);padding:6px 0">
      <span class="nx-avatar" style="background:var(--fk-primary-chip);color:var(--fk-primary)">${esc(initial)}</span>
      <span style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fk-text)">${esc(nm)}</span>
      <span class="num" style="color:var(--fk-text);font-variant-numeric:tabular-nums">${_dashCompact(rec)}</span>
      <span style="width:48px;text-align:right">${keepChip}</span>
    </div>`;
  }).join('');

  // Company collected trend (cumulative MTD) — reuse dailyThis; render-gate ≥3 pts.
  let spark = '';
  const days = new Date().getDate();
  const cum = (typeof _dashCumByDay === 'function' && dailyThis) ? _dashCumByDay(dailyThis, days) : [];
  if (cum.length >= 3) {
    spark = `<div style="margin-top:var(--fk-sp-3);border-top:1px solid var(--fk-border);padding-top:var(--fk-sp-3)">
      <div class="nx-kpi-label" style="text-transform:none;margin-bottom:4px">Company collected — this month</div>
      ${NX.sparkline({ series: [cum], colors: ['var(--fk-primary)'], height: 30 })}</div>`;
  }

  const header = `<div style="display:flex;align-items:center;gap:var(--fk-sp-2);margin-bottom:var(--fk-sp-2)">
    ${NX.ichip('users', '', {})}
    <span class="nx-statchip-l" style="display:flex;align-items:center">Recovery team${NX.infoTip(tip)}</span>
    <a class="nx-btn nx-btn--ghost nx-btn--sm" style="margin-left:auto" onclick="nav('team')">View</a></div>`;

  return NX.card(header + rowsHtml + spark, { class: 'nx-rise nx-card--hover', compact: true });
}

/* WHO IS LATE — the heart of the page */
function _dashWhoLate(rows) {
  const late = rows
    .filter(r => Number(r.overdue_days) > 0 && Number(r.closing) > 0)
    .sort((a, b) => Number(b.closing) - Number(a.closing))
    .slice(0, 10);
  const head = `<thead><tr>
    <th>Client</th><th>Unit</th><th class="num">Overdue</th><th>Days</th><th>Last payment</th><th></th>
  </tr></thead>`;
  let body;
  if (!late.length) {
    body = `<tbody><tr><td colspan="6">${NX.empty({ icon: 'check', message: 'Nothing overdue right now.' })}</td></tr></tbody>`;
  } else {
    body = '<tbody>' + late.map(r => {
      const tone = _dashRiskTone(r.overdue_days);
      const days = `<span class="nx-badge nx-badge--${tone}"><span class="nx-dot"></span>${Number(r.overdue_days || 0)}d</span>`;
      const last = r.last_payment_date
        ? `${esc(r.last_payment_date)} · <span class="num">${_dashExact(r.last_payment_amount)}</span>`
        : '—';
      const client = esc(r.client_name || '') + (r.client_code ? ` · ${esc(r.client_code)}` : '');
      const unit   = esc(r.unit_no || '') + (r.floor_name ? ` · ${esc(r.floor_name)}` : '');
      return `<tr class="nx-late-row" style="cursor:pointer" onclick="openSaleDetail('${esc(r.sale_id)}')">
        <td><div style="display:flex;align-items:center;gap:var(--fk-sp-2)">${_dashAvatar(r.client_name)}<span style="min-width:0">${client}</span></div></td>
        <td>${unit}</td>
        <td class="num">${_dashExact(r.closing)}</td><td>${days}</td><td>${last}</td>
        <td style="text-align:right">${_dashLateActions(r)}</td></tr>`;
    }).join('') + '</tbody>';
  }
  return `<div class="nx-card nx-card--flush">
    <div class="nx-card-hd">
      ${NX.ichip('alert-triangle', 'danger', {})}
      <div class="nx-card-hd-t">Who is late</div>
      <div class="nx-card-hd-a"><a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="nav('reports'); if(typeof openRptViewer==='function') setTimeout(function(){openRptViewer('recovery_position');},300)">View full Recovery Position report</a></div>
    </div>
    <table class="nx-table nx-table--flush nx-table--static">${head}${body}</table>
  </div>`;
}

/* row-hover quick actions on Who-is-late — Call (tel) · WhatsApp (wa.me) · Log
   promise (openConModal). Phone comes from the recovery-position row. */
function _dashLateActions(r) {
  const ph = String(r.phone || '').replace(/[^0-9]/g, '');
  const tel = r.phone ? `<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call ${esc(r.phone)}" href="tel:${esc(r.phone)}" onclick="event.stopPropagation()">${NX.icon('phone', 15)}</a>` : '';
  const wa  = ph ? `<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/${ph}" onclick="event.stopPropagation()">${NX.icon('message-circle', 15)}</a>` : '';
  const log = `<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Log a call / promise" onclick="event.stopPropagation();if(typeof openConModal==='function')openConModal(null)">${NX.icon('check', 15)}</button>`;
  return `<span class="nx-rowact">${tel}${wa}${log}</span>`;
}

/* INFLOW — collections last 6 months (flat token bars, no gradient). The current
   month's bar carries a dotted projection cap at the same pace as Pulse card 1. */
function _dashInflow(months) {
  const now = new Date(), daysElapsed = now.getDate(), dim = _dashDaysInMonth(now);
  const cur = months[months.length - 1];
  const pace = daysElapsed > 0 ? (Number(cur.collected || 0) / daysElapsed * dim) : 0;
  const max = Math.max(1, ...months.map(m => m.collected), pace);
  const BARH = 120;
  const bars = months.map(m => {
    const h = Math.round((m.collected / max) * 100);
    let cap = '';
    if (m.current && pace > m.collected) {
      const capPct = Math.min(100, pace / max * 100);
      cap = `<div title="At current pace: ${_dashExact(pace)}"
        style="position:absolute;left:0;right:0;bottom:${capPct}%;border-top:2px dotted var(--fk-primary);opacity:.7"></div>
        <div style="position:absolute;left:0;right:0;bottom:calc(${capPct}% + 2px);text-align:center;font-size:11px;color:var(--fk-text-muted)">~${_dashCompact(pace)}</div>`;
    }
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:var(--fk-sp-2)">
      <div style="position:relative;width:100%;height:${BARH}px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${h}%;min-height:2px;background:var(--fk-primary);border-radius:6px 6px 0 0${m.current ? ';opacity:.92' : ''}"
             title="${esc(m.label)}: ${_dashExact(m.collected)}"></div>
        ${cap}
      </div>
      <div class="num">${_dashCompact(m.collected)}</div>
      <div class="nx-kpi-label">${esc(m.label)}</div>
    </div>`;
  }).join('');
  return `<div class="nx-card">
    <div style="display:flex;align-items:center;gap:var(--fk-sp-2)">${NX.ichip('bar-chart-3', '', { size: 'sm' })}<span class="nx-kpi-label">Collections — last 6 months${pace > cur.collected ? ' · dotted = current-pace projection' : ''}</span></div>
    <div style="display:flex;gap:var(--fk-sp-3);align-items:flex-end;margin-top:var(--fk-sp-3)">${bars}</div>
  </div>`;
}

/* ── loaders ──────────────────────────────────────────────────────────────── */
async function _dashLoadApprovals() {
  const { data } = await supabase.rpc('get_pending_approvals', { p_filters: {} });
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.rows)) return data.rows.length;
  return 0;
}
// The money picture — get_dashboard_receivable returns net_active (Contracted),
// paid_active (Collected) and receivable (= net − paid). One RPC powers the whole
// hero journey bar + gauge. Non-aging contract metric, distinct from the recovery
// rollforward so it never double-counts Overdue Today / closing.
async function _dashReceivable() {
  const { data } = await supabase.rpc('get_dashboard_receivable', { p_company_id: S.cid, p_project_id: (typeof activeProjectId === 'function' ? activeProjectId() : null) });
  return {
    receivable: Number((data && data.receivable) || 0),
    contracted: Number((data && data.net_active) || 0),
    collected:  Number((data && data.paid_active) || 0)
  };
}

// AAJ KA DIN — the morning glance. due_today + promises_today come from the thin
// read-only get_today_snapshot (installments have no other read RPC); received
// today reuses get_daily_collections (proven to reconcile to RP received_total).
async function _dashToday() {
  const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
  const [snap, daily] = await Promise.all([
    supabase.rpc('get_today_snapshot', { p_company_id: S.cid, p_project_id: (typeof activeProjectId === 'function' ? activeProjectId() : null), p_today: today }).then(r => r.data).catch(() => null),
    _dashDaily(today, today).catch(() => null)
  ]);
  const s = snap || {};
  return {
    due:          Number(s.due_today || 0),
    dueCount:     Number(s.due_today_count || 0),
    received:     daily ? daily.reduce((a, x) => a + Number(x.amount || 0), 0) : 0,
    promises:     Number(s.promises_today || 0),
    promiseNames: Array.isArray(s.promise_names) ? s.promise_names : []
  };
}

// PDC pipeline — open cheques maturing in the next 4 weeks, bucketed by week.
async function _dashLoadPdcPipeline() {
  const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
  const end = new Date(); end.setDate(end.getDate() + 28);
  const to = end.toISOString().slice(0, 10);
  const { data } = await supabase.rpc('get_pdc_register', {
    p_company_id: S.cid, p_status: 'all', p_project_id: (typeof activeProjectId === 'function' ? activeProjectId() : null), p_date_from: today, p_date_to: to
  });
  const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
  const open = rows.filter(r => { const st = String(r.status || '').toLowerCase(); return st !== 'cleared' && st !== 'bounced' && st !== 'cancelled'; });
  const weeks = [0, 1, 2, 3].map(i => ({ label: 'W' + (i + 1), count: 0, amount: 0 }));
  const t0 = new Date(today);
  open.forEach(r => {
    const d = r.cheque_date || r.due_date || r.maturity_date || r.deposit_date;
    if (!d) return;
    const wi = Math.floor((new Date(d) - t0) / (7 * 864e5));
    if (wi >= 0 && wi < 4) { weeks[wi].count++; weeks[wi].amount += Number(r.amount || 0); }
  });
  return { count: open.length, amount: open.reduce((s, r) => s + Number(r.amount || 0), 0), weeks };
}

/* ════════════════════════════════════════════════════════════════════════
   STAFF (recovery / accounts / finance / manager) — My-Day view
   Same header + company KPI shell, then three personal panels. Per-user
   attribution uses real fields only (contact_logs); the gaps are labelled
   honestly, never fabricated. See handoff: clients have no officer-assignment
   FK, and get_recovery_position exposes only an 'All Officers' aggregate.
   ════════════════════════════════════════════════════════════════════════ */
async function _dashStaff(pg, role) {
  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">${_dashSkeleton()}</div>`;
  // Recovery officers: the dashboard IS their working recovery report (live figures + table).
  if (role === 'recovery' || role === 'recovery_officer') { return _dashRecoveryReport(pg); }
  // Accounts / finance are DATA-ENTRY roles, not recovery officers — give them a plain
  // quick-actions home (their permitted modules), never the recovery call-list view.
  if (role === 'accounts' || role === 'finance') { return _dashAccountsHome(pg, role); }
  let q = {}, alerts = { total: 0, items: [] };
  try {
    const proj = (typeof activeProjectId === 'function' ? activeProjectId() : null);
    const [qr, ar] = await Promise.all([
      supabase.rpc('get_recovery_queue', { p_company_id: S.cid, p_officer_id: null, p_project_id: proj, p_date: null, p_limit: 200 }),
      supabase.rpc('get_recovery_alerts', { p_company_id: S.cid })
    ]);
    if (qr.error) throw qr.error;
    q = qr.data || {};
    alerts = (ar && !ar.error && ar.data) ? ar.data : { total: 0, items: [] };
  } catch (e) {
    pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">${_dashHeader()}${NX.card(NX.empty({ icon: 'alert-triangle', message: 'Could not load your recovery view — ' + esc(e.message || 'error') }))}</div>`;
    return;
  }
  if (q.no_projects) {
    pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">${_dashHeader()}${NX.card(NX.empty({ icon: 'user', tone: 'warning', message: 'You are not assigned to any project yet. Ask your admin to assign you so your recovery queue appears here.' }))}</div>`;
    return;
  }
  const queue  = Array.isArray(q.queue) ? q.queue : [];
  const sumT   = arr => arr.reduce((s, r) => s + Number(r.overdue_amt || 0), 0);
  const tierA  = queue.filter(r => r.tier === 'A');
  const tierB  = queue.filter(r => r.tier === 'B');
  const tierC  = queue.filter(r => r.tier === 'C');
  const totalOverdue = sumT(queue);
  const chase  = queue.filter(r => r.tier === 'A' || r.tier === 'B').sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  const aitems = alerts.items || [];
  const promisesDue  = aitems.filter(i => i.type === 'promise').length;
  const remindersDue = aitems.filter(i => i.type === 'followup').length + aitems.filter(i => i.type === 'pdc').length;
  const todayStr = (typeof td === 'function' ? td() : new Date().toISOString().slice(0, 10));
  const calledToday = chase.filter(r => String(r.last_contact_date || '').slice(0, 10) === todayStr).length;

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    ${_dashOffCoach()}
    ${_dashOffMission(chase.length, totalOverdue, calledToday)}
    ${_dashOffNext(chase)}
    ${_dashOffAlerts(alerts, queue)}
    ${_dashOffSteps(chase.length, promisesDue, remindersDue, tierC.length)}
    ${_dashOffTools()}
  </div>`;
  if (typeof NX.animateCounts === 'function') NX.animateCounts(pg);
}

/* Recovery officer's home = the live My Recovery report mounted right on the dashboard
   (up-to-date figures + the working client table with Call/Promise/Log/Escalate). No
   coach/mission/steps clutter — one report, work straight from here. */
async function _dashRecoveryReport(pg) {
  const today = (typeof td === 'function' ? td() : new Date().toISOString().slice(0, 10));
  const monLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const who = (S && (S.name || S.username)) || '';
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  window._orFilter = 'owe';
  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-4);display:flex;flex-direction:column;gap:var(--fk-sp-3)">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div>
        <h1 class="nx-page-title" style="margin:0">${greet}${who ? ', ' + esc(String(who).split(' ')[0]) : ''}</h1>
        <div class="nx-kpi-label" style="text-transform:none;margin-top:2px">Your recovery report · ${esc(monLabel)} · as of ${esc(typeof _orDate === 'function' ? _orDate(today) : today)}</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        ${NX.button('Record Payment', { variant: 'primary', size: 'sm', icon: 'plus', onclick: "nav('addpayment')" })}
        ${NX.button('Refresh', { variant: 'ghost', size: 'sm', icon: 'refresh-cw', onclick: 'rDash()' })}
        ${NX.button('Print / PDF', { variant: 'secondary', size: 'sm', icon: 'printer', onclick: '_orPrint()' })}
      </div>
    </div>
    <div id="or-body"><div class="nx-skel" style="height:120px"></div><div class="nx-skel" style="height:240px;margin-top:16px"></div></div>
  </div>`;
  window._orRoot = document.getElementById('or-body');
  if (typeof _orLoad === 'function') { await _orLoad(); }
  else { const b = document.getElementById('or-body'); if (b) b.innerHTML = NX.empty({ icon: 'alert-triangle', message: 'Recovery report module not loaded.' }); }
}

// FIRST-RUN COACH — teaches the recovery loop (incl. where alerts live); dismissible.
function _dashOffCoach() {
  try { if (localStorage.getItem('rms.rec.coach') === 'done') return ''; } catch (e) {}
  const step = (n, t) => `<div style="display:flex;gap:9px;align-items:flex-start"><span style="width:19px;height:19px;border-radius:50%;background:var(--fk-primary);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px">${n}</span><span style="font-size:13px;line-height:1.45">${t}</span></div>`;
  return `<div class="nx-card nx-rise" style="border-left:3px solid var(--fk-primary);padding:var(--fk-sp-5)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div class="nx-kpi-label" style="text-transform:none;font-weight:600;color:var(--fk-text);display:flex;align-items:center;gap:6px">${NX.icon('clock', 16)} How recovery works — your day in 5 steps</div>
      ${NX.button('Got it', { variant: 'ghost', size: 'sm', onclick: "try{localStorage.setItem('rms.rec.coach','done')}catch(e){}; if(typeof rDash==='function')rDash();" })}
    </div>
    <div style="display:grid;gap:9px;margin-top:11px">
      ${step(1, '<strong>Call</strong> the red account in “① Start here” — that’s your most urgent.')}
      ${step(2, '<strong>Log the outcome</strong> of every call — answered, no-answer, or dispute.')}
      ${step(3, 'If they promise to pay, <strong>set the promise date</strong> while you log it.')}
      ${step(4, 'We <strong>remind you</strong> when a promise or follow-up is due — watch the <strong>bell at the top-right</strong> and the <strong>“Needs attention”</strong> panel below.')}
      ${step(5, 'If a promise <strong>breaks</strong> or an account goes cold, <strong>escalate</strong> it.')}
    </div>
  </div>`;
}

// NEEDS ATTENTION — surfaces the bell's alerts inline + accounts gone cold (never empty when work exists).
function _dashOffAlerts(alerts, queue) {
  const items = (alerts && Array.isArray(alerts.items)) ? alerts.items : [];
  const cutoff = Date.now() - 14 * 864e5;
  const stale = (Array.isArray(queue) ? queue : []).filter(r => { const d = r.last_contact_date ? Date.parse(r.last_contact_date) : 0; return !d || d < cutoff; });
  if (!items.length && !stale.length) return '';
  const sev = t => t === 'danger' ? 'var(--fk-danger)' : t === 'warning' ? 'var(--fk-warning)' : 'var(--fk-info)';
  let rows = items.slice(0, 6).map(it => {
    const sub = (it.unit ? esc(it.unit) + ' · ' : '') + (it.amount != null ? _dashCompact(it.amount) + ' · ' : '') + 'due ' + (it.date ? (typeof fD === 'function' ? fD(it.date) : it.date) : '—');
    return `<div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--fk-border)">
      <span style="width:8px;height:8px;border-radius:50%;background:${sev(it.sev)};flex-shrink:0"></span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">${esc(it.title)} — ${esc(it.name || '—')}</div><div class="nx-kpi-label" style="text-transform:none">${sub}</div></div>
    </div>`;
  }).join('');
  if (stale.length) rows += `<div style="display:flex;gap:10px;align-items:center;padding:9px 0">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--fk-warning);flex-shrink:0"></span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">${stale.length} account${stale.length !== 1 ? 's' : ''} not contacted in 14+ days</div><div class="nx-kpi-label" style="text-transform:none">Reach out before they age past the 90-day cutoff.</div></div>
      <a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="nav('queue')">Open list →</a>
    </div>`;
  return NX.card(rows, { header: { title: 'Needs attention', icon: 'alert-triangle', tone: 'warning', actions: (items.length ? `<a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="nav('reminders')">Reminders →</a>` : '') } });
}

// MISSION — a slim orientation strip: greeting · today's job · progress so far.
function _dashOffMission(callN, totalOverdue, calledToday) {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = ((typeof S !== 'undefined' && S && (S.name || S.username)) || '').toString().split(' ')[0] || 'there';
  if (callN === 0) return `<div class="nx-card nx-rise" style="padding:var(--fk-sp-5);border-left:3px solid var(--fk-success)">
    <div class="nx-kpi-label" style="text-transform:none">${greet}, ${esc(name)} 👋</div>
    <div style="font-size:18px;font-weight:600;margin-top:3px;display:flex;align-items:center;gap:8px">${NX.icon('check-circle', 18)} All caught up — no calls pending today.</div>
    <div class="no-p" style="margin-top:12px"><a class="nx-btn nx-btn--secondary nx-btn--sm" onclick="nav('myrecovery')">${NX.icon('radar', 14)} Open my recovery report</a></div></div>`;
  const pct = Math.round(calledToday / callN * 100);
  return `<div class="nx-card nx-rise" style="padding:var(--fk-sp-5);border-left:3px solid var(--fk-primary)">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div><div class="nx-kpi-label" style="text-transform:none">${greet}, ${esc(name)} 👋</div>
        <div style="font-size:18px;font-weight:600;margin-top:2px"><strong>${callN}</strong> account${callN !== 1 ? 's' : ''} to call today · <strong>${_dashCompact(totalOverdue)}</strong> overdue</div></div>
      <div class="nx-kpi-label" style="text-transform:none;white-space:nowrap"><strong style="color:var(--fk-text)">${calledToday}</strong> of ${callN} contacted today</div>
    </div>
    <div style="margin-top:10px;height:7px;border-radius:4px;background:var(--fk-bg-subtle);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--fk-success);border-radius:4px;transition:width .4s"></div></div>
    <div class="no-p" style="margin-top:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <a class="nx-btn nx-btn--secondary nx-btn--sm" onclick="nav('myrecovery')">${NX.icon('radar', 14)} Open my recovery report</a>
      <span class="nx-kpi-label" style="text-transform:none">This month’s target, recovered, and who owes — all in one sheet.</span>
    </div>
  </div>`;
}

// START HERE — the single most-urgent account, full context + actions, then "up next".
function _dashOffNext(chase) {
  const r = chase[0];
  const total = chase.length;
  if (!r) return NX.card(NX.empty({ icon: 'check-circle', tone: 'success', message: 'No calls pending — your list is clear for today. Use your tools below if you need them.' }), { header: { title: '① Start here', icon: 'phone-call' } });
  const ph = (r.phone || '').replace(/[^0-9]/g, '');
  const hasPhone = ph.length >= 7;
  const chips = (Array.isArray(r.reasons) ? r.reasons : []).slice(0, 3).map(rs => NX.badge(rs.label, (rs.tone && rs.tone !== 'muted') ? rs.tone : '')).join(' ');
  const prop = (r.propensity && r.propensity.score != null) ? Number(r.propensity.score) : null;
  const lastC = r.last_contact_date ? 'Last contacted ' + (typeof fD === 'function' ? fD(r.last_contact_date) : r.last_contact_date) : 'Not contacted yet';
  return `<div class="nx-card nx-rise" style="padding:var(--fk-sp-6);border-left:3px solid var(--fk-danger)">
    <div class="nx-kpi-label" style="display:flex;align-items:center;gap:6px">① START HERE — your most urgent call${NX.infoTip('The #1 account on your call list by priority (oldest / biggest / broke a promise). Source: get_recovery_queue.')}</div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:8px">
      <div style="min-width:0">
        <div style="font-size:19px;font-weight:600">${esc(r.client_name || r.client_code || '—')}</div>
        <div class="nx-kpi-label" style="text-transform:none">${esc(r.unit_no || '')}${r.project_name ? ' · ' + esc(r.project_name) : ''} · ${lastC}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">${chips}${prop != null ? `<span class="nx-badge nx-badge--${prop >= 60 ? 'success' : prop >= 30 ? 'warning' : 'danger'}"><span class="nx-dot"></span>${prop}% will pay</span>` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="nx-hero-value" style="font-size:24px;color:var(--fk-danger)">${_dashCompact(r.overdue_amt)}</div>
        <div class="nx-kpi-label" style="text-transform:none">${Number(r.oldest_overdue_days || 0)} days overdue</div>
      </div>
    </div>
    <div class="no-p" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:var(--fk-sp-4)">
      ${hasPhone ? `<a class="nx-btn nx-btn--primary nx-btn--sm" href="tel:${esc(r.phone)}">${NX.icon('phone', 14)} Call now</a>
      <a class="nx-btn nx-btn--secondary nx-btn--sm" target="_blank" href="https://wa.me/${ph}">${NX.icon('message-circle', 14)} WhatsApp</a>`
      : `<span class="nx-badge nx-badge--warning"><span class="nx-dot"></span>No phone on file</span>
      ${r.unit_id ? NX.button('Plan a field visit', { variant: 'secondary', size: 'sm', icon: 'map-pin', onclick: "nav('fieldvisits')" }) : ''}`}
      ${r.unit_id ? NX.button('Log the outcome', { variant: 'secondary', size: 'sm', onclick: `openConModal('${r.unit_id}')` }) : ''}
      ${r.sale_id ? NX.button('View account', { variant: 'ghost', size: 'sm', onclick: `openSaleDetail('${r.sale_id}')` }) : ''}
    </div>
    ${total > 1 ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--fk-border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="nx-kpi-label">Up next</span>
      ${chase.slice(1, 4).map(x => `<span class="nx-badge" style="cursor:pointer" onclick="openSaleDetail('${esc(x.sale_id)}')">${esc((x.client_name || x.client_code || '—').split(' ')[0])} · ${_dashCompact(x.overdue_amt)}</span>`).join('')}
      ${total > 4 ? `<span class="nx-kpi-label" style="text-transform:none">+${total - 4} more</span>` : ''}
      <a class="nx-btn nx-btn--ghost nx-btn--sm" style="margin-left:auto" onclick="nav('queue')">See all →</a>
    </div>` : ''}
  </div>`;
}

// YOUR DAY — STEP BY STEP: the four-step recovery sequence, each a count + a way in.
function _dashOffSteps(callN, promN, remN, escN) {
  const step = (n, label, desc, count, tone, go) => `<div class="nx-card" style="border-top:3px solid var(--fk-${tone});cursor:pointer;${count > 0 ? '' : 'opacity:.72'}" onclick="${go}" onmouseover="this.style.background='var(--fk-bg-subtle)'" onmouseout="this.style.background=''">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:22px;height:22px;border-radius:50%;background:var(--fk-${tone});color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;flex-shrink:0">${n}</span><span class="nx-kpi-label" style="text-transform:none;font-weight:600;color:var(--fk-text)">${label}</span></div>
    <div style="font-size:24px;font-weight:600">${count}</div>
    <div class="nx-kpi-label" style="text-transform:none;margin:2px 0 8px">${desc}</div>
    <div style="color:var(--fk-primary);font-size:12px;font-weight:500">${count > 0 ? 'Open →' : 'View →'}</div>
  </div>`;
  return `<div>
    <div class="nx-kpi-label" style="margin-bottom:8px">YOUR DAY — STEP BY STEP</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:var(--fk-sp-3)">
      ${step(1, 'Call your list', 'accounts to call today', callN, 'danger', "nav('queue')")}
      ${step(2, 'Check promises', 'promises due — paid or not?', promN, 'info', "nav('promises')")}
      ${step(3, 'Send reminders', 'follow-ups / PDC to nudge', remN, 'warning', "nav('reminders')")}
      ${step(4, 'Escalate stuck', 'dead accounts to escalate', escN, 'danger', "nav('escalations')")}
    </div></div>`;
}

// MY TOOLS — every recovery action in one place, so nothing is hunted for.
function _dashOffTools() {
  const tool = (label, icon, go) => `<button class="nx-btn nx-btn--secondary" style="justify-content:flex-start" onclick="${go}">${NX.icon(icon, 16)} ${label}</button>`;
  return NX.card(`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:var(--fk-sp-2)">
    ${tool('My recovery report', 'radar', "nav('myrecovery')")}
    ${tool('Log a call', 'phone', "openConModal()")}
    ${tool('Record a payment', 'hand-coins', "nav('addpayment')")}
    ${tool('Morning List', 'sunrise', "nav('queue')")}
    ${tool('Reminders', 'bell', "nav('reminders')")}
    ${tool('Promises', 'handshake', "nav('promises')")}
    ${tool('Field visits', 'map-pin', "nav('fieldvisits')")}
    ${tool('Escalations', 'flag', "nav('escalations')")}
    ${tool('Call logs', 'phone-call', "nav('contacts')")}
  </div>`, { header: { title: 'My tools — everything you need', icon: 'grid', actions: NX.infoTip('Quick access to every recovery action. "Log a call" records the outcome (promise / no-answer / dispute) and sets your next follow-up — that keeps the recovery loop alive.') } });
}

/* ════════════════════════════════════════════════════════════════════════
   ACCOUNTS / FINANCE — data-entry home (quick actions, NOT the recovery view)
   ════════════════════════════════════════════════════════════════════════ */
function _dashAccountsHome(pg, role) {
  const who = (S && (S.name || S.username)) || '';
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const can = k => (typeof hasPermission !== 'function') || hasPermission(k);
  const tile = (perm, label, desc, icon, go) => can(perm)
    ? `<div class="nx-card" style="cursor:pointer" onclick="${go}" onmouseover="this.style.background='var(--fk-bg-subtle)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${NX.ichip(icon, '', { size: 'md' })}<span class="nx-kpi-label" style="text-transform:none;font-weight:600;color:var(--fk-text)">${label}</span></div>
        <div class="nx-kpi-label" style="text-transform:none">${desc}</div>
        <div style="color:var(--fk-primary);font-size:12px;font-weight:500;margin-top:10px">Open →</div>
      </div>` : '';
  const tiles = [
    tile('addpayment', 'Record Payment', 'Enter a new receipt against a unit', 'hand-coins', "nav('addpayment')"),
    tile('receipts', 'Receipt Vouchers', 'View & print payment receipts', 'file-text', "nav('receipts')"),
    tile('sales', 'Sales', 'Browse bookings & sale details', 'shopping-bag', "nav('sales')"),
    tile('clients', 'Clients', 'Client records & statements', 'users', "nav('clients')"),
    tile('agents', 'Sales Agents', 'Agent list & details', 'user-check', "nav('agents')"),
    tile('reports', 'Reports', 'Run & export reports', 'bar-chart-3', "nav('reports')")
  ].filter(Boolean).join('');
  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
    ${_dashHeader()}
    <div>
      <h2 style="font-size:18px;font-weight:600;margin:0">${greet}${who ? ', ' + esc(String(who).split(' ')[0]) : ''}</h2>
      <div class="nx-kpi-label" style="text-transform:none;margin-top:3px">Your quick actions — pick a task to get started.</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--fk-sp-3)">${tiles || NX.empty({ icon: 'info', message: 'No modules assigned yet — ask your admin to grant access.' })}</div>
  </div>`;
}
