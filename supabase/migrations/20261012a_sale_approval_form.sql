-- ─────────────────────────────────────────────────────────────────────────────
-- SALE APPROVAL FORM (SAF) — Awami Market  (2026-10-12)
--
-- One numbered, locked, signed document per deal. It fixes the rate, the price,
-- the buyer, the money received, and the agent with his commission, so nobody
-- can later say "we never agreed to this". No Awami sale file is processed
-- without an approved SAF.
--
--   prepared   a director or Accounts, in the CRM portal (session token)
--   submitted  the preparer, once every required field is there
--   verified   Accounts: the money on the form matches NexuFinance
--   approved   Rashid only (_may_authorize_reservation, the same one helper
--              that decides who may authorise a reservation)
--   rejected   with a reason;  superseded  replaced by a newer approved SAF
--
-- What the server fills and nobody types:
--   unit block    units.unit_code / floor / area / base_price; rate = price ÷ area
--   money block   NexuFinance 21100 lines for the unit (_nf_token_ledger_body,
--                 the body behind nf_get_token_register — that wrapper needs a
--                 NexuFinance sign-in, which a portal session does not have)
--
-- Where it bites:
--   _create_sale_with_schedule_core  — the one place every sale is made
--                 (create_sale_with_schedule, approve_sale_submission, the
--                 approvals engine, saf_create_sale). For an Awami unit it
--                 refuses `saf_required` without an approved SAF, refuses
--                 `saf_mismatch` if the sale's numbers differ from it, and
--                 stamps sales.saf_id.
--   units BEFORE UPDATE OF status_id — moving an Awami unit INTO Sold - Entry
--                 Pending / Sold / Booked needs an active hold with a buyer name
--                 and a LINKED agent (agent row or CRM user), or an approved
--                 SAF. Otherwise `sold_needs_buyer_and_agent`. Only moves into
--                 those statuses are checked; the 108 units already sitting in
--                 Sold - Entry Pending are not touched and can still be
--                 released or corrected.
--
-- Scope: company_feature_flags 'sale_approval_form' — on for Awami only. With
-- the flag off every new rule is a no-op, so FMH / KBH behave exactly as today.
-- Untouched: unit prices (trg_awami_price_lock), reservations, NexuFinance
-- vouchers. Nothing here posts or edits a voucher.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. the switch ───────────────────────────────────────────────────────────
INSERT INTO public.company_feature_flags (company_id, feature_key, is_enabled, override_note, set_at, set_by)
VALUES ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce', 'sale_approval_form', true,
        'No Awami sale file without an approved Sale Approval Form (20261012a)', now(), 'Rashid')
ON CONFLICT (company_id, feature_key) DO UPDATE SET is_enabled = true, set_at = now(), set_by = 'Rashid';

CREATE OR REPLACE FUNCTION public._saf_on(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT f.is_enabled FROM public.company_feature_flags f
                    WHERE f.company_id = p_company AND f.feature_key = 'sale_approval_form'), false);
$$;

-- ── 1. tables ───────────────────────────────────────────────────────────────
CREATE TABLE public.saf_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id),
  last_no    integer NOT NULL DEFAULT 0
);

CREATE TABLE public.sale_approval_forms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  project_id      uuid NOT NULL REFERENCES public.projects(id),
  unit_id         uuid NOT NULL REFERENCES public.units(id),
  reservation_id  uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  saf_no          text NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','verified','approved','rejected','superseded','cancelled')),
  supersedes_id   uuid REFERENCES public.sale_approval_forms(id),
  superseded_by   uuid REFERENCES public.sale_approval_forms(id),

  -- unit block: filled by the server, never typed
  unit_code       text,
  floor_label     text,
  block           text,
  area_sqft       numeric,
  rate_per_sqft   numeric,
  base_price      numeric,

  -- deal
  plan_type                 text CHECK (plan_type IN ('standard','full_100','half_50','custom')),
  standard_discount_pct     numeric NOT NULL DEFAULT 0,
  discount_amount           numeric NOT NULL DEFAULT 0,
  discount_pct              numeric NOT NULL DEFAULT 0,
  discount_reason           text,
  discount_approved_by      uuid REFERENCES public.sales_users(id),
  discount_approved_by_name text,
  discount_beyond_standard  boolean NOT NULL DEFAULT false,
  net_price                 numeric,
  dp_pct                    numeric,
  dp_amount                 numeric,
  installment_count         integer,
  installment_amount        numeric,
  first_due_date            date,
  balloon_amount            numeric NOT NULL DEFAULT 0,
  balloon_due_date          date,
  schedule_json             jsonb NOT NULL DEFAULT '[]'::jsonb,
  sale_date                 date,

  -- buyer
  buyer_name              text,
  buyer_relation          text CHECK (buyer_relation IN ('S/O','D/O','W/O')),
  buyer_father            text,
  buyer_cnic              text,
  buyer_phone             text,
  buyer_address           text,
  reservation_buyer_name  text,
  buyer_name_reason       text,
  co_buyer                jsonb,
  nominee                 jsonb,

  -- money received: snapshot from NexuFinance, never typed
  token_numbers   text,
  receipts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_received  numeric NOT NULL DEFAULT 0,
  dp_balance      numeric,
  money_as_of     timestamptz,

  -- sold by
  agent_id                 uuid REFERENCES public.agents(id),
  agent_name               text,
  sub_agent_name           text,
  commission_standard_pct  numeric,
  commission_pct           numeric,
  commission_reason        text,
  commission_amount        numeric,
  commission_payable_when  text NOT NULL DEFAULT 'After the down payment is fully received and the sale entry is made',

  -- who did what
  prepared_by                 uuid REFERENCES public.sales_users(id),
  prepared_by_name            text,
  prepared_at                 timestamptz,
  submitted_by                uuid REFERENCES public.sales_users(id),
  submitted_by_name           text,
  submitted_at                timestamptz,
  accounts_verified_by        uuid REFERENCES public.sales_users(id),
  accounts_verified_by_name   text,
  accounts_verified_at        timestamptz,
  approved_by                 uuid REFERENCES public.sales_users(id),
  approved_by_name            text,
  approved_at                 timestamptz,
  rejected_by                 uuid REFERENCES public.sales_users(id),
  rejected_by_name            text,
  rejected_at                 timestamptz,
  reject_reason               text,

  -- integrity
  snapshot        jsonb,
  snapshot_hash   text,
  pdf_sha256      text,
  sale_id         uuid REFERENCES public.sales(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, saf_no)
);
-- one form in progress per unit, and one approved form waiting for its sale
CREATE UNIQUE INDEX saf_one_open_per_unit ON public.sale_approval_forms (unit_id)
  WHERE status IN ('draft','submitted','verified');
CREATE UNIQUE INDEX saf_one_approved_per_unit ON public.sale_approval_forms (unit_id)
  WHERE status = 'approved' AND sale_id IS NULL;
CREATE INDEX saf_company_status ON public.sale_approval_forms (company_id, status);

-- Supabase hands every new public table to anon/authenticated with RLS off.
-- Both tables are reached only through the SECURITY DEFINER functions below.
ALTER TABLE public.saf_counters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_approval_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saf_counters        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_approval_forms FROM PUBLIC, anon, authenticated;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS saf_id uuid REFERENCES public.sale_approval_forms(id);

CREATE TRIGGER _trg_audit AFTER INSERT OR DELETE OR UPDATE ON public.sale_approval_forms
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ── 2. the lock: an approved form is never edited ───────────────────────────
-- Allowed on an approved row: being marked superseded (status + superseded_by),
-- being linked to / unlinked from its sale, and its PDF fingerprint being
-- recorded once. Everything else is refused, whichever path the UPDATE takes.
CREATE OR REPLACE FUNCTION public._saf_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE c_free constant text[] := ARRAY['status','superseded_by','sale_id','pdf_sha256','updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved','superseded') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'saf_locked',
        MESSAGE = 'Sale Approval Form ' || OLD.saf_no || ' is ' || OLD.status || ' and cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status NOT IN ('approved','superseded') THEN RETURN NEW; END IF;

  IF (to_jsonb(NEW) - c_free) IS DISTINCT FROM (to_jsonb(OLD) - c_free)
     OR (OLD.status = 'superseded' AND NEW.status <> 'superseded')
     OR (OLD.status = 'approved'   AND NEW.status NOT IN ('approved','superseded'))
     OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by)
     OR (NEW.status = 'superseded' AND NEW.superseded_by IS NULL)
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'saf_locked',
      MESSAGE = 'Sale Approval Form ' || OLD.saf_no || ' is ' || OLD.status
             || '. Any change needs a new SAF that supersedes it.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_saf_lock BEFORE UPDATE OR DELETE ON public.sale_approval_forms
  FOR EACH ROW EXECUTE FUNCTION public._saf_lock();

-- ── 3. helpers ──────────────────────────────────────────────────────────────
-- who is calling: a live portal session, named for the audit trail
CREATE OR REPLACE FUNCTION public._saf_ctx(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._rms_actor_session(p_session_token);
  SELECT jsonb_build_object('user_id', su.id, 'company_id', ss.company_id, 'role', su.role,
           'name', su.full_name,
           'rashid', public._may_authorize_reservation(p_session_token))
    INTO v
    FROM public.sales_sessions ss JOIN public.sales_users su ON su.id = ss.sales_user_id
   WHERE ss.session_token = p_session_token AND ss.expires_at > now();
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public._saf_digits(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') $$;

-- the unit block, from the unit row and nothing else
CREATE OR REPLACE FUNCTION public._saf_unit_block(p_unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'unit_code',     COALESCE(NULLIF(u.unit_code, ''), u.unit_no),
    'floor_label',   u.floor_label,
    'block',         u.block,
    'area_sqft',     u.area,
    'base_price',    u.base_price,
    'rate_per_sqft', CASE WHEN COALESCE(u.area, 0) > 0 THEN round(u.base_price / u.area, 2) END)
  FROM public.units u WHERE u.id = p_unit;
$$;

-- the money block: every NexuFinance 21100 line booked to this unit
CREATE OR REPLACE FUNCTION public._saf_money(p_company uuid, p_unit_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_u jsonb;
BEGIN
  SELECT e INTO v_u
    FROM jsonb_array_elements(public._nf_token_ledger_body(p_company, NULL, NULL)->'units') e
   WHERE e->>'unit_code' = p_unit_code LIMIT 1;
  IF v_u IS NULL THEN
    RETURN jsonb_build_object('token_numbers', NULL, 'receipts', '[]'::jsonb, 'total', 0);
  END IF;
  RETURN jsonb_build_object(
    'token_numbers', NULLIF(v_u->>'tokens', ''),
    'total',         COALESCE((v_u->>'net')::numeric, 0),
    'receipts', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'date',       l->>'date',
                'voucher_no', COALESCE(NULLIF(l->>'voucher_no', ''), l->>'system_no'),
                'system_no',  l->>'system_no',
                'party',      l->>'party',
                'mode', CASE
                          WHEN upper(COALESCE(l->>'system_no', l->>'voucher_no', '')) LIKE 'C%' THEN 'Cash'
                          WHEN upper(COALESCE(l->>'system_no', l->>'voucher_no', '')) LIKE 'B%' THEN 'Bank'
                          ELSE 'Journal' END,
                'amount',     (l->>'amount')::numeric)
              ORDER BY l->>'date', l->>'system_no')
         FROM jsonb_array_elements(COALESCE(v_u->'lines', '[]'::jsonb)) l), '[]'::jsonb));
END $$;

-- the plan's own discount, from Rashid's price poster
CREATE OR REPLACE FUNCTION public._saf_plan_discount(p_plan text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_plan WHEN 'full_100' THEN 10 WHEN 'half_50' THEN 5 ELSE 0 END::numeric
$$;

-- the standard commission: an active structure for the agent, then for the
-- project, then the agent's own percentage, then 0
CREATE OR REPLACE FUNCTION public._saf_std_commission(p_company uuid, p_project uuid, p_agent uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT cs.rate_percent FROM public.commission_structures cs
      WHERE cs.company_id = p_company AND COALESCE(cs.is_active, true)
        AND cs.agent_id = p_agent AND (cs.project_id IS NULL OR cs.project_id = p_project)
      ORDER BY (cs.project_id = p_project) DESC NULLS LAST LIMIT 1),
    (SELECT cs.rate_percent FROM public.commission_structures cs
      WHERE cs.company_id = p_company AND COALESCE(cs.is_active, true)
        AND cs.agent_id IS NULL AND (cs.project_id IS NULL OR cs.project_id = p_project)
      ORDER BY (cs.project_id = p_project) DESC NULLS LAST LIMIT 1),
    (SELECT a.commission_percent FROM public.agents a WHERE a.id = p_agent),
    0);
$$;

-- ── 4. the arithmetic: one function, used by preview, save, submit, approve ──
-- Takes the form row as jsonb, returns it with every derived field recomputed.
-- Same rules as save_unit_quote: monthly from the first due date, each one the
-- rounded share, the last one takes whatever is left.
CREATE OR REPLACE FUNCTION public._saf_compute(f jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_plan text := COALESCE(NULLIF(f->>'plan_type', ''), 'standard');
  v_base numeric := COALESCE((f->>'base_price')::numeric, 0);
  v_std numeric := public._saf_plan_discount(v_plan);
  v_disc numeric; v_net numeric; v_dp_pct numeric; v_dp numeric; v_n int;
  v_balloon numeric := GREATEST(COALESCE((f->>'balloon_amount')::numeric, 0), 0);
  v_sale_date date := COALESCE(NULLIF(f->>'sale_date', '')::date, CURRENT_DATE);
  v_first date; v_left numeric; v_amt numeric; v_i int; v_sched jsonb := '[]'::jsonb;
  v_bdate date; v_last date; v_recv numeric := COALESCE((f->>'total_received')::numeric, 0);
  v_cpct numeric; v_cstd numeric;
BEGIN
  -- discount: what was asked for, else the plan's own
  IF f ? 'discount_amount' AND NULLIF(f->>'discount_amount', '') IS NOT NULL THEN
    v_disc := round(GREATEST((f->>'discount_amount')::numeric, 0), 0);
  ELSE
    v_disc := round(v_base * v_std / 100, 0);
  END IF;
  v_net := v_base - v_disc;

  IF v_plan = 'custom' THEN
    -- the schedule is the user's; DP and the count are read off it
    v_sched := COALESCE(f->'schedule_json', '[]'::jsonb);
    SELECT COALESCE(sum((e->>'amount_due')::numeric) FILTER (WHERE e->>'installment_type' = 'down_payment'), 0),
           count(*) FILTER (WHERE COALESCE(e->>'installment_type', 'installment') = 'installment'),
           min(NULLIF(e->>'due_date', '')::date) FILTER (WHERE COALESCE(e->>'installment_type', 'installment') = 'installment')
      INTO v_dp, v_n, v_first
      FROM jsonb_array_elements(v_sched) e;
    v_dp_pct := CASE WHEN v_net > 0 THEN round(v_dp / v_net * 100, 2) ELSE 0 END;
    v_amt := NULL;
    v_balloon := COALESCE((SELECT sum((e->>'amount_due')::numeric) FROM jsonb_array_elements(v_sched) e
                            WHERE e->>'installment_type' = 'possession'), 0);
  ELSE
    v_dp_pct := CASE v_plan WHEN 'full_100' THEN 100 WHEN 'half_50' THEN 50 ELSE 30 END;
    v_n := CASE v_plan WHEN 'full_100' THEN 0
                       WHEN 'standard' THEN 36
                       ELSE GREATEST(COALESCE(NULLIF(f->>'installment_count', '')::int, 36), 1) END;
    IF v_plan = 'full_100' THEN v_balloon := 0; END IF;
    v_dp := CASE WHEN v_plan = 'full_100' THEN v_net ELSE round(v_net * v_dp_pct / 100, 0) END;
    v_first := COALESCE(NULLIF(f->>'first_due_date', '')::date, (v_sale_date + interval '1 month')::date);

    v_sched := jsonb_build_array(jsonb_build_object('installment_number', 0, 'installment_type', 'down_payment',
                 'due_date', v_sale_date, 'amount_due', v_dp));
    v_left := v_net - v_dp - v_balloon;
    v_amt := CASE WHEN v_n > 0 THEN round(v_left / v_n, 0) ELSE 0 END;
    v_last := v_sale_date;
    FOR v_i IN 1..v_n LOOP
      v_last := (v_first + (v_i - 1) * interval '1 month')::date;
      v_sched := v_sched || jsonb_build_object('installment_number', v_i, 'installment_type', 'installment',
                   'due_date', v_last,
                   'amount_due', CASE WHEN v_i = v_n THEN v_left - v_amt * (v_n - 1) ELSE v_amt END);
    END LOOP;
    IF v_balloon > 0 THEN
      v_bdate := COALESCE(NULLIF(f->>'balloon_due_date', '')::date, (v_last + interval '1 month')::date);
      v_sched := v_sched || jsonb_build_object('installment_number', v_n + 1, 'installment_type', 'possession',
                   'due_date', v_bdate, 'amount_due', v_balloon);
    END IF;
  END IF;

  v_cstd := COALESCE((f->>'commission_standard_pct')::numeric, 0);
  v_cpct := COALESCE(NULLIF(f->>'commission_pct', '')::numeric, v_cstd);

  RETURN f || jsonb_build_object(
    'plan_type', v_plan,
    'standard_discount_pct', v_std,
    'discount_amount', v_disc,
    'discount_pct', CASE WHEN v_base > 0 THEN round(v_disc / v_base * 100, 4) ELSE 0 END,
    'discount_beyond_standard', (v_base > 0 AND v_disc > round(v_base * v_std / 100, 0)),
    'net_price', v_net,
    'dp_pct', v_dp_pct,
    'dp_amount', v_dp,
    'installment_count', v_n,
    'installment_amount', v_amt,
    'first_due_date', v_first,
    'balloon_amount', v_balloon,
    'balloon_due_date', CASE WHEN v_balloon > 0 THEN COALESCE(v_bdate, NULLIF(f->>'balloon_due_date', '')::date) END,
    'sale_date', v_sale_date,
    'schedule_json', v_sched,
    'schedule_total', COALESCE((SELECT sum((e->>'amount_due')::numeric) FROM jsonb_array_elements(v_sched) e), 0),
    'dp_balance', v_dp - v_recv,
    'commission_pct', v_cpct,
    'commission_amount', round(v_net * v_cpct / 100, 0));
END $$;

-- what is wrong with a form, for submit (and shown live on the screen)
CREATE OR REPLACE FUNCTION public._saf_problems(f jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p jsonb := '[]'::jsonb; v_cnic text := public._saf_digits(f->>'buyer_cnic');
BEGIN
  IF NULLIF(btrim(f->>'buyer_name'), '') IS NULL THEN p := p || '"Buyer name is required."'; END IF;
  IF NULLIF(btrim(f->>'buyer_father'), '') IS NULL OR NULLIF(f->>'buyer_relation', '') IS NULL THEN
    p := p || '"Father / husband name (S/O, D/O or W/O) is required."'; END IF;
  IF length(v_cnic) <> 13 THEN p := p || '"CNIC must be 13 digits."'; END IF;
  IF length(public._saf_digits(f->>'buyer_phone')) < 10 THEN p := p || '"Buyer phone is required."'; END IF;
  IF NULLIF(f->>'agent_id', '') IS NULL THEN p := p || '"Pick the agent who sold it."'; END IF;
  IF NULLIF(f->>'plan_type', '') IS NULL THEN p := p || '"Pick a payment plan."'; END IF;
  IF abs(COALESCE((f->>'schedule_total')::numeric, 0) - COALESCE((f->>'net_price')::numeric, 0)) > 1 THEN
    p := p || to_jsonb('The schedule adds up to ' || to_char(COALESCE((f->>'schedule_total')::numeric, 0), 'FM999,999,999,990')
                       || ', not the net price ' || to_char(COALESCE((f->>'net_price')::numeric, 0), 'FM999,999,999,990') || '.');
  END IF;
  IF COALESCE((f->>'net_price')::numeric, 0) <= 0 THEN p := p || '"The unit has no price."'; END IF;
  IF COALESCE((f->>'discount_amount')::numeric, 0) > 0 AND NULLIF(btrim(f->>'discount_reason'), '') IS NULL
     AND COALESCE((f->>'discount_beyond_standard')::boolean, false) THEN
    p := p || '"A discount beyond the plan needs a reason."'; END IF;
  IF COALESCE((f->>'discount_beyond_standard')::boolean, false) AND NULLIF(f->>'discount_approved_by', '') IS NULL THEN
    p := p || '"A discount beyond the plan needs a director''s name in Discount approved by."'; END IF;
  IF COALESCE((f->>'commission_pct')::numeric, 0) IS DISTINCT FROM COALESCE((f->>'commission_standard_pct')::numeric, 0)
     AND NULLIF(btrim(f->>'commission_reason'), '') IS NULL THEN
    p := p || '"A commission different from the standard needs a reason."'; END IF;
  IF NULLIF(btrim(f->>'reservation_buyer_name'), '') IS NOT NULL
     AND lower(btrim(f->>'reservation_buyer_name')) <> lower(btrim(COALESCE(f->>'buyer_name', '')))
     AND NULLIF(btrim(f->>'buyer_name_reason'), '') IS NULL THEN
    p := p || '"The buyer is not the name on the hold. Say why."'; END IF;
  RETURN p;
END $$;

-- the differences a director should look at before signing
CREATE OR REPLACE FUNCTION public._saf_flags(f jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT 'Discount beyond the plan: ' || to_char((f->>'discount_amount')::numeric, 'FM999,999,999,990')
           || ' (' || round((f->>'discount_pct')::numeric, 2) || '% vs ' || (f->>'standard_discount_pct') || '% standard)' AS x
     WHERE COALESCE((f->>'discount_beyond_standard')::boolean, false)
    UNION ALL
    SELECT 'Commission ' || (f->>'commission_pct') || '% instead of the standard ' || COALESCE(f->>'commission_standard_pct', '0') || '%'
     WHERE COALESCE((f->>'commission_pct')::numeric, 0) IS DISTINCT FROM COALESCE((f->>'commission_standard_pct')::numeric, 0)
    UNION ALL
    SELECT 'Buyer "' || (f->>'buyer_name') || '" is not the name on the hold ("' || (f->>'reservation_buyer_name') || '")'
     WHERE NULLIF(btrim(f->>'reservation_buyer_name'), '') IS NOT NULL
       AND lower(btrim(f->>'reservation_buyer_name')) <> lower(btrim(COALESCE(f->>'buyer_name', '')))
    UNION ALL
    SELECT 'Custom schedule (not the standard plan)' WHERE f->>'plan_type' = 'custom'
  ) s;
$$;

-- the fields a user may change on a draft; everything else is the server's
CREATE OR REPLACE FUNCTION public._saf_inputs(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(COALESCE(p, '{}'::jsonb)) AS e(k, v)
   WHERE k = ANY (ARRAY['plan_type','discount_amount','discount_reason','discount_approved_by',
                        'installment_count','first_due_date','balloon_amount','balloon_due_date',
                        'schedule_json','sale_date',
                        'buyer_name','buyer_relation','buyer_father','buyer_cnic','buyer_phone','buyer_address',
                        'buyer_name_reason','co_buyer','nominee',
                        'agent_id','sub_agent_name','commission_pct','commission_reason']);
$$;

-- one form, as the screens and the PDF see it
CREATE OR REPLACE FUNCTION public._saf_view(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT to_jsonb(f)
         || jsonb_build_object(
              'schedule_total', (SELECT COALESCE(sum((e->>'amount_due')::numeric), 0) FROM jsonb_array_elements(f.schedule_json) e),
              'flags',    public._saf_flags(to_jsonb(f)),
              'problems', CASE WHEN f.status = 'draft'
                               THEN public._saf_problems(to_jsonb(f) || jsonb_build_object('schedule_total',
                                      (SELECT COALESCE(sum((e->>'amount_due')::numeric), 0) FROM jsonb_array_elements(f.schedule_json) e)))
                               ELSE '[]'::jsonb END,
              'supersedes_no',    (SELECT o.saf_no FROM public.sale_approval_forms o WHERE o.id = f.supersedes_id),
              'superseded_by_no', (SELECT o.saf_no FROM public.sale_approval_forms o WHERE o.id = f.superseded_by),
              'sale_number',      (SELECT s.sale_number FROM public.sales s WHERE s.id = f.sale_id),
              'project_name',     (SELECT p.project_name FROM public.projects p WHERE p.id = f.project_id))
    FROM public.sale_approval_forms f WHERE f.id = p_id;
$$;

-- ── 5. the doors (portal session) ───────────────────────────────────────────

-- start a form for a unit: unit and money filled by the server, buyer and
-- agent from the unit's active hold
CREATE OR REPLACE FUNCTION public.saf_new(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_u public.units; v_r public.reservations;
        v_id uuid; v_no int; v_blk jsonb; v_m jsonb; v_agent uuid; v_f jsonb; v_open uuid;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only directors and Accounts prepare a Sale Approval Form.'); END IF;
  SELECT * INTO v_u FROM public.units WHERE id = p_unit_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'unit_not_found'); END IF;
  IF NOT public._saf_on(v_u.company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_enabled', 'message', 'Sale Approval Forms are not switched on for this company.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_u.id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold', 'message', 'This unit already has an active sale.'); END IF;

  SELECT id INTO v_open FROM public.sale_approval_forms
   WHERE unit_id = v_u.id AND status IN ('draft','submitted','verified');
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'existing', true, 'saf', public._saf_view(v_open)); END IF;
  IF EXISTS (SELECT 1 FROM public.sale_approval_forms WHERE unit_id = v_u.id AND status = 'approved' AND sale_id IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_approved',
      'message', 'This unit already has an approved SAF. To change it, supersede that form.'); END IF;

  SELECT * INTO v_r FROM public.reservations
   WHERE unit_id = v_u.id AND status = 'active' ORDER BY created_at DESC LIMIT 1;
  v_agent := COALESCE(v_r.requested_by_agent_id,
              (SELECT su.agent_id FROM public.sales_users su WHERE su.id = v_r.requested_by_sales_user_id));

  v_blk := public._saf_unit_block(v_u.id);
  v_m   := public._saf_money(v_u.company_id, v_blk->>'unit_code');

  INSERT INTO public.saf_counters (company_id, last_no) VALUES (v_u.company_id, 1)
  ON CONFLICT (company_id) DO UPDATE SET last_no = public.saf_counters.last_no + 1
  RETURNING last_no INTO v_no;

  v_f := public._saf_compute(v_blk || jsonb_build_object(
           'plan_type', 'standard', 'sale_date', CURRENT_DATE, 'total_received', v_m->'total',
           'commission_standard_pct', public._saf_std_commission(v_u.company_id, v_u.project_id, v_agent)));

  INSERT INTO public.sale_approval_forms (
    company_id, project_id, unit_id, reservation_id, saf_no, status,
    unit_code, floor_label, block, area_sqft, rate_per_sqft, base_price,
    plan_type, standard_discount_pct, discount_amount, discount_pct, net_price, dp_pct, dp_amount,
    installment_count, installment_amount, first_due_date, schedule_json, sale_date,
    buyer_name, buyer_phone, reservation_buyer_name,
    token_numbers, receipts, total_received, dp_balance, money_as_of,
    agent_id, agent_name, commission_standard_pct, commission_pct, commission_amount,
    prepared_by, prepared_by_name, prepared_at)
  VALUES (
    v_u.company_id, v_u.project_id, v_u.id, v_r.id, 'SAF-' || lpad(v_no::text, 4, '0'), 'draft',
    v_blk->>'unit_code', v_blk->>'floor_label', v_blk->>'block', (v_blk->>'area_sqft')::numeric,
    (v_blk->>'rate_per_sqft')::numeric, (v_blk->>'base_price')::numeric,
    v_f->>'plan_type', (v_f->>'standard_discount_pct')::numeric, (v_f->>'discount_amount')::numeric,
    (v_f->>'discount_pct')::numeric, (v_f->>'net_price')::numeric, (v_f->>'dp_pct')::numeric, (v_f->>'dp_amount')::numeric,
    (v_f->>'installment_count')::int, (v_f->>'installment_amount')::numeric, (v_f->>'first_due_date')::date,
    v_f->'schedule_json', (v_f->>'sale_date')::date,
    NULLIF(btrim(v_r.client_name), ''), NULLIF(btrim(v_r.client_phone), ''), NULLIF(btrim(v_r.client_name), ''),
    v_m->>'token_numbers', v_m->'receipts', (v_m->>'total')::numeric, (v_f->>'dp_balance')::numeric, now(),
    v_agent, (SELECT a.full_name FROM public.agents a WHERE a.id = v_agent),
    (v_f->>'commission_standard_pct')::numeric, (v_f->>'commission_pct')::numeric, (v_f->>'commission_amount')::numeric,
    (c->>'user_id')::uuid, c->>'name', now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(v_id));
END $$;

-- save a draft (p_commit = false: work it out and show it, write nothing)
CREATE OR REPLACE FUNCTION public.saf_save(p_session_token text, p_id uuid, p_input jsonb, p_commit boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_row public.sale_approval_forms;
        v_in jsonb := public._saf_inputs(p_input); v_f jsonb; v_agent uuid; v_dir uuid; v_dir_name text;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_draft',
      'message', 'Only a draft can be changed. This form is ' || v_row.status || '.'); END IF;

  -- the agent and the director must be real rows of this company
  v_agent := COALESCE(NULLIF(v_in->>'agent_id', '')::uuid, v_row.agent_id);
  IF v_agent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id = v_agent
        AND a.company_id = v_row.company_id AND a.project_id = v_row.project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_agent', 'message', 'That agent is not on this project.'); END IF;
  v_dir := COALESCE(NULLIF(v_in->>'discount_approved_by', '')::uuid, v_row.discount_approved_by);
  IF v_dir IS NOT NULL THEN
    SELECT su.full_name INTO v_dir_name FROM public.sales_users su
     WHERE su.id = v_dir AND su.company_id = v_row.company_id AND su.role = 'director';
    IF v_dir_name IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'bad_director', 'message', 'Discount approved by must be a director.'); END IF;
  END IF;

  v_f := to_jsonb(v_row) || v_in;
  IF v_agent IS DISTINCT FROM v_row.agent_id THEN
    v_f := v_f || jsonb_build_object('commission_standard_pct', public._saf_std_commission(v_row.company_id, v_row.project_id, v_agent));
    IF NOT (v_in ? 'commission_pct') THEN v_f := v_f - 'commission_pct'; END IF;
  END IF;
  IF (v_f->>'plan_type') IS DISTINCT FROM v_row.plan_type AND NOT (v_in ? 'discount_amount') THEN
    v_f := v_f - 'discount_amount';   -- a new plan starts from its own discount
  END IF;
  v_f := public._saf_compute(v_f);

  IF NOT COALESCE(p_commit, true) THEN
    RETURN jsonb_build_object('success', true, 'preview', true,
      'saf', v_f || jsonb_build_object('flags', public._saf_flags(v_f), 'problems', public._saf_problems(v_f)));
  END IF;

  UPDATE public.sale_approval_forms SET
    plan_type = v_f->>'plan_type', standard_discount_pct = (v_f->>'standard_discount_pct')::numeric,
    discount_amount = (v_f->>'discount_amount')::numeric, discount_pct = (v_f->>'discount_pct')::numeric,
    discount_reason = NULLIF(btrim(v_f->>'discount_reason'), ''),
    discount_approved_by = v_dir, discount_approved_by_name = v_dir_name,
    discount_beyond_standard = (v_f->>'discount_beyond_standard')::boolean,
    net_price = (v_f->>'net_price')::numeric, dp_pct = (v_f->>'dp_pct')::numeric, dp_amount = (v_f->>'dp_amount')::numeric,
    installment_count = (v_f->>'installment_count')::int, installment_amount = (v_f->>'installment_amount')::numeric,
    first_due_date = (v_f->>'first_due_date')::date,
    balloon_amount = (v_f->>'balloon_amount')::numeric, balloon_due_date = (v_f->>'balloon_due_date')::date,
    schedule_json = v_f->'schedule_json', sale_date = (v_f->>'sale_date')::date,
    buyer_name = NULLIF(btrim(v_f->>'buyer_name'), ''), buyer_relation = NULLIF(v_f->>'buyer_relation', ''),
    buyer_father = NULLIF(btrim(v_f->>'buyer_father'), ''), buyer_cnic = NULLIF(btrim(v_f->>'buyer_cnic'), ''),
    buyer_phone = NULLIF(btrim(v_f->>'buyer_phone'), ''), buyer_address = NULLIF(btrim(v_f->>'buyer_address'), ''),
    buyer_name_reason = NULLIF(btrim(v_f->>'buyer_name_reason'), ''),
    co_buyer = CASE WHEN jsonb_typeof(v_f->'co_buyer') = 'object' THEN v_f->'co_buyer' END,
    nominee  = CASE WHEN jsonb_typeof(v_f->'nominee')  = 'object' THEN v_f->'nominee'  END,
    dp_balance = (v_f->>'dp_balance')::numeric,
    agent_id = v_agent, agent_name = (SELECT a.full_name FROM public.agents a WHERE a.id = v_agent),
    sub_agent_name = NULLIF(btrim(v_f->>'sub_agent_name'), ''),
    commission_standard_pct = (v_f->>'commission_standard_pct')::numeric,
    commission_pct = (v_f->>'commission_pct')::numeric, commission_amount = (v_f->>'commission_amount')::numeric,
    commission_reason = NULLIF(btrim(v_f->>'commission_reason'), ''),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- submit: every required field, and the unit and money refreshed from source
CREATE OR REPLACE FUNCTION public.saf_submit(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_row public.sale_approval_forms;
        v_blk jsonb; v_m jsonb; v_f jsonb; v_p jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'not_draft'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_blk->>'unit_code');
  v_f := public._saf_compute(to_jsonb(v_row) || v_blk || jsonb_build_object('total_received', v_m->'total'));
  v_p := public._saf_problems(v_f);
  IF jsonb_array_length(v_p) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'incomplete', 'problems', v_p,
      'message', 'This form cannot be submitted yet: ' || (v_p->>0)); END IF;

  UPDATE public.sale_approval_forms SET
    status = 'submitted',
    unit_code = v_blk->>'unit_code', floor_label = v_blk->>'floor_label', block = v_blk->>'block',
    area_sqft = (v_blk->>'area_sqft')::numeric, rate_per_sqft = (v_blk->>'rate_per_sqft')::numeric,
    base_price = (v_blk->>'base_price')::numeric,
    net_price = (v_f->>'net_price')::numeric, dp_amount = (v_f->>'dp_amount')::numeric,
    discount_amount = (v_f->>'discount_amount')::numeric, discount_pct = (v_f->>'discount_pct')::numeric,
    discount_beyond_standard = (v_f->>'discount_beyond_standard')::boolean,
    installment_amount = (v_f->>'installment_amount')::numeric, schedule_json = v_f->'schedule_json',
    commission_amount = (v_f->>'commission_amount')::numeric,
    token_numbers = v_m->>'token_numbers', receipts = v_m->'receipts', total_received = (v_m->>'total')::numeric,
    dp_balance = (v_f->>'dp_balance')::numeric, money_as_of = now(),
    buyer_cnic = regexp_replace(public._saf_digits(buyer_cnic), '^(\d{5})(\d{7})(\d)$', '\1-\2-\3'),
    submitted_by = (c->>'user_id')::uuid, submitted_by_name = c->>'name', submitted_at = now(),
    updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- Accounts: the money on the form is the money in NexuFinance
CREATE OR REPLACE FUNCTION public.saf_verify(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_row public.sale_approval_forms; v_m jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF c->>'role' <> 'accounts' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Accounts verifies the money on a Sale Approval Form.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'submitted' THEN RETURN jsonb_build_object('success', false, 'error', 'not_submitted'); END IF;

  v_m := public._saf_money(v_row.company_id, v_row.unit_code);
  IF (v_m->>'total')::numeric IS DISTINCT FROM v_row.total_received OR v_m->'receipts' IS DISTINCT FROM v_row.receipts THEN
    -- NexuFinance moved since it was submitted: refresh the form, do not tick it
    UPDATE public.sale_approval_forms SET
      token_numbers = v_m->>'token_numbers', receipts = v_m->'receipts', total_received = (v_m->>'total')::numeric,
      dp_balance = dp_amount - (v_m->>'total')::numeric, money_as_of = now(), updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object('success', false, 'error', 'money_changed',
      'message', 'NexuFinance shows different money for this unit than when the form was submitted. The form now shows the current lines; check them and verify again.',
      'saf', public._saf_view(p_id));
  END IF;

  UPDATE public.sale_approval_forms SET status = 'verified',
    accounts_verified_by = (c->>'user_id')::uuid, accounts_verified_by_name = c->>'name', accounts_verified_at = now(),
    updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- Rashid: approve. Unit and money must still be what was verified.
CREATE OR REPLACE FUNCTION public.saf_approve(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_row public.sale_approval_forms;
        v_blk jsonb; v_m jsonb; v_snap jsonb; v_now timestamptz := now();
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'rashid')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Rashid approves a Sale Approval Form.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'verified' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_verified',
      'message', 'Accounts has to verify the money before this form can be approved.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_row.unit_id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_row.unit_code);
  IF (v_blk->>'base_price')::numeric IS DISTINCT FROM v_row.base_price
     OR (v_blk->>'area_sqft')::numeric IS DISTINCT FROM v_row.area_sqft THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_changed',
      'message', 'The unit''s price or area changed after this form was submitted. Supersede it with a new form.'); END IF;
  IF (v_m->>'total')::numeric IS DISTINCT FROM v_row.total_received OR v_m->'receipts' IS DISTINCT FROM v_row.receipts THEN
    RETURN jsonb_build_object('success', false, 'error', 'money_changed',
      'message', 'NexuFinance shows different money for this unit than Accounts verified. Send it back to Accounts.'); END IF;

  -- the old form this one replaces steps aside first, so the unit never has two
  IF v_row.supersedes_id IS NOT NULL THEN
    UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
     WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
  END IF;

  -- the snapshot is every field on the form at the moment of signing, the
  -- signature included. It is sealed in the same UPDATE that approves, while
  -- the row is still 'verified' — once approved, the lock lets nothing in.
  v_snap := (to_jsonb(v_row) || jsonb_build_object(
               'approved_by', c->>'user_id', 'approved_by_name', c->>'name', 'approved_at', v_now))
            - ARRAY['snapshot','snapshot_hash','pdf_sha256','sale_id','superseded_by','updated_at','status'];
  UPDATE public.sale_approval_forms SET status = 'approved',
    approved_by = (c->>'user_id')::uuid, approved_by_name = c->>'name', approved_at = v_now, updated_at = v_now,
    snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- reject, with a reason. Accounts may send back a submitted form; Rashid either.
CREATE OR REPLACE FUNCTION public.saf_reject(p_session_token text, p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_row public.sale_approval_forms;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required', 'message', 'Say why it is rejected.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF NOT ( ((c->>'rashid')::boolean AND v_row.status IN ('submitted','verified'))
        OR (c->>'role' = 'accounts' AND v_row.status = 'submitted') ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden',
      'message', 'You cannot reject this form at the ' || v_row.status || ' stage.'); END IF;
  UPDATE public.sale_approval_forms SET status = 'rejected',
    rejected_by = (c->>'user_id')::uuid, rejected_by_name = c->>'name', rejected_at = now(),
    reject_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- a draft that should not go on
CREATE OR REPLACE FUNCTION public.saf_cancel(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token);
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  UPDATE public.sale_approval_forms SET status = 'cancelled', updated_at = now()
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid AND status = 'draft';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_draft'); END IF;
  RETURN jsonb_build_object('success', true);
END $$;

-- any change to an approved (or rejected) deal: a new draft that will replace it
CREATE OR REPLACE FUNCTION public.saf_supersede(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_old public.sale_approval_forms;
        v_no int; v_id uuid; v_blk jsonb; v_m jsonb; v_f jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_old FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_old.status NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_supersedable',
      'message', 'Only an approved or rejected form can be superseded.'); END IF;
  IF v_old.sale_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_exists',
      'message', 'The sale has already been made from this form. Change the sale, not the form.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sale_approval_forms WHERE unit_id = v_old.unit_id AND status IN ('draft','submitted','verified')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'open_form_exists',
      'message', 'This unit already has a form in progress.'); END IF;

  v_blk := public._saf_unit_block(v_old.unit_id);
  v_m   := public._saf_money(v_old.company_id, v_blk->>'unit_code');
  v_f := public._saf_compute(to_jsonb(v_old) || v_blk || jsonb_build_object('total_received', v_m->'total'));

  INSERT INTO public.saf_counters (company_id, last_no) VALUES (v_old.company_id, 1)
  ON CONFLICT (company_id) DO UPDATE SET last_no = public.saf_counters.last_no + 1
  RETURNING last_no INTO v_no;

  INSERT INTO public.sale_approval_forms (
    company_id, project_id, unit_id, reservation_id, saf_no, status, supersedes_id,
    unit_code, floor_label, block, area_sqft, rate_per_sqft, base_price,
    plan_type, standard_discount_pct, discount_amount, discount_pct, discount_reason,
    discount_approved_by, discount_approved_by_name, discount_beyond_standard,
    net_price, dp_pct, dp_amount, installment_count, installment_amount, first_due_date,
    balloon_amount, balloon_due_date, schedule_json, sale_date,
    buyer_name, buyer_relation, buyer_father, buyer_cnic, buyer_phone, buyer_address,
    reservation_buyer_name, buyer_name_reason, co_buyer, nominee,
    token_numbers, receipts, total_received, dp_balance, money_as_of,
    agent_id, agent_name, sub_agent_name, commission_standard_pct, commission_pct, commission_reason, commission_amount,
    prepared_by, prepared_by_name, prepared_at)
  VALUES (
    v_old.company_id, v_old.project_id, v_old.unit_id,
    (SELECT r.id FROM public.reservations r WHERE r.unit_id = v_old.unit_id AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1),
    'SAF-' || lpad(v_no::text, 4, '0'), 'draft', v_old.id,
    v_blk->>'unit_code', v_blk->>'floor_label', v_blk->>'block', (v_blk->>'area_sqft')::numeric,
    (v_blk->>'rate_per_sqft')::numeric, (v_blk->>'base_price')::numeric,
    v_f->>'plan_type', (v_f->>'standard_discount_pct')::numeric, (v_f->>'discount_amount')::numeric,
    (v_f->>'discount_pct')::numeric, v_old.discount_reason, v_old.discount_approved_by, v_old.discount_approved_by_name,
    (v_f->>'discount_beyond_standard')::boolean,
    (v_f->>'net_price')::numeric, (v_f->>'dp_pct')::numeric, (v_f->>'dp_amount')::numeric,
    (v_f->>'installment_count')::int, (v_f->>'installment_amount')::numeric, (v_f->>'first_due_date')::date,
    (v_f->>'balloon_amount')::numeric, (v_f->>'balloon_due_date')::date, v_f->'schedule_json', (v_f->>'sale_date')::date,
    v_old.buyer_name, v_old.buyer_relation, v_old.buyer_father, v_old.buyer_cnic, v_old.buyer_phone, v_old.buyer_address,
    v_old.reservation_buyer_name, v_old.buyer_name_reason, v_old.co_buyer, v_old.nominee,
    v_m->>'token_numbers', v_m->'receipts', (v_m->>'total')::numeric, (v_f->>'dp_balance')::numeric, now(),
    v_old.agent_id, v_old.agent_name, v_old.sub_agent_name, v_old.commission_standard_pct,
    (v_f->>'commission_pct')::numeric, v_old.commission_reason, (v_f->>'commission_amount')::numeric,
    (c->>'user_id')::uuid, c->>'name', now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(v_id));
END $$;

CREATE OR REPLACE FUNCTION public.saf_get(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT public._saf_view(f.id) INTO v FROM public.sale_approval_forms f
   WHERE f.id = p_id AND f.company_id = (c->>'company_id')::uuid;
  IF v IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('success', true, 'saf', v,
    'me', jsonb_build_object('role', c->>'role', 'rashid', (c->>'rashid')::boolean, 'name', c->>'name'));
END $$;

-- the list, the counts for the badge, and what a new form needs to offer
CREATE OR REPLACE FUNCTION public.saf_list(p_session_token text, p_status text DEFAULT NULL,
                                          p_agent uuid DEFAULT NULL, p_floor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_co uuid;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  v_co := (c->>'company_id')::uuid;
  RETURN jsonb_build_object('success', true, 'enabled', public._saf_on(v_co),
    'me', jsonb_build_object('role', c->>'role', 'rashid', (c->>'rashid')::boolean, 'name', c->>'name'),
    'counts', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
                 FROM (SELECT status, count(*) n FROM public.sale_approval_forms WHERE company_id = v_co GROUP BY 1) s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'saf_no', f.saf_no, 'status', f.status, 'unit_code', f.unit_code, 'floor_label', f.floor_label,
               'buyer_name', f.buyer_name, 'agent_name', f.agent_name, 'net_price', f.net_price,
               'total_received', f.total_received, 'prepared_by_name', f.prepared_by_name, 'updated_at', f.updated_at,
               'sale_number', (SELECT s.sale_number FROM public.sales s WHERE s.id = f.sale_id),
               'flags', jsonb_array_length(public._saf_flags(to_jsonb(f))))
             ORDER BY f.updated_at DESC)
        FROM public.sale_approval_forms f
       WHERE f.company_id = v_co
         AND (p_status IS NULL OR f.status = p_status)
         AND (p_agent IS NULL OR f.agent_id = p_agent)
         AND (p_floor IS NULL OR f.floor_label = p_floor)), '[]'::jsonb),
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name,
                         'pct', public._saf_std_commission(v_co, a.project_id, a.id)) ORDER BY a.full_name)
                          FROM public.agents a WHERE a.company_id = v_co
                           AND COALESCE(a.status, 'active') NOT IN ('inactive','blocked')), '[]'::jsonb),
    'directors', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', su.id, 'name', su.full_name) ORDER BY su.full_name)
                             FROM public.sales_users su WHERE su.company_id = v_co AND su.role = 'director'), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', COALESCE(NULLIF(u.unit_code, ''), u.unit_no),
               'floor_label', u.floor_label, 'status', cs.status_name, 'buyer', r.client_name)
             ORDER BY u.floor_label, u.unit_no)
        FROM public.units u
        JOIN public.category_unit_statuses cs ON cs.id = u.status_id
        LEFT JOIN LATERAL (SELECT r2.client_name FROM public.reservations r2
                            WHERE r2.unit_id = u.id AND r2.status = 'active' ORDER BY r2.created_at DESC LIMIT 1) r ON true
       WHERE u.company_id = v_co
         AND cs.status_code IN ('SOLD_ENTRY_PENDING','HOLD','RESERVED','BOOKED','RESALE_REVIEW')
         AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = u.id AND s.status = 'active')), '[]'::jsonb));
END $$;

-- the PDF's fingerprint, recorded the first time; a re-print must match it
CREATE OR REPLACE FUNCTION public.saf_record_pdf(p_session_token text, p_id uuid, p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); v_row public.sale_approval_forms;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'role' IN ('director','accounts') OR (c->>'rashid')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND OR v_row.status NOT IN ('approved','superseded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_approved'); END IF;
  IF p_sha256 !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('success', false, 'error', 'bad_hash'); END IF;
  IF v_row.pdf_sha256 IS NULL THEN
    UPDATE public.sale_approval_forms SET pdf_sha256 = p_sha256 WHERE id = p_id;
    RETURN jsonb_build_object('success', true, 'first', true, 'identical', true);
  END IF;
  RETURN jsonb_build_object('success', true, 'first', false, 'identical', v_row.pdf_sha256 = p_sha256,
                            'recorded', v_row.pdf_sha256);
END $$;

-- ── 6. the sale, made from the form ─────────────────────────────────────────
-- Does the sale about to be written match an approved form for its unit?
CREATE OR REPLACE FUNCTION public._saf_match(p_unit uuid, p_sale jsonb, p_installments jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f public.sale_approval_forms; v_net numeric; v_bad text; v_cnic text;
BEGIN
  SELECT * INTO f FROM public.sale_approval_forms
   WHERE unit_id = p_unit AND status = 'approved' AND sale_id IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'saf_required',
      'message', 'This Awami unit has no approved Sale Approval Form. Prepare one, have Accounts verify it and Rashid approve it, then make the sale.');
  END IF;
  v_net := COALESCE((p_sale->>'price_per_sqft')::numeric, 0) * COALESCE((p_sale->>'area_sqft')::numeric, 0)
         - COALESCE((p_sale->>'discount')::numeric, 0);
  SELECT regexp_replace(COALESCE(cl.cnic, ''), '[^0-9]', '', 'g') INTO v_cnic
    FROM public.clients cl WHERE cl.id = NULLIF(p_sale->>'client_id', '')::uuid;

  v_bad := CASE
    WHEN abs(v_net - f.net_price) > 1 THEN 'net price ' || v_net || ' vs ' || f.net_price
    WHEN abs(COALESCE((p_sale->>'discount')::numeric, 0) - f.discount_amount) > 1 THEN 'discount'
    WHEN abs(COALESCE((p_sale->>'down_payment')::numeric, 0) - f.dp_amount) > 1 THEN 'down payment'
    WHEN NULLIF(p_sale->>'agent_id', '')::uuid IS DISTINCT FROM f.agent_id THEN 'agent'
    WHEN COALESCE(v_cnic, '') <> public._saf_digits(f.buyer_cnic) THEN 'buyer CNIC'
    WHEN NULLIF(p_sale->>'commission_rate', '') IS NOT NULL
         AND (p_sale->>'commission_rate')::numeric <> f.commission_pct THEN 'commission'
    WHEN jsonb_array_length(COALESCE(p_installments, '[]'::jsonb)) <> jsonb_array_length(f.schedule_json) THEN 'number of installments'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(f.schedule_json) s
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_installments) i
          WHERE (i->>'installment_number')::int = (s->>'installment_number')::int
            AND COALESCE(NULLIF(i->>'installment_type', ''), 'installment') = s->>'installment_type'
            AND NULLIF(i->>'due_date', '')::date = (s->>'due_date')::date
            AND abs((i->>'amount_due')::numeric - (s->>'amount_due')::numeric) <= 1)) THEN 'schedule'
    ELSE NULL END;
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'saf_mismatch',
      'message', 'This sale does not match approved ' || f.saf_no || ' (' || v_bad || ').');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', f.id, 'saf_no', f.saf_no, 'commission_pct', f.commission_pct);
END $$;

-- Rashid: make the sale from an approved form, with the form's numbers exactly
CREATE OR REPLACE FUNCTION public.saf_create_sale(p_session_token text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_ctx(p_session_token); f public.sale_approval_forms;
        v_client uuid; v_code text; v_res jsonb; v_inst int;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;
  IF NOT (c->>'rashid')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Rashid makes the sale from an approved form.'); END IF;
  SELECT * INTO f FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF f.status <> 'approved' OR f.sale_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_ready',
      'message', 'Only an approved form with no sale yet can be turned into a sale.'); END IF;

  -- the buyer: the same CNIC in this project is the same client
  SELECT id INTO v_client FROM public.clients
   WHERE company_id = f.company_id AND project_id = f.project_id
     AND regexp_replace(COALESCE(cnic, ''), '[^0-9]', '', 'g') = public._saf_digits(f.buyer_cnic) LIMIT 1;
  IF v_client IS NULL THEN
    v_code := public.generate_client_code(f.company_id, f.project_id);
    INSERT INTO public.clients (company_id, project_id, client_code, full_name, father_name, cnic, phone_primary,
                                address, country, status, overseas_local, next_of_kin_name, next_of_kin_relation,
                                next_of_kin_cnic, next_of_kin_phone, notes)
    VALUES (f.company_id, f.project_id, v_code, f.buyer_name, f.buyer_father, f.buyer_cnic, f.buyer_phone,
            f.buyer_address, 'Pakistan', 'active', 'local',
            f.nominee->>'name', f.nominee->>'relation', f.nominee->>'cnic', f.nominee->>'phone',
            'From ' || f.saf_no || ' (' || f.buyer_relation || ' ' || f.buyer_father || ')')
    RETURNING id INTO v_client;
  END IF;

  SELECT count(*) INTO v_inst FROM jsonb_array_elements(f.schedule_json) e
   WHERE e->>'installment_type' = 'installment';

  v_res := public._create_sale_with_schedule_core(
    jsonb_build_object(
      'company_id', f.company_id, 'project_id', f.project_id, 'unit_id', f.unit_id, 'client_id', v_client,
      'agent_id', f.agent_id, 'price_per_sqft', f.rate_per_sqft, 'area_sqft', f.area_sqft,
      'discount', f.discount_amount, 'down_payment', f.dp_amount, 'installment_count', v_inst,
      'sale_date', f.sale_date, 'commission_rate', f.commission_pct,
      'notes', 'Sale Approval Form ' || f.saf_no || ', approved by ' || f.approved_by_name),
    f.schedule_json);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;

  IF f.reservation_id IS NOT NULL THEN
    UPDATE public.reservations SET status = 'converted', converted_sale_id = (v_res->>'sale_id')::uuid, updated_at = now()
     WHERE id = f.reservation_id AND status = 'active';
  END IF;
  RETURN v_res || jsonb_build_object('saf_no', f.saf_no);
END $$;

-- ── 7. the hard links ───────────────────────────────────────────────────────
-- (a) every sale goes through _create_sale_with_schedule_core: for an Awami
--     unit it needs a matching approved SAF, and the sale remembers which.
--     Patched on the live body at fixed anchors; RAISES if one is missing.
DO $mig$
DECLARE v_def text; v_new text;
  a1 constant text := 'v_inst JSONB; v_sold_status_id UUID; v_commission_rate NUMERIC; v_commission_amt NUMERIC;';
  a2 constant text := '  PERFORM 1 FROM public.units WHERE id = v_unit_id FOR UPDATE;';
  a3 constant text := '  ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;';
  FUNCTION_NAME constant text := '_create_sale_with_schedule_core';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = FUNCTION_NAME;
  IF position('_saf_match' IN v_def) > 0 THEN RETURN; END IF;   -- already applied
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     OR (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1
     OR (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 THEN
    RAISE EXCEPTION 'an anchor is not exactly once in %', FUNCTION_NAME;
  END IF;
  v_new := replace(v_def, a1, a1 || E'\n  v_saf JSONB;');
  v_new := replace(v_new, a2, a2 || E'\n'
    || E'  -- 20261012a: an Awami sale needs an approved Sale Approval Form, and must match it\n'
    || E'  IF public._saf_on(v_company_id) THEN\n'
    || E'    v_saf := public._saf_match(v_unit_id, p_sale, p_installments);\n'
    || E'    IF NOT COALESCE((v_saf->>''ok'')::boolean, false) THEN\n'
    || E'      RETURN jsonb_build_object(''success'', false, ''error'', v_saf->>''error'', ''message'', v_saf->>''message'');\n'
    || E'    END IF;\n'
    || E'    v_commission_rate := COALESCE(v_commission_rate, (v_saf->>''commission_pct'')::numeric);\n'
    || E'  END IF;');
  v_new := replace(v_new, a3, a3 || E'\n'
    || E'  IF v_saf IS NOT NULL THEN\n'
    || E'    UPDATE public.sales SET saf_id = (v_saf->>''id'')::uuid WHERE id = v_sale_id;\n'
    || E'    UPDATE public.sale_approval_forms SET sale_id = v_sale_id, updated_at = now() WHERE id = (v_saf->>''id'')::uuid;\n'
    || E'  END IF;');
  EXECUTE v_new;
END
$mig$;

-- (b) Moving an Awami unit INTO a Sold status needs a buyer and a linked agent
--     on its active hold, or an approved SAF. Every path that writes the
--     column passes through here, direct SQL included. Moves into any other
--     status, and units already Sold, are not checked.
CREATE OR REPLACE FUNCTION public._saf_sold_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_code text; v_name text;
BEGIN
  IF NOT public._saf_on(NEW.company_id) THEN RETURN NEW; END IF;
  SELECT upper(status_code), status_name INTO v_code, v_name
    FROM public.category_unit_statuses WHERE id = NEW.status_id;
  IF v_code IS NULL OR v_code NOT IN ('SOLD_ENTRY_PENDING','SOLD','BOOKED') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.sale_approval_forms f WHERE f.unit_id = NEW.id AND f.status = 'approved') THEN
    RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.reservations r
              WHERE r.unit_id = NEW.id AND r.status = 'active'
                AND NULLIF(btrim(r.client_name), '') IS NOT NULL
                AND (r.requested_by_agent_id IS NOT NULL OR r.requested_by_sales_user_id IS NOT NULL)) THEN
    RETURN NEW; END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'sold_needs_buyer_and_agent',
    MESSAGE = 'Unit ' || COALESCE(NEW.unit_code, NEW.unit_no) || ' cannot be marked ' || v_name
           || ' without a buyer name and a linked agent on its hold, or an approved Sale Approval Form.';
END $$;
CREATE TRIGGER trg_saf_sold_guard BEFORE UPDATE OF status_id ON public.units
  FOR EACH ROW WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)
  EXECUTE FUNCTION public._saf_sold_guard();

-- ── 8. who may call what ────────────────────────────────────────────────────
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE '\_saf\_%' OR p.proname LIKE 'saf\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname NOT LIKE '\_%' THEN   -- the portal's doors: session token checked inside
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    END IF;
  END LOOP;
END
$g$;
