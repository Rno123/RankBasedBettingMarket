-- Safe follow-up migration for HackBet Supabase projects that have already
-- been bootstrapped with the initial schema.
--
-- This migration:
-- 1. Ensures pgcrypto is available for gen_random_uuid()
-- 2. Keeps metadata updated_at values fresh on UPDATE / UPSERT
-- 3. Relaxes RLS on the two tables that are still written directly by the client

create extension if not exists pgcrypto with schema extensions;

alter table public.hackathon_metadata
  add column if not exists updated_at timestamptz default now();

alter table public.project_metadata
  add column if not exists updated_at timestamptz default now();

update public.hackathon_metadata
set updated_at = now()
where updated_at is null;

update public.project_metadata
set updated_at = now()
where updated_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_on_hackathon_metadata on public.hackathon_metadata;
create trigger set_updated_at_on_hackathon_metadata
before update on public.hackathon_metadata
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_project_metadata on public.project_metadata;
create trigger set_updated_at_on_project_metadata
before update on public.project_metadata
for each row
execute function public.set_updated_at();

alter table public.hackathon_metadata enable row level security;
alter table public.project_submissions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hackathon_metadata'
      and policyname = 'public insert hackathon metadata'
  ) then
    create policy "public insert hackathon metadata"
      on public.hackathon_metadata
      for insert
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hackathon_metadata'
      and policyname = 'public update hackathon metadata'
  ) then
    create policy "public update hackathon metadata"
      on public.hackathon_metadata
      for update
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_submissions'
      and policyname = 'public read project submissions'
  ) then
    create policy "public read project submissions"
      on public.project_submissions
      for select
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_submissions'
      and policyname = 'public insert project submissions'
  ) then
    create policy "public insert project submissions"
      on public.project_submissions
      for insert
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_submissions'
      and policyname = 'public update project submissions'
  ) then
    create policy "public update project submissions"
      on public.project_submissions
      for update
      using (true)
      with check (true);
  end if;
end
$$;
