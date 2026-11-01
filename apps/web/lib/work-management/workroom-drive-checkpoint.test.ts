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
    expect(checkpoint).not.toHaveProperty("source");
    expect(readDispatchCheckpoint(checkpoint)).toEqual(checkpoint);
  });
  it("retains the source snapshot that produced the dispatch without sharing mutable input", () => {
    const source = { repositoryFullName: "owner/repo", headSha: "a".repeat(40) };
    const checkpoint = buildDispatchCheckpoint(null, { ...input, source });
    expect(checkpoint).toMatchObject({ source });
    expect(checkpoint.source).not.toBe(source);
    expect(readDispatchCheckpoint(checkpoint)?.source).toEqual(source);
    source.headSha = "b".repeat(40);
    expect(checkpoint.source?.headSha).toBe("a".repeat(40));
  });
  it("preserves explicitly unknown repository source on non-source work", () => {
    const source = { repositoryFullName: null, headSha: null };
    expect(buildDispatchCheckpoint(null, { ...input, source })).toMatchObject({ source });
  });
  it.each([
    null,
    {},
    { repositoryFullName: "owner/repo" },
    { repositoryFullName: null, headSha: 7 },
    { repositoryFullName: "", headSha: null },
    { repositoryFullName: 7, headSha: null },
    { repositoryFullName: null, headSha: "" },
  ])("refuses malformed source provenance instead of treating it as legacy unknown: %j", (source) => {
    expect(readDispatchCheckpoint({ ...buildDispatchCheckpoint(null, input), source })).toBeNull();
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
