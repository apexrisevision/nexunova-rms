// ── Legal Cases Register ──────────────────────────────────────────────────────

let _lcData = null;
let _lcAnalytics = null;

// DB-valid stages (legal_cases_stage_check). Earlier the UI sent capitalised
// labels which the CHECK constraint rejected — case creation silently failed.
const LC_STAGES = [
  { v:'pre_legal',   l:'Pre-Legal' },
  { v:'notice_sent', l:'Notice Sent' },
  { v:'filed',       l:'Filed' },
  { v:'hearing',     l:'Hearing' },
  { v:'judgment',    l:'Judgment' },
  { v:'appeal',      l:'Appeal' },
  { v:'settled',     l:'Settled' },
  { v:'closed',      l:'Closed' },
];
const LC_TYPES = [
  { v:'notice',      l:'Legal Notice' },
  { v:'court',       l:'Court Suit' },
  { v:'arbitration', l:'Arbitration' },
  { v:'settlement',  l:'Settlement Track' },
];
const LC_RESOLVED = ['settled', 'closed'];
function _lcStageLabel(v) { const s = LC_STAGES.find(x => x.v === v); return s ? s.l : (v || '—'); }
function _lcTypeLabel(v)  { const t = LC_TYPES.find(x => x.v === v); return t ? t.l : (v || '—'); }

async function rLegalCases() {
  const el = document.getElementById('pg-legalcases');
  if (!el) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  el.innerHTML = `
  <div class="ph">
    <div><h2>Legal Cases</h2><p>Track litigation, notices, and legal proceedings against defaulting clients</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" onclick="_lcLoad()">↺ Refresh</button>
      ${isA ? `<button class="btn btn-p btn-sm" onclick="_lcOpenModal()">+ New Case</button>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-gh btn-xs lc-ftab on" onclick="_lcSetFilter('active',this)">Active</button>
    <button class="btn btn-gh btn-xs lc-ftab"    onclick="_lcSetFilter('all',this)">All</button>
    <button class="btn btn-gh btn-xs lc-ftab"    onclick="_lcSetFilter('closed',this)">Closed</button>
  </div>
  <div id="lc-kpi" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px"></div>
  <div id="lc-hearings" style="margin-bottom:14px"></div>
  <div id="lc-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading…</div></div></div></div></div>

  <!-- Costs Modal -->
  <div id="lc-costs-modal" class="mo" style="display:none" onclick="if(event.target===this)_lcCloseCosts()">
    <div class="mo-box" style="max-width:520px">
      <div class="mo-hd"><span id="lc-costs-title">Legal Costs</span><button class="mo-cl" onclick="_lcCloseCosts()">✕</button></div>
      <div class="mo-bd">
        <div id="lc-costs-list" style="margin-bottom:14px"></div>
        <div style="background:var(--canvas);border-radius:8px;padding:12px;border:1px solid var(--border-color)">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:10px">Add Cost Entry</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px">
            <div class="fg"><label class="fl">Date *</label><input type="date" id="lcc-date" class="fi"></div>
            <div class="fg"><label class="fl">Amount (PKR) *</label><input type="number" id="lcc-amount" class="fi" min="0" step="0.01" placeholder="0"></div>
            <div class="fg" style="grid-column:span 2"><label class="fl">Description *</label><input id="lcc-desc" class="fi" placeholder="e.g. Lawyer fee, Court filing, Miscellaneous"></div>
            <div class="fg"><label class="fl">Category</label>
              <select id="lcc-category" class="fi">
                <option value="lawyer_fee">Lawyer Fee</option>
                <option value="court_fee">Court Filing Fee</option>
                <option value="documentation">Documentation</option>
                <option value="miscellaneous">Miscellaneous</option>
              </select>
            </div>
          </div>
          <div id="lcc-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
          <div style="margin-top:10px;text-align:right">
            <button class="btn btn-p btn-sm" onclick="_lcAddCost()">+ Add</button>
          </div>
        </div>
      </div>
      <div class="mo-ft">
        <div id="lc-costs-total" style="font-weight:700;color:var(--t2);font-size:13px"></div>
        <button class="btn btn-g btn-sm" onclick="_lcCloseCosts()">Close</button>
      </div>
    </div>
  </div>

  <!-- Documents Vault Modal -->
  <div id="lc-docs-modal" class="mo" style="display:none" onclick="if(event.target===this)_lcCloseDocs()">
    <div class="mo-box" style="max-width:520px">
      <div class="mo-hd"><span id="lc-docs-title">Document Vault</span><button class="mo-cl" onclick="_lcCloseDocs()">✕</button></div>
      <div class="mo-bd">
        <div id="lc-docs-list" style="margin-bottom:14px"></div>
        <div style="background:var(--canvas);border-radius:8px;padding:12px;border:1px solid var(--border-color)">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:10px">Link Document</div>
          <div class="fg"><label class="fl">Document Name *</label><input id="lcd-name" class="fi" placeholder="e.g. Petition, Evidence, Court Order, Agreement"></div>
          <div class="fg"><label class="fl">URL / Link</label><input id="lcd-url" class="fi" placeholder="https://… or internal reference"></div>
          <div class="fg">
            <label class="fl">Type</label>
            <select id="lcd-type" class="fi">
              <option value="petition">Petition</option>
              <option value="evidence">Evidence</option>
              <option value="court_order">Court Order</option>
              <option value="agreement">Agreement / Deed</option>
              <option value="notice">Notice</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div id="lcd-err" style="color:var(--err);font-size:12px;margin-top:4px"></div>
          <div style="margin-top:10px;text-align:right">
            <button class="btn btn-p btn-sm" onclick="_lcAddDoc()">+ Link</button>
          </div>
        </div>
      </div>
      <div class="mo-ft">
        <span id="lc-docs-count" style="font-size:12px;color:var(--t3)"></span>
        <button class="btn btn-g btn-sm" onclick="_lcCloseDocs()">Close</button>
      </div>
    </div>
  </div>

  <!-- Add/Edit Modal -->
  <div id="lc-modal" class="mo" style="display:none" onclick="if(event.target===this)_lcCloseModal()">
    <div class="mo-box" style="max-width:540px">
      <div class="mo-hd"><span id="lc-modal-title">New Legal Case</span><button class="mo-cl" onclick="_lcCloseModal()">✕</button></div>
      <div class="mo-bd" style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
        <div class="fg"><label class="fl">Client *</label>
          <select id="lc-client_id" class="fi"><option value="">— Select client —</option></select></div>
        <div class="fg"><label class="fl">Linked Unit <span style="color:var(--t3);font-weight:400">(optional)</span></label>
          <select id="lc-unit_id" class="fi"><option value="">— No unit linked —</option></select></div>
        <div class="fg"><label class="fl">Case Number</label><input id="lc-case_number" class="fi" placeholder="e.g. KBH/2026/001"></div>
        <div class="fg"><label class="fl">Stage *</label>
          <select id="lc-stage" class="fi">${LC_STAGES.map(s => `<option value="${s.v}">${s.l}</option>`).join('')}</select></div>
        <div class="fg"><label class="fl">Case Type</label>
          <select id="lc-case_type" class="fi">${LC_TYPES.map(t => `<option value="${t.v}">${t.l}</option>`).join('')}</select></div>
        <div class="fg"><label class="fl">Lawyer Name</label><input id="lc-lawyer_name" class="fi"></div>
        <div class="fg"><label class="fl">Lawyer Contact</label><input id="lc-lawyer_contact" class="fi"></div>
        <div class="fg"><label class="fl">Filed Date</label><input type="date" id="lc-filed_date" class="fi"></div>
        <div class="fg"><label class="fl">Next Hearing</label><input type="date" id="lc-next_hearing_date" class="fi"></div>
        <div class="fg"><label class="fl">Claim Amount</label><input type="number" id="lc-claim_amount" class="fi" step="0.01" min="0"></div>
        <div class="fg"><label class="fl">Settled Amount</label><input type="number" id="lc-settled_amount" class="fi" step="0.01" min="0"></div>
        <div class="fg" style="grid-column:span 2"><label class="fl">Outcome</label>
          <input id="lc-outcome" class="fi" placeholder="e.g. Judgment in favour, Settlement reached…"></div>
        <div class="fg" style="grid-column:span 2"><label class="fl">Notes</label>
          <textarea id="lc-notes" class="fi" rows="2"></textarea></div>
        <div id="lc-modal-err" style="color:var(--err);font-size:12px;margin-top:4px;grid-column:span 2"></div>
      </div>
      <div class="mo-ft">
        <button class="btn btn-g btn-sm" onclick="_lcCloseModal()">Cancel</button>
        <button class="btn btn-p btn-sm" id="lc-save-btn" onclick="_lcSave()">Save</button>
      </div>
    </div>
  </div>`;

  await _lcLoad();
  _lcPopulateClients();
  _lcPopulateUnits();
}

let _lcFilter = 'active';
function _lcSetFilter(f, el) {
  _lcFilter = f;
  document.querySelectorAll('.lc-ftab').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  _lcRender();
}

async function _lcLoad() {
  const [{ data }, { data: an }] = await Promise.all([
    supabase.rpc('list_legal_cases',  { p_company_id: S.cid }),
    supabase.rpc('get_legal_analytics', { p_company_id: S.cid })
  ]);
  _lcData = data || [];
  _lcAnalytics = (an && an.success) ? an : null;
  _lcRender();
}

function _lcRender() {
  const bodyEl = document.getElementById('lc-body');
  const kpiEl  = document.getElementById('lc-kpi');
  if (!bodyEl) return;
  const isA = S.role === 'admin' || S.role === 'owner';

  const an = _lcAnalytics || {};
  const active   = an.active   != null ? an.active   : _lcData.filter(r => !LC_RESOLVED.includes(r.stage)).length;
  const closed   = an.resolved != null ? an.resolved : _lcData.filter(r => LC_RESOLVED.includes(r.stage)).length;
  const totalClaim = an.total_claim != null ? an.total_claim : _lcData.reduce((s, r) => s + Number(r.claim_amount || 0), 0);
  const totalCosts = _lcData.reduce((s, r) => {
    const costs = Array.isArray(r.legal_costs) ? r.legal_costs : [];
    return s + costs.reduce((a, c) => a + (Number(c.amount) || 0), 0);
  }, 0);

  if (kpiEl) {
    kpiEl.innerHTML = [
      { l:'Active Cases',    v:active, c:'var(--err)' },
      { l:'Resolved',        v:closed, c:'var(--ok)' },
      { l:'Total Claim',     v:'PKR '+fM(totalClaim), c:'var(--info)' },
      { l:'Recovered',       v:'PKR '+fM(an.total_settled||0), c:'var(--ok)' },
      { l:'Settlement Rate', v:(an.settlement_rate||0)+'%', c:'#8b5cf6' },
      { l:'Legal Costs',     v:'PKR '+fM(totalCosts), c:'#d97706' },
      { l:'Avg Resolution',  v:(an.avg_resolution_days!=null?an.avg_resolution_days+'d':'—'), c:'var(--t2)' },
    ].map(k => `<div class="card" style="padding:14px 16px">
      <div style="font-size:16px;font-weight:800;color:${k.c}">${k.v}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${k.l}</div>
    </div>`).join('');
  }

  // Upcoming hearings (next 30 days)
  const hEl = document.getElementById('lc-hearings');
  if (hEl) {
    const hrs = (an.upcoming_hearings || []);
    hEl.innerHTML = hrs.length ? `<div class="card"><div class="cb">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px">⚖️ Upcoming Hearings (next 30 days)</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${hrs.map(h => {
          const d = Number(h.days_until);
          const c = d <= 3 ? 'var(--err)' : d <= 7 ? '#f59e0b' : 'var(--t2)';
          return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:5px 8px;background:var(--canvas);border-radius:6px">
            <span><b>${esc(h.client_name||'—')}</b> · ${esc(h.case_number||'—')} <span style="color:var(--t3)">(${esc(_lcStageLabel(h.stage))})</span></span>
            <span style="color:${c};font-weight:700;white-space:nowrap">${fD(h.next_hearing_date)} · ${d===0?'today':d+'d'}</span>
          </div>`;
        }).join('')}
      </div></div></div>` : '';
  }

  let rows = _lcData;
  if (_lcFilter === 'active') rows = rows.filter(r => !LC_RESOLVED.includes(r.stage));
  if (_lcFilter === 'closed') rows = rows.filter(r => LC_RESOLVED.includes(r.stage));

  if (!rows.length) {
    bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="empty"><div class="ei">⚖️</div><div class="et">No legal cases in this filter</div></div></div></div>`;
    return;
  }

  const trs = rows.map(r => {
    const stageBadge = LC_RESOLVED.includes(r.stage)
      ? `<span class="badge ok">${esc(_lcStageLabel(r.stage))}</span>`
      : (r.stage === 'hearing' || r.stage === 'judgment')
      ? `<span class="badge err">${esc(_lcStageLabel(r.stage))}</span>`
      : `<span class="badge warn">${esc(_lcStageLabel(r.stage))}</span>`;
    const linkedUnit = r.unit_id ? (window._unitsCache || []).find(u => u.id === r.unit_id) : null;
    return `<tr>
      <td>
        <div style="font-weight:700;font-size:13px">${esc(r.clients?.client_name || '—')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(r.clients?.client_code || '')}</div>
      </td>
      <td style="font-size:12px;color:var(--t2)">${linkedUnit ? esc(linkedUnit.unitNo || linkedUnit.unit_no || '—') : '<span style="color:var(--t3)">—</span>'}</td>
      <td class="mono" style="font-size:12px">${esc(r.case_number || '—')}</td>
      <td>${stageBadge}</td>
      <td style="font-size:11px;color:var(--t2)">${esc(_lcTypeLabel(r.case_type))}</td>
      <td style="font-size:12px">${esc(r.lawyer_name || '—')}</td>
      <td class="r mono" style="font-size:12px">${r.claim_amount ? fM(r.claim_amount) : '—'}</td>
      <td style="font-size:11px;color:var(--t3)">${r.next_hearing_date ? fD(r.next_hearing_date) : '—'}</td>
      ${isA ? `<td style="text-align:right;white-space:nowrap">
        <button class="btn btn-gh btn-xs" onclick="_lcDemandLetter('${r.id}')" title="Generate demand letter / legal notice">Letter</button>
        <button class="btn btn-gh btn-xs" onclick="_lcOpenCosts('${r.id}')" title="Legal cost log">Costs${(r.legal_costs||[]).length?` <span style="background:var(--info);color:#fff;border-radius:8px;padding:0 5px;font-size:10px">${(r.legal_costs||[]).length}</span>`:''}
        </button>
        <button class="btn btn-gh btn-xs" onclick="_lcOpenDocs('${r.id}')" title="Document vault">Docs${(r.documents||[]).length?` <span style="background:#8b5cf6;color:#fff;border-radius:8px;padding:0 5px;font-size:10px">${(r.documents||[]).length}</span>`:''}
        </button>
        <button class="btn btn-gh btn-xs" onclick="_lcOpenModal('${r.id}')">Edit</button>
        <button class="btn btn-r btn-xs" onclick="_lcDelete('${r.id}')">Del</button>
      </td>` : '<td></td>'}
    </tr>`;
  }).join('');

  bodyEl.innerHTML = `<div class="card"><div class="cb"><div class="tw"><table class="t">
    <thead><tr><th>Client</th><th>Unit</th><th>Case #</th><th>Stage</th><th>Type</th><th>Lawyer</th><th class="r">Claim</th><th>Next Hearing</th>${isA ? '<th></th>' : ''}</tr></thead>
    <tbody>${trs}</tbody>
  </table></div></div></div>`;
}

async function _lcPopulateClients() {
  const { data } = await supabase.rpc('list_clients_lookup', { p_company_id: S.cid });
  const sel = document.getElementById('lc-client_id');
  if (!sel || !data) return;
  data.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.client_name} (${c.client_code || '—'})`;
    sel.appendChild(o);
  });
}

function _lcPopulateUnits() {
  const sel = document.getElementById('lc-unit_id');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  const units = (window._unitsCache || []).filter(u => u.companyId === S.cid);
  units.sort((a, b) => (a.unitNo || '').localeCompare(b.unitNo || ''));
  units.forEach(u => {
    const o = document.createElement('option');
    o.value = u.id;
    o.textContent = `${u.unitNo || '—'}${u.projectName ? ' · ' + u.projectName : ''}`;
    sel.appendChild(o);
  });
}

let _lcEditId = null;
function _lcOpenModal(id) {
  _lcEditId = id || null;
  const r = id ? _lcData.find(x => x.id === id) : null;
  document.getElementById('lc-modal-title').textContent = id ? 'Edit Legal Case' : 'New Legal Case';
  document.getElementById('lc-client_id').value = r?.client_id || '';
  document.getElementById('lc-unit_id').value    = r?.unit_id    || '';
  document.getElementById('lc-case_number').value = r?.case_number || '';
  document.getElementById('lc-stage').value = r?.stage || 'pre_legal';
  document.getElementById('lc-case_type').value = r?.case_type || 'court';
  document.getElementById('lc-lawyer_name').value = r?.lawyer_name || '';
  document.getElementById('lc-lawyer_contact').value = r?.lawyer_contact || '';
  document.getElementById('lc-filed_date').value = r?.filed_date || '';
  document.getElementById('lc-next_hearing_date').value = r?.next_hearing_date || '';
  document.getElementById('lc-claim_amount').value = r?.claim_amount || '';
  document.getElementById('lc-settled_amount').value = r?.settled_amount || '';
  document.getElementById('lc-outcome').value = r?.outcome || '';
  document.getElementById('lc-notes').value = r?.notes || '';
  document.getElementById('lc-modal-err').textContent = '';
  document.getElementById('lc-modal').style.display = 'flex';
}
function _lcCloseModal() { document.getElementById('lc-modal').style.display = 'none'; }

async function _lcSave() {
  const clientId = document.getElementById('lc-client_id').value;
  const stage    = document.getElementById('lc-stage').value;
  const errEl    = document.getElementById('lc-modal-err');
  if (!clientId) { errEl.textContent = 'Client is required.'; return; }

  const btn = document.getElementById('lc-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = {
    client_id: clientId,
    unit_id:   document.getElementById('lc-unit_id').value   || null,
    stage,
    case_type: document.getElementById('lc-case_type').value || 'court',
    case_number: document.getElementById('lc-case_number').value.trim() || null,
    lawyer_name: document.getElementById('lc-lawyer_name').value.trim() || null,
    lawyer_contact: document.getElementById('lc-lawyer_contact').value.trim() || null,
    filed_date: document.getElementById('lc-filed_date').value || null,
    next_hearing_date: document.getElementById('lc-next_hearing_date').value || null,
    claim_amount: document.getElementById('lc-claim_amount').value ? Number(document.getElementById('lc-claim_amount').value) : null,
    settled_amount: document.getElementById('lc-settled_amount').value ? Number(document.getElementById('lc-settled_amount').value) : null,
    outcome: document.getElementById('lc-outcome').value.trim() || null,
    notes: document.getElementById('lc-notes').value.trim() || null,
    created_by: _lcEditId ? undefined : S.uid,
  };

  const { error } = await supabase.rpc('upsert_legal_case', {
    p_company_id: S.cid,
    p_data: payload,
    p_id: _lcEditId || null
  });

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { errEl.textContent = error.message; return; }
  _lcCloseModal();
  await _lcLoad();
  if (typeof toast === 'function') toast(_lcEditId ? 'Case updated' : 'Case created', 'ok');
}

async function _lcDelete(id) {
  if (!confirm('Delete this legal case record?')) return;
  // Legal-case deletion is approval-gated server-side for non-admins.
  const doDel = async (reason) => {
    const { data, error } = await supabase.rpc('delete_legal_case', { p_id: id, p_company_id: S.cid, p_reason: reason || null });
    if (error) throw error;
    if (data && data.status === 'pending_approval') {
      if (typeof toast === 'function') toast('Deletion submitted for Admin approval', 'ok');
      if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
      return;
    }
    if (data && data.error === 'reason_required') {
      if (typeof _apReason === 'function') {
        _apReason('Delete Legal Case', 'Deleting a legal record requires Admin approval.',
          (r) => { doDel(r).catch(e => { if (typeof toast === 'function') toast('Delete failed: ' + e.message, 'err'); }); });
      } else if (typeof toast === 'function') { toast('A reason is required to request deletion', 'warn'); }
      return;
    }
    if (data && data.success === false) throw new Error(data.error || 'Delete failed');
    await _lcLoad();
    if (typeof toast === 'function') toast('Deleted', 'ok');
  };
  try { await doDel(null); }
  catch (e) { if (typeof toast === 'function') toast('Delete failed: ' + e.message, 'err'); }
}

// ── Demand letter / legal notice generation (Module 2.1) ───────────────
// Uses a 'demand_letter'/'legal_notice' message template if one exists
// (Comms Center), else a built-in formal default. Renders printable + logs.
async function _lcDemandLetter(id) {
  const r = _lcData.find(x => x.id === id);
  if (!r) return;

  let body = null, tplId = null;
  try {
    const { data } = await supabase.rpc('list_message_templates', { p_company_id: S.cid, p_channel: null });
    const tpls = (Array.isArray(data) ? data : []).filter(t => ['demand_letter','legal_notice'].includes(t.category) && t.is_active !== false);
    if (tpls.length) { body = tpls[0].body; tplId = tpls[0].id; }
  } catch(e) { /* fall back to default */ }

  if (!body) {
    body = 'To {{client_name}},\n\nRe: Outstanding Dues — Case {{case_number}}\n\n'
         + 'This is a formal demand for payment of PKR {{amount}} outstanding against your account. '
         + 'You are required to clear the amount within 7 (seven) days of this notice, failing which '
         + '{{company_name}} shall be constrained to initiate / continue legal proceedings without further notice.\n\n'
         + 'Dated: {{date}}\n\nFor {{company_name}}';
  }

  const coName = (typeof S !== 'undefined' && (S.coName || S.companyName)) || 'Nexunova';
  const merged = body
    .replace(/\{\{client_name\}\}/g, r.clients?.client_name || 'Client')
    .replace(/\{\{amount\}\}/g, fM(r.claim_amount || 0))
    .replace(/\{\{company_name\}\}/g, coName)
    .replace(/\{\{case_number\}\}/g, r.case_number || '—')
    .replace(/\{\{date\}\}/g, fD(td()))
    .replace(/\{\{due_date\}\}/g, r.next_hearing_date ? fD(r.next_hearing_date) : fD(td()))
    .replace(/\{\{[^}]+\}\}/g, '—');

  const br = (typeof window !== 'undefined' && window._cobranding) || {};
  const brandColor = br.doc_brand_color || '#1E2D47';
  const _dlHtml = `<!DOCTYPE html><html><head><title>Legal Notice — ${esc(r.case_number||r.clients?.client_name||'')}</title>
    <style>
      ${typeof _pCSS === 'function' ? _pCSS('A4') : 'body{font-family:Arial,sans-serif;font-size:12px;padding:30px 40px;line-height:1.7}'}
      .dl-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}
      .dl-meta-item{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:9px 12px}
      .dl-meta-item label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:2px}
      .dl-body{white-space:pre-wrap;font-size:12px;line-height:1.85;color:#374151;margin:16px 0 24px;padding:14px 16px;background:#f9fafb;border-left:3px solid ${brandColor};border-radius:0 6px 6px 0}
      @media print{body{padding:20px}@page{size:A4 portrait;margin:12mm 10mm}}
    </style></head><body>
    ${typeof _lh === 'function' ? _lh('Legal Notice / Demand Letter') : ''}
    <div class="dl-meta">
      <div class="dl-meta-item"><label>Addressed To</label><strong>${esc(r.clients?.client_name || '—')}</strong></div>
      <div class="dl-meta-item"><label>Case No.</label><strong>${esc(r.case_number || '—')}</strong></div>
      <div class="dl-meta-item"><label>Case Type</label><strong>${esc(_lcTypeLabel(r.case_type))}</strong></div>
      <div class="dl-meta-item"><label>Date</label><strong>${esc(fD(td()))}</strong></div>
    </div>
    <div class="dl-body">${esc(merged)}</div>
    ${typeof _sigBlock === 'function'
      ? _sigBlock({ label: 'Recipient Acknowledgment', value: r.clients?.client_name || '' })
      : `<div style="margin-top:48px;display:flex;gap:40px">
          <div style="flex:1;border-top:1px solid #999;padding-top:6px;font-size:11px;color:#555">For ${esc(coName)}<br>Authorized Signatory</div>
          <div style="flex:1;border-top:1px solid #999;padding-top:6px;font-size:11px;color:#555">${esc(r.clients?.client_name||'Recipient')}<br>Signature &amp; Date</div>
        </div>`}
    </body></html>`;
  _printHTML(_dlHtml, `Legal Notice — ${r.case_number || r.clients?.client_name || ''}`);

  supabase.rpc('log_message_sent', { p_company_id: S.cid, p_data: {
    client_id: r.client_id, channel: 'manual', template_id: tplId, category: 'demand_letter',
    to_address: r.clients?.phone || null, body_rendered: merged, status: 'manual', sent_by: S.username || null
  }}).catch(() => {});

  if (typeof toast === 'function') toast('Demand letter generated', 'ok');
}

// ── Legal Cost Tracking ────────────────────────────────────────
let _lcCostCaseId = null;

function _lcOpenCosts(id) {
  const r = _lcData.find(x => x.id === id);
  if (!r) return;
  _lcCostCaseId = id;
  document.getElementById('lc-costs-title').textContent = `Legal Costs — Case ${r.case_number || esc(r.clients?.client_name || '—')}`;
  document.getElementById('lcc-date').value    = td ? td() : new Date().toISOString().slice(0, 10);
  document.getElementById('lcc-amount').value  = '';
  document.getElementById('lcc-desc').value    = '';
  document.getElementById('lcc-err').textContent = '';
  _lcRenderCostsList(r);
  document.getElementById('lc-costs-modal').style.display = 'flex';
}
function _lcCloseCosts() { document.getElementById('lc-costs-modal').style.display = 'none'; }

function _lcRenderCostsList(r) {
  const costs = Array.isArray(r.legal_costs) ? r.legal_costs : [];
  const total = costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const CAT_LABELS = { lawyer_fee:'Lawyer Fee', court_fee:'Court Fee', documentation:'Documentation', miscellaneous:'Misc' };
  const listEl  = document.getElementById('lc-costs-list');
  const totalEl = document.getElementById('lc-costs-total');
  if (totalEl) totalEl.textContent = costs.length ? `Total: PKR ${fM(total)}` : '';
  if (!listEl) return;
  if (!costs.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--t3);font-size:13px">No cost entries yet</div>`;
    return;
  }
  listEl.innerHTML = costs.map((c, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${esc(c.description||'—')}</div>
        <div style="font-size:11px;color:var(--t3)">${fD(c.date||'')} · ${esc(CAT_LABELS[c.category]||c.category||'—')}</div>
      </div>
      <div style="font-size:13px;font-weight:700;color:#d97706;white-space:nowrap">PKR ${fM(Number(c.amount)||0)}</div>
      <button class="btn btn-r btn-xs" onclick="_lcRemoveCost(${i})" title="Remove">✕</button>
    </div>`).join('');
}

async function _lcAddCost() {
  const date   = document.getElementById('lcc-date').value;
  const amount = document.getElementById('lcc-amount').value;
  const desc   = document.getElementById('lcc-desc').value.trim();
  const cat    = document.getElementById('lcc-category').value;
  const errEl  = document.getElementById('lcc-err');
  if (!date || !amount || !desc) { errEl.textContent = 'Date, amount and description are required.'; return; }
  errEl.textContent = '';

  const cost = { date, amount: Number(amount), description: desc, category: cat };
  const { data, error } = await supabase.rpc('add_legal_cost', {
    p_company_id: S.cid, p_case_id: _lcCostCaseId, p_cost: cost
  });
  if (error || !data?.success) { errEl.textContent = (error||data)?.error || 'Failed to save cost.'; return; }

  await _lcLoad();
  const r = _lcData.find(x => x.id === _lcCostCaseId);
  if (r) _lcRenderCostsList(r);
  document.getElementById('lcc-amount').value = '';
  document.getElementById('lcc-desc').value   = '';
  if (typeof toast === 'function') toast('Cost entry added', 'ok');
}

async function _lcRemoveCost(idx) {
  if (!confirm('Remove this cost entry?')) return;
  const { data, error } = await supabase.rpc('remove_legal_cost', {
    p_company_id: S.cid, p_case_id: _lcCostCaseId, p_index: idx
  });
  if (error || !data?.success) { if (typeof toast === 'function') toast('Failed to remove cost', 'err'); return; }
  await _lcLoad();
  const r = _lcData.find(x => x.id === _lcCostCaseId);
  if (r) _lcRenderCostsList(r);
  if (typeof toast === 'function') toast('Cost entry removed', 'ok');
}

// ── Legal Document Vault ───────────────────────────────────────
let _lcDocCaseId = null;
const _LC_DOC_TYPE_LABELS = { petition:'Petition', evidence:'Evidence', court_order:'Court Order', agreement:'Agreement/Deed', notice:'Notice', other:'Other' };

function _lcOpenDocs(id) {
  const r = _lcData.find(x => x.id === id);
  if (!r) return;
  _lcDocCaseId = id;
  document.getElementById('lc-docs-title').textContent = `Documents — Case ${r.case_number || esc(r.clients?.client_name || '—')}`;
  document.getElementById('lcd-name').value = '';
  document.getElementById('lcd-url').value  = '';
  document.getElementById('lcd-err').textContent = '';
  _lcRenderDocsList(r);
  document.getElementById('lc-docs-modal').style.display = 'flex';
}
function _lcCloseDocs() { document.getElementById('lc-docs-modal').style.display = 'none'; }

function _lcRenderDocsList(r) {
  const docs   = Array.isArray(r.documents) ? r.documents : [];
  const listEl = document.getElementById('lc-docs-list');
  const cntEl  = document.getElementById('lc-docs-count');
  if (cntEl) cntEl.textContent = docs.length ? `${docs.length} document${docs.length !== 1 ? 's' : ''}` : 'No documents linked';
  if (!listEl) return;
  if (!docs.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--t3);font-size:13px">No documents linked yet</div>`;
    return;
  }
  listEl.innerHTML = docs.map((d, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color)">
      <div style="width:28px;height:28px;border-radius:6px;background:rgba(99,102,241,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">📄</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name||'Untitled')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(_LC_DOC_TYPE_LABELS[d.type]||d.type||'Document')}
          ${d.url ? ` · <a href="${esc(d.url)}" target="_blank" style="color:var(--indigo)">Open ↗</a>` : ''}
        </div>
      </div>
      <button class="btn btn-r btn-xs" onclick="_lcRemoveDoc(${i})" title="Remove">✕</button>
    </div>`).join('');
}

async function _lcAddDoc() {
  const name  = document.getElementById('lcd-name').value.trim();
  const url   = document.getElementById('lcd-url').value.trim();
  const type  = document.getElementById('lcd-type').value;
  const errEl = document.getElementById('lcd-err');
  if (!name) { errEl.textContent = 'Document name is required.'; return; }
  errEl.textContent = '';

  const doc = { name, url: url || null, type, added_at: td ? td() : new Date().toISOString().slice(0, 10) };
  const { data, error } = await supabase.rpc('add_legal_document', {
    p_company_id: S.cid, p_case_id: _lcDocCaseId, p_doc: doc
  });
  if (error || !data?.success) { errEl.textContent = (error||data)?.error || 'Failed to link document.'; return; }

  await _lcLoad();
  const r = _lcData.find(x => x.id === _lcDocCaseId);
  if (r) _lcRenderDocsList(r);
  document.getElementById('lcd-name').value = '';
  document.getElementById('lcd-url').value  = '';
  if (typeof toast === 'function') toast('Document linked', 'ok');
}

async function _lcRemoveDoc(idx) {
  if (!confirm('Remove this document link?')) return;
  const { data, error } = await supabase.rpc('remove_legal_document', {
    p_company_id: S.cid, p_case_id: _lcDocCaseId, p_index: idx
  });
  if (error || !data?.success) { if (typeof toast === 'function') toast('Failed to remove document', 'err'); return; }
  await _lcLoad();
  const r = _lcData.find(x => x.id === _lcDocCaseId);
  if (r) _lcRenderDocsList(r);
  if (typeof toast === 'function') toast('Document removed', 'ok');
}
