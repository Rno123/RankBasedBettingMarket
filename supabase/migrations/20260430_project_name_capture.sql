-- Add a human-readable project name to off-chain submission and metadata rows.
-- This keeps the builder-entered name available during review and after approval.

alter table public.project_submissions
  add column if not exists project_name text;

alter table public.project_metadata
  add column if not exists project_name text;
