-- Merge a duplicate agent (source) into a keeper (target): move every sale,
-- commission, transaction, login (sales_user) and reference from source to
-- target, fill the target's blank profile fields from source, recompute the
-- target's rollups, then delete the source. No sale is ever orphaned.
CREATE OR REPLACE FUNCTION public.merge_agents(p_source uuid, p_target uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_src public.agents; v_tgt public.agents;
  v_moved_sales int := 0;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RETURN jsonb_build_object('success',false,'error','bad_params','message','Pick two different agents.'); END IF;
  SELECT * INTO v_src FROM public.agents WHERE id=p_source AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','source_not_found'); END IF;
  SELECT * INTO v_tgt FROM public.agents WHERE id=p_target AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','target_not_found'); END IF;

  -- 1) reassign every reference source -> target
  UPDATE public.sales                    SET agent_id=p_target        WHERE agent_id=p_source AND company_id=v_me.company_id;
  GET DIAGNOSTICS v_moved_sales = ROW_COUNT;
  UPDATE public.agent_commission_payments SET agent_id=p_target       WHERE agent_id=p_source;
  UPDATE public.agent_transactions        SET agent_id=p_target       WHERE agent_id=p_source;
  UPDATE public.sale_submissions          SET agent_id=p_target       WHERE agent_id=p_source;
  UPDATE public.sales_users               SET agent_id=p_target       WHERE agent_id=p_source;
  UPDATE public.unit_cancellations        SET agent_id=p_target       WHERE agent_id=p_source;
  UPDATE public.contact_logs              SET agent_id=p_target::text WHERE agent_id=p_source::text;
  UPDATE public.agents                    SET parent_agent_id=p_target WHERE parent_agent_id=p_source;
  -- commission_structures: drop source rows that would collide with target on (project), move the rest
  DELETE FROM public.commission_structures cs
   WHERE cs.agent_id=p_source
     AND EXISTS (SELECT 1 FROM public.commission_structures t
                  WHERE t.agent_id=p_target AND t.company_id=cs.company_id
                    AND COALESCE(t.project_id,'00000000-0000-0000-0000-000000000000')
                      = COALESCE(cs.project_id,'00000000-0000-0000-0000-000000000000'));
  UPDATE public.commission_structures     SET agent_id=p_target       WHERE agent_id=p_source;

  -- 2) fill the target's blank profile fields from the source
  UPDATE public.agents t SET
    cnic               = COALESCE(NULLIF(TRIM(t.cnic),''),               NULLIF(TRIM(COALESCE(v_src.cnic,'')),'')),
    phone              = CASE WHEN COALESCE(NULLIF(TRIM(t.phone),''),'0000000000')='0000000000'
                              THEN COALESCE(NULLIF(TRIM(COALESCE(v_src.phone,'')),''), t.phone) ELSE t.phone END,
    father_name        = COALESCE(NULLIF(TRIM(t.father_name),''),        v_src.father_name),
    email              = COALESCE(NULLIF(TRIM(t.email),''),              v_src.email),
    address            = COALESCE(NULLIF(TRIM(t.address),''),            v_src.address),
    bank_name          = COALESCE(NULLIF(TRIM(t.bank_name),''),          v_src.bank_name),
    bank_account_no    = COALESCE(NULLIF(TRIM(t.bank_account_no),''),    v_src.bank_account_no),
    bank_account_title = COALESCE(NULLIF(TRIM(t.bank_account_title),''), v_src.bank_account_title),
    profile_photo_url  = COALESCE(NULLIF(TRIM(t.profile_photo_url),''),  v_src.profile_photo_url),
    cnic_front_url     = COALESCE(NULLIF(TRIM(t.cnic_front_url),''),     v_src.cnic_front_url),
    cnic_back_url      = COALESCE(NULLIF(TRIM(t.cnic_back_url),''),      v_src.cnic_back_url),
    commission_percent = COALESCE(t.commission_percent, v_src.commission_percent),
    updated_at         = now()
  WHERE t.id = p_target;

  -- 3) recompute target rollups from its (now-merged) active sales
  UPDATE public.agents a SET
    total_sales_count       = COALESCE(agg.cnt,0),
    total_sales_amount      = COALESCE(agg.amt,0),
    total_commission_earned = COALESCE(agg.comm,0),
    updated_at = now()
  FROM (
    SELECT count(*) cnt, sum(net_amount) amt,
           round(sum(net_amount*COALESCE(commission_rate,0)/100.0)) comm
    FROM public.sales
    WHERE company_id=v_me.company_id AND status='active' AND agent_id=p_target
  ) agg
  WHERE a.id = p_target;

  -- 4) remove the duplicate
  DELETE FROM public.agents WHERE id=p_source AND company_id=v_me.company_id;

  RETURN jsonb_build_object('success',true,'moved_sales',v_moved_sales,
    'target_id',p_target,'target_code',v_tgt.agent_code,
    'source_name',v_src.full_name,'target_name',v_tgt.full_name);
END; $function$;
