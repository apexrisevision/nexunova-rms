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
  var coName=S?S.coName||'Nexunova':'Nexunova';
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
      tbC.innerHTML='<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#4F46E5;color:white;font-size:11px;font-weight:700;margin-right:5px;vertical-align:middle;flex-shrink:0">'+ini_+'</span>'+coName;
    }
  }
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
    'tag':            '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
    'repeat':              '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    'arrow-down-circle':   '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
    'arrow-up-circle':     '<circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/>',
    'alert-triangle':      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'shield-off':          '<path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"/><path d="m2 2 20 20"/><path d="M4.73 4.73 4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38"/>',
    'scale':               '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21H17"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(P[name]||'')+'</svg>';
}

function buildSB(){
  const fus  = gfus();
  const role = effectiveRole();
  const isA  = role==='admin'||role==='owner';
  const isR  = role==='recovery';
  const isAc = role==='accounts';

  // Overdue count (matches dashboard strip)
  const units     = typeof gunits==='function'?gunits():[];
  const soldU     = units.filter(u=>u.status!=='Available'&&u.status!=='Dead');
  const od        = typeof getOverdueDays==='function'?getOverdueDays():30;
  const overdueN  = typeof isOverdue==='function'
    ? soldU.filter(u=>isOverdue(u,od)&&typeof actualPending==='function'&&actualPending(u)>0).length
    : 0;
  const totalU    = units.length;
  const alrt      = overdueN;

  // Each group: { label: string|null, items: [{id, ic, lb, bdg, bdgType}] }
  let navGroups = [];

  if(isA){
    navGroups = [
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
        { id:'contacts',  ic:'inbox',       lb:'Inbox',   bdg:alrt, bdgType:alrt?'alert':null },
      ]},
      { label: 'Setup', items: [
        { id:'projects',   ic:'building-2', lb:'Projects' },
        { id:'categories', ic:'layers',     lb:'Types & Floors' },
        { id:'agents',     ic:'users',      lb:'Sales Agents' },
      ]},
      // ── Inventory: every unit-related screen lives here ──
      // All Units → Sales & Bookings → Cancelled → Transferred
      // (Clients moved to CRM section since they're people, not units.)
      { label: 'Inventory', items: [
        { id:'units',          ic:'home',      lb:'All Units', bdg:totalU||null },
        { id:'sales',          ic:'file-text', lb:'Sales & Bookings' },
        { id:'cancelledunits', ic:'tag',       lb:'Cancelled Units' },
        { id:'transferunits',  ic:'repeat',    lb:'Transferred Units' },
      ]},
      { label: 'Finance', items: [
        { id:'recovery',    ic:'banknote',      lb:'Payments' },
        { id:'addpayment',  ic:'credit-card',   lb:'Add Payment' },
        { id:'receipts',    ic:'receipt',       lb:'Receipt Vouchers' },
        { id:'pdc',         ic:'calendar-clock',lb:'PDC Register' },
        { id:'commissions', ic:'trending-up',   lb:'Commissions' },
        { id:'reports',     ic:'alert-circle',  lb:'Outstanding', bdg:alrt||null, bdgType:alrt?'alert':null },
      ]},
      { label: 'Clients & CRM', items: [
        { id:'clients',      ic:'user-check',lb:'Clients' },
        { id:'reminders',    ic:'bell',      lb:'Reminders' },
        { id:'contacts',     ic:'phone',     lb:'Call Logs' },
        { id:'promises',     ic:'handshake', lb:'Promise Tracker' },
        { id:'healthcenter', ic:'heart',     lb:'Client Health' },
        { id:'radar',        ic:'radar',     lb:'Recovery Radar' },
        { id:'paylinks',     ic:'link',      lb:'Payment Links' },
      ]},
      { label: 'Reports & Analytics', items: [
        { id:'reports',   ic:'bar-chart-3', lb:'Reports & Export' },
        { id:'ledgers',   ic:'book-open',   lb:'Ledgers' },
        { id:'documents', ic:'printer',     lb:'Documents' },
      ]},
      { label: 'Finance & Compliance', items: [
        { id:'payables',          ic:'arrow-down-circle', lb:'Payables' },
        { id:'receivables',       ic:'arrow-up-circle',   lb:'Additional Receivables' },
        { id:'escalations',       ic:'alert-triangle',    lb:'Escalations' },
        { id:'legalcases',        ic:'scale',             lb:'Legal Cases' },
        { id:'blacklist',         ic:'shield-off',        lb:'Blacklist Register' },
        { id:'agenttransactions', ic:'trending-up',       lb:'Agent Transactions' },
      ]},
      { label: 'Admin', items: [
        { id:'users',  ic:'shield',   lb:'Users & Roles' },
        { id:'admin',  ic:'settings', lb:'Settings' },
        { id:'banks',  ic:'banknote', lb:'Banks Master' },
        { id:'backup', ic:'database', lb:'Backup' },
        { id:'audit',  ic:'history',  lb:'Audit Trail' },
      ]},
    ];
  } else if(isR){
    navGroups = [
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
        { id:'contacts',  ic:'inbox',       lb:'Inbox', bdg:alrt, bdgType:alrt?'alert':null },
      ]},
      { label: 'Inventory', items: [
        { id:'units',          ic:'home',   lb:'All Units' },
        { id:'cancelledunits', ic:'tag',    lb:'Cancelled Units' },
        { id:'transferunits',  ic:'repeat', lb:'Transferred Units' },
      ]},
      { label: 'Clients & Payments', items: [
        { id:'clients',    ic:'user-check', lb:'Clients' },
        { id:'addpayment', ic:'credit-card',lb:'Add Payment' },
        { id:'ledgers',    ic:'book-open',  lb:'Ledgers' },
      ]},
      { label: 'Follow-Up', items: [
        { id:'recovery',  ic:'banknote',      lb:'Payments' },
        { id:'receipts',  ic:'receipt',       lb:'Receipt Vouchers' },
        { id:'pdc',       ic:'calendar-clock',lb:'PDC Register' },
        { id:'reminders', ic:'bell',          lb:'Reminders' },
        { id:'contacts',  ic:'phone',         lb:'Call Logs' },
        { id:'paylinks',  ic:'link',          lb:'Payment Links' },
      ]},
    ];
  } else if(isAc){
    navGroups = [
      { label: null, items: [
        { id:'dashboard', ic:'layout-grid', lb:'Dashboard' },
      ]},
      { label: 'Inventory', items: [
        { id:'sales',          ic:'file-text', lb:'Sales & Bookings' },
        { id:'cancelledunits', ic:'tag',       lb:'Cancelled Units' },
        { id:'transferunits',  ic:'repeat',    lb:'Transferred Units' },
      ]},
      { label: 'People & Ledgers', items: [
        { id:'clients', ic:'user-check', lb:'Clients' },
        { id:'agents',  ic:'users',      lb:'Sales Agents' },
        { id:'ledgers', ic:'book-open',  lb:'Ledgers' },
      ]},
      { label: 'Finance', items: [
        { id:'recovery',   ic:'banknote',   lb:'Payments' },
        { id:'addpayment', ic:'credit-card',lb:'Add Payment' },
        { id:'paylinks',   ic:'link',       lb:'Payment Links' },
      ]},
      { label: 'Reports', items: [
        { id:'reports',   ic:'bar-chart-3', lb:'Reports' },
        { id:'documents', ic:'printer',     lb:'Documents' },
      ]},
    ];
  } else {
    // manager, staff, or any other role — permission-driven sidebar
    // Only include modules the user has explicit access to via module_permissions
    const _allModuleItems = [
      { key:'projects',  id:'projects',   ic:'building-2',  lb:'Projects' },
      { key:'units',     id:'units',      ic:'home',        lb:'All Units' },
      { key:'clients',   id:'clients',    ic:'user-check',  lb:'Clients' },
      { key:'recovery',  id:'recovery',   ic:'banknote',    lb:'Payments' },
      { key:'recovery',  id:'addpayment', ic:'credit-card', lb:'Add Payment' },
      { key:'contacts',  id:'contacts',   ic:'phone',       lb:'Call Logs' },
      { key:'reports',   id:'reports',    ic:'bar-chart-3', lb:'Reports' },
      { key:'documents', id:'documents',  ic:'printer',     lb:'Documents' },
      { key:'agents',    id:'agents',     ic:'users',       lb:'Sales Agents' },
      { key:'search',    id:'search',     ic:'search',      lb:'Quick Search' },
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

  // ── Build HTML ──
  const grpStates = _getGroupStates();
  let html = '';
  navGroups.forEach(function(g){
    if(!g.label){
      g.items.forEach(function(x){ html += _mkNi(x, false, null); });
    } else {
      const gid     = g.label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      const isCol   = !!grpStates[gid];
      const chevron = '<svg class="nav-grp-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '<div class="nav-group'+(isCol?' collapsed':'')+'" data-gid="'+gid+'">';
      html += '<button class="nav-grp-hd" onclick="toggleNavGroup(\''+gid+'\')">'
            + chevron
            + '<span class="nav-grp-lbl">'+g.label+'</span>'
            + '<span class="nav-grp-cnt">'+g.items.length+'</span>'
            + '</button>';
      html += '<div class="nav-grp-body" data-gid="'+gid+'"'+(isCol?' style="display:none"':'')+' >';
      g.items.forEach(function(x){ html += _mkNi(x, true, g.label); });
      html += '</div></div>';
    }
  });

  document.getElementById('sb-nav').innerHTML = html;

  // Expose nav groups for the aurora-topbar mega menu (same data, same source of truth)
  window._navGroups = navGroups;
  if (typeof buildTopbarMega === 'function') buildTopbarMega();
}

function _mkNi(x, isSub, grpLabel){
  const cls     = 'ni' + (isSub ? ' ni-sub' : '');
  const tooltip = (isSub && grpLabel) ? grpLabel+' → '+x.lb : x.lb;
  const bdg     = x.bdg ? '<span class="ni-bdg'+(x.bdgType?' '+x.bdgType:'')+'">'+x.bdg+'</span>' : '';
  return '<div class="'+cls+'" data-pg="'+x.id+'" data-label="'+tooltip+'" onclick="nav(\''+x.id+'\')">'
       + '<span class="ni-ic">'+_sbi(x.ic)+'</span>'
       + '<span class="ni-lb">'+x.lb+'</span>'
       + bdg + '</div>';
}

// ── GROUP COLLAPSE STATE ──────────────────────────
function _getGroupStates(){
  try{return JSON.parse(localStorage.getItem('rms.sidebar.groups')||'{}');}catch(e){return{};}
}
function setCollapsedGroup(gid,collapsed){
  try{var s=_getGroupStates();s[gid]=collapsed;localStorage.setItem('rms.sidebar.groups',JSON.stringify(s));}catch(e){}
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
  // ── Permission guard ──
  if(S&&S.role!=='admin'&&S.role!=='owner'){
    const r=effectiveRole();
    // Always-allowed pages for any authenticated non-admin user
    const _alwaysAllow=['dashboard','changepassword'];
    if(!_alwaysAllow.includes(pg)){
      // Role-based baseline allow-list (backward-compatible for existing users)
      const allow={
        recovery:['dashboard','units','unitdetail','search','clients','clientdetail','recovery','addpayment','receipts','pdc','cancelledunits','transferunits','officerledger','receivingledger','ledgers','ledger-client','ledger-unit','ledger-agent','ledger-project','reminders','contacts','sales','salesdetail','paylinks','paylink-detail'],
        accounts:['dashboard','recovery','addpayment','pdc','cancelledunits','transferunits','officerledger','receivingledger','ledgers','ledger-client','ledger-unit','ledger-agent','ledger-project','commissions','reports','documents','clients','clientdetail','agents','agentdetail','sales','salesdetail','paylinks','paylink-detail'],
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
  }
  document.querySelector('.sb')?.setAttribute('data-pg', pg);
  const ts={dashboard:'Dashboard',addunit:'Add Inventory',newsale:'New Sale',editsale:'Edit Sale',projects:'Projects',projectdetail:'Project Detail',units:'Inventory',unitdetail:'Unit Detail',clients:'All Clients',clientdetail:'Client Detail',agents:'Sales Agents',agentdetail:'Agent Detail',sales:'Sales',salesdetail:'Sale Detail',recovery:'Payments',addpayment:'Add Payment',receipts:'Receipt Vouchers',pdc:'PDC Register',cancelledunits:'Cancelled Units Ledger',transferunits:'Transferred Units Ledger',officerledger:'Officer Ledger',receivingledger:'Receiving Ledger',ledgers:'Ledgers','ledger-client':'Client Ledger','ledger-unit':'Unit Ledger','ledger-agent':'Agent Ledger','ledger-project':'Project Ledger',commissions:'Pay Commission',reminders:'Reminders',contacts:'Call Logs',search:'Find Unit',reports:'Reports & Export',documents:'Documents & Print',backup:'Data Backup',admin:'Admin Panel',categories:'Categories',users:'User Management',healthcenter:'Client Health Center',paylinks:'Payment Links','paylink-detail':'Payment Link Detail','payment-methods':'Payment Methods',unitchain:'Ownership Chain',unittransfer:'Transfer Unit',unitcancel:'Cancel Unit',banks:'Banks Master',blacklist:'Blacklist Register',payables:'Payables',receivables:'Additional Receivables',escalations:'Escalation Register',legalcases:'Legal Cases',agenttransactions:'Agent Transactions'};
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
  const fns={dashboard:rDash,addunit:rAddUnit,newsale:rNewSale,editsale:rEditSale,projects:rProjects,projectdetail:rProjectDetail,units:rUnits,unitdetail:()=>rUD(_uid),clients:rClients,clientdetail:rClientDetail,agents:rAgents,agentdetail:rAgentDetail,sales:rSales,salesdetail:rSaleDetail,recovery:rRec,addpayment:rAddPayment,receipts:rReceipts,pdc:rPDC,cancelledunits:rCancelLedger,transferunits:rTransferLedger,officerledger:rOfficerLedger,receivingledger:rReceivingLedger,ledgers:rLedgers,'ledger-client':rLedgerClient,'ledger-unit':rLedgerUnit,'ledger-agent':rLedgerAgent,'ledger-project':rLedgerProject,commissions:rCommissions,unittransfer:rUnitTransfer,unitcancel:rUnitCancel,unitchain:rUnitChain,reminders:rReminders,contacts:rCons,search:rSearch,reports:rReports,documents:rDocs,backup:rBackup,admin:rAdmin,categories:rCategories,users:rUsers,healthcenter:rHealthCenter,radar:rRadar,promises:rPromises,audit:rAudit,paylinks:rPayLinks,'paylink-detail':rPayLinkDetail,'payment-methods':rPaymentMethods,changepassword:rChangepassword,banks:rBanks,blacklist:rBlacklist,payables:rPayables,receivables:rReceivables,escalations:rEscalations,legalcases:rLegalCases,agenttransactions:rAgentTransactions};
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
