// ── Reminder System ───────────────────────────────────────────────
// Shows overdue + upcoming installments/PDC; log reminders sent

let _remFilter  = 'all';   // all | overdue | today | week | month | pdc
let _remData    = null;    // {installments, pdcRows, sales, clients}

// ── Page entry ────────────────────────────────────────────────────

async function rReminders() {
  const el = document.getElementById('pg-reminders');
  if (!el) return;
  el.innerHTML = `
  <div class="ph">
    <div><h2>Reminders</h2><p>Overdue &amp; upcoming payments — track and send reminders</p></div>
    <button class="btn btn-g btn-sm" onclick="rReminders()">↺ Refresh</button>
  </div>
  <div id="rem-body"><div class="card"><div class="cb"><div class="empty"><div class="ei">⏳</div><div class="et">Loading reminders…</div></div></div></div></div>`;

  try {
    await _remLoad();
    _remRender();
  } catch (e) {
    document.getElementById('rem-body').innerHTML =
      `<div class="card"><div class="cb"><div style="color:var(--err);font-size:13px">Failed to load: ${esc(e.message)}</div></div></div>`;
  }
}

// ── Load data from Supabase ───────────────────────────────────────

async function _remLoad() {
  const todayStr = td();
  const in30     = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Str  = in30.toISOString().split('T')[0];

  // Overdue and upcoming installments (due within 30 days + all overdue)
  const [instRes, pdcRes, logRes] = await Promise.all([
    supabase
      .from('installments')
      .select('id, sale_id, installment_number, installment_type, due_date, amount_due, amount_paid, status')
      .eq('company_id', S.cid)
      .in('status', ['pending', 'partial', 'overdue'])
      .or(`due_date.lte.${in30Str},status.eq.overdue`)
      .order('due_date', { ascending: true }),

    supabase
      .from('pdc_cheques')
      .select('id, sale_id, cheque_no, bank_name, amount, cheque_date, status')
      .eq('company_id', S.cid)
      .eq('status', 'pending')
      .lte('cheque_date', in30Str)
      .order('cheque_date', { ascending: true }),

    supabase
      .from('reminder_logs')
      .select('id, unit_id, sale_id, client_name, phone, reminder_type, amount_due, sent_at, sent_by, notes')
      .eq('company_id', S.cid)
      .order('sent_at', { ascending: false })
      .limit(50),
  ]);

  if (instRes.error) throw instRes.error;
  if (pdcRes.error)  throw pdcRes.error;

  const installments = instRes.data || [];
  const pdcRows      = pdcRes.data  || [];
  const recentLogs   = logRes.data  || [];

  // Gather unique sale_ids to fetch sale→unit mapping
  const allSaleIds = [...new Set([
    ...installments.map(i => i.sale_id),
    ...pdcRows.map(p => p.sale_id),
  ].filter(Boolean))];

  let salesMap = {};
  if (allSaleIds.length > 0) {
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, unit_id, client_id, sale_number')
      .in('id', allSaleIds);
    (salesData || []).forEach(s => { salesMap[s.id] = s; });
  }

  // Client name + phone: merge from _clientsCache + gdb localStorage
  const clientsCache = window._clientsCache || [];
  const gdbUnits     = gdb()?.units?.[S.cid] || {};

  function clientInfo(saleId) {
    const sale   = salesMap[saleId] || {};
    const unitId = sale.unit_id;
    // Try localStorage first (has customerName + phone from sale modal)
    const lsUnit = unitId ? (gdbUnits[unitId] || gdbUnits[Object.keys(gdbUnits).find(k => k === unitId)]) : null;
    const cached = clientsCache.find(c => c.id === sale.client_id);
    const unit   = unitId ? gunit(unitId) : null;
    return {
      unitId,
      unitNo:     unit?.unitNo    || sale.unit_id || '—',
      saleId,
      saleNumber: sale.sale_number || '',
      name:  lsUnit?.customerName || cached?.fullName || cached?.full_name || '—',
      phone: lsUnit?.phone || cached?.phonePrimary || cached?.phone_primary || '',
      email: cached?.email || '',
      clientId: sale.client_id,
    };
  }

  _remData = { installments, pdcRows, recentLogs, salesMap, clientInfo };
}

// ── Render ────────────────────────────────────────────────────────

function _remRender() {
  const el = document.getElementById('rem-body');
  if (!el || !_remData) return;

  const todayStr = td();
  const in7      = new Date(); in7.setDate(in7.getDate() + 7);
  const in7Str   = in7.toISOString().split('T')[0];
  const in30     = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Str  = in30.toISOString().split('T')[0];

  const { installments, pdcRows, recentLogs, clientInfo } = _remData;

  // Categorise installments
  function band(i) {
    if (!i.due_date || i.due_date < todayStr) return 'overdue';
    if (i.due_date === todayStr)              return 'today';
    if (i.due_date <= in7Str)                return 'week';
    return 'month';
  }

  // Build rows: one row per (sale_id, band) — merge installments of same sale
  const rowMap = {};
  for (const inst of installments) {
    const b   = band(inst);
    const key = `${inst.sale_id}__${b}`;
    const outstanding = Math.max(0, Number(inst.amount_due || 0) - Number(inst.amount_paid || 0));
    if (!rowMap[key]) {
      rowMap[key] = { ...clientInfo(inst.sale_id), band: b, outstanding: 0, installCount: 0, minDue: inst.due_date };
    }
    rowMap[key].outstanding  += outstanding;
    rowMap[key].installCount += 1;
    if (inst.due_date && (!rowMap[key].minDue || inst.due_date < rowMap[key].minDue)) {
      rowMap[key].minDue = inst.due_date;
    }
  }
  const instRows = Object.values(rowMap);

  // PDC rows
  const pdcInfoRows = pdcRows.map(p => {
    const ci = clientInfo(p.sale_id);
    return { ...ci, ...p, band: p.cheque_date < todayStr ? 'overdue' : p.cheque_date === todayStr ? 'today' : p.cheque_date <= in7Str ? 'week' : 'month', isPDC: true };
  });

  // Filter
  let visibleInst = instRows;
  let visiblePDC  = [];
  if (_remFilter === 'pdc') {
    visibleInst = [];
    visiblePDC  = pdcInfoRows;
  } else if (_remFilter !== 'all') {
    visibleInst = instRows.filter(r => r.band === _remFilter);
    visiblePDC  = [];
  } else {
    visiblePDC = pdcInfoRows;
  }

  // Stats
  const overdueAmt  = instRows.filter(r => r.band === 'overdue').reduce((s,r) => s + r.outstanding, 0);
  const overdueCount= instRows.filter(r => r.band === 'overdue').length;
  const todayCnt    = instRows.filter(r => r.band === 'today').length;
  const weekCnt     = instRows.filter(r => r.band === 'week').length;
  const pdcOverdue  = pdcInfoRows.filter(r => r.band === 'overdue' || r.band === 'today').length;

  const filterBtns = [
    { id: 'all',     label: 'All',          count: instRows.length + pdcInfoRows.length },
    { id: 'overdue', label: 'Overdue',   count: overdueCount },
    { id: 'today',   label: 'Due Today', count: todayCnt },
    { id: 'week',    label: 'This Week', count: weekCnt },
    { id: 'month',   label: 'This Month',count: instRows.filter(r => r.band === 'month').length },
    { id: 'pdc',     label: 'PDC Due',   count: pdcInfoRows.length },
  ].map(f => `<button class="btn btn-${_remFilter===f.id?'d':'gh'} btn-sm" onclick="_remSetFilter('${f.id}')">${f.label}${f.count ? ` <span style="margin-left:4px;background:${_remFilter===f.id?'rgba(255,255,255,.25)':'var(--line)'};border-radius:10px;padding:1px 6px;font-size:10px">${f.count}</span>` : ''}</button>`).join('');

  // Build table rows
  const allVisible = [
    ...visibleInst.map(r => _remInstRow(r, todayStr)),
    ...visiblePDC.map(r => _remPDCRow(r, todayStr)),
  ].sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || ''));

  const tableHtml = allVisible.length === 0
    ? `<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px;font-size:12px">No reminders in this category. Great job!</td></tr>`
    : allVisible.map(r => r.html).join('');

  // Recent logs
  const logsHtml = recentLogs.length === 0
    ? `<div style="color:var(--t3);font-size:12px;text-align:center;padding:14px">No reminders sent yet.</div>`
    : recentLogs.slice(0, 20).map(l => {
        const typeIcons = { whatsapp:'', email:'', call:'', sms:'', other:'' };
        const ic = typeIcons[l.reminder_type] || '';
        return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--hover)">
          <span style="font-size:18px">${ic}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--t1)">${esc(l.client_name||'—')}</div>
            <div style="font-size:10px;color:var(--t3)">${l.amount_due ? 'PKR ' + fM(l.amount_due) + ' · ' : ''}${l.notes ? esc(l.notes) + ' · ' : ''}Sent by ${esc(l.sent_by||'—')}</div>
          </div>
          <div style="font-size:10px;color:var(--t3);white-space:nowrap">${fD(l.sent_at?.split('T')[0]||'')}</div>
        </div>`;
      }).join('');

  el.innerHTML = `
  <!-- Stats -->
  <div class="dash-kpi-row" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:20px">
    <div class="dash-kpi red" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><span class="dkpi-val">${overdueCount}</span></div>
      <div class="dkpi-lbl">Overdue Clients</div>
      <div class="dkpi-sub">PKR ${fM(overdueAmt)} total</div>
    </div>
    <div class="dash-kpi yellow" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span class="dkpi-val">${todayCnt}</span></div>
      <div class="dkpi-lbl">Due Today</div>
    </div>
    <div class="dash-kpi blue" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span class="dkpi-val">${weekCnt}</span></div>
      <div class="dkpi-lbl">Due This Week</div>
    </div>
    <div class="dash-kpi" style="cursor:default">
      <div class="dkpi-top"><span class="dkpi-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="dkpi-val">${pdcOverdue}</span></div>
      <div class="dkpi-lbl">PDC Due/Overdue</div>
    </div>
  </div>

  <!-- Filter tabs -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${filterBtns}</div>

  <!-- Main table -->
  <div class="card mb14">
    <div class="ch"><h3>Payment Reminders</h3><span style="font-size:11px;color:var(--t3)">${allVisible.length} client${allVisible.length!==1?'s':''}</span></div>
    <div class="cb" style="padding:0">
      <div class="tw">
        <table class="t">
          <thead><tr>
            <th>Client</th>
            <th>Unit</th>
            <th class="r">Amount Due</th>
            <th>Due Date</th>
            <th>Status</th>
            <th>Type</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>${tableHtml}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Recent reminder log -->
  <div class="card">
    <div class="ch"><h3>Recent Reminders Sent</h3></div>
    <div class="cb">${logsHtml}</div>
  </div>`;
}

// ── Row builders ──────────────────────────────────────────────────

function _remInstRow(r, todayStr) {
  const days   = r.minDue ? Math.ceil((new Date(r.minDue) - new Date(todayStr)) / 86400000) : null;
  const isOver = r.band === 'overdue';
  const col    = isOver ? '#ef4444' : r.band === 'today' ? '#f59e0b' : r.band === 'week' ? '#3b82f6' : '#22c55e';
  const dayLbl = days === null ? '—' : days === 0 ? 'TODAY' : isOver ? `${Math.abs(days)}d ago` : `in ${days}d`;
  const wa     = r.phone ? _remWALink(r, r.outstanding) : '';
  const em     = r.email ? `<a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Payment Reminder — Unit ' + r.unitNo)}&body=${encodeURIComponent(_remEmailBody(r))}" class="btn btn-gh btn-xs" target="_blank" title="Send Email">Email</a>` : '';
  return {
    sortKey: r.minDue || '9999',
    html: `<tr style="${isOver ? 'background:rgba(239,68,68,.03)' : ''}">
      <td style="font-weight:700">${esc(r.name)}</td>
      <td style="font-size:11px;font-family:monospace">${esc(r.unitNo)}</td>
      <td class="r mono" style="font-weight:700;color:${col}">PKR ${fM(r.outstanding)}</td>
      <td style="font-size:11px">
        <div>${r.minDue ? fD(r.minDue) : '—'}</div>
        <div style="font-size:10px;font-weight:700;color:${col}">${dayLbl}</div>
      </td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${col}18;color:${col};border:1px solid ${col}33">${r.band==='overdue'?'Overdue':r.band==='today'?'Due Today':r.band==='week'?'This Week':'This Month'}</span></td>
      <td style="font-size:11px;color:var(--t3)">Installment${r.installCount>1?' ('+r.installCount+')':''}</td>
      <td>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${wa}${em}
          <button class="btn btn-gh btn-xs" style="color:var(--ok);border-color:var(--ok)" onclick="_remLog('${r.unitId||''}','${r.saleId||''}','${esc(r.name)}','${esc(r.phone||'')}',${r.outstanding},'whatsapp')" title="Mark Reminded">✓ Reminded</button>
        </div>
      </td>
    </tr>`
  };
}

function _remPDCRow(r, todayStr) {
  const days   = r.cheque_date ? Math.ceil((new Date(r.cheque_date) - new Date(todayStr)) / 86400000) : null;
  const isOver = r.band === 'overdue';
  const col    = isOver ? '#ef4444' : r.band === 'today' ? '#f59e0b' : '#3b82f6';
  const dayLbl = days === null ? '—' : days === 0 ? 'TODAY' : isOver ? `${Math.abs(days)}d ago` : `in ${days}d`;
  const wa     = r.phone ? _remWALink(r, r.amount, true) : '';
  return {
    sortKey: r.cheque_date || '9999',
    html: `<tr style="${isOver ? 'background:rgba(239,68,68,.03)' : ''}">
      <td style="font-weight:700">${esc(r.name)}</td>
      <td style="font-size:11px;font-family:monospace">${esc(r.unitNo)}</td>
      <td class="r mono" style="font-weight:700;color:${col}">PKR ${fM(r.amount||0)}</td>
      <td style="font-size:11px">
        <div>${r.cheque_date ? fD(r.cheque_date) : '—'}</div>
        <div style="font-size:10px;font-weight:700;color:${col}">${dayLbl}</div>
      </td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${col}18;color:${col};border:1px solid ${col}33">${isOver?'PDC Overdue':'PDC Due'}</span></td>
      <td style="font-size:11px;color:var(--t3)">${esc(r.cheque_no||'—')} · ${esc(r.bank_name||'')}</td>
      <td>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${wa}
          <button class="btn btn-gh btn-xs" style="color:var(--ok);border-color:var(--ok)" onclick="_remLog('${r.unitId||''}','${r.saleId||''}','${esc(r.name)}','${esc(r.phone||'')}',${r.amount||0},'whatsapp')" title="Mark Reminded">✓ Reminded</button>
        </div>
      </td>
    </tr>`
  };
}

// ── WhatsApp link builder ─────────────────────────────────────────

function _remWALink(r, amount, isPDC) {
  if (!r.phone) return '';
  const ph  = '92' + r.phone.replace(/^0/, '').replace(/[^0-9]/g, '');
  const msg = isPDC
    ? `Assalam o Alaikum ${r.name}, aap ke unit ${r.unitNo} ka post-dated cheque PKR ${Number(amount||0).toLocaleString('en-PK')} present hone wala hai. Kripya account mein funds ensure karein. Shukriya. Nexunova.`
    : `Assalam o Alaikum ${r.name}, aap ke unit ${r.unitNo} ki PKR ${Number(amount||0).toLocaleString('en-PK')} ki payment pending hai. Jald payment karein ya rabta karein. Nexunova.`;
  const href = `https://wa.me/${ph}?text=${encodeURIComponent(msg)}`;
  return `<a href="${href}" target="_blank" class="btn btn-gh btn-xs" style="color:#16a34a;border-color:#16a34a;text-decoration:none" title="Send WhatsApp" onclick="_remLog('${r.unitId||''}','${r.saleId||''}','${esc(r.name)}','${esc(r.phone||'')}',${amount||0},'whatsapp')">WhatsApp</a>`;
}

function _remEmailBody(r) {
  return `Dear ${r.name},\n\nThis is a friendly reminder that a payment of PKR ${Number(r.outstanding||0).toLocaleString('en-PK')} is due for unit ${r.unitNo}.\n\nKindly arrange payment at your earliest convenience.\n\nRegards,\n${S.name || 'Nexunova Team'}`;
}

// ── Log reminder ──────────────────────────────────────────────────

async function _remLog(unitId, saleId, clientName, phone, amountDue, type) {
  try {
    await supabase.from('reminder_logs').insert([{
      company_id:    S.cid,
      unit_id:       unitId || null,
      sale_id:       saleId || null,
      client_name:   clientName || null,
      phone:         phone  || null,
      reminder_type: type   || 'whatsapp',
      amount_due:    amountDue || 0,
      sent_by:       S.name || S.userId || 'system',
    }]);
    toast('Reminder logged', 'ok');
    // Refresh logs section without full reload
    const { data } = await supabase.from('reminder_logs').select('id,unit_id,sale_id,client_name,phone,reminder_type,amount_due,sent_at,sent_by,notes').eq('company_id', S.cid).order('sent_at', { ascending: false }).limit(50);
    if (_remData) _remData.recentLogs = data || [];
    _remRender();
  } catch (e) {
    toast('Could not log reminder', 'warn');
  }
}

// ── Filter ────────────────────────────────────────────────────────

function _remSetFilter(f) {
  _remFilter = f;
  _remRender();
}
