/**
 * BI-84792669 — reusable survivor-selection precedence for ModelProfile
 * duplicates.
 *
 * The collation-drift dedupe (migration 20260720193000) resolved corrupted
 * `ModelProfile_providerId_modelId_key` duplicates by ranking rows purely on
 * `lastEvalAt DESC NULLS LAST, evalCount DESC, generatedAt DESC, id DESC` —
 * with no awareness of `profileSource`. For `local/docker.io/ai/qwen3-coder:latest`
 * that kept a `seed` row (toolFidelity 40, no capabilityOverrides) over an
 * `evaluated` row (toolFidelity 100, capabilityOverrides {"toolUse":true}),
 * silently discarding a real eval result and an operator's manual pin.
 *
 * This module is the single source of truth for "which duplicate wins" and
 * "which capabilityOverrides pin survives". It mirrors, field-for-field, the
 * logic embedded in migration 20260724150000_retriage_quarantined_model_profiles
 * (SQL can't call TS, so the two must be kept in lockstep — see the comment
 * block at the top of that migration). Exported for:
 *   - unit tests locking the precedence invariant (this file's .test.ts)
 *   - any future application-level code that needs to pick a survivor among
 *     ModelProfile duplicates without re-deriving the rule.
 *
 * Precedence order (BI-84792669, highest wins):
 *   1. profileSource: evaluated > admin > catalog > seed
 *      (an unrecognised profileSource — e.g. "auto-discover", "production" —
 *      ranks alongside "catalog": more trustworthy than a blind seed, but not
 *      a proven/decided value.)
 *   2. evalCount (higher wins)
 *   3. toolFidelity (higher wins)
 *   4. lastEvalAt (more recent wins; null sorts last)
 *   5. generatedAt (more recent wins; null sorts last)
 */

export type ModelProfilePrecedenceCandidate = {
  id: string;
  profileSource: string | null;
  evalCount: number;
  toolFidelity: number;
  lastEvalAt: Date | string | null;
  generatedAt: Date | string | null;
  capabilityOverrides: unknown;
};

/**
 * profileSource -> precedence rank. Higher wins. Kept in lockstep with the
 * `CASE "profileSource" WHEN … END` in migration
 * 20260724150000_retriage_quarantined_model_profiles/migration.sql.
 */
export const MODEL_PROFILE_SOURCE_PRECEDENCE_RANK: Record<string, number> = {
  evaluated: 4,
  admin: 3,
  catalog: 2,
  seed: 1,
};

/** Unrecognised profileSource values rank alongside "catalog" (see module doc). */
const DEFAULT_PRECEDENCE_RANK = MODEL_PROFILE_SOURCE_PRECEDENCE_RANK.catalog;

export function modelProfileSourceRank(profileSource: string | null | undefined): number {
  if (!profileSource) return DEFAULT_PRECEDENCE_RANK;
  return MODEL_PROFILE_SOURCE_PRECEDENCE_RANK[profileSource] ?? DEFAULT_PRECEDENCE_RANK;
}

// Sentinel for "no timestamp" that sorts before every real epoch-ms value
// without producing NaN from an Infinity - Infinity subtraction when two
// null timestamps are compared (real epoch-ms values are always > 0).
const NO_TIMESTAMP_SENTINEL = 0;

function toTimeOrSentinel(value: Date | string | null): number {
  if (value === null) return NO_TIMESTAMP_SENTINEL;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? NO_TIMESTAMP_SENTINEL : time;
}

/**
 * Compares two candidates for survivor precedence. Returns a positive number
 * when `a` outranks `b`, negative when `b` outranks `a`, 0 only for a true
 * tie (all five ordered criteria equal — `id` is NOT part of the ranking, so
 * callers that need a fully deterministic total order should break a 0 tie
 * themselves, e.g. by `id`).
 */
export function compareModelProfilePrecedence(
  a: ModelProfilePrecedenceCandidate,
  b: ModelProfilePrecedenceCandidate,
): number {
  const rankDiff = modelProfileSourceRank(a.profileSource) - modelProfileSourceRank(b.profileSource);
  if (rankDiff !== 0) return rankDiff;

  const evalCountDiff = a.evalCount - b.evalCount;
  if (evalCountDiff !== 0) return evalCountDiff;

  const toolFidelityDiff = a.toolFidelity - b.toolFidelity;
  if (toolFidelityDiff !== 0) return toolFidelityDiff;

  const lastEvalDiff = toTimeOrSentinel(a.lastEvalAt) - toTimeOrSentinel(b.lastEvalAt);
  if (lastEvalDiff !== 0) return lastEvalDiff;

  return toTimeOrSentinel(a.generatedAt) - toTimeOrSentinel(b.generatedAt);
}

/**
 * Picks the highest-precedence row among duplicates for the same
 * (providerId, modelId). Ties (including a true 0 from compareModelProfilePrecedence)
 * are broken by `id` ascending, for a fully deterministic result.
 * Throws on an empty array — callers should never invoke this with no candidates.
 */
export function pickModelProfileSurvivor<T extends ModelProfilePrecedenceCandidate>(candidates: T[]): T {
  if (candidates.length === 0) {
    throw new Error("pickModelProfileSurvivor: candidates must not be empty");
  }
  return candidates.reduce((best, candidate) => {
    const diff = compareModelProfilePrecedence(candidate, best);
    if (diff > 0) return candidate;
    if (diff < 0) return best;
    return candidate.id < best.id ? candidate : best;
  });
}

/**
 * Requirement #2 (BI-84792669): "before quarantining a loser, copy a non-null
 * capabilityOverrides onto the survivor when the survivor has none." Applied
 * across an arbitrary number of duplicates: the survivor's own pin always
 * wins; otherwise the pin belongs to whichever duplicate ranks highest among
 * those that actually carry one (never silently dropped, never arbitrarily
 * chosen when more than one duplicate has a pin).
 */
export function pickCapabilityOverrides<T extends ModelProfilePrecedenceCandidate>(
  survivor: T,
  allCandidates: T[],
): unknown {
  if (survivor.capabilityOverrides !== null && survivor.capabilityOverrides !== undefined) {
    return survivor.capabilityOverrides;
  }
  const withOverrides = allCandidates.filter(
    (c) => c.capabilityOverrides !== null && c.capabilityOverrides !== undefined,
  );
  if (withOverrides.length === 0) return null;
  return pickModelProfileSurvivor(withOverrides).capabilityOverrides;
}
