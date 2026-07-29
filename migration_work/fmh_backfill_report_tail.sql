-- REPORT: aggregates the rows actually written, then raises to force ROLLBACK.
DO $rep$
DECLARE t text; tot text; mf text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY line) INTO t FROM (
    SELECT rpad(u.unit_no,7)||' '||rpad(s.sale_number,8)||' '||rpad(c.client_code,12)
        || lpad(count(*)::text,4)||'  sched='||lpad(to_char(sum(i.amount_due),'FM999,999,999'),11)
        || '  net='||lpad(to_char(s.net_amount,'FM999,999,999'),11)
        || '  disc='||lpad(to_char(s.discount,'FM999,999,999.99'),13)
        || CASE WHEN sum(i.amount_due)=s.net_amount THEN '  OK' ELSE '  ***MISMATCH***' END AS line
    FROM sales s
    JOIN units u ON u.id=s.unit_id
    JOIN clients c ON c.id=s.client_id
    JOIN installments i ON i.sale_id=s.id
    WHERE s.notes='2026-07-29 booking-record backfill'
    GROUP BY u.unit_no, s.sale_number, c.client_code, s.net_amount, s.discount
  ) x;

  SELECT 'MF-57  SAL-2026-0009  rows='||count(*)
      || '  sched='||to_char(sum(i.amount_due),'FM999,999,999')
      || '  net='||to_char(max(s.net_amount),'FM999,999,999')
      || '  inst_count='||max(s.installment_count)
      || '  annual_lumps='||count(*) FILTER (WHERE i.amount_due=400000)
      || '  all_on_6th='||CASE WHEN bool_and(EXTRACT(DAY FROM i.due_date)=6) THEN 'YES' ELSE 'NO' END
      || '  first='||to_char(min(i.due_date),'YYYY-MM-DD')
      || '  last='||to_char(max(i.due_date),'YYYY-MM-DD')
      || '  paid_rows='||count(*) FILTER (WHERE i.amount_paid<>0)
    INTO mf
  FROM installments i JOIN sales s ON s.id=i.sale_id
  WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';

  SELECT 'TOTALS  new_sales='||(SELECT count(*) FROM sales WHERE notes='2026-07-29 booking-record backfill')
      || '  new_installments='||(SELECT count(*) FROM installments i2 JOIN sales s2 ON s2.id=i2.sale_id
                                 WHERE s2.notes='2026-07-29 booking-record backfill')
      || '  new_net='||(SELECT to_char(sum(net_amount),'FM999,999,999') FROM sales
                        WHERE notes='2026-07-29 booking-record backfill')
      || '  clients_created='||(SELECT count(*) FROM clients WHERE notes='2026-07-29 booking-record backfill')
      || '  payments_anywhere='||(SELECT count(*) FROM payments p JOIN sales s3 ON s3.id=p.sale_id
                                  WHERE s3.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612'
                                    AND (s3.notes='2026-07-29 booking-record backfill'
                                         OR s3.sale_number='SAL-2026-0009'))
      || '  zero_rows='||(SELECT count(*) FROM installments i3 JOIN sales s4 ON s4.id=i3.sale_id
                          WHERE s4.notes='2026-07-29 booking-record backfill' AND i3.amount_due=0)
      || '  proj_sold='||(SELECT count(*) FROM units
                          WHERE project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
                            AND status_id='5723bb68-d558-41c8-92e5-10a0eaf6682b')
      || '  proj_avail='||(SELECT count(*) FROM units
                           WHERE project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855'
                             AND status_id='839b6149-d3ef-4c49-94be-c51e5d638b31')
    INTO tot;

  RAISE EXCEPTION E'\n%\n\n%\n%', t, mf, tot;
END $rep$;
