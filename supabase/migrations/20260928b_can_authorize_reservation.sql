-- Tells the portal page whether this login may authorise a reservation, so it
-- can hide the Reserve buttons for everyone else. Only a bool about the caller's
-- own session; the real gate is _may_authorize_reservation inside every booking
-- RPC (20260928a).
CREATE OR REPLACE FUNCTION public.can_authorize_reservation(p_session_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public._may_authorize_reservation(p_session_token);
$$;
REVOKE ALL ON FUNCTION public.can_authorize_reservation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_authorize_reservation(text) TO anon, authenticated;
