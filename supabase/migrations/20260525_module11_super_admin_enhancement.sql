-- ================================================================
-- NEXUNOVA RMS — MODULE 11 — SUPER ADMIN ENHANCEMENT
-- 2026-05-25 — Applied via MCP + verified.
-- Tables: company_feature_flags, sa_announcements, sa_support_tickets
-- RPCs (all SECURITY DEFINER):
--   get_sa_health_dashboard, get_company_detail_admin,
--   list_company_feature_flags, set_company_feature_flag,
--   list_sa_announcements, upsert_sa_announcement, delete_sa_announcement,
--   get_active_announcements,
--   list_sa_support_tickets, update_sa_ticket, create_sa_support_ticket,
--   suspend_company
-- ================================================================

-- ── Table: company_feature_flags ─────────────────────────────────
CREATE TABLE IF NOT EXISTS company_feature_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key  text NOT NULL,
  is_enabled   boolean NOT NULL DEFAULT true,
  override_note text,
  set_by       text,
  set_at       timestamptz DEFAULT now(),
  UNIQUE (company_id, feature_key)
);

-- ── Table: sa_announcements ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text,
  type        text NOT NULL DEFAULT 'info'
              CHECK (type IN ('info','warning','success','error')),
  is_active   boolean NOT NULL DEFAULT true,
  target_all  boolean NOT NULL DEFAULT true,
  company_ids jsonb DEFAULT '[]'::jsonb,
  starts_at   timestamptz DEFAULT now(),
  ends_at     timestamptz,
  created_by  text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ── Table: sa_support_tickets ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_support_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid REFERENCES companies(id) ON DELETE SET NULL,
  company_name     text,
  submitted_by     text,
  subject          text NOT NULL,
  body             text,
  category         text DEFAULT 'general'
                   CHECK (category IN ('general','billing','technical','feature','bug')),
  priority         text DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','urgent')),
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to      text,
  resolution_note  text,
  resolved_at      timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ── RPC: get_sa_health_dashboard ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_sa_health_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mrr           numeric := 0;
  v_arr           numeric := 0;
  v_active        int := 0;
  v_trialing      int := 0;
  v_churned_30d   int := 0;
  v_new_30d       int := 0;
  v_total         int := 0;
  v_by_plan       jsonb;
  v_monthly_new   jsonb;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN billing_cycle = 'monthly' THEN amount
         WHEN billing_cycle = 'yearly'  THEN amount / 12
         ELSE 0 END
  ), 0)
  INTO v_mrr
  FROM subscriptions WHERE status = 'active';

  v_arr := v_mrr * 12;

  SELECT
    COUNT(*) FILTER (WHERE status = 'active')::int,
    COUNT(*) FILTER (WHERE status = 'trialing')::int
  INTO v_active, v_trialing
  FROM subscriptions;

  SELECT COUNT(*)::int INTO v_churned_30d
  FROM subscriptions
  WHERE status = 'cancelled' AND cancelled_at >= NOW() - INTERVAL '30 days';

  SELECT COUNT(*)::int INTO v_new_30d
  FROM companies
  WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL;

  SELECT COUNT(*)::int INTO v_total
  FROM companies WHERE deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'plan',  COALESCE(sp.plan_name, t.legacy_plan_name, t.tier, 'Unknown'),
    'count', t.cnt,
    'mrr',   t.plan_mrr
  )), '[]'::jsonb)
  INTO v_by_plan
  FROM (
    SELECT s.plan_id, s.legacy_plan_name, s.tier,
      COUNT(*)::int AS cnt,
      COALESCE(SUM(
        CASE WHEN s.billing_cycle = 'monthly' THEN s.amount
             WHEN s.billing_cycle = 'yearly'  THEN s.amount / 12
             ELSE 0 END
      ), 0) AS plan_mrr
    FROM subscriptions s
    WHERE s.status = 'active'
    GROUP BY s.plan_id, s.legacy_plan_name, s.tier
  ) t
  LEFT JOIN subscription_plans sp ON sp.id = t.plan_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month', TO_CHAR(m, 'Mon YY'),
    'count', cnt::int
  ) ORDER BY m), '[]'::jsonb)
  INTO v_monthly_new
  FROM (
    SELECT DATE_TRUNC('month', created_at) AS m, COUNT(*)::int AS cnt
    FROM companies
    WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
      AND deleted_at IS NULL
    GROUP BY DATE_TRUNC('month', created_at)
  ) t;

  RETURN jsonb_build_object(
    'mrr',             v_mrr,
    'arr',             v_arr,
    'active',          v_active,
    'trialing',        v_trialing,
    'churned_30d',     v_churned_30d,
    'new_30d',         v_new_30d,
    'total_companies', v_total,
    'by_plan',         v_by_plan,
    'monthly_new',     v_monthly_new
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION get_sa_health_dashboard() TO anon, authenticated;

-- ── RPC: get_company_detail_admin ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_company_detail_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'company',      row_to_json(c)::jsonb,
    'subscription', row_to_json(s)::jsonb,
    'plan',         row_to_json(sp)::jsonb,
    'stats', jsonb_build_object(
      'users',              (SELECT COUNT(*) FROM app_users WHERE company_id = p_company_id AND status = 'active'),
      'projects',           (SELECT COUNT(*) FROM projects  WHERE company_id = p_company_id),
      'units',              (SELECT COUNT(*) FROM units     WHERE company_id = p_company_id),
      'clients',            (SELECT COUNT(*) FROM clients   WHERE company_id = p_company_id),
      'agents',             (SELECT COUNT(*) FROM agents    WHERE company_id = p_company_id),
      'sales',              (SELECT COUNT(*) FROM sales     WHERE company_id = p_company_id),
      'payments_30d',       (SELECT COUNT(*) FROM payments  WHERE company_id = p_company_id AND created_at >= NOW() - INTERVAL '30 days'),
      'payments_amt_30d',   (SELECT COALESCE(SUM(amount),0) FROM payments WHERE company_id = p_company_id AND created_at >= NOW() - INTERVAL '30 days'),
      'last_payment_at',    (SELECT MAX(created_at) FROM payments WHERE company_id = p_company_id)
    )
  )
  INTO v_result
  FROM companies c
  LEFT JOIN subscriptions s  ON s.company_id = c.id
  LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE c.id = p_company_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Company not found'));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION get_company_detail_admin(uuid) TO anon, authenticated;

-- ── RPC: list_company_feature_flags ──────────────────────────────
CREATE OR REPLACE FUNCTION list_company_feature_flags(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(f) ORDER BY f.feature_key), '[]'::jsonb)
  INTO v_rows FROM company_feature_flags f
  WHERE f.company_id = p_company_id;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION list_company_feature_flags(uuid) TO anon, authenticated;

-- ── RPC: set_company_feature_flag ────────────────────────────────
CREATE OR REPLACE FUNCTION set_company_feature_flag(
  p_company_id   uuid,
  p_feature_key  text,
  p_is_enabled   boolean,
  p_note         text DEFAULT NULL,
  p_set_by       text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO company_feature_flags (company_id, feature_key, is_enabled, override_note, set_by, set_at)
  VALUES (p_company_id, p_feature_key, p_is_enabled, p_note, p_set_by, now())
  ON CONFLICT (company_id, feature_key) DO UPDATE SET
    is_enabled    = EXCLUDED.is_enabled,
    override_note = EXCLUDED.override_note,
    set_by        = EXCLUDED.set_by,
    set_at        = now();
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION set_company_feature_flag(uuid, text, boolean, text, text) TO anon, authenticated;

-- ── RPC: list_sa_announcements ────────────────────────────────────
CREATE OR REPLACE FUNCTION list_sa_announcements()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_rows FROM sa_announcements a;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION list_sa_announcements() TO anon, authenticated;

-- ── RPC: upsert_sa_announcement ──────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_sa_announcement(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NULLIF(p_data->>'id','')::uuid, gen_random_uuid());
  INSERT INTO sa_announcements (id, title, body, type, is_active, target_all, ends_at, created_by, updated_at)
  VALUES (
    v_id,
    p_data->>'title',
    NULLIF(p_data->>'body',''),
    COALESCE(NULLIF(p_data->>'type',''), 'info'),
    COALESCE((p_data->>'is_active')::boolean, true),
    COALESCE((p_data->>'target_all')::boolean, true),
    NULLIF(p_data->>'ends_at','')::timestamptz,
    NULLIF(p_data->>'created_by',''),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title      = EXCLUDED.title,
    body       = EXCLUDED.body,
    type       = EXCLUDED.type,
    is_active  = EXCLUDED.is_active,
    target_all = EXCLUDED.target_all,
    ends_at    = EXCLUDED.ends_at,
    updated_at = now();
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_sa_announcement(jsonb) TO anon, authenticated;

-- ── RPC: delete_sa_announcement ──────────────────────────────────
CREATE OR REPLACE FUNCTION delete_sa_announcement(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM sa_announcements WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_sa_announcement(uuid) TO anon, authenticated;

-- ── RPC: get_active_announcements ────────────────────────────────
CREATE OR REPLACE FUNCTION get_active_announcements()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'body', body, 'type', type
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM sa_announcements
  WHERE is_active = true
    AND starts_at <= NOW()
    AND (ends_at IS NULL OR ends_at >= NOW());
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION get_active_announcements() TO anon, authenticated;

-- ── RPC: list_sa_support_tickets ─────────────────────────────────
CREATE OR REPLACE FUNCTION list_sa_support_tickets(
  p_status   text DEFAULT NULL,
  p_priority text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY
    CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
    t.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM sa_support_tickets t
  WHERE (p_status   IS NULL OR t.status   = p_status)
    AND (p_priority IS NULL OR t.priority = p_priority);
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION list_sa_support_tickets(text, text) TO anon, authenticated;

-- ── RPC: update_sa_ticket ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_sa_ticket(p_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE sa_support_tickets SET
    status          = COALESCE(NULLIF(p_data->>'status',''),          status),
    assigned_to     = COALESCE(NULLIF(p_data->>'assigned_to',''),     assigned_to),
    resolution_note = COALESCE(NULLIF(p_data->>'resolution_note',''), resolution_note),
    priority        = COALESCE(NULLIF(p_data->>'priority',''),        priority),
    resolved_at     = CASE WHEN p_data->>'status' IN ('resolved','closed') THEN NOW() ELSE resolved_at END,
    updated_at      = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION update_sa_ticket(uuid, jsonb) TO anon, authenticated;

-- ── RPC: create_sa_support_ticket ────────────────────────────────
CREATE OR REPLACE FUNCTION create_sa_support_ticket(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO sa_support_tickets (id, company_id, company_name, submitted_by, subject, body, category, priority)
  VALUES (
    v_id,
    NULLIF(p_data->>'company_id','')::uuid,
    NULLIF(p_data->>'company_name',''),
    NULLIF(p_data->>'submitted_by',''),
    p_data->>'subject',
    NULLIF(p_data->>'body',''),
    COALESCE(NULLIF(p_data->>'category',''), 'general'),
    COALESCE(NULLIF(p_data->>'priority',''), 'normal')
  );
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION create_sa_support_ticket(jsonb) TO anon, authenticated;

-- ── RPC: suspend_company ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION suspend_company(
  p_company_id uuid,
  p_reason     text DEFAULT NULL,
  p_suspend    boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_suspend THEN
    UPDATE companies SET
      suspended_at      = now(),
      suspension_reason = p_reason,
      status            = 'suspended',
      updated_at        = now()
    WHERE id = p_company_id;
  ELSE
    UPDATE companies SET
      suspended_at      = NULL,
      suspension_reason = NULL,
      status            = 'active',
      updated_at        = now()
    WHERE id = p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION suspend_company(uuid, text, boolean) TO anon, authenticated;
