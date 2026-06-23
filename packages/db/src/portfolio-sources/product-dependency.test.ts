import { describe, it, expect } from "vitest";

import {
  crossPortfolioDependencyEdges,
  getProductDependencies,
  getProductDependents,
  linkProductDependency,
  platformCapabilityDependencyEdges,
  projectProductDependencyGraph,
  registryDependencyEdges,
  type DependencyTraversalClient,
  type ProductDependencyClient,
} from "./product-dependency";

type EdgeRow = {
  id: string;
  fromProductId: string;
  toProductId: string;
  relationType: string;
  source: string | null;
};

function makeFakeDb(
  productIds: Record<string, string>,
  seedEdges: Array<{ from: string; to: string; rel: string }> = [],
): ProductDependencyClient & DependencyTraversalClient & { edges: EdgeRow[] } {
  const edges: EdgeRow[] = seedEdges.map((e, i) => ({
    id: `e-seed-${i}`,
    fromProductId: e.from,
    toProductId: e.to,
    relationType: e.rel,
    source: null,
  }));
  let seq = 0;
  return {
    edges,
    digitalProduct: {
      findUnique: async (args: unknown) => {
        const pid = (args as { where: { productId: string } }).where.productId;
        const id = productIds[pid];
        return id ? { id } : null;
      },
    },
    productDependency: {
      findUnique: async (args: unknown) => {
        const w = (
          args as {
            where: {
              fromProductId_toProductId_relationType: {
                fromProductId: string;
                toProductId: string;
                relationType: string;
              };
            };
          }
        ).where.fromProductId_toProductId_relationType;
        const found = edges.find(
          (e) =>
            e.fromProductId === w.fromProductId &&
            e.toProductId === w.toProductId &&
            e.relationType === w.relationType,
        );
        return found ? { id: found.id } : null;
      },
      create: async (args: unknown) => {
        const data = (
          args as {
            data: { fromProductId: string; toProductId: string; relationType: string; source: string | null };
          }
        ).data;
        const row: EdgeRow = { id: `e-${seq++}`, ...data };
        edges.push(row);
        return row;
      },
      findMany: async (args: unknown) => {
        const where = (
          args as { where: { fromProductId?: { in: string[] }; toProductId?: { in: string[] } } }
        ).where;
        if (where.fromProductId?.in) {
          const set = new Set(where.fromProductId.in);
          return edges.filter((e) => set.has(e.fromProductId)).map((e) => ({ toProductId: e.toProductId }));
        }
        if (where.toProductId?.in) {
          const set = new Set(where.toProductId.in);
          return edges.filter((e) => set.has(e.toProductId)).map((e) => ({ fromProductId: e.fromProductId }));
        }
        return [];
      },
    },
  };
}

describe("linkProductDependency", () => {
  it("creates an edge, is idempotent, and skips missing endpoints + self-loops", async () => {
    const db = makeFakeDb({ "cap-a": "id-a", "cap-b": "id-b" });
    expect(
      await linkProductDependency({ fromProductId: "cap-a", toProductId: "cap-b", relationType: "depends_on", db }),
    ).toBe("created");
    expect(db.edges.length).toBe(1);
    expect(
      await linkProductDependency({ fromProductId: "cap-a", toProductId: "cap-b", relationType: "depends_on", db }),
    ).toBe("exists");
    expect(
      await linkProductDependency({ fromProductId: "cap-a", toProductId: "nope", relationType: "depends_on", db }),
    ).toBe("skipped");
    expect(
      await linkProductDependency({ fromProductId: "cap-a", toProductId: "cap-a", relationType: "depends_on", db }),
    ).toBe("skipped");
    expect(db.edges.length).toBe(1);
  });
});

describe("edge sources", () => {
  it("registryDependencyEdges maps depends_on + is_part_of (and ignores empties)", () => {
    const edges = registryDependencyEdges([
      { product_id: "p1", depends_on_product_ids: ["d1", "d2"], is_part_of_product_ids: ["parent1"] },
      { product_id: "p2" },
    ]);
    expect(edges).toContainEqual({ fromProductId: "p1", toProductId: "d1", relationType: "depends_on", source: "manual_entry" });
    expect(edges).toContainEqual({ fromProductId: "p1", toProductId: "parent1", relationType: "part_of", source: "manual_entry" });
    expect(edges.some((e) => e.fromProductId === "p2")).toBe(false);
  });

  it("platformCapabilityDependencyEdges emits cap edges from the manifest", () => {
    const edges = platformCapabilityDependencyEdges();
    expect(
      edges.some(
        (e) =>
          e.fromProductId === "cap-build-studio" &&
          e.toProductId === "cap-build-sandbox" &&
          e.relationType === "depends_on" &&
          e.source === "platform_capability",
      ),
    ).toBe(true);
  });
});

describe("crossPortfolioDependencyEdges", () => {
  it("links the sold offer to its Manufacturing & Delivery pipeline", () => {
    const edges = crossPortfolioDependencyEdges();
    expect(
      edges.some(
        (e) =>
          e.fromProductId === "dpf-platform-standard" &&
          e.toProductId === "cap-build-studio" &&
          e.relationType === "depends_on",
      ),
    ).toBe(true);
  });

  it("links supported integrations to the foundational MCP plane", () => {
    const edges = crossPortfolioDependencyEdges();
    expect(
      edges.some((e) => e.fromProductId === "int-quickbooks" && e.toProductId === "cap-mcp-plane"),
    ).toBe(true);
  });
});

describe("projectProductDependencyGraph", () => {
  it("links registry + manifest edges and is idempotent", async () => {
    const db = makeFakeDb({
      "dpf-meta": "id-meta",
      "infra-neo4j-core": "id-neo",
      "infra-docker-runtime": "id-docker",
      "cap-build-studio": "id-bs",
      "cap-build-sandbox": "id-sandbox",
      "cap-local-ai-inference": "id-ai",
      "cap-github-delivery": "id-gh",
    });
    const reg = [
      { product_id: "dpf-meta", depends_on_product_ids: ["infra-neo4j-core", "infra-docker-runtime"] },
      { product_id: "infra-docker-runtime", is_part_of_product_ids: ["dpf-meta"] },
    ];
    const r1 = await projectProductDependencyGraph({ registryProducts: reg, db });
    expect(r1.created).toBeGreaterThan(0);
    const before = db.edges.length;
    const r2 = await projectProductDependencyGraph({ registryProducts: reg, db });
    expect(r2.created).toBe(0);
    expect(db.edges.length).toBe(before);
  });
});

describe("traversal", () => {
  it("getProductDependencies returns transitive deps and is cycle-safe", async () => {
    const db = makeFakeDb({}, [
      { from: "a", to: "b", rel: "depends_on" },
      { from: "b", to: "c", rel: "depends_on" },
      { from: "c", to: "a", rel: "depends_on" }, // cycle back to root
    ]);
    const deps = await getProductDependencies("a", { db });
    expect(new Set(deps)).toEqual(new Set(["b", "c"]));
  });

  it("getProductDependents returns transitive dependents", async () => {
    const db = makeFakeDb({}, [
      { from: "a", to: "b", rel: "depends_on" },
      { from: "b", to: "c", rel: "depends_on" },
    ]);
    const dependents = await getProductDependents("c", { db });
    expect(new Set(dependents)).toEqual(new Set(["a", "b"]));
  });
});
