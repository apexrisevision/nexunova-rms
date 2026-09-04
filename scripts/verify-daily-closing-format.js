#!/usr/bin/env node
/**
 * Daily Closing — P5 verification: formatters, MoneyInput parsing, WCAG contrast.
 *
 *   node scripts/verify-daily-closing-format.js
 *
 * Pure Node, no database, no browser. It requires js/foundation/dc-format.js —
 * the same file the screens load — so the tests cannot drift from the code.
 *
 * The contrast section COMPUTES the WCAG 2.1 ratio for every token pairing the
 * kit actually uses, rather than asserting the palette is fine. That is how the
 * §A11 label colour was caught: #9CA3AF on white is 2.54:1, which fails AA for
 * text and even fails the 3:1 large-text floor.
 */
'use strict';

const path = require('path');
const F = require(path.join(__dirname, '..', 'js', 'foundation', 'dc-format.js'));

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log('  ✅ ' + m); };
const bad = m => { fail++; console.log('  ❌ ' + m); };
const eq  = (got, want, what) =>
  got === want ? ok(`${what}  →  ${JSON.stringify(got)}`)
               : bad(`${what}  →  got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const head = t => console.log('\n── ' + t);

// ── money ────────────────────────────────────────────────────────────────
head('money — the §A7 edge cases');
eq(F.money(0),              'Rs 0',            'zero');
eq(F.money(999),            'Rs 999',          '999 — no separator');
eq(F.money(1000),           'Rs 1,000',        '1000 — first separator');
eq(F.money(1234567),        'Rs 1,234,567',    '§A7 worked example');
eq(F.money(1000000.5),      'Rs 1,000,000.50', '1,000,000.5 — paisa shown, padded to 2dp');
eq(F.money(-3),             '(Rs 3)',          'negative → parentheses, never a minus');
eq(F.money(-1234.56),       '(Rs 1,234.56)',   'negative with paisa');
eq(F.money(1234.00),        'Rs 1,234',        'trailing .00 is NOT shown');
eq(F.money(1234.5),         'Rs 1,234.50',     '.5 pads to .50');
eq(F.money(1234.05),        'Rs 1,234.05',     '.05 keeps its leading zero');
eq(F.money(0.5),            'Rs 0.50',         'under a rupee');
eq(F.money(null),           '—',               'null → em dash');
eq(F.money(undefined),      '—',               'undefined → em dash');
eq(F.money(NaN),            '—',               'NaN → em dash');
eq(F.money(''),             '—',               'empty string → em dash');
eq(F.money(5, {prefix:''}), '5',               'prefix can be dropped for a table cell');
eq(F.amount(-3),            '(3)',             'amount() — bare, still parenthesised');
eq(F.money(0, {blank:''}),  'Rs 0',            'zero is a figure, not a blank');

head('money — Western grouping, NOT lakh/crore');
eq(F.money(12345678),  'Rs 12,345,678',  '8 digits group in threes');
eq(F.money(123456789), 'Rs 123,456,789', '9 digits group in threes');
(function () {
  const s = F.money(12345678);
  s.includes('1,23,45,678')
    ? bad('en-IN lakh/crore grouping leaked in — see memory pkr_locale_en_in_not_en_pk')
    : ok('no lakh/crore grouping anywhere');
})();

head('money — rounding is half-away-from-zero at 2dp');
eq(F.round2(1.005),  1.01,  '1.005 rounds up, not down like toFixed');
eq(F.round2(-1.005), -1.01, 'negatives round symmetrically');
eq(F.money(999.999), 'Rs 1,000', '999.999 carries into the whole rupee');
eq(F.money(0.004),   'Rs 0',     'sub-paisa dust disappears rather than showing 0.00');

// ── parseMoney ───────────────────────────────────────────────────────────
head('parseMoney — what a person actually types');
eq(F.parseMoney('150000'),      150000,  'plain digits');
eq(F.parseMoney('1,50,000'),    150000,  'separators anywhere are stripped');
eq(F.parseMoney('1,234.56'),    1234.56, 'grouped with paisa');
eq(F.parseMoney(' Rs 1,000 '),  1000,    'a stray Rs and spaces');
eq(F.parseMoney('(3)'),         -3,      'parentheses read back as negative');
eq(F.parseMoney('-3'),          -3,      'a typed minus');
eq(F.parseMoney('12a3'),        null,    'letters REJECT the value — 12a3 must not become 123');
eq(F.parseMoney('abc'),         null,    'all letters → null');
eq(F.parseMoney(''),            null,    'empty → null');
eq(F.parseMoney('   '),         null,    'whitespace → null');
eq(F.parseMoney(null),          null,    'null → null');
eq(F.parseMoney('.'),           null,    'a lone point is not a number');
eq(F.parseMoney('-'),           null,    'a lone minus is not a number');
eq(F.parseMoney('0'),           0,       'zero is a value, not an absence');
eq(F.parseMoney(1234.567),      1234.57, 'a number in is rounded to 2dp');

head('maskMoney — what the field shows while typing');
eq(F.maskMoney('1234567'), '1,234,567', 'separators appear live');
eq(F.maskMoney('1234.'),   '1,234.',    'the decimal point survives mid-type');
eq(F.maskMoney('1234.5'),  '1,234.5',   'one decimal is not padded while typing');
eq(F.maskMoney('1234.567'),'1,234.56',  'a third decimal cannot be typed');
eq(F.maskMoney('00123'),   '123',       'leading zeros collapse');
eq(F.maskMoney('12a3'),    '123',       'a pasted letter is stripped by the mask (beforeinput blocks typing)');
eq(F.maskMoney(''),        '',          'empty stays empty');
eq(F.maskMoney('-45'),     '-45',       'a minus is kept while typing');

// ── dates and time ───────────────────────────────────────────────────────
head('dates — Asia/Karachi, always');
eq(F.dateLong('2026-09-03'),  'Thursday, 03 September 2026', '§A12 header form');
eq(F.dateShort('2026-09-03'), '03 Sep 2026',                 'table form');
eq(F.dateLong('2026-01-01'),  'Thursday, 01 January 2026',   'new year, zero-padded');
eq(F.dateShort(null),         '—',                           'null → em dash');
eq(F.dateShort('nonsense'),   '—',                           'unparseable → em dash');

(function () {
  // 2026-09-03 20:00 UTC is 2026-09-04 01:00 in Karachi. A formatter using the
  // viewer's zone, or UTC, would call this the 3rd. This is the whole reason
  // the module never uses CURRENT_DATE.
  const t = new Date(Date.UTC(2026, 8, 3, 20, 0, 0));
  eq(F.dateShort(t), '04 Sep 2026', '20:00 UTC is already tomorrow in Karachi');
  eq(F.time(t),      '01:00',       'and the time is 01:00, not 20:00');
})();

(function () {
  const d = F.todayPK();
  /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? ok(`todayPK() → ${d} (YYYY-MM-DD, Karachi)`)
    : bad(`todayPK() → ${d}, want YYYY-MM-DD`);
})();

// ── WCAG AA contrast, computed ───────────────────────────────────────────
head('WCAG 2.1 contrast — computed for every pairing the kit uses');

function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const T = {
  surface: '#FFFFFF', canvas: '#F6F7F9', subtle: '#F8FAFC',
  ink900: '#111827', ink600: '#4B5563', ink500: '#6B7280', ink400: '#9CA3AF',
  navy900: '#0B1B3A', navy700: '#1F3864',
  in: '#0F7B4C', inBg: '#ECF8F1', out: '#B42318', outBg: '#FDF1EF',
  warn: '#B54708', warnBg: '#FFF6E5', lock: '#5D6470', lockBg: '#F3F4F6',
  focus: '#2563EB', white: '#FFFFFF'
};

// [name, fg, bg, floor]  — 4.5 for body text, 3.0 for large text (≥24px) and UI edges
const PAIRS = [
  ['body text on surface',        T.ink900,  T.surface, 4.5],
  ['secondary text on surface',   T.ink600,  T.surface, 4.5],
  ['LABEL on surface',            T.ink500,  T.surface, 4.5],
  ['LABEL on canvas',             T.ink500,  T.canvas,  4.5],
  ['label on subtle',             T.ink500,  T.subtle,  4.5],
  ['money-in on surface',         T.in,      T.surface, 4.5],
  ['money-in on its tint',        T.in,      T.inBg,    4.5],
  ['money-out on surface',        T.out,     T.surface, 4.5],
  ['money-out on its tint',       T.out,     T.outBg,   4.5],
  ['warning on its tint',         T.warn,    T.warnBg,  4.5],
  ['locked on its tint',          T.lock,    T.lockBg,  4.5],
  ['navy-700 chip on canvas',     T.navy700, T.canvas,  4.5],
  ['white on navy-900 band',      T.white,   T.navy900, 4.5],
  ['white on navy-700 button',    T.white,   T.navy700, 4.5],
  ['hero figure on surface',      T.ink900,  T.surface, 3.0],
  ['focus ring against surface',  T.focus,   T.surface, 3.0],
  ['focus ring against canvas',   T.focus,   T.canvas,  3.0],
];

for (const [what, fg, bg, floor] of PAIRS) {
  const r = ratio(fg, bg);
  const label = `${what.padEnd(30)} ${r.toFixed(2)}:1  (needs ${floor})`;
  r >= floor ? ok(label) : bad(label);
}

// The finding that produced --dc-ink-500. Kept as a test so nobody "restores"
// §A11's literal ink-400 for labels without the suite objecting.
(function () {
  const r = ratio(T.ink400, T.surface);
  r < 4.5
    ? ok(`§A11's ink-400 for labels would be ${r.toFixed(2)}:1 — correctly NOT used for text`)
    : bad(`ink-400 is now ${r.toFixed(2)}:1 — the --dc-ink-500 workaround may be removable`);
})();

// ── report ───────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────');
console.log(fail === 0
  ? `✅ PASS  (${pass} assertions, 0 failed)`
  : `❌ FAIL  (${pass} passed, ${fail} failed)`);
if (fail) process.exitCode = 1;
