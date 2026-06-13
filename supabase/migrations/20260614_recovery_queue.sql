-- ════════════════════════════════════════════════════════════════════════════
-- SUBAH KI LIST (Smart Recovery Queue) + owner 8AM daily-digest builder
-- 2026-06-14
--
--  • get_recovery_queue(company, officer, project, date, limit) — NEW live,
--    officer-scoped, urgency-ranked queue. Computed-on-read, SECURITY DEFINER.
--    Two tiers on the call list (A time-critical · B collectible) + Tier C
--    (past-cutoff / dead) routed to an Escalate section. Money reconciles to
--    get_recovery_position.closing to the paisa (Σ overdue verified diff 0 on FG).
--  • cron_daily_digest_all() — owner 8am digest BUILDER, near-clone of
--    cron_weekly_digest_all, composed from existing readers
--    (get_daily_collections + get_today_snapshot + promise/PDC aggregates),
--    dispatched via enqueue_message('daily_digest'). dedup_key = idempotent/day.
--    !! The cron.schedule() is intentionally LEFT OUT — schedule as a separate,
--       owner-confirmed step (it sends a real WhatsApp to each company owner).
--
-- Owner-locked constants: no-contact N=14 · 90-day window 75–90 · big-payment
-- ≥500k · tier weights 0.50 amount / 0.30 propensity / 0.20 staleness · health
-- fallback → paid_pct → neutral 40.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_recovery_queue(
  p_company_id uuid,
  p_officer_id uuid DEFAULT NULL,   -- NULL = caller; admin may pass any / none (company-wide)
  p_project_id uuid DEFAULT NULL,   -- NULL = all of the resolved scope's projects
  p_date       date DEFAULT CURRENT_DATE,
  p_limit      int  DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me       public.app_users;
  v_is_admin boolean;
  v_officer  uuid;
  v_projects uuid[];
  v_today    date := COALESCE(p_date, CURRENT_DATE);
  v_n        int  := 14;     -- no-contact threshold (owner-locked)
  v_empty    jsonb := jsonb_build_object('as_of', to_char(v_today,'YYYY-MM-DD'),
                'queue','[]'::jsonb,
                'counts', jsonb_build_object('tier_a',0,'tier_b',0,'escalate',0,'total',0));
  v_result   jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN v_empty; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id
     THEN RETURN v_empty; END IF;                       -- cross-tenant → []
  v_is_admin := public._rms_is_admin(v_me);

  -- non-admin forced to self; admin may pass any officer or none (company-wide)
  v_officer := CASE WHEN v_is_admin THEN p_officer_id ELSE v_me.id END;

  IF v_officer IS NULL THEN
    SELECT array_agg(id) INTO v_projects FROM public.projects
     WHERE company_id=p_company_id AND (p_project_id IS NULL OR id=p_project_id);
  ELSE
    SELECT array_agg(upa.project_id) INTO v_projects
      FROM public.user_project_assignments upa
     WHERE upa.user_id=v_officer AND upa.company_id=p_company_id AND upa.is_active=true
       AND (p_project_id IS NULL OR upa.project_id=p_project_id);
  END IF;
  IF v_projects IS NULL OR array_length(v_projects,1) IS NULL THEN
    RETURN v_empty || jsonb_build_object('no_projects', (v_officer IS NOT NULL));
  END IF;

  WITH
  asale AS (
    SELECT s.id AS sale_id, s.client_id, s.unit_id, s.project_id, s.net_amount
    FROM public.sales s
    WHERE s.company_id=p_company_id AND s.status<>'cancelled'
      AND COALESCE(s.is_active, s.status='active') AND s.project_id = ANY(v_projects)
  ),
  iagg AS (   -- ties to get_recovery_position.closing (verified diff=0)
    SELECT i.sale_id,
      COALESCE(SUM(GREATEST(i.amount_due-i.amount_paid,0)),0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.due_date<v_today
                        THEN GREATEST(i.amount_due-i.amount_paid,0) ELSE 0 END),0) AS overdue_amt,
      MIN(i.due_date) FILTER (WHERE i.amount_due>i.amount_paid AND i.due_date<v_today) AS oldest_overdue,
      SUM(i.amount_paid) AS paid_sum, SUM(i.amount_due) AS due_sum
    FROM public.installments i JOIN asale s ON s.sale_id=i.sale_id
    WHERE i.company_id=p_company_id GROUP BY i.sale_id
  ),
  paylast AS (
    SELECT p.sale_id, MAX(p.payment_date) AS last_pay
    FROM public.payments p JOIN asale s ON s.sale_id=p.sale_id
    WHERE p.company_id=p_company_id AND p.status<>'cancelled' GROUP BY p.sale_id
  ),
  conlast AS (
    SELECT c.client_id, MAX(c.contact_date) AS last_contact
    FROM public.contact_logs c WHERE c.company_id=p_company_id AND c.client_id IS NOT NULL
    GROUP BY c.client_id
  ),
  prom AS (
    SELECT pp.sale_id,
      bool_or(pp.status='broken' OR (pp.status='pending' AND pp.promise_date<v_today)) AS has_broken,
      bool_or(pp.status='pending' AND pp.promise_date=v_today)                          AS has_due_today,
      count(*) FILTER (WHERE pp.status='broken')                                          AS broken_cnt,
      (array_agg(jsonb_build_object('date',pp.promise_date,'status',pp.status,'amount',pp.promised_amount)
                 ORDER BY pp.promise_date DESC))[1]                                       AS last_promise
    FROM public.payment_promises pp JOIN asale s ON s.sale_id=pp.sale_id
    WHERE pp.company_id=p_company_id GROUP BY pp.sale_id
  ),
  pdc AS (
    SELECT pc.sale_id,
      bool_or(pc.cheque_date=v_today)   AS pdc_today,
      bool_or(pc.cheque_date=v_today+1) AS pdc_tomorrow,
      (array_agg(jsonb_build_object('cheque_no',pc.cheque_no,'amount',pc.amount,'date',pc.cheque_date)
                 ORDER BY pc.cheque_date))[1] AS next_pdc
    FROM public.pdc_cheques pc JOIN asale s ON s.sale_id=pc.sale_id
    WHERE pc.company_id=p_company_id AND pc.status IN ('pending','deposited')
      AND pc.cheque_date BETWEEN v_today AND v_today+1
    GROUP BY pc.sale_id
  ),
  legal AS (
    SELECT lc.client_id, count(*) AS legal_cnt FROM public.legal_cases lc
    WHERE lc.company_id=p_company_id AND lc.outcome IS NULL GROUP BY lc.client_id
  ),
  health AS (
    SELECT chs.client_id, chs.score FROM public.client_health_scores chs
    WHERE chs.company_id=p_company_id
  ),
  base AS (
    SELECT a.sale_id, a.client_id, a.unit_id, a.project_id,
      cl.full_name AS client_name, cl.client_code, cl.phone_primary AS phone,
      u.unit_no, pr.project_name,
      ia.outstanding, ia.overdue_amt,
      CASE WHEN ia.oldest_overdue IS NULL THEN 0 ELSE GREATEST(0, v_today-ia.oldest_overdue) END AS oldest_overdue_days,
      ROUND(COALESCE(ia.paid_sum,0)/NULLIF(ia.due_sum,0)*100,1) AS paid_pct,
      pl.last_pay, co.last_contact,
      CASE WHEN co.last_contact IS NULL THEN NULL ELSE (v_today-co.last_contact) END AS days_since_contact,
      COALESCE(pm.has_broken,false) AS r_broken, COALESCE(pm.has_due_today,false) AS r_promise_today,
      COALESCE(pm.broken_cnt,0) AS broken_cnt, pm.last_promise,
      COALESCE(pc.pdc_today,false) AS r_pdc_today, COALESCE(pc.pdc_tomorrow,false) AS r_pdc_tomorrow,
      pc.next_pdc, COALESCE(lg.legal_cnt,0) AS legal_cnt, h.score AS health_score
    FROM asale a
    JOIN public.units u ON u.id=a.unit_id AND u.company_id=p_company_id
    LEFT JOIN public.clients cl ON cl.id=a.client_id
    LEFT JOIN public.projects pr ON pr.id=a.project_id
    JOIN iagg ia ON ia.sale_id=a.sale_id
    LEFT JOIN paylast pl ON pl.sale_id=a.sale_id
    LEFT JOIN conlast co ON co.client_id=a.client_id
    LEFT JOIN prom pm ON pm.sale_id=a.sale_id
    LEFT JOIN pdc  pc ON pc.sale_id=a.sale_id
    LEFT JOIN legal lg ON lg.client_id=a.client_id
    LEFT JOIN health h ON h.client_id=a.client_id
    WHERE ia.outstanding > 0.005
  ),
  scored AS (
    SELECT b.*,
      COALESCE(b.health_score, b.paid_pct, 40)::numeric AS propensity,
      CASE WHEN b.health_score IS NOT NULL THEN 'health'
           WHEN b.paid_pct    IS NOT NULL THEN 'paid_pct' ELSE 'default' END AS prop_src,
      LEAST(100, ROUND(b.overdue_amt/100000.0))            AS amount_pts,
      LEAST(100, COALESCE(b.days_since_contact, 999))      AS staleness_pts,
      (b.oldest_overdue_days BETWEEN 75 AND 90)            AS r_90approach,
      (b.oldest_overdue_days BETWEEN 1 AND 7 AND b.broken_cnt=0 AND NOT COALESCE(b.r_broken,false)) AS r_new_overdue,
      ((b.days_since_contact IS NULL OR b.days_since_contact > v_n) AND b.overdue_amt>0) AS r_no_contact,
      (b.oldest_overdue_days > 90 AND (b.broken_cnt>=3 OR b.legal_cnt>0 OR COALESCE(b.paid_pct,0) < 50)) AS dead
    FROM base b
  ),
  tiered AS (
    SELECT s.*,
      (s.amount_pts>=30 AND (COALESCE(s.health_score,0)>=60 OR s.paid_pct>=50
            OR (s.last_pay IS NOT NULL AND s.last_pay >= v_today-60))) AS r_high_recover,
      CASE
        WHEN s.r_broken OR s.r_promise_today OR s.r_pdc_today OR s.r_90approach OR s.r_pdc_tomorrow THEN 'A'
        WHEN s.dead THEN 'C' ELSE 'B' END AS tier
    FROM scored s
  ),
  pri AS (
    SELECT t.*,
      CASE t.tier
        WHEN 'A' THEN 30000
          + (CASE WHEN t.r_broken THEN 500 WHEN t.r_promise_today THEN 400
                  WHEN t.r_pdc_today THEN 350 WHEN t.r_90approach THEN 300
                  WHEN t.r_pdc_tomorrow THEN 250 ELSE 0 END) + t.amount_pts
        WHEN 'B' THEN 20000
          + ROUND(0.50*t.amount_pts + 0.30*t.propensity + 0.20*t.staleness_pts)
          + (CASE WHEN t.r_new_overdue THEN 8 ELSE 0 END)
          + (CASE WHEN t.r_high_recover THEN 12 ELSE 0 END)
          + (CASE WHEN t.r_no_contact THEN 6 ELSE 0 END)
        ELSE 10000 + t.amount_pts END AS priority,
      array_remove(ARRAY[
        CASE WHEN t.r_broken        THEN jsonb_build_object('code','R1','label','Broken promise','tone','danger') END,
        CASE WHEN t.r_promise_today THEN jsonb_build_object('code','R2','label','Promise due today','tone','warning') END,
        CASE WHEN t.r_pdc_today     THEN jsonb_build_object('code','R3','label','PDC due today','tone','warning') END,
        CASE WHEN t.r_pdc_tomorrow  THEN jsonb_build_object('code','R3','label','PDC due tomorrow','tone','warning') END,
        CASE WHEN t.r_90approach    THEN jsonb_build_object('code','R4','label','90-day cutoff approaching','tone','danger') END,
        CASE WHEN t.dead            THEN jsonb_build_object('code','CUT','label','Past 90-day cutoff','tone','danger') END,
        CASE WHEN t.r_new_overdue   THEN jsonb_build_object('code','R5','label','New overdue','tone','info') END,
        CASE WHEN t.r_high_recover  THEN jsonb_build_object('code','R6','label','High recoverable','tone','success') END,
        CASE WHEN t.r_no_contact    THEN jsonb_build_object('code','R7','label',CASE WHEN t.days_since_contact IS NULL THEN 'No recent contact' ELSE 'No contact '||t.days_since_contact||'d' END,'tone','muted') END
      ]::jsonb[], NULL) AS reason_arr,
      CASE
        WHEN t.legal_cnt>0                                   THEN 'coordinate_legal'
        WHEN t.r_pdc_today OR t.r_pdc_tomorrow               THEN 'hold_pdc'
        WHEN t.broken_cnt>=3                                 THEN 'escalate'
        WHEN t.tier='C'                                      THEN 'legal_notice'
        WHEN t.r_broken OR t.r_promise_today                 THEN 'follow_up_promise'
        WHEN t.r_90approach                                  THEN 'field_visit'
        WHEN t.r_no_contact AND t.oldest_overdue_days BETWEEN 30 AND 90 THEN 'field_visit'
        ELSE 'call' END AS suggested_action
    FROM tiered t
  )
  SELECT jsonb_build_object(
    'as_of', to_char(v_today,'YYYY-MM-DD'),
    'scope', jsonb_build_object('officer', v_officer, 'admin', v_is_admin, 'project_count', array_length(v_projects,1)),
    'queue', COALESCE((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.priority DESC, q.overdue_amt DESC)
      FROM (
        SELECT p.client_id, p.client_name, p.client_code, p.phone, p.sale_id, p.unit_id,
               p.unit_no, p.project_name, p.outstanding, p.overdue_amt, p.oldest_overdue_days,
               p.paid_pct, to_char(p.last_contact,'YYYY-MM-DD') AS last_contact_date,
               p.days_since_contact, to_char(p.last_pay,'YYYY-MM-DD') AS last_payment_date,
               p.last_promise, p.next_pdc, p.tier, p.priority,
               jsonb_build_object('score', ROUND(p.propensity), 'source', p.prop_src) AS propensity,
               to_jsonb(p.reason_arr) AS reasons, p.suggested_action
        FROM pri p ORDER BY p.priority DESC, p.overdue_amt DESC LIMIT p_limit
      ) q
    ), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
        'tier_a',   count(*) FILTER (WHERE tier='A'),
        'tier_b',   count(*) FILTER (WHERE tier='B'),
        'escalate', count(*) FILTER (WHERE tier='C'),
        'total',    count(*)) FROM pri)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- Reader: match get_recovery_position's grants exactly (authenticated + anon + service_role,
-- NO blanket PUBLIC). The function self-guards via _rms_caller() (null caller / cross-tenant → []).
REVOKE EXECUTE ON FUNCTION public.get_recovery_queue(uuid,uuid,uuid,date,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_recovery_queue(uuid,uuid,uuid,date,int) TO authenticated, anon, service_role;

-- ── Owner 8AM daily digest BUILDER (NOT scheduled here) ─────────────────────────
CREATE OR REPLACE FUNCTION public.cron_daily_digest_all()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE rec record; adm record; v_y date; v_t date;
        v_coll numeric; v_snap jsonb; v_bk_cnt int; v_bk_amt numeric;
        v_pdc_cnt int; v_pdc_amt numeric; v_big numeric; msg text; n int:=0;
BEGIN
  v_t := CURRENT_DATE; v_y := CURRENT_DATE-1;
  FOR rec IN SELECT id, company_name AS name FROM public.companies WHERE status='active' LOOP
    SELECT COALESCE(SUM((e->>'amount')::numeric),0) INTO v_coll
      FROM jsonb_array_elements(public.get_daily_collections(rec.id,NULL,v_y,v_y)) e;
    v_snap := public.get_today_snapshot(rec.id, NULL, v_t);
    SELECT count(*), COALESCE(SUM(promised_amount),0) INTO v_bk_cnt, v_bk_amt
      FROM public.payment_promises
     WHERE company_id=rec.id AND (status='broken' OR (status='pending' AND promise_date<v_t));
    SELECT count(*), COALESCE(SUM(amount),0) INTO v_pdc_cnt, v_pdc_amt
      FROM public.pdc_cheques
     WHERE company_id=rec.id AND status IN ('pending','deposited') AND cheque_date=v_t;
    SELECT COALESCE(SUM(amount),0) INTO v_big
      FROM public.payments
     WHERE company_id=rec.id AND status<>'cancelled' AND payment_date=v_y AND amount>=500000;

    -- skip a company with nothing worth saying
    IF v_coll=0 AND COALESCE((v_snap->>'due_today')::numeric,0)=0
       AND v_bk_cnt=0 AND v_pdc_cnt=0 THEN CONTINUE; END IF;

    msg := '☀️ *Daily Recovery Digest* — '||rec.name||E'\n'||to_char(v_t,'DD Mon YYYY')||E'\n\n'
        || '💰 Collected yesterday: PKR '||to_char(v_coll,'FM9,99,99,999')||E'\n'
        || '📅 Due today: PKR '||to_char(COALESCE((v_snap->>'due_today')::numeric,0),'FM9,99,99,999')
           ||' ('||COALESCE(v_snap->>'due_today_count','0')||' installments)'||E'\n'
        || '⛔ Broken promises: '||v_bk_cnt||' (PKR '||to_char(v_bk_amt,'FM9,99,99,999')||')'||E'\n'
        || '🧾 PDCs clearing today: '||v_pdc_cnt||' (PKR '||to_char(v_pdc_amt,'FM9,99,99,999')||')'||E'\n';
    IF v_big>0 THEN msg := msg||'🎉 Big payments yesterday: PKR '||to_char(v_big,'FM9,99,99,999')||E'\n'; END IF;
    msg := msg||E'\nOpen Subah ki List in RMS for the ranked call queue.';

    SELECT id, phone INTO adm FROM public.app_users
     WHERE company_id=rec.id AND role IN ('admin','owner') AND (status IS NULL OR status='active')
     ORDER BY (role='owner') DESC LIMIT 1;
    IF NOT FOUND OR adm.phone IS NULL OR trim(adm.phone)='' THEN CONTINUE; END IF;

    PERFORM public.enqueue_message(rec.id, jsonb_build_object(
      'channel','whatsapp','to_address',adm.phone,'body',msg,'category','daily_digest',
      'dedup_key','daily_digest:'||rec.id||':'||v_t));
    n := n+1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'companies_sent',n,'run_at',now());
END;
$function$;

-- Digest builder is CRON-ONLY: enqueues real WhatsApp blasts + has no caller guard.
-- Strip PUBLIC/anon/authenticated so no app user can trigger it from /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.cron_daily_digest_all() FROM PUBLIC, anon, authenticated;

-- ── SCHEDULE (run ONLY after owner confirmation — sends a real WhatsApp per owner) ──
-- 08:00 Asia/Karachi = 03:00 UTC:
-- SELECT cron.schedule('daily-recovery-digest','0 3 * * *',
--   $$ SET search_path = public; SELECT public.cron_daily_digest_all(); $$);
