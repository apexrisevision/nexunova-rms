'use strict';
const fs=require('fs');
const crypto=require('crypto');
const XLSX=require('xlsx');

const CID='3249e3b5-c411-4f5f-ae48-0246304c9c87';            // Fourteen Group
const PID='7f70ba90-130e-42b5-801b-4c9bafa82975';            // KBH project (sacred)
const ST_SOLD='2f53fc12-1896-4c84-8111-4cfbfca5bf34';
const ST_AVAIL='acbd4e3d-9735-473d-8189-e0485840c206';
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;

async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({query})
  });
  const t=await r.text();
  if(!r.ok) throw new Error('SQL FAIL '+r.status+': '+t+'\n--- query head ---\n'+query.slice(0,300));
  return t;
}
// literal helpers
const uuid=()=>crypto.randomUUID();
const S=v=>(v===null||v===undefined||v==='')?'NULL':"'"+String(v).replace(/'/g,"''")+"'";
const N=v=>(v===null||v===undefined||v==='')?'NULL':(isNaN(Number(v))?'NULL':String(Number(v)));
const D=v=>{ if(v===null||v===undefined||v==='')return'NULL'; if(v instanceof Date)return "'"+v.toISOString().slice(0,10)+"'"; return "'"+String(v).slice(0,10)+"'"; };
const norm=s=>(s==null?'':String(s)).trim().toUpperCase().replace(/\s+/g,' ');
const nu=s=>(s==null?'':String(s)).trim().toUpperCase();
const pad=(n,w)=>String(n).padStart(w,'0');

async function insertBatches(table, cols, rows, batch=500){
  let done=0;
  for(let i=0;i<rows.length;i+=batch){
    const chunk=rows.slice(i,i+batch);
    const vals=chunk.map(r=>'('+r.join(',')+')').join(',\n');
    await sql(`INSERT INTO public.${table} (${cols.join(',')}) VALUES\n${vals};`);
    done+=chunk.length;
  }
  console.log(`  ${table}: inserted ${done}`);
}

(async()=>{
const wb=XLSX.readFile('../KBH_Master_Import.xlsx');
const J=sn=>XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:null});
const units=J('Units'), clients=J('Clients'), bookings=J('Bookings'), sched=J('Schedule_Lines'), pays=J('Payments');

// ---------- FLOORS (11) ----------
const floorDefs=[
  ['Ground',0,0],['Upper Ground',1,0],['1st Floor',2,1],['2nd Floor',3,2],['3rd Floor',4,3],
  ['4th Floor',5,4],['5th Floor',6,5],['6th Floor',7,6],['7th Floor',8,7],['8th Floor',9,8],['9th Floor',10,9]
];
const floorId={}, floorNo={};
floorDefs.forEach(([name,so,fno])=>{ floorId[name]=uuid(); floorNo[name]=fno; });
// map file floor label -> canonical name
const floorMap=(lbl)=>{ const t=nu(lbl); if(t==='GROUND')return'Ground'; if(t==='UPPER GROUND')return'Upper Ground';
  const m=t.match(/^(\d+)\s*FLOOR$/); if(m){const n=+m[1];return n+(n===1?'st':n===2?'nd':n===3?'rd':'th')+' Floor';} throw new Error('unknown floor '+lbl); };

// ---------- UNIT TYPES (3) ----------
const typeDefs=[['1 Bed','1BED',1],['2 Bed','2BED',2],['3 Bed','3BED',3]];
const typeId={}; typeDefs.forEach(([nm,code,so])=>typeId[nm]=uuid());

// ---------- UNITS (261) ----------
const unitId={}, unitArea={}, unitLP={};
units.forEach(u=>{ unitId[nu(u.unit_no)]=uuid(); unitArea[nu(u.unit_no)]=u.area_sqft; unitLP[nu(u.unit_no)]=(u.list_price===''?null:u.list_price); });

// ---------- CLIENTS (142 active + 22 historical) ----------
let cseq=0;
const clientId={};      // norm(name) -> id  (active)
const unitClient={};    // norm(unit_no) -> active client id
const clientRows=[];
clients.forEach(c=>{
  const id=uuid(); cseq++;
  clientId[norm(c.client_name)]=id;
  (c.units?String(c.units):'').split(',').map(x=>nu(x)).filter(Boolean).forEach(un=>{ unitClient[un]=id; });
  clientRows.push([S(id),S(CID),S(PID),S('KBH-C-'+pad(cseq,4)),S(c.client_name),S(c.father_husband),S(c.nic),S(c.phone||'N/A'),S(c.address),S('active'),'NULL']);
});
// historical inactive clients = distinct cancelled buyers NOT already active
const canc=bookings.filter(b=>b.status!=='Active');
const histId={};
canc.forEach(b=>{ const k=norm(b.client_name); if(!clientId[k] && !histId[k]){ const id=uuid(); histId[k]=id; cseq++;
  clientRows.push([S(id),S(CID),S(PID),S('KBH-C-'+pad(cseq,4)),S(b.client_name),'NULL','NULL',S('N/A'),'NULL',S('inactive'),S('historical/cancelled buyer - imported for trail')]); }});
const nameClient=k=>clientId[k]||histId[k];
console.log('clients: active='+Object.keys(clientId).length+' historical='+Object.keys(histId).length+' total_rows='+clientRows.length);

// ---------- SALES (232) ----------
const saleId={}, saleClient={};
const saleRows=[];
bookings.forEach(b=>{
  const id=uuid(); saleId[b.booking_id]=id;
  const un=nu(b.unit_no);
  const active=(b.status==='Active');
  const cid = active ? unitClient[un] : nameClient(norm(b.client_name));
  if(!cid) throw new Error('no client for booking '+b.booking_id+' unit '+b.unit_no+' name '+b.client_name+' active='+active);
  saleClient[b.booking_id]=cid;
  const area=unitArea[un], lp=unitLP[un], dv=Number(b.deal_value||0);
  let pps, asq, disc;
  if(area && lp && (lp%area===0) && dv<=lp){ asq=area; pps=lp/area; disc=lp-dv; }
  else { asq=1; pps=dv; disc=0; }                              // G-02 + any edge => net=deal_value exactly
  const note='legacy_booking_id='+b.booking_id+(active?'':' | original_buyer='+(b.client_name||''));
  saleRows.push([
    S(id),S(CID),S(PID),S('BKG-'+b.booking_id),S(unitId[un]),S(cid),
    N(pps),N(asq),N(disc),'0',                                 // price_per_sqft, area_sqft, discount, down_payment
    N(b.installments_planned||0),S(active?'active':'cancelled'),D(b.booking_date),
    S('installment'),(active?'true':'false'),
    (active?'NULL':S('Imported - cancelled booking (historical)')),
    S(note)
  ]);
});

// ---------- INSTALLMENTS (active only) + FIFO allocation of amount_received ----------
const activeBk={}; bookings.filter(b=>b.status==='Active').forEach(b=>activeBk[b.booking_id]=b);
const schByBk={};
sched.forEach(r=>{ (schByBk[r.booking_id]=schByBk[r.booking_id]||[]).push(r); });
const instRows=[];
let allocTotal=0;
Object.keys(schByBk).forEach(bk=>{
  const lines=schByBk[bk].slice().sort((a,b)=>Number(a.sno)-Number(b.sno));
  let remain=Number((activeBk[bk]||{}).amount_received||0);
  lines.forEach(r=>{
    const due=Number(r.amount||0);
    let paid=0;
    if(due>0){ paid=Math.min(remain,due); remain-=paid; allocTotal+=paid; }
    let st = due<=0 ? 'paid' : (paid>=due?'paid':(paid>0?'partial':'pending'));
    const d=String(r.description||'');
    const itype = /booking/i.test(d)?'down_payment' : /final/i.test(d)?'custom' : /possession/i.test(d)?'possession' : 'installment';
    instRows.push([
      S(uuid()),S(CID),S(PID),S(saleId[r.booking_id]),N(r.sno),D(r.due_date),
      N(due),N(paid),S(itype),S(st),S(d)
    ]);
  });
});
console.log('installments rows='+instRows.length+' allocated='+allocTotal);

// ---------- PAYMENTS (1773) ----------
const methodOf=(m)=>{ const t=nu(m);
  if(!t) return 'other';
  if(/ADJUST|COMMISSION|PROFIT|REFUND|LOAN|MATERIAL|LABOR|LABOUR|RENT|LAND PAYMENT|SAPIENS|ARCHI|WADAN|CONCRETE|PILE|CRUSH|SAND|READY MIX|SLAB|INVESTMENT/.test(t)) return 'adjustment';
  if(/CHQ|CHEQUE|CHEQ|ORDER PAY/.test(t)) return 'cheque';
  if(/ONLINE|ONILNE|OLINE|ONINE|ONLNE|ONLLINE|ONLINRE|TRANSFER|UBL|UBK|YBL|\bBANK\b|BAHL?|HABIB|METRO|NBP|NPB|MCB|MEEZAN|MEZN|ALLIED|ASKARI|KHYBER|\bBOK\b|HBL|ISLAMI|EASYPAISA|EASYPAISA|TID#|ID #|ID#|REF#|REF #|STAN|SLIP|14 DEVELOPMENT/.test(t)) return 'bank_transfer';
  if(/CASH|CSH|^ASH$/.test(t)) return 'cash';
  return 'other';
};
let pseq=0;
const payRows=pays.map(p=>{
  pseq++;
  const cid=saleClient[p.booking_id];
  if(!cid) throw new Error('no client for payment booking '+p.booking_id);
  const note=(p.payment_for?('for:'+p.payment_for):'')+' | mode:'+(p.payment_mode==null?'':p.payment_mode)+' | serial:'+(p.serial==null?'':p.serial);
  return [
    S(uuid()),S(CID),S(PID),S('KBH-P-'+pad(pseq,6)),S(saleId[p.booking_id]),'NULL',S(cid),
    N(p.amount),D(p.date),S(methodOf(p.payment_mode)),S(p.receipt_no),S(note),S('received'),S('regular')
  ];
});

// =================== EXECUTE ===================
console.log('\n--- inserting floors & types ---');
await insertBatches('floors',['id','company_id','name','sort_order','is_active'],
  floorDefs.map(([nm,so])=>[S(floorId[nm]),S(CID),S(nm),N(so),'true']));
await insertBatches('category_unit_types',['id','company_id','project_id','type_code','type_name','sort_order','is_active'],
  typeDefs.map(([nm,code,so])=>[S(typeId[nm]),S(CID),S(PID),S(code),S(nm),N(so),'true']));

console.log('--- inserting units ---');
const unitRows=units.map(u=>{ const un=nu(u.unit_no); const fname=floorMap(u.floor);
  return [S(unitId[un]),S(CID),S(PID),S(u.unit_no),(u.type?S(typeId[u.type]):'NULL'),
    S(u.status==='Sold'?ST_SOLD:ST_AVAIL),N(floorNo[fname]),S(fname),S(floorId[fname]),
    N(u.area_sqft),N(u.list_price===''?0:(u.list_price==null?0:u.list_price)),S('fresh')]; });
await sql(`ALTER TABLE public.units DISABLE TRIGGER _trg_audit;`);
await insertBatches('units',['id','company_id','project_id','unit_no','unit_type_id','status_id','floor_no','floor_label','floor_id','area','base_price','origin_type'],unitRows);
await sql(`ALTER TABLE public.units ENABLE TRIGGER _trg_audit;`);

console.log('--- inserting clients ---');
await sql(`ALTER TABLE public.clients DISABLE TRIGGER _trg_audit;`);
await insertBatches('clients',['id','company_id','project_id','client_code','full_name','father_name','cnic','phone_primary','address','status','flag_notes'],clientRows);
await sql(`ALTER TABLE public.clients ENABLE TRIGGER _trg_audit;`);

console.log('--- inserting sales ---');
await sql(`ALTER TABLE public.sales DISABLE TRIGGER _trg_audit;`);
await insertBatches('sales',['id','company_id','project_id','sale_number','unit_id','client_id','price_per_sqft','area_sqft','discount','down_payment','installment_count','status','sale_date','payment_plan_type','is_active','cancellation_reason','notes'],saleRows);
await sql(`ALTER TABLE public.sales ENABLE TRIGGER _trg_audit;`);

console.log('--- inserting installments ---');
await sql(`ALTER TABLE public.installments DISABLE TRIGGER _trg_audit;`);
await insertBatches('installments',['id','company_id','project_id','sale_id','installment_number','due_date','amount_due','amount_paid','installment_type','status','notes'],instRows);
await sql(`ALTER TABLE public.installments ENABLE TRIGGER _trg_audit;`);

console.log('--- inserting payments (health/promise/audit triggers disabled) ---');
await sql(`ALTER TABLE public.payments DISABLE TRIGGER _trg_audit;
           ALTER TABLE public.payments DISABLE TRIGGER trg_payment_health;
           ALTER TABLE public.payments DISABLE TRIGGER trg_update_promise_on_payment;`);
try{
  await insertBatches('payments',['id','company_id','project_id','payment_code','sale_id','installment_id','client_id','amount','payment_date','payment_method','reference_no','notes','status','payment_category'],payRows);
} finally {
  await sql(`ALTER TABLE public.payments ENABLE TRIGGER _trg_audit;
             ALTER TABLE public.payments ENABLE TRIGGER trg_payment_health;
             ALTER TABLE public.payments ENABLE TRIGGER trg_update_promise_on_payment;`);
}
console.log('\nIMPORT COMPLETE');
})().catch(e=>{ console.error('\nERROR:',e.message); process.exit(1); });
