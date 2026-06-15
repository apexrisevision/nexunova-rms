-- ============================================================================
-- NEXUNOVA RMS — AVAILABILITY & RESERVATION — ADMIN REACTIVATE SALES PERSON
-- 2026-06-15.  Additive.
-- ----------------------------------------------------------------------------
-- A deactivated sales person cannot self-register again (the one-mobile-per-
-- company dedup blocks it — by design). So the ADMIN needs a way to bring them
-- back. reactivate_sales_user flips an 'inactive' sales person back to 'active'
-- (keeping their existing project scope), enforcing the plan limit exactly like
-- approval (reactivating consumes a slot).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reactivate_sales_user(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_su public.sales_users; v_limit jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status='active' THEN RETURN jsonb_build_object('success',true); END IF;  -- already active (no-op)
  IF v_su.status <> 'inactive' THEN
    RETURN jsonb_build_object('success',false,'error','not_reactivatable',
      'message','Only a deactivated sales person can be reactivated.'); END IF;

  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate another sales person, or upgrade your plan, before reactivating.',
      'limit', v_limit);
  END IF;

  UPDATE public.sales_users SET status='active', is_active=true, updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END; $$;

GRANT EXECUTE ON FUNCTION public.reactivate_sales_user(uuid) TO anon, authenticated;
