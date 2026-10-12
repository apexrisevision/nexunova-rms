/* ══ Sale Approvals on the Reserve Desk ═════════════════════════════════════
   Rashid signs Sale Approval Forms here, beside the holds he already decides.
   Accounts prepares and submits in the RMS; what is submitted waits on this
   desk; Approve is the digital signature (his name, the time and the form's
   sha256 go on the PDF), Send back returns it to Accounts with a reason.
   Approved forms go on to Filing in the RMS.

   Loaded by js/portal-reserve-desk.js when the desk paints, on both the
   reservation link (availability.html) and the CRM desk tab. It reaches no
   page globals: the desk hands it sb, the session token, esc and toast.

   The server decides everything (saf_desk_list / _get / _approve / _reject,
   each gated by _may_authorize_reservation). The PDF is drawn by
   js/saf-pdf.js, the same file the RMS uses, so both show identical bytes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var C = null;   // { sb, token(), esc, toast, onCount(n) }
  var ST = { el: null, rows: [], waiting: 0, off: false, recent: false, cur: null, url: null, busy: false };
  var PLAN = { standard: 'Standard (30% DP + 36 monthly)', full_100: '100% payment', half_50: '50% payment', custom: 'Custom schedule' };

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
      '.dsaf-btn{display:block;width:100%;height:46px;border-radius:11px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;margin-top:9px;border:1px solid var(--fk-border);background:var(--fk-bg-card);color:inherit}' +
      '.dsaf-btn.go{background:var(--fk-success,#15803d);border-color:var(--fk-success,#15803d);color:#fff}' +
      '.dsaf-btn.no{color:var(--fk-danger,#b91c1c);border-color:var(--fk-danger-edge)}' +
      '.dsaf-btn[disabled]{opacity:.55;cursor:default}' +
      '.dsaf-btn.lnk{display:flex;align-items:center;justify-content:center;text-decoration:none}' +
      '.dsaf-ta{width:100%;min-height:80px;border:1px solid var(--fk-border);border-radius:10px;padding:9px;font:inherit;background:var(--fk-bg-input,var(--fk-bg-card));color:inherit;margin-top:8px}' +
      '.dsaf-m{color:var(--fk-text-muted);font-size:12.5px;margin-top:8px;line-height:1.45}' +
      '.dsaf-steps{list-style:none;margin:0;padding:0;font-size:13px}' +
      '.dsaf-steps li{padding:5px 0;border-bottom:1px dashed var(--fk-border)}' +
      '.dsaf-steps li span{color:var(--fk-text-muted)}';
    document.head.appendChild(st);
  })();

  function e(s) { return C.esc(s == null ? '' : s); }
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
  function say(m, k) { try { C.toast(m, k || 'ok'); } catch (x) {} }

  async function call(fn, args) {
    try {
      var r = await C.sb.rpc(fn, Object.assign({ p_session_token: C.token() }, args || {}));
      if (r.error) return { success: false, error: 'network', message: r.error.message };
      return r.data || { success: false, error: 'empty' };
    } catch (x) { return { success: false, error: 'network' }; }
  }

  async function load() {
    var d = await call('saf_desk_list');
    if (!d.success) { ST.rows = []; ST.waiting = 0; ST.off = d.error === 'forbidden'; }
    else { ST.rows = d.rows || []; ST.waiting = Number(d.waiting || 0); ST.off = false; }
    try { C.onCount && C.onCount(ST.waiting); } catch (x) {}
    return d;
  }

  function isWaiting(r) { return r.status === 'submitted' || r.status === 'verified'; }

  function row(r) {
    var w = isWaiting(r);
    var sub = [r.floor_label, r.buyer_name, r.agent_name ? 'Agent ' + r.agent_name : null,
               w ? 'From ' + (r.prepared_by_name || 'Accounts') + ', ' + when(r.submitted_at) : null].filter(Boolean).join(' · ');
    var right = w ? '<span class="p">' + pkr(r.net_price) + '</span>'
      : '<span class="dsaf-pill ' + e(r.status) + '">' + e(r.status === 'approved' ? (r.sale_number ? 'Sale ' + r.sale_number : r.filed_at ? 'Filed' : 'Approved') : r.status === 'rejected' ? 'Sent back' : 'Superseded') + '</span>';
    return '<button type="button" class="dsaf-row" data-saf="' + e(r.id) + '"><div class="m">' +
      '<div class="t">' + e(r.unit_code) + ' · ' + e(r.saf_no) + (w && r.flags ? ' <span class="dsaf-fl">· ' + r.flags + ' to check</span>' : '') + '</div>' +
      '<div class="s">' + e(sub) + '</div></div>' + right + '</button>';
  }

  function paint() {
    var el = ST.el; if (!el || !document.body.contains(el)) return;
    if (ST.off || !ST.rows.length) { el.innerHTML = ''; return; }
    var wait = ST.rows.filter(isWaiting), done = ST.rows.filter(function (r) { return !isWaiting(r); });
    var html = '<div class="dsaf"><div class="dsaf-h"><b>Sale approvals</b>' +
      (wait.length ? '<span class="dsaf-n">' + wait.length + ' waiting</span>' : '<span class="dsaf-m" style="margin:0">Nothing waiting</span>') + '</div>';
    if (wait.length) html += '<div class="dsaf-m" style="margin:0 0 2px">Accounts has prepared these. Open one, check it, then approve or send it back.</div>';
    html += wait.map(row).join('');
    if (done.length) {
      html += '<button type="button" class="dsaf-more" data-recent="1">' + (ST.recent ? 'Hide' : 'Show') + ' recently decided (' + done.length + ')</button>';
      if (ST.recent) html += done.map(row).join('');
    }
    el.innerHTML = html + '</div>';
  }

  function onListClick(ev) {
    var t = ev.target.closest('[data-saf],[data-recent]'); if (!t) return;
    if (t.hasAttribute('data-recent')) { ST.recent = !ST.recent; paint(); return; }
    open(t.getAttribute('data-saf'));
  }

  // ── one form, full screen ─────────────────────────────────────────────────
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
        ['Discount', pkr(f.discount_amount) + ' (' + (Math.round(f.discount_pct * 100) / 100) + '%)', f.discount_beyond_standard],
        ['Net price', pkr(f.net_price)], ['Sale date', day(f.sale_date)],
        Number(f.discount_amount) > 0 ? ['Discount reason', f.discount_reason, f.discount_beyond_standard] : null,
        Number(f.discount_amount) > 0 && f.discount_approved_by_name ? ['Discount allowed by', f.discount_approved_by_name] : null]) + '</div>' +
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

  function side(f) {
    var h = '';
    if ((f.flags || []).length)
      h += '<div class="dsaf-warn"><b>Differs from the standard plan</b><ul>' + f.flags.map(function (x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ul></div>';
    if (isWaiting(f)) {
      h += '<div id="dsaf-act">' +
        '<button type="button" class="dsaf-btn go" data-act="ask-ok">Approve and sign</button>' +
        '<button type="button" class="dsaf-btn no" data-act="ask-no">Send back to Accounts</button>' +
        '<div class="dsaf-m">Approving puts your name, the time and the form’s fingerprint on the PDF. The form is locked after that and goes to Filing.</div></div>';
    } else if (f.status === 'approved') {
      h += '<div class="dsaf-ok"><b>Approved</b> by ' + e(f.approved_by_name) + ', ' + when(f.approved_at) + '.<br>' +
        (f.sale_number ? 'Sale ' + e(f.sale_number) + ' made.' : f.filed_at ? 'Filed by ' + e(f.filed_by_name) + '; sale entry next.' : 'With Filing.') + '</div>';
    } else if (f.status === 'rejected') {
      h += '<div class="dsaf-warn"><b>Sent back</b> by ' + e(f.rejected_by_name) + ', ' + when(f.rejected_at) + ':<br>' + e(f.reject_reason) + '</div>';
    }
    h += '<a class="dsaf-btn lnk" id="dsaf-pdf" href="#" target="_blank" rel="noopener">Open the PDF</a>';
    h += '<div class="dsaf-sec" style="margin-top:14px"><h4>Trail</h4><ul class="dsaf-steps">' +
      [['Prepared', f.prepared_by_name, f.prepared_at],
       ['Submitted · money confirmed', f.accounts_verified_by_name || f.submitted_by_name, f.accounts_verified_at || f.submitted_at],
       ['Approved · signed', f.approved_by_name, f.approved_at],
       ['Filed', f.filed_by_name, f.filed_at]].map(function (s) {
        return '<li>' + e(s[0]) + '<br><span>' + (s[2] ? e(s[1] || '') + ' · ' + when(s[2]) : '—') + '</span></li>'; }).join('') + '</ul></div>';
    return h;
  }

  function shut() {
    var ov = document.getElementById('dsaf-ov'); if (ov) ov.remove();
    if (ST.url) { try { URL.revokeObjectURL(ST.url); } catch (x) {} ST.url = null; }
    ST.cur = null; document.removeEventListener('keydown', onKey);
  }
  function onKey(ev) { if (ev.key === 'Escape') shut(); }

  async function loadPdfDrawing() {
    if (window.SafPdf) return;
    await new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/js/saf-pdf.js?v=20261013desk';
      s.onload = res; s.onerror = function () { rej(new Error('The PDF drawing did not load.')); };
      document.head.appendChild(s);
    });
  }

  async function drawPdf(f) {
    try {
      await loadPdfDrawing();
      var bytes = await window.SafPdf.build(f);
      if (ST.url) URL.revokeObjectURL(ST.url);
      ST.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      var fr = document.getElementById('dsaf-frame'); if (fr) fr.src = ST.url + '#toolbar=1&view=FitH';
      var a = document.getElementById('dsaf-pdf'); if (a) { a.href = ST.url; a.setAttribute('download', f.saf_no + '-' + f.unit_code + '.pdf'); }
    } catch (x) {
      var a2 = document.getElementById('dsaf-pdf'); if (a2) a2.outerHTML = '<div class="dsaf-m">The PDF could not be made here. The details are on this screen.</div>';
    }
  }

  function drawOpen(f) {
    var ov = document.getElementById('dsaf-ov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'dsaf-ov'; ov.className = 'dsaf-ov';
      ov.addEventListener('click', onOvClick);
      document.body.appendChild(ov);
      document.addEventListener('keydown', onKey);
    }
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
    var d = await call('saf_desk_get', { p_id: id });
    if (!d.success) { say(d.message || 'This form could not be opened.', 'err'); return; }
    ST.cur = d.saf; drawOpen(d.saf);
  }

  async function onOvClick(ev) {
    if (ev.target.id === 'dsaf-ov') { shut(); return; }
    var b = ev.target.closest('[data-act]'); if (!b || ST.busy) return;
    var act = b.getAttribute('data-act'), f = ST.cur, box = document.getElementById('dsaf-act');
    if (act === 'close') { shut(); return; }
    if (!f || !box) return;
    if (act === 'ask-ok') {
      box.innerHTML = '<div class="dsaf-ok">Approve <b>' + e(f.saf_no) + '</b> for <b>' + e(f.unit_code) + '</b> at <b>' + pkr(f.net_price) + '</b>?<br>' +
        'This is your digital signature.</div>' +
        '<button type="button" class="dsaf-btn go" data-act="ok">Yes, approve and sign</button>' +
        '<button type="button" class="dsaf-btn" data-act="back">Not yet</button>';
      return;
    }
    if (act === 'ask-no') {
      box.innerHTML = '<div class="dsaf-m" style="margin:0">Why is it going back? Accounts sees this.</div>' +
        '<textarea class="dsaf-ta" id="dsaf-why" maxlength="400"></textarea>' +
        '<button type="button" class="dsaf-btn no" data-act="no">Send back</button>' +
        '<button type="button" class="dsaf-btn" data-act="back">Cancel</button>';
      setTimeout(function () { var t = document.getElementById('dsaf-why'); if (t) t.focus(); }, 30);
      return;
    }
    if (act === 'back') { drawOpen(f); return; }
    if (act === 'ok' || act === 'no') {
      var why = act === 'no' ? (document.getElementById('dsaf-why') || {}).value || '' : '';
      if (act === 'no' && !why.trim()) { say('Write why it is going back.', 'err'); return; }
      ST.busy = true; b.disabled = true; b.textContent = act === 'ok' ? 'Signing…' : 'Sending back…';
      var r = act === 'ok' ? await call('saf_desk_approve', { p_id: f.id })
                           : await call('saf_desk_reject', { p_id: f.id, p_reason: why.trim() });
      ST.busy = false;
      if (!r.success) {
        say(r.message || 'That did not go through.', 'err');
        b.disabled = false; b.textContent = act === 'ok' ? 'Yes, approve and sign' : 'Send back';
        return;
      }
      say(act === 'ok' ? f.saf_no + ' approved and signed. It has gone to Filing.' : f.saf_no + ' sent back to Accounts.');
      ST.cur = r.saf; drawOpen(r.saf);
      await load(); paint();
    }
  }

  window.DeskSaf = {
    /* el: where the list goes; ctx: { sb, token, esc, toast, onCount } */
    mount: async function (el, ctx) {
      C = ctx; ST.el = el;
      if (!el) return;
      if (!el._dsafWired) { el.addEventListener('click', onListClick); el._dsafWired = true; }
      paint();                  // last known list straight away, then fresh
      await load(); paint();
    }
  };
})();
