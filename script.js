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
const SITE_SETTINGS_RECORD_KEY = "public";
const GA_MEASUREMENT_ID = "G-4NTPNH9KXJ";
const OFFICIAL_SITE_URL = "https://chronoscope.world/";

// Supabase frontend config. Paste only the project URL and anon/publishable key.
// Leave these blank to keep using the JSON fallback only.
const SUPABASE_URL = "https://ryofasvrzvdhgaaerhqb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XjqOxlNCTFKO_kGnRHmdPQ_2q8pyxbq";

const PENDING_STORAGE_KEY = "historyImageDetective.pendingSubmissions.v1";
const APPROVED_STORAGE_KEY = "historyImageDetective.approvedImages.v1";
const REJECTED_STORAGE_KEY = "historyImageDetective.rejectedSubmissions.v1";
const QUESTION_SETS_STORAGE_KEY = "historyImageDetective.questionSets.v1";
const OWNER_SETTINGS_STORAGE_KEY = "historyImageDetective.ownerSettings.v1";
const PLAYER_RECORD_STORAGE_KEY = "chronoscope.playerRecord.v1";

const DEFAULT_ROUND_COUNT = 5;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 20;
const MAX_LOCATION_SCORE = 2500;
const MAX_TIME_SCORE = 2500;
const MAX_ROUND_SCORE = MAX_LOCATION_SCORE + MAX_TIME_SCORE;
const YEAR_MIN = -3000;
const YEAR_MAX = 2100;
const TIMELINE_BREAK_YEAR = -1000;
const TIMELINE_BREAK_RATIO = 0.25;
const DEFAULT_YEAR = 1900;
const EMPTY_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%23e7d6b8'/%3E%3C/svg%3E";
const DEFAULT_HERO_BACKGROUND = "assets/chronoscope-archive-room.jpg";
const ENGLISH_MAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const LOCAL_MAP_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ENGLISH_MAP_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; <a href="https://goto.arcgisonline.com/maps/World_Street_Map">sources &amp; terms</a>';
const LOCAL_MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_HOME_IMAGES = [
  "",
  "",
  "",
];
const LEGACY_HOME_IMAGES = [];
const DEFAULT_HOME_IMAGE = DEFAULT_HOME_IMAGES[0];
const DEFAULT_HOME_GALLERY = [
  {
    image: DEFAULT_HOME_IMAGES[0],
    place: "Awaiting image",
    time: "Curator selection",
  },
  {
    image: DEFAULT_HOME_IMAGES[1],
    place: "Awaiting image",
    time: "Curator selection",
  },
  {
    image: DEFAULT_HOME_IMAGES[2],
    place: "Awaiting image",
    time: "Curator selection",
  },
];

const DEFAULT_OWNER_SETTINGS = {
  roundsPerGame: DEFAULT_ROUND_COUNT,
  activeSetId: "all",
  activeSetName: "All published cases",
  includeApprovedLocal: false,
  randomizeRounds: true,
  heroBackground: DEFAULT_HERO_BACKGROUND,
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
  imageLoadToken: 0,
  submissionMap: null,
  submissionMarker: null,
  pendingSubmissionLatLng: null,
  confirmedSubmissionLatLng: null,
  publicSettings: DEFAULT_OWNER_SETTINGS,
  publicQuestionSets: [],
  dailyChallenges: [],
  activeChallenge: null,
  resultRecorded: false,
  supabaseClient: null,
  dataSource: "json",
  isSubmitting: false,
  activeView: "home",
  guessMode: "where",
  initialRouteApplied: false,
  currentRecord: null,
  recordReturnView: "archive",
  recordReturnUrl: "",
  recordMap: null,
  recordMarker: null,
};

const adminState = {
  staticImages: [],
  images: [],
  questionSets: [],
  dailyChallenges: [],
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

function trackAnalyticsEvent(eventName, parameters = {}) {
  if (typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", eventName, {
    send_to: GA_MEASUREMENT_ID,
    ...parameters,
  });
}

function trackVirtualPageView(viewName) {
  if (typeof window.gtag !== "function") {
    return;
  }

  const pagePath = `${window.location.pathname}${viewName === "home" ? "" : `#${viewName}`}`;
  window.gtag("event", "page_view", {
    page_title: getAnalyticsPageTitle(viewName),
    page_location: `${window.location.origin}${pagePath}`,
    page_path: pagePath,
    send_to: GA_MEASUREMENT_ID,
  });
}

function getAnalyticsPageTitle(viewName) {
  const labels = {
    home: "Chronoscope",
    game: "Chronoscope - Game",
    archive: "Chronoscope - Archive",
    record: "Chronoscope - Archive Record",
    submit: "Chronoscope - Submit",
    about: "Chronoscope - About",
    methodology: "Chronoscope - Editorial Standards",
    results: "Chronoscope - Results",
  };
  return labels[viewName] || "Chronoscope";
}

async function initMainPage() {
  bindNavigation();
  setStartControlsReady(false);
  bindGameControls();
  bindSubmissionLocationControls();
  bindSubmissionForm();
  bindCopyButtons();
  bindArchiveControls();
  showSubmissionConnectionStatus();

  applyHashRoute();
  window.addEventListener("hashchange", applyHashRoute);

  await loadSiteSettings();
  await loadPublicQuestionSets();
  await loadPublicDailyChallenges();
  await loadImageData();
  applyHomeGallery();
  renderPublicArchive();
  setStartControlsReady(state.images.length > 0);
  applyInitialChallengeRoute();
}

function setStartControlsReady(isReady) {
  $$('[data-action="start-game"]').forEach((control) => {
    control.disabled = !isReady;
    control.setAttribute("aria-busy", String(!isReady));
  });
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

  $$("[data-action='start-practice']").forEach((control) => {
    control.addEventListener("click", () => startPracticeGame());
  });

  $$("[data-action='replay-challenge']").forEach((control) => {
    control.addEventListener("click", replayActiveChallenge);
  });

  $("#dailyArchiveList")?.addEventListener("click", handlePublicArchiveAction);
  $("#archiveCollectionList")?.addEventListener("click", handlePublicArchiveAction);
  $("#clearPlayerRecord")?.addEventListener("click", clearPlayerRecord);
}

function showView(viewName) {
  $$("[data-view]").forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.view === viewName);
  });

  const previousView = state.activeView;
  state.activeView = viewName;
  document.body.classList.remove(
    "view-home",
    "view-game",
    "view-results",
    "view-submit",
    "view-about",
    "view-archive",
    "view-record",
    "view-methodology"
  );
  document.body.classList.add(`view-${viewName}`);

  if (viewName === "game" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 80);
  }

  if (viewName === "submit") {
    setTimeout(() => initSubmissionMap(), 80);
  }

  if (viewName === "record" && state.recordMap) {
    setTimeout(() => state.recordMap.invalidateSize(), 80);
  }

  if (previousView !== viewName) {
    trackVirtualPageView(viewName);
  }

  if (viewName === "about") {
    trackAnalyticsEvent("open_about_page");
  }

  if (viewName === "methodology") {
    trackAnalyticsEvent("open_methodology");
  }

  window.scrollTo({ top: 0, behavior: "auto" });
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  window.setTimeout(() => window.scrollTo({ top: 0, behavior: "auto" }), 120);
}

function applyHomeGallery() {
  const settings = readPublicGameSettings();
  const gallery = resolveHomeGallery(settings);
  const heroBackground = $("#heroBackgroundImage");
  if (heroBackground) {
    heroBackground.src = safeImageUrl(settings.heroBackground || DEFAULT_HERO_BACKGROUND);
  }
  [
    ["#homeImageOne"],
    ["#homeImageTwo"],
    ["#homeImageThree"],
  ].forEach((selectors, index) => {
    selectors.forEach((selector) => setHomeImageSlot(selector, gallery[index]?.image));
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

function setHomeImageSlot(selector, value) {
  const image = $(selector);
  if (!image) {
    return;
  }

  const figure = image.closest(".archive-teaser");
  const url = cleanString(value);
  if (!url) {
    image.removeAttribute("src");
    image.hidden = true;
    figure?.classList.add("is-empty");
    return;
  }

  image.hidden = false;
  image.src = safeImageUrl(url);
  figure?.classList.remove("is-empty");
}

function applyHashRoute() {
  const viewName = location.hash.replace("#", "");
  if (["home", "archive", "submit", "about", "methodology"].includes(viewName)) {
    showView(viewName);
  }
}

async function fetchJsonImageData() {
  const response = await fetch(IMAGE_DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${IMAGE_DATA_URL}`);
  }

  const images = await response.json();
  return Array.isArray(images)
    ? images.map((image) => ({ ...image, dataOrigin: image.dataOrigin || "json" }))
    : [];
}

async function fetchImageData() {
  const requiredRows = getConfiguredRoundCount(readPublicGameSettings());
  let supabaseImages = [];

  try {
    supabaseImages = await fetchSupabaseImageData();
  } catch (error) {
    if (isSupabaseConfigured()) {
      console.warn("Supabase image load failed; using JSON fallback.", error);
    }
  }

  if (supabaseImages.length > 0) {
    if (supabaseImages.length < requiredRows) {
      console.info(`Supabase returned ${supabaseImages.length} approved image(s); filling the rest of the game from JSON fallback.`);
    }

    try {
      const jsonImages = await fetchJsonImageData();
      state.dataSource = supabaseImages.length >= requiredRows ? "supabase" : "supabase+json";
      return mergePublicImageData(supabaseImages, jsonImages);
    } catch (error) {
      console.warn("JSON fallback could not load; using Supabase images only.", error);
      state.dataSource = "supabase";
      return supabaseImages;
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
    const supabaseSettings = await fetchSupabaseSiteSettings();
    if (supabaseSettings) {
      state.publicSettings = normalizeOwnerSettings(supabaseSettings);
      return;
    }
  } catch (error) {
    console.warn("Supabase site settings could not load; using JSON fallback.", error);
  }

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

async function fetchSupabaseSiteSettings() {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from("site_settings")
    .select("value")
    .eq("key", SITE_SETTINGS_RECORD_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.value || null;
}

async function loadPublicQuestionSets() {
  try {
    state.publicQuestionSets = await fetchSupabaseQuestionSets();
  } catch (error) {
    state.publicQuestionSets = [];
    console.warn("Supabase question sets could not load; using all public images.", error);
  }
}

async function fetchSupabaseQuestionSets() {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("question_sets")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || [])
    .map(normalizeQuestionSetRow)
    .filter((set) => set.id && set.title && set.isPublic);
}

async function loadPublicDailyChallenges() {
  try {
    state.dailyChallenges = await fetchSupabaseDailyChallenges();
  } catch (error) {
    state.dailyChallenges = [];
    if (!isMissingRelationError(error, "daily_challenges")) {
      console.warn("Dated challenges could not load; the regular game remains available.", error);
    }
  }
}

async function fetchSupabaseDailyChallenges() {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("daily_challenges")
    .select("*")
    .eq("published", true)
    .lte("challenge_date", getLocalDateKey())
    .order("challenge_date", { ascending: false });

  if (error) {
    throw error;
  }

  return (data || [])
    .map(normalizeDailyChallengeRow)
    .filter((challenge) => challenge.date && challenge.imageIds.length > 0);
}

function renderPublicArchive() {
  renderPlayerRecord();
  renderDailyArchive();
  renderPublicCollections();
  populateArchiveFilters();
  renderArchiveCatalogue();
}

function bindArchiveControls() {
  ["#archiveSearch", "#archivePeriodFilter", "#archiveMediumFilter", "#archiveTagFilter"].forEach((selector) => {
    const control = $(selector);
    if (!control) {
      return;
    }
    control.addEventListener(control.matches("input") ? "input" : "change", renderArchiveCatalogue);
  });

  $("#clearArchiveFilters")?.addEventListener("click", () => {
    setInputValue("#archiveSearch", "");
    setInputValue("#archivePeriodFilter", "all");
    setInputValue("#archiveMediumFilter", "all");
    setInputValue("#archiveTagFilter", "all");
    renderArchiveCatalogue();
  });

  document.addEventListener("click", (event) => {
    const recordControl = event.target.closest("[data-record-id]");
    if (!recordControl) {
      return;
    }
    event.preventDefault();
    openArchiveRecord(recordControl.dataset.recordId);
  });

  $("#backToArchive")?.addEventListener("click", closeArchiveRecord);
  $("#copyRecordLink")?.addEventListener("click", copyCurrentRecordLink);
  $("#openRecordImage")?.addEventListener("click", openRecordImageInspector);
  $("#recordAppearances")?.addEventListener("click", handlePublicArchiveAction);
  window.addEventListener("popstate", applyRecordHistoryRoute);
}

function populateArchiveFilters() {
  const records = state.staticImages.filter(isPlayableImage);
  const periodSelect = $("#archivePeriodFilter");
  const mediumSelect = $("#archiveMediumFilter");
  const tagSelect = $("#archiveTagFilter");
  if (!periodSelect || !mediumSelect || !tagSelect) {
    return;
  }

  const selectedPeriod = periodSelect.value || "all";
  const selectedMedium = mediumSelect.value || "all";
  const selectedTag = tagSelect.value || "all";
  const periods = [...new Map(
    records
      .map((record) => getArchivePeriod(record.year))
      .sort((a, b) => a.sort - b.sort)
      .map((period) => [period.value, period])
  ).values()];
  const media = [...new Set(records.map(getArchiveMedium))].sort((a, b) => a.localeCompare(b));
  const tags = [...new Set(records.flatMap((record) => record.tags))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  periodSelect.innerHTML = [
    '<option value="all">All periods</option>',
    ...periods.map((period) => `<option value="${escapeAttribute(period.value)}">${escapeHtml(period.label)}</option>`),
  ].join("");
  mediumSelect.innerHTML = [
    '<option value="all">All media</option>',
    ...media.map((medium) => `<option value="${escapeAttribute(medium)}">${escapeHtml(medium)}</option>`),
  ].join("");
  tagSelect.innerHTML = [
    '<option value="all">All tags</option>',
    ...tags.map((tag) => `<option value="${escapeAttribute(tag)}">${escapeHtml(tag)}</option>`),
  ].join("");

  periodSelect.value = periods.some((period) => period.value === selectedPeriod) ? selectedPeriod : "all";
  mediumSelect.value = media.includes(selectedMedium) ? selectedMedium : "all";
  tagSelect.value = tags.includes(selectedTag) ? selectedTag : "all";
}

function renderArchiveCatalogue() {
  const container = $("#archiveRecordGrid");
  const count = $("#archiveRecordCount");
  if (!container || !count) {
    return;
  }

  const query = cleanString($("#archiveSearch")?.value).toLowerCase();
  const period = cleanString($("#archivePeriodFilter")?.value) || "all";
  const medium = cleanString($("#archiveMediumFilter")?.value) || "all";
  const tag = cleanString($("#archiveTagFilter")?.value) || "all";
  const records = state.staticImages
    .filter(isPlayableImage)
    .filter((record) => {
      const haystack = [record.title, record.locationName, record.yearRange, record.source, ...record.tags]
        .join(" ")
        .toLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (period === "all" || getArchivePeriod(record.year).value === period) &&
        (medium === "all" || getArchiveMedium(record) === medium) &&
        (tag === "all" || record.tags.includes(tag))
      );
    })
    .sort((a, b) => Number(b.year) - Number(a.year) || a.title.localeCompare(b.title));

  count.textContent = `${records.length} of ${state.staticImages.length} published record${state.staticImages.length === 1 ? "" : "s"}`;
  if (records.length === 0) {
    container.innerHTML = `
      <div class="catalogue-empty">
        <strong>No records match this reading.</strong>
        <span>Clear the filters or try a broader search.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = records.map(renderArchiveRecordCard).join("");
}

function renderArchiveRecordCard(record, options = {}) {
  const compact = options.compact === true;
  const visibleTags = record.tags.slice(0, compact ? 2 : 3);
  return `
    <article class="archive-record-card${compact ? " is-compact" : ""}">
      <button type="button" data-record-id="${escapeAttribute(record.id)}" aria-label="Open record: ${escapeAttribute(record.title)}">
        <span class="record-card-image">
          <img src="${escapeAttribute(safeImageUrl(record.image))}" alt="" loading="lazy" />
          <span>${escapeHtml(record.yearRange || formatYearLabel(record.year))}</span>
        </span>
        <span class="record-card-copy">
          <span class="record-card-meta">${escapeHtml(getArchiveMedium(record))} &middot; ${escapeHtml(record.difficulty)}</span>
          <strong>${escapeHtml(record.title)}</strong>
          <span class="record-card-place">${escapeHtml(record.locationName)}</span>
          <span class="record-card-tags">${visibleTags.map((item) => `<em>${escapeHtml(item)}</em>`).join("")}</span>
        </span>
      </button>
    </article>
  `;
}

function getArchivePeriod(yearValue) {
  const year = Number(yearValue);
  if (year <= 0) {
    const century = Math.max(1, Math.ceil(Math.abs(year || 1) / 100));
    return {
      value: `bce-${century}`,
      label: `${formatOrdinal(century)} century BCE`,
      sort: -century,
    };
  }
  const century = Math.ceil(year / 100);
  return {
    value: `ce-${century}`,
    label: `${formatOrdinal(century)} century`,
    sort: century,
  };
}

function getArchiveMedium(record) {
  const tags = record.tags.map((tag) => tag.toLowerCase());
  if (tags.some((tag) => tag === "painting" || tag.includes("painting"))) return "Painting";
  if (tags.some((tag) => tag.includes("ukiyo-e") || tag.includes("woodblock") || tag === "print")) return "Print";
  if (tags.some((tag) => tag === "map" || tag.includes("cartography"))) return "Map";
  if (tags.some((tag) => tag === "object" || tag === "artifact" || tag === "artefact")) return "Object";
  return "Photograph";
}

function formatOrdinal(value) {
  const number = Number(value);
  const remainder100 = number % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${number}th`;
  const suffix = number % 10 === 1 ? "st" : number % 10 === 2 ? "nd" : number % 10 === 3 ? "rd" : "th";
  return `${number}${suffix}`;
}

function openArchiveRecord(recordId, options = {}) {
  const record = state.staticImages.find((entry) => String(entry.id) === String(recordId));
  if (!record) {
    showArchiveMessage("That archival record is not available.");
    showView("archive");
    return false;
  }

  if (state.activeView !== "record") {
    state.recordReturnView = ["game", "results"].includes(state.activeView) ? state.activeView : "archive";
    const currentParams = new URLSearchParams(window.location.search);
    state.recordReturnUrl = currentParams.has("record")
      ? `${window.location.pathname}#archive`
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
  state.currentRecord = record;
  renderArchiveRecord(record);
  showView("record");
  if (options.updateHistory !== false) {
    window.history.pushState({ recordId: record.id }, "", getArchiveRecordPath(record.id));
  }
  trackAnalyticsEvent("view_archive_record", {
    record_id: record.id,
    record_year: record.year,
    record_medium: getArchiveMedium(record),
  });
  return true;
}

function renderArchiveRecord(record) {
  const stableRecordNumber = cleanString(record.id).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  $("#recordNumber").textContent = `CS-${stableRecordNumber || "ARCHIVE"}`;
  $("#recordTitle").textContent = record.title;
  $("#recordDeck").textContent = `${record.locationName} · ${record.yearRange || formatYearLabel(record.year)}`;
  $("#recordImage").src = safeImageUrl(record.image);
  $("#recordImage").alt = record.title;
  $("#recordImageCaption").textContent = `${record.title} · ${record.locationName}`;
  $("#recordCoordinates").textContent = `${formatPreciseCoordinate(record.lat)}, ${formatPreciseCoordinate(record.lng)}`;
  $("#recordHistoricalText").innerHTML = `<p>${escapeHtml(record.explanation || "This record is awaiting expanded historical context.")}</p>`;
  $("#recordRights").textContent = record.rights || "Rights information has not been supplied.";
  const returnLabels = {
    game: "Back to Reading",
    results: "Back to Results",
    archive: "Back to Archive",
  };
  $("#backToArchive").innerHTML = `<span aria-hidden="true">&larr;</span> ${returnLabels[state.recordReturnView] || returnLabels.archive}`;

  const factRows = [
    ["Date", record.yearRange || formatYearLabel(record.year)],
    ["Place", record.locationName],
    ["Medium", getArchiveMedium(record)],
    ["Difficulty", capitalizeWord(record.difficulty)],
  ];
  $("#recordFactList").innerHTML = factRows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("") + `
      <div class="record-tag-fact">
        <dt>Index terms</dt>
        <dd>${record.tags.map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "None assigned"}</dd>
      </div>
    `;

  const sourceUrls = extractHttpsUrls(`${record.source} ${record.rights}`);
  const sourceText = stripUrlsFromText(record.source) || "Source details are attached to the collection record.";
  $("#recordSource").textContent = sourceText;
  $("#recordSourceLinks").innerHTML = sourceUrls.length
    ? sourceUrls.map((url, index) => `
        <a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(formatSourceLinkLabel(url, index))} <span aria-hidden="true">&nearr;</span>
        </a>
      `).join("")
    : '<span class="record-no-link">No direct catalogue link supplied.</span>';

  renderRecordAppearances(record);
  renderRelatedRecords(record);
  initRecordMap(record);
  document.title = `${record.title} | Chronoscope`;
}

function renderRecordAppearances(record) {
  const appearances = [];
  state.dailyChallenges.forEach((challenge) => {
    if (challenge.imageIds.includes(record.id)) {
      appearances.push(`<button type="button" data-action="play-daily" data-challenge-date="${escapeAttribute(challenge.date)}">${escapeHtml(challenge.title)} · ${escapeHtml(formatArchiveDate(challenge.date))}</button>`);
    }
  });
  state.publicQuestionSets.forEach((set) => {
    if (set.isPublic && set.imageIds.includes(record.id)) {
      appearances.push(`<button type="button" data-action="play-collection" data-set-id="${escapeAttribute(set.id)}">${escapeHtml(set.title)}</button>`);
    }
  });
  $("#recordAppearances").innerHTML = appearances.length
    ? appearances.join("")
    : '<span class="record-no-link">Published archive</span>';
}

function renderRelatedRecords(record) {
  const recordTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  const related = state.staticImages
    .filter((entry) => entry.id !== record.id)
    .map((entry) => {
      const sharedTags = entry.tags.filter((tag) => recordTags.has(tag.toLowerCase())).length;
      const sameMedium = getArchiveMedium(entry) === getArchiveMedium(record) ? 1 : 0;
      const samePeriod = getArchivePeriod(entry.year).value === getArchivePeriod(record.year).value ? 1 : 0;
      return { entry, score: sharedTags * 3 + sameMedium + samePeriod };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, 4)
    .map((item) => item.entry);

  $("#relatedRecordGrid").innerHTML = related.length
    ? related.map((entry) => renderArchiveRecordCard(entry, { compact: true })).join("")
    : '<p class="record-no-link">No related records are indexed yet.</p>';
}

function initRecordMap(record) {
  if (typeof L === "undefined" || !$("#recordMap")) {
    return;
  }
  const point = [record.lat, record.lng];
  if (!state.recordMap) {
    state.recordMap = L.map("recordMap", {
      minZoom: 2,
      worldCopyJump: true,
      scrollWheelZoom: false,
    });
    addChronoscopeBaseLayers(state.recordMap);
  }
  if (state.recordMarker) {
    state.recordMarker.setLatLng(point);
  } else {
    state.recordMarker = L.marker(point, { icon: createMapPinIcon("answer") }).addTo(state.recordMap);
  }
  state.recordMarker.bindPopup(record.locationName);
  state.recordMap.setView(point, 11);
  setTimeout(() => state.recordMap.invalidateSize(), 80);
}

function closeArchiveRecord() {
  const returnView = state.recordReturnView || "archive";
  const returnUrl = state.recordReturnUrl || `${window.location.pathname}#archive`;
  state.currentRecord = null;
  document.title = getAnalyticsPageTitle(returnView);
  window.history.pushState({}, "", returnUrl);
  showView(returnView);
  state.recordReturnView = "archive";
  state.recordReturnUrl = "";
}

function applyRecordHistoryRoute() {
  if (!state.staticImages.length) {
    return;
  }
  const recordId = cleanString(new URLSearchParams(window.location.search).get("record"));
  if (recordId) {
    openArchiveRecord(recordId, { updateHistory: false });
  } else if (state.activeView === "record") {
    const returnView = state.recordReturnView || "archive";
    state.currentRecord = null;
    document.title = getAnalyticsPageTitle(returnView);
    showView(returnView);
    state.recordReturnView = "archive";
    state.recordReturnUrl = "";
  }
}

function getArchiveRecordPath(recordId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("record", recordId);
  url.hash = "record";
  return `${url.pathname}${url.search}${url.hash}`;
}

async function copyCurrentRecordLink() {
  const status = $("#copyRecordStatus");
  if (!state.currentRecord || !status) {
    return;
  }
  try {
    await copyText(`${window.location.origin}${getArchiveRecordPath(state.currentRecord.id)}`);
    status.textContent = "Record link copied.";
  } catch (error) {
    status.textContent = "The record link could not be copied.";
  }
}

function renderDailyArchive() {
  const container = $("#dailyArchiveList");
  if (!container) {
    return;
  }

  if (state.dailyChallenges.length === 0) {
    container.innerHTML = `
      <div class="archive-empty-row">
        <strong>No dated editions yet</strong>
        <span>The regular game and curator collections remain available.</span>
      </div>
    `;
    return;
  }

  const completedDailyKeys = new Set(
    readPlayerRecord().sessions
      .filter((session) => session.type === "daily")
      .map((session) => session.key)
  );

  container.innerHTML = state.dailyChallenges
    .map((challenge) => {
      const complete = completedDailyKeys.has(`daily:${challenge.date}`)
        ? '<span class="archive-complete">Read</span>'
        : "";
      return `
        <article class="archive-row">
          <time datetime="${escapeAttribute(challenge.date)}">${escapeHtml(formatArchiveDate(challenge.date))}</time>
          <div>
            <h4>${escapeHtml(challenge.title)}</h4>
            <p>${challenge.imageIds.length} case${challenge.imageIds.length === 1 ? "" : "s"}</p>
          </div>
          ${complete}
          <button class="secondary-button compact-button" type="button" data-action="play-daily" data-challenge-date="${escapeAttribute(challenge.date)}">
            Open
          </button>
        </article>
      `;
    })
    .join("");
}

function renderPublicCollections() {
  const container = $("#archiveCollectionList");
  if (!container) {
    return;
  }

  const sets = state.publicQuestionSets.filter((set) => set.isPublic && set.imageIds.length > 0);
  if (sets.length === 0) {
    container.innerHTML = `
      <div class="archive-empty-row">
        <strong>No public collections yet</strong>
        <span>Curator selections will appear here when published.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = sets
    .map(
      (set) => `
        <article class="archive-row collection-row">
          <span class="collection-index">${String(set.imageIds.length).padStart(2, "0")}</span>
          <div>
            <h4>${escapeHtml(set.title)}</h4>
            <p>${escapeHtml(set.description || "A curator-selected group of historical cases.")}</p>
          </div>
          <button class="secondary-button compact-button" type="button" data-action="play-collection" data-set-id="${escapeAttribute(set.id)}">
            Open
          </button>
        </article>
      `
    )
    .join("");
}

function showArchiveMessage(message = "") {
  const status = $("#archiveStatus");
  if (status) {
    status.textContent = message;
  }
}

function formatArchiveDate(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function readPlayerRecord() {
  const stored = readJsonStorage(PLAYER_RECORD_STORAGE_KEY, { sessions: [] });
  const sessions = Array.isArray(stored?.sessions) ? stored.sessions : [];
  return {
    sessions: sessions
      .filter((session) => session && session.key && Number.isFinite(Number(session.percent)))
      .slice(0, 200),
  };
}

function savePlayerResult(totalScore, maxScore, rating) {
  const record = readPlayerRecord();
  const context = state.activeChallenge || {};
  const percent = scorePercentage(totalScore, maxScore);
  const session = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: cleanString(context.key) || `session:${Date.now()}`,
    type: cleanString(context.type) || "selection",
    label: cleanString(context.label) || "Chronoscope Game",
    challengeDate: cleanString(context.date),
    completedDate: getLocalDateKey(),
    completedAt: new Date().toISOString(),
    score: totalScore,
    maxScore,
    percent,
    rating,
    roundCount: state.rounds.length,
  };

  record.sessions.unshift(session);
  writeJsonStorage(PLAYER_RECORD_STORAGE_KEY, { sessions: record.sessions.slice(0, 200) });
  renderPlayerRecord();
  return getPlayerRecordSummary(record.sessions);
}

function getPlayerRecordSummary(sessions = readPlayerRecord().sessions) {
  const totalCases = sessions.reduce((sum, session) => sum + (Number(session.roundCount) || 0), 0);
  const bestPercent = sessions.reduce((best, session) => Math.max(best, Number(session.percent) || 0), 0);
  const validDailyDates = new Set(
    sessions
      .filter(
        (session) =>
          session.type === "daily" &&
          session.challengeDate &&
          session.challengeDate === session.completedDate
      )
      .map((session) => session.challengeDate)
  );

  let streak = 0;
  const cursor = new Date(`${getLocalDateKey()}T12:00:00`);
  while (validDailyDates.has(getLocalDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    games: sessions.length,
    cases: totalCases,
    bestPercent,
    dailyDays: validDailyDates.size,
    streak,
  };
}

function renderPlayerRecord() {
  const container = $("#playerRecordMetrics");
  if (!container) {
    return;
  }

  const summary = getPlayerRecordSummary();
  container.innerHTML = [
    ["Sessions", summary.games],
    ["Cases read", summary.cases],
    ["Best reading", `${summary.bestPercent}%`],
    ["Daily streak", `${summary.streak} day${summary.streak === 1 ? "" : "s"}`],
  ]
    .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("");
}

function clearPlayerRecord() {
  if (!window.confirm("Clear the Chronoscope record stored on this device?")) {
    return;
  }
  localStorage.removeItem(PLAYER_RECORD_STORAGE_KEY);
  renderPublicArchive();
  showArchiveMessage("The record on this device has been cleared.");
}

// This is the only public data load for the game. On GitHub Pages this fetches
// Supabase-approved images first, then falls back to static JSON.
async function loadImageData() {
  const status = $("#dataStatus");

  try {
    const images = await fetchImageData();
    state.staticImages = images.filter(isPlayableImage).map(normalizeImageEntry);
    state.images = resolvePublicGameImagePool(state.staticImages);

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
    dataOrigin: cleanString(entry.dataOrigin),
    createdAt: cleanString(entry.createdAt),
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
    dataOrigin: "supabase",
    createdAt: row.created_at,
    approvedAt: row.created_at,
  });
}

function normalizeQuestionSetRow(row) {
  return {
    id: cleanString(row.id),
    title: cleanString(row.title),
    description: cleanString(row.description),
    imageIds: Array.isArray(row.image_ids) ? row.image_ids.map(cleanString).filter(Boolean) : [],
    isPublic: row.is_public !== false,
    createdAt: cleanString(row.created_at),
    updatedAt: cleanString(row.updated_at),
  };
}

function normalizeDailyChallengeRow(row) {
  return {
    date: cleanString(row.challenge_date),
    title: cleanString(row.title) || "Daily Challenge",
    imageIds: Array.isArray(row.image_ids) ? row.image_ids.map(cleanString).filter(Boolean) : [],
    questionSetId: cleanString(row.question_set_id),
    roundCount: getConfiguredRoundCount({ roundsPerGame: row.round_count }),
    published: row.published === true,
    createdAt: cleanString(row.created_at),
    updatedAt: cleanString(row.updated_at),
  };
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

function resolveGameImagePool(staticImages, settings = readPublicGameSettings()) {
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

function resolvePublicGameImagePool(staticImages, settings = readPublicGameSettings()) {
  const sourceImages = staticImages.filter(isPlayableImage);
  const activeSetId = cleanString(settings.activeSetId);
  if (!activeSetId || activeSetId === "all") {
    return sourceImages;
  }

  const activeSet = getPublicQuestionSet(activeSetId);
  if (!activeSet) {
    return sourceImages;
  }

  const allowedIds = new Set(activeSet.imageIds || []);
  const filtered = sourceImages.filter((image) => allowedIds.has(image.id));
  return filtered.length ? filtered : sourceImages;
}

function getPublicQuestionSet(setId) {
  return state.publicQuestionSets.find((set) => set.id === setId) || null;
}

function bindGameControls() {
  $("#yearInput").min = YEAR_MIN;
  $("#yearInput").max = YEAR_MAX;
  setYearGuess(DEFAULT_YEAR);

  $("#yearInput").addEventListener("input", (event) => setYearGuess(event.target.value));
  bindTimelineControl();
  bindGuessModeControls();
  bindImageInspectorControls();
  $("#submitGuess").addEventListener("click", submitGuess);
  $("#refreshRound").addEventListener("click", refreshCurrentRound);
  $("#nextRound").addEventListener("click", advanceRound);
}

function bindGuessModeControls() {
  $$('.guess-mode-tabs [data-guess-mode]').forEach((control) => {
    control.addEventListener("click", () => setGuessMode(control.dataset.guessMode));
  });
}

function setGuessMode(mode) {
  const nextMode = mode === "when" ? "when" : "where";
  state.guessMode = nextMode;
  const panel = $(".detective-panel");
  if (panel) {
    panel.dataset.guessMode = nextMode;
  }
  $$('.guess-mode-tabs [data-guess-mode]').forEach((control) => {
    const isActive = control.dataset.guessMode === nextMode;
    control.classList.toggle("is-active", isActive);
    control.setAttribute("aria-selected", String(isActive));
  });
  if (nextMode === "where" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 40);
  }
}

function bindImageInspectorControls() {
  const image = $("#imageImage");
  const openButton = $("#openImageInspector");
  const closeButton = $("#closeImageInspector");
  const inspector = $("#imageInspector");

  if (image) {
    image.addEventListener("click", openImageInspector);
  }
  if (openButton) {
    openButton.addEventListener("click", openImageInspector);
  }
  if (closeButton) {
    closeButton.addEventListener("click", closeImageInspector);
  }
  if (inspector) {
    inspector.addEventListener("click", (event) => {
      if (event.target === inspector) {
        closeImageInspector();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && inspector && !inspector.hidden) {
      closeImageInspector();
    }
  });
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
  const year =
    safeRatio <= TIMELINE_BREAK_RATIO
      ? Math.round(YEAR_MIN + (safeRatio / TIMELINE_BREAK_RATIO) * (TIMELINE_BREAK_YEAR - YEAR_MIN))
      : Math.round(
          TIMELINE_BREAK_YEAR +
            ((safeRatio - TIMELINE_BREAK_RATIO) / (1 - TIMELINE_BREAK_RATIO)) *
              (YEAR_MAX - TIMELINE_BREAK_YEAR)
        );
  return year === 0 ? 1 : year;
}

function timelineRatioFromYear(year) {
  const safeYear = Math.min(YEAR_MAX, Math.max(YEAR_MIN, Number(year) || DEFAULT_YEAR));
  if (safeYear <= TIMELINE_BREAK_YEAR) {
    return ((safeYear - YEAR_MIN) / (TIMELINE_BREAK_YEAR - YEAR_MIN)) * TIMELINE_BREAK_RATIO;
  }

  return (
    TIMELINE_BREAK_RATIO +
    ((safeYear - TIMELINE_BREAK_YEAR) / (YEAR_MAX - TIMELINE_BREAK_YEAR)) *
      (1 - TIMELINE_BREAK_RATIO)
  );
}

function updateTimelineMarker(year) {
  const marker = $("#timeMarker");
  const timeline = $("#timeTimeline");
  if (!marker || !timeline) {
    return;
  }

  const ratio = timelineRatioFromYear(year);
  marker.style.left = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  timeline.setAttribute("aria-valuenow", String(year));
  timeline.setAttribute("aria-valuetext", formatYearLabel(year));
}

function startGame() {
  const todayChallenge = state.dailyChallenges.find((challenge) => challenge.date === getLocalDateKey());
  if (todayChallenge && startDailyChallenge(todayChallenge.date)) {
    return;
  }

  const settings = readPublicGameSettings();
  state.images = resolvePublicGameImagePool(state.staticImages, settings);

  if (state.images.length === 0) {
    const status = $("#dataStatus");
    if (status) {
      status.textContent = "No playable images are available.";
    }
    showView("home");
    return;
  }

  const roundCount = Math.min(getConfiguredRoundCount(settings), state.images.length);
  const pool = selectDailyRoundPool(state.images, roundCount, settings);

  beginGame(pool.slice(0, roundCount), {
    type: "selection",
    key: `selection:${getLocalDateKey()}:${pool.slice(0, roundCount).map((image) => image.id).join(",")}`,
    label: cleanString(settings.activeSetName) || "Today's Selection",
    date: getLocalDateKey(),
    shareUrl: OFFICIAL_SITE_URL,
  });
}

function beginGame(rounds, challengeContext) {
  const playableRounds = rounds.filter(isPlayableImage);
  if (playableRounds.length === 0) {
    showArchiveMessage("This entry has no playable cases available.");
    showView("archive");
    return false;
  }

  state.rounds = playableRounds;
  state.results = [];
  state.currentRoundIndex = 0;
  state.guess = null;
  state.isRevealed = false;
  state.activeChallenge = challengeContext;
  state.resultRecorded = false;

  trackAnalyticsEvent("start_game", {
    round_count: state.rounds.length,
    challenge_type: challengeContext?.type || "selection",
    challenge_key: challengeContext?.key || "",
    data_source: state.dataSource,
  });

  showView("game");
  setGuessMode("where");

  requestAnimationFrame(() => {
    initMap();
    loadRound();
  });

  return true;
}

function startDailyChallenge(date) {
  const challenge = state.dailyChallenges.find((entry) => entry.date === date);
  if (!challenge) {
    showArchiveMessage("That dated challenge is not available in the public archive.");
    return false;
  }

  const rounds = resolveImagesByIds(challenge.imageIds).slice(0, challenge.roundCount);
  return beginGame(rounds, {
    type: "daily",
    key: `daily:${challenge.date}`,
    label: challenge.title,
    date: challenge.date,
    shareUrl: `${OFFICIAL_SITE_URL}?daily=${encodeURIComponent(challenge.date)}`,
  });
}

function startQuestionSet(setId) {
  const set = state.publicQuestionSets.find((entry) => entry.id === setId && entry.isPublic);
  if (!set) {
    showArchiveMessage("That collection is not available in the public archive.");
    return false;
  }

  const rounds = resolveImagesByIds(set.imageIds);
  return beginGame(rounds, {
    type: "collection",
    key: `collection:${set.id}`,
    label: set.title,
    setId: set.id,
    shareUrl: `${OFFICIAL_SITE_URL}?set=${encodeURIComponent(set.id)}`,
  });
}

function startPracticeGame() {
  const images = state.staticImages.filter(isPlayableImage);
  const roundCount = Math.min(getConfiguredRoundCount(readPublicGameSettings()), images.length);
  const rounds = seededShuffle([...images], `practice:${Date.now()}`).slice(0, roundCount);
  beginGame(rounds, {
    type: "practice",
    key: `practice:${Date.now()}`,
    label: "Archive Practice",
    shareUrl: `${OFFICIAL_SITE_URL}#archive`,
  });
}

function replayActiveChallenge() {
  const rounds = [...state.rounds];
  const context = state.activeChallenge ? { ...state.activeChallenge } : null;
  if (rounds.length && context) {
    beginGame(rounds, context);
    return;
  }
  startGame();
}

function resolveImagesByIds(imageIds) {
  const byId = new Map(state.staticImages.map((image) => [String(image.id), image]));
  return imageIds.map((id) => byId.get(String(id))).filter(Boolean);
}

function handlePublicArchiveAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  if (button.dataset.action === "play-daily") {
    const date = cleanString(button.dataset.challengeDate);
    if (startDailyChallenge(date)) {
      window.history.pushState({}, "", `${window.location.pathname}?daily=${encodeURIComponent(date)}`);
    }
  }
  if (button.dataset.action === "play-collection") {
    const setId = cleanString(button.dataset.setId);
    if (startQuestionSet(setId)) {
      window.history.pushState({}, "", `${window.location.pathname}?set=${encodeURIComponent(setId)}`);
    }
  }
}

function applyInitialChallengeRoute() {
  if (state.initialRouteApplied) {
    return;
  }
  state.initialRouteApplied = true;

  const params = new URLSearchParams(window.location.search);
  const recordId = cleanString(params.get("record"));
  const dailyDate = cleanString(params.get("daily"));
  const setId = cleanString(params.get("set"));
  if (recordId) {
    if (!openArchiveRecord(recordId, { updateHistory: false })) {
      showView("archive");
    }
    return;
  }
  if (dailyDate) {
    if (!startDailyChallenge(dailyDate)) {
      showView("archive");
    }
    return;
  }
  if (setId) {
    if (!startQuestionSet(setId)) {
      showView("archive");
    }
  }
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

  addChronoscopeBaseLayers(state.map);

  state.map.on("click", handleMapClick);
}

function addChronoscopeBaseLayers(map) {
  const englishLabels = L.tileLayer(ENGLISH_MAP_TILE_URL, {
    maxZoom: 19,
    attribution: ENGLISH_MAP_ATTRIBUTION,
  });
  const localLabels = L.tileLayer(LOCAL_MAP_TILE_URL, {
    maxZoom: 19,
    attribution: LOCAL_MAP_ATTRIBUTION,
  });

  englishLabels.addTo(map);
  const layerControl = L.control.layers(
    {
      "English labels": englishLabels,
      "Local names (OpenStreetMap)": localLabels,
    },
    null,
    { position: "topright", collapsed: true }
  ).addTo(map);
  const controlElement = layerControl.getContainer();
  controlElement.setAttribute("aria-label", "Choose map label language");
  controlElement.querySelector(".leaflet-control-layers-toggle")?.setAttribute("title", "Choose map labels");

  return { englishLabels, localLabels, layerControl };
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

  const caseNumber = state.currentRoundIndex + 1;
  $("#roundTitle").textContent = `Case ${String(caseNumber).padStart(2, "0")}`;
  $("#roundCounter").textContent = `${String(caseNumber).padStart(2, "0")} / ${String(state.rounds.length).padStart(2, "0")}`;
  $("#scorePreview").textContent = `${formatNumber(getTotalScore())} / ${formatNumber(state.rounds.length * MAX_ROUND_SCORE)}`;
  renderRoundProgress();
  setGuessMode("where");
  setRoundImage(round, { forceReset: true });
  $("#mapStatus").textContent = "No location selected";
  $("#submitGuess").disabled = true;
  $("#submitGuess").hidden = false;
  $("#refreshRound").hidden = false;
  $("#nextRound").hidden = true;
  $("#nextRound").textContent = "Next Case";
  $("#revealPanel").hidden = true;
  $("#revealPanel").innerHTML = "";

  if (state.map) {
    state.map.setView([22, 12], 2);
    setTimeout(() => state.map.invalidateSize(), 80);
  }
}

function renderRoundProgress() {
  const progress = $("#roundProgress");
  if (!progress) {
    return;
  }

  progress.innerHTML = state.rounds
    .map((_, index) => {
      const status = index < state.currentRoundIndex
        ? "is-complete"
        : index === state.currentRoundIndex
          ? "is-current"
          : "is-upcoming";
      return `<span class="${status}"></span>`;
    })
    .join("");
}

function setRoundImage(round, options = {}) {
  const image = $("#imageImage");
  const caption = $("#imageCaption");
  if (!image || !round) {
    return;
  }

  const token = state.imageLoadToken + 1;
  state.imageLoadToken = token;
  const imageUrl = safeImageUrl(round.image);

  image.classList.add("is-loading");
  image.alt = `Archival image for round ${state.currentRoundIndex + 1}`;
  if (caption) {
    caption.textContent = options.manual
      ? "Refreshing the archival image..."
      : "Loading archival image...";
  }

  const handleLoad = () => {
    if (state.imageLoadToken !== token) {
      return;
    }
    image.classList.remove("is-loading");
    if (caption) {
      caption.textContent = getRoundImageCaption();
    }
  };

  const handleError = () => {
    if (state.imageLoadToken !== token) {
      return;
    }
    image.classList.remove("is-loading");
    if (caption) {
      caption.textContent = "Image could not load. Use Reload Image or try again shortly.";
    }
  };

  const assignImage = () => {
    image.onload = handleLoad;
    image.onerror = handleError;
    image.src = imageUrl;
  };

  if (options.forceReset) {
    image.onload = null;
    image.onerror = null;
    image.src = EMPTY_IMAGE_PLACEHOLDER;
    window.requestAnimationFrame(assignImage);
  } else {
    assignImage();
  }
}

function refreshCurrentRound() {
  const round = getCurrentRound();
  if (!round) {
    return;
  }

  setRoundImage(round, { forceReset: true, manual: true });
  if (state.map) {
    state.map.invalidateSize();
    if (!state.isRevealed) {
      state.map.setView([22, 12], 2);
    }
  }
}

function getRoundImageCaption() {
  const result = state.results.find((entry) => entry.roundNumber === state.currentRoundIndex + 1);
  if (state.isRevealed && result) {
    return `${result.title} - ${result.locationName}, ${result.yearRange || formatYearLabel(result.actualYear)}`;
  }
  return "Archive image - identifying record withheld";
}

function openImageInspector() {
  const round = getCurrentRound();
  if (!round) {
    return;
  }

  openImageInspectorFor(
    round.image,
    `Enlarged archival image for round ${state.currentRoundIndex + 1}`,
    getRoundImageCaption()
  );
}

function openRecordImageInspector() {
  const record = state.currentRecord;
  if (!record) {
    return;
  }

  openImageInspectorFor(record.image, record.title, `${record.title} - ${record.locationName}`);
}

function openImageInspectorFor(imageUrl, altText, captionText) {
  const inspector = $("#imageInspector");
  const inspectorImage = $("#inspectorImage");
  const inspectorCaption = $("#inspectorCaption");
  if (!inspector || !inspectorImage) {
    return;
  }

  inspectorImage.src = safeImageUrl(imageUrl);
  inspectorImage.alt = altText;
  if (inspectorCaption) {
    inspectorCaption.textContent = captionText;
  }
  inspector.hidden = false;
  document.body.classList.add("modal-open");
  $("#closeImageInspector")?.focus();
}

function closeImageInspector() {
  const inspector = $("#imageInspector");
  if (!inspector) {
    return;
  }

  inspector.hidden = true;
  document.body.classList.remove("modal-open");
  (state.activeView === "record" ? $("#openRecordImage") : $("#openImageInspector"))?.focus();
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
  setGuessMode("where");
  $("#submitGuess").hidden = true;
  $("#nextRound").hidden = false;
  $("#nextRound").textContent = state.currentRoundIndex >= state.rounds.length - 1 ? "End" : "Next Case";
  $("#roundTitle").textContent = result.title;
  $("#imageCaption").textContent = getRoundImageCaption();
  $("#scorePreview").textContent = `${formatNumber(getTotalScore())} / ${formatNumber(state.rounds.length * MAX_ROUND_SCORE)}`;
  renderRoundProgress();

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
      { color: "#AD4339", weight: 3, opacity: 0.9 }
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
    <p class="source-line">Source: ${escapeHtml(result.source || "Not provided")} | Rights: ${escapeHtml(result.rights || "Not provided")}</p>
    <div class="reveal-record-action">
      <button class="secondary-button" type="button" data-record-id="${escapeAttribute(result.imageId)}">
        Open Full Record <span aria-hidden="true">&rarr;</span>
      </button>
    </div>
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
  const scorePercent = scorePercentage(totalScore, maxScore);

  $("#finalScore").textContent = `${formatNumber(totalScore)} / ${formatNumber(maxScore)}`;
  $("#ratingTitle").textContent = `${rating} - ${scorePercent}%`;
  $("#roundBreakdown").innerHTML = renderRoundTable(state.results);

  const recordSummary = state.resultRecorded
    ? getPlayerRecordSummary()
    : savePlayerResult(totalScore, maxScore, rating);
  state.resultRecorded = true;
  $("#resultRecordNote").textContent = `${state.activeChallenge?.label || "Chronoscope Game"} recorded on this device. Current daily streak: ${recordSummary.streak}.`;

  const shareText = [
    `chronoscope.world · ${getShareDateLabel()}`,
    `${formatNumber(totalScore)} / ${formatNumber(maxScore)} · ${scorePercent}%`,
    renderShareScoreGrid(state.results),
  ].join("\n");

  $("#shareText").value = shareText;
  $("#copyResultStatus").textContent = "";
  trackAnalyticsEvent("complete_game", {
    total_score: totalScore,
    max_score: maxScore,
    rating,
    score_percent: scorePercent,
    round_count: state.rounds.length,
  });
  trackAnalyticsEvent("view_results", {
    total_score: totalScore,
    max_score: maxScore,
    rating,
    score_percent: scorePercent,
  });
  showView("results");
}

function getShareDateLabel() {
  const context = state.activeChallenge || {};
  const date = context.type === "daily" && context.date
    ? new Date(`${context.date}T12:00:00`)
    : new Date();
  if (Number.isNaN(date.getTime())) {
    return getLocalDateKey();
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date).replace(",", "");
}

function renderShareScoreGrid(results) {
  return results.map((result) => {
    const percent = scorePercentage(result.roundScore, MAX_ROUND_SCORE);
    if (percent >= 80) return "🟩";
    if (percent >= 60) return "🟦";
    if (percent >= 40) return "🟨";
    return "🟥";
  }).join("");
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
          <td>
            <button class="round-record-link" type="button" data-record-id="${escapeAttribute(result.imageId)}">${escapeHtml(result.title)}</button>
            <span class="round-record-answer">${escapeHtml(result.locationName)} · ${escapeHtml(result.yearRange || String(result.actualYear))}</span>
          </td>
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
    if (state.isSubmitting) {
      return;
    }

    const entry = buildSubmissionEntry(new FormData(form));
    const submitButton = $("button[type='submit']", form);
    state.isSubmitting = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
    }

    try {
      const result = await submitEntryToSupabase(entry);
      trackAnalyticsEvent("submit_photo", {
        status: result?.duplicate ? "duplicate" : "received",
      });
      $("#generatedSubmission").value = "";
      setSubmissionStatus(
        result?.duplicate
          ? "This submission was already received. It will be reviewed before appearing in Chronoscope."
          : "Submission received. It will be reviewed before appearing in Chronoscope.",
        "success"
      );
    } catch (error) {
      const pending = readPendingSubmissions();
      if (!pending.some((pendingEntry) => pendingEntry.submissionKey === entry.submissionKey)) {
        pending.push(entry);
      }
      writePendingSubmissions(pending);

      $("#generatedSubmission").value = JSON.stringify(entry, null, 2);
      setSubmissionStatus("Supabase could not receive this submission. A backup review record is ready to copy and send to the site owner.", "error");
      trackAnalyticsEvent("submit_photo", {
        status: "fallback",
      });
      console.warn("Supabase submission failed; using copyable JSON fallback.", error);
    } finally {
      state.isSubmitting = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Submit for Review";
      }
    }
  });

  form.addEventListener("reset", () => {
    $("#generatedSubmission").value = "";
    setSubmissionStatus("", "");
    clearSubmissionLocation();
  });
}

function showSubmissionConnectionStatus() {
  const status = $("#submissionStatus");
  if (!status) {
    return;
  }

  setSubmissionStatus(
    isSupabaseConfigured()
      ? "Archive connection ready. Submissions will enter the private review queue."
      : "Offline review mode. Submissions will create a copyable backup record.",
    ""
  );
}

function setSubmissionStatus(message, type = "") {
  const statusTargets = [$("#submissionStatus"), $("#submissionInlineStatus")].filter(Boolean);

  statusTargets.forEach((status) => {
    status.textContent = message;
    status.classList.toggle("is-success", type === "success");
    status.classList.toggle("is-error", type === "error");
  });
}

function bindSubmissionLocationControls() {
  const confirmButton = $("#confirmSubmissionLocation");
  const confirmTypedButton = $("#confirmTypedSubmissionLocation");
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
    $("#submissionMapStatus").textContent = `Confirmed: ${formatPreciseCoordinate(state.confirmedSubmissionLatLng.lat)}, ${formatPreciseCoordinate(state.confirmedSubmissionLatLng.lng)}`;
  });

  if (confirmTypedButton) {
    confirmTypedButton.addEventListener("click", confirmTypedSubmissionLocation);
  }

  clearButton.addEventListener("click", clearSubmissionLocation);
}

function confirmTypedSubmissionLocation() {
  const latInput = $("#submissionForm [name='lat']");
  const lngInput = $("#submissionForm [name='lng']");
  const lat = Number(latInput?.value);
  const lng = Number(lngInput?.value);
  const status = $("#submissionMapStatus");

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    if (status) {
      status.textContent = "Enter a latitude between -90 and 90 first.";
    }
    return;
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    if (status) {
      status.textContent = "Enter a longitude between -180 and 180 first.";
    }
    return;
  }

  const latLng = { lat, lng };
  state.pendingSubmissionLatLng = { ...latLng };
  state.confirmedSubmissionLatLng = { ...latLng };
  if (!state.submissionMap) {
    initSubmissionMap();
  }
  setSubmissionLocationMarker(latLng);

  if (latInput && lngInput) {
    latInput.value = lat.toFixed(5);
    lngInput.value = lng.toFixed(5);
  }

  if (status) {
    status.textContent = `Typed coordinates confirmed: ${formatPreciseCoordinate(lat)}, ${formatPreciseCoordinate(lng)}.`;
  }
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

  addChronoscopeBaseLayers(state.submissionMap);

  state.submissionMap.on("click", (event) => {
    state.pendingSubmissionLatLng = {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
    };

    setSubmissionLocationMarker(event.latlng);

    $("#submissionMapStatus").textContent = `Selected: ${formatPreciseCoordinate(event.latlng.lat)}, ${formatPreciseCoordinate(event.latlng.lng)}. Confirm to record it.`;
  });
}

function setSubmissionLocationMarker(latLng) {
  if (!state.submissionMap || typeof L === "undefined") {
    return;
  }

  const point = [Number(latLng.lat), Number(latLng.lng)];
  if (state.submissionMarker) {
    state.submissionMarker.setLatLng(point);
  } else {
    state.submissionMarker = L.marker(point).addTo(state.submissionMap);
  }

  state.submissionMap.setView(point, Math.max(state.submissionMap.getZoom(), 5));
  state.submissionMap.invalidateSize();
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
    submissionKey: createSubmissionKey({
      title,
      image: cleanString(formData.get("image")),
      locationName: cleanString(formData.get("locationName")),
      lat: Number(formData.get("lat")),
      lng: Number(formData.get("lng")),
      year,
      source: cleanString(formData.get("source")),
      rights: cleanString(formData.get("rights")),
    }),
  };
}

async function submitEntryToSupabase(entry) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  const row = mapSubmissionToSupabaseRow(entry);
  let { error } = await client.from("submissions").insert(row);
  if (error && isMissingColumnError(error, "submission_key")) {
    delete row.submission_key;
    const retry = await client.from("submissions").insert(row);
    error = retry.error;
  }

  if (error) {
    if (isDuplicateSubmissionError(error)) {
      return { duplicate: true };
    }
    throw error;
  }

  return { duplicate: false };
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
    submission_key: entry.submissionKey || null,
  };
}

function createSubmissionKey(entry) {
  const parts = [
    entry.title,
    entry.image,
    entry.locationName,
    Number.isFinite(Number(entry.lat)) ? Number(entry.lat).toFixed(5) : "",
    Number.isFinite(Number(entry.lng)) ? Number(entry.lng).toFixed(5) : "",
    entry.year,
    entry.source,
    entry.rights,
  ]
    .map((part) => cleanString(part).toLowerCase())
    .join("|");

  return `submission_${hashString(parts).toString(36)}`;
}

function isDuplicateSubmissionError(error) {
  return error?.code === "23505" || /duplicate|unique/i.test(error?.message || "");
}

function isMissingColumnError(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""}`;
  return error?.code === "PGRST204" || message.includes(columnName);
}

function isMissingRelationError(error, relationName) {
  const message = `${error?.message || ""} ${error?.details || ""}`;
  return error?.code === "PGRST205" || message.includes(relationName);
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
    refreshButton.addEventListener("click", refreshCuratorDashboard);
  }

  const homeGalleryForm = $("#curatorHomeGalleryForm");
  if (homeGalleryForm) {
    homeGalleryForm.addEventListener("submit", saveCuratorHomeGallery);
  }

  const pendingList = $("#pendingSubmissionsList");
  if (pendingList) {
    pendingList.addEventListener("click", handleCuratorSubmissionAction);
  }

  const rejectedList = $("#rejectedSubmissionsList");
  if (rejectedList) {
    rejectedList.addEventListener("click", handleCuratorSubmissionAction);
  }

  const approvedList = $("#approvedImagesList");
  if (approvedList) {
    approvedList.addEventListener("click", handleCuratorImageAction);
  }

  $("#approvedImageFilter")?.addEventListener("input", filterCuratorApprovedImages);

  const questionSetForm = $("#curatorQuestionSetForm");
  if (questionSetForm) {
    questionSetForm.addEventListener("submit", saveCuratorQuestionSet);
  }

  const questionSetPicker = $("#curatorQuestionImagePicker");
  if (questionSetPicker) {
    questionSetPicker.addEventListener("change", updateCuratorQuestionSetCount);
  }

  const clearQuestionSetButton = $("#clearCuratorQuestionSetForm");
  if (clearQuestionSetButton) {
    clearQuestionSetButton.addEventListener("click", clearCuratorQuestionSetForm);
  }

  const saveActiveSetButton = $("#saveCuratorActiveSet");
  if (saveActiveSetButton) {
    saveActiveSetButton.addEventListener("click", saveCuratorActiveSet);
  }

  const activeSetSelect = $("#curatorActiveQuestionSet");
  if (activeSetSelect) {
    activeSetSelect.addEventListener("change", updateCuratorActiveSetNameFromSelection);
  }

  const questionSetList = $("#curatorQuestionSetList");
  if (questionSetList) {
    questionSetList.addEventListener("click", handleCuratorQuestionSetAction);
  }

  $("#curatorDailyChallengeForm")?.addEventListener("submit", saveCuratorDailyChallenge);
  $("#clearCuratorDailyForm")?.addEventListener("click", clearCuratorDailyChallengeForm);
  $("#curatorDailyChallengeList")?.addEventListener("click", handleCuratorDailyChallengeAction);
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
  await refreshCuratorDashboard();
}

async function refreshCuratorDashboard() {
  await loadSiteSettings();
  renderCuratorHomeGalleryForm();
  await loadCuratorDashboard();
}

async function loadCuratorDashboard() {
  const client = getSupabaseClient();
  if (!client) {
    showCuratorLogin("Supabase is not configured yet.");
    return;
  }

  $("#curatorStatus").textContent = "Loading curator records...";
  renderCuratorPendingSubmissions([]);
  renderCuratorApprovedImages([]);
  renderCuratorRejectedSubmissions([]);
  renderCuratorDailyChallenges([], [], []);

  const [submissionsLoad, imagesLoad, questionSetsLoad, dailyChallengesLoad] = await Promise.allSettled([
    querySupabaseWithTimeout(
      client.from("submissions").select("*").order("created_at", { ascending: false }),
      "submissions"
    ),
    querySupabaseWithTimeout(
      client.from("images").select("*").order("created_at", { ascending: false }),
      "images"
    ),
    querySupabaseWithTimeout(
      client.from("question_sets").select("*").order("created_at", { ascending: true }),
      "question sets"
    ),
    querySupabaseWithTimeout(
      client.from("daily_challenges").select("*").order("challenge_date", { ascending: false }),
      "daily challenges"
    ),
  ]);

  const errors = [];
  let submissions = [];
  let images = [];
  let questionSets = [];
  let dailyChallenges = [];

  if (submissionsLoad.status === "fulfilled") {
    if (submissionsLoad.value.error) {
      errors.push(`submissions: ${formatSupabaseError(submissionsLoad.value.error)}`);
    } else {
      submissions = submissionsLoad.value.data || [];
    }
  } else {
    errors.push(`submissions: ${formatSupabaseError(submissionsLoad.reason)}`);
  }

  if (imagesLoad.status === "fulfilled") {
    if (imagesLoad.value.error) {
      errors.push(`images: ${formatSupabaseError(imagesLoad.value.error)}`);
    } else {
      images = imagesLoad.value.data || [];
    }
  } else {
    errors.push(`images: ${formatSupabaseError(imagesLoad.reason)}`);
  }

  if (questionSetsLoad.status === "fulfilled") {
    if (questionSetsLoad.value.error) {
      errors.push(`question sets: ${formatSupabaseError(questionSetsLoad.value.error)}`);
    } else {
      questionSets = (questionSetsLoad.value.data || []).map(normalizeQuestionSetRow);
    }
  } else {
    errors.push(`question sets: ${formatSupabaseError(questionSetsLoad.reason)}`);
  }

  if (dailyChallengesLoad.status === "fulfilled") {
    if (dailyChallengesLoad.value.error) {
      errors.push(`daily challenges: ${formatSupabaseError(dailyChallengesLoad.value.error)}`);
    } else {
      dailyChallenges = (dailyChallengesLoad.value.data || []).map(normalizeDailyChallengeRow);
    }
  } else {
    errors.push(`daily challenges: ${formatSupabaseError(dailyChallengesLoad.reason)}`);
  }

  try {
    const pending = submissions.filter((entry) => entry.status === "pending");
    const rejected = submissions.filter((entry) => entry.status === "rejected");
    adminState.images = images;
    adminState.questionSets = questionSets;
    adminState.dailyChallenges = dailyChallenges;

    renderCuratorPendingSubmissions(pending);
    renderCuratorApprovedImages(images);
    renderCuratorRejectedSubmissions(rejected);
    renderCuratorQuestionSets(images, questionSets);
    renderCuratorDailyChallenges(images, questionSets, dailyChallenges);

    const loadedMessage = `${pending.length} pending submission${pending.length === 1 ? "" : "s"} ready for review.`;
    $("#curatorStatus").textContent = errors.length
      ? `${loadedMessage} Some records could not load: ${errors.join(" | ")}`
      : loadedMessage;
  } catch (error) {
    $("#curatorStatus").textContent = `Records loaded, but the dashboard could not render them: ${formatSupabaseError(error)}`;
    console.error(error);
  }
}

function renderCuratorHomeGalleryForm() {
  const form = $("#curatorHomeGalleryForm");
  if (!form) {
    return;
  }

  const gallery = resolveHomeGallery(readPublicGameSettings());
  setInputValue(
    "#curatorHeroBackground",
    readPublicGameSettings().heroBackground || DEFAULT_HERO_BACKGROUND
  );
  setInputValue("#curatorHomeImageOne", gallery[0].image);
  setInputValue("#curatorHomePlaceOne", gallery[0].place);
  setInputValue("#curatorHomeTimeOne", gallery[0].time);
  setInputValue("#curatorHomeImageTwo", gallery[1].image);
  setInputValue("#curatorHomePlaceTwo", gallery[1].place);
  setInputValue("#curatorHomeTimeTwo", gallery[1].time);
  setInputValue("#curatorHomeImageThree", gallery[2].image);
  setInputValue("#curatorHomePlaceThree", gallery[2].place);
  setInputValue("#curatorHomeTimeThree", gallery[2].time);
}

async function saveCuratorHomeGallery(event) {
  event.preventDefault();

  const status = $("#curatorHomeGalleryStatus");

  const homeGallery = [
    buildCuratorHomeGalleryEntry(0, "One"),
    buildCuratorHomeGalleryEntry(1, "Two"),
    buildCuratorHomeGalleryEntry(2, "Three"),
  ];
  const heroBackground = cleanString($("#curatorHeroBackground")?.value) || DEFAULT_HERO_BACKGROUND;

  status.textContent = "Saving home gallery...";
  try {
    const nextSettings = await savePublicSettingsPatch({ homeGallery, heroBackground });
    state.publicSettings = normalizeOwnerSettings(nextSettings);
  } catch (error) {
    status.textContent = `Could not save home gallery: ${formatSupabaseError(error)}. Run migration 003_site_settings.sql if this is the first time using shared homepage controls.`;
    return;
  }

  renderCuratorHomeGalleryForm();
  status.textContent = "Home gallery saved. It is now public for all visitors.";
}

function buildCuratorHomeGalleryEntry(index, suffix) {
  const fallback = DEFAULT_HOME_GALLERY[index];
  return {
    image: cleanString($(`#curatorHomeImage${suffix}`)?.value) || fallback.image,
    place: cleanString($(`#curatorHomePlace${suffix}`)?.value) || fallback.place,
    time: cleanString($(`#curatorHomeTime${suffix}`)?.value) || fallback.time,
  };
}

function mapSettingsToSupabaseValue(settings) {
  const normalized = normalizeOwnerSettings(settings);
  return {
    roundsPerGame: normalized.roundsPerGame,
    activeSetId: normalized.activeSetId,
    activeSetName: normalized.activeSetName,
    randomizeRounds: normalized.randomizeRounds,
    heroBackground: normalized.heroBackground,
    homeGallery: normalized.homeGallery,
  };
}

async function savePublicSettingsPatch(patch) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  const nextSettings = mapSettingsToSupabaseValue({
    ...readPublicGameSettings(),
    ...patch,
  });
  const { error } = await client
    .from("site_settings")
    .upsert({
      key: SITE_SETTINGS_RECORD_KEY,
      value: nextSettings,
    });

  if (error) {
    throw error;
  }

  state.publicSettings = normalizeOwnerSettings(nextSettings);
  return nextSettings;
}

function querySupabaseWithTimeout(query, label, timeoutMs = 12000) {
  return Promise.race([
    query,
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`${label} request timed out after ${Math.round(timeoutMs / 1000)} seconds`));
      }, timeoutMs);
    }),
  ]);
}

function formatSupabaseError(error) {
  if (!error) {
    return "Unknown error";
  }
  return error.message || error.error_description || error.details || String(error);
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
  const count = $("#approvedImageCount");
  if (!container) {
    return;
  }

  if (count) {
    count.textContent = `${images.length} approved case${images.length === 1 ? "" : "s"}. Select a row to inspect or edit it.`;
  }

  if (images.length === 0) {
    container.innerHTML = renderCuratorEmptyState("No approved images", "Published Chronoscope cases will appear here.");
    return;
  }

  container.innerHTML = images.map(renderCuratorImageCard).join("");
  filterCuratorApprovedImages();
}

function filterCuratorApprovedImages() {
  const query = cleanString($("#approvedImageFilter")?.value).toLowerCase();
  let visible = 0;
  $$("#approvedImagesList [data-curator-image-id]").forEach((row) => {
    const matches = !query || (row.dataset.search || "").includes(query);
    row.hidden = !matches;
    if (matches) {
      visible += 1;
    }
  });

  const count = $("#approvedImageCount");
  if (count && query) {
    count.textContent = `${visible} matching case${visible === 1 ? "" : "s"}.`;
  }
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

function renderCuratorQuestionSets(images, sets) {
  renderCuratorQuestionImagePicker(images, getCuratorSelectedImageIds());
  renderCuratorActiveSetSelect(sets);
  renderCuratorQuestionSetList(sets);
}

function renderCuratorQuestionImagePicker(images, selectedIds = []) {
  const picker = $("#curatorQuestionImagePicker");
  if (!picker) {
    return;
  }

  const selected = new Set(selectedIds);
  if (images.length === 0) {
    picker.innerHTML = `<p class="field-note">No approved cases are available yet.</p>`;
    updateCuratorQuestionSetCount();
    return;
  }

  picker.innerHTML = images
    .map((image) => {
      const checked = selected.has(image.id) ? "checked" : "";
      const year = image.year_range || image.year || "Unknown date";
      return `
        <div class="image-choice">
          <label>
            <input type="checkbox" value="${escapeAttribute(image.id)}" ${checked} />
            <img src="${escapeAttribute(safeImageUrl(image.image_url))}" alt="${escapeAttribute(image.title || "Approved image")}" />
            <span>
              <strong>${escapeHtml(image.title || "Untitled image")}</strong>
              <small>${escapeHtml(image.location_name || "No location")} | ${escapeHtml(String(year))}</small>
            </span>
          </label>
        </div>
      `;
    })
    .join("");

  updateCuratorQuestionSetCount();
}

function renderCuratorActiveSetSelect(sets) {
  const select = $("#curatorActiveQuestionSet");
  if (!select) {
    return;
  }

  const settings = readPublicGameSettings();
  const activeSetId = cleanString(settings.activeSetId) || "all";
  select.innerHTML = [
    `<option value="all">All published cases</option>`,
    ...sets.map((set) => `<option value="${escapeAttribute(set.id)}">${escapeHtml(set.title)} (${set.imageIds.length})</option>`),
  ].join("");
  select.value = sets.some((set) => set.id === activeSetId) ? activeSetId : "all";
  const selectedSet = select.value === "all" ? null : sets.find((set) => set.id === select.value);
  const savedName = cleanString(settings.activeSetName);
  const fallbackName = selectedSet?.title || "All published cases";
  const displayName = savedName && (select.value === "all" || savedName !== "All published cases") ? savedName : fallbackName;
  setInputValue("#curatorActiveQuestionSetName", displayName);
  setInputValue("#curatorRoundsPerGame", getConfiguredRoundCount(settings));
}

function renderCuratorQuestionSetList(sets) {
  const container = $("#curatorQuestionSetList");
  if (!container) {
    return;
  }

  if (sets.length === 0) {
    container.innerHTML = `
      <section class="question-set-card">
        <div>
          <h3>No question sets yet</h3>
          <p>Create a set from approved cases above.</p>
        </div>
      </section>
    `;
    return;
  }

  const activeSetId = cleanString(readPublicGameSettings().activeSetId) || "all";
  container.innerHTML = sets
    .map((set) => {
      const active = set.id === activeSetId ? `<span class="status-pill">Active</span>` : "";
      const archiveStatus = set.isPublic ? `<span class="status-pill">Archive</span>` : `<span class="status-pill">Private</span>`;
      return `
        <article class="question-set-card" data-curator-question-set-id="${escapeAttribute(set.id)}">
          <div>
            <h3>${escapeHtml(set.title)} ${active} ${archiveStatus}</h3>
            <p>${escapeHtml(set.description || "No description.")}</p>
            <p class="source-line">${set.imageIds.length} case${set.imageIds.length === 1 ? "" : "s"} | ID: ${escapeHtml(set.id)}</p>
          </div>
          <div class="button-row">
            <button class="secondary-button compact-button" type="button" data-action="edit-question-set">Edit</button>
            <button class="primary-button compact-button" type="button" data-action="activate-question-set">Use</button>
            <button class="danger-button compact-button" type="button" data-action="delete-question-set">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function getCuratorSelectedImageIds() {
  return $$("#curatorQuestionImagePicker input[type='checkbox']:checked").map((input) => input.value);
}

function updateCuratorQuestionSetCount() {
  const label = $("#curatorQuestionSetCount");
  if (label) {
    const count = getCuratorSelectedImageIds().length;
    label.textContent = `${count} selected`;
  }
}

function clearCuratorQuestionSetForm() {
  setInputValue("#curatorQuestionSetTitle", "");
  setInputValue("#curatorQuestionSetId", "");
  setInputValue("#curatorQuestionSetDescription", "");
  if ($("#curatorQuestionSetPublic")) {
    $("#curatorQuestionSetPublic").checked = true;
  }
  renderCuratorQuestionImagePicker(adminState.images, []);
  const status = $("#curatorQuestionSetStatus");
  if (status) {
    status.textContent = "";
  }
}

function loadCuratorQuestionSetIntoForm(setId) {
  const set = adminState.questionSets.find((entry) => entry.id === setId);
  if (!set) {
    return;
  }

  setInputValue("#curatorQuestionSetTitle", set.title);
  setInputValue("#curatorQuestionSetId", set.id);
  setInputValue("#curatorQuestionSetDescription", set.description);
  if ($("#curatorQuestionSetPublic")) {
    $("#curatorQuestionSetPublic").checked = set.isPublic;
  }
  renderCuratorQuestionImagePicker(adminState.images, set.imageIds);
  $("#curatorQuestionSetStatus").textContent = `Editing "${set.title}".`;
}

async function saveCuratorQuestionSet(event) {
  event.preventDefault();

  const client = getSupabaseClient();
  const status = $("#curatorQuestionSetStatus");
  const title = cleanString($("#curatorQuestionSetTitle")?.value);
  const id = slugify($("#curatorQuestionSetId")?.value || title);
  const description = cleanString($("#curatorQuestionSetDescription")?.value);
  const imageIds = getCuratorSelectedImageIds();
  const isPublic = $("#curatorQuestionSetPublic")?.checked !== false;

  if (!title || !id) {
    status.textContent = "Add a set title first.";
    return;
  }
  if (imageIds.length === 0) {
    status.textContent = "Choose at least one approved case for this set.";
    return;
  }

  status.textContent = "Saving question set...";
  const { error } = await client.from("question_sets").upsert({
    id,
    title,
    description: description || null,
    image_ids: imageIds,
    is_public: isPublic,
  });

  if (error) {
    status.textContent = `Could not save question set: ${formatSupabaseError(error)}. Run migration 005_daily_challenges_and_archive.sql if needed.`;
    return;
  }

  status.textContent = `Saved "${title}".`;
  await refreshCuratorDashboard();
  loadCuratorQuestionSetIntoForm(id);
}

async function saveCuratorActiveSet() {
  const select = $("#curatorActiveQuestionSet");
  const status = $("#curatorQuestionSetStatus");
  const activeSetId = cleanString(select?.value) || "all";
  const activeSetName = cleanString($("#curatorActiveQuestionSetName")?.value) || getCuratorActiveSetDefaultName(activeSetId);
  const roundsPerGame = getConfiguredRoundCount({ roundsPerGame: $("#curatorRoundsPerGame")?.value });
  await savePublicSettingsPatch({ activeSetId, activeSetName, roundsPerGame });
  status.textContent = `Public game now uses "${activeSetName}" with ${roundsPerGame} question${roundsPerGame === 1 ? "" : "s"} per game.`;
  await refreshCuratorDashboard();
}

function updateCuratorActiveSetNameFromSelection() {
  const select = $("#curatorActiveQuestionSet");
  const activeSetId = cleanString(select?.value) || "all";
  setInputValue("#curatorActiveQuestionSetName", getCuratorActiveSetDefaultName(activeSetId));
}

function getCuratorActiveSetDefaultName(activeSetId) {
  if (!activeSetId || activeSetId === "all") {
    return "All published cases";
  }

  const set = adminState.questionSets.find((entry) => entry.id === activeSetId);
  return set?.title || "Selected set";
}

async function handleCuratorQuestionSetAction(event) {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-curator-question-set-id]");
  if (!button || !card) {
    return;
  }

  const setId = card.dataset.curatorQuestionSetId;
  if (button.dataset.action === "edit-question-set") {
    loadCuratorQuestionSetIntoForm(setId);
  }
  if (button.dataset.action === "activate-question-set") {
    const select = $("#curatorActiveQuestionSet");
    if (select) {
      select.value = setId;
      updateCuratorActiveSetNameFromSelection();
    }
    await saveCuratorActiveSet();
  }
  if (button.dataset.action === "delete-question-set") {
    await deleteCuratorQuestionSet(setId);
  }
}

async function deleteCuratorQuestionSet(setId) {
  const set = adminState.questionSets.find((entry) => entry.id === setId);
  if (!set || !window.confirm(`Delete question set "${set.title}"?`)) {
    return;
  }

  const client = getSupabaseClient();
  const { error } = await client.from("question_sets").delete().eq("id", setId);
  if (error) {
    $("#curatorQuestionSetStatus").textContent = formatSupabaseError(error);
    return;
  }

  if (readPublicGameSettings().activeSetId === setId) {
    await savePublicSettingsPatch({ activeSetId: "all", activeSetName: "All published cases" });
  }

  clearCuratorQuestionSetForm();
  $("#curatorQuestionSetStatus").textContent = "Question set deleted.";
  await refreshCuratorDashboard();
}

function renderCuratorDailyChallenges(images, sets, challenges) {
  const sourceSelect = $("#curatorDailySourceSet");
  if (sourceSelect) {
    const currentValue = sourceSelect.value;
    sourceSelect.innerHTML = [
      `<option value="all">All approved cases</option>`,
      ...sets.map((set) => `<option value="${escapeAttribute(set.id)}">${escapeHtml(set.title)} (${set.imageIds.length})</option>`),
    ].join("");
    sourceSelect.value = sets.some((set) => set.id === currentValue) ? currentValue : "all";
  }

  if (!$("#curatorDailyDate")?.value) {
    clearCuratorDailyChallengeForm();
  }

  const container = $("#curatorDailyChallengeList");
  if (!container) {
    return;
  }

  if (challenges.length === 0) {
    container.innerHTML = `
      <div class="archive-empty-row">
        <strong>No dated challenges published</strong>
        <span>Use the form above after running migration 005.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = challenges
    .map((challenge) => {
      const sourceSet = sets.find((set) => set.id === challenge.questionSetId);
      return `
        <article class="daily-challenge-row" data-curator-daily-date="${escapeAttribute(challenge.date)}">
          <time datetime="${escapeAttribute(challenge.date)}">${escapeHtml(formatArchiveDate(challenge.date))}</time>
          <div>
            <strong>${escapeHtml(challenge.title)}</strong>
            <small>${challenge.imageIds.length} cases${sourceSet ? ` | ${escapeHtml(sourceSet.title)}` : ""}</small>
          </div>
          <span class="status-pill">${challenge.published ? "Published" : "Hidden"}</span>
          <div class="button-row">
            <button class="secondary-button compact-button" type="button" data-action="edit-daily">Edit</button>
            <button class="secondary-button compact-button" type="button" data-action="toggle-daily">${challenge.published ? "Hide" : "Publish"}</button>
            <button class="danger-button compact-button" type="button" data-action="delete-daily">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function clearCuratorDailyChallengeForm() {
  setInputValue("#curatorDailyDate", getLocalDateKey());
  setInputValue("#curatorDailyTitle", "Daily Challenge");
  setInputValue("#curatorDailyRoundCount", getConfiguredRoundCount(readPublicGameSettings()));
  if ($("#curatorDailySourceSet")) {
    $("#curatorDailySourceSet").value = "all";
  }
  if ($("#curatorDailyChallengeStatus")) {
    $("#curatorDailyChallengeStatus").textContent = "";
  }
}

async function saveCuratorDailyChallenge(event) {
  event.preventDefault();
  const status = $("#curatorDailyChallengeStatus");
  const date = cleanString($("#curatorDailyDate")?.value);
  const title = cleanString($("#curatorDailyTitle")?.value) || "Daily Challenge";
  const sourceSetId = cleanString($("#curatorDailySourceSet")?.value) || "all";
  const requestedCount = getConfiguredRoundCount({ roundsPerGame: $("#curatorDailyRoundCount")?.value });
  const approvedIds = new Set(adminState.images.filter((image) => image.approved).map((image) => String(image.id)));
  const sourceSet = sourceSetId === "all"
    ? null
    : adminState.questionSets.find((set) => set.id === sourceSetId);
  const candidateIds = (sourceSet ? sourceSet.imageIds : [...approvedIds])
    .map(String)
    .filter((id) => approvedIds.has(id));

  if (!date) {
    status.textContent = "Choose a challenge date.";
    return;
  }
  if (candidateIds.length === 0) {
    status.textContent = "The selected source has no approved cases.";
    return;
  }

  const existing = adminState.dailyChallenges.find((challenge) => challenge.date === date);
  if (existing && !window.confirm(`Replace the dated challenge for ${formatArchiveDate(date)}?`)) {
    return;
  }

  const imageIds = seededShuffle([...candidateIds], `daily:${date}:${sourceSetId}`).slice(0, requestedCount);
  status.textContent = "Publishing dated challenge...";
  const client = getSupabaseClient();
  const { error } = await client.from("daily_challenges").upsert({
    challenge_date: date,
    title,
    image_ids: imageIds,
    question_set_id: sourceSet?.id || null,
    round_count: imageIds.length,
    published: true,
  });

  if (error) {
    status.textContent = `Could not publish: ${formatSupabaseError(error)}. Run migration 005_daily_challenges_and_archive.sql first.`;
    return;
  }

  status.textContent = `Published ${imageIds.length} stable case${imageIds.length === 1 ? "" : "s"} for ${formatArchiveDate(date)}.`;
  await loadCuratorDashboard();
}

function loadCuratorDailyChallengeIntoForm(date) {
  const challenge = adminState.dailyChallenges.find((entry) => entry.date === date);
  if (!challenge) {
    return;
  }
  setInputValue("#curatorDailyDate", challenge.date);
  setInputValue("#curatorDailyTitle", challenge.title);
  setInputValue("#curatorDailyRoundCount", challenge.roundCount);
  if ($("#curatorDailySourceSet")) {
    $("#curatorDailySourceSet").value = challenge.questionSetId || "all";
  }
  $("#curatorDailyChallengeStatus").textContent = `Editing ${formatArchiveDate(challenge.date)}.`;
}

async function handleCuratorDailyChallengeAction(event) {
  const button = event.target.closest("button[data-action]");
  const row = event.target.closest("[data-curator-daily-date]");
  if (!button || !row) {
    return;
  }

  const date = row.dataset.curatorDailyDate;
  const challenge = adminState.dailyChallenges.find((entry) => entry.date === date);
  if (!challenge) {
    return;
  }

  if (button.dataset.action === "edit-daily") {
    loadCuratorDailyChallengeIntoForm(date);
    return;
  }

  const client = getSupabaseClient();
  if (button.dataset.action === "toggle-daily") {
    const { error } = await client
      .from("daily_challenges")
      .update({ published: !challenge.published })
      .eq("challenge_date", date);
    $("#curatorDailyChallengeStatus").textContent = error
      ? formatSupabaseError(error)
      : `${formatArchiveDate(date)} is now ${challenge.published ? "hidden" : "published"}.`;
    if (!error) {
      await loadCuratorDashboard();
    }
  }

  if (button.dataset.action === "delete-daily") {
    if (!window.confirm(`Delete the dated challenge for ${formatArchiveDate(date)}?`)) {
      return;
    }
    const { error } = await client.from("daily_challenges").delete().eq("challenge_date", date);
    $("#curatorDailyChallengeStatus").textContent = error ? formatSupabaseError(error) : "Dated challenge deleted.";
    if (!error) {
      await loadCuratorDashboard();
    }
  }
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
  const isResearchCandidate = cleanString(entry.submitter_name) === "Chronoscope Research Assistant";

  return `
    <article class="curator-card" data-curator-submission-id="${escapeAttribute(entry.id)}">
      <div class="curator-preview">
        <img src="${escapeAttribute(safeImageUrl(entry.image_url))}" alt="${escapeAttribute(entry.title || "Submitted image")}" />
        <span class="status-pill">${escapeHtml(entry.status || "pending")}</span>
        ${isResearchCandidate ? '<span class="status-pill research-status-pill">Research candidate</span>' : ""}
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
        ${
          isResearchCandidate
            ? '<p class="research-review-note"><strong>Curator check:</strong> confirm the pin, exact year, direct image, and reuse rights against the dossier before publishing.</p>'
            : ""
        }
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
            : `<div class="button-row curator-actions">
                <button class="danger-button" type="button" data-action="delete-rejected-submission">Delete Rejected Submission</button>
              </div>`
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
  const editTags = Array.isArray(row.tags) ? row.tags.join(", ") : "";
  const searchText = [row.title, row.location_name, year, editTags, row.source]
    .map(cleanString)
    .join(" ")
    .toLowerCase();
  return `
    <details class="curator-image-row" data-curator-image-id="${escapeAttribute(row.id)}" data-search="${escapeAttribute(searchText)}">
      <summary>
        <img src="${escapeAttribute(safeImageUrl(row.image_url))}" alt="" />
        <span class="curator-image-summary">
          <strong>${escapeHtml(row.title || "Untitled image")}</strong>
          <small>${escapeHtml(row.location_name || "No location")}</small>
        </span>
        <time>${escapeHtml(year || "Unknown date")}</time>
        <span class="status-pill">${row.approved ? "Published" : "Hidden"}</span>
        <span class="curator-row-disclosure">Edit</span>
      </summary>
      <div class="curator-image-editor">
        <form class="curator-edit-grid" data-curator-image-form="${escapeAttribute(row.id)}">
          ${renderCuratorInput("Title", "title", row.title, "input", true)}
          ${renderCuratorInput("Image URL", "image_url", row.image_url, "input", true)}
          ${renderCuratorInput("Location name", "location_name", row.location_name, "input", true)}
          ${renderCuratorInput("Latitude", "lat", row.lat, "number", true)}
          ${renderCuratorInput("Longitude", "lng", row.lng, "number", true)}
          ${renderCuratorInput("Year", "year", row.year, "number", true)}
          ${renderCuratorInput("Year range", "year_range", row.year_range)}
          ${renderCuratorInput("Difficulty", "difficulty", row.difficulty || "medium")}
          ${renderCuratorInput("Tags", "tags", editTags)}
          ${renderCuratorInput("Source", "source", row.source)}
          ${renderCuratorInput("Rights", "rights", row.rights)}
          ${renderCuratorInput("Case note", "case_note", row.case_note, "textarea")}
          ${renderCuratorInput("Historical Record", "historical_record", row.historical_record, "textarea")}
        </form>
        <div class="button-row curator-actions">
          <button class="primary-button" type="button" data-action="save-image">Save Changes</button>
          <button class="secondary-button" type="button" data-action="toggle-image">${row.approved ? "Unpublish" : "Publish"}</button>
          <button class="danger-button" type="button" data-action="delete-image">Delete</button>
        </div>
      </div>
    </details>
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
  if (action === "delete-rejected-submission") {
    await deleteRejectedSubmission(submissionId);
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
  if (button.dataset.action === "save-image") {
    await saveCuratorImage(imageId);
  }
  if (button.dataset.action === "toggle-image") {
    await toggleCuratorImage(imageId, button.textContent.trim() === "Unpublish");
  }
  if (button.dataset.action === "delete-image") {
    await deleteCuratorImage(imageId);
  }
}

async function saveCuratorImage(imageId) {
  const client = getSupabaseClient();
  const values = readCuratorImageFormValues(imageId);
  const validationError = validateCuratorImageValues(values);
  if (validationError) {
    $("#curatorStatus").textContent = validationError;
    return;
  }

  const updateRow = mapCuratorValuesToImageUpdate(values);
  let { error } = await client
    .from("images")
    .update(updateRow)
    .eq("id", imageId);

  if (error && isMissingColumnError(error, "updated_at")) {
    delete updateRow.updated_at;
    ({ error } = await client
      .from("images")
      .update(updateRow)
      .eq("id", imageId));
  }

  if (error) {
    $("#curatorStatus").textContent = formatSupabaseError(error);
    return;
  }

  $("#curatorStatus").textContent = "Published case updated.";
  await loadCuratorDashboard();
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

async function deleteRejectedSubmission(submissionId) {
  if (!window.confirm("Delete this rejected submission? This cannot be undone.")) {
    return;
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from("submissions")
    .delete()
    .eq("id", submissionId)
    .eq("status", "rejected");

  if (error) {
    $("#curatorStatus").textContent = formatSupabaseError(error);
    return;
  }

  $("#curatorStatus").textContent = "Rejected submission deleted.";
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
  return readCuratorValuesFromForm(form);
}

function readCuratorImageFormValues(imageId) {
  const form = $(`[data-curator-image-form="${cssEscape(imageId)}"]`);
  return readCuratorValuesFromForm(form);
}

function getEmptyCuratorValues() {
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

function readCuratorValuesFromForm(form) {
  if (!form) {
    return getEmptyCuratorValues();
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

function mapCuratorValuesToImageUpdate(values) {
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
    updated_at: new Date().toISOString(),
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
    heroBackground: settings.heroBackground || DEFAULT_HERO_BACKGROUND,
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
          <p>Use the public Submit an Image page to generate a local review entry.</p>
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
      <label>Year<input data-edit-field="year" type="number" min="-3000" max="2100" step="1" value="${escapeAttribute(String(normalized.year))}" /></label>
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

function readPublicGameSettings() {
  return normalizeOwnerSettings({
    ...DEFAULT_OWNER_SETTINGS,
    ...state.publicSettings,
    includeApprovedLocal: false,
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
    activeSetName: cleanString(merged.activeSetName) || "All published cases",
    includeApprovedLocal: Boolean(merged.includeApprovedLocal),
    randomizeRounds: merged.randomizeRounds !== false,
    heroBackground: cleanString(merged.heroBackground) || DEFAULT_HERO_BACKGROUND,
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
  const percent = scorePercentage(score, maxScore);
  if (percent >= 88) return "Master of the Archive";
  if (percent >= 72) return "Excellent Chronoscopist";
  if (percent >= 52) return "Promising Detective";
  if (percent >= 32) return "Curious Traveller";
  return "Lost in the Archives";
}

function scorePercentage(score, maxScore) {
  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

function seededShuffle(items, seedKey) {
  const random = mulberry32(hashString(seedKey));
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function selectDailyRoundPool(images, roundCount, settings) {
  if (settings.randomizeRounds === false) {
    return [...images];
  }

  const seedKey = getDailySeedKey();
  const supabaseImages = images.filter((image) => image.dataOrigin === "supabase");
  const fallbackImages = images.filter((image) => image.dataOrigin !== "supabase");

  if (supabaseImages.length === 0) {
    return seededShuffle([...images], seedKey);
  }

  const publishedTodayPool = sortByNewestPublication(supabaseImages).slice(0, roundCount);
  const remainingSlots = Math.max(0, roundCount - publishedTodayPool.length);
  const fillerPool = seededShuffle([...fallbackImages], `${seedKey}:fallback`).slice(0, remainingSlots);

  return [...publishedTodayPool, ...fillerPool];
}

function sortByNewestPublication(images) {
  return [...images].sort((a, b) => {
    const bTime = Date.parse(b.createdAt || b.approvedAt || "") || 0;
    const aTime = Date.parse(a.createdAt || a.approvedAt || "") || 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return String(a.title).localeCompare(String(b.title));
  });
}

function getDailySeedKey() {
  return getLocalDateKey();
}

function getLocalDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

function mergePublicImageData(supabaseImages, jsonImages) {
  const merged = [];
  [...supabaseImages, ...jsonImages].forEach((image) => {
    const normalized = normalizeImageEntry(image);
    if (!isPlayableImage(normalized) || merged.some((entry) => entry.id === normalized.id)) {
      return;
    }
    merged.push(normalized);
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

function formatAdminDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Date unknown";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate.toFixed(3) : "n/a";
}

function formatPreciseCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate.toFixed(5) : "n/a";
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
  return EMPTY_IMAGE_PLACEHOLDER;
}

function extractHttpsUrls(value) {
  const matches = String(value || "").match(/https:\/\/[^\s|]+/g) || [];
  return [...new Set(
    matches
      .map((url) => url.replace(/[),.;]+$/g, ""))
      .filter((url) => {
        try {
          return new URL(url).protocol === "https:";
        } catch (error) {
          return false;
        }
      })
  )];
}

function stripUrlsFromText(value) {
  return cleanString(
    String(value || "")
      .replace(/https:\/\/[^\s|]+/g, "")
      .replace(/Evidence:\s*/gi, " ")
      .replace(/\s*\|\s*/g, " · ")
      .replace(/(?:\s*·\s*)+$/g, "")
  );
}

function formatSourceLinkLabel(url, index) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return `${index === 0 ? "Collection record" : `Source ${index + 1}`} · ${hostname}`;
  } catch (error) {
    return `Source ${index + 1}`;
  }
}

function capitalizeWord(value) {
  const text = cleanString(value);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Not assigned";
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

function setInputValue(selector, value) {
  const input = $(selector);
  if (input) {
    input.value = cleanString(value);
  }
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
