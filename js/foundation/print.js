/* ════════════════════════════════════════════════════════════════════════
   NEXUNOVA RMS — FOUNDATION PRINT EMITTER  ·  Phase 2 · 2026-06-12
   ────────────────────────────────────────────────────────────────────────
   window.NXPrint — the single, race-free way to send an HTML document to the
   print / save-as-PDF pipeline.

   WHY THIS EXISTS
   The legacy shared printer _printHTML (js/pages/print.js) used:
       blob → window.open(url) → setTimeout(600){ w.print(); revokeObjectURL() }
   which revokes the blob URL in the same tick it prints — a race that
   intermittently produced blank/again-prompting print windows (proven during
   the Recovery Position print fix). NXPrint.emit uses the proven _rpEmitPrint
   mechanism instead: write the document inline, print on load, with a timed
   fallback for the document.write case where onload may have already passed.
   No blob, nothing to revoke.

   The Electron path (window.electronPrint.print) is preserved unchanged.

   Phase-2 migration note: js/pages/print.js `_printHTML` now delegates here,
   so all 7 existing callers (units, sales, reports, possession ×2,
   ownership-chain, legalcases, ledgers) ride this fix with no code change.
   Report _LAYOUTS_ themselves are Phase 3+. Recovery Position keeps its own
   _rpEmitPrint. The sibling _pw/_pclose voucher printer still has the old
   race — see foundation/KIT.md "Phase-3 TODO".
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function _esc(s) {
    if (typeof global.esc === 'function') return global.esc(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── emit(html, title) ────────────────────────────────────────────────
     Sends a COMPLETE html document string to print. Same signature as the
     old _printHTML so it is a drop-in replacement. */
  function emit(html, title) {
    if (global.electronPrint && typeof global.electronPrint.print === 'function') {
      global.electronPrint.print(html, title || 'Document');
      return;
    }
    var w = global.open('', '_blank', 'width=1100,height=860');
    if (!w) {
      if (typeof global.toast === 'function') global.toast('Allow pop-ups to print / save as PDF', 'warn');
      return;
    }
    // Inline write — no blob URL, so nothing to revoke / race on.
    w.document.open();
    w.document.write(html);
    w.document.close();
    var fired = false;
    var go = function () { if (fired) return; fired = true; try { w.focus(); w.print(); } catch (e) {} };
    try { w.onload = go; } catch (e) {}
    setTimeout(go, 1200); // fallback: with document.write, onload may have already passed
  }

  /* ── reportFrame(opts) ────────────────────────────────────────────────
     The standard "Report Document" wrapper: letterhead block, repeating
     thead rules, and a per-page footer (Generated + Page X of Y). Returns a
     full <!DOCTYPE html> string ready for emit(). Report bodies are supplied
     by the caller as `bodyHTML` (Phase 3 migrates each report's body onto
     this frame; Phase 2 only ships the frame + emitter).

     opts = {
       title,                 // document <title> + letterhead heading
       company, project,      // letterhead lines
       period, generatedBy,   // letterhead lines
       bodyHTML,              // the report's table(s) / content
       orientation: 'portrait' | 'landscape',   // default portrait
       theadRepeat: true      // repeat <thead> on each printed page (default)
     } */
  function reportFrame(opts) {
    opts = opts || {};
    var orient = opts.orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';
    var gen = opts.generated || _nowStamp();
    var infoRow = function (l, v) {
      if (v == null || v === '') return '';
      return '<div class="nxr-info-row"><span class="nxr-l">' + _esc(l) + '</span>' +
             '<span class="nxr-v">' + _esc(v) + '</span></div>';
    };
    var letterhead =
      '<div class="nxr-lh">' +
        '<div class="nxr-lh-title">' + _esc(opts.title || 'Report') + '</div>' +
        '<div class="nxr-infobox">' +
          infoRow('Company', opts.company || (global.S && global.S.coName) || '—') +
          infoRow('Project', opts.project || 'All Projects') +
          infoRow('Period', opts.period || '') +
          infoRow('Generated', gen) +
        '</div>' +
      '</div>';

    var css = _frameCSS(opts.theadRepeat !== false);

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
      _esc(opts.title || 'Report') + '</title>' +
      '<style>@page{size:' + orient + ';margin:14mm 12mm}' + css + '</style></head><body>' +
      letterhead +
      '<div class="nxr-body">' + (opts.bodyHTML || '') + '</div>' +
      '<div class="nxr-foot">Generated: ' + _esc(gen) + '</div>' +
      '</body></html>';
  }

  function _nowStamp() {
    var d = new Date();
    try {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  /* Print stylesheet for the standard frame. Uses ordinary print-black ink and
     repeating table headers; intentionally self-contained (print windows have
     no access to the app's stylesheets). */
  function _frameCSS(theadRepeat) {
    return '' +
      'body{font-family:"Inter",system-ui,sans-serif;color:#111;font-size:12px;margin:0}' +
      '.nxr-lh{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}' +
      '.nxr-lh-title{font-size:16px;font-weight:700;margin-bottom:6px}' +
      '.nxr-infobox{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px}' +
      '.nxr-info-row{font-size:11px}' +
      '.nxr-info-row .nxr-l{display:inline-block;min-width:78px;color:#555;font-weight:600}' +
      '.nxr-info-row .nxr-v{font-weight:600}' +
      '.nxr-body table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}' +
      '.nxr-body th,.nxr-body td{border:1px solid #999;padding:4px 6px;text-align:left}' +
      '.nxr-body th{background:#f1f1f1;font-weight:700;' +
        '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.nxr-body td.num,.nxr-body th.num{text-align:right}' +
      (theadRepeat ? '.nxr-body thead{display:table-header-group}.nxr-body tr{page-break-inside:avoid}' : '') +
      '.nxr-foot{position:fixed;bottom:6mm;left:12mm;right:12mm;font-size:8px;color:#999;' +
        'display:flex;justify-content:space-between;border-top:1px solid #ccc;padding-top:3px}' +
      '@media print{@page{@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:8px;color:#999}}}';
  }

  global.NXPrint = { emit: emit, reportFrame: reportFrame };
})(window);
