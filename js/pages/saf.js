/* ════════════════════════════════════════════════════════════════════════
   Sale Approval Form (SAF) — Awami Market, in the RMS.

   One line of hands, each seeing only their part:
     Accounts  prepares the form and submits it (submit = Accounts confirms
               the money; the NexuFinance lines are re-read at that moment)
     Director  (owner / admin login) sees it as the PDF, read-only, and
               approves — the digital signature — or rejects with a reason
     Filing    (Users & Roles → "Sale Approval — Filing") prints the approved
               PDF, marks the file done, and makes the sale entry from it

   Nothing here does arithmetic: the unit and money blocks are the server's,
   and the live preview is the server's own saf_save(..., p_commit = false).

   The PDF is built with pdf-lib from the stored form. An approved form gives
   the same bytes every time (no clock in it), is uploaded to rms-documents
   under the company's folder the moment the director signs, and every later
   open is checked against the sha256 recorded then.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var S2 = { list: null, me: null, tab: null, cur: null, draft: {}, timer: null, seq: 0, pdfUrl: null };

  (function () {
    var st = document.createElement('style');
    st.textContent =
      '.sf{padding:var(--fk-sp-6);max-width:1080px}' +
      '.sf-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}' +
      '.sf-h h2{font-size:20px;font-weight:600;margin:0;color:var(--fk-text)}' +
      '.sf-sub{font-size:13px;color:var(--fk-text-muted);margin:0 0 14px;line-height:1.55}' +
      '.sf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}' +
      '.sf-tab{height:32px;padding:0 13px;border-radius:999px;border:1px solid var(--fk-border);background:var(--fk-bg-card);' +
        'font:inherit;font-size:13px;color:var(--fk-text);cursor:pointer;display:inline-flex;align-items:center;gap:7px}' +
      '.sf-tab.on{background:var(--fk-primary);border-color:var(--fk-primary);color:#fff}' +
      '.sf-tab b{font-weight:600;opacity:.85}' +
      '.sf-row{display:grid;grid-template-columns:120px 1.2fr 1fr 130px 130px;gap:12px;align-items:center;padding:12px 15px;' +
        'border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);margin-bottom:8px;cursor:pointer}' +
      '.sf-row:hover{border-color:var(--fk-primary)}' +
      '.sf-no{font-weight:600;color:var(--fk-text)}.sf-m{font-size:12px;color:var(--fk-text-muted)}' +
      '.sf-num{text-align:right;font-variant-numeric:tabular-nums}' +
      '@media(max-width:720px){.sf-row{grid-template-columns:1fr 1fr}.sf-row .sf-hide{display:none}}' +
      '.sf-st{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}' +
      '.st-draft{background:var(--fk-bg-subtle);color:var(--fk-text-muted)}' +
      '.st-submitted,.st-verified{background:rgba(217,119,6,.14);color:#B45309}' +
      '.st-approved{background:rgba(22,163,74,.14);color:#15803D}' +
      '.st-filed{background:rgba(2,132,199,.14);color:#0369A1}' +
      '.st-rejected{background:rgba(220,38,38,.12);color:#B91C1C}' +
      '.st-superseded{background:rgba(100,116,139,.16);color:#475569;text-decoration:line-through}' +
      '.st-cancelled{background:var(--fk-bg-subtle);color:var(--fk-text-muted)}' +
      '.sf-card{border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);padding:15px 17px;margin-bottom:12px}' +
      '.sf-card h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted);margin:0 0 11px;font-weight:600}' +
      '.sf-ro{background:var(--fk-bg-subtle)}' +
      '.sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:11px 15px}' +
      '.sf-kv span{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted);margin-bottom:3px}' +
      '.sf-kv b{font-weight:500;font-variant-numeric:tabular-nums;color:var(--fk-text)}' +
      '.sf-f label{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted);margin-bottom:4px}' +
      '.sf-in,.sf-sel{width:100%;height:38px;padding:0 10px;border:1px solid var(--fk-border);border-radius:8px;background:var(--fk-bg-card);color:var(--fk-text);font:inherit;font-size:14px}' +
      '.sf-in:focus,.sf-sel:focus{outline:2px solid var(--fk-primary);outline-offset:-1px}' +
      '.sf-t{width:100%;border-collapse:collapse;font-size:13px}' +
      '.sf-t th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--fk-border)}' +
      '.sf-t td{padding:7px 8px;border-bottom:1px solid var(--fk-border);font-variant-numeric:tabular-nums;color:var(--fk-text)}' +
      '.sf-t .r{text-align:right}' +
      '.sf-flag{border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.07);color:#B91C1C;border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:14px}' +
      '.sf-prob{border:1px solid rgba(217,119,6,.35);background:rgba(217,119,6,.08);color:#92400E;border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:14px}' +
      '.sf-red{color:#DC2626 !important}' +
      '.sf-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}' +
      '.sf-plans{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}' +
      '.sf-plan{border:1px solid var(--fk-border);border-radius:10px;padding:10px 12px;cursor:pointer;background:var(--fk-bg-card)}' +
      '.sf-plan.on{border-color:var(--fk-primary);box-shadow:0 0 0 1px var(--fk-primary) inset}' +
      '.sf-plan b{display:block;font-weight:600;color:var(--fk-text)}.sf-plan small{color:var(--fk-text-muted)}' +
      '.sf-pick{max-height:380px;overflow:auto;border:1px solid var(--fk-border);border-radius:10px;background:var(--fk-bg-card)}' +
      '.sf-pick div{padding:10px 13px;border-bottom:1px solid var(--fk-border);cursor:pointer;display:flex;gap:12px;color:var(--fk-text)}' +
      '.sf-pick div:hover{background:var(--fk-bg-subtle)}' +
      '.sf-doc{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}' +
      '@media(max-width:980px){.sf-doc{grid-template-columns:1fr}}' +
      '.sf-pdf{width:100%;height:calc(100vh - 170px);min-height:620px;border:1px solid var(--fk-border);border-radius:12px;background:#fff}' +
      '.sf-side .sf-card{margin-bottom:10px}' +
      '.sf-side .btn{width:100%;justify-content:center;margin-bottom:8px}' +
      '.sf-steps{list-style:none;margin:0;padding:0}' +
      '.sf-steps li{display:flex;gap:10px;padding:7px 0;border-bottom:1px dashed var(--fk-border);font-size:13px;color:var(--fk-text)}' +
      '.sf-steps li:last-child{border-bottom:0}' +
      '.sf-steps i{font-style:normal;width:18px;height:18px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:11px;' +
        'background:var(--fk-bg-subtle);color:var(--fk-text-muted)}' +
      '.sf-steps li.done i{background:#16A34A;color:#fff}' +
      '.sf-steps small{display:block;color:var(--fk-text-muted)}';
    document.head.appendChild(st);
  })();

  // ── small things ────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pkr(n) { if (n == null || n === '') return '-'; return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function pct(n) { return (n == null ? 0 : Math.round(Number(n) * 100) / 100) + '%'; }
  function d8(s) { if (!s) return '-'; var x = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return isNaN(x) ? String(s) : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function dt(s) { if (!s) return '-'; var x = new Date(s);
    return isNaN(x) ? String(s) : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
      x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function say(m, k) { if (typeof toast === 'function') toast(m, k || 'ok'); }
  function host() { return $('pg-saf'); }
  function stLabel(f) { return f.status === 'approved' && f.filed_at ? 'filed' : f.status; }
  function st(f) { var s = typeof f === 'string' ? f : stLabel(f);
    var t = { submitted: 'With director', verified: 'With director', approved: 'Approved', filed: 'Filed' }[s] || s;
    return '<span class="sf-st st-' + esc(s) + '">' + esc(t) + '</span>'; }
  var PLAN = {
    standard: ['Standard', '30% DP + 36 monthly'],
    full_100: ['100% payment', 'Full price now, 10% off'],
    half_50:  ['50% payment', '50% DP, 5% off, rest monthly'],
    custom:   ['Custom', 'Schedule written by hand']
  };
  async function rpc(fn, args) {
    try {
      var r = await supabase.rpc(fn, args || {});
      if (r.error) return { success: false, error: 'network', message: r.error.message };
      return r.data || { success: false, error: 'empty' };
    } catch (e) { return { success: false, error: 'network', message: e.message }; }
  }
  function role() { var m = S2.me || {}; return m.prepare ? 'accounts' : m.approve ? 'director' : m.filing ? 'filing' : 'none'; }

  // ── the list ────────────────────────────────────────────────────────────
  var TABS = {
    accounts: [['draft', 'Drafts', function (x) { return x.status === 'draft'; }],
               ['rejected', 'Sent back', function (x) { return x.status === 'rejected'; }],
               ['submitted', 'With director', function (x) { return x.status === 'submitted' || x.status === 'verified'; }],
               ['approved', 'Approved', function (x) { return x.status === 'approved'; }],
               ['all', 'All', function () { return true; }]],
    director: [['submitted', 'Waiting for you', function (x) { return x.status === 'submitted' || x.status === 'verified'; }],
               ['approved', 'Approved', function (x) { return x.status === 'approved'; }],
               ['rejected', 'Rejected', function (x) { return x.status === 'rejected'; }],
               ['all', 'All', function () { return true; }]],
    filing:   [['tofile', 'To file', function (x) { return x.status === 'approved' && !x.filed_at; }],
               ['tosale', 'Filed, sale to make', function (x) { return x.status === 'approved' && x.filed_at && !x.sale_number; }],
               ['done', 'Done', function (x) { return !!x.sale_number; }],
               ['all', 'All', function () { return true; }]]
  };

  window.rSaf = async function () {
    var pg = host(); if (!pg) return;
    S2.cur = null; if (S2.pdfUrl) { URL.revokeObjectURL(S2.pdfUrl); S2.pdfUrl = null; }
    pg.innerHTML = '<div class="nx sf">' + NX.pageHeader('Sale Approval', '', { icon: 'file-check' }) +
      '<div id="sf-body">' + NX.card(NX.empty({ icon: 'loader', message: 'Loading Sale Approval Forms…' })) + '</div></div>';
    var r = await rpc('saf_list', {});
    if (!r.success) { $('sf-body').innerHTML = NX.card(NX.banner(r.message || 'Could not load the forms.', 'warn')); return; }
    S2.list = r; S2.me = r.me;
    var who = role();
    if (!r.enabled || who === 'none') { $('sf-body').innerHTML = NX.card(NX.banner('Sale Approval is not open for this login.', 'warn')); return; }
    var tabs = TABS[who];
    if (!S2.tab || !tabs.some(function (t) { return t[0] === S2.tab; })) S2.tab = tabs[0][0];
    var rows = r.rows || [];
    var tabHtml = tabs.map(function (t) {
      var n = rows.filter(t[2]).length;
      return '<button class="sf-tab' + (S2.tab === t[0] ? ' on' : '') + '" onclick="_safTab(\'' + t[0] + '\')">' + esc(t[1]) + ' <b>' + n + '</b></button>'; }).join('');
    var intro = {
      accounts: 'You prepare the form: the unit and the money fill themselves; you add the buyer, the plan and the agent, then submit. Submitting sends it straight to the director.',
      director: 'Forms Accounts has submitted. Open one to read it as the PDF, then approve it (your digital signature) or send it back with a reason.',
      filing: 'Forms the director has approved. Print the PDF for the file, mark it filed, then make the sale entry from it.'
    }[who];
    var sel = tabs.filter(function (t) { return t[0] === S2.tab; })[0];
    var list = rows.filter(sel[2]);
    var html = '<div class="sf-h"><span class="sf-m">' + esc(S2.me.name) + ' · ' +
      { accounts: 'Accounts', director: 'Director', filing: 'Filing' }[who] + '</span><span style="flex:1"></span>' +
      (who === 'accounts' ? NX.button('New Sale Approval Form', { variant: 'primary', icon: 'plus', onclick: '_safPick()' }) : '') + '</div>' +
      '<p class="sf-sub">' + esc(intro) + '</p><div class="sf-tabs">' + tabHtml + '</div>';
    if (!list.length) html += NX.card(NX.empty({ icon: 'file-check', message: 'Nothing here.' }));
    list.forEach(function (x) {
      html += '<div class="sf-row" onclick="_safOpen(\'' + x.id + '\')">' +
        '<div><div class="sf-no">' + esc(x.saf_no) + '</div>' + st(x.status === 'approved' && x.filed_at ? 'filed' : x.status) + '</div>' +
        '<div><b>' + esc(x.unit_code) + '</b> <span class="sf-m">' + esc(x.floor_label || '') + '</span>' +
          '<div class="sf-m">' + esc(x.buyer_name || 'buyer not named') + '</div></div>' +
        '<div class="sf-hide"><div>' + esc(x.agent_name || '-') + '</div><div class="sf-m">by ' + esc(x.prepared_by_name || '-') +
          (x.flags ? ' · <span class="sf-red">' + x.flags + ' to check</span>' : '') + '</div></div>' +
        '<div class="sf-num"><div>' + pkr(x.net_price) + '</div><div class="sf-m">net price</div></div>' +
        '<div class="sf-num"><div>' + pkr(x.total_received) + '</div><div class="sf-m">' + (x.sale_number ? esc(x.sale_number) : 'received') + '</div></div></div>';
    });
    $('sf-body').innerHTML = html;
    window._safRefreshBadge && window._safRefreshBadge(r);
  };
  window._safTab = function (t) { S2.tab = t; window.rSaf(); };

  // ── Accounts: a new form, from a unit ─────────────────────────────────────
  window._safPick = function () {
    $('sf-body').innerHTML = '<div class="sf-h">' + NX.button('‹ Back', { variant: 'ghost', size: 'sm', onclick: 'rSaf()' }) +
      '<h2>New Sale Approval Form</h2></div><p class="sf-sub">Pick the unit: units on hold or marked Sold, with no sale yet. ' +
      'Its price and the money received come from the system.</p>' +
      '<input class="sf-in" id="sf-q" placeholder="Unit number or buyer" style="margin-bottom:8px" oninput="_safPickFilter(this.value)">' +
      '<div class="sf-pick" id="sf-pick"></div>';
    window._safPickFilter('');
    setTimeout(function () { var q = $('sf-q'); if (q) q.focus(); }, 30);
  };
  window._safPickFilter = function (q) {
    q = String(q || '').trim().toLowerCase();
    var units = ((S2.list && S2.list.units) || []).filter(function (u) {
      return !q || (u.unit_code || '').toLowerCase().indexOf(q) >= 0 || (u.buyer || '').toLowerCase().indexOf(q) >= 0; });
    $('sf-pick').innerHTML = units.slice(0, 250).map(function (u) {
      return '<div onclick="_safStart(\'' + u.id + '\')"><b style="min-width:80px">' + esc(u.unit_code) + '</b>' +
        '<span class="sf-m" style="flex:1">' + esc(u.floor_label || '') + ' · ' + esc(u.status) + '</span><span>' + esc(u.buyer || '') + '</span></div>'; }).join('') ||
      '<div class="sf-m">No unit matches.</div>';
  };
  window._safStart = async function (unitId) {
    var r = await rpc('saf_new', { p_unit_id: unitId });
    if (!r.success) { say(r.message || r.error, 'err'); return; }
    if (r.existing) say('This unit already has a form in progress. Opening it.', 'warn');
    S2.cur = r.saf; S2.draft = {}; draw();
  };
  window._safOpen = async function (id) {
    var r = await rpc('saf_get', { p_id: id });
    if (!r.success) { say(r.message || r.error, 'err'); return; }
    S2.cur = r.saf; S2.me = r.me || S2.me; S2.draft = {}; draw();
  };

  // ── one form ────────────────────────────────────────────────────────────
  function kv(k, v, cls) { return '<div class="sf-kv"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + v + '</b></div>'; }
  function inp(key, label, val, type, extra) {
    return '<div class="sf-f"><label>' + esc(label) + '</label><input class="sf-in" data-k="' + key + '" type="' + (type || 'text') +
      '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + ' oninput="_safEdit(this)"></div>'; }
  function sel(key, label, val, opts) {
    return '<div class="sf-f"><label>' + esc(label) + '</label><select class="sf-sel" data-k="' + key + '" onchange="_safEdit(this)">' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val || '') === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></div>'; }

  function draw() {
    var f = S2.cur; if (!f || !host()) return;
    if (f.status === 'draft' && S2.me && S2.me.prepare) return drawEditor(f);
    return drawDocument(f);
  }

  function scheduleBlock(f) {
    var s = f.schedule_json || [];
    var inst = s.filter(function (x) { return x.installment_type === 'installment'; });
    return '<div class="sf-grid" style="margin-bottom:10px">' +
      kv('Down payment', pkr(f.dp_amount) + ' <span class="sf-m">(' + pct(f.dp_pct) + ')</span>') +
      kv('Installments', inst.length ? inst.length + ' × ' + pkr(f.installment_amount || (inst[0] && inst[0].amount_due)) : '-') +
      kv('First / last', inst.length ? d8(inst[0].due_date) + ' – ' + d8(inst[inst.length - 1].due_date) : '-') +
      kv('Schedule total', pkr(f.schedule_total), Math.abs((f.schedule_total || 0) - (f.net_price || 0)) > 1 ? 'sf-red' : '') + '</div>' +
      '<details><summary class="sf-m" style="cursor:pointer">Show all ' + s.length + ' lines</summary>' +
      '<table class="sf-t" style="margin-top:6px"><thead><tr><th>Payment</th><th>Due</th><th class="r">Amount</th></tr></thead><tbody>' +
      s.map(function (x) {
        var typ = x.installment_type === 'down_payment' ? 'Down payment' : x.installment_type === 'possession' ? 'Possession' : '#' + x.installment_number;
        return '<tr><td>' + typ + '</td><td>' + d8(x.due_date) + '</td><td class="r">' + pkr(x.amount_due) + '</td></tr>'; }).join('') +
      '</tbody></table></details>';
  }
  function customEditor(f) {
    var s = f.schedule_json || [];
    return '<div class="sf-m" style="margin:10px 0 4px">Write each payment. The total must equal the net price, ' + pkr(f.net_price) + '.</div>' +
      '<table class="sf-t"><thead><tr><th>Type</th><th>Due</th><th class="r">Amount</th><th></th></tr></thead><tbody>' +
      s.map(function (x, i) {
        return '<tr><td><select class="sf-sel" onchange="_safCustom(' + i + ',\'installment_type\',this.value)">' +
          [['down_payment', 'Down payment'], ['installment', 'Installment'], ['possession', 'Possession']].map(function (o) {
            return '<option value="' + o[0] + '"' + (x.installment_type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select></td><td><input class="sf-in" type="date" value="' + esc(String(x.due_date || '').slice(0, 10)) + '" onchange="_safCustom(' + i + ',\'due_date\',this.value)"></td>' +
          '<td class="r"><input class="sf-in" type="number" style="text-align:right;width:150px" value="' + esc(x.amount_due) + '" onchange="_safCustom(' + i + ',\'amount_due\',this.value)"></td>' +
          '<td>' + NX.button('Remove', { variant: 'ghost', size: 'sm', onclick: '_safCustom(' + i + ',\'_del\')' }) + '</td></tr>'; }).join('') +
      '</tbody></table><div style="margin-top:8px">' + NX.button('Add a payment', { variant: 'secondary', size: 'sm', onclick: '_safCustom(-1,\'_add\')' }) + '</div>';
  }
  function moneyBlock(f) {
    return '<div class="sf-card sf-ro"><h3>Money received · from NexuFinance</h3>' +
      (f.token_numbers ? '<div class="sf-m" style="margin-bottom:6px">Token ' + esc(f.token_numbers) + '</div>' : '') +
      '<table class="sf-t"><thead><tr><th>Date</th><th>Voucher</th><th>Mode</th><th>Party</th><th class="r">Amount</th></tr></thead><tbody>' +
      ((f.receipts || []).map(function (x) {
        return '<tr><td>' + d8(x.date) + '</td><td>' + esc(x.voucher_no || '') + '</td><td>' + esc(x.mode) + '</td><td>' + esc(x.party || '') +
          '</td><td class="r">' + pkr(x.amount) + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="sf-m">No money booked to this unit in NexuFinance.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="4"><b>Total received</b></td><td class="r"><b>' + pkr(f.total_received) + '</b></td></tr>' +
      '<tr><td colspan="4">Down payment ' + pkr(f.dp_amount) + ' less received</td><td class="r"><b>' + pkr(f.dp_balance) + '</b></td></tr></tfoot></table></div>';
  }

  // Accounts' editor
  function drawEditor(f) {
    var rel = [['S/O', 'S/O'], ['D/O', 'D/O'], ['W/O', 'W/O']];
    var html = '<div class="sf-h">' + NX.button('‹ All forms', { variant: 'ghost', size: 'sm', onclick: 'rSaf()' }) +
      '<h2>' + esc(f.saf_no) + '</h2>' + st(f) + (f.supersedes_no ? '<span class="sf-m">redoes ' + esc(f.supersedes_no) + '</span>' : '') + '</div>';
    if ((f.flags || []).length) html += '<div class="sf-flag"><b>The director will see these as differences from the standard plan</b><ul style="margin:4px 0 0 18px;padding:0">' +
      f.flags.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    if ((f.problems || []).length) html += '<div class="sf-prob"><b>Before it can be submitted</b><ul style="margin:4px 0 0 18px;padding:0">' +
      f.problems.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';

    html += '<div class="sf-card sf-ro"><h3>Unit · from the unit list</h3><div class="sf-grid">' +
      kv('Unit', esc(f.unit_code)) + kv('Floor', esc(f.floor_label || '-')) + (f.block ? kv('Block', esc(f.block)) : '') +
      kv('Area', esc(f.area_sqft) + ' sqft') + kv('Rate', pkr(f.rate_per_sqft) + ' / sqft') + kv('Price', pkr(f.base_price)) + '</div></div>';

    html += '<div class="sf-card"><h3>Deal</h3><div class="sf-plans">' + Object.keys(PLAN).map(function (k) {
        return '<div class="sf-plan' + (f.plan_type === k ? ' on' : '') + '" onclick="_safPlan(\'' + k + '\')"><b>' + PLAN[k][0] + '</b><small>' + PLAN[k][1] + '</small></div>'; }).join('') + '</div>' +
      '<div class="sf-grid" style="margin-top:12px">' + inp('sale_date', 'Sale date', String(f.sale_date || '').slice(0, 10), 'date') +
        (f.plan_type !== 'custom' && f.plan_type !== 'full_100' ? inp('first_due_date', 'First installment', String(f.first_due_date || '').slice(0, 10), 'date') : '') +
        (f.plan_type === 'half_50' ? inp('installment_count', 'Number of installments', f.installment_count, 'number', 'min="1" max="120"') : '') +
        (f.plan_type !== 'custom' && f.plan_type !== 'full_100' ? inp('balloon_amount', 'Possession amount (optional)', f.balloon_amount || '', 'number', 'min="0"') : '') +
        inp('discount_amount', 'Discount (PKR)', f.discount_amount, 'number', 'min="0"') + '</div>';
    if (Number(f.discount_amount) > 0) html += '<div class="sf-grid" style="margin-top:10px">' + inp('discount_reason', 'Discount reason', f.discount_reason || '') +
      (f.discount_beyond_standard ? sel('discount_approved_by', 'Discount allowed by (director)', f.discount_approved_by,
         [['', '— pick a director —']].concat(((S2.list && S2.list.directors) || []).map(function (d) { return [d.id, d.name]; }))) : '') + '</div>';
    if (f.plan_type === 'custom') html += customEditor(f);
    html += '<div class="sf-grid" style="margin-top:12px">' + kv('Plan', esc((PLAN[f.plan_type] || [f.plan_type])[0])) +
      kv('Discount', pkr(f.discount_amount) + ' <span class="sf-m">(' + pct(f.discount_pct) + ', plan ' + pct(f.standard_discount_pct) + ')</span>', f.discount_beyond_standard ? 'sf-red' : '') +
      kv('Net price', pkr(f.net_price)) + '</div><div style="margin-top:12px">' + scheduleBlock(f) + '</div></div>';

    var cb = f.co_buyer || {}, nm = f.nominee || {};
    html += '<div class="sf-card"><h3>Buyer</h3><div class="sf-grid">' + inp('buyer_name', 'Full name', f.buyer_name) +
      sel('buyer_relation', 'S/O, D/O or W/O', f.buyer_relation || 'S/O', rel) + inp('buyer_father', 'Father / husband', f.buyer_father) +
      inp('buyer_cnic', 'CNIC (13 digits)', f.buyer_cnic, 'text', 'inputmode="numeric" placeholder="17301-1234567-1"') +
      inp('buyer_phone', 'Phone', f.buyer_phone, 'tel') + inp('buyer_address', 'Address', f.buyer_address) + '</div>';
    if (f.reservation_buyer_name && String(f.buyer_name || '').trim().toLowerCase() !== String(f.reservation_buyer_name).trim().toLowerCase())
      html += '<div class="sf-grid" style="margin-top:10px">' + inp('buyer_name_reason', 'Why not "' + f.reservation_buyer_name + '" (the name on the hold)?', f.buyer_name_reason) + '</div>';
    html += '<details style="margin-top:10px"' + (cb.name || nm.name ? ' open' : '') + '><summary class="sf-m" style="cursor:pointer">Co-buyer and nominee (optional)</summary>' +
      '<div class="sf-grid" style="margin-top:8px">' + inp('co_buyer.name', 'Co-buyer name', cb.name) + inp('co_buyer.cnic', 'Co-buyer CNIC', cb.cnic) +
      inp('co_buyer.share', 'Co-buyer share %', cb.share, 'number') + '</div><div class="sf-grid" style="margin-top:8px">' +
      inp('nominee.name', 'Nominee name', nm.name) + inp('nominee.relation', 'Relation', nm.relation) + inp('nominee.cnic', 'Nominee CNIC', nm.cnic) +
      inp('nominee.phone', 'Nominee phone', nm.phone) + '</div></details></div>';

    html += moneyBlock(f);

    html += '<div class="sf-card"><h3>Sold by</h3><div class="sf-grid">' +
      sel('agent_id', 'Agent', f.agent_id, [['', '— pick the agent —']].concat(((S2.list && S2.list.agents) || []).map(function (a) { return [a.id, a.name]; }))) +
      inp('sub_agent_name', 'Sub-agent (optional)', f.sub_agent_name) +
      inp('commission_pct', 'Commission % (standard ' + pct(f.commission_standard_pct) + ')', f.commission_pct, 'number', 'step="0.01" min="0"') + '</div>' +
      (Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0) ? '<div class="sf-grid" style="margin-top:10px">' + inp('commission_reason', 'Why a different commission?', f.commission_reason) + '</div>' : '') +
      '<div class="sf-grid" style="margin-top:12px">' + kv('Commission', pct(f.commission_pct) + ' = ' + pkr(f.commission_amount)) + kv('Payable', esc(f.commission_payable_when)) + '</div></div>';

    html += '<div class="sf-acts">' + NX.button('Save draft', { variant: 'secondary', onclick: '_safSave()' }) +
      NX.button('Submit to director', { variant: 'primary', icon: 'send', onclick: '_safAct(\'submit\')' }) +
      NX.button('Discard draft', { variant: 'ghost', onclick: '_safAct(\'cancel\')' }) +
      '<span class="sf-m">Submitting confirms the money above matches NexuFinance, in your name.</span></div>';
    $('sf-body').innerHTML = html;
  }

  // the director's and Filing's view: the document itself
  async function drawDocument(f) {
    var me = S2.me || {};
    var html = '<div class="sf-h">' + NX.button('‹ All forms', { variant: 'ghost', size: 'sm', onclick: 'rSaf()' }) +
      '<h2>' + esc(f.saf_no) + '</h2>' + st(f) + '<span class="sf-m">' + esc(f.unit_code) + ' · ' + esc(f.buyer_name || '') + '</span></div>';
    if (f.status === 'rejected') html += '<div class="sf-flag"><b>Sent back</b> by ' + esc(f.rejected_by_name) + ', ' + dt(f.rejected_at) + ': ' + esc(f.reject_reason) + '</div>';
    html += '<div class="sf-doc"><div><iframe class="sf-pdf" id="sf-pdf" title="Sale Approval Form"></iframe></div><div class="sf-side">';

    var a = [];
    if (me.approve && (f.status === 'submitted' || f.status === 'verified')) {
      if ((f.flags || []).length) a.push('<div class="sf-flag" style="font-size:13px"><b>Differs from the standard plan</b><ul style="margin:4px 0 0 16px;padding:0">' +
        f.flags.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>');
      a.push(NX.button('Approve and sign', { variant: 'primary', icon: 'check', onclick: '_safAct(\'approve\')' }));
      a.push(NX.button('Send back to Accounts', { variant: 'danger-soft', onclick: '_safAct(\'reject\')' }));
      a.push('<div class="sf-m">Approving puts your name, the time and the form\'s fingerprint on the PDF. It cannot be edited after that.</div>');
    }
    if (me.filing && f.status === 'approved') {
      a.push(NX.button('Print / download PDF', { variant: f.filed_at ? 'secondary' : 'primary', icon: 'printer', onclick: '_safPrint()' }));
      if (!f.filed_at) a.push(NX.button('Mark as filed', { variant: 'secondary', icon: 'check', onclick: '_safAct(\'filed\')' }));
      if (f.filed_at && !f.sale_id) a.push(NX.button('Make the sale entry', { variant: 'primary', icon: 'file-text', onclick: '_safAct(\'sale\')' }));
      if (f.sale_id) a.push(NX.button('Open sale ' + (f.sale_number || ''), { variant: 'secondary', onclick: 'openSaleDetail(\'' + f.sale_id + '\')' }));
    }
    if (me.prepare && (f.status === 'rejected' || (f.status === 'approved' && !f.sale_id)))
      a.push(NX.button(f.status === 'rejected' ? 'Redo this form' : 'Change it (new form)', { variant: 'secondary', onclick: '_safAct(\'supersede\')' }));
    if (!me.filing && f.status === 'approved') a.push(NX.button('Download PDF', { variant: 'secondary', icon: 'printer', onclick: '_safPrint()' }));
    if (a.length) html += '<div class="sf-card">' + a.join('') + '</div>';

    var steps = [
      ['Prepared', f.prepared_by_name, f.prepared_at],
      ['Submitted · money confirmed', f.accounts_verified_by_name || f.submitted_by_name, f.accounts_verified_at || f.submitted_at],
      ['Approved · digitally signed', f.approved_by_name, f.approved_at],
      ['Printed and filed', f.filed_by_name, f.filed_at],
      ['Sale entry', f.sale_number, f.sale_id ? ' ' : null]
    ];
    html += '<div class="sf-card"><h3>Trail</h3><ul class="sf-steps">' + steps.map(function (s, i) {
      return '<li class="' + (s[2] ? 'done' : '') + '"><i>' + (s[2] ? '✓' : (i + 1)) + '</i><div>' + esc(s[0]) +
        '<small>' + (s[2] ? esc(s[1] || '') + (String(s[2]).trim() ? ' · ' + dt(s[2]) : '') : '—') + '</small></div></li>'; }).join('') + '</ul>' +
      (f.snapshot_hash ? '<div class="sf-m" style="margin-top:8px;word-break:break-all">Fingerprint ' + esc(f.snapshot_hash) + '</div>' : '') + '</div>';
    html += '</div></div>';
    $('sf-body').innerHTML = html;
    await showPdf(f);
  }

  // ── editing a draft: every change is worked out by the server ─────────────
  function setPath(o, k, v) {
    if (k.indexOf('.') < 0) { o[k] = v; return; }
    var p = k.split('.'); o[p[0]] = Object.assign({}, S2.cur[p[0]] || {}, o[p[0]] || {}); o[p[0]][p[1]] = v;
  }
  window._safEdit = function (el) {
    var k = el.getAttribute('data-k'), v = el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    setPath(S2.draft, k, v); setPath(S2.cur, k, v);
    clearTimeout(S2.timer);
    S2.timer = setTimeout(preview, /^(plan_type|discount_amount|installment_count|first_due_date|sale_date|balloon_amount|agent_id|commission_pct|discount_approved_by|buyer_name)$/.test(k) ? 350 : 900);
  };
  window._safPlan = function (k) { S2.draft.plan_type = k; if (k !== 'custom') delete S2.draft.schedule_json;
    if (k === 'custom' && !S2.draft.schedule_json) S2.draft.schedule_json = (S2.cur.schedule_json || []).slice();
    delete S2.draft.discount_amount; preview(); };
  window._safCustom = function (i, k, v) {
    var s = (S2.draft.schedule_json || S2.cur.schedule_json || []).map(function (x) { return Object.assign({}, x); });
    if (k === '_add') s.push({ installment_number: s.length, installment_type: 'installment', due_date: '', amount_due: 0 });
    else if (k === '_del') s.splice(i, 1);
    else s[i][k] = k === 'amount_due' ? Number(v || 0) : v;
    s.forEach(function (x, n) { x.installment_number = n; });
    S2.draft.schedule_json = s; preview();
  };
  async function preview() {
    if (!S2.cur || S2.cur.status !== 'draft') return;
    var my = ++S2.seq;
    var r = await rpc('saf_save', { p_id: S2.cur.id, p_input: S2.draft, p_commit: false });
    if (my !== S2.seq || !$('sf-body')) return;
    if (!r.success) { say(r.message || r.error, 'err'); return; }
    var keep = S2.cur.id;
    S2.cur = Object.assign({}, S2.cur, r.saf, { id: keep, status: 'draft' });
    var y = window.scrollY, foc = document.activeElement, key = foc && foc.getAttribute && foc.getAttribute('data-k'), pos = foc && foc.selectionStart;
    drawEditor(S2.cur); window.scrollTo(0, y);
    if (key) { var el = document.querySelector('[data-k="' + key + '"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
  }
  window._safSave = async function () {
    var r = await rpc('saf_save', { p_id: S2.cur.id, p_input: S2.draft, p_commit: true });
    if (!r.success) { say(r.message || r.error, 'err'); return false; }
    S2.cur = r.saf; S2.draft = {}; draw(); say('Saved'); return true;
  };

  window._safAct = async function (what) {
    var f = S2.cur, r;
    if (what === 'submit') {
      if (Object.keys(S2.draft).length && !(await window._safSave())) return;
      if (!confirm('Submit ' + f.saf_no + ' to the director? You confirm the money on it matches NexuFinance.')) return;
      r = await rpc('saf_submit', { p_id: f.id });
    } else if (what === 'cancel') {
      if (!confirm('Discard draft ' + f.saf_no + '?')) return;
      r = await rpc('saf_cancel', { p_id: f.id }); if (r.success) { say('Draft discarded'); window.rSaf(); return; }
    } else if (what === 'approve') {
      if (!confirm('Approve ' + f.saf_no + ' for ' + f.unit_code + '?\n\nThis is your digital signature. The form is locked after this; any change needs a new form.')) return;
      r = await rpc('saf_approve', { p_id: f.id });
      if (r.success) { S2.cur = r.saf; await keepPdf(r.saf); say('Approved and signed. Sent to Filing.'); draw(); refreshBadge(); return; }
    } else if (what === 'reject') {
      var why = prompt('Why is ' + f.saf_no + ' being sent back to Accounts?'); if (!why || !why.trim()) return;
      r = await rpc('saf_reject', { p_id: f.id, p_reason: why.trim() });
    } else if (what === 'supersede') {
      if (!confirm('Start a new form to replace ' + f.saf_no + '? The old one stays on record and is marked SUPERSEDED once the director approves the new one.')) return;
      r = await rpc('saf_supersede', { p_id: f.id });
    } else if (what === 'filed') {
      if (!confirm('Mark ' + f.saf_no + ' as printed and filed?')) return;
      r = await rpc('saf_mark_filed', { p_id: f.id });
    } else if (what === 'sale') {
      if (!confirm('Make the sale entry for ' + f.unit_code + ' from ' + f.saf_no + '? The buyer, price, plan and agent come from the approved form exactly.')) return;
      r = await rpc('saf_create_sale', { p_id: f.id });
      if (r.success) { say('Sale ' + r.sale_number + ' made from ' + r.saf_no); window._safOpen(f.id); refreshBadge(); return; }
    }
    if (r && r.saf) { S2.cur = r.saf; S2.draft = {}; draw(); }
    if (!r || !r.success) { say((r && (r.message || r.error)) || 'That did not work.', 'err'); return; }
    say({ submit: 'Submitted to the director', reject: 'Sent back to Accounts', supersede: 'New draft started', filed: 'Marked as filed' }[what] || 'Done');
    refreshBadge();
  };

  // ── the PDF ─────────────────────────────────────────────────────────────
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/pdf-lib.min.js?v=1.17.1';
      s.onload = res; s.onerror = function () { rej(new Error('The PDF library did not load.')); };
      document.head.appendChild(s);
    });
  }
  var FOLD = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', '…': '...', '×': 'x', '−': '-', '·': '-' };
  function safe(s) { s = String(s == null ? '' : s); var o = '';
    for (var i = 0; i < s.length; i++) { var c = s[i], k = s.charCodeAt(i);
      o += FOLD[c] ? FOLD[c] : ((k >= 32 && k <= 126) || (k >= 160 && k <= 255)) ? c : '?'; } return o; }
  // UTC, from stored values only: the same form gives the same text anywhere
  function pdate(s, withTime) { if (!s) return '-'; var x = new Date(String(s).length <= 10 ? s + 'T00:00:00Z' : s);
    if (isNaN(x)) return String(s); var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var p = function (n) { return ('0' + n).slice(-2); };
    // Pakistan time for the signature, fixed offset so it never depends on the viewer's clock
    if (withTime) { var k = new Date(x.getTime() + 5 * 3600 * 1000);
      return p(k.getUTCDate()) + ' ' + m[k.getUTCMonth()] + ' ' + k.getUTCFullYear() + ', ' + p(k.getUTCHours()) + ':' + p(k.getUTCMinutes()) + ' PKT'; }
    return p(x.getUTCDate()) + ' ' + m[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
  function pnum(n) { if (n == null || n === '') return '-'; var v = Math.round(Number(n)), neg = v < 0; v = String(Math.abs(v));
    return (neg ? '-' : '') + v.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  async function buildPdf(f) {
    await loadPdfLib();
    var L = window.PDFLib;
    var doc = await L.PDFDocument.create({ updateMetadata: false });
    var reg = await doc.embedFont(L.StandardFonts.Helvetica), bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var W = 595.28, H = 841.89, M = 38, page = doc.addPage([W, H]), y = H;
    var INK = L.rgb(0.07, 0.09, 0.15), MUTE = L.rgb(0.42, 0.45, 0.51), LINE = L.rgb(0.86, 0.88, 0.91),
        RED = L.rgb(0.80, 0.10, 0.10), BRAND = L.rgb(0.07, 0.30, 0.22), TINT = L.rgb(0.95, 0.97, 0.96),
        GREEN = L.rgb(0.09, 0.50, 0.24), AMBER = L.rgb(0.71, 0.33, 0.04), WHITE = L.rgb(1, 1, 1);
    function t(s, x, yy, sz, fnt, col) { page.drawText(safe(s), { x: x, y: yy, size: sz || 9, font: fnt || reg, color: col || INK }); }
    function tw(s, sz, fnt) { return (fnt || reg).widthOfTextAtSize(safe(s), sz || 9); }
    function tr(s, xr, yy, sz, fnt, col) { t(s, xr - tw(s, sz, fnt), yy, sz, fnt, col); }
    function line(yy) { page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.6, color: LINE }); }
    function head(s) { y -= 8; page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: TINT });
      page.drawRectangle({ x: M, y: y - 5, width: 3, height: 17, color: BRAND });
      t(s.toUpperCase(), M + 9, y, 8, bold, BRAND); y -= 18; }
    function pairs(list, cols) { cols = cols || 4; var cw = (W - 2 * M) / cols;
      for (var i = 0; i < list.length; i += cols) {
        for (var j = 0; j < cols && i + j < list.length; j++) { var p = list[i + j]; if (!p) continue;
          t(p[0], M + j * cw + 4, y, 7, reg, MUTE); t(p[1], M + j * cw + 4, y - 11, 10, p[2] ? bold : reg, p[2] || INK); }
        y -= 26; } }

    // banner
    page.drawRectangle({ x: 0, y: H - 74, width: W, height: 74, color: BRAND });
    t('AWAMI MARKET', M, H - 34, 17, bold, WHITE);
    t('Sale Approval Form', M, H - 52, 10, reg, L.rgb(0.80, 0.90, 0.85));
    tr(f.saf_no, W - M, H - 34, 17, bold, WHITE);
    tr('Prepared ' + pdate(f.prepared_at), W - M, H - 52, 9, reg, L.rgb(0.80, 0.90, 0.85));
    y = H - 92;

    // where the form stands, in one line
    var state, stateCol;
    if (f.status === 'superseded') { state = 'SUPERSEDED by ' + (f.superseded_by_no || 'a newer form') + ' - not valid'; stateCol = RED; }
    else if (f.status === 'approved') { state = 'APPROVED - digitally signed by ' + f.approved_by_name + ' on ' + pdate(f.approved_at, true); stateCol = GREEN; }
    else if (f.status === 'rejected') { state = 'SENT BACK by ' + f.rejected_by_name + ': ' + String(f.reject_reason || '').slice(0, 70); stateCol = RED; }
    else { state = 'AWAITING DIRECTOR APPROVAL - not valid until signed'; stateCol = AMBER; }
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, borderColor: stateCol, borderWidth: 1 });
    t(state, M + 8, y, 9, bold, stateCol); y -= 26;

    head('Unit');
    pairs([['Unit', f.unit_code, INK], ['Floor', f.floor_label || '-'], ['Area', f.area_sqft + ' sqft'], ['Rate / sqft', pnum(f.rate_per_sqft)]]);
    pairs([['List price', pnum(f.base_price), INK], f.block ? ['Block', f.block] : null, null, null]);

    head('Deal');
    var beyond = f.discount_beyond_standard;
    pairs([['Plan', (PLAN[f.plan_type] || [f.plan_type])[0]], ['Discount', pnum(f.discount_amount) + ' (' + (Math.round(f.discount_pct * 100) / 100) + '%)', beyond ? RED : null],
           ['Net price', pnum(f.net_price), INK], ['Sale date', pdate(f.sale_date)]]);
    if (Number(f.discount_amount) > 0)
      pairs([['Discount reason', f.discount_reason || '-', beyond ? RED : null], ['Plan discount', f.standard_discount_pct + '%'],
             ['Discount allowed by', f.discount_approved_by_name || (beyond ? '-' : 'Price poster'), beyond ? RED : null], null]);

    head('Buyer');
    pairs([['Name', f.buyer_name, INK], [f.buyer_relation || 'S/O', f.buyer_father], ['CNIC', f.buyer_cnic], ['Phone', f.buyer_phone]]);
    pairs([['Address', f.buyer_address || '-'],
           f.buyer_name_reason ? ['Not the name on the hold (' + (f.reservation_buyer_name || '') + ')', f.buyer_name_reason, RED] : null,
           f.co_buyer && f.co_buyer.name ? ['Co-buyer', f.co_buyer.name + ' ' + (f.co_buyer.cnic || '') + (f.co_buyer.share ? ' ' + f.co_buyer.share + '%' : '')] : null,
           f.nominee && f.nominee.name ? ['Nominee', f.nominee.name + ' (' + (f.nominee.relation || '') + ') ' + (f.nominee.cnic || '')] : null], 2);

    head('Money received' + (f.token_numbers ? ' - token ' + f.token_numbers : ''));
    var xs = [M + 4, M + 84, M + 170, M + 228];
    t('Date', xs[0], y, 7, reg, MUTE); t('Voucher', xs[1], y, 7, reg, MUTE); t('Mode', xs[2], y, 7, reg, MUTE); t('Party', xs[3], y, 7, reg, MUTE);
    tr('Amount', W - M - 4, y, 7, reg, MUTE); y -= 12;
    var rc = f.receipts || [];
    rc.slice(0, 10).forEach(function (x) {
      t(pdate(x.date), xs[0], y); t(x.voucher_no || '', xs[1], y); t(x.mode || '', xs[2], y); t(String(x.party || '').slice(0, 46), xs[3], y);
      tr(pnum(x.amount), W - M - 4, y); y -= 12; });
    if (rc.length > 10) { t('+ ' + (rc.length - 10) + ' more lines (the total includes them)', xs[0], y, 8, reg, MUTE); y -= 12; }
    if (!rc.length) { t('No money booked to this unit in NexuFinance.', xs[0], y, 8, reg, MUTE); y -= 12; }
    line(y + 5); y -= 6;
    t('Total received', xs[0], y, 9.5, bold); tr(pnum(f.total_received), W - M - 4, y, 9.5, bold); y -= 13;
    t('Balance of down payment (' + pnum(f.dp_amount) + ' less received)', xs[0], y, 9.5); tr(pnum(f.dp_balance), W - M - 4, y, 9.5, bold); y -= 14;

    head('Payment schedule');
    var s = f.schedule_json || [], inst = s.filter(function (x) { return x.installment_type === 'installment'; }),
        pos = s.filter(function (x) { return x.installment_type === 'possession'; });
    var amt = inst.length ? inst[0].amount_due : 0, lastAmt = inst.length ? inst[inst.length - 1].amount_due : 0;
    pairs([['Down payment (' + (Math.round(f.dp_pct * 100) / 100) + '%)', pnum(f.dp_amount), INK],
           ['Installments', inst.length ? inst.length + ' x ' + pnum(amt) + (lastAmt !== amt ? ' (last ' + pnum(lastAmt) + ')' : '') : 'None'],
           ['First / last due', inst.length ? pdate(inst[0].due_date) + ' - ' + pdate(inst[inst.length - 1].due_date) : '-'],
           ['Possession', pos.length ? pnum(pos[0].amount_due) + ' on ' + pdate(pos[0].due_date) : '-']]);
    if (f.plan_type === 'custom') { t('Custom schedule: ' + s.length + ' payments, total ' + pnum(f.net_price), M + 4, y + 8, 8, reg, RED); y -= 4; }

    head('Sold by');
    var cchg = Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0);
    pairs([['Agent', f.agent_name || '-', INK], ['Sub-agent', f.sub_agent_name || '-'],
           ['Commission', (f.commission_pct || 0) + '% = ' + pnum(f.commission_amount), cchg ? RED : null], ['Standard rate', (f.commission_standard_pct || 0) + '%']]);
    if (cchg) pairs([['Commission changed because', f.commission_reason || '-', RED]], 1);
    t('Payable: ' + f.commission_payable_when, M + 4, y + 8, 8, reg, MUTE); y -= 8;

    // the signatures: Accounts and the director are recorded; the agent signs the paper
    y -= 8; var bw = (W - 2 * M - 20) / 3, bh = 70;
    [['Agent', f.agent_name, null, false],
     ['Accounts (money confirmed)', f.accounts_verified_by_name || f.submitted_by_name, f.accounts_verified_at || f.submitted_at, true],
     ['Director (approved)', f.approved_by_name, f.approved_at, true]]
      .forEach(function (b, i) { var x = M + i * (bw + 10), signed = b[3] && b[2];
        page.drawRectangle({ x: x, y: y - bh, width: bw, height: bh, borderColor: signed ? GREEN : LINE, borderWidth: signed ? 1 : 0.8 });
        t(b[0].toUpperCase(), x + 8, y - 13, 7, bold, MUTE);
        if (signed) { t('DIGITALLY SIGNED', x + 8, y - 30, 8, bold, GREEN); }
        page.drawLine({ start: { x: x + 8, y: y - bh + 24 }, end: { x: x + bw - 8, y: y - bh + 24 }, thickness: 0.5, color: LINE });
        t(b[1] || '', x + 8, y - bh + 12, 8.5, signed ? bold : reg);
        t(b[2] ? pdate(b[2], true) : 'Date:', x + 8, y - bh + 3, 7, reg, MUTE); });
    y -= bh + 10;

    // footer
    page.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.6, color: LINE });
    t('Fingerprint (sha256): ' + (f.snapshot_hash || 'issued when the director approves'), M, 38, 7, reg, MUTE);
    t('This form is locked once approved. Any change needs a new Sale Approval Form that supersedes it.', M, 27, 7.5, bold, MUTE);
    tr(f.saf_no + ' - ' + f.unit_code, W - M, 16, 7, reg, MUTE);
    doc.setTitle(f.saf_no + ' - ' + f.unit_code, { showInWindowTitleBar: false });
    return doc.save({ useObjectStreams: false });
  }
  async function sha256(bytes) {
    var d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  // the approved PDF goes into the company's folder the moment it is signed
  async function keepPdf(f) {
    try {
      var bytes = await buildPdf(f), hex = await sha256(bytes);
      var path = S.cid + '/saf/' + f.saf_no + '-' + hex.slice(0, 12) + '.pdf';
      var up = await supabase.storage.from('rms-documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' });
      if (up.error && !/exists|duplicate/i.test(up.error.message || '')) { say('Approved. The PDF could not be stored yet; Filing will store it on first open.', 'warn'); path = null; }
      var r = await rpc('saf_record_pdf', { p_id: f.id, p_sha256: hex, p_path: path });
      if (r.success) { S2.cur.pdf_sha256 = S2.cur.pdf_sha256 || hex; S2.cur.pdf_path = S2.cur.pdf_path || path; }
      return { bytes: bytes, hex: hex };
    } catch (e) { say('Approved. The PDF will be stored when it is next opened.', 'warn'); return null; }
  }
  // the bytes to show: the stored file for an approved form (checked against
  // its fingerprint), otherwise built from the form as it is now
  async function pdfBytes(f) {
    if (f.status === 'approved' && f.pdf_path) {
      try {
        var dl = await supabase.storage.from('rms-documents').download(f.pdf_path);
        if (!dl.error && dl.data) {
          var b = new Uint8Array(await dl.data.arrayBuffer());
          if (!f.pdf_sha256 || (await sha256(b)) === f.pdf_sha256) return b;
          say('The stored PDF does not match its fingerprint. Showing the form rebuilt from the record.', 'warn');
        }
      } catch (e) {}
    }
    var bytes = await buildPdf(f);
    if (f.status === 'approved') {
      if (!f.pdf_sha256 || !f.pdf_path) { var k = await keepPdf(f); if (k) bytes = k.bytes; }
      else { var h = await sha256(bytes); if (h !== f.pdf_sha256) say('This print differs from the one recorded at approval. Tell the office.', 'warn'); }
    }
    return bytes;
  }
  async function showPdf(f) {
    var frame = $('sf-pdf'); if (!frame) return;
    try {
      var bytes = await pdfBytes(f);
      if (S2.pdfUrl) URL.revokeObjectURL(S2.pdfUrl);
      S2.pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if ($('sf-pdf')) $('sf-pdf').src = S2.pdfUrl + '#toolbar=1&view=FitH';
    } catch (e) { if (frame.parentNode) frame.outerHTML = NX.card(NX.banner('The PDF could not be made: ' + e.message, 'warn')); }
  }
  window._safPrint = async function () {
    var f = S2.cur; if (!f) return;
    if (!S2.pdfUrl) await showPdf(f);
    var a = document.createElement('a'); a.href = S2.pdfUrl; a.download = f.saf_no + '-' + f.unit_code + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    try { var w = window.open(S2.pdfUrl, '_blank'); if (w) setTimeout(function () { try { w.print(); } catch (e) {} }, 900); } catch (e) {}
  };
  window._safBuildPdf = buildPdf;   // for the verification script
  window._safCur = function () { return S2.cur; };

  function refreshBadge() { rpc('saf_list', { p_status: '__none__' }).then(function (r) { if (r.success && window._safRefreshBadge) window._safRefreshBadge(r); }); }
})();
