// Theme Manager — Nexunova RMS
(function() {
  var THEME_KEY = 'rms.theme';

  // Colors that are invisible (white / near-white) on a light background.
  // CSS handles most cases via [data-theme="light"] [style*="color:white"] selectors,
  // but JS catches variants that CSS attribute selectors miss (different spacing, casing).
  var INVISIBLE_ON_LIGHT = [
    'white', '#fff', '#ffffff',
    '#e2e8f0', '#cbd5e1', '#94a3b8', '#f1f5f9',
    'rgb(255, 255, 255)', 'rgb(226, 232, 240)',
    'rgb(203, 213, 225)', 'rgb(148, 163, 184)', 'rgb(241, 245, 249)'
  ];

  function fixLightModeText() {
    document.querySelectorAll('*').forEach(function(el) {
      if (el.closest('#s-login')) return;
      var inlineColor = el.style.color;
      if (!inlineColor) return;
      var lower = inlineColor.toLowerCase();
      if (INVISIBLE_ON_LIGHT.some(function(c) { return lower === c.toLowerCase() || lower.replace(/\s/g,'') === c.toLowerCase().replace(/\s/g,''); })) {
        el.setAttribute('data-orig-color', inlineColor);
        el.style.color = '';
      }
    });
  }

  function restoreColors() {
    document.querySelectorAll('[data-orig-color]').forEach(function(el) {
      el.style.color = el.getAttribute('data-orig-color');
      el.removeAttribute('data-orig-color');
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    // Icon shows what you'll GET when you click:
    //   Light mode → moon  (click to go dark)
    //   Dark  mode → sun   (click to go light)
    var icon = document.getElementById('tb-theme-icon');
    if (icon) {
      if (theme === 'light') {
        icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
      } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
      }
    }

    if (theme === 'light') {
      fixLightModeText();
    } else {
      restoreColors();
    }

    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  function init() {
    var saved = localStorage.getItem(THEME_KEY) || 'dark';

    // Suppress transitions during initial apply to avoid flash
    document.documentElement.classList.add('no-transitions');
    applyTheme(saved);
    setTimeout(function() {
      document.documentElement.classList.remove('no-transitions');
    }, 120);

    document.addEventListener('click', function(e) {
      if (e.target.closest('#tb-theme-btn')) {
        toggleTheme();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.toggleTheme = toggleTheme;
  window.applyTheme  = applyTheme;
})();
