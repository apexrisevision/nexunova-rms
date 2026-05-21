/* ════════════════════════════════════════════════════════════════
   AURORA FOOTER — Hover reveal + grab-handle click
   ════════════════════════════════════════════════════════════════ */
(function () {
  var _closeTimer = null;

  function initFooter() {
    var foot  = document.getElementById('auroraFoot');
    var strip = foot ? foot.querySelector('.aurora-foot-strip') : null;
    var grab  = foot ? foot.querySelector('.aurora-foot-grab')  : null;

    if (!foot) return;

    var open = function () {
      clearTimeout(_closeTimer);
      foot.classList.add('is-open');
    };

    var close = function () {
      _closeTimer = setTimeout(function () {
        foot.classList.remove('is-open');
      }, 280);
    };

    /* Mouse spotlight tracking */
    foot.addEventListener('mousemove', function (e) {
      var rect = foot.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1);
      var y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1);
      foot.style.setProperty('--mx', x + '%');
      foot.style.setProperty('--my', y + '%');
    }, { passive: true });

    /* Hover on the whole footer */
    foot.addEventListener('mouseenter', open);
    foot.addEventListener('mouseleave', close);

    /* Click on grab-handle or strip also toggles */
    if (grab) {
      grab.addEventListener('click', function () {
        if (foot.classList.contains('is-open')) {
          foot.classList.remove('is-open');
        } else {
          open();
        }
      });
    }
    if (strip) {
      strip.addEventListener('click', function () {
        if (!foot.classList.contains('is-open')) open();
      });
    }

    /* Escape key closes */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') foot.classList.remove('is-open');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooter);
  } else {
    initFooter();
  }
})();
