-- The admin door was shut on the admin.
--
-- Every storage policy on this project asks _rms_caller() who is knocking, and
-- no client role could execute it. Nobody noticed, because rms-documents is a
-- public bucket: reads never went through row-level security at all, so the
-- policies that use it have been failing quietly and granting nothing.
-- employee-private is the first bucket where the answer actually matters, and
-- there the failure is not quiet — it refuses the administrator too.
--
-- _rms_caller() is SECURITY DEFINER and returns exactly one row: the caller's
-- own active app_users record, found by auth.uid(). A signed-in person learning
-- who they themselves are is not a disclosure. anon is deliberately left out —
-- with no auth.uid() there is no row to return, and no reason to offer.
grant execute on function public._rms_caller()  to authenticated;
grant execute on function public._rms_is_admin(public.app_users) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'public._rms_caller()', 'EXECUTE') then
    raise exception 'the administrator still cannot ask who they are';
  end if;
  if has_function_privilege('anon', 'public._rms_caller()', 'EXECUTE') then
    raise exception 'anon was let in — that was not the intention';
  end if;
end $$;
