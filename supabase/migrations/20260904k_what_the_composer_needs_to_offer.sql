-- ═══════════════════════════════════════════════════════════════════════════
-- What the composer needs to offer
-- ───────────────────────────────────────────────────────────────────────────
-- Two read-only lookups S1 needs to fill its two pickers and its one select.
-- Both are project-scoped by the same rule as every other read in this module
-- (invariant 8) and neither writes anything.
--
-- list_units_for_picker reads public.units — an existing RMS table — but ONLY
-- id and unit_no, for one project the caller is assigned to. §A12 says the
-- Phase-1 unit picker is "id + label only"; a cash book has no business
-- knowing a unit's price, its client or its status, so it is not told.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.list_units_for_picker(
  p_company_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_rows jsonb;
BEGIN
  IF NOT public._dc_may_touch_project(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'unit_no', u.unit_no)
                            ORDER BY u.unit_no), '[]'::jsonb)
    INTO v_rows
    FROM public.units u
   WHERE u.company_id = p_company_id AND u.project_id = p_project_id;

  RETURN jsonb_build_object('success', true, 'units', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_units_for_picker(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_units_for_picker(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_units_for_picker(uuid, uuid) IS
  'Daily Closing: id and unit_no only, for one project. Deliberately returns no price, client or status — a cash book does not need them (§A12).';

-- The QuickBooks heads a project may cite, the per-type defaults that drive the
-- SuggestedField, and the project's cash accounts for a transfer's two ends.
-- One round trip because the composer needs all three before it can draw.
CREATE OR REPLACE FUNCTION public.list_qb_accounts_for_project(
  p_company_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_accounts jsonb; v_defaults jsonb; v_cash jsonb;
BEGIN
  IF NOT public._dc_may_touch_project(v_me, p_company_id, p_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'number', a.number, 'name', a.name, 'qb_type', a.qb_type)
           ORDER BY a.number), '[]'::jsonb)
    INTO v_accounts
    FROM public.qb_accounts a
   WHERE a.company_id = p_company_id AND a.is_active;

  SELECT COALESCE(jsonb_object_agg(d.entry_type, d.default_qb_account_id)
                    FILTER (WHERE d.default_qb_account_id IS NOT NULL), '{}'::jsonb)
    INTO v_defaults
    FROM public.entry_type_defaults d
   WHERE d.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cash_account_id', c.id, 'name', c.name, 'kind', c.kind,
           'qb_account_id', c.qb_account_id) ORDER BY c.kind, c.name), '[]'::jsonb)
    INTO v_cash
    FROM public.cash_accounts c
   WHERE c.project_id = p_project_id AND c.is_active;

  RETURN jsonb_build_object('success', true,
    'accounts', v_accounts, 'defaults', v_defaults, 'cash_accounts', v_cash);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_qb_accounts_for_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_qb_accounts_for_project(uuid, uuid) TO authenticated, service_role;

-- The file bridge asks this before it will mint an upload URL: may this caller
-- touch this entry, and which project's folder does it belong in. The browser
-- never chooses its own storage path.
CREATE OR REPLACE FUNCTION public.get_cash_entry_project(
  p_company_id uuid, p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_company uuid;
BEGIN
  SELECT project_id, company_id INTO v_project, v_company
    FROM public.cash_entries WHERE id = p_entry_id;
  IF NOT FOUND OR v_company IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF NOT public._dc_may_touch_project(v_me, p_company_id, v_project) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  RETURN jsonb_build_object('success', true, 'project_id', v_project);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_cash_entry_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_entry_project(uuid, uuid) TO authenticated, service_role;

COMMIT;
