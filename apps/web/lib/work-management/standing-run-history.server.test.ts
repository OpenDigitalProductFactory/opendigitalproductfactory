import { describe, expect, it, vi } from "vitest";
import { loadStandingRhythms } from "./standing-run-history.server";

const now = new Date("2026-11-10T15:00:00.000Z");

function db(rooms: unknown[], rows: unknown[], earlier: unknown[] = []) {
  const findMany = vi.fn()
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(earlier);
  return {
    workroom: { findMany: vi.fn().mockResolvedValue(rooms) },
    workroomActivity: { findMany },
  };
}

describe("loadStandingRhythms", () => {
  it("reads only live standing rooms", async () => {
    const reader = db([], []);
    expect(await loadStandingRhythms(reader as never, now)).toEqual([]);
    expect(reader.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ archivedAt: null, idempotencyKey: { startsWith: "standing-room:" } }),
    }));
    expect(reader.workroomActivity.findMany).not.toHaveBeenCalled();
  });

  it("builds each room's rhythm from its drive rows and its snapshot's run key", async () => {
    const reader = db(
      [{ id: "row-1", capsuleId: "WC-1", title: "Payables", workspaceState: { workroomDrive: { runKey: "payables-watch@1.1.0:2026-11-09" } } }],
      [
        { workCapsuleId: "row-1", recordedAt: new Date("2026-11-09T00:15:00Z"), payload: { runKey: "payables-watch@1.1.0:2026-11-09", action: "dispatch_agent", reason: "agent_stage" } },
        { workCapsuleId: "row-1", recordedAt: new Date("2026-11-09T08:00:00Z"), payload: { runKey: "payables-watch@1.1.0:2026-11-09", action: "stop", reason: "success" } },
        { workCapsuleId: "row-1", recordedAt: new Date("2026-11-08T08:00:00Z"), payload: { action: "stop", reason: "success" } },
      ],
    );
    const [room] = await loadStandingRhythms(reader as never, now);
    expect(room?.capsuleId).toBe("WC-1");
    expect(room?.rhythm.slots.find((slot) => slot.date === "2026-11-09")?.state).toBe("on-time");
    expect(room?.rhythm.slots.at(-1)?.state).toBe("due");
    // The row without a run key predates run keys and is not read as a run.
    expect(room?.rhythm.slots.find((slot) => slot.date === "2026-11-08")?.state).toBe("no-record");
  });

  it("dates history from a run recorded before the window", async () => {
    const reader = db(
      [{ id: "row-1", capsuleId: "WC-1", title: "Payables", workspaceState: { workroomDrive: { runKey: "payables-watch@1.1.0:2026-11-09" } } }],
      [{ workCapsuleId: "row-1", recordedAt: new Date("2026-11-09T08:00:00Z"), payload: { runKey: "payables-watch@1.1.0:2026-11-09", action: "stop", reason: "success" } }],
      [{ workCapsuleId: "row-1", recordedAt: new Date("2026-10-08T00:15:00Z") }],
    );
    const [room] = await loadStandingRhythms(reader as never, now);
    expect(room?.rhythm.slots[0]?.state).toBe("missed");
    const [windowQuery, earlierQuery] = reader.workroomActivity.findMany.mock.calls;
    // Newest first, so a capped read drops the oldest rows rather than today's.
    expect(windowQuery?.[0]).toMatchObject({ orderBy: { recordedAt: "desc" } });
    expect(earlierQuery?.[0]).toMatchObject({ distinct: ["workCapsuleId"], where: { recordedAt: { lt: new Date("2026-10-28T00:00:00.000Z") } } });
  });
});
