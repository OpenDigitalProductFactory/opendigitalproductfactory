// The sweep issues an item's objective-mapping packet to its steward room
// (BI-099A0BA3). Design:
// docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.4.
//
// The packet is the one the readiness recovery chain already minted for the
// item's resolved owner (owed-acceptance.ts: author excluded, in-platform
// coworkers only, the request key an HMAC only the server can produce). This
// module only re-checks it and appends it to the room, recorded as the sweep's
// own agent, so the room's drive-dispatched run can execute it
// (steward-objective-mapping-authority.ts). One packet per request key: an
// unchanged packet is not re-issued, and a changed one (new evidence, a new
// baseline, a moved Workroom head) is issued as the room's newest.
//
// The room's brief is refreshed at the same time, so the next drive dispatch
// tells the coworker the mapping it may now record.

// Security review fixes (BI-099A0BA3): a packet is never issued to a delivery
// actor, and when the room's newest packet names one it is withdrawn (M1); the
// room must carry the steward key, capsule id and source the sweep wrote
// (Info); and a room still pinned to the 1.0.0 shape, whose stage does not
// write the mapping, is reported `shape-outdated` rather than issued (L2).

import type { Prisma } from "@dpf/db";
import { ACCEPTANCE_SWEEP_AGENT_ID } from "@dpf/db/acceptance-sweep-config";

import { ACCEPTANCE_OBJECTIVE_MAPPING_WRITER } from "@/lib/work-management/acceptance-verification-shape";
import { roomStageMandatedTools } from "@/lib/work-management/room-stage-mandate";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";

import { ACCEPTANCE_ROOM_SOURCE, acceptanceRoomCapsuleId, acceptanceRoomKey } from "./acceptance-room-identity";
import {
  ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND,
  acceptanceStewardDriveTaskId,
  isWithdrawal,
  parseIssuedObjectiveMappingPacket,
} from "./steward-objective-mapping-authority";

// `not-issuable`: the packet fails the server checks, targets anyone but the
// owner, targets a delivery actor, or targets an owner the room's verify stage
// is not bound to (rooms are never re-created, so an owner change leaves the
// old binding). `withdrawn`: the room's previous packet was withdrawn and no
// successor was issued.
export const PACKET_ISSUE_OUTCOMES = ["issued", "current", "withdrawn", "shape-outdated", "no-live-room", "not-issuable"] as const;
export type PacketIssueOutcome = (typeof PACKET_ISSUE_OUTCOMES)[number];

type StewardRoomRow = { id: string; capsuleId: string; source: string; archivedAt: Date | null; status: string; scopeClaims: unknown };

/** Exactly the reads and writes issuing performs; `prisma` satisfies it. */
export type IssuePacketDb = {
  workroom: {
    findUnique(args: unknown): Promise<StewardRoomRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  workroomActivity: {
    findFirst(args: unknown): Promise<{ payload: unknown; recordedByAgentId: string | null } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

function requestCoworkerOf(payload: unknown): Record<string, unknown> | null {
  const packet = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { requestCoworker?: unknown }).requestCoworker
    : null;
  return packet && typeof packet === "object" && !Array.isArray(packet) ? packet as Record<string, unknown> : null;
}

/**
 * Issue the owner's packet to the item's steward room, withdrawing the room's
 * current packet first when its coworker is now a known delivery actor. Null
 * when there was nothing to issue and nothing to withdraw.
 */
export async function issueAcceptanceObjectiveMappingPacket(input: {
  db: IssuePacketDb;
  itemId: string;
  /** The owner the sweep routed the item to; never a delivery actor (owed-acceptance.ts). */
  ownerAgentId: string | null;
  /** The server-minted packet for the owner, or undefined when none is owed this run. */
  packet: unknown;
  /** The room brief rebuilt with the packet (route-aged-item.ts buildAcceptanceRoomObjective). */
  objective: string;
  /** The author and every other agent that delivered the item (delivery-actors.ts). */
  excludedAgentIds?: readonly string[];
  now: Date;
}): Promise<PacketIssueOutcome | null> {
  const { db, itemId } = input;
  const excluded = new Set(input.excludedAgentIds ?? []);
  const room = await db.workroom.findUnique({
    where: { idempotencyKey: acceptanceRoomKey(itemId) },
    select: { id: true, capsuleId: true, source: true, archivedAt: true, status: true, scopeClaims: true },
  } satisfies Prisma.WorkroomFindUniqueArgs);
  if (!room || room.capsuleId !== acceptanceRoomCapsuleId(itemId) || room.source !== ACCEPTANCE_ROOM_SOURCE
    || room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)) return "no-live-room";
  const latest = await db.workroomActivity.findFirst({
    where: { workCapsuleId: room.id, kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { payload: true, recordedByAgentId: true },
  } satisfies Prisma.WorkroomActivityFindFirstArgs);
  const current = latest?.recordedByAgentId === ACCEPTANCE_SWEEP_AGENT_ID && !isWithdrawal(latest.payload)
    ? requestCoworkerOf(latest.payload)
    : null;

  let withdrew = false;
  if (current && typeof current.targetAgent === "string" && excluded.has(current.targetAgent)) {
    await db.workroomActivity.create({
      data: {
        workCapsuleId: room.id,
        kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND,
        summary: `Objective-mapping packet for ${itemId} withdrawn: ${current.targetAgent} delivered the item and cannot verify it.`,
        payload: {
          schemaVersion: 1,
          itemId,
          withdrawn: true,
          withdrawnAt: input.now.toISOString(),
          withdrawnRequestKey: typeof current.requestKey === "string" ? current.requestKey : null,
          withdrawnTargetAgent: current.targetAgent,
          reason: "target-delivered-item",
        },
        recordedByAgentId: ACCEPTANCE_SWEEP_AGENT_ID,
      },
      select: { id: true },
    } satisfies Prisma.WorkroomActivityCreateArgs);
    withdrew = true;
  }

  if (input.packet === undefined || !input.ownerAgentId) return withdrew ? "withdrawn" : null;
  const packet = parseIssuedObjectiveMappingPacket(input.packet, itemId);
  if (!packet || packet.targetAgent !== input.ownerAgentId || excluded.has(packet.targetAgent)) {
    return withdrew ? "withdrawn" : "not-issuable";
  }
  const scheduledTaskId = acceptanceStewardDriveTaskId(itemId);
  const writes = roomStageMandatedTools({ scheduledTaskId, room, agentIds: [packet.targetAgent] });
  if (writes.length === 0) return withdrew ? "withdrawn" : "not-issuable";
  if (!writes.includes(ACCEPTANCE_OBJECTIVE_MAPPING_WRITER)) return withdrew ? "withdrawn" : "shape-outdated";
  if (!withdrew && current?.requestKey === packet.requestKey) return "current";
  await db.workroomActivity.create({
    data: {
      workCapsuleId: room.id,
      kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND,
      summary: `Objective-mapping packet for ${itemId} issued to ${packet.targetAgent}, bound to baseline `
        + `${packet.binding.expectedCurrentBaselineId} and ${packet.binding.eligibleEvidenceActivityIds.length} evidence record(s).`,
      payload: {
        schemaVersion: 1,
        itemId,
        issuedAt: input.now.toISOString(),
        requestCoworker: input.packet as Prisma.InputJsonValue,
      },
      recordedByAgentId: ACCEPTANCE_SWEEP_AGENT_ID,
    },
    select: { id: true },
  } satisfies Prisma.WorkroomActivityCreateArgs);
  await db.workroom.update({
    where: { id: room.id },
    data: { objective: input.objective, lastSyncedAt: input.now },
  } satisfies Prisma.WorkroomUpdateArgs);
  return "issued";
}
