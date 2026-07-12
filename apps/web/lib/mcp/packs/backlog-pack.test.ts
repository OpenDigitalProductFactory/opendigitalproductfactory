import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  backlogItemFindUnique: vi.fn(),
  backlogItemFindFirst: vi.fn(),
  backlogItemFindMany: vi.fn(),
  backlogItemUpdate: vi.fn(),
  backlogItemCount: vi.fn(),
  epicFindMany: vi.fn(),
  epicFindFirst: vi.fn(),
  platformDevConfigFindUnique: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findUnique: (...a: unknown[]) => db.backlogItemFindUnique(...a),
      findFirst: (...a: unknown[]) => db.backlogItemFindFirst(...a),
      findMany: (...a: unknown[]) => db.backlogItemFindMany(...a),
      update: (...a: unknown[]) => db.backlogItemUpdate(...a),
      count: (...a: unknown[]) => db.backlogItemCount(...a),
    },
    epic: {
      findMany: (...a: unknown[]) => db.epicFindMany(...a),
      findFirst: (...a: unknown[]) => db.epicFindFirst(...a),
    },
    platformDevConfig: {
      findUnique: (...a: unknown[]) => db.platformDevConfigFindUnique(...a),
    },
    $transaction: (...a: unknown[]) => db.transaction(...a),
  },
}));

const epicTools = vi.hoisted(() => ({
  createEpicTool: vi.fn(),
  updateEpicTool: vi.fn(),
}));
vi.mock("@/lib/backlog/mcp-epic-tools", () => ({
  createEpicTool: (...a: unknown[]) => epicTools.createEpicTool(...a),
  updateEpicTool: (...a: unknown[]) => epicTools.updateEpicTool(...a),
}));

const updateHandler = vi.hoisted(() => ({ handleUpdateBacklogItem: vi.fn() }));
vi.mock("@/lib/mcp-handlers/update-backlog-item", () => ({
  handleUpdateBacklogItem: (...a: unknown[]) => updateHandler.handleUpdateBacklogItem(...a),
}));

import { backlogPack } from "./backlog-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "create_backlog_item",
  "triage_backlog_item",
  "retire_backlog_item",
  "size_backlog_item",
  "process_backlog_for_build_studio",
  "update_backlog_item",
  "query_backlog",
  "create_epic",
  "update_epic",
  "list_epics",
  "list_backlog_items",
  "get_backlog_item",
  "update_backlog_item_status",
  "link_backlog_item_to_epic",
  "get_next_recommended_work",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backlog pack — registration", () => {
  it("exposes exactly the fifteen backlog/epic tools with a handler each", () => {
    expect(backlogPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(backlogPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(backlogPack.grants).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no Phase-N / BI-id / source-path leakage)", () => {
    // Mirrors the CI hygiene guard (tool-description-hygiene.test.ts): forbid
    // internal step markers, backlog ids, and source paths — but NOT semantic
    // epic ids like "EP-*"/"EP-WWMD", which are legitimate domain vocabulary.
    const PROVENANCE_PHASE = /\bPhase\s+\d+[a-z]?\b/i;
    const PROVENANCE_BI = /\bBI-[0-9A-Fa-f]{6,}\b/i;
    const SOURCE_PATH = /\b(?:apps|packages|lib|src)\/[\w./-]+\.(?:ts|tsx|js|mjs|json|prisma)\b/i;
    for (const d of backlogPack.definitions) {
      expect(PROVENANCE_PHASE.test(d.description)).toBe(false);
      expect(PROVENANCE_BI.test(d.description)).toBe(false);
      expect(SOURCE_PATH.test(d.description)).toBe(false);
    }
  });

  it("grants mirror agent-grants: read tools need read grants, mutating tools need write/triage grants", () => {
    expect(backlogPack.grants.create_backlog_item).toEqual(["backlog_write"]);
    expect(backlogPack.grants.triage_backlog_item).toEqual(["backlog_triage"]);
    expect(backlogPack.grants.size_backlog_item).toEqual(["backlog_triage"]);
    expect(backlogPack.grants.retire_backlog_item).toEqual(["backlog_write"]);
    expect(backlogPack.grants.process_backlog_for_build_studio).toEqual(["build_lifecycle"]);
    expect(backlogPack.grants.query_backlog).toEqual(["backlog_read"]);
    expect(backlogPack.grants.list_epics).toEqual(["backlog_read"]);
    expect(backlogPack.grants.get_next_recommended_work).toEqual(["backlog_read"]);

    expect(isToolAllowedByGrants("query_backlog", ["backlog_read"])).toBe(true);
    expect(isToolAllowedByGrants("create_backlog_item", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("triage_backlog_item", ["backlog_triage"])).toBe(true);
    expect(isToolAllowedByGrants("process_backlog_for_build_studio", ["build_lifecycle"])).toBe(true);
  });
});

describe("backlog pack — handler behavior (delegation preserved)", () => {
  it("triage_backlog_item errors when the item is not found", async () => {
    db.backlogItemFindUnique.mockResolvedValue(null);
    const res = await backlogPack.handlers.triage_backlog_item(
      { itemId: "BI-GHOST", outcome: "build", rationale: "x" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Item not found");
    expect(db.backlogItemUpdate).not.toHaveBeenCalled();
  });

  it("size_backlog_item errors when the item is not found", async () => {
    db.backlogItemFindUnique.mockResolvedValue(null);
    const res = await backlogPack.handlers.size_backlog_item(
      { itemId: "BI-GHOST", size: "small" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Item not found");
  });

  it("retire_backlog_item rejects an invalid outcome before touching the db", async () => {
    const res = await backlogPack.handlers.retire_backlog_item(
      { itemId: "BI-1", outcome: "nonsense", rationale: "x" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_outcome");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("get_backlog_item requires an itemId", async () => {
    const res = await backlogPack.handlers.get_backlog_item({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_itemId");
  });

  it("update_backlog_item_status rejects an invalid target status", async () => {
    const res = await backlogPack.handlers.update_backlog_item_status(
      { itemId: "BI-1", status: "bogus" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_status");
  });

  it("link_backlog_item_to_epic requires an itemId", async () => {
    const res = await backlogPack.handlers.link_backlog_item_to_epic(
      { epicId: "EP-1" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_itemId");
  });

  it("query_backlog summarizes items and epics", async () => {
    db.backlogItemFindMany.mockResolvedValue([]);
    db.epicFindMany.mockResolvedValue([]);
    db.backlogItemCount.mockResolvedValue(0);
    const res = await backlogPack.handlers.query_backlog({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Backlog:");
    expect(res.data).toMatchObject({ summary: { open: 0, inProgress: 0, done: 0 } });
  });

  it("process_backlog_for_build_studio refuses when governed mode is disabled", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ governedBacklogEnabled: false });
    const res = await backlogPack.handlers.process_backlog_for_build_studio({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Governed backlog mode is disabled");
  });

  it("create_epic delegates to the governed epic tool, threading user + context", async () => {
    epicTools.createEpicTool.mockResolvedValue({ success: true, entityId: "EP-NEW" });
    const res = await backlogPack.handlers.create_epic(
      { title: "New epic" },
      "actor-1",
      { agentId: "agt-9" },
    );
    expect(res).toEqual({ success: true, entityId: "EP-NEW" });
    expect(epicTools.createEpicTool).toHaveBeenCalledWith({ title: "New epic" }, "actor-1", { agentId: "agt-9" });
  });

  it("update_epic delegates to the governed epic tool", async () => {
    epicTools.updateEpicTool.mockResolvedValue({ success: true, entityId: "EP-1" });
    const res = await backlogPack.handlers.update_epic({ epicId: "EP-1", title: "t" }, "u1");
    expect(res).toEqual({ success: true, entityId: "EP-1" });
    expect(epicTools.updateEpicTool).toHaveBeenCalledWith({ epicId: "EP-1", title: "t" });
  });

  it("update_backlog_item delegates to the shared handler", async () => {
    updateHandler.handleUpdateBacklogItem.mockResolvedValue({ success: true, entityId: "BI-1" });
    const res = await backlogPack.handlers.update_backlog_item({ itemId: "BI-1", title: "t" }, "u1");
    expect(res).toEqual({ success: true, entityId: "BI-1" });
    expect(updateHandler.handleUpdateBacklogItem).toHaveBeenCalledWith({ itemId: "BI-1", title: "t" });
  });
});
