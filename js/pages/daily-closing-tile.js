/* ════════════════════════════════════════════════════════════════════════
   DAILY CLOSING — S8, the dashboard tile  ·  BLUEPRINT §A12  ·  P9
   ────────────────────────────────────────────────────────────────────────
   window.DCTile.mount(hostEl, { rpc, projects, projectId, me, onOpen }).

   The same shape as the S1 component: `rpc` is injected, nothing here knows
   what a Supabase client looks like, and the whole tile is ONE call —
   get_daily_closing_tile returns the status, the figures, the five counters
   and the last seven days together. A tile that fires five queries becomes
   fifteen the moment somebody picks "All projects".

   WHAT IT IS NOT. It is not the Group Position board — one row per project
   plus a total — which is Phase 4. Across projects this shows one aggregate
   and says so; it does not list the projects.

   THE COUNTERS ARE HONEST ABOUT WHERE THEY GO. Each is a link. Three of them
   open the cash book, because that is where a pending receipt or an unexported
   entry is actually dealt with; the PDC ones open the PDC register, which is a
   page RMS already has. None of them pretends to be a filtered list that does
   not exist yet.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var F = global.DCFmt, K = global.DCKit;

  /* §A12's five, in the order the blueprint lists them. `to` is what the
     number means when you click it — not a destination invented to make the
     tile look busy. */
  var COUNTERS = [
    { key: 'receipts_pending', label: 'Receipts pending',  tone: 'warn',
      title: 'Client receipts recorded but not yet applied to an installment' },
    { key: 'not_exported',     label: 'Not exported',      tone: null,
      title: 'Entries on days that are closed and have not been exported to QuickBooks' },
    { key: 'unapplied',        label: 'Unapplied',         tone: 'out',
      title: 'Receipts that were voided or could not be applied' },
    { key: 'pdc_pending',      label: 'PDC pending',       tone: null, pdc: true,
      title: 'Cheques in hand, not yet deposited' },
    { key: 'pdc_due_7',        label: 'PDC due ≤ 7 days',  tone: 'warn', pdc: true,
      title: 'Cheques falling due within the week' }
  ];

  function esc(s) { return K.esc(s); }

  function mount(host, opts) {
    var S = {
      rpc: opts.rpc,
      me: opts.me || {},
      projects: opts.projects || [],
      projectId: opts.projectId || null,   // null = all projects
      onOpen: opts.onOpen || function () {},
      data: null, error: null
    };
    host.classList.add('dc');

    function load() {
      render(true);
      return S.rpc('get_daily_closing_tile', {
        p_company_id: S.me.companyId, p_project_id: S.projectId
      }).then(function (r) {
        if (r && r.success) { S.data = r; S.error = null; }
        else { S.data = null; S.error = (r && r.message) || (r && r.error) || 'Unavailable'; }
        render(false);
      }).catch(function (e) {
        S.data = null; S.error = (e && e.message) || 'Unavailable'; render(false);
      });
    }

    function render(loading) {
      if (loading) {
        host.innerHTML = '<div class="dc-tile">' + head() +
          '<div class="dc-tile-body">' + K.skeleton({ height: '64px' }) +
          K.skeleton({ height: '40px' }) + '</div></div>';
        wire();
        return;
      }
      // NOT_AUTHORIZED here is not an error to shout about: it means this
      // person has no cash book, and the tile simply is not for them.
      if (!S.data) { host.innerHTML = ''; return; }
      host.innerHTML = '<div class="dc-tile">' + head() +
        '<div class="dc-tile-body">' + figures() + counters() + recent() + '</div></div>';
      wire();
    }

    function head() {
      var d = S.data || {};
      var canAll = d.role === 'CFO' || d.role === 'DIRECTOR' || S.projectId === null;
      return '<div class="dc-tile-head">' +
        '<div class="dc-tile-title">' + K.icon('wallet', 16) + 'Daily Closing' +
          (d.business_date ? '<span class="dc-tile-date">' +
            esc(F.dateShort(d.business_date)) + '</span>' : '') + '</div>' +
        '<div class="dc-tile-actions">' +
          '<select class="dc-select" id="dc-tile-project" aria-label="Project">' +
            (canAll ? '<option value=""' + (S.projectId === null ? ' selected' : '') +
              '>All projects</option>' : '') +
            S.projects.map(function (p) {
              return '<option value="' + esc(p.id) + '"' +
                (p.id === S.projectId ? ' selected' : '') + '>' + esc(p.name) + '</option>';
            }).join('') +
          '</select>' +
          '<button type="button" class="dc-btn" id="dc-tile-open">Open</button>' +
        '</div></div>';
    }

    /* §A12: "today's status + HeroFigures (or NOT OPENED / CLOSED with
       figures)". All three states say the figure, because a Director asking
       "where are we?" wants the number whatever the status is. */
    function figures() {
      var d = S.data;
      var chip = d.status ? K.statusChip(d.status)
        : '<span class="dc-chip dc-chip--closed">Not opened</span>';

      if (d.all_projects) {
        var bits = [];
        if (d.open_projects)       bits.push(d.open_projects + ' open');
        if (d.closed_projects)     bits.push(d.closed_projects + ' closed');
        if (d.not_opened_projects) bits.push(d.not_opened_projects + ' not opened');
        return '<div class="dc-tile-figs">' +
          K.heroFigure({ label: 'Cash', value: d.closing_cash, tone: 'in' }) +
          K.heroFigure({ label: 'Bank', value: d.closing_bank }) +
          '<div class="dc-tile-status">' +
            '<span class="dc-label">' + esc(d.projects) + ' projects</span>' +
            '<span class="dc-tile-mix">' + esc(bits.join(' · ') || '—') + '</span>' +
          '</div></div>';
      }
      return '<div class="dc-tile-figs">' +
        K.heroFigure({ label: 'Closing cash', value: d.closing_cash, tone: 'in' }) +
        K.heroFigure({ label: 'Closing bank', value: d.closing_bank }) +
        '<div class="dc-tile-status"><span class="dc-label">Today</span>' + chip + '</div>' +
      '</div>';
    }

    function counters() {
      var c = (S.data && S.data.counters) || {};
      return '<div class="dc-tile-counters">' + COUNTERS.map(function (m) {
        var n = Number(c[m.key] || 0);
        return '<button type="button" class="dc-tile-counter' +
            (n ? '' : ' dc-tile-counter--zero') + '"' +
            ' data-counter="' + esc(m.key) + '"' +
            (m.pdc ? ' data-pdc="1"' : '') +
            ' title="' + esc(m.title) + '">' +
          '<span class="dc-tile-n' + (n && m.tone ? ' dc-' + m.tone + '-col' : '') + '">' +
            esc(F.amount(n)) + '</span>' +
          '<span class="dc-tile-l">' + esc(m.label) + '</span>' +
        '</button>';
      }).join('') + '</div>';
    }

    function recent() {
      var d = S.data;
      if (d.all_projects) {
        return '<div class="dc-hint dc-tile-note">Pick a project to see its last seven days.</div>';
      }
      var rows = d.recent || [];
      if (!rows.length) {
        return '<div class="dc-hint dc-tile-note">No days recorded yet.</div>';
      }
      // The label is a div, not a <caption>. `.dc-label` sets display:block,
      // and a block-display caption is laid out after the header row rather
      // than above the table — the heading appeared between the column names
      // and the first row.
      return '<div><span class="dc-label">Last 7 days</span>' +
        '<table class="dc-tile-recent">' +
        '<thead><tr><th>Date</th><th class="dc-num">Cash</th>' +
        '<th class="dc-num">Bank</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          var closed = r.status === 'CLOSED';
          return '<tr data-day="' + esc(r.business_date) + '">' +
            '<td>' + esc(F.dateShort(r.business_date)) + '</td>' +
            '<td class="dc-num">' + (closed || r.closing_cash !== null
              ? esc(F.amount(r.closing_cash)) : '<span class="dc-hint">—</span>') + '</td>' +
            '<td class="dc-num">' + (closed || r.closing_bank !== null
              ? esc(F.amount(r.closing_bank)) : '<span class="dc-hint">—</span>') + '</td>' +
            '<td class="dc-linkcell">' + (r.pdf_document_id
              ? '<span class="dc-tile-pdf" title="A Director sheet exists for this day"' +
                ' aria-label="Director PDF available for ' + esc(F.dateShort(r.business_date)) +
                '">' + K.icon('file', 14) + '</span>'
              : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    function wire() {
      var sel = host.querySelector('#dc-tile-project');
      if (sel) sel.addEventListener('change', function () {
        S.projectId = sel.value || null;
        load();
      });
      var open = host.querySelector('#dc-tile-open');
      if (open) open.addEventListener('click', function () { S.onOpen(S.projectId, null); });

      Array.prototype.forEach.call(host.querySelectorAll('[data-counter]'), function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-pdc') && typeof global.nav === 'function') return global.nav('pdc');
          S.onOpen(S.projectId, null);
        });
      });
      Array.prototype.forEach.call(host.querySelectorAll('.dc-tile-recent tbody tr'), function (tr) {
        tr.addEventListener('click', function () {
          S.onOpen(S.projectId, tr.getAttribute('data-day'));
        });
      });
    }

    load();
    return { reload: load };
  }

  global.DCTile = { mount: mount };

  /* ── the shell adapter ──────────────────────────────────────────────────
     rDash() calls this after it has drawn, and only when the flag is on. Same
     shape as rDailyClosing(): the thirty lines that know about RMS globals. */
  global.rDailyClosingTile = function rDailyClosingTile() {
    var host = document.getElementById('dc-tile-host');
    if (!host) return;
    if (!(global._featureFlags && global._featureFlags.daily_closing === true)) {
      host.innerHTML = '';
      return;
    }
    // `S` and `supabase`, not `global.S` / `global.supabase` — see the long
    // notes in js/pages/daily-closing.js. Both are lexical bindings (`let S` in
    // js/data.js:5, `const supabase` in js/supabase.js:37) and neither is a
    // property of window. Reading them off `global` gave an empty session and
    // the UMD library. Here both failures were swallowed by dashboard.js's
    // try/catch, so the tile died in silence and only ever wrote
    // "[daily-closing] tile skipped" to a console nobody was reading.
    var sess = S || {};
    function rpc(name, args) {
      var missing = [];
      Object.keys(args || {}).forEach(function (k) {
        if (args[k] === undefined) missing.push(k);
      });
      if (missing.length) {
        return Promise.reject(new Error(
          'Cannot call ' + name + ' — ' + missing.join(', ') + ' missing from the session.'));
      }
      return supabase.rpc(name, args).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return r.data;
      });
    }
    var raw = (typeof _selectableProjects === 'function')
      ? _selectableProjects() : (global._projectsCache || []);
    var projects = raw.map(function (p) {
      return { id: p.id, name: p.project_name || p.name || p.id };
    });
    var active = (typeof activeProjectId === 'function') ? activeProjectId() : null;
    var start = projects.filter(function (p) { return p.id === active; })[0];

    mount(host, {
      rpc: rpc,
      me: { companyId: sess.cid, userId: sess.userId },
      projects: projects,
      projectId: (start || projects[0] || {}).id || null,
      onOpen: function (projectId, date) {
        // Hand the page the project and the day the person clicked on.
        global._dcOpenAt = { projectId: projectId, date: date };
        if (typeof global.nav === 'function') global.nav('dailyclosing');
      }
    });
  };
})(window);
