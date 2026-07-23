// ══ RECOVERY CALL SHEET ══════════════════════════════════════════════════════
// The recovery agent's daily working report: every OVERDUE account in one list,
// each row contactable on the spot (Call / WhatsApp) with a QUICK inline response
// ("called → what did they say"). Today's responses show right next to the amount.
// At day's end: Export (Excel) + Share (WhatsApp) the sheet. Next day it's fresh —
// the response column shows only the selected day's contact.
//
// Base overdue list = gunits() (same source as the Recovery queue). Responses are
// contact_logs written via the shared create_contact_log RPC (audit-consistent).
// ═════════════════════════════════════════════════════════════════════════════

let _csheet = { date: null };
let _csResp = null;   // active quick-response modal state

function _csToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ─── Entry point ──────────────────────────────────────────────────────────── */
async function rCallSheet() {
  const pg = document.getElementById('pg-callsheet');
  if (!pg) return;
  if (!_csheet.date) _csheet.date = _csToday();
  pg.innerHTML = NX.pageHeader('Recovery Call Sheet') + '<div id="cs-root"></div>';
  const root = document.getElementById('cs-root');
  root.innerHTML = NX.card('<div style="padding:22px;text-align:center;color:var(--fk-text-muted)">Loading…</div>', { compact: true });
  try { if (typeof loadContactLogsCache === 'function') await loadContactLogsCache(S && S.cid); } catch (e) {}
  _csRender();
}

/* ─── Date controls ────────────────────────────────────────────────────────── */
function _csSetDate(v) { _csheet.date = v || _csToday(); _csRender(); }
function _csShiftDay(delta) {
  const d = new Date(_csheet.date + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  _csheet.date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  _csRender();
}

/* ─── Data ─────────────────────────────────────────────────────────────────── */
// Overdue accounts, worst-first — the same base the Recovery queue uses.
function _csBase() {
  if (typeof gunits !== 'function') return [];
  const all = gunits().filter(u =>
    u.status !== 'Available' && u.status !== 'Dead' && actualPending(u) > 0 &&
    (typeof hasProjectAccess !== 'function' || hasProjectAccess(u.projectId))
  );
  all.sort((a, b) => (daysSincePay(b) ?? 99999) - (daysSincePay(a) ?? 99999));
  return all;
}
// Latest contact log per unit for the selected date.
function _csLogsByUnit() {
  const logs = (window._contactLogsCache || []).filter(c => c.unit_id && (c.contact_date || '').slice(0, 10) === _csheet.date);
  const map = {};
  logs.forEach(c => {
    const prev = map[c.unit_id];
    if (!prev || (c.contact_time || '') > (prev.contact_time || '') || (c.created_at || '') > (prev.created_at || '')) map[c.unit_id] = c;
  });
  return map;
}
function _csRespLabel(c) {
  if (!c) return null;
  const base = c.response_received || 'Logged';
  if (c.promise_to_pay && c.promise_amount) return 'Promise ' + _csF(c.promise_amount) + (c.promise_date ? ' · ' + fD(c.promise_date) : '');
  return base;
}
function _csF(n) { return '₨' + ((typeof fM === 'function') ? fM(Number(n || 0)) : Number(n || 0).toLocaleString('en-US')); }

/* ─── Render ───────────────────────────────────────────────────────────────── */
function _csRender() {
  const root = document.getElementById('cs-root');
  if (!root) return;
  const base = _csBase();
  const byUnit = _csLogsByUnit();
  const isToday = _csheet.date === _csToday();

  const contacted = base.filter(u => byUnit[u.id]).length;
  const promises = base.filter(u => { const c = byUnit[u.id]; return c && c.promise_to_pay; });
  const promisedAmt = promises.reduce((s, u) => s + Number(byUnit[u.id].promise_amount || 0), 0);
  const totalOverdue = base.reduce((s, u) => s + (actualPending(u) || 0), 0);

  const bar = NX.card(
    '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
      '<div class="nx-field" style="margin:0"><label class="nx-label">Date</label>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          NX.button('‹', { variant: 'secondary', size: 'sm', onclick: '_csShiftDay(-1)' }) +
          '<input class="nx-input" type="date" style="width:170px" value="' + esc(_csheet.date) + '" onchange="_csSetDate(this.value)">' +
          NX.button('›', { variant: 'secondary', size: 'sm', onclick: '_csShiftDay(1)', disabled: isToday }) +
        '</div></div>' +
      '<div style="flex:1"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        NX.button('Export', { variant: 'secondary', size: 'sm', icon: 'download', onclick: '_csExport()' }) +
        NX.button('Share on WhatsApp', { variant: 'primary', size: 'sm', icon: 'share-2', onclick: '_csShare()' }) +
      '</div>' +
    '</div>', { compact: true });

  function stat(lbl, val, tone) {
    return '<div style="flex:1;min-width:120px;padding:12px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius);background:var(--fk-surface)">' +
      '<div class="nx-kpi-label">' + lbl + '</div><div style="font-size:20px;font-weight:500;margin-top:2px' + (tone ? ';color:' + tone : '') + '">' + val + '</div></div>';
  }
  const summary = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:var(--fk-sp-3) 0">' +
    stat('Overdue accounts', base.length) +
    stat('Contacted ' + (isToday ? 'today' : ''), contacted, (contacted > 0 ? 'var(--fk-success)' : '')) +
    stat('Pending', Math.max(0, base.length - contacted)) +
    stat('Promises', promises.length, (promises.length > 0 ? 'var(--fk-success)' : '')) +
    stat('Promised', _csF(promisedAmt), (promisedAmt > 0 ? 'var(--fk-success)' : '')) +
    stat('Total overdue', _csF(totalOverdue), 'var(--fk-danger)') +
    '</div>';

  if (!base.length) {
    root.innerHTML = bar + summary + NX.card(NX.empty({ icon: 'check-circle', message: 'No overdue accounts — everyone is current.' }));
    return;
  }

  const rows = base.map((u, i) => {
    const d = daysSincePay(u);
    const dNum = d ?? 99999;
    const dayLbl = d === null ? 'Never' : d + 'd';
    const proj = (typeof gproject === 'function') ? gproject(u.projectId) : null;
    const projName = (proj && (proj.name || proj.projectName)) || '—';
    const c = byUnit[u.id];
    const id = esc(u.id);
    const phone = u.phone || '';
    const call = phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call ' + esc(phone) + '" href="tel:' + esc(phone) + '" onclick="event.stopPropagation()">' + NX.icon('phone', 15) + '</a>' : '';
    const wa = phone ? '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" onclick="event.stopPropagation();_csWA(\'' + id + '\')">' + NX.icon('message-circle', 15) + '</button>' : '';

    let respCell;
    if (c) {
      const tone = c.promise_to_pay ? 'var(--fk-success)' : 'var(--fk-text)';
      respCell = '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="color:' + tone + '">' + esc(_csRespLabel(c)) + '</span>' +
        (c.remarks ? '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.remarks) + '">' + esc(c.remarks) + '</span>' : '') +
        NX.button('Edit', { variant: 'ghost', size: 'sm', onclick: "_csOpenResp('" + id + "')" }) +
      '</div>';
    } else {
      respCell = NX.button('+ Add response', { variant: 'secondary', size: 'sm', onclick: "_csOpenResp('" + id + "')" });
    }

    return '<tr' + (c ? ' style="background:var(--fk-bg-subtle)"' : '') + '>' +
      '<td class="num" style="color:var(--fk-text-muted)">' + (i + 1) + '</td>' +
      '<td>' + esc(u.customerName || '—') + (phone ? '<br><span class="nx-kpi-label" style="text-transform:none">' + esc(phone) + '</span>' : '') + '</td>' +
      '<td><span class="num">' + esc(u.unitNo || '') + '</span></td>' +
      '<td><span style="color:var(--fk-text-muted)">' + esc(projName) + '</span></td>' +
      '<td class="num"><span style="color:var(--fk-danger)">' + _csF(actualPending(u)) + '</span></td>' +
      '<td>' + NX.badge(dayLbl, dNum > 90 ? 'danger' : dNum > 60 ? 'warning' : dNum > 30 ? 'info' : '', { dot: dNum > 60 }) + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()"><div style="display:flex;gap:3px">' + call + wa + '</div></td>' +
      '<td>' + respCell + '</td>' +
    '</tr>';
  }).join('');

  root.innerHTML = bar + summary + NX.card(
    '<table class="nx-table nx-table--flush"><thead><tr>' +
      '<th class="num">#</th><th>Client</th><th>Unit</th><th>Project</th><th class="num">Overdue</th><th>Days</th><th>Contact</th><th style="min-width:220px">Response ' + (isToday ? 'today' : '(' + fD(_csheet.date) + ')') + '</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>', { flush: true });
}

/* ─── WhatsApp shortcut (overdue reminder) ─────────────────────────────────── */
function _csWA(uid) {
  const u = (typeof gunit === 'function') ? gunit(uid) : null;
  if (!u || !u.phone) { toast('No phone number on file.', 'warn'); return; }
  const proj = (typeof gproject === 'function') ? gproject(u.projectId) : null;
  const msg = 'Assalam o Alaikum ' + (u.customerName || 'Sir/Madam') + ',\n\n' +
    'Aap ki installment due hai:\n\nUnit: ' + u.unitNo + (proj ? ' — ' + (proj.name || proj.projectName || '') : '') + '\n' +
    'Outstanding: PKR ' + fM(actualPending(u)) + '\n\nBrahay Karam jald payment ada karein.';
  if (typeof openWhatsApp === 'function') openWhatsApp(u.phone, msg);
}

/* ─── Quick inline response modal ──────────────────────────────────────────── */
const _CS_RESPONSES = ['Answered', 'No answer', 'Promise to pay', 'Dispute', 'Switched off', 'Wrong number'];
const _CS_RESP_MAP = { 'Answered': 'Answered', 'No answer': 'NoResponse', 'Promise to pay': 'Promised', 'Dispute': 'Dispute', 'Switched off': 'SwitchedOff', 'Wrong number': 'WrongNumber' };

function _csOpenResp(uid) {
  const u = (typeof gunit === 'function') ? gunit(uid) : null;
  if (!u) return;
  const existing = _csLogsByUnit()[uid];
  _csResp = {
    unitId: uid,
    channel: (existing && existing.channel) || 'Call',
    response: existing ? _CS_RESPONSES.find(r => _CS_RESP_MAP[r] === existing.response_received) || null : null,
    remarks: (existing && existing.remarks) || '',
    promiseAmount: (existing && existing.promise_amount) || null,
    promiseDate: (existing && existing.promise_date) || null,
    busy: false
  };
  _csRespRender();
}
function _csRespClose() { const h = document.getElementById('cs-resp-host'); if (h) h.innerHTML = ''; _csResp = null; }
function _csRespSetChannel(v) { if (_csResp) { _csResp.channel = v; _csRespRender(); } }
function _csRespPick(r) { if (_csResp) { _csResp.response = r; _csRespRender(); } }

function _csRespRender() {
  if (!_csResp) return;
  const u = gunit(_csResp.unitId);
  const seg = (val, cur, fn) => NX.button(val, { variant: cur === val ? 'primary' : 'secondary', size: 'sm', onclick: fn + "('" + val + "')" });
  const chanRow = ['Call', 'WhatsApp', 'SMS', 'Visit'].map(v => seg(v, _csResp.channel, '_csRespSetChannel')).join(' ');
  const respRow = _CS_RESPONSES.map(v =>
    NX.button(v, { variant: _csResp.response === v ? 'primary' : 'secondary', size: 'sm', onclick: "_csRespPick('" + v + "')" })
  ).join(' ');
  const isPromise = _csResp.response === 'Promise to pay';
  const promiseFields = isPromise
    ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">' +
        '<div class="nx-field" style="margin:0;flex:1;min-width:140px"><label class="nx-label">Promise amount (PKR)</label>' +
          '<input class="nx-input" type="number" inputmode="numeric" value="' + (_csResp.promiseAmount || '') + '" oninput="_csResp.promiseAmount=this.value"></div>' +
        '<div class="nx-field" style="margin:0;flex:1;min-width:140px"><label class="nx-label">Promise date</label>' +
          '<input class="nx-input" type="date" value="' + esc(_csResp.promiseDate || '') + '" oninput="_csResp.promiseDate=this.value"></div>' +
      '</div>'
    : '';
  const body =
    '<div class="nx-kpi-label" style="text-transform:none;margin-bottom:12px">' +
      '<b>' + esc(u.customerName || '—') + '</b> · ' + esc(u.unitNo || '') + ' · Overdue <span style="color:var(--fk-danger)">' + _csF(actualPending(u)) + '</span></div>' +
    '<div class="nx-field" style="margin:0 0 12px"><label class="nx-label">Channel</label><div style="display:flex;gap:6px;flex-wrap:wrap">' + chanRow + '</div></div>' +
    '<div class="nx-field" style="margin:0 0 12px"><label class="nx-label">Response</label><div style="display:flex;gap:6px;flex-wrap:wrap">' + respRow + '</div></div>' +
    promiseFields +
    '<div class="nx-field" style="margin:12px 0 0"><label class="nx-label">Remarks (client ne kya kaha)</label>' +
      '<textarea class="nx-input" rows="3" oninput="_csResp.remarks=this.value" placeholder="e.g. Salary 5 tareekh ko aayegi, tab pay karega">' + esc(_csResp.remarks || '') + '</textarea></div>';
  const footer =
    NX.button('Cancel', { variant: 'ghost', size: 'sm', onclick: '_csRespClose()' }) +
    NX.button(_csResp.busy ? 'Saving…' : 'Save response', { variant: 'primary', size: 'sm', disabled: _csResp.busy, onclick: '_csSaveResp()' });
  let host = document.getElementById('cs-resp-host');
  if (!host) { host = document.createElement('div'); host.id = 'cs-resp-host'; document.body.appendChild(host); }
  host.innerHTML = NX.modal({ title: 'Log response', size: 'm', body: body, footer: footer, onClose: '_csRespClose()' });
  const ov = host.querySelector('.nx-modal-overlay');
  if (ov) ov.addEventListener('click', e => { if (e.target === ov) _csRespClose(); });
}

async function _csSaveResp() {
  if (!_csResp || _csResp.busy) return;
  if (!_csResp.response) { toast('Select a response.', 'warn'); return; }
  const isPromise = _csResp.response === 'Promise to pay';
  if (isPromise && !(Number(_csResp.promiseAmount) > 0 && _csResp.promiseDate)) {
    toast('Promise ke liye amount aur date dono chahiye.', 'warn'); return;
  }
  _csResp.busy = true; _csRespRender();
  try {
    const u = gunit(_csResp.unitId);
    const payload = {
      company_id:      S.cid,
      unit_id:         _csResp.unitId,
      client_name:     (u && u.customerName) || '',
      contact_date:    _csheet.date,
      contact_time:    new Date().toTimeString().slice(0, 8),
      channel:         _csResp.channel,
      direction:       'Outbound',
      agent_id:        S.userId,
      response_received: _CS_RESP_MAP[_csResp.response] || _csResp.response,
      remarks:         (_csResp.remarks || '').trim() || null,
      promise_to_pay:  isPromise,
      promise_amount:  isPromise ? Number(_csResp.promiseAmount) : null,
      promise_date:    isPromise ? _csResp.promiseDate : null,
      status_tag:      'Active',
      created_by:      S.userId
    };
    const { error } = await supabase.rpc('create_contact_log', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;

    if (isPromise) {
      try {
        await supabase.rpc('create_payment_promise', {
          p_company_id: S.cid,
          p_data: {
            client_id:       (u && u.clientId) || null,
            sale_id:         (u && u.saleId) || null,
            promised_amount: Number(_csResp.promiseAmount),
            promise_date:    _csResp.promiseDate,
            promise_made_on: _csheet.date,
            logged_by:       S.userId || '',
            status:          'pending',
            notes:           'Promised during ' + _csResp.channel + ' on ' + _csheet.date + ' (Call Sheet)'
          }
        });
      } catch (e) { console.warn('[call-sheet promise]', e); }
    }
    toast('Response saved · ' + _csResp.response, 'ok');
    _csRespClose();
    try { if (typeof loadContactLogsCache === 'function') await loadContactLogsCache(S.cid); } catch (e) {}
    _csRender();
  } catch (e) {
    console.error('[_csSaveResp]', e);
    toast('Save failed: ' + (e && e.message ? e.message : e), 'err');
    if (_csResp) { _csResp.busy = false; _csRespRender(); }
  }
}

/* ─── Share / Export ───────────────────────────────────────────────────────── */
function _csShareText() {
  const base = _csBase();
  const byUnit = _csLogsByUnit();
  const done = base.filter(u => byUnit[u.id]);
  const promises = done.filter(u => byUnit[u.id].promise_to_pay);
  const promisedAmt = promises.reduce((s, u) => s + Number(byUnit[u.id].promise_amount || 0), 0);
  const who = (S && (S.name || S.username)) || '';
  const L = [];
  L.push('*Recovery Call Sheet*');
  L.push(fD(_csheet.date));
  if (who) L.push('Agent: ' + who);
  L.push('------------------------------');
  L.push('Contacted: ' + done.length + ' of ' + base.length + ' overdue');
  L.push('Promises: ' + promises.length + ' (' + _csF(promisedAmt) + ')');
  L.push('------------------------------');
  if (done.length) {
    done.forEach((u, i) => {
      const c = byUnit[u.id];
      L.push((i + 1) + '. ' + (u.customerName || '—') + (u.unitNo ? ' [' + u.unitNo + ']' : '') + ' — ' + _csF(actualPending(u)));
      L.push('   ' + (c.channel || 'Call') + ': ' + (_csRespLabel(c) || (c.response_received || '')));
      if (c.remarks) L.push('   ' + c.remarks);
    });
  } else {
    L.push('No responses added yet for this day.');
  }
  L.push('------------------------------');
  L.push('- Nexunova RMS');
  return L.join('\n');
}
function _csShare() {
  const txt = _csShareText();
  if (typeof openWhatsApp === 'function') openWhatsApp('', txt);
  else window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
}
function _csExport() {
  const base = _csBase();
  const byUnit = _csLogsByUnit();
  const cell = v => '<td>' + String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td>';
  const head = ['#', 'Client', 'Phone', 'Unit', 'Project', 'Overdue', 'Days', 'Channel', 'Response', 'Remarks', 'Promise Amt', 'Promise Date'];
  const trs = base.map((u, i) => {
    const c = byUnit[u.id] || {};
    const proj = (typeof gproject === 'function') ? gproject(u.projectId) : null;
    const d = daysSincePay(u);
    return '<tr>' + [
      i + 1, u.customerName || '', u.phone || '', u.unitNo || '',
      (proj && (proj.name || proj.projectName)) || '', Math.round(actualPending(u) || 0),
      d == null ? 'Never' : d, c.channel || '', c.response_received ? (_CS_RESPONSES.find(r => _CS_RESP_MAP[r] === c.response_received) || c.response_received) : '',
      (c.remarks || '').replace(/\n/g, ' '), c.promise_to_pay ? Math.round(c.promise_amount || 0) : '', c.promise_date || ''
    ].map(cell).join('') + '</tr>';
  }).join('');
  const html = '<html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>' +
    head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + trs + '</tbody></table></body></html>';
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Recovery_Call_Sheet_' + _csheet.date + '.xls';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  if (typeof toast === 'function') toast('Exported ' + base.length + ' rows.', 'ok');
}
