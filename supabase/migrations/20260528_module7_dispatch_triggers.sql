-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase C: TRIGGER LAYER
-- 2026-05-28
-- Event -> queued message. fmt_pkr() = PK lakh/crore grouping.
-- enqueue_due_comms() = the time-based daily scan (installment due -3d,
-- overdue day 1/7/15/30, promise due tomorrow, PDC deposit in 2d).
-- enqueue_payment_thankyou() = real-time confirmation (call after a
-- payment is recorded). All route through enqueue_message (opt-out +
-- dedup enforced there). Nothing here SENDS — it only queues.
-- ================================================================

-- ---- fmt_pkr: Indian lakh/crore grouping (1,20,00,000) ---------------------
CREATE OR REPLACE FUNCTION public.fmt_pkr(p numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_neg boolean := COALESCE(p,0) < 0;
  v_int text := abs(round(COALESCE(p,0)))::bigint::text;
  v_last3 text; v_rest text; v_grp text := '';
BEGIN
  IF length(v_int) <= 3 THEN
    RETURN (CASE WHEN v_neg THEN '-' ELSE '' END) || v_int;
  END IF;
  v_last3 := right(v_int, 3);
  v_rest  := left(v_int, length(v_int) - 3);
  WHILE length(v_rest) > 2 LOOP
    v_grp  := ',' || right(v_rest, 2) || v_grp;
    v_rest := left(v_rest, length(v_rest) - 2);
  END LOOP;
  RETURN (CASE WHEN v_neg THEN '-' ELSE '' END) || v_rest || v_grp || ',' || v_last3;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fmt_pkr(numeric) TO anon, authenticated;

-- ---- enqueue_due_comms: time-based daily scan ------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_due_comms(p_company_id uuid, p_today date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company text;
  v_q int := 0; v_s int := 0; v_f int := 0;
  rec record; v_res jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company');
  END IF;
  SELECT company_name INTO v_company FROM companies WHERE id = p_company_id;

  FOR rec IN
    -- (1) installment due in 3 days
    SELECT s.client_id, 'installment_due'::text AS category, 'inst_due:'||i.id::text AS dedup_key,
           i.sale_id,
           jsonb_build_object('client_name', c.full_name, 'amount', fmt_pkr(i.outstanding),
             'due_date', to_char(i.due_date,'DD Mon YYYY'), 'company_name', v_company,
             'unit', COALESCE(u.unit_no,''), 'project', COALESCE(p.project_name,'')) AS merge_data
    FROM installments i
    JOIN sales s ON s.id = i.sale_id
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN projects p ON p.id = COALESCE(s.project_id, u.project_id)
    WHERE i.company_id = p_company_id AND i.status IN ('pending','partial','overdue')
      AND i.outstanding > 0 AND i.due_date = p_today + 3

    UNION ALL
    -- (2) overdue escalating reminders at day 1 / 7 / 15 / 30
    SELECT s.client_id, 'overdue', 'overdue:'||i.id::text||':d'||(p_today - i.due_date)::text,
           i.sale_id,
           jsonb_build_object('client_name', c.full_name, 'amount', fmt_pkr(i.outstanding),
             'due_date', to_char(i.due_date,'DD Mon YYYY'), 'days_overdue', (p_today - i.due_date)::text,
             'company_name', v_company, 'unit', COALESCE(u.unit_no,''), 'project', COALESCE(p.project_name,''))
    FROM installments i
    JOIN sales s ON s.id = i.sale_id
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN projects p ON p.id = COALESCE(s.project_id, u.project_id)
    WHERE i.company_id = p_company_id AND i.status IN ('pending','partial','overdue')
      AND i.outstanding > 0 AND (p_today - i.due_date) IN (1,7,15,30)

    UNION ALL
    -- (3) promise due tomorrow
    SELECT pp.client_id, 'promise_reminder', 'promise:'||pp.id::text, pp.sale_id,
           jsonb_build_object('client_name', c.full_name, 'amount', fmt_pkr(pp.promised_amount),
             'promise_date', to_char(pp.promise_date,'DD Mon YYYY'), 'company_name', v_company)
    FROM payment_promises pp
    JOIN clients c ON c.id = pp.client_id
    WHERE pp.company_id = p_company_id AND pp.status = 'pending' AND pp.promise_date = p_today + 1

    UNION ALL
    -- (4) PDC deposit approaching (2 days before deposit/cheque date)
    SELECT pc.client_id, 'pdc_reminder', 'pdc_dep:'||pc.id::text, pc.sale_id,
           jsonb_build_object('client_name', c.full_name, 'amount', fmt_pkr(pc.amount),
             'cheque_no', COALESCE(pc.cheque_no,''),
             'deposit_date', to_char(COALESCE(pc.deposit_date, pc.cheque_date),'DD Mon YYYY'),
             'company_name', v_company)
    FROM pdc_cheques pc
    JOIN clients c ON c.id = pc.client_id
    WHERE pc.company_id = p_company_id AND pc.status = 'pending'
      AND COALESCE(pc.deposit_date, pc.cheque_date) = p_today + 2
  LOOP
    v_res := public.enqueue_message(p_company_id, jsonb_build_object(
      'client_id', rec.client_id, 'channel', 'whatsapp', 'category', rec.category,
      'dedup_key', rec.dedup_key, 'merge_data', rec.merge_data, 'sale_id', rec.sale_id,
      'sent_by', 'system'));
    IF COALESCE((v_res->>'success')::boolean, false) THEN v_q := v_q + 1;
    ELSIF v_res ? 'skipped' THEN v_s := v_s + 1;
    ELSE v_f := v_f + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'queued', v_q, 'skipped', v_s, 'failed', v_f);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'queued', v_q);
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_due_comms(uuid, date) TO anon, authenticated;

-- ---- enqueue_payment_thankyou: real-time receipt confirmation --------------
CREATE OR REPLACE FUNCTION public.enqueue_payment_thankyou(p_company_id uuid, p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company text; v_merge jsonb; v_client uuid; v_sale uuid;
BEGIN
  SELECT company_name INTO v_company FROM companies WHERE id = p_company_id;
  SELECT pay.client_id, pay.sale_id,
         jsonb_build_object('client_name', c.full_name, 'amount', fmt_pkr(pay.amount),
           'receipt_no', COALESCE(pay.payment_code,''), 'payment_date', to_char(pay.payment_date,'DD Mon YYYY'),
           'unit', COALESCE(u.unit_no,''), 'project', COALESCE(p.project_name,''), 'company_name', v_company)
    INTO v_client, v_sale, v_merge
  FROM payments pay
  JOIN clients c ON c.id = pay.client_id
  LEFT JOIN sales s ON s.id = pay.sale_id
  LEFT JOIN units u ON u.id = s.unit_id
  LEFT JOIN projects p ON p.id = COALESCE(s.project_id, u.project_id)
  WHERE pay.id = p_payment_id AND pay.company_id = p_company_id;

  IF v_client IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'payment_not_found'); END IF;

  RETURN public.enqueue_message(p_company_id, jsonb_build_object(
    'client_id', v_client, 'channel', 'whatsapp', 'category', 'payment_received',
    'dedup_key', 'pay_thanks:'||p_payment_id::text, 'merge_data', v_merge,
    'sale_id', v_sale, 'sent_by', 'system'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_payment_thankyou(uuid, uuid) TO anon, authenticated;
