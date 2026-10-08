// The ONE evaluation of a backlog item's completion decision (BI-094B41AC).
//
// Extracted from backlog-terminal-transition.ts. Two callers ask the same
// question — "would this item be allowed to close?" — and used to answer it two
// ways: completeBacklogItemTransition consulted the merge-through-gates signal
// (BI-B04A0203), deployment closure and the shape-proportional acceptance lanes,
// while the read projection get_backlog_item returns (and the acceptance sweep
// reads) passed none of those facts and so reported every merged direct-merge
// item as input-required. Both now call evaluateBacklogItemCompletion; the read
// path differs only in that it never mutates and supplies no completion
// manifest (a read has none — the caller of the transition brings one).

import { prisma } from "@dpf/db";

import {
  resolveCompletionEvidence,
  type CompletionEvidenceRuntimeDb,
  type ResolveCompletionEvidenceResult,
} from "@/lib/backlog/completion-evidence-runtime";

import { type BoundWorkShapeDb, readBoundEditPaths, readBoundWorkShapeRef } from "./bound-work-shape";
import { assessDeliverySensitivity } from "./delivery-sensitivity";
import {
  projectDeploymentClosure,
  resolveBacklogDeploymentClosure,
  type DeploymentClosureProof,
  type DeploymentClosureResult,
} from "./deployment-closure";
import { projectBacklogItemReadiness, readinessShapeFromWorkShape, type InitiativeReadinessActivity } from "./entry-adapter";
import {
  defaultResolveMergeDelivery,
  mergeSignalRoots,
  mergeSignalUnavailableReason,
  type MergeDeliverySignal,
  type ResolveMergeDelivery,
} from "./merge-delivery-signal";
import {
  reconcileInitiativeObjectives,
  type ObjectiveReconciliationActivity,
  type ObjectiveReconciliationResult,
} from "./objective-reconciliation";
import { type InheritanceDb, loadInheritedInitiativeScope } from "./parent-scope-inheritance";
import type { InitiativeReadinessDecision, InitiativeTransitionObject } from "./types";

/** The shape an operational close is gated as (BI-B22E50BC). */
const OPERATIONAL_CLOSE_WORK_SHAPE = "delivery-small@1.0.0";

export type BacklogCompletionItem = {
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

/** The item columns the evaluation reads; both callers select exactly these. */
export const BACKLOG_COMPLETION_ITEM_SELECT = {
  id: true, itemId: true, status: true, workType: true, type: true, source: true, title: true, body: true,
  scopeKind: true, archetypeCategories: true, archetypeIds: true, organizationId: true,
  epicId: true, claimedAt: true, createdAt: true, digitalProductId: true,
  activeBuild: { select: { kind: true, verificationOut: true, uxVerificationStatus: true } },
  productObjectiveWork: { select: { id: true }, take: 1 },
} as const;

/** The activity kinds the completion evaluation reads. */
export const BACKLOG_COMPLETION_ACTIVITY_KINDS = [
  "initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage",
  "initiative_objective_mapping", "evidence", "break_fix_declared",
] as const;

type BacklogCompletionActivity = ObjectiveReconciliationActivity & {
  gateKey: string | null;
  backlogItemId: string;
};

export type BacklogCompletionDb = {
  backlogItemActivity: { findMany(args: unknown): Promise<BacklogCompletionActivity[]> };
};

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

export type BacklogCompletionDependencies = {
  resolveCompletionEvidence?: typeof resolveCompletionEvidence;
  reconcileObjectives?: typeof reconcileInitiativeObjectives;
  projectReadiness?: typeof projectBacklogItemReadiness;
  resolveMergeDelivery?: ResolveMergeDelivery;
  resolveHasDesignSpec?: ResolveHasDesignSpec;
  resolveDeploymentClosure?: (args: { itemId: string; workType: string | null; roots: string[] }) => Promise<DeploymentClosureResult>;
};

export type BacklogCompletionEvaluation = {
  governed: boolean;
  decision: InitiativeReadinessDecision;
  reconciliation: ObjectiveReconciliationResult;
  delivery: "pass" | "fail" | "missing";
  mergedThroughGates: MergeDeliverySignal;
  deployment: DeploymentClosureProof | null;
  acceptanceState: string;
  hasDesignSpec: boolean;
  deliveryEvidenceRefs: string[];
};

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
 * BI-9D327C32. A `verified` ux or migration disposition is a PROMISE of an
 * evidence row: `validateApplicability` adds that dimension to the required set,
 * and citing no `ux_verified` / `migration_pass` activity fails the manifest.
 *
 * That failure used to disappear. A merge through branch protection passes the
 * DELIVERY dimension on its own (BI-B04A0203), so `deliveryReasons` was dropped,
 * and `smallShapeAcceptance` — which needs `verdict.allowed` — silently went
 * false. What the author saw was ACCEPTANCE_EVIDENCE_REQUIRED and "a medium item
 * owes an independent acceptance receipt… a coworker qualifies", alongside
 * `reviewerRoutes: []`: told to dispatch a reviewer for a defect only they could
 * fix, and given no route to dispatch one. Measured on BI-1F69D3F8, two refusals,
 * and cleared by adding one `ux_verified` row with nothing else changed.
 *
 * The merge may excuse the delivery dimension. It must never silence a manifest
 * the author can correct, so the manifest's own blockers are carried onto the
 * requirement the author is actually being asked about.
 */
function unreadManifestReasons(result: ResolveCompletionEvidenceResult): string[] {
  if (result.kind !== "evaluated" || result.verdict.allowed) return [];
  return [
    "The completion manifest did not pass, so acceptance could not read its evidence. This is the author's to correct, not a reviewer's:",
    ...deliveryReasons(result),
  ];
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
 * Evaluate the completion decision for `item`. Reads only. `db` is the
 * transition's locked transaction client, or the plain client for a read.
 */
export async function evaluateBacklogItemCompletion(args: {
  db: BacklogCompletionDb;
  item: BacklogCompletionItem;
  /** The caller's completion manifest. A read passes `undefined`: it has none. */
  rawManifest: unknown;
  transitionObject: InitiativeTransitionObject;
  evaluatedAt: string;
  dependencies?: BacklogCompletionDependencies;
}): Promise<BacklogCompletionEvaluation> {
  const { db, item, evaluatedAt } = args;
  const deps = args.dependencies ?? {};
  const activities = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: { in: [...BACKLOG_COMPLETION_ACTIVITY_KINDS] } },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 500,
    select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
  });
  const completion = await (deps.resolveCompletionEvidence ?? resolveCompletionEvidence)(
    db as unknown as CompletionEvidenceRuntimeDb,
    { itemId: item.itemId, rawManifest: args.rawManifest, now: new Date(evaluatedAt) },
  );
  // BI-2515F779: a decomposed child with no baseline of its own reconciles
  // its mapping against the baseline it inherits from its mapping parent —
  // the same scope the projection, the router, the admission and the writer
  // already read. Own rows always win.
  const inheritedScope = await loadInheritedInitiativeScope(
    db as unknown as InheritanceDb,
    { childItemId: item.itemId, childRowId: item.id },
  );
  const ownBaselineRows = activities.some((activity) => activity.kind === "initiative_scope_baseline");
  const inheritedBaselineRows = !ownBaselineRows && inheritedScope
    ? inheritedScope.activities
      .filter((activity) => activity.kind === "initiative_scope_baseline")
      .map((activity) => ({ id: activity.id, backlogItemId: item.id, kind: activity.kind, gateKey: activity.gateKey, recordedAt: activity.recordedAt, payload: activity.payload }))
    : [];
  const reconciliation = (deps.reconcileObjectives ?? reconcileInitiativeObjectives)({
    itemId: item.itemId,
    itemRowId: item.id,
    activities: [...activities, ...inheritedBaselineRows],
    ...(inheritedBaselineRows.length > 0 && inheritedScope
      ? { baselineSubjectIds: [item.itemId, inheritedScope.parentItemId] }
      : {}),
  });
  const acceptanceState = reconciliation.state;
  const directMerge = isDirectMergePlatformWork(item);
  const deploymentResult = directMerge
    ? await (deps.resolveDeploymentClosure ?? resolveBacklogDeploymentClosure)({
      itemId: item.itemId, workType: item.workType, roots: mergeSignalRoots(),
    }) : null;
  const deployment = deploymentResult?.kind === "deployed"
    && reconciliation.state !== "conflict" && reconciliation.state !== "malformed"
    ? deploymentResult : null;
  const mergedThroughGates = await (deps.resolveMergeDelivery ?? defaultResolveMergeDelivery)({
    itemRowId: item.id,
    itemId: item.itemId,
    workType: item.workType,
  });
  const hasDesignSpec = await (deps.resolveHasDesignSpec ?? defaultResolveHasDesignSpec)({ itemId: item.itemId });
  // EP-4614F35E (kernel DI-54AECB341524): recognize a merge through the code
  // gates (CI + merge queue + PR review) as completing DIRECT-MERGE PLATFORM
  // work — the governance appropriate to maintainer changes — without the full
  // demand-driven-feature reviewer lifecycle. Bounded by a tight predicate so
  // customer feature work keeps every gate; a real objective conflict/malformed
  // reconciliation is NEVER waved through.
  //
  // BI-82DCD601, kernel DI-273E6E15C8EB: `hasDesignSpec` is NOT a term of either
  // predicate below. A bug fix has no design spec — that is what makes it a bug
  // fix — so ANDing it in closed this clause against exactly the work it was
  // written for. It is retained as a REPORTED fact in the facts digest.
  const recognizeMergeThroughGates = (mergedThroughGates === "merged" || deployment !== null) && directMerge;
  // BI-043946C5: the item clears every OTHER term of the direct-merge predicate,
  // so the merge signal is the only thing standing between it and recognition —
  // and the signal could not run. The operator is told "this runtime cannot
  // tell", not "this did not merge", on the requirements the signal would have
  // satisfied.
  const mergeSignalBlindSpot = !deployment && mergedThroughGates === "signal-unavailable" && directMerge;
  const mergeSignalReasons = mergeSignalBlindSpot ? [mergeSignalUnavailableReason(mergeSignalRoots())] : [];
  // A merge through branch protection is authoritative delivery evidence and
  // supersedes a missing/hand-built manifest (BI-B04A0203).
  const delivery = mergedThroughGates === "merged" || deployment ? "pass" as const : deliveryState(completion);
  const directDocumentationAcceptance = completion.kind === "evaluated"
    && completion.verdict.allowed
    && completion.verdict.normalizedManifest?.workClass === "documentation"
    && (completion.verdict.acceptanceEvidenceRefs?.length ?? 0) > 0;
  const boundWorkShape = await readBoundWorkShapeRef(db as unknown as BoundWorkShapeDb, item.itemId);
  // BI-B22E50BC: an operational close (a chore, tool or skill done with no code:
  // a dismissed alert, a config change, a runbook run) never claims a workroom,
  // so it has no bound shape and fell onto the v2 fix table, which owes a spec
  // baseline and reconciliation it cannot produce without making artifacts
  // just to pass the gate. The only exit was retiring work that was done. A
  // well-formed operational manifest, on a work type the evidence policy lets
  // close as operational, is gated as the small shape it is: its manual check
  // is the delivery and the acceptance. A bound shape always wins, and an item
  // a Build Studio build governs is code delivery, never an operational close.
  const operationalClose = boundWorkShape == null
    && item.activeBuild == null
    && completion.kind === "evaluated"
    && completion.verdict.normalizedManifest?.workClass === "operational"
    && !completion.verdict.blockers.some((entry) => entry.code === "incompatible-work-class");
  const gatedWorkShape = boundWorkShape ?? (operationalClose ? OPERATIONAL_CLOSE_WORK_SHAPE : null);
  // BI-05F8860A / readiness.v3 shape-requirements: a small or break-fix item
  // is accepted by the runtime check on the live install or the
  // failing-to-passing test, recorded as manual/ux evidence — "no spec, no
  // plan, no reconciliation receipt".
  const boundShape = readinessShapeFromWorkShape(gatedWorkShape);
  const smallShapeAcceptance = (boundShape === "small" || boundShape === "break-fix")
    && completion.kind === "evaluated"
    && completion.verdict.allowed
    && (completion.verdict.acceptanceEvidenceRefs?.length ?? 0) > 0;
  // Recognized platform work: the merge is the acceptance too — but only when
  // reconciliation is not in a real conflict/malformed state (those still block).
  const mergeAccepts = !deployment && recognizeMergeThroughGates
    && reconciliation.state !== "conflict" && reconciliation.state !== "malformed";
  const acceptancePass = reconciliation.state === "pass" || directDocumentationAcceptance || smallShapeAcceptance || mergeAccepts;
  const objectiveReconciliationPass = reconciliation.state === "pass" || smallShapeAcceptance || mergeAccepts;
  const deliveryEvidenceRefs = completion.kind === "evaluated"
    ? completion.verdict.normalizedManifest?.evidenceActivityIds ?? []
    : [];
  const projected = (deps.projectReadiness ?? projectBacklogItemReadiness)({
    item: {
      ...item,
      activeBuildKind: item.activeBuild?.kind ?? null,
      workShape: gatedWorkShape,
      // BI-243BC956: completion re-reads the room's declared edit scope.
      deliverySensitivity: assessDeliverySensitivity({
        ...item,
        declaredPaths: await readBoundEditPaths(db as unknown as BoundWorkShapeDb, item.itemId).catch(() => []),
      }),
    },
    activities: activities as InitiativeReadinessActivity[],
    inheritedScope,
    target: "completion",
    transitionObject: args.transitionObject,
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
        DELIVERY_EVIDENCE_REQUIRED: deliveryEvidenceRefs,
        ACCEPTANCE_EVIDENCE_REQUIRED: (directDocumentationAcceptance || smallShapeAcceptance) && completion.kind === "evaluated"
          ? completion.verdict.acceptanceEvidenceRefs ?? []
          : reconciliation.evidenceRefs,
        OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
      },
      requirementReasons: {
        DELIVERY_EVIDENCE_REQUIRED: mergedThroughGates === "merged"
          ? unreadManifestReasons(completion)
          : [...mergeSignalReasons, ...deliveryReasons(completion)],
        ACCEPTANCE_EVIDENCE_REQUIRED: [...mergeSignalReasons, ...unreadManifestReasons(completion)],
        OBJECTIVE_RECONCILIATION_REQUIRED: mergeSignalReasons,
      },
    },
    evaluatedAt,
  });
  return {
    governed: projected.governed,
    decision: deployment ? projectDeploymentClosure(projected.decision, deployment) : projected.decision,
    reconciliation,
    delivery,
    mergedThroughGates,
    deployment,
    acceptanceState,
    hasDesignSpec,
    deliveryEvidenceRefs,
  };
}

/** The statuses whose read projection carries the completion gate's own evaluation. */
const GATE_EVALUATED_READ_STATUSES = new Set(["awaiting-acceptance"]);

export type BacklogCompletionReadDb = BacklogCompletionDb & {
  backlogItem: { findUnique(args: unknown): Promise<BacklogCompletionItem | null> };
};

/**
 * The read projection's completion decision (get_backlog_item, the acceptance
 * sweep): the gate's own evaluation, with no manifest and no mutation.
 *
 * Bounded: only an item awaiting acceptance pays for it — the merge signal may
 * run git against a source checkout — and `null` means "not evaluated here",
 * on which the caller keeps its existing projection. Any failure is `null`
 * too, never a fabricated verdict; an unavailable merge signal is NOT a
 * failure — it evaluates, and the decision says the signal was unavailable,
 * exactly as the transition would.
 */
export async function readBacklogItemCompletion(args: {
  itemRowId: string;
  status: string;
  evaluatedAt: string;
  db?: BacklogCompletionReadDb;
  dependencies?: BacklogCompletionDependencies;
}): Promise<BacklogCompletionEvaluation | null> {
  if (!GATE_EVALUATED_READ_STATUSES.has(args.status)) return null;
  const db = args.db ?? (prisma as unknown as BacklogCompletionReadDb);
  try {
    const item = await db.backlogItem.findUnique({ where: { id: args.itemRowId }, select: BACKLOG_COMPLETION_ITEM_SELECT });
    if (!item || !GATE_EVALUATED_READ_STATUSES.has(item.status)) return null;
    return await evaluateBacklogItemCompletion({
      db,
      item,
      rawManifest: undefined,
      transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read-projection", targetState: "completion" },
      evaluatedAt: args.evaluatedAt,
      ...(args.dependencies ? { dependencies: args.dependencies } : {}),
    });
  } catch {
    return null;
  }
}
