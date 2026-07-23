// ══ SEARCHABLE SELECT ════════════════════════
function mkSS(id,opts,val,onChange){
  var wrap=document.createElement('div');wrap.className='ss-wrap';wrap.style.width='100%';
  var inp=document.createElement('input');inp.className='ss-inp';inp.style.width='100%';inp.id=id;
  var drop=document.createElement('div');drop.className='ss-drop';
  var curOpt=opts.find(function(o){return (typeof o==='object'?o.v:o)===(val||'');});
  inp.value=curOpt?(typeof curOpt==='object'?curOpt.l:curOpt):(val||'');
  inp.setAttribute('data-val',val||'');
  opts.forEach(function(o){
    var v=typeof o==='object'?o.v:o,l=typeof o==='object'?o.l:o;
    var d=document.createElement('div');d.className='ss-opt'+(v===(val||'')?' sel':'');
    d.textContent=l;d.setAttribute('data-v',v);
    d.onmousedown=function(e){e.preventDefault();inp.value=l;inp.setAttribute('data-val',v);
      drop.querySelectorAll('.ss-opt').forEach(function(x){x.classList.remove('sel');});
      d.classList.add('sel');drop.classList.remove('open');if(onChange)onChange(v);};
    drop.appendChild(d);
  });
  inp.oninput=function(){var q=inp.value.toLowerCase();drop.querySelectorAll('.ss-opt').forEach(function(o){o.classList.toggle('hide',!o.textContent.toLowerCase().includes(q));});};
  function _ssOpen(){if(!drop.classList.contains('open')){inp.value='';drop.querySelectorAll('.ss-opt').forEach(function(o){o.classList.remove('hide');});}drop.classList.add('open');}
  inp.onfocus=_ssOpen;inp.onclick=_ssOpen;
  inp.onblur=function(){setTimeout(function(){drop.classList.remove('open');var cv=inp.getAttribute('data-val');var co=opts.find(function(o){return(typeof o==='object'?o.v:o)===cv;});inp.value=co?(typeof co==='object'?co.l:co):'';},200);};
  wrap.appendChild(inp);wrap.appendChild(drop);
  return wrap;
}
function ssVal(id){var el=document.getElementById(id);return el?el.getAttribute('data-val')||'':'';}

function makeSearchable(selId){
  var sel=document.getElementById(selId);
  if(!sel||sel.dataset.enhanced)return;
  sel.dataset.enhanced='1';
  var wrap=document.createElement('div');wrap.className='ss-wrap';wrap.style.width='100%';
  var inp=document.createElement('input');inp.className='ss-inp';inp.style.width='100%';
  var drop=document.createElement('div');drop.className='ss-drop';
  function syncInput(){var co=Array.from(sel.options).find(function(o){return o.value===sel.value;});if(co)inp.value=co.text;}
  function buildDrop(){
    drop.innerHTML='';
    Array.from(sel.options).forEach(function(o){
      var d=document.createElement('div');d.className='ss-opt'+(o.value===sel.value?' sel':'');
      d.textContent=o.text;d.setAttribute('data-v',o.value);
      d.onmousedown=function(e){e.preventDefault();sel.value=o.value;inp.value=o.text;
        drop.querySelectorAll('.ss-opt').forEach(function(x){x.classList.remove('sel');});
        d.classList.add('sel');drop.classList.remove('open');sel.dispatchEvent(new Event('change'));};
      drop.appendChild(d);
    });
    syncInput();
  }
  buildDrop();
  new MutationObserver(buildDrop).observe(sel,{childList:true});
  inp.oninput=function(){var q=inp.value.toLowerCase();drop.querySelectorAll('.ss-opt').forEach(function(o){o.classList.toggle('hide',!o.textContent.toLowerCase().includes(q));});};
  function _ssOpen(){buildDrop();if(!drop.classList.contains('open')){inp.value='';drop.querySelectorAll('.ss-opt').forEach(function(o){o.classList.remove('hide');});}drop.classList.add('open');}
  inp.onfocus=_ssOpen;inp.onclick=_ssOpen;
  inp.onblur=function(){setTimeout(function(){drop.classList.remove('open');syncInput();},200);};
  sel.style.display='none';sel.parentNode.insertBefore(wrap,sel);
  wrap.appendChild(inp);wrap.appendChild(drop);wrap.appendChild(sel);
}
function enhanceModalSelects(modalId){
  setTimeout(function(){
    var modal=document.getElementById(modalId);if(!modal)return;
    modal.querySelectorAll('select:not([data-enhanced])').forEach(function(sel){if(sel.id)makeSearchable(sel.id);});
  },50);
}

// ══ FILE UPLOAD HELPERS ═══════════════════════
function _clearFileUpload(urlInputId, prevId) {
  var u = document.getElementById(urlInputId); if (u) u.value = '';
  var p = document.getElementById(prevId || (urlInputId + '-prev')); if (p) p.innerHTML = '';
}

function _fileUploadPreview(prevEl, pub, fileName, isImg, urlInputId) {
  var prevId = prevEl ? prevEl.id : '';
  var rmBtn  = '<button type="button" onclick="_clearFileUpload(\'' + urlInputId + '\',\'' + prevId + '\')" '
    + 'style="font-size:11px;color:var(--err);background:none;border:none;cursor:pointer;padding:0;margin-top:3px;display:block">✕ Remove</button>';
  if (isImg) {
    prevEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px 10px;background:var(--hover);border:1px solid var(--line);border-radius:8px">'
      + '<img src="' + pub + '" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid var(--line)" onerror="this.style.display=\'none\'">'
      + '<div><div style="font-size:12px;font-weight:600;color:var(--text)">' + fileName + '</div>'
      + '<div style="font-size:11px;color:var(--ok);margin-top:2px">&#10003; Uploaded</div>'
      + rmBtn + '</div></div>';
  } else {
    prevEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px 10px;background:var(--hover);border:1px solid var(--line);border-radius:8px">'
      + '<div style="font-size:28px;line-height:1">📄</div>'
      + '<div><div style="font-size:12px;font-weight:600;color:var(--text)">' + fileName + '</div>'
      + '<div style="font-size:11px;color:var(--ok);margin-top:2px">&#10003; Uploaded</div>'
      + rmBtn + '</div></div>';
  }
}

async function _handleFileUpload(fileInput, urlInputId, bucket, folder) {
  var file = fileInput.files && fileInput.files[0];
  if (!file) return;
  var cid    = (typeof S !== 'undefined' && S && S.cid) ? S.cid : 'shared';
  var urlEl  = document.getElementById(urlInputId);
  var prevEl = document.getElementById(urlInputId + '-prev');
  // Show uploading state
  if (prevEl) prevEl.innerHTML = '<div style="margin-top:8px;padding:8px 12px;background:var(--hover);border:1px solid var(--line);border-radius:8px;font-size:12px;color:var(--t3)">⏳ Uploading ' + file.name + '…</div>';
  try {
    var ext  = file.name.split('.').pop().toLowerCase();
    var path = cid + '/' + folder + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var res  = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (res.error) throw res.error;
    var pub  = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    if (urlEl) urlEl.value = pub;
    if (prevEl) _fileUploadPreview(prevEl, pub, file.name, file.type.startsWith('image/'), urlInputId);
    if (typeof toast === 'function') toast('Uploaded: ' + file.name, 'ok');
  } catch (e) {
    if (prevEl) prevEl.innerHTML = '';
    if (typeof toast === 'function') toast('Upload failed: ' + (e.message || e), 'err');
    fileInput.value = '';
  }
}

async function _handleFileUploadAppend(fileInput, textareaId, bucket, folder) {
  var file = fileInput.files && fileInput.files[0];
  if (!file) return;
  var cid = (typeof S !== 'undefined' && S && S.cid) ? S.cid : 'shared';
  var ta  = document.getElementById(textareaId);
  if (typeof toast === 'function') toast('Uploading ' + file.name + '…', 'info');
  try {
    var ext  = file.name.split('.').pop().toLowerCase();
    var path = cid + '/' + folder + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var res  = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (res.error) throw res.error;
    var pub  = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    if (ta)  ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + pub;
    if (typeof toast === 'function') toast('Photo added: ' + file.name, 'ok');
  } catch (e) {
    if (typeof toast === 'function') toast('Upload failed: ' + (e.message || e), 'err');
  } finally {
    fileInput.value = '';
  }
}

// ══ REQUIRED-REASON MODAL (audit) ══════════════════════════
// Shared "Why is this change being made?" prompt for destructive money actions
// (payment void, sale amount edits). Enforces a minimum length; resolves the
// entered reason, or null if the user cancels. The reason is passed to the RPC
// (p_reason) which records it on the immutable audit trail.
function requireReason(opts){
  opts = opts || {};
  var title  = opts.title  || 'Confirm change';
  var detail = opts.detail || '';
  var okLabel= opts.okLabel|| 'Confirm';
  var minLen = opts.minLen || 10;
  return new Promise(function(resolve){
    document.getElementById('_reason-overlay')?.remove();
    var ov = document.createElement('div');
    ov.id = '_reason-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML =
      '<div style="background:var(--card,#0f172a);border:1px solid rgba(99,102,241,.3);border-radius:14px;padding:26px 24px 20px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.6)">'
      + '<div style="font-size:16px;font-weight:700;color:var(--text,#f8fafc);margin-bottom:6px">'+esc(title)+'</div>'
      + (detail?'<div style="font-size:12px;color:var(--t3,rgba(255,255,255,.5));margin-bottom:14px">'+esc(detail)+'</div>':'')
      + '<div style="font-size:11px;font-weight:600;color:var(--t2,rgba(255,255,255,.65));margin-bottom:6px">Why is this change being made? <span style="color:var(--err,#f43f5e)">*</span></div>'
      + '<textarea id="_reason-txt" rows="3" autocomplete="off" placeholder="This is recorded on the audit trail (min '+minLen+' characters)…" '
      + 'style="width:100%;padding:9px 11px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.14);border-radius:8px;color:var(--text,#f1f5f9);font-size:13px;font-family:inherit;box-sizing:border-box;resize:vertical;outline:none"></textarea>'
      + '<div id="_reason-err" style="font-size:11px;color:var(--err,#f43f5e);min-height:16px;margin-top:4px"></div>'
      + '<div style="display:flex;gap:8px;margin-top:12px">'
      + '<button id="_reason-cancel" style="flex:1;padding:9px;background:transparent;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;color:var(--t2,rgba(255,255,255,.6));font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>'
      + '<button id="_reason-ok" style="flex:2;padding:9px;background:#6366f1;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">'+esc(okLabel)+'</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    var txt = ov.querySelector('#_reason-txt'), errEl = ov.querySelector('#_reason-err');
    setTimeout(function(){ txt?.focus(); }, 50);
    var close = function(val){ ov.remove(); resolve(val); };
    ov.querySelector('#_reason-cancel').addEventListener('click', function(){ close(null); });
    ov.querySelector('#_reason-ok').addEventListener('click', function(){
      var v = (txt?.value || '').trim();
      if (v.length < minLen) { errEl.textContent = 'Please enter at least '+minLen+' characters.'; txt?.focus(); return; }
      close(v);
    });
    ov.addEventListener('click', function(e){ if(e.target===ov) close(null); });
  });
}

// ══ SIDEBAR COLLAPSE ══════════════════════════
(function initSidebarCollapse(){
  document.addEventListener('DOMContentLoaded',function(){
    var sb=document.querySelector('.sb');
    if(!sb)return;

    // ── Restore collapsed state (collapse btn is in HTML, no injection needed) ──
    try{
      if(localStorage.getItem('nxn_sb_collapsed')==='1'){
        sb.classList.add('collapsed');
        var sbIcon=document.getElementById('tb-sb-icon');
        if(sbIcon) sbIcon.innerHTML='<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>';
      }
    }catch(e){}

    // ── Mobile: Hamburger button in topbar ──
    var topbar=document.querySelector('.topbar');
    if(topbar){
      var ham=document.createElement('button');
      ham.className='tb-hamburger';
      ham.title='Open menu';
      ham.innerHTML='☰';
      ham.onclick=function(){ openMobileSidebar(); };
      topbar.insertBefore(ham,topbar.firstChild);
    }

    // ── Mobile: Overlay backdrop ──
    var overlay=document.createElement('div');
    overlay.className='sb-overlay';
    overlay.onclick=function(){ closeMobileSidebar(); };
    document.body.appendChild(overlay);

    // Close popover on outside click
    document.addEventListener('click',function(e){
      var pop=document.getElementById('sb-user-pop');
      var zone=document.getElementById('sb-user-zone');
      if(pop&&pop.classList.contains('open')&&!zone.contains(e.target)) _sbCloseUserMenu();
    });

    // Close sidebar on resize to desktop
    window.addEventListener('resize',function(){
      if(window.innerWidth>768) closeMobileSidebar();
    });
  });
})();

function openMobileSidebar(){
  var sb=document.querySelector('.sb');
  var ov=document.querySelector('.sb-overlay');
  if(sb)sb.classList.add('mobile-open');
  if(ov)ov.classList.add('visible');
  document.body.style.overflow='hidden';
}

function closeMobileSidebar(){
  var sb=document.querySelector('.sb');
  var ov=document.querySelector('.sb-overlay');
  if(sb)sb.classList.remove('mobile-open');
  if(ov)ov.classList.remove('visible');
  document.body.style.overflow='';
}

function toggleSidebar(){
  if(window.innerWidth<=768){
    // Mobile: toggle overlay
    var sb=document.querySelector('.sb');
    if(sb&&sb.classList.contains('mobile-open')){
      closeMobileSidebar();
    }else{
      openMobileSidebar();
    }
    return;
  }
  // Desktop: collapse
  var sb=document.querySelector('.sb');
  if(!sb)return;
  sb.classList.toggle('collapsed');
  var collapsed=sb.classList.contains('collapsed');
  try{ localStorage.setItem('nxn_sb_collapsed',collapsed?'1':'0'); }catch(e){}
  var sbIcon=document.getElementById('tb-sb-icon');
  if(sbIcon){
    if(collapsed){
      sbIcon.innerHTML='<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>';
    }else{
      sbIcon.innerHTML='<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>';
    }
  }
}


function updateCoLogo(){
  var logo=typeof getCoLogo==='function'?getCoLogo():null;
  // Staff chrome (sidebar/topbar) shows the DISPLAY (brand) name; documents use legal name.
  var coName=typeof coDisplayName==='function'?coDisplayName():(S?S.coName||'Nexunova':'Nexunova');
  var ini_=coName.charAt(0).toUpperCase();
  // ── Workspace switcher (Zone 2) ──
  var wsAv=document.getElementById('sb-ws-av');
  var wsNm=document.getElementById('sb-ws-name');
  if(wsAv) wsAv.textContent=ini_;
  if(wsNm) wsNm.textContent=coName;
  // ── Topbar company chip ──
  var tbC=document.getElementById('tb-c');
  if(tbC){
    if(logo){
      tbC.innerHTML='<img src="'+logo+'" style="height:32px;max-width:110px;object-fit:contain;background:transparent;vertical-align:middle;display:inline-block" alt="'+coName+'">';
    }else{
      tbC.innerHTML='<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--fk-primary,#4F46E5);color:#fff;font-size:10px;font-weight:600;flex-shrink:0">'+ini_+'</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;padding-left:6px;font-weight:500">'+coName+'</span>';
    }
  }
}

// ══ PROJECT SCOPE — global active-project selector ═══════════════════════════
// A single tenant can run several projects. The active project (S.projectId) is
// the lens every operational list/report is viewed through. null = "All Projects"
// (consolidated). Persisted inside S (nxn_sess). Built on top of the existing
// per-user assignment gate (hasProjectAccess / S.assignedProjectIds), so a staff
// user can only ever pick — and only ever sees — the projects assigned to them.

function _projList(){ return (window._projectsCache || []); }

// Projects the current user is actually allowed to pick / see.
function _selectableProjects(){
  return _projList().filter(function(p){
    return typeof hasProjectAccess !== 'function' || hasProjectAccess(p.id);
  });
}

function activeProjectId(){ return (typeof S !== 'undefined' && S && S.projectId) || null; }

function activeProjectName(){
  var id = activeProjectId();
  if(!id) return 'All Projects';
  var p = _projList().find(function(x){ return x.id === id; });
  return p ? (p.projectName || p.name || 'Project') : 'All Projects';
}

// THE single filter every operational page uses. Combines two gates:
//   (a) per-user assignment — a non-admin never sees a project not assigned to them
//   (b) the active-project selection — when a project is picked, hide the rest
// Rows with no project_id (company-level / legacy) are never hidden.
function inProj(row){
  if(!row) return true;
  var rid = (row.projectId !== undefined) ? row.projectId : row.project_id;
  if(rid == null) return true;                                  // untagged → visible everywhere
  if(typeof hasProjectAccess === 'function' && !hasProjectAccess(rid)) return false; // (a)
  var act = activeProjectId();
  if(act && rid !== act) return false;                          // (b)
  return true;
}
function projFilter(arr){ return (arr || []).filter(inProj); }

// Switch the active project, persist, rebuild the chip, re-render current page.
function setActiveProject(id){
  if(typeof S === 'undefined' || !S) return;
  S.projectId = id || null;
  try{ sessionStorage.setItem('nxn_sess', JSON.stringify(S)); }catch(e){}
  var m=document.getElementById('nx-proj-menu'); if(m) m.classList.remove('is-open');
  // Stateful per-page project filters mirror the lens — clear them so they re-seed
  // to the NEW active project on the upcoming re-render (they live in shared script
  // scope; guard each in case its page script is not present).
  try{ if(typeof _clFilter==='object' && _clFilter) _clFilter.project=''; }catch(e){}
  try{ if(typeof _tlFilter==='object' && _tlFilter) _tlFilter.project=''; }catch(e){}
  try{ if(typeof _teamFilt==='object' && _teamFilt) _teamFilt.project=''; }catch(e){}
  try{ if(typeof _pdcFilter==='object' && _pdcFilter) _pdcFilter.project=''; }catch(e){}
  try{ if(typeof _salProject!=='undefined') _salProject=''; }catch(e){}
  buildProjectSwitcher();
  var cur = document.querySelector('.pg.on')?.id?.replace('pg-','');
  if(cur && typeof nav === 'function') nav(cur);
}

// Choose a sensible default when the session has no (valid) active project yet.
function initActiveProject(){
  if(typeof S === 'undefined' || !S) return;
  var list = _selectableProjects();
  if(S.projectId && list.some(function(p){ return p.id === S.projectId; })) return; // keep valid choice
  // single project → scope straight to it; multiple → All Projects (consolidated)
  S.projectId = (list.length === 1) ? list[0].id : null;
}

// (Re)build the topbar project switcher. Hidden when there is nothing to switch.
function buildProjectSwitcher(){
  var host = document.getElementById('nx-tb-proj');
  if(!host) return;
  initActiveProject();
  var list = _selectableProjects();
  if(list.length <= 1){ host.style.display='none'; host.innerHTML=''; return; }
  host.style.display='';
  var act = activeProjectId();
  var items = '<button class="nx-menu-item'+(!act?' is-active':'')+'" type="button" onclick="setActiveProject(null)">'
            + _sbi('layers',16) + 'All Projects</button>'
            + '<div class="nx-menu-div"></div>';
  list.forEach(function(p){
    var nm = esc(p.projectName || p.name || 'Project');
    items += '<button class="nx-menu-item'+(act===p.id?' is-active':'')+'" type="button" onclick="setActiveProject(\''+p.id+'\')">'
           + _sbi('building-2',16) + nm + '</button>';
  });
  host.innerHTML =
    '<button class="nx-proj-btn" type="button" aria-haspopup="true" '
    + 'onclick="event.stopPropagation();NXShell.toggleMenu(\'nx-proj-menu\')">'
    + _sbi('layers',15)
    + '<span class="nx-proj-lbl">'+esc(activeProjectName())+'</span>'
    + '<svg class="nx-proj-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    + '</button>'
    + '<div class="nx-menu nx-proj-menu" id="nx-proj-menu" role="menu">'
    + '<div class="nx-menu-label">Viewing project</div>' + items + '</div>';
}

// ══ SIDEBAR & NAV ══════════════════════════════

/* ── Lucide SVG icon helper ── */
function _sbi(name, size){
  size = size||16;
  const P = {
    'layout-grid':    '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    'inbox':          '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'building-2':     '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    'layers':         '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    'home':           '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'users':          '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user-check':     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
    'file-text':      '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>',
    'banknote':       '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    'credit-card':    '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    'receipt':        '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    'calendar-clock': '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4M8 2v4M3 10h5"/><circle cx="17.5" cy="17.5" r="4.5"/><path d="M17.5 15.5v2l1.5 1"/>',
    'alert-circle':   '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    'bell':           '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    'phone':          '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33A2 2 0 0 1 3.54 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.29 6.29l.79-.99a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    'handshake':      '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-1"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
    'heart':          '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    'radar':          '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
    'link':           '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'trending-up':    '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    'bar-chart-3':    '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    'book-open':      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'printer':        '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
    'shield':         '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'settings':       '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    'database':       '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    'history':        '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    'list-checks':    '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    'target':         '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'tag':            '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
    'repeat':              '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    'arrow-down-circle':   '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
    'arrow-up-circle':     '<circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/>',
    'alert-triangle':      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'shield-off':          '<path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"/><path d="m2 2 20 20"/><path d="M4.73 4.73 4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38"/>',
    'scale':               '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21H17"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    'megaphone':           '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    'message-square':      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'map-pin':             '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    'file-check':          '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/>',
    'wand-2':              '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>',
    'sunrise':             '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(P[name]||'')+'</svg>';
}

// ── LITE / PRO UI MODE — REMOVED (Phase 2 D, 2026-06-12) ──────────────────────
// The nav-Lite v2 mode (whitelist, getUIMode/setUIMode, Lite|Pro pill, the Lite
// "+New" quick-action and lnq-* groups) was removed: one mode remains = the full
// grouped nav. CSS removed from visual-overhaul.css + app.css; localStorage key
// 'rms.uimode' is no longer read or written.

function buildSB(){
  const fus  = gfus();
  const role = effectiveRole();
  // Canonical roles (master context §2): owner, admin, recovery_officer, finance, manager.
  // Legacy aliases preserved for backward compat: 'recovery' = recovery_officer, 'accounts' = finance.
  const isA  = role==='admin' || role==='owner';
  const isR  = role==='recovery' || role==='recovery_officer';
  const isAc = role==='accounts' || role==='finance';
  const isM  = role==='manager';
  // Body role classes so CSS / pages can target the active role (e.g. `.role-readonly .btn-primary { display:none }`)
  const _bc = document.body.classList;
  ['role-admin','role-recovery','role-finance','role-manager','role-readonly'].forEach(c => _bc.remove(c));
  if (isA)  _bc.add('role-admin');
  if (isR)  _bc.add('role-recovery');
  if (isAc) _bc.add('role-finance');
  if (isM)  { _bc.add('role-manager'); _bc.add('role-readonly'); }   // Manager = full read-only across the app
  // Finance "sleep" (master context §2): hide the Finance group everywhere if no active finance user exists.
  // Loaded at login by auth.js _loadRoleContext().
  const _hasFinanceUser = !!(typeof S !== 'undefined' && S && S.hasFinanceUser);

  // Overdue count (matches dashboard strip)
  const units     = typeof gunits==='function'?gunits():[];
  const soldU     = units.filter(u=>u.status!=='Available'&&u.status!=='Dead');
  const od        = typeof getOverdueDays==='function'?getOverdueDays():30;
  const overdueN  = typeof isOverdue==='function'
    ? soldU.filter(u=>isOverdue(u,od)&&typeof actualPending==='function'&&actualPending(u)>0).length
    : 0;
  const totalU    = units.length;
  // Inbox/queue badge means "things to act on TODAY" (Tier-A from the recovery queue),
  // falling back to the raw overdue-unit count until the Morning List has loaded once.
  const alrt      = (typeof window._tierACount==='number') ? window._tierACount : overdueN;

  // Each group: { label: string|null, items: [{id, ic, lb, bdg, bdgType}] }
  let navGroups = [];

  // ════════════════════════════════════════════════════════════════════════
  // NAV PHASE (2026-06-12): the 7-area model — Dashboard · INVENTORY · SALES ·
  // RECOVERY · REPORTS · INBOX · ADMIN. Every primary surface ≤2 clicks; group
  // labels are 11px uppercase (foundation §11). RECOVERY + ADMIN are TIERED:
  // primaries always visible, the long tail behind an in-group "More" divider
  // (items flagged `more:true`), remembered per-user in localStorage. Active
  // state = indigo left-bar + tint (foundation §11; no per-zone colours).
  // Non-admin roles use the SAME area vocabulary, re-grouped from their EXISTING
  // id sets only (no id added/removed → nav() permission gate unchanged).
  // ════════════════════════════════════════════════════════════════════════
  if(isA){
    navGroups = [
      // Dashboard — ungrouped, always first.
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
      ]},
      // ── 1 · Sales & Money (Inventory · Clients · Sales · Payments) ──
      { label: 'Sales & Money', items: [
        { id:'units',       ic:'home',              lb:'Units' },
        { id:'clients',     ic:'user-check',        lb:'Clients' },
        { id:'sales',       ic:'file-text',         lb:'Sales' },
        { id:'addpayment',  ic:'banknote',          lb:'Record Payment' },
        { id:'pdc',         ic:'calendar-clock',    lb:'PDC', bdg:(window._pdcDueCount||null), bdgType:(window._pdcDueCount?'warn':null) },
        { id:'receivables', ic:'arrow-up-circle',   lb:'Additional Receivables' },
        { id:'recovery',    ic:'list-checks',       lb:'Collections', dot:(overdueN>0?'danger':null) },
        { id:'payables',    ic:'arrow-down-circle', lb:'Payables' },
      ]},
      // ── 2 · Online Portal (everything for the self-service sales portal) ──
      { label: 'Online Portal', items: [
        { id:'onlineportal',    ic:'globe',          lb:'Online Portal' },
      ]},
      // ── 3 · Dealers (agent master · money · recovery) ──
      { label: 'Dealers', items: [
        { id:'agents',            ic:'users',       lb:'Dealers' },
        { id:'agenttransactions', ic:'trending-up', lb:'Dealer Transactions' },
        { id:'commissions',       ic:'trending-up', lb:'Commissions' },
        { id:'agentrecovery',     ic:'user-check',  lb:'Dealer Recovery' },
      ]},
      // ── 3 · Recovery ──
      { label: 'Recovery', items: [
        { id:'myrecovery',  ic:'radar',     lb:'My Recovery' },
        { id:'queue',       ic:'sunrise',   lb:'Morning List', dot:(window._tierACount>0?'danger':null) },
        { id:'promises',    ic:'handshake', lb:'Follow-ups' },
        { id:'reminders',   ic:'bell',      lb:'Reminders' },
        { id:'callreport',  ic:'phone-call', lb:'Daily Call Report' },
        { id:'forecasting', ic:'trending-up', lb:'Forecasting' },
      ]},
      // ── 4 · Transfer & Cancel ──
      { label: 'Transfer & Cancel', items: [
        { id:'unittransfer',   ic:'arrow-left-right', lb:'Transfer Unit' },
        { id:'unitchange',     ic:'repeat', lb:'Change Unit' },
        { id:'unitcancel',     ic:'x-circle', lb:'Cancel Unit' },
      ]},
      // ── 5 · Reports & Ledgers ──
      { label: 'Reports & Ledgers', items: [
        { id:'reports',        ic:'bar-chart-3',    lb:'Reports' },
        { id:'ledgers',        ic:'book-open',      lb:'Ledgers' },
        { id:'statements',     ic:'file-text',      lb:'Account Statements' },
        { id:'receipts',       ic:'receipt',        lb:'Receipt Vouchers' },
        { id:'transferunits',  ic:'repeat',         lb:'Transferred Units' },
        { id:'cancelledunits', ic:'tag',            lb:'Cancelled Units' },
      ]},
      // ── 6 · Team & Approvals ──
      { label: 'Team & Approvals', items: [
        { id:'contacts',  ic:'inbox',      lb:'Inbox', bdg:alrt, bdgType:alrt?'alert':null },
        { id:'approvals', ic:'file-check', lb:'Approvals', dot:(window._approvalsPending>0?'danger':null) },
        { id:'team',      ic:'users',      lb:'Team' },
        { id:'users',     ic:'shield',     lb:'Users & Roles' },
      ]},
      // ── 7 · Documents ──
      { label: 'Documents', items: [
        { id:'documents',   ic:'printer',         lb:'Documents' },
        { id:'escalations', ic:'alert-triangle',  lb:'Escalations' },
        { id:'noc',         ic:'file-check',      lb:'NOC Management' },
      ]},
      // ── 8 · Setup & Settings ──
      { label: 'Setup & Settings', defaultCollapsed: true, items: [
        { id:'projects',        ic:'building-2',     lb:'Projects' },
        { id:'categories',      ic:'layers',         lb:'Types & Floors' },
        { id:'banks',           ic:'banknote',       lb:'Banks' },
        { id:'payment-methods', ic:'credit-card',    lb:'Payment Methods' },
        { id:'audit',           ic:'history',        lb:'Audit Trail' },
        { id:'paylinks',        ic:'link',           lb:'Payment Links' },
        { id:'commscenter',     ic:'message-square', lb:'Comms Center' },
        { id:'admin',           ic:'settings',       lb:'Settings' },
      ]},
    ];
  } else if(isR){
    // Recovery officer — same vocabulary, existing id set only.
    navGroups = [
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
      ]},
      { label: 'Inventory', items: [
        { id:'units',          ic:'home',   lb:'Units' },
        { id:'transferunits',  ic:'repeat', lb:'Transferred Units', more:true },
        { id:'cancelledunits', ic:'tag',    lb:'Cancelled Units',   more:true },
      ]},
      { label: 'Sales', items: [
        { id:'sales',   ic:'file-text',  lb:'Sales' },
        { id:'clients', ic:'user-check', lb:'Clients' },
      ]},
      { label: 'Recovery', items: [
        { id:'myrecovery',  ic:'radar',          lb:'My Recovery' },
        { id:'queue',       ic:'sunrise',        lb:'Morning List', dot:(window._tierACount>0?'danger':null) },
        { id:'recovery',    ic:'list-checks',    lb:'Collections' },
        { id:'pdc',         ic:'calendar-clock', lb:'PDC' },
        { id:'promises',    ic:'handshake',      lb:'Follow-ups' },
        { id:'reminders',   ic:'bell',           lb:'Reminders' },
        { id:'callreport',  ic:'phone-call',     lb:'Daily Call Report' },
        { id:'escalations', ic:'alert-triangle', lb:'Escalations',      more:true },
        { id:'receipts',    ic:'receipt',        lb:'Receipt Vouchers', more:true },
        { id:'ledgers',     ic:'book-open',      lb:'Ledgers',          more:true },
        { id:'paylinks',    ic:'link',           lb:'Payment Links',    more:true },
      ]},
      { label: 'Inbox', items: [
        { id:'contacts', ic:'inbox', lb:'Inbox', bdg:alrt, bdgType:alrt?'alert':null },
      ]},
    ];
  } else if(isAc){
    // Finance / accounts — same vocabulary, existing id set only.
    navGroups = [
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
      ]},
      { label: 'Inventory', items: [
        { id:'transferunits',  ic:'repeat', lb:'Transferred Units' },
        { id:'cancelledunits', ic:'tag',    lb:'Cancelled Units' },
      ]},
      { label: 'Sales', items: [
        { id:'sales',   ic:'file-text',  lb:'Sales' },
        { id:'clients', ic:'user-check', lb:'Clients' },
        { id:'agents',  ic:'users',      lb:'Sales Agents', more:true },
      ]},
      { label: 'Recovery', items: [
        { id:'recovery', ic:'banknote',  lb:'Collections' },
        { id:'paylinks', ic:'link',      lb:'Payment Links' },
        { id:'ledgers',  ic:'book-open', lb:'Ledgers', more:true },
      ]},
      { label: 'Reports', items: [
        { id:'reports',   ic:'bar-chart-3', lb:'Reports' },
        { id:'documents', ic:'printer',     lb:'Documents' },
      ]},
    ];
  } else if(isM){
    // Manager — broad read-only access (NO Admin area: Users/Settings/Audit/Backup).
    navGroups = [
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
      ]},
      { label: 'Inventory', items: [
        { id:'units',          ic:'home',       lb:'Units' },
        { id:'projects',       ic:'building-2', lb:'Projects' },
        { id:'transferunits',  ic:'repeat',     lb:'Transferred Units', more:true },
        { id:'cancelledunits', ic:'tag',        lb:'Cancelled Units',   more:true },
      ]},
      { label: 'Sales', items: [
        { id:'sales',       ic:'file-text',   lb:'Sales' },
        { id:'clients',     ic:'user-check',  lb:'Clients' },
        { id:'agents',      ic:'users',       lb:'Sales Agents', more:true },
        { id:'commissions', ic:'trending-up', lb:'Commissions',  more:true },
      ]},
      { label: 'Recovery', items: [
        { id:'recovery',    ic:'list-checks',    lb:'Collections' },
        { id:'pdc',         ic:'calendar-clock', lb:'PDC' },
        { id:'promises',    ic:'handshake',      lb:'Follow-ups' },
        { id:'reminders',   ic:'bell',           lb:'Reminders' },
        { id:'callreport',  ic:'phone-call',     lb:'Daily Call Report', more:true },
        { id:'receipts',    ic:'receipt',        lb:'Receipt Vouchers', more:true },
        { id:'ledgers',     ic:'book-open',      lb:'Ledgers',          more:true },
      ]},
      { label: 'Reports', items: [
        { id:'reports', ic:'bar-chart-3', lb:'Reports' },
      ]},
      { label: 'Inbox', items: [
        { id:'contacts', ic:'inbox', lb:'Inbox', bdg:alrt, bdgType:alrt?'alert':null },
      ]},
    ];
  } else {
    // manager, staff, or any other role — permission-driven sidebar
    // Only include modules the user has explicit access to via module_permissions
    const _allModuleItems = [
      { key:'projects',  id:'projects',  ic:'building-2',  lb:'Projects' },
      { key:'units',     id:'units',     ic:'home',        lb:'All Units' },
      { key:'clients',   id:'clients',   ic:'user-check',  lb:'Clients' },
      { key:'recovery',  id:'recovery',  ic:'banknote',    lb:'Collections' },
      { key:'contacts',  id:'contacts',  ic:'phone',       lb:'Call Logs' },
      { key:'reports',   id:'reports',   ic:'bar-chart-3', lb:'Reports' },
      { key:'documents', id:'documents', ic:'printer',     lb:'Documents' },
      { key:'agents',    id:'agents',    ic:'users',       lb:'Sales Agents' },
      { key:'search',    id:'search',    ic:'search',      lb:'Quick Search' },
    ];
    const allowedItems = _allModuleItems.filter(m =>
      typeof hasPermission === 'function' ? hasPermission(m.id) : false
    );
    navGroups = [
      { label: null, items: [{ id:'dashboard', ic:'layout-grid', lb:'Dashboard' }] },
    ];
    if(allowedItems.length){
      navGroups.push({ label:'My Modules', items: allowedItems });
    }
  }

  // Finance sleep — strip the Finance group if no active finance user exists in the company.
  // Admin/owner ALWAYS keep Finance: in a small company with no dedicated finance hire, the
  // admin records receipts/PDCs themselves, so hiding it would break core flows.
  if (!_hasFinanceUser && !isA) {
    navGroups = navGroups.filter(g => g.label !== 'Finance');
  }

  // ── Build HTML ──
  const grpStates = _getGroupStates();
  // Leading glyph per group → headers read as real buttons (covers every role's vocab).
  const _GRP_IC = {
    'Sales & Money':'banknote', 'Agents & Bookings':'users', 'Recovery':'radar',
    'Transfer & Cancel':'repeat', 'Reports & Ledgers':'bar-chart-3', 'Team & Approvals':'shield',
    'Documents':'printer', 'Setup & Settings':'settings',
    'Inventory':'home', 'Sales':'file-text', 'Reports':'bar-chart-3', 'Inbox':'inbox', 'My Modules':'layout-grid'
  };
  let html = '';
  navGroups.forEach(function(g){
    if(!g.label){
      g.items.forEach(function(x){ html += _mkNi(x, false, null); });
    } else {
      const gid     = g.label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      // Button-shaped groups (2026-06-16): collapsed by DEFAULT — every group
      // starts as a closed button; user taps to expand. Stored toggles win.
      const isCol   = (gid in grpStates) ? !!grpStates[gid] : true;
      // Label LEFT (11px uppercase muted), chevron on the RIGHT edge. No count
      // chip — menu-entry counts carry zero signal (Nav-phase verdict).
      const chevron = '<svg class="nav-grp-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      const gicon = _GRP_IC[g.label];
      html += '<div class="nav-group'+(isCol?' collapsed':'')+'" data-gid="'+gid+'">';
      html += '<button class="nav-grp-hd" onclick="toggleNavGroup(\''+gid+'\')">'
            + (gicon ? '<span class="nav-grp-ic">'+_sbi(gicon,17)+'</span>' : '')
            + '<span class="nav-grp-lbl">'+g.label+'</span>'
            + chevron
            + '</button>';
      html += '<div class="nav-grp-body" data-gid="'+gid+'"'+(isCol?' style="display:none"':'')+' >';
      const _primary = g.items.filter(function(x){ return !x.more; });
      const _more    = g.items.filter(function(x){ return  x.more; });
      _primary.forEach(function(x){ html += _mkNi(x, true, g.label); });
      if(_more.length){
        // Intra-group "More" tier — long tail collapsed by default, remembered per user.
        const _mOpen = _getMoreState(gid);
        html += '<button class="nav-grp-more'+(_mOpen?' is-open':'')+'" type="button" onclick="toggleNavMore(\''+gid+'\')" aria-expanded="'+(_mOpen?'true':'false')+'">'
              + '<svg class="nav-grp-more-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
              + '<span class="nav-grp-more-lbl">'+(_mOpen?'Less':'More')+'</span>'
              + '</button>';
        html += '<div class="nav-grp-more-tail" data-gid="'+gid+'"'+(_mOpen?'':' hidden')+'>';
        _more.forEach(function(x){ html += _mkNi(x, true, g.label); });
        html += '</div>';
      }
      html += '</div></div>';
    }
  });

  document.getElementById('sb-nav').innerHTML = html;

  // Pending-approvals badge (admin/owner only) — fetch once, then re-render shows the count.
  if (isA && typeof refreshApprovalsBadge === 'function' && !window._approvalsBadgeLoaded) {
    window._approvalsBadgeLoaded = true;
    refreshApprovalsBadge();
  }

  // Setup Wizard now lives as a nav item inside the HOME group (admin/owner), so the old
  // standalone footer shortcut (#sb-wizard-btn) is retired — keep it hidden if still present.
  const _wizBtn = document.getElementById('sb-wizard-btn');
  if(_wizBtn) _wizBtn.style.display = 'none';

  // Theme toggle (Phase 5, 2026-05-27) — the button moved from topbar to the sidebar footer
  // (static HTML in login.html, zone 4c). theme.js owns the click delegate on #tb-theme-btn
  // and the canonical toggleTheme(). We only sync the initial icon here to match the current
  // data-theme, because buildSB can run after theme.js init has already fired its first
  // applyTheme(). Icon convention (from theme.js):
  //   Light → moon  (click to go dark)
  //   Dark  → sun   (click to go light)
  const _themeIcon = document.getElementById('tb-theme-icon');
  if (_themeIcon) {
    const _curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    _themeIcon.innerHTML = (_curTheme === 'light')
      ? '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
  }

  // Rebuild the topbar's role-aware "+ New" menu + super-admin link (shell.js).
  // (Aurora mega-menu retired in the Nav phase — buildTopbarMega is gone.)
  window._navGroups = navGroups;
  if (typeof buildTopbar === 'function') buildTopbar();
}

function _mkNi(x, isSub, grpLabel){
  const cls     = 'ni' + (isSub ? ' ni-sub' : '');
  const tooltip = (isSub && grpLabel) ? grpLabel+' → '+x.lb : x.lb;
  const bdg     = x.bdg ? '<span class="ni-bdg'+(x.bdgType?' '+x.bdgType:'')+'">'+x.bdg+'</span>' : '';
  const dot     = x.dot ? '<span class="ni-dot '+x.dot+'" title="Needs attention"></span>' : '';
  const onclk   = x.action ? x.action : "nav('"+x.id+"')";
  return '<div class="'+cls+'" data-pg="'+x.id+'" data-label="'+tooltip+'" onclick="'+onclk+'">'
       + '<span class="ni-ic">'+_sbi(x.ic)+'</span>'
       + '<span class="ni-lb">'+x.lb+'</span>'
       + bdg + dot + '</div>';
}

// ── GROUP COLLAPSE STATE ──────────────────────────
// Key VERSIONED. Bumped to v4 (2026-06-16) for the button-shaped groups +
// collapsed-by-default change, so every existing user's old expand states are
// abandoned ONCE → all groups start as closed buttons (absence of stored state
// ⇒ collapsed; see buildSB isCol). Stored toggles still win thereafter.
function _getGroupStates(){
  try{return JSON.parse(localStorage.getItem('nx.sb.groups.v4')||'{}');}catch(e){return{};}
}
function setCollapsedGroup(gid,collapsed){
  try{var s=_getGroupStates();s[gid]=collapsed;localStorage.setItem('nx.sb.groups.v4',JSON.stringify(s));}catch(e){}
}
function toggleNavGroup(gid){
  var grp=document.querySelector('.nav-group[data-gid="'+gid+'"]');
  if(!grp)return;
  var body=grp.querySelector('.nav-grp-body');
  if(!body)return;
  var isCol=grp.classList.contains('collapsed');
  if(isCol){
    grp.classList.remove('collapsed');
    body.style.display='block';
    body.style.overflow='hidden';
    body.style.maxHeight='0';
    body.style.opacity='0';
    body.offsetHeight; // force reflow
    body.style.transition='max-height 220ms ease,opacity 180ms ease';
    body.style.maxHeight=body.scrollHeight+'px';
    body.style.opacity='1';
    setTimeout(function(){body.style.maxHeight='';body.style.overflow='';body.style.transition='';},230);
    setCollapsedGroup(gid,false);
  }else{
    grp.classList.add('collapsed');
    body.style.overflow='hidden';
    body.style.maxHeight=body.scrollHeight+'px';
    body.style.opacity='1';
    body.offsetHeight;
    body.style.transition='max-height 220ms ease,opacity 180ms ease';
    body.style.maxHeight='0';
    body.style.opacity='0';
    setTimeout(function(){body.style.display='none';body.style.maxHeight='';body.style.overflow='';body.style.opacity='';body.style.transition='';},230);
    setCollapsedGroup(gid,true);
  }
}

// ── INTRA-GROUP "MORE" TIER (long-tail items, remembered per user) ──────────
function _getMoreStates(){
  try{ return JSON.parse(localStorage.getItem('nx.sb.more.v1')||'{}'); }catch(e){ return {}; }
}
function _getMoreState(gid){ return !!_getMoreStates()[gid]; }
function _setMoreState(gid,open){
  try{ var s=_getMoreStates(); s[gid]=open; localStorage.setItem('nx.sb.more.v1',JSON.stringify(s)); }catch(e){}
}
function toggleNavMore(gid){
  var grp=document.querySelector('.nav-group[data-gid="'+gid+'"]');
  if(!grp)return;
  var btn=grp.querySelector('.nav-grp-more');
  var tail=grp.querySelector('.nav-grp-more-tail');
  if(!btn||!tail)return;
  var willOpen=tail.hasAttribute('hidden');   // currently hidden → opening
  if(willOpen) tail.removeAttribute('hidden'); else tail.setAttribute('hidden','');
  btn.classList.toggle('is-open',willOpen);
  btn.setAttribute('aria-expanded',willOpen?'true':'false');
  var lbl=btn.querySelector('.nav-grp-more-lbl');
  if(lbl) lbl.textContent=willOpen?'Less':'More';
  _setMoreState(gid,willOpen);
}

function _sbToggleUserMenu(e){
  e.stopPropagation();
  var pop=document.getElementById('sb-user-pop');
  if(pop) pop.classList.toggle('open');
}
function _sbCloseUserMenu(){
  var pop=document.getElementById('sb-user-pop');
  if(pop) pop.classList.remove('open');
}

function nav(pg,x){
  // ── Phase 3A: retired dashboards redirect to the single Dashboard ──
  // recovery-dashboard / executive / radar were consolidated into dashboard.
  if(pg==='recovery-dashboard'||pg==='executive'||pg==='radar') pg='dashboard';
  // Phase 3C: the standalone Add-Unit page is retired — quick-add / full modal live on the Units page.
  if(pg==='addunit') pg='units';
  // Record Payment is unified into the Receipt Vouchers cockpit (one receiving module).
  // A unit id (from "Receive" buttons) is preserved in x and opens that account's entry.
  if(pg==='addpayment') pg='receipts';
  // ── Online Portal: the 4 module pages are now sub-tabs of one "Online Portal" tab ──
  if(pg==='salesaccess'||pg==='salesubmissions'||pg==='reservations'||pg==='dealeragreement'){ window._opPendingSub=pg; pg='onlineportal'; }
  // ── Permission guard ──
  if(S&&S.role!=='admin'&&S.role!=='owner'){
    const r=effectiveRole();
    // Always-allowed pages for any authenticated non-admin user
    const _alwaysAllow=['dashboard','changepassword'];
    if(!_alwaysAllow.includes(pg)){
      // Role-based baseline allow-list (backward-compatible for existing users)
      const allow={
        recovery:['dashboard','recovery-dashboard','queue','units','unitdetail','addunit','search','clients','clientdetail','recovery','callreport','addpayment','receipts','pdc','cancelledunits','transferunits','officerledger','receivingledger','ledgers','ledger-client','ledger-unit','ledger-agent','ledger-project','reminders','contacts','promises','fieldvisits','escalations','campaigns','sales','salesdetail','newsale','editsale','paylinks','paylink-detail','myrecovery'],
        accounts:['dashboard','recovery','addpayment','receipts','pdc','cancelledunits','transferunits','officerledger','receivingledger','ledgers','ledger-client','ledger-unit','ledger-agent','ledger-project','commissions','reports','documents','clients','clientdetail','agents','agentdetail','sales','salesdetail','paylinks','paylink-detail','agentrecovery'],
      };
      // For manager/staff: rely entirely on hasPermission()
      // For recovery/accounts: must be in baseline list AND pass hasPermission()
      const inBaseline=(allow[r]||[]).includes(pg);
      const permitted=typeof hasPermission==='function'?hasPermission(pg):false;
      if(r==='manager'||r==='staff'){
        if(!permitted)pg='dashboard';
      }else{
        if(!inBaseline||!permitted)pg='dashboard';
      }
    }
  }
  // ── Lazy page loader (Phase A2): fetch this page's module on first visit,
  //    then re-enter nav(). Aborts the current pass while the script loads. ──
  if(typeof _navLazyGuard==='function'&&_navLazyGuard(pg,x))return;
  const curActive=document.querySelector('.pg.on')?.id?.replace('pg-','');
  if(curActive&&curActive!==pg){
    _prevPg=curActive;
    if(!_navBack) _navStack.push(curActive);
  }
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelector('.pw')?.classList.remove('rpt-mode');
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  const pel=document.getElementById('pg-'+pg);if(pel)pel.classList.add('on');
  const nel=document.querySelector(`.ni[data-pg="${pg}"]`);
  if(nel){
    nel.classList.add('on');
    // Auto-expand the parent group if it is currently collapsed
    const parentGrp=nel.closest('.nav-group.collapsed');
    if(parentGrp){
      const gid=parentGrp.dataset.gid;
      if(gid) toggleNavGroup(gid);
    }
    // Auto-reveal the "More" tail if the active item lives in a collapsed one.
    const moreTail=nel.closest('.nav-grp-more-tail[hidden]');
    if(moreTail&&moreTail.dataset.gid&&typeof toggleNavMore==='function') toggleNavMore(moreTail.dataset.gid);
  }
  document.querySelector('.sb')?.setAttribute('data-pg', pg);
  const ts={dashboard:'Dashboard',onlineportal:'Online Portal',queue:'Morning List',addunit:'Add Inventory',newsale:'New Sale',editsale:'Edit Sale',projects:'Projects',projectdetail:'Project Detail',units:'Inventory',unitdetail:'Unit Detail',clients:'All Clients',clientdetail:'Client Detail',agents:'Sales Agents',agentdetail:'Agent Detail',sales:'Sales',salesdetail:'Sale Detail',recovery:'Payments',callreport:'Daily Call Report',addpayment:'Add Payment',receipts:'Receipt Vouchers',pdc:'PDC Register',cancelledunits:'Cancelled Units Ledger',transferunits:'Transferred Units Ledger',officerledger:'Officer Ledger',receivingledger:'Receiving Ledger',ledgers:'Ledgers','ledger-client':'Client Ledger','ledger-unit':'Unit Ledger','ledger-agent':'Agent Ledger','ledger-project':'Project Ledger',commissions:'Pay Commission',reminders:'Reminders',contacts:'Call Logs',search:'Find Unit',reports:'Reports & Export',recoveryiq:'Recovery Intelligence',myrecovery:'My Recovery',agentrecovery:'Agent Recovery Book',documents:'Documents & Print',statements:'Account Statements',backup:'Data Backup',admin:'Admin Panel',approvals:'Approvals',team:'Team Performance',categories:'Categories',users:'User Management',healthcenter:'Client Health Center',paylinks:'Payment Links','paylink-detail':'Payment Link Detail','payment-methods':'Payment Methods',unitchain:'Ownership Chain',unittransfer:'Transfer Unit',unitchange:'Change Unit',unitcancel:'Cancel Unit',banks:'Banks Master',blacklist:'Blacklist Register',payables:'Payables',receivables:'Additional Receivables',escalations:'Escalation Register',legalcases:'Legal Cases',agenttransactions:'Agent Transactions',campaigns:'Recovery Campaigns',forecasting:'Recovery Forecasting',commscenter:'Communications Center',executive:'Executive Dashboard',noc:'NOC Management',fieldvisits:'Field Visits',reservations:'Reservations',salesaccess:'Portal Access',salesubmissions:'Booking Submissions',dealeragreement:'Dealer Agreement'};
  const tbTitle=document.getElementById('tb-t');
  if(tbTitle)tbTitle.textContent=ts[pg]||pg;
  if(typeof atbSyncCurrent==='function')atbSyncCurrent(pg);
  const crumbPage=document.getElementById('nav-crumb-page');
  if(crumbPage)crumbPage.textContent=ts[pg]||pg;
  const na=document.getElementById('nav-actions');
  const backBtn=document.getElementById('nav-back');
  if(na){
    if(pg==='dashboard'){na.classList.add('hidden');}
    else{
      na.classList.remove('hidden');
      if(backBtn){backBtn.disabled=_navStack.length===0;}
    }
  }
  // Close mobile sidebar on navigation
  closeMobileSidebar();
  // NOTE: values are window.-prefixed so the object literal never throws when a
  // page module is still lazy-loaded (a bare identifier would ReferenceError;
  // window.rXxx is undefined-safe). _navLazyGuard above guarantees the target
  // page's module is loaded before we dispatch. Arrow entries resolve at call
  // time — also safe once their module is in.
  const W=window;
  const fns={dashboard:W.rDash,onlineportal:W.rOnlinePortal,queue:W.rQueue,newsale:W.rNewSale,editsale:W.rEditSale,projects:W.rProjects,projectdetail:W.rProjectDetail,units:W.rUnits,unitdetail:()=>rUD(_uid),clients:W.rClients,clientdetail:W.rClientDetail,agents:W.rAgents,agentdetail:W.rAgentDetail,sales:W.rSales,salesdetail:W.rSaleDetail,recovery:W.rRec,callreport:W.rCallReport,addpayment:W.rAddPayment,receipts:W.rReceipts,pdc:W.rPDC,cancelledunits:W.rCancelLedger,transferunits:W.rTransferLedger,officerledger:W.rOfficerLedger,receivingledger:W.rReceivingLedger,ledgers:W.rLedgers,'ledger-client':W.rLedgerClient,'ledger-unit':W.rLedgerUnit,'ledger-agent':W.rLedgerAgent,'ledger-project':W.rLedgerProject,commissions:W.rCommissions,unittransfer:W.rUnitTransfer,unitcancel:W.rUnitCancel,unitchange:W.rUnitChange,unitchain:W.rUnitChain,reminders:W.rReminders,contacts:W.rCons,search:W.rSearch,reports:W.rReports,recoveryiq:W.rRecoveryIQ,myrecovery:W.rMyRecovery,agentrecovery:W.rAgentRecovery,documents:W.rDocs,statements:W.rStatements,backup:W.rBackup,admin:W.rAdmin,categories:W.rCategories,users:W.rUsers,healthcenter:()=>openClientsTab('health'),promises:W.rPromises,audit:W.rAudit,approvals:W.rApprovals,team:W.rTeam,paylinks:W.rPayLinks,'paylink-detail':W.rPayLinkDetail,'payment-methods':W.rPaymentMethods,changepassword:W.rChangepassword,banks:W.rBanks,blacklist:()=>openClientsTab('blacklist'),payables:W.rPayables,receivables:W.rReceivables,escalations:W.rEscalations,legalcases:W.rLegalCases,agenttransactions:W.rAgentTransactions,campaigns:W.rCampaigns,forecasting:W.rForecasting,commscenter:W.rCommsCenter,noc:W.rNOC,fieldvisits:W.rFieldVisits,reservations:W.rReservations,salesaccess:W.rSalesAccess,salesubmissions:W.rSaleSubmissions,dealeragreement:W.rDealerAgreement};
  const _PAGE_FLAG = {
    noc:'noc', campaigns:'campaigns', forecasting:'forecasting',
    commscenter:'comms_center', executive:'executive_dashboard',
    legalcases:'legal', blacklist:'blacklist',
    escalations:'escalations', pdc:'pdc',
  };
  const requiredFlag = _PAGE_FLAG[pg];
  if (requiredFlag && typeof hasFeature === 'function' && !hasFeature(requiredFlag)) {
    if (typeof _showFeatureGate === 'function') _showFeatureGate(pg);
    return;
  }
  const fn = fns[pg];
  if(fn) {
    const result = fn(x);
    if(result && typeof result.then === 'function') {
      result.catch(err => console.error('Navigation error:', err));
    }
  }
  setTimeout(cleanLeakedCodeText,0);
}
function navBack(){
  const prev=_navStack.pop();
  if(prev){_navBack=true;nav(prev);_navBack=false;}
}

// Global ESC → back navigation (skips if a modal is open — modals.js handles those)
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(document.querySelector('.mov.open'))return;
  const cur=document.querySelector('.pg.on')?.id?.replace('pg-','');
  if(!cur||cur==='dashboard')return;
  // Add Payment: ESC steps back through internal sub-steps before leaving the page
  if(cur==='addpayment'){
    if(typeof _pymSubStep!=='undefined'){
      if(_pymSubStep==='payment'){ _pymShowClientSearch(_pymSelectedProject||''); return; }
      if(_pymSubStep==='clients'){
        const projCount=new Set((window._unitsCache||[]).filter(u=>u.isAvailable===false&&u.projectId).map(u=>u.projectId)).size;
        if(projCount>1){ _pymShowProjectPicker(); return; }
        // only 1 project → fall through to navBack
      }
      // 'projects' or single-project clients → let navBack run normally
    }
  }
  navBack();
});

function openUD(id){_uid=id;nav('unitdetail');}

// rDocs is now defined in js/pages/documents.js

// ══ GLOBAL SLEEK CARD UTILITY ══════════════════════════════════════════
// Rules:
//   - ALL cards → persistent 3D drop-shadow (always on)
//   - Clickable cards only → hover lift + sweep line
//   - Non-clickable cards → shadow only, no hover animation
//
// "Clickable" = has onclick attribute OR computed cursor:pointer
//
var _CARD_SEL = [
  '.card','.db-card','.sa-card','.stat-card','.doc-card',
  '.adm-nav-card','.rops-buyer-card','.rh-kpi-card','.cat-pos-card',
  '.ud-card','.ud-header-card','.ud-doc-card','.pl-stat-card',
  '.ob-existing-card','.ob-user-card','.ob-mode-card',
  '.zp-card','.rq-card','.rops-chain-card','.rd-qr-card',
  '.pmx-card','.pm-card','.inv-board-card','.sa-partner-card',
  '.inv-grid-card','.db-kpi','.db-wcat','.db-hcell','.rops-kpi'
].join(',');

// Shared filter values — used by both _sleekCard and inline _cardEnter/_cardLeave handlers
var _cFR = 'drop-shadow(0 4px 2px rgba(0,0,0,.30)) drop-shadow(0 10px 18px rgba(0,0,0,.20))';
var _cFH = 'drop-shadow(0 8px 4px rgba(0,0,0,.36)) drop-shadow(0 20px 30px rgba(0,0,0,.28))';

// Called directly from onmouseenter/onmouseleave on cards that can't rely on the MutationObserver
function _cardEnter(el) {
  el.style.setProperty('filter', _cFH, 'important');
  el.style.setProperty('transform', 'translateY(-4px) scale(1.01)', 'important');
  var col = el.dataset.col || '#2563EB';
  el.style.setProperty('border-color', col + '66', 'important');
  var l = el.querySelector('[data-sl]');
  if (l) l.style.width = '100%';
}
function _cardLeave(el) {
  el.style.setProperty('filter', _cFR, 'important');
  el.style.setProperty('transform', 'translateY(0)', 'important');
  el.style.removeProperty('border-color');
  var l = el.querySelector('[data-sl]');
  if (l) l.style.width = '0%';
}

function _sleekCard(el, accentColor) {
  if (!el || el._sk) return;
  // Cards with inline _cardEnter handlers are self-sufficient — skip to avoid double listeners
  if (el.getAttribute('onmouseenter') === '_cardEnter(this)') { el._sk = true; return; }
  el._sk = true;

  if (window.getComputedStyle(el).position === 'static') el.style.setProperty('position', 'relative', 'important');

  var hex = /^#[0-9a-fA-F]{6}/.test(accentColor || '') ? accentColor : '#2563EB';

  // Inline !important beats CSS !important — restores 3D filter shadow despite visual-overhaul.css overrides
  el.style.setProperty('filter', _cFR, 'important');
  el.style.setProperty('transform', 'translateY(0)', 'important');
  el.style.setProperty('transition',
    'filter .22s ease, transform .22s cubic-bezier(.34,1.56,.64,1), border-color .2s ease', 'important');

  var isClickable = !!el.getAttribute('onclick') || window.getComputedStyle(el).cursor === 'pointer';

  if (!isClickable) {
    el.addEventListener('mouseenter', function() {
      el.style.setProperty('filter', _cFH, 'important');
      el.style.setProperty('transform', 'translateY(-2px)', 'important');
    });
    el.addEventListener('mouseleave', function() {
      el.style.setProperty('filter', _cFR, 'important');
      el.style.setProperty('transform', 'translateY(0)', 'important');
    });
    return;
  }

  // Sweep line — left to right on hover
  var line = document.createElement('div');
  line.setAttribute('data-sleek-line', '1');
  line.style.cssText = 'position:absolute;top:0;left:0;height:3px;width:0%;pointer-events:none;z-index:9;'
    + 'background:linear-gradient(90deg,' + hex + ',' + hex + '88);border-radius:3px 3px 0 0;'
    + 'transition:width .32s cubic-bezier(.4,0,.2,1);';
  el.insertBefore(line, el.firstChild);

  el.addEventListener('mouseenter', function() {
    el.style.setProperty('filter', _cFH, 'important');
    el.style.setProperty('transform', 'translateY(-4px) scale(1.01)', 'important');
    el.style.setProperty('border-color', hex + '66', 'important');
    line.style.width = '100%';
  });
  el.addEventListener('mouseleave', function() {
    el.style.setProperty('filter', _cFR, 'important');
    el.style.setProperty('transform', 'translateY(0)', 'important');
    el.style.removeProperty('border-color');
    line.style.width = '0%';
  });
}

function _applyPageSleek(root) {
  var scope = root || document.querySelector('.pg.on') || document;
  scope.querySelectorAll(_CARD_SEL).forEach(function(c) { _sleekCard(c, c.dataset.col); });
}

// Auto-observer — every card class, anywhere in the app, auto-processed
;(function() {
  function _onNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches && node.matches(_CARD_SEL)) { _sleekCard(node, node.dataset.col); return; }
    if (node.querySelectorAll) {
      node.querySelectorAll(_CARD_SEL).forEach(function(c) { _sleekCard(c, c.dataset.col); });
    }
  }
  var _obs = new MutationObserver(function(muts) {
    muts.forEach(function(m) { m.addedNodes.forEach(_onNode); });
  });
  function _startObs() { _obs.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) _startObs();
  else document.addEventListener('DOMContentLoaded', _startObs);
}());

function cleanLeakedCodeText(){
  // Only scan the active page container — not the whole .pw tree.
  // The leak originates in pg-recovery so scope the walk there first;
  // fall back to full scan only if that element isn't found.
  const scope=document.getElementById('pg-recovery')||document.querySelector('.pw');
  if(!scope)return;
  const bad=['function rRec','function rRecF',"document.getElementById('pg-recovery')",'w.document.close();setTimeout','let _rf={fr:','// ══ RECOVERY PAGE'];
  const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
  const toRemove=[];
  while(walker.nextNode()){
    const n=walker.currentNode,tx=(n.nodeValue||'').trim();
    if(!tx)continue;
    if(tx.length>28&&bad.some(k=>tx.includes(k)))toRemove.push(n);
  }
  toRemove.forEach(n=>n.parentNode&&n.parentNode.removeChild(n));
}
function startLeakGuard(){
  if(_leakGuardOn)return;
  const root=document.querySelector('.pw');
  if(!root)return;
  _leakGuardOn=true;
  let _lgTimer=null;
  const run=()=>cleanLeakedCodeText();
  // MutationObserver only — no setInterval. Debounced so rapid renders
  // (e.g. loading 200-unit page) only fire one TreeWalker pass 2s after settling.
  const mo=new MutationObserver(()=>{clearTimeout(_lgTimer);_lgTimer=setTimeout(run,2000);});
  mo.observe(root,{childList:true,subtree:true});
}

// ══ QUICK ACTION FAB — RETIRED (Nav phase, 2026-06-12) ════════════════
// The floating quick-action button is gone; its actions now live in the topbar
// "+ New" menu (js/foundation/shell.js). qabToggle/qabClose removed.
