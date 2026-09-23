import { describe, expect, it, vi } from "vitest";
import { readBoundWorkShapeRef } from "./bound-work-shape";

const CLAIM = [{ workShape: "delivery-small@1.0.0", recordedAt: "2026-09-23T00:00:00.000Z" }];

describe("readBoundWorkShapeRef", () => {
  it("resolves a semantic item id to the row id the Workroom stores", async () => {
    const findFirst = vi.fn(async (args: { where: { backlogItemId: string } }) =>
      args.where.backlogItemId === "row-1" ? { scopeClaims: CLAIM } : null,
    );
    const db = {
      workroom: { findFirst },
      backlogItem: { findFirst: vi.fn(async () => ({ id: "row-1" })) },
    };
    expect(await readBoundWorkShapeRef(db, "BI-44EDF9A4")).toBe("delivery-small@1.0.0");
    expect(db.backlogItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { itemId: "BI-44EDF9A4" } }));
  });

  it("still accepts a row id directly", async () => {
    const db = {
      workroom: { findFirst: vi.fn(async () => ({ scopeClaims: CLAIM })) },
      backlogItem: { findFirst: vi.fn() },
    };
    expect(await readBoundWorkShapeRef(db, "row-1")).toBe("delivery-small@1.0.0");
    expect(db.backlogItem.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when no room carries a shape", async () => {
    const db = { workroom: { findFirst: vi.fn(async () => null) } };
    expect(await readBoundWorkShapeRef(db, "row-2")).toBeNull();
  });
});
