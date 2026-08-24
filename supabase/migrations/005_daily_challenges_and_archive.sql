-- Chronoscope persistent daily challenges and public Archive controls.
-- Run this after 004_question_sets_and_submission_dedupe.sql.

alter table public.question_sets
  add column if not exists is_public boolean not null default true;

create table if not exists public.daily_challenges (
  challenge_date date primary key,
  title text not null default 'Daily Challenge',
  image_ids text[] not null default '{}',
  question_set_id text references public.question_sets(id) on delete set null,
  round_count integer not null default 5 check (round_count between 1 and 20),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_challenges_require_cases check (cardinality(image_ids) > 0)
);

drop trigger if exists set_daily_challenges_updated_at on public.daily_challenges;
create trigger set_daily_challenges_updated_at
before update on public.daily_challenges
for each row
execute function public.set_updated_at();

alter table public.daily_challenges enable row level security;

-- Question sets were previously all readable. Existing sets remain public by
-- default, while the curator can now keep future working sets out of the Archive.
drop policy if exists "Public can read question sets" on public.question_sets;
create policy "Public can read public question sets"
on public.question_sets
for select
to anon
using (is_public = true);

drop policy if exists "Authenticated curators can read question sets" on public.question_sets;
create policy "Authenticated curators can read question sets"
on public.question_sets
for select
to authenticated
using (true);

drop policy if exists "Public can read published daily challenges" on public.daily_challenges;
create policy "Public can read published daily challenges"
on public.daily_challenges
for select
to anon
using (published = true);

-- This personal project currently has only the owner in Supabase Auth. If more
-- authenticated users are added later, replace this with a stricter owner role.
drop policy if exists "Authenticated curators can manage daily challenges" on public.daily_challenges;
create policy "Authenticated curators can manage daily challenges"
on public.daily_challenges
for all
to authenticated
using (true)
with check (true);

grant select on public.question_sets to anon;
grant select on public.daily_challenges to anon;
grant select, insert, update, delete on public.daily_challenges to authenticated;

create index if not exists daily_challenges_published_date_idx
on public.daily_challenges (published, challenge_date desc);
