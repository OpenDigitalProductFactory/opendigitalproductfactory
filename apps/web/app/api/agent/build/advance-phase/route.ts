// POST /api/agent/build/advance-phase — manually advance a build to the next phase.
// Admin-only endpoint for advancing builds when the orchestrator completes but
// does not auto-advance (e.g. build already finished before this fix was deployed).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  canTransitionPhase,
  checkPhaseGate,
  type BuildPhase,
} from "@/lib/feature-build-types";

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
      phase: true,
      originatingBacklogItemId: true,
      draftApprovedAt: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      verificationOut: true,
      acceptanceMet: true,
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

  const gate = checkPhaseGate(currentPhase, targetPhase, {
    designDoc: build.designDoc,
    designReview: build.designReview,
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
  });

  if (!gate.allowed) {
    return NextResponse.json(
      { error: gate.reason ?? "Phase gate check failed", gate },
      { status: 422 },
    );
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
