// Owner-facing explanation for a turn that did not run on the preferred route.
//
// BI-F4D3B9E9(d). Two problems this replaces:
//
//  1. CONTRADICTION. `downgraded` conflated "a dispatch failed" with "nothing
//     was eligible", so two copy paths asserted opposite causes in one reply —
//     the banner said "your configured provider is active but wasn't eligible"
//     while the agentic loop said "my usual AI was unavailable". Callers now
//     branch on `RoutedInferenceResult.downgradeReason`, never on `downgraded`.
//
//  2. GUESSING. The old banner hardcoded "usually because the request exceeded
//     its context window, or needed a capability it doesn't offer" — a guess,
//     while the routing pipeline had already computed the real excluder and put
//     it on `RouteDecision.candidates[].excludedReason`. On the reported install
//     the truth was neither guess: the strongest provider was `disabled` and the
//     banner said "your configured provider is active" because a DIFFERENT
//     provider was active, masking the disabled one entirely.
//
// Pure and dependency-free so it unit-tests without prisma or a live route.
// Reads only routing metadata (statuses, reason strings, endpoint names) — never
// prompts, tool payloads, credentials, or detected values.

/** Plain-language cause classes, derived from `getExclusionReasonV2` output. */
export type DowngradeCause =
  | "context-window"
  | "capability"
  | "clearance"
  | "rate-limit"
  | "provider-off"
  | "residency"
  | "model-class"
  | "unknown";

/**
 * Map one technical exclusion reason to an owner-facing cause class.
 *
 * Ordered most- to least-specific: `getExclusionReasonV2` returns the FIRST
 * matching reason, but several strings share vocabulary (a status string can
 * mention a model class), so the narrow tests run before the broad ones.
 */
export function classifyExclusionReason(reason: string): DowngradeCause {
  const text = reason.toLowerCase();
  if (text.includes("context window too small")) return "context-window";
  if (text.includes("rate limit")) return "rate-limit";
  if (text.includes("sensitivity clearance")) return "clearance";
  if (text.includes("residency policy")) return "residency";
  if (text.includes("missing required capability") || text.includes("requires capability")) {
    return "capability";
  }
  if (text.includes("modelclass")) return "model-class";
  if (text.includes("status is")) return "provider-off";
  return "unknown";
}

/** Owner-facing phrase for a cause class. Completes "…wasn't used because X". */
function causePhrase(cause: DowngradeCause): string {
  switch (cause) {
    case "context-window":
      return "this request was longer than its context window";
    case "capability":
      return "this request needed a capability it doesn't offer";
    case "clearance":
      return "it isn't cleared for this data sensitivity";
    case "rate-limit":
      return "it had reached its rate limit";
    case "provider-off":
      return "it isn't switched on";
    case "residency":
      return "data policy required this work to stay on this machine";
    case "model-class":
      return "its model isn't the class this work requires";
    case "unknown":
      return "it wasn't eligible for this request";
  }
}

export type LocalFallbackBannerInput = {
  /** Excluded user-configured candidates, in routing's own ranking order. */
  excludedReasons: string[];
  /** Names of user-configured providers currently in a non-routable status. */
  offProviderNames: string[];
};

/** The manifest and candidate fields this module reads — nothing else. */
type ManifestFacts = {
  id: string;
  name: string;
  status: string;
  providerTier: string;
  sensitivityClearance: readonly string[];
};
type CandidateFacts = { endpointId: string; excluded: boolean; excludedReason?: string };

/**
 * Pull the two owner-relevant facts out of live routing metadata: which
 * user-configured providers are switched off AND could actually have served this
 * turn, and why the rest were ruled out.
 *
 * The clearance filter is load-bearing, not a refinement. A disabled provider is
 * never a candidate, so nothing in the candidate trace reveals whether it would
 * have been eligible had it been on. Naming one unconditionally produces
 * confidently wrong advice: on the reported install Claude was switched off AND
 * holds `sensitivityClearance: ["public"]`, while the turn was classified
 * `restricted` — so "reconnect Claude" would not have changed the outcome by one
 * token. Only a provider cleared for THIS turn's data class is worth naming; when
 * none is, the honest answer is the exclusion reason instead. See BI-CD13D818.
 *
 * Lives here rather than in routed-inference so the whole explanation path —
 * extraction, classification, and wording — is one testable unit.
 */
export function extractLocalFallbackFacts(input: {
  manifests: ReadonlyArray<ManifestFacts>;
  candidates: ReadonlyArray<CandidateFacts>;
  /** The turn's resolved data class, e.g. "internal" | "restricted". */
  sensitivity: string;
}): LocalFallbackBannerInput {
  const userConfigured = input.manifests.filter((m) => m.providerTier === "user_configured");
  const userConfiguredIds = new Set(userConfigured.map((m) => m.id));
  return {
    offProviderNames: [
      ...new Set(
        userConfigured
          .filter((m) => m.status === "disabled")
          .filter((m) => m.sensitivityClearance.includes(input.sensitivity))
          .map((m) => m.name),
      ),
    ],
    excludedReasons: input.candidates
      .filter((c) => c.excluded && userConfiguredIds.has(c.endpointId) && c.excludedReason)
      .map((c) => c.excludedReason!),
  };
}

/** Human-readable list: "A", "A and B", "A, B, and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const LOCAL_QUALITY_NOTE =
  "Local output can be less reliable for tool use and complex reasoning.";

/**
 * Banner for a turn that RANKED onto the bundled local model — nothing was down.
 *
 * Names the real reason from routing metadata rather than guessing, and when a
 * configured provider is switched off it says so and points at the fix, instead
 * of claiming "your configured provider is active".
 */
export function buildLocalFallbackBanner(input: LocalFallbackBannerInput): string {
  const parts = ["This turn ran on the bundled local model."];

  if (input.offProviderNames.length > 0) {
    const names = joinNames(input.offProviderNames);
    const verb = input.offProviderNames.length === 1 ? "is" : "are";
    parts.push(
      `${names} ${verb} switched off, so routing couldn't use ${
        input.offProviderNames.length === 1 ? "it" : "them"
      }. Reconnect ${
        input.offProviderNames.length === 1 ? "it" : "them"
      } at Platform > AI > Providers to restore full capability.`,
    );
  } else {
    const causes = new Set(input.excludedReasons.map(classifyExclusionReason));
    // A "not switched on" endpoint (status unconfigured/inactive) must never be
    // described inside a "your configured providers stayed available" sentence —
    // that reads as a contradiction, which is the whole class of bug being fixed
    // here. Genuinely-off providers are named by the branch above instead.
    causes.delete("provider-off");
    // Drop "unknown" when a specific cause is also present — a named reason is
    // strictly more useful than the catch-all phrasing.
    if (causes.size > 1) causes.delete("unknown");
    const phrases = [...causes].map(causePhrase);
    parts.push(
      phrases.length > 0
        ? `Your configured providers stayed available, but ${joinNames(phrases)}.`
        : "Your configured providers stayed available but none was eligible for this request.",
    );
  }

  parts.push(LOCAL_QUALITY_NOTE);
  return parts.join(" ");
}
