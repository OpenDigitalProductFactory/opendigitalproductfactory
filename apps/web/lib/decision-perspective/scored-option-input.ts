// BI-6DCF772F. Parse the optional `optionFeatures` MCP param for the open-ended
// decision gates (evaluate_org_business_decision / evaluate_profession_decision)
// into DecisionScoredOption[]. Unlike build-studio-gate / work-pattern-review —
// which score a fixed, hand-authored menu — these gates take arbitrary
// caller-supplied option text, so the per-option feature vectors have to come
// from the caller too. Shared by both packs so the validation contract is one
// implementation.

import type { DecisionScoredOption } from "./types";

export type ScoredOptionParseResult =
  | { ok: true; scoredOptions?: DecisionScoredOption[] }
  | { ok: false; message: string };

/**
 * Turn an optional `optionFeatures` param (index-aligned per-option axis→score
 * maps) plus the already-parsed `options` labels into DecisionScoredOption[].
 *
 * - Absent/null → `ok` with NO scoredOptions: the gate keeps today's
 *   coverage-only behaviour, fully backward compatible.
 * - Present but malformed (wrong length, a non-object entry, or a non-finite
 *   axis value) → `ok:false` with a caller-facing message. The caller
 *   explicitly opted into scoring, so a mismatch is a loud boundary error, not
 *   a silent skip that would quietly drop the recommendation they asked for.
 *
 * The option label is used as the DecisionScoredOption `id` (mirroring how
 * work-pattern-review uses its action label as the id), so a later
 * `chosenOptionId` captured from the escalation form resolves against the same
 * key.
 */
export function parseOptionFeatures(options: string[], raw: unknown): ScoredOptionParseResult {
  if (raw === undefined || raw === null) return { ok: true };

  if (!Array.isArray(raw) || raw.length !== options.length) {
    return {
      ok: false,
      message: `optionFeatures, when provided, must be an array of per-option feature maps aligned 1:1 with options (expected ${options.length}).`,
    };
  }

  const scoredOptions: DecisionScoredOption[] = [];
  for (let i = 0; i < options.length; i += 1) {
    const entry = raw[i];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, message: `optionFeatures[${i}] must be an object mapping axis names to numeric scores.` };
    }
    const features: Record<string, number> = {};
    for (const [axis, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, message: `optionFeatures[${i}].${axis} must be a finite number.` };
      }
      features[axis] = value;
    }
    scoredOptions.push({ id: options[i], description: options[i], features });
  }

  return { ok: true, scoredOptions };
}
