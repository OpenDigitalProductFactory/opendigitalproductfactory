// apps/web/lib/routing/tool-fidelity-policy.ts
//
// EP-E431FC8A Phase 2 (BI-DF3092F4). The MEASURED half of the tool-attachment
// policy. Phase 1 (BI-B5C358B1) made every unmeasured local model fail-safe at
// the ~15-tool selection cliff, with a `measuredToolFidelityCeiling` hook on
// deriveCoworkerToolCap that nothing populated. This module populates it: given a
// model's measured tool-selection accuracy at different attached-surface sizes,
// it derives the largest surface the model can still select reliably from — so a
// model that PROVES it handles more tools is trusted with more, and one that has
// no evidence stays fail-safe.
//
// Samples live in ModelProfile.customScores (a Json column — no migration) under
// TOOL_FIDELITY_SCORE_KEY, written by the fidelity harness (tool-fidelity-harness
// .ts) and promoted through the existing eval-runner. Pure + dependency-light so
// it unit-tests without Prisma.

/** One measurement: at `surfaceSize` attached tools, the model selected the
 *  correct authoritative tool `accuracy` of the time across `sampleCount` turns. */
export interface ToolFidelitySample {
  surfaceSize: number;
  accuracy: number;
  sampleCount: number;
}

/** Key under ModelProfile.customScores where the sample array is stored. */
export const TOOL_FIDELITY_SCORE_KEY = "toolFidelitySamples";

/** Accuracy at/above which a surface size is considered reliably selectable. */
export const DEFAULT_FIDELITY_THRESHOLD = 0.9;

/** Minimum turns behind a sample before it can lift the cap — one lucky turn is
 *  not evidence. Below this the sample is ignored (stays fail-safe). */
export const DEFAULT_MIN_SAMPLE_COUNT = 5;

export interface MeasuredCeilingOptions {
  threshold?: number;
  minSampleCount?: number;
}

/**
 * Derive the measured tool-selection ceiling for a model from its fidelity
 * samples: the LARGEST surface size whose measured accuracy is at or above the
 * threshold and is backed by enough turns. Returns `null` when no sample
 * qualifies (unknown/insufficient/too-inaccurate) — the caller then keeps the
 * Phase-1 fail-safe cliff. Never invents a ceiling from a window size; only
 * measurement lifts the cap.
 *
 * Monotonicity is NOT assumed (accuracy can dip then recover across sizes); we
 * take the max qualifying size, so a model reliable at 24 but noisy at 16 still
 * earns 24.
 */
export function deriveMeasuredToolCeiling(
  samples: readonly ToolFidelitySample[] | null | undefined,
  opts?: MeasuredCeilingOptions,
): number | null {
  const threshold = opts?.threshold ?? DEFAULT_FIDELITY_THRESHOLD;
  const minSampleCount = opts?.minSampleCount ?? DEFAULT_MIN_SAMPLE_COUNT;
  if (!samples || samples.length === 0) return null;
  let ceiling: number | null = null;
  for (const s of samples) {
    if (!s || typeof s.surfaceSize !== "number" || s.surfaceSize <= 0) continue;
    if (typeof s.accuracy !== "number" || typeof s.sampleCount !== "number") continue;
    if (s.sampleCount < minSampleCount) continue;
    if (s.accuracy < threshold) continue;
    if (ceiling === null || s.surfaceSize > ceiling) ceiling = s.surfaceSize;
  }
  return ceiling;
}

/**
 * Read and validate the fidelity samples stashed in a ModelProfile.customScores
 * JSON blob. Tolerant of malformed data (returns []), so a bad row can never
 * throw on the attachment hot path.
 */
export function readToolFidelitySamples(customScores: unknown): ToolFidelitySample[] {
  if (!customScores || typeof customScores !== "object") return [];
  const raw = (customScores as Record<string, unknown>)[TOOL_FIDELITY_SCORE_KEY];
  if (!Array.isArray(raw)) return [];
  const out: ToolFidelitySample[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    if (typeof s.surfaceSize !== "number" || typeof s.accuracy !== "number") continue;
    const sampleCount = typeof s.sampleCount === "number" ? s.sampleCount : 0;
    out.push({ surfaceSize: s.surfaceSize, accuracy: s.accuracy, sampleCount });
  }
  return out;
}

/**
 * Fold a fresh measurement into the sample set for one surface size, keeping a
 * running (count-weighted) mean so repeated harness runs converge rather than
 * overwrite. Returns a NEW array (pure). Other surface sizes are untouched.
 */
export function mergeToolFidelitySample(
  existing: readonly ToolFidelitySample[] | null | undefined,
  surfaceSize: number,
  accuracy: number,
  turns: number,
): ToolFidelitySample[] {
  const rest = (existing ?? []).filter((s) => s.surfaceSize !== surfaceSize);
  const prior = (existing ?? []).find((s) => s.surfaceSize === surfaceSize);
  if (!prior || prior.sampleCount <= 0) {
    return [...rest, { surfaceSize, accuracy, sampleCount: turns }].sort(
      (a, b) => a.surfaceSize - b.surfaceSize,
    );
  }
  const totalCount = prior.sampleCount + turns;
  const blended = (prior.accuracy * prior.sampleCount + accuracy * turns) / totalCount;
  return [...rest, { surfaceSize, accuracy: blended, sampleCount: totalCount }].sort(
    (a, b) => a.surfaceSize - b.surfaceSize,
  );
}
