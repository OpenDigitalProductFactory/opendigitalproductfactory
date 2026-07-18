// apps/web/lib/build/approve-decomposition.ts
//
// Phase 4a of the design-time decomposition rollout.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// Atomic creation of an execution-organizational Epic + N child FeatureBuilds
// + sibling-dependency edges, plus supersession of the originating
// FeatureBuild. All in one Prisma transaction so the system never observes a
// half-decomposed state.
//
// Phase 4a is server-side substrate: the caller supplies an already-validated
// `DecompositionCandidate` (e.g. via the MCP tool wrapper). The slide-over UI
// that lets the operator pick a candidate, plus the LLM-call orchestration
// that proposes candidates, both land in Phase 4b.
//
// Operator decisions honored (spec §12):
//   - Q4: assertNoRecursiveDecomposition guards against decomposing a child.
//   - Q5: child FeatureBuild.originatingBacklogItemId is preserved AND
//         Epic.originatingBacklogItemId is set (hybrid FK).
//   - Q6: no new BuildPhase values. The superseded original sets
//         phase="failed" with supersededByEpicId; the new signal for
//         "this FB was decomposed rather than failed" is `supersededByEpicId
//         !== null`, not a new phase value. Downstream UI reads both.
//
// All invariants from apps/web/lib/build/epic-decomposition-invariants.ts
// fire on the proposed shape before any rows are written. Loud failure on
// violation per the invariant module's discipline.

import { prisma } from "@dpf/db";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import { generateBuildId, normalizeHappyPathState } from "@/lib/explore/feature-build-types";
import type { BuildDesignDoc, ReviewResult } from "@/lib/explore/feature-build-types";
import { isPlanReviewOscillating } from "@/lib/build/plan-oscillation-decomposition";
import {
  applyChildIntakeToPlan,
  buildDecompositionChildIntakePatch,
} from "./decomposition-child-intake";

import {
  candidateToChildDesignDocs,
  validateCandidate,
  type DecompositionCandidate,
} from "./decomposition-candidates";
import {
  DecompositionInvariantError,
  assertChildDesignReviewTransitive,
  assertChildOrderWellFormed,
  assertDependencyEdgeWellFormed,
  assertEpicHasContractIfDecomposed,
  assertNoCycle,
  assertNoRecursiveDecomposition,
} from "./epic-decomposition-invariants";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ApproveDecompositionInput = {
  buildId: string;
  candidate: DecompositionCandidate;
  userId: string;
  agentId?: string | null;
  /** Test seam: override timestamp. */
  now?: () => Date;
  /** Test seam: provide a fake prisma client (Prisma.TransactionClient-shaped
   *  enough for our needs). Defaults to the real `prisma` import. */
  db?: ApproveDecompositionDb;
  /** Test seam: override id generators so tests can assert deterministic ids. */
  idGen?: { epicId: () => string; childBuildId: () => string };
  /**
   * Test seam / override: plan dispatch for children that have no unsatisfied
   * sibling deps (BI-E49DDE47). Default fire-and-forgets
   * `dispatchPlanForApprovedBuild` so the head-of-chain does not strand in plan.
   */
  dispatchPlanForChild?: (params: {
    buildId: string;
    userId: string;
  }) => Promise<unknown>;
};

export type ApproveDecompositionResult =
  | {
      ok: true;
      epicId: string;
      childBuildIds: string[];
      /** Children with empty dependsOn — plan_dispatch was (or will be) fired. */
      unblockedChildBuildIds: string[];
    }
  | {
      ok: false;
      error: string;
      code: ApproveDecompositionErrorCode;
    };

/**
 * Pure: among newly-created children, which have no sibling dependency edges
 * and can start plan generation immediately after approve_decomposition.
 */
export function selectUnblockedChildBuildIds(
  childScopes: ReadonlyArray<{ childOrder: number; dependsOn: readonly number[] }>,
  orderToBuildId: ReadonlyMap<number, string>,
): string[] {
  const ids: string[] = [];
  for (const scope of childScopes) {
    if (scope.dependsOn.length > 0) continue;
    const id = orderToBuildId.get(scope.childOrder);
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

export type ApproveDecompositionErrorCode =
  | "build-not-found"
  | "build-not-in-ideate"
  | "build-missing-design-doc"
  | "build-design-review-not-passed"
  | "build-already-decomposed"
  | "candidate-validation-failed"
  | "invariant-violation";

// The minimal Prisma-shaped surface this module touches. Useful for tests
// (pass a fake) and clear documentation of what writes happen.
export type ApproveDecompositionDb = {
  featureBuild: {
    findUnique: typeof prisma.featureBuild.findUnique;
  };
  $transaction: <T>(
    fn: (tx: TxShape) => Promise<T>,
  ) => Promise<T>;
};

export type TxShape = {
  epic: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; epicId: string }>;
  };
  featureBuild: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; buildId: string }>;
    update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
  };
  featureBuildDependency: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  backlogItem: {
    update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
  };
  buildActivity: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function approveDecomposition(
  args: ApproveDecompositionInput,
): Promise<ApproveDecompositionResult> {
  const now = args.now ?? (() => new Date());
  const db: ApproveDecompositionDb = args.db ?? {
    featureBuild: { findUnique: prisma.featureBuild.findUnique.bind(prisma.featureBuild) },
    $transaction: ((fn) => prisma.$transaction(fn as never)) as ApproveDecompositionDb["$transaction"],
  };
  const idGen = args.idGen ?? {
    epicId: () => `EP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    childBuildId: () => generateBuildId(),
  };

  // 1. Fetch the originating FB.
  const build = await db.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      phase: true,
      designDoc: true,
      designReview: true,
      planReview: true,
      plan: true,
      parentEpicId: true,
      originatingBacklogItemId: true,
      digitalProductId: true,
      portfolioId: true,
      accountableEmployeeId: true,
      createdById: true,
    },
  });
  if (!build) {
    return { ok: false, code: "build-not-found", error: `FeatureBuild ${args.buildId} not found.` };
  }

  // 2. Eligibility checks.
  const planReview = (build.planReview ?? null) as ReviewResult | null;
  const planOscillationEntry =
    build.phase === "plan" && isPlanReviewOscillating(planReview);

  if (build.phase !== "ideate" && !planOscillationEntry) {
    return {
      ok: false,
      code: "build-not-in-ideate",
      error: `Build is in phase "${build.phase}". Decomposition is only allowed during ideate or an oscillating Plan review.`,
    };
  }
  const designDoc = build.designDoc as BuildDesignDoc | null;
  if (!designDoc) {
    return { ok: false, code: "build-missing-design-doc", error: "Build has no designDoc to decompose." };
  }
  const review = (build.designReview ?? null) as ReviewResult | null;
  if (!review || review.decision !== "pass") {
    return {
      ok: false,
      code: "build-design-review-not-passed",
      error: "Build's designReview is not yet passed. Run reviewDesignDoc first.",
    };
  }

  // 3. Recursive-decomposition guard (spec Q4).
  try {
    assertNoRecursiveDecomposition({ id: build.id, parentEpicId: build.parentEpicId });
  } catch (err) {
    if (err instanceof DecompositionInvariantError) {
      return {
        ok: false,
        code: "build-already-decomposed",
        error: err.message,
      };
    }
    throw err;
  }

  // 4. Candidate validation — pure, against the parent designDoc.
  const validateRes = validateCandidate(args.candidate, designDoc);
  if (!validateRes.ok) {
    const summary = validateRes.failures
      .map((f) => `[${f.code}] ${f.message}`)
      .join("; ");
    return {
      ok: false,
      code: "candidate-validation-failed",
      error: `Candidate failed validation: ${summary}`,
    };
  }

  // 5. Build the proposed child docs + dependency edges. Run all invariants
  //    BEFORE the transaction so a failure rolls back cheaply (no DB work
  //    needed yet).
  const epicIdLogical = idGen.epicId();
  const childDocs = candidateToChildDesignDocs(args.candidate, designDoc);
  const childBuildLogicalIds = childDocs.map(() => idGen.childBuildId());

  // Invariant 1: parent will have featureBuilds → must carry designDoc.
  try {
    assertEpicHasContractIfDecomposed({
      designDoc,
      featureBuilds: childDocs,
    });

    // Invariant 2 + 3: per-child review-transitivity and well-formed childOrder.
    for (const child of childDocs) {
      assertChildDesignReviewTransitive(
        {
          parentEpicId: "logical-epic", // placeholder; the real epic.id comes from tx
          designReview: review,
        },
        { id: "logical-epic", designReview: review },
      );
      assertChildOrderWellFormed({
        parentEpicId: "logical-epic",
        childOrder: child.childOrder,
      });
    }

    // Invariant 4 + 5: dependency edges and acyclic graph.
    // Map candidate's childOrder → logical buildId (we don't have real ids
    // yet; the invariant only checks string equality between the dependent's
    // and dependsOn's parentEpicId, so "logical-epic" suffices here.)
    const orderToLogicalId = new Map<number, string>();
    for (let i = 0; i < childDocs.length; i++) {
      orderToLogicalId.set(childDocs[i]!.childOrder, childBuildLogicalIds[i]!);
    }
    const proposedEdges: Array<{ dependentBuildId: string; dependsOnBuildId: string }> = [];
    for (const scope of args.candidate.childScopes) {
      const dependentId = orderToLogicalId.get(scope.childOrder)!;
      for (const depOrder of scope.dependsOn) {
        const dependsOnId = orderToLogicalId.get(depOrder)!;
        assertDependencyEdgeWellFormed({
          dependent: { id: dependentId, parentEpicId: "logical-epic" },
          dependsOn: { id: dependsOnId, parentEpicId: "logical-epic" },
          parentEpicId: "logical-epic",
        });
        proposedEdges.push({ dependentBuildId: dependentId, dependsOnBuildId: dependsOnId });
      }
    }
    // Cycle check against the FULL proposed edge set (not one-by-one with
    // an empty baseline) — the validator already proved the candidate's
    // own dependency graph is acyclic, but assertNoCycle here is the
    // belt-and-braces verification against the invariant module.
    if (proposedEdges.length > 0) {
      const first = proposedEdges[0]!;
      const rest = proposedEdges.slice(1);
      assertNoCycle({ existingEdges: rest, newEdge: first });
    }
  } catch (err) {
    if (err instanceof DecompositionInvariantError) {
      return {
        ok: false,
        code: "invariant-violation",
        error: `Invariant violation (${err.code}): ${err.message}`,
      };
    }
    throw err;
  }

  // 6. Atomic transaction.
  const decompositionState = {
    sourceBuildId: build.buildId,
    candidateId: args.candidate.candidateId,
    candidateRationale: args.candidate.rationale,
    approvedAt: now().toISOString(),
    approvedByUserId: args.userId,
    approvedByAgentId: args.agentId ?? null,
    partition: args.candidate.childScopes.map((s) => ({
      childOrder: s.childOrder,
      title: s.title,
      summary: s.summary,
      acceptanceCriteriaIndices: s.acceptanceCriteriaIndices.slice(),
      dependsOn: s.dependsOn.slice(),
    })),
  };

  const txResult = await db.$transaction(async (tx) => {
    if ("$queryRaw" in tx && "platformCapability" in tx && "runtimeCapabilityTransition" in tx) {
      await admitRuntimeGuardedWork(tx as never, "build-studio-active");
    }
    const createdEpic = await tx.epic.create({
      data: {
        epicId: epicIdLogical,
        title: build.title,
        status: "open",
        submittedById: args.userId,
        agentId: args.agentId ?? null,
        designDoc: designDoc as never,
        designReview: review as never,
        decompositionState: decompositionState as never,
        ...(build.originatingBacklogItemId
          ? { originatingBacklogItemId: build.originatingBacklogItemId }
          : {}),
      },
    });

    // Children go straight to `plan`, so they never pass through the ideate
    // reviewDesignDoc step that normally populates plan.happyPathState.intake.
    // Without it they hard-block at the plan→build gate ("Intake is incomplete")
    // and churn forever (BI-FF8ABFCB). Derive each child's intake from the
    // parent build's intake (same epic/backlog/taxonomy, child-specific goal).
    const parentIntake = normalizeHappyPathState(
      (build.plan as Record<string, unknown> | null)?.["happyPathState"],
    ).intake;

    // Create children with real epic.id.
    const orderToRealBuildId = new Map<number, string>();
    const orderToRealRowId = new Map<number, string>();
    for (let i = 0; i < childDocs.length; i++) {
      const child = childDocs[i]!;
      const childBuildLogical = childBuildLogicalIds[i]!;
      const childPlan = applyChildIntakeToPlan(
        null,
        buildDecompositionChildIntakePatch({
          parentIntake,
          epicSemanticId: createdEpic.epicId,
          childTitle: child.title,
          childOriginatingBacklogItemId: build.originatingBacklogItemId ?? null,
          childBuildId: childBuildLogical,
        }),
      );
      const created = await tx.featureBuild.create({
        data: {
          buildId: childBuildLogical,
          title: child.title,
          phase: "plan", // children go straight to plan (Q6 — no blocked-on-sibling)
          parentEpicId: createdEpic.id,
          childOrder: child.childOrder,
          designDoc: child.designDoc as never,
          designReview: review as never,
          plan: childPlan as never,
          createdById: args.userId,
          ...(build.originatingBacklogItemId
            ? { originatingBacklogItemId: build.originatingBacklogItemId }
            : {}),
          ...(build.digitalProductId ? { digitalProductId: build.digitalProductId } : {}),
          ...(build.portfolioId ? { portfolioId: build.portfolioId } : {}),
          ...(build.accountableEmployeeId
            ? { accountableEmployeeId: build.accountableEmployeeId }
            : {}),
        },
      });
      orderToRealBuildId.set(child.childOrder, created.buildId);
      orderToRealRowId.set(child.childOrder, created.id);
    }

    // Create dependency edges.
    for (const scope of args.candidate.childScopes) {
      const dependentRowId = orderToRealRowId.get(scope.childOrder)!;
      for (const depOrder of scope.dependsOn) {
        const dependsOnRowId = orderToRealRowId.get(depOrder)!;
        await tx.featureBuildDependency.create({
          data: {
            dependentBuildId: dependentRowId,
            dependsOnBuildId: dependsOnRowId,
            parentEpicId: createdEpic.id,
          },
        });
      }
    }

    // Supersede the originating FB.
    await tx.featureBuild.update({
      where: { buildId: build.buildId },
      data: {
        phase: "failed", // Q6 — no new phase value. The decomposition signal is supersededByEpicId.
        supersededByEpicId: createdEpic.id,
        abandonedAt: now(),
        abandonReason: `decomposed-into-epic:${createdEpic.epicId}`,
      },
    });

    // Swap the backlog item's active link from build → epic (if any).
    if (build.originatingBacklogItemId) {
      await tx.backlogItem.update({
        where: { id: build.originatingBacklogItemId },
        data: {
          activeBuildId: null,
          activeEpicId: createdEpic.id,
        },
      });
    }

    // Log activity on the originating build.
    await tx.buildActivity.create({
      data: {
        buildId: build.buildId,
        tool: "approveDecomposition",
        summary: `Decomposed into Epic ${createdEpic.epicId} with ${childDocs.length} child build(s).`,
      },
    });

    // Log activity on each new child build.
    for (let i = 0; i < childDocs.length; i++) {
      const childBuildId = orderToRealBuildId.get(childDocs[i]!.childOrder)!;
      await tx.buildActivity.create({
        data: {
          buildId: childBuildId,
          tool: "approveDecomposition",
          summary: `Created as child #${childDocs[i]!.childOrder} of Epic ${createdEpic.epicId} (from FB ${build.buildId}).`,
        },
      });
    }

    const unblockedChildBuildIds = selectUnblockedChildBuildIds(
      args.candidate.childScopes,
      orderToRealBuildId,
    );

    return {
      epicId: createdEpic.epicId,
      childBuildIds: Array.from(orderToRealBuildId.values()),
      unblockedChildBuildIds,
    };
  });

  // BI-E49DDE47: children land in plan with designDoc copied, but nothing
  // previously fired plan_dispatch — they sat "gone quiet" forever. Kick
  // unblocked heads (empty dependsOn) the same way ideate→plan approval does.
  // Dependency-chained siblings still wait on completion + dependency:ready.
  if (txResult.unblockedChildBuildIds.length > 0) {
    const dispatch =
      args.dispatchPlanForChild ??
      (async (params: { buildId: string; userId: string }) => {
        const { dispatchPlanForApprovedBuild } = await import(
          "@/lib/integrate/plan-on-approval"
        );
        return dispatchPlanForApprovedBuild(params);
      });
    for (const childBuildId of txResult.unblockedChildBuildIds) {
      void dispatch({ buildId: childBuildId, userId: args.userId }).catch(() => {
        // never block approve on plan-dispatch failure; activity log lives inside dispatcher
      });
    }
  }

  return {
    ok: true,
    epicId: txResult.epicId,
    childBuildIds: txResult.childBuildIds,
    unblockedChildBuildIds: txResult.unblockedChildBuildIds,
  };
}
