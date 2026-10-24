import { describe, expect, it, vi } from "vitest";

import { parseAfterSequence, readActivityAfter } from "./activity-log-read";

// BI-62514632: read the room's log from a position, oldest first, paged.
describe("parseAfterSequence", () => {
  it.each([
    [undefined, undefined], [null, undefined], ["", undefined],
    [0, 0], [42, 42], ["7", 7],
    [-1, null], [1.5, null], ["x", null], [{}, null],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseAfterSequence(raw)).toBe(expected);
  });
});

describe("readActivityAfter", () => {
  it("asks for rows after the position, oldest first, and reports more", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, sequence: 11 + i }));
    const db = { workroomActivity: { findMany: vi.fn(async (_args: unknown) => rows) } };

    const result = await readActivityAfter(db, { workCapsuleId: "row-1", afterSequence: 10, limit: 3 });

    expect(db.workroomActivity.findMany).toHaveBeenCalledWith({
      where: { workCapsuleId: "row-1", sequence: { gt: 10 } },
      orderBy: { sequence: "asc" },
      take: 4,
    });
    expect(result).toEqual({ activity: rows.slice(0, 3), hasMore: true });
  });

  it("caps the page at 200", async () => {
    const db = { workroomActivity: { findMany: vi.fn(async (_args: unknown) => [] as unknown[]) } };
    await readActivityAfter(db, { workCapsuleId: "row-1", afterSequence: 0, limit: 10_000 });
    expect(db.workroomActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 201 }));
  });
});
