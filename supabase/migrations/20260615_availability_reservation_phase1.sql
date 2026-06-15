-- ============================================================================
-- NEXUNOVA RMS — AVAILABILITY & RESERVATION — PHASE 1
-- 2026-06-15.  Additive only. Plan = AVAILABILITY_RESERVATION_PLAN.md.
-- ----------------------------------------------------------------------------
-- Sales-access layer (NOT app_users / paid seats) + availability board +
-- reserve, with a DB-LEVEL anti-double-booking lock. Cloned from the
-- Buyer-Portal pattern (portal_clients/portal_sessions + portal_magic_login +
-- the Phase-0 IDOR fix): EVERY sales data RPC takes p_session_token and derives
-- identity/scope SERVER-SIDE; anon GRANT, the token is the only gate.
--
-- Owner decisions (locked): (A) scope = admin-ASSIGNED project (sales_users
-- .project_id; NULL = all projects, but the admin picks one by default).
-- (B) convert reservation -> sale is ADMIN-only (Phase 2); Phase 1 only makes
-- the reservation visible to the admin for later conversion.
--
-- Token is RECORD-ONLY: token_received / token_amount / note live on the
-- reservation. No payment row, no receipt, no ledger posting anywhere.
-- Plan-limit enforcement (15/25/50) is Phase 3.
-- ============================================================================

-- ── 1. TABLES ───────────────────────────────────────────────────────────────

-- 1a. sales_users  (≈ portal_clients) — light access identity, NOT an app_user
CREATE TABLE IF NOT EXISTS public.sales_users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid REFERENCES public.projects(id) ON DELETE CASCADE,  -- NULL = all projects
  full_name             text NOT NULL,
  phone                 text NOT NULL,
  pin_hash              text,            -- bcrypt of a 4–6 digit PIN
  temp_token            text,            -- powers the magic link (revocable, TTL'd)
  temp_token_expires_at timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  last_login_at         timestamptz,
  created_by            uuid,            -- the admin app_user who added them
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_users_company_phone_key
  ON public.sales_users (company_id, lower(phone));
CREATE INDEX IF NOT EXISTS sales_users_temp_token_idx
  ON public.sales_users (temp_token) WHERE temp_token IS NOT NULL;

-- 1b. sales_sessions  (≈ portal_sessions) — issued tokens, 8h TTL
CREATE TABLE IF NOT EXISTS public.sales_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  sales_user_id uuid NOT NULL REFERENCES public.sales_users(id) ON DELETE CASCADE,
  project_id    uuid,            -- scope snapshot at login (NULL = all projects)
  session_token text NOT NULL,
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '8 hours'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_sessions_token_idx ON public.sales_sessions (session_token);

-- 1c. reservations — the reservation record (token is record-only)
CREATE TABLE IF NOT EXISTS public.reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  project_id        uuid NOT NULL,
  unit_id           uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  reserved_by       uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,  -- the sales_user
  client_id         uuid REFERENCES public.clients(id) ON DELETE SET NULL,      -- may not exist yet
  client_name       text NOT NULL,
  client_phone      text,
  expiry_date       timestamptz NOT NULL,
  token_received    boolean NOT NULL DEFAULT false,        -- RECORD-ONLY
  token_amount      numeric(15,2) NOT NULL DEFAULT 0,      -- RECORD-ONLY (no payment posted)
  note              text,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','converted','cancelled','expired')),
  converted_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  cancelled_by      uuid,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- ★★★ THE ANTI-DOUBLE-BOOK LOCK (declarative backstop) ★★★
-- A second ACTIVE reservation on the same unit is a DB-level impossibility.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_unit
  ON public.reservations (unit_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS reservations_company_status_idx ON public.reservations (company_id, status);
CREATE INDEX IF NOT EXISTS reservations_reserved_by_idx    ON public.reservations (reserved_by);

-- ── 2. RLS: deny-all (DEFINER RPCs are the only access path) ─────────────────
ALTER TABLE public.sales_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations   ENABLE ROW LEVEL SECURITY;
-- (no policies = no direct anon/authenticated access; SECURITY DEFINER bypasses RLS)

-- ── 3. ADMIN PROVISIONING RPCs (≈ admin_invite_portal_client) ────────────────

CREATE OR REPLACE FUNCTION public.create_sales_user(
  p_company_id uuid, p_project_id uuid, p_name text, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_me public.app_users; v_co public.companies; v_pin text; v_tok text; v_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  IF TRIM(COALESCE(p_name,''))='' OR TRIM(COALESCE(p_phone,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','name_phone_required'); END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;

  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;
  v_pin := LPAD((FLOOR(random()*1000000))::int::text, 6, '0');
  v_tok := encode(gen_random_bytes(32),'hex');

  INSERT INTO public.sales_users
    (company_id, project_id, full_name, phone, pin_hash, temp_token, temp_token_expires_at, is_active, created_by)
  VALUES
    (p_company_id, p_project_id, TRIM(p_name), TRIM(p_phone), crypt(v_pin, gen_salt('bf',8)),
     v_tok, now()+interval '30 days', true, v_me.id)
  ON CONFLICT (company_id, lower(phone)) DO UPDATE SET
    full_name=TRIM(p_name), project_id=p_project_id, pin_hash=crypt(v_pin, gen_salt('bf',8)),
    temp_token=v_tok, temp_token_expires_at=now()+interval '30 days', is_active=true, updated_at=now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'sales_user_id',v_id,
    'temp_pin',v_pin,'temp_token',v_tok,'company_code',v_co.company_code);
END; $$;

CREATE OR REPLACE FUNCTION public.deactivate_sales_user(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  UPDATE public.sales_users SET is_active=false, temp_token=NULL, updated_at=now()
   WHERE id=p_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  DELETE FROM public.sales_sessions WHERE sales_user_id=p_id;
  RETURN jsonb_build_object('success',true);
END; $$;

CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'phone', su.phone,
    'project_id', su.project_id, 'project_name', p.project_name,
    'is_active', su.is_active, 'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r
                            WHERE r.reserved_by=su.id AND r.status='active')
  ) ORDER BY su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su
  LEFT JOIN public.projects p ON p.id=su.project_id
  WHERE su.company_id=p_company_id;
  RETURN jsonb_build_object('success',true,'sales_users',v_rows);
END; $$;

-- ── 4. SALES AUTH (clone of portal_login / portal_magic_login) ───────────────
-- search_path MUST include 'extensions' (pgcrypto crypt/gen_salt live there) —
-- the exact bug that once broke portal_login.

CREATE OR REPLACE FUNCTION public.sales_login(p_company_code text, p_phone text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_co public.companies; v_su public.sales_users; v_tok text;
BEGIN
  SELECT * INTO v_co FROM public.companies
   WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company code'); END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND LOWER(phone)=LOWER(TRIM(p_phone)) AND is_active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;
  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(p_pin, v_su.pin_hash) THEN
    RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;

  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_co.id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;

  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',v_co.company_name,
    'sales_user_name',v_su.full_name,'project_id',v_su.project_id);
END; $$;

CREATE OR REPLACE FUNCTION public.sales_magic_login(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_su public.sales_users; v_co public.companies; v_tok text;
BEGIN
  SELECT * INTO v_su FROM public.sales_users
   WHERE temp_token=p_token AND temp_token_expires_at > now() AND is_active=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Invalid or expired link. Ask your admin to re-send your access link.'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE id=v_su.company_id;
  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_su.company_id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',v_co.company_name,
    'sales_user_name',v_su.full_name,'project_id',v_su.project_id);
END; $$;

-- ── 5. AVAILABILITY BOARD (session-gated; scope derived server-side) ─────────
CREATE OR REPLACE FUNCTION public.get_availability_board(p_session_token text, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_scope uuid; v_result jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  -- project-locked sales user => forced scope; else honor optional filter
  v_scope := COALESCE(v_ses.project_id, p_project_id);

  SELECT jsonb_build_object('success',true,'scope_project_id',v_ses.project_id,
           'projects', COALESCE(jsonb_agg(proj ORDER BY proj->>'project_name'), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name,
      'counts', jsonb_build_object(
        'available', count(*) FILTER (WHERE st.is_available),
        'reserved',  count(*) FILTER (WHERE st.status_code='RESERVED'),
        'sold',      count(*) FILTER (WHERE st.status_code='SOLD'),
        'total',     count(*)),
      'units', COALESCE(jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'unit_no', u.unit_no,
        'floor_label', COALESCE(NULLIF(u.floor_label,''), 'Floor '||COALESCE(u.floor_no::text,'—')),
        'floor_no', COALESCE(u.floor_no, 0),
        'status_code', st.status_code, 'status_name', st.status_name,
        'color_hex', st.color_hex, 'is_available', COALESCE(st.is_available,false),
        'reservation', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
             'reserved_by_name', su.full_name, 'client_name', r.client_name, 'expiry_date', r.expiry_date)
           ELSE NULL END
      ) ORDER BY COALESCE(u.floor_no,0), u.unit_no), '[]'::jsonb)
    ) AS proj
    FROM public.projects p
    JOIN public.units u ON u.project_id=p.id AND u.company_id=v_ses.company_id
    LEFT JOIN public.category_unit_statuses st ON st.id=u.status_id
    LEFT JOIN public.reservations r ON r.unit_id=u.id AND r.status='active'
    LEFT JOIN public.sales_users su ON su.id=r.reserved_by
    WHERE p.company_id=v_ses.company_id
      AND (v_scope IS NULL OR p.id=v_scope)
    GROUP BY p.id, p.project_name
  ) q;

  RETURN v_result;
END; $$;

-- ── 6. RESERVE_UNIT — the core, with the airtight DB-level lock ──────────────
CREATE OR REPLACE FUNCTION public.reserve_unit(
  p_session_token text, p_unit_id uuid, p_client_name text, p_client_phone text,
  p_expiry_days int, p_token_received boolean, p_token_amount numeric, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_unit public.units; v_reserved_status uuid;
        v_days int; v_res_id uuid; v_expiry timestamptz;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  IF TRIM(COALESCE(p_client_name,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','client_name_required'); END IF;
  v_days := CASE WHEN p_expiry_days IN (3,7) THEN p_expiry_days ELSE 7 END;

  -- ★ THE LOCK: row-lock the unit. Concurrent reserve_unit on the same unit
  --   BLOCKS here until this txn commits, then re-reads the (now changed) row.
  SELECT * INTO v_unit FROM public.units
   WHERE id=p_unit_id AND company_id=v_ses.company_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','unit_not_found'); END IF;

  -- scope guard (Decision A): project-locked sales user only reserves in scope
  IF v_ses.project_id IS NOT NULL AND v_unit.project_id <> v_ses.project_id THEN
    RETURN jsonb_build_object('success',false,'error','out_of_scope'); END IF;

  -- availability re-checked INSIDE the lock (never trust stale UI state)
  IF NOT EXISTS (SELECT 1 FROM public.category_unit_statuses st
                 WHERE st.id=v_unit.status_id AND st.is_available) THEN
    RETURN jsonb_build_object('success',false,'error','unit_unavailable',
      'message','This unit is no longer available — it may have just been reserved or sold.'); END IF;
  IF EXISTS (SELECT 1 FROM public.reservations WHERE unit_id=p_unit_id AND status='active') THEN
    RETURN jsonb_build_object('success',false,'error','already_reserved',
      'message','This unit already has an active reservation.'); END IF;

  SELECT id INTO v_reserved_status FROM public.category_unit_statuses
   WHERE company_id=v_ses.company_id AND project_id=v_unit.project_id
     AND (LOWER(status_code)='reserved' OR status_name ILIKE '%reserved%') AND is_active
   ORDER BY sort_order LIMIT 1;
  IF v_reserved_status IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','no_reserved_status',
      'message','This project has no Reserved status configured.'); END IF;

  v_expiry := now() + (v_days || ' days')::interval;

  INSERT INTO public.reservations
    (company_id, project_id, unit_id, reserved_by, client_name, client_phone,
     expiry_date, token_received, token_amount, note, status)
  VALUES
    (v_ses.company_id, v_unit.project_id, p_unit_id, v_ses.sales_user_id, TRIM(p_client_name),
     NULLIF(TRIM(COALESCE(p_client_phone,'')),''), v_expiry,
     COALESCE(p_token_received,false), COALESCE(p_token_amount,0),
     NULLIF(TRIM(COALESCE(p_note,'')),''), 'active')
  RETURNING id INTO v_res_id;

  UPDATE public.units SET status_id=v_reserved_status, updated_at=now()
   WHERE id=p_unit_id AND company_id=v_ses.company_id;

  RETURN jsonb_build_object('success',true,'reservation_id',v_res_id,'expiry_date',v_expiry);
EXCEPTION
  WHEN unique_violation THEN     -- partial unique index = ultimate backstop
    RETURN jsonb_build_object('success',false,'error','already_reserved',
      'message','This unit already has an active reservation.');
END; $$;

-- ── 7. CANCEL (sales user — own active only) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_reservation(p_session_token text, p_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_res public.reservations; v_avail uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_res FROM public.reservations
   WHERE id=p_reservation_id AND company_id=v_ses.company_id
     AND reserved_by=v_ses.sales_user_id AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_yours'); END IF;

  UPDATE public.reservations
   SET status='cancelled', cancelled_by=v_ses.sales_user_id, cancelled_at=now(), updated_at=now()
   WHERE id=p_reservation_id;

  SELECT id INTO v_avail FROM public.category_unit_statuses
   WHERE company_id=v_res.company_id AND project_id=v_res.project_id AND is_available AND is_active
   ORDER BY sort_order LIMIT 1;
  IF v_avail IS NOT NULL THEN
    UPDATE public.units SET status_id=v_avail, updated_at=now()
     WHERE id=v_res.unit_id AND company_id=v_res.company_id; END IF;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 8. MY RESERVATIONS (sales user — own only) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_reservations(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.sales_sessions; v_res jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'client_name', r.client_name, 'client_phone', r.client_phone,
    'token_received', r.token_received, 'token_amount', r.token_amount, 'note', r.note,
    'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_res
  FROM public.reservations r
  JOIN public.units u ON u.id=r.unit_id
  LEFT JOIN public.projects p ON p.id=r.project_id
  WHERE r.company_id=v_ses.company_id AND r.reserved_by=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true,'reservations',v_res);
END; $$;

-- ── 9. ADMIN reservation views + override cancel ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_reservations_admin(
  p_company_id uuid, p_project_id uuid DEFAULT NULL, p_status text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_res jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'unit_id', r.unit_id, 'unit_no', u.unit_no, 'project_name', p.project_name,
    'reserved_by_name', su.full_name, 'reserved_by_phone', su.phone,
    'client_name', r.client_name, 'client_phone', r.client_phone,
    'token_received', r.token_received, 'token_amount', r.token_amount, 'note', r.note,
    'status', r.status, 'expiry_date', r.expiry_date, 'created_at', r.created_at,
    'converted_sale_id', r.converted_sale_id
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_res
  FROM public.reservations r
  JOIN public.units u ON u.id=r.unit_id
  LEFT JOIN public.projects p ON p.id=r.project_id
  LEFT JOIN public.sales_users su ON su.id=r.reserved_by
  WHERE r.company_id=p_company_id
    AND (p_project_id IS NULL OR r.project_id=p_project_id)
    AND (p_status IS NULL OR p_status='all' OR r.status=p_status);
  RETURN jsonb_build_object('success',true,'reservations',v_res);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_reservation(p_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_res public.reservations; v_avail uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_res FROM public.reservations
   WHERE id=p_reservation_id AND company_id=v_me.company_id AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.reservations
   SET status='cancelled', cancelled_by=v_me.id, cancelled_at=now(), updated_at=now()
   WHERE id=p_reservation_id;
  SELECT id INTO v_avail FROM public.category_unit_statuses
   WHERE company_id=v_res.company_id AND project_id=v_res.project_id AND is_available AND is_active
   ORDER BY sort_order LIMIT 1;
  IF v_avail IS NOT NULL THEN
    UPDATE public.units SET status_id=v_avail, updated_at=now()
     WHERE id=v_res.unit_id AND company_id=v_res.company_id; END IF;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 10. GRANTS (anon = the role; the SESSION TOKEN / _rms_caller is the gate) ─
REVOKE ALL ON FUNCTION public.sales_login(text,text,text)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_magic_login(text)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_availability_board(text,uuid)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_unit(text,uuid,text,text,int,boolean,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_reservation(text,uuid)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_reservations(text)                         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sales_login(text,text,text)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_magic_login(text)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_availability_board(text,uuid)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_unit(text,uuid,text,text,int,boolean,numeric,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(text,uuid)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_reservations(text)                      TO anon, authenticated;

-- Admin RPCs: _rms_caller()+_rms_is_admin() gated (same posture as create_app_user / admin_invite_portal_client)
GRANT EXECUTE ON FUNCTION public.create_sales_user(uuid,uuid,text,text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_sales_user(uuid)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_users_admin(uuid)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reservations_admin(uuid,uuid,text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_reservation(uuid)                 TO anon, authenticated;
