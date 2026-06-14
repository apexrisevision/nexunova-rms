/* ════════════════════════════════════════════════════════════════════════
   NXBell — topbar recovery-alerts bell. Live-derived (no cron): promises
   overdue/due/broken + follow-ups overdue/due, from get_recovery_alerts.
   Badge = action-needed count; dropdown lists them; click → act.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  // S and supabase are lexical top-level globals (NOT on window) — reference bare.
  var S_ = function () { try { return (typeof S !== 'undefined' && S) ? S : (global.S || {}); } catch (e) { return global.S || {}; } };
  var SB = function () { try { return (typeof supabase !== 'undefined' && supabase) ? supabase : global.supabase; } catch (e) { return global.supabase; } };
  var esc = function (s) { return (typeof global.esc === 'function') ? global.esc(s == null ? '' : s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return (typeof global.fM === 'function') ? global.fM(Number(n || 0)) : Number(n || 0).toLocaleString('en-US'); };
  var fdate = function (d) { return (typeof global.fD === 'function') ? global.fD(d) : (d || ''); };
  var TONE = { danger: 'var(--fk-danger)', warning: 'var(--fk-warning)', info: 'var(--fk-info)' };

  var state = { items: [], total: 0, open: false, loading: false };

  function badgeEl()  { return document.getElementById('nx-tb-bell-badge'); }
  function menuEl()   { return document.getElementById('nx-tb-bell-menu'); }

  function renderBadge() {
    var b = badgeEl(); if (!b) return;
    if (state.total > 0) { b.textContent = state.total > 99 ? '99+' : String(state.total); b.style.display = ''; }
    else b.style.display = 'none';
  }

  async function load() {
    var s = S_(); var sb = SB(); if (!s.cid || !sb) return;
    state.loading = true;
    try {
      var r = await sb.rpc('get_recovery_alerts', { p_company_id: s.cid });
      if (!r.error && r.data) { state.items = r.data.items || []; state.total = Number(r.data.total || 0); }
    } catch (e) { /* silent — bell is non-critical */ }
    state.loading = false;
    renderBadge();
    if (state.open) renderList();
  }

  function rowHtml(it, i) {
    var tone = TONE[it.sev] || TONE.info;
    var sub = (it.unit ? esc(it.unit) + ' · ' : '') + (it.amount != null ? money(it.amount) + ' · ' : '') + 'due ' + esc(fdate(it.date));
    return '<button class="nx-bell-item" role="menuitem" onclick="NXBell.go(' + i + ')">' +
      '<span class="nx-bell-dot" style="background:' + tone + '"></span>' +
      '<span class="nx-bell-tx">' +
        '<span class="nx-bell-t">' + esc(it.title) + '</span>' +
        '<span class="nx-bell-c">' + esc(it.name || '—') + '</span>' +
        '<span class="nx-bell-s">' + sub + '</span>' +
      '</span></button>';
  }

  function renderList() {
    var m = menuEl(); if (!m) return;
    var head = '<div class="nx-bell-hd"><span>Recovery alerts</span>' +
      (state.total ? '<span class="nx-bell-hd-n">' + state.total + '</span>' : '') + '</div>';
    var body = state.items.length
      ? '<div class="nx-bell-list">' + state.items.map(rowHtml).join('') + '</div>'
      : '<div class="nx-bell-empty">' + (state.loading ? 'Loading…' : 'No recovery alerts — you’re on top of it.') + '</div>';
    var foot = '<button class="nx-bell-foot" onclick="NXBell.close();nav(\'reminders\')">Open Reminders →</button>';
    m.innerHTML = head + body + foot;
  }

  function open()  { var m = menuEl(); if (!m) return; state.open = true; m.classList.add('on'); renderList(); load(); }
  function close() { var m = menuEl(); if (!m) return; state.open = false; m.classList.remove('on'); }

  function toggle(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    state.open ? close() : open();
  }

  function go(i) {
    var it = state.items[i]; close();
    if (!it) return;
    if (it.sale_id && typeof global.openSaleDetail === 'function') global.openSaleDetail(it.sale_id);
    else if (typeof global.nav === 'function') global.nav('reminders');
  }

  // close on outside click / Esc
  document.addEventListener('click', function (e) {
    if (!state.open) return;
    var wrap = document.getElementById('nx-tb-bell-wrap');
    if (wrap && !wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });

  // refresh on navigation + a gentle poll (5 min)
  var _pollStarted = false;
  function startPoll() { if (_pollStarted) return; _pollStarted = true; setInterval(function () { if (S_().cid) load(); }, 300000); }

  global.NXBell = { load: load, toggle: toggle, close: close, go: go, _state: state, startPoll: startPoll };
})(window);
