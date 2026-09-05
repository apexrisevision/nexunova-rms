# Finding 2026-09-04-C — a page that throws while rendering freezes the whole shell

| | |
|---|---|
| **Found** | 2026-09-05, diagnosing the Daily Closing skeleton freeze |
| **Written up** | 2026-09-05 |
| **Status** | **UNTRIAGED — not fixed, deliberately.** To be scheduled with [2026-09-04-A](2026-09-04-A-session-timers.md). |
| **Scope** | `js/ui.js` — `nav()`. **Every page, every tenant.** |
| **Severity** | Availability. A whole screen becomes unusable with nothing on it to say so. |

The Daily Closing half of this has been fixed inside that module: it now always ends on something
a person can act on. **This entry is about the shell**, which is why every other page in RMS can
still fail the same way, and it is not touched here because it changes behaviour for KBH and FMH.

---

## 1 · What breaks

`js/ui.js:1023-1028`:

```js
const fn = fns[pg];
if (fn) {
  const result = fn(x);
  if (result && typeof result.then === 'function') {
    result.catch(err => console.error('Navigation error:', err));
  }
}
```

A page renderer that returns a **rejected promise** is handled — the rejection is logged. A page
renderer that **throws synchronously** is not: the exception propagates out of `fn(x)`, out of
`nav()`, and out of whatever called `nav()` — a sidebar click handler, `tryRestoreSession()`,
another page's button.

Nothing after the throw runs. In particular:

- `setTimeout(cleanLeakedCodeText, 0)` at the end of `nav()` never runs;
- the target page's `#pg-<key>` container keeps **whatever was in it at the moment of the throw**.

That last point is what makes it invisible instead of loud. A renderer that paints a loading state
first and fetches second — which is the correct pattern, and what most RMS pages do — leaves the
loading state on screen. The user sees a spinner or a skeleton that never resolves, with no error,
no empty state, and no button. It is indistinguishable from a slow network, so people wait, then
refresh, then wait again.

### How it actually presented

Daily Closing shipped with `global.supabase.rpc` in its shell adapter. `window.supabase` is the
supabase-js UMD library, which has no `.rpc`, so the first call threw `TypeError` **synchronously**
— before any promise existed — out of `load()`, out of `mount()`, out of `rDailyClosing()`, out of
`nav()`. `render(true)` had already painted a header and four skeleton blocks.

The pilot looked at those four grey blocks for a week. The module fix is in `2ceb9e3`; the module's
own terminal-state guarantee is in this commit's sibling. **`nav()` is unchanged, so the next page
that throws while rendering does exactly the same thing.**

---

## 2 · Who is affected

Every user of every tenant — KBH, FMH, Fourteen Group, Awami — on any of the ~70 pages in the
`fns` map at `js/ui.js:1001`.

How often it happens today is **not known**, and that is part of the finding: because the throw
escapes to the top, it is reported to the browser console as an uncaught error and nowhere else.
There is no counter, no log line with the page name, nothing in `audit_logs`. A support report of
"the screen just spins" is currently unfalsifiable from our side.

---

## 3 · What the correct behaviour should be

1. **`nav()` must not let a renderer's exception escape.** Wrap the call:
   a `try/catch` around `fn(x)` alongside the existing `.catch` on the promise, so both failure
   shapes land in the same place.
2. **The catch must produce a visible outcome**, not just a console line. A caught error that
   leaves the same frozen screen is barely better than an uncaught one — that is exactly what
   `dashboard.js:145` was already doing for the Daily Closing tile, which is why the tile was dead
   for a week and nobody noticed. Whatever is shown must name the page and offer a way out
   (retry, or back to the dashboard).
3. **It must be attributable.** The page key is right there in `nav()`; log it with the error so
   the next occurrence is diagnosable from a screenshot instead of a repro.
4. **Consider doing 1 and 3 before 2.** A release that only catches and reports, with no UI change,
   answers "how often does this actually happen, and where" with real numbers, and carries none of
   the risk in §4. The UI can then be designed for the cases that exist rather than imagined ones.

---

## 4 · What would change for a KBH or FMH user the moment this is fixed

### 4a · Screens that are frozen today would start showing an error

This is the point of the change, and it is also the whole risk: **we do not know which screens
those are, or how many.** If some page in KBH's or FMH's daily use throws on every visit and has
been quietly showing a stale or half-drawn view that people have learned to work around, that page
will start showing an error banner to every user on the day this ships. That would be correct
behaviour and would still look like a new outage to them.

This is the argument for §3.4 — catch and log first, look at what comes back, then decide.

### 4b · A brand-new error UI appears on two live tenants

Whatever §3.2 draws will be the first time either tenant has seen a shell-level error state. It
needs to be designed, not improvised, and it needs to say something a user can act on rather than
a stack trace. `_showFeatureGate()` (`js/ui.js:1019`) is the nearest existing precedent for
"nav decided not to render the page you asked for" and is worth reusing rather than inventing a
second pattern.

### 4c · Errors stop escaping to the browser's own handler

Today an uncaught exception from `nav()` reaches `window.onerror`. If anything is attached there —
now or later — its behaviour changes. Worth a grep at the time; there was none as of this writing.

### 4d · Nothing changes for a page that renders correctly

The overwhelming majority. `try/catch` around a call that does not throw costs nothing measurable,
and pages that return promises keep the existing `.catch` path unchanged.

---

## 5 · What is already covered, so it is not confused with this

The Daily Closing module now guarantees its own terminal state regardless of what `nav()` does:
a watchdog that ends an unfinished load, a `try/catch` around the render pipeline so a body builder
that throws still draws something, `S.error` finally read instead of only written, and a
`guarded()` wrapper that catches a synchronous throw at the point it happens. Those are asserted
in `scripts/verify-daily-closing-shell-adapter.js` §4 and §4b, including against a deliberately
re-broken copy of the module.

**None of that helps any other page.** The module protects itself; `nav()` protects nothing.

---

## 6 · Related

- [2026-09-04-A](2026-09-04-A-session-timers.md) — the other untriaged shell finding, to be
  scheduled alongside this one.
- `docs/daily-closing/PHASES.md` — **SR-7**, written from the same bug: replicate the environment,
  never construct it.
- Commits `2ceb9e3` (the module fix) and its siblings (the suite, the terminal-state guarantee).
