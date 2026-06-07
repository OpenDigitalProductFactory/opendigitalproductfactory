import { describe, it, expect } from "vitest";
import { gapToBacklogInput, workTypeForDimension, scopeGapToBacklog, type GapForScoping, type GapScopingDb } from "./gap-scoping";

function gap(over: Partial<GapForScoping> = {}): GapForScoping {
  return {
    id: "gap-1",
    status: "open",
    backlogItemId: null,
    dimension: "technology-currency",
    severity: "critical",
    scopeLevel: "portfolio",
    governedThingKind: "InventoryEntity",
    governedThingId: "srv-1",
    title: "host-1 is end-of-life",
    detail: "needs upgrade",
    digitalProductId: null,
    evidenceRef: "discovery-run:R1",
    ...over,
  };
}

describe("workTypeForDimension", () => {
  it("maps dimensions to the closed workType axis", () => {
    expect(workTypeForDimension("vulnerability")).toBe("bug");
    expect(workTypeForDimension("operational")).toBe("bug");
    expect(workTypeForDimension("capability")).toBe("feature");
    expect(workTypeForDimension("technology-currency")).toBe("chore");
    expect(workTypeForDimension("data-quality")).toBe("chore");
    expect(workTypeForDimension("regulatory")).toBe("chore");
  });
});

describe("gapToBacklogInput", () => {
  it("portfolio gap → portfolio item, no product link", () => {
    const d = gapToBacklogInput(gap({ scopeLevel: "portfolio", digitalProductId: "dp-1" }));
    expect(d.type).toBe("portfolio");
    expect(d.digitalProductId).toBeNull(); // portfolio scope drops the product link
    expect(d.title.startsWith("Close gap:")).toBe(true);
  });

  it("product gap → product item with product link", () => {
    const d = gapToBacklogInput(gap({ scopeLevel: "product", digitalProductId: "dp-1" }));
    expect(d.type).toBe("product");
    expect(d.digitalProductId).toBe("dp-1");
  });

  it("body explains the gap/work split (source-truth rule)", () => {
    const d = gapToBacklogInput(gap());
    expect(d.body).toContain("Work status is owned by the backlog, not the gap");
    expect(d.body).toContain("discovery-run:R1");
  });
});

function makeDb(initial: GapForScoping) {
  let stored = { ...initial };
  const calls = { created: 0, updated: 0 };
  const db: GapScopingDb = {
    lifecycleGap: {
      findUnique: async () => stored,
      update: async ({ data }: any) => {
        stored = { ...stored, ...data };
        calls.updated += 1;
        return stored;
      },
    },
    backlogItem: {
      create: async () => {
        calls.created += 1;
        return { id: "rec-1", itemId: "BI-NEW" };
      },
    },
  };
  return { db, calls, get: () => stored };
}

describe("scopeGapToBacklog", () => {
  it("creates a backlog item, links it back, and flips the gap to scoped", async () => {
    const { db, calls, get } = makeDb(gap());
    const res = await scopeGapToBacklog(db, { gapId: "gap-1" });
    expect(res.alreadyLinked).toBe(false);
    expect(res.backlogItemId).toBe("BI-NEW");
    expect(calls.created).toBe(1);
    expect(get().status).toBe("scoped");
    expect(get().backlogItemId).toBe("BI-NEW");
  });

  it("is idempotent — does not create a second item when already linked", async () => {
    const { db, calls } = makeDb(gap({ backlogItemId: "BI-EXISTING", status: "scoped" }));
    const res = await scopeGapToBacklog(db, { gapId: "gap-1" });
    expect(res.alreadyLinked).toBe(true);
    expect(res.backlogItemId).toBe("BI-EXISTING");
    expect(calls.created).toBe(0);
  });

  it("throws when the gap is missing", async () => {
    const db: GapScopingDb = {
      lifecycleGap: { findUnique: async () => null, update: async () => ({}) },
      backlogItem: { create: async () => ({ id: "x", itemId: "y" }) },
    };
    await expect(scopeGapToBacklog(db, { gapId: "nope" })).rejects.toThrow(/not found/);
  });
});
