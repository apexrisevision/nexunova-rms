// ══ Sale Approvals — admin review queue for agent-submitted sales ═══════════
// RPCs: get_sale_submissions_admin, approve_sale_submission, reject_sale_submission.
// Each pending submission = a complete package (client + sale + schedule) an agent
// built from their reserved unit. Approve = ONE transaction (client + sale +
// schedule + reservation->converted + unit->Sold + commission). Reject bounces it.

let _subRows = [];
let _subTab = 'pending';

const _subMoney = (n) => '₨' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function rSaleSubmissions() {
  const pg = document.getElementById('pg-salesubmissions');
  if (!pg) return;
  pg.innerHTML = '<div class="nx"></div>';
  await _subLoad();
}

async function _subLoad() {
  try {
    const { data } = await supabase.rpc('get_sale_submissions_admin',
      { p_company_id: S.cid, p_project_id: null, p_status: _subTab });
    _subRows = (data && data.submissions) || [];
  } catch (e) { _subRows = []; }
  _subRender();
}

function _subRender() {
  const pg = document.getElementById('pg-salesubmissions');
  const shell = pg && pg.querySelector('.nx');
  if (!shell) return;
  const tabs = NX.tabs({ tabs: [
    { k: 'pending', label: 'Pending' },
    { k: 'approved', label: 'Approved' },
    { k: 'rejected', label: 'Rejected' },
    { k: 'all', label: 'All' }
  ], active: _subTab, onSelect: "_subSetTab('%k')" });
  shell.innerHTML = NX.pageHeader('Sale Approvals', '', { icon: 'file-check' }) +
    `<div style="margin:var(--fk-sp-3) 0">${tabs}</div>` + _subBodyHtml();
}

function _subSetTab(t) { _subTab = t; _subLoad(); }

function _subBodyHtml() {
  if (!_subRows.length) {
    return NX.card(NX.empty({
      icon: 'file-check',
      message: _subTab === 'pending'
        ? 'No sales are awaiting approval. When an agent marks a reserved unit sold, the package appears here.'
        : 'Nothing here yet.'
    }));
  }
  return NX.card(NX.table({
    cols: [{ label: 'Unit' }, { label: 'Client' }, { label: 'Agent' }, { label: 'Net', num: true }, { label: 'Submitted' }, { label: 'Status' }, { label: '' }],
    rows: _subRows.map(r => [
      `<b>${esc(r.unit_no || '—')}</b><div style="font-size:11px;color:var(--fk-text-muted)">${esc(r.project_name || '')}</div>`,
      esc((r.client && r.client.full_name) || '—'),
      r.agent_name ? `${esc(r.agent_name)}<div style="font-size:11px;color:var(--fk-text-muted)">${esc(r.agent_code || '')}</div>` : '<span style="color:var(--fk-text-muted)">—</span>',
      `<span class="num">${_subMoney(r.net_amount)}</span>`,
      esc(fdateRsv(r.created_at)),
      _subBadge(r.status),
      r.status === 'pending'
        ? NX.button('Review & decide', { variant: 'primary', size: 'sm', icon: 'eye', onclick: `_subReviewOpen('${r.id}')` })
        : NX.button('View', { variant: 'ghost', size: 'sm', onclick: `_subReviewOpen('${r.id}')` })
    ]),
    flush: true
  }), { header: { icon: 'file-check', tone: 'primary', title: 'Submitted sales' }, flush: true });
}

function _subBadge(st) {
  if (st === 'pending') return NX.badge('Pending', 'warning', { dot: true });
  if (st === 'approved') return NX.badge('Approved', 'success', { dot: true });
  if (st === 'rejected') return NX.badge('Rejected', 'danger');
  if (st === 'withdrawn') return NX.badge('Withdrawn', 'muted');
  return NX.badge(st, 'muted');
}

function _subCloseModal() { document.querySelector('.nx-modal-overlay')?.remove(); }

function _subRow(label, val) {
  return `<div><div class="nx-kpi-label" style="text-transform:none">${label}</div><div style="font-size:13.5px;font-weight:600;color:var(--fk-text);word-break:break-word">${val ? esc(val) : '<span style=\"font-weight:400;color:var(--fk-text-muted)\">—</span>'}</div></div>`;
}

// A framed client/KYC document — full image (contain). kind: 'card' | 'photo'.
function _subDoc(url, label, kind) {
  if (!url) return '';
  const ar = kind === 'photo' ? '3 / 4' : '1.585 / 1';
  return `<div><div style="font-size:11px;font-weight:600;color:var(--fk-text-muted);margin-bottom:5px">${esc(label)}</div>
    <a href="${esc(url)}" target="_blank" rel="noopener" style="display:block;text-decoration:none">
      <div style="aspect-ratio:${ar};background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:10px;overflow:hidden;display:grid;place-items:center">
        <img src="${esc(url)}" style="width:100%;height:100%;object-fit:contain"></div></a></div>`;
}

function _subReviewOpen(id) {
  const r = _subRows.find(x => x.id === id);
  if (!r) return;
  const c = r.client || {}, sl = r.sale || {}, sch = r.schedule || [];
  const pending = r.status === 'pending';
  const mismatch = Math.abs(Number(r.schedule_total || 0) - Number(r.net_amount || 0)) > 1;

  // duplicate-client hint
  let dup = '';
  if (r.dup_client_id) {
    dup = `<label class="nx-check" style="display:flex;gap:8px;align-items:flex-start;margin:var(--fk-sp-2) 0;padding:10px 12px;border:1px solid var(--fk-warning-edge);background:var(--fk-warning-surface);border-radius:var(--fk-radius-control);font-size:12.5px;cursor:pointer">
      <input type="checkbox" id="sub-link-dup" ${pending ? 'checked' : 'disabled'} style="margin-top:2px">
      <span>A client with this CNIC/phone already exists: <b>${esc(r.dup_client_name || '')}</b> ${r.dup_client_code ? '(' + esc(r.dup_client_code) + ')' : ''}. Link the sale to this existing client instead of creating a duplicate.</span>
    </label>`;
  }

  // client KYC documents (shown if the agent captured any)
  const hasDocs = c.client_photo_url || c.cnic_front_url || c.cnic_back_url || c.next_of_kin_photo_url;
  const docsHtml = hasDocs
    ? `<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:var(--fk-sp-4) 0 var(--fk-sp-2)">Client documents (KYC) — click to enlarge</div>
       <div class="nx-grid-2" style="gap:12px">${_subDoc(c.cnic_front_url, 'CNIC — front', 'card')}${_subDoc(c.cnic_back_url, 'CNIC — back', 'card')}</div>
       <div style="display:flex;gap:12px;margin-top:12px">
         ${c.client_photo_url ? '<div style="max-width:130px">' + _subDoc(c.client_photo_url, 'Client photo', 'photo') + '</div>' : ''}
         ${c.next_of_kin_photo_url ? '<div style="max-width:130px">' + _subDoc(c.next_of_kin_photo_url, 'Nominee photo', 'photo') + '</div>' : ''}
       </div>`
    : '';

  // schedule rows
  const schRows = sch.map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--fk-border);font-size:12.5px">
      <span>${esc(s.installment_type === 'down_payment' ? 'Down payment' : (s.notes || ('Installment ' + (s.installment_number || ''))))} <span style="color:var(--fk-text-muted)">· ${esc(fdateRsv(s.due_date))}</span></span>
      <b>${_subMoney(s.amount_due)}</b></div>`).join('');

  const body =
    `<div style="display:flex;gap:14px;align-items:center;margin-bottom:var(--fk-sp-3)">
       <div style="min-width:0">
         <div style="font-size:17px;font-weight:700;color:var(--fk-text)">Unit ${esc(r.unit_no || '')}</div>
         <div style="font-size:12px;color:var(--fk-text-muted)">${esc(r.project_name || '')} · submitted ${esc(fdateRsv(r.created_at))}</div>
       </div>
       <div style="margin-left:auto">${_subBadge(r.status)}</div>
     </div>
     <div style="font-size:12.5px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-3)">Agent: <b style="color:var(--fk-text)">${esc(r.agent_name || '—')}</b> ${r.agent_code ? esc(r.agent_code) : ''}${r.submitted_by_name ? ' · ' + esc(r.submitted_by_name) : ''}</div>` +
    (r.status === 'rejected' && r.reject_reason ? `<div class="nx-error" style="display:block;margin-bottom:var(--fk-sp-3)">Rejected: ${esc(r.reject_reason)}</div>` : '') +
    `<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin-bottom:var(--fk-sp-2)">Client</div>
     <div class="nx-grid-2" style="gap:var(--fk-sp-3) var(--fk-sp-4)">
       ${_subRow('Full name', c.full_name)}
       ${_subRow('Father / Husband', c.father_name)}
       ${_subRow('CNIC', c.cnic)}
       ${_subRow('Phone', c.phone_primary)}
       ${_subRow('Address', c.address)}
       ${_subRow('Email', c.email)}
     </div>
     ${(c.next_of_kin_name || c.next_of_kin_cnic || c.next_of_kin_phone) ? `<div style="margin-top:var(--fk-sp-3)" class="nx-grid-2">${_subRow('Nominee', c.next_of_kin_name)}${_subRow('Nominee CNIC', c.next_of_kin_cnic)}</div>` : ''}
     ${dup}
     ${docsHtml}
     <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:var(--fk-sp-4) 0 var(--fk-sp-2)">Sale &amp; price</div>
     <div class="nx-grid-2" style="gap:var(--fk-sp-3) var(--fk-sp-4)">
       ${_subRow('Area (sqft)', sl.area_sqft)}
       ${_subRow('Rate / sqft', sl.price_per_sqft ? _subMoney(sl.price_per_sqft) : '')}
       ${_subRow('Discount', _subMoney(sl.discount || 0))}
       ${_subRow('Down payment', _subMoney(sl.down_payment || 0))}
     </div>
     <div style="display:flex;justify-content:space-between;margin-top:var(--fk-sp-3);padding:10px 12px;background:var(--fk-bg-subtle);border-radius:var(--fk-radius-control);font-size:14px"><span>Net price</span><b>${_subMoney(r.net_amount)}</b></div>
     <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:var(--fk-sp-4) 0 var(--fk-sp-2)">Payment schedule (${sch.length})</div>
     <div>${schRows || '<span style="color:var(--fk-text-muted);font-size:12.5px">No schedule</span>'}</div>
     <div style="display:flex;justify-content:space-between;margin-top:var(--fk-sp-2);font-size:12.5px${mismatch ? ';color:var(--fk-danger)' : ''}"><span>Schedule total</span><b>${_subMoney(r.schedule_total)}${mismatch ? ' ⚠ ≠ net' : ''}</b></div>
     <div class="nx-error" id="sub-err" style="display:none;margin-top:var(--fk-sp-2)"></div>`;

  const footer = pending
    ? NX.button('Reject', { variant: 'danger-soft', onclick: `_subReject('${id}')` }) +
      NX.button('Cancel', { variant: 'ghost', onclick: '_subCloseModal()' }) +
      NX.button('Approve & create sale', { variant: 'primary', onclick: `_subApprove('${id}')` })
    : NX.button('Close', { variant: 'ghost', onclick: '_subCloseModal()' });

  document.body.insertAdjacentHTML('beforeend', NX.modal({
    id: 'sub-review-modal', title: 'Review submitted sale', size: 'l', onClose: '_subCloseModal()', body, footer
  }));
}

async function _subApprove(id) {
  const err = document.getElementById('sub-err');
  const showErr = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } };
  const linkEl = document.getElementById('sub-link-dup');
  const r = _subRows.find(x => x.id === id) || {};
  const linkId = (linkEl && linkEl.checked && r.dup_client_id) ? r.dup_client_id : null;
  const btns = document.querySelectorAll('.nx-modal-overlay .nx-btn');
  btns.forEach(b => b.setAttribute('disabled', 'disabled'));
  try {
    const { data } = await supabase.rpc('approve_sale_submission',
      { p_id: id, p_overrides: null, p_client_id_to_link: linkId });
    if (!data || !data.success) {
      btns.forEach(b => b.removeAttribute('disabled'));
      showErr((data && data.message) || 'Could not approve this sale.');
      return;
    }
    _subCloseModal();
    if (typeof toast === 'function') toast('Sale created' + (data.sale_number ? ' — ' + data.sale_number : '') + '.', 'ok');
    _subLoad();
  } catch (e) {
    btns.forEach(b => b.removeAttribute('disabled'));
    showErr('Could not approve this sale.');
  }
}

async function _subReject(id) {
  const reason = prompt('Reject this sale? Add a reason for the agent (optional):', '');
  if (reason === null) return;   // cancelled
  try {
    const { data } = await supabase.rpc('reject_sale_submission', { p_id: id, p_reason: reason || null });
    if (data && data.success) {
      _subCloseModal();
      if (typeof toast === 'function') toast('Sale rejected — unit returned to Reserved.', 'ok');
      _subLoad();
    } else if (typeof toast === 'function') toast('Could not reject.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not reject.', 'err'); }
}
