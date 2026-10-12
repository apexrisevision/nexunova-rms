-- ─────────────────────────────────────────────────────────────────────────────
-- SALE APPROVAL FORM MOVES TO THE RMS  (2026-10-13)
--
-- 20261012a put the SAF in the CRM portal. Rashid's call: it belongs in the
-- RMS, with a strict line of hands:
--
--   Accounts  (app_users role accounts/finance)   prepares and submits. Submit
--             is Accounts' word on the money: the NexuFinance lines are re-read
--             at that moment and Accounts' name goes on the form as verifier.
--   Director  (the RMS owner / admin login)        sees submitted forms only,
--             read-only, as the PDF, and approves — the digital signature: name,
--             time and the sealed sha256 printed on the form — or rejects with a
--             reason, back to Accounts.
--   Filing    (any RMS user with the 'saf_filing' tick in Users & Roles)
--             sees approved forms only, prints the PDF, marks the file done, and
--             makes the sale entry from the form — numbers locked to it.
--
-- Nobody else sees a form. The approved PDF is kept in rms-documents under the
-- company's own folder, its path and sha256 on the row; a re-print is checked
-- against that fingerprint.
--
-- What does NOT change: the table, the numbering, the snapshot seal and lock,
-- _create_sale_with_schedule_core's saf_required / saf_mismatch rule, the Sold
-- guard on units, and the company flag. The CRM portal's SAF doors are dropped.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. the portal's doors go ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.saf_new(text, uuid);
DROP FUNCTION IF EXISTS public.saf_save(text, uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.saf_submit(text, uuid);
DROP FUNCTION IF EXISTS public.saf_verify(text, uuid);
DROP FUNCTION IF EXISTS public.saf_approve(text, uuid);
DROP FUNCTION IF EXISTS public.saf_reject(text, uuid, text);
DROP FUNCTION IF EXISTS public.saf_cancel(text, uuid);
DROP FUNCTION IF EXISTS public.saf_supersede(text, uuid);
DROP FUNCTION IF EXISTS public.saf_get(text, uuid);
DROP FUNCTION IF EXISTS public.saf_list(text, text, uuid, text);
DROP FUNCTION IF EXISTS public.saf_record_pdf(text, uuid, text);
DROP FUNCTION IF EXISTS public.saf_create_sale(text, uuid);
DROP FUNCTION IF EXISTS public._saf_ctx(text);

-- ── 2. the people on the form are RMS users now ─────────────────────────────
-- discount_approved_by stays a CRM director, because that is where Awami's
-- three directors are.
ALTER TABLE public.sale_approval_forms
  DROP CONSTRAINT IF EXISTS sale_approval_forms_prepared_by_fkey,
  DROP CONSTRAINT IF EXISTS sale_approval_forms_submitted_by_fkey,
  DROP CONSTRAINT IF EXISTS sale_approval_forms_accounts_verified_by_fkey,
  DROP CONSTRAINT IF EXISTS sale_approval_forms_approved_by_fkey,
  DROP CONSTRAINT IF EXISTS sale_approval_forms_rejected_by_fkey;
-- A form started in the CRM before this (SAF-0001, FF-103, a draft Rashid
-- opened on 2026-10-12) points at a CRM login. Its names stay exactly as they
-- are; only the link to the CRM user is cleared, so the RMS link can be added.
-- Only drafts exist, so the lock is not involved.
UPDATE public.sale_approval_forms f SET
  prepared_by          = CASE WHEN EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = f.prepared_by)          THEN prepared_by END,
  submitted_by         = CASE WHEN EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = f.submitted_by)         THEN submitted_by END,
  accounts_verified_by = CASE WHEN EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = f.accounts_verified_by) THEN accounts_verified_by END,
  approved_by          = CASE WHEN EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = f.approved_by)          THEN approved_by END,
  rejected_by          = CASE WHEN EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = f.rejected_by)          THEN rejected_by END
WHERE f.status NOT IN ('approved','superseded');
DO $chk$ BEGIN
  IF EXISTS (SELECT 1 FROM public.sale_approval_forms WHERE status IN ('approved','superseded')) THEN
    RAISE EXCEPTION 'an approved SAF exists from the CRM; stop and decide how its signature moves to the RMS';
  END IF;
END $chk$;
ALTER TABLE public.sale_approval_forms
  ADD CONSTRAINT sale_approval_forms_prepared_by_fkey         FOREIGN KEY (prepared_by)          REFERENCES public.app_users(id),
  ADD CONSTRAINT sale_approval_forms_submitted_by_fkey        FOREIGN KEY (submitted_by)         REFERENCES public.app_users(id),
  ADD CONSTRAINT sale_approval_forms_accounts_verified_by_fkey FOREIGN KEY (accounts_verified_by) REFERENCES public.app_users(id),
  ADD CONSTRAINT sale_approval_forms_approved_by_fkey         FOREIGN KEY (approved_by)          REFERENCES public.app_users(id),
  ADD CONSTRAINT sale_approval_forms_rejected_by_fkey         FOREIGN KEY (rejected_by)          REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS filed_by      uuid REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS filed_by_name text,
  ADD COLUMN IF NOT EXISTS filed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_path      text;

-- the lock: filing, the stored PDF and the sale may still be recorded on an
-- approved form, each once; nothing else moves
CREATE OR REPLACE FUNCTION public._saf_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE c_free constant text[] := ARRAY['status','superseded_by','sale_id','pdf_sha256','pdf_path',
                                        'filed_by','filed_by_name','filed_at','updated_at'];
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
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256)
     OR (OLD.pdf_path   IS NOT NULL AND NEW.pdf_path   IS DISTINCT FROM OLD.pdf_path)
     OR (OLD.filed_at   IS NOT NULL AND (NEW.filed_at IS DISTINCT FROM OLD.filed_at
                                          OR NEW.filed_by IS DISTINCT FROM OLD.filed_by)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'saf_locked',
      MESSAGE = 'Sale Approval Form ' || OLD.saf_no || ' is ' || OLD.status
             || '. Any change needs a new SAF that supersedes it.';
  END IF;
  RETURN NEW;
END $$;

-- ── 3. who is calling, and what may they do ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._saf_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL OR COALESCE(v_me.status, 'active') <> 'active' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'user_id', v_me.id, 'company_id', v_me.company_id, 'role', v_me.role, 'name', v_me.full_name,
    'prepare', v_me.role IN ('accounts','finance'),
    'approve', v_me.role IN ('owner','admin'),
    'filing',  COALESCE((v_me.module_permissions->>'saf_filing')::boolean, false),
    'enabled', public._saf_on(v_me.company_id));
END $$;

-- a form this caller may see at all
CREATE OR REPLACE FUNCTION public._saf_visible(p_me jsonb, p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((p_me->>'prepare')::boolean, false)                                         -- Accounts: every form
      OR (COALESCE((p_me->>'approve')::boolean, false) AND p_status NOT IN ('draft','cancelled')) -- director: from submit on
      OR (COALESCE((p_me->>'filing')::boolean, false)  AND p_status IN ('approved','superseded'));-- filing: approved only
$$;

-- ── 4. the doors (RMS session: _rms_caller) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.saf_new(p_unit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_u public.units; v_r public.reservations;
        v_id uuid; v_no int; v_blk jsonb; v_m jsonb; v_agent uuid; v_f jsonb; v_open uuid;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Accounts prepares a Sale Approval Form.'); END IF;
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

CREATE OR REPLACE FUNCTION public.saf_save(p_id uuid, p_input jsonb, p_commit boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms;
        v_in jsonb := public._saf_inputs(p_input); v_f jsonb; v_agent uuid; v_dir uuid; v_dir_name text;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_draft',
      'message', 'Only a draft can be changed. This form is ' || v_row.status || '.'); END IF;

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
    v_f := v_f - 'discount_amount';
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

-- Accounts submits: every required field, unit and money re-read now, and
-- Accounts' name goes on as the one who confirmed the money. Straight to the
-- director.
CREATE OR REPLACE FUNCTION public.saf_submit(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms; v_blk jsonb; v_m jsonb; v_f jsonb; v_p jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
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
    accounts_verified_by = (c->>'user_id')::uuid, accounts_verified_by_name = c->>'name', accounts_verified_at = now(),
    updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- the director: approve = the digital signature. Unit and money must still be
-- what Accounts submitted; the whole form is sealed with its sha256.
CREATE OR REPLACE FUNCTION public.saf_approve(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms;
        v_blk jsonb; v_m jsonb; v_snap jsonb; v_now timestamptz := now();
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'approve')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only the director approves a Sale Approval Form.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted',
      'message', 'Only a form Accounts has submitted can be approved.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_row.unit_id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_row.unit_code);
  IF (v_blk->>'base_price')::numeric IS DISTINCT FROM v_row.base_price
     OR (v_blk->>'area_sqft')::numeric IS DISTINCT FROM v_row.area_sqft THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_changed',
      'message', 'The unit''s price or area changed after Accounts submitted this form. Reject it so Accounts can make a new one.'); END IF;
  IF (v_m->>'total')::numeric IS DISTINCT FROM v_row.total_received OR v_m->'receipts' IS DISTINCT FROM v_row.receipts THEN
    RETURN jsonb_build_object('success', false, 'error', 'money_changed',
      'message', 'NexuFinance shows different money for this unit than Accounts submitted. Reject it so Accounts can check and resubmit.'); END IF;

  IF v_row.supersedes_id IS NOT NULL THEN
    UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
     WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
  END IF;

  v_snap := (to_jsonb(v_row) || jsonb_build_object(
               'approved_by', c->>'user_id', 'approved_by_name', c->>'name', 'approved_at', v_now))
            - ARRAY['snapshot','snapshot_hash','pdf_sha256','pdf_path','sale_id','superseded_by','updated_at','status',
                    'filed_by','filed_by_name','filed_at'];
  UPDATE public.sale_approval_forms SET status = 'approved',
    approved_by = (c->>'user_id')::uuid, approved_by_name = c->>'name', approved_at = v_now, updated_at = v_now,
    snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- the director sends it back, with a reason
CREATE OR REPLACE FUNCTION public.saf_reject(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'approve')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required', 'message', 'Say why it is rejected.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted'); END IF;
  UPDATE public.sale_approval_forms SET status = 'rejected',
    rejected_by = (c->>'user_id')::uuid, rejected_by_name = c->>'name', rejected_at = now(),
    reject_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

CREATE OR REPLACE FUNCTION public.saf_cancel(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me();
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  UPDATE public.sale_approval_forms SET status = 'cancelled', updated_at = now()
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid AND status = 'draft';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_draft'); END IF;
  RETURN jsonb_build_object('success', true);
END $$;

-- Accounts redoes a rejected (or changes an approved) form: a new draft that
-- will replace it once the director approves the new one
CREATE OR REPLACE FUNCTION public.saf_supersede(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_old public.sale_approval_forms;
        v_no int; v_id uuid; v_blk jsonb; v_m jsonb; v_f jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_old FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_old.status NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_supersedable',
      'message', 'Only an approved or rejected form can be redone.'); END IF;
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

CREATE OR REPLACE FUNCTION public.saf_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v jsonb; v_status text;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  SELECT status INTO v_status FROM public.sale_approval_forms WHERE id = p_id AND company_id = (c->>'company_id')::uuid;
  IF v_status IS NULL OR NOT public._saf_visible(c, v_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  v := public._saf_view(p_id);
  RETURN jsonb_build_object('success', true, 'saf', v, 'me', c);
END $$;

-- the list each person sees: Accounts everything, the director from submit
-- on, filing the approved ones; plus counts for the sidebar badge
CREATE OR REPLACE FUNCTION public.saf_list(p_status text DEFAULT NULL, p_agent uuid DEFAULT NULL, p_floor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_co uuid;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT ((c->>'prepare')::boolean OR (c->>'approve')::boolean OR (c->>'filing')::boolean) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  v_co := (c->>'company_id')::uuid;
  RETURN jsonb_build_object('success', true, 'enabled', public._saf_on(v_co), 'me', c,
    'waiting', jsonb_build_object(
       'director', (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status IN ('submitted','verified')),
       'filing',   (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status = 'approved' AND (filed_at IS NULL OR sale_id IS NULL)),
       'accounts', (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status IN ('draft','rejected'))),
    'counts', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (
                 SELECT status, count(*) n FROM public.sale_approval_forms
                  WHERE company_id = v_co AND public._saf_visible(c, status) GROUP BY 1) s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'saf_no', f.saf_no, 'status', f.status, 'unit_code', f.unit_code, 'floor_label', f.floor_label,
               'buyer_name', f.buyer_name, 'agent_name', f.agent_name, 'net_price', f.net_price,
               'total_received', f.total_received, 'prepared_by_name', f.prepared_by_name, 'updated_at', f.updated_at,
               'approved_at', f.approved_at, 'filed_at', f.filed_at,
               'sale_number', (SELECT s.sale_number FROM public.sales s WHERE s.id = f.sale_id),
               'flags', jsonb_array_length(public._saf_flags(to_jsonb(f))))
             ORDER BY f.updated_at DESC)
        FROM public.sale_approval_forms f
       WHERE f.company_id = v_co AND public._saf_visible(c, f.status)
         AND (p_status IS NULL OR f.status = p_status)
         AND (p_agent IS NULL OR f.agent_id = p_agent)
         AND (p_floor IS NULL OR f.floor_label = p_floor)), '[]'::jsonb),
    'agents', CASE WHEN (c->>'prepare')::boolean THEN COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name) ORDER BY a.full_name)
                   FROM public.agents a WHERE a.company_id = v_co
                    AND COALESCE(a.status, 'active') NOT IN ('inactive','blocked')), '[]'::jsonb) ELSE '[]'::jsonb END,
    'directors', CASE WHEN (c->>'prepare')::boolean THEN COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', su.id, 'name', su.full_name) ORDER BY su.full_name)
                   FROM public.sales_users su WHERE su.company_id = v_co AND su.role = 'director'), '[]'::jsonb) ELSE '[]'::jsonb END,
    'units', CASE WHEN (c->>'prepare')::boolean THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', COALESCE(NULLIF(u.unit_code, ''), u.unit_no),
               'floor_label', u.floor_label, 'status', cs.status_name, 'buyer', r.client_name)
             ORDER BY u.floor_label, u.unit_no)
        FROM public.units u
        JOIN public.category_unit_statuses cs ON cs.id = u.status_id
        LEFT JOIN LATERAL (SELECT r2.client_name FROM public.reservations r2
                            WHERE r2.unit_id = u.id AND r2.status = 'active' ORDER BY r2.created_at DESC LIMIT 1) r ON true
       WHERE u.company_id = v_co
         AND cs.status_code IN ('SOLD_ENTRY_PENDING','HOLD','RESERVED','BOOKED','RESALE_REVIEW')
         AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = u.id AND s.status = 'active')), '[]'::jsonb)
              ELSE '[]'::jsonb END);
END $$;

-- the approved PDF, kept: its fingerprint and where it lies, recorded once;
-- a later print is compared with the first
CREATE OR REPLACE FUNCTION public.saf_record_pdf(p_id uuid, p_sha256 text, p_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'approved' OR NOT public._saf_visible(c, v_row.status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_approved'); END IF;
  IF p_sha256 !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('success', false, 'error', 'bad_hash'); END IF;
  IF p_path IS NOT NULL AND split_part(p_path, '/', 1) <> (c->>'company_id') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_path'); END IF;
  IF v_row.pdf_sha256 IS NULL THEN
    UPDATE public.sale_approval_forms SET pdf_sha256 = p_sha256, pdf_path = COALESCE(p_path, pdf_path) WHERE id = p_id;
    RETURN jsonb_build_object('success', true, 'first', true, 'identical', true);
  END IF;
  IF v_row.pdf_path IS NULL AND p_path IS NOT NULL AND v_row.pdf_sha256 = p_sha256 THEN
    UPDATE public.sale_approval_forms SET pdf_path = p_path WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'first', false, 'identical', v_row.pdf_sha256 = p_sha256,
                            'recorded', v_row.pdf_sha256);
END $$;

-- filing: the PDF is printed and the paper file made
CREATE OR REPLACE FUNCTION public.saf_mark_filed(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'filing')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Filing marks a Sale Approval Form as filed.'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'approved' THEN RETURN jsonb_build_object('success', false, 'error', 'not_approved'); END IF;
  IF v_row.filed_at IS NOT NULL THEN RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id)); END IF;
  UPDATE public.sale_approval_forms SET filed_by = (c->>'user_id')::uuid, filed_by_name = c->>'name', filed_at = now(), updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- filing: the sale entry, made from the approved form exactly
CREATE OR REPLACE FUNCTION public.saf_create_sale(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); f public.sale_approval_forms;
        v_client uuid; v_code text; v_res jsonb; v_inst int;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'filing')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Only Filing makes the sale from an approved form.'); END IF;
  SELECT * INTO f FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF f.status <> 'approved' OR f.sale_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_ready',
      'message', 'Only an approved form with no sale yet can be turned into a sale.'); END IF;
  IF f.filed_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_filed',
      'message', 'Print the approved PDF and mark the file done first.'); END IF;

  SELECT id INTO v_client FROM public.clients
   WHERE company_id = f.company_id AND project_id = f.project_id
     AND regexp_replace(COALESCE(cnic, ''), '[^0-9]', '', 'g') = public._saf_digits(f.buyer_cnic) LIMIT 1;
  IF v_client IS NULL THEN
    v_code := public.generate_client_code(f.company_id, f.project_id);
    INSERT INTO public.clients (company_id, project_id, client_code, full_name, father_name, cnic, phone_primary,
                                address, country, status, overseas_local, next_of_kin_name, next_of_kin_relation,
                                next_of_kin_cnic, next_of_kin_phone, notes, created_by)
    VALUES (f.company_id, f.project_id, v_code, f.buyer_name, f.buyer_father, f.buyer_cnic, f.buyer_phone,
            f.buyer_address, 'Pakistan', 'active', 'local',
            f.nominee->>'name', f.nominee->>'relation', f.nominee->>'cnic', f.nominee->>'phone',
            'From ' || f.saf_no || ' (' || f.buyer_relation || ' ' || f.buyer_father || ')', (c->>'user_id')::uuid)
    RETURNING id INTO v_client;
  END IF;

  SELECT count(*) INTO v_inst FROM jsonb_array_elements(f.schedule_json) e WHERE e->>'installment_type' = 'installment';
  v_res := public._create_sale_with_schedule_core(
    jsonb_build_object(
      'company_id', f.company_id, 'project_id', f.project_id, 'unit_id', f.unit_id, 'client_id', v_client,
      'agent_id', f.agent_id, 'price_per_sqft', f.rate_per_sqft, 'area_sqft', f.area_sqft,
      'discount', f.discount_amount, 'down_payment', f.dp_amount, 'installment_count', v_inst,
      'sale_date', f.sale_date, 'commission_rate', f.commission_pct, 'created_by', c->>'user_id',
      'notes', 'Sale Approval Form ' || f.saf_no || ', approved by ' || f.approved_by_name),
    f.schedule_json);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;

  IF f.reservation_id IS NOT NULL THEN
    UPDATE public.reservations SET status = 'converted', converted_sale_id = (v_res->>'sale_id')::uuid, updated_at = now()
     WHERE id = f.reservation_id AND status = 'active';
  END IF;
  RETURN v_res || jsonb_build_object('saf_no', f.saf_no);
END $$;

-- ── 5. who may call what: RMS logins only ───────────────────────────────────
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE '\_saf\_%' OR p.proname LIKE 'saf\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname NOT LIKE '\_%' THEN   -- the doors: _rms_caller() decides inside
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END
$g$;
