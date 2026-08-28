-- salessignup_anon_upload let an unauthenticated stranger write into
-- rms-documents, which is public. Everything they put there was readable by
-- anyone who knew the address — which is how seventy-eight identity cards came
-- to be sitting in the open. Applications now go to signup-uploads instead, so
-- this door has nothing left to open and should not stay ajar.
--
-- The 57 files already under sales-signup/ are left exactly where they are, as
-- instructed. Closing this stops anything NEW arriving there; it removes nothing.
drop policy if exists salessignup_anon_upload on storage.objects;

do $$
declare v int;
begin
  select count(*) into v from pg_policy
   where polrelid='storage.objects'::regclass
     and 'anon' in (select rolname from pg_roles where oid = any(polroles))
     and polcmd <> 'a';
  if v <> 0 then raise exception 'anon can do something other than insert (% policies)', v; end if;

  select count(*) into v from pg_policy
   where polrelid='storage.objects'::regclass
     and 'anon' in (select rolname from pg_roles where oid = any(polroles))
     and coalesce(pg_get_expr(polwithcheck, polrelid),'') like '%rms-documents%';
  if v <> 0 then raise exception 'anon can still write into the public bucket'; end if;
end $$;
