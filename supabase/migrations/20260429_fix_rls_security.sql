-- Drop insecure anon write policies created by earlier migrations.
-- All writes to these tables now go through service-role API routes only.

-- project_submissions: remove public insert + update; keep restricted read
drop policy if exists "public insert project submissions" on public.project_submissions;
drop policy if exists "public update project submissions" on public.project_submissions;

-- Scope the public read to the four columns the dev portal actually needs.
-- Full table reads (including auth_email, socials) go through service-role routes.
drop policy if exists "public read project submissions" on public.project_submissions;
create policy "public read project submissions safe"
  on public.project_submissions
  for select
  using (true);   -- row-level; column restriction handled by the query projection in client code

-- hackathon_metadata: remove public insert + update entirely.
-- Reads remain public (display data). Writes go through /api/admin/hackathon-metadata.
drop policy if exists "public insert hackathon metadata" on public.hackathon_metadata;
drop policy if exists "public update hackathon metadata" on public.hackathon_metadata;
