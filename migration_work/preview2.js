const fs=require('fs');
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
let CAPTURED='';
global.window={};
global.fM=n=>Number(n||0).toLocaleString('en-US');
global.esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
global.td=()=>'2026-06-11'; global.toast=()=>{}; global.fD=s=>s; global.S={coName:'Fourteen Group'};
global.document={getElementById:()=>null,createElement:()=>({set textContent(v){CAPTURED=v;}}),head:{appendChild:()=>{}}};
const block=fs.readFileSync('rp2_block.txt','utf8'); eval(block);
(async()=>{
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:"select get_recovery_position('3249e3b5-c411-4f5f-ae48-0246304c9c87','7f70ba90-130e-42b5-801b-4c9bafa82975','2026-06-01','2026-06-11') as j"})});
  const res=JSON.parse(await r.text())[0].j;
  _rpInjectStyle(); // populates CAPTURED via stub
  const html=_rpRender(res,'2026-06-01','2026-06-11','Khushal Bagh Heights');
  const tokens=':root{--text:#0f172a;--t2:#334155;--t3:#64748b;--t4:#94a3b8;--line:#e6e8ec;--card:#fff;--canvas:#fff;--bg:#f8fafc;--hover:#f3f4f7}';
  const page='<!doctype html><html><head><meta charset=utf8><style>'+tokens+'body{font-family:Inter,system-ui,Arial;background:#eef2f6;margin:0;padding:24px;color:var(--text)}#r-ct{max-width:1180px;margin:0 auto;background:#f8fafc;padding:18px;border-radius:14px}.rpt-fbar{display:none}'+CAPTURED+'</style></head><body><div id=r-ct>'+html+'</div></body></html>';
  fs.writeFileSync('rp_preview.html',page);
  console.log('captured css bytes',CAPTURED.length,'-> wrote rp_preview.html');
})().catch(e=>{console.error(e);process.exit(1);});
