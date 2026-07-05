-- P1-A: health/radar health-recalc crons failed every run for 3+ days because
-- calculate_client_health_score hard-fails on a NULL _rms_caller() (there is no
-- session in cron context). Same null-caller class as the signup invoice fix
-- (20260603_fix_create_invoice_null_caller). Client health scores were stale
-- platform-wide (40 stale + 262 active clients never scored, of 302 total).
--
-- Fix: an explicit is-cron guard. cron_recalculate_health_all sets a
-- transaction-local sentinel (rms.system_context='cron'); the health calc
-- accepts a NULL caller ONLY when that sentinel is present. A normal
-- anon/authenticated call never sets it, so the user-facing path is unchanged
-- and still returns 'forbidden'. Real callers with a session are still
-- tenant-checked exactly as before.
--
-- Audit of all 13 remaining crons (2026-07-05): the ONLY cron-reachable function
-- with a NULL-caller hard-fail is calculate_client_health_score.
-- generate_recovery_radar already tolerates a NULL caller (gates its ownership
-- check on IS NOT NULL); every other cron helper does not call _rms_caller.
--
-- Also de-duplicates two overlapping cron pairs (kept the cron_* wrapper of each):
--   drop nightly-health-scores  (dup of radar-health-recalc  -> cron_recalculate_health_all)
--   drop nightly-radar-refresh  (dup of radar-daily-generate -> cron_generate_radar_all)
--
-- Backfill (run once, live, outside this migration):
--   SELECT public.cron_recalculate_health_all();  -- scored all 302 active clients.

-- 1) health calc: explicit system/cron path, user path unchanged --------------
CREATE OR REPLACE FUNCTION public.calculate_client_health_score(p_client_id uuid, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_on_time         INTEGER := 0;
  v_late            INTEGER := 0;
  v_answered        INTEGER := 0;
  v_missed          INTEGER := 0;
  v_kept            INTEGER := 0;
  v_broken          INTEGER := 0;
  v_bounced         INTEGER := 0;
  v_legal_active    INTEGER := 0;
  v_points_added    INTEGER;
  v_points_deducted INTEGER;
  v_score           INTEGER;
  v_category        TEXT;
  v_exposure        NUMERIC := 0;
  v_breakdown       JSONB;
  v_calc_time       TIMESTAMPTZ;
  v_me              public.app_users;
  v_tenant          UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    -- No resolved RMS session. Allow ONLY the system/cron path, which sets this
    -- transaction-local sentinel (see cron_recalculate_health_all). A normal
    -- anon/authenticated call never sets it and is still rejected as 'forbidden'.
    IF current_setting('rms.system_context', true) IS DISTINCT FROM 'cron' THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
    END IF;
  ELSIF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM clients WHERE id = p_client_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT company_id INTO v_company_id FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_not_found');
  END IF;

  SELECT COUNT(*) INTO v_on_time
  FROM installments i JOIN sales s ON s.id = i.sale_id
  WHERE s.client_id = p_client_id AND i.paid_at IS NOT NULL AND i.paid_at::date <= i.due_date;

  SELECT COUNT(*) INTO v_late
  FROM installments i JOIN sales s ON s.id = i.sale_id
  WHERE s.client_id = p_client_id AND i.paid_at IS NOT NULL AND i.paid_at::date > i.due_date;

  SELECT COUNT(*) INTO v_answered
  FROM contact_logs WHERE client_id = p_client_id AND call_status = 'answered';

  SELECT COUNT(*) INTO v_missed
  FROM contact_logs WHERE client_id = p_client_id AND call_status = 'no_answer';

  SELECT COUNT(*) INTO v_kept
  FROM payment_promises WHERE client_id = p_client_id AND status = 'kept';

  SELECT COUNT(*) INTO v_broken
  FROM payment_promises WHERE client_id = p_client_id AND status = 'broken';

  SELECT COUNT(*) INTO v_bounced
  FROM pdc_cheques WHERE client_id = p_client_id AND status = 'bounced';

  SELECT COUNT(*) INTO v_legal_active
  FROM legal_cases WHERE client_id = p_client_id AND outcome IS NULL;

  v_points_added    := (v_on_time * 10) + (v_answered * 5) + (v_kept * 5);
  v_points_deducted := (v_late * 15) + (v_missed * 10) + (v_broken * 20) + (v_bounced * 25) + (v_legal_active * 20);
  v_score           := GREATEST(0, LEAST(100, 50 + v_points_added - v_points_deducted));

  v_category := CASE
    WHEN v_score >= 80 THEN 'PLATINUM'
    WHEN v_score >= 60 THEN 'GOOD'
    WHEN v_score >= 40 THEN 'AT RISK'
    ELSE 'CRITICAL'
  END;

  SELECT COALESCE(SUM(i.amount_due - i.amount_paid), 0) INTO v_exposure
  FROM installments i JOIN sales s ON s.id = i.sale_id
  WHERE s.client_id = p_client_id AND i.paid_at IS NULL;

  v_calc_time := NOW();

  v_breakdown := jsonb_build_object(
    'on_time_payments',   v_on_time,
    'late_payments',      v_late,
    'answered_calls',     v_answered,
    'missed_calls',       v_missed,
    'kept_promises',      v_kept,
    'broken_promises',    v_broken,
    'pdc_bounces',        v_bounced,
    'legal_active_cases', v_legal_active,
    'points_added',       v_points_added,
    'points_deducted',    v_points_deducted,
    'final_score',        v_score
  );

  INSERT INTO client_health_scores
    (company_id, client_id, score, category, score_breakdown, total_exposure, last_calculated)
  VALUES
    (v_company_id, p_client_id, v_score, v_category, v_breakdown, v_exposure, v_calc_time)
  ON CONFLICT (client_id) DO UPDATE SET
    score           = EXCLUDED.score,
    category        = EXCLUDED.category,
    score_breakdown = EXCLUDED.score_breakdown,
    total_exposure  = EXCLUDED.total_exposure,
    last_calculated = EXCLUDED.last_calculated;

  IF NOT EXISTS (
    SELECT 1 FROM client_health_history
    WHERE client_id = p_client_id
      AND calculated_at::date = v_calc_time::date
      AND score = v_score
  ) THEN
    INSERT INTO client_health_history
      (company_id, client_id, score, category, total_exposure, score_breakdown, calculated_at)
    VALUES
      (v_company_id, p_client_id, v_score, v_category, v_exposure, v_breakdown, v_calc_time);
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'score',           v_score,
    'category',        v_category,
    'breakdown',       v_breakdown,
    'exposure',        v_exposure,
    'client_id',       p_client_id,
    'last_calculated', v_calc_time
  );
END;
$function$;

-- 2) cron entry sets the system sentinel for the whole transaction ------------
CREATE OR REPLACE FUNCTION public.cron_recalculate_health_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec         record;
  v_companies int := 0;
BEGIN
  -- Mark this as a legitimate system/cron execution so the guarded health
  -- calculation accepts the NULL _rms_caller() (no session in cron context).
  PERFORM set_config('rms.system_context', 'cron', true);
  FOR rec IN SELECT id FROM public.companies WHERE status = 'active' LOOP
    PERFORM public.recalculate_all_health_scores(rec.id);
    v_companies := v_companies + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'companies', v_companies, 'run_at', now());
END;
$function$;

-- 3) de-duplicate overlapping cron pairs (idempotent) -------------------------
--    keep: radar-health-recalc (cron_recalculate_health_all @20:00),
--          radar-daily-generate (cron_generate_radar_all @02:00)
--    drop: nightly-health-scores (dup health), nightly-radar-refresh (dup radar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='nightly-health-scores') THEN
    PERFORM cron.unschedule('nightly-health-scores');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='nightly-radar-refresh') THEN
    PERFORM cron.unschedule('nightly-radar-refresh');
  END IF;
END $$;
