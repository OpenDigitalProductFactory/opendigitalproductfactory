import type { WorkCaseSourceRef } from "./case-types";
import type { WorkRoomCycleCarrierCandidate } from "./room-cycle";
import type { WorkRoomOutcomePacket } from "./room-types";

export const WORK_ROOM_CYCLE_EVIDENCE_KIND = "work-room-cycle";
export const WORK_ROOM_OUTCOME_MESSAGE_TYPE = "work-room-outcome-packet";

export interface WorkRoomCycleWorkItemRecord {
  id: string;
  itemId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string | null;
  status: string;
  assignedToUserId: string | null;
  assignedToAgentId?: string | null;
  dueAt: Date | string | null;
  evidence?: unknown;
  createdAt: Date | string;
  completedAt?: Date | string | null;
}

export interface WorkRoomCycleMessageRecord {
  messageId: string;
  messageType: string;
  structuredPayload?: unknown;
}

interface StoredCycleBoundary {
  kind: typeof WORK_ROOM_CYCLE_EVIDENCE_KIND;
  version: 1;
  cycleKey: string;
  trigger: string;
  objective: string;
  accountablePrincipalRef: string;
  expectedReviewAt: string;
  stopConditions: string[];
  measureSummary: string;
  contextRefs: WorkCaseSourceRef[];
  carriedOver?: boolean;
}

interface StoredOutcomePacket {
  kind: typeof WORK_ROOM_OUTCOME_MESSAGE_TYPE;
  version: 1;
  cycleKey: string;
  carrierId: string;
  packet: WorkRoomOutcomePacket;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value as string[];
}

function sourceRefs(value: unknown): WorkCaseSourceRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs = value.filter((entry) => {
    const candidate = record(entry);
    return candidate && typeof candidate.kind === "string" && typeof candidate.id === "string";
  }) as WorkCaseSourceRef[];
  return refs.length === value.length ? refs : null;
}

export function parseStoredWorkRoomCycle(value: unknown): StoredCycleBoundary | null {
  const container = record(value);
  const candidate = record(container?.workRoomCycle ?? value);
  if (
    candidate?.kind !== WORK_ROOM_CYCLE_EVIDENCE_KIND
    || candidate.version !== 1
    || typeof candidate.cycleKey !== "string"
    || typeof candidate.trigger !== "string"
    || typeof candidate.objective !== "string"
    || typeof candidate.accountablePrincipalRef !== "string"
    || typeof candidate.expectedReviewAt !== "string"
    || typeof candidate.measureSummary !== "string"
  ) return null;
  const stops = stringArray(candidate.stopConditions);
  const context = sourceRefs(candidate.contextRefs);
  if (!stops || !context) return null;
  return {
    kind: WORK_ROOM_CYCLE_EVIDENCE_KIND,
    version: 1,
    cycleKey: candidate.cycleKey,
    trigger: candidate.trigger,
    objective: candidate.objective,
    accountablePrincipalRef: candidate.accountablePrincipalRef,
    expectedReviewAt: candidate.expectedReviewAt,
    stopConditions: stops,
    measureSummary: candidate.measureSummary,
    contextRefs: context,
    carriedOver: candidate.carriedOver === true,
  };
}

function looksLikeOutcomePacket(value: unknown): value is WorkRoomOutcomePacket {
  const candidate = record(value);
  return Boolean(
    candidate
    && typeof candidate.summary === "string"
    && typeof candidate.accountablePrincipalRef === "string"
    && typeof candidate.completedAt === "string"
    && Array.isArray(candidate.sourceRefs)
    && Array.isArray(candidate.unresolvedWork),
  );
}

export function parseStoredWorkRoomOutcome(value: unknown): StoredOutcomePacket | null {
  const candidate = record(value);
  if (
    candidate?.kind !== WORK_ROOM_OUTCOME_MESSAGE_TYPE
    || candidate.version !== 1
    || typeof candidate.cycleKey !== "string"
    || typeof candidate.carrierId !== "string"
    || !looksLikeOutcomePacket(candidate.packet)
  ) return null;
  return candidate as unknown as StoredOutcomePacket;
}

export function projectStoredWorkRoomOutcomePackets(
  messages: readonly WorkRoomCycleMessageRecord[],
): WorkRoomOutcomePacket[] {
  return messages
    .flatMap((message) => {
      if (message.messageType !== WORK_ROOM_OUTCOME_MESSAGE_TYPE) return [];
      const stored = parseStoredWorkRoomOutcome(message.structuredPayload);
      return stored ? [stored.packet] : [];
    })
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

function projectedStatus(
  item: WorkRoomCycleWorkItemRecord,
  boundary: StoredCycleBoundary,
): WorkRoomCycleCarrierCandidate["status"] {
  if (item.status === "completed") return boundary.carriedOver ? "carried-over" : "closed";
  if (item.status === "verifying") return "verifying";
  return "open";
}

export function projectWorkItemCycleCarriers(input: {
  items: readonly WorkRoomCycleWorkItemRecord[];
  messages: readonly WorkRoomCycleMessageRecord[];
}): WorkRoomCycleCarrierCandidate[] {
  const packets = new Map<string, WorkRoomOutcomePacket>();
  for (const message of input.messages) {
    if (message.messageType !== WORK_ROOM_OUTCOME_MESSAGE_TYPE) continue;
    const stored = parseStoredWorkRoomOutcome(message.structuredPayload);
    if (stored) packets.set(`${stored.cycleKey}:${stored.carrierId}`, stored.packet);
  }

  return input.items.flatMap((item) => {
    const boundary = parseStoredWorkRoomCycle(item.evidence);
    if (!boundary) return [];
    const packet = packets.get(`${boundary.cycleKey}:${item.itemId}`) ?? null;
    return [{
      cycleKey: boundary.cycleKey,
      carrierKind: "work-item" as const,
      carrierId: item.itemId,
      trigger: boundary.trigger,
      objective: boundary.objective,
      accountablePrincipalRef: boundary.accountablePrincipalRef,
      openedAt: item.createdAt,
      expectedReviewAt: boundary.expectedReviewAt,
      stopConditions: boundary.stopConditions,
      measureSummary: boundary.measureSummary,
      contextRefs: boundary.contextRefs,
      status: projectedStatus(item, boundary),
      outcomePacket: packet,
      sourceRefs: [{
        kind: "work-item" as const,
        id: item.itemId,
        status: item.status,
        sourceType: item.sourceType,
      }],
    }];
  });
}
