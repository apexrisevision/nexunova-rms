/* ══ Team report → PDF ═══════════════════════════════════════════════════════
   The same report the screen shows, as an A4 sheet a director can forward or
   file. Two documents, from the same data the screen already has in hand:

     · the TEAM sheet — one row per member for the window, sorted the way the
       screen sorts them, with the period's totals on top
     · a MEMBER sheet — their headline numbers, what became of the leads they
       were given, a day-by-day column chart, and their full written history

   Built with the vendored pdf-lib (vendor/pdf-lib.min.js) — the same one the
   quote PDF uses. No CDN, nothing to fetch at print time.

   Everything is drawn, not screenshotted: text stays selectable and searchable,
   and the file stays a few tens of KB instead of a megabyte of image.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PW = 841.89, PH = 595.28, M = 36;          // A4 LANDSCAPE — a team table is wide
  var PWP = 595.28, PHP = 841.89;                // A4 portrait for the member sheet

  /* Helvetica is WinAnsi. A name in Urdu script would throw inside pdf-lib and
     take the whole document down, so anything it cannot encode degrades to '?'
     rather than losing the report. Same rule as the quote PDF. */
  var FOLD = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"',
               '•': '-', '₨': 'PKR', '…': '...', '·': '-' };
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
  function money(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function dmy(s) {
    if (!s) return '-';
    var p = String(s).slice(0, 10).split('-');
    if (p.length < 3 || !MON[+p[1] - 1]) return String(s);
    return (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0];
  }
  function clock(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-GB',
      { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })
      .replace(',', '');
  }

  /* Wrap on width, not on a character count — a monospace guess breaks on real
     names and on a note that is one long sentence. */
  function wrap(text, font, size, width) {
    var words = safe(text).split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + ' ' + words[i] : words[i];
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) lines.push(line);
      // a single word longer than the column still has to land somewhere
      var w = words[i];
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        var cut = w.length;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        lines.push(w.slice(0, cut)); w = w.slice(cut);
      }
      line = w;
    }
    if (line) lines.push(line);
    return lines;
  }

  async function make(d, opts) {
    var L = window.PDFLib;
    if (!L) throw new Error('The PDF library did not load.');
    var member = opts && opts.member;
    var landscape = !member;
    var W = landscape ? PW : PWP, H = landscape ? PH : PHP;

    var INK  = L.rgb(0.06, 0.09, 0.16), MUTE = L.rgb(0.42, 0.45, 0.51),
        LINE = L.rgb(0.87, 0.89, 0.92), BAND = L.rgb(0.96, 0.97, 0.99),
        ACC  = L.rgb(0.31, 0.27, 0.90),
        WON  = L.rgb(0.082, 0.502, 0.239),   // the validated report palette,
        MISS = L.rgb(0.929, 0.631, 0.000),   // carried over so paper and screen
        LOST = L.rgb(0.784, 0.118, 0.118),   // tell the same story
        REST = L.rgb(0.58, 0.64, 0.72);

    var doc = await L.PDFDocument.create();
    var reg = await doc.embedFont(L.StandardFonts.Helvetica);
    var bold = await doc.embedFont(L.StandardFonts.HelveticaBold);

    var p = null, y = 0, pageNo = 0;
    function T(t, x, yy, sz, f, c) { p.drawText(safe(t), { x: x, y: yy, size: sz, font: f || reg, color: c || INK }); }
    function TR(t, xr, yy, sz, f, c) { T(t, xr - (f || reg).widthOfTextAtSize(safe(t), sz), yy, sz, f, c); }
    function rule(yy, c) { p.drawRectangle({ x: M, y: yy, width: W - 2 * M, height: 0.7, color: c || LINE }); }
    function box(x, yy, w, h, c) { p.drawRectangle({ x: x, y: yy, width: w, height: h, color: c }); }

    var title = member ? safe(member.name) : 'Team report';
    var sub = (d.days === 1 ? dmy(d.from) : dmy(d.from) + '  to  ' + dmy(d.to)) +
              '   ' + d.days + ' day' + (d.days === 1 ? '' : 's') +
              (opts && opts.project ? '   ' + opts.project : '') +
              (opts && opts.company ? '   ' + opts.company : '');

    function newPage() {
      p = doc.addPage([W, H]); pageNo++;
      y = H - M;
      T(title, M, y - 13, 14, bold, INK);
      TR('NEXUNOVA', W - M, y - 12, 8.5, bold, MUTE);
      T(sub, M, y - 27, 8.5, reg, MUTE);
      // Karachi, like everything else in this report: a UTC date prints
      // yesterday for the last five hours of every working day
      TR('Printed ' + dmy(new Date(Date.now() + 5 * 3600000).toISOString()), W - M, y - 27, 8, reg, MUTE);
      rule(y - 36);
      y -= 52;
    }
    function room(need) { if (y - need < M + 22) { newPage(); return true; } return false; }

    newPage();

    // ── the numbers that lead ────────────────────────────────────────────────
    var t = d.totals || {};
    /* The sheet carries everything the screen carries — the member view shows
       eight tiles, so the paper shows eight, in two rows of four. A printed
       report that quietly drops half the numbers is worse than no printout: the
       person reading it has no way to know something is missing. */
    var tiles = member
      ? [['Given in period', member.given || 0], ['Reached', member.contacted || 0],
         ['Won', member.won_of_given || 0], ['Conversion', (member.conversion || 0) + '%'],
         ['Holding now', member.open_leads || 0],
         ['Status moved', member.status_changes || 0],
         ['Never opened', member.never_opened_of_given || 0],
         ['Overdue', member.overdue || 0]]
      : [['Members', t.members || 0], ['Worked', t.worked || 0], ['Silent', t.silent || 0],
         ['Given in period', t.given || 0], ['People reached', t.contacted || 0],
         ['Calls', t.calls || 0], ['WhatsApp', t.whatsapp || 0],
         ['Status moved', t.status_changes || 0]];
    var perRow = member ? 4 : tiles.length;
    var tw = (W - 2 * M) / perRow;
    tiles.forEach(function (k, i) {
      var row = Math.floor(i / perRow), col = i % perRow;
      var x = M + col * tw, ty = y - row * 40;
      box(x, ty - 34, tw - 6, 34, BAND);
      T(String(k[0]).toUpperCase(), x + 8, ty - 13, 6.5, bold, MUTE);
      T(String(k[1]), x + 8, ty - 28, 13, bold, INK);
    });
    y -= 16 + Math.ceil(tiles.length / perRow) * 40;

    if (!member) {
      // ══ TEAM SHEET ════════════════════════════════════════════════════════
      var cols = [
        ['Member',        M,             186, 'l'],
        ['Given*',        M + 190,        44, 'r'],
        ['Reached',       M + 238,        48, 'r'],
        ['Calls',         M + 290,        40, 'r'],
        ['WhatsApp',      M + 334,        52, 'r'],
        ['Visits',        M + 390,        40, 'r'],
        ['Notes',         M + 434,        40, 'r'],
        ['Status',        M + 478,        44, 'r'],
        ['Won',           M + 526,        38, 'r'],
        ['Conv.',         M + 568,        44, 'r'],
        ['Days',          M + 616,        40, 'r'],
        ['Never opened',  M + 660,        70, 'r'],
        ['Overdue',       M + 734,        52, 'r']
      ];
      function header() {
        box(M, y - 15, W - 2 * M, 16, BAND);
        cols.forEach(function (c) {
          if (c[3] === 'r') TR(c[0], c[1] + c[2], y - 11, 7, bold, MUTE);
          else T(c[0], c[1], y - 11, 7, bold, MUTE);
        });
        y -= 20;
      }
      header();
      var ms = d.members || [];
      ms.forEach(function (m, i) {
        if (room(16)) header();
        if (i % 2) box(M, y - 12, W - 2 * M, 14, L.rgb(0.985, 0.987, 0.992));
        var vals = [m.name, m.given || 0, m.contacted || 0, m.calls || 0, m.whatsapp || 0,
                    m.visits || 0, m.notes || 0, m.status_changes || 0, m.won_of_given || 0,
                    (m.conversion || 0) + '%', m.active_days || 0,
                    m.never_opened_of_given || 0, m.overdue || 0];
        cols.forEach(function (c, k) {
          var quiet = !m.entries && k === 0;
          if (c[3] === 'r') TR(String(vals[k]), c[1] + c[2], y - 8, 7.5, reg, INK);
          else T(String(vals[k]), c[1], y - 8, 7.5, quiet ? reg : bold, quiet ? MUTE : INK);
        });
        y -= 14;
      });
      if (!ms.length) T('Nobody reports to you yet.', M, y - 10, 9, reg, MUTE);
      y -= 4;
      T('* Given = leads handed over inside these dates. A member who was given their leads earlier ' +
        'reads 0 here and is still working a full pile.', M, y - 10, 7, reg, MUTE);
      y -= 10;
      y -= 6;
      rule(y);
      y -= 14;
      T('Rows in grey names recorded nothing in this period.', M, y, 7, reg, MUTE);
    } else {
      // ══ MEMBER SHEET ══════════════════════════════════════════════════════
      var given = member.given || 0;
      if (given) {
        T('What became of the leads they were given', M, y, 9.5, bold, INK); y -= 14;
        var parts = [['Won', member.won_of_given || 0, WON],
                     ['Never opened', member.never_opened_of_given || 0, MISS],
                     ['Lost', member.lost_of_given || 0, LOST]];
        var acc = parts.reduce(function (n, q) { return n + q[1]; }, 0);
        parts.push(['Still working', Math.max(0, given - acc), REST]);
        parts = parts.filter(function (q) { return q[1] > 0; });
        var bx = M, bw = W - 2 * M;
        parts.forEach(function (q) {
          var w = (q[1] / given) * bw;
          box(bx, y - 13, Math.max(w - 2, 1), 13, q[2]);
          bx += w;
        });
        y -= 20;
        var lx = M;
        parts.forEach(function (q) {
          box(lx, y - 6, 6, 6, q[2]);
          T(q[0] + ' ' + q[1], lx + 10, y - 5, 7.5, reg, INK);
          lx += reg.widthOfTextAtSize(safe(q[0] + ' ' + q[1]), 7.5) + 26;
        });
        y -= 22;
      }

      var days = (d.by_day || []).slice().reverse();
      if (days.length) {
        room(96);
        T('Activity across the period', M, y, 9.5, bold, INK); y -= 6;
        var peak = days.reduce(function (n, x) { return Math.max(n, x.entries || 0); }, 0) || 1;
        var cw = (W - 2 * M) / days.length, ch = 54;
        days.forEach(function (x, i) {
          var hh = (x.entries / peak) * ch;
          if (hh > 0) box(M + i * cw, y - ch, Math.max(cw - 1.5, 1), Math.max(hh, 1.2), ACC);
        });
        p.drawRectangle({ x: M, y: y - ch - 1, width: W - 2 * M, height: 0.6, color: LINE });
        y -= ch + 12;
        T(dmy(days[0].day), M, y, 7, reg, MUTE);
        TR(dmy(days[days.length - 1].day) + '   busiest ' + peak, W - M, y, 7, reg, MUTE);
        y -= 16;
      }

      /* How they worked ---------------------------------------------------
         The screen breaks the period down by kind of action, and that is the
         answer to the owner's real question. A bare total of 40 entries says
         nothing; 31 calls and 2 notes says a great deal, and so does the same
         number the other way round. */
      var kinds = [['Calls', member.calls || 0], ['WhatsApp', member.whatsapp || 0],
                   ['Visits', member.visits || 0], ['Notes', member.notes || 0],
                   ['Status moves', member.status_changes || 0]];
      var kpeak = kinds.reduce(function (n, k) { return Math.max(n, k[1]); }, 0);
      if (kpeak) {
        room(34 + kinds.length * 15);
        T('How they worked', M, y, 9.5, bold, INK);
        T('every action they recorded, by kind', M, y - 11, 7, reg, MUTE);
        y -= 24;
        var lw = 68, track = W - 2 * M - lw - 30;
        kinds.forEach(function (k) {
          T(k[0], M, y - 8, 7.5, reg, INK);
          box(M + lw, y - 10.5, track, 8, BAND);
          if (k[1]) box(M + lw, y - 10.5, Math.max((k[1] / kpeak) * track, 1.5), 8, ACC);
          TR(String(k[1]), W - M, y - 8, 7.5, bold, INK);
          y -= 15;
        });
        y -= 8;
      }

      /* The same days, as figures. The column chart above carries the shape;
         paper has no tooltip to hover, so the numbers go down too. */
      var busy = days.filter(function (x) { return (x.entries || 0) > 0; });
      if (days.length > 1 && busy.length) {
        room(30 + Math.ceil(busy.length / 2) * 13);
        T('Day by day', M, y, 9.5, bold, INK); y -= 17;
        var halfw = (W - 2 * M) / 2;
        busy.forEach(function (x, i) {
          if (i && i % 2 === 0) { y -= 13; room(26); }
          var cx = M + (i % 2) * halfw;
          T(dmy(x.day), cx, y, 7.5, reg, INK);
          TR(x.contacted + ' reached  ' + x.entries + ' entr' + (x.entries === 1 ? 'y' : 'ies'),
             cx + halfw - 16, y, 7.5, reg, MUTE);
        });
        y -= 22;
      }

      var es = d.entries || [];
      room(40);
      T('Everything they did  ' + (d.entries_total || es.length) +
        (d.entries_capped ? '   (latest ' + es.length + ' shown)' : ''), M, y, 9.5, bold, INK);
      y -= 6; rule(y); y -= 14;
      var KIND = { call: 'Called', whatsapp: 'WhatsApp', visit: 'Visit', meeting: 'Meeting',
                   note: 'Note', stage: 'Status', assigned: 'Assigned' };
      es.forEach(function (e) {
        var body = e.body ? wrap(e.body, reg, 8, W - 2 * M - 176) : [];
        room(12 + body.length * 10);
        T(clock(e.at), M, y, 7.5, reg, MUTE);
        T(KIND[e.kind] || e.kind, M + 70, y, 7.5, bold, ACC);
        T(e.lead || '-', M + 128, y, 8, bold, INK);
        // the outcome is what came of the call; the screen shows it, so paper does too
        var tail = [];
        if (e.outcome) tail.push(e.outcome);
        if (e.project) tail.push(e.project);
        if (tail.length) TR(tail.join('  ·  '), W - M, y, 7, reg, MUTE);
        y -= 10;
        body.forEach(function (ln) { T(ln, M + 128, y, 8, reg, INK); y -= 10; });
        y -= 2;
      });
      if (!es.length) T('Nothing recorded in this period.', M, y, 8.5, reg, MUTE);
    }

    // page numbers, once the count is known
    var all = doc.getPages();
    all.forEach(function (pg, i) {
      pg.drawText(safe('Page ' + (i + 1) + ' of ' + all.length),
        { x: W - M - 52, y: M - 12, size: 7, font: reg, color: MUTE });
    });
    return { bytes: await doc.save(), pages: all.length };
  }

  function download(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 5000);
    return url;
  }

  window.ReportPDF = { make: make, download: download, safe: safe };
})();
