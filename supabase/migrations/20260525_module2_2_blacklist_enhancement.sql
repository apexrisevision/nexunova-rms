-- ================================================================
-- NEXUNOVA RMS — MODULE 2.2 BLACKLIST REGISTER ENHANCEMENT
-- 2026-05-25 — APPLIED via MCP + verified (reason_type round-trip;
-- check_client_blacklisted flags active entry, clean for others). 0 residue.
--
--   (a) blacklisted_clients.reason_type (default/fraud/legal/breach/other)
--   (b) create_blacklist_entry + list_blacklisted_clients round-trip reason_type
--   (c) check_client_blacklisted(p_client_id, p_company_id) — auto-flag
--       used by the new-sale client picker (sales.js) to warn the officer.
-- Removal workflow + approval already existed (is_active / removed_* / approved_by).
-- Canonical bodies applied via apply_migration 'module2_2_blacklist_enhancement'.
-- ================================================================

ALTER TABLE public.blacklisted_clients ADD COLUMN IF NOT EXISTS reason_type text DEFAULT 'other';

-- check_client_blacklisted: active blacklist lookup for the new-sale guard.
CREATE OR REPLACE FUNCTION public.check_client_blacklisted(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'blacklisted', true, 'reason', reason, 'reason_type', reason_type,
       'blacklist_date', blacklist_date)
     FROM blacklisted_clients
     WHERE client_id = p_client_id AND company_id = p_company_id AND is_active = true
     ORDER BY blacklist_date DESC LIMIT 1),
    jsonb_build_object('blacklisted', false)
  );
$function$;
GRANT EXECUTE ON FUNCTION public.check_client_blacklisted(uuid, uuid) TO anon, authenticated;

-- create_blacklist_entry (+reason_type) and list_blacklisted_clients (+reason_type)
-- were also CREATE OR REPLACE'd in the applied migration; see live DB for bodies.
