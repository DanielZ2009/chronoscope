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
  README.md
```

## Supabase Setup

1. Create or open your Supabase project.
2. Go to **SQL Editor**.
3. Paste and run `supabase/migrations/001_chronoscope_schema.sql`.
4. Paste and run `supabase/migrations/003_site_settings.sql` to enable shared homepage gallery controls.
5. Paste and run `supabase/migrations/004_question_sets_and_submission_dedupe.sql` to enable global question sets, rejected-submission deletion, duplicate submission prevention, and placeholder cleanup.
6. Go to **Project Settings > API**.
7. Copy the Project URL.
8. Copy the anon/public/publishable key.
9. In `script.js`, set:

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

The public **Submit a Photograph** form inserts into `public.submissions` with:

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
2. Submit a test photograph.
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
