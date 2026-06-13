// ══ USER MANAGEMENT ══════════════════════════════════════════════════
// Phase-3 ADMIN batch: rebuilt onto the nx- foundation kit (warmth v2).
// Logic / RPCs UNCHANGED (list_app_users · create_app_user · update_app_user ·
// admin_reset_subuser_password · get_plan_limits_with_usage). The brain was
// fixed in the Main-Gate phase; this rebuilds the face around that identity flow.

const ROLE_LABELS = {
  owner:    'Owner',
  admin:    'Admin',
  recovery: 'Recovery',
  accounts: 'Accounts',
  manager:  'Manager',
  staff:    'Staff'
};

// Role chips stay quiet & on-kit: indigo for the privileged roles, neutral
// otherwise (premium = restraint; no tutti-frutty per-role rainbow).
function _umRoleTone(role) {
  if (role === 'owner') return 'primary';
  if (role === 'admin') return 'info';
  return '';
}

const MODULE_LIST = [
  { key: 'projects',  label: 'Projects' },
  { key: 'units',     label: 'Units' },
  { key: 'clients',   label: 'Clients' },
  { key: 'recovery',  label: 'Payments' },
  { key: 'contacts',  label: 'Activity Log' },
  { key: 'reports',   label: 'Reports' },
  { key: 'documents', label: 'Documents' },
  { key: 'agents',    label: 'Agents' },
  { key: 'search',    label: 'Quick Search' }
];

let _usersData = [];
let _umProjects = [];   // company projects for the modal project picker
let _umAssigned = [];   // project ids already assigned to the user being edited

async function _umLoadProjects() {
  if (_umProjects.length) return;
  try {
    const { data } = await supabase.rpc('list_projects', { p_company_id: S.cid });
    _umProjects = Array.isArray(data) ? data : [];
  } catch(_) { _umProjects = []; }
}

// Project-access picker — scoped roles can only work the projects checked here.
// (Owners/admins are never project-gated server-side, so it's advisory for them.)
function _umProjectsBlock() {
  if (!_umProjects.length) {
    return '<div class="nx-field"><label class="nx-label">Project access</label>' +
      '<div class="nx-error" style="color:var(--fk-text-muted)">No projects exist yet — create a project first, then assign it here.</div></div>';
  }
  const cbs = _umProjects.map(function(p){
    const ck = _umAssigned.indexOf(p.id) >= 0 ? ' checked' : '';
    return '<label style="display:inline-flex;align-items:center;gap:7px;font-size:var(--fk-fs-body);color:var(--fk-text);cursor:pointer">' +
      '<input type="checkbox" class="um-proj-cb" data-id="' + NX.esc(p.id) + '"' + ck + '> ' +
      NX.esc(p.project_name || p.project_code || 'Project') + '</label>';
  }).join('');
  return '<div class="nx-field" id="um-projects-wrap"><label class="nx-label">Project access</label>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;padding:12px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control)">' + cbs + '</div>' +
    '<div class="nx-error" style="color:var(--fk-text-muted)">Recovery &amp; staff can only work the projects checked here. Owners &amp; admins always see all projects.</div></div>';
}

// Synthetic plumbing emails (created when a user is added without a real email)
// are never shown as contact info and never treated as mailable.
function _isSyntheticEmail(e){ return !!e && /@users\.internal$/i.test(e); }

function _umMuted(txt){ return '<span style="color:var(--fk-text-muted)">' + NX.esc(txt) + '</span>'; }

function _umLastLogin(ts){
  if (!ts) return _umMuted('Never');
  try {
    const d = new Date(ts);
    return '<span style="color:var(--fk-text-muted)">' +
      d.toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }) + '</span>';
  } catch(e){ return _umMuted('—'); }
}

// Live "<username>@COMPANYCODE" preview under the Username field.
function umUnamePrev(){
  var i=document.getElementById('um-username'), p=document.getElementById('um-uname-prev');
  if(!i||!p) return;
  var v=(i.value||'').toLowerCase().replace(/[^a-z0-9._-]/g,'');
  if(i.value!==v) i.value=v;            // gently enforce lowercase as they type
  p.textContent = v || 'username';
}
// Suggest a username from the full name, but only while the field is still empty.
function umSuggestFromName(){
  var n=document.getElementById('um-name'), u=document.getElementById('um-username');
  if(!n||!u||u.value.trim()) return;
  u.value=(n.value||'').toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,30);
  umUnamePrev();
}

// One-time on-screen temp-password reveal (for users without a real email).
// Never logged / never toasted in plaintext. Built on the kit modal.
function umShowTempPassword(name, tempPw){
  var host = document.getElementById('um-temppw-host');
  if (!host) { host = document.createElement('div'); host.id = 'um-temppw-host'; document.body.appendChild(host); }
  host.innerHTML = NX.modal({
    title: 'Temporary password',
    size: 's',
    onClose: 'umCloseTempPassword()',
    body:
      NX.banner('No email on file for ' + name + ' — share this password directly. Shown once; it won’t be displayed again.', 'warn') +
      '<div class="nx-field" style="margin-top:12px"><label class="nx-label">Password for ' + NX.esc(name) + '</label>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<code id="um-temppw-val" class="nx-mono" style="flex:1;font-size:16px;letter-spacing:.04em;word-break:break-all;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control);padding:10px 12px">' + NX.esc(tempPw) + '</code>' +
          NX.button('Copy', { variant:'secondary', attrs:'id="um-temppw-copy"' }) +
        '</div>' +
        '<div class="nx-error" style="color:var(--fk-text-muted)">They’ll be asked to change it at first login.</div>' +
      '</div>',
    footer: NX.button('Done', { variant:'primary', onclick:'umCloseTempPassword()' })
  });
  var copyBtn = document.getElementById('um-temppw-copy');
  if (copyBtn) copyBtn.addEventListener('click', function(){
    try{ navigator.clipboard.writeText(tempPw); }catch(e){}
    var s=this.querySelector('span'); if(s){ s.textContent='Copied!'; setTimeout(function(){ s.textContent='Copy'; },1400); }
  });
}
function umCloseTempPassword(){ var h=document.getElementById('um-temppw-host'); if(h) h.innerHTML=''; }

// ── Page entry ────────────────────────────────────────────────────────
async function rUsers() {
  const el = document.getElementById('pg-users');
  if (!el) return;

  if (!S || (S.role !== 'admin' && S.role !== 'owner')) {
    el.innerHTML = NX.card(NX.empty({ icon:'users', message:'Access denied — admins only.' }));
    return;
  }

  el.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Users & Roles',
        NX.button('Add user', { variant:'primary', icon:'plus', attrs:'id="um-add-btn"', onclick:'openAddUserModal()' }),
        { icon:'users', sub:'Manage staff accounts, roles and module access' }) +
      '<div id="um-stats" style="display:none;gap:var(--fk-sp-3);margin-bottom:var(--fk-sp-4)"></div>' +
      '<div id="users-list-wrap">' + NX.card(NX.empty({ icon:'users', message:'Loading users…' })) + '</div>' +
    '</div>' +
    '<div id="um-modal-host"></div>' +
    '<div id="um-temppw-host"></div>';

  await _loadUsers();
  await _checkUserLimitUI();
}

async function _checkUserLimitUI() {
  const btn = document.getElementById('um-add-btn');
  if (!btn) return;
  try {
    const { data } = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: S.cid });
    const maxU = (data && data.max_users)   || 0;
    const curU = (data && data.count_users) || 0;
    if (maxU > 0 && curU >= maxU) {
      btn.disabled = true;
      var s = btn.querySelector('span'); if (s) s.textContent = 'Add user (' + curU + '/' + maxU + ')';
      btn.title = 'Limit reached. Upgrade to add more.';
    }
  } catch(e) {}
}

async function _loadUsers() {
  const wrap = document.getElementById('users-list-wrap');
  try {
    const { data, error } = await supabase.rpc('list_app_users', { p_company_id: S.cid });
    if (error) throw error;
    _usersData = Array.isArray(data) ? data : [];
    _renderUsersList();
  } catch(e) {
    if (wrap) wrap.innerHTML = NX.card(NX.banner('Failed to load users: ' + (e.message || e), 'danger'));
  }
}

// ── Render — list on the nx-table (avatar · username@code · role · status · last login) ──
function _renderUsersList() {
  const wrap = document.getElementById('users-list-wrap');
  if (!wrap) return;

  // Stat chips
  const statsEl = document.getElementById('um-stats');
  if (statsEl) {
    const activeCount = _usersData.filter(function(u){ return u.status === 'active'; }).length;
    statsEl.style.display = 'flex';
    statsEl.style.flexWrap = 'wrap';
    statsEl.innerHTML =
      '<div class="nx-statchip"><span class="nx-statchip-v">' + _usersData.length + '</span><span class="nx-statchip-l">Total</span></div>' +
      '<div class="nx-statchip"><span class="nx-statchip-v" style="color:var(--fk-success)">' + activeCount + '</span><span class="nx-statchip-l">Active</span></div>' +
      '<div class="nx-statchip"><span class="nx-statchip-v" style="color:var(--fk-text-muted)">' + (_usersData.length - activeCount) + '</span><span class="nx-statchip-l">Inactive</span></div>';
  }

  if (!_usersData.length) {
    wrap.innerHTML = NX.card(NX.empty({
      icon:'users',
      message:'No users yet — add staff accounts to give your team scoped access.',
      action: NX.button('Add user', { variant:'primary', icon:'plus', onclick:'openAddUserModal()' })
    }));
    return;
  }

  const cols = [
    { label:'User' }, { label:'Role' }, { label:'Contact' },
    { label:'Status' }, { label:'Last login' }, { label:'', width:'1%' }
  ];

  const rows = _usersData.map(function(u){
    const isOwner     = u.role === 'owner';
    const isAdminRole = u.role === 'admin' || u.role === 'owner';
    const isSelf      = u.id === S.userId;
    const isActive    = u.status === 'active';
    const initial     = ((u.full_name || u.username || '?').charAt(0)).toUpperCase();
    const rl          = ROLE_LABELS[u.role] || u.role;

    // User cell — avatar chip + name + @username
    const userCell =
      '<span style="display:inline-flex;align-items:center;gap:10px">' +
        '<span class="nx-avatar" style="background:var(--fk-primary-chip);color:var(--fk-primary)">' + NX.esc(initial) + '</span>' +
        '<span style="display:inline-flex;flex-direction:column;line-height:1.3">' +
          '<span style="font-weight:var(--fk-fw-semibold);color:var(--fk-text)">' + NX.esc(u.full_name || u.username) + (isSelf ? ' <span style="color:var(--fk-text-muted);font-weight:400">(you)</span>' : '') + '</span>' +
          '<span style="font-size:var(--fk-fs-label);color:var(--fk-text-muted)">@' + NX.esc(u.username) + '</span>' +
        '</span>' +
      '</span>';

    // Project scope under the role — 'All projects' for admins, the assigned set
    // for scoped roles, or a warning when a non-admin has no assignment (dead queue).
    const _projs = Array.isArray(u.projects) ? u.projects : [];
    const _projLine = isAdminRole
      ? '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:3px">All projects</div>'
      : (_projs.length
          ? '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:3px">' + NX.esc(_projs.slice(0,2).join(', ')) + (_projs.length > 2 ? ' +' + (_projs.length - 2) : '') + '</div>'
          : '<div style="font-size:var(--fk-fs-label);color:var(--fk-warning);margin-top:3px">No project assigned</div>');
    const roleCell = NX.badge(rl, _umRoleTone(u.role)) + _projLine;

    // Contact — synthetic plumbing emails (@users.internal) are never shown
    const showEmail = u.email && !_isSyntheticEmail(u.email);
    let contactCell;
    if (showEmail && u.phone)      contactCell = NX.esc(u.email) + '<br><span style="color:var(--fk-text-muted);font-size:var(--fk-fs-label)">' + NX.esc(u.phone) + '</span>';
    else if (showEmail)            contactCell = NX.esc(u.email);
    else if (u.phone)              contactCell = NX.esc(u.phone);
    else                          contactCell = _umMuted('—');

    const statusCell = isActive
      ? NX.badge('Active', 'success', { dot:true })
      : NX.badge('Inactive', '', { dot:true });

    const lastCell = _umLastLogin(u.last_login_at);

    // Row actions — hover-revealed (nx-rowact)
    let acts = '';
    if (!isOwner) acts += NX.button('Edit', { variant:'ghost', size:'sm', onclick:"openEditUserModal('" + u.id + "')" });
    if (!isOwner && !isAdminRole && isActive) acts += NX.button('Reset password', { variant:'ghost', size:'sm', onclick:"_umResetPw('" + u.id + "')" });
    if (!isOwner && !isSelf) acts += NX.button(isActive ? 'Deactivate' : 'Activate', { variant: isActive ? 'danger-soft' : 'secondary', size:'sm', onclick:"_umToggle('" + u.id + "')" });
    const actCell = acts ? '<div class="nx-rowact" style="justify-content:flex-end">' + acts + '</div>' : '';

    return [userCell, roleCell, contactCell, statusCell, lastCell, actCell];
  });

  wrap.innerHTML = NX.card(NX.table({ cols, rows, flush:true }), { flush:true });
}

// ── Row action: reset password ────────────────────────────────────────
async function _umResetPw(userId){
  const u = _usersData.find(function(x){ return x.id === userId; });
  if (!u) return;
  const userName  = u.full_name || u.username;
  const userEmail = u.email;
  const hasReal   = userEmail && !_isSyntheticEmail(userEmail);
  const confirmed = window.confirm(
    hasReal
      ? 'Email a temporary password to ' + userName + ' (' + userEmail + ')?\n\nThey will be required to change it at next login.'
      : 'Generate a temporary password for ' + userName + '?\n\nThis user has no email, so it will be shown to you once on screen to share with them. They must change it at next login.'
  );
  if (!confirmed) return;
  try {
    // Random temp password (12 chars, alphanumeric + symbols)
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let tmp = '';
    for (let i = 0; i < 12; i++) tmp += chars[Math.floor(Math.random() * chars.length)];

    const { data: res, error } = await supabase.rpc('admin_reset_subuser_password', {
      p_user_id:       userId,
      p_temp_password: tmp
    });
    if (error) throw error;
    if (!res || !res.reset) throw new Error('reset_failed');
    if (res.delivery === 'onscreen') {
      umShowTempPassword(userName, res.temp_password || tmp);
    } else {
      toast('Temporary password emailed to ' + userEmail, 'ok');
    }
  } catch(err) {
    console.error('[users] reset', err);
    toast('We couldn’t reset the password just now. Please try again.', 'err');
  }
}

// ── Row action: activate / deactivate ─────────────────────────────────
async function _umToggle(userId){
  const u = _usersData.find(function(x){ return x.id === userId; });
  if (!u) return;
  const isActive     = u.status === 'active';
  const targetStatus = isActive ? 'inactive' : 'active';
  if (!window.confirm((isActive ? 'Deactivate' : 'Activate') + ' ' + (u.full_name || u.username) + '?')) return;
  try {
    const { data, error } = await supabase.rpc('update_app_user', {
      p_user_id:    userId,
      p_company_id: S.cid,
      p_status:     targetStatus
    });
    if (error) throw error;
    if (!data || !data.success) throw new Error((data && data.message) || 'Update failed');
    toast(targetStatus === 'active' ? 'User activated' : 'User deactivated', 'ok');
    await _loadUsers();
  } catch(err) {
    toast(err.message || 'Error updating user', 'err');
  }
}

// ── Modal (host-injected kit modal) ───────────────────────────────────
function _umModalMarkup(mode, u) {
  const isEdit  = mode === 'edit';
  const coCode  = (typeof S !== 'undefined' && S && S.coCode) ? S.coCode : 'company';

  // Role options — exclude protected roles for new users; surface a disabled
  // protected option in edit mode so admin/owner accounts render their role.
  let roleVals = ['recovery','accounts','manager','staff'];
  let roleOpts = roleVals.map(function(r){
    const sel = (isEdit && u && u.role === r) ? ' selected' : '';
    return '<option value="' + r + '"' + sel + '>' + ROLE_LABELS[r] + '</option>';
  }).join('');
  if (isEdit && u && roleVals.indexOf(u.role) < 0 && u.role) {
    const protectedRole = (u.role === 'admin' || u.role === 'owner');
    roleOpts += '<option value="' + NX.esc(u.role) + '" selected' + (protectedRole ? ' disabled' : '') + '>' +
      NX.esc((ROLE_LABELS[u.role] || u.role) + (protectedRole ? ' (protected)' : '')) + '</option>';
  }

  const perms = (isEdit && u && u.module_permissions) ? u.module_permissions : {};
  const permCbs = MODULE_LIST.map(function(m){
    const ck = perms[m.key] ? ' checked' : '';
    return '<label style="display:inline-flex;align-items:center;gap:7px;font-size:var(--fk-fs-body);color:var(--fk-text);cursor:pointer">' +
      '<input type="checkbox" class="um-perm-cb" data-key="' + m.key + '"' + ck + '> ' + NX.esc(m.label) + '</label>';
  }).join('');

  const emailVal = (isEdit && u) ? (_isSyntheticEmail(u.email) ? '' : (u.email || '')) : '';

  // Username field — hidden in edit (the login identity isn't renamed here).
  const usernameBlock = isEdit ? '' :
    '<div class="nx-field" id="um-username-wrap"><label class="nx-label" for="um-username">Username <span class="nx-req">*</span></label>' +
      '<input class="nx-input" id="um-username" name="um-username" type="text" placeholder="e.g. jamal" autocomplete="off" oninput="umUnamePrev()">' +
      '<div class="nx-error" style="color:var(--fk-text-muted)">Lowercase letters, numbers, dot, dash. Signs in as <b><span id="um-uname-prev">username</span>@' + NX.esc(coCode) + '</b></div>' +
    '</div>';

  // Password — required for new users; optional change on edit.
  const passBlock = isEdit
    ? '<div class="nx-field"><label class="nx-label" for="um-pass-edit">New password <span style="color:var(--fk-text-muted)">(leave blank to keep current)</span></label>' +
        '<input class="nx-input" id="um-pass-edit" type="password" placeholder="Leave blank to keep unchanged" autocomplete="new-password"></div>'
    : '<div class="nx-field"><label class="nx-label" for="um-pass">Password <span class="nx-req">*</span></label>' +
        '<input class="nx-input" id="um-pass" type="password" placeholder="Min 8 characters" autocomplete="new-password"></div>';

  const body =
    '<input type="hidden" id="um-id" value="' + (isEdit && u ? NX.esc(u.id) : '') + '">' +
    NX.field({ label:'Full name', name:'um-name', required:true, value:(isEdit && u ? (u.full_name || '') : ''), placeholder:'Ahmed Khan', attrs:(isEdit ? '' : 'oninput="umSuggestFromName()"') }) +
    usernameBlock +
    '<div class="nx-field"><label class="nx-label" for="um-role">Role <span class="nx-req">*</span></label><select class="nx-select" id="um-role">' + roleOpts + '</select></div>' +
    _umProjectsBlock() +
    '<div class="nx-field"><label class="nx-label" for="um-email">Email <span style="color:var(--fk-text-muted)">(optional)</span></label>' +
      '<input class="nx-input" id="um-email" type="email" value="' + NX.esc(emailVal) + '" placeholder="only for password-reset emails">' +
      '<div class="nx-error" style="color:var(--fk-text-muted)">Leave blank if the user has no email — you’ll set a temporary password and see it on screen.</div></div>' +
    NX.field({ label:'Phone', name:'um-phone', type:'tel', value:(isEdit && u ? (u.phone || '') : ''), placeholder:'+92 300 0000000' }) +
    passBlock +
    '<div class="nx-field"><label class="nx-label">Module access</label>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;padding:12px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control)">' + permCbs + '</div>' +
      '<div class="nx-error" style="color:var(--fk-text-muted)">Leave all unchecked for role-default access.</div></div>' +
    '<div class="nx-error" id="um-err" style="display:none"></div>';

  return NX.modal({
    title: isEdit ? 'Edit user' : 'Add user',
    size: 'm',
    onClose: '_umCloseModal()',
    body: body,
    footer:
      NX.button('Cancel', { variant:'ghost', onclick:'_umCloseModal()' }) +
      NX.button(isEdit ? 'Save changes' : 'Create user', { variant:'primary', attrs:'id="um-save-btn"', onclick:'saveUserModal()' })
  });
}

function _umCloseModal(){ var h=document.getElementById('um-modal-host'); if(h) h.innerHTML=''; }

async function openAddUserModal() {
  const host = document.getElementById('um-modal-host');
  if (!host) return;
  _umAssigned = [];
  await _umLoadProjects();
  host.innerHTML = _umModalMarkup('add', null);
  umUnamePrev();
}

async function openEditUserModal(userId) {
  var u = null;
  for (var i = 0; i < _usersData.length; i++) {
    if (_usersData[i].id === userId) { u = _usersData[i]; break; }
  }
  if (!u) return;
  const host = document.getElementById('um-modal-host');
  if (!host) return;
  await _umLoadProjects();
  _umAssigned = [];
  try {
    const { data } = await supabase.rpc('get_user_projects', { p_user_id: userId });
    if (data && data.success && Array.isArray(data.rows)) _umAssigned = data.rows.map(function(r){ return r.project_id; });
  } catch(_) {}
  host.innerHTML = _umModalMarkup('edit', u);
}

// ── Save ──────────────────────────────────────────────────────────────
async function saveUserModal() {
  if (typeof demoGuard === 'function' && demoGuard('Save User')) return;

  var uid    = document.getElementById('um-id').value;
  var name   = document.getElementById('um-name').value.trim();
  var unameEl = document.getElementById('um-username');
  var username = unameEl ? unameEl.value.trim().toLowerCase() : '';
  var role   = document.getElementById('um-role').value;
  var email  = document.getElementById('um-email').value.trim();
  var phone  = document.getElementById('um-phone').value.trim();
  var isEdit = !!uid;
  var errEl  = document.getElementById('um-err');
  var btn    = document.getElementById('um-save-btn');

  var passEditEl = document.getElementById('um-pass-edit');
  var passNewEl  = document.getElementById('um-pass');
  var pass = isEdit ? ((passEditEl && passEditEl.value) || null) : (passNewEl ? passNewEl.value : '');

  var showErr = function(msg){ errEl.textContent = msg; errEl.style.display = ''; };
  errEl.style.display = 'none';

  if (!name) { showErr('Full name is required.'); return; }

  if (!isEdit) {
    if (!username) { showErr('Username is required.'); return; }
    if (!/^[a-z0-9._-]{2,30}$/.test(username)) { showErr('Username must be 2–30 characters: lowercase letters, numbers, dot, dash or underscore.'); return; }
    if (!pass) { showErr('Password is required.'); return; }
    if (typeof validatePasswordStrength === 'function') {
      var chk = validatePasswordStrength(pass);
      if (!chk.valid) { showErr(chk.message); return; }
    } else if (pass.length < 8) {
      showErr('Password must be at least 8 characters.'); return;
    }
  }

  if (isEdit && pass && pass.length > 0) {
    if (typeof validatePasswordStrength === 'function') {
      var chk2 = validatePasswordStrength(pass);
      if (!chk2.valid) { showErr(chk2.message); return; }
    } else if (pass.length < 8) {
      showErr('New password must be at least 8 characters.'); return;
    }
  }

  var perms = {};
  document.querySelectorAll('.um-perm-cb').forEach(function(cb){
    if (cb.checked) perms[cb.dataset.key] = true;
  });
  var modulePerms = Object.keys(perms).length ? perms : {};

  // Project assignments — the set the admin checked in the picker. Sent on both
  // create and update so a recovery officer is actually scoped to projects.
  var projIds = [];
  document.querySelectorAll('.um-proj-cb').forEach(function(cb){
    if (cb.checked) projIds.push(cb.dataset.id);
  });

  if (!isEdit) {
    var limRes;
    try { limRes = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: S.cid }); }
    catch(e) { showErr('Could not verify plan limits.'); return; }
    if (limRes && limRes.error) { showErr('Could not verify plan limits.'); return; }
    var maxU2 = (limRes && limRes.data && limRes.data.max_users)   || 0;
    var curU2 = (limRes && limRes.data && limRes.data.count_users) || 0;
    if (maxU2 > 0 && curU2 >= maxU2) {
      showErr('User limit reached — upgrade your plan to add more.'); return;
    }
  }

  btn.disabled = true;

  try {
    var res, error;

    if (isEdit) {
      var r1 = await supabase.rpc('update_app_user', {
        p_user_id:            uid,
        p_company_id:         S.cid,
        p_full_name:          name,
        p_role:               role,
        p_email:              email || null,
        p_phone:              phone || null,
        p_password:           pass,
        p_module_permissions: modulePerms,
        p_project_ids:        projIds
      });
      res = r1.data; error = r1.error;
    } else {
      var r2 = await supabase.rpc('create_app_user', {
        p_company_id:         S.cid,
        p_full_name:          name,
        p_role:               role,
        p_password:           pass,
        p_email:              email || null,
        p_phone:              phone || null,
        p_module_permissions: modulePerms,
        p_username:           username || null,
        p_project_ids:        projIds
      });
      res = r2.data; error = r2.error;
    }

    if (error) throw error;
    if (!res || !res.success) throw new Error((res && res.message) || 'Operation failed.');

    if (isEdit) {
      if (typeof loadAppUsersCache === 'function') loadAppUsersCache(S.cid).catch(function(){});
      if (uid === S.userId) {
        S.permissions = modulePerms;
        sessionStorage.setItem('nxn_sess', JSON.stringify(S));
      }
    }

    _umCloseModal();
    toast(isEdit ? 'User updated.' : ('User created. Username: ' + res.username), 'ok');
    await _loadUsers();

  } catch(e) {
    showErr(e.message || 'An error occurred.');
  } finally {
    btn.disabled = false;
  }
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
