// Coworker goal / stop-condition pack — BI-D6F6A313 (EP-CLAUDE-INSIDE-OUT).
//
// Self-scoped door to a coworker's own verifiable completion conditions:
//   • set_task_goal      — the calling coworker attaches a goal to ITSELF
//   • list_task_goals    — the calling coworker reads its OWN active goals
//   • evaluate_task_goal — judge a produced output against one of the caller's
//                          OWN goals; persists met|unmet + rationale
//
// Self-scoped by construction: every handler resolves the target from
// context.agentId and ignores any caller-supplied agent, so a coworker can only
// touch its own goals. Like record_working_note, these need no special grant — a
// coworker setting or checking its own completion condition cannot exceed its
// authority. A non-agent caller (no context.agentId) is rejected.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "set_task_goal",
    description:
      "Attach a verifiable completion condition (a 'goal') to YOURSELF (the calling coworker). State the condition so it can be judged literally satisfied or not — e.g. 'A MarketingCampaignBrief row for the summer campaign exists with a non-empty body'. Use before autonomous work so completion is judged against the condition, not self-declared.",
    inputSchema: {
      type: "object",
      properties: {
        condition: {
          type: "string",
          description: "The verifiable completion condition, stated so a judge can decide MET or UNMET.",
        },
        scheduledTaskId: {
          type: "string",
          description: "Optional id of the ScheduledAgentTask this goal gates.",
        },
      },
      required: ["condition"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "list_task_goals",
    description: "List YOUR OWN active goals (the calling coworker's unresolved completion conditions), newest first.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: null,
    sideEffect: false,
  },
  {
    name: "evaluate_task_goal",
    description:
      "Judge a produced OUTPUT against one of YOUR OWN goals. Returns met|unmet plus a rationale and records the verdict. Use to check whether work actually satisfies the condition before declaring done.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "The id of your goal to evaluate (from list_task_goals)." },
        output: { type: "string", description: "The produced output to judge against the goal condition." },
      },
      required: ["goalId", "output"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
];

async function resolveCallerCuid(agentId: string | undefined): Promise<string | null> {
  if (!agentId) return null;
  const { resolveCoworkerAgent } = await import("@/lib/tak/coworker-tool-grant-core");
  const target = await resolveCoworkerAgent(agentId);
  return target?.id ?? null;
}

const NO_COWORKER: ToolResult = {
  success: false,
  error: "no_calling_coworker",
  message: "Only a coworker can manage its own goals.",
};

async function setTaskGoalHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const agentCuid = await resolveCallerCuid(context?.agentId);
  if (!agentCuid) return NO_COWORKER;
  const { createCoworkerGoal } = await import("@/lib/tak/coworker-task-goal");
  const res = await createCoworkerGoal({
    agentCuid,
    condition: String(params["condition"] ?? ""),
    scheduledTaskId: params["scheduledTaskId"] != null ? String(params["scheduledTaskId"]) : null,
    createdBy: userId || null,
  });
  if (!res.ok) return { success: false, error: "goal_write_failed", message: res.error };
  return { success: true, message: "Goal set.", data: { goalId: res.goalId } };
}

async function listTaskGoalsHandler(
  _params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const agentCuid = await resolveCallerCuid(context?.agentId);
  if (!agentCuid) return NO_COWORKER;
  const { listActiveGoals } = await import("@/lib/tak/coworker-task-goal");
  const goals = await listActiveGoals(agentCuid);
  return {
    success: true,
    message: goals.length ? `You have ${goals.length} active goal(s).` : "You have no active goals.",
    data: { goals: goals.map((g) => ({ goalId: g.id, condition: g.condition })) },
  };
}

async function evaluateTaskGoalHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const agentCuid = await resolveCallerCuid(context?.agentId);
  if (!agentCuid) return NO_COWORKER;
  const goalId = String(params["goalId"] ?? "").trim();
  if (!goalId) return { success: false, error: "missing_goal", message: "Provide the goalId to evaluate." };

  // Self-scope guard: the goal must belong to the calling coworker.
  const { prisma } = await import("@dpf/db");
  const owner = await prisma.coworkerTaskGoal.findUnique({ where: { id: goalId }, select: { agentId: true } });
  if (!owner || owner.agentId !== agentCuid) {
    return { success: false, error: "goal_not_found", message: "No goal of yours matches that id." };
  }

  const { evaluateCoworkerGoal } = await import("@/lib/tak/coworker-task-goal");
  const res = await evaluateCoworkerGoal({
    goalId,
    output: String(params["output"] ?? ""),
    sensitivity: "internal",
  });
  if (!res.ok) return { success: false, error: "goal_eval_failed", message: res.error };
  return {
    success: true,
    message: res.status === "met" ? "Goal met." : "Goal not yet met.",
    data: { status: res.status, rationale: res.rationale },
  };
}

export const coworkerGoalPack: ToolPack = {
  packId: "coworker-goal",
  definitions,
  handlers: {
    set_task_goal: (params, userId, context) => setTaskGoalHandler(params, userId, context),
    list_task_goals: (params, userId, context) => listTaskGoalsHandler(params, userId, context),
    evaluate_task_goal: (params, userId, context) => evaluateTaskGoalHandler(params, userId, context),
  },
  grants: { set_task_goal: [], list_task_goals: [], evaluate_task_goal: [] },
};
