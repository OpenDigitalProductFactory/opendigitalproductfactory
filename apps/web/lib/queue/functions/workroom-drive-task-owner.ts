// Who a drive-dispatched agent task runs for (BI-D13FA12A).
//
// A ScheduledAgentTask runs under a user. The drive used to read that user only
// from the room's requester or creator principal (roomOwnerUserId in
// delivery-room-ownership.ts). Build Studio rooms record neither, so on
// 2026-10-13 127 delivery rooms with a funded, pre-authorised agent stage got no
// task, and the drive still recorded them as `dispatch_agent` with an in-motion
// conclusion: they looked dispatched while nothing ran.
//
// Now, when the room records no owner user, the task owner is the room's
// accountable person, read through the same accountability walk the drive's
// conclusions use (resolveRoomAccountabilityFromDb: explicit room, inherited
// room, then the organization's recorded owner). The source is written on the
// snapshot and the trail, so the choice is visible rather than silent. No
// administrator or other guess is ever substituted: when no accountable person
// with an active user account can be named, the tick is rewritten to
// `pause / missing_task_owner` BEFORE its hold and conclusion are computed, so
// the room counts as stuck, its stall notice fires, and its conclusion names
// what is missing. It takes no lease and creates no task.

import type { DriveReasonFor } from "@/lib/work-management/drive-conclusion";
import type { DrivePlan } from "@/lib/work-management/drive-resolution";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";

import { resolveAccountabilityForConclusion } from "./workroom-drive-accountability";

export const MISSING_TASK_OWNER_REASON = "missing_task_owner" satisfies DriveReasonFor<"pause">;

type AccountableSource = Extract<EffectiveHumanAccountability, { state: "resolved" }>["source"];

export type DriveTaskOwner =
  | { state: "recorded"; userId: string }
  | { state: "accountable"; userId: string; principalId: string; source: AccountableSource }
  | { state: "missing"; message: string };

export type DriveTaskOwnerEffects = {
  resolveAccountability?: (roomId: string) => Promise<EffectiveHumanAccountability>;
  /** The one active user an active human principal maps to, or null. */
  resolvePrincipalUserId?: (principalId: string) => Promise<string | null>;
};

const missing = (message: string): DriveTaskOwner => ({
  state: "missing",
  message: `No accountable person with an active user account can be named to run this room's agent task. ${message}`,
});

export async function resolveDriveTaskOwner(
  roomId: string,
  ownerUserId: string | null,
  effects: DriveTaskOwnerEffects,
): Promise<{ owner: DriveTaskOwner; accountability: EffectiveHumanAccountability | null }> {
  if (ownerUserId) return { owner: { state: "recorded", userId: ownerUserId }, accountability: null };
  const accountability = await resolveAccountabilityForConclusion(roomId, effects.resolveAccountability);
  if (accountability.state !== "resolved") return { owner: missing(accountability.message), accountability };
  const { principalId, source } = accountability;
  if (!effects.resolvePrincipalUserId) {
    return { owner: missing("The drive was composed without a principal-to-user resolver."), accountability };
  }
  let userId: string | null;
  try {
    userId = await effects.resolvePrincipalUserId(principalId);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return { owner: missing(`The accountable person's user could not be read: ${cause}`), accountability };
  }
  if (!userId) {
    return {
      owner: missing(`The accountable person (${principalId}, ${source}) has no active user account to run the task under.`),
      accountability,
    };
  }
  return { owner: { state: "accountable", userId, principalId, source }, accountability };
}

export type SettledTaskOwner = {
  plan: DrivePlan;
  ownerUserId: string | null;
  /** Written on the snapshot when the owner did not come from the room's own record. */
  taskOwner: Record<string, unknown> | null;
  accountability: EffectiveHumanAccountability | null;
};

/**
 * Settle the tick's task owner before anything about the tick is recorded.
 * `dispatches` is true when this tick would upsert at least one agent task.
 * An ownerless dispatch_agent plan becomes pause / missing_task_owner; any
 * other aggregate action (a graph room whose aggregate is already a pause or
 * attention) keeps its own, already honest, action and reason.
 */
export async function settleTickTaskOwner(input: {
  room: { id: string; ownerUserId: string | null };
  plan: DrivePlan;
  dispatches: boolean;
  effects: DriveTaskOwnerEffects;
}): Promise<SettledTaskOwner> {
  const { room, plan } = input;
  const unchanged = { plan, ownerUserId: room.ownerUserId, taskOwner: null, accountability: null };
  if (!input.dispatches) return unchanged;
  const { owner, accountability } = await resolveDriveTaskOwner(room.id, room.ownerUserId, input.effects);
  if (owner.state === "recorded") return unchanged;
  if (owner.state === "accountable") {
    return {
      plan,
      ownerUserId: owner.userId,
      taskOwner: { userId: owner.userId, principalId: owner.principalId, source: owner.source },
      accountability,
    };
  }
  const paused: DrivePlan = plan.action === "dispatch_agent"
    ? { ...plan, action: "pause", reason: MISSING_TASK_OWNER_REASON, taskId: null, ledger: [...plan.ledger, owner.message] }
    : plan;
  return { plan: paused, ownerUserId: null, taskOwner: { missing: owner.message }, accountability };
}

type PrincipalUserDb = {
  principalAlias: { findMany(args: unknown): Promise<Array<{ aliasValue: unknown }>> };
  user: { findUnique(args: unknown): Promise<{ isActive: boolean } | null> };
};

/** The one active user an active human principal maps to; null when none or ambiguous. */
export async function activeUserIdForHumanPrincipal(db: PrincipalUserDb, principalId: string): Promise<string | null> {
  const aliases = await db.principalAlias.findMany({
    where: { principalId, aliasType: "user", issuer: "", principal: { kind: "human", status: "active" } },
    select: { aliasValue: true },
    take: 2,
  });
  if (aliases.length !== 1 || typeof aliases[0]?.aliasValue !== "string") return null;
  const userId = aliases[0].aliasValue;
  const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  return user?.isActive ? userId : null;
}
