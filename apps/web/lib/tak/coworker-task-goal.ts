// Coworker goal / stop-condition primitive — BI-D6F6A313 (EP-CLAUDE-INSIDE-OUT).
//
// The external Claude harness /goal attaches a natural-language completion
// condition to a task and blocks stopping until that condition verifiably holds,
// re-invoking the agent each turn. The DPF analog persists the condition as a
// CoworkerTaskGoal and evaluates a produced output against it with a real judge
// (the coworker-inline-review shape) — so an autonomous coworker is judged
// "met/unmet" against a verifiable condition instead of self-declaring done.
//
// This module keeps the prompt-build + verdict-interpret logic PURE (testable
// without the inference layer); the single IO function `evaluateCoworkerGoal`
// wires the judge (routeAndCall) and persistence. Slice 1 evaluates on demand
// via the MCP door; wiring the autonomous completion seam to auto-evaluate and
// gate re-dispatch is Slice 2 (tracked as a follow-up BI).

import { prisma } from "@dpf/db";

import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { ChatMessage } from "@/lib/ai-inference";
import { routeAndCall } from "@/lib/inference/routed-inference";

/** Closed status vocabulary for a goal's lifecycle. */
export const GOAL_STATUSES = ["active", "met", "unmet", "abandoned"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type GoalVerdict = {
  /** Whether the judge decided the condition is satisfied by the output. */
  met: boolean;
  /** The judge's one-line rationale (for audit + operator visibility). */
  rationale: string;
};

/**
 * Pure: build the judge prompt that decides whether `output` satisfies the
 * goal `condition`. The judge must answer with a leading VERDICT token so the
 * interpretation is deterministic and provider-agnostic.
 */
export function buildGoalJudgePrompt(condition: string, output: string): { system: string; user: string } {
  const system =
    "You are a strict completion judge. You are given a GOAL (a verifiable " +
    "completion condition) and the OUTPUT a worker produced. Decide whether the " +
    "output actually satisfies the goal. Be literal — do not give credit for " +
    "intent, partial progress, or a promise to do it later. Respond with exactly " +
    "one line: 'VERDICT: MET — <reason>' or 'VERDICT: UNMET — <reason>'.";
  const user = `GOAL:\n${condition}\n\nOUTPUT:\n${output}`;
  return { system, user };
}

/**
 * Pure: interpret a judge reply into a verdict. Defaults to UNMET when the reply
 * is missing or ambiguous — a goal is only "met" on an explicit MET verdict, so
 * an unparseable judge reply never lets an unfinished goal pass.
 */
export function interpretGoalVerdict(raw: string): GoalVerdict {
  const text = (raw ?? "").trim();
  const match = text.match(/VERDICT:\s*(MET|UNMET)\s*(?:[—:-]\s*)?(.*)$/im);
  if (!match) {
    return { met: false, rationale: text ? `Unparseable judge verdict: ${text.slice(0, 200)}` : "No judge verdict." };
  }
  const met = match[1].toUpperCase() === "MET";
  const rationale = (match[2] ?? "").trim() || (met ? "Condition satisfied." : "Condition not satisfied.");
  return { met, rationale };
}

/** Pure: map a boolean verdict to the persisted goal status. */
export function classifyGoalStatus(met: boolean): Extract<GoalStatus, "met" | "unmet"> {
  return met ? "met" : "unmet";
}

/**
 * Create a goal for a coworker (by Agent.id cuid). `condition` is required; an
 * empty condition is rejected so a goal always carries something to judge.
 */
export async function createCoworkerGoal(params: {
  agentCuid: string;
  condition: string;
  scheduledTaskId?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: true; goalId: string } | { ok: false; error: string }> {
  const condition = (params.condition ?? "").trim();
  if (!condition) return { ok: false, error: "Goal condition must not be empty." };
  const goal = await prisma.coworkerTaskGoal.create({
    data: {
      agentId: params.agentCuid,
      condition,
      scheduledTaskId: params.scheduledTaskId ?? null,
      createdBy: params.createdBy ?? null,
    },
    select: { id: true },
  });
  return { ok: true, goalId: goal.id };
}

export type CoworkerGoalRecord = {
  id: string;
  condition: string;
  status: GoalStatus;
  verdictRationale: string | null;
};

/** List a coworker's active (unresolved) goals, newest first. */
export async function listActiveGoals(agentCuid: string): Promise<CoworkerGoalRecord[]> {
  const rows = await prisma.coworkerTaskGoal.findMany({
    where: { agentId: agentCuid, status: "active" },
    orderBy: { createdAt: "desc" },
    select: { id: true, condition: true, status: true, verdictRationale: true },
  });
  return rows.map((r) => ({ ...r, status: r.status as GoalStatus }));
}

/**
 * Evaluate one goal against a produced `output`. Loads the goal, runs the judge
 * (routeAndCall — the same bounded, capable-model call the inline-review pass
 * uses, with NO agentId so it cannot recurse into a coworker's posture), then
 * persists the verdict (status met|unmet, rationale, lastEvaluatedAt; resolvedAt
 * when met). Fail-closed on error: the goal stays active and unmet so a failed
 * judge never marks a goal satisfied. `judge` is injectable for tests.
 */
export async function evaluateCoworkerGoal(params: {
  goalId: string;
  output: string;
  sensitivity: RouteSensitivity;
  judge?: (system: string, user: string, sensitivity: RouteSensitivity) => Promise<string>;
}): Promise<{ ok: true; status: GoalStatus; rationale: string } | { ok: false; error: string }> {
  const goal = await prisma.coworkerTaskGoal.findUnique({
    where: { id: params.goalId },
    select: { id: true, condition: true },
  });
  if (!goal) return { ok: false, error: `No goal ${params.goalId}.` };

  const { system, user } = buildGoalJudgePrompt(goal.condition, params.output ?? "");
  const judge = params.judge ?? defaultGoalJudge;

  let verdict: GoalVerdict;
  try {
    const raw = await judge(system, user, params.sensitivity);
    verdict = interpretGoalVerdict(raw);
  } catch (err) {
    console.warn("[coworker-goal] judge failed (fail-closed, goal stays unmet):", err);
    return { ok: false, error: err instanceof Error ? err.message : "Goal judge failed." };
  }

  const status = classifyGoalStatus(verdict.met);
  await prisma.coworkerTaskGoal.update({
    where: { id: goal.id },
    data: {
      status,
      verdictRationale: verdict.rationale,
      lastEvaluatedAt: new Date(),
      ...(verdict.met ? { resolvedAt: new Date() } : {}),
    },
  });
  return { ok: true, status, rationale: verdict.rationale };
}

/** The production judge: one bounded, capable-model call, no agentId. */
async function defaultGoalJudge(system: string, user: string, sensitivity: RouteSensitivity): Promise<string> {
  const messages: ChatMessage[] = [{ role: "user", content: user }];
  const result = await routeAndCall(messages, system, sensitivity, {
    taskType: "review",
    modelTier: "robust",
    effort: "high",
    routingActor: { kind: "system", id: "coworker-goal-judge" },
  });
  return result.content;
}
