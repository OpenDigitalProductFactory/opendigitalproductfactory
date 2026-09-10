import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  resolveCompletionEvidence,
  type CompletionEvidenceRuntimeDb,
  type ResolveCompletionEvidenceResult,
} from "@/lib/backlog/completion-evidence-runtime";
import { canonicalJson } from "@/lib/shared/canonical-json";
import { isReachableFromTrunk, trunkHasMergedPullRequest, trunkRefExists } from "@/lib/work-capsules/git-scanner";

import { projectBacklogItemReadiness, readinessShapeFromWorkShape, type InitiativeReadinessActivity } from "./entry-adapter";
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
 *
 * BI-043946C5: this used to answer `boolean`, and every infrastructure failure —
 * no candidate root is a git repository, the trunk ref does not resolve, the head
 * was never fetched locally — collapsed into `false`, which the caller could not
 * tell apart from a genuine "this never merged". Measured on a live install: the
 * probe's first root `/host-dpf` is the INSTALLED runtime directory, not a source
 * checkout, so `trunkRefExists` was false for every root and the signal was
 * unconditionally and silently false. Two capabilities were dead as a result —
 * merge-as-delivery-evidence (BI-B04A0203) and direct-merge recognition
 * (EP-4614F35E) — with nothing anywhere saying so.
 *
 * So the signal is now three-valued. `not-merged` is a MEASUREMENT: some root
 * answered and said no. `signal-unavailable` means nothing could answer, and the
 * caller must say that out loud rather than report it as a negative.
 */
export type MergeDeliverySignal = "merged" | "not-merged" | "signal-unavailable";

export type ResolveMergeDelivery = (args: { itemRowId: string; itemId: string }) => Promise<MergeDeliverySignal>;

/**
 * Candidate source roots the merge signal probes, in order. Reachability stays
 * LOCAL and procedural — no GitHub API, no LLM
 * (platform-function-never-depends-on-a-client). The first root whose trunk ref
 * resolves wins.
 *
 * `/host-dpf` is listed because a source install mounts its checkout there. A
 * CONSUMER install legitimately has no checkout at all — there, `/host-dpf` is the
 * runtime directory and no root resolves, which is precisely the case that must
 * report `signal-unavailable` instead of a silent `false` (BI-043946C5). An
 * operator who wants the signal on such a host points `DPF_HOST_SOURCE_ROOT` at a
 * real checkout.
 */
export function mergeSignalRoots(): string[] {
  const roots = [process.env.DPF_REPO_ROOT, process.env.DPF_HOST_SOURCE_ROOT, "/host-dpf", process.cwd()];
  return [...new Set(roots.filter((r): r is string => Boolean(r)))];
}

/**
 * The operator-facing sentence for an unavailable merge signal. It names the
 * measurement (nothing could answer), never a verdict, and the one lever that
 * changes it. Surfaced through `requirementReasons`, which `requirementNextAction`
 * puts at the FRONT of the next action.
 */
export function mergeSignalUnavailableReason(roots: readonly string[]): string {
  const probed = roots.length > 0 ? roots.join(", ") : "no candidate roots";
  return "The merge-through-gates signal could not run on this runtime, so whether this work "
    + `landed on the trunk is UNKNOWN here, not answered "no" (probed: ${probed}). `
    + "Point DPF_HOST_SOURCE_ROOT at a source checkout to enable it.";
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
/**
 * The git half of the merge signal, with no database and no ambient
 * configuration: given the branch identities to look for and the roots to look
 * in, decide whether the work landed.
 *
 * Split out so it can be driven against REAL repositories in a test
 * (BI-043946C5). The defect this function now encodes lived precisely in the
 * boundary between this module and git, and every existing test stubbed the
 * whole resolver, so the suite stayed green while the shipped code could not
 * answer at all on a live install.
 */
export async function resolveMergeSignalFromRefs(input: {
  heads: readonly string[];
  pullRequests: readonly number[];
  roots: readonly string[];
}): Promise<MergeDeliverySignal> {
  const { heads, pullRequests, roots } = input;
  // Nothing to look up: no room recorded a head and no PR is linked. That is a
  // real measurement about THIS item — there is no branch identity to find on
  // the trunk — not a broken probe, so it stays a negative.
  if (heads.length === 0 && pullRequests.length === 0) return "not-merged";
  for (const root of roots) {
    if (!(await trunkRefExists(root))) continue;
    // A root answered. Distinguish "git said no" from "git could not say":
    // isReachableFromTrunk / trunkHasMergedPullRequest already return null for
    // the indeterminate case (sha never fetched, bad ref, git missing), and
    // flattening those to false is the same silent-negative bug one level down.
    let sawDefiniteNegative = false;
    for (const sha of heads) {
      const reachable = await isReachableFromTrunk(root, sha);
      if (reachable === true) return "merged";
      if (reachable === false) sawDefiniteNegative = true;
    }
    for (const prNumber of new Set(pullRequests)) {
      const merged = await trunkHasMergedPullRequest(root, prNumber);
      if (merged === true) return "merged";
      if (merged === false) sawDefiniteNegative = true;
    }
    return sawDefiniteNegative ? "not-merged" : "signal-unavailable";
  }
  // No candidate root is a readable repository.
  return "signal-unavailable";
}

async function defaultResolveMergeDelivery(
  { itemRowId, itemId }: { itemRowId: string; itemId: string },
): Promise<MergeDeliverySignal> {
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
    return await resolveMergeSignalFromRefs({ heads, pullRequests, roots: mergeSignalRoots() });
  } catch {
    return "signal-unavailable";
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
          "initiative_objective_mapping", "evidence", "break_fix_declared",
        ] } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 500,
        select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
      });
      const completion = await (args.dependencies?.resolveCompletionEvidence ?? resolveCompletionEvidence)(
        tx as unknown as CompletionEvidenceRuntimeDb,
        { itemId: lockedItem.itemId, rawManifest: args.completionEvidence, now: new Date(evaluatedAt) },
      );
      // BI-2515F779: a decomposed child with no baseline of its own reconciles
      // its mapping against the baseline it inherits from its mapping parent —
      // the same scope the projection, the router, the admission and the writer
      // already read. Own rows always win.
      const inheritedScope = await loadInheritedInitiativeScope(
        tx as unknown as InheritanceDb,
        { childItemId: lockedItem.itemId, childRowId: lockedItem.id },
      );
      const lockedRowId = lockedItem.id;
      const ownBaselineRows = activities.some((activity) => activity.kind === "initiative_scope_baseline");
      const inheritedBaselineRows = !ownBaselineRows && inheritedScope
        ? inheritedScope.activities
          .filter((activity) => activity.kind === "initiative_scope_baseline")
          .map((activity) => ({ id: activity.id, backlogItemId: lockedRowId, kind: activity.kind, gateKey: activity.gateKey, recordedAt: activity.recordedAt, payload: activity.payload }))
        : [];
      const reconciliation = (args.dependencies?.reconcileObjectives ?? reconcileInitiativeObjectives)({
        itemId: lockedItem.itemId,
        itemRowId: lockedItem.id,
        activities: [...activities, ...inheritedBaselineRows],
        ...(inheritedBaselineRows.length > 0 && inheritedScope
          ? { baselineSubjectIds: [lockedItem.itemId, inheritedScope.parentItemId] }
          : {}),
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
      // BI-82DCD601, kernel DI-273E6E15C8EB. `hasDesignSpec` used to be ANDed in
      // here, which closed this clause against exactly the work it was written
      // for: a bug fix has no design spec — that is what makes it a bug fix — so
      // the rule that spares direct-merge platform work the feature reviewer
      // lifecycle only fired for work that had already completed that lifecycle.
      //
      // Measured 2026-09-09: 150 items held recorded execution evidence with no
      // gate receipt, median age 12.4 days against a p90 receipt latency of 10.9
      // days. The largest cohort was 23 merged bug fixes being asked at
      // COMPLETION for research comparing industry implementations and a phased
      // plan — design-time gates evaluated after the code shipped, which cannot
      // change what shipped and can only strand the record.
      //
      // The kernel scored dropping it at 9.27 against 4.99 for demanding the
      // retrofit, high confidence and autonomy-eligible; "Do the work; don't task
      // the operator with what an agent can do" penalises the retrofit directly.
      //
      // What still holds the line, deliberately: `isDirectMergePlatformWork`
      // keeps customer feature work on every gate, and a conflict/malformed
      // reconciliation is still NEVER waved through (see acceptancePass below).
      // `hasDesignSpec` is retained as a REPORTED fact rather than a gate, so a
      // reader can still tell which merges carried a spec.
      const recognizeMergeThroughGates =
        mergedThroughGates === "merged" && isDirectMergePlatformWork(lockedItem);
      // BI-043946C5: the item clears every OTHER term of the direct-merge predicate,
      // so the merge signal is the only thing standing between it and recognition —
      // and the signal could not run. That is the difference between "this did not
      // merge" and "this runtime cannot tell", and the operator has to be told which
      // one they are looking at, on the requirements the signal would have satisfied.
      //
      // `hasDesignSpec` is dropped from BOTH predicates, not just the first
      // (BI-82DCD601, DI-273E6E15C8EB). Keeping it here while dropping it above
      // would leave a spec-less item that merged through the gates recognised,
      // but a spec-less item whose SIGNAL failed with neither recognition nor
      // the explanation of why — the worst of both, and the operator would be
      // told nothing at all.
      const mergeSignalBlindSpot =
        mergedThroughGates === "signal-unavailable" && isDirectMergePlatformWork(lockedItem);
      const mergeSignalReasons = mergeSignalBlindSpot
        ? [mergeSignalUnavailableReason(mergeSignalRoots())]
        : [];
      // A merge through branch protection is authoritative delivery evidence and
      // supersedes a missing/hand-built manifest (BI-B04A0203).
      const delivery = mergedThroughGates === "merged" ? "pass" : deliveryState(completion);
      const directDocumentationAcceptance = completion.kind === "evaluated"
        && completion.verdict.allowed
        && completion.verdict.normalizedManifest?.workClass === "documentation"
        && (completion.verdict.acceptanceEvidenceRefs?.length ?? 0) > 0;
      const boundWorkShape = await readBoundWorkShapeRef(tx as unknown as BoundWorkShapeDb, lockedItem.itemId);
      // BI-05F8860A / readiness.v3 shape-requirements: a small or break-fix item
      // is accepted by the runtime check on the live install or the
      // failing-to-passing test, recorded as manual/ux evidence — "no spec, no
      // plan, no reconciliation receipt". The projector already assigns that
      // lane to the delivery-coordinator; this is the transition-side half of
      // the same contract, so cited acceptance evidence is honoured instead of
      // falling through to an objective-mapping route the shape never grants.
      const boundShape = readinessShapeFromWorkShape(boundWorkShape);
      const smallShapeAcceptance = (boundShape === "small" || boundShape === "break-fix")
        && completion.kind === "evaluated"
        && completion.verdict.allowed
        && (completion.verdict.acceptanceEvidenceRefs?.length ?? 0) > 0;
      // Recognized platform work: the merge is the acceptance too — but only when
      // reconciliation is not in a real conflict/malformed state (those still block).
      const acceptancePass =
        reconciliation.state === "pass" ||
        directDocumentationAcceptance ||
        smallShapeAcceptance ||
        (recognizeMergeThroughGates && reconciliation.state !== "conflict" && reconciliation.state !== "malformed");
      const objectiveReconciliationPass = reconciliation.state === "pass"
        || smallShapeAcceptance
        || (recognizeMergeThroughGates && reconciliation.state !== "conflict" && reconciliation.state !== "malformed");
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
          objectiveReconciliation: objectiveReconciliationPass ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveBaselineConflict: reconciliation.state === "conflict",
          projectionError: reconciliation.state === "malformed",
          evidenceRefs: {
            DELIVERY_EVIDENCE_REQUIRED: completion.kind === "evaluated"
              ? completion.verdict.normalizedManifest?.evidenceActivityIds ?? []
              : [],
            ACCEPTANCE_EVIDENCE_REQUIRED: (directDocumentationAcceptance || smallShapeAcceptance) && completion.kind === "evaluated"
              ? completion.verdict.acceptanceEvidenceRefs ?? []
              : reconciliation.evidenceRefs,
            OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
          },
          requirementReasons: {
            DELIVERY_EVIDENCE_REQUIRED: mergedThroughGates === "merged"
              ? []
              : [...mergeSignalReasons, ...deliveryReasons(completion)],
            ACCEPTANCE_EVIDENCE_REQUIRED: mergeSignalReasons,
            OBJECTIVE_RECONCILIATION_REQUIRED: mergeSignalReasons,
          },
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
          // No longer a gate (DI-273E6E15C8EB) but still worth recording: a
          // reader reconciling a receipt can tell whether this merge carried a
          // design spec or was recognised on the merge alone.
          hasDesignSpec,
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
