const { createClient } = require('@supabase/supabase-js');
const fs=require('fs');
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const URL='https://itqxljtfbrppntgyfush.supabase.co';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cXhsanRmYnJwcG50Z3lmdXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNTQ3NDksImV4cCI6MjA5MzgzMDc0OX0.v2YX7yZ6JNi4sgPLJad8zbxVAZ7BmCY00uZYsbM6bV8';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})});return JSON.parse(await r.text());}
(async()=>{
  // reset flag false first
  await sql(`UPDATE companies SET onboarding_complete=false WHERE company_code='zztest3';`);
  const sb=createClient(URL,ANON);
  const {error:e1}=await sb.auth.signInWithPassword({email:'zztest3.gate@nexunova.test',password:'ZzTest3!2026'});
  console.log('owner_signin', e1?('ERR '+e1.message):'OK');
  const cid=(await sql(`SELECT id FROM companies WHERE company_code='zztest3';`))[0].id;
  const {data,error}=await sb.rpc('mark_onboarding_complete',{p_company_id:cid});
  console.log('rpc', error?('ERR '+error.message):JSON.stringify(data));
  const after=await sql(`SELECT onboarding_complete FROM companies WHERE company_code='zztest3';`);
  console.log('after', JSON.stringify(after));
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
