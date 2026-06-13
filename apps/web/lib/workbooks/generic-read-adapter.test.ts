import { describe, it, expect } from "vitest";
import {
  toCell,
  genericRowToGridRow,
  genericColumnDefs,
  referenceLabelField,
  buildReferenceSearchArgs,
  type GenericTableConfig,
} from "./generic-read-adapter";
import { customColumnProvenance } from "./types";

const config: GenericTableConfig = {
  entityType: "epic",
  prismaModel: "epic",
  idField: "epicId",
  columns: [
    { field: "epicId", name: "ID", fieldType: "text" },
    { field: "title", name: "Title", fieldType: "text" },
    { field: "status", name: "Status", fieldType: "select", groupable: true, options: [{ key: "open", label: "Open" }] },
    { field: "priority", name: "Priority", fieldType: "number" },
    { field: "updatedAt", name: "Updated", fieldType: "datetime" },
  ],
};

describe("toCell", () => {
  it("coerces by declared field type", () => {
    expect(toCell("number", 5)).toBe(5);
    expect(toCell("number", null)).toBeNull();
    expect(toCell("datetime", new Date("2026-06-07T00:00:00.000Z"))).toBe("2026-06-07T00:00:00.000Z");
    expect(toCell("checkbox", 1)).toBe(true);
    expect(toCell("text", 42)).toBe("42");
    expect(toCell("multi_select", null)).toEqual([]);
  });
});

describe("genericRowToGridRow", () => {
  it("maps a Prisma record to a grid row keyed by field, rowId from idField", () => {
    const row = genericRowToGridRow(config, {
      epicId: "EP-1",
      title: "Universal Grid",
      status: "open",
      priority: 2,
      updatedAt: new Date("2026-06-07T10:00:00.000Z"),
    });
    expect(row.rowId).toBe("EP-1");
    expect(row.cells.title).toBe("Universal Grid");
    expect(row.cells.status).toBe("open");
    expect(row.cells.priority).toBe(2);
    expect(row.cells.updatedAt).toBe("2026-06-07T10:00:00.000Z");
  });

  it("does not include unconfigured fields (allow-list only)", () => {
    const row = genericRowToGridRow(config, {
      epicId: "EP-2",
      title: "x",
      status: "open",
      priority: 1,
      updatedAt: new Date(),
      secretField: "should-not-leak",
    });
    expect(row.cells).not.toHaveProperty("secretField");
  });
});

describe("referenceLabelField", () => {
  it("prefers an explicit labelField", () => {
    expect(referenceLabelField({ ...config, labelField: "status" })).toBe("status");
  });

  it("defaults to the first text column after the id field", () => {
    expect(referenceLabelField(config)).toBe("title");
  });

  it("falls back to the id field when no other text column exists", () => {
    const idOnly: GenericTableConfig = {
      entityType: "thing",
      prismaModel: "thing",
      idField: "thingId",
      columns: [
        { field: "thingId", name: "ID", fieldType: "text" },
        { field: "count", name: "Count", fieldType: "number" },
      ],
    };
    expect(referenceLabelField(idOnly)).toBe("thingId");
  });
});

describe("buildReferenceSearchArgs", () => {
  it("filters by a case-insensitive contains on the label field and caps results", () => {
    const args = buildReferenceSearchArgs(config, "  grid  ");
    expect(args.where).toEqual({ title: { contains: "grid", mode: "insensitive" } });
    expect(args.select).toEqual({ epicId: true, title: true });
    expect(args.orderBy).toEqual({ title: "asc" });
    expect(args.take).toBe(20);
  });

  it("returns an unfiltered (capped) query for a blank search", () => {
    const args = buildReferenceSearchArgs(config, "   ");
    expect(args.where).toEqual({});
    expect(args.take).toBe(20);
  });
});

describe("genericColumnDefs", () => {
  it("produces read-only column definitions in config order", () => {
    const cols = genericColumnDefs(config);
    expect(cols.map((c) => c.columnId)).toEqual(["epicId", "title", "status", "priority", "updatedAt"]);
    expect(cols.every((c) => c.editable === false)).toBe(true);
    const status = cols.find((c) => c.columnId === "status");
    expect(status?.groupable).toBe(true);
    expect(status?.config?.options?.[0].key).toBe("open");
  });

  it("marks every generic (platform) column as system provenance", () => {
    const cols = genericColumnDefs(config);
    expect(cols.every((c) => c.provenanceKind === "system")).toBe(true);
  });
});

describe("customColumnProvenance", () => {
  it("derives derived for computed types and manual otherwise", () => {
    expect(customColumnProvenance("formula")).toBe("derived");
    expect(customColumnProvenance("lookup")).toBe("derived");
    expect(customColumnProvenance("text")).toBe("manual");
    expect(customColumnProvenance("reference")).toBe("manual");
    expect(customColumnProvenance("number")).toBe("manual");
  });
});
