// Owner-ruling tool pack (BI-0C0B0836).
//
// When the owner rules on an open decision review in a coworker's chat, the
// coworker records that ruling here instead of asking the owner to re-enter it
// in the portal. record_decision_outcome cannot do this: it records agreement
// with a kernel recommendation, and an escalated review has none.
//
// The coworker never decides. The tool is a PROPOSAL: the escalation gate's
// first branch ("declared-proposal") puts every call to a person, whatever the
// coworker's trust tier or transport, and only the owner's approval runs it.
// The ruling is written by the same core as the portal's "Answer" controls and
// is attributed to the human the chat belongs to, never to the agent.

import type { RegisteredToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const definitions: RegisteredToolDefinition[] = [
  {
    name: "record_owner_ruling",
    description:
      "Record a ruling THE OWNER HAS GIVEN in this conversation on an open decision review (an escalated or deferred decision listed by list_open_decision_reviews), so the owner does not have to re-enter it in the portal. "
      + "Use it ONLY to carry the owner's own words: never to resolve a review on your own judgement, and never for a recommendation the owner has not accepted. "
      + "It is a proposal: the owner sees exactly what will be recorded and approves it with one action; until then nothing is written. "
      + "The ruling is recorded as the owner's answer (attributed to them), closes the review, and for a business review also closes the other open wordings of the same question. "
      + "Use record_decision_outcome instead only to report what was done with a principle_decide recommendation. "
      + "Refusals are answers, not errors to retry: the review is unknown, was resolved by the gate, already has an answer, the option was not offered, or a build review belongs to someone else's build.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: {
          type: "string",
          description: "The review's decision id, e.g. 'DI-AB432BFF8956', as listed by list_open_decision_reviews.",
        },
        answer: {
          type: "string",
          description: "The owner's ruling, in their words as closely as practical (at least a sentence), e.g. 'Hold: do not ship until the skipped UX check has run.'",
        },
        rationale: {
          type: "string",
          description: "Optional: the owner's stated reason, if they gave one.",
        },
        chosenOptionId: {
          type: "string",
          description: "Optional: when the owner picked one of the review's scored options, that option's id.",
        },
      },
      required: ["interactionId", "answer"],
    },
    workroomAccess: "outside-workroom",
    requiredCapability: "view_platform",
    executionMode: "proposal",
    sideEffect: true,
    // Records a person's decision and clears the gate it was escalated from.
    consequence: "authority",
  },
];

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function recordOwnerRulingHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const interactionId = trimmedString(params["interactionId"]);
  const answer = trimmedString(params["answer"]);
  const rationale = trimmedString(params["rationale"]) || null;
  const chosenOptionId = trimmedString(params["chosenOptionId"]) || null;
  if (!interactionId) return { success: false, message: "interactionId is required." };
  if (answer.length < 8) {
    return { success: false, message: "answer must state the owner's ruling in a sentence or two." };
  }
  if (!userId) return { success: false, message: "No signed-in owner is attached to this call." };

  const { prisma } = await import("@dpf/db");
  const row = await prisma.decisionInteraction.findUnique({
    where: { interactionId },
    select: { buildId: true, outcomeType: true, escalationRoute: true },
  });
  if (!row) return { success: false, message: `Decision ${interactionId} was not found.` };

  const core = await import("@/lib/decision/owner-ruling-capture");

  if (row.buildId) {
    const { humanCaptureOutcome } = await import("@/lib/decision-perspective/human-escalation");
    const outcomeType = humanCaptureOutcome(row);
    if (!outcomeType) {
      return { success: false, message: `Decision ${interactionId} was resolved by the gate and needs no ruling.` };
    }
    try {
      const result = await core.captureBuildDecisionAs(userId, {
        interactionId,
        buildId: row.buildId,
        outcomeType,
        answer,
        ...(rationale ? { rationale } : {}),
        ...(chosenOptionId ? { chosenOptionId } : {}),
        candidateMaterial: false,
      });
      return {
        success: true,
        entityId: interactionId,
        message: result.status === "already-captured"
          ? `Decision ${interactionId} already has the owner's answer; nothing was changed.`
          : `Recorded the owner's ruling on ${interactionId} (build ${row.buildId}).`,
        data: { interactionId, buildId: row.buildId, status: result.status, captureId: result.captureId ?? null },
      };
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        success: false,
        message: message === "Forbidden"
          ? `Decision ${interactionId} belongs to a build this owner did not start; it must be answered by that build's owner.`
          : `Could not record the ruling on ${interactionId}: ${message}`,
      };
    }
  }

  const result = await core.captureOrgDecisionOutcomeAs(userId, {
    interactionId,
    answer,
    rationale,
    makeStanding: false,
    chosenOptionId,
  });
  if (!result.ok) {
    return { success: false, message: `Could not record the ruling on ${interactionId}: ${result.error}` };
  }
  return {
    success: true,
    entityId: interactionId,
    message: result.status === "already-captured"
      ? `Decision ${interactionId} already has the owner's answer; nothing was changed.`
      : `Recorded the owner's ruling on ${interactionId}; ${result.resolvedCount} open review(s) closed.`,
    data: { interactionId, status: result.status, resolvedCount: result.resolvedCount, ...(result.warning ? { warning: result.warning } : {}) },
  };
}

export const ownerRulingPack: ToolPack = {
  packId: "owner-ruling",
  definitions,
  handlers: {
    record_owner_ruling: (params, userId) => recordOwnerRulingHandler(params, userId),
  },
  grants: {
    record_owner_ruling: ["decision_record_create"],
  },
};
