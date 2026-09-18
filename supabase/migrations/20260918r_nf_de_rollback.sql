-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · r · ROLLBACK for 20260918a–d only
--
-- A tool, never applied as a migration. Undoes specifically what
-- 20260918a-d added — nf_vouchers, nf_voucher_legs, nf_parties,
-- nf_party_aliases, the new guard/ledger/path functions — and restores
-- nf_lines as the real table it was before, with nf_save_line,
-- nf_delete_line, nf_position_row and nf_audit_row back to their exact
-- pre-double-entry bodies (captured verbatim from the live database on
-- 2026-09-18, before any of this pass's changes were written).
--
-- Unlike 20260916r (full nf_ module teardown), this is a single-step-back
-- tool: everything 20260916a–d built (accounts, floors, days, settings,
-- members, pdcs, audit) is untouched.
--
-- ⚠️ Only reversible cleanly if it runs before any voucher/leg row is
-- created that a 2-leg nf_lines row cannot represent (a >2-leg voucher, or
-- one with no via leg) — this pass has no screen that creates one, but a
-- direct nf_post_voucher call could. Rehearsed alongside the forward
-- migration in scripts/nf/verify-nf-de-migration.js.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.nf_lines;

-- Reconstruct nf_lines_legacy's rows from the vouchers/legs, in case this
-- rollback runs after 20260918d has already migrated and dropped it — if
-- nf_lines_legacy still exists (rollback run before the legacy table was
-- ever dropped), this block is skipped and that table is renamed back
-- directly instead, which is the exact, lossless original.
DO $restore$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='nf_lines_legacy') THEN
    ALTER TABLE public.nf_lines_legacy RENAME TO nf_lines;
  ELSE
    CREATE TABLE public.nf_lines (LIKE public.nf_voucher_legs INCLUDING DEFAULTS);  -- placeholder shape, replaced below
    DROP TABLE public.nf_lines;
    CREATE TABLE public.nf_lines (
      id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id     uuid          NOT NULL REFERENCES public.companies(id),
      day_id         uuid          NOT NULL,
      side           text          NOT NULL CHECK (side IN ('IN','OUT')),
      voucher_no     text          NOT NULL,
      voucher_key    text          GENERATED ALWAYS AS (upper(btrim(voucher_no))) STORED,
      description    text,
      head_code      text          NOT NULL,
      floor_code     text          NOT NULL,
      via            text          NOT NULL CHECK (via IN ('Cash','Petty','Bank')),
      amount         numeric(14,2) NOT NULL CHECK (amount > 0),
      sort           integer       NOT NULL,
      version        integer       NOT NULL DEFAULT 0,
      created_by     uuid          NOT NULL,
      created_at     timestamptz   NOT NULL DEFAULT now(),
      updated_by     uuid,
      updated_at     timestamptz,
      CONSTRAINT nf_lines_day_fk FOREIGN KEY (company_id, day_id) REFERENCES public.nf_days (company_id, id),
      CONSTRAINT nf_lines_head_fk FOREIGN KEY (company_id, head_code) REFERENCES public.nf_accounts (company_id, code),
      CONSTRAINT nf_lines_floor_fk FOREIGN KEY (company_id, floor_code) REFERENCES public.nf_floors (company_id, code),
      CONSTRAINT nf_lines_voucher_unique UNIQUE (company_id, voucher_key),
      CONSTRAINT nf_lines_voucher_prefix CHECK (
        ((side = 'IN')  AND upper(btrim(voucher_no)) ~ '^(CRV|BRV)-\S+$') OR
        ((side = 'OUT') AND upper(btrim(voucher_no)) ~ '^(CPV|BPV)-\S+$')),
      CONSTRAINT nf_lines_voucher_matches_via CHECK (
        (left(upper(btrim(voucher_no)), 1) <> ALL (ARRAY['C','B'])) OR
        ((left(upper(btrim(voucher_no)), 1) = 'C') = (via = ANY (ARRAY['Cash','Petty']))))
    );

    INSERT INTO public.nf_lines (id, company_id, day_id, side, voucher_no, description, head_code, floor_code,
                                 via, amount, sort, version, created_by, created_at, updated_by, updated_at)
    SELECT hl.id, v.company_id, v.day_id, CASE WHEN vl.debit > 0 THEN 'IN' ELSE 'OUT' END, v.voucher_no,
           v.narration, hl.account_code, hl.floor_code, va.via, (vl.debit + vl.credit), v.sort, v.version,
           v.created_by, v.created_at, v.updated_by, v.updated_at
      FROM public.nf_voucher_legs hl
      JOIN public.nf_vouchers v ON v.id = hl.voucher_id
      JOIN public.nf_voucher_legs vl ON vl.voucher_id = hl.voucher_id AND vl.line_no = 2
      JOIN public.nf_accounts va ON va.company_id = v.company_id AND va.code = vl.account_code
     WHERE hl.line_no = 1 AND v.status = 'POSTED' AND va.via IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs x WHERE x.voucher_id = hl.voucher_id AND x.line_no NOT IN (1,2));
    -- any >2-leg or no-via voucher created after the double-entry pass went
    -- live has no single-entry equivalent at all and is simply not
    -- representable here — this rollback can only undo the migration
    -- cleanly if none exist yet, exactly as flagged in this file's header.

    ALTER TABLE public.nf_lines ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.nf_lines FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_lines TO authenticated;
    CREATE POLICY nf_lines_read ON public.nf_lines FOR SELECT TO authenticated USING (public.nf_is_member(company_id, false));
    CREATE POLICY nf_lines_write ON public.nf_lines FOR ALL TO authenticated USING (public.nf_is_member(company_id, false)) WITH CHECK (true);

    CREATE TRIGGER nf_lines_guard BEFORE INSERT OR DELETE OR UPDATE ON public.nf_lines
      FOR EACH ROW EXECUTE FUNCTION nf_lines_guard();
    CREATE TRIGGER nf_lines_position_guard AFTER INSERT OR DELETE OR UPDATE ON public.nf_lines
      FOR EACH ROW EXECUTE FUNCTION nf_lines_position_guard();
    CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_lines
      FOR EACH ROW EXECUTE FUNCTION nf_audit_row();
  END IF;
END
$restore$;

-- ── restore transfer_to_bank/transfer_to_petty as columns, folding the
--    XFR-BANK-*/XFR-PETTY-* vouchers 20260918c/d created back into them
--    (owner decision, 2026-09-18, being undone here) ─────────────────────
ALTER TABLE public.nf_days ADD COLUMN IF NOT EXISTS transfer_to_bank numeric(14,2);
ALTER TABLE public.nf_days ADD COLUMN IF NOT EXISTS transfer_to_petty numeric(14,2);

UPDATE public.nf_days d SET transfer_to_bank = leg.debit
  FROM public.nf_vouchers v JOIN public.nf_voucher_legs leg ON leg.voucher_id = v.id AND leg.debit > 0
 WHERE v.voucher_key = 'XFR-BANK-' || d.id::text AND v.day_id = d.id;
UPDATE public.nf_days d SET transfer_to_petty = leg.debit
  FROM public.nf_vouchers v JOIN public.nf_voucher_legs leg ON leg.voucher_id = v.id AND leg.debit > 0
 WHERE v.voucher_key = 'XFR-PETTY-' || d.id::text AND v.day_id = d.id;

DROP TABLE IF EXISTS public.nf_voucher_legs, public.nf_vouchers, public.nf_party_aliases, public.nf_parties CASCADE;

ALTER TABLE public.nf_days ADD CONSTRAINT nf_days_transfer_to_bank_check  CHECK (transfer_to_bank  > 0);
ALTER TABLE public.nf_days ADD CONSTRAINT nf_days_transfer_to_petty_check CHECK (transfer_to_petty > 0);

-- restore nf_days_position_guard's original watched-column list — 20260918d
-- narrowed it to just typed_open_* once transfers moved off nf_days
DROP TRIGGER IF EXISTS nf_days_position_guard ON public.nf_days;
CREATE TRIGGER nf_days_position_guard AFTER INSERT OR UPDATE OF typed_open_cash, typed_open_petty, typed_open_bank,
  transfer_to_bank, transfer_to_petty ON public.nf_days FOR EACH ROW EXECUTE FUNCTION nf_days_position_guard();
ALTER TABLE public.nf_accounts DROP COLUMN IF EXISTS requires_party;

-- restore the single-entry guard 20260918a dropped, exactly — via-accounts
-- must be reset to is_head=false FIRST or re-adding this CHECK fails
-- immediately against the double-entry rows it would now see
UPDATE public.nf_accounts SET is_head = false WHERE via IS NOT NULL;
ALTER TABLE public.nf_accounts ADD CONSTRAINT nf_accounts_head_not_via CHECK (NOT (is_head AND (via IS NOT NULL)));

DO $drop$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('nf_post_voucher','nf_voucher_legs_guard','nf_voucher_legs_position_guard',
                                 'nf_voucher_balance_check','nf_ledger_position','nf_account_path',
                                 'nf_create_party','nf_add_party_alias','nf_resolve_party','nf_list_parties',
                                 'nf__upsert_transfer_voucher') LOOP
    EXECUTE format('DROP FUNCTION %s CASCADE', f);
  END LOOP;
END
$drop$;

-- nf_save_line grew an 11th parameter (p_party_name) in 20260918c — a
-- different signature is a different function as far as CREATE OR REPLACE
-- is concerned, so the new overload must be dropped explicitly before the
-- 10-parameter original below can be recreated under the same name.
DROP FUNCTION IF EXISTS public.nf_save_line(uuid, uuid, text, text, text, text, text, text, numeric, integer, text);

-- ── restore the three rewritten functions to their exact pre-double-entry
--    bodies (captured verbatim from the live database, 2026-09-18) ────────
CREATE OR REPLACE FUNCTION public.nf_position_row(p_day_id uuid, OUT open_cash numeric, OUT open_petty numeric, OUT open_bank numeric, OUT in_cash numeric, OUT in_petty numeric, OUT in_bank numeric, OUT out_cash numeric, OUT out_petty numeric, OUT out_bank numeric, OUT trf_cash numeric, OUT trf_petty numeric, OUT trf_bank numeric, OUT close_cash numeric, OUT close_petty numeric, OUT close_bank numeric, OUT n_in integer, OUT n_out integer)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  d public.nf_days;
  p public.nf_days;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;

  IF d.is_first_day THEN
    open_cash := d.typed_open_cash; open_petty := d.typed_open_petty; open_bank := d.typed_open_bank;
  ELSE
    SELECT * INTO p FROM public.nf_days
     WHERE company_id = d.company_id AND business_date < d.business_date
     ORDER BY business_date DESC LIMIT 1;
    IF NOT FOUND OR p.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'NF:PREVIOUS_DAY_NOT_CLOSED';
    END IF;
    open_cash := p.close_cash; open_petty := p.close_petty; open_bank := p.close_bank;
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

  trf_cash  := -(COALESCE(d.transfer_to_bank, 0) + COALESCE(d.transfer_to_petty, 0));
  trf_petty := COALESCE(d.transfer_to_petty, 0);
  trf_bank  := COALESCE(d.transfer_to_bank, 0);

  close_cash  := open_cash  + in_cash  - out_cash  + trf_cash;
  close_petty := open_petty + in_petty - out_petty + trf_petty;
  close_bank  := open_bank  + in_bank  - out_bank  + trf_bank;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text, p_description text, p_head text, p_floor text, p_via text, p_amount numeric, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  l public.nf_lines;
  v_sort integer;
  c text;
  v_used date;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_voucher_no IS NULL OR btrim(p_voucher_no) = '' THEN RAISE EXCEPTION 'NF:VOUCHER_REQUIRED'; END IF;
  IF p_head  IS NULL OR btrim(p_head)  = '' THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED';  END IF;
  IF p_floor IS NULL OR btrim(p_floor) = '' THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
  IF p_via   IS NULL OR btrim(p_via)   = '' THEN RAISE EXCEPTION 'NF:VIA_REQUIRED';   END IF;
  IF p_via NOT IN ('Cash','Petty','Bank') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = p_via; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  BEGIN
    IF p_line_id IS NULL THEN
      SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_lines WHERE day_id = p_day_id;
      INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, description, head_code, floor_code,
                                   via, amount, sort, created_by)
      VALUES (v_company, p_day_id, p_side, upper(btrim(p_voucher_no)), NULLIF(btrim(p_description), ''),
              btrim(p_head), btrim(p_floor), p_via, p_amount, v_sort, auth.uid());
    ELSE
      SELECT * INTO l FROM public.nf_lines WHERE id = p_line_id AND day_id = p_day_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
      PERFORM public.nf_check_version(p_version, l.version);
      UPDATE public.nf_lines
         SET side = p_side, voucher_no = upper(btrim(p_voucher_no)), description = NULLIF(btrim(p_description), ''),
             head_code = btrim(p_head), floor_code = btrim(p_floor), via = p_via, amount = p_amount
       WHERE id = p_line_id;
    END IF;
  EXCEPTION
    WHEN unique_violation OR check_violation OR foreign_key_violation THEN
      GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
      IF c = 'nf_lines_voucher_unique' THEN
        SELECT d.business_date INTO v_used FROM public.nf_lines x JOIN public.nf_days d ON d.id = x.day_id
         WHERE x.company_id = v_company AND x.voucher_key = upper(btrim(p_voucher_no));
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
          USING DETAIL = json_build_object('voucher', upper(btrim(p_voucher_no)), 'used_on', v_used)::text;
      END IF;
      RAISE EXCEPTION '%', public.nf_translate(c, SQLSTATE, SQLERRM) USING DETAIL = COALESCE(c, SQLERRM);
  END;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_delete_line(p_line_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE l public.nf_lines;
BEGIN
  SELECT * INTO l FROM public.nf_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(l.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_check_version(p_version, l.version);
  DELETE FROM public.nf_lines WHERE id = p_line_id;
  RETURN public.nf_day_json(l.day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
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
  END IF;

  INSERT INTO public.nf_audit (company_id, day_id, entity, entity_id, action, actor, actor_name, before, after, reason)
  VALUES (v_company, v_day, TG_TABLE_NAME, v_id, v_action, auth.uid(), public.nf_actor_name(v_company),
          v_old, v_new, v_reason);
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_set_transfers(p_day_id uuid, p_to_bank numeric, p_to_petty numeric, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  PERFORM public.nf_check_amount(p_to_bank,  'transfer_to_bank',  true);
  PERFORM public.nf_check_amount(p_to_petty, 'transfer_to_petty', true);
  IF p_to_bank < 0 OR p_to_petty < 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  UPDATE public.nf_days SET transfer_to_bank = NULLIF(p_to_bank, 0), transfer_to_petty = NULLIF(p_to_petty, 0)
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

-- nf_day_json: restored to read d.transfer_to_bank/petty directly again,
-- now that the columns exist once more.
CREATE OR REPLACE FUNCTION public.nf_day_json(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  d public.nf_days;
  v_checks jsonb;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  v_checks := public.nf_checks(p_day_id);
  RETURN jsonb_build_object(
    'day', jsonb_build_object(
      'id', d.id, 'company_id', d.company_id, 'business_date', d.business_date, 'closing_no', d.closing_no,
      'status', d.status, 'is_first_day', d.is_first_day,
      'typed_open_cash', d.typed_open_cash, 'typed_open_petty', d.typed_open_petty, 'typed_open_bank', d.typed_open_bank,
      'transfer_to_bank', d.transfer_to_bank, 'transfer_to_petty', d.transfer_to_petty,
      'denominations', d.denominations, 'counted_cash', d.counted_cash, 'remarks', d.remarks,
      'prepared_by_name', d.prepared_by_name,
      'submitted_at', d.submitted_at, 'closed_at', d.closed_at,
      'closed_by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = d.company_id AND m.user_id = d.closed_by),
      'variance', d.variance, 'variance_reason', d.variance_reason,
      'last_return_reason', d.last_return_reason, 'reopen_count', d.reopen_count,
      'is_latest', NOT EXISTS (SELECT 1 FROM public.nf_days x WHERE x.company_id = d.company_id AND x.business_date > d.business_date),
      'version', d.version),
    'position', public.nf_position(p_day_id),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'side', l.side, 'voucher_no', l.voucher_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code, 'via', l.via,
               'amount', l.amount, 'sort', l.sort, 'version', l.version) ORDER BY l.sort)
        FROM public.nf_lines l JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'pdcs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'direction', p.direction, 'cheque_no', p.cheque_no, 'party', p.party, 'bank', p.bank,
               'due_date', p.due_date, 'amount', p.amount, 'entered_here', p.entered_day_id = p_day_id,
               'version', p.version))
        FROM public.nf_pdcs_as_of(p_day_id) p), '[]'::jsonb),
    'checks', v_checks,
    'balanced', jsonb_array_length(v_checks) = 0);
END
$function$;

-- nf_days_guard: restored with the transfer-column references and the
-- NF:LATER_DAY_EXISTS restriction both back in place, exactly as they were
-- before 20260918d's owner-directed changes.
CREATE OR REPLACE FUNCTION public.nf_days_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_role   text;
  v_latest public.nf_days;
  v_checks jsonb;
  v_hard   jsonb;
  v_mis    jsonb;
  r        record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.nf_purging(OLD.company_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'NF:DAY_CANNOT_BE_DELETED';
  END IF;
  IF TG_OP = 'UPDATE' AND public.nf_purging(OLD.company_id) THEN RETURN NEW; END IF;

  v_role := public.nf_role(NEW.company_id);

  NEW.counted_cash := public.nf_count_total(NEW.denominations);

  IF TG_OP = 'INSERT' THEN
    IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;
    IF NEW.status <> 'OPEN' OR NEW.submitted_at IS NOT NULL OR NEW.closed_at IS NOT NULL
       OR NEW.close_cash IS NOT NULL OR NEW.variance IS NOT NULL OR NEW.variance_reason IS NOT NULL
       OR NEW.reopen_count <> 0 THEN
      RAISE EXCEPTION 'NF:DAY_MUST_START_OPEN';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('nf_days:' || NEW.company_id::text, 0));
    SELECT * INTO v_latest FROM public.nf_days
     WHERE company_id = NEW.company_id ORDER BY business_date DESC LIMIT 1;

    IF NEW.is_first_day THEN
      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:FIRST_DAY_NEEDS_DIRECTOR'; END IF;
      IF v_latest.id IS NOT NULL THEN RAISE EXCEPTION 'NF:FIRST_DAY_EXISTS'; END IF;
    ELSE
      IF v_latest.id IS NULL THEN RAISE EXCEPTION 'NF:NO_FIRST_DAY'; END IF;
      IF v_latest.status <> 'CLOSED' THEN
        RAISE EXCEPTION 'NF:PREVIOUS_DAY_NOT_CLOSED' USING DETAIL = v_latest.business_date::text;
      END IF;
      IF NEW.business_date <= v_latest.business_date THEN
        RAISE EXCEPTION 'NF:DATE_NOT_AFTER_PREVIOUS' USING DETAIL = v_latest.business_date::text;
      END IF;
    END IF;
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.version    := 0;
    RETURN NEW;
  END IF;

  IF v_role IS NULL OR v_role = 'viewer' THEN RAISE EXCEPTION 'NF:NOT_ALLOWED'; END IF;

  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id OR NEW.business_date <> OLD.business_date
     OR NEW.is_first_day <> OLD.is_first_day OR NEW.closing_no <> OLD.closing_no
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
  END IF;

  IF NEW.status = OLD.status THEN
    IF OLD.status <> 'OPEN' THEN RAISE EXCEPTION 'NF:DAY_LOCKED'; END IF;
    IF (NEW.submitted_by, NEW.submitted_at, NEW.closed_by, NEW.closed_at, NEW.close_cash, NEW.close_petty,
        NEW.close_bank, NEW.variance, NEW.variance_reason, NEW.last_return_reason, NEW.last_reopen_reason,
        NEW.reopen_count)
       IS DISTINCT FROM
       (OLD.submitted_by, OLD.submitted_at, OLD.closed_by, OLD.closed_at, OLD.close_cash, OLD.close_petty,
        OLD.close_bank, OLD.variance, OLD.variance_reason, OLD.last_return_reason, OLD.last_reopen_reason,
        OLD.reopen_count) THEN
      RAISE EXCEPTION 'NF:IMMUTABLE_COLUMN';
    END IF;
    IF (NEW.typed_open_cash, NEW.typed_open_petty, NEW.typed_open_bank)
       IS DISTINCT FROM (OLD.typed_open_cash, OLD.typed_open_petty, OLD.typed_open_bank)
       AND v_role <> 'director' THEN
      RAISE EXCEPTION 'NF:OPENING_NEEDS_DIRECTOR';
    END IF;
  ELSE
    IF (NEW.typed_open_cash, NEW.typed_open_petty, NEW.typed_open_bank, NEW.transfer_to_bank,
        NEW.transfer_to_petty, NEW.denominations, NEW.remarks)
       IS DISTINCT FROM
       (OLD.typed_open_cash, OLD.typed_open_petty, OLD.typed_open_bank, OLD.transfer_to_bank,
        OLD.transfer_to_petty, OLD.denominations, OLD.remarks) THEN
      RAISE EXCEPTION 'NF:TRANSITION_CHANGES_DATA';
    END IF;

    IF NEW.status IN ('SUBMITTED','CLOSED') AND OLD.status IN ('OPEN','SUBMITTED') AND NEW.status <> OLD.status THEN
      v_checks := public.nf_checks(NEW.id);
      SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_hard FROM jsonb_array_elements(v_checks) c
       WHERE c->>'key' <> 'count_mismatch';
      SELECT c INTO v_mis FROM jsonb_array_elements(v_checks) c WHERE c->>'key' = 'count_mismatch';
      IF jsonb_array_length(v_hard) > 0 THEN
        RAISE EXCEPTION 'NF:CHECKS_FAILED' USING DETAIL = v_hard::text;
      END IF;

      IF NEW.status = 'SUBMITTED' THEN
        IF NEW.variance_reason IS NOT NULL THEN RAISE EXCEPTION 'NF:TRANSITION_CHANGES_DATA'; END IF;
        NEW.submitted_by := auth.uid();
        NEW.submitted_at := now();
        NEW.last_return_reason := NULL;
      ELSE
        IF v_mis IS NOT NULL THEN
          IF v_role <> 'director' THEN
            RAISE EXCEPTION 'NF:VARIANCE_NEEDS_DIRECTOR' USING DETAIL = v_mis::text;
          END IF;
          IF NEW.variance_reason IS NULL OR btrim(NEW.variance_reason) = '' THEN
            RAISE EXCEPTION 'NF:VARIANCE_REASON_REQUIRED' USING DETAIL = v_mis::text;
          END IF;
        ELSIF NEW.variance_reason IS NOT NULL THEN
          RAISE EXCEPTION 'NF:NO_VARIANCE_TO_EXPLAIN';
        END IF;
        SELECT * INTO r FROM public.nf_position_row(NEW.id);
        NEW.close_cash  := r.close_cash;
        NEW.close_petty := r.close_petty;
        NEW.close_bank  := r.close_bank;
        NEW.variance    := r.close_cash - NEW.counted_cash;
        NEW.closed_by   := auth.uid();
        NEW.closed_at   := now();
        IF NEW.submitted_at IS NULL THEN
          NEW.submitted_by := auth.uid();
          NEW.submitted_at := NEW.closed_at;
        END IF;
        NEW.last_reopen_reason := NULL;
      END IF;

    ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'OPEN' THEN
      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:RETURN_NEEDS_DIRECTOR'; END IF;
      IF NEW.last_return_reason IS NULL OR btrim(NEW.last_return_reason) = '' THEN
        RAISE EXCEPTION 'NF:REASON_REQUIRED';
      END IF;
      NEW.submitted_by := NULL;
      NEW.submitted_at := NULL;

    ELSIF OLD.status = 'CLOSED' AND NEW.status = 'OPEN' THEN
      IF v_role <> 'director' THEN RAISE EXCEPTION 'NF:REOPEN_NEEDS_DIRECTOR'; END IF;
      IF NEW.last_reopen_reason IS NULL OR btrim(NEW.last_reopen_reason) = '' THEN
        RAISE EXCEPTION 'NF:REASON_REQUIRED';
      END IF;
      IF EXISTS (SELECT 1 FROM public.nf_days x
                  WHERE x.company_id = OLD.company_id AND x.business_date > OLD.business_date) THEN
        RAISE EXCEPTION 'NF:LATER_DAY_EXISTS';
      END IF;
      NEW.close_cash := NULL; NEW.close_petty := NULL; NEW.close_bank := NULL;
      NEW.variance := NULL; NEW.variance_reason := NULL;
      NEW.closed_by := NULL; NEW.closed_at := NULL;
      NEW.submitted_by := NULL; NEW.submitted_at := NULL;
      NEW.reopen_count := OLD.reopen_count + 1;

    ELSE
      RAISE EXCEPTION 'NF:BAD_TRANSITION' USING DETAIL = OLD.status || ' -> ' || NEW.status;
    END IF;
  END IF;

  NEW.version    := OLD.version + 1;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

-- restore _nf_test_purge to its exact pre-double-entry body (nf_lines is a
-- real table again by this point in the rollback)
CREATE OR REPLACE FUNCTION public._nf_test_purge(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_name text;
  n jsonb := '{}'::jsonb;
  k integer;
BEGIN
  SELECT company_name INTO v_name FROM public.companies WHERE id = p_company_id;
  IF v_name IS NULL OR v_name NOT LIKE 'ZZTEST-NF-%' THEN
    RAISE EXCEPTION 'NF:PURGE_REFUSED' USING DETAIL = COALESCE(v_name, 'no such company');
  END IF;
  PERFORM set_config('nf.purge_company', p_company_id::text, true);

  DELETE FROM public.nf_audit             WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_audit', k);
  DELETE FROM public.nf_pdcs              WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_pdcs', k);
  DELETE FROM public.nf_lines             WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_lines', k);
  DELETE FROM public.nf_days              WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_days', k);
  DELETE FROM public.nf_report_categories WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_report_categories', k);
  DELETE FROM public.nf_floors            WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_floors', k);
  k := 0;
  LOOP
    DELETE FROM public.nf_accounts a WHERE a.company_id = p_company_id
       AND NOT EXISTS (SELECT 1 FROM public.nf_accounts c WHERE c.company_id = a.company_id AND c.parent_code = a.code);
    EXIT WHEN NOT FOUND;
  END LOOP;
  n := n || jsonb_build_object('nf_accounts_left', (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id));
  DELETE FROM public.nf_settings WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_settings', k);
  DELETE FROM public.nf_members  WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_members', k);
  DELETE FROM public.nf_audit    WHERE company_id = p_company_id;
  DELETE FROM public.companies   WHERE id = p_company_id;         GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('companies', k);
  RETURN n;
END
$function$;

-- restore _nf_seed_company to its exact pre-double-entry body (20260918e)
CREATE OR REPLACE FUNCTION public._nf_seed_company(p_company_id uuid, p_seed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE x jsonb; o bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.nf_accounts WHERE company_id = p_company_id) THEN
    RAISE EXCEPTION 'NF:ALREADY_SEEDED';
  END IF;
  INSERT INTO public.nf_settings (company_id, large_payment_threshold, pdc_due_days, company_line, report_title, mark)
  VALUES (p_company_id, (p_seed->'settings'->>'large_payment_threshold')::numeric,
          (p_seed->'settings'->>'pdc_due_days')::integer, p_seed->'settings'->>'company_line',
          p_seed->'settings'->>'report_title', p_seed->'settings'->>'mark');
  FOR x, o IN SELECT * FROM jsonb_array_elements(p_seed->'accounts') WITH ORDINALITY LOOP
    INSERT INTO public.nf_accounts (company_id, code, name, qb_type, parent_code, description, is_head, via, via_label, sort, active)
    VALUES (p_company_id, x->>'code', x->>'name', x->>'qb_type', x->>'parent_code', x->>'description',
            (x->>'is_head')::boolean, x->>'via', x->>'via_label', o, true);
  END LOOP;
  FOR x, o IN SELECT * FROM jsonb_array_elements(p_seed->'floors') WITH ORDINALITY LOOP
    INSERT INTO public.nf_floors (company_id, code, qb_class, sort) VALUES (p_company_id, x->>'code', x->>'qb_class', o);
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_seed->'categories') LOOP
    INSERT INTO public.nf_report_categories (company_id, side, priority, match_kind, pattern, label)
    VALUES (p_company_id, x->>'side', (x->>'priority')::integer, x->>'match_kind', x->>'pattern', x->>'label');
  END LOOP;
  RETURN jsonb_build_object(
    'accounts',   (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id),
    'heads',      (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id AND is_head),
    'vias',       (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id AND via IS NOT NULL),
    'floors',     (SELECT count(*) FROM public.nf_floors WHERE company_id = p_company_id),
    'categories', (SELECT count(*) FROM public.nf_report_categories WHERE company_id = p_company_id));
END
$function$;

-- restore nf_get_report to its exact pre-double-entry body (20260918f)
CREATE OR REPLACE FUNCTION public.nf_get_report(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
  s public.nf_settings;
  pos jsonb;
  v_checks jsonb;
  v_counted boolean;
  v_diff numeric;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director','viewer']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  SELECT * INTO s FROM public.nf_settings WHERE company_id = v_company;
  IF s.company_id IS NULL THEN RAISE EXCEPTION 'NF:NOT_SEEDED'; END IF;
  pos := public.nf_position(p_day_id);
  v_checks := public.nf_checks(p_day_id);
  v_counted := d.denominations IS NOT NULL;
  v_diff := CASE WHEN v_counted THEN (SELECT (x->>'closing')::numeric FROM jsonb_array_elements(pos->'rows') x
                                      WHERE x->>'via' = 'Cash') - d.counted_cash END;

  RETURN jsonb_build_object(
    'business_date', d.business_date,
    'closing_no',    d.closing_no,
    'status',        d.status,
    'balanced',      jsonb_array_length(v_checks) = 0,
    'company_line',  s.company_line,
    'report_title',  s.report_title,
    'mark',          s.mark,
    'accounts', (SELECT jsonb_agg(jsonb_build_object('via', x->>'via', 'label', x->>'label',
                                                     'opening', (x->>'opening')::numeric,
                                                     'closing', (x->>'closing')::numeric) ORDER BY o)
                   FROM jsonb_array_elements(pos->'rows') WITH ORDINALITY AS t(x, o)),
    'total_close', (pos->'total'->>'closing')::numeric,
    'total_in',    (pos->'total'->>'received')::numeric,
    'total_out',   (pos->'total'->>'paid')::numeric,
    'in_categories',  public.nf_report_groups(p_day_id, 'IN'),
    'out_categories', public.nf_report_groups(p_day_id, 'OUT'),
    'large_threshold', s.large_payment_threshold,
    'large_payments', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'description', l.description,
                'category', public.nf_category(v_company, 'OUT', l.head_code),
                'by', CASE WHEN l.via = 'Bank' THEN 'bank' ELSE 'cash' END,
                'amount', l.amount) ORDER BY l.amount DESC, l.sort)
         FROM public.nf_lines l
        WHERE l.day_id = p_day_id AND l.side = 'OUT' AND l.amount >= s.large_payment_threshold), '[]'::jsonb),
    'counted', v_counted,
    'count_diff', v_diff,
    'variance_reason', d.variance_reason,
    'negatives', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', x->>'label', 'amount', (x->>'closing')::numeric))
                             FROM jsonb_array_elements(pos->'rows') x WHERE (x->>'closing')::numeric < 0), '[]'::jsonb),
    'transfer_to_bank', d.transfer_to_bank,
    'bank_label', (SELECT via_label FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank'),
    'other_issue_count', (SELECT count(*) FROM jsonb_array_elements(v_checks) c
                           WHERE c->>'key' NOT IN ('negative','not_counted','count_mismatch')),
    'pdc_due_days', s.pdc_due_days,
    'pdc_due', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('direction', p.direction, 'amount', p.amount, 'party', p.party,
                                           'due_date', p.due_date)
                        ORDER BY CASE p.direction WHEN 'RECEIVED' THEN 1 ELSE 2 END, p.created_at, p.id)
         FROM public.nf_pdcs_as_of(p_day_id) p
        WHERE p.due_date BETWEEN d.business_date AND d.business_date + s.pdc_due_days), '[]'::jsonb),
    'pdc_pending', jsonb_build_object(
       'received', (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'RECEIVED'),
       'issued',   (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'ISSUED')),
    'prepared_by_name', d.prepared_by_name);
END
$function$;

COMMIT;
