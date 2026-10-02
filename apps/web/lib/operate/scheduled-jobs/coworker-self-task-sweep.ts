// Coworker self-task reconciliation sweep (BI-4CE4F52F slice 2).
//
// Split out of coworker-self-tasks.ts, which holds the REGISTRY — what each
// coworker's standing unit of work is — and had reached its 800-LOC ceiling.
// This module holds the hourly RECONCILIATION: who should currently be running,
// at what pace, and who owns the task. The same seam already separates
// coworker-standing-self-tasks.ts (a registry) from the code that acts on it.
//
// Called from queue/functions/agent-task-dispatch.ts as
// "reconcile-coworker-self-tasks-hourly".

import { prisma } from "@dpf/db";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { isProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  PROACTIVITY_FACT_CATEGORY,
  PROACTIVITY_OVERRIDE_FACT_PREFIX,
} from "@/lib/proactivity/proactivity-override-preferences";
import { roomOwnedLevelFor, enumerateRoomOwnedCoworkers } from "./room-owned-cadence";
import {
  coworkerSelfTaskId,
  reconcileCoworkerSelfTask,
  selfTaskRegistryKey,
} from "./coworker-self-tasks";

// The periodic sweep below converges both directions from the UserFact, which is
// the operator's expressed intent. It is additive and non-destructive: it creates
// missing tasks, deactivates tasks a now-quiet toggle should stop, and — for an
// orphaned task with no fact — RESTORES the toggle from the task's cadence rather
// than silently stopping the coworker.

const PROACTIVITY_AGENT_KEY_PREFIX = `${PROACTIVITY_OVERRIDE_FACT_PREFIX}:agent:`;

/** Parse the persisted proactivity fact value → its level, or null if unreadable. */
function readSelfTaskFactLevel(value: string | null | undefined): ProactivityLevel | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { level?: unknown };
    return isProactivityLevel(parsed.level) ? parsed.level : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort level a self-task's cadence implies, for healing an orphaned task
 * (Direction B). A daily cron (day-of-week wildcard) is Assertive; anything
 * narrower is Balanced. Sub-daily Assertive cadences (e.g. twice-weekly) infer
 * Balanced — acceptable for a rare heal case; the operator can re-toggle.
 */
export function inferLevelFromSelfTaskSchedule(schedule: string): ProactivityLevel {
  const fields = schedule.trim().split(/\s+/);
  return fields[4] === "*" ? "assertive" : "balanced";
}

export type ReconcileAllSelfTasksResult = {
  /** Missing self-tasks created for an active non-quiet fact (Direction A). */
  created: number;
  /**
   * Coworkers driven by their ROOMS ALONE — a live room carries their standing
   * work and declared a pace, and no legacy agent-scoped fact exists for them.
   *
   * Before BI-4CE4F52F slice 2 these coworkers were invisible to this sweep: it
   * enumerated from the facts, so holding one was the hidden precondition for
   * being switched on at all. This counter is the population that precondition
   * used to exclude.
   */
  roomOnly: number;
  /** Rooms declared a pace, but no owning user could be resolved for the task. */
  ownerless: number;
  /** Live self-tasks stood down because the toggle is now quiet (Direction A). */
  deactivated: number;
  /**
   * Coworkers whose pace still came from an agent-scoped fact because no live
   * room carries their standing work.
   *
   * The residual dependency on facts no operator can write. Zero means the
   * fallback is dead code and can be removed.
   */
  unroomedFallback: number;
  /**
   * Live self-tasks running with no backing fact (Direction B).
   *
   * OBSERVED, NOT REPAIRED — see the Direction B block. Under the room-owned
   * ruling (DI-81E47BDA59F1) an agent-scoped proactivity fact is no longer a
   * source of truth, so minting one to "repair" an orphan would manufacture
   * inert data. The task is left running and counted.
   */
  orphansObserved: number;
};

/**
 * Converge every coworker self-task with its owner's current Proactivity toggle.
 * Safe to run on a cadence: it only creates missing tasks, deactivates tasks a
 * quiet toggle should stop, and restores a missing toggle from an orphaned task —
 * it never perturbs the schedule of a task that is already correctly active.
 */
/**
 * Converge ONE coworker's self-task onto a resolved level.
 *
 * Both enumeration stages below end in exactly this step, so it lives once: a
 * quiet level stands a running task down, any other level schedules a missing
 * one, and an already-active task is left alone so the sweep never churns its
 * nextRunAt. Returns the taskId so the caller can mark it as legitimately
 * active for the orphan pass.
 */
async function applySelfTaskLevel(
  userId: string,
  agentId: string,
  level: ProactivityLevel,
  result: ReconcileAllSelfTasksResult,
): Promise<string | null> {
  const taskId = coworkerSelfTaskId(agentId, userId);
  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
    select: { isActive: true },
  });

  if (level === "quiet") {
    if (existing?.isActive) {
      await reconcileCoworkerSelfTask(userId, agentId, "quiet");
      result.deactivated++;
    }
    return null;
  }

  if (!existing?.isActive) {
    await reconcileCoworkerSelfTask(userId, agentId, level);
    result.created++;
  }
  return taskId;
}

export async function reconcileAllCoworkerSelfTasks(): Promise<ReconcileAllSelfTasksResult> {
  const result: ReconcileAllSelfTasksResult = {
    created: 0, deactivated: 0, orphansObserved: 0, unroomedFallback: 0, roomOnly: 0, ownerless: 0,
  };

  // Direction A — every active Proactivity fact for a REGISTERED coworker should
  // have a matching self-task (create when missing; stand down when quiet).
  const facts = await prisma.userFact.findMany({
    where: {
      category: PROACTIVITY_FACT_CATEGORY,
      key: { startsWith: PROACTIVITY_AGENT_KEY_PREFIX },
      supersededAt: null,
    },
    select: { userId: true, key: true, value: true },
  });

  // (taskId) that legitimately SHOULD be active — used to spot orphans below.
  const desiredActive = new Set<string>();
  // Registry keys a fact already spoke for. A fact-backed coworker keeps its
  // EXISTING owner and therefore its existing taskId, even when a room now sets
  // its pace: re-deriving the owner from the room would mint a second task under
  // a different id and orphan the one that is running.
  const factCoveredAgents = new Set<string>();

  for (const fact of facts) {
    // The fact may be written under either id form — the roster reaches the
    // operator with the canonical one for a dual-seeded coworker (BI-B05E5D30).
    const agentId = selfTaskRegistryKey(fact.key.slice(PROACTIVITY_AGENT_KEY_PREFIX.length));
    if (!agentId) continue;

    // ROOM FIRST (DI-81E47BDA59F1). The rooms carrying this coworker's standing
    // work own its pace; the agent-scoped fact is the fallback, not the source.
    //
    // The fact is still read where no live room carries the coworker — the case
    // the ruling left open — and every such coworker is COUNTED as
    // `unroomedFallback`. That count is the residual dependency on facts no
    // operator can write (BI-4CE4F52F), made visible rather than hidden: when it
    // reaches zero the fallback can be deleted outright.
    const roomLevel = await roomOwnedLevelFor(agentId);
    const level = roomLevel ?? readSelfTaskFactLevel(fact.value);
    if (!level) continue;
    if (roomLevel === null) result.unroomedFallback++;

    factCoveredAgents.add(agentId);

    const taskId = await applySelfTaskLevel(fact.userId, agentId, level, result);
    if (taskId) desiredActive.add(taskId);
  }

  // Direction A2 — coworkers the ROOMS drive, with no legacy fact (BI-4CE4F52F
  // slice 2, the read-side retirement).
  //
  // Direction A above can only reach a coworker that already holds an
  // `aiCoworkerProactivity:agent:*` fact, because that is what it enumerates.
  // Those facts are unwritable — BI-87C9C91C removed the control and its save
  // path — so "has a surviving fact row" had become the real precondition for a
  // coworker being schedulable. That is the gap this stage closes: a live room
  // carrying the work and declaring a pace is now sufficient, which is what
  // DI-81E47BDA59F1 ruled cadence to be.
  //
  // This stage is ADDITIVE ON PURPOSE. It never revisits a fact-covered agent,
  // so no existing coworker's pace, owner or taskId changes here; it only adds
  // coworkers that nothing could previously switch on.
  const roomOwned = await enumerateRoomOwnedCoworkers();
  result.ownerless = roomOwned.ownerlessAgentIds.length;
  if (roomOwned.ownerlessAgentIds.length > 0) {
    console.warn(
      "[coworker-self-tasks] rooms declare a pace for these coworkers but no owning "
        + "user resolves, so no self-task can be keyed — seeding defect, not a quiet coworker",
      { agentIds: roomOwned.ownerlessAgentIds },
    );
  }
  for (const candidate of roomOwned.coworkers) {
    const agentId = selfTaskRegistryKey(candidate.agentId);
    if (!agentId) continue;
    if (factCoveredAgents.has(agentId)) continue;
    result.roomOnly++;

    const taskId = await applySelfTaskLevel(
      candidate.ownerUserId, agentId, candidate.level, result,
    );
    if (taskId) desiredActive.add(taskId);
  }

  // Direction B — an active self-task with no backing active fact.
  //
  // This block used to MINT a fresh `aiCoworkerProactivity:agent:*` fact from
  // the task's cron, "so the UI tells the truth". There is no such UI:
  // BI-87C9C91C removed the per-coworker Proactivity control, deleted its save
  // path, removed the `agent:` scope from the resolver ladder, and recorded
  // that existing agent-scoped facts are "left untouched and inert". This
  // reconciler kept reading and WRITING them anyway — hourly — so the inert
  // population grew after the migration that declared it inert, and a
  // coworker's cadence was governed by a fact no operator could change
  // (BI-4CE4F52F).
  //
  // Ruling: cadence is room-owned (DI-81E47BDA59F1, margin 1.67, high
  // confidence). An agent-scoped fact is therefore not a source of truth, and
  // minting one repairs nothing — it manufactures data no surface can act on.
  //
  // The orphan is COUNTED and LEFT RUNNING. Deactivating it here would freeze
  // or silence standing work on the strength of a missing fact that is no
  // longer authoritative, which BI-4CE4F52F explicitly warns against. Removing
  // Direction A's dependence on these facts is the next slice; this one stops
  // the growth without changing who runs.
  const liveSelfTasks = await prisma.scheduledAgentTask.findMany({
    where: { isActive: true, taskId: { startsWith: "self-" } },
    select: { taskId: true, agentId: true, ownerUserId: true, schedule: true },
  });
  for (const task of liveSelfTasks) {
    if (desiredActive.has(task.taskId)) continue;
    result.orphansObserved++;
    console.info(
      "[coworker-self-tasks] self-task running with no backing proactivity fact — "
        + "observed, not repaired (BI-4CE4F52F; cadence is room-owned per DI-81E47BDA59F1)",
      { taskId: task.taskId, agentId: task.agentId },
    );
  }

  return result;
}
