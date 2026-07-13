-- Unit cancellation was failing with:
--   new row for relation "installments" violates check constraint "installment_status_check"
-- _execute_unit_cancellation_core voids a cancelled sale's unpaid installments by setting
-- status='cancelled', but that value was never in the allowed list, so the whole
-- cancellation transaction rolled back for any sale that still had pending installments.
--
-- Additive widening only. Reports filter on sales.is_active (which cancellation sets false),
-- so a cancelled sale's installments already drop out of recovery/ledger/outstanding figures.

ALTER TABLE public.installments DROP CONSTRAINT installments_status_check;

ALTER TABLE public.installments ADD CONSTRAINT installments_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text]));
