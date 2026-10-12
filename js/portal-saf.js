/* ══ Sale Approval Form (SAF) — Awami Market ══════════════════════════════════
   One numbered, signed form per deal, before any sale file is made.

     prepared   a director or Accounts            (Save draft / Submit)
     verified   Accounts: the money is NexuFinance's  (Verify)
     approved   Rashid only                      (Approve / Reject)
     sale       Rashid makes the sale from it    (Make the sale)

   Nothing on this screen does arithmetic. The unit block and the money block
   come from the server (units + NexuFinance), and the live preview is the
   server's own saf_save(..., p_commit = false), so what the screen shows is
   exactly what Submit will store.

   The PDF is built from the stored row with pdf-lib, metadata off and no
   timestamps, so an approved form re-prints to the identical file; its sha256
   is recorded the first time and every later print is compared to it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var S = { list: null, filter: { status: 'submitted', agent: '', floor: '' }, cur: null, me: null,
            draft: {}, timer: null, seq: 0 };

  (function () {
    var st = document.createElement('style');
    st.textContent =
      ".sf-wrap{padding:12px 12px 90px;max-width:980px}" +
      ".sf-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 2px 4px}" +
      ".sf-h h2{font-size:18px;font-weight:700;margin:0}" +
      ".sf-sub{font-size:var(--fs-caption);color:var(--fk-text-muted);margin:0 2px 12px;line-height:1.5}" +
      ".sf-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}" +
      ".sf-chip{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--fk-border);background:var(--fk-bg-card);" +
        "font:inherit;font-size:13px;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}" +
      ".sf-chip.on{background:var(--fk-primary);border-color:var(--fk-primary);color:#fff}" +
      ".sf-chip b{font-weight:600;opacity:.8}" +
      ".sf-filt{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}" +
      ".sf-filt select,.sf-in,.sf-sel,.sf-ta{height:38px;padding:0 10px;border:1px solid var(--fk-border);border-radius:8px;" +
        "background:var(--fk-bg-card);color:inherit;font:inherit;font-size:14px;min-width:0}" +
      ".sf-ta{height:auto;padding:8px 10px;width:100%;resize:vertical}" +
      ".sf-in:focus,.sf-sel:focus,.sf-ta:focus{outline:2px solid var(--fk-primary);outline-offset:-1px}" +
      ".sf-row{display:grid;grid-template-columns:110px 1fr 1fr 120px 120px;gap:10px;align-items:center;padding:11px 14px;" +
        "border:1px solid var(--fk-border);border-radius:10px;background:var(--fk-bg-card);margin-bottom:8px;cursor:pointer}" +
      ".sf-row:hover{border-color:var(--fk-primary)}" +
      ".sf-no{font-weight:700}.sf-m{font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".sf-num{text-align:right;font-variant-numeric:tabular-nums}" +
      "@media(max-width:640px){.sf-row{grid-template-columns:1fr 1fr}.sf-row .sf-hide{display:none}}" +
      ".sf-st{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;" +
        "font-weight:700;letter-spacing:.04em;text-transform:uppercase}" +
      ".st-draft{background:var(--fk-bg-subtle);color:var(--fk-text-muted)}" +
      ".st-submitted{background:rgba(217,119,6,.14);color:#B45309}" +
      ".st-verified{background:rgba(2,132,199,.14);color:#0369A1}" +
      ".st-approved{background:rgba(22,163,74,.14);color:#15803D}" +
      ".st-rejected{background:rgba(220,38,38,.12);color:#B91C1C}" +
      ".st-superseded{background:rgba(100,116,139,.16);color:#475569;text-decoration:line-through}" +
      ".st-cancelled{background:var(--fk-bg-subtle);color:var(--fk-text-muted)}" +
      ".sf-card{border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);padding:14px 16px;margin-bottom:12px}" +
      ".sf-card h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted);margin:0 0 10px;font-weight:700}" +
      ".sf-ro{background:var(--fk-bg-subtle)}" +
      ".sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px 14px}" +
      ".sf-kv span{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted);margin-bottom:3px}" +
      ".sf-kv b{font-weight:600;font-variant-numeric:tabular-nums}" +
      ".sf-f label{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted);margin-bottom:3px}" +
      ".sf-f .sf-in,.sf-f .sf-sel{width:100%}" +
      ".sf-t{width:100%;border-collapse:collapse;font-size:13px}" +
      ".sf-t th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--fk-border)}" +
      ".sf-t td{padding:6px 8px;border-bottom:1px solid var(--fk-border);font-variant-numeric:tabular-nums}" +
      ".sf-t td.r,.sf-t th.r{text-align:right}" +
      ".sf-flag{border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.07);color:#B91C1C;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:14px}" +
      ".sf-flag li{margin:2px 0}" +
      ".sf-prob{border:1px solid rgba(217,119,6,.35);background:rgba(217,119,6,.08);color:#92400E;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:14px}" +
      ".sf-red{color:#DC2626}" +
      ".sf-acts{display:flex;gap:8px;flex-wrap:wrap;position:sticky;bottom:0;padding:10px 0;background:var(--fk-bg-page,var(--fk-bg))}" +
      ".sf-plans{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}" +
      ".sf-plan{border:1px solid var(--fk-border);border-radius:10px;padding:10px 12px;cursor:pointer;background:var(--fk-bg-card)}" +
      ".sf-plan.on{border-color:var(--fk-primary);box-shadow:0 0 0 1px var(--fk-primary) inset}" +
      ".sf-plan b{display:block}.sf-plan small{color:var(--fk-text-muted)}" +
      ".sf-pick{max-height:340px;overflow:auto;border:1px solid var(--fk-border);border-radius:10px}" +
      ".sf-pick div{padding:9px 12px;border-bottom:1px solid var(--fk-border);cursor:pointer;display:flex;gap:10px}" +
      ".sf-pick div:hover{background:var(--fk-bg-subtle)}" +
      ".sf-sig{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}" +
      ".sf-sig>div{border:1px solid var(--fk-border);border-radius:10px;padding:10px 12px;min-height:64px}" +
      ".sf-sig span{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--fk-text-muted)}";
    document.head.appendChild(st);
  })();

  // ── small things ──────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pkr(n) { if (n == null || n === '') return '-'; return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function pct(n) { return (n == null ? 0 : Math.round(Number(n) * 100) / 100) + '%'; }
  function d8(s) { if (!s) return '-'; var x = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return isNaN(x) ? String(s) : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function dt(s) { if (!s) return '-'; var x = new Date(s);
    return isNaN(x) ? String(s) : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
      x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function say(m, k) { if (typeof toast === 'function') toast(m, k || 'ok'); }
  function st(s) { return '<span class="sf-st st-' + esc(s) + '">' + esc(s) + '</span>'; }
  function alive() { return typeof TAB === 'undefined' || TAB === 'saf'; }
  var PLAN = {
    standard: ['Standard', '30% DP + 36 monthly'],
    full_100: ['100% payment', 'Full price now, 10% off'],
    half_50:  ['50% payment', '50% DP, 5% off, rest monthly'],
    custom:   ['Custom', 'Schedule written by hand']
  };
  async function rpc(fn, args) {
    var r = await sb.rpc(fn, Object.assign({ p_session_token: TOKEN }, args || {}));
    if (r.error) return { success: false, error: 'network', message: r.error.message };
    return r.data || { success: false, error: 'empty' };
  }

  // ── the nav badge: what is waiting for this person ────────────────────────
  window.safBadge = async function () {
    var b = $('nav-badge-saf'); if (!b) return;
    var r = await rpc('saf_list', { p_status: '__none__' });
    if (!r.success) { b.textContent = ''; return; }
    var c = r.counts || {}, n = 0;
    if (r.me && r.me.rashid) n = c.verified || 0;
    else if (r.me && r.me.role === 'accounts') n = c.submitted || 0;
    b.textContent = n ? String(n) : '';
  };

  // ── the list ──────────────────────────────────────────────────────────────
  window.renderSaf = async function () {
    var host = $('app-body'); if (!host) return;
    S.cur = null;
    host.innerHTML = '<div class="sf-wrap"><div class="sf-m" style="padding:24px;text-align:center">Loading Sale Approval Forms…</div></div>';
    var f = S.filter;
    var r = await rpc('saf_list', { p_status: f.status || null, p_agent: f.agent || null, p_floor: f.floor || null });
    if (!alive()) return;
    if (!r.success) { host.innerHTML = '<div class="sf-wrap"><div class="sf-prob">' + esc(r.message || r.error) + '</div></div>'; return; }
    S.list = r; S.me = r.me;
    if (!r.enabled) {
      host.innerHTML = '<div class="sf-wrap"><div class="sf-h"><h2>Sale Approval</h2></div>' +
        '<div class="sf-sub">Sale Approval Forms are not switched on for this company.</div></div>'; return;
    }
    var c = r.counts || {};
    var chips = [['submitted', 'Submitted'], ['verified', 'Verified'], ['approved', 'Approved'], ['draft', 'Draft'],
                 ['rejected', 'Rejected'], ['superseded', 'Superseded'], ['', 'All']];
    var floors = {}; (r.units || []).forEach(function (u) { if (u.floor_label) floors[u.floor_label] = 1; });
    (r.rows || []).forEach(function (x) { if (x.floor_label) floors[x.floor_label] = 1; });
    var html = '<div class="sf-wrap">' +
      '<div class="sf-h"><h2>Sale Approval</h2><span style="flex:1"></span>' +
        '<button class="btn btn-primary" onclick="safPickUnit()">New SAF</button></div>' +
      '<div class="sf-sub">One signed form per deal: rate, price, buyer, money received, agent and commission. ' +
        'Accounts verifies the money, Rashid approves, then the sale is made from it. ' +
        (S.me.rashid ? 'Waiting for you: <b>' + (c.verified || 0) + '</b> verified.' :
         S.me.role === 'accounts' ? 'Waiting for you: <b>' + (c.submitted || 0) + '</b> submitted.' : '') + '</div>' +
      '<div class="sf-chips">' + chips.map(function (k) {
        var n = k[0] ? (c[k[0]] || 0) : Object.keys(c).reduce(function (a, s) { return a + c[s]; }, 0);
        return '<button class="sf-chip' + (f.status === k[0] ? ' on' : '') + '" onclick="safFilter(\'status\',\'' + k[0] + '\')">' +
          esc(k[1]) + ' <b>' + n + '</b></button>'; }).join('') + '</div>' +
      '<div class="sf-filt">' +
        '<select onchange="safFilter(\'agent\',this.value)"><option value="">All agents</option>' +
          (r.agents || []).map(function (a) { return '<option value="' + a.id + '"' + (f.agent === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') +
        '</select>' +
        '<select onchange="safFilter(\'floor\',this.value)"><option value="">All floors</option>' +
          Object.keys(floors).sort().map(function (x) { return '<option' + (f.floor === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
        '</select></div>';
    var rows = r.rows || [];
    if (!rows.length) html += '<div class="sf-m" style="padding:28px;text-align:center">No forms here.</div>';
    rows.forEach(function (x) {
      html += '<div class="sf-row" onclick="safOpen(\'' + x.id + '\')">' +
        '<div><div class="sf-no">' + esc(x.saf_no) + '</div>' + st(x.status) + '</div>' +
        '<div><b>' + esc(x.unit_code) + '</b> <span class="sf-m">' + esc(x.floor_label || '') + '</span>' +
          '<div class="sf-m">' + esc(x.buyer_name || 'buyer not named') + '</div></div>' +
        '<div class="sf-hide"><div>' + esc(x.agent_name || '-') + '</div><div class="sf-m">by ' + esc(x.prepared_by_name || '-') +
          (x.flags ? ' · <span class="sf-red">' + x.flags + ' to check</span>' : '') + '</div></div>' +
        '<div class="sf-num"><div>' + pkr(x.net_price) + '</div><div class="sf-m">net</div></div>' +
        '<div class="sf-num"><div>' + pkr(x.total_received) + '</div><div class="sf-m">' +
          (x.sale_number ? esc(x.sale_number) : 'received') + '</div></div></div>';
    });
    host.innerHTML = html + '</div>';
    window.safBadge();
  };
  window.safFilter = function (k, v) { S.filter[k] = v; window.renderSaf(); };

  // ── a new form: pick the unit ─────────────────────────────────────────────
  window.safPickUnit = function () {
    var units = (S.list && S.list.units) || [];
    var host = $('app-body');
    host.innerHTML = '<div class="sf-wrap"><div class="sf-h"><button class="btn btn-ghost btn-sm" onclick="renderSaf()">‹ Back</button>' +
      '<h2>New Sale Approval Form</h2></div>' +
      '<div class="sf-sub">Pick the unit. Units on hold or marked Sold, with no sale yet. The unit, its price and the money ' +
      'received come from the system; you fill in the buyer, the plan and the agent.</div>' +
      '<input class="sf-in" id="sf-q" placeholder="Unit number or buyer" style="width:100%;margin-bottom:8px" oninput="safPickFilter(this.value)">' +
      '<div class="sf-pick" id="sf-pick"></div></div>';
    window.safPickFilter('');
    setTimeout(function () { var q = $('sf-q'); if (q) q.focus(); }, 30);
  };
  window.safPickFilter = function (q) {
    q = String(q || '').trim().toLowerCase();
    var units = ((S.list && S.list.units) || []).filter(function (u) {
      return !q || (u.unit_code || '').toLowerCase().indexOf(q) >= 0 || (u.buyer || '').toLowerCase().indexOf(q) >= 0; });
    $('sf-pick').innerHTML = units.slice(0, 200).map(function (u) {
      return '<div onclick="safStart(\'' + u.id + '\')"><b style="min-width:70px">' + esc(u.unit_code) + '</b>' +
        '<span class="sf-m" style="flex:1">' + esc(u.floor_label || '') + ' · ' + esc(u.status) + '</span>' +
        '<span>' + esc(u.buyer || '') + '</span></div>'; }).join('') ||
      '<div class="sf-m">No unit matches.</div>';
  };
  window.safStart = async function (unitId) {
    var r = await rpc('saf_new', { p_unit_id: unitId });
    if (!r.success) { say(r.message || r.error, 'err'); return; }
    if (r.existing) say('This unit already has a form in progress. Opening it.', 'warn');
    S.cur = r.saf; S.draft = {}; draw();
  };
  window.safOpen = async function (id) {
    var r = await rpc('saf_get', { p_id: id });
    if (!r.success) { say(r.message || r.error, 'err'); return; }
    S.cur = r.saf; S.me = r.me || S.me; S.draft = {}; draw();
  };

  // ── one form ──────────────────────────────────────────────────────────────
  function kv(k, v, cls) { return '<div class="sf-kv"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + v + '</b></div>'; }
  function inp(key, label, val, type, extra) {
    return '<div class="sf-f"><label>' + esc(label) + '</label><input class="sf-in" data-k="' + key + '" type="' + (type || 'text') +
      '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + ' oninput="safEdit(this)"></div>';
  }
  function sel(key, label, val, opts) {
    return '<div class="sf-f"><label>' + esc(label) + '</label><select class="sf-sel" data-k="' + key + '" onchange="safEdit(this)">' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val || '') === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></div>';
  }

  function moneyBlock(f) {
    var rows = (f.receipts || []).map(function (x) {
      return '<tr><td>' + d8(x.date) + '</td><td>' + esc(x.voucher_no || '') + (x.system_no && x.system_no !== x.voucher_no ? ' <span class="sf-m">' + esc(x.system_no) + '</span>' : '') +
        '</td><td>' + esc(x.mode) + '</td><td>' + esc(x.party || '') + '</td><td class="r">' + pkr(x.amount) + '</td></tr>'; }).join('');
    return '<div class="sf-card sf-ro"><h3>Money received · from NexuFinance</h3>' +
      (f.token_numbers ? '<div class="sf-m" style="margin-bottom:6px">Token ' + esc(f.token_numbers) + '</div>' : '') +
      '<table class="sf-t"><thead><tr><th>Date</th><th>Voucher</th><th>Mode</th><th>Party</th><th class="r">Amount</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="sf-m">No money booked to this unit in NexuFinance.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="4"><b>Total received</b></td><td class="r"><b>' + pkr(f.total_received) + '</b></td></tr>' +
      '<tr><td colspan="4">Down payment ' + pkr(f.dp_amount) + ' − received</td><td class="r"><b>' + pkr(f.dp_balance) + '</b></td></tr></tfoot></table>' +
      '<div class="sf-m" style="margin-top:6px">As of ' + dt(f.money_as_of) + '</div></div>';
  }

  function scheduleBlock(f) {
    var s = f.schedule_json || [];
    var inst = s.filter(function (x) { return x.installment_type === 'installment'; });
    var head = '<div class="sf-grid" style="margin-bottom:10px">' +
      kv('Down payment', pkr(f.dp_amount) + ' <span class="sf-m">(' + pct(f.dp_pct) + ')</span>') +
      kv('Installments', inst.length ? inst.length + ' × ' + pkr(f.installment_amount || (inst[0] && inst[0].amount_due)) : '-') +
      kv('First / last', inst.length ? d8(inst[0].due_date) + ' – ' + d8(inst[inst.length - 1].due_date) : '-') +
      kv('Schedule total', pkr(f.schedule_total), Math.abs((f.schedule_total || 0) - (f.net_price || 0)) > 1 ? 'sf-red' : '') + '</div>';
    var rows = s.map(function (x, i) {
      var typ = x.installment_type === 'down_payment' ? 'Down payment' : x.installment_type === 'possession' ? 'Possession' : '#' + x.installment_number;
      return '<tr><td>' + typ + '</td><td>' + d8(x.due_date) + '</td><td class="r">' + pkr(x.amount_due) + '</td></tr>'; }).join('');
    return head + '<details><summary class="sf-m" style="cursor:pointer">Show all ' + s.length + ' lines</summary>' +
      '<table class="sf-t" style="margin-top:6px"><thead><tr><th>Payment</th><th>Due</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table></details>';
  }

  function customEditor(f) {
    var s = f.schedule_json || [];
    return '<div class="sf-m" style="margin:8px 0 4px">Write each payment. The total must equal the net price, ' + pkr(f.net_price) + '.</div>' +
      '<table class="sf-t"><thead><tr><th>Type</th><th>Due</th><th class="r">Amount</th><th></th></tr></thead><tbody>' +
      s.map(function (x, i) {
        return '<tr><td><select class="sf-sel" onchange="safCustom(' + i + ',\'installment_type\',this.value)">' +
          [['down_payment', 'Down payment'], ['installment', 'Installment'], ['possession', 'Possession']].map(function (o) {
            return '<option value="' + o[0] + '"' + (x.installment_type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select></td><td><input class="sf-in" type="date" value="' + esc(String(x.due_date || '').slice(0, 10)) + '" onchange="safCustom(' + i + ',\'due_date\',this.value)"></td>' +
          '<td class="r"><input class="sf-in" type="number" style="text-align:right;width:140px" value="' + esc(x.amount_due) + '" onchange="safCustom(' + i + ',\'amount_due\',this.value)"></td>' +
          '<td><button class="btn btn-ghost btn-sm" onclick="safCustom(' + i + ',\'_del\')">Remove</button></td></tr>'; }).join('') +
      '</tbody></table><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="safCustom(-1,\'_add\')">Add a payment</button>';
  }

  function draw() {
    var f = S.cur, me = S.me || {}, host = $('app-body'); if (!f || !host) return;
    var draft = f.status === 'draft';
    var html = '<div class="sf-wrap"><div class="sf-h"><button class="btn btn-ghost btn-sm" onclick="renderSaf()">‹ All forms</button>' +
      '<h2>' + esc(f.saf_no) + '</h2>' + st(f.status) +
      (f.supersedes_no ? '<span class="sf-m">replaces ' + esc(f.supersedes_no) + '</span>' : '') +
      (f.superseded_by_no ? '<span class="sf-m">replaced by ' + esc(f.superseded_by_no) + '</span>' : '') +
      (f.sale_number ? '<span class="sf-m">sale ' + esc(f.sale_number) + '</span>' : '') + '</div>';

    if (f.status === 'rejected') html += '<div class="sf-flag"><b>Rejected</b> by ' + esc(f.rejected_by_name) + ', ' + dt(f.rejected_at) + ': ' + esc(f.reject_reason) + '</div>';
    if ((f.flags || []).length) html += '<div class="sf-flag"><b>Differs from the standard plan</b><ul style="margin:4px 0 0 18px;padding:0">' +
      f.flags.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    if (draft && (f.problems || []).length) html += '<div class="sf-prob"><b>Before it can be submitted</b><ul style="margin:4px 0 0 18px;padding:0">' +
      f.problems.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';

    // unit — never typed
    html += '<div class="sf-card sf-ro"><h3>Unit · from the unit list</h3><div class="sf-grid">' +
      kv('Unit', esc(f.unit_code)) + kv('Floor', esc(f.floor_label || '-')) + (f.block ? kv('Block', esc(f.block)) : '') +
      kv('Area', esc(f.area_sqft) + ' sqft') + kv('Rate', pkr(f.rate_per_sqft) + ' / sqft') + kv('Price', pkr(f.base_price)) + '</div></div>';

    // deal
    html += '<div class="sf-card"><h3>Deal</h3>';
    if (draft) {
      html += '<div class="sf-plans">' + Object.keys(PLAN).map(function (k) {
        return '<div class="sf-plan' + (f.plan_type === k ? ' on' : '') + '" onclick="safPlan(\'' + k + '\')"><b>' + PLAN[k][0] + '</b><small>' + PLAN[k][1] + '</small></div>'; }).join('') + '</div>' +
        '<div class="sf-grid" style="margin-top:12px">' +
          inp('sale_date', 'Sale date', String(f.sale_date || '').slice(0, 10), 'date') +
          (f.plan_type !== 'custom' && f.plan_type !== 'full_100' ? inp('first_due_date', 'First installment', String(f.first_due_date || '').slice(0, 10), 'date') : '') +
          (f.plan_type === 'half_50' ? inp('installment_count', 'Number of installments', f.installment_count, 'number', 'min="1" max="120"') : '') +
          (f.plan_type !== 'custom' && f.plan_type !== 'full_100' ? inp('balloon_amount', 'Possession amount (optional)', f.balloon_amount || '', 'number', 'min="0"') : '') +
          inp('discount_amount', 'Discount (PKR)', f.discount_amount, 'number', 'min="0"') + '</div>';
      if (Number(f.discount_amount) > 0) {
        html += '<div class="sf-grid" style="margin-top:10px">' +
          inp('discount_reason', 'Discount reason', f.discount_reason || '') +
          (f.discount_beyond_standard ? sel('discount_approved_by', 'Discount approved by (director)', f.discount_approved_by,
             [['', '— pick a director —']].concat(((S.list && S.list.directors) || []).map(function (d) { return [d.id, d.name]; }))) : '') + '</div>';
      }
      if (f.plan_type === 'custom') html += customEditor(f);
    }
    html += '<div class="sf-grid" style="margin-top:12px">' +
      kv('Plan', esc((PLAN[f.plan_type] || [f.plan_type])[0])) +
      kv('Discount', pkr(f.discount_amount) + ' <span class="sf-m">(' + pct(f.discount_pct) + ', plan ' + pct(f.standard_discount_pct) + ')</span>', f.discount_beyond_standard ? 'sf-red' : '') +
      (Number(f.discount_amount) > 0 && !draft ? kv('Discount reason', esc(f.discount_reason || '-')) + kv('Approved by', esc(f.discount_approved_by_name || '-'), f.discount_beyond_standard ? 'sf-red' : '') : '') +
      kv('Net price', pkr(f.net_price)) + '</div><div style="margin-top:12px">' + scheduleBlock(f) + '</div></div>';

    // buyer
    var rel = [['S/O', 'S/O'], ['D/O', 'D/O'], ['W/O', 'W/O']];
    html += '<div class="sf-card"><h3>Buyer</h3>';
    if (draft) {
      html += '<div class="sf-grid">' + inp('buyer_name', 'Full name', f.buyer_name) +
        sel('buyer_relation', 'S/O, D/O or W/O', f.buyer_relation || 'S/O', rel) + inp('buyer_father', 'Father / husband', f.buyer_father) +
        inp('buyer_cnic', 'CNIC (13 digits)', f.buyer_cnic, 'text', 'inputmode="numeric" placeholder="17301-1234567-1"') +
        inp('buyer_phone', 'Phone', f.buyer_phone, 'tel') + inp('buyer_address', 'Address', f.buyer_address) + '</div>';
      if (f.reservation_buyer_name && String(f.buyer_name || '').trim().toLowerCase() !== String(f.reservation_buyer_name).trim().toLowerCase())
        html += '<div class="sf-grid" style="margin-top:10px">' + inp('buyer_name_reason', 'Why not "' + f.reservation_buyer_name + '" (the name on the hold)?', f.buyer_name_reason) + '</div>';
      var cb = f.co_buyer || {}, nm = f.nominee || {};
      html += '<details style="margin-top:10px"' + (cb.name || nm.name ? ' open' : '') + '><summary class="sf-m" style="cursor:pointer">Co-buyer and nominee (optional)</summary>' +
        '<div class="sf-grid" style="margin-top:8px">' + inp('co_buyer.name', 'Co-buyer name', cb.name) + inp('co_buyer.cnic', 'Co-buyer CNIC', cb.cnic) +
        inp('co_buyer.share', 'Co-buyer share %', cb.share, 'number') + '</div><div class="sf-grid" style="margin-top:8px">' +
        inp('nominee.name', 'Nominee name', nm.name) + inp('nominee.relation', 'Relation', nm.relation) + inp('nominee.cnic', 'Nominee CNIC', nm.cnic) +
        inp('nominee.phone', 'Nominee phone', nm.phone) + '</div></details>';
    } else {
      html += '<div class="sf-grid">' + kv('Name', esc(f.buyer_name)) + kv(f.buyer_relation || 'S/O', esc(f.buyer_father)) + kv('CNIC', esc(f.buyer_cnic)) +
        kv('Phone', esc(f.buyer_phone)) + kv('Address', esc(f.buyer_address || '-')) +
        (f.buyer_name_reason ? kv('Not the name on the hold, because', esc(f.buyer_name_reason), 'sf-red') : '') +
        (f.co_buyer && f.co_buyer.name ? kv('Co-buyer', esc(f.co_buyer.name) + ' · ' + esc(f.co_buyer.cnic || '') + ' · ' + esc(f.co_buyer.share || '') + '%') : '') +
        (f.nominee && f.nominee.name ? kv('Nominee', esc(f.nominee.name) + ' (' + esc(f.nominee.relation || '') + ') ' + esc(f.nominee.cnic || '')) : '') + '</div>';
    }
    html += '</div>';

    html += moneyBlock(f);

    // sold by
    html += '<div class="sf-card"><h3>Sold by</h3>';
    if (draft) {
      html += '<div class="sf-grid">' + sel('agent_id', 'Agent', f.agent_id, [['', '— pick the agent —']].concat(((S.list && S.list.agents) || []).map(function (a) { return [a.id, a.name]; }))) +
        inp('sub_agent_name', 'Sub-agent (optional)', f.sub_agent_name) +
        inp('commission_pct', 'Commission % (standard ' + pct(f.commission_standard_pct) + ')', f.commission_pct, 'number', 'step="0.01" min="0"') + '</div>';
      if (Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0))
        html += '<div class="sf-grid" style="margin-top:10px">' + inp('commission_reason', 'Why a different commission?', f.commission_reason) + '</div>';
    }
    html += '<div class="sf-grid" style="margin-top:' + (draft ? 12 : 0) + 'px">' + kv('Agent', esc(f.agent_name || '-')) +
      (f.sub_agent_name ? kv('Sub-agent', esc(f.sub_agent_name)) : '') +
      kv('Commission', pct(f.commission_pct) + ' = ' + pkr(f.commission_amount), Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0) ? 'sf-red' : '') +
      (f.commission_reason ? kv('Commission changed because', esc(f.commission_reason), 'sf-red') : '') +
      kv('Payable', esc(f.commission_payable_when)) + '</div></div>';

    // signatures
    html += '<div class="sf-card"><h3>Signed</h3><div class="sf-sig">' +
      '<div><span>Prepared</span>' + esc(f.prepared_by_name || '-') + '<div class="sf-m">' + dt(f.prepared_at) + '</div></div>' +
      '<div><span>Accounts verified</span>' + esc(f.accounts_verified_by_name || '-') + '<div class="sf-m">' + dt(f.accounts_verified_at) + '</div></div>' +
      '<div><span>Director approved</span>' + esc(f.approved_by_name || '-') + '<div class="sf-m">' + dt(f.approved_at) + '</div></div></div>' +
      (f.snapshot_hash ? '<div class="sf-m" style="margin-top:8px;word-break:break-all">Fingerprint ' + esc(f.snapshot_hash) + '</div>' : '') + '</div>';

    // what this person can do now
    var a = [];
    if (draft) {
      a.push('<button class="btn btn-secondary" onclick="safSaveNow()">Save draft</button>');
      a.push('<button class="btn btn-primary" onclick="safAct(\'submit\')">Submit</button>');
      a.push('<button class="btn btn-ghost" onclick="safAct(\'cancel\')">Discard draft</button>');
    }
    if (f.status === 'submitted' && me.role === 'accounts') a.push('<button class="btn btn-primary" onclick="safAct(\'verify\')">Verify the money</button>');
    if (f.status === 'verified' && me.rashid) a.push('<button class="btn btn-primary" onclick="safAct(\'approve\')">Approve</button>');
    if ((f.status === 'submitted' && (me.role === 'accounts' || me.rashid)) || (f.status === 'verified' && me.rashid))
      a.push('<button class="btn btn-danger-soft" onclick="safAct(\'reject\')">Reject</button>');
    if (f.status === 'approved' && !f.sale_id && me.rashid) a.push('<button class="btn btn-primary" onclick="safAct(\'sale\')">Make the sale</button>');
    if ((f.status === 'approved' || f.status === 'rejected') && !f.sale_id) a.push('<button class="btn btn-secondary" onclick="safAct(\'supersede\')">Change (new SAF)</button>');
    if (f.status === 'approved' || f.status === 'superseded') a.push('<button class="btn btn-secondary" onclick="safPdf()">PDF</button>');
    html += '<div class="sf-acts">' + a.join('') + '</div></div>';

    host.innerHTML = html;
  }

  // ── editing a draft: every change goes to the server for the numbers ──────
  function setPath(o, k, v) {
    if (k.indexOf('.') < 0) { o[k] = v; return; }
    var p = k.split('.'); o[p[0]] = Object.assign({}, S.cur[p[0]] || {}, o[p[0]] || {}); o[p[0]][p[1]] = v;
  }
  window.safEdit = function (el) {
    var k = el.getAttribute('data-k'), v = el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    setPath(S.draft, k, v); setPath(S.cur, k, v);
    clearTimeout(S.timer);
    var re = /^(plan_type|discount_amount|installment_count|first_due_date|sale_date|balloon_amount|agent_id|commission_pct|discount_approved_by|buyer_name)$/.test(k);
    S.timer = setTimeout(function () { preview(re); }, re ? 350 : 900);
  };
  window.safPlan = function (k) { S.draft.plan_type = k; if (k !== 'custom') delete S.draft.schedule_json;
    if (k === 'custom' && !(S.draft.schedule_json)) S.draft.schedule_json = (S.cur.schedule_json || []).slice();
    delete S.draft.discount_amount; preview(true); };
  window.safCustom = function (i, k, v) {
    var s = (S.draft.schedule_json || S.cur.schedule_json || []).map(function (x) { return Object.assign({}, x); });
    if (k === '_add') s.push({ installment_number: s.length, installment_type: 'installment', due_date: '', amount_due: 0 });
    else if (k === '_del') s.splice(i, 1);
    else s[i][k] = k === 'amount_due' ? Number(v || 0) : v;
    s.forEach(function (x, n) { x.installment_number = n; });
    S.draft.schedule_json = s; preview(true);
  };
  async function preview(redraw) {
    if (!S.cur || S.cur.status !== 'draft') return;
    var my = ++S.seq;
    var r = await rpc('saf_save', { p_id: S.cur.id, p_input: S.draft, p_commit: false });
    if (my !== S.seq || !alive()) return;
    if (!r.success) { say(r.message || r.error, 'err'); return; }
    var keep = S.cur.id;
    S.cur = Object.assign({}, S.cur, r.saf, { id: keep, status: 'draft' });
    if (redraw) { var y = window.scrollY; draw(); window.scrollTo(0, y); }
    else {   // keep the cursor where it is: only the numbers and warnings move
      var y2 = window.scrollY, foc = document.activeElement, key = foc && foc.getAttribute && foc.getAttribute('data-k'),
          pos = foc && foc.selectionStart;
      draw(); window.scrollTo(0, y2);
      if (key) { var el = document.querySelector('[data-k="' + key + '"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
    }
  }
  window.safSaveNow = async function () {
    var r = await rpc('saf_save', { p_id: S.cur.id, p_input: S.draft, p_commit: true });
    if (!r.success) { say(r.message || r.error, 'err'); return false; }
    S.cur = r.saf; S.draft = {}; draw(); say('Saved'); return true;
  };
  window.safAct = async function (what) {
    var f = S.cur, r;
    if (what === 'submit') {
      if (Object.keys(S.draft).length && !(await window.safSaveNow())) return;
      r = await rpc('saf_submit', { p_id: f.id });
    } else if (what === 'verify') r = await rpc('saf_verify', { p_id: f.id });
    else if (what === 'approve') {
      if (!confirm('Approve ' + f.saf_no + '? Once approved it cannot be edited; any change needs a new SAF.')) return;
      r = await rpc('saf_approve', { p_id: f.id });
    } else if (what === 'reject') {
      var why = prompt('Why is ' + f.saf_no + ' rejected?'); if (!why || !why.trim()) return;
      r = await rpc('saf_reject', { p_id: f.id, p_reason: why.trim() });
    } else if (what === 'cancel') {
      if (!confirm('Discard draft ' + f.saf_no + '?')) return;
      r = await rpc('saf_cancel', { p_id: f.id }); if (r.success) { say('Draft discarded'); window.renderSaf(); return; }
    } else if (what === 'supersede') {
      if (!confirm('Start a new SAF that will replace ' + f.saf_no + '? The old one stays on record and is marked SUPERSEDED when the new one is approved.')) return;
      r = await rpc('saf_supersede', { p_id: f.id });
    } else if (what === 'sale') {
      if (!confirm('Make the sale for ' + f.unit_code + ' from ' + f.saf_no + '? The buyer, price, plan and agent come from the form exactly.')) return;
      r = await rpc('saf_create_sale', { p_id: f.id });
      if (r.success) { say('Sale ' + r.sale_number + ' made from ' + r.saf_no); window.safOpen(f.id); return; }
    }
    if (r && r.saf) { S.cur = r.saf; S.draft = {}; draw(); }
    if (!r || !r.success) { say((r && (r.message || r.error)) || 'That did not work.', 'err'); return; }
    say({ submit: 'Submitted for Accounts', verify: 'Verified', approve: 'Approved', reject: 'Rejected', supersede: 'New draft started' }[what] || 'Done');
    window.safBadge();
  };

  // ── the PDF ───────────────────────────────────────────────────────────────
  var FOLD = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', '…': '...', '×': 'x', '−': '-' };
  function safe(s) { s = String(s == null ? '' : s); var o = '';
    for (var i = 0; i < s.length; i++) { var c = s[i], k = s.charCodeAt(i);
      o += FOLD[c] ? FOLD[c] : ((k >= 32 && k <= 126) || (k >= 160 && k <= 255)) ? c : '?'; } return o; }
  // dates on the PDF are written from the stored values, in UTC, so the same
  // form gives the same text on any phone in any timezone
  function pdate(s) { if (!s) return '-'; var x = new Date(String(s).length <= 10 ? s + 'T00:00:00Z' : s);
    if (isNaN(x)) return String(s); var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return ('0' + x.getUTCDate()).slice(-2) + ' ' + m[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
  function pnum(n) { if (n == null || n === '') return '-'; var v = Math.round(Number(n)), neg = v < 0; v = String(Math.abs(v));
    return (neg ? '-' : '') + v.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  async function buildPdf(f) {
    var L = window.PDFLib; if (!L) throw new Error('The PDF library did not load.');
    var doc = await L.PDFDocument.create({ updateMetadata: false });
    var reg = await doc.embedFont(L.StandardFonts.Helvetica), bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var W = 595.28, H = 841.89, M = 36, page = doc.addPage([W, H]), y = H - M;
    var INK = L.rgb(0.07, 0.09, 0.15), MUTE = L.rgb(0.42, 0.45, 0.51), LINE = L.rgb(0.82, 0.85, 0.88),
        RED = L.rgb(0.80, 0.10, 0.10), TINT = L.rgb(0.95, 0.96, 0.98);
    function t(s, x, yy, sz, fnt, col) { page.drawText(safe(s), { x: x, y: yy, size: sz || 9, font: fnt || reg, color: col || INK }); }
    function tr(s, xr, yy, sz, fnt, col) { s = safe(s); var w = (fnt || reg).widthOfTextAtSize(s, sz || 9); t(s, xr - w, yy, sz, fnt, col); }
    function rule(yy) { page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.6, color: LINE }); }
    function head(s) { y -= 6; page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: TINT });
      t(s.toUpperCase(), M + 6, y, 8, bold, MUTE); y -= 16; }
    // a row of label/value pairs across the page
    function pairs(list, cols) { cols = cols || 4; var cw = (W - 2 * M) / cols;
      for (var i = 0; i < list.length; i += cols) {
        for (var j = 0; j < cols && i + j < list.length; j++) { var p = list[i + j]; if (!p) continue;
          t(p[0], M + j * cw + 2, y, 7, reg, MUTE); t(p[1], M + j * cw + 2, y - 10, 9.5, p[2] ? bold : reg, p[2] || INK); }
        y -= 24; } }

    // header
    t('AWAMI MARKET', M, y - 6, 16, bold); t('Sale Approval Form', M, y - 22, 10, reg, MUTE);
    tr(f.saf_no, W - M, y - 6, 16, bold);
    tr((f.status === 'superseded' ? 'SUPERSEDED by ' + (f.superseded_by_no || '') + ' - ' : '') + 'Approved ' + pdate(f.approved_at), W - M, y - 22, 9, reg,
       f.status === 'superseded' ? RED : MUTE);
    y -= 34; rule(y); y -= 10;

    head('Unit');
    pairs([['Unit', f.unit_code, INK], ['Floor', f.floor_label || '-'], ['Area', f.area_sqft + ' sqft'], ['Rate / sqft', pnum(f.rate_per_sqft)],
           ['Price', pnum(f.base_price), INK], f.block ? ['Block', f.block] : null]);

    head('Deal');
    var plan = (PLAN[f.plan_type] || [f.plan_type])[0];
    var beyond = f.discount_beyond_standard;
    pairs([['Plan', plan], ['Discount', pnum(f.discount_amount) + ' (' + (Math.round(f.discount_pct * 100) / 100) + '%)', beyond ? RED : null],
           ['Net price', pnum(f.net_price), INK], ['Sale date', pdate(f.sale_date)]]);
    if (Number(f.discount_amount) > 0)
      pairs([['Discount reason', f.discount_reason || '-', beyond ? RED : null], ['Plan discount', f.standard_discount_pct + '%'],
             ['Discount approved by', f.discount_approved_by_name || (beyond ? '-' : 'Price poster'), beyond ? RED : null], null]);

    head('Buyer');
    pairs([['Name', f.buyer_name, INK], [f.buyer_relation || 'S/O', f.buyer_father], ['CNIC', f.buyer_cnic], ['Phone', f.buyer_phone]]);
    pairs([['Address', f.buyer_address || '-'],
           f.buyer_name_reason ? ['Not the name on the hold (' + (f.reservation_buyer_name || '') + ')', f.buyer_name_reason, RED] : null,
           f.co_buyer && f.co_buyer.name ? ['Co-buyer', f.co_buyer.name + ' ' + (f.co_buyer.cnic || '') + ' ' + (f.co_buyer.share ? f.co_buyer.share + '%' : '')] : null,
           f.nominee && f.nominee.name ? ['Nominee', f.nominee.name + ' (' + (f.nominee.relation || '') + ') ' + (f.nominee.cnic || '')] : null], 2);

    head('Money received' + (f.token_numbers ? ' - token ' + f.token_numbers : ''));
    var xs = [M + 2, M + 80, M + 170, M + 230];
    t('Date', xs[0], y, 7, reg, MUTE); t('Voucher', xs[1], y, 7, reg, MUTE); t('Mode', xs[2], y, 7, reg, MUTE); t('Party', xs[3], y, 7, reg, MUTE);
    tr('Amount', W - M - 2, y, 7, reg, MUTE); y -= 11;
    var rc = f.receipts || [];
    rc.slice(0, 12).forEach(function (x) {
      t(pdate(x.date), xs[0], y); t(x.voucher_no || '', xs[1], y); t(x.mode || '', xs[2], y); t(String(x.party || '').slice(0, 48), xs[3], y);
      tr(pnum(x.amount), W - M - 2, y); y -= 11; });
    if (rc.length > 12) { t('+ ' + (rc.length - 12) + ' more lines (total below includes them)', xs[0], y, 8, reg, MUTE); y -= 11; }
    if (!rc.length) { t('No money booked to this unit in NexuFinance.', xs[0], y, 8, reg, MUTE); y -= 11; }
    rule(y + 4); y -= 6;
    t('Total received', xs[0], y, 9, bold); tr(pnum(f.total_received), W - M - 2, y, 9, bold); y -= 12;
    t('Down payment ' + pnum(f.dp_amount) + ' less received = balance of down payment', xs[0], y, 9); tr(pnum(f.dp_balance), W - M - 2, y, 9, bold); y -= 14;

    head('Schedule');
    var s = f.schedule_json || [], inst = s.filter(function (x) { return x.installment_type === 'installment'; }),
        pos = s.filter(function (x) { return x.installment_type === 'possession'; });
    var amt = inst.length ? inst[0].amount_due : 0, lastAmt = inst.length ? inst[inst.length - 1].amount_due : 0;
    pairs([['Down payment (' + (Math.round(f.dp_pct * 100) / 100) + '%)', pnum(f.dp_amount), INK],
           ['Installments', inst.length ? inst.length + ' x ' + pnum(amt) + (lastAmt !== amt ? ' (last ' + pnum(lastAmt) + ')' : '') : 'None'],
           ['First / last due', inst.length ? pdate(inst[0].due_date) + ' - ' + pdate(inst[inst.length - 1].due_date) : '-'],
           ['Possession', pos.length ? pnum(pos[0].amount_due) + ' on ' + pdate(pos[0].due_date) : '-']]);
    if (f.plan_type === 'custom') { t('Custom schedule - ' + s.length + ' payments, total ' + pnum(f.net_price), M + 2, y + 6, 8, reg, RED); y -= 6; }

    head('Sold by');
    var cchg = Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0);
    pairs([['Agent', f.agent_name || '-', INK], ['Sub-agent', f.sub_agent_name || '-'],
           ['Commission', (f.commission_pct || 0) + '% = ' + pnum(f.commission_amount), cchg ? RED : null],
           ['Standard', (f.commission_standard_pct || 0) + '%']]);
    if (cchg) pairs([['Commission changed because', f.commission_reason || '-', RED]], 1);
    t('Payable: ' + f.commission_payable_when, M + 2, y + 6, 8, reg, MUTE); y -= 10;

    // signatures — three boxes, name and date in each
    y -= 8; var bw = (W - 2 * M - 20) / 3, bh = 62;
    [['Agent', f.agent_name, null], ['Accounts', f.accounts_verified_by_name, f.accounts_verified_at], ['Director', f.approved_by_name, f.approved_at]]
      .forEach(function (b, i) { var x = M + i * (bw + 10);
        page.drawRectangle({ x: x, y: y - bh, width: bw, height: bh, borderColor: LINE, borderWidth: 0.8 });
        t(b[0].toUpperCase(), x + 8, y - 12, 7, bold, MUTE);
        page.drawLine({ start: { x: x + 8, y: y - bh + 22 }, end: { x: x + bw - 8, y: y - bh + 22 }, thickness: 0.5, color: LINE });
        t(b[1] || '', x + 8, y - bh + 11, 8.5); tr(b[2] ? pdate(b[2]) : 'Date:', x + bw - 8, y - bh + 11, 8, reg, MUTE); });
    y -= bh + 10;
    t('Prepared by ' + (f.prepared_by_name || '-') + ' on ' + pdate(f.prepared_at), M, y, 8, reg, MUTE);

    // footer
    page.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.6, color: LINE });
    t('Fingerprint (sha256) ' + (f.snapshot_hash || '-'), M, 34, 7, reg, MUTE);
    t('Any change requires a new SAF. This form was approved and locked; it cannot be edited.', M, 23, 7.5, bold, MUTE);
    doc.setTitle(f.saf_no + ' - ' + f.unit_code, { showInWindowTitleBar: false });
    return doc.save({ useObjectStreams: false });
  }

  window.safPdf = async function () {
    var f = S.cur; if (!f) return;
    try {
      var bytes = await buildPdf(f);
      var dig = await crypto.subtle.digest('SHA-256', bytes);
      var hex = Array.prototype.map.call(new Uint8Array(dig), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      if (f.status === 'approved') {
        var r = await rpc('saf_record_pdf', { p_id: f.id, p_sha256: hex });
        if (r.success && !r.identical) say('This print differs from the first print of ' + f.saf_no + '. Tell the office.', 'warn');
        else if (r.success && !r.first) say('Identical to the first print');
      }
      window.QuotePDF && window.QuotePDF.download ? window.QuotePDF.download(bytes, f.saf_no + '-' + f.unit_code + '.pdf') : (function () {
        var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); var a = document.createElement('a');
        a.href = url; a.download = f.saf_no + '.pdf'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 5000); })();
      return hex;
    } catch (e) { say('The PDF could not be made: ' + e.message, 'err'); }
  };
  window._safBuildPdf = buildPdf;   // for the verification script
  window._safCur = function () { return S.cur; };
})();
