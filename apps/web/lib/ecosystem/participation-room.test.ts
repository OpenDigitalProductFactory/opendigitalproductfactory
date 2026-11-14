import { describe, expect, it, vi } from "vitest";

import {
  ECOSYSTEM_ROOM_CASE_KEY,
  ECOSYSTEM_ROOM_SOURCE_ID,
  ECOSYSTEM_ROOM_SOURCE_TYPE,
  ensureEcosystemParticipationRoom,
} from "./participation-room";

const db = (existing: { id: string; itemId: string; assignedToUserId: string | null } | null) => ({
  workQueue: { upsert: vi.fn().mockResolvedValue({ id: "q1" }) },
  workItem: {
    findFirst: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockImplementation(async ({ data }) => ({
      id: "w-new", itemId: "WI-NEW", assignedToUserId: data.assignedToUserId ?? null,
    })),
  },
});

describe("ensureEcosystemParticipationRoom", () => {
  it("reuses the live standing room rather than creating a second", async () => {
    const d = db({ id: "w1", itemId: "WI-1", assignedToUserId: "u1" });
    const room = await ensureEcosystemParticipationRoom(d, { ownerUserId: "u2" });
    expect(room).toMatchObject({ id: "w1", caseKey: ECOSYSTEM_ROOM_CASE_KEY, assignedToUserId: "u1" });
    expect(d.workItem.create).not.toHaveBeenCalled();
  });

  it("derives the room on first use, keyed by purpose, never authored per install", async () => {
    const d = db(null);
    const room = await ensureEcosystemParticipationRoom(d, { ownerUserId: "u-owner" });
    const data = d.workItem.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      sourceType: ECOSYSTEM_ROOM_SOURCE_TYPE,
      sourceId: ECOSYSTEM_ROOM_SOURCE_ID,
      status: "in-progress",
      assignedToUserId: "u-owner",
    });
    expect(room.caseKey).toBe(ECOSYSTEM_ROOM_CASE_KEY);
  });

  it("leaves the room unassigned when no accountable human is recorded, rather than guessing", async () => {
    const d = db(null);
    await ensureEcosystemParticipationRoom(d, { ownerUserId: null });
    expect(d.workItem.create.mock.calls[0][0].data).not.toHaveProperty("assignedToUserId");
  });
});
