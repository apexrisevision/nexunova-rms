// ══════════════════════════════════════════════════════════════════════════
// PDC REGISTER — Phase 3F · rebuilt on the nx- foundation kit
// ──────────────────────────────────────────────────────────────────────────
// RMS owns the cheque's OPERATIONAL lifecycle (in-hand → due → deposited →
// cleared/bounced → replaced). The accounting entry lives in QuickBooks — RMS
// never does double-entry. Clearing a cheque is the ONLY money path: it creates
// the actual payment (mode cheque, created_by set) so it flows into RP/Collections.
//
// Tabs (mapped onto the existing free-text status column):
//   In hand   = pending & cheque_date  >  today+7
//   Due soon  = pending & cheque_date  <= today+7  (incl. overdue / today)
//   Deposited = presented   ·  Cleared = cleared
//   Bounced   = bounced     ·  Replaced = replaced
//
// Guard: a cheque can be Cleared only from Deposited (enforced in mark_pdc_cleared).
// Bounce creates a contact_logs recovery follow-up — never a payment.
// Replace is note-based this phase (a proper replacement FK is register #18).
// RPCs: get_pdc_register, create_pdc_bundle, mark_pdc_deposited/cleared/bounced,
//       update_pdc_cheque, get_unit_payment_summary.
// ══════════════════════════════════════════════════════════════════════════

let _pdcRows   = [];
let _pdcTab    = 'all';
let _pdcFilter = { project:'', bank:'', fr:'', to:'', q:'' };
let _pdcBundle = { sale:null, lines:[] };

const _PDC_TABS = [
  { key:'all',       label:'All' },
  { key:'in_hand',   label:'In hand' },
  { key:'due_soon',  label:'Due soon' },
  { key:'deposited', label:'Deposited' },
  { key:'cleared',   label:'Cleared' },
  { key:'bounced',   label:'Bounced' },
  { key:'replaced',  label:'Replaced' },
];

function _pdcToday() { return (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10); }
// Date math in UTC so a positive local offset (e.g. PKT UTC+5) never shifts the day.
function _pdcAddMonths(iso, n) { const p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1 + n, p[2])).toISOString().slice(0, 10); }
function _pdcDays(iso) { if (!iso) return null; const a = iso.split('-').map(Number), b = _pdcToday().split('-').map(Number);
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000); }
function _pdcIsAdmin() { return S.role === 'admin' || S.role === 'owner'; }

// Logical tab bucket for a register row.
function _pdcBucket(r) {
  const st = (r.status || '').toLowerCase();
  if (st === 'presented') return 'deposited';
  if (st === 'cleared')   return 'cleared';
  if (st === 'bounced')   return 'bounced';
  if (st === 'replaced')  return 'replaced';
  if (st === 'pending') {
    const d = _pdcDays(r.cheque_date);
    return (d != null && d <= 7) ? 'due_soon' : 'in_hand';
  }
  return 'in_hand';
}

// ── Page shell ──────────────────────────────────────────────────────────────
function rPDC() {
  const pg = document.getElementById('pg-pdc');
  if (!pg) return;
  pg.innerHTML =
    NX.pageHeader('PDC Register',
      (_pdcIsAdmin() ? NX.button('New cheque bundle', { variant:'primary', icon:'plus', onclick:'_pdcOpenBundle()' }) : ''),
      { icon:'calendar-clock' }) +
    '<div id="pdc-summary"></div>' +
    '<div id="pdc-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:var(--fk-sp-4,16px) 0 var(--fk-sp-3,12px)"></div>' +
    NX.card(
      '<div style="display:flex;gap:var(--fk-sp-2,8px);flex-wrap:wrap;align-items:flex-end">' +
        '<div class="nx-field" style="flex:1;min-width:200px;margin:0"><label class="nx-label">Search</label>' +
          '<input class="nx-input" id="pdc-q" placeholder="Client, bank, cheque no, unit…" autocomplete="off" oninput="_pdcFilter.q=this.value;_pdcRenderTable()"></div>' +
        '<div class="nx-field" style="margin:0"><label class="nx-label">Project</label><select class="nx-select" id="pdc-project" onchange="_pdcFilter.project=this.value;_pdcLoad()"></select></div>' +
        '<div class="nx-field" style="margin:0"><label class="nx-label">Bank</label><select class="nx-select" id="pdc-bank" onchange="_pdcFilter.bank=this.value;_pdcRenderTable()"></select></div>' +
        '<div class="nx-field" style="margin:0"><label class="nx-label">From</label><input class="nx-input" type="date" id="pdc-fr" onchange="_pdcFilter.fr=this.value;_pdcLoad()"></div>' +
        '<div class="nx-field" style="margin:0"><label class="nx-label">To</label><input class="nx-input" type="date" id="pdc-to" onchange="_pdcFilter.to=this.value;_pdcLoad()"></div>' +
      '</div>', { compact:true }) +
    '<div id="pdc-table" style="margin-top:var(--fk-sp-3,12px)"></div>' +
    '<div id="pdc-modal-host"></div>';
  _pdcLoad();
}

async function _pdcLoad() {
  const host = document.getElementById('pdc-table');
  if (host) host.innerHTML = NX.card(NX.empty({ icon:'info', message:'Loading cheques…' }));
  try {
    const { data, error } = await supabase.rpc('get_pdc_register', {
      p_company_id: S.cid, p_status: 'All',
      p_project_id: _pdcFilter.project || null,
      p_date_from:  _pdcFilter.fr || null,
      p_date_to:    _pdcFilter.to || null
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed to load');
    _pdcRows = data.rows || [];
    _pdcSyncFilters();
    _pdcRenderSummary();
    _pdcRenderTabs();
    _pdcRenderTable();
  } catch (e) {
    if (host) host.innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'Could not load PDC register — ' + (e.message || 'error') }));
  }
}

// Populate the project + bank selects (preserving current choices).
function _pdcSyncFilters() {
  const proj = document.getElementById('pdc-project');
  if (proj && !proj.dataset.filled) {
    const ps = (window._projectsCache || []);
    proj.innerHTML = '<option value="">All projects</option>' +
      ps.map(p => '<option value="' + p.id + '">' + NX.esc(p.name || p.projectName || '?') + '</option>').join('');
    proj.value = _pdcFilter.project || '';
    proj.dataset.filled = '1';
  }
  const bank = document.getElementById('pdc-bank');
  if (bank) {
    const banks = [...new Set(_pdcRows.map(r => r.bank_name).filter(Boolean))].sort();
    bank.innerHTML = '<option value="">All banks</option>' + banks.map(b => '<option value="' + NX.esc(b) + '">' + NX.esc(b) + '</option>').join('');
    bank.value = _pdcFilter.bank || '';
  }
}

// ── Header summary (count + amount per status) ──────────────────────────────
function _pdcRenderSummary() {
  const el = document.getElementById('pdc-summary');
  if (!el) return;
  const groups = {};
  _PDC_TABS.forEach(t => { if (t.key !== 'all') groups[t.key] = { c:0, a:0 }; });
  let tc = 0, ta = 0;
  _pdcRows.forEach(r => { const b = _pdcBucket(r); const a = Number(r.amount || 0); groups[b].c++; groups[b].a += a; tc++; ta += a; });

  const card = (label, c, a, tone) =>
    '<div style="flex:1;min-width:150px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-card,12px);background:var(--fk-bg-card);padding:var(--fk-sp-3,12px) var(--fk-sp-4,16px)">' +
      '<div style="font-size:var(--fk-fs-label,11px);color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.4px">' + label + '</div>' +
      '<div class="num" style="font-size:var(--fk-fs-kpi,20px);color:var(--fk-' + tone + ',var(--fk-text))">' + c + '</div>' +
      '<div class="num" style="font-size:var(--fk-fs-label,11px);color:var(--fk-text-muted)">PKR ' + fM(a) + '</div>' +
    '</div>';

  el.innerHTML = '<div style="display:flex;gap:var(--fk-sp-2,8px);flex-wrap:wrap">' +
    card('Cheques', tc, ta, 'text') +
    card('In hand',   groups.in_hand.c,   groups.in_hand.a,   'info') +
    card('Due soon',  groups.due_soon.c,  groups.due_soon.a,  'warning') +
    card('Deposited', groups.deposited.c, groups.deposited.a, 'info') +
    card('Cleared',   groups.cleared.c,   groups.cleared.a,   'success') +
    card('Bounced',   groups.bounced.c,   groups.bounced.a,   'danger') +
  '</div>';
}

function _pdcRenderTabs() {
  const el = document.getElementById('pdc-tabs');
  if (!el) return;
  const counts = {}; _pdcRows.forEach(r => { const b = _pdcBucket(r); counts[b] = (counts[b] || 0) + 1; });
  el.innerHTML = _PDC_TABS.map(t => {
    const n = t.key === 'all' ? _pdcRows.length : (counts[t.key] || 0);
    const active = _pdcTab === t.key;
    return NX.button(t.label + ' · ' + n, { variant: active ? 'primary' : 'secondary', size:'sm', onclick:"_pdcTabSet('" + t.key + "')" });
  }).join('');
}

function _pdcTabSet(tab) { _pdcTab = tab; _pdcRenderTabs(); _pdcRenderTable(); }

function _pdcVisibleRows() {
  const q = (_pdcFilter.q || '').toLowerCase().trim();
  return _pdcRows
    .filter(r => _pdcTab === 'all' || _pdcBucket(r) === _pdcTab)
    .filter(r => !_pdcFilter.bank || r.bank_name === _pdcFilter.bank)
    .filter(r => !q
      || (r.client_name || '').toLowerCase().includes(q)
      || (r.bank_name || '').toLowerCase().includes(q)
      || (r.cheque_no || '').toLowerCase().includes(q)
      || (r.unit_no || '').toLowerCase().includes(q))
    .sort((a, b) => (a.cheque_date || '').localeCompare(b.cheque_date || ''));
}

function _pdcStatusChip(r) {
  const b = _pdcBucket(r);
  const map = { in_hand:['In hand','info'], due_soon:['Due soon','warning'], deposited:['Deposited','info'],
                cleared:['Cleared','success'], bounced:['Bounced','danger'], replaced:['Replaced',''] };
  const [lbl, tone] = map[b] || ['—', ''];
  return NX.badge(lbl, tone, { dot: b === 'due_soon' || b === 'bounced' });
}

function _pdcDueCell(r) {
  if ((r.status || '').toLowerCase() !== 'pending') return '<span style="color:var(--fk-text-muted)">—</span>';
  const d = _pdcDays(r.cheque_date);
  if (d == null) return '<span style="color:var(--fk-text-muted)">—</span>';
  if (d < 0)  return '<span class="num" style="color:var(--fk-danger)">' + Math.abs(d) + 'd overdue</span>';
  if (d === 0) return '<span class="num" style="color:var(--fk-danger)">Today</span>';
  return '<span class="num" style="color:' + (d <= 7 ? 'var(--fk-warning)' : 'var(--fk-text-muted)') + '">in ' + d + 'd</span>';
}

function _pdcActions(r) {
  if (!_pdcIsAdmin()) return '';
  const st = (r.status || '').toLowerCase();
  const b = [];
  if (st === 'pending') {
    b.push(NX.button('Deposit', { variant:'secondary', size:'sm', onclick:"_pdcDeposit('" + r.id + "')" }));
    b.push(NX.button('Replace', { variant:'ghost', size:'sm', onclick:"_pdcOpenReplace('" + r.id + "')" }));
  } else if (st === 'presented') {
    b.push(NX.button('Clear',   { variant:'primary', size:'sm', onclick:"_pdcOpenClear('" + r.id + "')" }));
    b.push(NX.button('Bounce',  { variant:'danger',  size:'sm', onclick:"_pdcOpenBounce('" + r.id + "')" }));
    b.push(NX.button('Replace', { variant:'ghost',   size:'sm', onclick:"_pdcOpenReplace('" + r.id + "')" }));
  } else if (st === 'bounced') {
    b.push(NX.button('Replace', { variant:'secondary', size:'sm', onclick:"_pdcOpenReplace('" + r.id + "')" }));
  }
  return '<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' + b.join('') + '</div>';
}

function _pdcRenderTable() {
  _pdcRenderTabs();
  const host = document.getElementById('pdc-table');
  if (!host) return;
  const rows = _pdcVisibleRows();
  if (!rows.length) {
    host.innerHTML = NX.card(NX.empty({ icon:'inbox', message:'No cheques in this view.' }));
    return;
  }
  const isA = _pdcIsAdmin();
  const cols = [
    { label:'Cheque no' }, { label:'Bank' }, { label:'Client' }, { label:'Unit / Sale' },
    { label:'Cheque date' }, { label:'Amount', num:true }, { label:'Status' }, { label:'Due', num:true }
  ];
  if (isA) cols.push({ label:'', num:true, width:'220px' });

  const trows = rows.map(r => {
    const cells = [
      '<span class="num">' + NX.esc(r.cheque_no || '—') + '</span>',
      NX.esc(r.bank_name || '—'),
      NX.esc(r.client_name || '—'),
      NX.esc(r.unit_no || '—') + (r.sale_number ? ' · <span style="color:var(--fk-text-muted)">' + NX.esc(r.sale_number) + '</span>' : ''),
      r.cheque_date ? fD(r.cheque_date) : '—',
      '<span class="num">PKR ' + fM(r.amount || 0) + '</span>',
      _pdcStatusChip(r) + _pdcReplacedLink(r),
      _pdcDueCell(r)
    ];
    if (isA) cells.push(_pdcActions(r));
    return cells;
  });
  host.innerHTML = NX.card(NX.table({ cols, rows: trows, flush:true }), { flush:true });
}

// "Replaced by #<cheque_no>" link under a replaced cheque (#18 — resolved
// client-side from replaced_by_id against the loaded rows; click surfaces it).
function _pdcReplacedLink(r) {
  if (String(r.status || '').toLowerCase() !== 'replaced' || !r.replaced_by_id) return '';
  const repl = _pdcRows.find(x => String(x.id) === String(r.replaced_by_id));
  const label = '#' + ((repl && repl.cheque_no) || '—');
  return '<div class="nx-kpi-label" style="text-transform:none;margin-top:2px">Replaced by '
    + (repl ? '<a style="color:var(--fk-info);cursor:pointer" onclick="_pdcScrollToCheque(\'' + repl.id + '\')">' + NX.esc(label) + '</a>'
            : NX.esc(label)) + '</div>';
}
function _pdcScrollToCheque(id) {
  const repl = _pdcRows.find(x => String(x.id) === String(id)); if (!repl) return;
  _pdcTab = _pdcBucket(repl);                     // jump to the tab holding the replacement
  _pdcFilter.q = repl.cheque_no || '';
  const qEl = document.getElementById('pdc-q'); if (qEl) qEl.value = _pdcFilter.q;
  _pdcRenderTabs(); _pdcRenderTable();
}

// ══ MODAL PLUMBING ══════════════════════════════════════════════════════════
function _pdcModal(html) { document.getElementById('pdc-modal-host').innerHTML = html; }
function _pdcCloseModal() { const h = document.getElementById('pdc-modal-host'); if (h) h.innerHTML = ''; }
function _pdcRow(id) { return _pdcRows.find(r => String(r.id) === String(id)); }

// ── Deposit ─────────────────────────────────────────────────────────────────
function _pdcDeposit(id) {
  const r = _pdcRow(id); if (!r) return;
  _pdcModal(NX.modal({
    title: 'Mark deposited — ' + (r.cheque_no || ''), size:'s', onClose:'_pdcCloseModal()',
    body: NX.field({ label:'Deposit date', name:'pdc-dep-date', type:'date', value:_pdcToday(), required:true }),
    footer: NX.button('Cancel', { variant:'ghost', onclick:'_pdcCloseModal()' }) +
            NX.button('Confirm deposit', { variant:'primary', attrs:'id="pdc-dep-btn"', onclick:"_pdcConfirmDeposit('" + id + "')" })
  }));
}
async function _pdcConfirmDeposit(id) {
  const date = document.getElementById('pdc-dep-date')?.value;
  if (!date) { toast('Enter the deposit date', 'warn'); return; }
  await _pdcRun('pdc-dep-btn', () => supabase.rpc('mark_pdc_deposited', { p_cheque_id:id, p_company_id:S.cid, p_deposit_date:date }), 'Cheque marked deposited');
}

// ── Clear (Deposited only → creates the payment) ────────────────────────────
function _pdcOpenClear(id) {
  const r = _pdcRow(id); if (!r) return;
  _pdcModal(NX.modal({
    title: 'Clear cheque — ' + (r.cheque_no || ''), size:'s', onClose:'_pdcCloseModal()',
    body:
      NX.banner('Clearing creates a payment of PKR ' + fM(r.amount || 0) + ' (mode cheque) — it flows into Collections & Recovery.', 'info') +
      NX.field({ label:'Cleared date', name:'pdc-clr-date', type:'date', value:_pdcToday(), required:true }) +
      NX.field({ label:'Deposit reference', name:'pdc-clr-ref', placeholder:'Bank slip / reference (optional)' }),
    footer: NX.button('Cancel', { variant:'ghost', onclick:'_pdcCloseModal()' }) +
            NX.button('Confirm cleared', { variant:'primary', attrs:'id="pdc-clr-btn"', onclick:"_pdcConfirmClear('" + id + "')" })
  }));
}
async function _pdcConfirmClear(id) {
  const date = document.getElementById('pdc-clr-date')?.value;
  const ref  = (document.getElementById('pdc-clr-ref')?.value || '').trim();
  if (!date) { toast('Enter the cleared date', 'warn'); return; }
  await _pdcRun('pdc-clr-btn', () => supabase.rpc('mark_pdc_cleared', { p_cheque_id:id, p_company_id:S.cid, p_cleared_date:date, p_deposit_ref:ref || null }), 'Cheque cleared — payment created');
}

// ── Bounce (creates a recovery follow-up; never a payment) ──────────────────
const _PDC_BOUNCE = ['Insufficient funds','Signature mismatch','Account closed','Payment stopped','Stale / expired','Other'];
function _pdcOpenBounce(id) {
  const r = _pdcRow(id); if (!r) return;
  _pdcModal(NX.modal({
    title: 'Mark bounced — ' + (r.cheque_no || ''), size:'s', onClose:'_pdcCloseModal()',
    body:
      NX.field({ label:'Bounce date', name:'pdc-bnc-date', type:'date', value:_pdcToday(), required:true }) +
      NX.field({ label:'Reason', name:'pdc-bnc-reason', el:'select', options:_PDC_BOUNCE.map(x => ({ value:x, label:x })) }) +
      NX.banner('A recovery follow-up will be created for this client. No payment is booked.', 'warn'),
    footer: NX.button('Cancel', { variant:'ghost', onclick:'_pdcCloseModal()' }) +
            NX.button('Confirm bounced', { variant:'danger', attrs:'id="pdc-bnc-btn"', onclick:"_pdcConfirmBounce('" + id + "')" })
  }));
}
async function _pdcConfirmBounce(id) {
  const date   = document.getElementById('pdc-bnc-date')?.value;
  const reason = document.getElementById('pdc-bnc-reason')?.value;
  if (!date) { toast('Enter the bounce date', 'warn'); return; }
  await _pdcRun('pdc-bnc-btn', () => supabase.rpc('mark_pdc_bounced', { p_cheque_id:id, p_company_id:S.cid, p_bounce_date:date, p_bounce_reason:reason || null }), 'Cheque bounced — follow-up created');
}

// ── Replace (note-based; old → replaced, new cheque entered) ─────────────────
function _pdcOpenReplace(id) {
  const r = _pdcRow(id); if (!r) return;
  _pdcModal(NX.modal({
    title: 'Replace cheque — ' + (r.cheque_no || ''), size:'m', onClose:'_pdcCloseModal()',
    body:
      NX.banner('The old cheque is marked Replaced (linked by note). Enter the replacement cheque below.', 'info') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3,12px)">' +
        NX.field({ label:'New cheque no', name:'pdc-rep-no', required:true }) +
        NX.field({ label:'Bank', name:'pdc-rep-bank', value:r.bank_name || '' }) +
        NX.field({ label:'Cheque date', name:'pdc-rep-date', type:'date', value:_pdcToday(), required:true }) +
        NX.field({ label:'Amount (PKR)', name:'pdc-rep-amt', type:'number', value:r.amount || '', attrs:'min="1" step="0.01" class="nx-input num"' }) +
      '</div>',
    footer: NX.button('Cancel', { variant:'ghost', onclick:'_pdcCloseModal()' }) +
            NX.button('Confirm replacement', { variant:'primary', attrs:'id="pdc-rep-btn"', onclick:"_pdcConfirmReplace('" + id + "')" })
  }));
}
async function _pdcConfirmReplace(id) {
  const r = _pdcRow(id); if (!r) return;
  const no   = (document.getElementById('pdc-rep-no')?.value || '').trim();
  const bank = (document.getElementById('pdc-rep-bank')?.value || '').trim();
  const date = document.getElementById('pdc-rep-date')?.value;
  const amt  = parseFloat(document.getElementById('pdc-rep-amt')?.value || '0');
  if (!no || !date || !(amt > 0)) { toast('New cheque needs a number, date and amount', 'warn'); return; }
  const btn = document.getElementById('pdc-rep-btn'); if (btn) { btn.disabled = true; }
  try {
    // 1. Enter the replacement cheque (bundle RPC sets project_id + client_id from the sale).
    const ins = await supabase.rpc('create_pdc_bundle', {
      p_company_id: S.cid, p_sale_id: r.sale_id,
      p_cheques: [{ cheque_no:no, bank_name:bank || null, amount:amt, cheque_date:date, notes:'Replaces cheque ' + (r.cheque_no || '') }]
    });
    if (ins.error) throw ins.error;
    if (!ins.data?.success) throw new Error(ins.data?.error || 'Could not create replacement');
    const newId = ins.data.ids && ins.data.ids[0];   // #18: FK link to the replacement cheque
    // 2. Mark the old cheque Replaced + set the FK (note kept for human readability).
    const note = ((r.notes ? r.notes + ' | ' : '') + 'Replaced by cheque ' + no).slice(0, 500);
    const upd = await supabase.rpc('update_pdc_cheque', { p_id:id, p_company_id:S.cid, p_data:{ status:'replaced', notes:note, replaced_by_id: newId || null } });
    if (upd.error) throw upd.error;
    if (!upd.data?.success) throw new Error(upd.data?.error || 'Could not mark replaced');
    toast('Cheque replaced — ' + no + ' entered', 'ok');
    _pdcCloseModal();
    await _pdcLoad();
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(e.message || 'Replace failed', 'err');
  }
}

// Shared runner for the single-RPC transitions.
async function _pdcRun(btnId, rpcFn, okMsg) {
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; }
  try {
    const { data, error } = await rpcFn();
    if (error) throw error;
    if (!data?.success) throw new Error(data?.message || data?.error || 'Failed');
    toast(okMsg, 'ok');
    _pdcCloseModal();
    await _pdcLoad();
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(e.message || 'Error', 'err');
  }
}

// ══ BUNDLE ENTRY ═════════════════════════════════════════════════════════════
// Pick a sold unit → resolve its sale → generate a sequential cheque preview →
// confirm → batch insert (create_pdc_bundle). A 36-cheque bundle in one pass.
function _pdcOpenBundle() {
  _pdcBundle = { sale:null, lines:[] };
  const sold = (window._unitsCache || []).filter(u => u.isAvailable === false);
  const opts = sold.map(u => {
    const pn = (window._projectsCache || []).find(p => p.id === u.projectId);
    return '<option value="' + u.id + '">' + NX.esc((u.customerName || '—') + ' · Unit ' + (u.unitNo || '') + (pn ? ' · ' + (pn.name || pn.projectName || '') : '')) + '</option>';
  }).join('');
  _pdcModal(NX.modal({
    title:'New cheque bundle', size:'l', onClose:'_pdcCloseModal()',
    body:
      '<div class="nx-field"><label class="nx-label">Sold unit <span class="nx-req">*</span></label>' +
        '<select class="nx-select" id="pdc-bnd-unit"><option value="">Select a sold unit…</option>' + opts + '</select></div>' +
      '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:var(--fk-sp-2,8px);align-items:end">' +
        NX.field({ label:'Start cheque no', name:'pdc-bnd-start', placeholder:'e.g. 100231' }) +
        NX.field({ label:'Bank', name:'pdc-bnd-bank' }) +
        NX.field({ label:'First date', name:'pdc-bnd-date', type:'date', value:_pdcToday() }) +
        NX.field({ label:'Amount each', name:'pdc-bnd-amt', type:'number', attrs:'min="1" step="0.01" class="nx-input num"' }) +
        NX.field({ label:'Count', name:'pdc-bnd-count', type:'number', value:'12', attrs:'min="1" max="120" class="nx-input num"' }) +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin:var(--fk-sp-2,8px) 0">' +
        NX.button('Generate preview', { variant:'secondary', size:'sm', onclick:'_pdcBundleGen()' }) + '</div>' +
      '<div id="pdc-bnd-preview"></div>',
    footer: NX.button('Cancel', { variant:'ghost', onclick:'_pdcCloseModal()' }) +
            NX.button('Confirm bundle', { variant:'primary', attrs:'id="pdc-bnd-btn" disabled', onclick:'_pdcBundleConfirm()' })
  }));
}

function _pdcBundleGen() {
  const start = (document.getElementById('pdc-bnd-start')?.value || '').trim();
  const bank  = (document.getElementById('pdc-bnd-bank')?.value || '').trim();
  const date0 = document.getElementById('pdc-bnd-date')?.value;
  const amt   = parseFloat(document.getElementById('pdc-bnd-amt')?.value || '0');
  const count = parseInt(document.getElementById('pdc-bnd-count')?.value || '0', 10);
  if (!start || !date0 || !(amt > 0) || !(count > 0)) { toast('Fill start no, first date, amount and count', 'warn'); return; }

  // Sequential cheque numbers: increment the trailing numeric block, preserving width.
  const m = start.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1] : start;
  const baseNum = m ? parseInt(m[2], 10) : 0;
  const width = m ? m[2].length : 0;
  const lines = [];
  for (let i = 0; i < count; i++) {
    const num = m ? String(baseNum + i).padStart(width, '0') : (start + '-' + (i + 1));
    lines.push({ cheque_no: m ? (prefix + num) : num, bank_name: bank, amount: amt, cheque_date: _pdcAddMonths(date0, i) });
  }
  _pdcBundle.lines = lines;

  const trows = lines.map((l, i) =>
    '<tr><td class="num">' + (i + 1) + '</td>' +
    '<td><input class="nx-input num" style="height:28px" value="' + NX.esc(l.cheque_no) + '" oninput="_pdcBundle.lines[' + i + '].cheque_no=this.value"></td>' +
    '<td><input class="nx-input" style="height:28px" value="' + NX.esc(l.bank_name) + '" oninput="_pdcBundle.lines[' + i + '].bank_name=this.value"></td>' +
    '<td><input class="nx-input" style="height:28px" type="date" value="' + l.cheque_date + '" oninput="_pdcBundle.lines[' + i + '].cheque_date=this.value"></td>' +
    '<td><input class="nx-input num" style="height:28px" type="number" value="' + l.amount + '" oninput="_pdcBundle.lines[' + i + '].amount=parseFloat(this.value)||0"></td></tr>'
  ).join('');
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  document.getElementById('pdc-bnd-preview').innerHTML =
    '<div style="font-size:var(--fk-fs-label,11px);color:var(--fk-text-muted);margin:8px 0 6px">' + count + ' cheques · total PKR ' + fM(total) + ' (edit any line below)</div>' +
    '<div style="max-height:280px;overflow:auto;border:1px solid var(--fk-border);border-radius:var(--fk-radius-card,12px)">' +
    '<table class="nx-table nx-table--flush"><thead><tr><th class="num">#</th><th>Cheque no</th><th>Bank</th><th>Cheque date</th><th class="num">Amount</th></tr></thead><tbody>' +
    trows + '</tbody></table></div>';
  const btn = document.getElementById('pdc-bnd-btn'); if (btn) btn.disabled = false;
}

async function _pdcBundleConfirm() {
  const unitId = document.getElementById('pdc-bnd-unit')?.value;
  if (!unitId) { toast('Select a sold unit', 'warn'); return; }
  if (!_pdcBundle.lines.length) { toast('Generate the preview first', 'warn'); return; }
  const btn = document.getElementById('pdc-bnd-btn'); if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Saving…'; }
  try {
    // Resolve the sale for the chosen unit.
    const sum = await supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid });
    const saleId = sum.data?.sale?.sale_id;
    if (!saleId) throw new Error('No active sale for that unit');
    const { data, error } = await supabase.rpc('create_pdc_bundle', { p_company_id: S.cid, p_sale_id: saleId, p_cheques: _pdcBundle.lines });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Bundle failed');
    toast(data.count + ' cheques added to the PDC register', 'ok');
    _pdcCloseModal();
    await _pdcLoad();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Confirm bundle'; }
    toast(e.message || 'Bundle failed', 'err');
  }
}
