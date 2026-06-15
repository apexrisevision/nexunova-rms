'use strict';
const fs=require('fs');
const XLSX=require('xlsx');
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({query})});
  const t=await r.text(); if(!r.ok) throw new Error('SQL FAIL '+r.status+': '+t.slice(0,400)); return t;
}
const S=v=>(v===null||v===undefined||v==='')?'NULL':"'"+String(v).replace(/'/g,"''")+"'";
const N=v=>(v===null||v===undefined||v===''||isNaN(Number(v)))?'NULL':String(Number(v));
async function insertBatches(table, cols, rows, batch=400){
  let done=0;
  for(let i=0;i<rows.length;i+=batch){
    const chunk=rows.slice(i,i+batch);
    const vals=chunk.map(r=>'('+r.join(',')+')').join(',\n');
    await sql(`INSERT INTO public.${table} (${cols.join(',')}) VALUES\n${vals};`);
    done+=chunk.length; process.stdout.write(`  ...${done}/${rows.length}\r`);
  }
  console.log(`\n  ${table}: inserted ${done}`);
}

const CO='96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
const PROJ='59ded55b-9bc2-45b2-a372-49fc31807fa9';
const ST_AVAIL='03b9208f-703d-446a-9899-863396126c05';
const TYPE={ 'SHOP':'e3252adf-e501-45b2-8f00-42bc3d37ac60',
            'OFFICE':'a4269409-5b95-4dba-8bdf-e5867a93c888',
            'APT':'2eb87d91-378b-4824-a775-4432bc5ca1f4' };
const FLOOR={ 'LG':['Lower Ground',-1],'GF':['Ground Floor',0],'FF':['First Floor',1],
             'SF':['Second Floor',2],'TF':['Third Floor',3],'4F':['Fourth Floor',4],'5F':['Fifth Floor',5] };

(async()=>{
  // guard: don't double-import
  const cur=JSON.parse(await sql(`SELECT count(*)::int AS n FROM units WHERE project_id='${PROJ}'`));
  if(cur[0].n>0){ console.log('ABORT: project already has',cur[0].n,'units'); return; }

  const wb=XLSX.readFile('../14 data/Awami Availibility List.xlsx');
  const rows=XLSX.utils.sheet_to_json(wb.Sheets['Awami'],{header:1,defval:''})
    .filter(r=>typeof r[0]==='number' && String(r[1]||'').trim()!=='');

  const cols=['company_id','project_id','unit_no','unit_code','unit_type_id','status_id','floor_label','floor_no','area','area_unit','base_price','notes'];
  const out=[]; const unmappedT={}, unmappedF={};
  for(const r of rows){
    const uno=String(r[1]).trim();
    const t=String(r[2]||'').trim().toUpperCase();
    const tid=TYPE[t]; if(!tid){unmappedT[t]=(unmappedT[t]||0)+1;}
    const pfx=uno.split('-')[0].toUpperCase();
    const fl=FLOOR[pfx]; if(!fl){unmappedF[pfx]=(unmappedF[pfx]||0)+1;}
    out.push([
      S(CO),S(PROJ),S(uno),S(uno),S(tid||null),S(ST_AVAIL),
      fl?S(fl[0]):'NULL', fl?N(fl[1]):'NULL',
      N(r[3]), S('sqft'), N(r[5]||0), S(String(r[6]||'').trim()||null)
    ]);
  }
  if(Object.keys(unmappedT).length) console.log('⚠ unmapped TYPES:',unmappedT);
  if(Object.keys(unmappedF).length) console.log('⚠ unmapped FLOOR prefixes:',unmappedF);
  console.log('Prepared',out.length,'unit rows. Importing...');
  await insertBatches('units',cols,out,400);

  // verify
  const v=JSON.parse(await sql(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE base_price>0)::int AS priced,
    count(DISTINCT floor_label)::int AS floors,
    count(DISTINCT unit_type_id)::int AS types FROM units WHERE project_id='${PROJ}'`));
  console.log('VERIFY:',JSON.stringify(v[0]));
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
