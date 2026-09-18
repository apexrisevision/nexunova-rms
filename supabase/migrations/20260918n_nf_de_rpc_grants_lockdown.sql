-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · n · RPC grants: the double-entry
-- functions were never swept the way 20260916c swept the originals
--
-- Found 2026-09-18 while building the General Journal report: checking
-- has_function_privilege('anon', ...) directly against the live catalog
-- (not assumed from the code) showed 13 functions added by the
-- double-entry work (20260918a-c) still carrying Postgres's default
-- PUBLIC EXECUTE grant — the same "20260916c only ever ran once, nothing
-- re-applies it to new functions" gap already found and fixed for VIEW
-- security_invoker earlier this session, now recurring for RPC grants.
-- 20260916c's own DO block iterated pg_proc at the moment it ran; every
-- nf_ function created after that moment inherited Postgres's ordinary
-- default (EXECUTE granted to PUBLIC on CREATE FUNCTION) because nothing
-- ever revoked it for them specifically.
--
-- Two real findings, different severity:
--
--   1. CRITICAL, exploitable by design, not just by a missing grant:
--      nf__upsert_transfer_voucher never calls nf_require_role at all —
--      unlike every other write RPC in this schema. Its INSERT path
--      (voucher doesn't exist yet) is accidentally safe today only
--      because it delegates to nf_post_voucher, which DOES check the
--      role. Its UPDATE/DELETE path (a transfer voucher with that
--      voucher_no already exists) has NO such delegation — it updates or
--      deletes nf_voucher_legs/nf_vouchers directly. Combined with the
--      open grant, this meant ANY caller — no sign-in required, the
--      public anon key is enough — could retarget or silently delete an
--      existing transfer voucher in ANY company. Fixed here by adding
--      the same nf_require_role call every other write RPC in this file
--      already has, so the grant fix below is defense in depth, not the
--      only thing standing between this and being wide open again.
--
--   2. Real but lower severity, unauthenticated READ exposure: five
--      SECURITY DEFINER functions with no internal auth check at all
--      (nf_ledger_position, nf_other_balances, nf_list_parties,
--      nf_resolve_party, nf_account_path) let anyone with the anon key —
--      again, no sign-in — read any company's cash/bank ledger position,
--      inter-company and director balances, and full party list (real
--      customer/sister-company/director names) by guessing or brute-
--      forcing a company_id (a v4 uuid, but still not a control worth
--      relying on). None of these are ever called directly by the
--      frontend or by this project's own scripts (checked: grep of
--      js/nf/*.js, nexufinance.html and scripts/nf/*.js turns up zero
--      direct RPC calls to any of them) — every real use is an internal
--      call from another SECURITY DEFINER function already owned by
--      postgres, which bypasses ACL entirely regardless of these
--      functions' own grants. So the correct fix is to revoke them down
--      to nothing at all, not to re-grant `authenticated` — there is no
--      legitimate direct caller to preserve.
--
-- nf_post_voucher itself is NOT newly broken by this: it already calls
-- nf_require_role, so an unauthenticated caller is rejected at that
-- check regardless of the grant. It still gets the same lockdown treatment
-- (REVOKE PUBLIC/anon, keep authenticated) because it. IS called directly —
-- by this project's own verification/export scripts today, with a real
-- signed-in director's JWT — so `authenticated` must stay granted.
--
-- Re-verified after this migration: has_function_privilege('anon', ...)
-- false for every function touched here; nf_post_voucher and nf_save_line
-- still work end to end for a real authenticated session.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the actual exploitable gap: give nf__upsert_transfer_voucher the
--       role check every other write RPC in this schema already has ──────
CREATE OR REPLACE FUNCTION public.nf__upsert_transfer_voucher(
  p_company_id uuid, p_day_id uuid, p_voucher_date date, p_voucher_no text,
  p_to_code text, p_from_code text, p_floor_code text, p_amount numeric
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_existing public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);

  SELECT * INTO v_existing FROM public.nf_vouchers
   WHERE company_id = p_company_id AND voucher_key = upper(btrim(p_voucher_no));

  IF p_amount IS NULL OR p_amount = 0 THEN
    IF FOUND THEN
      DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_existing.id;
      DELETE FROM public.nf_vouchers WHERE id = v_existing.id;
    END IF;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE public.nf_voucher_legs SET debit = p_amount, credit = 0
     WHERE voucher_id = v_existing.id AND account_code = p_to_code;
    UPDATE public.nf_voucher_legs SET debit = 0, credit = p_amount
     WHERE voucher_id = v_existing.id AND account_code = p_from_code;
  ELSE
    PERFORM public.nf_post_voucher(p_company_id, p_day_id, p_voucher_no, p_voucher_date, 'Transfer', 0,
      jsonb_build_array(
        jsonb_build_object('account_code', p_to_code,   'floor_code', p_floor_code, 'debit',  p_amount),
        jsonb_build_object('account_code', p_from_code, 'floor_code', p_floor_code, 'credit', p_amount)));
  END IF;
END
$function$;

-- ── 2. lock every function this batch actually touched down to what it
--       needs — nothing beyond what's really called, same discipline
--       20260916c's sweep used ─────────────────────────────────────────
DO $grants$
DECLARE f regprocedure;
BEGIN
  -- exact identity strings taken from a live
  -- pg_get_function_identity_arguments() query against this project, not
  -- guessed — nf_ledger_position in particular needs its OUT parameters
  -- listed or the cast below resolves nothing.
  FOREACH f IN ARRAY ARRAY[
    'public.nf__upsert_transfer_voucher(p_company_id uuid, p_day_id uuid, p_voucher_date date, p_voucher_no text, p_to_code text, p_from_code text, p_floor_code text, p_amount numeric)',
    'public.nf_account_path(p_company_id uuid, p_code text)',
    'public.nf_add_party_alias(p_company_id uuid, p_party_id uuid, p_alias text)',
    'public.nf_create_party(p_company_id uuid, p_name text, p_kind text)',
    'public.nf_ledger_position(p_company_id uuid, p_before_date date, OUT cash numeric, OUT petty numeric, OUT bank numeric)',
    'public.nf_list_parties(p_company_id uuid)',
    'public.nf_other_balances(p_company_id uuid, p_as_of date)',
    'public.nf_resolve_party(p_company_id uuid, p_text text)',
    'public.nf_voucher_balance_check()',
    'public.nf_voucher_legs_guard()',
    'public.nf_voucher_legs_position_guard()'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;

  -- called directly with a real authenticated session today (this
  -- project's own verify/export scripts; a future "post a JV" UI) —
  -- keep authenticated, still shed PUBLIC and anon.
  FOREACH f IN ARRAY ARRAY[
    'public.nf_post_voucher(p_company_id uuid, p_day_id uuid, p_voucher_no text, p_voucher_date date, p_narration text, p_sort integer, p_legs jsonb)',
    'public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer, p_party_name text)'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$grants$;

COMMIT;
