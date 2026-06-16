// ══ DOCUMENTS HUB — Nexunova RMS ════════════════════════════
// A central document generation center.
// All heavy printing is delegated to print.js functions.

const _DOC_TYPES = [
  {
    id:    'agreement',
    icon:  '',
    title: 'Sale Agreement',
    sub:   'Booking confirmation & sale contract',
    color: '#4F46E5',
    bg:    'rgba(79,70,229,0.08)',
    scope: 'unit-sold',
  },
  {
    id:    'statement',
    icon:  '',
    title: 'Account Statement',
    sub:   'Full payment history per client',
    color: '#0891B2',
    bg:    'rgba(8,145,178,0.08)',
    scope: 'client',
  },
  {
    id:    'demand',
    icon:  '',
    title: 'Demand Letter',
    sub:   'Overdue payment notice',
    color: '#DC2626',
    bg:    'rgba(220,38,38,0.08)',
    scope: 'unit-sold',
  },
  {
    id:    'unit-report',
    icon:  '',
    title: 'Unit Report',
    sub:   'Full unit detail & financial summary',
    color: '#7C3AED',
    bg:    'rgba(124,58,237,0.08)',
    scope: 'unit-any',
    hideInHub: true,   // moved to the "Reports & Ledgers" sidebar group (2026-06-16)
  },
  {
    id:    'schedule',
    icon:  '',
    title: 'Payment Schedule',
    sub:   'Installment plan for a sold unit',
    color: '#059669',
    bg:    'rgba(5,150,105,0.08)',
    scope: 'unit-sold',
    hideInHub: true,   // moved to the "Reports & Ledgers" sidebar group (2026-06-16)
  },
  {
    id:    'inventory',
    icon:  '',
    title: 'Inventory List',
    sub:   'Full unit inventory printout',
    color: '#92400E',
    bg:    'rgba(146,64,14,0.08)',
    scope: 'none',
  },
];

let _docActive = null;   // currently selected doc type id
let _docSearch = '';     // search input value

function rDocs(preselect) {
  const el = document.getElementById('pg-documents');
  if (!el) return;
  _docActive = null;
  _docSearch = '';

  el.innerHTML = `
  <div class="ani">
    <div class="ph">
      <div class="ph-l">
        <h2>Documents & Print</h2>
        <p>Generate professional documents — agreements, statements, demand letters, reports</p>
      </div>
    </div>

    <!-- Document type cards (hideInHub types live in the Reports & Ledgers sidebar group) -->
    <div class="doc-grid" id="doc-card-grid">
      ${_DOC_TYPES.filter(d => !d.hideInHub).map(d => `
      <div class="doc-card" id="doc-card-${d.id}" onclick="_docSelect('${d.id}')"
           style="--doc-color:${d.color};--doc-bg:${d.bg}">
        <div class="doc-card-icon">${d.icon}</div>
        <div class="doc-card-title">${d.title}</div>
        <div class="doc-card-sub">${d.sub}</div>
        <div class="doc-card-arrow">→</div>
      </div>`).join('')}
    </div>

    <!-- Picker panel (shown after selecting a doc type) -->
    <div class="doc-panel" id="doc-panel" style="display:none">
      <div id="doc-panel-inner"></div>
    </div>
  </div>`;

  // Deep-link: nav('documents','schedule'|'unit-report') opens that picker directly
  // (these types were moved out of the hub grid into Reports & Ledgers).
  if (preselect && _DOC_TYPES.some(d => d.id === preselect)) _docSelect(preselect);
}

function _docSelect(id) {
  _docActive = id;
  _docSearch = '';

  // Highlight selected card
  document.querySelectorAll('.doc-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById('doc-card-' + id);
  if (card) card.classList.add('active');

  const type = _DOC_TYPES.find(d => d.id === id);
  const panel = document.getElementById('doc-panel');
  const inner = document.getElementById('doc-panel-inner');
  if (!panel || !inner || !type) return;

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (type.scope === 'none') {
    // No picker needed — generate directly
    inner.innerHTML = `
      <div class="doc-panel-hd">
        <span class="doc-panel-icon">${type.icon}</span>
        <div>
          <div class="doc-panel-title">${type.title}</div>
          <div class="doc-panel-sub">No subject needed — prints the full inventory list</div>
        </div>
      </div>
      <div class="doc-panel-actions">
        <button class="btn btn-g" onclick="_docGenerate()" style="height:38px;font-size:13px;padding:0 20px">
          🖨 Generate & Print
        </button>
      </div>`;
    return;
  }

  const isClient = type.scope === 'client';
  const placeholder = isClient
    ? 'Search by name, CNIC, phone, or code…'
    : 'Search by unit number, client name, or project…';

  inner.innerHTML = `
    <div class="doc-panel-hd">
      <span class="doc-panel-icon">${type.icon}</span>
      <div>
        <div class="doc-panel-title">${type.title}</div>
        <div class="doc-panel-sub">Select a ${isClient ? 'client' : 'unit'} to generate this document</div>
      </div>
    </div>
    <div class="sbar" style="max-width:480px;margin:14px 0 10px">
      <span class="sbar-ic"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
      <input class="sinp" id="doc-search-inp" placeholder="${placeholder}"
        oninput="_docSearchChange(this.value)" autocomplete="off">
    </div>
    <div id="doc-results" class="doc-results"></div>`;

  document.getElementById('doc-search-inp')?.focus();
  _docRenderResults('');
}

function _docSearchChange(q) {
  _docSearch = q;
  _docRenderResults(q);
}

function _docRenderResults(q) {
  const el = document.getElementById('doc-results');
  if (!el || !_docActive) return;

  const type = _DOC_TYPES.find(d => d.id === _docActive);
  if (!type) return;

  const lq = q.toLowerCase();

  if (type.scope === 'client') {
    let clients = gclients();
    if (lq) clients = clients.filter(c =>
      (c.fullName       || '').toLowerCase().includes(lq) ||
      (c.cnic           || '').toLowerCase().includes(lq) ||
      (c.phonePrimary   || '').toLowerCase().includes(lq) ||
      (c.clientCode     || '').toLowerCase().includes(lq)
    );
    clients = clients.slice(0, 12);

    if (!clients.length) {
      el.innerHTML = `<div class="doc-empty">No clients found</div>`;
      return;
    }
    el.innerHTML = clients.map(c => `
      <div class="doc-result-row" onclick="_docGenWithId('${c.id}')">
        <div class="doc-res-av">${ini(c.fullName||'?')}</div>
        <div class="doc-res-info">
          <div class="doc-res-name">${esc(c.fullName||'—')}</div>
          <div class="doc-res-sub">${esc(c.clientCode||'')} ${c.cnic?'· '+esc(c.cnic):''} ${c.phonePrimary?'· '+esc(c.phonePrimary):''}</div>
        </div>
        <button class="btn btn-g btn-sm" style="flex-shrink:0">Print</button>
      </div>`).join('');
    return;
  }

  // Unit-based
  let units = gunits();
  if (type.scope === 'unit-sold') units = units.filter(u => u.customerName && u.status !== 'Available' && u.status !== 'Dead');
  if (lq) units = units.filter(u =>
    (u.unitNo       || '').toLowerCase().includes(lq) ||
    (u.customerName || '').toLowerCase().includes(lq) ||
    (u.projectName  || '').toLowerCase().includes(lq)
  );
  units = units.slice(0, 12);

  if (!units.length) {
    el.innerHTML = `<div class="doc-empty">${type.scope === 'unit-sold' ? 'No sold units found' : 'No units found'}</div>`;
    return;
  }
  el.innerHTML = units.map(u => `
    <div class="doc-result-row" onclick="_docGenWithId('${u.id}')">
      <div class="doc-res-chip">${esc(u.unitNo||'?')}</div>
      <div class="doc-res-info">
        <div class="doc-res-name">${esc(u.customerName||'—')} ${u.customerName ? '' : '<span style="color:var(--t3);font-size:11px">(no client)</span>'}</div>
        <div class="doc-res-sub">${esc(u.projectName||'')} ${u.unitType?'· '+esc(u.unitType):''} ${u.status?'· '+esc(u.status):''}</div>
      </div>
      <button class="btn btn-g btn-sm" style="flex-shrink:0">Print</button>
    </div>`).join('');
}

async function _docGenWithId(id) {
  if (!_docActive) return;
  // Pre-load Supabase payments into grecs() cache before printing
  if (['agreement','demand','unit-report','schedule'].includes(_docActive)) {
    if (typeof _ensureUnitPaymentsLoaded === 'function') await _ensureUnitPaymentsLoaded(id);
  } else if (_docActive === 'statement') {
    const c = gclient(id);
    if (c) {
      const units = gunits().filter(u => u.customerId === id || u.customerName === c.fullName);
      if (typeof _ensureUnitPaymentsLoaded === 'function')
        await Promise.all(units.map(u => _ensureUnitPaymentsLoaded(u.id)));
    }
  }
  switch (_docActive) {
    case 'agreement':   printSaleAgreement(id);      break;
    case 'statement':   { const c = gclient(id); if(c) printClientStatement(c.fullName); } break;
    case 'demand':      printDemandLetter(id);        break;
    case 'unit-report': printUnitReport(id);          break;
    case 'schedule': {
      // Load full sale detail for this unit, then print schedule
      try {
        const { data: activeSale } = await supabase.rpc('get_active_sale_for_unit', { p_unit_id: id, p_company_id: S.cid });
        const saleId = activeSale?.id;
        if (!saleId) { toast('No active sale found for this unit','warn'); break; }
        const { data: res } = await supabase.rpc('get_sale_detail', { p_sale_id: saleId, p_company_id: S.cid });
        if (!res?.success) { toast('Could not load sale schedule','err'); break; }
        _salCurrentDetail = { ...res.sale, installments: res.installments || [] };
        printSaleDetail();
      } catch(e) { toast('Error loading schedule','err'); }
      break;
    }
    default: break;
  }
}

function _docGenerate() {
  if (!_docActive) return;
  if (_docActive === 'inventory') printInventoryList();
}

/* ── CSS (injected once) ───────────────────────────────────── */
(function _docInjectCSS() {
  if (document.getElementById('doc-hub-css')) return;
  const s = document.createElement('style');
  s.id = 'doc-hub-css';
  s.textContent = `
  .doc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
    margin-bottom: 20px;
  }
  .doc-card {
    background: var(--bg-surface, var(--surface2));
    border: 1.5px solid var(--border-color, var(--line));
    border-radius: 12px;
    padding: 20px 18px 16px;
    cursor: pointer;
    transition: border-color 150ms, box-shadow 150ms, transform 150ms;
    position: relative;
    overflow: hidden;
  }
  .doc-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: var(--doc-color);
    opacity: 0;
    transition: opacity 150ms;
  }
  .doc-card:hover {
    border-color: var(--doc-color);
    box-shadow: 0 4px 16px rgba(0,0,0,.10);
    transform: translateY(-2px);
  }
  .doc-card:hover::before { opacity: 1; }
  .doc-card.active {
    border-color: var(--doc-color);
    background: var(--doc-bg);
    box-shadow: 0 4px 16px rgba(0,0,0,.10);
  }
  .doc-card.active::before { opacity: 1; }
  .doc-card-icon { font-size: 28px; margin-bottom: 10px; }
  .doc-card-title { font-size: 13px; font-weight: 700; color: var(--text-primary, var(--t1)); margin-bottom: 4px; }
  .doc-card-sub   { font-size: 11px; color: var(--text-muted, var(--t3)); line-height: 1.4; }
  .doc-card-arrow { position: absolute; bottom: 14px; right: 16px; font-size: 16px; opacity: 0; color: var(--doc-color); transition: opacity 150ms; }
  .doc-card:hover .doc-card-arrow { opacity: 1; }

  .doc-panel {
    background: var(--bg-surface, var(--surface2));
    border: 1px solid var(--border-color, var(--line));
    border-radius: 12px;
    padding: 20px;
    margin-top: 4px;
  }
  .doc-panel-hd    { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
  .doc-panel-icon  { font-size: 28px; flex-shrink: 0; }
  .doc-panel-title { font-size: 15px; font-weight: 700; color: var(--text-primary, var(--t1)); }
  .doc-panel-sub   { font-size: 12px; color: var(--text-muted, var(--t3)); margin-top: 2px; }
  .doc-panel-actions { margin-top: 16px; }

  .doc-results { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
  .doc-result-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--border-color, var(--line));
    border-radius: 8px;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .doc-result-row:hover { background: var(--bg-elevated, var(--canvas)); border-color: var(--primary, var(--brand)); }
  .doc-res-av   { width: 36px; height: 36px; border-radius: 50%; background: var(--primary, var(--brand)); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
  .doc-res-chip { min-width: 60px; height: 28px; background: var(--primary, var(--brand)); color: #fff; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: monospace; padding: 0 8px; flex-shrink: 0; }
  .doc-res-info { flex: 1; min-width: 0; }
  .doc-res-name { font-size: 13px; font-weight: 600; color: var(--text-primary, var(--t1)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .doc-res-sub  { font-size: 11px; color: var(--text-muted, var(--t3)); margin-top: 2px; }
  .doc-empty    { padding: 24px; text-align: center; color: var(--text-muted, var(--t3)); font-size: 13px; }
  `;
  document.head.appendChild(s);
})();
