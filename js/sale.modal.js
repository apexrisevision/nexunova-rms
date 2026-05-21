// ══════════════════════════════════════════════════════════════════
//  Nexunova RMS — Sale Modal v2.0  (Schedule-powered)
//  Replaces static openSellModal / saveSell in modals.js
//  Requires: schedule.engine.js loaded before this file
// ══════════════════════════════════════════════════════════════════

/* ── Internal state ────────────────────────────────────────────── */
let _sellDPCount   = 1;   // number of DP stages shown
let _sellSchedule  = null; // last buildSchedule() result

/* ══════════════════════════════════════════════════════════════════
   OPEN SELL MODAL
══════════════════════════════════════════════════════════════════ */
function openSellModal(unitId) {
  if (S.role !== 'admin' && S.role !== 'owner') { toast('Admin only', 'warn'); return; }
  // For Supabase-based accounts the unit lives only in _unitsCache, not in gdb().
  // The old modal only persists to localStorage so redirect to the proper sale form.
  const gdbUnits = gdb()?.units?.[S.cid];
  const inLegacy = Array.isArray(gdbUnits) && gdbUnits.some(u => u.id === unitId);
  if (!inLegacy) {
    if (typeof nav === 'function') nav('newsale');
    return;
  }
  const u   = gunit(unitId);
  const db  = gdb();

  // ── Inject modal HTML once ──
  if (!document.getElementById('m-sell')) {
    _buildSellModalDOM();
  }

  // ── Populate staff dropdown ──
  // Source: live Supabase `app_users` cache. Legacy `db.users` from localStorage
  // only ever contained the seed admin/staff and never any real teammates.
  const staffSel = document.getElementById('sl-by');
  if (staffSel) {
    const realUsers = (window._appUsersCache || []).filter(x => x.is_active !== false);
    if (!realUsers.length) {
      staffSel.innerHTML = '<option value="">No staff yet — add users in Admin → Users & Roles</option>';
    } else {
      staffSel.innerHTML =
        '<option value="">Select staff...</option>' +
        realUsers
          .map(x => {
            const nm = x.full_name || x.name || x.username || '';
            return `<option value="${esc(nm)}">${esc(nm)}${x.role ? ' · ' + esc(x.role) : ''}</option>`;
          })
          .join('');
    }
  }

  document.getElementById('sell-lbl').textContent = `Unit ${u?.unitNo || ''}`;

  // ── Restore existing data if editing ──
  if (u && u.customerName) {
    _setF('sl-n',   u.customerName || '');
    _setF('sl-ph',  u.phone        || '');
    _setF('sl-bk',  u.bookingNo    || '');
    _setF('sl-pr',  u.totalPrice   || '');
    _setF('sl-pd',  u.totalPaid    || '');
    _setF('sl-dt',  u.soldDate     || td());
    _setF('sl-tp',  u.status       || 'Installment');
    _setF('sl-rem', u.remarks      || '');
    _setF('sl-sqft',u.area         || '');
    _setF('sl-rate','');
    _setF('sl-com', u.soldDate     || td());
    _setF('sl-mon', 12);

    // Try to restore saved schedule params
    const saved = loadSchedule(unitId);
    if (saved?.params) {
      _sellDPCount = saved.params.dpStages?.length || 1;
      _setF('sl-mon', saved.params.months  || 12);
      _setF('sl-com', saved.params.commence || u.soldDate || td());
      _buildDPStages(saved.params.dpStages);
    } else {
      _sellDPCount = 1;
      _buildDPStages([{ label: 'Booking Amount', amount: u.totalPaid || 0 }]);
    }
  } else {
    ['sl-n','sl-ph','sl-bk','sl-pr','sl-pd','sl-rem','sl-rate'].forEach(id => _setF(id, ''));
    _setF('sl-dt',  td());
    _setF('sl-tp',  'Installment');
    _setF('sl-sqft', u?.area || '');
    _setF('sl-com',  td());
    _setF('sl-mon',  12);
    _sellDPCount = 1;
    _buildDPStages([{ label: 'Booking Amount', amount: '' }]);
  }

  _uid = unitId;
  document.querySelectorAll('#m-sell .inp-err').forEach(el => el.classList.remove('inp-err'));
  om('m-sell');
  _schedulePreviewUpdate();
}

/* ── field helper ── */
function _setF(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val !== undefined && val !== null ? val : '';
}

/* ══════════════════════════════════════════════════════════════════
   BUILD MODAL DOM  (injected once)
══════════════════════════════════════════════════════════════════ */
function _buildSellModalDOM() {
  const wrap = document.createElement('div');
  wrap.id        = 'm-sell';
  wrap.className = 'mov';
  wrap.innerHTML = `
<div class="md sell-md" style="max-width:780px;width:97vw">

  <!-- ── Header ── -->
  <div class="mh">
    <div>
      <h3 id="sell-lbl">Register Sale</h3>
      <p style="font-size:11px;color:var(--t3);margin-top:2px">Complete all fields · schedule generates automatically</p>
    </div>
    <button class="mx" onclick="cm('m-sell')">✕</button>
  </div>

  <!-- ── Body ── -->
  <div class="mb sell-mb">

    <!-- LEFT COLUMN: Client + Pricing + DP + Schedule Config -->
    <div class="sell-left">

      <!-- Client Info -->
      <div class="sell-sec">
        <div class="sell-sec-hd">👤 Client</div>
        <div class="fg-row">
          <div class="fg fg-2">
            <label class="fl">Client Name *</label>
            <input class="inp" id="sl-n" placeholder="Full name" autocomplete="off">
          </div>
          <div class="fg fg-2">
            <label class="fl">Phone</label>
            <input class="inp" id="sl-ph" placeholder="03XX-XXXXXXX" type="tel">
          </div>
        </div>
        <div class="fg-row">
          <div class="fg fg-2">
            <label class="fl">Booking #</label>
            <input class="inp" id="sl-bk" placeholder="e.g. 225">
          </div>
          <div class="fg fg-2">
            <label class="fl">Sold By</label>
            <select class="inp" id="sl-by">
              <option value="">Select staff...</option>
            </select>
          </div>
        </div>
        <div class="fg-row">
          <div class="fg fg-2">
            <label class="fl">Sale Date</label>
            <input class="inp" id="sl-dt" type="date">
          </div>
          <div class="fg fg-2">
            <label class="fl">Sale Type</label>
            <select class="inp" id="sl-tp" onchange="_schedulePreviewUpdate()">
              <option value="Installment">Installment</option>
              <option value="CashSale">Cash Sale</option>
              <option value="Adjustment">Adjustment</option>
            </select>
          </div>
        </div>
        <div class="fg">
          <label class="fl">Remarks</label>
          <input class="inp" id="sl-rem" placeholder="Optional notes">
        </div>
      </div>

      <!-- Pricing -->
      <div class="sell-sec">
        <div class="sell-sec-hd">💰 Pricing</div>
        <div class="fg-row">
          <div class="fg fg-3">
            <label class="fl">Area (sqft)</label>
            <input class="inp" id="sl-sqft" type="number" min="0" step="0.01"
              placeholder="Auto from unit" oninput="_calcTotalFromRate()">
          </div>
          <div class="fg fg-3">
            <label class="fl">Rate / sqft (PKR)</label>
            <input class="inp" id="sl-rate" type="number" min="0" step="1"
              placeholder="0" oninput="_calcTotalFromRate()">
          </div>
          <div class="fg fg-3">
            <label class="fl">Total Value (PKR) *</label>
            <input class="inp mono" id="sl-pr" type="number" min="0" step="1"
              placeholder="0" oninput="_schedulePreviewUpdate()">
          </div>
        </div>
        <!-- Legacy base-paid field (hidden; kept for backward compat) -->
        <input type="hidden" id="sl-pd" value="0">
      </div>

      <!-- Down Payments -->
      <div class="sell-sec">
        <div class="sell-sec-hd" style="display:flex;align-items:center;justify-content:space-between">
          <span>📋 Down Payments</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-gh btn-xs" onclick="_removeDPStage()" id="dp-remove-btn">− Remove</button>
            <button class="btn btn-g btn-xs"  onclick="_addDPStage()">+ Add Stage</button>
          </div>
        </div>
        <div id="dp-stages"></div>
      </div>

      <!-- Installment Schedule Config -->
      <div class="sell-sec" id="sched-config-sec">
        <div class="sell-sec-hd">📅 Installment Schedule</div>
        <div class="fg-row">
          <div class="fg fg-2">
            <label class="fl">Schedule Commence</label>
            <input class="inp" id="sl-com" type="date" oninput="_schedulePreviewUpdate()">
          </div>
          <div class="fg fg-2">
            <label class="fl">Installment Months</label>
            <select class="inp" id="sl-mon" onchange="_schedulePreviewUpdate()">
              ${[0,3,6,9,12,18,24,30,36,42,48,54,60].map(m =>
                `<option value="${m}">${m === 0 ? 'No installments (Cash)' : m + ' months'}</option>`
              ).join('')}
            </select>
          </div>
        </div>
      </div>

    </div>

    <!-- RIGHT COLUMN: KPI bar + live schedule preview -->
    <div class="sell-right">

      <!-- KPI Summary Strip -->
      <div class="sell-kpi-row" id="sell-kpis">
        <div class="sell-kpi" id="skpi-asset">
          <div class="skpi-lbl">Asset Value</div>
          <div class="skpi-val" id="kv-asset">—</div>
        </div>
        <div class="sell-kpi" id="skpi-dp">
          <div class="skpi-lbl">Total Advance</div>
          <div class="skpi-val c-g" id="kv-dp">—</div>
        </div>
        <div class="sell-kpi" id="skpi-recv">
          <div class="skpi-lbl">Receivable</div>
          <div class="skpi-val" style="color:var(--err)" id="kv-recv">—</div>
        </div>
        <div class="sell-kpi" id="skpi-emi">
          <div class="skpi-lbl">Monthly EMI</div>
          <div class="skpi-val" style="color:var(--info)" id="kv-emi">—</div>
        </div>
      </div>

      <!-- Validation Errors -->
      <div id="sell-errs" style="display:none;margin-bottom:10px"></div>

      <!-- Schedule Preview Table -->
      <div class="sell-sched-hd">
        <span>📊 Payment Schedule Preview</span>
        <span id="sell-sched-count" style="font-size:11px;color:var(--t3)"></span>
      </div>
      <div class="sell-sched-wrap" id="sell-sched-wrap">
        <div class="sell-sched-empty">
          Fill pricing &amp; DP fields to generate schedule →
        </div>
      </div>

    </div>
  </div>

  <!-- ── Footer ── -->
  <div class="mf">
    <button class="btn btn-gh" onclick="cm('m-sell')">Cancel</button>
    <button class="btn btn-g" onclick="saveSell()" id="sell-commit-btn">
      ✅ Commit &amp; Register Sale
    </button>
  </div>

</div>`;
  document.body.appendChild(wrap);

  // ── Populate initial DP stages ──
  _buildDPStages([{ label: 'Booking Amount', amount: '' }]);
}

/* ══════════════════════════════════════════════════════════════════
   DOWN PAYMENT STAGE MANAGER
══════════════════════════════════════════════════════════════════ */
function _buildDPStages(stages) {
  const container = document.getElementById('dp-stages');
  if (!container) return;
  stages = stages || [{ label: 'Booking Amount', amount: '' }];
  _sellDPCount = stages.length;
  container.innerHTML = '';
  stages.forEach((dp, i) => _appendDPRow(container, dp, i));
  _refreshDPButtons();
}

function _appendDPRow(container, dp, idx) {
  const row = document.createElement('div');
  row.className = 'dp-row';
  row.setAttribute('data-dp', idx);
  row.innerHTML = `
    <div class="fg-row" style="margin-bottom:0">
      <div class="fg fg-4" style="flex:1.4">
        <label class="fl">Stage Label</label>
        <input class="inp dp-lbl" placeholder="e.g. Booking / On Possession"
          value="${esc(dp.label || '')}" oninput="_schedulePreviewUpdate()">
      </div>
      <div class="fg fg-4" style="flex:1">
        <label class="fl">Amount (PKR)</label>
        <input class="inp dp-amt mono" type="number" min="0" step="1"
          placeholder="0" value="${dp.amount || ''}"
          oninput="_schedulePreviewUpdate()">
      </div>
      <div class="fg fg-4" style="flex:1">
        <label class="fl">Due Date</label>
        <input class="inp dp-due" type="date"
          value="${dp.dueDate || ''}"
          oninput="_schedulePreviewUpdate()">
      </div>
    </div>`;
  container.appendChild(row);
}

function _addDPStage() {
  _sellDPCount++;
  const container = document.getElementById('dp-stages');
  if (!container) return;
  const labels = ['Booking Amount', 'On Possession', 'On Completion', 'Final Payment'];
  _appendDPRow(container, { label: labels[Math.min(_sellDPCount - 1, labels.length - 1)] || `Stage ${_sellDPCount}`, amount: '' }, _sellDPCount - 1);
  _refreshDPButtons();
  _schedulePreviewUpdate();
}

function _removeDPStage() {
  if (_sellDPCount <= 1) { toast('At least one down payment stage required', 'warn'); return; }
  const container = document.getElementById('dp-stages');
  if (!container || !container.lastElementChild) return;
  container.removeChild(container.lastElementChild);
  _sellDPCount--;
  _refreshDPButtons();
  _schedulePreviewUpdate();
}

function _refreshDPButtons() {
  const btn = document.getElementById('dp-remove-btn');
  if (btn) btn.disabled = _sellDPCount <= 1;
}

function _readDPStages() {
  const rows = document.querySelectorAll('#dp-stages .dp-row');
  return Array.from(rows).map(row => ({
    label  : (row.querySelector('.dp-lbl')?.value || '').trim(),
    amount : _parseAmt(row.querySelector('.dp-amt')?.value),
    dueDate: row.querySelector('.dp-due')?.value || '',
  }));
}

/* ══════════════════════════════════════════════════════════════════
   RATE CALCULATOR  (sqft × rate → totalValue)
══════════════════════════════════════════════════════════════════ */
function _calcTotalFromRate() {
  const sqft = parseFloat(document.getElementById('sl-sqft')?.value) || 0;
  const rate = parseFloat(document.getElementById('sl-rate')?.value) || 0;
  if (sqft > 0 && rate > 0) {
    const total = Math.round(sqft * rate);
    const el = document.getElementById('sl-pr');
    if (el) el.value = total;
  }
  _schedulePreviewUpdate();
}

/* ══════════════════════════════════════════════════════════════════
   LIVE SCHEDULE PREVIEW  (fires on every input change)
══════════════════════════════════════════════════════════════════ */
function _schedulePreviewUpdate() {
  const totalValue = _parseAmt(document.getElementById('sl-pr')?.value);
  const months     = parseInt(document.getElementById('sl-mon')?.value) || 0;
  const commence   = document.getElementById('sl-com')?.value || td();
  const dpStages   = _readDPStages();
  const saleType   = document.getElementById('sl-tp')?.value || 'Installment';

  // Hide installment config for cash sales
  const configSec = document.getElementById('sched-config-sec');
  if (configSec) configSec.style.display = saleType === 'CashSale' ? 'none' : '';

  const params = {
    totalValue,
    months   : saleType === 'CashSale' ? 0 : months,
    commence,
    dpStages,
  };

  const result = buildSchedule(params);
  _sellSchedule = result;

  _renderKPIs(result.summary);
  _renderErrors(result);
  _renderScheduleTable(result);
}

/* ── KPI strip ── */
function _renderKPIs(s) {
  if (!s || !s.totalValue) {
    ['kv-asset','kv-dp','kv-recv','kv-emi'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    return;
  }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kv-asset', fM(s.totalValue));
  set('kv-dp',    fM(s.totalDP));
  set('kv-recv',  fM(s.totalEMI));
  set('kv-emi',   s.emi > 0 ? fM(s.emi) + '/mo' : '— (Cash)');

  // Integrity badge on asset KPI
  const assetEl = document.getElementById('skpi-asset');
  if (assetEl) {
    assetEl.style.borderBottomColor = s.balanced ? 'var(--ok)' : 'var(--err)';
  }
}

/* ── Validation errors ── */
function _renderErrors(result) {
  const el = document.getElementById('sell-errs');
  if (!el) return;
  if (result.valid || !result.errors.length) {
    el.style.display = 'none';
    el.innerHTML = '';
  } else {
    el.style.display = 'block';
    el.innerHTML = `<div class="sell-err-box">${result.errors.map(e => `<div>⚠ ${esc(e)}</div>`).join('')}</div>`;
  }
  // Enable/disable commit button
  const btn = document.getElementById('sell-commit-btn');
  if (btn) btn.disabled = !result.valid;
}

/* ── Schedule Table ── */
function _renderScheduleTable(result) {
  const wrap    = document.getElementById('sell-sched-wrap');
  const counter = document.getElementById('sell-sched-count');
  if (!wrap) return;

  if (!result.rows || !result.rows.length) {
    wrap.innerHTML = '<div class="sell-sched-empty">Fill in pricing &amp; DP amounts to preview schedule →</div>';
    if (counter) counter.textContent = '';
    return;
  }

  if (counter) counter.textContent = `${result.rows.length} rows · ${fM(result.summary.totalScheduled)} total`;

  const today = td();
  const statusCfg = {
    paid    : { cls: 'ss-paid',     label: '✅ Paid'    },
    partial : { cls: 'ss-partial',  label: '◑ Partial'  },
    overdue : { cls: 'ss-overdue',  label: '🔴 Overdue'  },
    upcoming: { cls: 'ss-upcoming', label: '○ Upcoming' },
  };

  const rowsHTML = result.rows.map(row => {
    const sc  = statusCfg[row.status] || statusCfg.upcoming;
    const dp  = row.type === 'dp';
    return `<tr class="${dp ? 'ss-dp-row' : ''}">
      <td class="ss-no">${row.installmentNo}</td>
      <td class="ss-date">${fD(row.dueDate)}</td>
      <td class="ss-label ${dp ? 'ss-dp-lbl' : ''}">${esc(row.label)}</td>
      <td class="ss-debit mono">${fM(row.debit)}</td>
      <td class="ss-bal mono" style="color:var(--t3)">${fM(row.balance)}</td>
      <td><span class="ss-status ${sc.cls}">${sc.label}</span></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="ss-tbl">
      <thead>
        <tr>
          <th>#</th><th>Due Date</th><th>Description</th>
          <th class="r">Amount</th><th class="r">Balance</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot>
        <tr class="ss-total-row">
          <td colspan="3" style="font-weight:700">TOTAL</td>
          <td class="r mono" style="font-weight:700">${fM(result.summary.totalScheduled)}</td>
          <td colspan="2" style="font-size:10px;color:${result.summary.balanced ? 'var(--ok)' : 'var(--err)'}">
            ${result.summary.balanced ? '✓ Balanced' : '⚠ Mismatch'}
          </td>
        </tr>
      </tfoot>
    </table>`;
}

/* ══════════════════════════════════════════════════════════════════
   SAVE SELL  (replaces original saveSell)
══════════════════════════════════════════════════════════════════ */
function saveSell() {
  if (typeof demoGuard === 'function' && demoGuard('Save Sale')) return;
  // ── 1. Basic field validation ──
  const name  = (document.getElementById('sl-n')?.value || '').trim();
  const price = _parseAmt(document.getElementById('sl-pr')?.value);

  const _slSetErr = (inputId, msg) => {
    const inp = document.getElementById(inputId);
    if (inp) inp.classList.toggle('inp-err', !!msg);
    if (msg) { toast(msg, 'err'); return true; }
    return false;
  };
  if (_slSetErr('sl-n', !name ? 'Client name is required' : '')) return;
  if (_slSetErr('sl-pr', (!price || price <= 0) ? 'Total price must be greater than zero' : '')) return;

  // ── 2. Schedule validation ──
  if (!_sellSchedule || !_sellSchedule.valid) {
    // Re-run in case state is stale
    _schedulePreviewUpdate();
    if (!_sellSchedule || !_sellSchedule.valid) {
      const errMsg = (_sellSchedule?.errors || ['Schedule configuration is incomplete.']).join(' ');
      toast('⚠ ' + errMsg, 'err');
      return;
    }
  }

  // ── 3. Balance integrity check ──
  if (!_sellSchedule.summary.balanced) {
    if (!confirm('⚠ Schedule total does not match the asset value. Commit anyway?')) return;
  }

  const db      = gdb();
  const units   = db.units[S.cid] || [];
  const idx     = units.findIndex(u => u.id === _uid);
  if (idx < 0)  { toast('Unit not found', 'err'); return; }

  const soldDate   = document.getElementById('sl-dt')?.value  || td();
  const bookingNo  = (document.getElementById('sl-bk')?.value || '').trim();
  const newStatus  = document.getElementById('sl-tp')?.value  || 'Installment';
  const dpStages   = _readDPStages();
  const commence   = document.getElementById('sl-com')?.value || td();
  const months     = parseInt(document.getElementById('sl-mon')?.value) || 0;

  // Total down paid = sum of all DP amounts (treated as initial collection)
  const totalDP = dpStages.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // ── 4. Update unit record ──
  units[idx] = {
    ...units[idx],
    status       : newStatus,
    customerName : name,
    phone        : (document.getElementById('sl-ph')?.value || '').trim(),
    bookingNo,
    soldBy       : document.getElementById('sl-by')?.value || '',
    soldDate,
    totalPrice   : price,
    totalPaid    : totalDP,
    pendingAmount: Math.max(0, price - totalDP),
    remarks      : (document.getElementById('sl-rem')?.value || '').trim(),
  };
  // Data integrity guard
  if (units[idx].pendingAmount > units[idx].totalPrice)
    units[idx].pendingAmount = units[idx].totalPrice;

  db.units[S.cid] = units;

  // ── 5. Register DP payments in recovery ledger ──
  db.recoveries[S.cid] = db.recoveries[S.cid] || [];

  dpStages.forEach(dp => {
    if (!dp.amount || dp.amount <= 0) return;
    const already = (db.recoveries[S.cid]).find(
      r => r.uid === _uid && r.notes === `Initial: ${dp.label}`
    );
    if (!already) {
      db.recoveries[S.cid].push({
        id    : uid(),
        cid   : S.cid,
        uid   : _uid,
        amt   : dp.amount,
        date  : dp.dueDate || soldDate,
        ptype : 'Cash',
        rcpt  : bookingNo,
        notes : `Initial: ${dp.label}`,
        at    : new Date().toISOString(),
        by    : S.userId,
      });
    }
  });

  // ── 6. Persist schedule ──
  db.schedules          = db.schedules || {};
  db.schedules[S.cid]   = db.schedules[S.cid] || {};
  db.schedules[S.cid][_uid] = {
    unitId    : _uid,
    createdAt : new Date().toISOString(),
    createdBy : S.userId,
    params    : { totalValue: price, months, commence, dpStages },
    rows      : _sellSchedule.rows,
  };

  // ── 7. Persist & close ──
  sdb(db);
  cm('m-sell');
  logA('sell', `${units[idx].unitNo} → ${name}`);
  toast(`Unit ${units[idx].unitNo} committed ✅`, 'ok');
  buildSB();
  nav('unitdetail');
}

/* ══════════════════════════════════════════════════════════════════
   SCHEDULE TAB IN UNIT DETAIL  (rUD calls this)
   Renders the hydrated live schedule for an already-sold unit.
══════════════════════════════════════════════════════════════════ */
function renderUnitSchedule(unitId) {
  const saved = loadSchedule(unitId);
  if (!saved) return '<div class="empty"><div class="ei">📋</div><div class="et">No schedule found</div><div class="es">Schedule is generated when a unit is committed via the Sale form</div></div>';

  const recs     = grecs(unitId);
  const rows     = hydrateSchedule(saved.rows || [], recs);
  const today    = td();

  const totDebit  = rows.reduce((s, r) => s + r.debit, 0);
  const totPaid   = rows.reduce((s, r) => s + r.received, 0);
  const totBal    = Math.max(0, totDebit - totPaid);
  const overdueRows = rows.filter(r => r.status === 'overdue').length;

  const statusCfg = {
    paid    : { cls: 'ss-paid',     label: '✅ Paid'    },
    partial : { cls: 'ss-partial',  label: '◑ Partial'  },
    overdue : { cls: 'ss-overdue',  label: '🔴 Overdue'  },
    upcoming: { cls: 'ss-upcoming', label: '○ Upcoming' },
  };

  const rowsHTML = rows.map(row => {
    const sc = statusCfg[row.status] || statusCfg.upcoming;
    const dp = row.type === 'dp';
    const recAmt = row.received > 0 ? `<span style="color:var(--ok)">+${fM(row.received)}</span>` : '—';
    return `<tr class="${dp ? 'ss-dp-row' : ''}${row.status === 'overdue' ? ' ss-overdue-row' : ''}">
      <td class="ss-no">${row.installmentNo}</td>
      <td class="ss-date" style="${row.status === 'overdue' ? 'color:var(--err);font-weight:700' : ''}">${fD(row.dueDate)}</td>
      <td class="ss-label ${dp ? 'ss-dp-lbl' : ''}">${esc(row.label)}</td>
      <td class="ss-debit mono">${fM(row.debit)}</td>
      <td class="mono">${recAmt}</td>
      <td class="ss-bal mono" style="color:${row.balance > 0 ? 'var(--err)' : 'var(--ok)'}">${fM(row.balance)}</td>
      <td><span class="ss-status ${sc.cls}">${sc.label}</span></td>
    </tr>`;
  }).join('');

  return `
    <div class="ch" style="${overdueRows > 0 ? 'background:rgba(239,68,68,0.025)' : ''}">
      <div>
        <h3>📋 Payment Schedule
          ${overdueRows > 0 ? `<span class="badge bni" style="margin-left:6px">${overdueRows} overdue</span>` : ''}
        </h3>
        <p>${rows.length} rows · ${fM(totPaid)} paid · ${fM(totBal)} remaining</p>
      </div>
    </div>
    <div class="tw">
      <table class="ss-tbl t">
        <thead>
          <tr>
            <th>#</th><th>Due Date</th><th>Description</th>
            <th class="r">Due</th><th class="r">Received</th>
            <th class="r">Balance</th><th>Status</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
        <tfoot>
          <tr class="ss-total-row">
            <td colspan="3" style="font-weight:700">TOTAL</td>
            <td class="r mono" style="font-weight:700">${fM(totDebit)}</td>
            <td class="r mono c-g">${fM(totPaid)}</td>
            <td class="r mono" style="color:${totBal > 0 ? 'var(--err)' : 'var(--ok)'}; font-weight:700">${fM(totBal)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

/* ──────────────────────────────────────────────────────────────
   Helper: expose _parseAmt globally (used by schedule.engine.js)
────────────────────────────────────────────────────────────── */
function _parseAmt(v) {
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(String(v).replace(/,/g, '').trim()) || 0);
}
