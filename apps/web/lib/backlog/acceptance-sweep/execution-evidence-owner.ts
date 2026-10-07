import type {
  InitiativeReadinessDecision,
  ReadinessCode,
  ReadinessRequirementResult,
} from "@/lib/backlog/initiative-readiness/types";
import { loadEligibleGrantHolders } from "@/lib/tak/initiative-readiness-tool-grants";

import { NO_IN_PLATFORM_COWORKER, type InPlatformGrants } from "./in-platform-owners";
import type { OwedAcceptanceOwnerRecovery } from "./owed-acceptance";

// The owner of a small or break-fix item's execution evidence (BI-7C7E8CAC).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.1, §3.4.
//
// Under readiness.v3 a small item's ACCEPTANCE_EVIDENCE_REQUIRED, and a small
// or break-fix item's DELIVERY_EVIDENCE_REQUIRED, belong to the
// delivery-coordinator and are met by execution evidence recorded with
// record_execution_evidence: the runtime check on the live install, or the
// failing-to-passing test (shape-requirements.ts small(), breakFix()). That role
// has no readiness writer lane, and the terminal chain answers the acceptance
// code with an author-facing escalation that names no coworker
// (shape-lane-escalations.ts smallShapeAcceptanceEscalation). Its other callers
// still get that escalation. The sweep alone resolves an owner here, so these
// items, the bulk of the awaiting pool, stop reading unroutable.
//
// The owner is picked by the rule every lane owner is picked by
// (loadEligibleGrantHolders: active, production, unarchived, ordered by agent
// id) over the grants that authorize record_execution_evidence, read from the
// grant registry (TOOL_TO_GRANTS with GRANT_IMPLICATIONS), through the
// in-platform grant read so external agents never qualify, with the author
// removed. Nothing here defaults to a person.

export const EXECUTION_EVIDENCE_WRITER = "record_execution_evidence";
const LANE_ROLE = "delivery-coordinator";

/** The delivery-coordinator requirement the sweep routes to the execution-evidence lane. */
export function isExecutionEvidenceLane(
  decision: Pick<InitiativeReadinessDecision, "shapeDecision">,
  entry: Pick<ReadinessRequirementResult, "code" | "accountableRole">,
): boolean {
  if (entry.accountableRole !== LANE_ROLE) return false;
  // Only the small shape assigns acceptance to the delivery-coordinator; this
  // is the predicate terminal-recovery.ts answers with the small-shape escalation.
  if (entry.code === "ACCEPTANCE_EVIDENCE_REQUIRED") return true;
  const shape = decision.shapeDecision?.effective;
  return entry.code === "DELIVERY_EVIDENCE_REQUIRED" && (shape === "small" || shape === "break-fix");
}

/**
 * Every grant key any one of which lets a coworker call
 * record_execution_evidence (today `build_evidence`, and `backlog_write`, which
 * implies it). Lazy: the grant registry stays off the scheduler's import graph.
 */
export async function executionEvidenceGrants(): Promise<string[]> {
  const { getToolGrantMapping, grantsSatisfyRequirement, knownGrantKeys } = await import("@/lib/tak/agent-grants");
  const required = getToolGrantMapping()[EXECUTION_EVIDENCE_WRITER] ?? [];
  // An empty requirement would be universal; a lane owner is never "anyone".
  if (required.length === 0) return [];
  return knownGrantKeys().filter((grant) => grantsSatisfyRequirement(required, [grant]));
}

export async function resolveExecutionEvidenceOwner(input: {
  entries: ReadonlyArray<Pick<ReadinessRequirementResult, "code">>;
  authorAgentId: string | null;
  grants: InPlatformGrants;
  satisfyingGrants: readonly string[];
}): Promise<OwedAcceptanceOwnerRecovery> {
  const codes: ReadinessCode[] = [...new Set(input.entries.map((entry) => entry.code))];
  const holders = (await loadEligibleGrantHolders(input.grants.db, input.satisfyingGrants))
    .filter((row) => row.agent.agentId !== input.authorAgentId);
  const owner = holders[0];
  if (owner) {
    return {
      reviewerRoutes: [{
        accountableRole: LANE_ROLE,
        toolName: EXECUTION_EVIDENCE_WRITER,
        grant: owner.grantKey,
        targetAgentId: owner.agent.agentId,
        targetDisplayName: owner.agent.displayName,
        codes,
      }],
      escalations: [],
      unroutable: [],
    };
  }
  const grantList = input.satisfyingGrants.join(" or ") || "(no grant authorizes it)";
  const external = [...new Set(input.satisfyingGrants.flatMap((grant) => input.grants.externalHoldersOf(grant, input.authorAgentId ? [input.authorAgentId] : [])))].sort();
  return {
    reviewerRoutes: [],
    unroutable: [],
    escalations: [{
      accountableRole: LANE_ROLE,
      toolName: EXECUTION_EVIDENCE_WRITER,
      grant: grantList,
      codes,
      ...(external.length > 0
        ? {
            reason: NO_IN_PLATFORM_COWORKER,
            nextAction:
              `${external.join(", ")} hold ${grantList} for ${EXECUTION_EVIDENCE_WRITER} but run only outside the platform `
              + "(execution runtime not in_process), so no dispatch can reach them. Grant it to an in-platform "
              + "coworker other than the author; do not route it to a person.",
          }
        : {
            reason: "no-eligible-reviewer" as const,
            nextAction:
              `No active production in-platform coworker other than the author holds ${grantList} for ${EXECUTION_EVIDENCE_WRITER}. `
              + "Grant it to one; do not route the check to a person or back to the author.",
          }),
    }],
  };
}
