// ══ ACCOUNT STATEMENTS (on-screen) ════════════════════════════════════════════
// Lives under Reports & Ledgers. Left: every sold unit with its client name
// (searchable). Tap a unit → the full Account Statement renders on the right,
// on screen, with a Print button. Data + body are shared with print.js
// (_stmtData / _stmtBody / printClientStatement).
'use strict';

window._stmtCurRef = null;

function _stmtScreenCss(){
  return `<style>
    #pg-statements .stmt-wrap{display:grid;grid-template-columns:320px 1fr;gap:var(--fk-sp-4);align-items:start}
    #pg-statements .stmt-list{border:1px solid var(--fk-border);border-radius:var(--fk-radius-card);background:var(--fk-bg-card);overflow:hidden;position:sticky;top:8px}
    #pg-statements .stmt-search{padding:10px;border-bottom:1px solid var(--fk-border)}
    #pg-statements #stmt-rows{max-height:72vh;overflow-y:auto}
    #pg-statements .stmt-row{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--fk-border);transition:background .12s}
    #pg-statements .stmt-row:last-child{border-bottom:0}
    #pg-statements .stmt-row:hover{background:var(--fk-subtle-hover)}
    #pg-statements .stmt-row.is-active{background:var(--fk-primary-surface)}
    #pg-statements .stmt-row-unit{min-width:46px;font-weight:700;font-size:var(--fk-fs-label);color:var(--fk-primary)}
    #pg-statements .stmt-row-main{flex:1;min-width:0}
    #pg-statements .stmt-row-name{font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #pg-statements .stmt-row-sub{font-size:var(--fk-fs-label);color:var(--fk-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #pg-statements .stmt-row-chev{color:var(--fk-text-muted);display:flex;flex-shrink:0}
    #pg-statements .stmt-empty{padding:48px 20px;text-align:center;color:var(--fk-text-muted);font-size:var(--fk-fs-body)}
    #pg-statements .stmt-actions{display:flex;justify-content:flex-end;margin-bottom:10px}
    /* on-screen "paper" — the shared statement HTML uses doc-title/sec-title/info-grid/table */
    #pg-statements .stmt-paper{background:#fff;color:#1a1a1a;border:1px solid var(--fk-border);border-radius:8px;padding:22px 26px;box-shadow:var(--fk-shadow);overflow-x:auto}
    #pg-statements .stmt-paper .doc-title{font-size:16px;font-weight:700;color:#1E2D47;margin-bottom:6px;border-bottom:2px solid #1E2D47;padding-bottom:5px}
    #pg-statements .stmt-paper .sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1E2D47;margin:16px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}
    #pg-statements .stmt-paper .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 22px;margin-bottom:6px}
    #pg-statements .stmt-paper .ig-item{display:flex;justify-content:space-between;gap:10px;font-size:11px;padding:3px 0;border-bottom:1px dotted #e5e7eb}
    #pg-statements .stmt-paper .ig-lbl{color:#666}
    #pg-statements .stmt-paper .ig-val{font-weight:600;color:#1a1a1a;text-align:right}
    #pg-statements .stmt-paper table{width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:11px;font-variant-numeric:tabular-nums}
    #pg-statements .stmt-paper th{background:#f3f4f6;text-align:left;padding:6px 8px;border-bottom:2px solid #ccc;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;color:#444}
    #pg-statements .stmt-paper td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}
    @media(max-width:920px){ #pg-statements .stmt-wrap{grid-template-columns:1fr} #pg-statements .stmt-list{position:static} }
  </style>`;
}

function _stmtSoldUnits(){
  return (typeof gunits==='function'?gunits():[]).filter(function(u){ return u.saleId && u.customerName; });
}

function _stmtRows(units, q){
  var lq=(q||'').toLowerCase().trim();
  var list=units.filter(function(u){
    return !lq || (u.unitNo||'').toLowerCase().indexOf(lq)>=0
                || (u.customerName||'').toLowerCase().indexOf(lq)>=0
                || (u.projectName||'').toLowerCase().indexOf(lq)>=0;
  });
  list.sort(function(a,b){ return String(a.unitNo||'').localeCompare(String(b.unitNo||''),undefined,{numeric:true}); });
  if(!list.length) return '<div class="stmt-empty">No matching units</div>';
  return list.map(function(u){
    var sub = esc(u.projectName||'') + (u.type?' · '+esc(u.type):'');
    return '<div class="stmt-row" data-uid="'+esc(u.id)+'" onclick="_stmtOpen(\''+esc(u.id)+'\',this)">'
      + '<div class="stmt-row-unit">'+esc(u.unitNo||'—')+'</div>'
      + '<div class="stmt-row-main"><div class="stmt-row-name">'+esc(u.customerName||'—')+'</div>'
      +   '<div class="stmt-row-sub">'+sub+'</div></div>'
      + '<span class="stmt-row-chev">'+NX.icon('chevron-right',16)+'</span></div>';
  }).join('');
}

function rStatements(){
  var pg=document.getElementById('pg-statements'); if(!pg) return;
  window._stmtCurRef=null;
  var units=_stmtSoldUnits();
  pg.innerHTML='<div class="ani">'
    + NX.pageHeader('Account Statements','',{icon:'file-text', sub:'Tap a unit to open its full account statement on screen'})
    + _stmtScreenCss()
    + '<div class="stmt-wrap">'
    +   '<div class="stmt-list">'
    +     '<div class="stmt-search"><input id="stmt-q" class="nx-input" placeholder="Search unit, client or project…" autocomplete="off" oninput="_stmtFilter(this.value)"></div>'
    +     '<div id="stmt-rows">'+_stmtRows(units,'')+'</div>'
    +   '</div>'
    +   '<div class="stmt-detail" id="stmt-detail">'+ (NX.empty?NX.empty({icon:'file-text',message:'Select a unit on the left to view its account statement'}):'<div class="stmt-empty">Select a unit…</div>') +'</div>'
    + '</div>'
    + '</div>';
}

function _stmtFilter(q){
  var el=document.getElementById('stmt-rows'); if(!el) return;
  el.innerHTML=_stmtRows(_stmtSoldUnits(), q);
}

async function _stmtOpen(unitId, rowEl){
  var det=document.getElementById('stmt-detail'); if(!det) return;
  document.querySelectorAll('#pg-statements .stmt-row.is-active').forEach(function(r){ r.classList.remove('is-active'); });
  if(rowEl) rowEl.classList.add('is-active');

  var u=_stmtSoldUnits().find(function(x){ return x.id===unitId; });
  var ref = u ? (u.clientId || u.customerName) : null;
  window._stmtCurRef = ref;
  if(!ref){ det.innerHTML='<div class="stmt-empty">No client linked to this unit.</div>'; return; }

  det.innerHTML='<div class="stmt-empty">Loading statement…</div>';
  try {
    var data = await _stmtData(ref);
    if(!data){ det.innerHTML='<div class="stmt-empty">No statement found for this client.</div>'; return; }
    det.innerHTML =
      '<div class="stmt-actions">' + NX.button('Print', { variant:'primary', icon:'printer', onclick:'_stmtPrint()' }) + '</div>'
      + '<div class="stmt-paper">' + _stmtBody(data) + '</div>';
  } catch(e){
    det.innerHTML='<div class="stmt-empty">Could not load statement: '+esc(e.message||String(e))+'</div>';
  }
}

function _stmtPrint(){
  if(window._stmtCurRef && typeof printClientStatement==='function') printClientStatement(window._stmtCurRef);
}
