-- ============================================================================
-- NEXUNOVA RMS — BUYER PORTAL "Mera Hisaab" — PHASE 0 (SECURITY) + PHASE 1 (auth)
-- 2026-06-14
-- ----------------------------------------------------------------------------
-- BLOCKER FIXED: the buyer data RPCs were GRANTed to anon and accepted RAW
-- (client_id, company_id, unit_id) args. The anon key is published in
-- buyer-portal.html, so anyone could read ANY client's schedule / receipts /
-- possession / NOCs (cross-client IDOR). Two of them (possession, nocs) only
-- checked the client existed in the company and then returned data for ANY
-- unit_id in that tenant.
--
-- FIX: every buyer data RPC now takes p_session_token and derives
-- client_id/company_id INSIDE the function from portal_sessions (validating
-- expiry) — exactly like get_portal_client_data already does. The caller may
-- only pass a unit_id, and the sales join (client_id = session.client_id)
-- makes a foreign unit_id return nothing. No caller-supplied identity at all.
--
-- Also: receipts no longer expose internal bank_name / cheque_number to buyers.
-- New: get_portal_sales (multi-unit switcher) + portal_magic_login (magic link).
-- admin_invite_portal_client: temp link life 72h -> 30 days, returns temp_token.
-- ============================================================================

-- ── 1. Drop the IDOR-vulnerable raw-param versions ─────────────────────────
DROP FUNCTION IF EXISTS public.get_buyer_payment_schedule(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_buyer_receipts(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_buyer_sale_summary(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_buyer_possession_for_portal(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_buyer_nocs_for_portal(uuid, uuid, uuid);

-- ── 2. Re-gated, session-token versions ────────────────────────────────────

-- 2a. Sale summary (own unit only; buyer sees their OWN cnic/phone — fine)
CREATE FUNCTION public.get_buyer_sale_summary(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'unit_number',       u.unit_no,
      'project_name',      pr.project_name,
      'sale_number',       s.sale_number,
      'sale_date',         s.sale_date,
      'booking_date',      s.sale_date,
      'down_payment',      COALESCE(s.down_payment, 0),
      'installment_count', s.installment_count,
      'total_price',       COALESCE(s.net_amount, s.total_amount, 0),
      'total_paid',        COALESCE((
        SELECT SUM(amount) FROM public.payments
        WHERE sale_id = s.id AND company_id = s.company_id
          AND status IN ('received','cleared')), 0),
      'total_outstanding', GREATEST(0,
        COALESCE(s.net_amount, s.total_amount, 0)
        - COALESCE((SELECT SUM(amount) FROM public.payments
            WHERE sale_id = s.id AND company_id = s.company_id
              AND status IN ('received','cleared')), 0)),
      'next_due_date', (
        SELECT i.due_date FROM public.installments i
        WHERE i.sale_id = s.id AND i.company_id = s.company_id
          AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0
          AND i.due_date >= CURRENT_DATE
        ORDER BY i.due_date LIMIT 1),
      'next_due_amount', (
        SELECT GREATEST(0, COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0))
        FROM public.installments i
        WHERE i.sale_id = s.id AND i.company_id = s.company_id
          AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0
          AND i.due_date >= CURRENT_DATE
        ORDER BY i.due_date LIMIT 1),
      'buyer_name',  c.full_name,
      'buyer_cnic',  c.cnic,
      'buyer_phone', c.phone_primary
    )
    FROM public.portal_sessions ses
    JOIN public.sales s
      ON s.company_id = ses.company_id AND s.client_id = ses.client_id AND s.unit_id = p_unit_id
    JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
    LEFT JOIN public.clients  c  ON c.id  = s.client_id
    WHERE ses.session_token = p_session_token AND ses.expires_at > now()
    ORDER BY s.sale_date DESC NULLS LAST
    LIMIT 1
  ), '{}'::jsonb);
$$;

-- 2b. Payment schedule (installment plan for an owned unit)
CREATE FUNCTION public.get_buyer_payment_schedule(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'installment_number', i.installment_number,
    'due_date',           i.due_date,
    'amount_due',         i.amount_due,
    'amount_paid',        i.amount_paid,
    'balance',            GREATEST(0, COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0)),
    'status',             i.status,
    'is_overdue',         (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE
                           AND COALESCE(i.amount_due,0) - COALESCE(i.amount_paid,0) > 0)
  ) ORDER BY i.installment_number), '[]'::jsonb)
  FROM public.portal_sessions ses
  JOIN public.sales s
    ON s.company_id = ses.company_id AND s.client_id = ses.client_id AND s.unit_id = p_unit_id
  JOIN public.installments i ON i.sale_id = s.id AND i.company_id = ses.company_id
  WHERE ses.session_token = p_session_token AND ses.expires_at > now();
$$;

-- 2c. Receipts — buyer-safe fields ONLY (no internal bank_name / cheque_number)
CREATE FUNCTION public.get_buyer_receipts(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'receipt_number', COALESCE(p.voucher_code, p.payment_code),
    'payment_date',   p.payment_date,
    'amount',         p.amount,
    'payment_mode',   p.payment_method,
    'status',         p.status
  ) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb)
  FROM public.portal_sessions ses
  JOIN public.sales s
    ON s.company_id = ses.company_id AND s.client_id = ses.client_id AND s.unit_id = p_unit_id
  JOIN public.payments p
    ON p.sale_id = s.id AND p.company_id = ses.company_id AND p.status IN ('received','cleared')
  WHERE ses.session_token = p_session_token AND ses.expires_at > now();
$$;

-- 2d. Possession (latest for an owned unit)
CREATE FUNCTION public.get_buyer_possession_for_portal(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'id', po.id, 'possession_date', po.possession_date,
      'status', po.status, 'remarks', po.notes, 'created_at', po.created_at)
    FROM public.portal_sessions ses
    JOIN public.sales s
      ON s.company_id = ses.company_id AND s.client_id = ses.client_id AND s.unit_id = p_unit_id
    JOIN public.possessions po ON po.unit_id = s.unit_id AND po.company_id = ses.company_id
    WHERE ses.session_token = p_session_token AND ses.expires_at > now()
    ORDER BY po.created_at DESC LIMIT 1
  ), '{}'::jsonb);
$$;

-- 2e. NOCs (approved, for an owned unit)
CREATE FUNCTION public.get_buyer_nocs_for_portal(p_session_token text, p_unit_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id, 'noc_number', n.noc_number, 'noc_type', n.noc_type,
    'status', n.status, 'valid_from', n.valid_from, 'valid_until', n.valid_until,
    'approved_at', n.approved_at, 'created_at', n.created_at
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  FROM public.portal_sessions ses
  JOIN public.sales s
    ON s.company_id = ses.company_id AND s.client_id = ses.client_id AND s.unit_id = p_unit_id
  JOIN public.noc n ON n.unit_id = s.unit_id AND n.company_id = ses.company_id AND n.status = 'approved'
  WHERE ses.session_token = p_session_token AND ses.expires_at > now();
$$;

-- ── 3. NEW: multi-unit switcher (client identity + all their active sales) ──
CREATE OR REPLACE FUNCTION public.get_portal_sales(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ses public.portal_sessions; v_cl public.clients; v_sales jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.portal_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT * INTO v_cl FROM public.clients
   WHERE id = v_ses.client_id AND company_id = v_ses.company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sale_id', s.id, 'sale_number', s.sale_number, 'unit_id', s.unit_id,
           'unit_no', u.unit_no, 'project_name', pr.project_name, 'status', s.status
         ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_sales
  FROM public.sales s
  LEFT JOIN public.units u   ON u.id = s.unit_id
  LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
  WHERE s.company_id = v_ses.company_id AND s.client_id = v_ses.client_id
    AND s.status = 'active' AND s.unit_id IS NOT NULL;

  RETURN jsonb_build_object('success', true,
    'client', jsonb_build_object('full_name', v_cl.full_name,
                                 'client_code', v_cl.client_code, 'cnic', v_cl.cnic),
    'sales', v_sales);
END; $$;

-- ── 4. NEW: magic-link login (reuses portal_clients.temp_token) ────────────
CREATE OR REPLACE FUNCTION public.portal_magic_login(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_pc public.portal_clients; v_cl public.clients; v_co public.companies; v_tok text;
BEGIN
  SELECT * INTO v_pc FROM public.portal_clients
   WHERE temp_token = p_token AND temp_token_expires_at > now() AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired link. Ask the developer to re-send your access link.');
  END IF;

  SELECT * INTO v_cl FROM public.clients   WHERE id = v_pc.client_id;
  SELECT * INTO v_co FROM public.companies WHERE id = v_pc.company_id;
  v_tok := encode(gen_random_bytes(32), 'hex');

  DELETE FROM public.portal_sessions WHERE portal_client_id = v_pc.id;
  INSERT INTO public.portal_sessions (company_id, client_id, portal_client_id, session_token, expires_at)
  VALUES (v_pc.company_id, v_pc.client_id, v_pc.id, v_tok, now() + INTERVAL '8 hours');
  UPDATE public.portal_clients SET last_login_at = now() WHERE id = v_pc.id;

  RETURN jsonb_build_object('success', true, 'session_token', v_tok,
    'client_id', v_cl.id, 'company_id', v_co.id, 'company_name', v_co.company_name,
    'client_name', v_cl.full_name, 'client_code', v_cl.client_code, 'cnic', v_cl.cnic);
END; $$;

-- ── 5. admin_invite_portal_client: 30-day link + return temp_token ─────────
CREATE OR REPLACE FUNCTION public.admin_invite_portal_client(p_client_id uuid, p_email text, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_me  public.app_users; v_cl public.clients; v_co public.companies;
  v_pw  text; v_tok text; v_pc_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;

  SELECT * INTO v_cl FROM public.clients WHERE id=p_client_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','client_not_found'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  v_pw  := UPPER(SUBSTRING(encode(gen_random_bytes(6),'hex') FROM 1 FOR 8));
  v_tok := encode(gen_random_bytes(32),'hex');

  INSERT INTO public.portal_clients
    (company_id,client_id,email,password_hash,temp_token,temp_token_expires_at,is_active)
  VALUES
    (p_company_id,p_client_id,LOWER(TRIM(p_email)),
     crypt(v_pw,gen_salt('bf',8)),v_tok,now()+INTERVAL '30 days',true)
  ON CONFLICT (company_id,email) DO UPDATE SET
    password_hash=crypt(v_pw,gen_salt('bf',8)),
    temp_token=v_tok, temp_token_expires_at=now()+INTERVAL '30 days',
    client_id=p_client_id, is_active=true, updated_at=now()
  RETURNING id INTO v_pc_id;

  BEGIN
    PERFORM public.enqueue_message(p_company_id, jsonb_build_object(
      'channel','email','to_address',LOWER(TRIM(p_email)),
      'subject','Your Buyer Portal Access — '||COALESCE(v_co.company_name,'Nexunova RMS'),
      'body','Dear '||v_cl.full_name||E',\n\nBuyer portal access created.\n'
             ||'Company Code: '||COALESCE(v_co.company_code,'')||E'\n'
             ||'Email: '||LOWER(TRIM(p_email))||E'\nTemporary Password: '||v_pw
             ||E'\n\nThank you,\n'||COALESCE(v_co.company_name,'Nexunova RMS'),
      'category','portal_invite'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- temp_token powers the no-password MAGIC LINK the admin shares (WhatsApp/print);
  -- temp_password remains a fallback for the company-code+email+password screen.
  RETURN jsonb_build_object('success',true,'pc_id',v_pc_id,
    'temp_password',v_pw,'temp_token',v_tok,'email',LOWER(TRIM(p_email)));
END;
$function$;

-- ── 6. Grants — anon is the portal's role; the SESSION TOKEN is the gate ───
REVOKE ALL ON FUNCTION public.get_buyer_sale_summary(text,uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_buyer_payment_schedule(text,uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_buyer_receipts(text,uuid)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_buyer_possession_for_portal(text,uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_buyer_nocs_for_portal(text,uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_portal_sales(text)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_magic_login(text)                     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_buyer_sale_summary(text,uuid)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_buyer_payment_schedule(text,uuid)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_buyer_receipts(text,uuid)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_buyer_possession_for_portal(text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_buyer_nocs_for_portal(text,uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_sales(text)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_magic_login(text)                   TO anon, authenticated;
