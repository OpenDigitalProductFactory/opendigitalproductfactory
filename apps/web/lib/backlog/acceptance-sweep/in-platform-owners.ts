import { loadInPlatformAgentIds, type ExecutionRuntimeDb } from "@/lib/coworker-lifecycle/execution-runtime";

import type { OwedAcceptanceOwnerRecovery } from "./owed-acceptance";
import type { OwedAcceptanceOwnerDb } from "./owed-acceptance-owner";

// Acceptance owners are coworkers the platform itself can run (BI-C1781121).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.4.
//
// The owner the sweep names is who it routes the item to, and routing
// dispatches through the Workroom drive and the platform's own agent loop. An
// external CLI agent (AgentExecutionConfig.executionType `external_cli`, e.g.
// AGT-EXT-CLAUDE) acts only when a person runs it, so naming it would route the
// work to nobody. The rule is coworker-lifecycle/execution-runtime.ts
// runsInPlatform.
//
// This decorates the owner resolver's grant read: rows held by agents that do
// not run in-platform are dropped before resolution, and remembered. When a
// lane then has no eligible reviewer only because its holders are external, the
// escalation is reported `no-in-platform-coworker` naming them. It is never
// defaulted to a person.

export const NO_IN_PLATFORM_COWORKER = "no-in-platform-coworker";

export type InPlatformOwnerDb = OwedAcceptanceOwnerDb & ExecutionRuntimeDb;

type GrantRow = Awaited<ReturnType<OwedAcceptanceOwnerDb["agentToolGrant"]["findMany"]>>[number];

export type InPlatformGrants = {
  /** The grant read with external agents' rows removed. */
  db: OwedAcceptanceOwnerDb;
  /** External agents seen holding `grant`, other than `excludeAgentId`. */
  externalHoldersOf(grant: string, excludeAgentId: string | null): string[];
};

export function inPlatformGrants(db: InPlatformOwnerDb): InPlatformGrants {
  const runsHere = new Map<string, boolean>();
  const externalGrants = new Map<string, Set<string>>();

  const classify = async (rows: readonly GrantRow[]) => {
    const unknown = [...new Set(rows.map((row) => row.agent.agentId))].filter((id) => !runsHere.has(id));
    if (unknown.length === 0) return;
    const inPlatform = await loadInPlatformAgentIds(db, unknown);
    for (const id of unknown) runsHere.set(id, inPlatform.has(id));
  };

  return {
    db: {
      agentToolGrant: {
        findMany: async (args) => {
          const rows = await db.agentToolGrant.findMany(args);
          await classify(rows);
          return rows.filter((row) => {
            if (runsHere.get(row.agent.agentId)) return true;
            const held = externalGrants.get(row.agent.agentId) ?? new Set<string>();
            held.add(row.grantKey);
            externalGrants.set(row.agent.agentId, held);
            return false;
          });
        },
      },
    },
    externalHoldersOf: (grant, excludeAgentId) =>
      [...externalGrants.entries()]
        .filter(([agentId, grants]) => agentId !== excludeAgentId && grants.has(grant))
        .map(([agentId]) => agentId)
        .sort(),
  };
}

/**
 * A lane with no eligible reviewer whose grant only external agents hold reads
 * `no-in-platform-coworker`, so the run summary says what to fix (grant the
 * lane to an in-platform coworker) instead of "nobody holds it".
 */
export function withNoInPlatformCoworker(
  recovery: OwedAcceptanceOwnerRecovery,
  grants: Pick<InPlatformGrants, "externalHoldersOf">,
  authorAgentId: string | null,
): OwedAcceptanceOwnerRecovery {
  return {
    ...recovery,
    escalations: recovery.escalations.map((escalation) => {
      if (escalation.reason !== "no-eligible-reviewer") return escalation;
      const external = grants.externalHoldersOf(escalation.grant, authorAgentId);
      if (external.length === 0) return escalation;
      return {
        ...escalation,
        reason: NO_IN_PLATFORM_COWORKER,
        nextAction:
          `${external.join(", ")} hold ${escalation.grant} for ${escalation.toolName} but run only outside the platform `
          + "(execution runtime not in_process), so no dispatch can reach them. Grant the lane to an in-platform "
          + "coworker; do not route it to a person.",
      };
    }),
  };
}
