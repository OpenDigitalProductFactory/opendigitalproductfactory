import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";

export type AutonomousWorkTrigger =
  | "interactive"
  | "scheduled"
  | "external-mcp"
  | "build"
  | "deliberation"
  | "radar"
  | "system-recovery"
  | "capacity-continuity";

export type AutonomousWorkRunRef = {
  id: string;
  taskRunId: string;
  contextId: string | null;
};

export type AutonomousWorkRunInput = {
  trigger: AutonomousWorkTrigger;
  userId: string;
  agentId: string;
  routeContext: string;
  title: string;
  objective: string;
  prompt: string;
  threadId?: string | null;
  parentTaskRunId?: string | null;
  authorityScope?: string[];
  sourceRef?: {
    kind: string;
    id: string;
  };
  metadata?: Record<string, unknown>;
};

const TRIGGER_PREFIX: Record<AutonomousWorkTrigger, string> = {
  interactive: "CHAT",
  scheduled: "SCHED",
  "external-mcp": "MCP",
  build: "BUILD",
  deliberation: "DELIB",
  radar: "RADAR",
  "system-recovery": "RECOV",
  "capacity-continuity": "CAP",
};

function taskRunSourceForTrigger(trigger: AutonomousWorkTrigger): string {
  if (trigger === "interactive") return "coworker";
  if (trigger === "build") return "build";
  if (trigger === "deliberation") return "skill";
  return "proactive";
}

function initialStatusForTrigger(trigger: AutonomousWorkTrigger): string {
  return trigger === "interactive" ? "submitted" : "working";
}

function createPublicTaskRunId(trigger: AutonomousWorkTrigger): string {
  return `TR-${TRIGGER_PREFIX[trigger]}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createAutonomousWorkRun(
  input: AutonomousWorkRunInput,
): Promise<AutonomousWorkRunRef> {
  const threadId = input.threadId ?? null;

  return prisma.taskRun.create({
    data: {
      taskRunId: createPublicTaskRunId(input.trigger),
      userId: input.userId,
      threadId,
      contextId: threadId,
      initiatingAgentId: input.agentId,
      currentAgentId: input.agentId,
      parentTaskRunId: input.parentTaskRunId ?? null,
      routeContext: input.routeContext,
      title: input.title,
      objective: input.objective.slice(0, 1000),
      source: taskRunSourceForTrigger(input.trigger),
      status: initialStatusForTrigger(input.trigger),
      authorityScope: input.authorityScope ?? [],
      a2aMetadata: {
        trigger: input.trigger,
        ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
        ...(input.metadata ?? {}),
      },
    },
    select: { id: true, taskRunId: true, contextId: true },
  });
}
