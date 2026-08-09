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
