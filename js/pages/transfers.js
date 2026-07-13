/* ════════════════════════════════════════════════════════════════════════════
   UNIT TRANSFER — Owner → Owner (single-page sectioned form)
   No margin handling. New rate / new schedule / transfer charges / agent
   commission / old buyer ledger close-note. RPC: execute_unit_transfer_v2
   ════════════════════════════════════════════════════════════════════════════ */

let _txData = null;
let _txBanks = [];
let _txAgents = [];
let _txClients = [];
let _txSchedule = [];
let _txResult = null;

/* ── WARMTH BRIDGE ────────────────────────────────────────────────────────────
   The Transfer + Cancel workflows are large money/ownership forms built on the
   `rops-*` design system (shared with other pages). Per "RESTYLE ≠ REBUILD —
   logic byte-identical", this re-skins their LOOK to the warmth kit WITHOUT
   touching any markup or logic. Scoped to the two page containers so every other
   rops-* consumer (sales/reports/agents/projects) is untouched. Defined once
   here (global); cancellation.js calls it too. */
function _opsWarmCSS() {
  if (document.getElementById('_ops_warm_css')) return;
  const SC = '#pg-unittransfer, #pg-unitcancel, #pg-unitchange';
  const css = `
    ${SC}{font-family:var(--fk-font);color:var(--fk-text)}
    ${pf('.rops-hd')}{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;padding:0;border:none;background:none}
    ${pf('.rops-hd-l')}{display:flex;align-items:center;gap:12px}
    ${pf('.rops-hd-mark')}{width:40px;height:40px;border-radius:10px;background:var(--fk-primary-tint);color:var(--fk-primary);display:flex;align-items:center;justify-content:center;border:none;flex-shrink:0}
    #pg-unitcancel .rops-hd-mark,${pf('.rops-hd-mark.is-danger')}{background:var(--fk-danger-surface,rgba(220,38,38,.1));color:var(--fk-danger)}
    ${pf('.rops-hd-title')}{font-size:18px;font-weight:600;color:var(--fk-text);letter-spacing:-.01em;margin:0}
    ${pf('.rops-hd-sub')}{font-size:13px;color:var(--fk-text-muted);margin-top:2px}
    ${pf('.rops-grid')}{display:grid;grid-template-columns:1fr 340px;gap:18px;align-items:start}
    @media(max-width:1000px){${pf('.rops-grid')}{grid-template-columns:1fr}}
    ${pf('.rops-main')}{display:flex;flex-direction:column;gap:14px}
    ${pf('.rops-sec')}{background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card,12px);box-shadow:var(--fk-shadow);overflow:hidden}
    ${pf('.rops-sec.is-active')}{border-color:var(--fk-border)}
    ${pf('.rops-sec-hd')}{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--fk-border);background:none}
    ${pf('.rops-sec-hd-l')}{display:flex;align-items:center;gap:12px}
    ${pf('.rops-sec-num')}{width:28px;height:28px;border-radius:8px;background:var(--fk-primary-tint);color:var(--fk-primary);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;border:none}
    #pg-unitcancel .rops-sec-num{background:var(--fk-danger-surface,rgba(220,38,38,.1));color:var(--fk-danger)}
    ${pf('.rops-sec-title')}{font-size:14px;font-weight:600;color:var(--fk-text);margin:0}
    ${pf('.rops-sec-desc')}{font-size:12px;color:var(--fk-text-muted);margin-top:1px}
    ${pf('.rops-sec-bd')}{padding:16px}
    ${pf('.rops-sec-badge')}{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:3px 9px;border-radius:99px;background:var(--fk-bg-subtle);color:var(--fk-text-muted);border:1px solid var(--fk-border)}
    ${pf('.rops-sec-badge.is-req')}{background:var(--fk-primary-tint);color:var(--fk-primary);border-color:transparent}
    ${pf('.rops-fr')}{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
    ${pf('.rops-fl')}{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted)}
    ${pf('.rops-fl .req')}{color:var(--fk-danger)}
    ${pf('.rops-fh')}{font-size:11px;color:var(--fk-text-muted)}
    ${pf('.rops-sel')},${pf('.rops-inp')},${pf('.rops-ta')}{font-family:inherit;font-size:13px;color:var(--fk-text);background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control,8px);padding:0 11px;height:var(--fk-h-input,36px);width:100%;box-sizing:border-box}
    ${pf('.rops-ta')}{height:auto;padding:9px 11px;min-height:64px;resize:vertical}
    ${pf('.rops-sel:focus')},${pf('.rops-inp:focus')},${pf('.rops-ta:focus')}{outline:none;border-color:var(--fk-primary);box-shadow:0 0 0 3px var(--fk-primary-tint)}
    ${pf('.rops-g2')}{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    ${pf('.rops-g3')}{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
    @media(max-width:560px){${pf('.rops-g2')},${pf('.rops-g3')}{grid-template-columns:1fr}}
    ${pf('.rops-btn')}{font-family:inherit;font-size:13px;font-weight:500;height:32px;padding:0 14px;border-radius:var(--fk-radius-control,8px);border:1px solid var(--fk-border);background:var(--fk-bg-subtle);color:var(--fk-text);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .12s,border-color .12s}
    ${pf('.rops-btn:hover')}{background:var(--fk-subtle-hover,var(--fk-border))}
    ${pf('.rops-btn-primary')}{background:var(--fk-primary);border-color:var(--fk-primary);color:#fff}
    ${pf('.rops-btn-primary:hover')}{background:var(--fk-primary-hover)}
    ${pf('.rops-btn-danger')}{background:var(--fk-danger);border-color:var(--fk-danger);color:#fff}
    ${pf('.rops-btn-ghost')}{background:transparent;border-color:transparent;color:var(--fk-text-muted)}
    ${pf('.rops-btn-ghost:hover')}{background:var(--fk-bg-subtle);color:var(--fk-text)}
    ${pf('.rops-btn-sm')}{height:28px;font-size:12px;padding:0 11px}
    ${pf('.rops-btn-lg')}{height:38px;font-size:14px;padding:0 18px}
    ${pf('.rops-aside')}{min-width:0}
    ${pf('.rops-sum')}{background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card,12px);box-shadow:var(--fk-shadow);position:sticky;top:14px;overflow:hidden}
    ${pf('.rops-sum-hd')}{padding:13px 16px;border-bottom:1px solid var(--fk-border)}
    ${pf('.rops-sum-title')}{font-size:13px;font-weight:600;color:var(--fk-text)}
    ${pf('.rops-sum-bd')}{padding:14px 16px}
    ${pf('.rops-sum-hero')}{padding:14px 16px;background:var(--fk-bg-subtle);border-bottom:1px solid var(--fk-border)}
    ${pf('.rops-sum-hero-lbl')}{font-size:11px;color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:.05em}
    ${pf('.rops-sum-hero-val')}{font-size:22px;font-weight:600;color:var(--fk-text);font-variant-numeric:tabular-nums;margin-top:2px}
    ${pf('.rops-sum-row')}{display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;color:var(--fk-text-muted)}
    ${pf('.rops-sum-row span:last-child')},${pf('.rops-sum-row .r')}{color:var(--fk-text);font-weight:500;font-variant-numeric:tabular-nums}
    ${pf('.rops-sum-foot')}{padding:14px 16px;border-top:1px solid var(--fk-border)}
    ${pf('.rops-ledger')},${pf('.rops-buyer-card')},${pf('.rops-balance')},${pf('.rops-confirm')}{background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control,8px);overflow:hidden}
    ${pf('.rops-ledger-hd')}{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted);padding:9px 12px;border-bottom:1px solid var(--fk-border)}
    ${pf('.rops-ledger-row')}{display:flex;justify-content:space-between;padding:7px 12px;font-size:12.5px;border-bottom:1px solid var(--fk-border)}
    ${pf('.rops-ledger-row:last-child')}{border-bottom:none}
    ${pf('.rops-ledger-row .l')}{color:var(--fk-text-muted)}
    ${pf('.rops-ledger-row .r')}{color:var(--fk-text);font-weight:500;font-variant-numeric:tabular-nums}
    ${pf('.rops-ledger-row.is-total')}{background:var(--fk-bg-card);font-weight:600}
    ${pf('.rops-buyer-card')},${pf('.rops-confirm')},${pf('.rops-balance')}{padding:12px 14px}
    ${pf('.rops-confirm')}{background:var(--fk-warning-surface,rgba(217,119,6,.08));border-color:var(--fk-warning-edge,rgba(217,119,6,.25));font-size:13px}
    #pg-unitcancel .rops-confirm{background:var(--fk-danger-surface,rgba(220,38,38,.08));border-color:var(--fk-danger-edge,rgba(220,38,38,.25))}
    ${pf('.rops-opts')}{display:flex;flex-direction:column;gap:8px}
    ${pf('.rops-opt')}{display:flex;gap:10px;padding:11px 13px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control,8px);cursor:pointer;background:var(--fk-bg-card)}
    ${pf('.rops-opt:has(input:checked)')}{border-color:var(--fk-primary);background:var(--fk-primary-tint)}
    ${pf('.rops-opt-t')}{font-size:13px;font-weight:500;color:var(--fk-text)}
    ${pf('.rops-opt-d')}{font-size:11.5px;color:var(--fk-text-muted)}
    ${pf('.rops-badge')}{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;padding:2px 9px;border-radius:99px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);color:var(--fk-text-muted)}
    ${pf('.rops-badge .dot')}{width:6px;height:6px;border-radius:50%;background:currentColor}
    ${pf('.rops-badge.is-success')}{background:var(--fk-success-surface,rgba(22,163,74,.08));color:var(--fk-success);border-color:var(--fk-success-edge,rgba(22,163,74,.2))}
    ${pf('.rops-badge.is-warn')}{background:var(--fk-warning-surface,rgba(217,119,6,.08));color:var(--fk-warning);border-color:var(--fk-warning-edge,rgba(217,119,6,.2))}
    ${pf('.rops-badge.is-danger')}{background:var(--fk-danger-surface,rgba(220,38,38,.08));color:var(--fk-danger);border-color:var(--fk-danger-edge,rgba(220,38,38,.2))}
    ${pf('.rops-internal')}{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:5px;background:var(--fk-warning-surface,var(--fk-bg-subtle));color:var(--fk-warning)}
    ${pf('.pos')}{color:var(--fk-success)} ${pf('.neg')}{color:var(--fk-danger)} ${pf('.muted')}{color:var(--fk-text-muted)}
    ${pf('.rops-alert')}{display:flex;gap:8px;align-items:center;padding:11px 14px;border-radius:var(--fk-radius-control,8px);font-size:13px}
    ${pf('.rops-alert.is-danger')}{background:var(--fk-danger-surface,rgba(220,38,38,.08));color:var(--fk-danger);border:1px solid var(--fk-danger-edge,rgba(220,38,38,.2))}
    ${pf('.rops-empty')}{text-align:center;padding:48px 24px}
    ${pf('.rops-empty-mark')}{width:48px;height:48px;border-radius:12px;background:var(--fk-primary-tint);color:var(--fk-primary);display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px}
    ${pf('.rops-empty-t')}{font-size:15px;font-weight:600;color:var(--fk-text)}
    ${pf('.rops-empty-s')}{font-size:13px;color:var(--fk-text-muted);margin-top:4px}
    ${pf('.rops-success-screen')}{text-align:center;padding:40px 24px;max-width:520px;margin:0 auto}
    ${pf('.rops-success-mark')}{width:60px;height:60px;border-radius:50%;background:var(--fk-success-surface,rgba(22,163,74,.1));color:var(--fk-success);display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px}
    ${pf('.rops-success-title')}{font-size:20px;font-weight:600;color:var(--fk-text)}
    ${pf('.rops-success-sub')}{font-size:13.5px;color:var(--fk-text-muted);margin-top:6px}
    ${pf('.rops-success-vch')}{font-family:var(--fk-font-mono,ui-monospace,monospace);font-weight:600;color:var(--fk-text)}
    ${pf('.rops-success-actions')}{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:20px}
    ${pf('.rops-sched')}{width:100%;border-collapse:collapse;font-size:12.5px}
    ${pf('.rops-sched th')}{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--fk-text-muted);padding:8px 10px;border-bottom:1px solid var(--fk-border);background:var(--fk-bg-subtle)}
    ${pf('.rops-sched td')}{padding:8px 10px;border-bottom:1px solid var(--fk-border)}
    ${pf('.rops-spin')}{display:inline-block;width:14px;height:14px;border:2px solid var(--fk-border);border-top-color:var(--fk-primary);border-radius:50%;animation:_uspin .7s linear infinite;vertical-align:-2px}
    @keyframes _uspin{to{transform:rotate(360deg)}}
  `;
  function pf(sel){ return SC.split(',').map(s => s.trim() + ' ' + sel).join(','); }
  const st = document.createElement('style'); st.id = '_ops_warm_css'; st.textContent = css;
  document.head.appendChild(st);
}

function _txReset() {
  const today = new Date().toISOString().slice(0, 10);
  _txData = {
    // Source
    unitId: null, projectId: null,
    oldSaleId: null, oldClientId: null,
    oldSale: null, oldClient: null, unitObj: null,
    oldTotalPaid: 0, oldOutstanding: 0, oldSalePrice: 0,
    cashPaid: 0, bankPaid: 0, adjPaid: 0,

    // Header
    transferDate: today,
    transferReason: '',
    oldCloseNote: '',
    notes: '',

    // New buyer
    newClientId: '', newClientName: '',
    newClientCnic: '', newClientPhone: '',
    newClientNotes: '',
    isNewClient: false,

    // New pricing & schedule
    pricePerSqft: 0,
    areaSqft: 0,
    discount: 0,
    totalAmount: 0,
    netAmount: 0,
    downPayment: 0,
    remainingAmount: 0,
    installmentCount: 12,
    payPlan: 'installment',

    // Charges
    transferFee: 0,
    docCharges: 0,
    otherCharges: 0,
    otherChargesDesc: '',
    chargesPaidBy: 'new',
    chargesMethod: 'cash',
    chargesRef: '',

    // Agent
    agentId: '',
    commissionRate: 0
  };
  _txSchedule = [];
  _txResult = null;
}

const _TX_REASONS = [
  'Owner to owner — third party sale',
  'Transfer within family',
  'Investor exit',
  'Joint owner restructure',
  'Owner request — other',
  'Other'
];

/* ── Entry ─────────────────────────────────────────────────────────────── */
async function rUnitTransfer(preUnitId) {
  const el = document.getElementById('pg-unittransfer');
  if (!el) return;
  if (!S?.cid) {
    el.innerHTML = `<div class="rops"><div class="rops-empty">
      <div class="rops-empty-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg></div>
      <div class="rops-empty-t">No company selected</div>
    </div></div>`;
    return;
  }
  _txReset();
  if (preUnitId) _txData.unitId = preUnitId;
  await _txLoadRefs();
  _txRender(el);
  if (preUnitId) await _txAutoLoadUnit(preUnitId);
}

async function _txLoadRefs() {
  try {
    const [banks, agents, clients] = await Promise.all([
      supabase.rpc('list_banks_active', { p_company_id: S.cid }),
      supabase.rpc('list_agents_lookup', { p_company_id: S.cid }),
      supabase.rpc('list_clients_lookup', { p_company_id: S.cid })
    ]);
    _txBanks = banks.data || [];
    _txAgents = (agents.data || []).filter(a => a.is_active);
    _txClients = clients.data || [];
  } catch {
    _txBanks = []; _txAgents = []; _txClients = [];
  }
}

/* ── Render ────────────────────────────────────────────────────────────── */
function _txRender(elParam) {
  const el = elParam || document.getElementById('pg-unittransfer');
  if (!el) return;
  _opsWarmCSS();
  el.innerHTML = `
    <div class="rops" id="tx-root">
      ${_txHeaderHTML()}
      <!-- Form navigation bar (browse past transfers) -->
      <div id="tx-form-nav"></div>
      <div class="rops-grid">
        <div class="rops-main">
          ${_txSecUnitHTML()}
          ${_txSecOldCloseHTML()}
          ${_txSecNewBuyerHTML()}
          ${_txSecPricingHTML()}
          ${_txSecScheduleHTML()}
          ${_txSecAgentHTML()}
          ${_txSecChargesHTML()}
          ${_txSecReviewHTML()}
        </div>
        <aside class="rops-aside">
          ${_txSummaryHTML()}
        </aside>
      </div>
    </div>`;
  _txPopulateProjects();

  // Mount form-nav — browse past transfers. Re-uses 'sales' table because
  // transfers create a new sale row (is_transfer=true) per the ops-v2 schema.
  if (typeof mountFormNav === 'function') {
    mountFormNav({
      targetSel: '#tx-form-nav',
      entity:    'transfer',
      dateField: 'sale_date',
      currentId: null,
      storageKey:'rms.fnav.transfer',
      loadList: async () => {
        try {
          const { data } = await supabase.rpc('list_transfers_for_fnav', { p_company_id: S.cid });
          return data || [];
        } catch (e) { return []; }
      },
      openEntry: async (saleId) => {
        try {
          const { data } = await supabase.rpc('get_sale_unit_id', { p_id: saleId, p_company_id: S.cid });
          if (data?.unit_id) openUD(data.unit_id);
          else if (typeof toast === 'function') toast('Could not open transfer', 'warn');
        } catch (e) {}
      },
      onEdit: () => {
        if (typeof toast === 'function') toast('Transfers cannot be edited — create a new transfer or cancel sale instead.', 'warn');
      },
      onDelete: () => {
        if (typeof toast === 'function') toast('Transfers cannot be deleted — they are immutable for audit.', 'warn');
      },
      onSave:    () => _txSubmit(),
      onCancel:  () => nav('units'),
      saveLabel: 'Confirm Transfer'
    });
  }
}

function _txHeaderHTML() {
  return `
    <div class="rops-hd">
      <div class="rops-hd-l">
        <div class="rops-hd-mark">${_txIco('xfer')}</div>
        <div>
          <h1 class="rops-hd-title">Transfer Unit</h1>
          <div class="rops-hd-sub">Move ownership from current buyer to a new buyer</div>
        </div>
      </div>
      <div class="rops-hd-r">
        <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="nav('units')">Cancel</button>
      </div>
    </div>`;
}

/* ── Section 1: Unit selection ─────────────────────────────────────────── */
function _txSecUnitHTML() {
  return `
    <section class="rops-sec is-active" id="tx-sec-unit">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">1</div>
          <div>
            <h3 class="rops-sec-title">Unit & Current Owner</h3>
            <div class="rops-sec-desc">Pick the sold unit being transferred.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Project <span class="req">*</span></label>
            <select class="rops-sel" id="tx-project" onchange="_txOnProject(this.value)">
              <option value="">Select project</option>
            </select>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Sold Unit <span class="req">*</span></label>
            <select class="rops-sel" id="tx-unit" onchange="_txOnUnit(this.value)">
              <option value="">Choose project first</option>
            </select>
          </div>
        </div>
        <div id="tx-unit-info" style="margin-top:16px"></div>
      </div>
    </section>`;
}

function _txPopulateProjects() {
  const sel = document.getElementById('tx-project');
  if (!sel) return;
  const projects = window._projectsCache || [];
  const soldByProj = {};
  (window._unitsCache || []).forEach(u => { if (!u.isAvailable) soldByProj[u.projectId] = (soldByProj[u.projectId] || 0) + 1; });

  // Show ALL projects; mark those with no sold units as disabled so the user
  // understands WHY they can't pick them (instead of seeing a blank dropdown).
  const totalSold = Object.values(soldByProj).reduce((s,n) => s+n, 0);
  const opts = projects.map(p => {
    const cnt  = soldByProj[p.id] || 0;
    const name = esc(p.projectName || p.name || 'Unnamed project');
    return cnt
      ? `<option value="${esc(p.id)}">${name} · ${cnt} sold</option>`
      : `<option value="" disabled style="color:var(--text-faint)">${name} · no sold units</option>`;
  }).join('');

  if (!projects.length) {
    sel.innerHTML = `<option value="">No projects exist yet</option>`;
  } else if (!totalSold) {
    sel.innerHTML = `<option value="">No sold units yet — record a sale first</option>${opts}`;
  } else {
    sel.innerHTML = `<option value="">Select project</option>${opts}`;
  }

  if (_txData.unitId) {
    const u = (window._unitsCache || []).find(x => x.id === _txData.unitId);
    if (u?.projectId) { sel.value = u.projectId; _txOnProject(u.projectId, _txData.unitId); }
  }
}

function _txOnProject(projectId, autoUnit) {
  _txData.projectId = projectId;
  const uSel = document.getElementById('tx-unit');
  if (!uSel) return;
  if (!projectId) {
    uSel.innerHTML = `<option value="">Choose project first</option>`;
    document.getElementById('tx-unit-info').innerHTML = '';
    _txUpdateSummary();
    return;
  }
  const units = (window._unitsCache || []).filter(u => u.projectId === projectId && !u.isAvailable);
  uSel.innerHTML = `<option value="">Choose unit</option>` +
    units.map(u => `<option value="${esc(u.id)}">${esc(u.unitNo)}${u.floorLabel ? ' · ' + u.floorLabel : ''}${u.type ? ' · ' + u.type : ''}</option>`).join('');
  if (autoUnit) { uSel.value = autoUnit; _txOnUnit(autoUnit); }
}

async function _txAutoLoadUnit(unitId) {
  const u = (window._unitsCache || []).find(x => x.id === unitId);
  if (u?.projectId) _txOnProject(u.projectId, unitId);
}

async function _txOnUnit(unitId) {
  _txData.unitId = unitId;
  const info = document.getElementById('tx-unit-info');
  if (!info || !unitId) { if (info) info.innerHTML = ''; _txUpdateSummary(); return; }
  info.innerHTML = `<div class="rops-buyer-card"><div class="rops-bc-item"><span class="rops-spin"></span> Loading current owner…</div></div>`;

  try {
    const [pymRes, saleRes] = await Promise.all([
      supabase.rpc('get_unit_payment_summary', { p_unit_id: unitId, p_company_id: S.cid }),
      supabase.rpc('get_active_sale_for_unit', { p_unit_id: unitId, p_company_id: S.cid })
    ]);

    const sale = saleRes.data;
    const pym = pymRes.data;
    if (!sale) {
      info.innerHTML = `<div class="rops-alert is-warn">${_txIco('warn')} No active sale exists on this unit.</div>`;
      _txData.oldSaleId = null;
      _txUpdateSummary();
      return;
    }

    _txData.oldSaleId = sale.id;
    _txData.oldClientId = sale.client_id;
    _txData.oldSale = sale;

    const insts = pym?.installments || [];
    let totalPaid = 0;
    insts.forEach(i => { totalPaid += parseFloat(i.amount_paid || 0); });
    if (pym?.down_payment) totalPaid += parseFloat(pym.down_payment.amount_paid || 0);

    const netAmt = parseFloat(pym?.sale?.net_amount || sale.net_amount || 0);
    const outstanding = Math.max(0, netAmt - totalPaid);

    const pmtRes = await supabase.rpc('list_payments_for_sale', { p_sale_id: sale.id, p_company_id: S.cid });
    const pmts = pmtRes.data || [];
    const cashPaid = pmts.filter(p => p.payment_method === 'cash' && p.payment_category !== 'adjustment').reduce((s, p) => s + parseFloat(p.amount), 0);
    const bankPaid = pmts.filter(p => p.payment_method === 'bank' && p.payment_category !== 'adjustment').reduce((s, p) => s + parseFloat(p.amount), 0);
    const adjPaid = pmts.filter(p => p.payment_category === 'adjustment').reduce((s, p) => s + parseFloat(p.amount), 0);

    _txData.oldTotalPaid = totalPaid;
    _txData.oldOutstanding = outstanding;
    _txData.oldSalePrice = netAmt;
    _txData.cashPaid = cashPaid;
    _txData.bankPaid = bankPaid;
    _txData.adjPaid = adjPaid;
    _txData.areaSqft = parseFloat(sale.area_sqft || 0);

    const [clientRes, unitObj] = await Promise.all([
      supabase.rpc('get_client_lite', { p_id: sale.client_id, p_company_id: S.cid }),
      Promise.resolve((window._unitsCache || []).find(u => u.id === unitId))
    ]);
    _txData.oldClient = clientRes.data;
    _txData.unitObj = unitObj;

    const c = clientRes.data || {};
    const prj = (window._projectsCache || []).find(p => p.id === _txData.projectId);

    info.innerHTML = `
      <div class="rops-buyer-card">
        <div class="rops-bc-item"><span class="l">Unit</span><span class="v">${esc(unitObj?.unitNo || '')}${unitObj?.floorLabel ? ' · ' + esc(unitObj.floorLabel) : ''}</span></div>
        <div class="rops-bc-item"><span class="l">Project</span><span class="v">${esc(prj?.name || prj?.projectName || '')}</span></div>
        <div class="rops-bc-item"><span class="l">Type / Area</span><span class="v">${esc(unitObj?.type || '—')}${_txData.areaSqft ? ' · ' + Number(_txData.areaSqft).toLocaleString() + ' sqft' : ''}</span></div>
        <div class="rops-bc-item"><span class="l">Current Owner</span><span class="v">${esc(c.full_name || '')}</span></div>
        <div class="rops-bc-item"><span class="l">CNIC</span><span class="v">${esc(c.cnic || '—')}</span></div>
        <div class="rops-bc-item"><span class="l">Phone</span><span class="v">${esc(c.phone_primary || '—')}</span></div>
        <div class="rops-bc-item"><span class="l">Sale No</span><span class="v">${esc(sale.sale_number || '')}</span></div>
        <div class="rops-bc-item"><span class="l">Sale Date</span><span class="v">${esc(sale.sale_date || '')}</span></div>
      </div>
      <div class="rops-ledger" style="margin-top:14px">
        <div class="rops-ledger-hd">Current Owner Ledger (read-only)</div>
        <div class="rops-ledger-row"><span class="l">Sale Price</span><span class="r">PKR ${fmtTX(netAmt)}</span></div>
        <div class="rops-ledger-row"><span class="l">Cash Received</span><span class="r">PKR ${fmtTX(cashPaid)}</span></div>
        <div class="rops-ledger-row"><span class="l">Bank Received</span><span class="r">PKR ${fmtTX(bankPaid)}</span></div>
        ${adjPaid ? `<div class="rops-ledger-row"><span class="l">Adjustment</span><span class="r">PKR ${fmtTX(adjPaid)}</span></div>` : ''}
        <div class="rops-ledger-row is-total"><span class="l">Total Paid</span><span class="r pos">PKR ${fmtTX(totalPaid)}</span></div>
        <div class="rops-ledger-row"><span class="l">Outstanding</span><span class="r ${outstanding > 0 ? 'neg' : 'muted'}">PKR ${fmtTX(outstanding)}</span></div>
      </div>`;

    _txMarkDone('tx-sec-unit');
    _txUpdateSummary();
  } catch (e) {
    info.innerHTML = `<div class="rops-alert is-danger">${_txIco('warn')} Error: ${esc(e.message)}</div>`;
    _txData.oldSaleId = null;
    _txUpdateSummary();
  }
}

/* ── Section 2: Old buyer close note ───────────────────────────────────── */
function _txSecOldCloseHTML() {
  return `
    <section class="rops-sec" id="tx-sec-close">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">2</div>
          <div>
            <h3 class="rops-sec-title">Close Current Owner's Ledger</h3>
            <div class="rops-sec-desc">Internal note recorded on the closing sale (company eyes only).</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Transfer Date <span class="req">*</span></label>
            <input type="date" class="rops-inp" id="tx-date" value="${esc(_txData.transferDate)}" oninput="_txData.transferDate=this.value">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Transfer Reason <span class="req">*</span></label>
            <select class="rops-sel" id="tx-reason" onchange="_txData.transferReason=this.value">
              <option value="">Select reason</option>
              ${_TX_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="rops-fr" style="margin-top:14px; max-width:780px">
          <label class="rops-fl">Close Note for Current Owner's Ledger <span class="req">*</span></label>
          <textarea class="rops-ta" id="tx-close-note" rows="2" placeholder="e.g. Buyer settled directly with new buyer; original payments retained as deemed received from continuing owner." oninput="_txData.oldCloseNote=this.value">${esc(_txData.oldCloseNote)}</textarea>
          <div class="rops-fh">Appears only on internal records. Never shown on client-facing documents.</div>
        </div>
      </div>
    </section>`;
}

/* ── Section 3: New buyer ──────────────────────────────────────────────── */
function _txSecNewBuyerHTML() {
  const clientOpts = _txClients.map(c =>
    `<option value="${esc(c.id)}">${esc(c.full_name)}${c.cnic ? ' · ' + esc(c.cnic) : ''}</option>`
  ).join('');
  return `
    <section class="rops-sec" id="tx-sec-newbuyer">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">3</div>
          <div>
            <h3 class="rops-sec-title">New Buyer</h3>
            <div class="rops-sec-desc">Existing client or add a new one.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-opts is-2col" style="margin-bottom:16px">
          <div class="rops-opt is-on" id="tx-existing-opt" onclick="_txSetNewClientMode(false)">
            <div class="rops-opt-rad"></div>
            <div class="rops-opt-bd">
              <div class="rops-opt-t">Existing Client</div>
              <div class="rops-opt-d">Pick from your client list.</div>
            </div>
          </div>
          <div class="rops-opt" id="tx-new-opt" onclick="_txSetNewClientMode(true)">
            <div class="rops-opt-rad"></div>
            <div class="rops-opt-bd">
              <div class="rops-opt-t">New Client</div>
              <div class="rops-opt-d">Add a fresh client record on submit.</div>
            </div>
          </div>
        </div>

        <div id="tx-existing-block">
          <div class="rops-fr" style="max-width:560px">
            <label class="rops-fl">Select Client <span class="req">*</span></label>
            <select class="rops-sel" id="tx-new-client" onchange="_txOnNewClient(this.value)">
              <option value="">Search and select…</option>${clientOpts}
            </select>
          </div>
        </div>

        <div id="tx-new-block" style="display:none">
          <div class="rops-g2" style="max-width:720px">
            <div class="rops-fr">
              <label class="rops-fl">Full Name <span class="req">*</span></label>
              <input type="text" class="rops-inp" id="tx-nc-name" placeholder="New buyer name" oninput="_txData.newClientName=this.value">
            </div>
            <div class="rops-fr">
              <label class="rops-fl">CNIC <span class="req">*</span></label>
              <input type="text" class="rops-inp" id="tx-nc-cnic" placeholder="35202-XXXXXXX-X" oninput="_txData.newClientCnic=this.value">
            </div>
            <div class="rops-fr">
              <label class="rops-fl">Phone <span class="req">*</span></label>
              <input type="text" class="rops-inp" id="tx-nc-phone" placeholder="+92 3xx xxxxxxx" oninput="_txData.newClientPhone=this.value">
            </div>
            <div class="rops-fr">
              <label class="rops-fl">Notes</label>
              <input type="text" class="rops-inp" id="tx-nc-notes" placeholder="Optional" oninput="_txData.newClientNotes=this.value">
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

function _txSetNewClientMode(isNew) {
  _txData.isNewClient = isNew;
  document.getElementById('tx-existing-opt')?.classList.toggle('is-on', !isNew);
  document.getElementById('tx-new-opt')?.classList.toggle('is-on', isNew);
  document.getElementById('tx-existing-block').style.display = isNew ? 'none' : '';
  document.getElementById('tx-new-block').style.display = isNew ? '' : 'none';
  _txUpdateSummary();
}

function _txOnNewClient(id) {
  _txData.newClientId = id;
  const c = _txClients.find(x => x.id === id);
  if (c) {
    _txData.newClientName = c.full_name;
    _txData.newClientCnic = c.cnic || '';
    _txData.newClientPhone = c.phone_primary || '';
  }
  _txUpdateSummary();
}

/* ── Section 4: New pricing ────────────────────────────────────────────── */
function _txSecPricingHTML() {
  return `
    <section class="rops-sec" id="tx-sec-price">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">4</div>
          <div>
            <h3 class="rops-sec-title">New Sale Pricing</h3>
            <div class="rops-sec-desc">New buyer's own rate and area-based net amount.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g3" style="max-width:780px">
          <div class="rops-fr">
            <label class="rops-fl">Area (sqft) <span class="req">*</span></label>
            <input type="text" inputmode="decimal" class="rops-inp is-amt" id="tx-area" value="${_txData.areaSqft || 0}" oninput="_txCalcNet()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Price / sqft (PKR) <span class="req">*</span></label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="tx-rate" value="0" oninput="_txCalcNet()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Discount (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="tx-disc" value="0" oninput="_txCalcNet()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Total Amount</label>
            <input type="text" class="rops-inp is-amt" id="tx-total" readonly value="0">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Net Amount (after discount)</label>
            <input type="text" class="rops-inp is-amt" id="tx-net" readonly value="0">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Down Payment (PKR) <span class="req">*</span></label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="tx-down" value="0" oninput="_txCalcNet()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Remaining</label>
            <input type="text" class="rops-inp is-amt" id="tx-rem" readonly value="0">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Number of Installments</label>
            <input type="number" min="0" class="rops-inp" id="tx-instcount" value="${_txData.installmentCount}" oninput="_txData.installmentCount=parseInt(this.value)||0">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Payment Plan</label>
            <select class="rops-sel" id="tx-plan" onchange="_txData.payPlan=this.value">
              <option value="installment" selected>Monthly installments</option>
              <option value="quarterly">Quarterly</option>
              <option value="lumpsum">Lump-sum</option>
            </select>
          </div>
        </div>
      </div>
    </section>`;
}

function _txCalcNet() {
  const g = id => parseAmt(document.getElementById(id)?.value);
  _txData.areaSqft = g('tx-area');
  _txData.pricePerSqft = g('tx-rate');
  _txData.discount = g('tx-disc');
  _txData.downPayment = g('tx-down');
  const total = _txData.areaSqft * _txData.pricePerSqft;
  const net = Math.max(0, total - _txData.discount);
  const rem = Math.max(0, net - _txData.downPayment);
  _txData.totalAmount = total;
  _txData.netAmount = net;
  _txData.remainingAmount = rem;

  const $ = id => document.getElementById(id);
  if ($('tx-total')) $('tx-total').value = fmtTX(total);
  if ($('tx-net')) $('tx-net').value = fmtTX(net);
  if ($('tx-rem')) $('tx-rem').value = fmtTX(rem);
  _txUpdateSummary();
}

/* ── Section 5: Schedule ───────────────────────────────────────────────── */
function _txSecScheduleHTML() {
  return `
    <section class="rops-sec" id="tx-sec-sched">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">5</div>
          <div>
            <h3 class="rops-sec-title">New Installment Schedule</h3>
            <div class="rops-sec-desc">Generate evenly-distributed installments or define manually.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-req">Required</span>
      </div>
      <div class="rops-sec-bd">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap">
          <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="_txGenSchedule()">Generate Schedule</button>
          <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="_txAddInst()">+ Add Row</button>
          <button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="_txClearSchedule()">Clear</button>
          <span id="tx-balance" class="rops-balance is-warn" style="margin-left:auto">Balance: PKR 0 / 0</span>
        </div>
        <div class="rops-sched">
          <table id="tx-sched-tbl">
            <thead><tr>
              <th style="width:50px">#</th>
              <th>Label</th>
              <th style="width:160px">Due Date</th>
              <th style="width:140px" class="num">Amount (PKR)</th>
              <th style="width:140px" class="num">Cumulative</th>
              <th style="width:50px"></th>
            </tr></thead>
            <tbody id="tx-sched-body">
              <tr><td colspan="6" style="text-align:center; color:var(--t3); padding:24px">No installments yet — click <strong>Generate Schedule</strong>.</td></tr>
            </tbody>
            <tfoot id="tx-sched-foot"></tfoot>
          </table>
        </div>
      </div>
    </section>`;
}

function _txGenSchedule() {
  const d = _txData;
  if (!d.netAmount || d.netAmount <= 0) { _txToast('Enter pricing first.', 'warn'); return; }
  const count = d.installmentCount;
  const remain = Math.max(0, d.netAmount - d.downPayment);
  if (count <= 0) { _txSchedule = []; _txRenderSchedule(); return; }

  const per = Math.floor(remain / count);
  const last = remain - per * (count - 1);
  const startDate = d.transferDate || new Date().toISOString().slice(0, 10);
  const sched = [];
  for (let i = 1; i <= count; i++) {
    const due = new Date(startDate);
    if (d.payPlan === 'quarterly') due.setMonth(due.getMonth() + i * 3);
    else due.setMonth(due.getMonth() + i);
    sched.push({
      installment_number: i,
      installment_type: 'installment',
      due_date: due.toISOString().slice(0, 10),
      amount_due: i === count ? last : per,
      notes: _txOrdinal(i) + ' Installment'
    });
  }
  _txSchedule = sched;
  _txRenderSchedule();
}

function _txAddInst() {
  const next = _txSchedule.length + 1;
  const last = _txSchedule[_txSchedule.length - 1];
  const baseDate = last?.due_date || _txData.transferDate || new Date().toISOString().slice(0, 10);
  const d = new Date(baseDate); d.setMonth(d.getMonth() + 1);
  _txSchedule.push({
    installment_number: next,
    installment_type: 'installment',
    due_date: d.toISOString().slice(0, 10),
    amount_due: 0,
    notes: _txOrdinal(next) + ' Installment'
  });
  _txRenderSchedule();
}

function _txClearSchedule() { _txSchedule = []; _txRenderSchedule(); }

function _txRenderSchedule() {
  const body = document.getElementById('tx-sched-body');
  const foot = document.getElementById('tx-sched-foot');
  if (!body) return;
  if (!_txSchedule.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--t3); padding:24px">No installments yet — click <strong>Generate Schedule</strong>.</td></tr>`;
    if (foot) foot.innerHTML = '';
    _txUpdateBalance();
    return;
  }
  let cum = _txData.downPayment;
  body.innerHTML = _txSchedule.map((r, idx) => {
    cum += parseFloat(r.amount_due) || 0;
    return `<tr>
      <td>${r.installment_number}</td>
      <td><input type="text" class="rops-inp" value="${esc(r.notes || '')}" oninput="_txSchedule[${idx}].notes=this.value"></td>
      <td><input type="date" class="rops-inp" value="${esc(r.due_date)}" oninput="_txSchedule[${idx}].due_date=this.value"></td>
      <td class="num"><input type="text" inputmode="numeric" class="rops-inp is-amt" value="${fmtTX(r.amount_due)}" oninput="_txOnInstAmount(${idx}, this.value)"></td>
      <td class="num">${fmtTX(cum)}</td>
      <td><button class="rops-btn rops-btn-ghost rops-btn-sm" onclick="_txDelInst(${idx})" style="padding:4px 8px">×</button></td>
    </tr>`;
  }).join('');
  const total = _txSchedule.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  foot.innerHTML = `<tr>
    <td colspan="3" style="text-align:right">Total Installments</td>
    <td class="num">${fmtTX(total)}</td>
    <td class="num">${fmtTX(_txData.downPayment + total)}</td>
    <td></td>
  </tr>`;
  _txUpdateBalance();
}

function _txOnInstAmount(idx, val) {
  _txSchedule[idx].amount_due = parseAmt(val);
  _txRenderCumulativeOnly();
}

function _txRenderCumulativeOnly() {
  // Update only cumulative cells without re-rendering inputs (preserves focus)
  let cum = _txData.downPayment;
  _txSchedule.forEach(r => { cum += parseFloat(r.amount_due) || 0; });
  // Easiest: re-render whole schedule but skip if we're typing (we already redraw on blur)
  _txRenderSchedule();
}

function _txDelInst(idx) {
  _txSchedule.splice(idx, 1);
  _txSchedule.forEach((r, i) => { r.installment_number = i + 1; });
  _txRenderSchedule();
}

function _txUpdateBalance() {
  const el = document.getElementById('tx-balance');
  if (!el) return;
  const expected = Math.max(0, _txData.netAmount - _txData.downPayment);
  const actual = _txSchedule.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const diff = expected - actual;
  el.textContent = `Balance: PKR ${fmtTX(actual)} / ${fmtTX(expected)}`;
  el.className = 'rops-balance ' + (Math.abs(diff) < 1 ? 'is-ok' : actual > expected ? 'is-err' : 'is-warn');
}

function _txOrdinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ── Section 6: Agent commission ───────────────────────────────────────── */
function _txSecAgentHTML() {
  const opts = _txAgents.map(a => `<option value="${esc(a.id)}" data-rate="${a.commission_percent || 0}">${esc(a.full_name)} (${esc(a.agent_code)}) — ${a.commission_percent || 0}%</option>`).join('');
  return `
    <section class="rops-sec" id="tx-sec-agent">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">6</div>
          <div>
            <h3 class="rops-sec-title">Agent & Commission</h3>
            <div class="rops-sec-desc">Optional — assign an agent to this transfer sale.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-opt">Optional</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:640px">
          <div class="rops-fr">
            <label class="rops-fl">Agent</label>
            <select class="rops-sel" id="tx-agent" onchange="_txOnAgent(this.value, this.selectedOptions[0]?.dataset.rate)">
              <option value="">No agent</option>${opts}
            </select>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Commission Rate (%)</label>
            <input type="text" inputmode="decimal" class="rops-inp is-amt" id="tx-comm" value="0" oninput="_txData.commissionRate=parseFloat(this.value)||0; _txUpdateSummary()">
          </div>
        </div>
      </div>
    </section>`;
}

function _txOnAgent(agentId, rate) {
  _txData.agentId = agentId || null;
  if (agentId && rate) {
    _txData.commissionRate = parseFloat(rate) || 0;
    const r = document.getElementById('tx-comm');
    if (r) r.value = _txData.commissionRate;
  }
  _txUpdateSummary();
}

/* ── Section 7: Transfer charges ───────────────────────────────────────── */
function _txSecChargesHTML() {
  return `
    <section class="rops-sec" id="tx-sec-charges">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">7</div>
          <div>
            <h3 class="rops-sec-title">Transfer Charges</h3>
            <div class="rops-sec-desc">Transfer fee, documentation charges, and any other costs.</div>
          </div>
        </div>
        <span class="rops-sec-badge is-opt">Optional</span>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-g2" style="max-width:780px">
          <div class="rops-fr">
            <label class="rops-fl">Transfer Fee (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="tx-fee" value="0" oninput="_txCalcCharges()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Documentation Charges (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="tx-doc" value="0" oninput="_txCalcCharges()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Other Charges (PKR)</label>
            <input type="text" inputmode="numeric" class="rops-inp is-amt" id="tx-other" value="0" oninput="_txCalcCharges()">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Other Charges Note</label>
            <input type="text" class="rops-inp" id="tx-other-note" placeholder="Describe" oninput="_txData.otherChargesDesc=this.value">
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Paid By</label>
            <select class="rops-sel" id="tx-paidby" onchange="_txData.chargesPaidBy=this.value">
              <option value="new">New buyer</option>
              <option value="old">Current owner</option>
              <option value="split">Split 50/50</option>
              <option value="waived">Waived</option>
            </select>
          </div>
          <div class="rops-fr">
            <label class="rops-fl">Payment Method</label>
            <select class="rops-sel" id="tx-cmethod" onchange="_txData.chargesMethod=this.value">
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div class="rops-fr fr-full">
            <label class="rops-fl">Reference / Receipt No</label>
            <input type="text" class="rops-inp" id="tx-cref" placeholder="Optional" oninput="_txData.chargesRef=this.value">
          </div>
        </div>
      </div>
    </section>`;
}

function _txCalcCharges() {
  const g = id => parseAmt(document.getElementById(id)?.value);
  _txData.transferFee = g('tx-fee');
  _txData.docCharges = g('tx-doc');
  _txData.otherCharges = g('tx-other');
  _txUpdateSummary();
}

/* ── Section 8: Review & submit ────────────────────────────────────────── */
function _txSecReviewHTML() {
  return `
    <section class="rops-sec" id="tx-sec-review">
      <div class="rops-sec-hd">
        <div class="rops-sec-hd-l">
          <div class="rops-sec-num">8</div>
          <div>
            <h3 class="rops-sec-title">Review & Confirm</h3>
            <div class="rops-sec-desc">On confirm: current sale closes, new sale opens with the schedule, transfer record created.</div>
          </div>
        </div>
      </div>
      <div class="rops-sec-bd">
        <div class="rops-fr fr-full" style="margin-bottom:12px; max-width:780px">
          <label class="rops-fl">Internal Notes</label>
          <textarea class="rops-ta" id="tx-notes" rows="2" placeholder="Any additional notes for company records…" oninput="_txData.notes=this.value"></textarea>
        </div>
        <div class="rops-confirm">
          <input type="checkbox" id="tx-confirm">
          <div class="rops-confirm-text">I confirm all details above and authorize the ownership transfer.</div>
        </div>
        <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end">
          <button class="rops-btn rops-btn-ghost" onclick="nav('units')">Cancel</button>
          <button class="rops-btn rops-btn-primary rops-btn-lg" id="tx-submit-btn" onclick="_txSubmit()">Confirm Transfer</button>
        </div>
      </div>
    </section>`;
}

/* ── Sticky summary ────────────────────────────────────────────────────── */
function _txSummaryHTML() {
  return `
    <div class="rops-sum" id="tx-summary">
      <div class="rops-sum-hd"><h4 class="rops-sum-title">Transfer Summary</h4></div>
      <div class="rops-sum-bd" id="tx-sum-bd">${_txSumBodyHTML()}</div>
      <div class="rops-sum-hero">
        <span class="rops-sum-hero-lbl">New Net Amount</span>
        <span class="rops-sum-hero-val" id="tx-sum-net">PKR 0</span>
      </div>
      <div class="rops-sum-foot" id="tx-sum-foot">
        <div class="rops-sum-row"><span class="l">Total Charges</span><span class="r" id="tx-sum-charges">PKR 0</span></div>
        <div class="rops-sum-row"><span class="l">Commission</span><span class="r" id="tx-sum-comm">PKR 0</span></div>
      </div>
    </div>`;
}

function _txSumBodyHTML() {
  const d = _txData;
  return `
    <div class="rops-sum-row"><span class="l">Unit</span><span class="r">${d.unitObj ? esc(d.unitObj.unitNo) : '—'}</span></div>
    <div class="rops-sum-row"><span class="l">From</span><span class="r">${d.oldClient ? esc((d.oldClient.full_name || '').split(' ')[0]) : '—'}</span></div>
    <div class="rops-sum-row"><span class="l">To</span><span class="r">${d.newClientName ? esc((d.newClientName || '').split(' ')[0]) : '—'}</span></div>
    <div class="rops-sum-row"><span class="l">Old Price</span><span class="r">PKR ${fmtTX(d.oldSalePrice)}</span></div>
    <div class="rops-sum-row"><span class="l">New Price</span><span class="r">PKR ${fmtTX(d.netAmount)}</span></div>
    <div class="rops-sum-row"><span class="l">Down Payment</span><span class="r">PKR ${fmtTX(d.downPayment)}</span></div>
    <div class="rops-sum-row"><span class="l">Installments</span><span class="r">${_txSchedule.length}</span></div>`;
}

function _txUpdateSummary() {
  const $ = id => document.getElementById(id);
  if ($('tx-sum-bd')) $('tx-sum-bd').innerHTML = _txSumBodyHTML();
  if ($('tx-sum-net')) $('tx-sum-net').textContent = 'PKR ' + fmtTX(_txData.netAmount);
  const charges = _txData.transferFee + _txData.docCharges + _txData.otherCharges;
  if ($('tx-sum-charges')) $('tx-sum-charges').textContent = 'PKR ' + fmtTX(charges);
  const comm = _txData.commissionRate > 0 ? Math.round(_txData.netAmount * _txData.commissionRate / 100) : 0;
  if ($('tx-sum-comm')) $('tx-sum-comm').textContent = 'PKR ' + fmtTX(comm);
}

function _txMarkDone(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('is-active'); el.classList.add('is-done'); }
}

/* ── Validation + submit ───────────────────────────────────────────────── */
function _txValidate() {
  const d = _txData;
  const fail = m => { _txToast(m, 'error'); return false; };
  if (!d.unitId) return fail('Select a unit.');
  if (!d.oldSaleId) return fail('No active sale on this unit.');
  if (!d.transferDate) return fail('Transfer date required.');
  if (!d.transferReason) return fail('Select a transfer reason.');
  if (!d.oldCloseNote?.trim()) return fail('Close note for current owner is required.');

  if (d.isNewClient) {
    if (!d.newClientName?.trim()) return fail('New client name required.');
    if (!d.newClientCnic?.trim()) return fail('New client CNIC required.');
    if (!d.newClientPhone?.trim()) return fail('New client phone required.');
  } else if (!d.newClientId) {
    return fail('Select the new buyer.');
  }

  if (!d.netAmount || d.netAmount <= 0) return fail('New sale net amount must be greater than zero.');
  if (d.downPayment < 0 || d.downPayment > d.netAmount) return fail('Down payment is out of range.');

  // Schedule validation (only if there are installments)
  const expected = Math.max(0, d.netAmount - d.downPayment);
  const actual = _txSchedule.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  if (Math.abs(expected - actual) > 1) return fail('Schedule total does not match remaining amount.');

  if (!document.getElementById('tx-confirm')?.checked) return fail('Please tick the confirmation checkbox.');
  return true;
}

async function _txSubmit() {
  if (!_txValidate()) return;
  const btn = document.getElementById('tx-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="rops-spin"></span> Processing…`; }

  const d = _txData;
  try {
    let newClientId = d.newClientId;
    // If new client, create the client record first via RPC
    if (d.isNewClient) {
      const code = 'CLT-' + Date.now().toString().slice(-6);
      const { data: nc, error: ncErr } = await supabase.rpc('create_client', { p_data: {
        company_id: S.cid,
        project_id: d.projectId,
        client_code: code,
        full_name: d.newClientName,
        cnic: d.newClientCnic,
        phone_primary: d.newClientPhone,
        notes: d.newClientNotes || null,
        status: 'active'
      } });
      if (ncErr) throw new Error('Failed to create client: ' + ncErr.message);
      newClientId = nc?.client_id || nc?.id;
    }

    const newSalePayload = {
      price_per_sqft: d.pricePerSqft,
      area_sqft: d.areaSqft,
      total_amount: d.totalAmount,
      discount: d.discount,
      net_amount: d.netAmount,
      down_payment: d.downPayment,
      installment_count: _txSchedule.length,
      payment_plan_type: d.payPlan,
      notes: d.notes || null
    };

    const installments = _txSchedule.map(r => ({
      installment_number: r.installment_number,
      installment_type: 'installment',
      due_date: r.due_date,
      amount_due: r.amount_due,
      notes: r.notes
    }));

    const { data, error } = await supabase.rpc('execute_unit_transfer_v2', {
      p_company_id: S.cid,
      p_transfer_date: d.transferDate,
      p_unit_id: d.unitId,
      p_project_id: d.projectId,
      p_old_sale_id: d.oldSaleId,
      p_old_client_id: d.oldClientId,
      p_old_total_paid: d.oldTotalPaid,
      p_old_outstanding: d.oldOutstanding,
      p_old_sale_price: d.oldSalePrice,
      p_old_close_note: d.oldCloseNote,
      p_new_client_id: newClientId,
      p_new_sale: newSalePayload,
      p_installments: installments,
      p_transfer_fee: d.transferFee,
      p_documentation_charges: d.docCharges,
      p_other_charges: d.otherCharges,
      p_other_charges_desc: d.otherChargesDesc || null,
      p_charges_paid_by: d.chargesPaidBy,
      p_charges_payment_method: d.chargesMethod,
      p_charges_reference: d.chargesRef || null,
      p_agent_id: d.agentId || null,
      p_commission_rate: d.commissionRate || 0,
      p_notes: d.notes || null,
      p_created_by: S.uname || S.email || null
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Unknown server error');

    // Soft-block: transfer is pending admin approval, not yet executed
    if (data.status === 'pending_approval') {
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm Transfer'; }
      _txRenderApprovalPending(data.request_id);
      if (typeof refreshApprovalsBadge === 'function') refreshApprovalsBadge();
      return;
    }

    _txResult = data;
    if (typeof loadAllData === 'function') loadAllData();
    else if (typeof _refreshCaches === 'function') _refreshCaches();

    _txRenderSuccess(data);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Transfer'; }
    _txToast('Transfer failed: ' + e.message, 'error');
  }
}

function _txRenderSuccess(data) {
  const el = document.getElementById('pg-unittransfer');
  if (!el) return;
  el.innerHTML = `
    <div class="rops">
      <div class="rops-success-screen">
        <div class="rops-success-mark">${_txIco('check')}</div>
        <h2 class="rops-success-title">Transfer Complete</h2>
        <div class="rops-success-sub">Ownership transferred. New sale ${esc(data.new_sale_number || '')} opened.</div>
        <div class="rops-success-vch">${esc(data.voucher_no || '')}</div>
        <div class="rops-success-actions">
          <button class="rops-btn rops-btn-primary" onclick="printTransferVoucher('${esc(data.transfer_id)}','${esc(data.voucher_no)}')">Print Voucher</button>
          <button class="rops-btn rops-btn-ghost" onclick="printTransferLetter('${esc(data.transfer_id)}')">Print Letter</button>
          <button class="rops-btn rops-btn-ghost" onclick="nav('transferunits')">View Ledger</button>
          <button class="rops-btn rops-btn-ghost" onclick="rUnitChain('${esc(_txData.unitId)}')">Ownership Chain</button>
          <button class="rops-btn rops-btn-ghost" onclick="nav('units')">Back to Inventory</button>
        </div>
      </div>
    </div>`;
}

function _txRenderApprovalPending(requestId) {
  const el = document.getElementById('pg-unittransfer');
  if (!el) return;
  el.innerHTML = `
    <div class="rops">
      <div class="rops-success-screen">
        <div class="rops-success-mark" style="background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <h2 class="rops-success-title">Approval Requested</h2>
        <div class="rops-success-sub">This transfer requires admin approval. Your request has been submitted and is pending review.</div>
        ${requestId ? `<div class="rops-success-vch" style="font-size:11px">Request ID: ${esc(requestId)}</div>` : ''}
        <div class="rops-success-actions">
          <button class="rops-btn rops-btn-ghost" onclick="nav('units')">Back to Inventory</button>
        </div>
      </div>
    </div>`;
}

/* ── Print transfer LETTER (Phase 4 — Crystal-style A4 certificate) ─────── */
function printTransferLetter(transferId) {
  if (!transferId || !S || !S.cid) { if (typeof toast === 'function') toast('Missing transfer or company id', 'err'); return; }
  window.open(
    'reports/transfer-letter.html?transfer_id=' + encodeURIComponent(transferId) + '&company_id=' + encodeURIComponent(S.cid),
    '_blank'
  );
}

/* ── Print voucher ─────────────────────────────────────────────────────── */
async function printTransferVoucher(transferId, voucherNo) {
  const d = _txData;
  const u = d.unitObj || {};
  const prj = (window._projectsCache || []).find(p => p.id === d.projectId) || {};
  const co = window._companyCache || {};
  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const charges = d.transferFee + d.docCharges + d.otherCharges;

  const w = typeof _pw === 'function' ? _pw('Unit Transfer Voucher — ' + (voucherNo || ''), typeof _pCSS === 'function' ? _pCSS('A4') : '', 'A4') : window.open('', '_blank');
  if (!w) return;
  const lh = typeof _lh === 'function' ? _lh('Transfer Voucher') : '';

  w.document.write(`
    <div class="pg">
      ${lh}
      <div class="co-block">
        <div class="co-name">${esc(co.company_name || 'Company')}</div>
        <div class="co-sub">Unit Transfer Voucher</div>
      </div>
      <table class="meta-table">
        <tr><td><strong>Voucher No:</strong> ${esc(voucherNo || '')}</td><td><strong>Date:</strong> ${today}</td></tr>
        <tr><td><strong>Reason:</strong> ${esc(d.transferReason)}</td><td><strong>Effective:</strong> ${esc(d.transferDate)}</td></tr>
      </table>
      <h3 class="sec-hd">Unit</h3>
      <table class="data-table"><tbody>
        <tr><td>Project</td><td>${esc(prj.name || prj.projectName || '')}</td><td>Unit Number</td><td>${esc(u.unitNo || '')}</td></tr>
        <tr><td>Floor</td><td>${esc(u.floorLabel || '')}</td><td>Type</td><td>${esc(u.type || '')}</td></tr>
        <tr><td>Area</td><td>${d.areaSqft ? d.areaSqft + ' sqft' : '—'}</td><td>New Sale No</td><td>${esc(_txResult?.new_sale_number || '')}</td></tr>
      </tbody></table>
      <h3 class="sec-hd">Previous Owner</h3>
      <table class="data-table"><tbody>
        <tr><td>Name</td><td>${esc(d.oldClient?.full_name || '')}</td><td>CNIC</td><td>${esc(d.oldClient?.cnic || '—')}</td></tr>
        <tr><td>Phone</td><td>${esc(d.oldClient?.phone_primary || '—')}</td><td>Original Sale No</td><td>${esc(d.oldSale?.sale_number || '')}</td></tr>
      </tbody></table>
      <h3 class="sec-hd">New Owner</h3>
      <table class="data-table"><tbody>
        <tr><td>Name</td><td>${esc(d.newClientName || '')}</td><td>CNIC</td><td>${esc(d.newClientCnic || '—')}</td></tr>
        <tr><td>Phone</td><td>${esc(d.newClientPhone || '—')}</td><td>—</td><td>—</td></tr>
      </tbody></table>
      <h3 class="sec-hd">New Sale Financials</h3>
      <table class="data-table"><tbody>
        <tr><td>Area</td><td>${d.areaSqft} sqft</td><td>Rate</td><td>PKR ${fmtTX(d.pricePerSqft)} / sqft</td></tr>
        <tr><td>Total</td><td>PKR ${fmtTX(d.totalAmount)}</td><td>Discount</td><td>PKR ${fmtTX(d.discount)}</td></tr>
        <tr><td><strong>Net</strong></td><td><strong>PKR ${fmtTX(d.netAmount)}</strong></td><td><strong>Down Payment</strong></td><td><strong>PKR ${fmtTX(d.downPayment)}</strong></td></tr>
        <tr><td>Remaining</td><td>PKR ${fmtTX(d.remainingAmount)}</td><td>Installments</td><td>${_txSchedule.length}</td></tr>
      </tbody></table>
      <h3 class="sec-hd">Transfer Charges</h3>
      <table class="data-table"><tbody>
        <tr><td>Transfer Fee</td><td>PKR ${fmtTX(d.transferFee)}</td><td>Doc Charges</td><td>PKR ${fmtTX(d.docCharges)}</td></tr>
        <tr><td>Other</td><td>PKR ${fmtTX(d.otherCharges)}${d.otherChargesDesc ? ' (' + esc(d.otherChargesDesc) + ')' : ''}</td><td><strong>Total</strong></td><td><strong>PKR ${fmtTX(charges)}</strong></td></tr>
        <tr><td>Paid By</td><td>${esc({ new: 'New buyer', old: 'Current owner', split: '50/50 split', waived: 'Waived' }[d.chargesPaidBy] || '')}</td><td>Method</td><td>${esc(d.chargesMethod || '')}</td></tr>
      </tbody></table>
      ${d.notes ? `<h3 class="sec-hd">Remarks</h3><div class="remarks-box">${esc(d.notes)}</div>` : ''}
      <div class="sig-grid">
        <div class="sig-box"><div class="sig-line"></div><div>Previous Owner</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>New Owner</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>Authorized Signature</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>Witness</div></div>
      </div>
      <div class="footer-note">Printed: ${today} | ${esc(voucherNo || '')} | Computer-generated document.</div>
    </div>`);
  if (typeof _pclose === 'function') _pclose(w); else { w.document.close(); w.focus(); }
}

/* ── Helpers ───────────────────────────────────────────────────────────── */
function _txToast(msg, type) {
  if (window.notify) {
    if (type === 'error') notify.error('Error', { detail: msg });
    else if (type === 'success') notify.success(msg);
    else notify.info(msg);
  } else if (typeof showToast === 'function') {
    try { showToast(type === 'error' ? 'error' : 'info', msg); } catch { showToast(msg, type); }
  } else { alert(msg); }
}

function fmtTX(n) {
  return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function _txIco(name) {
  const i = {
    xfer:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
    check: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warn:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>'
  };
  return i[name] || '';
}
