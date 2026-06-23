-- Chronoscope question sets, rejected cleanup, and submission dedupe.
-- Run this in Supabase SQL Editor after 001 and 003.

alter table public.submissions
  add column if not exists submission_key text;

drop index if exists public.submissions_submission_key_unique;
create unique index submissions_submission_key_unique
on public.submissions (submission_key)
where submission_key is not null and status = 'pending';

create table if not exists public.question_sets (
  id text primary key,
  title text not null,
  description text,
  image_ids text[] not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_question_sets_updated_at on public.question_sets;
create trigger set_question_sets_updated_at
before update on public.question_sets
for each row
execute function public.set_updated_at();

alter table public.question_sets enable row level security;

drop policy if exists "Public can read question sets" on public.question_sets;
create policy "Public can read question sets"
on public.question_sets
for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated curators can manage question sets" on public.question_sets;
create policy "Authenticated curators can manage question sets"
on public.question_sets
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated curators can delete rejected submissions" on public.submissions;
create policy "Authenticated curators can delete rejected submissions"
on public.submissions
for delete
to authenticated
using (status = 'rejected');

grant usage on schema public to anon, authenticated;
grant select on public.question_sets to anon;
grant select, insert, update, delete on public.question_sets to authenticated;
grant delete on public.submissions to authenticated;

-- Remove the generated sample cases from the initial prototype seed.
-- This leaves real curator-published rows untouched.
delete from public.images
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007'
)
or source = 'Sample entry - add verified archive source';

update public.site_settings
set value = '{
  "roundsPerGame": 5,
  "activeSetId": "all",
  "activeSetName": "All published cases",
  "randomizeRounds": true,
  "homeGallery": [
    {
      "image": "",
      "place": "Awaiting image",
      "time": "Curator selection"
    },
    {
      "image": "",
      "place": "Awaiting image",
      "time": "Curator selection"
    },
    {
      "image": "",
      "place": "Awaiting image",
      "time": "Curator selection"
    }
  ]
}'::jsonb
where key = 'public'
  and value::text like '%assets/images/%';

-- Small-project warning:
-- Authenticated policies assume only owner accounts exist in Supabase Auth.
