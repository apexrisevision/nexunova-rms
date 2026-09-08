-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEALER'S RECEIPT WAS A PHOTOGRAPH, NOT A WINDOW.
--
-- get_request_status returned availability_requests.status, which is the
-- decision as it stood at the moment it was taken and never moves again.
-- So a request approved and then UNDONE at the desk still read "Reserved for
-- you" on the dealer's phone, for a unit that was back in the pool and could
-- be sold to somebody else the same afternoon. Measured on live before
-- touching anything: three approved requests on Awami Market (GF-01, GF-09,
-- FF-06), all three reservations cancelled, all three units back to
-- _map_unit_state = 'available', and all three still saying "Reserved for
-- you".
--
-- The decision stays recorded — rewriting a decided row would be forging the
-- record. What changes is that the answer now carries a SECOND field which is
-- derived rather than remembered:
--
--   status  the decision, as taken and as recorded    (unchanged)
--   state   what is true right now, for the dealer    (new)
--
-- "Right now" reuses the predicate _map_unit_state already uses for the word
-- 'reserved' — active, and not past its expiry. Two definitions of "still
-- held" is how this class of bug is born in the first place, so there is one.
--
-- The dealer is told "Hold ended" whether the desk released it, it ran out,
-- or it turned into a sale. That is the same two-state discipline the public
-- payload keeps: what a dealer may act on, and what they may not. Why a unit
-- is gone is not theirs to see.
--
-- Additive. Every existing caller reading `status` keeps the field it reads.
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

/* CREATE OR REPLACE keeps the existing ACL, so this is here to be checked
   against, not because it is expected to change anything. */
REVOKE ALL ON FUNCTION public.get_request_status(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_request_status(text, text[])
  TO anon, authenticated, service_role;

COMMIT;
