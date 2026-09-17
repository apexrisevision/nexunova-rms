/* ══ THE ROOM TELLS THE DESK WHOSE BUILDING IT IS ════════════════════════
   "Director login pe jo tum ne CRM connection banaya hai, mobile pe mera
   password save hai to direct login utha laita hai, magar laptop pe login aur
   password nahi laita, login ghalat deta hai — jab k mai theek de raha hun
   +923219694246 aur pin b theek hai."

   The mobile and the PIN were right. The company code was not, and could not
   have been: the desk's sign-in asks for three things, and the third is a code
   nobody types from memory. On the phone it never came up — the password
   manager fills what it filled at signup, and before that a CRM session was
   already on the device — so the field only ever had to be right on a laptop,
   where there was nothing to fill it and nothing to look it up in.

   Awami's code is "awami". The link already knows the building, so the link
   should answer that question rather than asking it, and the field disappears.

   This adds one key to the directors' report: company_code, beside the company
   name that has always been there. It is behind the report password with the
   rest of the report, and it is not a secret in any case — it is the code that
   tenant's own people type into the CRM every morning.

   Patched by replacing ONE line of the existing definition, read out of the
   catalogue, rather than rewriting the function: this is the one whose
   wholesale rewrite once took the directors' room down. ═════════════════ */

DO $do$
DECLARE
  src text; out_src text;
  old_x constant text := $x$    'company', COALESCE(c.display_name, c.company_name),$x$;
  new_x constant text := $x$    'company', COALESCE(c.display_name, c.company_name),
    /* which tenant this is, so the Reserve Desk on this link can sign a
       director in without asking them for a code they do not carry */
    'company_code', c.company_code,$x$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_availability_report';
  IF src IS NULL THEN RAISE EXCEPTION 'get_availability_report is not there'; END IF;
  IF position($x$'company_code', c.company_code$x$ IN src) > 0 THEN RETURN; END IF;
  out_src := replace(src, old_x, new_x);
  IF out_src = src THEN
    RAISE EXCEPTION 'the company line is not where it was expected — nothing changed';
  END IF;
  EXECUTE out_src;
END $do$;
