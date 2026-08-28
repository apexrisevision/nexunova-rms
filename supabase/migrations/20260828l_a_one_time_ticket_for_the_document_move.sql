-- A single-use ticket, so the one-off document move could be authorised without
-- putting a password or a service key anywhere.
--
-- The move itself ran inside the attendance-bridge, which already holds the
-- service key, as a temporary action guarded by this ticket. The action and this
-- table were both removed when the move finished — see 20260828q. It is recorded
-- here because a migration history that hides how the data got moved is not a
-- history.
create table if not exists public._doc_move_ticket (
  token      uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
revoke all on public._doc_move_ticket from public, anon, authenticated;
alter table public._doc_move_ticket enable row level security;
