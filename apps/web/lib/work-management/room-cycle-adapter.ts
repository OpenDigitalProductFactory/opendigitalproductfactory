import type { WorkCaseSourceRef } from "./case-types";
import type { WorkroomCycleCarrierCandidate } from "./room-cycle";
import { resolveWorkShapeClaim } from "./workroom-shape-claim";
import { projectWorkShapeCycleBoundary } from "./work-shapes";
import type { WorkroomOutcomePacket } from "./room-types";

export const WORKROOM_CYCLE_EVIDENCE_KIND = "work-room-cycle";
export const WORKROOM_OUTCOME_MESSAGE_TYPE = "work-room-outcome-packet";

export interface WorkroomCycleWorkItemRecord {
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

export interface WorkroomCycleMessageRecord {
  messageId: string;
  messageType: string;
  structuredPayload?: unknown;
}

interface StoredCycleBoundary {
  kind: typeof WORKROOM_CYCLE_EVIDENCE_KIND;
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
  kind: typeof WORKROOM_OUTCOME_MESSAGE_TYPE;
  version: 1;
  cycleKey: string;
  carrierId: string;
  packet: WorkroomOutcomePacket;
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

export function parseStoredWorkroomCycle(value: unknown): StoredCycleBoundary | null {
  const container = record(value);
  const candidate = record(container?.workroomCycle ?? value);
  if (
    candidate?.kind !== WORKROOM_CYCLE_EVIDENCE_KIND
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
    kind: WORKROOM_CYCLE_EVIDENCE_KIND,
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

function looksLikeOutcomePacket(value: unknown): value is WorkroomOutcomePacket {
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

export function parseStoredWorkroomOutcome(value: unknown): StoredOutcomePacket | null {
  const candidate = record(value);
  if (
    candidate?.kind !== WORKROOM_OUTCOME_MESSAGE_TYPE
    || candidate.version !== 1
    || typeof candidate.cycleKey !== "string"
    || typeof candidate.carrierId !== "string"
    || !looksLikeOutcomePacket(candidate.packet)
  ) return null;
  return candidate as unknown as StoredOutcomePacket;
}

export function projectStoredWorkroomOutcomePackets(
  messages: readonly WorkroomCycleMessageRecord[],
): WorkroomOutcomePacket[] {
  return messages
    .flatMap((message) => {
      if (message.messageType !== WORKROOM_OUTCOME_MESSAGE_TYPE) return [];
      const stored = parseStoredWorkroomOutcome(message.structuredPayload);
      return stored ? [stored.packet] : [];
    })
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

function projectedStatus(
  item: WorkroomCycleWorkItemRecord,
  boundary: StoredCycleBoundary,
): WorkroomCycleCarrierCandidate["status"] {
  if (item.status === "completed") return boundary.carriedOver ? "carried-over" : "closed";
  if (item.status === "verifying") return "verifying";
  return "open";
}

export function projectDeclaredWorkShapeCycleCarrier(input: {
  scopeClaims: unknown;
  capsuleId?: string | null;
  openedAt?: Date | string | null;
}): WorkroomCycleCarrierCandidate[] {
  try {
    const shape = resolveWorkShapeClaim(input.scopeClaims);
    if (!shape) return [];
    const openedAt = input.openedAt ?? new Date(0);
    const startedAt = openedAt instanceof Date ? openedAt : new Date(openedAt);
    const trigger = shape.triggers[0];
    if (!trigger || Number.isNaN(startedAt.getTime())) return [];
    const projected = projectWorkShapeCycleBoundary({
      shape,
      trigger,
      startedAt,
    });
    const carrierId = input.capsuleId ?? projected.cycleKey;
    const contextRefs = input.capsuleId
      ? [{ kind: "work-capsule" as const, id: input.capsuleId }]
      : projected.contextRefs;
    return [{
      cycleKey: projected.cycleKey,
      carrierKind: "work-capsule" as const,
      carrierId,
      trigger: projected.trigger,
      objective: projected.objective,
      accountablePrincipalRef: projected.accountablePrincipalRef,
      openedAt: startedAt,
      expectedReviewAt: projected.expectedReviewAt,
      stopConditions: projected.stopConditions,
      measureSummary: projected.measureSummary,
      contextRefs,
      status: "open",
      outcomePacket: null,
      sourceRefs: input.capsuleId
        ? [{ kind: "work-capsule" as const, id: input.capsuleId }]
        : [],
    }];
  } catch {
    return [];
  }
}

export function projectWorkItemCycleCarriers(input: {
  items: readonly WorkroomCycleWorkItemRecord[];
  messages: readonly WorkroomCycleMessageRecord[];
  scopeClaims?: unknown;
  capsuleId?: string | null;
  openedAt?: Date | string | null;
}): WorkroomCycleCarrierCandidate[] {
  const packets = new Map<string, WorkroomOutcomePacket>();
  for (const message of input.messages) {
    if (message.messageType !== WORKROOM_OUTCOME_MESSAGE_TYPE) continue;
    const stored = parseStoredWorkroomOutcome(message.structuredPayload);
    if (stored) packets.set(`${stored.cycleKey}:${stored.carrierId}`, stored.packet);
  }

  const declared = projectDeclaredWorkShapeCycleCarrier({
    scopeClaims: input.scopeClaims,
    capsuleId: input.capsuleId,
    openedAt: input.openedAt,
  });

  const fromItems = input.items.flatMap((item) => {
    const boundary = parseStoredWorkroomCycle(item.evidence);
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
  return [...declared, ...fromItems];
}
