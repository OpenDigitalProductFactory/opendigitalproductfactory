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
  // Check manage_capabilities for running tests
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_capabilities")) {
    throw new Error("Running tests requires manage_capabilities permission");
  }

  const { runEndpointTests } = await import("@/lib/endpoint-test-runner");
  return runEndpointTests({
    endpointId,
    probesOnly,
    triggeredBy: userId,
  });
}
