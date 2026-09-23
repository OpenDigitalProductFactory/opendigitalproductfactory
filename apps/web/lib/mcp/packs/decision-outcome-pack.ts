// Decision outcome tool pack (BI-F302B80E slice 1, part 2).
//
// Closes the kernel's loop. `principle_decide` records what the kernel would
// do; this records what the caller then did. Without it a recommendation is an
// isolated event: `chosenOptionId` and `humanOutcome` had no writer on this
// path, and `principle_decide` rows are excluded from every owner-ruling
// surface by design (owner-ruling-queue.ts) — correctly, because the actor is
// the agent that asked, not an owner watching an inbox. So the report has to
// come back from the caller, and until now there was nowhere to put it.
//
// It is a separate tool from `principle_decide` for the same reason
// `reverify_decision_evidence` is: a decision must not certify its own outcome.
// The call happens after the work, by the party that did it.
//
// Grant is `decision_record_create`, matching `propose_improvement` — this
// appends a record, it never changes what the kernel decided. The two columns
// it writes are the only decision columns absent from SEALED_IMMUTABLE_FIELDS.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "record_decision_outcome",
    description:
      "Report what you actually did with a kernel recommendation, so the decision can be scored against reality. Call it AFTER acting on a `principle_decide` result, using the `interactionId` from that call's `data.ledger`. "
      + "Pass `chosenOptionId` = the option you went with. Passing the recommended option records agreement; passing a different one records an OVERRIDE, which is the single most valuable row in this corpus because it is a labelled correction the kernel can learn from — so do not soften it. "
      + "Pass `chosenOptionId: null` to record explicitly that the decision was left unresolved (the work was dropped, superseded, or overtaken). Unresolved is a recorded state; an absent report is not, and is never read as agreement. "
      + "`rationale` should say WHY, especially for an override: what the kernel's scoring missed. "
      + "Refusals are informative, not errors to retry: 'no-recommendation' (the kernel abstained, so there is nothing to agree with), 'already-resolved' (an outcome is recorded; record an amendment as its own decision rather than overwriting a correction), 'option-not-offered' (that option was never scored). "
      + "WRITE-ONCE: call it once per decision, after you have acted. It appends an outcome; it cannot change what the kernel decided, and it will refuse rather than overwrite an outcome already on the row.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: {
          type: "string",
          description:
            "The decision's interactionId (e.g. 'DI-18A9DB68B82F'), from principle_decide's `data.ledger.interactionId`.",
        },
        chosenOptionId: {
          type: ["string", "null"],
          description:
            "The option id you actually went with, or null to record the decision as left unresolved. Must be one of the options that were scored.",
        },
        resolvedBy: {
          type: "string",
          enum: ["agent", "human"],
          description:
            "Who made the call. An agent agreeing with the kernel and a human agreeing with it are different measurements and are never pooled into one rate, so report this honestly: 'human' only when a person chose.",
          default: "agent",
        },
        rationale: {
          type: "string",
          description:
            "Why this option, in one or two sentences. For an override, say what the kernel's scoring missed — that is the part a later tuning pass reads.",
        },
      },
      required: ["interactionId", "chosenOptionId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
];

function summarize(result: {
  disposition: string;
  agreement: boolean | null;
  interactionId: string;
}): string {
  if (result.disposition === "unresolved") {
    return `Recorded ${result.interactionId} as unresolved. It is counted as reported-and-undecided, and stays out of any agreement denominator rather than being read as disagreement.`;
  }
  return result.agreement
    ? `Recorded: you followed the kernel's recommendation on ${result.interactionId}.`
    : `Recorded an OVERRIDE on ${result.interactionId}. This is the highest-signal row in the corpus — a labelled case where the kernel's scoring and the actor disagreed.`;
}

async function recordDecisionOutcomeHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const interactionId = String(params["interactionId"] ?? "").trim();
  if (!interactionId) {
    return { success: false, message: "interactionId is required." };
  }

  // `chosenOptionId` is required but nullable: null MEANS unresolved, so an
  // omitted key and an explicit null must not collapse into the same thing.
  if (!("chosenOptionId" in params)) {
    return {
      success: false,
      message:
        "chosenOptionId is required. Pass the option you went with, or null to record the decision as left unresolved.",
    };
  }
  const rawChoice = params["chosenOptionId"];
  if (rawChoice !== null && typeof rawChoice !== "string") {
    return { success: false, message: "chosenOptionId must be a string option id, or null." };
  }
  const chosenOptionId = rawChoice === null ? null : rawChoice.trim() || null;

  const resolvedByRaw = String(params["resolvedBy"] ?? "agent").trim();
  if (resolvedByRaw !== "agent" && resolvedByRaw !== "human") {
    return { success: false, message: 'resolvedBy must be "agent" or "human".' };
  }

  const { prisma } = await import("@dpf/db");
  const { recordDecisionOutcome } = await import("@/lib/decision/decision-outcome-store");

  const result = await recordDecisionOutcome({
    db: prisma as never,
    interactionId,
    chosenOptionId,
    resolvedBy: resolvedByRaw,
    rationale: String(params["rationale"] ?? "").trim(),
  });

  if (!result.recorded) {
    return { success: false, message: result.detail, data: { reason: result.reason } };
  }

  return {
    success: true,
    message: summarize(result),
    data: {
      interactionId: result.interactionId,
      disposition: result.disposition,
      agreement: result.agreement,
    },
  };
}

export const decisionOutcomePack: ToolPack = {
  packId: "decision-outcome",
  definitions,
  handlers: {
    record_decision_outcome: (params) => recordDecisionOutcomeHandler(params),
  },
  grants: {
    record_decision_outcome: ["decision_record_create"],
  },
};
