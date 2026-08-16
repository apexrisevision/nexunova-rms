/* ══ Quote PDF — the sheet a rep hands the client ═══════════════════════════
   Its own file for the same reason the map got one: sales-portal.html is already
   8,500 lines and none of this belongs in it.

   Two pictures do the work a paragraph cannot:

     CROP     the unit cut out of the floor drawing at full resolution, with its
              own outline on top. "This is the flat."
     LOCATOR  the whole floor shrunk down, that one unit picked out in accent.
              "This is where it sits."

   Both are cut from the SAME artwork the viewer renders, at the SAME normalised
   coordinates the editor stored, so a client can hold the PDF against the map on
   the rep's phone and see the identical shape.

   Money is never computed here. Every figure comes from the saved quote row —
   save_unit_quote already snapshotted it — so a quote reprinted in six months
   still shows what was actually promised, not what the rate card says today.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PAD    = 0.09;          // padding round the crop, as a share of the unit's long side
  var ACCENT = [37, 99, 235]; // #2563EB — the one accent, same as everywhere else

  // ── text that a PDF standard font can actually encode ────────────────────
  // Helvetica is WinAnsi. A name in Urdu script would throw inside pdf-lib and
  // lose the whole document, so unsupported characters degrade to '?' rather
  // than take the quote down with them.
  var FOLD = { '—': '-', '–': '-', '‘': "'", '’': "'",
               '“': '"', '”': '"', '•': '-', '₨': 'PKR', '…': '...' };
  function safe(s) {
    s = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i], k = s.charCodeAt(i);
      if (FOLD[c]) out += FOLD[c];
      else if ((k >= 32 && k <= 126) || (k >= 160 && k <= 255)) out += c;
      else out += '?';
    }
    return out;
  }
  // en-US grouping, always. lakh/crore was killed on 2026-06-08 and stays dead.
  function money(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dmy(s) {
    if (!s) return '-';
    var p = String(s).slice(0, 10).split('-');
    if (p.length < 3 || !MON[+p[1] - 1]) return String(s);
    return (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0];
  }

  // ── artwork → canvas ─────────────────────────────────────────────────────
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      // Only cross-origin artwork needs the CORS dance; a repo asset does not,
      // and asking for it there would fail on file:// during a desktop run.
      if (/^https?:/i.test(src) && src.indexOf(location.origin) !== 0) i.crossOrigin = 'anonymous';
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('Could not load the floor drawing.')); };
      i.src = src;
    });
  }
  function bbox(points) {
    var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    points.forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function tracePoly(ctx, points, W, H, offX, offY) {
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = p[0] * W - offX, y = p[1] * H - offY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  function paintUnit(ctx, points, W, H, offX, offY, lw) {
    tracePoly(ctx, points, W, H, offX, offY);
    ctx.fillStyle = 'rgba(' + ACCENT.join(',') + ',0.15)';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgb(' + ACCENT.join(',') + ')';
    ctx.stroke();
  }

  /* CROP — the unit at the drawing's own resolution.
     The source rectangle is clamped to the artwork, but the DESTINATION offset is
     not: a unit hard against the edge of the sheet still lands in the right place
     on the canvas, it just has white where the paper ran out. Sliding it instead
     would quietly print a crop of the neighbour. */
  function makeCrop(img, points, W, H) {
    var b = bbox(points);
    var bw = (b.x1 - b.x0) * W, bh = (b.y1 - b.y0) * H;
    var pad = PAD * Math.max(bw, bh);
    var rx = b.x0 * W - pad, ry = b.y0 * H - pad, rw = bw + 2 * pad, rh = bh + 2 * pad;

    var cv = document.createElement('canvas');
    cv.width = Math.round(rw); cv.height = Math.round(rh);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);

    var sx = Math.max(0, rx), sy = Math.max(0, ry);
    var sw = Math.min(W, rx + rw) - sx, sh = Math.min(H, ry + rh) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx - rx, sy - ry, sw, sh);

    paintUnit(ctx, points, W, H, rx, ry, Math.max(2, rw * 0.008));
    return { url: cv.toDataURL('image/png'), w: cv.width, h: cv.height, pad: pad };
  }

  /* LOCATOR — the whole floor, small, with the one unit lit up. */
  function makeLocator(img, points, W, H, outW) {
    outW = outW || 900;
    var s = outW / W;
    var cv = document.createElement('canvas');
    cv.width = Math.round(outW); cv.height = Math.round(H * s);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    // A veil over the sheet so the accent shape reads first at thumbnail size.
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    paintUnit(ctx, points, cv.width, cv.height, 0, 0, Math.max(2.5, cv.width * 0.006));
    return { url: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
  }

  // ── the document ─────────────────────────────────────────────────────────
  var PW = 595.28, PH = 841.89, M = 40;   // A4 portrait

  async function build(o) {
    var L = window.PDFLib;
    if (!L) throw new Error('The PDF library did not load.');
    var INK  = L.rgb(0.06, 0.09, 0.16), MUTE = L.rgb(0.42, 0.45, 0.51),
        LINE = L.rgb(0.87, 0.89, 0.92), ACC  = L.rgb(0.145, 0.388, 0.921),
        TINT = L.rgb(0.937, 0.957, 0.996), WARN = L.rgb(0.85, 0.47, 0.02);

    var doc  = await L.PDFDocument.create();
    var reg  = await doc.embedFont(L.StandardFonts.Helvetica);
    var bold = await doc.embedFont(L.StandardFonts.HelveticaBold);

    var q = o.quote, u = o.unit || {};
    var img = await loadImage(o.artwork.image_path);
    var W = img.naturalWidth || o.artwork.w, H = img.naturalHeight || o.artwork.h;
    var crop = makeCrop(img, o.points, W, H);
    var loc  = makeLocator(img, o.points, W, H);
    var cropPng = await doc.embedPng(crop.url), locPng = await doc.embedPng(loc.url);

    var pages = [], p = null, y = 0;
    function T(t, x, yy, sz, f, c) { p.drawText(safe(t), { x: x, y: yy, size: sz, font: f || reg, color: c || INK }); }
    function TR(t, xr, yy, sz, f, c) { T(t, xr - (f || reg).widthOfTextAtSize(safe(t), sz), yy, sz, f, c); }
    function rule(yy, c) { p.drawRectangle({ x: M, y: yy, width: PW - 2 * M, height: 0.7, color: c || LINE }); }
    function newPage(cont) {
      p = doc.addPage([PW, PH]); pages.push(p);
      y = PH - M;
      if (cont) {
        T(safe(q.quote_no) + '  (continued)', M, y - 10, 9, bold, MUTE);
        TR(safe(o.project || '') + '  ·  Unit ' + safe(u.unit_no || ''), PW - M, y - 10, 9, reg, MUTE);
        rule(y - 20); y -= 36;
      }
      return p;
    }

    // ── page 1 header ──
    newPage(false);
    T(o.project || 'Quotation', M, y - 14, 15, bold, INK);
    TR('QUOTATION', PW - M, y - 13, 9, bold, MUTE);
    T((u.floor_label || '') + '  ·  Unit ' + (u.unit_no || ''), M, y - 30, 9.5, reg, MUTE);
    TR(q.quote_no, PW - M, y - 30, 12.5, bold, ACC);
    TR('Dated ' + dmy(q.created_at), PW - M, y - 44, 8.5, reg, MUTE);
    rule(y - 56); y -= 74;

    // ── the two pictures ──
    var gap = 18, locW = 168;
    var cropW = (PW - 2 * M) - gap - locW;
    var cropH = cropW * crop.h / crop.w;
    if (cropH > 216) { cropH = 216; cropW = cropH * crop.w / crop.h; }
    var locH = locW * loc.h / loc.w;
    var top = y, band = Math.max(cropH, locH);

    p.drawImage(cropPng, { x: M, y: top - cropH, width: cropW, height: cropH });
    p.drawRectangle({ x: M, y: top - cropH, width: cropW, height: cropH,
                      borderColor: LINE, borderWidth: 0.8 });
    T('Unit ' + (u.unit_no || '') + ' — close up', M, top - cropH - 12, 8, reg, MUTE);

    var lx = PW - M - locW;
    p.drawImage(locPng, { x: lx, y: top - locH, width: locW, height: locH });
    p.drawRectangle({ x: lx, y: top - locH, width: locW, height: locH,
                      borderColor: LINE, borderWidth: 0.8 });
    T('Where it sits on the floor', lx, top - locH - 12, 8, reg, MUTE);
    y = top - band - 30;

    // ── the offer ──
    T('THE OFFER', M, y, 8, bold, MUTE); y -= 15;
    var colW = (PW - 2 * M - 25) / 2, rx2 = M + colW + 25;
    var left = [['Client', q.client_name], ['Phone', q.client_phone || '-'],
                ['Type', u.type || '-'],
                ['Area', u.area ? money(u.area) + ' sft' : '-'],
                ['Floor', u.floor_label || '-']];
    var right = [['List price', q.rate_pending ? 'Rate pending' : 'PKR ' + money(q.list_price)],
                 ['Discount', 'PKR ' + money(q.discount)],
                 ['Down payment', 'PKR ' + money(q.down_payment)],
                 ['Monthly', q.months ? 'PKR ' + money(q.monthly_amount) + '  × ' + q.months : '-'],
                 ['Plan starts', dmy(q.start_date)]];
    for (var i = 0; i < 5; i++) {
      var yy = y - i * 13.5;
      T(left[i][0], M, yy, 8.5, reg, MUTE);   TR(left[i][1], M + colW, yy, 9, reg, INK);
      T(right[i][0], rx2, yy, 8.5, reg, MUTE); TR(right[i][1], PW - M, yy, 9, reg, INK);
    }
    y -= 5 * 13.5 + 10;

    // Net payable — the one number the client will look for. With no rate set it
    // must NOT read "PKR 0": that is a promise of a free flat, not a missing price.
    var netTxt = (q.rate_pending && !Number(q.net_price)) ? 'Rate pending' : 'PKR ' + money(q.net_price);
    p.drawRectangle({ x: M, y: y - 24, width: PW - 2 * M, height: 26, color: TINT });
    T('Net payable', M + 12, y - 16, 10, bold, INK);
    TR(netTxt, PW - M - 12, y - 17, 13, bold, ACC);
    y -= 40;

    if (q.rate_pending) {
      T('Rate for this unit is not settled yet — the figures below are provisional.',
        M, y, 8.5, bold, WARN);
      y -= 16;
    }

    // ── schedule ──
    T('PAYMENT SCHEDULE', M, y, 8, bold, MUTE); y -= 13;
    var cN = M, cD = M + 34, cA = PW - M;
    function head() {
      T('#', cN, y, 8, bold, MUTE); T('Due', cD, y, 8, bold, MUTE); TR('Amount', cA, y, 8, bold, MUTE);
      rule(y - 5); y -= 17;
    }
    head();

    var rows = [];
    if (Number(q.down_payment) > 0) rows.push(['DP', 'On booking', Number(q.down_payment)]);
    (q.schedule || []).forEach(function (s) { rows.push([String(s.n), dmy(s.due), Number(s.amount)]); });
    if (!rows.length) rows.push(['—', 'No instalment plan on this quote', 0]);

    var total = 0;
    rows.forEach(function (r) {
      if (y < 96) { newPage(true); head(); }
      T(r[0], cN, y, 9, reg, MUTE);
      T(r[1], cD, y, 9, reg, INK);
      TR(r[2] ? 'PKR ' + money(r[2]) : '—', cA, y, 9, reg, INK);
      total += r[2];
      y -= 13.5;
    });
    if (y < 96) { newPage(true); }
    rule(y + 6);
    T('Total', cN, y - 8, 9.5, bold, INK);
    TR((q.rate_pending && !total) ? 'Rate pending' : 'PKR ' + money(total), cA, y - 8, 10.5, bold, INK);

    // ── footers, once the page count is finally known ──
    pages.forEach(function (pg, i) {
      p = pg;
      p.drawRectangle({ x: M, y: 62, width: PW - 2 * M, height: 0.7, color: LINE });
      T('This is a quotation, not a reservation — the unit stays on the shelf until it is booked.',
        M, 48, 8, reg, MUTE);
      TR('Page ' + (i + 1) + ' of ' + pages.length, PW - M, 48, 8, reg, MUTE);
      T('Valid until ' + dmy(q.valid_until) + (o.by ? '   ·   Prepared by ' + o.by : ''),
        M, 36, 8, reg, MUTE);
    });

    return { bytes: await doc.save(), crop: crop, locator: loc, pages: pages.length, total: total };
  }

  function download(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 5000);
    return url;
  }

  window.QuotePDF = { build: build, download: download, makeCrop: makeCrop, makeLocator: makeLocator };
})();
