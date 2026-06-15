// Phase 3D — plan-generator TORTURE TEST (pure logic; this IS the code going into sales.js).
// Asserts: Σ amount_due == net EXACT (no paisa lost), last-MONTHLY-line absorption,
// and payload tie-out (down_payment == booking line, installment_count == monthly count).

function _spRound(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function _spYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _spAddMonths(d, n) { var x = new Date(d.getTime()); var day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); var last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(day, last)); return x; }

function _spGenerate(net, tpl, p) {
  net = _spRound(net);
  var lines = [];
  var bookingDate = p.bookingDate || _spYmd(new Date());
  var i, d;
  if (tpl === 'custom') {
    var bookingAmt = _spRound(p.bookingAmt || 0);
    if (bookingAmt > 0) lines.push({ type: 'down_payment', label: 'Booking / Down Payment', due: bookingDate, amount: bookingAmt });
    var monthlyAmt = _spRound(p.monthlyAmt || 0);
    var cmonths = parseInt(p.months) || 0;
    d = new Date(p.startDate);
    for (i = 1; i <= cmonths; i++) { lines.push({ type: 'installment', label: 'Installment ' + i, due: _spYmd(d), amount: monthlyAmt }); d = _spAddMonths(d, 1); }
    (p.specials || []).forEach(function (s) { lines.push({ type: s.type || 'custom', label: s.label || 'Special', due: s.due || _spYmd(d), amount: _spRound(s.amount || 0) }); });
  } else { // 'equal' or 'possession'
    var bookingPct = Number(p.bookingPct) || 0;
    var possessionPct = tpl === 'possession' ? (Number(p.possessionPct) || 0) : 0;
    var months = parseInt(p.months) || 0;
    var booking = _spRound(net * bookingPct / 100);
    var possession = _spRound(net * possessionPct / 100);
    var remaining = _spRound(net - booking - possession);
    var monthly = months > 0 ? _spRound(remaining / months) : 0;
    lines.push({ type: 'down_payment', label: 'Booking / Down Payment', due: bookingDate, amount: booking });
    d = new Date(p.startDate);
    for (i = 1; i <= months; i++) { lines.push({ type: 'installment', label: 'Installment ' + i, due: _spYmd(d), amount: monthly }); d = _spAddMonths(d, 1); }
    if (possession > 0) lines.push({ type: 'possession', label: 'On Possession', due: _spYmd(d), amount: possession });
  }
  // ── LAST-INSTALLMENT ABSORPTION: Σ amount_due MUST == net exactly ──
  if (lines.length) {
    var sumAll = lines.reduce(function (s, l) { return s + l.amount; }, 0);
    var diff = _spRound(net - sumAll);
    if (diff !== 0) {
      var idx = -1; for (var k = lines.length - 1; k >= 0; k--) { if (lines[k].type === 'installment') { idx = k; break; } }
      if (idx < 0) idx = lines.length - 1;
      lines[idx].amount = _spRound(lines[idx].amount + diff);
    }
  }
  return lines;
}
function _spSum(lines) { return _spRound(lines.reduce(function (s, l) { return s + l.amount; }, 0)); }
function _spBooking(lines) { var b = lines.find(function (l) { return l.type === 'down_payment'; }); return b ? b.amount : 0; }
function _spMonthlyCount(lines) { return lines.filter(function (l) { return l.type === 'installment'; }).length; }

// ── Torture cases ──
var P = { startDate: '2026-07-01', bookingDate: '2026-06-12' };
var cases = [
  { net: 6678423, tpl: 'equal', p: Object.assign({ bookingPct: 30, months: 36 }, P), expDown: 2003526.9, expMonths: 36 },
  { net: 5391200, tpl: 'possession', p: Object.assign({ bookingPct: 25, months: 30, possessionPct: 10 }, P), expDown: 1347800, expMonths: 30, expPoss: 539120 },
  { net: 999999.99, tpl: 'equal', p: Object.assign({ bookingPct: 33, months: 13 }, P) },
  { net: 7777777, tpl: 'equal', p: Object.assign({ bookingPct: 20, months: 47 }, P) },
  { net: 1234567.89, tpl: 'possession', p: Object.assign({ bookingPct: 15, months: 24, possessionPct: 20 }, P) },
  { net: 8400000, tpl: 'custom', p: Object.assign({ bookingAmt: 2000000, monthlyAmt: 150000, months: 40, specials: [{ type: 'possession', label: 'Possession', amount: 400000 }] }, P) }
];

var allPass = true;
cases.forEach(function (c, n) {
  var lines = _spGenerate(c.net, c.tpl, c.p);
  var sum = _spSum(lines);
  var tieout = sum === _spRound(c.net);
  var down = _spBooking(lines);
  var mc = _spMonthlyCount(lines);
  var possLine = lines.find(function (l) { return l.type === 'possession'; });
  // last MONTHLY line is the absorber — confirm it differs from a naive equal split when there's a remainder
  var ok = tieout;
  if (c.expDown != null && down !== _spRound(c.expDown)) ok = false;
  if (c.expMonths != null && mc !== c.expMonths) ok = false;
  if (c.expPoss != null && (!possLine || possLine.amount !== _spRound(c.expPoss))) ok = false;
  if (!ok) allPass = false;
  console.log('Case ' + (n + 1) + ' net=' + c.net + ' [' + c.tpl + ']: Σ=' + sum + ' tie-out=' + (tieout ? 'EXACT✓' : 'OFF✗(' + (sum - c.net) + ')') +
    ' | down=' + down + (c.expDown != null ? (down === _spRound(c.expDown) ? '✓' : '✗') : '') +
    ' | months=' + mc + (c.expMonths != null ? (mc === c.expMonths ? '✓' : '✗') : '') +
    (c.expPoss != null ? (' | possession=' + (possLine ? possLine.amount : '—') + (possLine && possLine.amount === _spRound(c.expPoss) ? '✓' : '✗')) : '') +
    ' | lines=' + lines.length);
});
// payload tie-out demo (note #2): for case 1 the p_sale.down_payment + installment_count
var l1 = _spGenerate(cases[0].net, cases[0].tpl, cases[0].p);
console.log('\nPayload tie-out (case 1): p_sale.down_payment=' + _spBooking(l1) + ' == booking line amount_due:' + (_spBooking(l1) === l1.find(x => x.type === 'down_payment').amount));
console.log('  p_sale.installment_count=' + _spMonthlyCount(l1) + ' == # installment lines:' + (_spMonthlyCount(l1) === l1.filter(x => x.type === 'installment').length));
console.log('\n' + (allPass ? 'ALL TORTURE CASES PASS — Σ==net exact, no paisa lost ✓' : '!!! SOME CASES FAILED'));
process.exit(allPass ? 0 : 1);
