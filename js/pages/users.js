// ══ USER MANAGEMENT ══════════════════════════════════════════════════

const ROLE_LABELS = {
  owner:    'Owner',
  admin:    'Admin',
  recovery: 'Recovery',
  accounts: 'Accounts',
  manager:  'Manager',
  staff:    'Staff'
};

const ROLE_COLORS = {
  owner:    '#7C3AED',
  admin:    '#2563EB',
  manager:  '#0284C7',
  recovery: '#D97706',
  accounts: '#059669',
  staff:    '#6B7280'
};

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

// ── Page entry ────────────────────────────────────────────────────────
async function rUsers() {
  const el = document.getElementById('pg-users');
  if (!el) return;

  if (!S || (S.role !== 'admin' && S.role !== 'owner')) {
    el.innerHTML = '<div class="ph"><h2>Access Denied</h2><p>Admins only.</p></div>';
    return;
  }

  el.innerHTML = '<div class="ani" id="um-root"></div>' + _buildUserModal();

  const root = document.getElementById('um-root');

  // Header
  const hd = document.createElement('div');
  hd.className = 'um-hd';
  hd.innerHTML =
    '<div class="um-hd-l">' +
      '<div class="um-hd-icon">' + _sbi('users', 20) + '</div>' +
      '<div>' +
        '<h2 class="um-hd-title">Users &amp; Roles</h2>' +
        '<p class="um-hd-sub">Manage staff accounts, roles and permissions</p>' +
      '</div>' +
    '</div>';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.id = 'um-add-btn';
  addBtn.textContent = '+ Add User';
  addBtn.addEventListener('click', function() { openAddUserModal(); });
  hd.appendChild(addBtn);
  root.appendChild(hd);

  // Stats row
  const statsRow = document.createElement('div');
  statsRow.className = 'um-stats';
  statsRow.id = 'um-stats';
  statsRow.style.display = 'none';
  statsRow.innerHTML =
    '<div class="um-stat"><div class="um-stat-n" id="ums-total">0</div><div class="um-stat-l">Total</div></div>' +
    '<div class="um-stat"><div class="um-stat-n um-stat-green" id="ums-active">0</div><div class="um-stat-l">Active</div></div>' +
    '<div class="um-stat"><div class="um-stat-n um-stat-red" id="ums-inactive">0</div><div class="um-stat-l">Inactive</div></div>';
  root.appendChild(statsRow);

  // List container
  const wrap = document.createElement('div');
  wrap.id = 'users-list-wrap';
  wrap.innerHTML = '<div class="um-loading">Loading users...</div>';
  root.appendChild(wrap);

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
      btn.textContent = '+ Add User (' + curU + '/' + maxU + ')';
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
    if (wrap) wrap.innerHTML = '<div class="card"><div class="cb" style="color:var(--err);padding:24px">Failed to load: ' + _esc(e.message) + '</div></div>';
  }
}

// ── Render — uses createElement so listeners attach directly to DOM nodes ──
function _renderUsersList() {
  const wrap = document.getElementById('users-list-wrap');
  if (!wrap) return;

  // Stats
  const statsEl = document.getElementById('um-stats');
  if (statsEl) {
    statsEl.style.display = '';
    const activeCount = _usersData.filter(function(u) { return u.status === 'active'; }).length;
    var te = document.getElementById('ums-total');   if (te) te.textContent = _usersData.length;
    var ae = document.getElementById('ums-active');  if (ae) ae.textContent = activeCount;
    var ie = document.getElementById('ums-inactive');if (ie) ie.textContent = _usersData.length - activeCount;
  }

  // Clear
  wrap.innerHTML = '';

  if (!_usersData.length) {
    wrap.innerHTML = '<div class="card"><div class="cb" style="text-align:center;padding:48px;color:var(--t3)">No users found.</div></div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'um-grid';

  _usersData.forEach(function(u) {
    var isOwner     = u.role === 'owner';
    var isAdminRole = u.role === 'admin' || u.role === 'owner';
    var isSelf      = u.id === S.userId;
    var isActive    = u.status === 'active';
    var initial  = ((u.full_name || u.username || '?').charAt(0)).toUpperCase();
    var rc       = ROLE_COLORS[u.role] || '#6B7280';
    var rl       = ROLE_LABELS[u.role] || u.role;
    var newSt    = isActive ? 'inactive' : 'active';

    // Card
    const card = document.createElement('div');
    card.className = 'um-card' + (isActive ? '' : ' um-card-off');
    card.style.setProperty('--um-accent', 'linear-gradient(90deg,' + rc + ',' + rc + 'cc)');
    card._sk = true; // already has custom sleek effects — skip global observer

    // Always-on 3D — filter:drop-shadow() bypasses parent overflow clipping
    var filterRest  = 'drop-shadow(0 4px 2px rgba(0,0,0,.35)) drop-shadow(0 10px 16px rgba(0,0,0,.25))';
    var filterHover = 'drop-shadow(0 8px 4px rgba(0,0,0,.40)) drop-shadow(0 20px 28px rgba(0,0,0,.32))';
    card.style.filter     = filterRest;
    card.style.transition = 'transform .22s cubic-bezier(.34,1.56,.64,1), filter .22s ease';

    if (isActive) {
      card.addEventListener('mouseenter', function() {
        card.style.transform = 'translateY(-6px) scale(1.013)';
        card.style.filter    = filterHover;
      });
      card.addEventListener('mouseleave', function() {
        card.style.transform = '';
        card.style.filter    = filterRest;
      });
    }

    // ── Body wrapper ─────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'um-card-body';

    // Top row: avatar + name + role pill
    const top = document.createElement('div');
    top.className = 'um-card-top';

    const av = document.createElement('div');
    av.className = 'um-av';
    av.style.background = 'linear-gradient(135deg,' + rc + ' 0%,' + rc + 'aa 100%)';
    av.textContent = initial;

    const inf = document.createElement('div');
    inf.className = 'um-card-inf';
    inf.innerHTML =
      '<div class="um-card-name">' + _esc(u.full_name || u.username) + '</div>' +
      '<div class="um-card-uname">@' + _esc(u.username) + '</div>';

    const pill = document.createElement('span');
    pill.className = 'um-rpill';
    pill.style.cssText = 'background:' + rc + '1a;color:' + rc + ';border-color:' + rc + '44';
    pill.textContent = rl;

    top.appendChild(av);
    top.appendChild(inf);
    top.appendChild(pill);
    body.appendChild(top);

    // Contact info
    if (u.email || u.phone) {
      const meta = document.createElement('div');
      meta.className = 'um-card-meta';
      if (u.email) {
        const em = document.createElement('div');
        em.className = 'um-card-row';
        em.innerHTML = _sbi('mail', 12) + ' ' + _esc(u.email);
        meta.appendChild(em);
      }
      if (u.phone) {
        const ph = document.createElement('div');
        ph.className = 'um-card-row';
        ph.innerHTML = _sbi('phone', 12) + ' ' + _esc(u.phone);
        meta.appendChild(ph);
      }
      body.appendChild(meta);
    }

    card.appendChild(body);

    // ── Divider ───────────────────────────────────────────────────────
    const div = document.createElement('div');
    div.className = 'um-card-div';
    card.appendChild(div);

    // ── Footer ────────────────────────────────────────────────────────
    const ft = document.createElement('div');
    ft.className = 'um-card-ft';

    // Status dot + label
    const statusRow = document.createElement('div');
    statusRow.className = 'um-status-row';
    const dot = document.createElement('span');
    dot.className = 'um-dot ' + (isActive ? 'um-dot-on' : 'um-dot-off');
    const statusLbl = document.createElement('span');
    statusLbl.style.cssText = 'color:' + (isActive ? '#22c55e' : 'var(--t3)') + ';font-size:12px;font-weight:600';
    statusLbl.textContent = isActive ? 'Active' : 'Inactive';
    statusRow.appendChild(dot);
    statusRow.appendChild(statusLbl);
    ft.appendChild(statusRow);

    const acts = document.createElement('div');
    acts.className = 'um-card-acts';

    // Edit button
    if (!isOwner) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-sm btn-gh';
      editBtn.textContent = 'Edit';
      (function(userId) {
        editBtn.addEventListener('click', function() {
          openEditUserModal(userId);
        });
      })(u.id);
      acts.appendChild(editBtn);
    }

    // Reset Password button — admin/owner only, non-admin sub-users only
    if (!isOwner && !isAdminRole && isActive) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-sm btn-gh';
      resetBtn.title = 'Send a temporary password to this user\'s email';
      resetBtn.innerHTML = _sbi('key', 12) + ' Reset Pwd';
      (function(userId, userName, userEmail) {
        resetBtn.addEventListener('click', async function() {
          if (!userEmail) {
            toast('No email address on file for this user — cannot send temp password.', 'err');
            return;
          }
          const confirmed = window.confirm(
            'Send a temporary password to ' + userName + ' (' + userEmail + ')?\n\n' +
            'They will be required to change it on next login.'
          );
          if (!confirmed) return;
          resetBtn.disabled = true;
          resetBtn.textContent = '…';
          try {
            // Generate a random temp password (12 chars, alphanumeric + symbols)
            const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
            let tmp = '';
            for (let i = 0; i < 12; i++) tmp += chars[Math.floor(Math.random() * chars.length)];

            const { data: res, error } = await supabase.rpc('admin_reset_subuser_password', {
              p_user_id:       userId,
              p_temp_password: tmp
            });
            if (error) throw error;
            if (!res?.reset) throw new Error(res?.error || 'Reset failed');
            toast('Temporary password sent to ' + (userEmail || userName), 'ok');
          } catch(err) {
            toast(err.message || 'Could not reset password', 'err');
          } finally {
            resetBtn.disabled = false;
            resetBtn.innerHTML = _sbi('key', 12) + ' Reset Pwd';
          }
        });
      })(u.id, u.full_name || u.username, u.email);
      acts.appendChild(resetBtn);
    }

    // Deactivate / Activate button
    if (!isOwner && !isSelf) {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-sm ' + (isActive ? 'btn-r' : 'btn-g');
      toggleBtn.textContent = isActive ? 'Deactivate' : 'Activate';

      (function(userId, targetStatus, btnEl, origLabel) {
        btnEl.addEventListener('click', async function() {
          btnEl.disabled = true;
          btnEl.textContent = '...';
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
            btnEl.disabled = false;
            btnEl.textContent = origLabel;
            toast(err.message || 'Error updating user', 'err');
          }
        });
      })(u.id, newSt, toggleBtn, isActive ? 'Deactivate' : 'Activate');

      acts.appendChild(toggleBtn);
    }

    ft.appendChild(acts);
    card.appendChild(ft);
    grid.appendChild(card);
  });

  wrap.appendChild(grid);
}

// ── Modal HTML ────────────────────────────────────────────────────────
function _buildUserModal() {
  var roleOpts = ['recovery','accounts','manager','staff'].map(function(r){
    return '<option value="' + r + '">' + ROLE_LABELS[r] + '</option>';
  }).join('');

  var permCbs = MODULE_LIST.map(function(m){
    return '<label class="um-perm-lbl"><input type="checkbox" class="um-perm-cb" data-key="' + m.key + '"> ' + m.label + '</label>';
  }).join('');

  return '' +
    '<div class="mov" id="m-user">' +
      '<div class="mo-box" style="max-width:480px;width:100%">' +
        '<div class="mo-hd">' +
          '<span id="um-title">Add User</span>' +
          '<button class="mo-cl" onclick="cm(\'m-user\')">&#x2715;</button>' +
        '</div>' +
        '<div class="mo-bd">' +
          '<input type="hidden" id="um-id">' +
          '<div class="fo"><label class="fl">Full Name *</label><input id="um-name" class="fi" type="text" placeholder="Ahmed Khan"></div>' +
          '<div class="fo"><label class="fl">Role *</label><select id="um-role" class="fi">' + roleOpts + '</select></div>' +
          '<div class="fo"><label class="fl">Email</label><input id="um-email" class="fi" type="email" placeholder="staff@company.com"></div>' +
          '<div class="fo"><label class="fl">Phone</label><input id="um-phone" class="fi" type="tel" placeholder="+92 300 0000000"></div>' +
          '<div class="fo" id="um-pass-wrap"><label class="fl">Password *</label><input id="um-pass" class="fi" type="password" placeholder="Min 8 characters"></div>' +
          '<div class="fo" id="um-pass-edit-wrap" style="display:none"><label class="fl">New Password <span style="opacity:.5">(leave blank to keep current)</span></label><input id="um-pass-edit" class="fi" type="password" placeholder="Leave blank to keep unchanged"></div>' +
          '<div class="fo">' +
            '<label class="fl" style="margin-bottom:8px">Module Access</label>' +
            '<div class="um-perms-grid">' + permCbs + '</div>' +
            '<div style="font-size:11px;color:var(--t3);margin-top:6px">Leave unchecked for role-default access.</div>' +
          '</div>' +
          '<div id="um-err" style="display:none;color:var(--err);font-size:12px;padding:8px 0"></div>' +
        '</div>' +
        '<div class="mo-ft">' +
          '<button class="btn btn-gh" onclick="cm(\'m-user\')">Cancel</button>' +
          '<button class="btn btn-primary" id="um-save-btn" onclick="saveUserModal()">Create User</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// ── Open modals ───────────────────────────────────────────────────────
function openAddUserModal() {
  document.getElementById('um-title').textContent = 'Add User';
  document.getElementById('um-id').value    = '';
  document.getElementById('um-name').value  = '';
  document.getElementById('um-role').value  = 'recovery';
  document.getElementById('um-email').value = '';
  document.getElementById('um-phone').value = '';
  document.getElementById('um-pass').value  = '';
  document.getElementById('um-pass-wrap').style.display      = '';
  document.getElementById('um-pass-edit-wrap').style.display = 'none';
  document.getElementById('um-save-btn').textContent = 'Create User';
  document.getElementById('um-err').style.display = 'none';
  document.querySelectorAll('.um-perm-cb').forEach(function(cb){ cb.checked = false; });
  om('m-user');
}

function openEditUserModal(userId) {
  var u = null;
  for (var i = 0; i < _usersData.length; i++) {
    if (_usersData[i].id === userId) { u = _usersData[i]; break; }
  }
  if (!u) return;

  document.getElementById('um-title').textContent = 'Edit User';
  document.getElementById('um-id').value    = u.id;
  document.getElementById('um-name').value  = u.full_name || '';
  document.getElementById('um-email').value = u.email || '';
  document.getElementById('um-phone').value = u.phone || '';
  document.getElementById('um-pass').value  = '';
  document.getElementById('um-pass-wrap').style.display      = 'none';
  document.getElementById('um-pass-edit-wrap').style.display = '';
  document.getElementById('um-pass-edit').value = '';
  document.getElementById('um-save-btn').textContent = 'Save Changes';
  document.getElementById('um-err').style.display = 'none';

  var roleSel = document.getElementById('um-role');
  var hasRole = Array.from(roleSel.options).some(function(o){ return o.value === u.role; });
  if (!hasRole && u.role) {
    var opt = document.createElement('option');
    opt.value = u.role;
    opt.textContent = (ROLE_LABELS[u.role] || u.role) + (u.role === 'admin' || u.role === 'owner' ? ' (protected)' : '');
    if (u.role === 'admin' || u.role === 'owner') opt.disabled = true;
    roleSel.appendChild(opt);
  }
  roleSel.value = u.role || 'staff';

  var perms = u.module_permissions || {};
  document.querySelectorAll('.um-perm-cb').forEach(function(cb){
    cb.checked = !!perms[cb.dataset.key];
  });

  om('m-user');
}

// ── Save ──────────────────────────────────────────────────────────────
async function saveUserModal() {
  if (typeof demoGuard === 'function' && demoGuard('Save User')) return;

  var uid    = document.getElementById('um-id').value;
  var name   = document.getElementById('um-name').value.trim();
  var role   = document.getElementById('um-role').value;
  var email  = document.getElementById('um-email').value.trim();
  var phone  = document.getElementById('um-phone').value.trim();
  var isEdit = !!uid;
  var errEl  = document.getElementById('um-err');
  var btn    = document.getElementById('um-save-btn');

  var pass = isEdit
    ? (document.getElementById('um-pass-edit').value || null)
    : document.getElementById('um-pass').value;

  errEl.style.display = 'none';

  if (!name) { errEl.textContent = 'Full name is required.'; errEl.style.display = ''; return; }

  if (!isEdit) {
    if (!pass) { errEl.textContent = 'Password is required.'; errEl.style.display = ''; return; }
    if (typeof validatePasswordStrength === 'function') {
      var chk = validatePasswordStrength(pass);
      if (!chk.valid) { errEl.textContent = chk.message; errEl.style.display = ''; return; }
    } else if (pass.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.'; errEl.style.display = ''; return;
    }
  }

  if (isEdit && pass && pass.length > 0) {
    if (typeof validatePasswordStrength === 'function') {
      var chk2 = validatePasswordStrength(pass);
      if (!chk2.valid) { errEl.textContent = chk2.message; errEl.style.display = ''; return; }
    } else if (pass.length < 8) {
      errEl.textContent = 'New password must be at least 8 characters.'; errEl.style.display = ''; return;
    }
  }

  var perms = {};
  document.querySelectorAll('.um-perm-cb').forEach(function(cb){
    if (cb.checked) perms[cb.dataset.key] = true;
  });
  var modulePerms = Object.keys(perms).length ? perms : {};

  if (!isEdit) {
    var limRes;
    try { limRes = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: S.cid }); }
    catch(e) { errEl.textContent = 'Could not verify plan limits.'; errEl.style.display = ''; return; }
    if (limRes && limRes.error) { errEl.textContent = 'Could not verify plan limits.'; errEl.style.display = ''; return; }
    var maxU2 = (limRes && limRes.data && limRes.data.max_users)   || 0;
    var curU2 = (limRes && limRes.data && limRes.data.count_users) || 0;
    if (maxU2 > 0 && curU2 >= maxU2) {
      errEl.textContent = 'User limit reached — upgrade your plan to add more.'; errEl.style.display = ''; return;
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
        p_module_permissions: modulePerms
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
        p_module_permissions: modulePerms
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

    cm('m-user');
    toast(isEdit ? 'User updated.' : ('User created. Username: ' + res.username), 'ok');
    await _loadUsers();

  } catch(e) {
    errEl.textContent = e.message || 'An error occurred.';
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
  }
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
