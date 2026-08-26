import type { ReadinessProfile } from "./types";

const PROFILE_STRENGTH: Record<ReadinessProfile, number> = {
  "doc-only": 0,
  fix: 1,
  feature: 2,
  "cross-domain": 3,
  archetype: 4,
};

export function selectStrongestReadinessProfile(profiles: readonly ReadinessProfile[]): ReadinessProfile {
  if (profiles.length === 0) return "doc-only";
  return profiles.reduce((strongest, candidate) =>
    PROFILE_STRENGTH[candidate] > PROFILE_STRENGTH[strongest] ? candidate : strongest,
  );
}

export function profileAtLeast(profile: ReadinessProfile, floor: ReadinessProfile): boolean {
  return PROFILE_STRENGTH[profile] >= PROFILE_STRENGTH[floor];
}

export type InitiativeProfileSignals = {
  type?: string | null;
  source?: string | null;
  workType?: string | null;
  scopeKind?: string | null;
  archetypeCategories?: readonly string[];
  archetypeIds?: readonly string[];
  activeBuildKind?: string | null;
  recordedProfiles?: readonly ReadinessProfile[];
};

function profileFromString(value: string | null | undefined): ReadinessProfile | null {
  const normalized = value?.trim().toLocaleLowerCase("en-US").replaceAll("_", "-");
  if (!normalized) return null;
  if (["archetype", "new-archetype", "vertical"].includes(normalized)) return "archetype";
  if (["cross-domain", "crossdomain", "platform-wide"].includes(normalized)) return "cross-domain";
  if (["bug", "defect", "fix"].includes(normalized)) return "fix";
  if (["doc", "docs", "documentation", "doc-only"].includes(normalized)) return "doc-only";
  if (["feature", "enhancement", "build"].includes(normalized)) return "feature";
  return null;
}

function profileFromScopeKind(value: string | null | undefined): ReadinessProfile | null {
  const normalized = value?.trim().toLocaleLowerCase("en-US").replaceAll("_", "-");
  if (["archetype", "archetype-category", "archetype-leaf", "multi-archetype"].includes(normalized ?? "")) {
    return "archetype";
  }
  // Ownership is not a risk signal. Platform/common work derives its profile
  // from the work type unless explicit or recorded cross-domain evidence wins.
  if (["common", "platform"].includes(normalized ?? "")) return null;
  if (normalized === "cross-domain") return "cross-domain";
  return profileFromString(value);
}

/** Monotonic profile projection from immutable history and current structured substrate. */
export function deriveAuthoritativeReadinessProfile(signals: InitiativeProfileSignals): ReadinessProfile | null {
  const candidates = [
    profileFromString(signals.type),
    profileFromString(signals.source),
    profileFromString(signals.workType),
    profileFromScopeKind(signals.scopeKind),
    profileFromString(signals.activeBuildKind),
    ...(signals.recordedProfiles ?? []),
  ].filter((profile): profile is ReadinessProfile => Boolean(profile));
  if ((signals.archetypeCategories?.length ?? 0) > 0 || (signals.archetypeIds?.length ?? 0) > 0) {
    candidates.push("archetype");
  }
  return candidates.length > 0 ? selectStrongestReadinessProfile(candidates) : null;
}
