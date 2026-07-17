// Scheduled-task source — recurring coworker work that failed and should be
// brought forward when its proactivity policy is not quiet.

import type { prisma } from "@dpf/db";
import { resolveProactivityPlanForLevel } from "@/lib/proactivity/proactivity-resolver";
import type { ProactivityPlan, ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type ScheduledTaskAttentionRow = {
  taskId: string;
  title: string;
  agentId: string;
  routeContext: string;
  ownerUserId: string;
  lastStatus: string | null;
  lastError: string | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  taskRunId: string | null;
};

export function scheduledTaskToAttentionItem(input: {
  row: ScheduledTaskAttentionRow;
  proactivity: ProactivityPlan;
}): AttentionItem | null {
  if (input.row.lastStatus !== "error") return null;
  if (input.proactivity.resolvedLevel === "quiet") return null;

  return {
    id: `scheduled-task:${input.row.taskId}`,
    source: "scheduled-task",
    title: "Scheduled work needs review",
    context: `${input.row.title} did not finish. ${input.proactivity.explanation}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: input.proactivity.resolvedLevel === "assertive" ? "bounded-write" : "unknown",
    triage: {
      timeToAct: input.proactivity.resolvedLevel === "assertive" ? "due-today" : "none",
      deadlineIso: input.proactivity.resolvedLevel === "assertive" ? input.row.nextRunAt?.toISOString() : undefined,
      residueReason: "input-required",
      blastRadius: input.row.title,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: (input.row.lastRunAt ?? new Date(0)).toISOString(),
    actions: [
      { kind: "open-in-context", label: "Review scheduled work", href: "/platform/schedule" },
      { kind: "snooze", label: "Snooze" },
    ],
    deepLink: "/platform/schedule",
    audience: audienceForEscalation(input.proactivity.escalationTarget, input.row.ownerUserId),
    proactivity: {
      level: input.proactivity.resolvedLevel,
      actorId: input.row.agentId,
      policyId: input.proactivity.policyId,
    },
    technical: { detectedBy: input.row.agentId },
  };
}

/** BI-754C9E82: the plan's escalationTarget is ENFORCED as attention routing.
 *  Personal targets (owner / attention-surface / role) carry the owner as the
 *  assignee; operator-level targets (platform-operator / dispatcher) drop the
 *  personal assignee so the item reads as an operations concern. The operator
 *  flag stays true for every target so escalation can widen visibility but
 *  never hide a failure. */
function audienceForEscalation(
  target: ProactivityPlan["escalationTarget"],
  ownerUserId: string,
): AttentionItem["audience"] {
  if (target === "platform-operator" || target === "dispatcher") {
    return { operator: true };
  }
  return { operator: true, assigneePrincipalId: ownerUserId };
}

export async function loadScheduledTaskItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.scheduledAgentTask.findMany({
    where: { lastStatus: "error", isActive: true },
    orderBy: { lastRunAt: "desc" },
    take: 50,
    select: {
      taskId: true,
      title: true,
      agentId: true,
      routeContext: true,
      ownerUserId: true,
      lastStatus: true,
      lastError: true,
      lastRunAt: true,
      nextRunAt: true,
      taskRunId: true,
    },
  });
  const proactivityByTaskRunId = await loadProactivityByTaskRunId(db, rows);

  return rows.flatMap((row) => {
    const proactivity = row.taskRunId ? proactivityByTaskRunId.get(row.taskRunId) ?? planFromTaskRow(row) : planFromTaskRow(row);
    const item = scheduledTaskToAttentionItem({ row, proactivity });
    return item ? [item] : [];
  });
}

async function loadProactivityByTaskRunId(
  db: Db,
  rows: ScheduledTaskAttentionRow[],
): Promise<Map<string, ProactivityPlan>> {
  const taskRunIds = rows.map((row) => row.taskRunId).filter((id): id is string => Boolean(id));
  if (taskRunIds.length === 0) return new Map();

  const taskRuns = await db.taskRun.findMany({
    where: { taskRunId: { in: taskRunIds } },
    select: { taskRunId: true, a2aMetadata: true },
  });

  const plans = new Map<string, ProactivityPlan>();
  for (const taskRun of taskRuns) {
    const plan = readProactivityPlan(taskRun.a2aMetadata);
    if (plan) plans.set(taskRun.taskRunId, plan);
  }
  return plans;
}

function planFromTaskRow(row: ScheduledTaskAttentionRow): ProactivityPlan {
  return resolveProactivityPlanForLevel(
    {
      activityFamily: "scheduled-task",
      agentId: row.agentId,
      routeContext: row.routeContext,
      statusSignal: "degraded",
    },
    proactivityLevelForFailure(row),
  );
}

function readProactivityPlan(metadata: unknown): ProactivityPlan | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).proactivity;
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<ProactivityPlan>;
  if (
    plan.resolvedLevel !== "quiet" &&
    plan.resolvedLevel !== "balanced" &&
    plan.resolvedLevel !== "assertive"
  ) {
    return null;
  }
  if (typeof plan.policyId !== "string" || typeof plan.explanation !== "string") return null;
  return {
    resolvedLevel: plan.resolvedLevel,
    policyId: plan.policyId,
    attentionWindowMinutes: numberOr(plan.attentionWindowMinutes, 60),
    followUpCadenceMinutes: Array.isArray(plan.followUpCadenceMinutes)
      ? plan.followUpCadenceMinutes.filter((item): item is number => typeof item === "number")
      : [],
    maxAttempts: numberOr(plan.maxAttempts, 1),
    spendClass: plan.spendClass === "minimal" || plan.spendClass === "standard" || plan.spendClass === "elevated"
      ? plan.spendClass
      : "standard",
    channelPolicy: plan.channelPolicy === "in-app-only" ||
      plan.channelPolicy === "preferred-channel" ||
      plan.channelPolicy === "urgent-channel" ||
      plan.channelPolicy === "multi-channel"
      ? plan.channelPolicy
      : "in-app-only",
    escalationTarget: plan.escalationTarget === "attention-surface" ||
      plan.escalationTarget === "owner" ||
      plan.escalationTarget === "role" ||
      plan.escalationTarget === "dispatcher" ||
      plan.escalationTarget === "platform-operator"
      ? plan.escalationTarget
      : "attention-surface",
    actionBoundary: plan.actionBoundary === "advise" || plan.actionBoundary === "propose" || plan.actionBoundary === "preauthorized"
      ? plan.actionBoundary
      : "advise",
    explanation: plan.explanation,
    evidenceRefs: Array.isArray(plan.evidenceRefs)
      ? plan.evidenceRefs.filter((ref): ref is { kind: string; id: string } =>
          Boolean(ref) &&
          typeof ref === "object" &&
          typeof (ref as { kind?: unknown }).kind === "string" &&
          typeof (ref as { id?: unknown }).id === "string")
      : [],
    preferenceSource: plan.preferenceSource,
    userOverrideScopeKey: plan.userOverrideScopeKey,
    suggestionSuppressed: plan.suggestionSuppressed,
    suggestionCooldownUntil: plan.suggestionCooldownUntil,
    suggestionCooldownScopeKey: plan.suggestionCooldownScopeKey,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function proactivityLevelForFailure(row: ScheduledTaskAttentionRow): ProactivityLevel {
  if (row.lastStatus !== "error") return "quiet";
  return "balanced";
}
