// ══ RECOVERY OFFICER LEDGER ══════════════════════════════════

let _officerOfficers = [];

function rOfficerLedger() {
  _ldgInjectPrintCss();
  const pg = document.getElementById('pg-officerledger');
  if (!pg) return;

  const projects = window._projectsCache || [];
  const projOpts = projects.map(p =>
    `<option value="${p.id}">${esc(p.projectName || p.name || '')}</option>`
  ).join('');

  const { from, to } = _ldgFiscalYear();

  pg.innerHTML = `<div class="ani">
    ${_ldgNavBar('Recovery Officer Ledger')}
    <div class="no-print card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:4px 0">
        <div>
          <label class="lb">Officer</label>
          <select id="ol-officer" class="inp" style="width:180px">
            <option value="">All Officers</option>
          </select>
        </div>
        <div>
          <label class="lb">From Date</label>
          <input id="ol-from" class="inp" type="date" value="${from}" min="2000-01-01" max="2099-12-31" style="width:148px">
        </div>
        <div>
          <label class="lb">To Date</label>
          <input id="ol-to" class="inp" type="date" value="${to}" min="2000-01-01" max="2099-12-31" style="width:148px">
        </div>
        <div>
          <label class="lb">Project</label>
          <select id="ol-project" class="inp" style="width:170px">
            <option value="">All Projects</option>${projOpts}
          </select>
        </div>
        <div>
          <label class="lb">Payment Mode</label>
          <select id="ol-method" class="inp" style="width:150px">
            <option value="All">All Modes</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="pdc">PDC</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
        <button onclick="_officerRun()"
          style="height:36px;padding:0 20px;background:#2563eb;color:#fff;border:none;
                 border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
                 font-family:'Inter',sans-serif;white-space:nowrap;align-self:flex-end">
          ▶ Run Report
        </button>
      </div>
    </div>
    <div id="ol-report">${_ldgEmpty()}</div>
  </div>`;

  _officerLoadOfficers();
}

async function _officerLoadOfficers() {
  if (_officerOfficers.length) { _officerBuildDropdown(); return; }
  try {
    const { data } = await supabase.from('app_users')
      .select('id, full_name, role')
      .eq('company_id', S.cid)
      .eq('status', 'active')
      .order('full_name');
    _officerOfficers = data || [];
    _officerBuildDropdown();
  } catch (_) {}
}

function _officerBuildDropdown() {
  const sel = document.getElementById('ol-officer');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Officers</option>'
    + _officerOfficers.map(o =>
        `<option value="${esc(o.id)}">${esc(o.full_name)}${o.role ? ' (' + esc(o.role) + ')' : ''}</option>`
      ).join('');
}

async function _officerRun() {
  const officer = document.getElementById('ol-officer')?.value  || '';
  const from    = document.getElementById('ol-from')?.value     || '';
  const to      = document.getElementById('ol-to')?.value       || '';
  const project = document.getElementById('ol-project')?.value  || '';
  const method  = document.getElementById('ol-method')?.value   || 'All';
  const report  = document.getElementById('ol-report');
  if (!report) return;
  if (!_ldgValidateDates(from, to, report)) return;

  report.innerHTML = _ldgLoading();

  try {
    const { data: d, error } = await supabase.rpc('get_officer_ledger', {
      p_company_id: S.cid,
      p_officer_id: officer || null,
      p_project_id: project || null,
      p_date_from:  from    || null,
      p_date_to:    to      || null,
      p_method:     method  || 'All',
    });
    if (error) throw error;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC returned no data');
    report.innerHTML = _officerRender(d, officer, from, to);
  } catch (e) {
    console.error('[OfficerLedger]', e);
    report.innerHTML = _ldgErr(e.message || String(e));
  }
}

function _officerRender(d, officerId, fromDate, toDate) {
  const rows = d.rows || [];
  const ob   = +(d.opening_balance) || 0;

  // Resolve officer name for header
  const officerObj  = _officerOfficers.find(o => o.id === officerId);
  const entityName  = officerObj ? officerObj.full_name : 'All Officers';
  const entityCode  = officerId || 'ALL';

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
    <div class="dash-kpi blue"><div class="dkpi-top"><span class="dkpi-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>${_kv(total)}</div><div class="dkpi-lbl">Total Recovered</div></div>
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
    const officerStr = r.officer_name ? ' — ' + r.officer_name : '';
    const desc    = 'Collection' + officerStr + (parts.length ? ' — ' + parts.join(' · ') : '') +
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

  const hdr   = _ldgCrystalHdr({ entityName, entityCode, project: '—', fromDate, toDate });
  const table = _ldgCrystalTable(normRows, ob, fromDate, {
    debitLabel:  'Debit',
    creditLabel: 'Amount Collected',
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
    ${rows.length} record(s) in period
  </div>`;
}
