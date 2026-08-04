/**
 * The one ordering of sensitivity levels.
 *
 * `screen-inference-payload` uses it to apply the declared route label as a
 * FLOOR over the measured payload level; the drift rollup uses it to decide
 * whether a declared label sits above what its payload actually measures.
 * Both must agree on "above", so the rank lives here rather than being
 * restated per caller.
 *
 * Kept in its own module rather than in `types.ts` because that file is
 * type-only, and giving it a runtime export would turn every `import type`
 * of it into a value import.
 */
import type { InferencePayloadSensitivity } from "./types";

export const SENSITIVITY_RANK: Readonly<Record<InferencePayloadSensitivity, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

/**
 * How many levels `declared` sits above `measured`, or 0 when it does not.
 *
 * Never negative: a payload measuring ABOVE its declared label is the screen
 * doing its job (the floor only ever raises), not a mislabelled route.
 */
export function sensitivityLevelsAbove(
  declared: InferencePayloadSensitivity,
  measured: InferencePayloadSensitivity,
): number {
  return Math.max(0, SENSITIVITY_RANK[declared] - SENSITIVITY_RANK[measured]);
}
