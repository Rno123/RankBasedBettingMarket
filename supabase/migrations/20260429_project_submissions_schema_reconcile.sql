-- Reconcile the live project_submissions table with the server-side API.
--
-- The app now writes submission timestamps and social metadata through
-- /api/project-submission and /api/admin/project-submissions. Older Supabase
-- projects may have the table but miss one or more of these columns.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.project_submissions (
  id uuid primary key default gen_random_uuid(),
  project_pubkey text not null,
  hackathon_pubkey text not null,
  github_url text not null,
  wallet_address text not null,
  auth_email text,
  twitter_handle text,
  telegram text,
  discord text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.project_submissions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists project_pubkey text,
  add column if not exists hackathon_pubkey text,
  add column if not exists github_url text,
  add column if not exists wallet_address text,
  add column if not exists auth_email text,
  add column if not exists twitter_handle text,
  add column if not exists telegram text,
  add column if not exists discord text,
  add column if not exists status text default 'pending',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists reviewed_at timestamptz;

update public.project_submissions
set
  status = coalesce(status, 'pending'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  status is null
  or created_at is null
  or updated_at is null;

alter table public.project_submissions
  alter column project_pubkey set not null,
  alter column hackathon_pubkey set not null,
  alter column github_url set not null,
  alter column wallet_address set not null,
  alter column status set not null,
  alter column created_at set not null,
  alter column updated_at set not null,
  alter column status set default 'pending',
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_submissions'::regclass
      and contype = 'p'
  ) then
    alter table public.project_submissions
      add constraint project_submissions_pkey primary key (id);
  end if;
end
$$;

create unique index if not exists project_submissions_project_pubkey_key
  on public.project_submissions (project_pubkey);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_on_project_submissions on public.project_submissions;
create trigger set_updated_at_on_project_submissions
before update on public.project_submissions
for each row
execute function public.set_updated_at();

alter table public.project_submissions enable row level security;

do $$
begin
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
