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
let _saUmbrella = null;
let _saAnns = [];
let _saAnnIsHome = false;
let _saPool = [];   // unassigned leads (owner NULL) — orphan pool
let _saNotify = null;   // company CRM notification master switches

// ── Portal role taxonomy (Phase 0: data/tagging only; gated behaviour later) ──
const _SA_ROLE_LABELS = { sale_rep: 'Sale Representative', marketing_manager: 'Marketing Manager', admin: 'Admin', cfo: 'CFO', director: 'Director', lead_entry: 'Lead Entry' };
const _SA_ROLE_TONE = { sale_rep: 'muted', marketing_manager: 'primary', admin: 'warning', cfo: 'success', director: 'primary', lead_entry: 'info' };
function _saRoleLabel(r) { return _SA_ROLE_LABELS[r] || 'Sale Representative'; }
function _saRoleOptions() { return Object.keys(_SA_ROLE_LABELS).map(v => ({ value: v, label: _SA_ROLE_LABELS[v] })); }
// NX.field HTML-escapes its label, so styled "· hint" markup shows as raw text.
// _saFieldH renders the label as the intended HTML (admin-app local; kit untouched).
function _saFieldH(htmlLabel, opts) {
  opts = Object.assign({}, opts || {}); opts.label = '';
  var f = NX.field(opts);
  var lbl = '<label class="nx-label"' + (opts.name ? ' for="' + esc(opts.name) + '"' : '') + '>' + htmlLabel + '</label>';
  return f.replace('<div class="nx-field">', '<div class="nx-field">' + lbl);
}
function _saRoleField(name, value) {
  return _saFieldH('Portal role <span style="font-weight:400;text-transform:none;color:var(--fk-text-muted)">· what this member logs in as</span>',
    { name: name, el: 'select', options: _saRoleOptions(), value: value || 'sale_rep' });
}

// ── Online Portal: one tab housing all self-module admin as sub-tabs ──
// (reuses the existing page render fns; each draws into its own #pg-* pane.)
const _OP_TABS = [
  { id: 'salesaccess',     lb: 'Portal Access',       fn: 'rSalesAccess' },
  { id: 'salesubmissions', lb: 'Booking Submissions', fn: 'rSaleSubmissions' },
  { id: 'reservations',    lb: 'Reservations',        fn: 'rReservations' },
  { id: 'dealeragreement', lb: 'Dealer Agreement',    fn: 'rDealerAgreement' },
];
let _opActive = 'salesaccess';
function rOnlinePortal(sub) {
  sub = (typeof sub === 'string' ? sub : null) || window._opPendingSub || _opActive;
  window._opPendingSub = null;
  if (_OP_TABS.some(t => t.id === sub)) _opActive = sub;
  const nav = document.getElementById('op-subnav');
  if (nav) {
    nav.innerHTML = '<div style="display:flex;gap:6px;overflow-x:auto;padding:14px var(--fk-sp-6) 0">'
      + _OP_TABS.map(t => {
        const on = t.id === _opActive;
        return `<button onclick="rOnlinePortal('${t.id}')" style="flex:0 0 auto;border:1px solid var(--fk-border);background:${on ? 'var(--fk-primary)' : 'transparent'};color:${on ? '#fff' : 'var(--fk-text)'};border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">${esc(t.lb)}</button>`;
      }).join('') + '</div>';
  }
  _OP_TABS.forEach(t => { const el = document.getElementById('pg-' + t.id); if (el) el.style.display = (t.id === _opActive ? '' : 'none'); });
  const active = _OP_TABS.find(t => t.id === _opActive);
  if (active && typeof window[active.fn] === 'function') window[active.fn]();
}

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
  _saUmbrella = res.umbrella || null;

  try {
    const { data: ad } = await supabase.rpc('list_sales_announcements_admin', { p_company_id: cid });
    if (ad && ad.success) { _saAnns = ad.announcements || []; _saAnnIsHome = !!ad.is_group_home; }
    else { _saAnns = []; _saAnnIsHome = false; }
  } catch (e) { _saAnns = []; _saAnnIsHome = false; }

  try {
    const { data: up } = await supabase.rpc('list_unassigned_leads', { p_company_id: cid });
    _saPool = (up && up.success) ? (up.leads || []) : [];
  } catch (e) { _saPool = []; }

  try {
    const { data: nf } = await supabase.rpc('admin_get_crm_notify');
    _saNotify = (nf && nf.success) ? nf : null;
  } catch (e) { _saNotify = null; }

  _saRender();
}

function _saAtCap() { return _saLimit && _saLimit.can_add === false; }
function _saUsageBadge() {
  if (!_saLimit) return '';
  const cur = _saLimit.current_count, max = _saLimit.max_allowed;
  const tone = _saAtCap() ? 'danger' : (max && cur >= max - 2 ? 'warning' : 'success');
  return NX.badge(`Sales access: ${cur} / ${max}`, tone);
}
function _saPortalBase() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'sales-portal.html'; }
function _saSignupUrl() {
  // Primary link: in an umbrella, the group link (sells across all members); else the company link.
  const tok = (_saUmbrella && _saUmbrella.signup_token) ? _saUmbrella.signup_token : _saSignupToken;
  return tok ? _saPortalBase() + '?signup=' + encodeURIComponent(tok) : '';
}
function _saCompanyUrl() {  // this-company-only link (single project)
  return _saSignupToken ? _saPortalBase() + '?signup=' + encodeURIComponent(_saSignupToken) : '';
}
function _saCopyCompanyLink() {
  const u = _saCompanyUrl(); if (navigator.clipboard) navigator.clipboard.writeText(u);
  if (typeof toast === 'function') toast('Single-project link copied', 'ok');
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

  // ── 1. The ONE shareable signup link (umbrella-aware) ──
  const url = _saSignupUrl();
  const umb = _saUmbrella;
  const isHome = !umb || umb.is_home;
  const desc = umb
    ? `One link for the whole <strong>${esc(umb.group_name)}</strong> umbrella — a dealer who signs up here can sell units across <strong>all member companies</strong> (${esc(umb.members || '')}). They are approved in <strong>${esc(umb.home_company_name)}</strong>.`
    : `This link is <strong>permanent</strong> — share it once with your sales team and it keeps working. They self-register, then appear below for your approval.`;
  const homeNote = (umb && !isHome)
    ? NX.banner(`Sub-dealers for this umbrella are approved in <strong>${esc(umb.home_company_name)}</strong> — open <em>Online Portal → Portal Access</em> there to review &amp; approve. (This page only shows dealers homed to this company.)`, 'info')
    : '';
  const linkCard = NX.card(
    homeNote +
    `<div style="font-size:13px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-2)">${desc}</div>
     <div style="display:flex;gap:var(--fk-sp-2);align-items:center;flex-wrap:wrap">
       <input class="nx-input" readonly value="${esc(url)}" onclick="this.select()" style="flex:1;min-width:240px;font-size:12px">
       ${NX.button('Copy link', { variant: 'primary', size: 'sm', icon: 'link', onclick: '_saCopyLink()' })}
       ${umb ? '' : NX.button('Rotate', { variant: 'ghost', size: 'sm', icon: 'refresh-cw', onclick: '_saRotate()' })}
     </div>
     ${umb ? '' : `<div style="font-size:11px;color:var(--fk-text-muted);margin-top:var(--fk-sp-2)">Only use <em>Rotate</em> if this link ever leaks — it replaces it with a new one and disables the old copies.</div>`}
     ${umb ? `<div style="margin-top:14px;border-top:1px dashed var(--fk-border);padding-top:12px">
       <div style="font-size:12.5px;color:var(--fk-text-muted);margin-bottom:6px"><strong>Single-project link</strong> — a dealer who signs up with this one sells <strong>only this company's project</strong> (not the whole umbrella). Use it for project-specific dealers.</div>
       <div style="display:flex;gap:var(--fk-sp-2);align-items:center;flex-wrap:wrap">
         <input class="nx-input" readonly value="${esc(_saCompanyUrl())}" onclick="this.select()" style="flex:1;min-width:240px;font-size:12px">
         ${NX.button('Copy', { variant: 'secondary', size: 'sm', icon: 'link', onclick: '_saCopyCompanyLink()' })}
       </div></div>` : ''}`,
    { header: { icon: 'link', tone: 'primary', title: umb ? 'Umbrella signup link' : 'Sales signup link' } });

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
      cols: [{ label: 'Name' }, { label: 'Phone' }, { label: 'Email' }, { label: 'Role' }, { label: 'Project scope' }, { label: 'Active reservations', num: true }, { label: 'Last login' }, { label: 'Status' }, { label: '' }],
      rows: people.map(r => [
        `<b>${esc(r.full_name)}</b>` + (r.agent_code ? `<div style="font-size:11px;color:var(--fk-text-muted)">Agent ${esc(r.agent_code)}</div>` : ''),
        esc(r.phone),
        (r.email_verified ? NX.badge('Verified', 'success', { dot: true }) : (r.email ? NX.badge('Unverified', 'warning') : NX.badge('No email', 'muted')))
          + (r.email ? `<div style="font-size:11px;color:var(--fk-text-muted);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.email)}</div>` : ''),
        NX.badge(_saRoleLabel(r.role), _SA_ROLE_TONE[r.role] || 'muted')
          + (r.parent_name ? `<div style="font-size:11px;color:var(--fk-text-muted)">under ${esc(r.parent_name)}</div>` : ''),
        r.project_id ? esc(r.project_name || 'Assigned project') : '<span style="color:var(--fk-text-muted)">All projects</span>',
        `<span class="num">${r.active_reservations || 0}</span>`,
        r.last_login_at ? esc(fdateRsv(r.last_login_at)) : '<span style="color:var(--fk-text-muted)">Never</span>',
        r.status === 'active' ? NX.badge('Active', 'success', { dot: true }) : NX.badge('Inactive', 'muted'),
        NX.button('Role', { variant: 'ghost', size: 'sm', icon: 'shield', onclick: `_saRoleOpen('${r.id}')` })
        + ' ' + NX.button('Documents', { variant: 'ghost', size: 'sm', icon: 'file-text', onclick: `_saDocsOpen('${r.id}')` })
        + ' ' + (r.status === 'active'
          ? NX.button('Deactivate', { variant: 'secondary', size: 'sm', onclick: `_saDeactivate('${r.id}','${esc(r.full_name)}')` })
          : NX.button('Reactivate', { variant: 'secondary', size: 'sm', icon: 'rotate-ccw', onclick: `_saReactivate('${r.id}','${esc(r.full_name)}')` }))
        + ' ' + NX.button('Delete', { variant: 'danger-soft', size: 'sm', icon: 'trash-2', onclick: `_saDelete('${r.id}','${esc(r.full_name)}')` })
      ]),
      flush: true
    }), { header: { icon: 'users', tone: 'primary', title: 'Sales people' }, flush: true });
  }

  return linkCard + (pendingCard ? `<div style="margin-top:var(--fk-sp-3)">${pendingCard}</div>` : '') +
         `<div style="margin-top:var(--fk-sp-3)">${peopleCard}</div>` +
         _saPoolCardHtml() +
         _saNotifyCardHtml() +
         `<div style="margin-top:var(--fk-sp-3)">${_saAnnCardHtml()}</div>`;
}

// ── Company-level CRM notification master switches (per channel) ──
function _saNotifyCardHtml() {
  if (!_saNotify) return '';
  const sw = (id, label, desc, on) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--fk-border)">
       <div style="min-width:0"><div style="font-size:13px;font-weight:600;color:var(--fk-text)">${label}</div><div style="font-size:12px;color:var(--fk-text-muted)">${desc}</div></div>
       <input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="width:18px;height:18px;flex:0 0 auto;accent-color:var(--fk-primary);cursor:pointer" onchange="_saSaveNotify()"></div>`;
  const card = NX.card(
    `<div style="font-size:13px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-2)">Company-wide switches for CRM follow-up &amp; lead reminders. Turning one off stops that channel for every member (members can also opt out individually).</div>`
    + sw('sa-ntf-wa', 'WhatsApp reminders', 'Follow-up reminders via WhatsApp', _saNotify.whatsapp)
    + sw('sa-ntf-push', 'Push notifications', 'New-lead &amp; follow-up push alerts', _saNotify.push),
    { header: { icon: 'bell', tone: 'primary', title: 'CRM notifications' } });
  return `<div style="margin-top:var(--fk-sp-3)">${card}</div>`;
}
async function _saSaveNotify() {
  const wa = !!(document.getElementById('sa-ntf-wa') || {}).checked;
  const pu = !!(document.getElementById('sa-ntf-push') || {}).checked;
  try {
    const { data } = await supabase.rpc('admin_set_crm_notify', { p_whatsapp: wa, p_push: pu });
    if (data && data.success) { _saNotify = { success: true, whatsapp: wa, push: pu }; if (typeof toast === 'function') toast('CRM notification settings saved.', 'ok'); }
    else if (typeof toast === 'function') toast((data && data.message) || 'Could not save.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not save.', 'err'); }
}

// ── Unassigned pool: owner-less leads (member deactivated/deleted) → bulk reassign ──
function _saActiveMemberOpts(excludeId) {
  return (_saRows || []).filter(x => x.status === 'active' && x.id !== excludeId)
    .map(x => ({ value: x.id, label: (x.full_name || '?') + (x.role ? ' (' + _saRoleLabel(x.role) + ')' : '') }));
}
function _saPoolCardHtml() {
  const pool = _saPool || [];
  if (!pool.length) return '';
  const opts = _saActiveMemberOpts(null);
  const sel = '<select id="sa-pool-target" class="nx-input" style="max-width:260px">'
    + '<option value="">Choose a member…</option>'
    + opts.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('') + '</select>';
  const card = NX.card(
    `<div style="font-size:13px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-2)">These leads have no owner — their member was deactivated or deleted. Select rows and reassign them to an active member.</div>`
    + `<div style="display:flex;gap:var(--fk-sp-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--fk-sp-2)">${sel}${NX.button('Reassign selected', { variant: 'primary', size: 'sm', icon: 'user-check', onclick: '_saPoolReassign()' })}<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--fk-text-muted);cursor:pointer"><input type="checkbox" onclick="_saPoolToggleAll(this)"> Select all</label></div>`
    + NX.table({
      cols: [{ label: '' }, { label: 'Name' }, { label: 'Phone' }, { label: 'Status' }, { label: 'Source' }, { label: 'Added' }],
      rows: pool.map(l => [
        `<input type="checkbox" class="sa-pool-cb" value="${esc(l.id)}">`,
        `<b>${esc(l.name || '—')}</b>`,
        esc(l.phone || '—'),
        NX.badge(esc(l.status || '—'), 'muted'),
        esc(l.source || '—'),
        esc(fdateRsv(l.created_at))
      ]),
      flush: true
    }),
    { header: { icon: 'inbox', tone: 'warning', title: 'Unassigned leads', sub: pool.length + ' with no owner' }, flush: true });
  return `<div style="margin-top:var(--fk-sp-3)">${card}</div>`;
}
function _saPoolToggleAll(cb) { document.querySelectorAll('.sa-pool-cb').forEach(x => { x.checked = cb.checked; }); }
async function _saPoolReassign() {
  const to = (document.getElementById('sa-pool-target') || {}).value || null;
  if (!to) { if (typeof toast === 'function') toast('Choose a member to receive the leads.', 'err'); return; }
  const ids = [...document.querySelectorAll('.sa-pool-cb:checked')].map(x => x.value);
  if (!ids.length) { if (typeof toast === 'function') toast('Select at least one lead.', 'err'); return; }
  try {
    const { data } = await supabase.rpc('admin_reassign_leads', { p_lead_ids: ids, p_to: to });
    if (data && data.success) { if (typeof toast === 'function') toast('Reassigned ' + (data.reassigned || 0) + ' lead(s) to ' + (data.target_name || 'member') + '.', 'ok'); rSalesAccess(); }
    else if (typeof toast === 'function') toast((data && data.message) || 'Could not reassign.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not reassign.', 'err'); }
}

// ── Dealer Updates: admin posts dated notices (rate revisions etc.) that land in
//    every sub-dealer's portal "Updates" inbox as a permanent record. ──
function _saAnnCardHtml() {
  const reach = _saUmbrella
    ? (_saAnnIsHome
        ? `Posts here reach <strong>all umbrella sub-dealers</strong> across ${esc(_saUmbrella.members || 'all member companies')}.`
        : `Posts here reach only <strong>your company's</strong> sub-dealers. Umbrella-wide updates are posted from <strong>${esc(_saUmbrella.home_company_name)}</strong>.`)
    : `Posts here reach <strong>all your sub-dealers</strong> in their portal.`;
  const compose = NX.button('New update', { variant: 'primary', size: 'sm', icon: 'plus', onclick: '_saAnnOpen()' });

  let inner;
  if (!_saAnns.length) {
    inner = NX.empty({ icon: 'megaphone', message: 'No updates posted yet. Use “New update” to send a notice (e.g. a rate revision) to your sub-dealers — it stays in their inbox as a dated record.' });
  } else {
    inner = NX.table({
      cols: [{ label: 'Date' }, { label: 'Title' }, { label: 'Reach' }, { label: '' }],
      rows: _saAnns.map(a => [
        esc(fdateRsv(a.created_at)),
        `<b>${esc(a.title)}</b>${a.is_important ? ' ' + NX.badge('Important', 'warning') : ''}`
          + ((a.attachments && a.attachments.length) ? ` <span style="font-size:11px;color:var(--fk-text-muted)">📎 ${a.attachments.length}</span>` : '')
          + `<div style="font-size:11.5px;color:var(--fk-text-muted);max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.body)}</div>`,
        a.group_id ? NX.badge('Umbrella-wide', 'primary') : NX.badge('This company', 'muted'),
        NX.button('Edit', { variant: 'ghost', size: 'sm', icon: 'pencil', onclick: `_saAnnOpen('${a.id}')` })
          + ' ' + NX.button('Delete', { variant: 'danger-soft', size: 'sm', icon: 'trash-2', onclick: `_saAnnDelete('${a.id}')` })
      ]),
      flush: true
    });
  }
  return NX.card(
    `<div style="font-size:12.5px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-2)">${reach} Sub-dealers can read these but cannot delete them.</div>` + inner,
    { header: { icon: 'megaphone', tone: 'primary', title: 'Dealer Updates', sub: _saAnns.length ? _saAnns.length + ' posted' : '', actions: compose }, flush: true });
}

let _saAnnFiles = [];   // [{url,name,type}] attachments being composed
function _saAnnOpen(id) {
  const a = id ? (_saAnns.find(x => x.id === id) || {}) : {};
  _saAnnFiles = Array.isArray(a.attachments) ? a.attachments.slice() : [];
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    id: 'sa-ann-modal', title: id ? 'Edit update' : 'New update', size: 'm', onClose: '_saCloseModal()',
    body:
      NX.field({ label: 'Title', name: 'ann-title', el: 'input', value: a.title || '', attrs: 'placeholder="e.g. Rate revision — June 2026" maxlength="160"' })
      + NX.field({ label: 'Message', name: 'ann-body', el: 'textarea', value: a.body || '', attrs: 'rows="6" placeholder="Write the notice your sub-dealers should see…"' })
      + `<div class="nx-field"><label class="nx-label">Attachments <span style="font-weight:400;text-transform:none;color:var(--fk-text-muted)">· images or PDF, optional</span></label>
           <div id="ann-attach-prev" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"></div>
           <input type="file" id="ann-attach-file" accept="image/*,application/pdf" multiple style="display:none" onchange="_saAnnPick(this)">
           ${NX.button('Attach files', { variant: 'secondary', size: 'sm', icon: 'image', onclick: "document.getElementById('ann-attach-file').click()" })}
         </div>`
      + `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:var(--fk-sp-2);cursor:pointer"><input type="checkbox" id="ann-important"${a.is_important ? ' checked' : ''}> Mark as <b>important</b> (highlighted on the dealer's home)</label>`
      + `<div class="nx-error" id="ann-err" style="display:none"></div>`,
    footer:
      NX.button('Cancel', { variant: 'ghost', onclick: '_saCloseModal()' })
      + NX.button(id ? 'Save changes' : 'Post update', { variant: 'primary', onclick: `_saAnnSave(${id ? `'${id}'` : ''})` })
  }));
  _saAnnRenderAttach();
}

function _saAnnRenderAttach() {
  const box = document.getElementById('ann-attach-prev'); if (!box) return;
  if (!_saAnnFiles.length) { box.innerHTML = ''; return; }
  box.innerHTML = _saAnnFiles.map((f, i) => {
    const isImg = (f.type || '').startsWith('image/');
    const thumb = isImg
      ? `<img src="${esc(f.url)}" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="display:grid;place-items:center;height:100%;font-size:10px;font-weight:700;color:var(--fk-text-muted)">PDF</div>`;
    return `<div style="position:relative;width:62px;height:62px;border:1px solid var(--fk-border);border-radius:8px;overflow:hidden;background:var(--fk-bg-subtle)" title="${esc(f.name || '')}">
        ${thumb}
        <button type="button" onclick="_saAnnRmAttach(${i})" style="position:absolute;top:1px;right:1px;width:18px;height:18px;border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:18px;cursor:pointer">×</button>
      </div>`;
  }).join('');
}
function _saAnnRmAttach(i) { _saAnnFiles.splice(i, 1); _saAnnRenderAttach(); }
async function _saAnnPick(input) {
  const files = Array.from(input.files || []); input.value = '';
  for (const file of files) {
    if (typeof toast === 'function') toast('Uploading ' + file.name + '…', 'info');
    try {
      const ext = (file.name.split('.').pop() || 'dat').toLowerCase();
      const path = (S && S.cid ? S.cid : 'shared') + '/announcements/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const res = await supabase.storage.from('rms-documents').upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (res.error) throw res.error;
      const url = supabase.storage.from('rms-documents').getPublicUrl(path).data.publicUrl;
      _saAnnFiles.push({ url, name: file.name, type: file.type || '' });
      _saAnnRenderAttach();
    } catch (e) { if (typeof toast === 'function') toast('Upload failed: ' + (e.message || e), 'err'); }
  }
}

async function _saAnnSave(id) {
  const title = (document.getElementById('ann-title') || {}).value || '';
  const body = (document.getElementById('ann-body') || {}).value || '';
  const important = !!(document.getElementById('ann-important') || {}).checked;
  const err = document.getElementById('ann-err');
  if (!title.trim() || !body.trim()) { if (err) { err.style.display = 'block'; err.textContent = 'Title and message are required.'; } return; }
  const attachments = _saAnnFiles.slice();
  try {
    const { data } = id
      ? await supabase.rpc('update_sales_announcement', { p_id: id, p_title: title, p_body: body, p_important: important, p_attachments: attachments })
      : await supabase.rpc('create_sales_announcement', { p_company_id: S.cid, p_title: title, p_body: body, p_important: important, p_attachments: attachments });
    if (!data || !data.success) { if (err) { err.style.display = 'block'; err.textContent = (data && data.message) || 'Could not save. Admin access required.'; } return; }
    _saCloseModal();
    if (typeof toast === 'function') toast(id ? 'Update saved' : 'Update posted to your sub-dealers', 'ok');
    rSalesAccess();
  } catch (e) { if (err) { err.style.display = 'block'; err.textContent = 'Could not save.'; } }
}

async function _saAnnDelete(id) {
  if (!confirm('Delete this update? Sub-dealers will no longer see it in their inbox.')) return;
  try {
    const { data } = await supabase.rpc('delete_sales_announcement', { p_id: id });
    if (!data || !data.success) { if (typeof toast === 'function') toast('Could not delete', 'err'); return; }
    if (typeof toast === 'function') toast('Update deleted', 'ok');
    rSalesAccess();
  } catch (e) { if (typeof toast === 'function') toast('Could not delete', 'err'); }
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

// A framed KYC document — full image (contain) inside an aspect-ratio frame so
// the whole CNIC / photo is visible. kind: 'card' (CNIC, landscape) | 'photo'.
function _saKycDoc(url, label, kind) {
  const ar = kind === 'photo' ? '3 / 4' : '1.585 / 1';
  const frame = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(label)} — click to enlarge" style="display:block;text-decoration:none">
         <div style="aspect-ratio:${ar};background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:10px;overflow:hidden;display:grid;place-items:center">
           <img src="${esc(url)}" style="width:100%;height:100%;object-fit:contain"></div></a>`
    : `<div style="aspect-ratio:${ar};border:1px dashed var(--fk-border);border-radius:10px;display:grid;place-items:center;font-size:11px;color:var(--fk-text-muted)">No image</div>`;
  return `<div><div style="font-size:11px;font-weight:600;color:var(--fk-text-muted);margin-bottom:5px">${esc(label)}</div>${frame}</div>`;
}

// Full application preview + decision — shows everything the registrant submitted,
// the KYC docs, the agent code that will be issued, then Approve / Reject.
async function _saReviewOpen(id) {
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

  // duplicate-agent guard: auto-matches + manual search of ALL agents
  let _matches = [], _allAgents = [];
  try { const { data: mm } = await supabase.rpc('find_agent_matches_for_signup', { p_id: id });
        _matches = (mm && mm.matches) || []; } catch (e) { _matches = []; }
  try { const { data: ag } = await supabase.rpc('list_agents', { p_company_id: S.cid, p_search: null, p_status: 'active', p_sort: 'name' });
        _allAgents = (ag && (ag.agents || ag)) || []; } catch (e) { _allAgents = []; }
  const _matchIds = new Set(_matches.map(m => m.id));
  const _otherOpts = _allAgents.filter(a => !_matchIds.has(a.id))
    .map(a => `<option value="${a.id}">${esc(a.full_name || '?')}${a.agent_code ? ' — ' + esc(a.agent_code) : ''}</option>`).join('');
  const matchesHtml =
    `<div style="margin:var(--fk-sp-3) 0;padding:10px 12px;border:1px solid ${_matches.length ? 'var(--fk-warning-edge)' : 'var(--fk-border)'};background:${_matches.length ? 'var(--fk-warning-surface)' : 'var(--fk-bg-subtle)'};border-radius:var(--fk-radius-control)">
       <div style="font-size:12.5px;font-weight:700;color:var(--fk-text);margin-bottom:4px">${_matches.length ? '⚠ ' + _matches.length + ' possible existing sub-agent' + (_matches.length > 1 ? 's' : '') + ' found — Merge or Save new?' : 'Merge with an existing sub-agent, or save new?'}</div>
       <div style="font-size:12px;color:var(--fk-text-muted);margin-bottom:8px"><b>Merge</b> = no duplicate; this signup joins the existing sub-agent and fills their blank CNIC / phone / KYC. <b>Save new</b> = a brand-new sub-agent. Different spelling? Use the search to find the right person.</div>
       <label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:5px 0;cursor:pointer"><input type="radio" name="sa-link" value="" checked onchange="_saToggleOther()"> <b>Save as a new sub-agent</b></label>
       ${_matches.map(a => `<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;padding:5px 0;cursor:pointer"><input type="radio" name="sa-link" value="${a.id}" style="margin-top:3px" onchange="_saToggleOther()"> <span><b>Merge</b> with <b>${esc(a.full_name)}</b> <span style="color:var(--fk-text-muted)">(${esc(a.agent_code || '')} · matched on ${esc(a.match_on)}${a.cnic ? ' · CNIC ' + esc(a.cnic) : ''})</span></span></label>`).join('')}
       <label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:5px 0;cursor:pointer"><input type="radio" name="sa-link" value="__other__" onchange="_saToggleOther()"> <b>Merge</b> with another existing sub-agent (search)</label>
       <select id="sa-link-other" class="nx-select" disabled style="margin-top:4px;opacity:.5"><option value="">— pick a sub-agent —</option>${_otherOpts}</select>
     </div>`;

  // Umbrella? then approval becomes a per-member-company merge chooser (registers in all).
  let _umb = null;
  try { const { data } = await supabase.rpc('get_umbrella_approval_context', { p_sales_user_id: id });
        if (data && data.success && data.umbrella) _umb = data; } catch (e) {}
  const _projField = projOpts.length
    ? _saFieldH('Project (reserve scope &amp; agent home)', { name: 'sa-approve-project', el: 'select', options: projOpts, value: projOpts[0].value })
    : `<div class="nx-error" style="display:block">No projects exist yet — create a project first, then approve.</div>`;
  const _commField = _saFieldH('Default commission % <span style="font-weight:400;text-transform:none;color:var(--fk-text-muted)">· optional — each sale sets its own rate; this only pre-fills</span>', { name: 'sa-approve-comm', el: 'input', type: 'number', value: '', attrs: 'min="0" max="100" step="0.01" placeholder="leave blank — set per sale"' });
  const _errDiv = `<div class="nx-error" id="sa-approve-err" style="display:none"></div>`;
  const _roleField = _saRoleField('sa-approve-role', 'sale_rep');
  // "Reports to" — every member must answer to someone; only a director can have no head.
  const _seniorOpts = [{ value: '', label: '— select team head —' }].concat(
    (_saRows || []).filter(x => x.status === 'active' && (x.role === 'marketing_manager' || x.role === 'director'))
      .map(x => ({ value: x.id, label: (x.full_name || '?') + (x.role ? ' (' + _saRoleLabel(x.role) + ')' : '') }))
  );
  const _parentField = _saFieldH('Reports to <span style="font-weight:400;text-transform:none;color:var(--fk-text-muted)">· required — who this member answers to (only a Director can skip)</span>', { name: 'sa-approve-parent', el: 'select', options: _seniorOpts, value: '' });
  const approvalHtml = _roleField + _parentField + (_umb ? _saUmbrellaHtml(_umb) : (matchesHtml + _projField + _commField + _errDiv));
  const approveBtn = _umb
    ? NX.button('Approve &amp; register in all', { variant: 'primary', onclick: `_saApproveGrouped('${id}')` })
    : (projOpts.length ? NX.button('Approve', { variant: 'primary', onclick: `_saApproveSubmit('${id}')` }) : '');

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
       <div class="nx-grid-2" style="gap:12px;margin-bottom:12px">
         ${_saKycDoc(r.cnic_front_url, 'CNIC — front', 'card')}
         ${_saKycDoc(r.cnic_back_url, 'CNIC — back', 'card')}
       </div>
       <div style="max-width:160px">${_saKycDoc(r.profile_photo_url, 'Photo', 'photo')}</div>
       <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:var(--fk-sp-4) 0 var(--fk-sp-2)">Signed agreement</div>
       <div style="padding:10px 12px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-subtle);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
         <div style="flex:1;min-width:180px;font-size:12.5px;color:var(--fk-text-muted)">Digitally signed at signup — view the full clauses, signature and date.</div>
         ${NX.button('View signed agreement', { variant: 'secondary', size: 'sm', icon: 'file-text', onclick: `_daViewRecord('${r.id}')` })}
       </div>
       <div style="margin-top:var(--fk-sp-4);padding:10px 12px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-subtle);font-size:12.5px;color:var(--fk-text-muted)">
         On <b style="color:var(--fk-text)">Approve</b>, choose below to <b style="color:var(--fk-text)">Merge</b> with an existing sub-agent or <b style="color:var(--fk-text)">Save as new</b> (code <b style="color:var(--fk-text)">AGT-${yr}-####</b>). KYC is marked verified and they can sign in &amp; reserve.
       </div>
       <div style="border-top:1px solid var(--fk-border);margin:var(--fk-sp-4) 0 var(--fk-sp-3)"></div>
       <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin-bottom:var(--fk-sp-2)">Approval</div>` +
      approvalHtml,
    footer:
      NX.button('Reject', { variant: 'danger-soft', onclick: `_saReject('${id}','${esc(r.full_name || '')}')` }) +
      NX.button('Cancel', { variant: 'ghost', onclick: '_saCloseModal()' }) +
      approveBtn
  }));
}

// ── Umbrella approval: one merge-or-new chooser per member company ──
function _saUmbrellaHtml(umb) {
  window._saUmbMembers = umb.members || [];
  const sec = (m) => {
    const matches = m.matches || [], agents = m.agents || [];
    const matchIds = new Set(matches.map(x => x.id));
    const otherOpts = agents.filter(a => !matchIds.has(a.id))
      .map(a => `<option value="${a.id}">${esc(a.full_name || '?')}${a.agent_code ? ' — ' + esc(a.agent_code) : ''}</option>`).join('');
    const cid = m.company_id;
    return `<div style="margin:var(--fk-sp-3) 0;padding:10px 12px;border:1px solid ${matches.length ? 'var(--fk-warning-edge)' : 'var(--fk-border)'};background:${matches.length ? 'var(--fk-warning-surface)' : 'var(--fk-bg-subtle)'};border-radius:var(--fk-radius-control)">
       <div style="font-weight:700;font-size:13px;margin-bottom:4px">${esc(m.company_name)} <span style="font-weight:400;color:var(--fk-text-muted)">· ${esc(m.project_name || 'project')}</span></div>
       <label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0;cursor:pointer"><input type="radio" name="sa-link-${cid}" value="" checked onchange="_saUmbToggle('${cid}')"> <b>Save as a new sub-dealer</b></label>
       ${matches.map(a => `<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;padding:4px 0;cursor:pointer"><input type="radio" name="sa-link-${cid}" value="${a.id}" style="margin-top:3px" onchange="_saUmbToggle('${cid}')"> <span><b>Merge</b> with <b>${esc(a.full_name)}</b> <span style="color:var(--fk-text-muted)">(${esc(a.agent_code || '')} · matched on ${esc(a.match_on)})</span></span></label>`).join('')}
       <label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0;cursor:pointer"><input type="radio" name="sa-link-${cid}" value="__other__" onchange="_saUmbToggle('${cid}')"> <b>Merge</b> with another sub-dealer (search)</label>
       <select id="sa-other-${cid}" class="nx-select" disabled style="margin-top:4px;opacity:.5"><option value="">— pick a sub-dealer —</option>${otherOpts}</select>
     </div>`;
  };
  return `<div style="font-size:12px;color:var(--fk-text-muted);margin-bottom:6px">This dealer will be registered in <b>all member companies</b>. For each, Merge with an existing sub-dealer (names need not match — use search) or Save as new.</div>`
    + (umb.members || []).map(sec).join('')
    + `<div class="nx-error" id="sa-approve-err" style="display:none"></div>`;
}
function _saUmbToggle(cid) {
  const sel = document.getElementById('sa-other-' + cid); if (!sel) return;
  const v = (document.querySelector('input[name="sa-link-' + cid + '"]:checked') || {}).value;
  const other = (v === '__other__'); sel.disabled = !other; sel.style.opacity = other ? '1' : '.5';
}
async function _saApproveGrouped(id) {
  const members = window._saUmbMembers || [];
  const assignments = members.map(m => {
    const cid = m.company_id;
    let v = (document.querySelector('input[name="sa-link-' + cid + '"]:checked') || {}).value || '';
    if (v === '__other__') v = (document.getElementById('sa-other-' + cid) || {}).value || '';
    return { company_id: cid, project_id: m.project_id || null, link_agent_id: v || null, commission_percent: null };
  });
  const role = (document.getElementById('sa-approve-role') || {}).value || 'sale_rep';
  const parent = (document.getElementById('sa-approve-parent') || {}).value || null;
  if (role !== 'director' && !parent) {
    const _m = 'Select who this member reports to — only a Director can have no team head.';
    const e = document.getElementById('sa-approve-err');
    if (e) { e.textContent = _m; e.style.display = 'block'; try { e.scrollIntoView({ block: 'center' }); } catch (_) {} }
    if (typeof toast === 'function') toast('Select who this member reports to (Reports to).', 'err');
    return;
  }
  try {
    const { data } = await supabase.rpc('admin_approve_sales_user_grouped', { p_id: id, p_assignments: assignments, p_role: role });
    if (!data || !data.success) { if (typeof toast === 'function') toast((data && data.message) || 'Approval failed', 'err'); return; }
    try { await supabase.rpc('set_sales_user_role', { p_id: id, p_role: role, p_parent_sales_user_id: parent }); } catch (e) {}
    _saCloseModal(); if (typeof toast === 'function') toast('Approved — registered in all member companies', 'ok'); rSalesAccess();
  } catch (e) { if (typeof toast === 'function') toast('Approval failed', 'err'); }
}
function _saCloseModal() { document.querySelector('.nx-modal-overlay')?.remove(); }

// ── Change a member's portal role (+ optional team head) — set_sales_user_role ──
// Eligible parents are keyed off the SELECTED (new) role, not the member's old role:
//   non-director → all active seniors that outrank that role (managers/directors), self excluded
//   director     → none (a director has no team head)
function _saParentOptsFor(memberId, selRole) {
  const _SA_RANK = { lead_entry: 1, sale_rep: 1, marketing_manager: 2, cfo: 2, admin: 2, director: 3 };
  const myRank = _SA_RANK[selRole] || 1;
  return [{ value: '', label: '— none —' }].concat(
    (_saRows || []).filter(x => x.id !== memberId && x.status === 'active'
        && (x.role === 'marketing_manager' || x.role === 'director')
        && (_SA_RANK[x.role] || 0) > myRank)
      .map(x => ({ value: x.id, label: (x.full_name || '?') + (x.role ? ' (' + _saRoleLabel(x.role) + ')' : '') }))
  );
}
function _saParentFieldHtml(memberId, selRole, curVal) {
  const opts = _saParentOptsFor(memberId, selRole);
  const keep = opts.some(o => String(o.value) === String(curVal || '')) ? curVal : '';
  return _saFieldH('Team head <span style="font-weight:400;text-transform:none;color:var(--fk-text-muted)">· required for non-directors — who this member reports to</span>',
    { name: 'sa-role-parent', el: 'select', options: opts, value: keep });
}
function _saRoleParentSync(memberId) {
  const sel = (document.getElementById('sa-role-sel') || {}).value || 'sale_rep';
  const cur = (document.getElementById('sa-role-parent') || {}).value || '';
  const wrap = document.getElementById('sa-role-parent-wrap');
  if (wrap) wrap.innerHTML = _saParentFieldHtml(memberId, sel, cur);
}
function _saRoleOpen(id) {
  const r = (_saRows || []).find(x => x.id === id) || {};
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    id: 'sa-role-modal', title: 'Portal role — ' + esc(r.full_name || ''), size: 's', onClose: '_saCloseModal()',
    body:
      _saRoleField('sa-role-sel', r.role || 'sale_rep')
      + '<div id="sa-role-parent-wrap">' + _saParentFieldHtml(id, r.role || 'sale_rep', r.parent_sales_user_id || '') + '</div>'
      + `<div style="font-size:11.5px;color:var(--fk-text-muted);margin-top:6px">Role decides what this person logs into in the portal. (Role-specific screens roll out next — tagging it now keeps everyone classified.)</div>`
      + `<div class="nx-error" id="sa-role-err" style="display:none"></div>`,
    footer:
      NX.button('Cancel', { variant: 'ghost', onclick: '_saCloseModal()' })
      + NX.button('Save role', { variant: 'primary', onclick: `_saRoleSave('${id}')` })
  }));
  // refresh "Reports to" whenever the role selection changes (eligibility follows the NEW role)
  const selEl = document.getElementById('sa-role-sel');
  if (selEl) selEl.addEventListener('change', function () { _saRoleParentSync(id); });
}

async function _saRoleSave(id) {
  const role = (document.getElementById('sa-role-sel') || {}).value || 'sale_rep';
  const parent = (document.getElementById('sa-role-parent') || {}).value || null;
  const err = document.getElementById('sa-role-err');
  // Every member must answer to someone — only a director can have no team head.
  if (role !== 'director' && !parent) {
    if (err) { err.style.display = 'block'; err.textContent = 'Select who this member reports to — only a director can have no team head.'; }
    return;
  }
  try {
    const { data } = await supabase.rpc('set_sales_user_role', { p_id: id, p_role: role, p_parent_sales_user_id: parent });
    if (!data || !data.success) { if (err) { err.style.display = 'block'; err.textContent = (data && data.message) || 'Could not update role (admin access required).'; } return; }
    _saCloseModal();
    if (typeof toast === 'function') toast('Role updated to ' + _saRoleLabel(role), 'ok');
    rSalesAccess();
  } catch (e) { if (err) { err.style.display = 'block'; err.textContent = 'Could not update role.'; } }
}

// Documents view for an approved dealer — KYC images + the digitally signed agreement.
function _saDocsOpen(id) {
  const r = (_saRows || []).find(x => x.id === id) || {};
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    id: 'sa-docs-modal', title: 'Documents — ' + esc(r.full_name || ''), size: 'l', onClose: '_saCloseModal()',
    body:
      `<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:0 0 var(--fk-sp-2)">Identity documents (KYC) — click to enlarge</div>
       <div class="nx-grid-2" style="gap:12px;margin-bottom:12px">
         ${_saKycDoc(r.cnic_front_url, 'CNIC — front', 'card')}
         ${_saKycDoc(r.cnic_back_url, 'CNIC — back', 'card')}
       </div>
       <div style="max-width:160px;margin-bottom:var(--fk-sp-4)">${_saKycDoc(r.profile_photo_url, 'Photo', 'photo')}</div>
       <div class="nx-kpi-label" style="text-transform:none;color:var(--fk-text);margin:0 0 var(--fk-sp-2)">Signed agreement</div>
       <div style="padding:12px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);background:var(--fk-bg-subtle);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
         <div style="flex:1;min-width:180px;font-size:13px;color:var(--fk-text-muted)">The dealer's digitally signed Sale Agent Agreement — full clauses, signature and date.</div>
         ${NX.button('View signed agreement', { variant: 'secondary', size: 'sm', icon: 'file-text', onclick: `_daViewRecord('${id}')` })}
       </div>`,
    footer: NX.button('Close', { variant: 'ghost', onclick: '_saCloseModal()' })
  }));
}

function _saToggleOther() {
  const sel = document.getElementById('sa-link-other');
  if (!sel) return;
  const isOther = (document.querySelector('input[name="sa-link"]:checked') || {}).value === '__other__';
  sel.disabled = !isOther;
  sel.style.opacity = isOther ? '1' : '.5';
  if (isOther) sel.focus();
}

async function _saApproveSubmit(id) {
  const proj = (document.getElementById('sa-approve-project') || {}).value || '';
  const commRaw = (document.getElementById('sa-approve-comm') || {}).value;
  const comm = commRaw === '' || commRaw == null ? null : parseFloat(commRaw);
  const err = document.getElementById('sa-approve-err');
  const showErr = (m) => {
    if (err) { err.textContent = m; err.style.display = 'block'; try { err.scrollIntoView({ block: 'center' }); } catch (_) {} }
    if (typeof toast === 'function') toast(m, 'err');
  };
  if (!proj) { showErr('Pick a project — it becomes their reserve scope and agent home project.'); return; }
  if (comm != null && (isNaN(comm) || comm < 0 || comm > 100)) { showErr('Commission must be between 0 and 100.'); return; }
  const _linkSel = (document.querySelector('input[name="sa-link"]:checked') || {}).value || '';
  let linkId = _linkSel || null;
  if (_linkSel === '__other__') {
    linkId = (document.getElementById('sa-link-other') || {}).value || null;
    if (!linkId) { showErr('Pick the existing agent to link to, or choose "Create new agent".'); return; }
  }
  const role = (document.getElementById('sa-approve-role') || {}).value || 'sale_rep';
  const parent = (document.getElementById('sa-approve-parent') || {}).value || null;
  if (role !== 'director' && !parent) { showErr('Select who this member reports to — only a Director can have no team head.'); return; }
  try {
    const { data } = await supabase.rpc('admin_approve_sales_user', { p_id: id, p_project_id: proj, p_commission_percent: comm, p_link_agent_id: linkId, p_role: role });
    if (!data || !data.success) {
      showErr((data && data.message) || 'Could not approve.');
      return;
    }
    // stamp role + team head (answerable-to) on the approved member
    try { await supabase.rpc('set_sales_user_role', { p_id: id, p_role: role, p_parent_sales_user_id: parent }); } catch (e) {}
    _saCloseModal();
    if (typeof toast === 'function') toast((data.linked ? 'Approved — merged into existing sub-agent ' : 'Approved — saved as new Sale Agent ') + (data.agent_code || '') + '.', 'ok');
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
  const r = (_saRows || []).find(x => x.id === id) || {};
  const total = r.total_leads || 0;
  if (total > 0) { _saReassignPickerOpen(id, name, total); return; }   // must reassign first
  if (!confirm('Delete ' + name + ' permanently? This removes their access for good and releases any active reservations they hold (those units return to Available).')) return;
  _saDoDelete(id);
}
async function _saDoDelete(id) {
  try {
    const { data } = await supabase.rpc('delete_sales_user', { p_id: id });
    if (data && data.success) { if (typeof toast === 'function') toast('Sales person deleted.', 'ok'); rSalesAccess(); return true; }
    if (typeof toast === 'function') toast((data && data.message) || 'Could not delete.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not delete.', 'err'); }
  return false;
}
function _saReassignPickerOpen(id, name, total) {
  const opts = [{ value: '', label: '— Unassigned pool —' }].concat(_saActiveMemberOpts(id));
  document.body.insertAdjacentHTML('beforeend', NX.modal({
    id: 'sa-reassign-modal', title: 'Reassign leads before deleting', size: 's', onClose: '_saCloseModal()',
    body:
      `<div style="font-size:13px;color:var(--fk-text-muted);margin-bottom:var(--fk-sp-3)"><b>${esc(name)}</b> still owns <b>${total}</b> lead(s). Choose who receives them — then ${esc(name)} will be deleted.</div>`
      + _saFieldH('Reassign all leads to', { name: 'sa-reassign-to', el: 'select', options: opts, value: '' })
      + `<div class="nx-error" id="sa-reassign-err" style="display:none"></div>`,
    footer:
      NX.button('Cancel', { variant: 'ghost', onclick: '_saCloseModal()' })
      + NX.button('Reassign & delete', { variant: 'danger', onclick: `_saReassignAndDelete('${id}')` })
  }));
}
async function _saReassignAndDelete(id) {
  const to = (document.getElementById('sa-reassign-to') || {}).value || null;
  const err = document.getElementById('sa-reassign-err');
  const fail = m => { if (err) { err.style.display = 'block'; err.textContent = m; } };
  try {
    const { data } = await supabase.rpc('admin_reassign_member_leads', { p_from: id, p_to: to, p_scope: 'all' });
    if (!data || !data.success) { fail((data && data.message) || 'Could not reassign the leads.'); return; }
    const ok = await _saDoDelete(id);
    if (ok) { _saCloseModal(); if (typeof toast === 'function') toast('Reassigned ' + (data.reassigned || 0) + ' lead(s) to ' + (data.target_name || 'the pool') + ', then deleted.', 'ok'); }
    else fail('Leads reassigned, but the delete failed. Try Delete again.');
  } catch (e) { fail('Could not complete. Please try again.'); }
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
  const r = (_saRows || []).find(x => x.id === id) || {};
  const open = r.open_leads || 0;
  const target = r.parent_name ? ('their team head (' + r.parent_name + ')') : 'the unassigned pool';
  const msg = open > 0
    ? 'Deactivate ' + name + '? Their ' + open + ' active lead(s) will move to ' + target + '. Access is revoked immediately (active reservations stay until you release them).'
    : 'Deactivate ' + name + '? Access is revoked immediately (active reservations stay until you release them).';
  if (!confirm(msg)) return;
  try {
    const { data } = await supabase.rpc('deactivate_sales_user', { p_id: id });
    if (data && data.success) {
      const t = (data.reassigned > 0) ? ('Deactivated — ' + data.reassigned + ' lead(s) moved to ' + (data.target_name || 'the pool') + '.') : 'Sales access deactivated.';
      if (typeof toast === 'function') toast(t, 'ok'); rSalesAccess();
    } else if (typeof toast === 'function') toast('Could not deactivate.', 'err');
  } catch (e) { if (typeof toast === 'function') toast('Could not deactivate.', 'err'); }
}
