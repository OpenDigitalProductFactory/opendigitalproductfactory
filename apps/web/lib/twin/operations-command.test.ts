import { describe, expect, it, vi } from "vitest";

import {
  beginOperationalCommand,
  createOperationalCommandBoundary,
  initialOperationalUiState,
  reconcileOperationalCommand,
  type OperationalAssignmentCommand,
} from "./operations-command";

const command: OperationalAssignmentCommand = {
  kind: "assign",
  idempotencyKey: "seat-party-p1-table-t1",
  expectedVersion: "ops-v1-a1",
  interval: {
    startsAt: "2026-07-28T18:00:00.000Z",
    endsAt: "2026-07-28T19:30:00.000Z",
  },
  entityRefs: {
    demandId: "party-p1",
    resourceIds: ["table-t1"],
  },
};

describe("operational command boundary", () => {
  it("collapses concurrent retries and replays the settled result for the same command", async () => {
    const executeAtomically = vi.fn(async () => ({
      status: "confirmed" as const,
      newVersion: "ops-v1-a2",
      changedFacts: [{ entityId: "party-p1", field: "resourceId", value: "table-t1" }],
    }));
    const boundary = createOperationalCommandBoundary({ executeAtomically });

    const [first, concurrent] = await Promise.all([
      boundary.execute(command),
      boundary.execute(command),
    ]);
    const replay = await boundary.execute(command);

    expect(executeAtomically).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ status: "confirmed", replayed: false, newVersion: "ops-v1-a2" });
    expect(concurrent).toEqual(first);
    expect(replay).toMatchObject({ status: "confirmed", replayed: true, newVersion: "ops-v1-a2" });
  });

  it("rejects reuse of an idempotency key for a different intent", async () => {
    const boundary = createOperationalCommandBoundary({
      executeAtomically: async () => ({
        status: "confirmed",
        newVersion: "ops-v1-a2",
        changedFacts: [],
      }),
    });
    await boundary.execute(command);

    const result = await boundary.execute({
      ...command,
      entityRefs: { ...command.entityRefs, resourceIds: ["table-t2"] },
    });

    expect(result).toMatchObject({
      status: "rejected",
      reasonCode: "idempotency-key-reused",
      replayed: false,
    });
  });

  it("lets the durable adapter confirm one competing assignment and conflict the other", async () => {
    let currentVersion = command.expectedVersion;
    let assignedResourceId: string | null = null;
    const boundary = createOperationalCommandBoundary({
      executeAtomically: async (candidate) => {
        if (
          candidate.expectedVersion !== currentVersion ||
          assignedResourceId === candidate.entityRefs.resourceIds[0]
        ) {
          return {
            status: "conflict",
            currentVersion,
            changedFacts: assignedResourceId
              ? [{ entityId: assignedResourceId, field: "availability", value: "occupied" }]
              : [],
            alternatives: [{ resourceIds: ["table-t2"], label: "Use Table 2" }],
          };
        }
        assignedResourceId = candidate.entityRefs.resourceIds[0] ?? null;
        currentVersion = "ops-v1-a2";
        return {
          status: "confirmed",
          newVersion: currentVersion,
          changedFacts: assignedResourceId
            ? [{ entityId: assignedResourceId, field: "availability", value: "occupied" }]
            : [],
        };
      },
    });

    const [first, second] = await Promise.all([
      boundary.execute(command),
      boundary.execute({
        ...command,
        idempotencyKey: "seat-party-p2-table-t1",
        entityRefs: { ...command.entityRefs, demandId: "party-p2" },
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual(["confirmed", "conflict"]);
    expect(first).toMatchObject({ status: "confirmed", newVersion: "ops-v1-a2" });
    expect(second).toMatchObject({
      status: "conflict",
      currentVersion: "ops-v1-a2",
      alternatives: [{ resourceIds: ["table-t2"], label: "Use Table 2" }],
    });
  });

  it("keeps optimistic state visibly pending, then rolls back and reconciles on conflict", () => {
    const selected = {
      ...initialOperationalUiState("ops-v1-a1"),
      selectedEntityIds: ["party-p1"],
    };
    const pending = beginOperationalCommand(selected, command, ["table-t1"]);

    expect(pending.pending).toMatchObject({ idempotencyKey: command.idempotencyKey });
    expect(pending.selectedEntityIds).toEqual(["table-t1"]);

    const reconciled = reconcileOperationalCommand(pending, {
      status: "conflict",
      idempotencyKey: command.idempotencyKey,
      replayed: false,
      currentVersion: "ops-v1-a3",
      changedFacts: [{ entityId: "table-t1", field: "availability", value: "occupied" }],
      alternatives: [{ resourceIds: ["table-t2"], label: "Use Table 2" }],
    });

    expect(reconciled.pending).toBeNull();
    expect(reconciled.selectedEntityIds).toEqual(["party-p1"]);
    expect(reconciled.snapshotVersion).toBe("ops-v1-a3");
    expect(reconciled.conflict?.alternatives[0]?.resourceIds).toEqual(["table-t2"]);
  });

  it("rejects malformed intervals before calling the durable adapter", async () => {
    const executeAtomically = vi.fn();
    const boundary = createOperationalCommandBoundary({ executeAtomically });

    const result = await boundary.execute({
      ...command,
      interval: { ...command.interval, endsAt: command.interval.startsAt },
    });

    expect(result).toMatchObject({ status: "rejected", reasonCode: "invalid-interval" });
    expect(executeAtomically).not.toHaveBeenCalled();
  });
});
