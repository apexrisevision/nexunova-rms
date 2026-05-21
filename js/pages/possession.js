// ── Possession Module ─────────────────────────────────────────────
// Handles unit handover: checklist, snagging, confirmation

const POS_DEFAULT_CHECKLIST = [
  'Keys Handed Over',
  'Main Door Lock & Intercom',
  'Electricity Connection & Meter',
  'Water Supply & Plumbing',
  'Gas Connection',
  'Painting & Wall Finishing',
  'Tile / Flooring Work',
  'Windows, Grills & Doors',
  'Legal / Title Documents',
];

// In-memory state for current modal session
let _posChecklist    = []; // [{id, label, checked, notes}]
let _posSnagItems    = []; // [{id, description, status, notes}]

// ── Open modal ────────────────────────────────────────────────────

async function openPossessionModal(unitId) {
  const u      = gunit(unitId);
  const gdbU   = gdb()?.units?.[S.cid]?.[unitId] || {};
  const prj    = _projectsCache?.find(p => p.id === u?.projectId);

  document.getElementById('pos-unit-id').value       = unitId;
  document.getElementById('pos-unit-display').value  = u?.unitNo   || unitId;
  document.getElementById('pos-project-display').value = prj?.name || prj?.projectName || '';
  document.getElementById('pos-client-name').value   = gdbU.customerName || u?.customerName || '';
  document.getElementById('pos-client-phone').value  = gdbU.phone        || u?.phone        || '';

  // Load existing possession record for this unit
  const { data: existing } = await supabase
    .from('possessions')
    .select('*')
    .eq('unit_id', unitId)
    .eq('company_id', S.cid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    document.getElementById('pos-id').value          = existing.id;
    document.getElementById('pos-sale-id').value     = existing.sale_id || '';
    document.getElementById('pos-status').value      = existing.status  || 'pending';
    document.getElementById('pos-date').value        = existing.possession_date || '';
    document.getElementById('pos-handover-by').value = existing.handover_by     || '';
    document.getElementById('pos-received-by').value = existing.received_by     || '';
    document.getElementById('pos-notes').value       = existing.notes            || '';
    if (existing.client_name)  document.getElementById('pos-client-name').value  = existing.client_name;
    if (existing.client_phone) document.getElementById('pos-client-phone').value = existing.client_phone;
    _posChecklist  = Array.isArray(existing.checklist)      ? existing.checklist      : _defaultChecklist();
    _posSnagItems  = Array.isArray(existing.snagging_items) ? existing.snagging_items : [];
  } else {
    document.getElementById('pos-id').value          = '';
    document.getElementById('pos-sale-id').value     = gdbU.saleId || '';
    document.getElementById('pos-status').value      = 'pending';
    document.getElementById('pos-date').value        = '';
    document.getElementById('pos-handover-by').value = S.name || '';
    document.getElementById('pos-received-by').value = '';
    document.getElementById('pos-notes').value       = '';
    _posChecklist = _defaultChecklist();
    _posSnagItems = [];
  }

  _posRenderChecklist();
  _posRenderSnag();
  om('m-possession');
}

function _defaultChecklist() {
  return POS_DEFAULT_CHECKLIST.map((label, i) => ({
    id: `item_${i}`, label, checked: false, notes: ''
  }));
}

// ── Checklist rendering ───────────────────────────────────────────

function _posRenderChecklist() {
  const wrap = document.getElementById('pos-checklist-wrap');
  if (!wrap) return;
  if (_posChecklist.length === 0) {
    wrap.innerHTML = `<div style="font-size:12px;color:var(--t3);padding:4px 0">No items yet. Add one below.</div>`;
    return;
  }
  wrap.innerHTML = _posChecklist.map((item, idx) => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--hover)">
      <input type="checkbox" ${item.checked ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--ok);flex-shrink:0"
        onchange="_posToggleCheck(${idx}, this.checked)">
      <span style="flex:1;font-size:13px;color:${item.checked ? 'var(--ok)' : 'var(--t1)'};${item.checked ? 'text-decoration:line-through;' : ''}">${esc(item.label)}</span>
      <button onclick="_posRemoveCheck(${idx})" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:12px;padding:2px 4px" title="Remove">✕</button>
    </div>`).join('');
}

function _posToggleCheck(idx, val) {
  if (_posChecklist[idx]) _posChecklist[idx].checked = val;
  _posRenderChecklist();
}

function _posRemoveCheck(idx) {
  _posChecklist.splice(idx, 1);
  _posRenderChecklist();
}

function posAddChecklistItem() {
  const inp = document.getElementById('pos-checklist-new');
  const label = inp?.value?.trim();
  if (!label) return;
  _posChecklist.push({ id: `custom_${Date.now()}`, label, checked: false, notes: '' });
  inp.value = '';
  _posRenderChecklist();
}

// ── Snagging rendering ────────────────────────────────────────────

function _posRenderSnag() {
  const wrap = document.getElementById('pos-snag-wrap');
  if (!wrap) return;
  if (_posSnagItems.length === 0) {
    wrap.innerHTML = `<div style="font-size:12px;color:var(--t3);padding:4px 0">No defects recorded. Add one below if needed.</div>`;
    return;
  }
  wrap.innerHTML = _posSnagItems.map((item, idx) => {
    const isResolved = item.status === 'resolved';
    const col = isResolved ? 'var(--ok)' : '#f59e0b';
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--hover)">
      <span style="display:flex;align-items:center">${isResolved ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'}</span>
      <span style="flex:1;font-size:13px;color:${isResolved ? 'var(--t3)' : 'var(--t1)'};${isResolved ? 'text-decoration:line-through;' : ''}">${esc(item.description)}</span>
      <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${col}18;color:${col};border:1px solid ${col}33">
        ${isResolved ? 'Resolved' : 'Open'}
      </span>
      ${!isResolved
        ? `<button onclick="_posResolveSnag(${idx})" style="background:none;border:none;color:var(--ok);cursor:pointer;font-size:11px;font-weight:600;padding:2px 4px">✓ Resolve</button>`
        : ''}
      <button onclick="_posRemoveSnag(${idx})" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:12px;padding:2px 4px" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function _posResolveSnag(idx) {
  if (_posSnagItems[idx]) {
    _posSnagItems[idx].status       = 'resolved';
    _posSnagItems[idx].resolved_date = new Date().toISOString().split('T')[0];
  }
  _posRenderSnag();
}

function _posRemoveSnag(idx) {
  _posSnagItems.splice(idx, 1);
  _posRenderSnag();
}

function posAddSnagItem() {
  const inp = document.getElementById('pos-snag-new');
  const desc = inp?.value?.trim();
  if (!desc) return;
  _posSnagItems.push({ id: `snag_${Date.now()}`, description: desc, status: 'open', notes: '' });
  inp.value = '';
  _posRenderSnag();
}

// ── Save ──────────────────────────────────────────────────────────

async function savePossession() {
  const unitId  = document.getElementById('pos-unit-id')?.value?.trim();
  const status  = document.getElementById('pos-status')?.value;
  const posDateEl = document.getElementById('pos-date');
  const btn     = document.getElementById('pos-save-btn');
  if (!unitId) return;

  posDateEl?.classList.remove('inp-err');
  if (status === 'completed' && !posDateEl?.value) {
    toast('Possession date is required for completed handover', 'err');
    posDateEl?.classList.add('inp-err');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const id          = document.getElementById('pos-id')?.value?.trim() || null;
    const saleId      = document.getElementById('pos-sale-id')?.value?.trim() || null;
    const posDate     = document.getElementById('pos-date')?.value        || null;
    const handoverBy  = document.getElementById('pos-handover-by')?.value?.trim() || null;
    const receivedBy  = document.getElementById('pos-received-by')?.value?.trim() || null;
    const clientName  = document.getElementById('pos-client-name')?.value?.trim()  || null;
    const clientPhone = document.getElementById('pos-client-phone')?.value?.trim() || null;
    const notes       = document.getElementById('pos-notes')?.value?.trim()        || null;

    const payload = {
      company_id:     S.cid,
      unit_id:        unitId,
      sale_id:        saleId || null,
      status,
      possession_date: posDate,
      handover_by:    handoverBy,
      received_by:    receivedBy,
      client_name:    clientName,
      client_phone:   clientPhone,
      checklist:      _posChecklist,
      snagging_items: _posSnagItems,
      notes,
      created_by:     S.name || S.userId || 'system',
      updated_at:     new Date().toISOString()
    };

    let savedId = id;
    if (id) {
      const { error } = await supabase.from('possessions').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('possessions').insert([payload]).select('id').single();
      if (error) throw error;
      savedId = data?.id;
      if (savedId) document.getElementById('pos-id').value = savedId;
    }

    // Sync possession_date + handover_status back to the units table
    if (posDate || status === 'completed') {
      const unitUpd = {};
      if (posDate)              unitUpd.possession_date = posDate;
      if (status === 'completed') unitUpd.handover_status = 'completed';
      await supabase.from('units').update(unitUpd).eq('id', unitId);
      // Update cache
      const cached = window._unitsCache?.find(u => u.id === unitId);
      if (cached) {
        if (posDate) cached.possessionDate = posDate;
        if (status === 'completed') cached.handoverStatus = 'completed';
      }
    }

    toast(id ? 'Possession record updated' : 'Possession record created', 'ok');

    if (status === 'completed' && posDate) {
      const doP = confirm('Possession complete! Print NOC / handover confirmation?');
      if (doP) printPossessionDoc(savedId, unitId);
    }

  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Possession'; }
  }
}

// ── Print handover document ───────────────────────────────────────

async function printPossessionDoc(posId, unitId) {
  const u   = gunit(unitId) || {};
  const prj = _projectsCache?.find(p => p.id === u.projectId) || {};

  let pos = {};
  if (posId) {
    const { data } = await supabase.from('possessions').select('*').eq('id', posId).maybeSingle();
    if (data) pos = data;
  }

  const checkedItems = (pos.checklist || []).filter(i => i.checked);
  const openSnags    = (pos.snagging_items || []).filter(i => i.status !== 'resolved');
  const checklistHtml = checkedItems.length
    ? checkedItems.map(i => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${i.label}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#16a34a;font-weight:600;text-align:center">✓</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:8px 12px;color:#6b7280;font-style:italic">No checklist items recorded</td></tr>';
  const snagHtml = openSnags.length
    ? `<p style="color:#b45309;font-size:12px;margin:16px 0 6px;font-weight:700">PENDING DEFECTS (${openSnags.length}):</p><ul style="font-size:12px;color:#374151;margin:0;padding-left:18px">${openSnags.map(i=>`<li>${i.description}</li>`).join('')}</ul>`
    : '';

  const _posHtml = `<!DOCTYPE html><html><head><title>Possession Certificate</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;padding:40px;font-size:13px}
  h1{font-size:22px;font-weight:700;text-align:center;margin-bottom:4px}
  h2{font-size:14px;font-weight:700;text-align:center;letter-spacing:2px;margin-bottom:20px;color:#6C63FF}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;font-size:12px}
  .meta-item{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px}
  .meta-item label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:3px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
  th{background:#f3f4f6;padding:8px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#374151}
  .sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:40px}
  .sig-box{border-top:2px solid #111;padding-top:8px;text-align:center;font-size:11px}
  @media print{body{padding:20px}}</style></head><body>
  <h1>${esc(S.companyName || 'Company Name')}</h1>
  <h2>POSSESSION CERTIFICATE</h2>
  <div class="meta">
    <div class="meta-item"><label>Unit No.</label><strong>${esc(u.unitNo||'—')}</strong></div>
    <div class="meta-item"><label>Project</label><strong>${esc(prj.name||prj.projectName||'—')}</strong></div>
    <div class="meta-item"><label>Client / Buyer</label><strong>${esc(pos.client_name||'—')}</strong></div>
    <div class="meta-item"><label>Contact</label><strong>${esc(pos.client_phone||'—')}</strong></div>
    <div class="meta-item"><label>Possession Date</label><strong>${pos.possession_date ? fD(pos.possession_date) : '—'}</strong></div>
    <div class="meta-item"><label>Status</label><strong style="color:#16a34a">${(pos.status||'').toUpperCase()}</strong></div>
  </div>
  <p style="font-size:12px;margin-bottom:16px;line-height:1.6">
    This is to certify that the above-mentioned unit has been handed over to the buyer in satisfactory condition.
    Both parties have inspected the premises and the following checklist items have been verified and accepted.
  </p>
  <table>
    <thead><tr><th>Checklist Item</th><th style="width:80px;text-align:center">Status</th></tr></thead>
    <tbody>${checklistHtml}</tbody>
  </table>
  ${snagHtml}
  ${pos.notes ? `<p style="font-size:12px;margin-top:14px;color:#374151"><strong>Notes:</strong> ${esc(pos.notes)}</p>` : ''}
  <div class="sig">
    <div class="sig-box">
      <p style="margin-bottom:32px"></p>
      <strong>${esc(pos.handover_by||'Handed Over By')}</strong><br>Developer Representative
    </div>
    <div class="sig-box">
      <p style="margin-bottom:32px"></p>
      <strong>${esc(pos.received_by||pos.client_name||'Buyer')}</strong><br>Buyer / Authorized Person
    </div>
    <div class="sig-box">
      <p style="margin-bottom:32px"></p>
      <strong>Witness</strong><br>Name & Signature
    </div>
  </div>
  <p style="text-align:center;margin-top:30px;font-size:10px;color:#9ca3af">
    Generated by Nexunova RMS · ${new Date().toLocaleDateString()}
  </p>
  </body></html>`;
  _printHTML(_posHtml, 'Possession Certificate');
}
