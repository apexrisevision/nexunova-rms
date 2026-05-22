// ── Payables Register ─────────────────────────────────────────────────────────
// Money owed by company to clients (refunds from cancellations / transfers)

let _payablesData = null;

async function rPayables() {
  const el = document.getElementById('pg-payables');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Payables</h2><p>Refunds &amp; amounts owed to clients from cancellations or transfers</p></div>
    <button class="btn btn-g btn-sm" onclick="_payLoad()">↺ Refresh</button>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-gh btn-xs pay-ftab on" onclick="_paySetFilter('pending',this)">Pending</button>
    <button class="btn btn-gh btn-xs pay-ftab"    onclick="_paySetFilter('partial',this)">Partial</button>
    <button class="btn btn-gh btn-xs pay-ftab"    onclick="_paySetFilter('all',this)">All</button>
    <button class="btn btn-gh btn-xs pay-ftab"    onclick="_paySetFilter('paid',this)">Paid</button>
  </div>
  <div id="payables-kpi" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px"></div>
  <div id="payables-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Mark Paid Modal -->
  <div id="pay-paid-modal" class="mo" style="display:none" onclick="if(event.target===this)document.getElementById('pay-paid-modal').style.display='none'">
    <div class="mo-box" style="max-width:420px">
      <div class="mo-hd"><span>Mark as Paid</span><button class="mo-cl" onclick="document.getElementById('pay-paid-modal').style.display='none'">✕</button></div>
      <div class="mo-bd">
        <div class="fg"><label class="fl">Amount Paid *</label><input type="number" id="pay-paid_amount" class="fi" step="0.01" min="0"></div>
        <div class="fg"><label class="fl">Payment Method</label>
          <select id="pay-payment_method" class="fi">
            <option value="">— Select —</option>
            <option>Cash</option><option>Cheque</option><option>Bank Transfer</option><option>Online</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Reference #</label><input id="pay-reference" class="fi"></div>
        <div class="fg"><label class="fl">Paid Date *</label><input type="date" id="pay-paid_date" class="fi"></div>
        <div class="fg"><label class="fl">Notes</label><textarea id="pay-notes" class="fi" rows="2"></textarea></div>
        <div id="pay-paid-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="document.getElementById('pay-paid-modal').style.display='none'">Cancel</button>
        <button class="btn btn-p btn-sm" id="pay-paid-btn" onclick="_payMarkPaid()">Confirm Payment</button>
      </div>
    </div>
  </div>`;

  await _payLoad();
}

let _payFilter = 'pending';
function _paySetFilter(f, el) {
  _payFilter = f;
  document.querySelectorAll('.pay-ftab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _payRender();
}

async function _payLoad() {
  const { data } = await supabase
    .from('payables')
    .select(`*, clients(client_name, client_code, phone)`)
    .eq('company_id', S.cid)
    .order('created_at', { ascending: false });
  _payablesData = data || [];
  _payRender();
}

function _payRender() {
  const bodyEl = document.getElementById('payables-body');
  const kpiEl  = document.getElementById('payables-kpi');
  if (!bodyEl) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  const total     = _payablesData.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalPaid = _payablesData.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const pending   = _payablesData.filter(r => r.status === 'pending' || r.status === 'partial').reduce((s, r) => s + (Number(r.amount || 0) - Number(r.paid_amount || 0)), 0);

  if (kpiEl) {
    kpiEl.innerHTML = [
      { l:'Total Payable', v:fM(total), c:'var(--err)' },
      { l:'Paid Out', v:fM(totalPaid), c:'var(--ok)' },
      { l:'Outstanding', v:fM(pending), c:'var(--warn)' },
      { l:'Records', v:_payablesData.length, c:'var(--t1)' },
    ].map(k => `<div class="card" style="padding:14px 16px">
      <div style="font-size:16px;font-weight:800;color:${k.c}">${k.v}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
    </div>`).join('');
  }

  let rows = _payablesData;
  if (_payFilter === 'pending') rows = rows.filter(r => r.status === 'pending');
  if (_payFilter === 'partial') rows = rows.filter(r => r.status === 'partial');
  if (_payFilter === 'paid')    rows = rows.filter(r => r.status === 'paid');

  if (!rows.length) {
    bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">✅</div><div class="et">No payables in this filter</div></div></div></div>`;
    return;
  }

  const trs = rows.map(r => {
    const client = r.clients;
    const outstanding = Math.max(0, Number(r.amount) - Number(r.paid_amount || 0));
    const statusBadge = r.status === 'paid'
      ? `<span class="badge ok">Paid</span>`
      : r.status === 'partial'
      ? `<span class="badge warn">Partial</span>`
      : `<span class="badge err">Pending</span>`;
    return `<tr>
      <td>
        <div style="font-weight:700;font-size:13px">${esc(client?.client_name || '—')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(client?.client_code || '')} ${client?.phone ? '· ' + esc(client.phone) : ''}</div>
      </td>
      <td style="font-size:12px;max-width:200px">${esc(r.reason)}</td>
      <td class="r mono" style="font-weight:700;color:var(--err)">${fM(r.amount)}</td>
      <td class="r mono" style="color:var(--ok)">${fM(r.paid_amount || 0)}</td>
      <td class="r mono" style="font-weight:700;color:var(--warn)">${fM(outstanding)}</td>
      <td style="font-size:12px;color:var(--t3)">${r.expected_date ? fD(r.expected_date) : '—'}</td>
      <td>${statusBadge}</td>
      ${isA ? `<td style="text-align:right">
        ${r.status !== 'paid' ? `<button class="btn btn-p btn-xs" onclick="_payOpenPaid('${r.id}','${r.amount}','${r.paid_amount||0}')">Mark Paid</button>` : ''}
      </td>` : '<td></td>'}
    </tr>`;
  }).join('');

  bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Client</th><th>Reason</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Outstanding</th><th>Expected</th><th>Status</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

let _payEditId = null;
function _payOpenPaid(id, total, paid) {
  _payEditId = id;
  const outstanding = Math.max(0, Number(total) - Number(paid));
  document.getElementById('pay-paid_amount').value = outstanding.toFixed(2);
  document.getElementById('pay-paid_date').value = td();
  document.getElementById('pay-payment_method').value = '';
  document.getElementById('pay-reference').value = '';
  document.getElementById('pay-notes').value = '';
  document.getElementById('pay-paid-err').textContent = '';
  document.getElementById('pay-paid-modal').style.display = 'flex';
}

async function _payMarkPaid() {
  const amtStr = document.getElementById('pay-paid_amount').value;
  const date   = document.getElementById('pay-paid_date').value;
  const errEl  = document.getElementById('pay-paid-err');
  if (!amtStr || !date) { errEl.textContent = 'Amount and date are required.'; return; }

  const btn = document.getElementById('pay-paid-btn');
  btn.disabled = true;

  const rec = _payablesData.find(r => r.id === _payEditId);
  const newPaid = Number(rec?.paid_amount || 0) + Number(amtStr);
  const newStatus = newPaid >= Number(rec?.amount || 0) ? 'paid' : 'partial';

  const { error } = await supabase.from('payables').update({
    paid_amount: newPaid,
    paid_date: date,
    payment_method: document.getElementById('pay-payment_method').value || null,
    reference: document.getElementById('pay-reference').value.trim() || null,
    notes: document.getElementById('pay-notes').value.trim() || null,
    status: newStatus,
  }).eq('id', _payEditId);

  btn.disabled = false;
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('pay-paid-modal').style.display = 'none';
  await _payLoad();
  if (typeof toast === 'function') toast('Payment recorded', 'ok');
}
