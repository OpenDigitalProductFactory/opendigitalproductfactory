// Context floor for a prompt-only semantic review (BI-47ACE2C7).
//
// `dispatchRoutedSemanticReview` sends a system prompt and one user prompt and
// attaches no tools, yet it declared `minimumCapabilities.toolUse = true` and a
// flat 32,000-token floor. Both are caller-owned requirements the request does
// not actually have, and together they excluded every active reviewer before
// inference: the local Qwen3.8 27B endpoint serves a 24,576-token window, and
// the long-context route was dropped only because its profile reports
// `supportsToolUse=false`. The route returned infrastructure-inconclusive with
// no semantic finding, on a request that needs neither tools nor 32k.
//
// The floor here is derived from the request that is actually sent. Canonical
// contract inference in `routeAndCall` still requires tool use automatically if
// tools are ever attached, so dropping the caller-level assertion narrows the
// claim rather than weakening the check.

import { estimatePromptTokens } from "@/lib/build/opencode-task-context-budget";

/**
 * Tokens held back for the reviewer's own verdict. A semantic review returns a
 * JSON body with an issue list, so the reserve is a fixed allowance rather than
 * a ratio of the input.
 */
export const SEMANTIC_REVIEW_RESPONSE_RESERVE_TOKENS = 4_096;

/**
 * Proportional headroom over the measured prompt. Absorbs the ~chars/4
 * estimator's error on diff-heavy input, where token density runs above prose.
 */
export const SEMANTIC_REVIEW_HEADROOM_RATIO = 0.25;

/**
 * Floor under the floor. A one-line diff must not make a toy context window
 * look eligible to review it.
 */
export const SEMANTIC_REVIEW_MIN_CONTEXT_TOKENS = 8_192;

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Minimum served context an endpoint needs to review this exact request:
 * both prompts, plus proportional headroom, plus the response reserve — never
 * below `SEMANTIC_REVIEW_MIN_CONTEXT_TOKENS`.
 *
 * Pure. If no endpoint satisfies the result, the review still fails closed with
 * observable exclusion reasons; this changes which endpoints are eligible, not
 * what happens when none are.
 */
export function semanticReviewMinimumContextTokens(input: {
  systemPrompt: string;
  userPrompt: string;
  responseReserveTokens?: number;
  headroomRatio?: number;
}): number {
  const reserve = finitePositive(
    input.responseReserveTokens,
    SEMANTIC_REVIEW_RESPONSE_RESERVE_TOKENS,
  );
  const headroomRatio = finitePositive(input.headroomRatio, SEMANTIC_REVIEW_HEADROOM_RATIO);
  const promptTokens = estimatePromptTokens(input.systemPrompt ?? "")
    + estimatePromptTokens(input.userPrompt ?? "");
  const withHeadroom = Math.ceil(promptTokens * (1 + headroomRatio));
  return Math.max(SEMANTIC_REVIEW_MIN_CONTEXT_TOKENS, withHeadroom + reserve);
}
