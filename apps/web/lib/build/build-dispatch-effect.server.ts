// apps/web/lib/build/build-dispatch-effect.server.ts
//
// BI-EB4BB4A0: the I/O side of the `dispatch-build` Workroom effect. The
// decision rules live in build-dispatch-effect.ts, which has no I/O.
//
// Only instrumentation.ts (at boot) and the admin test route import this
// file. The Workroom runtime reaches it through the effect-executor registry,
// never by import, so neither the runtime nor the plan→build transition joins
// the build/MCP import graph through it.

import type { BuildDispatchExecutorDeps } from "./build-dispatch-effect";

/** Boot: register the `dispatch-build` executor with the Workroom runtime's effect worker. */
export async function registerBuildDispatchExecutor(): Promise<void> {
  const { registerEffectExecutor } = await import("@/lib/workroom-runtime/effect-executors");
  const { executeBuildDispatchEffect } = await import("./build-dispatch-effect");
  registerEffectExecutor("dispatch-build", async (effect) => ({ ...(await executeBuildDispatchEffect(effect, await productionBuildDispatchDeps())) }));
}

/** The production dependencies: Prisma reads, the in-process run registry, and the approved-plan run. */
export async function productionBuildDispatchDeps(): Promise<BuildDispatchExecutorDeps> {
  const { prisma } = await import("@dpf/db");
  const liveness = await import("@/lib/build/build-liveness");
  const { runApprovedBuild } = await import("@/lib/build/build-on-plan-approval");
  return {
    readBuild: (buildId) =>
      prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true, phase: true, buildPlan: true, taskResults: true } }),
    readRoom: (roomRowId) =>
      prisma.workroom.findUnique({
        where: { id: roomRowId },
        select: { executorKind: true, executorRef: true, featureBuildId: true },
      }),
    userExists: async (userId) => Boolean(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })),
    isRunning: (buildId) => liveness.isOrchestrationRunning(buildId),
    recentlyActive: async (buildId) => (await liveness.recentlyActiveBuildIds(prisma, [buildId], new Date())).has(buildId),
    startRun: ({ buildId, userId }) => {
      // withOrchestrationRunning marks the build before its first await, so a
      // dispatch claimed right after this one adopts the run instead of doubling it.
      void liveness
        .withOrchestrationRunning(buildId, () => runApprovedBuild({ buildId, userId }))
        .catch((error: unknown) => console.error("[build-dispatch] run failed:", { buildId }, error));
    },
  };
}

export type BuildDispatchRequest =
  | { kind: "owed"; capsuleId: string }
  | { kind: "refused"; reason: string };

/**
 * Owe the dispatch of a build that is already in `build`, for callers outside
 * the plan→build transition. The deterministic key makes a repeated request a
 * no-op, never a second run. A build still in `plan` is refused: only the
 * transition moves the phase, with its gates.
 */
export async function requestBuildDispatch(input: { buildId: string; userId: string }): Promise<BuildDispatchRequest> {
  const { prisma } = await import("@dpf/db");
  const { findBuildDispatchRoom, oweBuildDispatch } = await import("./build-dispatch-effect");
  const build = await prisma.featureBuild.findUnique({ where: { buildId: input.buildId }, select: { id: true, buildId: true, phase: true } });
  if (!build) return { kind: "refused", reason: `Build ${input.buildId} not found.` };
  if (build.phase !== "build") {
    return { kind: "refused", reason: `Build ${input.buildId} is in ${build.phase}; it reaches build only through the plan→build transition.` };
  }
  const room = await findBuildDispatchRoom(prisma, build);
  if (!room) return { kind: "refused", reason: `No single live Build Studio Workroom carries ${input.buildId}.` };
  await prisma.$transaction(async (tx) => {
    await oweBuildDispatch(tx, { roomRowId: room.id, buildId: build.buildId, userId: input.userId });
  });
  const { kickWorkroomEffects } = await import("@/lib/workroom-runtime/effect-executors");
  kickWorkroomEffects();
  return { kind: "owed", capsuleId: room.capsuleId };
}
