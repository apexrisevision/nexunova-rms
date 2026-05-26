-- =====================================================================
-- Phase 3 / Component 3 follow-up — discount soft-block entry point.
-- Applied to itqxljtfbrppntgyfush on 2026-05-26 (migration
-- phase3_discount_softblock).
--
-- request_discount_change: a maker requests a new discount on an existing
-- sale; routed by the 'discount' restriction level. This is the dedicated
-- "edit discount" entry point the soft-block model needs (the approve_request
-- 'discount' apply branch UPDATEs an existing sale's discount_amount).
--
--   hard    -> RAISE 'action_hard_blocked' (everyone, incl. admin — §5)
--   admin   -> apply directly (bypasses soft/warning routing; admin is the
--              single approver, same net effect as the approve-engine apply)
--   soft    -> create_approval_request (payload {discount_amount}); pending_approval
--   warning -> audit_logs (is_sensitive) + apply directly
--   else    -> apply directly (defensive; helper defaults to 'soft')
--
-- Payload key 'discount_amount' matches the approve_request 'discount'
-- apply branch: UPDATE sales SET discount_amount = payload->>'discount_amount'.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.request_discount_change(
  p_sale_id uuid,
  p_new_discount numeric,
  p_maker_comment text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me      public.app_users;
  v_company uuid;
  v_project uuid;
  v_level   text;
  v_ar      jsonb;
BEGIN
  -- 1. Resolve caller
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;

  -- 2. Company isolation — sale must belong to caller's company
  SELECT company_id, project_id INTO v_company, v_project
  FROM public.sales WHERE id = p_sale_id;
  IF v_company IS NULL OR v_company <> v_me.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- 3. Restriction level for 'discount'
  v_level := public._rms_restriction_level(v_me.company_id, 'discount');

  -- Hard block applies to everyone, including admin (master context §5).
  IF v_level = 'hard' THEN
    RAISE EXCEPTION 'action_hard_blocked';
  END IF;

  -- 4. Admin bypasses the soft/warning routing — applies directly
  --    (admin is the single approver; same net result as the apply-engine).
  IF public._rms_is_admin(v_me) THEN
    UPDATE public.sales SET discount_amount = p_new_discount, updated_at = now()
    WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied', 'admin_bypass', true);
  END IF;

  -- Non-admin routing
  IF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type', 'discount',
      'entity_table', 'sales',
      'entity_id',    p_sale_id,
      'project_id',   v_project,
      'title',        'Discount change',
      'amount',       p_new_discount,
      'comment',      p_maker_comment,
      'payload',      jsonb_build_object('discount_amount', p_new_discount)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN
      RETURN v_ar;  -- e.g. comment_required when p_maker_comment is empty
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');

  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (
      company_id, table_name, record_id, action, new_data,
      changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason
    ) VALUES (
      v_me.company_id, 'sales', p_sale_id::text, 'restriction_warning',
      jsonb_build_object('discount_amount', p_new_discount),
      v_me.id, v_me.full_name, v_me.role, true, 'restrictions', 'discount'
    );
    UPDATE public.sales SET discount_amount = p_new_discount, updated_at = now()
    WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied');

  ELSE
    -- no/other rule (helper defaults to 'soft', so this is defensive only)
    UPDATE public.sales SET discount_amount = p_new_discount, updated_at = now()
    WHERE id = p_sale_id AND company_id = v_me.company_id;
    RETURN jsonb_build_object('success', true, 'status', 'applied');
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_discount_change(uuid, numeric, text)
  TO anon, authenticated, service_role;
