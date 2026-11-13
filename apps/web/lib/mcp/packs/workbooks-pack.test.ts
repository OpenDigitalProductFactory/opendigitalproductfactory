import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  createWorkbook: vi.fn(),
  createTable: vi.fn(),
  listWorkbooks: vi.fn(),
  getWorkbook: vi.fn(),
  getTableSchema: vi.fn(),
  queryRows: vi.fn(),
  createRow: vi.fn(),
  updateCells: vi.fn(),
}));
vi.mock("@/lib/workbooks/workbook-service", () => service);

const authoring = vi.hoisted(() => ({ addTypedColumn: vi.fn(), createTableView: vi.fn() }));
vi.mock("@/lib/workbooks/workbook-authoring", () => authoring);

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(async () => ({ isSuperuser: false, platformRole: "HR-200" })) },
}));
vi.mock("@dpf/db", () => ({ prisma }));

import { workbooksPack } from "./workbooks-pack";
import { WORKBOOK_TOOL_GRANTS } from "@/lib/tak/workbook-tool-grants";
import { TOOL_TO_GRANTS, getAgentToolGrants, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { HARDCODED_COWORKER_GRANTS } from "../../../../../packages/db/src/coworker-grants";

const AUTHORING_TOOLS = ["workbook_create", "workbook_create_table", "workbook_add_column", "workbook_create_view"];

beforeEach(() => vi.clearAllMocks());

describe("workbooks pack — authoring tools are registered and governed", () => {
  it("defines the four authoring tools beside the five data tools, each with a handler", () => {
    const names = workbooksPack.definitions.map((d) => d.name);
    for (const name of AUTHORING_TOOLS) {
      expect(names, name).toContain(name);
      expect(workbooksPack.handlers[name], name).toBeTypeOf("function");
    }
    expect(names).toHaveLength(9);
  });

  it("gates authoring like the UI: manage_workbooks capability, side-effecting", () => {
    for (const name of AUTHORING_TOOLS) {
      const def = workbooksPack.definitions.find((d) => d.name === name)!;
      expect(def.requiredCapability, name).toBe("manage_workbooks");
      expect(def.sideEffect, name).toBe(true);
    }
  });

  it("single-sources its grants: the pack, TOOL_TO_GRANTS and the grant map are one object's entries", () => {
    expect(workbooksPack.grants).toBe(WORKBOOK_TOOL_GRANTS);
    for (const [name, grants] of Object.entries(WORKBOOK_TOOL_GRANTS)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
    for (const name of AUTHORING_TOOLS) expect(WORKBOOK_TOOL_GRANTS[name as keyof typeof WORKBOOK_TOOL_GRANTS]).toEqual(["workbook_write"]);
  });

  it("refuses a coworker without workbook_write (AC-2)", () => {
    for (const name of AUTHORING_TOOLS) {
      expect(isToolAllowedByGrants(name, ["workbook_read", "document_write"]), name).toBe(false);
      expect(isToolAllowedByGrants(name, ["workbook_write"]), name).toBe(true);
    }
  });

  it("grants the documentation specialist workbook authoring in both durable grant sources", () => {
    const registry = getAgentToolGrants("AGT-WS-DOC") ?? [];
    const durable = HARDCODED_COWORKER_GRANTS["doc-specialist"] ?? [];
    for (const grants of [registry, durable]) {
      expect(grants).toContain("workbook_read");
      expect(grants).toContain("workbook_write");
    }
    expect(isToolAllowedByGrants("workbook_add_column", [...durable])).toBe(true);
  });
});

describe("workbooks pack — authoring handlers delegate to the shared service as the acting person", () => {
  it("workbook_create makes the calling person the owner", async () => {
    service.createWorkbook.mockResolvedValue({ workbookId: "WB-1", name: "Launch", role: "owner" });
    const res = await workbooksPack.handlers.workbook_create({ name: "Launch", description: "Q4 launch" }, "u-alice");
    expect(res).toMatchObject({ success: true, data: { workbook: { workbookId: "WB-1" }, url: "/workbooks/WB-1" } });
    expect(service.createWorkbook).toHaveBeenCalledWith(
      { id: "u-alice", isSuperuser: false },
      { name: "Launch", description: "Q4 launch" },
    );
  });

  it("workbook_create_table passes the workbook id through the share-checked service", async () => {
    service.createTable.mockResolvedValue({ tableId: "TBL-1", name: "Tasks" });
    const res = await workbooksPack.handlers.workbook_create_table({ workbookId: "WB-1", name: "Tasks" }, "u-alice");
    expect(res).toMatchObject({ success: true, data: { table: { tableId: "TBL-1" } } });
    expect(service.createTable).toHaveBeenCalledWith({ id: "u-alice", isSuperuser: false }, "WB-1", { name: "Tasks" });
  });

  it("workbook_add_column passes the caller's platform role so link targets are checked", async () => {
    authoring.addTypedColumn.mockResolvedValue({ columnId: "COL-1", name: "Status", fieldType: "select" });
    const config = { options: [{ key: "todo", label: "To do" }] };
    const res = await workbooksPack.handlers.workbook_add_column(
      { tableId: "TBL-1", name: "Status", fieldType: "select", config, required: true },
      "u-alice",
    );
    expect(res).toMatchObject({ success: true, data: { column: { columnId: "COL-1" } } });
    expect(authoring.addTypedColumn).toHaveBeenCalledWith(
      { id: "u-alice", isSuperuser: false, platformRole: "HR-200" },
      "TBL-1",
      { name: "Status", fieldType: "select", config, required: true },
    );
  });

  it("workbook_create_view returns a link a person can open", async () => {
    authoring.createTableView.mockResolvedValue({ viewId: "VW-1", name: "Board", viewType: "kanban", workbookId: "WB-1" });
    const res = await workbooksPack.handlers.workbook_create_view(
      { tableId: "TBL-1", name: "Board", viewType: "kanban", groupByColumnId: "COL-1" },
      "u-alice",
    );
    expect(res).toMatchObject({ success: true, data: { url: "/workbooks/WB-1?table=TBL-1&view=VW-1" } });
  });

  it("returns a refusal envelope instead of throwing when the service refuses", async () => {
    service.createTable.mockRejectedValue(new Error("You do not have access to this workbook"));
    const res = await workbooksPack.handlers.workbook_create_table({ workbookId: "WB-B", name: "X" }, "u-alice");
    expect(res).toMatchObject({ success: false, error: "You do not have access to this workbook" });
  });
});
