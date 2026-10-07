import {
  DEFAULT_TERMINAL_RECOVERY_PORTS,
  resolveTerminalInitiativeRecovery,
  type TerminalRecoveryPorts,
} from "@/lib/backlog/initiative-readiness/terminal-recovery";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import type { ActionResult } from "@/lib/shared/action-result";

import { loadItemDeliveryActorIds, type DeliveryActorDb } from "./delivery-actors";
import { excludedAgentSet, projectOwedAcceptance, type OwedAcceptanceOwnerRecovery, type OwedAcceptanceOwnerResolver } from "./owed-acceptance";
import { executionEvidenceGrants, isExecutionEvidenceLane, resolveExecutionEvidenceOwner } from "./execution-evidence-owner";
import { createOwedAcceptanceOwnerResolver } from "./owed-acceptance-owner";
import { inPlatformGrants, withNoInPlatformCoworker, type InPlatformOwnerDb } from "./in-platform-owners";
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
  /** BI-099A0BA3 (M1): every agent that delivered the item, any room (delivery-actors.ts). */
  loadDeliveryActorIds(item: AcceptanceSweepPageItem): Promise<ActionResult<string[]>>;
  loadCompletionDecision(itemId: string, authorAgentId: string | null): Promise<InitiativeReadinessDecision | null>;
  resolveOwner: OwedAcceptanceOwnerResolver;
};

/**
 * The resolver the sweep uses: the terminal chain with the author removed from
 * the candidates, and only coworkers the platform can run eligible
 * (in-platform-owners.ts, BI-C1781121).
 *
 * A small or break-fix item's delivery-coordinator evidence never goes through
 * the chain: it is recorded with record_execution_evidence, and its owner is
 * the first eligible in-platform holder of that tool's grant other than the
 * author (execution-evidence-owner.ts, BI-7C7E8CAC). The rest of the decision,
 * if any, still takes the chain.
 */
export function createSweepOwnerResolver(context: {
  db: InPlatformOwnerDb;
  ports?: Partial<TerminalRecoveryPorts>;
  /** The grants that authorize record_execution_evidence; the grant registry by default. */
  executionEvidenceGrants?: () => Promise<readonly string[]>;
}): OwedAcceptanceOwnerResolver {
  const grants = inPlatformGrants(context.db);
  const loadLaneGrants = context.executionEvidenceGrants ?? executionEvidenceGrants;
  const chain: OwedAcceptanceOwnerResolver = async ({ decision, authorAgentId, excludedAgentIds }) => withNoInPlatformCoworker(await resolveTerminalInitiativeRecovery({
    decision,
    currentAgentId: authorAgentId,
    refusedWorkroomId: null,
    ports: {
      ...DEFAULT_TERMINAL_RECOVERY_PORTS,
      ...context.ports,
      resolveRecovery: (args) => createOwedAcceptanceOwnerResolver({
        db: grants.db,
        dispatchContext: args.dispatchContext,
        canonicalArtifact: args.canonicalArtifact ?? null,
        ...(args.planArtifact !== undefined ? { planArtifact: args.planArtifact } : {}),
        expectedCurrentBaselineId: args.expectedCurrentBaselineId ?? null,
        ...(args.eligibleEvidenceActivityIds ? { eligibleEvidenceActivityIds: args.eligibleEvidenceActivityIds } : {}),
      })({ decision: args.decision, authorAgentId: args.currentAgentId, excludedAgentIds: excludedAgentSet(authorAgentId, excludedAgentIds) }),
    },
  }), grants, excludedAgentSet(authorAgentId, excludedAgentIds));

  return async ({ decision, authorAgentId, excludedAgentIds }) => {
    const inLane = (entry: InitiativeReadinessDecision["unmet"][number]) => isExecutionEvidenceLane(decision, entry);
    const lane = [...decision.blockers, ...decision.unmet].filter(inLane);
    if (lane.length === 0) return chain({ decision, authorAgentId, excludedAgentIds });
    const rest = {
      ...decision,
      blockers: decision.blockers.filter((entry) => !inLane(entry)),
      unmet: decision.unmet.filter((entry) => !inLane(entry)),
    };
    const chained: OwedAcceptanceOwnerRecovery = rest.blockers.length + rest.unmet.length > 0
      ? await chain({ decision: rest, authorAgentId, excludedAgentIds })
      : { reviewerRoutes: [], escalations: [], unroutable: [] };
    const owned = await resolveExecutionEvidenceOwner({
      entries: lane,
      authorAgentId,
      // BI-099A0BA3 (M1): every delivery actor, not only the guessed author.
      excludedAgentIds: excludedAgentSet(authorAgentId, excludedAgentIds),
      grants,
      satisfyingGrants: await loadLaneGrants(),
    });
    return {
      reviewerRoutes: [...chained.reviewerRoutes, ...owned.reviewerRoutes],
      escalations: [...chained.escalations, ...owned.escalations],
      unroutable: [...chained.unroutable, ...owned.unroutable],
    };
  };
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
  // Fail closed: an item whose delivery actors cannot be read names no owner this run.
  const actors = await deps.loadDeliveryActorIds(item);
  if (!actors.ok) throw new Error(`The delivery actors of ${item.itemId} could not be read: ${actors.error}`);
  // The decision travels with the projection so a closure (BI-45D3BBF4) cites the gate it acted on.
  return {
    ...(await projectOwedAcceptance({ decision, authorAgentId, excludedAgentIds: actors.data, resolveOwner: deps.resolveOwner })),
    decision,
  };
}

/** Production bindings. Lazy imports keep the read tools off the scheduler's import graph. */
export function productionSweepEvaluateDeps(db: InPlatformOwnerDb & DeliveryActorDb): SweepEvaluateDeps {
  return {
    loadDeliveryActorIds: (item) => loadItemDeliveryActorIds(db, item.itemId),
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
