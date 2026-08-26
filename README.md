# Chronoscope

Chronoscope is a historical map game. Players study an archival image, place it on a Leaflet world map, choose a year on a long timeline, and receive a score for location and time.

The frontend stays static on GitHub Pages. Supabase provides database storage and owner authentication.

## What Works

- Public game loads approved cases from Supabase `public.images`.
- Public game falls back to `data/images.json` if Supabase is unavailable or not configured.
- Public visitors can submit cases into Supabase `public.submissions`.
- Visitors cannot read, edit, approve, or delete submissions.
- Owner logs into `admin.html` with Supabase Auth.
- Owner can edit, approve, reject, unpublish, or delete through the curator dashboard.

## Project Structure

```text
chronoscope/
  index.html
  admin.html
  style.css
  script.js
  data/
    images.json
    site_settings.json
    pending_submissions.json
  assets/
    images/
  supabase/
    migrations/
      001_chronoscope_schema.sql
  tools/
    generate-curator-candidates.mjs
  research/
    pilot-candidates-2026-08-23.json
  .github/
    workflows/
      generate-curator-candidates.yml
  README.md
```

## Supabase Setup

1. Create or open your Supabase project.
2. Go to **SQL Editor**.
3. Paste and run `supabase/migrations/001_chronoscope_schema.sql`.
4. Paste and run `supabase/migrations/003_site_settings.sql` to enable shared homepage gallery controls.
5. Paste and run `supabase/migrations/004_question_sets_and_submission_dedupe.sql` to enable global question sets, rejected-submission deletion, duplicate submission prevention, and placeholder cleanup.
6. Paste and run `supabase/migrations/005_daily_challenges_and_archive.sql` to enable stable dated challenges and public Archive collections.
7. Go to **Project Settings > API**.
8. Copy the Project URL.
9. Copy the anon/public/publishable key.
10. In `script.js`, set:

```js
const SUPABASE_URL = "https://your-project-ref.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-or-publishable-key";
```

Never put the service role key, database password, GitHub token, or any secret in the frontend. Browser JavaScript is public. The anon key is acceptable because Row Level Security is enabled.

## Owner Account

1. Go to **Supabase > Authentication > Users**.
2. Create or invite the owner user.
3. Use that email and password to log into `admin.html`.

This project currently treats every authenticated Supabase user as a curator. That is acceptable for a small personal project where only owner accounts exist. If you add other users later, replace the broad authenticated RLS policies with stricter role-based policies.

## RLS Rules

`public.images`:

- `anon` can select only rows where `approved = true`.
- `authenticated` can select, insert, update, and delete images.

`public.submissions`:

- `anon` and `authenticated` can insert rows only with `status = 'pending'`.
- `anon` cannot select, update, or delete submissions.
- `authenticated` can select and update submissions.

`public.daily_challenges`:

- `anon` can select only rows where `published = true`.
- `authenticated` curators can create, edit, publish, hide, and delete dated challenges.

`public.question_sets`:

- `anon` can select only collections where `is_public = true`.
- `authenticated` curators can manage all collections.

Allowed submission statuses:

- `pending`
- `approved`
- `rejected`

## Curator Workflow

1. Open `admin.html`.
2. Log in with the owner account.
3. Review **Pending Submissions**.
4. Edit title, image URL, location, coordinates, year, year range, case note, historical record, source, rights, difficulty, tags, or admin notes.
5. Click **Edit** to save review edits.
6. Click **Publish to Chronoscope** to insert a new approved row into `public.images` and mark the original submission as approved.
7. Click **Reject Submission** to keep the submission with `status = 'rejected'`.

Approved cases appear in the public game as soon as Supabase returns them from `public.images`.

## Shared Homepage Gallery

The curator dashboard includes **Home Gallery** controls for the three homepage images and captions.

These controls save to Supabase `public.site_settings`, so changes appear for every visitor without editing local browser storage. Use a public image URL or an existing deployed site path such as `assets/images/my_archive_image.jpg`.

This does not upload binary files yet. For private/local image files, add them to the deployed `assets/` folder first or use Supabase Storage in a later version.

## Question Sets

The curator dashboard includes **Question Sets** controls.

You can:

- create named sets from approved cases
- choose the active public set
- switch back to all published cases
- delete sets you no longer need

Question sets save to Supabase `public.question_sets`. The active set is saved in `public.site_settings`, so it applies to every visitor.

The **Show this collection in the public Archive** checkbox controls whether players can open that set from the Archive page. Existing sets become public when migration 005 is first run, so no current collection disappears.

## Dated Challenges And Archive

Migration `005_daily_challenges_and_archive.sql` creates `public.daily_challenges` without changing any existing image, submission, or historical-record row.

In the curator dashboard:

1. Open **Daily Challenges**.
2. Choose a date, title, source collection, and number of cases.
3. Click **Publish Dated Challenge**.
4. The exact ordered case IDs are saved as a permanent snapshot for that date.

The public **Archive** page can replay published dates and public Question Sets. Exact links use `?daily=YYYY-MM-DD` or `?set=collection_id`, so two players opening the same link receive the same cases.

Player history, best percentage, and daily streak are stored only in that browser's `localStorage`. They are labelled **On this device** and are not uploaded to Supabase.

## Public Record Catalogue

Every approved row in `public.images` also appears in the public record catalogue.
Visitors can search the collection and filter it by period, medium, or any existing
tag. Medium is derived conservatively from the record tags: paintings, prints, maps,
and objects retain those labels, while other playable historical images are treated
as photographs.

Each record has a permanent shareable link:

```text
https://chronoscope.world/?record=IMAGE_UUID#record
```

The record view contains the complete image, mapped location, date, Historical
Record, source links, rights note, index terms, appearances in dated challenges or
collections, and related records. Round reveals and final results link directly to
these records.

This feature uses the existing `images.tags`, `source`, `rights`, and other approved
metadata. It requires no database migration and does not alter existing records.

## Editorial Standards

The public **Editorial Standards** view explains Chronoscope's method for checking
place, time, sources, reuse rights, uncertainty, and curator review. It also states
that community and research-assistant proposals remain private until the curator
checks and publishes them. Keep this page aligned with the actual review standard as
older records are refined.

## Submission Cleanup

Public submissions now include a `submission_key` when migration `004_question_sets_and_submission_dedupe.sql` has been run. Duplicate clicks on the same submission are treated as already received instead of creating repeated pending rows.

Rejected submissions have a delete button in the curator dashboard. The delete policy only allows deletion of rows with `status = 'rejected'`.

## If Published Cases Do Not Show On Another Device

Public devices can only see rows that exist in Supabase `public.images` with `approved = true`.

If a case appears only on your own computer, it was probably saved in browser `localStorage` or left in `public.submissions`. Local browser data never publishes to other devices.

To verify publication:

1. Open **Supabase > Table Editor > images**.
2. Confirm the case appears there.
3. Confirm `approved` is checked/true.
4. Confirm required fields are filled: `title`, `image_url`, `location_name`, `lat`, `lng`, and `year`.
5. Refresh the public site after deploying the latest `script.js`.

Chronoscope prioritizes the newest approved Supabase cases in the daily game. If there are fewer approved Supabase cases than the configured round count, it fills the remaining slots from `data/images.json`.

## Public Submission Flow

The public **Submit an Image** form inserts into `public.submissions` with:

```text
status = pending
```

Players see:

```text
Submission received. It will be reviewed before appearing in Chronoscope.
```

If Supabase fails, the form falls back to a copyable JSON review package.

## JSON Fallback

`data/images.json` is still included so the game keeps working if:

- Supabase URL/key are blank.
- The Supabase CDN does not load.
- Supabase is unavailable.
- RLS blocks a request while testing.

If Supabase returns fewer approved rows than the configured round count, Chronoscope uses those approved rows and fills the remaining slots from JSON.

To add fallback entries manually:

1. Put image files in `assets/images/`.
2. Add matching entries to `data/images.json`.
3. Keep paths relative, for example `assets/images/my_archive_image.jpg`.
4. Verify source and rights before publishing.

## Run Locally

The game loads JSON with `fetch`, so run it through a local web server instead of opening `index.html` directly.

```bash
cd chronoscope
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Curator Research Assistant

Chronoscope includes an optional research workflow that proposes ten historical
images each day and sends them to `public.submissions` with `status = pending`.
It never publishes a case. Every candidate remains in the curator Review Queue
until the owner edits and approves it.

The workflow uses two research passes:

1. A discovery pass searches a restricted group of archives, libraries, and museums.
2. A separate audit pass rechecks the exact year, point-like location, image identity,
   and reuse rights.

Candidates are rejected when the date is approximate, the depicted location is only
known at city/region level, the image URL does not load, the location is disputed, or
the rights record is unclear. Evidence and confidence notes appear in the candidate's
**Admin notes** field. AI research is still fallible, so owner verification remains
mandatory.

### Enable the Daily Run

1. Open the GitHub repository.
2. Go to **Settings > Secrets and variables > Actions**.
3. Under **Secrets**, add `OPENAI_API_KEY` with an OpenAI API project key.
4. Optional: under **Variables**, add `OPENAI_MODEL`. The default is `gpt-5.6`.
5. Optional: add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as repository variables.
   The script otherwise uses the same public project URL and publishable key as the site.
6. Open **Actions > Research curator candidates > Run workflow** to test manually.

The scheduled workflow runs at `00:00 UTC`, which is `08:00` in Shanghai. OpenAI API
usage is billed separately from a ChatGPT subscription. No service-role key, database
password, or GitHub token is placed in the frontend or research script.

The workflow uses the existing anonymous insert-only RLS policy. It can add a pending
submission, but it cannot read the review queue, approve a case, edit published cases,
or publish into `public.images`.

### Pilot Batch

The first manually researched batch is stored in
`research/pilot-candidates-2026-08-23.json`. To validate it without writing to
Supabase:

```bash
CANDIDATE_COUNT=10 DRY_RUN=true node tools/generate-curator-candidates.mjs \
  --import research/pilot-candidates-2026-08-23.json
```

Omit `DRY_RUN=true` only when intentionally placing that batch into the pending queue.
Duplicate protection prevents the same pending research candidate from being inserted
twice.

## Deploy With GitHub Pages

1. Upload the contents of `outputs/history-photo-detective/` into the repository root. `index.html` must be at the top level.
2. Commit the files, including `assets/`, `data/`, and `supabase/`.
3. In the repository, open **Settings > Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and the `/ (root)` folder.
6. Save and wait for GitHub Pages to publish the site.

No build step is required. The `.nojekyll` file is included so GitHub Pages serves this as a plain static site.

## Google Analytics

The public site uses Google Analytics 4 with Measurement ID `G-4NTPNH9KXJ`.

Analytics is loaded with the standard async `gtag.js` snippet in `index.html`. `admin.html` intentionally does not include analytics.

To verify:

1. Deploy the latest files.
2. Open **Google Analytics > Reports > Realtime**.
3. Visit the public site in a normal browser window.
4. Start a game, submit a test proposal, open About, and finish a game.
5. Confirm these events appear: `start_game`, `submit_photo`, `open_about_page`, `view_results`, and `complete_game`.

If events do not appear immediately, try GA4 **DebugView** or test from a browser without analytics blockers.

## Testing Checklist

1. Open public site.
2. Submit a test image.
3. Confirm it appears in Supabase `submissions`.
4. Open `admin.html`.
5. Log in as owner.
6. See pending submission.
7. Edit title, year, or location if needed.
8. Approve it.
9. Confirm it appears in Supabase `images` with `approved = true`.
10. Return to public game.
11. Confirm approved entry can appear in playable cases.

Security checks:

- Anon user can read approved images.
- Anon user cannot read submissions.
- Anon user cannot approve submissions.
- Anon user cannot insert into images.
- Authenticated owner can read submissions.
- Authenticated owner can approve/reject.
- No service key appears anywhere in the repository.
- No database password appears anywhere in the repository.

## Scoring

Each round is worth 5,000 points:

- 2,500 for location
- 2,500 for time

Location uses the Haversine formula:

```js
locationScore = Math.max(0, Math.round(2500 * Math.exp(-distanceKm / 1500)));
```

Time uses absolute year error:

```js
timeScore = Math.max(0, Math.round(2500 * Math.exp(-yearError / 30)));
```

## Design Notes

Chronoscope is meant to feel like historical detective work rather than a school quiz. Strong entries reward visual reasoning: architecture, clothing, roads, signs, terrain, technology, material culture, and the quiet details of daily life.
