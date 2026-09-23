// apps/web/lib/routing/effort-expression.ts
//
// BI-DBAFEC10: one effort decision, expressed in each provider's own dialect.
//
// The superseded design branched on Anthropic and OpenAI inside
// buildProviderSettings and then fell through to "// Generic fallback: just
// max_tokens". So `contract.reasoningDepth` was computed, carried through the
// whole pipeline, and discarded for Gemini, OpenRouter, DeepSeek, xAI and Z.ai —
// `thinkingBudget` appeared nowhere in the tree. A provider that could not
// express effort was indistinguishable from one we never asked.
//
// Two changes: the decision is made once, provider-neutrally; and a provider that
// cannot express it records `effortUnexpressed` rather than failing silently.
//
// Budgets are proportional to the work. The superseded constants (4096/8192) gave
// a one-line classification and a 40k-token architecture review the same thinking
// allowance.
//
// Spec: docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md §3

import type { ModelCardCapabilities } from "./model-card-types";
import { isAnthropic, isOpenAI } from "./provider-utils";

export type ReasoningDepth = "minimal" | "low" | "medium" | "high";
export type EffortLevel = "none" | "low" | "medium" | "high";

export interface EffortDecision {
  /** Provider-neutral effort level. */
  level: EffortLevel;
  /** Thinking budget in tokens, proportional to input size. Null when not thinking. */
  budgetTokens: number | null;
  /** The model manages its own budget (Anthropic adaptive thinking). */
  adaptive: boolean;
}

export interface EffortExpression {
  /** Keys to merge into providerSettings. */
  settings: Record<string, unknown>;
  /** Extra output tokens this provider needs on top of the answer. */
  extraMaxTokens: number;
  /** Sampling must run in thinking mode. */
  thinking: boolean;
  /**
   * True when the provider cannot express the requested effort. Recorded on the
   * route so "we asked for deep reasoning and the provider ignored it" is
   * visible instead of invisible.
   */
  effortUnexpressed: boolean;
}

const DEPTH_LEVEL: Record<ReasoningDepth, EffortLevel> = {
  minimal: "none",
  low: "none",
  medium: "medium",
  high: "high",
};

/** Share of the input the model may spend thinking, by depth. */
const BUDGET_RATIO: Record<EffortLevel, number> = {
  none: 0,
  low: 0.15,
  medium: 0.35,
  high: 0.75,
};

const MIN_BUDGET = 1024;
const MAX_BUDGET = 32768;

/**
 * A thinking budget proportional to the work in front of the model, clamped to
 * the model's own output ceiling so a plan can never ask for more than the model
 * can return.
 */
export function proportionalBudget(
  level: EffortLevel,
  estimatedInputTokens: number,
  maxOutputTokens: number | null,
): number | null {
  if (level === "none") return null;
  const ratio = BUDGET_RATIO[level];
  const raw = Math.round(Math.max(estimatedInputTokens, 0) * ratio);
  const floored = Math.max(raw, MIN_BUDGET);
  const ceiling = Math.min(MAX_BUDGET, maxOutputTokens ?? MAX_BUDGET);
  return Math.max(Math.min(floored, ceiling), Math.min(MIN_BUDGET, ceiling));
}

/** The provider-neutral effort decision for one call. */
export function resolveEffort(input: {
  reasoningDepth: ReasoningDepth;
  estimatedInputTokens: number;
  maxOutputTokens: number | null;
  capabilities?: ModelCardCapabilities | null;
}): EffortDecision {
  const level = DEPTH_LEVEL[input.reasoningDepth] ?? "none";
  if (level === "none") return { level, budgetTokens: null, adaptive: false };

  const caps = input.capabilities;
  const adaptive = level === "medium" && caps?.adaptiveThinking === true;
  if (adaptive) return { level, budgetTokens: null, adaptive: true };

  return {
    level,
    budgetTokens: proportionalBudget(level, input.estimatedInputTokens, input.maxOutputTokens),
    adaptive: false,
  };
}

/** Does this model accept the requested effort level at all? */
function levelAccepted(level: EffortLevel, caps: ModelCardCapabilities | null | undefined): boolean {
  const declared = caps?.effortLevels;
  if (!declared || declared.length === 0) return true;
  return declared.map((value) => value.toLowerCase()).includes(level);
}

const NOTHING: EffortExpression = {
  settings: {},
  extraMaxTokens: 0,
  thinking: false,
  effortUnexpressed: false,
};

/** Providers whose reasoning field is a bare effort string. */
function opensOwnReasoningField(providerId: string): "openrouter" | "native" | null {
  const id = providerId.toLowerCase();
  if (id.includes("openrouter")) return "openrouter";
  if (id.includes("deepseek") || id.includes("xai") || id.includes("grok") || id.includes("zai") || id.includes("glm")) {
    return "native";
  }
  return null;
}

/**
 * Express one effort decision in a provider's dialect.
 *
 * Every provider that has a way to say "think harder" now gets told. The ones
 * that do not are recorded, not ignored.
 */
export function expressEffort(
  providerId: string,
  decision: EffortDecision,
  capabilities?: ModelCardCapabilities | null,
  opts?: { modelClass?: string; isLocalNative?: boolean },
): EffortExpression {
  if (decision.level === "none") return NOTHING;
  if (!levelAccepted(decision.level, capabilities)) {
    return { ...NOTHING, effortUnexpressed: true };
  }

  // ── Anthropic — extended thinking, and max_tokens must cover the budget ────
  if (isAnthropic(providerId)) {
    if (decision.adaptive && capabilities?.adaptiveThinking === true) {
      return {
        settings: { thinking: { type: "adaptive" } },
        extraMaxTokens: 0,
        thinking: true,
        effortUnexpressed: false,
      };
    }
    if (capabilities?.thinking === true && decision.budgetTokens !== null) {
      return {
        settings: { thinking: { type: "enabled", budget_tokens: decision.budgetTokens } },
        extraMaxTokens: decision.budgetTokens,
        thinking: true,
        effortUnexpressed: false,
      };
    }
    return { ...NOTHING, effortUnexpressed: true };
  }

  // ── OpenAI reasoning models — reasoning_effort ─────────────────────────────
  if (isOpenAI(providerId)) {
    if (opts?.modelClass === "reasoning" || capabilities?.thinking === true) {
      return {
        settings: { reasoning_effort: decision.level },
        extraMaxTokens: 0,
        thinking: true,
        effortUnexpressed: false,
      };
    }
    return { ...NOTHING, effortUnexpressed: true };
  }

  // ── Gemini — generationConfig.thinkingConfig.thinkingBudget (was missing) ──
  if (providerId.toLowerCase().includes("gemini") || providerId.toLowerCase().includes("google")) {
    if (decision.budgetTokens === null) return { ...NOTHING, effortUnexpressed: true };
    // BI-D9F13BEA: Gemini spends thinking tokens inside maxOutputTokens, as
    // Anthropic spends budget_tokens inside max_tokens, so the budget goes on
    // top of the answer's ceiling. At 0, thinking consumed it: plans came back
    // empty or truncated and Build Studio builds stalled in plan.
    return {
      settings: { thinkingConfig: { thinkingBudget: decision.budgetTokens } },
      extraMaxTokens: decision.budgetTokens,
      thinking: true,
      effortUnexpressed: false,
    };
  }

  // ── Local native transport — Ollama's `think` toggle ───────────────────────
  if (opts?.isLocalNative) {
    return {
      settings: { think: true },
      extraMaxTokens: 0,
      thinking: true,
      effortUnexpressed: false,
    };
  }

  // ── OpenRouter and providers with a native reasoning field ────────────────
  const shape = opensOwnReasoningField(providerId);
  if (shape === "openrouter") {
    return {
      settings: { reasoning: { effort: decision.level } },
      extraMaxTokens: 0,
      thinking: true,
      effortUnexpressed: false,
    };
  }
  if (shape === "native") {
    return {
      settings: { reasoning_effort: decision.level },
      extraMaxTokens: 0,
      thinking: true,
      effortUnexpressed: false,
    };
  }

  // No way to say it on this provider. Say THAT instead of staying quiet.
  return { ...NOTHING, effortUnexpressed: true };
}
