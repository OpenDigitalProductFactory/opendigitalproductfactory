// apps/web/lib/queue/functions/workroom-drive-review-stages.ts
//
// BI-2C8750FC (EP-4614F35E) — the drive tick's half of "readiness review gates
// become room drive review stages". The pure binding lives in
// lib/work-management/readiness-review-stages.ts; this module does the I/O:
//
// 1. When the drive stops on a review stage (a stage that leaves a
//    spec-approval or plan-review receipt) and raises attention, it asks the
//    readiness recovery which independent reviews the room's item owes, who
//    authored the room, and the room's action boundary.
// 2. It rebinds that stage to the non-author reviewer and resolves the plan
//    again. A person-authored room at `preauthorized` gets an agent stage and a
//    `dispatch_agent` plan; an agent-authored room gets a role stage owned by
//    the reviewer role, so attention goes to the reviewer, never the author.
// 3. The dispatch is executed by the BI-A835D300 runner
//    (dispatchReviewerRequest): the exact server-issued reviewer packet through
//    the governed request_coworker lane, idempotent on its request key. No
//    generic ScheduledAgentTask is created for a review stage: an unbound brief
//    cannot record a review receipt, the packet can.
//
// Bounded: readiness is read for at most REVIEW_STAGE_RESOLUTIONS_PER_TICK
// rooms a tick; the rest keep their attention plan until a later tick.

import type { ProactivityActionBoundary } from "@/lib/proactivity/proactivity-types";
import type { DriveReasonFor } from "@/lib/work-management/drive-conclusion";
import { resolveDrivePlan, type DrivePlan, type DriveResolutionInput } from "@/lib/work-management/drive-resolution";
import {
  bindReviewStage,
  isReadinessReviewStage,
  resolveReviewStageBinding,
  type ReadinessReviewRoute,
  type ReviewArtifactAuthor,
  type ReviewStageBinding,
} from "@/lib/work-management/readiness-review-stages";
import { WORKROOM_DRIVE_ACTIVITY_KIND } from "@/lib/work-management/workroom-drive-constants";

export const REVIEW_STAGE_RESOLUTIONS_PER_TICK = 5;

export type ReviewStageContext = {
  itemId: string;
  author: ReviewArtifactAuthor;
  /** The person the work is for; carries the request when no assistant authored it. */
  userId: string | null;
  actionBoundary: ProactivityActionBoundary | null;
  routes: readonly ReadinessReviewRoute[];
};

export type ReviewStageDeps = {
  /** Null when the room has no item, or readiness/recovery could not be read. */
  loadContext(input: { roomId: string; capsuleId: string; scopeClaims: unknown }): Promise<ReviewStageContext | null>;
};

export type ReviewStageOverlay = { plan: DrivePlan; binding: ReviewStageBinding; context: ReviewStageContext };

/** Only an attention plan on a review stage is worth a readiness read. */
export function planNeedsReviewOverlay(plan: DrivePlan): boolean {
  return plan.action === "attention"
    && (plan.reason === "governed_decision" || plan.reason === "role_stage")
    && isReadinessReviewStage(plan.definition, plan.stageKey);
}

export async function overlayReviewStage(input: {
  room: { id: string; capsuleId: string; scopeClaims: unknown };
  plan: DrivePlan;
  driveInput: DriveResolutionInput;
  budget: { remaining: number };
  deps: ReviewStageDeps | null;
}): Promise<ReviewStageOverlay | null> {
  const { plan, deps, budget } = input;
  if (!deps || budget.remaining <= 0 || !planNeedsReviewOverlay(plan) || !plan.definition || !plan.stageKey) return null;
  budget.remaining -= 1;
  const context = await deps.loadContext({ roomId: input.room.id, capsuleId: input.room.capsuleId, scopeClaims: input.room.scopeClaims })
    .catch(() => null);
  if (!context) return null;
  const binding = resolveReviewStageBinding({
    definition: plan.definition,
    stageKey: plan.stageKey,
    routes: context.routes,
    author: context.author,
    actionBoundary: context.actionBoundary,
  });
  if (!binding) return null;
  const rebound = resolveDrivePlan({
    ...input.driveInput,
    definition: bindReviewStage(plan.definition, binding),
    actionBoundary: context.actionBoundary,
    independentEvaluatorPrincipalRef: binding.independentEvaluatorPrincipalRef,
    // Pin the stage the first resolution chose: rebinding a principal never moves the room.
    proposedStageKey: plan.stageKey,
  });
  return { plan: rebound, binding, context };
}

/**
 * The drive tick's plan resolver: resolve the plan, then overlay a review
 * stage's reviewer binding, reading readiness for at most
 * REVIEW_STAGE_RESOLUTIONS_PER_TICK rooms. Injected deps win; a test that
 * injects its own rooms without review deps gets none; otherwise the live loader.
 */
export function reviewStageResolver(deps?: { reviewStages?: ReviewStageDeps | null; listRooms?: unknown }) {
  const reviewDeps = deps?.reviewStages !== undefined ? deps.reviewStages : deps?.listRooms ? null : createLiveReviewStageDeps();
  const budget = { remaining: REVIEW_STAGE_RESOLUTIONS_PER_TICK };
  return async (room: { id: string; capsuleId: string; scopeClaims: unknown }, driveInput: DriveResolutionInput) => {
    const plan = resolveDrivePlan(driveInput);
    const review = await overlayReviewStage({ room, plan, driveInput, budget, deps: reviewDeps });
    return { plan: review?.plan ?? plan, review };
  };
}

type ReviewerOutcome = "dispatched" | "cooling-down" | "unavailable";

export type ReviewerDispatchEffect = (input: {
  roomId: string;
  capsuleId: string;
  itemId: string;
  author: ReviewArtifactAuthor;
  userId: string | null;
  requestCoworker: Record<string, unknown>;
  now: Date;
}) => Promise<{ outcome: ReviewerOutcome; detail?: string }>;

/**
 * Execute a review stage's dispatch_agent plan as the reviewer-packet dispatch.
 * Called by applyDrivePlan after it holds the room's lease.
 */
export async function applyReviewerDispatch(input: {
  room: { id: string; capsuleId: string };
  plan: DrivePlan;
  overlay: ReviewStageOverlay;
  snapshot: Record<string, unknown>;
  now: Date;
  /** Absent when no reviewer dispatcher is composed: the request concludes unavailable. A review stage bound to its non-author reviewer sends this packet, never a generic task. */
  dispatch?: ReviewerDispatchEffect;
  persist: (args: { roomId: string; snapshot: Record<string, unknown>; activityKind: string; summary: string; payload: Record<string, unknown>;
    lease?: { expiresAt: Date; holderPrincipalId: string | null } }) => Promise<void>;
  lease: { expiresAt: Date; holderPrincipalId: string | null };
}): Promise<"dispatched" | "skipped"> {
  const { overlay, plan, room } = input;
  const packet = overlay.binding.requestCoworker!;
  const dispatch: ReviewerDispatchEffect = input.dispatch
    ?? (async () => ({ outcome: "unavailable", detail: "No reviewer dispatcher is composed into this drive." }));
  const result = await dispatch({
    roomId: room.id, capsuleId: room.capsuleId, itemId: overlay.context.itemId, author: overlay.context.author,
    userId: overlay.context.userId, requestCoworker: packet, now: input.now,
  }).catch((error: unknown) => ({ outcome: "unavailable" as const, detail: error instanceof Error ? error.message : String(error) }));
  const review = { gate: overlay.binding.gate, reviewer: overlay.binding.accountablePrincipalRef, requestKey: packet.requestKey ?? null, outcome: result.outcome };
  if (result.outcome === "unavailable") {
    const reason: DriveReasonFor<"dispatch_agent"> = "reviewer_dispatch_unavailable";
    const snapshot = { ...input.snapshot, reason, review };
    await input.persist({
      roomId: room.id, snapshot, activityKind: WORKROOM_DRIVE_ACTIVITY_KIND, payload: { ...snapshot, detail: result.detail ?? null },
      summary: `Review stage ${plan.stageKey} owes the ${overlay.binding.gate} review by ${overlay.binding.accountablePrincipalRef}, but the request could not be sent.`,
    });
    return "skipped";
  }
  const snapshot = { ...input.snapshot, review };
  await input.persist({
    roomId: room.id, snapshot, activityKind: WORKROOM_DRIVE_ACTIVITY_KIND, payload: snapshot, lease: input.lease,
    summary: result.outcome === "dispatched"
      ? `Requested the ${overlay.binding.gate} review from ${overlay.binding.accountablePrincipalRef} for stage ${plan.stageKey}.`
      : `The ${overlay.binding.gate} review for stage ${plan.stageKey} was already requested; waiting on ${overlay.binding.accountablePrincipalRef}.`,
  });
  return "dispatched";
}

// ── live wiring ───────────────────────────────────────────────────────────────

function authorOf(room: { userId: string | null; agentId: string | null }): ReviewArtifactAuthor {
  if (room.agentId) return { kind: "agent", agentId: room.agentId };
  if (room.userId) return { kind: "person", userId: room.userId };
  return { kind: "unknown" };
}

/** The live context loader. The platform room default is read once per drive tick. */
export function createLiveReviewStageDeps(): ReviewStageDeps {
  let platformDefault: Promise<ProactivityActionBoundary | null> | null = null;
  return {
    async loadContext({ capsuleId, scopeClaims }) {
      const { prisma } = await import("@dpf/db");
      const { loadRoomAuthors, loadDesignPhaseOwedReviewRoutes } = await import("@/lib/backlog/initiative-readiness/server-reviewer-dispatch");
      const room = (await loadRoomAuthors({ capsuleId }))[0];
      if (!room?.itemId) return null;
      // An adopted room records the BI- id; a Build Studio room the row id.
      const item = await prisma.backlogItem.findFirst({
        where: { OR: [{ itemId: room.itemId }, { id: room.itemId }] },
        select: { itemId: true },
      });
      if (!item) return null;
      const author = authorOf(room);
      const routes = await loadDesignPhaseOwedReviewRoutes(item.itemId, author.kind === "agent" ? author.agentId : null);
      if (!routes) return null;
      platformDefault ??= import("@/lib/work-management/workroom-posture-defaults")
        .then(async ({ getWorkroomPostureDefault }) => (await getWorkroomPostureDefault())?.actionBoundary ?? null)
        .catch(() => null);
      const [{ readWorkroomPostureClaim }, { readWorkroomShapeClaim }, { shapeBiasFor }, { resolveRoomActionBoundary }] = await Promise.all([
        import("@/lib/work-management/workroom-posture-claim"),
        import("@/lib/work-management/workroom-shape-claim"),
        import("@/lib/work-posture/derive"),
        import("@/lib/work-management/room-turn-authority"),
      ]);
      const actionBoundary = resolveRoomActionBoundary({
        declaredActionBoundary: readWorkroomPostureClaim(scopeClaims)?.actionBoundary ?? null,
        shapeActionBoundary: shapeBiasFor(readWorkroomShapeClaim(scopeClaims))?.actionBoundary ?? null,
      }, await platformDefault);
      return { itemId: item.itemId, author, userId: room.userId, actionBoundary, routes };
    },
  };
}

/** The live reviewer dispatch: the BI-A835D300 runner. */
export const liveReviewerDispatch: ReviewerDispatchEffect = async (input) => {
  const { dispatchReviewerRequest } = await import("@/lib/backlog/initiative-readiness/server-reviewer-dispatch");
  const outcome = await dispatchReviewerRequest({
    room: {
      roomId: input.roomId,
      capsuleId: input.capsuleId,
      userId: input.userId,
      agentId: input.author.kind === "agent" ? input.author.agentId : null,
    },
    itemId: input.itemId,
    requestCoworker: input.requestCoworker,
    // A review stage dispatches only for person-authored work, which has no
    // authoring assistant; the person's own live connection carries it.
    carrier: input.author.kind === "agent" ? "author-assistant" : "requesting-user",
    now: input.now,
  });
  if (outcome.outcome === "dispatched" || outcome.outcome === "cooling-down") return { outcome: outcome.outcome };
  return { outcome: "unavailable", detail: outcome.detail ?? outcome.outcome };
};
