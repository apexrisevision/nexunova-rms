/**
 * NexuFinance v1 — plain-language wording for every NF:CODE the database can
 * raise (supabase/migrations/20260916{a,b,c}). window.NfMsg.forLine(err) is
 * for a refusal on a receipt/payment row; .forDay(err) for a day-level action
 * (submit, close, reopen, start next day). Both fall back to a code-shaped
 * message rather than going silent on a code nobody has written wording for
 * yet — an unworded refusal must still say SOMETHING (R8's spirit: no silent
 * failure either).
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;

  function detailStr(err) {
    var d = err && err.detail;
    if (d === null || d === undefined) return '';
    return typeof d === 'string' ? d : JSON.stringify(d);
  }

  var LINE = {
    'NF:NEGATIVE_POSITION': function (err) {
      var d = err.detail || {};
      var via = d.via || 'This account';
      var wb = (d.would_be !== undefined) ? F.fmt(d.would_be) : null;
      return via + ' does not have enough money for this' + (wb !== null ? ' — it would go to (Rs ' + wb.replace(/[()]/g, '') + ') negative' : '') + '. Reduce the amount, or check it was entered on the right side.';
    },
    'NF:DUPLICATE_VOUCHER': function (err) {
      var d = err.detail || {};
      var used = d.used_on ? ' It was already used on ' + F.ddMonYyyy(d.used_on) + '.' : ' It has already been used.';
      return 'Voucher ' + (d.voucher || '') + ' is already on the books.' + used;
    },
    'NF:VOUCHER_PREFIX': function () { return 'Receipts start CRV or BRV; payments start CPV or BPV.'; },
    'NF:VOUCHER_VIA_MISMATCH': function () { return 'A voucher starting with C must be Cash or Petty; one starting with B must be Bank.'; },
    'NF:HEAD_NOT_POSTABLE': function (err) { return 'Choose a specific head from the list — "' + (err.detail || '') + '" is a category, not something you can post to.'; },
    'NF:HEAD_REQUIRED': function () { return 'Choose a head.'; },
    'NF:FLOOR_REQUIRED': function () { return 'Choose a floor.'; },
    'NF:FLOOR_UNKNOWN': function () { return 'Choose a floor from the list.'; },
    'NF:VIA_REQUIRED': function () { return 'Choose Cash, Petty or Bank.'; },
    'NF:VIA_UNKNOWN': function (err) { return (err.detail ? '"' + err.detail + '" is' : 'That is') + ' not a valid Via. Choose Cash, Petty or Bank.'; },
    'NF:VOUCHER_REQUIRED': function () { return 'Enter the voucher number from the book.'; },
    'NF:AMOUNT_REQUIRED': function () { return 'Enter an amount.'; },
    'NF:AMOUNT_NOT_POSITIVE': function () { return 'Amount must be more than zero.'; },
    'NF:AMOUNT_SCALE': function () { return 'Amount can have at most two decimal places.'; },
    'NF:AMOUNT_TOO_LARGE': function () { return 'That amount is too large.'; },
    'NF:SIDE_REQUIRED': function () { return 'Something went wrong placing this line. Reload and try again.'; },
    'NF:DAY_LOCKED': function (err) { return 'This day is ' + String(err.detail || 'closed').toLowerCase() + ' and cannot be changed here.'; },
    'NF:VERSION_CONFLICT': function () { return 'This was just changed elsewhere. Reloading the day…'; },
    'NF:VERSION_REQUIRED': function () { return 'Reloading the day…'; },
    'NF:NOT_ALLOWED': function () { return 'You do not have permission to do this.'; },
    'NF:DAY_NOT_FOUND': function () { return 'That day could not be found. Reloading…'; },
    'NF:LINE_NOT_FOUND': function () { return 'That line is no longer there. Reloading…'; },
  };

  var DAY = {
    'NF:CHECKS_FAILED': function (err) {
      var list = err.detail;
      if (Array.isArray(list) && list.length) return list.map(function (c) { return c.text; }).join(' ');
      return 'Some checks have not passed yet.';
    },
    'NF:VARIANCE_NEEDS_DIRECTOR': function () { return 'The cash count does not match the books. Only a director can close a day with a variance, and only with a written reason.'; },
    'NF:VARIANCE_REASON_REQUIRED': function () { return 'Write what actually happened with the cash count before closing.'; },
    'NF:NO_VARIANCE_TO_EXPLAIN': function () { return 'The count matches the books — no reason is needed to close.'; },
    'NF:VOUCHER_NUMBERS_PENDING': function (err) {
      var list = err.detail;
      var n = Array.isArray(list) ? list.length : 0;
      return (n ? n + (n === 1 ? ' voucher still needs its' : ' vouchers still need their') : 'Some vouchers still need their') + ' manual voucher number. Enter them, then close the day.';
    },
    'NF:CASH_COUNT_REMOVED': function () { return 'The cash count is no longer part of the daily closing.'; },
    'NF:REOPEN_NEEDS_DIRECTOR': function () { return 'Only a director can reopen a closed day.'; },
    'NF:RETURN_NEEDS_DIRECTOR': function () { return 'Only a director can send a submitted day back.'; },
    'NF:REASON_REQUIRED': function () { return 'Write a reason.'; },
    'NF:LATER_DAY_EXISTS': function () { return 'Only the most recent closed day can be reopened.'; },
    'NF:PREVIOUS_DAY_NOT_CLOSED': function (err) { return 'Close ' + (err.detail ? F.ddMonYyyy(err.detail) : 'the previous day') + ' first.'; },
    'NF:FIRST_DAY_EXISTS': function () { return 'The first day has already been set up.'; },
    'NF:NO_FIRST_DAY': function () { return 'Set up the first day’s opening balances before starting a new one.'; },
    'NF:FIRST_DAY_NEEDS_DIRECTOR': function () { return 'Only a director can set up the first day.'; },
    'NF:DATE_NOT_AFTER_PREVIOUS': function (err) { return 'The date must be after ' + (err.detail ? F.ddMonYyyy(err.detail) : 'the previous day') + '.'; },
    'NF:OPENING_IS_COMPUTED': function () { return 'This day’s opening is carried forward automatically; it cannot be typed.'; },
    'NF:CLOSING_NO_EXISTS': function () { return 'That closing number is already used.'; },
    'NF:DATE_REQUIRED': function () { return 'Pick a date.'; },
    'NF:CLOSING_NO_REQUIRED': function () { return 'Enter a closing number.'; },
    'NF:NOT_ALLOWED': function () { return 'You do not have permission to do this.'; },
    'NF:VERSION_CONFLICT': function () { return 'This was just changed elsewhere. Reloading…'; },
    'NF:NOT_SEEDED': function () { return 'This company is not set up for Daily Closing yet.'; },
  };

  function resolve(map, err) {
    var code = (err && err.code) || 'NF:UNKNOWN';
    var fn = map[code];
    if (fn) { try { return fn(err); } catch (e) { /* fall through */ } }
    var d = detailStr(err);
    return 'Could not do that (' + code + ')' + (d ? ' — ' + d : '') + '.';
  }

  global.NfMsg = {
    forLine: function (err) { return resolve(LINE, err); },
    forDay: function (err) { return resolve(DAY, err); },
    code: function (err) { return (err && err.code) || 'NF:UNKNOWN'; },
  };
})(window);
