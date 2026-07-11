// EP-27FD96BC · P1 (BI-DA26BF90) — Unified per-turn effort-warrant signal.
//
// The spine. Before this module, a coworker turn's four effort knobs were set
// in four unrelated places:
//   - model tier / thinking ← reasoningDepth (routing/task-classifier → inferContract)
//   - iterations            ← a flat MAX_ITERATIONS = 200 constant (agentic-loop.ts)
//   - duration              ← which tools got *executed* so far (agentic-loop.ts)
//   - context budget tier   ← a route-string guess (context-arbitrator.ts)
// so a trivial "hi" and a complex build turn got the same 200-iteration / 120s
// envelope. This derives ONE per-turn EffortWarrant from the signals already
// present at the turn's single choke point, and the loop co-tunes iterations +
// duration from it. `toolBudgetTarget` and `contextTier` are carried as spine
// hooks the later pillars (P2 tool cap, P3 tools/skills, P4 delegation) consume;
// this BI establishes the object, the others tune against it.
//
// Pure — no I/O, no LLM. Deterministic ladders, monotonic across levels.

import type { ModelTier } from "./context-arbitrator";

export type ReasoningDepth = "minimal" | "low" | "medium" | "high";

/**
 * A single per-turn effort level. Ordered minimal < low < medium < high; every
 * co-tuned output rises monotonically with the level.
 */
export type EffortLevel = ReasoningDepth;

export interface EffortWarrant {
  /** The unified per-turn effort level. */
  level: EffortLevel;
  /** Pass-through hint for the model/thinking path (kept coherent with `level`). */
  reasoningDepth: ReasoningDepth;
  /** Loop iteration ceiling for this turn (always ≤ the hard safety ceiling). */
  maxIterations: number;
  /** Wall-clock baseline for this turn in ms (loop takes max with tool-revealed phase limits). */
  maxDurationMs: number;
  /** Context-arbitrator tier this effort warrants. */
  contextTier: ModelTier;
  /** Target attached-tool count — the spine hook P2/P3 rank toward. */
  toolBudgetTarget: number;
  /** Provenance: which signals raised/lowered the level. */
  signals: string[];
}

export interface EffortWarrantInput {
  /** The richest signal when available (content classifier). */
  reasoningDepth?: ReasoningDepth | null;
  /** Capability classifier output (tak/task-classifier taskType). */
  taskType?: string | null;
  /** Names of tools ATTACHED to the turn (not yet executed). */
  availableToolNames?: readonly string[];
  /** Length of the user turn's content, for a complexity proxy when depth is absent. */
  messageChars?: number;
}

// ─── Ladders (monotonic; index by level) ────────────────────────────────────

const LEVEL_ORDER: readonly EffortLevel[] = ["minimal", "low", "medium", "high"];

/** Absolute safety ceiling — mirrors agentic-loop.ts MAX_ITERATIONS. */
export const EFFORT_ITERATION_CEILING = 200;

const ITERATIONS: Record<EffortLevel, number> = {
  minimal: 20,
  low: 50,
  medium: 120,
  high: EFFORT_ITERATION_CEILING,
};

// Duration ladder mirrors the existing phase ceilings so the warrant is a
// coherent superset: a high turn matches the 600s build/plan ceiling, a minimal
// turn drops below the flat 120s conversation limit.
const DURATION_MS: Record<EffortLevel, number> = {
  minimal: 90_000,
  low: 150_000,
  medium: 300_000,
  high: 600_000,
};

const CONTEXT_TIER: Record<EffortLevel, ModelTier> = {
  minimal: "basic",
  low: "adequate",
  medium: "strong",
  high: "frontier",
};

// Tool-budget targets straddle the ~15-tool local accuracy cliff (P2 reuse):
// trivial turns want a lean surface, heavy turns tolerate more.
const TOOL_BUDGET_TARGET: Record<EffortLevel, number> = {
  minimal: 8,
  low: 12,
  medium: 15,
  high: 24,
};

// Heavy tool families — presence at turn start floors the level at `high` so a
// genuine build/plan turn is never iteration- or time-starved by a terse prompt.
// Kept in sync with the phase-duration detection in agentic-loop.ts.
const HEAVY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "launch_sandbox",
  "generate_code",
  "run_sandbox_tests",
  "write_sandbox_file",
  "edit_sandbox_file",
  "run_sandbox_command",
  "reviewBuildPlan",
  "reviewDesignDoc",
  "saveBuildEvidence",
]);

// taskType → base level when the content-classifier reasoningDepth is absent.
const TASK_TYPE_BASE: Record<string, EffortLevel> = {
  conversation: "minimal",
  greeting: "minimal",
  status: "low",
  lookup: "low",
  question: "low",
  analysis: "medium",
  planning: "medium",
  research: "medium",
  build: "high",
  code: "high",
  coding: "high",
};

const LONG_INPUT_CHARS = 1500;

function levelIndex(level: EffortLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

function maxLevel(a: EffortLevel, b: EffortLevel): EffortLevel {
  return levelIndex(a) >= levelIndex(b) ? a : b;
}

/**
 * Derive the unified per-turn effort warrant from the signals available at the
 * turn's choke point. Pure and deterministic.
 */
export function deriveEffortWarrant(input: EffortWarrantInput): EffortWarrant {
  const signals: string[] = [];

  // 1. Base level: prefer the content-classifier depth; else a taskType proxy;
  //    else a message-length proxy; else minimal.
  let level: EffortLevel;
  if (input.reasoningDepth) {
    level = input.reasoningDepth;
    signals.push(`depth:${input.reasoningDepth}`);
  } else if (input.taskType && TASK_TYPE_BASE[input.taskType]) {
    level = TASK_TYPE_BASE[input.taskType]!;
    signals.push(`taskType:${input.taskType}`);
  } else {
    level = "low";
    signals.push("default:low");
  }

  // 2. Length proxy can only RAISE (a long prompt implies more to reason about).
  if ((input.messageChars ?? 0) >= LONG_INPUT_CHARS) {
    const raised = maxLevel(level, "medium");
    if (raised !== level) signals.push("long-input");
    level = raised;
  }

  // 3. Heavy-tool floor — attached build/plan tools warrant a full envelope.
  const heavy = (input.availableToolNames ?? []).some((n) => HEAVY_TOOL_NAMES.has(n));
  if (heavy) {
    const raised = maxLevel(level, "high");
    if (raised !== level) signals.push("heavy-tools");
    level = raised;
  }

  return {
    level,
    reasoningDepth: input.reasoningDepth ?? level,
    maxIterations: Math.min(EFFORT_ITERATION_CEILING, ITERATIONS[level]),
    maxDurationMs: DURATION_MS[level],
    contextTier: CONTEXT_TIER[level],
    toolBudgetTarget: TOOL_BUDGET_TARGET[level],
    signals,
  };
}
