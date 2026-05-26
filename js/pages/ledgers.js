// ══ LEDGERS HUB ══════════════════════════════════════════════

// Cached set of unit IDs that have at least one active sale (for unit ledger search)
let _soldUnitIds = null;

const _lhIc=(p,s=28)=>`<svg width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${p}</svg>`;
const _LHUB = [
  { type:'client',   ic:_lhIc('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),                                                                    name:'Client Ledger',            desc:'Payment history & balance per client',        search:true,  navId:null,             bg:'#fdf8f2', bgHover:'#f5eddf' },
  { type:'unit',     ic:_lhIc('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),                                                    name:'Unit Ledger',              desc:'Sale & payment history per unit',             search:true,  navId:null,             bg:'#f9f9f7', bgHover:'#efefea' },
  { type:'agent',    ic:_lhIc('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'), name:'Agent Ledger',             desc:'Commission & sales history per agent',        search:true,  navId:null,             bg:'#fef9f2', bgHover:'#f5ecda' },
  { type:'project',  ic:_lhIc('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'), name:'Project Ledger',            desc:'Collection ledger per project',               search:true,  navId:null,             bg:'#fafaf5', bgHover:'#f0f0e6' },
  { type:'pdc',      ic:_lhIc('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>'),                                                                  name:'PDC Register',             desc:'Post-dated cheque tracking & status',         search:false, navId:'pdc',            bg:'#fdf5ec', bgHover:'#f5e8d4' },
  { type:'cancelled',ic:_lhIc('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'),                                                                        name:'Cancelled Units Ledger',   desc:'Cancelled bookings & refund records',         search:false, navId:'cancelledunits', bg:'#f8f8f5', bgHover:'#eeeeea' },
  { type:'transfer', ic:_lhIc('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),                             name:'Transferred Units Ledger', desc:'Ownership transfer history log',              search:false, navId:'transferunits',  bg:'#fdfdf5', bgHover:'#f5f5e2' },
  { type:'officer',  ic:_lhIc('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),                                                                                                  name:'Recovery Officer Ledger',  desc:'Collection performance by officer',           search:false, navId:'officerledger',  bg:'#fff9f0', bgHover:'#f5ecdb' },
  { type:'receiving',ic:_lhIc('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),                                                    name:'Receiving Ledger',         desc:'All receipts and inflows log',                search:false, navId:'receivingledger',bg:'#f5f5f0', bgHover:'#eaeae2' },
];

const _LHUB_BASE_SHARED = [
  'position:relative',
  'border:1px solid rgba(0,0,0,0.08)',
  'border-radius:12px',
  'box-shadow:0 4px 6px rgba(0,0,0,0.07),0 1px 3px rgba(0,0,0,0.06)',
  'transform:translateY(0)',
  'transition:all 0.25s ease',
  'overflow:hidden',
  'cursor:pointer',
  "font-family:'Inter',sans-serif",
].join(';');

function rLedgers() {
  const pg = document.getElementById('pg-ledgers');
  if (!pg) return;

  if (!(_agCache && _agCache.length)) {
    supabase.rpc('list_agents', { p_company_id: S?.cid, p_sort: 'name' })
      .then(({ data }) => { if (Array.isArray(data)) _agCache = data; })
      .catch(() => {});
  }

  pg.innerHTML = `<div class="ani">
    <div class="ph no-p">
      <div>
        <h2 style="font-family:'Plus Jakarta Sans','Inter',sans-serif">Ledgers</h2>
        <p style="font-family:'Inter',sans-serif">Central access to all financial and operational ledgers</p>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
      ${_LHUB.map((c, i) => _lhubCard(c, i)).join('')}
    </div>
  </div>`;
}

function _lhubCard(c, i) {
  const clickFn  = c.search ? `_lhubToggle('${c.type}')` : `nav('${c.navId}')`;
  const hoverIn  = `this.style.boxShadow='0 20px 40px rgba(0,0,0,0.12),0 8px 16px rgba(0,0,0,0.08)';this.style.transform='translateY(-4px)';this.style.background='${c.bgHover}';this.querySelector('.lhub-bar').style.width='100%'`;
  const hoverOut = `this.style.boxShadow='0 4px 6px rgba(0,0,0,0.07),0 1px 3px rgba(0,0,0,0.06)';this.style.transform='translateY(0)';this.style.background='${c.bg}';this.querySelector('.lhub-bar').style.width='0'`;
  const baseStyle = `${_LHUB_BASE_SHARED};background:${c.bg}`;

  const searchArea = c.search ? `
    <div id="lhub-${c.type}-area" style="display:none;margin-top:4px" onclick="event.stopPropagation()">
      <div style="position:relative;margin-bottom:6px">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#9CA3AF;pointer-events:none;display:flex"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
        <input id="lhub-${c.type}-q"
          placeholder="${_lhubPlaceholder(c.type)}"
          oninput="_lhubSearch('${c.type}',this.value)"
          autocomplete="off"
          style="width:100%;padding:9px 12px 9px 36px;background:#f9fafb;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;color:#111827;outline:none;transition:border-color 0.2s ease"
          onfocus="this.style.borderColor='#2563eb'"
          onblur="this.style.borderColor='rgba(0,0,0,0.12)'">
      </div>
      <div id="lhub-${c.type}-results"
        style="display:none;max-height:200px;overflow-y:auto;border-radius:8px;
               border:1px solid rgba(0,0,0,0.08);background:#ffffff;overflow:hidden"></div>
    </div>` : '';

  const footer = c.search
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
         <span style="font-size:11px;color:#9CA3AF;font-family:'Inter',sans-serif">Click to search</span>
         <span id="lhub-${c.type}-arrow" style="font-size:12px;color:#2563eb;font-weight:600;font-family:'Inter',sans-serif">Open →</span>
       </div>`
    : `<div style="display:flex;justify-content:flex-end;margin-top:12px">
         <span style="font-size:12px;color:#2563eb;font-weight:600;font-family:'Inter',sans-serif">Open →</span>
       </div>`;

  return `
  <div style="${baseStyle}"
       onmouseenter="${hoverIn}"
       onmouseleave="${hoverOut}"
       onclick="${clickFn}">
    <div class="lhub-bar" style="position:absolute;top:0;left:0;height:3px;width:0;background:#2563eb;transition:width 0.3s ease;z-index:1"></div>
    <div style="padding:18px">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:4px">
        <span style="line-height:1;flex-shrink:0;color:var(--brand,#2563eb)">${c.ic}</span>
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:700;color:#111827;font-family:'Inter',sans-serif;line-height:1.3;margin-bottom:3px">${c.name}</div>
          <div style="font-size:12px;color:#6B7280;font-family:'Inter',sans-serif;line-height:1.4">${c.desc}</div>
        </div>
      </div>
      ${searchArea}
      ${footer}
    </div>
  </div>`;
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
      resEl.innerHTML = `<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;font-family:'Inter',sans-serif;text-align:center">Loading…</div>`;
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
    resEl.innerHTML = `<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;font-family:'Inter',sans-serif;text-align:center">No results found</div>`;
  } else {
    resEl.innerHTML = items.map(it => `
      <div onclick="_lhubOpen('${type}','${it.id}')"
        style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.06);font-family:'Inter',sans-serif;transition:background 0.15s ease"
        onmouseenter="this.style.background='#eff6ff'"
        onmouseleave="this.style.background=''">
        <div style="font-size:13px;font-weight:600;color:#111827;line-height:1.3">${esc(it.label)}</div>
        ${it.sub ? `<div style="font-size:11px;color:#6B7280;margin-top:1px">${esc(it.sub)}</div>` : ''}
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
  body {
    font-family: Arial, 'Helvetica Neue', sans-serif;
    background: #fff; color: #000;
    margin: 0; padding: 12px 18px;
    font-size: 11px; line-height: 1.4;
  }
  .no-print, .ldg-page-footer { display: none !important; }
  .ldg-rpt-wrap { box-shadow: none !important; border-radius: 0 !important; }

  /* Report header */
  .ldg-rpt-wrap > div:first-child {
    border: 1px solid #bbb !important;
    border-radius: 0 !important;
    padding: 12px 16px 8px !important;
  }

  /* Table container — no scroll, let it fill full width */
  div[style*="overflow-x"] { overflow: visible !important; }

  /* Table */
  table { border-collapse: collapse; width: 100% !important; min-width: 0 !important; table-layout: fixed; }
  col, colgroup { display: none; }
  th, td {
    border: 1px solid #aaa;
    padding: 3px 6px;
    font-size: 9.5px;
    font-family: Arial, sans-serif;
    vertical-align: middle;
    line-height: 1.3;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  thead th {
    background: #2c2c2c !important;
    color: #fff !important;
    font-weight: 700;
    font-size: 9.5px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Fixed column widths for landscape A4 (printable ~240mm ≈ 907px) */
  thead th:nth-child(1) { width: 7%;  }   /* Voucher # */
  thead th:nth-child(2) { width: 9%;  }   /* Date */
  thead th:nth-child(3) { width: 40%; }   /* Particulars */
  thead th:nth-child(4) { width: 8%;  }   /* Chq No */
  thead th:nth-child(5) { width: 12%; }   /* Debit */
  thead th:nth-child(6) { width: 12%; }   /* Credit */
  thead th:nth-child(7) { width: 12%; }   /* Balance */
  .ldg-month-hdr td {
    background: #d4d4d4 !important;
    font-weight: 700;
    font-size: 10px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ldg-month-total td {
    background: #f0f0f0 !important;
    font-size: 9.5px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ldg-grand-total td {
    background: #e0e0e0 !important;
    font-weight: 700;
    font-size: 10px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  hr { border: none; border-top: 1.5px solid #444; margin: 6px 0; }
  strong { font-weight: 700; }
  em { font-style: italic; }

  /* Preserve Dr/Cr colors */
  [style*="color:#dc2626"] { color: #dc2626 !important; }
  [style*="color:#16a34a"] { color: #16a34a !important; }
  [style*="color:#6B7280"] { color: #6B7280 !important; }

  @page { size: A4 landscape; margin: 1cm 1.5cm; }
  @media print {
    body { padding: 0; }
    thead { display: table-header-group; }
    .ldg-month-hdr { page-break-after: avoid; }
    .ldg-grand-total { page-break-before: avoid; }
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
  return `
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;
       margin-bottom:10px;padding:8px 16px;background:#f8fafc;border:1px solid rgba(0,0,0,0.08);
       border-radius:8px;font-family:'Inter',sans-serif">
    <button class="btn btn-gh" onclick="navBack()" style="font-size:12px;padding:5px 12px">← Back</button>
    <span style="font-size:13px;font-weight:600;color:#374151">${co}${co ? ' — ' : ''}${esc(title)}</span>
    <button class="btn btn-gh" onclick="_ldgPrint()" style="font-size:12px;padding:5px 12px;display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg> Print</button>
  </div>`;
}

// Legacy alias kept so old code doesn't break
function _ldgHdr(ledgerName) { return _ldgNavBar(ledgerName); }

// Date filter bar (hidden on print)
function _ldgFilterRow(prefix, onRunFn, extraHtml, dfl) {
  const fy   = _ldgFiscalYear();
  const from = (dfl && dfl.from) || fy.from;
  const to   = (dfl && dfl.to)   || fy.to;
  return `
  <div class="no-print card" style="margin-bottom:14px">
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:4px 0">
      <div>
        <label class="lb">From Date</label>
        <input id="${prefix}-from" class="inp" type="date" value="${from}" min="2000-01-01" max="2099-12-31" style="width:148px">
      </div>
      <div>
        <label class="lb">To Date</label>
        <input id="${prefix}-to" class="inp" type="date" value="${to}" min="2000-01-01" max="2099-12-31" style="width:148px">
      </div>
      ${extraHtml || ''}
      <button onclick="${onRunFn}()"
        style="height:36px;padding:0 20px;background:#2563eb;color:#fff;border:none;
               border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
               font-family:'Inter',sans-serif;align-self:flex-end;white-space:nowrap">
        ▶ Run Report
      </button>
    </div>
  </div>`;
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
  return `
  <div class="card" style="text-align:center;padding:64px 24px">
    <div style="margin-bottom:14px;display:flex;justify-content:center"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
    <div style="font-size:15px;font-weight:600;color:#374151;font-family:'Inter',sans-serif">
      Select a date range and click <strong>▶ Run Report</strong>
    </div>
    <div style="font-size:13px;color:#9CA3AF;margin-top:6px;font-family:'Inter',sans-serif">The ledger will appear here</div>
  </div>`;
}

function _ldgLoading() {
  return `
  <div class="card" style="text-align:center;padding:64px 24px">
    <div style="font-size:13px;color:var(--t3);font-family:'Inter',sans-serif">Generating report…</div>
  </div>`;
}

function _ldgErr(msg) {
  return `
  <div class="card" style="text-align:center;padding:40px 24px">
    <div style="font-size:13px;color:var(--err,#dc2626);font-family:'Inter',sans-serif">${esc(String(msg))}</div>
  </div>`;
}

// ── Crystal Report header (SAIF-style) ──────────────────────
// params: { entityName, entityCode, project, fromDate, toDate }
function _ldgCrystalHdr(params) {
  const co  = esc(S?.coName || '');
  const fd  = _ldgFmtDate(params.fromDate);
  const td  = _ldgFmtDate(params.toDate);
  const name = esc(params.entityName || '—');
  const code = esc(params.entityCode || '—');
  const proj = esc(params.project    || '—');
  return `
  <div style="background:#fff;border:1px solid #bbb;border-radius:6px 6px 0 0;padding:14px 18px 10px;
              font-family:'Inter',sans-serif">
    <div style="text-align:center;margin-bottom:10px">
      <div style="font-size:18px;font-weight:800;color:#111;letter-spacing:0.2px">${co}</div>
      <div style="font-size:14px;font-weight:700;color:#111;margin-top:2px;letter-spacing:1.5px">LEDGER</div>
      <div style="font-size:12px;color:#333;margin-top:5px">
        Period : From <strong>${fd || '—'}</strong> To <strong>${td || '—'}</strong>
      </div>
    </div>
    <hr style="border:none;border-top:1.5px solid #444;margin:8px 0 8px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:12px;color:#222">
      <div><span style="color:#555">Head Name :</span>&nbsp;<strong>${name}</strong></div>
      <div><span style="color:#555">Main Head :</span>&nbsp;<strong>${(params.entityName||'—').toUpperCase()}</strong></div>
      <div><span style="color:#555">Head Code :</span>&nbsp;<strong>${code}</strong></div>
      <div><span style="color:#555">Project :</span>&nbsp;<strong>${proj}</strong></div>
    </div>
    <hr style="border:none;border-top:1.5px solid #444;margin:8px 0 0">
  </div>`;
}

// Print button shown inside rendered report (hidden on actual print)
function _ldgPrintBtn() {
  return `
  <div class="no-print" style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button onclick="_ldgPrint()"
      style="display:flex;align-items:center;gap:7px;padding:8px 20px;background:#1d4ed8;
             color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;
             cursor:pointer;font-family:'Inter',sans-serif;letter-spacing:0.2px;
             box-shadow:0 2px 8px rgba(29,78,216,0.35)"
      onmouseenter="this.style.background='#1e40af'"
      onmouseleave="this.style.background='#1d4ed8'">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>&nbsp;Print Report
    </button>
  </div>`;
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

  const TH = 'padding:7px 10px;font-size:11.5px;font-weight:700;background:#2c2c2c;color:#fff;white-space:nowrap;border:1px solid #555';
  const THR = TH + ';text-align:right';
  const TD  = (s) => `style="padding:5px 9px;border:1px solid #d4d4d4;font-size:12px;font-family:\'Inter\',sans-serif;vertical-align:middle;${s||''}"`;

  monthOrder.forEach((mk, mIdx) => {
    const mRows  = monthMap[mk];
    const mLabel = _ldgMonthLabel(mk + '-01');
    let mD = 0, mC = 0;

    // Month header
    tbody += `<tr class="ldg-month-hdr">
      <td colspan="7" ${TD('font-weight:700;background:#d8d8d8;font-size:12px;letter-spacing:0.3px')}>${mLabel}</td>
    </tr>`;

    // Opening balance row (first month only)
    if (mIdx === 0) {
      const b = _ldgBalStr(runBal);
      tbody += `<tr>
        <td ${TD('font-family:monospace;font-size:11px;color:#555;white-space:nowrap')}>OP-0</td>
        <td ${TD('white-space:nowrap')}>${_ldgFmtDate(fromDate)}</td>
        <td ${TD('font-weight:600')}><em>**** Opening Balance ****</em></td>
        <td ${TD('')}></td>
        <td ${TD('text-align:right')}></td>
        <td ${TD('text-align:right')}></td>
        <td ${TD('text-align:right;white-space:nowrap')}><span style="color:${b.color};font-weight:700">${b.text}</span></td>
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
        <td ${TD('font-family:monospace;font-size:11px;color:#374151;white-space:nowrap')}>${esc(r.voucher_no)}</td>
        <td ${TD('white-space:nowrap')}>${_ldgFmtDate(r.entry_date)}</td>
        <td ${TD('')}>${esc(r.description || '—')}</td>
        <td ${TD('font-size:11px;color:#555')}>${esc(r.chq_no)}</td>
        <td ${TD('text-align:right;white-space:nowrap')}>${dr ? `<span style="color:#dc2626;font-weight:600">${fMF(dr)}</span>` : ''}</td>
        <td ${TD('text-align:right;white-space:nowrap')}>${cr ? `<span style="color:#16a34a;font-weight:600">${fMF(cr)}</span>` : ''}</td>
        <td ${TD('text-align:right;white-space:nowrap')}><span style="color:${b.color};font-weight:700">${b.text}</span></td>
      </tr>`;
    });

    // Monthly total
    tbody += `<tr class="ldg-month-total">
      <td colspan="4" ${TD('text-align:right;font-weight:600;color:#333;background:#f0f0f0;font-size:11.5px')}>Monthly Total :</td>
      <td ${TD('text-align:right;font-weight:700;color:#dc2626;background:#f0f0f0;white-space:nowrap')}>${fMF(mD)}</td>
      <td ${TD('text-align:right;font-weight:700;color:#16a34a;background:#f0f0f0;white-space:nowrap')}>${fMF(mC)}</td>
      <td ${TD('background:#f0f0f0')}></td>
    </tr>`;
  });

  // Grand total
  const fb = _ldgBalStr((+ob || 0) + totalD - totalC);
  tbody += `<tr class="ldg-grand-total">
    <td colspan="4" ${TD('text-align:right;font-weight:700;color:#111;background:#ddd;font-size:12px')}>Grand Total :</td>
    <td ${TD('text-align:right;font-weight:700;color:#dc2626;background:#ddd;font-size:12.5px;white-space:nowrap')}>${fMF(totalD)}</td>
    <td ${TD('text-align:right;font-weight:700;color:#16a34a;background:#ddd;font-size:12.5px;white-space:nowrap')}>${fMF(totalC)}</td>
    <td ${TD('text-align:right;background:#ddd;white-space:nowrap')}><span style="color:${fb.color};font-weight:700;font-size:12.5px">${fb.text}</span></td>
  </tr>`;

  return `
  <div style="overflow-x:auto;background:#fff;border:1px solid #bbb;border-top:none;border-radius:0 0 6px 6px">
    <table class="ldg-crystal-tbl" style="width:100%;min-width:760px;border-collapse:collapse;font-family:'Inter',sans-serif">
      <thead><tr>
        <th style="${TH};width:75px;text-align:left">Voucher #</th>
        <th style="${TH};width:98px;text-align:left">Date</th>
        <th style="${TH};text-align:left">Particulars</th>
        <th style="${TH};width:78px;text-align:left">Chq No</th>
        <th style="${THR};width:118px">${esc(dLbl)}</th>
        <th style="${THR};width:118px">${esc(cLbl)}</th>
        <th style="${THR};width:128px">Balance</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>`;
}
