// DEV HELPER - Remove before production
// Auto-login using the actual doLogin() flow.
// - If ?demo / autoDemo flag set (Try Demo button on landing): demo@DEMO / Demo1234
// - Otherwise: KBH / admin123 (developer auto-login)
const DEV_AUTO_LOGIN = false;

window.addEventListener('load', function () {
  // Detect "Try Demo" handoff from landing page (sessionStorage.autoDemo)
  var isDemo = sessionStorage.getItem('autoDemo') === '1';
  if (isDemo) sessionStorage.removeItem('autoDemo');

  if (!isDemo && !DEV_AUTO_LOGIN) return;

  // initLogin in auth.js sets a 1500ms ignore window via _loginReadyAt.
  // Wait past it so doLogin actually fires.
  var delay = isDemo ? 1700 : 150;
  setTimeout(function () {
    var uField = document.getElementById('li-u');
    var pField = document.getElementById('li-p');
    if (!uField || !pField || typeof doLogin !== 'function') return;
    if (isDemo) {
      uField.value = 'demo@DEMO';
      pField.value = 'Demo1234';
    } else {
      uField.value = 'KBH';
      pField.value = 'admin123';
    }
    doLogin();
  }, delay);
});
