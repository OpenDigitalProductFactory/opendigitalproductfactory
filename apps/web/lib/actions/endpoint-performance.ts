"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";

async function requireViewAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

export async function getEndpointPerformance(endpointId: string) {
  await requireViewAccess();

  const [performances, recentEvals, testRuns, profile] = await Promise.all([
    prisma.endpointTaskPerformance.findMany({
      where: { endpointId },
      orderBy: { taskType: "asc" },
    }),
    prisma.taskEvaluation.findMany({
      where: { endpointId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        taskType: true,
        qualityScore: true,
        humanScore: true,
        taskContext: true,
        evaluationNotes: true,
        routeContext: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.endpointTestRun.findMany({
      where: { endpointId },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    prisma.modelProfile.findFirst({
      where: { providerId: endpointId },
      select: {
        friendlyName: true,
        capabilityTier: true,
        codingCapability: true,
        instructionFollowing: true,
        bestFor: true,
        avoidFor: true,
      },
    }),
  ]);

  return {
    performances: JSON.parse(JSON.stringify(performances)),
    recentEvals: JSON.parse(JSON.stringify(recentEvals)),
    testRuns: JSON.parse(JSON.stringify(testRuns)),
    profile,
  };
}

export async function triggerEndpointTests(endpointId: string, probesOnly: boolean = false) {
  const userId = await requireViewAccess();
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_capabilities")) {
    throw new Error("Running tests requires manage_capabilities permission");
  }

  // Fire-and-forget via Inngest — returns immediately to the UI
  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "ai/probe.run",
    data: { endpointId, probesOnly, userId },
  });

  return { queued: true, message: probesOnly ? "Probes running in background..." : "Full tests running in background..." };
}

export async function getRoutingProfile(endpointId: string) {
  await requireViewAccess();

  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: endpointId },
    select: {
      reasoning: true,
      codegen: true,
      toolFidelity: true,
      instructionFollowing: true,
      structuredOutput: true,
      conversational: true,
      contextRetention: true,
      profileSource: true,
      profileConfidence: true,
      evalCount: true,
      lastEvalAt: true,
      supportsToolUse: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      maxContextTokens: true,
    },
  });

  return provider ? JSON.parse(JSON.stringify(provider)) : null;
}

export async function getRoutingProfiles(endpointId: string) {
  await requireViewAccess();

  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: endpointId },
    select: {
      modelId: true,
      friendlyName: true,
      reasoning: true,
      codegen: true,
      toolFidelity: true,
      instructionFollowingScore: true,
      structuredOutputScore: true,
      conversational: true,
      contextRetention: true,
      profileSource: true,
      profileConfidence: true,
      evalCount: true,
      lastEvalAt: true,
      maxContextTokens: true,
      supportsToolUse: true,
      modelStatus: true,
      retiredAt: true,
    },
    orderBy: [{ modelStatus: "asc" }, { reasoning: "desc" }],
  });

  return JSON.parse(JSON.stringify(profiles));
}

export async function getRecentRouteDecisions(endpointId?: string, limit = 20) {
  await requireViewAccess();

  const decisions = await prisma.routeDecisionLog.findMany({
    where: endpointId ? { selectedEndpointId: endpointId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      taskType: true,
      selectedEndpointId: true,
      sensitivity: true,
      reason: true,
      fitnessScore: true,
      policyRulesApplied: true,
      shadowMode: true,
      createdAt: true,
    },
  });

  return JSON.parse(JSON.stringify(decisions));
}

export async function triggerDimensionEval(endpointId: string, modelId?: string) {
  const userId = await requireViewAccess();
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_capabilities")) {
    throw new Error("Running dimension eval requires manage_capabilities permission");
  }

  if (modelId) {
    // Fire-and-forget via Inngest — returns immediately to the UI
    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({
      name: "ai/eval.run",
      data: { endpointId, modelId, userId },
    });

    return { queued: true, message: "Eval running in background..." };
  } else {
    // All-model eval: fire one event per active model
    const { prisma } = await import("@dpf/db");
    const profiles = await prisma.modelProfile.findMany({
      where: { modelStatus: "active" },
      select: { modelId: true },
    });
    const { inngest } = await import("@/lib/queue/inngest-client");
    for (const p of profiles) {
      await inngest.send({
        name: "ai/eval.run",
        data: { endpointId, modelId: p.modelId, userId },
      });
    }
    return { queued: true, message: `${profiles.length} eval(s) running in background...` };
  }
}
