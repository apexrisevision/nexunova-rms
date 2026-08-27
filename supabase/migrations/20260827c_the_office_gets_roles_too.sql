-- ============================================================================
-- The office gets roles too, and none of them touch leads.
-- ----------------------------------------------------------------------------
-- The portal has six roles and every one of them is a selling role. The people
-- who do not sell — the receptionist, the accountant, the recovery officer, HR,
-- the site engineer — have no way in, which is why the company still has no one
-- place where every employee is. These five roles are that door.
--
-- Their work screens come later. What they get today is the floor every role
-- already has: their own attendance, their leave, their pay and their file. For
-- a security guard or an office boy that floor IS the whole app, and that is
-- not a poor version of the app — it is the app.
--
-- LEADS ARE NOT PART OF IT, AND THE DATABASE IS WHAT SAYS SO.
-- Hiding a sidebar item is not a lock; that lesson cost a day this week. Two
-- things already in place make this fail closed, and both were checked rather
-- than assumed before these roles were added:
--
--   * create_lead reads lead_role_config for the caller's role and refuses when
--     the row is missing OR can_have_leads is false — 'Your role does not
--     handle leads.' A brand-new role is therefore refused by default, before
--     anybody remembers to configure it.
--   * Reading other people's leads is an allow-list, not a deny-list:
--     v_companywide := v_role IN ('director','admin','cfo'). A new role is not
--     on it and cannot become company-wide by accident.
--
-- The rows below still state can_have_leads = false explicitly rather than
-- relying on absence. Absence is an accident waiting to be "fixed" by somebody
-- inserting a default row; a false is a decision, and get_my_lead_config can
-- answer with it instead of shrugging.
--
-- Naming: the values match NexuAttend's designations, because the plan is that
-- HR sets a designation once and the portal reads the role from it rather than
-- anybody typing it twice. Receptionist, Recovery Officer, Accountant, Manager
-- HR and Site Engineer are already designations over there.
-- ============================================================================

ALTER TABLE public.sales_users DROP CONSTRAINT IF EXISTS sales_users_role_check;
ALTER TABLE public.sales_users ADD CONSTRAINT sales_users_role_check
  CHECK (role = ANY (ARRAY[
    -- the selling side, unchanged
    'sale_rep'::text, 'marketing_manager'::text, 'admin'::text, 'cfo'::text,
    'director'::text, 'lead_entry'::text,
    -- the office side, none of which handle leads
    'accounts'::text, 'recovery_officer'::text, 'hr'::text,
    'reception'::text, 'engineer'::text
  ]));

INSERT INTO public.lead_role_config (role, can_have_leads, create_sources, receives_from_role, assigns_to_role)
VALUES
  ('accounts',         false, '[]'::jsonb, NULL, NULL),
  ('recovery_officer', false, '[]'::jsonb, NULL, NULL),
  ('hr',               false, '[]'::jsonb, NULL, NULL),
  ('reception',        false, '[]'::jsonb, NULL, NULL),
  ('engineer',         false, '[]'::jsonb, NULL, NULL)
ON CONFLICT (role) DO UPDATE
  SET can_have_leads = false, create_sources = '[]'::jsonb;

-- Said out loud, because the whole point of the five rows above is that this
-- stays true.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(role, ', ') INTO v_bad
    FROM public.lead_role_config
   WHERE role IN ('accounts','recovery_officer','hr','reception','engineer')
     AND can_have_leads IS DISTINCT FROM false;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'these office roles can still hold leads: %', v_bad;
  END IF;

  -- And the allow-list for reading everybody's leads must not have grown.
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc LIKE '%v_companywide := v_role IN%'
     AND p.prosrc NOT LIKE '%v_companywide := v_role IN (''director'',''admin'',''cfo'')%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'company-wide lead access is written differently in: %', v_bad;
  END IF;
END $$;
