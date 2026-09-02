// ══════════════════════════════════════════════════════════════════════════
// AMOUNT IN WORDS — under every money field, everywhere
// ──────────────────────────────────────────────────────────────────────────
// Type 10000 into an amount box and "Ten Thousand Only" appears under it; type
// 100000 and it reads "One Hundred Thousand Only". A cheque, a receipt and a
// voucher are all read back in words before they are signed, so the words have
// to be on the screen the number is typed on — not only on the printout.
//
// One listener for the whole app rather than a line per form: the money fields
// live in ~20 pages and modals, several of them built as raw markup rather than
// NX.field, and a per-page edit would miss the next one somebody adds.
//
// A field qualifies on its own LABEL, not its id — that is what a human reads.
// "Amount (PKR)", "Default price (PKR)", "Refund amount" qualify; "Count",
// "Discount %", "Default area (sqft)", "No. of installments", latitude and
// longitude do not. Opt in with data-words on anything the rule misses, opt out
// with data-no-words.
//
// Numbers come from amtWords() (js/pages/print.js) — the same function that
// writes the words on the printed receipt, so the screen and the paper can
// never disagree. Paisa are appended here rather than in amtWords, which
// rounds by design for the documents.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // Reads as money…
  var MONEY = /(amount|amt\b|price|payable|paid|salary|fee|cost|charge|discount|advance|refund|target|balance|budget|rent|down\s*payment|commission|pkr|\brs\b)/i;
  // …unless the label says it is a count or a measurement.
  // \bcount\b, not count — otherwise "Discount" disqualifies itself.
  var NOT_MONEY = /(percent|\bcounts?\b|\bqty\b|quantity|\bno\.?\s*of\b|number\s+of\b|\barea\b|sq\.?\s*ft|sqft|marla|kanal|instal?lments?\b|\bmonths?\b|\bdays?\b|\byears?\b|\border\b|latitude|longitude|\blat\b|\blng\b|tenure|duration)/i;
  // A percentage is never an amount, wherever the sign appears.
  var PCT = /%/;

  var CLS = 'nx-amt-words';

  // ── words ────────────────────────────────────────────────────────────────
  // amtWords() already ends every string with " Only" and returns bare "Zero".
  function words(value) {
    if (typeof global.amtWords !== 'function') return '';
    var n = Number(value);
    if (!isFinite(n) || n === 0) return '';
    var neg = n < 0;
    n = Math.abs(n);
    var rupees = Math.floor(n);
    var paisa  = Math.round((n - rupees) * 100);
    if (paisa === 100) { rupees += 1; paisa = 0; }        // 9.999 → 10.00, not 9 and 100

    var out;
    if (rupees === 0) {
      out = strip(global.amtWords(paisa)) + ' Paisa Only';
    } else {
      out = strip(global.amtWords(rupees));
      if (paisa > 0) out += ' and ' + strip(global.amtWords(paisa)) + ' Paisa';
      out += ' Only';
    }
    return (neg ? 'Minus ' : '') + out;
  }
  function strip(s) { return String(s || '').replace(/\s*Only$/, ''); }

  // ── which inputs get the line ────────────────────────────────────────────
  // The app has at least five different field wrappers (.nx-field, .fg, and the
  // rops-/fc- families) with as many label classes, so the label is found by
  // POSITION rather than by class: the nearest <label> above this input, looking
  // one ancestor at a time. That keeps working for markup written after this.
  function labelOf(el) {
    if (el._nxLbl != null) return el._nxLbl;
    var t = '';
    if (el.id) {
      var l = document.querySelector('label[for="' + cssEsc(el.id) + '"]');
      if (l) t = l.textContent;
    }
    for (var box = el.parentElement, hop = 0; !t && box && hop < 4; box = box.parentElement, hop++) {
      var labels = box.querySelectorAll('label');
      for (var i = labels.length - 1; i >= 0; i--) {
        if (labels[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) { t = labels[i].textContent; break; }
      }
    }
    if (!t) t = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    el._nxLbl = t.replace(/\s+/g, ' ').trim();
    return el._nxLbl;
  }
  function cssEsc(s) {
    return (global.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  // The whole rule lives here — isMoneyField() only finds the label and asks.
  // Exposed so it can be exercised on its own, without a form.
  function labelIsMoney(lbl) {
    lbl = String(lbl || '').replace(/\s+/g, ' ').trim();
    if (!lbl || PCT.test(lbl)) return false;
    var head = lbl.replace(/\s*[([][^)\]]*[)\]]/g, ' ').trim() || lbl;
    return MONEY.test(lbl) && !NOT_MONEY.test(head);
  }

  function isMoneyField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.hasAttribute('data-no-words')) return false;
    if (el.hasAttribute('data-words')) return true;
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type !== 'number' && type !== 'text' && type !== 'tel') return false;
    return labelIsMoney(labelOf(el));
  }

  // ── paint ────────────────────────────────────────────────────────────────
  function slot(el) {
    if (el._nxWords && el._nxWords.isConnected) return el._nxWords;
    var box = el.closest('.nx-field');
    var found = box ? box.querySelector('.' + CLS) : null;
    if (!found && !box) {
      var sib = el.nextElementSibling;
      if (sib && sib.classList && sib.classList.contains(CLS)) found = sib;
    }
    if (found) { el._nxWords = found; return found; }
    var node = document.createElement('div');
    node.className = CLS;
    if (box) {
      var err = box.querySelector('.nx-error');
      if (err) box.insertBefore(node, err); else box.appendChild(node);
    } else if (el.parentNode) {
      el.parentNode.insertBefore(node, el.nextSibling);
    } else return null;
    el._nxWords = node;
    return node;
  }

  function paint(el) {
    if (!isMoneyField(el)) return;
    var node = slot(el);
    if (!node) return;
    var txt = words(String(el.value || '').replace(/,/g, ''));
    // Only write when it actually changed: painting is itself a DOM mutation,
    // and the observer below would otherwise keep re-triggering itself forever.
    if (node.textContent !== txt) node.textContent = txt;
    if (node.hidden !== !txt) node.hidden = !txt;   // no empty gap under an empty box
  }

  // Inputs that already carry a line are repainted even when empty — code that
  // clears a field by assignment fires no input event, and the stale words would
  // otherwise sit under a blank box.
  function paintAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('input');
    for (var i = 0; i < list.length; i++) if (list[i].value || list[i]._nxWords) paint(list[i]);
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  // Typing and focus cover what the user does; the observer covers forms that
  // render with a value already in them (Edit voucher, Edit sale, …).
  document.addEventListener('input',   function (e) { paint(e.target); }, true);
  document.addEventListener('focusin', function (e) { paint(e.target); }, true);

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; try { paintAll(document); } catch (e) {} }, 120);
  }
  function observe() {
    var host = document.getElementById('s-app') || document.body;
    if (!host || !global.MutationObserver) return;
    new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe);
  else observe();

  global.NXAmountWords = { words: words, paint: paint, paintAll: paintAll, isMoneyField: isMoneyField, labelIsMoney: labelIsMoney };
})(window);
