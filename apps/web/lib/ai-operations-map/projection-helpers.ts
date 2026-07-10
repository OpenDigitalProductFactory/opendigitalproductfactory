// apps/web/lib/ai-operations-map/projection-helpers.ts — EP-8DC217EB BET-10
//
// Shared label/id normalization helpers for the AI Operations Map projectors.
// Each of these predicates was hand-copied verbatim into 2-3 projector modules:
//
//   - titleize:        project-deliberations, project-a2a-interactions,
//                      project-routing-topology (identical /[-_:.\s]+/ split,
//                      `|| "Unknown"` fallback).
//   - normalizeAgentId: project-deliberations, project-a2a-interactions
//                      (trim + drop `/^unknown$/i` → "").
//   - providerFromEndpoint: the `endpointId.split(":")[0]` idiom. The fallback
//                      differs per caller (project-activity-outcomes wants
//                      "unrouted"), so it is a parameter — callers that layer
//                      extra resolution (known-provider-set checks, `.trim()`,
//                      `.includes(":")` guards) keep their own logic.
//
// Kept in the ai-operations-map hot-zone home (these are map-projection
// concerns, not general utilities).

/** Human-readable label from a dashed/underscored/colon'd id. Never empty. */
export function titleize(value: string): string {
  return (
    value
      .split(/[-_:.\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}

/**
 * Normalize an agent id: trim, and treat an empty or literal "unknown" id as
 * "no agent" (empty string). Callers use `Boolean(id)` to gate coworker nodes.
 */
export function normalizeAgentId(agentId: string): string {
  const normalized = agentId.trim();
  if (!normalized || /^unknown$/i.test(normalized)) return "";
  return normalized;
}

/**
 * Provider id from an `endpointId` of the form `provider:model`. Returns
 * `fallback` when there is no colon segment. Does NOT trim or validate against
 * a known-provider set — callers needing that layer it on top.
 */
export function providerFromEndpoint(endpointId: string, fallback: string): string {
  return endpointId.split(":")[0] || fallback;
}
