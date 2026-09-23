import { describe, expect, it, vi } from "vitest";
import { readBoundWorkShapeRef } from "./bound-work-shape";

const CLAIM = [{ workShape: "delivery-small@1.0.0", recordedAt: "2026-09-23T00:00:00.000Z" }];

/** A Workroom table where each room stores its backlogItemId in one form or the other. */
function roomsStoring(stored: string) {
  return vi.fn(async (args: { where: { backlogItemId: string | { in: string[] } } }) => {
    const key = args.where.backlogItemId;
    const matches = typeof key === "string" ? key === stored : key.in.includes(stored);
    return matches ? { scopeClaims: CLAIM } : null;
  });
}

describe("readBoundWorkShapeRef", () => {
  it("resolves a semantic item id to the row id the Workroom stores", async () => {
    const db = {
      workroom: { findFirst: roomsStoring("row-1") },
      backlogItem: { findFirst: vi.fn(async () => ({ id: "row-1" })) },
    };
    expect(await readBoundWorkShapeRef(db, "BI-44EDF9A4")).toBe("delivery-small@1.0.0");
    expect(db.backlogItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { itemId: "BI-44EDF9A4" } }));
  });

  // BI-454451F1: the column holds both forms. Build Studio rooms store the row
  // id (build-studio-attachment.ts); rooms claimed or adopted from a CLI store
  // the semantic id (337 of 439 rooms on the dev install). Resolving to the row
  // id alone made every CLI-claimed item unshaped again.
  it("still finds a room that stores the semantic id", async () => {
    const db = {
      workroom: { findFirst: roomsStoring("BI-44EDF9A4") },
      backlogItem: { findFirst: vi.fn(async () => ({ id: "row-1" })) },
    };
    expect(await readBoundWorkShapeRef(db, "BI-44EDF9A4")).toBe("delivery-small@1.0.0");
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
