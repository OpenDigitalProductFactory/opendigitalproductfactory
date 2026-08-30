import "server-only";

import { prisma } from "@dpf/db";
import type { VerificationDepth } from "@/lib/golden-triangle";
import type { BuildPhase, PhaseGateResult } from "@/lib/feature-build-types";
import { checkPhaseGate } from "@/lib/feature-build-types";
import {
  evaluateVerificationDepthShadow,
  type VerificationDepthShadowDecision,
} from "@/lib/explore/verification-depth-shadow";
import { deriveWorkroomShape } from "@/lib/work-management/derive-workroom-shape";
import { loadWorkroomPostureContext } from "@/lib/work-management/room-posture.server";
import { resolveWorkroomPosture } from "@/lib/work-management/room-posture";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { readWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";

export type VerificationDepthShadowRecord = VerificationDepthShadowDecision & {
  buildId: string;
  actualAllowed: boolean;
  wouldNewlyBlock: boolean;
};

type GateDeps = {
  resolveDepth: (buildId: string) => Promise<VerificationDepth | undefined>;
  record: (decision: VerificationDepthShadowRecord) => Promise<void>;
};

/** Resolve the already-existing work-posture depth for the room linked to a build. */
export async function resolveBuildVerificationDepth(
  buildId: string,
): Promise<VerificationDepth | undefined> {
  const room = await prisma.workroom.findFirst({
    where: { featureBuild: { buildId }, archivedAt: null },
    select: {
      scopeClaims: true,
      activityKind: true,
      decisionScope: true,
      workItem: { select: { assignedToAgentId: true, dueAt: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!room) return undefined;

  const now = new Date();
  const context = await loadWorkroomPostureContext({
    sourceType: "build",
    sourceId: buildId,
    assignedToAgentId: room.workItem?.assignedToAgentId ?? null,
    now,
  });
  const shapeKey = readWorkroomShapeClaim(room.scopeClaims)
    ?? deriveWorkroomShape({
      activityKind: room.activityKind,
      decisionScope: room.decisionScope,
      mode: "finite",
    })?.shape
    ?? null;
  return resolveWorkroomPosture({
    shapeKey,
    activityKind: room.activityKind,
    mode: "finite",
    cycleActive: true,
    dueAt: room.workItem?.dueAt?.toISOString() ?? null,
    declaration: readWorkroomPostureClaim(room.scopeClaims),
  }, context, now)?.verificationDepth;
}

async function recordVerificationDepthShadow(
  decision: VerificationDepthShadowRecord,
): Promise<void> {
  await prisma.buildActivity.create({
    data: {
      buildId: decision.buildId,
      tool: "verification-depth-shadow",
      summary: JSON.stringify(decision),
    },
  });
}

const liveDeps: GateDeps = {
  resolveDepth: resolveBuildVerificationDepth,
  record: recordVerificationDepthShadow,
};

/**
 * Phase 2 transition seam: resolve depth, evaluate and record the shadow
 * decision, then return the unchanged lifecycle-policy verdict.
 */
export async function checkBuildPhaseGate(
  input: {
    buildId: string;
    from: BuildPhase;
    to: BuildPhase;
    evidence: Record<string, unknown>;
  },
  deps: GateDeps = liveDeps,
): Promise<PhaseGateResult> {
  let depth: VerificationDepth | undefined;
  try {
    depth = await deps.resolveDepth(input.buildId);
  } catch (error) {
    console.warn("[verification-depth-shadow] posture resolution failed:", (error as Error).message);
  }
  const evidence = { ...input.evidence, verificationDepth: depth };
  const actual = checkPhaseGate(input.from, input.to, evidence);
  const shadow = evaluateVerificationDepthShadow(input.from, input.to, evidence);
  try {
    await deps.record({
      buildId: input.buildId,
      ...shadow,
      actualAllowed: actual.allowed,
      wouldNewlyBlock: actual.allowed && shadow.wouldBlock,
    });
  } catch (error) {
    console.warn("[verification-depth-shadow] record failed:", (error as Error).message);
  }
  return actual;
}
