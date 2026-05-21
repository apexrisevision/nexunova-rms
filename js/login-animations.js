(function() {

  // ── Entrance sequence ──────────────────────────────────────
  function runEntrance() {
    var els = document.querySelectorAll('.lx-reveal');
    // tiny delay so CSS is painted
    setTimeout(function() {
      els.forEach(function(el) {
        var delay = parseFloat(el.style.transitionDelay || 0) * 1000;
        setTimeout(function() { el.classList.add('visible'); }, delay);
      });
    }, 80);  }

  // ── Cursor: subtle dot + ring (clean, website-style) ──────────
  function initCursorTrail() {
    var dot  = document.createElement('div');
    var ring = document.createElement('div');
    dot.style.cssText  = 'position:fixed;width:6px;height:6px;background:#00d9ff;border-radius:50%;pointer-events:none;z-index:99999;transform:translate(-50%,-50%);transition:background 0.3s;will-change:transform;';
    ring.style.cssText = 'position:fixed;width:30px;height:30px;border:1.5px solid rgba(0,217,255,0.55);border-radius:50%;pointer-events:none;z-index:99998;transform:translate(-50%,-50%);transition:width 0.3s,height 0.3s,border-color 0.3s;will-change:transform;';
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    var mx = 0, my = 0, rx = 0, ry = 0;

    document.addEventListener('mousemove', function(e) {
      mx = e.clientX; my = e.clientY;
      dot.style.left  = mx + 'px';
      dot.style.top   = my + 'px';
    }, { passive: true });

    // Ring follows with lag — stops completely once login animations are killed
    (function moveRing() {
      if (_lxStopped) {
        dot.remove(); ring.remove();  // clean up DOM elements too
        return;
      }
      var loginEl = document.getElementById('s-login');
      if (!loginEl || !loginEl.classList.contains('on')) {
        dot.style.display  = 'none';
        ring.style.display = 'none';
        setTimeout(function() { requestAnimationFrame(moveRing); }, 2000);
        return;
      }
      dot.style.display  = '';
      ring.style.display = '';
      rx += (mx - rx) * 0.12;
      ry += (my - ry) * 0.12;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(moveRing);
    })();

    // Expand ring on hover over clickables
    document.querySelectorAll('button, a, input, .lx-feat-icon').forEach(function(el) {
      el.addEventListener('mouseenter', function() {
        ring.style.width = '48px'; ring.style.height = '48px';
        ring.style.borderColor = 'rgba(168,85,247,0.6)';
        dot.style.background = '#a855f7';
      });
      el.addEventListener('mouseleave', function() {
        ring.style.width = '30px'; ring.style.height = '30px';
        ring.style.borderColor = 'rgba(0,217,255,0.55)';
        dot.style.background = '#00d9ff';
      });
    });
  }

  // Track all interval IDs + RAF stop flag so they can be killed on login
  var _lxIntervals = [];
  var _lxStopped   = false;

  // ── Button periodic shimmer ────────────────────────────────
  function initButtonShimmer() {
    var shimmer = document.getElementById('lx-shimmer');
    if (!shimmer) return;
    function runShimmer() {
      shimmer.classList.remove('run');
      void shimmer.offsetWidth;
      shimmer.classList.add('run');
    }
    setTimeout(runShimmer, 2500);
    _lxIntervals.push(setInterval(runShimmer, 5000));
  }

  // ── Feature icon sequential glow ─────────────────────────
  function initFeatureGlow() {
    var icons = document.querySelectorAll('.lx-feat-icon');
    if (!icons.length) return;
    var idx = 0;
    _lxIntervals.push(setInterval(function() {
      icons.forEach(function(ic) { ic.classList.remove('glowing'); });
      icons[idx].classList.add('glowing');
      idx = (idx + 1) % icons.length;
    }, 1800));
  }

  // ── Logo scanline ─────────────────────────────────────────
  function initLogoScanline() {
    var sl = document.getElementById('lx-scanline');
    if (!sl) return;
    function runScan() {
      sl.classList.remove('scanning');
      void sl.offsetWidth;
      sl.classList.add('scanning');
    }
    setTimeout(runScan, 1200);
    _lxIntervals.push(setInterval(runScan, 6000));
  }

  // ── Stats count-up ────────────────────────────────────────
  function countUp(el, target, suffix) {
    el.classList.add('counting');
    var start   = 0;
    var dur     = 1400;
    var startTs = null;
    function step(ts) {
      if (!startTs) startTs = ts;
      var prog = Math.min((ts - startTs) / dur, 1);
      var ease = 1 - Math.pow(1 - prog, 3);
      el.textContent = Math.floor(ease * target) + (suffix || '');
      if (prog < 1) requestAnimationFrame(step);
      else el.textContent = target + (suffix || '');
    }
    requestAnimationFrame(step);
  }

  function initStatsCounter() {
    // Called when stats are populated by initLogin()
    var orig = window.initLogin;
    if (typeof orig === 'function') {
      window.initLogin = function() {
        orig.apply(this, arguments);
        // Kick counter after short delay
        setTimeout(triggerCounters, 2800);
      };
    }
    // Also run on a timer in case initLogin already ran
    setTimeout(triggerCounters, 3000);
  }

  function triggerCounters() {
    var units   = document.getElementById('ls-units');
    var sold    = document.getElementById('ls-sold');
    var pending = document.getElementById('ls-pending');
    function tryCount(el) {
      if (!el || el.textContent === '—' || isNaN(parseInt(el.textContent))) return false;
      var val = parseInt(el.textContent);
      if (!el.dataset.counted) { el.dataset.counted = '1'; countUp(el, val, ''); }
      return true;
    }
    tryCount(units); tryCount(sold); tryCount(pending);
  }

  // ── Typewriter on description ─────────────────────────────
  function initTypewriter() {
    var el = document.getElementById('lx-typewriter-target');
    if (!el) return;
    var originalText = el.textContent.trim();
    el.textContent = '';
    var cursor = document.createElement('span');
    cursor.style.cssText = 'display:inline-block;width:2px;height:1em;background:#00d9ff;vertical-align:text-bottom;margin-left:2px;animation:lxBlink 1s step-end infinite;border-radius:1px;';
    el.appendChild(cursor);

    // Start typing after entrance reveal
    setTimeout(function() {
      var i = 0;
      var txt = document.createTextNode('');
      el.insertBefore(txt, cursor);
      var iv = setInterval(function() {
        if (i < originalText.length) {
          txt.textContent += originalText[i++];
        } else {
          clearInterval(iv);
          // Remove cursor after 3s
          setTimeout(function() { cursor.style.display = 'none'; }, 3000);
        }
      }, 22);
    }, 1600);
  }

  // ── Add blink keyframe if not present ────────────────────
  (function() {
    var style = document.createElement('style');
    style.textContent = '@keyframes lxBlink{0%,100%{opacity:1;}50%{opacity:0;}}';
    document.head.appendChild(style);
  })();

  // ── Button click burst ────────────────────────────────────
  function initButtonBurst() {
    var btn = document.getElementById('lx-signin-btn');
    if (!btn) return;
    btn.addEventListener('click', function(e) {
      // Spawn burst particles from button center
      var rect = btn.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top  + rect.height / 2;
      var cv  = document.getElementById('lx-cursor-canvas');
      if (!cv) return;
      var ctx = cv.getContext('2d');
      var burst = [];
      for (var i = 0; i < 24; i++) {
        var angle = (i / 24) * Math.PI * 2;
        var spd   = Math.random() * 6 + 3;
        burst.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          r: Math.random() * 4 + 2,
          life: 1,
          decay: 0.04,
          color: i % 2 === 0 ? 'rgba(0,217,255,' : 'rgba(168,85,247,'
        });
      }
      (function drawBurst() {
        burst.forEach(function(p) {
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.92; p.vy *= 0.92;
          p.life -= p.decay;
          if (p.life <= 0) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
          ctx.fillStyle = p.color + p.life + ')';
          ctx.fill();
        });
        burst = burst.filter(function(p) { return p.life > 0; });
        if (burst.length) requestAnimationFrame(drawBurst);
      })();
    });
  }

  // ── Stop all login animations (called on successful login) ──
  window.stopLoginAnimations = function() {
    _lxStopped = true;  // stops cursor RAF on next tick
    _lxIntervals.forEach(function(id) { clearInterval(id); });
    _lxIntervals = [];
  };

  // ── Initialise all ────────────────────────────────────────
  function init() {
    runEntrance();
    initCursorTrail();
    initButtonShimmer();
    initFeatureGlow();
    initLogoScanline();
    initStatsCounter();
    initTypewriter();
    initButtonBurst();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
