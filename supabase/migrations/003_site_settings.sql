-- Chronoscope shared public site settings.
-- Run this in Supabase SQL Editor to let the curator dashboard control
-- homepage gallery images/captions for every visitor.

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
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

drop trigger if exists set_site_settings_updated_at on public.site_settings;
create trigger set_site_settings_updated_at
before update on public.site_settings
for each row
execute function public.set_updated_at();

alter table public.site_settings enable row level security;

drop policy if exists "Public can read public site settings" on public.site_settings;
create policy "Public can read public site settings"
on public.site_settings
for select
to anon, authenticated
using (key = 'public');

drop policy if exists "Authenticated curators can manage site settings" on public.site_settings;
create policy "Authenticated curators can manage site settings"
on public.site_settings
for all
to authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated;
grant select on public.site_settings to anon;
grant select, insert, update, delete on public.site_settings to authenticated;

insert into public.site_settings (key, value)
values (
  'public',
  '{
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
)
on conflict (key) do nothing;

-- Small-project warning:
-- Any authenticated Supabase Auth user can edit these settings. Keep only owner
-- accounts in Authentication > Users, or replace this policy later with roles.
