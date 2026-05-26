-- ================================================================
-- NEXUNOVA RMS — MODULE 1.2 RECOVERY CAMPAIGN MANAGEMENT
-- 2026-05-25
-- APPLIED to live DB (project itqxljtfbrppntgyfush) via MCP apply_migration
-- on 2026-05-25 and verified with a transactional roundtrip (create →
-- assign → idempotent re-assign → detail → close → remove → delete → rollback;
-- final state: 0 campaigns / 0 assignments).
--
-- Tables: recovery_campaigns, campaign_clients (junction, ON DELETE CASCADE)
-- RPCs:   list_campaigns, get_campaign_detail, create_campaign,
--         update_campaign, delete_campaign, close_campaign,
--         assign_clients_to_campaign, remove_client_from_campaign
-- All SECURITY DEFINER, SET search_path=public, returning jsonb.
-- RLS on, no permissive policies (definer-RPC access only — owner bypasses RLS).
-- ================================================================

-- 1) Tables -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recovery_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  name             text NOT NULL,
  description      text,
  target_amount    numeric NOT NULL DEFAULT 0,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','cancelled')),
  outcome_summary  text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_rcamp_company ON public.recovery_campaigns(company_id, status, start_date DESC);
ALTER TABLE public.recovery_campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.campaign_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  campaign_id   uuid NOT NULL REFERENCES public.recovery_campaigns(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  UNIQUE(campaign_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_ccli_campaign ON public.campaign_clients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_ccli_client   ON public.campaign_clients(client_id);
ALTER TABLE public.campaign_clients ENABLE ROW LEVEL SECURITY;

-- 2) list_campaigns ----------------------------------------------
CREATE OR REPLACE FUNCTION public.list_campaigns(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      rc.id, rc.name, rc.description, rc.target_amount,
      rc.start_date, rc.end_date, rc.status, rc.outcome_summary,
      rc.created_by, rc.created_at, rc.closed_at,
      (SELECT COUNT(*)::int FROM campaign_clients cc
        WHERE cc.campaign_id = rc.id AND cc.status='active') AS clients_count,
      COALESCE((
        SELECT SUM(p.amount) FROM payments p
        JOIN campaign_clients cc ON cc.client_id = p.client_id
        WHERE cc.campaign_id = rc.id AND cc.status='active'
          AND p.company_id = rc.company_id
          AND p.payment_date BETWEEN rc.start_date AND rc.end_date
      ), 0)::numeric AS collected,
      CASE WHEN rc.target_amount > 0 THEN
        ROUND(LEAST(100, COALESCE((
          SELECT SUM(p.amount) FROM payments p
          JOIN campaign_clients cc ON cc.client_id = p.client_id
          WHERE cc.campaign_id = rc.id AND cc.status='active'
            AND p.company_id = rc.company_id
            AND p.payment_date BETWEEN rc.start_date AND rc.end_date
        ), 0) / rc.target_amount * 100)::numeric, 1)
      ELSE 0 END AS progress_pct
    FROM recovery_campaigns rc
    WHERE rc.company_id = p_company_id
    ORDER BY rc.created_at DESC
  ) r;
$$;
GRANT EXECUTE ON FUNCTION public.list_campaigns(uuid) TO anon, authenticated;

-- 3) get_campaign_detail -----------------------------------------
CREATE OR REPLACE FUNCTION public.get_campaign_detail(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rc          recovery_campaigns%ROWTYPE;
  v_collected   numeric := 0;
  v_calls       int := 0;
  v_kept        int := 0;
  v_total_prom  int := 0;
  v_clients     jsonb;
  v_officers    jsonb;
BEGIN
  SELECT * INTO v_rc FROM recovery_campaigns
   WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found');
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_collected
  FROM payments p
  JOIN campaign_clients cc ON cc.client_id = p.client_id
  WHERE cc.campaign_id = v_rc.id AND cc.status='active'
    AND p.company_id = v_rc.company_id
    AND p.payment_date BETWEEN v_rc.start_date AND v_rc.end_date;

  SELECT COUNT(*) INTO v_calls
  FROM contact_logs cl
  JOIN campaign_clients cc ON cc.client_id = cl.client_id
  WHERE cc.campaign_id = v_rc.id AND cc.status='active'
    AND cl.company_id = v_rc.company_id
    AND cl.created_at::date BETWEEN v_rc.start_date AND v_rc.end_date;

  SELECT
    COUNT(*) FILTER (WHERE pp.status='kept'),
    COUNT(*)
  INTO v_kept, v_total_prom
  FROM payment_promises pp
  JOIN campaign_clients cc ON cc.client_id = pp.client_id
  WHERE cc.campaign_id = v_rc.id AND cc.status='active'
    AND pp.company_id = v_rc.company_id
    AND pp.promise_date BETWEEN v_rc.start_date AND v_rc.end_date;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.contributed DESC, r.assigned_at DESC), '[]'::jsonb)
  INTO v_clients
  FROM (
    SELECT
      cc.client_id, cc.assigned_at, cc.status,
      c.full_name, c.client_code, c.phone_primary,
      COALESCE((
        SELECT SUM(p.amount) FROM payments p
        WHERE p.client_id = cc.client_id
          AND p.company_id = v_rc.company_id
          AND p.payment_date BETWEEN v_rc.start_date AND v_rc.end_date
      ), 0)::numeric AS contributed
    FROM campaign_clients cc
    LEFT JOIN clients c ON c.id = cc.client_id
    WHERE cc.campaign_id = v_rc.id
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(o) ORDER BY o.amount_collected DESC NULLS LAST), '[]'::jsonb)
  INTO v_officers
  FROM (
    SELECT
      x.username,
      COALESCE(u.full_name, x.username) AS officer_name,
      x.payment_count,
      x.amount_collected,
      COALESCE(call_q.calls_made, 0) AS calls_made
    FROM (
      SELECT p.created_by AS username,
             COUNT(*)::int AS payment_count,
             SUM(p.amount)::numeric AS amount_collected
      FROM payments p
      JOIN campaign_clients cc ON cc.client_id = p.client_id
      WHERE cc.campaign_id = v_rc.id AND cc.status='active'
        AND p.company_id = v_rc.company_id
        AND p.payment_date BETWEEN v_rc.start_date AND v_rc.end_date
        AND p.created_by IS NOT NULL
      GROUP BY p.created_by
    ) x
    LEFT JOIN app_users u ON u.username = x.username AND u.company_id = v_rc.company_id
    LEFT JOIN (
      SELECT cl.created_by AS username, COUNT(*)::int AS calls_made
      FROM contact_logs cl
      JOIN campaign_clients cc ON cc.client_id = cl.client_id
      WHERE cc.campaign_id = v_rc.id AND cc.status='active'
        AND cl.company_id = v_rc.company_id
        AND cl.created_at::date BETWEEN v_rc.start_date AND v_rc.end_date
        AND cl.created_by IS NOT NULL
      GROUP BY cl.created_by
    ) call_q ON call_q.username = x.username
  ) o;

  RETURN jsonb_build_object(
    'success', true,
    'campaign', to_jsonb(v_rc),
    'metrics', jsonb_build_object(
      'clients_count', (SELECT COUNT(*)::int FROM campaign_clients
                         WHERE campaign_id = v_rc.id AND status='active'),
      'collected',      v_collected,
      'target_amount',  v_rc.target_amount,
      'progress_pct',   CASE WHEN v_rc.target_amount > 0
                              THEN ROUND(LEAST(100, (v_collected / v_rc.target_amount * 100))::numeric, 1)
                              ELSE 0 END,
      'calls_made',     v_calls,
      'promises_kept',  v_kept,
      'promises_total', v_total_prom
    ),
    'clients',            v_clients,
    'officer_performance', v_officers
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_detail(uuid, uuid) TO anon, authenticated;

-- 4) create_campaign ---------------------------------------------
CREATE OR REPLACE FUNCTION public.create_campaign(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF COALESCE(p_data->>'name','') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_required');
  END IF;
  IF NULLIF(p_data->>'start_date','') IS NULL OR NULLIF(p_data->>'end_date','') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'dates_required');
  END IF;

  INSERT INTO recovery_campaigns
    (company_id, name, description, target_amount, start_date, end_date, status, created_by)
  VALUES (
    p_company_id,
    p_data->>'name',
    NULLIF(p_data->>'description',''),
    COALESCE((p_data->>'target_amount')::numeric, 0),
    (p_data->>'start_date')::date,
    (p_data->>'end_date')::date,
    COALESCE(NULLIF(p_data->>'status',''), 'active'),
    NULLIF(p_data->>'created_by','')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_campaign(uuid, jsonb) TO anon, authenticated;

-- 5) update_campaign (allowlisted) -------------------------------
CREATE OR REPLACE FUNCTION public.update_campaign(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM recovery_campaigns WHERE id = p_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found');
  END IF;

  UPDATE recovery_campaigns SET
    name           = COALESCE(NULLIF(p_data->>'name',''), name),
    description    = COALESCE(p_data->>'description', description),
    target_amount  = COALESCE((p_data->>'target_amount')::numeric, target_amount),
    start_date     = COALESCE(NULLIF(p_data->>'start_date','')::date, start_date),
    end_date       = COALESCE(NULLIF(p_data->>'end_date','')::date, end_date),
    updated_at     = now()
  WHERE id = p_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_campaign(uuid, uuid, jsonb) TO anon, authenticated;

-- 6) delete_campaign ---------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_campaign(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM recovery_campaigns WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_campaign(uuid, uuid) TO anon, authenticated;

-- 7) close_campaign ----------------------------------------------
CREATE OR REPLACE FUNCTION public.close_campaign(p_id uuid, p_company_id uuid, p_outcome_summary text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE recovery_campaigns
     SET status = 'closed',
         outcome_summary = COALESCE(p_outcome_summary, outcome_summary),
         closed_at = now(),
         updated_at = now()
   WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_campaign(uuid, uuid, text) TO anon, authenticated;

-- 8) assign_clients_to_campaign (bulk, idempotent) ---------------
CREATE OR REPLACE FUNCTION public.assign_clients_to_campaign(
  p_campaign_id uuid, p_company_id uuid, p_client_ids jsonb, p_assigned_by text DEFAULT NULL
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_added int := 0;
  v_id    uuid;
BEGIN
  IF p_campaign_id IS NULL OR p_company_id IS NULL OR p_client_ids IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM recovery_campaigns
                  WHERE id = p_campaign_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found');
  END IF;
  IF jsonb_typeof(p_client_ids) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_ids_must_be_array');
  END IF;

  FOR v_id IN SELECT (value #>> '{}')::uuid FROM jsonb_array_elements(p_client_ids)
  LOOP
    BEGIN
      INSERT INTO campaign_clients(company_id, campaign_id, client_id, assigned_by)
      VALUES (p_company_id, p_campaign_id, v_id, p_assigned_by)
      ON CONFLICT (campaign_id, client_id) DO UPDATE
        SET status = 'active', assigned_at = now()
        WHERE campaign_clients.status = 'removed';
      v_added := v_added + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'added_count', v_added);
END;
$$;
GRANT EXECUTE ON FUNCTION public.assign_clients_to_campaign(uuid, uuid, jsonb, text) TO anon, authenticated;

-- 9) remove_client_from_campaign --------------------------------
CREATE OR REPLACE FUNCTION public.remove_client_from_campaign(
  p_campaign_id uuid, p_client_id uuid, p_company_id uuid
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM campaign_clients
   WHERE campaign_id = p_campaign_id
     AND client_id  = p_client_id
     AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'removed', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.remove_client_from_campaign(uuid, uuid, uuid) TO anon, authenticated;
