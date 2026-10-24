import type { WorkCaseActorRef, WorkCaseSourceRef } from "./case-types";
import type { WorkCapsuleActivityRow } from "./receipt-envelope";
import type {
  WorkroomActivityKind,
  WorkroomActivityView,
} from "./room-types";

export interface WorkroomActivityInput {
  sourceEventId: string;
  kind: WorkroomActivityKind;
  occurredAt: Date | string | null;
  actorRef: WorkCaseActorRef | null;
  summary: string;
  sourceRef: WorkCaseSourceRef;
  emphasis?: WorkroomActivityView["emphasis"];
  channel?: WorkroomActivityView["channel"];
}

const KNOWN_ACTIVITY_KINDS = new Set<WorkroomActivityKind>([
  "message", "ask", "coworker-joined", "coworker-left", "coworker-handoff",
  "work-started", "work-paused", "work-completed", "decision-proposed",
  "decision-resolved", "artifact-added", "governed-action", "external-event",
  "verification", "receipt", "cycle-opened", "cycle-closed",
]);

/** Project the execution journal using the same row contract as its receipts. */
export function roomActivitiesFromCapsuleActivity(
  rows: readonly WorkCapsuleActivityRow[],
  capsuleIdByRowId: ReadonlyMap<string, string>,
): WorkroomActivityInput[] {
  return rows.map((row) => ({
    sourceEventId: row.id,
    kind: KNOWN_ACTIVITY_KINDS.has(row.kind as WorkroomActivityKind)
      ? (row.kind as WorkroomActivityKind)
      : "external-event",
    occurredAt: row.recordedAt,
    actorRef: {
      actorKind: row.recordedByAgentId ? "agent" : row.recordedById ? "person" : "system",
      actorId: row.recordedByAgentId ?? row.recordedById ?? undefined,
    },
    summary: row.summary,
    sourceRef: {
      kind: "work-capsule",
      id: capsuleIdByRowId.get(row.workCapsuleId) ?? row.workCapsuleId,
      status: row.kind,
    },
  }));
}

function defaultEmphasis(
  kind: WorkroomActivityKind,
): WorkroomActivityView["emphasis"] {
  if (kind === "message") return "quiet";
  if (
    kind === "decision-proposed"
    || kind === "decision-resolved"
    || kind === "artifact-added"
    || kind === "governed-action"
    || kind === "verification"
    || kind === "receipt"
    || kind === "cycle-closed"
  ) {
    return "salient";
  }
  return "normal";
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeWorkroomActivities(
  activities: readonly WorkroomActivityInput[],
): WorkroomActivityView[] {
  const keyed = new Map<string, WorkroomActivityView>();
  for (const activity of activities) {
    const sourceEventId = activity.sourceEventId.trim();
    if (!sourceEventId) continue;
    const eventId = `${activity.sourceRef.kind}:${sourceEventId}`;
    if (keyed.has(eventId)) continue;
    keyed.set(eventId, {
      eventId,
      kind: activity.kind,
      occurredAt: iso(activity.occurredAt),
      actorRef: activity.actorRef,
      summary: activity.summary.trim(),
      emphasis: activity.emphasis ?? defaultEmphasis(activity.kind),
      sourceRef: activity.sourceRef,
      ...(activity.channel ? { channel: activity.channel } : {}),
    });
  }
  return [...keyed.values()];
}
