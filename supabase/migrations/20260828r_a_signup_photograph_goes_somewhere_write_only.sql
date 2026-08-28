-- Somebody applying for a portal login photographs their CNIC before they have
-- an account, so the upload has to be anonymous. That part was already built
-- properly: salessignup_anon_upload let anon INSERT only under sales-signup/,
-- and only into the folder of a live signup token. There was no anon policy for
-- reading, listing, updating or deleting, and never had been.
--
-- None of which mattered, because the bucket it wrote to is PUBLIC. A public
-- bucket serves /object/public/... without consulting row-level security at
-- all, so every one of those cards could be read by anyone holding the address.
-- The permission was never the hole. The address was.
--
-- So the pre-login upload gets a bucket of its own that answers nobody. It is
-- deliberately NOT employee-private: this is the one place in the system where
-- an unauthenticated stranger can write, and that trust level deserves its own
-- room rather than a corner of the room where staff documents live.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signup-uploads', 'signup-uploads', false, 8388608,
        array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do update set public = false;

-- WRITE, and only write. The same two conditions as before: under sales-signup/,
-- in the folder of a token that is actually open. A stranger cannot invent a
-- folder, because a folder that is not a live token fails the check.
drop policy if exists signup_uploads_anon_write on storage.objects;
create policy signup_uploads_anon_write
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'signup-uploads'
    and (storage.foldername(name))[1] = 'sales-signup'
    and public.sales_signup_token_valid((storage.foldername(name))[2])
  );

-- Reading is for the office that has to look at the application. The token in
-- the path says which business it was addressed to; an administrator of that
-- business may look, and so may one of a company in the same dealer group,
-- because an umbrella really does approve its dealers' people.
create or replace function public._rms_may_read_signup_upload(p_token text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_me public.app_users; v_co uuid;
begin
  v_me := public._rms_caller();
  if v_me.id is null then return false; end if;
  if not public._rms_is_admin(v_me) then return false; end if;

  select id into v_co from public.companies
   where sales_signup_token = p_token and status = 'active' limit 1;
  if v_co is null then
    select c.id into v_co from public.company_groups g
      join public.companies c on c.id = g.home_company_id
     where g.signup_token = p_token and g.is_active and c.status = 'active' limit 1;
  end if;
  if v_co is null then return false; end if;

  return v_co = v_me.company_id
      or coalesce(v_me.is_super_admin, false)
      or exists (select 1 from public.companies a
                   join public.companies b on b.dealer_group_id = a.dealer_group_id
                  where a.id = v_me.company_id and b.id = v_co
                    and a.dealer_group_id is not null);
end $$;

revoke all on function public._rms_may_read_signup_upload(text) from public, anon;
grant execute on function public._rms_may_read_signup_upload(text) to authenticated;

drop policy if exists signup_uploads_admin_read on storage.objects;
create policy signup_uploads_admin_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'signup-uploads'
    and (storage.foldername(name))[1] = 'sales-signup'
    and public._rms_may_read_signup_upload((storage.foldername(name))[2])
  );

-- Nothing else. No UPDATE policy, no DELETE policy, and no SELECT for anon:
-- what is missing here is as deliberate as what is present.
do $$
declare v int;
begin
  select count(*) into v from pg_policy
   where polrelid='storage.objects'::regclass
     and coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) like '%signup-uploads%';
  if v <> 2 then raise exception 'expected exactly two policies on signup-uploads, found %', v; end if;

  select count(*) into v from pg_policy
   where polrelid='storage.objects'::regclass
     and coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) like '%signup-uploads%'
     and 'anon' in (select rolname from pg_roles where oid = any(polroles))
     and polcmd <> 'a';
  if v <> 0 then raise exception 'anon was given something other than insert'; end if;

  if (select public from storage.buckets where id='signup-uploads') then
    raise exception 'the new bucket is public — that is the whole thing we were fixing';
  end if;
end $$;
