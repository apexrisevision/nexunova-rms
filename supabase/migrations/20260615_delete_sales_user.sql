-- ============================================================================
-- NEXUNOVA RMS — ADMIN DELETE SALES PERSON
-- 2026-06-15.  Additive.
-- ----------------------------------------------------------------------------
-- Admin can permanently delete a sales person (in addition to deactivate/
-- reactivate). Before deleting, any ACTIVE reservations they hold are released
-- (unit → Available) so nothing is orphaned; sessions are removed; historical
-- reservations keep their rows (reserved_by → NULL via the FK ON DELETE SET NULL).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_sales_user(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_su public.sales_users; v_r record; v_avail uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- release this person's ACTIVE reservations (free the units; no orphans)
  FOR v_r IN SELECT * FROM public.reservations
             WHERE reserved_by=p_id AND company_id=v_me.company_id AND status='active' LOOP
    UPDATE public.reservations
      SET status='cancelled', cancelled_by=v_me.id, cancelled_at=now(), updated_at=now()
    WHERE id=v_r.id;
    SELECT id INTO v_avail FROM public.category_unit_statuses
      WHERE company_id=v_r.company_id AND project_id=v_r.project_id AND is_available AND is_active
      ORDER BY sort_order LIMIT 1;
    IF v_avail IS NOT NULL THEN
      UPDATE public.units SET status_id=v_avail, updated_at=now()
      WHERE id=v_r.unit_id AND company_id=v_r.company_id;
    END IF;
  END LOOP;

  DELETE FROM public.sales_sessions WHERE sales_user_id=p_id;
  DELETE FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id;
  RETURN jsonb_build_object('success',true);
END; $$;

GRANT EXECUTE ON FUNCTION public.delete_sales_user(uuid) TO anon, authenticated;
