// ── Additional Receivables ────────────────────────────────────────────────────
// Extra amounts to be collected outside the main installment schedule

let _recvData = null;

async function rReceivables() {
  const el = document.getElementById('pg-receivables');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Additional Receivables</h2><p>Extra charges, penalties, and one-off payments outside the installment plan</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_recvLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-p btn-sm" onclick="_recvOpenModal()">+ Add Receivable</button>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-gh btn-xs recv-ftab on" onclick="_recvSetFilter('pending',this)">Pending</button>
    <button class="btn btn-gh btn-xs recv-ftab"    onclick="_recvSetFilter('partial',this)">Partial</button>
    <button class="btn btn-gh btn-xs recv-ftab"    onclick="_recvSetFilter('all',this)">All</button>
    <button class="btn btn-gh btn-xs recv-ftab"    onclick="_recvSetFilter('paid',this)">Paid</button>
  </div>
  <div id="recv-kpi" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px"></div>
  <div id="recv-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Add Modal -->
  <div id="recv-modal" class="mo" style="display:none" onclick="if(event.target===this)_recvCloseModal()">
    <div class="mo-box" style="max-width:480px">
      <div class="mo-hd"><span id="recv-modal-title">Add Receivable</span><button class="mo-cl" onclick="_recvCloseModal()">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Sale / Unit *</label>
          <select id="recv-sale_id" class="fi"><option value="">— Select sale —</option></select></div>
        <div class="fg"><label class="fl">Description *</label>
          <input id="recv-description" class="fi" placeholder="e.g. Late payment penalty, Utility charges…"></div>
        <div class="fg"><label class="fl">Amount *</label>
          <input type="number" id="recv-amount" class="fi" step="0.01" min="0"></div>
        <div class="fg"><label class="fl">Due Date</label>
          <input type="date" id="recv-due_date" class="fi"></div>
        <div class="fg"><label class="fl">Notes</label>
          <textarea id="recv-notes" class="fi" rows="2"></textarea></div>
        <div id="recv-modal-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_recvCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="recv-save-btn" onclick="_recvSave()">Save</button>
      </div>
    </div>
  </div>

  <!-- Mark Collected Modal -->
  <div id="recv-collect-modal" class="mo" style="display:none" onclick="if(event.target===this)document.getElementById('recv-collect-modal').style.display='none'">
    <div class="mo-box" style="max-width:400px">
      <div class="mo-hd"><span>Record Collection</span><button class="mo-cl" onclick="document.getElementById('recv-collect-modal').style.display='none'">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Amount Collected *</label>
          <input type="number" id="recv-coll-amount" class="fi" step="0.01" min="0"></div>
        <div class="fg"><label class="fl">Date *</label>
          <input type="date" id="recv-coll-date" class="fi"></div>
        <div id="recv-collect-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="document.getElementById('recv-collect-modal').style.display='none'">Cancel</button>
        <button class="btn btn-p btn-sm" id="recv-coll-btn" onclick="_recvCollectConfirm()">Confirm</button>
      </div>
    </div>
  </div>`;

  await _recvLoad();
  _recvPopulateSales();
}

let _recvFilter = 'pending';
function _recvSetFilter(f, el) {
  _recvFilter = f;
  document.querySelectorAll('.recv-ftab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _recvRender();
}

async function _recvLoad() {
  const { data } = await supabase.rpc('list_additional_receivables', { p_company_id: S.cid });
  _recvData = data || [];
  _recvRender();
}

function _recvRender() {
  const bodyEl = document.getElementById('recv-body');
  const kpiEl  = document.getElementById('recv-kpi');
  if (!bodyEl) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  const total   = _recvData.reduce((s, r) => s + Number(r.amount || 0), 0);
  const paid    = _recvData.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const pending = total - paid;

  if (kpiEl) {
    kpiEl.innerHTML = [
      { l:'Total Receivable', v:fM(total),   c:'var(--info)' },
      { l:'Collected',        v:fM(paid),    c:'var(--ok)' },
      { l:'Outstanding',      v:fM(pending), c:'var(--warn)' },
    ].map(k => `<div class="card" style="padding:14px 16px">
      <div style="font-size:16px;font-weight:800;color:${k.c}">${k.v}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
    </div>`).join('');
  }

  let rows = _recvData;
  if (_recvFilter === 'pending') rows = rows.filter(r => r.status === 'pending');
  if (_recvFilter === 'partial') rows = rows.filter(r => r.status === 'partial');
  if (_recvFilter === 'paid')    rows = rows.filter(r => r.status === 'paid');

  if (!rows.length) {
    bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">💰</div><div class="et">No records in this filter</div></div></div></div>`;
    return;
  }

  const trs = rows.map(r => {
    const saleNo  = r.sales?.sale_number || '—';
    const unitNo  = r.sales?.units?.unit_number || '';
    const cName   = r.clients?.client_name || '—';
    const outstanding = Math.max(0, Number(r.amount) - Number(r.paid_amount || 0));
    const statusBadge = r.status === 'paid'
      ? `<span class="badge ok">Paid</span>`
      : r.status === 'partial'
      ? `<span class="badge warn">Partial</span>`
      : `<span class="badge err">Pending</span>`;
    return `<tr>
      <td>
        <div style="font-weight:700;font-size:13px">${esc(saleNo)} ${unitNo ? `<span style="color:var(--t3);font-size:11px">(${esc(unitNo)})</span>` : ''}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(cName)}</div>
      </td>
      <td style="font-size:12px">${esc(r.description)}</td>
      <td class="r mono" style="font-weight:700">${fM(r.amount)}</td>
      <td class="r mono" style="color:var(--ok)">${fM(r.paid_amount || 0)}</td>
      <td class="r mono" style="color:var(--warn)">${fM(outstanding)}</td>
      <td style="font-size:12px;color:var(--t3)">${r.due_date ? fD(r.due_date) : '—'}</td>
      <td>${statusBadge}</td>
      ${isA ? `<td style="text-align:right">
        ${r.status !== 'paid' ? `<button class="btn btn-p btn-xs" onclick="_recvOpenCollect('${r.id}','${r.amount}','${r.paid_amount||0}')">Collect</button>` : ''}
        <button class="btn btn-r btn-xs" onclick="_recvDelete('${r.id}')">Del</button>
      </td>` : '<td></td>'}
    </tr>`;
  }).join('');

  bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Sale / Unit</th><th>Description</th><th class="r">Amount</th><th class="r">Collected</th><th class="r">Outstanding</th><th>Due Date</th><th>Status</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

async function _recvPopulateSales() {
  const { data } = await supabase.rpc('list_sales_lookup', { p_company_id: S.cid });
  const sel = document.getElementById('recv-sale_id');
  if (!sel || !data) return;
  data.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.sale_number} — ${s.clients?.client_name || '?'} (${s.units?.unit_number || s.units?.unit_no || '?'})`;
    sel.appendChild(o);
  });
}

function _recvOpenModal() {
  document.getElementById('recv-modal-err').textContent = '';
  document.getElementById('recv-sale_id').value = '';
  document.getElementById('recv-description').value = '';
  document.getElementById('recv-amount').value = '';
  document.getElementById('recv-due_date').value = '';
  document.getElementById('recv-notes').value = '';
  document.getElementById('recv-modal').style.display = 'flex';
}
function _recvCloseModal() { document.getElementById('recv-modal').style.display = 'none'; }

async function _recvSave() {
  const saleId = document.getElementById('recv-sale_id').value;
  const desc   = document.getElementById('recv-description').value.trim();
  const amount = document.getElementById('recv-amount').value;
  const errEl  = document.getElementById('recv-modal-err');
  if (!saleId || !desc || !amount) { errEl.textContent = 'Sale, description and amount are required.'; return; }

  const btn = document.getElementById('recv-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const sale = await supabase.rpc('get_sale_for_lookup', { p_sale_id: saleId, p_company_id: S.cid });
  const { error } = await supabase.rpc('create_additional_receivable', {
    p_company_id: S.cid,
    p_data: {
      sale_id: saleId,
      client_id: sale.data?.client_id || null,
      unit_id: sale.data?.unit_id || null,
      description: desc,
      amount: Number(amount),
      due_date: document.getElementById('recv-due_date').value || null,
      notes: document.getElementById('recv-notes').value.trim() || null,
      status: 'pending',
      paid_amount: 0,
      created_by: S.uid,
    }
  });

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { errEl.textContent = error.message; return; }
  _recvCloseModal();
  await _recvLoad();
  if (typeof toast === 'function') toast('Receivable added', 'ok');
}

let _recvCollectId = null;
function _recvOpenCollect(id, total, paid) {
  _recvCollectId = id;
  const outstanding = Math.max(0, Number(total) - Number(paid));
  document.getElementById('recv-coll-amount').value = outstanding.toFixed(2);
  document.getElementById('recv-coll-date').value = td();
  document.getElementById('recv-collect-err').textContent = '';
  document.getElementById('recv-collect-modal').style.display = 'flex';
}

async function _recvCollectConfirm() {
  const amt  = document.getElementById('recv-coll-amount').value;
  const date = document.getElementById('recv-coll-date').value;
  const errEl = document.getElementById('recv-collect-err');
  if (!amt || !date) { errEl.textContent = 'Amount and date required.'; return; }

  const btn = document.getElementById('recv-coll-btn');
  btn.disabled = true;

  const rec = _recvData.find(r => r.id === _recvCollectId);
  const newPaid = Number(rec?.paid_amount || 0) + Number(amt);
  const newStatus = newPaid >= Number(rec?.amount || 0) ? 'paid' : 'partial';

  const { error } = await supabase.rpc('update_additional_receivable', {
    p_id: _recvCollectId,
    p_company_id: S.cid,
    p_data: {
      paid_amount: newPaid,
      paid_date: date,
      status: newStatus,
    }
  });

  btn.disabled = false;
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('recv-collect-modal').style.display = 'none';
  await _recvLoad();
  if (typeof toast === 'function') toast('Collection recorded', 'ok');
}

async function _recvDelete(id) {
  if (!confirm('Delete this receivable?')) return;
  await supabase.rpc('delete_additional_receivable', { p_id: id, p_company_id: S.cid });
  await _recvLoad();
  if (typeof toast === 'function') toast('Deleted', 'ok');
}
