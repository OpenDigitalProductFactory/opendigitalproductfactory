// Deliberation-run lifecycle tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "deliberation run lifecycle" domain out of the
// mcp-tools.ts executeTool switch: starting a multi-branch deliberation run
// (peer review or debate) over an artifact, reading a run's live status
// snapshot, and reading its full synthesized outcome. Every handler is a thin
// lazy-delegation to the shared deliberation server actions
// (@/lib/actions/deliberation), so behaviour is identical when invoked over MCP.
//
// Distinct from the deliberation-siem pack, which owns the SIEM-adjacent
// `deliberate_on` tool; this pack owns the run-lifecycle trio. Definitions are
// moved verbatim out of the inline PLATFORM_TOOLS array (including
// start_deliberation's proposal executionMode + autoApproveWhen predicate).
// Grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  DELIBERATION_ARTIFACT_TYPES,
  DELIBERATION_STRATEGY_PROFILES,
  DELIBERATION_TRIGGER_SOURCES,
} from "@/lib/deliberation/types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const definitions: ToolDefinition[] = [
  {
    name: "start_deliberation",
    description:
      "Start a multi-branch deliberation run (peer review or debate) over an artifact. The activation resolver decides which pattern fires based on stage, risk, and the caller's explicit request. Stage-default and risk-escalated invocations are pre-authorized; explicit invocations require proposal review. Returns the new deliberationRunId synchronously; branches dispatch asynchronously via the Inngest runner.",
    inputSchema: {
      type: "object",
      properties: {
        patternSlug: {
          type: "string",
          description:
            "Explicit deliberation pattern slug (e.g. 'review', 'debate'). Used as explicitPatternSlug in the activation resolver — may be strengthened by stage/risk policy.",
        },
        taskRunId: {
          type: "string",
          description: "Optional parent TaskRun (external id). When omitted, the orchestrator bootstraps one.",
        },
        artifactType: {
          type: "string",
          enum: [...DELIBERATION_ARTIFACT_TYPES],
          description: "The kind of artifact being deliberated.",
        },
        strategyProfile: {
          type: "string",
          enum: [...DELIBERATION_STRATEGY_PROFILES],
          description: "Optional override for the cost/quality trade-off profile. Defaults to the pattern's declared hint.",
        },
        maxBranches: {
          type: "number",
          description: "Upper bound on branch count. Defaults to the pattern's required role count capped at 4.",
        },
        budgetUsd: {
          type: "number",
          description: "Upper bound on total USD spend across the run. Null = unbounded.",
        },
        stage: {
          type: "string",
          enum: ["ideate", "plan", "build", "review", "ship"],
          description: "Build Studio stage the deliberation runs under. Drives stage-default activation.",
        },
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Risk level of the work. Medium+ escalates activation.",
        },
        triggerSource: {
          type: "string",
          enum: [...DELIBERATION_TRIGGER_SOURCES],
          description:
            "Caller's intent signal for the activation layer. Used by autoApproveWhen to decide whether the call skips proposal review.",
        },
        routeContext: {
          type: "string",
          description: "Optional route / screen context (e.g. '/build') for telemetry and downstream routing.",
        },
      },
      required: ["patternSlug", "artifactType"],
    },
    requiredCapability: "view_platform",
    executionMode: "proposal",
    sideEffect: true,
    autoApproveWhen: async (ctx: unknown) => {
      const params =
        (ctx as { params?: Record<string, unknown> } | undefined)?.params ?? {};
      const raw = params["triggerSource"];
      return raw === "stage" || raw === "risk";
    },
  },
  {
    name: "get_deliberation_status",
    description:
      "Read-only snapshot of a deliberation run — consensus state, branch counts (total/completed/failed/pending), evidence coverage (source-backed/mixed/needs-more-evidence), and budget/diversity degradation flags.",
    inputSchema: {
      type: "object",
      properties: {
        deliberationRunId: {
          type: "string",
          description: "The DeliberationRun id returned from start_deliberation.",
        },
      },
      required: ["deliberationRunId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_deliberation_outcome",
    description:
      "Read-only full outcome for a deliberation run — merged recommendation, rationale, confidence, unresolved risks, issue set, and compact claim + evidence-bundle references. Returns null outcome when synthesis has not yet completed.",
    inputSchema: {
      type: "object",
      properties: {
        deliberationRunId: {
          type: "string",
          description: "The DeliberationRun id returned from start_deliberation.",
        },
      },
      required: ["deliberationRunId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function startDeliberationHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string },
): Promise<ToolResult> {
  const { startDeliberation } = await import("@/lib/actions/deliberation");
  try {
    const result = await startDeliberation({
      userId,
      patternSlug: String(params["patternSlug"] ?? ""),
      taskRunId: typeof params["taskRunId"] === "string" ? params["taskRunId"] : undefined,
      artifactType: params["artifactType"] as import("@/lib/deliberation/types").DeliberationArtifactType,
      strategyProfile:
        typeof params["strategyProfile"] === "string"
          ? (params["strategyProfile"] as import("@/lib/deliberation/types").DeliberationStrategyProfile)
          : undefined,
      maxBranches:
        typeof params["maxBranches"] === "number" ? params["maxBranches"] : undefined,
      budgetUsd:
        typeof params["budgetUsd"] === "number" ? params["budgetUsd"] : undefined,
      stage:
        typeof params["stage"] === "string"
          ? (params["stage"] as "ideate" | "plan" | "build" | "review" | "ship")
          : undefined,
      riskLevel:
        typeof params["riskLevel"] === "string"
          ? (params["riskLevel"] as "low" | "medium" | "high" | "critical")
          : undefined,
      routeContext:
        typeof params["routeContext"] === "string"
          ? params["routeContext"]
          : context?.routeContext,
      threadId: context?.threadId,
    });
    return {
      success: true,
      entityId: result.deliberationRunId,
      message: result.reason,
      data: {
        deliberationRunId: result.deliberationRunId,
        triggerSource: result.triggerSource,
        reason: result.reason,
      },
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: msg, message: "start_deliberation failed" };
  }
}

async function getDeliberationStatusHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { getDeliberationStatus } = await import("@/lib/actions/deliberation");
  try {
    const result = await getDeliberationStatus({
      deliberationRunId: String(params["deliberationRunId"] ?? ""),
      userId,
    });
    return {
      success: true,
      entityId: result.deliberationRunId,
      message: `Deliberation ${result.deliberationRunId} — ${result.consensusState}`,
      data: result as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: msg, message: `get_deliberation_status failed: ${msg}` };
  }
}

async function getDeliberationOutcomeHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { getDeliberationOutcome } = await import("@/lib/actions/deliberation");
  try {
    const result = await getDeliberationOutcome({
      deliberationRunId: String(params["deliberationRunId"] ?? ""),
      userId,
    });
    return {
      success: true,
      message: result.outcome
        ? `Outcome ready — ${result.claims.length} claim(s), ${result.evidenceBundles.length} bundle(s).`
        : "Outcome not yet synthesized.",
      data: result as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: msg, message: `get_deliberation_outcome failed: ${msg}` };
  }
}

const handlers: Record<string, ToolPackHandler> = {
  start_deliberation: (params, userId, context) =>
    startDeliberationHandler(params, userId, context),
  get_deliberation_status: (params, userId) =>
    getDeliberationStatusHandler(params, userId),
  get_deliberation_outcome: (params, userId) =>
    getDeliberationOutcomeHandler(params, userId),
};

export const deliberationRunPack: ToolPack = {
  packId: "deliberation-run",
  definitions,
  handlers,
  grants: {
    start_deliberation: ["deliberation_create"],
    get_deliberation_status: ["deliberation_read"],
    get_deliberation_outcome: ["deliberation_read"],
  },
};
