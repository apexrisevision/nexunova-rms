(function () {
  'use strict';

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateInteger(el, target, duration) {
    var startTime = null;
    var original = el.textContent;
    function step(ts) {
      if (!startTime) startTime = ts;
      var p = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.round(easeOut(p) * target);
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = original;
      }
    }
    requestAnimationFrame(step);
  }

  function runStagger(pg) {
    var all = Array.from(pg.querySelectorAll(
      '.d-kpi, .d-fin-card, .d-qa-card, .card'
    ));
    var seen = new Set();
    var targets = all.filter(function (el) {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    targets.forEach(function (el, i) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      el.style.transition = 'none';
      setTimeout(function () {
        el.style.transition = 'opacity 400ms ease-out, transform 400ms ease-out';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 30 + i * 60);
    });
  }

  function runCountUp(pg) {
    pg.querySelectorAll('.d-kpi-val').forEach(function (el) {
      var n = parseInt(el.textContent.replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) animateInteger(el, n, 700);
    });
  }

  window.initDashCounters = function () {
    var pg = document.getElementById('pg-dashboard');
    if (!pg) return;
    setTimeout(function () {
      runStagger(pg);
      runCountUp(pg);
    }, 50);
  };
})();
