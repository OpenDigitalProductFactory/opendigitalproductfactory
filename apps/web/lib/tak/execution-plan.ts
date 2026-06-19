// apps/web/lib/tak/execution-plan.ts
//
// BI-2AC48661 (EP-F7E35344 — AI Coworker Capability Inputs).
//
// A persistent ExecutionPlan for the agentic loop. The loop compacts message
// history to a sliding window of the last MAX_AGENTIC_HISTORY_MESSAGES every
// iteration, so on a long, comprehensive task the model loses sight of the
// original objective and re-derives intent from whatever survived the window.
// Perplexity's Pro/Deep-Research mode separates *planning* from *execution*:
// an explicit plan (objectives + steps) is authored once, then an execution
// loop works the plan and refines it — the plan is a durable artifact, not a
// message that scrolls out of context.
//
// This module is the plan artifact + the pure logic around it. The agentic
// loop holds one ExecutionPlan in loop state (not in the compacted message
// array), renders it into the prompt fresh every iteration (so it ALWAYS
// survives compaction), and gates completion on open steps rather than on a
// bare text-only reply. The two plan tools below are intercepted inside the
// loop — they mutate loop state and never reach governedExecuteTool, so they
// need no capability grant and write no audit row.
//
// Everything here is pure and synchronous, so it is fully unit-testable
// without a running model, sandbox, or DB. Mutators return new objects and
// never mutate their input.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

export type ExecutionPlanStepStatus = "pending" | "in_progress" | "done" | "skipped";

/** A step is "open" while it still needs work — pending or in_progress. */
const OPEN_STATUSES: ReadonlySet<ExecutionPlanStepStatus> = new Set(["pending", "in_progress"]);

export type ExecutionPlanStep = {
  id: string;
  description: string;
  status: ExecutionPlanStepStatus;
};

export type ExecutionPlan = {
  goal: string;
  steps: ExecutionPlanStep[];
  /** Loop iteration the plan was first recorded — for observability only. */
  createdAtIteration: number;
  /** Loop iteration the plan was last mutated — for observability only. */
  updatedAtIteration: number;
};

export const RECORD_PLAN_TOOL = "record_execution_plan";
export const UPDATE_PLAN_STEP_TOOL = "update_execution_plan_step";

/** Tool names the agentic loop intercepts and handles in-process. */
export const EXECUTION_PLAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  RECORD_PLAN_TOOL,
  UPDATE_PLAN_STEP_TOOL,
]);

const MAX_STEPS = 25;
const MAX_GOAL_CHARS = 500;
const MAX_STEP_CHARS = 300;

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function normaliseStatus(raw: unknown): ExecutionPlanStepStatus | null {
  if (raw === "pending" || raw === "in_progress" || raw === "done" || raw === "skipped") {
    return raw;
  }
  // Tolerate common model variants rather than rejecting the call outright.
  if (raw === "in-progress" || raw === "started" || raw === "active") return "in_progress";
  if (raw === "complete" || raw === "completed" || raw === "finished") return "done";
  if (raw === "skip" || raw === "skipped" || raw === "cancelled" || raw === "canceled") return "skipped";
  if (raw === "todo" || raw === "open" || raw === "not_started") return "pending";
  return null;
}

/**
 * Build a plan from a model-supplied goal + step descriptions. Step ids are
 * assigned deterministically ("s1", "s2", …) so the model can reference them
 * in update_execution_plan_step without us trusting model-authored ids.
 */
export function createExecutionPlan(
  input: { goal: unknown; steps: unknown },
  iteration: number,
): ExecutionPlan | null {
  const goal = typeof input.goal === "string" ? clamp(input.goal, MAX_GOAL_CHARS) : "";
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps: ExecutionPlanStep[] = [];
  for (const raw of rawSteps) {
    if (steps.length >= MAX_STEPS) break;
    const description =
      typeof raw === "string"
        ? clamp(raw, MAX_STEP_CHARS)
        : raw && typeof raw === "object" && typeof (raw as { description?: unknown }).description === "string"
          ? clamp((raw as { description: string }).description, MAX_STEP_CHARS)
          : "";
    if (!description) continue;
    steps.push({ id: `s${steps.length + 1}`, description, status: "pending" });
  }
  if (steps.length === 0) return null;
  return {
    goal,
    steps,
    createdAtIteration: iteration,
    updatedAtIteration: iteration,
  };
}

/** Return a new plan with one step's status changed. No-op clone if id unknown. */
export function updateStepStatus(
  plan: ExecutionPlan,
  stepId: string,
  status: ExecutionPlanStepStatus,
  iteration: number,
): ExecutionPlan {
  let changed = false;
  const steps = plan.steps.map((step) => {
    if (step.id !== stepId || step.status === status) return step;
    changed = true;
    return { ...step, status };
  });
  return { ...plan, steps, updatedAtIteration: changed ? iteration : plan.updatedAtIteration };
}

export function openSteps(plan: ExecutionPlan): ExecutionPlanStep[] {
  return plan.steps.filter((step) => OPEN_STATUSES.has(step.status));
}

/** The plan is complete when no step is still pending or in_progress. */
export function isPlanComplete(plan: ExecutionPlan): boolean {
  return openSteps(plan).length === 0;
}

export function nextOpenStep(plan: ExecutionPlan): ExecutionPlanStep | null {
  // Prefer an in_progress step, else the first pending one.
  return (
    plan.steps.find((step) => step.status === "in_progress") ??
    plan.steps.find((step) => step.status === "pending") ??
    null
  );
}

export function planProgress(plan: ExecutionPlan): { done: number; total: number; open: number } {
  const total = plan.steps.length;
  const open = openSteps(plan).length;
  return { done: total - open, total, open };
}

const STATUS_GLYPH: Record<ExecutionPlanStepStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  done: "[x]",
  skipped: "[-]",
};

/**
 * Render the plan as a compact reminder block. The loop appends this as an
 * ephemeral message every iteration — it is NOT stored in the persisted
 * message array, so it is regenerated from current state each turn and can
 * never be compacted away. This is the "reads the plan outside the compacted
 * window" mechanism.
 */
export function renderPlanReminder(plan: ExecutionPlan): string {
  const { done, total } = planProgress(plan);
  const lines = plan.steps.map((step) => `  ${STATUS_GLYPH[step.status]} ${step.id}: ${step.description}`);
  const next = nextOpenStep(plan);
  const footer = next
    ? `Next open step: ${next.id} — ${next.description}. When you finish a step call ${UPDATE_PLAN_STEP_TOOL} ` +
      `with its status, then keep working. Do not stop until every step is done or skipped.`
    : `All steps are done or skipped — you may now give your final summary.`;
  return (
    `## Execution plan (${done}/${total} complete)\n` +
    `Goal: ${plan.goal || "(unstated)"}\n` +
    `${lines.join("\n")}\n` +
    footer
  );
}

/** Shown when planning is enabled but the model has not recorded a plan yet. */
export function renderNoPlanReminder(): string {
  return (
    `## Execution plan\n` +
    `No execution plan recorded yet. For any multi-step task, call ${RECORD_PLAN_TOOL} ` +
    `with a short goal and an ordered list of concrete steps BEFORE doing the work, ` +
    `then work the steps and mark each one with ${UPDATE_PLAN_STEP_TOOL} as you go. ` +
    `Skip this only for a trivial single-step request.`
  );
}

/**
 * Apply an intercepted plan tool call to loop state. Returns the next plan and
 * a synthetic ToolResult to feed back to the model. Pure — caller owns state.
 */
export function applyPlanToolCall(
  plan: ExecutionPlan | null,
  toolName: string,
  args: Record<string, unknown>,
  iteration: number,
): { plan: ExecutionPlan | null; result: ToolResult } {
  if (toolName === RECORD_PLAN_TOOL) {
    const next = createExecutionPlan({ goal: args.goal, steps: args.steps }, iteration);
    if (!next) {
      return {
        plan,
        result: {
          success: false,
          error: "invalid_plan",
          message: `${RECORD_PLAN_TOOL} needs a non-empty "steps" array of step descriptions.`,
        },
      };
    }
    const { done, total } = planProgress(next);
    return {
      plan: next,
      result: {
        success: true,
        message: `Execution plan recorded: ${total} step(s), ${done} already complete. ${renderPlanReminder(next)}`,
        data: { goal: next.goal, steps: next.steps },
      },
    };
  }

  if (toolName === UPDATE_PLAN_STEP_TOOL) {
    if (!plan) {
      return {
        plan,
        result: {
          success: false,
          error: "no_plan",
          message: `No execution plan exists yet — call ${RECORD_PLAN_TOOL} first.`,
        },
      };
    }
    const stepId = typeof args.stepId === "string" ? args.stepId : "";
    const status = normaliseStatus(args.status);
    if (!stepId || !status) {
      return {
        plan,
        result: {
          success: false,
          error: "invalid_update",
          message: `${UPDATE_PLAN_STEP_TOOL} needs "stepId" and a "status" of pending|in_progress|done|skipped.`,
        },
      };
    }
    if (!plan.steps.some((step) => step.id === stepId)) {
      return {
        plan,
        result: {
          success: false,
          error: "unknown_step",
          message: `No step "${stepId}" in the plan. Valid ids: ${plan.steps.map((s) => s.id).join(", ")}.`,
        },
      };
    }
    const next = updateStepStatus(plan, stepId, status, iteration);
    return {
      plan: next,
      result: {
        success: true,
        message: `Step ${stepId} → ${status}. ${renderPlanReminder(next)}`,
        data: { steps: next.steps },
      },
    };
  }

  return {
    plan,
    result: { success: false, error: "unknown_tool", message: `${toolName} is not an execution-plan tool.` },
  };
}

/**
 * Completion gate. Called when the model returns text-only (its natural
 * "done" signal). With a plan that still has open steps, the loop should nudge
 * the model back to work rather than accept the stop — UNLESS we have already
 * spent the plan-nudge budget (avoids an infinite plan-vs-model standoff).
 */
export function planCompletionGate(params: {
  plan: ExecutionPlan | null;
  planNudges: number;
  maxPlanNudges: number;
}): { action: "complete" | "nudge"; nudge?: string } {
  const { plan, planNudges, maxPlanNudges } = params;
  if (!plan) return { action: "complete" };
  if (isPlanComplete(plan)) return { action: "complete" };
  if (planNudges >= maxPlanNudges) return { action: "complete" };
  const next = nextOpenStep(plan);
  const { done, total } = planProgress(plan);
  return {
    action: "nudge",
    nudge:
      `Your execution plan still has open steps (${done}/${total} done). Do not stop yet. ` +
      (next ? `Continue with ${next.id}: ${next.description}. ` : "") +
      `Use your tools to complete it, then mark it with ${UPDATE_PLAN_STEP_TOOL}. ` +
      `If a step genuinely cannot be done, mark it "skipped" with ${UPDATE_PLAN_STEP_TOOL} and explain why.`,
  };
}

const STEP_STATUS_VALUES: ExecutionPlanStepStatus[] = ["pending", "in_progress", "done", "skipped"];

/** ToolDefinition objects for the two plan tools (loop-intrinsic, no capability gate). */
export const EXECUTION_PLAN_TOOL_DEFS: ToolDefinition[] = [
  {
    name: RECORD_PLAN_TOOL,
    description:
      "Record an execution plan for a multi-step task: a short goal and an ordered list of concrete steps. " +
      "Call this BEFORE starting the work. The plan persists across the whole task and is shown to you every turn, " +
      "even after older messages scroll out of context. Re-call it to replace the plan if scope changes materially.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "One sentence: what completing this task achieves." },
        steps: {
          type: "array",
          description: "Ordered concrete steps. Each is a short imperative phrase.",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_STEPS,
        },
      },
      required: ["steps"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: UPDATE_PLAN_STEP_TOOL,
    description:
      "Update one execution-plan step's status as you make progress. Mark a step in_progress when you start it " +
      "and done when it is verifiably complete (or skipped if it genuinely cannot be done). The loop will not let " +
      "you stop while steps remain open.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string", description: 'The step id from the plan, e.g. "s2".' },
        status: { type: "string", enum: STEP_STATUS_VALUES },
      },
      required: ["stepId", "status"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
];

/** OpenAI-wire-format versions for toolsForProvider (matches toolsToOpenAIFormat). */
export function executionPlanProviderTools(): Array<Record<string, unknown>> {
  return EXECUTION_PLAN_TOOL_DEFS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
