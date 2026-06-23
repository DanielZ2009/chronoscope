-- Chronoscope Supabase schema.
-- Run this in the Supabase SQL Editor, or apply it through the Supabase CLI.
-- Never put service role keys, database passwords, or other secrets in frontend code.
-- RLS is the security boundary for the GitHub Pages frontend.

create extension if not exists pgcrypto;

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_url text not null,
  location_name text not null,
  lat double precision not null,
  lng double precision not null,
  year integer not null,
  year_range text,
  case_note text,
  historical_record text,
  source text,
  rights text,
  difficulty text,
  tags text[],
  approved boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_url text not null,
  location_name text,
  lat double precision,
  lng double precision,
  year integer,
  year_range text,
  case_note text,
  historical_record text,
  source text,
  rights text,
  submitter_name text,
  submitter_contact text,
  status text default 'pending',
  difficulty text,
  tags text[],
  admin_notes text,
  submission_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint submissions_status_check check (status in ('pending', 'approved', 'rejected'))
);

alter table public.images
  add column if not exists updated_at timestamptz default now();

alter table public.submissions
  add column if not exists difficulty text,
  add column if not exists tags text[],
  add column if not exists admin_notes text,
  add column if not exists submission_key text,
  add column if not exists updated_at timestamptz default now();

drop index if exists public.submissions_submission_key_unique;
create unique index submissions_submission_key_unique
on public.submissions (submission_key)
where submission_key is not null and status = 'pending';

alter table public.images alter column approved set default true;
alter table public.submissions alter column status set default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_status_check'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_images_updated_at on public.images;
create trigger set_images_updated_at
before update on public.images
for each row
execute function public.set_updated_at();

drop trigger if exists set_submissions_updated_at on public.submissions;
create trigger set_submissions_updated_at
before update on public.submissions
for each row
execute function public.set_updated_at();

alter table public.images enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "Public can read approved images" on public.images;
create policy "Public can read approved images"
on public.images
for select
to anon
using (approved = true);

drop policy if exists "Authenticated curators can manage images" on public.images;
create policy "Authenticated curators can manage images"
on public.images
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Public can submit pending cases" on public.submissions;
create policy "Public can submit pending cases"
on public.submissions
for insert
to anon, authenticated
with check (status = 'pending');

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

drop policy if exists "Authenticated curators can delete rejected submissions" on public.submissions;
create policy "Authenticated curators can delete rejected submissions"
on public.submissions
for delete
to authenticated
using (status = 'rejected');

revoke all on public.images from anon, authenticated;
revoke all on public.submissions from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.images to anon;
grant insert on public.submissions to anon;
grant select, insert, update, delete on public.images to authenticated;
grant select, insert, update, delete on public.submissions to authenticated;

-- Small-project policy note:
-- Authenticated users can curate submissions and images because this project is
-- expected to have only owner accounts in Supabase Auth. If additional users are
-- added later, replace these broad authenticated policies with stricter
-- role-based policies.
