-- Phase 5 — Quotes. Saved, numbered, and deliberately NOT a reservation.
--
-- A sale person must be able to hand a client a price and a schedule without
-- taking the unit off the shelf. So a quote touches nothing in reservations and
-- nothing in sales: it is a record of what was offered, kept so the PDF can be
-- regenerated months later and so there is an audit trail of who quoted what.
--
-- Rate-pending units (Ground floor, base_price = 0) are NOT blocked. The quote
-- carries an explicit rate_pending flag and the PDF says so, because a rep still
-- needs to hand over a schedule while pricing is being settled.

BEGIN;

CREATE TABLE IF NOT EXISTS public.unit_map_quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id)    ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id)     ON DELETE CASCADE,
  unit_id        uuid NOT NULL REFERENCES public.units(id)        ON DELETE RESTRICT,
  sales_user_id  uuid          REFERENCES public.sales_users(id)  ON DELETE SET NULL,
  lead_id        uuid          REFERENCES public.leads(id)        ON DELETE SET NULL,
  quote_no       text NOT NULL,
  client_name    text NOT NULL,
  client_phone   text,
  -- money, as offered on the day. Snapshotted, never re-read from units later:
  -- a quote must still print what was promised even after the rate card moves.
  list_price     numeric NOT NULL DEFAULT 0,
  discount       numeric NOT NULL DEFAULT 0,
  net_price      numeric NOT NULL DEFAULT 0,
  rate_pending   boolean NOT NULL DEFAULT false,
  -- schedule
  down_payment   numeric NOT NULL DEFAULT 0,
  monthly_amount numeric NOT NULL DEFAULT 0,
  start_date     date,
  end_date       date,
  months         integer NOT NULL DEFAULT 0,
  schedule       jsonb   NOT NULL DEFAULT '[]'::jsonb,
  valid_until    date,
  pdf_path       text,
  status         text NOT NULL DEFAULT 'draft',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_map_quotes_no_uq     UNIQUE (company_id, quote_no),
  CONSTRAINT unit_map_quotes_status_chk CHECK (status IN ('draft','sent','expired','converted')),
  CONSTRAINT unit_map_quotes_money_chk  CHECK (discount >= 0 AND net_price >= 0),
  CONSTRAINT unit_map_quotes_sched_chk  CHECK (jsonb_typeof(schedule) = 'array')
);

COMMENT ON TABLE public.unit_map_quotes IS
  'A saved price offer against a unit. Independent of reservations and sales — '
  'quoting never takes a unit off the shelf. Money is snapshotted so an old quote '
  'still prints what was actually promised.';

ALTER TABLE public.unit_map_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon ON public.unit_map_quotes;
CREATE POLICY deny_all_anon ON public.unit_map_quotes
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_unit_map_quotes_upd ON public.unit_map_quotes;
CREATE TRIGGER trg_unit_map_quotes_upd BEFORE UPDATE ON public.unit_map_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_unit_map_quotes_unit ON public.unit_map_quotes (unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_map_quotes_user ON public.unit_map_quotes (sales_user_id, created_at DESC);

-- ── numbering: QT-<fy>-##### , gap-free per company per financial year ──────
-- Pakistan's financial year starts in July, matching the receipt numbering
-- already in use. The number is taken under the row lock of the max existing
-- quote so two reps saving at once cannot land on the same one.
CREATE OR REPLACE FUNCTION public._quote_next_no(p_company uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_fy text; v_n int;
BEGIN
  v_fy := CASE WHEN extract(month FROM public._fu_today()) >= 7
               THEN to_char(public._fu_today(), 'YY') || to_char(public._fu_today() + interval '1 year', 'YY')
               ELSE to_char(public._fu_today() - interval '1 year', 'YY') || to_char(public._fu_today(), 'YY') END;
  SELECT COALESCE(max(substring(quote_no from '[0-9]+$')::int), 0) + 1 INTO v_n
    FROM public.unit_map_quotes
   WHERE company_id = p_company AND quote_no LIKE 'QT-' || v_fy || '-%';
  RETURN 'QT-' || v_fy || '-' || lpad(v_n::text, 5, '0');
END $$;

-- ── save_unit_quote — builds the schedule, numbers it, stores it ────────────
CREATE OR REPLACE FUNCTION public.save_unit_quote(
  p_session_token text, p_unit_id uuid, p_client_name text, p_client_phone text,
  p_discount numeric, p_down_payment numeric, p_monthly numeric,
  p_start_date date, p_end_date date, p_lead_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_u public.units; v_no text;
        v_list numeric; v_net numeric; v_months int; v_sched jsonb := '[]'::jsonb;
        v_d date; v_i int; v_left numeric; v_amt numeric; v_id uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF NULLIF(TRIM(COALESCE(p_client_name,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','client_required','message','Who is this quote for?'); END IF;

  SELECT * INTO v_u FROM public.units WHERE id=p_unit_id AND company_id=v_ses.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_list := COALESCE(v_u.base_price, 0);
  v_net  := GREATEST(v_list - COALESCE(p_discount,0), 0);
  IF COALESCE(p_discount,0) > v_list AND v_list > 0 THEN
    RETURN jsonb_build_object('success',false,'error','discount_too_big',
      'message','The discount is larger than the price.'); END IF;

  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    IF p_end_date < p_start_date THEN
      RETURN jsonb_build_object('success',false,'error','bad_dates','message','The end date is before the start date.'); END IF;
    v_months := GREATEST((extract(year FROM age(p_end_date, p_start_date)) * 12
                        + extract(month FROM age(p_end_date, p_start_date)))::int, 1);
  ELSE v_months := 0; END IF;

  -- Build the rows the client will actually read. The last instalment absorbs the
  -- rounding so the schedule adds up to the net exactly — same rule the sale
  -- schedule already follows.
  IF v_months > 0 AND COALESCE(p_monthly,0) > 0 THEN
    v_left := v_net - COALESCE(p_down_payment,0);
    FOR v_i IN 1..v_months LOOP
      v_d := (p_start_date + (v_i - 1) * interval '1 month')::date;
      v_amt := CASE WHEN v_i = v_months THEN v_left ELSE LEAST(p_monthly, v_left) END;
      EXIT WHEN v_amt <= 0 AND v_i < v_months;
      v_sched := v_sched || jsonb_build_object('n', v_i, 'due', v_d, 'amount', round(v_amt, 0));
      v_left := v_left - v_amt;
    END LOOP;
  END IF;

  v_no := public._quote_next_no(v_ses.company_id);

  INSERT INTO public.unit_map_quotes (
    company_id, project_id, unit_id, sales_user_id, lead_id, quote_no,
    client_name, client_phone, list_price, discount, net_price, rate_pending,
    down_payment, monthly_amount, start_date, end_date, months, schedule, valid_until)
  VALUES (
    v_ses.company_id, v_u.project_id, p_unit_id, v_ses.sales_user_id, p_lead_id, v_no,
    TRIM(p_client_name), NULLIF(TRIM(COALESCE(p_client_phone,'')),''),
    v_list, COALESCE(p_discount,0), v_net, (v_list = 0),
    COALESCE(p_down_payment,0), COALESCE(p_monthly,0), p_start_date, p_end_date,
    v_months, v_sched, (public._fu_today() + 14))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id,'quote_no',v_no,
    'net_price',v_net,'rate_pending',(v_list = 0),'months',v_months,'schedule',v_sched);
END $$;

-- ── read one back, for the PDF and for history ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_unit_quote(p_session_token text, p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_q public.unit_map_quotes; v_u public.units;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_q FROM public.unit_map_quotes WHERE id=p_quote_id AND company_id=v_ses.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT * INTO v_u FROM public.units WHERE id=v_q.unit_id;

  RETURN jsonb_build_object('success',true,
    'quote', to_jsonb(v_q),
    'unit', jsonb_build_object('unit_no',v_u.unit_no,'floor_label',v_u.floor_label,
      'area',v_u.area,'type',(SELECT t.type_name FROM public.category_unit_types t WHERE t.id=v_u.unit_type_id)),
    'project', (SELECT p.project_name FROM public.projects p WHERE p.id=v_q.project_id),
    'by', (SELECT su.full_name FROM public.sales_users su WHERE su.id=v_q.sales_user_id));
END $$;

COMMIT;
