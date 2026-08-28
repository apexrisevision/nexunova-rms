-- The owner's id is the second segment of the path. Every path is chosen by the
-- server, so it is always an id — but a client is free to ASK for a name that is
-- not, and the answer to that should be a plain no, not a raised error.
-- A function that raises behaves differently for a probing caller than for an
-- honest one, which is itself a small thing to learn from.
create or replace function public._rms_uuid_or_null(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end $$;

revoke all on function public._rms_uuid_or_null(text) from public;
grant execute on function public._rms_uuid_or_null(text) to authenticated;

drop policy if exists employee_private_admin_read on storage.objects;
create policy employee_private_admin_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-private'
    and (storage.foldername(name))[1] = any (array['identity','profile'])
    and public._rms_may_read_employee_doc(
          public._rms_uuid_or_null(nullif((storage.foldername(name))[2], ''))
        )
  );

do $$
begin
  if public._rms_uuid_or_null('not-a-uuid') is not null then
    raise exception 'the safe cast is not safe';
  end if;
end $$;
