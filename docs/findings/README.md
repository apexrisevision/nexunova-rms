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
| [2026-09-04-B](2026-09-04-B-portal-smoke-flake.md) | The portal push gate failed once and passed three times | `scripts/smoke-portal.js` | **Open — cause unknown.** One hypothesis raised and refuted (§6); a separate defect it surfaced is fixed (§5). |
| [2026-09-04-C](2026-09-04-C-nav-swallows-sync-throws.md) | A page that throws while rendering freezes the whole shell | `js/ui.js` — nav(), **every page, every tenant** | Untriaged. To be scheduled with A. |
| [2026-09-05-D](2026-09-05-D-rms-ran-ten-days-behind-the-book.md) | RMS was running ten days behind the receipt book | KBH data entry practice — not a code defect | **Recorded.** No figure is wrong; it sets the bar for the Daily Closing parallel run. |
| [2026-09-05-E](2026-09-05-E-bank-literal-never-matches.md) | "Bank Received" reads PKR 0 on every cancellation and every transfer | `js/pages/cancellation.js:304`, `js/pages/transfers.js:415` — **every tenant, every sale** | **Bank filter FIXED 2026-09-05.** Exposure measured first (§3b): 21 live cancellations saw the panel, 0 transfers outside ZZTEST, no money decision recorded on any. `adjPaid`, `payment_category` and the `total_paid = 0` question remain open (§5e). |
| [2026-09-07-F](2026-09-07-F-sold-units-without-a-seller.md) | Five sold units name nobody as the seller | `sales.agent_id` / `sold_by` — KBH, FMH | **Recorded.** Report only; no cleanup attempted. |
| [2026-09-07-G](2026-09-07-G-late-render-paints-over-the-new-tab.md) | A slow screen paints over the one you opened next | `sales-portal.html` — nav/setTab, every portal tab | **Partly fixed.** The 43 named renderers are guarded and the window was measured closed 16/16; the general `setTab` race is still open. |
| [2026-09-07-H](2026-09-07-H-agents-without-a-phone-or-cnic.md) | Most Fourteen Group and many FMH agents have no CNIC, so identity cannot be resolved there | `agents` — FMH 20/35, Fourteen Group 57/72 | **Recorded.** Prerequisite before the desk runs on those tenants. No cleanup. |
| [2026-09-07-I](2026-09-07-I-reserved-is-not-the-only-hold.md) | "Reserved" is treated as the only kind of hold | `_sync_reservation_on_unit_status`, `get_reservation_daybook`, `get_availability_board` | **Trigger and daybook FIXED 2026-09-07** (`20260907h`); one unit repaired. The availability-board undercount is left alone and described. |
