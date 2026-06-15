'use strict';
const fs=require('fs');
const CID='3249e3b5-c411-4f5f-ae48-0246304c9c87';
const PID='7f70ba90-130e-42b5-801b-4c9bafa82975';
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const F='2026-06-01', T='2026-06-11';

async function q(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({query})});
  const t=await r.text();
  if(!r.ok) throw new Error('SQL '+r.status+': '+t);
  return JSON.parse(t);
}
const M=n=>Number(n).toLocaleString('en-US');

(async()=>{
const inst=await q(`select i.sale_id, to_char(i.due_date,'YYYY-MM-DD') due_date, i.amount_due::float8 due, coalesce(i.installment_type,'') itype, i.installment_number num
  from installments i join sales s on s.id=i.sale_id
  where i.company_id='${CID}' and s.status='active' and s.project_id='${PID}'`);
const pay=await q(`select p.sale_id, to_char(p.payment_date,'YYYY-MM-DD') pdate, p.amount::float8 amt
  from payments p join sales s on s.id=p.sale_id
  where p.company_id='${CID}' and s.status='active' and s.project_id='${PID}' and p.status<>'cancelled'`);
const sale=await q(`select s.id, c.full_name name, c.client_code, u.unit_no, s.net_amount::float8 net
  from sales s join units u on u.id=s.unit_id join clients c on c.id=s.client_id
  where s.company_id='${CID}' and s.status='active' and s.project_id='${PID}'`);

// group
const byS={};
sale.forEach(s=>byS[s.id]={...s,inst:[],pay:[]});
inst.forEach(i=>{ if(byS[i.sale_id]) byS[i.sale_id].inst.push(i); });
pay.forEach(p=>{ if(byS[p.sale_id]) byS[p.sale_id].pay.push(p); });

function variant(useClamp){
  const G={openDP:0,openArr:0,due:0,rDP:0,rOld:0,rCur:0,rAdv:0,advBF:0,cloDP:0,cloOld:0,cloCur:0,net:0,opening:0,closing:0};
  const rowsOut=[];
  for(const id in byS){
    const s=byS[id];
    G.net+=s.net||0;
    const lines=s.inst.filter(l=>l.due_date<=T).sort((a,b)=> a.due_date<b.due_date?-1:a.due_date>b.due_date?1:(a.num-b.num));
    const P1=s.pay.filter(p=>p.pdate<F).reduce((x,p)=>x+p.amt,0);
    const P2=s.pay.filter(p=>p.pdate>=F&&p.pdate<=T).reduce((x,p)=>x+p.amt,0);
    let remPre=P1, remPer=P2;
    let openDP=0,openArr=0,advBF=0,rDP=0,rOld=0,rCur=0,due=0,cloDP=0,cloOld=0,cloCur=0,paidAll=0;
    for(const l of lines){
      const cap=useClamp?Math.max(0,l.due):l.due;
      const isDP=(l.itype==='down_payment');
      const isOld=(l.due_date<F);
      const isCur=(l.due_date>=F&&l.due_date<=T);
      if(isCur) due+=l.due;
      // phase1 pre-period
      let pPre=Math.max(0,Math.min(cap,remPre)); remPre-=pPre;
      // phase2 period
      let pPer=Math.max(0,Math.min(cap-pPre,remPer)); remPer-=pPer;
      paidAll+=pPre+pPer;
      // received classification (period money)
      if(pPer>0){ if(isDP)rDP+=pPer; else if(isOld)rOld+=pPer; else rCur+=pPer; }
      // advance b/f = pre-period money landing on period lines
      if(isCur) advBF+=pPre;
      // opening (due<F) unpaid after pre
      if(isOld||isDP&&isOld){} // placeholder
      if(l.due_date<F){ const u=l.due-pPre; if(isDP)openDP+=u; else openArr+=u; }
      // closing unpaid after all
      const uc=l.due-pPre-pPer;
      if(isDP)cloDP+=uc; else if(isOld)cloOld+=uc; else cloCur+=uc;
    }
    const rAdv=remPer; // period overflow beyond due<=T
    G.openDP+=openDP;G.openArr+=openArr;G.due+=due;G.rDP+=rDP;G.rOld+=rOld;G.rCur+=rCur;G.rAdv+=rAdv;G.advBF+=advBF;
    G.cloDP+=cloDP;G.cloOld+=cloOld;G.cloCur+=cloCur;
    G.opening+=openDP+openArr;G.closing+=cloDP+cloOld+cloCur;
    rowsOut.push({id,name:s.name,unit:s.unit_no,net:s.net,opening:openDP+openArr,due,recd:rDP+rOld+rCur,closing:cloDP+cloOld+cloCur,paidPct:s.net?+(paidAll/s.net*100).toFixed(1):0});
  }
  return {G,rowsOut};
}

const GT={opening:208293388,openDP:36594559,openArr:171698829,due:8383458,recd:3781500,rDP:2320000,rOld:1115700,rCur:28200,rAdv:317600,advBF:905756,closing:212307190,cloDP:36574559,cloOld:170583129,cloCur:5149502,net:1180442089};

for(const clamp of [false,true]){
  const {G,rowsOut}=variant(clamp);
  const recd=G.rDP+G.rOld+G.rCur+G.rAdv;
  const applied=G.rDP+G.rOld+G.rCur;
  console.log(`\n===== variant clamp=${clamp} =====`);
  const chk=(lbl,got,exp)=>{const g=Math.round(got);console.log(`  ${(g===exp?'PASS':'FAIL')}  ${lbl}: got ${M(g)}  exp ${M(exp)}${g===exp?'':'  DIFF '+M(g-exp)}`);};
  chk('Opening',G.opening,GT.opening); chk(' Opening DP',G.openDP,GT.openDP); chk(' Opening Arrears',G.openArr,GT.openArr);
  chk('Due',G.due,GT.due);
  chk('Received',recd,GT.recd); chk(' vs DP',G.rDP,GT.rDP); chk(' vs Old',G.rOld,GT.rOld); chk(' vs Current',G.rCur,GT.rCur); chk(' Advance',G.rAdv,GT.rAdv);
  chk('Advance B/F',G.advBF,GT.advBF);
  chk('Closing',G.closing,GT.closing); chk(' Closing DP',G.cloDP,GT.cloDP); chk(' Closing Old',G.cloOld,GT.cloOld); chk(' Closing Current',G.cloCur,GT.cloCur);
  chk('Net total',G.net,GT.net);
  console.log(`  identity: ${M(Math.round(G.opening+G.due-applied-G.advBF))} vs closing ${M(Math.round(G.closing))}`);
  const z=rowsOut.find(r=>/ZAHID KHAN/i.test(r.name)&&/UG-02/i.test(r.unit));
  if(z)console.log(`  ZAHID KHAN UG-02: net ${M(z.net)} paid% ${z.paidPct} (exp net 4,627,530 / 58.3)`);
}
})().catch(e=>{console.error(e.message);process.exit(1);});
