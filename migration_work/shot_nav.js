/**
 * NAV PHASE verification — new thin utility topbar + 7-area sidebar + "+ New"
 * menu + collapsed sidebar + RECOVERY "More" tier, in light AND dark.
 * Auth-free post-login fabrication (same trick as shot_shell.js). ZERO DB writes.
 * Also prints the role-aware "+ New" menus (admin vs staff vs manager) for gate 3.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4207;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, 'shots_nav');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(ROOT, p === '/' ? 'login.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}

const FAB = (role, perms) => ({ role, perms });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));

  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle2' });

  async function login(role, perms) {
    await page.evaluate((role, perms) => {
      window.hasPermission = function (p) { return !perms || perms.indexOf(p) >= 0; };
      S = {
        cid: 'test-cid', userId: 'test-user', role: role, name: 'Test User', username: role,
        coName: 'Fourteen Group of Companies', coCode: '14groupofcompanies',
        permissions: {}, assignedProjectIds: null, isProjectAdmin: true,
        hasFinanceUser: true, subStatus: 'active', sessionVersion: 1
      };
      Object.assign(window, {
        _unitsCache: [], _unitsCacheLoaded: true, _clientsCache: [], _clientsCacheLoaded: true,
        _projectsCache: [], _projectsCacheLoaded: true, _appUsersCache: [], _contactLogsCache: [],
        _salesCache: [], _agentsCache: []
      });
      // Demo signals so the semantic chips/dots render (Inbox unread = danger,
      // PDC due = warning, Payments overdue dot). Harness-only fixtures.
      window.gunits = function(){ return [{ status:'Sold' }, { status:'Sold' }]; };
      window.isOverdue = function(){ return true; };
      window.actualPending = function(){ return 1; };
      window.getOverdueDays = function(){ return 30; };
      window._approvalsPending = 2;
      window._pdcDueCount = 3;
      document.getElementById('s-login').classList.remove('on');
      document.getElementById('s-app').classList.add('on');
      if (typeof stopLoginAnimations === 'function') try { stopLoginAnimations(); } catch (e) {}
      if (typeof buildSB === 'function') buildSB();
      // Identity (relocated to topbar avatar) + company chip
      var _av=document.getElementById('sb-av'); if(_av) _av.textContent='R';
      var _un=document.getElementById('sb-un'); if(_un) _un.textContent='Rashid Ali';
      var _ur=document.getElementById('sb-ur'); if(_ur) _ur.textContent='Owner';
      if (typeof updateCoLogo === 'function') try { updateCoLogo(); } catch (e) {}
    }, role, perms || null);
    await new Promise(r => setTimeout(r, 350));
  }

  // ── GATE 3: role-aware "+ New" menus ──
  const newMenus = {};
  for (const cfg of [FAB('admin'), FAB('manager'), FAB('recovery'), FAB('accounts'),
                     FAB('staff', ['clients', 'contacts']), FAB('staff', [])]) {
    await login(cfg.role, cfg.perms);
    newMenus[cfg.role + (cfg.perms ? '(' + cfg.perms.join(',') + ')' : '')] = await page.evaluate(() => {
      const wrap = document.getElementById('nx-tb-new-wrap');
      if (!wrap || wrap.style.display === 'none') return '[+ New hidden]';
      return [...document.querySelectorAll('#nx-tb-new-menu .nx-menu-item')].map(b => b.textContent.trim());
    });
  }

  // ── VERSIONED-KEY MIGRATION: a pre-richness user (stale OLD key, collapsed
  //    everything) must reset ONCE to the new expanded defaults. ──
  await login('admin');
  const migration = await page.evaluate(() => {
    // Simulate an existing user: old key full of collapsed states, new key absent.
    localStorage.setItem('rms.sidebar.groups.v2', JSON.stringify({
      inventory: true, sales: true, recovery: true, reports: true, inbox: true, admin: true
    }));
    localStorage.removeItem('nx.sb.groups.v3');
    buildSB();
    const state = {};
    document.querySelectorAll('#s-app .sb .nav-group[data-gid]').forEach(g => {
      state[g.dataset.gid] = g.classList.contains('collapsed') ? 'collapsed' : 'expanded';
    });
    return state;
  });


  const shots = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); if (typeof buildSB === 'function') buildSB(); }, theme);
    await new Promise(r => setTimeout(r, 200));

    for (const pg of ['dashboard', 'units', 'reports']) {
      await page.evaluate((p) => { try { nav(p); } catch (e) { console.error('nav ' + e.message); } }, pg);
      await new Promise(r => setTimeout(r, 600));
      const f = path.join(OUT, `${pg}_${theme}.png`); await page.screenshot({ path: f }); shots.push(f);
    }

    // "+ New" menu OPEN on dashboard
    await page.evaluate(() => { nav('dashboard'); NXShell.toggleMenu('nx-tb-new-menu'); });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, `newmenu_${theme}.png`) });
    await page.evaluate(() => NXShell.toggleMenu('nx-tb-new-menu'));

    // user menu OPEN (relocated top-right avatar)
    await page.evaluate(() => { document.getElementById('sb-user-pop').classList.add('open'); });
    await new Promise(r => setTimeout(r, 250));
    await page.screenshot({ path: path.join(OUT, `usermenu_${theme}.png`) });
    await page.evaluate(() => { document.getElementById('sb-user-pop').classList.remove('open'); });

    // RECOVERY "More" tier expanded (open the Recovery group + its More)
    await page.evaluate(() => {
      const grp = document.querySelector('.nav-group[data-gid="recovery"]');
      if (grp && grp.classList.contains('collapsed')) toggleNavGroup('recovery');
      const tail = document.querySelector('.nav-grp-more-tail[data-gid="recovery"][hidden]');
      if (tail) toggleNavMore('recovery');
    });
    await new Promise(r => setTimeout(r, 350));
    await page.screenshot({ path: path.join(OUT, `recovery_more_${theme}.png`) });

    // collapsed sidebar
    await page.evaluate(() => toggleSidebar());
    await new Promise(r => setTimeout(r, 350));
    await page.screenshot({ path: path.join(OUT, `collapsed_${theme}.png`) });
    await page.evaluate(() => toggleSidebar());
    await new Promise(r => setTimeout(r, 200));
  }

  // ── GATE 4: no floating elements in the live shell ──
  const floating = await page.evaluate(() => {
    return [...document.querySelectorAll('#s-app *')].filter(el => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && cs.display !== 'none' && el.offsetParent !== null;
    }).map(el => (el.id ? '#' + el.id : '') + '.' + (el.className || '').toString().split(' ').filter(Boolean).join('.')).slice(0, 30);
  });

  await browser.close(); srv.close();
  console.log('SHOTS →', OUT);
  console.log('\n=== GATE 3: "+ New" menus by role ===');
  console.log(JSON.stringify(newMenus, null, 2));
  console.log('\n=== VERSIONED-KEY MIGRATION (stale old key → expanded defaults) ===');
  console.log(JSON.stringify(migration, null, 2));
  console.log('\n=== GATE 4: visible position:fixed under #s-app ===');
  console.log(floating.length ? JSON.stringify(floating, null, 2) : '(none — clean)');
  console.log('\nTOTAL console errors:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 20).join('\n'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
