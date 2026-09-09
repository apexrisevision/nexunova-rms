-- ═══════════════════════════════════════════════════════════════════════════
-- THE RECEIPT SAYS WHAT WAS ASKED FOR.
--
-- A dealer who asks for Sold gets a row with no number of days, because a
-- permanent ask has none. Without the word beside it that row reads as a
-- blank. get_request_status now carries the label the dealer saw, so a phone
-- that has lost its local copy still shows the same sentence it showed when
-- the ask was made.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE OR REPLACE FUNCTION public.get_request_status(p_token text, p_refs text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.availability_links; v_out jsonb;
BEGIN
  SELECT * INTO v_link FROM public.availability_links
   WHERE token_hash = public._availability_token_hash(p_token)
     AND NOT revoked AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_available'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ref', r.ref, 'unit_no', r.unit_no, 'status', r.status,
           'kind', COALESCE(r.kind,'new'), 'note', r.note,
           /* The word the dealer chose, so a row that carries no number of
              days still says what it is about. */
           'asked', (SELECT COALESCE(NULLIF(TRIM(k.public_label),''), k.status_name)
                       FROM public.category_unit_statuses k
                      WHERE k.id = r.asked_status_id),
           'days', r.days, 'at', r.created_at, 'decided_at', r.decided_at,
           /* DERIVED, EVERY TIME IT IS ASKED. An approved request whose
              reservation is no longer standing is not a hold any more, and
              the phone that is showing it has no other way to find out. */
           'state', CASE
             WHEN r.status <> 'approved' THEN r.status
             WHEN rv.id IS NOT NULL
              AND rv.status = 'active'
              AND (rv.expiry_date IS NULL OR rv.expiry_date > now()) THEN 'held'
             ELSE 'ended'
           END,
           /* Only when it is genuinely still held. A date on an ended hold
              reads like a promise. */
           'held_until', CASE
             WHEN r.status = 'approved' AND rv.id IS NOT NULL
              AND rv.status = 'active'
              AND (rv.expiry_date IS NULL OR rv.expiry_date > now())
             THEN to_jsonb(rv.expiry_date)
             ELSE 'null'::jsonb
           END)), '[]'::jsonb)
    INTO v_out
    FROM public.availability_requests r
    LEFT JOIN public.reservations rv ON rv.id = r.reservation_id
   WHERE r.link_id = v_link.id
     AND r.ref = ANY(COALESCE(p_refs, ARRAY[]::text[]));

  RETURN jsonb_build_object('success', true, 'requests', v_out);
END $function$;

COMMIT;
