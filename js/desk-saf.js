/* ══ Sale Approvals in the Directors' Room ══════════════════════════════════
   Filing (naseer@awami) prepares and submits in the RMS. Full price makes
   the sale at once; any discount waits here, and a director's Approve makes it.

   The room password reads the list. Approve and Decline ask the director's
   OWN approval password, and the server knows from it which of the three
   directors is signing (saf_room_approve / saf_room_reject). Each director
   sets their own approval password here once, proving who they are with
   their CRM mobile + PIN (saf_room_set_password). The page decides nothing.

   The PDF is drawn by js/saf-pdf.js, the same file the RMS uses.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  (function () {
    if (document.getElementById('dsaf-style')) return;
    var st = document.createElement('style');
    st.id = 'dsaf-style';
    st.textContent =
      '.dsaf{background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card,14px);' +
        'padding:14px;box-shadow:var(--fk-shadow);margin-bottom:12px}' +
      '.dsaf-h{display:flex;align-items:center;gap:8px;margin-bottom:8px}' +
      '.dsaf-h b{font-size:15px}' +
      '.dsaf-n{background:var(--fk-warning-surface);color:var(--fk-warning,#b45309);border:1px solid var(--fk-warning-edge);' +
        'border-radius:999px;padding:1px 9px;font-size:12px;font-weight:700}' +
      '.dsaf-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;color:inherit;' +
        'background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:11px;padding:10px 12px;margin-top:7px;cursor:pointer}' +
      '.dsaf-row:hover{border-color:var(--fk-primary)}' +
      '.dsaf-row .m{flex:1;min-width:0}' +
      '.dsaf-row .t{font-weight:700}' +
      '.dsaf-row .s{color:var(--fk-text-muted);font-size:12.5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dsaf-row .p{font-weight:700;white-space:nowrap}' +
      '.dsaf-fl{color:var(--fk-danger,#b91c1c);font-size:12px;font-weight:700}' +
      '.dsaf-pill{border-radius:999px;padding:1px 8px;font-size:11.5px;font-weight:700;border:1px solid var(--fk-border)}' +
      '.dsaf-pill.approved{color:var(--fk-success,#15803d);border-color:var(--fk-success-edge);background:var(--fk-success-surface)}' +
      '.dsaf-pill.rejected,.dsaf-pill.superseded{color:var(--fk-danger,#b91c1c);border-color:var(--fk-danger-edge);background:var(--fk-danger-surface)}' +
      '.dsaf-more{background:none;border:0;color:var(--fk-primary);font:inherit;font-size:13px;padding:8px 0 0;cursor:pointer}' +
      '.dsaf-ov{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:stretch;justify-content:center}' +
      '.dsaf-box{background:var(--fk-bg,var(--fk-bg-card));width:100%;max-width:1180px;display:flex;flex-direction:column;overflow:hidden}' +
      '@media(min-width:900px){.dsaf-ov{padding:24px}.dsaf-box{border-radius:16px}}' +
      '.dsaf-top{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--fk-border);background:var(--fk-bg-card)}' +
      '.dsaf-top b{font-size:16px}.dsaf-top .s{color:var(--fk-text-muted);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dsaf-x{background:none;border:1px solid var(--fk-border);border-radius:9px;width:36px;height:36px;font-size:18px;cursor:pointer;color:inherit}' +
      '.dsaf-main{flex:1;display:flex;min-height:0}' +
      '.dsaf-doc{flex:1;min-width:0;overflow:auto;padding:14px 16px}' +
      '.dsaf-frame{width:100%;height:100%;border:0;background:#fff;border-radius:8px}' +
      '.dsaf-side{width:330px;flex-shrink:0;border-left:1px solid var(--fk-border);padding:14px 16px;overflow:auto;background:var(--fk-bg-card)}' +
      '@media(max-width:899px){.dsaf-main{flex-direction:column;overflow:auto}.dsaf-doc{overflow:visible}.dsaf-side{width:auto;border-left:0;border-top:1px solid var(--fk-border)}.dsaf-wide{display:none}}' +
      '@media(min-width:900px){.dsaf-narrow{display:none}}' +
      '.dsaf-sec{margin-bottom:14px}' +
      '.dsaf-sec h4{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted)}' +
      '.dsaf-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px}' +
      '.dsaf-kv div span{display:block;font-size:11.5px;color:var(--fk-text-muted)}' +
      '.dsaf-kv div b{font-size:14px;word-break:break-word}' +
      '.dsaf-kv .red b{color:var(--fk-danger,#b91c1c)}' +
      '.dsaf-warn{border:1px solid var(--fk-danger-edge);background:var(--fk-danger-surface);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}' +
      '.dsaf-warn ul{margin:4px 0 0 16px;padding:0}' +
      '.dsaf-ok{border:1px solid var(--fk-success-edge);background:var(--fk-success-surface);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}' +
      '.dsaf-btn{box-sizing:border-box;display:block;width:100%;height:46px;border-radius:11px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;margin-top:9px;border:1px solid var(--fk-border);background:var(--fk-bg-card);color:inherit}' +
      '.dsaf-btn.go{background:var(--fk-success,#15803d);border-color:var(--fk-success,#15803d);color:#fff}' +
      '.dsaf-btn.no{color:var(--fk-danger,#b91c1c);border-color:var(--fk-danger-edge)}' +
      '.dsaf-btn[disabled]{opacity:.55;cursor:default}' +
      '.dsaf-btn.lnk{display:flex;align-items:center;justify-content:center;text-decoration:none}' +
      '.dsaf-ta{box-sizing:border-box;width:100%;min-height:80px;border:1px solid var(--fk-border);border-radius:10px;padding:9px;font:inherit;background:var(--fk-bg-input,var(--fk-bg-card));color:inherit;margin-top:8px}' +
      '.dsaf-m{color:var(--fk-text-muted);font-size:12.5px;margin-top:8px;line-height:1.45}' +
      '.dsaf-steps{list-style:none;margin:0;padding:0;font-size:13px}' +
      '.dsaf-steps li{padding:5px 0;border-bottom:1px dashed var(--fk-border)}' +
      '.dsaf-steps li span{color:var(--fk-text-muted)}' +
      '@media(max-width:600px){.dsaf{padding:10px 11px;margin-bottom:8px}.dsaf-intro{display:none}' +
        '.dsaf-row{padding:8px 10px;margin-top:5px}.dsaf-row .t{font-size:13px}.dsaf-row .s{font-size:11.5px}' +
        '.dsaf-h{margin-bottom:4px}.dsaf-h b{font-size:14px}.dsaf .dsaf-m{font-size:11.5px;margin-top:6px}}';
    document.head.appendChild(st);
  })();

  (function () {
    if (document.getElementById('dsaf-style2')) return;
    var st = document.createElement('style');
    st.id = 'dsaf-style2';
    st.textContent =
      '.dsaf-in{box-sizing:border-box;width:100%;height:44px;border:1px solid var(--fk-border);border-radius:10px;padding:0 11px;font:inherit;font-size:15px;' +
        'background:var(--fk-bg-input,var(--fk-bg-card));color:inherit;margin-top:8px}' +
      '.dsaf-lb{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted);margin-top:10px}' +
      '.dsaf-err{color:var(--fk-danger,#b91c1c);font-size:13px;margin-top:8px}';
    document.head.appendChild(st);
  })();

  var PLAN = { standard: 'Standard (30% DP + 36 monthly)', full_100: '100% payment', half_50: '50% payment', custom: 'Custom schedule' };
  var OV = null;   // the instance whose form is open full screen (one at a time)

  function pkr(n) { if (n == null || n === '') return '-'; return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function when(s) {
    if (!s) return '-';
    var x = new Date(s); if (isNaN(x)) return String(s);
    return x.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  }
  function day(s) {
    if (!s) return '-';
    var x = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); if (isNaN(x)) return String(s);
    return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function isWaiting(r) { return r.status === 'submitted' || r.status === 'verified'; }

  async function loadPdfDrawing() {
    if (window.SafPdf) return;
    await new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/js/saf-pdf.js?v=20261017report';
      s.onload = res; s.onerror = function () { rej(new Error('The PDF drawing did not load.')); };
      document.head.appendChild(s);
    });
  }

  /* One instance per place it is shown.
       ctx.sb, ctx.esc, ctx.toast
       ctx.list()          -> promise of { success, rows, waiting }
       ctx.get(id)         -> promise of { success, saf }
       ctx.approve(id, sign)          -> promise of the server's answer
       ctx.reject(id, reason, sign)   -> promise of the server's answer
       ctx.setPassword(ph, pin, pw)   -> promise of { success, name } | { error, message }
       ctx.phone()         -> a mobile to prefill, if the browser remembers one
       ctx.onCount(n)      -> how many are waiting
       ctx.title           -> heading over the list                           */
  function create(ctx) {
    var I = { el: null, rows: [], approvers: [], waiting: 0, off: false, recent: false, cur: null, url: null, busy: false };
    function e(s) { return ctx.esc(s == null ? '' : s); }
    function say(m, k) { try { ctx.toast(m, k || 'ok'); } catch (x) {} }

    async function rpc(fn, args) {
      try {
        var r = await ctx.sb.rpc(fn, args);
        if (r.error) return { success: false, error: 'network', message: r.error.message };
        return r.data || { success: false, error: 'empty' };
      } catch (x) { return { success: false, error: 'network' }; }
    }

    async function load() {
      var d; try { d = await ctx.list(); } catch (x) { d = { success: false, error: 'network' }; }
      d = d || { success: false };
      if (!d.success) { if (d.error === 'forbidden') { I.off = true; I.rows = []; I.waiting = 0; } }
      else { I.rows = d.rows || []; I.approvers = d.approvers || []; I.waiting = Number(d.waiting || 0); I.off = false; }
      try { ctx.onCount && ctx.onCount(I.waiting); } catch (x) {}
      return d;
    }

    function row(r) {
      var w = isWaiting(r);
      var sub = [r.floor_label, r.buyer_name, r.agent_name ? 'Agent ' + r.agent_name : null,
                 w ? 'From ' + (r.prepared_by_name || 'Accounts') + ', ' + when(r.submitted_at) : null].filter(Boolean).join(' · ');
      var right = w ? '<span class="p">' + pkr(r.net_price) + '</span>'
        : '<span class="dsaf-pill ' + e(r.status) + '">' + e(r.status === 'approved' ? (r.sale_number ? 'Sale ' + r.sale_number : r.filed_at ? 'Filed' : 'Approved') : r.status === 'rejected' ? 'Declined' : 'Superseded') + '</span>';
      return '<button type="button" class="dsaf-row" data-saf="' + e(r.id) + '"><div class="m">' +
        '<div class="t">' + e(r.unit_code) + ' · ' + e(r.saf_no) + (w && r.flags ? ' <span class="dsaf-fl">· ' + r.flags + ' to check</span>' : '') + '</div>' +
        '<div class="s">' + e(sub) + '</div></div>' + right + '</button>';
    }

    function html() {
      if (I.off) return '';
      var wait = I.rows.filter(isWaiting), done = I.rows.filter(function (r) { return !isWaiting(r); });
      var h = '<div class="dsaf"><div class="dsaf-h"><b>' + e(ctx.title || 'Sale approvals') + '</b>' +
        (wait.length ? '<span class="dsaf-n">' + wait.length + ' waiting</span>' : '<span class="dsaf-m" style="margin:0">Nothing waiting</span>') + '</div>';
      if (wait.length) h += '<div class="dsaf-m dsaf-intro" style="margin:0 0 2px">These were prepared with a discount or below the list price. Open one, check it, then approve or decline it with your own approval password.</div>';
      h += wait.map(row).join('');
      if (done.length) {
        h += '<button type="button" class="dsaf-more" data-recent="1">' + (I.recent ? 'Hide' : 'Show') + ' recently decided (' + done.length + ')</button>';
        if (I.recent) h += done.map(row).join('');
      }
      var unset = I.approvers.filter(function (a) { return !a.has_password; }).map(function (a) { return a.name; });
      h += '<div class="dsaf-m">' + (unset.length ? 'No approval password yet: ' + e(unset.join(', ')) + '. ' : '') +
        '<button type="button" class="dsaf-more" style="padding:0" data-setpw="1">Set or change my approval password</button></div>';
      return h + '</div>';
    }

    function paint() {
      var el = I.el; if (!el || !document.body.contains(el)) { el = I.find && I.find(); I.el = el; }
      if (el) el.innerHTML = html();
    }

    function onListClick(ev) {
      var t = ev.target.closest('[data-saf],[data-recent],[data-setpw]'); if (!t) return;
      if (!t.closest('.dsaf')) return;
      ev.stopPropagation();
      if (t.hasAttribute('data-recent')) { I.recent = !I.recent; paint(); return; }
      if (t.hasAttribute('data-setpw')) { openSetPw(); return; }
      open(t.getAttribute('data-saf'));
    }

    // ── one form, full screen ───────────────────────────────────────────────
    function kv(list) {
      return '<div class="dsaf-kv">' + list.filter(Boolean).map(function (p) {
        return '<div' + (p[2] ? ' class="red"' : '') + '><span>' + e(p[0]) + '</span><b>' + e(p[1] == null || p[1] === '' ? '-' : p[1]) + '</b></div>';
      }).join('') + '</div>';
    }
    function summary(f) {
      var s = f.schedule_json || [], inst = s.filter(function (x) { return x.installment_type === 'installment'; });
      var cchg = Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0);
      return '<div class="dsaf-sec"><h4>Unit</h4>' + kv([['Unit', f.unit_code], ['Floor', f.floor_label], ['Area', f.area_sqft + ' sqft'],
          ['Rate / sqft', pkr(f.rate_per_sqft)], ['List price', pkr(f.base_price)]]) + '</div>' +
        '<div class="dsaf-sec"><h4>Deal</h4>' + kv([['Plan', PLAN[f.plan_type] || f.plan_type],
          ['Discount', pkr(f.discount_amount) + ' (' + (Math.round(f.discount_pct * 100) / 100) + '%, plan allows ' + (f.standard_discount_pct || 0) + '%)', f.discount_beyond_standard],
          ['Net price', pkr(f.net_price)], ['Sale date', day(f.sale_date)],
          Number(f.discount_amount) > 0 ? ['Discount reason', f.discount_reason, f.discount_beyond_standard] : null]) + '</div>' +
        '<div class="dsaf-sec"><h4>Buyer</h4>' + kv([['Name', f.buyer_name], [f.buyer_relation || 'S/O', f.buyer_father], ['CNIC', f.buyer_cnic],
          ['Phone', f.buyer_phone], ['Address', f.buyer_address],
          f.buyer_name_reason ? ['Not the name on the hold (' + (f.reservation_buyer_name || '') + ')', f.buyer_name_reason, true] : null]) + '</div>' +
        '<div class="dsaf-sec"><h4>Money received' + (f.token_numbers ? ' · token ' + e(f.token_numbers) : '') + '</h4>' +
          kv([['Total received', pkr(f.total_received)], ['Down payment', pkr(f.dp_amount)], ['Down payment still due', pkr(f.dp_balance)],
              ['Lines in NexuFinance', String((f.receipts || []).length)]]) + '</div>' +
        '<div class="dsaf-sec"><h4>Schedule</h4>' + kv([['Installments', inst.length ? inst.length + ' × ' + pkr(inst[0].amount_due) : 'None'],
          ['First / last due', inst.length ? day(inst[0].due_date) + ' – ' + day(inst[inst.length - 1].due_date) : '-']]) + '</div>' +
        '<div class="dsaf-sec"><h4>Sold by</h4>' + kv([['Agent', f.agent_name], ['Sub-agent', f.sub_agent_name],
          ['Commission', (f.commission_pct || 0) + '% = ' + pkr(f.commission_amount), cchg], ['Standard rate', (f.commission_standard_pct || 0) + '%'],
          cchg ? ['Changed because', f.commission_reason, true] : null]) + '</div>';
    }

    function actions(f) {
      return '<div id="dsaf-act">' +
        '<button type="button" class="dsaf-btn go" data-act="ask-ok">Approve and sign</button>' +
        '<button type="button" class="dsaf-btn no" data-act="ask-no">Decline</button>' +
        '<div class="dsaf-m">Approving puts your name, the time and the form\u2019s fingerprint on the PDF and makes the sale at this price, with the money already received. Declining sends it back with your reason.</div></div>';
    }
    // the director's own approval password: the server knows from it who is signing
    function signBox() {
      return '<div class="dsaf-lb">Your approval password</div>' +
        '<input class="dsaf-in" id="dsaf-sign" type="password" autocomplete="off">' +
        '<div class="dsaf-m">Your own, not the room password. The form records which director signed.</div>';
    }

    function side(f) {
      var h = '';
      if ((f.flags || []).length)
        h += '<div class="dsaf-warn"><b>Differs from the standard plan</b><ul>' + f.flags.map(function (x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ul></div>';
      if (isWaiting(f)) h += actions(f);
      else if (f.status === 'approved') {
        h += '<div class="dsaf-ok"><b>Approved</b> ' + (f.approval_route === 'plan' ? 'at the list price (no director needed)' : 'by ' + e(f.approved_by_name)) +
          ', ' + when(f.approved_at) + '.<br>' +
          (f.sale_number ? 'Sale ' + e(f.sale_number) + ' made.' : 'Sale entry not made yet.') + '</div>';
      } else if (f.status === 'rejected') {
        h += '<div class="dsaf-warn"><b>Declined</b> by ' + e(f.rejected_by_name) + ', ' + when(f.rejected_at) + ':<br>' + e(f.reject_reason) + '</div>';
      }
      h += '<a class="dsaf-btn lnk" id="dsaf-pdf" href="#" target="_blank" rel="noopener">Open the PDF</a>';
      h += '<div class="dsaf-sec" style="margin-top:14px"><h4>Trail</h4><ul class="dsaf-steps">' +
        [['Prepared', f.prepared_by_name, f.prepared_at],
         ['Submitted · money confirmed', f.accounts_verified_by_name || f.submitted_by_name, f.accounts_verified_at || f.submitted_at],
         ['Approved · signed', f.approval_route === 'plan' ? 'Full price, no director needed' : f.approved_by_name, f.approved_at],
         ['Sale made', f.sale_number, f.sale_number ? (f.filed_at || f.approved_at) : null]].map(function (s) {
          return '<li>' + e(s[0]) + '<br><span>' + (s[2] ? e(s[1] || '') + ' · ' + when(s[2]) : '—') + '</span></li>'; }).join('') + '</ul></div>';
      return h;
    }

    function shut() {
      var ov = document.getElementById('dsaf-ov'); if (ov) ov.remove();
      if (I.url) { try { URL.revokeObjectURL(I.url); } catch (x) {} I.url = null; }
      I.cur = null; OV = null; document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) { if (ev.key === 'Escape' && OV === I) shut(); }

    async function drawPdf(f) {
      try {
        await loadPdfDrawing();
        var bytes = await window.SafPdf.build(f);
        if (I.url) URL.revokeObjectURL(I.url);
        I.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        var fr = document.getElementById('dsaf-frame'); if (fr) fr.src = I.url + '#toolbar=1&view=FitH';
        var a = document.getElementById('dsaf-pdf'); if (a) { a.href = I.url; a.setAttribute('download', f.saf_no + '-' + f.unit_code + '.pdf'); }
      } catch (x) {
        var a2 = document.getElementById('dsaf-pdf'); if (a2) a2.outerHTML = '<div class="dsaf-m">The PDF could not be made here. The details are on this screen.</div>';
      }
    }

    function drawOpen(f) {
      var ov = document.getElementById('dsaf-ov');
      if (ov && OV !== I) { ov.remove(); ov = null; }
      if (!ov) {
        ov = document.createElement('div'); ov.id = 'dsaf-ov'; ov.className = 'dsaf-ov';
        ov.addEventListener('click', onOvClick);
        document.body.appendChild(ov);
        document.addEventListener('keydown', onKey);
      }
      OV = I;
      ov.innerHTML = '<div class="dsaf-box" role="dialog" aria-label="Sale Approval Form ' + e(f.saf_no) + '">' +
        '<div class="dsaf-top"><b>' + e(f.saf_no) + '</b><span class="s">' + e(f.unit_code) + ' · ' + e(f.buyer_name || '') + ' · ' + pkr(f.net_price) + '</span>' +
          '<button type="button" class="dsaf-x" data-act="close" aria-label="Close">×</button></div>' +
        '<div class="dsaf-main"><div class="dsaf-doc">' +
          '<iframe class="dsaf-frame dsaf-wide" id="dsaf-frame" title="Sale Approval Form"></iframe>' +
          '<div class="dsaf-narrow">' + summary(f) + '</div>' +
        '</div><div class="dsaf-side">' + side(f) + '</div></div></div>';
      drawPdf(f);
    }

    async function open(id) {
      var d; try { d = await ctx.get(id); } catch (x) { d = null; }
      if (!d || !d.success) { say((d && d.message) || 'This form could not be opened.', 'err'); return; }
      I.cur = d.saf; drawOpen(d.saf);
    }

    function boxErr(m) {
      var x = document.getElementById('dsaf-err');
      if (x) x.textContent = m; else say(m, 'err');
    }

    function openSetPw() {
      var ov = document.getElementById('dsaf-ov');
      if (ov) ov.remove();
      ov = document.createElement('div'); ov.id = 'dsaf-ov'; ov.className = 'dsaf-ov';
      ov.addEventListener('click', onOvClick);
      document.body.appendChild(ov); document.addEventListener('keydown', onKey); OV = I; I.cur = null;
      ov.innerHTML = '<div class="dsaf-box" style="max-width:460px;height:auto;align-self:center;border-radius:16px" role="dialog" aria-label="Approval password">' +
        '<div class="dsaf-top"><b>My approval password</b><span class="s"></span>' +
          '<button type="button" class="dsaf-x" data-act="close" aria-label="Close">×</button></div>' +
        '<div style="padding:14px 16px" id="dsaf-pw">' +
          '<div class="dsaf-m" style="margin:0">Only you will know it. Prove it is you with your CRM mobile and PIN, then choose the password you will sign with.</div>' +
          '<div class="dsaf-lb">Your CRM mobile</div><input class="dsaf-in" id="dsaf-ph" inputmode="tel" autocomplete="off" placeholder="03001234567" value="' + e((ctx.phone && ctx.phone()) || '') + '">' +
          '<div class="dsaf-lb">Your CRM PIN</div><input class="dsaf-in" id="dsaf-pin" type="password" inputmode="numeric" autocomplete="off">' +
          '<div class="dsaf-lb">New approval password (6 or more)</div><input class="dsaf-in" id="dsaf-n1" type="password" autocomplete="new-password">' +
          '<div class="dsaf-lb">Type it again</div><input class="dsaf-in" id="dsaf-n2" type="password" autocomplete="new-password">' +
          '<div class="dsaf-err" id="dsaf-err"></div>' +
          '<button type="button" class="dsaf-btn go" data-act="setpw">Save my approval password</button>' +
        '</div></div>';
      setTimeout(function () { var p = document.getElementById('dsaf-ph'); (p && !p.value ? p : document.getElementById('dsaf-pin')).focus(); }, 30);
    }

    async function savePw(b) {
      function v(id) { return ((document.getElementById(id) || {}).value || ''); }
      var ph = v('dsaf-ph').trim(), pin = v('dsaf-pin').trim(), n1 = v('dsaf-n1'), n2 = v('dsaf-n2');
      if (!ph || !pin) { boxErr('Enter your CRM mobile and PIN.'); return; }
      if (n1.length < 6) { boxErr('Use at least 6 characters.'); return; }
      if (n1 !== n2) { boxErr('The two passwords are not the same.'); return; }
      I.busy = true; b.disabled = true; b.textContent = 'Saving…';
      var r; try { r = await ctx.setPassword(ph, pin, n1); } catch (x) { r = null; }
      I.busy = false;
      if (!r || !r.success) { b.disabled = false; b.textContent = 'Save my approval password'; boxErr((r && r.message) || 'That did not go through.'); return; }
      var box = document.getElementById('dsaf-pw');
      if (box) box.innerHTML = '<div class="dsaf-ok">Saved. <b>' + e(r.name) + '</b>, sign with this password from now on.</div>' +
        '<button type="button" class="dsaf-btn" data-act="close">Done</button>';
      await load(); paint();
    }

    async function onOvClick(ev) {
      if (ev.target.id === 'dsaf-ov') { shut(); return; }
      var b = ev.target.closest('[data-act]'); if (!b || I.busy) return;
      var act = b.getAttribute('data-act'), f = I.cur, box = document.getElementById('dsaf-act');
      if (act === 'close') { shut(); return; }
      if (act === 'setpw') { savePw(b); return; }
      if (!f || !box) return;
      if (act === 'ask-ok') {
        box.innerHTML = '<div class="dsaf-ok">Approve <b>' + e(f.saf_no) + '</b> for <b>' + e(f.unit_code) + '</b> at <b>' + pkr(f.net_price) + '</b>' +
          ' (list ' + pkr(f.base_price) + ', discount ' + pkr(f.discount_amount) + ')?<br>This is your digital signature.</div>' + signBox() +
          '<div class="dsaf-err" id="dsaf-err"></div>' +
          '<button type="button" class="dsaf-btn go" data-act="ok">Yes, approve and sign</button>' +
          '<button type="button" class="dsaf-btn" data-act="back">Not yet</button>';
        setTimeout(function () { var q = document.getElementById('dsaf-sign'); if (q) q.focus(); }, 30);
        return;
      }
      if (act === 'ask-no') {
        box.innerHTML = '<div class="dsaf-m" style="margin:0">Why is it declined? Whoever prepared it sees this reason.</div>' +
          '<textarea class="dsaf-ta" id="dsaf-why" maxlength="400"></textarea>' + signBox() +
          '<div class="dsaf-err" id="dsaf-err"></div>' +
          '<button type="button" class="dsaf-btn no" data-act="no">Decline and send back</button>' +
          '<button type="button" class="dsaf-btn" data-act="back">Cancel</button>';
        setTimeout(function () { var t = document.getElementById('dsaf-why'); if (t) t.focus(); }, 30);
        return;
      }
      if (act === 'back') { drawOpen(f); return; }
      if (act !== 'ok' && act !== 'no') return;

      var why = act === 'no' ? ((document.getElementById('dsaf-why') || {}).value || '').trim() : '';
      if (act === 'no' && !why) { boxErr('Write why it is declined.'); return; }
      var sign = ((document.getElementById('dsaf-sign') || {}).value || '');
      if (!sign) { boxErr('Enter your approval password.'); return; }
      var label = b.textContent;
      I.busy = true; b.disabled = true;
      try {
        b.textContent = act === 'ok' ? 'Signing…' : 'Declining…';
        var r; try { r = act === 'ok' ? await ctx.approve(f.id, sign) : await ctx.reject(f.id, why, sign); } catch (x) { r = null; }
        r = r || { success: false, message: 'Could not reach the office. Try again.' };
        if (!r.success) { boxErr(r.message || 'That did not go through.'); return; }
        say(act === 'ok' ? f.saf_no + ' approved and signed by ' + (r.saf.approved_by_name || 'you') + '. ' + (r.sale_number ? 'Sale ' + r.sale_number + ' made.' : 'It is approved.')
                         : f.saf_no + ' declined by ' + (r.saf.rejected_by_name || 'you') + ' and sent back with your reason.');
        I.cur = r.saf; drawOpen(r.saf);
        await load(); paint();
      } finally {
        I.busy = false;
        if (document.body.contains(b)) { b.disabled = false; b.textContent = label; }
      }
    }

    return {
      /* el: where the list goes. find(): how to find it again after the host
         page redraws (the Directors' Room repaints its whole body). */
      mount: async function (el, find) {
        I.el = el; I.find = find || null;
        paint();
        await load(); paint();
      },
      // the click handler, attached once to a container that outlives repaints
      bind: function (container) {
        if (!container || container['_dsaf_' + (ctx.title || '')]) return;
        container['_dsaf_' + (ctx.title || '')] = true;
        container.addEventListener('click', onListClick, true);
      },
      html: html,
      refresh: async function () { await load(); paint(); return I.waiting; },
      waiting: function () { return I.waiting; }
    };
  }

  window.DeskSaf = { create: create };
})();
