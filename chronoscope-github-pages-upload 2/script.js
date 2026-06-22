"use strict";

/*
  Chronoscope is designed for GitHub Pages plus an optional Supabase data layer.
  Approved public images load from Supabase first, then fall back to
  data/images.json if Supabase is not configured or unavailable.

  Only the Supabase project URL and anon/publishable key belong in this file.
  Never add a service role key, database password, or other secret to frontend
  JavaScript. Row Level Security is the security boundary.
*/

const IMAGE_DATA_URL = "data/images.json";
const SITE_SETTINGS_URL = "data/site_settings.json";

// Supabase frontend config. Paste only the project URL and anon/publishable key.
// Leave these blank to keep using the JSON fallback only.
const SUPABASE_URL = "https://ryofasvrzvdhgaaerhqb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XjqOxlNCTFKO_kGnRHmdPQ_2q8pyxbq";

const PENDING_STORAGE_KEY = "historyImageDetective.pendingSubmissions.v1";
const APPROVED_STORAGE_KEY = "historyImageDetective.approvedImages.v1";
const REJECTED_STORAGE_KEY = "historyImageDetective.rejectedSubmissions.v1";
const QUESTION_SETS_STORAGE_KEY = "historyImageDetective.questionSets.v1";
const OWNER_SETTINGS_STORAGE_KEY = "historyImageDetective.ownerSettings.v1";

const DEFAULT_ROUND_COUNT = 5;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 20;
const MAX_LOCATION_SCORE = 2500;
const MAX_TIME_SCORE = 2500;
const MAX_ROUND_SCORE = MAX_LOCATION_SCORE + MAX_TIME_SCORE;
const YEAR_MIN = -3000;
const YEAR_MAX = 2000;
const DEFAULT_YEAR = 1900;
const DEFAULT_HOME_IMAGES = [
  "assets/images/cairo_street_001.svg",
  "assets/images/beijing_church_001.svg",
  "assets/images/mumbai_station_001.svg",
];
const LEGACY_HOME_IMAGES = [
  "assets/images/beijing_church_001.svg",
  "assets/images/istanbul_bridge_001.svg",
  "assets/images/cairo_street_001.svg",
];
const DEFAULT_HOME_IMAGE = DEFAULT_HOME_IMAGES[0];
const DEFAULT_HOME_GALLERY = [
  {
    image: DEFAULT_HOME_IMAGES[0],
    place: "Cairo, Egypt",
    time: "c. 1910",
  },
  {
    image: DEFAULT_HOME_IMAGES[1],
    place: "Beijing, China",
    time: "c. 1910",
  },
  {
    image: DEFAULT_HOME_IMAGES[2],
    place: "Mumbai, India",
    time: "c. 1905",
  },
];

const DEFAULT_OWNER_SETTINGS = {
  roundsPerGame: DEFAULT_ROUND_COUNT,
  activeSetId: "all",
  includeApprovedLocal: false,
  randomizeRounds: true,
  homeImage: DEFAULT_HOME_IMAGE,
  homeImages: DEFAULT_HOME_IMAGES,
  homeGallery: DEFAULT_HOME_GALLERY,
};

const OWNER_APPROVED_SET_ID = "owner_approved_questions";

const state = {
  staticImages: [],
  images: [],
  rounds: [],
  results: [],
  currentRoundIndex: 0,
  guess: null,
  isRevealed: false,
  map: null,
  guessMarker: null,
  correctMarker: null,
  answerLine: null,
  submissionMap: null,
  submissionMarker: null,
  pendingSubmissionLatLng: null,
  confirmedSubmissionLatLng: null,
  publicSettings: DEFAULT_OWNER_SETTINGS,
  supabaseClient: null,
  dataSource: "json",
};

const adminState = {
  staticImages: [],
  bound: false,
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page === "admin") {
    initAdminPage();
    return;
  }

  initMainPage();
});

function $(selector, scope = document) {
  return scope.querySelector(selector);
}

function $$(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

async function initMainPage() {
  bindNavigation();
  bindGameControls();
  bindSubmissionLocationControls();
  bindSubmissionForm();
  bindCopyButtons();

  applyHashRoute();
  window.addEventListener("hashchange", applyHashRoute);

  await loadSiteSettings();
  await loadImageData();
  applyHomeGallery();
}

function bindNavigation() {
  $$("[data-view-target]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      showView(control.dataset.viewTarget);
    });
  });

  $$("[data-action='start-game']").forEach((control) => {
    control.addEventListener("click", () => startGame());
  });
}

function showView(viewName) {
  $$("[data-view]").forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.view === viewName);
  });

  if (viewName === "game" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 80);
  }

  if (viewName === "submit") {
    setTimeout(() => initSubmissionMap(), 80);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyHomeGallery() {
  const settings = readOwnerSettings();
  const gallery = resolveHomeGallery(settings);
  ["#homeImageOne", "#homeImageTwo", "#homeImageThree"].forEach((selector, index) => {
    const image = $(selector);
    if (image) {
      image.src = safeImageUrl(gallery[index]?.image || DEFAULT_HOME_IMAGES[index]);
    }
  });

  [
    ["#homePlaceOne", "#homeTimeOne"],
    ["#homePlaceTwo", "#homeTimeTwo"],
    ["#homePlaceThree", "#homeTimeThree"],
  ].forEach(([placeSelector, timeSelector], index) => {
    const place = $(placeSelector);
    const time = $(timeSelector);
    if (place) {
      place.textContent = gallery[index]?.place || DEFAULT_HOME_GALLERY[index].place;
    }
    if (time) {
      time.textContent = gallery[index]?.time || DEFAULT_HOME_GALLERY[index].time;
    }
  });
}

function applyHashRoute() {
  const viewName = location.hash.replace("#", "");
  if (["home", "submit", "about"].includes(viewName)) {
    showView(viewName);
  }
}

async function fetchJsonImageData() {
  const response = await fetch(IMAGE_DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${IMAGE_DATA_URL}`);
  }

  return response.json();
}

async function fetchImageData() {
  const requiredRows = getConfiguredRoundCount(readOwnerSettings());

  try {
    const supabaseImages = await fetchSupabaseImageData();
    if (supabaseImages.length >= requiredRows) {
      state.dataSource = "supabase";
      return supabaseImages;
    }

    if (supabaseImages.length > 0) {
      console.warn(`Supabase returned ${supabaseImages.length} approved image(s); falling back to JSON for ${requiredRows} configured round(s).`);
    }
  } catch (error) {
    if (isSupabaseConfigured()) {
      console.warn("Supabase image load failed; using JSON fallback.", error);
    }
  }

  state.dataSource = "json";
  return fetchJsonImageData();
}

async function fetchSupabaseImageData() {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("images")
    .select("*")
    .eq("approved", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || [])
    .map(normalizeSupabaseImageRow)
    .filter(isPlayableImage);
}

async function loadSiteSettings() {
  try {
    const response = await fetch(SITE_SETTINGS_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${SITE_SETTINGS_URL}`);
    }

    state.publicSettings = normalizeOwnerSettings(await response.json());
  } catch (error) {
    state.publicSettings = normalizeOwnerSettings(DEFAULT_OWNER_SETTINGS);
    console.warn(error);
  }
}

// This is the only public data load for the game. On GitHub Pages this fetches
// static JSON, then optionally applies owner-local settings from this browser.
async function loadImageData() {
  const status = $("#dataStatus");

  try {
    const images = await fetchImageData();
    state.staticImages = images.filter(isPlayableImage).map(normalizeImageEntry);
    state.images = resolveGameImagePool(state.staticImages);

    if (status) {
      status.textContent = "";
    }
  } catch (error) {
    if (status) {
      status.textContent = "Image data could not load.";
    }
    console.error(error);
  }
}

function isPlayableImage(image) {
  return (
    image &&
    typeof image.title === "string" &&
    typeof image.image === "string" &&
    Number.isFinite(Number(image.lat)) &&
    Number.isFinite(Number(image.lng)) &&
    Number.isFinite(Number(image.year))
  );
}

function normalizeImageEntry(entry) {
  const year = Number(entry.year);
  const title = cleanString(entry.title) || "Untitled image";

  return {
    id: cleanString(entry.id) || `${slugify(title)}_${Date.now()}`,
    title,
    image: cleanString(entry.image),
    locationName: cleanString(entry.locationName),
    lat: Number(entry.lat),
    lng: Number(entry.lng),
    year,
    yearRange: cleanString(entry.yearRange) || `c. ${year}`,
    clue: cleanString(entry.clue),
    explanation: cleanString(entry.explanation),
    source: cleanString(entry.source),
    rights: cleanString(entry.rights),
    difficulty: cleanString(entry.difficulty) || "medium",
    tags: Array.isArray(entry.tags) ? entry.tags.map(cleanString).filter(Boolean) : [],
    submitter: cleanString(entry.submitter),
    submittedAt: cleanString(entry.submittedAt),
    approvedAt: cleanString(entry.approvedAt),
  };
}

function normalizeSupabaseImageRow(row) {
  return normalizeImageEntry({
    id: row.id,
    title: row.title,
    image: row.image_url,
    locationName: row.location_name,
    lat: row.lat,
    lng: row.lng,
    year: row.year,
    yearRange: row.year_range,
    clue: row.case_note,
    explanation: row.historical_record,
    source: row.source,
    rights: row.rights,
    difficulty: row.difficulty,
    tags: row.tags,
    approvedAt: row.created_at,
  });
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (state.supabaseClient) {
    return state.supabaseClient;
  }

  state.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return state.supabaseClient;
}

function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      window.supabase &&
      typeof window.supabase.createClient === "function"
  );
}

function resolveGameImagePool(staticImages) {
  const settings = readOwnerSettings();
  const activeSet = getActiveQuestionSet(settings.activeSetId);
  const includeApproved = settings.includeApprovedLocal || activeSet.id !== "all";
  const sourceImages = includeApproved
    ? mergeImageLists(staticImages, readApprovedImages())
    : [...staticImages];

  if (activeSet.id === "all") {
    return sourceImages.filter(isPlayableImage);
  }

  const allowedIds = new Set(activeSet.imageIds || []);
  return sourceImages.filter((image) => allowedIds.has(image.id) && isPlayableImage(image));
}

function bindGameControls() {
  $("#yearInput").min = YEAR_MIN;
  $("#yearInput").max = YEAR_MAX;
  setYearGuess(DEFAULT_YEAR);

  $("#yearInput").addEventListener("input", (event) => setYearGuess(event.target.value));
  bindTimelineControl();
  $("#submitGuess").addEventListener("click", submitGuess);
  $("#nextRound").addEventListener("click", advanceRound);
}

function setYearGuess(value) {
  const numericValue = Number.parseInt(value, 10);
  const safeYear = Number.isFinite(numericValue)
    ? Math.min(YEAR_MAX, Math.max(YEAR_MIN, numericValue))
    : DEFAULT_YEAR;
  const playableYear = safeYear === 0 ? 1 : safeYear;

  $("#yearInput").value = playableYear;
  $("#yearDisplay").textContent = formatYearLabel(playableYear);
  updateTimelineMarker(playableYear);
}

function bindTimelineControl() {
  const timeline = $("#timeTimeline");
  if (!timeline) {
    return;
  }

  const updateFromPointer = (event) => {
    const rect = timeline.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setYearGuess(yearFromTimelineRatio(ratio));
  };

  timeline.addEventListener("pointerdown", (event) => {
    timeline.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });

  timeline.addEventListener("pointermove", (event) => {
    if (event.buttons === 1) {
      updateFromPointer(event);
    }
  });

  timeline.addEventListener("keydown", (event) => {
    const current = Number($("#yearInput").value) || DEFAULT_YEAR;
    const step = event.shiftKey ? 100 : 25;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setYearGuess(current - step);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setYearGuess(current + step);
    }
    if (event.key === "Home") {
      event.preventDefault();
      setYearGuess(YEAR_MIN);
    }
    if (event.key === "End") {
      event.preventDefault();
      setYearGuess(YEAR_MAX);
    }
  });
}

function yearFromTimelineRatio(ratio) {
  const safeRatio = Math.min(1, Math.max(0, ratio));
  const year = Math.round(YEAR_MIN + safeRatio * (YEAR_MAX - YEAR_MIN));
  return year === 0 ? 1 : year;
}

function updateTimelineMarker(year) {
  const marker = $("#timeMarker");
  const timeline = $("#timeTimeline");
  if (!marker || !timeline) {
    return;
  }

  const ratio = (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
  marker.style.left = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  timeline.setAttribute("aria-valuenow", String(year));
  timeline.setAttribute("aria-valuetext", formatYearLabel(year));
}

function startGame() {
  state.images = resolveGameImagePool(state.staticImages);

  if (state.images.length === 0) {
    const status = $("#dataStatus");
    if (status) {
      status.textContent = "No playable images are available.";
    }
    showView("home");
    return;
  }

  const settings = readOwnerSettings();
  const roundCount = Math.min(getConfiguredRoundCount(settings), state.images.length);
  // TODO: Expand deterministic daily challenge mode with past-day archives and shareable daily IDs.
  const pool = settings.randomizeRounds ? seededShuffle([...state.images], getDailySeedKey()) : [...state.images];

  state.rounds = pool.slice(0, roundCount);
  state.results = [];
  state.currentRoundIndex = 0;
  state.guess = null;
  state.isRevealed = false;

  showView("game");

  requestAnimationFrame(() => {
    initMap();
    loadRound();
  });
}

function initMap() {
  if (state.map) {
    state.map.invalidateSize();
    return;
  }

  if (typeof L === "undefined") {
    $("#mapStatus").textContent = "Leaflet did not load. Check your network connection for the CDN files.";
    return;
  }

  state.map = L.map("guessMap", {
    minZoom: 2,
    worldCopyJump: true,
  }).setView([22, 12], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.map.on("click", handleMapClick);
}

function createMapPinIcon(type) {
  if (typeof L === "undefined") {
    return undefined;
  }

  return L.divIcon({
    className: `map-pin map-pin-${type}`,
    html: "<span></span>",
    iconSize: [26, 34],
    iconAnchor: [13, 32],
    popupAnchor: [0, -28],
  });
}

function getRevealMaxZoom(distanceKm) {
  if (distanceKm < 1) return 15;
  if (distanceKm < 5) return 13;
  if (distanceKm < 25) return 11;
  if (distanceKm < 100) return 9;
  if (distanceKm < 500) return 7;
  return 6;
}

function loadRound() {
  const round = getCurrentRound();
  if (!round) {
    showResults();
    return;
  }

  state.guess = null;
  state.isRevealed = false;
  clearMapLayers();
  setYearGuess(DEFAULT_YEAR);

  $("#roundTitle").textContent = `Archive Image ${state.currentRoundIndex + 1}`;
  $("#roundCounter").textContent = `Round ${state.currentRoundIndex + 1} of ${state.rounds.length}`;
  $("#scorePreview").textContent = `Score ${formatNumber(getTotalScore())} / ${formatNumber(state.rounds.length * MAX_ROUND_SCORE)}`;
  $("#imageImage").src = round.image;
  $("#imageImage").alt = "Archival image for this round";
  $("#imageCaption").textContent = "Archive image. Source details appear after the guess.";
  $("#mapStatus").textContent = "No location selected";
  $("#submitGuess").disabled = true;
  $("#submitGuess").hidden = false;
  $("#nextRound").hidden = true;
  $("#revealPanel").hidden = true;
  $("#revealPanel").innerHTML = "";

  if (state.map) {
    state.map.setView([22, 12], 2);
    setTimeout(() => state.map.invalidateSize(), 80);
  }
}

function handleMapClick(event) {
  if (!state.map || state.isRevealed) {
    return;
  }

  state.guess = {
    lat: event.latlng.lat,
    lng: event.latlng.lng,
  };

  if (state.guessMarker) {
    state.guessMarker.setLatLng(event.latlng);
  } else {
    state.guessMarker = L.marker(event.latlng, {
      icon: createMapPinIcon("guess"),
    }).addTo(state.map);
  }

  $("#submitGuess").disabled = false;
  $("#mapStatus").textContent = `Location selected: ${formatCoordinate(state.guess.lat)}, ${formatCoordinate(state.guess.lng)}`;
}

function submitGuess() {
  const round = getCurrentRound();
  if (!round || !state.guess) {
    $("#mapStatus").textContent = "Select a location on the map first.";
    return;
  }

  const guessedYear = Number($("#yearInput").value);
  const result = scoreRound(round, state.guess, guessedYear);
  state.results.push(result);
  revealRound(result);
}

/*
  Scoring:
  - Location uses the Haversine formula to calculate distance in kilometers.
  - Time uses absolute year difference.
  - Both scores decay exponentially so close guesses score high and distant
    guesses taper toward zero without needing hard cutoffs.
*/
function scoreRound(round, guess, guessedYear) {
  const distanceKm = haversineDistance(guess.lat, guess.lng, Number(round.lat), Number(round.lng));
  const yearError = Math.abs(guessedYear - Number(round.year));
  const locationScore = Math.max(0, Math.round(MAX_LOCATION_SCORE * Math.exp(-distanceKm / 1500)));
  const timeScore = Math.max(0, Math.round(MAX_TIME_SCORE * Math.exp(-yearError / 30)));
  const roundScore = locationScore + timeScore;

  return {
    roundNumber: state.currentRoundIndex + 1,
    imageId: round.id,
    title: round.title,
    image: round.image,
    locationName: round.locationName,
    actualLat: Number(round.lat),
    actualLng: Number(round.lng),
    guessedLat: guess.lat,
    guessedLng: guess.lng,
    actualYear: Number(round.year),
    yearRange: round.yearRange,
    guessedYear,
    distanceKm,
    yearError,
    locationScore,
    timeScore,
    roundScore,
    explanation: round.explanation,
    source: round.source,
    rights: round.rights,
  };
}

function revealRound(result) {
  state.isRevealed = true;
  $("#submitGuess").hidden = true;
  $("#nextRound").hidden = false;
  $("#roundTitle").textContent = result.title;
  $("#scorePreview").textContent = `Score ${formatNumber(getTotalScore())} / ${formatNumber(state.rounds.length * MAX_ROUND_SCORE)}`;

  if (state.map) {
    const correctLatLng = [result.actualLat, result.actualLng];
    if (state.guessMarker) {
      state.guessMarker.setIcon(createMapPinIcon("guess")).bindPopup("Your guess");
    }
    state.correctMarker = L.marker(correctLatLng, {
      icon: createMapPinIcon("answer"),
    }).addTo(state.map).bindPopup("Correct location");
    state.answerLine = L.polyline(
      [
        [result.guessedLat, result.guessedLng],
        correctLatLng,
      ],
      { color: "#8F241F", weight: 3, opacity: 0.82 }
    ).addTo(state.map);

    state.map.fitBounds(state.answerLine.getBounds(), {
      padding: [54, 54],
      maxZoom: getRevealMaxZoom(result.distanceKm),
    });
  }

  $("#revealPanel").innerHTML = `
    <p class="kicker">The Record</p>
    <h3>${escapeHtml(result.locationName)} - ${escapeHtml(result.yearRange || String(result.actualYear))}</h3>
    <p class="answer-line">
      Your location error was <strong>${formatDistance(result.distanceKm)}</strong>.
      Your time error was <strong>${formatNumber(result.yearError)} years</strong>.
    </p>
    <div class="score-grid">
      <div class="score-tile">
        <span>Location score</span>
        <strong>${formatNumber(result.locationScore)} / ${formatNumber(MAX_LOCATION_SCORE)}</strong>
      </div>
      <div class="score-tile">
        <span>Time score</span>
        <strong>${formatNumber(result.timeScore)} / ${formatNumber(MAX_TIME_SCORE)}</strong>
      </div>
      <div class="score-tile">
        <span>Round score</span>
        <strong>${formatNumber(result.roundScore)} / ${formatNumber(MAX_ROUND_SCORE)}</strong>
      </div>
    </div>
    <div class="historical-record">
      <h4>Historical Record</h4>
      <p>${escapeHtml(result.explanation || "This entry is awaiting a fuller historical note after source verification.")}</p>
    </div>
    <p class="source-line">Gold pin: your guess | Burgundy pin: answer</p>
    <p class="source-line">Source: ${escapeHtml(result.source || "Not provided")} | Rights: ${escapeHtml(result.rights || "Not provided")}</p>
  `;
  $("#revealPanel").hidden = false;
}

function advanceRound() {
  state.currentRoundIndex += 1;
  if (state.currentRoundIndex >= state.rounds.length) {
    showResults();
    return;
  }

  loadRound();
}

function showResults() {
  const totalScore = getTotalScore();
  const maxScore = state.rounds.length * MAX_ROUND_SCORE;
  const rating = ratingForScore(totalScore, maxScore);

  $("#finalScore").textContent = `${formatNumber(totalScore)} / ${formatNumber(maxScore)}`;
  $("#ratingTitle").textContent = rating;
  $("#roundBreakdown").innerHTML = renderRoundTable(state.results);

  const shareText = [
    "Chronoscope",
    `${formatNumber(totalScore)} / ${formatNumber(maxScore)}`,
    "I placed images in space and time.",
    "Can you read the traces?",
  ].join("\n");

  $("#shareText").value = shareText;
  $("#copyResultStatus").textContent = "";
  showView("results");
}

function renderRoundTable(results) {
  if (results.length === 0) {
    return "<p>No completed rounds yet.</p>";
  }

  const rows = results
    .map(
      (result) => `
        <tr>
          <td>${result.roundNumber}</td>
          <td>${escapeHtml(result.locationName)}<br><span class="answer-line">${escapeHtml(result.yearRange || String(result.actualYear))}</span></td>
          <td>${formatDistance(result.distanceKm)}</td>
          <td>${formatNumber(result.yearError)} years</td>
          <td>${formatNumber(result.locationScore)}</td>
          <td>${formatNumber(result.timeScore)}</td>
          <td><strong>${formatNumber(result.roundScore)}</strong></td>
        </tr>
      `
    )
    .join("");

  return `
    <table class="round-table">
      <thead>
        <tr>
          <th>Round</th>
          <th>Answer</th>
          <th>Distance</th>
          <th>Time</th>
          <th>Loc.</th>
          <th>Year</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function bindSubmissionForm() {
  const form = $("#submissionForm");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const entry = buildSubmissionEntry(new FormData(form));

    try {
      await submitEntryToSupabase(entry);
      $("#generatedSubmission").value = "";
      $("#submissionStatus").textContent = "Submission received. It will be reviewed before appearing in Chronoscope.";
    } catch (error) {
      const pending = readPendingSubmissions();
      pending.push(entry);
      writePendingSubmissions(pending);

      $("#generatedSubmission").value = JSON.stringify(entry, null, 2);
      $("#submissionStatus").textContent = "Supabase could not receive this submission. A backup review record is ready to copy and send to the site owner.";
      console.warn("Supabase submission failed; using copyable JSON fallback.", error);
    }
  });

  form.addEventListener("reset", () => {
    $("#generatedSubmission").value = "";
    $("#submissionStatus").textContent = "";
    clearSubmissionLocation();
  });
}

function bindSubmissionLocationControls() {
  const confirmButton = $("#confirmSubmissionLocation");
  const clearButton = $("#clearSubmissionLocation");
  if (!confirmButton || !clearButton) {
    return;
  }

  confirmButton.addEventListener("click", () => {
    if (!state.pendingSubmissionLatLng) {
      $("#submissionMapStatus").textContent = "Click a point on the map first.";
      return;
    }

    state.confirmedSubmissionLatLng = { ...state.pendingSubmissionLatLng };
    const latInput = $("#submissionForm [name='lat']");
    const lngInput = $("#submissionForm [name='lng']");
    latInput.value = state.confirmedSubmissionLatLng.lat.toFixed(5);
    lngInput.value = state.confirmedSubmissionLatLng.lng.toFixed(5);
    $("#submissionMapStatus").textContent = `Confirmed: ${formatCoordinate(state.confirmedSubmissionLatLng.lat)}, ${formatCoordinate(state.confirmedSubmissionLatLng.lng)}`;
  });

  clearButton.addEventListener("click", clearSubmissionLocation);
}

function initSubmissionMap() {
  const mapElement = $("#submissionMap");
  if (!mapElement || state.submissionMap) {
    if (state.submissionMap) {
      state.submissionMap.invalidateSize();
    }
    return;
  }

  if (typeof L === "undefined") {
    $("#submissionMapStatus").textContent = "Leaflet did not load. Enter latitude and longitude manually.";
    return;
  }

  state.submissionMap = L.map("submissionMap", {
    minZoom: 2,
    worldCopyJump: true,
  }).setView([22, 12], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.submissionMap);

  state.submissionMap.on("click", (event) => {
    state.pendingSubmissionLatLng = {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
    };

    if (state.submissionMarker) {
      state.submissionMarker.setLatLng(event.latlng);
    } else {
      state.submissionMarker = L.marker(event.latlng).addTo(state.submissionMap);
    }

    $("#submissionMapStatus").textContent = `Selected: ${formatCoordinate(event.latlng.lat)}, ${formatCoordinate(event.latlng.lng)}. Confirm to record it.`;
  });
}

function clearSubmissionLocation() {
  state.pendingSubmissionLatLng = null;
  state.confirmedSubmissionLatLng = null;

  if (state.submissionMarker && state.submissionMap) {
    state.submissionMap.removeLayer(state.submissionMarker);
  }
  state.submissionMarker = null;

  const latInput = $("#submissionForm [name='lat']");
  const lngInput = $("#submissionForm [name='lng']");
  if (latInput && lngInput) {
    latInput.value = "";
    lngInput.value = "";
  }

  const status = $("#submissionMapStatus");
  if (status) {
    status.textContent = "No map point selected yet.";
  }
}

function buildSubmissionEntry(formData) {
  const title = cleanString(formData.get("title"));
  const year = Number(formData.get("year"));
  const idBase = slugify(title || "submitted-image");

  return {
    id: `${idBase}_${Date.now()}`,
    title,
    image: cleanString(formData.get("image")),
    locationName: cleanString(formData.get("locationName")),
    lat: Number(formData.get("lat")),
    lng: Number(formData.get("lng")),
    year,
    yearRange: `c. ${year}`,
    clue: cleanString(formData.get("clue")),
    explanation: cleanString(formData.get("explanation")),
    source: cleanString(formData.get("source")),
    rights: cleanString(formData.get("rights")),
    difficulty: "unreviewed",
    tags: [],
    submitter: cleanString(formData.get("submitter")),
    submitterContact: cleanString(formData.get("submitterContact")),
    submittedAt: new Date().toISOString(),
  };
}

async function submitEntryToSupabase(entry) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  const { error } = await client.from("submissions").insert(mapSubmissionToSupabaseRow(entry));
  if (error) {
    throw error;
  }
}

function mapSubmissionToSupabaseRow(entry) {
  return {
    title: entry.title,
    image_url: entry.image,
    location_name: entry.locationName || null,
    lat: Number.isFinite(Number(entry.lat)) ? Number(entry.lat) : null,
    lng: Number.isFinite(Number(entry.lng)) ? Number(entry.lng) : null,
    year: Number.isFinite(Number(entry.year)) ? Number(entry.year) : null,
    year_range: entry.yearRange || null,
    case_note: entry.clue || null,
    historical_record: entry.explanation || null,
    source: entry.source || null,
    rights: entry.rights || null,
    submitter_name: entry.submitter || null,
    submitter_contact: entry.submitterContact || null,
    status: "pending",
  };
}

function bindCopyButtons() {
  const copySubmission = $("#copySubmission");
  if (copySubmission) {
    copySubmission.addEventListener("click", async () => {
      const text = $("#generatedSubmission").value.trim();
      if (!text) {
        $("#submissionStatus").textContent = "Submit a proposal first.";
        return;
      }
      await copyText(text);
      $("#submissionStatus").textContent = "Submission record copied.";
    });
  }

  const copyResult = $("#copyResult");
  if (copyResult) {
    copyResult.addEventListener("click", async () => {
      await copyText($("#shareText").value);
      $("#copyResultStatus").textContent = "Result copied.";
    });
  }
}

async function initAdminPage() {
  bindCuratorAdmin();

  if (!isSupabaseConfigured()) {
    showCuratorLogin("Supabase is not configured yet. Add the project URL and anon key in script.js.");
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    showCuratorLogin(error.message);
    return;
  }

  if (data.session) {
    await showCuratorDashboard(data.session);
  } else {
    showCuratorLogin();
  }

  client.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      await showCuratorDashboard(session);
    } else {
      showCuratorLogin();
    }
  });
}

function bindCuratorAdmin() {
  if (adminState.bound) {
    return;
  }
  adminState.bound = true;

  const loginForm = $("#curatorLoginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const client = getSupabaseClient();
      if (!client) {
        $("#curatorLoginStatus").textContent = "Supabase is not configured yet.";
        return;
      }

      $("#curatorLoginStatus").textContent = "Signing in...";
      const email = cleanString($("#curatorEmail").value);
      const password = $("#curatorPassword").value;
      const { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        $("#curatorLoginStatus").textContent = error.message;
        return;
      }

      $("#curatorPassword").value = "";
      await showCuratorDashboard(data.session);
    });
  }

  const logoutButton = $("#curatorLogout");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.signOut();
      }
      showCuratorLogin("Signed out.");
    });
  }

  const refreshButton = $("#refreshCuratorData");
  if (refreshButton) {
    refreshButton.addEventListener("click", loadCuratorDashboard);
  }

  const pendingList = $("#pendingSubmissionsList");
  if (pendingList) {
    pendingList.addEventListener("click", handleCuratorSubmissionAction);
  }

  const approvedList = $("#approvedImagesList");
  if (approvedList) {
    approvedList.addEventListener("click", handleCuratorImageAction);
  }
}

function showCuratorLogin(message = "") {
  $("#curatorDashboard")?.classList.remove("is-active");
  $("#curatorLogin")?.classList.add("is-active");
  if ($("#curatorLoginStatus")) {
    $("#curatorLoginStatus").textContent = message;
  }
}

async function showCuratorDashboard(session) {
  $("#curatorLogin")?.classList.remove("is-active");
  $("#curatorDashboard")?.classList.add("is-active");
  if ($("#curatorUserEmail")) {
    $("#curatorUserEmail").textContent = session?.user?.email || "Curator";
  }
  await loadCuratorDashboard();
}

async function loadCuratorDashboard() {
  const client = getSupabaseClient();
  if (!client) {
    showCuratorLogin("Supabase is not configured yet.");
    return;
  }

  $("#curatorStatus").textContent = "Loading curator records...";

  const [submissionsResult, imagesResult] = await Promise.all([
    client.from("submissions").select("*").order("created_at", { ascending: false }),
    client.from("images").select("*").order("created_at", { ascending: false }),
  ]);

  if (submissionsResult.error) {
    $("#curatorStatus").textContent = submissionsResult.error.message;
    return;
  }

  if (imagesResult.error) {
    $("#curatorStatus").textContent = imagesResult.error.message;
    return;
  }

  const submissions = submissionsResult.data || [];
  const pending = submissions.filter((entry) => entry.status === "pending");
  const rejected = submissions.filter((entry) => entry.status === "rejected");

  renderCuratorPendingSubmissions(pending);
  renderCuratorApprovedImages(imagesResult.data || []);
  renderCuratorRejectedSubmissions(rejected);
  $("#curatorStatus").textContent = `${pending.length} pending submission${pending.length === 1 ? "" : "s"} ready for review.`;
}

function renderCuratorPendingSubmissions(submissions) {
  const container = $("#pendingSubmissionsList");
  if (!container) {
    return;
  }

  if (submissions.length === 0) {
    container.innerHTML = renderCuratorEmptyState("No pending submissions", "New public submissions will appear here.");
    return;
  }

  container.innerHTML = submissions.map((entry) => renderCuratorSubmissionCard(entry, true)).join("");
}

function renderCuratorApprovedImages(images) {
  const container = $("#approvedImagesList");
  if (!container) {
    return;
  }

  if (images.length === 0) {
    container.innerHTML = renderCuratorEmptyState("No approved images", "Published Chronoscope cases will appear here.");
    return;
  }

  container.innerHTML = images.map(renderCuratorImageCard).join("");
}

function renderCuratorRejectedSubmissions(submissions) {
  const container = $("#rejectedSubmissionsList");
  if (!container) {
    return;
  }

  if (submissions.length === 0) {
    container.innerHTML = renderCuratorEmptyState("No rejected submissions", "Rejected submissions are kept here for reference.");
    return;
  }

  container.innerHTML = submissions.map((entry) => renderCuratorSubmissionCard(entry, false)).join("");
}

function renderCuratorEmptyState(title, body) {
  return `
    <section class="curator-card empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </section>
  `;
}

function renderCuratorSubmissionCard(entry, editable) {
  const tags = Array.isArray(entry.tags) ? entry.tags.join(", ") : "";
  const difficulty = cleanString(entry.difficulty) || "medium";
  const submittedBy = [entry.submitter_name, entry.submitter_contact].map(cleanString).filter(Boolean).join(" | ") || "Not provided";

  return `
    <article class="curator-card" data-curator-submission-id="${escapeAttribute(entry.id)}">
      <div class="curator-preview">
        <img src="${escapeAttribute(safeImageUrl(entry.image_url))}" alt="${escapeAttribute(entry.title || "Submitted image")}" />
        <span class="status-pill">${escapeHtml(entry.status || "pending")}</span>
      </div>
      <div>
        <div class="curator-card-head">
          <div>
            <p class="kicker">Review Case</p>
            <h3>${escapeHtml(entry.title || "Untitled submission")}</h3>
          </div>
          <p class="source-line">${escapeHtml(formatAdminDate(entry.created_at))}</p>
        </div>
        <div class="submission-fields">
          <div><span>Submitter</span><strong>${escapeHtml(submittedBy)}</strong></div>
          <div><span>Original status</span><strong>${escapeHtml(entry.status || "pending")}</strong></div>
        </div>
        <form class="curator-edit-grid" data-curator-form="${escapeAttribute(entry.id)}">
          ${renderCuratorInput("Title", "title", entry.title, "input", true)}
          ${renderCuratorInput("Image URL", "image_url", entry.image_url, "input", true)}
          ${renderCuratorInput("Location name", "location_name", entry.location_name, "input", true)}
          ${renderCuratorInput("Latitude", "lat", entry.lat, "number", true)}
          ${renderCuratorInput("Longitude", "lng", entry.lng, "number", true)}
          ${renderCuratorInput("Year", "year", entry.year, "number", true)}
          ${renderCuratorInput("Year range", "year_range", entry.year_range)}
          ${renderCuratorInput("Difficulty", "difficulty", difficulty)}
          ${renderCuratorInput("Tags", "tags", tags)}
          ${renderCuratorInput("Source", "source", entry.source)}
          ${renderCuratorInput("Rights", "rights", entry.rights)}
          ${renderCuratorInput("Case note", "case_note", entry.case_note, "textarea")}
          ${renderCuratorInput("Historical Record", "historical_record", entry.historical_record, "textarea")}
          ${renderCuratorInput("Admin notes", "admin_notes", entry.admin_notes, "textarea")}
        </form>
        ${
          editable
            ? `<div class="button-row curator-actions">
                <button class="secondary-button" type="button" data-action="save-submission">Edit</button>
                <button class="primary-button" type="button" data-action="approve-submission">Publish to Chronoscope</button>
                <button class="danger-button" type="button" data-action="reject-submission">Reject Submission</button>
              </div>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderCuratorInput(label, field, value, type = "input", required = false) {
  const safeValue = value === null || value === undefined ? "" : String(value);
  const requiredLabel = required ? " required" : "";
  const inputType = type === "number" ? "number" : "text";
  const step = field === "lat" || field === "lng" ? ` step="0.00001"` : "";
  const numberAttrs = type === "number" ? `${step}` : "";

  if (type === "textarea") {
    return `
      <label class="full-span">${escapeHtml(label)}${requiredLabel}
        <textarea data-field="${escapeAttribute(field)}" rows="3">${escapeHtml(safeValue)}</textarea>
      </label>
    `;
  }

  return `
    <label>${escapeHtml(label)}${requiredLabel}
      <input data-field="${escapeAttribute(field)}" type="${inputType}"${numberAttrs} value="${escapeAttribute(safeValue)}" />
    </label>
  `;
}

function renderCuratorImageCard(row) {
  const year = row.year_range || String(row.year || "");
  const tags = Array.isArray(row.tags) && row.tags.length ? row.tags.join(", ") : "No tags";
  return `
    <article class="curator-card compact-curator-card" data-curator-image-id="${escapeAttribute(row.id)}">
      <div class="curator-preview">
        <img src="${escapeAttribute(safeImageUrl(row.image_url))}" alt="${escapeAttribute(row.title || "Approved image")}" />
        <span class="status-pill">${row.approved ? "Published" : "Hidden"}</span>
      </div>
      <div>
        <h3>${escapeHtml(row.title || "Untitled image")}</h3>
        <div class="submission-fields">
          <div><span>Location</span><strong>${escapeHtml(row.location_name || "Not provided")}</strong></div>
          <div><span>Year</span><strong>${escapeHtml(year)}</strong></div>
          <div><span>Coordinates</span><strong>${formatCoordinate(row.lat)}, ${formatCoordinate(row.lng)}</strong></div>
          <div><span>Tags</span><strong>${escapeHtml(tags)}</strong></div>
        </div>
        <div class="button-row curator-actions">
          <button class="secondary-button" type="button" data-action="toggle-image">${row.approved ? "Unpublish" : "Publish"}</button>
          <button class="danger-button" type="button" data-action="delete-image">Delete</button>
        </div>
      </div>
    </article>
  `;
}

async function handleCuratorSubmissionAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const card = event.target.closest("[data-curator-submission-id]");
  if (!card) {
    return;
  }

  const submissionId = card.dataset.curatorSubmissionId;
  const action = button.dataset.action;

  if (action === "save-submission") {
    await saveCuratorSubmission(submissionId);
  }
  if (action === "approve-submission") {
    await approveCuratorSubmission(submissionId);
  }
  if (action === "reject-submission") {
    await rejectCuratorSubmission(submissionId);
  }
}

async function handleCuratorImageAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const card = event.target.closest("[data-curator-image-id]");
  if (!card) {
    return;
  }

  const imageId = card.dataset.curatorImageId;
  if (button.dataset.action === "toggle-image") {
    await toggleCuratorImage(imageId, button.textContent.trim() === "Unpublish");
  }
  if (button.dataset.action === "delete-image") {
    await deleteCuratorImage(imageId);
  }
}

async function saveCuratorSubmission(submissionId) {
  const client = getSupabaseClient();
  const values = readCuratorFormValues(submissionId);
  const { error } = await client
    .from("submissions")
    .update(mapCuratorValuesToSubmissionUpdate(values))
    .eq("id", submissionId);

  if (error) {
    $("#curatorStatus").textContent = error.message;
    return;
  }

  $("#curatorStatus").textContent = "Review edits saved.";
  await loadCuratorDashboard();
}

async function approveCuratorSubmission(submissionId) {
  const client = getSupabaseClient();
  const values = readCuratorFormValues(submissionId);
  const validationError = validateCuratorImageValues(values);
  if (validationError) {
    $("#curatorStatus").textContent = validationError;
    return;
  }

  const { error: insertError } = await client
    .from("images")
    .insert(mapCuratorValuesToImageRow(values));

  if (insertError) {
    $("#curatorStatus").textContent = insertError.message;
    return;
  }

  const { error: updateError } = await client
    .from("submissions")
    .update({
      ...mapCuratorValuesToSubmissionUpdate(values),
      status: "approved",
    })
    .eq("id", submissionId);

  if (updateError) {
    $("#curatorStatus").textContent = `Published, but submission status could not update: ${updateError.message}`;
    await loadCuratorDashboard();
    return;
  }

  $("#curatorStatus").textContent = "Published. This case is now visible to players.";
  await loadCuratorDashboard();
}

async function rejectCuratorSubmission(submissionId) {
  const client = getSupabaseClient();
  const values = readCuratorFormValues(submissionId);
  const note = window.prompt("Optional admin note for this rejection:", values.admin_notes || "");
  const { error } = await client
    .from("submissions")
    .update({
      ...mapCuratorValuesToSubmissionUpdate(values),
      status: "rejected",
      admin_notes: cleanString(note) || values.admin_notes || null,
    })
    .eq("id", submissionId);

  if (error) {
    $("#curatorStatus").textContent = error.message;
    return;
  }

  $("#curatorStatus").textContent = "Submission rejected.";
  await loadCuratorDashboard();
}

async function toggleCuratorImage(imageId, currentlyApproved) {
  const client = getSupabaseClient();
  const { error } = await client
    .from("images")
    .update({ approved: !currentlyApproved })
    .eq("id", imageId);

  if (error) {
    $("#curatorStatus").textContent = error.message;
    return;
  }

  $("#curatorStatus").textContent = currentlyApproved ? "Image unpublished." : "Image published.";
  await loadCuratorDashboard();
}

async function deleteCuratorImage(imageId) {
  if (!window.confirm("Delete this approved image? This cannot be undone.")) {
    return;
  }

  const client = getSupabaseClient();
  const { error } = await client.from("images").delete().eq("id", imageId);

  if (error) {
    $("#curatorStatus").textContent = error.message;
    return;
  }

  $("#curatorStatus").textContent = "Image deleted.";
  await loadCuratorDashboard();
}

function readCuratorFormValues(submissionId) {
  const form = $(`[data-curator-form="${cssEscape(submissionId)}"]`);
  if (!form) {
    return {
      title: "",
      image_url: "",
      location_name: "",
      lat: Number.NaN,
      lng: Number.NaN,
      year: Number.NaN,
      year_range: "",
      case_note: "",
      historical_record: "",
      source: "",
      rights: "",
      difficulty: "",
      tags: [],
      admin_notes: "",
    };
  }

  const values = {};
  $$("[data-field]", form).forEach((field) => {
    values[field.dataset.field] = cleanString(field.value);
  });

  return {
    title: values.title,
    image_url: values.image_url,
    location_name: values.location_name,
    lat: Number(values.lat),
    lng: Number(values.lng),
    year: Number(values.year),
    year_range: values.year_range,
    case_note: values.case_note,
    historical_record: values.historical_record,
    source: values.source,
    rights: values.rights,
    difficulty: values.difficulty,
    tags: splitTags(values.tags),
    admin_notes: values.admin_notes,
  };
}

function mapCuratorValuesToSubmissionUpdate(values) {
  return {
    title: values.title,
    image_url: values.image_url,
    location_name: values.location_name || null,
    lat: Number.isFinite(values.lat) ? values.lat : null,
    lng: Number.isFinite(values.lng) ? values.lng : null,
    year: Number.isFinite(values.year) ? values.year : null,
    year_range: values.year_range || null,
    case_note: values.case_note || null,
    historical_record: values.historical_record || null,
    source: values.source || null,
    rights: values.rights || null,
    difficulty: values.difficulty || null,
    tags: values.tags,
    admin_notes: values.admin_notes || null,
  };
}

function mapCuratorValuesToImageRow(values) {
  return {
    title: values.title,
    image_url: values.image_url,
    location_name: values.location_name,
    lat: values.lat,
    lng: values.lng,
    year: values.year,
    year_range: values.year_range || null,
    case_note: values.case_note || null,
    historical_record: values.historical_record || null,
    source: values.source || null,
    rights: values.rights || null,
    difficulty: values.difficulty || null,
    tags: values.tags,
    approved: true,
  };
}

function validateCuratorImageValues(values) {
  if (!values.title) return "Title is required before publishing.";
  if (!values.image_url) return "Image URL is required before publishing.";
  if (!values.location_name) return "Location name is required before publishing.";
  if (!Number.isFinite(values.lat)) return "Latitude is required before publishing.";
  if (!Number.isFinite(values.lng)) return "Longitude is required before publishing.";
  if (!Number.isFinite(values.year)) return "Year is required before publishing.";
  return "";
}

function splitTags(value) {
  return cleanString(value)
    .split(",")
    .map(cleanString)
    .filter(Boolean);
}

function renderAllAdmin() {
  renderOwnerSettings();
  renderPublishingExports();
  renderAdminSubmissions();
  renderApprovedLibrary();
  renderQuestionSetList();
  renderImagePicker(getCurrentPickerSelection());
}

function renderOwnerSettings() {
  const settings = readOwnerSettings();
  const sets = readQuestionSets();
  const activeSetExists = settings.activeSetId === "all" || sets.some((set) => set.id === settings.activeSetId);
  const activeSetId = activeSetExists ? settings.activeSetId : "all";
  const homeGallery = resolveHomeGallery(settings);
  const homeImages = homeGallery.map((entry) => entry.image);

  $("#roundsPerGame").value = getConfiguredRoundCount({ ...settings, activeSetId });
  $("#homeImageSettingOne").value = homeImages[0];
  $("#homeImageSettingTwo").value = homeImages[1];
  $("#homeImageSettingThree").value = homeImages[2];
  $("#homePlaceSettingOne").value = homeGallery[0].place;
  $("#homePlaceSettingTwo").value = homeGallery[1].place;
  $("#homePlaceSettingThree").value = homeGallery[2].place;
  $("#homeTimeSettingOne").value = homeGallery[0].time;
  $("#homeTimeSettingTwo").value = homeGallery[1].time;
  $("#homeTimeSettingThree").value = homeGallery[2].time;
  $("#includeApprovedLocal").checked = Boolean(settings.includeApprovedLocal);
  $("#randomizeRounds").checked = settings.randomizeRounds !== false;
  $("#activeQuestionSet").innerHTML = [
    `<option value="all">All published images</option>`,
    ...sets.map((set) => `<option value="${escapeAttribute(set.id)}">${escapeHtml(set.title)} (${set.imageIds.length})</option>`),
  ].join("");
  $("#activeQuestionSet").value = activeSetId;

  const activeSet = getActiveQuestionSet(activeSetId);
  const images = getImagesForQuestionSet(activeSet.id);
  $("#ownerSettingsStatus").textContent = `${images.length} playable image${images.length === 1 ? "" : "s"} available in the active set.`;
}

function renderPublishingExports() {
  const settings = readOwnerSettings();
  const activeSet = getActiveQuestionSet(settings.activeSetId);
  const images = getImagesForQuestionSet(activeSet.id);
  const publicSettings = {
    roundsPerGame: getConfiguredRoundCount(settings),
    activeSetId: "all",
    randomizeRounds: settings.randomizeRounds !== false,
    homeGallery: resolveHomeGallery(settings),
  };

  $("#siteSettingsExport").value = JSON.stringify(publicSettings, null, 2);
  $("#publishedImagesExport").value = JSON.stringify(images, null, 2);
}

function buildHomeGalleryEntry(index, suffix) {
  const fallback = DEFAULT_HOME_GALLERY[index];
  return {
    image: cleanString($(`#homeImageSetting${suffix}`).value) || fallback.image,
    place: cleanString($(`#homePlaceSetting${suffix}`).value) || fallback.place,
    time: cleanString($(`#homeTimeSetting${suffix}`).value) || fallback.time,
  };
}

function renderAdminSubmissions() {
  const pending = readPendingSubmissions();
  const container = $("#adminSubmissions");
  const status = $("#adminStatus");
  if (!container || !status) {
    return;
  }
  status.textContent = `${pending.length} pending submission${pending.length === 1 ? "" : "s"} found in this browser.`;

  if (pending.length === 0) {
    container.innerHTML = `
      <section class="submission-card">
        <div></div>
        <div>
          <h3>No pending submissions</h3>
          <p>Use the public Submit a Photograph page to generate a local review entry.</p>
        </div>
      </section>
    `;
    return;
  }

  container.innerHTML = pending
    .map((entry, index) => renderSubmissionCard(entry, index, "pending"))
    .join("");
}

function renderApprovedLibrary() {
  const approved = readApprovedImages();
  const container = $("#approvedLibrary");
  const status = $("#approvedStatus");
  if (!container || !status) {
    return;
  }
  status.textContent = `${approved.length} locally approved image${approved.length === 1 ? "" : "s"} stored in this browser.`;

  if (approved.length === 0) {
    container.innerHTML = `
      <section class="submission-card compact-card">
        <div></div>
        <div>
          <h3>No approved local images</h3>
          <p>Approve a pending submission to add it to this owner-only library.</p>
        </div>
      </section>
    `;
    return;
  }

  container.innerHTML = approved
    .map((entry) => renderApprovedCard(entry))
    .join("");
}

function renderSubmissionCard(entry, index) {
  const json = escapeHtml(JSON.stringify(normalizeImageEntry(entry), null, 2));
  return `
    <article class="submission-card" data-pending-card="${index}">
      <img src="${escapeAttribute(safeImageUrl(entry.image))}" alt="${escapeAttribute(entry.title || "Submitted image")}" />
      <div>
        <h3>${escapeHtml(entry.title || "Untitled submission")}</h3>
        ${renderEditableEntryFields(entry)}
        <textarea readonly rows="10">${json}</textarea>
        <div class="button-row">
          <button class="secondary-button" type="button" data-action="save-pending-edits" data-entry-index="${index}">Save Edits</button>
          <button class="primary-button" type="button" data-action="approve-pending" data-entry-index="${index}">Approve + Add To Active Set</button>
          <button class="secondary-button" type="button" data-action="copy-pending" data-entry-index="${index}">Copy JSON</button>
          <button class="danger-button" type="button" data-action="reject-pending" data-entry-index="${index}">Reject</button>
        </div>
      </div>
    </article>
  `;
}

function renderEditableEntryFields(entry) {
  const normalized = normalizeImageEntry(entry);
  return `
    <div class="owner-edit-grid">
      <label>ID<input data-edit-field="id" value="${escapeAttribute(normalized.id)}" /></label>
      <label>Title<input data-edit-field="title" value="${escapeAttribute(normalized.title)}" /></label>
      <label class="full-span">Image URL/path<input data-edit-field="image" value="${escapeAttribute(normalized.image)}" /></label>
      <label>Location name<input data-edit-field="locationName" value="${escapeAttribute(normalized.locationName)}" /></label>
      <label>Year<input data-edit-field="year" type="number" min="-3000" max="2000" step="1" value="${escapeAttribute(String(normalized.year))}" /></label>
      <label>Latitude<input data-edit-field="lat" type="number" step="0.00001" value="${escapeAttribute(String(normalized.lat))}" /></label>
      <label>Longitude<input data-edit-field="lng" type="number" step="0.00001" value="${escapeAttribute(String(normalized.lng))}" /></label>
      <label>Year label<input data-edit-field="yearRange" value="${escapeAttribute(normalized.yearRange)}" /></label>
      <label>Difficulty<input data-edit-field="difficulty" value="${escapeAttribute(normalized.difficulty)}" /></label>
      <label class="full-span">Case Note<textarea data-edit-field="clue" rows="2">${escapeHtml(normalized.clue)}</textarea></label>
      <label class="full-span">Historical Record<textarea data-edit-field="explanation" rows="3">${escapeHtml(normalized.explanation)}</textarea></label>
      <label class="full-span">Source/archive link<input data-edit-field="source" value="${escapeAttribute(normalized.source)}" /></label>
      <label class="full-span">Rights note<input data-edit-field="rights" value="${escapeAttribute(normalized.rights)}" /></label>
      <label>Tags<input data-edit-field="tags" value="${escapeAttribute(normalized.tags.join(", "))}" /></label>
      <label>Submitter<input data-edit-field="submitter" value="${escapeAttribute(normalized.submitter)}" /></label>
    </div>
  `;
}

function renderApprovedCard(entry) {
  const json = escapeHtml(JSON.stringify(entry, null, 2));
  return `
    <article class="submission-card compact-card">
      <img src="${escapeAttribute(safeImageUrl(entry.image))}" alt="${escapeAttribute(entry.title || "Approved image")}" />
      <div>
        <h3>${escapeHtml(entry.title || "Untitled approved image")}</h3>
        ${renderEntryFields(entry)}
        <textarea readonly rows="8">${json}</textarea>
        <div class="button-row">
          <button class="secondary-button" type="button" data-action="add-approved-to-set" data-image-id="${escapeAttribute(entry.id)}">Add To Active Set</button>
          <button class="secondary-button" type="button" data-action="copy-approved" data-image-id="${escapeAttribute(entry.id)}">Copy JSON</button>
          <button class="danger-button" type="button" data-action="remove-approved" data-image-id="${escapeAttribute(entry.id)}">Remove Local</button>
        </div>
      </div>
    </article>
  `;
}

function renderEntryFields(entry) {
  return `
    <div class="submission-fields">
      <div><span>Location</span><strong>${escapeHtml(entry.locationName || "Not provided")}</strong></div>
      <div><span>Coordinates</span><strong>${formatCoordinate(entry.lat)}, ${formatCoordinate(entry.lng)}</strong></div>
      <div><span>Year</span><strong>${escapeHtml(String(entry.year || "Not provided"))}</strong></div>
      <div><span>Submitter</span><strong>${escapeHtml(entry.submitter || "Not provided")}</strong></div>
      <div class="full-span"><span>Case Note</span><strong>${escapeHtml(entry.clue || "Not provided")}</strong></div>
      <div class="full-span"><span>Historical Record</span><strong>${escapeHtml(entry.explanation || "Not provided")}</strong></div>
      <div class="full-span"><span>Source</span><strong>${escapeHtml(entry.source || "Not provided")}</strong></div>
      <div class="full-span"><span>Rights</span><strong>${escapeHtml(entry.rights || "Not provided")}</strong></div>
    </div>
  `;
}

async function copyPendingSubmission(index) {
  const pending = readPendingSubmissions();
  if (!pending[index]) {
    return;
  }

  const entry = readPendingCardEntry(index) || normalizeImageEntry(pending[index]);
  await copyText(JSON.stringify(entry, null, 2));
  $("#adminStatus").textContent = `Copied JSON for ${entry.title || "submission"}.`;
}

function savePendingEdits(index) {
  const pending = readPendingSubmissions();
  if (!pending[index]) {
    return;
  }

  const edited = readPendingCardEntry(index);
  if (!edited) {
    return;
  }

  pending[index] = {
    ...pending[index],
    ...edited,
    submittedAt: pending[index].submittedAt || edited.submittedAt,
  };

  writePendingSubmissions(pending);
  renderAllAdmin();
  $("#adminStatus").textContent = `Saved edits for "${edited.title}".`;
}

function approvePendingSubmission(index) {
  const pending = readPendingSubmissions();
  if (!pending[index]) {
    return;
  }

  const edited = readPendingCardEntry(index);
  const [storedEntry] = pending.splice(index, 1);
  const entry = edited || storedEntry;
  const approved = normalizeImageEntry({
    ...entry,
    difficulty: entry.difficulty === "unreviewed" ? "medium" : entry.difficulty,
    approvedAt: new Date().toISOString(),
  });

  writePendingSubmissions(pending);
  writeApprovedImages(upsertImage(readApprovedImages(), approved));
  addImageIdToActiveSet(approved.id);
  renderAllAdmin();
  $("#adminStatus").textContent = `Approved "${approved.title}" and added it to the active question set.`;
}

function readPendingCardEntry(index) {
  const card = $(`[data-pending-card="${index}"]`);
  if (!card) {
    return null;
  }

  const values = {};
  $$("[data-edit-field]", card).forEach((field) => {
    values[field.dataset.editField] = cleanString(field.value);
  });

  const year = Number(values.year);
  return normalizeImageEntry({
    id: values.id,
    title: values.title,
    image: values.image,
    locationName: values.locationName,
    lat: Number(values.lat),
    lng: Number(values.lng),
    year,
    yearRange: values.yearRange || `c. ${year}`,
    clue: values.clue,
    explanation: values.explanation,
    source: values.source,
    rights: values.rights,
    difficulty: values.difficulty || "medium",
    tags: values.tags ? values.tags.split(",").map(cleanString).filter(Boolean) : [],
    submitter: values.submitter,
  });
}

function rejectPendingSubmission(index) {
  const pending = readPendingSubmissions();
  if (!pending[index]) {
    return;
  }

  const [entry] = pending.splice(index, 1);
  const rejected = {
    ...entry,
    rejectedAt: new Date().toISOString(),
  };

  writePendingSubmissions(pending);
  writeRejectedSubmissions([...readRejectedSubmissions(), rejected]);
  renderAllAdmin();
  $("#adminStatus").textContent = `Rejected "${entry.title || "submission"}".`;
}

async function copyApprovedImage(imageId) {
  const image = readApprovedImages().find((entry) => entry.id === imageId);
  if (!image) {
    return;
  }

  await copyText(JSON.stringify(image, null, 2));
  $("#approvedStatus").textContent = `Copied JSON for ${image.title}.`;
}

function removeApprovedImage(imageId) {
  const approved = readApprovedImages().filter((entry) => entry.id !== imageId);
  const sets = readQuestionSets().map((set) => ({
    ...set,
    imageIds: set.imageIds.filter((id) => id !== imageId),
    updatedAt: new Date().toISOString(),
  }));

  writeApprovedImages(approved);
  writeQuestionSets(sets);
  renderAllAdmin();
  $("#approvedStatus").textContent = "Removed local approved image and removed it from local question sets.";
}

function renderQuestionSetList() {
  const sets = readQuestionSets();
  const activeSetId = readOwnerSettings().activeSetId;
  const container = $("#questionSetList");

  if (sets.length === 0) {
    container.innerHTML = `
      <section class="question-set-card">
        <h3>No custom question sets</h3>
        <p>Create a set by choosing images below, then save it. The default game still uses all published images.</p>
      </section>
    `;
    return;
  }

  container.innerHTML = sets
    .map((set) => {
      const activeLabel = set.id === activeSetId ? `<span class="status-pill">Active</span>` : "";
      return `
        <article class="question-set-card">
          <div>
            <h3>${escapeHtml(set.title)} ${activeLabel}</h3>
            <p>${escapeHtml(set.description || "No description.")}</p>
            <p class="source-line">${set.imageIds.length} question${set.imageIds.length === 1 ? "" : "s"} | ID: ${escapeHtml(set.id)}</p>
          </div>
          <div class="button-row">
            <button class="primary-button" type="button" data-action="activate-set" data-set-id="${escapeAttribute(set.id)}">Use Set</button>
            <button class="secondary-button" type="button" data-action="edit-set" data-set-id="${escapeAttribute(set.id)}">Edit</button>
            <button class="secondary-button" type="button" data-action="copy-set" data-set-id="${escapeAttribute(set.id)}">Copy JSON</button>
            <button class="danger-button" type="button" data-action="delete-set" data-set-id="${escapeAttribute(set.id)}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderImagePicker(selectedIds = []) {
  const selected = new Set(selectedIds);
  const images = mergeImageLists(adminState.staticImages, readApprovedImages());
  const picker = $("#imagePicker");

  if (!picker) {
    return;
  }

  if (images.length === 0) {
    picker.innerHTML = `<p>No images available. Check data/images.json or approve a pending submission.</p>`;
    updateImagePickerCount();
    return;
  }

  picker.innerHTML = images
    .map((image) => {
      const checked = selected.has(image.id) ? "checked" : "";
      const disabled = selected.has(image.id) ? "" : "disabled";
      const localLabel = readApprovedImages().some((entry) => entry.id === image.id) ? "Local approved" : "Published";
      return `
        <div class="image-choice">
          <label>
            <input type="checkbox" value="${escapeAttribute(image.id)}" ${checked} />
            <img src="${escapeAttribute(safeImageUrl(image.image))}" alt="${escapeAttribute(image.title)}" />
            <span>
              <strong>${escapeHtml(image.title)}</strong>
              <small>${escapeHtml(image.locationName)} | ${escapeHtml(image.yearRange || String(image.year))} | ${localLabel}</small>
            </span>
          </label>
          <button class="danger-button compact-button" type="button" data-action="remove-from-picker" data-image-id="${escapeAttribute(image.id)}" ${disabled}>
            Delete From Set
          </button>
        </div>
      `;
    })
    .join("");

  updateImagePickerCount();
}

function updateImagePickerCount() {
  const count = getCurrentPickerSelection().length;
  const label = $("#imagePickerCount");
  if (label) {
    label.textContent = `${count} selected`;
  }

  $$("#imagePicker .image-choice").forEach((choice) => {
    const checkbox = $("input[type='checkbox']", choice);
    const button = $("button[data-action='remove-from-picker']", choice);
    if (checkbox && button) {
      button.disabled = !checkbox.checked;
    }
  });
}

function getCurrentPickerSelection() {
  return $$("#imagePicker input[type='checkbox']:checked").map((input) => input.value);
}

function saveQuestionSetFromForm() {
  const title = cleanString($("#questionSetTitle").value);
  const id = slugify($("#questionSetId").value || title);
  const description = cleanString($("#questionSetDescription").value);
  const imageIds = getCurrentPickerSelection();

  if (!title || !id) {
    $("#questionSetStatus").textContent = "Add a set title and ID first.";
    return;
  }

  if (imageIds.length === 0) {
    $("#questionSetStatus").textContent = "Choose at least one question for the set.";
    return;
  }

  const now = new Date().toISOString();
  const sets = readQuestionSets();
  const existing = sets.find((set) => set.id === id);
  const nextSet = {
    id,
    title,
    description,
    imageIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const nextSets = existing
    ? sets.map((set) => (set.id === id ? nextSet : set))
    : [...sets, nextSet];

  writeQuestionSets(nextSets);
  writeOwnerSettings({ ...readOwnerSettings(), activeSetId: id });
  $("#editingSetId").value = id;
  renderAllAdmin();
  loadQuestionSetIntoForm(id);
  $("#questionSetStatus").textContent = `Saved and activated "${title}".`;
}

function clearQuestionSetForm() {
  $("#editingSetId").value = "";
  $("#questionSetTitle").value = "";
  $("#questionSetId").value = "";
  $("#questionSetDescription").value = "";
}

function loadQuestionSetIntoForm(setId) {
  const set = readQuestionSets().find((entry) => entry.id === setId);
  if (!set) {
    return;
  }

  $("#editingSetId").value = set.id;
  $("#questionSetTitle").value = set.title;
  $("#questionSetId").value = set.id;
  $("#questionSetDescription").value = set.description || "";
  renderImagePicker(set.imageIds);
  $("#questionSetStatus").textContent = `Editing "${set.title}".`;
}

async function copyQuestionSetJson(setId) {
  const set = getActiveQuestionSet(setId);
  await copyText(JSON.stringify(set, null, 2));
  $("#questionSetStatus").textContent = `Copied JSON for "${set.title}".`;
}

function deleteQuestionSet(setId) {
  const sets = readQuestionSets().filter((set) => set.id !== setId);
  const settings = readOwnerSettings();
  const nextSettings = settings.activeSetId === setId ? { ...settings, activeSetId: "all" } : settings;

  writeQuestionSets(sets);
  writeOwnerSettings(nextSettings);
  clearQuestionSetForm();
  renderAllAdmin();
  $("#questionSetStatus").textContent = "Question set deleted.";
}

function addImageIdToActiveSet(imageId) {
  const settings = readOwnerSettings();
  let sets = readQuestionSets();
  let activeSetId = settings.activeSetId;
  let activeSet = sets.find((set) => set.id === activeSetId);

  if (!activeSet || activeSetId === "all") {
    activeSetId = OWNER_APPROVED_SET_ID;
    activeSet = sets.find((set) => set.id === activeSetId);
  }

  if (!activeSet) {
    activeSet = {
      id: OWNER_APPROVED_SET_ID,
      title: "Owner Approved Records",
      description: "Locally approved submissions ready for owner review and testing.",
      imageIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sets = [...sets, activeSet];
  }

  if (!activeSet.imageIds.includes(imageId)) {
    activeSet.imageIds.push(imageId);
    activeSet.updatedAt = new Date().toISOString();
  }

  writeQuestionSets(sets.map((set) => (set.id === activeSet.id ? activeSet : set)));
  writeOwnerSettings({
    ...settings,
    activeSetId,
    includeApprovedLocal: true,
  });
}

function getImagesForQuestionSet(setId) {
  const allImages = mergeImageLists(adminState.staticImages.length ? adminState.staticImages : state.staticImages, readApprovedImages());

  if (setId === "all") {
    return allImages;
  }

  const set = getActiveQuestionSet(setId);
  const allowed = new Set(set.imageIds || []);
  return allImages.filter((image) => allowed.has(image.id));
}

function getActiveQuestionSet(setId) {
  if (!setId || setId === "all") {
    const staticIds = (adminState.staticImages.length ? adminState.staticImages : state.staticImages).map((image) => image.id);
    return {
      id: "all",
      title: "All published images",
      description: "Every verified image currently listed in data/images.json.",
      imageIds: staticIds,
    };
  }

  return (
    readQuestionSets().find((set) => set.id === setId) || {
      id: "all",
      title: "All published images",
      description: "Every verified image currently listed in data/images.json.",
      imageIds: [],
    }
  );
}

function readOwnerSettings() {
  const stored = readJsonStorage(OWNER_SETTINGS_STORAGE_KEY, {});
  return normalizeOwnerSettings({
    ...DEFAULT_OWNER_SETTINGS,
    ...state.publicSettings,
    ...stored,
  });
}

function writeOwnerSettings(settings) {
  writeJsonStorage(OWNER_SETTINGS_STORAGE_KEY, normalizeOwnerSettings(settings));
}

function normalizeOwnerSettings(settings = {}) {
  const merged = {
    ...DEFAULT_OWNER_SETTINGS,
    ...settings,
  };
  const homeGallery = resolveHomeGallery(merged);
  const homeImages = homeGallery.map((entry) => entry.image);

  return {
    ...merged,
    activeSetId: cleanString(merged.activeSetId) || "all",
    includeApprovedLocal: Boolean(merged.includeApprovedLocal),
    randomizeRounds: merged.randomizeRounds !== false,
    homeGallery,
    homeImages,
    homeImage: homeImages[0],
    roundsPerGame: getConfiguredRoundCount(merged),
  };
}

function resolveHomeGallery(settings = {}) {
  const configured = Array.isArray(settings.homeGallery) ? settings.homeGallery : [];
  const images = resolveHomeImages(settings);

  return DEFAULT_HOME_GALLERY.map((fallback, index) => {
    const entry = configured[index] || {};
    return {
      image: cleanString(entry.image) || images[index] || fallback.image,
      place: cleanString(entry.place) || fallback.place,
      time: cleanString(entry.time) || fallback.time,
    };
  });
}

function resolveHomeImages(settings = {}) {
  const configured = Array.isArray(settings.homeImages) ? settings.homeImages : [];
  const gallery = Array.isArray(settings.homeGallery) ? settings.homeGallery : [];
  const galleryImages = gallery.map((entry) => cleanString(entry?.image));
  const legacyFirst = cleanString(settings.homeImage);
  const configuredClean = configured.map(cleanString);
  const isLegacyDefault =
    configuredClean.length === LEGACY_HOME_IMAGES.length &&
    LEGACY_HOME_IMAGES.every((value, index) => configuredClean[index] === value);
  if (isLegacyDefault) {
    return [...DEFAULT_HOME_IMAGES];
  }

  return DEFAULT_HOME_IMAGES.map((fallback, index) => {
    if (galleryImages[index]) {
      return galleryImages[index];
    }
    if (cleanString(configured[index])) {
      return cleanString(configured[index]);
    }
    if (index === 0 && legacyFirst) {
      return legacyFirst;
    }
    return fallback;
  });
}

function getConfiguredRoundCount(settings = readOwnerSettings()) {
  return clampNumber(Number(settings.roundsPerGame), MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUND_COUNT);
}

function readPendingSubmissions() {
  return readJsonStorage(PENDING_STORAGE_KEY, []);
}

function writePendingSubmissions(entries) {
  writeJsonStorage(PENDING_STORAGE_KEY, entries);
}

function readApprovedImages() {
  return readJsonStorage(APPROVED_STORAGE_KEY, []).filter(isPlayableImage).map(normalizeImageEntry);
}

function writeApprovedImages(entries) {
  writeJsonStorage(APPROVED_STORAGE_KEY, entries.filter(isPlayableImage).map(normalizeImageEntry));
}

function readRejectedSubmissions() {
  return readJsonStorage(REJECTED_STORAGE_KEY, []);
}

function writeRejectedSubmissions(entries) {
  writeJsonStorage(REJECTED_STORAGE_KEY, entries);
}

function readQuestionSets() {
  return readJsonStorage(QUESTION_SETS_STORAGE_KEY, [])
    .filter((set) => set && set.id && set.title && Array.isArray(set.imageIds))
    .map((set) => ({
      id: cleanString(set.id),
      title: cleanString(set.title),
      description: cleanString(set.description),
      imageIds: set.imageIds.map(cleanString).filter(Boolean),
      createdAt: cleanString(set.createdAt),
      updatedAt: cleanString(set.updatedAt),
    }));
}

function writeQuestionSets(sets) {
  const uniqueSets = [];
  sets.forEach((set) => {
    if (!set.id || uniqueSets.some((entry) => entry.id === set.id)) {
      return;
    }
    uniqueSets.push({
      ...set,
      imageIds: Array.from(new Set(set.imageIds || [])),
    });
  });
  writeJsonStorage(QUESTION_SETS_STORAGE_KEY, uniqueSets);
}

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getCurrentRound() {
  return state.rounds[state.currentRoundIndex];
}

function getTotalScore() {
  return state.results.reduce((sum, result) => sum + result.roundScore, 0);
}

function clearMapLayers() {
  [state.guessMarker, state.correctMarker, state.answerLine].forEach((layer) => {
    if (layer && state.map) {
      state.map.removeLayer(layer);
    }
  });

  state.guessMarker = null;
  state.correctMarker = null;
  state.answerLine = null;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function ratingForScore(score, maxScore) {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.88) return "Master of the Archive";
  if (ratio >= 0.72) return "Excellent Chronoscopist";
  if (ratio >= 0.52) return "Promising Detective";
  if (ratio >= 0.32) return "Curious Traveller";
  return "Lost in the Archives";
}

function seededShuffle(items, seedKey) {
  const random = mulberry32(hashString(seedKey));
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function getDailySeedKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mergeImageLists(primary, secondary) {
  const merged = [...primary];
  secondary.forEach((image) => {
    const normalized = normalizeImageEntry(image);
    const index = merged.findIndex((entry) => entry.id === normalized.id);
    if (index >= 0) {
      merged[index] = normalized;
    } else {
      merged.push(normalized);
    }
  });
  return merged;
}

function upsertImage(images, image) {
  const normalized = normalizeImageEntry(image);
  const existingIndex = images.findIndex((entry) => entry.id === normalized.id);
  if (existingIndex >= 0) {
    return images.map((entry, index) => (index === existingIndex ? normalized : entry));
  }
  return [...images, normalized];
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatNumber(value) {
  return Math.round(Number(value)).toLocaleString("en-US");
}

function formatYearLabel(year) {
  const numericYear = Number(year);
  if (!Number.isFinite(numericYear)) {
    return "Unknown";
  }
  if (numericYear < 0) {
    return `${formatNumber(Math.abs(numericYear))} BCE`;
  }
  return `${formatNumber(numericYear || 1)} CE`;
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return "unknown";
  }
  if (distance < 1) {
    return `${Math.round(distance * 1000)} m`;
  }
  return `${formatNumber(distance)} km`;
}

function formatCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate.toFixed(3) : "n/a";
}

function cleanString(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function safeImageUrl(value) {
  const url = cleanString(value);
  if (/^(https?:|data:image\/|assets\/)/i.test(url)) {
    return url;
  }
  return "assets/images/beijing_church_001.svg";
}

function escapeHtml(value) {
  return cleanString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/"/g, '\\"');
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
