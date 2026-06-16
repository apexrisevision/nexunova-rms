// ══ LEDGERS HUB ══════════════════════════════════════════════

// Cached set of unit IDs that have at least one active sale (for unit ledger search)
let _soldUnitIds = null;

// Ledger hub tiles — nx- kit, theme-aware, indigo brand + quiet semantic tints.
// icon = NX kit glyph (must exist in kit _ICONS); tone = '' (indigo) | info | warning | danger | success.
const _LHUB = [
  { type:'client',   icon:'users',            tone:'',        name:'Client Ledger',            desc:'Payment history & balance per client', search:true,  navId:null },
  { type:'unit',     icon:'home',             tone:'info',    name:'Unit Ledger',              desc:'Sale & payment history per unit',      search:true,  navId:null },
  { type:'agent',    icon:'id-card',          tone:'',        name:'Agent Ledger',             desc:'Commission & sales history per agent', search:true,  navId:null },
  { type:'project',  icon:'building-2',       tone:'info',    name:'Project Ledger',           desc:'Collection ledger per project',        search:true,  navId:null },
  // PDC / Cancelled / Transferred tiles removed — already reachable from the sidebar
  // (PDC) and the "Transfer & Cancel" group (Transferred/Cancelled Units).
  { type:'officer',  icon:'shield',           tone:'success', name:'Recovery Officer Ledger',  desc:'Collection performance by officer',    search:false, navId:'officerledger' },
  { type:'receiving',icon:'hand-coins',       tone:'success', name:'Receiving Ledger',         desc:'All receipts and inflows log',         search:false, navId:'receivingledger' },
];

// Scoped CSS for the hub grid + inline search results (re-injected per render with
// the page innerHTML, so it never accumulates). Pure semantic vars → theme-aware.
function _lhubScopedCss() {
  return `<style>
    #pg-ledgers .ldg-hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(264px,1fr));gap:var(--fk-sp-3)}
    #pg-ledgers .ldg-tile{cursor:pointer}
    #pg-ledgers .ldg-tile .nx-card{height:100%}
    #pg-ledgers .ldg-res-row{padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--fk-border);transition:background .14s ease}
    #pg-ledgers .ldg-res-row:last-child{border-bottom:0}
    #pg-ledgers .ldg-res-row:hover{background:var(--fk-bg-subtle)}
    #pg-ledgers .ldg-res-lbl{font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text);line-height:1.3}
    #pg-ledgers .ldg-res-sub{font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:1px}
    #pg-ledgers .ldg-open{font-size:var(--fk-fs-label);color:var(--fk-primary);font-weight:var(--fk-fw-semibold)}
    #pg-ledgers .ldg-hint{font-size:var(--fk-fs-label);color:var(--fk-text-muted)}
  </style>`;
}

function rLedgers() {
  const pg = document.getElementById('pg-ledgers');
  if (!pg) return;

  if (!(_agCache && _agCache.length)) {
    supabase.rpc('list_agents', { p_company_id: S?.cid, p_sort: 'name' })
      .then(({ data }) => { if (Array.isArray(data)) _agCache = data; })
      .catch(() => {});
  }

  pg.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Ledgers', '', { icon:'wallet', sub:'Central access to all financial & operational ledgers' }) +
      _lhubScopedCss() +
      '<div class="ldg-hub-grid">' + _LHUB.map(_lhubCard).join('') + '</div>' +
    '</div>';
}

function _lhubCard(c) {
  const clickFn = c.search ? `_lhubToggle('${c.type}')` : `nav('${c.navId}')`;

  const searchArea = c.search ? `
    <div id="lhub-${c.type}-area" style="display:none;margin-top:var(--fk-sp-2)" onclick="event.stopPropagation()">
      <input id="lhub-${c.type}-q" class="nx-input"
        placeholder="${_lhubPlaceholder(c.type)}"
        oninput="_lhubSearch('${c.type}',this.value)"
        autocomplete="off" style="margin-bottom:6px">
      <div id="lhub-${c.type}-results"
        style="display:none;max-height:210px;overflow-y:auto;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-subtle)"></div>
    </div>` : '';

  const footer = c.search
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--fk-sp-3)">
         <span class="ldg-hint">Click to search</span>
         <span id="lhub-${c.type}-arrow" class="ldg-open">Open →</span>
       </div>`
    : `<div style="display:flex;justify-content:flex-end;margin-top:var(--fk-sp-3)">
         <span class="ldg-open">Open →</span>
       </div>`;

  const inner = NX.card(searchArea + footer, {
    hover: true,
    header: { icon: c.icon, tone: c.tone, title: c.name, sub: c.desc },
  });
  return `<div class="ldg-tile" onclick="${clickFn}">${inner}</div>`;
}

function _lhubPlaceholder(type) {
  return { client:'Search by name, code or phone…', unit:'Search by unit no or project…', agent:'Search by name or code…', project:'Search project…' }[type] || 'Search…';
}

function _lhubToggle(type) {
  const area  = document.getElementById('lhub-' + type + '-area');
  const arrow = document.getElementById('lhub-' + type + '-arrow');
  const res   = document.getElementById('lhub-' + type + '-results');
  const inp   = document.getElementById('lhub-' + type + '-q');
  if (!area) return;
  const open = area.style.display !== 'none';
  if (open) {
    area.style.display = 'none';
    if (arrow) arrow.textContent = 'Open →';
    if (inp)   inp.value = '';
    if (res)   { res.innerHTML = ''; res.style.display = 'none'; }
  } else {
    area.style.display = '';
    if (arrow) arrow.textContent = '↑ Close';
    if (inp)   { inp.focus(); _lhubSearch(type, ''); }
  }
}

function _lhubSearch(type, q) {
  const resEl = document.getElementById('lhub-' + type + '-results');
  if (!resEl) return;
  const term = (q || '').toLowerCase().trim();
  let items = [];

  if (type === 'client') {
    const all = gclients();
    items = (term
      ? all.filter(c => (c.fullName||'').toLowerCase().includes(term) || (c.clientCode||'').toLowerCase().includes(term) || (c.phonePrimary||'').includes(term))
      : all
    ).slice(0, 20).map(c => ({ id:c.id, label:c.fullName||'Unnamed', sub:c.clientCode||'' }));

  } else if (type === 'unit') {
    // If sold-unit cache not yet loaded, fetch it then re-run search
    if (_soldUnitIds === null) {
      _soldUnitIds = [];  // prevent concurrent fetches
      supabase
        .rpc('list_sold_unit_ids', { p_company_id: S?.cid })
        .then(({ data }) => {
          _soldUnitIds = data || [];
          _lhubSearch('unit', document.getElementById('lhub-unit-q')?.value || '');
        });
      resEl.innerHTML = `<div style="padding:12px 16px;font-size:var(--fk-fs-label);color:var(--fk-text-muted);text-align:center">Loading…</div>`;
      resEl.style.display = '';
      return;
    }
    const all = gunits().filter(u => _soldUnitIds.includes(u.id)), projs = gprojects();
    items = (term
      ? all.filter(u => {
          const pn = (projs.find(p => p.id === u.projectId)?.projectName || projs.find(p => p.id === u.projectId)?.name || '').toLowerCase();
          return (u.unitNo||'').toLowerCase().includes(term) || pn.includes(term);
        })
      : all
    ).slice(0, 20).map(u => {
      const prj = projs.find(p => p.id === u.projectId);
      return { id:u.id, label:u.unitNo||u.id, sub:prj?.projectName||prj?.name||'' };
    });

  } else if (type === 'agent') {
    const all = _agCache || [];
    items = (term
      ? all.filter(a => (a.full_name||'').toLowerCase().includes(term) || (a.agent_code||'').toLowerCase().includes(term))
      : all
    ).slice(0, 20).map(a => ({ id:a.id, label:a.full_name||'Unnamed', sub:a.agent_code||'' }));

  } else if (type === 'project') {
    const all = gprojects();
    items = (term
      ? all.filter(p => (p.projectName||p.name||'').toLowerCase().includes(term))
      : all
    ).slice(0, 20).map(p => ({ id:p.id, label:p.projectName||p.name||'Unnamed', sub:'' }));
  }

  if (!items.length) {
    resEl.innerHTML = `<div style="padding:12px 16px;font-size:var(--fk-fs-label);color:var(--fk-text-muted);text-align:center">No results found</div>`;
  } else {
    resEl.innerHTML = items.map(it => `
      <div class="ldg-res-row" onclick="_lhubOpen('${type}','${it.id}')">
        <div class="ldg-res-lbl">${esc(it.label)}</div>
        ${it.sub ? `<div class="ldg-res-sub">${esc(it.sub)}</div>` : ''}
      </div>`
    ).join('');
  }
  resEl.style.display = '';
}

function _lhubOpen(type, id) {
  if (type === 'client') {
    const c = gclients().find(x => x.id === id);
    window._ldgCtx = { id, name: c?.fullName || '—', sub: c?.clientCode || '' };
    nav('ledger-client');
  } else if (type === 'unit') {
    const u = gunits().find(x => x.id === id);
    const p = gprojects().find(x => x.id === u?.projectId);
    window._ldgCtx = { id, name: u?.unitNo || '—', sub: p?.projectName || p?.name || '' };
    nav('ledger-unit');
  } else if (type === 'agent') {
    const a = (_agCache || []).find(x => x.id === id);
    window._ldgCtx = { id, name: a?.full_name || '—', sub: a?.agent_code || '' };
    nav('ledger-agent');
  } else if (type === 'project') {
    const p = gprojects().find(x => x.id === id);
    window._ldgCtx = { id, name: p?.projectName || p?.name || '—', sub: '' };
    nav('ledger-project');
  }
}

// ══ Crystal Report shared helpers ════════════════════════════

function _ldgFiscalYear() {
  const now = new Date();
  const y   = now.getFullYear();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-01-01`, to: `${y}-${mm}-${dd}` };
}

// "01-Jan-2026"
function _ldgFmtDate(s) {
  if (!s) return '';
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(s);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + M[d.getMonth()] + '-' + d.getFullYear();
}

// "Jan-26"
function _ldgMonthLabel(s) {
  if (!s) return '???';
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '???';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
}

// {text, color} for a balance amount
function _ldgBalStr(n) {
  const v = +n || 0;
  if (v === 0) return { text: '0 Dr', color: '#6B7280' };
  if (v > 0)   return { text: fMF(v) + ' Dr', color: '#dc2626' };
  return             { text: fMF(Math.abs(v)) + ' Cr', color: '#16a34a' };
}

// No-op — print is handled via _ldgPrint() popup window, not window.print()
function _ldgInjectPrintCss() {}

// Open report in a clean new window and print it — no app UI, no conflicts
function _ldgPrint() {
  const pg = document.querySelector('.pg.on');
  const el = (pg || document).querySelector('.ldg-rpt-wrap');
  if (!el) { alert('No report loaded — click Run Report first.'); return; }

  const co = (S?.coName || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);

  const _ldgHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${co} — Ledger Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family:"Times New Roman",Georgia,serif; background:#fff; color:#1a1a1a; margin:0; padding:10px 16px; font-size:9pt; line-height:1.35; }
  .no-print, .ldg-page-footer { display:none !important; }
  /* Crystal ledger doc */
  .ldg-crystal { border:1px solid #333; border-radius:0 !important; background:#fff; box-shadow:none !important; }
  .ldg-crystal.lc-head { border-bottom:0; }
  .lc-title { text-align:center; padding:10px 14px 8px; }
  .lc-co  { font-size:15pt; font-weight:700; }
  .lc-doc { font-size:11pt; font-weight:700; letter-spacing:1.2px; text-decoration:underline; margin-top:2px; }
  .lc-info { border-top:1px solid #333; border-bottom:1px solid #333; padding:7px 14px; display:grid; grid-template-columns:1fr 1fr; gap:2px 22px; font-size:9pt; }
  .lc-info .ir b { display:inline-block; min-width:84px; font-weight:700; }
  .lc-tw { overflow:visible !important; }
  table.lc-tbl { border-collapse:collapse; width:100% !important; min-width:0 !important; table-layout:fixed; font-variant-numeric:tabular-nums; }
  .lc-tbl th, .lc-tbl td { border:1px solid #333; padding:3px 6px; font-size:8.5pt; vertical-align:middle; word-break:break-word; overflow-wrap:break-word; }
  .lc-tbl thead th { background:#fff; color:#1a1a1a; font-weight:700; text-align:left; border-bottom:2.5px double #333; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl th.num, .lc-tbl td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .lc-tbl tr.lc-mhdr td { background:#dcdcdc; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl tr.lc-mtot td { background:#E8E8E8; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl tr.lc-gtot td { background:#cfcfcf; font-weight:700; border-top:3px double #333; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-tbl tr.lc-ob td { font-style:italic; }
  .lc-dr { color:#b91c1c; font-weight:600; } .lc-cr { color:#15803d; font-weight:600; } .lc-zero { color:#6b7280; }
  .lc-tbl thead th:nth-child(1){width:8%} .lc-tbl thead th:nth-child(2){width:9%} .lc-tbl thead th:nth-child(3){width:38%}
  .lc-tbl thead th:nth-child(4){width:10%} .lc-tbl thead th:nth-child(5){width:11%} .lc-tbl thead th:nth-child(6){width:11%} .lc-tbl thead th:nth-child(7){width:13%}
  .lc-summary { border:1px solid #333; border-radius:4px; padding:8px 12px; max-width:320px; margin:12px 14px 8px; }
  .lc-summary h4 { font-size:9pt; font-weight:700; text-decoration:underline; text-align:center; margin:0 0 6px; }
  .lc-sum-row { display:flex; justify-content:space-between; gap:12px; padding:2px 0; border-bottom:1px dotted #aaa; font-size:9pt; }
  .lc-sum-row .l { font-weight:700; } .lc-sum-row .v { font-weight:700; text-decoration:underline; }
  @page { size:A4 landscape; margin:1cm 1.4cm; }
  @media print {
    body { padding:0; }
    thead { display:table-header-group; }
    .lc-mhdr { page-break-after:avoid; }
    .lc-gtot { page-break-before:avoid; }
    .lc-tbl th, .lc-mhdr td, .lc-mtot td, .lc-gtot td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head>
<body>
${el.innerHTML}
</body>
</html>`;

  _printHTML(_ldgHtml, co + ' — Ledger Report');
}

// Navigation bar strip (hidden on print)
function _ldgNavBar(title) {
  const co = esc(S?.coName || '');
  return '<div class="no-print nx-card nx-card--compact" style="display:flex;align-items:center;justify-content:space-between;gap:var(--fk-sp-3);margin-bottom:var(--fk-sp-3)">' +
    NX.button('Back', { variant:'ghost', size:'sm', icon:'arrow-left', onclick:'navBack()' }) +
    '<span style="font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text);text-align:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + co + (co ? ' — ' : '') + esc(title) + '</span>' +
    NX.button('Print', { variant:'secondary', size:'sm', icon:'printer', onclick:'_ldgPrint()' }) +
  '</div>';
}

// Legacy alias kept so old code doesn't break
function _ldgHdr(ledgerName) { return _ldgNavBar(ledgerName); }

// Date filter bar (hidden on print)
function _ldgFilterRow(prefix, onRunFn, extraHtml, dfl) {
  const fy   = _ldgFiscalYear();
  const from = (dfl && dfl.from) || fy.from;
  const to   = (dfl && dfl.to)   || fy.to;
  return '<div class="no-print nx-card" style="margin-bottom:var(--fk-sp-3)">' +
    '<div style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:flex-end">' +
      '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">From date</label>' +
        '<input id="' + prefix + '-from" class="nx-input" type="date" value="' + from + '" min="2000-01-01" max="2099-12-31" style="width:160px"></div>' +
      '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">To date</label>' +
        '<input id="' + prefix + '-to" class="nx-input" type="date" value="' + to + '" min="2000-01-01" max="2099-12-31" style="width:160px"></div>' +
      (extraHtml || '') +
      NX.button('Run report', { variant:'primary', icon:'arrow-right', onclick: onRunFn + '()' }) +
    '</div>' +
  '</div>';
}

function _ldgValidateDates(fromVal, toVal, bodyEl) {
  if (!fromVal || !toVal) {
    if (bodyEl) bodyEl.innerHTML = _ldgErr('Please select both From and To dates.');
    return false;
  }
  if (fromVal > toVal) {
    if (bodyEl) bodyEl.innerHTML = _ldgErr('From date cannot be after To date.');
    return false;
  }
  return true;
}

function _ldgEmpty() {
  return NX.card(NX.empty({ icon:'file-text', message:'Select a date range and click “Run report” — the ledger will appear here.' }));
}

function _ldgLoading() {
  return NX.card(NX.empty({ icon:'clock', message:'Generating report…' }));
}

function _ldgErr(msg) {
  return NX.card(NX.banner(String(msg), 'danger'));
}

// Ledger type label from the active page id (shared header is type-agnostic).
function _ldgTypeLabel() {
  const id = ((document.querySelector('.pg.on') || {}).id) || '';
  const M = {'pg-ledger-client':'Client','pg-ledger-unit':'Unit','pg-ledger-agent':'Agent',
             'pg-ledger-project':'Project','pg-officerledger':'Officer','pg-receivingledger':'Receiving'};
  return M[id] || 'General';
}

// ── Crystal accounting header (shared, all dimensions) ──────────────────────
// params: { entityName, entityCode, project, fromDate, toDate, ledgerType? }
// Reuses the shared Crystal tokens (helpers.js _injectCrystalStyle / .ldg-crystal).
function _ldgCrystalHdr(params) {
  if (typeof _injectCrystalStyle === 'function') _injectCrystalStyle();
  const co   = esc(S?.coName || '—');
  const fd   = _ldgFmtDate(params.fromDate);
  const td2  = _ldgFmtDate(params.toDate);
  const name = esc(params.entityName || '—');
  const code = esc(params.entityCode || '—');
  const proj = esc(params.project    || '—');
  const lt   = esc(params.ledgerType || _ldgTypeLabel());
  const gen  = _ldgFmtDate(new Date().toISOString().slice(0, 10));
  return `
  <div class="ldg-crystal lc-head">
    <div class="lc-title">
      <div class="lc-co">${co}</div>
      <div class="lc-doc">${lt.toUpperCase()} LEDGER</div>
    </div>
    <div class="lc-info">
      <div class="ir"><b>Ledger</b>${lt}</div>
      <div class="ir"><b>Entity</b>${name}</div>
      <div class="ir"><b>Head Code</b>${code}</div>
      <div class="ir"><b>Project</b>${proj}</div>
      <div class="ir"><b>Period</b>${fd || '—'} to ${td2 || '—'}</div>
      <div class="ir"><b>Generated</b>${gen}</div>
    </div>
  </div>`;
}

// Print button shown inside rendered report (hidden on actual print)
function _ldgPrintBtn() {
  return '<div class="no-print" style="display:flex;justify-content:flex-end;margin-bottom:var(--fk-sp-3)">' +
    NX.button('Print report', { variant:'primary', icon:'printer', onclick:'_ldgPrint()' }) +
  '</div>';
}

// ── SAIF-style Crystal Report table ─────────────────────────
// rows:  array of row objects (mixed field names handled)
// ob:    opening balance (number)
// fromDate: 'YYYY-MM-DD'
// opts:  { debitLabel, creditLabel }
function _ldgCrystalTable(rows, ob, fromDate, opts) {
  const o   = opts || {};
  const dLbl = o.debitLabel  || 'Debit';
  const cLbl = o.creditLabel || 'Credit';

  // Normalize each row to a consistent shape
  const norm = (rows || []).map(r => {
    const dateStr = r.entry_date || r.row_date || r.payment_date || '';
    const isPdc   = ['pdc','cheque'].includes((r.method || '').toLowerCase());
    return {
      voucher_no:  r.voucher_no  || r.voucher_code || '',
      entry_date:  dateStr,
      description: r.description || r.particulars  || '',
      chq_no:      r.chq_no || (isPdc ? (r.reference_no || '') : ''),
      debit:  +(r.debit  || r.earned || 0),
      credit: +(r.credit || r.paid   || r.amount || 0),
    };
  });

  // Sort ascending by date
  norm.sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0));

  // Build month groups preserving order
  const monthOrder = [];
  const monthMap   = {};

  const obMk = (fromDate || '').slice(0, 7);
  if (obMk && !monthMap[obMk]) { monthMap[obMk] = []; monthOrder.push(obMk); }

  norm.forEach(r => {
    const mk = r.entry_date.slice(0, 7);
    if (!mk) return;
    if (!monthMap[mk]) { monthMap[mk] = []; monthOrder.push(mk); }
    monthMap[mk].push(r);
  });

  let runBal = +ob || 0;
  let totalD = 0, totalC = 0;
  let tbody  = '';
  const bcls = (v) => (v > 0 ? 'lc-dr' : v < 0 ? 'lc-cr' : 'lc-zero');

  monthOrder.forEach((mk, mIdx) => {
    const mRows  = monthMap[mk];
    const mLabel = _ldgMonthLabel(mk + '-01');
    let mD = 0, mC = 0;

    tbody += `<tr class="lc-mhdr"><td colspan="7">${mLabel}</td></tr>`;

    // Opening balance row (first month only)
    if (mIdx === 0) {
      const b = _ldgBalStr(runBal);
      tbody += `<tr class="lc-ob">
        <td>OP-0</td>
        <td class="num" style="text-align:left">${_ldgFmtDate(fromDate)}</td>
        <td>**** Opening Balance ****</td>
        <td></td><td class="num"></td><td class="num"></td>
        <td class="num"><span class="${bcls(runBal)}">${b.text}</span></td>
      </tr>`;
    }

    // Transaction rows
    mRows.forEach(r => {
      const dr = r.debit, cr = r.credit;
      runBal += dr - cr;
      mD += dr; mC += cr;
      totalD += dr; totalC += cr;
      const b = _ldgBalStr(runBal);
      tbody += `<tr>
        <td>${esc(r.voucher_no)}</td>
        <td class="num" style="text-align:left">${_ldgFmtDate(r.entry_date)}</td>
        <td>${esc(r.description || '—')}</td>
        <td>${esc(r.chq_no)}</td>
        <td class="num">${dr ? `<span class="lc-dr">${fMF(dr)}</span>` : ''}</td>
        <td class="num">${cr ? `<span class="lc-cr">${fMF(cr)}</span>` : ''}</td>
        <td class="num"><span class="${bcls(runBal)}">${b.text}</span></td>
      </tr>`;
    });

    // Monthly total
    tbody += `<tr class="lc-mtot">
      <td colspan="4" class="num">Monthly Total :</td>
      <td class="num"><span class="lc-dr">${fMF(mD)}</span></td>
      <td class="num"><span class="lc-cr">${fMF(mC)}</span></td>
      <td></td>
    </tr>`;
  });

  // Grand total
  const closing = (+ob || 0) + totalD - totalC;
  const fb = _ldgBalStr(closing);
  tbody += `<tr class="lc-gtot">
    <td colspan="4" class="num">Grand Total :</td>
    <td class="num"><span class="lc-dr">${fMF(totalD)}</span></td>
    <td class="num"><span class="lc-cr">${fMF(totalC)}</span></td>
    <td class="num"><span class="${bcls(closing)}">${fb.text}</span></td>
  </tr>`;

  // ── Outstanding Balance Summary box (Saif-style; underlined values) ──
  const isClient = _ldgTypeLabel() === 'Client';
  const sL = isClient
    ? { a: 'Total Billed (Dr)', b: 'Amount Received (Cr)', c: 'Remaining Balance' }
    : { a: 'Total ' + dLbl + ' (Dr)', b: 'Total ' + cLbl + ' (Cr)', c: 'Closing Balance' };
  const obStr = _ldgBalStr(+ob || 0);
  const summary = `
  <div class="lc-summary">
    <h4>Outstanding Balance Summary</h4>
    <div class="lc-sum-row"><span class="l">Opening Balance</span><span class="v">${obStr.text}</span></div>
    <div class="lc-sum-row"><span class="l">${sL.a}</span><span class="v">${fMF(totalD)}</span></div>
    <div class="lc-sum-row"><span class="l">${sL.b}</span><span class="v">${fMF(totalC)}</span></div>
    <div class="lc-sum-row"><span class="l">${sL.c}</span><span class="v">${fb.text}</span></div>
  </div>`;

  return `
  <div class="ldg-crystal lc-body">
    <div class="lc-tw">
      <table class="lc-tbl">
        <thead><tr>
          <th style="width:78px">V/No</th>
          <th style="width:96px">Date</th>
          <th>Description</th>
          <th style="width:96px">Cheque/Ref</th>
          <th class="num" style="width:120px">${esc(dLbl)}</th>
          <th class="num" style="width:120px">${esc(cLbl)}</th>
          <th class="num" style="width:130px">Balance</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    ${summary}
  </div>`;
}
