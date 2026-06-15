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
  var ST=window._orStore; if(!ST) return; var host=document.getElementById('or-table'); if(!host) return;
  var f=window._orFilter||'owe';
  var rows=ST.rows.slice();
  if(f==='owe')     rows=rows.filter(function(r){return r._closing>0.5;});
  else if(f==='overdue') rows=rows.filter(function(r){return r._odd>0 && r._closing>0.5;});
  else if(f==='likely')  rows=rows.filter(function(r){return r._prop>=60 && r._closing>0.5;});
  else if(f==='quiet')   rows=rows.filter(function(r){return (r._odd>=90||r._paid<=0.5) && r._closing>0.5;});
  rows.sort(function(a,b){return b._closing-a._closing;});
  if(!rows.length){ host.innerHTML=NX.empty({icon:'check-circle', message:'Nothing here — you are all caught up.'}); return; }
  var thCss='padding:9px 10px;position:sticky;top:0;background:var(--fk-surface);z-index:1;border-bottom:1px solid var(--fk-border);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--fk-text-muted)';
  var cols=['#','Client / Unit','>Old arrears','>Due to date','>Recovered','>Advance pre-paid','>Current remaining','Will pay','Last contact','Actions'];
  var th='<tr>'+cols.map(function(h){var r=h[0]==='>';return '<th style="'+thCss+(r?';text-align:right':';text-align:left')+'">'+esc(r?h.slice(1):h)+'</th>';}).join('')+'</tr>';
  var body=rows.map(function(r,i){ var cs='padding:9px 10px;border-bottom:1px solid var(--fk-border)';
    var ph=_orPhone(r.phone);
    var prop = r._prop!=null ? NX.badge((r._prop>=60?'Likely':r._prop>=35?'Maybe':'Hard')+' · '+r._prop+'%', r._prop>=60?'success':r._prop>=35?'warning':'danger') : '<span class="nx-kpi-label">—</span>';
    var tel = r.phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call '+esc(r.phone)+'" href="tel:'+esc(r.phone)+'" onclick="event.stopPropagation()">'+NX.icon('phone',15)+'</a>' : '';
    var wa  = ph ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/'+ph+'" onclick="event.stopPropagation()">'+NX.icon('message-circle',15)+'</a>' : '';
    var prom = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-primary)" title="Add a promise to pay" onclick="event.stopPropagation();if(typeof openConModal===\'function\')openConModal(\''+(r.unit_id||'')+'\',\'promise\')">'+NX.icon('handshake',15)+'</button>';
    var log = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Log the call &amp; update status" onclick="event.stopPropagation();if(typeof openConModal===\'function\')openConModal(\''+(r.unit_id||'')+'\')">'+NX.icon('check',15)+'</button>';
    var escb = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-danger)" title="Raise an alert / escalate" onclick="event.stopPropagation();if(typeof escOpenNew===\'function\')escOpenNew({clientId:\''+(r.client_id||'')+'\'})">'+NX.icon('alert-triangle',15)+'</button>';
    var lc = r._lastContact ? esc(_orDate(r._lastContact)) : (r.last_payment_date?'<span class="nx-kpi-label" style="text-transform:none">paid '+esc(_orDate(r.last_payment_date))+'</span>':'<span class="nx-kpi-label">no contact</span>');
    return '<tr style="cursor:pointer" onclick="_orOpenUnit(\''+(r.sale_id||'')+'\')" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="'+cs+'" class="num">'+(i+1)+'</td>'+
      '<td style="'+cs+'"><div style="font-weight:500;white-space:nowrap">'+esc(r.client_name)+'</div><div class="nx-kpi-label" style="text-transform:none">'+esc(r.unit_no||'')+(r._odd>0?' · <span style="color:var(--fk-danger)">'+r._odd+'d overdue</span>':'')+'</div></td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._open>0.5?_orF(r._open):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._dueToDate>0.5?_orF(r._dueToDate):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._rec>0.5?'<span style="color:var(--fk-success)">'+_orF(r._rec)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._advBf>0.5?'<span style="color:var(--fk-warning)">'+_orF(r._advBf)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right;font-weight:600" class="num">'+_orF(r._closing)+'</td>'+
      '<td style="'+cs+'">'+prop+'</td>'+
      '<td style="'+cs+'">'+lc+'</td>'+
      '<td style="'+cs+'" onclick="event.stopPropagation()"><div style="display:flex;gap:3px">'+tel+wa+prom+log+escb+'</div></td></tr>';
  }).join('');
  var Z0=0,Z1=0,Z2=0,Z3=0,Z4=0; rows.forEach(function(r){ Z0+=r._open;Z1+=r._dueToDate;Z2+=r._rec;Z3+=r._advBf;Z4+=r._closing; });
  var tcs='padding:9px 10px;border-top:2px solid var(--fk-border);background:var(--fk-bg-subtle);font-weight:700;position:sticky;bottom:0';
  var totRow='<tr>'+
    '<td style="'+tcs+'"></td><td style="'+tcs+'">TOTAL · '+rows.length+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_orF(Z0)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_orF(Z1)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-success)" class="num">'+_orF(Z2)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-warning)" class="num">'+_orF(Z3)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-danger)" class="num">'+_orF(Z4)+'</td>'+
    '<td style="'+tcs+'"></td><td style="'+tcs+'"></td><td style="'+tcs+'"></td></tr>';
  host.innerHTML='<div style="max-height:62vh;overflow:auto;border:1px solid var(--fk-border);border-radius:var(--fk-radius)"><table style="width:100%;min-width:1180px;border-collapse:collapse;font-size:12.5px"><thead>'+th+'</thead><tbody>'+body+totRow+'</tbody></table></div>'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+rows.length+' account'+(rows.length!==1?'s':'')+' shown · sorted by amount still owed · work each row right here →'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('phone',13)+'Call</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('message-circle',13)+'WhatsApp</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px;color:var(--fk-primary)">'+NX.icon('handshake',13)+'Promise</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('check',13)+'Log &amp; status</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px;color:var(--fk-danger)">'+NX.icon('alert-triangle',13)+'Escalate</span>'+
    '</div>';
}

async function rMyRecovery(){
  var pg=document.getElementById('pg-myrecovery'); if(!pg) return;
  var today=(typeof td==='function'?td():new Date().toISOString().slice(0,10));
  var d=new Date(today+'T00:00:00'), pad=function(n){return String(n).padStart(2,'0');};
  var mStart=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01';
  var meDate=new Date(d.getFullYear(), d.getMonth()+1, 0);
  var mEnd=meDate.getFullYear()+'-'+pad(meDate.getMonth()+1)+'-'+pad(meDate.getDate());
  var monLabel=['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]+' '+d.getFullYear();
  window._orFilter='owe';
  pg.innerHTML='<div class="nx" style="padding:var(--fk-sp-4);display:flex;flex-direction:column;gap:var(--fk-sp-3)">'+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
      '<h1 class="nx-page-title" style="display:flex;align-items:center;gap:8px;margin:0">'+NX.icon('radar',22)+' My Recovery</h1>'+
      '<span class="nx-kpi-label" style="text-transform:none">'+esc(monLabel)+' · as of '+esc(_orDate(today))+'</span>'+
      '<div style="margin-left:auto;display:flex;gap:8px">'+
        NX.button('Refresh',{variant:'ghost',size:'sm',icon:'refresh-cw',onclick:"rMyRecovery()"})+
        NX.button('Print / PDF',{variant:'secondary',size:'sm',icon:'printer',onclick:"_orPrint()"})+
      '</div>'+
    '</div>'+
    '<div id="or-body"><div class="nx-skel" style="height:120px"></div><div class="nx-skel" style="height:240px;margin-top:16px"></div></div>'+
  '</div>';
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
    var b=document.getElementById('or-body'); if(b) b.innerHTML=NX.empty({icon:'alert-triangle', message:'Could not load your recovery report. '+esc(e.message||'')});
  }
}

function _orRender(){
  var ST=window._orStore; if(!ST) return; var b=document.getElementById('or-body'); if(!b) return;
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
  var rfPart=function(lb,val,op,col,kind){ return (op?'<span style="color:var(--fk-text-muted);font-weight:700;font-size:15px">'+op+'</span>':'')+'<span '+(kind?'onclick="_orDrill(\''+kind+'\')" title="See the accounts behind this figure" style="cursor:pointer;':'style="')+'display:inline-flex;flex-direction:column;line-height:1.3"><span class="nx-kpi-label" style="text-transform:none">'+esc(lb)+(kind?' <span style="color:var(--fk-primary)">→</span>':'')+'</span><b class="num" style="font-size:17px;'+(col?'color:var(--fk-'+col+')':'')+'">'+_orF(val)+'</b></span>'; };
  var rf='<div style="padding:var(--fk-sp-3) var(--fk-sp-4);background:var(--fk-bg-subtle);border-radius:10px;margin-bottom:var(--fk-sp-3)">'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-bottom:8px;display:flex;align-items:center;gap:6px">'+NX.icon('calculator',13)+'Current remaining (to date — no future installments). Each figure = a column total in the table below.</div>'+
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px">'+
      rfPart('Old arrears',T.oldArrears,'',null,'old')+
      rfPart('Due to date',T.dueToDate,'+',null,null)+
      rfPart('Received',T.recovered,'−','success','recovered')+
      rfPart('Advance pre-paid',T.advBf,'−','warning',null)+
      (T.advFut>0.5?rfPart('Advance for future',T.advFut,'+','info',null):'')+
      rfPart('Current remaining',T.remaining,'=','danger','remaining')+
    '</div>'+
    (T.advFut>0.5?'<div class="nx-kpi-label" style="text-transform:none;margin-top:8px;color:var(--fk-text-muted)">“Advance for future” = received this month but applied to a later installment, so it’s added back (it doesn’t reduce today’s remaining).</div>':'')+
  '</div>';
  var fbtn=function(f,lb){ return '<button data-f="'+f+'" class="nx-btn nx-btn--sm '+(f===(window._orFilter||'owe')?'nx-btn--secondary':'nx-btn--ghost')+'" onclick="_orSetFilter(\''+f+'\')">'+esc(lb)+'</button>'; };
  var filterbar='<div id="or-filterbar" style="display:flex;gap:6px;flex-wrap:wrap">'+
    fbtn('owe','Everyone who owes')+fbtn('all','All accounts')+fbtn('overdue','Overdue only')+fbtn('likely','Likely to pay')+fbtn('quiet','Gone quiet')+'</div>';
  var ctx='<div class="nx-kpi-label" style="text-transform:none;margin-bottom:var(--fk-sp-3)">This month billed <b>'+_orF(T.dueMonth)+'</b> (of which <b>'+_orF(T.dueToDate)+'</b> due so far) · recovered <b style="color:var(--fk-success)">'+_orF(T.recovered)+'</b> ('+pct+'%).</div>';
  var filterRow='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:var(--fk-sp-3)">'+
    '<span style="font-weight:600;display:flex;align-items:center;gap:6px">'+NX.icon('users',16)+'Accounts'+(ST.scoped?' · yours only':'')+'</span>'+
    '<span style="margin-left:auto">'+filterbar+'</span></div>';
  b.innerHTML=NX.card(rf+ctx+filterRow+'<div id="or-table"></div>', {});
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
  var css='*{box-sizing:border-box}@page{size:A4 landscape;margin:10mm}html,body{background:#fff}'+
    'body{font-family:"Inter",-apple-system,system-ui,Arial,sans-serif;color:#1e2433;font-size:10px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:11px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}'+
    '.hb .co{font-size:10.5px;opacity:.85;font-weight:600;letter-spacing:.03em;text-transform:uppercase}.hb .ti{font-size:22px;font-weight:800;letter-spacing:-.4px;margin-top:3px}'+
    '.hb-r{text-align:right;font-size:10px;opacity:.92;line-height:1.7}.hb-r b{font-size:13px;font-weight:700}'+
    '.sum{display:flex;gap:11px;margin-bottom:12px}.sc{flex:1;border:1px solid #ecedf5;border-radius:10px;padding:10px 14px;background:#fcfcff}'+
    '.sc label{display:block;font-size:7.5px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0b4;margin-bottom:4px}.sc b{font-size:17px;font-weight:800;letter-spacing:-.3px}.sc.dn{border-color:#fecaca;background:#fff6f6}'+
    '.rf{background:#f6f7fb;border:1px solid #eceef5;border-radius:10px;padding:10px 15px;font-size:10.5px;color:#3a4054;margin-bottom:13px;font-variant-numeric:tabular-nums}.rf b{font-weight:700}'+
    'table.tb{width:100%;border-collapse:collapse;font-size:9.5px;table-layout:fixed}'+
    '.tb th{font-size:7.5px;text-transform:uppercase;letter-spacing:.05em;color:#8990a6;text-align:left;font-weight:700;padding:7px 8px;border-bottom:1.5px solid #e3e5ef}'+
    '.tb td{padding:6px 8px;border-bottom:1px solid #f1f2f7;vertical-align:top;overflow:hidden}.tb tbody tr:nth-child(even) td{background:#fbfbfe}.tb tr{page-break-inside:avoid}'+
    '.n{text-align:right;font-variant-numeric:tabular-nums}.rk{font-weight:700;color:#aab0c4}.cn{font-weight:700;font-size:10px;color:#1e2433}.su{font-size:8px;color:#a0a5b8;margin-top:1px}'+
    '.old{color:#b45309}.grn{color:#16a34a}.amb{color:#b45309}.big{font-weight:800;font-size:11px;color:#dc2626}.od{color:#dc2626;font-weight:700}'+
    '.act{display:inline-block;padding:2px 8px;border-radius:20px;font-size:8px;font-weight:700;line-height:1.5}'+
    '.act-urg{background:#fee2e2;color:#b91c1c}.act-vis{background:#fef3c7;color:#92400e}.act-easy{background:#dcfce7;color:#166534}.act-call{background:#eef2ff;color:#4338ca}'+
    '.tot td{background:#f3f4fa;font-weight:800;border-top:2px solid #c7cadb;border-bottom:none;padding:8px}'+
    '.ft{margin-top:13px;border-top:1px solid #eceef5;padding-top:8px;font-size:8px;color:#aab0c4;display:flex;justify-content:space-between}'+
    'col.c1{width:22px}col.c3{width:46px}col.c4{width:84px}col.c5{width:84px}col.c6{width:84px}col.c7{width:90px}col.c8{width:92px}col.c9{width:42px}col.c10{width:106px}';
  var rfEq='Old arrears '+_orF(T.oldArrears)+' + Due to date '+_orF(T.dueToDate)+' − Received '+_orF(T.recovered)+' − Advance pre-paid '+_orF(T.advBf)+(T.advFut>0.5?' + Advance for future '+_orF(T.advFut):'')+' = <b style="color:#dc2626">'+_orF(T.remaining)+'</b>';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>My Recovery — '+esc(co)+'</title><style>'+css+'</style></head><body>'+
    '<div class="hb"><div><div class="co">'+esc(co)+(who?' · Officer: '+esc(who):'')+'</div><div class="ti">Recovery Report</div></div>'+
      '<div class="hb-r"><b>'+esc(ST.monLabel)+'</b><br>as of '+esc(_orDate(ST.today))+'</div></div>'+
    '<div class="sum">'+
      '<div class="sc"><label>This month’s demand</label><b>'+_orF(T.dueMonth)+'</b></div>'+
      '<div class="sc"><label>Recovered this month ('+pct+'%)</label><b style="color:#16a34a">'+_orF(T.recovered)+'</b></div>'+
      '<div class="sc"><label>Old arrears</label><b style="color:#b45309">'+_orF(T.oldArrears)+'</b></div>'+
      '<div class="sc dn"><label>Current remaining · to date</label><b style="color:#dc2626">'+_orF(T.remaining)+'</b></div>'+
    '</div>'+
    '<div class="rf"><b>Current remaining</b> = '+rfEq+'  ·  sorted by biggest balance first · future installments (e.g. through 2030) are not counted.</div>'+
    '<table class="tb"><colgroup><col class="c1"><col><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"><col class="c8"><col class="c9"><col class="c10"></colgroup>'+
    '<thead><tr><th class="n">#</th><th>Client / Unit / Phone</th><th class="n">Overdue</th><th class="n">Old arrears</th><th class="n">Due to date</th><th class="n">Recovered</th><th class="n">Advance pre-paid</th><th class="n">Current remaining</th><th>Will pay</th><th>What to do</th></tr></thead>'+
    '<tbody>'+rowsHTML+totalRow+'</tbody></table>'+
    '<div class="ft"><span>Generated '+esc((new Date()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+'</span><span>Nexunova RMS · '+(ST.scoped?'Your assigned accounts only':'All accounts')+'</span></div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html, 'Recovery Report'); else window.print();
}
