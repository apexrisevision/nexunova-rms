-- ═══════════════════════════════════════════════════════════════════════════
-- The payee master opens
-- ───────────────────────────────────────────────────────────────────────────
-- Invariant 6: names come from a master, never from a text box. RMS has clients
-- (buyers) and agents (dealers) and nothing at all for the electricity company,
-- the security guard or the stationer. This is that list, and the four calls
-- that maintain it.
--
-- NOBODY IS EVER DELETED. A payee that has been named on an entry is named on
-- it forever; deactivating removes them from the picker and leaves the history
-- readable. There is no delete RPC and there will not be one.
--
-- WHO MAY MAINTAIN IT. §A10's matrix puts "payees CRUD" at Accountant and CFO,
-- not Cashier and not Director. That is finance / accounts, plus _dc_is_cfo().
-- Plain `admin` is deliberately absent, for the reason in RULES §0.4: in this
-- database admin is the everyday data-entry role, and FMH's only admin is a
-- filling clerk. Reading the list is wider — a cashier has to pick a payee.
--
-- ERROR CODES are BLUEPRINT §A9's, not RMS's usual lowercase set. This module
-- has one taxonomy and the UI maps it to human sentences; NOT_AUTHORIZED covers
-- both "no session" and "wrong tenant", because the caller is owed neither
-- distinction.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Who may maintain the master ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._dc_can_manage_payees(p_user public.app_users)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT p_user.role IN ('finance', 'accounts')      -- Accountant (legacy alias)
      OR public._dc_is_cfo(p_user);                  -- CFO, owner, super-admin
$fn$;

COMMENT ON FUNCTION public._dc_can_manage_payees(public.app_users) IS
  'BLUEPRINT §A10: payees CRUD is Accountant+. finance/accounts, plus whatever _dc_is_cfo() admits. Excludes plain admin — see RULES §0.4.';

REVOKE ALL ON FUNCTION public._dc_can_manage_payees(public.app_users) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dc_can_manage_payees(public.app_users) TO service_role;

-- ── list_payees ────────────────────────────────────────────────────────────
-- Active first, then most recently used, then alphabetical — the order §A11's
-- EntitySelect wants, where the five recents sit above the rest.
-- last_used_at comes from the cash book itself rather than a column somebody
-- has to remember to update.
CREATE OR REPLACE FUNCTION public.list_payees(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_include_inactive boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_rows jsonb;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- Invariant 8: a project-scoped ask from a non-admin needs the assignment.
  IF p_project_id IS NOT NULL
     AND NOT public._rms_is_admin(v_me)
     AND NOT public._dc_is_cfo(v_me)
     AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                      WHERE user_id = v_me.id AND company_id = p_company_id
                        AND project_id = p_project_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.is_active DESC,
                                     r.last_used_at DESC NULLS LAST,
                                     r.name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT p.id, p.name, p.kind, p.project_id, p.client_id, p.is_active,
           p.normalized_name,
           (SELECT max(e.created_at) FROM public.cash_entries e WHERE e.payee_id = p.id) AS last_used_at
      FROM public.payees p
     WHERE p.company_id = p_company_id
       AND (p_include_inactive OR p.is_active)
       AND (p_project_id IS NULL OR p.project_id IS NULL OR p.project_id = p_project_id)
  ) r;

  RETURN jsonb_build_object('success', true, 'payees', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_payees(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payees(uuid, uuid, boolean) TO authenticated, service_role;

-- ── create_payee ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payee(
  p_company_id uuid,
  p_name text,
  p_kind text,
  p_project_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_id uuid; v_existing text;
BEGIN
  IF v_me.id IS NULL
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id)
     OR NOT public._dc_can_manage_payees(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_NAME_REQUIRED');
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('CUSTOMER','VENDOR','STAFF','DEALER','OTHER') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_KIND_INVALID');
  END IF;
  IF p_kind <> 'CUSTOMER' AND p_client_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_KIND_INVALID',
      'message', 'Only a CUSTOMER payee may be linked to a client.');
  END IF;

  BEGIN
    INSERT INTO public.payees (company_id, project_id, name, kind, client_id, created_by)
    VALUES (p_company_id, p_project_id, btrim(p_name), p_kind, p_client_id, v_me.id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Show the name that is already there. "Zubair" colliding with " zubair "
    -- is only comprehensible if the answer says which spelling won.
    SELECT p.name INTO v_existing
      FROM public.payees p
     WHERE p.company_id = p_company_id
       AND COALESCE(p.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND p.normalized_name = btrim(regexp_replace(
             regexp_replace(lower(btrim(p_name)), '[[:punct:]]', '', 'g'), '\s+', ' ', 'g'));
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_DUPLICATE',
      'existing_name', v_existing,
      'message', format('"%s" is already on the list as "%s".', btrim(p_name), v_existing));
  END;

  RETURN jsonb_build_object('success', true, 'payee_id', v_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_payee(uuid, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payee(uuid, text, text, uuid, uuid) TO authenticated, service_role;

-- ── rename_payee ───────────────────────────────────────────────────────────
-- A rename, not a replace: the id is unchanged, so every entry that ever named
-- this payee now reads the corrected spelling. That is the point of a master.
CREATE OR REPLACE FUNCTION public.rename_payee(
  p_payee_id uuid, p_company_id uuid, p_new_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_proj uuid; v_existing text;
BEGIN
  IF v_me.id IS NULL
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id)
     OR NOT public._dc_can_manage_payees(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF p_new_name IS NULL OR btrim(p_new_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_NAME_REQUIRED');
  END IF;

  SELECT project_id INTO v_proj FROM public.payees
   WHERE id = p_payee_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_NOT_FOUND');
  END IF;

  BEGIN
    UPDATE public.payees SET name = btrim(p_new_name) WHERE id = p_payee_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT p.name INTO v_existing
      FROM public.payees p
     WHERE p.company_id = p_company_id
       AND COALESCE(p.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(v_proj, '00000000-0000-0000-0000-000000000000'::uuid)
       AND p.normalized_name = btrim(regexp_replace(
             regexp_replace(lower(btrim(p_new_name)), '[[:punct:]]', '', 'g'), '\s+', ' ', 'g'))
       AND p.id <> p_payee_id;
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_DUPLICATE',
      'existing_name', v_existing,
      'message', format('"%s" is already on the list as "%s".', btrim(p_new_name), v_existing));
  END;

  RETURN jsonb_build_object('success', true, 'payee_id', p_payee_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rename_payee(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_payee(uuid, uuid, text) TO authenticated, service_role;

-- ── set_payee_active ───────────────────────────────────────────────────────
-- Deactivate and reactivate. There is no delete, by design.
CREATE OR REPLACE FUNCTION public.set_payee_active(
  p_payee_id uuid, p_company_id uuid, p_is_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id)
     OR NOT public._dc_can_manage_payees(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF p_is_active IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_STATE_REQUIRED');
  END IF;

  UPDATE public.payees SET is_active = p_is_active
   WHERE id = p_payee_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYEE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('success', true, 'payee_id', p_payee_id, 'is_active', p_is_active);
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_payee_active(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payee_active(uuid, uuid, boolean) TO authenticated, service_role;

COMMIT;
