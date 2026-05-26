// ══ AUDIT TRAIL MODULE ════════════════════════════════════════════
'use strict';

// ── State ─────────────────────────────────────────────────────────
let _audRows      = [];
let _audStats     = null;
let _audTotal     = 0;
let _audPage      = 0;
let _audLimit     = 80;
let _audFilters   = { table: '', action: '', userId: '', from: '', to: '', sensitive: false, search: '' };
let _audUsers     = [];
let _audLoading   = false;
let _audViewEntry = null;   // currently open diff entry

// ── Entry point ───────────────────────────────────────────────────
async function rAudit() {
  if (S.role !== 'admin' && S.role !== 'owner') { nav('dashboard'); return; }
  const el = document.getElementById('pg-audit');
  if (!el) return;

  _audPage    = 0;
  _audFilters = { table: '', action: '', userId: '', from: '', to: '', sensitive: false, search: '' };

  el.innerHTML = `
  <div class="ani module-executive" style="padding:0 0 40px">
    <div class="ph" style="margin-bottom:0">
      <div class="ph-l" style="align-items:center;gap:12px">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#1e40af,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 4px 14px rgba(30,64,175,.3);flex-shrink:0"><svg width="22" height="22" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div>
          <h2 style="margin:0">Audit Trail</h2>
          <p style="margin:0;font-size:11px;color:var(--t3)">Complete history of every change — who, what, when</p>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn btn-gh btn-sm" onclick="_audExportCSV()">Export CSV</button>
        <button class="btn btn-gh btn-sm" onclick="_audExportExcel()">Export Excel</button>
        <button class="btn btn-gh btn-sm" onclick="_audLoad(true)">↺ Refresh</button>
      </div>
    </div>

    <!-- Stats row -->
    <div id="aud-stats-row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:0 24px;margin:16px 0"></div>

    <!-- Filters -->
    <div style="padding:0 24px;margin-bottom:14px">
      <div style="background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1.4fr 1.4fr;gap:10px;margin-bottom:10px">
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">Table</div>
            <select id="aud-f-table" class="inp-light" style="width:100%" onchange="_audFilterChange()">
              <option value="">All Tables</option>
              <option value="payments">payments</option>
              <option value="sales">sales</option>
              <option value="installments">installments</option>
              <option value="pdc_cheques">pdc_cheques</option>
              <option value="clients">clients</option>
              <option value="units">units</option>
              <option value="projects">projects</option>
              <option value="agents">agents</option>
              <option value="payment_promises">payment_promises</option>
              <option value="sale_amendments">sale_amendments</option>
              <option value="unit_cancellations">unit_cancellations</option>
              <option value="unit_transfers">unit_transfers</option>
            </select>
          </div>
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">Action</div>
            <select id="aud-f-action" class="inp-light" style="width:100%" onchange="_audFilterChange()">
              <option value="">All Actions</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">User</div>
            <select id="aud-f-user" class="inp-light" style="width:100%" onchange="_audFilterChange()">
              <option value="">All Users</option>
            </select>
          </div>
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">From Date</div>
            <input id="aud-f-from" type="date" class="inp-light" style="width:100%" onchange="_audFilterChange()">
          </div>
          <div>
            <div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">To Date</div>
            <input id="aud-f-to" type="date" class="inp-light" style="width:100%" onchange="_audFilterChange()">
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--t2)">
            <input type="checkbox" id="aud-f-sensitive" style="accent-color:var(--err);width:14px;height:14px" onchange="_audFilterChange()">
            <span>Sensitive only</span>
          </label>
          <input id="aud-f-search" type="text" class="inp-light" placeholder="Search record ID…"
            style="flex:1;max-width:260px" oninput="_audFilterChange()">
          <button class="btn btn-gh btn-xs" onclick="_audClearFilters()">✕ Clear</button>
          <span id="aud-count-label" style="font-size:11px;color:var(--t3);margin-left:auto"></span>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div style="padding:0 24px">
      <div class="card" style="overflow:hidden">
        <div id="aud-table-wrap">
          <div style="padding:40px;text-align:center;color:var(--t3)">
            <div style="font-size:32px;margin-bottom:8px">⏳</div>
            <div style="font-size:13px">Loading audit logs…</div>
          </div>
        </div>
        <!-- Pagination -->
        <div id="aud-pagination" style="display:none;padding:12px 16px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <button id="aud-prev" class="btn btn-gh btn-sm" onclick="_audPagePrev()" disabled>← Prev</button>
          <span id="aud-page-info" style="font-size:11px;color:var(--t3)"></span>
          <button id="aud-next" class="btn btn-gh btn-sm" onclick="_audPageNext()">Next →</button>
        </div>
      </div>
    </div>
  </div>`;

  _audEnsureModals();
  await Promise.all([_audLoadStats(), _audLoadUsers()]);
  await _audLoad();
}

// ── Load stats (30-day summary) ───────────────────────────────────
async function _audLoadStats() {
  try {
    const { data, error } = await supabase.rpc('get_audit_stats', {
      p_company_id: S.cid,
      p_days: 30
    });
    if (error) throw error;
    _audStats = data;
    _audRenderStats();
  } catch (e) {
    console.warn('[audit stats]', e.message);
  }
}

function _audRenderStats() {
  const el = document.getElementById('aud-stats-row');
  if (!el || !_audStats) return;
  const s = _audStats;
  const statCard = (icon, label, val, col, sub) => `
    <div style="background:var(--surface);border:1px solid var(--line);border-left:3px solid ${col};border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${icon} ${label}</div>
      <div style="font-size:22px;font-weight:800;color:var(--text);line-height:1">${val.toLocaleString()}</div>
      ${sub ? `<div style="font-size:10px;color:var(--t3);margin-top:4px">${sub}</div>` : ''}
    </div>`;
  el.innerHTML =
    statCard('', 'Total Changes (30d)', s.total_changes || 0, 'var(--brand)', `${s.inserts||0} inserts · ${s.updates||0} updates`) +
    statCard('', 'Sensitive Changes', s.sensitive_changes || 0, 'var(--err)', 'Amount & price edits, deletions') +
    statCard('', 'Deletions', s.deletes || 0, '#ef4444', 'Records permanently removed') +
    statCard('', 'Active Users', (s.top_users || []).length, '#8b5cf6', 'Made changes in last 30 days');
}

// ── Load users list for filter dropdown ──────────────────────────
async function _audLoadUsers() {
  try {
    const { data, error } = await supabase.rpc('list_app_users_lookup', { p_company_id: S.cid });
    if (error) throw error;
    _audUsers = data || [];
    const sel = document.getElementById('aud-f-user');
    if (sel) {
      sel.innerHTML = '<option value="">All Users</option>' +
        _audUsers.map(u => `<option value="${esc(u.id)}">${esc(u.full_name)} (${esc(u.role)})</option>`).join('');
    }
  } catch (e) {
    console.warn('[audit users]', e.message);
  }
}

// ── Main load ─────────────────────────────────────────────────────
async function _audLoad(resetPage) {
  if (_audLoading) return;
  if (resetPage) _audPage = 0;
  _audLoading = true;

  const wrap = document.getElementById('aud-table-wrap');
  if (!wrap) { _audLoading = false; return; }

  // Read current filters from DOM
  _audFilters.table     = document.getElementById('aud-f-table')?.value     || '';
  _audFilters.action    = document.getElementById('aud-f-action')?.value    || '';
  _audFilters.userId    = document.getElementById('aud-f-user')?.value      || '';
  _audFilters.from      = document.getElementById('aud-f-from')?.value      || '';
  _audFilters.to        = document.getElementById('aud-f-to')?.value        || '';
  _audFilters.sensitive = document.getElementById('aud-f-sensitive')?.checked || false;
  _audFilters.search    = document.getElementById('aud-f-search')?.value?.trim() || '';

  try {
    const params = {
      p_company_id:    S.cid,
      p_table_name:    _audFilters.table    || null,
      p_record_id:     _audFilters.search   || null,
      p_user_id:       _audFilters.userId   || null,
      p_action:        _audFilters.action   || null,
      p_from_date:     _audFilters.from     ? _audFilters.from + 'T00:00:00Z' : null,
      p_to_date:       _audFilters.to       ? _audFilters.to   + 'T23:59:59Z' : null,
      p_sensitive_only: _audFilters.sensitive,
      p_limit:         _audLimit,
      p_offset:        _audPage * _audLimit
    };

    const { data, error } = await supabase.rpc('get_audit_logs', params);
    if (error) throw error;
    _audRows  = data || [];
    _audTotal = _audRows.length > 0 ? Number(_audRows[0].total_count) : 0;
    _audRenderTable();
  } catch (e) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--err)">
      <div style="font-size:24px;margin-bottom:8px"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div style="font-size:13px">Failed to load audit logs</div>
      <div style="font-size:11px;color:var(--t3);margin-top:4px">${esc(e.message)}</div>
    </div>`;
  } finally {
    _audLoading = false;
  }
}

// ── Render table ──────────────────────────────────────────────────
function _audRenderTable() {
  const wrap = document.getElementById('aud-table-wrap');
  if (!wrap) return;

  const countLabel = document.getElementById('aud-count-label');
  if (countLabel) countLabel.textContent = `${_audTotal.toLocaleString()} result${_audTotal !== 1 ? 's' : ''}`;

  if (_audRows.length === 0) {
    wrap.innerHTML = `<div style="padding:48px;text-align:center;color:var(--t3)">
      <div style="font-size:36px;margin-bottom:10px"><svg width="36" height="36" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
      <div style="font-size:14px;font-weight:600">No audit logs found</div>
      <div style="font-size:12px;margin-top:4px">Try adjusting your filters</div>
    </div>`;
    _audRenderPagination();
    return;
  }

  const rows = _audRows.map(r => {
    const actionCfg = {
      INSERT: { col: '#10b981', bg: 'rgba(16,185,129,.1)',  icon: '' },
      UPDATE: { col: '#f59e0b', bg: 'rgba(245,158,11,.1)',  icon: '' },
      DELETE: { col: '#ef4444', bg: 'rgba(239,68,68,.1)',   icon: '' },
    };
    const ac  = actionCfg[r.action] || { col: 'var(--t3)', bg: 'var(--surface)', icon: '' };
    const tStr = r.changed_at ? _audFmtTime(r.changed_at) : '—';
    const fields = Array.isArray(r.changed_fields) && r.changed_fields.length > 0
      ? r.changed_fields.slice(0, 4).map(f => `<span style="font-size:9px;padding:1px 5px;background:var(--hover);border:1px solid var(--line);border-radius:3px;font-family:monospace;color:var(--t2)">${esc(f)}</span>`).join(' ')
        + (r.changed_fields.length > 4 ? `<span style="font-size:9px;color:var(--t3)">+${r.changed_fields.length - 4}</span>` : '')
      : '<span style="font-size:10px;color:var(--t3)">—</span>';
    const sensitiveBadge = r.is_sensitive
      ? `<span style="font-size:9px;font-weight:700;color:var(--err);background:rgba(239,68,68,.1);padding:1px 5px;border-radius:3px;margin-left:4px">!</span>`
      : '';

    return `<tr style="cursor:pointer" onclick="_audOpenEntry(${r.id})">
      <td style="font-size:11px;color:var(--t3);white-space:nowrap;font-family:monospace">${tStr}</td>
      <td>
        <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(r.changed_by_name || 'system')}</div>
        <div style="font-size:10px;color:var(--t3);margin-top:1px">${esc(r.changed_by_role || '')}</div>
      </td>
      <td>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${ac.bg};color:${ac.col};border:1px solid ${ac.col}44">${ac.icon} ${r.action}</span>
      </td>
      <td>
        <span style="font-size:11px;font-family:monospace;font-weight:600;color:var(--brand)">${esc(r.table_name)}</span>
        ${sensitiveBadge}
      </td>
      <td style="font-size:10px;color:var(--t3);font-family:monospace;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.record_id||'')}">${esc((r.record_id||'').substring(0,18))}${(r.record_id||'').length>18?'…':''}</td>
      <td style="max-width:240px">${fields}</td>
      <td>
        ${r.has_diff
          ? `<button class="btn btn-gh btn-xs" onclick="event.stopPropagation();_audOpenEntry(${r.id})">View Diff</button>`
          : `<span style="font-size:10px;color:var(--t3)">—</span>`}
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<div class="tw" style="overflow-x:auto">
    <table class="t" style="font-size:12px;min-width:800px">
      <thead>
        <tr>
          <th style="min-width:110px">Time</th>
          <th>User</th>
          <th style="width:90px">Action</th>
          <th>Table</th>
          <th>Record ID</th>
          <th>Changed Fields</th>
          <th style="width:80px">Diff</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  _audRenderPagination();
}

// ── Pagination ────────────────────────────────────────────────────
function _audRenderPagination() {
  const pag = document.getElementById('aud-pagination');
  const info = document.getElementById('aud-page-info');
  const prev = document.getElementById('aud-prev');
  const next = document.getElementById('aud-next');
  if (!pag) return;

  const totalPages = Math.ceil(_audTotal / _audLimit);
  if (totalPages <= 1 && _audRows.length === 0) {
    pag.style.display = 'none';
    return;
  }
  pag.style.display = 'flex';
  const start = _audPage * _audLimit + 1;
  const end   = Math.min(start + _audRows.length - 1, _audTotal);
  if (info) info.textContent = `${start.toLocaleString()} – ${end.toLocaleString()} of ${_audTotal.toLocaleString()}`;
  if (prev) prev.disabled = _audPage === 0;
  if (next) next.disabled = (_audPage + 1) >= totalPages;
}

function _audPagePrev() { if (_audPage > 0) { _audPage--; _audLoad(); } }
function _audPageNext() { _audPage++; _audLoad(); }

// ── Filters ───────────────────────────────────────────────────────
let _audFilterTimer = null;
function _audFilterChange() {
  clearTimeout(_audFilterTimer);
  _audFilterTimer = setTimeout(() => _audLoad(true), 400);
}
function _audClearFilters() {
  ['aud-f-table','aud-f-action','aud-f-user'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['aud-f-from','aud-f-to','aud-f-search'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const chk = document.getElementById('aud-f-sensitive'); if (chk) chk.checked = false;
  _audLoad(true);
}

// ── Open entry diff viewer ────────────────────────────────────────
async function _audOpenEntry(auditId) {
  _audEnsureModals();
  const body = document.getElementById('m-audit-diff-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)"><div style="font-size:24px">⏳</div><div style="margin-top:8px">Loading…</div></div>';
  om('m-audit-diff');

  try {
    const { data, error } = await supabase.rpc('get_audit_entry', {
      p_company_id: S.cid,
      p_audit_id:   auditId
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Entry not found');
    _audViewEntry = data[0];
    _audRenderDiff(_audViewEntry);
  } catch (e) {
    body.innerHTML = `<div style="padding:24px;color:var(--err);font-size:13px">${esc(e.message)}</div>`;
  }
}

function _audRenderDiff(e) {
  const body = document.getElementById('m-audit-diff-body');
  if (!body) return;

  const actionCfg = {
    INSERT: { col: '#10b981', icon: 'INSERT' },
    UPDATE: { col: '#f59e0b', icon: 'UPDATE' },
    DELETE: { col: '#ef4444', icon: 'DELETE' },
  };
  const ac = actionCfg[e.action] || { col: 'var(--t3)', icon: e.action };

  // Build field diff table for UPDATEs
  let diffRows = '';
  if (e.action === 'UPDATE' && e.old_data && e.new_data) {
    const old = e.old_data, nw = e.new_data;
    const changedFields = Array.isArray(e.changed_fields) ? e.changed_fields : [];
    const sensFields = new Set(['amount','sale_price','net_amount','amount_due']);

    diffRows = changedFields.map(field => {
      const oldVal = old[field] !== undefined ? String(old[field]) : '—';
      const newVal = nw[field]  !== undefined ? String(nw[field])  : '—';
      const isSens = sensFields.has(field);
      const isNum  = !isNaN(Number(oldVal)) && !isNaN(Number(newVal)) && oldVal !== 'null' && newVal !== 'null';
      const fmtVal = (v) => {
        if (v === 'null' || v === '') return '<span style="color:var(--t3);font-style:italic">null</span>';
        if (isNum) return `<b>PKR ${fM(Number(v))}</b>`;
        if (v.length > 80) return `<span title="${esc(v)}">${esc(v.substring(0,80))}…</span>`;
        return esc(v);
      };
      return `<tr>
        <td style="font-family:monospace;font-size:11px;color:var(--t2);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)">${esc(field)}${isSens ? ' !' : ''}</td>
        <td style="font-size:12px;color:var(--err);background:rgba(239,68,68,.04);padding:8px 10px;border-bottom:1px solid var(--line);text-decoration:line-through;opacity:.8">${fmtVal(oldVal)}</td>
        <td style="font-size:12px;color:var(--ok);background:rgba(16,185,129,.04);padding:8px 10px;border-bottom:1px solid var(--line)">${fmtVal(newVal)}</td>
      </tr>`;
    }).join('');
    if (!diffRows) diffRows = `<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--t3);font-size:12px">No tracked field changes</td></tr>`;
  } else if (e.action === 'INSERT' && e.new_data) {
    diffRows = Object.entries(e.new_data).filter(([,v]) => v !== null).map(([k,v]) => `
      <tr>
        <td style="font-family:monospace;font-size:11px;color:var(--t2);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--line)">${esc(k)}</td>
        <td style="color:var(--t3);font-size:12px;padding:6px 10px;border-bottom:1px solid var(--line)">—</td>
        <td style="font-size:12px;color:var(--ok);padding:6px 10px;border-bottom:1px solid var(--line)">${esc(String(v))}</td>
      </tr>`).join('');
  } else if (e.action === 'DELETE' && e.old_data) {
    diffRows = Object.entries(e.old_data).filter(([,v]) => v !== null).map(([k,v]) => `
      <tr>
        <td style="font-family:monospace;font-size:11px;color:var(--t2);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--line)">${esc(k)}</td>
        <td style="font-size:12px;color:var(--err);padding:6px 10px;border-bottom:1px solid var(--line);text-decoration:line-through">${esc(String(v))}</td>
        <td style="color:var(--t3);font-size:12px;padding:6px 10px;border-bottom:1px solid var(--line)">—</td>
      </tr>`).join('');
  }

  const ip = e.ip_address ? String(e.ip_address).replace(/::ffff:/i,'') : null;

  body.innerHTML = `
    <!-- Header strip -->
    <div style="background:linear-gradient(135deg,rgba(30,64,175,.08),rgba(124,58,237,.05));border-bottom:1px solid var(--line);padding:16px 20px;margin:-16px -20px 16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Audit #${e.id}</div>
          <div style="font-size:15px;font-weight:700;color:var(--text)">${esc(e.table_name)} <span style="font-size:12px;font-weight:400;color:var(--t3)">· Record ${esc((e.record_id||'?').substring(0,18))}</span></div>
          <div style="margin-top:4px">
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${ac.col}18;color:${ac.col};border:1px solid ${ac.col}44">${ac.icon}</span>
            ${e.is_sensitive ? `<span style="font-size:10px;font-weight:700;color:var(--err);margin-left:6px">SENSITIVE CHANGE</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;font-size:11px;color:var(--t3);line-height:1.8">
          <div><b style="color:var(--t2)">${esc(e.changed_by_name || 'system')}</b> (${esc(e.changed_by_role || '—')})</div>
          <div>${_audFmtTime(e.changed_at)}</div>
          ${ip ? `<div>IP: ${esc(ip)}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Diff table -->
    ${diffRows ? `
    <div style="margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
        ${e.action === 'UPDATE' ? 'Changed Fields' : e.action === 'INSERT' ? 'Created Fields' : 'Deleted Fields'}
      </div>
      <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--hover)">
              <th style="text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--t3);font-weight:700;border-bottom:1px solid var(--line)">Field</th>
              <th style="text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--err);font-weight:700;border-bottom:1px solid var(--line)">Before</th>
              <th style="text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--ok);font-weight:700;border-bottom:1px solid var(--line)">After</th>
            </tr>
          </thead>
          <tbody>${diffRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Raw JSON (collapsible) -->
    ${e.old_data || e.new_data ? `
    <div style="margin-bottom:12px">
      <button class="btn btn-gh btn-xs" onclick="_audToggleJson('aud-json-old')"
        style="margin-right:6px">${e.old_data ? '▾ Old Data (JSON)' : ''}</button>
      <button class="btn btn-gh btn-xs" onclick="_audToggleJson('aud-json-new')">${e.new_data ? '▾ New Data (JSON)' : ''}</button>
      ${e.old_data ? `<pre id="aud-json-old" style="display:none;margin-top:8px;padding:10px;background:rgba(239,68,68,.04);border:1px solid rgba(239,68,68,.2);border-radius:6px;font-size:10px;overflow:auto;max-height:220px;line-height:1.5">${esc(JSON.stringify(e.old_data, null, 2))}</pre>` : ''}
      ${e.new_data ? `<pre id="aud-json-new" style="display:none;margin-top:8px;padding:10px;background:rgba(16,185,129,.04);border:1px solid rgba(16,185,129,.2);border-radius:6px;font-size:10px;overflow:auto;max-height:220px;line-height:1.5">${esc(JSON.stringify(e.new_data, null, 2))}</pre>` : ''}
    </div>` : ''}

    <!-- Actions -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:14px;margin-top:4px">
      <button class="btn btn-gh btn-sm" onclick="_audViewFullHistory('${esc(e.table_name)}','${esc(e.record_id||'')}')">Full History</button>
      <button class="btn btn-gh btn-sm" onclick="_audExportEntryCSV(${e.id})">Export</button>
      <button class="btn btn-gh btn-sm" style="margin-left:auto" onclick="cm('m-audit-diff')">✕ Close</button>
    </div>`;
}

function _audToggleJson(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ── Record timeline (reusable from any page) ──────────────────────
async function openAuditHistory(tableName, recordId, title) {
  _audEnsureModals();
  const body = document.getElementById('m-audit-hist-body');
  const hdr  = document.getElementById('m-audit-hist-title');
  if (!body) return;
  if (hdr) hdr.textContent = title || `History: ${tableName}`;
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3)"><div style="font-size:20px">⏳</div><div style="margin-top:6px;font-size:12px">Loading history…</div></div>';
  om('m-audit-hist');

  try {
    const { data, error } = await supabase.rpc('get_record_history', {
      p_company_id: S.cid,
      p_table_name: tableName,
      p_record_id:  String(recordId)
    });
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) {
      body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3)"><div style="font-size:28px"><svg width="28" height="28" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div><div style="font-size:13px;margin-top:8px">No history found for this record</div></div>';
      return;
    }

    const actionCfg = {
      INSERT: { col: '#10b981', dot: '', label: 'Created' },
      UPDATE: { col: '#f59e0b', dot: '', label: 'Updated' },
      DELETE: { col: '#ef4444', dot: '', label: 'Deleted' },
    };

    const items = [...rows].reverse().map((r, i) => {
      const ac   = actionCfg[r.action] || { col: 'var(--t3)', dot: '', label: r.action };
      const flds = Array.isArray(r.changed_fields) && r.changed_fields.length
        ? r.changed_fields.slice(0,6).join(', ') + (r.changed_fields.length > 6 ? ` +${r.changed_fields.length-6}` : '')
        : (r.action === 'INSERT' ? 'Record created' : r.action === 'DELETE' ? 'Record deleted' : 'No tracked changes');

      return `
        <div style="display:flex;gap:12px;padding:12px 0;${i < rows.length-1 ? 'border-bottom:1px solid var(--line)' : ''}">
          <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
            <div style="width:28px;height:28px;border-radius:50%;background:${ac.col}18;border:2px solid ${ac.col}44;display:flex;align-items:center;justify-content:center;font-size:12px">${ac.dot}</div>
            ${i < rows.length-1 ? `<div style="flex:1;width:2px;background:var(--line);margin:4px 0"></div>` : ''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px">
              <div>
                <span style="font-size:12px;font-weight:700;color:${ac.col}">${ac.label}</span>
                <span style="font-size:11px;color:var(--t3);margin-left:6px">by <b style="color:var(--t2)">${esc(r.changed_by_name || 'system')}</b></span>
                ${r.is_sensitive ? '<span style="font-size:9px;color:var(--err);font-weight:700;margin-left:4px">SENSITIVE</span>' : ''}
              </div>
              <span style="font-size:10px;color:var(--t3);white-space:nowrap;flex-shrink:0">${_audFmtTime(r.changed_at)}</span>
            </div>
            <div style="font-size:11px;color:var(--t2);font-family:monospace">${esc(flds)}</div>
            ${(r.action === 'UPDATE' && r.old_data && r.new_data) ?
              `<button class="btn btn-gh btn-xs" style="margin-top:5px" onclick="cm('m-audit-hist');_audOpenEntry(${r.id})">View Diff →</button>` : ''}
          </div>
        </div>`;
    }).join('');

    body.innerHTML = `<div style="padding:4px 0">${items}</div>`;
  } catch (e) {
    body.innerHTML = `<div style="padding:24px;color:var(--err);font-size:12px">${esc(e.message)}</div>`;
  }
}

function _audViewFullHistory(tableName, recordId) {
  cm('m-audit-diff');
  openAuditHistory(tableName, recordId, `History: ${tableName}`);
}

// ── Export CSV ────────────────────────────────────────────────────
function _audExportCSV() {
  if (!_audRows || _audRows.length === 0) {
    showToast('No data to export', 'warn'); return;
  }
  const headers = ['ID','Time','User','Role','Action','Table','Record ID','Changed Fields','Sensitive'];
  const rows    = _audRows.map(r => [
    r.id,
    r.changed_at ? new Date(r.changed_at).toISOString() : '',
    r.changed_by_name || '',
    r.changed_by_role || '',
    r.action,
    r.table_name,
    r.record_id || '',
    (r.changed_fields || []).join('|'),
    r.is_sensitive ? 'YES' : 'NO'
  ]);
  const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `audit_trail_${td()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function _audExportEntryCSV(auditId) {
  const e = _audViewEntry;
  if (!e) return;
  const lines = [
    `"Audit ID","${e.id}"`,
    `"Table","${e.table_name}"`,
    `"Record ID","${e.record_id || ''}"`,
    `"Action","${e.action}"`,
    `"Changed By","${e.changed_by_name || ''}"`,
    `"Role","${e.changed_by_role || ''}"`,
    `"Time","${e.changed_at || ''}"`,
    `"Is Sensitive","${e.is_sensitive ? 'YES' : 'NO'}"`,
    `"Old Data","${JSON.stringify(e.old_data || {}).replace(/"/g,'""')}"`,
    `"New Data","${JSON.stringify(e.new_data || {}).replace(/"/g,'""')}"`,
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `audit_entry_${e.id}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Modal injection ───────────────────────────────────────────────
function _audEnsureModals() {
  if (document.getElementById('m-audit-diff')) return;

  // Diff viewer modal
  const diff = document.createElement('div');
  diff.id        = 'm-audit-diff';
  diff.className = 'mov';
  diff.innerHTML = `<div class="md" style="max-width:680px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">
    <div class="mh" style="flex-shrink:0">
      <div><h3>Change Details</h3><p>Full diff view for this audit entry</p></div>
      <button class="mx" onclick="cm('m-audit-diff')">✕</button>
    </div>
    <div id="m-audit-diff-body" class="mb" style="overflow-y:auto;flex:1;padding:16px 20px"></div>
  </div>`;
  document.body.appendChild(diff);

  // Record history modal
  const hist = document.createElement('div');
  hist.id        = 'm-audit-hist';
  hist.className = 'mov';
  hist.innerHTML = `<div class="md" style="max-width:580px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden">
    <div class="mh" style="flex-shrink:0">
      <div><h3 id="m-audit-hist-title">Record History</h3><p>Full timeline of changes to this record</p></div>
      <button class="mx" onclick="cm('m-audit-hist')">✕</button>
    </div>
    <div id="m-audit-hist-body" class="mb" style="overflow-y:auto;flex:1;padding:14px 20px"></div>
  </div>`;
  document.body.appendChild(hist);
}

// ── Helper: format timestamp ──────────────────────────────────────
function _audFmtTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-PK', {
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit', hour12:true
    });
  } catch { return ts; }
}

// ── Export Excel (HTML table → .xls, opens natively in Excel) ───────
function _audExportExcel() {
  if (!_audRows || _audRows.length === 0) {
    showToast('No data to export', 'warn'); return;
  }
  const tableHtml = `
    <table border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px">
      <thead>
        <tr style="background:#1e40af;color:#fff">
          <th style="padding:6px 10px">ID</th>
          <th style="padding:6px 10px">Time</th>
          <th style="padding:6px 10px">User</th>
          <th style="padding:6px 10px">Role</th>
          <th style="padding:6px 10px">Action</th>
          <th style="padding:6px 10px">Table</th>
          <th style="padding:6px 10px">Record ID</th>
          <th style="padding:6px 10px">Changed Fields</th>
          <th style="padding:6px 10px">Sensitive</th>
        </tr>
      </thead>
      <tbody>
        ${_audRows.map((r, i) => `
          <tr style="background:${i%2===0?'#f8fafc':'#fff'}">
            <td style="padding:4px 8px">${r.id}</td>
            <td style="padding:4px 8px;white-space:nowrap">${r.changed_at ? new Date(r.changed_at).toLocaleString('en-PK') : ''}</td>
            <td style="padding:4px 8px;font-weight:600">${r.changed_by_name || ''}</td>
            <td style="padding:4px 8px">${r.changed_by_role || ''}</td>
            <td style="padding:4px 8px;font-weight:700;color:${r.action==='DELETE'?'#dc2626':r.action==='INSERT'?'#16a34a':'#d97706'}">${r.action}</td>
            <td style="padding:4px 8px;font-family:monospace;color:#1e40af">${r.table_name}</td>
            <td style="padding:4px 8px;font-family:monospace;font-size:10px">${(r.record_id||'').substring(0,24)}</td>
            <td style="padding:4px 8px;font-size:10px">${(r.changed_fields||[]).join(', ')}</td>
            <td style="padding:4px 8px;text-align:center;color:${r.is_sensitive?'#dc2626':'#94a3b8'}">${r.is_sensitive?'YES':'—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Audit Trail</title></head><body>${tableHtml}</body></html>`;
  const blob = new Blob([html], { type:'application/vnd.ms-excel;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `audit_trail_${td()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Dashboard widget: sensitive changes (last 24h) ────────────────
async function _rDashAuditWidget() {
  const el = document.getElementById('d-audit-widget');
  if (!el) return;
  try {
    const { data, error } = await supabase.rpc('get_sensitive_changes', {
      p_company_id: S.cid,
      p_days: 1,
      p_limit: 20
    });
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) {
      el.innerHTML = '';
      return;
    }
    const byType = {};
    rows.forEach(r => {
      const key = r.action === 'DELETE' ? 'deletions' :
                  r.table_name === 'payments' ? 'payment edits' :
                  r.table_name === 'sales' ? 'sale edits' : 'other';
      byType[key] = (byType[key] || 0) + 1;
    });
    const items = Object.entries(byType).map(([k,v]) =>
      `<div style="font-size:12px;color:var(--t2)">• ${v} ${k}</div>`).join('');

    el.innerHTML = `
      <div class="card" style="border-left:3px solid var(--err);margin-bottom:14px">
        <div class="cb" style="padding:12px 16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--err);text-transform:uppercase;letter-spacing:.5px">Sensitive Changes (24h)</div>
            <button class="btn btn-gh btn-xs" onclick="nav('audit')">Review →</button>
          </div>
          ${items}
        </div>
      </div>`;
  } catch (e) {
    console.warn('[audit widget]', e.message);
  }
}
