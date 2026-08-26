// apps/web/lib/tak/context-economy-metrics.ts
//
// Observability-only context-economy metrics for the agentic loop (R8 / P12,
// docs/architecture/context-engineering-standards.md). The standard says to
// MEASURE whether context/tool changes help — tokens-per-task, task success,
// and tool-selection accuracy — and to watch the tool-count cliff, because
// selection accuracy does not degrade gracefully: it collapses once a small
// local model is handed more than ~15 tools.
//
// This makes two of those signals visible per turn:
//   1. the TOOL SURFACE handed to the model (count + estimated definition-token
//      cost + a zone banded against the local selection cliff and the window);
//   2. per-turn TOOL-SELECTION ACCURACY (succeeded / attempted tool calls).
//
// Like context-pressure.ts, nothing here changes what is sent to the model — it
// only makes the figures observable so a regression (an agent's surface
// ballooning past the cliff, a tool that keeps failing) is loud instead of
// silent. Pure module — no imports, no I/O — so it is unit-tested directly
// without the loop's heavy dependency graph. The cross-task tokens-per-task
// rollup is the staged Phase-2 companion (needs a telemetry query).

// The point past which small local models' tool-selection accuracy collapses,
// and below which the local fallback chain is even attempted. Kept here so this
// module stays import-free; `resolveLocalToolCeiling` below is the single place
// the effective ceiling is derived, and both the attachment budget
// (coworker-tool-budget.ts) and the routing gate (routing/fallback.ts) call it.
export const LOCAL_TOOL_SELECTION_CLIFF = 15;

/**
 * Whether a local generation model is in the serving path for this turn.
 *
 * The distinction that matters is `absent` vs `unknown` (BI-A8BFEFCE). Callers
 * used to report both as a null served-context window, and the cap derivation
 * read that null as "pure cloud turn" and lifted the attached surface to the
 * full 48 — the one value guaranteed to make the routing layer refuse the local
 * fallback. So a failed READ of local capacity silently deleted local from the
 * chain, and a cloud rate-limit on top of it produced a turn that executed
 * nothing at all. `unknown` must therefore behave like `present`, not `absent`.
 */
export type LocalPresence = "present" | "absent" | "unknown";

/**
 * The largest attached tool surface a LOCAL model may be handed — the SINGLE
 * source of the local tool ceiling (INV-6).
 *
 * A small local model is cliff-prone by CLASS, so the fail-safe is the selection
 * cliff. Only MEASURED tool-selection fidelity evidence (produced by the eval
 * harness, persisted on `ModelProfile.customScores`) lifts it; a bigger context
 * window never does — capacity is not fidelity.
 *
 * Both consumers call this so they cannot drift apart. Before it existed the
 * budget honoured a measured ceiling while the gate hardcoded the raw cliff, so
 * the moment fidelity was measured above 15 the budget would attach more tools
 * than the gate would agree to run. Pure.
 */
export function resolveLocalToolCeiling(
  measuredToolFidelityCeiling?: number | null,
): number {
  const measured = measuredToolFidelityCeiling;
  if (typeof measured !== "number" || !Number.isFinite(measured) || measured <= 0) {
    return LOCAL_TOOL_SELECTION_CLIFF;
  }
  return Math.floor(measured);
}

const CHARS_PER_TOKEN = 4;
// Share of a known window the tool DEFINITIONS may occupy before the surface is
// "overload" / "caution". Definitions are a standing tax paid on every dispatch.
const SURFACE_OVERLOAD_WINDOW_SHARE = 0.25;
const SURFACE_CAUTION_WINDOW_SHARE = 0.15;
// Fraction of the cliff at which to start cautioning on raw count.
const SURFACE_CAUTION_COUNT_RATIO = 0.7;

export type ToolSurfaceZone = "lean" | "caution" | "overload";

export type ToolSurfaceAssessment = {
  toolCount: number;
  /** Estimated tokens the tool definitions consume in the prompt (~chars/4). */
  estDefinitionTokens: number;
  /** True once the surface passes the local selection cliff. */
  exceedsLocalCliff: boolean;
  /** estDefinitionTokens / window, when the real window is known; else null. */
  windowShare: number | null;
  zone: ToolSurfaceZone;
};

/**
 * Estimate the token cost of the tool definitions actually sent this dispatch.
 * Accepts the provider-format tool array (or any serialisable shape); ~chars/4,
 * matching the codebase's other estimators. Pure.
 */
export function estimateToolDefinitionTokens(tools: readonly unknown[] | null | undefined): number {
  if (!tools || tools.length === 0) return 0;
  let chars: number;
  try {
    chars = JSON.stringify(tools).length;
  } catch {
    return 0;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Assess the tool surface handed to the model: count, estimated definition-token
 * cost, whether it passes the local selection cliff, and a heuristic zone.
 * Banded by the local cliff (count) and, when the real window is known, by the
 * definitions' share of it. Pure.
 */
export function assessToolSurface(input: {
  tools: readonly unknown[] | null | undefined;
  windowTokens?: number | null;
}): ToolSurfaceAssessment {
  const toolCount = input.tools?.length ?? 0;
  const estDefinitionTokens = estimateToolDefinitionTokens(input.tools);
  const exceedsLocalCliff = toolCount > LOCAL_TOOL_SELECTION_CLIFF;
  const win = typeof input.windowTokens === "number" && input.windowTokens > 0 ? input.windowTokens : 0;
  const windowShare = win > 0 ? estDefinitionTokens / win : null;

  // The raw-count cliff (LOCAL_TOOL_SELECTION_CLIFF) is a PROXY for "a small
  // local model with a small window" — the regime where selection accuracy
  // collapses past ~15 tools. When the REAL window is known, its definition-
  // share is the authoritative signal and supersedes the proxy: a 68-tool
  // surface that occupies 8% of a large cloud window is genuinely lean for the
  // model that will serve it, even though it exceeds the local cliff. Applying
  // the count cliff unconditionally mis-flagged every cloud-served coworker as
  // "overload" forever (BI-3346DC28), because the mandatory read baseline alone
  // already exceeds the cliff. So band by windowShare when the window is known;
  // fall back to the count cliff only when it is not.
  let zone: ToolSurfaceZone = "lean";
  if (windowShare !== null) {
    if (windowShare >= SURFACE_OVERLOAD_WINDOW_SHARE) zone = "overload";
    else if (windowShare >= SURFACE_CAUTION_WINDOW_SHARE) zone = "caution";
  } else if (exceedsLocalCliff) {
    zone = "overload";
  } else if (toolCount > Math.floor(LOCAL_TOOL_SELECTION_CLIFF * SURFACE_CAUTION_COUNT_RATIO)) {
    zone = "caution";
  }
  return { toolCount, estDefinitionTokens, exceedsLocalCliff, windowShare, zone };
}

export type ToolCallSample = { toolName: string; success: boolean };

export type ToolSelectionAccuracy = {
  total: number;
  succeeded: number;
  /** succeeded / total, in [0,1]; 1 when there were no calls (nothing failed). */
  accuracy: number;
  perTool: Record<string, { total: number; succeeded: number; accuracy: number }>;
};

export function contextEconomyTurnMetricFields(
  ctxPeakTokens: number,
  ctxWindowTokens: number | null,
  surface: ToolSurfaceAssessment,
  accuracy: ToolSelectionAccuracy,
) {
  return {
    ctxPeakTokens,
    ctxWindowTokens,
    toolSurfaceCount: surface.toolCount,
    toolDefinitionTokens: surface.estDefinitionTokens,
    toolSurfaceExceedsLocalCliff: surface.exceedsLocalCliff,
    toolSurfaceWindowShare: surface.windowShare,
    toolSelectionAccuracy: accuracy.total === 0 ? null : accuracy.accuracy,
  };
}

/**
 * Tool-selection / tool-call accuracy over a set of executed tool calls: the
 * fraction that succeeded, overall and per tool. Used per-turn (over the turn's
 * executed tools) and, in Phase 2, over a telemetry window. Pure.
 */
export function computeToolSelectionAccuracy(
  executions: readonly ToolCallSample[] | null | undefined,
): ToolSelectionAccuracy {
  const perTool: Record<string, { total: number; succeeded: number; accuracy: number }> = {};
  let total = 0;
  let succeeded = 0;
  for (const e of executions ?? []) {
    if (!e || typeof e.toolName !== "string") continue;
    total += 1;
    const ok = e.success === true;
    if (ok) succeeded += 1;
    const row = perTool[e.toolName] ?? { total: 0, succeeded: 0, accuracy: 0 };
    row.total += 1;
    if (ok) row.succeeded += 1;
    row.accuracy = row.succeeded / row.total;
    perTool[e.toolName] = row;
  }
  return { total, succeeded, accuracy: total === 0 ? 1 : succeeded / total, perTool };
}
