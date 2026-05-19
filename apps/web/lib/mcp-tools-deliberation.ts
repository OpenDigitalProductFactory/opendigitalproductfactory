import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { orchestrateDeliberation } from "@/lib/deliberation/orchestrator";

export const DELIBERATION_TOOLS: ToolDefinition[] = [
  {
    name: "deliberate_on",
    description: "Run deliberation on a feature build and return branch consensus.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to deliberate on." },
        content: { type: "string", description: "Content to deliberate on." },
        buildId: { type: "string", description: "Feature build id, e.g. FB-12345678." },
        patternSlug: { type: "string", description: "Deliberation pattern slug. Defaults to review." },
        artifactType: {
          type: "string",
          enum: ["spec", "plan", "code-change", "architecture-decision", "policy", "research-question"],
        },
        triggerSource: {
          type: "string",
          enum: ["stage", "risk", "explicit", "combined"],
        },
        strategyProfile: {
          type: "string",
          enum: ["economy", "balanced", "high-assurance", "document-authority"],
        },
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
      },
      required: ["topic", "content", "buildId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
];

export async function deliberateOnMcpHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string; taskRunId?: string },
): Promise<ToolResult> {
  const buildId = typeof params["buildId"] === "string" ? params["buildId"].trim() : "";
  if (!buildId) {
    return {
      success: false,
      error: "missing_buildId",
      message: "deliberate_on requires buildId.",
    };
  }

  const content = typeof params["content"] === "string" ? params["content"] : "";
  const options: {
    userId: string;
    taskRunId?: string;
    threadId?: string;
    routeContext?: string;
  } = { userId };
  if (context?.taskRunId) options.taskRunId = context.taskRunId;
  if (context?.threadId) options.threadId = context.threadId;
  if (context?.routeContext) options.routeContext = context.routeContext;

  const result = await orchestrateDeliberation(
    "review",
    content,
    options,
    buildId,
  );

  return {
    success: true,
    entityId: result.deliberationRunId,
    message: `Deliberation completed with ${result.consensusDecision.decision}.`,
    data: {
      deliberationRunId: result.deliberationRunId,
      branches: result.branches,
      consensusDecision: result.consensusDecision,
    },
  };
}
