-- The documents are across — 78 files, 26 people — and the two temporary actions
-- have been taken out of the bridge. Nothing can present a ticket any more, so
-- the desk that issued them has no reason to exist.
drop table if exists public._doc_move_ticket;

do $$
declare v_left int;
begin
  select count(*) into v_left from public.sales_users
   where (profile_photo_url is not null and profile_photo_path is null)
      or (cnic_front_url  is not null and cnic_front_path  is null)
      or (cnic_back_url   is not null and cnic_back_path   is null);
  if v_left <> 0 then raise exception '% employee documents were left behind', v_left; end if;
end $$;
