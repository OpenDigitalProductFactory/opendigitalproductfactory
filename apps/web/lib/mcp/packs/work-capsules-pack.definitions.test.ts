import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  workroom: { findMany: vi.fn(async () => []), update: vi.fn() },
  workroomActivity: { create: vi.fn() },
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db, DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY" }));

import * as profiles from "@/lib/work-management/room-review-profile";
import { clampToolResultForModel, DEFAULT_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import { tokenAdmitsTool } from "@/lib/mcp/token-tool-scope";
import { can } from "@/lib/permissions";
import { workCapsulesPack } from "./work-capsules-pack";

const authority = { userContext: { platformRole: "HR-000", isSuperuser: true } };
async function call(params: Record<string, unknown>, name = "list_workrooms") {
  return workCapsulesPack.handlers[name]!(params, "catalogue-reader", authority);
}

describe("Workroom definition catalogue through the installed pack handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  });

  it("advertises the opt-in view while keeping instance listing the default", () => {
    const tool = workCapsulesPack.definitions.find(row => row.name === "list_workrooms")!;
    const properties = tool.inputSchema.properties as Record<string, unknown>;
    expect(properties.view).toMatchObject({ type: "string", enum: ["instances", "definitions"] });
    expect(tool.inputSchema.required).not.toContain("view");
    expect(tool).toMatchObject({ sideEffect: false, executionMode: "immediate" });
  });

  it.each(["list_workrooms", "list_work_capsules"])("%s traverses canonical definitions without reading occurrences", async name => {
    const inventory = profiles.listRoomReviewDefinitions({ limit: 200 });
    const rows: Array<{ sourceKey: string; aliases: string[]; assessment: string }> = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = await call({ view: "definitions", limit: 100, ...(cursor ? { cursor } : {}) }, name);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ view: "definitions", canonicalDefinitionCount: inventory.total,
        occurrenceAssessment: "not-exercised", organizationApplicability: "unknown" });
      expect(result.data).not.toHaveProperty("capsules");
      const page = result.data!.page as { nextCursor: string | null; pageCount: number };
      const items = result.data!.definitions as typeof rows;
      expect(page.pageCount).toBe(items.length);
      expect(items.length).toBeGreaterThan(0);
      const encoded = clampToolResultForModel(result);
      expect(encoded.truncated).toBe(false);
      expect(encoded.text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_CHAR_CAP);
      expect(() => JSON.parse(encoded.text)).not.toThrow();
      rows.push(...items);
      cursor = page.nextCursor ?? undefined;
      if (cursor) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); }
    } while (cursor);
    expect(rows.map(({ sourceKey, aliases, assessment }) => ({ sourceKey, aliases, assessment })))
      .toEqual(inventory.items.map(({ sourceKey, aliases, assessment }) => ({ sourceKey, aliases, assessment })));
    expect(new Set(rows.map(row => row.sourceKey)).size).toBe(inventory.total);
    expect(db.workroom.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it.each(["list_workrooms", "list_work_capsules"])("%s retains canonical conflict reasons without implying assessment", async name => {
    const original = profiles.composeRoomReviewProfile("booking", []);
    const conflict = profiles.composeRoomReviewProfile("booking", [{
      kind: "organization", ref: "catalogue-conflict-test@1",
      requirements: [{ ...original.requirements[0]!, outcome: "conflicting test outcome" }],
    }]);
    expect(conflict.status).toBe("unresolved");
    expect(conflict.conflicts).toEqual([`requirement-conflict:${original.requirements[0]!.ref}`]);
    vi.spyOn(profiles, "composeRoomReviewProfile").mockReturnValue(conflict);

    const result = await call({ view: "definitions", limit: 1 }, name);
    expect(result).toMatchObject({ success: true, data: {
      occurrenceAssessment: "not-exercised", organizationApplicability: "unknown",
      definitions: [expect.objectContaining({ assessment: "not-exercised",
        profile: { status: "unresolved", fingerprint: null, conflicts: conflict.conflicts } })],
      page: { compositionCounts: { unresolved: 1 }, pageCount: 1 },
    } });
    expect(clampToolResultForModel(result).truncated).toBe(false);
    expect(db.workroom.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses oversized canonical conflict reasons without advancing the confirmed cursor", async () => {
    const first = await call({ view: "definitions", limit: 1 });
    const cursor = (first.data!.page as { nextCursor: string }).nextCursor;
    const conflict = profiles.composeRoomReviewProfile("booking", [{
      kind: "organization", ref: "x".repeat(DEFAULT_TOOL_RESULT_CHAR_CAP), requirements: [],
    }]);
    expect(conflict.status).toBe("unresolved");
    expect(conflict.conflicts[0]!.length).toBeGreaterThan(DEFAULT_TOOL_RESULT_CHAR_CAP);
    vi.spyOn(profiles, "composeRoomReviewProfile").mockReturnValue(conflict);

    const result = await call({ view: "definitions", limit: 1, cursor });
    expect(result).toMatchObject({ success: false, error: "definition_page_budget_exceeded", data: {
      page: { disposition: "budget-exceeded" },
      recovery: { toolName: "list_workrooms", arguments: { view: "definitions", limit: 1, cursor } },
    } });
    expect(result.data).not.toHaveProperty("definitions");
    expect(result.data).not.toHaveProperty("nextCursor");
    expect(result.data!.page).not.toHaveProperty("nextCursor");
    expect(clampToolResultForModel(result).truncated).toBe(false);
  });

  it("preserves the default instance view", async () => {
    expect(await call({ limit: 1 })).toMatchObject({ success: true, data: { capsules: [] } });
    expect(db.workroom.findMany).toHaveBeenCalled();
  });

  it.each([null, "", "all", 1])("refuses the unknown view %s", async view => {
    expect(await call({ view })).toMatchObject({ success: false, error: "invalid_view" });
    expect(db.workroom.findMany).not.toHaveBeenCalled();
  });

  it.each(["status", "decisionScope", "portfolioRole", "staleOnly", "headBranch", "pullRequestNumber"])
  ("refuses an instance-only %s filter even when false or null", async key => {
    for (const value of [false, null, "ready"]) {
      expect(await call({ view: "definitions", [key]: value }))
        .toMatchObject({ success: false, error: "invalid_definition_filters" });
    }
  });

  it("does not reinterpret cursors between definition and instance views", async () => {
    const first = await call({ view: "definitions", limit: 1 });
    const cursor = (first.data?.page as { nextCursor: string }).nextCursor;
    expect(cursor).toMatch(/^workroom-definitions:v1:/);
    expect(await call({ cursor })).toMatchObject({ success: false });
    expect(await call({ view: "definitions", cursor: "instance-packet.signature" }))
      .toMatchObject({ success: false, error: "invalid_definition_cursor" });
  });

  it("requires a fresh traversal for a stale definition fingerprint", async () => {
    expect(await call({ view: "definitions", cursor: "workroom-definitions:v1:old|build" }))
      .toMatchObject({ success: false, error: "definition_restart_required" });
  });

  it("fails closed without a native authenticated user context", async () => {
    expect(await workCapsulesPack.handlers.list_workrooms!({ view: "definitions", userId: "forged" }, "reader"))
      .toMatchObject({ success: false, error: "authority_context_required" });
    expect(await workCapsulesPack.handlers.list_workrooms!({ view: "definitions" }, "", authority))
      .toMatchObject({ success: false, error: "authority_context_required" });
    expect(db.workroom.findMany).not.toHaveBeenCalled();
  });

  it("retains the existing capability and credential grant boundary", () => {
    const tool = workCapsulesPack.definitions.find(row => row.name === "list_workrooms")!;
    expect(tool.requiredCapability).toBe("view_platform");
    expect(can({ platformRole: null, isSuperuser: false }, tool.requiredCapability!)).toBe(false);
    expect(tokenAdmitsTool(tool, workCapsulesPack.grants.list_workrooms,
      { scope: "read", capability: "read", scopes: [] })).toBe(false);
    expect(tokenAdmitsTool(tool, workCapsulesPack.grants.list_workrooms,
      { scope: "read", capability: "read", scopes: ["work_capsule_read"] })).toBe(true);
  });
});
