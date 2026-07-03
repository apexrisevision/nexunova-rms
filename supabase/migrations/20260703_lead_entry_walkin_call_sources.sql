-- Add "Walk-in" and "Call" as lead sources for the lead_entry operator role.
-- Frontend source chips are server-driven (get_my_lead_config → create_sources),
-- so both chips appear automatically once this config row is updated.
-- Icons/labels already exist client-side: walkin→user/"Walk-in", call→phone/"Call".
UPDATE lead_role_config
SET create_sources = '["facebook","instagram","whatsapp","website","walkin","call","manual"]'::jsonb
WHERE role = 'lead_entry';
