// apps/web/lib/tak/context-pressure.ts
//
// Observability-only "dumb zone" gauge for the agentic loop.
//
// Large models degrade once their context fills past a model-specific band (the
// "dumb zone") — but the loop never measured how full the assembled prompt was,
// so drift into that band was silent. This estimates the assembled prompt's
// token load (~chars/4, matching the codebase's other estimators) and bands it
// into a heuristic pressure zone for per-dispatch logging.
//
// IMPORTANT: nothing here changes what is sent to the model. The loop's
// compaction (compactAgenticMessages) already bounds the history; this only
// makes the resulting fill visible so a regression (a ballooning system prompt,
// a bumped history cap) is observable instead of silent. The loop is
// model-agnostic at its layer — the routing pipeline resolves the concrete
// model + context window below it — so the thresholds are heuristic,
// model-agnostic hints, NOT hard limits. A follow-up can thread the resolved
// model's real maxContextTokens for a precise ratio-of-window signal.
//
// Pure module — no imports, no I/O — so it is unit-tested directly without the
// loop's heavy dependency graph.
//
// From the 2026-06-19 agent-architecture review (dumb-zone observability).

/**
 * Minimal structural shape of a chat message. Declared locally (rather than
 * importing ChatMessage) so this module stays free of the loop's import graph
 * and remains trivially unit-testable. ChatMessage is structurally assignable.
 */
export type ContextMessageLike = {
  role?: string;
  content?: unknown;
  toolCalls?: unknown[] | null;
};

export type ContextPressureZone = "sharp" | "warning" | "dumb";

export type ContextPressure = {
  estimatedTokens: number;
  zone: ContextPressureZone;
};

// Heuristic, model-agnostic dumb-zone hints in estimated tokens — NOT hard
// limits, and deliberately conservative so the gauge flags genuinely large
// contexts without crying wolf on frontier models. Tunable; a precise
// per-model ratio is a tracked follow-up.
export const CONTEXT_WARNING_ZONE_TOKENS = 100_000;
export const CONTEXT_DUMB_ZONE_TOKENS = 180_000;

/**
 * Rough token estimate (~chars/4) for the assembled prompt actually sent to the
 * model this dispatch: the system prompt plus every message's content, plus any
 * assistant tool-call payloads. Pure.
 */
export function estimateContextTokens(
  messages: readonly ContextMessageLike[],
  systemPrompt: string,
): number {
  let chars = systemPrompt.length;
  for (const m of messages) {
    chars +=
      typeof m.content === "string"
        ? m.content.length
        : JSON.stringify(m.content ?? "").length;
    if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      chars += JSON.stringify(m.toolCalls).length;
    }
  }
  return Math.ceil(chars / 4);
}

/** Band an estimated token load into a dumb-zone pressure zone. Pure. */
export function classifyContextPressure(estimatedTokens: number): ContextPressure {
  const zone: ContextPressureZone =
    estimatedTokens >= CONTEXT_DUMB_ZONE_TOKENS
      ? "dumb"
      : estimatedTokens >= CONTEXT_WARNING_ZONE_TOKENS
        ? "warning"
        : "sharp";
  return { estimatedTokens, zone };
}
