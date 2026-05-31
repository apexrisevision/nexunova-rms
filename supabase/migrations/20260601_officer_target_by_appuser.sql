-- Monthly officer targets keyed on app_users.id (not recovery_agents.id).
-- Our recovery officers are app_users (role 'recovery') with NO recovery_agents row,
-- and the Team Performance scorecard (get_team_performance_lite) is keyed on app_users.id.
-- We reuse the existing recovery_officer_targets table and store the officer's
-- app_users.id in the recovery_agent_id column. Because that column had an FK to
-- recovery_agents(id) (which would reject an app_users.id), we drop ONLY that one FK.
-- The UNIQUE (recovery_agent_id, project_id, year, month) and the month CHECK are kept.
-- project_id stays NULL (officer owns the whole site; site-level split not needed yet).

-- 1) Drop the blocking FK on recovery_agent_id (keep all other constraints).
ALTER TABLE public.recovery_officer_targets
  DROP CONSTRAINT IF EXISTS recovery_officer_targets_recovery_agent_id_fkey;

-- 2) set_officer_target_v2 — admin-only UPSERT keyed on app_users.id.
CREATE OR REPLACE FUNCTION public.set_officer_target_v2(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me    public.app_users;
  v_id    uuid;
  v_user  uuid     := NULLIF(p_data->>'p_user_id','')::uuid;
  v_year  smallint := (p_data->>'year')::smallint;
  v_month smallint := (p_data->>'month')::smallint;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_session');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.');
  END IF;
  IF v_user IS NULL OR v_year IS NULL OR v_month IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','missing_fields');
  END IF;
  IF v_month < 1 OR v_month > 12 THEN
    RETURN jsonb_build_object('success',false,'error','bad_month');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = v_user
      AND company_id = v_me.company_id
      AND role IN ('recovery','recovery_officer')
  ) THEN
    RETURN jsonb_build_object('success',false,'error','user_not_officer');
  END IF;

  -- UPSERT on the existing UNIQUE key (recovery_agent_id, project_id, year, month) with project_id NULL.
  UPDATE public.recovery_officer_targets SET
    target_amount = COALESCE((p_data->>'target_amount')::numeric, target_amount),
    notes         = COALESCE(NULLIF(p_data->>'notes',''), notes),
    set_by        = v_me.id,
    updated_at    = now()
  WHERE company_id = v_me.company_id
    AND recovery_agent_id = v_user
    AND project_id IS NULL
    AND year = v_year
    AND month = v_month
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.recovery_officer_targets
      (company_id, recovery_agent_id, project_id, year, month, target_amount, notes, set_by)
    VALUES
      (v_me.company_id, v_user, NULL, v_year, v_month,
       COALESCE((p_data->>'target_amount')::numeric, 0), NULLIF(p_data->>'notes',''), v_me.id)
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END;
$function$;

-- 3) get_officer_target — admin reads any officer; non-admin reads only their own.
CREATE OR REPLACE FUNCTION public.get_officer_target(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me    public.app_users;
  v_user  uuid     := NULLIF(p_data->>'p_user_id','')::uuid;
  v_year  smallint := (p_data->>'year')::smallint;
  v_month smallint := (p_data->>'month')::smallint;
  v_row   public.recovery_officer_targets;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_session');
  END IF;
  -- Non-admins can only read their own target.
  IF NOT public._rms_is_admin(v_me) THEN
    v_user := v_me.id;
  END IF;
  IF v_user IS NULL OR v_year IS NULL OR v_month IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','missing_fields');
  END IF;

  SELECT * INTO v_row
  FROM public.recovery_officer_targets
  WHERE company_id = v_me.company_id
    AND recovery_agent_id = v_user
    AND project_id IS NULL
    AND year = v_year
    AND month = v_month
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'target',NULL);
  END IF;

  RETURN jsonb_build_object('success',true,'target',
    jsonb_build_object('target_amount', v_row.target_amount, 'notes', v_row.notes));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_officer_target_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_officer_target(jsonb) TO authenticated;
