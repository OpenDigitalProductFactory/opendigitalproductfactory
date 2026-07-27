import type { CandidateTrace } from "@/lib/routing/types";

const CAPABILITY_FLOOR_MARKER = "EP-AGENT-CAP-002";
const CAPABILITY_PATTERN = /capability '(\w+)'/;

/**
 * Attribute a no-route decision to the agent capability floor only when every
 * excluded candidate failed that same floor. A single floor failure must not
 * mask sensitivity, residency, policy, status, or capacity exclusions on the
 * remaining candidates.
 */
export function soleCapabilityFloorFailure(
  candidates: readonly CandidateTrace[],
): { missingCapability: string } | null {
  const excluded = candidates.filter((candidate) => candidate.excluded);
  if (excluded.length === 0) return null;

  const capabilities = excluded.map((candidate) => {
    const reason = candidate.excludedReason ?? "";
    if (!reason.includes(CAPABILITY_FLOOR_MARKER)) return null;
    return reason.match(CAPABILITY_PATTERN)?.[1] ?? "unknown";
  });
  if (capabilities.some((capability) => capability === null)) return null;

  const uniqueCapabilities = new Set(capabilities);
  if (uniqueCapabilities.size !== 1) return null;

  return { missingCapability: capabilities[0] ?? "unknown" };
}
