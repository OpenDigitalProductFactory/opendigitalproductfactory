import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  resolveCompletionEvidence,
  type CompletionEvidenceRuntimeDb,
  type ResolveCompletionEvidenceResult,
} from "@/lib/backlog/completion-evidence-runtime";
import { canonicalJson } from "@/lib/shared/canonical-json";
import { isReachableFromTrunk, trunkHasMergedPullRequest, trunkRefExists } from "@/lib/work-capsules/git-scanner";

import { projectBacklogItemReadiness, type InitiativeReadinessActivity } from "./entry-adapter";
import { type InheritanceDb, loadInheritedInitiativeScope } from "./parent-scope-inheritance";
import { type BoundWorkShapeDb, readBoundWorkShapeRef } from "./bound-work-shape";
import { deriveDeliverableSensitivity } from "@/lib/explore/build-process-matrix";
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
  title?: string | null;
  body?: string | null;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  organizationId: string | null;
  epicId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  digitalProductId: string | null;
  activeBuild: { kind: string; verificationOut: unknown; uxVerificationStatus: string | null } | null;
  productObjectiveWork?: { id: string }[];
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

/**
 * Candidate source roots the merge signal probes, in order. The portal runtime has
 * no working checkout at cwd, but it DOES mount the host source tree the self-upgrade
 * pipeline runs git against (`/host-dpf`), so reachability stays LOCAL and procedural
 * — no GitHub API, no LLM (platform-function-never-depends-on-a-client). The first
 * root whose trunk ref resolves wins; if none does, the signal is false and the
 * caller falls back to the recorded manifest.
 */
function mergeSignalRoots(): string[] {
  const roots = [process.env.DPF_REPO_ROOT, process.env.DPF_HOST_SOURCE_ROOT, "/host-dpf", process.cwd()];
  return [...new Set(roots.filter((r): r is string => Boolean(r)))];
}

/** Pull-request numbers named by an item's evidence links (`.../pull/123`). */
export function pullRequestNumbersFromActivities(
  activities: readonly { kind: string; payload: unknown }[],
): number[] {
  const numbers = new Set<number>();
  for (const activity of activities) {
    if (activity.kind !== "evidence") continue;
    const url = (activity.payload as { url?: unknown } | null)?.url;
    const match = typeof url === "string" ? url.match(/\/pull\/(\d+)(?:[/?#]|$)/) : null;
    if (match) numbers.add(Number(match[1]));
  }
  return [...numbers];
}

/**
 * Delivery evidence is the trunk (BI-AFE8BB73, design §4): a SHA reachable
 * from origin/main satisfies DELIVERY_EVIDENCE_REQUIRED for every shape.
 * Read the Workroom heads first; when no room recorded a head (a fix worked
 * outside a Workroom, or a room whose head was never synced), fall back to the
 * item's linked pull request — the room's `pullRequestNumber` or an evidence
 * link — and look for its merge commit on the trunk. The manifest path stays
 * as the fallback the caller already has.
 */
async function defaultResolveMergeDelivery({ itemRowId, itemId }: { itemRowId: string; itemId: string }): Promise<boolean> {
  try {
    const db = prisma as unknown as {
      workroom: { findMany(args: unknown): Promise<{ headSha: string | null; pullRequestNumber: number | null }[]> };
      backlogItemActivity: { findMany(args: unknown): Promise<{ kind: string; payload: unknown }[]> };
    };
    const rooms = await db.workroom.findMany({
      where: { backlogItemId: itemId },
      orderBy: { updatedAt: "desc" },
      select: { headSha: true, pullRequestNumber: true },
    });
    const heads = rooms.map((room) => room.headSha).filter((sha): sha is string => Boolean(sha));
    const evidence = await db.backlogItemActivity.findMany({
      where: { backlogItemId: itemRowId, kind: "evidence" },
      select: { kind: true, payload: true },
      take: 200,
    });
    const pullRequests = [
      ...rooms.map((room) => room.pullRequestNumber).filter((n): n is number => typeof n === "number"),
      ...pullRequestNumbersFromActivities(evidence),
    ];
    if (heads.length === 0 && pullRequests.length === 0) return false;
    for (const root of mergeSignalRoots()) {
      if (!(await trunkRefExists(root))) continue;
      for (const sha of heads) {
        if ((await isReachableFromTrunk(root, sha)) === true) return true;
      }
      for (const prNumber of new Set(pullRequests)) {
        if ((await trunkHasMergedPullRequest(root, prNumber)) === true) return true;
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * The direct-merge-platform predicate (EP-4614F35E, kernel-ratified DI-54AECB341524).
 * A merge through the gates completes an item WITHOUT the full independent-reviewer
 * lifecycle ONLY for platform self-development — maintainer changes that landed via
 * CI + the merge queue + PR review. Demand-driven customer feature work is excluded
 * and keeps the full lifecycle: it carries a Build Studio build, a DigitalProduct,
 * or a linked product objective, any of which fails this predicate. The boundary is
 * deliberately tight — when in doubt it does NOT recognize, so governance fails safe.
 */
export function isDirectMergePlatformWork(item: {
  scopeKind: string | null;
  digitalProductId: string | null;
  activeBuild: unknown | null;
  productObjectiveWork?: { id: string }[];
}): boolean {
  const platformScoped = item.scopeKind === "platform" || item.scopeKind === "common";
  const noBuild = item.activeBuild == null;
  const noProduct = item.digitalProductId == null;
  const noObjective = (item.productObjectiveWork?.length ?? 0) === 0;
  return platformScoped && noBuild && noProduct && noObjective;
}

/**
 * Whether a design spec is present for the item. Injectable; the default is
 * non-blocking (true) because absence of a spec CORPUS on a given runtime is not
 * absence of a spec (spec-plan-search §caveat), and for direct-merge platform work
 * the PR review is itself the design review. An install that wants to REQUIRE a
 * discoverable spec injects a strict scanner. Kept out of the DB transaction to
 * avoid a fragile filesystem dependency on the hot completion path.
 */
export type ResolveHasDesignSpec = (args: { itemId: string }) => Promise<boolean>;
const defaultResolveHasDesignSpec: ResolveHasDesignSpec = async () => true;

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
    resolveHasDesignSpec?: ResolveHasDesignSpec;
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
          epicId: true, claimedAt: true, createdAt: true, digitalProductId: true,
          activeBuild: { select: { kind: true, verificationOut: true, uxVerificationStatus: true } },
          productObjectiveWork: { select: { id: true }, take: 1 },
        },
      });
      if (!found) throw new Error(`Backlog item ${args.itemId} not found.`);
      await tx.$queryRawUnsafe('SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE', found.id);
      lockedItem = await tx.backlogItem.findUnique({ where: { id: found.id }, select: {
        id: true, itemId: true, status: true, workType: true, type: true, source: true, title: true, body: true,
        scopeKind: true, archetypeCategories: true, archetypeIds: true, organizationId: true,
        epicId: true, claimedAt: true, createdAt: true, digitalProductId: true,
          activeBuild: { select: { kind: true, verificationOut: true, uxVerificationStatus: true } },
          productObjectiveWork: { select: { id: true }, take: 1 },
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
      // EP-4614F35E (kernel DI-54AECB341524): recognize a merge through the code
      // gates (CI + merge queue + PR review) as completing DIRECT-MERGE PLATFORM
      // work — the governance appropriate to maintainer changes — without the full
      // demand-driven-feature reviewer lifecycle. Bounded by a tight predicate so
      // customer feature work keeps every gate; a real objective conflict/malformed
      // reconciliation is NEVER waved through.
      const hasDesignSpec = await (args.dependencies?.resolveHasDesignSpec ?? defaultResolveHasDesignSpec)({
        itemId: lockedItem.itemId,
      });
      const recognizeMergeThroughGates =
        mergedThroughGates && isDirectMergePlatformWork(lockedItem) && hasDesignSpec;
      // A merge through branch protection is authoritative delivery evidence and
      // supersedes a missing/hand-built manifest (BI-B04A0203).
      const delivery = mergedThroughGates ? "pass" : deliveryState(completion);
      // Recognized platform work: the merge is the acceptance too — but only when
      // reconciliation is not in a real conflict/malformed state (those still block).
      const acceptancePass =
        reconciliation.state === "pass" ||
        (recognizeMergeThroughGates && reconciliation.state !== "conflict" && reconciliation.state !== "malformed");
      const inheritedScope = await loadInheritedInitiativeScope(
        tx as unknown as InheritanceDb,
        { childItemId: lockedItem.itemId, childRowId: lockedItem.id },
      );
      const boundWorkShape = await readBoundWorkShapeRef(tx as unknown as BoundWorkShapeDb, lockedItem.itemId);
      const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
        item: {
          ...lockedItem,
          activeBuildKind: lockedItem.activeBuild?.kind ?? null,
          workShape: boundWorkShape,
          deliverySensitivity: deriveDeliverableSensitivity({ text: `${lockedItem.title ?? ""}\n${lockedItem.body ?? ""}`, workType: lockedItem.workType }),
        },
        activities: activities as InitiativeReadinessActivity[],
        inheritedScope,
        target: "completion",
        transitionObject: { kind: "backlog-item", id: lockedItem.id, expectedVersion: args.expectedStatus, targetState: "done" },
        authorization: "pass",
        capsuleIdentity: "pass",
        recognizeMergeThroughGates,
        completion: {
          deliveryEvidence: delivery,
          acceptanceEvidence: acceptancePass ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveReconciliation: acceptancePass ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
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
