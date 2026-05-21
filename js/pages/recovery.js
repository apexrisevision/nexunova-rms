// ══ RECOVERY PAGE ═══════════════════════════════
let _rf={fr:'',to:'',type:'All',staff:'All'};

function rRec(){
  const users=(window._appUsersCache||[]);
  const staffOpts=users.map(u=>'<option value="'+esc(u.id)+'"'+(_rf.staff===u.id?' selected':'')+'>'+esc(u.name||u.fullName)+'</option>').join('');
  const mSel=(v)=>_rf.type===v?' selected':'';
  document.getElementById('pg-recovery').innerHTML=
    '<div class="ani module-financial">'+
      '<div class="ph"><div class="ph-l"><h2>Payments Ledger</h2><p>All recorded payments — cash, bank, cheques & adjustments</p></div><div class="ph-r"><button class="btn btn-gr btn-sm" onclick="nav(\'addpayment\')">+ Add Payment</button></div></div>'+
      '<div class="fbar">'+
        '<div class="fg"><label class="fl" style="font-size:10px">From</label><input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" type="date" id="rf-fr" value="'+esc(_rf.fr||'')+'" onchange="_rf.fr=this.value;rRecF()"></div>'+
        '<div class="fg"><label class="fl" style="font-size:10px">To</label><input class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" type="date" id="rf-to" value="'+esc(_rf.to||'')+'" onchange="_rf.to=this.value;rRecF()"></div>'+
        '<div class="fg"><label class="fl" style="font-size:10px">Method</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_rf.type=this.value;rRecF()">'+
          '<option value="All"'+mSel('All')+'>All Methods</option>'+
          '<option value="cash"'+mSel('cash')+'>Cash</option>'+
          '<option value="bank_transfer"'+mSel('bank_transfer')+'>Bank Transfer</option>'+
          '<option value="cheque"'+mSel('cheque')+'>Cheque / PDC</option>'+
          '<option value="adjustment"'+mSel('adjustment')+'>Adjustment</option>'+
          '<option value="online"'+mSel('online')+'>Online</option>'+
          '<option value="other"'+mSel('other')+'>Other</option>'+
        '</select></div>'+
        '<div class="fg"><label class="fl" style="font-size:10px">Staff</label><select class="inp-light" style="padding:7px 11px;border:1.5px solid var(--line);border-radius:var(--rm);font-size:12px" onchange="_rf.staff=this.value;rRecF()"><option value="All"'+(_rf.staff==='All'?' selected':'')+'>All Staff</option>'+staffOpts+'</select></div>'+
        '<div style="display:flex;align-items:flex-end;gap:6px"><button class="btn btn-g btn-sm" onclick="rRecF()">Filter</button><button class="btn btn-gh btn-sm" onclick="_rf={fr:\'\',to:\'\',type:\'All\',staff:\'All\'};rRec()">Reset</button></div>'+
      '</div>'+
      '<div id="rec-sum" style="margin-bottom:14px"><div style="padding:20px;text-align:center;color:var(--t3);font-size:12px">Loading…</div></div>'+
      '<div id="rec-pdc-sum" style="margin-bottom:14px"></div>'+
      '<div id="rec-tbl"></div>'+
    '</div>';
  rRecF();
}

async function rRecF(){
  const sum    = document.getElementById('rec-sum');
  const pdcSum = document.getElementById('rec-pdc-sum');
  const tbl    = document.getElementById('rec-tbl');
  if(!sum||!tbl)return;
  sum.innerHTML='<div style="padding:12px 16px;color:var(--t3);font-size:12px">Loading…</div>';
  if(pdcSum) pdcSum.innerHTML='';
  tbl.innerHTML='';

  // ── 1. Payments query ─────────────────────────────────────────────
  let q=supabase.from('payments')
    .select('id,sale_id,payment_date,amount,payment_method,reference_no,notes,created_by,payment_category')
    .eq('company_id',S.cid)
    .order('payment_date',{ascending:false})
    .limit(500);
  if(_rf.fr) q=q.gte('payment_date',_rf.fr);
  if(_rf.to) q=q.lte('payment_date',_rf.to);
  if(_rf.type&&_rf.type!=='All') q=q.eq('payment_method',_rf.type);
  if(_rf.staff&&_rf.staff!=='All') q=q.eq('created_by',_rf.staff);

  const {data:recs=[],error}=await q;
  if(error){
    sum.innerHTML='<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">Could not load payments</div><div class="es">'+esc(error.message)+'</div></div></div>';
    return;
  }

  // ── 2. PDC cheques query (always, regardless of method filter) ────
  let pdcQ=supabase.from('pdc_cheques')
    .select('id,sale_id,cheque_no,bank_name,amount,cheque_date,received_date,status,bounce_reason')
    .eq('company_id',S.cid)
    .order('received_date',{ascending:false});
  if(_rf.fr) pdcQ=pdcQ.gte('received_date',_rf.fr);
  if(_rf.to) pdcQ=pdcQ.lte('received_date',_rf.to);
  const {data:pdcRecs=[]}=await pdcQ;

  // ── 3. Map sale_id → unit ─────────────────────────────────────────
  const allSids=[...new Set([...recs.map(r=>r.sale_id),...pdcRecs.map(r=>r.sale_id)].filter(Boolean))];
  let smMap={};
  if(allSids.length){
    const {data:sd=[]}=await supabase.from('sales').select('id,unit_id').in('id',allSids);
    sd.forEach(s=>{smMap[s.id]=s.unit_id;});
  }

  // ── 4. Compute payment breakdown ──────────────────────────────────
  const sumBy = (method) => recs.filter(r=>r.payment_method===method).reduce((s,r)=>s+Number(r.amount||0),0);
  const cntBy = (method) => recs.filter(r=>r.payment_method===method).length;

  const totCash  = sumBy('cash');
  const totBank  = sumBy('bank_transfer') + sumBy('bank');
  const totChq   = sumBy('cheque');
  const totAdj   = sumBy('adjustment');
  const totOnl   = sumBy('online');
  const totOth   = sumBy('other');
  const totAll   = recs.reduce((s,r)=>s+Number(r.amount||0),0);

  const cntCash  = cntBy('cash');
  const cntBank  = cntBy('bank_transfer') + cntBy('bank');
  const cntChq   = cntBy('cheque');
  const cntAdj   = cntBy('adjustment');

  // ── 5. PDC breakdown from pdc_cheques ────────────────────────────
  const pdcPending   = pdcRecs.filter(c=>c.status==='pending');
  const pdcDeposited = pdcRecs.filter(c=>c.status==='deposited');
  const pdcCleared   = pdcRecs.filter(c=>c.status==='cleared');
  const pdcBounced   = pdcRecs.filter(c=>c.status==='bounced');
  const totPdcPend   = pdcPending.reduce((s,c)=>s+Number(c.amount||0),0);
  const totPdcDep    = pdcDeposited.reduce((s,c)=>s+Number(c.amount||0),0);
  const totPdcClr    = pdcCleared.reduce((s,c)=>s+Number(c.amount||0),0);
  const totPdcBnc    = pdcBounced.reduce((s,c)=>s+Number(c.amount||0),0);
  const totPdcAll    = pdcRecs.reduce((s,c)=>s+Number(c.amount||0),0);

  // ── 6. Summary grid ───────────────────────────────────────────────
  function summaryTile(icon, label, amount, count, color, highlight){
    if(!amount && !highlight) return '';
    return '<div style="flex:1;min-width:130px;padding:14px 16px;background:var(--surface);border:1px solid '+(highlight?color+'55':'var(--line)')+';border-left:4px solid '+color+';border-radius:10px">'+
      '<div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;display:flex;align-items:center;gap:4px">'+icon+label+'</div>'+
      '<div style="font-size:16px;font-weight:800;color:'+color+'">PKR '+fM(amount)+'</div>'+
      (count?'<div style="font-size:10px;color:var(--t3);margin-top:2px">'+count+' payment'+(count!==1?'s':'')+'</div>':'')+
    '</div>';
  }

  sum.innerHTML=
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px">'+
      summaryTile('<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="22" height="16" x="1" y="4" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>','Cash',totCash,cntCash,'#10b981',false)+
      summaryTile('<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>','Bank Transfer',totBank,cntBank,'#3b82f6',false)+
      summaryTile('<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>','Cheque',totChq,cntChq,'#f59e0b',false)+
      summaryTile('<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>','Adjustment',totAdj,cntAdj,'#8b5cf6',false)+
      (totOnl?summaryTile('<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>','Online',totOnl,cntBy('online'),'#6366f1',false):'')+
      (totOth?summaryTile('<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>','Other',totOth,cntBy('other'),'#94a3b8',false):'')+
      '<div style="flex:1;min-width:130px;padding:14px 16px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.25);border-left:4px solid var(--brand);border-radius:10px">'+
        '<div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;display:flex;align-items:center;gap:4px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>Total Collected</div>'+
        '<div style="font-size:18px;font-weight:800;color:var(--brand)">PKR '+fM(totAll)+'</div>'+
        '<div style="font-size:10px;color:var(--t3);margin-top:2px">'+recs.length+' payment'+(recs.length!==1?'s':'')+'</div>'+
      '</div>'+
    '</div>';

  // ── 7. PDC status panel ───────────────────────────────────────────
  if(pdcSum && pdcRecs.length > 0){
    function pdcTile(icon,label,items,amount,color,note){
      if(!items.length) return '';
      return '<div style="flex:1;min-width:150px;padding:12px 14px;background:'+color+'0d;border:1px solid '+color+'33;border-left:3px solid '+color+';border-radius:10px">'+
        '<div style="font-size:10px;font-weight:700;color:'+color+';text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:flex;align-items:center;gap:4px">'+icon+label+'</div>'+
        '<div style="font-size:15px;font-weight:800;color:var(--text)">PKR '+fM(amount)+'</div>'+
        '<div style="font-size:10px;color:var(--t3);margin-top:2px">'+items.length+' cheque'+(items.length!==1?'s':'')+(note?' · '+note:'')+'</div>'+
      '</div>';
    }
    pdcSum.innerHTML=
      '<div style="background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden">'+
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);background:rgba(245,158,11,.06)">'+
          '<svg width="16" height="16" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'+
          '<div style="flex:1">'+
            '<div style="font-size:12px;font-weight:700;color:var(--text)">PDC Cheque Breakdown</div>'+
            '<div style="font-size:11px;color:var(--t3)">'+pdcRecs.length+' cheque'+(pdcRecs.length!==1?'s':'')+' received — PKR '+fM(totPdcAll)+' total</div>'+
          '</div>'+
          (totPdcPend+totPdcDep>0?'<div style="font-size:11px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,.12);padding:4px 10px;border-radius:20px">PKR '+fM(totPdcPend+totPdcDep)+' not cleared</div>':'')+
        '</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:12px 14px">'+
          pdcTile('<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','Pending Deposit',pdcPending,totPdcPend,'#f59e0b','in hand, not deposited')+
          pdcTile('<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>','Deposited',pdcDeposited,totPdcDep,'#3b82f6','at bank, awaiting clear')+
          pdcTile('✓','Cleared',pdcCleared,totPdcClr,'#22c55e','realized in bank')+
          pdcTile('✗','Bounced',pdcBounced,totPdcBnc,'#ef4444','')+
        '</div>'+
      '</div>';
  }

  // ── 8. Detail table ───────────────────────────────────────────────
  if(!recs.length){
    tbl.innerHTML='<div class="card"><div class="empty"><div class="ei"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div><div class="et">No payments match filters</div></div></div>';
    return;
  }

  // Build a lookup: sale_id → list of PDC cheques for that sale
  const pdcBySale={};
  pdcRecs.forEach(c=>{ if(c.sale_id){ if(!pdcBySale[c.sale_id]) pdcBySale[c.sale_id]=[]; pdcBySale[c.sale_id].push(c); }});

  const rows=recs.map(r=>{
    const uid=smMap[r.sale_id]||null;
    const u=uid?gunit(uid):null;
    let pdcBadge='';
    if(r.payment_method==='cheque' && r.sale_id && pdcBySale[r.sale_id]){
      const salePdcs=pdcBySale[r.sale_id];
      const anyPend=salePdcs.some(c=>c.status==='pending'||c.status==='deposited');
      const anyClr =salePdcs.some(c=>c.status==='cleared');
      const anyBnc =salePdcs.some(c=>c.status==='bounced');
      if(anyBnc)       pdcBadge='<span style="font-size:9px;font-weight:700;background:rgba(239,68,68,.12);color:#ef4444;padding:1px 6px;border-radius:10px;border:1px solid rgba(239,68,68,.25)">PDC ✗Bounced</span>';
      else if(anyClr)  pdcBadge='<span style="font-size:9px;font-weight:700;background:rgba(34,197,94,.12);color:#22c55e;padding:1px 6px;border-radius:10px;border:1px solid rgba(34,197,94,.25)">PDC ✓Cleared</span>';
      else if(anyPend) pdcBadge='<span style="font-size:9px;font-weight:700;background:rgba(245,158,11,.12);color:#f59e0b;padding:1px 6px;border-radius:10px;border:1px solid rgba(245,158,11,.25)">PDC ⏳Pending</span>';
    }
    const navAttr=uid?'onclick="openUD(\''+esc(uid)+'\')"':'';
    return '<tr class="cr">'+
      '<td '+navAttr+'>'+fD(r.payment_date)+'</td>'+
      '<td '+navAttr+' style="font-weight:700">'+esc(u?.unitNo||'—')+'</td>'+
      '<td '+navAttr+'>'+esc(u?.customerName||'—')+'</td>'+
      '<td><div style="display:flex;flex-direction:column;gap:3px">'+pbadge(r.payment_method)+(pdcBadge?pdcBadge:'')+'</div></td>'+
      '<td style="font-size:11px;color:var(--t3)">'+esc(r.reference_no||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--t3);max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.notes||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--t3)">'+esc(gunm(r.created_by)||r.created_by||'—')+'</td>'+
      '<td class="r mono" style="font-weight:700;color:var(--ok)">+'+fM(r.amount)+'</td>'+
    '</tr>';
  }).join('');

  tbl.innerHTML=
    '<div class="card"><div class="tw"><table class="t">'+
      '<thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Method</th><th>Ref No</th><th>Notes</th><th>By</th><th class="r">Amount</th></tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
      '<tfoot><tr style="border-top:2px solid var(--line)">'+
        '<td colspan="7" style="font-size:11px;font-weight:700;color:var(--t2)">Total ('+recs.length+' payments)</td>'+
        '<td class="r mono" style="font-weight:800;font-size:14px;color:var(--ok)">PKR '+fM(totAll)+'</td>'+
      '</tr></tfoot>'+
    '</table></div></div>';
}
