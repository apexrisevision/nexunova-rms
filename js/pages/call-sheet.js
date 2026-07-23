// ══ RECOVERY CALL SHEET ══════════════════════════════════════════════════════
// The recovery agent's daily working report. Every account that still owes, in one
// list, with the SAME rollforward figures as the Recovery Position report — old
// remaining · this-month remaining · down-payment remaining · current remaining ·
// recovered — and each row contactable on the spot (Call / WhatsApp) with a QUICK
// inline response ("called → what did they say"). Today's responses show right in
// the row. At day's end: Export (Excel) + Share (WhatsApp). Date stepper switches
// which day's responses are shown; the money is as of today.
//
// Data: get_officer_recovery (officer-scoped; wraps get_recovery_position and adds
// unit_id/client_id) — the same source as My Recovery, so figures reconcile.
// Responses persist via the shared create_contact_log RPC (+ create_payment_promise
// on promises), so they flow into the Daily Call Report, contact history, etc.
// ═════════════════════════════════════════════════════════════════════════════

let _csheet = { date: null, rows: [], byUnit: {}, loaded: false };
let _csResp = null;   // active quick-response modal state

function _csToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _csF(n) { const x = Number(n || 0); return x ? '₨' + ((typeof fM === 'function') ? fM(x) : x.toLocaleString('en-US')) : '—'; }

/* ─── Entry point ──────────────────────────────────────────────────────────── */
async function rCallSheet() {
  const pg = document.getElementById('pg-callsheet');
  if (!pg) return;
  if (!_csheet.date) _csheet.date = _csToday();
  pg.innerHTML = NX.pageHeader('Recovery Call Sheet') + '<div id="cs-root"></div>';
  const root = document.getElementById('cs-root');
  root.innerHTML = NX.card('<div style="padding:22px;text-align:center;color:var(--fk-text-muted)">Loading recovery position…</div>', { compact: true });
  try {
    if (typeof loadContactLogsCache === 'function') await loadContactLogsCache(S && S.cid);
    await _csLoadData();
    _csRender();
  } catch (e) {
    console.error('[call-sheet] load', e);
    root.innerHTML = NX.card(NX.empty({ icon: 'alert-triangle', message: 'Could not load the call sheet. ' + (e && e.message ? e.message : '') }));
  }
}

/* ─── Load rollforward (officer-scoped), keep only accounts that still owe ──── */
async function _csLoadData() {
  const today = _csToday();
  const d = new Date(today + 'T00:00:00'), pad = n => String(n).padStart(2, '0');
  const mStart = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
  const meDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const mEnd = meDate.getFullYear() + '-' + pad(meDate.getMonth() + 1) + '-' + pad(meDate.getDate());
  const res = await supabase.rpc('get_officer_recovery', { p_company_id: S.cid, p_from: mStart, p_to: today, p_month_end: mEnd });
  if (res.error) throw res.error;
  const raw = (res.data && res.data.rows) || [];
  const rows = raw.filter(r => Number(r.closing) > 0).map(r => ({
    sale_id: r.sale_id, unit_id: r.unit_id || null, client_id: r.client_id || null,
    client_name: r.client_name || '—', unit_no: r.unit_no || '', floor_name: r.floor_name || '',
    phone: r.phone || '',
    old: Number(r.closing_old || 0), cur: Number(r.closing_current || 0), dp: Number(r.closing_dp || 0),
    closing: Number(r.closing || 0), recovered: Number(r.received_total || 0), odd: Number(r.overdue_days || 0)
  })).sort((a, b) => (b.odd - a.odd) || (b.closing - a.closing));
  _csheet.rows = rows;
  _csheet.byUnit = {};
  rows.forEach(r => { if (r.unit_id) _csheet.byUnit[r.unit_id] = r; });
  _csheet.loaded = true;
}

/* ─── Date controls (money stays as of today; only responses re-filter) ─────── */
function _csSetDate(v) { _csheet.date = v || _csToday(); _csRender(); }
function _csShiftDay(delta) {
  const d = new Date(_csheet.date + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  _csheet.date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  _csRender();
}

/* ─── Today's (selected-day's) contact logs, latest per unit ───────────────── */
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
  if (c.promise_to_pay && c.promise_amount) return 'Promise ' + _csF(c.promise_amount) + (c.promise_date ? ' · ' + fD(c.promise_date) : '');
  return c.response_received || 'Logged';
}

/* ─── Render ───────────────────────────────────────────────────────────────── */
function _csRender() {
  const root = document.getElementById('cs-root');
  if (!root) return;
  const rows = _csheet.rows;
  const byUnit = _csLogsByUnit();
  const isToday = _csheet.date === _csToday();

  const contacted = rows.filter(r => r.unit_id && byUnit[r.unit_id]).length;
  const promiseRows = rows.filter(r => r.unit_id && byUnit[r.unit_id] && byUnit[r.unit_id].promise_to_pay);
  const promisedAmt = promiseRows.reduce((s, r) => s + Number(byUnit[r.unit_id].promise_amount || 0), 0);
  const T = rows.reduce((t, r) => { t.old += r.old; t.cur += r.cur; t.dp += r.dp; t.closing += r.closing; return t; }, { old: 0, cur: 0, dp: 0, closing: 0 });

  const bar = NX.card(
    '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
      '<div class="nx-field" style="margin:0"><label class="nx-label">Response date</label>' +
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
    return '<div style="flex:1;min-width:118px;padding:12px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius);background:var(--fk-surface)">' +
      '<div class="nx-kpi-label">' + lbl + '</div><div style="font-size:19px;font-weight:500;margin-top:2px' + (tone ? ';color:' + tone : '') + '">' + val + '</div></div>';
  }
  const summary = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:var(--fk-sp-3) 0">' +
    stat('Accounts owing', rows.length) +
    stat('Contacted ' + (isToday ? 'today' : ''), contacted, (contacted > 0 ? 'var(--fk-success)' : '')) +
    stat('Pending', Math.max(0, rows.length - contacted)) +
    stat('Promises', promiseRows.length, (promiseRows.length > 0 ? 'var(--fk-success)' : '')) +
    stat('Promised', _csF(promisedAmt), (promisedAmt > 0 ? 'var(--fk-success)' : '')) +
    stat('Current remaining', _csF(T.closing), 'var(--fk-danger)') +
    '</div>';

  if (!rows.length) {
    root.innerHTML = bar + summary + NX.card(NX.empty({ icon: 'check-circle', message: 'No accounts with an outstanding balance.' }));
    return;
  }

  const body = rows.map((r, i) => {
    const c = r.unit_id ? byUnit[r.unit_id] : null;
    const id = esc(r.unit_id || '');
    const dayLbl = r.odd > 0 ? r.odd + 'd' : '—';
    const dayTone = r.odd > 90 ? 'danger' : r.odd > 60 ? 'warning' : r.odd > 30 ? 'info' : '';
    const call = r.phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call ' + esc(r.phone) + '" href="tel:' + esc(r.phone) + '" onclick="event.stopPropagation()">' + NX.icon('phone', 15) + '</a>' : '';
    const wa = (r.phone && r.unit_id) ? '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" onclick="_csWA(\'' + id + '\')">' + NX.icon('message-circle', 15) + '</button>' : '';

    let respCell;
    if (!r.unit_id) {
      respCell = '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted)">—</span>';
    } else if (c) {
      const tone = c.promise_to_pay ? 'var(--fk-success)' : 'var(--fk-text)';
      respCell = '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="color:' + tone + '">' + esc(_csRespLabel(c)) + '</span>' +
        (c.remarks ? '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.remarks) + '">' + esc(c.remarks) + '</span>' : '') +
        NX.button('Edit', { variant: 'ghost', size: 'sm', onclick: "_csOpenResp('" + id + "')" }) +
      '</div>';
    } else {
      respCell = NX.button('+ Add response', { variant: 'secondary', size: 'sm', onclick: "_csOpenResp('" + id + "')" });
    }

    return '<tr' + (c ? ' style="background:var(--fk-bg-subtle)"' : '') + '>' +
      '<td class="num" style="color:var(--fk-text-muted)">' + (i + 1) + '</td>' +
      '<td><div>' + esc(r.client_name) + '</div><div class="nx-kpi-label" style="text-transform:none">' + esc(r.unit_no) + (r.phone ? ' · ' + esc(r.phone) : '') + '</div></td>' +
      '<td class="num">' + _csF(r.old) + '</td>' +
      '<td class="num">' + _csF(r.cur) + '</td>' +
      '<td class="num">' + _csF(r.dp) + '</td>' +
      '<td class="num" style="font-weight:600;color:var(--fk-danger)">' + _csF(r.closing) + '</td>' +
      '<td>' + NX.badge(dayLbl, dayTone, { dot: r.odd > 60 }) + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()"><div style="display:flex;gap:3px">' + call + wa + '</div></td>' +
      '<td>' + respCell + '</td>' +
    '</tr>';
  }).join('');

  const foot = '<tr style="border-top:2px solid var(--fk-border);font-weight:600">' +
    '<td></td><td>TOTAL · ' + rows.length + '</td>' +
    '<td class="num">' + _csF(T.old) + '</td><td class="num">' + _csF(T.cur) + '</td><td class="num">' + _csF(T.dp) + '</td>' +
    '<td class="num" style="color:var(--fk-danger)">' + _csF(T.closing) + '</td><td></td><td></td><td></td></tr>';

  root.innerHTML = bar + summary + NX.card(
    '<div style="overflow-x:auto"><table class="nx-table nx-table--flush"><thead><tr>' +
      '<th class="num">#</th><th>Client / Unit</th><th class="num">Old remaining</th><th class="num">This month</th>' +
      '<th class="num">DP remaining</th><th class="num">Current remaining</th><th>Days</th><th>Contact</th>' +
      '<th style="min-width:200px">Response ' + (isToday ? 'today' : '(' + fD(_csheet.date) + ')') + '</th>' +
    '</tr></thead><tbody>' + body + foot + '</tbody></table></div>', { flush: true });
}

/* ─── WhatsApp overdue reminder ────────────────────────────────────────────── */
function _csWA(uid) {
  const r = _csheet.byUnit[uid];
  if (!r || !r.phone) { toast('No phone number on file.', 'warn'); return; }
  const msg = 'Assalam o Alaikum ' + (r.client_name || 'Sir/Madam') + ',\n\n' +
    'Aap ki payment due hai:\n\nUnit: ' + r.unit_no + '\nOutstanding: PKR ' + fM(r.closing) + '\n\n' +
    'Brahay Karam jald payment ada karein.';
  if (typeof openWhatsApp === 'function') openWhatsApp(r.phone, msg);
}

/* ─── Quick inline response modal ──────────────────────────────────────────── */
const _CS_RESPONSES = ['Answered', 'No answer', 'Promise to pay', 'Dispute', 'Switched off', 'Wrong number'];
const _CS_RESP_MAP = { 'Answered': 'Answered', 'No answer': 'NoResponse', 'Promise to pay': 'Promised', 'Dispute': 'Dispute', 'Switched off': 'SwitchedOff', 'Wrong number': 'WrongNumber' };

function _csOpenResp(uid) {
  const r = _csheet.byUnit[uid];
  if (!r) return;
  const existing = _csLogsByUnit()[uid];
  _csResp = {
    unitId: uid,
    channel: (existing && existing.channel) || 'Call',
    response: existing ? _CS_RESPONSES.find(x => _CS_RESP_MAP[x] === existing.response_received) || null : null,
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
  const r = _csheet.byUnit[_csResp.unitId];
  const chanRow = ['Call', 'WhatsApp', 'SMS', 'Visit'].map(v =>
    NX.button(v, { variant: _csResp.channel === v ? 'primary' : 'secondary', size: 'sm', onclick: "_csRespSetChannel('" + v + "')" })).join(' ');
  const respRow = _CS_RESPONSES.map(v =>
    NX.button(v, { variant: _csResp.response === v ? 'primary' : 'secondary', size: 'sm', onclick: "_csRespPick('" + v + "')" })).join(' ');
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
      '<b>' + esc(r.client_name) + '</b> · ' + esc(r.unit_no) + ' · Outstanding <span style="color:var(--fk-danger)">' + _csF(r.closing) + '</span></div>' +
    '<div class="nx-field" style="margin:0 0 12px"><label class="nx-label">Channel</label><div style="display:flex;gap:6px;flex-wrap:wrap">' + chanRow + '</div></div>' +
    '<div class="nx-field" style="margin:0 0 12px"><label class="nx-label">Response</label><div style="display:flex;gap:6px;flex-wrap:wrap">' + respRow + '</div></div>' +
    promiseFields +
    '<div class="nx-field" style="margin:12px 0 0"><label class="nx-label">Remarks (client ne kya kaha)</label>' +
      '<textarea class="nx-input" rows="3" oninput="_csResp.remarks=this.value" placeholder="e.g. Salary 25 tareekh ko aayegi, tab pay karega">' + esc(_csResp.remarks || '') + '</textarea></div>';
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
    const r = _csheet.byUnit[_csResp.unitId];
    const payload = {
      company_id:        S.cid,
      unit_id:           _csResp.unitId,
      client_name:       (r && r.client_name) || '',
      contact_date:      _csheet.date,
      contact_time:      new Date().toTimeString().slice(0, 8),
      channel:           _csResp.channel,
      direction:         'Outbound',
      agent_id:          S.userId,
      response_received: _CS_RESP_MAP[_csResp.response] || _csResp.response,
      remarks:           (_csResp.remarks || '').trim() || null,
      promise_to_pay:    isPromise,
      promise_amount:    isPromise ? Number(_csResp.promiseAmount) : null,
      promise_date:      isPromise ? _csResp.promiseDate : null,
      status_tag:        'Active',
      created_by:        S.userId
    };
    const { error } = await supabase.rpc('create_contact_log', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;

    if (isPromise) {
      try {
        await supabase.rpc('create_payment_promise', {
          p_company_id: S.cid,
          p_data: {
            client_id: (r && r.client_id) || null, sale_id: (r && r.sale_id) || null,
            promised_amount: Number(_csResp.promiseAmount), promise_date: _csResp.promiseDate,
            promise_made_on: _csheet.date, logged_by: S.userId || '', status: 'pending',
            notes: 'Promised during ' + _csResp.channel + ' on ' + _csheet.date + ' (Call Sheet)'
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
  const rows = _csheet.rows;
  const byUnit = _csLogsByUnit();
  const done = rows.filter(r => r.unit_id && byUnit[r.unit_id]);
  const promiseRows = done.filter(r => byUnit[r.unit_id].promise_to_pay);
  const promisedAmt = promiseRows.reduce((s, r) => s + Number(byUnit[r.unit_id].promise_amount || 0), 0);
  const who = (S && (S.name || S.username)) || '';
  const L = [];
  L.push('*Recovery Call Sheet*');
  L.push(fD(_csheet.date));
  if (who) L.push('Agent: ' + who);
  L.push('------------------------------');
  L.push('Contacted: ' + done.length + ' of ' + rows.length + ' owing');
  L.push('Promises: ' + promiseRows.length + ' (' + _csF(promisedAmt) + ')');
  L.push('------------------------------');
  if (done.length) {
    done.forEach((r, i) => {
      const c = byUnit[r.unit_id];
      L.push((i + 1) + '. ' + r.client_name + (r.unit_no ? ' [' + r.unit_no + ']' : '') + ' — remaining ' + _csF(r.closing));
      L.push('   ' + (c.channel || 'Call') + ': ' + (_csRespLabel(c) || c.response_received || ''));
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
  const rows = _csheet.rows;
  const byUnit = _csLogsByUnit();
  const cell = v => '<td>' + String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td>';
  const head = ['#', 'Client', 'Phone', 'Unit', 'Old remaining', 'This month', 'DP remaining', 'Current remaining', 'Recovered', 'Days', 'Channel', 'Response', 'Remarks', 'Promise Amt', 'Promise Date'];
  const trs = rows.map((r, i) => {
    const c = (r.unit_id && byUnit[r.unit_id]) || {};
    return '<tr>' + [
      i + 1, r.client_name, r.phone, r.unit_no,
      Math.round(r.old), Math.round(r.cur), Math.round(r.dp), Math.round(r.closing), Math.round(r.recovered), r.odd,
      c.channel || '', c.response_received ? (_CS_RESPONSES.find(x => _CS_RESP_MAP[x] === c.response_received) || c.response_received) : '',
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
  if (typeof toast === 'function') toast('Exported ' + rows.length + ' rows.', 'ok');
}
