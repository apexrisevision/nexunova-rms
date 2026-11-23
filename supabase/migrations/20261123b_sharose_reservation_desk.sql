-- ══ Reserve Desk: Sharose gets the full reservation desk, like Iqra (20261123b) ══
-- APPLIED 23-Nov-2026 as 20261123093504, on the owner's yes. Owner, 23-Nov-2026: "Reservation link pe Sharose k liye login, jaisay ham ne IQRA ka banaya tha
-- taakay Sharose unit reservation, approve, hold sold wagaira kar sakay" — "poora desk, Iqra jaisa".
-- Contact 03459102787.
--
-- Same two lists as Iqra (20261016a / 20261016b): _is_named_reservation_authority (full desk: reserve, hold,
-- sold, change status, release, any tag; sold prices on the desk) and _is_named_request_decider (approve /
-- decline link requests). His role stays what the Sales Access approval gives him; no director role.
-- The lists are keyed on the sales_users id, never the phone: the phone is used here only to find that id, and
-- the migration stops unless exactly one ACTIVE Awami login has that number. Iqra stays on both lists.
-- To revoke: take his id out of BOTH functions.

DO $m$
DECLARE
  co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';
  iqra constant uuid := '7a89dec1-af53-40a6-817f-e2a6d2db23b6';
  sid uuid; n int;
BEGIN
  SELECT count(*), max(su.id::text)::uuid INTO n, sid
    FROM public.sales_users su
   WHERE su.company_id = co
     AND right(regexp_replace(COALESCE(su.phone, ''), '[^0-9]', '', 'g'), 10) = '3459102787'
     AND su.is_active AND su.status = 'active';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Sharose: expected exactly one active Awami sales login with 03459102787, found %', n;
  END IF;

  EXECUTE format($f$
CREATE OR REPLACE FUNCTION public._is_named_reservation_authority(p_session_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $b$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_sessions ss
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
       AND ss.sales_user_id = ANY (ARRAY[
             %L::uuid,   -- IQRA 03255671163 (Awami)
             %L::uuid    -- Sharose 03459102787 (Awami), 20261123b
           ]));
$b$;$f$, iqra, sid);

  EXECUTE format($f$
CREATE OR REPLACE FUNCTION public._is_named_request_decider(p_session_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $b$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_sessions ss
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
       AND ss.sales_user_id = ANY (ARRAY[
             %L::uuid,   -- IQRA 03255671163 (Awami)
             %L::uuid    -- Sharose 03459102787 (Awami), 20261123b
           ]));
$b$;$f$, iqra, sid);
END $m$;

-- ── a named desk authority may book whatever his role ───────────────────────
-- Sharose's login is an 'accounts' role, which lead_role_config marks as not selling, and every desk function
-- asks _sales_may_sell first ("Your role does not book or sell units."). Iqra passed because she is a sale_rep.
-- A person the owner has named for the full desk passes too; nobody else's answer changes. _sales_may_sell is
-- read only by the unit / reservation functions (reserve, desk, requests, daybook, share link, quotes) — the
-- lead functions use lead_role_config on their own, so his role still has no leads.
CREATE OR REPLACE FUNCTION public._sales_may_sell(p_session_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT lrc.can_have_leads
      FROM public.sales_sessions ss
      JOIN public.sales_users su       ON su.id  = ss.sales_user_id
      JOIN public.lead_role_config lrc ON lrc.role = su.role
     WHERE ss.session_token = p_session_token
       AND ss.expires_at > now()
     LIMIT 1), false)
  OR public._is_named_reservation_authority(p_session_token);
$function$;
