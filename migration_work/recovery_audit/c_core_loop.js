// PART C: the core recovery loop. Runs as the recovery officer and replicates
// each page's EXACT rpc call (the pages for visits/escalations/promises are
// unreachable via nav, so we exercise the server contracts they use directly).
// arg: phase1 (as-created, no project assignment) | phase2 (after assignment).
const { start, login, sleep } = require('./lib');
const PHASE = process.argv[2] || 'phase1';
const ID = {
  c1:'bc04c9da-56b2-4b9f-b165-da462f907906', s1:'99be002f-8c23-4f0b-9b6c-37342c27b561', u1:'1195d1ce-3798-4b60-ad0a-ad16d2e1f6df', i1:'da24c957-8095-4733-861e-2c61024adb29', prom:'5e6f3644-508e-49a5-a7cf-455f8cd0460c',
  c2:'6d91fd6f-f350-4f6c-ab14-004de45d3d5f', s2:'3a18a775-7deb-49aa-88da-102d0e12cf8c', u2:'efe561d1-e643-4e83-9cc8-94f13bffd764', i2:'2455dd69-cc98-436a-9982-d4d5414af5b8',
  c3:'f422a145-076b-42d3-8831-1ae3067a90bf', s3:'ddc663c8-b108-4942-a5f5-84d3326fb11a', u3:'8fdd0bdf-1832-4bec-a9d8-bb9bbfb67837', i3:'035d09d9-aaf7-43e7-92ee-5690d2ad0c83'
};
(async()=>{
  const H = await start(4785); const { page, base } = H;
  const sess = await login(page, base, 'zzrbilal@zztest3', 'ZzRec!2026');
  if(!sess.loggedIn){ console.log('LOGIN_FAILED'); await H.browser.close(); H.srv.close(); return; }
  console.log('PHASE', PHASE, 'as', sess.username, sess.userId);

  const out = await page.evaluate(async (ID, PHASE)=>{
    const R={};
    const call = async (name, fn, params)=>{ try{ const {data,error}=await supabase.rpc(fn,params); R[name]={fn, err: error? (error.message||error.code) : null, data: data}; }catch(e){ R[name]={fn, threw:String(e).slice(0,160)}; } };

    // 1. LOG A CALL — exact create_contact_log payload (modals-log-call.js)
    await call('call_log','create_contact_log',{ p_company_id:S.cid, p_data:{
      company_id:S.cid, unit_id:ID.u1, contact_date:new Date().toISOString().slice(0,10),
      channel:'call', direction:'outbound', agent_id:S.userId, created_by:S.userId,
      response_received:'answered', remarks:'ZZR audit test call', promise_to_pay:false, status_tag:'contacted' }});

    // 2. RECORD A PAYMENT — exact record_payment_simple (payments.js)
    await call('payment','record_payment_simple',{ p_company_id:S.cid, p_sale_id:ID.s2, p_amount:100000,
      p_payment_date:new Date().toISOString().slice(0,10), p_payment_method:'cash', p_reference_no:'ZZR-RCPT-1',
      p_bank_name:null, p_notes:'ZZR audit payment', p_created_by:S.userId, p_cheque_date:null, p_bank_id:null });

    // 3. LOG A PROMISE — exact log_payment_promise (promises.js); logged_by = username STRING (as the form prefills)
    await call('promise','log_payment_promise',{ p_company_id:S.cid, p_client_id:ID.c3, p_promised_amount:480000,
      p_promise_date:new Date(Date.now()+5*864e5).toISOString().slice(0,10), p_sale_id:ID.s3, p_installment_id:ID.i3,
      p_promised_via:'call', p_promised_by_client:'client', p_logged_by:(S.username||S.name), p_notes:'ZZR audit promise' });

    // 4. LOG A FIELD VISIT — exact fieldvisits.js FLAT params (RPC actually expects (p_company_id,p_data))
    await call('field_visit','log_field_visit',{ p_company_id:S.cid, p_client_id:ID.c3, p_visit_date:new Date().toISOString().slice(0,10),
      p_outcome:'promise_received', p_address:'Plot 1', p_gps_lat:24.86, p_gps_lng:67.01, p_notes:'ZZR audit visit',
      p_amount_collected:null, p_payment_method:null, p_promised_amount:50000, p_promise_date:new Date(Date.now()+3*864e5).toISOString().slice(0,10), p_officer_name:S.name });

    // 5. OPEN AN ESCALATION — exact escalations.js FLAT params (RPC expects (p_company_id,p_data))
    await call('escalation','create_escalation',{ p_company_id:S.cid, p_client_id:ID.c3, p_escalation_level:2,
      p_category:'payment_default', p_description:'ZZR audit escalation', p_assigned_to:null, p_created_by:S.name });

    if(PHASE==='phase2'){
      // 6. MARK the seeded promise KEPT (promises.js mark_promise_kept)
      await call('mark_kept','mark_promise_kept',{ p_promise_id:ID.prom, p_actual_amount:400000,
        p_actual_date:new Date().toISOString().slice(0,10), p_actual_via:'cash', p_related_payment_id:null, p_updated_by:S.name });
      // 7. Make + break a promise to test broken state
      const mk = await supabase.rpc('log_payment_promise',{ p_company_id:S.cid, p_client_id:ID.c2, p_promised_amount:320000,
        p_promise_date:new Date(Date.now()+2*864e5).toISOString().slice(0,10), p_sale_id:ID.s2, p_installment_id:ID.i2,
        p_promised_via:'call', p_promised_by_client:'client', p_logged_by:(S.username||S.name), p_notes:'ZZR to-break' });
      R['promise2']={fn:'log_payment_promise', data:mk.data, err:mk.error?.message||null};
      const newId = mk.data?.id;
      if(newId){ await call('mark_broken','mark_promise_broken',{ p_promise_id:newId, p_broken_reason:'ZZR audit broken', p_updated_by:S.name }); }
    }
    return { cid:S.cid, userId:S.userId, username:S.username, name:S.name, R };
  }, ID, PHASE);

  console.log(JSON.stringify(out.R, null, 1));
  console.log('CONSOLE_ERRS', H.errs.length, H.errs.slice(0,6).join(' | '));
  await H.browser.close(); H.srv.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
