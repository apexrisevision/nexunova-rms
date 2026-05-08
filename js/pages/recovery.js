// ══ RECOVERY PAGE ═══════════════════════════════
// ── Recovery page state ──
let _rf={fr:'',to:'',type:'All',staff:'All'};
function rRec(){
  const db=gdb(),users=db.users.filter(u=>u.companyIds.includes(S.cid));
  const staffOpts=users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>').join('');
  document.getElementById('pg-recovery').innerHTML=
    '<div class="ani">'+
      '<div class="ph"><div class="ph-l"><h2>Payments</h2><p>All recorded payments</p></div><div class="ph-r"><button class="btn btn-gr btn-sm" onclick="openRecModal(null)">+ Add Payment</button></div></div>'+
      '<div class="fbar">'+
        '<div class="fg"><label class="fl" style="font-size:10px">From</label><input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" type="date" id="rf-fr" value="'+esc(_rf.fr||'')+'" onchange="_rf.fr=this.value;rRecF()"></div>'+
        '<div class="fg"><label class="fl" style="font-size:10px">To</label><input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" type="date" id="rf-to" value="'+esc(_rf.to||'')+'" onchange="_rf.to=this.value;rRecF()"></div>'+
        '<div class="fg"><label class="fl" style="font-size:10px">Type</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_rf.type=this.value;rRecF()"><option>All</option><option>Cash</option><option>Bank</option><option>Adjustment</option></select></div>'+
        '<div class="fg"><label class="fl" style="font-size:10px">Staff</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_rf.staff=this.value;rRecF()"><option value="All">All Staff</option>'+staffOpts+'</select></div>'+
        '<div style="display:flex;align-items:flex-end;gap:6px"><button class="btn btn-g btn-sm" onclick="rRecF()">Filter</button><button class="btn btn-gh btn-sm" onclick="_rf={fr:\'\',to:\'\',type:\'All\',staff:\'All\'};rRec()">Reset</button></div>'+
      '</div>'+
      '<div id="rec-sum" style="margin-bottom:10px"></div>'+
      '<div id="rec-tbl"></div>'+
    '</div>';
  rRecF();
}
function rRecF(){
  let recs=grecs().sort((a,b)=>b.date.localeCompare(a.date));
  if(_rf.fr)recs=recs.filter(r=>r.date>=_rf.fr);
  if(_rf.to)recs=recs.filter(r=>r.date<=_rf.to);
  if(_rf.type&&_rf.type!=='All')recs=recs.filter(r=>r.ptype===_rf.type);
  if(_rf.staff&&_rf.staff!=='All')recs=recs.filter(r=>r.by===_rf.staff);
  const total=recs.reduce((s,r)=>s+Number(r.amt),0);
  const cash=recs.filter(r=>r.ptype==='Cash').reduce((s,r)=>s+Number(r.amt),0);
  const bank=recs.filter(r=>r.ptype==='Bank').reduce((s,r)=>s+Number(r.amt),0);
  const adj=recs.filter(r=>r.ptype==='Adjustment').reduce((s,r)=>s+Number(r.amt),0);
  const isA=S.role==='admin';
  const sum=document.getElementById('rec-sum');
  if(sum){
    sum.innerHTML=
      '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);font-size:12px">'+
        '<span style="font-weight:700">'+recs.length+' payments</span>'+
        '<span style="color:var(--t3)">·</span><span class="c-g"><b>'+fM(total)+'</b> total</span>'+
        (cash?'<span style="color:var(--t3)">·</span><span>Cash: '+fM(cash)+'</span>':'')+
        (bank?'<span style="color:var(--t3)">·</span><span>Bank: '+fM(bank)+'</span>':'')+
        (adj?'<span style="color:var(--t3)">·</span><span>Adj: '+fM(adj)+'</span>':'')+
      '</div>';
  }
  const tbl=document.getElementById('rec-tbl');
  if(!tbl)return;
  if(!recs.length){tbl.innerHTML='<div class="card"><div class="empty"><div class="ei">💰</div><div class="et">No payments match filters</div></div></div>';return;}
  const rows=recs.map(r=>{
    const u=gunit(r.uid),uid=esc(r.uid),rid=esc(r.id);
    return '<tr class="cr">'+
      '<td onclick="openUD(\''+uid+'\')">'+fD(r.date)+'</td>'+
      '<td onclick="openUD(\''+uid+'\')" style="font-weight:700">'+esc(u?.unitNo||'?')+'</td>'+
      '<td onclick="openUD(\''+uid+'\')">'+esc(u?.customerName||'—')+'</td>'+
      '<td>'+pbadge(r.ptype)+'</td>'+
      '<td style="font-size:11px;color:var(--t3)">'+esc(r.rcpt||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--t3);max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.notes||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--t3)">'+esc(gunm(r.by))+'</td>'+
      '<td class="r mono c-g" style="font-weight:700">+'+fM(r.amt)+'</td>'+
      (isA?'<td><button class="btn btn-r btn-xs" onclick="delRec(\''+rid+'\')">Del</button></td>':'')+
    '</tr>';
  }).join('');
  tbl.innerHTML=
    '<div class="card"><div class="tw"><table class="t">'+
      '<thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Type</th><th>Receipt</th><th>Notes</th><th>By</th><th class="r">Amount</th>'+(isA?'<th></th>':'')+'</tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div></div>';
}
function delRec(recId){
  if(S.role!=='admin'){toast('Admin only','warn');return;}
  if(!confirm('Delete this payment? The unit balance will be adjusted.'))return;
  const db=gdb();
  const recs=db.recoveries[S.cid]||[];
  const idx=recs.findIndex(r=>r.id===recId);
  if(idx<0){toast('Payment record not found','err');return;}
  const rec=recs[idx];
  // Reverse the unit total
  const units=db.units[S.cid]||[];
  const uidx=units.findIndex(u=>u.id===rec.uid);
  if(uidx>=0){
    units[uidx].totalPaid=Math.max(0,Number(units[uidx].totalPaid||0)-Number(rec.amt));
    units[uidx].pendingAmount=Math.max(0,Number(units[uidx].totalPrice||0)-units[uidx].totalPaid);
    // Recalculate lastPaymentDate from remaining records
    const remaining=recs.filter((_,i)=>i!==idx).filter(r=>r.uid===rec.uid).sort((a,b)=>b.date.localeCompare(a.date));
    units[uidx].lastPaymentDate=remaining[0]?.date||'';
  }
  db.recoveries[S.cid].splice(idx,1);
  sdb(db);
  logA('del-rec',`Deleted payment ${fM(rec.amt)} for unit ${gunit(rec.uid)?.unitNo||rec.uid}`);
  toast('Payment deleted — balance updated','ok');
  const ap=document.querySelector('.pg.on')?.id?.replace('pg-','');if(ap)nav(ap);else rRec();
  buildSB();
}

