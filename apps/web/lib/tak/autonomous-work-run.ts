import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";
import type { ChatMessage } from "@/lib/ai-inference";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { AgentEvent } from "@/lib/tak/agent-event-bus";

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

type AgentSensitivity = "public" | "internal" | "confidential" | "restricted";

export type AutonomousWorkUserContext = {
  userId?: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

type AgentPromptInfo = {
  agentId?: string | null;
  systemPrompt: string;
  sensitivity?: AgentSensitivity | null;
  [key: string]: unknown;
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

export async function findCurrentAutonomousWorkRun(input: {
  userId: string;
  threadId: string;
}): Promise<{ taskRunId: string } | null> {
  return prisma.taskRun.findFirst({
    where: {
      userId: input.userId,
      threadId: input.threadId,
      archivedAt: null,
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    select: { taskRunId: true },
  });
}

export async function resolveAutonomousWorkAgent(input: {
  agentId: string;
  routeContext: string;
  userContext: AutonomousWorkUserContext;
}): Promise<AgentPromptInfo> {
  const { resolveAgentByIdWithPrompts, resolveAgentForRouteWithPrompts } = await import(
    "@/lib/tak/agent-routing-server"
  );
  const routedAgentInfo = await resolveAgentForRouteWithPrompts(
    input.routeContext,
    input.userContext,
  ) as AgentPromptInfo;

  if (routedAgentInfo.agentId === input.agentId) {
    return routedAgentInfo;
  }

  return resolveAgentByIdWithPrompts(input.agentId, input.userContext) as Promise<AgentPromptInfo>;
}

export async function resolveAutonomousWorkTools(input: {
  userContext: AutonomousWorkUserContext;
  agentId: string;
  mode?: "advise" | "act";
  externalAccessEnabled?: boolean;
  unifiedMode?: boolean;
}): Promise<{
  tools: ToolDefinition[];
  toolsForProvider: Array<Record<string, unknown>>;
}> {
  const { getAvailableTools, toolsToOpenAIFormat } = await import("@/lib/mcp-tools");
  const tools = await getAvailableTools(input.userContext, {
    mode: input.mode,
    externalAccessEnabled: input.externalAccessEnabled,
    unifiedMode: input.unifiedMode,
    agentId: input.agentId,
  });

  return {
    tools,
    toolsForProvider: toolsToOpenAIFormat(tools),
  };
}

export async function executeAutonomousAgenticLoop(input: {
  systemPrompt: string;
  chatHistory: ChatMessage[];
  sensitivity: AgentSensitivity;
  tools: ToolDefinition[];
  toolsForProvider?: Array<Record<string, unknown>>;
  userId: string;
  routeContext: string;
  agentId: string;
  threadId: string;
  taskRunId?: string | null;
  taskType?: string;
  agentDisplayName?: string;
  buildPhase?: string | null;
  featureBuildId?: string | null;
  modelRequirements?: Record<string, unknown>;
  onProgress?: (event: AgentEvent) => void;
}) {
  const { runAgenticLoop } = await import("@/lib/tak/agentic-loop");

  return runAgenticLoop({
    systemPrompt: input.systemPrompt,
    chatHistory: input.chatHistory,
    sensitivity: input.sensitivity,
    tools: input.tools,
    toolsForProvider: input.toolsForProvider,
    userId: input.userId,
    routeContext: input.routeContext,
    agentId: input.agentId,
    threadId: input.threadId,
    taskRunId: input.taskRunId,
    taskType: input.taskType,
    agentDisplayName: input.agentDisplayName,
    buildPhase: input.buildPhase,
    featureBuildId: input.featureBuildId,
    ...(input.modelRequirements ? { modelRequirements: input.modelRequirements } : {}),
    onProgress: input.onProgress,
  });
}

export async function executeAutonomousWorkTool(input: {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  userContext: AutonomousWorkUserContext;
  routeContext: string;
  agentId: string;
  threadId: string;
  taskRunId: string;
}): Promise<ToolResult> {
  const { governedExecuteTool } = await import("@/lib/mcp-governed-execute");

  return governedExecuteTool({
    toolName: input.toolName,
    rawParams: input.args,
    userId: input.userId,
    userContext: input.userContext,
    source: "agentic-loop",
    context: {
      routeContext: input.routeContext,
      agentId: input.agentId,
      threadId: input.threadId,
      taskRunId: input.taskRunId,
    },
  });
}
