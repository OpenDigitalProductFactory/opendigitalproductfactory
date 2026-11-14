import { describe, expect, it, vi } from "vitest";

// BI-A63A9476 AC-KLR-2: `references:rebuild` runs the writer over every body
// and can be re-run; edges of sources that no longer exist are pruned.
vi.mock("./client", () => ({ prisma: { $executeRawUnsafe: vi.fn(async () => 2) } }));

import { prisma } from "./client";
import { rebuildEntityReferences, type EntityReferenceRebuildDb } from "./entity-references-rebuild";

function page<T>(rows: T[]) {
  return vi.fn(async ({ skip = 0, take }: { skip?: number; take: number }) => rows.slice(skip, skip + take));
}

function db(): EntityReferenceRebuildDb {
  return {
    backlogItem: { findMany: page([{ itemId: "BI-1", organizationId: null, body: "EP-1", submittedById: "u1", agentId: null }]) },
    epic: { findMany: page([{ epicId: "EP-1", description: "BI-1", submittedById: null }]) },
    document: { findMany: page([{ documentId: "DOC-1", organizationId: "org-a", currentVersion: { contentText: "BI-1", createdByPrincipalId: "p1" } }]) },
    wikiPage: { findMany: page([{ id: "page-1", slug: "overlay/x", organizationId: "org-a", body: "BI-1" }]) },
    workItemMessage: { findMany: page([{ id: "msg-1", body: "BI-1", senderUserId: null, senderAgentId: "a1", workItem: { capsules: [{ id: "room-1" }] } }]) },
  } as unknown as EntityReferenceRebuildDb;
}

describe("rebuildEntityReferences", () => {
  it("syncs every body source with its field, scope and writer, then prunes edges of vanished sources", async () => {
    const sync = vi.fn(async (_source: unknown, _body: string) => ({ written: ["x"], refused: [] as string[], unresolved: [] as string[] }));
    const result = await rebuildEntityReferences({ db: db(), sync, pageSize: 1 });

    expect(sync.mock.calls.map(([source]) => source)).toEqual([
      { kind: "backlog", key: "BI-1", organizationId: null, field: "body", writtenBy: "user:u1" },
      { kind: "epic", key: "EP-1", organizationId: null, field: "description", writtenBy: null },
      { kind: "document", key: "DOC-1", organizationId: "org-a", field: "body", writtenBy: "principal:p1" },
      { kind: "wiki", key: "page-1", organizationId: "org-a", slug: "overlay/x", field: "body", writtenBy: null },
      { kind: "message", key: "msg-1", organizationId: null, field: "message", writtenBy: "agent:a1", roomId: "room-1" },
    ]);
    const prune = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0]!;
    expect(prune[0]).toContain("rel_type = 'MENTIONS'");
    expect(prune[1]).toEqual(["BI-1", "EP-1", "DOC-1", "page-1", "msg-1"]);
    expect(result).toEqual({ sources: 5, edges: 5, refused: 0, failures: 0, pruned: 2 });
  });

  it("counts a failing source and carries on", async () => {
    const sync = vi.fn(async (source: { key: string }) => {
      if (source.key === "EP-1") throw new Error("boom");
      return { written: [], refused: ["r"], unresolved: [] };
    });
    const result = await rebuildEntityReferences({ db: db(), sync, pageSize: 10 });
    expect(result.failures).toBe(1);
    expect(result.refused).toBe(4);
  });
});
