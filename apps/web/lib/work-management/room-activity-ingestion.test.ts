import { describe, expect, it, vi } from "vitest";
// These are input/projection unit tests. The SQL executes only in the separately
// admitted PostgreSQL qualification; a query mock is not database evidence.
vi.mock("@dpf/db", () => ({ Prisma: { sql: vi.fn(), join: vi.fn() } }));
import { freezeActivityWindows, readActivityWindowPage } from "./room-activity-ingestion.server";

function database(rows: unknown[]) {
  const query = vi.fn(async () => rows);
  return { query, db: { $queryRaw: query } as never };
}

describe("bounded Workroom ingestion reads", () => {
  it.each(["-1", "1.5", "01", "9223372036854775808", "1 OR true"])(
    "rejects invalid position %s before querying", async position => {
      const { db, query } = database([]);
      await expect(readActivityWindowPage(db, { roomId: "room", after: position, highWater: "10", take: 10 }))
        .rejects.toThrow("position");
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([0, 201, 1.5, NaN])("rejects unsafe page size %s", async take => {
    const { db, query } = database([]);
    await expect(readActivityWindowPage(db, { roomId: "room", after: "0", highWater: "10", take }))
      .rejects.toThrow("page");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a cursor beyond the frozen boundary", async () => {
    const { db, query } = database([]);
    await expect(readActivityWindowPage(db, { roomId: "room", after: "11", highWater: "10", take: 20 }))
      .rejects.toThrow("boundary");
    expect(query).not.toHaveBeenCalled();
  });

  it("preserves positions above JavaScript's safe integer limit and unknown retention", async () => {
    const { db } = database([{ id: "event", ingestionSequence: "9007199254740993" }]);
    const page = await readActivityWindowPage(db, {
      roomId: "room", after: "9007199254740992", highWater: "9007199254740994", take: 20,
    });
    expect(page.rows[0]!.ingestionSequence).toBe("9007199254740993");
    expect(page.coverage).toBe("retention-unverified");
    expect(() => JSON.stringify(page)).not.toThrow();
  });

  it("does not treat missing rooms as an empty complete window", async () => {
    const { db } = database([{ roomId: "present", highWater: "0" }]);
    await expect(freezeActivityWindows(db, ["present", "missing"])).rejects.toThrow("missing");
  });

  it("bounds and deduplicates the authorized room input before querying", async () => {
    const { db, query } = database([]);
    await expect(freezeActivityWindows(db, ["room", "room"])).rejects.toThrow("duplicate");
    await expect(freezeActivityWindows(db, Array.from({ length: 10_001 }, (_, i) => String(i))))
      .rejects.toThrow("10000");
    expect(query).not.toHaveBeenCalled();
  });
});
