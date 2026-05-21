// ══ SUPER ADMIN PANEL ══════════════════════════════════════════════════

const SA = (() => {
  let _tab = 'pending';
  let _filterStatus = 'pending';
  let _superAdminVerified = false;

  // ── Entry point ────────────────────────────────────────────────────
  function init() {
    // Check URL param
    if (!window.location.search.includes('super-admin')) return;

    // Check session
    const raw = sessionStorage.getItem('nxn_sess');
    if (!raw) { _promptPassword(); return; }
    const sess = JSON.parse(raw);
    if (!sess?.isSuperAdmin) { _promptPassword(); return; }

    _superAdminVerified = true;
    _show();
  }

  function _promptPassword() {
    const panel = document.getElementById('s-super-admin');
    if (!panel) return;
    panel.classList.add('on');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:20px">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;background:linear-gradient(135deg,#00d9ff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent">
          Nexunova Super Admin
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:28px 32px;display:flex;flex-direction:column;gap:14px;width:340px">
          <div style="font-size:13px;color:rgba(255,255,255,0.5);text-align:center">Enter super admin password to continue</div>
          <input id="sa-pw-inp" type="password" placeholder="Password" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;color:white;font-size:13px;font-family:'Plus Jakarta Sans',sans-serif;outline:none">
          <button onclick="SA._verifyPassword()" style="padding:10px;background:rgba(0,217,255,0.12);border:1px solid rgba(0,217,255,0.3);border-radius:8px;color:#00d9ff;font-size:13px;font-weight:700;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif">
            Access Panel
          </button>
          <div id="sa-pw-err" style="display:none;color:#ef4444;font-size:12px;text-align:center"></div>
        </div>
      </div>`;

    const inp = document.getElementById('sa-pw-inp');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') SA._verifyPassword(); });
  }

  async function _verifyPassword() {
    const inp = document.getElementById('sa-pw-inp');
    const err = document.getElementById('sa-pw-err');
    if (!inp || !inp.value) return;

    try {
      const { data, error } = await supabase.rpc('verify_super_admin', { p_password: inp.value });
      if (error || !data?.success) {
        if (err) { err.style.display = 'block'; err.textContent = 'Incorrect password.'; }
        inp.value = '';
        return;
      }
      // Store super admin flag in session
      const raw = sessionStorage.getItem('nxn_sess');
      const sess = raw ? JSON.parse(raw) : {};
      sess.isSuperAdmin = true;
      sessionStorage.setItem('nxn_sess', JSON.stringify(sess));
      _superAdminVerified = true;

      const panel = document.getElementById('s-super-admin');
      panel.innerHTML = '';
      _show();
    } catch(e) {
      if (err) { err.style.display = 'block'; err.textContent = 'Connection error. Try again.'; }
    }
  }

  function _show() {
    const panel = document.getElementById('s-super-admin');
    if (!panel) return;
    panel.classList.add('on');
    panel.innerHTML = _buildShell();
    _switchTab('pending');
    _loadStats();
  }

  function _buildShell() {
    return `
      <div class="sa-topbar">
        <div class="sa-logo">Nexunova RMS</div>
        <div class="sa-badge">SUPER ADMIN</div>
        <div class="sa-tabs">
          <button class="sa-tab active" data-tab="pending" onclick="SA.switchTab('pending')">
            Pending Payments
            <span class="sa-tab-badge" id="sa-badge-pending" style="display:none">0</span>
          </button>
          <button class="sa-tab" data-tab="history" onclick="SA.switchTab('history')">All History</button>
          <button class="sa-tab" data-tab="companies" onclick="SA.switchTab('companies')">Companies</button>
          <button class="sa-tab" data-tab="partners" onclick="SA.switchTab('partners')">Partners</button>
        </div>
        <button class="sa-logout-btn" onclick="SA.logout()">← Exit</button>
      </div>
      <div class="sa-body">
        <div id="sa-stats" class="sa-stats"></div>
        <div id="sa-tab-content"></div>
      </div>`;
  }

  async function _loadStats() {
    try {
      const { data, error } = await supabase.rpc('get_admin_stats');
      if (error || !data) return;
      const c = data;
      document.getElementById('sa-stats').innerHTML = `
        <div class="sa-stat cyan"><div class="sa-stat-val">${c.total_companies ?? 0}</div><div class="sa-stat-lbl">Total Companies</div></div>
        <div class="sa-stat green"><div class="sa-stat-val">${c.active_subs ?? 0}</div><div class="sa-stat-lbl">Active Subs</div></div>
        <div class="sa-stat purple"><div class="sa-stat-val">${c.trial_count ?? 0}</div><div class="sa-stat-lbl">Trials</div></div>
        <div class="sa-stat orange"><div class="sa-stat-val">${c.pending_count ?? 0}</div><div class="sa-stat-lbl">Pending</div></div>
        <div class="sa-stat red"><div class="sa-stat-val">${_fmt(c.pending_amount ?? 0)}</div><div class="sa-stat-lbl">Pending Amount</div></div>
        <div class="sa-stat green"><div class="sa-stat-val">${_fmt(c.month_revenue ?? 0)}</div><div class="sa-stat-lbl">This Month</div></div>`;

      const badge = document.getElementById('sa-badge-pending');
      if (badge && c.pending_count > 0) {
        badge.textContent = c.pending_count;
        badge.style.display = 'flex';
      }
    } catch(e) { console.warn('[SA stats]', e); }
  }

  // ── Tab switching ───────────────────────────────────────────────────
  function switchTab(tab) {
    _tab = tab;
    document.querySelectorAll('.sa-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    _switchTab(tab);
  }

  function _switchTab(tab) {
    const ct = document.getElementById('sa-tab-content');
    if (!ct) return;
    ct.innerHTML = '<div class="sa-empty">Loading…</div>';
    if (tab === 'pending')   _loadPending();
    if (tab === 'history')   _loadHistory('all');
    if (tab === 'companies') _loadCompanies();
    if (tab === 'partners')  _loadPartners();
  }

  // ── Pending Payments tab ────────────────────────────────────────────
  async function _loadPending() {
    try {
      const { data, error } = await supabase.rpc('get_pending_proofs_admin');
      const ct = document.getElementById('sa-tab-content');
      if (!ct) return;
      if (error) { ct.innerHTML = `<div class="sa-empty">Error: ${error.message}</div>`; return; }
      if (!data || data.length === 0) { ct.innerHTML = '<div class="sa-empty">No pending payment proofs.</div>'; return; }
      ct.innerHTML = _buildPendingTable(data);
    } catch(e) {
      const ct = document.getElementById('sa-tab-content');
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed to load: ${e.message}</div>`;
    }
  }

  function _buildPendingTable(rows) {
    const trs = rows.map(r => `
      <tr>
        <td>
          <div style="font-weight:600;color:rgba(255,255,255,0.85)">${_esc(r.company_name || '—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px">${_esc(r.company_code || '')}</div>
        </td>
        <td>
          <div style="font-family:'Space Mono',monospace;font-size:11px;color:#00d9ff">${_esc(r.invoice_number || '—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">${r.invoice_currency || 'PKR'} ${_fmtN(r.invoice_amount)}</div>
        </td>
        <td>
          <div style="font-size:12px">${_esc(r.payment_method_name || '—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px">${_esc(r.partner_name || '')}</div>
        </td>
        <td>
          <div style="font-family:'Space Mono',monospace;font-size:11px">${_esc(r.reference_number || '—')}</div>
        </td>
        <td><span class="sa-status ${r.proof_status || 'pending'}">${(r.proof_status || 'pending').replace('_', ' ')}</span></td>
        <td style="font-size:11px;color:rgba(255,255,255,0.4)">${_date(r.submitted_at)}</td>
        <td>
          <button onclick="SA.toggleProof('${r.proof_id}')" style="padding:4px 10px;background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.25);border-radius:6px;color:#00d9ff;font-size:11px;font-weight:600;cursor:pointer">
            View
          </button>
        </td>
      </tr>
      <tr id="sa-detail-${r.proof_id}" style="display:none">
        <td colspan="7" style="padding:0">
          ${_buildProofDetail(r)}
        </td>
      </tr>`).join('');

    return `
      <div class="sa-card">
        <div class="sa-card-hd">
          <div class="sa-card-title">Pending Payment Proofs</div>
          <button onclick="SA._loadPending()" style="padding:4px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer">Refresh</button>
        </div>
        <div class="sa-card-bd">
          <table class="sa-tbl">
            <thead>
              <tr>
                <th>Company</th><th>Invoice</th><th>Method</th><th>Reference</th><th>Status</th><th>Submitted</th><th></th>
              </tr>
            </thead>
            <tbody>${trs}</tbody>
          </table>
        </div>
      </div>`;
  }

  function _buildProofDetail(r) {
    const receiptHtml = r.receipt_url
      ? (r.receipt_url.toLowerCase().endsWith('.pdf')
          ? `<div style="padding:20px;text-align:center"><a href="${_esc(r.receipt_url)}" target="_blank" class="sa-receipt-link" style="font-size:13px">Open PDF Receipt</a></div>`
          : `<img src="${_esc(r.receipt_url)}" alt="Receipt" style="max-width:100%;max-height:400px;object-fit:contain">`)
      : `<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.25);font-size:12px">No receipt uploaded</div>`;

    return `
      <div class="sa-proof-detail open">
        <div class="sa-proof-img-wrap">${receiptHtml}</div>
        <div class="sa-detail-rows">
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Company</div>
            <div class="sa-detail-val">${_esc(r.company_name || '—')}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Plan</div>
            <div class="sa-detail-val">${_esc(r.plan_code || '—')}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Invoice</div>
            <div class="sa-detail-val" style="font-family:'Space Mono',monospace">${_esc(r.invoice_number || '—')}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Amount Claimed</div>
            <div class="sa-detail-val">${r.currency || 'PKR'} ${_fmtN(r.amount_paid)}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Invoice Amount</div>
            <div class="sa-detail-val">${r.invoice_currency || 'PKR'} ${_fmtN(r.invoice_amount)}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Payment Method</div>
            <div class="sa-detail-val">${_esc(r.payment_method_name || '—')}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Partner</div>
            <div class="sa-detail-val">${_esc(r.partner_name || '—')}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Reference #</div>
            <div class="sa-detail-val" style="font-family:'Space Mono',monospace">${_esc(r.reference_number || '—')}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Payment Date</div>
            <div class="sa-detail-val">${_date(r.payment_date)}</div>
          </div>
          <div class="sa-detail-row">
            <div class="sa-detail-lbl">Submitted</div>
            <div class="sa-detail-val">${_date(r.submitted_at)}</div>
          </div>
          ${r.submitter_notes ? `<div class="sa-detail-row"><div class="sa-detail-lbl">Notes from user</div><div class="sa-detail-val">${_esc(r.submitter_notes)}</div></div>` : ''}
        </div>
        <div class="sa-action-row">
          <button class="sa-btn-approve" onclick="SA.verify('${r.proof_id}','approve')">✓ Approve</button>
          <button class="sa-btn-reject"  onclick="SA.verify('${r.proof_id}','reject')">✕ Reject</button>
          <button class="sa-btn-info"    onclick="SA.verify('${r.proof_id}','needs_info')">? Request Info</button>
          <input class="sa-notes-input" id="sa-notes-${r.proof_id}" type="text" placeholder="Admin notes (optional)…">
        </div>
      </div>`;
  }

  function toggleProof(proofId) {
    const row = document.getElementById(`sa-detail-${proofId}`);
    if (!row) return;
    const isHidden = row.style.display === 'none';
    // Close all open detail rows first
    document.querySelectorAll('[id^="sa-detail-"]').forEach(r => r.style.display = 'none');
    if (isHidden) row.style.display = '';
  }

  async function verify(proofId, action) {
    const notesEl = document.getElementById(`sa-notes-${proofId}`);
    const notes = notesEl ? notesEl.value.trim() : '';

    const sess = JSON.parse(sessionStorage.getItem('nxn_sess') || '{}');
    const verifiedBy = sess.userId || null;

    if (action === 'reject' && !notes) {
      alert('Please add a note explaining the rejection reason.');
      if (notesEl) notesEl.focus();
      return;
    }

    try {
      const { data, error } = await supabase.rpc('verify_payment', {
        p_proof_id:    proofId,
        p_action:      action,
        p_verified_by: verifiedBy,
        p_notes:       notes || null
      });

      if (error) { alert('Error: ' + error.message); return; }
      if (!data?.success) { alert(data?.message || 'Failed to update.'); return; }

      const labels = { approve: 'Approved', reject: 'Rejected', needs_info: 'Marked as needs info' };
      _loadPending();
      _loadStats();
      // Show brief confirmation
      const btn = document.querySelector(`[onclick="SA.verify('${proofId}','${action}')"]`);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = labels[action] + ' ✓';
        btn.disabled = true;
      }
    } catch(e) {
      alert('Connection error: ' + e.message);
    }
  }

  // ── History tab ─────────────────────────────────────────────────────
  async function _loadHistory(status) {
    _filterStatus = status;
    try {
      const { data, error } = await supabase.rpc('get_all_proofs_admin', { p_status: status === 'all' ? null : status });
      const ct = document.getElementById('sa-tab-content');
      if (!ct) return;
      if (error) { ct.innerHTML = `<div class="sa-empty">Error: ${error.message}</div>`; return; }

      const filterHtml = `
        <div class="sa-filters">
          ${['all','pending','approved','rejected','needs_info'].map(s => `
            <button class="sa-filter-btn ${status === s ? 'active' : ''}" onclick="SA._loadHistory('${s}')">
              ${s === 'all' ? 'All' : s.replace('_', ' ')}
            </button>`).join('')}
        </div>`;

      if (!data || data.length === 0) {
        ct.innerHTML = `<div class="sa-card"><div class="sa-card-hd"><div class="sa-card-title">Payment History</div></div><div class="sa-card-bd">${filterHtml}<div class="sa-empty">No records found.</div></div></div>`;
        return;
      }

      const trs = data.map(r => `
        <tr>
          <td>
            <div style="font-weight:600;color:rgba(255,255,255,0.85)">${_esc(r.company_name || '—')}</div>
          </td>
          <td style="font-family:'Space Mono',monospace;font-size:11px;color:#00d9ff">${_esc(r.invoice_number || '—')}</td>
          <td>${_esc(r.payment_method_name || '—')}</td>
          <td style="font-family:'Space Mono',monospace;font-size:11px">${_esc(r.reference_number || '—')}</td>
          <td>${r.currency || 'PKR'} ${_fmtN(r.amount_paid)}</td>
          <td><span class="sa-status ${r.proof_status || ''}">${(r.proof_status || '').replace('_', ' ')}</span></td>
          <td style="font-size:11px;color:rgba(255,255,255,0.4)">${_date(r.submitted_at)}</td>
          <td style="font-size:11px;color:rgba(255,255,255,0.4)">${_date(r.verified_at)}</td>
          <td style="font-size:12px;color:rgba(255,255,255,0.5)">${_esc(r.admin_notes || '')}</td>
        </tr>`).join('');

      ct.innerHTML = `
        <div class="sa-card">
          <div class="sa-card-hd"><div class="sa-card-title">Payment History</div></div>
          <div class="sa-card-bd">
            ${filterHtml}
            <table class="sa-tbl">
              <thead>
                <tr><th>Company</th><th>Invoice</th><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th><th>Submitted</th><th>Verified</th><th>Notes</th></tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        </div>`;
    } catch(e) {
      const ct = document.getElementById('sa-tab-content');
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed: ${e.message}</div>`;
    }
  }

  // ── Companies tab ───────────────────────────────────────────────────
  async function _loadCompanies() {
    try {
      const { data, error } = await supabase.rpc('get_companies_admin');
      const ct = document.getElementById('sa-tab-content');
      if (!ct) return;
      if (error) { ct.innerHTML = `<div class="sa-empty">Error: ${error.message}</div>`; return; }
      if (!data || data.length === 0) { ct.innerHTML = '<div class="sa-empty">No companies found.</div>'; return; }

      const trs = data.map(c => `
        <tr>
          <td>
            <div style="font-weight:600;color:rgba(255,255,255,0.85)">${_esc(c.company_name || '—')}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px">${_esc(c.company_code || '')}</div>
          </td>
          <td style="font-size:11px;color:rgba(255,255,255,0.5)">${_esc(c.email || '—')}</td>
          <td><span class="sa-status ${c.sub_status || 'trialing'}">${(c.sub_status || 'trialing').replace('_', ' ')}</span></td>
          <td style="font-size:12px">${_esc(c.plan_code || '—')}</td>
          <td style="font-size:11px;color:rgba(255,255,255,0.4)">${_date(c.created_at)}</td>
          <td style="font-size:11px;color:rgba(255,255,255,0.4)">${_date(c.sub_expires_at)}</td>
          <td style="font-size:12px;color:rgba(255,255,255,0.5)">${c.user_count ?? 0}</td>
          <td style="font-size:12px;color:rgba(255,255,255,0.5)">${c.unit_count ?? 0}</td>
        </tr>`).join('');

      ct.innerHTML = `
        <div class="sa-card">
          <div class="sa-card-hd">
            <div class="sa-card-title">All Companies (${data.length})</div>
          </div>
          <div class="sa-card-bd">
            <table class="sa-tbl">
              <thead>
                <tr><th>Company</th><th>Email</th><th>Status</th><th>Plan</th><th>Joined</th><th>Expires</th><th>Users</th><th>Units</th></tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        </div>`;
    } catch(e) {
      const ct = document.getElementById('sa-tab-content');
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed: ${e.message}</div>`;
    }
  }

  // ── Partners tab ────────────────────────────────────────────────────
  async function _loadPartners() {
    try {
      const { data, error } = await supabase.rpc('get_payment_partners_admin');
      const ct = document.getElementById('sa-tab-content');
      if (!ct) return;
      if (error) { ct.innerHTML = `<div class="sa-empty">Error: ${error.message}</div>`; return; }

      const rows = Array.isArray(data) ? data : [];

      const cards = rows.map(p => {
        const methods = Array.isArray(p.methods) ? p.methods : [];
        const methodRows = methods.map(m => `
          <tr>
            <td style="padding:8px 12px">${_esc(m.method_type || '—')}</td>
            <td style="padding:8px 12px;font-family:'Space Mono',monospace;font-size:11px">${_esc(m.account_number || '—')}</td>
            <td style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.4)">${_esc(m.account_title || '—')}</td>
            <td style="padding:8px 12px"><span class="sa-status ${m.is_active ? 'active' : 'rejected'}">${m.is_active ? 'Active' : 'Inactive'}</span></td>
          </tr>`).join('');

        return `
          <div class="sa-partner-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
              <div>
                <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;color:white;font-size:14px">${_esc(p.name || '—')}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">${_esc(p.country_code || '')} · ${_esc(p.phone || '')}</div>
              </div>
              <span class="sa-status ${p.is_active ? 'active' : 'rejected'}">${p.is_active ? 'Active' : 'Inactive'}</span>
            </div>
            ${methods.length > 0 ? `
              <table class="sa-tbl" style="margin-top:8px">
                <thead><tr><th>Type</th><th>Account</th><th>Title</th><th>Status</th></tr></thead>
                <tbody>${methodRows}</tbody>
              </table>` : `<div style="font-size:12px;color:rgba(255,255,255,0.25);padding:8px 0">No payment methods configured.</div>`}
          </div>`;
      }).join('');

      ct.innerHTML = `
        <div class="sa-card">
          <div class="sa-card-hd">
            <div class="sa-card-title">Payment Partners</div>
          </div>
          <div class="sa-card-bd" style="padding:16px">
            ${rows.length === 0 ? '<div class="sa-empty">No partners found.</div>' : cards}
          </div>
        </div>`;
    } catch(e) {
      const ct = document.getElementById('sa-tab-content');
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed: ${e.message}</div>`;
    }
  }

  function logout() {
    sessionStorage.removeItem('nxn_sess');
    window.location.href = window.location.pathname;
  }

  // ── Utility ─────────────────────────────────────────────────────────
  function _fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(0) + 'K';
    return String(n);
  }
  function _fmtN(n) {
    if (!n && n !== 0) return '—';
    return Number(n).toLocaleString('en-PK');
  }
  function _date(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, switchTab, toggleProof, verify, logout, _loadPending, _loadHistory, _verifyPassword };
})();

// ── Boot on page load ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (window.location.search.includes('super-admin')) {
    // Hide all other screens; show super admin
    document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
    SA.init();
  }
});
