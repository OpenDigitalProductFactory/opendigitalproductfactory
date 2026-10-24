import { describeReadinessRefusal } from "@/lib/build/readiness-refusal-message";
import { type BoundWorkShapeDb, readBoundEditPaths, readBoundWorkShapeRef } from "@/lib/backlog/initiative-readiness/bound-work-shape";
import { assessDeliverySensitivity, buildPlanPaths } from "@/lib/backlog/initiative-readiness/delivery-sensitivity";
import { type InheritanceDb, loadInheritedInitiativeScope } from "@/lib/backlog/initiative-readiness/parent-scope-inheritance";
import { randomUUID } from "node:crypto";
import { digestBuildArtifactValue } from "@/lib/build/build-artifact-provenance";

import { prisma } from "@dpf/db";
import { CLAIM_READINESS_ACTIVITY_KINDS } from "@/lib/work-capsules/governed-work-claim";

import {
  projectBacklogItemReadiness,
  readinessRequirement,
  type InitiativeReadinessActivity,
  type InitiativeReadinessDecision,
  type ReadinessTarget,
} from "@/lib/backlog/initiative-readiness";

type BuildEntryGateDb = {
  featureBuild: { findUnique(args: unknown): Promise<any> };
  backlogItemActivity: { create(args: unknown): Promise<any>; findMany?(args: unknown): Promise<any[]> };
  buildActivity: { create(args: unknown): Promise<any> };
  /** BI-1E8EAD10: the bound delivery shape lives on the Workroom. */
  workroom?: { findFirst(args: unknown): Promise<{ scopeClaims?: unknown } | null> };
  backlogItem?: { findFirst(args: unknown): Promise<{ itemId: string } | null> };
};

type ProjectReadiness = typeof projectBacklogItemReadiness;

export type BuildInitiativeReadinessResult = {
  allowed: boolean;
  error?: "classification_required" | "initiative_not_ready";
  message: string;
  decision: InitiativeReadinessDecision;
};

function withDecisionId(decision: InitiativeReadinessDecision): InitiativeReadinessDecision {
  return decision.decisionId === "unpersisted"
    ? { ...decision, decisionId: `IRD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}` }
    : decision;
}

function orphanDecision(args: {
  buildId: string;
  target: ReadinessTarget;
  targetPhase: string;
  evaluatedAt: string;
}): InitiativeReadinessDecision {
  return {
    decisionId: `IRD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    policyVersion: "initiative-readiness.v1",
    subject: { kind: "feature-build", id: args.buildId },
    transitionObject: {
      kind: "feature-build",
      id: args.buildId,
      expectedVersion: "current",
      targetState: args.targetPhase,
    },
    profile: "feature",
    target: args.target,
    verdict: "denied",
    satisfied: [],
    unmet: [],
    blockers: [readinessRequirement({
      code: "CLASSIFICATION_REQUIRED",
      state: "blocked",
      accountableRole: "product-owner",
      profile: "feature",
    })],
    evaluatedAt: args.evaluatedAt,
  };
}

/** How many acceptance criteria a Build Studio design document states. */
function designAcceptanceCriteriaCount(designDoc: unknown): number {
  const list = designDoc && typeof designDoc === "object" && !Array.isArray(designDoc)
    ? (designDoc as Record<string, unknown>).acceptanceCriteria
    : null;
  if (!Array.isArray(list)) return 0;
  return list.filter((entry) => {
    const text = typeof entry === "string"
      ? entry
      : entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).text ?? (entry as Record<string, unknown>).criterion
        : null;
    return typeof text === "string" && text.trim().length > 0;
  }).length;
}

function designReviewPassed(designReview: unknown): boolean {
  return Boolean(designReview && typeof designReview === "object"
    && (designReview as Record<string, unknown>).decision === "pass");
}

/** The digest of the stored plan, in the form a plan revision records it (BI-6F2872FC). */
function currentBuildPlanDigest(buildPlan: unknown): string | null {
  return buildPlan == null ? null : `sha256:${digestBuildArtifactValue(buildPlan)}`;
}

function codes(decision: InitiativeReadinessDecision) {
  return [...decision.blockers, ...decision.unmet].map((entry) => entry.code);
}

export type BuildReadinessFactsInput = {
  kind: string;
  designDoc: unknown;
  designReview: unknown;
  buildPlan: unknown;
  originator: { id: string; itemId: string; title: string; body: string | null; workType: string | null };
};

/**
 * The facts a Build Studio build's readiness is judged on, read once for every
 * gate that judges a build (BI-1E8EAD10, BI-0E2E3BC5, and BI-3555F94E for the
 * terminal transition).
 *
 * - The Workroom's bound delivery shape, and the parent's scope a
 *   decomposition child inherits.
 * - Sensitivity read from the change: the item, the room's declared paths and
 *   the plan's files (operator direction 2026-10-07).
 * - The build's own reviewed design. For small and medium shapes that design
 *   is the recorded research and, absent body criteria, the baseline.
 *
 * A missing room or parent leaves the value null.
 */
export async function loadBuildReadinessFacts(db: BuildEntryGateDb, build: BuildReadinessFactsInput) {
  const originator = build.originator;
  const [workShape, inheritedScope, declaredPaths] = await Promise.all([
    db.workroom
      ? readBoundWorkShapeRef(db as BoundWorkShapeDb, originator.itemId).catch(() => null)
      : Promise.resolve(null),
    db.backlogItemActivity.findMany && db.backlogItem
      ? loadInheritedInitiativeScope(db as InheritanceDb, { childItemId: originator.itemId, childRowId: originator.id })
        .catch(() => null)
      : Promise.resolve(null),
    db.workroom
      ? readBoundEditPaths(db as BoundWorkShapeDb, originator.itemId).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);
  return {
    workShape,
    inheritedScope,
    deliverySensitivity: assessDeliverySensitivity({
      title: originator.title,
      body: originator.body,
      workType: originator.workType,
      declaredPaths,
      planPaths: buildPlanPaths(build.buildPlan),
    }),
    buildDesign: {
      reviewPassed: designReviewPassed(build.designReview),
      acceptanceCriteriaCount: designAcceptanceCriteriaCount(build.designDoc),
    },
  };
}

export async function enforceBuildInitiativeReadiness(args: {
  buildId: string;
  target: ReadinessTarget;
  targetPhase: string;
  expectedPhase?: string;
  evaluatedAt?: string;
  db?: BuildEntryGateDb;
  dependencies?: { projectReadiness?: ProjectReadiness };
}): Promise<BuildInitiativeReadinessResult> {
  const db = args.db ?? (prisma as unknown as BuildEntryGateDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  const build = await db.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: {
      id: true,
      buildId: true,
      kind: true,
      originatingBacklogItemId: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      originator: {
        select: {
          id: true, itemId: true, title: true, type: true, source: true, workType: true, scopeKind: true,
          body: true,
          archetypeCategories: true, archetypeIds: true,
          // BI-7027C26E: the same rows the claim reads. A small fix may leave
          // ideate with no design review (FIX_SMALL_GATES), and then its research
          // is its recorded reproduction — `evidence` rows (BI-6EB2DBBB). No cap:
          // evidence rows must not crowd receipts out of the projection.
          activities: {
            where: { kind: { in: [...CLAIM_READINESS_ACTIVITY_KINDS] } },
            orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
            select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
          },
        },
      },
    },
  });
  if (!build) throw new Error(`FeatureBuild ${args.buildId} not found.`);
  if (!build.originator) {
    const decision = orphanDecision({ ...args, evaluatedAt });
    await db.buildActivity.create({ data: {
      buildId: args.buildId,
      tool: "initiative-readiness",
      summary: `${args.target} denied: CLASSIFICATION_REQUIRED`,
    } });
    return { allowed: false, error: "classification_required", message: "Build has no canonical originating backlog subject.", decision };
  }

  const facts = await loadBuildReadinessFacts(db, build);
  const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
    item: {
      ...build.originator,
      activeBuildKind: build.kind,
      workShape: facts.workShape,
      deliverySensitivity: facts.deliverySensitivity,
    },
    buildDesign: facts.buildDesign,
    // BI-6F2872FC: only at plan -> build does the plan under review have to be
    // the covered one. Later phases may normalize the stored plan while
    // building, and that must not retroactively stale the entry it passed.
    ...(args.expectedPhase === "plan" ? { buildPlanDigest: currentBuildPlanDigest(build.buildPlan) } : {}),
    activities: build.originator.activities as InitiativeReadinessActivity[],
    inheritedScope: facts.inheritedScope,
    target: args.target,
    transitionObject: {
      kind: "feature-build",
      id: build.buildId,
      expectedVersion: args.expectedPhase ?? "current",
      targetState: args.targetPhase,
    },
    authorization: "pass",
    capsuleIdentity: "pass",
    evaluatedAt,
  });
  const decision = withDecisionId(projected.decision);
  await db.backlogItemActivity.create({ data: {
    backlogItemId: build.originator.id,
    kind: "initiative_readiness_decision",
    summary: `${args.target} readiness: ${decision.verdict}`,
    payload: {
      schemaVersion: 1,
      ...decision,
      stableCodes: codes(decision),
      authority: { actionKey: "advance_build_phase", enforcementState: "enforced" },
    },
  } });
  const blocked = projected.governed && decision.verdict !== "allowed";
  return {
    allowed: !blocked,
    ...(blocked ? { error: "initiative_not_ready" as const } : {}),
    // BI-C5D978E9: the owner reads this. The raw enum list told a shelter
    // director nothing — least of all that none of it was waiting on them.
    message: blocked
      ? describeReadinessRefusal(args.targetPhase, [...decision.blockers, ...decision.unmet])
      : `${args.target} readiness allowed.`,
    decision,
  };
}

/**
 * BI-C5D978E9 — the readiness refusal an owner actually reads.
 *
 * Returns the refusal instead of throwing it. #4761 made the phase-gate
 * refusals values for exactly this reason — a thrown Error is stripped to a
 * production digest — but this call sits one line EARLIER in advanceBuildPhase
 * and kept throwing, so the plain-language message built in #4788 never reached
 * the screen. The owner saw "Minified React error #441" instead (live repro
 * FB-EB292B9F).
 *
 * Returns null when the phase may advance.
 *
 * assertBuildPhaseInitiativeReadiness stays exported and unchanged: the
 * completion path still relies on it throwing.
 */
export async function checkBuildPhaseInitiativeReadiness(
  args: { buildId: string; currentPhase: string; targetPhase: string },
  // Test seam — the assertion is the thing being converted, so it must be
  // replaceable without standing up the whole readiness stack.
  assertReadiness: (input: typeof args) => Promise<void> = assertBuildPhaseInitiativeReadiness,
): Promise<string | null> {
  try {
    await assertReadiness(args);
    return null;
  } catch (error) {
    return error instanceof Error && error.message
      ? error.message
      : "Initiative readiness refused this transition.";
  }
}

export async function assertBuildPhaseInitiativeReadiness(args: {
  buildId: string;
  currentPhase: string;
  targetPhase: string;
}): Promise<void> {
  const target = args.currentPhase === "ideate" && args.targetPhase === "plan"
    ? "plan"
    : args.currentPhase === "plan" && args.targetPhase === "build"
      ? "implementation"
      : args.currentPhase === "review" && args.targetPhase === "ship"
        ? "implementation"
        : args.targetPhase === "complete"
          ? "completion"
          : null;
  if (!target) return;
  const readiness = await enforceBuildInitiativeReadiness({
    buildId: args.buildId,
    target,
    targetPhase: args.targetPhase,
    expectedPhase: args.currentPhase,
  });
  if (!readiness.allowed) throw new Error(readiness.message);
}
