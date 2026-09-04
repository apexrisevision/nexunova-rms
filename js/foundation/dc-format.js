/* ════════════════════════════════════════════════════════════════════════
   DAILY CLOSING — FORMATTERS  ·  BLUEPRINT §A7, §A11  ·  P5
   ────────────────────────────────────────────────────────────────────────
   window.DCFmt in the browser, module.exports under Node, so the unit tests
   run against the same code the screens use rather than a copy of it.

   MONEY (§A7). "Rs 1,234,567". Paisa shown ONLY when non-zero. Negatives in
   parentheses, never with a minus sign — an accountant reads (3) faster than
   -3 and cannot mistake it for a hyphen. Grouping is en-US: 12,345,678, NOT
   the lakh/crore 1,23,45,678 that en-IN produces. That is a standing RMS rule
   — see memory pkr_locale_en_in_not_en_pk — and it is asserted by the tests.

   TIME (§A7). Asia/Karachi, always, because the business date is Karachi's.
   Never the viewer's local zone and never UTC.
   ════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DCFmt = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var LOCALE = 'en-US';   // Western grouping. NOT en-IN.
  var TZ = 'Asia/Karachi';

  function _isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* Round half away from zero at 2dp, avoiding the float wobble that makes
     (1.005).toFixed(2) === "1.00". Works on the absolute value so negatives
     round symmetrically. */
  function round2(n) {
    if (!_isNum(n)) return 0;
    var s = n < 0 ? -1 : 1;
    return s * (Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100);
  }

  function group(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* money(n, opts)
       opts.prefix  — default 'Rs '. Pass '' for a bare figure in a table.
       opts.blank   — what an undefined/NaN value renders as. Default '—'.
       opts.forceSign — never used for display; kept out on purpose.       */
  function money(n, opts) {
    opts = opts || {};
    var prefix = opts.prefix === undefined ? 'Rs ' : opts.prefix;
    if (n === null || n === undefined || n === '' ||
        (typeof n === 'number' && !isFinite(n))) {
      return opts.blank === undefined ? '—' : opts.blank;
    }
    var v = typeof n === 'string' ? parseFloat(n) : n;
    if (!_isNum(v)) return opts.blank === undefined ? '—' : opts.blank;

    v = round2(v);
    var neg = v < 0;
    var abs = Math.abs(v);
    var whole = Math.floor(abs);
    var paisa = Math.round((abs - whole) * 100);
    if (paisa === 100) { whole += 1; paisa = 0; }   // 999.999 → 1000.00

    var out = prefix + group(String(whole));
    if (paisa !== 0) out += '.' + (paisa < 10 ? '0' + paisa : String(paisa));
    return neg ? '(' + out + ')' : out;
  }

  /* The bare number for a table cell — same rules, no "Rs". */
  function amount(n, opts) {
    opts = opts || {};
    opts.prefix = '';
    return money(n, opts);
  }

  /* A YYYY-MM-DD business date is a DATE, not an instant. Parsing it with
     new Date('2026-09-03') gives UTC midnight, which in Karachi is still the
     3rd — but the same string parsed as a local date in a negative-offset zone
     would be the 2nd. Build it from parts so it cannot drift. */
  function _fromISODate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  }

  function _parse(d) {
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    if (typeof d === 'string') {
      var iso = _fromISODate(d);
      if (iso) return iso;
      var t = new Date(d);
      return isNaN(t.getTime()) ? null : t;
    }
    return null;
  }

  /* dateLong  → "Thursday, 03 September 2026"   (§A12 header, §A13 PDF)
     dateShort → "03 Sep 2026"                   (tables, chips)          */
  function dateLong(d) {
    var t = _parse(d); if (!t) return '—';
    var p = new Intl.DateTimeFormat(LOCALE, {
      timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    }).formatToParts(t).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
    return p.weekday + ', ' + p.day + ' ' + p.month + ' ' + p.year;
  }

  function dateShort(d) {
    var t = _parse(d); if (!t) return '—';
    var p = new Intl.DateTimeFormat(LOCALE, {
      timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric'
    }).formatToParts(t).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
    return p.day + ' ' + p.month + ' ' + p.year;
  }

  /* time → "19:05" in Karachi, 24-hour, because a cash book is a log. */
  function time(d) {
    var t = _parse(d); if (!t) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(t);
  }

  function dateTime(d) {
    var t = _parse(d); if (!t) return '—';
    return dateShort(t) + ' ' + time(t);
  }

  /* Today in Karachi as YYYY-MM-DD — the front-end twin of _dc_today().
     Built from Intl parts, not from a UTC offset guess. */
  function todayPK() {
    var p = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    return p;   // en-CA yields YYYY-MM-DD
  }

  /* ── MoneyInput parsing ──────────────────────────────────────────────
     Accepts what a person types — separators, spaces, a stray Rs — and
     rejects letters outright rather than silently dropping them, so
     "12a3" does not become 123. Returns null when there is no number. */
  function parseMoney(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'number') return isFinite(s) ? round2(s) : null;
    var raw = String(s).trim();
    if (raw === '') return null;
    var neg = /^\(.*\)$/.test(raw);
    raw = raw.replace(/^\(|\)$/g, '').replace(/^Rs\.?\s*/i, '').replace(/[,\s]/g, '');
    if (raw === '') return null;
    if (!/^-?\d*\.?\d*$/.test(raw)) return null;      // any letter → null
    if (raw === '.' || raw === '-' || raw === '-.') return null;
    var v = parseFloat(raw);
    if (!isFinite(v)) return null;
    if (neg) v = -Math.abs(v);
    return round2(v);
  }

  /* What the MoneyInput shows WHILE typing: live thousands separators, the
     decimal point preserved so "1234." keeps its point, no Rs (the field
     draws its own), no parentheses (a person types a minus). */
  function maskMoney(s) {
    if (s === null || s === undefined) return '';
    var raw = String(s).replace(/[^0-9.\-]/g, '');
    var neg = raw.charAt(0) === '-';
    raw = raw.replace(/-/g, '');
    var dot = raw.indexOf('.');
    var whole = dot < 0 ? raw : raw.slice(0, dot);
    var frac  = dot < 0 ? null : raw.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    whole = whole.replace(/^0+(?=\d)/, '');
    var out = group(whole || (dot === 0 ? '0' : ''));
    if (dot >= 0) out += '.' + frac;
    return (neg && out !== '' ? '-' : '') + out;
  }

  return {
    LOCALE: LOCALE, TZ: TZ,
    round2: round2, money: money, amount: amount,
    dateLong: dateLong, dateShort: dateShort, time: time, dateTime: dateTime,
    todayPK: todayPK, parseMoney: parseMoney, maskMoney: maskMoney
  };
});
