// The objective-mapping authority a routed acceptance steward room carries
// (BI-099A0BA3). Design:
// docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.4.
//
// A routed medium or large item owes `ACCEPTANCE_EVIDENCE_REQUIRED` to the
// acceptance-reviewer lane, whose writer is record_initiative_evidence
// operation objective-mapping. That writer accepts a TaskRun only when it
// carries the exact server-issued objective-mapping packet. An external-MCP
// TaskRun carries it in its request metadata; a steward room's drive-dispatched
// scheduled run carried none, so the item could never close.
//
// The platform now issues the packet to the steward room itself. The daily
// sweep (no model on its path) takes the packet the readiness recovery chain
// already computes for the item (author excluded, in-platform owners only) and
// appends it to the room as an activity it records under its own agent id. A
// scheduled run is admitted to that packet only when every part of the chain is
// a fact the platform wrote:
//
// - the run is a working `TR-SCHED-` run whose sourceRef is the drive task of
//   exactly the item's steward room (`workroom-WC-ACC-…-acceptance-verification`);
// - that room is live, named for the item by its idempotency key and outcome
//   anchor, declares the acceptance-verification shape, and binds the verify
//   stage to the run's agent (room-stage-mandate.ts);
// - the newest packet activity on the room was recorded by the sweep's agent,
//   not a person;
// - the packet's request key is the server's HMAC identity for its immutable
//   contents (validateObjectiveMappingRequestKey). A model or client can read a
//   packet but cannot mint or alter one;
// - the packet targets the run's agent.
//
// The objective-mapping repository then applies every check it applies to an
// external packet: current baseline, exact eligible evidence set, and the
// delivery Workroom's live head. Nothing here relaxes those.

import { ACCEPTANCE_SWEEP_AGENT_ID } from "@dpf/db/acceptance-sweep-config";

import {
  validateObjectiveMappingRequestKey,
  type ObjectiveMappingBinding,
} from "@/lib/mcp-task-objective-mapping-request-key";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { ACCEPTANCE_VERIFICATION_SHAPE_KEY } from "@/lib/work-management/acceptance-verification-shape";
import { roomStageMandatedTools, SCHEDULED_RUN_PREFIX } from "@/lib/work-management/room-stage-mandate";

/** The WorkroomActivity kind the sweep appends a platform-issued packet as. */
export const ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND = "acceptance-objective-mapping-packet";

/** The packet-bound acceptance writer. */
export const OBJECTIVE_MAPPING_WRITER = "record_initiative_evidence";

/**
 * The authority snapshot's token scope for a write made under the platform's
 * own authority: no client token exists (acceptance-sweep-close.ts records the
 * same for its closures).
 */
export const STEWARD_LANE_TOKEN_SCOPE = "organization";

export function acceptanceRoomKey(itemId: string): string {
  return `acceptance:${itemId}`;
}

/** Stable, human-quotable room id: one room per item. */
export function acceptanceRoomCapsuleId(itemId: string): string {
  return `WC-ACC-${itemId.replace(/^BI-/i, "").toUpperCase()}`;
}

const DRIVE_TASK_PREFIX = "workroom-";
const DRIVE_TASK_SUFFIX = `-${ACCEPTANCE_VERIFICATION_SHAPE_KEY}`;

/** The ScheduledAgentTask id the Workroom drive gives an item's steward room (drive-plan-stage.ts). */
export function acceptanceStewardDriveTaskId(itemId: string): string {
  return `${DRIVE_TASK_PREFIX}${acceptanceRoomCapsuleId(itemId)}${DRIVE_TASK_SUFFIX}`;
}

export type IssuedObjectiveMappingPacket = {
  targetAgent: string;
  objective: string;
  questionPacketSummary: string;
  requestKey: string;
  requiredToolNames: string[];
  binding: ObjectiveMappingBinding;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A stored `requestCoworker` packet, accepted only in the exact
 * objective-mapping shape for `itemId` and only when its request key is the
 * server's authenticated identity for its contents. Anything else is null.
 */
export function parseIssuedObjectiveMappingPacket(value: unknown, itemId: string): IssuedObjectiveMappingPacket | null {
  const packet = record(value);
  const targetAgent = text(packet?.targetAgent);
  const objective = text(packet?.objective);
  const questionPacketSummary = text(packet?.questionPacketSummary);
  const requestKey = text(packet?.requestKey);
  const names = packet?.requiredToolNames;
  if (!packet || !targetAgent || !objective || !questionPacketSummary || !requestKey
    || !Array.isArray(names) || names.length === 0 || !names.every((name) => typeof name === "string" && name.trim())) {
    return null;
  }
  const binding = parseInitiativeReviewBinding(packet.initiativeReviewBinding);
  if (!binding || binding.gate !== "objective-mapping" || binding.writerToolName !== OBJECTIVE_MAPPING_WRITER
    || binding.itemId !== itemId || !binding.workroomRef
    || !binding.eligibleEvidenceActivityIds || binding.eligibleEvidenceActivityIds.length === 0
    || typeof binding.expectedCurrentBaselineId !== "string") {
    return null;
  }
  const requiredToolNames = names as string[];
  if (!requiredToolNames.includes(OBJECTIVE_MAPPING_WRITER)) return null;
  const bound = binding as ObjectiveMappingBinding;
  if (!validateObjectiveMappingRequestKey({
    targetAgent, objective, questionPacketSummary, requiredToolNames, binding: bound, requestKey,
  })) return null;
  return { targetAgent, objective, questionPacketSummary, requestKey, requiredToolNames, binding: bound };
}

/** The steward room capsule a scheduled run's drive task names, or null when it names none. */
export function stewardCapsuleIdFromRun(a2aMetadata: unknown): string | null {
  const sourceRef = record(record(a2aMetadata)?.sourceRef);
  const taskId = sourceRef?.kind === "scheduled-task" ? text(sourceRef.id) : null;
  if (!taskId || !taskId.startsWith(`${DRIVE_TASK_PREFIX}WC-ACC-`) || !taskId.endsWith(DRIVE_TASK_SUFFIX)) return null;
  const capsuleId = taskId.slice(DRIVE_TASK_PREFIX.length, -DRIVE_TASK_SUFFIX.length);
  return capsuleId.length > "WC-ACC-".length ? capsuleId : null;
}

export type StewardRun = {
  taskRunId: string;
  userId: string | null;
  currentAgentId: string | null;
  status: string;
  completedAt: Date | null;
  archivedAt: Date | null;
  a2aMetadata: unknown;
};

type StewardRoom = {
  id: string;
  capsuleId: string;
  idempotencyKey: string | null;
  status: string;
  archivedAt: Date | null;
  scopeClaims: unknown;
  outcomeAnchor: unknown;
};

/** Exactly the reads the authority performs; a Prisma client or transaction satisfies it. */
export type StewardAuthorityDb = {
  workroom: { findUnique(args: unknown): Promise<StewardRoom | null> };
  workroomActivity: {
    findFirst(args: unknown): Promise<{ payload: unknown; recordedByAgentId: string | null; recordedById: string | null } | null>;
  };
};

export type StewardRefusal =
  | "not-a-steward-run"
  | "run-not-executing"
  | "room-not-bound"
  | "packet-not-issued"
  | "packet-not-server-issued"
  | "packet-targets-another-agent";

export type StewardAuthority =
  | { ok: true; itemId: string; packet: IssuedObjectiveMappingPacket }
  | { ok: false; reason: StewardRefusal };

const refuse = (reason: StewardRefusal): StewardAuthority => ({ ok: false, reason });

/**
 * The platform-issued objective-mapping packet a scheduled acceptance steward
 * run may execute, or why it may not. `itemId`, when given, is the item the
 * caller is writing for; a run bound to another item is refused.
 */
export async function loadAcceptanceStewardObjectiveMappingAuthority(
  db: StewardAuthorityDb,
  input: { run: StewardRun; itemId?: string },
): Promise<StewardAuthority> {
  const { run } = input;
  const metadata = record(run.a2aMetadata);
  const capsuleId = stewardCapsuleIdFromRun(run.a2aMetadata);
  if (metadata?.trigger !== "scheduled" || !run.taskRunId.startsWith(SCHEDULED_RUN_PREFIX) || !capsuleId) {
    return refuse("not-a-steward-run");
  }
  if (run.status !== "working" || run.completedAt !== null || run.archivedAt !== null || !run.currentAgentId || !run.userId) {
    return refuse("run-not-executing");
  }
  const room = await db.workroom.findUnique({
    where: { capsuleId },
    select: { id: true, capsuleId: true, idempotencyKey: true, status: true, archivedAt: true, scopeClaims: true, outcomeAnchor: true },
  });
  const anchor = record(room?.outcomeAnchor);
  const itemId = anchor?.kind === "backlog-item" ? text(anchor.id) : null;
  const scheduledTaskId = text(record(metadata.sourceRef)?.id);
  if (!room || !itemId || !scheduledTaskId
    || (input.itemId !== undefined && input.itemId !== itemId)
    || room.capsuleId !== acceptanceRoomCapsuleId(itemId)
    || room.idempotencyKey !== acceptanceRoomKey(itemId)
    || scheduledTaskId !== acceptanceStewardDriveTaskId(itemId)
    // Live, the acceptance-verification shape, and its verify stage bound to this agent.
    || !roomStageMandatedTools({ scheduledTaskId, room, agentIds: [run.currentAgentId] }).includes(OBJECTIVE_MAPPING_WRITER)) {
    return refuse("room-not-bound");
  }
  const issued = await db.workroomActivity.findFirst({
    where: { workCapsuleId: room.id, kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { payload: true, recordedByAgentId: true, recordedById: true },
  });
  if (!issued) return refuse("packet-not-issued");
  if (issued.recordedByAgentId !== ACCEPTANCE_SWEEP_AGENT_ID || issued.recordedById !== null) {
    return refuse("packet-not-server-issued");
  }
  const packet = parseIssuedObjectiveMappingPacket(record(issued.payload)?.requestCoworker, itemId);
  if (!packet) return refuse("packet-not-server-issued");
  if (packet.targetAgent !== run.currentAgentId) return refuse("packet-targets-another-agent");
  return { ok: true, itemId, packet };
}

/**
 * For the tool handler: whether a run is a steward run at all (null when it is
 * not, so every other lane is untouched) and, when it is, the binding its
 * platform-issued packet carries, or the refusal.
 */
export async function resolveAcceptanceStewardRunBinding(taskRunId: string | null | undefined): Promise<
  | null
  | { ok: true; itemId: string; binding: ObjectiveMappingBinding }
  | { ok: false; reason: StewardRefusal }
> {
  if (!taskRunId?.startsWith(SCHEDULED_RUN_PREFIX)) return null;
  const { prisma } = await import("@dpf/db");
  const run = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: { taskRunId: true, userId: true, currentAgentId: true, status: true, completedAt: true, archivedAt: true, a2aMetadata: true },
  });
  if (!run || !stewardCapsuleIdFromRun(run.a2aMetadata)) return null;
  const authority = await loadAcceptanceStewardObjectiveMappingAuthority(prisma as unknown as StewardAuthorityDb, { run });
  return authority.ok ? { ok: true, itemId: authority.itemId, binding: authority.packet.binding } : authority;
}
