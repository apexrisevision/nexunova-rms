# Findings

Things found while doing something else, that are real, and that are **not** being fixed as part
of the work that found them.

A finding lives here when it meets all three of:

- it is outside the scope of the piece of work that surfaced it;
- fixing it would change behaviour for a live tenant, so it needs its own decision; and
- it would otherwise survive only as a paragraph in a commit message nobody reads again.

Each file states what breaks, the file and line numbers, who is affected, what the correct
behaviour would be, and — the part that decides when it gets scheduled — **what would change for
a real user on a live tenant the moment it is fixed**. A finding is not a to-do; nothing here is
authorisation to ship.

| ID | Title | Scope | Status |
|---|---|---|---|
| [2026-09-04-A](2026-09-04-A-session-timers.md) | A restored session starts none of its security timers | RMS shell — **every tenant, every user** | Untriaged. Scheduled after the Awami parallel run. |
| [2026-09-04-B](2026-09-04-B-portal-smoke-flake.md) | The portal push gate failed once and passed three times | `scripts/smoke-portal.js` | Open, not chased. Fix the evidence collection before judging it. |
| [2026-09-04-C](2026-09-04-C-nav-swallows-sync-throws.md) | A page that throws while rendering freezes the whole shell | `js/ui.js` — nav(), **every page, every tenant** | Untriaged. To be scheduled with A. |
