-- Employee identity documents move out of the open bucket.
--
-- The address becomes a PATH, not a URL, because a URL is something anyone can
-- hold and this bucket answers nobody. The old URL columns stay exactly where
-- they are: while the move is under way a record may have one, the other, or
-- both, and a screen holding only the old address must keep working. A
-- half-finished migration must not blank a document an administrator can still
-- legitimately see.
--
-- Layout is chosen by the server, never by a browser:
--     identity/<sales_user_id>/<uuid>.<ext>
--     profile/<sales_user_id>/<uuid>.<ext>
-- The owner's id is the second segment, and that is the whole access rule.
-- There is nothing worth guessing: guessing correctly still fails the
-- comparison, because the comparison is against who is asking.

alter table public.sales_users
  add column if not exists profile_photo_path text,
  add column if not exists cnic_front_path    text,
  add column if not exists cnic_back_path     text;

alter table public.agents
  add column if not exists profile_photo_path text,
  add column if not exists cnic_front_path    text,
  add column if not exists cnic_back_path     text;

-- May the person asking read this employee's documents? Only an administrator,
-- and only of that employee's own business — or of one in the same dealer group,
-- because an umbrella genuinely does administer its dealers' staff.
create or replace function public._rms_may_read_employee_doc(p_owner uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE v_me public.app_users; v_co uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN false; END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN false; END IF;

  SELECT company_id INTO v_co FROM public.sales_users WHERE id = p_owner;
  IF v_co IS NULL THEN RETURN false; END IF;

  RETURN v_co = v_me.company_id
      OR COALESCE(v_me.is_super_admin, false)
      OR EXISTS (SELECT 1 FROM public.companies a
                   JOIN public.companies b ON b.dealer_group_id = a.dealer_group_id
                  WHERE a.id = v_me.company_id AND b.id = v_co
                    AND a.dealer_group_id IS NOT NULL);
END $function$;

revoke all on function public._rms_may_read_employee_doc(uuid) from public, anon;
grant execute on function public._rms_may_read_employee_doc(uuid) to authenticated;

-- The admin app's own door. The portal has no key of its own and never gets
-- one — it goes through the bridge, which signs for 120 seconds.
drop policy if exists employee_private_admin_read on storage.objects;
create policy employee_private_admin_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-private'
    and (storage.foldername(name))[1] = any (array['identity','profile'])
    and public._rms_may_read_employee_doc((nullif((storage.foldername(name))[2], ''))::uuid)
  );
