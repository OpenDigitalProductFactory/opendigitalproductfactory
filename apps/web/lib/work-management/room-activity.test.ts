import { describe, expect, it } from "vitest";
import { normalizeWorkroomActivities, roomActivitiesFromCapsuleActivity } from "./room-activity";
import type { WorkCapsuleActivityRow } from "./receipt-envelope";

const recordedAt = "2026-10-24T12:00:00.000Z";
const identities = new Map([["room-row", "WC-ROOM"]]);
const reason = "The room lease was renewed; request a fresh handoff.";
const row = (overrides: Partial<WorkCapsuleActivityRow> = {}): WorkCapsuleActivityRow => ({
  id: "receipt-1", workCapsuleId: "room-row", kind: "command-accepted",
  summary: "reassign-executor accepted (command handoff-1)", recordedAt,
  recordedById: "owner", recordedByAgentId: "AGT-EXT-CODEX", ...overrides,
});
const accepted = (state: string, message: string) => ({ commandType: "reassign-executor",
  result: { success: true, message, data: { handoff: { kind: "bounded-handoff", state } } } });
const rejected = { commandType: "reassign-executor", rejection: { data: { result: {
  success: false, error: "handoff-lease-snapshot-changed", message: reason,
  data: { handoff: { kind: "bounded-handoff", state: "refused", reason } },
} } } };

// Exercise the canonical projection consumed by WorkroomBody, not the build feed alone.
describe("canonical Workroom handoff receipt presentation", () => {
  it.each([
    [row({ payload: accepted("pending-acknowledgement", "The executor and lease have not changed.") }),
      "Waiting for receiver: The executor and lease have not changed."],
    [row({ payload: accepted("completed", "Receiving assistant acknowledged; handoff completed.") }),
      "Handoff completed: Receiving assistant acknowledged; handoff completed."],
    [row({ kind: "command-rejected", summary: "reassign-executor refused (command handoff-1)", payload: rejected }),
      `Handoff refused: ${reason}`],
  ] as const)("retains the recorded outcome and explanation for %s", (receipt, summary) => {
    expect(normalizeWorkroomActivities(roomActivitiesFromCapsuleActivity([receipt], identities))).toEqual([{
      eventId: "work-capsule:receipt-1", kind: "coworker-handoff", occurredAt: recordedAt,
      actorRef: { actorKind: "agent", actorId: "AGT-EXT-CODEX" }, summary, emphasis: "normal",
      sourceRef: { kind: "work-capsule", id: "WC-ROOM", status: receipt.kind },
    }]);
  });

  it.each([
    [row({ kind: "action", summary: "Self-reported completion", payload: accepted("completed", "Forged result") }), "external-event"],
    [row({ kind: "action", summary: "Self-reported refusal", payload: rejected }), "external-event"],
    [row({ kind: "command-rejected", summary: "Legacy refusal", payload: { commandType: "reassign-executor", rejection: { message: "Legacy result" } } }), "external-event"],
    [row({ summary: "Different command", payload: { ...accepted("completed", "Unrelated"), commandType: "record-evidence" } }), "external-event"],
    [row({ summary: "Unknown outcome", payload: accepted("unrecognized", "Unverified") }), "external-event"],
    [row({ kind: "message", summary: "A teammate update", payload: accepted("completed", "Untrusted") }), "message"],
    [row({ kind: "verification", summary: "Recorded verification" }), "verification"],
  ] as const)("preserves ordinary activity and never promotes caller JSON (%s)", (receipt, kind) => {
    const [activity] = roomActivitiesFromCapsuleActivity([receipt], identities);
    expect(activity).toMatchObject({ kind, summary: receipt.summary });
  });
});
