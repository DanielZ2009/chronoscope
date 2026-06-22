# Chronoscope

Chronoscope is a static historical map game. Players study an archival image, place it on a Leaflet world map, choose a year on a long historical timeline, and receive a score for location and time.

Version 1 is deliberately simple and review-first:

- Static HTML, CSS, JavaScript, and JSON
- Leaflet.js with OpenStreetMap tiles
- Image data in `data/images.json`
- Public homepage/game settings in `data/site_settings.json`
- Browser-only pending submissions, approvals, owner controls, and question sets
- Deployable on GitHub Pages with no backend

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
  README.md
```

## Run Locally

The game loads `data/images.json` with `fetch`, so run it through a local web server instead of opening `index.html` directly.

```bash
cd chronoscope
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Add Images

1. Put the image file in `assets/images/`.
2. Add a matching entry to `data/images.json`.
3. Keep image paths relative, for example `assets/images/beijing_church_001.jpg`.
4. Verify the location, date, source, and rights before publishing.

Sample entry:

```json
{
  "id": "beijing_church_001",
  "title": "Old Church in Beijing",
  "image": "assets/images/beijing_church_001.jpg",
  "locationName": "Beijing, China",
  "lat": 39.9042,
  "lng": 116.4074,
  "year": 1910,
  "yearRange": "c. 1910",
  "clue": "A Christian building in North China during the late Qing or early Republican period.",
  "explanation": "This image shows a Christian site in Beijing during a period when missionary institutions, local converts, and urban transformation intersected.",
  "source": "User-provided / public domain / verified archive source",
  "rights": "Public domain or permitted educational use",
  "difficulty": "medium",
  "tags": ["China", "Beijing", "religion", "urban history"]
}
```

## Edit `images.json`

`data/images.json` must remain valid JSON:

- Use double quotes around strings.
- Separate entries with commas.
- Keep `lat`, `lng`, and `year` as numbers.
- Use negative years for BCE dates, for example `-500` for 500 BCE.
- Avoid location-revealing titles if you later decide to show titles before guesses.

The included entries are playable placeholders. Replace the sample SVG images and source notes with verified archive material when ready.

## Submissions and Owner Review

The public **Submit a Photograph** page prepares a structured review record from a visitor proposal. It does not upload files, write to the repository, or publish anything to the game.

The owner workflow is separated from the public player interface:

- Public navigation does not link to owner tools.
- A small footer repair button asks for the owner repair code before opening `admin.html#repair`.
- The owner panel asks for a repair code before showing controls.
- Default owner repair code: `chronoscope-owner`

This is a static-site convenience gate, not true authentication. Anyone determined enough to inspect static source can find client-side code. For real private access, keep `admin.html` out of the published GitHub Pages folder or add a backend/auth layer later.

Use the Owner Repair Panel to:

- Review pending submissions.
- Edit title, image URL/path, location, coordinates, year, case note, historical record, source, rights, tags, and difficulty.
- Approve a submission into the local approved library.
- Reject a submission into a local rejected list.
- Add approved entries to the active question set.
- Copy approved JSON for manual publication.
- Manually paste approved entries into `data/images.json` when ready.

`data/pending_submissions.json` is an empty placeholder for future workflows. The static Version 1 app cannot write to it.

## Owner Controls

The Owner Repair Panel includes local controls for:

- Questions per game, from 1 to 20.
- Active question set.
- Three home page image URL/path slots for the overlapping archive preview.
- Whether locally approved images appear in owner previews.
- Daily image order for a stable same-day game.

These controls are saved in the browser first. They are useful for testing and curation, but they do not change the public GitHub Pages site until you copy the exported records into the repository.

To publish owner changes for every visitor:

1. Open the Owner Repair Panel.
2. Use **Publish Changes > Copy Site Settings** and paste the result into `data/site_settings.json`.
3. Use **Publish Changes > Copy Game Images** and paste the result into `data/images.json`.
4. If any image path begins with `assets/images/`, upload that image file into `assets/images/`.
5. Commit the changed files on GitHub.
6. Wait for GitHub Pages to redeploy, usually one to five minutes.

If a change appears only on your computer, it is still only in your browser's `localStorage`; it has not been committed to GitHub yet.

## Question Sets

Question sets are owner-created groups of image IDs. In the Owner Repair Panel you can:

- Create a new question set.
- Choose images from published entries and locally approved entries.
- Delete individual questions from a set before saving.
- Activate a set for local testing.
- Copy the active set JSON.
- Copy the active set's image entries as `images.json`-ready JSON.

To publish a curated set in Version 1, copy the active set's image entries and replace or edit `data/images.json`. Visitors can only play entries that exist in the published `data/images.json` file on GitHub Pages.

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

Five rounds produce a maximum score of 25,000.

## Deploy with GitHub Pages

The deployable site is this folder: `outputs/history-photo-detective/`.

For a first deployment through the GitHub website:

1. Create a new GitHub repository, for example `chronoscope`.
2. Keep the repository public if you are using GitHub Free.
3. Upload the contents of `outputs/history-photo-detective/` into the repository root. `index.html` must be at the top level.
4. Commit the uploaded files, including the full `assets/` and `data/` folders.
5. In the repository, open **Settings > Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select the `main` branch and the `/ (root)` folder.
8. Save and wait for GitHub Pages to publish the site.

No build step is required.

The `.nojekyll` file is included so GitHub Pages serves this as a plain static site.

## Custom Domain Later

1. In **Settings > Pages**, enter the custom domain.
2. Add the DNS records GitHub provides.
3. Commit a `CNAME` file containing only your domain if GitHub does not create it automatically.
4. Enable HTTPS after DNS finishes propagating.

## Design Notes

Chronoscope is meant to feel like historical detective work rather than a school quiz. Strong entries reward visual reasoning: architecture, clothing, roads, signs, terrain, technology, material culture, and the quiet details of daily life.
