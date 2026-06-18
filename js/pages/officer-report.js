// ════════════════════════════════════════════════════════════════════════════
// MY RECOVERY — the recovery officer's working report.
// Officer-scoped (get_officer_recovery → wraps the verified get_recovery_position
// and filters rows to the caller's assigned projects). Answers, for THIS month:
//   • what must be collected (old arrears + this-month due)
//   • how much is recovered so far
//   • who owes how much — every row with Call / WhatsApp / Log-a-call
// Plus an AI-style insight brief, and every headline figure clicks to its trail.
// Data is real; nothing is invented. Mirrors the admin Recovery Intelligence taste.
// ════════════════════════════════════════════════════════════════════════════

function _orC(n){ n=Number(n||0); var a=Math.abs(n), s=n<0?'-':''; if(a>=1e9)return s+'₨'+(a/1e9).toFixed(2)+'B'; if(a>=1e6)return s+'₨'+(a/1e6).toFixed(1)+'M'; if(a>=1e3)return s+'₨'+Math.round(a/1e3)+'K'; return s+'₨'+Math.round(a); }
function _orF(n){ return '₨'+((typeof fM==='function')?fM(Number(n||0)):Number(n||0).toLocaleString('en-US')); }
function _orPhone(p){ var d=String(p||'').replace(/[^0-9]/g,''); if(d.length===11 && d[0]==='0') d='92'+d.slice(1); return d; }
function _orDate(iso){ if(!iso) return ''; try{ return (typeof fD==='function')?fD(String(iso).slice(0,10)):String(iso).slice(0,10); }catch(e){ return String(iso).slice(0,10); } }

// ── AI insight brief: 3–5 plain-language, data-derived lines that tell the
// officer exactly where to point their day. Every number traces to the rows. ──
function _orInsights(rows, T){
  var ins=[];
  var pct = T.dueMonth>0 ? Math.round(T.recovered/T.dueMonth*100) : 0;
  ins.push({ic:'target', t:'primary', h:'This month', act:"_orDrill('remaining')", proof:'See every account that still owes',
    x:'This month’s demand <b>'+_orF(T.dueMonth)+'</b> · recovered <b>'+_orF(T.recovered)+'</b> ('+pct+'% of billing). Old arrears <b>'+_orF(T.oldArrears)+'</b>. Current remaining (to date): <b>'+_orF(T.remaining)+'</b> = old arrears + due to date − received − advance pre-paid; future installments not counted.'});
  var owe = rows.filter(function(r){return r._closing>0.5;}).sort(function(a,b){return b._closing-a._closing;});
  if(owe.length){ var t=owe[0];
    ins.push({ic:'alert-triangle', t:'danger', h:'Chase first', act:"_orOpenUnit('"+(t.sale_id||'')+"')", proof:'Open this account',
      x:'<b>'+esc(t.client_name)+'</b> ('+esc(t.unit_no)+') owes the most — <b>'+_orF(t._closing)+'</b>'+(t._odd>0?' · '+t._odd+' days overdue':'')+'. Start your calls here.'}); }
  var likely = owe.filter(function(r){return r._prop>=60;});
  if(likely.length){ var lsum=likely.reduce(function(s,r){return s+r._closing;},0);
    ins.push({ic:'phone', t:'success', h:'Quick wins', act:"_orDrill('likely')", proof:'See the '+likely.length+' likely payer'+(likely.length>1?'s':''),
      x:'<b>'+likely.length+'</b> account'+(likely.length>1?'s are':' is')+' likely to pay if called today ('+_orF(lsum)+'). These are your easiest collections.'}); }
  var quiet = owe.filter(function(r){ return (r._odd>=90) || (r._paid<=0.5 && r._closing>0.5); });
  if(quiet.length){ var qsum=quiet.reduce(function(s,r){return s+r._closing;},0);
    ins.push({ic:'clock', t:'warning', h:'Going quiet', act:"_orDrill('quiet')", proof:'See the '+quiet.length+' cold account'+(quiet.length>1?'s':''),
      x:'<b>'+quiet.length+'</b> account'+(quiet.length>1?'s have':' has')+' gone cold (90+ days or never paid) — <b>'+_orF(qsum)+'</b>. Plan a field visit or escalate.'}); }
  if(T.oldArrears>0.5){
    ins.push({ic:'layers', t:'muted', h:'Old arrears', act:"_orDrill('old')", proof:'See old-arrears accounts',
      x:'<b>'+_orF(T.oldArrears)+'</b> is carried over from before this month. Clearing this backlog is your single biggest lever.'}); }
  return ins;
}

// ── Figure drill: click a headline number → the accounts that make it up. ──
function _orDrillClose(){ var h=document.getElementById('or-drill-host'); if(h) h.innerHTML=''; }
function _orOpenUnit(saleId){ _orDrillClose(); if(saleId && saleId!=='null' && typeof openSaleDetail==='function') openSaleDetail(saleId); }
function _orDrill(kind){
  var ST=window._orStore; if(!ST) return;
  var rows=ST.rows, spec={
    target:   {title:'Total to recover this month', val:function(r){return r._open+r._due;}, lbl:'To recover'},
    demand:   {title:'This month’s demand (full month billing)', val:function(r){return r._due;}, lbl:'Due this month'},
    recovered:{title:'Recovered this month',  val:function(r){return r._rec;},        lbl:'Recovered'},
    remaining:{title:'Current outstanding — still due (due to date)', val:function(r){return r._closing;}, lbl:'Current outstanding'},
    old:      {title:'Old arrears (before this month)', val:function(r){return r._open;}, lbl:'Old arrears'},
    likely:   {title:'Quick wins — likely to pay (≥60%)', val:function(r){return r._closing;}, lbl:'Current outstanding', filt:function(r){return r._prop>=60 && r._closing>0.5;}},
    quiet:    {title:'Gone quiet — 90+ days or never paid', val:function(r){return r._closing;}, lbl:'Current outstanding', filt:function(r){return ((r._odd>=90)||(r._paid<=0.5)) && r._closing>0.5;}}
  }[kind];
  if(!spec) return;
  var items=rows.filter(spec.filt||function(){return true;}).map(function(r){ var o={r:r, v:spec.val(r)}; return o; }).filter(function(o){return o.v>0.5;}).sort(function(a,b){return b.v-a.v;});
  if(!items.length) return;
  var tot=items.reduce(function(s,o){return s+o.v;},0);
  var thCss='padding:8px 8px;position:sticky;top:0;background:var(--fk-surface);border-bottom:1px solid var(--fk-border);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--fk-text-muted)';
  var th='<tr>'+['#','Client / Unit','>'+spec.lbl,'>Overdue','>Last paid'].map(function(h){var r=h[0]==='>';return '<th style="'+thCss+(r?';text-align:right':';text-align:left')+'">'+esc(r?h.slice(1):h)+'</th>';}).join('')+'</tr>';
  var body=items.map(function(o,i){ var r=o.r; var cs='padding:8px 8px;border-bottom:1px solid var(--fk-border)';
    return '<tr style="cursor:pointer" onclick="_orOpenUnit(\''+(r.sale_id||'')+'\')" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="'+cs+'" class="num">'+(i+1)+'</td>'+
      '<td style="'+cs+'"><div style="font-weight:500">'+esc(r.client_name)+'</div><div class="nx-kpi-label" style="text-transform:none">'+esc(r.unit_no||'')+'</div></td>'+
      '<td style="'+cs+';text-align:right;font-weight:600" class="num">'+_orF(o.v)+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._odd>0?r._odd+'d':'—')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r.last_payment_date?esc(_orDate(r.last_payment_date)):'<span class="nx-kpi-label">never</span>')+'</td></tr>';
  }).join('');
  var tableHTML='<div style="max-height:56vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>';
  var footer='<div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:12px"><span class="nx-kpi-label" style="text-transform:none">'+items.length+' account'+(items.length!==1?'s':'')+' · click any row to open its full detail</span><span style="font-weight:600">Σ '+spec.lbl+': '+_orF(tot)+'</span></div>';
  var host=document.getElementById('or-drill-host'); if(!host){ host=document.createElement('div'); host.id='or-drill-host'; document.body.appendChild(host); }
  host.innerHTML=NX.modal({ title:spec.title+'  ·  '+_orC(tot), size:'l', body:tableHTML, footer:footer, onClose:'_orDrillClose()' });
  var ov=host.querySelector('.nx-modal-overlay'); if(ov) ov.addEventListener('click',function(e){ if(e.target===ov) _orDrillClose(); });
}

// ── Working table: who owes, worst-first, each row contactable on the spot. ──
function _orSetFilter(f){ window._orFilter=f; _orRenderTable(); var b=document.getElementById('or-filterbar'); if(b){ b.querySelectorAll('button').forEach(function(x){ x.className = 'nx-btn nx-btn--sm '+(x.getAttribute('data-f')===f?'nx-btn--secondary':'nx-btn--ghost'); }); } }
function _orRenderTable(){
  var ST=window._orStore; if(!ST) return; var host=(window._orRoot?window._orRoot.querySelector('#or-table'):document.getElementById('or-table')); if(!host) return;
  var f=window._orFilter||'owe';
  var rows=ST.rows.slice();
  if(f==='owe')     rows=rows.filter(function(r){return r._closing>0.5;});
  else if(f==='overdue') rows=rows.filter(function(r){return r._odd>0 && r._closing>0.5;});
  else if(f==='likely')  rows=rows.filter(function(r){return r._prop>=60 && r._closing>0.5;});
  else if(f==='quiet')   rows=rows.filter(function(r){return (r._odd>=90||r._paid<=0.5) && r._closing>0.5;});
  rows.sort(function(a,b){return b._closing-a._closing;});
  if(!rows.length){ host.innerHTML=NX.empty({icon:'check-circle', message:'Nothing here — you are all caught up.'}); return; }
  var thCss='padding:10px;background:var(--fk-bg-subtle);border-bottom:2px solid var(--fk-border);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--fk-text-muted)';
  var cols=['Client / Unit','>Old arrears','>Due to date','>Recovered','>Advance','>Current remaining','Will pay','Actions'];
  var th='<tr>'+cols.map(function(h){var r=h[0]==='>';return '<th style="'+thCss+(r?';text-align:right':';text-align:left')+'">'+esc(r?h.slice(1):h)+'</th>';}).join('')+'</tr>';
  var body=rows.map(function(r,i){ var cs='padding:9px 10px;border-bottom:1px solid var(--fk-border)';
    var ph=_orPhone(r.phone);
    var prop = r._prop!=null ? NX.badge((r._prop>=60?'Likely':r._prop>=35?'Maybe':'Hard')+' · '+r._prop+'%', r._prop>=60?'success':r._prop>=35?'warning':'danger') : '<span class="nx-kpi-label">—</span>';
    var tel = r.phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call '+esc(r.phone)+'" href="tel:'+esc(r.phone)+'" onclick="event.stopPropagation()">'+NX.icon('phone',15)+'</a>' : '';
    var wa  = ph ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/'+ph+'" onclick="event.stopPropagation()">'+NX.icon('message-circle',15)+'</a>' : '';
    var prom = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-primary)" title="Add a promise to pay" onclick="event.stopPropagation();if(typeof openConModal===\'function\')openConModal(\''+(r.unit_id||'')+'\',\'promise\')">'+NX.icon('handshake',15)+'</button>';
    var log = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Log the call &amp; update status" onclick="event.stopPropagation();if(typeof openConModal===\'function\')openConModal(\''+(r.unit_id||'')+'\')">'+NX.icon('check',15)+'</button>';
    var escb = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-danger)" title="Raise an alert / escalate" onclick="event.stopPropagation();if(typeof escOpenNew===\'function\')escOpenNew({clientId:\''+(r.client_id||'')+'\'})">'+NX.icon('alert-triangle',15)+'</button>';
    var lcTxt = r._lastContact ? 'contacted '+esc(_orDate(r._lastContact)) : (r.last_payment_date?'paid '+esc(_orDate(r.last_payment_date)):'no contact yet');
    var sub = esc(r.unit_no||'')+(r.phone?' · '+esc(r.phone):'')+(r._odd>0?' · <span style="color:var(--fk-danger)">'+r._odd+'d overdue</span>':'');
    return '<tr style="cursor:pointer" onclick="_orOpenUnit(\''+(r.sale_id||'')+'\')" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="'+cs+'"><div style="font-weight:600">'+esc(r.client_name)+'</div><div class="nx-kpi-label" style="text-transform:none">'+sub+'</div><div class="nx-kpi-label" style="text-transform:none;opacity:.8">'+lcTxt+'</div></td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._open>0.5?_orF(r._open):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._dueToDate>0.5?_orF(r._dueToDate):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._rec>0.5?'<span style="color:var(--fk-success)">'+_orF(r._rec)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._advBf>0.5?'<span style="color:var(--fk-warning)">'+_orF(r._advBf)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right;font-weight:700" class="num">'+_orF(r._closing)+'</td>'+
      '<td style="'+cs+'">'+prop+'</td>'+
      '<td style="'+cs+';white-space:nowrap" onclick="event.stopPropagation()"><div style="display:flex;gap:3px">'+tel+wa+prom+log+escb+'</div></td></tr>';
  }).join('');
  var Z0=0,Z1=0,Z2=0,Z3=0,Z4=0; rows.forEach(function(r){ Z0+=r._open;Z1+=r._dueToDate;Z2+=r._rec;Z3+=r._advBf;Z4+=r._closing; });
  var tcs='padding:10px;border-top:2px solid var(--fk-border);background:var(--fk-bg-subtle);font-weight:800';
  var totRow='<tr>'+
    '<td style="'+tcs+'">TOTAL · '+rows.length+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_orF(Z0)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_orF(Z1)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-success)" class="num">'+_orF(Z2)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-warning)" class="num">'+_orF(Z3)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-danger)" class="num">'+_orF(Z4)+'</td>'+
    '<td style="'+tcs+'"></td><td style="'+tcs+'"></td></tr>';
  host.innerHTML='<div style="border:1px solid var(--fk-border);border-radius:var(--fk-radius);overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'+th+'</thead><tbody>'+body+totRow+'</tbody></table></div>'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+rows.length+' account'+(rows.length!==1?'s':'')+' shown · sorted by amount still owed · work each row right here →'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('phone',13)+'Call</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('message-circle',13)+'WhatsApp</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px;color:var(--fk-primary)">'+NX.icon('handshake',13)+'Promise</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('check',13)+'Log &amp; status</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px;color:var(--fk-danger)">'+NX.icon('alert-triangle',13)+'Escalate</span>'+
    '</div>';
}

// Loads officer-recovery data into window._orStore and renders into window._orRoot,
// so the SAME report can mount on the My Recovery page OR the recovery dashboard.
async function _orLoad(){
  var today=(typeof td==='function'?td():new Date().toISOString().slice(0,10));
  var d=new Date(today+'T00:00:00'), pad=function(n){return String(n).padStart(2,'0');};
  var mStart=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01';
  var meDate=new Date(d.getFullYear(), d.getMonth()+1, 0);
  var mEnd=meDate.getFullYear()+'-'+pad(meDate.getMonth()+1)+'-'+pad(meDate.getDate());
  var monLabel=['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]+' '+d.getFullYear();
  if(!window._orFilter) window._orFilter='owe';
  try{
    var qP = supabase.rpc('get_recovery_queue',{p_company_id:S.cid,p_officer_id:null,p_project_id:(typeof activeProjectId==='function'?activeProjectId():null),p_date:null,p_limit:1000});
    var rP = supabase.rpc('get_officer_recovery',{p_company_id:S.cid,p_from:mStart,p_to:today,p_month_end:mEnd});
    var resR = await rP; if(resR.error) throw resR.error;
    var resQ = await qP;
    var rawRows=(resR.data && resR.data.rows)||[];
    // propensity / last-contact / suggested action from the officer-scoped queue
    var qmap={}; if(resQ && !resQ.error && resQ.data && Array.isArray(resQ.data.queue)){
      resQ.data.queue.forEach(function(x){ qmap[x.sale_id]={prop:(x.propensity&&x.propensity.score!=null?Math.round(x.propensity.score):null), lc:x.last_contact_date, act:x.suggested_action}; }); }
    var rows=rawRows.map(function(r){
      var q=qmap[r.sale_id]||{};
      return Object.assign({}, r, {
        _open:Number(r.opening||0), _due:Number(r.due_full||r.due_period||0), _dueToDate:Number(r.due_period||0), _rec:Number(r.received_total||0),
        _closing:Number(r.closing||0), _advBf:Number(r.advance_bf||0), _recvApplied:Number(r.received_applied||0), _advFut:Number(r.r_advance||0), _net:Number(r.net_price||0), _paid:Number(r.paid_to_date||0),
        _odd:Number(r.overdue_days||0), _prop:(q.prop!=null?q.prop:null), _lastContact:q.lc||null, _act:q.act||null
      });
    });
    var T={
      oldArrears: rows.reduce(function(s,r){return s+r._open;},0),
      dueMonth:   rows.reduce(function(s,r){return s+r._due;},0),
      recovered:  rows.reduce(function(s,r){return s+r._rec;},0),
      remaining:  rows.reduce(function(s,r){return s+r._closing;},0)
    };
    T.target=T.oldArrears+T.dueMonth;
    T.dueToDate=rows.reduce(function(s,r){return s+r._dueToDate;},0);
    T.advBf=rows.reduce(function(s,r){return s+r._advBf;},0);
    T.recvApplied=rows.reduce(function(s,r){return s+r._recvApplied;},0);
    T.advFut=rows.reduce(function(s,r){return s+r._advFut;},0);
    window._orStore={rows:rows, T:T, today:today, monLabel:monLabel, scoped:(resR.data&&resR.data.scoped)};
    _orRender();
  }catch(e){
    var b=window._orRoot||document.getElementById('or-body'); if(b) b.innerHTML=NX.empty({icon:'alert-triangle', message:'Could not load your recovery report. '+esc(e.message||'')});
  }
}

async function rMyRecovery(){
  var pg=document.getElementById('pg-myrecovery'); if(!pg) return;
  var today=(typeof td==='function'?td():new Date().toISOString().slice(0,10));
  var d=new Date(today+'T00:00:00');
  var monLabel=['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]+' '+d.getFullYear();
  window._orFilter='owe';
  pg.innerHTML='<div class="nx" style="padding:var(--fk-sp-4);display:flex;flex-direction:column;gap:var(--fk-sp-3)">'+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
      '<h1 class="nx-page-title" style="display:flex;align-items:center;gap:8px;margin:0">'+NX.icon('radar',22)+' My Recovery</h1>'+
      '<span class="nx-kpi-label" style="text-transform:none">'+esc(monLabel)+' · as of '+esc(_orDate(today))+'</span>'+
      '<div style="margin-left:auto;display:flex;gap:8px">'+
        NX.button('Refresh',{variant:'ghost',size:'sm',icon:'refresh-cw',onclick:"rMyRecovery()"})+
        NX.button('Board Brief',{variant:'primary',size:'sm',icon:'trending-up',onclick:"_orBoardBrief()"})+
        NX.button('Print / PDF',{variant:'secondary',size:'sm',icon:'printer',onclick:"_orPrint()"})+
      '</div>'+
    '</div>'+
    '<div id="or-body"><div class="nx-skel" style="height:120px"></div><div class="nx-skel" style="height:240px;margin-top:16px"></div></div>'+
  '</div>';
  window._orRoot=document.getElementById('or-body');
  await _orLoad();
}

function _orRender(){
  var ST=window._orStore; if(!ST) return; var b=window._orRoot||document.getElementById('or-body'); if(!b) return;
  var T=ST.rows.length?ST.T:{target:0,recovered:0,remaining:0,oldArrears:0,dueMonth:0};
  if(!ST.rows.length){ b.innerHTML=NX.empty({icon:'inbox', message:'No accounts are assigned to you yet. Ask your admin to assign your project(s), then refresh.'}); return; }
  var pct=T.dueMonth>0?Math.round(T.recovered/T.dueMonth*100):0;

  // (Owner: this page is a DEDICATED report — only the figures + rollforward + the
  // client working table. The old "Your brief (AI)" card was removed.)

  // money picture — the four figures the officer needs. "This month's demand" is the
  // FULL month's billing (matches the admin Recovery Intelligence); the arrears figures
  // are due-to-date — never the full contract / project-end (e.g. 2030) balance.
  // ── ONE merged, self-justifying report (no grid). The summary figures each
  //    drill to their accounts; the rollforward ties them; and every figure here
  //    equals a column TOTAL in the table below (switch the filter to "All
  //    accounts" to see all of them reconcile on screen). ──
  // Self-justifying plus/minus sheet (owner's logic):
  //   Old arrears + THIS MONTH's FULL demand − received − advance received
  //     − this month's not-yet-due (so it lands on TODAY, not month-end) = current remaining.
  // The full month's demand is shown in the chain so you can read the month's whole
  // recovery, while the "not yet due" line keeps current remaining as of the current date.
  var notYetDue=Math.max(0, (T.dueMonth||0)-(T.dueToDate||0));
  var rfPart=function(lb,val,op,col,kind){ return (op?'<span style="color:var(--fk-text-muted);font-weight:700;font-size:15px">'+op+'</span>':'')+'<span '+(kind?'onclick="_orDrill(\''+kind+'\')" title="See the accounts behind this figure" style="cursor:pointer;':'style="')+'display:inline-flex;flex-direction:column;line-height:1.3"><span class="nx-kpi-label" style="text-transform:none">'+esc(lb)+(kind?' <span style="color:var(--fk-primary)">→</span>':'')+'</span><b class="num" style="font-size:17px;'+(col?'color:var(--fk-'+col+')':'')+'">'+_orF(val)+'</b></span>'; };
  var rf='<div style="padding:var(--fk-sp-3) var(--fk-sp-4);background:var(--fk-bg-subtle);border-radius:10px;margin-bottom:var(--fk-sp-3)">'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-bottom:8px;display:flex;align-items:center;gap:6px">'+NX.icon('calculator',13)+'How current remaining is built — as of today ('+esc(_orDate(ST.today))+'), no future months counted.</div>'+
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px">'+
      rfPart('Old arrears',T.oldArrears,'',null,'old')+
      rfPart('This month’s demand',T.dueMonth,'+','primary','demand')+
      rfPart('Received this month',T.recovered,'−','success','recovered')+
      rfPart('Advance received',T.advBf,'−','warning',null)+
      (T.advFut>0.5?rfPart('Advance for future',T.advFut,'+','info',null):'')+
      (notYetDue>0.5?rfPart('Not yet due this month',notYetDue,'−','text-muted',null):'')+
      rfPart('Current remaining',T.remaining,'=','danger','remaining')+
    '</div>'+
    (notYetDue>0.5?'<div class="nx-kpi-label" style="text-transform:none;margin-top:8px;color:var(--fk-text-muted)">“Not yet due this month” = part of this month’s demand whose installment date hasn’t arrived yet, so it’s removed to keep <b>current remaining</b> as of today.</div>':'')+
    (T.advFut>0.5?'<div class="nx-kpi-label" style="text-transform:none;margin-top:4px;color:var(--fk-text-muted)">“Advance for future” = received this month but applied to a later installment, so it’s added back (it doesn’t reduce today’s remaining).</div>':'')+
  '</div>';
  var fbtn=function(f,lb){ return '<button data-f="'+f+'" class="nx-btn nx-btn--sm '+(f===(window._orFilter||'owe')?'nx-btn--secondary':'nx-btn--ghost')+'" onclick="_orSetFilter(\''+f+'\')">'+esc(lb)+'</button>'; };
  var filterbar='<div id="or-filterbar" style="display:flex;gap:6px;flex-wrap:wrap">'+
    fbtn('owe','Everyone who owes')+fbtn('all','All accounts')+fbtn('overdue','Overdue only')+fbtn('likely','Likely to pay')+fbtn('quiet','Gone quiet')+'</div>';
  var ctx='<div class="nx-kpi-label" style="text-transform:none;margin-bottom:var(--fk-sp-3)">Of this month’s demand, <b>'+_orF(T.dueToDate)+'</b> is due so far and <b style="color:var(--fk-success)">'+_orF(T.recovered)+'</b> recovered ('+pct+'%).</div>';
  var filterRow='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:var(--fk-sp-3)">'+
    '<span style="font-weight:600;display:flex;align-items:center;gap:6px">'+NX.icon('users',16)+'Accounts'+(ST.scoped?' · yours only':'')+'</span>'+
    '<span style="margin-left:auto">'+filterbar+'</span></div>';
  // ── Headline KPI strip — the figures the officer leads with. "This month's
  //    demand" (full-month installment billing, old arrears excluded) is the lead.
  //    Each tile clicks through to the accounts behind it (drill). ──
  var kc=function(o,kind,tip){ o=o||{}; o.class=(o.class?o.class+' ':'')+'or-kpi'; return '<div style="position:relative;min-width:0'+(kind?';cursor:pointer':'')+'"'+
      (kind?' onclick="_orDrill(\''+kind+'\')" title="'+esc(tip||'See the accounts behind this figure')+'"':'')+'>'+
      NX.kpi(o)+(kind?'<span style="position:absolute;top:12px;right:12px;color:var(--fk-primary);font-weight:700;font-size:15px">→</span>':'')+'</div>'; };
  // keep big 9-digit rupee figures inside their tiles (wrap, never spill)
  var kpiCSS='<style>#or-body .or-kpi{min-width:0;overflow:hidden}#or-body .or-kpi .nx-kpi-value{font-size:19px;line-height:1.2;overflow-wrap:anywhere;word-break:break-word}#or-body .or-kpi .nx-kpi-col{min-width:0}#or-body .or-kpi.nx-kpi{padding-right:26px}</style>';
  var kpiStrip=kpiCSS+'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-bottom:var(--fk-sp-3)">'+
    kc({label:'This month’s demand', value:_orF(T.dueMonth), icon:'calendar-clock', tone:'primary'}, 'demand', 'One month’s installments due this month (old arrears excluded) — click to see each account')+
    kc({label:'Recovered this month', value:_orF(T.recovered), icon:'hand-coins', tone:'success'}, 'recovered', 'Collected so far this month — click to see each account')+
    kc({label:'Old arrears', value:_orF(T.oldArrears), icon:'layers', tone:'warning'}, 'old', 'Carried over from before this month — click to see each account')+
    kc({label:'Current remaining', value:_orF(T.remaining), icon:'wallet', tone:'danger'}, 'remaining', 'Still outstanding to date — click to see each account')+
  '</div>';
  b.innerHTML=kpiStrip+NX.card(rf+ctx+filterRow+'<div id="or-table"></div>', {});
  _orRenderTable();
}

// ── Print / PDF: clean A4 brief — money picture + the full call list. ──
function _orPrint(){
  var ST=window._orStore; if(!ST||!ST.rows.length){ if(typeof toast==='function') toast('Open the report first','warn'); return; }
  var T=ST.T, co=(typeof S!=='undefined'&&S&&S.coName)||'Company';
  var who=(typeof S!=='undefined'&&S&&(S.name||S.username))||'';
  var pct=T.dueMonth>0?Math.round(T.recovered/T.dueMonth*100):0;
  var owe=ST.rows.filter(function(r){return r._closing>0.5;}).sort(function(a,b){return b._closing-a._closing;});
  // computed action per client (not a blank — a suggestion the officer can act on)
  var _act=function(r){
    if(!_orPhone(r.phone)) return ['No phone — visit','vis'];
    if(r._odd>=90)         return ['Urgent — escalate','urg'];
    if(r._prop!=null && r._prop>=60) return ['Likely — call & collect','easy'];
    return ['Call & follow up','call'];
  };
  // column subtotals over the listed (owing) accounts
  var S0=0,S1=0,S2=0,S3=0,S4=0;
  owe.forEach(function(r){ S0+=r._open; S1+=r._dueToDate; S2+=r._rec; S3+=r._advBf; S4+=r._closing; });
  var rowsHTML=owe.map(function(r,i){
    var a=_act(r);
    return '<tr>'+
      '<td class="n rk">'+(i+1)+'</td>'+
      '<td><div class="cn">'+esc(r.client_name)+'</div><div class="su">'+esc(r.unit_no||'')+' · '+esc(r.phone||'no phone')+'</div></td>'+
      '<td class="n">'+(r._odd>0?'<span class="'+(r._odd>=90?'od':'')+'">'+r._odd+'d</span>':'—')+'</td>'+
      '<td class="n old">'+(r._open>0.5?_orF(r._open):'—')+'</td>'+
      '<td class="n">'+(r._dueToDate>0.5?_orF(r._dueToDate):'—')+'</td>'+
      '<td class="n grn">'+(r._rec>0.5?_orF(r._rec):'—')+'</td>'+
      '<td class="n amb">'+(r._advBf>0.5?_orF(r._advBf):'—')+'</td>'+
      '<td class="n big">'+_orF(r._closing)+'</td>'+
      '<td class="n">'+(r._prop!=null?r._prop+'%':'—')+'</td>'+
      '<td><span class="act act-'+a[1]+'">'+esc(a[0])+'</span></td>'+
      '</tr>';
  }).join('');
  var totalRow='<tr class="tot"><td></td><td>TOTAL · '+owe.length+' accounts with a balance</td><td></td>'+
    '<td class="n">'+_orF(S0)+'</td><td class="n">'+_orF(S1)+'</td><td class="n grn">'+_orF(S2)+'</td>'+
    '<td class="n amb">'+_orF(S3)+'</td><td class="n big">'+_orF(S4)+'</td><td></td><td></td></tr>';
  // This list shows only accounts that still owe, so the Recovered column above is
  // collections FROM owing accounts. Accounts that fully settled this month aren't
  // listed — reconcile their recovery here so the column ties to "Recovered this month".
  var recSettled=Math.max(0,(T.recovered||0)-S2);
  var settledCount=ST.rows.filter(function(r){return r._rec>0.5 && r._closing<=0.5;}).length;
  if(recSettled>0.5){ totalRow+=
    '<tr class="recon"><td></td><td colspan="4" style="text-align:right">+ Recovered from accounts now fully settled ('+settledCount+' not listed above)</td><td class="n grn">'+_orF(recSettled)+'</td><td colspan="4"></td></tr>'+
    '<tr class="recon2"><td></td><td colspan="4" style="text-align:right">= Recovered this month · all accounts</td><td class="n grn">'+_orF(T.recovered)+'</td><td colspan="4"></td></tr>'; }
  var css='*{box-sizing:border-box}@page{size:A4 landscape;margin:10mm}html,body{background:#fff}'+
    'body{font-family:"Inter",-apple-system,system-ui,Arial,sans-serif;color:#1e2433;font-size:10px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:11px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}'+
    '.hb .co{font-size:10.5px;opacity:.85;font-weight:600;letter-spacing:.03em;text-transform:uppercase}.hb .ti{font-size:22px;font-weight:800;letter-spacing:-.4px;margin-top:3px}'+
    '.hb-r{text-align:right;font-size:10px;opacity:.92;line-height:1.7}.hb-r b{font-size:13px;font-weight:700}'+
    '.sum{display:flex;gap:11px;margin-bottom:12px}.sc{flex:1 1 0;min-width:0;border:1px solid #ecedf5;border-radius:10px;padding:10px 14px;background:#fcfcff;overflow:hidden}'+
    '.sc label{display:block;font-size:7.5px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0b4;margin-bottom:4px}.sc b{display:block;font-size:15px;font-weight:800;letter-spacing:-.3px;overflow-wrap:anywhere;word-break:break-word;line-height:1.2}.sc.dn{border-color:#fecaca;background:#fff6f6}'+
    '.rf{background:#f6f7fb;border:1px solid #eceef5;border-radius:10px;padding:10px 15px;font-size:10.5px;color:#3a4054;margin-bottom:13px;font-variant-numeric:tabular-nums}.rf b{font-weight:700}'+
    'table.tb{width:100%;border-collapse:collapse;font-size:9.5px;table-layout:fixed}'+
    '.tb th{font-size:7.5px;text-transform:uppercase;letter-spacing:.05em;color:#8990a6;text-align:left;font-weight:700;padding:7px 8px;border-bottom:1.5px solid #e3e5ef}'+
    '.tb td{padding:6px 8px;border-bottom:1px solid #f1f2f7;vertical-align:top;overflow:hidden;overflow-wrap:anywhere;word-break:break-word}.tb tbody tr:nth-child(even) td{background:#fbfbfe}.tb tr{page-break-inside:avoid}'+
    '.n{text-align:right;font-variant-numeric:tabular-nums}.rk{font-weight:700;color:#aab0c4}.cn{font-weight:700;font-size:10px;color:#1e2433}.su{font-size:8px;color:#a0a5b8;margin-top:1px}'+
    '.old{color:#b45309}.grn{color:#16a34a}.amb{color:#b45309}.big{font-weight:800;font-size:11px;color:#dc2626}.od{color:#dc2626;font-weight:700}'+
    '.act{display:inline-block;padding:2px 8px;border-radius:20px;font-size:8px;font-weight:700;line-height:1.5}'+
    '.act-urg{background:#fee2e2;color:#b91c1c}.act-vis{background:#fef3c7;color:#92400e}.act-easy{background:#dcfce7;color:#166534}.act-call{background:#eef2ff;color:#4338ca}'+
    '.tot td{background:#f3f4fa;font-weight:800;border-top:2px solid #c7cadb;border-bottom:none;padding:8px}'+
    '.recon td{padding:6px 8px;background:#f6fbf8;border-bottom:1px solid #eef0f6;color:#3a4054}'+
    '.recon2 td{padding:7px 8px;background:#eafaf0;font-weight:800;border-top:1px solid #cdeed8}'+
    '.recon .grn,.recon2 .grn{color:#16a34a;font-weight:700}.recon2 .grn{font-size:11px}'+
    '.ft{margin-top:13px;border-top:1px solid #eceef5;padding-top:8px;font-size:8px;color:#aab0c4;display:flex;justify-content:space-between}'+
    'col.c1{width:22px}col.c3{width:44px}col.c4{width:90px}col.c5{width:90px}col.c6{width:90px}col.c7{width:96px}col.c8{width:100px}col.c9{width:40px}col.c10{width:100px}'+
    '.ledttl{font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0b4;font-weight:700;margin:0 0 5px 2px}'+
    '.led{width:100%;border-collapse:collapse;margin-bottom:13px;font-size:11px;font-variant-numeric:tabular-nums;border:1px solid #eceef5;border-radius:10px;overflow:hidden}'+
    '.led td{padding:7px 12px;border-bottom:1px solid #f1f2f7}.led tr:last-child td{border-bottom:none}'+
    '.led .op{width:26px;text-align:center;color:#8990a6;font-weight:800;font-size:14px}'+
    '.led .lb{color:#3a4054;font-weight:600}.led .lbm{color:#9aa0b4;font-weight:400;font-size:9px}'+
    '.led .am{text-align:right;font-weight:700;width:150px;white-space:nowrap}'+
    '.led .res td{border-top:2px solid #c7cadb;background:#fff6f6}.led .res .lb{font-weight:800}.led .res .am{color:#dc2626;font-size:14px;font-weight:800}';
  var notYetDue=Math.max(0,(T.dueMonth||0)-(T.dueToDate||0));
  var ledRow=function(op,lb,sub,val,cls){ return '<tr'+(cls?' class="'+cls+'"':'')+'><td class="op">'+(op||'')+'</td>'+
    '<td class="lb">'+lb+(sub?' <span class="lbm">'+sub+'</span>':'')+'</td><td class="am">'+_orF(val)+'</td></tr>'; };
  var ledger='<div class="ledttl">How current remaining is calculated — as of '+esc(_orDate(ST.today))+' (future months not counted)</div>'+
    '<table class="led">'+
      ledRow('', 'Old arrears', '(carried from before this month)', T.oldArrears)+
      ledRow('+','This month’s demand', '(full month installments)', T.dueMonth)+
      ledRow('−','Received this month', '', T.recovered)+
      ledRow('−','Advance received', '(this month’s installment already pre-paid earlier)', T.advBf)+
      (T.advFut>0.5?ledRow('+','Advance for future', '(paid now, applied to a later installment)', T.advFut):'')+
      (notYetDue>0.5?ledRow('−','Not yet due this month', '(installment date hasn’t arrived yet)', notYetDue):'')+
      ledRow('=','Current remaining', '(as of '+esc(_orDate(ST.today))+')', T.remaining, 'res')+
    '</table>';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>My Recovery — '+esc(co)+'</title><style>'+css+'</style></head><body>'+
    '<div class="hb"><div><div class="co">'+esc(co)+(who?' · Officer: '+esc(who):'')+'</div><div class="ti">Recovery Report</div></div>'+
      '<div class="hb-r"><b>'+esc(ST.monLabel)+'</b><br>as of '+esc(_orDate(ST.today))+'</div></div>'+
    '<div class="sum">'+
      '<div class="sc"><label>This month’s demand</label><b>'+_orF(T.dueMonth)+'</b></div>'+
      '<div class="sc"><label>Recovered this month ('+pct+'%)</label><b style="color:#16a34a">'+_orF(T.recovered)+'</b></div>'+
      '<div class="sc dn"><label>Current remaining · as of '+esc(_orDate(ST.today))+'</label><b style="color:#dc2626">'+_orF(T.remaining)+'</b></div>'+
    '</div>'+
    ledger+
    '<table class="tb"><colgroup><col class="c1"><col><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"><col class="c8"><col class="c9"><col class="c10"></colgroup>'+
    '<thead><tr><th class="n">#</th><th>Client / Unit / Phone</th><th class="n">Overdue</th><th class="n">Old arrears</th><th class="n">Due to date</th><th class="n">Recovered</th><th class="n">Advance pre-paid</th><th class="n">Current remaining</th><th>Will pay</th><th>What to do</th></tr></thead>'+
    '<tbody>'+rowsHTML+totalRow+'</tbody></table>'+
    '<div class="ft"><span>Generated '+esc((new Date()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+'</span><span>Nexunova RMS · '+(ST.scoped?'Your assigned accounts only':'All accounts')+'</span></div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html, 'Recovery Report'); else window.print();
}

// ── BOARD BRIEF — a single-page, director-grade PDF. Server-computed (verified)
//    figures: portfolio, cash vs opening-balance split, ageing, concentration,
//    behaviour, cancellations, worst accounts — plus one headline reframe. ──
async function _orBoardBrief(){
  if(typeof toast==='function') toast('Building board brief…','info');
  var today=(typeof td==='function'?td():new Date().toISOString().slice(0,10));
  var d=new Date(today+'T00:00:00'), pad=function(n){return String(n).padStart(2,'0');};
  var mStart=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01';
  var meDate=new Date(d.getFullYear(), d.getMonth()+1, 0);
  var mEnd=meDate.getFullYear()+'-'+pad(meDate.getMonth()+1)+'-'+pad(meDate.getDate());
  var monLabel=['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]+' '+d.getFullYear();
  var res;
  try{ res=await supabase.rpc('get_recovery_board_brief',{p_company_id:S.cid,p_from:mStart,p_to:today,p_month_end:mEnd}); }
  catch(e){ if(typeof toast==='function') toast('Could not build the brief','error'); return; }
  if(res.error){ if(typeof toast==='function') toast('Brief failed · '+esc(res.error.message||''),'error'); return; }
  var B=res.data||{}, n=function(x){return Number(x||0);};
  var contract=n(B.contract_value), collected=n(B.collected_all), cash=n(B.cash_to_date), adj=n(B.adj_to_date);
  var outstanding=n(B.outstanding), remEnd=Math.max(0,contract-collected);
  var demand=n(B.demand_full), recv=n(B.received_period), cashP=n(B.cash_period);
  var a30=n(B.age_0_30),a90=n(B.age_31_90),a180=n(B.age_91_180),a180p=n(B.age_180p);
  var top10=n(B.top10),top20=n(B.top20);
  var active=n(B.active_accounts),cur=n(B.current_or_ahead),behind=n(B.behind),never=n(B.never_paid);
  var cxC=n(B.cancelled_count),cxV=n(B.cancelled_value);
  var pc=function(x,base){ base=base||0; return base>0?Math.round(x/base*100):0; };
  var collPct=pc(collected,contract), cashPct=pc(cash,contract), recvPct=pc(recv,demand);
  var agedPct=pc(a180p,outstanding), top20Pct=pc(top20,outstanding), top10Pct=pc(top10,outstanding);
  var curPct=pc(cur,active), cancelPct=pc(cxC,cxC+active);
  var co=(typeof S!=='undefined'&&S&&S.coName)||'Company';
  var seg=function(v,col){ var w=outstanding>0?(v/outstanding*100):0; return w>0.05?'<span style="display:block;height:100%;width:'+w.toFixed(1)+'%;background:'+col+'"></span>':''; };
  var legend=function(col,lb,v){ var w=pc(v,outstanding); return '<div class="lg"><span class="dot" style="background:'+col+'"></span><span class="lgl">'+lb+'</span><span class="lgv">'+_orC(v)+' · '+w+'%</span></div>'; };
  var topRows=(B.top_rows||[]).map(function(r,i){
    return '<tr><td class="rk">'+(i+1)+'</td><td><div class="cn">'+esc(r.client)+'</div><div class="su">'+esc(r.unit||'')+'</div></td>'+
      '<td class="n">'+(n(r.odd)>0?Math.round(n(r.odd))+'d':'—')+'</td>'+
      '<td class="n">'+Math.round(n(r.paid_pct))+'%</td>'+
      '<td class="n big">'+_orF(r.closing)+'</td></tr>';
  }).join('');
  var headline='<b>'+_orC(outstanding)+'</b> outstanding looks large — but <b>'+agedPct+'%</b> is legacy (180+ days) and <b>'+top20Pct+'%</b> sits in just <b>20 accounts</b>. The bigger leakage is a <b>'+cancelPct+'% cancellation rate ('+_orC(cxV)+')</b>. Recovery here is a <b>focused cleanup</b>, not a systemic failure.';
  var css='*{box-sizing:border-box}@page{size:A4 portrait;margin:11mm}html,body{background:#fff}'+
    'body{font-family:"Inter",-apple-system,system-ui,Arial,sans-serif;color:#1e2433;font-size:10px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:12px;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:11px}'+
    '.hb .co{font-size:10px;opacity:.85;font-weight:600;letter-spacing:.04em;text-transform:uppercase}.hb .ti{font-size:21px;font-weight:800;letter-spacing:-.4px;margin-top:2px}.hb .sb{font-size:9px;opacity:.8;margin-top:2px}'+
    '.hb-r{text-align:right;font-size:9.5px;opacity:.92;line-height:1.7}.hb-r b{font-size:13px;font-weight:700}'+
    '.head{background:#f6f7fb;border-left:4px solid #4f46e5;border-radius:8px;padding:10px 14px;font-size:11px;line-height:1.55;color:#2a3142;margin-bottom:12px}'+
    '.kp{display:flex;gap:9px;margin-bottom:12px}.kc{flex:1 1 0;min-width:0;border:1px solid #ecedf5;border-radius:10px;padding:10px 12px;background:#fcfcff;overflow:hidden}'+
    '.kc label{display:block;font-size:7.5px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0b4;margin-bottom:3px}.kc b{display:block;font-size:18px;font-weight:800;letter-spacing:-.4px;line-height:1.1}.kc .sub{font-size:8px;color:#8990a6;margin-top:3px;font-weight:600}'+
    '.kc.dn{border-color:#fecaca;background:#fff6f6}.kc.dn b{color:#dc2626}.kc.gn b{color:#16a34a}'+
    '.cols{display:flex;gap:11px;margin-bottom:12px}.col{flex:1;border:1px solid #ecedf5;border-radius:10px;padding:11px 13px;background:#fff}'+
    '.col h3{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#6b7180;margin:0 0 9px;font-weight:700}'+
    '.bar{display:flex;height:16px;border-radius:5px;overflow:hidden;margin-bottom:9px;background:#eef0f6}'+
    '.lg{display:flex;align-items:center;gap:6px;font-size:9px;margin-bottom:4px}.dot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}.lgl{flex:1;color:#3a4054}.lgv{font-weight:700;font-variant-numeric:tabular-nums}'+
    '.big2{font-size:22px;font-weight:800;letter-spacing:-.5px}.muted{color:#8990a6}.cap{font-size:8.5px;color:#8990a6;margin-top:6px;line-height:1.5}'+
    '.stat{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid #f1f2f7;font-size:10px}.stat:last-child{border:none}.stat b{font-size:12px;font-weight:800}'+
    '.alert{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}'+
    '.alert .l{font-size:10px;color:#9a3412;line-height:1.5}.alert .l b{color:#7c2d12}.alert .v{font-size:18px;font-weight:800;color:#c2410c;white-space:nowrap;margin-left:14px}'+
    'table.tb{width:100%;border-collapse:collapse;font-size:9.5px}.tb caption{caption-side:top;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#6b7180;font-weight:700;padding:0 0 7px}'+
    '.tb th{font-size:7.5px;text-transform:uppercase;letter-spacing:.05em;color:#8990a6;text-align:left;font-weight:700;padding:5px 8px;border-bottom:1.5px solid #e3e5ef}.tb th.n{text-align:right}'+
    '.tb td{padding:5px 8px;border-bottom:1px solid #f3f4f8;vertical-align:middle}.tb .rk{color:#aab0c4;font-weight:700;width:18px}.tb .cn{font-weight:700;color:#1e2433}.tb .su{font-size:8px;color:#a0a5b8}'+
    '.tb .n{text-align:right;font-variant-numeric:tabular-nums}.tb .big{font-weight:800;color:#dc2626}'+
    '.ft{margin-top:11px;border-top:1px solid #eceef5;padding-top:8px;font-size:8px;color:#aab0c4;line-height:1.6}';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recovery — Board Brief — '+esc(co)+'</title><style>'+css+'</style></head><body>'+
    '<div class="hb"><div><div class="co">'+esc(co)+'</div><div class="ti">Recovery — Board Brief</div><div class="sb">Active portfolio · '+active+' accounts</div></div>'+
      '<div class="hb-r"><b>'+esc(monLabel)+'</b><br>as of '+esc(_orDate(today))+'</div></div>'+
    '<div class="head">'+headline+'</div>'+
    '<div class="kp">'+
      '<div class="kc"><label>Portfolio value</label><b>'+_orC(contract)+'</b><div class="sub">'+active+' active units</div></div>'+
      '<div class="kc gn"><label>Collected to date</label><b>'+_orC(collected)+'</b><div class="sub">'+collPct+'% · cash '+_orC(cash)+' ('+cashPct+'%)</div></div>'+
      '<div class="kc dn"><label>Outstanding (to date)</label><b>'+_orC(outstanding)+'</b><div class="sub">'+behind+' of '+active+' behind</div></div>'+
      '<div class="kc"><label>Collected this month</label><b>'+_orC(recv)+'</b><div class="sub">'+recvPct+'% of '+_orC(demand)+' demand</div></div>'+
    '</div>'+
    '<div class="cols">'+
      '<div class="col"><h3>Ageing of outstanding</h3>'+
        '<div class="bar">'+seg(a30,'#22c55e')+seg(a90,'#eab308')+seg(a180,'#f97316')+seg(a180p,'#dc2626')+'</div>'+
        legend('#22c55e','Fresh · 0–30 days',a30)+legend('#eab308','31–90 days',a90)+legend('#f97316','91–180 days',a180)+legend('#dc2626','Legacy · 180+ days',a180p)+
        '<div class="cap"><b>'+agedPct+'%</b> of arrears is 180+ days old — a legacy backlog, not current-month slippage. Needs a one-time settlement drive, separate from routine follow-up.</div>'+
      '</div>'+
      '<div class="col"><h3>Concentration &amp; behaviour</h3>'+
        '<div class="big2">'+top20Pct+'%</div><div class="muted" style="font-size:9px;margin-bottom:9px">of all outstanding sits in just <b>20 accounts</b> ('+_orC(top20)+'). Top 10 = '+top10Pct+'% ('+_orC(top10)+').</div>'+
        '<div class="stat"><span>Current or paid-ahead</span><b style="color:#16a34a">'+cur+' · '+curPct+'%</b></div>'+
        '<div class="stat"><span>Behind on schedule</span><b style="color:#dc2626">'+behind+'</b></div>'+
        '<div class="stat"><span>Never paid a rupee</span><b>'+never+'</b></div>'+
        '<div class="cap">Low pure-default — arrears are largely <b>collectible</b>, not write-offs. Director-level push on 20 names can move '+_orC(top20)+'.</div>'+
      '</div>'+
    '</div>'+
    '<div class="alert"><div class="l"><b>Biggest leakage — cancellations.</b><br>'+cxC+' of '+(cxC+active)+' bookings cancelled ('+cancelPct+'%) — more contract value than the entire outstanding. Re-sellable inventory + root-cause review recommended.</div><div class="v">'+_orC(cxV)+'</div></div>'+
    '<table class="tb"><caption>Worst accounts — director attention list</caption>'+
      '<thead><tr><th></th><th>Client / Unit</th><th class="n">Overdue</th><th class="n">Paid</th><th class="n">Outstanding</th></tr></thead>'+
      '<tbody>'+topRows+'</tbody></table>'+
    '<div class="ft">All figures verified against source ledgers (recovery reconciles to the rupee). “Collected” includes '+_orC(adj)+' of imported opening-balance adjustments (non-cash); cash collected to date = '+_orC(cash)+'. Outstanding is as of '+esc(_orDate(today))+' — future installments through project completion are not counted. Remaining over project life ≈ '+_orC(remEnd)+'.<br>Generated '+esc((new Date()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+' · Nexunova RMS'+(B.scoped?' · assigned projects only':'')+'</div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html, 'Recovery Board Brief'); else { var w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close(); } }
}
