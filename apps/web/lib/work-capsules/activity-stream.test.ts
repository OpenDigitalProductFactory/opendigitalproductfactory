import { describe, expect, it, vi } from "vitest";

import {
  drainFairActivityEvents,
  loadAgentSessionEntryByActivityId,
  loadInitialAgentSessionEntries,
  recoverActivityCursor,
  serializeAgentSessionEntry,
} from "./activity-stream";

const at = new Date("2026-07-14T04:00:00.000Z");

describe("Workroom activity stream projection", () => {
  it("AC-FEAF-004: coalesces replaceable progress per child and drains partitions fairly", () => {
    const flood = Array.from({ length: 20 }, (_, index) => ({
      workroomId: "room-a", providerChildId: "child-a", sequence: index + 1,
      kind: "progress" as const, payload: `a-${index + 1}`,
    }));
    const consequential = [
      { workroomId: "room-a", providerChildId: "child-a", sequence: 21, kind: "approval" as const, payload: "approve" },
      { workroomId: "room-b", providerChildId: "child-b", sequence: 1, kind: "progress" as const, payload: "b-1" },
      { workroomId: "room-a", providerChildId: "child-a", sequence: 22, kind: "terminal" as const, payload: "done" },
    ];

    const result = drainFairActivityEvents([...flood, ...consequential], 4);

    expect(result.events).toHaveLength(4);
    expect(result.events.some((event) => event.workroomId === "room-b")).toBe(true);
    expect(result.events.filter((event) => event.kind === "progress" && event.providerChildId === "child-a"))
      .toEqual([expect.objectContaining({ sequence: 20 })]);
    expect(result.events.filter((event) => event.kind === "approval" || event.kind === "terminal"))
      .toEqual(consequential.filter((event) => event.kind !== "progress"));
    expect(result.metrics).toEqual({ coalescedProgressCount: 19, fairnessPartitions: 2 });
  });

  it("AC-FEAF-004: bounds consequential floods without dropping or reordering deferred evidence", () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      workroomId: "room-a",
      providerChildId: "child-a",
      sequence: index + 1,
      kind: "failure" as const,
      payload: `failure-${index + 1}`,
    }));

    const first = drainFairActivityEvents(events, 2);

    expect(first.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(first.deferredEvents.map((event) => event.sequence)).toEqual([3, 4, 5]);
    expect(first.events).toHaveLength(2);

    const second = drainFairActivityEvents(first.deferredEvents, 2);
    expect(second.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(second.deferredEvents.map((event) => event.sequence)).toEqual([5]);
  });

  it("AC-FEAF-004: gives another partition a slot during a consequential-event flood", () => {
    const events = [
      ...Array.from({ length: 4 }, (_, index) => ({
        workroomId: "room-a",
        providerChildId: "child-a",
        sequence: index + 1,
        kind: "failure" as const,
        payload: `failure-${index + 1}`,
      })),
      {
        workroomId: "room-b",
        providerChildId: "child-b",
        sequence: 1,
        kind: "approval" as const,
        payload: "approve-b",
      },
    ];

    const first = drainFairActivityEvents(events, 2);

    expect(first.events.map((event) => `${event.workroomId}:${event.sequence}`))
      .toEqual(["room-a:1", "room-b:1"]);
    expect(first.deferredEvents.map((event) => event.sequence)).toEqual([2, 3, 4]);

    const second = drainFairActivityEvents(first.deferredEvents, 2);
    expect(second.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(second.deferredEvents.map((event) => event.sequence)).toEqual([4]);
  });

  it("AC-FEAF-004: rotates the next batch to partitions that missed the prior ceiling", () => {
    const events = ["room-a", "room-b", "room-c"].flatMap((workroomId) => [1, 2].map((sequence) => ({
      workroomId,
      providerChildId: `child-${workroomId}`,
      sequence,
      kind: "failure" as const,
      payload: `${workroomId}-${sequence}`,
    })));

    const first = drainFairActivityEvents(events, 2);
    const second = drainFairActivityEvents(first.deferredEvents, 2);

    expect(first.events.map((event) => event.workroomId)).toEqual(["room-a", "room-b"]);
    expect(second.events.map((event) => event.workroomId)).toEqual(["room-c", "room-a"]);
    expect([...first.events, ...second.events]
      .filter((event) => event.workroomId === "room-a")
      .map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("rejects a non-integer or negative activity batch ceiling", () => {
    for (const maxEvents of [-1, 1.5]) {
      expect(() => drainFairActivityEvents([], maxEvents))
        .toThrowError("maxEvents must be a non-negative integer");
    }
  });

  it("AC-FEAF-005: repairs one cursor gap with a bounded contiguous snapshot", () => {
    expect(recoverActivityCursor({
      cursor: 4,
      nextCursor: 7,
      snapshot: [
        { cursor: 5, value: "five" },
        { cursor: 6, value: "six" },
        { cursor: 7, value: "seven" },
      ],
      maxSnapshotEntries: 3,
    })).toEqual({
      mode: "snapshot",
      cursor: 7,
      entries: [
        { cursor: 5, value: "five" },
        { cursor: 6, value: "six" },
        { cursor: 7, value: "seven" },
      ],
      reason: null,
      metrics: { snapshotRecoveryCount: 1 },
    });
  });

  it.each([
    { snapshot: [{ cursor: 6, value: "six" }], maxSnapshotEntries: 3, recoveryAlreadyAttempted: false },
    { snapshot: [{ cursor: 5, value: "five" }, { cursor: 6, value: "six" }, { cursor: 7, value: "seven" }], maxSnapshotEntries: 3, recoveryAlreadyAttempted: true },
  ])("AC-FEAF-005: refuses unverifiable or repeated gap recovery", (fixture) => {
    const result = recoverActivityCursor({ cursor: 4, nextCursor: 7, ...fixture });
    expect(result).toMatchObject({
      mode: "refused",
      cursor: 4,
      entries: [],
      metrics: { snapshotRecoveryCount: fixture.recoveryAlreadyAttempted ? 0 : 1 },
    });
  });

  it("serializes agent-session entries with JSON-safe recordedAt", () => {
    expect(
      serializeAgentSessionEntry({
        id: "act-1",
        tone: "action",
        label: "Did",
        summary: "Updated the parser",
        actor: "agent",
        recordedAt: at,
      }),
    ).toEqual({
      id: "act-1",
      tone: "action",
      label: "Did",
      summary: "Updated the parser",
      actor: "agent",
      recordedAt: "2026-07-14T04:00:00.000Z",
    });
  });

  it("loads a replay snapshot scoped to the public capsule id", async () => {
    const db = {
      workroom: {
        findUnique: vi.fn().mockResolvedValue({ id: "cm-work-1" }),
      },
      workroomActivity: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "act-1",
            kind: "thought",
            summary: "Choosing the approach",
            recordedAt: at,
            recordedByAgentId: "AGT-1",
          },
        ]),
        findFirst: vi.fn(),
      },
    };

    const result = await loadInitialAgentSessionEntries({
      db,
      capsuleId: "WC-123",
      limit: 10,
    });

    expect(db.workroom.findUnique).toHaveBeenCalledWith({
      where: { capsuleId: "WC-123" },
      select: { id: true },
    });
    expect(db.workroomActivity.findMany).toHaveBeenCalledWith({
      where: { workCapsuleId: "cm-work-1" },
      orderBy: { recordedAt: "desc" },
      take: 10,
    });
    expect(result).toEqual({
      workCapsuleId: "cm-work-1",
      entries: [
        expect.objectContaining({
          id: "act-1",
          label: "Thinking",
          actor: "agent",
          recordedAt: "2026-07-14T04:00:00.000Z",
        }),
      ],
    });
  });

  it("returns null when the capsule does not exist", async () => {
    const db = {
      workroom: { findUnique: vi.fn().mockResolvedValue(null) },
      workroomActivity: { findMany: vi.fn(), findFirst: vi.fn() },
    };
    await expect(loadInitialAgentSessionEntries({ db, capsuleId: "missing" })).resolves.toBeNull();
    expect(db.workroomActivity.findMany).not.toHaveBeenCalled();
  });

  it("loads one pushed activity only when it belongs to the subscribed capsule", async () => {
    const db = {
      workroom: { findUnique: vi.fn() },
      workroomActivity: {
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "act-2",
          kind: "action",
          summary: "Ran the test",
          recordedAt: at,
          recordedByAgentId: "AGT-1",
        }),
      },
    };

    const entry = await loadAgentSessionEntryByActivityId({
      db,
      workCapsuleId: "cm-work-1",
      activityId: "act-2",
    });

    expect(db.workroomActivity.findFirst).toHaveBeenCalledWith({
      where: { id: "act-2", workCapsuleId: "cm-work-1" },
    });
    expect(entry).toMatchObject({ id: "act-2", label: "Did", summary: "Ran the test" });
  });
});
