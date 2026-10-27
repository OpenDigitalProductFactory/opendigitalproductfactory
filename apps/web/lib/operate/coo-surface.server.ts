import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { WORKROOM_DRIVE_ACTIVITY_KIND } from "@/lib/work-management/workroom-drive-constants";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import type { CoordinationActor } from "@/lib/work-management/nested-room-coordination";
import { loadAncestorClosure } from "@/lib/work-management/room-workforce.server";
import {
  lastCompletingReceiptAtFromDriveActivities,
  projectCooSurface,
  type CooBroadcastLedgerRow,
  type CooOwnerSource,
  type CooRoomInput,
  type CooSurface,
} from "./coo-surface";
import { COO_BROADCAST_ACK_KIND, COO_BROADCAST_ASK_KIND } from "./coo-broadcast";

type Reader = { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };

export type CooSupervisionDb = {
  workroom?: Reader;
  workroomRelation?: Reader;
  workroomParticipant?: Reader;
  workroomActivity?: Reader;
  agent?: Reader;
};

export type CooSupervisionRoom = {
  capsuleId: string;
  title: string;
  liveness?: string;
  accountability?: EffectiveHumanAccountability;
  accountableDisplayName?: string | null;
  drive?: { action: string | null; reason: string | null; lastCycleKey?: string | null } | null;
};

function ownerSourceOf(accountability: EffectiveHumanAccountability | undefined): CooOwnerSource {
  if (!accountability || accountability.state !== "resolved") return "none";
  return accountability.source;
}

function actorFrom(row: Record<string, unknown>): CoordinationActor | null {
  if (row.status !== "active" || (row.kind !== "human" && row.kind !== "agent")) return null;
  const aliases = Array.isArray(row.aliases) ? row.aliases as Array<Record<string, unknown>> : [];
  const agentIds = [...new Set(aliases.filter((alias) => alias.aliasType === "agent")
    .map((alias) => coworkerAuthorityAgentId(String(alias.aliasValue))))];
  return {
    principalId: String(row.id),
    displayName: String(row.displayName),
    kind: row.kind === "human" ? "person" : "agent",
    agentId: agentIds.length === 1 ? agentIds[0]! : null,
  };
}

function inventoryRooms(input: CooSupervisionRoom[]): CooRoomInput[] {
  return input.map((room) => ({
    roomId: room.capsuleId,
    title: room.title,
    ownerPrincipalId: room.accountability?.state === "resolved" ? room.accountability.principalId : null,
    ownerDisplayName: room.accountableDisplayName ?? null,
    ownerSource: ownerSourceOf(room.accountability),
    lastCycleKey: room.drive?.lastCycleKey ?? null,
    lastAction: room.drive?.action ?? null,
    lastReason: room.drive?.reason ?? null,
    lastCompletingReceiptAt: null,
    paused: room.liveness === "paused" || room.drive?.action === "pause",
    doNotWake: room.drive?.action === "do_not_wake",
    coordinators: [],
  }));
}

/** Compose the COO projection over existing inventory, relations, drive receipts and ask/ack rows. */
export async function loadCooSupervision(
  db: CooSupervisionDb,
  input: { rooms: readonly CooSupervisionRoom[]; now?: Date },
): Promise<CooSurface> {
  const now = input.now ?? new Date();
  const base = inventoryRooms([...input.rooms]);
  if (!base.length || !db.workroom?.findMany) {
    return projectCooSurface({ rooms: base, edges: [], agents: [], humanRoles: [], asks: [], acks: [], now });
  }

  const capsuleIds = base.map((room) => room.roomId);
  const workrooms = await db.workroom.findMany({
    where: { capsuleId: { in: capsuleIds } },
    select: { id: true, capsuleId: true, workspaceState: true },
    take: 201,
  });
  const byCapsule = new Map(workrooms.map((row) => [String(row.capsuleId), row]));
  const byPrismaId = new Map(workrooms.map((row) => [String(row.id), String(row.capsuleId)]));
  const prismaIds = workrooms.map((row) => String(row.id));

  const ancestry = db.workroomRelation && prismaIds.length
    ? await loadAncestorClosure(db as { workroomRelation: Reader }, prismaIds)
    : { roomIds: prismaIds, edges: [] as Array<{ fromWorkroomId: string; toWorkroomId: string; relation: string }>, unresolvedRoomIds: [] };
  const missingLineageIds = ancestry.roomIds.filter((id) => !byPrismaId.has(id));
  if (missingLineageIds.length) {
    const extra = await db.workroom.findMany({
      where: { id: { in: missingLineageIds } },
      select: { id: true, capsuleId: true, workspaceState: true },
      take: 201,
    });
    for (const row of extra) {
      byPrismaId.set(String(row.id), String(row.capsuleId));
      byCapsule.set(String(row.capsuleId), row);
    }
  }
  const edges = ancestry.edges.flatMap((row) => {
    const from = byPrismaId.get(row.fromWorkroomId);
    const to = byPrismaId.get(row.toWorkroomId);
    if (!from || !to) return [];
    return [{ fromWorkroomId: from, toWorkroomId: to, relation: row.relation }];
  });
  const lineagePrismaIds = [...new Set([...prismaIds, ...ancestry.roomIds])];

  const participants = db.workroomParticipant && lineagePrismaIds.length
    ? await db.workroomParticipant.findMany({
      where: { workroomId: { in: lineagePrismaIds }, lifecycle: "active", roles: { has: "coordinator" } },
      select: {
        workroomId: true,
        principal: {
          select: {
            id: true, displayName: true, kind: true, status: true,
            aliases: { where: { aliasType: "agent", issuer: "" }, select: { aliasType: true, aliasValue: true } },
          },
        },
      },
      take: 1001,
    })
    : [];
  const coordinatorsByCapsule = new Map<string, CoordinationActor[]>();
  for (const row of participants) {
    const capsuleId = byPrismaId.get(String(row.workroomId));
    const actor = actorFrom((row.principal ?? {}) as Record<string, unknown>);
    if (!capsuleId || !actor) continue;
    const list = coordinatorsByCapsule.get(capsuleId) ?? [];
    list.push(actor);
    coordinatorsByCapsule.set(capsuleId, list);
  }

  const driveActivities = db.workroomActivity && prismaIds.length
    ? await db.workroomActivity.findMany({
      where: { workCapsuleId: { in: prismaIds }, kind: WORKROOM_DRIVE_ACTIVITY_KIND },
      select: { workCapsuleId: true, recordedAt: true, payload: true },
      orderBy: { recordedAt: "asc" },
      take: 2000,
    })
    : [];
  const activitiesByCapsule = new Map<string, Array<{ recordedAt: Date; payload: unknown }>>();
  for (const row of driveActivities) {
    const capsuleId = byPrismaId.get(String(row.workCapsuleId));
    if (!capsuleId) continue;
    const recordedAt = row.recordedAt instanceof Date ? row.recordedAt : new Date(String(row.recordedAt));
    const list = activitiesByCapsule.get(capsuleId) ?? [];
    list.push({ recordedAt, payload: row.payload });
    activitiesByCapsule.set(capsuleId, list);
  }

  const ledger = db.workroomActivity
    ? await db.workroomActivity.findMany({
      where: { kind: { in: [COO_BROADCAST_ASK_KIND, COO_BROADCAST_ACK_KIND] } },
      select: { workCapsuleId: true, kind: true, commandKey: true, recordedAt: true },
      orderBy: { recordedAt: "desc" },
      take: 500,
    })
    : [];
  const asks: CooBroadcastLedgerRow[] = [];
  const acks: CooBroadcastLedgerRow[] = [];
  for (const row of ledger) {
    const roomId = byPrismaId.get(String(row.workCapsuleId));
    if (!roomId || typeof row.commandKey !== "string") continue;
    const recordedAt = row.recordedAt instanceof Date ? row.recordedAt.toISOString() : String(row.recordedAt);
    const entry = { commandKey: row.commandKey, roomId, recordedAt };
    if (row.kind === COO_BROADCAST_ASK_KIND) asks.push(entry);
    if (row.kind === COO_BROADCAST_ACK_KIND) acks.push(entry);
  }

  const agents = db.agent
    ? (await db.agent.findMany({
      where: { archived: false, status: "active" },
      select: { agentId: true, displayName: true, escalatesTo: true },
      take: 1001,
    })).flatMap((row) => typeof row.agentId === "string"
      ? [{ agentId: row.agentId, displayName: String(row.displayName), escalatesTo: typeof row.escalatesTo === "string" ? row.escalatesTo : null }]
      : [])
    : [];

  const rooms: CooRoomInput[] = base.map((room) => {
    const stored = byCapsule.get(room.roomId);
    const drive = stored ? readStoredWorkroomDriveState(stored.workspaceState) : null;
    const completing = lastCompletingReceiptAtFromDriveActivities(activitiesByCapsule.get(room.roomId) ?? []);
    return {
      ...room,
      lastCycleKey: drive?.lastCycleKey ?? room.lastCycleKey,
      lastAction: drive?.lastAction ?? room.lastAction,
      lastReason: drive?.lastReason ?? room.lastReason,
      lastCompletingReceiptAt: completing ? completing.toISOString() : null,
      coordinators: coordinatorsByCapsule.get(room.roomId) ?? [],
    };
  });

  const lineageRooms = [...new Set(byPrismaId.values())].map((roomId) => ({
    roomId,
    coordinators: coordinatorsByCapsule.get(roomId) ?? [],
  }));

  return projectCooSurface({ rooms, edges, agents, humanRoles: [], asks, acks, now, lineageRooms });
}
