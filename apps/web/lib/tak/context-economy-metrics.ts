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

// Mirrors LOCAL_FALLBACK_MAX_TOOLS (apps/web/lib/routing/fallback.ts) — the
// point past which small local models' tool-selection accuracy collapses, and
// below which the local fallback chain is even attempted. Kept local so this
// module stays import-free; a test asserts the value stays in sync if both move.
export const LOCAL_TOOL_SELECTION_CLIFF = 15;

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

  let zone: ToolSurfaceZone = "lean";
  if (exceedsLocalCliff || (windowShare !== null && windowShare >= SURFACE_OVERLOAD_WINDOW_SHARE)) {
    zone = "overload";
  } else if (
    toolCount > Math.floor(LOCAL_TOOL_SELECTION_CLIFF * SURFACE_CAUTION_COUNT_RATIO) ||
    (windowShare !== null && windowShare >= SURFACE_CAUTION_WINDOW_SHARE)
  ) {
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
