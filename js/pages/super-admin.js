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
      <div class="sa-gate">
        <div class="sa-gate-card">
          <div class="sa-gate-brand">Nexunova<span class="sa-gate-dot">.</span><span class="sa-gate-sub">Super Admin</span></div>
          <div class="sa-gate-hint">Enter the super-admin password to continue.</div>
          <input id="sa-pw-inp" class="sa-input" type="password" placeholder="Password" autocomplete="current-password">
          <button class="sa-btn-primary" onclick="SA._verifyPassword()">Access Panel</button>
          <div id="sa-pw-err" class="sa-gate-err"></div>
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
            Payments
            <span class="sa-tab-badge" id="sa-badge-pending" style="display:none">0</span>
          </button>
          <button class="sa-tab" data-tab="history" onclick="SA.switchTab('history')">History</button>
          <button class="sa-tab" data-tab="companies" onclick="SA.switchTab('companies')">Companies</button>
          <button class="sa-tab" data-tab="health" onclick="SA.switchTab('health')">Health</button>
          <button class="sa-tab" data-tab="announcements" onclick="SA.switchTab('announcements')">Announcements</button>
          <button class="sa-tab" data-tab="tickets" onclick="SA.switchTab('tickets')">
            Tickets
            <span class="sa-tab-badge" id="sa-badge-tickets" style="display:none">0</span>
          </button>
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
    if (tab === 'pending')       _loadPending();
    if (tab === 'history')       _loadHistory('all');
    if (tab === 'companies')     _loadCompanies();
    if (tab === 'partners')      _loadPartners();
    if (tab === 'health')        _loadHealth();
    if (tab === 'announcements') _loadAnnouncements();
    if (tab === 'tickets')       _loadTickets();
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
          <div style="font-family:'Space Mono',monospace;font-size:11px;color:#93b8fb">${_esc(r.invoice_number || '—')}</div>
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
          <button onclick="SA.toggleProof('${r.proof_id}')" style="padding:4px 10px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.28);border-radius:6px;color:#93b8fb;font-size:11px;font-weight:600;cursor:pointer">
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
    // Receipt lives in the PRIVATE payment-receipts bucket — render a placeholder and
    // resolve a short-lived signed URL on demand (toggleProof → _loadReceipt).
    const receiptHtml = r.receipt_url
      ? `<div class="sa-receipt-loading" style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:12px">Loading receipt…</div>`
      : `<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.25);font-size:12px">No receipt uploaded</div>`;

    return `
      <div class="sa-proof-detail open">
        <div class="sa-proof-img-wrap" id="sa-receipt-${r.proof_id}" data-receipt="${_esc(r.receipt_url || '')}">${receiptHtml}</div>
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

  // ── Receipt (private payment-receipts bucket) → signed URL ───────────
  // Handles BOTH old rows (full getPublicUrl string stored) and new rows (bare path stored).
  function _resolveReceiptPath(stored) {
    if (!stored) return null;
    let s = stored.split('?')[0];                        // drop any query string
    const marker = '/payment-receipts/';
    const i = s.indexOf(marker);
    if (i >= 0) s = s.slice(i + marker.length);          // old: full public URL → take path after bucket
    return s.replace(/^payment-receipts\//, '') || null; // new: bare path (strip bucket prefix if present)
  }

  async function _loadReceipt(proofId) {
    const wrap = document.getElementById(`sa-receipt-${proofId}`);
    if (!wrap || wrap.dataset.loaded === '1') return;
    const path = _resolveReceiptPath(wrap.dataset.receipt || '');
    if (!path) return;
    wrap.dataset.loaded = '1';
    try {
      const { data, error } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 3600);
      if (error || !data || !data.signedUrl) throw (error || new Error('no signed url'));
      const url = data.signedUrl;
      wrap.innerHTML = path.toLowerCase().endsWith('.pdf')
        ? `<div style="padding:20px;text-align:center"><a href="${_esc(url)}" target="_blank" class="sa-receipt-link" style="font-size:13px">Open PDF Receipt</a></div>`
        : `<img src="${_esc(url)}" alt="Receipt" style="max-width:100%;max-height:400px;object-fit:contain">`;
    } catch (e) {
      wrap.dataset.loaded = '';   // allow a retry on next open
      wrap.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(239,68,68,0.7);font-size:12px">Could not load receipt.</div>`;
    }
  }

  function toggleProof(proofId) {
    const row = document.getElementById(`sa-detail-${proofId}`);
    if (!row) return;
    const isHidden = row.style.display === 'none';
    // Close all open detail rows first
    document.querySelectorAll('[id^="sa-detail-"]').forEach(r => r.style.display = 'none');
    if (isHidden) { row.style.display = ''; _loadReceipt(proofId); }
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
          <td style="font-family:'Space Mono',monospace;font-size:11px;color:#93b8fb">${_esc(r.invoice_number || '—')}</td>
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
          <td><button onclick="SA._loadCompanyDetail('${c.id}','${_esc(c.company_name||'')}')" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:6px;color:#93b8fb;padding:4px 10px;font-size:11px;cursor:pointer">View</button></td>
        </tr>`).join('');

      ct.innerHTML = `
        <div class="sa-card">
          <div class="sa-card-hd">
            <div class="sa-card-title">All Companies (${data.length})</div>
          </div>
          <div class="sa-card-bd">
            <table class="sa-tbl">
              <thead>
                <tr><th>Company</th><th>Email</th><th>Status</th><th>Plan</th><th>Joined</th><th>Expires</th><th>Users</th><th>Units</th><th></th></tr>
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
                <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;color:white;font-size:14px">${_esc(p.name || '—')}</div>
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

  // ── Health / MRR Dashboard tab ──────────────────────────────────────
  async function _loadHealth() {
    const ct = document.getElementById('sa-tab-content');
    if (!ct) return;
    ct.innerHTML = '<div class="sa-empty">Loading health data…</div>';
    try {
      const { data, error } = await supabase.rpc('get_sa_health_dashboard');
      if (error) throw error;
      const d = data || {};
      const fmtM  = n => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:0,maximumFractionDigits:0});
      const fmtK  = n => { const v=Number(n||0); return v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?(v/1000).toFixed(1)+'K':String(Math.round(v)); };

      const byPlan = Array.isArray(d.by_plan) ? d.by_plan : [];
      const planRows = byPlan.map(p => `<tr>
        <td style="padding:8px 12px;font-weight:600;color:rgba(255,255,255,0.85)">${_esc(p.plan)}</td>
        <td style="padding:8px 12px;text-align:center">${p.count}</td>
        <td style="padding:8px 12px;text-align:right;font-family:'Space Mono',monospace;color:#93b8fb">PKR ${fmtM(p.mrr)}</td>
      </tr>`).join('') || '<tr><td colspan="3" style="padding:12px;text-align:center;color:rgba(255,255,255,0.25)">No active subscriptions</td></tr>';

      const monthlyNew = Array.isArray(d.monthly_new) ? d.monthly_new : [];
      const maxCount   = Math.max(...monthlyNew.map(m => m.count), 1);
      const bars = monthlyNew.map(m => {
        const pct = Math.round((m.count / maxCount) * 100);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7)">${m.count}</div>
          <div style="width:100%;background:rgba(59,130,246,0.15);border-radius:4px;height:60px;display:flex;align-items:flex-end">
            <div style="width:100%;height:${pct}%;background:linear-gradient(180deg,#93b8fb,#3b82f6);border-radius:4px;min-height:4px"></div>
          </div>
          <div style="font-size:9px;color:rgba(255,255,255,0.35)">${_esc(m.month)}</div>
        </div>`;
      }).join('');

      ct.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
          <div class="sa-stat cyan" style="text-align:center">
            <div class="sa-stat-val" style="font-size:22px">PKR ${fmtK(d.mrr)}</div>
            <div class="sa-stat-lbl">MRR</div>
          </div>
          <div class="sa-stat purple" style="text-align:center">
            <div class="sa-stat-val" style="font-size:22px">PKR ${fmtK(d.arr)}</div>
            <div class="sa-stat-lbl">ARR</div>
          </div>
          <div class="sa-stat green" style="text-align:center">
            <div class="sa-stat-val">${d.total_companies ?? 0}</div>
            <div class="sa-stat-lbl">Total Tenants</div>
          </div>
          <div class="sa-stat green" style="text-align:center">
            <div class="sa-stat-val">${d.active ?? 0}</div>
            <div class="sa-stat-lbl">Active</div>
          </div>
          <div class="sa-stat orange" style="text-align:center">
            <div class="sa-stat-val">${d.trialing ?? 0}</div>
            <div class="sa-stat-lbl">Trialing</div>
          </div>
          <div class="sa-stat red" style="text-align:center">
            <div class="sa-stat-val">${d.churned_30d ?? 0}</div>
            <div class="sa-stat-lbl">Churned (30d)</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="sa-card">
            <div class="sa-card-hd"><div class="sa-card-title">Revenue by Plan</div></div>
            <div class="sa-card-bd">
              <table class="sa-tbl">
                <thead><tr><th>Plan</th><th style="text-align:center">Tenants</th><th style="text-align:right">MRR Contribution</th></tr></thead>
                <tbody>${planRows}</tbody>
              </table>
            </div>
          </div>
          <div class="sa-card">
            <div class="sa-card-hd">
              <div class="sa-card-title">New Signups — Last 6 Months</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.3)">${d.new_30d ?? 0} this month</div>
            </div>
            <div class="sa-card-bd" style="padding:16px">
              ${monthlyNew.length > 0
                ? `<div style="display:flex;gap:6px;align-items:flex-end;height:90px">${bars}</div>`
                : '<div style="text-align:center;color:rgba(255,255,255,0.25);padding:20px;font-size:12px">No data yet</div>'}
            </div>
          </div>
        </div>`;
    } catch(e) {
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed to load: ${_esc(e.message)}</div>`;
    }
  }

  // ── Announcements tab ────────────────────────────────────────────────
  let _annList = [];

  async function _loadAnnouncements() {
    const ct = document.getElementById('sa-tab-content');
    if (!ct) return;
    ct.innerHTML = '<div class="sa-empty">Loading…</div>';
    try {
      const { data, error } = await supabase.rpc('list_sa_announcements');
      if (error) throw error;
      _annList = Array.isArray(data) ? data : [];
      _renderAnnouncements(ct);
    } catch(e) {
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed: ${_esc(e.message)}</div>`;
    }
  }

  function _renderAnnouncements(ct) {
    const typeBg = { info:'rgba(59,130,246,0.2)', warning:'rgba(251,146,60,0.2)', success:'rgba(34,197,94,0.2)', error:'rgba(239,68,68,0.2)' };
    const typeClr= { info:'#93b8fb', warning:'#fb923c', success:'#4ade80', error:'#f87171' };
    const rows   = _annList.map(a => `<tr>
      <td style="padding:10px 12px">
        <div style="font-weight:600;color:rgba(255,255,255,0.85)">${_esc(a.title)}</div>
        ${a.body ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">${_esc(a.body)}</div>` : ''}
      </td>
      <td style="padding:10px 12px">
        <span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:${typeBg[a.type]||typeBg.info};color:${typeClr[a.type]||typeClr.info};text-transform:uppercase">${_esc(a.type)}</span>
      </td>
      <td style="padding:10px 12px">
        <span class="sa-status ${a.is_active?'active':'rejected'}">${a.is_active?'Active':'Inactive'}</span>
      </td>
      <td style="padding:10px 12px;font-size:11px;color:rgba(255,255,255,0.4)">${a.ends_at ? _date(a.ends_at) : '—'}</td>
      <td style="padding:10px 12px;font-size:11px;color:rgba(255,255,255,0.4)">${_date(a.created_at)}</td>
      <td style="padding:10px 12px;white-space:nowrap">
        <button onclick="SA._annToggle('${a.id}',${!a.is_active})" style="background:none;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.6);padding:4px 10px;font-size:11px;cursor:pointer;margin-right:4px">${a.is_active?'Deactivate':'Activate'}</button>
        <button onclick="SA._annDelete('${a.id}')" style="background:none;border:1px solid rgba(239,68,68,0.3);border-radius:6px;color:#f87171;padding:4px 10px;font-size:11px;cursor:pointer">Delete</button>
      </td>
    </tr>`).join('');

    ct.innerHTML = `
      <div class="sa-card">
        <div class="sa-card-hd">
          <div class="sa-card-title">Platform Announcements</div>
          <button onclick="SA._annOpenForm()" style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);border-radius:8px;color:#93b8fb;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">+ New</button>
        </div>
        <div class="sa-card-bd">
          ${_annList.length === 0
            ? '<div class="sa-empty">No announcements yet.</div>'
            : `<table class="sa-tbl"><thead><tr><th>Message</th><th>Type</th><th>Status</th><th>Expires</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
        </div>
      </div>
      <!-- Announcement form overlay -->
      <div id="sa-ann-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:none;align-items:center;justify-content:center">
        <div style="background:#14171d;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;width:480px;max-width:95vw">
          <div style="font-weight:600;font-size:16px;color:white;margin-bottom:20px">New Announcement</div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <input id="ann-title" placeholder="Title *" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;color:white;font-size:13px;outline:none;width:100%;box-sizing:border-box">
            <textarea id="ann-body" placeholder="Message (optional)" rows="3" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;color:white;font-size:13px;outline:none;resize:none;width:100%;box-sizing:border-box"></textarea>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px;text-transform:uppercase">Type</div>
                <select id="ann-type" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 12px;color:white;font-size:13px;width:100%">
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="success">Success</option>
                  <option value="error">Error / Alert</option>
                </select>
              </div>
              <div>
                <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px;text-transform:uppercase">Expires (optional)</div>
                <input id="ann-ends" type="datetime-local" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 12px;color:white;font-size:13px;width:100%;box-sizing:border-box">
              </div>
            </div>
            <div id="ann-err" style="color:#f87171;font-size:12px;display:none"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
              <button onclick="SA._annCloseForm()" style="background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 18px;color:rgba(255,255,255,0.6);font-size:13px;cursor:pointer">Cancel</button>
              <button onclick="SA._annSave()" style="background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.4);border-radius:8px;padding:9px 18px;color:#93b8fb;font-size:13px;font-weight:600;cursor:pointer">Publish</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function _annOpenForm() {
    const ov = document.getElementById('sa-ann-overlay');
    if (ov) { ov.style.display = 'flex'; }
    const t = document.getElementById('ann-title');
    if (t) t.value = '';
    const b = document.getElementById('ann-body');
    if (b) b.value = '';
    const e = document.getElementById('ann-err');
    if (e) { e.textContent = ''; e.style.display = 'none'; }
  }

  function _annCloseForm() {
    const ov = document.getElementById('sa-ann-overlay');
    if (ov) ov.style.display = 'none';
  }

  async function _annSave() {
    const title = document.getElementById('ann-title')?.value?.trim();
    const body  = document.getElementById('ann-body')?.value?.trim();
    const type  = document.getElementById('ann-type')?.value || 'info';
    const ends  = document.getElementById('ann-ends')?.value;
    const errEl = document.getElementById('ann-err');
    if (!title) { if (errEl) { errEl.textContent = 'Title is required'; errEl.style.display='block'; } return; }
    try {
      const { error } = await supabase.rpc('upsert_sa_announcement', { p_data: {
        title, body: body || null, type, is_active: true, target_all: true,
        ends_at: ends ? new Date(ends).toISOString() : null, created_by: 'super_admin'
      }});
      if (error) throw error;
      _annCloseForm();
      _loadAnnouncements();
    } catch(e) {
      if (errEl) { errEl.textContent = 'Error: ' + e.message; errEl.style.display='block'; }
    }
  }

  async function _annToggle(id, isActive) {
    const ann = _annList.find(a => a.id === id);
    if (!ann) return;
    const { error } = await supabase.rpc('upsert_sa_announcement', { p_data: {
      id, title: ann.title, body: ann.body, type: ann.type,
      is_active: isActive, target_all: ann.target_all,
      ends_at: ann.ends_at
    }});
    if (error) { alert('Error: ' + error.message); return; }
    _loadAnnouncements();
  }

  async function _annDelete(id) {
    if (!confirm('Delete this announcement?')) return;
    const { error } = await supabase.rpc('delete_sa_announcement', { p_id: id });
    if (error) { alert('Error: ' + error.message); return; }
    _loadAnnouncements();
  }

  // ── Support Tickets tab ──────────────────────────────────────────────
  let _ticketList   = [];
  let _ticketFilter = 'open';

  async function _loadTickets() {
    const ct = document.getElementById('sa-tab-content');
    if (!ct) return;
    ct.innerHTML = '<div class="sa-empty">Loading…</div>';
    try {
      const { data, error } = await supabase.rpc('list_sa_support_tickets',
        { p_status: _ticketFilter === 'all' ? null : _ticketFilter });
      if (error) throw error;
      _ticketList = Array.isArray(data) ? data : [];

      // Update badge
      const openCount = _ticketList.filter(t => t.status === 'open').length;
      const badge = document.getElementById('sa-badge-tickets');
      if (badge) {
        badge.textContent = openCount;
        badge.style.display = openCount > 0 ? 'flex' : 'none';
      }

      _renderTickets(ct);
    } catch(e) {
      if (ct) ct.innerHTML = `<div class="sa-empty">Failed: ${_esc(e.message)}</div>`;
    }
  }

  function _renderTickets(ct) {
    const priClr = { urgent:'#f87171', high:'#fb923c', normal:'rgba(255,255,255,0.6)', low:'rgba(255,255,255,0.3)' };
    const stClr  = { open:'#93b8fb', in_progress:'#fb923c', resolved:'#4ade80', closed:'rgba(255,255,255,0.3)' };

    const filterBtns = ['open','in_progress','resolved','all'].map(f =>
      `<button onclick="SA._ticketSetFilter('${f}')" style="padding:5px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${_ticketFilter===f?'rgba(59,130,246,0.5)':'rgba(255,255,255,0.1)'};background:${_ticketFilter===f?'rgba(59,130,246,0.15)':'none'};color:${_ticketFilter===f?'#93b8fb':'rgba(255,255,255,0.5)'}">${f.replace('_',' ').toUpperCase()}</button>`
    ).join('');

    const rows = _ticketList.map(t => `<tr>
      <td style="padding:10px 12px">
        <div style="font-weight:600;color:rgba(255,255,255,0.85)">${_esc(t.subject)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px">${_esc(t.company_name||'Unknown')} · ${_esc(t.category||'general')}</div>
      </td>
      <td style="padding:10px 12px;font-size:11px;color:${priClr[t.priority]||priClr.normal};font-weight:600;text-transform:uppercase">${t.priority}</td>
      <td style="padding:10px 12px">
        <span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:rgba(59,130,246,0.1);color:${stClr[t.status]||stClr.open}">${(t.status||'open').replace('_',' ')}</span>
      </td>
      <td style="padding:10px 12px;font-size:11px;color:rgba(255,255,255,0.4)">${_date(t.created_at)}</td>
      <td style="padding:10px 12px;white-space:nowrap">
        ${t.status !== 'resolved' && t.status !== 'closed' ? `
          <button onclick="SA._ticketResolve('${t.id}')" style="background:none;border:1px solid rgba(34,197,94,0.3);border-radius:6px;color:#4ade80;padding:4px 10px;font-size:11px;cursor:pointer;margin-right:4px">Resolve</button>
          <button onclick="SA._ticketSetPriority('${t.id}','urgent')" style="background:none;border:1px solid rgba(239,68,68,0.3);border-radius:6px;color:#f87171;padding:4px 10px;font-size:11px;cursor:pointer">Urgent</button>` : ''}
      </td>
    </tr>`).join('');

    ct.innerHTML = `
      <div class="sa-card">
        <div class="sa-card-hd">
          <div class="sa-card-title">Support Tickets (${_ticketList.length})</div>
          <div style="display:flex;gap:6px">${filterBtns}</div>
        </div>
        <div class="sa-card-bd">
          ${_ticketList.length === 0
            ? `<div class="sa-empty">No ${_ticketFilter} tickets.</div>`
            : `<table class="sa-tbl"><thead><tr><th>Subject</th><th>Priority</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
        </div>
      </div>`;
  }

  function _ticketSetFilter(f) {
    _ticketFilter = f;
    _loadTickets();
  }

  async function _ticketResolve(id) {
    const note = prompt('Resolution note (optional):') ?? '';
    const { error } = await supabase.rpc('update_sa_ticket', {
      p_id: id, p_data: { status: 'resolved', resolution_note: note || null }
    });
    if (error) { alert('Error: ' + error.message); return; }
    _loadTickets();
  }

  async function _ticketSetPriority(id, priority) {
    const { error } = await supabase.rpc('update_sa_ticket', { p_id: id, p_data: { priority } });
    if (error) { alert('Error: ' + error.message); return; }
    _loadTickets();
  }

  // ── Company detail overlay ───────────────────────────────────────────
  async function _loadCompanyDetail(companyId, companyName) {
    // Inject overlay if not present
    let ov = document.getElementById('sa-co-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'sa-co-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9998;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:32px 16px';
      ov.onclick = e => { if (e.target === ov) ov.remove(); };
      document.body.appendChild(ov);
    }
    ov.innerHTML = `<div style="background:#14171d;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;width:640px;max-width:95vw;margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="font-weight:600;font-size:16px;color:white">${_esc(companyName)}</div>
        <button onclick="document.getElementById('sa-co-overlay').remove()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:20px;cursor:pointer">×</button>
      </div>
      <div style="color:rgba(255,255,255,0.4);font-size:12px;padding:20px;text-align:center">Loading…</div>
    </div>`;

    try {
      const [detailRes, flagsRes] = await Promise.all([
        supabase.rpc('get_company_detail_admin', { p_company_id: companyId }),
        supabase.rpc('list_company_feature_flags', { p_company_id: companyId })
      ]);
      if (detailRes.error) throw detailRes.error;

      const d = detailRes.data || {};
      const co = d.company || {};
      const sub = d.subscription || {};
      const plan = d.plan || {};
      const stats = d.stats || {};
      const flags = Array.isArray(flagsRes.data) ? flagsRes.data : [];
      const fmtM = n => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:0,maximumFractionDigits:0});

      const FEATURE_KEYS = [
        { key:'noc',                  label:'NOC Management' },
        { key:'campaigns',            label:'Recovery Campaigns' },
        { key:'forecasting',          label:'Recovery Forecasting' },
        { key:'comms_center',         label:'Communications Center' },
        { key:'executive_dashboard',  label:'Executive Dashboard' },
        { key:'possession',           label:'Possession Tracking' },
        { key:'legal',                label:'Legal Cases' },
        { key:'blacklist',            label:'Blacklist Register' },
        { key:'escalations',          label:'Escalation Management' },
        { key:'pdc',                  label:'PDC Register' },
        { key:'commission_structures',label:'Commission Structures' },
      ];

      const flagMap = {};
      flags.forEach(f => { flagMap[f.feature_key] = f.is_enabled; });

      const flagRows = FEATURE_KEYS.map(fk => {
        const enabled = flagMap[fk.key] !== false;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="font-size:12px;color:rgba(255,255,255,0.7)">${_esc(fk.label)}</div>
          <button onclick="SA._toggleFlag('${companyId}','${fk.key}',${!enabled},'${_esc(companyName)}')" style="padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${enabled?'rgba(34,197,94,0.35)':'rgba(239,68,68,0.3)'};background:${enabled?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.08)'};color:${enabled?'#4ade80':'#f87171'}">${enabled?'Enabled':'Disabled'}</button>
        </div>`;
      }).join('');

      const isSuspended = !!co.suspended_at;

      ov.innerHTML = `<div style="background:#14171d;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;width:640px;max-width:95vw;margin:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div>
            <div style="font-weight:600;font-size:16px;color:white">${_esc(co.company_name||companyName)}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px">${_esc(co.company_code||'')} · ${_esc(co.business_email||co.city||'')}</div>
          </div>
          <button onclick="document.getElementById('sa-co-overlay').remove()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:22px;cursor:pointer;line-height:1">×</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px">
          ${[['Users',stats.users],['Projects',stats.projects],['Units',stats.units],['Clients',stats.clients],
             ['Agents',stats.agents],['Sales',stats.sales],['Pays (30d)',stats.payments_30d],['Vol (30d)','PKR '+fmtM(stats.payments_amt_30d)]].map(([l,v])=>`
            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 12px;text-align:center">
              <div style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.85)">${v??0}</div>
              <div style="font-size:9px;color:rgba(255,255,255,0.35);text-transform:uppercase;margin-top:2px">${l}</div>
            </div>`).join('')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,0.3);margin-bottom:8px;font-weight:600">Subscription</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.7);line-height:1.8">
              Plan: <strong style="color:white">${_esc(plan.plan_name||sub.legacy_plan_name||sub.tier||'Unknown')}</strong><br>
              Status: <span style="color:${sub.status==='active'?'#4ade80':sub.status==='trialing'?'#fb923c':'#f87171'}">${_esc(sub.status||'—')}</span><br>
              Billing: ${_esc(sub.billing_cycle||'—')} · PKR ${fmtM(sub.amount)}<br>
              Expires: ${sub.current_period_end ? _date(sub.current_period_end) : '—'}
            </div>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,0.3);margin-bottom:8px;font-weight:600">Company</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.7);line-height:1.8">
              Status: <span style="color:${co.status==='active'?'#4ade80':co.status==='suspended'?'#f87171':'rgba(255,255,255,0.5)'}">${_esc(co.status||'—')}</span><br>
              Joined: ${_date(co.created_at)}<br>
              Country: ${_esc(co.country||'—')} · ${_esc(co.city||'')}<br>
              ${isSuspended ? `<span style="color:#f87171">Suspended: ${_esc(co.suspension_reason||'No reason')}</span>` : ''}
            </div>
          </div>
        </div>

        <div style="margin-bottom:20px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,0.3);margin-bottom:8px;font-weight:600">Feature Flags</div>
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:8px 12px">${flagRows}</div>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06)">
          ${isSuspended
            ? `<button onclick="SA._suspendCo('${companyId}',false,'${_esc(companyName)}')" style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:8px 18px;color:#4ade80;font-size:12px;font-weight:600;cursor:pointer">Unsuspend</button>`
            : `<button onclick="SA._suspendCo('${companyId}',true,'${_esc(companyName)}')" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 18px;color:#f87171;font-size:12px;font-weight:600;cursor:pointer">Suspend</button>`}
          <button onclick="document.getElementById('sa-co-overlay').remove()" style="background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 18px;color:rgba(255,255,255,0.5);font-size:12px;cursor:pointer">Close</button>
        </div>
      </div>`;
    } catch(e) {
      ov.innerHTML = `<div style="background:#14171d;border-radius:16px;padding:40px;color:#f87171;text-align:center">${_esc(e.message)}</div>`;
    }
  }

  async function _toggleFlag(companyId, featureKey, newEnabled, companyName) {
    const { error } = await supabase.rpc('set_company_feature_flag', {
      p_company_id:  companyId,
      p_feature_key: featureKey,
      p_is_enabled:  newEnabled,
      p_set_by:      'super_admin'
    });
    if (error) { alert('Error: ' + error.message); return; }
    _loadCompanyDetail(companyId, companyName);
  }

  async function _suspendCo(companyId, doSuspend, companyName) {
    let reason = null;
    if (doSuspend) {
      reason = prompt('Suspension reason:');
      if (reason === null) return;
    } else {
      if (!confirm('Unsuspend ' + companyName + '?')) return;
    }
    const { error } = await supabase.rpc('suspend_company', {
      p_company_id: companyId, p_reason: reason || null, p_suspend: doSuspend
    });
    if (error) { alert('Error: ' + error.message); return; }
    document.getElementById('sa-co-overlay')?.remove();
    _loadCompanies();
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

  return {
    init, switchTab, toggleProof, verify, logout,
    _loadPending, _loadHistory, _verifyPassword,
    _loadHealth, _loadAnnouncements, _loadTickets,
    _annOpenForm, _annCloseForm, _annSave, _annToggle, _annDelete,
    _ticketSetFilter, _ticketResolve, _ticketSetPriority,
    _loadCompanyDetail, _toggleFlag, _suspendCo
  };
})();

// ── Boot on page load ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (window.location.search.includes('super-admin')) {
    // Hide all other screens; show super admin
    document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
    SA.init();
  }
});
