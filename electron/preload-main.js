const { ipcRenderer } = require('electron');

// Inject session into sessionStorage BEFORE page scripts run
try {
  const sess = ipcRenderer.sendSync('get-session');
  if (sess) {
    sessionStorage.setItem('nxn_sess', JSON.stringify(sess));
  }
} catch (e) {}
