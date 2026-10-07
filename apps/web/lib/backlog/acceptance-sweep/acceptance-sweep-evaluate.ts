import {
  DEFAULT_TERMINAL_RECOVERY_PORTS,
  resolveTerminalInitiativeRecovery,
  type TerminalRecoveryPorts,
} from "@/lib/backlog/initiative-readiness/terminal-recovery";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import { projectOwedAcceptance, type OwedAcceptanceOwnerResolver } from "./owed-acceptance";
import { createOwedAcceptanceOwnerResolver, type OwedAcceptanceOwnerDb } from "./owed-acceptance-owner";
import type { AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import type { SweepEvaluation } from "./acceptance-sweep-run";

// One item's owed acceptance, as the sweep computes it (BI-DF255666).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.1, §3.3 step 2.
//
// Readiness comes from getBacklogItem, the same projection path the reviewer
// dispatch reads (server-reviewer-dispatch.ts), so there is one answer to
// "what is owed now".
//
// S1's owner resolver names a coworker only when given the Workroom branch and
// immutable head (plus, for the acceptance lane, the bound artifact and the
// eligible evidence). The terminal recovery chain already finds exactly those
// for an item: its live Workroom through WorkCapsule.backlogItemId, its current
// baseline and artifact, and its post-baseline evidence. The sweep runs that
// chain and swaps only its final resolver for S1's author-excluding one. An
// item the chain cannot bind (no live room, no baseline, no evidence) reads
// unroutable with the chain's own reason; nothing is guessed.

export type SweepEvaluateDeps = {
  loadAuthorAgentId(item: AcceptanceSweepPageItem): Promise<string | null>;
  loadCompletionDecision(itemId: string, authorAgentId: string | null): Promise<InitiativeReadinessDecision | null>;
  resolveOwner: OwedAcceptanceOwnerResolver;
};

/** The resolver the sweep uses: the terminal chain with the author removed from the candidates. */
export function createSweepOwnerResolver(context: {
  db: OwedAcceptanceOwnerDb;
  ports?: Partial<TerminalRecoveryPorts>;
}): OwedAcceptanceOwnerResolver {
  return ({ decision, authorAgentId }) => resolveTerminalInitiativeRecovery({
    decision,
    currentAgentId: authorAgentId,
    refusedWorkroomId: null,
    ports: {
      ...DEFAULT_TERMINAL_RECOVERY_PORTS,
      ...context.ports,
      resolveRecovery: (args) => createOwedAcceptanceOwnerResolver({
        db: context.db,
        dispatchContext: args.dispatchContext,
        canonicalArtifact: args.canonicalArtifact ?? null,
        ...(args.planArtifact !== undefined ? { planArtifact: args.planArtifact } : {}),
        expectedCurrentBaselineId: args.expectedCurrentBaselineId ?? null,
        ...(args.eligibleEvidenceActivityIds ? { eligibleEvidenceActivityIds: args.eligibleEvidenceActivityIds } : {}),
      })({ decision: args.decision, authorAgentId: args.currentAgentId }),
    },
  });
}

/**
 * The item's authoring assistant, read as the reviewer dispatch reads it: the
 * newest room an assistant authored, else the claim, else the item's agent.
 */
export function authorAgentIdFrom(
  rooms: ReadonlyArray<{ agentId: string | null }>,
  item: Pick<AcceptanceSweepPageItem, "claimedByAgentId" | "agentId">,
): string | null {
  return rooms.find((room) => room.agentId)?.agentId ?? item.claimedByAgentId ?? item.agentId ?? null;
}

export async function evaluateOwedAcceptance(
  item: AcceptanceSweepPageItem,
  deps: SweepEvaluateDeps,
): Promise<SweepEvaluation | null> {
  const authorAgentId = await deps.loadAuthorAgentId(item);
  const decision = await deps.loadCompletionDecision(item.itemId, authorAgentId);
  if (!decision) return null;
  // The decision travels with the projection so a closure (BI-45D3BBF4) cites the gate it acted on.
  return { ...(await projectOwedAcceptance({ decision, authorAgentId, resolveOwner: deps.resolveOwner })), decision };
}

/** Production bindings. Lazy imports keep the read tools off the scheduler's import graph. */
export function productionSweepEvaluateDeps(db: OwedAcceptanceOwnerDb): SweepEvaluateDeps {
  return {
    loadAuthorAgentId: async (item) => {
      const { loadRoomAuthors } = await import("@/lib/backlog/initiative-readiness/server-reviewer-dispatch");
      // A room may record the item's BI- id or its row id (Build Studio writes the row id).
      return authorAgentIdFrom(await loadRoomAuthors({ backlogItemId: { in: [item.itemId, item.id] } }), item);
    },
    loadCompletionDecision: async (itemId, authorAgentId) => {
      const { getBacklogItem } = await import("@/lib/mcp/packs/backlog-pack-read-tools");
      const result = await getBacklogItem({ itemId }, authorAgentId);
      const completion = (result.data?.readiness as { decisions?: { completion?: unknown } } | undefined)?.decisions?.completion;
      return result.success && completion ? completion as InitiativeReadinessDecision : null;
    },
    resolveOwner: createSweepOwnerResolver({ db }),
  };
}
