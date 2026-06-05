// ══ SETUP WIZARD — ONBOARDING (6-step, draft-saving, no-skip) ════════════════
// Backed by company_setup_progress + RPCs: get_setup_progress / update_setup_step /
// complete_setup_step. Steps map to fixed step_keys; all keys are completed in
// sort-order at launch. Blue-600 primary. See NEXUNOVA_RMS_MASTER_CONTEXT.md §6.
'use strict';

const OB = (() => {
  // ── State ───────────────────────────────────────────────────────────
  let _step   = 1;
  const _total = 6;
  let _cid    = null;
  let _saving = false;
  let _allowCancel = false;          // true only when wizard re-entered AFTER onboarding is complete
  const _done = {};                 // { 1:true, ... } — steps the user has advanced past
  // Plan limits — populated from the DB, never hardcoded. `null` = unknown → no cap UI
  // (server still enforces via check_plan_limit inside upsert_project / create_app_user).
  const _limits = {
    maxProjects: null, projectsUsed: 0, projectsRemaining: null,
    maxUsers:    null, usersUsed:    1, usersRemaining:    null,
  };

  // Existing entities (read-only context loaded from DB at show() so the wizard mirrors reality)
  const _existing = { projects: [], users: [] };

  // In-memory working data (passwords live here only — never written to the DB draft)
  const _state = { company:{}, branding:{ brand_color:'#2563EB', mode:'light' }, sites:[], rules:{}, users:[] };

  // ── Step → company_setup_progress.step_key map (for draft saves) ──────
  const STEP_KEY = { 1:'company_profile', 2:'branding', 3:'projects', 4:'categories', 5:'users' };
  // Completed in this order at launch (sort_order — satisfies complete_setup_step no-skip)
  const ALL_KEYS = ['company_profile','branding','projects','users','payment_methods','categories'];

  const STEPS = [
    { n:1, label:'Company Info',   sub:'Profile & logo'   },
    { n:2, label:'Branding',       sub:'Color & theme'    },
    { n:3, label:'Projects',       sub:'Sites & units'    },
    { n:4, label:'Business Rules', sub:'Limits & fees'    },
    { n:5, label:'Users',          sub:'Team & access'    },
    { n:6, label:'Review',         sub:'Confirm & launch' },
  ];

  const ROLES = [
    { v:'admin',            l:'Admin' },
    { v:'manager',          l:'Manager' },
    { v:'recovery_officer', l:'Recovery Officer' },
    { v:'finance',          l:'Finance' },
  ];

  const PERMISSIONS = [
    { k:'sales',    l:'Sales' },        { k:'payments', l:'Payments' },
    { k:'recovery', l:'Recovery' },     { k:'clients',  l:'Clients' },
    { k:'projects', l:'Projects' },     { k:'agents',   l:'Agents' },
    { k:'reports',  l:'Reports' },      { k:'legal',    l:'Legal' },
  ];

  const SWATCHES = ['#2563EB','#4F46E5','#0EA5E9','#059669','#DC2626','#D97706','#7C3AED','#DB2777'];

  const SVG_CHECK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  // ── Public API ───────────────────────────────────────────────────────
  async function show(companyId) {
    _cid = companyId; _step = 1; _saving = false;
    // Re-entry mode: if the company is already onboarded, the wizard was opened from
    // the main sidebar — let the user cancel and return to dashboard (first-time setup
    // remains uncancellable to force completion).
    _allowCancel = !!(typeof S !== 'undefined' && S && S.onboardingComplete);
    for (const k in _done) delete _done[k];
    document.getElementById('s-app')?.classList.remove('on');
    document.getElementById('s-onboarding')?.classList.add('on');
    document.body.classList.add('wizard-active');     // hides global FABs/chat widgets via CSS
    _render();
    await Promise.all([_loadLimits(), _loadProgress(), _loadExistingEntities()]);
    _render();
  }

  function hide() {
    document.getElementById('s-onboarding')?.classList.remove('on');
    document.getElementById('s-app')?.classList.add('on');
    document.body.classList.remove('wizard-active');
  }

  // The sidebar 'skip' link's onclick is OB.skip(). In re-entry mode it cancels back to
  // the dashboard; on first-time setup it defers the whole wizard ("I'll do it later in
  // Settings") — the subscriber can fill it now OR finish anytime from Company Setup.
  function skip() {
    if (_allowCancel) { cancel(); return; }
    deferSetup();
  }
  function skipStep() { /* per-step skip disabled — required fields are enforced instead */ }

  // First-time defer: mark onboarding complete (so it won't force on every login) and
  // drop the user into the dashboard. Whatever they typed is saved as a resumable draft;
  // they can reopen the wizard anytime from Admin → Company Setup.
  async function deferSetup() {
    if (_saving) return;
    const ok = (typeof confirm === 'function')
      ? confirm("Skip setup for now?\n\nYou can complete it anytime — reopen the Setup Wizard from the Admin panel (“Re-run Setup Wizard”) or the menu. Anything you've already entered is saved.")
      : true;
    if (!ok) return;
    _setBusy(true);
    try {
      _collectCurrent();
      if (STEP_KEY[_step]) { try { await _saveDraft(_step); } catch (_) {} }     // resumable draft
      const { data, error } = await supabase.rpc('mark_onboarding_complete', { p_company_id: _cid });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'could not skip');
      if (typeof S !== 'undefined') S.onboardingComplete = true;
      // persist to the cached session too, else a page reload (init.js) re-forces the wizard
      try { const ss = JSON.parse(sessionStorage.getItem('nxn_sess') || '{}'); ss.onboardingComplete = true; sessionStorage.setItem('nxn_sess', JSON.stringify(ss)); } catch (_) {}
      hide();
      if (typeof nav === 'function') nav('dashboard');
      toast("Setup skipped — reopen the Setup Wizard anytime from the Admin panel.", 'info');
    } catch (e) {
      toast('Could not skip setup: ' + (e.message || e), 'err');
    } finally { _setBusy(false); }
  }
  function cancel() {
    if (!_allowCancel) {
      if (typeof toast === 'function') toast('Cannot cancel during first-time setup.', 'info');
      return;
    }
    hide();
    if (typeof nav === 'function') nav('dashboard');
  }

  function back() { if (_step > 1) { _collectCurrent(); _step--; _render(); } }

  async function next() {
    if (_saving) return;
    if (_step === _total) { await finish(); return; }
    _collectCurrent();
    const err = _validate(_step);
    if (err) { if (typeof toast === 'function') toast(err, 'err'); return; }
    const ok = await _saveDraft(_step);
    if (!ok) return;
    _done[_step] = true;
    _step++;
    _render();
  }

  // ── Load draft + plan limits ──────────────────────────────────────────
  async function _loadProgress() {
    try {
      const { data } = await supabase.rpc('get_setup_progress');
      if (!data?.success) return;
      (data.steps || []).forEach(s => {
        const d = s.data || {};
        if (s.step_key === 'company_profile') _state.company  = { ..._state.company,  ...d };
        if (s.step_key === 'branding')        _state.branding = { ..._state.branding, ...d };
        if (s.step_key === 'projects' && Array.isArray(d.sites)) _state.sites = d.sites;
        if (s.step_key === 'categories')      _state.rules    = { ..._state.rules,    ...d };
        if (s.step_key === 'users' && Array.isArray(d.users))    _state.users = d.users;
      });
    } catch (e) { console.warn('[OB] load progress', e); }
  }

  async function _loadExistingEntities() {
    // Load what's already in the workspace so the wizard shows existing projects/users
    // as read-only context (no more "I added 2 sites but Projects page shows 3" surprises).
    try {
      const { data } = await supabase.rpc('list_projects', { p_company_id: _cid });
      _existing.projects = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
    } catch (_) { _existing.projects = []; }
    try {
      const { data } = await supabase.rpc('list_app_users', { p_company_id: _cid });
      _existing.users = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
    } catch (_) { _existing.users = []; }
  }

  async function _loadLimits() {
    // get_plan_limits_with_usage response shape (verified 2026-05-26 via MCP):
    //   { max_projects, max_users, max_units, max_clients, max_agents,
    //     count_projects, count_users, count_units, count_clients, count_agents }
    // Earlier bug: parser looked for `data.projects_used` (doesn't exist) so projectsUsed
    // defaulted to 0 → wizard let the user add sites even when the DB was already at cap,
    // and launch then failed inside check_plan_limit. Fixed by reading the flat fields.
    try {
      const { data } = await supabase.rpc('get_plan_limits_with_usage', { p_company_id: _cid });
      if (data) {
        const mp = Number(data.max_projects),   mu = Number(data.max_users);
        const cp = Number(data.count_projects), cu = Number(data.count_users);
        if (Number.isFinite(mp)) _limits.maxProjects  = mp;
        if (Number.isFinite(mu)) _limits.maxUsers     = mu;
        if (Number.isFinite(cp)) _limits.projectsUsed = cp;
        if (Number.isFinite(cu)) _limits.usersUsed    = cu;
      }
    } catch (_) {}
    // Fallback: subscription cached at login (auth.js _loadSubscription via
    // get_subscription_with_plan). Plan nests under `subscription_plans` in that shape.
    const sub  = (typeof window !== 'undefined') ? window._subscription : null;
    const plan = sub?.subscription_plans || sub?.plan || sub;
    const fmp  = Number(plan?.max_projects), fmu = Number(plan?.max_users);
    if (!Number.isFinite(_limits.maxProjects) && Number.isFinite(fmp)) _limits.maxProjects = fmp;
    if (!Number.isFinite(_limits.maxUsers)    && Number.isFinite(fmu)) _limits.maxUsers    = fmu;
    // null = unknown -> no cap UI; server still enforces at create.
    _limits.projectsRemaining = Number.isFinite(_limits.maxProjects)
      ? Math.max(0, _limits.maxProjects - _limits.projectsUsed) : null;
    _limits.usersRemaining    = Number.isFinite(_limits.maxUsers)
      ? Math.max(0, _limits.maxUsers - _limits.usersUsed) : null;
  }

  // ── Render ────────────────────────────────────────────────────────────
  function _render() { _renderSidebar(); _renderProgress(); _renderNav(); _renderPanel(); }

  function _renderSidebar() {
    const el = document.getElementById('ob-step-list');
    if (el) el.innerHTML = STEPS.map(s => {
      const done = _done[s.n] && s.n < _step, cur = s.n === _step;
      return `<div class="ob-sl-item${cur ? ' ob-sl-active' : ''}${done ? ' ob-sl-done' : ''}">
        <div class="ob-sl-icon">${done ? SVG_CHECK : `<span>${s.n}</span>`}</div>
        <div><div class="ob-sl-label">${s.label}</div><div class="ob-sl-sub">${s.sub}</div></div>
      </div>`;
    }).join('');
    // Sidebar cancel affordance — visible only in re-entry mode.
    // The shell's existing onclick="OB.skip()" routes to cancel() when _allowCancel.
    const sl = document.querySelector('.ob-skip-link');
    if (sl) {
      sl.style.display = '';   // visible in both modes
      sl.textContent = _allowCancel ? '← Cancel & return to dashboard' : "I'll set this up later →";
    }
  }

  function _renderProgress() {
    const fill = document.getElementById('ob-progress-fill');
    if (fill) fill.style.width = (_step / _total * 100) + '%';
    const ctr = document.getElementById('ob-step-counter');
    if (ctr) ctr.textContent = `Step ${_step} of ${_total} — ${STEPS[_step-1].label}`;
  }

  function _renderNav() {
    const back = document.getElementById('ob-btn-back');
    const skip = document.getElementById('ob-btn-skip');
    const lbl  = document.getElementById('ob-btn-next-label');
    const btn  = document.getElementById('ob-btn-next');
    if (back) back.style.visibility = _step > 1 ? 'visible' : 'hidden';
    if (skip) skip.style.display = 'none';                    // cannot skip
    const last = _step === _total;
    if (lbl) lbl.textContent = last ? '🚀 Launch Workspace' : 'Next →';
    if (btn) { btn.className = 'ob-btn-next' + (last ? ' ob-btn-finish' : ''); btn.disabled = false; }
  }

  function _renderPanel() {
    const wrap = document.getElementById('ob-panel-wrap');
    if (!wrap) return;
    wrap.innerHTML = ({ 1:_p1, 2:_p2, 3:_p3, 4:_p4, 5:_p5, 6:_p6 }[_step] || (()=>''))();
  }

  // ── Panel 1: Company Info ─────────────────────────────────────────────
  function _p1() {
    const c = _state.company;
    const name = c.company_name || (typeof S !== 'undefined' ? S.coName : '') || '';
    const logo = c.logo_url || '';
    return `
      <div class="ob-panel-hd">
        <div class="ob-panel-title">Company Information</div>
        <div class="ob-panel-sub">This appears on receipts, vouchers, and documents. <strong>All fields except Name are optional</strong> — add them now or later from <strong>Admin → Company Profile</strong>.</div>
      </div>
      <div class="ob-fields">
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">Company Name *</label>
            <input id="ob-co-name" class="ob-input" value="${_esc(name)}" placeholder="Al-Noor Properties (Pvt) Ltd"
              maxlength="120" oninput="this.classList.remove('ob-input-err')"></div>
          <div class="ob-field"><label class="ob-label">NTN <span class="ob-hint-inline">tax no.</span></label>
            <input id="ob-co-ntn" class="ob-input" value="${_esc(c.ntn||'')}" placeholder="1234567-8"
              inputmode="numeric" pattern="[\\d-]{7,15}" maxlength="15" oninput="this.classList.remove('ob-input-err')"></div>
        </div>
        <div class="ob-field"><label class="ob-label">Office Address</label>
          <input id="ob-co-address" class="ob-input" value="${_esc(c.address||'')}" placeholder="Suite 201, Business Centre, Clifton Block 7" maxlength="240"></div>
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">City</label>
            <input id="ob-co-city" class="ob-input" value="${_esc(c.city||'')}" placeholder="Karachi" maxlength="60"></div>
          <div class="ob-field"><label class="ob-label">Country</label>
            <select id="ob-co-country" class="ob-input ob-select">
              ${['Pakistan','United Arab Emirates','Saudi Arabia','United Kingdom','United States','Other']
                .map(x => `<option ${ (c.country||'Pakistan')===x ? 'selected':''}>${x}</option>`).join('')}
            </select></div>
        </div>
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">Business Phone</label>
            <input id="ob-co-phone" class="ob-input" type="tel" value="${_esc(c.business_phone||'')}" placeholder="+92 21 111 000 000"
              inputmode="tel" pattern="[+]?[\\d\\s()\\-]{7,20}" maxlength="20" oninput="this.classList.remove('ob-input-err')"></div>
          <div class="ob-field"><label class="ob-label">Business Email</label>
            <input id="ob-co-email" class="ob-input" type="email" value="${_esc(c.business_email||'')}" placeholder="info@yourcompany.com"
              inputmode="email" maxlength="120" oninput="this.classList.remove('ob-input-err')"></div>
        </div>
        <div class="ob-field"><label class="ob-label">Company Logo <span class="ob-hint-inline">PNG, optional</span></label>
          <input type="hidden" id="ob-logo-url" value="${_esc(logo)}">
          <input type="file" id="ob-logo-file" accept="image/png,image/jpeg" class="ob-file"
            onchange="_handleFileUpload(this,'ob-logo-url','rms-files','logos')">
          <div id="ob-logo-url-prev">${ logo ? `<img src="${_esc(logo)}" class="ob-logo-prev" alt="logo">` : '' }</div>
        </div>
      </div>`;
  }

  // ── Panel 2: Branding ─────────────────────────────────────────────────
  function _p2() {
    const b = _state.branding, color = b.brand_color || '#2563EB', mode = b.mode || 'light';
    const sw = SWATCHES.map(hex => `<button type="button" class="ob-swatch${hex.toLowerCase()===color.toLowerCase()?' ob-swatch-on':''}"
        style="background:${hex}" data-hex="${hex}" onclick="OB._pickColor('${hex}')"></button>`).join('');
    return `
      <div class="ob-panel-hd">
        <div class="ob-panel-title">Branding</div>
        <div class="ob-panel-sub">Pick your primary colour and default theme. Can be changed anytime from <strong>Admin → Branding</strong>.</div>
      </div>
      <div class="ob-fields">
        <div class="ob-field"><label class="ob-label">Primary Colour *</label>
          <div class="ob-swatch-grid">${sw}</div>
          <div class="ob-color-row">
            <input id="ob-brand-color" class="ob-input" style="max-width:140px" value="${_esc(color)}"
              oninput="OB._customColor(this.value)" placeholder="#2563EB">
            <span class="ob-color-chip" id="ob-color-chip" style="background:${_esc(color)}"></span>
            <span class="ob-hint-inline">used for buttons, links &amp; highlights</span>
          </div>
        </div>
        <div class="ob-field"><label class="ob-label">Default Theme</label>
          <div class="ob-mode-grid">
            ${['light','dark'].map(m => `<button type="button" class="ob-mode-card${mode===m?' ob-mode-on':''}"
              data-mode="${m}" onclick="OB._pickMode('${m}')">
              <div class="ob-mode-dot ob-mode-${m}"></div>
              <div>${m==='light'?'Light':'Dark'}</div></button>`).join('')}
          </div>
        </div>
      </div>`;
  }

  // ── Panel 3: Projects / Sites ─────────────────────────────────────────
  function _p3() {
    // Step 2 (module reuse): inline cards removed. Wizard now opens the full Add Project
    // modal (#m-project, lives in login.html) — same form as the Projects page. Projects
    // are created immediately via the modal's save handler and appear here on refresh.
    const existing = _existing.projects || [];
    const existingSection = existing.length ? `
      <div class="ob-existing-block">
        <div class="ob-existing-title">Your sites <span>${existing.length}</span></div>
        <div class="ob-existing-list">
          ${existing.map(p => `
            <div class="ob-existing-card">
              <div class="ob-existing-name">${_esc(p.project_name || '(no name)')}</div>
              <div class="ob-existing-meta">
                ${p.project_code ? `<span class="ob-existing-code">${_esc(p.project_code)}</span>` : ''}
                ${p.total_units ? `<span>${p.total_units} units</span>` : ''}
                ${p.city ? `<span>${_esc(p.city)}</span>` : ''}
                ${p.location ? `<span>${_esc(p.location)}</span>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="ob-existing-note">Edit any field of these sites later from the <strong>Projects</strong> page.</div>
      </div>` : '<div class="ob-empty" style="margin-bottom:14px">No sites yet — click below to add your first.</div>';
    const atCap = _limits.projectsRemaining != null && existing.length >= _limits.projectsRemaining;
    return `
      <div class="ob-panel-hd">
        <div class="ob-panel-title">Projects &amp; Sites</div>
        <div class="ob-panel-sub">Add each site you operate. Clicking <strong>+ Add site</strong> opens the same full form used on the Projects page — name, description, builder, NOC, GPS, amenities, cover images. At least one site is required to proceed.</div>
      </div>
      ${existingSection}
      ${ atCap ? '<div class="ob-limit-msg">⚠ Maximum sites reached for your plan. Upgrade to add more.</div>' : '' }
      <button type="button" class="ob-add-btn" onclick="OB._addProjectViaModal()" ${atCap?'disabled':''}>
        + Add ${existing.length ? 'another ' : ''}site${atCap ? ' (plan limit reached)' : ''}
      </button>`;
  }

  // ── Panel 4: Business Rules ───────────────────────────────────────────
  function _p4() {
    const r = _state.rules;
    const v = (k,d) => (r[k] !== undefined && r[k] !== null && r[k] !== '') ? r[k] : d;
    return `
      <div class="ob-panel-hd">
        <div class="ob-panel-title">Business Rules</div>
        <div class="ob-panel-sub">Defaults that drive discounts, penalties &amp; possession. Used by approvals &amp; restrictions — adjustable later from <strong>Admin → Settings</strong>.</div>
      </div>
      <div class="ob-fields">
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">Max Discount %</label>
            <input id="ob-r-disc" class="ob-input" type="number" min="0" max="100" step="0.1" value="${_esc(v('max_discount_percent',10))}"></div>
          <div class="ob-field"><label class="ob-label">Late Payment Penalty %</label>
            <input id="ob-r-pen" class="ob-input" type="number" min="0" max="100" step="0.1" value="${_esc(v('late_payment_penalty_percent',2))}"></div>
        </div>
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">PDC Bounce Fee (PKR)</label>
            <input id="ob-r-pdc" class="ob-input" type="number" min="0" step="1" value="${_esc(v('pdc_bounce_fee',1000))}"></div>
          <div class="ob-field"><label class="ob-label">Grace Period (days)</label>
            <input id="ob-r-grace" class="ob-input" type="number" min="0" max="365" step="1" value="${_esc(v('grace_period_days',7))}"></div>
        </div>
        <div class="ob-field"><label class="ob-label">Possession Clearance % <span class="ob-hint-inline">min paid before possession</span></label>
          <input id="ob-r-poss" class="ob-input" type="number" min="0" max="100" step="0.1" value="${_esc(v('possession_clearance_percent',95))}"></div>
      </div>`;
  }

  // ── Panel 5: Users ────────────────────────────────────────────────────
  function _p5() {
    const code = (typeof S !== 'undefined' && S.coCode) ? S.coCode : 'COMPANY';
    const cards = _state.users.map((u,i) => {
      const siteChips = (_existing.projects || []).map((p,si) => {
        const on = (u.siteIdx||[]).includes(si);
        return `<label class="ob-type-chip${on?' ob-type-checked':''}"><input type="checkbox" class="js-u-site" value="${si}" ${on?'checked':''}
          onchange="this.closest('.ob-type-chip').classList.toggle('ob-type-checked',this.checked)">${_esc(p.project_name)}</label>`;
      }).join('') || '<span class="ob-hint-inline">Add sites in Step 3 first to assign access here</span>';
      const permChips = PERMISSIONS.map(p => {
        const on = u.permissions && u.permissions[p.k];
        return `<label class="ob-type-chip${on?' ob-type-checked':''}"><input type="checkbox" class="js-u-perm" value="${p.k}" ${on?'checked':''}
          onchange="this.closest('.ob-type-chip').classList.toggle('ob-type-checked',this.checked)">${p.l}</label>`;
      }).join('');
      const role = u.role || 'recovery_officer';
      return `
      <div class="ob-user-card" data-i="${i}">
        <div class="ob-rep-head">
          <span class="ob-rep-title">User ${i+1}</span>
          <button type="button" class="ob-rep-rm" onclick="OB._removeUser(${i})">Remove</button>
        </div>
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">Full Name *</label>
            <input class="ob-input js-u-name" value="${_esc(u.full_name||'')}" placeholder="Muhammad Ahmed" oninput="OB._userNamePreview(${i})"></div>
          <div class="ob-field"><label class="ob-label">Role</label>
            <select class="ob-input ob-select js-u-role" onchange="OB._userNamePreview(${i})">
              ${ROLES.map(r => `<option value="${r.v}" ${role===r.v?'selected':''}>${r.l}</option>`).join('')}
            </select></div>
        </div>
        <div class="ob-field-row">
          <div class="ob-field"><label class="ob-label">Email <span class="ob-hint-inline">optional</span></label>
            <input class="ob-input js-u-email" type="email" value="${_esc(u.email||'')}" placeholder="ahmed@company.com"
              inputmode="email" maxlength="120" oninput="this.classList.remove('ob-input-err')"></div>
          <div class="ob-field"><label class="ob-label">Phone <span class="ob-hint-inline">optional</span></label>
            <input class="ob-input js-u-phone" type="tel" value="${_esc(u.phone||'')}" placeholder="+92 300 0000000"
              inputmode="tel" pattern="[+]?[\\d\\s()\\-]{7,20}" maxlength="20" oninput="this.classList.remove('ob-input-err')"></div>
        </div>
        <div class="ob-field"><label class="ob-label">Initial Password *<span class="ob-hint-inline">min 8 chars — user changes on first login</span></label>
          <input class="ob-input js-u-pass" type="password" value="${_esc(u.password||'')}" autocomplete="new-password" placeholder="Set a temporary password"></div>
        <div class="ob-field"><label class="ob-label">Username <span class="ob-hint-inline">auto-generated</span></label>
          <div class="ob-username-pill" id="ob-uname-${i}">${_esc((role)+'@'+code)}</div></div>
        <div class="ob-field"><label class="ob-label">Assign Sites</label><div class="ob-type-grid">${siteChips}</div></div>
        <div class="ob-field"><label class="ob-label">Module Permissions</label><div class="ob-type-grid">${permChips}</div></div>
      </div>`;
    }).join('');
    const usersAtCap   = _limits.usersRemaining != null && _state.users.length >= _limits.usersRemaining;
    const userQuotaTxt = _limits.usersRemaining != null
      ? `up to <strong>${_limits.usersRemaining}</strong> more on your plan`
      : 'as many as your plan allows';
    const existingU = _existing.users || [];
    const existingSection = existingU.length ? `
      <div class="ob-existing-block">
        <div class="ob-existing-title">Already in your workspace <span>${existingU.length}</span></div>
        <div class="ob-existing-list">
          ${existingU.map(u => `
            <div class="ob-existing-card">
              <div class="ob-existing-name">${_esc(u.full_name || u.username || '(unnamed)')}</div>
              <div class="ob-existing-meta">
                ${u.username ? `<span class="ob-existing-code">${_esc(u.username)}</span>` : ''}
                <span>${_esc((ROLES.find(r=>r.v===u.role)?.l) || u.role || '')}</span>
                ${u.role === 'owner' ? '<span class="ob-existing-badge">Owner</span>' : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="ob-existing-note">These users already exist and count toward your plan cap. Manage them from User Management after setup.</div>
      </div>` : '';
    return `
      <div class="ob-panel-hd">
        <div class="ob-panel-title">Create Users</div>
        <div class="ob-panel-sub">${existingU.length ? 'Existing users are shown above (read-only). ' : ''}Add new teammates — ${userQuotaTxt}. Username auto-generates as <code>role@${_esc(code)}</code>. Leave empty to skip.</div>
      </div>
      ${existingSection}
      <div class="ob-rep-list">${cards || '<div class="ob-empty">No new users yet — add your first team member, or skip and add later from User Management.</div>'}</div>
      ${ usersAtCap ? '<div class="ob-limit-msg">⚠ Maximum users reached for your plan. Upgrade to add more.</div>' : '' }
      <button type="button" class="ob-add-btn" onclick="OB._addUser()" ${usersAtCap?'disabled':''}>
        + Add user${usersAtCap?' (plan limit reached)':''}
      </button>`;
  }

  // ── Panel 6: Review & Launch ──────────────────────────────────────────
  function _p6() {
    _collectCurrent();
    const c = _state.company, b = _state.branding, r = _state.rules;
    // Sites come from _existing.projects now (modal-based creation), users still drafted in _state
    const sites = _existing.projects || [];
    const users = _state.users.filter(u=>u.full_name);
    const row = (l,v) => `<div class="ob-rev-row"><span>${l}</span><b>${_esc(v||'—')}</b></div>`;
    const sec = (title,step,body) => `<div class="ob-rev-sec"><div class="ob-rev-hd"><span>${title}</span>
      <button type="button" class="ob-rev-edit" onclick="OB._goto(${step})">Edit</button></div>${body}</div>`;
    return `
      <div class="ob-panel-hd">
        <div class="ob-panel-title">Review &amp; Launch</div>
        <div class="ob-panel-sub">Confirm everything below, then launch your workspace.</div>
      </div>
      ${sec('Company',1, row('Name',c.company_name)+row('NTN',c.ntn)+row('City',c.city)+row('Phone',c.business_phone)+row('Email',c.business_email)+row('Logo', c.logo_url?'Uploaded':'—'))}
      ${sec('Branding',2, `<div class="ob-rev-row"><span>Primary colour</span><b><span class="ob-color-chip" style="background:${_esc(b.brand_color||'#2563EB')}"></span> ${_esc(b.brand_color||'#2563EB')}</b></div>`+row('Default theme',(b.mode||'light')))}
      ${sec('Projects / Sites',3, sites.length ? sites.map(s=>row(s.project_name, (s.total_units?s.total_units+' units':'')+(s.location?' · '+s.location:'')+(s.city?' · '+s.city:''))).join('') : `<div class="ob-rev-empty">No sites added</div>`)}
      ${sec('Business Rules',4, row('Max discount', (r.max_discount_percent??10)+'%')+row('Late penalty',(r.late_payment_penalty_percent??2)+'%')+row('PDC bounce fee','PKR '+(r.pdc_bounce_fee??1000))+row('Grace period',(r.grace_period_days??7)+' days')+row('Possession clearance',(r.possession_clearance_percent??95)+'%'))}
      ${sec('Users',5, users.length ? users.map(u=>row(u.full_name, ROLES.find(x=>x.v===u.role)?.l || u.role)).join('') : `<div class="ob-rev-empty">No additional users</div>`)}
      <div class="ob-done-tip">Clicking <strong>Launch Workspace</strong> saves company &amp; branding, creates your team members, applies business rules, and opens your dashboard. (Sites already created via Step 3.) Anything skipped can be set anytime from the respective module.</div>`;
  }

  // ── Collect (DOM → _state) ────────────────────────────────────────────
  function _collectCurrent() {
    if (_step === 1) {
      _state.company = {
        company_name: _v('ob-co-name'), ntn: _v('ob-co-ntn'), address: _v('ob-co-address'),
        city: _v('ob-co-city'), country: _sel('ob-co-country'),
        business_phone: _v('ob-co-phone'), business_email: _v('ob-co-email'),
        logo_url: _v('ob-logo-url'),
      };
    } else if (_step === 2) {
      _state.branding = { brand_color: _v('ob-brand-color') || '#2563EB', mode: _state.branding.mode || 'light' };
    } else if (_step === 3) {
      _collectSites();
    } else if (_step === 4) {
      _state.rules = {
        max_discount_percent: _num('ob-r-disc'), late_payment_penalty_percent: _num('ob-r-pen'),
        pdc_bounce_fee: _num('ob-r-pdc'), grace_period_days: _num('ob-r-grace'),
        possession_clearance_percent: _num('ob-r-poss'),
      };
    } else if (_step === 5) {
      _collectUsers();
    }
  }

  function _collectSites() {
    const cards = [...document.querySelectorAll('#ob-panel-wrap .ob-rep-card')];
    if (!cards.length) return;
    // Reject malformed dates (e.g. 5-digit year `22026-03-11` from manual type-input)
    const safeDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : '';
    const val      = (el) => (el?.value || '').trim();
    _state.sites = cards.map(card => ({
      name:                     val(card.querySelector('.js-site-name')),
      description:              val(card.querySelector('.js-site-desc')),
      location:                 val(card.querySelector('.js-site-loc')),
      city:                     val(card.querySelector('.js-site-city')),
      total_units:              val(card.querySelector('.js-site-units')),
      total_area:               val(card.querySelector('.js-site-area')),
      area_unit:                card.querySelector('.js-site-area-unit')?.value || 'sqft',
      builder_name:             val(card.querySelector('.js-site-builder-name')),
      builder_contact:          val(card.querySelector('.js-site-builder-contact')),
      builder_email:            val(card.querySelector('.js-site-builder-email')),
      start_date:               safeDate(card.querySelector('.js-site-start')?.value),
      expected_completion_date: safeDate(card.querySelector('.js-site-completion')?.value),
      delivery_date:            safeDate(card.querySelector('.js-site-date')?.value),
    }));
  }

  function _collectUsers() {
    const cards = [...document.querySelectorAll('#ob-panel-wrap .ob-user-card')];
    _state.users = cards.map(card => {
      const perms = {};
      card.querySelectorAll('.js-u-perm:checked').forEach(c => perms[c.value] = true);
      const siteIdx = [...card.querySelectorAll('.js-u-site:checked')].map(c => Number(c.value));
      return {
        full_name: card.querySelector('.js-u-name')?.value.trim() || '',
        role:      card.querySelector('.js-u-role')?.value || 'recovery_officer',
        email:     card.querySelector('.js-u-email')?.value.trim() || '',
        phone:     card.querySelector('.js-u-phone')?.value.trim() || '',
        password:  card.querySelector('.js-u-pass')?.value || '',
        permissions: perms, siteIdx,
      };
    });
  }

  // ── Validation (returns error string or null; highlights bad fields) ──
  const _RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const _RX_PHONE = /^[+]?[\d\s()\-]{7,20}$/;
  const _RX_NTN   = /^[\d-]{7,15}$/;
  function _markErr(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (el) { el.classList.add('ob-input-err'); try { el.focus(); } catch(_){} }
  }
  function _clearErrs() {
    document.querySelectorAll('#ob-panel-wrap .ob-input-err').forEach(el => el.classList.remove('ob-input-err'));
  }
  function _validate(step) {
    _clearErrs();
    if (step === 1) {
      const c = _state.company;
      if (!c.company_name) { _markErr('ob-co-name'); return 'Company name is required.'; }
      if (c.business_email && !_RX_EMAIL.test(c.business_email)) {
        _markErr('ob-co-email'); return 'Email must look like name@domain.com'; }
      if (c.business_phone && !_RX_PHONE.test(c.business_phone)) {
        _markErr('ob-co-phone'); return 'Phone: digits only with optional + - ( ) spaces (7–20 chars).'; }
      if (c.ntn && !_RX_NTN.test(c.ntn)) {
        _markErr('ob-co-ntn'); return 'NTN: 7–15 digits with optional hyphen (e.g. 1234567-8).'; }
    }
    if (step === 3) {
      if (!(_existing.projects || []).length) return 'Add at least one site (click + Add site to open the form).';
    }
    if (step === 4) {
      const r = _state.rules, pct = ['max_discount_percent','late_payment_penalty_percent','possession_clearance_percent'];
      for (const k of pct) if (r[k] !== '' && (r[k] < 0 || r[k] > 100)) return 'Percentages must be between 0 and 100.';
      if (r.pdc_bounce_fee < 0 || r.grace_period_days < 0) return 'Fees and days cannot be negative.';
    }
    if (step === 5) {
      const cards = [...document.querySelectorAll('#ob-panel-wrap .ob-user-card')];
      for (let i=0;i<_state.users.length;i++){
        const u = _state.users[i];
        const card = cards[i];
        if (!u.full_name && !u.password) continue;          // empty card → ignored
        if (!u.full_name) { _markErr(card?.querySelector('.js-u-name')); return `User ${i+1}: full name is required.`; }
        if (!u.password || u.password.length < 8) { _markErr(card?.querySelector('.js-u-pass')); return `User ${i+1}: password must be at least 8 characters.`; }
        if (u.email && !_RX_EMAIL.test(u.email)) { _markErr(card?.querySelector('.js-u-email')); return `User ${i+1}: email must look like name@domain.com`; }
        if (u.phone && !_RX_PHONE.test(u.phone)) { _markErr(card?.querySelector('.js-u-phone')); return `User ${i+1}: phone — digits only with optional + - ( ) spaces.`; }
      }
    }
    return null;
  }

  // ── Draft save ────────────────────────────────────────────────────────
  async function _saveDraft(step) {
    const key = STEP_KEY[step];
    if (!key) return true;
    let data = {};
    if (step === 1) data = { ..._state.company };
    if (step === 2) data = { ..._state.branding };
    if (step === 3) data = { sites: _state.sites };
    if (step === 4) data = { ..._state.rules };
    if (step === 5) data = { users: _state.users.map(({ password, ...rest }) => rest) };  // never persist passwords
    try {
      const { data: res, error } = await supabase.rpc('update_setup_step', {
        p_step_key: key, p_data: data, p_status: 'in_progress'
      });
      if (error || !res?.success) throw new Error(res?.message || error?.message || 'save failed');
      return true;
    } catch (e) {
      if (typeof toast === 'function') toast('Could not save progress: ' + (e.message || e), 'err');
      return false;
    }
  }

  // ── Launch ──────────────────────────────────────────────────────────
  async function finish() {
    _collectCurrent();
    if (!_state.company.company_name) { if (typeof toast==='function') toast('Company name missing (Step 1).','err'); _step=1; _render(); return; }
    if (!_state.sites.some(s=>s.name)) { if (typeof toast==='function') toast('Add at least one site (Step 3).','err'); _step=3; _render(); return; }
    _setBusy(true);
    try {
      const c = _state.company, b = _state.branding, r = _state.rules;

      // 1. Company profile + settings + branding (NTN). logo_url kept in draft — see note below.
      await _rpc('update_company_profile', { p_company_id:_cid, p_data:{
        company_name:c.company_name, business_phone:c.business_phone||null, business_email:c.business_email||null,
        city:c.city||null, country:c.country||'Pakistan', address:c.address||null,
        logo_url: c.logo_url || null } });   // logo persists now that update_company_profile accepts it
      await _rpc('update_company_settings', { p_company_id:_cid, p_data:{
        currency:'PKR', brand_color:b.brand_color||'#2563EB' } });
      await _rpc('save_company_branding', { p_company_id:_cid, p_data:{
        ntn_number:c.ntn||null, doc_brand_color:b.brand_color||null, address_full:c.address||null } });
      // Persist business rules + theme to their draft keys (durable in company_setup_progress.data)
      await _rpc('update_setup_step', { p_step_key:'categories', p_data:r, p_status:'in_progress' });
      try { localStorage.setItem('rms.theme.' + _cid, b.mode || 'light'); } catch(_) {}

      // 2. Projects — IDEMPOTENT (skip names already in the company; per-item try/catch)
      if (typeof loadProjectsCache === 'function') await loadProjectsCache(_cid);
      const nameToId = {};
      (window._projectsCache || []).forEach(p => { nameToId[(p.project_name||'').toLowerCase().trim()] = p.id; });
      let projCreated = 0, projSkipped = 0, projFailed = 0;
      for (const s of _state.sites.filter(s=>s.name)) {
        const key = s.name.toLowerCase().trim();
        if (nameToId[key]) { projSkipped++; continue; }
        try {
          const code = (s.name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5) || 'SITE') + (100+Math.floor(Math.random()*900));
          const { data, error } = await supabase.rpc('upsert_project', { p_company_id:_cid, p_data:{
            project_name:    s.name,
            project_code:    code,
            description:     s.description || null,
            location:        s.location || null,
            city:            s.city || null,
            total_units:     s.total_units ? parseInt(s.total_units,10) : null,
            total_area:      s.total_area  ? parseFloat(s.total_area)   : null,
            area_unit:       s.area_unit || 'sqft',
            builder_name:    s.builder_name || null,
            builder_contact: s.builder_contact || null,
            builder_email:   s.builder_email || null,
            start_date:               s.start_date || null,
            expected_completion_date: s.expected_completion_date || null,
            delivery_date:            s.delivery_date || null,
            status: 'active'
          }, p_id: null });
          if (error) throw error;
          if (data && data.success === false) throw new Error(data.message || data.error || 'create_failed');
          projCreated++;
        } catch (e) {
          projFailed++;
          const raw = (e && e.message) ? String(e.message) : 'error';
          const friendly = /plan.?limit|limit.?reached|exceed/i.test(raw) ? 'plan limit reached for projects' : raw;
          if (typeof toast === 'function') toast('Site "' + s.name + '" not created: ' + friendly, 'err');
        }
      }
      if (typeof loadProjectsCache === 'function') await loadProjectsCache(_cid);
      (window._projectsCache || []).forEach(p => { nameToId[(p.project_name||'').toLowerCase().trim()] = p.id; });

      // 3. Users + site assignments — per-item try/catch
      let userCreated = 0, userFailed = 0;
      for (const u of _state.users.filter(u=>u.full_name && u.password)) {
        try {
          const { data: ur, error } = await supabase.rpc('create_app_user', {
            p_company_id:_cid, p_full_name:u.full_name, p_role:u.role,
            p_password:u.password, p_email:u.email||null, p_phone:u.phone||null,
            p_module_permissions: u.permissions || {} });
          if (error) throw error;
          if (!ur?.success) throw new Error(ur?.message || ur?.error || 'create_failed');
          userCreated++;
          for (const idx of (u.siteIdx||[])) {
            const proj = (_existing.projects || [])[idx];
            const pid  = proj && proj.id;
            if (pid) await supabase.rpc('assign_user_to_project', {
              p_user_id: ur.user_id, p_project_id: pid, p_access_level: 'edit', p_notes: null });
          }
        } catch (e) {
          userFailed++;
          const raw = (e && e.message) ? String(e.message) : 'error';
          const friendly = /plan.?limit|limit.?reached|exceed/i.test(raw) ? 'plan limit reached for users' : raw;
          if (typeof toast === 'function') toast('User "' + u.full_name + '" not created: ' + friendly, 'err');
        }
      }

      // Summary toast — surfaces partial successes/failures clearly
      const parts = [];
      if (projCreated) parts.push(projCreated + ' site' + (projCreated>1?'s':'') + ' created');
      if (projSkipped) parts.push(projSkipped + ' site' + (projSkipped>1?'s':'') + ' already existed');
      if (projFailed)  parts.push(projFailed  + ' site' + (projFailed >1?'s':'') + ' failed');
      if (userCreated) parts.push(userCreated + ' user' + (userCreated>1?'s':'') + ' created');
      if (userFailed)  parts.push(userFailed  + ' user' + (userFailed >1?'s':'') + ' failed');
      if (parts.length && typeof toast === 'function')
        toast(parts.join(' · '), (projFailed||userFailed) ? 'warn' : 'ok');

      // 4. Complete all 6 step keys in sort-order → flips onboarding_complete
      for (const k of ALL_KEYS) await supabase.rpc('complete_setup_step', { p_step_key: k });

      if (typeof S !== 'undefined') S.onboardingComplete = true;
      hide();
      if (typeof nav === 'function') nav('dashboard');
      if (typeof toast === 'function') toast('Welcome to Nexunova RMS — your workspace is ready!', 'ok');
      if (typeof TUT !== 'undefined') TUT.maybeShow();
    } catch (e) {
      if (typeof toast === 'function') toast('Launch failed: ' + (e.message || e), 'err');
    } finally { _setBusy(false); }
  }

  // ── Dynamic handlers ──────────────────────────────────────────────────
  function _addSite()   {
    _collectSites();
    if (_limits.projectsRemaining != null && _state.sites.length >= _limits.projectsRemaining) return;
    _state.sites.push({}); _renderPanel();
  }

  // Step-2 module-reuse: open the full Projects page modal (#m-project lives in login.html)
  // and refresh wizard once user closes it (saved or cancelled — either way reflects DB).
  function _addProjectViaModal() {
    if (typeof openProjectModal !== 'function') {
      if (typeof toast === 'function') toast('Project form not available — refresh and try again.', 'err');
      return;
    }
    openProjectModal(null);
    const modal = document.getElementById('m-project');
    if (!modal) return;
    let wasOpen = false;
    const obs = new MutationObserver(async () => {
      const open = modal.classList.contains('open');
      if (open) { wasOpen = true; return; }
      if (wasOpen && !open) {
        obs.disconnect();
        await Promise.all([_loadExistingEntities(), _loadLimits()]);
        _renderPanel();
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
  function _removeSite(i){ _collectSites(); _state.sites.splice(i,1); if(!_state.sites.length) _state.sites=[{}]; _renderPanel(); }
  function _addUser()   {
    _collectUsers();
    if (_limits.usersRemaining != null && _state.users.length >= _limits.usersRemaining) return;
    _state.users.push({ role:'recovery_officer', permissions:{}, siteIdx:[] }); _renderPanel();
  }
  function _removeUser(i){ _collectUsers(); _state.users.splice(i,1); _renderPanel(); }
  function _pickColor(hex){ _state.branding.brand_color = hex; _renderPanel(); }
  function _customColor(val){ _state.branding.brand_color = val;
    const chip=document.getElementById('ob-color-chip'); if(chip&&/^#?[0-9a-fA-F]{3,8}$/.test(val)) chip.style.background=val; }
  function _pickMode(m){ _collectCurrent(); _state.branding.mode = m; _renderPanel(); }
  function _userNamePreview(i){
    const card=document.querySelectorAll('#ob-panel-wrap .ob-user-card')[i]; if(!card) return;
    const role=card.querySelector('.js-u-role')?.value||'recovery_officer';
    const code=(typeof S!=='undefined'&&S.coCode)?S.coCode:'COMPANY';
    const pill=document.getElementById('ob-uname-'+i); if(pill) pill.textContent = role+'@'+code;
  }
  function _goto(step){ _collectCurrent(); _step = step; _render(); }

  // ── Helpers ───────────────────────────────────────────────────────────
  // Onboarding calls toast(msg,type) as a function, but the global window.toast is an
  // OBJECT { error, success, warning, info } — so every `typeof toast === 'function'`
  // guard was false and validation messages were silently swallowed (a user could leave
  // a required field empty and see nothing). This local wrapper routes them to the real
  // toast UI so required-field errors are actually visible.
  function toast(msg, type) {
    const T = (typeof window !== 'undefined') ? window.toast : null;
    if (T) {
      const fn = ({ err:T.error, error:T.error, ok:T.success, success:T.success,
                    warn:T.warning, warning:T.warning, info:T.info }[type]) || T.info;
      try { fn(msg); return; } catch (_) {}
    }
    if (typeof notify !== 'undefined') {
      const nf = (type==='err'||type==='error') ? notify.error
               : (type==='ok'||type==='success') ? notify.success : notify.info;
      try { nf && nf(msg); } catch (_) {}
    }
  }

  function _rpc(fn, args) { return supabase.rpc(fn, args).then(({data,error}) => { if (error) throw error; return data; }); }
  function _v(id)   { return (document.getElementById(id)?.value || '').trim(); }
  function _sel(id) { return document.getElementById(id)?.value || ''; }
  function _num(id) { const x = document.getElementById(id)?.value; return x===''||x==null ? '' : Number(x); }
  function _setBusy(b){ _saving=b; const btn=document.getElementById('ob-btn-next'), lbl=document.getElementById('ob-btn-next-label');
    if(btn) btn.disabled=b; if(lbl) lbl.textContent = b ? 'Working…' : (_step===_total ? '🚀 Launch Workspace' : 'Next →'); }
  function _esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── Expose ───────────────────────────────────────────────────────────
  return {
    show, hide, skip, skipStep, cancel, deferSetup, back, next, finish,
    _addSite, _removeSite, _addUser, _removeUser, _pickColor, _customColor, _pickMode, _userNamePreview, _goto, _addProjectViaModal,
    // legacy compat
    saveProject: next, saveCategories: next,
  };
})();
