-- HackBet initial schema — single canonical migration for mainnet launch.
-- Creates all tables, views, triggers, and RLS policies in their final intended state.

-- ── Extensions ────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;

-- ── updated_at trigger helper ──────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── hackathon_metadata ─────────────────────────────────────────────────────
-- Organizer-curated display data for a hackathon (name, icon, official link).
-- Public read, service-role write.

create table if not exists public.hackathon_metadata (
  hackathon_pubkey text primary key,
  official_link    text,
  icon_url         text,
  name             text,
  updated_at       timestamptz default now()
);

alter table public.hackathon_metadata enable row level security;

create policy "public read hackathon metadata"
  on public.hackathon_metadata
  for select
  using (true);

drop trigger if exists set_updated_at_on_hackathon_metadata on public.hackathon_metadata;
create trigger set_updated_at_on_hackathon_metadata
  before update on public.hackathon_metadata
  for each row
  execute function public.set_updated_at();

-- ── project_metadata ───────────────────────────────────────────────────────
-- Builder-supplied project display data (socials, project name).
-- Populated by the admin review route on approval. Public read, service-role write.

create table if not exists public.project_metadata (
  project_pubkey    text primary key,
  hackathon_pubkey  text not null,
  github_url        text not null,
  project_name      text,
  twitter_handle    text,
  telegram          text,
  discord           text,
  registered_wallet text not null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table public.project_metadata enable row level security;

create policy "public read project metadata"
  on public.project_metadata
  for select
  using (true);

drop trigger if exists set_updated_at_on_project_metadata on public.project_metadata;
create trigger set_updated_at_on_project_metadata
  before update on public.project_metadata
  for each row
  execute function public.set_updated_at();

-- ── project_submissions (private) ───────────────────────────────────────────
-- Full submission records including PII (auth_email).
-- No anon/authenticated access at all. All reads and writes go through
-- service-role API routes (/api/project-submission, /api/admin/project-submissions).

create table if not exists public.project_submissions (
  id                uuid primary key default gen_random_uuid(),
  project_pubkey    text not null,
  hackathon_pubkey  text not null,
  github_url        text not null,
  wallet_address    text not null,
  auth_email        text,
  project_name      text,
  twitter_handle    text,
  telegram          text,
  discord           text,
  status            text not null default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  reviewed_at       timestamptz
);

create unique index if not exists project_submissions_project_pubkey_key
  on public.project_submissions (project_pubkey);

alter table public.project_submissions enable row level security;

-- No anon/authenticated policies — completely private.
revoke all on public.project_submissions from anon, authenticated;

drop trigger if exists set_updated_at_on_project_submissions on public.project_submissions;
create trigger set_updated_at_on_project_submissions
  before update on public.project_submissions
  for each row
  execute function public.set_updated_at();

-- ── project_submissions_public (safe view) ──────────────────────────────────
-- Public-safe projection: excludes auth_email (PII).
-- Used by the dev portal and hackathon detail page.

create or replace view public.project_submissions_public as
select
  project_pubkey,
  hackathon_pubkey,
  github_url,
  project_name,
  twitter_handle,
  telegram,
  discord,
  wallet_address,
  status,
  created_at
from public.project_submissions;

grant select on public.project_submissions_public to anon, authenticated;

-- ── whitelist_requests (private) ────────────────────────────────────────────
-- Staking-access requests. Anon can insert; only service-role can read/update.

create table if not exists public.whitelist_requests (
  id                uuid primary key default gen_random_uuid(),
  hackathon_pubkey  text not null,
  wallet_address    text not null,
  email             text not null,
  notes             text,
  status            text not null default 'pending',
  created_at        timestamptz not null default now()
);

alter table public.whitelist_requests enable row level security;

revoke all on public.whitelist_requests from anon, authenticated;
grant insert on public.whitelist_requests to anon, authenticated;

-- ── github_stats ────────────────────────────────────────────────────────────
-- Cached GitHub commit data. Public read, service-role write.

create table if not exists public.github_stats (
  github_url     text primary key,
  default_branch text,
  last_commit_at timestamptz,
  commits_7d     integer,
  fetched_at     timestamptz not null default now()
);

alter table public.github_stats enable row level security;

create policy "public read github stats"
  on public.github_stats
  for select
  using (true);
