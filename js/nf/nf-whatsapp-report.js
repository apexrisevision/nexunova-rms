/*
 * NexuFinance — the daily WhatsApp report (owner, 2026-11-19; docs/PLAN.md §51): one portrait picture
 * (JPG, 1080 px wide) and the same as a real PDF file, for a date and a view (Site / Head Office / Combined),
 * from nf_day_report. The site login always gets Site — the database decides that, not this file.
 *
 *   NfWaReport.html(report)                   → the report page (pure; the mockups use it too)
 *   NfWaReport.download(api, companyId, date, view, kind)   kind: 'jpg' | 'pdf'
 *   NfWaReport.vendorBase                     where html2canvas / pdf-lib are served from ('/vendor/')
 */
(function (global) {
  'use strict';
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Pakistani grouping: 4,15,250 — 2,63,61,788.75
  function pk(n) { return (Math.round(Number(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function pz(n) { return Number(n) ? pk(n) : '–'; }
  function short(s, n) { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  var CSS =
    '*{box-sizing:border-box}.wa{width:1080px;background:#fff;font-family:"Segoe UI",Inter,Arial,sans-serif;color:#14213d}' +
    '.wa .top{background:linear-gradient(120deg,#0b3d91,#1565c0 60%,#00a676);color:#fff;padding:40px 48px 34px}' +
    '.wa .top h1{margin:0;font-size:46px;font-weight:700;letter-spacing:.2px}.wa .top .d{font-size:30px;margin-top:8px;opacity:.95}' +
    '.wa .view{display:inline-block;margin-top:16px;background:#ffd23f;color:#3d2c00;font-weight:700;font-size:26px;padding:6px 22px;border-radius:999px}' +
    '.wa .sec{padding:28px 48px 6px}.wa .sec h2{font-size:32px;margin:0 0 14px;padding-left:14px;border-left:8px solid #1565c0}' +
    '.wa .sec h2 span{font-size:22px;color:#6b7383;font-weight:500;margin-left:10px}.wa .sec h2.in{border-color:#00a676}.wa .sec h2.out{border-color:#e63946}.wa .sec h2.tr{border-color:#f4a300}' +
    '.wa table{width:100%;border-collapse:collapse;font-size:25px}.wa th{font-size:20px;color:#5b6475;text-align:left;font-weight:600;padding:10px 10px;border-bottom:3px solid #e3e7ee}' +
    '.wa td{padding:14px 10px;border-bottom:1px solid #edf0f5;vertical-align:top}.wa .r{text-align:right;white-space:nowrap}' +
    '.wa .bal td{font-size:27px}.wa .bal td:first-child{font-weight:700}.wa .bal .cl{font-weight:800;font-size:30px;color:#0b3d91}.wa .bal .z{color:#9aa3b2}' +
    '.wa .no{font-weight:700;white-space:nowrap;color:#0b3d91}.wa .pt{font-weight:600}.wa .hd{color:#4a5468;font-size:22px;white-space:nowrap}.wa .amt{font-weight:800;font-size:27px}' +
    '.wa .lst tfoot td{font-weight:800;font-size:27px;background:#f3f6fb;border-bottom:0}.wa .trf td{background:#fff9e6}' +
    '.wa .by{font-size:20px;font-weight:700}.wa .by.site{color:#0e7a5a}.wa .by.ho{color:#2b4f8a}.wa .none{font-size:24px;color:#6b7383;margin:0 0 10px}' +
    '.wa .foot{margin:26px 48px 36px;padding:22px 26px;background:#f3f6fb;border-radius:18px;font-size:23px;color:#4a5468;display:flex;justify-content:space-between;gap:20px}' +
    '.wa .foot b{color:#14213d}.wa .net{font-size:26px;color:#14213d;font-weight:700}';

  function dateText(iso) {
    var p = String(iso).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return DAYS[d.getUTCDay()] + ', ' + (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0];
  }
  function stamp(ts) {
    var d = ts ? new Date(ts) : new Date();
    try {
      return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' });
    } catch (e) { return d.toISOString(); }
  }

  function html(rep) {
    var combined = rep.view === 'combined';
    var rec = rep.received || [], pay = rep.paid || [], trf = rep.transfers || [];
    function tot(list) { return list.reduce(function (t, x) { return t + Number(x.amount || 0); }, 0); }
    function list(title, rows, cls, who) {
      return '<section class="sec"><h2 class="' + cls + '">' + title + ' <span>' + rows.length + (rows.length === 1 ? ' entry' : ' entries') + '</span></h2>' +
        (rows.length ? '<table class="lst"><thead><tr><th>Voucher</th><th>' + who + '</th><th>For</th>' + (combined ? '<th>By</th>' : '') + '<th class="r">Amount</th></tr></thead><tbody>' +
          rows.map(function (x) {
            return '<tr><td class="no">' + esc(x.no) + '</td><td class="pt">' + esc(x.party ? short(x.party, 32) : '–') + '</td><td class="hd">' + esc(short(x['for'], combined ? 38 : 50)) + '</td>' +
              (combined ? '<td class="by ' + (x.by === 'Head Office' ? 'ho' : 'site') + '">' + esc(x.by) + '</td>' : '') +
              '<td class="r amt">' + pk(x.amount) + '</td></tr>';
          }).join('') +
          '</tbody><tfoot><tr><td colspan="' + (combined ? 4 : 3) + '">Total ' + title.toLowerCase() + '</td><td class="r">' + pk(tot(rows)) + '</td></tr></tfoot></table>'
          : '<p class="none">None.</p>') + '</section>';
    }
    var transfers = trf.length
      ? '<section class="sec"><h2 class="tr">Transfers <span>' + trf.length + (trf.length === 1 ? ' entry' : ' entries') + ' · not counted as money received or paid</span></h2>' +
        '<table class="lst"><thead><tr><th>Voucher</th><th>From</th><th>To</th>' + (combined ? '<th>By</th>' : '') + '<th class="r">Amount</th></tr></thead><tbody>' +
        trf.map(function (x) {
          return '<tr class="trf"><td class="no">' + esc(x.no) + '</td><td class="pt">' + esc(x.from) + (x.cheque ? ' <span class="hd">(chq …' + esc(x.cheque) + ')</span>' : '') + '</td><td class="pt">' + esc(x.to) + '</td>' +
            (combined ? '<td class="by ' + (x.by === 'Head Office' ? 'ho' : 'site') + '">' + esc(x.by) + '</td>' : '') +
            '<td class="r amt">' + pk(x.amount) + '</td></tr>';
        }).join('') + '</tbody></table></section>'
      : '';
    return '<div class="wa"><style>' + CSS + '</style>' +
      '<div class="top"><h1>' + esc(rep.title) + '</h1><div class="d">' + esc(dateText(rep.date)) + '</div><span class="view">' + esc(rep.view_name) + '</span></div>' +
      '<section class="sec"><h2>Balances</h2><table class="bal"><thead><tr><th></th><th class="r">Opening</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Transfers</th><th class="r">Closing</th></tr></thead><tbody>' +
      (rep.boxes || []).map(function (b) {
        var t = Number(b.transfers);
        return '<tr><td>' + esc(b.label) + '</td><td class="r">' + pk(b.opening) + '</td>' +
          '<td class="r' + (Number(b.received) ? '' : ' z') + '">' + pz(b.received) + '</td>' +
          '<td class="r' + (Number(b.paid) ? '' : ' z') + '">' + pz(b.paid) + '</td>' +
          '<td class="r' + (t ? '' : ' z') + '">' + (t > 0 ? '+' : '') + pz(t) + '</td>' +
          '<td class="r cl">' + pk(b.closing) + '</td></tr>';
      }).join('') + '</tbody></table></section>' +
      list('Money received', rec, 'in', 'From') + list('Money paid', pay, 'out', 'Paid to') + transfers +
      '<div class="foot"><div><div class="net">Received ' + pz(tot(rec)) + ' · Paid ' + pz(tot(pay)) + '</div>' +
      (trf.length ? 'Transfers (yellow) are not counted in money received or paid.' : '') + '</div>' +
      '<div style="text-align:right">Prepared by <b>' + esc(rep.prepared_by || '') + '</b><br>Generated ' + esc(stamp(rep.generated_at)) + '</div></div></div>';
  }

  var api = { vendorBase: '/vendor/' };
  function load(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { ready() ? ok() : bad(new Error('Could not load ' + src)); };
      s.onerror = function () { bad(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function save(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function download(nfApi, companyId, date, view, kind) {
    var vb = api.vendorBase;
    return Promise.all([
      nfApi.dayReport(companyId, date, view),
      load(vb + 'html2canvas.min.js?v=1.4.1', function () { return typeof global.html2canvas === 'function'; }),
      kind === 'pdf' ? load(vb + 'pdf-lib.min.js?v=1.17.1', function () { return !!global.PDFLib; }) : Promise.resolve(),
    ]).then(function (r) {
      var rep = r[0];
      // laid out on the page but behind it: html2canvas needs a real layout
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;width:1080px;background:#fff';
      host.innerHTML = html(rep);
      document.body.appendChild(host);
      var p = String(rep.date).split('-');
      var name = 'Awami Daily Closing ' + p[2] + '-' + MON[+p[1] - 1].slice(0, 3) + '-' + p[0] + ' ' + rep.view_name;
      return global.html2canvas(host.firstChild, { scale: 1, backgroundColor: '#ffffff', logging: false, width: 1080, windowWidth: 1080 })
        .then(function (cv) {
          host.remove();
          var jpgUrl = cv.toDataURL('image/jpeg', 0.92);
          if (kind !== 'pdf') {
            return fetch(jpgUrl).then(function (x) { return x.blob(); }).then(function (b) { save(b, name + '.jpg'); return rep; });
          }
          var L = global.PDFLib;
          return L.PDFDocument.create().then(function (doc) {
            return doc.embedJpg(jpgUrl).then(function (img) {
              // one page the size of the picture (pt): readable on a phone, printable as is
              var w = 595.28, h = w * cv.height / cv.width;
              doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
              doc.setTitle(name);
              return doc.save();
            });
          }).then(function (bytes) { save(new Blob([bytes], { type: 'application/pdf' }), name + '.pdf'); return rep; });
        }, function (e) { host.remove(); throw e; });
    });
  }
  api.html = html;
  api.download = download;
  global.NfWaReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
