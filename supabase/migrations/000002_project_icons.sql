-- Project icon support: storage bucket + icon_url columns.

-- ── Storage bucket ────────────────────────────────────────────────────────

-- Bucket is publicly readable so the frontend can display icons without auth.
-- Uploads go through the service-role API route (wallet-signature gated).
insert into storage.buckets (id, name, public, avif_autodetection, file_size_limit)
values ('project_icons', 'project_icons', true, false, 1048576)  -- 1 MB max
on conflict (id) do nothing;

-- ── icon_url columns ──────────────────────────────────────────────────────

alter table public.project_submissions
  add column if not exists icon_url text;

alter table public.project_metadata
  add column if not exists icon_url text;

-- ── Refresh the public view ────────────────────────────────────────────────

drop view if exists public.project_submissions_public cascade;

create or replace view public.project_submissions_public as
select
  project_pubkey,
  hackathon_pubkey,
  github_url,
  project_name,
  icon_url,
  twitter_handle,
  telegram,
  discord,
  wallet_address,
  status,
  created_at
from public.project_submissions;

grant select on public.project_submissions_public to anon, authenticated;
