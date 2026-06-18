// ════════════════════════════════════════════════════════════════════════════
// DEALER AGREEMENT (admin) — manage the Sale Agent JD / agreement and track who
// has signed. Two tabs:
//   • Agreement   — the clauses (add / edit→new version / remove). Editing a clause
//                   makes every already-signed dealer re-sign just that clause at
//                   their next login.
//   • Compliance  — every dealer's signed / pending / on-hold status; release a held
//                   dealer (let them re-sign, or admin-bypass) and print their record.
// Backend: admin_list_agreement_clauses, upsert_agreement_clause, deactivate_agreement_clause,
//          get_agreement_compliance, release_agreement_hold, get_agent_agreement_record.
// ════════════════════════════════════════════════════════════════════════════

var _daTab = 'clauses';
var _daClauses = [];
var _daComp = null;

function _daHost(){ var h=document.getElementById('da-modal-host'); if(!h){ h=document.createElement('div'); h.id='da-modal-host'; document.body.appendChild(h); } return h; }
function _daCloseModal(){ var h=document.getElementById('da-modal-host'); if(h) h.innerHTML=''; }

async function rDealerAgreement(){
  var pg=document.getElementById('pg-dealeragreement'); if(!pg) return;
  pg.innerHTML='<div class="nx" style="padding:var(--fk-sp-4)">'+
    NX.pageHeader('Dealer Agreement', NX.button('Refresh',{variant:'ghost',size:'sm',icon:'refresh-cw',onclick:'rDealerAgreement()'}),
      {icon:'file-text', tone:'primary', sub:'The Sale Agent terms every dealer signs — and who has signed.'})+
    '<div style="margin:14px 0">'+NX.tabs({tabs:[{k:'clauses',label:'Agreement'},{k:'compliance',label:'Compliance'}],active:_daTab,onSelect:"_daSetTab('%k')"})+'</div>'+
    '<div id="da-body"><div class="nx-skel" style="height:200px"></div></div>'+
  '</div>';
  if(_daTab==='compliance') _daLoadCompliance(); else _daLoadClauses();
}
function _daSetTab(t){ _daTab=t; rDealerAgreement(); }

// ── Agreement (clauses) ──
async function _daLoadClauses(){
  var body=document.getElementById('da-body'); if(!body) return;
  try{
    var r=await supabase.rpc('admin_list_agreement_clauses',{p_company_id:S.cid});
    if(r.error||!r.data||!r.data.success) throw (r.error||new Error('failed'));
    _daClauses=r.data.clauses||[];
  }catch(e){ body.innerHTML=NX.empty({icon:'alert-triangle',message:'Could not load the agreement. '+esc(e.message||'')}); return; }
  var head='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'+
    '<div class="nx-kpi-label" style="text-transform:none">'+_daClauses.length+' active clause'+(_daClauses.length===1?'':'s')+' · editing a clause asks dealers to re-sign it at next login</div>'+
    '<span style="margin-left:auto">'+NX.button('Add clause',{variant:'primary',size:'sm',icon:'plus',onclick:'_daClauseModal()'})+'</span></div>';
  if(!_daClauses.length){ body.innerHTML=head+NX.card(NX.empty({icon:'file-text',message:'No clauses yet. Add the first one, or reset to the default agreement.'}),{}); return; }
  var rows=_daClauses.map(function(c,i){
    return '<div style="padding:14px 0;border-bottom:1px solid var(--fk-border)">'+
      '<div style="display:flex;gap:10px;align-items:flex-start">'+
        '<div style="font-weight:800;color:var(--fk-text-muted);min-width:22px">'+(i+1)+'</div>'+
        '<div style="flex:1;min-width:0"><div style="font-weight:600;display:flex;align-items:center;gap:8px">'+esc(c.title)+
          (c.version>1?' '+NX.badge('v'+c.version,'info'):'')+'</div>'+
          '<div class="nx-kpi-label" style="text-transform:none;margin-top:3px;line-height:1.5">'+esc(c.body)+'</div></div>'+
        '<div style="display:flex;gap:4px;white-space:nowrap">'+
          NX.button('Edit',{variant:'ghost',size:'sm',icon:'pencil',onclick:"_daClauseModal('"+c.clause_key+"')"})+
          NX.button('',{variant:'ghost',size:'sm',icon:'trash-2',onclick:"_daRemoveClause('"+c.clause_key+"')"})+
        '</div></div></div>';
  }).join('');
  body.innerHTML=head+NX.card(rows,{});
}

function _daClauseModal(key){
  var c=key?_daClauses.find(function(x){return x.clause_key===key;}):null;
  var title=c?'Edit clause':'Add clause';
  var warn=c?'<div class="nx-kpi-label" style="text-transform:none;color:var(--fk-warning);margin-bottom:10px">Saving creates a new version — every dealer who already signed will be asked to re-accept this clause at their next login.</div>':'';
  var bodyHtml=warn+
    '<div class="nx-field" style="margin-bottom:12px"><label class="nx-label">Clause title</label>'+
      '<input id="da-c-title" class="nx-input" value="'+esc(c?c.title:'')+'" placeholder="e.g. Payment & Cash Handling"></div>'+
    '<div class="nx-field"><label class="nx-label">Clause text</label>'+
      '<textarea id="da-c-body" class="nx-input" rows="6" placeholder="Write the clause in clear, plain English…">'+esc(c?c.body:'')+'</textarea></div>'+
    '<div id="da-c-err" class="nx-kpi-label" style="text-transform:none;color:var(--fk-danger);margin-top:8px"></div>';
  var footer=NX.button('Cancel',{variant:'ghost',onclick:'_daCloseModal()'})+
    NX.button(c?'Save new version':'Add clause',{variant:'primary',onclick:"_daSaveClause("+(key?"'"+key+"'":'null')+")"});
  _daHost().innerHTML=NX.modal({title:title,size:'m',body:bodyHtml,footer:footer,onClose:'_daCloseModal()'});
}
async function _daSaveClause(key){
  var t=(document.getElementById('da-c-title').value||'').trim();
  var b=(document.getElementById('da-c-body').value||'').trim();
  var err=document.getElementById('da-c-err');
  if(!t||!b){ if(err) err.textContent='Title and text are both required.'; return; }
  try{
    var r=await supabase.rpc('upsert_agreement_clause',{p_company_id:S.cid,p_title:t,p_body:b,p_clause_key:key||null});
    if(r.error||!r.data||!r.data.success) throw (r.error||new Error((r.data&&r.data.message)||'failed'));
    _daCloseModal(); if(typeof toast==='function') toast(key?'Clause updated — dealers will re-sign':'Clause added','success');
    _daLoadClauses();
  }catch(e){ if(err) err.textContent='Could not save. '+esc(e.message||''); }
}
function _daRemoveClause(key){
  var c=_daClauses.find(function(x){return x.clause_key===key;})||{}; var title=c.title||'this clause';
  var footer=NX.button('Cancel',{variant:'ghost',onclick:'_daCloseModal()'})+
    NX.button('Remove clause',{variant:'danger',onclick:"_daDoRemove('"+key+"')"});
  _daHost().innerHTML=NX.modal({title:'Remove clause',size:'s',
    body:'<div style="line-height:1.6">Remove <b>'+esc(title)+'</b> from the agreement? Dealers will no longer be asked to sign it. Their past acceptance stays on record.</div>',
    footer:footer,onClose:'_daCloseModal()'});
}
async function _daDoRemove(key){
  try{
    var r=await supabase.rpc('deactivate_agreement_clause',{p_company_id:S.cid,p_clause_key:key});
    if(r.error||!r.data||!r.data.success) throw (r.error||new Error('failed'));
    _daCloseModal(); if(typeof toast==='function') toast('Clause removed','success'); _daLoadClauses();
  }catch(e){ if(typeof toast==='function') toast('Could not remove the clause','error'); }
}

// ── Compliance ──
async function _daLoadCompliance(){
  var body=document.getElementById('da-body'); if(!body) return;
  try{
    var r=await supabase.rpc('get_agreement_compliance',{p_company_id:S.cid});
    if(r.error||!r.data||!r.data.success) throw (r.error||new Error('failed'));
    _daComp=r.data;
  }catch(e){ body.innerHTML=NX.empty({icon:'alert-triangle',message:'Could not load compliance. '+esc(e.message||'')}); return; }
  var rows=_daComp.rows||[], total=_daComp.total_clauses||0;
  var fully=rows.filter(function(x){return x.pending===0 && !x.hold;}).length;
  var pend=rows.filter(function(x){return x.pending>0 && !x.hold;}).length;
  var held=rows.filter(function(x){return x.hold;}).length;
  var kpis='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px">'+
    NX.kpi({label:'Dealers',value:rows.length,icon:'users',tone:'primary'})+
    NX.kpi({label:'Fully signed',value:fully,icon:'check-circle',tone:'success'})+
    NX.kpi({label:'Pending signature',value:pend,icon:'clock',tone:'warning'})+
    NX.kpi({label:'On hold',value:held,icon:'alert-triangle',tone:'danger'})+
  '</div>';
  if(!rows.length){ body.innerHTML=kpis+NX.card(NX.empty({icon:'inbox',message:'No dealers yet. They appear here once they sign up or are added.'}),{}); return; }
  var thCss='padding:9px 10px;background:var(--fk-bg-subtle);border-bottom:2px solid var(--fk-border);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--fk-text-muted);text-align:left';
  var th='<tr>'+['Dealer','Status','Signed','Actions'].map(function(h){return '<th style="'+thCss+'">'+h+'</th>';}).join('')+'</tr>';
  var trs=rows.map(function(x){
    var cs='padding:9px 10px;border-bottom:1px solid var(--fk-border)';
    var status = x.hold ? NX.badge('On hold','danger') : (x.pending>0 ? NX.badge('Pending','warning') : NX.badge('Signed','success'));
    var acts='';
    if(x.hold){
      acts=NX.button('Let re-sign',{variant:'secondary',size:'sm',onclick:"_daRelease('"+x.sales_user_id+"','resign')"})+
           NX.button('Bypass',{variant:'ghost',size:'sm',onclick:"_daRelease('"+x.sales_user_id+"','bypass')"});
    }
    acts+=NX.button('Record',{variant:'ghost',size:'sm',icon:'printer',onclick:"_daViewRecord('"+x.sales_user_id+"')"});
    return '<tr><td style="'+cs+'"><div style="font-weight:600">'+esc(x.name||'')+'</div><div class="nx-kpi-label" style="text-transform:none">'+esc(x.phone||'')+(x.status==='pending'?' · awaiting approval':'')+'</div></td>'+
      '<td style="'+cs+'">'+status+'</td>'+
      '<td style="'+cs+'" class="num">'+x.signed+' / '+total+'</td>'+
      '<td style="'+cs+';white-space:nowrap"><div style="display:flex;gap:4px">'+acts+'</div></td></tr>';
  }).join('');
  body.innerHTML=kpis+NX.card('<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'+th+'</thead><tbody>'+trs+'</tbody></table></div>',{});
}
function _daRelease(suId,mode){
  var isBypass=(mode==='bypass');
  var body=isBypass
    ? '<div style="line-height:1.6">Admit this dealer <b>without</b> them personally agreeing? This is recorded as an <b>admin bypass</b> in the agreement log (the dealer did not sign).</div>'
    : '<div style="line-height:1.6">Lift the hold so this dealer is asked to read and sign the updated terms at their next login?</div>';
  var footer=NX.button('Cancel',{variant:'ghost',onclick:'_daCloseModal()'})+
    NX.button(isBypass?'Bypass & admit':'Release',{variant:isBypass?'danger':'primary',onclick:"_daDoRelease('"+suId+"','"+mode+"')"});
  _daHost().innerHTML=NX.modal({title:isBypass?'Bypass agreement':'Release hold',size:'s',body:body,footer:footer,onClose:'_daCloseModal()'});
}
async function _daDoRelease(suId,mode){
  try{
    var r=await supabase.rpc('release_agreement_hold',{p_company_id:S.cid,p_sales_user_id:suId,p_mode:mode});
    if(r.error||!r.data||!r.data.success) throw (r.error||new Error('failed'));
    _daCloseModal(); if(typeof toast==='function') toast(mode==='bypass'?'Dealer admitted (bypass recorded)':'Hold released','success');
    _daLoadCompliance();
  }catch(e){ if(typeof toast==='function') toast('Could not release the hold','error'); }
}

// ── Signed-record PDF (the dealer's copy for the file) ──
async function _daViewRecord(suId){
  if(typeof toast==='function') toast('Building signed record…','info');
  var d;
  try{ var r=await supabase.rpc('get_agent_agreement_record',{p_company_id:S.cid,p_sales_user_id:suId}); d=r.data; }
  catch(e){ if(typeof toast==='function') toast('Could not load the record','error'); return; }
  if(!d||!d.success){ if(typeof toast==='function') toast('Record not found','error'); return; }
  var ag=d.agent||{}, accs=d.acceptances||[];
  var co=(typeof S!=='undefined'&&S&&S.coName)||'Company';
  var fmt=function(iso){ if(!iso) return ''; try{ return new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return String(iso).slice(0,10); } };
  var rowsHtml=accs.map(function(a,i){
    var sig=a.bypassed?'<span style="color:#b91c1c">Admin bypass (not personally signed)</span>':('Signed by '+esc(a.signature_name||ag.name||'')+' · '+esc(a.method));
    return '<div class="cl"><div class="ct">'+(i+1)+'. '+esc(a.title)+(a.version>1?' (v'+a.version+')':'')+'</div>'+
      '<div class="cb">'+esc(a.body)+'</div>'+
      '<div class="cm">'+sig+' · '+esc(fmt(a.accepted_at))+'</div></div>';
  }).join('');
  var css='*{box-sizing:border-box}@page{size:A4;margin:14mm}body{font-family:"Inter",-apple-system,system-ui,Arial,sans-serif;color:#1e2433;font-size:11px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.hb{background:linear-gradient(100deg,#4f46e5,#6366f1);color:#fff;border-radius:11px;padding:16px 20px;margin-bottom:16px}'+
    '.hb .co{font-size:10px;opacity:.85;font-weight:600;text-transform:uppercase;letter-spacing:.04em}.hb .ti{font-size:20px;font-weight:800;margin-top:3px}'+
    '.meta{display:flex;flex-wrap:wrap;gap:6px 26px;margin-bottom:16px;font-size:11px}.meta div span{color:#8990a6}.meta div b{font-weight:700}'+
    '.cl{padding:11px 0;border-bottom:1px solid #eef0f6}.ct{font-weight:700;font-size:12px}.cb{color:#3a4054;line-height:1.55;margin:3px 0 5px}.cm{font-size:9.5px;color:#16a34a;font-weight:600}'+
    '.ft{margin-top:18px;border-top:1px solid #eceef5;padding-top:10px;font-size:9px;color:#aab0c4}';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Signed Agreement — '+esc(ag.name||'')+'</title><style>'+css+'</style></head><body>'+
    '<div class="hb"><div class="co">'+esc(co)+'</div><div class="ti">Sale Agent Agreement — Signed Record</div></div>'+
    '<div class="meta"><div><span>Dealer</span><br><b>'+esc(ag.name||'')+'</b></div>'+
      (ag.father_name?'<div><span>Father / Husband</span><br><b>'+esc(ag.father_name)+'</b></div>':'')+
      '<div><span>Mobile</span><br><b>'+esc(ag.phone||'')+'</b></div>'+
      (ag.cnic?'<div><span>CNIC</span><br><b>'+esc(ag.cnic)+'</b></div>':'')+
      '<div><span>Status</span><br><b>'+esc(ag.status||'')+(ag.hold?' · ON HOLD':'')+'</b></div></div>'+
    (accs.length?rowsHtml:'<div style="color:#8990a6">No clauses signed yet.</div>')+
    '<div class="ft">This is a digital record of the dealer\'s acceptance(s). Generated '+esc(fmt(new Date().toISOString()))+' · Nexunova RMS.</div>'+
  '</body></html>';
  if(window.NXPrint && typeof NXPrint.emit==='function') NXPrint.emit(html,'Signed Agreement'); else { var w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close(); } }
}
