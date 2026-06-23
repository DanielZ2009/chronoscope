-- Chronoscope admin access repair.
-- Run this only if admin.html logs in but cannot load curator records.
-- This does not delete or publish any data.

alter table public.images enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "Authenticated curators can manage images" on public.images;
create policy "Authenticated curators can manage images"
on public.images
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated curators can read submissions" on public.submissions;
create policy "Authenticated curators can read submissions"
on public.submissions
for select
to authenticated
using (true);

drop policy if exists "Authenticated curators can update submissions" on public.submissions;
create policy "Authenticated curators can update submissions"
on public.submissions
for update
to authenticated
using (true)
with check (status in ('pending', 'approved', 'rejected'));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.images to authenticated;
grant select, insert, update on public.submissions to authenticated;

-- Small-project warning:
-- These policies treat every authenticated Supabase Auth user as a curator.
-- Keep only owner accounts in Authentication > Users, or replace these with
-- role-based policies later.
