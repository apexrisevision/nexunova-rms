// ════════════════════════════════════════════════════════════════════════════
// MY RECOVERY — the recovery officer's working report.
// Officer-scoped (get_officer_recovery → wraps the verified get_recovery_position
// and filters rows to the caller's assigned projects). Answers, for THIS month:
//   • what must be collected (old baqaya + this-month due)
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
    x:'This month’s demand <b>'+_orF(T.dueMonth)+'</b> · recovered <b>'+_orF(T.recovered)+'</b> ('+pct+'% of billing). Old baqaya <b>'+_orF(T.oldArrears)+'</b>. Current baqaya still due: <b>'+_orF(T.remaining)+'</b> (due to date — not till project end).'});
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
    ins.push({ic:'layers', t:'muted', h:'Old baqaya', act:"_orDrill('old')", proof:'See old-baqaya accounts',
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
    remaining:{title:'Current baqaya — still due (due to date)', val:function(r){return r._closing;}, lbl:'Current baqaya'},
    old:      {title:'Old baqaya (before this month)', val:function(r){return r._open;}, lbl:'Old baqaya'},
    likely:   {title:'Quick wins — likely to pay (≥60%)', val:function(r){return r._closing;}, lbl:'Current baqaya', filt:function(r){return r._prop>=60 && r._closing>0.5;}},
    quiet:    {title:'Gone quiet — 90+ days or never paid', val:function(r){return r._closing;}, lbl:'Current baqaya', filt:function(r){return ((r._odd>=90)||(r._paid<=0.5)) && r._closing>0.5;}}
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
  var cols=['#','Client / Unit','>Old baqaya','>Due this month','>Recovered','>Current baqaya','Will pay','Last contact','Actions'];
  var th='<tr>'+cols.map(function(h){var r=h[0]==='>';return '<th style="'+thCss+(r?';text-align:right':';text-align:left')+'">'+esc(r?h.slice(1):h)+'</th>';}).join('')+'</tr>';
  var body=rows.map(function(r,i){ var cs='padding:9px 10px;border-bottom:1px solid var(--fk-border)';
    var ph=_orPhone(r.phone);
    var prop = r._prop!=null ? NX.badge((r._prop>=60?'Likely':r._prop>=35?'Maybe':'Hard')+' · '+r._prop+'%', r._prop>=60?'success':r._prop>=35?'warning':'danger') : '<span class="nx-kpi-label">—</span>';
    var tel = r.phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call '+esc(r.phone)+'" href="tel:'+esc(r.phone)+'" onclick="event.stopPropagation()">'+NX.icon('phone',15)+'</a>' : '';
    var wa  = ph ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/'+ph+'" onclick="event.stopPropagation()">'+NX.icon('message-circle',15)+'</a>' : '';
    var log = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Log a call / promise" onclick="event.stopPropagation();if(typeof openConModal===\'function\')openConModal(\''+(r.unit_id||'')+'\')">'+NX.icon('check',15)+'</button>';
    var lc = r._lastContact ? esc(_orDate(r._lastContact)) : (r.last_payment_date?'<span class="nx-kpi-label" style="text-transform:none">paid '+esc(_orDate(r.last_payment_date))+'</span>':'<span class="nx-kpi-label">no contact</span>');
    return '<tr style="cursor:pointer" onclick="_orOpenUnit(\''+(r.sale_id||'')+'\')" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="'+cs+'" class="num">'+(i+1)+'</td>'+
      '<td style="'+cs+'"><div style="font-weight:500;white-space:nowrap">'+esc(r.client_name)+'</div><div class="nx-kpi-label" style="text-transform:none">'+esc(r.unit_no||'')+(r._odd>0?' · <span style="color:var(--fk-danger)">'+r._odd+'d overdue</span>':'')+'</div></td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._open>0.5?_orF(r._open):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._due>0.5?_orF(r._due):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r._rec>0.5?'<span style="color:var(--fk-success)">'+_orF(r._rec)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right;font-weight:600" class="num">'+_orF(r._closing)+'</td>'+
      '<td style="'+cs+'">'+prop+'</td>'+
      '<td style="'+cs+'">'+lc+'</td>'+
      '<td style="'+cs+'" onclick="event.stopPropagation()"><div style="display:flex;gap:4px">'+tel+wa+log+'</div></td></tr>';
  }).join('');
  host.innerHTML='<div style="max-height:60vh;overflow:auto;border:1px solid var(--fk-border);border-radius:var(--fk-radius)"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'+th+'</thead><tbody>'+body+'</tbody></table></div>'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-top:8px">'+rows.length+' account'+(rows.length!==1?'s':'')+' shown · sorted by amount still owed · click a row to open the full unit, or use the icons to Call / WhatsApp / Log.</div>';
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
  pg.innerHTML='<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-5)">'+
    '<div class="no-p" style="display:flex;gap:8px;align-items:center">'+
      NX.button('← Dashboard',{variant:'ghost',size:'sm',onclick:"nav('dashboard')"})+
      NX.button('Refresh',{variant:'ghost',size:'sm',onclick:"rMyRecovery()"})+
      '<div style="margin-left:auto;display:flex;gap:8px;align-items:center">'+
        '<span class="nx-kpi-label">'+esc(monLabel)+' · as of '+esc(_orDate(today))+'</span>'+
        NX.button('Print / PDF',{variant:'secondary',size:'sm',icon:'printer',onclick:"_orPrint()"})+
      '</div>'+
    '</div>'+
    '<div><h1 class="nx-page-title" style="display:flex;align-items:center;gap:10px">'+NX.icon('radar',24)+' My Recovery</h1>'+
      '<div class="nx-kpi-label" style="text-transform:none;margin-top:4px">What to collect this month, who owes how much, and who to call — start at the top and work down.</div></div>'+
    '<div id="or-body"><div class="nx-skel" style="height:120px"></div><div class="nx-skel" style="height:110px;margin-top:16px"></div><div class="nx-skel" style="height:240px;margin-top:16px"></div></div>'+
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
        _closing:Number(r.closing||0), _net:Number(r.net_price||0), _paid:Number(r.paid_to_date||0),
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

  // AI brief — every insight is clickable to its PROOF (the exact accounts behind it).
  var ins=_orInsights(ST.rows, T);
  var insHTML=ins.map(function(o){
    var clickable=!!o.act;
    return '<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--fk-border);'+(clickable?'cursor:pointer':'')+'"'+(clickable?' onclick="'+o.act+'" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'"':'')+'>'+
      '<div class="nx-ichip nx-ichip--'+o.t+'" style="flex-shrink:0">'+NX.icon(o.ic,15)+'</div>'+
      '<div style="min-width:0;flex:1"><div class="nx-kpi-label" style="text-transform:uppercase">'+esc(o.h)+'</div><div style="font-size:13px;line-height:1.5;margin-top:1px">'+o.x+'</div>'+
        (clickable?'<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-primary);margin-top:3px">'+esc(o.proof||'See the accounts')+' →</div>':'')+'</div></div>';
  }).join('');
  var aiCard=NX.card(
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">'+NX.icon('zap',16)+'<span style="font-weight:600">Your brief</span>'+NX.badge('AI','primary')+
      NX.infoTip('Every line is computed live from your accounts (get_officer_recovery + propensity). Click any line to see the exact accounts that prove it.')+
      '<span class="nx-kpi-label" style="text-transform:none;margin-left:auto">'+esc(ST.monLabel)+'</span></div>'+insHTML,
    {} );

  // money picture — the four figures the officer needs. "This month's demand" is the
  // FULL month's billing (matches the admin Recovery Intelligence); the baqaya figures
  // are due-to-date — never the full contract / project-end (e.g. 2030) balance.
  var fig=function(label,val,kind,tone,sub,big){
    return '<div class="nx-card" style="cursor:pointer;padding:var(--fk-sp-4);flex:1;min-width:150px;'+(big?'border:1px solid var(--fk-danger)':'')+'" onclick="_orDrill(\''+kind+'\')" title="Click to see every account behind this figure">'+
      '<div class="nx-kpi-label">'+esc(label)+'</div>'+
      '<div style="font-size:'+(big?'25px':'21px')+';font-weight:600;margin-top:3px;'+(tone?'color:var(--fk-'+tone+')':'')+'" class="num">'+_orF(val)+'</div>'+
      '<div class="nx-kpi-label" style="text-transform:none;margin-top:2px"><span style="color:var(--fk-text-muted)">'+esc(sub)+'</span> · <span style="color:var(--fk-primary)">accounts →</span></div></div>';
  };
  var bar='<div style="height:10px;border-radius:6px;background:var(--fk-bg-subtle);overflow:hidden;margin-top:4px"><div style="height:100%;width:'+Math.min(100,pct)+'%;background:var(--fk-success);border-radius:6px"></div></div>';
  var note='<div class="nx-kpi-label" style="text-transform:none;display:flex;align-items:flex-start;gap:6px;margin-top:var(--fk-sp-4);line-height:1.5">'+NX.icon('info',13)+'<span><b style="font-weight:600">Demand</b> = this month’s full billing (whole month). <b style="font-weight:600">Old baqaya</b> &amp; <b style="font-weight:600">current baqaya</b> are <b style="font-weight:600">due to date</b> — only what has fallen due up to today; future installments (e.g. through 2030) are <b style="font-weight:600">not</b> counted.</span></div>';
  var money=NX.card(
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--fk-sp-4)"><span style="font-weight:600;display:flex;align-items:center;gap:8px">'+NX.icon('target',16)+'This month — '+esc(ST.monLabel)+'</span><span class="nx-kpi-label" style="text-transform:none;margin-left:auto">as of '+esc(_orDate(ST.today))+'</span></div>'+
    '<div style="display:flex;gap:var(--fk-sp-2);flex-wrap:wrap;align-items:stretch">'+
      fig('This month’s demand',T.dueMonth,'demand','','billed this month')+
      fig('Recovered',T.recovered,'recovered','success','collected this month')+
      fig('Old baqaya',T.oldArrears,'old','warning','before this month')+
      fig('Current baqaya — still due',T.remaining,'remaining','danger','due to date · not till 2030',true)+
    '</div>'+
    '<div style="margin-top:var(--fk-sp-4)"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="nx-kpi-label" style="text-transform:none">Collected vs billed this month</span><span style="font-weight:600">'+pct+'% · '+_orC(T.recovered)+' of '+_orC(T.dueMonth)+' billed</span></div>'+bar+'</div>'+
    note
  ,{});

  // filter bar + working table
  var fbtn=function(f,lb){ return '<button data-f="'+f+'" class="nx-btn nx-btn--sm '+(f==='owe'?'nx-btn--secondary':'nx-btn--ghost')+'" onclick="_orSetFilter(\''+f+'\')">'+esc(lb)+'</button>'; };
  var filterbar='<div id="or-filterbar" style="display:flex;gap:6px;flex-wrap:wrap">'+
    fbtn('owe','Everyone who owes')+fbtn('overdue','Overdue only')+fbtn('likely','Likely to pay')+fbtn('quiet','Gone quiet')+'</div>';
  var tableCard=NX.card(
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:var(--fk-sp-4)"><span style="font-weight:600;display:flex;align-items:center;gap:8px">'+NX.icon('users',16)+'Who to call</span><div style="margin-left:auto">'+filterbar+'</div></div>'+
    '<div id="or-table"></div>', {});

  b.innerHTML=aiCard+'<div style="height:16px"></div>'+money+'<div style="height:16px"></div>'+tableCard;
  _orRenderTable();
}

// ── Print / PDF: clean A4 brief — money picture + the full call list. ──
function _orPrint(){
  var ST=window._orStore; if(!ST||!ST.rows.length){ if(typeof toast==='function') toast('Open the report first','warn'); return; }
  var T=ST.T, co=(typeof S!=='undefined'&&S&&S.coName)||'Company';
  var who=(typeof S!=='undefined'&&S&&(S.name||S.username))||'';
  var pct=T.dueMonth>0?Math.round(T.recovered/T.dueMonth*100):0;
  var owe=ST.rows.filter(function(r){return r._closing>0.5;}).sort(function(a,b){return b._closing-a._closing;});
  var rowsHTML=owe.map(function(r,i){
    return '<tr><td class="n">'+(i+1)+'</td><td>'+esc(r.client_name)+'<div class="su">'+esc(r.unit_no||'')+(r._odd>0?' · '+r._odd+'d overdue':'')+'</div></td>'+
      '<td>'+esc(r.phone||'—')+'</td>'+
      '<td class="n">'+(r._open>0.5?_orF(r._open):'—')+'</td>'+
      '<td class="n">'+(r._due>0.5?_orF(r._due):'—')+'</td>'+
      '<td class="n">'+(r._rec>0.5?_orF(r._rec):'—')+'</td>'+
      '<td class="n"><b>'+_orF(r._closing)+'</b></td>'+
      '<td>'+(r._prop!=null?r._prop+'%':'—')+'</td></tr>';
  }).join('');
  var css='*{box-sizing:border-box}@page{size:A4 portrait;margin:12mm 11mm}html,body{background:#fff}'+
    'body{font-family:"Inter",system-ui,Arial,sans-serif;color:#1f2330;font-size:11px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #4f46e5;padding-bottom:8px;margin-bottom:13px}'+
    '.hd .co{font-size:12px;color:#6b7280;font-weight:600}.hd .ti{font-size:21px;font-weight:700;letter-spacing:-.3px;color:#111}.hd-r{text-align:right;font-size:10px;color:#6b7280;line-height:1.5}'+
    '.kp{display:flex;gap:10px;margin-bottom:14px}.kc{flex:1;border:1px solid #ececf3;border-radius:8px;padding:9px 11px}.kc label{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af}.kc b{font-size:16px}'+
    '.pb{height:9px;border-radius:5px;background:#eef0f5;overflow:hidden;margin:4px 0 14px}.pb span{display:block;height:100%;background:#16a34a}'+
    'table.tb{width:100%;border-collapse:collapse;font-size:10px}.tb td,.tb th{padding:4px 6px;border-bottom:1px solid #eee}.tb th{font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af;text-align:left;font-weight:600}'+
    '.n{text-align:right;font-variant-numeric:tabular-nums}.su{font-size:8.5px;color:#9ca3af}'+
    '.ft{margin-top:14px;border-top:1px solid #ececf3;padding-top:6px;font-size:8px;color:#9ca3af;text-align:center}';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>My Recovery — '+esc(co)+'</title><style>'+css+'</style></head><body>'+
    '<div class="hd"><div><div class="co">'+esc(co)+(who?' · '+esc(who):'')+'</div><div class="ti">My Recovery</div></div>'+
      '<div class="hd-r"><div>'+esc(ST.monLabel)+'</div><div>as of '+esc(_orDate(ST.today))+'</div></div></div>'+
    '<div class="kp"><div class="kc"><label>This month’s demand</label><b>'+_orF(T.dueMonth)+'</b></div>'+
      '<div class="kc"><label>Recovered</label><b style="color:#16a34a">'+_orF(T.recovered)+'</b></div>'+
      '<div class="kc"><label>Old baqaya</label><b style="color:#d97706">'+_orF(T.oldArrears)+'</b></div>'+
      '<div class="kc"><label>Current baqaya · due now</label><b style="color:#dc2626">'+_orF(T.remaining)+'</b></div></div>'+
    '<div style="font-size:10px;color:#6b7280;margin-bottom:2px">Collected '+pct+'% of this month’s billing · demand = full month; baqaya = due to date (future installments, e.g. through 2030, are not counted)</div><div class="pb"><span style="width:'+Math.min(100,pct)+'%"></span></div>'+
    '<table class="tb"><thead><tr><th class="n">#</th><th>Client / Unit</th><th>Phone</th><th class="n">Old baqaya</th><th class="n">Due this mo</th><th class="n">Recovered</th><th class="n">Current baqaya</th><th>Will pay</th></tr></thead><tbody>'+rowsHTML+'</tbody></table>'+
    '<div class="ft">Generated '+esc((new Date()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+' · Nexunova RMS · Your assigned accounts only</div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html, 'My Recovery'); else window.print();
}
