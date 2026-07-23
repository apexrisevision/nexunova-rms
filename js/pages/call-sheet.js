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

let _csheet = { date: null, rows: [], byUnit: {}, loaded: false, onlyResponded: false };
let _csResp = null;   // active quick-response modal state

// Rows to show / export. When "only responded" is on, keep just the accounts that
// got a response on the selected day; otherwise every account that still owes.
function _csVisibleRows() {
  if (!_csheet.onlyResponded) return _csheet.rows;
  const idx = _csDayLogs();
  return _csheet.rows.filter(r => _csLogFor(idx, r));
}
function _csToggleResponded(on) { _csheet.onlyResponded = !!on; _csRender(); }

function _csToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _csF(n) { const x = Number(n || 0); return x ? '₨' + ((typeof fM === 'function') ? fM(x) : x.toLocaleString('en-US')) : '—'; }
// Days between a past contact date and the sheet's selected date → "3d ago".
function _csAgo(cd) {
  const a = new Date(cd + 'T00:00:00'), b = new Date(_csheet.date + 'T00:00:00');
  const d = Math.round((b - a) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + 'd ago';
}
// Add days to a YYYY-MM-DD string, return YYYY-MM-DD.
function _csAddDays(base, days) {
  const d = new Date((base || _csToday()) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

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

/* ─── Selected-day's contact logs, indexed by unit / sale / client ─────────────
   create_contact_log enriches sale_id + client_id from the unit, so a row always
   links to its log by at least one key — even if a log's unit_id is null. */
// CARRY-FORWARD: the status shown for a day is the latest response ON OR BEFORE it,
// so a client's standing (e.g. "call after 1 week") persists day to day instead of
// going blank. Only the 30-day grid looks at each individual day.
function _csDayLogs() {
  const logs = (window._contactLogsCache || []).filter(c => (c.contact_date || '').slice(0, 10) <= _csheet.date);
  const idx = { byUnit: {}, bySale: {}, byClient: {} };
  const key = c => (c.contact_date || '') + 'T' + (c.contact_time || '') + '#' + (c.created_at || '');
  const newer = (a, b) => !b || key(a) > key(b);
  logs.forEach(c => {
    if (c.unit_id && newer(c, idx.byUnit[c.unit_id])) idx.byUnit[c.unit_id] = c;
    if (c.sale_id && newer(c, idx.bySale[c.sale_id])) idx.bySale[c.sale_id] = c;
    if (c.client_id && newer(c, idx.byClient[c.client_id])) idx.byClient[c.client_id] = c;
  });
  return idx;
}
function _csLogFor(idx, r) {
  return (r.unit_id && idx.byUnit[r.unit_id]) || (r.sale_id && idx.bySale[r.sale_id]) || (r.client_id && idx.byClient[r.client_id]) || null;
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
  const idx = _csDayLogs();
  const today = _csToday();
  const isToday = _csheet.date === today;

  const withStatus = rows.filter(r => _csLogFor(idx, r)).length;
  const contactedToday = rows.filter(r => { const c = _csLogFor(idx, r); return c && (c.contact_date || '').slice(0, 10) === _csheet.date; }).length;
  const followupDue = rows.filter(r => { const c = _csLogFor(idx, r); return c && c.next_followup_date && (c.next_followup_date || '').slice(0, 10) <= _csheet.date; }).length;
  const promiseRows = rows.filter(r => { const c = _csLogFor(idx, r); return c && c.promise_to_pay; });
  const promisedAmt = promiseRows.reduce((s, r) => s + Number(_csLogFor(idx, r).promise_amount || 0), 0);
  const T = rows.reduce((t, r) => { t.old += r.old; t.cur += r.cur; t.dp += r.dp; t.closing += r.closing; return t; }, { old: 0, cur: 0, dp: 0, closing: 0 });

  const bar = NX.card(
    '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
      '<div class="nx-field" style="margin:0"><label class="nx-label">Response date</label>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          NX.button('‹', { variant: 'secondary', size: 'sm', onclick: '_csShiftDay(-1)' }) +
          '<input class="nx-input" type="date" style="width:170px" value="' + esc(_csheet.date) + '" onchange="_csSetDate(this.value)">' +
          NX.button('›', { variant: 'secondary', size: 'sm', onclick: '_csShiftDay(1)', disabled: isToday }) +
        '</div></div>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none">' +
        '<input type="checkbox"' + (_csheet.onlyResponded ? ' checked' : '') + ' onchange="_csToggleResponded(this.checked)"> Only responded clients</label>' +
      '<div style="flex:1"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        NX.button('Export Excel', { variant: 'secondary', size: 'sm', icon: 'download', onclick: '_csExport()' }) +
        NX.button('PDF', { variant: 'secondary', size: 'sm', icon: 'printer', onclick: '_csPDF()' }) +
        NX.button('30-day log', { variant: 'secondary', size: 'sm', icon: 'calendar', onclick: '_csGridPDF()' }) +
        NX.button('Share on WhatsApp', { variant: 'primary', size: 'sm', icon: 'share-2', onclick: '_csShare()' }) +
      '</div>' +
    '</div>', { compact: true });

  function stat(lbl, val, tone) {
    return '<div style="flex:1;min-width:118px;padding:12px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius);background:var(--fk-surface)">' +
      '<div class="nx-kpi-label">' + lbl + '</div><div style="font-size:19px;font-weight:500;margin-top:2px' + (tone ? ';color:' + tone : '') + '">' + val + '</div></div>';
  }
  const summary = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:var(--fk-sp-3) 0">' +
    stat('Accounts owing', rows.length) +
    stat('Contacted ' + (isToday ? 'today' : 'that day'), contactedToday, (contactedToday > 0 ? 'var(--fk-success)' : '')) +
    stat('With a status', withStatus) +
    stat('Follow-up due', followupDue, (followupDue > 0 ? 'var(--fk-warning)' : '')) +
    stat('Promises', promiseRows.length, (promiseRows.length > 0 ? 'var(--fk-success)' : '')) +
    stat('Current remaining', _csF(T.closing), 'var(--fk-danger)') +
    '</div>';

  const shown = _csVisibleRows();
  if (!shown.length) {
    root.innerHTML = bar + summary + NX.card(NX.empty({
      icon: _csheet.onlyResponded ? 'phone-off' : 'check-circle',
      message: _csheet.onlyResponded ? 'No responses added yet for ' + fD(_csheet.date) + '. Uncheck “Only responded” to see all owing accounts.' : 'No accounts with an outstanding balance.'
    }));
    return;
  }

  const body = shown.map((r, i) => {
    const c = _csLogFor(idx, r);
    const id = esc(r.unit_id || '');
    const dayLbl = r.odd > 0 ? r.odd + 'd' : '—';
    const dayTone = r.odd > 90 ? 'danger' : r.odd > 60 ? 'warning' : r.odd > 30 ? 'info' : '';
    const call = r.phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call ' + esc(r.phone) + '" href="tel:' + esc(r.phone) + '" onclick="event.stopPropagation()">' + NX.icon('phone', 15) + '</a>' : '';
    const wa = (r.phone && r.unit_id) ? '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" onclick="_csWA(\'' + id + '\')">' + NX.icon('message-circle', 15) + '</button>' : '';

    let respCell;
    if (c) {
      const tone = c.promise_to_pay ? 'var(--fk-success)' : 'var(--fk-text)';
      const cd = (c.contact_date || '').slice(0, 10);
      const fresh = cd === _csheet.date;
      const whenChip = fresh
        ? '<span style="font-size:10px;font-weight:600;color:var(--fk-success);background:var(--fk-success-soft,rgba(16,185,129,.12));padding:1px 6px;border-radius:10px">today</span>'
        : '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted)">· ' + esc(_csAgo(cd)) + '</span>';
      const fu = (c.next_followup_date || '').slice(0, 10);
      const fuDue = fu && fu <= _csheet.date;
      respCell = '<div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="color:' + tone + ';font-weight:500">' + esc(_csRespLabel(c)) + '</span>' + whenChip +
          (r.unit_id ? NX.button('Edit', { variant: 'ghost', size: 'sm', onclick: "_csOpenResp('" + id + "')" }) : '') +
        '</div>' +
        (fu ? '<div class="nx-kpi-label" style="text-transform:none;margin-top:2px;color:' + (fuDue ? 'var(--fk-warning)' : 'var(--fk-text-muted)') + '">' + (fuDue ? '⏰ Follow-up due · ' : 'Follow-up: ') + fD(fu) + '</div>' : '') +
        (c.remarks ? '<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted);margin-top:2px;white-space:normal">' + esc(c.remarks) + '</div>' : '') +
      '</div>';
    } else if (r.unit_id) {
      respCell = NX.button('+ Add response', { variant: 'secondary', size: 'sm', onclick: "_csOpenResp('" + id + "')" });
    } else {
      respCell = '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-text-muted)">—</span>';
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

  const TS = shown.reduce((t, r) => { t.old += r.old; t.cur += r.cur; t.dp += r.dp; t.closing += r.closing; return t; }, { old: 0, cur: 0, dp: 0, closing: 0 });
  const foot = '<tr style="border-top:2px solid var(--fk-border);font-weight:600">' +
    '<td></td><td>TOTAL · ' + shown.length + '</td>' +
    '<td class="num">' + _csF(TS.old) + '</td><td class="num">' + _csF(TS.cur) + '</td><td class="num">' + _csF(TS.dp) + '</td>' +
    '<td class="num" style="color:var(--fk-danger)">' + _csF(TS.closing) + '</td><td></td><td></td><td></td></tr>';

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
  const existing = _csLogFor(_csDayLogs(), r);
  _csResp = {
    unitId: uid,
    channel: (existing && existing.channel) || 'Call',
    response: existing ? _CS_RESPONSES.find(x => _CS_RESP_MAP[x] === existing.response_received) || null : null,
    remarks: (existing && existing.remarks) || '',
    promiseAmount: (existing && existing.promise_amount) || null,
    promiseDate: (existing && existing.promise_date) || null,
    followupDate: (existing && existing.next_followup_date) ? (existing.next_followup_date || '').slice(0, 10) : null,
    busy: false
  };
  _csRespRender();
}
function _csRespClose() { const h = document.getElementById('cs-resp-host'); if (h) h.innerHTML = ''; _csResp = null; }
function _csRespSetChannel(v) { if (_csResp) { _csResp.channel = v; _csRespRender(); } }
function _csRespPick(r) { if (_csResp) { _csResp.response = r; _csRespRender(); } }
function _csRespSetFollowup(days) { if (_csResp) { _csResp.followupDate = days == null ? null : _csAddDays(_csheet.date, days); _csRespRender(); } }

function _csRespRender() {
  if (!_csResp) return;
  const r = _csheet.byUnit[_csResp.unitId];
  const chanRow = ['Call', 'WhatsApp', 'SMS', 'Visit'].map(v =>
    NX.button(v, { variant: _csResp.channel === v ? 'primary' : 'secondary', size: 'sm', onclick: "_csRespSetChannel('" + v + "')" })).join(' ');
  const respRow = _CS_RESPONSES.map(v =>
    NX.button(v, { variant: _csResp.response === v ? 'primary' : 'secondary', size: 'sm', onclick: "_csRespPick('" + v + "')" })).join(' ');
  const fuPresets = [['None', null], ['Tomorrow', 1], ['+3d', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30]];
  const fuRow = fuPresets.map(p => {
    const sel = p[1] == null ? !_csResp.followupDate : (_csResp.followupDate === _csAddDays(_csheet.date, p[1]));
    return NX.button(p[0], { variant: sel ? 'primary' : 'secondary', size: 'sm', onclick: '_csRespSetFollowup(' + (p[1] == null ? 'null' : p[1]) + ')' });
  }).join(' ');
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
      '<textarea class="nx-input" rows="3" oninput="_csResp.remarks=this.value" placeholder="e.g. Salary 25 tareekh ko aayegi, tab pay karega">' + esc(_csResp.remarks || '') + '</textarea></div>' +
    '<div class="nx-field" style="margin:12px 0 0"><label class="nx-label">Next follow-up (reminder banega)</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + fuRow +
        '<input class="nx-input" type="date" style="width:150px" value="' + esc(_csResp.followupDate || '') + '" oninput="_csResp.followupDate=this.value;_csRespRender()">' +
        (_csResp.followupDate ? '<span class="nx-kpi-label" style="text-transform:none;color:var(--fk-primary)">→ ' + fD(_csResp.followupDate) + '</span>' : '') +
      '</div></div>';
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
      next_followup_date: _csResp.followupDate || null,
      next_followup_channel: _csResp.followupDate ? _csResp.channel : null,
      status_tag:        'Active',
      created_by:        S.userId
    };
    const { data, error } = await supabase.rpc('create_contact_log', { p_company_id: S.cid, p_data: payload });
    if (error) throw error;
    if (data && data.success === false) throw new Error(data.message || data.error || 'Could not save the response.');
    // Optimistically add the saved row so it shows even before the cache reload.
    const savedRow = data && data.row;
    if (savedRow) { if (!window._contactLogsCache) window._contactLogsCache = []; window._contactLogsCache.unshift(savedRow); }

    // Next follow-up → a reminder in the Reminders page + top bell on that date.
    if (_csResp.followupDate) {
      try {
        await supabase.rpc('create_follow_up_reminder', {
          p_company_id: S.cid,
          p_data: {
            unit_id: _csResp.unitId, client_id: (r && r.client_id) || null, sale_id: (r && r.sale_id) || null,
            contact_log_id: (data && data.id) || null,
            remind_at: _csResp.followupDate + 'T09:00:00+00:00',
            channels: [_csResp.channel], message: 'Follow-up: ' + ((r && r.client_name) || '') + (r && r.unit_no ? ' (' + r.unit_no + ')' : ''),
            status: 'pending', created_by: S.userId
          }
        });
      } catch (e) { console.warn('[call-sheet reminder]', e); if (typeof toast === 'function') toast('Response saved — but the reminder could not be set.', 'warn'); }
    }

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
  const rows = _csVisibleRows();
  const idx = _csDayLogs();
  const done = rows.filter(r => _csLogFor(idx, r));
  const promiseRows = done.filter(r => _csLogFor(idx, r).promise_to_pay);
  const promisedAmt = promiseRows.reduce((s, r) => s + Number(_csLogFor(idx, r).promise_amount || 0), 0);
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
      const c = _csLogFor(idx, r);
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
  const rows = _csVisibleRows();
  const idx = _csDayLogs();
  const cell = v => '<td>' + String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td>';
  const head = ['#', 'Client', 'Phone', 'Unit', 'Old remaining', 'This month', 'DP remaining', 'Current remaining', 'Recovered', 'Days', 'Channel', 'Response', 'Remarks', 'Promise Amt', 'Promise Date'];
  const trs = rows.map((r, i) => {
    const c = _csLogFor(idx, r) || {};
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

// PDF / print — clean A4 landscape sheet (money columns + response), via NXPrint.
function _csPDF() {
  const rows = _csVisibleRows();
  if (!rows.length) { if (typeof toast === 'function') toast('Nothing to print for this filter.', 'warn'); return; }
  const idx = _csDayLogs();
  const co = (typeof coLegalName === 'function') ? coLegalName() : ((S && S.coName) || 'Company');
  const who = (S && (S.name || S.username)) || '';
  const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const m = n => Number(n || 0) ? Number(n).toLocaleString('en-US') : '—';
  const T = rows.reduce((t, r) => { t.old += r.old; t.cur += r.cur; t.dp += r.dp; t.closing += r.closing; return t; }, { old: 0, cur: 0, dp: 0, closing: 0 });
  const body = rows.map((r, i) => {
    const c = _csLogFor(idx, r) || {};
    const resp = c.response_received ? (_CS_RESPONSES.find(x => _CS_RESP_MAP[x] === c.response_received) || c.response_received) : '';
    const promise = c.promise_to_pay ? 'Promise ' + m(c.promise_amount) + (c.promise_date ? ' by ' + e(c.promise_date) : '') : '';
    return '<tr>' +
      '<td class="rk">' + (i + 1) + '</td>' +
      '<td><div class="cn">' + e(r.client_name) + '</div><div class="su">' + e(r.unit_no) + (r.phone ? ' · ' + e(r.phone) : '') + '</div></td>' +
      '<td class="n">' + m(r.old) + '</td><td class="n">' + m(r.cur) + '</td><td class="n">' + m(r.dp) + '</td>' +
      '<td class="n big">' + m(r.closing) + '</td><td class="n">' + (r.odd > 0 ? r.odd + 'd' : '—') + '</td>' +
      '<td>' + e(c.channel || '') + '</td><td>' + e(promise || resp) + '</td><td>' + e(c.remarks || '') + '</td></tr>';
  }).join('');
  const totRow = '<tr class="tot"><td></td><td>TOTAL · ' + rows.length + '</td>' +
    '<td class="n">' + m(T.old) + '</td><td class="n">' + m(T.cur) + '</td><td class="n">' + m(T.dp) + '</td>' +
    '<td class="n big">' + m(T.closing) + '</td><td></td><td></td><td></td><td></td></tr>';
  const css = '@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}' +
    'body{font-family:"Inter",Arial,sans-serif;color:#1e2433;font-size:10px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:10px;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}' +
    '.hb .co{font-size:10px;opacity:.85;font-weight:600;text-transform:uppercase;letter-spacing:.03em}.hb .ti{font-size:19px;font-weight:800;margin-top:2px}.hb-r{text-align:right;font-size:10px;opacity:.92;line-height:1.6}.hb-r b{font-size:12px}' +
    'table{width:100%;border-collapse:collapse;font-size:9.5px}th{font-size:7.5px;text-transform:uppercase;letter-spacing:.04em;color:#8990a6;text-align:left;font-weight:700;padding:6px 7px;border-bottom:1.5px solid #e3e5ef}th.n{text-align:right}' +
    'td{padding:5px 7px;border-bottom:1px solid #f1f2f7;vertical-align:top}tbody tr:nth-child(even) td{background:#fbfbfe}.n{text-align:right;font-variant-numeric:tabular-nums}.rk{color:#aab0c4;font-weight:700}.cn{font-weight:700}.su{font-size:8px;color:#a0a5b8}.big{font-weight:800;color:#dc2626}' +
    '.tot td{background:#f3f4fa;font-weight:800;border-top:2px solid #c7cadb}.ft{margin-top:10px;border-top:1px solid #eceef5;padding-top:7px;font-size:8px;color:#aab0c4;display:flex;justify-content:space-between}';
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recovery Call Sheet — ' + e(co) + '</title><style>' + css + '</style></head><body>' +
    '<div class="hb"><div><div class="co">' + e(co) + (who ? ' · Agent: ' + e(who) : '') + '</div><div class="ti">Recovery Call Sheet</div></div>' +
      '<div class="hb-r"><b>' + e(fD(_csheet.date)) + '</b><br>' + rows.length + ' account' + (rows.length !== 1 ? 's' : '') + (_csheet.onlyResponded ? ' · responded only' : '') + '</div></div>' +
    '<table><thead><tr><th class="n">#</th><th>Client / Unit</th><th class="n">Old remaining</th><th class="n">This month</th><th class="n">DP remaining</th><th class="n">Current remaining</th><th class="n">Days</th><th>Channel</th><th>Response</th><th>Remarks</th></tr></thead>' +
    '<tbody>' + body + totRow + '</tbody></table>' +
    '<div class="ft"><span>Generated ' + e((new Date()).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</span><span>Nexunova RMS</span></div>' +
    '</body></html>';
  if (window.NXPrint && typeof NXPrint.emit === 'function') NXPrint.emit(html, 'Recovery Call Sheet');
  else { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); setTimeout(() => { try { w.print(); } catch (x) {} }, 300); } }
}

// 30-DAY LOG — a READABLE per-client day-wise history. A 30-column grid can't hold
// legible text, so instead each client gets a block listing every contact in the
// window in full: date · channel · status · promise · remarks. Answers "har din kya
// hua" without cryptic codes. Newest first, worst-owing clients first.
function _csRespText(rr) { return (_CS_RESPONSES.find(x => _CS_RESP_MAP[x] === rr) || rr || '—'); }
function _csGridPDF() {
  const start = _csAddDays(_csheet.date, -29), end = _csheet.date;
  const inWin = d => d >= start && d <= end;
  // Per client (row): all its contacts inside the 30-day window, newest first.
  const blocks = [];
  _csheet.rows.forEach(r => {
    const logs = (window._contactLogsCache || []).filter(cl => {
      const d = (cl.contact_date || '').slice(0, 10);
      if (!inWin(d)) return false;
      return (r.unit_id && cl.unit_id === r.unit_id) || (r.sale_id && cl.sale_id === r.sale_id) || (r.client_id && cl.client_id === r.client_id);
    });
    if (logs.length) {
      logs.sort((a, b) => ((b.contact_date || '') + (b.contact_time || '')).localeCompare((a.contact_date || '') + (a.contact_time || '')));
      blocks.push({ r, logs });
    }
  });
  if (!blocks.length) { if (typeof toast === 'function') toast('No contact activity in the last 30 days.', 'warn'); return; }
  blocks.sort((a, b) => b.r.closing - a.r.closing);
  const co = (typeof coLegalName === 'function') ? coLegalName() : ((S && S.coName) || 'Company');
  const who = (S && (S.name || S.username)) || '';
  const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const F = n => Number(n || 0) ? '₨' + Number(n).toLocaleString('en-US') : '—';

  const body = blocks.map(b => {
    const r = b.r;
    const rows = b.logs.map(c => {
      const promise = c.promise_to_pay ? F(c.promise_amount) + (c.promise_date ? ' by ' + e(fD((c.promise_date || '').slice(0, 10))) : '') : '—';
      const foll = c.next_followup_date ? '<div class="fu">Next follow-up: ' + e(fD((c.next_followup_date || '').slice(0, 10))) + '</div>' : '';
      return '<tr>' +
        '<td class="dt">' + e(fD((c.contact_date || '').slice(0, 10))) + (c.contact_time ? '<div class="tm">' + e((c.contact_time || '').slice(0, 5)) + '</div>' : '') + '</td>' +
        '<td>' + e(c.channel || '—') + '</td>' +
        '<td class="st">' + e(_csRespText(c.response_received)) + '</td>' +
        '<td class="n">' + promise + '</td>' +
        '<td class="rm">' + (c.remarks ? e(c.remarks) : '<span class="mut">—</span>') + foll + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="cli">' +
      '<div class="chd"><span class="cn">' + e(r.client_name) + '</span>' +
        '<span class="cu">' + e(r.unit_no) + (r.phone ? ' · ' + e(r.phone) : '') + '</span>' +
        '<span class="cout">Outstanding ' + F(r.closing) + '</span>' +
        '<span class="ccnt">' + b.logs.length + ' contact' + (b.logs.length !== 1 ? 's' : '') + '</span></div>' +
      '<table class="log"><thead><tr><th style="width:80px">Date</th><th style="width:70px">Channel</th><th style="width:95px">Status</th><th style="width:110px" class="n">Promise</th><th>Remarks</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }).join('');

  const css = '@page{size:A4 portrait;margin:11mm}*{box-sizing:border-box}' +
    'body{font-family:"Inter",Arial,sans-serif;color:#1e2433;font-size:10.5px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:10px;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}' +
    '.hb .co{font-size:10px;opacity:.85;font-weight:600;text-transform:uppercase;letter-spacing:.03em}.hb .ti{font-size:18px;font-weight:800;margin-top:2px}.hb-r{text-align:right;font-size:10px;opacity:.92;line-height:1.6}.hb-r b{font-size:12px}' +
    '.cli{border:1px solid #e8eaf2;border-radius:9px;margin-bottom:11px;overflow:hidden;page-break-inside:avoid}' +
    '.chd{background:#f6f7fb;padding:8px 12px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:1px solid #e8eaf2}' +
    '.chd .cn{font-weight:800;font-size:12px}.chd .cu{color:#6b7180;font-size:9.5px}.chd .cout{color:#dc2626;font-weight:700;font-size:10px}.chd .ccnt{margin-left:auto;color:#8990a6;font-size:9px;font-weight:600}' +
    'table.log{width:100%;border-collapse:collapse;font-size:10px}' +
    'table.log th{background:#fbfbfe;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.04em;color:#8990a6;font-weight:700;padding:5px 9px;border-bottom:1px solid #eceef5}' +
    'table.log td{padding:6px 9px;border-bottom:1px solid #f3f4f8;vertical-align:top}table.log tr:last-child td{border-bottom:none}' +
    '.n{text-align:right;font-variant-numeric:tabular-nums}.dt{font-weight:600;white-space:nowrap}.tm{font-size:8px;color:#a0a5b8;font-weight:400}' +
    '.st{font-weight:600}.rm{line-height:1.4}.fu{font-size:8.5px;color:#4f46e5;margin-top:2px}.mut{color:#c8ccd8}' +
    '.ft{margin-top:10px;border-top:1px solid #eceef5;padding-top:8px;font-size:8px;color:#aab0c4;display:flex;justify-content:space-between}';
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recovery — 30-Day Log — ' + e(co) + '</title><style>' + css + '</style></head><body>' +
    '<div class="hb"><div><div class="co">' + e(co) + (who ? ' · Agent: ' + e(who) : '') + '</div><div class="ti">Recovery — 30-Day Contact Log</div></div>' +
      '<div class="hb-r"><b>' + e(fD(start)) + ' → ' + e(fD(end)) + '</b><br>' + blocks.length + ' client' + (blocks.length !== 1 ? 's' : '') + ' with activity</div></div>' +
    body +
    '<div class="ft"><span>Generated ' + e((new Date()).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</span><span>Nexunova RMS</span></div>' +
    '</body></html>';
  if (window.NXPrint && typeof NXPrint.emit === 'function') NXPrint.emit(html, 'Recovery 30-Day Log');
  else { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); setTimeout(() => { try { w.print(); } catch (x) {} }, 300); } }
}
