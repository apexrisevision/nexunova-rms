// ── Agent Transactions ────────────────────────────────────────────────────────
// Commission credits, deductions, adjustments, and clawbacks per agent

let _atData = null;

async function rAgentTransactions() {
  const el = document.getElementById('pg-agenttransactions');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Agent Transactions</h2><p>Commission credits, deductions &amp; adjustments for all agents</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_atLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-p btn-sm" onclick="_atOpenModal()">+ Manual Entry</button>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
    <label class="fl" style="margin:0;font-size:12px">Agent:</label>
    <select id="at-agent-filter" class="fi" style="width:220px;padding:5px 8px" onchange="_atFilterRender()">
      <option value="">All Agents</option>
    </select>
    <button class="btn btn-gh btn-xs at-ttab on" onclick="_atSetType('all',this)">All</button>
    <button class="btn btn-gh btn-xs at-ttab"    onclick="_atSetType('credit',this)">Credits</button>
    <button class="btn btn-gh btn-xs at-ttab"    onclick="_atSetType('debit',this)">Deductions</button>
  </div>
  <div id="at-kpi" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px"></div>
  <div id="at-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Modal -->
  <div id="at-modal" class="mo" style="display:none" onclick="if(event.target===this)_atCloseModal()">
    <div class="mo-box" style="max-width:460px">
      <div class="mo-hd"><span>Manual Agent Transaction</span><button class="mo-cl" onclick="_atCloseModal()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Agent *</label>
          <select id="at-agent_id" class="fi"><option value="">— Select agent —</option></select></div>
        <div class="fg"><label class="fl">Transaction Type *</label>
          <select id="at-transaction_type" class="fi">
            <option value="commission_credit">Commission Credit</option>
            <option value="commission_deduction">Commission Deduction</option>
            <option value="clawback">Clawback (Cancellation)</option>
            <option value="adjustment">Manual Adjustment</option>
            <option value="advance">Advance Payment</option>
            <option value="bonus">Bonus</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Amount *</label>
          <input type="number" id="at-amount" class="fi" step="0.01" min="0"></div>
        <div class="fg"><label class="fl">Payment Method</label>
          <select id="at-payment_method" class="fi">
            <option value="">— N/A —</option>
            <option>Cash</option><option>Cheque</option><option>Bank Transfer</option><option>Online</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Reference</label>
          <input id="at-reference" class="fi" placeholder="Cheque #, voucher #…"></div>
        <div class="fg"><label class="fl">Notes</label>
          <textarea id="at-notes" class="fi" rows="2"></textarea></div>
        <div id="at-modal-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_atCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="at-save-btn" onclick="_atSave()">Save</button>
      </div>
    </div>
  </div>`;

  await _atLoad();
  _atPopulateFilters();
}

let _atTypeFilter = 'all';
function _atSetType(t, el) {
  _atTypeFilter = t;
  document.querySelectorAll('.at-ttab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _atFilterRender();
}
function _atFilterRender() {
  const agentId = (document.getElementById('at-agent-filter') || {}).value || '';
  let rows = _atData || [];
  if (agentId) rows = rows.filter(r => r.agent_id === agentId);
  if (_atTypeFilter !== 'all') {
    if (_atTypeFilter === 'credit') rows = rows.filter(r => ['commission_credit','bonus','adjustment'].includes(r.transaction_type));
    if (_atTypeFilter === 'debit')  rows = rows.filter(r => ['commission_deduction','clawback','advance'].includes(r.transaction_type));
  }
  _atRender(rows);
}

async function _atLoad() {
  const { data } = await supabase
    .from('agent_transactions')
    .select(`*, agents(agent_name, agent_code)`)
    .eq('company_id', S.cid)
    .order('created_at', { ascending: false })
    .limit(500);
  _atData = data || [];
  _atFilterRender();
}

async function _atPopulateFilters() {
  const { data } = await supabase.from('agents').select('id, agent_name, agent_code').eq('company_id', S.cid).order('agent_name');
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

  const credits = (rows||[]).filter(r => ['commission_credit','bonus','adjustment'].includes(r.transaction_type))
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const debits  = (rows||[]).filter(r => ['commission_deduction','clawback','advance'].includes(r.transaction_type))
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  if (kpiEl) {
    kpiEl.innerHTML = [
      { l:'Credits', v:fM(credits), c:'var(--ok)' },
      { l:'Deductions', v:fM(debits), c:'var(--err)' },
      { l:'Net', v:fM(credits - debits), c:'var(--info)' },
      { l:'Records', v:(rows||[]).length, c:'var(--t1)' },
    ].map(k => `<div class="card" style="padding:14px 16px">
      <div style="font-size:16px;font-weight:800;color:${k.c}">${k.v}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
    </div>`).join('');
  }

  if (!rows || !rows.length) {
    bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">💸</div><div class="et">No transactions found</div></div></div></div>`;
    return;
  }

  const TYPE_LABELS = {
    commission_credit:'Commission Credit', commission_deduction:'Deduction',
    clawback:'Clawback', adjustment:'Adjustment', advance:'Advance', bonus:'Bonus',
  };
  const isCredit = t => ['commission_credit','bonus','adjustment'].includes(t);

  const trs = rows.map(r => `<tr>
    <td>
      <div style="font-weight:700;font-size:13px">${esc(r.agents?.agent_name || '—')}</div>
      <div style="font-size:11px;color:var(--t3)">${esc(r.agents?.agent_code || '')}</div>
    </td>
    <td><span class="badge ${isCredit(r.transaction_type) ? 'ok' : 'err'}">${esc(TYPE_LABELS[r.transaction_type] || r.transaction_type)}</span></td>
    <td class="r mono" style="font-weight:700;color:${isCredit(r.transaction_type) ? 'var(--ok)' : 'var(--err)'}">${isCredit(r.transaction_type) ? '+' : '-'}${fM(r.amount)}</td>
    <td style="font-size:12px;color:var(--t3)">${esc(r.payment_method || '—')}</td>
    <td class="mono" style="font-size:11px;color:var(--t3)">${esc(r.reference || '—')}</td>
    <td style="font-size:11px;color:var(--t3)">${r.created_at ? fD(r.created_at.split('T')[0]) : '—'}</td>
    ${isA ? `<td style="text-align:right"><button class="btn btn-r btn-xs" onclick="_atDelete('${r.id}')">Del</button></td>` : '<td></td>'}
  </tr>`).join('');

  bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Agent</th><th>Type</th><th class="r">Amount</th><th>Method</th><th>Reference</th><th>Date</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

function _atOpenModal() {
  document.getElementById('at-modal-err').textContent = '';
  document.getElementById('at-agent_id').value = '';
  document.getElementById('at-transaction_type').value = 'commission_credit';
  document.getElementById('at-amount').value = '';
  document.getElementById('at-payment_method').value = '';
  document.getElementById('at-reference').value = '';
  document.getElementById('at-notes').value = '';
  document.getElementById('at-modal').style.display = 'flex';
}
function _atCloseModal() { document.getElementById('at-modal').style.display = 'none'; }

async function _atSave() {
  const agentId = document.getElementById('at-agent_id').value;
  const txType  = document.getElementById('at-transaction_type').value;
  const amount  = document.getElementById('at-amount').value;
  const errEl   = document.getElementById('at-modal-err');
  if (!agentId || !amount) { errEl.textContent = 'Agent and amount are required.'; return; }

  const btn = document.getElementById('at-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await supabase.from('agent_transactions').insert({
    company_id: S.cid,
    agent_id: agentId,
    transaction_type: txType,
    amount: Number(amount),
    payment_method: document.getElementById('at-payment_method').value || null,
    reference: document.getElementById('at-reference').value.trim() || null,
    notes: document.getElementById('at-notes').value.trim() || null,
    created_by: S.name || S.email || 'Admin',
  });

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { errEl.textContent = error.message; return; }
  _atCloseModal();
  await _atLoad();
  if (typeof toast === 'function') toast('Transaction recorded', 'ok');
}

async function _atDelete(id) {
  if (!confirm('Delete this transaction?')) return;
  await supabase.from('agent_transactions').delete().eq('id', id);
  await _atLoad();
  if (typeof toast === 'function') toast('Deleted', 'ok');
}
