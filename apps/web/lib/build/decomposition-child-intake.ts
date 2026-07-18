// apps/web/lib/build/decomposition-child-intake.ts
//
// BI-FF8ABFCB — decomposition children are created directly in `plan` (see
// approve-decomposition.ts) with the parent's designDoc copied, but WITHOUT a
// `plan.happyPathState.intake`. The plan→build gate (checkPhaseGate →
// isHappyPathIntakeReady) requires taxonomyNodeId + backlogItemId + epicId +
// constrainedGoal, so an intake-less child hard-blocks with "Intake is
// incomplete" and the resume reconciler re-dispatches it forever (burning
// plan-generation spend). Surfaced at scale by the BI-C4F828B7 autopilot
// auto-decompose wave: 86/86 children had intake=null.
//
// This module derives a child's intake from its parent (the pre-decomposition
// build, which had complete intake) and is used by two paths:
//   - fix-forward: approveDecomposition sets it at child-creation time.
//   - self-heal:   the plan resume path backfills already-created children.

import {
  deriveIntakeTaxonomyAnchor,
  isHappyPathIntakeReady,
  mergeHappyPathStateIntoPlan,
  normalizeHappyPathState,
  type HappyPathIntakeState,
} from "@/lib/explore/feature-build-types";

export type DecompositionChildIntakePatch = {
  status: "ready";
  epicId: string;
  backlogItemId: string | null;
  taxonomyNodeId: string | null;
  constrainedGoal: string;
};

/**
 * Pure: derive a child's intake from the parent's intake + the child's identity.
 * - `epicId` anchors on the child's own decomposition Epic (its `parentEpicId`),
 *   not the parent build's pre-decomposition epic.
 * - `backlogItemId` / `taxonomyNodeId` inherit from the parent; taxonomy falls
 *   back to the provenance anchor (`triaged-bi:<id>` / `adhoc-build:<id>`) so the
 *   result always satisfies `isHappyPathIntakeReady`.
 * - `constrainedGoal` is the child's scope title (each child is a distinct slice).
 */
export function buildDecompositionChildIntakePatch(args: {
  parentIntake: HappyPathIntakeState | null | undefined;
  epicSemanticId: string;
  childTitle: string;
  childOriginatingBacklogItemId: string | null | undefined;
  childBuildId: string;
}): DecompositionChildIntakePatch {
  const parent = args.parentIntake ?? null;
  const taxonomyNodeId =
    parent?.taxonomyNodeId ??
    deriveIntakeTaxonomyAnchor({
      taxonomyNodeId: null,
      originatingBacklogItemId: args.childOriginatingBacklogItemId,
      buildId: args.childBuildId,
    });
  const constrainedGoal =
    args.childTitle.trim().slice(0, 280) || "Decomposed child build";
  return {
    status: "ready",
    epicId: args.epicSemanticId,
    backlogItemId: parent?.backlogItemId ?? args.childOriginatingBacklogItemId ?? null,
    taxonomyNodeId,
    constrainedGoal,
  };
}

/** Merge a derived child intake patch into a plan JSON (or a fresh plan). */
export function applyChildIntakeToPlan(
  plan: Record<string, unknown> | null | undefined,
  patch: DecompositionChildIntakePatch,
): Record<string, unknown> {
  return mergeHappyPathStateIntoPlan(plan, { intake: patch });
}

// ---------------------------------------------------------------------------
// Self-heal (DB) — backfill intake for an already-created plan-phase child.
// ---------------------------------------------------------------------------

export type HealChildIntakeDb = {
  epic: { findUnique: (args: { where: { id: string }; select: { epicId: true } }) => Promise<{ epicId: string } | null> };
  featureBuild: {
    findFirst: (args: {
      where: { supersededByEpicId: string };
      select: { plan: true };
    }) => Promise<{ plan: unknown } | null>;
    update: (args: { where: { buildId: string }; data: { plan: unknown } }) => Promise<unknown>;
  };
};

export type HealChildIntakeInput = {
  child: {
    buildId: string;
    title: string;
    parentEpicId: string;
    originatingBacklogItemId: string | null;
    plan: unknown;
  };
  db?: HealChildIntakeDb;
};

/**
 * Backfill a decomposition child's intake from its superseded parent build.
 * Idempotent: returns false (no-op) when the child's intake is already ready or
 * the child is not a decomposition child. Returns true when it wrote a heal.
 */
export async function healDecompositionChildIntake(
  input: HealChildIntakeInput,
): Promise<boolean> {
  const { child } = input;
  const planRec = (child.plan ?? null) as Record<string, unknown> | null;
  const happy = normalizeHappyPathState(planRec?.["happyPathState"]);
  if (isHappyPathIntakeReady(happy)) return false;

  const db: HealChildIntakeDb =
    input.db ?? ((await import("@dpf/db")).prisma as unknown as HealChildIntakeDb);

  // The child's decomposition Epic (semantic id) + the superseded parent build
  // (whose supersededByEpicId points at that same Epic row) carry the anchors.
  const [epic, parent] = await Promise.all([
    db.epic.findUnique({ where: { id: child.parentEpicId }, select: { epicId: true } }),
    db.featureBuild.findFirst({
      where: { supersededByEpicId: child.parentEpicId },
      select: { plan: true },
    }),
  ]);

  const parentPlan = (parent?.plan ?? null) as Record<string, unknown> | null;
  const parentIntake = normalizeHappyPathState(parentPlan?.["happyPathState"]).intake;

  const patch = buildDecompositionChildIntakePatch({
    parentIntake,
    epicSemanticId: epic?.epicId ?? child.parentEpicId,
    childTitle: child.title,
    childOriginatingBacklogItemId: child.originatingBacklogItemId,
    childBuildId: child.buildId,
  });
  const newPlan = applyChildIntakeToPlan(planRec, patch);
  await db.featureBuild.update({ where: { buildId: child.buildId }, data: { plan: newPlan } });
  return true;
}
