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
    function pairs(list, cols, width) { cols = cols || 4; var cw = (width || (W - 2 * M)) / cols;
      for (var i = 0; i < list.length; i += cols) {
        for (var j = 0; j < cols && i + j < list.length; j++) { var p = list[i + j]; if (!p) continue;
          var fnt = p[2] ? bold : reg, sz = 10, v = String(p[1] == null ? '' : p[1]);
          while (sz > 7 && tw(v, sz, fnt) > cw - 8) sz -= 0.5;
          while (v.length > 4 && tw(v, sz, fnt) > cw - 8) v = v.slice(0, -2);
          t(p[0], M + j * cw + 4, y, 7, reg, MUTE); t(v, M + j * cw + 4, y - 11, sz, fnt, p[2] || INK); }
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
    else if (f.status === 'approved' && f.approval_route === 'plan') { state = 'APPROVED - full list price, no director approval needed - ' + pdate(f.approved_at, true); stateCol = GREEN; }
    else if (f.status === 'approved') { state = 'APPROVED - digitally signed by ' + f.approved_by_name + ' on ' + pdate(f.approved_at, true); stateCol = GREEN; }
    else if (f.status === 'rejected') { state = 'DECLINED by ' + f.rejected_by_name + ': ' + String(f.reject_reason || '').slice(0, 70); stateCol = RED; }
    else if (f.status === 'submitted' || f.status === 'verified') { state = 'AWAITING DIRECTOR APPROVAL (discount given) - not valid until signed'; stateCol = AMBER; }
    else { state = 'DRAFT - not submitted'; stateCol = AMBER; }
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
      pairs([['Discount reason (director approval needed)', String(f.discount_reason || '-').slice(0, 95), RED]], 1);

    head('Buyer');
    var PW = 60, PH = 74, PG = 8, ptop = y + 6, px = W - M - 2 * PW - PG;
    var phB = await embedPhoto(doc, await photoBytes(f.buyer_photo_url)),
        phN = await embedPhoto(doc, await photoBytes(f.nominee_photo_url));
    [[phB, 'BUYER', px], [phN, 'NOMINEE', px + PW + PG]].forEach(function (b) {
      page.drawRectangle({ x: b[2], y: ptop - PH, width: PW, height: PH, borderColor: LINE, borderWidth: 0.8 });
      if (b[0]) { var k = Math.min(PW / b[0].width, PH / b[0].height), iw = b[0].width * k, ih = b[0].height * k;
        // the whole picture, centred in its frame
        page.drawImage(b[0], { x: b[2] + (PW - iw) / 2, y: ptop - PH + (PH - ih) / 2, width: iw, height: ih }); }
      else t('No photo', b[2] + 12, ptop - PH / 2 - 3, 7, reg, MUTE);
      t(b[1], b[2] + (PW - tw(b[1], 6.5, bold)) / 2, ptop - PH - 9, 6.5, bold, MUTE); });
    var bwid = px - M - 8;
    pairs([['Name', f.buyer_name, INK], [f.buyer_relation || 'S/O', f.buyer_father], ['CNIC', f.buyer_cnic], ['Phone', f.buyer_phone],
           ['Address', f.buyer_address || '-'],
           f.nominee && f.nominee.name ? ['Nominee', f.nominee.name + ' (' + (f.nominee.relation || '') + ') ' + (f.nominee.cnic || '')] : ['Nominee', '-']], 2, bwid);
    if (f.buyer_name_reason) pairs([['Not the name on the hold (' + (f.reservation_buyer_name || '') + ')', f.buyer_name_reason, RED]], 1, bwid);
    y = Math.min(y, ptop - PH - 18);

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
    t('Payable: ' + f.commission_payable_when, M + 4, y + 1, 8, reg, MUTE); y -= 10;

    // the signatures: Accounts and the director are recorded; the agent signs the paper
    y -= 8; var bw = (W - 2 * M - 20) / 3, bh = 70;
    [['Agent', f.agent_name, null, false],
     ['Prepared (money confirmed)', f.accounts_verified_by_name || f.submitted_by_name, f.accounts_verified_at || f.submitted_at, true],
     ['Director (approved)', f.approval_route === 'plan' ? 'Not needed' : f.approved_by_name, f.approved_at, true]]
      .forEach(function (b, i) { var x = M + i * (bw + 10), signed = b[3] && b[2],
            byPlan = i === 2 && f.approval_route === 'plan' && b[2];
        page.drawRectangle({ x: x, y: y - bh, width: bw, height: bh, borderColor: signed ? GREEN : LINE, borderWidth: signed ? 1 : 0.8 });
        t(b[0].toUpperCase(), x + 8, y - 13, 7, bold, MUTE);
        if (byPlan) { t('FULL PRICE - NOT NEEDED', x + 8, y - 30, 8, bold, GREEN); }
        else if (signed) { t('DIGITALLY SIGNED', x + 8, y - 30, 8, bold, GREEN); }
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
  window.SafPdf = { build: buildPdf, sha256: sha256 };
})();
