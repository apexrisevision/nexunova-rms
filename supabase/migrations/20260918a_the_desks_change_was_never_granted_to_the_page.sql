/* ══ THE ONE DESK CALL THE PAGE WAS NEVER ALLOWED TO MAKE ════════════════
   "Mai Reserve desk se unit ka status change kar raha hun from hold to sold
   … status change b nahi hota, error deta hai could not change LG-134."

   The function was right and had been right since the day it was written: run
   against LG-134 in a rolled-back transaction it takes it Sold → Hold → Sold
   and returns success both ways. What was wrong is who may call it.

   Every other call the desk makes — reserve_unit_desk, reserve_units_desk,
   cancel_reservation, get_reserve_desk, get_reservation_daybook — is granted
   to anon, because that is what a browser holding this system's API key IS.
   The page never signs in to Postgres; it carries a sales session token and
   the function checks it. change_unit_status_desk was granted to authenticated
   and service_role only, so the desk's Change button has been failing since
   2026-09-16 in the CRM as well as on the link — the button was reasoned about
   rather than pressed, and a grant is exactly the kind of thing that reasoning
   does not catch.

   Nothing about the function's own guards changes: it still demands a live
   session, still refuses anyone who is not a director, admin or cfo, and still
   refuses a unit outside the caller's own company. anon is the key, not the
   person. ═══════════════════════════════════════════════════════════════ */

GRANT EXECUTE ON FUNCTION public.change_unit_status_desk(
  text, uuid, uuid, integer, text, uuid, uuid, text, text, text) TO anon;
