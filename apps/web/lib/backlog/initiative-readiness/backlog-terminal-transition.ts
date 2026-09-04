import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  resolveCompletionEvidence,
  type CompletionEvidenceRuntimeDb,
  type ResolveCompletionEvidenceResult,
} from "@/lib/backlog/completion-evidence-runtime";
import { canonicalJson } from "@/lib/shared/canonical-json";
import { isReachableFromTrunk, trunkRefExists } from "@/lib/work-capsules/git-scanner";

import { projectBacklogItemReadiness, type InitiativeReadinessActivity } from "./entry-adapter";
import {
  reconcileInitiativeObjectives,
  type ObjectiveReconciliationActivity,
} from "./objective-reconciliation";
import {
  executeGovernedTerminalTransition,
  type GovernedTerminalTransitionResult,
  type TerminalActor,
  type TerminalAuthority,
  type TerminalTransitionDb,
} from "./terminal-transition-repository";

type BacklogTerminalItem = {
  id: string;
  itemId: string;
  status: string;
  workType: string | null;
  type: string | null;
  source: string | null;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  organizationId: string | null;
  epicId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  activeBuild: { kind: string; verificationOut: unknown; uxVerificationStatus: string | null } | null;
};

type BacklogTerminalActivity = ObjectiveReconciliationActivity & {
  gateKey: string | null;
  backlogItemId: string;
};

type BacklogTerminalClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  backlogItem: {
    findFirst(args: unknown): Promise<BacklogTerminalItem | null>;
    findUnique(args: unknown): Promise<BacklogTerminalItem | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItemActivity: {
    findMany(args: unknown): Promise<BacklogTerminalActivity[]>;
    create(args: unknown): Promise<unknown>;
  };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

type BacklogTerminalDb = TerminalTransitionDb;
type ProjectReadiness = typeof projectBacklogItemReadiness;
type ReconcileObjectives = typeof reconcileInitiativeObjectives;
type ResolveEvidence = typeof resolveCompletionEvidence;

function factsDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deliveryState(result: ResolveCompletionEvidenceResult) {
  if (result.kind !== "evaluated") return "missing" as const;
  if (result.verdict.allowed) return "pass" as const;
  return result.verdict.blockers.some((entry) => ["newer-failure", "invalid-evidence", "foreign-evidence"].includes(entry.code))
    ? "fail" as const
    : "missing" as const;
}

/**
 * The completion-evidence policy computes precise blockers — "missing
 * production-build", "the manifest does not match this item's work type" — and
 * `deliveryState()` flattens all of them into one word.
 *
 * BI-28E8CB88 (recurrence 2026-08-27): on BI-3727106F, `update_backlog_item_status`
 * answered `DELIVERY_EVIDENCE_REQUIRED  state: missing  evidenceRefs:
 * ["cmtb1e3it09mb01o0k78v8o7k"]` — it listed the evidence ref and still reported
 * `missing`, on a fix that was merged, green and independently verified. Carry
 * the reasons through so the caller is told which dimension is actually unmet.
 */
function deliveryReasons(result: ResolveCompletionEvidenceResult): string[] {
  if (result.kind !== "evaluated" || result.verdict.allowed) return [];
  const reasons = result.verdict.blockers.map((entry) => entry.message);
  if (result.verdict.nextAction) reasons.push(result.verdict.nextAction);
  return reasons;
}

/**
 * BI-B04A0203 (EP-4614F35E): a PR merged THROUGH the code gates — CI + the merge
 * queue — is the strongest possible delivery evidence. Branch protection means it
 * could not have reached the trunk without passing them, so a direct-merge item
 * whose branch landed does not need a hand-built delivery manifest. Detect it
 * PROCEDURALLY and LOCALLY: the item's Workroom head SHA reachable from origin/main
 * == merged, reusing the room-closeout reachability helper — no GitHub API, no LLM.
 * Best-effort: any failure (no bound room, no local trunk, git unavailable) returns
 * false so the caller falls back to the recorded completion-evidence manifest.
 */
export type ResolveMergeDelivery = (args: { itemRowId: string; itemId: string }) => Promise<boolean>;

async function defaultResolveMergeDelivery({ itemId }: { itemRowId: string; itemId: string }): Promise<boolean> {
  try {
    const room = await (prisma as unknown as {
      workroom: { findFirst(args: unknown): Promise<{ headSha: string | null } | null> };
    }).workroom.findFirst({
      where: { backlogItemId: itemId, headSha: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { headSha: true },
    });
    if (!room?.headSha) return false;
    const repoRoot = process.env.DPF_REPO_ROOT || process.cwd();
    if (!(await trunkRefExists(repoRoot))) return false;
    return (await isReachableFromTrunk(repoRoot, room.headSha)) === true;
  } catch {
    return false;
  }
}

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
  dependencies?: {
    resolveCompletionEvidence?: ResolveEvidence;
    reconcileObjectives?: ReconcileObjectives;
    projectReadiness?: ProjectReadiness;
    resolveMergeDelivery?: ResolveMergeDelivery;
  };
}): Promise<GovernedTerminalTransitionResult> {
  const db = args.db ?? (prisma as unknown as BacklogTerminalDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  let lockedItem: BacklogTerminalItem | null = null;
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
          epicId: true, claimedAt: true, createdAt: true,
          activeBuild: { select: { kind: true, verificationOut: true, uxVerificationStatus: true } },
        },
      });
      if (!found) throw new Error(`Backlog item ${args.itemId} not found.`);
      await tx.$queryRawUnsafe('SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE', found.id);
      lockedItem = await tx.backlogItem.findUnique({ where: { id: found.id }, select: {
        id: true, itemId: true, status: true, workType: true, type: true, source: true,
        scopeKind: true, archetypeCategories: true, archetypeIds: true, organizationId: true,
        epicId: true, claimedAt: true, createdAt: true,
        activeBuild: { select: { kind: true, verificationOut: true, uxVerificationStatus: true } },
      } });
      if (!lockedItem) throw new Error(`Backlog item ${args.itemId} disappeared during terminal evaluation.`);
      if (lockedItem.status !== args.expectedStatus) {
        throw new Error(`Backlog item ${lockedItem.itemId} expected status=${args.expectedStatus}, got ${lockedItem.status}.`);
      }
      const activities = await tx.backlogItemActivity.findMany({
        where: { backlogItemId: lockedItem.id, kind: { in: [
          "initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage",
          "initiative_objective_mapping", "evidence",
        ] } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 500,
        select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
      });
      const completion = await (args.dependencies?.resolveCompletionEvidence ?? resolveCompletionEvidence)(
        tx as unknown as CompletionEvidenceRuntimeDb,
        { itemId: lockedItem.itemId, rawManifest: args.completionEvidence, now: new Date(evaluatedAt) },
      );
      const reconciliation = (args.dependencies?.reconcileObjectives ?? reconcileInitiativeObjectives)({
        itemId: lockedItem.itemId,
        itemRowId: lockedItem.id,
        activities,
      });
      const mergedThroughGates = await (args.dependencies?.resolveMergeDelivery ?? defaultResolveMergeDelivery)({
        itemRowId: lockedItem.id,
        itemId: lockedItem.itemId,
      });
      // A merge through branch protection (CI + the merge queue) is authoritative
      // delivery evidence and supersedes a missing/hand-built manifest (BI-B04A0203).
      const delivery = mergedThroughGates ? "pass" : deliveryState(completion);
      const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
        item: { ...lockedItem, activeBuildKind: lockedItem.activeBuild?.kind ?? null },
        activities: activities as InitiativeReadinessActivity[],
        target: "completion",
        transitionObject: { kind: "backlog-item", id: lockedItem.id, expectedVersion: args.expectedStatus, targetState: "done" },
        authorization: "pass",
        capsuleIdentity: "pass",
        completion: {
          deliveryEvidence: delivery,
          acceptanceEvidence: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveReconciliation: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveBaselineConflict: reconciliation.state === "conflict",
          projectionError: reconciliation.state === "malformed",
          evidenceRefs: {
            DELIVERY_EVIDENCE_REQUIRED: completion.kind === "evaluated"
              ? completion.verdict.normalizedManifest?.evidenceActivityIds ?? []
              : [],
            ACCEPTANCE_EVIDENCE_REQUIRED: reconciliation.evidenceRefs,
            OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
          },
          requirementReasons: { DELIVERY_EVIDENCE_REQUIRED: mergedThroughGates ? [] : deliveryReasons(completion) },
        },
        evaluatedAt,
      });
      return {
        governed: projected.governed,
        decision: projected.decision,
        anchorBacklogItemId: lockedItem.id,
        factsDigest: factsDigest({
          itemId: lockedItem.itemId,
          rowId: lockedItem.id,
          expectedStatus: args.expectedStatus,
          baselineId: reconciliation.baselineId,
          objectiveState: reconciliation.state,
          objectiveEvidenceRefs: reconciliation.evidenceRefs,
          deliveryState: delivery,
          mergedThroughGates,
          deliveryEvidenceRefs: completion.kind === "evaluated"
            ? completion.verdict.normalizedManifest?.evidenceActivityIds ?? []
            : [],
          evaluatedAt,
        }),
      };
    },
    mutate: async (genericTx) => {
      const tx = genericTx as unknown as BacklogTerminalClient;
      if (!lockedItem) throw new Error("Terminal readiness did not resolve a backlog item.");
      const updated = await tx.backlogItem.updateMany({
        where: { id: lockedItem.id, status: args.expectedStatus },
        data: {
          ...args.additionalData,
          status: "done",
          completedAt: new Date(evaluatedAt),
          resolution: args.resolution,
          claimStatus: "released",
        },
      });
      if (updated.count === 1) {
        await tx.backlogItemActivity.create({ data: {
          backlogItemId: lockedItem.id,
          kind: "status_change",
          summary: `${args.expectedStatus} → done`,
          payload: { from: args.expectedStatus, to: "done", resolution: args.resolution },
          recordedById: args.actor.humanContextRef,
          recordedByAgentId: args.actor.agentContextRef,
        } });
      }
      return updated.count;
    },
  });
}
