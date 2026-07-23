// ══ DAILY CALL REPORT ════════════════════════════════════════════════════════
// "Aaj main ne kis kis ko call ki — remarks, promises, next follow-up."
// A recovery officer's (or, for admins, any/all officers') contact_logs for one
// day, with a summary strip and a one-tap SHARE (WhatsApp / copy) so the officer
// can send their day's activity to a manager or group.
//
// Data: get_daily_call_report(p_company_id, p_date, p_officer). Non-admins are
// forced to their own day server-side; admins may pick a date + officer.
// ═════════════════════════════════════════════════════════════════════════════

let _dcr = { date: null, officer: '', data: null };

function _dcrToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ─── Entry point ──────────────────────────────────────────────────────────── */
function rCallReport() {
  const pg = document.getElementById('pg-callreport');
  if (!pg) return;
  if (!_dcr.date) _dcr.date = _dcrToday();
  pg.innerHTML = NX.pageHeader('Daily Call Report') + '<div id="dcr-root"></div>';
  _dcrLoad();
}

/* ─── Load ─────────────────────────────────────────────────────────────────── */
async function _dcrLoad() {
  const root = document.getElementById('dcr-root');
  if (!root) return;
  root.innerHTML = NX.card('<div style="padding:22px;text-align:center;color:var(--fk-text-muted)">Loading call report…</div>', { compact: true });
  try {
    const { data, error } = await supabase.rpc('get_daily_call_report', {
      p_company_id: S.cid, p_date: _dcr.date, p_officer: _dcr.officer || null
    });
    if (error) throw error;
    if (data && data.error) {
      root.innerHTML = NX.card(NX.empty({
        icon: 'lock',
        message: data.error === 'auth_required' ? 'Your session expired — please sign in again.' : 'You are not permitted to view this report.'
      }));
      return;
    }
    _dcr.data = data || {};
    _dcrRender();
  } catch (e) {
    console.error('[callreport] load failed', e);
    root.innerHTML = NX.card(NX.empty({ icon: 'alert-triangle', message: 'Could not load the call report. ' + (e.message || '') }));
  }
}

/* ─── Filter setters ───────────────────────────────────────────────────────── */
function _dcrSetDate(v) { _dcr.date = v || _dcrToday(); _dcrLoad(); }
function _dcrSetOfficer(v) { _dcr.officer = v || ''; _dcrLoad(); }
function _dcrShiftDay(delta) {
  const d = new Date(_dcr.date + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  _dcr.date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  _dcrLoad();
}

/* ─── Render ───────────────────────────────────────────────────────────────── */
function _dcrRender() {
  const root = document.getElementById('dcr-root');
  const d = _dcr.data || {};
  const s = d.summary || {};
  const calls = Array.isArray(d.calls) ? d.calls : [];
  const isAdmin = !!d.is_admin;
  const officers = Array.isArray(d.officers) ? d.officers : [];
  const showOfficerCol = isAdmin && !_dcr.officer && officers.length > 1;

  // ── Filter / action bar ────────────────────────────────────────────────
  const officerSel = isAdmin
    ? '<div class="nx-field" style="margin:0;min-width:180px"><label class="nx-label">Officer</label>' +
        '<select class="nx-input" onchange="_dcrSetOfficer(this.value)">' +
          '<option value="">All officers</option>' +
          officers.map(o => '<option value="' + esc(o.username) + '"' + (o.username === _dcr.officer ? ' selected' : '') + '>' +
            esc(o.name) + ' · ' + (o.calls || 0) + '</option>').join('') +
        '</select></div>'
    : '';

  const filterBar = NX.card(
    '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
      '<div class="nx-field" style="margin:0"><label class="nx-label">Date</label>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          NX.button('‹', { variant: 'secondary', size: 'sm', onclick: '_dcrShiftDay(-1)' }) +
          '<input class="nx-input" type="date" style="width:170px" value="' + esc(_dcr.date) + '" onchange="_dcrSetDate(this.value)">' +
          NX.button('›', { variant: 'secondary', size: 'sm', onclick: '_dcrShiftDay(1)' }) +
        '</div></div>' +
      officerSel +
      '<div style="flex:1"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        NX.button('Copy', { variant: 'secondary', size: 'sm', onclick: '_dcrCopy()' }) +
        NX.button('Share on WhatsApp', { variant: 'primary', size: 'sm', onclick: '_dcrShareWA()' }) +
      '</div>' +
    '</div>', { compact: true });

  // ── Summary strip ───────────────────────────────────────────────────────
  function stat(lbl, val, tone) {
    return '<div style="flex:1;min-width:120px;padding:12px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius);background:var(--fk-surface)">' +
      '<div class="nx-kpi-label">' + lbl + '</div>' +
      '<div style="font-size:20px;font-weight:500;margin-top:2px' + (tone ? ';color:' + tone : '') + '">' + val + '</div></div>';
  }
  const summary = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:var(--fk-sp-3) 0">' +
    stat('Calls made', s.calls || 0) +
    stat('Connected', s.connected || 0) +
    stat('Clients', s.clients || 0) +
    stat('Promises', s.promises || 0, (s.promises > 0 ? 'var(--fk-success)' : '')) +
    stat('Promised', 'PKR ' + fM(s.promised_amount || 0), (s.promised_amount > 0 ? 'var(--fk-success)' : '')) +
    stat('Follow-ups', s.followups || 0) +
    '</div>';

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!calls.length) {
    root.innerHTML = filterBar + summary + NX.card(NX.empty({
      icon: 'phone-off',
      message: 'No calls logged on ' + fD(_dcr.date) + '.' + (isAdmin && !_dcr.officer ? '' : ' Log calls from the Recovery queue to see them here.')
    }));
    return;
  }

  // ── Call rows ───────────────────────────────────────────────────────────
  const rows = calls.map(c => {
    const contact = [c.channel, c.direction].filter(Boolean).map(esc).join(' · ') || '—';
    const promise = c.promise_to_pay
      ? '<span style="color:var(--fk-success)">PKR ' + fM(c.promise_amount || 0) + (c.promise_date ? '<br><span class="nx-kpi-label" style="text-transform:none">by ' + fD(c.promise_date) + '</span>' : '') + '</span>'
      : '<span style="color:var(--fk-text-muted)">—</span>';
    const next = c.next_followup_date
      ? '<span>' + fD(c.next_followup_date) + (c.next_followup_channel ? ' <span class="nx-kpi-label" style="text-transform:none">· ' + esc(c.next_followup_channel) + '</span>' : '') + '</span>'
      : '<span style="color:var(--fk-text-muted)">—</span>';
    const client = esc(c.client_name || '—') + (c.unit_no ? ' <span class="num" style="color:var(--fk-text-muted)">' + esc(c.unit_no) + '</span>' : '') +
      (c.phone ? '<br><span class="nx-kpi-label" style="text-transform:none">' + esc(c.phone) + '</span>' : '');
    return '<tr>' +
      '<td style="white-space:nowrap;color:var(--fk-text-muted)">' + esc(c.time || '—') + '</td>' +
      (showOfficerCol ? '<td>' + esc(c.officer_name || c.officer || '—') + '</td>' : '') +
      '<td>' + client + '</td>' +
      '<td>' + contact + '</td>' +
      '<td>' + esc(c.remarks || '—') + '</td>' +
      '<td class="num">' + promise + '</td>' +
      '<td>' + next + '</td>' +
    '</tr>';
  }).join('');

  const table = NX.card(
    '<table class="nx-table nx-table--flush"><thead><tr>' +
      '<th>Time</th>' + (showOfficerCol ? '<th>Officer</th>' : '') +
      '<th>Client</th><th>Contact</th><th>Remarks</th><th class="num">Promise</th><th>Next follow-up</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>', { flush: true });

  root.innerHTML = filterBar + summary + table;
}

/* ─── Shareable text ───────────────────────────────────────────────────────── */
function _dcrShareText() {
  const d = _dcr.data || {};
  const s = d.summary || {};
  const calls = Array.isArray(d.calls) ? d.calls : [];
  let t = '*Daily Call Report*\n';
  t += fD(d.date || _dcr.date) + '\n';
  if (d.officer_name) t += 'Officer: ' + d.officer_name + '\n';
  t += '------------------------------\n';
  t += 'Calls: ' + (s.calls || 0) + '   Connected: ' + (s.connected || 0) + '\n';
  t += 'Promises: ' + (s.promises || 0) + '   PKR ' + fM(s.promised_amount || 0) + '\n';
  t += 'Follow-ups scheduled: ' + (s.followups || 0) + '\n';
  t += '------------------------------\n';
  if (!calls.length) {
    t += 'No calls logged.\n';
  } else {
    calls.forEach((c, i) => {
      t += (i + 1) + '. ' + (c.client_name || '—') + (c.unit_no ? ' [' + c.unit_no + ']' : '') + '\n';
      const line2 = [c.time, c.channel, c.direction].filter(Boolean).join(' · ');
      if (line2) t += '   ' + line2 + '\n';
      if (c.remarks) t += '   Remarks: ' + c.remarks + '\n';
      if (c.promise_to_pay) t += '   Promise: PKR ' + fM(c.promise_amount || 0) + (c.promise_date ? ' by ' + fD(c.promise_date) : '') + '\n';
      if (c.next_followup_date) t += '   Next: ' + fD(c.next_followup_date) + '\n';
      t += '\n';
    });
  }
  t += '— Nexunova RMS';
  return t;
}

function _dcrCopy() {
  const txt = _dcrShareText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(
      () => toast('Report copied — paste it in WhatsApp or anywhere.', 'ok'),
      () => toast('Could not copy automatically — long-press to copy.', 'warn')
    );
  } else {
    toast('Copy not supported on this device.', 'warn');
  }
}

function _dcrShareWA() {
  // No specific number — opens WhatsApp's chooser so the officer picks the
  // manager / group to send their day to.
  if (typeof openWhatsApp === 'function') openWhatsApp('', _dcrShareText());
  else window.open('https://wa.me/?text=' + encodeURIComponent(_dcrShareText()), '_blank');
}
