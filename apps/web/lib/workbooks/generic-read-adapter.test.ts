import { describe, it, expect, beforeEach } from "vitest";
import {
  toCell,
  genericRowToGridRow,
  genericColumnDefs,
  referenceLabelField,
  buildReferenceSearchArgs,
  genericUpdateData,
  makeGenericReadAdapter,
  resolveRollups,
  type GenericTableConfig,
  type GroupByRunner,
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

const editableConfig: GenericTableConfig = {
  entityType: "supplier",
  prismaModel: "supplier",
  idField: "supplierId",
  labelField: "name",
  editableFields: ["name", "status"],
  columns: [
    { field: "supplierId", name: "ID", fieldType: "text" },
    { field: "name", name: "Name", fieldType: "text" },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      options: [
        { key: "active", label: "Active" },
        { key: "inactive", label: "Inactive" },
      ],
    },
    { field: "taxId", name: "Tax ID", fieldType: "text" },
  ],
};

describe("genericColumnDefs — editability", () => {
  it("marks only editableFields editable, never the id field", () => {
    const cols = genericColumnDefs(editableConfig);
    const byId = Object.fromEntries(cols.map((c) => [c.columnId, c.editable]));
    expect(byId.name).toBe(true);
    expect(byId.status).toBe(true);
    expect(byId.taxId).toBe(false);
    expect(byId.supplierId).toBe(false);
  });

  it("read-only config (no editableFields) marks nothing editable", () => {
    expect(genericColumnDefs(config).every((c) => c.editable === false)).toBe(true);
  });
});

describe("genericUpdateData — validated raw-write tier", () => {
  it("builds a validated data object for allow-listed fields", () => {
    expect(genericUpdateData(editableConfig, { name: "Acme", status: "active" })).toEqual({
      name: "Acme",
      status: "active",
    });
  });

  it("rejects editing the id field", () => {
    expect(() => genericUpdateData(editableConfig, { supplierId: "X" })).toThrow(/cannot be edited/i);
  });

  it("rejects a non-allow-listed field (fail-closed)", () => {
    expect(() => genericUpdateData(editableConfig, { taxId: "123" })).toThrow(/not editable/i);
  });

  it("rejects an invalid select option", () => {
    expect(() => genericUpdateData(editableConfig, { status: "bogus" })).toThrow(/unknown option/i);
  });

  it("allows clearing a field to null", () => {
    expect(genericUpdateData(editableConfig, { name: null })).toEqual({ name: null });
  });
});

describe("generic adapter getCapabilities", () => {
  it("is editable only with canManage AND editableFields", () => {
    const editable = makeGenericReadAdapter(editableConfig);
    expect(editable.getCapabilities({ userId: "u", canManage: true }).canEditCell).toBe(true);
    expect(editable.getCapabilities({ userId: "u", canManage: false }).canEditCell).toBe(false);
    const readonly = makeGenericReadAdapter(config);
    expect(readonly.getCapabilities({ userId: "u", canManage: true }).canEditCell).toBe(false);
  });
});

// BI-00CB9CCC. The People grid must not write to an HR record via the raw Prisma
// tier — EmployeeProfile owns a governed action that lands an AuthorizationDecisionLog,
// and a grid edit has to inherit it. These lock the seam that guarantees that.
describe("generic adapter updateCells — governed write-through", () => {
  const calls: Array<{ rowId: string; data: Record<string, unknown> }> = [];

  function configWithWriteThrough(
    result: { ok: boolean; message: string },
  ): GenericTableConfig {
    return {
      ...editableConfig,
      writeThrough: async (rowId, data) => {
        calls.push({ rowId, data });
        return result;
      },
    };
  }

  beforeEach(() => {
    calls.length = 0;
  });

  /** updateCells is optional on DataSourceAdapter; narrow it once, loudly. */
  function updateCellsOf(result: { ok: boolean; message: string }) {
    const adapter = makeGenericReadAdapter(configWithWriteThrough(result));
    const fn = adapter.updateCells?.bind(adapter);
    if (!fn) throw new Error("generic adapter should implement updateCells");
    return fn;
  }

  it("hands the validated data to writeThrough instead of writing Prisma directly", async () => {
    // writeThrough reports failure, which short-circuits before the read-back —
    // so this asserts the seam without needing a live Prisma client.
    const updateCells = updateCellsOf({
      ok: false,
      message: "Governance denied this workforce action.",
    });
    await expect(
      updateCells("supplier", "SUP-1", { name: "Acme" }, { userId: "u", canManage: true }),
    ).rejects.toThrow("Governance denied this workforce action.");

    expect(calls).toEqual([{ rowId: "SUP-1", data: { name: "Acme" } }]);
  });

  it("refuses a non-allow-listed field before writeThrough is ever reached", async () => {
    const updateCells = updateCellsOf({ ok: true, message: "ok" });
    await expect(
      updateCells("supplier", "SUP-1", { taxId: "GB123" }, { userId: "u", canManage: true }),
    ).rejects.toThrow('Field "taxId" is not editable');
    expect(calls).toEqual([]);
  });

  it("refuses without canManage even when a write-through is configured", async () => {
    const updateCells = updateCellsOf({ ok: true, message: "ok" });
    await expect(
      updateCells("supplier", "SUP-1", { name: "Acme" }, { userId: "u", canManage: false }),
    ).rejects.toThrow("You do not have permission to edit this data");
    expect(calls).toEqual([]);
  });
});

const rollupConfig: GenericTableConfig = {
  entityType: "epic",
  prismaModel: "epic",
  idField: "epicId",
  columns: [
    { field: "epicId", name: "ID", fieldType: "text" },
    { field: "title", name: "Title", fieldType: "text" },
  ],
  rollups: [
    {
      field: "itemCount",
      name: "Backlog items",
      targetModel: "backlogItem",
      foreignKeyField: "epicId",
      anchorField: "id", // FK targets the cuid PK, not the semantic epicId
      op: "count",
    },
    {
      field: "totalPoints",
      name: "Total points",
      targetModel: "backlogItem",
      foreignKeyField: "epicId",
      anchorField: "id",
      op: "sum",
      valueField: "points",
    },
  ],
};

describe("genericColumnDefs — rollups", () => {
  it("appends read-only rollup columns with derived provenance", () => {
    const cols = genericColumnDefs(rollupConfig);
    expect(cols.map((c) => c.columnId)).toEqual(["epicId", "title", "itemCount", "totalPoints"]);
    const rollup = cols.find((c) => c.columnId === "itemCount");
    expect(rollup?.fieldType).toBe("rollup");
    expect(rollup?.editable).toBe(false);
    expect(rollup?.provenanceKind).toBe("derived");
  });
});

describe("resolveRollups", () => {
  // Two epics; the records carry the cuid PK (`id`) the FK points at.
  const records = [
    { epicId: "EP-1", id: "cuid-1", title: "Alpha" },
    { epicId: "EP-2", id: "cuid-2", title: "Beta" },
  ];

  it("counts referencing rows per anchor via a single grouped query, joining on the cuid PK", async () => {
    const calls: { model: string; args: unknown }[] = [];
    const runGroupBy: GroupByRunner = async (model, args) => {
      calls.push({ model, args });
      return [
        { epicId: "cuid-1", _count: { _all: 3 } },
        { epicId: "cuid-2", _count: { _all: 1 } },
      ];
    };
    const maps = await resolveRollups({ ...rollupConfig, rollups: [rollupConfig.rollups![0]] }, records, runGroupBy);
    expect(maps.get("itemCount")?.get("cuid-1")).toBe(3);
    expect(maps.get("itemCount")?.get("cuid-2")).toBe(1);
    // one grouped query, scoped to the anchor cuids (not the semantic epicIds)
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("backlogItem");
    expect((calls[0].args as { where: { epicId: { in: string[] } } }).where.epicId.in).toEqual([
      "cuid-1",
      "cuid-2",
    ]);
  });

  it("sums a value field for a sum rollup", async () => {
    const runGroupBy: GroupByRunner = async () => [
      { epicId: "cuid-1", _sum: { points: 13 } },
      { epicId: "cuid-2", _sum: { points: null } },
    ];
    const maps = await resolveRollups({ ...rollupConfig, rollups: [rollupConfig.rollups![1]] }, records, runGroupBy);
    expect(maps.get("totalPoints")?.get("cuid-1")).toBe(13);
    expect(maps.get("totalPoints")?.get("cuid-2")).toBe(0);
  });

  it("skips the query and yields an empty map when there are no rows", async () => {
    let called = false;
    const runGroupBy: GroupByRunner = async () => {
      called = true;
      return [];
    };
    const maps = await resolveRollups(rollupConfig, [], runGroupBy);
    expect(called).toBe(false);
    expect(maps.get("itemCount")?.size).toBe(0);
  });

  it("throws when a sum rollup has no valueField (fail-closed)", async () => {
    const bad: GenericTableConfig = {
      ...rollupConfig,
      rollups: [{ field: "x", name: "X", targetModel: "backlogItem", foreignKeyField: "epicId", op: "sum" }],
    };
    await expect(resolveRollups(bad, records, async () => [])).rejects.toThrow(/valueField/i);
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
