import { describe, it, expect } from "vitest";
import {
  BACKLOG_COLUMNS,
  backlogItemToGridRow,
  buildBacklogPatch,
} from "./backlog-adapter-mapping";

describe("BACKLOG_COLUMNS", () => {
  it("exposes the expected columns keyed by field name", () => {
    const keys = BACKLOG_COLUMNS.map((c) => c.columnId);
    expect(keys).toEqual(
      expect.arrayContaining([
        "itemId",
        "title",
        "status",
        "priority",
        "type",
        "workType",
        "source",
        "scopeKind",
        "archetypeCategories",
        "archetypeIds",
        "lifecycleTags",
        "scopeRationale",
        "body",
        "updatedAt",
      ]),
    );
  });

  it("marks identity/timestamp columns read-only and content columns editable", () => {
    const byId = new Map(BACKLOG_COLUMNS.map((c) => [c.columnId, c]));
    expect(byId.get("itemId")?.editable).toBe(false);
    expect(byId.get("updatedAt")?.editable).toBe(false);
    expect(byId.get("title")?.editable).toBe(true);
    expect(byId.get("status")?.editable).toBe(true);
  });

  it("status is a select with options and excludes triaging", () => {
    const status = BACKLOG_COLUMNS.find((c) => c.columnId === "status");
    expect(status?.fieldType).toBe("select");
    const optionKeys = status?.config?.options?.map((o) => o.key) ?? [];
    expect(optionKeys).toContain("open");
    expect(optionKeys).toContain("done");
    expect(optionKeys).not.toContain("triaging");
  });
});

describe("backlogItemToGridRow", () => {
  it("maps a record to a row keyed by field name with ISO date", () => {
    const row = backlogItemToGridRow({
      itemId: "BI-1",
      title: "Fix login",
      status: "open",
      type: "product",
      workType: "bug",
      source: "user-request",
      priority: 3,
      epicId: "EP-X",
      scopeKind: "archetype-category",
      archetypeCategories: ["fabric-care-services"],
      archetypeIds: ["dry-cleaning-plant-network"],
      lifecycleTags: ["claim-ticket", "ready-promise"],
      scopeRationale: "Dry-cleaning vertical gap",
      body: "details",
      updatedAt: new Date("2026-06-06T10:00:00.000Z"),
    });
    expect(row.rowId).toBe("BI-1");
    expect(row.cells.title).toBe("Fix login");
    expect(row.cells.status).toBe("open");
    expect(row.cells.priority).toBe(3);
    expect(row.cells.scopeKind).toBe("archetype-category");
    expect(row.cells.archetypeCategories).toBe("fabric-care-services");
    expect(row.cells.archetypeIds).toBe("dry-cleaning-plant-network");
    expect(row.cells.lifecycleTags).toBe("claim-ticket, ready-promise");
    expect(row.cells.scopeRationale).toBe("Dry-cleaning vertical gap");
    expect(row.cells.updatedAt).toBe("2026-06-06T10:00:00.000Z");
  });
});

describe("buildBacklogPatch", () => {
  it("includes ONLY the changed field (the core of the partial-edit fix)", () => {
    const patch = buildBacklogPatch({ priority: 5 });
    expect(patch).toEqual({ priority: 5 });
  });

  it("does NOT require workType when editing an unrelated field", () => {
    // This is the regression the fix addresses: a priority edit on an item with
    // a null workType must NOT mention or require workType.
    const patch = buildBacklogPatch({ priority: 3 });
    expect(patch).not.toHaveProperty("workType");
    expect(patch).not.toHaveProperty("title");
  });

  it("coerces a numeric-string priority to a number and empty to null", () => {
    expect(buildBacklogPatch({ priority: "7" }).priority).toBe(7);
    expect(buildBacklogPatch({ priority: "" }).priority).toBeNull();
    expect(buildBacklogPatch({ priority: null }).priority).toBeNull();
  });

  it("carries status/type/workType/source when explicitly changed", () => {
    const patch = buildBacklogPatch({ status: "done", type: "portfolio", workType: "chore", source: "user-request" });
    expect(patch).toEqual({ status: "done", type: "portfolio", workType: "chore", source: "user-request" });
  });

  it("carries archetype scope metadata for roadmap and budget planning", () => {
    const patch = buildBacklogPatch({
      scopeKind: "archetype-category",
      archetypeCategories: "fabric-care-services, pet-services",
      archetypeIds: "dry-cleaning-plant-network",
      lifecycleTags: "claim-ticket, ready-promise",
      scopeRationale: "Vertical operating gap",
    });
    expect(patch).toEqual({
      scopeKind: "archetype-category",
      archetypeCategories: ["fabric-care-services", "pet-services"],
      archetypeIds: ["dry-cleaning-plant-network"],
      lifecycleTags: ["claim-ticket", "ready-promise"],
      scopeRationale: "Vertical operating gap",
    });
  });

  it("treats an emptied required select as a no-op (no invalid write)", () => {
    expect(buildBacklogPatch({ status: "" })).toEqual({});
    expect(buildBacklogPatch({ workType: "" })).toEqual({});
  });

  it("normalizes body: trims, empty -> null", () => {
    expect(buildBacklogPatch({ body: "  notes " }).body).toBe("notes");
    expect(buildBacklogPatch({ body: "   " }).body).toBeNull();
  });

  it("throws only when title is explicitly cleared", () => {
    expect(() => buildBacklogPatch({ title: "  " })).toThrow(/title/i);
    expect(buildBacklogPatch({ title: "New" }).title).toBe("New");
  });
});
