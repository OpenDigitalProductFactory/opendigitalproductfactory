import { describe, expect, it, vi } from "vitest";
import { readBoundEditPaths, readBoundWorkShapeRef } from "./bound-work-shape";

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

// BI-243BC956: the declared edit scope is the change fact sensitivity reads.
describe("readBoundEditPaths", () => {
  const at = "2026-09-25T00:00:00.000Z";
  const claim = (kind: string, value: string, intent: string) => ({ kind, value, intent, recordedAt: at, recordedByPrincipalId: "p" });

  it("returns the live room's edit path claims, ignoring reads and the shape entry", async () => {
    const scopeClaims = [
      { workShape: "delivery-small@1.0.0", recordedAt: at },
      claim("path", "packages/db/prisma/schema.prisma", "edit"),
      claim("path", "apps/web/lib/auth.ts", "read"),
      claim("module", "apps/web/lib/finance", "edit"),
    ];
    const db = { workroom: { findFirst: vi.fn(async () => ({ scopeClaims })) } };
    expect(await readBoundEditPaths(db, "row-1")).toEqual(["packages/db/prisma/schema.prisma", "apps/web/lib/finance"]);
  });

  it("falls back to the newest closed room when the live one declared no edits", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ scopeClaims: [{ workShape: "delivery-small@1.0.0", recordedAt: at }] })
      .mockResolvedValueOnce({ scopeClaims: [claim("path", "scripts/pregate.mjs", "edit")] });
    expect(await readBoundEditPaths({ workroom: { findFirst } }, "row-1")).toEqual(["scripts/pregate.mjs"]);
  });

  it("is empty when no room declared any edit scope", async () => {
    expect(await readBoundEditPaths({ workroom: { findFirst: vi.fn(async () => null) } }, "row-2")).toEqual([]);
  });
});
