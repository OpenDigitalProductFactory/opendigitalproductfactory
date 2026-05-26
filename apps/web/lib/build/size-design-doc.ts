// apps/web/lib/build/size-design-doc.ts
//
// Phase 2 of the design-time decomposition rollout.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// Deterministic sizing pass over an approved BuildDesignDoc. Counts structured
// properties of the design and applies thresholds; returns a tri-state decision
// (`ok` | `decompose-recommended` | `decompose-required`) plus an auditable
// breakdown.
//
// **Phase 2 is informational only.** Nothing here enforces decomposition; the
// gate banner, assistant, and child-creation atomicity all land in later
// phases. The score is written to `FeatureBuild.designReview.sizeAssessment`
// and emitted as a `design-size-assessed` BuildActivity row so the rationale
// is visible to the operator before the gate becomes blocking.
//
// **Why deterministic, not LLM-driven.** Per spec §3.1, decomposition gates
// are too important to delegate to a confabulation-prone surface. Counting is
// reproducible; the operator can read "5 models, 25 ACs, 4 multipliers →
// required" without trusting model output. This also feeds the
// reduction-gear calibration loop cleanly — the inputs to the threshold are
// recorded, so per-archetype tuning in a future ring can fit against ground
// truth.
//
// **Calibration anchor.** Default thresholds (5 / 20 / 4 / 7 / 4 for the
// `required` tier) are sized so Dale's truck-parts design (5 models, 25 ACs,
// 4 complexity multipliers, 2 APIs, 2 routes — see spec §1.1) trips three of
// five dimensions at the `required` level. A small-feature design (1-2 models,
// 3-5 ACs) trips zero. Re-calibration will land alongside per-archetype
// tuning in a future phase; for now the thresholds live alongside this code
// and are overridable per call (the eventual PlatformConfig key
// `build-studio-decomposition` will load overrides at the call site).

import type { BuildDesignDoc, SizeAssessmentSnapshot } from "@/lib/explore/feature-build-types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Re-export the canonical SizeAssessment shape from feature-build-types as
// SizeAssessment so callers of sizeDesignDoc and readers of
// designReview.sizeAssessment use the same type. Single source of truth.
export type SizeAssessment = SizeAssessmentSnapshot;

export type SizeDecision = SizeAssessment["decision"];

export type SizeThresholds = SizeAssessment["thresholds"];

export const DEFAULT_SIZE_THRESHOLDS: SizeThresholds = {
  models: { recommend: 3, required: 5 },
  endpoints: { recommend: 4, required: 7 },
  acs: { recommend: 12, required: 20 },
  multipliers: { recommend: 2, required: 4 },
  routes: { recommend: 2, required: 4 },
};

// Derive breakdown / trip shapes from the canonical SizeAssessment type so
// any future change to the snapshot stays consistent across producers and
// consumers (sizeDesignDoc here, ReviewPanel banner in components/build/,
// any future Hive analytics).
export type SizeBreakdown = SizeAssessment["breakdown"];
export type SizeTrip = SizeAssessment["trips"][number];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function sizeDesignDoc(
  doc: BuildDesignDoc | null | undefined,
  overrides: Partial<SizeThresholds> = {},
  now: () => Date = () => new Date(),
): SizeAssessment {
  const thresholds = mergeThresholds(DEFAULT_SIZE_THRESHOLDS, overrides);

  if (!doc) {
    return {
      decision: "ok",
      breakdown: emptyBreakdown(),
      trips: [],
      rationale: "No design doc supplied; size cannot be assessed. Treating as ok by default (Phase 2 is informational).",
      thresholds,
      assessedAt: now().toISOString(),
    };
  }

  const breakdown: SizeBreakdown = {
    models: extractModels(doc),
    endpoints: extractEndpoints(doc),
    acs: { count: (doc.acceptanceCriteria ?? []).length },
    multipliers: extractMultipliers(doc),
    routes: extractRoutes(doc),
  };

  const observations: Record<keyof SizeThresholds, number> = {
    models: breakdown.models.count,
    endpoints: breakdown.endpoints.count,
    acs: breakdown.acs.count,
    multipliers: breakdown.multipliers.count,
    routes: breakdown.routes.count,
  };

  const trips: SizeTrip[] = [];
  let highest: "ok" | "recommend" | "required" = "ok";

  for (const dim of Object.keys(thresholds) as Array<keyof SizeThresholds>) {
    const observed = observations[dim];
    const { recommend, required } = thresholds[dim];
    if (observed >= required) {
      trips.push({ dimension: dim, level: "required", threshold: required, observed });
      highest = "required";
    } else if (observed >= recommend) {
      trips.push({ dimension: dim, level: "recommend", threshold: recommend, observed });
      if (highest === "ok") highest = "recommend";
    }
  }

  const decision: SizeDecision =
    highest === "required"
      ? "decompose-required"
      : highest === "recommend"
        ? "decompose-recommended"
        : "ok";

  return {
    decision,
    breakdown,
    trips,
    rationale: buildRationale(decision, observations, trips, thresholds),
    thresholds,
    assessedAt: now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers — each returns a count and (where useful) sample evidence
// for the audit trail. Heuristics intentionally err toward UNDER-counting on
// ambiguous markdown, so a Phase-2 false positive is rare and a Phase-3 (when
// enforcement lands) operator-facing decompose recommendation is defensible.
// ---------------------------------------------------------------------------

const MODEL_FIELD_PRIORITY: ReadonlyArray<keyof BuildDesignDoc> = [
  "dataModel",
  "proposedApproach",
  "problemStatement",
];

// PascalCase identifier with at least two CamelHumps — captures
// "MobileInventoryLocation", "InventoryItem", but not single-word "Truck".
// Single-word PascalCase nouns (Truck, Part) ARE valid model names but also
// match common English; we prefer precision over recall here, per the
// under-count posture.
const MODEL_IDENTIFIER_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;

// Identifiers that look like model names but aren't — framework names, common
// React/Next/Prisma surface, etc. Extend conservatively; a stopword here
// suppresses a legitimate trip.
const MODEL_STOPLIST = new Set<string>([
  "PrismaClient",
  "NextRequest",
  "NextResponse",
  "ReactNode",
  "JsonValue",
  "InputJsonValue",
  "StatusCode",
  "HttpStatus",
  "ApiResponse",
  "ToolResult",
  "BuildStudio",
  "FeatureBuild",
  "BuildPhase",
  "BuildActivity",
  "DesignDoc",
  "BuildDesignDoc",
  "PostgresError",
  "UseEffect",
  "UseState",
]);

function extractModels(doc: BuildDesignDoc): SizeBreakdown["models"] {
  const sources: string[] = [];
  for (const f of MODEL_FIELD_PRIORITY) {
    const v = doc[f];
    if (typeof v === "string" && v.trim().length > 0) sources.push(v);
  }
  const haystack = sources.join("\n\n");
  const seen = new Set<string>();
  for (const match of haystack.matchAll(MODEL_IDENTIFIER_RE)) {
    const id = match[0];
    if (!MODEL_STOPLIST.has(id)) seen.add(id);
  }
  const samples = Array.from(seen).sort();
  return { count: samples.length, samples };
}

// HTTP-verb + path: "POST /api/inventory/usage", "GET /my-inventory".
// Backtick-wrapped paths are matched separately below.
const HTTP_ENDPOINT_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/:_\-{}]+)/g;
// Backtick-quoted path: "`/api/inventory`".
const BACKTICK_PATH_RE = /`(\/[A-Za-z0-9/:_\-{}]+)`/g;

function extractEndpoints(doc: BuildDesignDoc): SizeBreakdown["endpoints"] {
  const haystack = [doc.proposedApproach, doc.problemStatement, doc.reusePlan]
    .filter((s): s is string => typeof s === "string")
    .join("\n\n");

  const seen = new Set<string>();
  for (const m of haystack.matchAll(HTTP_ENDPOINT_RE)) {
    seen.add(`${m[1]} ${m[2]}`);
  }
  for (const m of haystack.matchAll(BACKTICK_PATH_RE)) {
    const path = m[1]!;
    // Distinguish API endpoints from UI routes: anything containing /api/ or
    // POSTs implied by ending in /:id+action is an endpoint; otherwise let
    // routes handle it. Conservative: count only paths starting with /api/.
    if (path.startsWith("/api/")) seen.add(`* ${path}`);
  }
  const samples = Array.from(seen).sort();
  return { count: samples.length, samples };
}

// UI route — a path that doesn't look like an API endpoint and doesn't start
// with /api/. Matched only inside backticks or after "route"/"page"/"screen"
// keywords to keep noise low.
const ROUTE_KEYWORD_RE = /\b(?:route|page|screen|view)\s*[:=]?\s*`?(\/[A-Za-z0-9/:_\-{}]+)`?/gi;

function extractRoutes(doc: BuildDesignDoc): SizeBreakdown["routes"] {
  const haystack = [doc.proposedApproach, doc.problemStatement, doc.reusePlan]
    .filter((s): s is string => typeof s === "string")
    .join("\n\n");

  const seen = new Set<string>();
  for (const m of haystack.matchAll(ROUTE_KEYWORD_RE)) {
    const path = m[1]!;
    if (path.startsWith("/api/")) continue; // it's an endpoint, not a route
    seen.add(path);
  }
  // Also catch backtick paths that don't start with /api/ — those are likely
  // UI routes if they appear in a section discussing UI surfaces. Be
  // conservative: only count if the parent doc explicitly mentions "UI",
  // "frontend", or "screen" within 200 chars of the match. Cheap proxy: count
  // backtick non-/api/ paths only if the doc contains a UI keyword anywhere.
  const docMentionsUi = /\b(ui|frontend|screen|page|view|mobile-first|dashboard)\b/i.test(haystack);
  if (docMentionsUi) {
    for (const m of haystack.matchAll(BACKTICK_PATH_RE)) {
      const path = m[1]!;
      if (path.startsWith("/api/")) continue;
      seen.add(path);
    }
  }
  const samples = Array.from(seen).sort();
  return { count: samples.length, samples };
}

// Complexity-multiplier keywords. An AC that touches any of these signals a
// known cliff (per spec §3.1 ACs that need idempotency / optimistic locking /
// append-only ledger / multi-tenant isolation / background jobs are each
// known complexity multipliers). Matched case-insensitively against AC text.
const MULTIPLIER_KEYWORDS: ReadonlyArray<{ keyword: string; pattern: RegExp }> = [
  { keyword: "idempotency", pattern: /\bidempoten(?:cy|t|ce)\b/i },
  { keyword: "optimistic-locking", pattern: /\boptimistic\s+lock(?:ing)?\b/i },
  { keyword: "append-only-ledger", pattern: /\bappend[\s-]?only\b|\bledger\b/i },
  { keyword: "multi-tenant", pattern: /\bmulti[\s-]?tenant\b|\bcross[\s-]?tenant\b|\btenant\s+isolation\b/i },
  { keyword: "background-job", pattern: /\bbackground\s+job\b|\bworker\s+queue\b|\binngest\b|\bcron\b/i },
  { keyword: "audit-trail", pattern: /\baudit\s+(?:trail|log)\b/i },
  { keyword: "rate-limit", pattern: /\brate[\s-]?limit\b|\bthrottle\b/i },
];

function extractMultipliers(doc: BuildDesignDoc): SizeBreakdown["multipliers"] {
  const acs = doc.acceptanceCriteria ?? [];
  const matchedKeywords = new Set<string>();
  let acsTouchingMultiplier = 0;
  for (const ac of acs) {
    if (typeof ac !== "string") continue;
    let touched = false;
    for (const { keyword, pattern } of MULTIPLIER_KEYWORDS) {
      if (pattern.test(ac)) {
        matchedKeywords.add(keyword);
        touched = true;
      }
    }
    if (touched) acsTouchingMultiplier += 1;
  }
  return {
    count: acsTouchingMultiplier,
    matchedKeywords: Array.from(matchedKeywords).sort(),
  };
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function mergeThresholds(
  base: SizeThresholds,
  overrides: Partial<SizeThresholds>,
): SizeThresholds {
  return {
    models: { ...base.models, ...overrides.models },
    endpoints: { ...base.endpoints, ...overrides.endpoints },
    acs: { ...base.acs, ...overrides.acs },
    multipliers: { ...base.multipliers, ...overrides.multipliers },
    routes: { ...base.routes, ...overrides.routes },
  };
}

function emptyBreakdown(): SizeBreakdown {
  return {
    models: { count: 0, samples: [] },
    endpoints: { count: 0, samples: [] },
    acs: { count: 0 },
    multipliers: { count: 0, matchedKeywords: [] },
    routes: { count: 0, samples: [] },
  };
}

function buildRationale(
  decision: SizeDecision,
  observations: Record<keyof SizeThresholds, number>,
  trips: SizeTrip[],
  thresholds: SizeThresholds,
): string {
  const dims = [
    `${observations.models} models`,
    `${observations.endpoints} endpoints`,
    `${observations.acs} ACs`,
    `${observations.multipliers} ACs with complexity multipliers`,
    `${observations.routes} routes`,
  ].join(", ");

  if (decision === "ok") {
    return `Design fits one Plan. Observed: ${dims}. All under recommend thresholds (${formatThresholds(thresholds)}).`;
  }

  const requiredTrips = trips.filter((t) => t.level === "required");
  const recommendTrips = trips.filter((t) => t.level === "recommend");

  if (decision === "decompose-required") {
    const requiredList = requiredTrips
      .map((t) => `${t.dimension}=${t.observed}>=${t.threshold}`)
      .join("; ");
    return `Design is xlarge. Observed: ${dims}. REQUIRED-threshold trips: ${requiredList}. Recommendation: decompose into 2-4 child builds before Plan, OR narrow the design and re-run Ideate.`;
  }

  // decompose-recommended
  const recommendList = recommendTrips
    .map((t) => `${t.dimension}=${t.observed}>=${t.threshold}`)
    .join("; ");
  return `Design is large. Observed: ${dims}. Recommend-threshold trips: ${recommendList}. Consider decomposing into 2-3 smaller builds for faster Plan convergence; not blocking.`;
}

function formatThresholds(t: SizeThresholds): string {
  return `recommend models>=${t.models.recommend}, endpoints>=${t.endpoints.recommend}, ACs>=${t.acs.recommend}, multipliers>=${t.multipliers.recommend}, routes>=${t.routes.recommend}`;
}
