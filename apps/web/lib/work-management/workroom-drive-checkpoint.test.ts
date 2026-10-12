import { describe, expect, it } from "vitest";
import { buildDispatchCheckpoint, readDispatchCheckpoint } from "./workroom-drive-checkpoint";

const input = {
  taskId: "scheduled-stage", roomId: "room-row", objective: "Review evidence",
  stage: { shapeKey: "watch", shapeVersion: "1.0.0", stageKey: "review", tools: ["read_evidence"] },
  holderPrincipalId: "principal", leaseExpiresAt: "2026-10-07T23:30:00.000Z",
  now: "2026-10-07T23:00:00.000Z",
};

describe("durable dispatch checkpoint", () => {
  it("confirms enqueue only and leaves unavailable provenance explicitly unknown", () => {
    const checkpoint = buildDispatchCheckpoint(null, input);
    expect(checkpoint).toMatchObject({ version: 1, revision: 1, objective: input.objective,
      remainingAcceptance: null, artifacts: null, dirtyOutputs: null,
      confirmedEffect: { kind: "scheduled-task-enqueued", taskId: input.taskId },
      nextAction: "reconcile-scheduled-task", pendingIntent: null,
      authority: { holderPrincipalId: "principal", leaseExpiresAt: input.leaseExpiresAt },
    });
    expect(readDispatchCheckpoint(checkpoint)).toEqual(checkpoint);
  });
  it("advances the locked row revision without overwriting earlier observations", () => {
    const first = buildDispatchCheckpoint(null, input);
    const second = buildDispatchCheckpoint(first, { ...input, taskId: "another-branch" });
    expect(second.revision).toBe(2);
    expect(first.confirmedEffect.taskId).toBe(input.taskId);
  });
  it("refuses an unreadable existing checkpoint instead of resetting its revision", () => {
    expect(() => buildDispatchCheckpoint({ version: 2, revision: 10 }, input)).toThrow(/checkpoint/i);
    expect(readDispatchCheckpoint({ version: 1, revision: 1 })).toBeNull();
  });
});
