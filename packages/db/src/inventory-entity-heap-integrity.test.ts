import { describe, expect, it, vi } from "vitest";
import {
  assertInventoryEntityHeapIntegrity,
  InventoryEntityIntegrityError,
  lockInventoryEntityKeys,
} from "./inventory-entity-heap-integrity";

function txWithRows(
  rows: Array<{ entityKey: string; heapCount: number }>,
  events: string[] = [],
) {
  return {
    $executeRawUnsafe: vi.fn().mockImplementation(async (query: string) => {
      events.push(query);
      return 0;
    }),
    $queryRawUnsafe: vi.fn().mockImplementation(
      async (query: string, keys: string[] = []) => {
        events.push(query.includes("pg_advisory_xact_lock") ? "lock" : query);
        if (query.includes("current_setting")) {
          return [{
            enableIndexscan: "on",
            enableIndexonlyscan: "on",
            enableBitmapscan: "on",
          }];
        }
        if (query.includes("pg_advisory_xact_lock")) return [];
        expect(keys).toEqual([...new Set(keys)].sort());
        return rows;
      },
    ),
  };
}

describe("assertInventoryEntityHeapIntegrity", () => {
  it("serializes repeated keys in deterministic order before ingestion writes", async () => {
    const tx = txWithRows([]);

    await lockInventoryEntityKeys(tx, ["host:b", "host:a", "host:b"]);

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      ["host:a", "host:b"],
    );
  });

  it("forces heap-backed reads and accepts exactly one row per distinct key", async () => {
    const tx = txWithRows([
      { entityKey: "host:a", heapCount: 1 },
      { entityKey: "host:b", heapCount: 1 },
    ]);

    await expect(assertInventoryEntityHeapIntegrity(
      tx,
      ["host:a", "host:a", "host:b"],
    )).resolves.toBeUndefined();

    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(6);
    expect(tx.$executeRawUnsafe.mock.calls.flat().join(" ")).toContain("enable_indexscan");
    expect(tx.$executeRawUnsafe.mock.calls.flat().join(" ")).toContain("enable_indexonlyscan");
    expect(tx.$executeRawUnsafe.mock.calls.flat().join(" ")).toContain("enable_bitmapscan");
    expect(tx.$executeRawUnsafe.mock.calls.slice(-3).flat().join(" ")).toContain(
      "enable_indexscan = on",
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FROM "InventoryEntity"'),
      ["host:a", "host:b"],
    );
    expect(tx.$queryRawUnsafe.mock.calls.flat().join(" ")).toContain("GROUP BY");
  });

  it.each([
    ["missing", 0],
    ["duplicate", 2],
  ])("aborts on a %s heap result", async (_label, heapCount) => {
    const tx = txWithRows([{ entityKey: "host:a", heapCount }]);

    await expect(assertInventoryEntityHeapIntegrity(tx, ["host:a"]))
      .rejects.toMatchObject({
        name: "InventoryEntityIntegrityError",
        code: "INVENTORY_ENTITY_HEAP_INTEGRITY",
      });
    await expect(assertInventoryEntityHeapIntegrity(tx, ["host:a"]))
      .rejects.toThrow(/host:a.*expected 1.*found/);
  });

  it("does not issue a query when the incoming set is empty", async () => {
    const tx = txWithRows([]);
    await assertInventoryEntityHeapIntegrity(tx, []);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("exposes a typed owner-readable integrity failure", () => {
    const error = new InventoryEntityIntegrityError("Inventory integrity failed");
    expect(error.name).toBe("InventoryEntityIntegrityError");
    expect(error.message).toBe("Inventory integrity failed");
  });
});
