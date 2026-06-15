// ══ REPORTS — Phase 3B: 8 core reports on ONE Report Document factory ═══════
// 35 defined reports consolidated to 8 (mapping owner-approved 2026-06-12).
// Reports #2–#8 are CONFIGS rendered by NXReport (js/foundation/report-page.js).
// #1 Recovery Position stays BESPOKE below (the reference standard) — its block
// (from "RECOVERY POSITION (GRAND SUMMARY)") is preserved byte-for-byte.
// Configuration-over-customization: period/project/status/floor are FILTERS.
// ════════════════════════════════════════════════════════════════════════════

let _rt = 'recovery_position', _rs = 'all', _rptGenId = 0;

function _rNum(v) { return (typeof fM === 'function') ? fM(Number(v || 0)) : Number(v || 0).toLocaleString('en-US'); }
function _rClientName(id) { const c = (window._clientsCache || []).find(x => x.id === id); return c ? (c.fullName || c.client_name || '') : ''; }
function _rUnitNo(unitId) { const u = (window._unitsCache || []).find(x => x.id === unitId); return u ? ((u.unitNo || u.unit_no || '') + (u.floorLabel ? ' · ' + u.floorLabel : '')) : ''; }
function _rMode(m) { m = String(m || '').toLowerCase(); if (m.includes('cash')) return 'Cash'; if (m.includes('cheque') || m.includes('pdc') || m.includes('cdc')) return 'Cheque'; if (m.includes('online') || m.includes('ibft') || m.includes('transfer')) return 'Online'; if (m.includes('bank') || m.includes('deposit')) return 'Bank'; return m ? (m[0].toUpperCase() + m.slice(1)) : 'Other'; }
function _rAgingBucket(d) { d = Number(d || 0); if (d <= 0) return 'Current'; if (d <= 30) return '0–30'; if (d <= 60) return '31–60'; if (d <= 90) return '61–90'; if (d <= 180) return '91–180'; return '180+'; }

// ── The 8 reports: meta (hub) + config (NXReport). recovery_position = meta only. ──
const REPORTS = {
  recovery_position: { meta: { title: 'Recovery Position', group: 'RECOVERY', desc: 'Period rollforward — opening, due, recovered & closing per active sale' } },

  aging: { meta: { title: 'Aging Report', group: 'RECOVERY', desc: 'Outstanding by overdue bucket (0–30 … 180+), per client/sale' },
    config: {
      id: 'aging', title: 'Aging Report', group: 'RECOVERY', orientation: 'portrait',
      description: 'Outstanding by overdue bucket — sourced from Recovery Position (one-aging-law)',
      filters: [{ kind: 'project' }, { kind: 'daterange' }],
      fetch: f => supabase.rpc('get_recovery_position', { p_company_id: S.cid, p_project_id: f.project || null, p_from_date: f.from || null, p_to_date: f.to || td() }).then(r => { if (r.error) throw r.error; return r.data; }),
      transform: (data, f) => {
        const rows = (data.rows || []).filter(r => Number(r.closing) > 0).map(r => ({
          client: (r.client_code ? r.client_code + ' · ' : '') + (r.client_name || ''),
          unit: (r.unit_no || '') + (r.floor_name ? ' · ' + r.floor_name : ''),
          bucket: _rAgingBucket(r.overdue_days), overdue_days: Number(r.overdue_days || 0), closing: Number(r.closing || 0),
          _click: "nav('salesdetail','" + r.sale_id + "')"
        })).sort((a, b) => b.overdue_days - a.overdue_days);
        const columns = [{ key: 'client', label: 'Client' }, { key: 'unit', label: 'Unit' }, { key: 'bucket', label: 'Bucket' }, { key: 'overdue_days', label: 'Days', num: true }, { key: 'closing', label: 'Outstanding', num: true, fmt: 'money' }];
        const total = rows.reduce((s, r) => s + r.closing, 0);
        const order = ['Current', '0–30', '31–60', '61–90', '91–180', '180+'];
        const byB = {}; rows.forEach(r => { byB[r.bucket] = (byB[r.bucket] || 0) + r.closing; });
        const summary = order.filter(b => byB[b]).map(b => ({ label: b + ' days', value: byB[b], money: true }));
        return { columns, rows, totals: { closing: total }, totalsLabel: 'GRAND TOTAL', summary };
      }
    } },

  client_ledger: { meta: { title: 'Client Ledger', group: 'CLIENT & UNIT', desc: 'Per-client statement — dues, payments, running balance' },
    config: {
      id: 'client_ledger', title: 'Client Ledger', group: 'CLIENT & UNIT', orientation: 'portrait',
      description: 'Per-client running account — opening, schedule + payments, closing',
      filters: [{ kind: 'clientPicker' }, { kind: 'daterange', allTime: true }],
      fetch: f => supabase.rpc('get_client_ledger', { p_client_id: f.clientId, p_company_id: S.cid, p_from_date: f.from || null, p_to_date: f.to || null }).then(r => { if (r.error) throw r.error; return r.data; }),
      transform: (data, f) => _ledgerTransform(data, f)
    } },

  unit_statement: { meta: { title: 'Unit Statement', group: 'CLIENT & UNIT', desc: 'Per-unit booking, plan vs payments, current position' },
    config: {
      id: 'unit_statement', title: 'Unit Statement', group: 'CLIENT & UNIT', orientation: 'portrait',
      description: 'Per-unit account — booking, installment plan vs payments, current position',
      filters: [{ kind: 'unitPicker' }, { kind: 'daterange', allTime: true }],
      fetch: f => supabase.rpc('get_unit_ledger', { p_unit_id: f.unitId, p_company_id: S.cid, p_from_date: f.from || null, p_to_date: f.to || null }).then(r => { if (r.error) throw r.error; return r.data; }),
      transform: (data, f) => _ledgerTransform(data, f)
    } },

  collections: { meta: { title: 'Collections Report', group: 'OPERATIONS', desc: 'Period receipts — daily, mode-wise (Cash/Bank Book), officer-wise' },
    config: {
      id: 'collections', title: 'Collections Report', group: 'OPERATIONS', orientation: 'portrait',
      description: 'Period receipts with daily subtotals, mode-wise and officer-wise summaries',
      filters: [{ kind: 'daterange' }],
      fetch: async f => {
        const r = await supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: { date_from: f.from || null, date_to: f.to || null, limit: 5000 } });
        if (r.error) throw r.error;
        const pays = r.data || [];
        const sids = [...new Set(pays.map(p => p.sale_id).filter(Boolean))];
        let unitMap = {};
        if (sids.length) { const sm = await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: sids }); (sm.data || []).forEach(s => { unitMap[s.id] = s.unit_id; }); }
        return { pays, unitMap };
      },
      transform: (data, f) => {
        const pays = (data.pays || []).slice().sort((a, b) => String(a.payment_date || '').localeCompare(String(b.payment_date || '')));
        const columns = [{ key: 'date', label: 'Date', fmt: 'date' }, { key: 'receipt', label: 'Receipt #' }, { key: 'client', label: 'Client' }, { key: 'unit', label: 'Unit' }, { key: 'mode', label: 'Mode' }, { key: 'amount', label: 'Amount', num: true, fmt: 'money' }];
        const mk = p => ({ date: p.payment_date, receipt: p.voucher_code || p.payment_code || '—', client: _rClientName(p.client_id) || '—', unit: _rUnitNo(data.unitMap[p.sale_id]) || '—', mode: _rMode(p.payment_method), amount: Number(p.amount || 0) });
        // daily groups with subtotals
        const byDay = {}; pays.forEach(p => { (byDay[p.payment_date] = byDay[p.payment_date] || []).push(p); });
        const groups = Object.keys(byDay).sort().map(d => { const rs = byDay[d].map(mk); const sub = rs.reduce((s, r) => s + r.amount, 0); return { label: fD(d), rows: rs, subtotal: { amount: sub } }; });
        const total = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
        // mode-wise (Cash Book / Bank Book) + officer-wise appendix blocks
        const byMode = {}; pays.forEach(p => { const m = _rMode(p.payment_method); const x = byMode[m] = byMode[m] || { count: 0, amount: 0 }; x.count++; x.amount += Number(p.amount || 0); });
        const modeRows = Object.keys(byMode).sort().map(m => ({ mode: m, count: byMode[m].count, amount: byMode[m].amount }));
        const byOff = {}; let attributed = 0; pays.forEach(p => { const o = p.created_by; if (o) attributed++; const key = o || '(unattributed)'; const x = byOff[key] = byOff[key] || { count: 0, amount: 0 }; x.count++; x.amount += Number(p.amount || 0); });
        const offRows = Object.keys(byOff).map(o => ({ officer: (typeof gunm === 'function' && o !== '(unattributed)') ? (gunm(o) || o) : o, count: byOff[o].count, amount: byOff[o].amount }));
        const appendix = [
          { title: 'Mode-wise summary (Cash Book / Bank Book)', columns: [{ key: 'mode', label: 'Mode' }, { key: 'count', label: 'Count', num: true }, { key: 'amount', label: 'Amount', num: true, fmt: 'money' }], rows: modeRows, totals: { count: pays.length, amount: total }, totalsLabel: 'TOTAL' },
          { title: 'Officer-wise summary', columns: [{ key: 'officer', label: 'Officer' }, { key: 'count', label: 'Count', num: true }, { key: 'amount', label: 'Amount', num: true, fmt: 'money' }], rows: offRows, totals: { count: pays.length, amount: total }, totalsLabel: 'TOTAL', note: attributed < pays.length ? ('Attribution gap: ' + (pays.length - attributed) + ' of ' + pays.length + ' receipts have no created_by (shown as unattributed).') : '' }
        ];
        const summary = [{ label: 'Receipts', value: pays.length }, { label: 'Total Collected', value: total, money: true }];
        return { columns, groups, totals: { amount: total }, totalsLabel: 'GRAND TOTAL', summary, appendix };
      }
    } },

  pdc: { meta: { title: 'PDC Report', group: 'OPERATIONS', desc: 'Cheques in hand — due, status, bank, amounts; status summary' },
    config: {
      id: 'pdc', title: 'PDC Report', group: 'OPERATIONS', orientation: 'portrait',
      description: 'Post-dated cheques — due in period, status, bank, amounts',
      filters: [{ kind: 'project' }, { kind: 'daterange' }, { kind: 'status', label: 'Status', default: 'All', options: [{ v: 'All', l: 'All' }, { v: 'pending', l: 'Pending' }, { v: 'cleared', l: 'Cleared' }, { v: 'bounced', l: 'Bounced' }, { v: 'deposited', l: 'Deposited' }] }],
      fetch: f => supabase.rpc('get_pdc_register', { p_company_id: S.cid, p_status: f.status || 'All', p_project_id: f.project || null, p_date_from: f.from || null, p_date_to: f.to || null }).then(r => { if (r.error) throw r.error; return r.data; }),
      transform: (data, f) => {
        const rows = ((data && data.rows) || []).map(c => ({
          cheque_date: c.cheque_date, cheque_no: c.cheque_no || c.reference_no || '—', bank: c.bank_name || c.bank || '—',
          client: c.client_name || _rClientName(c.client_id) || '—', status: (c.status || 'pending'), amount: Number(c.amount || 0)
        })).sort((a, b) => String(a.cheque_date || '').localeCompare(String(b.cheque_date || '')));
        const columns = [{ key: 'cheque_date', label: 'Cheque Date', fmt: 'date' }, { key: 'cheque_no', label: 'Cheque #' }, { key: 'bank', label: 'Bank' }, { key: 'client', label: 'Client' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', num: true, fmt: 'money' }];
        const total = rows.reduce((s, r) => s + r.amount, 0);
        const byS = {}; rows.forEach(r => { const x = byS[r.status] = byS[r.status] || { count: 0, amount: 0 }; x.count++; x.amount += r.amount; });
        const appendix = [{ title: 'Status summary', columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count', num: true }, { key: 'amount', label: 'Amount', num: true, fmt: 'money' }], rows: Object.keys(byS).map(s => ({ status: s, count: byS[s].count, amount: byS[s].amount })), totals: { count: rows.length, amount: total }, totalsLabel: 'TOTAL' }];
        const summary = [{ label: 'Cheques', value: rows.length }, { label: 'Total Value', value: total, money: true }];
        return { columns, rows, totals: { amount: total }, totalsLabel: 'TOTAL', summary, appendix };
      }
    } },

  sales_summary: { meta: { title: 'Sales Summary', group: 'OPERATIONS', desc: 'Bookings + cumulative — value, discount, net; floor/type; cancelled trail' },
    config: {
      id: 'sales_summary', title: 'Sales Summary', group: 'OPERATIONS', orientation: 'landscape',
      description: 'Bookings in period + cumulative position; floor/type breakdown; cancellations',
      filters: [{ kind: 'project' }, { kind: 'daterange', allTime: true }, { kind: 'status', label: 'View', default: 'all', options: [{ v: 'all', l: 'All Sales' }, { v: 'active', l: 'Active' }, { v: 'cancelled', l: 'Cancelled (cancel/resale trail)' }] }],
      fetch: f => {
        const flt = { limit: 5000 };
        if (f.project) flt.project_id = f.project;
        if (f.status === 'cancelled') { flt.status = 'cancelled'; flt.cancel_from = f.from || null; flt.cancel_to = f.to || null; }
        else { flt.date_from = f.from || null; flt.date_to = f.to || null; if (f.status === 'active') flt.status = 'active'; }
        return supabase.rpc('list_sales_for_report', { p_company_id: S.cid, p_filters: flt }).then(r => { if (r.error) throw r.error; return r.data; });
      },
      transform: (data, f) => {
        const cancelled = f.status === 'cancelled';
        const raw = (data || []).slice();
        if (cancelled) {
          const rows = raw.map(s => ({
            sale_number: s.sale_number || s.sale_no || '—', booking_date: s.sale_date || s.created_at, client: s.client_name || _rClientName(s.client_id) || '—',
            unit: s.unit_no || _rUnitNo(s.unit_id) || '—', value: Number(s.total_amount || 0), received: Number(s.received_amount || s.paid_to_date || 0),
            cancel_date: s.cancellation_date || s.cancelled_at || '', context: s.cancellation_reason || s.resale_of || s.notes || '—'
          })).sort((a, b) => String(b.cancel_date || '').localeCompare(String(a.cancel_date || '')));
          const columns = [{ key: 'sale_number', label: 'Booking #' }, { key: 'booking_date', label: 'Booked', fmt: 'date' }, { key: 'client', label: 'Client' }, { key: 'unit', label: 'Unit' }, { key: 'value', label: 'Sale Value', num: true, fmt: 'money' }, { key: 'received', label: 'Received', num: true, fmt: 'money' }, { key: 'cancel_date', label: 'Cancelled', fmt: 'date' }, { key: 'context', label: 'Cancel / Resale Context' }];
          const value = rows.reduce((s, r) => s + r.value, 0), recv = rows.reduce((s, r) => s + r.received, 0);
          return { columns, rows, totals: { value, received: recv }, totalsLabel: 'CANCELLED TOTAL', summary: [{ label: 'Cancelled Bookings', value: rows.length }, { label: 'Cancelled Value', value, money: true }, { label: 'Amount Received', value: recv, money: true }] };
        }
        const rows = raw.map(s => ({
          sale_number: s.sale_number || s.sale_no || '—', sale_date: s.sale_date || s.created_at, client: s.client_name || _rClientName(s.client_id) || '—',
          unit: s.unit_no || _rUnitNo(s.unit_id) || '—', floor: s.floor_name || '', type: s.sale_type || s.unit_type || '',
          value: Number(s.total_amount || 0), discount: Number(s.discount || 0), net: Number(s.net_amount || 0)
        })).sort((a, b) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')));
        const columns = [{ key: 'sale_number', label: 'Sale #' }, { key: 'sale_date', label: 'Date', fmt: 'date' }, { key: 'client', label: 'Client' }, { key: 'unit', label: 'Unit' }, { key: 'type', label: 'Type' }, { key: 'value', label: 'Value', num: true, fmt: 'money' }, { key: 'discount', label: 'Discount', num: true, fmt: 'money' }, { key: 'net', label: 'Net', num: true, fmt: 'money' }];
        const value = rows.reduce((s, r) => s + r.value, 0), disc = rows.reduce((s, r) => s + r.discount, 0), net = rows.reduce((s, r) => s + r.net, 0);
        const byFloor = {}; rows.forEach(r => { const x = byFloor[r.floor || '—'] = byFloor[r.floor || '—'] || { count: 0, net: 0 }; x.count++; x.net += r.net; });
        const appendix = [{ title: 'Floor / Type breakdown', columns: [{ key: 'floor', label: 'Floor' }, { key: 'count', label: 'Units', num: true }, { key: 'net', label: 'Net Value', num: true, fmt: 'money' }], rows: Object.keys(byFloor).sort().map(fl => ({ floor: fl, count: byFloor[fl].count, net: byFloor[fl].net })), totals: { count: rows.length, net }, totalsLabel: 'TOTAL' }];
        return { columns, rows, totals: { value, discount: disc, net }, totalsLabel: 'TOTAL', summary: [{ label: 'Bookings', value: rows.length }, { label: 'Sales Value', value, money: true }, { label: 'Discount', value: disc, money: true }, { label: 'Net', value: net, money: true }], appendix };
      }
    } },

  availability: { meta: { title: 'Availability / Inventory', group: 'OPERATIONS', desc: 'Unit grid by floor — sold / available / blocked, areas, list values' },
    config: {
      id: 'availability', title: 'Availability / Inventory', group: 'OPERATIONS', orientation: 'portrait',
      description: 'Unit inventory by floor — sold / available / blocked with areas and list values',
      filters: [{ kind: 'project' }],
      fetch: f => Promise.resolve((window._unitsCache || []).filter(u => !f.project || u.projectId === f.project || u.project_id === f.project)),
      transform: (data, f) => {
        const units = data || [];
        const stat = u => { if (u.isAvailable === true || u.is_available === true) return 'Available'; const s = String(u.status || u.status_name || '').toLowerCase(); if (s.includes('block') || s.includes('hold')) return 'Blocked'; return 'Sold'; };
        const rows = units.map(u => ({ floor: u.floorLabel || u.floor_name || '—', unit: u.unitNo || u.unit_no || '—', type: u.type || u.unit_type || '', area: Number(u.area || u.area_sqft || 0), status: stat(u), value: Number(u.price || u.list_price || u.total_price || 0) }))
          .sort((a, b) => String(a.floor).localeCompare(String(b.floor)) || String(a.unit).localeCompare(String(b.unit)));
        const columns = [{ key: 'floor', label: 'Floor' }, { key: 'unit', label: 'Unit' }, { key: 'type', label: 'Type' }, { key: 'area', label: 'Area', num: true }, { key: 'status', label: 'Status' }, { key: 'value', label: 'List Value', num: true, fmt: 'money' }];
        const sold = rows.filter(r => r.status === 'Sold').length, avail = rows.filter(r => r.status === 'Available').length, blocked = rows.filter(r => r.status === 'Blocked').length;
        const value = rows.reduce((s, r) => s + r.value, 0);
        return { columns, rows, totals: { value }, totalsLabel: 'TOTAL', summary: [{ label: 'Total Units', value: rows.length }, { label: 'Sold', value: sold }, { label: 'Available', value: avail }, { label: 'Blocked', value: blocked }] };
      }
    } }
};

// Shared transform for the two ledgers (get_client_ledger / get_unit_ledger).
function _ledgerTransform(data, f) {
  const opening = Number((data && data.opening_balance) || 0);
  const raw = ((data && data.rows) || []).slice().sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')) || (Number(a.row_order || 0) - Number(b.row_order || 0)));
  let bal = opening;
  const mapped = raw.map(r => { const dr = Number(r.debit || 0), cr = Number(r.credit || 0); bal += dr - cr; return { date: r.entry_date, particulars: r.description || '', voucher: r.voucher_no || r.chq_no || '', debit: dr || '', credit: cr || '', balance: bal }; });
  const all = [{ date: f.from || '', particulars: 'Opening Balance', voucher: '', debit: '', credit: '', balance: opening }, ...mapped];
  const columns = [{ key: 'date', label: 'Date', fmt: 'date' }, { key: 'particulars', label: 'Particulars' }, { key: 'voucher', label: 'Voucher' }, { key: 'debit', label: 'Debit', num: true, fmt: 'money' }, { key: 'credit', label: 'Credit', num: true, fmt: 'money' }, { key: 'balance', label: 'Balance', num: true, fmt: 'money' }];
  const totDr = mapped.reduce((s, r) => s + Number(r.debit || 0), 0), totCr = mapped.reduce((s, r) => s + Number(r.credit || 0), 0);
  const closing = Number((data && data.closing_balance != null) ? data.closing_balance : bal);
  return { columns, rows: all, totals: { debit: totDr, credit: totCr, balance: closing }, totalsLabel: 'CLOSING', summary: [{ label: 'Opening', value: opening, money: true }, { label: 'Total Due (Dr)', value: totDr, money: true }, { label: 'Received (Cr)', value: totCr, money: true }, { label: 'Closing Balance', value: closing, money: true }] };
}

// ── HUB — 3 groups, nx- kit, no "35 reports" banner ─────────────────────────
function rReports() {
  const pg = document.getElementById('pg-reports'); if (!pg) return;
  document.querySelector('.pw')?.classList.remove('rpt-mode');
  const groups = [
    { title: 'RECOVERY', keys: ['recovery_position', 'aging'] },
    { title: 'CLIENT & UNIT', keys: ['client_ledger', 'unit_statement'] },
    { title: 'OPERATIONS', keys: ['collections', 'pdc', 'sales_summary', 'availability'] }
  ];
  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-6)">
    ${NX.pageHeader('Reports', '')}
    ${groups.map(g => `<div>
      <div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">${g.title}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--fk-sp-3)">
        ${g.keys.map(k => { const m = REPORTS[k].meta; return `<div class="nx-card" style="cursor:pointer" onclick="openRptViewer('${k}')">
          <div class="nx-modal-title" style="margin-bottom:6px">${esc(m.title)}</div>
          <div class="nx-kpi-label" style="text-transform:none">${esc(m.desc)}</div></div>`; }).join('')}
      </div></div>`).join('')}
  </div>`;
}

// ── Routing: RP → bespoke shell; others → NXReport factory ───────────────────
function openRptViewer(key) {
  if (key === 'recovery_position') return _rpOpen();
  const r = REPORTS[key];
  if (r && r.config) { document.querySelector('.pw')?.classList.remove('rpt-mode'); return NXReport.render(r.config); }
}
function setRT(t) { openRptViewer(t); }
function closeRptViewer() { document.querySelector('.pw')?.classList.remove('rpt-mode'); rReports(); }

// Recovery Position bespoke shell (unchanged experience: rpt-viewer chrome + the
// preserved _rp* engine below). Buttons + controls dispatch to the RP block.
function _rpOpen() {
  _rt = 'recovery_position'; _rptGenId++;
  const pg = document.getElementById('pg-reports'); if (!pg) return;
  document.querySelector('.pw')?.classList.add('rpt-mode');
  pg.innerHTML = `<div class="rpt-viewer">
    <div class="rpt-vh">
      <button class="rpt-vback" onclick="closeRptViewer()">‹ All Reports</button>
      <div class="rpt-vh-div"></div>
      <div class="rpt-vh-ic"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
      <div class="rpt-vh-info"><div class="rpt-vh-name">Recovery Position (Grand Summary)</div><div class="rpt-vh-sec" style="color:#DC2626">Recovery</div></div>
      <div class="rpt-vh-acts">
        <button class="btn btn-gr btn-sm" onclick="expRptExcel()">Excel</button>
        <button class="btn btn-d btn-sm" onclick="printRpt()">Print</button>
      </div>
    </div>
    ${_rpControlsBar()}
    <div class="rpt-vbody crystal-rpt" id="r-ct"><div style="text-align:center;padding:40px;color:var(--t3);font-size:13px">Loading…</div></div>
  </div>`;
  runRpt();
}
function runRpt() { return _rpRun(); }            // RP only now
function expRptExcel() { return _rpExcel(); }
function printRpt() { return _rpPrint(); }

