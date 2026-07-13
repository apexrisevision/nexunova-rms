// ── Agent Transactions (warmth kit) ───────────────────────────────────────────
// Commission credits, deductions, adjustments and clawbacks per agent.
// RPCs untouched: list_agent_transactions · list_agents_lookup ·
//                 create_agent_transaction · delete_agent_transaction

let _atData       = null;
let _atTypeFilter = 'all';

// HARDEN (2026-06-13): the legacy form offered transaction_type values
// (commission_credit/deduction/adjustment/advance/bonus) that the DB CHECK
// constraint rejects — only commission_paid·clawback·adjustment_debit·
// adjustment_credit·write_off are valid, and create_agent_transaction inserts
// the value raw (no remap). So every manual entry except "clawback" silently
// 400'd. Options below now match the constraint exactly.
const _AT_TYPES = [
  ['adjustment_credit', 'Adjustment (Credit)'],
  ['commission_paid',   'Commission Paid'],
  ['adjustment_debit',  'Adjustment (Debit)'],
  ['clawback',          'Clawback (Cancellation)'],
  ['write_off',         'Write-off'],
];
// System-written types — not offered in the manual-entry form.
// unit_cancelled / unit_transferred carry amount 0: they exist so the agent's ledger shows the
// unit left him. Commission is deliberately NOT reversed (owner decision 2026-07-13).
const _AT_SYSTEM_TYPES = [
  ['commission_accrued', 'Commission Accrued'],
  ['unit_cancelled',     'Unit Cancelled'],
  ['unit_transferred',   'Unit Transferred'],
];
const _AT_TYPE_LABELS = Object.fromEntries([..._AT_TYPES, ..._AT_SYSTEM_TYPES]);
// Record-only lines: no money moves, so they must not colour or count as credit/deduction.
const _atIsRecord = t => t === 'unit_cancelled' || t === 'unit_transferred';
// adjustment_credit and commission_accrued add to the agent's balance; the rest reduce/pay it.
const _atIsCredit = t => t === 'adjustment_credit' || t === 'commission_accrued';

async function rAgentTransactions() {
  const el = document.getElementById('pg-agenttransactions');
  if (!el) return;
  if (typeof _agCSS === 'function') _agCSS();
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Agent Transactions',
        NX.button('Refresh', { variant:'secondary', onclick:'_atLoad()' }) +
        (isA ? NX.button('Manual entry', { variant:'primary', icon:'plus', onclick:'_atOpenModal()' }) : ''),
        { icon:'banknote', sub:'Commission credits, deductions and adjustments for all agents.' }) +
      '<div class="agc-kpis" id="at-kpi"></div>' +
      `<div class="agc-toolbar">
        <select id="at-agent-filter" class="nx-select" style="max-width:240px" onchange="_atFilterRender()"><option value="">All agents</option></select>
        <span id="at-tabs"></span>
      </div>` +
      '<div id="at-body">' + NX.card(NX.empty({ icon:'banknote', message:'Loading…' })) + '</div>' +
    '</div>';

  _atRenderTabs();
  await _atLoad();
  _atPopulateFilters();
}

function _atRenderTabs() {
  const el = document.getElementById('at-tabs');
  if (!el) return;
  el.innerHTML = NX.tabs({ tabs: [
    { k:'all',    label:'All' },
    { k:'credit', label:'Credits' },
    { k:'debit',  label:'Deductions' },
    { k:'record', label:'Cancelled / Transferred' }
  ], active:_atTypeFilter, onSelect:"_atSetType('%k')" });
}

function _atSetType(t) { _atTypeFilter = t; _atRenderTabs(); _atFilterRender(); }

function _atFilterRender() {
  const agentId = (document.getElementById('at-agent-filter') || {}).value || '';
  let rows = _atData || [];
  if (agentId) rows = rows.filter(r => r.agent_id === agentId);
  if (_atTypeFilter === 'credit') rows = rows.filter(r => !_atIsRecord(r.transaction_type) && _atIsCredit(r.transaction_type));
  if (_atTypeFilter === 'debit')  rows = rows.filter(r => !_atIsRecord(r.transaction_type) && !_atIsCredit(r.transaction_type));
  if (_atTypeFilter === 'record') rows = rows.filter(r => _atIsRecord(r.transaction_type));
  _atRender(rows);
}

async function _atLoad() {
  const { data } = await supabase.rpc('list_agent_transactions', { p_company_id: S.cid, p_filters: {} });
  _atData = data || [];
  _atFilterRender();
}

async function _atPopulateFilters() {
  const { data } = await supabase.rpc('list_agents_lookup', { p_company_id: S.cid });
  const filterSel = document.getElementById('at-agent-filter');
  const modalSel  = document.getElementById('at-agent_id');
  if (!data) return;
  data.forEach(a => {
    const opt = `<option value="${a.id}">${esc(a.agent_name)} (${a.agent_code || '—'})</option>`;
    if (filterSel) filterSel.insertAdjacentHTML('beforeend', opt);
    if (modalSel)  modalSel.insertAdjacentHTML('beforeend', opt);
  });
}

function _atRender(rows) {
  const bodyEl = document.getElementById('at-body');
  const kpiEl  = document.getElementById('at-kpi');
  if (!bodyEl) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  const money   = (rows||[]).filter(r => !_atIsRecord(r.transaction_type));
  const credits = money.filter(r =>  _atIsCredit(r.transaction_type)).reduce((s, r) => s + Number(r.amount || 0), 0);
  const debits  = money.filter(r => !_atIsCredit(r.transaction_type)).reduce((s, r) => s + Number(r.amount || 0), 0);

  if (kpiEl) {
    kpiEl.innerHTML =
      NX.kpi({ icon:'hand-coins',   tone:'success', label:'Credits',    value:`PKR ${_atK(credits)}` }) +
      NX.kpi({ icon:'x-circle',     tone:'danger',  label:'Deductions', value:`PKR ${_atK(debits)}` }) +
      NX.kpi({ icon:'banknote',     label:'Net',     value:`PKR ${_atK(credits - debits)}` }) +
      NX.kpi({ icon:'list',         label:'Records', value:String((rows||[]).length) });
  }

  if (!rows || !rows.length) {
    bodyEl.innerHTML = NX.card(NX.empty({ icon:'banknote', message:'No transactions found.' }));
    return;
  }

  bodyEl.innerHTML = NX.card(
    `<table class="nx-table"><thead><tr>
        <th>Agent</th><th>Type</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th>Date</th>${isA?'<th class="num"></th>':''}
      </tr></thead><tbody>
      ${rows.map(r => {
        const record = _atIsRecord(r.transaction_type);
        const credit = _atIsCredit(r.transaction_type);
        const label  = _AT_TYPE_LABELS[r.transaction_type] || r.transaction_type;
        return `<tr>
          <td><div style="font-weight:500">${esc(r.agents?.agent_name || '—')}</div><div class="nx-mono" style="font-size:11px;color:var(--fk-text-muted)">${esc(r.agents?.agent_code || '')}</div></td>
          <td>${NX.badge(label, record ? 'warning' : (credit ? 'success' : 'danger'))}
              ${record && r.notes ? `<div style="font-size:11px;color:var(--fk-text-muted);margin-top:4px;max-width:340px">${esc(r.notes)}</div>` : ''}</td>
          <td class="num" style="font-weight:600;color:${record ? 'var(--fk-text-muted)' : (credit ? 'var(--fk-success)' : 'var(--fk-danger)')}">${record ? '—' : (credit ? '+' : '-') + fM(r.amount)}</td>
          <td style="color:var(--fk-text-muted)">${esc(r.payment_method || '—')}</td>
          <td class="nx-mono" style="color:var(--fk-text-muted)">${esc(r.reference || '—')}</td>
          <td style="color:var(--fk-text-muted)">${r.created_at ? fD(r.created_at.split('T')[0]) : '—'}</td>
          ${isA ? `<td class="num">${NX.button('Delete',{variant:'ghost',size:'sm',onclick:`_atDelete('${r.id}')`})}</td>` : ''}
        </tr>`;
      }).join('')}</tbody></table>`,
    { flush:true });
}

// Compact PKR for the KPI strip (falls back if _agK isn't present)
function _atK(n) {
  if (typeof _agK === 'function') return _agK(n);
  n = Number(n || 0); const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

// ── Manual entry — host-injected nx-modal ─────────────────────────────────────
function _atModalHost() {
  let h = document.getElementById('at-modal-host');
  if (!h) { h = document.createElement('div'); h.id = 'at-modal-host'; document.body.appendChild(h); }
  return h;
}
function _atCloseModal() { const h = document.getElementById('at-modal-host'); if (h) h.innerHTML = ''; }

function _atOpenModal() {
  const typeOpts = _AT_TYPES.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const methodOpts = '<option value="">— N/A —</option><option>Cash</option><option>Cheque</option><option>Bank Transfer</option><option>Online</option>';

  const body =
    `<div class="nx-field"><label class="nx-label" for="at-agent_id">Agent <span class="nx-req">*</span></label><select class="nx-select" id="at-agent_id"><option value="">— Select agent —</option></select></div>` +
    `<div class="nx-grid-2">` +
      `<div class="nx-field"><label class="nx-label" for="at-transaction_type">Transaction type <span class="nx-req">*</span></label><select class="nx-select" id="at-transaction_type">${typeOpts}</select></div>` +
      `<div class="nx-field"><label class="nx-label" for="at-amount">Amount <span class="nx-req">*</span></label><input class="nx-input" id="at-amount" type="number" step="0.01" min="0"></div>` +
    `</div>` +
    `<div class="nx-grid-2">` +
      `<div class="nx-field"><label class="nx-label" for="at-payment_method">Payment method</label><select class="nx-select" id="at-payment_method">${methodOpts}</select></div>` +
      `<div class="nx-field"><label class="nx-label" for="at-reference">Reference</label><input class="nx-input" id="at-reference" placeholder="Cheque #, voucher #…"></div>` +
    `</div>` +
    `<div class="nx-field"><label class="nx-label" for="at-notes">Notes</label><textarea class="nx-textarea" id="at-notes" rows="2"></textarea></div>` +
    `<div class="nx-error" id="at-modal-err"></div>`;

  _atModalHost().innerHTML = NX.modal({
    id:'at-modal', title:'Manual agent transaction', size:'m', onClose:'_atCloseModal()', body,
    footer: NX.button('Cancel', { variant:'secondary', onclick:'_atCloseModal()' }) +
            NX.button('Save', { variant:'primary', attrs:'id="at-save-btn"', onclick:'_atSave()' })
  });

  // Populate the agent dropdown inside the freshly-injected modal
  _atPopulateFilters();
}

async function _atSave() {
  const agentId = document.getElementById('at-agent_id').value;
  const txType  = document.getElementById('at-transaction_type').value;
  const amount  = document.getElementById('at-amount').value;
  const errEl   = document.getElementById('at-modal-err');
  if (!agentId || !amount) { errEl.textContent = 'Agent and amount are required.'; return; }

  const btn = document.getElementById('at-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const { error } = await supabase.rpc('create_agent_transaction', {
    p_company_id: S.cid,
    p_data: {
      agent_id: agentId,
      transaction_type: txType,
      amount: Number(amount),
      payment_method: document.getElementById('at-payment_method').value || null,
      reference: document.getElementById('at-reference').value.trim() || null,
      notes: document.getElementById('at-notes').value.trim() || null,
      created_by: S.name || S.email || 'Admin',
    }
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  if (error) { errEl.textContent = error.message; return; }
  _atCloseModal();
  await _atLoad();
  if (typeof toast === 'function') toast('Transaction recorded', 'ok');
}

async function _atDelete(id) {
  if (!confirm('Delete this transaction?')) return;
  await supabase.rpc('delete_agent_transaction', { p_id: id, p_company_id: S.cid });
  await _atLoad();
  if (typeof toast === 'function') toast('Deleted', 'ok');
}
