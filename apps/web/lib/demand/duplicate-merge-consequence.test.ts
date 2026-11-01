import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  backlogItemFindUnique: vi.fn(),
  workroomCount: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findUnique: (...a: unknown[]) => db.backlogItemFindUnique(...a) },
    workroom: { count: (...a: unknown[]) => db.workroomCount(...a) },
  },
}));

import { resolveCallConsequence } from "@/lib/tool-consequence";
import { demandScoringPack } from "@/lib/mcp/packs/demand-scoring-pack";
import { classifyDuplicateMerge, type DuplicateMergeItem } from "./duplicate-merge-consequence";

const item = (over: Partial<DuplicateMergeItem>): DuplicateMergeItem => ({
  id: "row-x",
  itemId: "BI-X",
  status: "open",
  body: "Stabilize repeated surface_open tool failure\n\n[origin:tool-defect:surface_open]",
  claimStatus: null,
  ...over,
});
const canonical = item({ id: "row-c", itemId: "BI-C" });
const duplicate = item({
  id: "row-d",
  itemId: "BI-D",
  status: "triaging",
  body: "[origin:capability-need:AGT-102:tool:stabilize repeated surface_open tool failure]\n[origin:tool-defect:surface_open]",
});

describe("classifyDuplicateMerge (BI-EAFD2D09)", () => {
  it("needs no person when both local items carry the same intake origin and the duplicate has no open work", () => {
    expect(classifyDuplicateMerge({ canonical, duplicate, duplicateLiveWorkrooms: 0 })).toEqual({
      consequence: null,
      reason: "same-origin-duplicate-fold",
    });
  });

  it("keeps the declared consequence when the items share no origin marker", () => {
    const other = item({ id: "row-d", itemId: "BI-D", body: "[origin:tool-defect:surface_act]" });
    expect(classifyDuplicateMerge({ canonical, duplicate: other, duplicateLiveWorkrooms: 0 }).consequence).toBe("irreversible");
    const unmarked = item({ id: "row-d", itemId: "BI-D", body: "Same words, no provenance" });
    expect(classifyDuplicateMerge({ canonical, duplicate: unmarked, duplicateLiveWorkrooms: 0 }).reason).toBe("merge-not-proven-same-origin");
  });

  it("keeps it for a peer-owned mirror on either side, even with a shared marker", () => {
    const mirror = item({ id: "row-d", itemId: "BI-D", body: `${duplicate.body}\n[origin:federatedWork:inst_peer:BI-D]` });
    expect(classifyDuplicateMerge({ canonical, duplicate: mirror, duplicateLiveWorkrooms: 0 }).reason).toBe("merge-touches-peer-owned-item");
    const mirroredCanonical = item({ id: "row-c", itemId: "BI-C", body: `${canonical.body}\n[origin:federatedDemand:x]` });
    expect(classifyDuplicateMerge({ canonical: mirroredCanonical, duplicate, duplicateLiveWorkrooms: 0 }).consequence).toBe("irreversible");
  });

  it("keeps it when the duplicate is claimed, has a live Workroom, or is already closed", () => {
    expect(classifyDuplicateMerge({ canonical, duplicate: { ...duplicate, claimStatus: "active" }, duplicateLiveWorkrooms: 0 }).reason).toBe("merge-duplicate-has-open-work");
    expect(classifyDuplicateMerge({ canonical, duplicate, duplicateLiveWorkrooms: 1 }).reason).toBe("merge-duplicate-has-open-work");
    expect(classifyDuplicateMerge({ canonical, duplicate: { ...duplicate, status: "retired" }, duplicateLiveWorkrooms: 0 }).reason).toBe("merge-duplicate-not-open");
  });

  it("keeps it when either item is missing or both name the same row", () => {
    expect(classifyDuplicateMerge({ canonical: null, duplicate, duplicateLiveWorkrooms: 0 }).consequence).toBe("irreversible");
    expect(classifyDuplicateMerge({ canonical, duplicate: canonical, duplicateLiveWorkrooms: 0 }).consequence).toBe("irreversible");
  });
});

describe("merge_backlog_items per-call consequence", () => {
  const tool = demandScoringPack.definitions.find((d) => d.name === "merge_backlog_items")!;
  const call = (params: Record<string, unknown>) => ({ toolName: "merge_backlog_items", params, userId: "u1" });

  beforeEach(() => {
    vi.clearAllMocks();
    db.backlogItemFindUnique.mockImplementation(async ({ where }: { where: { itemId: string } }) =>
      where.itemId === "BI-C" ? canonical : where.itemId === "BI-D" ? duplicate : null,
    );
    db.workroomCount.mockResolvedValue(0);
  });

  it("stays declared irreversible and narrows only a proven same-origin fold", async () => {
    expect(tool.consequence).toBe("irreversible");
    await expect(resolveCallConsequence(tool, call({ canonicalItemId: "BI-C", duplicateItemId: "BI-D" }))).resolves.toEqual({
      consequence: null,
      refinement: { declared: "irreversible", reason: "same-origin-duplicate-fold" },
    });
    expect(db.workroomCount).toHaveBeenCalledWith({
      where: { backlogItemId: { in: ["BI-D", "row-d"] }, status: { notIn: ["complete", "abandoned", "archived"] } },
    });
  });

  it("narrows reconcileOnly without relying on a mutable item snapshot", async () => {
    db.backlogItemFindUnique.mockRejectedValue(new Error("classification must not need a state snapshot"));
    const resolved = await resolveCallConsequence(tool, call({
      canonicalItemId: "BI-C", duplicateItemId: "BI-D", reconcileOnly: true,
    }));
    expect(resolved).toEqual({
      consequence: null,
      refinement: { declared: "irreversible", reason: "completed-merge-reconciliation-only" },
    });
    expect(db.backlogItemFindUnique).not.toHaveBeenCalled();
    expect(db.workroomCount).not.toHaveBeenCalled();
  });

  it.each([false, "true", 1, null, {}])("does not select reconcile-only for %j", async (reconcileOnly) => {
    db.backlogItemFindUnique.mockImplementation(async ({ where }: { where: { itemId: string } }) =>
      where.itemId === "BI-C" ? canonical : { ...duplicate, body: "Unproven different observation" },
    );
    const resolved = await resolveCallConsequence(tool, call({
      canonicalItemId: "BI-C", duplicateItemId: "BI-D", reconcileOnly,
    }));
    expect(resolved.consequence).toBe("irreversible");
    expect(resolved.refinement?.reason).not.toBe("completed-merge-reconciliation-only");
  });

  it("reaches a person when the duplicate has a live Workroom", async () => {
    db.workroomCount.mockResolvedValue(1);
    const resolved = await resolveCallConsequence(tool, call({ canonicalItemId: "BI-C", duplicateItemId: "BI-D" }));
    expect(resolved.consequence).toBe("irreversible");
  });

  it("fails closed when the lookup throws", async () => {
    db.backlogItemFindUnique.mockRejectedValue(new Error("db down"));
    const resolved = await resolveCallConsequence(tool, call({ canonicalItemId: "BI-C", duplicateItemId: "BI-D" }));
    expect(resolved).toEqual({ consequence: "irreversible", refinement: { declared: "irreversible", reason: "refinement-unavailable" } });
  });
});
