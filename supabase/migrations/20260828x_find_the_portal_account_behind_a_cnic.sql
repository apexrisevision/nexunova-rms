-- The one thing the bridge needs on this side to deliver a decision: which
-- portal account belongs to a CNIC the attendance register gave it.
--
-- It answers with an id and a company and nothing else — no name, no phone, no
-- role. A caller who somehow reached it learns only that some account exists,
-- which they had to know already to ask.
create or replace function public.portal_user_by_cnic(p_cnic text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_id uuid; v_co uuid; v_n int;
begin
  if coalesce(btrim(p_cnic), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'no_cnic');
  end if;

  -- compared on digits alone: the two systems write it differently
  select count(*) into v_n
    from public.sales_users
   where regexp_replace(coalesce(cnic, ''), '\D', '', 'g') = regexp_replace(p_cnic, '\D', '', 'g')
     and is_active;

  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'no_portal_account'); end if;
  -- Two accounts on one CNIC is a data problem, not something to guess through.
  if v_n > 1 then return jsonb_build_object('ok', false, 'error', 'cnic_duplicated'); end if;

  select id, company_id into v_id, v_co
    from public.sales_users
   where regexp_replace(coalesce(cnic, ''), '\D', '', 'g') = regexp_replace(p_cnic, '\D', '', 'g')
     and is_active;

  return jsonb_build_object('ok', true, 'sales_user_id', v_id, 'company_id', v_co);
end $$;

revoke all on function public.portal_user_by_cnic(text) from public, anon, authenticated;
