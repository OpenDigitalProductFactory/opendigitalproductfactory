import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import {
  BACKLOG_COMPLETION_ITEM_SELECT,
  evaluateBacklogItemCompletion,
  type BacklogCompletionDb,
  type BacklogCompletionDependencies,
  type BacklogCompletionItem,
} from "./backlog-completion-evaluation";
import type { DeploymentClosureProof } from "./deployment-closure";
import {
  executeGovernedTerminalTransition,
  type GovernedTerminalTransitionResult,
  type TerminalActor,
  type TerminalAuthority,
  type TerminalTransitionDb,
} from "./terminal-transition-repository";

type BacklogTerminalClient = BacklogCompletionDb & {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  backlogItem: {
    findFirst(args: unknown): Promise<BacklogCompletionItem | null>;
    findUnique(args: unknown): Promise<BacklogCompletionItem | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItemActivity: BacklogCompletionDb["backlogItemActivity"] & {
    create(args: unknown): Promise<unknown>;
  };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

type BacklogTerminalDb = TerminalTransitionDb;

function factsDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

// The merge-through-gates signal lives in ./merge-delivery-signal (BI-B04A0203);
// re-exported so existing importers keep one entry point.
export {
  mergeSignalRoots,
  mergeSignalUnavailableReason,
  pullRequestNumbersFromActivities,
  resolveMergeSignalFromRefs,
  type MergeDeliverySignal,
  type ResolveMergeDelivery,
} from "./merge-delivery-signal";

// The completion evaluation lives in ./backlog-completion-evaluation
// (BI-094B41AC), shared with the read projection; re-exported for importers.
export { isDirectMergePlatformWork, type ResolveHasDesignSpec } from "./backlog-completion-evaluation";

export async function completeBacklogItemTransition(args: {
  db?: BacklogTerminalDb;
  itemId: string;
  expectedStatus: string;
  resolution: string;
  completionEvidence: unknown;
  additionalData?: Record<string, unknown>;
  actor: TerminalActor;
  authority: TerminalAuthority;
  evaluatedAt?: string;
  dependencies?: BacklogCompletionDependencies;
}): Promise<GovernedTerminalTransitionResult> {
  const db = args.db ?? (prisma as unknown as BacklogTerminalDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  let lockedItem: BacklogCompletionItem | null = null;
  let deployment: DeploymentClosureProof | null = null;
  let acceptanceState = "missing";
  return executeGovernedTerminalTransition({
    db,
    actor: args.actor,
    authority: args.authority,
    resolve: async (genericTx) => {
      const tx = genericTx as unknown as BacklogTerminalClient;
      const found = await tx.backlogItem.findFirst({
        where: { OR: [{ itemId: args.itemId }, { id: args.itemId }] },
        select: {
          id: true, itemId: true, status: true, workType: true, type: true, source: true,
          scopeKind: true, archetypeCategories: true, archetypeIds: true, organizationId: true,
          epicId: true, claimedAt: true, createdAt: true, digitalProductId: true,
          activeBuild: { select: { kind: true, verificationOut: true, uxVerificationStatus: true } },
          productObjectiveWork: { select: { id: true }, take: 1 },
        },
      });
      if (!found) throw new Error(`Backlog item ${args.itemId} not found.`);
      await tx.$queryRawUnsafe('SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE', found.id);
      lockedItem = await tx.backlogItem.findUnique({ where: { id: found.id }, select: BACKLOG_COMPLETION_ITEM_SELECT });
      if (!lockedItem) throw new Error(`Backlog item ${args.itemId} disappeared during terminal evaluation.`);
      if (lockedItem.status !== args.expectedStatus) {
        throw new Error(`Backlog item ${lockedItem.itemId} expected status=${args.expectedStatus}, got ${lockedItem.status}.`);
      }
      const evaluated = await evaluateBacklogItemCompletion({
        db: tx,
        item: lockedItem,
        rawManifest: args.completionEvidence,
        transitionObject: { kind: "backlog-item", id: lockedItem.id, expectedVersion: args.expectedStatus, targetState: "done" },
        evaluatedAt,
        ...(args.dependencies ? { dependencies: args.dependencies } : {}),
      });
      deployment = evaluated.deployment;
      acceptanceState = evaluated.acceptanceState;
      return {
        governed: evaluated.governed,
        decision: evaluated.decision,
        anchorBacklogItemId: lockedItem.id,
        factsDigest: factsDigest({
          itemId: lockedItem.itemId,
          rowId: lockedItem.id,
          expectedStatus: args.expectedStatus,
          baselineId: evaluated.reconciliation.baselineId,
          objectiveState: evaluated.reconciliation.state,
          objectiveEvidenceRefs: evaluated.reconciliation.evidenceRefs,
          deliveryState: evaluated.delivery,
          mergedThroughGates: evaluated.mergedThroughGates,
          deployment,
          acceptanceState,
          // No longer a gate (DI-273E6E15C8EB) but still worth recording: a
          // reader reconciling a receipt can tell whether this merge carried a
          // design spec or was recognised on the merge alone.
          hasDesignSpec: evaluated.hasDesignSpec,
          deliveryEvidenceRefs: evaluated.deliveryEvidenceRefs,
          evaluatedAt,
        }),
      };
    },
    mutate: async (genericTx) => {
      const tx = genericTx as unknown as BacklogTerminalClient;
      if (!lockedItem) throw new Error("Terminal readiness did not resolve a backlog item.");
      const resolution = deployment
        ? `${args.resolution}\nDelivery closed on ${deployment.runId}; acceptance ${acceptanceState}. Acceptance remains a separate verification obligation.`
        : args.resolution;
      const updated = await tx.backlogItem.updateMany({
        where: { id: lockedItem.id, status: args.expectedStatus },
        data: {
          ...args.additionalData,
          status: "done",
          ...(args.expectedStatus === "done" ? {} : { completedAt: new Date(evaluatedAt) }),
          resolution,
          claimStatus: "released",
        },
      });
      if (updated.count === 1 && args.expectedStatus !== "done") {
        await tx.backlogItemActivity.create({ data: {
          backlogItemId: lockedItem.id,
          kind: "status_change",
          summary: `${args.expectedStatus} → done${deployment ? ` (deployed; acceptance ${acceptanceState})` : ""}`,
          payload: { from: args.expectedStatus, to: "done", resolution,
            ...(deployment ? { closureBasis: "canonical-deployment", deployment, acceptanceState,
              acceptanceObligation: acceptanceState === "pass" ? "satisfied" : acceptanceState === "fail" ? "corrective-work-required" : "pending-independent-verification" } : {}),
          },
          recordedById: args.actor.humanContextRef,
          recordedByAgentId: args.actor.agentContextRef,
        } });
      }
      return updated.count;
    },
  });
}
