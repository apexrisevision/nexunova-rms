/**
 * NexuFinance v1 — Group & Related-party Balances.
 * window.NfGroupBalances.mount(root, ctx)
 *
 * One page for the directors: every group company (accounts under 22000)
 * and every director account (under 12600) — opening, money given, money
 * received, closing, and in plain words who owes whom
 * (nf_get_group_balances, migration 20261007b). Shown even at nil.
 * Click a line for that account's General Ledger, on the same dates.
 *
 * Sign: closing > 0 means they owe the company (a debit balance),
 * closing < 0 means the company owes them.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }

  function mount(root, ctx) {
    var gen = 0;
    var alive = true;
    var trueOnBack = ctx.onBack;
    ctx = Object.assign({}, ctx, { onBack: function () { alive = false; trueOnBack(); } });

    function load(range) {
      var myGen = ++gen;
      render(root, ctx, null, range, load);
      return ctx.api.getGroupBalances(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open group balances</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-grb-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button></div>';
        var back = root.querySelector('#nf-grb-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }
    load({ from: ctx.from || '', to: ctx.to || '' });
  }

  function shortName(name) { return String(name || '').split(' - ')[0]; }

  function owes(a, company) {
    var c = F.n(a.closing), who = shortName(a.name);
    if (c > 0) return esc(who) + ' owes ' + esc(company) + ' <b>Rs ' + F.fmt(c) + '</b>';
    if (c < 0) return esc(company) + ' owes ' + esc(who) + ' <b>Rs ' + F.fmt(-c) + '</b>';
    return '<span class="muted">Settled — nothing owed either way</span>';
  }

  function side(v) {
    var x = F.n(v);
    if (!x) return '0';
    return F.fmt(Math.abs(x)) + ' <small class="muted">' + (x > 0 ? 'Dr' : 'Cr') + '</small>';
  }

  function rows(list, company) {
    return (list || []).map(function (a) {
      return '<div class="grrow nf-drill" data-code="' + esc(a.code) + '" title="Open this account\'s ledger">' +
        '<span><b>' + esc(a.name) + '</b><br><small class="muted">' + esc(a.code) + '</small></span>' +
        '<span class="r">' + side(a.opening) + '</span>' +
        '<span class="r">' + F.fmt(a.given) + '</span>' +
        '<span class="r">' + F.fmt(a.received) + '</span>' +
        '<span class="r"><b>' + side(a.closing) + '</b></span>' +
        '<span class="wrap growes ' + (F.n(a.closing) < 0 ? 'we' : F.n(a.closing) > 0 ? 'they' : '') + '">' + owes(a, company) + '</span>' +
        '</div>';
    }).join('');
  }

  function body(r, company) {
    var all = r.accounts || [];
    var grp = all.filter(function (a) { return a.kind === 'group'; });
    var dir = all.filter(function (a) { return a.kind !== 'group'; });
    var payable = grp.reduce(function (s, a) { return s + Math.max(0, -F.n(a.closing)); }, 0);
    var due = dir.reduce(function (s, a) { return s + Math.max(0, F.n(a.closing)); }, 0);
    var head = '<div class="grrow tkhead"><span>Account</span><span class="r">Opening</span><span class="r">Given (Dr)</span>' +
      '<span class="r">Received (Cr)</span><span class="r">Closing</span><span>Who owes whom</span></div>';
    return '' +
      '<section class="rsec rtiles-wrap"><div class="rtiles">' +
      '<div class="rtile"><small>' + esc(company) + ' owes group companies</small><b>Rs ' + F.fmt(payable) + '</b></div>' +
      '<div class="rtile"><small>Directors owe ' + esc(company) + '</small><b>Rs ' + F.fmt(due) + '</b></div>' +
      '</div></section>' +
      '<section class="rsec"><div class="rsh"><h2>Group companies</h2><span class="muted">Given = paid by ' + esc(company) + ' to or for them · Received = paid by them to or for ' + esc(company) + '</span></div>' +
      '<div class="tktab">' + head + (rows(grp, company) || '<div class="grrow muted"><span style="grid-column:1/-1;text-align:center;padding:12px">No group company accounts</span></div>') + '</div></section>' +
      '<section class="rsec"><div class="rsh"><h2>Directors</h2><span class="muted">Click a line for its ledger</span></div>' +
      '<div class="tktab">' + head + (rows(dir, company) || '<div class="grrow muted"><span style="grid-column:1/-1;text-align:center;padding:12px">No director accounts</span></div>') + '</div></section>';
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var company = ctx.companyName || 'The company';
    root.innerHTML = '' +
      '<div class="sheet tkrsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Group &amp; Director Balances</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-grb-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button>' +
      global.NfReportsMenu.html('group') +
      '    <button class="btn primary" id="nf-grb-print" type="button">Save as PDF</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec tkrfilter">' +
      '  <label>From <input type="date" id="nf-grb-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-grb-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-grb-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-grb-clear" type="button">All time</button>' +
      '</section>' +
      '<div>' + (r ? body(r, company) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<section class="rsec rsig"><div><span>Prepared by</span><i></i></div><div><span>Checked by</span><i></i></div><div><span>Director</span><i></i></div></section>' +
      '<div class="docfoot"><span>' + esc(company) + ' · Group &amp; Director Balances</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-grb-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-grb-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    var here = { from: range.from, to: range.to };
    global.NfDrill.on(root, '[data-code]', 'click', function (el) {
      global.NfDrill.ledger(root, ctx, {
        accountCode: el.getAttribute('data-code'), from: range.from, to: range.to,
        backLabel: '← Back to Group Balances',
        onBack: function () { global.NfGroupBalances.mount(root, Object.assign({}, ctx, here)); },
      });
    });
    root.querySelector('#nf-grb-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-grb-from').value, to: root.querySelector('#nf-grb-to').value });
    });
    root.querySelector('#nf-grb-clear').addEventListener('click', function () { load({ from: '', to: '' }); });
  }

  global.NfGroupBalances = { mount: mount };
})(window);
