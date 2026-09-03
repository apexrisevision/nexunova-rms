-- ═══════════════════════════════════════════════════════════════════════════
-- The Khushal Bagh sale team reports to its manager
-- ───────────────────────────────────────────────────────────────────────────
-- Abubakkar signed up in the Self Service Portal as a marketing_manager and is
-- the manager for Khushal Bagh Heights. The role already carries what a manager
-- needs for leads — lead_role_config has marketing_manager receiving from
-- director and assigning to sale_rep — but the company's org tree is flat:
-- every one of its thirty staff points at Rashid Manzoor. get_my_team() walks
-- parent_sales_user_id recursively, so until that changes his team is empty and
-- there is nobody for him to hand a lead to.
--
-- WHO MOVES. The seven sale_rep accounts whose staff tag (home_project_id) is
-- KHUSHAL BAGH HEIGHTS. Nobody else: the four tagged Fourteen Manzil Height
-- stay where they are, and so do accounts, HR, engineering, reception, recovery
-- and lead entry — they are not sales, and this is a sales manager. That is
-- what keeps his reach to sales alone; it is not a separate rule to maintain,
-- it is simply who reports to him.
--
-- The staff tag is a label rather than a gate elsewhere in this system, but it
-- is the only record of which project a person actually sells, so it is what
-- decides the seven. They are named below rather than selected by tag alone, so
-- that re-running this cannot quietly sweep in somebody tagged later.
--
-- Leave and official-visit approval are deliberately NOT here. Those live in
-- NexuAttend and are decided by the HOD; the portal can only apply for them
-- (the bridge offers apply_leave, request_visit and their cancels, and no
-- approve at all). Asked for and then withdrawn — noted so nobody looks for it.
--
-- REVERSIBLE. Every row's previous parent and tag is written to
-- rms_backup.sales_org_20260903 first; the undo is at the foot of this file.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists rms_backup;

create table if not exists rms_backup.sales_org_20260903 (
  id                    uuid primary key,
  full_name             text,
  role                  text,
  parent_sales_user_id  uuid,
  home_project_id       uuid,
  taken_at              timestamptz not null default now()
);

do $$
declare
  v_mgr      uuid := 'f495d89f-1cfe-4d5f-989d-bfa08ff8fac1';  -- Abubakkar
  v_kbh      uuid := '7f70ba90-130e-42b5-801b-4c9bafa82975';  -- KHUSHAL BAGH HEIGHTS
  v_co       uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce';  -- Awami Market
  v_team     uuid[] := array[
    '2a41bfa5-854d-4f39-9686-ae078b5d9d7a',   -- Alyan ali shah
    '932ed82e-80a3-45ec-8c75-e456cae784cf',   -- Fawad khan
    '7a89dec1-af53-40a6-817f-e2a6d2db23b6',   -- IQRA
    'fbbbbe4a-6ae0-45f3-a244-b154bf6c4233',   -- Malik Sikandar
    '4b968a03-b5df-4d82-a70b-55b26e01831c',   -- Muhammad Afaq Shahid
    '76b9b246-c240-48c0-a58c-f8b891a45048',   -- Muhammad Saeed
    'c2bd099d-754c-4c9e-9fa5-c3d328af965f'    -- Salman Sajjad
  ]::uuid[];
  v_n        int;
begin
  -- the manager must be who this file thinks he is
  perform 1 from public.sales_users
   where id = v_mgr and company_id = v_co and role = 'marketing_manager' and status = 'active';
  if not found then
    raise exception 'the manager is not an active marketing_manager in this company — refusing to move anybody';
  end if;

  -- and every one of the seven must be an active sale_rep in the same company
  select count(*) into v_n
    from public.sales_users
   where id = any(v_team) and company_id = v_co and role = 'sale_rep' and status = 'active';
  if v_n <> array_length(v_team, 1) then
    raise exception 'expected % active sale_reps, found % — refusing', array_length(v_team,1), v_n;
  end if;

  /* A parent cycle in this table once filled the disk: the recursive team query
     has no depth stop, so a loop runs until something gives out. The manager
     must not already be under one of the people about to be put under him. */
  if exists (
    with recursive up as (
      select id, parent_sales_user_id from public.sales_users where id = v_mgr
      union all
      select su.id, su.parent_sales_user_id
        from public.sales_users su join up on su.id = up.parent_sales_user_id
    ) select 1 from up where id = any(v_team)
  ) then
    raise exception 'the manager already reports to one of these seven — this would make a loop';
  end if;

  insert into rms_backup.sales_org_20260903 (id, full_name, role, parent_sales_user_id, home_project_id)
  select id, full_name, role, parent_sales_user_id, home_project_id
    from public.sales_users
   where id = any(v_team) or id = v_mgr
  on conflict (id) do nothing;

  update public.sales_users
     set parent_sales_user_id = v_mgr, updated_at = now()
   where id = any(v_team) and company_id = v_co;
  get diagnostics v_n = row_count;
  raise notice 'reports-to moved for % people', v_n;

  -- the manager carries the same tag as the team he manages
  update public.sales_users
     set home_project_id = v_kbh, updated_at = now()
   where id = v_mgr and home_project_id is distinct from v_kbh;
end $$;

-- ── undo ───────────────────────────────────────────────────────────────────
-- update public.sales_users su
--    set parent_sales_user_id = b.parent_sales_user_id,
--        home_project_id      = b.home_project_id
--   from rms_backup.sales_org_20260903 b
--  where b.id = su.id;
