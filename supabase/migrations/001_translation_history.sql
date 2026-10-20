-- Translation history: finished subtitle outputs, kept for 7 days.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.translation_outputs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name   text not null,
  target_lang text not null default '',
  content     text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days')
);

create index if not exists translation_outputs_user_idx on public.translation_outputs (user_id, created_at desc);
create index if not exists translation_outputs_expires_idx on public.translation_outputs (expires_at);

-- Row Level Security: each user can only see and change their own rows.
alter table public.translation_outputs enable row level security;

drop policy if exists "own outputs select" on public.translation_outputs;
drop policy if exists "own outputs insert" on public.translation_outputs;
drop policy if exists "own outputs delete" on public.translation_outputs;

create policy "own outputs select" on public.translation_outputs
  for select using (auth.uid() = user_id and expires_at > now());
create policy "own outputs insert" on public.translation_outputs
  for insert with check (auth.uid() = user_id);
create policy "own outputs delete" on public.translation_outputs
  for delete using (auth.uid() = user_id);

-- Remove expired rows. Run it on a schedule (see the pg_cron block below), or call it manually.
create or replace function public.delete_expired_translation_outputs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.translation_outputs where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Optional: hourly cleanup with pg_cron (enable the "pg_cron" extension in Database → Extensions first).
-- select cron.schedule('cleanup-translation-outputs', '0 * * * *', $$select public.delete_expired_translation_outputs();$$);
