-- ================================================================
-- NEXUNOVA RMS — MODULE 1.3 PROMISE TRACKER ENHANCEMENTS
-- 2026-05-25
-- APPLIED to live DB (project itqxljtfbrppntgyfush) via MCP apply_migration
-- on 2026-05-25 and verified with a transactional roundtrip
-- (3 broken promises → 3rd auto-creates an escalation; reminder bump = 1;
--  analytics returns officers/weekly/top_broken). All rolled back.
--
--   (a) mark_promise_broken: auto-escalate after N broken promises in
--       last 90 days (default threshold 3). Preserves existing 3-arg
--       signature + logic; only ADDITIVE.
--   (b) get_promise_analytics: officer-wise stats + weekly trend +
--       top broken clients (NEW RPC).
--   (c) record_promise_reminder: bump reminder_sent_count and
--       last_reminder_sent_at when an officer sends a 24h-before
--       WhatsApp reminder (uses pre-existing columns).
-- ================================================================

-- (a) Update mark_promise_broken — preserves original signature + behaviour.
CREATE OR REPLACE FUNCTION public.mark_promise_broken(
  p_promise_id uuid,
  p_broken_reason text DEFAULT NULL::text,
  p_updated_by text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_status     TEXT;
  v_client_id  UUID;
  v_company_id UUID;
  v_threshold  INT := 3;   -- broken promises in 90d to trigger auto-escalation
  v_broken_count INT := 0;
  v_has_open_escalation BOOLEAN;
  v_escalation_id UUID := NULL;
BEGIN
  SELECT status, client_id, company_id
    INTO v_status, v_client_id, v_company_id
    FROM payment_promises WHERE id = p_promise_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_not_found');
  END IF;
  IF v_status NOT IN ('pending','postponed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_already_resolved');
  END IF;

  UPDATE payment_promises SET
    status = 'broken', broken_reason = p_broken_reason, updated_at = NOW()
  WHERE id = p_promise_id;

  -- Auto-escalate after threshold broken promises in last 90 days,
  -- unless an open escalation already exists for this client.
  SELECT COUNT(*) INTO v_broken_count
  FROM payment_promises
  WHERE client_id = v_client_id
    AND company_id = v_company_id
    AND status = 'broken'
    AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '90 days';

  SELECT EXISTS (
    SELECT 1 FROM escalations
     WHERE client_id = v_client_id
       AND company_id = v_company_id
       AND status = 'open'
  ) INTO v_has_open_escalation;

  IF v_broken_count >= v_threshold AND NOT v_has_open_escalation THEN
    INSERT INTO escalations (
      company_id, client_id, from_level, to_level, reason, status, created_at, updated_at
    ) VALUES (
      v_company_id, v_client_id, 1, 2,
      'Auto-escalated: ' || v_broken_count || ' broken promise(s) in last 90 days (threshold ' || v_threshold || ')',
      'open', NOW(), NOW()
    ) RETURNING id INTO v_escalation_id;
  END IF;

  RETURN jsonb_build_object(
    'success',          true,
    'id',               p_promise_id,
    'status',           'broken',
    'broken_count_90d', v_broken_count,
    'auto_escalated',   v_escalation_id IS NOT NULL,
    'escalation_id',    v_escalation_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_promise_broken(uuid, text, text) TO anon, authenticated;


-- (b) get_promise_analytics — officer stats, weekly trend, top broken clients.
CREATE OR REPLACE FUNCTION public.get_promise_analytics(
  p_company_id uuid,
  p_days int DEFAULT 90
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_officers   JSONB;
  v_weekly     JSONB;
  v_top_broken JSONB;
  v_start      DATE := CURRENT_DATE - (COALESCE(p_days, 90))::INT;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(o) ORDER BY o.kept_count DESC NULLS LAST, o.total DESC), '[]'::jsonb)
  INTO v_officers
  FROM (
    SELECT
      pp.logged_by AS username,
      COALESCE(au.full_name, pp.logged_by) AS officer_name,
      COUNT(*)::int                                                              AS total,
      COUNT(*) FILTER (WHERE pp.status IN ('kept','partial'))::int               AS kept_count,
      COUNT(*) FILTER (WHERE pp.status = 'broken')::int                          AS broken_count,
      COUNT(*) FILTER (WHERE pp.status = 'pending')::int                         AS pending_count,
      CASE WHEN COUNT(*) > 0
           THEN ROUND(COUNT(*) FILTER (WHERE pp.status IN ('kept','partial'))::numeric / COUNT(*) * 100, 1)
           ELSE 0 END                                                            AS kept_rate,
      COALESCE(SUM(pp.promised_amount), 0)::numeric                              AS amount_promised,
      COALESCE(SUM(pp.actual_paid_amount) FILTER (WHERE pp.status IN ('kept','partial')), 0)::numeric
                                                                                 AS amount_recovered
    FROM payment_promises pp
    LEFT JOIN app_users au ON au.username = pp.logged_by AND au.company_id = pp.company_id
    WHERE pp.company_id = p_company_id
      AND pp.created_at >= v_start
      AND pp.logged_by IS NOT NULL AND pp.logged_by <> ''
    GROUP BY pp.logged_by, au.full_name
  ) o;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.week_start ASC), '[]'::jsonb)
  INTO v_weekly
  FROM (
    SELECT
      date_trunc('week', pp.promise_made_on)::date AS week_start,
      COUNT(*)::int                                                AS total,
      COUNT(*) FILTER (WHERE pp.status IN ('kept','partial'))::int AS kept,
      COUNT(*) FILTER (WHERE pp.status = 'broken')::int            AS broken
    FROM payment_promises pp
    WHERE pp.company_id = p_company_id
      AND pp.promise_made_on >= v_start
    GROUP BY 1
  ) w;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.broken_count DESC, t.total DESC), '[]'::jsonb)
  INTO v_top_broken
  FROM (
    SELECT
      pp.client_id,
      c.full_name      AS client_name,
      c.client_code,
      c.phone_primary,
      COUNT(*)::int                                                AS total,
      COUNT(*) FILTER (WHERE pp.status = 'broken')::int            AS broken_count,
      COUNT(*) FILTER (WHERE pp.status IN ('kept','partial'))::int AS kept_count
    FROM payment_promises pp
    JOIN clients c ON c.id = pp.client_id
    WHERE pp.company_id = p_company_id
      AND pp.created_at >= v_start
    GROUP BY pp.client_id, c.full_name, c.client_code, c.phone_primary
    HAVING COUNT(*) FILTER (WHERE pp.status = 'broken') > 0
    LIMIT 25
  ) t;

  RETURN jsonb_build_object(
    'success',     true,
    'window_days', COALESCE(p_days, 90),
    'officers',    v_officers,
    'weekly',      v_weekly,
    'top_broken',  v_top_broken
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_promise_analytics(uuid, int) TO anon, authenticated;


-- (c) record_promise_reminder — bump existing reminder columns on manual send.
CREATE OR REPLACE FUNCTION public.record_promise_reminder(
  p_promise_id uuid,
  p_company_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE v_count INT;
BEGIN
  UPDATE payment_promises
     SET reminder_sent_count   = COALESCE(reminder_sent_count, 0) + 1,
         last_reminder_sent_at = NOW(),
         updated_at            = NOW()
   WHERE id = p_promise_id AND company_id = p_company_id
   RETURNING reminder_sent_count INTO v_count;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'reminder_sent_count', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_promise_reminder(uuid, uuid) TO anon, authenticated;
