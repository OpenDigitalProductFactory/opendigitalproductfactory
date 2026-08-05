// Coworker-capability tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the coworker self-assessment / capability-needs domain out of the
// mcp-tools.ts executeTool switch: reading the current coworker's registry
// identity, preparing self-assessment context, submitting capability needs for
// human review, listing the caller's own needs, and rolling up all coworkers'
// needs for the governance surface. Each handler delegates to the coworker
// self-assessment services and reproduces the former switch case verbatim, so
// behaviour is identical when a tool is invoked over MCP.
//
// The profile/needs helpers (requireCurrentCoworker, loadCoworkerProfile and its
// route-defined fallback, parseCapabilityNeeds) are used only by these handlers,
// so they move here with them. Definitions moved verbatim out of the inline
// PLATFORM_TOOLS array; grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays
// the gating source.

import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { CapabilityKey } from "@/lib/permissions";
import { ROUTE_AGENT_MAP_ENTRIES } from "@/lib/tak/agent-routing";
import { getToolMarketplaceReadiness } from "@/lib/actions/tool-marketplace-readiness";
import {
  listCoworkerCapabilityNeeds,
  submitCoworkerSelfAssessment,
} from "@/lib/coworker-self-assessment/assessment-service";
import {
  COWORKER_ASSESSMENT_CONFIDENCE,
  COWORKER_ASSESSMENT_VERDICTS,
  COWORKER_CAPABILITY_NEED_KINDS,
  COWORKER_CAPABILITY_NEED_SEVERITIES,
  COWORKER_CAPABILITY_NEED_STATUSES,
  type CoworkerAssessmentConfidence,
  type CoworkerAssessmentVerdict,
  type CoworkerCapabilityNeedInput,
  type CoworkerCapabilityNeedKind,
  type CoworkerCapabilityNeedSeverity,
  type CoworkerCapabilityNeedStatus,
} from "@/lib/coworker-self-assessment/types";

import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { requireCurrentCoworker } from "./coworker-scope";

// ─── Helpers (moved verbatim; used only by these handlers) ──────────────────
// requireCurrentCoworker now lives in ./coworker-scope so the backlog-lens pack
// shares one identity-resolution path (BI-474A1F55). Re-imported above.

function routeValueStream(capability: CapabilityKey | null): string {
  return capability?.replace(/^(view|manage)_/, "") || "cross-cutting";
}

async function loadRouteDefinedCoworkerProfile(agentId: string, routeContext?: string | null) {
  const routeEntry = ROUTE_AGENT_MAP_ENTRIES.find(([, entry]) => entry.agentId === agentId)?.[1] ?? null;
  if (!routeEntry) return null;

  const { getAgentToolGrants } = await import("@/lib/tak/agent-grants");
  const grants = getAgentToolGrants(agentId) ?? ["registry_read"];

  return {
    profile: {
      agentId: routeEntry.agentId,
      slugId: routeEntry.agentId,
      name: routeEntry.agentName,
      tier: routeEntry.sensitivity === "restricted" ? 1 : 2,
      type: "specialist",
      description: routeEntry.agentDescription,
      valueStream: routeValueStream(routeEntry.capability),
      it4itSections: [],
      lifecycleStage: "production",
      hitlTierDefault: routeEntry.sensitivity === "public" ? 3 : 1,
      humanSupervisorId: null,
      escalatesTo: null,
      delegatesTo: [],
      routeContext: routeContext ?? null,
      grants,
      skills: routeEntry.skills.map((skill, index) => ({
        label: skill.label,
        description: skill.description,
        capability: skill.capability,
        taskType: skill.taskType ?? "conversation",
        sortOrder: index,
      })),
    },
    latestAssessment: null,
  };
}

async function loadCoworkerProfile(agentId: string, routeContext?: string | null) {
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId }, { slugId: agentId }] },
    include: {
      skills: {
        orderBy: { sortOrder: "asc" },
        select: {
          label: true,
          description: true,
          capability: true,
          taskType: true,
          sortOrder: true,
        },
      },
      toolGrants: {
        select: { grantKey: true },
        orderBy: { grantKey: "asc" },
      },
      coworkerAssessments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          assessmentId: true,
          verdict: true,
          confidence: true,
          createdAt: true,
        },
      },
    },
  });

  if (!agent) {
    const routeDefinedProfile = await loadRouteDefinedCoworkerProfile(agentId, routeContext);
    if (routeDefinedProfile) {
      return routeDefinedProfile;
    }

    throw new Error(`Coworker ${agentId} was not found.`);
  }

  const latestAssessment = agent.coworkerAssessments[0] ?? null;
  return {
    profile: {
      agentId: agent.agentId,
      slugId: agent.slugId,
      name: agent.name,
      tier: agent.tier,
      type: agent.type,
      description: agent.description,
      valueStream: agent.valueStream,
      it4itSections: agent.it4itSections,
      lifecycleStage: agent.lifecycleStage,
      hitlTierDefault: agent.hitlTierDefault,
      humanSupervisorId: agent.humanSupervisorId,
      escalatesTo: agent.escalatesTo,
      delegatesTo: agent.delegatesTo,
      routeContext: routeContext ?? null,
      grants: agent.toolGrants.map((grant) => grant.grantKey),
      skills: agent.skills,
    },
    latestAssessment,
  };
}

function parseCapabilityNeeds(rawNeeds: unknown): CoworkerCapabilityNeedInput[] {
  if (!Array.isArray(rawNeeds)) return [];

  return rawNeeds
    .filter((need): need is Record<string, unknown> => need != null && typeof need === "object")
    .filter((need): need is Record<string, unknown> =>
      COWORKER_CAPABILITY_NEED_KINDS.includes(need.kind as CoworkerCapabilityNeedKind))
    .map((need) => ({
      kind: need.kind as CoworkerCapabilityNeedKind,
      severity: COWORKER_CAPABILITY_NEED_SEVERITIES.includes(need.severity as CoworkerCapabilityNeedSeverity)
        ? need.severity as CoworkerCapabilityNeedSeverity
        : "important",
      need: String(need.need ?? "").trim(),
      blocks: String(need.blocks ?? "").trim(),
      evidenceJson: need.evidenceJson != null && typeof need.evidenceJson === "object"
        ? need.evidenceJson as Record<string, unknown>
        : undefined,
      readinessJson: need.readinessJson != null && typeof need.readinessJson === "object"
        ? need.readinessJson as Record<string, unknown>
        : undefined,
    }))
    .filter((need) => need.need.length > 0 && need.blocks.length > 0);
}

// ─── Definitions (moved verbatim out of PLATFORM_TOOLS) ─────────────────────

const definitions: ToolDefinition[] = [
  {
    name: "get_my_coworker_profile",
    description: "Read the current coworker's registry identity, skills, grants, latest self-assessment, and route context. Use before answering whether the coworker has the tools/capabilities to do a job.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "assess_my_capabilities",
    description: "Build current self-assessment context for the current coworker, including profile, skills, grants, marketplace readiness, and the response shape expected for capability needs.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional domain or need to focus readiness lookup, such as 'marketing publishing' or 'incident response'.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "submit_coworker_capability_need",
    description: "Submit the current coworker's self-assessment and capability needs for human review. This creates CoworkerCapabilityNeed records, not direct BacklogItems.",
    inputSchema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: [...COWORKER_ASSESSMENT_VERDICTS] },
        confidence: { type: "string", enum: [...COWORKER_ASSESSMENT_CONFIDENCE] },
        missionSummary: { type: "string", description: "How the coworker understands its mission/job in one or two sentences." },
        capabilitySummary: { type: "string", description: "Short summary of what the coworker can do now and where it is limited." },
        rawPayload: { type: "object", description: "Optional raw structured assessment payload for audit." },
        needs: {
          type: "array",
          description: "Specific capability needs to submit for review.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_KINDS] },
              severity: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_SEVERITIES] },
              need: { type: "string" },
              blocks: { type: "string" },
              evidenceJson: { type: "object" },
              readinessJson: { type: "object" },
            },
            required: ["kind", "severity", "need", "blocks"],
          },
        },
      },
      required: ["verdict", "confidence", "needs"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "list_my_capability_needs",
    description: "List capability needs previously submitted by the current coworker, optionally filtered by status, kind, or severity.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_STATUSES] },
        kind: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_KINDS] },
        severity: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_SEVERITIES] },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "list_all_capability_needs",
    description:
      "List capability needs submitted by ALL coworkers (not scoped to the calling agent), optionally filtered by agentId, status, kind, or severity. Returns the rich review shape used by the capability-needs admin page: summary counts by status/severity/kind, filter-option enums, and the full need list. Read-only governance surface for taxonomy audits.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Optional — filter to one coworker's needs. Omit to return all." },
        status: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_STATUSES] },
        kind: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_KINDS] },
        severity: { type: "string", enum: [...COWORKER_CAPABILITY_NEED_SEVERITIES] },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
];

// ─── Handlers (case bodies moved verbatim) ──────────────────────────────────

async function getMyCoworkerProfileHandler(
  context: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const agentId = requireCurrentCoworker(context);
  const profile = await loadCoworkerProfile(agentId, context?.routeContext ?? null);
  return {
    success: true,
    message: `Loaded coworker profile for ${profile.profile.name}.`,
    data: profile,
  };
}

async function assessMyCapabilitiesHandler(
  params: Record<string, unknown>,
  context: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const agentId = requireCurrentCoworker(context);
  const profile = await loadCoworkerProfile(agentId, context?.routeContext ?? null);
  const readiness = await getToolMarketplaceReadiness({
    query: typeof params["query"] === "string" ? params["query"] : undefined,
    agentId,
    limit: 12,
  });

  return {
    success: true,
    message: `Prepared self-assessment context for ${profile.profile.name}.`,
    data: {
      ...profile,
      readiness,
      responseShape: {
        verdict: [...COWORKER_ASSESSMENT_VERDICTS],
        confidence: [...COWORKER_ASSESSMENT_CONFIDENCE],
        needs: {
          kind: [...COWORKER_CAPABILITY_NEED_KINDS],
          severity: [...COWORKER_CAPABILITY_NEED_SEVERITIES],
          requiredFields: ["kind", "severity", "need", "blocks"],
        },
      },
      instruction:
        "Assess your mission against your current skills, grants, and readiness. Submit durable gaps with submit_coworker_capability_need instead of creating backlog items directly.",
    },
  };
}

async function submitCoworkerCapabilityNeedHandler(
  params: Record<string, unknown>,
  context: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const agentId = requireCurrentCoworker(context);
  const needs = parseCapabilityNeeds(params["needs"]);
  if (needs.length === 0) {
    return {
      success: false,
      error: "No valid capability needs supplied",
      message: "Submit at least one need with kind, severity, need, and blocks.",
    };
  }

  const verdict = COWORKER_ASSESSMENT_VERDICTS.includes(params["verdict"] as CoworkerAssessmentVerdict)
    ? params["verdict"] as CoworkerAssessmentVerdict
    : "gaps";
  const confidence = COWORKER_ASSESSMENT_CONFIDENCE.includes(params["confidence"] as CoworkerAssessmentConfidence)
    ? params["confidence"] as CoworkerAssessmentConfidence
    : "medium";

  const result = await submitCoworkerSelfAssessment({
    agentId,
    trigger: "tool-call",
    routeContext: context?.routeContext ?? null,
    verdict,
    confidence,
    missionSummary: typeof params["missionSummary"] === "string" ? params["missionSummary"] : null,
    capabilitySummary: typeof params["capabilitySummary"] === "string" ? params["capabilitySummary"] : null,
    rawPayload: params["rawPayload"] != null && typeof params["rawPayload"] === "object"
      ? params["rawPayload"] as Record<string, unknown>
      : { toolName: "submit_coworker_capability_need" },
    needs,
  });

  return {
    success: true,
    entityId: result.assessmentId,
    message: `Submitted ${result.needIds.length} capability need${result.needIds.length === 1 ? "" : "s"} and filed ${result.backlogItemIds?.length ?? 0} to the backlog for triage.`,
    data: result,
  };
}

async function listMyCapabilityNeedsHandler(
  params: Record<string, unknown>,
  context: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const agentId = requireCurrentCoworker(context);
  const status = COWORKER_CAPABILITY_NEED_STATUSES.includes(params["status"] as CoworkerCapabilityNeedStatus)
    ? params["status"] as CoworkerCapabilityNeedStatus
    : undefined;
  const kind = COWORKER_CAPABILITY_NEED_KINDS.includes(params["kind"] as CoworkerCapabilityNeedKind)
    ? params["kind"] as CoworkerCapabilityNeedKind
    : undefined;
  const severity = COWORKER_CAPABILITY_NEED_SEVERITIES.includes(params["severity"] as CoworkerCapabilityNeedSeverity)
    ? params["severity"] as CoworkerCapabilityNeedSeverity
    : undefined;
  const needs = await listCoworkerCapabilityNeeds({ agentId, status, kind, severity });

  return {
    success: true,
    message: `Found ${needs.length} capability need${needs.length === 1 ? "" : "s"}.`,
    data: { needs },
  };
}

async function listAllCapabilityNeedsHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  // BI-F9E7B780 — governance-surface rollup, not scoped to the calling
  // coworker. Reuses the same review-service helper that powers the
  // capability-needs admin page so the MCP surface and the operator UI agree
  // on shape (summary counts, filter-option enums, full need list).
  const { getCoworkerCapabilityNeedReview } = await import(
    "@/lib/coworker-self-assessment/review-service"
  );
  const agentId = typeof params["agentId"] === "string" && params["agentId"].length > 0
    ? params["agentId"]
    : undefined;
  const status = COWORKER_CAPABILITY_NEED_STATUSES.includes(
    params["status"] as CoworkerCapabilityNeedStatus,
  )
    ? (params["status"] as CoworkerCapabilityNeedStatus)
    : undefined;
  const kind = COWORKER_CAPABILITY_NEED_KINDS.includes(
    params["kind"] as CoworkerCapabilityNeedKind,
  )
    ? (params["kind"] as CoworkerCapabilityNeedKind)
    : undefined;
  const severity = COWORKER_CAPABILITY_NEED_SEVERITIES.includes(
    params["severity"] as CoworkerCapabilityNeedSeverity,
  )
    ? (params["severity"] as CoworkerCapabilityNeedSeverity)
    : undefined;

  const review = await getCoworkerCapabilityNeedReview({
    agentId,
    status,
    kind,
    severity,
  });

  return {
    success: true,
    message: `Found ${review.summary.total} capability need${
      review.summary.total === 1 ? "" : "s"
    } across all coworkers.`,
    data: {
      summary: review.summary,
      filterOptions: review.filterOptions,
      needs: review.needs,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  get_my_coworker_profile: (_params, _userId, context) => getMyCoworkerProfileHandler(context),
  assess_my_capabilities: (params, _userId, context) => assessMyCapabilitiesHandler(params, context),
  submit_coworker_capability_need: (params, _userId, context) =>
    submitCoworkerCapabilityNeedHandler(params, context),
  list_my_capability_needs: (params, _userId, context) =>
    listMyCapabilityNeedsHandler(params, context),
  list_all_capability_needs: (params) => listAllCapabilityNeedsHandler(params),
};

export const coworkerCapabilityPack: ToolPack = {
  packId: "coworker-capability",
  definitions,
  handlers,
  grants: {
    get_my_coworker_profile: ["registry_read"],
    assess_my_capabilities: ["registry_read"],
    submit_coworker_capability_need: ["registry_read"],
    list_my_capability_needs: ["registry_read"],
    list_all_capability_needs: ["registry_read"],
  },
};
