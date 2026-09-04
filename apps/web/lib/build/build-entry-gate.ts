import { describeReadinessRefusal } from "@/lib/build/readiness-refusal-message";
import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  projectBacklogItemReadiness,
  readinessRequirement,
  type InitiativeReadinessActivity,
  type InitiativeReadinessDecision,
  type ReadinessTarget,
} from "@/lib/backlog/initiative-readiness";

type BuildEntryGateDb = {
  featureBuild: { findUnique(args: unknown): Promise<any> };
  backlogItemActivity: { create(args: unknown): Promise<any> };
  buildActivity: { create(args: unknown): Promise<any> };
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

function codes(decision: InitiativeReadinessDecision) {
  return [...decision.blockers, ...decision.unmet].map((entry) => entry.code);
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
      originator: {
        select: {
          id: true, itemId: true, type: true, source: true, workType: true, scopeKind: true,
          archetypeCategories: true, archetypeIds: true,
          activities: {
            where: { kind: { in: ["initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage"] } },
            orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
            take: 100,
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

  const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
    item: { ...build.originator, activeBuildKind: build.kind },
    activities: build.originator.activities as InitiativeReadinessActivity[],
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
