// POST /api/agent/build/advance-phase — manually advance a build to the next phase.
// Admin-only endpoint for advancing builds when the orchestrator completes but
// does not auto-advance (e.g. build already finished before this fix was deployed).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  canTransitionPhase,
  normalizeHappyPathState,
  type BuildDeliberationSummary,
  type BuildPhase,
  type ReviewResult,
} from "@/lib/feature-build-types";
import { checkBuildPhaseGate } from "@/lib/work-posture/verification-depth-gate";
import { evaluateBuildStudioPlanAdvancementGate } from "@/lib/decision-perspective/build-studio-gate";
import { resolvePlannedFilePaths } from "@/lib/decision-perspective/planned-file-paths";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_platform",
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const buildId = body?.buildId as string | undefined;
  const targetPhase = body?.targetPhase as BuildPhase | undefined;

  if (!buildId || !targetPhase) {
    return NextResponse.json(
      { error: "buildId and targetPhase are required" },
      { status: 400 },
    );
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      phase: true,
      kind: true,
      brief: true,
      originatingBacklogItemId: true,
      draftApprovedAt: true,
      designDoc: true,
      designReview: true,
      plan: true,
      buildPlan: true,
      planReview: true,
      verificationOut: true,
      acceptanceMet: true,
      uxTestResults: true,
      uxVerificationStatus: true,
      deliberationSummary: true,
      threadId: true,
    },
  });

  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  const currentPhase = build.phase as BuildPhase;
  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });

  const requiresStartApproval =
    build.originatingBacklogItemId != null
    && build.draftApprovedAt == null
    && (
      (currentPhase === "ideate" && targetPhase === "plan")
      || (currentPhase === "plan" && targetPhase === "build")
    );

  if (requiresStartApproval) {
    return NextResponse.json(
      {
        error:
          currentPhase === "ideate"
            ? "Approve Start before moving this governed backlog draft into planning."
            : "Approve Start before moving this backlog-linked draft into implementation.",
      },
      { status: 422 },
    );
  }

  if (!canTransitionPhase(currentPhase, targetPhase)) {
    return NextResponse.json(
      { error: `Cannot transition from ${currentPhase} to ${targetPhase}` },
      { status: 422 },
    );
  }

  const advanceBrief = build.brief as { fixContext?: import("@/lib/feature-build-types").FixContext } | null;
  const advancePlan = (build.plan as Record<string, unknown> | null) ?? {};
  const gate = await checkBuildPhaseGate({
    buildId,
    from: currentPhase,
    to: targetPhase,
    evidence: {
      kind: build.kind,
      processSize: (advancePlan.processSize as string | undefined) ?? "medium",
      fixContext: advanceBrief?.fixContext,
      designDoc: build.designDoc,
      designReview: build.designReview,
      happyPathState: normalizeHappyPathState(advancePlan.happyPathState ?? null),
      buildPlan: build.buildPlan,
      planReview: build.planReview,
      verificationOut: build.verificationOut,
      acceptanceMet: build.acceptanceMet,
      uxTestResults: build.uxTestResults,
      uxVerificationStatus: build.uxVerificationStatus,
    },
  });

  if (!gate.allowed) {
    return NextResponse.json(
      { error: gate.reason ?? "Phase gate check failed", gate },
      { status: 422 },
    );
  }

  if (currentPhase === "plan" && targetPhase === "build") {
    const decisionGate = await evaluateBuildStudioPlanAdvancementGate({
      db: prisma,
      build: {
        buildId: build.buildId,
        title: build.title,
        phase: currentPhase,
        planReview: build.planReview as ReviewResult | null,
        deliberationSummary: build.deliberationSummary as BuildDeliberationSummary | null,
      },
      triggeredByUserId: user.id ?? null,
      // BI-70280889: hand the gate the paths this phase intends to touch so the
      // impacted acumens are actually consulted. Fails open to [] — the gate
      // then behaves exactly as it did before.
      plannedFilePaths: await resolvePlannedFilePaths({
        db: prisma,
        buildId: build.buildId,
        buildRowId: build.id,
      }),
    });
    if (!decisionGate.allowed) {
      return NextResponse.json(
        {
          error: decisionGate.operatorMessage,
          decisionInteraction: {
            interactionId: decisionGate.interactionId,
            outcomeType: decisionGate.evaluation.outcomeType,
            confidenceScore: decisionGate.evaluation.confidenceScore,
            coverageGap: decisionGate.evaluation.coverageGap,
            principleConflict: decisionGate.evaluation.principleConflict,
          },
        },
        { status: 422 },
      );
    }
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: targetPhase },
  });

  // Best-effort: emit event so the UI updates in real time
  try {
    if (build.threadId) {
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      agentEventBus.emit(build.threadId, {
        type: "phase:change",
        buildId,
        phase: targetPhase,
      });
    }
  } catch { /* best-effort */ }

  // Best-effort: log activity
  prisma.buildActivity
    .create({
      data: {
        buildId,
        tool: "phase:advance",
        summary: `Phase manually advanced: ${currentPhase} -> ${targetPhase}`,
      },
    })
    .catch(() => {});

  return NextResponse.json({
    success: true,
    buildId,
    from: currentPhase,
    to: targetPhase,
  });
}
