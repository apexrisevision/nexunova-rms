-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance — Fix pass 4: the residuals the re-audit found.
-- docs/AUDIT_REPORT.md "Re-audit sign-off — 2026-09-20": R-2, R-3, R-1.
-- (R-4 is a browser-side fix in js/nf/nf-sheet.js, not here.)
--
-- No function below changes its argument list, so there are no stale
-- overloads to drop. One new trigger function, nf_voucher_day_immutable(),
-- takes no arguments, cannot be reached over PostgREST, and is REVOKEd from
-- PUBLIC/anon/authenticated anyway — a fresh CREATE FUNCTION is
-- PUBLIC-executable by default.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- R-2 (HIGH) — nf_post_voucher was a public primitive
-- ═════════════════════════════════════════════════════════════════════════
-- The re-audit's finding: nf_post_voucher held EXECUTE for `authenticated`
-- while enforcing only "≥2 legs, balanced, amounts sane, day OPEN". It does
-- NOT enforce the shape nf_lines requires (exactly two legs, line 1 a
-- non-via head, line 2 the via account) and did not tie p_voucher_date to
-- the day it attaches to. So a logged-in accountant calling it directly —
-- not through any screen — could create a day voucher whose cash movement
-- lands in the next day's OPENING (nf_ledger_position counts every via leg,
-- by date) but in NO day's CLOSING (nf_lines needs the narrow shape; the
-- transfer branch needs every leg to be via). That is CRITICAL-2 restored
-- through a different door.
--
-- Proof the view really is that narrow, from the re-audit: ZZTEST-NF-DEMO
-- has 9 day vouchers but only 8 rows in nf_lines — the missing one is the
-- transfer, excluded by `ha.via IS NULL` on line 1 and recovered only
-- because ALL of its legs are via accounts.
--
-- FIX 1 — take the primitive away. nf_post_voucher is internal: its only
-- callers are nf_save_line, nf_jv_save and nf__upsert_transfer_voucher (via
-- nf_set_transfers). Verified against the live catalog before revoking:
-- all three are SECURITY DEFINER, so they execute as the function OWNER
-- (postgres), and the owner's EXECUTE is what is checked for the nested
-- call — revoking `authenticated` cannot break them. No JS file references
-- nf_post_voucher either (js/nf/nf-api.js never exposed it).
REVOKE ALL ON FUNCTION public.nf_post_voucher(uuid, uuid, text, date, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- FIX 2 — the belt, which holds regardless of who is allowed to call it,
-- and therefore also covers service_role (migrations, import scripts).
-- A day-attached voucher must carry that day's own date. Without this, a
-- voucher attached to today's day but dated before the company's first day
-- is counted in that day's CLOSING (day-scoped) and excluded from every
-- OPENING (nf_ledger_position filters voucher_date >= first_day) — the same
-- divergence along a different axis.
-- Unchanged argument list: CREATE OR REPLACE genuinely replaces here.
CREATE OR REPLACE FUNCTION public.nf_post_voucher(p_company_id uuid, p_day_id uuid, p_voucher_no text,
                                                  p_voucher_date date, p_narration text, p_sort integer,
                                                  p_legs jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role   text := public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  v_status text;
  v_bdate  date;
  v_id     uuid;
  v_leg    jsonb;
  v_n      integer := 0;
  v_debit  numeric := 0;
  v_credit numeric := 0;
  v_used   date;
BEGIN
  IF p_voucher_no IS NULL OR btrim(p_voucher_no) = '' THEN RAISE EXCEPTION 'NF:VOUCHER_REQUIRED'; END IF;
  IF p_voucher_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) < 2 THEN
    RAISE EXCEPTION 'NF:VOUCHER_NEEDS_TWO_LEGS';
  END IF;

  IF p_day_id IS NOT NULL THEN
    SELECT status, business_date INTO v_status, v_bdate
      FROM public.nf_days WHERE id = p_day_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
    -- R-2's belt. A day's closing is day-scoped and its opening is
    -- date-scoped; they can only agree if a day's vouchers carry that day's
    -- date. nf_save_line already passes the day's own business_date, so this
    -- rejects nothing the application does.
    IF p_voucher_date <> v_bdate THEN
      RAISE EXCEPTION 'NF:DATE_DAY_MISMATCH'
        USING DETAIL = json_build_object('voucher_date', p_voucher_date, 'day_date', v_bdate)::text,
              HINT   = 'A voucher on a daily closing must carry that day''s date.';
    END IF;
  END IF;

  -- validate every leg and the balance BEFORE writing anything — the
  -- atomic half of the enforcement strategy described in 20260918b.
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    IF NULLIF(btrim(v_leg->>'account_code'), '') IS NULL THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED'; END IF;
    IF NULLIF(btrim(v_leg->>'floor_code'), '') IS NULL THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
    PERFORM public.nf_check_amount(COALESCE((v_leg->>'debit')::numeric, 0), 'debit', false);
    PERFORM public.nf_check_amount(COALESCE((v_leg->>'credit')::numeric, 0), 'credit', false);
    IF NOT ((COALESCE((v_leg->>'debit')::numeric,0) > 0) <> (COALESCE((v_leg->>'credit')::numeric,0) > 0)) THEN
      RAISE EXCEPTION 'NF:LEG_ONE_SIDE_ONLY';
    END IF;
    v_debit  := v_debit  + COALESCE((v_leg->>'debit')::numeric, 0);
    v_credit := v_credit + COALESCE((v_leg->>'credit')::numeric, 0);
    v_n := v_n + 1;
  END LOOP;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'NF:VOUCHER_UNBALANCED' USING DETAIL = json_build_object('debit', v_debit, 'credit', v_credit)::text;
  END IF;

  BEGIN
    INSERT INTO public.nf_vouchers (company_id, day_id, voucher_no, voucher_date, narration, status, sort,
                                    created_by, posted_by, posted_at, source)
    VALUES (p_company_id, p_day_id, upper(btrim(p_voucher_no)), p_voucher_date, NULLIF(btrim(p_narration), ''),
            'POSTED', COALESCE(p_sort, 0), auth.uid(), auth.uid(), now(),
            CASE WHEN p_day_id IS NOT NULL THEN 'DAY' ELSE 'JV' END)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT v.voucher_date INTO v_used FROM public.nf_vouchers v
     WHERE v.company_id = p_company_id AND v.voucher_key = upper(btrim(p_voucher_no));
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
      USING DETAIL = json_build_object('voucher', upper(btrim(p_voucher_no)), 'used_on', v_used)::text;
  END;

  v_n := 0;
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    v_n := v_n + 1;
    INSERT INTO public.nf_voucher_legs (company_id, voucher_id, line_no, account_code, party_id, floor_code,
                                        debit, credit, memo, created_by)
    VALUES (p_company_id, v_id, v_n, btrim(v_leg->>'account_code'),
            NULLIF(v_leg->>'party_id', '')::uuid, btrim(v_leg->>'floor_code'),
            COALESCE((v_leg->>'debit')::numeric, 0), COALESCE((v_leg->>'credit')::numeric, 0),
            NULLIF(btrim(v_leg->>'memo'), ''), auth.uid());
  END LOOP;

  RETURN v_id;
END
$$;
-- CREATE OR REPLACE resets nothing about grants, but state the intent
-- explicitly so a future reader sees the ACL that is meant to be here.
REVOKE ALL ON FUNCTION public.nf_post_voucher(uuid, uuid, text, date, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- R-3 (LOW) — existence oracle in nf_jv_delete
-- ═════════════════════════════════════════════════════════════════════════
-- NF:VOUCHER_NOT_FOUND was raised before nf_require_role, so any
-- authenticated user could tell "this voucher id exists" from "it does not"
-- for ANY company. Fixed by scoping the lookup itself to companies the
-- caller belongs to: a voucher that exists elsewhere is now indistinguishable
-- from one that does not exist at all, because the same branch handles both.
-- The role gate still runs afterwards, so a VIEWER who really is a member
-- keeps the accurate NF:NOT_ALLOWED rather than a misleading "not found".
CREATE OR REPLACE FUNCTION public.nf_jv_delete(p_voucher_id uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_voucher public.nf_vouchers;
  v_exported_at timestamptz;
  v_latest_closed date;
BEGIN
  SELECT * INTO v_voucher FROM public.nf_vouchers v
   WHERE v.id = p_voucher_id
     AND EXISTS (SELECT 1 FROM public.nf_members m
                  WHERE m.company_id = v.company_id AND m.user_id = auth.uid() AND m.active)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(v_voucher.company_id, ARRAY['accountant','director']);
  -- a daily-closing line is not this function's business; it has its own path
  -- with its own day-locked guard
  IF v_voucher.day_id IS NOT NULL THEN RAISE EXCEPTION 'NF:NOT_A_JOURNAL_VOUCHER'; END IF;

  -- A database-level fact, not a UI omission (docs/AUDIT_REPORT.md
  -- CRITICAL-3): an imported historical voucher is never deletable through
  -- this path, whether or not nf_jv_list would have offered it.
  IF v_voucher.source <> 'JV' THEN
    RAISE EXCEPTION 'NF:IMPORTED_LOCKED' USING DETAIL = v_voucher.voucher_no;
  END IF;

  SELECT b.exported_at INTO v_exported_at FROM public.nf_iif_batch_vouchers b
   WHERE b.voucher_id = v_voucher.id ORDER BY b.exported_at DESC LIMIT 1;
  IF v_exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF:VOUCHER_ALREADY_EXPORTED'
      USING DETAIL = json_build_object('voucher', v_voucher.voucher_no, 'exported_at', v_exported_at)::text;
  END IF;

  SELECT max(business_date) INTO v_latest_closed
    FROM public.nf_days WHERE company_id = v_voucher.company_id AND status = 'CLOSED';
  IF v_latest_closed IS NOT NULL AND v_voucher.voucher_date <= v_latest_closed THEN
    RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', v_voucher.voucher_date, 'latest_closed', v_latest_closed)::text;
  END IF;

  PERFORM public.nf_check_version(p_version, v_voucher.version);

  DELETE FROM public.nf_voucher_legs WHERE voucher_id = v_voucher.id;
  DELETE FROM public.nf_vouchers WHERE id = v_voucher.id;
  RETURN jsonb_build_object('deleted', v_voucher.voucher_no);
END
$$;
REVOKE ALL ON FUNCTION public.nf_jv_delete(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_jv_delete(uuid, integer) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- R-1 (service_role) — a day voucher could be re-parented to day-less
-- ═════════════════════════════════════════════════════════════════════════
-- NF:CASH_VIA_DAY_ONLY lives in the LEG guard, so it only sees leg writes.
-- `UPDATE nf_vouchers SET day_id = NULL` moved a voucher and all its via
-- legs off the day path without touching a leg row, producing exactly the
-- state that guard exists to prevent. nf_vouchers carried nothing that fires
-- on day_id (only nf_audit_row, and nf_voucher_has_legs_check on
-- INSERT OR UPDATE OF status).
--
-- Forbidden outright rather than re-checked: nothing in the system changes a
-- voucher's day. Verified against the live catalog — the only function that
-- writes nf_vouchers at all is nf_save_line, and it sets voucher_no,
-- narration and version, never day_id. A voucher's day is decided once, by
-- nf_post_voucher's INSERT.
CREATE OR REPLACE FUNCTION public.nf_voucher_day_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.nf_purging(COALESCE(NEW.company_id, OLD.company_id)) THEN RETURN NEW; END IF;
  -- BEFORE UPDATE OF day_id fires whenever day_id is named in the SET list,
  -- even when the value is unchanged, so compare rather than assume.
  IF NEW.day_id IS DISTINCT FROM OLD.day_id THEN
    RAISE EXCEPTION 'NF:VOUCHER_DAY_IMMUTABLE'
      USING DETAIL = json_build_object('voucher', OLD.voucher_no,
                                       'from', OLD.day_id, 'to', NEW.day_id)::text,
            HINT   = 'A voucher belongs to the day it was posted on. Delete and re-enter it instead.';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.nf_voucher_day_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nf_voucher_day_immutable ON public.nf_vouchers;
CREATE TRIGGER nf_voucher_day_immutable
  BEFORE UPDATE OF day_id ON public.nf_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.nf_voucher_day_immutable();

-- ═════════════════════════════════════════════════════════════════════════
-- Proof, inside the same transaction
-- ═════════════════════════════════════════════════════════════════════════
DO $post$
DECLARE
  v_acl   text;
  v_bad   integer;
  v_trig  integer;
BEGIN
  -- R-2: authenticated must hold nothing on nf_post_voucher
  SELECT coalesce(array_to_string(proacl::text[], ' | '), '(DEFAULT PUBLIC)') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'nf_post_voucher';
  IF v_acl ~ 'authenticated|anon|(^|[|] )=X' THEN
    RAISE EXCEPTION 'nf_post_voucher still grants EXECUTE too widely: %', v_acl;
  END IF;

  -- and the three legitimate callers must still be SECURITY DEFINER, or the
  -- revoke above would have broken every posting path
  SELECT count(*) INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('nf_save_line','nf_jv_save','nf__upsert_transfer_voucher')
     AND NOT p.prosecdef;
  IF v_bad <> 0 THEN RAISE EXCEPTION '% caller(s) of nf_post_voucher are not SECURITY DEFINER', v_bad; END IF;

  -- R-1: the trigger exists on day_id
  SELECT count(*) INTO v_trig FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'nf_vouchers' AND t.tgname = 'nf_voucher_day_immutable';
  IF v_trig <> 1 THEN RAISE EXCEPTION 'nf_voucher_day_immutable trigger missing'; END IF;

  -- and no existing day voucher already breaks the new date rule
  SELECT count(*) INTO v_bad FROM public.nf_vouchers v JOIN public.nf_days d ON d.id = v.day_id
   WHERE v.voucher_date <> d.business_date;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'NF:MIGRATION_ABORTED_DATE_DAY_MISMATCH'
      USING DETAIL = v_bad || ' existing day voucher(s) are dated off their day';
  END IF;

  RAISE NOTICE 'post ok: nf_post_voucher acl=%, callers all SECURITY DEFINER, day_id trigger present, 0 date/day mismatches', v_acl;
END
$post$;

COMMIT;
