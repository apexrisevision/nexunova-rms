-- ============================================================================
-- NEXUNOVA RMS — fix: unit-status sync trigger must KEEP the reservation while a
-- unit is "Under Sale Review". 2026-06-17.
-- ----------------------------------------------------------------------------
-- BUG: _sync_reservation_on_unit_status() cancels any active reservation when a
-- unit's status changes to anything other than RESERVED/SOLD. submit_sale moves
-- the unit RESERVED -> SALE_REVIEW, so the trigger cancelled the very reservation
-- the submission depends on -> approve_sale_submission then failed with
-- "The reservation is no longer active". Fix = whitelist SALE_REVIEW + repair the
-- reservations that were wrongly cancelled while a submission is still pending.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._sync_reservation_on_unit_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_code text;
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT upper(status_code) INTO v_code FROM public.category_unit_statuses WHERE id=NEW.status_id;
    IF COALESCE(v_code,'') NOT IN ('RESERVED','SOLD','SALE_REVIEW') THEN
      UPDATE public.reservations SET status='cancelled', cancelled_at=now(), updated_at=now()
      WHERE unit_id=NEW.id AND status='active';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

UPDATE public.reservations r
   SET status='active', cancelled_at=NULL, cancelled_by=NULL, updated_at=now()
 WHERE r.status='cancelled'
   AND EXISTS (SELECT 1 FROM public.sale_submissions s WHERE s.reservation_id=r.id AND s.status='pending');
