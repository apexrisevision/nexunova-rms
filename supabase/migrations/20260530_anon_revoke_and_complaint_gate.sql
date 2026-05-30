-- ════════════════════════════════════════════════════════════
-- ANON EXECUTE REVOKE + buyer-complaint session-token gate
-- 2026-05-30. Launch blocker.
-- ════════════════════════════════════════════════════════════
-- Closes the anon-key data-leak hole. Before this migration, anyone with
-- the publishable anon key + a company_id could call any caller-scoped RPC
-- (list_clients, list_sales, get_unit_ledger, etc.) and get the full
-- company's data, because the v_all formula treats (me.id IS NULL) as
-- permissive to support the report-viewer + buyer-portal flows.
--
-- After this migration:
--   • PUBLIC + anon lose EXECUTE on ALL public-schema functions
--   • authenticated + service_role get EXECUTE on ALL public-schema
--     functions (preserves the entire authenticated app + edge functions)
--   • anon gets EXECUTE back on EXACTLY 27 functions (the keep-list):
--       - 5 pre-auth bootstrap (login + forgot-pw)
--       - 1 signup
--       - 13 caller-blind report RPCs (viewer.html shareable link)
--       - 8 buyer-portal (portal_login + 7 token-gated buyer views)
--   • Default privileges flipped so future CREATE FUNCTION statements
--     default to authenticated-only, not anon (prevents regression)
--
-- ALSO bundled: get_buyer_complaints + submit_buyer_complaint rewrite.
-- They previously took (p_client_id, p_company_id) and only did a data-
-- consistency check — anyone with anon + a client_id/company_id pair
-- could read or impersonate that buyer's complaints. Rewritten to take
-- p_session_token, deriving client_id/company_id from portal_sessions
-- (same gate as get_portal_client_data). Old (uuid, uuid) signatures
-- DROPPED — no overload left callable.

-- ────────────────── 1. Default privileges (regression-proof) ──────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ────────────────── 2. Blanket revoke ──────────────────

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- ────────────────── 3. Blanket re-grant to authenticated + service_role ──────────────────

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ────────────────── 4. Rewrite the two complaint RPCs (session-token gate) ──────────────────

DROP FUNCTION IF EXISTS public.get_buyer_complaints(uuid, uuid);
DROP FUNCTION IF EXISTS public.submit_buyer_complaint(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.get_buyer_complaints(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.portal_sessions; v_rows jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.portal_sessions
  WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'session_expired');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           c.id,
    'subject',      c.subject,
    'message',      c.message,
    'status',       c.status,
    'response',     c.response,
    'created_at',   c.created_at,
    'responded_at', c.responded_at
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_rows FROM buyer_complaints c
  WHERE c.client_id = v_ses.client_id AND c.company_id = v_ses.company_id;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_buyer_complaint(p_session_token text, p_subject text, p_message text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.portal_sessions; v_id uuid;
BEGIN
  SELECT * INTO v_ses FROM public.portal_sessions
  WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'session_expired');
  END IF;
  IF length(trim(p_subject)) < 3 THEN
    RETURN jsonb_build_object('error', 'Subject too short');
  END IF;
  IF length(trim(p_message)) < 10 THEN
    RETURN jsonb_build_object('error', 'Message too short');
  END IF;
  INSERT INTO buyer_complaints (company_id, client_id, subject, message)
  VALUES (v_ses.company_id, v_ses.client_id, trim(p_subject), trim(p_message))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;

-- ────────────────── 5. Selective anon GRANT — the 27 keep-list ──────────────────

-- Pre-auth bootstrap (5)
GRANT EXECUTE ON FUNCTION public.verify_login(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.log_auth_event(uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.send_admin_reset_otp(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.notify_admin_subuser_reset(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_reset_otp(text, text, text) TO anon;

-- Signup (1)
GRANT EXECUTE ON FUNCTION public.signup_new_company(text, text, text, text, text, text, text, text, text, text, text) TO anon;

-- Report viewer (13)
GRANT EXECUTE ON FUNCTION public.get_company_branding(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_collection_report(uuid, date, date, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_sales_register(uuid, date, date, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_outstanding_report(uuid, date, date, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_unit_inventory(uuid, date, date, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_aging_report(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_commission_report(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_project_summary(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tax_wht_report(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_post_possession_dues_report(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_legal_portfolio(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_executive_kpis(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_collection_trend(uuid, uuid) TO anon;

-- Buyer portal (8)
GRANT EXECUTE ON FUNCTION public.portal_login(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_client_data(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_payment_schedule(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_receipts(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_possession_for_portal(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_nocs_for_portal(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_complaints(text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_buyer_complaint(text, text, text) TO anon;
