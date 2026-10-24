// Repair delivery rooms created before they were born owned (BI-E8C78E80).
//
// Claim and adopt now write the owner at birth (work-capsules/room-ownership.ts).
// Rooms created earlier still carry no Process Overseer, so the drive paused
// every one of them and wrote the same refusal every fifteen minutes. This runs
// once per drive tick, before rooms are loaded, and applies the same rule to
// them: the person the work was claimed for owns the room.
//
// It only touches delivery-shaped rooms, never overrides a coordinator, never
// re-admits someone who was removed, and leaves a room unowned (and reported)
// when no person can be identified from its own record.

import { isDeliveryShapeKey } from "./delivery-shapes";
import { resolveWorkShapeClaim } from "./workroom-shape-claim";
import { resolveActiveHumanPrincipalRecordIdForUser } from "@/lib/identity/principal-linking";
import {
  describeRoomOwnership,
  establishRoomOwnership,
  type RoomOwnershipDb,
} from "@/lib/work-capsules/room-ownership";

type PrincipalRef = { id: string; kind: string; status: string } | null;

export type UnownedDeliveryRoom = {
  id: string;
  scopeClaims: unknown;
  requestedByPrincipal: PrincipalRef;
  createdByPrincipal: PrincipalRef;
  leaseHolderPrincipal: PrincipalRef;
  /** User.id that recorded the room's first activity, for rooms that name no person. */
  firstRecordedByUserId: string | null;
};

const isPerson = (ref: PrincipalRef) => Boolean(ref && ref.kind === "human" && ref.status === "active");
const isAgent = (ref: PrincipalRef) => Boolean(ref && ref.kind === "agent" && ref.status === "active");

/** Who owns an existing delivery room, read only from what the room recorded. Pure. */
export function resolveExistingRoomOwnership(
  room: UnownedDeliveryRoom,
  userPrincipalId: string | null,
): { ownerPrincipalId: string | null; assistantPrincipalId: string | null } {
  const owner = [room.requestedByPrincipal, room.leaseHolderPrincipal, room.createdByPrincipal].find(isPerson);
  const assistant = [room.createdByPrincipal, room.leaseHolderPrincipal].find(isAgent);
  return {
    ownerPrincipalId: owner?.id ?? userPrincipalId,
    assistantPrincipalId: assistant?.id ?? null,
  };
}

export function isDeliveryRoom(scopeClaims: unknown): boolean {
  const shape = resolveWorkShapeClaim(scopeClaims);
  return Boolean(shape && isDeliveryShapeKey(shape.key));
}

type RepairDb = RoomOwnershipDb & {
  workroom: { findMany(args: unknown): Promise<Array<Record<string, any>>> };
  workroomActivity: { create(args: unknown): Promise<unknown> };
  principal: { findFirst(args: unknown): Promise<{ id: string } | null> };
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(fn: (tx: RepairDb) => Promise<T>): Promise<T>;
};

const PRINCIPAL_SELECT = { select: { id: true, kind: true, status: true } } as const;

/** Bounded per tick; returns how many rooms gained an owner. */
export async function repairUnownedDeliveryRooms(db: RepairDb, roomIds: readonly string[], limit = 50): Promise<number> {
  if (roomIds.length === 0) return 0;
  const rows = await db.workroom.findMany({
    where: {
      id: { in: [...roomIds] },
      participants: { none: { lifecycle: "active", roles: { has: "coordinator" } } },
    },
    select: {
      id: true,
      scopeClaims: true,
      requestedByPrincipal: PRINCIPAL_SELECT,
      createdByPrincipal: PRINCIPAL_SELECT,
      leaseHolderPrincipal: PRINCIPAL_SELECT,
      activities: { orderBy: { recordedAt: "asc" }, take: 1, select: { recordedById: true } },
    },
    take: limit,
  });
  let repaired = 0;
  for (const row of rows) {
    if (!isDeliveryRoom(row.scopeClaims)) continue;
    const room: UnownedDeliveryRoom = {
      id: row.id,
      scopeClaims: row.scopeClaims,
      requestedByPrincipal: row.requestedByPrincipal ?? null,
      createdByPrincipal: row.createdByPrincipal ?? null,
      leaseHolderPrincipal: row.leaseHolderPrincipal ?? null,
      firstRecordedByUserId: row.activities?.[0]?.recordedById ?? null,
    };
    const userPrincipalId = room.firstRecordedByUserId
      ? await resolveActiveHumanPrincipalRecordIdForUser(room.firstRecordedByUserId, db)
      : null;
    const principals = resolveExistingRoomOwnership(room, userPrincipalId);
    if (!principals.ownerPrincipalId) continue;
    const appointed = await db.$transaction(async (tx) => {
      // Match executor reassignment's room-before-participant order. Activity
      // ingestion also locks this parent; taking it after a roster write would
      // invert the order and allow concurrent repair/reassignment to deadlock.
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = ${room.id} FOR UPDATE`;
      const outcome = await establishRoomOwnership(tx, { workroomId: room.id, ...principals });
      const summary = describeRoomOwnership(outcome);
      if (summary && (outcome.ownerAppointed || outcome.assistantAdmitted)) {
        await tx.workroomActivity.create({
          data: {
            workCapsuleId: room.id,
            kind: "coworker-joined",
            summary,
            payload: { ...outcome, source: "drive-repair" },
          },
        });
      }
      return outcome.ownerAppointed;
    });
    if (appointed) repaired += 1;
  }
  return repaired;
}

/** Include for loading a room's owner, and the user it maps to (drive task owner). */
export const ROOM_OWNER_USER_INCLUDE = {
  requestedByPrincipal: { select: { aliases: { where: { aliasType: "user", issuer: "" }, select: { aliasValue: true }, take: 1 } } },
  createdByPrincipal: { select: { aliases: { where: { aliasType: "user", issuer: "" }, select: { aliasValue: true }, take: 1 } } },
} as const;

type AliasHolder = { aliases: Array<{ aliasValue: string }> } | null | undefined;

/**
 * The user a drive-dispatched task runs for. An OAuth room was created by the
 * assistant but requested by its human, so the requester wins; reading only the
 * creator left every OAuth room unable to dispatch (missing_task_owner).
 *
 * Requester and creator are history, never rewritten. An account whose work was
 * handed over (User.workHandedOverAt, BI-858FDE5A) is skipped, so a room it
 * once requested returns null here and the drive names the room's accountable
 * person (resolveDriveTaskOwner) instead of birthing a task under the absent
 * account.
 */
export function roomOwnerUserId(
  row: { requestedByPrincipal?: AliasHolder; createdByPrincipal?: AliasHolder },
  handedOverUserIds: ReadonlySet<string> = new Set(),
): string | null {
  for (const holder of [row.requestedByPrincipal, row.createdByPrincipal]) {
    const userId = holder?.aliases[0]?.aliasValue;
    if (userId && !handedOverUserIds.has(userId)) return userId;
  }
  return null;
}

/** Accounts whose work was handed over; read once per drive tick. */
export async function loadHandedOverUserIds(db: {
  user: { findMany(args: unknown): Promise<Array<{ id: string }>> };
}): Promise<Set<string>> {
  const rows = await db.user.findMany({ where: { workHandedOverAt: { not: null } }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}
