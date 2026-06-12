// ══ ADMIN / SETTINGS PAGE ═════════════════════════════════════════════
// Phase-3 ADMIN batch: hub + sections rebuilt onto the nx- foundation kit
// (warmth v2 — segmented tabs, header icon-chips, lean fields). All RPCs and
// settings logic are UNCHANGED; only the presentation layer was migrated.
//
// Sidebar pages own Users, Audit, Backup — so this hub keeps only genuine
// admin-config sections (Settings · Company · Security · Plan · Import).
const _ADM_TABS = [
  { k:'settings', label:'Settings', icon:'settings' },
  { k:'profile',  label:'Company',  icon:'building-2' },
  { k:'security', label:'Security', icon:'shield' },
  { k:'plan',     label:'Plan & usage', icon:'credit-card' },
  { k:'import',   label:'Import',   icon:'upload' },
];

function rAdmin(){
  if(S.role!=='admin' && S.role!=='owner'){nav('dashboard');return;}
  // Reset to Settings if _at is unset or points at a removed/redirect-only tab.
  if(!_at || ['users','audit','data','log'].includes(_at)) _at='settings';

  document.getElementById('pg-admin').innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Settings', '', { icon:'settings', sub:'Company configuration, security, and subscription' }) +
      '<div id="adm-tabs" style="margin-bottom:var(--fk-sp-4)">' + _admTabsHtml() + '</div>' +
      '<div id="a-ct"></div>' +
    '</div>';
  rAT();
}
function _admTabsHtml(){
  return NX.tabs({ tabs:_ADM_TABS, active:_at, onSelect:"setAT('%k')" });
}
function setAT(t){
  _at=t;
  const tb=document.getElementById('adm-tabs'); if(tb) tb.innerHTML=_admTabsHtml();
  rAT();
}
function rAT(){
  const ct=document.getElementById('a-ct');if(!ct)return;
  const db=gdb();
  if(_at==='users'){
    nav('users');
    return;
  } else if(_at==='import'){
    const body =
      '<p style="font-size:var(--fk-fs-body);color:var(--fk-text-muted);margin:0 0 var(--fk-sp-4);line-height:1.6">Import your Excel recovery sheet. Units, clients, prices, and pending amounts are read automatically. <b style="color:var(--fk-text)">Existing unit data will be replaced.</b></p>' +
      '<div class="iz" onclick="document.getElementById(\'xl-f\').click()" ondragover="event.preventDefault();this.classList.add(\'dg\')" ondragleave="this.classList.remove(\'dg\')" ondrop="hDrop(event)" style="border:1.5px dashed var(--fk-border);border-radius:var(--fk-radius-card);padding:28px;text-align:center;cursor:pointer">' +
        '<div style="display:flex;justify-content:center;margin-bottom:8px">' + NX.ichip('upload','',{size:'lg'}) + '</div>' +
        '<div style="font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text)">Click to select Excel file (.xlsx)</div>' +
        '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:2px">Or drag and drop your Nexunova Recovery Sheet</div>' +
      '</div>' +
      '<input id="xl-f" type="file" accept=".xlsx,.xls" style="display:none" onchange="readXL(this)">' +
      '<div id="xl-prv" style="margin-top:14px"></div>' +
      '<div id="xl-act" style="margin-top:12px;display:none">' + NX.button('Import & replace unit data', { variant:'primary', icon:'check', onclick:'doImport()' }) + '</div>' +
      '<div style="margin-top:16px">' + NX.banner('Already imported: ' + (db.units[S.cid]?.length||0) + ' units loaded from Excel. Import again only if data has changed.', 'info') + '</div>';
    ct.innerHTML = NX.card(body, { header:{ icon:'upload', title:'Import Excel', sub:'Bulk import units & clients' } });
  } else if(_at==='data'){
    ct.innerHTML=`<div class="card"><div class="cb" style="display:flex;flex-direction:column;gap:10px;max-width:320px">
      <p style="font-size:12px;color:var(--t3)">Backup and restore all system data</p>
      <button class="btn btn-d" onclick="bkpData()">⬇ Download Backup File</button>
      <button class="btn btn-gh" onclick="rstData()">⬆ Restore from Backup</button>
      <button class="btn btn-r" style="margin-top:6px" onclick="rstSeed()">Reset to Original Excel Data</button>
    </div></div>`;
  } else if(_at==='log'){
    // Task 5: Activity Log viewer
    const logs=(db.log||[]).slice(0,100);
    const typeClr={rec:'var(--ok)',con:'var(--info)',sell:'var(--brand)','del-rec':'var(--err)'};
    ct.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700">Last ${logs.length} activities</div>
      ${S.role==='admin'?`<button class="btn btn-r btn-sm" onclick="clearLog()">Clear Log</button>`:''}
    </div>
    <div class="card"><div class="tw"><table class="t"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>
    ${!logs.length?'<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:24px">No activity recorded yet</td></tr>':
      logs.map(l=>{
        const clr=typeClr[l.type]||'var(--t3)';
        const ts=l.time?new Date(l.time).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
        return `<tr style="border-left:3px solid ${clr}"><td style="font-size:11px;color:var(--t3);white-space:nowrap">${ts}</td><td style="font-size:12px;font-weight:600">${esc(l.user||'?')}</td><td><span class="badge" style="background:${clr}22;color:${clr}">${l.type||'?'}</span></td><td style="font-size:12px;color:var(--t2);max-width:300px;word-break:break-word">${esc(l.msg||'—')}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>`;
  } else if(_at==='profile'){
    if(typeof rBranding==='function') rBranding(ct);
    else _adminLoadProfile(ct);
    return;
  } else if(_at==='plan'){
    _adminLoadPlan(ct);
    return;
  } else if(_at==='audit'){
    nav('audit');
    return;
  } else if(_at==='settings'){
    _adminLoadSettings(ct);
    return;
  } else if(_at==='security'){
    _adminLoadSecurity(ct);
    return;
  }
}
function clearLog(){
  if(!confirm('Clear all activity logs? This cannot be undone.'))return;
  const db=gdb();db.log=[];sdb(db);toast('Activity log cleared','ok');rAT();
}
async function saveSettings(){
  if (typeof demoGuard === 'function' && demoGuard('Save Settings')) return;
  const od=parseInt(document.getElementById('set-od')?.value)||30;
  localStorage.setItem('rms_od_'+S.cid, od);
  const mtgt = parseAmt(document.getElementById('set-mtgt')?.value||'0');
  const atgt = parseAmt(document.getElementById('set-atgt')?.value||'0');
  try {
    await supabase.rpc('save_company_targets', { p_company_id: S.cid, p_monthly: mtgt, p_annual: atgt });
  } catch(e) { console.warn('save_company_targets:', e.message); }
  toast('Settings saved','ok');
}
function bkpData(){const db=gdb();const j=JSON.stringify({data:db,at:new Date().toISOString(),v:'v5'});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([j],{type:'application/json'}));a.download=`Nexunova_backup_${td()}.json`;a.click();toast('Backup downloaded','ok');}
function rstData(){const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const bk=JSON.parse(ev.target.result);const d=bk.data||bk;if(!d.users)throw new Error();localStorage.setItem(STORE,JSON.stringify(d));toast('Data restored!','ok');setTimeout(()=>location.reload(),900);}catch{toast('Invalid backup file','err');}};r.readAsText(f);};document.body.appendChild(inp);inp.click();document.body.removeChild(inp);}
function rstSeed(){if(!confirm('Reset all data to original Excel import? All added payments and call logs will be lost.'))return;localStorage.removeItem(STORE);localStorage.removeItem(OLD_STORE);toast('Data reset','warn');setTimeout(()=>location.reload(),900);}

// ══ EXCEL IMPORT ══════════════════════════════
function readXL(inp){
  const f=inp.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      if(typeof XLSX==='undefined'){toast('SheetJS not loaded — use online','warn');return;}
      const wb=XLSX.read(e.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      let hr=-1;
      for(let i=0;i<raw.length;i++){const r=raw[i].map(v=>String(v).toUpperCase());if(r.some(v=>v.includes('UNIT #')||v.includes('CLIENT NAME'))){hr=i;break;}}
      if(hr<0){toast('Cannot find data in file','err');return;}
      const hdrs=raw[hr];
      const getv=(names)=>{for(const nm of names){const idx=hdrs.findIndex(h=>String(h).toUpperCase().includes(nm.toUpperCase()));if(idx>=0&&raw[0][idx]!==undefined&&raw[0][idx]!=='')return undefined;}};
      const get=(r,names)=>{for(const nm of names){const idx=hdrs.findIndex(h=>String(h).toUpperCase().includes(nm.toUpperCase()));if(idx>=0&&r[idx]!==undefined&&String(r[idx])!=='')return r[idx];}return '';};
      const fl_map={'G':'Ground Floor','UG':'Lower Ground','1':'1st Floor','2':'2nd Floor','3':'3rd Floor','4':'4th Floor','5':'5th Floor','6':'6th Floor','7':'7th Floor','8':'8th Floor','9':'9th Floor'};
      const tp_map={'SHOP':'Shop','1 BED':'1 Bed','2 BED':'2 Bed','3 BED':'3 Bed','PARK 2 BED':'Park 2 Bed','PARK 3 BED':'Park 3 Bed'};
      const units=[];
      for(let i=hr+1;i<raw.length;i++){
        const r=raw[i];
        const unitNo=String(get(r,['UNIT #','UNIT#'])||'').trim();
        const floor=String(get(r,['FLOOR'])||'').trim();
        if(!unitNo||!floor||unitNo==='D'||floor==='D')continue;
        const client=String(get(r,['CLIENT NAME'])||'').trim();
        const price=parseFloat(get(r,['FINAL PRICE'])||0)||0;
        const pendency=parseFloat(get(r,['PENDENCY AMOUNT','PENDENCY AFTER'])||0)||0;
        const type=String(get(r,['TYPE'])||'').trim();
        const area=parseFloat(get(r,['AREA'])||0)||0;
        const booking=String(get(r,['BOOKING #','BOOKING#'])||'').trim();
        const phone=String(get(r,['CONTACT #','CONTACT#'])||'').trim();
        const sp=String(get(r,['C/O','SALE PERSON','SOLD BY'])||'').trim();
        const remarks=String(get(r,['REMARKS'])||'').trim();
        const hasC=!!(client&&client!=='0'&&price>0);
        let status='Available';
        if(hasC){if(remarks.toUpperCase().includes('ADJUSTMENT'))status='Adjustment';else if(remarks.toUpperCase().includes('CASH DEAL')||remarks.toUpperCase().includes('FULLY PAID'))status='CashSale';else status='Installment';}
        units.push({id:'ui'+uid(),unitNo,floor,floorLabel:fl_map[floor]||floor,type:tp_map[type.toUpperCase()]||type,area,bookingNo:booking!=='nan'?booking:'',status,customerName:hasC?client:'',phone:phone!=='nan'&&phone!=='0'?phone:'',totalPrice:hasC?price:0,totalPaid:hasC?Math.max(0,price-Math.max(0,pendency)):0,pendingAmount:hasC?Math.max(0,pendency):0,soldBy:sp!=='nan'?sp:'',remarks:remarks!=='nan'?remarks:'',receiptNo:'',lastPaymentDate:'',soldDate:'',companyId:S.cid});
      }
      _xlrows=units;
      const sold=units.filter(u=>u.status!=='Available').length;
      const prv=document.getElementById('xl-prv');if(prv)prv.innerHTML=`<div style="background:var(--ok-bg);border-radius:var(--rs);padding:12px;font-size:13px;color:var(--ok)"><b>${units.length} units</b> found — ${sold} sold, ${units.length-sold} available</div>`;
      const act=document.getElementById('xl-act');if(act)act.style.display='block';
    }catch(err){toast('Error: '+err.message,'err');}
  };
  reader.readAsArrayBuffer(f);
}
function hDrop(e){e.preventDefault();document.querySelector('.iz')?.classList.remove('dg');const f=e.dataTransfer.files[0];if(f){const fi={files:[f]};readXL(fi);}}
function doImport(){
  if(!_xlrows.length){toast('No data to import','warn');return;}
  if(!confirm(`Import ${_xlrows.length} units? This replaces existing unit data.`))return;
  const db=gdb();const cnt=_xlrows.length;db.units[S.cid]=_xlrows;sdb(db);_xlrows=[];
  toast(`${cnt} units imported successfully!`,'ok');nav('dashboard');
}

// ══ LOGO UPLOAD ═══════════════════════════════
function uploadCoLogo(inp){
  const f=inp.files[0];
  if(!f)return;
  if(f.type!=='image/png'){toast('PNG files only','err');inp.value='';return;}
  if(f.size>2*1024*1024){toast('Max size is 2 MB','err');inp.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const maxW=300,maxH=120;
      let w=img.width,h=img.height;
      if(w>maxW||h>maxH){const sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      const logo=canvas.toDataURL('image/png',0.8);
      localStorage.setItem('rms_logo_'+S.cid, logo);
      const wrap=document.getElementById('logo-prev-wrap');
      if(wrap)wrap.innerHTML=`<img src="${logo}" style="max-height:60px;max-width:180px;object-fit:contain">`;
      if(typeof updateCoLogo==='function')updateCoLogo();
      toast('Logo saved!','ok');
      inp.value='';
      setTimeout(()=>rAT(),120);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(f);
}

function removeCoLogo(){
  if(!confirm('Remove company logo?'))return;
  localStorage.removeItem('rms_logo_'+S.cid);
  if(typeof updateCoLogo==='function')updateCoLogo();
  toast('Logo removed','ok');
  rAT();
}

// ── Settings ──────────────────────────────────────────────────────

async function _adminLoadSettings(ct) {
  const existLogo = localStorage.getItem('rms_logo_'+S.cid) || null;
  const od = parseInt(localStorage.getItem('rms_od_'+S.cid)) || 30;
  let monthTgt = 0, annualTgt = 0;
  try {
    const { data: tgt } = await supabase.rpc('get_company_targets', { p_company_id: S.cid });
    if (tgt) { monthTgt = Number(tgt.monthly_target||0); annualTgt = Number(tgt.annual_target||0); }
  } catch(_) {}

  const logoCard = NX.card(
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:0 0 10px;line-height:1.6">Appears in the sidebar, topbar, and all printed documents.</p>' +
    '<div id="logo-prev-wrap" style="margin-bottom:10px;padding:12px;background:var(--fk-bg-subtle);border:1.5px dashed var(--fk-border);border-radius:var(--fk-radius-control);min-height:64px;display:flex;align-items:center;justify-content:center">' +
      (existLogo ? `<img src="${existLogo}" style="max-height:60px;max-width:180px;object-fit:contain">`
                 : '<span style="font-size:var(--fk-fs-label);color:var(--fk-text-muted)">No logo uploaded</span>') +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      NX.button('Upload PNG logo', { variant:'secondary', size:'sm', icon:'upload', onclick:"document.getElementById('logo-inp').click()" }) +
      (existLogo ? NX.button('Remove logo', { variant:'danger-soft', size:'sm', onclick:'removeCoLogo()' }) : '') +
      '<input type="file" id="logo-inp" accept=".png" style="display:none" onchange="uploadCoLogo(this)">' +
    '</div>' +
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:8px 0 0;line-height:1.5">PNG with transparent background recommended — use <b>remove.bg</b> for free background removal — max 2MB (auto-compressed).</p>',
    { header:{ icon:'image', title:'Company logo' } });

  const prefsCard = NX.card(
    '<div class="nx-field"><label class="nx-label">Overdue threshold (days)</label>' +
      '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-bottom:6px">Units with no payment for this many days are marked overdue.</div>' +
      `<input id="set-od" class="nx-input" type="number" min="1" max="365" value="${od}"></div>` +
    '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">Recovery targets</label>' +
      '<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-bottom:8px">Show target vs actual progress on the dashboard. Leave 0 to disable.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        `<div><label class="nx-label">Monthly target (PKR)</label><input id="set-mtgt" class="nx-input inp-amt num" value="${monthTgt||0}"></div>` +
        `<div><label class="nx-label">Annual target (PKR)</label><input id="set-atgt" class="nx-input inp-amt num" value="${annualTgt||0}"></div>` +
      '</div></div>',
    { header:{ icon:'settings', title:'Preferences', sub:'Overdue rule & recovery targets' } });

  const wizardCard = NX.card(
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:0 0 12px;line-height:1.55">Re-run the 6-step setup wizard anytime to add more sites or users, or to tweak company profile, branding, or business rules.</p>' +
    NX.button('Re-run setup wizard', { variant:'secondary', size:'sm', icon:'settings', onclick:"if(typeof OB!=='undefined' && S&&S.cid) OB.show(S.cid); else toast('Wizard not available','err');" }),
    { header:{ icon:'sunrise', title:'Setup wizard' } });

  ct.innerHTML =
    '<div style="max-width:560px;display:flex;flex-direction:column;gap:var(--fk-sp-4)">' +
      logoCard + prefsCard + wizardCard +
      '<div>' + NX.button('Save settings', { variant:'primary', onclick:'saveSettings()' }) + '</div>' +
    '</div>';
}

// ── Company Profile (Supabase) ────────────────────────────────────

async function _adminLoadProfile(ct) {
  ct.innerHTML = NX.card(NX.empty({ icon:'building-2', message:'Loading…' }));
  try {
    const { data, error } = await supabase.rpc('get_company_profile', { p_company_id: S.cid });
    if (error) throw error;
    const typeOpts = ['real_estate','housing_society','property_management','real_estate_agency','developer','builder','construction','marketing','rental','mixed','other']
      .map(t => `<option value="${t}" ${data.company_type===t?'selected':''}>${t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('');
    const coCode = (S && S.coCode) ? S.coCode : '—';

    const handleCard = NX.card(
      '<div class="nx-field" style="margin-bottom:0"><label class="nx-label">Company code</label>' +
        `<input class="nx-input num" value="${esc(coCode)}" readonly style="background:var(--fk-bg-subtle);max-width:220px;text-transform:uppercase;letter-spacing:.05em">` +
        '<div class="nx-error" style="color:var(--fk-text-muted)">This is your login handle — staff sign in with <b>username@' + esc(coCode) + '</b>. It can’t be changed.</div></div>',
      { header:{ icon:'key', title:'Login handle', sub:'How your team signs in' } });

    const profileCard = NX.card(
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--fk-sp-3)">' +
        `<div><label class="nx-label">Company name <span class="nx-req">*</span></label><input id="cp-name" class="nx-input" value="${esc(data.company_name||'')}"></div>` +
        `<div><label class="nx-label">Company type</label><select id="cp-type" class="nx-select">${typeOpts}</select></div>` +
        `<div><label class="nx-label">Business email</label><input id="cp-email" class="nx-input" type="email" value="${esc(data.business_email||'')}"></div>` +
        `<div><label class="nx-label">Business phone</label><input id="cp-phone" class="nx-input" type="tel" value="${esc(data.business_phone||'')}"></div>` +
        `<div><label class="nx-label">City</label><input id="cp-city" class="nx-input" value="${esc(data.city||'')}"></div>` +
        `<div><label class="nx-label">Country</label><input id="cp-country" class="nx-input" value="${esc(data.country||'Pakistan')}"></div>` +
      '</div>' +
      '<div class="nx-field" style="margin:var(--fk-sp-3) 0 0"><label class="nx-label">Address</label>' +
        `<textarea id="cp-address" class="nx-textarea" rows="2">${esc(data.address||'')}</textarea></div>`,
      { header:{ icon:'building-2', title:'Company profile' } });

    ct.innerHTML =
      '<div style="max-width:560px;display:flex;flex-direction:column;gap:var(--fk-sp-4)">' +
        handleCard + profileCard +
        '<div>' + NX.button('Save company profile', { variant:'primary', attrs:'id="cp-save-btn"', onclick:'saveCoProfile()' }) + '</div>' +
      '</div>';
  } catch (e) {
    ct.innerHTML = NX.card(NX.banner('Could not load profile: ' + (e.message || e), 'danger'));
  }
}

async function saveCoProfile() {
  const name = document.getElementById('cp-name')?.value?.trim();
  if (!name) { toast('Company name is required', 'warn'); return; }
  const btn = document.getElementById('cp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const { error } = await supabase.rpc('update_company_profile', {
      p_company_id: S.cid,
      p_data: {
        company_name:   name,
        company_type:   document.getElementById('cp-type')?.value   || 'real_estate',
        business_email: document.getElementById('cp-email')?.value?.trim()   || null,
        business_phone: document.getElementById('cp-phone')?.value?.trim()   || null,
        city:           document.getElementById('cp-city')?.value?.trim()    || null,
        country:        document.getElementById('cp-country')?.value?.trim() || 'Pakistan',
        address:        document.getElementById('cp-address')?.value?.trim() || null,
      }
    });
    if (error) throw error;
    S.coName = name;
    sessionStorage.setItem('nxn_sess', JSON.stringify(S));
    const sbCo = document.getElementById('sb-co'); if (sbCo) sbCo.textContent = name;
    toast('Company profile saved', 'ok');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Company Profile'; }
  }
}

// ── Plan & Usage (Supabase) ───────────────────────────────────────

async function _adminLoadPlan(ct) {
  ct.innerHTML = NX.card(NX.empty({ icon:'credit-card', message:'Loading plan…' }));
  try {
    const { data: usage } = await supabase.rpc('get_plan_usage_admin', { p_company_id: S.cid });
    const sub  = usage || {};
    const plan = sub.subscription_plans || {};
    const cnts = [Number(usage?.count_units||0), Number(usage?.count_projects||0), Number(usage?.count_users||0)];
    const maxes= [plan.max_units||0, plan.max_projects||0, plan.max_users||0];
    const lbls = ['Units','Projects','Users'];
    const statusTone = { trialing:'warning', active:'success', past_due:'danger', cancelled:'', expired:'', pending_payment:'warning' }[sub.status] || '';

    const usageKpis = lbls.map((l,i) => {
      const max = maxes[i];
      const pct = max ? Math.min(100, Math.round(cnts[i]/max*100)) : 0;
      const tone = pct > 85 ? 'danger' : 'primary';
      return NX.kpi({ label:l, value:`${cnts[i]} <span style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);font-weight:400">/ ${max||'∞'}</span>`, dot:tone });
    }).join('');

    let periodInfo = '';
    if (sub.current_period_end) periodInfo += `<div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted)">Period ends: <b style="color:var(--fk-text)">${fD(sub.current_period_end.split('T')[0])}</b></div>`;
    if (sub.trial_ends_at) {
      const dLeft = Math.ceil((new Date(sub.trial_ends_at) - Date.now()) / 86400000);
      const tcol = dLeft <= 3 ? 'var(--fk-danger)' : 'var(--fk-warning)';
      const msg = dLeft <= 0 ? 'Trial expired' : `Trial ends in <b>${dLeft} day${dLeft===1?'':'s'}</b> (${fD(sub.trial_ends_at.split('T')[0])})`;
      periodInfo += `<div style="font-size:var(--fk-fs-label);color:${tcol};margin-top:4px">${msg}</div>`;
    }

    const upgradeForm =
      '<div id="admin-upgrade-form" style="display:none;margin-top:14px;padding:14px;background:var(--fk-bg-subtle);border:1px solid var(--fk-border);border-radius:var(--fk-radius-control)">' +
        '<div style="font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold);color:var(--fk-text);margin-bottom:10px">Upgrade request</div>' +
        '<div class="nx-field"><label class="nx-label">Desired plan</label><select id="au-plan" class="nx-select">' +
          '<option value="Starter">Starter</option><option value="Growth" selected>Growth</option>' +
          '<option value="Professional">Professional</option><option value="Enterprise">Enterprise</option></select></div>' +
        '<div class="nx-field"><label class="nx-label">Message (optional)</label><textarea id="au-msg" class="nx-textarea" rows="2" placeholder="Any specific requirements or questions…"></textarea></div>' +
        '<div class="nx-error" id="au-err"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">' +
          NX.button('Cancel', { variant:'ghost', size:'sm', onclick:"document.getElementById('admin-upgrade-form').style.display='none'" }) +
          NX.button('Send request', { variant:'primary', size:'sm', attrs:'id="au-submit-btn"', onclick:'_adminSubmitUpgrade()' }) +
        '</div>' +
      '</div>';

    const body =
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap">' +
        '<div><div style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);text-transform:uppercase;letter-spacing:var(--fk-tracking-label);font-weight:var(--fk-fw-semibold)">Current plan</div>' +
          `<div style="font-size:var(--fk-fs-page);font-weight:var(--fk-fw-bold);color:var(--fk-primary)">${esc(plan.plan_name||S.planCode||'—')}</div></div>` +
        NX.badge((sub.status||'unknown').replace(/_/g,' '), statusTone) +
        (plan.price ? `<span style="font-size:var(--fk-fs-label);color:var(--fk-text-muted)">${plan.currency||'PKR'} ${fM(plan.price)} / ${sub.billing_cycle||'mo'}</span>` : '') +
      '</div>' +
      `<div class="nx-kpi-row" style="margin-bottom:18px">${usageKpis}</div>` +
      periodInfo +
      '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">' +
        NX.button('Request upgrade', { variant:'primary', size:'sm', icon:'trending-up', onclick:'_adminOpenUpgradeRequest()' }) +
        NX.button('Email sales', { variant:'secondary', size:'sm', onclick:"window.location.href='mailto:sales@nexunova.com'" }) +
      '</div>' +
      upgradeForm;

    ct.innerHTML = NX.card(body, { header:{ icon:'credit-card', title:'Plan & usage', sub:'Subscription and account limits' } });
  } catch (e) {
    ct.innerHTML = NX.card(NX.banner('Could not load plan: ' + (e.message || e), 'danger'));
  }
}

function _adminOpenUpgradeRequest() {
  const form = document.getElementById('admin-upgrade-form');
  if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function _adminSubmitUpgrade() {
  const plan = document.getElementById('au-plan')?.value || 'Growth';
  const msg  = document.getElementById('au-msg')?.value  || '';
  const btn  = document.getElementById('au-submit-btn');
  const err  = document.getElementById('au-err');
  if (err)  err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const { data, error } = await supabase.rpc('create_sa_support_ticket', {
      p_data: {
        company_id:   S.cid,
        company_name: S.company || '',
        submitted_by: S.name || S.username || '',
        subject:      `Upgrade Request — ${plan} Plan`,
        body:         `Company: ${S.company || ''}\nUser: ${S.name||S.username||''}\nDesired Plan: ${plan}\n\n${msg}`.trim(),
        category:     'billing',
        priority:     'high'
      }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed');
    toast('Upgrade request sent — we will contact you shortly', 'ok');
    const form = document.getElementById('admin-upgrade-form');
    if (form) form.style.display = 'none';
  } catch(e) {
    if (err) err.textContent = e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Request'; }
  }
}

// ── Supabase Audit Trail ──────────────────────────────────────────

async function _adminLoadAudit(ct) {
  ct.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px 0">⏳ Loading audit trail…</div>';
  try {
    const { data: feed } = await supabase.rpc('get_admin_audit_feed', { p_company_id: S.cid, p_limit: 80 });
    const entries = [
      ...((feed?.transfers)||[]).map(r  => ({ts:r.created_at, icon:'', type:'Transfer',  desc:`Unit ${r.units?.unit_no||'—'} — ${r.from_owner} → ${r.to_owner}`, by:r.created_by})),
      ...((feed?.reminders)||[]).map(r => ({ts:r.sent_at,    icon:'', type:'Reminder',  desc:`${(r.reminder_type||'').toUpperCase()} to ${r.client_name||'—'} · PKR ${fM(r.amount_due||0)}`, by:r.sent_by})),
      ...((feed?.possessions)||[]).map(r => ({ts:r.updated_at, icon:'', type:'Possession',desc:`Unit ${r.units?.unit_no||'—'} — ${r.status} · ${r.client_name||'—'}`, by:r.created_by})),
    ].sort((a,b) => (b.ts||'').localeCompare(a.ts||'')).slice(0, 80);

    const typeColor = {'Transfer':'#6C63FF','Reminder':'#f59e0b','Possession':'#22c55e'};
    const rows = entries.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:28px">No Supabase events found yet</td></tr>'
      : entries.map(e => {
          const ts  = e.ts ? new Date(e.ts).toLocaleString('en-PK',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
          const col = typeColor[e.type] || 'var(--t3)';
          return `<tr><td style="font-size:11px;color:var(--t3);white-space:nowrap">${ts}</td>
            <td><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${col}18;color:${col}">${e.type}</span></td>
            <td style="font-size:12px;color:var(--t2);max-width:300px;word-break:break-word">${esc(e.desc)}</td>
            <td style="font-size:11px;color:var(--t3)">${esc(e.by||'—')}</td></tr>`;
        }).join('');
    ct.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--t3)">Last ${entries.length} events · Transfers, Reminders, Possessions</div>
      <button class="btn btn-gh btn-sm" onclick="_adminLoadAudit(document.getElementById('a-ct'))">↺ Refresh</button>
    </div>
    <div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Time</th><th>Type</th><th>Details</th><th>By</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  } catch (e) {
    ct.innerHTML = `<div style="color:var(--err);font-size:12px">Could not load audit trail: ${esc(e.message)}</div>`;
  }
}

// ══ CHANGE PASSWORD PAGE ══════════════════════════════════════════════

function rChangepassword() {
  const el = document.getElementById('pg-changepassword');
  if (!el) return;

  el.innerHTML =
    '<div class="ani">' +
      NX.pageHeader('Change Password', '', { icon:'key', sub:'Update your login password — you’ll stay signed in after the change' }) +
      '<div style="max-width:440px">' +
        NX.card(
          '<div class="nx-field"><label class="nx-label" for="cp-cur">Current password <span class="nx-req">*</span></label>' +
            '<input id="cp-cur" class="nx-input" type="password" placeholder="Your current password" autocomplete="current-password"></div>' +
          '<div class="nx-field"><label class="nx-label" for="cp-new">New password <span class="nx-req">*</span></label>' +
            '<input id="cp-new" class="nx-input" type="password" placeholder="Min 8 characters" autocomplete="new-password" oninput="document.getElementById(\'cp-match-hint\').textContent=\'\'"></div>' +
          '<div class="nx-field"><label class="nx-label" for="cp-conf">Confirm new password <span class="nx-req">*</span></label>' +
            '<input id="cp-conf" class="nx-input" type="password" placeholder="Repeat new password" autocomplete="new-password" oninput="document.getElementById(\'cp-match-hint\').textContent=this.value&&this.value===document.getElementById(\'cp-new\').value?\'Passwords match\':\'\'">' +
            '<div id="cp-match-hint" style="font-size:var(--fk-fs-label);color:var(--fk-success);margin-top:4px"></div></div>' +
          '<div class="nx-error" id="cp-err" style="display:none"></div>' +
          '<div>' + NX.button('Update password', { variant:'primary', attrs:'id="cp-btn"', onclick:'submitChangePassword()' }) + '</div>',
          { header:{ icon:'lock', title:'Update password' } }) +
      '</div>' +
    '</div>';
}

async function submitChangePassword() {
  const curPwd  = (document.getElementById('cp-cur')?.value  || '');
  const newPwd  = (document.getElementById('cp-new')?.value  || '');
  const confPwd = (document.getElementById('cp-conf')?.value || '');
  const errEl   = document.getElementById('cp-err');
  const btn     = document.getElementById('cp-btn');

  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };

  if (!curPwd)             { showErr('Current password is required.'); return; }
  if (newPwd.length < 8)  { showErr('New password must be at least 8 characters.'); return; }
  if (newPwd !== confPwd) { showErr('New passwords do not match.'); return; }
  if (newPwd === curPwd)  { showErr('New password must be different from current password.'); return; }

  if (btn) btn.disabled = true;

  try {
    // Step 1: Verify current password via verify_login RPC
    const { data: chk, error: chkErr } = await supabase.rpc('verify_login', {
      p_company_code: S.coCode || '',
      p_username:     S.username || '',
      p_password:     curPwd
    });

    if (chkErr || !chk?.success) {
      showErr('Current password is incorrect.');
      if (btn) btn.disabled = false;
      return;
    }

    // Step 2: Update password via update_app_user RPC
    const { data: res, error: updErr } = await supabase.rpc('update_app_user', {
      p_user_id:    S.userId,
      p_company_id: S.cid,
      p_password:   newPwd
    });

    if (updErr) throw updErr;
    if (!res?.success) throw new Error(res?.message || 'Password update failed.');

    ['cp-cur','cp-new','cp-conf'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const hint = document.getElementById('cp-match-hint');
    if (hint) hint.textContent = '';

    notify.success('Password updated successfully.');

  } catch(e) {
    showErr(e.message || 'An error occurred. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══ MODULE 12 — SECURITY TAB ══════════════════════════════════════

async function _adminLoadSecurity(ct) {
  ct.innerHTML = NX.card(NX.empty({ icon:'shield', message:'Loading security settings…' }));

  const [settRes, ipRes, evRes, lockedRes] = await Promise.all([
    supabase.rpc('get_security_settings',  { p_company_id: S.cid }),
    supabase.rpc('get_ip_whitelist',       { p_company_id: S.cid }),
    supabase.rpc('get_auth_events',        { p_company_id: S.cid, p_limit: 30, p_offset: 0, p_event_type: null }),
    supabase.rpc('get_locked_users',       { p_company_id: S.cid }),
  ]);

  const cfg     = settRes.data  || {};
  const ipList  = Array.isArray(ipRes.data)  ? ipRes.data  : [];
  const events  = Array.isArray(evRes.data)  ? evRes.data  : [];
  const locked  = Array.isArray(lockedRes.data) ? lockedRes.data : [];

  const curTimeout = cfg.session_timeout_min ?? 120;

  const timeoutOpts = [
    { v:0,    l:'Never (disabled)' },
    { v:15,   l:'15 minutes' },
    { v:30,   l:'30 minutes' },
    { v:60,   l:'1 hour' },
    { v:120,  l:'2 hours (default)' },
    { v:240,  l:'4 hours' },
    { v:480,  l:'8 hours' },
  ].map(o => `<option value="${o.v}" ${Number(curTimeout)===o.v?'selected':''}>${o.l}</option>`).join('');

  const evTone = {
    login_success:'success', login_failed:'danger', login_locked:'warning',
    logout:'', session_expired:'info', ip_blocked:'danger',
  };
  const evRows = events.length === 0
    ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--fk-text-muted)">No auth events recorded yet</td></tr>'
    : events.map(e => {
        const dt  = e.created_at ? new Date(e.created_at).toLocaleString('en-US', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        return `<tr>
          <td><span class="nx-mono" style="color:var(--fk-text-muted);white-space:nowrap">${dt}</span></td>
          <td>${NX.badge(e.event_type, evTone[e.event_type] || '')}</td>
          <td>${esc(e.username||'—')}</td>
          <td><span class="nx-mono" style="color:var(--fk-text-muted)">${esc(e.ip_address||'—')}</span></td>
        </tr>`;
      }).join('');

  const ipRows = ipList.length === 0
    ? '<tr><td colspan="3" style="text-align:center;padding:16px;color:var(--fk-text-muted)">No IP ranges added</td></tr>'
    : ipList.map(ip => `<tr>
        <td><span class="nx-mono" style="font-weight:var(--fk-fw-semibold)">${esc(ip.ip_range)}</span></td>
        <td style="color:var(--fk-text-muted)">${esc(ip.label||'—')}</td>
        <td style="text-align:right">${NX.button('Remove', { variant:'danger-soft', size:'sm', onclick:`secRemoveIP('${ip.id}')` })}</td>
      </tr>`).join('');

  const lockedHtml = locked.length === 0
    ? '<div style="font-size:var(--fk-fs-body);color:var(--fk-text-muted);padding:8px 0">No users are currently locked out.</div>'
    : locked.map(u => {
        const unlockAt = u.locked_until ? new Date(u.locked_until).toLocaleString('en-US',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--fk-border)">
          <div>
            <div style="font-size:var(--fk-fs-body);font-weight:var(--fk-fw-semibold)">${esc(u.full_name)} <span style="font-size:var(--fk-fs-label);color:var(--fk-text-muted)">(${esc(u.username)})</span></div>
            <div style="font-size:var(--fk-fs-label);color:var(--fk-danger)">Locked until ${unlockAt} · ${u.failed_login_attempts} failed attempts</div>
          </div>
          ${NX.button('Unlock', { variant:'secondary', size:'sm', onclick:`secUnlockUser('${u.id}')` })}
        </div>`;
      }).join('');

  const timeoutCard = NX.card(
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:0 0 14px;line-height:1.6">Auto-logout users after a period of inactivity. Applies to all sessions on next login.</p>' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      `<select id="sec-timeout" class="nx-select" style="min-width:200px;max-width:240px">${timeoutOpts}</select>` +
      NX.button('Save timeout', { variant:'primary', onclick:'secSaveTimeout()' }) +
    '</div>' +
    `<div style="margin-top:10px;font-size:var(--fk-fs-label);color:var(--fk-text-muted)">Current session timeout: <b style="color:var(--fk-text)">${curTimeout === 0 ? 'Disabled' : curTimeout + ' minutes'}</b></div>`,
    { header:{ icon:'calendar-clock', title:'Session timeout' } });

  const lockoutCard = NX.card(
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:0 0 10px;line-height:1.6">Accounts are locked for 15 minutes after 5 consecutive failed login attempts.</p>' +
    (locked.length > 0 ? `<div style="font-size:var(--fk-fs-label);font-weight:var(--fk-fw-semibold);color:var(--fk-danger);margin-bottom:8px">${locked.length} user${locked.length!==1?'s are':' is'} currently locked out:</div>` : '') +
    `<div id="sec-locked-wrap">${lockedHtml}</div>`,
    { header:{ icon:'lock', tone:'warning', title:'Account lockout' } });

  const twofaCard = NX.card(
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:0 0 14px;line-height:1.6">When enabled, <b style="color:var(--fk-text)">Admin and Owner</b> accounts must enter a one-time code sent to their email at every sign-in. Requires the email service; if it is ever unreachable, sign-in proceeds without the code so you can never be locked out.</p>' +
    `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:var(--fk-fs-body);font-weight:var(--fk-fw-medium);color:var(--fk-text)">` +
      `<input type="checkbox" id="sec-2fa" ${cfg.require_2fa_admin ? 'checked' : ''} onchange="secSave2FA(this.checked)">` +
      'Require email 2FA for Admin / Owner logins</label>',
    { header:{ icon:'shield', tone:'success', title:'Two-factor authentication', sub:'Admin & owner accounts', actions: NX.badge('Recommended', 'success') } });

  const ipCard = NX.card(
    '<p style="font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin:0 0 14px;line-height:1.6">Restrict logins to specific IP addresses or CIDR ranges. Used for access monitoring — enforcement requires Supabase Edge Functions.</p>' +
    `<table class="nx-table" style="margin-bottom:14px"><thead><tr><th>IP range / address</th><th>Label</th><th></th></tr></thead><tbody id="sec-ip-tbody">${ipRows}</tbody></table>` +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<input class="nx-input" id="sec-ip-range" placeholder="e.g. 203.123.45.67 or 192.168.1.0/24" style="flex:1;min-width:200px">' +
      '<input class="nx-input" id="sec-ip-label" placeholder="Label (e.g. Office Karachi)" style="flex:1;min-width:160px">' +
      NX.button('Add IP', { variant:'secondary', icon:'plus', onclick:'secAddIP()' }) +
    '</div>',
    { header:{ icon:'shield', title:'IP whitelist', actions: NX.badge('Enterprise', 'primary') } });

  const eventsCard = NX.card(
    `<table class="nx-table"><thead><tr><th>Time</th><th>Event</th><th>Username</th><th>IP</th></tr></thead><tbody>${evRows}</tbody></table>`,
    { header:{ icon:'history', title:'Recent login events', actions: NX.button('Export CSV', { variant:'ghost', size:'sm', onclick:'secExportAuthEvents()' }) } });

  ct.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:var(--fk-sp-4);max-width:760px">' +
      timeoutCard + lockoutCard + twofaCard + ipCard + eventsCard +
    '</div>';

  window._secAuthEvents = events;
}

async function secSaveTimeout() {
  const min = parseInt(document.getElementById('sec-timeout')?.value || '120', 10);
  const { data, error } = await supabase.rpc('save_security_settings', {
    p_company_id: S.cid,
    p_data: { session_timeout_min: min }
  });
  if (error || data?.success === false) { toast('Failed to save', 'err'); return; }
  if (typeof _setIdleTimeoutMin === 'function') _setIdleTimeoutMin(min);
  toast('Session timeout saved', 'ok');
}

async function secSave2FA(enabled) {
  // save_security_settings is merge-safe, so sending only this field preserves
  // the session timeout, lockout, and IP-whitelist settings.
  const { data, error } = await supabase.rpc('save_security_settings', {
    p_company_id: S.cid,
    p_data: { require_2fa_admin: !!enabled }
  });
  if (error || data?.success === false) {
    toast('Failed to save', 'err');
    const cb = document.getElementById('sec-2fa');
    if (cb) cb.checked = !enabled;   // revert the toggle on failure
    return;
  }
  toast(enabled ? 'Admin 2FA enabled' : 'Admin 2FA disabled', 'ok');
}

async function secAddIP() {
  const range = (document.getElementById('sec-ip-range')?.value || '').trim();
  const label = (document.getElementById('sec-ip-label')?.value || '').trim();
  if (!range) { toast('IP range is required', 'warn'); return; }
  const { data, error } = await supabase.rpc('add_ip_whitelist_entry', {
    p_company_id: S.cid,
    p_ip_range:   range,
    p_label:      label,
    p_created_by: S.name || S.username
  });
  if (error || data?.success === false) { toast(data?.error || 'Failed to add IP', 'err'); return; }
  toast('IP added', 'ok');
  _adminLoadSecurity(document.getElementById('a-ct'));
}

async function secRemoveIP(id) {
  if (!confirm('Remove this IP from the whitelist?')) return;
  const { data, error } = await supabase.rpc('remove_ip_whitelist_entry', {
    p_company_id: S.cid,
    p_id: id
  });
  if (error || data?.success === false) { toast('Failed to remove', 'err'); return; }
  toast('IP removed', 'ok');
  _adminLoadSecurity(document.getElementById('a-ct'));
}

async function secUnlockUser(userId) {
  if (!confirm('Unlock this user account?')) return;
  const { error } = await supabase.rpc('update_app_user', {
    p_user_id:    userId,
    p_company_id: S.cid,
    p_data: { locked_until: null, failed_login_attempts: 0 }
  });
  if (error) { toast('Failed to unlock: ' + error.message, 'err'); return; }
  toast('User unlocked', 'ok');
  _adminLoadSecurity(document.getElementById('a-ct'));
}

function secExportAuthEvents() {
  const events = window._secAuthEvents || [];
  if (!events.length) { toast('No events to export', 'warn'); return; }
  const headers = ['Time','Event','Username','IP Address'];
  const rows = events.map(e => [
    e.created_at ? new Date(e.created_at).toISOString() : '',
    e.event_type || '',
    e.username   || '',
    e.ip_address || '',
  ]);
  const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a    = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `auth_events_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
