import type { WorkCasePolicyInput } from "./policy-envelope";
import {
  buildWorkroomCycle,
  evaluateWorkroomCyclePolicy,
  type WorkroomCycleCarrierCandidate,
  type WorkroomCyclePolicyDecision,
  type WorkroomShapeConformanceContext,
} from "./room-cycle";
import { evaluateWorkroomLifecycleConformance } from "./workroom-shape-conformance";
import {
  parseStoredWorkroomCycle,
  parseStoredWorkroomOutcome,
  WORKROOM_CYCLE_EVIDENCE_KIND,
  WORKROOM_OUTCOME_MESSAGE_TYPE,
  type WorkroomCycleWorkItemRecord,
} from "./room-cycle-adapter";
import type { WorkroomOutcomePacket } from "./room-types";

export interface WorkroomCycleParentRecord {
  id: string;
  itemId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string;
  queueId: string;
  teamId: string | null;
  urgency: string;
  effortClass: string;
  workerConstraint: unknown;
  assignedToUserId: string | null;
  assignedToAgentId: string | null;
}

export interface WorkroomCycleStoreMessage {
  messageId: string;
  messageType: string;
  structuredPayload: unknown;
}

export interface WorkroomCycleStoreTx {
  getRoom(workItemId: string): Promise<WorkroomCycleParentRecord | null>;
  listCycles(workItemId: string): Promise<WorkroomCycleWorkItemRecord[]>;
  listMessages(workItemId: string): Promise<WorkroomCycleStoreMessage[]>;
  findWorkItemBySource(sourceType: string, sourceId: string): Promise<WorkroomCycleWorkItemRecord | null>;
  createWorkItem(data: Record<string, unknown>): Promise<WorkroomCycleWorkItemRecord>;
  completeCycle(itemId: string, completedAt: Date): Promise<void>;
  appendMessage(data: Record<string, unknown>): Promise<{ messageId: string }>;
}

export interface WorkroomCycleStoreDb {
  withinRoomLock<T>(workItemId: string, callback: (tx: WorkroomCycleStoreTx) => Promise<T>): Promise<T>;
}

export interface OpenWorkroomCycleInput {
  db: WorkroomCycleStoreDb;
  roomWorkItemId: string;
  cycleKey: string;
  trigger: string;
  objective: string;
  accountablePrincipalRef: string;
  expectedReviewAt: Date | string;
  stopConditions: readonly string[];
  measureSummary: string;
  contextRefs: WorkroomCycleCarrierCandidate["contextRefs"];
  actor: { type: "user" | "agent"; id: string };
  idempotencyKey: string;
  policy: Omit<WorkCasePolicyInput, "action">;
  shapeConformance: WorkroomShapeConformanceContext;
  now?: Date;
}

export class WorkroomCycleStoreError extends Error {
  constructor(
    readonly reason: "room_not_found" | "finite_room" | "active_cycle_exists" | "policy_denied" | "cycle_not_found",
    message: string,
    readonly decision?: WorkroomCyclePolicyDecision,
  ) {
    super(message);
    this.name = "WorkroomCycleStoreError";
  }
}

function actorData(actor: OpenWorkroomCycleInput["actor"]): Record<string, string> {
  return actor.type === "user"
    ? { senderType: "user", senderUserId: actor.id }
    : { senderType: "agent", senderAgentId: actor.id };
}

function storedBoundary(input: OpenWorkroomCycleInput) {
  return {
    kind: WORKROOM_CYCLE_EVIDENCE_KIND,
    version: 1,
    cycleKey: input.cycleKey,
    trigger: input.trigger,
    objective: input.objective,
    accountablePrincipalRef: input.accountablePrincipalRef,
    expectedReviewAt: input.expectedReviewAt instanceof Date
      ? input.expectedReviewAt.toISOString()
      : input.expectedReviewAt,
    stopConditions: [...input.stopConditions],
    measureSummary: input.measureSummary,
    contextRefs: [...input.contextRefs],
  } as const;
}

function cycleCandidate(
  item: WorkroomCycleWorkItemRecord,
  packet: WorkroomOutcomePacket | null = null,
): WorkroomCycleCarrierCandidate | null {
  const boundary = parseStoredWorkroomCycle(item.evidence);
  if (!boundary) return null;
  return {
    cycleKey: boundary.cycleKey,
    carrierKind: "work-item",
    carrierId: item.itemId,
    trigger: boundary.trigger,
    objective: boundary.objective,
    accountablePrincipalRef: boundary.accountablePrincipalRef,
    openedAt: item.createdAt,
    expectedReviewAt: boundary.expectedReviewAt,
    stopConditions: boundary.stopConditions,
    measureSummary: boundary.measureSummary,
    contextRefs: boundary.contextRefs,
    status: item.status === "completed" ? "closed" : item.status === "verifying" ? "verifying" : "open",
    outcomePacket: packet,
    sourceRefs: [{ kind: "work-item", id: item.itemId, status: item.status, sourceType: item.sourceType }],
  };
}

function lifecycleReceipt(input: {
  operation: string;
  cycleKey: string;
  carrierId: string;
  idempotencyKey: string;
  enforcementMode: string;
  receiptKind: string;
}) {
  return {
    kind: "work-room-lifecycle-receipt",
    version: 1,
    ...input,
    status: "valid",
    policyRefs: ["work-case-policy-envelope", "work-room-cycle-boundary"],
  };
}

export async function openWorkroomCycle(input: OpenWorkroomCycleInput): Promise<{
  cycle: WorkroomCycleWorkItemRecord;
  messageId: string | null;
  idempotent: boolean;
}> {
  return input.db.withinRoomLock(input.roomWorkItemId, async (tx) => {
    const room = await tx.getRoom(input.roomWorkItemId);
    if (!room) throw new WorkroomCycleStoreError("room_not_found", "Work Room was not found.");
    const policy = evaluateWorkroomCyclePolicy({
      operation: "open-cycle",
      cycle: null,
      policy: input.policy,
      shapeConformance: input.shapeConformance,
    });
    if (!policy.ok) throw new WorkroomCycleStoreError("policy_denied", policy.message, policy);

    const cycles = await tx.listCycles(room.id);
    const existing = cycles.find((item) => parseStoredWorkroomCycle(item.evidence)?.cycleKey === input.cycleKey);
    if (existing) return { cycle: existing, messageId: null, idempotent: true };
    const active = cycles.find((item) => !["completed", "cancelled"].includes(item.status) && parseStoredWorkroomCycle(item.evidence));
    if (active) {
      throw new WorkroomCycleStoreError("active_cycle_exists", `Cycle '${parseStoredWorkroomCycle(active.evidence)?.cycleKey}' is already active.`);
    }

    const boundary = storedBoundary(input);
    buildWorkroomCycle({
      cycleKey: boundary.cycleKey,
      carrierKind: "work-item",
      carrierId: "pending",
      trigger: boundary.trigger,
      objective: boundary.objective,
      accountablePrincipalRef: boundary.accountablePrincipalRef,
      openedAt: input.now ?? new Date(),
      expectedReviewAt: boundary.expectedReviewAt,
      stopConditions: boundary.stopConditions,
      measureSummary: boundary.measureSummary,
      contextRefs: boundary.contextRefs,
      status: "open",
      sourceRefs: [{ kind: "work-item", id: room.itemId, sourceType: room.sourceType }],
    });

    const cycle = await tx.createWorkItem({
      sourceType: room.sourceType,
      sourceId: room.sourceId ?? room.itemId,
      title: `${room.title} — ${input.cycleKey}`,
      description: input.objective,
      urgency: room.urgency,
      effortClass: room.effortClass,
      workerConstraint: room.workerConstraint,
      teamId: room.teamId,
      queueId: room.queueId,
      status: "in-progress",
      assignedToUserId: room.assignedToUserId,
      assignedToAgentId: room.assignedToAgentId,
      dueAt: new Date(boundary.expectedReviewAt),
      evidence: { workroomCycle: boundary },
      parentItemId: room.id,
    });
    const receipt = lifecycleReceipt({
      operation: "open-cycle",
      cycleKey: input.cycleKey,
      carrierId: cycle.itemId,
      idempotencyKey: input.idempotencyKey,
      enforcementMode: policy.enforcementMode,
      receiptKind: policy.requiredReceiptKind,
    });
    const message = await tx.appendMessage({
      workItemId: room.id,
      ...actorData(input.actor),
      messageType: "work-room-cycle-opened",
      body: `Opened cycle ${input.cycleKey}.`,
      structuredPayload: receipt,
      channel: "in-app",
    });
    return { cycle, messageId: message.messageId, idempotent: false };
  });
}

export async function applyWorkroomCarryOver(input: {
  db: WorkroomCycleStoreDb;
  roomWorkItemId: string;
  commands: readonly import("./room-cycle").WorkroomCarryOverCommand[];
  actor: OpenWorkroomCycleInput["actor"];
  shapeConformance: WorkroomShapeConformanceContext;
}): Promise<{ createdItemIds: string[]; reusedItemIds: string[] }> {
  return input.db.withinRoomLock(input.roomWorkItemId, async (tx) => {
    const room = await tx.getRoom(input.roomWorkItemId);
    if (!room) throw new WorkroomCycleStoreError("room_not_found", "Work Room was not found.");
    const conformance = evaluateWorkroomLifecycleConformance({
      operation: "carry-over",
      hasDeclaredWorkShape: input.shapeConformance.hasDeclaredWorkShape,
      conformance: input.shapeConformance.result,
    });
    if (!conformance.ok) {
      throw new WorkroomCycleStoreError("policy_denied", conformance.message, conformance);
    }
    const cycles = await tx.listCycles(room.id);
    const createdItemIds: string[] = [];
    const reusedItemIds: string[] = [];

    for (const command of input.commands) {
      const existing = await tx.findWorkItemBySource("work-room-carry-over", command.idempotencyKey);
      if (existing) {
        reusedItemIds.push(existing.itemId);
        continue;
      }
      const target = command.kind === "attach-to-cycle"
        ? cycles.find((cycle) => parseStoredWorkroomCycle(cycle.evidence)?.cycleKey === command.targetCycleKey)
        : null;
      if (command.kind === "attach-to-cycle" && !target) {
        throw new WorkroomCycleStoreError("cycle_not_found", `Target cycle '${command.targetCycleKey}' was not found.`);
      }
      const item = await tx.createWorkItem({
        sourceType: "work-room-carry-over",
        sourceId: command.idempotencyKey,
        title: command.summary,
        description: `Unresolved work from ${room.title}.`,
        urgency: room.urgency,
        effortClass: room.effortClass,
        workerConstraint: room.workerConstraint,
        teamId: room.teamId,
        queueId: room.queueId,
        status: "queued",
        assignedToUserId: null,
        assignedToAgentId: null,
        evidence: {
          workroomCarryOver: {
            version: 1,
            roomItemId: room.itemId,
            ownerRef: command.ownerRef,
            targetCycleKey: command.targetCycleKey,
          },
        },
        parentItemId: target?.id ?? null,
      });
      createdItemIds.push(item.itemId);
      await tx.appendMessage({
        workItemId: room.id,
        ...actorData(input.actor),
        messageType: "work-room-cycle-carried-over",
        body: command.kind === "attach-to-cycle"
          ? `Carried '${command.summary}' into cycle ${command.targetCycleKey}.`
          : `Created a new case for '${command.summary}'.`,
        structuredPayload: lifecycleReceipt({
          operation: "carry-over",
          cycleKey: command.targetCycleKey ?? "new-case",
          carrierId: item.itemId,
          idempotencyKey: command.idempotencyKey,
          enforcementMode: "governed-action",
          receiptKind: "governed-action",
        }),
        channel: "in-app",
      });
    }
    return { createdItemIds, reusedItemIds };
  });
}

export async function completeWorkroomCycle(input: {
  db: WorkroomCycleStoreDb;
  roomWorkItemId: string;
  carrierId: string;
  packet: WorkroomOutcomePacket;
  actor: OpenWorkroomCycleInput["actor"];
  idempotencyKey: string;
  policy: Omit<WorkCasePolicyInput, "action">;
  shapeConformance: WorkroomShapeConformanceContext;
  now?: Date;
}): Promise<{ messageId: string | null; idempotent: boolean }> {
  return input.db.withinRoomLock(input.roomWorkItemId, async (tx) => {
    const room = await tx.getRoom(input.roomWorkItemId);
    if (!room) throw new WorkroomCycleStoreError("room_not_found", "Work Room was not found.");
    const cycles = await tx.listCycles(room.id);
    const cycle = cycles.find((item) => item.itemId === input.carrierId);
    if (!cycle) throw new WorkroomCycleStoreError("cycle_not_found", "Work Room cycle was not found.");
    const boundary = parseStoredWorkroomCycle(cycle.evidence);
    if (!boundary) throw new WorkroomCycleStoreError("cycle_not_found", "Work Item is not a Work Room cycle carrier.");
    const messages = await tx.listMessages(room.id);
    const existing = messages.find((message) => {
      const stored = parseStoredWorkroomOutcome(message.structuredPayload);
      return stored?.cycleKey === boundary.cycleKey && stored.carrierId === cycle.itemId;
    });
    if (existing) return { messageId: existing.messageId, idempotent: true };

    const view = buildWorkroomCycle(cycleCandidate(cycle)!);
    const policy = evaluateWorkroomCyclePolicy({
      operation: "complete-cycle",
      cycle: view,
      policy: input.policy,
      shapeConformance: input.shapeConformance,
    });
    if (!policy.ok) throw new WorkroomCycleStoreError("policy_denied", policy.message, policy);
    const completedAt = input.now ?? new Date(input.packet.completedAt);
    await tx.completeCycle(cycle.id, completedAt);
    const message = await tx.appendMessage({
      workItemId: room.id,
      ...actorData(input.actor),
      messageType: WORKROOM_OUTCOME_MESSAGE_TYPE,
      body: input.packet.summary,
      structuredPayload: {
        kind: WORKROOM_OUTCOME_MESSAGE_TYPE,
        version: 1,
        cycleKey: boundary.cycleKey,
        carrierId: cycle.itemId,
        packet: input.packet,
        receipt: lifecycleReceipt({
          operation: "complete-cycle",
          cycleKey: boundary.cycleKey,
          carrierId: cycle.itemId,
          idempotencyKey: input.idempotencyKey,
          enforcementMode: policy.enforcementMode,
          receiptKind: policy.requiredReceiptKind,
        }),
      },
      channel: "in-app",
    });
    return { messageId: message.messageId, idempotent: false };
  });
}
