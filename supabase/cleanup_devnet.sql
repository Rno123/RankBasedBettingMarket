-- Drop everything before re-running 000001_initial_schema on a reused project.
-- Run this in the Supabase SQL Editor, then run the migration.

drop view if exists public.project_submissions_public;

drop table if exists public.github_stats       cascade;
drop table if exists public.whitelist_requests  cascade;
drop table if exists public.project_submissions cascade;
drop table if exists public.project_metadata    cascade;
drop table if exists public.hackathon_metadata  cascade;

drop function if exists public.set_updated_at() cascade;
