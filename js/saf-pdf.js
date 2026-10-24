/* ══ Sale Approval Form: the PDF ══════════════════════════════════════════
   One drawing for every place the form is shown: the RMS page (Accounts,
   the owner, Filing) and Rashid's Reserve Desk (the reservation link and the
   CRM desk tab). Deterministic — no metadata, no clock, dates from stored
   values only — so the same form gives the same bytes, and the sha256 Filing
   records can be checked by anyone who draws it again.

   window.SafPdf.build(form) -> Uint8Array
   window.SafPdf.sha256(bytes) -> hex
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var PLAN = {
    standard: ['Standard', '30% DP + 36 monthly'],
    full_100: ['100% payment', 'Full price now, 10% off'],
    half_50:  ['50% payment', '50% DP, 5% off, rest monthly'],
    custom:   ['Custom', 'Schedule written by hand']
  };
  // ── the PDF (20261014b: the buyer's and nominee's photos; no co-buyer) ──
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/vendor/pdf-lib.min.js?v=1.17.1';
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

  // a photo on the form: the stored JPG (or PNG) bytes, or null if it cannot be read
  async function photoBytes(url) {
    if (!url) return null;
    try { var r = await fetch(url, { cache: 'force-cache' }); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); }
    catch (e) { return null; }
  }
  async function embedPhoto(doc, bytes) {
    if (!bytes) return null;
    try { return await doc.embedJpg(bytes); } catch (e) {}
    try { return await doc.embedPng(bytes); } catch (e) {}
    return null;
  }

  /* 20261017a (Rashid): the form doubles as the pre-sale report — what the
     unit is, what it costs, the down payment, every rupee already received
     and against which voucher, who asked for it and who sold it. No director
     step any more: a submitted form is approved and the sale is made. */
  async function buildPdf(f) {
    await loadPdfLib();
    var L = window.PDFLib;
    var doc = await L.PDFDocument.create({ updateMetadata: false });
    var reg = await doc.embedFont(L.StandardFonts.Helvetica), bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var W = 595.28, H = 841.89, M = 34, CW = W - 2 * M, page = doc.addPage([W, H]), y = H;
    var C = function (r, g, b) { return L.rgb(r / 255, g / 255, b / 255); };
    var INK = C(17, 24, 39), MUTE = C(100, 116, 139), LINE = C(226, 232, 240), SOFT = C(248, 250, 252),
        BRAND = C(11, 37, 69), BRAND2 = C(19, 49, 92), GOLD = C(224, 162, 59), TEAL = C(15, 118, 110),
        TEALT = C(236, 253, 245), RED = C(185, 28, 28), REDT = C(254, 242, 242), AMBER = C(180, 83, 9),
        AMBERT = C(255, 251, 235), GREEN = C(21, 128, 61), WHITE = C(255, 255, 255), HEADT = C(203, 213, 225);
    function t(s, x, yy, sz, fnt, col) { page.drawText(safe(s), { x: x, y: yy, size: sz || 9, font: fnt || reg, color: col || INK }); }
    function tw(s, sz, fnt) { return (fnt || reg).widthOfTextAtSize(safe(s), sz || 9); }
    function tr(s, xr, yy, sz, fnt, col) { t(s, xr - tw(s, sz, fnt), yy, sz, fnt, col); }
    function fit(s, w, sz, fnt) { s = safe(s); while (s.length > 3 && tw(s, sz, fnt) > w) s = s.slice(0, -2); return s; }
    function box(x, yy, w, h, fill, border, bw) { page.drawRectangle({ x: x, y: yy, width: w, height: h, color: fill || undefined,
      borderColor: border || undefined, borderWidth: border ? (bw || 0.8) : 0 }); }
    function hline(x1, x2, yy, col, th) { page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th || 0.6, color: col || LINE }); }
    // a section title: gold tick, navy caps, hairline to the edge
    function head(s, right) { y -= 10; box(M, y - 1, 3, 10, GOLD); t(s.toUpperCase(), M + 8, y, 8, bold, BRAND);
      var x0 = M + 14 + tw(s.toUpperCase(), 8, bold);
      if (right) { tr(right, W - M, y, 7.5, reg, MUTE); hline(x0, W - M - tw(right, 7.5) - 8, y + 3); } else hline(x0, W - M, y + 3);
      y -= 14; }
    // label over value, in equal columns
    function cells(list, cols, x0, width) { cols = cols || list.length; x0 = x0 == null ? M : x0; var cw = (width || CW) / cols;
      for (var i = 0; i < list.length; i++) { var p = list[i]; if (!p) continue; var cx = x0 + (i % cols) * cw + 2,
          fnt = p[2] ? bold : reg, sz = 9.5, v = String(p[1] == null || p[1] === '' ? '-' : p[1]);
        while (sz > 7 && tw(v, sz, fnt) > cw - 8) sz -= 0.5;
        t(p[0], cx, y, 6.8, reg, MUTE); t(fit(v, cw - 8, sz, fnt), cx, y - 11, sz, fnt, p[2] || INK);
        if (i % cols === cols - 1 || i === list.length - 1) y -= i === list.length - 1 ? 25 : 25; } }

    var planName = (PLAN[f.plan_type] || [f.plan_type || '-'])[0];
    var disc = Number(f.discount_amount || 0), dpPct = Math.round(Number(f.dp_pct || 0) * 100) / 100,
        recv = Number(f.total_received || 0), dpBal = Number(f.dp_balance || 0), net = Number(f.net_price || 0),
        hold = f.hold || {};

    // ── banner: navy, gold rule, the form number on the right ─────────────
    box(0, H - 82, W, 82, BRAND); box(0, H - 85, W, 3, GOLD);
    t('AWAMI MARKET', M, H - 36, 18, bold, WHITE);
    t('By 14 Group of Companies', M, H - 51, 8.5, reg, HEADT);
    t('SALE APPROVAL FORM', M, H - 69, 8, bold, GOLD);
    tr(f.saf_no || '-', W - M, H - 38, 20, bold, WHITE);
    tr('Prepared ' + pdate(f.prepared_at) + (f.prepared_by_name ? ' by ' + f.prepared_by_name : ''), W - M, H - 53, 8, reg, HEADT);
    tr((f.project_name || 'Awami Market') + (f.sale_number ? '  -  Sale ' + f.sale_number : ''), W - M, H - 66, 8, reg, HEADT);
    y = H - 104;

    // ── where the form stands ──────────────────────────────────────────────
    var state, sc, st;
    if (f.status === 'superseded') { state = 'SUPERSEDED by ' + (f.superseded_by_no || 'a newer form') + ' - not valid'; sc = RED; st = REDT; }
    else if (f.status === 'approved' && f.approval_route === 'director') { state = 'APPROVED - digitally signed by ' + f.approved_by_name + ', ' + pdate(f.approved_at, true); sc = GREEN; st = TEALT; }
    else if (f.status === 'approved') { state = 'APPROVED - ' + (disc > 0 ? 'discount of ' + pnum(disc) + ' given' : 'full list price') + ', sale made on submit - ' + pdate(f.approved_at, true); sc = GREEN; st = TEALT; }
    else if (f.status === 'rejected') { state = 'DECLINED by ' + f.rejected_by_name + ': ' + String(f.reject_reason || '').slice(0, 70); sc = RED; st = REDT; }
    else if (f.status === 'submitted' || f.status === 'verified') { state = 'SUBMITTED - ' + pdate(f.submitted_at, true); sc = AMBER; st = AMBERT; }
    else if (f.status === 'cancelled') { state = 'CANCELLED - not valid'; sc = RED; st = REDT; }
    else { state = 'DRAFT - not submitted yet; figures as of ' + pdate(f.money_as_of || f.updated_at || f.prepared_at, true); sc = AMBER; st = AMBERT; }
    box(M, y - 7, CW, 21, st); box(M, y - 7, 3, 21, sc); t(fit(state, CW - 20, 8.5, bold), M + 10, y, 8.5, bold, sc); y -= 24;

    // ── the unit ───────────────────────────────────────────────────────────
    head('Unit');
    box(M, y - 23, CW, 37, SOFT, LINE, 0.6); y -= 1;
    cells([['Unit no.', f.unit_code, INK], ['Floor', f.floor_label], ['Block', f.block], ['Total area', (f.area_sqft != null ? pnum(f.area_sqft) : '-') + ' sq ft', INK],
           ['Rate per sq ft', pnum(f.rate_per_sqft), INK], ['Payment plan', planName]], 6, M + 6, CW - 12);
    y -= 2;

    // ── the price: list, discount, final, then the down payment ───────────
    head('Price', 'All amounts in PKR');
    var gap = 8, kw = (CW - 3 * gap) / 4, kh = 46, ky = y - kh + 10;
    function kpi(i, label, val, sub, fill, vcol, border) { var x = M + i * (kw + gap);
      box(x, ky, kw, kh, fill, border || LINE, border ? 1 : 0.6);
      t(label, x + 9, ky + kh - 13, 6.8, bold, vcol === WHITE ? HEADT : MUTE);
      var sz = 14; while (sz > 9 && tw(val, sz, bold) > kw - 18) sz -= 0.5;
      t(val, x + 9, ky + 16, sz, bold, vcol || INK);
      if (sub) t(fit(sub, kw - 18, 6.8), x + 9, ky + 6, 6.8, reg, vcol === WHITE ? HEADT : MUTE); }
    kpi(0, 'BASE PRICE', pnum(f.base_price), (f.area_sqft != null ? pnum(f.area_sqft) : '-') + ' x ' + pnum(f.rate_per_sqft), WHITE);
    kpi(1, 'DISCOUNT', disc > 0 ? '- ' + pnum(disc) : '0', disc > 0 ? (Math.round(Number(f.discount_pct || 0) * 100) / 100) + '% off' + (f.discount_beyond_standard ? ', beyond the plan' : '') : 'No discount',
        disc > 0 ? REDT : WHITE, disc > 0 ? RED : INK);
    kpi(2, 'FINAL PRICE', pnum(net), 'Net to be paid', BRAND, WHITE);
    kpi(3, 'DOWN PAYMENT ' + dpPct + '%', pnum(f.dp_amount), 'Due on booking', AMBERT, AMBER);
    y = ky - 10;
    // received vs the down payment, as a bar
    var bx = M, bwd = CW, frac = Number(f.dp_amount) > 0 ? Math.max(0, Math.min(1, recv / Number(f.dp_amount))) : 0;
    t('Received so far', bx, y, 7.5, reg, MUTE); t(pnum(recv), bx + 62, y, 9, bold, TEAL);
    var dpTxt = dpBal > 0 ? 'Down payment still due  ' + pnum(dpBal) : 'Down payment fully received';
    tr(dpTxt, W - M, y, 9, bold, dpBal > 0 ? RED : GREEN);
    y -= 9; box(bx, y - 4, bwd, 6, LINE); if (frac > 0) box(bx, y - 4, bwd * frac, 6, TEAL);
    y -= 12;
    t('Balance after the down payment: ' + pnum(Math.max(0, net - Number(f.dp_amount || 0))) + '   -   Total still to receive: ' + pnum(Math.max(0, net - recv)),
      bx, y, 7.5, reg, MUTE); y -= 4;
    if (disc > 0 && f.discount_reason) { y -= 11; t(fit('Discount reason: ' + f.discount_reason, CW, 7.5), M, y, 7.5, reg, RED); y -= 6; }

    // ── the buyer, with photos ────────────────────────────────────────────
    head('Client');
    var PW = 56, PH = 68, PG = 8, ptop = y + 8, px = W - M - 2 * PW - PG;
    var phB = await embedPhoto(doc, await photoBytes(f.buyer_photo_url)),
        phN = await embedPhoto(doc, await photoBytes(f.nominee_photo_url));
    [[phB, 'BUYER', px], [phN, 'NOMINEE', px + PW + PG]].forEach(function (b) {
      box(b[2], ptop - PH, PW, PH, SOFT, LINE, 0.6);
      if (b[0]) { var k = Math.min(PW / b[0].width, PH / b[0].height), iw = b[0].width * k, ih = b[0].height * k;
        // the whole picture, centred in its frame
        page.drawImage(b[0], { x: b[2] + (PW - iw) / 2, y: ptop - PH + (PH - ih) / 2, width: iw, height: ih }); }
      else t('No photo', b[2] + (PW - tw('No photo', 7)) / 2, ptop - PH / 2 - 3, 7, reg, MUTE);
      t(b[1], b[2] + (PW - tw(b[1], 6.2, bold)) / 2, ptop - PH - 8, 6.2, bold, MUTE); });
    var bwid = px - M - 10;
    cells([['Name', f.buyer_name, INK], [(f.buyer_relation || 'S/O') + ' (father / husband)', f.buyer_father], ['CNIC', f.buyer_cnic],
           ['Phone', f.buyer_phone], ['Address', f.buyer_address],
           ['Nominee', f.nominee && f.nominee.name ? f.nominee.name + (f.nominee.relation ? ' (' + f.nominee.relation + ')' : '') + (f.nominee.cnic ? ' ' + f.nominee.cnic : '') : '']], 3, M, bwid);
    // full width, and only when there is one: forms approved before 20261024a
    // must draw to the same bytes as their recorded fingerprint
    if (f.nominee && f.nominee.name && f.nominee.address) cells([['Nominee address', f.nominee.address]], 1, M, bwid);
    if (f.buyer_name_reason) { t(fit('Not the name on the hold (' + (f.reservation_buyer_name || '') + '): ' + f.buyer_name_reason, bwid, 7.5), M + 2, y + 1, 7.5, reg, RED); y -= 10; }
    y = Math.min(y, ptop - PH - 16);

    // ── who asked, who held it, who sold it ───────────────────────────────
    head('Booking and sale');
    var cchg = Number(f.commission_pct || 0) !== Number(f.commission_standard_pct || 0);
    cells([['Requested by', hold.requested_by || f.reservation_buyer_name, INK], ['Held on', hold.held_at ? pdate(hold.held_at) : ''],
           ['Held at the desk by', hold.reserved_by], ['Hold tag', hold.tag],
           ['Sold by (agent)', f.agent_name, INK], ['Sub-agent', f.sub_agent_name], ['Sale date', pdate(f.sale_date)],
           ['Commission', (f.commission_pct || 0) + '% = ' + pnum(f.commission_amount) + (cchg ? ' (std ' + (f.commission_standard_pct || 0) + '%)' : ''), cchg ? RED : null]], 4);
    if (cchg && f.commission_reason) { t(fit('Commission changed because: ' + f.commission_reason, CW, 7.5), M + 2, y + 1, 7.5, reg, RED); y -= 10; }

    // ── every receipt, with its reference ─────────────────────────────────
    head('Amount received', f.token_numbers ? 'Token ' + f.token_numbers : 'From NexuFinance');
    var cx = [M + 6, M + 72, M + 150, M + 228, M + 270], rh = 14;
    box(M, y - 4, CW, rh, BRAND);
    [['Date', 0], ['Voucher no.', 1], ['Reference', 2], ['Mode', 3], ['Received from', 4]].forEach(function (h) { t(h[0], cx[h[1]], y, 7, bold, WHITE); });
    tr('Amount', W - M - 6, y, 7, bold, WHITE); y -= rh;
    var rc = f.receipts || [], shown = rc.slice(0, 9);
    shown.forEach(function (x, i) {
      if (i % 2) box(M, y - 4, CW, rh, SOFT);
      t(pdate(x.date), cx[0], y, 8); t(fit(x.voucher_no || '-', 74, 8, bold), cx[1], y, 8, bold);
      t(fit(x.system_no && x.system_no !== x.voucher_no ? x.system_no : '-', 74, 8), cx[2], y, 8, reg, MUTE);
      t(x.mode || '-', cx[3], y, 8); t(fit(x.party || '-', W - M - 70 - cx[4], 8), cx[4], y, 8);
      tr(pnum(x.amount), W - M - 6, y, 8, bold); y -= rh; });
    if (rc.length > shown.length) { t('+ ' + (rc.length - shown.length) + ' more receipt(s); the total includes them', cx[0], y, 7.5, reg, MUTE); y -= rh; }
    if (!rc.length) { t('No money booked to this unit in NexuFinance yet.', cx[0], y, 8, reg, MUTE); y -= rh; }
    box(M, y - 5, CW, rh + 2, TEALT); hline(M, W - M, y + rh - 3, TEAL, 0.8);
    t('Total received', cx[0], y, 9, bold, TEAL); tr(pnum(recv), W - M - 6, y, 9.5, bold, TEAL); y -= rh + 2;

    // ── the schedule in one line ──────────────────────────────────────────
    head('Payment schedule', planName + ((PLAN[f.plan_type] || [])[1] ? ' - ' + PLAN[f.plan_type][1] : ''));
    var s = f.schedule_json || [], inst = s.filter(function (x) { return x.installment_type === 'installment'; }),
        pos = s.filter(function (x) { return x.installment_type === 'possession'; });
    var amt = inst.length ? inst[0].amount_due : 0, lastAmt = inst.length ? inst[inst.length - 1].amount_due : 0;
    cells([['Down payment (' + dpPct + '%)', pnum(f.dp_amount), INK],
           ['Installments', inst.length ? inst.length + ' x ' + pnum(amt) + (lastAmt !== amt ? ' (last ' + pnum(lastAmt) + ')' : '') : 'None'],
           ['First / last due', inst.length ? pdate(inst[0].due_date) + ' - ' + pdate(inst[inst.length - 1].due_date) : ''],
           ['On possession', pos.length ? pnum(pos[0].amount_due) + ' on ' + pdate(pos[0].due_date) : '']], 4);
    if (f.plan_type === 'custom') { t('Custom schedule: ' + s.length + ' payments, total ' + pnum(net), M + 2, y + 6, 7.5, reg, RED); y -= 4; }

    // ── signatures: the agent signs the paper; Accounts is recorded ───────
    var sgy = Math.min(y - 8, 150), bw = (CW - 2 * 10) / 3, bh = 62;
    [['Agent', f.agent_name, null],
     ['Prepared by (Accounts)', f.accounts_verified_by_name || f.submitted_by_name || f.prepared_by_name, f.accounts_verified_at || f.submitted_at],
     f.approval_route === 'director' && f.approved_by_name ? ['Approved by (Director)', f.approved_by_name, f.approved_at]
                                                           : ['Checked and filed by', f.filed_by_name, f.filed_at]]
      .forEach(function (b, i) { var x = M + i * (bw + 10), on = !!b[2];
        box(x, sgy - bh, bw, bh, on ? TEALT : WHITE, on ? TEAL : LINE, on ? 0.9 : 0.6);
        t(b[0].toUpperCase(), x + 9, sgy - 13, 6.8, bold, MUTE);
        if (on) t('RECORDED IN RMS', x + 9, sgy - 26, 7, bold, TEAL);
        hline(x + 9, x + bw - 9, sgy - bh + 22, LINE, 0.6);
        t(fit(b[1] || '', bw - 18, 8.5, on ? bold : reg), x + 9, sgy - bh + 11, 8.5, on ? bold : reg);
        t(b[2] ? pdate(b[2], true) : 'Signature and date', x + 9, sgy - bh + 3, 6.5, reg, MUTE); });

    // ── footer ─────────────────────────────────────────────────────────────
    hline(M, W - M, 46, LINE, 0.6);
    t('Fingerprint (sha256): ' + (f.snapshot_hash || 'issued when the form is submitted'), M, 35, 6.5, reg, MUTE);
    t('Locked once submitted. Any change needs a new Sale Approval Form that supersedes this one.', M, 25, 7, bold, MUTE);
    tr((f.saf_no || '') + '  -  ' + (f.unit_code || ''), W - M, 25, 7, bold, BRAND);
    doc.setTitle((f.saf_no || 'SAF') + ' - ' + (f.unit_code || ''), { showInWindowTitleBar: false });
    return doc.save({ useObjectStreams: false });
  }
  async function sha256(bytes) {
    var d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  window.SafPdf = { build: buildPdf, sha256: sha256 };
})();
