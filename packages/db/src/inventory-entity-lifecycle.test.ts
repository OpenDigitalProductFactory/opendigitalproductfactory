import { describe, expect, it, vi } from "vitest";
import { resolveCanonicalInventoryEntityId } from "./inventory-entity-lifecycle";

describe("resolveCanonicalInventoryEntityId", () => {
  it("returns a canonical row unchanged", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "entity-a", mergedIntoId: null });

    await expect(resolveCanonicalInventoryEntityId({
      inventoryEntity: { findUnique },
    }, "entity-a")).resolves.toBe("entity-a");
  });

  it("follows retained merge lineage to the canonical row", async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ id: "entity-old", mergedIntoId: "entity-current" })
      .mockResolvedValueOnce({ id: "entity-current", mergedIntoId: null });

    await expect(resolveCanonicalInventoryEntityId({
      inventoryEntity: { findUnique },
    }, "entity-old")).resolves.toBe("entity-current");
  });

  it("returns null for a missing row and rejects a lineage cycle", async () => {
    await expect(resolveCanonicalInventoryEntityId({
      inventoryEntity: { findUnique: vi.fn().mockResolvedValue(null) },
    }, "missing")).resolves.toBeNull();

    const findUnique = vi.fn()
      .mockResolvedValueOnce({ id: "entity-a", mergedIntoId: "entity-b" })
      .mockResolvedValueOnce({ id: "entity-b", mergedIntoId: "entity-a" });
    await expect(resolveCanonicalInventoryEntityId({
      inventoryEntity: { findUnique },
    }, "entity-a")).rejects.toThrow(/cycle/);
  });
});
