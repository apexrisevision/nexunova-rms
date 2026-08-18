-- ═══════════════════════════════════════════════════════════════════════════
-- The share-link RPCs must be callable by `anon`, and here is why
--
-- The sales portal is an UNAUTHENTICATED supabase client: it holds the publishable
-- anon key and identifies its user with a sales_sessions token passed as an
-- argument, not with a JWT. So every portal RPC runs as the `anon` role — the
-- same role a stranger has. Authorisation is not the GRANT, it is the first ten
-- lines of each function: a live sales_sessions row, then a director/admin/cfo
-- role check, then _map_scope_companies() to bound the answer to that director's
-- own companies.
--
-- 20260817f revoked EXECUTE from PUBLIC on the three management functions and
-- granted only `authenticated`. That reads like tighter security and is in fact
-- none at all — it simply made the screen return 401 for every real director,
-- which is what the browser harness caught. Restoring EXECUTE to anon changes no
-- privilege: a caller without a director session still gets
-- {"success":false,"error":"not_allowed"} and no data.
--
-- get_public_availability is untouched — it was always meant for anon.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.create_availability_link(text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.revoke_availability_link(text, text)       TO anon;
GRANT EXECUTE ON FUNCTION public.list_availability_links(text)              TO anon;

-- the hashing helper stays private: nothing outside these functions needs it
REVOKE ALL ON FUNCTION public._availability_token_hash(text) FROM PUBLIC, anon;
