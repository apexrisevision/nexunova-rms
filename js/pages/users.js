// ══ USER MANAGEMENT PAGE ═════════════════════════════════════════════

const ROLE_LABELS = {
  owner:    'Owner / Admin',
  admin:    'Admin / CFO',
  recovery: 'Recovery Staff',
  accounts: 'Accounts Staff',
  manager:  'Manager',
  staff:    'Staff'
};

const MODULE_LIST = [
  { key: 'projects',   label: 'Projects' },
  { key: 'units',      label: 'Units' },
  { key: 'clients',    label: 'Clients' },
  { key: 'recovery',   label: 'Payments' },
  { key: 'contacts',   label: 'Activity Log' },
  { key: 'reports',    label: 'Reports' },
  { key: 'documents',  label: 'Documents' },
  { key: 'agents',     label: 'Agents' },
  { key: 'search',     label: 'Quick Search' },
];

let _usersData = [];

async function rUsers() {
  const el = document.getElementById('pg-users');
  if (!el) return;

  if (!S || (S.role !== 'admin' && S.role !== 'owner')) {
    el.innerHTML = `<div class="ph"><h2>Access Denied</h2><p>User Management is for admins only.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="ph">
      <div>
        <h2>User Management</h2>
        <p>Manage staff accounts and permissions for your company.</p>
      </div>
      <button class="btn btn-primary" id="um-add-btn" onclick="openAddUserModal()">+ Add User</button>
    </div>
    <div id="users-list-wrap">
      <div class="card"><div class="cb" style="text-align:center;padding:32px;color:var(--t3)">Loading users…</div></div>
    </div>
    ${_buildUserModal()}
  `;

  await _loadUsers();
  await _checkUserLimitUI();
}

async function _checkUserLimitUI() {
  const btn = document.getElementById('um-add-btn');
  if (!btn) return;
  try {
    const [subRes, usersRes] = await Promise.all([
      supabase.from('subscriptions').select('subscription_plans(max_users)')
        .eq('company_id', S.cid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('company_id', S.cid).eq('status', 'active')
    ]);
    if (subRes?.error || usersRes?.error) return;
    const maxUsers    = subRes.data?.subscription_plans?.max_users ?? 0;
    const currentUsers = usersRes.count || 0;
    if (maxUsers > 0 && currentUsers >= maxUsers) {
      btn.disabled = true;
      btn.title = `User limit reached (${currentUsers}/${maxUsers}). Upgrade your plan to add more.`;
      btn.textContent = `+ Add User (${currentUsers}/${maxUsers})`;
    }
  } catch(e) { /* UI hint only — not blocking */ }
}

async function _loadUsers() {
  try {
    const { data, error } = await supabase.rpc('list_app_users', { p_company_id: S.cid });
    if (error) throw error;
    _usersData = Array.isArray(data) ? data : [];
    _renderUsersList();
  } catch(e) {
    const wrap = document.getElementById('users-list-wrap');
    if (wrap) wrap.innerHTML = `<div class="card"><div class="cb" style="color:var(--err);padding:24px">Failed to load users: ${e.message}</div></div>`;
  }
}

function _renderUsersList() {
  const wrap = document.getElementById('users-list-wrap');
  if (!wrap) return;

  if (!_usersData.length) {
    wrap.innerHTML = `<div class="card"><div class="cb" style="text-align:center;padding:32px;color:var(--t3)">No users found.</div></div>`;
    return;
  }

  const rows = _usersData.map(u => {
    const isOwner = u.role === 'owner';
    const isSelf  = u.id === S.userId;
    const inactive = u.status !== 'active';

    return `
      <tr style="${inactive ? 'opacity:.5' : ''}">
        <td>
          <div style="font-weight:600;color:var(--text)">${_esc(u.full_name)}</div>
          <div style="font-size:11px;color:var(--t3);font-family:monospace">${_esc(u.username)}</div>
        </td>
        <td><span class="badge">${ROLE_LABELS[u.role] || u.role}</span></td>
        <td style="color:var(--t3);font-size:12px">${_esc(u.email || '—')}</td>
        <td>
          <span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}">${u.status}</span>
        </td>
        <td style="text-align:right">
          ${!isOwner ? `<button class="btn btn-sm btn-gh" onclick="openEditUserModal('${u.id}')">Edit</button>` : ''}
          ${!isOwner && !isSelf ? `
            <button class="btn btn-sm ${inactive ? 'btn-primary' : 'btn-danger'}" style="margin-left:4px"
              onclick="toggleUserStatus('${u.id}','${inactive ? 'active' : 'inactive'}')">
              ${inactive ? 'Activate' : 'Deactivate'}
            </button>` : ''}
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card">
      <div class="ch"><h3>All Users (${_usersData.length})</h3></div>
      <div class="cb" style="padding:0;overflow-x:auto">
        <table class="tbl" style="width:100%">
          <thead><tr>
            <th>Name / Username</th>
            <th>Role</th>
            <th>Email</th>
            <th>Status</th>
            <th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function _buildUserModal() {
  const roleOpts = ['recovery','accounts','manager','staff'].map(r =>
    `<option value="${r}">${ROLE_LABELS[r]}</option>`
  ).join('');

  const permCheckboxes = MODULE_LIST.map(m => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px;color:var(--t2)">
      <input type="checkbox" class="um-perm-cb" data-key="${m.key}" style="width:15px;height:15px;cursor:pointer">
      ${m.label}
    </label>`).join('');

  return `
    <div class="mov" id="m-user">
      <div class="mo" style="max-width:480px;width:100%">
        <div class="mo-hd">
          <span id="um-title">Add User</span>
          <button class="mo-x" onclick="cm('m-user')">✕</button>
        </div>
        <div class="mo-bd">
          <input type="hidden" id="um-id">
          <div class="fo">
            <label class="fl">Full Name *</label>
            <input id="um-name" class="fi" type="text" placeholder="e.g. Ahmed Khan">
          </div>
          <div class="fo">
            <label class="fl">Role *</label>
            <select id="um-role" class="fi">${roleOpts}</select>
          </div>
          <div class="fo">
            <label class="fl">Email</label>
            <input id="um-email" class="fi" type="email" placeholder="staff@yourbusiness.com">
          </div>
          <div class="fo">
            <label class="fl">Phone</label>
            <input id="um-phone" class="fi" type="tel" placeholder="+92 300 0000000">
          </div>
          <div class="fo" id="um-pass-wrap">
            <label class="fl">Password *</label>
            <input id="um-pass" class="fi" type="password" placeholder="Min 8 characters">
          </div>
          <div class="fo" id="um-pass-edit-wrap" style="display:none">
            <label class="fl">New Password <span style="opacity:.5">(leave blank to keep current)</span></label>
            <input id="um-pass-edit" class="fi" type="password" placeholder="Leave blank to keep unchanged">
          </div>
          <div class="fo">
            <label class="fl" style="margin-bottom:8px">Module Access</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px">
              ${permCheckboxes}
            </div>
            <div style="font-size:11px;color:var(--t3);margin-top:6px">Leave blank to grant default access based on role.</div>
          </div>
          <div id="um-err" style="display:none;color:var(--err);font-size:12px;padding:8px 0"></div>
        </div>
        <div class="mo-ft">
          <button class="btn btn-ghost" onclick="cm('m-user')">Cancel</button>
          <button class="btn btn-primary" id="um-save-btn" onclick="saveUserModal()">Create User</button>
        </div>
      </div>
    </div>`;
}

function openAddUserModal() {
  document.getElementById('um-title').textContent = 'Add User';
  document.getElementById('um-id').value = '';
  document.getElementById('um-name').value = '';
  document.getElementById('um-role').value = 'recovery';
  document.getElementById('um-email').value = '';
  document.getElementById('um-phone').value = '';
  document.getElementById('um-pass').value = '';
  document.getElementById('um-pass-wrap').style.display = '';
  document.getElementById('um-pass-edit-wrap').style.display = 'none';
  document.getElementById('um-save-btn').textContent = 'Create User';
  document.getElementById('um-err').style.display = 'none';
  document.querySelectorAll('.um-perm-cb').forEach(cb => cb.checked = false);
  om('m-user');
}

function openEditUserModal(userId) {
  const u = _usersData.find(x => x.id === userId);
  if (!u) return;

  document.getElementById('um-title').textContent = 'Edit User';
  document.getElementById('um-id').value = u.id;
  document.getElementById('um-name').value = u.full_name || '';

  // Inject the user's current role if it isn't already in the static list
  // (e.g. 'admin' or 'owner'). Without this guard, `select.value = 'admin'`
  // silently snaps to the first option and a save would demote the user.
  const roleSel = document.getElementById('um-role');
  if (roleSel && u.role && !Array.from(roleSel.options).some(o => o.value === u.role)) {
    const lbl = (typeof ROLE_LABELS !== 'undefined' && ROLE_LABELS[u.role]) || u.role;
    const opt = document.createElement('option');
    opt.value = u.role;
    opt.textContent = lbl + (u.role === 'admin' || u.role === 'owner' ? ' (protected)' : '');
    if (u.role === 'admin' || u.role === 'owner') opt.disabled = true;
    roleSel.appendChild(opt);
  }
  roleSel.value = u.role || 'staff';
  document.getElementById('um-email').value = u.email || '';
  document.getElementById('um-phone').value = u.phone || '';
  document.getElementById('um-pass').value = '';
  document.getElementById('um-pass-wrap').style.display = 'none';
  document.getElementById('um-pass-edit-wrap').style.display = '';
  document.getElementById('um-pass-edit').value = '';
  document.getElementById('um-save-btn').textContent = 'Save Changes';
  document.getElementById('um-err').style.display = 'none';

  const perms = u.module_permissions || {};
  document.querySelectorAll('.um-perm-cb').forEach(cb => {
    cb.checked = !!perms[cb.dataset.key];
  });

  om('m-user');
}

async function saveUserModal() {
  if (typeof demoGuard === 'function' && demoGuard('Save User')) return;
  const uid     = document.getElementById('um-id').value;
  const name    = document.getElementById('um-name').value.trim();
  const role    = document.getElementById('um-role').value;
  const email   = document.getElementById('um-email').value.trim();
  const phone   = document.getElementById('um-phone').value.trim();
  const isEdit  = !!uid;
  const errEl   = document.getElementById('um-err');
  const btn     = document.getElementById('um-save-btn');

  const pass = isEdit
    ? (document.getElementById('um-pass-edit').value || null)
    : document.getElementById('um-pass').value;

  errEl.style.display = 'none';

  if (!name) { errEl.textContent = 'Full name is required.'; errEl.style.display = ''; return; }
  if (!isEdit) {
    if (!pass) {
      errEl.textContent = 'Password is required.';
      errEl.style.display = '';
      return;
    }
    if (typeof validatePasswordStrength === 'function') {
      const chk = validatePasswordStrength(pass);
      if (!chk.valid) { errEl.textContent = chk.message; errEl.style.display = ''; return; }
    } else if (pass.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.style.display = '';
      return;
    }
  }
  if (isEdit && pass !== null && pass.length > 0) {
    if (typeof validatePasswordStrength === 'function') {
      const chk = validatePasswordStrength(pass);
      if (!chk.valid) { errEl.textContent = chk.message; errEl.style.display = ''; return; }
    } else if (pass.length < 8) {
      errEl.textContent = 'New password must be at least 8 characters.';
      errEl.style.display = '';
      return;
    }
  }

  // Collect module permissions
  const perms = {};
  document.querySelectorAll('.um-perm-cb').forEach(cb => {
    if (cb.checked) perms[cb.dataset.key] = true;
  });
  const modulePerms = Object.keys(perms).length ? perms : {};

  // Plan limit check — only when creating a new user, not editing
  if (!isEdit) {
    let subRes, usersRes;
    try {
      [subRes, usersRes] = await Promise.all([
        supabase.from('subscriptions').select('subscription_plans(max_users)')
          .eq('company_id', S.cid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('company_id', S.cid).eq('status', 'active')
      ]);
    } catch(e) {
      errEl.textContent = 'Could not verify plan limits. Please check your connection and try again.';
      errEl.style.display = '';
      return;
    }
    if (subRes?.error || usersRes?.error) {
      errEl.textContent = 'Could not verify plan limits. Please check your connection and try again.';
      errEl.style.display = '';
      return;
    }
    const maxUsers    = subRes.data?.subscription_plans?.max_users ?? 0;
    const currentUsers = usersRes.count || 0;
    if (maxUsers > 0 && currentUsers >= maxUsers) {
      errEl.textContent = `User limit reached — your plan allows ${maxUsers} users. Upgrade your plan to add more team members.`;
      errEl.style.display = '';
      return;
    }
  }

  btn.disabled = true;

  try {
    let res, error;

    if (isEdit) {
      ({ data: res, error } = await supabase.rpc('update_app_user', {
        p_user_id:            uid,
        p_company_id:         S.cid,
        p_full_name:          name,
        p_role:               role,
        p_email:              email || null,
        p_phone:              phone || null,
        p_password:           pass,
        p_module_permissions: modulePerms
      }));
    } else {
      ({ data: res, error } = await supabase.rpc('create_app_user', {
        p_company_id:         S.cid,
        p_full_name:          name,
        p_role:               role,
        p_password:           pass,
        p_email:              email || null,
        p_phone:              phone || null,
        p_module_permissions: modulePerms
      }));
    }

    if (error) throw error;
    if (!res?.success) throw new Error(res?.message || 'Operation failed.');

    cm('m-user');
    notify.success(isEdit ? 'User updated.' : `User created. Username: ${res.username}`, { duration: 4000 });
    await _loadUsers();

  } catch(e) {
    errEl.textContent = e.message || 'An error occurred.';
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
  }
}

async function toggleUserStatus(userId, newStatus) {
  try {
    const { data: res, error } = await supabase.rpc('update_app_user', {
      p_user_id:    userId,
      p_company_id: S.cid,
      p_status:     newStatus
    });
    if (error) throw error;
    if (!res?.success) throw new Error(res?.message || 'Failed.');
    notify.success(`User ${newStatus === 'active' ? 'activated' : 'deactivated'}.`);
    await _loadUsers();
  } catch(e) {
    notify.error('Error', { detail: e.message });
  }
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
