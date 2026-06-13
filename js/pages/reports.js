// ══ REPORTS — Phase 3B: 8 core reports on ONE Report Document factory ═══════
// 35 defined reports consolidated to 8 (mapping owner-approved 2026-06-12).
// Reports #2–#8 are CONFIGS rendered by NXReport (js/foundation/report-page.js).
// #1 Recovery Position stays BESPOKE below (the reference standard) — its block
// (from "RECOVERY POSITION (GRAND SUMMARY)") is preserved byte-for-byte.
// Configuration-over-customization: period/project/status/floor are FILTERS.
// ════════════════════════════════════════════════════════════════════════════

// NOTE: _rt and _rs are GLOBALS declared in js/data.js (loaded earlier) — reuse them,
// do not re-declare (top-level `let` would collide across scripts). _rptGenId is ours.
var _rptGenId = 0;

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
      filters: [{ kind: 'clientPicker' }, { kind: 'daterange', openStart: true }],
      fetch: f => supabase.rpc('get_client_ledger', { p_client_id: f.clientId, p_company_id: S.cid, p_from_date: f.from || null, p_to_date: f.to || null }).then(r => { if (r.error) throw r.error; return r.data; }),
      transform: (data, f) => _ledgerTransform(data, f)
    } },

  unit_statement: { meta: { title: 'Unit Statement', group: 'CLIENT & UNIT', desc: 'Per-unit booking, full plan vs payments, current position' },
    config: {
      id: 'unit_statement', title: 'Unit Statement', group: 'CLIENT & UNIT', orientation: 'portrait',
      description: 'Per-unit document — FULL installment plan (incl. future), Paid/Partial/Due/Future, recoverable + contract balance',
      filters: [{ kind: 'unitPicker' }],   // full plan: no date bound (future installments shown)
      // Two get_unit_ledger calls: full (entire plan + contract-remaining) and
      // as-of-today (recoverable closing == the Recovery Position row).
      fetch: async f => {
        const [full, asof] = await Promise.all([
          supabase.rpc('get_unit_ledger', { p_unit_id: f.unitId, p_company_id: S.cid, p_from_date: null, p_to_date: null }),
          supabase.rpc('get_unit_ledger', { p_unit_id: f.unitId, p_company_id: S.cid, p_from_date: null, p_to_date: td() })
        ]);
        if (full.error) throw full.error;
        return { full: full.data, recoverable: Number((asof.data && asof.data.closing_balance) || 0) };
      },
      transform: (data, f) => _unitStatementTransform(data, f)
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
      filters: [{ kind: 'project' }, { kind: 'daterange' }, { kind: 'status', label: 'View', default: 'active', options: [{ v: 'active', l: 'Active' }, { v: 'all', l: 'All (incl. cancelled)' }, { v: 'cancelled', l: 'Cancelled (cancel/resale trail)' }] }],
      // BUGFIX (Phase 3B-fix): list_sales_for_report honours sale_from/sale_to
      // (NOT date_from/date_to) — the wrong keys made every period identical.
      fetch: async f => {
        if (f.status === 'cancelled') {
          const flt = { status: 'cancelled', cancel_from: f.from || null, cancel_to: f.to || null, limit: 5000 };
          if (f.project) flt.project_id = f.project;
          const r = await supabase.rpc('list_sales_for_report', { p_company_id: S.cid, p_filters: flt });
          if (r.error) throw r.error;
          return { rows: r.data || [], cancelled: true };
        }
        const flt = { sale_from: f.from || null, sale_to: f.to || null, limit: 5000 };
        if (f.project) flt.project_id = f.project;
        if (f.status !== 'all') flt.status = 'active';                // default Active; 'all' = active + cancelled
        const cumFlt = { status: 'active', limit: 5000 };            // cumulative = ALL active, not period-filtered
        if (f.project) cumFlt.project_id = f.project;
        const [period, cumulative] = await Promise.all([
          supabase.rpc('list_sales_for_report', { p_company_id: S.cid, p_filters: flt }),
          supabase.rpc('list_sales_for_report', { p_company_id: S.cid, p_filters: cumFlt })
        ]);
        if (period.error) throw period.error;
        const cumulativeNet = (cumulative.data || []).reduce((s, r) => s + Number(r.net_amount || 0), 0);
        return { rows: period.data || [], cumulativeNet: cumulativeNet, cancelled: false };
      },
      transform: (data, f) => {
        const cancelled = !!(data && data.cancelled);
        const raw = ((data && data.rows) || []).slice();
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
        const summary = [{ label: 'Bookings (period)', value: rows.length }, { label: 'Sales Value (period)', value, money: true }, { label: 'Discount (period)', value: disc, money: true }, { label: 'Net (period)', value: net, money: true }];
        if (data && data.cumulativeNet != null) summary.push({ label: 'Cumulative position — net (all active sales)', value: data.cumulativeNet, money: true, cumulative: true });
        return { columns, rows, totals: { value, discount: disc, net }, totalsLabel: 'PERIOD TOTAL', summary, appendix };
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
    } },

  // Report #9 — Officer Performance. Per-officer recovery scorecard over a period:
  // recovered (with the OLD/CURRENT FIFO split), promise keep-rate (fair + strict),
  // calls, field visits, escalations. Feeds off the same get_team_performance RPC
  // as the Team page + dashboard panel (single source of truth).
  team_performance: { meta: { title: 'Officer Performance', group: 'OPERATIONS', desc: 'Per-officer recovery — recovered (arrears vs current), promise keep-rate, calls, visits, escalations' },
    config: {
      id: 'team_performance', title: 'Officer Performance Report', group: 'OPERATIONS', orientation: 'landscape',
      description: 'Per-officer recovery scorecard for the period — recovered (FIFO arrears/current split), promise keep-rate, calls, visits, escalations',
      filters: [{ kind: 'project' }, { kind: 'daterange' }, { kind: 'officerPicker' }],
      fetch: f => supabase.rpc('get_team_performance', { p_company_id: S.cid, p_project_id: f.project || null, p_from: f.from || null, p_to: f.to || null })
        .then(r => { if (r.error) throw r.error; return Array.isArray(r.data) ? r.data : []; }),
      transform: (data, f) => {
        let rows = (data || []).slice();
        if (f.officerId) rows = rows.filter(r => String(r.user_id) === String(f.officerId));
        const out = rows.map(r => ({
          officer: r.full_name || '—',
          calls: Number(r.calls) || 0,
          visits: Number(r.visits) || 0,
          made: Number(r.promises_made) || 0,
          keep_fair: r.keep_rate_matured,           // headline (kept ÷ matured)
          keep_strict: r.keep_rate_made,            // secondary (kept ÷ made)
          escalations: Number(r.escalations) || 0,
          recovered: Number(r.recovered) || 0,
          r_old: Number(r.recovered_old) || 0,
          r_cur: Number(r.recovered_current) || 0
        })).sort((a, b) => b.recovered - a.recovered || String(a.officer).localeCompare(String(b.officer)));
        const columns = [
          { key: 'officer', label: 'Officer' },
          { key: 'calls', label: 'Calls', num: true },
          { key: 'visits', label: 'Visits', num: true },
          { key: 'made', label: 'Promises', num: true },
          { key: 'keep_fair', label: 'Keep-rate', num: true, fmt: 'pct', blank: '—' },
          { key: 'keep_strict', label: 'Keep (strict)', num: true, fmt: 'pct', blank: '—' },
          { key: 'escalations', label: 'Escalations', num: true },
          { key: 'recovered', label: 'Recovered', num: true, fmt: 'money' },
          { key: 'r_old', label: 'from Arrears', num: true, fmt: 'money' },
          { key: 'r_cur', label: 'from Current', num: true, fmt: 'money' }
        ];
        const sum = k => out.reduce((s, x) => s + (Number(x[k]) || 0), 0);
        const totals = { calls: sum('calls'), visits: sum('visits'), made: sum('made'), escalations: sum('escalations'), recovered: sum('recovered'), r_old: sum('r_old'), r_cur: sum('r_cur') };
        const summary = [
          { label: 'Officers', value: out.length },
          { label: 'Recovered (period)', value: totals.recovered, money: true },
          { label: 'Calls', value: totals.calls },
          { label: 'Promises Made', value: totals.made }
        ];
        const appendix = [{
          title: 'Method & attribution', columns: [{ key: 'k', label: '' }, { key: 'v', label: '' }],
          rows: [
            { k: 'Recovered', v: 'Σ receipts on the officer’s assigned projects in the period (gross). Attribution by project — a shared project credits each assigned officer (created_by-precise attribution is a future upgrade).' },
            { k: 'Arrears / Current', v: 'FIFO split of what those receipts cleared — old dues (due before the period) vs current dues (due in the period).' },
            { k: 'Keep-rate', v: 'Fair = promises kept ÷ promises matured (date passed). Strict = kept ÷ all promises made in the period.' }
          ]
        }];
        return { columns, rows: out, totals, totalsLabel: 'TOTAL', summary, appendix };
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

// Unit Statement (#4) — the client-facing document: FULL installment plan incl.
// future installments (each Paid/Partial/Due/Future via FIFO payment allocation),
// ending in TWO lines: Recoverable as of today (== RP row) and Total contract
// balance remaining. data = { full: get_unit_ledger(all), recoverable: closing as-of today }.
function _unitStatementTransform(data, f) {
  const full = (data && data.full) || {};
  const opening = Number(full.opening_balance || 0);
  const allRows = (full.rows || []).slice();
  const today = (typeof td === 'function') ? td() : new Date().toISOString().slice(0, 10);
  const inst = allRows.filter(r => Number(r.debit || 0) > 0)
    .map(r => ({ due_date: r.entry_date, particulars: r.description || '', voucher: r.voucher_no || '', due: Number(r.debit || 0), paid: 0, balance: 0, status: '' }))
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  const totalPaid = allRows.reduce((s, r) => s + Number(r.credit || 0), 0);
  let pool = totalPaid;                                  // FIFO: oldest installment first
  inst.forEach(it => { const a = Math.min(pool, it.due); it.paid = a; pool -= a; it.balance = it.due - it.paid; });
  inst.forEach(it => { it.status = it.balance <= 0 ? 'Paid' : (it.paid > 0 ? 'Partial' : (String(it.due_date || '') > today ? 'Future' : 'Due')); });
  const columns = [
    { key: 'due_date', label: 'Due Date', fmt: 'date' }, { key: 'particulars', label: 'Installment' },
    { key: 'due', label: 'Amount Due', num: true, fmt: 'money' }, { key: 'paid', label: 'Paid', num: true, fmt: 'money' },
    { key: 'balance', label: 'Balance', num: true, fmt: 'money' }, { key: 'status', label: 'Status' }
  ];
  const totDue = inst.reduce((s, it) => s + it.due, 0), totPaid = inst.reduce((s, it) => s + it.paid, 0);
  const contractRemaining = Number(full.closing_balance != null ? full.closing_balance : (opening + totDue - totalPaid));
  const recoverable = Number((data && data.recoverable) || 0);
  return {
    columns, rows: inst, totals: { due: totDue, paid: totPaid, balance: contractRemaining }, totalsLabel: 'TOTAL',
    summary: [
      { label: 'Total Contract', value: opening + totDue, money: true }, { label: 'Paid to Date', value: totPaid, money: true },
      { label: 'Recoverable as of today', value: recoverable, money: true }, { label: 'Contract Balance Remaining', value: contractRemaining, money: true }
    ],
    appendix: [{
      title: 'Closing position', columns: [{ key: 'line', label: 'Position' }, { key: 'amount', label: 'Amount', num: true, fmt: 'money' }],
      rows: [
        { line: 'Recoverable as of today (due & overdue, unpaid)', amount: recoverable },
        { line: 'Total contract balance remaining (incl. future installments)', amount: contractRemaining }
      ]
    }]
  };
}

// ── HUB — 3 groups, nx- kit, no "35 reports" banner ─────────────────────────
function rReports() {
  const pg = document.getElementById('pg-reports'); if (!pg) return;
  document.querySelector('.pw')?.classList.remove('rpt-mode');
  const groups = [
    { title: 'RECOVERY', keys: ['recovery_position', 'aging'] },
    { title: 'CLIENT & UNIT', keys: ['client_ledger', 'unit_statement'] },
    { title: 'OPERATIONS', keys: ['collections', 'pdc', 'sales_summary', 'availability', 'team_performance'] }
  ];
  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-6)">
    ${NX.pageHeader('Reports', '', { icon:'bar-chart-3' })}
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

// \u2550\u2550 RECOVERY POSITION (GRAND SUMMARY) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// ════════════════════════════════════════════════════════════════════════════
// RECOVERY POSITION — period ROLLFORWARD statement (rebuilt 2026-06-11)
// Backend: get_recovery_position(company, project, from, to) → { period, rows, totals, officer_summary }
//   FIFO by sale_id + payment_date (payments.installment_id is NULL by design).
//   Per row: opening(dp/arrears), due_period, received(r_dp/r_old/r_cur/r_advance),
//   advance_bf, closing(dp/old/current), paid_pct, overdue_days, expand fields.
// UI: 5 KPI cards · 10-col table · row expand · filters · sort · Closing DESC.
// Design: Inter, CSS vars, indigo #4F46E5, Lucide icons, light/dark via tokens.
// ════════════════════════════════════════════════════════════════════════════

// First day of current month, ISO (local) — default FROM bound.
function _rpMonthStart(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';}

// Project + FROM/TO controls (drives the RPC; filters below are client-side).
function _rpControlsBar(){
  var _ap=(typeof activeProjectId==='function'?activeProjectId():'')||'';
  var projs=(typeof gprojects==='function'?gprojects():[]).slice()
    .filter(function(p){return typeof hasProjectAccess!=='function'||hasProjectAccess(p.id);})
    .sort(function(a,b){return String(a.name||a.projectName||'').localeCompare(String(b.name||b.projectName||''));});
  var opts='<option value=""'+(!_ap?' selected':'')+'>All Projects</option>'+projs.map(function(p){
    return '<option value="'+p.id+'"'+(_ap===p.id?' selected':'')+'>'+esc(p.name||p.projectName||'Project')+'</option>';}).join('');
  var c='font:500 12px/1 inherit;padding:6px 10px;border-radius:7px;border:1px solid var(--line);background:var(--canvas);color:var(--text)';
  return '<div class="rpt-fbar">'
    +'<span class="rpt-stabs-lbl">Project</span>'
    +'<select id="rp-proj" style="'+c+'" onchange="runRpt()">'+opts+'</select>'
    +'<span class="rpt-stabs-lbl" style="margin-left:12px">From</span>'
    +'<input type="date" id="rp-from" value="'+_rpMonthStart()+'" style="'+c+'" onchange="runRpt()">'
    +'<span class="rpt-stabs-lbl" style="margin-left:8px">To</span>'
    +'<input type="date" id="rp-to" value="'+td()+'" style="'+c+'" onchange="runRpt()">'
  +'</div>';
}
function _rpDaysAgo(lastISO,asofISO){
  if(!lastISO)return null;
  try{var a=new Date(asofISO+'T00:00:00'),l=new Date(lastISO+'T00:00:00');return Math.round((a-l)/86400000);}catch(e){return null;}
}
function _rpAsofLbl(asofISO){try{var d=new Date(asofISO+'T00:00:00');var p=function(n){return String(n).padStart(2,'0');};return p(d.getDate())+'-'+p(d.getMonth()+1)+'-'+d.getFullYear();}catch(e){return asofISO;}}

function _rpEmpty(t,s){
  return '<div class="rp2-empty"><svg width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="opacity:.5;margin-bottom:8px"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><div style="font-size:13px;font-weight:500;color:var(--text)">'+esc(t)+'</div>'+(s?'<div style="font-size:12px;margin-top:3px">'+esc(s)+'</div>':'')+'</div>';
}

async function _rpRun(){
  var ct=document.getElementById('r-ct');if(!ct)return;
  var gid=_rptGenId;
  var proj=(document.getElementById('rp-proj')||{}).value||'';
  var from=(document.getElementById('rp-from')||{}).value||_rpMonthStart();
  var to  =(document.getElementById('rp-to')||{}).value||td();
  ct.innerHTML='<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading recovery position…</div>';
  var res=null,err=null;
  try{ var r=await supabase.rpc('get_recovery_position',{p_company_id:S.cid,p_project_id:proj||null,p_from_date:from,p_to_date:to}); err=r.error; res=r.data; }
  catch(e){ err=e; }
  if(_rptGenId!==gid)return;
  if(err){
    if(typeof toast==='function')toast('Could not load Recovery Position: '+(err.message||err),'err');
    ct.innerHTML='<div class="rp2">'+_rpEmpty('Could not load report',(err&&err.message)||String(err))+'</div>';
    window._rpData=null; return;
  }
  res=res||{};
  var projName=proj?(((typeof gproject==='function'?gproject(proj):null)||{}).name||''):'';
  window._rpData={res:res,from:from,to:to,projName:projName,fromLbl:_rpAsofLbl(from),toLbl:_rpAsofLbl(to),periodLbl:_rpAsofLbl(from)+' to '+_rpAsofLbl(to)};
  ct.innerHTML=_rpRender(res,from,to,projName);
}

// Scoped, token-driven stylesheet (light/dark via CSS vars). Injected once.
function _rpInjectStyle(){
  if(document.getElementById('rp2-style'))return;
  var s=document.createElement('style');s.id='rp2-style';
  s.textContent=[
   '.rp2{--rp-ind:#4F46E5;--rp-red:#DC2626;--rp-amb:#D97706;--rp-grn:#059669;color:var(--text);font-variant-numeric:tabular-nums}',
   '.rp2 .rp2-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:2px 0 14px;flex-wrap:wrap}',
   '.rp2 .rp2-head .ttl{font-size:15px;font-weight:600;letter-spacing:-.2px}',
   '.rp2 .rp2-head .meta{font-size:11.5px;color:var(--t3);text-align:right;line-height:1.6}',
   '.rp2 .rp2-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:0 0 16px}',
   '@media(max-width:980px){.rp2 .rp2-kpis{grid-template-columns:repeat(2,1fr)}}',
   '.rp2 .kpi{border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);padding:13px 15px;position:relative}',
   '.rp2 .kpi .k-l{font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--t3);font-weight:500}',
   '.rp2 .kpi .k-v{font-size:21px;font-weight:600;margin-top:5px;letter-spacing:-.3px;line-height:1.1}',
   '.rp2 .kpi .k-s{font-size:10.5px;color:var(--t3);margin-top:7px;line-height:1.55}',
   '.rp2 .kpi .k-s b{font-weight:600;color:var(--t2)}',
   '.rp2 .kpi .k-ic{position:absolute;top:13px;right:13px;color:var(--t4);opacity:.45}',
   '.rp2 .kpi.is-close{border-color:var(--rp-ind)}',
   '.rp2 .kpi.is-close .k-v{color:var(--rp-ind)}',
   '.rp2 .rp2-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
   '.rp2 .rp2-bar select,.rp2 .rp2-bar input{height:32px;border:1px solid var(--line);border-radius:8px;background:var(--canvas,var(--bg));color:var(--text);font:500 12px/1 inherit;padding:0 10px}',
   '.rp2 .rp2-bar .rp2-search{min-width:210px}',
   '.rp2 .rp2-bar .sp{flex:1}',
   '.rp2 .rp2-count{font-size:11.5px;color:var(--t3)}',
   '.rp2 .rp2-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:62vh;background:var(--card,#fff)}',
   '.rp2 table.rp2-t{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;min-width:880px}',
   '.rp2 .rp2-t thead th{position:sticky;top:0;z-index:2;background:var(--card,#fff);color:var(--t3);font-weight:500;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;text-align:right;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}',
   '.rp2 .rp2-t thead th.l{text-align:left}',
   '.rp2 .rp2-t thead th.act{color:var(--rp-ind)}',
   '.rp2 .rp2-t thead th .ar{font-size:9px;margin-left:3px}',
   '.rp2 .rp2-t tbody td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}',
   '.rp2 .rp2-t tbody td.l{text-align:left}',
   '.rp2 .rp2-t tbody tr.dat{cursor:pointer}',
   '.rp2 .rp2-t tbody tr.dat:hover td,.rp2 .rp2-t tbody tr.dat.open td{background:var(--hover,#f6f7f9)}',
   '.rp2 .cc{font-size:10.5px;color:var(--t3)}',
   '.rp2 .cn{font-weight:500}',
   '.rp2 .un{font-weight:500}.rp2 .uf{font-size:10.5px;color:var(--t3)}',
   '.rp2 .chev{display:inline-flex;color:var(--t4);transition:transform .15s;vertical-align:-2px;margin-right:4px}',
   '.rp2 tr.dat.open .chev{transform:rotate(90deg)}',
   '.rp2 .pb{display:inline-flex;align-items:center;gap:7px;justify-content:flex-end}',
   '.rp2 .pb .track{width:46px;height:5px;border-radius:3px;background:var(--line);overflow:hidden}',
   '.rp2 .pb .fill{height:100%;background:var(--rp-ind);border-radius:3px}',
   '.rp2 .pb .pn{font-size:11px;color:var(--t2);min-width:36px;text-align:right}',
   '.rp2 .rk{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:500}',
   '.rp2 .rk .dot{width:8px;height:8px;border-radius:50%}',
   '.rp2 .rk.red{color:var(--rp-red)}.rp2 .rk.red .dot{background:var(--rp-red)}',
   '.rp2 .rk.amb{color:var(--rp-amb)}.rp2 .rk.amb .dot{background:var(--rp-amb)}',
   '.rp2 .rk.grn{color:var(--rp-grn)}.rp2 .rk.grn .dot{background:var(--rp-grn)}',
   '.rp2 tr.exp td{padding:0;border-bottom:1px solid var(--line);background:var(--bg,#fafbfc)}',
   '.rp2 .xp{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 26px;padding:14px 18px 16px}',
   '@media(max-width:820px){.rp2 .xp{grid-template-columns:repeat(2,1fr)}}',
   '.rp2 .xg h6{margin:0 0 5px;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--t3);font-weight:500}',
   '.rp2 .xr{display:flex;justify-content:space-between;gap:14px;font-size:12px;padding:2.5px 0}',
   '.rp2 .xr .l{color:var(--t3)}',
   '.rp2 .rp2-t tfoot td{position:sticky;bottom:0;background:var(--card,#fff);border-top:2px solid var(--line);font-weight:600;text-align:right;padding:11px 12px;font-size:12.5px}',
   '.rp2 .rp2-t tfoot td.l{text-align:left;color:var(--t2);text-transform:uppercase;font-size:10.5px;letter-spacing:.5px}',
   '.rp2 .rp2-foot{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}',
   '@media(max-width:820px){.rp2 .rp2-foot{grid-template-columns:1fr}}',
   '.rp2 .rp2-card{border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);padding:14px 16px}',
   '.rp2 .rp2-card h5{margin:0 0 10px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--t3);font-weight:500}',
   '.rp2 .idr{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line)}',
   '.rp2 .idr:last-child{border-bottom:0}',
   '.rp2 .idr.tot{font-weight:600;color:var(--rp-ind);border-bottom:0;border-top:2px solid var(--line);margin-top:3px;padding-top:8px}',
   '.rp2 .offt{width:100%;border-collapse:collapse;font-size:12.5px}',
   '.rp2 .offt th,.rp2 .offt td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right}',
   '.rp2 .offt th:first-child,.rp2 .offt td:first-child{text-align:left}',
   '.rp2 .offt th{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:500}',
   '.rp2 .offt tr.tot td{font-weight:600;border-bottom:0}',
   '.rp2 .rp2-empty{text-align:center;padding:48px 0;color:var(--t3)}'
  ].join('');
  document.head.appendChild(s);
}

var RP2_HEAD=[
  {l:'S#',cls:'l',sort:null},
  {l:'Client',cls:'l',sort:'client'},
  {l:'Unit',cls:'l',sort:'unit'},
  {l:'Net Price',sort:'net_price'},
  {l:'Opening',sort:'opening'},
  {l:'Due',sort:'due_period'},
  {l:'Recovered',sort:'received_total'},
  {l:'Closing',sort:'closing'},
  {l:'Paid %',sort:'paid_pct'},
  {l:'Risk',sort:'overdue_days'}
];
function _rpNum(v){return fM(Number(v||0));}
function _rp2RiskLevel(d){ if(d==null)return 'grn'; if(d>90)return 'red'; if(d>=1)return 'amb'; return 'grn'; }
function _rp2RiskBadge(d){
  var lv=_rp2RiskLevel(d);
  var lbl=(lv==='grn')?(d?(d+'d'):'Current'):(d+'d overdue');
  return '<span class="rk '+lv+'"><span class="dot"></span>'+lbl+'</span>';
}
function _rp2Bar(p){
  var v=Math.max(0,Math.min(100,Number(p||0)));
  return '<span class="pb"><span class="track"><span class="fill" style="width:'+v+'%"></span></span><span class="pn">'+(Number(p||0).toFixed(1))+'%</span></span>';
}
var _RP2_CHEV='<svg class="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

function _rp2Header(t,from,to,projName){
  return '<div class="rp2-head"><div class="ttl">Recovery Position — Grand Summary</div>'
    +'<div class="meta">'+esc(projName||'All Projects')+' &middot; '+_rpAsofLbl(from)+' → '+_rpAsofLbl(to)
    +'<br>'+(Number(t.row_count||0))+' active sales &middot; Generated '+_rpAsofLbl(td())+'</div></div>';
}
function _rp2KPIs(t){
  var ic=function(p){return '<span class="k-ic"><svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">'+p+'</svg></span>';};
  var kpi=function(cls,lbl,val,sub,icon){return '<div class="kpi'+(cls?' '+cls:'')+'">'+(icon?ic(icon):'')+'<div class="k-l">'+lbl+'</div><div class="k-v">'+val+'</div>'+(sub?'<div class="k-s">'+sub+'</div>':'')+'</div>';};
  var pct=(t.recovery_pct!=null?Number(t.recovery_pct).toFixed(1):'0.0');
  return '<div class="rp2-kpis">'
    +kpi('','Opening Balance',_rpNum(t.opening),'DP <b>'+_rpNum(t.opening_dp)+'</b> &middot; Arrears <b>'+_rpNum(t.opening_arrears)+'</b>','<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>')
    +kpi('','+ Due This Period',_rpNum(t.due),'installments due in range','<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>')
    +kpi('','− Recovered',_rpNum(t.received_total),'DP <b>'+_rpNum(t.r_dp)+'</b> &middot; Old <b>'+_rpNum(t.r_old)+'</b> &middot; Curr <b>'+_rpNum(t.r_cur)+'</b>','<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')
    +kpi('is-close','= Closing Balance',_rpNum(t.closing),'DP <b>'+_rpNum(t.closing_dp)+'</b> &middot; Old <b>'+_rpNum(t.closing_old)+'</b> &middot; Curr <b>'+_rpNum(t.closing_current)+'</b>','<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>')
    +kpi('','Recovery %',pct+'%','Received ÷ (Opening + Due)','<path d="M3 3v18h18"/><path d="M19 9l-5 5-4-4-3 3"/>')
  +'</div>';
}
function _rp2FilterBar(rows){
  var fl={},ty={};
  rows.forEach(function(r){ if(r.floor_name)fl[r.floor_name]=1; if(r.unit_type)ty[r.unit_type]=1; });
  var opt=function(o){return '<option value="'+esc(o)+'">'+esc(o)+'</option>';};
  var floors=Object.keys(fl).sort();
  var types=Object.keys(ty).sort();
  return '<div class="rp2-bar">'
    +'<select id="rp2-floor" onchange="_rp2Filter()"><option value="">All Floors</option>'+floors.map(opt).join('')+'</select>'
    +'<select id="rp2-type" onchange="_rp2Filter()"><option value="">All Types</option>'+types.map(opt).join('')+'</select>'
    +'<select id="rp2-risk" onchange="_rp2Filter()"><option value="">All Risk</option><option value="red">Critical (&gt;90d)</option><option value="amb">Overdue (1–90d)</option><option value="grn">Current</option></select>'
    +'<input id="rp2-q" class="rp2-search" type="text" placeholder="Search client / unit…" oninput="_rp2Filter()">'
    +'<span class="sp"></span><span class="rp2-count" id="rp2-count"></span>'
  +'</div>';
}
function _rp2_view(){
  var st=window._rp2, f=st.filt, rows=st.rows.slice();
  rows=rows.filter(function(r){
    if(f.floor && String(r.floor_name||'')!==f.floor)return false;
    if(f.type && String(r.unit_type||'')!==f.type)return false;
    if(f.risk && _rp2RiskLevel(r.overdue_days)!==f.risk)return false;
    if(f.q){var hay=((r.client_name||'')+' '+(r.client_code||'')+' '+(r.unit_no||'')).toLowerCase();if(hay.indexOf(f.q)<0)return false;}
    return true;
  });
  var k=st.sort.key,dir=st.sort.dir;
  rows.sort(function(a,b){
    if(k==='client')return String(a.client_name||'').localeCompare(String(b.client_name||''))*dir;
    if(k==='unit')return String(a.unit_no||'').localeCompare(String(b.unit_no||''))*dir;
    var va=Number(a[k]||0),vb=Number(b[k]||0);return (va===vb?0:(va<vb?-1:1))*dir;
  });
  return rows;
}
function _rp2TableHTML(){
  var st=window._rp2, view=_rp2_view();
  var head='<thead><tr>'+RP2_HEAD.map(function(h){
    var act=(st.sort.key===h.sort);
    var ar=act?('<span class="ar">'+(st.sort.dir<0?'▼':'▲')+'</span>'):'';
    return '<th class="'+(h.cls||'')+(act?' act':'')+'"'+(h.sort?(' onclick="_rp2Sort(\''+h.sort+'\')"'):' style="cursor:default"')+'>'+h.l+ar+'</th>';
  }).join('')+'</tr></thead>';
  var body=view.map(function(r,i){
    return '<tr class="dat" onclick="_rp2Toggle('+i+')">'
      +'<td class="l">'+_RP2_CHEV+(i+1)+'</td>'
      +'<td class="l"><div class="cn">'+esc(r.client_name||'—')+'</div><div class="cc">'+esc(r.client_code||'')+'</div></td>'
      +'<td class="l"><span class="un">'+esc(r.unit_no||'—')+'</span> <span class="uf">'+esc(r.floor_name||'')+'</span></td>'
      +'<td>'+_rpNum(r.net_price)+'</td>'
      +'<td>'+_rpNum(r.opening)+'</td>'
      +'<td>'+_rpNum(r.due_period)+'</td>'
      +'<td>'+_rpNum(r.received_total)+'</td>'
      +'<td>'+_rpNum(r.closing)+'</td>'
      +'<td>'+_rp2Bar(r.paid_pct)+'</td>'
      +'<td>'+_rp2RiskBadge(r.overdue_days)+'</td>'
    +'</tr>'
    +'<tr class="exp" id="rp2x-'+i+'" style="display:none"><td colspan="10">'+_rp2Expand(r)+'</td></tr>';
  }).join('');
  var sum=function(k){return view.reduce(function(s,r){return s+Number(r[k]||0);},0);};
  var foot='<tfoot><tr>'
    +'<td class="l" colspan="3">Grand Total · '+view.length+' sales</td>'
    +'<td>'+_rpNum(sum('net_price'))+'</td>'
    +'<td>'+_rpNum(sum('opening'))+'</td>'
    +'<td>'+_rpNum(sum('due_period'))+'</td>'
    +'<td>'+_rpNum(sum('received_total'))+'</td>'
    +'<td>'+_rpNum(sum('closing'))+'</td>'
    +'<td></td><td></td></tr></tfoot>';
  return '<div class="rp2-wrap"><table class="rp2-t">'+head+'<tbody>'+body+'</tbody>'+foot+'</table></div>';
}
function _rp2Expand(r){
  var xr=function(l,v){return '<div class="xr"><span class="l">'+l+'</span><span class="v">'+v+'</span></div>';};
  var lp=r.last_payment_date?(_rpAsofLbl(r.last_payment_date)+' · '+_rpNum(r.last_payment_amount)):'No payments';
  return '<div class="xp">'
    +'<div class="xg"><h6>Opening Split</h6>'+xr('DP Remaining',_rpNum(r.opening_dp))+xr('Inst. Arrears',_rpNum(r.opening_arrears))+xr('Opening Total',_rpNum(r.opening))+'</div>'
    +'<div class="xg"><h6>Received This Period</h6>'+xr('vs DP',_rpNum(r.r_dp))+xr('vs Old',_rpNum(r.r_old))+xr('vs Current',_rpNum(r.r_cur))+xr('Advance',_rpNum(r.r_advance))+xr('Advance B/F adj.',_rpNum(r.advance_bf))+'</div>'
    +'<div class="xg"><h6>Closing Split</h6>'+xr('DP',_rpNum(r.closing_dp))+xr('Old',_rpNum(r.closing_old))+xr('Current',_rpNum(r.closing_current))+xr('Closing Total',_rpNum(r.closing))+'</div>'
    +'<div class="xg"><h6>Account</h6>'+xr('Last Payment',lp)+xr('Phone',esc(r.phone||'—'))+xr('Reg. Date',r.reg_date?_rpAsofLbl(r.reg_date):'—')+xr('Area / Rate',(r.area!=null?Number(r.area).toLocaleString('en-US'):'—')+' / '+(r.unit_rate!=null?Number(r.unit_rate).toLocaleString('en-US'):'—'))+xr('Discount',_rpNum(r.discount))+'</div>'
  +'</div>';
}
function _rp2Foot(t,officers,from,to){
  var idr=function(l,v,c){return '<div class="idr'+(c?' '+c:'')+'"><span class="l">'+l+'</span><span class="v">'+v+'</span></div>';};
  var stmt='<div class="rp2-card"><h5>Rollforward Statement · '+_rpAsofLbl(from)+' → '+_rpAsofLbl(to)+'</h5>'
    +idr('Opening Balance',_rpNum(t.opening))
    +idr('+ Due This Period',_rpNum(t.due))
    +idr('− Recovered (applied)',_rpNum(t.received_applied))
    +idr('− Advance B/F Adjusted',_rpNum(t.advance_bf))
    +idr('= Closing Balance',_rpNum(t.closing),'tot')
  +'</div>';
  var oRows=(officers||[]).map(function(o){var d=Number(o.dead_recovery_total||0),c=Number(o.current_recovery_total||0);
    return '<tr><td>'+esc(o.officer_name||'—')+'</td><td>'+_rpNum(d)+'</td><td>'+_rpNum(c)+'</td><td>'+_rpNum(d+c)+'</td></tr>';}).join('');
  var od=(officers||[]).reduce(function(s,o){return s+Number(o.dead_recovery_total||0);},0);
  var oc=(officers||[]).reduce(function(s,o){return s+Number(o.current_recovery_total||0);},0);
  var off='<div class="rp2-card"><h5>Officer Recovery · period receipts</h5>'
    +(officers&&officers.length
      ?'<table class="offt"><thead><tr><th>Officer</th><th>Dead (&gt;90d)</th><th>Current</th><th>Total</th></tr></thead><tbody>'+oRows
       +'<tr class="tot"><td>Total</td><td>'+_rpNum(od)+'</td><td>'+_rpNum(oc)+'</td><td>'+_rpNum(od+oc)+'</td></tr></tbody></table>'
      :'<div style="font-size:12px;color:var(--t3)">No period receipts.</div>')
  +'</div>';
  return '<div class="rp2-foot">'+stmt+off+'</div>';
}

function _rpRender(res,from,to,projName){
  var rows=Array.isArray(res.rows)?res.rows:[];
  var totals=res.totals||{};
  var officers=Array.isArray(res.officer_summary)?res.officer_summary:[];
  _rpInjectStyle();
  window._rp2={rows:rows,totals:totals,officers:officers,from:from,to:to,projName:projName,
    sort:{key:'closing',dir:-1},filt:{floor:'',type:'',risk:'',q:''}};
  if(!rows.length)
    return '<div class="rp2">'+_rp2Header(totals,from,to,projName)+_rpEmpty('No active sales for this selection','Try a different project or date range.')+'</div>';
  return '<div class="rp2">'
    +_rp2Header(totals,from,to,projName)
    +_rp2KPIs(totals)
    +_rp2FilterBar(rows)
    +'<div id="rp2-tablehost">'+_rp2TableHTML()+'</div>'
    +_rp2Foot(totals,officers,from,to)
  +'</div>';
}

// ── client-side handlers ──
function _rp2Repaint(){
  var host=document.getElementById('rp2-tablehost'); if(host)host.innerHTML=_rp2TableHTML();
  var c=document.getElementById('rp2-count'); if(c){var n=_rp2_view().length;c.textContent=n+' of '+window._rp2.rows.length+' shown';}
}
window._rp2Sort=function(k){var st=window._rp2;if(!st)return;if(st.sort.key===k)st.sort.dir*=-1;else{st.sort.key=k;st.sort.dir=(k==='client'||k==='unit')?1:-1;}_rp2Repaint();};
window._rp2Filter=function(){var st=window._rp2;if(!st)return;st.filt={floor:(document.getElementById('rp2-floor')||{}).value||'',type:(document.getElementById('rp2-type')||{}).value||'',risk:(document.getElementById('rp2-risk')||{}).value||'',q:(((document.getElementById('rp2-q')||{}).value)||'').toLowerCase().trim()};_rp2Repaint();};
window._rp2Toggle=function(i){var row=document.getElementById('rp2x-'+i);if(!row)return;var open=row.style.display==='none';row.style.display=open?'':'none';if(row.previousElementSibling)row.previousElementSibling.classList.toggle('open',open);};

// ── Reliable print emitter (scoped to this report): Electron IPC, else write
// the document straight into a popup and print on load — no Blob URL / revoke
// race (the old _printHTML revoked the object URL mid-render → blank/invalid PDF).
function _rpEmitPrint(html,title){
  if(window.electronPrint){window.electronPrint.print(html,title||'Document');return;}
  var w=window.open('','_blank','width=1180,height=860');
  if(!w){if(typeof toast==='function')toast('Allow pop-ups to print / save as PDF','warn');return;}
  w.document.open(); w.document.write(html); w.document.close();
  var fired=false,go=function(){if(fired)return;fired=true;try{w.focus();w.print();}catch(e){}};
  try{w.onload=go;}catch(e){}
  setTimeout(go,1200); // fallback if onload already passed (document.write)
}

// ── PRINT / SAVE-AS-PDF (A4 landscape, Crystal letterhead + KPI strip + rollforward) ──
function _rpPrint(){
  var D=window._rpData; if(!D||!D.res){toast('Run the report first, then print','warn');return;}
  var res=D.res, rows=Array.isArray(res.rows)?res.rows:[], t=res.totals||{}, officers=Array.isArray(res.officer_summary)?res.officer_summary:[];
  var pnum=function(v){return fM(Number(v||0));};
  var head='<tr><th class="l">S#</th><th class="l">Client</th><th class="l">Unit</th><th class="num">Net Price</th><th class="num">Opening</th><th class="num">Due</th><th class="num">Recovered</th><th class="num">Closing</th><th class="num">Paid %</th><th class="num">Overdue</th></tr>';
  var cg='<colgroup><col style="width:3%"><col style="width:19%"><col style="width:12%"><col style="width:10.5%"><col style="width:10.5%"><col style="width:9%"><col style="width:10.5%"><col style="width:10.5%"><col style="width:6.5%"><col style="width:8%"></colgroup>';
  var odCell=function(r){
    if(r.overdue_days==null)return '<td class="num">—</td>';
    var lv=_rp2RiskLevel(r.overdue_days), c=(lv==='red'?'#DC2626':lv==='amb'?'#D97706':'#059669');
    return '<td class="num"><span class="rdot" style="background:'+c+'"></span>'+r.overdue_days+'d</td>';
  };
  var body=rows.map(function(r,i){
    return '<tr><td>'+(i+1)+'</td><td class="cname">'+esc((r.client_code?r.client_code+' · ':'')+(r.client_name||''))+'</td><td>'+esc((r.unit_no||'')+(r.floor_name?' · '+r.floor_name:''))+'</td>'
      +'<td class="num">'+pnum(r.net_price)+'</td><td class="num">'+pnum(r.opening)+'</td><td class="num">'+pnum(r.due_period)+'</td><td class="num">'+pnum(r.received_total)+'</td><td class="num">'+pnum(r.closing)+'</td><td class="num">'+Number(r.paid_pct||0).toFixed(1)+'%</td>'+odCell(r)+'</tr>';
  }).join('');
  var grand='<tr class="rp-grand"><td colspan="3">GRAND TOTAL · '+rows.length+' sales</td><td class="num">'+pnum(t.net_price)+'</td><td class="num">'+pnum(t.opening)+'</td><td class="num">'+pnum(t.due)+'</td><td class="num">'+pnum(t.received_total)+'</td><td class="num">'+pnum(t.closing)+'</td><td class="num"></td><td class="num"></td></tr>';
  var infoRow=function(l,v){return '<div class="rp-info-row"><span class="lbl">'+l+' :</span> <span class="val">'+v+'</span></div>';};
  var infoBox='<div class="rp-infobox">'+infoRow('Company',esc(S?S.coName||'—':'—'))+infoRow('Project',esc(D.projName||'All Projects'))+infoRow('Period',esc(D.periodLbl||''))+infoRow('Generated',esc(_rpAsofLbl(td())))+infoRow('Active Sales',String(rows.length))+infoRow('Recovery %',(t.recovery_pct!=null?Number(t.recovery_pct).toFixed(1):'0.0')+'%')+'</div>';
  // 5-KPI rollforward strip (compact single row)
  var kc=function(l,v,a){return '<div class="rpk"><div class="rpk-l">'+l+'</div><div class="rpk-v"'+(a?' style="color:#4F46E5"':'')+'>'+v+'</div></div>';};
  var kpiStrip='<div class="rp-kpis">'+kc('Opening',pnum(t.opening))+kc('+ Due',pnum(t.due))+kc('− Recovered',pnum(t.received_total))+kc('Advance B/F',pnum(t.advance_bf))+kc('= Closing',pnum(t.closing),1)+kc('Recovery %',(t.recovery_pct!=null?Number(t.recovery_pct).toFixed(1):'0.0')+'%')+'</div>';
  var sR=function(l,v,b){return '<div class="rp-sum-row"><span class="lbl">'+l+'</span><span class="val"'+(b?' style="color:#4F46E5"':'')+'>'+v+'</span></div>';};
  var summaryBox='<div class="rp-summary"><h4>Rollforward Statement</h4>'+sR('Opening Balance',pnum(t.opening))+sR('+ Due This Period',pnum(t.due))+sR('− Recovered (applied)',pnum(t.received_applied))+sR('− Advance B/F Adjusted',pnum(t.advance_bf))+sR('= Closing Balance',pnum(t.closing),1)+'</div>';
  var od=officers.reduce(function(s,o){return s+Number(o.dead_recovery_total||0);},0),oc=officers.reduce(function(s,o){return s+Number(o.current_recovery_total||0);},0);
  var offRows=officers.map(function(o){var d=Number(o.dead_recovery_total||0),c=Number(o.current_recovery_total||0);return '<tr><td class="cname">'+esc(o.officer_name||'—')+'</td><td class="num">'+pnum(d)+'</td><td class="num">'+pnum(c)+'</td><td class="num">'+pnum(d+c)+'</td></tr>';}).join('');
  var genStr=_rpAsofLbl(td())+' '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  var extra='body{font-family:"Times New Roman",Georgia,serif;color:#1a1a1a}'
    +'.rp-doc-title{text-align:center;font-weight:700;font-size:14px;text-decoration:underline;margin:4px 0 8px}'
    +'.rp-infobox{border:1px solid #333;border-radius:3px;padding:8px 12px;margin:0 0 9px;display:grid;grid-template-columns:1fr 1fr;gap:2px 24px}'
    +'.rp-info-row{font-size:10px}.rp-info-row .lbl{font-weight:700;display:inline-block;min-width:88px}.rp-info-row .val{font-weight:600}'
    +'.rp-kpis{display:flex;gap:7px;margin:0 0 12px}'
    +'.rp-kpis .rpk{flex:1;border:1px solid #333;border-radius:4px;padding:6px 9px;text-align:left}'
    +'.rp-kpis .rpk-l{font-size:8px;text-transform:uppercase;letter-spacing:.4px;color:#555;font-weight:700}'
    +'.rp-kpis .rpk-v{font-size:12px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}'
    +'.rp-tbl{font-size:9px;border-collapse:collapse;table-layout:fixed;width:100%;font-variant-numeric:tabular-nums}'
    +'.rp-tbl thead{display:table-header-group}'
    +'.rp-tbl th,.rp-tbl td{border:1px solid #333;padding:3px 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'
    +'.rp-tbl td{background:#fff!important}'                                   // BUG2: no row tint, plain white (kills global zebra + any tint)
    +'.rp-tbl thead th{background:#fff!important;color:#1a1a1a;font-weight:700;text-align:left;border-bottom:2.5px double #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}' // BUG1: dark label text, was inheriting white
    +'.rp-tbl th.num,.rp-tbl td.num{text-align:right}.rp-tbl th.l,.rp-tbl td.l{text-align:left}.rp-tbl td.cname{font-weight:700}'
    +'.rp-tbl .rdot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:middle;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-tbl tbody tr.rp-grand td{background:#cfcfcf!important;font-weight:700;border-top:3px double #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-off-tbl{border-collapse:collapse;max-width:480px;font-size:9.5px;margin-top:6px}'
    +'.rp-off-tbl th,.rp-off-tbl td{border:1px solid #333;padding:3px 7px;background:#fff}'
    +'.rp-off-tbl thead th{background:#E8E8E8!important;font-weight:700;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}.rp-off-tbl th.num,.rp-off-tbl td.num{text-align:right}'
    +'.rp-summary{border:1px solid #333;border-radius:5px;padding:8px 12px;max-width:380px;margin-top:12px}'
    +'.rp-summary h4{font-size:11px;font-weight:700;text-decoration:underline;text-align:center;margin:0 0 6px}'
    +'.rp-sum-row{display:flex;justify-content:space-between;gap:14px;padding:2px 0;border-bottom:1px dotted #aaa;font-size:10px}'
    +'.rp-sum-row .lbl{font-weight:700}.rp-sum-row .val{font-weight:700}'
    +'@media print{@page{@bottom-left{content:"Generated: '+genStr+'";font-size:8px;color:#999}}}'; // per-page generated stamp (page X of Y comes from _pCSS @bottom-right)
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recovery Position (Grand Summary)</title><style>'+_pCSS('A4 landscape')+extra+'</style></head><body>'
    +_lh('Recovery Position (Grand Summary)', D.projName||'All Projects')
    +'<div class="body"><div class="rp-doc-title">Recovery Position — Grand Summary</div>'+infoBox+kpiStrip
    +'<table class="rp-tbl">'+cg+'<thead>'+head+'</thead><tbody>'+(rows.length?body+grand:'<tr><td colspan="10" style="text-align:center;padding:20px;color:#888">No active sales</td></tr>')+'</tbody></table>'
    +summaryBox
    +'<div class="sec-title">Officer Recovery Summary — '+esc(D.periodLbl||'')+'</div>'
    +'<table class="rp-off-tbl">'+(officers.length?('<thead><tr><th>Officer</th><th class="num">Dead (&gt;90d)</th><th class="num">Current</th><th class="num">Total</th></tr></thead><tbody>'+offRows+'<tr><td>TOTAL</td><td class="num">'+pnum(od)+'</td><td class="num">'+pnum(oc)+'</td><td class="num">'+pnum(od+oc)+'</td></tr></tbody>'):'<tbody><tr><td style="padding:8px;color:#888">No period receipts.</td></tr></tbody>')+'</table>'
    +_sigBlock()+'</div></body></html>';
  _rpEmitPrint(html,'Recovery Position (Grand Summary)');
}

// ── EXCEL — 10 visible columns + all splits, grand total, officer + statement ──
function _rpExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','warn');return;}
  var D=window._rpData; if(!D||!D.res){toast('Run the report first, then export','warn');return;}
  var res=D.res, t=res.totals||{}, officers=Array.isArray(res.officer_summary)?res.officer_summary:[];
  var rows=(window._rp2&&window._rp2.rows)?_rp2_view():(Array.isArray(res.rows)?res.rows:[]);
  var hdr=['S#','Client Code','Client Name','Unit','Floor','Net Price','Opening','Opening DP','Opening Arrears','Due','Recovered','vs DP','vs Old','vs Current','Advance','Advance B/F','Closing','Closing DP','Closing Old','Closing Current','Paid %','Overdue Days'];
  var aoa=[];
  aoa.push(['Recovery Position — Grand Summary (Rollforward)']);
  aoa.push(['Company',S?S.coName||'':'','Project',D.projName||'All Projects','Period',D.periodLbl||'']);
  aoa.push([]); aoa.push(hdr);
  rows.forEach(function(r,i){aoa.push([i+1,r.client_code||'',r.client_name||'',r.unit_no||'',r.floor_name||'',
    Number(r.net_price||0),Number(r.opening||0),Number(r.opening_dp||0),Number(r.opening_arrears||0),Number(r.due_period||0),
    Number(r.received_total||0),Number(r.r_dp||0),Number(r.r_old||0),Number(r.r_cur||0),Number(r.r_advance||0),Number(r.advance_bf||0),
    Number(r.closing||0),Number(r.closing_dp||0),Number(r.closing_old||0),Number(r.closing_current||0),
    Number(r.paid_pct||0),(r.overdue_days==null?'':Number(r.overdue_days))]);});
  aoa.push(['','','GRAND TOTAL','','',Number(t.net_price||0),Number(t.opening||0),Number(t.opening_dp||0),Number(t.opening_arrears||0),Number(t.due||0),
    Number(t.received_total||0),Number(t.r_dp||0),Number(t.r_old||0),Number(t.r_cur||0),Number(t.r_advance||0),Number(t.advance_bf||0),
    Number(t.closing||0),Number(t.closing_dp||0),Number(t.closing_old||0),Number(t.closing_current||0),'','']);
  aoa.push([]); aoa.push(['Rollforward Statement']);
  aoa.push(['Opening Balance',Number(t.opening||0)]);
  aoa.push(['+ Due This Period',Number(t.due||0)]);
  aoa.push(['- Recovered (applied)',Number(t.received_applied||0)]);
  aoa.push(['- Advance B/F Adjusted',Number(t.advance_bf||0)]);
  aoa.push(['= Closing Balance',Number(t.closing||0)]);
  aoa.push(['Recovery %',(t.recovery_pct!=null?Number(t.recovery_pct):0)]);
  aoa.push([]); aoa.push(['Officer Recovery Summary — '+(D.periodLbl||'')]);
  aoa.push(['Officer','Dead Recovery (>90d)','Current Recovery','Total']);
  var od=0,oc=0; officers.forEach(function(o){var d=Number(o.dead_recovery_total||0),c=Number(o.current_recovery_total||0);od+=d;oc+=c;aoa.push([o.officer_name||'—',d,c,d+c]);});
  aoa.push(['TOTAL',od,oc,od+oc]);
  var ws=XLSX.utils.aoa_to_sheet(aoa);
  if(typeof xlsxWesternNumFmt==='function')xlsxWesternNumFmt(ws);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Recovery Position');
  var fname='Nexunova_RecoveryPosition_'+(D.from||td())+'_'+(D.to||td())+'.xlsx';
  XLSX.writeFile(wb,fname);
  if(typeof toast==='function')toast('Exported: '+fname,'ok');
}

// ══ ACCOUNT STATEMENT helpers (called from _rt==='statement', _rs==='schedule') ════════
window._schMkUnitOpts = function(projFilter, units) {
  const filtered = (units||[]).filter(u => !projFilter || u.projectId === projFilter);
  filtered.sort((a, b) => (a.customerName||'').localeCompare(b.customerName||''));
  return '<option value="">— Select a Unit —</option>'
    + filtered.map(u => '<option value="'+esc(u.id)+'">'+esc(u.customerName||'?')+' &middot; '+esc(u.unitNo)+'</option>').join('');
};

window._schLoadUnit = async function(uid) {
  if (!uid) return;
  const body = document.getElementById('sch-stmnt');
  if (!body) return;
  const SPIN = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin .8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>';
  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px">'+SPIN+'Loading account statement…</div>';
  try {
    const u = gunit(uid);
    if (!u) { body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)">Unit not found in cache.</div>'; return; }
    const { data: activeSale } = await supabase.rpc('get_active_sale_for_unit', { p_unit_id: uid, p_company_id: S.cid });
    if (!activeSale?.id) { body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)">No active sale found for this unit.</div>'; return; }
    const { data: sdRes } = await supabase.rpc('get_sale_detail', { p_sale_id: activeSale.id, p_company_id: S.cid });
    if (!sdRes?.success) { body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--err)">Could not load sale details.</div>'; return; }
    const sale = sdRes.sale || {};
    const inst = Array.isArray(sdRes.installments) ? sdRes.installments : [];
    const { data: payRes } = await supabase.rpc('get_unit_sale_payments', { p_unit_id: uid, p_company_id: S.cid });
    const payments = Array.isArray(payRes?.payments) ? payRes.payments : [];
    body.innerHTML = window._schRender(u, sale, inst, payments, activeSale.id);
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--err)">Error: '+esc(e.message||'Unknown error')+'</div>';
  }
};

window._schRender = function(u, sale, inst, payments, saleId) {
  const today = td();
  const proj = gproject(u.projectId);
  const projName = proj?.name || proj?.projectName || '—';
  const uid = u.id;
  const openAmt = Number(sale.net_amount || sale.total_amount || 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount||0), 0);
  const totalOut = Math.max(0, openAmt - totalPaid);
  const pct2 = openAmt ? Math.round(totalPaid / openAmt * 100) : 0;

  const inf = (lbl, val) =>
    '<div style="padding:10px 14px;border-right:1px solid var(--line);min-width:0;overflow:hidden">'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--t3);margin-bottom:3px">' + lbl + '</div>'
    + '<div style="font-size:12.5px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + val + '</div></div>';

  let h = '<div class="card" style="margin-bottom:14px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)">'
    + '<div><div style="font-size:13px;font-weight:500;color:var(--t1)">Account Statement</div>'
    + '<div style="font-size:11px;color:var(--t3);margin-top:1px">'
    + esc(sale.client_name || u.customerName || '—') + ' &nbsp;&middot;&nbsp; Unit ' + esc(u.unitNo)
    + ' &nbsp;&middot;&nbsp; ' + esc(projName) + '</div></div>'
    + '<button class="btn btn-gh" onclick="printAccountStatement(\''+esc(uid)+'\',\''+esc(saleId)+'\')" style="font-size:11.5px;white-space:nowrap">Print Statement</button>'
    + '</div>';

  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));border-bottom:1px solid var(--line)">';
  h += inf('Client', '<b>' + esc(sale.client_name || u.customerName || '—') + '</b>');
  h += inf('Unit', '<b>' + esc(u.unitNo || '—') + '</b>');
  h += inf('Project', esc(projName));
  h += inf('Floor', esc(u.floorLabel || u.floor || '—'));
  h += inf('Type', esc(u.type || '—'));
  h += inf('Sale Date', sale.sale_date ? fD(sale.sale_date) : '—');
  if (sale.sale_number) h += inf('Sale #', esc(sale.sale_number));
  if (u.bookingNo || sale.booking_no) h += inf('Booking #', esc(u.bookingNo || sale.booking_no || '—'));
  if (u.phone) h += inf('Phone', esc(u.phone));
  if (u.soldBy || sale.agent_name) h += inf('Agent', esc(u.soldBy || sale.agent_name || '—'));
  h += '</div>';

  h += '<div style="display:flex;flex-wrap:wrap">';
  const kpi = (lbl, pkrVal, col) =>
    '<div style="flex:1;min-width:120px;padding:10px 14px;border-right:1px solid var(--line)">'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--t3);margin-bottom:4px">' + lbl + '</div>'
    + '<div style="font-size:15px;font-weight:600;color:' + (col||'var(--t1)') + ';font-variant-numeric:tabular-nums">PKR ' + fM(pkrVal) + '</div></div>';
  h += kpi('Total Price', openAmt);
  h += kpi('Total Received', totalPaid, 'var(--ok)');
  h += kpi('Outstanding', totalOut, totalOut > 0 ? 'var(--err)' : 'var(--ok)');
  h += '<div style="flex:1;min-width:120px;padding:10px 14px">'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--t3);margin-bottom:6px">Recovery</div>'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<div style="flex:1;height:5px;background:var(--line);border-radius:2px;overflow:hidden">'
    + '<div style="height:100%;width:' + pct2 + '%;background:var(--ok);border-radius:2px"></div></div>'
    + '<span style="font-size:13px;font-weight:600;color:var(--ok)">' + pct2 + '%</span></div></div>';
  h += '</div></div>';

  // Build chronological entries: installments (DR) + payments (CR)
  const entries = [];
  inst.forEach(function(i, idx) {
    const isOv = (i.status === 'overdue') ||
      (!['paid','partial'].includes(i.status) && i.due_date && i.due_date < today);
    entries.push({
      date: i.due_date || '',
      type: 'inst',
      label: esc(i.installment_type || (idx === 0 ? 'Down Payment' : 'Installment #' + (i.installment_number||(idx+1)))),
      num: i.installment_number || (idx + 1),
      dr: Number(i.amount_due || 0),
      isPaid: i.status === 'paid',
      isOv: isOv,
      isPartial: i.status === 'partial',
    });
  });
  payments.forEach(function(p) {
    entries.push({
      date: p.payment_date || '',
      type: 'pay',
      cr: Number(p.amount || 0),
      method: esc(p.payment_method || ''),
      rcpt: esc(p.voucher_code || p.payment_code || p.reference_no || ''),
    });
  });
  entries.sort(function(a, b) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.type === 'inst' ? -1 : 1;
  });

  let balance = openAmt;
  // Opening row: Sale Agreement
  let tRows = '<tr style="background:var(--hover)">'
    + '<td style="font-size:10px;color:var(--t3);text-align:center">—</td>'
    + '<td style="font-size:11px;white-space:nowrap;color:var(--t2)">' + fD(sale.sale_date||'') + '</td>'
    + '<td><span style="font-weight:500">Sale Agreement</span>'
    + (sale.sale_number ? ' <span style="font-size:10px;font-family:monospace;color:var(--t3)">' + esc(sale.sale_number) + '</span>' : '')
    + '</td>'
    + '<td class="r mono" style="font-weight:500">' + fM(openAmt) + '</td>'
    + '<td class="r" style="color:var(--t3)">—</td>'
    + '<td class="r mono" style="font-weight:600;color:var(--err)">' + fM(balance) + '</td>'
    + '</tr>';

  entries.forEach(function(e) {
    if (e.type === 'pay') {
      balance -= e.cr;
      tRows += '<tr style="background:rgba(34,197,94,0.03)">'
        + '<td style="font-size:12px;color:var(--ok);text-align:center">✓</td>'
        + '<td style="font-size:11px;white-space:nowrap">' + fD(e.date) + '</td>'
        + '<td><span style="color:var(--ok);font-weight:500">Payment Received</span>'
        + (e.method ? ' <span style="font-size:10px;color:var(--t3)">(' + e.method + ')</span>' : '')
        + (e.rcpt && e.rcpt !== '—' ? ' <span style="font-size:10px;font-family:monospace;color:var(--t3)">' + e.rcpt + '</span>' : '')
        + '</td>'
        + '<td class="r" style="color:var(--t3);font-size:11px">—</td>'
        + '<td class="r mono" style="font-weight:600;color:var(--ok)">+' + fM(e.cr) + '</td>'
        + '<td class="r mono" style="font-weight:600;color:' + (balance>0?'var(--err)':'var(--ok)') + '">' + fM(balance) + '</td>'
        + '</tr>';
    } else {
      const stBadge = e.isPaid
        ? '<span class="badge bo" style="font-size:9px;padding:1px 5px;margin-left:4px">Paid</span>'
        : e.isOv ? '<span class="badge br" style="font-size:9px;padding:1px 5px;margin-left:4px">Overdue</span>'
        : e.isPartial ? '<span class="badge bj" style="font-size:9px;padding:1px 5px;margin-left:4px">Partial</span>'
        : '<span style="font-size:10px;color:var(--t3);margin-left:4px">Pending</span>';
      tRows += '<tr' + (e.isOv?' style="background:rgba(239,68,68,0.03)"':e.isPaid?' style="opacity:.72"':'') + '>'
        + '<td style="font-size:10px;color:var(--t3);text-align:center">' + e.num + '</td>'
        + '<td style="font-size:11px;white-space:nowrap;color:' + (e.isOv?'var(--err)':'var(--t2)') + '">' + fD(e.date) + '</td>'
        + '<td><span style="font-size:12.5px">' + e.label + '</span>' + stBadge + '</td>'
        + '<td class="r mono" style="color:' + (e.isOv?'var(--err)':e.isPaid?'var(--t3)':'var(--t2)') + '">' + fM(e.dr) + '</td>'
        + '<td class="r" style="color:var(--t3);font-size:11px">—</td>'
        + '<td class="r" style="color:var(--t3);font-size:11px">—</td>'
        + '</tr>';
    }
  });

  const totalSched = inst.reduce((s, i) => s + Number(i.amount_due||0), 0);
  tRows += '<tr style="background:var(--hover);border-top:2px solid var(--line)">'
    + '<td colspan="3" style="font-size:12px;font-weight:600;color:var(--t1)">Balance Outstanding</td>'
    + '<td class="r mono" style="font-weight:600">' + fM(totalSched) + '</td>'
    + '<td class="r mono" style="font-weight:600;color:var(--ok)">+' + fM(totalPaid) + '</td>'
    + '<td class="r mono" style="font-weight:700;font-size:13px;color:' + (totalOut>0?'var(--err)':'var(--ok)') + '">' + fM(totalOut) + '</td>'
    + '</tr>';

  h += '<div class="card"><div class="tw"><table class="t">'
    + '<thead><tr>'
    + '<th style="width:32px;text-align:center">#</th>'
    + '<th style="white-space:nowrap">Date</th>'
    + '<th>Description</th>'
    + '<th class="r">Scheduled (DR)</th>'
    + '<th class="r">Received (CR)</th>'
    + '<th class="r">Balance</th>'
    + '</tr></thead>'
    + '<tbody>' + tRows + '</tbody>'
    + '</table></div></div>';

  return h;
};
