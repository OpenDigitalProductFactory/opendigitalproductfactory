import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { orchestrateDeliberation } from "@/lib/deliberation/orchestrator";
import {
  isDeliberationArtifactType,
  isDeliberationTriggerSource,
  isDeliberationStrategyProfile,
} from "@/lib/deliberation/types";

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

  const rawArtifactType = params["artifactType"];
  const artifactType = isDeliberationArtifactType(rawArtifactType) ? rawArtifactType : "plan";
  const rawTriggerSource = params["triggerSource"];
  const triggerSource = isDeliberationTriggerSource(rawTriggerSource) ? rawTriggerSource : "explicit";
  const rawStrategyProfile = params["strategyProfile"];
  const strategyProfile = isDeliberationStrategyProfile(rawStrategyProfile) ? rawStrategyProfile : "balanced";

  const result = await orchestrateDeliberation({
    buildId,
    patternSlug: typeof params["patternSlug"] === "string" ? params["patternSlug"] : "review",
    artifactType,
    triggerSource,
    strategyProfile,
    diversityMode: "multi-model-same-provider",
    userId,
    taskRunId: context?.taskRunId ?? null,
    threadId: context?.threadId ?? null,
    routeContext: context?.routeContext ?? null,
  });

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
