const fs=require('fs');
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const reports=fs.readFileSync('../js/pages/reports.js','utf8');
const printjs=fs.readFileSync('../js/pages/print.js','utf8');
function sliceBetween(src,startStr,endStr){const a=src.indexOf(startStr);const b=src.indexOf(endStr,a);if(a<0||b<0)throw new Error('slice fail '+startStr);return src.slice(a,b);}
// rp region: from _rpMonthStart to just before ACCOUNT STATEMENT helpers
const rpRegion=sliceBetween(reports,'function _rpMonthStart()','ACCOUNT STATEMENT helpers (called from').replace(/\/\/[^\n]*$/,'');
// print helpers: _pCSS.._sigBlock (stop before _printHTML)
const printHelpers=sliceBetween(printjs,'function _pCSS(','function _printHTML(');
// stubs
global.window={_cobranding:{}};
global.S={coName:'Fourteen Group of companies',name:'Rashid'};
global.fM=n=>Number(n||0).toLocaleString('en-US');
global.esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
global.td=()=>'2026-06-11';
global.toast=()=>{};
global.getCoLogo=()=>null;
global.supabase={}; global.gprojects=()=>[]; global.gproject=()=>null; global._rptGenId=0;
eval(printHelpers);
eval(rpRegion);
let captured='';
global._rpEmitPrint=window._rpEmitPrint=function(html){captured=html;};
// also need the eval'd functions to use our capturing emitter: redefine after eval
eval('_rpEmitPrint=global._rpEmitPrint;');
(async()=>{
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:"select get_recovery_position('3249e3b5-c411-4f5f-ae48-0246304c9c87','7f70ba90-130e-42b5-801b-4c9bafa82975','2026-06-01','2026-06-11') as j"})});
  const res=JSON.parse(await r.text())[0].j;
  window._rpData={res:res,from:'2026-06-01',to:'2026-06-11',projName:'Khushal Bagh Heights',periodLbl:'01-06-2026 to 11-06-2026'};
  _rpPrint();
  fs.writeFileSync('print_preview.html',captured);
  // ---- DOM-level assertions on print HTML ----
  const theadMatch=captured.match(/<thead>([\s\S]*?)<\/thead>/);
  const thead=theadMatch?theadMatch[1]:'';
  const A=[
    ['thead has S# label', /<th[^>]*>S#<\/th>/.test(thead)],
    ['thead has Net Price label', thead.indexOf('Net Price')>=0],
    ['thead has Opening/Due/Recovered/Closing', ['Opening','Due','Recovered','Closing','Paid %','Overdue'].every(x=>thead.indexOf(x)>=0)],
    ['thead th forced dark color', captured.indexOf('thead th{background:#fff!important;color:#1a1a1a')>=0],
    ['thead repeats (table-header-group)', captured.indexOf('thead{display:table-header-group}')>=0],
    ['NO rp-late tint class anywhere', captured.indexOf('rp-late')<0],
    ['rows forced white', captured.indexOf('.rp-tbl td{background:#fff!important}')>=0],
    ['KPI strip present', captured.indexOf('rp-kpis')>=0 && captured.indexOf('= Closing')>=0],
    ['risk dot before days', captured.indexOf('class="rdot"')>=0],
    ['per-page generated footer', captured.indexOf('@bottom-left{content:"Generated:')>=0],
    ['uses reliable emitter (no _printHTML)', /_rpEmitPrint\(/.test(rpRegion)],
    ['colgroup for no-clip', captured.indexOf('<colgroup>')>=0],
    ['statement + officer blocks', captured.indexOf('Rollforward Statement')>=0 && captured.indexOf('Officer Recovery Summary')>=0],
  ];
  let allpass=true; A.forEach(([k,v])=>{if(!v)allpass=false;console.log((v?'  PASS ':'  FAIL ')+k);});
  console.log(allpass?'\nALL DOM ASSERTIONS PASS':'\nSOME ASSERTIONS FAILED');
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
