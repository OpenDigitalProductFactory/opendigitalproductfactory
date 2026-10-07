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

import type { Prisma } from "@dpf/db";
import { ACCEPTANCE_SWEEP_AGENT_ID } from "@dpf/db/acceptance-sweep-config";

import { ACCEPTANCE_VERIFIER_ROLE } from "@/lib/work-management/acceptance-verification-shape";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { readWorkShapeRoleBindings } from "@/lib/work-management/workroom-shape-claim";

import {
  ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND,
  acceptanceRoomKey,
  parseIssuedObjectiveMappingPacket,
} from "./steward-objective-mapping-authority";

// `not-issuable` covers a packet that fails the server checks, targets anyone
// but the owner, or targets an owner the room's verify stage is not bound to
// (rooms are never re-created, so an owner change leaves the old binding).
export const PACKET_ISSUE_OUTCOMES = ["issued", "current", "no-live-room", "not-issuable"] as const;
export type PacketIssueOutcome = (typeof PACKET_ISSUE_OUTCOMES)[number];

/** Exactly the reads and writes issuing performs; `prisma` satisfies it. */
export type IssuePacketDb = {
  workroom: {
    findUnique(args: unknown): Promise<{ id: string; archivedAt: Date | null; status: string; scopeClaims: unknown } | null>;
    update(args: unknown): Promise<unknown>;
  };
  workroomActivity: {
    findFirst(args: unknown): Promise<{ payload: unknown; recordedByAgentId: string | null } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

function requestKeyOf(payload: unknown): string | null {
  const packet = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { requestCoworker?: unknown }).requestCoworker
    : null;
  const key = packet && typeof packet === "object" ? (packet as { requestKey?: unknown }).requestKey : null;
  return typeof key === "string" ? key : null;
}

export async function issueAcceptanceObjectiveMappingPacket(input: {
  db: IssuePacketDb;
  itemId: string;
  /** The owner the sweep routed the item to; never the author (owed-acceptance.ts). */
  ownerAgentId: string;
  packet: unknown;
  /** The room brief rebuilt with the packet (route-aged-item.ts buildAcceptanceRoomObjective). */
  objective: string;
  now: Date;
}): Promise<PacketIssueOutcome> {
  const { db, itemId } = input;
  const packet = parseIssuedObjectiveMappingPacket(input.packet, itemId);
  if (!packet || packet.targetAgent !== input.ownerAgentId) return "not-issuable";
  const room = await db.workroom.findUnique({
    where: { idempotencyKey: acceptanceRoomKey(itemId) },
    select: { id: true, archivedAt: true, status: true, scopeClaims: true },
  } satisfies Prisma.WorkroomFindUniqueArgs);
  if (!room || room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)) return "no-live-room";
  if (readWorkShapeRoleBindings(room.scopeClaims)[ACCEPTANCE_VERIFIER_ROLE] !== `agent:${packet.targetAgent}`) return "not-issuable";
  const latest = await db.workroomActivity.findFirst({
    where: { workCapsuleId: room.id, kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { payload: true, recordedByAgentId: true },
  } satisfies Prisma.WorkroomActivityFindFirstArgs);
  if (latest?.recordedByAgentId === ACCEPTANCE_SWEEP_AGENT_ID && requestKeyOf(latest.payload) === packet.requestKey) {
    return "current";
  }
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
