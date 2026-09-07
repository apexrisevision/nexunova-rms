# Finding 2026-09-07-G — a slow screen paints over the one you opened next

| | |
|---|---|
| **Found** | 2026-09-07, while verifying the Reserve Desk on all four boot paths |
| **Status** | **NOT FIXED — deliberately.** Pre-existing, affects every tab, and the fix is a shell change that needs its own approval. |
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

So it needs a tap inside the boot window — a second or two on a fast connection,
longer on a phone on mobile data, which is where this portal lives. The user's
recovery is to tap the tab again, which works.

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
