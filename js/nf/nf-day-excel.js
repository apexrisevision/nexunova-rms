/*
 * NexuFinance — one date's cash & bank book as an Excel tab (owner, 2026-11-19; docs/PLAN.md §50).
 * The layout of the head office's own "Daily closing.xlsx": receipts A–E (V. No, Detail, Head, Cash, Bank),
 * payments G–K, the JVs as adjustments, and a closing block for Head Office Cash, Site Cash and the bank.
 * Every line says who entered it. By date, from nf_day_book (director only).
 *
 *   NfDayExcel.rows(book)            → { aoa, cols, merges, summary }   (pure; also used by the Node test)
 *   NfDayExcel.download(api, companyId, date) → saves "<Title> <dd-Mon-yyyy>.xlsx"
 */
(function (global) {
  'use strict';
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function num(x) { return Number(x) || 0; }
  function who(v) { return v.by_name ? (v.by_box === 'Petty' ? v.by_name : 'Head Office') : 'Imported'; }

  function rows(book) {
    var box = {};
    (book.boxes || []).forEach(function (b) { box[b.via] = { label: b.label || b.via, opening: num(b.opening), inn: 0, out: 0, trf: 0 }; });
    ['Cash', 'Petty', 'Bank'].forEach(function (v) { if (!box[v]) box[v] = { label: v, opening: 0, inn: 0, out: 0, trf: 0 }; });
    var rec = [], pay = [], adj = [];
    (book.vouchers || []).forEach(function (v) {
      var legs = v.legs || [];
      var via = legs.filter(function (l) { return l.via; }), head = legs.filter(function (l) { return !l.via; });
      if (!via.length) {   // a JV: no cash, no bank
        var dr = head.filter(function (l) { return num(l.dr) > 0; }), cr = head.filter(function (l) { return num(l.cr) > 0; });
        adj.push([v.no, (v.narration || '') + ' · ' + who(v), cr.map(function (l) { return l.party || l.name; }).join(', '),
          dr.map(function (l) { return l.party || l.name; }).join(', '), dr.reduce(function (t, l) { return t + num(l.dr); }, 0)]);
        return;
      }
      if (!head.length) {  // a transfer: the box it went into is a receipt, the box it left a payment
        via.forEach(function (l) {
          var amt = num(l.dr) || num(l.cr), bank = l.via === 'Bank';
          var row = [v.no, (v.narration || '') + ' · ' + who(v), 'Transfer — ' + (l.label || l.via), bank ? '' : amt, bank ? amt : ''];
          if (num(l.dr) > 0) { rec.push(row); box[l.via].trf += amt; } else { pay.push(row); box[l.via].trf -= amt; }
        });
        return;
      }
      var m = via[0], h = head[0], amt = num(m.dr) || num(m.cr), bank = m.via === 'Bank';
      var row = [v.no, (v.narration || '') + ' · ' + who(v) + (bank ? '' : ' (' + (m.label || m.via) + ')'),
        h.party && h.party !== h.name ? h.name + ' · ' + h.party : h.name, bank ? '' : amt, bank ? amt : ''];
      if (num(m.dr) > 0) { rec.push(row); box[m.via].inn += amt; } else { pay.push(row); box[m.via].out += amt; }
    });

    var p = String(book.date).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var dateText = DAYS[d.getUTCDay()] + ', ' + p[2] + ' ' + MON[+p[1] - 1] + ' ' + p[0];
    var A = [];
    A[0] = [book.title || 'DAILY CASH & BANK BOOK'];
    A[1] = ['Date:', dateText];
    A[2] = ['Cash = ' + box.Cash.label + ' or ' + box.Petty.label + ' (named in the detail); Bank = ' + box.Bank.label + '. "· name" = who entered the line.'];
    A[4] = ['RECEIPTS  (money IN)', '', '', '', '', '', 'PAYMENTS  (money OUT)'];
    A[5] = ['V. No', 'Detail (from whom / for what) · entered by', 'Head', 'Cash', 'Bank', '', 'V. No', 'Detail (to whom / for what) · entered by', 'Head', 'Cash', 'Bank'];
    var n = Math.max(rec.length, pay.length, 1), i;
    for (i = 0; i < n; i++) {
      var r = rec[i] || ['', '', '', '', ''], q = pay[i] || ['', '', '', '', ''];
      A[6 + i] = [r[0], r[1], r[2], r[3], r[4], '', q[0], q[1], q[2], q[3], q[4]];
    }
    function sum(list, k) { return list.reduce(function (t, x) { return t + num(x[k]); }, 0); }
    var y = 6 + n + 1;
    A[y] = ['', '', 'Total received', sum(rec, 3), sum(rec, 4), '', '', '', 'Total paid', sum(pay, 3), sum(pay, 4)];
    y += 2;
    A[y] = ['', 'CLOSING', box.Cash.label, box.Petty.label, box.Bank.label, '', 'ADJUSTMENTS  (JVs — no cash, no bank)'];
    A[y + 1] = ['', 'Opening (b/f)', box.Cash.opening, box.Petty.opening, box.Bank.opening, '', 'V. No', 'Detail · entered by', 'Received from', 'Paid to', 'Amount'];
    [['Add: received today', 'inn', 1], ['Less: paid today', 'out', -1], ['Transfers (net)', 'trf', 1]].forEach(function (x, k) {
      A[y + 2 + k] = ['', x[0], box.Cash[x[1]] * x[2], box.Petty[x[1]] * x[2], box.Bank[x[1]] * x[2]];
    });
    function close(v) { return box[v].opening + box[v].inn - box[v].out + box[v].trf; }
    A[y + 5] = ['', 'Closing balance (c/f)', close('Cash'), close('Petty'), close('Bank')];
    adj.forEach(function (a, k) { var row = A[y + 2 + k] || ['', '', '', '', '']; while (row.length < 6) row.push(''); A[y + 2 + k] = row.concat(a); });
    var last = Math.max(y + 8, y + 2 + adj.length + 1);
    A[last] = ['', 'Prepared by: ____________________', '', '', '', '', '', 'Checked by:  ____________________'];
    for (i = 0; i < A.length; i++) if (!A[i]) A[i] = [];
    return {
      aoa: A,
      cols: [10, 58, 26, 14, 14, 2, 10, 58, 26, 14, 14],
      merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } }],
      sheetName: p[2] + '-' + MON[+p[1] - 1],
      summary: { receipts: rec.length, payments: pay.length, jvs: adj.length,
        closing: { Cash: close('Cash'), Petty: close('Petty'), Bank: close('Bank') } },
    };
  }

  function workbook(X, book) {
    var t = rows(book);
    var ws = X.utils.aoa_to_sheet(t.aoa);
    ws['!cols'] = t.cols.map(function (w) { return { wch: w }; });
    ws['!merges'] = t.merges;
    Object.keys(ws).forEach(function (a) {
      if (/^[C-EJK]\d+$/.test(a) && typeof ws[a].v === 'number') {
        ws[a].z = Number.isInteger(ws[a].v) ? '#,##0;(#,##0);"–"' : '#,##0.00;(#,##0.00);"–"';
      }
    });
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, t.sheetName);
    return { wb: wb, name: t.sheetName };
  }

  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = XLSX_URL; s.onload = function () { ok(global.XLSX); }; s.onerror = function () { bad(new Error('Could not load the Excel library.')); };
      document.head.appendChild(s);
    });
  }

  function download(api, companyId, date) {
    return Promise.all([api.dayBook(companyId, date), loadXlsx()]).then(function (r) {
      var book = r[0], X = r[1], w = workbook(X, book);
      var p = String(book.date).split('-');
      var title = String(book.title || 'Daily cash and bank book').split(' — ')[0];
      X.writeFile(w.wb, title + ' ' + p[2] + '-' + MON[+p[1] - 1] + '-' + p[0] + '.xlsx');
      return book;
    });
  }

  global.NfDayExcel = { rows: rows, workbook: workbook, download: download };
})(typeof window !== 'undefined' ? window : globalThis);
