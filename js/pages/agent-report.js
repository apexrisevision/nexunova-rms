// ════════════════════════════════════════════════════════════════════════════
// AGENT RECOVERY BOOK — sale-agent-wise outstanding.
// The SELLER-accountability mirror of My Recovery (officer view). Answers, per
// sale agent: which units they sold, and how much each of their clients still
// owes — so the agent recovers from their own clients.
// Data: get_agent_outstanding (pivots the verified arrears math on sales.agent_id).
//   • overdue (arrears, to-date)  ← the headline
//   • total remaining (lifetime balance)  • this-month due  • paid %
// Admin can ASSIGN an agent to existing (unattributed) sales right here, so the
// historical KBH book lights up. Attribution only — money/commission live in QB.
// ════════════════════════════════════════════════════════════════════════════

function _arC(n){ n=Number(n||0); var a=Math.abs(n), s=n<0?'-':''; if(a>=1e9)return s+'₨'+(a/1e9).toFixed(2)+'B'; if(a>=1e6)return s+'₨'+(a/1e6).toFixed(1)+'M'; if(a>=1e3)return s+'₨'+Math.round(a/1e3)+'K'; return s+'₨'+Math.round(a); }
function _arF(n){ return '₨'+((typeof fM==='function')?fM(Number(n||0)):Number(n||0).toLocaleString('en-US')); }
function _arPhone(p){ var d=String(p||'').replace(/[^0-9]/g,''); if(d.length===11 && d[0]==='0') d='92'+d.slice(1); if(d.length===10) d='92'+d; return d; }
function _arDate(iso){ if(!iso) return ''; try{ return (typeof fD==='function')?fD(String(iso).slice(0,10)):String(iso).slice(0,10); }catch(e){ return String(iso).slice(0,10); } }
function _arWaText(r){
  var co=(typeof S!=='undefined'&&S&&S.coName)||'';
  var amt=_arF(r.overdue>0.5?r.overdue:r.total_remaining);
  return 'Assalam-o-Alaikum '+(r.client_name||'')+' Sahab,\n\nAap ke unit '+(r.unit_no||'')+' par '+amt+' baqaya hai. Baraye meherbani jald se jald adaigi karwa dein taake aap ka account clear rahe.\n\nShukria'+(co?'\n'+co:'');
}

// ── Load ────────────────────────────────────────────────────────────────────
async function _arLoad(){
  var host=document.getElementById('ar-body'); if(!host) return;
  try{
    var asOf=(window._arAsOf||null);
    var res=await supabase.rpc('get_agent_outstanding',{
      p_company_id:S.cid,
      p_project_id:(typeof activeProjectId==='function'?activeProjectId():null),
      p_agent_id:null,
      p_as_of:asOf
    });
    if(res.error) throw res.error;
    var d=res.data||{};
    window._arStore={ agents:(d.agents||[]), rows:(d.rows||[]), totals:(d.totals||{}), asOf:(d.as_of||asOf||(typeof td==='function'?td():'')) };
    _arRender();
  }catch(e){
    host.innerHTML=NX.empty({icon:'alert-triangle', message:'Could not load the Agent Recovery report. '+esc(e.message||'')});
  }
}

async function rAgentRecovery(){
  var pg=document.getElementById('pg-agentrecovery'); if(!pg) return;
  if(!window._arView) window._arView={mode:'roster', agentId:null};
  var today=(typeof td==='function'?td():new Date().toISOString().slice(0,10));
  pg.innerHTML='<div class="nx" style="padding:var(--fk-sp-4);display:flex;flex-direction:column;gap:var(--fk-sp-3)">'+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
      '<h1 class="nx-page-title" style="display:flex;align-items:center;gap:8px;margin:0">'+NX.icon('user-check',22)+' Agent Recovery Book</h1>'+
      '<span class="nx-kpi-label" style="text-transform:none">who sold it · who owes · as of '+esc(_arDate(window._arAsOf||today))+'</span>'+
      '<div style="margin-left:auto;display:flex;gap:8px">'+
        NX.button('Assign agent',{variant:'secondary',size:'sm',icon:'user-plus',onclick:"_arAssignOpen()"})+
        NX.button('Refresh',{variant:'ghost',size:'sm',icon:'refresh-cw',onclick:"_arLoad()"})+
        NX.button('Print',{variant:'ghost',size:'sm',icon:'printer',onclick:"_arPrint()"})+
      '</div>'+
    '</div>'+
    '<div id="ar-body"><div class="nx-skel" style="height:120px"></div><div class="nx-skel" style="height:280px;margin-top:16px"></div></div>'+
  '</div>';
  await _arLoad();
}

// ── KPI strip (overdue-led) ──────────────────────────────────────────────────
function _arKpis(T){
  var k=function(lb,val,col,sub){ return '<div class="nx-card" style="padding:12px 14px">'+
    '<div class="nx-kpi-label">'+esc(lb)+'</div>'+
    '<div class="num" style="font-size:21px;font-weight:800;'+(col?'color:var(--fk-'+col+')':'')+'">'+val+'</div>'+
    (sub?'<div class="nx-kpi-label" style="text-transform:none;margin-top:2px">'+sub+'</div>':'')+'</div>'; };
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">'+
    k('Overdue now',_arF(T.overdue||0),'danger','arrears past due to date')+
    k('Total remaining',_arF(T.total_remaining||0),'warning','lifetime balance owed')+
    k('Received',_arF(T.received||0),'success',(T.collected_pct||0)+'% of value')+
    k('Clients in arrears',(T.clients_in_arrears||0)+' / '+(T.clients||0),null,'need follow-up')+
    k('Units sold',(T.units_sold||0),null,_arF(T.net_value||0)+' value')+
  '</div>';
}

function _arRender(){
  var ST=window._arStore; if(!ST) return;
  if((window._arView&&window._arView.mode)==='agent'){ _arAgentView(window._arView.agentId); return; }
  var host=document.getElementById('ar-body'); if(!host) return;
  var T=ST.totals||{};
  if(!ST.rows.length){ host.innerHTML=NX.empty({icon:'inbox', message:'No active sales found for this scope.'}); return; }

  // roster table — one row per agent, overdue-first
  var thCss='padding:10px;background:var(--fk-bg-subtle);border-bottom:2px solid var(--fk-border);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--fk-text-muted)';
  var cols=['Agent','>Units','>Clients','>Overdue','>This month','>Total remaining','>Collected','Last collection',''];
  var th='<tr>'+cols.map(function(h){var r=h[0]==='>';return '<th style="'+thCss+(r?';text-align:right':';text-align:left')+'">'+esc(r?h.slice(1):h)+'</th>';}).join('')+'</tr>';
  var body=ST.agents.map(function(a){ var cs='padding:10px;border-bottom:1px solid var(--fk-border)';
    var isUn=!a.agent_id;
    var nm='<div style="font-weight:600;display:flex;align-items:center;gap:7px">'+(isUn?NX.icon('help-circle',15):NX.icon('user',15))+esc(a.agent_name)+'</div>'+
      '<div class="nx-kpi-label" style="text-transform:none">'+(a.agent_code?esc(a.agent_code):(isUn?'no agent attached':''))+(a.agent_phone?' · '+esc(a.agent_phone):'')+'</div>';
    var od=Number(a.overdue||0), arr=Number(a.clients_in_arrears||0);
    return '<tr style="cursor:pointer" onclick="_arOpenAgent(\''+(a.agent_id||'__none__')+'\')" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="'+cs+'">'+nm+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(a.units_sold||0)+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(a.clients||0)+(arr>0?' <span style="color:var(--fk-danger)">('+arr+')</span>':'')+'</td>'+
      '<td style="'+cs+';text-align:right;font-weight:700" class="num">'+(od>0.5?'<span style="color:var(--fk-danger)">'+_arF(od)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(Number(a.month_due||0)>0.5?_arF(a.month_due):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+_arF(a.total_remaining||0)+'</td>'+
      '<td style="'+cs+';text-align:right" class="num"><span style="color:var(--fk-success)">'+(a.collected_pct||0)+'%</span></td>'+
      '<td style="'+cs+'" class="nx-kpi-label" style="text-transform:none">'+(a.last_collection?esc(_arDate(a.last_collection)):'<span class="nx-kpi-label">never</span>')+'</td>'+
      '<td style="'+cs+';text-align:right;color:var(--fk-text-muted)">'+NX.icon('chevron-right',16)+'</td></tr>';
  }).join('');
  var tcs='padding:10px;border-top:2px solid var(--fk-border);background:var(--fk-bg-subtle);font-weight:800';
  var totRow='<tr>'+
    '<td style="'+tcs+'">TOTAL · '+ST.agents.length+' agent'+(ST.agents.length!==1?'s':'')+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+(T.units_sold||0)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+(T.clients||0)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-danger)" class="num">'+_arF(T.overdue||0)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_arF(T.month_due||0)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_arF(T.total_remaining||0)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-success)" class="num">'+(T.collected_pct||0)+'%</td>'+
    '<td style="'+tcs+'"></td><td style="'+tcs+'"></td></tr>';
  var unattributed=ST.agents.filter(function(a){return !a.agent_id;})[0];
  var banner=unattributed?'<div class="nx-card" style="border:1px solid color-mix(in srgb,var(--fk-warning) 45%,transparent);background:color-mix(in srgb,var(--fk-warning) 7%,transparent);display:flex;gap:10px;align-items:center;padding:11px 14px">'+
    NX.icon('info',18)+'<div style="flex:1"><b>'+(unattributed.units_sold||0)+'</b> unit'+((unattributed.units_sold||0)!==1?'s are':' is')+' not attached to any sale agent ('+_arF(unattributed.overdue||0)+' overdue). Use <b>Assign agent</b> so each agent owns &amp; recovers their clients.</div>'+
    NX.button('Assign now',{variant:'secondary',size:'sm',icon:'user-plus',onclick:"_arAssignOpen()"})+'</div>':'';

  host.innerHTML=_arKpis(T)+
    '<div style="height:6px"></div>'+banner+
    '<div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span style="font-weight:600;display:flex;align-items:center;gap:6px">'+NX.icon('users',16)+'Agents · worst overdue first</span><span class="nx-kpi-label" style="text-transform:none;margin-left:auto">click an agent to see their clients</span></div>'+
    '<div style="border:1px solid var(--fk-border);border-radius:var(--fk-radius);overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'+th+'</thead><tbody>'+body+totRow+'</tbody></table></div>';
}

// ── Agent detail (their client list) ─────────────────────────────────────────
function _arOpenAgent(agentId){ window._arView={mode:'agent', agentId:(agentId==='__none__'?null:agentId)}; _arAgentView(window._arView.agentId); }
function _arBackRoster(){ window._arView={mode:'roster', agentId:null}; _arRender(); }

function _arAgentRows(agentId){ return (window._arStore.rows||[]).filter(function(r){ return (r.agent_id||null)===(agentId||null); }); }
function _arAgentMeta(agentId){ return (window._arStore.agents||[]).filter(function(a){ return (a.agent_id||null)===(agentId||null); })[0]||{}; }

function _arAgentView(agentId){
  var host=document.getElementById('ar-body'); if(!host) return;
  var meta=_arAgentMeta(agentId);
  var rows=_arAgentRows(agentId).slice().sort(function(a,b){ return (b.overdue||0)-(a.overdue||0) || (b.total_remaining||0)-(a.total_remaining||0); });
  var thCss='padding:10px;background:var(--fk-bg-subtle);border-bottom:2px solid var(--fk-border);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--fk-text-muted)';
  var cols=['Client / Unit','>Overdue','>This month','>Received','>Total remaining','>Paid','Actions'];
  var th='<tr>'+cols.map(function(h){var r=h[0]==='>';return '<th style="'+thCss+(r?';text-align:right':';text-align:left')+'">'+esc(r?h.slice(1):h)+'</th>';}).join('')+'</tr>';
  var body=rows.map(function(r){ var cs='padding:9px 10px;border-bottom:1px solid var(--fk-border)';
    var ph=_arPhone(r.phone);
    var tel = r.phone ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="Call '+esc(r.phone)+'" href="tel:'+esc(r.phone)+'" onclick="event.stopPropagation()">'+NX.icon('phone',15)+'</a>' : '';
    var wa  = ph ? '<a class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" title="WhatsApp reminder" target="_blank" rel="noopener" href="https://wa.me/'+ph+'?text='+encodeURIComponent(_arWaText(r))+'" onclick="event.stopPropagation()">'+NX.icon('message-circle',15)+'</a>' : '';
    var log = '<button class="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" style="color:var(--fk-primary)" title="Log a call / promise to pay" onclick="event.stopPropagation();if(typeof openConModal===\'function\')openConModal(\''+(r.unit_id||'')+'\')">'+NX.icon('check',15)+'</button>';
    var sub=esc(r.unit_no||'')+(r.floor_name?' · '+esc(r.floor_name):'')+(r.phone?' · '+esc(r.phone):'')+(Number(r.overdue_days||0)>0?' · <span style="color:var(--fk-danger)">'+r.overdue_days+'d overdue</span>':'')+(r.flag_legal?' · '+NX.badge('Legal','danger'):'');
    return '<tr style="cursor:pointer" onclick="_arOpenUnit(\''+(r.sale_id||'')+'\')" onmouseover="this.style.background=\'var(--fk-bg-subtle)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="'+cs+'"><div style="font-weight:600">'+esc(r.client_name||'')+'</div><div class="nx-kpi-label" style="text-transform:none">'+sub+'</div></td>'+
      '<td style="'+cs+';text-align:right;font-weight:700" class="num">'+(Number(r.overdue||0)>0.5?'<span style="color:var(--fk-danger)">'+_arF(r.overdue)+'</span>':'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(Number(r.month_due||0)>0.5?_arF(r.month_due):'<span class="nx-kpi-label">—</span>')+'</td>'+
      '<td style="'+cs+';text-align:right" class="num"><span style="color:var(--fk-success)">'+_arF(r.received||0)+'</span></td>'+
      '<td style="'+cs+';text-align:right" class="num">'+_arF(r.total_remaining||0)+'</td>'+
      '<td style="'+cs+';text-align:right" class="num">'+(r.paid_pct||0)+'%</td>'+
      '<td style="'+cs+';white-space:nowrap" onclick="event.stopPropagation()"><div style="display:flex;gap:3px">'+tel+wa+log+'</div></td></tr>';
  }).join('');
  var Z={overdue:0,month_due:0,received:0,total_remaining:0}; rows.forEach(function(r){ Z.overdue+=Number(r.overdue||0);Z.month_due+=Number(r.month_due||0);Z.received+=Number(r.received||0);Z.total_remaining+=Number(r.total_remaining||0); });
  var tcs='padding:10px;border-top:2px solid var(--fk-border);background:var(--fk-bg-subtle);font-weight:800';
  var totRow='<tr><td style="'+tcs+'">TOTAL · '+rows.length+' client'+(rows.length!==1?'s':'')+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-danger)" class="num">'+_arF(Z.overdue)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_arF(Z.month_due)+'</td>'+
    '<td style="'+tcs+';text-align:right;color:var(--fk-success)" class="num">'+_arF(Z.received)+'</td>'+
    '<td style="'+tcs+';text-align:right" class="num">'+_arF(Z.total_remaining)+'</td>'+
    '<td style="'+tcs+'"></td><td style="'+tcs+'"></td></tr>';

  var isUn=!agentId;
  var head='<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
    NX.button('All agents',{variant:'ghost',size:'sm',icon:'arrow-left',onclick:"_arBackRoster()"})+
    '<div><div style="font-size:18px;font-weight:800;display:flex;align-items:center;gap:8px">'+(isUn?NX.icon('help-circle',18):NX.icon('user',18))+esc(meta.agent_name||'Agent')+'</div>'+
      '<div class="nx-kpi-label" style="text-transform:none">'+(meta.agent_code?esc(meta.agent_code)+' · ':'')+(meta.agent_phone?esc(meta.agent_phone)+' · ':'')+(meta.units_sold||rows.length)+' units</div></div>'+
    '<div style="margin-left:auto;display:flex;gap:6px">'+
      (isUn?NX.button('Assign these',{variant:'secondary',size:'sm',icon:'user-plus',onclick:"_arAssignOpen()"}):'')+
      NX.button('Print this book',{variant:'ghost',size:'sm',icon:'printer',onclick:"_arPrintAgent('"+(agentId||'__none__')+"')"})+
    '</div></div>';
  var miniK=function(lb,v,col){ return '<div style="flex:1;min-width:120px;border:1px solid var(--fk-border);border-radius:10px;padding:9px 12px;background:var(--fk-bg-subtle)"><div class="nx-kpi-label">'+esc(lb)+'</div><div class="num" style="font-size:17px;font-weight:800;'+(col?'color:var(--fk-'+col+')':'')+'">'+v+'</div></div>'; };
  var strip='<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">'+
    miniK('Overdue',_arF(Z.overdue),'danger')+miniK('Total remaining',_arF(Z.total_remaining),'warning')+
    miniK('Received',_arF(Z.received),'success')+miniK('Clients in arrears',(meta.clients_in_arrears||rows.filter(function(r){return Number(r.overdue||0)>0.5;}).length))+'</div>';

  host.innerHTML=NX.card(head+strip+'<div style="border:1px solid var(--fk-border);border-radius:var(--fk-radius);overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'+th+'</thead><tbody>'+body+totRow+'</tbody></table></div>'+
    '<div class="nx-kpi-label" style="text-transform:none;margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">work each client right here →'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('phone',13)+'Call</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px">'+NX.icon('message-circle',13)+'WhatsApp</span>·'+
      '<span style="display:inline-flex;align-items:center;gap:3px;color:var(--fk-primary)">'+NX.icon('check',13)+'Log / promise</span></div>', {});
}
function _arOpenUnit(saleId){ if(saleId && saleId!=='null' && typeof openSaleDetail==='function') openSaleDetail(saleId); }

// ── Assign agent tool (bulk) ─────────────────────────────────────────────────
async function _arAssignOpen(){
  var host=document.getElementById('ar-assign-host'); if(!host){ host=document.createElement('div'); host.id='ar-assign-host'; document.body.appendChild(host); }
  var agents=[];
  try{ var res=await supabase.rpc('list_agents',{p_company_id:S.cid,p_search:null,p_status:'active',p_sort:'name'}); agents=Array.isArray(res.data)?res.data:[]; }catch(e){}
  window._arAssignAgents=agents;
  window._arAssignSel={};
  var opts='<option value="">— pick a sale agent —</option>'+agents.map(function(a){ return '<option value="'+esc(a.id)+'">'+esc(a.full_name)+(a.agent_code?' ('+esc(a.agent_code)+')':'')+'</option>'; }).join('');
  var body='<div style="display:flex;flex-direction:column;gap:12px">'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">'+
      '<div style="flex:1;min-width:220px"><label class="nx-kpi-label" style="display:block;margin-bottom:4px">Assign to agent</label><select id="ar-asg-agent" class="nx-input" style="width:100%">'+opts+'</select></div>'+
      '<div style="min-width:200px"><label class="nx-kpi-label" style="display:block;margin-bottom:4px">Show</label>'+
        '<select id="ar-asg-scope" class="nx-input" style="width:100%" onchange="_arAssignList()"><option value="unassigned">Unassigned only</option><option value="all">All clients</option></select></div>'+
      '<input id="ar-asg-q" class="nx-input" placeholder="Search client / unit…" style="flex:1;min-width:200px" oninput="_arAssignList()">'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:10px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ar-asg-allchk" onchange="_arAssignToggleAll(this.checked)"> <span class="nx-kpi-label" style="text-transform:none">Select all shown</span></label><span id="ar-asg-count" class="nx-kpi-label" style="text-transform:none;margin-left:auto"></span></div>'+
    '<div id="ar-asg-list" style="max-height:48vh;overflow:auto;border:1px solid var(--fk-border);border-radius:10px"></div>'+
  '</div>';
  var footer='<div style="display:flex;gap:8px;width:100%;justify-content:flex-end">'+
    NX.button('Cancel',{variant:'ghost',onclick:"_arAssignClose()"})+
    NX.button('Assign selected',{variant:'primary',icon:'user-check',onclick:"_arAssignSubmit()"})+'</div>';
  host.innerHTML=NX.modal({ title:'Assign sale agent', size:'l', body:body, footer:footer, onClose:"_arAssignClose()" });
  var ov=host.querySelector('.nx-modal-overlay'); if(ov) ov.addEventListener('click',function(e){ if(e.target===ov) _arAssignClose(); });
  _arAssignList();
}
function _arAssignClose(){ var h=document.getElementById('ar-assign-host'); if(h) h.innerHTML=''; }
function _arAssignList(){
  var box=document.getElementById('ar-asg-list'); if(!box) return;
  var scope=(document.getElementById('ar-asg-scope')||{}).value||'unassigned';
  var q=((document.getElementById('ar-asg-q')||{}).value||'').toLowerCase().trim();
  var rows=(window._arStore.rows||[]).filter(function(r){
    if(scope==='unassigned' && r.agent_id) return false;
    if(q){ var hay=((r.client_name||'')+' '+(r.unit_no||'')+' '+(r.client_code||'')+' '+(r.agent_name||'')).toLowerCase(); if(hay.indexOf(q)<0) return false; }
    return true;
  });
  if(!rows.length){ box.innerHTML='<div style="padding:18px;text-align:center" class="nx-kpi-label">No matching clients.</div>'; _arAssignUpdateCount(); return; }
  box.innerHTML=rows.map(function(r){ var cs='padding:8px 12px;border-bottom:1px solid var(--fk-border);display:flex;align-items:center;gap:10px';
    var checked=window._arAssignSel[r.sale_id]?'checked':'';
    return '<label style="'+cs+';cursor:pointer">'+
      '<input type="checkbox" '+checked+' onchange="_arAssignPick(\''+r.sale_id+'\',this.checked)">'+
      '<div style="flex:1;min-width:0"><div style="font-weight:600">'+esc(r.client_name||'')+'</div><div class="nx-kpi-label" style="text-transform:none">'+esc(r.unit_no||'')+(r.floor_name?' · '+esc(r.floor_name):'')+' · '+_arF(r.total_remaining||0)+' remaining</div></div>'+
      '<div class="nx-kpi-label" style="text-transform:none">'+(r.agent_id?esc(r.agent_name):'<span style="color:var(--fk-warning)">unassigned</span>')+'</div></label>';
  }).join('');
  _arAssignUpdateCount();
}
function _arAssignPick(saleId,on){ if(on) window._arAssignSel[saleId]=true; else delete window._arAssignSel[saleId]; _arAssignUpdateCount(); }
function _arAssignToggleAll(on){
  var box=document.getElementById('ar-asg-list'); if(!box) return;
  box.querySelectorAll('input[type=checkbox]').forEach(function(c){ c.checked=on; });
  var scope=(document.getElementById('ar-asg-scope')||{}).value||'unassigned';
  var q=((document.getElementById('ar-asg-q')||{}).value||'').toLowerCase().trim();
  (window._arStore.rows||[]).forEach(function(r){
    if(scope==='unassigned' && r.agent_id) return;
    if(q){ var hay=((r.client_name||'')+' '+(r.unit_no||'')+' '+(r.client_code||'')).toLowerCase(); if(hay.indexOf(q)<0) return; }
    if(on) window._arAssignSel[r.sale_id]=true; else delete window._arAssignSel[r.sale_id];
  });
  _arAssignUpdateCount();
}
function _arAssignUpdateCount(){ var el=document.getElementById('ar-asg-count'); if(el){ var n=Object.keys(window._arAssignSel||{}).length; el.textContent=n+' selected'; } }
async function _arAssignSubmit(){
  var sel=Object.keys(window._arAssignSel||{});
  var agentId=(document.getElementById('ar-asg-agent')||{}).value||'';
  if(!agentId){ if(typeof toast==='function') toast('Pick an agent to assign to','warn'); return; }
  if(!sel.length){ if(typeof toast==='function') toast('Tick at least one client','warn'); return; }
  try{
    var res=await supabase.rpc('assign_sale_agent',{p_company_id:S.cid,p_sale_ids:sel,p_agent_id:agentId});
    if(res.error) throw res.error;
    var d=res.data||{};
    if(d.success){ if(typeof toast==='function') toast('Assigned '+(d.updated||sel.length)+' client(s) to '+(d.agent_name||'agent'),'success'); _arAssignClose(); await _arLoad(); }
    else { if(typeof toast==='function') toast(d.message||d.error||'Could not assign','error'); }
  }catch(e){ if(typeof toast==='function') toast('Assign failed: '+(e.message||''),'error'); }
}

// ── Print (A4) ───────────────────────────────────────────────────────────────
function _arPrintRowsHTML(rows){
  return rows.map(function(r,i){ return '<tr>'+
    '<td class="n rk">'+(i+1)+'</td>'+
    '<td><div class="cn">'+esc(r.client_name||'')+'</div><div class="su">'+esc(r.unit_no||'')+' · '+esc(r.phone||'no phone')+'</div></td>'+
    '<td class="n">'+(Number(r.overdue_days||0)>0?'<span class="'+(r.overdue_days>=90?'od':'')+'">'+r.overdue_days+'d</span>':'—')+'</td>'+
    '<td class="n big">'+(Number(r.overdue||0)>0.5?_arF(r.overdue):'—')+'</td>'+
    '<td class="n">'+(Number(r.month_due||0)>0.5?_arF(r.month_due):'—')+'</td>'+
    '<td class="n grn">'+(Number(r.received||0)>0.5?_arF(r.received):'—')+'</td>'+
    '<td class="n">'+_arF(r.total_remaining||0)+'</td>'+
    '<td class="n">'+(r.paid_pct||0)+'%</td></tr>';
  }).join('');
}
function _arPrintCSS(){
  return '*{box-sizing:border-box}@page{size:A4 landscape;margin:10mm}html,body{background:#fff}'+
  'body{font-family:"Inter",-apple-system,system-ui,Arial,sans-serif;color:#1e2433;font-size:10px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
  '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:11px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}'+
  '.hb .co{font-size:10.5px;opacity:.85;font-weight:600;letter-spacing:.03em;text-transform:uppercase}.hb .ti{font-size:22px;font-weight:800;letter-spacing:-.4px;margin-top:3px}'+
  '.hb-r{text-align:right;font-size:10px;opacity:.92;line-height:1.7}.hb-r b{font-size:13px;font-weight:700}'+
  '.ag{margin:16px 0 6px;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #e3e5ef;padding-bottom:5px}'+
  '.ag .an{font-size:14px;font-weight:800}.ag .am{font-size:9px;color:#8990a6}.ag .ao{font-size:9px;color:#8990a6;text-align:right}.ag .ao b{font-size:13px;color:#dc2626}'+
  'table.tb{width:100%;border-collapse:collapse;font-size:9.5px;table-layout:fixed}'+
  '.tb th{font-size:7.5px;text-transform:uppercase;letter-spacing:.05em;color:#8990a6;text-align:left;font-weight:700;padding:6px 8px;border-bottom:1.5px solid #e3e5ef}'+
  '.tb td{padding:5px 8px;border-bottom:1px solid #f1f2f7;vertical-align:top;overflow:hidden}.tb tbody tr:nth-child(even) td{background:#fbfbfe}.tb tr{page-break-inside:avoid}'+
  '.n{text-align:right;font-variant-numeric:tabular-nums}.rk{font-weight:700;color:#aab0c4}.cn{font-weight:700;font-size:10px}.su{font-size:8px;color:#a0a5b8;margin-top:1px}'+
  '.grn{color:#16a34a}.big{font-weight:800;color:#dc2626}.od{color:#dc2626;font-weight:700}'+
  '.tot td{background:#f3f4fa;font-weight:800;border-top:2px solid #c7cadb;border-bottom:none;padding:7px 8px}'+
  '.ft{margin-top:13px;border-top:1px solid #eceef5;padding-top:8px;font-size:8px;color:#aab0c4;display:flex;justify-content:space-between}';
}
function _arPrintHead(){
  var ST=window._arStore;
  var co=(typeof coLegalName==='function')?coLegalName():((typeof S!=='undefined'&&S&&S.coName)||'Company');
  var logo=(typeof getCoLogo==='function')?getCoLogo():null;
  var wl=!!(window._cobranding&&window._cobranding.white_label);
  // Logo sits in a white chip so any logo reads clearly on the indigo header.
  var logoTag=logo?'<img src="'+logo+'" style="height:30px;max-width:120px;object-fit:contain;background:#fff;border-radius:6px;padding:3px 6px;margin-bottom:6px;display:block" alt="">':'';
  var thead='<thead><tr><th class="n">#</th><th>Client / Unit / Phone</th><th class="n">Overdue</th><th class="n">Arrears</th><th class="n">This month</th><th class="n">Received</th><th class="n">Total remaining</th><th class="n">Paid</th></tr></thead>';
  return {co:co, logo:logo, logoTag:logoTag, wl:wl, asOf:_arDate(ST.asOf), thead:thead};
}
// Footer brand line — suppressed for white-label (Ultimate/Enterprise) tenants.
function _arFootBrand(wl, tail){ return wl ? '' : '<span>Nexunova RMS · '+tail+'</span>'; }
function _arPrintAgent(agentId){
  var ST=window._arStore; if(!ST){ return; }
  if(agentId==='__none__') agentId=null;
  var meta=_arAgentMeta(agentId);
  var rows=_arAgentRows(agentId).slice().sort(function(a,b){ return (b.overdue||0)-(a.overdue||0); });
  var H=_arPrintHead();
  var Z={overdue:0,month_due:0,received:0,total_remaining:0}; rows.forEach(function(r){ Z.overdue+=Number(r.overdue||0);Z.month_due+=Number(r.month_due||0);Z.received+=Number(r.received||0);Z.total_remaining+=Number(r.total_remaining||0); });
  var tot='<tr class="tot"><td></td><td>TOTAL · '+rows.length+' clients</td><td></td><td class="n big">'+_arF(Z.overdue)+'</td><td class="n">'+_arF(Z.month_due)+'</td><td class="n grn">'+_arF(Z.received)+'</td><td class="n">'+_arF(Z.total_remaining)+'</td><td></td></tr>';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Agent Recovery — '+esc(meta.agent_name||'')+'</title><style>'+_arPrintCSS()+'</style></head><body>'+
    '<div class="hb"><div>'+H.logoTag+'<div class="co">'+esc(H.co)+'</div><div class="ti">Agent Recovery Book</div></div><div class="hb-r"><b>'+esc(meta.agent_name||'')+'</b><br>as of '+esc(H.asOf)+'</div></div>'+
    '<div class="ag"><div><div class="an">'+esc(meta.agent_name||'')+'</div><div class="am">'+(meta.agent_code?esc(meta.agent_code)+' · ':'')+(meta.agent_phone?esc(meta.agent_phone)+' · ':'')+rows.length+' units</div></div>'+
      '<div class="ao">Overdue<br><b>'+_arF(Z.overdue)+'</b></div></div>'+
    '<table class="tb">'+H.thead+'<tbody>'+_arPrintRowsHTML(rows)+tot+'</tbody></table>'+
    '<div class="ft"><span>Generated '+esc((new Date()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+'</span>'+_arFootBrand(H.wl,'Agent Recovery')+'</div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html,'Agent Recovery'); else window.print();
}
function _arPrintGrandTotal(T){
  T=T||{}; var ST=window._arStore||{};
  var H=_arPrintHead();
  return '<div class="ag" style="margin-top:16px;border-bottom:2px solid #c7cadb"><div><div class="an">GRAND TOTAL</div>'+
      '<div class="am">'+(T.agents||(ST.agents||[]).length)+' agents · '+(T.units_sold||0)+' units · '+(T.clients||0)+' clients</div></div>'+
      '<div class="ao">Total overdue<br><b>'+_arF(T.overdue||0)+'</b></div></div>'+
    '<table class="tb">'+H.thead+'<tbody><tr class="tot"><td></td><td>ALL AGENTS</td><td></td>'+
      '<td class="n big">'+_arF(T.overdue||0)+'</td><td class="n">'+_arF(T.month_due||0)+'</td>'+
      '<td class="n grn">'+_arF(T.received||0)+'</td><td class="n">'+_arF(T.total_remaining||0)+'</td>'+
      '<td class="n">'+(T.collected_pct||0)+'%</td></tr></tbody></table>';
}
function _arPrint(){
  var ST=window._arStore; if(!ST||!ST.rows.length){ if(typeof toast==='function') toast('Open the report first','warn'); return; }
  var H=_arPrintHead(); var T=ST.totals||{};
  var sections=ST.agents.map(function(a){
    var rows=_arAgentRows(a.agent_id||null).slice().sort(function(x,y){ return (y.overdue||0)-(x.overdue||0); });
    var Z={overdue:0,month_due:0,received:0,total_remaining:0}; rows.forEach(function(r){ Z.overdue+=Number(r.overdue||0);Z.month_due+=Number(r.month_due||0);Z.received+=Number(r.received||0);Z.total_remaining+=Number(r.total_remaining||0); });
    var tot='<tr class="tot"><td></td><td>Subtotal · '+rows.length+' clients</td><td></td><td class="n big">'+_arF(Z.overdue)+'</td><td class="n">'+_arF(Z.month_due)+'</td><td class="n grn">'+_arF(Z.received)+'</td><td class="n">'+_arF(Z.total_remaining)+'</td><td></td></tr>';
    return '<div class="ag"><div><div class="an">'+esc(a.agent_name)+'</div><div class="am">'+(a.agent_code?esc(a.agent_code)+' · ':'')+(a.units_sold||rows.length)+' units · '+(a.clients||rows.length)+' clients</div></div>'+
      '<div class="ao">Overdue<br><b>'+_arF(a.overdue||0)+'</b></div></div>'+
      '<table class="tb">'+H.thead+'<tbody>'+_arPrintRowsHTML(rows)+tot+'</tbody></table>';
  }).join('');
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Agent Recovery Book — '+esc(H.co)+'</title><style>'+_arPrintCSS()+'</style></head><body>'+
    '<div class="hb"><div>'+H.logoTag+'<div class="co">'+esc(H.co)+'</div><div class="ti">Agent Recovery Book</div></div><div class="hb-r"><b>Overdue '+_arF(T.overdue||0)+'</b><br>'+(T.agents||0)+' agents · as of '+esc(H.asOf)+'</div></div>'+
    sections+
    _arPrintGrandTotal(T)+
    '<div class="ft"><span>Generated '+esc((new Date()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+'</span>'+_arFootBrand(H.wl,'Agent Recovery · sale-agent-wise outstanding')+'</div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html,'Agent Recovery Book'); else window.print();
}
