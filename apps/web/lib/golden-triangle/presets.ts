// EP-GOLDEN-TRIANGLE — the canonical preset weights, shared by the UI display
// helpers and by server-side resolvers that need a full preference from a
// preset name (the Workroom shape defaults, BI-7ADEBDC1). Lives in lib so a
// server module never has to import a component file for a number table.
import type { GoldenTrianglePreference, GoldenTrianglePreset } from "./types";

export type GoldenTriangleNamedPreset = Exclude<GoldenTrianglePreset, "custom">;

/** [quality, cost, time] — mirrors the Slice 1 compiler's canonical postures. */
export const PRESET_WEIGHTS: Record<GoldenTriangleNamedPreset, [number, number, number]> = {
  fast: [0.1, 0.1, 0.8],
  balanced: [0.34, 0.33, 0.33],
  assured: [0.8, 0.1, 0.1],
  frugal: [0.1, 0.8, 0.1],
};

export function preferenceFromPreset(preset: GoldenTriangleNamedPreset): GoldenTrianglePreference {
  const [qualityWeight, costWeight, timeWeight] = PRESET_WEIGHTS[preset];
  return { preset, qualityWeight, costWeight, timeWeight };
}
