/* ════════════════════════════════════════════════════════════════════
   TUTORIAL — Getting Started checklist
   Auto-shows on first login; re-openable via topbar ? button.
   ════════════════════════════════════════════════════════════════════ */

const TUT = (function () {

  const STEPS = [
    {
      key:   'project',
      title: 'Create your first Project',
      desc:  'A project groups all units for one building or development.',
      pg:    'projects',
      check: () => (window._projectsCache || []).length > 0
    },
    {
      key:   'categories',
      title: 'Set up Unit Categories',
      desc:  'Define Floors, Unit Types and Statuses before adding units.',
      pg:    'categories',
      check: () => (window._typesCache || []).length > 0
    },
    {
      key:   'units',
      title: 'Add Units to inventory',
      desc:  'Add your first unit with size, floor, price and status.',
      pg:    'units',
      check: () => (window._unitsCache || []).length > 0
    },
    {
      key:   'sale',
      title: 'Record your first Sale',
      desc:  'Select a unit and client, set the price and generate a payment schedule.',
      pg:    'newsale',
      check: () => false   // resolved via _dbCounts
    },
    {
      key:   'payment',
      title: 'Receive your first Payment',
      desc:  'Open the Payments module and mark an installment as received.',
      pg:    'payments',
      check: () => false   // resolved via _dbCounts
    }
  ];

  let _dbCounts   = { sales: 0, payments: 0 };
  let _fetchDone  = false;

  /* ── localStorage helpers ───────────────────────────────────────── */
  function _key(suffix) {
    const cid = (window.S && S.cid) ? S.cid : 'x';
    return 'rms.tut.' + cid + '.' + suffix;
  }

  function _isDone(step) {
    if (step.key === 'sale')    return _dbCounts.sales    > 0;
    if (step.key === 'payment') return _dbCounts.payments > 0;
    return step.check();
  }

  /* ── DB count fetch (lightweight HEAD queries) ──────────────────── */
  async function _fetchCounts() {
    if (!window.supabase || !window.S) return;
    try {
      const [sRes, pRes] = await Promise.all([
        supabase.from('sales')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', S.cid),
        supabase.from('installments')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', S.cid)
          .gt('amount_paid', 0)
      ]);
      _dbCounts.sales    = sRes.count || 0;
      _dbCounts.payments = pRes.count || 0;
    } catch (e) {
      console.warn('[TUT] fetchCounts:', e);
    }
    _fetchDone = true;
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  function _render() {
    const body = document.getElementById('tut-body');
    if (!body) return;

    const doneCount = STEPS.filter(s => _isDone(s)).length;
    const pct       = Math.round((doneCount / STEPS.length) * 100);
    const allDone   = doneCount === STEPS.length;

    const stepsHtml = STEPS.map((s, i) => {
      const done    = _isDone(s);
      const numHtml = done
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : String(i + 1);
      const goBtn = !done
        ? `<button class="tut-go" onclick="TUT.go('${esc(s.pg)}')">Go &rarr;</button>`
        : '';
      return `
        <div class="tut-step${done ? ' is-done' : ''}">
          <div class="tut-num">${numHtml}</div>
          <div class="tut-step-body">
            <div class="tut-step-title">${esc(s.title)}</div>
            <div class="tut-step-desc">${esc(s.desc)}</div>
          </div>
          ${goBtn}
        </div>`;
    }).join('');

    const doneBanner = allDone
      ? `<div class="tut-done-banner">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
             <polyline points="22 4 12 14.01 9 11.01"/>
           </svg>
           You&rsquo;re all set! Your workspace is fully configured.
         </div>`
      : '';

    const footBtn = allDone
      ? `<button class="tut-btn-ghost" onclick="TUT.close()">Close</button>`
      : `<button class="tut-btn-ghost" onclick="TUT.close()">Do this later</button>`;

    body.innerHTML = `
      <div class="tut-hd">
        <div class="tut-icon-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="tut-hd-text">
          <div class="tut-title">Get started with Nexunova RMS</div>
          <div class="tut-sub">Complete these steps to configure your workspace</div>
        </div>
        <button class="tut-close" onclick="TUT.close()" title="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="tut-progress-wrap">
        <div class="tut-progress">
          <div class="tut-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="tut-progress-lbl">
          <span><strong>${doneCount}</strong> of ${STEPS.length} completed</span>
          <strong>${pct}%</strong>
        </div>
      </div>

      <div class="tut-steps">${stepsHtml}</div>
      ${doneBanner}

      <div class="tut-foot">
        <span class="tut-foot-hint">Click the <strong>?</strong> button in the toolbar to reopen this guide anytime</span>
        <div class="tut-foot-btns">${footBtn}</div>
      </div>`;

    /* Sync the notification dot on the topbar button */
    const dot = document.querySelector('.tb-help-dot');
    if (dot) dot.classList.toggle('is-done', allDone);
  }

  /* ── Public API ─────────────────────────────────────────────────── */
  return {

    /* Open the checklist (always re-fetches fresh counts) */
    async open() {
      const overlay = document.getElementById('tut-overlay');
      if (!overlay) return;
      _render();                     // immediate skeleton
      overlay.classList.add('is-open');
      await _fetchCounts();
      _render();                     // accurate render after DB response
    },

    close() {
      document.getElementById('tut-overlay')?.classList.remove('is-open');
    },

    /* Navigate to a module and close the modal */
    go(pg) {
      this.close();
      if (typeof nav === 'function') nav(pg);
    },

    /* Show once automatically on first login for this company */
    async maybeShow() {
      if (!window.S) return;
      const seen = localStorage.getItem(_key('seen'));
      if (seen) return;
      localStorage.setItem(_key('seen'), '1');
      /* Small delay so the dashboard has time to render first */
      setTimeout(() => this.open(), 800);
    },

    /* Reset "seen" flag — useful for testing / super-admin */
    reset() {
      if (!window.S) return;
      localStorage.removeItem(_key('seen'));
      toast('Tutorial reset — will show on next login', 'info');
    }
  };
})();
