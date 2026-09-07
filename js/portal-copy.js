/* ══ Copy to clipboard — the portal's one implementation ═════════════════════
   Lifted verbatim out of the IIFE in js/portal-sharelink.js, where it worked
   but could only be used by that one screen. Nothing about the behaviour
   changed; it only stopped being private.

   Two paths, because one is not enough on the phones this portal runs on:
     · navigator.clipboard.writeText — the modern path, but it REJECTS on a
       non-secure origin, when the document is not focused, and on some Android
       WebViews. Its rejection is silent unless you handle it, which is how a
       "Copy" button ends up doing nothing at all.
     · a hidden <textarea> + document.execCommand('copy') — deprecated, still
       the only thing that works in those cases. setSelectionRange is what makes
       it work on iOS, where .select() alone selects nothing.

   And a third outcome that is not a path: when both fail, SAY SO. A copy button
   that silently does nothing is worse than one that admits it, because the
   person walks away believing they have the text.

   Load this BEFORE any module that calls it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function fallback(text, done, fail) {
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(t);
    t.select();
    try { t.setSelectionRange(0, text.length); } catch (e) {}   // iOS needs this
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(t);
    if (ok) done(); else fail();
  }

  /* _portalCopy(text, okMsg, failMsg)
     okMsg   — toast on success. Pass '' to stay silent (caller shows its own).
     failMsg — toast when BOTH paths fail. Defaults to something a person can act
               on rather than a dead end. */
  window._portalCopy = function (text, okMsg, failMsg) {
    text = String(text == null ? '' : text);
    var done = function () { if (okMsg) { try { toast(okMsg, 'ok'); } catch (e) {} } };
    var fail = function () {
      try { toast(failMsg || 'Could not copy — select the text and copy it by hand.', 'warn'); } catch (e) {}
    };
    if (!text) { fail(); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done, fail); });
    } else {
      fallback(text, done, fail);
    }
  };
})();
