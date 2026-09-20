-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19p · Harden journal
-- vouchers: protect imported history, gate the period, version-lock delete
--
-- NOT YET APPLIED — awaiting explicit go-ahead. Alters three existing write
-- paths and adds a column; the highest-stakes kind of change.
--
-- Fixes docs/AUDIT_REPORT.md CRITICAL-3, found in a read-only forensic audit
-- (2026-09-20): nf_jv_list selects WHERE day_id IS NULL AND status='POSTED'.
-- That predicate was written to mean "journal vouchers", but ALL 64 of
-- Awami's QuickBooks-imported historical vouchers are ALSO day_id IS NULL —
-- they were never attached to a daily closing. Calling the real RPC as the
-- real director returns all 64, every one marked NOT exported (the export
-- lock only fires from a nf_iif_batch_vouchers row, and nothing has ever
-- been exported), each with a Delete button on the live screen. The flag
-- that was supposed to protect them — iif_exportable=false, set by
-- 20260919h for exactly this reason — is never consulted on this path.
-- Verified by live query before writing this, not assumed: nf_jv_list
-- returned vouchers.length=64, all exported:false.
--
-- Alongside it: nf_post_voucher validates only that a date is NOT NULL — no
-- range, no period, no future bound — and nf_jv_delete took no p_version, so
-- it had no optimistic lock at all.
--
-- THE FIX, four parts:
--
--   1. nf_vouchers.source ('JV' | 'IMPORT' | 'DAY'), NOT NULL, derived, never
--      passed by a caller. nf_post_voucher sets it itself: p_day_id IS NOT
--      NULL -> 'DAY', else the column default 'JV'. This is deliberately NOT
--      a parameter — a derived fact can't be forgotten or spoofed by a
--      caller the way a flag can. The one case that needs to be something
--      OTHER than what nf_post_voucher would derive — historical import,
--      which is day-less like a JV but must never be treated as one — is
--      handled the same way 20260919h already handles iif_exportable: a
--      follow-up UPDATE from the import script immediately after posting
--      (see scripts/nf/import-awami-history.js, changed alongside this).
--      Backfill here targets exactly the 64 rows already marked
--      iif_exportable=false; the migration COUNTS them first and ABORTS if
--      the count is not exactly 64, so it cannot silently mistag a future
--      company's history under a different shape.
--
--   2. nf_jv_list: adds "AND v.source = 'JV'". The 64 stay completely
--      readable — in the General Journal, the Ledger, every statement, all
--      of which read the ledger directly — just never through this screen,
--      which is the only one with a Delete button.
--
--   3. nf_jv_delete: rejects source <> 'JV' (NF:IMPORTED_LOCKED) as a
--      database-level fact, not a UI omission — even a hand-built REST call
--      hits this. Adds p_version (NF:VERSION_CONFLICT, the same optimistic
--      lock every other write path already carries) and a period gate
--      (NF:PERIOD_CLOSED): a journal voucher dated on or before the
--      company's latest CLOSED day cannot be deleted, closed or not,
--      exported or not.
--
--   4. nf_jv_save: the same period gate on the way IN (NF:PERIOD_CLOSED),
--      plus a future-date gate (NF:DATE_FUTURE — nf_post_voucher never
--      bounded this either). Placed in nf_jv_save, deliberately NOT in
--      nf_post_voucher: the service-role import path calls nf_post_voucher
--      directly with real historical dates that are always "in the past"
--      relative to today by definition, and must stay untouched.
--
-- "Latest CLOSED day" is read directly (max(business_date) WHERE
-- status='CLOSED') rather than through a helper, because none exists yet —
-- nf_days_one_unclosed already guarantees at most one non-CLOSED day per
-- company, so this is exactly "the boundary of what's already locked": every
-- date at or before it belongs to a closed period; the single OPEN/SUBMITTED
-- day, if any, is always strictly after it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the source column ─────────────────────────────────────────────────
ALTER TABLE public.nf_vouchers
  ADD COLUMN source text NOT NULL DEFAULT 'JV' CHECK (source IN ('JV','IMPORT','DAY'));

-- existing day-attached vouchers (the daily-closing path) are 'DAY', not 'JV'
UPDATE public.nf_vouchers SET source = 'DAY' WHERE day_id IS NOT NULL;

-- existing historical-import vouchers: the SAME 64 rows 20260919h already
-- marked iif_exportable=false, and only those. Refuse to guess if the count
-- has ever drifted from what was true when this was written and verified.
DO $migrate$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.nf_vouchers WHERE day_id IS NULL AND iif_exportable = false;
  IF v_n <> 64 THEN
    RAISE EXCEPTION 'NF:MIGRATION_ABORTED_UNEXPECTED_IMPORT_COUNT'
      USING DETAIL = json_build_object('expected', 64, 'found', v_n)::text,
            HINT   = 'Re-check which rows this backfill is meant to tag as IMPORT before re-running.';
  END IF;
  UPDATE public.nf_vouchers SET source = 'IMPORT' WHERE day_id IS NULL AND iif_exportable = false;
END
$migrate$;

-- ── 2. nf_post_voucher derives source itself — never a caller-supplied flag ──
CREATE OR REPLACE FUNCTION public.nf_post_voucher(p_company_id uuid, p_day_id uuid, p_voucher_no text, p_voucher_date date, p_narration text, p_sort integer, p_legs jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role   text := public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  v_status text;
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
    SELECT status INTO v_status FROM public.nf_days WHERE id = p_day_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
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
$function$;

-- ── 3. nf_jv_save: period + future-date gate, before anything is written ──
CREATE OR REPLACE FUNCTION public.nf_jv_save(
  p_company_id uuid, p_voucher_no text, p_voucher_date date, p_narration text, p_legs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key   text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_id    uuid;
  v_leg   jsonb;
  v_legs  jsonb := '[]'::jsonb;
  v_name  text;
  v_party uuid;
  v_latest_closed date;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  -- A journal voucher must not look like a cash-book voucher. The daily sheet
  -- owns those four prefixes and enforces them in nf_save_line; claiming one
  -- here would put a non-cash entry under a cash voucher number.
  IF v_key ~ '^(CRV|BRV|CPV|BPV)-' THEN
    RAISE EXCEPTION 'NF:VOUCHER_PREFIX_IS_CASHBOOK' USING DETAIL = v_key;
  END IF;

  -- Period gate, checked before any party is resolved/created below — a
  -- rejected voucher must not have a side effect. "Latest CLOSED day" is the
  -- boundary of what is already locked (nf_days_one_unclosed guarantees at
  -- most one non-CLOSED day per company, so this needs no separate "period"
  -- concept of its own).
  IF p_voucher_date IS NOT NULL THEN
    IF p_voucher_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'NF:DATE_FUTURE' USING DETAIL = p_voucher_date::text;
    END IF;
    SELECT max(business_date) INTO v_latest_closed
      FROM public.nf_days WHERE company_id = p_company_id AND status = 'CLOSED';
    IF v_latest_closed IS NOT NULL AND p_voucher_date <= v_latest_closed THEN
      RAISE EXCEPTION 'NF:PERIOD_CLOSED' USING DETAIL = json_build_object('voucher_date', p_voucher_date, 'latest_closed', v_latest_closed)::text;
    END IF;
  END IF;

  -- nf_post_voucher takes a party_id; the screen only knows the NAME the
  -- person picked or typed. Resolve each leg the same way nf_save_line
  -- already does (exact match after normalising, else create) so the
  -- search-first field's "add new" path produces a real party-master record
  -- here too, not a second way of spelling one. A leg that already carries a
  -- party_id is left exactly as it is.
  IF p_legs IS NOT NULL AND jsonb_typeof(p_legs) = 'array' THEN
    FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
      v_name := NULLIF(btrim(v_leg->>'party_name'), '');
      IF v_name IS NOT NULL AND NULLIF(v_leg->>'party_id', '') IS NULL THEN
        v_party := public.nf_resolve_party(p_company_id, v_name);
        IF v_party IS NULL THEN
          v_party := (public.nf_create_party(p_company_id, v_name, 'customer')->>'id')::uuid;
        END IF;
        v_leg := (v_leg - 'party_name') || jsonb_build_object('party_id', v_party::text);
      ELSE
        v_leg := v_leg - 'party_name';
      END IF;
      v_legs := v_legs || jsonb_build_array(v_leg);
    END LOOP;
  ELSE
    v_legs := p_legs;
  END IF;

  -- p_day_id is NULL, always and deliberately: see the header.
  v_id := public.nf_post_voucher(p_company_id, NULL, p_voucher_no, p_voucher_date, p_narration, 0, v_legs);

  RETURN (SELECT jsonb_build_object(
            'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date,
            'narration', v.narration, 'status', v.status, 'version', v.version,
            'legs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'line_no', l.line_no, 'account_code', l.account_code, 'account_name', a.name,
                       'floor_code', l.floor_code, 'party', pt.name, 'party_id', l.party_id,
                       'debit', l.debit, 'credit', l.credit, 'memo', l.memo) ORDER BY l.line_no)
                     FROM public.nf_voucher_legs l
                     JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                     LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
                    WHERE l.voucher_id = v.id), '[]'::jsonb))
            FROM public.nf_vouchers v WHERE v.id = v_id);
END
$function$;

-- ── 4. nf_jv_list: imported history is excluded — visible elsewhere, not here ──
CREATE OR REPLACE FUNCTION public.nf_jv_list(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);

  -- next free JV-#### — the screen suggests it; the unique index is still the
  -- thing that actually decides, so a race just gets NF:DUPLICATE_VOUCHER.
  SELECT COALESCE(max(NULLIF(regexp_replace(voucher_key, '^JV-', ''), '')::integer), 0) + 1
    INTO v_next
    FROM public.nf_vouchers
   WHERE company_id = p_company_id AND voucher_key ~ '^JV-[0-9]+$';

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'next_voucher_no', 'JV-' || lpad(v_next::text, 4, '0'),
    'vouchers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'voucher_no', v.voucher_no, 'voucher_date', v.voucher_date,
               'narration', v.narration, 'version', v.version,
               'exported', EXISTS (SELECT 1 FROM public.nf_iif_batch_vouchers b WHERE b.voucher_id = v.id),
               'total', (SELECT COALESCE(sum(l.debit), 0) FROM public.nf_voucher_legs l WHERE l.voucher_id = v.id),
               'legs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'line_no', l.line_no, 'account_code', l.account_code, 'account_name', a.name,
                          'floor_code', l.floor_code, 'party', pt.name,
                          'debit', l.debit, 'credit', l.credit, 'memo', l.memo) ORDER BY l.line_no)
                        FROM public.nf_voucher_legs l
                        JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
                        LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
                       WHERE l.voucher_id = v.id), '[]'::jsonb))
             ORDER BY v.voucher_date DESC, v.voucher_no DESC)
        FROM public.nf_vouchers v
       WHERE v.company_id = p_company_id AND v.day_id IS NULL AND v.status = 'POSTED'
         AND v.source = 'JV'
         AND (p_from IS NULL OR v.voucher_date >= p_from)
         AND (p_to   IS NULL OR v.voucher_date <= p_to)), '[]'::jsonb));
END
$function$;

-- ── 5. nf_jv_delete: import lock, period gate, optimistic lock ──────────────
-- CREATE OR REPLACE does NOT replace a function whose argument list differs —
-- Postgres treats a different signature as a new overload, which here would
-- leave the OLD one-argument, unguarded nf_jv_delete(uuid) still callable
-- side by side with the new one and defeat this whole migration. Drop it
-- explicitly first.
DROP FUNCTION IF EXISTS public.nf_jv_delete(uuid);

CREATE OR REPLACE FUNCTION public.nf_jv_delete(p_voucher_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voucher public.nf_vouchers;
  v_exported_at timestamptz;
  v_latest_closed date;
BEGIN
  SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = p_voucher_id FOR UPDATE;
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
$function$;

-- A fresh CREATE FUNCTION defaults to PUBLIC-executable (Postgres's own
-- default on CREATE, the same class of hole SEC-RPC-PUBLIC exists to catch —
-- see docs/PLAN.md §18/§31) and the DROP above took the old signature's
-- grants with it. Re-lock the new signature explicitly; do not rely on
-- inheriting anything.
REVOKE ALL ON FUNCTION public.nf_jv_delete(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_jv_delete(uuid, integer) TO authenticated;

COMMIT;
