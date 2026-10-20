-- Paused jobs + batch (zip) history. Run once after 001_translation_history.sql.

-- Outputs: 'file' = one translated file, 'zip' = a batch of files stored as JSON.
alter table public.translation_outputs add column if not exists kind text not null default 'file';
alter table public.translation_outputs add column if not exists file_count integer not null default 1;

-- Paused jobs: the original files, so a stopped translation can be continued later.
create table if not exists public.translation_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null,
  file_count integer not null default 1,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists translation_jobs_user_idx on public.translation_jobs (user_id, created_at desc);

alter table public.translation_jobs enable row level security;

drop policy if exists "own jobs select" on public.translation_jobs;
drop policy if exists "own jobs insert" on public.translation_jobs;
drop policy if exists "own jobs delete" on public.translation_jobs;

create policy "own jobs select" on public.translation_jobs
  for select using (auth.uid() = user_id and expires_at > now());
create policy "own jobs insert" on public.translation_jobs
  for insert with check (auth.uid() = user_id);
create policy "own jobs delete" on public.translation_jobs
  for delete using (auth.uid() = user_id);

-- Replace the cleanup function so it also removes expired jobs.
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
  delete from public.translation_jobs where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;
