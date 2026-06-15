/* ════════════════════════════════════════════════════════════════════════
   Reservations — admin view of field reservations made by sales people.
   Phase 1 of the Availability & Reservation module. English only.
   RPCs: get_reservations_admin, admin_cancel_reservation.
   Convert reservation → sale is ADMIN-only and lands in Phase 2; here the
   admin just sees every reservation (who reserved, client, token, expiry).
   ════════════════════════════════════════════════════════════════════════ */
let _rsvRows = [];
let _rsvStatus = 'active';

function _rsvCountdown(expiry) {
  if (!expiry) return { label: '—', tone: 'muted' };
  const ms = new Date(expiry) - new Date();
  if (ms <= 0) return { label: 'Expired', tone: 'danger' };
  const h = Math.floor(ms / 3.6e6);
  if (h < 24) return { label: h + 'h left', tone: 'warning' };
  return { label: Math.floor(h / 24) + 'd left', tone: 'success' };
}

async function rReservations() {
  const pg = document.getElementById('pg-reservations');
  if (!pg) return;
  const cid = S && S.cid;
  if (!cid) { nav('dashboard'); return; }

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">
    ${NX.pageHeader('Reservations', '', { icon: 'bookmark-check' })}
    <div id="rsv-body">${NX.card(NX.empty({ icon: 'loader', message: 'Loading reservations…' }))}</div>
  </div>`;

  let res = null;
  try {
    const { data } = await supabase.rpc('get_reservations_admin',
      { p_company_id: cid, p_project_id: null, p_status: 'all' });
    res = data;
  } catch (e) { res = null; }

  if (!res || !res.success) {
    document.getElementById('rsv-body').innerHTML =
      NX.card(NX.banner('Could not load reservations. Please retry.', 'warn'));
    return;
  }
  _rsvRows = res.reservations || [];
  _rsvRender();
}

function _rsvRender() {
  const body = document.getElementById('rsv-body');
  if (!body) return;
  const all = _rsvRows;
  const active = all.filter(r => r.status === 'active');
  const expToday = active.filter(r => {
    const ms = new Date(r.expiry_date) - new Date();
    return ms > 0 && ms < 24 * 3.6e6;
  });
  const converted = all.filter(r => r.status === 'converted');
  const expired = all.filter(r => r.status === 'expired');

  const kpis = `<div class="nx-kpi-row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--fk-sp-3);margin-bottom:var(--fk-sp-4)">
    ${NX.kpi({ label: 'Active', value: String(active.length), icon: 'bookmark-check', tone: 'primary' })}
    ${NX.kpi({ label: 'Expiring today', value: String(expToday.length), icon: 'clock', tone: 'warning' })}
    ${NX.kpi({ label: 'Converted', value: String(converted.length), icon: 'check-circle', tone: 'success' })}
    ${NX.kpi({ label: 'Expired', value: String(expired.length), icon: 'x-circle', tone: 'muted' })}
  </div>`;

  const tabs = NX.tabs({
    tabs: [
      { k: 'active', label: 'Active', count: active.length, icon: 'bookmark-check' },
      { k: 'all', label: 'All', count: all.length, icon: 'list' },
    ],
    active: _rsvStatus, onSelect: "_rsvSetStatus('%k')", fill: false
  });

  const rows = (_rsvStatus === 'active' ? active : all);
  let tableHtml;
  if (!rows.length) {
    tableHtml = NX.empty({
      icon: 'bookmark',
      message: _rsvStatus === 'active'
        ? 'No active reservations. When a sales person reserves a unit in the field, it appears here live.'
        : 'No reservations yet.'
    });
  } else {
    tableHtml = NX.table({
      cols: [
        { label: 'Unit' }, { label: 'Project' }, { label: 'Reserved by' },
        { label: 'Client' }, { label: 'Token', num: true }, { label: 'Expiry' },
        { label: 'Status' }, { label: '' }
      ],
      rows: rows.map(r => {
        const cd = _rsvCountdown(r.expiry_date);
        const stTone = { active: 'primary', converted: 'success', cancelled: 'muted', expired: 'danger' }[r.status] || 'muted';
        const token = r.token_received
          ? `<span class="num">${esc(pkrFmt(r.token_amount))}</span>`
          : '<span style="color:var(--fk-text-muted)">—</span>';
        const expiry = r.status === 'active'
          ? `${NX.badge(cd.label, cd.tone)}`
          : `<span style="color:var(--fk-text-muted)">${esc(fdateRsv(r.expiry_date))}</span>`;
        const action = r.status === 'active'
          ? NX.button('Release', { variant: 'danger-soft', size: 'sm', onclick: `_rsvCancel('${r.id}')` })
          : '';
        return [
          `<b>${esc(r.unit_no || '—')}</b>`,
          esc(r.project_name || '—'),
          esc(r.reserved_by_name || '—'),
          `${esc(r.client_name || '—')}${r.client_phone ? `<div style="font-size:11px;color:var(--fk-text-muted)">${esc(r.client_phone)}</div>` : ''}`,
          token, expiry,
          NX.badge(r.status.charAt(0).toUpperCase() + r.status.slice(1), stTone),
          action
        ];
      }),
      flush: true
    });
  }

  body.innerHTML = kpis + tabs +
    `<div style="margin-top:var(--fk-sp-3)">${NX.card(tableHtml, { flush: true })}</div>`;
  if (typeof NX.animateCounts === 'function') NX.animateCounts(body);
}

function pkrFmt(n) { return 'PKR ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fdateRsv(d) { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }

function _rsvSetStatus(s) { _rsvStatus = s; _rsvRender(); }

async function _rsvCancel(id) {
  if (!confirm('Release this reservation? The unit returns to Available immediately.')) return;
  try {
    const { data } = await supabase.rpc('admin_cancel_reservation', { p_reservation_id: id });
    if (data && data.success) {
      if (typeof toast === 'function') toast('Reservation released — unit is Available again.', 'ok');
      rReservations();
    } else {
      if (typeof toast === 'function') toast('Could not release: ' + ((data && data.error) || 'error'), 'err');
    }
  } catch (e) {
    if (typeof toast === 'function') toast('Could not release the reservation.', 'err');
  }
}
