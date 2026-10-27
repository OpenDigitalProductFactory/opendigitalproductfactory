import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { AccountabilityEdge } from "@/lib/work-management/human-accountability";
import {
  projectNestedRoomCoordination,
  type CoordinationActor,
  type NestedRoomCoordinationInput,
} from "@/lib/work-management/nested-room-coordination";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "@/lib/work-management/workroom-drive-receipts";
import { isRecord } from "@/lib/shared/coerce";

/** FEMA ICS span-of-control upper bound used as the COO workload measurable. */
export const ICS_SPAN_OF_CONTROL_MAX = 7;

/** Drive cron every 15 minutes, in milliseconds. Ticks and next-wake use this cadence. */
export const WORKROOM_DRIVE_CADENCE_MS = 15 * 60 * 1000;

export type CooOwnerSource = "explicit-room" | "inherited-room" | "organization-owner" | "none";

export type CooRoomInput = {
  roomId: string;
  title: string;
  ownerPrincipalId: string | null;
  ownerDisplayName: string | null;
  ownerSource: CooOwnerSource;
  lastCycleKey: string | null;
  lastAction: string | null;
  lastReason: string | null;
  lastCompletingReceiptAt: string | null;
  paused: boolean;
  doNotWake: boolean;
  coordinators: CoordinationActor[];
};

export type CooBroadcastLedgerRow = {
  commandKey: string;
  roomId: string;
  recordedAt: string;
};

export type CooRoomView = {
  roomId: string;
  title: string;
  ownerPrincipalId: string | null;
  ownerDisplayName: string | null;
  ownerIsSuggestion: boolean;
  stallRecipientPrincipalId: string | null;
  lastCycleKey: string | null;
  lastAction: string | null;
  lastReason: string | null;
  ticksSinceAdvance: number | null;
  nextWakeAt: string | null;
  spanOfControl: number;
  overSpan: boolean;
  unowned: boolean;
  paused: boolean;
  escalationLabel: string | null;
  actionHref: string;
  missingAckCount: number;
};

export type CooSurface = {
  rooms: CooRoomView[];
  unowned: CooRoomView[];
  paused: CooRoomView[];
  overSpanOwners: Array<{ principalId: string; displayName: string | null; roomCount: number }>;
  missingAcks: Array<{ commandKey: string; roomId: string }>;
};

export function ticksSinceAdvance(now: Date, lastCompletingReceiptAt: Date | null): number | null {
  if (!lastCompletingReceiptAt) return null;
  const elapsed = now.getTime() - lastCompletingReceiptAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.floor(elapsed / WORKROOM_DRIVE_CADENCE_MS);
}

export function nextWakeAt(now: Date, lastAction: string | null): Date | null {
  if (lastAction === "pause" || lastAction === "do_not_wake") return null;
  const ms = now.getTime();
  const aligned = Math.ceil(ms / WORKROOM_DRIVE_CADENCE_MS) * WORKROOM_DRIVE_CADENCE_MS;
  return new Date(aligned === ms ? aligned + WORKROOM_DRIVE_CADENCE_MS : aligned);
}

function completingReceiptKeys(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.receipts)) return [];
  return payload.receipts.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.stageKey !== "string" || typeof entry.kind !== "string") return [];
    if (entry.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND) return [];
    const iteration = typeof entry.iteration === "number" ? entry.iteration : 0;
    const runKey = typeof entry.runKey === "string" ? entry.runKey : "";
    return [entry.stageKey + ":" + entry.kind + ":" + String(iteration) + ":" + runKey];
  });
}

/** First appearance of each completing receipt; returns the latest of those times. */
export function lastCompletingReceiptAtFromDriveActivities(
  activities: ReadonlyArray<{ recordedAt: Date; payload: unknown }>,
): Date | null {
  const sorted = [...activities].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const seen = new Set<string>();
  let last: Date | null = null;
  for (const activity of sorted) {
    for (const key of completingReceiptKeys(activity.payload)) {
      if (seen.has(key)) continue;
      seen.add(key);
      last = activity.recordedAt;
    }
  }
  return last;
}

function roomHref(roomId: string): string {
  const caseKey = encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: roomId });
  return "/workspace/cases/" + caseKey;
}

export function projectCooSurface(input: {
  rooms: readonly CooRoomInput[];
  edges: readonly AccountabilityEdge[];
  agents: NestedRoomCoordinationInput["agents"];
  humanRoles: NestedRoomCoordinationInput["humanRoles"];
  asks: readonly CooBroadcastLedgerRow[];
  acks: readonly CooBroadcastLedgerRow[];
  now: Date;
  /** Ancestor/descendant coordinators used for the walk; omitted rooms stay off the inventory. */
  lineageRooms?: ReadonlyArray<{ roomId: string; coordinators: CoordinationActor[] }>;
}): CooSurface {
  const roomsForEscalation = (input.lineageRooms ?? input.rooms).map((row) => ({
    roomId: row.roomId,
    coordinators: row.coordinators,
  }));
  const ownedCount = new Map<string, { displayName: string | null; count: number }>();
  for (const row of input.rooms) {
    if (!row.ownerPrincipalId) continue;
    const current = ownedCount.get(row.ownerPrincipalId) ?? { displayName: row.ownerDisplayName, count: 0 };
    current.count += 1;
    if (!current.displayName && row.ownerDisplayName) current.displayName = row.ownerDisplayName;
    ownedCount.set(row.ownerPrincipalId, current);
  }
  const missingAcks = missingAckRows(input.asks, input.acks);
  const missingByRoom = new Map<string, number>();
  for (const row of missingAcks) {
    missingByRoom.set(row.roomId, (missingByRoom.get(row.roomId) ?? 0) + 1);
  }

  const rooms: CooRoomView[] = input.rooms.map((row) => {
    const span = row.ownerPrincipalId ? ownedCount.get(row.ownerPrincipalId)?.count ?? 0 : 0;
    const ownerIsSuggestion = row.ownerSource === "inherited-room" || row.ownerSource === "organization-owner";
    const coordination = projectNestedRoomCoordination({
      roomId: row.roomId,
      rooms: roomsForEscalation,
      edges: [...input.edges],
      agents: input.agents,
      humanRoles: input.humanRoles,
    });
    const terminal = coordination.escalation.state === "resolved"
      ? coordination.escalation.steps.at(-1)
      : null;
    const stallRecipientPrincipalId = terminal?.kind === "human" ? terminal.ref : null;
    const lastCompleting = row.lastCompletingReceiptAt ? new Date(row.lastCompletingReceiptAt) : null;
    const wake = row.paused || row.doNotWake || row.lastAction === "pause" || row.lastAction === "do_not_wake"
      ? null
      : nextWakeAt(input.now, row.lastAction);
    return {
      roomId: row.roomId,
      title: row.title,
      ownerPrincipalId: row.ownerPrincipalId,
      ownerDisplayName: row.ownerDisplayName,
      ownerIsSuggestion,
      stallRecipientPrincipalId: ownerIsSuggestion
        ? stallRecipientPrincipalId
        : stallRecipientPrincipalId ?? (row.ownerSource === "explicit-room" ? row.ownerPrincipalId : null),
      lastCycleKey: row.lastCycleKey,
      lastAction: row.lastAction,
      lastReason: row.lastReason,
      ticksSinceAdvance: ticksSinceAdvance(input.now, lastCompleting && !Number.isNaN(lastCompleting.getTime()) ? lastCompleting : null),
      nextWakeAt: wake ? wake.toISOString() : null,
      spanOfControl: span,
      overSpan: span > ICS_SPAN_OF_CONTROL_MAX,
      unowned: !row.ownerPrincipalId,
      paused: row.paused,
      escalationLabel: coordination.escalation.steps.length
        ? coordination.escalation.steps.map((step) => step.displayName).join(" → ")
        : null,
      actionHref: roomHref(row.roomId),
      missingAckCount: missingByRoom.get(row.roomId) ?? 0,
    };
  });

  return {
    rooms,
    unowned: rooms.filter((row) => row.unowned),
    paused: rooms.filter((row) => row.paused),
    overSpanOwners: [...ownedCount.entries()]
      .filter(([, value]) => value.count > ICS_SPAN_OF_CONTROL_MAX)
      .map(([principalId, value]) => ({ principalId, displayName: value.displayName, roomCount: value.count })),
    missingAcks,
  };
}

function missingAckRows(
  asks: readonly CooBroadcastLedgerRow[],
  acks: readonly CooBroadcastLedgerRow[],
): Array<{ commandKey: string; roomId: string }> {
  const acked = new Set(acks.map((row) => `${row.commandKey}::${row.roomId}`));
  const seen = new Set<string>();
  const missing: Array<{ commandKey: string; roomId: string }> = [];
  for (const ask of asks) {
    const key = `${ask.commandKey}::${ask.roomId}`;
    if (acked.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push({ commandKey: ask.commandKey, roomId: ask.roomId });
  }
  return missing;
}
