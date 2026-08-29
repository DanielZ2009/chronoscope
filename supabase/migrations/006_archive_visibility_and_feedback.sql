-- Chronoscope staged Archive publication and private player correspondence.
-- Run this after 005_daily_challenges_and_archive.sql.

alter table public.images
  add column if not exists archive_visible boolean not null default true;

comment on column public.images.archive_visible is
  'Approved cases remain playable when false but are omitted from the public Explore catalogue.';

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  score integer,
  max_score integer,
  score_percent integer,
  challenge_label text,
  challenge_date date,
  created_at timestamptz not null default now(),
  constraint feedback_message_length_check check (char_length(trim(message)) between 1 and 2000),
  constraint feedback_score_percent_check check (score_percent is null or score_percent between 0 and 100)
);

alter table public.feedback enable row level security;

drop policy if exists "Public can send player notes" on public.feedback;
create policy "Public can send player notes"
on public.feedback
for insert
to anon, authenticated
with check (char_length(trim(message)) between 1 and 2000);

drop policy if exists "Authenticated curators can read player notes" on public.feedback;
create policy "Authenticated curators can read player notes"
on public.feedback
for select
to authenticated
using (true);

drop policy if exists "Authenticated curators can delete player notes" on public.feedback;
create policy "Authenticated curators can delete player notes"
on public.feedback
for delete
to authenticated
using (true);

revoke all on public.feedback from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant insert on public.feedback to anon;
grant insert, select, delete on public.feedback to authenticated;

create index if not exists feedback_created_at_idx
on public.feedback (created_at desc);

-- Existing approved cases stay in Explore. New curator approvals are hidden
-- from Explore by the dashboard unless the owner opts in explicitly.
update public.images
set archive_visible = true
where archive_visible is null;
