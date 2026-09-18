-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · b · guards, ledger, COA path
--
-- Concurrency strategy (the two options the owner asked to be weighed):
--   Deferred constraint trigger ALONE is not enough: posting a brand-new
--   2-leg voucher inserts a HEADER (nf_vouchers) row that no leg-table
--   trigger ever sees, so a deferred trigger on nf_voucher_legs can enforce
--   "this voucher's legs balance" but not "every POSTED voucher HAS
--   balancing legs at all" unless every insert path is trusted to always
--   insert legs — a trust the platform's own rule (Postgres is the
--   application server, not an ORM) says not to lean on.
--   Atomic RPC alone is not enough either: nf_save_line/nf_delete_line let
--   a single RPC call touch one leg of an existing voucher without
--   re-touching its sibling leg in the same statement (e.g. edit only the
--   amount on the credit leg) — an upfront in-RPC balance check on the
--   legs it just wrote would miss the sibling leg it did not.
--   So both apply, at different moments:
--     · nf_post_voucher (20260918c) validates leg count/completeness/balance
--       BEFORE the insert, and takes the day row FOR UPDATE first — this is
--       what makes the initial post-time check race-safe (proven in
--       verify-nf-de-race.js the same way RACE-R1/OK/R2 already prove the
--       single-entry version safe).
--     · nf_voucher_legs_balance_guard (below) is a DEFERRED CONSTRAINT
--       TRIGGER that re-checks balance for any POSTED voucher whose legs
--       were touched, at the end of the ENCLOSING transaction — which for
--       this platform is "the end of one RPC call" (PostgREST wraps each
--       call in its own transaction), so it catches a later multi-statement
--       edit inside one RPC without needing that RPC to re-derive the
--       full balance check by hand.
--   Belt and suspenders, not redundancy: each covers a path the other does
--   not.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── party requiredness + leg guard (mirrors nf_lines_guard) ────────────────
CREATE OR REPLACE FUNCTION public.nf_voucher_legs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_voucher public.nf_vouchers;
  v_status  text;
  v_role    text;
  v_acc     public.nf_accounts;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' AND (NEW.company_id <> OLD.company_id OR NEW.voucher_id <> OLD.voucher_id
                           OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
  END IF;

  v_role := public.nf_role(v_company);
  IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;

  SELECT * INTO v_voucher FROM public.nf_vouchers WHERE id = COALESCE(NEW.voucher_id, OLD.voucher_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;

  -- Same lock nf_lines_guard took on the day row: one writer to a given
  -- day's postings at a time, so R1/the balance check sees a consistent
  -- picture. Journals with no day_id (future, out of this pass's scope)
  -- skip this — there is no shared "day" to serialize against.
  IF v_voucher.day_id IS NOT NULL THEN
    SELECT d.status INTO v_status FROM public.nf_days d
     WHERE d.id = v_voucher.day_id AND d.company_id = v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
    IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED' USING DETAIL = v_status; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT * INTO v_acc FROM public.nf_accounts a WHERE a.company_id = v_company AND a.code = NEW.account_code;
  IF NOT FOUND OR NOT v_acc.is_head OR NOT v_acc.active THEN
    RAISE EXCEPTION 'NF:HEAD_NOT_POSTABLE' USING DETAIL = NEW.account_code;
  END IF;
  IF v_acc.requires_party AND NEW.party_id IS NULL THEN
    RAISE EXCEPTION 'NF:PARTY_REQUIRED' USING DETAIL = NEW.account_code;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS nf_voucher_legs_guard ON public.nf_voucher_legs;
CREATE TRIGGER nf_voucher_legs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nf_voucher_legs
  FOR EACH ROW EXECUTE FUNCTION public.nf_voucher_legs_guard();

-- Negative-position check, same as nf_lines_position_guard, now keyed off
-- the voucher's day_id (only meaningful for day-linked vouchers).
CREATE OR REPLACE FUNCTION public.nf_voucher_legs_position_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_day     uuid;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN NULL; END IF;
  SELECT day_id INTO v_day FROM public.nf_vouchers WHERE id = COALESCE(NEW.voucher_id, OLD.voucher_id);
  IF v_day IS NOT NULL THEN
    PERFORM public.nf_assert_not_negative(v_day);
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS nf_voucher_legs_position_guard ON public.nf_voucher_legs;
CREATE TRIGGER nf_voucher_legs_position_guard AFTER INSERT OR UPDATE OR DELETE ON public.nf_voucher_legs
  FOR EACH ROW EXECUTE FUNCTION public.nf_voucher_legs_position_guard();

-- ── the deferred balance backstop ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_voucher_balance_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voucher_id uuid := COALESCE(NEW.voucher_id, OLD.voucher_id);
  v_status     text;
  v_diff       numeric;
  v_legs       integer;
BEGIN
  SELECT status INTO v_status FROM public.nf_vouchers WHERE id = v_voucher_id;
  IF v_status IS DISTINCT FROM 'POSTED' THEN RETURN NULL; END IF;

  SELECT sum(debit) - sum(credit), count(*) INTO v_diff, v_legs
    FROM public.nf_voucher_legs WHERE voucher_id = v_voucher_id;

  IF v_legs < 2 THEN
    RAISE EXCEPTION 'NF:VOUCHER_NEEDS_TWO_LEGS' USING DETAIL = v_voucher_id::text;
  END IF;
  IF v_diff IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'NF:VOUCHER_UNBALANCED' USING DETAIL = json_build_object('voucher_id', v_voucher_id, 'diff', v_diff)::text;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS nf_voucher_balance_check ON public.nf_voucher_legs;
CREATE CONSTRAINT TRIGGER nf_voucher_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON public.nf_voucher_legs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.nf_voucher_balance_check();

-- ── audit: extend the existing generic row-audit trigger to the new tables ─
CREATE OR REPLACE FUNCTION public.nf_audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row     jsonb := COALESCE(v_new, v_old);
  v_company uuid  := (v_row->>'company_id')::uuid;
  v_action  text  := TG_OP;
  v_reason  text;
  v_day     uuid;
  v_id      text;
BEGIN
  IF public.nf_purging(v_company) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (v_old - 'version' - 'updated_at' - 'updated_by')
                        = (v_new - 'version' - 'updated_at' - 'updated_by') THEN
    RETURN NULL;
  END IF;

  v_id := CASE TG_TABLE_NAME
            WHEN 'nf_members'           THEN v_row->>'user_id'
            WHEN 'nf_settings'          THEN v_row->>'company_id'
            WHEN 'nf_accounts'          THEN v_row->>'code'
            WHEN 'nf_floors'            THEN v_row->>'code'
            WHEN 'nf_report_categories' THEN (v_row->>'side') || ':' || (v_row->>'priority')
            ELSE v_row->>'id' END;

  IF TG_TABLE_NAME = 'nf_days' THEN
    v_day := (v_row->>'id')::uuid;
    IF TG_OP = 'UPDATE' AND v_old->>'status' <> v_new->>'status' THEN
      IF v_new->>'status' = 'SUBMITTED' THEN
        v_action := 'SUBMIT';
      ELSIF v_new->>'status' = 'CLOSED' THEN
        IF (v_new->>'variance')::numeric <> 0 THEN
          v_action := 'CLOSE_WITH_VARIANCE'; v_reason := v_new->>'variance_reason';
        ELSE
          v_action := 'CLOSE';
        END IF;
      ELSIF v_old->>'status' = 'SUBMITTED' THEN
        v_action := 'RETURN'; v_reason := v_new->>'last_return_reason';
      ELSE
        v_action := 'REOPEN'; v_reason := v_new->>'last_reopen_reason';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'nf_lines' THEN
    v_day := (v_row->>'day_id')::uuid;
  ELSIF TG_TABLE_NAME = 'nf_pdcs' THEN
    v_day := COALESCE((v_new->>'resolved_day_id')::uuid, (v_row->>'entered_day_id')::uuid);
  ELSIF TG_TABLE_NAME = 'nf_vouchers' THEN
    v_day := (v_row->>'day_id')::uuid;
    IF TG_OP = 'UPDATE' AND v_old->>'status' <> v_new->>'status' THEN
      v_action := 'POST_VOUCHER';
    END IF;
  ELSIF TG_TABLE_NAME = 'nf_voucher_legs' THEN
    SELECT day_id INTO v_day FROM public.nf_vouchers WHERE id = (v_row->>'voucher_id')::uuid;
  END IF;

  INSERT INTO public.nf_audit (company_id, day_id, entity, entity_id, action, actor, actor_name, before, after, reason)
  VALUES (v_company, v_day, TG_TABLE_NAME, v_id, v_action, auth.uid(), public.nf_actor_name(v_company),
          v_old, v_new, v_reason);
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS nf_audit_row ON public.nf_vouchers;
CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row();
DROP TRIGGER IF EXISTS nf_audit_row ON public.nf_voucher_legs;
CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_voucher_legs
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row();
DROP TRIGGER IF EXISTS nf_audit_row ON public.nf_parties;
CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_parties
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row();

-- ── opening balance, derived from the ledger, not chained from a stored
--    close figure ─────────────────────────────────────────────────────────
-- nf_ledger_position(company, before_date) = the fixed genesis (typed on
-- the first day, once, and never touched again — see the §D note in
-- 20260918a about why this is a constant input, not the same bug as
-- reading yesterday's stored close) PLUS every POSTED voucher leg on a
-- via-account dated strictly before `before_date`. Reopening any earlier
-- day and changing its legs changes this sum the next time it is computed,
-- for every later date, with nothing cached anywhere in between.
CREATE OR REPLACE FUNCTION public.nf_ledger_position(p_company_id uuid, p_before_date date,
  OUT cash numeric, OUT petty numeric, OUT bank numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE g public.nf_days;
BEGIN
  SELECT * INTO g FROM public.nf_days WHERE company_id = p_company_id AND is_first_day;
  IF NOT FOUND THEN
    cash := 0; petty := 0; bank := 0; RETURN;
  END IF;

  SELECT g.typed_open_cash  + COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Cash'),  0),
         g.typed_open_petty + COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Petty'), 0),
         g.typed_open_bank  + COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Bank'),  0)
    INTO cash, petty, bank
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
    JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
   WHERE l.company_id = p_company_id AND v.status = 'POSTED' AND a.via IS NOT NULL
     AND v.voucher_date >= g.business_date AND v.voucher_date < p_before_date;
END
$function$;

-- nf_position_row: only the opening branch changes. Everything else
-- (in/out/transfers/closing) already recomputes fresh from nf_lines on
-- every call and is untouched.
CREATE OR REPLACE FUNCTION public.nf_position_row(p_day_id uuid, OUT open_cash numeric, OUT open_petty numeric, OUT open_bank numeric, OUT in_cash numeric, OUT in_petty numeric, OUT in_bank numeric, OUT out_cash numeric, OUT out_petty numeric, OUT out_bank numeric, OUT trf_cash numeric, OUT trf_petty numeric, OUT trf_bank numeric, OUT close_cash numeric, OUT close_petty numeric, OUT close_bank numeric, OUT n_in integer, OUT n_out integer)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_days;
  lp record;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;

  IF d.is_first_day THEN
    open_cash := d.typed_open_cash; open_petty := d.typed_open_petty; open_bank := d.typed_open_bank;
  ELSE
    SELECT * INTO lp FROM public.nf_ledger_position(d.company_id, d.business_date);
    open_cash := lp.cash; open_petty := lp.petty; open_bank := lp.bank;
  END IF;

  SELECT COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'Cash'),  0),
         COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'Petty'), 0),
         COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'Bank'),  0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'Cash'),  0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'Petty'), 0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'Bank'),  0),
         count(*) FILTER (WHERE side = 'IN'),
         count(*) FILTER (WHERE side = 'OUT')
    INTO in_cash, in_petty, in_bank, out_cash, out_petty, out_bank, n_in, n_out
    FROM public.nf_lines WHERE day_id = p_day_id;

  -- transfers are no longer nf_days.transfer_to_bank/petty columns (owner
  -- decision, 2026-09-18: "a transfer is just an ordinary voucher, not a
  -- special case") — they are ordinary vouchers whose every leg is a
  -- via-account (a pure Cash<->Bank/Cash<->Petty movement, in either
  -- direction), summed here the same way in/out sums any other posting,
  -- just excluded from in/out itself so nothing double-counts (see the
  -- nf_lines view's own exclusion of the same vouchers, 20260918d).
  SELECT COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Cash'),  0),
         COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Petty'), 0),
         COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Bank'),  0)
    INTO trf_cash, trf_petty, trf_bank
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
    JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
   WHERE v.day_id = p_day_id AND v.status = 'POSTED' AND a.via IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.nf_voucher_legs l2
       JOIN public.nf_accounts a2 ON a2.company_id = l2.company_id AND a2.code = l2.account_code
       WHERE l2.voucher_id = l.voucher_id AND a2.via IS NULL);

  close_cash  := open_cash  + in_cash  - out_cash  + trf_cash;
  close_petty := open_petty + in_petty - out_petty + trf_petty;
  close_bank  := open_bank  + in_bank  - out_bank  + trf_bank;
END
$function$;

-- ── COA colon-path: a STABLE function, not a generated column ──────────────
-- A native GENERATED column cannot do a recursive parent lookup — it can
-- only read other columns on its OWN row. The alternative to a function
-- would be a maintained/cached path column kept correct by an AFTER trigger
-- on nf_accounts (paying at write time instead of at read time). That is
-- the wrong trade here: the path is needed only for the IIF export and any
-- future reports (both out of scope this pass), the hierarchy is shallow
-- (COA depth tops out around 4) and changes rarely (an account's parent
-- moves on the order of "once a year", not "every voucher"), so computing
-- it on demand costs nothing that matters and carries no cache to keep in
-- sync. If a report ever calls this per-row over thousands of rows and it
-- shows up in profiling, memoizing it then is a small, contained change.
CREATE OR REPLACE FUNCTION public.nf_account_path(p_company_id uuid, p_code text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE up AS (
    SELECT code, name, parent_code, 0 AS depth FROM public.nf_accounts
     WHERE company_id = p_company_id AND code = p_code
    UNION ALL
    SELECT a.code, a.name, a.parent_code, up.depth + 1
      FROM public.nf_accounts a JOIN up ON a.code = up.parent_code
     WHERE a.company_id = p_company_id AND up.depth < 20
  )
  SELECT string_agg(name, ':' ORDER BY depth DESC) FROM up;
$function$;

COMMIT;
