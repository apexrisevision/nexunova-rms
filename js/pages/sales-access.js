/* ════════════════════════════════════════════════════════════════════════
   Sales Access — admin manages light "sales person" logins (NOT app_users,
   no paid seat consumed). Phase 1 of the Availability & Reservation module.
   RPCs: list_sales_users_admin, create_sales_user, deactivate_sales_user.
   A sales person reserves only in their assigned project (Decision A) and
   logs into the standalone sales-portal.html — never the RMS shell.
   The per-plan limit (15/25/50) is wired in Phase 3.
   ════════════════════════════════════════════════════════════════════════ */
let _saRows = [];

async function rSalesAccess() {
  const pg = document.getElementById('pg-salesaccess');
  if (!pg) return;
  const cid = S && S.cid;
  if (!cid) { nav('dashboard'); return; }

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">
    ${NX.pageHeader('Sales Access', NX.button('Add sales person', { variant: 'primary', icon: 'user-plus', onclick: '_saOpenAdd()' }), { icon: 'id-card' })}
    <div id="sa-body">${NX.card(NX.empty({ icon: 'loader', message: 'Loading…' }))}</div>
  </div>`;

  let res = null;
  try {
    const { data } = await supabase.rpc('list_sales_users_admin', { p_company_id: cid });
    res = data;
  } catch (e) { res = null; }

  if (!res || !res.success) {
    document.getElementById('sa-body').innerHTML = NX.card(NX.banner('Could not load sales access list.', 'warn'));
    return;
  }
  _saRows = res.sales_users || [];
  _saRender();
}

function _saRender() {
  const body = document.getElementById('sa-body');
  if (!body) return;
  const rows = _saRows;
  const activeN = rows.filter(r => r.is_active).length;

  const intro = NX.banner('Sales people log in to the field app (the Availability Board) — they are not RMS users and use no paid user seat.', 'info');

  let table;
  if (!rows.length) {
    table = NX.empty({
      icon: 'id-card',
      message: 'No sales people yet. Add one to give them field access to the Availability Board and reservations.',
      action: NX.button('Add sales person', { variant: 'primary', icon: 'user-plus', onclick: '_saOpenAdd()' })
    });
  } else {
    table = NX.table({
      cols: [{ label: 'Name' }, { label: 'Phone' }, { label: 'Project scope' }, { label: 'Active reservations', num: true }, { label: 'Last login' }, { label: 'Status' }, { label: '' }],
      rows: rows.map(r => [
        `<b>${esc(r.full_name)}</b>`,
        esc(r.phone),
        r.project_id ? esc(r.project_name || 'Assigned project') : '<span style="color:var(--fk-text-muted)">All projects</span>',
        `<span class="num">${r.active_reservations || 0}</span>`,
        r.last_login_at ? esc(fdateRsv(r.last_login_at)) : '<span style="color:var(--fk-text-muted)">Never</span>',
        r.is_active ? NX.badge('Active', 'success', { dot: true }) : NX.badge('Inactive', 'muted'),
        r.is_active ? NX.button('Deactivate', { variant: 'danger-soft', size: 'sm', onclick: `_saDeactivate('${r.id}','${esc(r.full_name)}')` }) : ''
      ]),
      flush: true
    });
  }
  body.innerHTML = `<div style="margin-bottom:var(--fk-sp-3)">${intro}</div>` + NX.card(table, { flush: true });
}

function _saOpenAdd() {
  const projOpts = [{ value: '', label: 'All projects' }]
    .concat((typeof gprojects === 'function' ? gprojects() : []).map(p => ({ value: p.id, label: p.project_name })));
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    title: 'Add sales person', size: 'm', onClose: '_saCloseModal()',
    body:
      NX.field({ label: 'Full name', name: 'sa-name', required: true }) +
      NX.field({ label: 'Phone (login handle)', name: 'sa-phone', required: true }) +
      NX.field({ label: 'Project scope', name: 'sa-project', el: 'select', options: projOpts, value: projOpts[1] ? projOpts[1].value : '' }) +
      `<div class="nx-error" id="sa-err" style="display:none"></div>`,
    footer: NX.button('Cancel', { variant: 'ghost', onclick: '_saCloseModal()' }) +
            NX.button('Create access', { variant: 'primary', onclick: '_saSubmit()' })
  }));
}
function _saCloseModal() { document.querySelector('.nx-modal-overlay')?.remove(); }

async function _saSubmit() {
  const cid = S && S.cid;
  const name = (document.getElementById('sa-name') || {}).value || '';
  const phone = (document.getElementById('sa-phone') || {}).value || '';
  const proj = (document.getElementById('sa-project') || {}).value || '';
  const err = document.getElementById('sa-err');
  if (!name.trim() || !phone.trim()) {
    if (err) { err.textContent = 'Name and phone are required.'; err.style.display = 'block'; }
    return;
  }
  try {
    const { data } = await supabase.rpc('create_sales_user',
      { p_company_id: cid, p_project_id: proj || null, p_name: name.trim(), p_phone: phone.trim() });
    if (!data || !data.success) {
      if (err) { err.textContent = 'Could not create: ' + ((data && data.error) || 'error'); err.style.display = 'block'; }
      return;
    }
    _saCloseModal();
    _saShowCredentials(name.trim(), phone.trim(), data);
    rSalesAccess();
  } catch (e) {
    if (err) { err.textContent = 'Could not create the sales person.'; err.style.display = 'block'; }
  }
}

function _saShowCredentials(name, phone, data) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'sales-portal.html';
  const magic = base + '?t=' + encodeURIComponent(data.temp_token);
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    title: 'Access created for ' + esc(name), size: 'm', onClose: '_saCloseModal()',
    body:
      NX.banner('Share these with the sales person. The PIN is shown once — copy it now.', 'warn') +
      `<div class="nx-card nx-card--compact" style="margin-top:var(--fk-sp-3)">
        <div style="display:grid;gap:var(--fk-sp-2);font-size:13px">
          <div><span style="color:var(--fk-text-muted)">Company code</span><br><b class="num">${esc(data.company_code || '')}</b></div>
          <div><span style="color:var(--fk-text-muted)">Phone</span><br><b class="num">${esc(phone)}</b></div>
          <div><span style="color:var(--fk-text-muted)">Temporary PIN</span><br><b class="num" style="font-size:18px;letter-spacing:2px">${esc(data.temp_pin || '')}</b></div>
          <div><span style="color:var(--fk-text-muted)">Magic link (no PIN needed)</span><br>
            <input class="nx-input" readonly value="${esc(magic)}" onclick="this.select()" style="font-size:12px"></div>
        </div>
      </div>`,
    footer: NX.button('Copy link', { variant: 'secondary', onclick: `navigator.clipboard&&navigator.clipboard.writeText('${magic}');typeof toast==='function'&&toast('Link copied','ok')` }) +
            NX.button('Done', { variant: 'primary', onclick: '_saCloseModal()' })
  }));
}

async function _saDeactivate(id, name) {
  if (!confirm('Deactivate ' + name + '? Their access is revoked immediately (active reservations stay until you release them).')) return;
  try {
    const { data } = await supabase.rpc('deactivate_sales_user', { p_id: id });
    if (data && data.success) { if (typeof toast === 'function') toast('Sales access deactivated.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast('Could not deactivate.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not deactivate.', 'err'); }
}
