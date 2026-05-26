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
  apiTokenId?: string | null;
  /**
   * Governed Hermes learning Slice 1: when the user message invokes a specific
   * coworker skill (via the canonical `Use the <id> skill.` marker), the
   * caller threads its skillId through here so subsequent ToolExecution rows
   * can be attributed to the active skill.
   */
  activeSkillId?: string | null;
  /**
   * Pre-allocated AgentMessage id for the assistant turn this loop is
   * producing. Threaded through to AdapterRunTelemetry so badge / cost-rollup
   * queries can join telemetry rows to the resulting AgentMessage row even
   * though the row itself is persisted by the caller after the loop returns.
   */
  agentMessageId?: string | null;
  /**
   * Distinguish autonomous phase execution from interactive chat. Forwarded
   * to runAgenticLoop. Defaults to "autonomous" to preserve prior behavior;
   * interactive chat callers (agent-coworker sendMessage) must pass "chat"
   * so Operator Contract guards do not false-positive on conversational
   * replies. See agentic-loop.ts param doc.
   */
  interactionMode?: "chat" | "autonomous";
  onProgress?: (event: AgentEvent) => void;
}) {
  const { runAgenticLoop } = await import("@/lib/tak/agentic-loop");

  // Capture before-run timestamp so the post-run reflection trigger only
  // considers PlatformIssueReport rows this run produced.
  const startedAt = new Date();

  const result = await runAgenticLoop({
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
    apiTokenId: input.apiTokenId,
    taskType: input.taskType,
    agentDisplayName: input.agentDisplayName,
    buildPhase: input.buildPhase,
    featureBuildId: input.featureBuildId,
    activeSkillId: input.activeSkillId ?? null,
    agentMessageId: input.agentMessageId ?? null,
    interactionMode: input.interactionMode,
    ...(input.modelRequirements ? { modelRequirements: input.modelRequirements } : {}),
    onProgress: input.onProgress,
  });

  // Governed Hermes learning Slice 2: fire-and-forget reflection trigger.
  // Inspects PlatformIssueReport rows produced during this run and emits
  // self-assessment + capability-need + ImprovementSignal evidence per row.
  // The trigger has its own three-layer loop guard (source check, depth
  // guard, signal-layer dedupe) — see reflection-triggers.ts. Void-style
  // so a slow reflection cannot delay the user response.
  void (async () => {
    try {
      const { processRuntimeIssueReflection } = await import(
        "@/lib/tak/reflection-triggers"
      );
      await processRuntimeIssueReflection({
        taskRunId: input.taskRunId ?? null,
        userId: input.userId,
        agentId: input.agentId,
        threadId: input.threadId,
        routeContext: input.routeContext,
        since: startedAt,
      });
    } catch (err) {
      console.warn(
        "[reflection-triggers] post-run hook failed:",
        err instanceof Error ? err.message : err,
      );
    }
  })();

  return result;
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
  apiTokenId?: string | null;
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
      apiTokenId: input.apiTokenId ?? undefined,
    },
  });
}
