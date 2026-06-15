// VERIFY: the full recovery loop as the (now project-assigned) officer, using the
// EXACT payloads the FIXED pages now send. Every action must succeed and attribute.
const { start, login, sleep } = require('./lib');
const ID = {
  c1:'b33cfe9a-f60c-48fc-acda-bcf8fdf03031', s1:'bbc5ae27-12c5-4c34-a46e-d5ed0001afb9', u1:'1195d1ce-3798-4b60-ad0a-ad16d2e1f6df', i1:'4e1b6aea-2816-4a40-8c8a-f21e9aab1e4b',
  c2:'2254bdca-1400-4ea9-bbee-85481e671791', s2:'8e94c4de-185f-4ac6-8e34-db25d2c9ad91', i2:'e8f70eda-cd9d-4922-808c-e4fb6b18e198',
  c3:'e51d6491-02dd-4a78-a63e-8c694bf1edb2', s3:'586280c0-3db9-49d3-b98a-d5cb0de1d20f', i3:'39ab8133-a98d-4473-81ba-2091cdcdc561'
};
(async()=>{
  const H = await start(4787); const { page, base } = H;
  const sess = await login(page, base, 'zzrbilal@zztest3', 'ZzRec!2026');
  if(!sess.loggedIn){ console.log('LOGIN_FAILED'); await H.browser.close(); H.srv.close(); return; }
  console.log('OFFICER', sess.username, sess.userId);

  const out = await page.evaluate(async (ID)=>{
    const R={};
    const td = ()=>new Date().toISOString().slice(0,10);
    const fut = d=>new Date(Date.now()+d*864e5).toISOString().slice(0,10);
    const call = async (k,fn,p)=>{ try{ const {data,error}=await supabase.rpc(fn,p); R[k]={fn, err:error?(error.message||error.code):null, ok:!!(data&&data.success), data}; return data; }catch(e){ R[k]={fn, threw:String(e).slice(0,150)}; } };

    // 1. CALL
    await call('call','create_contact_log',{ p_company_id:S.cid, p_data:{ company_id:S.cid, unit_id:ID.u1, contact_date:td(), channel:'call', direction:'outbound', agent_id:S.userId, created_by:S.userId, response_received:'answered', remarks:'ZZR verify call', promise_to_pay:false, status_tag:'contacted' }});
    // 2. PAYMENT
    await call('payment','record_payment_simple',{ p_company_id:S.cid, p_sale_id:ID.s2, p_amount:100000, p_payment_date:td(), p_payment_method:'cash', p_reference_no:'ZZR-V1', p_bank_name:null, p_notes:'ZZR verify payment', p_created_by:S.userId, p_cheque_date:null, p_bank_id:null });
    // 3. PROMISE (fixed: server stamps logged_by=uuid + project_id)
    const pr = await call('promise','log_payment_promise',{ p_company_id:S.cid, p_client_id:ID.c3, p_promised_amount:480000, p_promise_date:fut(5), p_sale_id:ID.s3, p_installment_id:ID.i3, p_promised_via:'call', p_promised_by_client:'client', p_logged_by:(S.username||S.name), p_notes:'ZZR verify promise' });
    // 4. MARK KEPT (fixed: derives project, officer can now keep)
    if(pr && pr.id) await call('mark_kept','mark_promise_kept',{ p_promise_id:pr.id, p_actual_amount:480000, p_actual_date:td(), p_actual_via:'cash', p_related_payment_id:null, p_updated_by:S.name });
    // 5. FIELD VISIT (fixed jsonb contract + officer_id)
    await call('field_visit','log_field_visit',{ p_company_id:S.cid, p_data:{ officer_id:S.userId, officer_name:S.name, client_id:ID.c3, client_name:'ZZR Sana Tariq', visit_date:td(), outcome:'promise_received', location_name:'Plot 1', latitude:24.86, longitude:67.01, notes:'ZZR verify visit' }});
    // 6. ESCALATION (fixed jsonb contract + escalated_by)
    await call('escalation','create_escalation',{ p_company_id:S.cid, p_data:{ client_id:ID.c2, to_level:2, from_level:1, reason:'[non_payment] ZZR verify escalation', escalated_by:S.userId, status:'open' }});

    return { userId:S.userId, R };
  }, ID);

  for(const [k,v] of Object.entries(out.R)) console.log(k.padEnd(12), v.ok?'OK':'FAIL', v.err||v.threw||'', v.data&&v.data.id?('id='+v.data.id):'');
  console.log('CONSOLE_ERRS', H.errs.length);
  await H.browser.close(); H.srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
