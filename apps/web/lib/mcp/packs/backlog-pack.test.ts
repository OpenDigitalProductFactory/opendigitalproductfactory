import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  backlogItemFindUnique: vi.fn(),
  backlogItemFindFirst: vi.fn(),
  backlogItemFindMany: vi.fn(),
  backlogItemUpdate: vi.fn(),
  backlogItemCount: vi.fn(),
  epicFindMany: vi.fn(),
  epicFindFirst: vi.fn(),
  epicCount: vi.fn(),
  platformDevConfigFindUnique: vi.fn(),
  transaction: vi.fn(),
  txBacklogItemUpdate: vi.fn(),
  txBacklogItemFindUnique: vi.fn(),
  txActivityCreate: vi.fn(),
  txBacklogItemCount: vi.fn(),
  txEpicUpdate: vi.fn(),
  principalFindFirst: vi.fn(),
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
      count: (...a: unknown[]) => db.epicCount(...a),
    },
    platformDevConfig: {
      findUnique: (...a: unknown[]) => db.platformDevConfigFindUnique(...a),
    },
    principal: {
      findFirst: (...a: unknown[]) => db.principalFindFirst(...a),
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
vi.mock("./backlog-update-item-handler", () => ({
  handleUpdateBacklogItem: (...a: unknown[]) => updateHandler.handleUpdateBacklogItem(...a),
}));

const backlogBridge = vi.hoisted(() => ({ bridgeBacklogItemToWorkItem: vi.fn() }));
vi.mock("@/lib/queue/bridges/backlog-bridge", () => backlogBridge);

const terminalTransition = vi.hoisted(() => ({ completeBacklogItemTransition: vi.fn() }));
vi.mock("@/lib/backlog/initiative-readiness/backlog-terminal-transition", () => terminalTransition);

const specPlanSearch = vi.hoisted(() => ({
  buildSpecPlanReferenceIndex: vi.fn(async () => ({
    specs: new Map<string, string>(),
    plans: new Map<string, string>(),
    corpus: { available: true, root: "/repo", searchedPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], missingPaths: [], fileCount: 2, reason: "Searched 2 markdown file(s)." },
  })),
  searchSpecsAndPlans: vi.fn(async () => ({ corpus: { available: true, root: "/repo", searchedPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], missingPaths: [], fileCount: 2, reason: "Searched 2 markdown file(s)." }, results: [] })),
  specPlanCorpusCaveat: vi.fn(() => null),
}));
vi.mock("@/lib/backlog/spec-plan-search", () => specPlanSearch);

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
  terminalTransition.completeBacklogItemTransition.mockResolvedValue({
    ok: true,
    authorityDecisionId: "DI-1",
    decision: { verdict: "allowed", blockers: [], unmet: [] },
  });
  db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      backlogItem: {
        findUnique: (...a: unknown[]) => db.txBacklogItemFindUnique(...a),
        update: (...a: unknown[]) => db.txBacklogItemUpdate(...a),
        count: (...a: unknown[]) => db.txBacklogItemCount(...a),
      },
      backlogItemActivity: {
        create: (...a: unknown[]) => db.txActivityCreate(...a),
      },
      epic: {
        update: (...a: unknown[]) => db.txEpicUpdate(...a),
      },
      principal: {
        findFirst: (...a: unknown[]) => db.principalFindFirst(...a),
      },
    }),
  );
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

  it("triage_backlog_item resolves a semantic duplicate target before writing the FK", async () => {
    db.backlogItemFindUnique
      .mockResolvedValueOnce({ id: "duplicate-row", itemId: "BI-DUP", status: "triaging" })
      .mockResolvedValueOnce({ id: "canonical-row" });
    db.backlogItemUpdate.mockResolvedValue({ itemId: "BI-DUP" });

    const res = await backlogPack.handlers.triage_backlog_item(
      { itemId: "BI-DUP", outcome: "duplicate", duplicateOfId: "BI-CANON", rationale: "Same work." },
      "u1",
    );

    expect(res.success).toBe(true);
    expect(db.backlogItemUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ duplicateOfId: "canonical-row" }),
    }));
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

  it("retire_backlog_item keeps the epic open when it retains wanted deferred work", async () => {
    db.txBacklogItemFindUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-1",
      status: "open",
      epicId: "epic-row-1",
      activeBuildId: null,
    });
    db.principalFindFirst.mockResolvedValue({ id: "principal-row-1" });
    db.txBacklogItemUpdate.mockResolvedValue({ itemId: "BI-1" });
    db.txActivityCreate.mockResolvedValue({ id: "activity-1" });

    const res = await backlogPack.handlers.retire_backlog_item(
      {
        itemId: "BI-1",
        outcome: "defer",
        rationale: "Still wanted after the predecessor ships.",
        reason: "Predecessor is incomplete.",
        deferral: {
          reason: "Predecessor is incomplete.",
          trigger: "Predecessor ships.",
          reviewAt: "2099-11-15T12:00:00Z",
          ownerPrincipalId: "PRN-OWNER",
        },
      },
      "u1",
    );

    expect(res.success).toBe(true);
    expect(db.txEpicUpdate).not.toHaveBeenCalled();
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

  it("update_backlog_item_status rejects a deferred transition without the complete contract", async () => {
    const res = await backlogPack.handlers.update_backlog_item_status(
      { itemId: "BI-1", status: "deferred" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_deferral");
    expect(db.backlogItemFindUnique).not.toHaveBeenCalled();
  });

  it("update_backlog_item_status reviews an already-deferred item instead of returning a no-op", async () => {
    db.principalFindFirst.mockResolvedValue({ id: "principal-1" });
    db.backlogItemFindUnique.mockResolvedValue({
      id: "row-1",
      status: "deferred",
      epicId: null,
      triageOutcome: "defer",
      effortSize: null,
      activeBuildId: null,
      claimStatus: "released",
      claimedById: null,
      claimedByAgentId: null,
      claimedAt: null,
    });
    db.txBacklogItemUpdate.mockResolvedValue({
      itemId: "BI-1",
      status: "deferred",
      epicId: null,
      completedAt: null,
    });
    db.txActivityCreate.mockResolvedValue({ id: "activity-1" });

    const res = await backlogPack.handlers.update_backlog_item_status(
      {
        itemId: "BI-1",
        status: "deferred",
        deferral: {
          reason: "Waiting for predecessor evidence.",
          trigger: "EP-1 reaches done.",
          reviewAt: "2026-11-15T12:00:00.000Z",
          ownerPrincipalId: "principal-1",
        },
      },
      "u1",
    );

    expect(res.success).toBe(true);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.txBacklogItemUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deferReason: "Waiting for predecessor evidence.",
        deferTrigger: "EP-1 reaches done.",
        deferReviewAt: new Date("2026-11-15T12:00:00.000Z"),
        deferOwnerPrincipalId: "principal-1",
        deferredAt: expect.any(Date),
      }),
    }));
    expect(db.txActivityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "deferral_review" }),
    }));
  });

  it("update_backlog_item_status clears the active deferral projection when reactivated", async () => {
    db.backlogItemFindUnique.mockResolvedValue({
      id: "row-1",
      status: "deferred",
      epicId: null,
      triageOutcome: "defer",
      effortSize: null,
      activeBuildId: null,
      claimStatus: "released",
      claimedById: null,
      claimedByAgentId: null,
      claimedAt: null,
    });
    db.txBacklogItemUpdate.mockResolvedValue({
      itemId: "BI-1",
      status: "open",
      epicId: null,
      completedAt: null,
    });
    db.txActivityCreate.mockResolvedValue({ id: "activity-1" });

    const res = await backlogPack.handlers.update_backlog_item_status(
      { itemId: "BI-1", status: "open" },
      "u1",
    );

    expect(res.success).toBe(true);
    expect(db.txBacklogItemUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deferReason: null,
        deferTrigger: null,
        deferReviewAt: null,
        deferOwnerPrincipalId: null,
        deferredAt: null,
      }),
    }));
  });

  it("update_backlog_item_status exposes the typed completion evidence schema", () => {
    const definition = backlogPack.definitions.find((entry) => entry.name === "update_backlog_item_status");
    const rootProperties = definition?.inputSchema.properties as
      | Record<string, unknown>
      | undefined;
    const completionEvidence = rootProperties?.completionEvidence as
      | { properties?: Record<string, { enum?: unknown[]; maxItems?: number }> }
      | undefined;
    expect(completionEvidence?.properties?.workClass.enum).toEqual([
      "documentation",
      "verified-existing",
      "implementation",
      "operational",
    ]);
    expect(completionEvidence?.properties?.evidenceActivityIds.maxItems).toBe(50);
  });

  it("update_backlog_item_status routes completion through the canonical terminal transition", async () => {
    db.backlogItemFindUnique.mockResolvedValue({
      id: "row-1",
      status: "in-progress",
      epicId: null,
      triageOutcome: "build",
      effortSize: "medium",
      activeBuildId: null,
      claimStatus: "active",
      claimedById: "u1",
      claimedByAgentId: "agent-1",
      claimedAt: new Date("2026-07-26T09:00:00Z"),
    });
    db.txBacklogItemUpdate.mockResolvedValue({
      itemId: "BI-1",
      status: "done",
      epicId: null,
      completedAt: new Date("2026-07-26T12:00:00Z"),
    });
    db.txActivityCreate.mockResolvedValue({ id: "activity-1" });
    const res = await backlogPack.handlers.update_backlog_item_status(
      {
        itemId: "BI-1",
        status: "done",
        resolution: "Delivered through PR #1.",
        completionEvidence: {
          workClass: "implementation",
          evidenceActivityIds: ["source", "tests", "tests"],
          useActiveBuildEvidence: false,
          ux: { disposition: "not-applicable", reason: "No user interface files or routes changed." },
          migration: { disposition: "not-applicable", reason: "No database schema or persisted data changed." },
          callerVerdict: "allow",
        },
      },
      "u1",
      { agentId: "agent-1" },
    );
    expect(res.success).toBe(true);
    expect(terminalTransition.completeBacklogItemTransition).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Delivered through PR #1.",
      actor: expect.objectContaining({ actorType: "agent", agentContextRef: "agent-1" }),
      authority: expect.objectContaining({ actionKey: "update_backlog_item_status" }),
    }));
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("update_backlog_item_status keeps an already-done retry a no-op without a new receipt", async () => {
    db.backlogItemFindUnique.mockResolvedValue({
      id: "row-1",
      status: "done",
      epicId: null,
      triageOutcome: "build",
      effortSize: "medium",
      activeBuildId: null,
      claimStatus: "released",
      claimedById: "u1",
      claimedByAgentId: "agent-1",
      claimedAt: new Date("2026-07-26T09:00:00Z"),
    });
    const res = await backlogPack.handlers.update_backlog_item_status(
      { itemId: "BI-1", status: "done", resolution: "already done" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("no-op");
    expect(db.transaction).not.toHaveBeenCalled();
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
    db.backlogItemFindMany.mockResolvedValue([
      {
        itemId: "BI-FABRIC",
        title: "Fabric care custody",
        status: "open",
        type: "product",
        priority: 2,
        updatedAt: new Date("2026-07-24T00:00:00.000Z"),
        scopeKind: "archetype-category",
        archetypeCategories: ["fabric-care-services"],
        archetypeIds: ["dry-cleaning-plant-network"],
        lifecycleTags: ["claim-ticket", "ready-promise"],
        epic: { epicId: "EP-FABRIC-CARE-OPS" },
      },
    ]);
    db.epicFindMany.mockResolvedValue([]);
    db.backlogItemCount.mockResolvedValue(1);
    db.epicCount.mockResolvedValue(0);
    const res = await backlogPack.handlers.query_backlog({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Backlog:");
    expect(res.data).toMatchObject({
      items: [
        {
          itemId: "BI-FABRIC",
          scopeKind: "archetype-category",
          archetypeCategories: ["fabric-care-services"],
          archetypeIds: ["dry-cleaning-plant-network"],
          lifecycleTags: ["claim-ticket", "ready-promise"],
        },
      ],
    });
  });

  // REGRESSION: `BacklogItem.epicId` is the internal cuid FK, so passing the
  // semantic "EP-*" id straight into the where-clause matched nothing and
  // returned an empty item list under success:true — a silent wrong answer
  // that reads as "this epic has no items".
  it("query_backlog resolves a semantic epic id to the row id before filtering", async () => {
    db.epicFindFirst.mockResolvedValue({ id: "ckepicrow1" });
    db.backlogItemFindMany.mockResolvedValue([]);
    db.epicFindMany.mockResolvedValue([]);
    db.backlogItemCount.mockResolvedValue(0);
    db.epicCount.mockResolvedValue(0);

    const res = await backlogPack.handlers.query_backlog({ epicId: "EP-0AF96937" }, "u1");

    expect(res.success).toBe(true);
    expect(db.backlogItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { epicId: "ckepicrow1" } }),
    );
  });

  it("query_backlog reports epic_not_found instead of an empty list for an unknown epic", async () => {
    db.epicFindFirst.mockResolvedValue(null);
    const res = await backlogPack.handlers.query_backlog({ epicId: "EP-NOPE" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("epic_not_found");
    expect(db.backlogItemFindMany).not.toHaveBeenCalled();
  });

  // REGRESSION: a silently-truncated list is indistinguishable from a complete
  // one, which is how a present-but-older epic got reported as non-existent.
  it("list_epics reports the true total and flags truncation", async () => {
    db.epicCount.mockResolvedValue(137);
    db.epicFindMany.mockResolvedValue([
      { id: "e1", epicId: "EP-1", title: "One", status: "open", priority: 1, updatedAt: new Date(), items: [] },
    ]);
    const res = await backlogPack.handlers.list_epics({ limit: 1 }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ total: 137, fetched: 1, truncated: true });
  });

  it("list_epics accepts a limit above the old 100 cap", async () => {
    db.epicCount.mockResolvedValue(0);
    db.epicFindMany.mockResolvedValue([]);
    await backlogPack.handlers.list_epics({ limit: 1000 }, "u1");
    expect(db.epicFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1000 }));
  });

  it("list_backlog_items reports the true total and flags truncation", async () => {
    db.backlogItemCount.mockResolvedValue(678);
    db.backlogItemFindMany.mockResolvedValue([]);
    const res = await backlogPack.handlers.list_backlog_items({ limit: 500 }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ total: 678, truncated: true });
    expect(db.backlogItemFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it("list_backlog_items can filter by archetype scope metadata", async () => {
    db.backlogItemCount.mockResolvedValue(1);
    db.backlogItemFindMany.mockResolvedValue([]);
    await backlogPack.handlers.list_backlog_items(
      {
        scopeKind: "archetype-category",
        archetypeCategory: "fabric-care-services",
        archetypeId: "dry-cleaning-plant-network",
        lifecycleTag: "claim-ticket",
      },
      "u1",
    );
    expect(db.backlogItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scopeKind: "archetype-category",
          archetypeCategories: { has: "fabric-care-services" },
          archetypeIds: { has: "dry-cleaning-plant-network" },
          lifecycleTags: { has: "claim-ticket" },
        },
      }),
    );
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
    expect(epicTools.updateEpicTool).toHaveBeenCalledWith({ epicId: "EP-1", title: "t" }, "u1", undefined);
  });

  it("update_backlog_item delegates to the shared handler", async () => {
    updateHandler.handleUpdateBacklogItem.mockResolvedValue({ success: true, entityId: "BI-1" });
    const res = await backlogPack.handlers.update_backlog_item({ itemId: "BI-1", title: "t" }, "u1");
    expect(res).toEqual({ success: true, entityId: "BI-1" });
    expect(updateHandler.handleUpdateBacklogItem).toHaveBeenCalledWith(
      { itemId: "BI-1", title: "t" },
      "u1",
      undefined,
    );
  });
});
