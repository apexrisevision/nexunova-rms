-- ================================================================
-- NEXUNOVA RMS — PHASE 4 RADAR GAPS + COMPLETIONS
-- Migration: 20260528_phase4_radar_gaps.sql  |  2026-05-28
-- ================================================================
-- 1. radar_actions table (G5 — was missing from DB)
-- 2. get_health_score_trends RPC (G1 — replaces localStorage)
-- 3. get_weekly_at_risk_digest RPC (Build 3)
-- 4. generate_recovery_radar RPC — adds next_action per client (Build 1)
-- 5. cron_recalculate_health_all — nightly 01:00 PKT / 20:00 UTC (Build 2)
-- 6. cron_generate_radar_all — daily 07:00 PKT / 02:00 UTC (Build 2)
-- 7. cron_weekly_digest_all — Monday 09:00 PKT / 04:00 UTC (Build 3)
-- NOTE: UNIQUE(company_id, generated_date) on recovery_radar_logs
--   already exists — G6 confirmed, no action needed.
-- ================================================================

-- ── 1. radar_actions table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.radar_actions (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id   UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  radar_log_id UUID        NOT NULL REFERENCES public.recovery_radar_logs(id) ON DELETE CASCADE,
  client_id    UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action_taken TEXT        NOT NULL,
  notes        TEXT        NULL,
  created_by   TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.radar_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='radar_actions' AND policyname='deny_all_radar_actions'
  ) THEN
    CREATE POLICY "deny_all_radar_actions"
      ON public.radar_actions AS RESTRICTIVE FOR ALL
      TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.radar_actions
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE INDEX IF NOT EXISTS idx_radar_actions_log
  ON public.radar_actions (company_id, radar_log_id, client_id);

-- ── 2. get_health_score_trends — batch previous score lookup ─────────────
-- Returns jsonb object {client_id: prev_score} for all company clients.
-- "Previous" = most recent score from >12h ago (before today's recalc).
-- Used by risk board to show trend arrows without N+1 queries.
CREATE OR REPLACE FUNCTION public.get_health_score_trends(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(client_id::text, prev_score), '{}'::jsonb)
  INTO v_rows
  FROM (
    SELECT DISTINCT ON (client_id) client_id, score AS prev_score
    FROM public.client_health_history
    WHERE company_id = p_company_id
      AND calculated_at < now() - interval '12 hours'
    ORDER BY client_id, calculated_at DESC
  ) q;
  RETURN v_rows;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_health_score_trends(uuid) TO anon, authenticated;

-- ── 3. get_weekly_at_risk_digest ──────────────────────────────────────────
-- Admin/owner only. Returns top 10 worst-health clients with trend vs
-- the most recent score from >6 days ago (last week comparison).
CREATE OR REPLACE FUNCTION public.get_weekly_at_risk_digest(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   public.app_users;
  v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;
  IF v_me.company_id != p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'score')::int ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'client_id',      c.id,
      'client_name',    c.full_name,
      'client_code',    c.client_code,
      'phone',          c.phone_primary,
      'score',          chs.score,
      'category',       chs.category,
      'total_exposure', chs.total_exposure,
      'prev_score',     prev.prev_score,
      'trend',          CASE
                          WHEN prev.prev_score IS NULL          THEN 'new'
                          WHEN chs.score < prev.prev_score - 2  THEN 'deteriorating'
                          WHEN chs.score > prev.prev_score + 2  THEN 'improving'
                          ELSE 'stable'
                        END
    ) AS r
    FROM public.client_health_scores chs
    JOIN public.clients c ON c.id = chs.client_id AND c.company_id = p_company_id
    LEFT JOIN LATERAL (
      SELECT score AS prev_score
      FROM public.client_health_history chh
      WHERE chh.client_id = chs.client_id
        AND chh.company_id = p_company_id
        AND chh.calculated_at < now() - interval '6 days'
      ORDER BY chh.calculated_at DESC
      LIMIT 1
    ) prev ON true
    WHERE chs.company_id = p_company_id AND c.status = 'active'
    ORDER BY chs.score ASC
    LIMIT 10
  ) q;

  RETURN jsonb_build_object('success', true, 'rows', v_rows, 'generated_at', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_weekly_at_risk_digest(uuid) TO authenticated;

-- ── 4. generate_recovery_radar — adds next_action per client ─────────────
-- Adds 3 new DECLARE vars + next_action logic (8-rule priority chain)
-- + next_action / next_action_message fields to each client in top_clients.
CREATE OR REPLACE FUNCTION public.generate_recovery_radar(
  p_company_id   uuid,
  p_target_date  date    DEFAULT CURRENT_DATE,
  p_top_n        integer DEFAULT 5,
  p_generated_by text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec          RECORD;
  v_all_scores   JSONB    := '[]'::JSONB;
  v_reasons      TEXT[];
  v_pat_score    INTEGER  := 0;
  v_sal_score    INTEGER  := 0;
  v_pro_score    INTEGER  := 0;
  v_con_score    INTEGER  := 0;
  v_ovd_score    INTEGER  := 0;
  v_pdc_penalty  INTEGER  := 0;
  v_agt_bonus    INTEGER  := 0;
  v_final_score  INTEGER;
  v_pay_days     INTEGER[];
  v_pay_count    INTEGER;
  v_mode_day     INTEGER;
  v_stddev       NUMERIC;
  v_ovd_days     INTEGER;
  v_ovd_amount   NUMERIC;
  v_total_out    NUMERIC;
  v_last_cdate   DATE;
  v_con_outcome  TEXT;
  v_con_days     INTEGER;
  v_promise_date DATE;
  v_promise_diff INTEGER;
  v_kept_cnt     INTEGER;
  v_total_cnt    INTEGER;
  v_bounce_cnt   INTEGER;
  v_sale_id      UUID;
  v_unit_no      TEXT;
  v_project_nm   TEXT;
  v_target_day   INTEGER;
  v_analyzed     INTEGER := 0;
  v_total_pot    NUMERIC := 0;
  v_top_clients  JSONB;
  v_result_row   recovery_radar_logs;
  v_agent_found  BOOLEAN;
  v_ord          TEXT;
  -- next_action additions
  v_next_action     TEXT    := 'send_reminder';
  v_next_action_msg TEXT    := 'Send payment reminder via WhatsApp';
  v_legal_cnt       INTEGER := 0;
  v_broken_cnt      INTEGER := 0;
  v_pdc_30d_bounce  INTEGER := 0;
BEGIN
  v_target_day := EXTRACT(DAY FROM p_target_date)::INTEGER;

  v_sal_score := CASE
    WHEN v_target_day = 1            THEN 20
    WHEN v_target_day IN (2, 3)      THEN 15
    WHEN v_target_day IN (15, 16)    THEN 12
    WHEN v_target_day = 25           THEN 8
    ELSE 0
  END;

  FOR v_rec IN
    SELECT DISTINCT c.id AS client_id, c.full_name AS client_name,
           c.phone_primary AS phone, c.client_code
    FROM   clients c
    JOIN   sales s        ON s.client_id  = c.id
                         AND s.company_id = p_company_id
                         AND s.status     = 'active'
    JOIN   installments i ON i.sale_id    = s.id
                         AND i.paid_at    IS NULL
    WHERE  c.company_id = p_company_id
      AND  c.status     = 'active'
  LOOP
    v_analyzed    := v_analyzed + 1;
    -- Reset all per-client variables
    v_reasons      := ARRAY[]::TEXT[];
    v_pat_score    := 0;
    v_pro_score    := 0;
    v_con_score    := 0;
    v_ovd_score    := 0;
    v_pdc_penalty  := 0;
    v_agt_bonus    := 0;
    v_sale_id      := NULL;
    v_unit_no      := NULL;
    v_project_nm   := NULL;
    v_last_cdate   := NULL;
    v_con_outcome  := NULL;
    v_con_days     := NULL;
    v_promise_date := NULL;
    v_next_action     := 'send_reminder';
    v_next_action_msg := 'Send payment reminder via WhatsApp';
    v_legal_cnt       := 0;
    v_broken_cnt      := 0;
    v_pdc_30d_bounce  := 0;

    SELECT s.id, u.unit_no, COALESCE(pr.project_name, '')
    INTO   v_sale_id, v_unit_no, v_project_nm
    FROM   sales s
    LEFT JOIN units    u  ON u.id  = s.unit_id
    LEFT JOIN projects pr ON pr.id = u.project_id
    WHERE  s.client_id  = v_rec.client_id
      AND  s.company_id = p_company_id
      AND  s.status     = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1;

    SELECT
      MIN(CASE WHEN i.due_date < p_target_date THEN (p_target_date - i.due_date) END)::INTEGER,
      COALESCE(SUM(CASE WHEN i.due_date < p_target_date THEN (i.amount_due - i.amount_paid) ELSE 0 END), 0),
      COALESCE(SUM(i.amount_due - i.amount_paid), 0)
    INTO v_ovd_days, v_ovd_amount, v_total_out
    FROM installments i
    JOIN sales s ON s.id = i.sale_id AND s.company_id = p_company_id
    WHERE s.client_id = v_rec.client_id AND i.paid_at IS NULL;

    IF v_total_out <= 0 THEN CONTINUE; END IF;

    -- Factor 1: Payment Pattern
    SELECT ARRAY_AGG(EXTRACT(DAY FROM p.payment_date)::INTEGER)
    INTO   v_pay_days
    FROM   payments p
    WHERE  p.client_id  = v_rec.client_id
      AND  p.company_id = p_company_id
      AND  p.payment_date >= p_target_date - INTERVAL '6 months';

    v_pay_count := COALESCE(ARRAY_LENGTH(v_pay_days, 1), 0);

    IF v_pay_count >= 2 THEN
      SELECT
        (SELECT d FROM UNNEST(v_pay_days) d GROUP BY d ORDER BY COUNT(*) DESC, d LIMIT 1),
        COALESCE(STDDEV(d::NUMERIC), 0)
      INTO v_mode_day, v_stddev
      FROM UNNEST(v_pay_days) d;

      v_ord := CASE WHEN v_mode_day IN (1,21,31) THEN 'st'
                    WHEN v_mode_day IN (2,22)    THEN 'nd'
                    WHEN v_mode_day IN (3,23)    THEN 'rd' ELSE 'th' END;

      IF    v_stddev <= 2 AND ABS(v_target_day - v_mode_day) <= 2 THEN
        v_pat_score := 30;
        v_reasons   := array_append(v_reasons, 'Pays on ' || v_mode_day || v_ord || ' regularly');
      ELSIF v_stddev <= 5 AND ABS(v_target_day - v_mode_day) <= 5 THEN
        v_pat_score := 20;
        v_reasons   := array_append(v_reasons, 'Usually pays around ' || v_mode_day || v_ord);
      ELSIF v_pay_count >= 3 THEN
        v_pat_score := 10;
      END IF;
    END IF;

    -- Factor 2: Salary
    IF v_sal_score > 0 THEN
      v_reasons := array_append(v_reasons, 'Salary date match (' || v_target_day ||
        CASE WHEN v_target_day IN (1,21,31) THEN 'st' WHEN v_target_day IN (2,22) THEN 'nd'
             WHEN v_target_day IN (3,23) THEN 'rd' ELSE 'th' END || ')');
    END IF;

    -- Factor 3: Promise
    SELECT promise_date INTO v_promise_date
    FROM   payment_promises
    WHERE  client_id  = v_rec.client_id
      AND  company_id = p_company_id
      AND  status     = 'pending'
      AND  promise_date BETWEEN p_target_date - 1 AND p_target_date + 3
    ORDER BY ABS(promise_date - p_target_date) ASC
    LIMIT 1;

    IF v_promise_date IS NOT NULL THEN
      v_promise_diff := v_promise_date - p_target_date;
      IF    v_promise_diff = 0     THEN v_pro_score := 25; v_reasons := array_append(v_reasons, 'Promise to pay today');
      ELSIF ABS(v_promise_diff)= 1 THEN v_pro_score := 20;
            v_reasons := array_append(v_reasons, CASE WHEN v_promise_diff>0 THEN 'Promise tomorrow' ELSE 'Promise yesterday' END);
      ELSE  v_pro_score := 10; v_reasons := array_append(v_reasons, 'Promise in '||v_promise_diff||' days');
      END IF;

      SELECT COUNT(*) FILTER (WHERE status='kept'),
             COUNT(*) FILTER (WHERE status IN ('kept','broken'))
      INTO   v_kept_cnt, v_total_cnt
      FROM   payment_promises
      WHERE  client_id=v_rec.client_id AND company_id=p_company_id;

      IF v_total_cnt >= 3 AND v_kept_cnt::NUMERIC/v_total_cnt >= 0.70 THEN
        v_pro_score := v_pro_score + 5;
        v_reasons   := array_append(v_reasons,'Good promise history ('||ROUND(v_kept_cnt::NUMERIC/v_total_cnt*100)||'% kept)');
      END IF;
    END IF;

    -- Factor 4: Contact Recency
    SELECT cl.contact_date,
      CASE WHEN cl.call_status='answered'            THEN 'answered'
           WHEN cl.response_received ILIKE 'answer%' THEN 'answered'
           WHEN cl.promise_to_pay=true               THEN 'promised'
           WHEN cl.response_received ILIKE 'refus%'  THEN 'refused'
           WHEN cl.response_received ILIKE 'reject%' THEN 'refused'
           ELSE 'no_answer' END
    INTO v_last_cdate, v_con_outcome
    FROM contact_logs cl
    WHERE cl.client_id=v_rec.client_id AND cl.company_id=p_company_id
    ORDER BY cl.contact_date DESC, cl.created_at DESC LIMIT 1;

    IF v_last_cdate IS NOT NULL THEN
      v_con_days := (p_target_date - v_last_cdate);
      IF    v_con_days<=1  AND v_con_outcome IN ('answered','promised') THEN
        v_con_score:=10; v_reasons:=array_append(v_reasons,'Answered '||CASE WHEN v_con_days=0 THEN 'today' ELSE 'yesterday' END);
      ELSIF v_con_days<=3  AND v_con_outcome IN ('answered','promised') THEN
        v_con_score:=7;  v_reasons:=array_append(v_reasons,'Positive contact '||v_con_days||'d ago');
      ELSIF v_con_days<=7  AND v_con_outcome<>'refused' THEN v_con_score:=4;
      ELSIF v_con_days<=14                               THEN v_con_score:=2;
      END IF;
    END IF;

    -- Factor 5: Overdue Sweet Spot
    IF v_ovd_days IS NOT NULL THEN
      v_ovd_score := CASE WHEN v_ovd_days BETWEEN  7 AND 30 THEN 10
                          WHEN v_ovd_days BETWEEN 31 AND 60 THEN 7
                          WHEN v_ovd_days BETWEEN 61 AND 90 THEN 5
                          WHEN v_ovd_days BETWEEN  1 AND  6 THEN 4
                          ELSE 2 END;
      IF v_ovd_days BETWEEN 7 AND 30 THEN
        v_reasons := array_append(v_reasons, v_ovd_days||'-day overdue (sweet spot)');
      END IF;
    END IF;

    -- Factor 6: PDC Penalty (12-month bounce history)
    SELECT COUNT(*) INTO v_bounce_cnt
    FROM   pdc_cheques
    WHERE  client_id=v_rec.client_id AND company_id=p_company_id AND status='bounced'
      AND  COALESCE(bounce_date, created_at::date) >= p_target_date - INTERVAL '12 months';

    v_pdc_penalty := LEAST(v_bounce_cnt*5, 15);
    IF v_bounce_cnt > 0 THEN
      v_reasons := array_append(v_reasons, v_bounce_cnt||' PDC bounce(s) in 12 months');
    END IF;

    -- ── Next Best Action (priority order — first match wins) ──────────────
    -- Rule 1: active legal case
    SELECT COUNT(*) INTO v_legal_cnt
    FROM legal_cases
    WHERE client_id = v_rec.client_id AND company_id = p_company_id
      AND outcome IS NULL;

    -- Rule 2: PDC bounce in last 30 days
    SELECT COUNT(*) INTO v_pdc_30d_bounce
    FROM pdc_cheques
    WHERE client_id = v_rec.client_id AND company_id = p_company_id
      AND status = 'bounced'
      AND COALESCE(bounce_date, created_at::date) >= p_target_date - 30;

    -- Rule 3: broken promises count
    SELECT COUNT(*) INTO v_broken_cnt
    FROM payment_promises
    WHERE client_id = v_rec.client_id AND company_id = p_company_id
      AND status = 'broken';

    IF v_legal_cnt > 0 THEN
      v_next_action     := 'coordinate_legal';
      v_next_action_msg := 'Legal case active — coordinate with lawyer';
    ELSIF v_pdc_30d_bounce > 0 THEN
      v_next_action     := 'hold_pdc';
      v_next_action_msg := 'Recent PDC bounce — hold cheque for re-deposit or replacement';
    ELSIF v_broken_cnt >= 3 THEN
      v_next_action     := 'escalate';
      v_next_action_msg := 'Multiple broken promises — escalate to senior officer';
    ELSIF COALESCE(v_ovd_days, 0) > 90 THEN
      v_next_action     := 'legal_notice';
      v_next_action_msg := 'Severely overdue — send legal notice';
    ELSIF COALESCE(v_ovd_days, 0) BETWEEN 30 AND 90
          AND (v_last_cdate IS NULL OR COALESCE(v_con_days, 999) > 14) THEN
      v_next_action     := 'field_visit';
      v_next_action_msg := 'No contact for 14+ days — schedule field visit';
    ELSIF COALESCE(v_ovd_days, 0) BETWEEN 7 AND 30 AND v_promise_date IS NOT NULL THEN
      v_next_action     := 'follow_up_promise';
      v_next_action_msg := 'Active promise — follow up on commitment';
    ELSIF COALESCE(v_ovd_days, 0) BETWEEN 1 AND 30 THEN
      v_next_action     := 'call';
      v_next_action_msg := 'Overdue — call client today';
    -- else default 'send_reminder' already set
    END IF;

    -- Factor 7: Agent Boost
    SELECT EXISTS (
      SELECT 1 FROM contact_logs
      WHERE client_id=v_rec.client_id AND company_id=p_company_id
        AND recovery_agent_id IS NOT NULL AND contact_date >= p_target_date-7
    ) INTO v_agent_found;
    IF v_agent_found THEN v_agt_bonus:=5; END IF;

    v_final_score := GREATEST(0, LEAST(100,
      v_pat_score+v_sal_score+v_pro_score+v_con_score+v_ovd_score+v_agt_bonus-v_pdc_penalty
    ));

    v_all_scores := v_all_scores || jsonb_build_object(
      'client_id',           v_rec.client_id,
      'client_name',         v_rec.client_name,
      'client_code',         v_rec.client_code,
      'phone',               v_rec.phone,
      'sale_id',             v_sale_id,
      'unit_no',             v_unit_no,
      'project_name',        v_project_nm,
      'final_score',         v_final_score,
      'overdue_amount',      v_ovd_amount,
      'total_outstanding',   v_total_out,
      'oldest_overdue_days', v_ovd_days,
      'reasons',             to_jsonb(v_reasons),
      'breakdown',           jsonb_build_object(
        'pattern',    v_pat_score, 'salary',      v_sal_score,
        'promise',    v_pro_score, 'contact',     v_con_score,
        'overdue',    v_ovd_score, 'pdc_penalty', -v_pdc_penalty,
        'agent_bonus',v_agt_bonus
      ),
      'next_action',         v_next_action,
      'next_action_message', v_next_action_msg
    );
  END LOOP;

  WITH ranked AS (
    SELECT elem FROM jsonb_array_elements(v_all_scores) elem
    ORDER BY (elem->>'final_score')::INTEGER DESC LIMIT p_top_n
  )
  SELECT COALESCE(jsonb_agg(elem),'[]'::JSONB) INTO v_top_clients FROM ranked;

  SELECT COALESCE(SUM((c->>'overdue_amount')::NUMERIC),0) INTO v_total_pot
  FROM   jsonb_array_elements(COALESCE(v_top_clients,'[]')) c;

  INSERT INTO recovery_radar_logs
    (company_id,generated_date,generated_at,generated_by,
     top_clients,total_potential_recovery,clients_analyzed,algorithm_version)
  VALUES
    (p_company_id,p_target_date,NOW(),p_generated_by,
     COALESCE(v_top_clients,'[]'),v_total_pot,v_analyzed,'v2.0')
  ON CONFLICT (company_id,generated_date) DO UPDATE SET
    generated_at=NOW(), generated_by=EXCLUDED.generated_by,
    top_clients=EXCLUDED.top_clients,
    total_potential_recovery=EXCLUDED.total_potential_recovery,
    clients_analyzed=EXCLUDED.clients_analyzed,
    algorithm_version=EXCLUDED.algorithm_version
  RETURNING * INTO v_result_row;

  RETURN row_to_json(v_result_row)::JSONB;
END;
$$;

-- ── 5. cron_recalculate_health_all — 01:00 PKT / 20:00 UTC ───────────────
CREATE OR REPLACE FUNCTION public.cron_recalculate_health_all()
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec         record;
  v_companies int := 0;
BEGIN
  FOR rec IN SELECT id FROM public.companies WHERE status = 'active' LOOP
    PERFORM public.recalculate_all_health_scores(rec.id);
    v_companies := v_companies + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'companies', v_companies, 'run_at', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.cron_recalculate_health_all() TO anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('radar-health-recalc'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('radar-health-recalc', '0 20 * * *',
  $cron$ SET search_path = public; SELECT public.cron_recalculate_health_all(); $cron$);

-- ── 6. cron_generate_radar_all — 07:00 PKT / 02:00 UTC ───────────────────
CREATE OR REPLACE FUNCTION public.cron_generate_radar_all()
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec       record;
  v_today   date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_companies int := 0;
BEGIN
  FOR rec IN SELECT id FROM public.companies WHERE status = 'active' LOOP
    PERFORM public.generate_recovery_radar(rec.id, v_today, 10, 'system');
    v_companies := v_companies + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'companies', v_companies, 'run_date', v_today);
END;
$$;
GRANT EXECUTE ON FUNCTION public.cron_generate_radar_all() TO anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('radar-daily-generate'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('radar-daily-generate', '0 2 * * *',
  $cron$ SET search_path = public; SELECT public.cron_generate_radar_all(); $cron$);

-- ── 7. cron_weekly_digest_all — Monday 09:00 PKT / 04:00 UTC ─────────────
CREATE OR REPLACE FUNCTION public.cron_weekly_digest_all()
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec          record;
  admin_rec    record;
  rows         jsonb;
  msg          text;
  row_item     jsonb;
  i            int;
  v_companies  int := 0;
BEGIN
  FOR rec IN SELECT id, name FROM public.companies WHERE status = 'active' LOOP

    -- Top 10 worst-health clients for this company
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'score')::int ASC), '[]'::jsonb) INTO rows
    FROM (
      SELECT jsonb_build_object(
        'client_name',    c.full_name,
        'score',          chs.score,
        'category',       chs.category,
        'total_exposure', chs.total_exposure
      ) AS r
      FROM public.client_health_scores chs
      JOIN public.clients c ON c.id = chs.client_id AND c.company_id = rec.id
      WHERE chs.company_id = rec.id AND c.status = 'active'
      ORDER BY chs.score ASC LIMIT 10
    ) q;

    IF jsonb_array_length(rows) = 0 THEN CONTINUE; END IF;

    -- Format WhatsApp message
    msg := '📊 *Weekly Recovery Digest*' || E'\n';
    msg := msg || rec.name || ' — Top at-risk accounts this week:' || E'\n\n';
    FOR i IN 0..LEAST(jsonb_array_length(rows)-1, 9) LOOP
      row_item := rows->i;
      msg := msg
        || (i+1)::text || '. *' || COALESCE(row_item->>'client_name','—') || '*'
        || ' — Score: ' || COALESCE(row_item->>'score','?')
        || ' | Overdue: PKR '
        || to_char(COALESCE((row_item->>'total_exposure')::numeric,0), 'FM9,99,99,999')
        || ' (' || COALESCE(row_item->>'category','—') || ')' || E'\n';
    END LOOP;
    msg := msg || E'\nOpen Recovery Radar in RMS for details and next actions.';

    -- Find company admin/owner
    SELECT id, phone, email INTO admin_rec
    FROM public.app_users
    WHERE company_id = rec.id
      AND role IN ('admin','owner')
      AND (status IS NULL OR status = 'active')
    ORDER BY (role = 'owner') DESC LIMIT 1;

    IF NOT FOUND THEN CONTINUE; END IF;

    -- Enqueue WhatsApp via Module 7 dispatch
    IF admin_rec.phone IS NOT NULL AND trim(admin_rec.phone) <> '' THEN
      PERFORM public.enqueue_message(
        rec.id,
        jsonb_build_object(
          'channel',    'whatsapp',
          'to_address', admin_rec.phone,
          'body',       msg,
          'category',   'weekly_digest'
        )
      );
    END IF;

    v_companies := v_companies + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'companies_sent', v_companies, 'run_at', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.cron_weekly_digest_all() TO anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('radar-weekly-digest'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('radar-weekly-digest', '0 4 * * 1',
  $cron$ SET search_path = public; SELECT public.cron_weekly_digest_all(); $cron$);
