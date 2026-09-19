/**
 * NexuFinance v1 — the shared "Reports" navigation menu, used identically
 * on the daily closing sheet and every report screen. window.NfReportsMenu
 *
 * Built 2026-09-19 after the closing sheet's own header grew to 11+
 * individual report buttons in one unwrapped flex row (docs/PLAN.md §23)
 * — a real, growing UX problem (a director on a normal screen would face
 * the same horizontal overflow this app's own automated tests started
 * hitting). Ordered by how often something is actually used, per the
 * owner's own instruction, not alphabetically: Daily Closing first (the
 * one screen opened every day), then the formal statements, then the
 * detail reports.
 *
 * NfReportsMenu.html(activeKey) — returns the toggle button + panel
 * markup. Call once inside a screen's own render().
 *
 * NfReportsMenu.wire(root, ctx) — attaches the toggle and every item's
 * click handler. `ctx` is the exact { api, companyId, role, displayName,
 * companyName, settings, onBack } shape every nf_ report screen's own
 * mount() already receives — passed straight through to whichever other
 * report's .mount(root, ctx) is chosen, so onBack still correctly chains
 * back to the original closing sheet no matter how many reports deep the
 * navigation goes. "Daily Closing" is not a module — it calls ctx.onBack()
 * directly, the same function every report screen's own back button
 * already calls.
 */
(function (global) {
  'use strict';

  var GROUPS = [
    { label: null, items: [{ key: 'closing', label: 'Daily Closing' }, { key: 'jv', label: 'Journal Vouchers' }] },
    { label: 'Statements', items: [
      { key: 'pl', label: 'Profit & Loss' },
      { key: 'bs', label: 'Balance Sheet' },
      { key: 'tb', label: 'Trial Balance' },
    ] },
    { label: 'Detail Reports', items: [
      { key: 'journal', label: 'General Journal' },
      { key: 'ledger', label: 'General Ledger' },
      { key: 'party', label: 'Party Statement' },
      { key: 'token', label: 'Token Register' },
      { key: 'cashbank', label: 'Cash & Bank Movement' },
      { key: 'floor', label: 'Floor/Class Summary' },
      { key: 'projectcost', label: 'Project Cost Summary' },
      { key: 'trend', label: 'Month-wise Trend' },
    ] },
  ];

  function moduleFor(key) {
    return {
      jv: global.NfJournalVoucher,
      pl: global.NfPL, bs: global.NfBalanceSheet, tb: global.NfTrialBalance,
      journal: global.NfJournal, ledger: global.NfLedger, party: global.NfPartyStatement,
      token: global.NfTokenRegister, cashbank: global.NfCashBank, floor: global.NfFloorSummary,
      projectcost: global.NfProjectCost, trend: global.NfMonthlyTrend,
    }[key];
  }

  function html(activeKey) {
    var out = '<div class="rpmenu">' +
      '<button class="btn" id="nf-rpm-toggle" type="button" aria-haspopup="true" aria-expanded="false">Reports ' +
      '<svg class="rpmcaret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="rpmpanel" id="nf-rpm-panel" hidden>';
    GROUPS.forEach(function (g) {
      if (g.label) out += '<div class="rpmgrouplabel">' + g.label + '</div>';
      g.items.forEach(function (it) {
        out += '<button class="rpmitem' + (it.key === activeKey ? ' active' : '') + '" type="button" data-goto="' + it.key + '">' + it.label + '</button>';
      });
    });
    out += '</div></div>';
    return out;
  }

  function wire(root, ctx) {
    var toggle = root.querySelector('#nf-rpm-toggle');
    var panel = root.querySelector('#nf-rpm-panel');
    if (!toggle || !panel) return;

    function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    function open() { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });
    // Closes on any click outside the menu — a fresh listener per wire()
    // call (one per screen mount) is fine, the whole root is discarded on
    // navigation along with it, same lifecycle as every other handler
    // these screens already attach.
    document.addEventListener('click', function onDocClick(e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || e.target === toggle) return;
      close();
    });

    Array.prototype.forEach.call(panel.querySelectorAll('[data-goto]'), function (btn) {
      btn.addEventListener('click', function () {
        close();
        var key = btn.getAttribute('data-goto');
        if (key === 'closing') { ctx.onBack(); return; }
        var mod = moduleFor(key);
        if (mod) mod.mount(root, ctx);
      });
    });
  }

  global.NfReportsMenu = { html: html, wire: wire };
})(window);
