// ══ RECOVERY QUEUE ═══════════════════════════════════════════════════════════
// Daily work queue — overdue units sorted by urgency
// ═════════════════════════════════════════════════════════════════════════════

let _rq = { bucket: 'all', q: '', page: 1 };
const _RQ_PP = 25;

/* ─── Entry point ──────────────────────────────────────────────────────────── */
function rRec() {
  _rq.page = 1;
  document.getElementById('pg-recovery').innerHTML =
    '<div class="ani module-financial">' +
      '<div class="ph">' +
        '<div class="ph-l"><h2>Recovery Queue</h2><p>Daily work queue — overdue installments sorted by urgency</p></div>' +
        '<div class="ph-r">' +
          '<input class="rq-search" id="rq-q" type="search" placeholder="Search client or unit…"' +
            ' value="' + esc(_rq.q) + '" oninput="_rq.q=this.value;_rq.page=1;_rqRender()">' +
        '</div>' +
      '</div>' +
      '<div id="rq-tabs" class="rq-tabs"></div>' +
      '<div id="rq-body"></div>' +
      '<div id="rq-pager" class="rq-pager"></div>' +
    '</div>';
  _rqRender();
}

/* ─── Build sorted base data ───────────────────────────────────────────────── */
function _rqBase() {
  const all = gunits().filter(u =>
    u.status !== 'Available' && u.status !== 'Dead' && actualPending(u) > 0
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
  if (!u || !u.phone) { alert('No phone number on file for this client.'); return; }
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
  tabs.innerHTML = BUCKETS.map(b => {
    const n = cnt[b.id];
    const bdgCls = b.id === '90+' ? ' red' : b.id === '61-90' ? ' amber' : '';
    const bdg = '<span class="rq-tab-bdg' + bdgCls + '">' + n + '</span>';
    return '<button class="rq-tab' + (_rq.bucket === b.id ? ' on' : '') +
      '" onclick="_rqSetBucket(\'' + b.id + '\')">' + b.lbl + bdg + '</button>';
  }).join('');

  // ── Apply bucket ─────────────────────────────────────────────────────────
  const filtered = searched.filter(u => _rqInBucket(u, _rq.bucket));
  const total = filtered.length;

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!total) {
    body.innerHTML =
      '<div class="rq-empty">' +
        '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>' +
        '</svg>' +
        '<div class="rq-empty-title">No overdue units</div>' +
        '<div class="rq-empty-sub">' + (q || _rq.bucket !== 'all' ? 'Try adjusting your filters' : 'All installments are current') + '</div>' +
      '</div>';
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
    const rowCls = dNum > 90 ? ' class="rq-row-critical"' : dNum > 60 ? ' class="rq-row-warn"' : '';
    const amtCls = dNum > 90 ? ' rq-amt-critical' : '';
    const dayCls = dNum > 90 ? ' red' : dNum > 60 ? ' amber' : dNum > 30 ? ' yellow' : '';
    const dayLbl = d === null ? 'Never paid' : d + 'd';

    const proj = gproject(u.projectId);
    const projName = proj?.name || proj?.projectName || '—';

    const logs = gcons(u.id).sort((a, b) => (b.contact_date || '').localeCompare(a.contact_date || ''));
    const lastConFmt = logs[0]?.contact_date ? fD(logs[0].contact_date) : '—';

    const id = esc(u.id);
    return '<tr' + rowCls + ' onclick="openUD(\'' + id + '\')">' +
      '<td style="font-weight:600">' + esc(u.customerName || '—') + '</td>' +
      '<td><span class="rq-unit-chip">' + esc(u.unitNo) + '</span></td>' +
      '<td class="rq-muted">' + esc(projName) + '</td>' +
      '<td class="rq-amt' + amtCls + '">PKR ' + fM(actualPending(u)) + '</td>' +
      '<td><span class="rq-days' + dayCls + '">' + dayLbl + '</span></td>' +
      '<td class="rq-muted">' + lastConFmt + '</td>' +
      '<td class="rq-acts" onclick="event.stopPropagation()">' +
        // Log Call
        '<button class="rq-btn" title="Log Call" onclick="openConModal(\'' + id + '\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33A2 2 0 0 1 3.54 1h3a2 2 0 0 1 2 1.72c.127.966.362 1.917.7 2.83a2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.29 6.29l.79-.99a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>' +
          '</svg>' +
        '</button>' +
        // WhatsApp
        '<button class="rq-btn green" title="WhatsApp" onclick="_rqWA(\'' + id + '\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
          '</svg>' +
        '</button>' +
        // Add Promise (opens the contact wizard with Promise-to-Pay pre-armed)
        '<button class="rq-btn blue" title="Add Promise" onclick="openConModal(\'' + id + '\',\'promise\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="20 6 9 17 4 12"/>' +
          '</svg>' +
        '</button>' +
        // View Unit
        '<button class="rq-btn ghost" title="View Unit" onclick="openUD(\'' + id + '\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' +
          '</svg>' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  body.innerHTML =
    '<div class="rq-card">' +
      '<table class="rq-tbl">' +
        '<thead><tr>' +
          '<th>Client Name</th>' +
          '<th>Unit</th>' +
          '<th>Project</th>' +
          '<th>Overdue Amount</th>' +
          '<th>Days Overdue</th>' +
          '<th>Last Contact Date</th>' +
          '<th>Actions</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  // ── Pagination ────────────────────────────────────────────────────────────
  const from = start + 1;
  const to   = Math.min(start + _RQ_PP, total);

  // Page number buttons: show up to 7, centered on current page
  let pgBtns = '';
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      pgBtns += '<button class="rq-pg-btn' + (i === p ? ' on' : '') +
        '" onclick="_rq.page=' + i + ';_rqRender()">' + i + '</button>';
    }
  } else {
    const pages = new Set([1, totalPages, p, p-1, p+1].filter(x => x >= 1 && x <= totalPages));
    const sorted = [...pages].sort((a,b) => a-b);
    sorted.forEach((pg, idx) => {
      if (idx > 0 && pg - sorted[idx-1] > 1) pgBtns += '<span style="padding:0 4px;color:var(--t3)">…</span>';
      pgBtns += '<button class="rq-pg-btn' + (pg === p ? ' on' : '') +
        '" onclick="_rq.page=' + pg + ';_rqRender()">' + pg + '</button>';
    });
  }

  pager.innerHTML =
    '<div class="rq-pager-info">Showing ' + from + '–' + to + ' of ' + total + ' records</div>' +
    '<div class="rq-pager-btns">' +
      '<button class="rq-pg-btn" ' + (p <= 1 ? 'disabled' : 'onclick="_rq.page=' + (p-1) + ';_rqRender()"') + '>← Prev</button>' +
      pgBtns +
      '<button class="rq-pg-btn" ' + (p >= totalPages ? 'disabled' : 'onclick="_rq.page=' + (p+1) + ';_rqRender()"') + '>Next →</button>' +
    '</div>';
}
