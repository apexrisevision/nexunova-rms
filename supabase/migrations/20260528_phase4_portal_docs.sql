-- ================================================================
-- NEXUNOVA RMS — PHASE 4 CLIENT PORTAL + DOCUMENT GAPS
-- Migration: 20260528_phase4_portal_docs.sql  |  2026-05-28
-- ================================================================
-- P1: Fix buyer_complaints RLS (deny_all_anon pattern)
-- P2: demand_notices table + create_demand_notice + get_demand_notice
--     + get_client_documents RPC
-- P3: portal_clients + portal_sessions tables
--     + portal_login + portal_set_password + get_portal_client_data
--     + admin_invite_portal_client + get_portal_access_status RPCs
-- ================================================================

-- ── P1: Fix buyer_complaints RLS ─────────────────────────────────────────
-- Old policy used auth.uid() which is NULL for anon portal users.
-- Replace with standard deny_all_anon (RPCs are SECURITY DEFINER, bypass RLS).
DROP POLICY IF EXISTS "company_isolation" ON public.buyer_complaints;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'buyer_complaints' AND policyname = 'deny_all_buyer_complaints'
  ) THEN
    CREATE POLICY "deny_all_buyer_complaints"
      ON public.buyer_complaints AS RESTRICTIVE FOR ALL
      TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── P2a: demand_notices table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demand_notices (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     UUID        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  sale_id        UUID        NOT NULL REFERENCES public.sales(id)      ON DELETE CASCADE,
  client_id      UUID        NOT NULL REFERENCES public.clients(id)    ON DELETE CASCADE,
  notice_no      TEXT        NOT NULL,
  notice_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  overdue_amount NUMERIC     NULL,
  due_date       DATE        NULL,
  channel        TEXT        NOT NULL DEFAULT 'print'
                             CHECK (channel IN ('print','whatsapp','email')),
  issued_by      UUID        NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, notice_no)
);

ALTER TABLE public.demand_notices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'demand_notices' AND policyname = 'deny_all_demand_notices'
  ) THEN
    CREATE POLICY "deny_all_demand_notices"
      ON public.demand_notices AS RESTRICTIVE FOR ALL
      TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.demand_notices
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE INDEX IF NOT EXISTS idx_demand_notices_sale   ON public.demand_notices (company_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_demand_notices_client ON public.demand_notices (company_id, client_id);

-- ── P2b: create_demand_notice RPC ────────────────────────────────────────
-- Non-admin allowed (officers can create notices from demand-notice.html).
-- Generates sequential notice_no: DN-YYYY-NNNN per company per year.
CREATE OR REPLACE FUNCTION public.create_demand_notice(
  p_sale_id        uuid,
  p_company_id     uuid,
  p_channel        text    DEFAULT 'print',
  p_overdue_amount numeric DEFAULT NULL,
  p_due_date       date    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me        public.app_users;
  v_client_id uuid;
  v_year      int  := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_seq       int;
  v_notice_no text;
  v_id        uuid;
BEGIN
  v_me := public._rms_caller();
  -- Company isolation: allow anon (demand-notice.html) but block wrong-company authed users
  IF v_me.id IS NOT NULL AND v_me.company_id != p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Verify sale belongs to company
  SELECT client_id INTO v_client_id
  FROM public.sales
  WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  -- Sequential notice_no: DN-YYYY-NNNN
  SELECT COALESCE(MAX(
    CASE
      WHEN notice_no ~ ('^DN-' || v_year || '-[0-9]+$')
      THEN SUBSTRING(notice_no FROM LENGTH('DN-' || v_year || '-') + 1)::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM public.demand_notices
  WHERE company_id = p_company_id
    AND notice_no LIKE 'DN-' || v_year || '-%';

  v_notice_no := 'DN-' || v_year || '-' || LPAD(v_seq::text, 4, '0');

  INSERT INTO public.demand_notices
    (company_id, sale_id, client_id, notice_no, notice_date,
     overdue_amount, due_date, channel, issued_by)
  VALUES
    (p_company_id, p_sale_id, v_client_id, v_notice_no, CURRENT_DATE,
     p_overdue_amount, p_due_date, COALESCE(p_channel, 'print'),
     CASE WHEN v_me.id IS NOT NULL THEN v_me.id ELSE NULL END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success',     true,
    'id',          v_id,
    'notice_no',   v_notice_no,
    'notice_date', CURRENT_DATE
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_demand_notice(uuid,uuid,text,numeric,date) TO anon, authenticated;

-- ── P2c: get_demand_notice RPC ───────────────────────────────────────────
-- Returns latest demand notice for a sale (null if none).
CREATE OR REPLACE FUNCTION public.get_demand_notice(
  p_sale_id    uuid,
  p_company_id uuid
)
RETURNS jsonb LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'id',             id,
      'notice_no',      notice_no,
      'notice_date',    notice_date,
      'overdue_amount', overdue_amount,
      'channel',        channel,
      'created_at',     created_at
    )
    FROM public.demand_notices
    WHERE sale_id = p_sale_id AND company_id = p_company_id
    ORDER BY created_at DESC
    LIMIT 1),
    'null'::jsonb
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_demand_notice(uuid,uuid) TO anon, authenticated;

-- ── P2d: get_client_documents RPC ────────────────────────────────────────
-- Staff-facing: returns all generated documents for a client.
-- Used by the Documents tab in client detail (clients.js).
CREATE OR REPLACE FUNCTION public.get_client_documents(
  p_client_id  uuid,
  p_company_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me       public.app_users;
  v_sales    jsonb;
  v_notices  jsonb;
  v_nocs     jsonb;
  v_receipts jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF v_me.company_id != p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Sale agreements
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type',   'agreement',
    'label',      'Sale Agreement',
    'ref',        s.sale_number,
    'date',       s.sale_date,
    'sale_id',    s.id,
    'unit_no',    u.unit_no,
    'project',    COALESCE(pr.project_name, '')
  ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  LEFT JOIN public.units    u  ON u.id  = s.unit_id
  LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
  WHERE s.client_id = p_client_id AND s.company_id = p_company_id;

  -- Demand notices
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type',   'demand_notice',
    'label',      'Demand Notice',
    'ref',        dn.notice_no,
    'date',       dn.notice_date,
    'sale_id',    dn.sale_id,
    'channel',    dn.channel,
    'amount',     dn.overdue_amount
  ) ORDER BY dn.created_at DESC), '[]'::jsonb)
  INTO v_notices
  FROM public.demand_notices dn
  WHERE dn.client_id = p_client_id AND dn.company_id = p_company_id;

  -- Approved NOCs
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type',   'noc',
    'label',      'NOC — ' || INITCAP(COALESCE(n.noc_type, 'general')),
    'ref',        COALESCE(n.noc_number, 'NOC-' || LEFT(n.id::text, 8)),
    'date',       COALESCE(n.approved_at::date, n.requested_at::date),
    'noc_id',     n.id,
    'noc_type',   n.noc_type,
    'status',     n.status,
    'unit_no',    n.unit_no
  ) ORDER BY n.requested_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_nocs
  FROM public.noc n
  WHERE n.client_id = p_client_id AND n.company_id = p_company_id
    AND n.status = 'approved';

  -- Recent payment receipts (last 5)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type',    'receipt',
    'label',       'Payment Receipt',
    'ref',         COALESCE(p.voucher_code, p.payment_code),
    'date',        p.payment_date,
    'sale_id',     p.sale_id,
    'amount',      p.amount,
    'payment_id',  p.id
  ) ORDER BY p.payment_date DESC NULLS LAST), '[]'::jsonb)
  INTO v_receipts
  FROM (
    SELECT p2.* FROM public.payments p2
    JOIN public.sales s2 ON s2.id = p2.sale_id AND s2.client_id = p_client_id
    WHERE p2.company_id = p_company_id AND p2.status IN ('received','cleared')
    ORDER BY p2.payment_date DESC NULLS LAST
    LIMIT 5
  ) p;

  RETURN jsonb_build_object(
    'success',  true,
    'sales',    v_sales,
    'notices',  v_notices,
    'nocs',     COALESCE(v_nocs, '[]'::jsonb),
    'receipts', COALESCE(v_receipts, '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_client_documents(uuid,uuid) TO authenticated;

-- ── P3a: portal_clients table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_clients (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id             UUID        NOT NULL REFERENCES public.clients(id)   ON DELETE CASCADE,
  email                 TEXT        NOT NULL,
  password_hash         TEXT        NOT NULL,
  temp_token            TEXT        NULL,
  temp_token_expires_at TIMESTAMPTZ NULL,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  last_login_at         TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);

ALTER TABLE public.portal_clients ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_clients' AND policyname = 'deny_all_portal_clients'
  ) THEN
    CREATE POLICY "deny_all_portal_clients"
      ON public.portal_clients AS RESTRICTIVE FOR ALL
      TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE TRIGGER trg_portal_clients_upd
BEFORE UPDATE ON public.portal_clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_portal_clients_lookup ON public.portal_clients (company_id, email);
CREATE INDEX IF NOT EXISTS idx_portal_clients_client ON public.portal_clients (client_id);

-- ── P3b: portal_sessions table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id       UUID        NOT NULL REFERENCES public.companies(id)       ON DELETE CASCADE,
  client_id        UUID        NOT NULL REFERENCES public.clients(id)         ON DELETE CASCADE,
  portal_client_id UUID        NOT NULL REFERENCES public.portal_clients(id)  ON DELETE CASCADE,
  session_token    TEXT        NOT NULL UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '8 hours'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_sessions' AND policyname = 'deny_all_portal_sessions'
  ) THEN
    CREATE POLICY "deny_all_portal_sessions"
      ON public.portal_sessions AS RESTRICTIVE FOR ALL
      TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_sessions_token ON public.portal_sessions (session_token, expires_at);

-- ── P3c: portal_login RPC ────────────────────────────────────────────────
-- Verifies email+password for a portal_client. Returns session token.
-- Session-token approach: client_id is never directly exposed post-login.
CREATE OR REPLACE FUNCTION public.portal_login(
  p_company_code text,
  p_email        text,
  p_password     text
)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co     public.companies;
  v_pc     public.portal_clients;
  v_cl     public.clients;
  v_tok    text;
BEGIN
  -- Resolve company by code
  SELECT * INTO v_co
  FROM public.companies
  WHERE company_code = UPPER(TRIM(p_company_code)) AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid company code');
  END IF;

  -- Find active portal client
  SELECT * INTO v_pc
  FROM public.portal_clients
  WHERE company_id = v_co.id
    AND email      = LOWER(TRIM(p_email))
    AND is_active  = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email or password');
  END IF;

  -- Verify bcrypt password
  IF v_pc.password_hash IS NULL
  OR v_pc.password_hash <> crypt(p_password, v_pc.password_hash) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email or password');
  END IF;

  -- Load client
  SELECT * INTO v_cl FROM public.clients WHERE id = v_pc.client_id;

  -- Generate opaque session token (64-char hex)
  v_tok := encode(gen_random_bytes(32), 'hex');

  -- One session per portal client (revoke old, create new)
  DELETE FROM public.portal_sessions WHERE portal_client_id = v_pc.id;
  INSERT INTO public.portal_sessions
    (company_id, client_id, portal_client_id, session_token, expires_at)
  VALUES
    (v_co.id, v_pc.client_id, v_pc.id, v_tok, now() + INTERVAL '8 hours');

  -- Track last login
  UPDATE public.portal_clients SET last_login_at = now() WHERE id = v_pc.id;

  RETURN jsonb_build_object(
    'success',        true,
    'session_token',  v_tok,
    'client_id',      v_cl.id,
    'company_id',     v_co.id,
    'company_name',   v_co.name,
    'client_name',    v_cl.full_name,
    'client_code',    v_cl.client_code,
    'cnic',           v_cl.cnic
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_login(text,text,text) TO anon, authenticated;

-- ── P3d: portal_set_password RPC ─────────────────────────────────────────
-- Used from the set-password screen (link from admin invite email).
CREATE OR REPLACE FUNCTION public.portal_set_password(
  p_company_code text,
  p_email        text,
  p_temp_token   text,
  p_new_password text
)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co public.companies;
  v_pc public.portal_clients;
BEGIN
  SELECT * INTO v_co
  FROM public.companies
  WHERE company_code = UPPER(TRIM(p_company_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid company');
  END IF;

  SELECT * INTO v_pc
  FROM public.portal_clients
  WHERE company_id            = v_co.id
    AND email                 = LOWER(TRIM(p_email))
    AND temp_token            = p_temp_token
    AND temp_token_expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired link. Ask your admin to re-send the invite.');
  END IF;

  IF LENGTH(TRIM(p_new_password)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 8 characters');
  END IF;

  UPDATE public.portal_clients SET
    password_hash         = crypt(p_new_password, gen_salt('bf', 8)),
    temp_token            = NULL,
    temp_token_expires_at = NULL,
    is_active             = true,
    updated_at            = now()
  WHERE id = v_pc.id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.portal_set_password(text,text,text,text) TO anon, authenticated;

-- ── P3e: get_portal_client_data RPC ──────────────────────────────────────
-- Session-token gated — client never sends their own client_id.
-- Returns the full structure that buildPortalLayout() in buyer-portal.html expects:
-- { client: {id, company_id, full_name, cnic, phone_primary},
--   sale: {id, unit_id, ...},  unit: {id, unit_no, ...},  floor: {name} }
CREATE OR REPLACE FUNCTION public.get_portal_client_data(
  p_session_token text
)
RETURNS jsonb LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ses  public.portal_sessions;
  v_cl   public.clients;
  v_sale RECORD;
  v_unit RECORD;
  v_fl   RECORD;
BEGIN
  -- Validate session
  SELECT * INTO v_ses
  FROM public.portal_sessions
  WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_expired');
  END IF;

  -- Load client
  SELECT * INTO v_cl
  FROM public.clients
  WHERE id = v_ses.client_id AND company_id = v_ses.company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_not_found');
  END IF;

  -- Primary active sale (most recent)
  SELECT
    s.id, s.sale_number, s.sale_date, s.status,
    s.unit_id,
    COALESCE(s.net_amount, s.total_amount, 0)       AS net_amount,
    COALESCE(s.total_amount, s.net_amount, 0)        AS total_amount,
    COALESCE(s.discount, 0)                          AS discount,
    COALESCE(s.down_payment, 0)                      AS down_payment,
    s.installment_count,
    COALESCE((
      SELECT SUM(p.amount)
      FROM public.payments p
      WHERE p.sale_id = s.id AND p.company_id = s.company_id
        AND p.status IN ('received','cleared')
    ), 0)                                            AS total_paid,
    GREATEST(0,
      COALESCE(s.net_amount, s.total_amount, 0)
      - COALESCE((
          SELECT SUM(p.amount) FROM public.payments p
          WHERE p.sale_id = s.id AND p.company_id = s.company_id
            AND p.status IN ('received','cleared')
        ), 0)
    )                                                AS total_outstanding,
    (SELECT i.due_date FROM public.installments i
     WHERE i.sale_id = s.id AND i.company_id = s.company_id
       AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0
       AND i.due_date >= CURRENT_DATE
     ORDER BY i.due_date LIMIT 1)                   AS next_due_date,
    GREATEST(0, (
      SELECT COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0)
      FROM public.installments i
      WHERE i.sale_id = s.id AND i.company_id = s.company_id
        AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0
        AND i.due_date >= CURRENT_DATE
      ORDER BY i.due_date LIMIT 1
    ))                                               AS next_due_amount
  INTO v_sale
  FROM public.sales s
  WHERE s.client_id = v_ses.client_id AND s.company_id = v_ses.company_id
    AND s.status = 'active'
  ORDER BY s.sale_date DESC NULLS LAST
  LIMIT 1;

  -- Load unit
  IF v_sale.unit_id IS NOT NULL THEN
    SELECT u.id, u.unit_no, u.area_sqft AS area, 'Sqft' AS area_unit,
           u.floor_id, u.unit_type,
           NULL::text AS floor_label,
           NULL::text AS block,
           NULL::int  AS bedrooms,
           NULL::int  AS bathrooms
    INTO v_unit
    FROM public.units u
    WHERE u.id = v_sale.unit_id;

    -- Load floor
    IF v_unit.floor_id IS NOT NULL THEN
      SELECT id, COALESCE(floor_name, floor_number::text, 'Floor') AS name
      INTO v_fl
      FROM public.floors WHERE id = v_unit.floor_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'client', jsonb_build_object(
      'id',           v_cl.id,
      'company_id',   v_ses.company_id,
      'full_name',    v_cl.full_name,
      'client_code',  v_cl.client_code,
      'cnic',         v_cl.cnic,
      'phone_primary',v_cl.phone_primary,
      'email',        v_cl.email
    ),
    'sale', CASE WHEN v_sale.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'id',               v_sale.id,
      'sale_number',      v_sale.sale_number,
      'sale_date',        v_sale.sale_date,
      'status',           v_sale.status,
      'unit_id',          v_sale.unit_id,
      'net_amount',       v_sale.net_amount,
      'total_amount',     v_sale.total_amount,
      'discount',         v_sale.discount,
      'down_payment',     v_sale.down_payment,
      'installment_count',v_sale.installment_count,
      'total_paid',       v_sale.total_paid,
      'total_outstanding',v_sale.total_outstanding,
      'next_due_date',    v_sale.next_due_date,
      'next_due_amount',  v_sale.next_due_amount
    ) END,
    'unit', CASE WHEN v_unit.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'id',          v_unit.id,
      'unit_no',     v_unit.unit_no,
      'unit_type',   v_unit.unit_type,
      'area',        v_unit.area,
      'area_unit',   v_unit.area_unit,
      'floor_label', v_unit.floor_label,
      'block',       v_unit.block,
      'bedrooms',    v_unit.bedrooms,
      'bathrooms',   v_unit.bathrooms
    ) END,
    'floor', CASE WHEN v_fl.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'id',   v_fl.id,
      'name', v_fl.name
    ) END,
    'company_id',   v_ses.company_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_portal_client_data(text) TO anon, authenticated;

-- ── P3f: admin_invite_portal_client RPC ──────────────────────────────────
-- Admin creates or resets portal access for a client. Returns temp password.
CREATE OR REPLACE FUNCTION public.admin_invite_portal_client(
  p_client_id  uuid,
  p_email      text,
  p_company_id uuid
)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      public.app_users;
  v_cl      public.clients;
  v_co      public.companies;
  v_temp_pw text;
  v_tok     text;
  v_pc_id   uuid;
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

  SELECT * INTO v_cl FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_not_found');
  END IF;
  SELECT * INTO v_co FROM public.companies WHERE id = p_company_id;

  -- Generate temp password (8-char uppercase alphanumeric) and token
  v_temp_pw := UPPER(SUBSTRING(encode(gen_random_bytes(6), 'hex') FROM 1 FOR 8));
  v_tok     := encode(gen_random_bytes(32), 'hex');

  -- Upsert portal_clients
  INSERT INTO public.portal_clients
    (company_id, client_id, email, password_hash, temp_token, temp_token_expires_at, is_active)
  VALUES
    (p_company_id, p_client_id, LOWER(TRIM(p_email)),
     crypt(v_temp_pw, gen_salt('bf', 8)),
     v_tok, now() + INTERVAL '72 hours', true)
  ON CONFLICT (company_id, email) DO UPDATE SET
    password_hash         = crypt(v_temp_pw, gen_salt('bf', 8)),
    temp_token            = v_tok,
    temp_token_expires_at = now() + INTERVAL '72 hours',
    client_id             = p_client_id,
    is_active             = true,
    updated_at            = now()
  RETURNING id INTO v_pc_id;

  -- Enqueue welcome email via Module 7 (fire-and-forget, tolerates missing provider)
  BEGIN
    PERFORM public.enqueue_message(
      p_company_id,
      jsonb_build_object(
        'channel',    'email',
        'to_address', LOWER(TRIM(p_email)),
        'subject',    'Your Buyer Portal Access — ' || COALESCE(v_co.name, 'Nexunova RMS'),
        'body',       'Dear ' || v_cl.full_name || E',\n\n'
                      || 'Your buyer portal access has been set up by '
                      || COALESCE(v_co.name, 'your company') || E'.\n\n'
                      || 'Login at: buyer-portal.html' || E'\n'
                      || 'Company Code: ' || COALESCE(v_co.company_code, '') || E'\n'
                      || 'Email: '        || LOWER(TRIM(p_email))             || E'\n'
                      || 'Temporary Password: ' || v_temp_pw || E'\n\n'
                      || 'This password expires in 72 hours. Please log in and change it.'
                      || E'\n\nThank you,\n' || COALESCE(v_co.name, 'Nexunova RMS'),
        'category',   'portal_invite'
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success',      true,
    'pc_id',        v_pc_id,
    'temp_password', v_temp_pw,
    'email',        LOWER(TRIM(p_email))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_invite_portal_client(uuid,text,uuid) TO authenticated;

-- ── P3g: get_portal_access_status RPC ────────────────────────────────────
-- Used by clients.js to show portal badge on client detail.
CREATE OR REPLACE FUNCTION public.get_portal_access_status(
  p_client_id  uuid,
  p_company_id uuid
)
RETURNS jsonb LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'has_access',    true,
      'email',         email,
      'is_active',     is_active,
      'last_login_at', last_login_at,
      'created_at',    created_at
    )
    FROM public.portal_clients
    WHERE client_id = p_client_id AND company_id = p_company_id
    LIMIT 1),
    jsonb_build_object('has_access', false)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_portal_access_status(uuid,uuid) TO authenticated;
