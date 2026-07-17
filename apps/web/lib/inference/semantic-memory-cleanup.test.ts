// apps/web/lib/inference/semantic-memory-cleanup.test.ts
// BI-DG-001: deletion propagation + orphan reconciliation for semantic memory.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  deleteVectors: vi.fn().mockResolvedValue(undefined),
  scrollPoints: vi.fn().mockResolvedValue([]),
  QDRANT_COLLECTIONS: {
    AGENT_MEMORY: "agent-memory",
    PLATFORM_KNOWLEDGE: "platform-knowledge",
  },
}));

describe("purgeConversationVectorsBySource", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("requests vector deletion keyed on the stable thread identifier", async () => {
    const { scrollPoints, deleteVectors } = await import("@dpf/db");
    vi.mocked(scrollPoints).mockResolvedValueOnce([
      { id: 1, payload: { threadId: "thread-1", messageId: "m-1" } },
    ]);

    const { purgeConversationVectorsBySource } = await import("./semantic-memory-cleanup");
    const evidence = await purgeConversationVectorsBySource({ threadIds: ["thread-1"] });

    const expectedFilter = { should: [{ key: "threadId", match: { any: ["thread-1"] } }] };
    expect(scrollPoints).toHaveBeenCalledWith("agent-memory", expectedFilter, expect.any(Number));
    expect(deleteVectors).toHaveBeenCalledWith("agent-memory", expectedFilter);
    expect(evidence).toMatchObject({
      collection: "agent-memory",
      sourceKind: "thread",
      candidates: 1,
      removed: 1,
      failed: 0,
    });
  });

  it("requests deletion keyed on message identifiers", async () => {
    const { scrollPoints, deleteVectors } = await import("@dpf/db");
    vi.mocked(scrollPoints).mockResolvedValueOnce([
      { id: 2, payload: { messageId: "m-2" } },
    ]);

    const { purgeConversationVectorsBySource } = await import("./semantic-memory-cleanup");
    const evidence = await purgeConversationVectorsBySource({ messageIds: ["m-2"] });

    const expectedFilter = { should: [{ key: "messageId", match: { any: ["m-2"] } }] };
    expect(deleteVectors).toHaveBeenCalledWith("agent-memory", expectedFilter);
    expect(evidence.sourceKind).toBe("message");
    expect(evidence.removed).toBe(1);
  });

  it("is idempotent — a second pass finds no candidates and removes nothing", async () => {
    const { scrollPoints, deleteVectors } = await import("@dpf/db");
    vi.mocked(scrollPoints)
      .mockResolvedValueOnce([{ id: 1, payload: { threadId: "thread-1" } }]) // first pass
      .mockResolvedValueOnce([]); // second pass — already clean

    const { purgeConversationVectorsBySource } = await import("./semantic-memory-cleanup");

    const first = await purgeConversationVectorsBySource({ threadIds: ["thread-1"] });
    const second = await purgeConversationVectorsBySource({ threadIds: ["thread-1"] });

    expect(first.removed).toBe(1);
    expect(second.removed).toBe(0);
    expect(second.failed).toBe(0);
    // No throw on the repeat; deletion issued only when candidates exist.
    expect(deleteVectors).toHaveBeenCalledTimes(1);
  });

  it("does nothing when neither identifier set is provided", async () => {
    const { scrollPoints, deleteVectors } = await import("@dpf/db");
    const { purgeConversationVectorsBySource } = await import("./semantic-memory-cleanup");

    const evidence = await purgeConversationVectorsBySource({});

    expect(scrollPoints).not.toHaveBeenCalled();
    expect(deleteVectors).not.toHaveBeenCalled();
    expect(evidence.removed).toBe(0);
  });
});

describe("reconcileOrphanConversationVectors", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reports and removes a vector whose source message no longer exists", async () => {
    const { deleteVectors } = await import("@dpf/db");
    const { reconcileOrphanConversationVectors } = await import("./semantic-memory-cleanup");

    const evidence = await reconcileOrphanConversationVectors({
      candidateMessageIds: ["m-live", "m-orphan"],
      // Only m-live still exists in the source of record.
      existsResolver: async () => new Set(["m-live"]),
    });

    expect(evidence.orphanMessageIds).toEqual(["m-orphan"]);
    expect(evidence.removed).toBe(1);
    expect(evidence.failed).toBe(0);
    expect(deleteVectors).toHaveBeenCalledWith("agent-memory", {
      must: [{ key: "messageId", match: { any: ["m-orphan"] } }],
    });
  });

  it("removes nothing when every candidate source still exists (idempotent)", async () => {
    const { deleteVectors } = await import("@dpf/db");
    const { reconcileOrphanConversationVectors } = await import("./semantic-memory-cleanup");

    const evidence = await reconcileOrphanConversationVectors({
      candidateMessageIds: ["m-live"],
      existsResolver: async () => new Set(["m-live"]),
    });

    expect(evidence.orphanMessageIds).toEqual([]);
    expect(evidence.removed).toBe(0);
    expect(deleteVectors).not.toHaveBeenCalled();
  });

  it("records a failure code without throwing when the existence check fails", async () => {
    const { reconcileOrphanConversationVectors } = await import("./semantic-memory-cleanup");

    const evidence = await reconcileOrphanConversationVectors({
      candidateMessageIds: ["m-1"],
      existsResolver: async () => {
        throw new Error("db unavailable");
      },
    });

    expect(evidence.removed).toBe(0);
    expect(evidence.failed).toBe(1);
    expect(evidence.errorCodes).toContain("Error");
  });
});
