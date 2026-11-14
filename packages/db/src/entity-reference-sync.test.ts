import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-A63A9476 AC-KLR-2: saving a body creates and removes MENTIONS edges in
// graph_edge idempotently. The graph writes go through prisma.$executeRawUnsafe
// (graph-sync.ts), mocked here; a tiny in-memory edge table answers them so a
// second save can be compared with the first.
const edges = new Map<string, Record<string, unknown>>();
const nodes = new Map<string, string[]>();

function key(src: string, dst: string, rel: string) {
  return `${src}|${dst}|${rel}`;
}

vi.mock("./client", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("INSERT INTO graph_node")) {
        const [k, labels, , label] = params as [string, string[], string, string];
        const existing = nodes.get(k);
        if (existing && !existing.includes(label)) return 0;
        nodes.set(k, existing ?? labels);
        return 1;
      }
      if (sql.includes("DELETE FROM graph_edge") && sql.includes("NOT (dst_key = ANY")) {
        const [src, rel, keep] = params as [string, string, string[]];
        for (const k of [...edges.keys()]) {
          const [s, d, r] = k.split("|");
          if (s === src && r === rel && !keep.includes(d!)) edges.delete(k);
        }
        return 1;
      }
      if (sql.includes("INSERT INTO graph_edge")) {
        const [src, dst, rel, props] = params as [string, string, string, string];
        edges.set(key(src, dst, rel), JSON.parse(props));
        return 1;
      }
      if (sql.includes("DELETE FROM graph_edge WHERE src_key = $1 AND dst_key = $2")) {
        const [src, dst] = params as [string, string];
        edges.delete(key(src, dst, "MENTIONS"));
        return 1;
      }
      if (sql.includes("DELETE FROM graph_edge") && sql.includes("src_key = $1 OR dst_key = $1")) {
        const [k0] = params as [string];
        for (const k of [...edges.keys()]) {
          const [s, d, r] = k.split("|");
          if (r === "MENTIONS" && (s === k0 || d === k0)) edges.delete(k);
        }
        return 1;
      }
      return 0;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("writtenBy")) {
        const [src] = params as [string];
        return [...edges.entries()]
          .filter(([k]) => k.startsWith(`${src}|`) && k.endsWith("|MENTIONS"))
          .map(([k, props]) => ({ dst_key: k.split("|")[1], written_by: props.writtenBy }));
      }
      if (sql.includes("SELECT src_key, dst_key, props")) {
        const [dst] = params as [string];
        return [...edges.entries()]
          .filter(([k]) => k.split("|")[1] === dst && k.endsWith("|MENTIONS"))
          .map(([k, props]) => ({ src_key: k.split("|")[0], dst_key: dst, props }));
      }
      return [];
    }),
  },
}));

import { prisma } from "./client";
import { removeEntityReferences, repointReferenceTarget, syncEntityReferences, type EntityReferenceDb } from "./entity-reference-sync";

function stubDb(): EntityReferenceDb {
  return {
    backlogItem: { findMany: vi.fn(async ({ where }) => (where.itemId.in as string[]).filter((id) => id.startsWith("BI-K")).map((itemId) => ({ itemId, organizationId: itemId === "BI-KOTHER" ? "org-b" : null }))) },
    epic: { findMany: vi.fn(async ({ where }) => (where.epicId.in as string[]).filter((id) => id === "EP-K1").map((epicId) => ({ epicId }))) },
    document: { findMany: vi.fn(async () => []) },
    workroom: { findMany: vi.fn(async () => []) },
    wikiPage: {
      findMany: vi.fn(async ({ where }) => {
        const rows = [{ id: "page-kernel", slug: "principles/no-assumptions", organizationId: null }];
        if (where.slug) return rows.filter((r) => (where.slug.in as string[]).includes(r.slug));
        return rows.filter((r) => (where.id.in as string[]).includes(r.id));
      }),
    },
  };
}

const source = { kind: "backlog" as const, key: "BI-SRC", organizationId: "org-a", field: "body" as const, writtenBy: "user:u1" };

describe("syncEntityReferences (AC-KLR-2)", () => {
  beforeEach(() => {
    edges.clear();
    nodes.clear();
  });

  it("writes one MENTIONS edge per known, allowed mention and nothing for unknown ids", async () => {
    const result = await syncEntityReferences(source, "Needs BI-K1, EP-K1, BI-NOPE and [[principles/no-assumptions|this]]; BI-K1 again.", { db: stubDb() });
    expect(result.written.sort()).toEqual(["BI-K1", "EP-K1", "page-kernel"]);
    expect(result.unresolved).toEqual(["BI-NOPE"]);
    expect([...edges.keys()].sort()).toEqual(["BI-SRC|BI-K1|MENTIONS", "BI-SRC|EP-K1|MENTIONS", "BI-SRC|page-kernel|MENTIONS"]);
    expect(nodes.get("BI-SRC")).toEqual(["BacklogItem"]);
  });

  it("refuses a mention of another organization's record (R4)", async () => {
    const result = await syncEntityReferences(source, "See BI-KOTHER.", { db: stubDb() });
    expect(result.refused).toEqual(["BI-KOTHER"]);
    expect(edges.size).toBe(0);
  });

  it("removes edges a later save no longer mentions, and a re-run changes nothing", async () => {
    await syncEntityReferences(source, "BI-K1 and EP-K1", { db: stubDb() });
    await syncEntityReferences(source, "only EP-K1", { db: stubDb() });
    const once = JSON.stringify([...edges.entries()].map(([k, p]) => [k, { ...p, syncedAt: 0 }]));
    await syncEntityReferences(source, "only EP-K1", { db: stubDb() });
    const twice = JSON.stringify([...edges.entries()].map(([k, p]) => [k, { ...p, syncedAt: 0 }]));
    expect([...edges.keys()]).toEqual(["BI-SRC|EP-K1|MENTIONS"]);
    expect(twice).toBe(once);
  });

  it("keeps the first writer of an existing edge and a null writer reuses it", async () => {
    await syncEntityReferences({ ...source, writtenBy: "agent:a1" }, "EP-K1", { db: stubDb() });
    await syncEntityReferences({ ...source, writtenBy: null }, "EP-K1 BI-K1", { db: stubDb() });
    expect(edges.get("BI-SRC|EP-K1|MENTIONS")!.writtenBy).toBe("agent:a1");
    expect(edges.get("BI-SRC|BI-K1|MENTIONS")!.writtenBy).toBe("projection:references-rebuild");
  });

  it("a wiki body writes entity ids only; wiki-to-wiki links stay on LINKS_TO", async () => {
    const result = await syncEntityReferences(
      { kind: "wiki", key: "page-org", organizationId: "org-a", slug: "overlay/x", field: "body", writtenBy: "user:u1" },
      "[[principles/no-assumptions]] and EP-K1",
      { db: stubDb() },
    );
    expect(result.written).toEqual(["EP-K1"]);
  });

  it("refuses a target key already held under another label instead of merging", async () => {
    nodes.set("EP-K1", ["CodeSymbol"]);
    const result = await syncEntityReferences(source, "EP-K1", { db: stubDb() });
    expect(result.written).toEqual([]);
    expect(result.refused).toEqual(["EP-K1"]);
  });
});

describe("reference lifecycle", () => {
  beforeEach(() => {
    edges.clear();
    nodes.clear();
  });

  it("merge re-points the merged item's inbound edges to the survivor", async () => {
    await syncEntityReferences({ ...source, key: "BI-A" }, "BI-K1", { db: stubDb() });
    await repointReferenceTarget("BI-K1", "BI-K2", { corpus: "install", organizationId: null, family: null });
    expect([...edges.keys()]).toEqual(["BI-A|BI-K2|MENTIONS"]);
    expect(edges.get("BI-A|BI-K2|MENTIONS")!.targetScope).toBe("install");
  });

  it("deleting an entity removes the edges that start or end at it", async () => {
    await syncEntityReferences(source, "BI-K1", { db: stubDb() });
    await removeEntityReferences("BI-K1");
    expect(edges.size).toBe(0);
    expect(vi.mocked(prisma.$executeRawUnsafe)).toHaveBeenCalled();
  });
});
