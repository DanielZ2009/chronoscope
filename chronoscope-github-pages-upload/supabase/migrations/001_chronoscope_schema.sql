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
  add column if not exists updated_at timestamptz default now();

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

revoke all on public.images from anon, authenticated;
revoke all on public.submissions from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.images to anon;
grant insert on public.submissions to anon;
grant select, insert, update, delete on public.images to authenticated;
grant select, insert, update on public.submissions to authenticated;

-- Small-project policy note:
-- Authenticated users can curate submissions and images because this project is
-- expected to have only owner accounts in Supabase Auth. If additional users are
-- added later, replace these broad authenticated policies with stricter
-- role-based policies.

insert into public.images (
  id,
  title,
  image_url,
  location_name,
  lat,
  lng,
  year,
  year_range,
  case_note,
  historical_record,
  source,
  rights,
  difficulty,
  tags,
  approved
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'Christian Site in Beijing',
    'assets/images/beijing_church_001.svg',
    'Beijing, China',
    39.9042,
    116.4074,
    1910,
    'c. 1910',
    'A Christian building in North China during the late Qing or early Republican period.',
    'Beijing''s religious sites sat within a city changing under missionary institutions, local communities, new roads, and late imperial reform.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'medium',
    array['China', 'Beijing', 'religion', 'urban history'],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'Bridge and Harbor at Istanbul',
    'assets/images/istanbul_bridge_001.svg',
    'Istanbul, Turkey',
    41.0082,
    28.9784,
    1895,
    'c. 1895',
    'A crowded port city between two continents, with ferries, mosques, and late Ottoman urban life.',
    'Istanbul''s waterfront connected imperial administration, trade, religious landmarks, and new transport networks at the end of the 19th century.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'medium',
    array['Turkey', 'Istanbul', 'Ottoman', 'waterfront'],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'Street in Cairo',
    'assets/images/cairo_street_001.svg',
    'Cairo, Egypt',
    30.0444,
    31.2357,
    1915,
    'c. 1915',
    'A North African capital where electric tramways, markets, and older street patterns overlapped.',
    'Early 20th-century Cairo combined colonial-era infrastructure with dense older districts, visible in tram lines, street width, and commercial signage.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'medium',
    array['Egypt', 'Cairo', 'street life', 'transport'],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'Railway Terminus in Bombay',
    'assets/images/mumbai_station_001.svg',
    'Mumbai, India',
    18.9388,
    72.8354,
    1920,
    'c. 1920',
    'A monumental railway building in a major Indian port city under British rule.',
    'Bombay''s railway architecture expressed imperial administration and the commercial importance of a port city tied to cotton, shipping, and migration.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'easy',
    array['India', 'Mumbai', 'railway', 'colonial architecture'],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'Broad Avenue in Buenos Aires',
    'assets/images/buenos_aires_avenue_001.svg',
    'Buenos Aires, Argentina',
    -34.6037,
    -58.3816,
    1936,
    'c. 1936',
    'A South American capital reshaped by broad avenues, electric lights, and ambitious modernization.',
    'Buenos Aires remade parts of its center with monumental avenues and new infrastructure, presenting itself as a modern Atlantic metropolis.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'medium',
    array['Argentina', 'Buenos Aires', 'modernization', 'urban history'],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    'Road near Montenotte',
    'assets/images/montenotte_road_001.svg',
    'Montenotte, Italy',
    44.389,
    8.375,
    1890,
    'c. 1890',
    'A Ligurian inland landscape where mountain roads and military memory shaped local identity.',
    'Montenotte is associated with Napoleon''s 1796 campaign, but later images of roads and settlements can reveal how memory, terrain, and rural transport intersected.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'hard',
    array['Italy', 'Liguria', 'Montenotte', 'military memory'],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000007',
    'San Francisco After the Earthquake',
    'assets/images/san_francisco_1906_001.svg',
    'San Francisco, United States',
    37.7749,
    -122.4194,
    1906,
    '1906',
    'A Pacific port city marked by earthquake damage, firebreaks, and temporary rebuilding.',
    'The 1906 earthquake and fires transformed San Francisco''s built environment, leaving street grids, ruins, and emergency reconstruction as visual evidence.',
    'Sample entry - add verified archive source',
    'Demonstration entry - verify public domain or permitted educational use before publication',
    'easy',
    array['United States', 'San Francisco', 'earthquake', 'disaster history'],
    true
  )
on conflict (id) do update set
  title = excluded.title,
  image_url = excluded.image_url,
  location_name = excluded.location_name,
  lat = excluded.lat,
  lng = excluded.lng,
  year = excluded.year,
  year_range = excluded.year_range,
  case_note = excluded.case_note,
  historical_record = excluded.historical_record,
  source = excluded.source,
  rights = excluded.rights,
  difficulty = excluded.difficulty,
  tags = excluded.tags,
  approved = excluded.approved,
  updated_at = now();
