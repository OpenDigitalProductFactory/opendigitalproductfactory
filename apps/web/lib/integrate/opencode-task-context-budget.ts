// apps/web/lib/integrate/opencode-task-context-budget.ts
//
// Pure helpers that fit an assembled OpenCode specialist task prompt into the
// local model's served context window (BI-B195F224). Kept in its own module so
// opencode-dispatch stays under the module-size hard cap and does not become a
// new production hotspot.

// Heuristic ~chars/4 matches tak/context-pressure and context-economy-metrics.
export const OPENCODE_CHARS_PER_TOKEN = 4;
export const OPENCODE_OUTPUT_RESERVE_RATIO = 0.15;
export const OPENCODE_OUTPUT_RESERVE_MIN_TOKENS = 2_048;
export const OPENCODE_OUTPUT_RESERVE_MAX_TOKENS = 8_192;
/** Minimum tokens left for the prompt after reserve (below this we fail early). */
export const OPENCODE_MIN_INPUT_BUDGET_TOKENS = 1_024;

const PRIOR_RESULTS_MARKER = "RESULTS FROM PRIOR TASKS:";
const PROJECT_CONTEXT_MARKER = "PROJECT CONTEXT:";
const TASK_CORE_MARKER = "CRITICAL:";

/**
 * Rough prompt token estimate (~chars/4). Pure — matches the rest of the
 * context-economy surface so budgets are comparable across modules.
 */
export function estimatePromptTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / OPENCODE_CHARS_PER_TOKEN);
}

/**
 * Input-token budget = served window minus output/overhead reserve.
 * Reserve scales with window size, clamped to [MIN, MAX].
 */
export function computeInputTokenBudget(
  servedContextTokens: number,
  outputReserveTokens?: number,
): number {
  const reserve =
    typeof outputReserveTokens === "number" && outputReserveTokens >= 0
      ? outputReserveTokens
      : Math.min(
          OPENCODE_OUTPUT_RESERVE_MAX_TOKENS,
          Math.max(
            OPENCODE_OUTPUT_RESERVE_MIN_TOKENS,
            Math.floor(servedContextTokens * OPENCODE_OUTPUT_RESERVE_RATIO),
          ),
        );
  return Math.max(OPENCODE_MIN_INPUT_BUDGET_TOKENS, servedContextTokens - reserve);
}

export type TrimTaskPromptResult = {
  prompt: string;
  estimatedTokens: number;
  budgetTokens: number | null;
  trimmed: boolean;
  /** false when even the task core cannot fit the budget */
  fit: boolean;
  reason: string | null;
};

function shrinkSectionBody(prompt: string, marker: string, targetBodyChars: number): string {
  const idx = prompt.indexOf(marker);
  if (idx < 0) return prompt;
  const bodyStart = idx + marker.length;
  // Body runs until the next double-newline block that starts a known header,
  // or the CRITICAL task-core marker — keep structure intact.
  const after = prompt.slice(bodyStart);
  const nextHeaderMatch = after.search(
    /\n\n(?:RESULTS FROM PRIOR TASKS:|DPF BUILD DISCIPLINE|CRITICAL:|TASK:)/,
  );
  const bodyEnd = nextHeaderMatch >= 0 ? bodyStart + nextHeaderMatch : prompt.length;
  const body = prompt.slice(bodyStart, bodyEnd);
  if (body.length <= targetBodyChars) return prompt;
  const note =
    targetBodyChars <= 0
      ? "\n(omitted to fit local model context window)"
      : `\n${body.slice(0, Math.max(0, targetBodyChars - 48)).trimEnd()}\n…(trimmed to fit local model context window)`;
  return prompt.slice(0, bodyStart) + note + prompt.slice(bodyEnd);
}

/**
 * Fit an assembled specialist task prompt into the local model's served context
 * window (minus output reserve). Prefer trimming soft context first:
 *   1) RESULTS FROM PRIOR TASKS
 *   2) PROJECT CONTEXT
 * then hard-trim the pre-CRITICAL head if still over. Never drop the task core
 * (CRITICAL… through VERIFY); if that alone exceeds the budget, return fit:false
 * with an actionable "use cloud / raise context" message instead of a mid-run
 * ContextOverflowError (BI-B195F224).
 *
 * When servedContextTokens is null/undefined/<=0, the prompt is passed through
 * unchanged (remote OpenCode / unknown window).
 */
export function trimTaskPromptToContext(params: {
  prompt: string;
  servedContextTokens: number | null | undefined;
  outputReserveTokens?: number;
}): TrimTaskPromptResult {
  const prompt = params.prompt ?? "";
  const estimated = estimatePromptTokens(prompt);
  const served = params.servedContextTokens;

  if (served == null || served <= 0) {
    return {
      prompt,
      estimatedTokens: estimated,
      budgetTokens: null,
      trimmed: false,
      fit: true,
      reason: null,
    };
  }

  const budget = computeInputTokenBudget(served, params.outputReserveTokens);
  const budgetChars = budget * OPENCODE_CHARS_PER_TOKEN;

  if (estimated <= budget) {
    return {
      prompt,
      estimatedTokens: estimated,
      budgetTokens: budget,
      trimmed: false,
      fit: true,
      reason: null,
    };
  }

  let next = prompt;
  let trimmed = false;

  // 1) Drop / shrink prior-results first (most disposable on later tasks).
  if (estimatePromptTokens(next) > budget && next.includes(PRIOR_RESULTS_MARKER)) {
    const overChars = estimatePromptTokens(next) * OPENCODE_CHARS_PER_TOKEN - budgetChars;
    const idx = next.indexOf(PRIOR_RESULTS_MARKER);
    const after = next.slice(idx + PRIOR_RESULTS_MARKER.length);
    const nextHeaderMatch = after.search(/\n\n(?:DPF BUILD DISCIPLINE|CRITICAL:|TASK:)/);
    const bodyLen = nextHeaderMatch >= 0 ? nextHeaderMatch : after.length;
    const targetBody = Math.max(0, bodyLen - overChars - 64);
    next = shrinkSectionBody(next, PRIOR_RESULTS_MARKER, targetBody);
    trimmed = true;
  }

  // 2) Shrink PROJECT CONTEXT.
  if (estimatePromptTokens(next) > budget && next.includes(PROJECT_CONTEXT_MARKER)) {
    const overChars = estimatePromptTokens(next) * OPENCODE_CHARS_PER_TOKEN - budgetChars;
    const idx = next.indexOf(PROJECT_CONTEXT_MARKER);
    const after = next.slice(idx + PROJECT_CONTEXT_MARKER.length);
    const nextHeaderMatch = after.search(
      /\n\n(?:RESULTS FROM PRIOR TASKS:|DPF BUILD DISCIPLINE|CRITICAL:|TASK:)/,
    );
    const bodyLen = nextHeaderMatch >= 0 ? nextHeaderMatch : after.length;
    const targetBody = Math.max(0, bodyLen - overChars - 64);
    next = shrinkSectionBody(next, PROJECT_CONTEXT_MARKER, targetBody);
    trimmed = true;
  }

  // 3) If still over, hard-trim the pre-CRITICAL head (role + discipline) while
  // keeping the task core intact.
  const coreIdx = next.indexOf(TASK_CORE_MARKER);
  if (estimatePromptTokens(next) > budget && coreIdx > 0) {
    const core = next.slice(coreIdx);
    const coreTokens = estimatePromptTokens(core);
    if (coreTokens >= budget) {
      // Core alone does not fit — fail closed with an actionable message.
      return {
        prompt: next,
        estimatedTokens: estimatePromptTokens(next),
        budgetTokens: budget,
        trimmed: true,
        fit: false,
        reason:
          `Task prompt core (~${coreTokens} tokens) exceeds the local model input budget ` +
          `(${budget} of ${served} served context tokens after output reserve). ` +
          `Raise the local context window (Build Runtime > local model) or route this build to a cloud coding model.`,
      };
    }
    const headBudgetChars = (budget - coreTokens) * OPENCODE_CHARS_PER_TOKEN;
    const head = next.slice(0, coreIdx);
    const keptHead =
      headBudgetChars <= 80
        ? "(role context trimmed to fit local model window)\n\n"
        : `${head.slice(0, Math.max(0, headBudgetChars - 60)).trimEnd()}\n…(trimmed to fit local model context window)\n\n`;
    next = keptHead + core;
    trimmed = true;
  }

  const finalTokens = estimatePromptTokens(next);
  if (finalTokens > budget) {
    // No CRITICAL marker or still over after best-effort trim — fail early.
    return {
      prompt: next,
      estimatedTokens: finalTokens,
      budgetTokens: budget,
      trimmed: true,
      fit: false,
      reason:
        `Assembled task prompt (~${finalTokens} tokens) exceeds the local model input budget ` +
        `(${budget} of ${served} served context tokens after output reserve). ` +
        `Raise the local context window or route this build to a cloud coding model.`,
    };
  }

  return {
    prompt: next,
    estimatedTokens: finalTokens,
    budgetTokens: budget,
    trimmed,
    fit: true,
    reason: null,
  };
}

/** One-line log/progress summary when a prompt was trimmed to fit. */
export function formatTrimProgressMessage(fitted: TrimTaskPromptResult, served: number | null | undefined): string {
  return `Trimmed task context to fit local model window (~${fitted.estimatedTokens}/${fitted.budgetTokens} tokens; served=${served ?? "?"})`;
}
