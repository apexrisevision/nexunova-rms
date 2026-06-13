// ══ RECEIVING LEDGER ═════════════════════════════════════════

function rReceivingLedger() {
  _ldgInjectPrintCss();
  const pg = document.getElementById('pg-receivingledger');
  if (!pg) return;

  const _ap = (typeof activeProjectId === 'function' ? activeProjectId() : '') || '';   // global project lens
  const projects = (window._projectsCache || []).filter(p => typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id));
  const projOpts = projects.map(p =>
    `<option value="${p.id}"${_ap === p.id ? ' selected' : ''}>${esc(p.projectName || p.name || '')}</option>`
  ).join('');

  const { from, to } = _ldgFiscalYear();

  pg.innerHTML = `<div class="ani">
    ${_ldgNavBar('Receiving Ledger')}
    <div class="no-print card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:4px 0">
        <div>
          <label class="lb">From Date</label>
          <input id="rl-from" class="inp" type="date" value="${from}" min="2000-01-01" max="2099-12-31" style="width:148px">
        </div>
        <div>
          <label class="lb">To Date</label>
          <input id="rl-to" class="inp" type="date" value="${to}" min="2000-01-01" max="2099-12-31" style="width:148px">
        </div>
        <div>
          <label class="lb">Project</label>
          <select id="rl-project" class="inp" style="width:170px">
            <option value="">All Projects</option>${projOpts}
          </select>
        </div>
        <div>
          <label class="lb">Payment Mode</label>
          <select id="rl-method" class="inp" style="width:150px">
            <option value="All">All Modes</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="pdc">PDC</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
        <button onclick="_recvRun()"
          style="height:36px;padding:0 20px;background:#2563eb;color:#fff;border:none;
                 border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                 font-family:'Inter',sans-serif;white-space:nowrap;align-self:flex-end">
          ▶ Run Report
        </button>
      </div>
    </div>
    <div id="rl-report">${_ldgEmpty()}</div>
  </div>`;
}

async function _recvRun() {
  const from    = document.getElementById('rl-from')?.value    || '';
  const to      = document.getElementById('rl-to')?.value      || '';
  const project = document.getElementById('rl-project')?.value || '';
  const method  = document.getElementById('rl-method')?.value  || 'All';
  const report  = document.getElementById('rl-report');
  if (!report) return;
  if (!_ldgValidateDates(from, to, report)) return;

  report.innerHTML = _ldgLoading();

  try {
    const { data: d, error } = await supabase.rpc('get_receiving_ledger', {
      p_company_id: S.cid,
      p_project_id: project || null,
      p_date_from:  from    || null,
      p_date_to:    to      || null,
      p_method:     method  || 'All',
    });
    if (error) throw error;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC returned no data');
    report.innerHTML = _recvRender(d, from, to);
  } catch (e) {
    console.error('[ReceivingLedger]', e);
    report.innerHTML = _ldgErr(e.message || String(e));
  }
}

function _recvRender(d, fromDate, toDate) {
  const rows = d.rows || [];
  const ob   = +(d.opening_balance) || 0;

  // KPI summary (screen only)
  const byM  = (m) => rows.filter(r => (r.method||'').toLowerCase() === m).reduce((s,r) => s + (+r.amount||0), 0);
  const cash  = byM('cash');
  const bank  = byM('bank') + byM('bank transfer');
  const pdc   = byM('pdc') + byM('cheque');
  const adj   = byM('adjustment');
  const total = rows.reduce((s,r) => s + (+r.amount||0), 0);

  const _kv = (n) => `<span class="dkpi-val" style="font-size:18px!important;word-break:break-word;line-height:1.2">${fM(n)}</span>`;
  const kpi = `
  <div class="no-print dash-kpi-row" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin-bottom:12px">
    <div class="dash-kpi blue"><div class="dkpi-top"><span class="dkpi-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>${_kv(total)}</div><div class="dkpi-lbl">Period Total</div></div>
    <div class="dash-kpi green"><div class="dkpi-top"><span class="dkpi-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></span>${_kv(cash)}</div><div class="dkpi-lbl">Cash</div></div>
    <div class="dash-kpi blue"><div class="dkpi-top"><span class="dkpi-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11"/><path d="M12 2L2 7h20L12 2z"/><line x1="7" y1="11" x2="7" y2="22"/><line x1="12" y1="11" x2="12" y2="22"/><line x1="17" y1="11" x2="17" y2="22"/></svg></span>${_kv(bank)}</div><div class="dkpi-lbl">Bank</div></div>
    <div class="dash-kpi amber"><div class="dkpi-top"><span class="dkpi-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11"/><path d="M12 2L2 7h20L12 2z"/><line x1="7" y1="11" x2="7" y2="22"/><line x1="12" y1="11" x2="12" y2="22"/><line x1="17" y1="11" x2="17" y2="22"/></svg></span>${_kv(pdc)}</div><div class="dkpi-lbl">PDC / Cheque</div></div>
    <div class="dash-kpi red"><div class="dkpi-top"><span class="dkpi-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span>${_kv(adj)}</div><div class="dkpi-lbl">Adjustment</div></div>
  </div>`;

  // Normalize rows for Crystal table (all Credit)
  const normRows = rows.map(r => {
    const method  = r.method || '';
    const isPdc   = ['pdc','cheque'].includes(method.toLowerCase());
    const parts   = [r.client_name, r.unit_no, r.project_name].filter(Boolean);
    const recvStr = r.received_by ? ' — Rcvd by ' + r.received_by : '';
    const desc    = 'Receipt' + recvStr + (parts.length ? ' — ' + parts.join(' · ') : '') +
                    (method ? ' [' + method.charAt(0).toUpperCase() + method.slice(1) + ']' : '');
    return {
      voucher_no:  r.voucher_code || '',
      entry_date:  r.payment_date || '',
      description: desc,
      chq_no:      isPdc ? (r.reference_no || '') : '',
      debit:  0,
      credit: +(r.amount || 0),
    };
  });

  const hdr   = _ldgCrystalHdr({ entityName: 'All Receipts Register', entityCode: 'ALL', project: '—', fromDate, toDate });
  const table = _ldgCrystalTable(normRows, ob, fromDate, {
    debitLabel:  'Debit',
    creditLabel: 'Amount Received',
  });

  return `
  ${kpi}
  ${_ldgPrintBtn()}
  <div class="ldg-rpt-wrap" style="background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.07)">
    ${hdr}
    ${table}
    <div class="ldg-page-footer" style="padding:6px 12px">Page 1 of 1</div>
  </div>
  <div class="no-print" style="margin-top:8px;text-align:right;font-size:11px;color:var(--t3);font-family:'Inter',sans-serif">
    ${rows.length} receipt(s) in period
  </div>`;
}
