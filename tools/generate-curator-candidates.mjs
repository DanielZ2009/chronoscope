#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const DEFAULT_SUPABASE_URL = "https://ryofasvrzvdhgaaerhqb.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_XjqOxlNCTFKO_kGnRHmdPQ_2q8pyxbq";
const GENERATOR_VERSION = "chronoscope-curator-v1";
const TARGET_COUNT = clampInteger(process.env.CANDIDATE_COUNT, 1, 20, 10);
const DRY_RUN = process.env.DRY_RUN === "true";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6";
const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const IMPORT_PATH = getImportPath(process.argv.slice(2));

const TRUSTED_DOMAINS = [
  "loc.gov",
  "archives.gov",
  "si.edu",
  "metmuseum.org",
  "artic.edu",
  "nga.gov",
  "musee-orsay.fr",
  "krollermuller.nl",
  "nationalgallery.org.uk",
  "rijksmuseum.nl",
  "europeana.eu",
  "bnf.fr",
  "gallica.bnf.fr",
  "bl.uk",
  "sl.nsw.gov.au",
  "nla.gov.au",
  "awm.gov.au",
  "iwm.org.uk",
  "getty.edu",
  "harvardartmuseums.org",
  "clevelandart.org",
  "nypl.org",
  "jreast.co.jp",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
];

const candidateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "image_url",
    "location_name",
    "lat",
    "lng",
    "year",
    "year_range",
    "case_note",
    "historical_record",
    "source",
    "rights",
    "difficulty",
    "tags",
    "date_evidence",
    "location_evidence",
    "image_evidence",
    "source_urls",
    "location_precision",
    "date_precision",
    "year_basis",
    "date_confidence",
    "location_confidence",
    "rights_confidence",
  ],
  properties: {
    title: { type: "string", minLength: 4, maxLength: 140 },
    image_url: { type: "string", minLength: 12 },
    location_name: { type: "string", minLength: 4, maxLength: 180 },
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
    year: { type: "integer", minimum: -3000, maximum: 2100 },
    year_range: { type: "string", minLength: 1, maxLength: 80 },
    case_note: { type: "string", maxLength: 320 },
    historical_record: { type: "string", minLength: 80, maxLength: 900 },
    source: { type: "string", minLength: 12, maxLength: 900 },
    rights: { type: "string", minLength: 8, maxLength: 500 },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    tags: { type: "array", minItems: 2, maxItems: 10, items: { type: "string" } },
    date_evidence: { type: "string", minLength: 20, maxLength: 700 },
    location_evidence: { type: "string", minLength: 20, maxLength: 700 },
    image_evidence: { type: "string", minLength: 20, maxLength: 700 },
    source_urls: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: { type: "string", minLength: 12 },
    },
    location_precision: {
      type: "string",
      enum: ["camera_position", "event_site", "landmark", "street_segment"],
    },
    date_precision: { type: "string", enum: ["exact_day", "exact_year"] },
    year_basis: { type: "string", enum: ["exposure", "event", "artwork_creation"] },
    date_confidence: { type: "number", minimum: 0, maximum: 1 },
    location_confidence: { type: "number", minimum: 0, maximum: 1 },
    rights_confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

async function main() {
  const existing = await loadExistingApprovedCases();
  let candidates;

  if (IMPORT_PATH) {
    candidates = JSON.parse(await readFile(IMPORT_PATH, "utf8"));
    if (!Array.isArray(candidates)) {
      throw new Error("The imported pilot file must contain a JSON array.");
    }
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for automated research runs.");
    }
    candidates = await researchCandidates(apiKey, existing);
  }

  const accepted = [];
  const rejected = [];
  const seen = new Set(existing.map((entry) => normalizeKey(`${entry.title}|${entry.source || ""}`)));

  for (const rawCandidate of candidates) {
    const candidate = normalizeCandidate(rawCandidate);
    const validation = validateCandidate(candidate);
    const key = normalizeKey(`${candidate.title}|${candidate.source_urls[0] || candidate.source}`);

    if (validation.length) {
      rejected.push({ title: candidate.title || "Untitled", reason: validation.join("; ") });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ title: candidate.title, reason: "duplicate of an existing or same-run case" });
      continue;
    }

    const imageCheck = await verifyImageUrl(candidate.image_url);
    await delay(300);
    if (!imageCheck.ok) {
      rejected.push({ title: candidate.title, reason: imageCheck.reason });
      continue;
    }

    seen.add(key);
    accepted.push(candidate);
    if (accepted.length >= TARGET_COUNT) {
      break;
    }
  }

  if (accepted.length < TARGET_COUNT) {
    throw new Error(
      `Only ${accepted.length} of ${TARGET_COUNT} candidates passed validation. ` +
        `Rejected: ${rejected.map((entry) => `${entry.title}: ${entry.reason}`).join(" | ")}`
    );
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({ accepted, rejected }, null, 2));
    return;
  }

  const inserted = [];
  const duplicates = [];
  for (const candidate of accepted) {
    const result = await insertPendingCandidate(candidate);
    if (result.duplicate) {
      duplicates.push(candidate.title);
    } else {
      inserted.push(candidate.title);
    }
  }

  console.log(
    JSON.stringify(
      {
        generator: GENERATOR_VERSION,
        requested: TARGET_COUNT,
        inserted,
        duplicates,
        rejected,
      },
      null,
      2
    )
  );
}

async function researchCandidates(apiKey, existing) {
  const discoveryCount = Math.min(24, TARGET_COUNT + 8);
  const discovery = await createResponse(apiKey, {
    model: MODEL,
    store: false,
    reasoning: { effort: "high" },
    max_output_tokens: 20000,
    max_tool_calls: 30,
    include: ["web_search_call.action.sources"],
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
        filters: { allowed_domains: TRUSTED_DOMAINS },
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "chronoscope_candidate_discovery",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["candidates"],
          properties: {
            candidates: {
              type: "array",
              minItems: discoveryCount,
              maxItems: discoveryCount,
              items: candidateSchema,
            },
          },
        },
      },
    },
    instructions: buildResearchInstructions(discoveryCount, existing),
    input: `Research ${discoveryCount} possible Chronoscope cases for ${new Date().toISOString().slice(0, 10)}.`,
  });

  const provisional = parseResponseJson(discovery).candidates || [];
  const audited = await mapWithConcurrency(provisional, 3, async (candidate) => {
    const audit = await auditCandidate(apiKey, candidate);
    return audit.accepted ? audit.candidate : null;
  });

  return audited.filter(Boolean);
}

async function auditCandidate(apiKey, candidate) {
  const response = await createResponse(apiKey, {
    model: MODEL,
    store: false,
    reasoning: { effort: "high" },
    max_output_tokens: 6000,
    max_tool_calls: 12,
    include: ["web_search_call.action.sources"],
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
        filters: { allowed_domains: TRUSTED_DOMAINS },
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "chronoscope_candidate_audit",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["accepted", "rejection_reason", "candidate"],
          properties: {
            accepted: { type: "boolean" },
            rejection_reason: { type: ["string", "null"] },
            candidate: candidateSchema,
          },
        },
      },
    },
    instructions: buildAuditInstructions(),
    input: JSON.stringify(candidate),
  });

  return parseResponseJson(response);
}

function buildResearchInstructions(count, existing) {
  const existingList = existing
    .slice(0, 100)
    .map((entry) => `- ${entry.title}${entry.source ? ` | ${entry.source}` : ""}`)
    .join("\n");

  return `You are the research desk for Chronoscope, a historical image geolocation game.

Find ${count} diverse historical photographs or representational paintings. Every candidate must support a fair 5,000-point answer: one defensible map pin and one defensible exact year.

Strict acceptance rules:
- The depicted place must resolve to a camera position, event site, named landmark, or short street segment. City-only, region-only, battlefield-wide, aerial-route, and speculative locations are forbidden.
- The date must be an exact calendar year stated by a primary archive or museum. Reject circa, approximate, ranges, inferred decades, disputed dates, and undated images.
- For paintings, use the artwork's creation year only when the museum identifies the depicted place precisely. Do not pretend the scene records an exact day unless the institution says so.
- Use at least one primary archive or museum record for the date/place and a separate reliable source for coordinates or corroboration.
- image_url must be a direct, publicly loadable image URL and rights must permit educational display. Prefer public domain, CC0, CC BY, or CC BY-SA.
- Explain what visible evidence could lead a careful player toward the answer without revealing it in case_note.
- historical_record must be 2-4 concise sentences and explain why the image matters.
- Search beyond famous Western examples. Balance regions, centuries, media, architecture, transport, public life, religion, conflict, and technology.
- If any required fact cannot be established, discard that candidate and find another. Never fill a field by guessing.
- Confidence scores must measure documentary evidence, not familiarity. Only return candidates at or above 0.90 for date, location, and rights.

Existing published cases to avoid:
${existingList || "- None returned by the public database."}`;
}

function buildAuditInstructions() {
  return `Act as a skeptical senior museum cataloguer auditing one proposed Chronoscope case.

Independently open the cited records and search for corroboration. Correct fields only when sources support the correction. Accept only if all are true:
1. An archive or museum explicitly supports one exact year with no circa/range ambiguity.
2. The image depicts a point-like place suitable for a world-map pin; the coordinates fall on that precise site.
3. The direct image URL loads and corresponds to the cited record.
4. Rights permit public educational display and the rights statement is specific.
5. The historical record is accurate, short, and source-grounded.

Reject disputed reconstructions, generic city views without an identifiable site, images whose date comes only from a filename, and famous claims repeated without a primary record. When rejected, keep the candidate object schema valid but set accepted=false and state the precise reason.`;
}

async function createResponse(apiKey, body) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI response failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

function parseResponseJson(response) {
  const outputText = (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");

  if (!outputText) {
    throw new Error(`OpenAI returned no structured text. Status: ${response.status || "unknown"}`);
  }
  return JSON.parse(outputText);
}

async function loadExistingApprovedCases() {
  const url = `${SUPABASE_URL}/rest/v1/images?select=title,source&approved=eq.true&limit=500`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    console.warn(`Could not load existing cases (${response.status}); duplicate checks will use database constraints.`);
    return [];
  }
  return response.json();
}

async function insertPendingCandidate(candidate) {
  const row = {
    title: candidate.title,
    image_url: candidate.image_url,
    location_name: candidate.location_name,
    lat: candidate.lat,
    lng: candidate.lng,
    year: candidate.year,
    year_range: candidate.year_range,
    case_note: candidate.case_note || null,
    historical_record: candidate.historical_record,
    source: `${candidate.source}\nEvidence: ${candidate.source_urls.join(" | ")}`,
    rights: candidate.rights,
    submitter_name: "Chronoscope Research Assistant",
    submitter_contact: null,
    status: "pending",
    difficulty: candidate.difficulty,
    tags: candidate.tags,
    admin_notes: buildResearchDossier(candidate),
    submission_key: buildSubmissionKey(candidate),
  };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (response.status === 409) {
    return { duplicate: true };
  }
  if (!response.ok) {
    throw new Error(`Supabase insert failed for "${candidate.title}" (${response.status}): ${await response.text()}`);
  }
  return { duplicate: false };
}

function buildResearchDossier(candidate) {
  return [
    "AUTOMATED RESEARCH CANDIDATE - OWNER VERIFICATION REQUIRED",
    `Generator: ${GENERATOR_VERSION}`,
    `Date evidence (${formatConfidence(candidate.date_confidence)}): ${candidate.date_evidence}`,
    `Location evidence (${formatConfidence(candidate.location_confidence)}; ${candidate.location_precision}): ${candidate.location_evidence}`,
    `Image evidence: ${candidate.image_evidence}`,
    `Rights confidence (${formatConfidence(candidate.rights_confidence)}): ${candidate.rights}`,
    `Year basis: ${candidate.year_basis}; date precision: ${candidate.date_precision}`,
    `Sources: ${candidate.source_urls.join(" | ")}`,
    "Decision rule: reject if the exact depicted place, exact year, image identity, or reuse rights cannot be independently confirmed.",
  ].join("\n\n");
}

function normalizeCandidate(candidate = {}) {
  return {
    title: cleanString(candidate.title),
    image_url: cleanUrl(candidate.image_url),
    location_name: cleanString(candidate.location_name),
    lat: Number(candidate.lat),
    lng: Number(candidate.lng),
    year: Number(candidate.year),
    year_range: cleanString(candidate.year_range),
    case_note: cleanString(candidate.case_note),
    historical_record: cleanString(candidate.historical_record),
    source: cleanString(candidate.source),
    rights: cleanString(candidate.rights),
    difficulty: ["easy", "medium", "hard"].includes(candidate.difficulty) ? candidate.difficulty : "medium",
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(cleanString).filter(Boolean).slice(0, 10) : [],
    date_evidence: cleanString(candidate.date_evidence),
    location_evidence: cleanString(candidate.location_evidence),
    image_evidence: cleanString(candidate.image_evidence),
    source_urls: Array.isArray(candidate.source_urls)
      ? candidate.source_urls.map(cleanUrl).filter(Boolean).slice(0, 8)
      : [],
    location_precision: cleanString(candidate.location_precision),
    date_precision: cleanString(candidate.date_precision),
    year_basis: cleanString(candidate.year_basis),
    date_confidence: Number(candidate.date_confidence),
    location_confidence: Number(candidate.location_confidence),
    rights_confidence: Number(candidate.rights_confidence),
  };
}

function validateCandidate(candidate) {
  const problems = [];
  if (!candidate.title || !candidate.image_url || !candidate.location_name) problems.push("missing required identity fields");
  if (!Number.isFinite(candidate.lat) || candidate.lat < -90 || candidate.lat > 90) problems.push("invalid latitude");
  if (!Number.isFinite(candidate.lng) || candidate.lng < -180 || candidate.lng > 180) problems.push("invalid longitude");
  if (!Number.isInteger(candidate.year) || candidate.year < -3000 || candidate.year > 2100) problems.push("invalid year");
  if (!["exact_day", "exact_year"].includes(candidate.date_precision)) problems.push("date is not exact");
  if (!["camera_position", "event_site", "landmark", "street_segment"].includes(candidate.location_precision)) {
    problems.push("location is not point-like");
  }
  if (candidate.date_confidence < 0.9) problems.push("date confidence below 90%");
  if (candidate.location_confidence < 0.9) problems.push("location confidence below 90%");
  if (candidate.rights_confidence < 0.9) problems.push("rights confidence below 90%");
  if (candidate.source_urls.length < 2) problems.push("fewer than two evidence URLs");
  if (!candidate.source_urls.some(isTrustedUrl)) problems.push("no trusted archive or museum URL");
  if (!candidate.historical_record || candidate.historical_record.length < 80) problems.push("historical record too thin");
  if (!candidate.rights) problems.push("missing rights statement");
  if (/\b(circa|c\.|about|approx(?:imate(?:ly)?)?|between)\b/i.test(candidate.year_range)) {
    problems.push("year range contains approximate language");
  }
  return problems;
}

async function verifyImageUrl(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "image/*",
          Range: "bytes=0-2047",
          "User-Agent": "ChronoscopeCurator/1.0 (https://chronoscope.world)",
        },
      });
      const contentType = String(response.headers.get("content-type") || "");
      if (response.ok && contentType.startsWith("image/")) {
        return { ok: true };
      }
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1200 * 2 ** attempt);
        continue;
      }
      return { ok: false, reason: `image URL did not return image content (${response.status} ${contentType || "unknown type"})` };
    } catch (error) {
      if (attempt < 3) {
        await delay(1200 * 2 ** attempt);
        continue;
      }
      return { ok: false, reason: `image URL check failed: ${error.message}` };
    }
  }
  return { ok: false, reason: "image URL check exhausted all retries" };
}

function isTrustedUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return TRUSTED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function buildSubmissionKey(candidate) {
  const fingerprint = [candidate.title, candidate.year, candidate.source_urls[0] || candidate.source]
    .map(normalizeKey)
    .join("|");
  return `${GENERATOR_VERSION}:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 40)}`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        console.warn(`Audit ${index + 1} failed: ${error.message}`);
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function cleanString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUrl(value) {
  const cleaned = String(value ?? "").trim();
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").trim();
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function formatConfidence(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getImportPath(args) {
  const index = args.indexOf("--import");
  return index >= 0 ? args[index + 1] : "";
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
