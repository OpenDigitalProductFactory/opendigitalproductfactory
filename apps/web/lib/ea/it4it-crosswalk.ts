// apps/web/lib/ea/it4it-crosswalk.ts
//
// Canonical IT4IT crosswalk + evidence normalization for the coverage projection.
// Two alignment languages are in use across DPF substrate:
//   - IT4IT v3 stream slugs on capability tags + UI: evaluate/explore/integrate/
//     deploy/release/consume/operate
//   - Legacy/governance labels on the agent registry: "Strategy to Portfolio",
//     "Request to Deploy", governance, cross-cutting, and null.
// The functional CRITERIA are organized by the four v2 capability groups (+ Supporting
// Functions); evidence is tagged with v3 streams. This module is the one place that
// normalizes evidence streams and maps them to capability groups so v3-tagged evidence
// can score v2-organized components.
//
// This crosswalk is a DPF modeling decision, NOT a substitute for the IT4IT standard.
// It must be unit-tested and named in the UI when switching to the value-stream lens.
// Spec: docs/superpowers/specs/2026-06-24-it4it-conformance-coverage-heatmap-design.md (section 3).

export const IT4IT_V3_STREAMS = [
  "evaluate",
  "explore",
  "integrate",
  "deploy",
  "release",
  "consume",
  "operate",
] as const;
export type It4itV3Stream = (typeof IT4IT_V3_STREAMS)[number];

// Coverage statuses already stored by the EA reference-model substrate. Centralized here
// so callers share one source of truth; values are NOT renamed by this feature.
export const IT4IT_REFERENCE_COVERAGE_STATUSES = [
  "implemented",
  "partial",
  "planned",
  "not_started",
  "out_of_mvp",
] as const;
export type ReferenceCoverageStatus = (typeof IT4IT_REFERENCE_COVERAGE_STATUSES)[number];

// Capability group names exactly as seeded in EaReferenceModelElement (kind=capability_group).
export const IT4IT_CAPABILITY_GROUPS = [
  "Strategy to Portfolio",
  "Requirement to Deploy",
  "Request to Fulfill",
  "Detect to Correct",
  "Supporting Functions",
] as const;
export type It4itCapabilityGroup = (typeof IT4IT_CAPABILITY_GROUPS)[number];

// A normalized evidence stream is a v3 stream, or one of the two cross-cutting kinds that
// agents carry but that are not themselves value streams.
export type NormalizedEvidenceStream = It4itV3Stream | "governance" | "cross-cutting";

// Free-text agent / capability stream label -> normalized token. Keys are lower-cased and
// trimmed before lookup. Legacy v2 labels normalize to the v3 stream that lands them in the
// correct capability group via IT4IT_V3_TO_CAPABILITY_GROUP. Unknown/empty -> null (the
// caller raises a hygiene finding rather than silently inventing alignment).
export const IT4IT_AGENT_VALUE_STREAM_NORMALIZATION: Record<string, NormalizedEvidenceStream> = {
  evaluate: "evaluate",
  explore: "explore",
  integrate: "integrate",
  deploy: "deploy",
  release: "release",
  consume: "consume",
  operate: "operate",
  governance: "governance",
  "cross-cutting": "cross-cutting",
  "cross cutting": "cross-cutting",
  crosscutting: "cross-cutting",
  // Legacy v2 labels observed live in agent_registry.json.
  "strategy to portfolio": "evaluate",
  "request to deploy": "deploy",
  "requirement to deploy": "integrate",
};

// Is a raw label one of the known legacy/non-canonical forms (for hygiene reporting)?
export const IT4IT_LEGACY_STREAM_LABELS = new Set([
  "strategy to portfolio",
  "request to deploy",
  "requirement to deploy",
]);

export function normalizeIt4itEvidenceStream(
  value: string | null | undefined,
): NormalizedEvidenceStream | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return IT4IT_AGENT_VALUE_STREAM_NORMALIZATION[key] ?? null;
}

// Normalized stream -> capability group. cross-cutting maps to null: it is platform-wide
// context, not evidence for one specific group, so it is excluded from group scoring.
export const IT4IT_V3_TO_CAPABILITY_GROUP: Record<NormalizedEvidenceStream, It4itCapabilityGroup | null> = {
  evaluate: "Strategy to Portfolio",
  explore: "Strategy to Portfolio",
  integrate: "Requirement to Deploy",
  deploy: "Requirement to Deploy",
  release: "Requirement to Deploy",
  consume: "Request to Fulfill",
  operate: "Detect to Correct",
  governance: "Supporting Functions",
  "cross-cutting": null,
};

// Map any raw evidence stream label to its capability group, or null when the label is
// unknown (hygiene) or genuinely cross-cutting (not group-specific).
export function evidenceStreamToCapabilityGroup(
  value: string | null | undefined,
): It4itCapabilityGroup | null {
  const normalized = normalizeIt4itEvidenceStream(value);
  if (!normalized) return null;
  return IT4IT_V3_TO_CAPABILITY_GROUP[normalized];
}

// Pull a dotted-section token (e.g. "6.1.1") out of a free-text reference such as
// "6.1.1", "section 6.1.1 Policy", or "5.1.1-5.1.6". Returns the first dotted number, or
// null. Used to match agent it4itSections to a component's criteria sourceReferences.
export function extractSectionToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+(?:\.\d+)+/);
  return match ? match[0] : null;
}

// True when section `a` covers section `b` (equal, or a is a dotted prefix of b at a dot
// boundary). "6.1" covers "6.1.1"; "6.1" does not cover "6.11".
export function sectionCovers(a: string, b: string): boolean {
  if (a === b) return true;
  return b.startsWith(a + ".");
}
