// apps/web/lib/build/build-dispatch-effect.ts
//
// BI-EB4BB4A0: Build Studio's approved-plan dispatch runs on the absorbed T3
// core (WWMD DI-1F6CA0FA20D8), the Workroom outbox and effect worker of
// BI-C64EDA33.
//
// Before: performPlanToBuildTransition wrote `phase=build` and then called
// dispatchBuildForApprovedPlan fire-and-forget. A restart between the two
// lost the dispatch, and nothing refused a second orchestrator for the same
// build. Now the transition commits the phase write and one `dispatch-build`
// effect for the build's own Build Studio Workroom in a single transaction,
// under the deterministic command key `build-dispatch:<buildId>`. The effect
// worker runs it after the commit, after a restart, or after its lease
// expires. Running it is idempotent:
// - it does nothing when the build has left `build`;
// - it adopts a run that is already in flight;
// - it refuses a room that is not the build's own, or a dispatching user who
//   does not exist;
// - otherwise it starts the orchestrator once.
// Engine selection, residency, sensitivity and model eligibility stay with
// getBuildStudioConfig inside the run. This module only decides whether to
// start the run.
//
// Pattern: T3 Code's EffectOutbox (pingdotgg/t3code@24e77473, MIT), reproduced
// rather than copied, as in workroom-runtime/.

import type { EffectSqlDb } from "@/lib/workroom-runtime/workroom-effect-store";

export const BUILD_DISPATCH_EFFECT_KIND = "dispatch-build" as const;

/** How far back a run's own progress counts as in flight (the build-liveness window). */
export const RUN_IN_FLIGHT_WINDOW_MS = 15 * 60 * 1000;
/** The run body's start marker (runApprovedBuild); also written by pre-cutover dispatches. */
export const RUN_START_MARKER = "Dispatching build orchestrator:";
/** Activity only an orchestrator run writes. */
export const RUN_PROGRESS_TOOLS = ["engine_selection", "specialist_dispatch"] as const;

/** One dispatch per build: a replayed or concurrent request inserts nothing twice. */
export const buildDispatchCommandId = (buildId: string) => `build-dispatch:${buildId}`;

/** Statuses after which a room carries no more work (as heal-build-workroom-shape reads them). */
const ENDED_ROOM_STATUSES = ["complete", "abandoned", "archived", "superseded"];

export type BuildDispatchRoom = { id: string; capsuleId: string };

type RoomFinderDb = {
  workroom: {
    findMany(args: {
      where: Record<string, unknown>;
      take: number;
      select: { id: true; capsuleId: true };
    }): Promise<BuildDispatchRoom[]>;
  };
};

/**
 * The build's own live Build Studio room, the only room that may carry its
 * dispatch. None or more than one is no carrier: the caller refuses rather
 * than guessing.
 */
export async function findBuildDispatchRoom(
  db: RoomFinderDb,
  build: { id: string; buildId: string },
): Promise<BuildDispatchRoom | null> {
  const rooms = await db.workroom.findMany({
    where: {
      executorKind: "build-studio",
      executorRef: build.buildId,
      featureBuildId: build.id,
      archivedAt: null,
      status: { notIn: ENDED_ROOM_STATUSES },
    },
    take: 2,
    select: { id: true, capsuleId: true },
  });
  return rooms.length === 1 ? rooms[0]! : null;
}

/**
 * Owe the build's dispatch on its room. This runs inside the plan→build
 * transaction, so the phase write and the dispatch either both commit or
 * neither does.
 */
export async function oweBuildDispatch(
  tx: EffectSqlDb,
  input: { roomRowId: string; buildId: string; userId: string; now?: Date },
): Promise<void> {
  const { insertEffects } = await import("@/lib/workroom-runtime/workroom-effect-store");
  await insertEffects(tx, {
    roomRowId: input.roomRowId,
    commandId: buildDispatchCommandId(input.buildId),
    generation: null,
    effects: [{ kind: BUILD_DISPATCH_EFFECT_KIND, payload: { buildId: input.buildId, userId: input.userId } }],
    now: input.now ?? new Date(),
  });
}

// ── Running the effect ───────────────────────────────────────────────────────

export type BuildDispatchOutcome = "started" | "adopted" | "skipped" | "refused";
export type BuildDispatchEffectResult = { outcome: BuildDispatchOutcome; summary: string; via?: string };

export type BuildDispatchExecutorDeps = {
  readBuild(buildId: string): Promise<{
    id: string;
    phase: string;
    buildPlan: unknown;
    taskResults: unknown;
  } | null>;
  readRoom(roomRowId: string): Promise<{
    executorKind: string | null;
    executorRef: string | null;
    featureBuildId: string | null;
  } | null>;
  userExists(userId: string): Promise<boolean>;
  /** A run of this build is live in this process. */
  isRunning(buildId: string): boolean;
  /**
   * A run of this build recorded its own progress recently (on any process):
   * the run body's start marker, engine selection or a specialist dispatch.
   * Gate, review and transition activity never counts here. The transition
   * writes such rows just before this effect runs, and counting them would
   * adopt a run that does not exist.
   */
  runInFlight(buildId: string): Promise<boolean>;
  /** Start the run detached. It must mark the build running before it returns. */
  startRun(input: { buildId: string; userId: string }): void;
};

/**
 * Every planned task already finished. Stored results carry `outcome`, not
 * `status` (StoredTaskResult in build-orchestrator.ts). The old guard in
 * dispatchBuildForApprovedPlan read `status` and so never skipped.
 */
export function allPlannedTasksDone(buildPlan: unknown, taskResults: unknown): boolean {
  const planned = (buildPlan as { tasks?: Array<{ title?: unknown }> } | null)?.tasks;
  const stored = (taskResults as { tasks?: Array<{ title?: unknown; outcome?: unknown }> } | null)?.tasks;
  if (!Array.isArray(planned) || planned.length === 0 || !Array.isArray(stored)) return false;
  const done = new Set(stored
    .filter((t) => t.outcome === "DONE" || t.outcome === "DONE_WITH_CONCERNS")
    .map((t) => String(t.title)));
  return planned.every((t) => done.has(String(t.title)));
}

/**
 * Run one `dispatch-build` effect. It never starts a second run of a build and
 * never throws for a decision: a refusal is a settled result with its reason,
 * read back in the room log. A thrown error is infrastructure, and the
 * worker's backoff retries it.
 */
export async function executeBuildDispatchEffect(
  effect: { workCapsuleId: string; payload: Record<string, unknown> },
  deps: BuildDispatchExecutorDeps,
): Promise<BuildDispatchEffectResult> {
  const buildId = typeof effect.payload["buildId"] === "string" ? effect.payload["buildId"] : "";
  const userId = typeof effect.payload["userId"] === "string" ? effect.payload["userId"] : "";
  if (!buildId || !userId) {
    return { outcome: "refused", summary: "Build dispatch refused: the effect names no build or no dispatching user." };
  }

  const build = await deps.readBuild(buildId);
  if (!build) return { outcome: "refused", summary: `Build dispatch refused: ${buildId} does not exist.` };

  // Authority: only the build's own Build Studio room carries its dispatch.
  const room = await deps.readRoom(effect.workCapsuleId);
  if (!room || room.executorKind !== "build-studio" || room.executorRef !== buildId || room.featureBuildId !== build.id) {
    return { outcome: "refused", summary: `Build dispatch refused: this room does not carry ${buildId}.` };
  }

  if (build.phase !== "build") {
    return { outcome: "skipped", summary: `Build dispatch for ${buildId} not needed: the build is in ${build.phase}, not build.` };
  }

  // Authority: the run acts with the dispatching user's access; without that user it would run with no tools (BI-937E106A).
  if (!(await deps.userExists(userId))) {
    return { outcome: "refused", summary: `Build dispatch refused for ${buildId}: the dispatching user no longer exists.` };
  }

  // Single dispatch: adopt a run already in flight instead of starting a second orchestrator.
  if (deps.isRunning(buildId)) {
    return { outcome: "adopted", via: "in-process", summary: `Build ${buildId} is already running here; adopted it instead of starting another run.` };
  }
  if (await deps.runInFlight(buildId)) {
    return { outcome: "adopted", via: "run-activity", summary: `A run of build ${buildId} recorded its own progress in the last 15 minutes; adopted it instead of starting another.` };
  }
  if (allPlannedTasksDone(build.buildPlan, build.taskResults)) {
    return { outcome: "skipped", summary: `Build dispatch for ${buildId} not needed: every task is already complete.` };
  }

  deps.startRun({ buildId, userId });
  return { outcome: "started", summary: `Dispatched build ${buildId} to the build orchestrator.` };
}
