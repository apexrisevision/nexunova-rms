// ══ RECOVERY QUEUE ═══════════════════════════════════════════════════════════
// Daily work queue — overdue units sorted by urgency.
// Phase-3 batch-1: restyled onto the nx- foundation kit. Logic/data flow unchanged
// (gunits · actualPending · daysSincePay · hasProjectAccess · openConModal · _rqWA).
// ═════════════════════════════════════════════════════════════════════════════

let _rq = { bucket: 'all', q: '', page: 1 };
const _RQ_PP = 25;

// Days-late → kit semantic tone (90+ danger · 61–90 warning · 31–60 info · ≤30 neutral)
function _rqTone(d) { return d > 90 ? 'danger' : d > 60 ? 'warning' : d > 30 ? 'info' : ''; }
function _rqToneVar(d) { const t = _rqTone(d); return t ? 'var(--fk-' + t + ')' : 'var(--fk-text-muted)'; }

/* ─── Entry point ──────────────────────────────────────────────────────────── */
function rRec() {
  _rq.page = 1;
  const pg = document.getElementById('pg-recovery');
  if (!pg) return;
  pg.innerHTML =
    NX.pageHeader('Recovery queue') +
    NX.card(
      '<div class="nx-field" style="margin:0">' +
        '<label class="nx-label">Search</label>' +
        '<input class="nx-input" id="rq-q" type="search" placeholder="Client or unit…" autocomplete="off"' +
          ' value="' + NX.esc(_rq.q) + '" oninput="_rq.q=this.value;_rq.page=1;_rqRender()"></div>',
      { compact:true }) +
    '<div id="rq-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:var(--fk-sp-3) 0"></div>' +
    '<div id="rq-body"></div>' +
    '<div id="rq-pager" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:var(--fk-sp-3)"></div>';
  _rqRender();
}

/* ─── Build sorted base data ───────────────────────────────────────────────── */
function _rqBase() {
  const all = gunits().filter(u =>
    u.status !== 'Available' && u.status !== 'Dead' && actualPending(u) > 0 &&
    (typeof hasProjectAccess !== 'function' || hasProjectAccess(u.projectId))
  );
  all.sort((a, b) => (daysSincePay(b) ?? 99999) - (daysSincePay(a) ?? 99999));
  return all;
}

/* ─── Filter one bucket ─────────────────────────────────────────────────────── */
function _rqInBucket(u, bucket) {
  const d = daysSincePay(u) ?? 99999;
  if (bucket === 'all')   return true;
  if (bucket === '1-30')  return d >= 1  && d <= 30;
  if (bucket === '31-60') return d >= 31 && d <= 60;
  if (bucket === '61-90') return d >= 61 && d <= 90;
  if (bucket === '90+')   return d > 90;
  return true;
}

/* ─── Change bucket ─────────────────────────────────────────────────────────── */
function _rqSetBucket(b) {
  _rq.bucket = b;
  _rq.page = 1;
  _rqRender();
}

/* ─── WhatsApp shortcut ─────────────────────────────────────────────────────── */
function _rqWA(uid) {
  const u = gunit(uid);
  if (!u || !u.phone) { toast('No phone number on file for this client.', 'warn'); return; }
  const proj = gproject(u.projectId);
  const msg =
    'Assalam o Alaikum ' + (u.customerName || 'Sir/Madam') + ',\n\n' +
    'Aap ki installment due hai:\n\n' +
    'Unit: ' + u.unitNo + (proj ? ' — ' + (proj.name || proj.projectName || '') : '') + '\n' +
    'Outstanding: PKR ' + fM(actualPending(u)) + '\n\n' +
    'Brahay Karam jald payment ada karein.';
  openWhatsApp(u.phone, msg);
}

/* ─── Main render ───────────────────────────────────────────────────────────── */
function _rqRender() {
  const tabs  = document.getElementById('rq-tabs');
  const body  = document.getElementById('rq-body');
  const pager = document.getElementById('rq-pager');
  if (!tabs || !body || !pager) return;

  const base = _rqBase();

  // Apply search filter
  const q = (_rq.q || '').toLowerCase().trim();
  const searched = q
    ? base.filter(u =>
        (u.customerName || '').toLowerCase().includes(q) ||
        (u.unitNo || '').toLowerCase().includes(q)
      )
    : base;

  // Bucket counts on searched set
  const cnt = {
    'all':   searched.length,
    '1-30':  searched.filter(u => _rqInBucket(u, '1-30')).length,
    '31-60': searched.filter(u => _rqInBucket(u, '31-60')).length,
    '61-90': searched.filter(u => _rqInBucket(u, '61-90')).length,
    '90+':   searched.filter(u => _rqInBucket(u, '90+')).length,
  };

  // ── Tabs ────────────────────────────────────────────────────────────────
  const BUCKETS = [
    { id: 'all',   lbl: 'All' },
    { id: '1-30',  lbl: '1–30 days' },
    { id: '31-60', lbl: '31–60 days' },
    { id: '61-90', lbl: '61–90 days' },
    { id: '90+',   lbl: '90+ days' },
  ];
  tabs.innerHTML = BUCKETS.map(b =>
    NX.button(b.lbl + ' · ' + cnt[b.id], { variant: _rq.bucket === b.id ? 'primary' : 'secondary', size:'sm', onclick:"_rqSetBucket('" + b.id + "')" })
  ).join('');

  // ── Apply bucket ─────────────────────────────────────────────────────────
  const filtered = searched.filter(u => _rqInBucket(u, _rq.bucket));
  const total = filtered.length;

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!total) {
    body.innerHTML = NX.card(NX.empty({
      icon:'check',
      message: (q || _rq.bucket !== 'all') ? 'No overdue units match your filters.' : 'No overdue units — all installments are current.'
    }));
    pager.innerHTML = '';
    return;
  }

  // ── Paginate ──────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(total / _RQ_PP);
  const p = Math.max(1, Math.min(_rq.page, totalPages));
  _rq.page = p;
  const start = (p - 1) * _RQ_PP;
  const slice = filtered.slice(start, start + _RQ_PP);

  // ── Build rows ────────────────────────────────────────────────────────────
  const rows = slice.map(u => {
    const d = daysSincePay(u);
    const dNum = d ?? 99999;
    const tone = _rqToneVar(dNum);
    const toneKey = _rqTone(dNum);
    const dayLbl = d === null ? 'Never paid' : d + 'd';

    const proj = gproject(u.projectId);
    const projName = proj?.name || proj?.projectName || '—';

    const logs = gcons(u.id).sort((a, b) => (b.contact_date || '').localeCompare(a.contact_date || ''));
    const lastConFmt = logs[0]?.contact_date ? fD(logs[0].contact_date) : '—';

    const id = esc(u.id);
    const acts =
      '<td onclick="event.stopPropagation()"><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' +
        NX.button('Call',     { variant:'ghost', size:'sm', onclick:"openConModal('" + id + "')" }) +
        NX.button('WhatsApp', { variant:'ghost', size:'sm', onclick:"_rqWA('" + id + "')" }) +
        NX.button('Promise',  { variant:'ghost', size:'sm', onclick:"openConModal('" + id + "','promise')" }) +
        NX.button('View',     { variant:'secondary', size:'sm', onclick:"openUD('" + id + "')" }) +
      '</div></td>';

    return '<tr style="cursor:pointer" onclick="openUD(\'' + id + '\')">' +
      '<td>' + esc(u.customerName || '—') + '</td>' +
      '<td><span class="num">' + esc(u.unitNo) + '</span></td>' +
      '<td><span style="color:var(--fk-text-muted)">' + esc(projName) + '</span></td>' +
      '<td class="num"><span style="color:' + tone + '">PKR ' + fM(actualPending(u)) + '</span></td>' +
      '<td>' + NX.badge(dayLbl, toneKey, { dot: dNum > 60 }) + '</td>' +
      '<td><span style="color:var(--fk-text-muted)">' + lastConFmt + '</span></td>' +
      acts +
    '</tr>';
  }).join('');

  const totalAmt = filtered.reduce((s, u) => s + (actualPending(u) || 0), 0);

  body.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--fk-sp-2)">' +
      '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-text)">' + total + (total === 1 ? ' account' : ' accounts') + '</span>' +
      '<span class="nx-kpi-label">·</span>' +
      '<span class="nx-kpi-label" style="text-transform:none">PKR ' + fM(totalAmt) + ' outstanding</span>' +
    '</div>' +
    NX.card(
      '<table class="nx-table nx-table--flush"><thead><tr>' +
        '<th>Client</th><th>Unit</th><th>Project</th><th class="num">Overdue</th><th>Days late</th><th>Last contact</th><th style="width:280px"></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>', { flush:true });

  // ── Pagination ────────────────────────────────────────────────────────────
  const from = start + 1;
  const to   = Math.min(start + _RQ_PP, total);

  let pgBtns = '';
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      pgBtns += NX.button(String(i), { variant: i === p ? 'primary' : 'secondary', size:'sm', onclick:'_rq.page=' + i + ';_rqRender()' });
    }
  } else {
    const pages = new Set([1, totalPages, p, p-1, p+1].filter(x => x >= 1 && x <= totalPages));
    const sorted = [...pages].sort((a,b) => a-b);
    sorted.forEach((pgN, idx) => {
      if (idx > 0 && pgN - sorted[idx-1] > 1) pgBtns += '<span class="nx-kpi-label" style="padding:0 4px">…</span>';
      pgBtns += NX.button(String(pgN), { variant: pgN === p ? 'primary' : 'secondary', size:'sm', onclick:'_rq.page=' + pgN + ';_rqRender()' });
    });
  }

  pager.innerHTML =
    '<div class="nx-kpi-label">Showing ' + from + '–' + to + ' of ' + total + ' records</div>' +
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
      NX.button('Prev', { variant:'secondary', size:'sm', disabled: p <= 1, onclick:'_rq.page=' + (p-1) + ';_rqRender()' }) +
      pgBtns +
      NX.button('Next', { variant:'secondary', size:'sm', disabled: p >= totalPages, onclick:'_rq.page=' + (p+1) + ';_rqRender()' }) +
    '</div>';
}
