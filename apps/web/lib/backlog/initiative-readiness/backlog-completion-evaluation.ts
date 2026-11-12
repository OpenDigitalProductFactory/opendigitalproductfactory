// The ONE evaluation of a backlog item's completion decision (BI-094B41AC).
//
// Extracted from backlog-terminal-transition.ts. Two callers ask the same
// question — "would this item be allowed to close?" — and used to answer it two
// ways: completeBacklogItemTransition consulted the merge-through-gates signal
// (BI-B04A0203), deployment closure and the shape-proportional acceptance lanes,
// while the read projection get_backlog_item returns (and the acceptance sweep
// reads) passed none of those facts and so reported every merged direct-merge
// item as input-required. Both now call evaluateBacklogItemCompletion; the read
// path never mutates. For the retained-body acceptance lane it can recover
// authorized inputs from the latest bound attempt, then evaluate them afresh.

import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { sameBodyCriteriaVersion } from "./body-baseline-version";
import { completionInputBinding, readCompletionInput, retainCompletionInput, type CompletionInputContext } from "./completion-input-context";

import type { CurrentEvidenceFailure } from "@/lib/backlog/completion-evidence-policy";
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
import { resolveAggregateCompletion, type AggregateCompletionDb } from "./aggregate-completion";
import type { CurrentDesignEvidence } from "./judged-design-artifact";
import type { prepareCurrentDesignObservation } from "./canonical-artifact-discovery";

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
  /** Carries the reserved `contractual` tag (BI-B1B44777, DI-1263D968DC26). */
  lifecycleTags?: string[] | null;
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
  scopeKind: true, archetypeCategories: true, archetypeIds: true, lifecycleTags: true, organizationId: true,
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
  prepareCurrentDesign?: typeof prepareCurrentDesignObservation;
  resolveCompletionEvidence?: typeof resolveCompletionEvidence;
  reconcileObjectives?: typeof reconcileInitiativeObjectives;
  projectReadiness?: typeof projectBacklogItemReadiness;
  resolveMergeDelivery?: ResolveMergeDelivery;
  resolveHasDesignSpec?: ResolveHasDesignSpec;
  resolveDeploymentClosure?: (args: { itemId: string; workType: string | null; roots: string[] }) => Promise<DeploymentClosureResult>;
};

export type BacklogCompletionEvaluation = {
  /** Server-only submitted inputs; persisted by the authorized terminal writer. */
  completionInputContext?: CompletionInputContext | null;
  governed: boolean;
  decision: InitiativeReadinessDecision;
  independentAcceptanceDecision: InitiativeReadinessDecision;
  reconciliation: ObjectiveReconciliationResult;
  delivery: "pass" | "fail" | "missing";
  mergedThroughGates: MergeDeliverySignal;
  deployment: DeploymentClosureProof | null;
  acceptanceState: string;
  hasDesignSpec: boolean;
  deliveryEvidenceRefs: string[];
  /**
   * BI-C899BB40: this closure is BI-B1B44777's delivery-closes default (a
   * non-contractual merge or deployment, nothing failed). Reported, not a gate.
   */
  closureFollowsDelivery: boolean;
  /**
   * BI-C899BB40: a customer reported this non-contractual work, so its
   * submitter is asked once. A contractual item keeps its acceptance lane.
   */
  customerReported: boolean;
};

/**
 * BI-4A222439. The failures that are still the newest word in their dimension,
 * read from the same completion-evidence verdict a person's close is held to.
 *
 * The acceptance sweep closed BI-1B5BE5F4 on 2026-10-13 while its newest ux
 * evidence was a ux_fail from the installed portal: the merge through the gates
 * passed delivery (BI-B04A0203) and, for direct-merge platform work, acceptance
 * too, and neither consulted the item's evidence. A merge is evidence that the
 * change landed, not that it works; a current failure outranks it on every path,
 * with or without a manifest, and under deployment closure too.
 */
function currentFailuresOf(result: ResolveCompletionEvidenceResult): CurrentEvidenceFailure[] {
  return result.kind === "evaluated" ? result.verdict.currentFailures ?? [] : [];
}

const ACCEPTANCE_FAILURE_DIMENSIONS: ReadonlySet<string> = new Set(["ux", "manual"]);

function currentFailureReasons(failures: readonly CurrentEvidenceFailure[]): string[] {
  return failures.map((failure) =>
    `The newest ${failure.dimension} evidence on this item is a failure (${failure.evidenceKind} ${failure.evidenceActivityId}). `
    + `Fix it and record a passing ${failure.dimension} result that supersedes it before closing; a merge does not.`);
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
 * Origin markers that mean a customer, not the platform, reported the work
 * (BI-C899BB40). Each is written by an existing intake path:
 * ecosystem/inbound-issue-triage.ts (upstream issue, peer demand),
 * federation/demand-exchange.ts (adopted federated demand) and
 * federation/founder-portfolio.ts (a founder demand cluster).
 */
const CUSTOMER_ORIGIN_MARKERS = [
  "[origin:ecosystem-upstream-issue:",
  "[origin:ecosystem-peer-demand:",
  "[origin:federatedDemand:",
  "[origin:founderDemandCluster:",
] as const;

/**
 * Whether a customer reported this item, read from provenance that already
 * exists; there is no persisted flag. A customer-reported item still closes on
 * delivery; its submitter is then asked one question (acceptance sweep §9).
 *
 * `upstreamIssueNumber` is deliberately not a signal: the issue bridge sets it
 * when THIS install files its own item upstream, and already comments on that
 * issue when the item closes.
 */
export function isCustomerReported(item: {
  itemId: string;
  body?: string | null;
  lifecycleTags?: readonly string[] | null;
}): boolean {
  if (item.lifecycleTags?.includes("ecosystem-inbound")) return true;
  // A product quality report (actions/quality.ts): the BI-PIR- id and its source line.
  if (item.itemId.startsWith("BI-PIR-")) return true;
  const body = item.body ?? "";
  if (/^Source report: \S+/m.test(body)) return true;
  return CUSTOMER_ORIGIN_MARKERS.some((marker) => body.includes(marker));
}

/**
 * The reserved lifecycle tag that marks an item contractual (BI-B1B44777,
 * kernel decision DI-1263D968DC26). It reuses BacklogItem.lifecycleTags, which
 * create_backlog_item and update_backlog_item already set and query_backlog
 * already filters, so marking an item needs no new field.
 */
export const CONTRACTUAL_LIFECYCLE_TAG = "contractual";

/** Whether the item carries a contractual acceptance commitment. */
export function isContractualItem(item: { lifecycleTags?: readonly string[] | null }): boolean {
  return (item.lifecycleTags ?? []).some((tag) => tag.trim().toLowerCase() === CONTRACTUAL_LIFECYCLE_TAG);
}

/**
 * Outcomes define done (BI-B1B44777, founder direction 2026-10-27): a merge
 * through CI and the merge queue closes an item by default. It satisfies
 * acceptance and objective reconciliation, and no design-time gate is owed
 * once the change has landed. If something is still wrong, whoever uses the
 * change reports it and a new item is opened.
 *
 * Only a contractual item keeps the separate acceptance step. This replaces
 * the scope and link terms of the direct-merge-platform predicate
 * (EP-4614F35E) for completion; `isDirectMergePlatformWork` still bounds the
 * retained runtime obligations of items that are already done.
 */
export function deliveryClosesItem(item: { lifecycleTags?: readonly string[] | null }): boolean {
  return !isContractualItem(item);
}

/**
 * Evaluate the completion decision for `item`. Reads only. `db` is the
 * transition's locked transaction client, or the plain client for a read.
 */
export async function evaluateBacklogItemCompletion(args: {
  currentDesign?: CurrentDesignEvidence;
  db: BacklogCompletionDb;
  item: BacklogCompletionItem;
  /** Explicit caller input; reads may resolve the latest bound input when absent. */
  rawManifest: unknown;
  /** Only read projections may reuse recorded inputs; a new submission stands alone. */
  reuseRecordedInput?: boolean;
  transitionObject: InitiativeTransitionObject;
  evaluatedAt: string;
  dependencies?: BacklogCompletionDependencies;
}): Promise<BacklogCompletionEvaluation> {
  const { db, item, evaluatedAt } = args;
  const deps = args.dependencies ?? {};
  const boundWorkShape = await readBoundWorkShapeRef(db as unknown as BoundWorkShapeDb, item.itemId);
  const aggregate = readinessShapeFromWorkShape(boundWorkShape) === "xlarge";
  const activities = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: { in: [...BACKLOG_COMPLETION_ACTIVITY_KINDS] } },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 500,
    select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
  });
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
  let reconciliation = (deps.reconcileObjectives ?? reconcileInitiativeObjectives)({
    itemId: item.itemId,
    itemRowId: item.id,
    activities: [...activities, ...inheritedBaselineRows],
    ...(inheritedBaselineRows.length > 0 && inheritedScope
      ? { baselineSubjectIds: [item.itemId, inheritedScope.parentItemId] }
      : {}),
  });
  const reconciledBaseline = activities.find((activity) => activity.kind === "initiative_scope_baseline"
    && isRecord(activity.payload) && activity.payload.baselineId === reconciliation.baselineId)?.payload;
  if (isRecord(reconciledBaseline) && reconciledBaseline.origin === "item-body"
    && (typeof reconciledBaseline.criteriaDigest !== "string"
      || !sameBodyCriteriaVersion({ criteriaDigest: reconciledBaseline.criteriaDigest }, item.body))) {
    reconciliation = { ...reconciliation, state: "missing", evidenceRefs: [] };
  }
  let bodyAuthorRoom: Awaited<ReturnType<typeof import("./body-baseline-author-room").resolveBodyBaselineAuthorRoom>> = null;
  if (isRecord(reconciledBaseline) && reconciledBaseline.origin === "item-body") {
    const source = isRecord(reconciledBaseline.sourceIdentity) ? reconciledBaseline.sourceIdentity : null;
    const authority = isRecord(reconciledBaseline.authoritySnapshot) ? reconciledBaseline.authoritySnapshot : null;
    const { resolveBodyBaselineAuthorRoom } = await import("./body-baseline-author-room");
    const currentRoom = await resolveBodyBaselineAuthorRoom(
      db as unknown as import("@dpf/db").Prisma.TransactionClient, item);
    bodyAuthorRoom = currentRoom;
    if (!currentRoom || source?.headSha !== currentRoom.headSha || source?.repositoryFullName !== currentRoom.repositoryFullName
      || authority?.organizationId !== (item.organizationId ?? "platform")) {
      reconciliation = { ...reconciliation, state: "missing", evidenceRefs: [] };
    }
  }
  const editPaths = await readBoundEditPaths(db as unknown as BoundWorkShapeDb, item.itemId).catch(() => null);
  const binding = editPaths && completionInputBinding({ item, shape: boundWorkShape, baseline: reconciledBaseline,
    room: bodyAuthorRoom, editPaths });
  // An explicit invalid submission must never borrow a previous valid input.
  // Reads and admission use the same current evaluator, not an old verdict.
  const rawManifest = args.reuseRecordedInput === true && args.rawManifest === undefined
    ? await readCompletionInput(db, item, binding) : args.rawManifest;
  const completion = await (deps.resolveCompletionEvidence ?? resolveCompletionEvidence)(
    db as unknown as CompletionEvidenceRuntimeDb,
    { itemId: item.itemId, rawManifest, now: new Date(evaluatedAt) },
  );
  const completionInputContext = completion.kind === "evaluated" && completion.verdict.allowed
    ? retainCompletionInput(binding, completion.verdict.normalizedManifest) : null;
  const acceptanceState = reconciliation.state;
  // An initiative's own PR cannot prove its children or hypothesis outcomes.
  // BI-B1B44777: every other non-contractual item closes on its merge.
  const directMerge = !aggregate && deliveryClosesItem(item);
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
  // EP-4614F35E (kernel DI-54AECB341524), widened by BI-B1B44777: recognize a
  // merge through the code gates (CI + merge queue + PR review) as completing
  // any non-contractual item, without a separate acceptance reviewer. A
  // contractual item keeps every gate; a real objective conflict/malformed
  // reconciliation is NEVER waved through, and a current failure still blocks.
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
  const currentFailures = currentFailuresOf(completion);
  const acceptanceFailures = currentFailures.filter((failure) => ACCEPTANCE_FAILURE_DIMENSIONS.has(failure.dimension));
  const failureRefs = (failures: readonly CurrentEvidenceFailure[]) => failures.map((failure) => failure.evidenceActivityId);
  let delivery = currentFailures.length > 0
    ? "fail" as const
    : mergedThroughGates === "merged" || deployment ? "pass" as const : deliveryState(completion);
  const directDocumentationAcceptance = completion.kind === "evaluated"
    && completion.verdict.allowed
    && completion.verdict.normalizedManifest?.workClass === "documentation"
    && (completion.verdict.acceptanceEvidenceRefs?.length ?? 0) > 0;
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
  const acceptancePass = acceptanceFailures.length === 0
    && (reconciliation.state === "pass" || (!aggregate && (directDocumentationAcceptance || smallShapeAcceptance || mergeAccepts)));
  const acceptanceFailed = acceptanceFailures.length > 0 || reconciliation.state === "fail";
  const objectiveReconciliationPass = reconciliation.state === "pass" || smallShapeAcceptance || mergeAccepts;
  const deliveryEvidenceRefs = completion.kind === "evaluated"
    ? completion.verdict.normalizedManifest?.evidenceActivityIds ?? []
    : [];
  const projectionInput: Parameters<typeof projectBacklogItemReadiness>[0] = {
    currentDesign: args.currentDesign,
    item: {
      ...item,
      activeBuildKind: item.activeBuild?.kind ?? null,
      workShape: gatedWorkShape,
      // BI-243BC956: completion re-reads the room's declared edit scope.
      deliverySensitivity: assessDeliverySensitivity({
        ...item,
        declaredPaths: editPaths ?? [],
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
      acceptanceEvidence: acceptancePass ? "pass" : acceptanceFailed ? "fail" : "missing",
      objectiveReconciliation: objectiveReconciliationPass ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
      objectiveBaselineConflict: reconciliation.state === "conflict",
      projectionError: reconciliation.state === "malformed",
      evidenceRefs: {
        DELIVERY_EVIDENCE_REQUIRED: currentFailures.length > 0 ? failureRefs(currentFailures) : deliveryEvidenceRefs,
        ACCEPTANCE_EVIDENCE_REQUIRED: acceptanceFailures.length > 0
          ? failureRefs(acceptanceFailures)
          : (directDocumentationAcceptance || smallShapeAcceptance) && completion.kind === "evaluated"
            ? completion.verdict.acceptanceEvidenceRefs ?? []
            : reconciliation.evidenceRefs,
        OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
      },
      requirementReasons: {
        DELIVERY_EVIDENCE_REQUIRED: currentFailures.length > 0
          ? currentFailureReasons(currentFailures)
          : mergedThroughGates === "merged"
            ? unreadManifestReasons(completion)
            : [...mergeSignalReasons, ...deliveryReasons(completion)],
        ACCEPTANCE_EVIDENCE_REQUIRED: acceptanceFailures.length > 0
          ? currentFailureReasons(acceptanceFailures)
          : [...mergeSignalReasons, ...unreadManifestReasons(completion)],
        OBJECTIVE_RECONCILIATION_REQUIRED: mergeSignalReasons,
      },
    },
    evaluatedAt,
  };
  const project = deps.projectReadiness ?? projectBacklogItemReadiness;
  if (aggregate) {
    const source = projectBacklogItemReadiness({ ...projectionInput, recognizeMergeThroughGates: false });
    const children = await resolveAggregateCompletion({ itemId: item.itemId,
      activities: activities as InitiativeReadinessActivity[], source, db: db as unknown as AggregateCompletionDb });
    delivery = currentFailures.length > 0 ? "fail" : children.delivery;
    projectionInput.completion = { ...projectionInput.completion!, decomposition: children.decomposition,
      deliveryEvidence: delivery,
      objectiveReconciliation: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
      evidenceRefs: { ...projectionInput.completion!.evidenceRefs,
        PLAN_COVERAGE_REQUIRED: children.evidenceRefs,
        DELIVERY_EVIDENCE_REQUIRED: currentFailures.length > 0 ? failureRefs(currentFailures) : children.evidenceRefs },
      requirementReasons: { ...projectionInput.completion!.requirementReasons,
        PLAN_COVERAGE_REQUIRED: children.coverageReasons,
        DELIVERY_EVIDENCE_REQUIRED: currentFailures.length > 0 ? currentFailureReasons(currentFailures) : children.deliveryReasons },
    };
  }
  const projected = project(projectionInput);
  // BI-C899BB40: whether THIS closure is the delivery-closes default of
  // BI-B1B44777 (deliveryClosesItem, recognizeMergeThroughGates above), so the
  // terminal transition can record a bounded obligation. A reported fact, not
  // a second rule: it adds no gate and relaxes nothing. A contractual item, an
  // aggregate, a current failure or a failed/conflicting reconciliation is
  // never a delivery closure.
  const closureFollowsDelivery = recognizeMergeThroughGates && acceptanceFailures.length === 0
    && reconciliation.state !== "fail" && reconciliation.state !== "conflict" && reconciliation.state !== "malformed";

  const independent = project({ ...projectionInput, completion: {
    ...projectionInput.completion!,
    acceptanceEvidence: acceptanceFailures.length === 0
      && (reconciliation.state === "pass" || (!aggregate && (directDocumentationAcceptance || smallShapeAcceptance)))
      ? "pass" : acceptanceFailed ? "fail" : "missing",
    objectiveReconciliation: reconciliation.state === "pass" || smallShapeAcceptance
      ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
  } });
  return {
    completionInputContext,
    governed: projected.governed,
    decision: deployment ? projectDeploymentClosure(projected.decision, deployment) : projected.decision,
    independentAcceptanceDecision: independent.decision,
    reconciliation,
    delivery,
    mergedThroughGates,
    deployment,
    acceptanceState,
    hasDesignSpec,
    deliveryEvidenceRefs,
    closureFollowsDelivery,
    customerReported: isCustomerReported(item) && !isContractualItem(item),
  };
}

/** The statuses whose read projection carries the completion gate's own evaluation. */
const GATE_EVALUATED_READ_STATUSES = new Set(["awaiting-acceptance"]);

export type BacklogCompletionReadDb = BacklogCompletionDb & {
  backlogItem: { findUnique(args: unknown): Promise<BacklogCompletionItem | null> };
};

/**
 * The read projection's completion decision (get_backlog_item, the acceptance
 * sweep): the gate's own evaluation, with bound input recovery and no mutation.
 *
 * Bounded: only an item awaiting acceptance pays for it — the merge signal may
 * run git against a source checkout — and `null` means "not evaluated here",
 * on which the caller keeps its existing projection. Any failure is `null`
 * too, never a fabricated verdict; an unavailable merge signal is NOT a
 * failure — it evaluates, and the decision says the signal was unavailable,
 * exactly as the transition would.
 */
export async function readBacklogItemCompletion(args: {
  currentDesign?: CurrentDesignEvidence;
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
      currentDesign: args.currentDesign,
      db,
      item,
      rawManifest: undefined,
      reuseRecordedInput: true,
      transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read-projection", targetState: "completion" },
      evaluatedAt: args.evaluatedAt,
      ...(args.dependencies ? { dependencies: args.dependencies } : {}),
    });
  } catch {
    return null;
  }
}
