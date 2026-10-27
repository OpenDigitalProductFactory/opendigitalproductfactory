// Authorization + isolation for coworker workbook authoring (BI-FE8DF004).
//
// Workbook has no organization column: a workbook's boundary IS its WorkbookShare
// set. These tests drive the real service share checks over an in-memory Prisma
// stand-in with two owners (alice, bob) and a viewer (carol) and prove that a
// caller can only author inside workbooks shared with them at editor or above.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  workbooks: [] as Row[],
  shares: [] as Row[],
  tables: [] as Row[],
  columns: [] as Row[],
  views: [] as Row[],
}));

const prisma = vi.hoisted(() => {
  const by = (rows: Row[], where: Row) =>
    rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
  return {
    workbook: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => by(db.workbooks, where)),
      create: vi.fn(async ({ data }: { data: Row & { shares: { create: Row } } }) => {
        const wb = { id: `wb-${db.workbooks.length + 1}`, ...data, updatedAt: new Date(0) };
        delete (wb as Row).shares;
        db.workbooks.push(wb);
        db.shares.push({ workbookId: wb.id, ...data.shares.create });
        return wb;
      }),
    },
    workbookShare: {
      findUnique: vi.fn(async ({ where }: { where: { workbookId_userId: Row } }) => by(db.shares, where.workbookId_userId)),
    },
    workbookTable: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => by(db.tables, where)),
      aggregate: vi.fn(async () => ({ _max: { position: null } })),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const t = { id: `t-${db.tables.length + 1}`, ...data };
        db.tables.push(t);
        return t;
      }),
    },
    workbookColumn: {
      findMany: vi.fn(async ({ where }: { where: Row }) => db.columns.filter((c) => c.tableId === where.tableId)),
      aggregate: vi.fn(async () => ({ _max: { position: null } })),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const c = { id: `c-${db.columns.length + 1}`, width: null, ...data };
        db.columns.push(c);
        return c;
      }),
    },
    workbookView: {
      findMany: vi.fn(async ({ where }: { where: Row }) => db.views.filter((v) => v.tableId === where.tableId)),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Row }) => {
        db.views.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
});
vi.mock("@dpf/db", () => ({ prisma }));

vi.mock("./platform-tables", () => ({
  listReferenceTargets: vi.fn(() => [{ entityType: "epic", label: "Epics" }]),
}));

import { createWorkbook, createTable } from "./workbook-service";
import { addTypedColumn, createTableView } from "./workbook-authoring";

const alice = { id: "u-alice", platformRole: "HR-200", isSuperuser: false };
const bob = { id: "u-bob", platformRole: "HR-200", isSuperuser: false };
const carol = { id: "u-carol", platformRole: "HR-200", isSuperuser: false };

beforeEach(() => {
  vi.clearAllMocks();
  db.workbooks.length = 0;
  db.shares.length = 0;
  db.tables.length = 0;
  db.columns.length = 0;
  db.views.length = 0;
  db.workbooks.push({ id: "wb-a", workbookId: "WB-A", name: "Alice's" }, { id: "wb-b", workbookId: "WB-B", name: "Bob's" });
  db.shares.push(
    { workbookId: "wb-a", userId: alice.id, role: "owner" },
    { workbookId: "wb-a", userId: carol.id, role: "viewer" },
    { workbookId: "wb-b", userId: bob.id, role: "owner" },
  );
  db.tables.push({ id: "t-a", tableId: "TBL-A", name: "Tracker", workbookId: "wb-a", dataSource: "custom", dataSourceFilter: null });
  db.columns.push(
    { id: "c-title", columnId: "COL-title", tableId: "t-a", name: "Title", fieldType: "text", required: false, position: 0, width: null, fieldConfig: null },
    {
      id: "c-status",
      columnId: "COL-status",
      tableId: "t-a",
      name: "Status",
      fieldType: "select",
      required: false,
      position: 1,
      width: null,
      fieldConfig: { options: [{ key: "todo", label: "To do" }, { key: "done", label: "Done" }] },
    },
  );
});

describe("workbook authoring — ownership follows the UI", () => {
  it("a created workbook is owned by the person the coworker acts for", async () => {
    const wb = await createWorkbook(alice, { name: "Launch tracker" });
    expect(wb.role).toBe("owner");
    const created = prisma.workbook.create.mock.calls[0][0].data;
    expect(created.createdById).toBe(alice.id);
    expect(created.shares).toEqual({ create: { userId: alice.id, role: "owner" } });
  });
});

describe("workbook authoring — isolation between workbooks", () => {
  it("refuses a table in a workbook not shared with the caller", async () => {
    await expect(createTable(bob, "WB-A", { name: "Sneaky" })).rejects.toThrow(/do not have access/i);
    expect(prisma.workbookTable.create).not.toHaveBeenCalled();
  });

  it("refuses a column on another person's table without writing", async () => {
    await expect(addTypedColumn(bob, "TBL-A", { name: "Leak", fieldType: "text" })).rejects.toThrow(/do not have access/i);
    expect(prisma.workbookColumn.create).not.toHaveBeenCalled();
  });

  it("refuses a view on another person's table without writing", async () => {
    await expect(
      createTableView(bob, "TBL-A", { name: "Board", viewType: "kanban", groupByColumnId: "COL-status" }),
    ).rejects.toThrow(/do not have access/i);
    expect(prisma.workbookView.create).not.toHaveBeenCalled();
  });

  it("refuses authoring by a viewer of the workbook", async () => {
    await expect(addTypedColumn(carol, "TBL-A", { name: "Mine", fieldType: "text" })).rejects.toThrow(/do not have access/i);
    await expect(
      createTableView(carol, "TBL-A", { name: "Board", viewType: "kanban", groupByColumnId: "COL-status" }),
    ).rejects.toThrow(/do not have access/i);
    expect(prisma.workbookColumn.create).not.toHaveBeenCalled();
    expect(prisma.workbookView.create).not.toHaveBeenCalled();
  });
});

describe("workbook authoring — typed columns and views for the owner", () => {
  it("adds a typed column and refuses a link target the caller may not reference", async () => {
    const col = await addTypedColumn(alice, "TBL-A", { name: "Hours", fieldType: "number", config: { precision: 1 } });
    expect(col).toMatchObject({ name: "Hours", fieldType: "number", config: { precision: 1 } });

    await expect(
      addTypedColumn(alice, "TBL-A", {
        name: "Payroll",
        fieldType: "link",
        config: { link: { cardinality: "many", referenceType: "payroll_run" } },
      }),
    ).rejects.toThrow(/cannot link to payroll_run/i);
    expect(prisma.workbookColumn.create).toHaveBeenCalledTimes(1);
  });

  it("refuses a formula that names a column the table does not have", async () => {
    await expect(
      addTypedColumn(alice, "TBL-A", { name: "Double", fieldType: "formula", config: { formula: "Budget * 2" } }),
    ).rejects.toThrow(/Budget/);
  });

  it("creates a kanban view grouped by the status column", async () => {
    const view = await createTableView(alice, "TBL-A", { name: "Board", viewType: "kanban", groupByColumnId: "COL-status" });
    expect(view.viewType).toBe("kanban");
    const created = prisma.workbookView.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      name: "Board",
      viewType: "kanban",
      createdById: alice.id,
      config: { kanban: { groupByColumnId: "COL-status", cardFields: ["COL-title"] } },
    });
  });

  it("refuses to overwrite an existing view of the same name", async () => {
    db.views.push({ viewId: "VW-1", name: "board", tableId: "t-a", viewType: "grid", config: {}, isDefault: false });
    await expect(
      createTableView(alice, "TBL-A", { name: "Board", viewType: "kanban", groupByColumnId: "COL-status" }),
    ).rejects.toThrow(/already has a view named/i);
    expect(prisma.workbookView.create).not.toHaveBeenCalled();
  });
});
