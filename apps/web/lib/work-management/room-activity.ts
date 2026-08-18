import type { WorkCaseActorRef, WorkCaseSourceRef } from "./case-types";
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
