-- Awami Market's business email on its letters (and billing) becomes
-- info@fourteen.pk (Rashid, 2026-10-14: "amartaj55@gmail.com aa raha hai email
-- change karke info@fourteen.pk karo"; told that billing uses it too).
UPDATE public.companies SET business_email = 'info@fourteen.pk', updated_at = now()
 WHERE id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND business_email = 'amartaj55@gmail.com';
