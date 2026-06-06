import { describe, it, expect } from "vitest";
import {
  BACKLOG_COLUMNS,
  backlogItemToGridRow,
  buildBacklogInput,
  type BacklogEditableExisting,
} from "./backlog-adapter-mapping";

describe("BACKLOG_COLUMNS", () => {
  it("exposes the expected columns keyed by field name", () => {
    const keys = BACKLOG_COLUMNS.map((c) => c.columnId);
    expect(keys).toEqual(
      expect.arrayContaining(["itemId", "title", "status", "priority", "type", "workType", "source", "body", "updatedAt"]),
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
      body: "details",
      updatedAt: new Date("2026-06-06T10:00:00.000Z"),
    });
    expect(row.rowId).toBe("BI-1");
    expect(row.cells.title).toBe("Fix login");
    expect(row.cells.status).toBe("open");
    expect(row.cells.priority).toBe(3);
    expect(row.cells.updatedAt).toBe("2026-06-06T10:00:00.000Z");
  });
});

describe("buildBacklogInput", () => {
  const existing: BacklogEditableExisting = {
    title: "Old title",
    type: "product",
    status: "open",
    workType: "bug",
    source: "user-request",
    priority: 2,
    body: "old body",
    epicId: "EP-1",
    digitalProductId: "dp-1",
    taxonomyNodeId: null,
  };

  it("overlays a single changed field and preserves the rest", () => {
    const input = buildBacklogInput(existing, { status: "done" });
    expect(input.status).toBe("done");
    expect(input.title).toBe("Old title");
    expect(input.workType).toBe("bug");
    expect(input.type).toBe("product");
    expect(input.digitalProductId).toBe("dp-1");
    expect(input.epicId).toBe("EP-1");
  });

  it("coerces a numeric-string priority to a number", () => {
    const input = buildBacklogInput(existing, { priority: "5" });
    expect(input.priority).toBe(5);
  });

  it("throws when required workType is missing and not supplied", () => {
    const noWorkType = { ...existing, workType: null };
    expect(() => buildBacklogInput(noWorkType, { status: "done" })).toThrow(/work type/i);
  });

  it("accepts a supplied workType for an item that was missing one", () => {
    const noWorkType = { ...existing, workType: null };
    const input = buildBacklogInput(noWorkType, { workType: "chore" });
    expect(input.workType).toBe("chore");
  });

  it("throws when title is cleared", () => {
    expect(() => buildBacklogInput(existing, { title: "  " })).toThrow(/title/i);
  });
});
