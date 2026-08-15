import { describe, expect, it, vi } from "vitest";

import {
  loadAgentSessionEntryByActivityId,
  loadInitialAgentSessionEntries,
  serializeAgentSessionEntry,
} from "./activity-stream";

const at = new Date("2026-07-14T04:00:00.000Z");

describe("Workroom activity stream projection", () => {
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
