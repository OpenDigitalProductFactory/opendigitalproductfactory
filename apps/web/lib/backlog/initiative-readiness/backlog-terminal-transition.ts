import { createHash } from "node:crypto";
import { resolveBacklogDeploymentClosure, projectDeploymentClosure, type DeploymentClosureProof, type DeploymentClosureResult } from "./deployment-closure";

import { prisma } from "@dpf/db";

import {
  resolveCompletionEvidence,
  type CompletionEvidenceRuntimeDb,
  type ResolveCompletionEvidenceResult,
} from "@/lib/backlog/completion-evidence-runtime";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import {
  defaultResolveMergeDelivery,
  mergeSignalRoots,
  mergeSignalUnavailableReason,
  type ResolveMergeDelivery,
} from "./merge-delivery-signal";
import { projectBacklogItemReadiness, readinessShapeFromWorkShape, type InitiativeReadinessActivity } from "./entry-adapter";
import { type InheritanceDb, loadInheritedInitiativeScope } from "./parent-scope-inheritance";
import { type BoundWorkShapeDb, readBoundEditPaths, readBoundWorkShapeRef } from "./bound-work-shape";
import { assessDeliverySensitivity } from "./delivery-sensitivity";
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
    resolveDeploymentClosure?: (args: { itemId: string; workType: string | null; roots: string[] }) => Promise<DeploymentClosureResult>;
  };
}): Promise<GovernedTerminalTransitionResult> {
  const db = args.db ?? (prisma as unknown as BacklogTerminalDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  let lockedItem: BacklogTerminalItem | null = null;
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
      acceptanceState = reconciliation.state;
      const deploymentResult = isDirectMergePlatformWork(lockedItem)
        ? await (args.dependencies?.resolveDeploymentClosure ?? resolveBacklogDeploymentClosure)({
          itemId: lockedItem.itemId, workType: lockedItem.workType, roots: mergeSignalRoots(),
        }) : null;
      deployment = deploymentResult?.kind === "deployed"
        && reconciliation.state !== "conflict" && reconciliation.state !== "malformed"
        ? deploymentResult : null;
      const mergedThroughGates = await (args.dependencies?.resolveMergeDelivery ?? defaultResolveMergeDelivery)({
        itemRowId: lockedItem.id,
        itemId: lockedItem.itemId,
        workType: lockedItem.workType,
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
        (mergedThroughGates === "merged" || deployment !== null) && isDirectMergePlatformWork(lockedItem);
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
        !deployment && mergedThroughGates === "signal-unavailable" && isDirectMergePlatformWork(lockedItem);
      const mergeSignalReasons = mergeSignalBlindSpot
        ? [mergeSignalUnavailableReason(mergeSignalRoots())]
        : [];
      // A merge through branch protection is authoritative delivery evidence and
      // supersedes a missing/hand-built manifest (BI-B04A0203).
      const delivery = mergedThroughGates === "merged" || deployment ? "pass" : deliveryState(completion);
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
        (!deployment && recognizeMergeThroughGates && reconciliation.state !== "conflict" && reconciliation.state !== "malformed");
      const objectiveReconciliationPass = reconciliation.state === "pass"
        || smallShapeAcceptance
        || (!deployment && recognizeMergeThroughGates && reconciliation.state !== "conflict" && reconciliation.state !== "malformed");
      const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
        item: {
          ...lockedItem,
          activeBuildKind: lockedItem.activeBuild?.kind ?? null,
          workShape: boundWorkShape,
          // BI-243BC956: completion re-reads the room's declared edit scope.
          deliverySensitivity: assessDeliverySensitivity({
            ...lockedItem,
            declaredPaths: await readBoundEditPaths(tx as unknown as BoundWorkShapeDb, lockedItem.itemId).catch(() => []),
          }),
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
          deployment,
          acceptanceState,
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
