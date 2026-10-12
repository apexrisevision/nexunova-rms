-- ─────────────────────────────────────────────────────────────────────────────
-- SALE APPROVAL: A DISCOUNT GOES TO A DIRECTOR, WHO SIGNS IN THE DIRECTORS'
-- ROOM WITH THEIR OWN APPROVAL PASSWORD  (2026-10-13)
--
-- Rashid's rule, in his words made plain:
--   · Accounts submits. If the price is the list price (no discount), the form
--     is approved by that fact and goes straight to Filing.
--     approval_route = 'plan'.
--   · If any discount was given (net price below the list price), the form
--     waits for a director in the Directors' Room on the reservation link.
--     approval_route = 'director'.
--   · The director approves -> Filing, at the approved price; or declines
--     with a reason -> back to Accounts with that reason.
--   · Approving or declining asks the director's OWN approval password. The
--     system knows from the password which director it is. There are three:
--     Syed Yousaf Shah, Naeem Hussain, Rashid Manzoor.
--   · Each director sets their own approval password once, proving who they
--     are with their CRM mobile + PIN; nobody else ever sees it. Stored as a
--     bcrypt hash; no two directors may share one; 5 wrong tries in 15
--     minutes and signing stops for 15 minutes.
--
-- The room password only READS the list. Signing is always a person.
-- The desk's own approval doors (20261013b) are dropped: one place to sign.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sale_approval_forms
  ADD COLUMN IF NOT EXISTS approval_route text CHECK (approval_route IN ('plan','director'));

-- ── 1. the three who may sign, and their passwords ──────────────────────────
CREATE TABLE IF NOT EXISTS public.saf_approvers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  sales_user_id  uuid NOT NULL UNIQUE REFERENCES public.sales_users(id),
  display_name   text NOT NULL,
  password_hash  text,
  password_set_at timestamptz,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saf_approvers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saf_approvers FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.saf_sign_attempts (
  id         bigserial PRIMARY KEY,
  company_id uuid NOT NULL,
  ok         boolean NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saf_sign_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saf_sign_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.saf_sign_attempts_id_seq FROM PUBLIC, anon, authenticated;

INSERT INTO public.saf_approvers (company_id, sales_user_id, display_name) VALUES
  ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce', '908fe0b1-4270-4982-bae0-ec41f4281f3a', 'Syed Yousaf Shah'),
  ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce', '67f8f136-802a-4235-8785-c9151f666644', 'Naeem Hussain'),
  ('96d210e7-e63b-4ef0-b1d0-74e622eac7ce', '015effd0-7ac7-4939-a1b3-dd2826ab8fba', 'Rashid Manzoor')
ON CONFLICT (sales_user_id) DO NOTHING;

ALTER TABLE public.sale_approval_forms
  ADD COLUMN IF NOT EXISTS approved_by_approver uuid REFERENCES public.saf_approvers(id),
  ADD COLUMN IF NOT EXISTS rejected_by_approver uuid REFERENCES public.saf_approvers(id);

-- ── 2. the desk's doors go: the Directors' Room is the one place to sign ────
DROP FUNCTION IF EXISTS public.saf_desk_list(text);
DROP FUNCTION IF EXISTS public.saf_desk_get(text, uuid);
DROP FUNCTION IF EXISTS public.saf_desk_approve(text, uuid);
DROP FUNCTION IF EXISTS public.saf_desk_reject(text, uuid, text);
DROP FUNCTION IF EXISTS public._saf_desk(text);

-- ── 3. submit routes the form ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.saf_submit(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms; v_blk jsonb; v_m jsonb; v_f jsonb; v_p jsonb;
        v_full boolean; v_now timestamptz := now(); v_snap jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'not_draft'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_row.unit_id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold', 'message', 'This unit already has an active sale.'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_blk->>'unit_code');
  v_f := public._saf_compute(to_jsonb(v_row) || v_blk || jsonb_build_object('total_received', v_m->'total'));
  v_p := public._saf_problems(v_f);
  IF jsonb_array_length(v_p) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'incomplete', 'problems', v_p,
      'message', 'This form cannot be submitted yet: ' || (v_p->>0)); END IF;
  -- the rule: any discount (net price below the list price) needs a director
  v_full := COALESCE((v_f->>'discount_amount')::numeric, 0) <= 0
        AND COALESCE((v_f->>'net_price')::numeric, 0) >= COALESCE((v_blk->>'base_price')::numeric, 0);

  UPDATE public.sale_approval_forms SET
    status = 'submitted', approval_route = CASE WHEN v_full THEN 'plan' ELSE 'director' END,
    unit_code = v_blk->>'unit_code', floor_label = v_blk->>'floor_label', block = v_blk->>'block',
    area_sqft = (v_blk->>'area_sqft')::numeric, rate_per_sqft = (v_blk->>'rate_per_sqft')::numeric,
    base_price = (v_blk->>'base_price')::numeric,
    net_price = (v_f->>'net_price')::numeric, dp_amount = (v_f->>'dp_amount')::numeric,
    discount_amount = (v_f->>'discount_amount')::numeric, discount_pct = (v_f->>'discount_pct')::numeric,
    discount_beyond_standard = (v_f->>'discount_beyond_standard')::boolean,
    installment_amount = (v_f->>'installment_amount')::numeric, schedule_json = v_f->'schedule_json',
    commission_amount = (v_f->>'commission_amount')::numeric,
    token_numbers = v_m->>'token_numbers', receipts = v_m->'receipts', total_received = (v_m->>'total')::numeric,
    dp_balance = (v_f->>'dp_balance')::numeric, money_as_of = v_now,
    buyer_cnic = regexp_replace(public._saf_digits(buyer_cnic), '^(\d{5})(\d{7})(\d)$', '\1-\2-\3'),
    submitted_by = (c->>'user_id')::uuid, submitted_by_name = c->>'name', submitted_at = v_now,
    accounts_verified_by = (c->>'user_id')::uuid, accounts_verified_by_name = c->>'name', accounts_verified_at = v_now,
    updated_at = v_now
  WHERE id = p_id;

  -- full price: approved by that fact, sealed now, on to Filing
  IF v_full THEN
    SELECT * INTO v_row FROM public.sale_approval_forms WHERE id = p_id;
    IF v_row.supersedes_id IS NOT NULL THEN
      UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
       WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
    END IF;
    v_snap := (to_jsonb(v_row) || jsonb_build_object('approved_at', v_now))
              - ARRAY['snapshot','snapshot_hash','pdf_sha256','pdf_path','sale_id','superseded_by','updated_at','status',
                      'filed_by','filed_by_name','filed_at'];
    UPDATE public.sale_approval_forms SET status = 'approved', approved_at = v_now, updated_at = v_now,
      snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
    WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- The director's signature is the discount approval, so Accounts no longer
-- types a director's name in "Discount approved by".
DO $p$
DECLARE v_def text;
        v_a text := E'  IF COALESCE((f->>''discount_beyond_standard'')::boolean, false) AND NULLIF(f->>''discount_approved_by'', '''') IS NULL THEN\n'
                 || E'    p := p || ''"A discount beyond the plan needs a director''''s name in Discount approved by."''; END IF;\n';
BEGIN
  v_def := pg_get_functiondef('public._saf_problems(jsonb)'::regprocedure);
  IF position('discount_approved_by' IN v_def) = 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 THEN
    RAISE EXCEPTION '_saf_problems discount_approved_by anchor not found exactly once'; END IF;
  EXECUTE replace(v_def, v_a, '');
END
$p$;

-- the sale's note says how it was approved
DO $p$
DECLARE v_def text; v_a text := $a$'notes', 'Sale Approval Form ' || f.saf_no || ', approved by ' || f.approved_by_name),$a$;
BEGIN
  v_def := pg_get_functiondef('public.saf_create_sale(uuid)'::regprocedure);
  IF position('approval_route' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 THEN
    RAISE EXCEPTION 'saf_create_sale notes anchor not found exactly once'; END IF;
  EXECUTE replace(v_def, v_a,
    $b$'notes', 'Sale Approval Form ' || f.saf_no || CASE WHEN f.approval_route = 'plan' THEN ', at the list price (no director approval needed)' ELSE ', approved by ' || f.approved_by_name END),$b$);
END
$p$;

-- ── 4. the Directors' Room: the room password reads ─────────────────────────
CREATE OR REPLACE FUNCTION public._saf_room(p_token text, p_password text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_link public.availability_links; v_hash text; v_tries int;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_tries FROM public.availability_report_attempts
   WHERE link_id = v_link.id AND NOT ok AND at > now() - interval '1 hour';
  IF v_tries >= 10 THEN RETURN NULL; END IF;
  SELECT report_password_hash INTO v_hash FROM public.projects WHERE id = v_link.project_id;
  IF v_hash IS NULL OR v_hash <> public._availability_secret_hash(v_link.project_id, p_password) THEN
    INSERT INTO public.availability_report_attempts (link_id, ok) VALUES (v_link.id, false);
    RETURN NULL; END IF;
  IF NOT public._saf_on(v_link.company_id) THEN RETURN NULL; END IF;
  RETURN v_link.company_id;
END $$;

CREATE OR REPLACE FUNCTION public.saf_room_list(p_token text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public._saf_room(p_token, p_password);
BEGIN
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  RETURN jsonb_build_object('success', true,
    'waiting', (SELECT count(*) FROM public.sale_approval_forms WHERE company_id = v_co AND status IN ('submitted','verified')),
    'approvers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', a.display_name, 'has_password', a.password_hash IS NOT NULL)
                                            ORDER BY a.display_name)
                             FROM public.saf_approvers a WHERE a.company_id = v_co AND a.active), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'saf_no', f.saf_no, 'status', f.status, 'unit_code', f.unit_code, 'floor_label', f.floor_label,
               'buyer_name', f.buyer_name, 'agent_name', f.agent_name, 'net_price', f.net_price, 'base_price', f.base_price,
               'discount_amount', f.discount_amount,
               'total_received', f.total_received, 'prepared_by_name', f.prepared_by_name,
               'submitted_at', f.submitted_at, 'approved_at', f.approved_at, 'approved_by_name', f.approved_by_name,
               'rejected_at', f.rejected_at, 'rejected_by_name', f.rejected_by_name,
               'filed_at', f.filed_at, 'reject_reason', f.reject_reason, 'approval_route', f.approval_route,
               'sale_number', (SELECT s.sale_number FROM public.sales s WHERE s.id = f.sale_id),
               'flags', jsonb_array_length(public._saf_flags(to_jsonb(f))))
             ORDER BY (f.status IN ('submitted','verified')) DESC, COALESCE(f.submitted_at, f.updated_at) DESC)
        FROM public.sale_approval_forms f
       WHERE f.company_id = v_co
         AND (f.status IN ('submitted','verified')
              OR (f.approval_route = 'director' AND f.status IN ('approved','rejected','superseded')
                  AND f.updated_at > now() - interval '60 days'))), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.saf_room_get(p_token text, p_password text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public._saf_room(p_token, p_password); v_status text;
BEGIN
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT status INTO v_status FROM public.sale_approval_forms WHERE id = p_id AND company_id = v_co;
  IF v_status IS NULL OR v_status IN ('draft','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- ── 5. who is signing: the approval password says which director ───────────
CREATE OR REPLACE FUNCTION public._saf_signer(p_company uuid, p_sign text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_a public.saf_approvers; v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.saf_sign_attempts
   WHERE company_id = p_company AND NOT ok AND at > now() - interval '15 minutes';
  IF v_bad >= 5 THEN RETURN jsonb_build_object('error', 'too_many'); END IF;
  IF NULLIF(p_sign, '') IS NOT NULL THEN
    SELECT a.* INTO v_a FROM public.saf_approvers a
     WHERE a.company_id = p_company AND a.active AND a.password_hash IS NOT NULL
       AND a.password_hash = extensions.crypt(p_sign, a.password_hash)
     LIMIT 1;
  END IF;
  INSERT INTO public.saf_sign_attempts (company_id, ok) VALUES (p_company, v_a.id IS NOT NULL);
  IF v_a.id IS NULL THEN RETURN jsonb_build_object('error', 'wrong_password'); END IF;
  RETURN jsonb_build_object('approver_id', v_a.id, 'sales_user_id', v_a.sales_user_id, 'name', v_a.display_name);
END $$;

CREATE OR REPLACE FUNCTION public._saf_sign_error(s jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('success', false, 'error', s->>'error', 'message',
    CASE s->>'error' WHEN 'too_many' THEN 'Too many wrong approval passwords. Signing is closed for 15 minutes.'
                     ELSE 'That approval password does not belong to any director.' END);
$$;

-- approve = the director's digital signature; the price on the form is the price
CREATE OR REPLACE FUNCTION public.saf_room_approve(p_token text, p_password text, p_id uuid, p_sign text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public._saf_room(p_token, p_password); s jsonb; v_row public.sale_approval_forms;
        v_blk jsonb; v_m jsonb; v_snap jsonb; v_now timestamptz := now();
BEGIN
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  s := public._saf_signer(v_co, p_sign);
  IF s ? 'error' THEN RETURN public._saf_sign_error(s); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms WHERE id = p_id AND company_id = v_co FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted',
      'message', 'This form is ' || v_row.status || ', not waiting for a director.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s2 WHERE s2.unit_id = v_row.unit_id AND s2.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold', 'message', 'This unit already has an active sale.'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_row.unit_code);
  IF (v_blk->>'base_price')::numeric IS DISTINCT FROM v_row.base_price
     OR (v_blk->>'area_sqft')::numeric IS DISTINCT FROM v_row.area_sqft THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_changed',
      'message', 'The unit''s price or area changed after Accounts submitted this form. Decline it so Accounts can make a new one.'); END IF;
  IF (v_m->>'total')::numeric IS DISTINCT FROM v_row.total_received OR v_m->'receipts' IS DISTINCT FROM v_row.receipts THEN
    RETURN jsonb_build_object('success', false, 'error', 'money_changed',
      'message', 'NexuFinance shows different money for this unit than Accounts submitted. Decline it so Accounts can check and resubmit.'); END IF;

  IF v_row.supersedes_id IS NOT NULL THEN
    UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
     WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
  END IF;
  v_snap := (to_jsonb(v_row) || jsonb_build_object(
               'approved_by', NULL, 'approved_by_sales_user', s->>'sales_user_id', 'approved_by_approver', s->>'approver_id',
               'approved_by_name', s->>'name', 'approved_at', v_now))
            - ARRAY['snapshot','snapshot_hash','pdf_sha256','pdf_path','sale_id','superseded_by','updated_at','status',
                    'filed_by','filed_by_name','filed_at'];
  UPDATE public.sale_approval_forms SET status = 'approved',
    approved_by = NULL, approved_by_sales_user = (s->>'sales_user_id')::uuid, approved_by_approver = (s->>'approver_id')::uuid,
    approved_by_name = s->>'name', approved_at = v_now, updated_at = v_now,
    snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- decline: a reason is required, and it goes back to Accounts with it
CREATE OR REPLACE FUNCTION public.saf_room_reject(p_token text, p_password text, p_id uuid, p_reason text, p_sign text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public._saf_room(p_token, p_password); s jsonb; v_row public.sale_approval_forms;
BEGIN
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required', 'message', 'Write why it is declined.'); END IF;
  s := public._saf_signer(v_co, p_sign);
  IF s ? 'error' THEN RETURN public._saf_sign_error(s); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms WHERE id = p_id AND company_id = v_co FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted'); END IF;
  UPDATE public.sale_approval_forms SET status = 'rejected',
    rejected_by = NULL, rejected_by_sales_user = (s->>'sales_user_id')::uuid, rejected_by_approver = (s->>'approver_id')::uuid,
    rejected_by_name = s->>'name', rejected_at = now(), reject_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $$;

-- ── 6. a director sets (or changes) their own approval password ─────────────
-- Proven by their own CRM sign-in (the session sales_login returned for their
-- mobile + PIN), inside the room. Never one director for another.
CREATE OR REPLACE FUNCTION public.saf_room_set_password(p_token text, p_password text, p_session_token text, p_new text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_co uuid := public._saf_room(p_token, p_password); v_su uuid; v_a public.saf_approvers;
BEGIN
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT ss.sales_user_id INTO v_su FROM public.sales_sessions ss
   WHERE ss.session_token = p_session_token AND ss.expires_at > now() AND ss.company_id = v_co;
  SELECT * INTO v_a FROM public.saf_approvers WHERE sales_user_id = v_su AND company_id = v_co AND active;
  IF v_a.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_director',
      'message', 'That sign-in is not one of the directors who approve sales.'); END IF;
  IF length(COALESCE(p_new, '')) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_short', 'message', 'Use at least 6 characters.'); END IF;
  IF EXISTS (SELECT 1 FROM public.saf_approvers o
              WHERE o.company_id = v_co AND o.id <> v_a.id AND o.password_hash IS NOT NULL
                AND o.password_hash = extensions.crypt(p_new, o.password_hash)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'taken', 'message', 'Choose a different password.'); END IF;
  UPDATE public.saf_approvers SET password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), password_set_at = now()
   WHERE id = v_a.id;
  RETURN jsonb_build_object('success', true, 'name', v_a.display_name);
END $$;

-- ── 7. who may call what ────────────────────────────────────────────────────
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('_saf_room','_saf_signer','_saf_sign_error','saf_room_list','saf_room_get',
                                'saf_room_approve','saf_room_reject','saf_room_set_password')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname NOT LIKE '\_%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    END IF;
  END LOOP;
END
$g$;
