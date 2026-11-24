// Work-pattern experiment candidate origination pack (BI-5A17505E).
//
// Exposes the governed seam that submits a validated 2x2 shadow experiment
// candidate as a CoworkerCapabilityNeed for operator review in the existing
// coworker detail panel. Never activates a binding or starts an experiment.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import {
  COWORKER_CAPABILITY_NEED_KINDS,
  COWORKER_CAPABILITY_NEED_SEVERITIES,
  type CoworkerCapabilityNeedKind,
  type CoworkerCapabilityNeedSeverity,
} from "@/lib/coworker-self-assessment/types";
import {
  proposeWorkPatternExperimentCandidate,
} from "@/lib/tak/work-pattern-experiment-candidate";
import {
  WORK_PATTERN_DECISION_SCOPES,
  type WorkPatternDecisionScope,
} from "@/lib/tak/work-pattern-types";

import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "propose_work_pattern_experiment_candidate",
    description:
      "Originate a governed Living Playbook experiment candidate for operator review on an existing coworker. "
      + "Validates the 2x2 shadow experiment definition, promotion policy ceiling, and hermetic build-replay fixture, "
      + "then stores one deduplicated CoworkerCapabilityNeed. Never activates an AuthorityBinding or starts an experiment directly.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Target coworker agentId, for example build-specialist.",
        },
        need: {
          type: "string",
          description: "Plain-language summary of the working method candidate being proposed.",
        },
        blocks: {
          type: "string",
          description: "What governed outcome this candidate unblocks once proven.",
        },
        kind: {
          type: "string",
          enum: [...COWORKER_CAPABILITY_NEED_KINDS],
        },
        severity: {
          type: "string",
          enum: [...COWORKER_CAPABILITY_NEED_SEVERITIES],
        },
        decisionScope: {
          type: "string",
          enum: [...WORK_PATTERN_DECISION_SCOPES],
        },
        routeContext: {
          type: "string",
          description: "Optional owning route context; defaults to /platform/ai/agent/<agentId>.",
        },
        candidate: {
          type: "object",
          description:
            "ReviewedExperimentCandidate payload: definition (2x2 methodVariants x modelVariants, installScope, promotionPolicy), "
            + "activityKey, riskClass, pairKey, and shadow cells with build-replay-v1 fixtureParts for build.implement.",
        },
      },
      required: ["agentId", "need", "blocks", "candidate"],
    },
    requiredCapability: "manage_platform",
    executionMode: "immediate",
    sideEffect: true,
    // Enters the authority-review pipeline for Living Playbook activation (TAK §8.4.1).
    consequence: "authority",
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

async function proposeWorkPatternExperimentCandidateHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const result = await proposeWorkPatternExperimentCandidate({
    agentId: typeof params["agentId"] === "string" ? params["agentId"] : "",
    need: typeof params["need"] === "string" ? params["need"] : "",
    blocks: typeof params["blocks"] === "string" ? params["blocks"] : "",
    kind: typeof params["kind"] === "string"
      ? params["kind"] as CoworkerCapabilityNeedKind
      : undefined,
    severity: typeof params["severity"] === "string"
      ? params["severity"] as CoworkerCapabilityNeedSeverity
      : undefined,
    decisionScope: typeof params["decisionScope"] === "string"
      ? params["decisionScope"] as WorkPatternDecisionScope
      : undefined,
    routeContext: typeof params["routeContext"] === "string" ? params["routeContext"] : null,
    candidate: params["candidate"],
  });

  if (result.status === "rejected") {
    return {
      success: false,
      error: result.reason,
      message: `Work-pattern experiment candidate rejected (${result.reason}).`,
      data: result,
    };
  }

  return {
    success: true,
    entityId: result.needId,
    message:
      result.status === "reused"
        ? `Reused existing Living Playbook experiment candidate ${result.needId} on ${result.reviewRoute}.`
        : `Proposed Living Playbook experiment candidate ${result.needId} for operator review on ${result.reviewRoute}.`,
    data: result,
  };
}

const handlers: Record<string, ToolPackHandler> = {
  propose_work_pattern_experiment_candidate: (params) =>
    proposeWorkPatternExperimentCandidateHandler(params),
};

export const workPatternExperimentPack: ToolPack = {
  packId: "work-pattern-experiment",
  definitions,
  handlers,
  grants: {
    propose_work_pattern_experiment_candidate: ["registry_write"],
  },
};
