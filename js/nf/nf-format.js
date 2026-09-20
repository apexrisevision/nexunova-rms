/**
 * NexuFinance v1 — formatting. window.NfFmt.
 *
 * Money: numeric(14,2) end to end (owner, 2026-09-16 — NOT whole rupees).
 * A value is shown with two decimals only when it actually carries paisa;
 * everything else prints the way docs/reference/awami-daily-closing.html
 * does. Grouping is Western (en-US), same as the rest of the platform
 * (see rms_payments memory: en-PK and en-US are both Western; only en-IN
 * is lakh/crore, and that was removed app-wide in June — except the
 * Lakh/Crore *words* helper below, which the owner asked to keep).
 */
(function (global) {
  'use strict';

  function n(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var x = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(x) ? x : 0;
  }

  function hasPaisa(abs) {
    // guard against float noise: 313000.0000000001
    return Math.round(abs * 100) % 100 !== 0;
  }

  // fmt(): the reference's "–" for zero, parentheses for negative, otherwise
  // grouped. Two decimals only when the value carries paisa.
  function fmt(v) {
    var x = n(v);
    var r = Math.round(x * 100) / 100;
    if (r === 0) return '–';
    var abs = Math.abs(r);
    var s = hasPaisa(abs)
      ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : abs.toLocaleString('en-US');
    return (r < 0 ? '(' : '') + s + (r < 0 ? ')' : '');
  }

  // grp(): what an input shows after you leave it — grouped, no currency
  // symbol, blank stays blank (blank is never a zero — R8).
  function grp(v) {
    if (v === '' || v === null || v === undefined) return '';
    var x = n(v);
    if (x === 0 && String(v).trim() === '') return '';
    var abs = Math.abs(x);
    var s = hasPaisa(abs)
      ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : abs.toLocaleString('en-US');
    return (x < 0 ? '-' : '') + s;
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function w99(x) { return x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? ' ' + ONES[x % 10] : ''); }
  function w999(x) { var h = Math.floor(x / 100), r = x % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? w99(r) : ''); }
  // Amount in words, Lakh/Crore — kept per the owner (2026-09-16), even though
  // the rest of the platform uses Western grouping for figures.
  function words(v) {
    var x = Math.round(Math.abs(n(v)));
    if (!x) return 'Zero';
    var parts = [];
    var cr = Math.floor(x / 1e7); x %= 1e7;
    var lk = Math.floor(x / 1e5); x %= 1e5;
    var th = Math.floor(x / 1e3); x %= 1e3;
    if (cr) parts.push((cr > 999 ? words(cr) : w999(cr)) + ' Crore');
    if (lk) parts.push(w99(lk) + ' Lakh');
    if (th) parts.push(w99(th) + ' Thousand');
    if (x) parts.push(w999(x));
    return parts.join(' ');
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // dd-Mon-yyyy, for filenames and the doc footer stamp.
  function ddMonYyyy(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00');
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(d.getDate()).padStart(2, '0') + '-' + MON[d.getMonth()] + '-' + d.getFullYear();
  }

  function weekday(dateStr) {
    if (!dateStr) return '–';
    return new Date(dateStr + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' });
  }

  function longDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // The letterhead, shared by all fourteen screens so the brand cannot drift
  // between the daily closing and the statements a bank might see.
  //
  // An <img>, NOT a CSS background, deliberately: every one of these screens
  // is meant to be printed or saved as a PDF, and browsers drop background
  // images from print unless the person happens to tick "Background graphics"
  // — the logo would disappear from exactly the documents that most need it.
  //
  // `mark` is nf_settings.mark, the company's own short code, which used to BE
  // the badge. It stays as the alt text so the page still identifies itself if
  // the file is ever missing, and so screen readers hear the company rather
  // than "image".
  // The width/height attributes are not decoration — they are what stops the
  // header jumping. Without them an <img> sized by CSS height with width:auto
  // occupies ZERO width until the bits arrive, then snaps to ~170px. Every
  // render() rebuilds the header, so that shift repeated on every redraw:
  // visible jitter for a person, and enough movement under automation to
  // knock a click off its target (it broke two golden-day runs before this
  // was added). The attributes let the browser reserve the right 4:1 box from
  // the first paint; the CSS still decides the actual size.
  var LOGO = 'assets/awami-logo.png?v=20260919q';
  function brandMark(mark) {
    return '<img class="mark" src="' + LOGO + '" width="800" height="200" ' +
      'alt="' + esc(mark || 'Awami Market') + '">';
  }

  global.NfFmt = { n: n, fmt: fmt, grp: grp, words: words, esc: esc, ddMonYyyy: ddMonYyyy, weekday: weekday, longDate: longDate, brandMark: brandMark };
})(window);
