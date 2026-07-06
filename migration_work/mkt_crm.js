/**
 * MARKETING CAPTURE — CRM (sales-portal.html)  ·  reusable, committed
 * ------------------------------------------------------------------
 * Serves the REAL CRM portal locally and injects genuinely-realistic demo
 * data at the sb.rpc() boundary (fake Pakistani names / plausible PKR / recent
 * dates). ZERO DB writes. Renders the real product UI at 1440@2x (desktop) and
 * 390@2x (mobile), light + dark. Re-run after CRM UI changes to refresh the
 * marketing shots.  Output: marketing_shots/rms-crm/
 *
 * Approach approved by Rashid (stub harness) in place of ZZTEST seeding.
 */
const puppeteer=require('puppeteer-core');const http=require('http');const path=require('path');const fs=require('fs');
const ROOT=path.resolve(__dirname,'..');const PORT=4290;const BASE='http://127.0.0.1:'+PORT;
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT=path.join(ROOT,'marketing_shots','rms-crm');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
function serve(){return new Promise(r=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p==='/crm'||p==='/')p='/sales-portal.html';let f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rs.writeHead(404);return rs.end();}rs.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(rs);}).listen(PORT,'127.0.0.1',()=>r(s));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const iso=(dOff,hOff=0)=>new Date(Date.now()-dOff*864e5-hOff*36e5).toISOString();

// ─────────────────────────────────────────────────────────────────────────
//  GENUINELY-REAL DEMO DATA (Pakistani names, plausible PKR, recent dates)
// ─────────────────────────────────────────────────────────────────────────
const DEALS=[
  // new
  {n:'Ahmed Raza Qureshi',src:'facebook',stage:'new',budget:9500000,ph:'0300-2841196',proj:'Sapphire Heights',intr:'2-Bed Apartment'},
  {n:'Fatima Noor',src:'instagram',stage:'new',budget:6500000,ph:'0321-4470912',proj:'Sapphire Heights',intr:'1-Bed Apartment'},
  {n:'Bilal Hussain',src:'website',stage:'new',budget:14000000,ph:'0333-9012774',proj:'Riverside Enclave',intr:'Ground-Floor Shop'},
  {n:'Zainab Malik',src:'whatsapp',stage:'new',budget:8200000,ph:'0301-7765430',proj:'Sapphire Heights',intr:'2-Bed Apartment'},
  {n:'Hassan Ali Sheikh',src:'facebook',stage:'new',budget:11000000,ph:'0345-3389201',proj:'Riverside Enclave',intr:'Office Unit'},
  {n:'Ayesha Siddiqui',src:'instagram',stage:'new',budget:null,ph:'0300-6612089',proj:'Sapphire Heights',intr:null},
  // contacted
  {n:'Usman Ghani',src:'facebook',stage:'contacted',budget:9800000,ph:'0322-1108845',proj:'Sapphire Heights',intr:'3-Bed Apartment'},
  {n:'Imran Farooq',src:'website',stage:'contacted',budget:16500000,ph:'0308-5540173',proj:'Riverside Enclave',intr:'Corner Shop'},
  {n:'Sana Tariq',src:'whatsapp',stage:'contacted',budget:7400000,ph:'0334-2290561',proj:'Sapphire Heights',intr:'1-Bed Apartment'},
  // visit
  {n:'Kamran Shah',src:'facebook',stage:'visit',budget:12500000,ph:'0300-9987120',proj:'Riverside Enclave',intr:'2-Bed Apartment'},
  {n:'Rabia Qureshi',src:'instagram',stage:'visit',budget:8900000,ph:'0345-6674301',proj:'Sapphire Heights',intr:'2-Bed Apartment'},
  // negotiation
  {n:'Fahad Iqbal',src:'website',stage:'negotiation',budget:9500000,ph:'0333-4451209',proj:'Sapphire Heights',intr:'2-Bed Apartment'},
  {n:'Mehwish Anwar',src:'facebook',stage:'negotiation',budget:13200000,ph:'0301-3320988',proj:'Riverside Enclave',intr:'Office Unit'},
  // won
  {n:'Junaid Aslam',src:'facebook',stage:'won',budget:8500000,ph:'0300-7712340',proj:'Sapphire Heights',intr:'2-Bed Apartment'},
  {n:'Danish Raza',src:'website',stage:'won',budget:10000000,ph:'0322-9987654',proj:'Riverside Enclave',intr:'Shop'},
  // lost
  {n:'Nida Yousaf',src:'instagram',stage:'lost',budget:6000000,ph:'0345-1122998',proj:'Sapphire Heights',intr:'1-Bed Apartment'},
];
const deals=DEALS.map((d,i)=>({
  id:'L'+i,deal_id:'D'+i,name:d.n,phone:d.ph,email:null,source:d.src,interest:d.intr,budget:d.budget,value:d.budget,
  status:d.stage,stage:d.stage,notes:null,unit_no:null,project_name:d.proj,owner_name:'Sara Ali',owner_sales_user_id:'ME',owner_role:'sale_rep',
  is_mine:true,created_by_me:false,checked:i>2,
  next_follow_up_at:(d.stage==='new'&&i<3)?iso(2):(d.stage==='visit'||d.stage==='negotiation')?iso(-1):null,
  last_activity_at:iso(0,i*5),created_at:iso(i+1)
}));
const counts={};deals.forEach(d=>counts[d.stage]=(counts[d.stage]||0)+1);

const COMMAND={success:true,period:'week',today:new Date().toISOString().slice(0,10),
  snapshot:{new_by_source:{facebook:6,instagram:3,whatsapp:2,website:4,manual:1},
    spark:[{d:'a',n:5},{d:'b',n:8},{d:'c',n:6},{d:'d',n:11},{d:'e',n:7},{d:'f',n:9},{d:'g',n:14}],
    followups:{done:12,pending:5,overdue:3},unassigned:4,
    unassigned_list:[{id:'u1',name:'Ayesha Siddiqui',source:'instagram',hours:22},{id:'u2',name:'Website enquiry — 2-Bed',source:'website',hours:9},{id:'u3',name:'Walk-in — Block B',source:'whatsapp',hours:4}]},
  pipeline:{new:24,contacted:18,visit:11,negotiation:6,won:9,lost:7},
  response:{company_avg_min:47,worst:[
    {id:'l1',name:'Bilal Hussain',source:'facebook',owner_name:'Sara Ali',hours:31},
    {id:'l2',name:'Ayesha Siddiqui',source:'instagram',owner_name:null,hours:22},
    {id:'l3',name:'Imran Farooq',source:'website',owner_name:'Usman Ghani',hours:14}]},
  leaderboard:[
    {id:'a1',name:'Sara Ali',role:'sale_rep',leads_received:22,followups:31,conversions:5,avg_response_min:18},
    {id:'a2',name:'Usman Ghani',role:'marketing_manager',leads_received:17,followups:20,conversions:3,avg_response_min:44},
    {id:'a3',name:'Kamran Shah',role:'sale_rep',leads_received:12,followups:14,conversions:2,avg_response_min:70},
    {id:'a4',name:'Rabia Qureshi',role:'sale_rep',leads_received:8,followups:9,conversions:1,avg_response_min:160}]};

const BRIEF_BODY="14 new leads came in yesterday — Facebook led with 6, then Website 4, Instagram 3 and WhatsApp 1. Two deals closed for ₨18,500,000 combined.\nHot: Fahad Iqbal is in negotiation on a ₨9,500,000 unit and was last touched two hours ago — worth a director nudge today.\nOverdue follow-ups: Ayesha Siddiqui (Kamran, 3 days) has slipped. Clear it this morning.\nFour leads are sitting unassigned — assign them before 11 AM so response time stays under an hour.\nToday's priority: protect the Fahad Iqbal deal and clear the overdue list.";

const BRIEF_DETAIL={success:true,title:'NexuBrief · '+new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}),created_at:iso(0,5),brief_date:new Date().toISOString().slice(0,10),source:'ai',
  yesterday:"14 new leads came in yesterday — Facebook led with 6, then Website 4, Instagram 3 and WhatsApp 1.\nTwo deals closed for ₨18,500,000 combined.\nFahad Iqbal is in negotiation on a ₨9,500,000 unit and was last touched two hours ago.\nAyesha Siddiqui (owned by Kamran) has an overdue follow-up — 3 days past due.\nFour leads remain unassigned in the open pipeline.",
  suggestions:[
    'Protect the Fahad Iqbal negotiation — lock the site visit today before the ₨9,500,000 unit cools.',
    "Reassign Ayesha Siddiqui's overdue follow-up off Kamran; he is carrying three slipped tasks this week.",
    'Distribute the four unassigned leads before 11 AM to keep first-response under an hour.']};

const ANNOUNCE={success:true,unread:2,unread_announcements:1,announcements:[
  {id:'br1',title:BRIEF_DETAIL.title,body:BRIEF_BODY.split('\n')[0],kind:'brief',priority:'normal',is_important:false,attachments:[],created_at:iso(0,5),author_name:'Your company',is_author:false,requires_ack:false,seen:false,acknowledged:false},
  {id:'a1',title:'Revised price list — Block A is live',body:'The updated price list for Block A is now in effect. Please brief your clients before Friday. Signed copy attached.',kind:'announcement',priority:'urgent',is_important:true,requires_ack:true,acknowledged:false,seen:true,is_author:true,author_name:'Yousaf Shah',created_at:iso(1),attachments:[{name:'Block-A-PriceList-Jul2026.pdf',size:184320}]},
  {id:'br0',title:'NexuBrief · '+new Date(Date.now()-864e5).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}),body:'9 new leads yesterday (Facebook 5, Website 4); one deal won.',kind:'brief',priority:'normal',is_important:false,attachments:[],created_at:iso(1,5),author_name:'Your company',is_author:false,requires_ack:false,seen:true,acknowledged:false},
  {id:'a2',title:'Team huddle — Monday 10 AM',body:'All hands in the boardroom, 10 AM sharp. Bring your pipeline numbers.',kind:'announcement',priority:'normal',is_important:false,requires_ack:false,seen:true,is_author:false,author_name:'Yousaf Shah',created_at:iso(3),attachments:[]}
]};

const RECEIPTS={success:true,received:6,read:4,acknowledged:2,people:[
  {name:'Sara Ali',role:'sale_rep',seen_at:iso(0,3),acknowledged_at:iso(0,2)},
  {name:'Usman Ghani',role:'marketing_manager',seen_at:iso(0,4),acknowledged_at:iso(0,1)},
  {name:'Kamran Shah',role:'sale_rep',seen_at:iso(0,6),acknowledged_at:null},
  {name:'Rabia Qureshi',role:'sale_rep',seen_at:iso(1,2),acknowledged_at:null},
  {name:'Junaid Aslam',role:'sale_rep',seen_at:null,acknowledged_at:null},
  {name:'Danish Raza',role:'sale_rep',seen_at:null,acknowledged_at:null}]};

function leadDetail(id){
  const d=deals.find(x=>x.id===id)||deals[11];
  return {success:true,lead:{id:d.id,name:d.name,phone:d.phone,email:null,source:d.source,interest:d.interest,budget:d.budget,status:d.status,
    notes:'Interested in a corner unit with parking. Comparing two options; wants a payment plan over 24 months.',
    unit_no:null,project_name:d.project_name,next_follow_up_at:iso(-1),owner_name:'Sara Ali',is_mine:true,assigned_from:'Usman Ghani',
    created_by_name:'Website',first_contact_at:iso(4),contact_count:5,booking:null,last_activity_at:iso(0,2),created_at:iso(6)},
  activities:[
    {id:'a1',kind:'stage',body:'Moved to Negotiation',created_at:iso(0,2)},
    {id:'a2',kind:'call',body:'Call — discussed 24-month plan, sending revised quote',created_at:iso(0,6)},
    {id:'a3',kind:'visit',body:'Site visit — viewed 2-Bed on 4th floor, liked the view',created_at:iso(1,3)},
    {id:'a4',kind:'whatsapp',body:'WhatsApp — shared floor plan & price list',created_at:iso(2,1)},
    {id:'a5',kind:'stage',body:'Moved to Contacted',created_at:iso(3)},
    {id:'a6',kind:'note',body:'Assigned from Usman Ghani to Sara Ali',created_at:iso(4)},
  ]};
}

function boot(role){
  role=role||'director';
  const isRep=role==='sale_rep';
  const prof=isRep
    ? {full_name:'Sara Ali',role:'sale_rep',company_name:'Fourteen Group of Companies',display_name:'Fourteen Group of Companies',parent_sales_user_id:'MGR',email:'sara.ali@fourteen.pk',email_verified:true}
    : {full_name:'Yousaf Shah',role:'director',company_name:'Fourteen Group of Companies',display_name:'Fourteen Group of Companies',parent_sales_user_id:null,email:'director@fourteen.pk',email_verified:true};
  return `(()=>{function sp(){const a={map:()=>[],filter:()=>[],forEach:()=>{},some:()=>false,every:()=>true,find:()=>undefined,slice:()=>[],concat:()=>[],sort:()=>[],join:()=>'',reduce:(f,i)=>i};return new Proxy(function(){},{get(o,p){if(p==='success')return true;if(p==='length')return 0;if(p==='then')return undefined;if(p===Symbol.iterator)return function*(){};if(p===Symbol.toPrimitive)return h=>h==='string'?'':0;if(typeof p==='symbol')return undefined;if(a[p])return a[p];return sp();},apply(){return sp();},ownKeys(){return[]}});}
const prof=${JSON.stringify(prof)};const isRep=${JSON.stringify(isRep)};
const deals=${JSON.stringify(deals)};const counts=${JSON.stringify(counts)};
const ov={
 get_my_profile:()=>({success:true,profile:prof}),
 get_agreement_for_session:()=>({success:true,pending:[],hold:false,is_initial:false}),
 get_my_lead_config:()=>({success:true,role:prof.role,role_label:isRep?'Sale Representative':'Director',can_have_leads:true,can_assign:!isRep,sources:['Walk-in','Call','Facebook','Instagram','WhatsApp','Website'],assigns_to_label:'team'}),
 get_my_team:()=>({success:true,team:[{id:'T1',name:'Kamran Shah',role:'sale_rep',reports:0,conversion:22,pipeline:6,won:2,sales_count:2,sales_value:17000000,outstanding:3200000,phone:'0300-9987120'},{id:'T2',name:'Rabia Qureshi',role:'sale_rep',reports:0,conversion:14,pipeline:4,won:1,sales_count:1,sales_value:8900000,outstanding:1500000,phone:'0345-6674301'},{id:'T3',name:'Usman Ghani',role:'marketing_manager',reports:3,conversion:31,pipeline:9,won:3,sales_count:3,sales_value:27500000,outstanding:4100000,phone:'0322-1108845'}],totals:{sales_value:53400000,outstanding:8800000,pipeline:19}}),
 get_my_outstanding:()=>({success:true,no_agent:false,totals:{overdue:850000,total_remaining:4200000,received:6200000,clients:5,clients_in_arrears:2},rows:[]}),
 get_my_followups:()=>({success:true,overdue:isRep?1:3,today:isRep?1:2,rows:[{id:'F1',name:'Ayesha Siddiqui',phone:'0300-6612089',bucket:'overdue',owner_name:isRep?'Sara Ali':'Kamran Shah',is_mine:isRep,next_follow_up_at:'${iso(3)}'},{id:'F2',name:'Fahad Iqbal',phone:'0333-4451209',bucket:'today',owner_name:'Sara Ali',is_mine:true,next_follow_up_at:'${iso(0)}'}]}),
 get_sales_announcements:()=>(${JSON.stringify(ANNOUNCE)}),
 list_my_projects:()=>({success:true,projects:[{id:'P1',name:'Sapphire Heights'},{id:'P2',name:'Riverside Enclave'}]}),
 get_command_center:()=>(${JSON.stringify(COMMAND)}),
 get_daily_brief:()=>({success:true,enabled:true,today:'${new Date().toISOString().slice(0,10)}',brief:{source:'ai',created_at:'${iso(0,5)}',body:${JSON.stringify(BRIEF_BODY)}},history:[]}),
 set_company_brief_pref:(a)=>({success:true,enabled:(a&&a.p_on)}),
 list_my_deals:()=>({success:true,deals:deals,counts:counts,unchecked:deals.filter(d=>!d.checked&&d.stage!=='won'&&d.stage!=='lost').length}),
 list_my_leads:()=>({success:true,leads:deals,counts:counts,unchecked:deals.filter(d=>!d.checked&&d.stage!=='won'&&d.stage!=='lost').length}),
 move_deal_stage:()=>({success:true,status:'visit'}),
 get_brief_detail:()=>(${JSON.stringify(BRIEF_DETAIL)}),
 get_announcement_receipts:()=>(${JSON.stringify(RECEIPTS)}),
 mark_announcement_seen:()=>({success:true}),
 get_sales_performance:()=>({success:true,sales:{count:isRep?3:9,value:isRep?8500000:53400000},conversion:isRep?33:37,leads:{total:isRep?18:75,new:6,contacted:isRep?4:18,visit:isRep?3:11,negotiation:isRep?2:6,won:isRep?3:9,lost:isRep?1:7},activities:{call:42,whatsapp:31,visit:14,meeting:8},lost_reasons:[]})
};
const LEADS=${JSON.stringify(deals.reduce((m,d)=>{m[d.id]=leadDetail(d.id);return m;},{}))};
ov.get_lead=(a)=>{const id=(a&&(a.p_id||a.p_lead_id))||'L11';return LEADS[id]||${JSON.stringify(leadDetail('L11'))};};
const ans=(fn,ar)=>{const h=ov[fn];return{data:h?h(ar):sp(),error:null};};let real;
Object.defineProperty(window,'supabase',{configurable:true,get(){return real;},set(v){if(v&&typeof v.createClient==='function'){const o=v.createClient.bind(v);v.createClient=(...a)=>{const c=o(...a);c.rpc=async(fn,ar)=>ans(fn,ar);return c;};}real=v;}});
try{localStorage.setItem('rms.sales.token','NX-MKT');localStorage.setItem('rms.sales.active',String(Date.now()));localStorage.setItem('nx.pwa.installed','1');sessionStorage.setItem('nx.pwa.dismissed','1');localStorage.setItem('nx.loc.enabled','1');sessionStorage.setItem('nx.loc.dismissed','1');}catch(e){}})();`;
}

async function mkPage(browser,{width,height,mobile,role}){
  const page=await browser.newPage();
  const errs=[];page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});page.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,160)));
  await page.setViewport({width,height,deviceScaleFactor:2,isMobile:!!mobile,hasTouch:!!mobile});
  await page.evaluateOnNewDocument(boot(role||'director'));
  page._errs=errs;return page;
}
async function theme(page,t){await page.evaluate(x=>{document.documentElement.setAttribute('data-theme',x);try{localStorage.setItem('rms.sales.theme',x)}catch(e){}},t);await sleep(220);}
async function shot(page,name,opt={}){await page.evaluate(()=>{try{_hideLocBar&&_hideLocBar()}catch(e){}try{document.querySelectorAll('#loc-bar,#pwa-bar').forEach(n=>n.remove())}catch(e){}});await sleep(120);await page.screenshot(Object.assign({path:path.join(OUT,name+'.png')},opt));console.log('  ✎',name+'.png');}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve();
  const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox']});
  const report={errors:{}};

  // ── DESKTOP 1440 ────────────────────────────────────────────────
  const page=await mkPage(browser,{width:1440,height:960});
  await page.goto(BASE,{waitUntil:'networkidle0'});await sleep(1100);

  // 1) Command Center (hero) L+D
  await page.evaluate(()=>{try{setTab('command')}catch(e){console.error('setTab command',e.message)}});await sleep(700);
  await theme(page,'light');await shot(page,'01_command_center_light',{fullPage:true});
  await theme(page,'dark');await shot(page,'02_command_center_dark',{fullPage:true});

  // 2) Leads pipeline + sidebar L+D
  await theme(page,'light');
  await page.evaluate(()=>{try{setTab('leads')}catch(e){console.error('setTab leads',e.message)}});await sleep(700);
  await shot(page,'03_leads_pipeline_light',{fullPage:true});
  await theme(page,'dark');await shot(page,'04_leads_pipeline_dark',{fullPage:true});

  // 3) Lead detail + activity timeline (light)
  await theme(page,'light');
  await page.evaluate(()=>{try{(window.openLead||window.openDeal||window.renderLead)('L11')}catch(e){console.error('openLead',e.message)}});await sleep(700);
  await shot(page,'05_lead_detail_timeline_light',{fullPage:true});

  // 4) NexuBrief inbox + detail (hero) L+D  — Messages / Updates tab
  await theme(page,'light');
  await page.evaluate(()=>{try{setTab('updates')}catch(e){try{setTab('messages')}catch(e2){console.error('updates',e.message)}}});await sleep(700);
  await shot(page,'06_nexubrief_inbox_light',{fullPage:true});
  await theme(page,'dark');await shot(page,'07_nexubrief_inbox_dark',{fullPage:true});
  // brief detail open
  await theme(page,'light');
  await page.evaluate(async()=>{try{await renderBriefDetail('br1')}catch(e){console.error('briefDetail',e.message)}});await sleep(600);
  await shot(page,'08_nexubrief_detail_light',{fullPage:true});
  await theme(page,'dark');await shot(page,'09_nexubrief_detail_dark',{fullPage:true});

  // 5) Announcements + read receipts (director receipts view) — light
  await theme(page,'light');
  await page.evaluate(()=>{try{setTab('updates')}catch(e){}});await sleep(400);
  await page.evaluate(async()=>{try{await loadAnnouncements()}catch(e){}try{_annOpen('a1')}catch(e){console.error('annOpen',e.message)}});await sleep(600);
  await page.evaluate(async()=>{try{await _annReceipts('a1')}catch(e){console.error('receipts',e.message)}});await sleep(700);
  await shot(page,'10_announcement_receipts_light',{fullPage:true});

  report.errors.desktop=page._errs.slice(0,8);
  await page.close();

  // ── MOBILE 390 (sale-rep — the truest daily portal home) ────────
  const m=await mkPage(browser,{width:390,height:844,mobile:true,role:'sale_rep'});
  await m.goto(BASE,{waitUntil:'networkidle0'});await sleep(1100);
  await theme(m,'light');
  await m.evaluate(()=>{try{setTab('home')}catch(e){}});await sleep(700);
  await shot(m,'11_mobile_home_light',{fullPage:true});
  await m.evaluate(()=>{try{setTab('leads')}catch(e){}});await sleep(700);
  await shot(m,'12_mobile_leads_light',{fullPage:true});
  report.errors.mobile=m._errs.slice(0,8);
  await m.close();

  fs.writeFileSync(path.join(OUT,'_crm_report.json'),JSON.stringify(report,null,1));
  console.log('\nERRORS desktop:',JSON.stringify(report.errors.desktop));
  console.log('ERRORS mobile :',JSON.stringify(report.errors.mobile));
  await browser.close();srv.close();
  console.log('\nCRM marketing shots →',OUT);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
