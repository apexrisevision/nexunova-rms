/* ════════════════════════════════════════════════════════════════════════════
   NEXUNOVA RMS — SHELL CHROME  (Nav phase · 2026-06-12)
   ----------------------------------------------------------------------------
   Owns the thin utility topbar that REPLACED the retired Aurora mega-menu:
     • global search (⌘K — the global handler lives in search.js, unchanged)
     • "+ New" menu (the retired FAB's actions, role-aware — QuickBooks pattern)
     • theme toggle (#tb-theme-btn — wired by theme.js, unchanged)
     • company chip (#tb-c — filled by updateCoLogo in ui.js) + super-admin link
   The page title (#tb-t) is set by nav() in ui.js. No DB / RPC / page content.
   ════════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  function esc(s){
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }
  function icon(name, size){
    return (typeof _sbi === 'function') ? _sbi(name, size || 16) : '';
  }

  /* ── "+ New" action catalogue — every action launches an EXISTING flow ───── */
  const NEW_ACTIONS = [
    { id:'newsale', lb:'New Sale',        ic:'file-text',      run:function(){ nav('newsale'); } },
    { id:'payment', lb:'Record Payment',  ic:'banknote',       run:function(){ nav('addpayment'); } },
    { id:'client',  lb:'Add Client',      ic:'user-check',     run:function(){
        if (typeof ClientForm !== 'undefined' && ClientForm.open) {
          ClientForm.open({ onSaved:function(){
            if (typeof rClients === 'function' && document.querySelector('#pg-clients.on')) rClients();
          }});
        } else { nav('clients'); }
      } },
    { id:'unit',    lb:'Add Unit',        ic:'home',           run:function(){ _openOnPage('units', 'openUnitModal'); } },
    { id:'call',    lb:'Log Call',        ic:'phone',          run:function(){ if (typeof openConModal === 'function') openConModal(null); else nav('contacts'); } },
    { id:'visit',   lb:'Log Field Visit', ic:'map-pin',        run:function(){ if (typeof fvOpenLog === 'function') fvOpenLog(); else nav('fieldvisits'); } },
    { id:'promise', lb:'Record Promise',  ic:'handshake',      run:function(){ if (typeof prmLogNew === 'function') prmLogNew(); else nav('promises'); } },
    { id:'pdc',     lb:'Add PDC',         ic:'calendar-clock', run:function(){ _openOnPage('pdc', '_pdcOpenBundle'); } },
  ];

  /* Navigate to a page, then open its create-modal once the page state exists.
     Used for Add Unit / Add PDC whose modal builders read page-level caches. */
  function _openOnPage(pg, fnName){
    if (typeof nav === 'function') nav(pg);
    setTimeout(function(){ if (typeof global[fnName] === 'function') global[fnName](null); }, 80);
  }

  /* Which "+ New" actions the current role may launch (mirrors nav()'s gate). */
  function _allowedActions(){
    var role = (typeof effectiveRole === 'function') ? effectiveRole() : (global.S && S.role) || '';
    var isA  = role === 'admin' || role === 'owner';
    var isR  = role === 'recovery' || role === 'recovery_officer';
    var isAc = role === 'accounts' || role === 'finance';
    var isM  = role === 'manager';

    if (isA) return NEW_ACTIONS.map(a => a.id);
    if (isM) return [];                                   // manager = read-only
    if (isR) return ['payment','client','call','visit','promise','pdc'];
    if (isAc) return ['payment','pdc'];

    // staff / other — permission-driven (hide the button if they can create nothing)
    var perm = (typeof hasPermission === 'function') ? hasPermission : function(){ return false; };
    var map = {
      newsale:'sales', payment:'recovery', client:'clients', unit:'units',
      call:'contacts', visit:'fieldvisits', promise:'promises', pdc:'pdc'
    };
    return NEW_ACTIONS.map(a => a.id).filter(id => perm(map[id]));
  }

  function _isSuperAdmin(){
    try { return !!JSON.parse(sessionStorage.getItem('nxn_sess') || '{}').isSuperAdmin; }
    catch (e) { return false; }
  }

  /* ── (Re)build the topbar's role-aware bits. Called from buildSB in ui.js. ─ */
  function buildTopbar(){
    var wrap = document.getElementById('nx-tb-new-wrap');
    var menu = document.getElementById('nx-tb-new-menu');
    if (wrap && menu) {
      var ids = _allowedActions();
      if (!ids.length) {
        wrap.style.display = 'none';
      } else {
        wrap.style.display = '';
        var html = '<div class="nx-menu-label">Create</div>';
        NEW_ACTIONS.forEach(function(a){
          if (ids.indexOf(a.id) < 0) return;
          html += '<button class="nx-menu-item" type="button" onclick="NXShell.run(\'' + a.id + '\')">'
                + icon(a.ic, 16) + esc(a.lb) + '</button>';
        });
        menu.innerHTML = html;
      }
    }
    // Super-admin console link — only for a verified super-admin session.
    var sa = document.getElementById('nx-tb-superadmin');
    if (sa) sa.style.display = _isSuperAdmin() ? '' : 'none';
    // Recovery alerts bell — load the count + start the gentle poll (post-login).
    if (global.NXBell) { try { global.NXBell.load(); global.NXBell.startPoll(); } catch (e) {} }
  }

  /* ── Menu open/close (used by + New and the company/super-admin popover) ─── */
  function _closeAll(except){
    document.querySelectorAll('#s-app .nx-menu.is-open').forEach(function(m){
      if (m !== except) m.classList.remove('is-open');
    });
  }
  function toggleMenu(id){
    var m = document.getElementById(id);
    if (!m) return;
    var willOpen = !m.classList.contains('is-open');
    _closeAll(willOpen ? m : null);
    m.classList.toggle('is-open', willOpen);
  }
  function run(actionId){
    _closeAll(null);
    var a = NEW_ACTIONS.find(function(x){ return x.id === actionId; });
    if (a) a.run();
  }
  function openSuperAdmin(){
    _closeAll(null);
    global.location.href = global.location.pathname + '?super-admin';
  }

  /* Search field focus ring on click-through to the search page. */
  function _wireSearch(){
    var s = document.getElementById('nx-tb-search');
    if (!s) return;
    s.addEventListener('mousedown', function(){ s.classList.add('is-focus'); });
  }

  function init(){
    _wireSearch();
    // outside-click + Esc close every shell popover
    document.addEventListener('click', function(e){
      if (!e.target.closest('.nx-tb-new-wrap') && !e.target.closest('.nx-tb-co-wrap') && !e.target.closest('.nx-tb-proj-wrap')) _closeAll(null);
    });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') _closeAll(null); });
    buildTopbar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* Public surface */
  global.buildTopbar = buildTopbar;                 // called by buildSB() on role change
  global.NXShell = { run: run, toggleMenu: toggleMenu, openSuperAdmin: openSuperAdmin, build: buildTopbar };
})(window);
