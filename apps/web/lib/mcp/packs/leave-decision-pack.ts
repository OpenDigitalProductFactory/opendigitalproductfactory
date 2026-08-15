// Propose-only time-off decision surface — BI-4D030159 (Paycom absorption).
// The handler consults the organization's WWWD profile and hard leave guards,
// then writes an AgentActionProposal. It never approves or rejects leave.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { proposeLeaveDecision } from "@/lib/workforce/leave/decide-proposal";
import { decideLeaveRequestFromData } from "@/lib/workforce/leave/leave-decision-runtime";

import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "propose_leave_decision",
    description:
      "Recommend approve, deny, or human review for one pending leave request. Uses staffing coverage, leave balance, hard policy rails, and the organization's own recorded business-decision stance. Writes a proposed leave.decide action for a human; never changes leave status.",
    inputSchema: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "Pending LeaveRequest.requestId" },
        organizationId: { type: "string", description: "Organization whose WWWD stance governs" },
        minCoverageCushion: {
          type: "number",
          description: "Organization-configured headcount cushion above required coverage (default 0)",
        },
      },
      required: ["requestId", "organizationId"],
    },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: true,
    coworkerArtifact: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

async function proposeLeaveDecisionHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const requestId = typeof params["requestId"] === "string" ? params["requestId"].trim() : "";
  const organizationId =
    typeof params["organizationId"] === "string" ? params["organizationId"].trim() : "";
  if (!requestId || !organizationId) {
    return {
      success: false,
      error: "requestId and organizationId are required",
      message: "Provide a pending leave request and its organization.",
    };
  }
  const rawCushion = params["minCoverageCushion"];
  const minCoverageCushion =
    typeof rawCushion === "number" && Number.isFinite(rawCushion)
      ? Math.max(0, rawCushion)
      : undefined;

  const decision = await decideLeaveRequestFromData({
    requestId,
    organizationId,
    minCoverageCushion,
  });
  const proposal = await proposeLeaveDecision({
    decision,
    userId,
    agentId: context?.agentId,
    threadId: context?.threadId,
    taskRunId: context?.taskRunId,
  });

  return {
    success: true,
    entityId: proposal.proposalId,
    message: `Time-off recommendation ${decision.action}; queued for human review.`,
    data: {
      proposalId: proposal.proposalId,
      status: proposal.status,
      recommendation: decision.action,
      interactionId: decision.interactionId,
      rationale: decision.operatorMessage,
      guardReasons: decision.guardReasons,
      orgProfileSelected: decision.orgProfileSelected,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  propose_leave_decision: proposeLeaveDecisionHandler,
};

export const leaveDecisionPack: ToolPack = {
  packId: "leave-decision",
  definitions,
  handlers,
  grants: {
    propose_leave_decision: ["consumer_read", "registry_read"],
  },
};
