const { createClient } = require('@supabase/supabase-js');
const fs=require('fs');
const REF='itqxljtfbrppntgyfush';
const TOKEN=JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN;
const URL='https://itqxljtfbrppntgyfush.supabase.co';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cXhsanRmYnJwcG50Z3lmdXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNTQ3NDksImV4cCI6MjA5MzgzMDc0OX0.v2YX7yZ6JNi4sgPLJad8zbxVAZ7BmCY00uZYsbM6bV8';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})});const t=await r.text();if(!r.ok)throw new Error(r.status+' '+t);return JSON.parse(t);}
(async()=>{
  const PW='Known!2026x';
  await sql(`UPDATE app_users SET status='active', password_hash=extensions.crypt('${PW}',extensions.gen_salt('bf',10)), needs_password_reset=true WHERE username='jamal' AND company_id=(SELECT id FROM companies WHERE company_code='zztest3');`);
  await sql(`UPDATE auth.users SET encrypted_password=extensions.crypt('${PW}',extensions.gen_salt('bf',10)) WHERE id=(SELECT auth_user_id FROM app_users WHERE username='jamal' AND company_id=(SELECT id FROM companies WHERE company_code='zztest3'));`);
  const info=await sql(`SELECT au.email, au.email_confirmed_at IS NOT NULL conf, au.banned_until, (au.confirmation_token='') ct_empty FROM auth.users au JOIN app_users u ON u.auth_user_id=au.id WHERE u.username='jamal' AND u.company_id=(SELECT id FROM companies WHERE company_code='zztest3');`);
  console.log('AUTH_ROW', JSON.stringify(info));
  const sb=createClient(URL,ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email: info[0].email, password: PW });
  console.log('SIGNIN', error ? ('ERR '+error.status+' '+error.message) : ('OK session='+!!data.session));
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
