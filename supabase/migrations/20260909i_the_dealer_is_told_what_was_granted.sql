-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEALER IS TOLD WHAT WAS GRANTED, NOT ONLY WHAT THEY ASKED FOR.
--
-- get_request_status is the only thing a phone on the public link can ask about
-- its own requests. It returned `asked` — the word the dealer chose — and
-- `held_until`, but never the tag the desk actually applied.
--
-- That gap mattered the moment the link grew a summary of the dealer's own
-- position. A dealer asks for Hold and the director answers with Pagri often
-- enough that counting the asks would be a summary of the one thing the dealer
-- already knew. "You hold 14 units: 9 on hold, 3 pagri, 2 sold" can only be
-- built from what was granted.
--
-- Sent ONLY while the hold is genuinely standing, on the same test the `state`
-- and `held_until` fields already use. A tag printed against a hold that has
-- ended is a label for something that is no longer true, and this page has been
-- caught telling that particular lie before.
--
-- Nothing else changes: same signature, same rows, one more key.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $mig$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_request_status';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_request_status is not there to patch';
  END IF;

  /* already carries it — a re-run must not double the key */
  IF position('''tag'', CASE' in v_src) > 0 THEN RETURN; END IF;

  v_old := '           ''days'', r.days, ''at'', r.created_at, ''decided_at'', r.decided_at,';

  v_new :=
    '           /* WHAT WAS ACTUALLY GRANTED, which is not always what was asked' || E'\n' ||
    '              for: a dealer asks for Hold and the desk may answer Pagri. Only' || E'\n' ||
    '              ever sent for a hold that is still standing - on an ended one it' || E'\n' ||
    '              would be a label for something that is no longer true. */' || E'\n' ||
    '           ''tag'', CASE' || E'\n' ||
    '             WHEN r.status = ''approved'' AND rv.id IS NOT NULL' || E'\n' ||
    '              AND rv.status = ''active''' || E'\n' ||
    '              AND (rv.expiry_date IS NULL OR rv.expiry_date > now())' || E'\n' ||
    '             THEN to_jsonb(COALESCE(NULLIF(TRIM(cus.public_label),''''), cus.status_name, ''Reserved''))' || E'\n' ||
    '             ELSE ''null''::jsonb' || E'\n' ||
    '           END,' || E'\n' ||
    v_old;

  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'get_request_status is not the shape this migration was written against';
  END IF;
  v_src := replace(v_src, v_old, v_new);

  /* and the join the new key reads from */
  v_old := '    LEFT JOIN public.reservations rv ON rv.id = r.reservation_id';
  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'the reservations join is not where this migration expected it';
  END IF;
  v_src := replace(v_src, v_old,
    v_old || E'\n' || '    LEFT JOIN public.category_unit_statuses cus ON cus.id = rv.unit_status_id');

  EXECUTE v_src;
END $mig$;

COMMIT;
