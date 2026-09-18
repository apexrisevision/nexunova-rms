-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · k · director report backend
--
-- Extends nf_get_report for the director-facing daily closing screen,
-- built to match docs/reference/Awami_Closing_All_Entries.xlsx's "17-Sep"
-- tab (the owner-approved design) — see docs/PLAN.md §12 for the full
-- read-through of what each part of that tab is doing and why.
--
-- New: nf_other_balances(company, as_of) — the "Other Balances (Not
-- Awami's Own Cash)" section: inter-company payables (children of 22000),
-- director receivables (children of 12600), and customer token money held
-- (21100), each as a signed balance as of a date, in the sign a director
-- reads as a plain sentence ("owed to" / "due from" / "held" are always
-- positive when real). Only rows with a real, non-zero balance appear —
-- reproduces the reference tab's own two-row FMH/KBH display today without
-- hiding a third sister company or a second Token Money-style account
-- the moment either ever carries a balance.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_other_balances(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
  WITH bal AS (
    SELECT a.code, a.name, a.parent_code,
           COALESCE(sum(l.debit - l.credit), 0) AS net_debit
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' AND v.voucher_date <= p_as_of
     WHERE a.company_id = p_company_id AND a.code IN ('12610','12620','22100','22200','22300','22400','21100')
     GROUP BY a.code, a.name, a.parent_code
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY grp, code), '[]'::jsonb) FROM (
    SELECT 1 AS grp, code, jsonb_build_object('code', code, 'label', 'Owed to ' || name || ' (payable)', 'amount', -net_debit) AS row
      FROM bal WHERE parent_code = '22000' AND net_debit <> 0
    UNION ALL
    SELECT 2, code, jsonb_build_object('code', code, 'label', 'Due from ' || name || ' — given by Awami, to be recovered', 'amount', net_debit)
      FROM bal WHERE parent_code = '12600' AND net_debit <> 0
    UNION ALL
    SELECT 3, code, jsonb_build_object('code', code, 'label', 'Customer token money held — refundable if a deal is cancelled', 'amount', -net_debit)
      FROM bal WHERE code = '21100' AND net_debit <> 0
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.nf_get_report(p_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
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
    'day_name',      to_char(d.business_date, 'FMDay'),
    'closing_no',    d.closing_no,
    'status',        d.status,
    'balanced',      jsonb_array_length(v_checks) = 0,
    'checks',        v_checks,
    'company_line',  s.company_line,
    'report_title',  s.report_title,
    'mark',          s.mark,
    'accounts', (SELECT jsonb_agg(jsonb_build_object('via', x->>'via', 'label', x->>'label',
                                                     'opening', (x->>'opening')::numeric,
                                                     'received', (x->>'received')::numeric,
                                                     'paid', (x->>'paid')::numeric,
                                                     'transfers', (x->>'transfers')::numeric,
                                                     'closing', (x->>'closing')::numeric) ORDER BY o)
                   FROM jsonb_array_elements(pos->'rows') WITH ORDINALITY AS t(x, o)),
    'total_open',  (pos->'total'->>'opening')::numeric,
    'total_close', (pos->'total'->>'closing')::numeric,
    'total_in',    (pos->'total'->>'received')::numeric,
    'total_out',   (pos->'total'->>'paid')::numeric,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'side', l.side, 'voucher_no', l.voucher_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code, 'via', l.via,
               'amount', l.amount, 'sort', l.sort) ORDER BY l.side, l.sort)
        FROM public.nf_lines l JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'other_balances', public.nf_other_balances(v_company, d.business_date),
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
    'transfer_to_bank', (SELECT (x->>'transfers')::numeric FROM jsonb_array_elements(pos->'rows') x WHERE x->>'via' = 'Bank'),
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
