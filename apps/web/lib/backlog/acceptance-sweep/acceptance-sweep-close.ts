import type { completeBacklogItemTransition } from "@/lib/backlog/initiative-readiness/backlog-terminal-transition";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import type { AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import {
  CLOSE_AUTHORISATION_CONFIG_KEY,
  CLOSE_AUTHORISATION_SCOPE,
  COMPLETION_TRANSITION_TOOL,
  type CloseAuthorisation,
} from "./close-authorisation";

// One closure by the acceptance sweep (BI-45D3BBF4, AC-2).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.6.
//
// The sweep never writes status. It calls completeBacklogItemTransition, the
// same governed boundary the MCP status tool, the backlog editor and the ops
// route call, with the same actor / authority / completionEvidence shape. That
// transition re-evaluates the completion gate inside its own serializable
// transaction and closes only on "allowed", so a verdict that went stale between
// the sweep's read and the close is refused there, not here.
//
// Actor: the sweep's coworker, in the human context of the operator who
// recorded the pre-authorisation. Authority: manage_backlog (held by that
// operator, checked at run time) intersected with the coworker's grant that
// permits the completion transition. The rationale cites the pre-authorisation.

type Complete = typeof completeBacklogItemTransition;

export type CloseOutcome =
  | { outcome: "closed"; authorityDecisionId: string }
  | { outcome: "refused"; code: string; authorityDecisionId: string }
  | { outcome: "skipped"; reason: "status-changed" | "not-found" };

export type AcceptanceSweepCloseDb = {
  backlogItem: {
    findUnique(args: {
      where: { id: string };
      select: { status: true; organizationId: true };
    }): Promise<{ status: string; organizationId: string | null } | null>;
  };
};

const AWAITING_ACCEPTANCE = "awaiting-acceptance";

/** The completion evidence the sweep cites: the gate decision it acted on and the evidence each satisfied requirement carried. */
export function sweepCompletionEvidence(decision: InitiativeReadinessDecision) {
  return {
    source: "acceptance-sweep",
    readinessDecisionId: decision.decisionId,
    readinessPolicyVersion: decision.policyVersion,
    readinessEvaluatedAt: decision.evaluatedAt,
    verdict: decision.verdict,
    satisfied: decision.satisfied.map((entry) => ({
      code: entry.code,
      state: entry.state,
      evidenceRefs: entry.evidenceRefs,
    })),
  };
}

export async function closeAllowedAcceptanceItem(input: {
  item: AcceptanceSweepPageItem;
  decision: InitiativeReadinessDecision;
  authorisation: Extract<CloseAuthorisation, { state: "enabled" }>;
  agentId: string;
  now: Date;
  db: AcceptanceSweepCloseDb;
  complete: Complete;
}): Promise<CloseOutcome> {
  const { item, decision, authorisation, agentId } = input;
  // Never asked to close anything else; refuse rather than trust the caller.
  if (decision.verdict !== "allowed") throw new Error(`Refusing to close ${item.itemId}: completion verdict is ${decision.verdict}.`);
  const row = await input.db.backlogItem.findUnique({ where: { id: item.id }, select: { status: true, organizationId: true } });
  if (!row) return { outcome: "skipped", reason: "not-found" };
  if (row.status !== AWAITING_ACCEPTANCE) return { outcome: "skipped", reason: "status-changed" };

  const organizationId = row.organizationId ?? "platform";
  const preAuthorisation = {
    configKey: CLOSE_AUTHORISATION_CONFIG_KEY,
    scope: CLOSE_AUTHORISATION_SCOPE,
    setByUserId: authorisation.setByUserId,
    setAt: authorisation.setAt,
    reason: authorisation.reason,
  };
  const result = await input.complete({
    itemId: item.itemId,
    expectedStatus: AWAITING_ACCEPTANCE,
    resolution:
      `Closed by the acceptance sweep (${agentId}): the completion gate already allowed done `
      + `(readiness ${decision.decisionId}). Acting under the operator pre-authorisation "${CLOSE_AUTHORISATION_SCOPE}" `
      + `recorded by ${authorisation.setByUserId} at ${authorisation.setAt}.`,
    completionEvidence: sweepCompletionEvidence(decision),
    actor: {
      actorType: "agent",
      actorRef: agentId,
      humanContextRef: authorisation.setByUserId,
      agentContextRef: agentId,
    },
    authority: {
      organizationId: row.organizationId,
      actionKey: COMPLETION_TRANSITION_TOOL,
      objectRef: item.itemId,
      rationale: {
        capability: "manage_backlog",
        grant: authorisation.agentGrant,
        source: "acceptance-sweep",
        preAuthorisation,
      },
      authoritySnapshot: {
        decision: "allow",
        effectiveHumanCapability: "manage_backlog",
        effectiveAgentGrant: authorisation.agentGrant,
        tokenScope: "organization",
        organizationId,
        actionKey: COMPLETION_TRANSITION_TOOL,
        policyVersion: "coworker-authority.v1",
      },
    },
    evaluatedAt: input.now.toISOString(),
  });
  return result.ok
    ? { outcome: "closed", authorityDecisionId: result.authorityDecisionId }
    : { outcome: "refused", code: result.code, authorityDecisionId: result.authorityDecisionId };
}
