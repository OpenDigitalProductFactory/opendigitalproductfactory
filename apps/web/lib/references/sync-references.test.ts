import { beforeEach, describe, expect, it, vi } from "vitest";

const { syncEntityReferences, removeEntityReferences, repointReferenceTarget } = vi.hoisted(() => ({
  syncEntityReferences: vi.fn(async (..._args: unknown[]) => ({ written: [], refused: [], unresolved: [] })),
  removeEntityReferences: vi.fn(async (..._args: unknown[]) => undefined),
  repointReferenceTarget: vi.fn(async (..._args: unknown[]) => 0),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findFirst: vi.fn(async () => ({ itemId: "BI-1", organizationId: "org-a", body: "EP-1" })) },
    epic: { findFirst: vi.fn(async () => ({ epicId: "EP-1", description: "BI-1" })) },
    document: { findFirst: vi.fn(async () => ({ documentId: "DOC-1", organizationId: "org-a", currentVersion: { contentText: "BI-1" } })) },
    workItemMessage: { findUnique: vi.fn(async () => ({ id: "m1", body: "BI-1", workItem: { capsules: [{ id: "room-1" }] } })) },
  },
  syncEntityReferences,
  removeEntityReferences,
  repointReferenceTarget,
  recordScope: (organizationId: string | null) => ({ corpus: organizationId ? "organization" : "install", organizationId, family: null }),
}));

import {
  referenceWriter,
  repointBacklogReferences,
  syncBacklogItemReferences,
  syncDocumentReferences,
  syncEpicReferences,
  syncWikiPageReferences,
  syncWorkroomMessageReferences,
} from "./sync-references";

describe("app reference hooks (BI-A63A9476 §5 write path)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the writer from the acting identity", () => {
    expect(referenceWriter({ userId: "u1" })).toBe("user:u1");
    expect(referenceWriter({ userId: "u1", agentId: "a1" })).toBe("agent:a1");
    expect(referenceWriter({})).toBeNull();
  });

  it("syncs each body kind with its own field and scope", async () => {
    await syncBacklogItemReferences({ id: "row" }, "user:u1");
    await syncEpicReferences({ id: "row" }, "user:u1");
    await syncDocumentReferences("DOC-1", "principal:p1");
    await syncWorkroomMessageReferences("m1", "agent:a1");
    await syncWikiPageReferences({ pageId: "page-1", organizationId: "org-a", slug: "x", body: "BI-1" }, "user:u1");
    expect(syncEntityReferences.mock.calls).toEqual([
      [{ kind: "backlog", key: "BI-1", organizationId: "org-a", field: "body", writtenBy: "user:u1" }, "EP-1"],
      [{ kind: "epic", key: "EP-1", organizationId: null, field: "description", writtenBy: "user:u1" }, "BI-1"],
      [{ kind: "document", key: "DOC-1", organizationId: "org-a", field: "body", writtenBy: "principal:p1" }, "BI-1"],
      [{ kind: "message", key: "m1", organizationId: null, field: "message", writtenBy: "agent:a1", roomId: "room-1" }, "BI-1"],
      [{ kind: "wiki", key: "page-1", organizationId: "org-a", slug: "x", field: "body", writtenBy: "user:u1" }, "BI-1"],
    ]);
  });

  it("never fails the save it follows", async () => {
    syncEntityReferences.mockRejectedValueOnce(new Error("graph down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(syncBacklogItemReferences({ id: "row" }, "user:u1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.stringContaining("graph down"));
    warn.mockRestore();
  });

  it("merge re-points inbound edges; the merged item keeps its own (a retired item keeps its edges)", async () => {
    await repointBacklogReferences("BI-OLD", { itemId: "BI-NEW", organizationId: null });
    expect(repointReferenceTarget).toHaveBeenCalledWith("BI-OLD", "BI-NEW", { corpus: "install", organizationId: null, family: null });
    expect(removeEntityReferences).not.toHaveBeenCalled();
  });
});
