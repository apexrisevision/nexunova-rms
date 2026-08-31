-- ===========================================================================
-- The portal signed people out while they were still using it.
--
-- Two clocks were running, and neither measured "not being used":
--
--   * the browser gave up after 30 minutes idle, and its idle clock was only
--     reset when somebody NAVIGATED — so reading one screen for half an hour
--     was indistinguishable from walking away;
--   * sales_login wrote expires_at = now() + 8 hours, a fixed stop from the
--     moment of sign-in. Working steadily all day still ended in a sign-out at
--     the eight-hour mark, and no amount of activity moved it.
--
-- What was asked for is a week of DISUSE, not a week from sign-in. That needs a
-- window that slides forward every time the portal is actually used, so this
-- migration does three things:
--
--   1. sales_login issues a seven-day session instead of an eight-hour one;
--   2. a new sales_touch_session() pushes a live session's expiry back out to
--      seven days, which the portal calls while somebody is using it;
--   3. the column default matches, for anything that inserts without saying.
--
-- Deliberately NOT touched: create_lead_from_fb / _instagram / _web /
-- _whatsapp each mint a two-minute throwaway session to call create_lead on the
-- page owner's behalf. Those are internal and short on purpose.
--
-- Not touched either: portal_sessions, which is the BUYER portal ("Mera
-- Hisaab") and a different audience on a different device.
--
-- Trade-off, stated plainly: a session that survives a week is a week in which
-- an unlocked phone is a signed-in portal. That is the instruction, and it is
-- the reason the window slides on use rather than simply being made longer —
-- a device nobody touches still falls out after seven days.
-- ===========================================================================

BEGIN;

-- ── 1. a session begins with a week on it ─────────────────────────────────
DO $do$
DECLARE v_src text; v_new text; v_old constant text := 'now()+interval ''8 hours''';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'sales_login';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'sales_login not found';
  END IF;

  -- The eight hours must appear exactly once. If it does not, the function has
  -- been rewritten since this was written and a blind replace would be a guess.
  IF (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one % in sales_login, found %',
      v_old, (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  END IF;

  v_new := replace(v_src, v_old, 'now()+interval ''7 days''');
  EXECUTE v_new;
END $do$;

-- ── 2. using it puts the week back ────────────────────────────────────────
-- Called by the portal while somebody is working. It is the whole difference
-- between "a week from signing in" and "a week of not being used".
CREATE OR REPLACE FUNCTION public.sales_touch_session(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  -- Only a session that is still alive may be renewed. An expired one has to go
  -- back through sales_login, PIN and all — otherwise this call would quietly
  -- resurrect a session that had already run out.
  UPDATE public.sales_sessions
     SET expires_at = now() + interval '7 days'
   WHERE session_token = p_session_token
     AND expires_at > now()
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_expired');
  END IF;
  RETURN jsonb_build_object('success', true, 'expires_in_days', 7);
END $function$;

-- The browser calls this as anon, like the rest of the portal's API. PUBLIC is
-- revoked explicitly: a plain REVOKE FROM anon, authenticated leaves the grant
-- PUBLIC holds and is a lock that is not locked.
REVOKE ALL ON FUNCTION public.sales_touch_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_touch_session(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.sales_touch_session(text) IS
  'Slides a live portal session''s expiry to now() + 7 days. Called by the '
  'portal while in use, so the session ends after a week of DISUSE rather than '
  'a week after sign-in. Refuses an already-expired token.';

-- ── 3. and the default says the same thing ────────────────────────────────
ALTER TABLE public.sales_sessions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

COMMIT;
