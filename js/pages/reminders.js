// ── Reminder System ───────────────────────────────────────────────
// Shows overdue + upcoming installments/PDC; log reminders sent.
// Phase-3 batch-1: restyled onto the nx- foundation kit. Logic/RPCs unchanged
// (get_reminders_page_data · create_reminder_log · list_reminder_logs) and the
// band/merge/clientInfo computations are byte-identical to the legacy version.

let _remFilter  = 'all';   // all | overdue | today | week | month | pdc
let _remData    = null;    // {installments, pdcRows, sales, clients}

// Band → kit semantic tone (overdue=danger · today=warning · week=info · month=neutral)
const _REM_TONE = { overdue:'danger', today:'warning', week:'info', month:'' };
function _remToneVar(band) { const t = _REM_TONE[band]; return t ? 'var(--fk-' + t + ')' : 'var(--fk-text-muted)'; }
function _remBandLabel(band) { return band === 'overdue' ? 'Overdue' : band === 'today' ? 'Due today' : band === 'week' ? 'This week' : 'This month'; }

// ── Page entry ────────────────────────────────────────────────────

async function rReminders() {
  const el = document.getElementById('pg-reminders');
  if (!el) return;
  el.innerHTML =
    NX.pageHeader('Reminders', NX.button('Refresh', { variant:'secondary', size:'sm', onclick:'rReminders()' })) +
    '<div id="rem-body">' + NX.card(NX.empty({ icon:'info', message:'Loading reminders…' })) + '</div>';

  try {
    await _remLoad();
    _remRender();
  } catch (e) {
    document.getElementById('rem-body').innerHTML = NX.card(NX.empty({ icon:'alert-triangle', message:'Could not load reminders — ' + (e.message || 'error') }));
  }
}

// ── Load data from Supabase ───────────────────────────────────────

async function _remLoad() {
  // Combined bundle via single RPC
  const { data: bundle, error: bErr } = await supabase.rpc('get_reminders_page_data', { p_company_id: S.cid });
  if (bErr) throw bErr;

  const installments = bundle?.installments || [];
  const pdcRows      = bundle?.pdcRows      || [];
  const recentLogs   = bundle?.recentLogs   || [];
  const salesArr     = bundle?.sales        || [];
  const followups    = bundle?.followups    || [];   // call-follow-ups due (was a black hole)
  const promises     = bundle?.promises     || [];   // payment promises due

  let salesMap = {};
  salesArr.forEach(s => { salesMap[s.id] = s; });

  // Client name + phone: merge from _clientsCache + gdb localStorage
  const clientsCache = window._clientsCache || [];
  const gdbUnits     = gdb()?.units?.[S.cid] || {};

  function clientInfo(saleId) {
    const sale   = salesMap[saleId] || {};
    const unitId = sale.unit_id;
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

  _remData = { installments, pdcRows, recentLogs, salesMap, clientInfo, followups, promises };
}

// One actionable "commitment" row — Call · WhatsApp · Log call. Used by the
// Follow-ups-due and Promises-due sections (the recovery loop, now surfaced).
function _remActRow(o) {
  const ph = (o.phone || '').replace(/[^0-9]/g, '');
  const overdue = o.date && o.date < td();
  const dlabel = o.date ? (overdue ? 'Overdue · ' : 'Due ') + fD(o.date) : '';
  const acts =
    (ph ? '<a class="nx-btn nx-btn--ghost nx-btn--sm" href="tel:' + NX.esc(o.phone) + '" title="Call">' + NX.icon('phone', 14) + '</a> ' +
          '<a class="nx-btn nx-btn--ghost nx-btn--sm" target="_blank" href="https://wa.me/' + ph + '" title="WhatsApp">' + NX.icon('message-circle', 14) + '</a> ' : '') +
    (o.unitId ? NX.button('Log call', { variant:'secondary', size:'sm', onclick:"openConModal('" + o.unitId + "')" }) : '');
  return '<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--fk-border)">' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + NX.esc(o.name || '—') + (o.unitNo ? ' <span class="nx-kpi-label" style="text-transform:none">· ' + NX.esc(o.unitNo) + '</span>' : '') + '</div>' +
      '<div class="nx-kpi-label" style="text-transform:none">' + NX.esc(o.sub || '') + '</div>' +
    '</div>' +
    (dlabel ? '<div class="nx-kpi-label" style="white-space:nowrap;color:' + (overdue ? 'var(--fk-danger)' : 'var(--fk-text-muted)') + '">' + dlabel + '</div>' : '') +
    (o.amount != null ? '<div class="num" style="font-weight:600;white-space:nowrap">' + fM(o.amount) + '</div>' : '') +
    '<div class="no-p" style="display:flex;gap:5px;white-space:nowrap">' + acts + '</div>' +
  '</div>';
}

// ── Render ────────────────────────────────────────────────────────

function _remRender() {
  const el = document.getElementById('rem-body');
  if (!el || !_remData) return;

  const todayStr = td();
  const in7      = new Date(); in7.setDate(in7.getDate() + 7);
  const in7Str   = in7.toISOString().split('T')[0];

  const { installments, pdcRows, recentLogs, clientInfo, followups, promises } = _remData;

  // ── Recovery loop: follow-ups due + promises due (top — officer's own commitments) ──
  const fuRows = (followups || []).map(f => _remActRow({
    name: f.client_name, unitId: f.unit_id, unitNo: (gunit(f.unit_id) || {}).unitNo || '',
    phone: f.phone_used, date: f.next_followup_date,
    sub: 'Follow-up' + (f.channel ? ' · ' + f.channel : '') + (f.remarks ? ' · ' + f.remarks : '')
  }));
  const prRows = (promises || []).map(p => _remActRow({
    name: p.client_name, unitId: p.unit_id, unitNo: p.unit_no || '',
    phone: p.phone, date: p.promise_date, amount: p.promised_amount,
    sub: 'Promised to pay' + (p.notes ? ' · ' + p.notes : '')
  }));
  const loopHtml =
    ((followups || []).length
      ? NX.card(fuRows.join(''), { header:{ title:'Follow-ups due', icon:'phone-call', tone:'warning', sub:(followups.length) + ' commitment' + (followups.length !== 1 ? 's' : '') } })
      : '') +
    ((promises || []).length
      ? NX.card(prRows.join(''), { header:{ title:'Promises due', icon:'handshake', tone:'info', sub:(promises.length) + ' promise' + (promises.length !== 1 ? 's' : '') + ' to follow up' }, class:'nx-mt-3' })
      : '');

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

  // ── KPI tiles ──
  const kpis =
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--fk-sp-2);margin-bottom:var(--fk-sp-4)">' +
      NX.card(NX.kpi({ label:'Follow-ups due', value:(followups || []).length, dot:'warn' }), { compact:true }) +
      NX.card(NX.kpi({ label:'Promises due',   value:(promises || []).length,  dot:'info' }), { compact:true }) +
      NX.card(NX.kpi({ label:'Overdue clients', value:overdueCount, delta:'PKR ' + fM(overdueAmt) + ' total', dot:'danger' }), { compact:true }) +
      NX.card(NX.kpi({ label:'Due today',     value:todayCnt, dot:'warn' }), { compact:true }) +
      NX.card(NX.kpi({ label:'Due this week', value:weekCnt,  dot:'info' }), { compact:true }) +
      NX.card(NX.kpi({ label:'PDC due / overdue', value:pdcOverdue, dot:'warn' }), { compact:true }) +
    '</div>';

  // ── Filter tabs ──
  const filterDefs = [
    { id:'all',     label:'All',        count: instRows.length + pdcInfoRows.length },
    { id:'overdue', label:'Overdue',    count: overdueCount },
    { id:'today',   label:'Due today',  count: todayCnt },
    { id:'week',    label:'This week',  count: weekCnt },
    { id:'month',   label:'This month', count: instRows.filter(r => r.band === 'month').length },
    { id:'pdc',     label:'PDC due',    count: pdcInfoRows.length },
  ];
  const filterBtns = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--fk-sp-3)">' +
    filterDefs.map(f => NX.button(f.label + ' · ' + f.count, { variant: _remFilter === f.id ? 'primary' : 'secondary', size:'sm', onclick:"_remSetFilter('" + f.id + "')" })).join('') + '</div>';

  // ── Table rows ──
  const allVisible = [
    ...visibleInst.map(r => _remInstRow(r, todayStr)),
    ...visiblePDC.map(r => _remPDCRow(r, todayStr)),
  ].sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || ''));

  const cols = [
    { label:'Client' }, { label:'Unit' }, { label:'Amount due', num:true },
    { label:'Due date' }, { label:'Status' }, { label:'Type' }, { label:'', width:'230px' }
  ];
  const tableHtml = allVisible.length === 0
    ? NX.card(NX.empty({ icon:'check', message:'No reminders in this category. Great job!' }))
    : NX.card('<table class="nx-table nx-table--flush"><thead><tr>' +
        cols.map(c => '<th class="' + (c.num ? 'num' : '') + '"' + (c.width ? ' style="width:' + c.width + '"' : '') + '>' + NX.esc(c.label) + '</th>').join('') +
        '</tr></thead><tbody>' + allVisible.map(r => r.html).join('') + '</tbody></table>', { flush:true });

  // ── Recent logs ──
  const logsHtml = recentLogs.length === 0
    ? NX.empty({ icon:'inbox', message:'No reminders sent yet.' })
    : recentLogs.slice(0, 20).map(l =>
        '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--fk-border)">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:var(--fk-fs-body);color:var(--fk-text)">' + NX.esc(l.client_name || '—') + '</div>' +
            '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted)">' +
              (l.amount_due ? 'PKR ' + fM(l.amount_due) + ' · ' : '') + (l.notes ? NX.esc(l.notes) + ' · ' : '') + 'Sent by ' + NX.esc(l.sent_by || '—') +
            '</div>' +
          '</div>' +
          '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);white-space:nowrap">' + fD(l.sent_at?.split('T')[0] || '') + '</div>' +
        '</div>'
      ).join('');

  el.innerHTML =
    kpis +
    (loopHtml ? '<div style="margin-bottom:var(--fk-sp-4)">' + loopHtml + '</div>' : '') +
    filterBtns +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--fk-sp-2)">' +
      '<div class="nx-kpi-label" style="text-transform:none">Payment reminders</div>' +
      '<div class="nx-kpi-label">' + allVisible.length + ' client' + (allVisible.length !== 1 ? 's' : '') + '</div>' +
    '</div>' +
    tableHtml +
    '<div style="margin-top:var(--fk-sp-4)"><div class="nx-kpi-label" style="text-transform:none;margin-bottom:var(--fk-sp-2)">Recent reminders sent</div>' +
    NX.card(logsHtml) + '</div>';
}

// ── Row builders ──────────────────────────────────────────────────

function _remInstRow(r, todayStr) {
  const days   = r.minDue ? Math.ceil((new Date(r.minDue) - new Date(todayStr)) / 86400000) : null;
  const isOver = r.band === 'overdue';
  const tone   = _remToneVar(r.band);
  const dayLbl = days === null ? '—' : days === 0 ? 'Today' : isOver ? `${Math.abs(days)}d ago` : `in ${days}d`;
  const wa     = r.phone ? _remWALink(r, r.outstanding) : '';
  const em     = r.email ? `<a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Payment Reminder — Unit ' + r.unitNo)}&body=${encodeURIComponent(_remEmailBody(r))}" class="nx-btn nx-btn--ghost nx-btn--sm" target="_blank" title="Send Email"><span>Email</span></a>` : '';
  return {
    sortKey: r.minDue || '9999',
    html:
      '<tr>' +
        '<td>' + NX.esc(r.name) + '</td>' +
        '<td><span class="num">' + NX.esc(r.unitNo) + '</span></td>' +
        '<td class="num"><span style="color:' + tone + '">PKR ' + fM(r.outstanding) + '</span></td>' +
        '<td>' + (r.minDue ? fD(r.minDue) : '—') +
          '<div class="nx-kpi-label" style="text-transform:none;color:' + tone + '">' + dayLbl + '</div></td>' +
        '<td>' + NX.badge(_remBandLabel(r.band), _REM_TONE[r.band], { dot: isOver }) + '</td>' +
        '<td><span style="color:var(--fk-text-muted)">Installment' + (r.installCount > 1 ? ' (' + r.installCount + ')' : '') + '</span></td>' +
        '<td><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' + wa + em +
          NX.button('Reminded', { variant:'secondary', size:'sm', icon:'check', onclick:"_remLog('" + (r.unitId || '') + "','" + (r.saleId || '') + "','" + esc(r.name) + "','" + esc(r.phone || '') + "'," + r.outstanding + ",'whatsapp')" }) +
        '</div></td>' +
      '</tr>'
  };
}

function _remPDCRow(r, todayStr) {
  const days   = r.cheque_date ? Math.ceil((new Date(r.cheque_date) - new Date(todayStr)) / 86400000) : null;
  const isOver = r.band === 'overdue';
  const tone   = _remToneVar(r.band === 'month' ? 'week' : r.band);
  const toneKey= r.band === 'overdue' ? 'danger' : r.band === 'today' ? 'warning' : 'info';
  const dayLbl = days === null ? '—' : days === 0 ? 'Today' : isOver ? `${Math.abs(days)}d ago` : `in ${days}d`;
  const wa     = r.phone ? _remWALink(r, r.amount, true) : '';
  return {
    sortKey: r.cheque_date || '9999',
    html:
      '<tr>' +
        '<td>' + NX.esc(r.name) + '</td>' +
        '<td><span class="num">' + NX.esc(r.unitNo) + '</span></td>' +
        '<td class="num"><span style="color:' + tone + '">PKR ' + fM(r.amount || 0) + '</span></td>' +
        '<td>' + (r.cheque_date ? fD(r.cheque_date) : '—') +
          '<div class="nx-kpi-label" style="text-transform:none;color:' + tone + '">' + dayLbl + '</div></td>' +
        '<td>' + NX.badge(isOver ? 'PDC overdue' : 'PDC due', toneKey, { dot: isOver }) + '</td>' +
        '<td><span style="color:var(--fk-text-muted)">' + NX.esc(r.cheque_no || '—') + ' · ' + NX.esc(r.bank_name || '') + '</span></td>' +
        '<td><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' + wa +
          NX.button('Reminded', { variant:'secondary', size:'sm', icon:'check', onclick:"_remLog('" + (r.unitId || '') + "','" + (r.saleId || '') + "','" + esc(r.name) + "','" + esc(r.phone || '') + "'," + (r.amount || 0) + ",'whatsapp')" }) +
        '</div></td>' +
      '</tr>'
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
  return `<a href="${href}" target="_blank" class="nx-btn nx-btn--ghost nx-btn--sm" title="Send WhatsApp" onclick="_remLog('${r.unitId||''}','${r.saleId||''}','${esc(r.name)}','${esc(r.phone||'')}',${amount||0},'whatsapp')"><span>WhatsApp</span></a>`;
}

function _remEmailBody(r) {
  return `Dear ${r.name},\n\nThis is a friendly reminder that a payment of PKR ${Number(r.outstanding||0).toLocaleString('en-PK')} is due for unit ${r.unitNo}.\n\nKindly arrange payment at your earliest convenience.\n\nRegards,\n${S.name || 'Nexunova Team'}`;
}

// ── Log reminder ──────────────────────────────────────────────────

async function _remLog(unitId, saleId, clientName, phone, amountDue, type) {
  try {
    await supabase.rpc('create_reminder_log', {
      p_company_id: S.cid,
      p_data: {
        unit_id:       unitId || null,
        sale_id:       saleId || null,
        client_name:   clientName || null,
        phone:         phone  || null,
        reminder_type: type   || 'whatsapp',
        amount_due:    amountDue || 0,
        sent_by:       S.name || S.userId || 'system',
      }
    });
    toast('Reminder logged', 'ok');
    const { data } = await supabase.rpc('list_reminder_logs', { p_company_id: S.cid, p_limit: 50 });
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
