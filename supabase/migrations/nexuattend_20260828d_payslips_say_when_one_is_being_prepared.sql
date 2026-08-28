-- NexuAttend (attendance project) — applied there, recorded here.
--
-- A payslip that has not been finalized still belongs to HR, and this function
-- was right to refuse it: an employee must never read a figure the office is
-- still editing. But refusing it silently leaves them at "No payslip issued
-- yet" in a month where payroll is plainly under way, which reads as neglect
-- rather than as process.
--
-- So the period is disclosed and nothing else. No basic, no gross, no net — the
-- pending list carries a year, a month and the run's state, which is enough to
-- say "June is being prepared" and not enough to be a salary.
--
-- finalized_at is added to the issued slips at the same time: a payslip that
-- says when it was issued reads as a document, one that does not reads as a row.
create or replace function public.portal_my_payslips(p_secret text, p_company uuid, p_cnic text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.portal_secret_ok(p_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_secret');
  END IF;

  v_emp := public.portal_resolve_employee(p_company, p_cnic);

  RETURN jsonb_build_object(
    'ok', true,
    'payslips', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',                s.id,
               'year',              r.period_year,
               'month',             r.period_month,
               'status',            s.status,
               'run_status',        r.status,
               'finalized_at',      r.finalized_at,
               'paid_at',           s.paid_at,
               'payment_method',    s.payment_method,
               'working_days',      s.working_days,
               'present_days',      s.present_days,
               'absent_days',       s.absent_days,
               'leave_days',        s.leave_days,
               'late_count',        s.late_count,
               'basic_salary',      s.basic_salary,
               'allowances',        s.allowances,
               'bonus',             s.bonus,
               'overtime_amount',   s.overtime_amount,
               'gross_salary',      s.gross_salary,
               'absent_deduction',  s.absent_deduction,
               'late_deduction',    s.late_deduction,
               'other_deductions',  s.other_deductions,
               'advance_deduction', s.advance_deduction,
               'loan_return',       s.loan_return,
               'total_deductions',  s.total_deductions,
               'net_salary',        s.net_salary,
               'slip_url',          s.slip_url)
             ORDER BY r.period_year DESC, r.period_month DESC)
        FROM public.payroll_slips s
        JOIN public.payroll_runs  r ON r.id = s.payroll_run_id
       WHERE s.company_id = p_company
         AND s.employee_id = v_emp
         -- The line that matters: a draft belongs to HR, not to the employee.
         AND r.status IN ('finalized', 'paid')), '[]'::jsonb),

    -- The period only. Deliberately no amounts of any kind.
    'pending', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'year',  r.period_year,
               'month', r.period_month,
               'run_status', r.status)
             ORDER BY r.period_year DESC, r.period_month DESC)
        FROM public.payroll_slips s
        JOIN public.payroll_runs  r ON r.id = s.payroll_run_id
       WHERE s.company_id = p_company
         AND s.employee_id = v_emp
         AND r.status NOT IN ('finalized', 'paid')), '[]'::jsonb));
END $function$;

-- and prove the pending list can never carry money
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='portal_my_payslips';
  if position('''pending''' in v_src) = 0 then
    raise exception 'the pending list is missing';
  end if;
  -- the pending block is everything after the marker; no salary column may appear in it
  if substring(v_src from position('''pending''' in v_src)) ~* '(net_salary|gross_salary|basic_salary|total_deductions)' then
    raise exception 'the pending list discloses an amount — that is the one thing it must not do';
  end if;
end $$;
