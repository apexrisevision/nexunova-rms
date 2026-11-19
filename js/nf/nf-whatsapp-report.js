/*
 * NexuFinance — the daily WhatsApp report (owner, 2026-11-19; docs/PLAN.md §51): one portrait picture
 * (JPG, 1080 px wide) and the same as a real PDF file — the CFO's one-page daily brief, 1080 × 1350, 19-Nov, for a date and a view (Site / Head Office / Combined),
 * from nf_day_report. The site login always gets Site — the database decides that, not this file.
 *
 *   NfWaReport.html(report)                   → the report page (pure; the mockups use it too)
 *   NfWaReport.preview(api, companyId, date, view)   the report on screen, then Share / Save picture / Save PDF
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

  // The CFO's end-of-day brief for the directors' group (brief of 19-Nov): one page, 1080 × 1350, like a bank's
  // daily statement — white, dark navy text, one muted accent, thin grey rules, no bands or cards. Type is fixed:
  // title 30 / headings 18 caps / body 17 / notes 14 px. A busy day groups more rows into "Small …"; the type
  // never changes and the page never scrolls. mount() picks the first grouping that fits, in a real layout.
  var NAVY = '#13294B', INK = '#1B2433', MUTE = '#6B7280', RULE = '#E5E7EB', ACC = '#3B5B8C', W = 1080, H = 1350;
  var CSS =
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.wa{width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#fff;color:' + INK + ';font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif;' +
      'font-size:17px;line-height:1.35;padding:48px 60px 34px;display:flex;flex-direction:column}' +
    '.wa .hd{display:flex;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid ' + RULE + '}' +
    '.wa .hd img{height:34px;width:auto}.wa .hd .t{flex:1;min-width:0}' +
    '.wa .hd h1{margin:0;font-size:30px;font-weight:600;letter-spacing:-.015em;color:' + NAVY + ';line-height:1.2}' +
    '.wa .hd .d{color:' + MUTE + ';margin-top:2px}' +
    '.wa .tag{font-size:14px;color:' + ACC + ';border:1px solid ' + ACC + ';border-radius:4px;padding:2px 9px;letter-spacing:.04em;white-space:nowrap}' +
    '.wa h2{margin:22px 0 8px;font-size:18px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + MUTE + '}' +
    '.wa .brief{margin:0;color:' + NAVY + '}.wa .brief p{margin:0 0 4px}' +
    '.wa table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}' +
    '.wa th{font-size:14px;font-weight:500;color:' + MUTE + ';text-align:left;padding:0 0 6px;border-bottom:1px solid ' + RULE + '}' +
    '.wa td{padding:6px 0;border-bottom:1px solid ' + RULE + ';vertical-align:top}' +
    '.wa .r{text-align:right;white-space:nowrap;padding-left:18px}' +
    '.wa .cl{color:' + NAVY + ';font-weight:600}' +
    '.wa .z{color:#B0B6C0}' +
    '.wa .tw{display:grid;grid-template-columns:1fr 1fr;gap:36px}' +
    '.wa table.fx{table-layout:fixed}.wa .ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:14px}' +
    '.wa .sm td{color:' + MUTE + '}' +
    '.wa tfoot td{border-bottom:0;font-weight:600;color:' + NAVY + ';padding-top:7px}' +
    '.wa .none{color:' + MUTE + ';padding:4px 0}' +
    '.wa .sp{flex:1}' +
    '.wa .ft{border-top:1px solid ' + RULE + ';padding-top:12px;display:flex;justify-content:space-between;font-size:14px;color:' + MUTE + ';font-variant-numeric:tabular-nums}' +
    '.wa .ft b{color:' + NAVY + ';font-weight:600}';

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
  // GF-250, GF-251, SF-208 → "GF-250/251, SF-208"
  function shortUnits(units) {
    var by = {}, order = [];
    (units || []).forEach(function (u) {
      var m = /^([A-Z0-9]+)-(.+)$/.exec(u); if (!m) return;
      if (!by[m[1]]) { by[m[1]] = []; order.push(m[1]); }
      if (by[m[1]].indexOf(m[2]) < 0) by[m[1]].push(m[2]);
    });
    var parts = order.map(function (p) { return p + '-' + by[p].join('/'); });
    return parts.length > 3 ? parts.slice(0, 3).join(', ') + ' …' : parts.join(', ');
  }
  function sum(list) { return list.reduce(function (t, x) { return t + Number(x.amount || 0); }, 0); }
  function lc(s) { return String(s || '').replace(/^[A-Z]/, function (c) { return c.toLowerCase(); }); }
  function heads(rows, n) {   // the largest heads by amount, plain names
    var g = {}, order = [];
    rows.forEach(function (x) { var k = x.token ? 'token money' : (x.party && x.head && x.head.indexOf(x.party) >= 0 ? String(x['for'] || x.head) : (x.head || x['for'] || '')); if (!k) return; if (!g[k]) { g[k] = 0; order.push(k); } g[k] += Number(x.amount || 0); });
    order.sort(function (a, b) { return g[b] - g[a]; });
    return order.slice(0, n);
  }
  // Head Office's own lines appear as 'Head Office' only in the site box's report (where they are amount-only)
  function who(x, rep) { return x.party || (rep && rep.view === 'site' && x.by === 'Head Office' ? 'Head Office' : '—'); }
  function what(x) {
    // a token: its number and its units in short — "Token #317 · SF-208", "Token · GF-250/251"
    if (x.token) { var no = (/#s*d+/.exec(String(x['for'] || '')) || [''])[0].replace(/s+/g, ''); var u = shortUnits(x.units); return 'Token' + (no ? ' ' + no : '') + (u ? ' · ' + u : ''); }
    if (x.party && x.head && x.head.indexOf(x.party) >= 0) return String(x['for'] || x.head);   // an advance to a person: what for
    return x.party ? (x.head || x['for'] || '') : (x['for'] || x.head || '');
  }
  function boxName(b) { return b.label; }
  // Site view: what the site accountant's OWN entries put through the bank today — never the BOP balance
  function siteBank(rep) {
    if (rep.view !== 'site') return null;
    var mine = function (x) { return x.bank && x.by !== 'Head Office'; };
    var rec = (rep.received || []).filter(mine), pay = (rep.paid || []).filter(mine);
    var tin = 0, tout = 0;
    (rep.transfers || []).forEach(function (x) {
      if (/BOP/.test(x.to || '')) tin += Number(x.amount || 0);
      if (/BOP/.test(x.from || '')) tout += Number(x.amount || 0);
    });
    if (!rec.length && !pay.length && !tin && !tout) return null;
    return { inn: sum(rec), out: sum(pay), trf: tin - tout, deposited: tin, rec: rec };
  }
  function partyNames(rows) {
    var n = []; rows.forEach(function (x) { if (x.party && n.indexOf(x.party) < 0) n.push(x.party); });
    return n.slice(0, 3).join(', ') + (n.length > 3 ? ' and others' : '');
  }
  function allUnits(rows) { var u = []; rows.forEach(function (x) { u = u.concat(x.units || []); }); return shortUnits(u); }

  // "Today in brief": three or four plain sentences from the figures
  function brief(rep) {
    var rec = rep.received || [], pay = rep.paid || [], trf = rep.transfers || [], out = [];
    var tok = rec.filter(function (x) { return x.token; }), oth = rec.filter(function (x) { return !x.token; });
    var sb = siteBank(rep), told = false;
    if (sb && sb.inn && rec.every(function (x) { return x.party; })) {
      // "Received 33,02,500 from Ali Haider (GF-250/251): 20,00,000 cash, deposited in BOP the same day, and 13,02,500 in cheques straight to BOP."
      var cash = sum(rec) - sb.inn, u = allUnits(tok), t = 'Received ' + pk(sum(rec)) + ' from ' + partyNames(rec) + (u ? ' (' + u + ')' : '');
      var parts = [];
      if (cash > 0) {
        var dep = Math.min(sb.deposited, cash);
        parts.push(pk(cash) + ' cash' + (dep >= cash ? ', deposited in BOP the same day' : dep > 0 ? ', ' + pk(dep) + ' of it deposited in BOP the same day' : ''));
        told = dep > 0;
      }
      parts.push((cash > 0 ? 'and ' : '') + pk(sb.inn) + ' in cheques straight to BOP');
      out.push(t + ': ' + parts.join(', ') + '.');
      rec = [];
    }
    if (told) trf = trf.filter(function (x) { return !(/BOP/.test(x.to || '') && x.from === 'Site Cash'); });
    if (!sum(rep.received || [])) out.push('No money was received.');
    else if (!rec.length) { /* said above */ }
    else {
      var s = 'Received ' + pk(sum(rec));
      if (tok.length && !oth.length) {
        var names = []; tok.forEach(function (x) { if (x.party && names.indexOf(x.party) < 0) names.push(x.party); });
        var units = []; tok.forEach(function (x) { units = units.concat(x.units || []); });
        s += ' in tokens (' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and others' : '') + (units.length ? ', ' + shortUnits(units) : '') + ')';
      } else s += ' (' + heads(rec, 3).join(', ') + ')';
      out.push(s + '.');
    }
    pay = rep.paid || [];
    if (!pay.length) out.push('Nothing was paid.');
    else out.push('Paid ' + pk(sum(pay)) + (rep.view === 'site' ? ' at site' : '') + ' (' + heads(pay, 3).join(', ') + ').');
    if (trf.length === 1) out.push(pk(trf[0].amount) + ' moved from ' + trf[0].from + ' to ' + trf[0].to + '.');
    else if (trf.length > 1) out.push(trf.length + ' transfers between cash and the bank, ' + pk(sum(trf)) + ' in all.');
    out.push('Closing: ' + (rep.boxes || []).map(function (b) { return boxName(b) + ' ' + pk(b.closing); }).join(' · ') + '.');
    return out;
  }
  function entries(rep, rows, max, smallWord, partyHead) {
    if (!rows.length) return '<div class="none">None.</div>';
    var sorted = rows.slice().sort(function (a, b) { return Number(b.amount) - Number(a.amount); });
    var shown = sorted.length > max ? sorted.slice(0, max - 1) : sorted, rest = sorted.length > max ? sorted.slice(max - 1) : [];
    var body = shown.map(function (x) {
      return '<tr><td class="ell">' + esc(who(x, rep)) + '</td><td class="ell">' + esc(what(x)) + '</td><td class="r">' + pk(x.amount) + '</td></tr>';
    }).join('');
    if (rest.length) body += '<tr class="sm"><td class="ell" colspan="2">' + smallWord + ' (' + rest.length + ') — ' + esc(heads(rest, 4).join(', ')) + '</td><td class="r">' + pk(sum(rest)) + '</td></tr>';
    return '<table class="fx"><colgroup><col style="width:38%"><col style="width:42%"><col style="width:20%"></colgroup><thead><tr><th>' + partyHead + '</th><th>For</th><th class="r">Amount</th></tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td colspan="2">Total</td><td class="r">' + pk(sum(rows)) + '</td></tr></tfoot></table>';
  }
  function page(rep, lim) {
    var rec = rep.received || [], pay = rep.paid || [], trf = rep.transfers || [];
    var co = String(rep.title || '').split(' — ')[0] || 'Daily Closing';
    var hd = '<div class="hd">' + (/^Awami/i.test(co) ? '<img src="' + esc(api.logo) + '" alt="">' : '') + '<div class="t"><h1>' + esc(co) + ' — Daily Brief</h1><div class="d">' +
      esc(dateText(rep.date)) + '</div></div><span class="tag">' + esc(String(rep.view_name || '').toUpperCase()) + '</span></div>';
    var br = '<h2>Today in brief</h2><div class="brief">' + brief(rep).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
    function c(v, sign) { return Number(v) ? (sign && Number(v) > 0 ? sign : '') + (Number(v) < 0 ? '−' : '') + pk(Math.abs(Number(v))) : '<span class="z">–</span>'; }
    var cb = '<h2>Cash &amp; bank</h2><table><thead><tr><th></th><th class="r">Opening</th><th class="r">In</th><th class="r">Out</th><th class="r">Transfers</th><th class="r">Closing</th></tr></thead><tbody>' +
      (rep.boxes || []).map(function (b) {
        return '<tr><td>' + esc(boxName(b)) + '</td><td class="r">' + c(b.opening) + '</td><td class="r">' + c(b.received) + '</td><td class="r">' + c(b.paid) + '</td>' +
          '<td class="r">' + c(b.transfers, '+') + '</td><td class="r cl">' + pk(b.closing) + '</td></tr>';
      }).join('') + (function (sb) {
        return sb ? '<tr><td>BOP (bank) <span class="z">— site entries only</span></td><td class="r"><span class="z">–</span></td><td class="r">' + c(sb.inn) + '</td><td class="r">' + c(sb.out) + '</td>' +
          '<td class="r">' + c(sb.trf, '+') + '</td><td class="r"><span class="z">–</span></td></tr>' : '';
      })(siteBank(rep)) + '</tbody></table>';
    var tables = lim.side
      ? '<div class="tw"><div><h2>Money received</h2>' + entries(rep, rec, lim.rows, 'Small receipts', 'From') + '</div><div><h2>Money paid</h2>' + entries(rep, pay, lim.rows, 'Small payments', 'Paid to') + '</div></div>'
      : '<h2>Money received</h2>' + entries(rep, rec, lim.rows, 'Small receipts', 'From') + '<h2>Money paid</h2>' + entries(rep, pay, lim.rows, 'Small payments', 'Paid to');
    var ct = trf.length ? '<h2>Cheques &amp; transfers</h2><table><tbody>' + trf.map(function (x) {
      return '<tr><td>' + (x.cheque ? 'Cheque …' + esc(x.cheque) + ' · ' : '') + esc(x.from) + ' → ' + esc(x.to) + '</td><td class="r">' + pk(x.amount) + '</td></tr>';
    }).join('') + '</tbody></table>' : '';
    var ft = '<div class="sp"></div><div class="ft"><span>Total in <b>' + pk(sum(rec)) + '</b> · Total out <b>' + pk(sum(pay)) + '</b> <span>(transfers excluded)</span></span>' +
      '<span>Prepared by ' + esc(rep.prepared_by || '') + ' · ' + esc(stamp(rep.generated_at)) + '</span></div>';
    return '<div class="wa"><style>' + CSS + '</style>' + hd + br + cb + tables + ct + ft + '</div>';
  }
  // the first layout that fits: full-width tables with up to 8 rows each, then fewer rows, then side by side
  var STEPS = [8, 7, 6, 5].map(function (n) { return { rows: n, side: false }; })
    .concat([8, 7, 6, 5, 4, 3].map(function (n) { return { rows: n, side: true }; }));
  function fits(el) { var w = el.firstChild; return w.scrollHeight <= H + 1 && w.scrollWidth <= W + 1; }
  function mount(el, rep) {
    for (var i = 0; i < STEPS.length; i++) {
      el.innerHTML = page(rep, STEPS[i]);
      if (fits(el)) return STEPS[i];
    }
    return STEPS[STEPS.length - 1];
  }
  function html(rep) { return page(rep, STEPS[0]); }

  var api = { vendorBase: '/vendor/', logo: 'assets/awami-logo.png?v=20260919q' };
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
  function fileName(rep) {
    var p = String(rep.date).split('-');
    return 'Awami Daily Closing ' + p[2] + '-' + MON[+p[1] - 1].slice(0, 3) + '-' + p[0] + ' ' + rep.view_name;
  }
  // the report drawn into a picture (and, for kind 'pdf', a one-page PDF of that picture)
  function render(rep, kind) {
    var vb = api.vendorBase;
    return Promise.all([
      load(vb + 'html2canvas.min.js?v=1.4.1', function () { return typeof global.html2canvas === 'function'; }),
      kind === 'pdf' ? load(vb + 'pdf-lib.min.js?v=1.17.1', function () { return !!global.PDFLib; }) : Promise.resolve(),
    ]).then(function () {
      // laid out on the page but behind it: html2canvas needs a real layout
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;width:1080px;background:#fff';
      document.body.appendChild(host);
      mount(host, rep);
      var name = fileName(rep);
      function draw() { return global.html2canvas(host.firstChild, { scale: 1, backgroundColor: '#ffffff', logging: false, width: W, height: H, windowWidth: W }); }
      function toJpg(cv) { return cv.toDataURL('image/jpeg', 0.92); }
      return waitImages(host).then(draw).then(function (cv) {
          try { return { cv: cv, url: toJpg(cv) }; } catch (e) {
            [].forEach.call(host.querySelectorAll('img'), function (i) { i.remove(); });
            return draw().then(function (cv2) { return { cv: cv2, url: toJpg(cv2) }; });
          }
        })
        .then(function (d) {
          host.remove();
          var cv = d.cv, jpgUrl = d.url;
          if (kind !== 'pdf') {
            return fetch(jpgUrl).then(function (x) { return x.blob(); }).then(function (b) { return { blob: b, name: name + '.jpg' }; });
          }
          var L = global.PDFLib;
          return L.PDFDocument.create().then(function (doc) {
            return doc.embedJpg(jpgUrl).then(function (img) {
              // A4 portrait (pt), the same 4:5 page centred on it with an even margin
              var pw = 595.28, ph = 841.89, w = pw - 56, h = w * cv.height / cv.width;
              doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
              doc.setTitle(name);
              return doc.save();
            });
          }).then(function (bytes) { return { blob: new Blob([bytes], { type: 'application/pdf' }), name: name + '.pdf' }; });
        }, function (e) { host.remove(); throw e; });
    });
  }
  function waitImages(el) {
    return Promise.all([].map.call(el.querySelectorAll('img'), function (i) {
      return i.complete ? 0 : new Promise(function (ok) { i.onload = i.onerror = ok; });
    }));
  }
  function download(nfApi, companyId, date, view, kind) {
    return nfApi.dayReport(companyId, date, view).then(function (rep) {
      return render(rep, kind).then(function (f) { save(f.blob, f.name); return rep; });
    });
  }

  // Preview first (owner, 19-Nov): the report on screen, then Share / Save picture / Save PDF / Close.
  // The picture is drawn as soon as the preview opens, so Share on a phone runs inside the tap.
  var PCSS =
    '.nfwa-back{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;flex-direction:column;align-items:center;padding:16px}' +
    '.nfwa-bar{width:100%;max-width:640px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:#fff;border-radius:14px;padding:10px 12px;margin-bottom:10px;box-shadow:0 8px 24px rgba(0,0,0,.18)}' +
    '.nfwa-bar .t{flex:1 1 180px;font-size:14px;color:#0F172A;min-width:0}.nfwa-bar .t small{display:block;color:#64748B;font-size:12px}' +
    '.nfwa-bar button{font:inherit;font-size:13px;border:1px solid #CBD5E1;background:#fff;color:#0F172A;border-radius:9px;padding:8px 12px;cursor:pointer}' +
    '.nfwa-bar button.pri{background:#2563EB;border-color:#2563EB;color:#fff}.nfwa-bar button:disabled{opacity:.5;cursor:default}' +
    '.nfwa-scroll{width:100%;max-width:640px;flex:0 1 auto;min-height:0;overflow:auto;border-radius:14px;background:#F3F4F6}' +
    '.nfwa-fit{transform-origin:0 0}.nfwa-msg{font-size:12px;color:#fff;margin-top:8px;min-height:16px}';
  function preview(nfApi, companyId, date, view) {
    return nfApi.dayReport(companyId, date, view).then(function (rep) {
      var old = document.getElementById('nfwa-preview'); if (old) old.remove();
      var back = document.createElement('div');
      back.className = 'nfwa-back'; back.id = 'nfwa-preview';
      back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'WhatsApp report preview');
      var canShare = !!(navigator.share && navigator.canShare);
      back.innerHTML = '<style>' + PCSS + '</style>' +
        '<div class="nfwa-bar"><div class="t">Preview — ' + esc(rep.view_name) + ' view<small>' + esc(dateText(rep.date)) + '</small></div>' +
        (canShare ? '<button type="button" class="pri" data-act="share" disabled>Share</button>' : '') +
        '<button type="button"' + (canShare ? '' : ' class="pri"') + ' data-act="jpg" disabled>Save picture</button>' +
        '<button type="button" data-act="pdf">Save PDF</button><button type="button" data-act="close">Close</button></div>' +
        '<div class="nfwa-scroll"><div class="nfwa-fit"></div></div><div class="nfwa-msg" aria-live="polite"></div>';
      document.body.appendChild(back);
      mount(back.querySelector('.nfwa-fit'), rep);
      var scroll = back.querySelector('.nfwa-scroll'), fit = back.querySelector('.nfwa-fit'), msg = back.querySelector('.nfwa-msg');
      function size() {
        var k = Math.min(1, scroll.clientWidth / 1080);
        fit.style.transform = 'scale(' + k + ')';
        fit.style.width = '1080px';
        fit.style.height = (fit.firstChild.offsetHeight * k) + 'px';
      }
      size(); window.addEventListener('resize', size);
      function close() { window.removeEventListener('resize', size); document.removeEventListener('keydown', onKey); back.remove(); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', onKey);
      var jpg = null, pdf = null;
      var jpgReady = render(rep, 'jpg').then(function (f) {
        jpg = f;
        back.querySelectorAll('[data-act="jpg"],[data-act="share"]').forEach(function (b) { b.disabled = false; });
        return f;
      }, function (e) { msg.textContent = 'Could not draw the picture: ' + (e && e.message); });
      back.querySelector('[data-act="close"]').addEventListener('click', close);
      back.querySelector('[data-act="jpg"]').addEventListener('click', function () { if (jpg) save(jpg.blob, jpg.name); });
      back.querySelector('[data-act="pdf"]').addEventListener('click', function (ev) {
        var b = ev.currentTarget; b.disabled = true; msg.textContent = 'Preparing the PDF…';
        (pdf ? Promise.resolve(pdf) : render(rep, 'pdf')).then(function (f) { pdf = f; save(f.blob, f.name); msg.textContent = ''; b.disabled = false; },
          function (e) { msg.textContent = 'Could not make the PDF: ' + (e && e.message); b.disabled = false; });
      });
      var shareBtn = back.querySelector('[data-act="share"]');
      if (shareBtn) shareBtn.addEventListener('click', function () {
        if (!jpg) return;
        var file = new File([jpg.blob], jpg.name, { type: 'image/jpeg' });
        if (!navigator.canShare({ files: [file] })) { save(jpg.blob, jpg.name); return; }
        navigator.share({ files: [file], title: jpg.name }).catch(function () {});
      });
      api._lastPreview = { ready: jpgReady };
      return rep;
    });
  }
  api.html = html;
  api.mount = mount;
  api.page = page;
  api.download = download;
  api.preview = preview;
  global.NfWaReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
