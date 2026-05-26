-- ================================================================
-- NEXUNOVA RMS — MODULE 1.1 BACKEND (Recovery Intelligence Engine)
-- 2026-05-25
-- APPLIED to live DB (project itqxljtfbrppntgyfush) via MCP apply_migration
-- on 2026-05-25. Kept here in-repo so these functions are version-controlled
-- (most RMS RPCs historically lived only in the DB — see CLAUDE_RMS.md).
--
--   (a) Add a LEGAL-HISTORY factor to client health/risk scoring
--   (b) Durable health-score HISTORY for risk trend + per-client chart
-- Preserves all existing scoring logic; only ADDITIVE.
-- Verified: client with 1 active legal case scores 50 -> 30 (CRITICAL);
--           clients with none are unchanged.
-- ================================================================

-- 1) Durable append-only history of health/risk scores ------------
CREATE TABLE IF NOT EXISTS public.client_health_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  client_id       uuid NOT NULL,
  score           integer NOT NULL,
  category        text,
  total_exposure  numeric DEFAULT 0,
  score_breakdown jsonb,
  calculated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chh_client  ON public.client_health_history(client_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chh_company ON public.client_health_history(company_id, calculated_at DESC);

-- Lockdown posture: RLS on, no permissive policy. Access only via
-- SECURITY DEFINER RPCs (owner bypasses RLS); direct REST is denied.
ALTER TABLE public.client_health_history ENABLE ROW LEVEL SECURITY;

-- 2) Health/risk scoring — now legal-aware + writes history --------
CREATE OR REPLACE FUNCTION public.calculate_client_health_score(p_client_id uuid, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
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
BEGIN
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

  -- NEW: active legal cases = filed but no final outcome yet
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

  -- NEW: capture a durable history point (one per day unless score changes)
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

-- 3) Read RPC for the per-client risk/health history chart --------
CREATE OR REPLACE FUNCTION public.get_client_health_history(
  p_client_id uuid,
  p_company_id uuid,
  p_limit int DEFAULT 30
)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.calculated_at ASC), '[]'::jsonb)
  FROM (
    SELECT score, category, total_exposure, calculated_at
    FROM client_health_history
    WHERE client_id = p_client_id AND company_id = p_company_id
    ORDER BY calculated_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 365))
  ) h;
$function$;

GRANT EXECUTE ON FUNCTION public.get_client_health_history(uuid, uuid, int) TO anon, authenticated;
