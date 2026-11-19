/*
 * NexuFinance — the daily WhatsApp report (owner, 2026-11-19; docs/PLAN.md §51): one portrait picture
 * (JPG, 1080 px wide) and the same as a real PDF file — redrawn 19-Nov: sleek and restrained, for a date and a view (Site / Head Office / Combined),
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

  // Sleek and restrained (owner, 19-Nov: "itni colorful report na banao"): white paper, hairline rules,
  // near-black ink, one blue accent; hierarchy by size and tracking, never by colour or heavy weight.
  var INK = '#0F172A', MUTE = '#64748B', LINE = '#E5E7EB';
  var HUE = { Cash: 1, Petty: 1, Bank: 1, rec: 1, pay: 1, trf: 1 };
  Object.keys(HUE).forEach(function (k) { HUE[k] = { ink: INK, tint: '#FFFFFF', line: LINE }; });
  var CSS =
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.wa{width:1080px;background:#F3F4F6;padding:36px 36px 30px;font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif;color:' + INK + ';font-weight:400}' +
    '.wa .paper{background:#fff;border-radius:20px;border:1px solid ' + LINE + ';overflow:hidden}' +
    '.wa .mast{padding:46px 52px 34px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-top:6px solid #2563EB}' +
    '.wa .eyebrow{font-size:18px;letter-spacing:.24em;color:' + MUTE + ';text-transform:uppercase}' +
    '.wa .title{font-size:62px;line-height:1.05;letter-spacing:-.025em;margin:12px 0 0;font-weight:500;color:' + INK + '}' +
    '.wa .date{font-size:27px;color:#475569;margin-top:12px}' +
    '.wa .view{flex:none;font-size:20px;padding:9px 20px;border-radius:999px;color:#1D4ED8;border:1px solid #BFDBFE;margin-top:6px;letter-spacing:.01em}' +
    '.wa .ribbon{display:none}' +
    '.wa .body{padding:6px 52px 10px;border-top:1px solid ' + LINE + '}' +
    '.wa .lbl{font-size:17px;letter-spacing:.2em;text-transform:uppercase;color:' + MUTE + ';margin:34px 0 14px}' +
    '.wa .boxes{display:grid;gap:14px}' +
    '.wa .box{border-radius:16px;padding:24px 28px 22px;border:1px solid ' + LINE + '}' +
    '.wa .box .bn{font-size:23px;color:#334155 !important;display:flex;justify-content:space-between;align-items:baseline}' +
    '.wa .box .bn small{font-size:17px;color:' + MUTE + ';letter-spacing:.02em}' +
    '.wa .box .big{font-size:58px;letter-spacing:-.03em;line-height:1.05;margin:8px 0 18px;font-variant-numeric:tabular-nums;font-weight:500;color:' + INK + ' !important}' +
    '.wa .flow{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid ' + LINE + ';padding-top:14px}' +
    '.wa .flow div{padding:0 14px 0 0}' +
    '.wa .flow span{display:block;font-size:16px;color:' + MUTE + ';letter-spacing:.03em}' +
    '.wa .flow b{display:block;font-weight:400;font-size:24px;color:' + INK + ';font-variant-numeric:tabular-nums;margin-top:4px}' +
    '.wa .flow b.z{color:#CBD5E1}' +
    '.wa .glance{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid ' + LINE + ';border-radius:16px}' +
    '.wa .tile{padding:22px 24px;border:0 !important;border-left:1px solid ' + LINE + ' !important}' +
    '.wa .tile:first-child{border-left:0 !important}' +
    '.wa .tile span{font-size:18px;color:' + MUTE + ' !important}' +
    '.wa .tile b{display:block;font-weight:500;font-size:38px;letter-spacing:-.02em;margin-top:8px;font-variant-numeric:tabular-nums;color:' + INK + ' !important}' +
    '.wa .tile small{display:block;font-size:16px;color:#94A3B8;margin-top:4px}' +
    '.wa .sec{margin-top:40px}' +
    '.wa .sh{display:flex;align-items:baseline;justify-content:space-between;padding:0 2px 14px;border-bottom:1.5px solid ' + INK + '}' +
    '.wa .sh h2{margin:0;font-size:30px;font-weight:500;letter-spacing:-.015em;color:' + INK + ' !important}' +
    '.wa .sh .pill{font-size:18px;color:' + MUTE + ' !important}' +
    '.wa .rows{border:0}' +
    '.wa .row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:18px 2px;border-top:1px solid ' + LINE + '}' +
    '.wa .row:first-child{border-top:0}' +
    '.wa .who{min-width:0;flex:1}' +
    '.wa .nm{font-size:27px;letter-spacing:-.01em;color:' + INK + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa .nm.dim{color:#334155}' +
    '.wa .meta{font-size:18px;color:' + MUTE + ';margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa .meta .v{color:#475569;font-variant-numeric:tabular-nums}' +
    '.wa .tag{display:inline-block;font-size:15px;padding:1px 10px;border-radius:999px;margin-left:8px;vertical-align:2px;border:1px solid ' + LINE + ';color:#475569}' +
    '.wa .amt{font-size:29px;letter-spacing:-.015em;font-variant-numeric:tabular-nums;white-space:nowrap;color:' + INK + ' !important}' +
    '.wa .tot{display:flex;justify-content:space-between;align-items:baseline;padding:16px 2px;border-top:1.5px solid ' + INK + ';font-size:20px;color:#475569}' +
    '.wa .tot b{font-weight:500;font-size:31px;letter-spacing:-.015em;font-variant-numeric:tabular-nums;color:' + INK + ' !important}' +
    '.wa .none{padding:18px 2px;font-size:21px;color:#94A3B8}' +
    '.wa .note{font-size:17px;color:' + MUTE + ';padding:0 2px 6px}' +
    '.wa .foot{display:flex;justify-content:space-between;align-items:center;padding:24px 52px 30px;margin-top:30px;border-top:1px solid ' + LINE + ';font-size:18px;color:' + MUTE + '}' +
    '.wa .foot .p{color:' + INK + '}' +
    '.wa .brand{font-size:16px;letter-spacing:.22em;text-transform:uppercase;color:#94A3B8}';

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
    function count(n) { return n + (n === 1 ? ' entry' : ' entries'); }
    function by(x) { return combined && x.by ? '<span class="tag ' + (x.by === 'Head Office' ? 'ho' : 'site') + '">' + esc(x.by) + '</span>' : ''; }
    function section(title, rows, hue, kind) {
      var h = HUE[hue];
      var body = rows.length ? rows.map(function (x) {
        var name = kind === 'trf' ? esc(x.from) + ' → ' + esc(x.to) : (x.party ? esc(short(x.party, 34)) : '');
        var first = name || esc(short(x['for'], 40));
        var meta = '<span class="v">' + esc(x.no) + '</span>' +
          (kind === 'trf' ? (x.cheque ? ' · cheque …' + esc(x.cheque) : '') : (name ? ' · ' + esc(short(x['for'], combined ? 44 : 54)) : '')) + by(x);
        return '<div class="row"><div class="who"><div class="nm' + (name ? '' : ' dim') + '">' + first + '</div><div class="meta">' + meta + '</div></div>' +
          '<div class="amt" style="color:' + h.ink + '">' + pk(x.amount) + '</div></div>';
      }).join('') : '<div class="none">Nothing today.</div>';
      return '<section class="sec"><div class="sh" style="background:' + h.tint + '"><h2 style="color:' + h.ink + '">' + title + '</h2>' +
        '<span class="pill" style="color:' + h.ink + '">' + count(rows.length) + '</span></div>' +
        '<div class="rows">' + body +
        (rows.length ? '<div class="tot"><span>' + (kind === 'trf' ? 'Moved between cash and bank' : 'Total ' + title.toLowerCase()) + '</span><b style="color:' + h.ink + '">' + pk(tot(rows)) + '</b></div>' : '') +
        (kind === 'trf' ? '<div class="note">Transfers are not counted as money received or paid.</div>' : '') +
        '</div></section>';
    }
    var boxes = rep.boxes || [];
    var boxHtml = '<div class="boxes">' + boxes.map(function (b) {
      var h = HUE[b.via] || HUE.Cash, t = Number(b.transfers);
      function cell(label, v, sign) {
        return '<div><span>' + label + '</span><b' + (Number(v) ? '' : ' class="z"') + '>' + (Number(v) ? (sign || '') + pk(v) : '–') + '</b></div>';
      }
      return '<div class="box" style="background:' + h.tint + ';border-color:' + h.line + '">' +
        '<div class="bn" style="color:' + h.ink + '"><span>' + esc(b.label) + '</span><small>closing balance</small></div>' +
        '<div class="big" style="color:' + h.ink + '">Rs ' + pk(b.closing) + '</div>' +
        '<div class="flow">' + cell('Opening', b.opening) + cell('Received', b.received, '+') + cell('Paid', b.paid, '−') +
        '<div><span>Transfers</span><b' + (t ? '' : ' class="z"') + '>' + (t > 0 ? '+' : t < 0 ? '−' : '') + pz(Math.abs(t)) + '</b></div></div></div>';
    }).join('') + '</div>';
    function tile(label, rows, hue) {
      var h = HUE[hue];
      return '<div class="tile" style="background:' + h.tint + ';border-color:' + h.line + '"><span style="color:' + h.ink + '">' + label + '</span>' +
        '<b style="color:' + (rows.length ? h.ink : '#94A3B8') + '">' + pz(tot(rows)) + '</b><small>' + count(rows.length) + '</small></div>';
    }
    return '<div class="wa"><style>' + CSS + '</style><div class="paper">' +
      '<div class="mast"><div><div class="eyebrow">' + esc(String(rep.title || '').split(' — ')[0]) + '</div>' +
      '<h1 class="title">Daily Closing</h1><div class="date">' + esc(dateText(rep.date)) + '</div></div>' +
      '<span class="view">' + esc(rep.view_name) + ' view</span></div>' +
      '<div class="ribbon"><i style="background:#0EA5E9"></i><i style="background:#14B8A6"></i><i style="background:#8B5CF6"></i><i style="background:#F59E0B"></i><i style="background:#F43F5E"></i></div>' +
      '<div class="body">' +
      '<p class="lbl">' + (boxes.some(function (b) { return b.via === 'Bank'; }) ? 'Cash and bank' : 'Cash') + '</p>' + boxHtml +
      '<p class="lbl">The day at a glance</p><div class="glance">' + tile('Money received', rec, 'rec') + tile('Money paid', pay, 'pay') + tile('Transfers', trf, 'trf') + '</div>' +
      section('Money received', rec, 'rec', 'rec') + section('Money paid', pay, 'pay', 'pay') + (trf.length ? section('Transfers', trf, 'trf', 'trf') : '') +
      '</div>' +
      '<div class="foot"><div>Prepared by <span class="p">' + esc(rep.prepared_by || '') + '</span> · ' + esc(stamp(rep.generated_at)) + '</div><div class="brand">NexuFinance</div></div>' +
      '</div></div>';
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
