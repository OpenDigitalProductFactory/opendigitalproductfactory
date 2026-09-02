import "server-only";

/**
 * EP-WORK-POSTURE (BI-27C8484F) — the seam that makes a scheduled tick resolve
 * its posture through the ROOM ladder.
 *
 * THE DEFECT THIS CLOSES. `scheduled-work-trigger.ts` recorded why a job exists
 * — its trigger kind, the room it serves, the obligation it races — and shipped
 * with tests, and had ZERO importers in the execution path. Meanwhile
 * `executeScheduledAgentTask` resolved proactivity from the identity ladder and
 * never mentioned a room. So an operator could tighten a room's posture, watch a
 * scheduled turn fire inside that room, and see the untightened behaviour with no
 * signal that the declaration had been ignored.
 *
 * WHAT THIS DOES NOT DO. It does not decide anything, and it does not add a
 * second ladder. `resolveWorkPosture` remains the only place a posture is
 * judged; this module assembles its inputs for one caller. The scheduler's own
 * resolved plan is handed in as the INHERITED baseline, so the room's layers sit
 * on top of what the scheduler actually resolved rather than on top of a second,
 * separately-derived baseline that could disagree with it.
 *
 * TIGHTEN-ONLY, ASSERTED HERE. `resolveWorkPosture` already enforces the
 * invariant internally, but this is a new call site on the hot path for
 * unattended work, so the boundary is re-checked against the inherited plan
 * before it is returned. A widening result is dropped rather than applied — a
 * scheduled job must never be able to acquire more authority than the coworker
 * already had by virtue of running in a room.
 *
 * FAIL-OPEN. Every failure returns null, which leaves the caller on exactly
 * today's behaviour. A posture lookup must never stop a scheduled job running.
 */
import { prisma } from "@dpf/db";

import { deriveWorkroomShape } from "@/lib/work-management/derive-workroom-shape";
import { resolveWorkroomPosture, type WorkroomPostureView } from "@/lib/work-management/room-posture";
import { loadWorkroomPostureContext } from "@/lib/work-management/room-posture.server";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { readWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { resolveProactivityPlanForLevel } from "@/lib/proactivity/proactivity-resolver";
import { resolveUserAwareProactivityPlan } from "@/lib/proactivity/proactivity-resolver.server";
import type { ProactivityPlan, ProactivityResolverInput } from "@/lib/proactivity/proactivity-types";
import { tightenActionBoundary } from "@/lib/work-posture";

import {
  readScheduledWorkTrigger,
  temporalInputForTrigger,
  type ScheduledWorkTrigger,
} from "./scheduled-work-trigger";

export interface ScheduledTickPlan {
  /** The plan the run executes at — the inherited plan, moved by the room. */
  plan: ProactivityPlan;
  /** The room's effective posture, or null when this job serves no room. */
  posture: WorkroomPostureView | null;
  /** The recorded trigger, or null when the task records none. */
  trigger: ScheduledWorkTrigger | null;
}

/**
 * The ONE question `executeScheduledAgentTask` asks about pace: what plan should
 * this tick run at? Answered by the identity ladder, then moved by the room's
 * ladder when the job serves a room. Keeping both halves behind one entry point
 * stops the scheduler orchestrating two resolvers and having to know which wins.
 */
export async function resolveScheduledTickPlan(input: {
  userId: string;
  taskConfig: unknown;
  agentId: string;
  routeContext: string | null;
  now: Date;
}): Promise<ScheduledTickPlan> {
  const resolverInput: ProactivityResolverInput = {
    activityFamily: "scheduled-task",
    agentId: input.agentId,
    routeContext: input.routeContext ?? undefined,
  };
  const inheritedPlan = await resolveUserAwareProactivityPlan({
    userId: input.userId,
    input: resolverInput,
  });
  const room = await resolveScheduledTickPosture({
    taskConfig: input.taskConfig,
    resolverInput,
    inheritedPlan,
    now: input.now,
  });
  return {
    plan: room?.plan ?? inheritedPlan,
    posture: room?.posture ?? null,
    trigger: room?.trigger ?? null,
  };
}

interface ScheduledTickPosture {
  trigger: ScheduledWorkTrigger;
  posture: WorkroomPostureView;
  plan: ProactivityPlan;
}

/**
 * Resolve a scheduled tick's posture through the room that the job serves.
 *
 * Returns null — meaning "keep today's behaviour" — when the task records no
 * trigger, the trigger names no room, the room is gone, or the posture context
 * cannot be established. The room ladder never invents a room.
 */
async function resolveScheduledTickPosture(input: {
  taskConfig: unknown;
  resolverInput: ProactivityResolverInput;
  /** The plan the scheduler already resolved. Becomes the inherited baseline. */
  inheritedPlan: ProactivityPlan;
  now: Date;
}): Promise<ScheduledTickPosture | null> {
  try {
    const trigger = readScheduledWorkTrigger(input.taskConfig);
    if (!trigger?.workroomId) return null;

    const room = await prisma.workroom.findFirst({
      where: {
        archivedAt: null,
        OR: [{ capsuleId: trigger.workroomId }, { id: trigger.workroomId }],
      },
      select: {
        scopeClaims: true,
        activityKind: true,
        decisionScope: true,
        workItem: { select: { assignedToAgentId: true, dueAt: true } },
      },
    });
    if (!room) return null;

    const context = await loadWorkroomPostureContext({
      sourceType: "scheduled-task",
      sourceId: trigger.workroomId,
      assignedToAgentId: room.workItem?.assignedToAgentId ?? input.resolverInput.agentId ?? null,
      now: input.now,
    });
    if (!context) return null;

    // The obligation the job is racing outranks the room's own due date: a tick
    // firing at 03:00 to discharge a 09:00 filing is pre-deadline work even when
    // the room itself carries no deadline. This is the only consumer of
    // temporalInputForTrigger, and the reason it exists.
    const effectiveDueAt = temporalInputForTrigger(trigger, {
      now: input.now,
      schedule: null,
      timezone: null,
      dueAt: room.workItem?.dueAt ?? null,
    }).dueAt;

    const shapeKey = readWorkroomShapeClaim(room.scopeClaims)
      ?? deriveWorkroomShape({
        activityKind: room.activityKind,
        decisionScope: room.decisionScope,
        mode: "standing",
      })?.shape
      ?? null;

    const posture = resolveWorkroomPosture(
      {
        shapeKey,
        activityKind: room.activityKind,
        mode: "standing",
        cycleActive: true,
        dueAt: effectiveDueAt?.toISOString() ?? null,
        declaration: readWorkroomPostureClaim(room.scopeClaims),
      },
      // The scheduler's OWN plan is the baseline the room layers onto, so the
      // two can never disagree about where the tick started from.
      { ...context, inherited: { ...context.inherited, proactivityPlan: input.inheritedPlan } },
      input.now,
    );
    if (!posture) return null;

    // Re-assert tighten-only at this call site. A room may lower cadence freely;
    // it may only narrow authority. If the resolved boundary is wider than the
    // inherited one, something upstream is wrong and the safe answer is to keep
    // the inherited boundary rather than hand a scheduled job more freedom.
    const boundary = tightenActionBoundary(input.inheritedPlan.actionBoundary, posture.actionBoundary);

    const plan: ProactivityPlan = {
      ...resolveProactivityPlanForLevel(input.resolverInput, posture.proactivityLevel),
      actionBoundary: boundary,
    };

    return { trigger, posture, plan };
  } catch {
    return null;
  }
}
