# Finding 2026-09-07-G — a slow screen paints over the one you opened next

| | |
|---|---|
| **Found** | 2026-09-07, while verifying the Reserve Desk on all four boot paths |
| **Status** | **PARTLY FIXED 2026-09-07 (Stage 4, approved).** The Reserve Desk is protected; the general shell race is NOT — see §7. Measured before and after: §3, §6, §7. |
| **Scope** | `sales-portal.html`. **Every portal user, every tenant.** Nothing specific to the Reserve Desk. |
| **Severity** | Low frequency, confusing when it happens. No data is lost or wrongly written. |

---

## 1 · What happens

Every screen renderer in the portal writes into the single `#app-body` node, and
most of them `await` one or more RPCs before they do. Nothing checks, after the
await, that the screen it is about to paint is still the screen the user is on.

So two navigations that overlap resolve in completion order, not in the order the
user asked for:

```
setTab('home')  → renderManagerHome()  ── awaits 4 RPCs ──┐
   user taps "Reserve Desk"                               │
setTab('desk')  → renderReserveDesk()  ── awaits 1 RPC ───┼─→ desk paints
                                                          └─→ home paints OVER it
```

The shell is then in a state it believes is impossible: `TAB === 'desk'`, the nav
rail highlights Reserve Desk, the app bar reads "Reserve Desk", and the body
shows the dashboard.

## 2 · How it was seen

`scripts/verify-reserve-desk.js` drove a real browser through a fresh login and
opened the desk immediately. Traced across twelve polls, 400 ms apart:

```
TAB=desk / body=<div class="nx-dash">   ×12
```

The desk had rendered — the driver waited for `#rd-root` and found it — and was
then replaced by the home dashboard while `TAB` stayed `desk`. Earlier in the
same run a **booking was taken and committed** on the desk (`toast: "UG-10B
reserved for ZZTEST Agent · 7d"`) a moment before the dashboard wiped the screen.
The reservation was saved correctly; the operator was simply no longer looking at
the desk that took it.

## 3 · Who is exposed, and how narrowly

| Path | Exposed? | Why |
|---|---|---|
| deep link `?tab=desk` | **No** | `_showApp()` calls `setTab(PENDING_TAB\|\|'home')`, so home never renders |
| tab switch after boot | **No** | nothing else is mid-flight |
| fresh login, then tap a tab **during** boot | **Yes** | home is still awaiting its RPCs |
| restored session, then tap during boot | **Yes** | same |

So it needs a tap inside the boot window. **That window was measured rather than
guessed** — `scripts/measure-desk-overpaint.js` signs in for real, waits N ms,
opens the desk, and checks four seconds later whether it survived:

| Tap delay after login completes | localhost | slow 3G (400 kbps / 400 ms RTT) |
|---|---|---|
| 0 ms | ❌ never painted, `TAB` reverted to `home` | ❌ never painted, `TAB` reverted |
| 200 ms | ❌ never painted, `TAB` reverted | ❌ never painted, `TAB` reverted |
| 400 ms | ❌ painted, then overpainted | ❌ never painted, `TAB` reverted |
| 700 ms | ❌ painted, then overpainted | ❌ painted, then overpainted |
| 1000 ms | ✅ survived | ❌ painted, then overpainted |
| 1500 ms | ✅ survived | ✅ survived |
| 2000 ms | ✅ survived | ✅ survived |
| 3000 ms | ✅ survived | ✅ survived |

**The failing window is 0–700 ms on localhost and 0–1000 ms throttled.** Median
login itself was 420–500 ms in both.

Two things this shows that the description above understated:

1. **Below ~400 ms the tab itself is reverted**, not just the paint: `TAB` reads
   `home` afterwards, because `_showApp()`'s own `setTab('home')` runs after the
   user's `setTab('desk')`. The user's navigation is discarded outright.
2. **The window opens exactly when the app becomes visible and tappable.** The
   nav rail is on screen and live throughout it.

Caveat on the throttling: Chrome's emulation shapes the page's own traffic, but
the Supabase RPCs still cross the real internet from this machine, so a genuinely
slow connection would likely widen the window beyond the 1000 ms measured here,
not narrow it.

The user's recovery is to tap the tab again, which works.

## 4 · What was done instead

`js/portal-reserve-desk.js` guards the **other** direction — it will not paint
over a screen the user has since moved to:

```js
function _alive(tab) { return typeof TAB !== 'undefined' && TAB === tab; }
```
checked after every `await`, including the one after a booking commits (the
booking is still folded into the cache and still confirmed by toast; only the
repaint is skipped).

That makes the desk a good citizen. It does **not** protect the desk from
`renderManagerHome`, `renderHome`, `renderBoard` or any other renderer landing
late, because those are not this feature's files.

## 5 · The real fix, when it is approved

One nav token in the shell, checked by every renderer:

```js
let NAV_SEQ = 0;
function setTab(t, _back){ const my = ++NAV_SEQ; ... }
// and in each renderer, after every await:
if (my !== NAV_SEQ) return;
```

That is a change to `setTab` plus a line in roughly two dozen renderers in
`sales-portal.html`. It is mechanical but wide, it touches every screen every
user opens, and it deserves its own backup, its own verification pass and its own
approval — which is why it is written down here rather than done in passing.

See [[portal_push_gate]] for how a change that wide has to be verified before it
ships.

---

## 6 · What shipped (Stage 4, 2026-09-07)

Not the per-renderer guard sketched in §5. One mechanism, applied to every
renderer from one list, with nothing edited inside any renderer:

- `NAV = { seq, fixedFor, ... }` in `sales-portal.html`. `setTab()` bumps `seq`,
  so every navigation carries a token.
- `NAV_RENDERERS` — the 43 renderers `setTab` can dispatch to.
- `_navWrap()` wraps each of them once. The wrapper remembers the token **and
  the tab** the render belongs to; when the render finishes it corrects the
  screen only if the navigation has moved on *and* the tab has actually changed.
- `_bootTab(dflt)` — `_showApp()` no longer forces `home` over a `?tab=` deep
  link **or over a tab the person has already opened**. That is what made the
  0–400 ms cells discard the navigation outright rather than merely repaint it.

Wrapping works because these are top-level function declarations, so they are
properties of the global object and a bare call resolves through that property.
That was **verified in a real browser before the code was written**, not assumed.

### Two things this got wrong first, both caught by a check rather than by luck

1. **`_navWrap()` ran too early.** It was called from the main inline script,
   which executes *before* the seven `js/portal-*.js` files that assign
   `window.renderX` themselves. 36 of 43 were wrapped and the other seven —
   including the Reserve Desk's own — were silently left unguarded. That is
   precisely the "one was left out and we won't know which" failure this
   mechanism exists to prevent. The call moved to a trailing `<script>` after
   those files, and `verify-reserve-desk.js` now asserts, **by name**, that
   every renderer `setTab` dispatches is present in `NAV_RENDERERS` and carries
   the wrapper's mark. It reads `setTab`'s own source to do it, so the list
   cannot silently drift from the dispatch chain.
2. **The correction escalated.** The first version bumped the token on every
   correction, so a corrective render and the render it was correcting ran
   concurrently on the same tab, each finishing to find the token moved and
   asking for another correction. `npm run gate` caught it: the Director board
   rendered empty, 7 assertions down. Fixed by `fixedFor` (at most one
   correction per navigation) plus the same-tab check (a screen re-entering
   itself is not a stale paint).

### After

| Tap delay | localhost | slow 3G |
|---|---|---|
| 0 / 200 / 400 / 700 / 1000 / 1500 / 2000 / 3000 ms | ✅ all | ✅ all |

`npm run measure:overpaint` — 16 of 16 cells pass, against 4 and 5 failures
respectively before. `npm run gate` 38/38, `npm run verify:desk` 56/56.

---

## 7 · Correction — the redraw is NARROWER than §6 claimed (2026-09-07, same day)

§6 said one mechanism covers every renderer. **Detection does. The corrective
action does not, and §6 overstated it.**

`npm run gate` failed twice, reproducibly, on the same assertion: the Director
board's "See their leads" screen was *"stuck on a skeleton"*. Isolated by
disabling `_navRepaint` and re-running — 38/38 — so the correction itself was
the cause, not a flake and not the data.

**Why.** The only non-destructive way to undo a stale paint is to re-dispatch
the tab, and re-dispatching throws away whatever state a screen holds *inside*
itself. `renderTeam` re-runs and lands back on the board, dropping the drill-down
into a member's leads. Two alternatives were considered and rejected on the
evidence:

- **Restrict the correction to boot's own navigation** (`NAV.bootSeq`). Tried;
  the gate still failed. Boot's render *is* the late one, and by the time it
  lands the user has already drilled in — so the restriction excludes nothing.
- **Restore the previous `innerHTML` instead of re-dispatching.** Rejected
  without trying it in anger: replacing innerHTML builds new nodes, and every
  listener attached by `addEventListener` dies with the old ones. The screen
  would look correct and answer no clicks, which is worse than a visible flicker.

**What shipped.** `NAV_REDRAWABLE = ['desk','daybook']` — the correction fires
only when the screen being defended rebuilds losslessly from its own cache. The
desk and its daybook do. Nothing else claims to, so nothing else is touched, and
every other screen keeps the behaviour this finding describes.

**So this finding is only partly closed.** The Reserve Desk is protected. The
general shell race is not, and the proper fix is still §5: a nav token checked
by each renderer *before it paints*, which prevents the stale paint instead of
undoing it. That remains unapproved work.

### After, measured again

`npm run measure:overpaint` — 16/16 cells pass (localhost and throttled, delays
0 through 3000 ms). `npm run gate` 38/38. `npm run verify:desk` 74/74.
