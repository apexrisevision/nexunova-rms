const fs=require('fs');
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
// stubs
global.window={};
global.fM=n=>Number(n||0).toLocaleString('en-US');
global.esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
global.td=()=>'2026-06-11';
global.toast=()=>{};
global.document={getElementById:()=>null,createElement:()=>({}),head:{appendChild:()=>{}}};
global.fD=s=>s; global.S={cid:'x',coName:'Fourteen Group'};
// load block (function declarations + window.* handlers)
const block=fs.readFileSync('rp2_block.txt','utf8');
eval(block);
(async()=>{
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',
    headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({query:"select get_recovery_position('3249e3b5-c411-4f5f-ae48-0246304c9c87','7f70ba90-130e-42b5-801b-4c9bafa82975','2026-06-01','2026-06-11') as j"})});
  const res=JSON.parse(await r.text())[0].j;
  const html=_rpRender(res,'2026-06-01','2026-06-11','Khushal Bagh Heights');
  console.log('render OK, html length',html.length);
  ['Opening Balance','Closing Balance','Recovery %','208,293,388','212,307,190','3,781,500','ZAHID','Rollforward Statement','Officer Recovery'].forEach(s=>{
    console.log((html.indexOf(s)>=0?'  ✓ contains ':'  ✗ MISSING ')+s);
  });
  // exercise filter/sort/repaint handlers (table host stub)
  let painted='';
  global.document.getElementById=(id)=>id==='rp2-tablehost'?{set innerHTML(v){painted=v;}}:(id==='rp2-count'?{textContent:''}:null);
  window._rp2Sort('opening'); window._rp2Filter && (window._rp2.filt={floor:'',type:'',risk:'red',q:''}); 
  console.log('handlers callable, sort key now', window._rp2.sort.key, 'dir', window._rp2.sort.dir);
  // write a static preview for visual check (light theme tokens)
  const page='<!doctype html><html><head><meta charset=utf8><style>:root{--text:#0f172a;--t2:#334155;--t3:#64748b;--t4:#94a3b8;--line:#e6e8ec;--card:#fff;--canvas:#fff;--bg:#f8fafc;--hover:#f5f6f8}body{font-family:Inter,system-ui,Arial;background:#f1f5f9;margin:0;padding:24px;color:var(--text)}#r-ct{max-width:1180px;margin:0 auto}</style></head><body><div id=r-ct>'+html+'</div>'
    +'<script>'+block.replace(/<\/script>/g,'<\/script>')+'<\/script></body></html>';
  fs.writeFileSync('rp_preview.html',page);
  console.log('wrote rp_preview.html');
})().catch(e=>{console.error('RENDER ERROR:',e.message);process.exit(1);});
