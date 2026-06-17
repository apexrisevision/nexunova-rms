/* ════════════════════════════════════════════════════════════════════════
   Sales Access — admin manages light "sales person" logins (NOT app_users,
   no paid seat consumed). Availability & Reservation module.
   ONE flow: the admin shares the company signup link → a sales person
   self-registers (pending) → the admin Approves (sets project scope, the
   plan limit is enforced here) or Rejects → the person signs in with phone+PIN.
   RPCs: list_sales_users_admin, admin_approve_sales_user, admin_reject_sales_user,
         rotate_sales_signup_token, deactivate_sales_user.
   ════════════════════════════════════════════════════════════════════════ */
let _saRows = [];
let _saLimit = null;
let _saSignupToken = null;
let _saCompanyCode = null;

async function rSalesAccess() {
  const pg = document.getElementById('pg-salesaccess');
  if (!pg) return;
  const cid = S && S.cid;
  if (!cid) { nav('dashboard'); return; }

  pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6)">
    ${NX.pageHeader('Sales Access', '', { icon: 'id-card' })}
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
  _saLimit = res.limit || null;
  _saSignupToken = res.signup_token || null;
  _saCompanyCode = res.company_code || null;
  _saRender();
}

function _saAtCap() { return _saLimit && _saLimit.can_add === false; }
function _saUsageBadge() {
  if (!_saLimit) return '';
  const cur = _saLimit.current_count, max = _saLimit.max_allowed;
  const tone = _saAtCap() ? 'danger' : (max && cur >= max - 2 ? 'warning' : 'success');
  return NX.badge(`Sales access: ${cur} / ${max}`, tone);
}
function _saSignupUrl() {
  if (!_saSignupToken) return '';
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'sales-portal.html';
  return base + '?signup=' + encodeURIComponent(_saSignupToken);
}

function _saRender() {
  const pg = document.getElementById('pg-salesaccess');
  const header = NX.pageHeader('Sales Access',
    `<span>${_saUsageBadge()}</span>`, { icon: 'id-card' });
  const shell = pg && pg.querySelector('.nx');
  if (shell) { shell.innerHTML = header + `<div id="sa-body">${_saBodyHtml()}</div>`; return; }
  const body = document.getElementById('sa-body');
  if (body) body.innerHTML = _saBodyHtml();
}

function _saBodyHtml() {
  const pending = _saRows.filter(r => r.status === 'pending');
  const people = _saRows.filter(r => r.status !== 'pending');

  // ── 1. The ONE shareable signup link ──
  const url = _saSignupUrl();
  const linkCard = NX.card(
    `<div style="font-size:13px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-2)">This link is <strong>permanent</strong> — share it once with your sales team and it keeps working. They self-register, then appear below for your approval.</div>
     <div style="display:flex;gap:var(--fk-sp-2);align-items:center;flex-wrap:wrap">
       <input class="nx-input" readonly value="${esc(url)}" onclick="this.select()" style="flex:1;min-width:240px;font-size:12px">
       ${NX.button('Copy link', { variant: 'primary', size: 'sm', icon: 'link', onclick: '_saCopyLink()' })}
       ${NX.button('Rotate', { variant: 'ghost', size: 'sm', icon: 'refresh-cw', onclick: '_saRotate()' })}
     </div>
     <div style="font-size:11px;color:var(--fk-text-muted);margin-top:var(--fk-sp-2)">Only use <em>Rotate</em> if this link ever leaks — it replaces it with a new one and disables the old copies.</div>`,
    { header: { icon: 'link', tone: 'primary', title: 'Sales signup link' } });

  // ── 2. Pending registrations ──
  let pendingCard = '';
  if (pending.length) {
    const cap = _saAtCap()
      ? NX.banner(`You are at your plan limit (${_saLimit.current_count}/${_saLimit.max_allowed}). Deactivate an active sales person or upgrade before approving more.`, 'warn')
      : '';
    pendingCard = NX.card(cap + NX.table({
      cols: [{ label: 'Name' }, { label: 'Phone' }, { label: 'CNIC' }, { label: 'Requested' }, { label: '' }],
      rows: pending.map(r => [
        `<b>${esc(r.full_name)}</b>`,
        esc(r.phone),
        esc(r.cnic || '—'),
        esc(fdateRsv(r.created_at)),
        NX.button('Review & decide', { variant: 'primary', size: 'sm', icon: 'eye', onclick: `_saReviewOpen('${r.id}')` })
      ]),
      flush: true
    }), { header: { icon: 'user-plus', tone: 'warning', title: 'Pending registrations', sub: pending.length + ' awaiting approval' }, flush: true });
  }

  // ── 3. Approved sales people ──
  let peopleCard;
  if (!people.length) {
    peopleCard = NX.card(NX.empty({
      icon: 'id-card',
      message: 'No sales people yet. Share the signup link above — registrations will appear here for approval.'
    }));
  } else {
    peopleCard = NX.card(NX.table({
      cols: [{ label: 'Name' }, { label: 'Phone' }, { label: 'Project scope' }, { label: 'Active reservations', num: true }, { label: 'Last login' }, { label: 'Status' }, { label: '' }],
      rows: people.map(r => [
        `<b>${esc(r.full_name)}</b>` + (r.agent_code ? `<div style="font-size:11px;color:var(--fk-text-muted)">Agent ${esc(r.agent_code)}</div>` : ''),
        esc(r.phone),
        r.project_id ? esc(r.project_name || 'Assigned project') : '<span style="color:var(--fk-text-muted)">All projects</span>',
        `<span class="num">${r.active_reservations || 0}</span>`,
        r.last_login_at ? esc(fdateRsv(r.last_login_at)) : '<span style="color:var(--fk-text-muted)">Never</span>',
        r.status === 'active' ? NX.badge('Active', 'success', { dot: true }) : NX.badge('Inactive', 'muted'),
        (r.status === 'active'
          ? NX.button('Deactivate', { variant: 'secondary', size: 'sm', onclick: `_saDeactivate('${r.id}','${esc(r.full_name)}')` })
          : NX.button('Reactivate', { variant: 'secondary', size: 'sm', icon: 'rotate-ccw', onclick: `_saReactivate('${r.id}','${esc(r.full_name)}')` }))
        + ' ' + NX.button('Delete', { variant: 'danger-soft', size: 'sm', icon: 'trash-2', onclick: `_saDelete('${r.id}','${esc(r.full_name)}')` })
      ]),
      flush: true
    }), { header: { icon: 'users', tone: 'primary', title: 'Sales people' }, flush: true });
  }

  return linkCard + (pendingCard ? `<div style="margin-top:var(--fk-sp-3)">${pendingCard}</div>` : '') +
         `<div style="margin-top:var(--fk-sp-3)">${peopleCard}</div>`;
}

function _saCopyLink() {
  const url = _saSignupUrl();
  if (navigator.clipboard) navigator.clipboard.writeText(url);
  if (typeof toast === 'function') toast('Signup link copied', 'ok');
}

async function _saRotate() {
  if (!confirm('Rotate the signup link? The current link stops working immediately and you must reshare the new one.')) return;
  try {
    const { data } = await supabase.rpc('rotate_sales_signup_token', { p_company_id: S.cid });
    if (data && data.success) { if (typeof toast === 'function') toast('New signup link generated.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast('Could not rotate the link.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not rotate the link.', 'err'); }
}

// A KYC document thumbnail (click to open full size in a new tab).
function _saKycDoc(url, label) {
  if (url) return `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(label)} — click to enlarge"
    style="flex:1;min-width:0;text-decoration:none"><div style="height:74px;border-radius:8px;overflow:hidden;border:1px solid var(--fk-border);background:var(--fk-bg-subtle)"><img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover"></div>
    <div style="font-size:10.5px;color:var(--fk-text-muted);text-align:center;margin-top:3px">${esc(label)}</div></a>`;
  return `<div style="flex:1;min-width:0"><div style="height:74px;border-radius:8px;border:1px dashed var(--fk-border);display:grid;place-items:center;font-size:11px;color:var(--fk-text-muted)">Missing</div>
    <div style="font-size:10.5px;color:var(--fk-text-muted);text-align:center;margin-top:3px">${esc(label)}</div></div>`;
}

// Full application preview + decision — shows everything the registrant submitted,
// the KYC docs, the agent code that will be issued, then Approve / Reject.
function _saReviewOpen(id) {
  const r = (_saRows || []).find(x => x.id === id) || {};
  const projOpts = (typeof gprojects === 'function' ? gprojects() : [])
    .map(p => ({ value: p.id, label: p.name || p.projectName || p.project_name || 'Project' }));
  const initials = ((r.full_name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
  const avatar = r.profile_photo_url
    ? `<img src="${esc(r.profile_photo_url)}" style="width:100%;height:100%;object-fit:cover">`
    : esc(initials);
  const kyc = r.kyc_status || 'pending';
  const dash = '<span style="font-weight:400;color:var(--fk-text-muted)">—</span>';
  const fld = (label, val) => `<div><div class="nx-kpi-label" style="text-transform:none">${label}</div><div style="font-size:13.5px;font-weight:600;color:var(--fk-text);word-break:break-word">${val ? esc(val) : dash}</div></div>`;
  const yr = new Date().getFullYear();
  const payout = (r.bank_name || r.bank_account_no)
    ? `<div style="margin-top:var(--fk-sp-3)">${fld('Bank / payout', [r.bank_name, r.bank_account_no, r.bank_account_title].filter(Boolean).join(' · '))}</div>` : '';
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    id: 'sa-review-modal', title: 'Review registration', size: 'l', onClose: '_saCloseModal()',
    body:
      `<div style="display:flex;gap:14px;align-items:center;margin-bottom:var(--fk-sp-3)">
         <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;flex:none;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);display:grid;place-items:center;font-size:22px;font-weight:700;color:var(--fk-text-muted)">${avatar}</div>
         <div style="min-width:0">
           <div style="font-size:17px;font-weight:700;color:var(--fk-text)">${esc(r.full_name || '—')}</div>
           <div style="font-size:12px;color:var(--fk-text-muted);margin:2px 0 6px">Requested ${esc(fdateRsv(r.created_at))}</div>
           ${NX.badge('KYC ' + kyc, kyc === 'verified' ? 'success' : 'warning', { dot: true })}
         </div>
       </div>
       <div class="nx-grid-2" style="gap:var(--fk-sp-3) var(--fk-sp-4)">
         ${fld('Father / Husband name', r.father_name)}
         ${fld('Mobile', r.phone)}
         ${fld('CNIC', r.cnic)}
         ${fld('Email', r.email)}
       </div>
       <div style="margin-top:var(--fk-sp-3)">${fld('Address', r.address)}</div>
       ${payout}
       <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:var(--fk-sp-4) 0 var(--fk-sp-2)">Identity documents (KYC) — click to enlarge</div>
       <div style="display:flex;gap:8px">
         ${_saKycDoc(r.profile_photo_url, 'Photo')}${_saKycDoc(r.cnic_front_url, 'CNIC front')}${_saKycDoc(r.cnic_back_url, 'CNIC back')}
       </div>
       <div style="margin-top:var(--fk-sp-4);padding:10px 12px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-subtle);font-size:12.5px;color:var(--fk-text-muted)">
         On <b style="color:var(--fk-text)">Approve</b>, a Sale Agent profile is created (code <b style="color:var(--fk-text)">AGT-${yr}-####</b>), KYC is marked verified, and they can sign in &amp; reserve.
       </div>
       <div style="border-top:1px solid var(--fk-border);margin:var(--fk-sp-4) 0 var(--fk-sp-3)"></div>
       <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin-bottom:var(--fk-sp-2)">Approval</div>` +
      (projOpts.length
        ? NX.field({ label: 'Project (reserve scope &amp; agent home)', name: 'sa-approve-project', el: 'select', options: projOpts, value: projOpts[0].value })
        : `<div class="nx-error" style="display:block">No projects exist yet — create a project first, then approve.</div>`) +
      NX.field({ label: 'Commission %', name: 'sa-approve-comm', el: 'input', type: 'number', value: '2', attrs: 'min="0" max="100" step="0.01"' }) +
      `<div class="nx-error" id="sa-approve-err" style="display:none"></div>`,
    footer:
      NX.button('Reject', { variant: 'danger-soft', onclick: `_saReject('${id}','${esc(r.full_name || '')}')` }) +
      NX.button('Cancel', { variant: 'ghost', onclick: '_saCloseModal()' }) +
      (projOpts.length ? NX.button('Approve &amp; register agent', { variant: 'primary', onclick: `_saApproveSubmit('${id}')` }) : '')
  }));
}
function _saCloseModal() { document.querySelector('.nx-modal-overlay')?.remove(); }

async function _saApproveSubmit(id) {
  const proj = (document.getElementById('sa-approve-project') || {}).value || '';
  const commRaw = (document.getElementById('sa-approve-comm') || {}).value;
  const comm = commRaw === '' || commRaw == null ? 2 : parseFloat(commRaw);
  const err = document.getElementById('sa-approve-err');
  const showErr = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } };
  if (!proj) { showErr('Pick a project — it becomes their reserve scope and agent home project.'); return; }
  if (isNaN(comm) || comm < 0 || comm > 100) { showErr('Commission must be between 0 and 100.'); return; }
  try {
    const { data } = await supabase.rpc('admin_approve_sales_user', { p_id: id, p_project_id: proj, p_commission_percent: comm });
    if (!data || !data.success) {
      showErr((data && data.message) || 'Could not approve.');
      return;
    }
    _saCloseModal();
    if (typeof toast === 'function') toast('Approved — registered as Sale Agent ' + (data.agent_code || '') + '.', 'ok');
    rSalesAccess();
  } catch (e) {
    showErr('Could not approve.');
  }
}

async function _saReject(id, name) {
  if (!confirm('Reject ' + name + "'s request? Their registration is removed (they can request again later).")) return;
  _saCloseModal();
  try {
    const { data } = await supabase.rpc('admin_reject_sales_user', { p_id: id });
    if (data && data.success) { if (typeof toast === 'function') toast('Registration rejected.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast('Could not reject.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not reject.', 'err'); }
}

async function _saDelete(id, name) {
  if (!confirm('Delete ' + name + ' permanently? This removes their access for good and releases any active reservations they hold (those units return to Available).')) return;
  try {
    const { data } = await supabase.rpc('delete_sales_user', { p_id: id });
    if (data && data.success) { if (typeof toast === 'function') toast('Sales person deleted.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast((data && data.message) || 'Could not delete.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not delete.', 'err'); }
}

async function _saReactivate(id, name) {
  if (!confirm('Reactivate ' + name + '? They can sign in and reserve again (uses one sales-access slot).')) return;
  try {
    const { data } = await supabase.rpc('reactivate_sales_user', { p_id: id });
    if (data && data.success) { if (typeof toast === 'function') toast('Sales person reactivated.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast((data && data.message) || 'Could not reactivate.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not reactivate.', 'err'); }
}

async function _saDeactivate(id, name) {
  if (!confirm('Deactivate ' + name + '? Their access is revoked immediately (active reservations stay until you release them).')) return;
  try {
    const { data } = await supabase.rpc('deactivate_sales_user', { p_id: id });
    if (data && data.success) { if (typeof toast === 'function') toast('Sales access deactivated.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast('Could not deactivate.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not deactivate.', 'err'); }
}
