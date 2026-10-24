-- File sizes (bytes) for the history list. Rows saved before this migration keep NULL and show no size.
alter table public.translation_outputs add column if not exists size_bytes bigint;
alter table public.translation_jobs add column if not exists size_bytes bigint;
