// ══════════════════════════════════════════════════════════════════════════
// LAZY PAGE LOADER (Declutter Phase A2 — 2026-07-06)
// The ~55 page render modules (js/pages/*.js) are no longer eager-loaded at
// login. They fetch on first navigation to their page. This file owns:
//   • PAGE_MODULES     — nav-key → [script srcs] manifest (a few pages bundle
//                        siblings they need at SYNC render time, e.g. the
//                        clients cluster, agents↔agenttransactions).
//   • _navLazyGuard    — called at the top of nav(): if the target page's
//                        module isn't loaded yet, load it then re-invoke nav
//                        and abort the current pass.
//   • lazy STUBS       — for the handful of cross-module openers/actions that
//                        eager code (dashboard, shell, modals) or a not-yet-
//                        loaded page may call by name (openSaleDetail, rAdmin,
//                        rUnitChain, plOpen*, print*, …). A stub loads the
//                        owning module then hands off to the real fn, which a
//                        classic-script function declaration installs over the
//                        stub on load.
//
// STAYS EAGER (loaded in login.html, NOT here): auth/shell/ui/utils/data/db/
// helpers/foundation(kit,print,report-page)/client-form/modals/schedule/sale-
// modal + the shared page-libraries that many pages call synchronously:
//   pages/print.js (print engine) · pages/ledgers.js (ledger framework) ·
//   pages/payment-wall.js (fmtPKR) · pages/tutorial.js · pages/dashboard.js
//   (landing) · pages/company-branding.js (hasFeature/feature-flags used in
//   nav itself) · pages/contacts.js (global Log-a-Call helpers) ·
//   pages/officer-report.js (rendered inline on the recovery dashboard) ·
//   pages/super-admin.js (self-boots on ?super-admin) · signup/onboarding.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── shared bundle arrays (deduped; versions match the former eager tags) ──
  var SALES        = ['js/pages/sales.js?v=20260817disc'];
  var PROJECTS     = ['js/pages/projects.js?v=20260613ps'];
  var UNITS        = ['js/pages/units.js?v=20260616a'];
  var AGENTS       = ['js/pages/agents.js?v=20260828priv'];
  var REPORTS      = ['js/pages/reports.js?v=20260902manual'];
  var AUDIT        = ['js/pages/audit.js?v=20260706p2b'];
  var ADMIN        = ['js/pages/admin.js?v=20260706p1b'];
  var APPROVALS    = ['js/pages/approvals.js?v=20260714uc'];
  var PAYLINKS     = ['js/pages/payment-links.js?v=20260517a'];
  var OWNCHAIN     = ['js/pages/ownership-chain.js?v=20260714uc'];
  var ESCAL        = ['js/pages/escalations.js?v=20260614rec'];
  var CANCELLATION = ['js/pages/cancellation.js?v=20260617a'];
  var TRANSFERS    = ['js/pages/transfers.js?v=20260713uc'];
  var FIELDVISITS  = ['js/pages/fieldvisits.js?v=20260706ff'];
  var PROMISES     = ['js/pages/promises.js?v=20260614w4'];
  // clients cluster — clientdetail tabs call rHealthCenter/rBlacklist (guarded)
  // and _cdLoadPromises (unguarded) at sync render, so its siblings ride along.
  var CLIENTS = [
    'js/pages/clients.js?v=20260902manual',
    'js/pages/health-center.js?v=20260604a',
    'js/pages/blacklist.js?v=20260604a',
    'js/pages/promises.js?v=20260614w4'
  ];
  // Online Portal is one tab-set spanning four modules that call into each other.
  var PORTAL = [
    'js/pages/sales-access.js?v=20260828priv',
    'js/pages/sale-submissions.js?v=20260617nom',
    'js/pages/reservations.js?v=20260615p2',
    'js/pages/dealer-agreement.js?v=20260618'
  ];
  // agenttransactions renders with agents.js CSS/format helpers (_agCSS/_agK).
  var AGENTTX = ['js/pages/agenttransactions.js?v=20260713a'].concat(AGENTS);
  // Change Unit is built on the same rops-* system as Transfer and borrows its
  // _opsWarmCSS bridge, so transfers.js must load with it.
  var UNITCHANGE = ['js/pages/unitchange.js?v=20260902words'].concat(TRANSFERS);

  // ── nav-key → script srcs ────────────────────────────────────────────────
  var M = {
    onlineportal: PORTAL, salesaccess: PORTAL, salesubmissions: PORTAL,
    reservations: PORTAL, dealeragreement: PORTAL,

    queue: ['js/pages/recovery-queue.js?v=20260615en'],

    newsale: SALES, editsale: SALES, sales: SALES, salesdetail: SALES,
    projects: PROJECTS, projectdetail: PROJECTS,
    units: UNITS, unitdetail: UNITS,
    unitmap: ['js/pages/unitmap.js?v=20260815map'],
    clients: CLIENTS, clientdetail: CLIENTS, healthcenter: CLIENTS, blacklist: CLIENTS,
    agents: AGENTS, agentdetail: AGENTS, commissions: AGENTS,

    recovery: ['js/pages/recovery.js?v=20260614rec'],
    addpayment: ['js/pages/payments.js?v=20260721shift'],
    receipts: ['js/pages/receipts.js?v=20260902words'],
    pdc: ['js/pages/pdc.js?v=20260613ps'],
    cancelledunits: ['js/pages/cancelled.js?v=20260720cxl'],
    transferunits: ['js/pages/transferred.js?v=20260613ps'],
    officerledger: ['js/pages/officerledger.js?v=20260613ps'],
    receivingledger: ['js/pages/receivingledger.js?v=20260613ps'],
    'ledger-client': ['js/pages/ledger-client.js?v=20260902manual'],
    'ledger-unit': ['js/pages/ledger-unit.js?v=20260616'],
    'ledger-agent': ['js/pages/ledger-agent.js?v=20260514e'],
    'ledger-project': ['js/pages/ledger-project.js?v=20260514e'],

    unittransfer: TRANSFERS, unitcancel: CANCELLATION, unitchange: UNITCHANGE, unitchain: OWNCHAIN,

    reminders: ['js/pages/reminders.js?v=20260614rec3'],
    callreport: ['js/pages/call-report.js?v=20260723dcr'],
    callsheet: ['js/pages/call-sheet.js?v=20260724cs7'],
    search: ['js/pages/search.js?v=20260517a'],
    reports: REPORTS, recoveryiq: REPORTS,
    agentrecovery: ['js/pages/agent-report.js?v=20260706p1b'],
    documents: ['js/pages/documents.js?v=20260617b'],
    statements: ['js/pages/statements.js?v=20260617b'],
    backup: ['js/pages/backup.js?v=20260618exp'],
    admin: ADMIN, changepassword: ADMIN,
    categories: ['js/pages/categories.js?v=20260613w2'],
    users: ['js/pages/users.js?v=20260905dc'],
    // Daily Closing (P8). Three files: the formatters and the kit the screen
    // needs, then the screen. Lazy like every other page, so a tenant without
    // the flag never downloads a byte of it.
    dailyclosing: ['js/foundation/dc-format.js?v=20260905dcfix',
                   'js/foundation/dc-kit.js?v=20260905dcfix',
                   'js/pages/daily-closing.js?v=20260905dcfix'],
    promises: PROMISES,
    audit: AUDIT,
    approvals: APPROVALS,
    team: ['js/pages/team.js?v=20260613ps'],
    paylinks: PAYLINKS, 'paylink-detail': PAYLINKS,
    'payment-methods': ['js/pages/payment-methods.js?v=20260612b2'],
    banks: ['js/pages/banks.js?v=20260612b1'],
    payables: ['js/pages/payables.js?v=20260522a'],
    receivables: ['js/pages/receivables.js?v=20260522a'],
    escalations: ESCAL,
    legalcases: ['js/pages/legalcases.js?v=20260706ff'],
    agenttransactions: AGENTTX,
    campaigns: ['js/pages/campaigns.js?v=20260706ff'],
    forecasting: ['js/pages/forecasting.js?v=20260614w4'],
    commscenter: ['js/pages/comms-center.js?v=20260528a'],
    noc: ['js/pages/noc.js?v=20260613ps'],
    fieldvisits: FIELDVISITS
  };

  // ── loader core (each src fetched at most once) ──────────────────────────
  var loaded = {}, loading = {};
  function loadOne(src) {
    if (loaded[src]) return Promise.resolve();
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;                 // preserve execution order within a bundle
      s.onload = function () { loaded[src] = true; res(); };
      s.onerror = function () { delete loading[src]; rej(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return loading[src];
  }
  function loadSeq(list) {
    return list.reduce(function (p, src) {
      return p.then(function () { return loadOne(src); });
    }, Promise.resolve());
  }
  function allLoaded(list) {
    for (var i = 0; i < list.length; i++) if (!loaded[list[i]]) return false;
    return true;
  }

  // ensurePageModules(pg) → Promise<boolean loadedSomething>
  window.ensurePageModules = function (pg) {
    var list = M[pg];
    if (!list || allLoaded(list)) return Promise.resolve(false);
    return loadSeq(list).then(function () { return true; });
  };

  // Load a list of scripts on demand, in order, each at most once. Used by the
  // dashboard to fetch the Daily Closing tile ONLY for a tenant that has the
  // flag — the tile is not a page, so it has no nav key to hang off.
  window._lazyLoadFiles = loadSeq;

  // _navLazyGuard(pg,x) → true if it kicked off a load (caller should abort).
  // NON-DESTRUCTIVE: we never touch the target page's DOM here. Some pages (e.g.
  // Online Portal) keep static sub-containers inside #pg-<key> that their render
  // fn only populates — wiping innerHTML for a spinner would break them. Loads
  // are small/fast; a brief no-op on the current page is fine. A body class is
  // toggled so CSS can show a cursor/progress cue if desired.
  window._navLazyGuard = function (pg, x) {
    var list = M[pg];
    if (!list || allLoaded(list)) return false;
    try { document.body.classList.add('nx-lazy-loading'); } catch (e) {}
    loadSeq(list)
      .then(function () { if (typeof nav === 'function') nav(pg, x); })
      .catch(function (e) { console.error('[lazy] page load failed:', pg, e); })
      .then(function () { try { document.body.classList.remove('nx-lazy-loading'); } catch (e) {} });
    return true;
  };

  // ── lazy stubs: cross-module openers/actions callable before their module
  //    is present. All are side-effectful (never used for a sync return), so an
  //    async hand-off is safe. When the owning module loads, its function
  //    declaration replaces the stub on window.
  var STUBS = {
    openSaleDetail: SALES, printSaleDetail: SALES,
    openRptViewer: REPORTS,
    openClientDetail: CLIENTS,
    openAuditHistory: AUDIT,
    rAdmin: ADMIN,
    rUnitChain: OWNCHAIN,
    escOpenNew: ESCAL,
    printCancellationVoucher: CANCELLATION,
    printTransferLetter: TRANSFERS,
    fvOpenLog: FIELDVISITS,
    prmLogNew: PROMISES,
    plOpenCreate: PAYLINKS, plOpenDetail: PAYLINKS, plOpenReject: PAYLINKS,
    plOpenUpload: PAYLINKS, plOpenVerify: PAYLINKS, plResend: PAYLINKS
  };
  function installStub(name, list) {
    if (typeof window[name] === 'function' && !window[name]._lazyStub) return; // real present
    var stub = function () {
      var args = arguments, ctx = this;
      return loadSeq(list).then(function () {
        var real = window[name];
        if (real && real !== stub) return real.apply(ctx, args);
        console.warn('[lazy] ' + name + ' still undefined after load');
      }).catch(function (e) { console.error('[lazy stub]', name, e); });
    };
    stub._lazyStub = true;
    window[name] = stub;
  }
  Object.keys(STUBS).forEach(function (n) { installStub(n, STUBS[n]); });

  // Expose for diagnostics / the verify harness.
  window.__lazyPages = { M: M, loaded: loaded, loading: loading, loadSeq: loadSeq };
})();
