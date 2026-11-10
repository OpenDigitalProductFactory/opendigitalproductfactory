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
// and every other agent that delivered the item removed (BI-099A0BA3, security
// review M1: delivery-actors.ts). Nothing here defaults to a person.

export const EXECUTION_EVIDENCE_WRITER = "record_execution_evidence";
// Same name as scheduled-task-runs.ts WORKROOM_STAGE_EVIDENCE_TOOL, kept literal so
// the sweep does not import the scheduler's module graph.
const STAGE_EVIDENCE_WRITER = "record_workroom_evidence";
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
  return grantsAuthorizing(EXECUTION_EVIDENCE_WRITER);
}

/**
 * Every grant key any one of which authorizes the verify stage's own evidence
 * writer, record_workroom_evidence (BI-A8679D84). The owner this lane names is
 * bound to an acceptance room, and every Workroom stage run must reach that
 * writer (scheduled-task-runs.ts scheduledMandatoryToolNames), so an owner
 * without it can only be refused before dispatch.
 */

export async function stageEvidenceWriterGrants(): Promise<string[]> {
  return grantsAuthorizing(STAGE_EVIDENCE_WRITER);
}

async function grantsAuthorizing(toolName: string): Promise<string[]> {
  const { getToolGrantMapping, grantsSatisfyRequirement, knownGrantKeys } = await import("@/lib/tak/agent-grants");
  const required = getToolGrantMapping()[toolName] ?? [];
  // An empty requirement would be universal; a lane owner is never "anyone".
  if (required.length === 0) return [];
  return knownGrantKeys().filter((grant) => grantsSatisfyRequirement(required, [grant]));
}

export async function resolveExecutionEvidenceOwner(input: {
  entries: ReadonlyArray<Pick<ReadinessRequirementResult, "code">>;
  authorAgentId: string | null;
  /** The author and every other delivery actor (delivery-actors.ts); none may own the check. */
  excludedAgentIds?: readonly string[];
  grants: InPlatformGrants;
  satisfyingGrants: readonly string[];
  /** Grants authorizing the stage's own evidence writer; when given, the owner must hold one (BI-A8679D84). */
  stageWriterGrants?: readonly string[];
}): Promise<OwedAcceptanceOwnerRecovery> {
  const codes: ReadinessCode[] = [...new Set(input.entries.map((entry) => entry.code))];
  const excluded = [...new Set([...(input.authorAgentId ? [input.authorAgentId] : []), ...(input.excludedAgentIds ?? [])])];
  const stageWriters = input.stageWriterGrants
    ? new Set((await loadEligibleGrantHolders(input.grants.db, input.stageWriterGrants)).map((row) => row.agent.agentId))
    : null;
  const holders = (await loadEligibleGrantHolders(input.grants.db, input.satisfyingGrants))
    .filter((row) => !excluded.includes(row.agent.agentId) && (!stageWriters || stageWriters.has(row.agent.agentId)));
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
  const external = [...new Set(input.satisfyingGrants.flatMap((grant) => input.grants.externalHoldersOf(grant, excluded)))].sort();
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
              + "coworker that did not deliver the item; do not route it to a person.",
          }
        : {
            reason: "no-eligible-reviewer" as const,
            nextAction:
              `No active production in-platform coworker that did not deliver the item holds ${grantList} for ${EXECUTION_EVIDENCE_WRITER}. `
              + "Grant it to one; do not route the check to a person or back to the author.",
          }),
    }],
  };
}
