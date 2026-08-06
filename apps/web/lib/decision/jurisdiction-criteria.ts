// Trust-envelope jurisdiction criteria — context selects which axes apply and
// how they are weighted (BI-B84CD2D3, EP-VERIFICATION-INTEGRITY; spec §2 Axis 2).
//
// Country / state / industry / activity are SELECTION inputs, not merely
// autonomy gates: two identical candidate profiles under NYC LL144 vs an
// unregulated jurisdiction must produce different, each-defensible vectors,
// with the governing regime recorded. This module resolves the applicable
// JurisdictionCriteriaProfile (keyed on the SAME tuple as RegulatoryAutonomyPolicy)
// and applies it: forbidden axes stripped, monitoring-only axes removed from
// scoring, a per-axis weight overlay applied, required axes checked for presence.
//
// It never reads a protected characteristic — selecting axes/weights by regime is
// a job-relatedness/applicable-law statement, not demographic gating.

import { DIMENSION_KEYS } from "@/lib/decision/dimension-catalog";

const KNOWN_AXES = new Set<string>(DIMENSION_KEYS);

export type JurisdictionKey = {
  industry?: string | null;
  jurisdiction: string;
  jurisdictionBasis?: string | null;
  activityClass: string;
};

export type JurisdictionCriteriaProfileLike = {
  profileKey: string;
  version: number;
  industry: string | null;
  jurisdiction: string;
  jurisdictionBasis: string;
  activityClass: string;
  requiredAxes: string[];
  forbiddenAxes: string[];
  monitoringOnlyAxes: string[];
  weightOverlay: Record<string, number> | unknown;
  packVersion: string | null;
  status: string;
};

export type ResolvedRegime = {
  profileKey: string;
  version: number;
  jurisdiction: string;
  jurisdictionBasis: string;
  activityClass: string;
  packVersion: string | null;
  requiredAxes: string[];
  forbiddenAxes: string[];
  monitoringOnlyAxes: string[];
  weightOverlay: Record<string, number>;
  /** Specificity score used to pick the most specific applicable profile. */
  specificity: number;
};

export type OptionLike = { id: string; description: string; features?: Record<string, number> };

export type JurisdictionApplication = {
  options: OptionLike[];
  regime: ResolvedRegime | null;
  /** Axes removed because the regime forbids them as scoring inputs. */
  forbiddenRemoved: Array<{ optionId: string; dimensionKey: string }>;
  /** Axes removed because the regime marks them monitoring-only (never a score). */
  monitoringOnlyRemoved: Array<{ optionId: string; dimensionKey: string }>;
  /** Required axes with no score on any option — a defensibility gap to surface. */
  requiredMissing: string[];
  /** Axis keys on the profile that are not real PRINCIPLE_DIMENSIONS (config error). */
  invalidProfileAxes: string[];
};

function asWeightOverlay(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/** How specifically a profile matches the key — higher wins. */
function matchSpecificity(profile: JurisdictionCriteriaProfileLike, key: JurisdictionKey): number | null {
  if (profile.status !== "active") return null;
  if (profile.activityClass !== key.activityClass) return null;
  let score = 0;
  // jurisdiction: exact match strongly preferred; "global" is a permitted fallback.
  if (profile.jurisdiction === key.jurisdiction) score += 4;
  else if (profile.jurisdiction === "global") score += 0;
  else return null;
  // industry: exact match preferred; null on the profile = applies to all industries.
  if (profile.industry && key.industry) {
    if (profile.industry === key.industry) score += 2;
    else return null;
  }
  if (profile.jurisdictionBasis && key.jurisdictionBasis && profile.jurisdictionBasis === key.jurisdictionBasis) {
    score += 1;
  }
  return score;
}

/** Pick the most specific active, applicable profile (highest version on a tie). */
export function selectJurisdictionProfile(
  profiles: JurisdictionCriteriaProfileLike[],
  key: JurisdictionKey,
): ResolvedRegime | null {
  let best: { profile: JurisdictionCriteriaProfileLike; score: number } | null = null;
  for (const profile of profiles) {
    const score = matchSpecificity(profile, key);
    if (score === null) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && profile.version > best.profile.version)
    ) {
      best = { profile, score };
    }
  }
  if (!best) return null;
  const p = best.profile;
  return {
    profileKey: p.profileKey,
    version: p.version,
    jurisdiction: p.jurisdiction,
    jurisdictionBasis: p.jurisdictionBasis,
    activityClass: p.activityClass,
    packVersion: p.packVersion,
    requiredAxes: p.requiredAxes,
    forbiddenAxes: p.forbiddenAxes,
    monitoringOnlyAxes: p.monitoringOnlyAxes,
    weightOverlay: asWeightOverlay(p.weightOverlay),
    specificity: best.score,
  };
}

/**
 * Apply a resolved regime to the options: remove forbidden + monitoring-only
 * axes from scoring, apply the weight overlay (multiplier, clamped 0..1), and
 * report required axes that no option scores. With no regime, options pass
 * through unchanged.
 */
export function applyJurisdictionCriteria(input: {
  options: OptionLike[];
  regime: ResolvedRegime | null;
}): JurisdictionApplication {
  const { regime } = input;
  if (!regime) {
    return {
      options: input.options,
      regime: null,
      forbiddenRemoved: [],
      monitoringOnlyRemoved: [],
      requiredMissing: [],
      invalidProfileAxes: [],
    };
  }

  const forbidden = new Set(regime.forbiddenAxes);
  const monitoringOnly = new Set(regime.monitoringOnlyAxes);
  const forbiddenRemoved: Array<{ optionId: string; dimensionKey: string }> = [];
  const monitoringOnlyRemoved: Array<{ optionId: string; dimensionKey: string }> = [];
  const scoredAxes = new Set<string>();

  const options = input.options.map((option): OptionLike => {
    if (option.features === undefined) return option;
    const kept: Record<string, number> = {};
    for (const [dim, magnitude] of Object.entries(option.features)) {
      if (forbidden.has(dim)) {
        forbiddenRemoved.push({ optionId: option.id, dimensionKey: dim });
        continue;
      }
      if (monitoringOnly.has(dim)) {
        monitoringOnlyRemoved.push({ optionId: option.id, dimensionKey: dim });
        continue;
      }
      const multiplier = regime.weightOverlay[dim];
      const adjusted = typeof multiplier === "number" ? magnitude * multiplier : magnitude;
      kept[dim] = Math.max(0, Math.min(1, adjusted));
      scoredAxes.add(dim);
    }
    return { ...option, features: kept };
  });

  const requiredMissing = regime.requiredAxes.filter((axis) => !scoredAxes.has(axis));
  const invalidProfileAxes = [
    ...regime.requiredAxes,
    ...regime.forbiddenAxes,
    ...regime.monitoringOnlyAxes,
    ...Object.keys(regime.weightOverlay),
  ].filter((axis) => !KNOWN_AXES.has(axis));

  return {
    options,
    regime,
    forbiddenRemoved,
    monitoringOnlyRemoved,
    requiredMissing,
    invalidProfileAxes: [...new Set(invalidProfileAxes)],
  };
}
