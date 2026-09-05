# NexuFinance

The cash book, on its own shell. **Same Supabase project, same auth, same users, same units and
clients as RMS.** A different shell — not a different database.

That distinction is the whole design. The data stays where it is, so Phase 2 (one entry reaching
both the client ledger and the cash book) remains a foreign key rather than an integration. What
leaves is the RMS *shell*, which is where every bug of the first week lived.

| | |
|---|---|
| **Page** | `/nexufinance.html` — same origin as RMS |
| **Component** | `js/pages/daily-closing.js` (`window.DailyClosing.mount`), unchanged |
| **Kit / formatters / CSS** | `js/foundation/dc-kit.js`, `dc-format.js`, `css/daily-closing.css`, unchanged |
| **Boot** | ~90 lines inside `nexufinance.html`. Nothing else. |
| **Server** | the same Daily Closing RPCs, plus `get_my_daily_closing_context()` (2026-09-06) |

## The four rules this page is built on

1. **One session path.** There is no "fresh login" branch, because nobody signs in here. There is
   a session or there is not. RMS's two-path split (`_completeLogin` / `tryRestoreSession`) cost
   three days and produced standing rule SR-6. **A third case is not to be added quietly** — if
   this page ever appears to need one, stop and raise it.
2. **A `try/catch` at every boundary that draws.** The mount is wrapped; the component has its own
   render guard, watchdog and error banner. A screen that cannot draw says so and offers a way out.
   It never goes blank and never sits on skeletons.
3. **Nothing reaches into a shell it does not own.** No `nxn_sess`, no `S`, no `_featureFlags`, no
   `_projectsCache`. The database client is read once, in one place, checked, and passed by value.
4. **No feature flag.** Whether somebody sees a cash book is answered by the role the server
   returns from `get_my_daily_closing_context()`. The flag — default-open, and invisible on one of
   two boot paths — is what started the whole week, and it does not exist here in any costume.

## How somebody gets here, and how they sign in

Same origin as RMS means the same `localStorage`, so the Supabase session RMS already wrote is the
one this page reads. A person signed into RMS opens the page and is already signed in.

**Nobody signs in here.** There is no login form in this file and there should never be one. With
no session the page shows a gate with a link to `/login.html`.

> **Not done yet:** `?next=` support in `login.html`, so signing in returns you here instead of to
> the RMS dashboard. Day 4.

## ⚠️ What this app inherits from RMS, and why it matters more here

Borrowing RMS's session means borrowing RMS's session *lifetime*, including its defects.

**`docs/findings/2026-09-04-A-session-timers.md` applies to this page in full.** On a restored
session — which is how everybody arrives — RMS starts neither the idle timer nor the five-minute
`check_session_valid` poll. So:

- **A NexuFinance tab does not time out.** Left open, it stays open.
- **A revoked session keeps working.** Changing somebody's password does not sign out a tab that
  is already showing the cash book.
- `nxn_active` is never stamped on a restored session, so the week-long persistent check measures
  from the user's last *fresh* login rather than their last activity.

**Why this is worse here than in RMS.** In RMS an unattended tab shows leads and reports. Here it
shows, and can *write to*, the cash book: recording receipts and expenses, and closing a day
against a counted drawer. An unlocked screen in an accounts room is a different exposure from an
unlocked screen on a leads list, and the ability to *post* is the part that matters.

**This is recorded, not solved here.** Finding A belongs to RMS and travels with RMS; fixing it
there fixes it for both. It is written down in this file so that nobody deploying NexuFinance
believes the move to a new shell bought a fresh session model. It did not — that was the point of
sharing auth, and this is the price of it.

`docs/findings/2026-09-04-C-nav-swallows-sync-throws.md` does **not** apply: this page has no
router. It is listed here only so the next person does not go looking for it.

## What is proved, and what is not

**Proved against the live database, with a real password sign-in and no stubbing** (ZZTEST, never
Awami): the page boots with no gate; company, user and role come from the server; there is exactly
**one** `.dc` node, so the hidden-page mount trap cannot occur; the day loads to a terminal state
with no skeletons; the composer renders for a CFO on an open day; no page errors.

**Not yet proved end to end through the UI:** a recorded entry. The server contract is exercised by
the existing suites, and the composer was reached and filled — but the harness could not drive the
payee entity-select reliably, and the fixture day it was aimed at (584 entries) loads slowly enough
on a poor connection to flirt with the component's 15-second watchdog. Both are harness and fixture
problems, not page defects, and neither is on the pilot's path: Awami's first day has no entries at
all. **It is stated here rather than glossed, because "the page loads" was never the bar.**

> **Worth watching, and not tuned:** the watchdog is 15 s. A day with several hundred entries on a
> slow link can legitimately exceed that, and the user would then be told the screen "did not
> finish loading" when it was merely slow. Awami will not meet this on day one. It will meet it
> eventually.
