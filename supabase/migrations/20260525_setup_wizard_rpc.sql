-- Setup Wizard RPC
-- Allows onboarding wizard to update brand_color, currency, timezone on the companies record.
-- Called from OB._save1() alongside update_company_profile.

CREATE OR REPLACE FUNCTION update_company_settings(
  p_company_id uuid,
  p_data       jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE companies
  SET
    brand_color = COALESCE(p_data->>'brand_color', brand_color),
    currency    = COALESCE(p_data->>'currency',    currency),
    timezone    = COALESCE(p_data->>'timezone',    timezone),
    updated_at  = now()
  WHERE id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_company_settings(uuid, jsonb) TO authenticated;
