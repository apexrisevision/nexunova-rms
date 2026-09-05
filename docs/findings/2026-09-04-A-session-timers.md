# Finding 2026-09-04-A — a restored session starts none of its security timers

| | |
|---|---|
| **Found** | 2026-09-04, while fixing the Daily Closing sidebar gate |
| **Written up** | 2026-09-05 |
| **Status** | **UNTRIAGED — not fixed, deliberately.** Scheduled after the Awami parallel run. |
| **Scope** | RMS shell. **Every tenant, every user.** Nothing to do with Daily Closing. |
| **Severity** | Security. Not cosmetic, not tidiness. |

Found the same way, and with the same shape, as the feature-flag bug fixed in `aa181ec`:
something the shell needs was wired into the fresh-login path and never into the returning-visit
path. That fix is shipped. **This one is not, and this document is not authorisation to ship it.**

---

## 1 · What breaks

RMS reaches the app shell two ways, and they are separate code:

| | | |
|---|---|---|
| fresh login | `_completeLogin()` | `js/auth.js:310` |
| returning visit | `tryRestoreSession()` | `js/init.js:33` |

The second is what runs on every hard refresh, every reopened tab, and every return to a browser
that still holds a session. It is how everybody but a developer arrives. A fresh login happens
once, and then usually only after a sign-out or a password change.

Two functions are called from **one place only**, and that place is the first path:

| | |
|---|---|
| `js/auth.js:417` | `_startSessionCheck();` |
| `js/auth.js:418` | `_startIdleTimer();` |

`tryRestoreSession()` calls neither, and no other file does. A grep for both call names across
`js/` returns those two call sites, the two declarations, and one re-arm inside
`_setIdleTimeoutMin()` (`js/auth.js:929`) which only runs when an admin changes the setting
*from inside an already-timered session*.

### 1a · The idle timeout does not run

`_startIdleTimer()` (`js/auth.js:816`) is what binds the six activity listeners
(`mousemove`, `mousedown`, `keydown`, `touchstart`, `scroll`, `click`), sets `_idleActive = true`,
and calls `_scheduleIdleLogout()` (`js/auth.js:849`) to arm the warning bar and the logout.
Without it, `_idleActive` stays `false`, no timer is armed, `_showIdleWarning()`
(`js/auth.js:856`) can never fire and `_onIdleExpire()` (`js/auth.js:875`) can never fire.

**A restored tab is never signed out for inactivity, however long it sits.**

### 1b · The persistent check measures from a clock that stopped

This is the part that is easy to miss, and it is the worse half.

`_stampActive()` (`js/auth.js:909`) is what writes `localStorage.nxn_active`. It is called from
exactly one place — `_resetIdleTimer()` at `js/auth.js:839` — and `_resetIdleTimer` only ever
runs as a listener **bound by `_startIdleTimer()`**. So on a restored session **nothing ever
stamps the clock**.

A timer cannot see time that passed while the app was closed, which is why the stamp exists:
`tryRestoreSession()` applies the rule once at boot (`js/init.js:46`, `_idleTooLong()` at
`js/auth.js:915`). But it compares `Date.now()` against a stamp last written during the user's
most recent *fresh login* session.

> Someone who signs in on Monday and then works all week through reopened tabs is measured
> against Monday. Heavy use does not postpone the eviction, because heavy use is not being
> recorded.

With the default of one week (`_IDLE_DEFAULT_MIN = 7 * 24 * 60`, `js/auth.js:894`) that surfaces
as a forced re-login that looks arbitrary to the user and has no visible cause.

So the timeout is wrong in **both directions at once**: it does not fire when it should (inside a
long-lived restored tab) and it does fire when it should not (on a return after a week of daily
use).

### 1c · Session-validity polling does not run

`_startSessionCheck()` (`js/auth.js:701`) schedules `_checkSessionValidity()` (`js/auth.js:711`)
every five minutes. That poll does two things:

1. Calls `check_session_valid(p_user_id, p_session_version)`. The RPC returns
   `valid = (app_users.session_version = p_session_version)`. On `valid: false` the client shows
   *"Your password was changed. Please sign in again."* and signs out (`js/auth.js:718-722`).
2. Adopts the role and `module_permissions` the same RPC hands back, via
   `_applyLivePermissions()` (`js/auth.js:734`) — `S.permissions` is a **snapshot taken at
   login**, so this poll is the only thing that refreshes it without a sign-out.

Neither happens on a restored session. Concretely:

- **A password change does not sign out live tabs.** The revoked session keeps working until the
  tab is closed.
- **A module granted or revoked in Users & Roles never reaches the user.** They keep the access
  they had at their last fresh login, in both directions.

### 1d · What is NOT affected

`_registerSession()` and `_startSessionHeartbeat()` are also skipped by `tryRestoreSession()`,
but they **self-heal**: the IIFE at `js/auth.js:538-551` runs 1.8 s after `DOMContentLoaded`,
finds the Supabase session and starts both. "Time on system" in the Command Center is correct
and is not part of this finding.

---

## 2 · Who is affected

Everyone, on every tenant, because the restore path is not an edge case — it is the normal one.

Live counts at the time of writing:

| Tenant | Users | Active | Ever had `session_version` bumped |
|---|---:|---:|---:|
| FMH | 3 | 3 | **3** |
| Fourteen Group of companies (KBH) | 2 | 2 | **1** |
| Awami Market | 1 | 1 | 0 |
| ZZTEST / test tenants | 12 | 10 | 4 |

`company_security_settings` is **empty** — no tenant has ever saved a session timeout, so every
browser falls back to `_IDLE_DEFAULT_MIN`, one week.

Both of those rows matter again in §4.

---

## 3 · What the correct behaviour should be

1. **The timers belong to a signed-in session, not to the act of signing in.** Both should start
   wherever the shell is established, which after `aa181ec` means one place both paths call —
   the same shape as `startShellContext()`. Adding them to `tryRestoreSession()` as two more
   lines would repeat the mistake this finding is about: a third entry path added later would
   miss them again.
2. **`nxn_active` must be stamped on any live session**, not only one that happens to have a
   timer bound. The boot check is only meaningful if the stamp tracks real use.
3. **`_getIdleTimeoutMin()` should read the company setting, not just `localStorage`.**
   `secSaveTimeout()` (`js/pages/admin.js:585`) saves `session_timeout_min` to the server via
   `save_security_settings`, but `_getIdleTimeoutMin()` (`js/auth.js:895`) only ever reads
   `localStorage['rms.sec.timeout.' + cid]`, which `_setIdleTimeoutMin()` writes **on the
   admin's own browser only**. So a company timeout has never applied to anybody except the
   admin who typed it, on the machine they typed it on. This is a separate defect living in the
   same code, and it must be settled *before* the timers are switched on, or the fix will start
   enforcing a value nobody chose. It is invisible today only because the table is empty.
4. **Consider whether `_checkSessionValidity` should also run once at boot**, not only after the
   first five-minute tick — a restored tab is exactly where a stale `session_version` is most
   likely to be sitting.

---

## 4 · What would change for a KBH or FMH user the moment this is fixed

This is the reason it cannot just be shipped. Every item below is something a real person on a
live tenant would notice, on their first page load after the deploy.

### 4a · Some users would be signed out at once, and told their password changed

The first `_checkSessionValidity()` tick compares the `session_version` stored in that browser's
`nxn_sess` against the current one in `app_users`. **All three FMH users, and one of the two KBH
users, have had their `session_version` bumped at some point.** Whether a given browser holds a
stale value depends on whether that person logged in fresh after the bump — which is not knowable
from the server, only from their browser.

Anyone holding a stale value is signed out within five minutes of the deploy, with the message
*"Your password was changed. Please sign in again."* That message would be **wrong and alarming**
for someone whose password was changed months ago and who has been working fine ever since.

This is the sharpest edge in the finding. It should be measured before shipping, not discovered
afterwards — and if it cannot be measured, the deploy should be announced to those users first.

### 4b · Idle logout starts existing — after a week, with a warning bar

With `company_security_settings` empty, the effective timeout is `_IDLE_DEFAULT_MIN`, one week.
So this is *not* the disruptive change it sounds like: nobody starts getting signed out after
thirty minutes. What changes is that a tab left open across a week now shows a dark warning bar
pinned to the bottom of the screen for sixty seconds (`js/auth.js:856-874`) and then signs out.

Neither KBH nor FMH has seen that bar before. It is a new UI element appearing without
explanation, so it needs a line in whatever note goes out with the release.

**But see §3.3.** If the server-read is fixed at the same time, and any tenant has by then saved
a short value, this stops being a one-week change and becomes a same-day one. Check the table at
the moment of shipping, not on the strength of this document.

### 4c · The unexplained forced re-login stops happening

The one unambiguous improvement. Today a KBH or FMH user who works daily through reopened tabs
is evicted a week after their last *fresh login*, regardless of use, with no cause they can see.
Once the stamp tracks real activity, that stops. Anyone who has complained about being "randomly
logged out" was probably describing this.

### 4d · Access changes start taking effect without a sign-out

`_applyLivePermissions()` would begin running, so a module ticked or unticked in Users & Roles
reaches the user within five minutes and the sidebar rebuilds itself with a *"Your access was
updated"* notice.

This is the intended behaviour and it is better. It is also a **visible change for admins**, who
have learned to tell people to sign out and back in. Two consequences worth stating: a
*revocation* now takes effect on a screen the person may be looking at, and `S.permissions` in
`localStorage` starts being rewritten from the server rather than from login.

### 4e · One RPC per user per five minutes, forever

`check_session_valid` becomes a permanent background call for every open tab on every tenant.
At today's size (6 active KBH + FMH users) that is negligible. It is worth stating because it is
a floor that never goes away, it scales with users and open tabs, and the same RPC now also
drives the sidebar rebuild in 4d.

### 4f · Six activity listeners on every page, on every restored session

`mousemove` and `scroll` fire constantly. They are registered `{ passive: true }`,
`_resetIdleTimer()` is cheap, and the `localStorage` write inside `_stampActive()` is throttled
to once a minute (`js/auth.js:910-911`) — but the handler itself runs on every event, doing two
`clearTimeout`s and two `setTimeout`s. Measure it on a low-end phone before assuming it is free;
the Sales Portal is used on phones.

---

## 5 · How long this has existed

Not established. `tryRestoreSession()` predates the security work that added the timers, so the
likely shape is that the timers were added to the login path and the restore path was never
revisited. Establishing the date is one `git log -S` on `_startIdleTimer` away, and is worth
doing when the work is scheduled, because it sets how long KBH and FMH sessions have been
running without an idle timeout.

---

## 6 · Related

- Standing rule **SR-6** (`docs/daily-closing/PHASES.md`) — a fix verified on one entry path is
  unverified on every other. Written because of this finding's sibling.
- `docs/daily-closing/ARCHITECTURE_NOTES.md` — "Two boot paths, not one", and the table of the
  ten calls `tryRestoreSession()` skips.
- Commit `aa181ec` — the shell-context fix, which is the shape the fix for this should follow.
